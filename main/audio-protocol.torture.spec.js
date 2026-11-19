// Torture tests for the dopamine-audio:// protocol: the tester asks for byte -1, byte 99999999999999999999, a lizard
// instead of a range, /etc/shadow dressed up as a .flac, and a FLAC whose headers lie. A normal request is checked
// alongside, so the fixes for nonsense never break plain playback.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audioUrl, flacPatches, parseRange, serveAudio } = require('./audio-protocol');

function block(type, isLast, length, body = Buffer.alloc(Math.min(length, 64))) {
    const header = Buffer.alloc(4);
    header[0] = (isLast ? 0x80 : 0) | type;
    header.writeUIntBE(length, 1, 3);
    return Buffer.concat([header, body]);
}

describe('audio-protocol torture', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-protocol-torture-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const write = (name, data) => {
        const p = path.join(dir, name);
        fs.writeFileSync(p, data);
        return p;
    };

    async function serve(req) {
        const result = serveAudio(req);
        const chunks = [];
        if (result.stream !== undefined) {
            for await (const chunk of result.stream) chunks.push(chunk);
        }
        return { ...result, body: Buffer.concat(chunks) };
    }

    const get = (p, range) => serve({ method: 'GET', url: audioUrl(p), range });

    it('the regular customer: a whole file, then a seek', async () => {
        const p = write('song.mp3', Buffer.from('ID3 plain mp3 bytes'));

        const whole = await get(p);
        const seek = await get(p, 'bytes=4-8');

        expect(whole.status).toBe(200);
        expect(whole.body.toString()).toBe('ID3 plain mp3 bytes');
        expect(seek.status).toBe(206);
        expect(seek.body.toString()).toBe('plain');
    });

    describe('ranges: 0 beers, -1 beers, 99999999999999999999 beers, "qwertyuiop" beers', () => {
        it.each([
            'bytes=-1-5',
            'bytes=99999999999999999999-',
            'bytes=0x10-0x20',
            'bytes=1e3-',
            'bytes=qwertyuiop',
            'bytes=🦎-🍺',
            'bytes=0-1,2-3,4-5',
            'bytes= 0-1',
            'BYTES=0-1',
            'bytes=0-1\r\nX-Evil: 1',
            'bytes=' + '9'.repeat(100000) + '-',
            '=',
        ])('should answer %j with 416 or a valid part of the file, never a crash', async (range) => {
            const p = write('a.wav', Buffer.from('0123456789'));

            const response = await get(p, range);

            if (response.status === 416) {
                expect(response.headers['Content-Range']).toBe('bytes */10');
            } else {
                expect([200, 206]).toContain(response.status);
                expect(Number(response.headers['Content-Length'])).toBe(response.body.length);
            }
        });

        it('should serve the whole file for a huge end, and the last byte for bytes=-1', async () => {
            const p = write('a.wav', Buffer.from('0123456789'));

            expect((await get(p, 'bytes=0-99999999999999999999999')).body.toString()).toBe('0123456789');
            expect((await get(p, 'bytes=-1')).body.toString()).toBe('9');
            expect((await get(p, 'bytes=9-9')).body.toString()).toBe('9');
        });

        it('should parse ranges of a 0-byte and a 1-byte file sensibly', () => {
            expect(parseRange('bytes=0-', 0)).toBeNull();
            expect(parseRange('bytes=-1', 0)).toBeNull();
            expect(parseRange('bytes=0-0', 1)).toEqual({ start: 0, end: 0 });
            expect(parseRange('bytes=-99', 1)).toEqual({ start: 0, end: 0 });
        });

        it('should parse a long run of digits quickly', () => {
            const started = Date.now();
            parseRange('bytes=' + '1'.repeat(1_000_000) + '-' + '2'.repeat(1_000_000), 100);
            parseRange('bytes=' + '-'.repeat(1_000_000), 100);
            expect(Date.now() - started).toBeLessThan(500);
        });
    });

    describe('paths: /etc/shadow dressed up as a song', () => {
        it.each([
            ['relative', 'music/a.flac'],
            ['not audio', '/etc/passwd'],
            ['audio extension then something else', '/etc/passwd.flac.sh'],
            ['NUL byte', '/etc/passwd\0.flac'],
            ['extension only in the folder', '/music.flac/secret.txt'],
            ['empty', ''],
        ])('should refuse a %s path', async (_, filePath) => {
            const response = await serve({ method: 'GET', url: `dopamine-audio://audio/?path=${encodeURIComponent(filePath)}` });

            expect([403, 404]).toContain(response.status);
            expect(response.stream).toBeUndefined();
        });

        it.each([
            'dopamine-audio://audio/',
            'dopamine-audio://audio/?path',
            'dopamine-audio://audio/?nope=1',
            'not a url',
            '',
            'dopamine-audio://audio/?path=%E0%A4%A',
        ])('should refuse the URL %j without throwing', async (url) => {
            const response = await serve({ method: 'GET', url });

            expect([400, 403, 404]).toContain(response.status);
        });

        it.each(['POST', 'PUT', 'DELETE', 'OPTIONS', 'get', '', undefined])('should refuse the method %p', async (method) => {
            const p = write('a.flac', Buffer.from('fLaC'));

            expect((await serve({ method, url: audioUrl(p) })).status).toBe(405);
        });

        it('should keep the first path when the URL has two', async () => {
            const p = write('a.ogg', Buffer.from('OggS'));
            const url = `${audioUrl(p)}&path=${encodeURIComponent('/etc/passwd')}`;

            expect((await serve({ method: 'GET', url })).body.toString()).toBe('OggS');
        });

        it('should serve a folder, a socket-like or a missing file as 404', async () => {
            fs.mkdirSync(path.join(dir, 'folder.flac'));

            expect((await get(path.join(dir, 'folder.flac'))).status).toBe(404);
            expect((await get(path.join(dir, 'missing.flac'))).status).toBe(404);
        });

        it('should serve an empty audio file as an empty answer', async () => {
            const response = await get(write('empty.flac', Buffer.alloc(0)));

            expect(response.status).toBe(200);
            expect(response.headers['Content-Length']).toBe('0');
            expect(response.body.length).toBe(0);
        });

        it('should keep emoji, right-to-left, percent signs and plus signs in file names', async () => {
            for (const name of ['🍺 🦎.flac', 'שיר.mp3', '100% + 50%.ogg', 'a&b=c?d#e.wav'.replace('?', '')]) {
                const p = write(name, Buffer.from('ok'));
                expect((await get(p)).body.toString()).toBe('ok');
            }
        });
    });

    describe('FLAC headers that lie', () => {
        const patchesOf = (data) => {
            const p = write('x.flac', data);
            const fd = fs.openSync(p, 'r');
            try {
                return flacPatches(fd, data.length);
            } finally {
                fs.closeSync(fd);
            }
        };

        it('should stop when a block claims to be 16 MB long in a tiny file', () => {
            const data = Buffer.concat([Buffer.from('fLaC'), block(6, false, 0xffffff), block(6, true, 10)]);

            expect(patchesOf(data)).toEqual([{ offset: 4, value: 1 }]);
        });

        it('should not loop forever on 100 000 empty blocks that never say "last"', () => {
            const blocks = [];
            for (let i = 0; i < 100000; i++) blocks.push(block(6, false, 0, Buffer.alloc(0)));
            const started = Date.now();

            const patches = patchesOf(Buffer.concat([Buffer.from('fLaC'), ...blocks]));

            expect(patches.length).toBeLessThanOrEqual(1024);
            expect(Date.now() - started).toBeLessThan(1000);
        });

        it('should give nothing for files that only start like FLAC', () => {
            for (const data of [
                Buffer.from('fLa'),
                Buffer.from('fLaC'),
                Buffer.from('fLaC\x86'),
                Buffer.from('FLAC0000'),
                Buffer.alloc(0),
            ]) {
                expect(patchesOf(data)).toEqual([]);
            }
        });

        it('should serve a FLAC with a lying header byte-for-byte except the patched type bytes', async () => {
            const data = Buffer.concat([Buffer.from('fLaC'), block(6, false, 0xffffff), Buffer.from('audio')]);
            const response = await get(write('liar.flac', data));

            expect(response.body.length).toBe(data.length);
            expect(response.body[4]).toBe(1);
            expect(response.body.subarray(5).equals(data.subarray(5))).toBe(true);
        });
    });
});
