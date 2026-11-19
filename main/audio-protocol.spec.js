const fs = require('fs');
const os = require('os');
const path = require('path');
const { audioUrl, flacPatches, parseRange, serveAudio } = require('./audio-protocol');

// A FLAC-like file: marker, STREAMINFO, a PICTURE block (empty MIME type), PADDING (last), then "audio" bytes.
function block(type, isLast, body) {
    const header = Buffer.alloc(4);
    header[0] = (isLast ? 0x80 : 0) | type;
    header.writeUIntBE(body.length, 1, 3);
    return Buffer.concat([header, body]);
}

function picture(mime) {
    const mimeBytes = Buffer.from(mime, 'latin1');
    const fixed = Buffer.alloc(4 + 4);
    fixed.writeUInt32BE(3, 0); // picture type: front cover
    fixed.writeUInt32BE(mimeBytes.length, 4);
    const rest = Buffer.alloc(4 + 16 + 4 + 6); // description length 0, size/depth/colors, data length, data
    rest.writeUInt32BE(6, 20);
    rest.write('JPEG!!', 24, 'latin1');
    return Buffer.concat([fixed, mimeBytes, rest]);
}

const audio = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');

function flacFile(blocks) {
    return Buffer.concat([Buffer.from('fLaC'), ...blocks, audio]);
}

describe('audio-protocol', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-protocol-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function write(name, data) {
        const p = path.join(dir, name);
        fs.writeFileSync(p, data);
        return p;
    }

    function patchesOf(p) {
        const fd = fs.openSync(p, 'r');
        try {
            return flacPatches(fd, fs.statSync(p).size);
        } finally {
            fs.closeSync(fd);
        }
    }

    function request(p, headers = {}, method = 'GET') {
        return serve({ method, url: audioUrl(p), range: headers.range });
    }

    // Runs serveAudio and collects the body.
    async function serve(req) {
        const result = serveAudio(req);
        const chunks = [];
        if (result.stream !== undefined) {
            for await (const chunk of result.stream) chunks.push(chunk);
        }
        return { ...result, body: Buffer.concat(chunks) };
    }

    describe('flacPatches', () => {
        it('should turn every PICTURE block into PADDING and keep the last-block flag', () => {
            const streamInfo = block(0, false, Buffer.alloc(34));
            const p = write('a.flac', flacFile([streamInfo, block(6, false, picture('')), block(6, true, picture('image/jpeg'))]));

            const patches = patchesOf(p);

            const firstPicture = 4 + streamInfo.length;
            const secondPicture = firstPicture + 4 + picture('').length;
            expect(patches).toEqual([
                { offset: firstPicture, value: 0x01 },
                { offset: secondPicture, value: 0x81 },
            ]);
        });

        it('should return nothing for a FLAC without pictures, or a file that is not FLAC', () => {
            const plain = write('plain.flac', flacFile([block(0, true, Buffer.alloc(34))]));
            const notFlac = write('not.flac', Buffer.from('ID3 something else'));
            const empty = write('empty.flac', Buffer.alloc(0));

            expect(patchesOf(plain)).toEqual([]);
            expect(patchesOf(notFlac)).toEqual([]);
            expect(patchesOf(empty)).toEqual([]);
        });

        it('should stop at a truncated or invalid header instead of reading beyond the file', () => {
            const truncated = write('t.flac', Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x06, 0x00])]));
            const invalid = write('i.flac', Buffer.concat([Buffer.from('fLaC'), block(127, false, Buffer.alloc(2)), block(6, true, picture(''))]));

            expect(patchesOf(truncated)).toEqual([]);
            expect(patchesOf(invalid)).toEqual([]);
        });
    });

    describe('parseRange', () => {
        it.each([
            [undefined, 100, undefined],
            ['', 100, undefined],
            ['bytes=0-9', 100, { start: 0, end: 9 }],
            ['bytes=10-', 100, { start: 10, end: 99 }],
            ['bytes=90-200', 100, { start: 90, end: 99 }],
            ['bytes=-10', 100, { start: 90, end: 99 }],
            ['bytes=-500', 100, { start: 0, end: 99 }],
            ['bytes=100-', 100, null],
            ['bytes=5-2', 100, null],
            ['bytes=-0', 100, null],
            ['bytes=-', 100, null],
            ['bytes=0-1,5-6', 100, null],
            ['items=0-1', 100, null],
        ])('%s of %i bytes -> %j', (header, size, expected) => {
            expect(parseRange(header, size)).toEqual(expected);
        });
    });

    describe('serveAudio', () => {
        const streamInfo = block(0, false, Buffer.alloc(34));
        const pictureBlock = block(6, true, picture(''));
        const original = flacFile([streamInfo, pictureBlock]);
        const pictureOffset = 4 + streamInfo.length;

        it('should serve the whole file with only the PICTURE type byte changed', async () => {
            const p = write('album.flac', original);

            const response = await (request(p));
            const body = response.body;

            const expected = Buffer.from(original);
            expected[pictureOffset] = 0x81;
            expect(response.status).toBe(200);
            expect(response.headers['Content-Type']).toBe('audio/flac');
            expect(response.headers['Accept-Ranges']).toBe('bytes');
            expect(Number(response.headers['Content-Length'])).toBe(original.length);
            expect(body.equals(expected)).toBe(true);
        });

        it('should serve ranges, patching only when the range covers the patched byte', async () => {
            const p = write('album.flac', original);

            const around = await (request(p, { range: `bytes=${pictureOffset - 2}-${pictureOffset + 2}` }));
            const tail = await (request(p, { range: 'bytes=-6' }));

            expect(around.status).toBe(206);
            expect(around.headers['Content-Range']).toBe(`bytes ${pictureOffset - 2}-${pictureOffset + 2}/${original.length}`);
            const aroundBody = around.body;
            expect(aroundBody.length).toBe(5);
            expect(aroundBody[2]).toBe(0x81);
            expect(aroundBody[0]).toBe(original[pictureOffset - 2]);
            expect(tail.body.toString('latin1')).toBe('uvwxyz');
        });

        it('should answer 416 for a range outside the file', async () => {
            const p = write('album.flac', original);

            const response = await (request(p, { range: `bytes=${original.length}-` }));

            expect(response.status).toBe(416);
            expect(response.headers['Content-Range']).toBe(`bytes */${original.length}`);
        });

        it('should serve other audio formats unchanged', async () => {
            const p = write('song.mp3', original);

            const body = (await request(p)).body;

            expect(body.equals(original)).toBe(true);
        });

        it('should answer HEAD without a body', async () => {
            const p = write('album.flac', original);

            const response = await (request(p, {}, 'HEAD'));

            expect(response.status).toBe(200);
            expect(Number(response.headers['Content-Length'])).toBe(original.length);
            expect(response.body.length).toBe(0);
        });

        it('should refuse files that are not audio, relative paths and other methods', async () => {
            const text = write('notes.txt', 'secret');

            expect((await (request(text))).status).toBe(403);
            expect((await serve({ method: 'GET', url: 'dopamine-audio://audio/?path=album.flac' })).status).toBe(403);
            expect((await serve({ method: 'GET', url: 'dopamine-audio://audio/' })).status).toBe(403);
            expect((await (request(write('a.flac', original), {}, 'POST'))).status).toBe(405);
        });

        it('should answer 404 for a missing file or a folder', async () => {
            const folder = path.join(dir, 'folder.flac');
            fs.mkdirSync(folder);

            expect((await (request(path.join(dir, 'missing.flac')))).status).toBe(404);
            expect((await (request(folder))).status).toBe(404);
        });

        it('should keep paths with spaces, quotes, # and & intact', async () => {
            const p = write("2021 - Where Fear & Weapons Meet #1 'live' (100%).flac", original);

            const response = await request(p);

            expect(response.status).toBe(200);
            expect(response.body.equals(original)).toBe(false); // served, with the cover hidden
        });

        it('should keep a ? in the path intact (not allowed in Windows file names, so checked on the URL only)', () => {
            const p = path.join(dir, 'Why?.flac');

            expect(new URL(audioUrl(p)).searchParams.get('path')).toBe(p);
        });
    });
});
