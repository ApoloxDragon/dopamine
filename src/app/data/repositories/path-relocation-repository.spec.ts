/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
// Real SQLite, through the app's own migrator (runs with: npm run test-database-integration).
import { DatabaseFactory } from '../database-factory';
import { DatabaseMigrator } from '../database-migrator';
import { Logger } from '../../common/logger';
import { PathRelocationRepository } from './path-relocation-repository';

const Database = require('better-sqlite3');

describe('PathRelocationRepository', () => {
    const oldShare = '/run/user/1000/gvfs/smb-share:server=192.168.10.183,share=storage';
    const newShare = '/run/user/1000/gvfs/smb-share:server=192.168.10.183,share=storage,user=apolox';
    let database: any;
    let repository: PathRelocationRepository;

    const one = (sql: string): any => database.prepare(sql).get();
    const all = (sql: string): any[] => database.prepare(sql).all();

    beforeEach(() => {
        database = new Database(':memory:');
        const factory: DatabaseFactory = { create: (): any => database } as DatabaseFactory;
        new DatabaseMigrator(factory, {
            info: (): void => undefined,
            warn: (): void => undefined,
            error: (): void => undefined,
        } as unknown as Logger).migrate();
        repository = new PathRelocationRepository(factory);

        const song = `${oldShare}/music/Band/Álbum/01 Song.flac`;
        const cue = `${oldShare}/music/Band/Live/Live.flac`;
        database
            .prepare('INSERT INTO Folder (Path, SafePath, ShowInCollection) VALUES (?, ?, 1)')
            .run(`${oldShare}/music`, `${oldShare}/music`.toLowerCase());
        database
            .prepare('INSERT INTO Folder (Path, SafePath, ShowInCollection) VALUES (?, ?, 1)')
            .run('/home/apolox/Music', '/home/apolox/music');
        database
            .prepare('INSERT INTO Track (Path, SafePath, AlbumKey3, PlayCount) VALUES (?, ?, ?, 7)')
            .run(song, song.toLowerCase(), `;${oldShare}/music/Band/Álbum;`);
        database
            .prepare('INSERT INTO Track (Path, SafePath, AudioPath, CuePath, AlbumKey3) VALUES (?, ?, ?, ?, ?)')
            .run(`${cue}|2`, `${cue}|2`.toLowerCase(), cue, `${oldShare}/music/Band/Live/Live.cue`, `;${oldShare}/music/Band/Live;`);
        database.prepare('INSERT INTO Track (Path, SafePath) VALUES (?, ?)').run('/home/apolox/Music/a.flac', '/home/apolox/music/a.flac');
        database.prepare('INSERT INTO Track (Path, SafePath) VALUES (?, ?)').run(`${oldShare}-old/music/b.flac`, 'x');
        database
            .prepare('INSERT INTO QueuedTrack (Path, SafePath, IsPlaying, ProgressSeconds, OrderID) VALUES (?, ?, 1, 0, 0)')
            .run(song, song.toLowerCase());
        database
            .prepare('INSERT INTO ListeningSession (TrackPath, StartedAtMs, ListenedMs, TrackDurationMs) VALUES (?, 1, 1, 1)')
            .run(song);
        database.prepare("INSERT INTO Liked (Kind, Key, Value, LikedAtMs) VALUES ('album', ?, 1, 1)").run(`;${oldShare}/music/Band/Álbum;`);
        database.prepare("INSERT INTO Liked (Kind, Key, Value, LikedAtMs) VALUES ('artist', ?, 1, 1)").run(`;${oldShare}/music;`);
    });

    afterEach(() => database.close());

    it('the regular customer: moves the share to its new name, keeping play counts, likes and history', () => {
        const changes = repository.relocate(oldShare, newShare);

        const song = `${newShare}/music/Band/Álbum/01 Song.flac`;
        expect(changes).toBeGreaterThan(0);
        expect(all('SELECT Path FROM Folder ORDER BY Path').map((x) => x.Path)).toEqual(['/home/apolox/Music', `${newShare}/music`]);
        expect(one(`SELECT PlayCount, SafePath, AlbumKey3 FROM Track WHERE Path = '${song}'`)).toEqual({
            PlayCount: 7,
            SafePath: song.toLowerCase(),
            AlbumKey3: `;${newShare}/music/Band/Álbum;`,
        });
        expect(one('SELECT Path FROM QueuedTrack').Path).toBe(song);
        expect(one('SELECT TrackPath FROM ListeningSession').TrackPath).toBe(song);
        expect(one("SELECT Key FROM Liked WHERE Kind = 'album'").Key).toBe(`;${newShare}/music/Band/Álbum;`);
    });

    it('should move CUE songs (virtual path, audio file and sheet)', () => {
        repository.relocate(oldShare, newShare);

        expect(one('SELECT Path, AudioPath, CuePath FROM Track WHERE CuePath IS NOT NULL')).toEqual({
            Path: `${newShare}/music/Band/Live/Live.flac|2`,
            AudioPath: `${newShare}/music/Band/Live/Live.flac`,
            CuePath: `${newShare}/music/Band/Live/Live.cue`,
        });
    });

    it('should keep the lower-case copy right for letters SQLite does not know (Á)', () => {
        repository.relocate(oldShare, newShare);

        expect(all('SELECT SafePath FROM Track').map((x) => x.SafePath)).toContain(
            `${newShare}/music/band/álbum/01 song.flac`.toLowerCase(),
        );
    });

    // Trying to break it.

    it('should leave everything else alone: local songs, a folder with a similar name, other likes', () => {
        repository.relocate(oldShare, newShare);

        expect(one("SELECT COUNT(*) AS c FROM Track WHERE Path = '/home/apolox/Music/a.flac'").c).toBe(1);
        expect(one(`SELECT COUNT(*) AS c FROM Track WHERE Path = '${oldShare}-old/music/b.flac'`).c).toBe(1);
        expect(one("SELECT Key FROM Liked WHERE Kind = 'artist'").Key).toBe(`;${oldShare}/music;`);
    });

    it('should do nothing when the new place is already a music folder (no duplicate songs)', () => {
        database.prepare('INSERT INTO Folder (Path, SafePath, ShowInCollection) VALUES (?, ?, 1)').run(`${newShare}/music`, 'x');

        expect(repository.relocate(oldShare, newShare)).toBeUndefined();
        expect(one(`SELECT COUNT(*) AS c FROM Track WHERE Path LIKE '${oldShare}/%'`).c).toBe(2);
    });

    it.each([
        ['the same place', oldShare, oldShare],
        ['an empty source', '', newShare],
        ['an empty target', oldShare, ''],
        ['nothing', undefined, undefined],
    ])('should change nothing for %s', (_, from, to) => {
        expect(repository.relocate(from as unknown as string, to as unknown as string)).toBe(0);
        expect(one(`SELECT COUNT(*) AS c FROM Track WHERE Path LIKE '${oldShare}/%'`).c).toBe(2);
    });

    it('should accept a trailing slash and SQL-looking names', () => {
        const odd = "/mnt/it's'; DROP TABLE Track; --";
        expect(repository.relocate(`${oldShare}/`, `${odd}/`)).toBeGreaterThan(0);
        expect(one('SELECT COUNT(*) AS c FROM Track').c).toBe(4);
        expect(one('SELECT Path FROM QueuedTrack').Path).toBe(`${odd}/music/Band/Álbum/01 Song.flac`);
    });

    it('should move it back again when the share returns under its first name', () => {
        repository.relocate(oldShare, newShare);
        repository.relocate(newShare, oldShare);

        expect(one('SELECT Path FROM QueuedTrack').Path).toBe(`${oldShare}/music/Band/Álbum/01 Song.flac`);
        expect(one("SELECT Key FROM Liked WHERE Kind = 'album'").Key).toBe(`;${oldShare}/music/Band/Álbum;`);
    });
});
