import { Injectable } from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import { Logger } from '../../common/logger';
import { MathExtensions } from '../../common/math-extensions';
import { AlbumModel } from '../album/album-model';
import { ArtistModel } from '../artist/artist-model';
import { ArtistType } from '../artist/artist-type';
import { GenreModel } from '../genre/genre-model';
import { PlaylistModel } from '../playlist/playlist-model';
import { TrackModel } from '../track/track-model';
import { TrackModels } from '../track/track-models';
import { LoopMode } from './loop-mode';
import { PlaybackProgress } from './playback-progress';
import { PlaybackStarted } from './playback-started';
import { Queue } from './queue';
import { TrackServiceBase } from '../track/track.service.base';
import { PlaylistServiceBase } from '../playlist/playlist.service.base';
import { SettingsBase } from '../../common/settings/settings.base';
import { StringUtils } from '../../common/utils/string-utils';
import { ContinuousPlay } from './continuous-play';
import { LikeService } from '../like/like.service';
import { NotificationServiceBase } from '../notification/notification.service.base';
import { TrackSorter } from '../../common/sorting/track-sorter';
import { QueuePersister } from './queue-persister';
import { QueueRestoreInfo } from './queue-restore-info';
import { AudioPlayerFactory } from './audio-player/audio-player.factory';
import { IAudioPlayer } from './audio-player/i-audio-player';
import { MediaSessionService } from '../media-session/media-session.service';
import { Track } from '../../data/entities/track';
import { FileFormats } from '../../common/application/file-formats';
import { Constants } from '../../common/application/constants';
import { DialogServiceBase } from '../dialog/dialog.service.base';
import { FileAccessBase } from '../../common/io/file-access.base';

@Injectable({ providedIn: 'root' })
export class PlaybackService {
    private progressChanged: Subject<PlaybackProgress> = new Subject();
    private playbackStarted: Subject<PlaybackStarted> = new Subject();
    private playbackPaused: Subject<void> = new Subject();
    private playbackResumed: Subject<void> = new Subject();
    private playbackStopped: Subject<void> = new Subject();
    private playbackSkipped: Subject<void> = new Subject();
    private _progress: PlaybackProgress = new PlaybackProgress(0, 0);
    private _volume: number = 0;
    private _loopMode: LoopMode = LoopMode.None;
    private _isShuffled: boolean = false;
    private _isPlaying: boolean = false;
    private _canPause: boolean = false;
    private _canResume: boolean = true;
    private _volumeBeforeMute: number = 0;
    private _playbackSpeed: number = 1;
    private _shouldReportProgress: boolean = false;
    private _progressInterval: number = 0;
    private subscription: Subscription = new Subscription();
    private _audioPlayer: IAudioPlayer;
    private _preloadTimeoutId: NodeJS.Timeout | number | undefined;
    private _queueSaveTimeoutId: NodeJS.Timeout | number | undefined;

    public constructor(
        private audioPlayerFactory: AudioPlayerFactory,
        private trackService: TrackServiceBase,
        private playlistService: PlaylistServiceBase,
        private notificationService: NotificationServiceBase,
        private dialogService: DialogServiceBase,
        private mediaSessionService: MediaSessionService,
        private queuePersister: QueuePersister,
        private fileAccess: FileAccessBase,
        private trackSorter: TrackSorter,
        private queue: Queue,
        private mathExtensions: MathExtensions,
        private settings: SettingsBase,
        private logger: Logger,
        private likeService?: LikeService,
    ) {
        this._audioPlayer = this.audioPlayerFactory.create();
        this.initializeSubscriptions();
        this.applyVolumeFromSettings();
        this._audioPlayer.setPlaybackRate(this._playbackSpeed);
    }

    public get playbackQueue(): TrackModels {
        const trackModels: TrackModels = new TrackModels();

        if (this.queue.tracks != undefined) {
            // Add tracks to playback queue in playback order so that the user can see what is coming next in the queue
            for (const track of this.queue.tracksInPlaybackOrder) {
                trackModels.addTrack(track);
            }
        }

        return trackModels;
    }

    public get audioPlayer(): IAudioPlayer {
        return this._audioPlayer;
    }

    public get volume(): number {
        return this._volume;
    }

    public set volume(v: number) {
        this.applyVolume(v);
    }

    public get playbackSpeed(): number {
        return this._playbackSpeed;
    }

    public set playbackSpeed(v: number) {
        const clampedSpeed: number = Math.min(3, Math.max(0.5, v));
        const playbackSpeed: number = Math.round((clampedSpeed - 0.5) / 0.05) * 0.05 + 0.5;
        this._playbackSpeed = Math.round(playbackSpeed * 100) / 100;
        this._audioPlayer.setPlaybackRate(this._playbackSpeed);
        this.updateMediaSessionPlaybackState();
    }

    public get progress(): PlaybackProgress {
        return this._progress;
    }

    public get loopMode(): LoopMode {
        return this._loopMode;
    }

    public get isPlaying(): boolean {
        return this._isPlaying;
    }

    public get isShuffled(): boolean {
        return this._isShuffled;
    }

    public get canPause(): boolean {
        return this._canPause;
    }

    public get canResume(): boolean {
        return this._canResume;
    }

    public currentTrack: TrackModel | undefined;

    public progressChanged$: Observable<PlaybackProgress> = this.progressChanged.asObservable();
    public playbackStarted$: Observable<PlaybackStarted> = this.playbackStarted.asObservable();
    public playbackPaused$: Observable<void> = this.playbackPaused.asObservable();
    public playbackResumed$: Observable<void> = this.playbackResumed.asObservable();
    public playbackStopped$: Observable<void> = this.playbackStopped.asObservable();
    public playbackSkipped$: Observable<void> = this.playbackSkipped.asObservable();

    public async enqueueAndPlayTracksAsync(tracksToEnqueue: TrackModel[]): Promise<void> {
        if (tracksToEnqueue.length === 0) {
            return;
        }

        this.queue.setTracks(tracksToEnqueue, this.isShuffled);
        this.scheduleQueueSave();

        // Play first track in queue (will be a random track if queue is shuffled)
        const firstTrack: TrackModel | undefined = this.queue.getFirstTrack();

        if (firstTrack != undefined) {
            await this.stopAndPlayAsync(firstTrack, false);
        }
    }

    public async enqueueAndPlayTracksStartingFromGivenTrackAsync(tracksToEnqueue: TrackModel[], trackToPlay: TrackModel): Promise<void> {
        if (tracksToEnqueue.length === 0) {
            return;
        }

        if (trackToPlay == undefined) {
            return;
        }

        const enqueuedTracks: TrackModel[] = this.queue.setTracks(tracksToEnqueue, this.isShuffled);
        this.scheduleQueueSave();
        const enqueuedTrackToPlay: TrackModel = enqueuedTracks.filter((x) => x.path === trackToPlay.path)[0];
        await this.stopAndPlayAsync(enqueuedTrackToPlay, false);
    }

    public async enqueueAndPlayArtistAsync(artistToPlay: ArtistModel, artistType: ArtistType): Promise<void> {
        const tracksForArtists: TrackModels = this.trackService.getTracksForArtists([artistToPlay], artistType);
        const orderedTracks: TrackModel[] = this.trackSorter.sortByAlbum(tracksForArtists.tracks);
        await this.enqueueAndPlayTracksAsync(orderedTracks);
    }

    public async enqueueAndPlayGenreAsync(genreToPlay: GenreModel): Promise<void> {
        const tracksForGenre: TrackModels = this.trackService.getTracksForGenres([genreToPlay.name]);
        const orderedTracks: TrackModel[] = this.trackSorter.sortByAlbum(tracksForGenre.tracks);
        await this.enqueueAndPlayTracksAsync(orderedTracks);
    }

    public async enqueueAndPlayAlbumAsync(albumToPlay: AlbumModel): Promise<void> {
        const tracksForAlbum: TrackModels = this.trackService.getTracksForAlbums([albumToPlay.albumKey]);
        const orderedTracks: TrackModel[] = this.trackSorter.sortByAlbum(tracksForAlbum.tracks);
        await this.enqueueAndPlayTracksAsync(orderedTracks);
    }

    public async enqueueAndPlayPlaylistAsync(playlistToPlay: PlaylistModel): Promise<void> {
        const tracksForPlaylist: TrackModels = await this.playlistService.getTracksAsync([playlistToPlay]);
        await this.enqueueAndPlayTracksAsync(tracksForPlaylist.tracks);
    }

    public async addTracksToQueueAsync(tracksToAdd: TrackModel[]): Promise<void> {
        if (tracksToAdd.length === 0) {
            return;
        }

        this.queue.addTracks(tracksToAdd);
        this.scheduleQueueSave();
        await this.notifyOfTracksAddedToPlaybackQueueAsync(tracksToAdd.length);
    }

    public async addArtistToQueueAsync(artistToAdd: ArtistModel, artistType: ArtistType): Promise<void> {
        const tracksForArtists: TrackModels = this.trackService.getTracksForArtists([artistToAdd], artistType);
        const orderedTracks: TrackModel[] = this.trackSorter.sortByAlbum(tracksForArtists.tracks);
        await this.addTracksToQueueAsync(orderedTracks);
    }

    public async addGenreToQueueAsync(genreToAdd: GenreModel): Promise<void> {
        if (genreToAdd == undefined) {
            return;
        }

        const tracksForGenre: TrackModels = this.trackService.getTracksForGenres([genreToAdd.name]);
        const orderedTracks: TrackModel[] = this.trackSorter.sortByAlbum(tracksForGenre.tracks);
        await this.addTracksToQueueAsync(orderedTracks);
    }

    public async addAlbumToQueueAsync(albumToAdd: AlbumModel): Promise<void> {
        const tracksForAlbum: TrackModels = this.trackService.getTracksForAlbums([albumToAdd.albumKey]);
        const orderedTracks: TrackModel[] = this.trackSorter.sortByAlbum(tracksForAlbum.tracks);
        await this.addTracksToQueueAsync(orderedTracks);
    }

    public async addPlaylistToQueueAsync(playlistToAdd: PlaylistModel): Promise<void> {
        if (playlistToAdd == undefined) {
            return;
        }

        const tracksForPlaylist: TrackModels = await this.playlistService.getTracksAsync([playlistToAdd]);
        await this.addTracksToQueueAsync(tracksForPlaylist.tracks);
    }

    public removeFromQueue(tracksToRemove: TrackModel[]): void {
        if (tracksToRemove.length === 0) {
            return;
        }

        this.queue.removeTracks(tracksToRemove);
        this.scheduleQueueSave();
    }

    public clearQueue(): void {
        this.queue.removeTracks(this.queue.tracks);
        this.scheduleQueueSave();
    }

    public reorderQueue(previousIndex: number, currentIndex: number): void {
        this.queue.moveTrackInPlaybackOrder(previousIndex, currentIndex);
        this.scheduleQueueSave();
    }

    public async playQueuedTrackAsync(trackToPlay: TrackModel): Promise<void> {
        await this.stopAndPlayAsync(trackToPlay, false);
    }

    public toggleLoopMode(): void {
        const oldLoopMode: LoopMode = this._loopMode;

        if (this._loopMode === LoopMode.None) {
            this._loopMode = LoopMode.All;
            this.settings.playbackControlsLoop = 2;
        } else if (this._loopMode === LoopMode.All) {
            this._loopMode = LoopMode.One;
            this.settings.playbackControlsLoop = 1;
        } else {
            this._loopMode = LoopMode.None;
            this.settings.playbackControlsLoop = 0;
        }

        this.logger.info(`Toggled loopMode from ${oldLoopMode} to ${this._loopMode}`, 'PlaybackService', 'toggleLoopMode');
    }

    public toggleIsShuffled(): void {
        this._isShuffled = !this._isShuffled;

        if (this._isShuffled) {
            this.queue.shuffle();
            this.settings.playbackControlsShuffle = 1;
        } else {
            this.queue.unShuffle();
            this.settings.playbackControlsShuffle = 0;
        }

        this.scheduleQueueSave();

        this.logger.info(`Toggled isShuffled from ${!this._isShuffled} to ${this._isShuffled}`, 'PlaybackService', 'toggleIsShuffled');
    }

    public forceShuffled(): void {
        this._isShuffled = true;
        this.queue.shuffle();
        this.scheduleQueueSave();

        this.logger.info(`Forced isShuffled`, 'PlaybackService', 'forceShuffled');
    }

    public static readonly minimumFadeMs: number = 1;
    public static readonly maximumFadeMs: number = 60000;

    // Fade on pause/resume/stop. A token identifies the latest fade request; an older pending pause or stop is
    // abandoned when a newer request (resume, new track, another pause) comes in.
    private _fadeToken: number = 0;
    private _isFadingOut: boolean = false;

    public pause(): void {
        const durationMs: number = this.fadeOutDurationMs();

        // The pause shows at once; with a fade, the audio only pauses when the fade ends.
        this.postPause();

        if (durationMs <= 0) {
            this.audioPlayer.pause();
            return;
        }

        const token: number = ++this._fadeToken;
        this._isFadingOut = true;

        this.fade(0, durationMs, () => {
            if (token === this._fadeToken) {
                this._isFadingOut = false;
                this.audioPlayer.pause();
            }
        });
    }

    /** 0 when fading is off, otherwise the fade out duration within the allowed range. */
    private fadeOutDurationMs(): number {
        if (!this.settings.fadeOnPause) {
            return 0;
        }

        return PlaybackService.clampFade(this.settings.fadeOnPauseDurationMs);
    }

    /** 0 when fading is off, otherwise the fade in duration (the fade out duration unless a separate one is used). */
    private fadeInDurationMs(): number {
        if (!this.settings.fadeOnPause) {
            return 0;
        }

        return PlaybackService.clampFade(
            this.settings.useSeparateFadeInDuration ? this.settings.fadeInDurationMs : this.settings.fadeOnPauseDurationMs,
        );
    }

    private static clampFade(durationMs: number): number {
        if (!Number.isFinite(durationMs)) {
            return 0;
        }

        return Math.min(PlaybackService.maximumFadeMs, Math.max(PlaybackService.minimumFadeMs, Math.round(durationMs)));
    }

    /**
     * Fades, then runs `done`. When the fade fails (audio device gone, audio context closed), `done` runs anyway: a
     * pause or stop must never be lost, or the music would keep playing while the app shows it paused.
     */
    private fade(level: number, durationMs: number, done: () => void, failed: () => void = done): void {
        const fail = (e: unknown): void => {
            this.logger.warn(`Fade failed: ${e instanceof Error ? e.message : String(e)}`, 'PlaybackService', 'fade');
            failed();
        };

        try {
            this.audioPlayer.fadeAsync(level, durationMs).then(done, fail);
        } catch (e: unknown) {
            fail(e);
        }
    }

    /** Fades in; when that fails, the volume is set to full at once (never left silent). */
    private fadeIn(durationMs: number): void {
        const token: number = this._fadeToken;

        this.fade(
            1,
            durationMs,
            () => undefined, // Nothing to do when the fade in ends.
            () => {
                if (token === this._fadeToken) {
                    this.audioPlayer.setFadeLevel(1);
                }
            },
        );
    }

    /** Cancels a pending fade and restores full volume. Used before a new track starts. */
    private resetFade(): void {
        this._fadeToken++;
        this._isFadingOut = false;
        this.audioPlayer.setFadeLevel(1);
    }

    private postPause() {
        this._canPause = false;
        this._canResume = true;
        this.pauseUpdatingProgress();
        this.updateMediaSessionPlaybackState();
        this.playbackPaused.next();

        if (this.currentTrack != undefined) {
            this.logger.info(`Pausing '${this.currentTrack.path}'`, 'PlaybackService', 'pause');
        }
    }

    public async resumeAsync(): Promise<void> {
        if (!this.isPlaying) {
            const trackToResume: TrackModel | undefined = this.currentTrack ?? this.queue.getFirstTrack();

            if (trackToResume != undefined) {
                await this.stopAndPlayAsync(trackToResume, false);
                return;
            }

            return;
        }

        const fadeInMs: number = this.fadeInDurationMs();
        this._fadeToken++;

        if (this._isFadingOut) {
            // Still fading out (not paused yet): turn the fade around from the current level.
            this._isFadingOut = false;

            if (fadeInMs > 0) {
                this.fadeIn(fadeInMs);
            } else {
                this.audioPlayer.setFadeLevel(1);
            }
        } else if (fadeInMs > 0) {
            this.audioPlayer.setFadeLevel(0);
            await this.audioPlayer.resumeAsync();
            this.fadeIn(fadeInMs);
        } else {
            this.audioPlayer.setFadeLevel(1);
            await this.audioPlayer.resumeAsync();
        }

        this._canPause = true;
        this._canResume = false;
        this.startUpdatingProgress();
        this.playbackResumed.next();

        if (this.currentTrack != undefined) {
            this.logger.info(`Resuming '${this.currentTrack.path}'`, 'PlaybackService', 'resume');
        }
    }

    public async playPreviousAsync(): Promise<void> {
        let trackToPlay: TrackModel | undefined;

        if (this.currentTrack != undefined && this.audioPlayer.progressSeconds > 3) {
            trackToPlay = this.currentTrack;
        } else {
            const allowWrapAround: boolean = this.loopMode === LoopMode.All;
            trackToPlay = this.queue.getPreviousTrack(this.currentTrack, allowWrapAround);
        }

        if (trackToPlay != undefined) {
            await this.stopAndPlayAsync(trackToPlay, true);

            return;
        }

        this.stop();
    }

    public async playNextAsync(): Promise<void> {
        this.increaseCountersForCurrentTrackBasedOnProgress();

        const allowWrapAround: boolean = this.loopMode === LoopMode.All;
        const trackToPlay: TrackModel | undefined = this.queue.getNextTrack(this.currentTrack, allowWrapAround);

        if (trackToPlay != undefined) {
            await this.stopAndPlayAsync(trackToPlay, false);

            return;
        }

        this.stop();
    }

    public async skipByFractionOfTotalSecondsAsync(fractionOfTotalSeconds: number): Promise<void> {
        const seconds: number = fractionOfTotalSeconds * this.audioPlayer.totalSeconds;
        await this.skipToSecondsAsync(seconds);
    }

    private async skipToSecondsAsync(seconds: number): Promise<void> {
        await this.audioPlayer.skipToSecondsAsync(seconds);
        this._progress = this.getCurrentProgress();
        this.updateMediaSessionPlaybackState();
        this.playbackSkipped.next();
    }

    public async togglePlaybackAsync(): Promise<void> {
        if (this.canPause) {
            this.pause();
        } else {
            await this.resumeAsync();
        }
    }

    public async stopIfPlayingAsync(track: TrackModel): Promise<void> {
        if (this.currentTrack != undefined && this.currentTrack.path === track.path) {
            if (this.queue.numberOfTracks === 1) {
                this.stop();
            } else {
                await this.playNextAsync();
            }
        }
    }

    public toggleMute(): void {
        if (this._volume === 0) {
            this.applyVolume(this._volumeBeforeMute > 0 ? this._volumeBeforeMute : 0.5);
        } else {
            this._volumeBeforeMute = this._volume;
            this.applyVolume(0);
        }
    }

    private async stopAndPlayAsync(trackToPlay: TrackModel, isPlayingPreviousTrack: boolean): Promise<void> {
        this.audioPlayer.stop();
        this.logger.info(`Stopping '${this.currentTrack?.path ?? ''}'`, 'PlaybackService', 'stopAndPlay');

        await this.playAsync(trackToPlay, isPlayingPreviousTrack);
    }

    private async playAsync(trackToPlay: TrackModel, isPlayingPreviousTrack: boolean): Promise<void> {
        // A new track always starts at full volume, even if a pause or stop was fading out.
        this.resetFade();
        await this.audioPlayer.playAsync(trackToPlay);
        this.postPlay(trackToPlay, isPlayingPreviousTrack);

        if (this.audioPlayer.isPaused) {
            // pause() was called while the track was starting
            this.postPause();
        }
    }

    private postPlay(trackToPlay: TrackModel, isPlayingPreviousTrack: boolean): void {
        this.currentTrack = trackToPlay;
        this._isPlaying = true;
        this._canPause = true;
        this._canResume = false;

        this.applyEffectiveVolumeForCurrentTrack();
        this.logReplayGainAtTrackStart(trackToPlay);

        void this.mediaSessionService.setMetadataAsync(trackToPlay);

        this.startUpdatingProgress();
        this.playbackStarted.next(new PlaybackStarted(trackToPlay, isPlayingPreviousTrack));

        this.logger.info(`Playing '${this.currentTrack.path}'`, 'PlaybackService', 'play');

        this.preloadNextTrackAfterDelay();
    }

    private preloadNextTrackAfterDelay(): void {
        if (this.loopMode === LoopMode.One) {
            return;
        }

        const nextTrack: TrackModel | undefined = this.queue.getNextTrack(this.currentTrack, this.loopMode === LoopMode.All);

        if (nextTrack) {
            if (this._preloadTimeoutId !== undefined && this._preloadTimeoutId !== null) {
                clearTimeout(this._preloadTimeoutId);
            }
            this._preloadTimeoutId = setTimeout(
                () => {
                    if (this.currentTrack === undefined) {
                        return;
                    }
                    this._audioPlayer.preloadNext(nextTrack);
                    this.logger.info(`Preloaded '${nextTrack.path}'`, 'PlaybackService', 'preloadNextTrackAfterDelay');
                },
                this.settings.useCrossfade ? 500 : 2000,
            ); // Preload sooner when using crossfade to ensure crossfade is ready
        }
    }

    private stop(): void {
        // Cancels a fade out that is still pending (its pause or stop must not run after this).
        this.resetFade();
        this.audioPlayer.stop();
        this._isPlaying = false;
        this._canPause = false;
        this._canResume = true;
        this.stopUpdatingProgress();

        if (this.currentTrack != undefined) {
            this.logger.info(`Stopping '${this.currentTrack.path}'`, 'PlaybackService', 'stop');
        }

        this.currentTrack = undefined;
        this.mediaSessionService.clearMetadata();
        this.playbackStopped.next();
    }

    /**
     * Fully stops playback and resets progress to the start, keeping the current track so that a subsequent resumeAsync() restarts it from the beginning.
     */
    /**
     * When set, playback stops when the current song ends (sleep timer "end of this song"). Cleared when it happens, and
     * by any stop.
     */
    public stopAfterCurrentTrack: boolean = false;

    /** Stops playback. fadeOutMs overrides the fade setting (the sleep timer fades out slowly); 0 stops at once. */
    public stopPlayback(fadeOutMs?: number): void {
        if (this.currentTrack == undefined) {
            return;
        }

        this.stopAfterCurrentTrack = false;
        const requestedMs: number | undefined =
            fadeOutMs !== undefined && Number.isFinite(fadeOutMs)
                ? Math.min(PlaybackService.maximumFadeMs, Math.max(0, fadeOutMs))
                : undefined;
        const durationMs: number = this.canPause ? (requestedMs ?? this.fadeOutDurationMs()) : 0;

        if (durationMs > 0) {
            // Fade out first; the state below changes at once, the audio stops when the fade ends.
            const token: number = ++this._fadeToken;
            this._isFadingOut = true;

            this.fade(0, durationMs, () => {
                if (token === this._fadeToken) {
                    this._isFadingOut = false;
                    this.audioPlayer.stop();
                }
            });
        } else {
            this.audioPlayer.stop();
        }

        this._isPlaying = false;
        this._canPause = false;
        this._canResume = true;
        this.stopUpdatingProgress();
        this.mediaSessionService.clearMetadata();

        this.logger.info(`Stopping playback for '${this.currentTrack.path}'`, 'PlaybackService', 'stopPlayback');

        this.playbackStopped.next();
    }

    private async playbackFinishedHandlerAsync(): Promise<void> {
        if (this.currentTrack != undefined) {
            this.logger.info(`Track finished: '${this.currentTrack.path}'`, 'PlaybackService', 'playbackFinishedHandler');
        }

        this.increasePlayCountAndDateLastPlayedForCurrentTrack();

        if (this.stopAfterCurrentTrack) {
            this.stopPlayback(0);
            return;
        }

        if (this.loopMode === LoopMode.One) {
            if (this.currentTrack != undefined) {
                await this.playAsync(this.currentTrack, false);
            }

            return;
        }

        const allowWrapAround: boolean = this.loopMode === LoopMode.All;
        const trackToPlay: TrackModel | undefined = this.queue.getNextTrack(this.currentTrack, allowWrapAround);

        if (trackToPlay != undefined) {
            await this.playAsync(trackToPlay, false);

            return;
        }

        if (!allowWrapAround && this.settings.useContinuousPlay === true && (await this.continuePlayingAsync())) {
            return;
        }

        this.stop();
    }

    // Songs on a network share or a drive that cannot be reached are skipped. After this many in a row (each one quickly
    // after the other) playback stops instead of going through the whole queue.
    public static readonly maximumUnreachableSkips: number = 10;
    private static readonly unreachableSkipWindowMs: number = 30000;
    private _unreachableSkips: number = 0;
    private _lastUnreachableSkipMs: number = 0;

    private async playbackFailedHandlerAsync(audioFilePath: string): Promise<void> {
        if (await this.skipIfUnreachableAsync()) {
            return;
        }

        const extension: string = this.fileAccess.getFileExtension(audioFilePath);

        if (extension === FileFormats.m4a) {
            await this.dialogService.cannotPlayM4aFileAsync();
        } else {
            await this.dialogService.cannotPlayAudioFileAsync();
        }

        this.stop();
    }

    /**
     * When the song's file cannot be reached (network share offline, drive unplugged), shows a short notice and plays the
     * next song instead of the "cannot play" dialog. Returns false when the file is there (then the file itself is the
     * problem and the dialog is right).
     */
    private async skipIfUnreachableAsync(): Promise<boolean> {
        const track: TrackModel | undefined = this.currentTrack;

        if (track == undefined || StringUtils.isNullOrWhiteSpace(track.audioPath) || this.fileAccess.pathExists(track.audioPath)) {
            return false;
        }

        const now: number = Date.now();
        this._unreachableSkips =
            now - this._lastUnreachableSkipMs < PlaybackService.unreachableSkipWindowMs ? this._unreachableSkips + 1 : 1;
        this._lastUnreachableSkipMs = now;
        this.logger.warn(`Cannot reach '${track.audioPath}': skipping it`, 'PlaybackService', 'skipIfUnreachableAsync');

        if (this._unreachableSkips >= PlaybackService.maximumUnreachableSkips) {
            this._unreachableSkips = 0;
            this.stop();
            await this.notificationService.songsUnreachableStoppedAsync();
            return true;
        }

        void this.notificationService.songUnreachableSkippedAsync();
        await this.playNextAsync();
        return true;
    }

    /** Songs added by continuous play (by path), so the queue can mark them. */
    public readonly continuousPlayPaths: Set<string> = new Set<string>();

    /**
     * Continuous play: the queue has ended, so similar songs from the library are added and the first one plays.
     * Returns false when it is off or nothing fits (then playback stops as usual).
     */
    private async continuePlayingAsync(): Promise<boolean> {
        if (this.settings.useContinuousPlay !== true) {
            return false;
        }

        try {
            const library: TrackModel[] = this.trackService.getVisibleTracks().tracks;
            const played: TrackModel[] = this.queue.tracksInPlaybackOrder;
            const picked: TrackModel[] = ContinuousPlay.pick(
                played,
                library,
                played,
                ContinuousPlay.songsPerTurn,
                Math.random,
                (track) => this.likeService?.isDislikedByAlbumOrArtist(track) === true,
            );

            if (picked.length === 0) {
                return false;
            }

            const lastTrack: TrackModel | undefined = this.currentTrack;
            this.queue.addTracks(picked);
            picked.forEach((x) => this.continuousPlayPaths.add(x.path));
            this.logger.info(`Continuous play added ${picked.length} songs`, 'PlaybackService', 'continuePlayingAsync');

            const next: TrackModel | undefined = this.queue.getNextTrack(lastTrack, false);

            if (next == undefined) {
                return false;
            }

            await this.playAsync(next, false);
            return true;
        } catch (e: unknown) {
            this.logger.error(e, 'Continuous play could not add songs', 'PlaybackService', 'continuePlayingAsync');
            return false;
        }
    }

    private async playingPreloadedTrackHandler(preloadedTrack: TrackModel): Promise<void> {
        this.increasePlayCountAndDateLastPlayedForCurrentTrack();

        if (this.stopAfterCurrentTrack) {
            // Gapless: the next song has just started. Stop it at once (the sleep timer asked to stop after the song).
            this.stopPlayback(0);
            return;
        }

        if (this.loopMode === LoopMode.One && this.currentTrack != undefined) {
            await this.playAsync(this.currentTrack, false);
            return;
        }

        this.postPlay(preloadedTrack, false);
    }

    private increaseCountersForCurrentTrackBasedOnProgress(): void {
        if (this.progress == undefined) {
            this.logger.warn('Progress was undefined', 'PlaybackService', 'increaseCountersForCurrentTrackBasedOnProgress');

            return;
        }

        if (this.progress.progressPercent <= 80) {
            this.increaseSkipCountForCurrentTrack();
        } else {
            this.increasePlayCountAndDateLastPlayedForCurrentTrack();
        }
    }

    private increasePlayCountAndDateLastPlayedForCurrentTrack(): void {
        if (this.currentTrack == undefined) {
            this.logger.warn('CurrentTrack is undefined', 'PlaybackService', 'increasePlayCountAndDateLastPlayedForCurrentTrack');

            return;
        }

        this.currentTrack.increasePlayCountAndDateLastPlayed();
        this.trackService.savePlayCountAndDateLastPlayed(this.currentTrack);
    }

    private increaseSkipCountForCurrentTrack(): void {
        if (this.currentTrack == undefined) {
            this.logger.warn('CurrentTrack is undefined', 'PlaybackService', 'increaseSkipCountForCurrentTrack');

            return;
        }

        this.currentTrack.increaseSkipCount();
        this.trackService.saveSkipCount(this.currentTrack);
    }

    private initializeSubscriptions(): void {
        this.subscription.add(
            this.audioPlayer.playbackFinished$.subscribe(() => {
                void this.playbackFinishedHandlerAsync();
            }),
        );

        this.subscription.add(
            this.audioPlayer.playbackFailed$.subscribe((audioFilePath: string) => {
                void this.playbackFailedHandlerAsync(audioFilePath);
            }),
        );
        this.subscription.add(
            this.audioPlayer.playingPreloadedTrack$.subscribe((preloadedTrack: TrackModel) => {
                void this.playingPreloadedTrackHandler(preloadedTrack);
            }),
        );

        this.subscription.add(
            this.mediaSessionService.playEvent$.subscribe(() => {
                void this.togglePlaybackAsync();
            }),
        );

        this.subscription.add(
            this.mediaSessionService.pauseEvent$.subscribe(() => {
                void this.togglePlaybackAsync();
            }),
        );

        this.subscription.add(
            this.mediaSessionService.previousTrackEvent$.subscribe(() => {
                void this.playPreviousAsync();
            }),
        );

        this.subscription.add(
            this.mediaSessionService.nextTrackEvent$.subscribe(() => {
                void this.playNextAsync();
            }),
        );
    }

    private applyVolumeFromSettings(): void {
        this._volume = this.settings.volume;
        this.applyEffectiveVolumeForCurrentTrack();
    }

    private applyVolume(volume: number): void {
        const volumeToSet: number = this.mathExtensions.clamp(volume, 0, 1);
        this._volume = volumeToSet;
        this.settings.volume = volumeToSet;
        this.applyEffectiveVolumeForCurrentTrack();
    }

    private applyEffectiveVolumeForCurrentTrack(): void {
        const replayGainComputation = this.computeReplayGain(this.currentTrack);
        this.audioPlayer.setVolume(this._volume, replayGainComputation.multiplier);
    }

    private computeReplayGain(track: TrackModel | undefined): {
        mode: 'track' | 'album';
        gainDb: number;
        peak: number;
        preAmpDb: number;
        clippingEnabled: boolean;
        clippingCap?: number;
        multiplierBeforeClipping: number;
        multiplier: number;
        reason: string;
    } {
        const mode: 'track' | 'album' = this.settings.replayGainMode === 'album' ? 'album' : 'track';

        if (track == undefined) {
            return {
                mode,
                gainDb: 0,
                peak: 0,
                preAmpDb: this.settings.replayGainPreAmp,
                clippingEnabled: this.settings.replayGainPreventClipping,
                multiplierBeforeClipping: 1,
                multiplier: 1,
                reason: 'no-track',
            };
        }

        if (!this.settings.useReplayGainNormalization) {
            return {
                mode,
                gainDb: mode === 'album' ? track.replayGainAlbumGain : track.replayGainTrackGain,
                peak: mode === 'album' ? track.replayGainAlbumPeak : track.replayGainTrackPeak,
                preAmpDb: this.settings.replayGainPreAmp,
                clippingEnabled: this.settings.replayGainPreventClipping,
                multiplierBeforeClipping: 1,
                multiplier: 1,
                reason: 'normalization-disabled',
            };
        }

        // Per RG spec: use the requested mode's tags, but fall back to the other
        // mode if the requested mode has no tags. If neither has tags, use unity gain.
        let gainDb: number;
        let peak: number;
        let reason: string = 'applied';

        const primaryGain: number = mode === 'album' ? track.replayGainAlbumGain : track.replayGainTrackGain;
        const primaryPeak: number = mode === 'album' ? track.replayGainAlbumPeak : track.replayGainTrackPeak;
        const fallbackGain: number = mode === 'album' ? track.replayGainTrackGain : track.replayGainAlbumGain;
        const fallbackPeak: number = mode === 'album' ? track.replayGainTrackPeak : track.replayGainAlbumPeak;

        if (primaryGain !== 0 || primaryPeak !== 0) {
            gainDb = primaryGain;
            peak = primaryPeak;
        } else if (fallbackGain !== 0 || fallbackPeak !== 0) {
            gainDb = fallbackGain;
            peak = fallbackPeak;
            reason = 'applied-fallback';
        } else {
            return {
                mode,
                gainDb: 0,
                peak: 0,
                preAmpDb: this.settings.replayGainPreAmp,
                clippingEnabled: this.settings.replayGainPreventClipping,
                multiplierBeforeClipping: 1,
                multiplier: 1,
                reason: 'no-replaygain-tag',
            };
        }

        // Per RG spec: if peak metadata is unavailable, assume 1.0
        if (peak === 0) {
            peak = 1;
        }

        const preAmpDb: number = this.settings.replayGainPreAmp;
        const multiplierBeforeClipping: number = Math.pow(10, (gainDb + preAmpDb) / 20);
        let multiplier: number = multiplierBeforeClipping;
        let clippingCap: number | undefined;

        // Per RG spec: min(10^((RG + Gpreamp) / 20), 1 / peak)
        if (this.settings.replayGainPreventClipping) {
            clippingCap = 1 / peak;
            multiplier = Math.min(multiplier, clippingCap);
            if (multiplier < multiplierBeforeClipping) {
                reason = reason === 'applied-fallback' ? 'applied-fallback-with-clipping-cap' : 'applied-with-clipping-cap';
            }
        }

        return {
            mode,
            gainDb,
            peak,
            preAmpDb,
            clippingEnabled: this.settings.replayGainPreventClipping,
            clippingCap,
            multiplierBeforeClipping,
            multiplier,
            reason,
        };
    }

    private logReplayGainAtTrackStart(track: TrackModel): void {
        if (!this.settings.logReplayGainAtTrackStart || !this.settings.useReplayGainNormalization) {
            return;
        }

        const replayGainComputation = this.computeReplayGain(track);
        const peakAfterGain: number = replayGainComputation.peak * replayGainComputation.multiplier;

        this.logger.info(
            `ReplayGain start '${track.path}': mode=${replayGainComputation.mode}, gainDb=${replayGainComputation.gainDb}, peak=${replayGainComputation.peak}, peakAfterGain=${peakAfterGain}, preAmpDb=${replayGainComputation.preAmpDb}, preventClipping=${replayGainComputation.clippingEnabled}, multiplierBeforeClipping=${replayGainComputation.multiplierBeforeClipping}, multiplier=${replayGainComputation.multiplier}, clippingCap=${replayGainComputation.clippingCap ?? 'n/a'}, baseVolume=${this._volume}, reason=${replayGainComputation.reason}`,
            'PlaybackService',
            'logReplayGainAtTrackStart',
        );
    }

    private async notifyOfTracksAddedToPlaybackQueueAsync(numberOfAddedTracks: number): Promise<void> {
        if (numberOfAddedTracks === 1) {
            await this.notificationService.singleTrackAddedToPlaybackQueueAsync();
        } else {
            await this.notificationService.multipleTracksAddedToPlaybackQueueAsync(numberOfAddedTracks);
        }
    }

    public async RestoreQueueIfNeededAsync(): Promise<void> {
        if (this.settings.rememberPlaybackStateAfterRestart) {
            if (this.settings.playbackControlsLoop !== 0) {
                this._loopMode = this.settings.playbackControlsLoop === 1 ? LoopMode.One : LoopMode.All;
            }

            if (this.settings.playbackControlsShuffle === 1) {
                this._isShuffled = true;
            }

            await this.restoreQueueAsync();
        }
    }

    public saveQueue(): void {
        if (this._queueSaveTimeoutId !== undefined && this._queueSaveTimeoutId !== null) {
            clearTimeout(this._queueSaveTimeoutId);
            this._queueSaveTimeoutId = undefined;
        }

        if (this.settings.rememberPlaybackStateAfterRestart) {
            this.queuePersister.save(this.queue, this.currentTrack, this.progress.progressSeconds);
        }
    }

    private scheduleQueueSave(): void {
        if (!this.settings.rememberPlaybackStateAfterRestart) {
            return;
        }

        if (this._queueSaveTimeoutId !== undefined && this._queueSaveTimeoutId !== null) {
            clearTimeout(this._queueSaveTimeoutId);
        }

        this._queueSaveTimeoutId = setTimeout(() => {
            this.saveQueue();
        }, Constants.playlistsSaveDelayMilliseconds);
    }

    private async startPausedAsync(track: TrackModel, skipSeconds: number): Promise<void> {
        this.logger.info(`Starting playback paused for track: ${track.path} at ${skipSeconds} seconds`, 'PlaybackService', 'startPaused');
        await this.audioPlayer.startPausedAsync(track, skipSeconds);
        this.postPlay(track, false);
        this.postPause();
        this.startUpdatingProgress();
    }

    private async restoreQueueAsync(): Promise<void> {
        // If already playing (e.g. from double-clicking files), do not restore queue.
        if (this.currentTrack) {
            this.logger.info('Playback already in progress, not restoring playback queue', 'PlaybackService', 'restoreQueue');
            return;
        }

        this.logger.info('Restoring playback queue', 'PlaybackService', 'restoreQueue');

        const info: QueueRestoreInfo = this.queuePersister.restore();
        this.queue.restoreTracks(info.tracks, info.playbackOrder);
        this.logger.info(`Restored ${info.tracks.length} tracks to playback queue`, 'PlaybackService', 'restoreQueue');

        if (info.playingTrack) {
            this.logger.info(
                `Restoring playback to track: ${info.playingTrack.path} at ${info.progressSeconds} seconds`,
                'PlaybackService',
                'restoreQueue',
            );
            await this.startPausedAsync(info.playingTrack, info.progressSeconds);
        }
    }

    public getCurrentProgress(): PlaybackProgress {
        return new PlaybackProgress(this.audioPlayer.progressSeconds, this.audioPlayer.totalSeconds);
    }

    private updateMediaSessionPlaybackState(): void {
        if (this.currentTrack == undefined || !this._isPlaying) {
            return;
        }

        this.mediaSessionService.updatePlaybackState(
            this.audioPlayer.totalSeconds,
            this.audioPlayer.progressSeconds,
            this._playbackSpeed,
            this._canPause,
        );
    }

    private reportProgress(): void {
        if (this._shouldReportProgress) {
            this._progress = this.getCurrentProgress();
            this.updateMediaSessionPlaybackState();
            this.progressChanged.next(this._progress);
        }
    }

    private startUpdatingProgress(): void {
        this._shouldReportProgress = true;
        this.reportProgress();

        if (this._progressInterval === 0) {
            this._progressInterval = window.setInterval(() => {
                this.reportProgress();
            }, 500);
        }
    }

    public stopUpdatingProgress(): void {
        this.pauseUpdatingProgress();
        this._progress = new PlaybackProgress(0, 0);
        this.progressChanged.next(this._progress);
    }

    public pauseUpdatingProgress(): void {
        this._shouldReportProgress = false;
    }

    public updateQueueTracks(tracks: Track[]): void {
        const tracksInQueue: TrackModel[] = this.queue.tracks.filter((qt) => tracks.map((t) => t.path).includes(qt.path));

        for (const trackInQueue of tracksInQueue) {
            const trackToSet = tracks.find((t) => t.path === trackInQueue.path);

            if (trackToSet) {
                trackInQueue.setTrack(trackToSet);

                if (this.currentTrack && this.currentTrack.path === trackInQueue.path) {
                    this.currentTrack = trackInQueue;
                    this.applyEffectiveVolumeForCurrentTrack();
                    // this.playbackStarted.next(new PlaybackStarted(trackInQueue, false));
                }
            }
        }
    }
}
