/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
// Torture tests against a real SQLite database with every migration applied: artists named "AC_DC", "100%", "O'Brien",
// "'); DROP TABLE Track; --", a NUL byte or a lizard emoji; smart playlists with absurd limits; two connections at once.
// The ordinary library next to them must keep working. Runs with: npm run test-database-integration
import { DatabaseFactory } from '../database-factory';
import { TrackRepository } from './track-repository';
import { ListeningSessionRepository } from './listening-session-repository';
import { SmartPlaylistQueryBuilder } from '../../services/playlist/smart-playlist-query-builder';
import { SmartPlaylistDefinition, SmartPlaylistRule } from '../../services/playlist/smart-playlist-parser';
import { ListeningSession } from '../entities/listening-session';

import { DatabaseMigrator } from '../database-migrator';
import { Logger } from '../../common/logger';

const Database = require('better-sqlite3');

/** A database at the latest version, made by the app's own migrator. */
function createSandboxDatabase(file: string = ':memory:'): any {
    const database = new Database(file);
    const logger = { info: (): void => undefined, warn: (): void => undefined, error: (): void => undefined } as unknown as Logger;
    new DatabaseMigrator({ create: (): any => database } as DatabaseFactory, logger).migrate();
    return database;
}

describe('Database torture', () => {
    let database: any;
    let tracks: TrackRepository;
    let sessions: ListeningSessionRepository;
    const builder: SmartPlaylistQueryBuilder = new SmartPlaylistQueryBuilder();

    const names: string[] = [
        'Metallica',
        'AC/DC',
        'AC_DC',
        'ACXDC',
        '100%',
        '1000 Days',
        "O'Brien",
        "'); DROP TABLE Track; --",
        'back\\slash',
        '🦎 Lizard',
        'Motörhead',
        'a\u0000b',
        '%',
        '_',
    ];

    beforeEach(() => {
        database = createSandboxDatabase();
        const factory: DatabaseFactory = { create: (): any => database } as DatabaseFactory;
        tracks = new TrackRepository(factory);
        sessions = new ListeningSessionRepository(factory);

        database.prepare(`INSERT INTO Folder (Path, SafePath, ShowInCollection) VALUES ('/music', '/music', 1)`).run();
        const insert = database.prepare(
            `INSERT INTO Track (Artists, AlbumArtists, Genres, TrackTitle, AlbumTitle, Path, SafePath, FileName, IndexingSuccess, NeedsIndexing)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
        );
        const link = database.prepare('INSERT INTO FolderTrack (FolderID, TrackID) VALUES (1, ?)');

        names.forEach((name: string, i: number) => {
            const info = insert.run(
                `;${name};`,
                `;${name};`,
                `;${name};`,
                `${name} song`,
                `${name} album`,
                `/music/${i}.flac`,
                `/music/${i}.flac`,
                `${i}.flac`,
            );
            link.run(info.lastInsertRowid);
        });
    });

    afterEach(() => database.close());

    const artistsOf = (result: any[] | undefined): string[] => (result ?? []).map((t: any) => t.artists as string).sort();
    const rule = (field: string, operator: string, value: string): SmartPlaylistRule => ({ field, operator, value }) as SmartPlaylistRule;
    const smart = (rules: SmartPlaylistRule[], limitValue?: number, match: 'all' | 'any' = 'all'): any[] | undefined =>
        tracks.getTracksForSmartPlaylist(
            builder.buildWhereClause({
                name: 'x',
                match,
                limitType: limitValue === undefined ? undefined : 'songs',
                limitValue,
                rules,
            } as SmartPlaylistDefinition),
        );

    it('the regular customer: an ordinary artist, genre and smart playlist', () => {
        expect(artistsOf(tracks.getTracksForTrackArtists(['Metallica']))).toEqual([';Metallica;']);
        expect(artistsOf(tracks.getTracksForGenres(['Metallica']))).toEqual([';Metallica;']);
        expect(artistsOf(smart([rule('artist', 'is', 'Metallica')]))).toEqual([';Metallica;']);
    });

    it.each(names)('should find exactly the artist %j, nothing more', (name: string) => {
        expect(artistsOf(tracks.getTracksForTrackArtists([name]))).toEqual([`;${name};`]);
        expect(artistsOf(tracks.getTracksForAlbumArtists([name]))).toEqual([`;${name};`]);
    });

    it('should leave the Track table alone whatever the names contain', () => {
        tracks.getTracksForTrackArtists(names);
        smart(
            names.map((n: string) => rule('title', 'contains', n)),
            undefined,
            'any',
        );

        expect(database.prepare('SELECT COUNT(*) AS c FROM Track').get().c).toEqual(names.length);
    });

    it.each([
        ['contains', '100%', ['100%']],
        ['contains', '_', ['AC_DC', '_']],
        ['contains', "o'b", ["O'Brien"]],
        ['contains', 'drop table', ["'); DROP TABLE Track; --"]],
        ['contains', '\\', ['back\\slash']],
        ['is', 'motorhead', ['Motörhead']],
        ['doesnotcontain', '%', names.filter((n: string) => !n.includes('%'))],
    ])('smart playlist: title %s %j', (operator: string, value: string, expected: string[]) => {
        const result = smart([rule('title', operator, operator === 'is' ? `${value} song` : value)]);

        expect(artistsOf(result)).toEqual(expected.map((n: string) => `;${n};`).sort());
    });

    it.each([1.5, -1, 0, NaN, Infinity, -Infinity, 1e21, 2 ** 53 + 2])('smart playlist with a limit of %p should load', (limit: number) => {
        const result = smart([rule('title', 'contains', 'song')], limit);

        expect(result).toBeDefined();
        expect(result!.length).toBeLessThanOrEqual(names.length);
        if (limit === 1.5) {
            expect(result!.length).toEqual(1);
        }
    });

    it.each(['qwertyuiop', '1e400', '', '-0', '9'.repeat(400)])('smart playlist with a number rule of %j should load', (value: string) => {
        expect(smart([rule('year', 'greaterthan', value), rule('playcount', 'is', value)], undefined, 'any')).toBeDefined();
    });

    it('should handle 5 000 artists in one query', () => {
        const many: string[] = Array.from({ length: 5000 }, (_, i: number) => `Band ${i}`);

        expect(artistsOf(tracks.getTracksForTrackArtists([...many, 'Metallica']))).toEqual([';Metallica;']);
        expect(tracks.getTracksForPaths(many.map((n: string) => `/x/${n}.flac`))).toEqual([]);
    });

    it('should load a smart playlist with 3 000 rules, matching all or any', () => {
        const rules = Array.from({ length: 3000 }, (_, i: number) => rule('title', 'doesnotcontain', `nothing ${i}`));

        expect(smart(rules, undefined, 'all')!.length).toEqual(names.length);
        expect(smart(rules, undefined, 'any')!.length).toEqual(names.length);
    });

    it('should store and read back listening sessions with absurd values', () => {
        const session = new ListeningSession();
        session.trackPath = "/music/'); DROP TABLE ListeningSession; --.flac|1";
        session.trackTitle = '🦎'.repeat(10000);
        session.artists = ';a\u0000b;';
        session.startedAtMs = Date.now();
        session.listenedMs = 0;
        session.trackDurationMs = 0;

        const id: number = sessions.addSession(session);
        sessions.updateListened(id, 1e15, true);

        const history = sessions.getHistory(0, 10, 0);
        expect(history.length).toEqual(1);
        expect(history[0].trackPath).toEqual(session.trackPath);
        expect(history[0].trackTitle.length).toEqual(20000);
        expect(Number.isFinite(sessions.getSummary(0).listenedMs)).toBe(true);
    });

    it('should let the window read while the indexer holds a write transaction (WAL)', () => {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const directory: string = fs.mkdtempSync(path.join(os.tmpdir(), 'db-torture-'));
        const file: string = path.join(directory, 'Dopamine.db');

        try {
            const indexer = createSandboxDatabase(file);
            DatabaseFactory.useWriteAheadLog(indexer);
            const window = new Database(file, { timeout: 100 });
            DatabaseFactory.useWriteAheadLog(window);

            indexer.prepare('BEGIN IMMEDIATE').run();
            indexer.prepare(`INSERT INTO Folder (Path, SafePath, ShowInCollection) VALUES ('/x', '/x', 1)`).run();

            expect(window.prepare('SELECT COUNT(*) AS c FROM Folder').get().c).toEqual(0);
            expect(window.pragma('journal_mode', { simple: true })).toEqual('wal');

            indexer.prepare('COMMIT').run();
            expect(window.prepare('SELECT COUNT(*) AS c FROM Folder').get().c).toEqual(1);

            window.close();
            indexer.close();
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
