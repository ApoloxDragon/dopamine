import Database from 'better-sqlite3';
import { DatabaseFactory } from '../database-factory';
import { Migration16 } from '../migrations/migration16';
import { Migration17 } from '../migrations/migration17';
import { ListeningSegment } from '../entities/listening-segment';
import { ListeningEndReason } from '../entities/listening-end-reason';
import { ListeningSession } from '../entities/listening-session';
import { ListeningSessionRepository } from './listening-session-repository';

describe('ListeningSessionRepository', () => {
    let database: any;
    let repository: ListeningSessionRepository;
    const day: number = 24 * 60 * 60 * 1000;
    const now: number = Date.UTC(2026, 10, 19, 12, 0, 0);

    function session(path: string, title: string, artists: string, album: string, albumKey: string, startedAtMs: number, listenedMs: number, counted: boolean): ListeningSession {
        const s: ListeningSession = new ListeningSession();
        s.trackPath = path;
        s.trackTitle = title;
        s.artists = artists;
        s.albumTitle = album;
        s.albumArtists = ';Fleshgod Apocalypse;';
        s.albumKey = albumKey;
        s.startedAtMs = startedAtMs;
        s.listenedMs = listenedMs;
        s.trackDurationMs = 300000;
        s.isCountedAsPlay = counted ? 1 : 0;
        return s;
    }

    beforeEach(() => {
        database = new Database(':memory:');
        for (const migration of [new Migration16(), new Migration17()]) {
            migration.up();
            database.exec(migration.statements.join('\n'));
        }
        repository = new ListeningSessionRepository({ create: (): any => database } as DatabaseFactory);

        repository.addSession(session('/m/oracles.flac|1', 'In Honour Of Reason', ';Fleshgod Apocalypse;', 'Oracles', 'oracles', now - 1 * day, 267000, true));
        repository.addSession(session('/m/oracles.flac|1', 'In Honour Of Reason', ';Fleshgod Apocalypse;', 'Oracles', 'oracles', now - 2 * day, 267000, true));
        repository.addSession(session('/m/oracles.flac|2', 'Post-Enlightenment Executor', ';Fleshgod Apocalypse;', 'Oracles', 'oracles', now - 2 * day, 20000, false));
        repository.addSession(session('/m/x.flac', 'Duet', ';Fleshgod Apocalypse;;Guest;', 'Other', 'other', now - 40 * day, 200000, true));
    });

    afterEach(() => {
        database.close();
    });

    it('should return the id of an added session', () => {
        const id: number = repository.addSession(session('/m/y.flac', 'Y', ';A;', 'Album', 'album', now, 0, false));

        expect(id).toBeGreaterThan(4);
    });

    it('should update listened time and play flag', () => {
        const id: number = repository.addSession(session('/m/y.flac', 'Y', ';A;', 'Album', 'album', now, 0, false));
        repository.updateListened(id, 123456.7, true);

        const history: ListeningSession[] = repository.getHistory(now, 10, 0);

        expect(history[0].listenedMs).toEqual(123457);
        expect(history[0].isCountedAsPlay).toEqual(1);
    });

    it('should delete a session', () => {
        const id: number = repository.addSession(session('/m/y.flac', 'Y', ';A;', 'Album', 'album', now, 0, false));
        repository.deleteSession(id);

        expect(repository.getHistory(now, 10, 0)).toEqual([]);
    });

    it('should delete the whole history', () => {
        const deleted: number = repository.deleteAllSessions();

        expect(deleted).toEqual(4);
        expect(repository.getHistory(0, 10, 0)).toEqual([]);
        expect(repository.getSummary(0).listenedMs).toEqual(0);
    });

    it('should summarize all time', () => {
        const summary = repository.getSummary(0);

        expect(summary.listenedMs).toEqual(267000 + 267000 + 20000 + 200000);
        expect(summary.plays).toEqual(3);
        expect(summary.distinctTracks).toEqual(3);
        expect(summary.distinctAlbums).toEqual(2);
        expect(summary.activeDays).toEqual(3);
    });

    it('should summarize only sessions in the period', () => {
        const summary = repository.getSummary(now - 7 * day);

        expect(summary.listenedMs).toEqual(267000 + 267000 + 20000);
        expect(summary.plays).toEqual(2);
        expect(summary.distinctAlbums).toEqual(1);
    });

    it('should return zeros for an empty period', () => {
        const summary = repository.getSummary(now + day);

        expect(summary).toEqual({ listenedMs: 0, plays: 0, distinctTracks: 0, distinctAlbums: 0, activeDays: 0 });
    });

    it('should rank tracks by listening time', () => {
        const top = repository.getTopTracks(0, 10);

        expect(top.map((x) => x.title)).toEqual(['In Honour Of Reason', 'Duet', 'Post-Enlightenment Executor']);
        expect(top[0]).toEqual({
            key: '/m/oracles.flac|1',
            title: 'In Honour Of Reason',
            subtitle: 'Fleshgod Apocalypse',
            listenedMs: 534000,
            plays: 2,
            firstPlayedMs: now - 2 * day,
            lastPlayedMs: now - 1 * day,
        });
        expect(top[1].subtitle).toEqual('Fleshgod Apocalypse, Guest');
    });

    it('should limit top lists', () => {
        expect(repository.getTopTracks(0, 1).length).toEqual(1);
    });

    it('should rank albums by listening time', () => {
        const top = repository.getTopAlbums(0, 10);

        expect(top.map((x) => x.title)).toEqual(['Oracles', 'Other']);
        expect(top[0].listenedMs).toEqual(554000);
        expect(top[0].plays).toEqual(2);
        expect(top[0].subtitle).toEqual('Fleshgod Apocalypse');
    });

    it('should split multiple artists and add up per artist', () => {
        const top = repository.getTopArtists(0, 10);

        expect(top.map((x) => x.title)).toEqual(['Fleshgod Apocalypse', 'Guest']);
        expect(top[0].listenedMs).toEqual(754000);
        expect(top[0].plays).toEqual(3);
        expect(top[1].listenedMs).toEqual(200000);
    });

    it('should return history newest first with paging', () => {
        const page1 = repository.getHistory(0, 2, 0);
        const page2 = repository.getHistory(0, 2, 2);

        expect(page1.map((x) => x.startedAtMs)).toEqual([now - 1 * day, now - 2 * day]);
        expect(page2.length).toEqual(2);
        expect(page2[1].trackTitle).toEqual('Duet');
    });

    describe('detailed statistics', () => {
        function segment(fromMs: number, toMs: number, startedAtMs: number = now): ListeningSegment {
            return { listeningSegmentId: 0, listeningSessionId: 0, startedAtMs, fromMs, toMs };
        }

        function played(path: string, endReason: number | null, furthestMs: number, durationMs: number = 300000, startedAtMs: number = now): number {
            const s: ListeningSession = session(path, 'T ' + path, ';A;', 'Album', 'album', startedAtMs, 1000, false);
            s.trackDurationMs = durationMs;
            const id: number = repository.addSession(s);
            repository.updateListened(id, 1000, false, { endReason, furthestPositionMs: furthestMs });
            return id;
        }

        it('should keep end reason and furthest position empty when no details are given', () => {
            const id: number = repository.addSession(session('/m/y.flac', 'Y', ';A;', 'Album', 'album', now, 0, false));
            repository.updateListened(id, 5000, false);

            const h: ListeningSession = repository.getHistory(now, 1, 0)[0];
            expect(h.endReason).toBeNull();
            expect(h.furthestPositionMs).toBeNull();
        });

        it('should store end reason and furthest position', () => {
            played('/m/y.flac', ListeningEndReason.skipped, 45000.4);

            const h: ListeningSession = repository.getHistory(now, 1, 0)[0];
            expect(h.endReason).toEqual(ListeningEndReason.skipped);
            expect(h.furthestPositionMs).toEqual(45000);
        });

        it('should store and return heard parts per play, in order', () => {
            const a: number = played('/m/a.flac', ListeningEndReason.completed, 300000);
            const b: number = played('/m/b.flac', ListeningEndReason.skipped, 10000);
            repository.addSegments(a, [segment(0, 60000, now), segment(120000, 300000, now + 70000)]);
            repository.addSegments(b, [segment(0, 10000)]);

            const parts: Map<number, ListeningSegment[]> = repository.getSegments([a, b, 999999]);

            expect(parts.get(a)!.map((x) => [x.fromMs, x.toMs])).toEqual([
                [0, 60000],
                [120000, 300000],
            ]);
            expect(parts.get(b)!.length).toEqual(1);
            expect(parts.has(999999)).toBe(false);
        });

        it('should delete heard parts with their play, and with the whole history', () => {
            const a: number = played('/m/a.flac', ListeningEndReason.completed, 300000);
            const b: number = played('/m/b.flac', ListeningEndReason.completed, 300000);
            repository.addSegments(a, [segment(0, 1000)]);
            repository.addSegments(b, [segment(0, 1000)]);

            repository.deleteSession(a);
            expect(database.prepare('SELECT COUNT(*) AS n FROM ListeningSegment').get().n).toEqual(1);

            repository.deleteAllSessions();
            expect(database.prepare('SELECT COUNT(*) AS n FROM ListeningSegment').get().n).toEqual(0);
        });

        it('should summarize how plays ended, ignoring plays without details', () => {
            played('/m/a.flac', ListeningEndReason.completed, 300000);
            played('/m/b.flac', ListeningEndReason.skipped, 75000);
            played('/m/c.flac', ListeningEndReason.stopped, 150000);

            const summary = repository.getEndSummary(now);

            expect(summary).toEqual({ completed: 1, skipped: 1, stopped: 1, averageCompletion: (1 + 0.25 + 0.5) / 3 });
            expect(repository.getEndSummary(0).completed).toEqual(1); // the 4 sessions of beforeEach have no details
        });

        it('should rank the most skipped tracks and the tracks always finished', () => {
            for (let i = 0; i < 3; i++) played('/m/skipped.flac', ListeningEndReason.skipped, 5000);
            played('/m/skipped.flac', ListeningEndReason.completed, 300000);
            for (let i = 0; i < 4; i++) played('/m/loved.flac', ListeningEndReason.completed, 300000);
            played('/m/once.flac', ListeningEndReason.completed, 300000);

            const skipped = repository.getMostSkipped(0, 10);
            const finished = repository.getAlwaysFinished(0, 10);

            expect(skipped.map((x) => [x.key, x.skipped, x.sessions])).toEqual([['/m/skipped.flac', 3, 4]]);
            expect(finished.map((x) => [x.key, x.completed])).toEqual([['/m/loved.flac', 4]]); // once is not "always"
        });

        it('should return first and last played over the whole history, not only the period', () => {
            const top = repository.getTopTracks(now - 1 * day, 10);
            const albums = repository.getTopAlbums(now - 1 * day, 10);
            const artists = repository.getTopArtists(now - 1 * day, 10);

            expect(top[0]).toEqual(expect.objectContaining({ key: '/m/oracles.flac|1', firstPlayedMs: now - 2 * day, lastPlayedMs: now - 1 * day }));
            expect(albums[0]).toEqual(expect.objectContaining({ key: 'oracles', firstPlayedMs: now - 2 * day, lastPlayedMs: now - 1 * day }));
            expect(artists[0]).toEqual(expect.objectContaining({ title: 'Fleshgod Apocalypse', firstPlayedMs: now - 40 * day, lastPlayedMs: now - 1 * day }));
        });

        it('should return listening times of the period without empty plays', () => {
            repository.addSession(session('/m/z.flac', 'Z', ';A;', 'Album', 'album', now, 0, false));

            const times = repository.getListeningTimes(now - 3 * day);

            expect(times.map((x) => x.listenedMs).sort()).toEqual([20000, 267000, 267000]);
        });

        it('should return days with at least the minimum listening time, oldest first', () => {
            const days: string[] = repository.getActiveDays(60000);

            expect(days.length).toEqual(3); // -40, -2 (267000 + 20000) and -1 days
            expect(days).toEqual([...days].sort());
            expect(repository.getActiveDays(300000)).toEqual([]);
        });

        // Trying to break it.

        it('should handle empty, invalid and huge id lists when reading heard parts', () => {
            const a: number = played('/m/a.flac', ListeningEndReason.completed, 300000);
            repository.addSegments(a, [segment(0, 1000)]);
            const many: number[] = Array.from({ length: 5000 }, (_, i) => i + 100000);

            expect(repository.getSegments([]).size).toEqual(0);
            expect(repository.getSegments([NaN, 1.5, Infinity] as number[]).size).toEqual(0);
            expect(repository.getSegments([...many, a]).get(a)!.length).toEqual(1);
        });

        it('should not store parts with invalid numbers, and keep the valid ones', () => {
            const a: number = played('/m/a.flac', ListeningEndReason.completed, 300000);
            const garbage: any[] = [
                { ...segment(0, 1000), fromMs: { not: 'a number' } },
                { ...segment(0, 1000), toMs: NaN },
                { ...segment(0, 1000), startedAtMs: Infinity },
                { ...segment(0, 1000), fromMs: '5' },
                segment(5000, 5000),
                segment(9000, 1000),
            ];

            repository.addSegments(a, [segment(0, 1000), ...garbage, segment(2000, 3000)]);
            repository.addSegments(a, []);

            expect(repository.getSegments([a]).get(a)!.map((x) => [x.fromMs, x.toMs])).toEqual([
                [0, 1000],
                [2000, 3000],
            ]);
        });

        it('should write all parts of a batch or none when writing fails half way', () => {
            const a: number = played('/m/a.flac', ListeningEndReason.completed, 300000);
            const realPrepare = database.prepare.bind(database);
            let inserts: number = 0;
            jest.spyOn(database, 'prepare').mockImplementation((sql: any) => {
                const statement = realPrepare(sql);
                if (String(sql).startsWith('INSERT INTO ListeningSegment')) {
                    const run = statement.run.bind(statement);
                    return { run: (...args: any[]) => (++inserts === 2 ? (() => { throw new Error('disk full'); })() : run(...args)) };
                }
                return statement;
            });

            expect(() => repository.addSegments(a, [segment(0, 1000), segment(1000, 2000), segment(2000, 3000)])).toThrow('disk full');
            (database.prepare as jest.Mock).mockRestore();

            expect(repository.getSegments([a]).size).toEqual(0);
        });

        it('should store many parts of one play', () => {
            const a: number = played('/m/a.flac', ListeningEndReason.completed, 300000);
            const parts: ListeningSegment[] = Array.from({ length: 3000 }, (_, i) => segment(i * 100, i * 100 + 50, now + i));

            repository.addSegments(a, parts);

            expect(repository.getSegments([a]).get(a)!.length).toEqual(3000);
        });

        it('should keep odd text intact (quotes, SQL, emoji, very long titles)', () => {
            const odd: string = `Robert'); DROP TABLE ListeningSession;-- "quoted" 🎵 ${'x'.repeat(20000)}`;
            // Artist names cannot contain ';': it separates artists in the stored format (as everywhere in Dopamine).
            const oddArtist: string = `Robert') DROP TABLE "x" 🎵 ${'y'.repeat(20000)}`;
            const id: number = repository.addSession(session(odd, odd, `;${oddArtist};`, odd, odd, now, 1000, true));
            repository.updateListened(id, 1000, true, { endReason: ListeningEndReason.completed, furthestPositionMs: 1 });

            // Compared as booleans so a failure does not print 20000 characters.
            expect(repository.getHistory(now, 1, 0)[0].trackTitle === odd).toBe(true);
            expect(repository.getTopTracks(now, 1)[0].title === odd).toBe(true);
            expect(repository.getTopArtists(now, 1)[0].title === oddArtist).toBe(true);
            expect(repository.getAlwaysFinished(0, 10)).toEqual([]);
            expect(database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ListeningSession'").get().n).toEqual(1);
        });

        it('should keep completion between 0 and 1 for odd positions and lengths', () => {
            played('/m/past-end.flac', ListeningEndReason.completed, 900000, 300000);
            played('/m/negative.flac', ListeningEndReason.skipped, -5000, 300000);
            played('/m/no-length.flac', ListeningEndReason.completed, 5000, 0);

            const summary = repository.getEndSummary(now);

            expect(summary.averageCompletion).toEqual(0.5); // (1 + 0) / 2: the track without a length is left out
            expect(summary.completed).toEqual(2);
        });

        it('should ignore artists that are empty or only spaces', () => {
            repository.addSession(session('/m/e.flac', 'E', ';;;   ;', 'Album', 'album', now, 999999, true));

            expect(repository.getTopArtists(now, 10)).toEqual([]);
        });
    });
});
