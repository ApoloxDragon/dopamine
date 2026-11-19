const fs = require('fs');
const path = require('path');
const { CueParser } = require('./cue-parser');
const { CueSheetReader } = require('./cue-sheet-reader');

// Real sheets of single-file FLAC albums (EAC and another ripper), as found in a user's collection.
const testData = path.join(__dirname, 'test-data', 'cue');
// The reader joins paths with the platform's separator (backslashes on Windows).
const n = (p) => path.normalize(p);

function createFileSystem(files) {
    // files: { '/music/album/name.ext': contents }
    return {
        statSync: (p) => {
            if (!(p in files)) throw new Error(`ENOENT ${p}`);
            return { mtimeMs: 1 };
        },
        readFileSync: (p) => {
            if (!(p in files)) throw new Error(`ENOENT ${p}`);
            return Buffer.from(files[p]);
        },
        readdirSync: (directory) =>
            Object.keys(files)
                .filter((p) => path.dirname(p) === directory)
                .map((p) => path.basename(p)),
    };
}

function createReader(files) {
    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    return { reader: new CueSheetReader(new CueParser(), logger, createFileSystem(files)), logger };
}

function realSheet(name) {
    return fs.readFileSync(path.join(testData, name));
}

describe('CueSheetReader', () => {
    describe('real sheets', () => {
        it.each([
            ['2021 - Where Fear and Weapons Meet.cue', '2021 - Where Fear and Weapons Meet.flac', 'Where Fear and Weapons Meet', 11],
            ['1914 - The Blind Leading The Blind.cue', '1914 - The Blind Leading The Blind.flac', 'The Blind Leading The Blind', 11],
            ['1914 - Eschatology of War.cue', '1914 - Eschatology of War.flac', 'Eschatology of War', 10],
        ])('should read %s', (cueName, audioName, albumTitle, trackCount) => {
            const cuePath = `/music/1914/${cueName}`;
            const { reader, logger } = createReader({ [cuePath]: realSheet(cueName), [`/music/1914/${audioName}`]: '' });

            const result = reader.read(cuePath);

            expect(result.length).toBe(1);
            expect(result[0].audioPath).toBe(n(`/music/1914/${audioName}`));
            expect(result[0].sheet.performer).toBe('1914');
            expect(result[0].sheet.title).toBe(albumTitle);
            expect(result[0].tracks.length).toBe(trackCount);
            expect(result[0].tracks[0].startMs).toBe(0);
            expect(result[0].tracks[trackCount - 1].nextStartMs).toBeUndefined();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('should only use the album file, not tracks split by hand next to it', () => {
            // A folder with the album file, its sheet, and tracks that were split by hand earlier.
            const cueName = '2021 - Where Fear and Weapons Meet.cue';
            const cuePath = `/music/1914/${cueName}`;
            const { reader } = createReader({
                [cuePath]: realSheet(cueName),
                '/music/1914/2021 - Where Fear and Weapons Meet.flac': '',
                "/music/1914/08 - Corps D'autos-Canons-Mitrailleuses (a.c.m).flac": '',
                '/music/1914/01 - War In.flac': '',
            });

            const result = reader.read(cuePath);

            expect(result.map((x) => x.audioPath)).toEqual([n('/music/1914/2021 - Where Fear and Weapons Meet.flac')]);
        });

        it('should trim spaces inside quoted titles', () => {
            const cueName = '1914 - The Blind Leading The Blind.cue';
            const cuePath = `/music/1914/${cueName}`;
            const { reader } = createReader({ [cuePath]: realSheet(cueName), '/music/1914/1914 - The Blind Leading The Blind.flac': '' });

            const titles = reader.read(cuePath)[0].tracks.map((x) => x.title);

            expect(titles[3]).toBe('High Wood. 75 Acres of Hell');
            expect(titles[5]).toBe('Hanging On The Barbed Wire');
            expect(titles[8]).toBe('Sto.trupp');
        });
    });

    describe('file names that do not match exactly', () => {
        const multiFileSheet = `PERFORMER "Cattle Decapitation"
TITLE "Homovore"
FILE "12. Bodily Abuse.flac" WAVE
  TRACK 12 AUDIO
    INDEX 01 00:00:00
FILE "13. Molested,Digested.flac" WAVE
  TRACK 13 AUDIO
    INDEX 01 00:00:00
`;

        it('should match a file whose name differs only in spaces and punctuation', () => {
            const { reader, logger } = createReader({
                '/music/homovore/Homovore.cue': multiFileSheet,
                '/music/homovore/12. Bodily Abuse.flac': '',
                '/music/homovore/13. Molested, Digested.flac': '',
            });

            const result = reader.read('/music/homovore/Homovore.cue');

            expect(result.map((x) => x.audioPath)).toEqual([n('/music/homovore/12. Bodily Abuse.flac'), n('/music/homovore/13. Molested, Digested.flac')]);
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('should not guess when several files match loosely', () => {
            const { reader, logger } = createReader({
                '/music/homovore/Homovore.cue': multiFileSheet,
                '/music/homovore/12. Bodily Abuse.flac': '',
                '/music/homovore/13. Molested, Digested.flac': '',
                '/music/homovore/13 Molested Digested.flac': '',
            });

            const result = reader.read('/music/homovore/Homovore.cue');

            expect(result.map((x) => x.audioPath)).toEqual([n('/music/homovore/12. Bodily Abuse.flac')]);
            expect(logger.warn).toHaveBeenCalledTimes(1);
        });

        it('should still prefer an exact match', () => {
            const { reader } = createReader({
                '/music/homovore/Homovore.cue': multiFileSheet,
                '/music/homovore/12. Bodily Abuse.flac': '',
                '/music/homovore/13. Molested,Digested.flac': '',
                '/music/homovore/13. Molested, Digested.flac': '',
            });

            const result = reader.read('/music/homovore/Homovore.cue');

            expect(result[1].audioPath).toBe(n('/music/homovore/13. Molested,Digested.flac'));
        });
    });
});
