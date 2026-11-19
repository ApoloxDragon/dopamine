import { Observable, Subject } from 'rxjs';
import { IAudioPlayer } from './i-audio-player';
import { TrackModel } from '../../track/track-model';

/**
 * Routes playback between the configured player and a streaming player for CUE sheet tracks.
 *
 * CUE tracks are ranges of one single-file album (often 100+ MB). The gapless and crossfade players decode a whole file
 * into memory (about 1.3 GB for an hour of 44.1 kHz stereo) and decide when a track ends from the end of the file, so
 * they cannot play CUE tracks. CUE tracks therefore always go to a LegacyAudioPlayer, which streams the file and
 * supports ranges, including gapless continuation into the next range of the same file.
 *
 * Normal tracks keep using the player chosen in the settings. When the configured player is already a streaming
 * player, it is used for CUE tracks too. Otherwise the CUE player is only created when the first CUE track plays.
 */
export class CueAwareAudioPlayer implements IAudioPlayer {
    private _active: IAudioPlayer;
    private _cuePlayer: IAudioPlayer | undefined;
    private _playbackFinished: Subject<void> = new Subject();
    private _playbackFailed: Subject<string> = new Subject();
    private _playingPreloadedTrack: Subject<TrackModel> = new Subject();

    // Last applied settings, so a lazily created CUE player starts in the same state.
    private _volume: number | undefined;
    private _replayGainMultiplier: number | undefined;
    private _playbackRate: number | undefined;
    private _audioOutputDeviceId: string | undefined;

    public constructor(
        private mainPlayer: IAudioPlayer,
        private createCuePlayer: () => IAudioPlayer,
        private mainPlayerStreams: boolean,
    ) {
        this._active = mainPlayer;
        this.forwardEvents(mainPlayer);

        if (mainPlayerStreams) {
            this._cuePlayer = mainPlayer;
        }
    }

    public playbackFinished$: Observable<void> = this._playbackFinished.asObservable();
    public playbackFailed$: Observable<string> = this._playbackFailed.asObservable();
    public playingPreloadedTrack$: Observable<TrackModel> = this._playingPreloadedTrack.asObservable();

    public get progressSeconds(): number {
        return this._active.progressSeconds;
    }

    public get totalSeconds(): number {
        return this._active.totalSeconds;
    }

    public get analyser(): AnalyserNode {
        return this._active.analyser;
    }

    public get isPaused(): boolean {
        return this._active.isPaused;
    }

    public async playAsync(track: TrackModel): Promise<void> {
        await this.activateFor(track).playAsync(track);
    }

    public async startPausedAsync(track: TrackModel, skipSeconds: number): Promise<void> {
        await this.activateFor(track).startPausedAsync(track, skipSeconds);
    }

    public stop(): void {
        this._active.stop();
    }

    public pause(): void {
        this._active.pause();
    }

    public async resumeAsync(): Promise<void> {
        await this._active.resumeAsync();
    }

    public setVolume(volume: number, replayGainMultiplier?: number): void {
        this._volume = volume;
        this._replayGainMultiplier = replayGainMultiplier;
        this.forEachPlayer((p) => p.setVolume(volume, replayGainMultiplier));
    }

    public setPlaybackRate(rate: number): void {
        this._playbackRate = rate;
        this.forEachPlayer((p) => p.setPlaybackRate(rate));
    }

    public async skipToSecondsAsync(seconds: number): Promise<void> {
        await this._active.skipToSecondsAsync(seconds);
    }

    public preloadNext(track: TrackModel): void {
        // Never let the gapless/crossfade player preload a CUE track: it would decode the whole album file.
        // The streaming CUE player does not need a preload to continue gaplessly within a file.
        if (!track.isCueTrack) {
            this.mainPlayer.preloadNext(track);
        }
    }

    public getAudio(): HTMLAudioElement | undefined {
        return this._active.getAudio();
    }

    public fadeAsync(level: number, durationMs: number): Promise<void> {
        return this._active.fadeAsync(level, durationMs);
    }

    /** Applies to every player, so the next one to play starts at the right level too. */
    public setFadeLevel(level: number): void {
        this.forEachPlayer((p) => p.setFadeLevel(level));
    }

    public async setAudioOutputDeviceAsync(deviceId: string): Promise<void> {
        this._audioOutputDeviceId = deviceId;

        await this.mainPlayer.setAudioOutputDeviceAsync(deviceId);

        if (this._cuePlayer != undefined && this._cuePlayer !== this.mainPlayer) {
            await this._cuePlayer.setAudioOutputDeviceAsync(deviceId);
        }
    }

    private activateFor(track: TrackModel): IAudioPlayer {
        const target: IAudioPlayer = track.isCueTrack ? this.getOrCreateCuePlayer() : this.mainPlayer;

        if (target !== this._active) {
            // Switching between players: silence the one that was playing.
            this._active.stop();
            this._active = target;
        }

        return target;
    }

    private getOrCreateCuePlayer(): IAudioPlayer {
        if (this._cuePlayer == undefined) {
            const cuePlayer: IAudioPlayer = this.createCuePlayer();

            if (this._volume != undefined) {
                cuePlayer.setVolume(this._volume, this._replayGainMultiplier);
            }

            if (this._playbackRate != undefined) {
                cuePlayer.setPlaybackRate(this._playbackRate);
            }

            if (this._audioOutputDeviceId != undefined) {
                void cuePlayer.setAudioOutputDeviceAsync(this._audioOutputDeviceId);
            }

            this.forwardEvents(cuePlayer);
            this._cuePlayer = cuePlayer;
        }

        return this._cuePlayer;
    }

    private forEachPlayer(action: (player: IAudioPlayer) => void): void {
        action(this.mainPlayer);

        if (this._cuePlayer != undefined && this._cuePlayer !== this.mainPlayer) {
            action(this._cuePlayer);
        }
    }

    private forwardEvents(player: IAudioPlayer): void {
        // Only the active player's events matter: a player that was switched away from must not end or fail the queue.
        player.playbackFinished$.subscribe(() => {
            if (player === this._active) {
                this._playbackFinished.next();
            }
        });
        player.playbackFailed$.subscribe((path: string) => {
            if (player === this._active) {
                this._playbackFailed.next(path);
            }
        });
        player.playingPreloadedTrack$.subscribe((track: TrackModel) => {
            if (player === this._active) {
                this._playingPreloadedTrack.next(track);
            }
        });
    }
}
