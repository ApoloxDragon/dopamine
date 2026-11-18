const { CueParser } = require('./cue-parser');

// Real EAC sheet (Fleshgod Apocalypse - Oracles)
const oraclesCue = `REM GENRE Metal
REM DATE 2009
REM DISCID A008D80A
REM COMMENT "ExactAudioCopy v0.99pb5"
PERFORMER "Fleshgod Apocalypse"
TITLE "Oracles"
FILE "Fleshgod Apocalypse - Oracles.flac" WAVE
  TRACK 01 AUDIO
    TITLE "In Honour Of Reason"
    PERFORMER "Fleshgod Apocalypse"
    FLAGS DCP
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Post-Enlightenment Executor"
    PERFORMER "Fleshgod Apocalypse"
    FLAGS DCP
    INDEX 01 04:27:29
  TRACK 03 AUDIO
    TITLE "As Tyrants Fall"
    PERFORMER "Fleshgod Apocalypse"
    FLAGS DCP
    INDEX 01 07:23:08
`;

// Real EAC sheet with empty REM COMPOSER and a WAV file (Veleno), shortened
const veleno = `REM DISCID B30EA10D
REM COMMENT "ExactAudioCopy v1.3"
PERFORMER "Fleshgod Apocalypse"
TITLE "Veleno"
REM COMPOSER ""
FILE "Fleshgod Apocalypse - Veleno.wav" WAVE
  TRACK 01 AUDIO
    TITLE "Fury"
    PERFORMER "Fleshgod Apocalypse"
    REM COMPOSER ""
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "The Day We'll Be Gone"
    PERFORMER "Fleshgod Apocalypse"
    REM COMPOSER ""
    INDEX 01 35:14:70
`;

// Real EAC sheet with CATALOG and ISRC lines (Agony [Japan]), shortened
const agony = `REM GENRE "Symphonic Technical Brutal Death Metal"
REM DATE 2011
CATALOG 4988001496809
PERFORMER "Fleshgod Apocalypse"
TITLE "Agony [Japan]"
FILE "Agony (Japan).flac" WAVE
  TRACK 01 AUDIO
    TITLE "Temptation"
    PERFORMER "Fleshgod Apocalypse"
    ISRC DED831100268
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "The Hypocrisy"
    PERFORMER "Fleshgod Apocalypse"
    ISRC DED831100269
    INDEX 01 01:47:41
`;

describe('CueParser', () => {
    let parser;

    beforeEach(() => {
        parser = new CueParser();
    });

    describe('timeToMilliseconds', () => {
        it('should convert whole seconds', () => {
            expect(parser.timeToMilliseconds('00:02:00')).toBe(2000);
        });

        it('should convert minutes', () => {
            expect(parser.timeToMilliseconds('04:00:00')).toBe(240000);
        });

        it('should convert frames at 75 frames per second', () => {
            // 37 frames = 493.33 ms, 74 frames = 986.67 ms
            expect(parser.timeToMilliseconds('00:00:37')).toBe(493);
            expect(parser.timeToMilliseconds('00:00:74')).toBe(987);
        });

        it('should convert the 04:27:29 start of Oracles track 2', () => {
            expect(parser.timeToMilliseconds('04:27:29')).toBe(4 * 60000 + 27 * 1000 + 387);
        });

        it('should return undefined for invalid values', () => {
            expect(parser.timeToMilliseconds('abc')).toBeUndefined();
            expect(parser.timeToMilliseconds('1:2')).toBeUndefined();
        });
    });

    describe('parse', () => {
        it('should read album level fields', () => {
            const sheet = parser.parse(oraclesCue);

            expect(sheet.performer).toBe('Fleshgod Apocalypse');
            expect(sheet.title).toBe('Oracles');
            expect(sheet.genre).toBe('Metal');
            expect(sheet.year).toBe(2009);
        });

        it('should read quoted genre', () => {
            expect(parser.parse(agony).genre).toBe('Symphonic Technical Brutal Death Metal');
        });

        it('should read the referenced file', () => {
            const sheet = parser.parse(oraclesCue);

            expect(sheet.files.length).toBe(1);
            expect(sheet.files[0].fileName).toBe('Fleshgod Apocalypse - Oracles.flac');
        });

        it('should keep parentheses in the file name', () => {
            expect(parser.parse(agony).files[0].fileName).toBe('Agony (Japan).flac');
        });

        it('should read the wav file of a sheet whose name differs', () => {
            expect(parser.parse(veleno).files[0].fileName).toBe('Fleshgod Apocalypse - Veleno.wav');
        });

        it('should read tracks with number, title, performer and start', () => {
            const tracks = parser.parse(oraclesCue).files[0].tracks;

            expect(tracks.length).toBe(3);
            expect(tracks[0]).toEqual(
                expect.objectContaining({ number: 1, title: 'In Honour Of Reason', performer: 'Fleshgod Apocalypse', startMs: 0 }),
            );
            expect(tracks[1].number).toBe(2);
            expect(tracks[1].title).toBe('Post-Enlightenment Executor');
            expect(tracks[2].startMs).toBe(7 * 60000 + 23 * 1000 + 107);
        });

        it('should ignore empty REM values such as REM COMPOSER ""', () => {
            const tracks = parser.parse(veleno).files[0].tracks;

            expect(tracks[0].composer).toBe('');
        });

        it('should keep apostrophes in titles', () => {
            expect(parser.parse(veleno).files[0].tracks[1].title).toBe("The Day We'll Be Gone");
        });

        it('should ignore CATALOG, ISRC, FLAGS and DISCID lines without failing', () => {
            const tracks = parser.parse(agony).files[0].tracks;

            expect(tracks.length).toBe(2);
            expect(tracks[1].startMs).toBe(60000 + 47 * 1000 + 547);
        });

        it('should handle Windows line endings', () => {
            const sheet = parser.parse(oraclesCue.replace(/\n/g, '\r\n'));

            expect(sheet.files[0].tracks.length).toBe(3);
        });

        it('should handle a leading byte order mark', () => {
            const sheet = parser.parse('﻿' + oraclesCue);

            expect(sheet.title).toBe('Oracles');
        });

        it('should read an unquoted file name', () => {
            const sheet = parser.parse('FILE album.flac WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n');

            expect(sheet.files[0].fileName).toBe('album.flac');
        });

        it('should skip tracks that are not audio', () => {
            const sheet = parser.parse(
                'FILE "a.wav" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n  TRACK 02 MODE1/2352\n    INDEX 01 03:00:00\n',
            );

            expect(sheet.files[0].tracks.length).toBe(1);
        });

        it('should skip tracks without INDEX 01', () => {
            const sheet = parser.parse('FILE "a.wav" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    TITLE "x"\n');

            expect(sheet.files[0].tracks.length).toBe(1);
        });

        it('should return no files for text that is not a cue sheet', () => {
            expect(parser.parse('this is not a cue sheet').files).toEqual([]);
        });

        it('should keep the INDEX 00 pregap start', () => {
            const sheet = parser.parse(
                'FILE "a.wav" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    INDEX 00 03:58:00\n    INDEX 01 04:00:00\n',
            );

            expect(sheet.files[0].tracks[1].pregapStartMs).toBe(238000 + 0);
            expect(sheet.files[0].tracks[1].startMs).toBe(240000);
        });
    });

    describe('createTrackRanges', () => {
        it('should end each track where the next starts and the last at the file duration', () => {
            const file = parser.parse(oraclesCue).files[0];
            const ranges = parser.createTrackRanges(file, 600000);

            expect(ranges.length).toBe(3);
            expect(ranges[0].startMs).toBe(0);
            expect(ranges[0].endMs).toBe(ranges[1].startMs);
            expect(ranges[1].endMs).toBe(ranges[2].startMs);
            expect(ranges[2].endMs).toBe(600000);
        });

        it('should leave no gap and no overlap between tracks', () => {
            const file = parser.parse(oraclesCue).files[0];
            const ranges = parser.createTrackRanges(file, 600000);

            for (let i = 1; i < ranges.length; i++) {
                expect(ranges[i].startMs).toBe(ranges[i - 1].endMs);
            }
        });

        it('should keep INDEX 00 pregap audio at the end of the previous track', () => {
            const file = parser.parse(
                'FILE "a.wav" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    INDEX 00 03:58:00\n    INDEX 01 04:00:00\n',
            ).files[0];
            const ranges = parser.createTrackRanges(file, 480000);

            expect(ranges[0].endMs).toBe(240000);
            expect(ranges[1].startMs).toBe(240000);
        });

        it('should drop a last track that starts after the end of the file', () => {
            const file = parser.parse(oraclesCue).files[0];
            const ranges = parser.createTrackRanges(file, 400000);

            // Track 3 starts at 443107 ms, which is beyond the 400000 ms file
            expect(ranges.length).toBe(2);
        });

        it('should sort tracks that are out of order', () => {
            const file = parser.parse(
                'FILE "a.wav" WAVE\n  TRACK 02 AUDIO\n    INDEX 01 01:00:00\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n',
            ).files[0];
            const ranges = parser.createTrackRanges(file, 120000);

            expect(ranges.map((r) => r.number)).toEqual([1, 2]);
        });
    });

    describe('decode', () => {
        it('should decode UTF-8', () => {
            expect(parser.decode(Buffer.from('TITLE "Café"', 'utf8'))).toBe('TITLE "Café"');
        });

        it('should strip a UTF-8 byte order mark', () => {
            expect(parser.decode(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('TITLE "A"')]))).toBe('TITLE "A"');
        });

        it('should decode UTF-16 little endian with a byte order mark', () => {
            const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('TITLE "Café"', 'utf16le')]);

            expect(parser.decode(buffer)).toBe('TITLE "Café"');
        });

        it('should decode UTF-16 big endian with a byte order mark', () => {
            const le = Buffer.from('TITLE "Café"', 'utf16le');
            le.swap16();

            expect(parser.decode(Buffer.concat([Buffer.from([0xfe, 0xff]), le]))).toBe('TITLE "Café"');
        });

        it('should fall back to Windows-1252 when the bytes are not valid UTF-8', () => {
            // 0xE9 is "é" in Windows-1252 and an invalid UTF-8 sequence on its own
            expect(parser.decode(Buffer.from([0x54, 0x20, 0x43, 0x61, 0x66, 0xe9]))).toBe('T Café');
        });
    });
});
