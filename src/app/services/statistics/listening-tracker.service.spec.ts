import { Subject } from 'rxjs';
import { ListeningTrackerService } from './listening-tracker.service';
import { ListeningSession } from '../../data/entities/listening-session';
import {
    ListeningDetails,
    ListeningEndSummary,
    ListeningSessionRepositoryBase,
    ListeningSkipTotal,
    ListeningSummary,
    ListeningTimeEntry,
    ListeningTotal,
} from '../../data/repositories/listening-session-repository.base';
import { ListeningSegment } from '../../data/entities/listening-segment';
import { ListeningEndReason } from '../../data/entities/listening-end-reason';
import { PlaybackProgress } from '../playback/playback-progress';
import { SettingsMock } from '../../testing/settings-mock';
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
            this.failedWrites++;
            throw new Error('database is locked');
        }
    }

    public addSession(session: ListeningSession): number {
        this.throwIfLocked();
        const id: number = this.nextId++;
        this.sessions.set(id, { ...session, listeningSessionId: id });
        return id;
    }
    public segments: Map<number, ListeningSegment[]> = new Map();
    public segmentsAdded: number = 0;
    public failedWrites: number = 0;
    public updateListened(id: number, listenedMs: number, isCountedAsPlay: boolean, details?: ListeningDetails): void {
        this.throwIfLocked();
        const s: ListeningSession = this.sessions.get(id)!;
        s.listenedMs = listenedMs;
        s.isCountedAsPlay = isCountedAsPlay ? 1 : 0;
        if (details != undefined) {
            s.endReason = details.endReason;
            s.furthestPositionMs = details.furthestPositionMs;
        }
    }
    public addSegments(id: number, segments: ListeningSegment[]): void {
        this.throwIfLocked();
        this.segmentsAdded += segments.length;
        if (segments.length > 0) {
            this.segments.set(id, [...(this.segments.get(id) ?? []), ...segments]);
        }
    }
    public getSegments(): Map<number, ListeningSegment[]> {
        throw new Error('not used');
    }
    public deleteSession(id: number): void {
        this.throwIfLocked();
        this.sessions.delete(id);
        this.segments.delete(id);
    }
    public deleteAllSessions(): number {
        const count: number = this.sessions.size;
        this.sessions.clear();
        this.segments.clear();
        return count;
    }
    public getEndSummary(): ListeningEndSummary {
        throw new Error('not used');
    }
    public getMostSkipped(): ListeningSkipTotal[] {
        throw new Error('not used');
    }
    public getAlwaysFinished(): ListeningSkipTotal[] {
        throw new Error('not used');
    }
    public getListeningTimes(): ListeningTimeEntry[] {
        throw new Error('not used');
    }
    public getActiveDays(): string[] {
        throw new Error('not used');
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
    let progress: Subject<PlaybackProgress>;
    let seeked: Subject<void>;
    let positionSeconds: number;
    let settings: SettingsMock;

    // Plays for the given time, reporting progress every 500 ms like PlaybackService.
    function play(forMs: number): void {
        for (let t = 0; t < forMs; t += 500) {
            now += 500;
            positionSeconds += 0.5;
            progress.next(new PlaybackProgress(positionSeconds, 240));
            jest.advanceTimersByTime(500);
        }
    }

    function seekTo(seconds: number): void {
        positionSeconds = seconds;
        seeked.next();
    }

    function startTrack(path: string, durationMs: number): void {
        positionSeconds = 0;
        started.next(new PlaybackStarted(track(path, durationMs), false));
    }

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
        progress = new Subject();
        seeked = new Subject();
        positionSeconds = 0;
        settings = new SettingsMock();
        now = 1_000_000;
        repository = new FakeRepository();

        const playbackService = {
            playbackStarted$: started.asObservable(),
            playbackPaused$: paused.asObservable(),
            playbackResumed$: resumed.asObservable(),
            playbackStopped$: stopped.asObservable(),
            progressChanged$: progress.asObservable(),
            playbackSkipped$: seeked.asObservable(),
            get progress(): PlaybackProgress {
                return new PlaybackProgress(positionSeconds, 240);
            },
        } as unknown as PlaybackService;
        const ipcProxy = { onApplicationClose$: appClose.asObservable() } as unknown as IpcProxyBase;
        const dateProxy = { now: (): number => now } as DateProxy;
        warnings = 0;
        const logger = { error: (): void => {}, info: (): void => {}, warn: (): number => warnings++ } as unknown as Logger;

        tracker = new ListeningTrackerService(playbackService, repository, ipcProxy, dateProxy, logger, settings);
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

    describe('detailed statistics', () => {
        function partsOf(path: string): number[][] {
            const session = Array.from(repository.sessions.values()).find((x) => x.trackPath === path)!;
            return (repository.segments.get(session.listeningSessionId) ?? []).map((x) => [x.fromMs, x.toMs]);
        }

        function sessionOf(path: string): ListeningSession {
            return Array.from(repository.sessions.values()).find((x) => x.trackPath === path)!;
        }

        it('should record nothing extra when detailed statistics are off', () => {
            startTrack('/m/a.flac', 4 * minute);
            play(60000);
            startTrack('/m/b.flac', 4 * minute);

            expect(sessionOf('/m/a.flac').endReason).toBeNull();
            expect(repository.segments.size).toEqual(0);
        });

        it('should record a completed play with its heard part', () => {
            settings.detailedListeningStatistics = true;
            startTrack('/m/a.flac', 4 * minute);
            play(4 * minute);
            startTrack('/m/b.flac', 4 * minute);

            expect(sessionOf('/m/a.flac').endReason).toEqual(ListeningEndReason.completed);
            expect(sessionOf('/m/a.flac').furthestPositionMs).toEqual(4 * minute);
            expect(partsOf('/m/a.flac')).toEqual([[0, 4 * minute]]);
        });

        it('should record skips, stops and seeks', () => {
            settings.detailedListeningStatistics = true;
            startTrack('/m/a.flac', 4 * minute);
            play(30000);
            seekTo(120);
            play(10000);
            startTrack('/m/b.flac', 4 * minute);
            play(20000);
            paused.next();
            now += 10 * minute;
            resumed.next();
            play(5000);
            stopped.next();

            expect(sessionOf('/m/a.flac').endReason).toEqual(ListeningEndReason.skipped);
            expect(partsOf('/m/a.flac')).toEqual([
                [0, 30000],
                [120000, 130000],
            ]);
            expect(sessionOf('/m/b.flac').endReason).toEqual(ListeningEndReason.stopped);
            expect(partsOf('/m/b.flac')).toEqual([
                [0, 20000],
                [20000, 25000],
            ]);
            expect(sessionOf('/m/b.flac').listenedMs).toEqual(25000);
        });

        it('should save heard parts with the periodic saves, without writing them twice', () => {
            settings.detailedListeningStatistics = true;
            startTrack('/m/a.flac', 4 * minute);
            play(20000);
            seekTo(100);
            play(40000); // includes at least two periodic saves
            stopped.next();

            expect(partsOf('/m/a.flac')).toEqual([
                [0, 20000],
                [100000, 140000],
            ]);
        });

        it('should keep heard parts while the database is locked and write them once afterwards', () => {
            settings.detailedListeningStatistics = true;
            startTrack('/m/a.flac', 4 * minute);
            play(10000);
            repository.isLocked = true;
            seekTo(60);
            play(10000);
            seekTo(200);
            play(40000);
            startTrack('/m/b.flac', 4 * minute);
            repository.isLocked = false;
            play(16000);

            expect(sessionOf('/m/a.flac').endReason).toEqual(ListeningEndReason.completed);
            expect(partsOf('/m/a.flac')).toEqual([
                [0, 10000],
                [60000, 70000],
                [200000, 240000],
            ]);
        });

        it('should stop recording details when turned off during a song, and start with the next song when turned on', () => {
            settings.detailedListeningStatistics = true;
            startTrack('/m/a.flac', 4 * minute);
            play(10000);
            settings.detailedListeningStatistics = false;
            play(10000);
            startTrack('/m/b.flac', 4 * minute);
            settings.detailedListeningStatistics = true;
            play(10000);
            startTrack('/m/c.flac', 4 * minute);

            expect(sessionOf('/m/a.flac').endReason).toBeNull();
            expect(sessionOf('/m/b.flac').endReason).toBeNull();
            expect(sessionOf('/m/c.flac')).toBeDefined();
            expect(repository.segments.size).toEqual(0);
            play(10000);
            stopped.next();
            expect(partsOf('/m/c.flac')).toEqual([[0, 10000]]);
        });

        it('should drop a too short play together with its heard parts', () => {
            settings.detailedListeningStatistics = true;
            startTrack('/m/a.flac', 4 * minute);
            jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);
            now += 400;
            stopped.next();

            expect(repository.sessions.size).toEqual(0);
            expect(repository.segments.size).toEqual(0);
        });

        // Trying to break it: thousands of random events, then check that nothing crashed and the data makes sense.
        it.each([1, 2, 3, 4, 5])('should survive random chaos (seed %i)', (seed: number) => {
            let state: number = seed * 2654435761;
            const random = (): number => {
                state = (state * 1103515245 + 12345) % 2147483648;
                return state / 2147483648;
            };
            const durations: number[] = [0, 1, 500, 3 * minute, 4 * minute, 60 * minute];
            const garbage: unknown[] = [NaN, -50, 1e12, Infinity, undefined];
            const startedAt: number = now;

            expect(() => {
                for (let i = 0; i < 3000; i++) {
                    const r: number = random();
                    if (r < 0.1) startTrack(`/m/${Math.floor(random() * 8)}.flac`, durations[Math.floor(random() * durations.length)]);
                    else if (r < 0.15) paused.next();
                    else if (r < 0.2) resumed.next();
                    else if (r < 0.25) seekTo(random() * 400);
                    else if (r < 0.28) {
                        positionSeconds = garbage[Math.floor(random() * garbage.length)] as number;
                        seeked.next();
                    } else if (r < 0.31) stopped.next();
                    else if (r < 0.34) settings.detailedListeningStatistics = !settings.detailedListeningStatistics;
                    else if (r < 0.4) repository.isLocked = !repository.isLocked;
                    else if (r < 0.41) appClose.next();
                    else if (r < 0.415 && !repository.isLocked) tracker.clearHistory();
                    else if (r < 0.42) progress.next(new PlaybackProgress(garbage[Math.floor(random() * garbage.length)] as number, 0));
                    else play(500 + Math.floor(random() * 5000));
                }
                repository.isLocked = false;
                stopped.next();
                jest.advanceTimersByTime(ListeningTrackerService.saveIntervalMs);
            }).not.toThrow();

            const elapsed: number = now - startedAt;
            let total: number = 0;
            for (const session of repository.sessions.values()) {
                expect(Number.isFinite(session.listenedMs) && session.listenedMs >= 0).toBe(true);
                total += session.listenedMs;
                if (session.endReason != null) {
                    expect([ListeningEndReason.completed, ListeningEndReason.skipped, ListeningEndReason.stopped]).toContain(session.endReason);
                }
            }
            expect(total).toBeLessThanOrEqual(elapsed);
            // The run must really have exercised detailed recording and locked writes.
            expect(repository.segmentsAdded).toBeGreaterThan(10);
            expect(repository.failedWrites).toBeGreaterThan(10);
            for (const [id, parts] of repository.segments) {
                expect(repository.sessions.has(id)).toBe(true);
                const duration: number = repository.sessions.get(id)!.trackDurationMs;
                for (const part of parts) {
                    expect(Number.isFinite(part.fromMs) && Number.isFinite(part.toMs) && part.toMs > part.fromMs && part.fromMs >= 0).toBe(true);
                    if (duration > 0) expect(part.toMs).toBeLessThanOrEqual(duration);
                }
            }
        });
    });
});
