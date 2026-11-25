const fs = require('fs');
const os = require('os');
const path = require('path');
const { AlbumDetails } = require('./album-details');
const { TrackFiller } = require('./track-filler');
const { TrackVerifier } = require('./track-verifier');
const { AlbumKeyGenerator } = require('./album-key-generator');
const { TrackFieldCreator } = require('./track-field-creator');
const { MetadataPatcher } = require('./metadata-patcher');
const { MimeTypes } = require('./mime-types');
const { Track } = require('../data/entities/track');

const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
// Ticks are just the file's mtime in ms here.
const fileAccess = () => ({ getDateModifiedInTicks: (p) => fs.statSync(p).mtimeMs });

describe('AlbumDetails', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'album-details-'));
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const write = (text) => fs.writeFileSync(path.join(dir, AlbumDetails.fileName), text);
    const song = () => path.join(dir, '01 Song.flac');

    it('the regular customer: reads the details for the songs in its folder', () => {
        write(
            '{ "year": 1970, "albumTitle": "Paranoid", "albumArtist": "Black Sabbath", "genre": ["Heavy Metal", "Rock"], "discNumber": 1, "discCount": 2 }',
        );

        expect(new AlbumDetails(fileAccess(), logger()).forFile(song())).toEqual({
            albumTitle: 'Paranoid',
            albumArtists: ['Black Sabbath'],
            genres: ['Heavy Metal', 'Rock'],
            year: 1970,
            discNumber: 1,
            discCount: 2,
        });
    });

    it('should give nothing, and no warning, for a folder without a details file', () => {
        const log = logger();
        const details = new AlbumDetails(fileAccess(), log);

        expect(details.forFile(song())).toBeUndefined();
        expect(details.modifiedTicksForFile(song())).toBe(0);
        expect(log.warn).not.toHaveBeenCalled();
    });

    it('should read each folder once per refresh', () => {
        write('{ "year": 1970 }');
        const fileSystem = { statSync: jest.fn(fs.statSync), readFileSync: jest.fn(fs.readFileSync) };
        const details = new AlbumDetails(fileAccess(), logger(), fileSystem);

        for (let i = 0; i < 100; i++) {
            details.forFile(path.join(dir, `${i}.flac`));
        }

        expect(fileSystem.readFileSync).toHaveBeenCalledTimes(1);
    });

    // Trying to break it.

    it.each([
        ['not JSON', 'year = 1970'],
        ['an array', '[1970]'],
        ['null', 'null'],
        ['a number', '1970'],
        ['empty', ''],
        ['only unknown keys', '{ "lizard": "yes", "beers": -1 }'],
        ['a year as text', '{ "year": "1970" }'],
        ['an impossible year', '{ "year": 99999 }'],
        ['a broken year', '{ "year": 1970.5 }'],
        ['an empty title', '{ "albumTitle": "   " }'],
        ['a title with a NUL', '{ "albumTitle": "a\\u0000b" }'],
        ['a 10 000 character title', JSON.stringify({ albumTitle: 'x'.repeat(10000) })],
        ['an artist list with garbage', '{ "albumArtist": ["A", 42] }'],
        ['disc 3 of 2', '{ "discNumber": 3, "discCount": 2 }'],
        ['disc 0', '{ "discNumber": 0 }'],
    ])('should ignore %s, and say so in the log', (_, text) => {
        write(text);
        const log = logger();

        expect(new AlbumDetails(fileAccess(), log).forFile(song())).toBeUndefined();
        if (text.length > 0 && !text.includes('lizard')) {
            expect(log.warn).toHaveBeenCalled();
        }
    });

    it('should keep the good fields of a file with some bad ones', () => {
        write('{ "year": "nineteen seventy", "albumTitle": "Paranoid", "discNumber": -1 }');

        expect(new AlbumDetails(fileAccess(), logger()).forFile(song())).toEqual({ albumTitle: 'Paranoid' });
    });

    it('should accept a file saved with a BOM (Windows Notepad)', () => {
        write('﻿{ "year": 1970 }');

        expect(new AlbumDetails(fileAccess(), logger()).forFile(song())).toEqual({ year: 1970 });
    });

    it('should ignore a file that is too big without reading it', () => {
        write(JSON.stringify({ albumTitle: 'A', padding: 'x'.repeat(AlbumDetails.maximumBytes) }));
        const fileSystem = { statSync: fs.statSync, readFileSync: jest.fn() };

        expect(new AlbumDetails(fileAccess(), logger(), fileSystem).forFile(song())).toBeUndefined();
        expect(fileSystem.readFileSync).not.toHaveBeenCalled();
    });

    it('should ignore a folder named dopamine.json', () => {
        fs.mkdirSync(path.join(dir, AlbumDetails.fileName));

        expect(new AlbumDetails(fileAccess(), logger()).forFile(song())).toBeUndefined();
    });

    it('should only apply to its own folder, not to subfolders', () => {
        write('{ "year": 1970 }');
        fs.mkdirSync(path.join(dir, 'CD2'));

        expect(new AlbumDetails(fileAccess(), logger()).forFile(path.join(dir, 'CD2', 'a.flac'))).toBeUndefined();
    });
});

describe('dopamine.json while indexing', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'album-details-index-'));
        fs.writeFileSync(path.join(dir, 'a.flac'), 'not really audio');
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    function filler(albumDetails) {
        const fileMetadata = {
            artists: ['Band'],
            albumArtists: ['Band'],
            genres: ['Metal'],
            album: 'Album (CD1)',
            title: 'Song',
            year: 2000,
            trackNumber: 1,
            trackCount: 10,
            discNumber: 0,
            discCount: 0,
            durationInMilliseconds: 1000,
            rating: 0,
            composers: [],
        };
        const access = {
            getFileName: (p) => path.basename(p),
            getFileSizeInBytes: () => 16,
            getDirectoryPath: (p) => path.dirname(p),
            getDateCreatedInTicks: () => 1,
            getDateModifiedInTicks: (p) => Math.round(fs.statSync(p).mtimeMs),
            getFileExtension: (p) => path.extname(p),
        };
        return new TrackFiller(
            { create: () => fileMetadata },
            new AlbumKeyGenerator(),
            new TrackFieldCreator(),
            new MetadataPatcher(),
            new MimeTypes(),
            access,
            { convertDateToTicks: () => 1 },
            logger(),
            undefined,
            albumDetails,
        );
    }

    const accessForDetails = { getDateModifiedInTicks: (p) => Math.round(fs.statSync(p).mtimeMs) };

    it('the regular customer: songs without a details file keep their tags', () => {
        const track = filler(new AlbumDetails(accessForDetails, logger())).addFileMetadataToTrack(
            new Track(path.join(dir, 'a.flac')),
            false,
        );

        expect([track.albumTitle, track.year, track.indexingSuccess]).toEqual(['Album (CD1)', 2000, 1]);
    });

    it('should apply the details over the tags, including a new album key, and never touch the music file', () => {
        fs.writeFileSync(
            path.join(dir, 'dopamine.json'),
            '{ "albumTitle": "Album", "year": 1970, "discNumber": 1, "discCount": 2, "genre": "Doom" }',
        );
        const before = fs.readFileSync(path.join(dir, 'a.flac'), 'utf8');

        const track = filler(new AlbumDetails(accessForDetails, logger())).addFileMetadataToTrack(
            new Track(path.join(dir, 'a.flac')),
            false,
        );

        expect([track.albumTitle, track.year, track.discNumber, track.discCount, track.genres]).toEqual(['Album', 1970, 1, 2, ';Doom;']);
        expect(track.albumKey).toEqual(new AlbumKeyGenerator().generateAlbumKey('Album', ['Band']));
        expect(fs.readFileSync(path.join(dir, 'a.flac'), 'utf8')).toEqual(before);
    });

    it('should make songs out of date when dopamine.json changes, and not before', () => {
        const albumDetailsFor = () => new AlbumDetails(accessForDetails, logger());
        const track = filler(albumDetailsFor()).addFileMetadataToTrack(new Track(path.join(dir, 'a.flac')), false);
        const access = { getFileSizeInBytes: () => 16, getDateModifiedInTicks: (p) => Math.round(fs.statSync(p).mtimeMs) };

        expect(new TrackVerifier(access, albumDetailsFor()).isTrackOutOfDate(track)).toBe(false);

        const json = path.join(dir, 'dopamine.json');
        fs.writeFileSync(json, '{ "year": 1970 }');
        const later = new Date(Date.now() + 60000);
        fs.utimesSync(json, later, later);

        expect(new TrackVerifier(access, albumDetailsFor()).isTrackOutOfDate(track)).toBe(true);
    });
});
