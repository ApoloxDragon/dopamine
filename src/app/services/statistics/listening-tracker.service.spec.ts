import { Subject } from 'rxjs';
import { ListeningTrackerService } from './listening-tracker.service';
import { ListeningSession } from '../../data/entities/listening-session';
import { ListeningSessionRepositoryBase, ListeningSummary, ListeningTotal } from '../../data/repositories/listening-session-repository.base';
import { PlaybackService } from '../playback/playback.service';
import { PlaybackStarted } from '../playback/playback-started';
import { TrackModel } from '../track/track-model';
import { IpcProxyBase } from '../../common/io/ipc-proxy.base';
import { DateProxy } from '../../common/io/date-proxy';
import { Logger } from '../../common/logger';

class FakeRepository implements ListeningSessionRepositoryBase {
    public sessions: Map<number, ListeningSession> = new Map();
    /** Simulates the indexing worker keeping the database busy. */
    public isLocked: boolean = false;
    private nextId: number = 1;

    private throwIfLocked(): void {
        if (this.isLocked) {
            throw new Error('database is locked');
        }
    }

    public addSession(session: ListeningSession): number {
        this.throwIfLocked();
        const id: number = this.nextId++;
        this.sessions.set(id, { ...session, listeningSessionId: id });
        return id;
    }
    public updateListened(id: number, listenedMs: number, isCountedAsPlay: boolean): void {
        this.throwIfLocked();
        const s: ListeningSession = this.sessions.get(id)!;
        s.listenedMs = listenedMs;
        s.isCountedAsPlay = isCountedAsPlay ? 1 : 0;
    }
    public deleteSession(id: number): void {
        this.throwIfLocked();
        this.sessions.delete(id);
    }
    public deleteAllSessions(): number {
        const count: number = this.sessions.size;
        this.sessions.clear();
        return count;
    }
    public getSummary(): ListeningSummary {
        throw new Error('not used');
    }
    public getTopTracks(): ListeningTotal[] {
        throw new Error('not used');
    }
    public getTopAlbums(): ListeningTotal[] {
        throw new Error('not used');
    }
    public getTopArtists(): ListeningTotal[] {
        throw new Error('not used');
    }
    public getHistory(): ListeningSession[] {
        throw new Error('not used');
    }
}

function track(path: string, durationMs: number): TrackModel {
    return {
        path,
        rawTitle: 'Title ' + path,
        fileName: 'file.flac',
        rawArtists: ['Artist A', 'Artist B'],
        rawAlbumTitle: 'Album',
        rawFirstAlbumArtist: 'Album Artist',
        albumKey: 'album-key',
        durationInMilliseconds: durationMs,
    } as unknown as TrackModel;
}

describe('ListeningTrackerService', () => {
    let started: Subject<PlaybackStarted>;
    let paused: Subject<void>;
    let resumed: Subject<void>;
    let stopped: Subject<void>;
    let appClose: Subject<void>;
    let now: number;
    let repository: FakeRepository;
    let tracker: ListeningTrackerService;
    let warnings: number;

    const minute: number = 60000;

    function only(): ListeningSession {
        expect(repository.sessions.size).toEqual(1);
        return Array.from(repository.sessions.values())[0];
    }

    beforeEach(() => {
        jest.useFakeTimers();
        started = new Subject();
        paused = new Subject();
        resumed = new Subject();
        stopped = new Subject();
        appClose = new Subject();
        now = 1_000_000;
        repository = new FakeRepository();

        const playbackService = {
            playbackStarted$: started.asObservable(),
            playbackPaused$: paused.asObservable(),
            playbackResumed$: resumed.asObservable(),
            playbackStopped$: stopped.asObservable(),
        } as unknown as PlaybackService;
        const ipcProxy = { onApplicationClose$: appClose.asObservable() } as unknown as IpcProxyBase;
        const dateProxy = { now: (): number => now } as DateProxy;
        warnings = 0;
        const logger = { error: (): void => {}, info: (): void => {}, warn: (): number => warnings++ } as unknown as Logger;

        tracker = new ListeningTrackerService(playbackService, repository, ipcProxy, dateProxy, logger);
        tracker.initialize();
    });

    afterEach(() => {
        tracker.dispose();
        jest.useRealTimers();
    });

    it('should record a snapshot of the track when playback starts', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));

        const s: ListeningSession = only();
        expect(s.trackPath).toEqual('/m/a.flac');
        expect(s.trackTitle).toEqual('Title /m/a.flac');
        expect(s.artists).toEqual(';Artist A;;Artist B;');
        expect(s.albumTitle).toEqual('Album');
        expect(s.albumArtists).toEqual(';Album Artist;');
        expect(s.albumKey).toEqual('album-key');
        expect(s.startedAtMs).toEqual(1_000_000);
        expect(s.trackDurationMs).toEqual(4 * minute);
    });

    it('should count the time played until the next track starts', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
        now += 3 * minute;
        started.next(new PlaybackStarted(track('/m/b.flac', 4 * minute), false));

        const first: ListeningSession = repository.sessions.get(1)!;
        expect(first.listenedMs).toEqual(3 * minute);
        expect(first.isCountedAsPlay).toEqual(1);
        expect(repository.sessions.size).toEqual(2);
    });

    it('should not count paused time', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 10 * minute), false));
        now += 1 * minute;
        paused.next();
        now += 30 * minute;
        resumed.next();
        now += 2 * minute;
        stopped.next();

        expect(only().listenedMs).toEqual(3 * minute);
    });

    it('should keep counting across periodic saves', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 10 * minute), false));

        for (let i = 0; i < 4; i++) {
            now += ListeningTrackerService.saveIntervalMs;
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);
        }

        // Saved while still playing
        expect(only().listenedMs).toEqual(4 * ListeningTrackerService.saveIntervalMs);

        now += 5000;
        stopped.next();

        expect(only().listenedMs).toEqual(4 * ListeningTrackerService.saveIntervalMs + 5000);
    });

    it('should not count a play below half the track', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
        now += 1 * minute;
        stopped.next();

        expect(only().isCountedAsPlay).toEqual(0);
    });

    it('should count a play after 4 minutes of a long track', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 20 * minute), false));
        now += 4 * minute;
        stopped.next();

        expect(only().isCountedAsPlay).toEqual(1);
    });

    it('should drop sessions shorter than one second', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
        now += 500;
        started.next(new PlaybackStarted(track('/m/b.flac', 4 * minute), false));

        expect(Array.from(repository.sessions.values()).map((x) => x.trackPath)).toEqual(['/m/b.flac']);
    });

    it('should save the running session when the app closes', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
        now += 2 * minute;
        appClose.next();

        expect(only().listenedMs).toEqual(2 * minute);
        expect(only().isCountedAsPlay).toEqual(1);
    });

    it('should ignore pause and resume without a session', () => {
        paused.next();
        resumed.next();
        stopped.next();

        expect(repository.sessions.size).toEqual(0);
    });

    it('should clear the history and keep recording the playing song from now', () => {
        started.next(new PlaybackStarted(track('/m/old.flac', 4 * minute), false));
        now += 3 * minute;
        started.next(new PlaybackStarted(track('/m/a.flac', 10 * minute), false));
        now += 2 * minute;

        const deleted: number = tracker.clearHistory();
        now += 1 * minute;
        stopped.next();

        expect(deleted).toEqual(2);
        const s: ListeningSession = only();
        expect(s.trackPath).toEqual('/m/a.flac');
        expect(s.listenedMs).toEqual(1 * minute);
        expect(s.startedAtMs).toEqual(1_000_000 + 5 * minute);
    });

    it('should keep a paused song paused after clearing', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 10 * minute), false));
        now += 1 * minute;
        paused.next();
        tracker.clearHistory();
        now += 5 * minute;
        resumed.next();
        now += 2 * minute;
        stopped.next();

        expect(only().listenedMs).toEqual(2 * minute);
    });

    it('should clear the history when nothing is playing', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
        now += 3 * minute;
        stopped.next();

        expect(tracker.clearHistory()).toEqual(1);
        expect(repository.sessions.size).toEqual(0);
    });

    it('should not double count when resumed twice', () => {
        started.next(new PlaybackStarted(track('/m/a.flac', 10 * minute), false));
        now += 1 * minute;
        resumed.next();
        now += 1 * minute;
        stopped.next();

        expect(only().listenedMs).toEqual(2 * minute);
    });

    describe('while the database is locked (collection being indexed)', () => {
        it('should still record a song that starts while locked', () => {
            repository.isLocked = true;
            started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
            now += 30000;
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);
            expect(repository.sessions.size).toEqual(0);

            repository.isLocked = false;
            now += 30000;
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);

            const s: ListeningSession = only();
            expect(s.trackPath).toEqual('/m/a.flac');
            expect(s.listenedMs).toEqual(60000);
        });

        it('should not lose a song that ends while locked', () => {
            started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
            repository.isLocked = true;
            now += 3 * minute;
            started.next(new PlaybackStarted(track('/m/b.flac', 4 * minute), false));
            expect(repository.sessions.get(1)!.listenedMs).toEqual(0);

            repository.isLocked = false;
            now += minute;
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);

            const first: ListeningSession = repository.sessions.get(1)!;
            expect(first.listenedMs).toEqual(3 * minute);
            expect(first.isCountedAsPlay).toEqual(1);
            const second: ListeningSession = Array.from(repository.sessions.values()).find((x) => x.trackPath === '/m/b.flac')!;
            expect(second.listenedMs).toEqual(minute);
        });

        it('should still drop a too short session that ends while locked', () => {
            started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
            repository.isLocked = true;
            now += 500;
            stopped.next();

            repository.isLocked = false;
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);

            expect(repository.sessions.size).toEqual(0);
        });

        it('should warn once per period of failures, not at every retry', () => {
            started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
            repository.isLocked = true;
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs * 4);
            expect(warnings).toEqual(1);

            repository.isLocked = false;
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);
            repository.isLocked = true;
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);
            expect(warnings).toEqual(2);
        });

        it('should not write waiting sessions back after the history is cleared', () => {
            started.next(new PlaybackStarted(track('/m/a.flac', 4 * minute), false));
            repository.isLocked = true;
            now += 3 * minute;
            stopped.next();

            repository.isLocked = false;
            tracker.clearHistory();
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);

            expect(repository.sessions.size).toEqual(0);
        });
    });
});
