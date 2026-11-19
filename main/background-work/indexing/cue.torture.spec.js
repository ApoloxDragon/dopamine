// Torture tests for CUE support: a tester walks into a bar and orders 1 beer, 0 beers, -1 beers, 99999999999 beers,
// "qwertyuiop" beers and a lizard. Every test also checks that the plain, ordinary sheet next to the nonsense still works:
// fixing only the absurd cases would not be enough.
const path = require('path');
const { CueParser } = require('./cue-parser');
const { CueSheetReader } = require('./cue-sheet-reader');
const { CueTrackPath } = require('./cue-track-path');

const n = (p) => path.normalize(p);
const parser = new CueParser();

function sheet(...trackLines) {
    return ['PERFORMER "Band"', 'TITLE "Album"', 'FILE "Album.flac" WAVE', ...trackLines].join('\n');
}

function track(number, time, title = `Song ${number}`) {
    return [`  TRACK ${number} AUDIO`, `    TITLE "${title}"`, `    INDEX 01 ${time}`].join('\n');
}

function createReader(files, statSizes = {}) {
    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const fileSystem = {
        statSync: (p) => {
            if (!(p in files)) throw new Error(`ENOENT ${p}`);
            return { mtimeMs: 1, size: statSizes[p] ?? Buffer.byteLength(files[p] ?? '') };
        },
        readFileSync: jest.fn((p) => {
            if (!(p in files)) throw new Error(`ENOENT ${p}`);
            return Buffer.from(files[p]);
        }),
        readdirSync: (directory) =>
            Object.keys(files)
                .filter((p) => path.dirname(p) === directory)
                .map((p) => path.basename(p)),
    };
    return { reader: new CueSheetReader(parser, logger, fileSystem), logger, fileSystem };
}

describe('CUE torture', () => {
    describe('the regular customer (must always work)', () => {
        it('should read an ordinary three-track sheet', () => {
            const parsed = parser.parse(sheet(track('01', '00:00:00'), track('02', '03:00:00'), track('03', '06:30:37')));

            expect(parsed.files[0].tracks.map((t) => [t.number, t.startMs])).toEqual([
                [1, 0],
                [2, 180000],
                [3, 390493],
            ]);
            expect(parser.createTrackRanges(parsed.files[0], 600000).map((r) => r.endMs)).toEqual([180000, 390493, 600000]);
        });

        it('should give each track a virtual path that parses back', () => {
            for (const number of [1, 2, 9, 10, 99]) {
                expect(CueTrackPath.parse(CueTrackPath.create('/music/Album.flac', number))).toEqual({
                    audioPath: '/music/Album.flac',
                    trackNumber: number,
                });
            }
        });
    });

    describe('track numbers: 0 beers, -1 beers, 99999999999 beers, "qwertyuiop" beers', () => {
        it.each([
            ['-1', 'negative'],
            ['99999999999999999999999', 'not a safe integer'],
            ['1e5', 'scientific notation'],
            ['qwertyuiop', 'not a number'],
            ['0x10', 'hexadecimal'],
            ['NaN', 'NaN'],
            ['Infinity', 'Infinity'],
            ['٣', 'Arabic-Indic digit'],
        ])('should give track "%s" (%s) a number that makes a valid virtual path', (number) => {
            const parsed = parser.parse(sheet(track('01', '00:00:00'), track(number, '01:00:00'), track('03', '02:00:00')));
            const numbers = parsed.files[0].tracks.map((t) => t.number);

            for (const value of numbers) {
                expect(Number.isSafeInteger(value) && value >= 0).toBe(true);
                expect(CueTrackPath.parse(CueTrackPath.create('/a.flac', value))?.trackNumber).toEqual(value);
            }
            // Numbers stay unique, so no two tracks share a virtual path.
            expect(new Set(numbers).size).toEqual(numbers.length);
            expect(numbers[0]).toEqual(1);
            expect(numbers[2]).toEqual(3);
        });

        it('should accept track 0 (some rippers use it for a hidden track)', () => {
            const parsed = parser.parse(sheet(track('00', '00:00:00'), track('01', '00:30:00')));

            expect(parsed.files[0].tracks.map((t) => t.number)).toEqual([0, 1]);
        });

        it('should keep track numbers unique when the sheet repeats one (1 beer, 1 beer, 1 beer)', () => {
            const parsed = parser.parse(
                sheet(track('01', '00:00:00'), track('01', '01:00:00'), track('01', '02:00:00'), track('02', '03:00:00')),
            );
            const numbers = parsed.files[0].tracks.map((t) => t.number);

            expect(new Set(numbers).size).toEqual(4);
            expect(numbers[0]).toEqual(1);
        });

        it('should not let leading zeros make duplicates (01 and 001 are the same track)', () => {
            const numbers = parser.parse(sheet(track('01', '00:00:00'), track('001', '01:00:00'))).files[0].tracks.map((t) => t.number);

            expect(new Set(numbers).size).toEqual(2);
        });
    });

    describe('times: -1 seconds, 99:99:99, a lizard', () => {
        it.each(['-01:00:00', '1:2', '00:00:00:00', 'lizard', '', '  ', '00:00:0x', '00:-1:00', '١:٢:٣'])(
            'should ignore the INDEX time "%s" and drop only that track',
            (time) => {
                const parsed = parser.parse(sheet(track('01', '00:00:00'), track('02', time), track('03', '02:00:00')));

                expect(parsed.files[0].tracks.map((t) => t.number)).toEqual([1, 3]);
            },
        );

        it('should give finite times for absurd but well-formed values', () => {
            for (const time of ['99:99:99', '99999999999999999999:00:00', '00:59:74', '00:00:75']) {
                const ms = parser.timeToMilliseconds(time);
                expect(ms === undefined || Number.isFinite(ms)).toBe(true);
            }
        });

        it('should drop tracks that start after the end of the file, and never make ranges of zero or negative length', () => {
            const parsed = parser.parse(
                sheet(
                    track('01', '00:00:00'),
                    track('02', '00:00:00'),
                    track('03', '01:00:00'),
                    track('04', '00:30:00'),
                    track('05', '9999:00:00'),
                ),
            );
            const ranges = parser.createTrackRanges(parsed.files[0], 120000);

            expect(ranges.every((r) => r.endMs > r.startMs && r.endMs <= 120000)).toBe(true);
            expect(ranges.map((r) => r.number).includes(5)).toBe(false);
        });

        it('should handle an unknown or broken file length', () => {
            const parsed = parser.parse(sheet(track('01', '00:00:00'), track('02', '01:00:00')));

            for (const duration of [0, -1, NaN, undefined, null, Infinity]) {
                const ranges = parser.createTrackRanges(parsed.files[0], duration);
                expect(ranges.every((r) => Number.isFinite(r.startMs) && r.endMs > r.startMs)).toBe(true);
                // The first track always ends where the second starts.
                expect(ranges[0]).toEqual(expect.objectContaining({ number: 1, endMs: 60000 }));
            }
        });
    });

    describe('the sheet itself: dancing in, sliding in, crashing through the window', () => {
        it.each([
            ['empty', ''],
            ['only whitespace', ' \t\r\n\r\n   '],
            ['only a BOM', '\uFEFF'],
            ['NUL bytes', '\0\0\0FILE\0"a.flac"\0WAVE'],
            ['a JPEG renamed to .cue', '\xFF\xD8\xFF\xE0\x00\x10JFIF'],
            ['JSON', '{"FILE": "a.flac", "TRACK": 1}'],
            ['tracks before any FILE', '  TRACK 01 AUDIO\n    INDEX 01 00:00:00'],
            ['INDEX before any TRACK', 'FILE "a.flac" WAVE\nINDEX 01 00:00:00'],
            ['a lone quote', 'FILE " WAVE\nTRACK 01 AUDIO\nTITLE "\nINDEX 01 00:00:00'],
            ['data tracks only', 'FILE "a.bin" BINARY\nTRACK 01 MODE1/2352\nINDEX 01 00:00:00'],
        ])('should not throw on %s', (_, text) => {
            expect(() => parser.parse(text)).not.toThrow();
            expect(() => parser.parse(parser.decode(Buffer.from(text, 'latin1')))).not.toThrow();
        });

        it('should read every line ending: \\n, \\r\\n, \\r, mixed', () => {
            for (const newline of ['\n', '\r\n', '\r']) {
                const text = sheet(track('01', '00:00:00'), track('02', '01:00:00')).split('\n').join(newline);
                expect(parser.parse(text).files[0].tracks.length).toEqual(2);
            }
            expect(parser.parse('FILE "a.flac" WAVE\r\n  TRACK 01 AUDIO\r    INDEX 01 00:00:00\n').files[0].tracks.length).toEqual(1);
        });

        it('should read lower case and tab-separated commands', () => {
            const parsed = parser.parse('file "a.flac" wave\n\ttrack\t01\taudio\n\t\ttitle\t"Low"\n\t\tindex\t01\t00:00:00');

            expect(parsed.files[0].tracks[0]).toEqual(expect.objectContaining({ number: 1, title: 'Low', startMs: 0 }));
        });

        it('should decode UTF-16 both ways, UTF-8 with and without BOM, and Windows-1252', () => {
            const text = sheet(track('01', '00:00:00', 'Gefrorene Tränen'));
            const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
            const be = Buffer.from(le);
            be.swap16();

            for (const bytes of [
                le,
                be,
                Buffer.from(text, 'utf8'),
                Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
                Buffer.from(text, 'latin1'),
            ]) {
                expect(parser.parse(parser.decode(bytes)).files[0].tracks[0].title).toEqual('Gefrorene Tränen');
            }
        });

        it('should not break on UTF-16 with an odd number of bytes or a BOM only', () => {
            expect(() => parser.decode(Buffer.from([0xff, 0xfe, 0x41]))).not.toThrow();
            expect(() => parser.decode(Buffer.from([0xfe, 0xff, 0x00, 0x41, 0x42]))).not.toThrow();
            expect(parser.decode(Buffer.from([0xff, 0xfe]))).toEqual('');
            expect(parser.decode(Buffer.alloc(0))).toEqual('');
        });

        it('should keep emoji, right-to-left text, zalgo and SQL in titles as plain text', () => {
            const titles = ['🍺🦎', 'שיר', 'Z̷̢̛a̸l̵g̶o̷', "'; DROP TABLE Track; --", '<script>alert(1)</script>', '../../../etc/passwd'];
            const parsed = parser.parse(sheet(...titles.map((t, i) => track(String(i + 1), `0${i}:00:00`, t))));

            expect(parsed.files[0].tracks.map((t) => t.title)).toEqual(titles);
        });

        it('should parse 10 000 tracks and a 1 MB title quickly', () => {
            const lines = [];
            for (let i = 1; i <= 10000; i++) lines.push(track(String(i), `${i}:00:00`));
            const started = Date.now();
            const parsed = parser.parse(sheet(...lines) + `\nTITLE "${'x'.repeat(1_000_000)}"`);

            expect(parsed.files[0].tracks.length).toEqual(10000);
            expect(parser.createTrackRanges(parsed.files[0], 10001 * 60000).length).toEqual(10000);
            expect(Date.now() - started).toBeLessThan(2000);
        });

        it('should stay fast on lines that are all spaces, quotes or colons', () => {
            const started = Date.now();
            parser.parse('TITLE ' + '"'.repeat(200000));
            parser.parse('INDEX 01 ' + ':'.repeat(200000));
            parser.parse(' '.repeat(200000) + 'x');
            parser.parse('FILE ' + ' '.repeat(200000) + 'WAVE');
            parser.timeToMilliseconds('1'.repeat(100000) + ':00:00');
            expect(Date.now() - started).toBeLessThan(1000);
        });
    });

    describe('virtual paths: the bar has a door marked "|"', () => {
        it.each([
            ['', undefined],
            ['|', undefined],
            ['|3', undefined],
            ['a|', undefined],
            ['a|-1', undefined],
            ['a|1.5', undefined],
            ['a|1e3', undefined],
            ['a| 1', undefined],
            ['a|１', undefined], // full-width digit
            ['a|٣', undefined], // Arabic-Indic digit
            ['a|99999999999999999999999', undefined], // not a safe integer
            ['/mu|sic/a.flac', undefined],
            ['/music/a|3.flac', undefined],
            ['a|b|3', { audioPath: 'a|b', trackNumber: 3 }],
            ['a|007', { audioPath: 'a', trackNumber: 7 }],
            ['C:\\Music\\Album.flac|12', { audioPath: 'C:\\Music\\Album.flac', trackNumber: 12 }],
        ])('should parse "%s" as %p', (value, expected) => {
            expect(CueTrackPath.parse(value)).toEqual(expected);
        });

        it.each([undefined, null, 42, {}, [], true])('should not throw on a path that is not a string (%p)', (value) => {
            expect(CueTrackPath.parse(value)).toBeUndefined();
        });

        it('should tell CUE tracks from normal tracks for odd inputs', () => {
            for (const value of [undefined, null, {}, { audioPath: '' }, { audioPath: 5 }, { audioPath: null }]) {
                expect(CueTrackPath.isCueTrack(value)).toBe(false);
            }
            expect(CueTrackPath.getAudioPath({ path: '/a.mp3', audioPath: '' })).toEqual('/a.mp3');
            expect(CueTrackPath.getAudioPath({ path: '/a.flac|1', audioPath: '/a.flac' })).toEqual('/a.flac');
        });
    });

    describe('the reader: the audio file is in another bar, or is the bar', () => {
        it('should only use audio files next to the sheet, whatever the sheet says', () => {
            const files = {
                [n('/music/album/a.cue')]: 'FILE "../../../etc/passwd" WAVE\n TRACK 01 AUDIO\n INDEX 01 00:00:00',
                [n('/etc/passwd.flac')]: '',
            };
            const { reader } = createReader(files);

            expect(reader.read(n('/music/album/a.cue'))).toEqual([]);
        });

        it('should not follow absolute or UNC paths in FILE', () => {
            for (const name of ['C:\\Windows\\win.ini', '\\\\server\\share\\x.flac', '/dev/zero', 'file:///etc/x.flac']) {
                const files = {
                    [n('/music/a.cue')]: `FILE "${name}" WAVE\n TRACK 01 AUDIO\n INDEX 01 00:00:00`,
                    [n('/music/real.flac')]: '',
                    [n('/music/other.flac')]: '',
                };
                const result = createReader(files).reader.read(n('/music/a.cue'));

                expect(result.every((x) => path.dirname(x.audioPath) === n('/music'))).toBe(true);
            }
        });

        it('should not read a huge file that only pretends to be a cue sheet', () => {
            const cue = n('/music/a.cue');
            const { reader, fileSystem } = createReader(
                { [cue]: 'FILE "a.flac" WAVE', [n('/music/a.flac')]: '' },
                { [cue]: 2 * 1024 * 1024 * 1024 },
            );

            expect(reader.read(cue)).toEqual([]);
            expect(fileSystem.readFileSync).not.toHaveBeenCalled();
        });

        it('should still read a normal sheet in the same folder', () => {
            const files = { [n('/music/a.cue')]: sheet(track('01', '00:00:00'), track('02', '01:00:00')), [n('/music/Album.flac')]: '' };
            const result = createReader(files).reader.read(n('/music/a.cue'));

            expect(result[0].audioPath).toEqual(n('/music/Album.flac'));
            expect(result[0].tracks.map((t) => t.number)).toEqual([1, 2]);
        });

        it('should survive the file disappearing between stat and read, and a folder it cannot list', () => {
            const logger = { warn: jest.fn(), error: jest.fn() };
            const reader = new CueSheetReader(parser, logger, {
                statSync: () => ({ mtimeMs: 1, size: 10 }),
                readFileSync: () => {
                    throw new Error('EACCES');
                },
                readdirSync: () => {
                    throw new Error('EACCES');
                },
            });

            expect(reader.read('/x.cue')).toEqual([]);
            expect(reader.getTrack('/x.cue', '/x.flac', 1)).toBeUndefined();
        });

        it('should give no track for absurd track numbers', () => {
            const files = { [n('/music/a.cue')]: sheet(track('01', '00:00:00')), [n('/music/Album.flac')]: '' };
            const { reader } = createReader(files);

            for (const number of [0, -1, NaN, Infinity, 1.5, undefined, null, '1']) {
                expect(reader.getTrack(n('/music/a.cue'), n('/music/Album.flac'), number)).toBeUndefined();
            }
            expect(reader.getTrack(n('/music/a.cue'), n('/music/Album.flac'), 1)).toEqual(expect.objectContaining({ number: 1 }));
        });

        it('should not give a playable track of zero length when two tracks start at the same time', () => {
            const files = {
                [n('/music/a.cue')]: sheet(track('01', '00:00:00'), track('02', '00:00:00'), track('03', '01:00:00')),
                [n('/music/Album.flac')]: '',
            };
            const tracks = createReader(files).reader.read(n('/music/a.cue'))[0].tracks;

            expect(tracks.every((t) => t.nextStartMs === undefined || t.nextStartMs > t.startMs)).toBe(true);
        });
    });
});
