import Database from 'better-sqlite3';
import { DatabaseFactory } from '../database-factory';
import { Migration16 } from '../migrations/migration16';
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
        const migration: Migration16 = new Migration16();
        migration.up();
        database.exec(migration.statements.join('\n'));
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
        expect(top[0]).toEqual({ key: '/m/oracles.flac|1', title: 'In Honour Of Reason', subtitle: 'Fleshgod Apocalypse', listenedMs: 534000, plays: 2 });
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
});
