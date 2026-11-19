import { Observable, Subject } from 'rxjs';
import { Logger } from '../../../common/logger';
import { MathExtensions } from '../../../common/math-extensions';
import { IAudioPlayer } from './i-audio-player';
import { TrackModel } from '../../track/track-model';
import { PathUtils } from '../../../common/utils/path-utils';
import { AudioEqualizer } from './audio-equalizer';
import { EqualizerServiceBase } from '../../equalizer/equalizer.service.base';
import { SettingsBase } from '../../../common/settings/settings.base';

export class LegacyAudioPlayer implements IAudioPlayer {
    private _audio: HTMLAudioElement;
    private _playbackFinished: Subject<void> = new Subject();
    private _playbackFailed: Subject<string> = new Subject();
    private _playingPreloadedTrack: Subject<TrackModel> = new Subject();
    private _audioContext: AudioContext;
    private _analyser: AnalyserNode;
    private _equalizer: AudioEqualizer;
    private _mediaElementSource: MediaElementAudioSourceNode | undefined;
    private _isPaused: boolean = false;
    private shouldPauseAfterStarting: boolean = false;
    private skipSecondsAfterStarting: number = 0;

    // CUE sheet tracks (a range of a single-file album). See docs/cue-support/LOG.md.
    // _cueRange is the range of the current track in the audio file, in seconds; undefined for normal tracks.
    private static readonly cueEndCheckIntervalMs: number = 50;
    private static readonly cueContinuityToleranceSeconds: number = 0.25;
    private static readonly cueOverrunPauseDelayMs: number = 1000;
    private _cueRange: { start: number; end: number } | undefined;
    private _loadedAudioPath: string = '';
    private _cueEndCheckId: ReturnType<typeof setInterval> | undefined;
    private _cueOverrunTimeoutId: ReturnType<typeof setTimeout> | undefined;
    private _cueTrackFinished: boolean = false;

    public constructor(
        private mathExtensions: MathExtensions,
        private equalizerService: EqualizerServiceBase,
        private logger: Logger,
        private settings: SettingsBase,
    ) {
        this._audio = new Audio();
        this._audioContext = new AudioContext();

        this._analyser = this._audioContext.createAnalyser();
        this._analyser.fftSize = 128;

        this._equalizer = new AudioEqualizer(this._audioContext);
        this._equalizer.output.connect(this._analyser);
        this._analyser.connect(this._audioContext.destination);
        this.equalizerService.register(this._equalizer);

        this.connectVisualizer();

        try {
            // This fails during unit tests because setSinkId() does not exist on HTMLAudioElement
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            this._audio.setSinkId('default');
        } catch (e: unknown) {
            // Suppress this error, but log it, in case it happens in production.
            this.logger.error(e, 'Could not perform setSinkId()', 'AudioPlayer', 'constructor');
        }

        this._audio.defaultPlaybackRate = 1;
        this._audio.playbackRate = 1;
        this._audio.volume = 1;
        this._audio.muted = false;

        this.setAudioOutputDeviceAsync(this.settings.preferredAudioOutputDeviceId);
    }

    public async setAudioOutputDeviceAsync(deviceId: string): Promise<void> {
        try {
            // setSinkId() on AudioContext is not yet part of the TS lib.dom typings.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
            await (this._audioContext as any).setSinkId(deviceId || 'default');
        } catch (e: unknown) {
            this.logger.error(e, `Could not set audio output device '${deviceId}'`, 'LegacyAudioPlayer', 'setAudioOutputDeviceAsync');
        }
    }

    public playbackFinished$: Observable<void> = this._playbackFinished.asObservable();
    public playbackFailed$: Observable<string> = this._playbackFailed.asObservable();
    public playingPreloadedTrack$: Observable<TrackModel> = this._playingPreloadedTrack.asObservable();

    public get analyser(): AnalyserNode {
        return this._analyser;
    }

    public get isPaused(): boolean {
        return this._isPaused;
    }

    public get progressSeconds(): number {
        if (isNaN(this._audio.currentTime)) {
            return 0;
        }

        if (this._cueRange != undefined) {
            const length: number = this._cueRange.end - this._cueRange.start;
            return Math.min(Math.max(0, this._audio.currentTime - this._cueRange.start), length);
        }

        return this._audio.currentTime;
    }

    public get totalSeconds(): number {
        if (this._cueRange != undefined) {
            return this._cueRange.end - this._cueRange.start;
        }

        if (isNaN(this._audio.duration)) {
            return 0;
        }

        return this._audio.duration;
    }

    public async playAsync(track: TrackModel): Promise<void> {
        if (track.isCueTrack) {
            await this.playCueTrackAsync(track);
            return;
        }

        this.clearCueState();
        this._loadedAudioPath = track.path;

        const playableAudioFilePath: string = PathUtils.createPlayableAudioFilePath(track.path);

        // This is a workaround to fix flickering of OS media controls when switching track from the media controls
        const tempAudio: HTMLAudioElement = new Audio();
        tempAudio.volume = this._audio.volume;
        tempAudio.src = playableAudioFilePath;
        tempAudio.muted = this._audio.muted;
        tempAudio.defaultPlaybackRate = this._audio.defaultPlaybackRate;
        tempAudio.playbackRate = this._audio.playbackRate;

        this._audio.onended = () => {
            // Intentionally left blank
        };

        this.releaseAudio(this._audio);
        this._audio = tempAudio;

        this.connectVisualizer();

        this._isPaused = false;

        const audio: HTMLAudioElement = this._audio;

        try {
            await audio.play();

            if (audio !== this._audio) {
                // A newer track was requested while this one was starting.
                return;
            }

            this._audio.onended = () => this._playbackFinished.next();

            if (this.shouldPauseAfterStarting) {
                this.pause();
                await this.skipToSecondsAsync(this.skipSecondsAfterStarting);
                this.shouldPauseAfterStarting = false;
                this.skipSecondsAfterStarting = 0;
            }
        } catch (e: unknown) {
            if (audio !== this._audio) {
                // play() was aborted because a newer track was requested while this one was starting.
                return;
            }

            if (this._isPaused && e instanceof DOMException && e.name === 'AbortError') {
                // play() was aborted because pause() was called while the track was starting.
                this._audio.onended = () => this._playbackFinished.next();

                if (this.shouldPauseAfterStarting) {
                    await this.skipToSecondsAsync(this.skipSecondsAfterStarting);
                    this.shouldPauseAfterStarting = false;
                    this.skipSecondsAfterStarting = 0;
                }

                return;
            }

            this.logger.error(e, `Audio src failed to load: ${this._audio.src}`, 'LegacyAudioPlayer', 'play');
            this.shouldPauseAfterStarting = false;
            this.skipSecondsAfterStarting = 0;

            this._playbackFailed.next(this._audio.src);
        }
    }

    public async startPausedAsync(track: TrackModel, skipSeconds: number): Promise<void> {
        this.shouldPauseAfterStarting = true;
        this.skipSecondsAfterStarting = skipSeconds;
        await this.playAsync(track);
    }

    public stop(): void {
        this._audio.currentTime = this._cueRange?.start ?? 0;
        this._audio.pause();
    }

    public pause(): void {
        this._isPaused = true;
        this._audio.pause();
    }

    public async resumeAsync(): Promise<void> {
        await this._audio.play();
        this._isPaused = false;
    }

    public setVolume(linearVolume: number, replayGainMultiplier: number = 1): void {
        // log(0) is undefined. So we provide a minimum of 0.01.
        const logarithmicVolume: number = linearVolume > 0 ? this.mathExtensions.linearToLogarithmic(linearVolume, 0.01, 1) : 0;
        // HTMLAudioElement.volume must be in [0, 1].
        this._audio.volume = Math.min(1, logarithmicVolume * replayGainMultiplier);
    }

    public setPlaybackRate(rate: number): void {
        this._audio.defaultPlaybackRate = rate;
        this._audio.playbackRate = rate;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async skipToSecondsAsync(seconds: number): Promise<void> {
        // For CUE tracks, seconds are relative to the start of the track.
        this._audio.currentTime = (this._cueRange?.start ?? 0) + seconds;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public preloadNext(track: TrackModel): void {
        // Not implemented as not supported by legacy audio player.
    }

    public fadeAsync(level: number, durationMs: number): Promise<void> {
        return this._equalizer.fadeAsync(level, durationMs);
    }

    public setFadeLevel(level: number): void {
        this._equalizer.setFadeLevel(level);
    }

    public getAudio(): HTMLAudioElement | undefined {
        return this._audio;
    }

    /**
     * Plays a CUE track: a range of a single-file album. The album file is streamed (never fully decoded in memory).
     *
     * Gapless between CUE tracks: when the end of a track is reached, playbackFinished is emitted but the audio keeps
     * playing. If the next track is the adjacent range of the same file, the element is already at its start, so it is
     * neither reloaded nor seeked: the audio stays continuous and only the reported range changes.
     */
    private async playCueTrackAsync(track: TrackModel): Promise<void> {
        const start: number = track.cueStartSeconds;
        const end: number = track.cueEndSeconds;
        const isSameFile: boolean = this._loadedAudioPath === track.audioPath && this._audio.getAttribute('src') != undefined;

        this.stopCueEndCheck();
        this._cueRange = { start, end };
        this._cueTrackFinished = false;
        this._isPaused = false;

        let audio: HTMLAudioElement = this._audio;

        if (!isSameFile) {
            const tempAudio: HTMLAudioElement = new Audio();
            tempAudio.volume = this._audio.volume;
            tempAudio.src = PathUtils.createPlayableAudioFilePath(track.audioPath);
            tempAudio.muted = this._audio.muted;
            tempAudio.defaultPlaybackRate = this._audio.defaultPlaybackRate;
            tempAudio.playbackRate = this._audio.playbackRate;

            this._audio.onended = () => {
                // Intentionally left blank
            };

            this.releaseAudio(this._audio);
            this._audio = tempAudio;
            this._loadedAudioPath = track.audioPath;
            this.connectVisualizer();
            audio = tempAudio;
        }

        try {
            if (!isSameFile) {
                await this.waitForMetadataAsync(audio);
            }

            if (audio !== this._audio || this._cueRange?.start !== start) {
                // A newer track was requested while this one was loading.
                return;
            }

            // Only seek when not already there: a track that follows the previous one in the same file plays on gaplessly.
            if (Math.abs(audio.currentTime - start) > LegacyAudioPlayer.cueContinuityToleranceSeconds) {
                audio.currentTime = start;
            }

            audio.onended = () => this.finishCueTrack();

            if (audio.paused) {
                await audio.play();
            }

            if (audio !== this._audio) {
                return;
            }

            this.startCueEndCheck();

            if (this.shouldPauseAfterStarting) {
                this.pause();
                await this.skipToSecondsAsync(this.skipSecondsAfterStarting);
                this.shouldPauseAfterStarting = false;
                this.skipSecondsAfterStarting = 0;
            }
        } catch (e: unknown) {
            if (audio !== this._audio) {
                return;
            }

            if (this._isPaused && e instanceof DOMException && e.name === 'AbortError') {
                // play() was aborted because pause() was called while the track was starting.
                this.startCueEndCheck();

                if (this.shouldPauseAfterStarting) {
                    await this.skipToSecondsAsync(this.skipSecondsAfterStarting);
                    this.shouldPauseAfterStarting = false;
                    this.skipSecondsAfterStarting = 0;
                }

                return;
            }

            this.logger.error(e, `CUE track failed to load: ${track.path}`, 'LegacyAudioPlayer', 'playCueTrackAsync');
            this.shouldPauseAfterStarting = false;
            this.skipSecondsAfterStarting = 0;

            this._playbackFailed.next(track.audioPath);
        }
    }

    private waitForMetadataAsync(audio: HTMLAudioElement): Promise<void> {
        if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve, reject) => {
            const cleanup = (): void => {
                audio.removeEventListener('loadedmetadata', onLoaded);
                audio.removeEventListener('error', onError);
            };
            const onLoaded = (): void => {
                cleanup();
                resolve();
            };
            const onError = (): void => {
                cleanup();
                reject(new Error(`Could not load audio metadata for ${audio.src}`));
            };

            audio.addEventListener('loadedmetadata', onLoaded);
            audio.addEventListener('error', onError);
        });
    }

    private startCueEndCheck(): void {
        this.stopCueEndCheck();
        this._cueEndCheckId = setInterval(() => this.checkCueEnd(), LegacyAudioPlayer.cueEndCheckIntervalMs);
    }

    private stopCueEndCheck(): void {
        if (this._cueEndCheckId != undefined) {
            clearInterval(this._cueEndCheckId);
            this._cueEndCheckId = undefined;
        }

        if (this._cueOverrunTimeoutId != undefined) {
            clearTimeout(this._cueOverrunTimeoutId);
            this._cueOverrunTimeoutId = undefined;
        }
    }

    private checkCueEnd(): void {
        if (this._cueRange == undefined || this._cueTrackFinished || this._audio.paused) {
            return;
        }

        // The last track of the file ends at the end of the file: the 'ended' event reports that exactly.
        const fileDuration: number = this._audio.duration;
        const endsAtEndOfFile: boolean = isNaN(fileDuration) || this._cueRange.end >= fileDuration - 0.05;

        if (!endsAtEndOfFile && this._audio.currentTime >= this._cueRange.end) {
            this.finishCueTrack();
        }
    }

    private finishCueTrack(): void {
        if (this._cueTrackFinished) {
            return;
        }

        this._cueTrackFinished = true;

        // Keep playing: the next track is usually the next range of this file (gapless). If nothing takes over
        // (no next track, or the next track is in another file and failed to start), stop overrunning into the next song.
        this._cueOverrunTimeoutId = setTimeout(() => {
            if (this._cueTrackFinished) {
                this._audio.pause();
            }
        }, LegacyAudioPlayer.cueOverrunPauseDelayMs);

        this._playbackFinished.next();
    }

    private clearCueState(): void {
        this.stopCueEndCheck();
        this._cueRange = undefined;
        this._cueTrackFinished = false;
    }

    private connectVisualizer(): void {
        // Each track gets a new HTMLAudioElement, and therefore a new MediaElementAudioSourceNode. The previous
        // source node must be disconnected: connected nodes are never garbage collected and keep being processed
        // on the audio render thread, so leaking one per track makes playback glitch more and more over time.
        this._mediaElementSource?.disconnect();
        this._mediaElementSource = this._audioContext.createMediaElementSource(this._audio);
        this._mediaElementSource.connect(this._equalizer.input);
    }

    private releaseAudio(audio: HTMLAudioElement): void {
        // Free the decoder and media resources held by an element that is no longer used.
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    }
}
