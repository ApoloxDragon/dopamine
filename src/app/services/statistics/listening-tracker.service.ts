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
import { SettingsBase } from '../../common/settings/settings.base';
import { PlaybackProgress } from '../playback/playback-progress';
import { ListeningEndReason } from '../../data/entities/listening-end-reason';
import { ListeningDetails } from '../../data/repositories/listening-session-repository.base';
import { ListeningSegment } from '../../data/entities/listening-segment';
import { ListeningDetailRecorder } from './listening-detail-recorder';

interface CurrentSession {
    /** Database id, undefined while the session could not be written yet. */
    id: number | undefined;
    snapshot: ListeningSession;
    durationMs: number;
    listenedMs: number;
    /** Wall clock time playback (re)started, undefined while paused. */
    playingSinceMs: number | undefined;
    /** Detailed statistics (opt-in): heard parts and furthest position. */
    detail?: ListeningDetailRecorder;
    /** How the play ended, set when it ends (detailed statistics). */
    endReason?: ListeningEndReason;
}

/**
 * Records what is listened to, for the Statistics page. Everything stays in the local database.
 *
 * Only time that is actually playing counts (pauses do not, seeking does not add time). A session counts as a play
 * when at least half of the track, or 4 minutes, was listened to (the same rule Last.fm uses for scrobbles).
 * Sessions shorter than 1 second are not kept. Progress is saved every 15 seconds and when the app closes.
 *
 * Writes can fail while the collection is being indexed (the indexing worker keeps the database busy, "database is
 * locked"). Waiting is not an option: database calls block the window. So nothing is lost instead: a session that could
 * not be created or finished is kept in memory and written at the next save.
 *
 * With detailed statistics (opt-in setting), each play also records how it ended (completed, skipped, stopped), the
 * furthest position reached, and which parts of the track were heard (see ListeningDetailRecorder). These are written
 * with the regular saves.
 */
@Injectable({ providedIn: 'root' })
export class ListeningTrackerService {
    public static readonly saveIntervalMs: number = 15000;
    public static readonly minimumListenedMs: number = 1000;
    public static readonly playThresholdMs: number = 4 * 60 * 1000;
    /** At most this many finished sessions wait for the database; older ones are dropped. */
    public static readonly maximumPendingSessions: number = 200;

    private subscription: Subscription | undefined;
    private saveIntervalId: ReturnType<typeof setInterval> | undefined;
    private current: CurrentSession | undefined;
    /** Finished sessions that could not be written yet. */
    private pending: CurrentSession[] = [];
    private isWriteFailing: boolean = false;

    public constructor(
        private playbackService: PlaybackService,
        private repository: ListeningSessionRepositoryBase,
        private ipcProxy: IpcProxyBase,
        private dateProxy: DateProxy,
        private logger: Logger,
        private settings: SettingsBase,
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
        this.subscription.add(this.playbackService.progressChanged$.subscribe((progress: PlaybackProgress) => this.onProgress(progress)));
        this.subscription.add(this.playbackService.playbackSkipped$.subscribe(() => this.onSeek()));

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

    /**
     * Ends the current session and saves it. Public so it can be called when the app closes.
     * `otherwise` is how it ended unless it reached the end of the track (detailed statistics).
     */
    public finish(otherwise: ListeningEndReason = ListeningEndReason.stopped): void {
        if (this.current == undefined) {
            return;
        }

        const session: CurrentSession = this.current;
        this.current = undefined;
        this.accumulate(session);
        session.endReason = session.detail?.endReason(otherwise);

        if (!this.write(session, true)) {
            this.pending.push(session);

            if (this.pending.length > ListeningTrackerService.maximumPendingSessions) {
                this.pending.shift();
            }
        }
    }

    /**
     * Deletes the whole listening history. The song that is playing keeps being recorded, as if it started now,
     * so that clearing during playback does not leave a session that can no longer be saved.
     */
    public clearHistory(): number {
        const running: CurrentSession | undefined = this.current;
        const deleted: number = this.repository.deleteAllSessions();
        this.pending = [];

        if (running != undefined) {
            const restarted: ListeningSession = { ...running.snapshot, listeningSessionId: 0, startedAtMs: this.dateProxy.now(), listenedMs: 0, isCountedAsPlay: 0 };
            const isPlaying: boolean = running.playingSinceMs != undefined;
            this.current = {
                id: this.repository.addSession(restarted),
                snapshot: restarted,
                durationMs: running.durationMs,
                listenedMs: 0,
                playingSinceMs: isPlaying ? this.dateProxy.now() : undefined,
                detail: this.createRecorder(running.durationMs, isPlaying),
            };
        }

        this.logger.info(`Cleared listening history (${deleted} sessions)`, 'ListeningTrackerService', 'clearHistory');

        return deleted;
    }

    private start(track: TrackModel): void {
        // A new track (also after a gapless transition) ends the session of the previous one.
        this.finish(ListeningEndReason.skipped);

        const session: ListeningSession = new ListeningSession();
        session.trackPath = track.path;
        session.trackTitle = track.rawTitle.length > 0 ? track.rawTitle : track.fileName;
        session.artists = track.rawArtists.length > 0 ? `;${track.rawArtists.join(';;')};` : '';
        session.albumTitle = track.rawAlbumTitle;
        session.albumArtists = track.rawFirstAlbumArtist.length > 0 ? `;${track.rawFirstAlbumArtist};` : '';
        session.albumKey = track.albumKey;
        session.startedAtMs = this.dateProxy.now();
        session.trackDurationMs = track.durationInMilliseconds;

        this.current = {
            id: undefined,
            snapshot: session,
            durationMs: track.durationInMilliseconds,
            listenedMs: 0,
            playingSinceMs: this.dateProxy.now(),
            detail: this.createRecorder(track.durationInMilliseconds, true),
        };
        this.write(this.current, false);
    }

    private pause(): void {
        if (this.current == undefined) {
            return;
        }

        this.accumulate(this.current);
        this.current.playingSinceMs = undefined;
        this.current.detail?.end();
        this.save();
    }

    private resume(): void {
        if (this.current != undefined && this.current.playingSinceMs == undefined) {
            this.current.playingSinceMs = this.dateProxy.now();
            this.current.detail?.begin(this.positionMs(), this.dateProxy.now());
        }
    }

    private onProgress(progress: PlaybackProgress): void {
        const session: CurrentSession | undefined = this.current;

        if (session?.detail == undefined || session.playingSinceMs == undefined) {
            return;
        }

        if (!this.settings.detailedListeningStatistics) {
            // Turned off during the song: stop recording details for it.
            session.detail = undefined;
            return;
        }

        session.detail.progress((progress?.progressSeconds ?? NaN) * 1000, this.dateProxy.now());
    }

    private onSeek(): void {
        if (this.current?.detail != undefined && this.current.playingSinceMs != undefined) {
            this.current.detail.seek(this.positionMs(), this.dateProxy.now());
        }
    }

    private createRecorder(durationMs: number, isPlaying: boolean): ListeningDetailRecorder | undefined {
        if (!this.settings.detailedListeningStatistics) {
            return undefined;
        }

        const recorder: ListeningDetailRecorder = new ListeningDetailRecorder(durationMs);

        if (isPlaying) {
            recorder.begin(this.positionMs(), this.dateProxy.now());
        }

        return recorder;
    }

    private positionMs(): number {
        return (this.playbackService.progress?.progressSeconds ?? NaN) * 1000;
    }

    /** Saves progress of the running session without ending it (protects against crashes). */
    private save(): void {
        this.writePending();

        if (this.current == undefined) {
            return;
        }

        const isPlaying: boolean = this.current.playingSinceMs != undefined;
        this.accumulate(this.current);

        if (isPlaying) {
            // Keep counting from now: the time up to now has just been added.
            this.current.playingSinceMs = this.dateProxy.now();
        }

        this.write(this.current, false);
    }

    private writePending(): void {
        this.pending = this.pending.filter((session: CurrentSession) => !this.write(session, true));
    }

    /**
     * Writes a session: creates its row if that did not work yet, then stores the time listened. A finished session
     * that is too short is removed. Returns false when the database could not be written (try again later).
     */
    private write(session: CurrentSession, isFinished: boolean): boolean {
        try {
            if (isFinished && session.listenedMs < ListeningTrackerService.minimumListenedMs) {
                if (session.id != undefined) {
                    this.repository.deleteSession(session.id);
                }
            } else {
                if (session.id == undefined) {
                    session.id = this.repository.addSession(session.snapshot);
                }

                const details: ListeningDetails | undefined =
                    session.detail != undefined
                        ? { endReason: isFinished ? (session.endReason ?? null) : null, furthestPositionMs: session.detail.furthestPositionMs }
                        : undefined;
                this.repository.updateListened(session.id, session.listenedMs, this.isCountedAsPlay(session), details);

                if (session.detail != undefined) {
                    const parts: ListeningSegment[] = session.detail.takeUnsaved();

                    try {
                        this.repository.addSegments(session.id, parts);
                    } catch (e: unknown) {
                        session.detail.restore(parts);
                        throw e;
                    }
                }
            }

            if (this.isWriteFailing) {
                this.isWriteFailing = false;
                this.logger.info('Listening history can be saved again', 'ListeningTrackerService', 'write');
            }

            return true;
        } catch (e: unknown) {
            if (!this.isWriteFailing) {
                // Logged once per period of failures, not at every retry.
                this.isWriteFailing = true;
                this.logger.warn(
                    `Could not save listening history now, will try again in ${ListeningTrackerService.saveIntervalMs / 1000} s: ${e instanceof Error ? e.message : String(e)}`,
                    'ListeningTrackerService',
                    'write',
                );
            }

            return false;
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
