#!/usr/bin/env node
// Runs the real indexing worker pipeline (TrackIndexer with its adder, updater and remover) on a music folder,
// against a SQLite database built from the real migrations. Prints the resulting tracks.
//
// Usage: node scripts/dev/index-sandbox.js <music-folder> [db-file] [--quiet] [--song-cache] [--full]
//   --song-cache: use <music-folder>/Dopamine/cache.json.gz like the app. --full: read every song again (Full refresh).
//   Pass a db-file to keep the database between runs (to test re-indexing, changed sheets, removed files...).
// Needs better-sqlite3 built for Node: npm rebuild better-sqlite3
const path = require('path');
const { createSandboxDatabase } = require('./db-sandbox');

const bw = path.resolve(__dirname, '../../main/background-work');
const req = (p) => require(path.join(bw, p));

const { DateTime } = req('common/date-time');
const { FileAccess } = req('common/io/file-access');
const { FolderRepository } = req('data/folder-repository');
const { FolderTrackRepository } = req('data/folder-track-repository');
const { RemovedTrackRepository } = req('data/removed-track-repository');
const { TrackRepository } = req('data/track-repository');
const { DirectoryWalker } = req('indexing/directory-walker');
const { IndexablePathFetcher } = req('indexing/indexable-path-fetcher');
const { TrackFiller } = req('indexing/track-filler');
const { TrackFieldCreator } = req('indexing/track-field-creator');
const { MetadataPatcher } = req('indexing/metadata-patcher');
const { MimeTypes } = req('indexing/mime-types');
const { AlbumKeyGenerator } = req('indexing/album-key-generator');
const { FileMetadataFactory } = req('indexing/file-metadata.factory');
const { TrackVerifier } = req('indexing/track-verifier');
const { TrackUpdater } = req('indexing/track-updater');
const { TrackRemover } = req('indexing/track-remover');
const { TrackAdder } = req('indexing/track-adder');
const { TrackIndexer } = req('indexing/track-indexer');
const { CueParser } = req('indexing/cue-parser');
const { CueSheetReader } = req('indexing/cue-sheet-reader');
const { SongCache, CachingFileMetadataFactory } = req('indexing/song-cache');

async function indexFolder(musicFolder, dbFile = ':memory:', quiet = false, options = {}) {
    const db = createSandboxDatabase(dbFile);
    const databaseFactory = { create: () => db };
    const log = (level) => (...args) => {
        if (level !== 'info' || !quiet) {
            const message = args.find((a) => typeof a === 'string');
            const error = args.find((a) => a instanceof Error);
            console.log(`[${level}] ${message}${error ? ` (${error.message})` : ''}`);
        }
    };
    const logger = { info: log('info'), warn: log('warn'), error: log('error') };
    const workerProxy = { postMessage: () => {}, skipRemovedFilesDuringRefresh: () => false };

    const dateTime = new DateTime();
    const fileAccess = new FileAccess(dateTime);
    const folderRepository = new FolderRepository(databaseFactory);
    const folderTrackRepository = new FolderTrackRepository(databaseFactory);
    const trackRepository = new TrackRepository(databaseFactory);
    const cueSheetReader = new CueSheetReader(new CueParser(), logger);
    const fetcher = new IndexablePathFetcher(folderRepository, new DirectoryWalker(fileAccess), fileAccess, logger, cueSheetReader);
    // --song-cache: read and write <folder>/Dopamine/cache.json.gz like the app does.
    const songCache = new SongCache(folderRepository, logger, () => options.songCache === true);
    const filler = new TrackFiller(
        new CachingFileMetadataFactory(new FileMetadataFactory(), songCache),
        new AlbumKeyGenerator(),
        new TrackFieldCreator(),
        new MetadataPatcher(),
        new MimeTypes(),
        fileAccess,
        dateTime,
        logger,
        cueSheetReader,
    );
    const indexer = new TrackIndexer(
        new TrackAdder(new RemovedTrackRepository(databaseFactory), folderTrackRepository, trackRepository, fetcher, filler, workerProxy, logger),
        new TrackUpdater(trackRepository, new TrackVerifier(fileAccess), filler, workerProxy, logger),
        new TrackRemover(folderTrackRepository, trackRepository, fileAccess, workerProxy, logger, cueSheetReader),
        workerProxy,
        logger,
        songCache,
        trackRepository,
    );

    const folderPath = path.resolve(musicFolder);
    if (!db.prepare('SELECT 1 FROM Folder WHERE Path=?').get(folderPath)) {
        db.prepare('INSERT INTO Folder (Path, SafePath, ShowInCollection) VALUES (?, ?, 1)').run(folderPath, folderPath.toLowerCase());
    }

    // --full: like 'Full refresh' (every song read again).
    await indexer.indexTracksAsync(options.full === true);

    return { db, tracks: trackRepository.getAllTracks() };
}

module.exports = { indexFolder };

if (require.main === module) {
    const args = process.argv.slice(2);
    const quiet = args.includes('--quiet');
    const options = { songCache: args.includes('--song-cache'), full: args.includes('--full') };
    const [folder, dbFile] = args.filter((a) => !a.startsWith('--'));

    if (!folder) {
        console.error('usage: index-sandbox.js <music-folder> [db-file] [--quiet] [--song-cache] [--full]');
        process.exit(1);
    }

    const started = Date.now();
    indexFolder(folder, dbFile, quiet, options).then(({ tracks }) => {
        console.log(`Indexed in ${Date.now() - started} ms`);
        console.log(`\n${tracks.length} tracks:`);
        console.table(
            tracks.map((t) => ({
                path: path.basename(t.path),
                no: t.trackNumber,
                of: t.trackCount,
                title: t.trackTitle,
                artists: t.artists,
                album: t.albumTitle,
                genre: t.genres,
                year: t.year,
                startMs: t.cueStartMs,
                endMs: t.cueEndMs,
                durMs: t.duration,
                ok: t.indexingSuccess,
            })),
        );
    });
}
