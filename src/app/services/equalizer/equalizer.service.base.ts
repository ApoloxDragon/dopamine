import { AudioEqualizer } from '../playback/audio-player/audio-equalizer';
import { ParametricBand, ParametricProfile } from './parametric-equalizer';

export type EqualizerMode = 'graphic' | 'parametric';

export abstract class EqualizerServiceBase {
    public abstract readonly bands: readonly number[];
    public abstract readonly presetNames: readonly string[];
    public abstract isEnabled: boolean;
    public abstract selectedPreset: string;
    public abstract mode: EqualizerMode;
    public abstract get gains(): number[];
    public abstract get parametricProfile(): ParametricProfile;
    public abstract register(equalizer: AudioEqualizer): void;
    public abstract unregister(equalizer: AudioEqualizer): void;
    public abstract setGain(index: number, gainInDecibels: number): void;
    public abstract applyPreset(presetName: string): void;
    public abstract reset(): void;
    public abstract updateParametricBand(index: number, changes: Partial<ParametricBand>): void;
    public abstract addParametricBand(): void;
    public abstract removeParametricBand(index: number): void;
    public abstract setParametricPreamp(preampDb: number): void;
    public abstract preventParametricClipping(): void;
    public abstract importParametricText(text: string): { bands: number; skippedLines: number } | undefined;
    public abstract exportParametricText(): string;
    public abstract resetParametric(): void;
}
