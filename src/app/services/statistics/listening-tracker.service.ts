import { Injectable } from '@angular/core';
import { Subscription } from 'rxjs';
import { DateProxy } from '../../common/io/date-proxy';
import { IpcProxyBase } from '../../common/io/ipc-proxy.base';
import { Logger } from '../../common/logger';
import { ListeningSession } from '../../data/entities/listening-session';
import { ListeningSessionRepositoryBase } from '../../data/repositories/listening-session-repository.base';
import { PlaybackService } from '../playback/playback.service';
import { PlaybackStarted } from '../playback/playback-started';
import { TrackModel } from '../track/track-model';

interface CurrentSession {
    id: number;
    durationMs: number;
    listenedMs: number;
    /** Wall clock time playback (re)started, undefined while paused. */
    playingSinceMs: number | undefined;
}

/**
 * Records what is listened to, for the Statistics page. Everything stays in the local database.
 *
 * Only time that is actually playing counts (pauses do not, seeking does not add time). A session counts as a play
 * when at least half of the track, or 4 minutes, was listened to (the same rule Last.fm uses for scrobbles).
 * Sessions shorter than 1 second are not kept. Progress is saved every 15 seconds and when the app closes.
 */
@Injectable({ providedIn: 'root' })
export class ListeningTrackerService {
    public static readonly saveIntervalMs: number = 15000;
    public static readonly minimumListenedMs: number = 1000;
    public static readonly playThresholdMs: number = 4 * 60 * 1000;

    private subscription: Subscription | undefined;
    private saveIntervalId: ReturnType<typeof setInterval> | undefined;
    private current: CurrentSession | undefined;

    public constructor(
        private playbackService: PlaybackService,
        private repository: ListeningSessionRepositoryBase,
        private ipcProxy: IpcProxyBase,
        private dateProxy: DateProxy,
        private logger: Logger,
    ) {}

    public initialize(): void {
        if (this.subscription != undefined) {
            return;
        }

        this.subscription = new Subscription();
        this.subscription.add(this.playbackService.playbackStarted$.subscribe((started: PlaybackStarted) => this.start(started.currentTrack)));
        this.subscription.add(this.playbackService.playbackPaused$.subscribe(() => this.pause()));
        this.subscription.add(this.playbackService.playbackResumed$.subscribe(() => this.resume()));
        this.subscription.add(this.playbackService.playbackStopped$.subscribe(() => this.finish()));
        this.subscription.add(this.ipcProxy.onApplicationClose$.subscribe(() => this.finish()));

        this.saveIntervalId = setInterval(() => this.save(), ListeningTrackerService.saveIntervalMs);
    }

    public dispose(): void {
        this.finish();
        this.subscription?.unsubscribe();
        this.subscription = undefined;

        if (this.saveIntervalId != undefined) {
            clearInterval(this.saveIntervalId);
            this.saveIntervalId = undefined;
        }
    }

    /** Ends the current session and saves it. Public so it can be called when the app closes. */
    public finish(): void {
        if (this.current == undefined) {
            return;
        }

        const session: CurrentSession = this.current;
        this.current = undefined;
        this.accumulate(session);

        try {
            if (session.listenedMs < ListeningTrackerService.minimumListenedMs) {
                this.repository.deleteSession(session.id);
            } else {
                this.repository.updateListened(session.id, session.listenedMs, this.isCountedAsPlay(session));
            }
        } catch (e: unknown) {
            this.logger.error(e, 'Could not save listening session', 'ListeningTrackerService', 'finish');
        }
    }

    private start(track: TrackModel): void {
        // A new track (also after a gapless transition) ends the session of the previous one.
        this.finish();

        const session: ListeningSession = new ListeningSession();
        session.trackPath = track.path;
        session.trackTitle = track.rawTitle.length > 0 ? track.rawTitle : track.fileName;
        session.artists = track.rawArtists.length > 0 ? `;${track.rawArtists.join(';;')};` : '';
        session.albumTitle = track.rawAlbumTitle;
        session.albumArtists = track.rawFirstAlbumArtist.length > 0 ? `;${track.rawFirstAlbumArtist};` : '';
        session.albumKey = track.albumKey;
        session.startedAtMs = this.dateProxy.now();
        session.trackDurationMs = track.durationInMilliseconds;

        try {
            const id: number = this.repository.addSession(session);
            this.current = { id, durationMs: track.durationInMilliseconds, listenedMs: 0, playingSinceMs: this.dateProxy.now() };
        } catch (e: unknown) {
            this.logger.error(e, 'Could not start listening session', 'ListeningTrackerService', 'start');
        }
    }

    private pause(): void {
        if (this.current == undefined) {
            return;
        }

        this.accumulate(this.current);
        this.current.playingSinceMs = undefined;
        this.save();
    }

    private resume(): void {
        if (this.current != undefined && this.current.playingSinceMs == undefined) {
            this.current.playingSinceMs = this.dateProxy.now();
        }
    }

    /** Saves progress of the running session without ending it (protects against crashes). */
    private save(): void {
        if (this.current == undefined) {
            return;
        }

        const isPlaying: boolean = this.current.playingSinceMs != undefined;
        this.accumulate(this.current);

        if (isPlaying) {
            // Keep counting from now: the time up to now has just been added.
            this.current.playingSinceMs = this.dateProxy.now();
        }

        try {
            this.repository.updateListened(this.current.id, this.current.listenedMs, this.isCountedAsPlay(this.current));
        } catch (e: unknown) {
            this.logger.error(e, 'Could not save listening session', 'ListeningTrackerService', 'save');
        }
    }

    private accumulate(session: CurrentSession): void {
        if (session.playingSinceMs != undefined) {
            session.listenedMs += Math.max(0, this.dateProxy.now() - session.playingSinceMs);
            session.playingSinceMs = undefined;
        }
    }

    private isCountedAsPlay(session: CurrentSession): boolean {
        const half: number = session.durationMs > 0 ? session.durationMs / 2 : ListeningTrackerService.playThresholdMs;
        return session.listenedMs >= Math.min(half, ListeningTrackerService.playThresholdMs);
    }
}
