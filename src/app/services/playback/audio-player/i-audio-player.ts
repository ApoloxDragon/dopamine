import { Observable } from 'rxjs';
import { TrackModel } from '../../track/track-model';

export interface IAudioPlayer {
    playbackFinished$: Observable<void>;
    playbackFailed$: Observable<string>;
    playingPreloadedTrack$: Observable<TrackModel>;
    progressSeconds: number;
    totalSeconds: number;
    analyser: AnalyserNode;
    isPaused: boolean;
    playAsync(track: TrackModel): Promise<void>;
    startPausedAsync(track: TrackModel, skipSeconds: number): Promise<void>;
    stop(): void;
    pause(): void;
    resumeAsync(): Promise<void>;
    setVolume(volume: number, replayGainMultiplier?: number): void;
    setPlaybackRate(rate: number): void;
    skipToSecondsAsync(seconds: number): Promise<void>;
    preloadNext(track: TrackModel): void;
    getAudio(): HTMLAudioElement | undefined;
    /** Fades the output to the level (0 = silent, 1 = full) over the duration. Resolves when done. */
    fadeAsync(level: number, durationMs: number): Promise<void>;
    /** Sets the fade level at once, cancelling a fade in progress. */
    setFadeLevel(level: number): void;
    setAudioOutputDeviceAsync(deviceId: string): Promise<void>;
}
