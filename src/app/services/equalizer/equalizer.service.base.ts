import { AudioEqualizer } from '../playback/audio-player/audio-equalizer';
import { ParametricBand, ParametricProfile } from './parametric-equalizer';

export type EqualizerMode = 'graphic' | 'parametric';

/** What an import did. 'parametric': filters were loaded. 'graphic': a GraphicEQ curve was fitted to the 10 bands. */
export type EqualizerImportResult =
    | { kind: 'parametric'; bands: number; skippedLines: number }
    | { kind: 'graphic'; points: number; rmsErrorDb: number; maxErrorDb: number; maxErrorFrequency: number };

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
    /** Imports AutoEQ / Equalizer APO text (parametric filters or a GraphicEQ curve) and switches to the matching mode. */
    public abstract importText(text: string): EqualizerImportResult | undefined;
    /** Exports the current mode: Equalizer APO filters (parametric) or a GraphicEQ curve (graphic). */
    public abstract exportText(): string;
    public abstract resetParametric(): void;
}
