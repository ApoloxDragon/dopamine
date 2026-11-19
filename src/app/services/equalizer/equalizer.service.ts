import { Injectable } from '@angular/core';
import { EqualizerMode, EqualizerServiceBase } from './equalizer.service.base';
import { EqualizerFilter, ParametricBand, ParametricEqualizer, ParametricProfile } from './parametric-equalizer';
import { EqualizerPresets } from './equalizer-presets';
import { AudioEqualizer } from '../playback/audio-player/audio-equalizer';
import { SettingsBase } from '../../common/settings/settings.base';
import { Logger } from '../../common/logger';

@Injectable()
export class EqualizerService implements EqualizerServiceBase {
    public static readonly minimumGain: number = -12;
    public static readonly maximumGain: number = 12;

    private readonly _registeredEqualizers: Set<AudioEqualizer> = new Set<AudioEqualizer>();
    private _gains: number[] = new Array<number>(AudioEqualizer.frequencies.length).fill(0);
    private _isEnabled: boolean = false;
    private _selectedPreset: string = 'flat';
    private _isInitialized: boolean = false;
    private _mode: EqualizerMode = 'graphic';
    private _parametric: ParametricProfile = ParametricEqualizer.createDefaultProfile();

    public constructor(
        private settings: SettingsBase,
        private logger: Logger,
    ) {}

    public readonly bands: readonly number[] = AudioEqualizer.frequencies;

    public readonly presetNames: readonly string[] = Object.keys(EqualizerPresets.presets).concat(EqualizerPresets.manual);

    public get isEnabled(): boolean {
        this.ensureInitialized();
        return this._isEnabled;
    }

    public set isEnabled(value: boolean) {
        this.ensureInitialized();
        this._isEnabled = value;
        this.settings.audioEqualizerEnabled = value;
        this.applyToRegisteredEqualizers();
    }

    public get selectedPreset(): string {
        this.ensureInitialized();
        return this._selectedPreset;
    }

    public set selectedPreset(value: string) {
        this.applyPreset(value);
    }

    public get gains(): number[] {
        this.ensureInitialized();
        return [...this._gains];
    }

    public get mode(): EqualizerMode {
        this.ensureInitialized();
        return this._mode;
    }

    public set mode(value: EqualizerMode) {
        this.ensureInitialized();
        this._mode = value === 'parametric' ? 'parametric' : 'graphic';
        this.settings.audioEqualizerMode = this._mode;
        this.applyToRegisteredEqualizers();
    }

    /** A copy of the parametric profile (bands and preamp). */
    public get parametricProfile(): ParametricProfile {
        this.ensureInitialized();
        return { preamp: this._parametric.preamp, bands: this._parametric.bands.map((b) => ({ ...b })) };
    }

    public register(equalizer: AudioEqualizer): void {
        this.ensureInitialized();
        this._registeredEqualizers.add(equalizer);
        this.applyTo(equalizer);
    }

    public updateParametricBand(index: number, changes: Partial<ParametricBand>): void {
        this.ensureInitialized();

        if (index < 0 || index >= this._parametric.bands.length) {
            return;
        }

        const bands: ParametricBand[] = this._parametric.bands.map((b, i) => (i === index ? { ...b, ...changes } : b));
        this.setParametricProfile({ preamp: this._parametric.preamp, bands });
    }

    public addParametricBand(): void {
        this.ensureInitialized();

        if (this._parametric.bands.length >= ParametricEqualizer.maximumBands) {
            return;
        }

        // Start in the middle of the widest gap between existing bands (on a log scale), so new bands do not stack.
        const frequencies: number[] = [ParametricEqualizer.minimumFrequency, ...this._parametric.bands.map((b) => b.frequency).sort((a, b) => a - b), ParametricEqualizer.maximumFrequency];
        let best: number = 1000;
        let widest: number = 0;

        for (let i = 1; i < frequencies.length; i++) {
            const gap: number = Math.log10(frequencies[i]) - Math.log10(frequencies[i - 1]);

            if (gap > widest) {
                widest = gap;
                best = Math.sqrt(frequencies[i] * frequencies[i - 1]);
            }
        }

        this.setParametricProfile({ preamp: this._parametric.preamp, bands: [...this._parametric.bands, ParametricEqualizer.createBand(best)] });
    }

    public removeParametricBand(index: number): void {
        this.ensureInitialized();
        this.setParametricProfile({ preamp: this._parametric.preamp, bands: this._parametric.bands.filter((_, i) => i !== index) });
    }

    public setParametricPreamp(preampDb: number): void {
        this.ensureInitialized();
        this.setParametricProfile({ preamp: preampDb, bands: this._parametric.bands });
    }

    /** Lowers the preamp by the highest boost of the curve, so the equalizer can never push the signal above 0 dB. */
    public preventParametricClipping(): void {
        this.ensureInitialized();
        const peak: number = ParametricEqualizer.peakGainDb(ParametricEqualizer.toFilters(this._parametric));
        this.setParametricPreamp(-Math.ceil(peak * 10) / 10);
    }

    /** Replaces the parametric profile by AutoEQ / Equalizer APO text. Returns undefined when nothing could be read. */
    public importParametricText(text: string): { bands: number; skippedLines: number } | undefined {
        this.ensureInitialized();
        const result = ParametricEqualizer.parseApoText(text);

        if (result === undefined) {
            return undefined;
        }

        this.setParametricProfile(result.profile);

        return { bands: result.profile.bands.length, skippedLines: result.skippedLines };
    }

    public exportParametricText(): string {
        this.ensureInitialized();
        return ParametricEqualizer.toApoText(this._parametric);
    }

    public resetParametric(): void {
        this.ensureInitialized();
        this.setParametricProfile(ParametricEqualizer.createDefaultProfile());
    }

    public unregister(equalizer: AudioEqualizer): void {
        this._registeredEqualizers.delete(equalizer);
    }

    public setGain(index: number, gainInDecibels: number): void {
        this.ensureInitialized();

        if (index < 0 || index >= this._gains.length) {
            return;
        }

        const clampedGain: number = Math.max(EqualizerService.minimumGain, Math.min(EqualizerService.maximumGain, gainInDecibels));
        this._gains[index] = clampedGain;
        this._selectedPreset = EqualizerPresets.manual;

        this.persistGains();
        this.settings.audioEqualizerPreset = this._selectedPreset;
        this.applyToRegisteredEqualizers();
    }

    public applyPreset(presetName: string): void {
        this.ensureInitialized();

        const presetGains: number[] | undefined = EqualizerPresets.presets[presetName];

        if (presetGains === undefined) {
            return;
        }

        this._gains = [...presetGains];
        this._selectedPreset = presetName;

        this.persistGains();
        this.settings.audioEqualizerPreset = this._selectedPreset;
        this.applyToRegisteredEqualizers();
    }

    public reset(): void {
        this.applyPreset('flat');
    }

    private ensureInitialized(): void {
        if (this._isInitialized) {
            return;
        }

        this._isInitialized = true;

        try {
            this._isEnabled = this.settings.audioEqualizerEnabled;
            this._selectedPreset = this.settings.audioEqualizerPreset;
            this._gains = this.parseGains(this.settings.audioEqualizerGains);
            this._mode = this.settings.audioEqualizerMode === 'parametric' ? 'parametric' : 'graphic';
            this._parametric = ParametricEqualizer.deserialize(this.settings.audioEqualizerParametricProfile);
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load equalizer settings', 'EqualizerService', 'ensureInitialized');
            this._isEnabled = false;
            this._selectedPreset = 'flat';
            this._gains = new Array<number>(AudioEqualizer.frequencies.length).fill(0);
            this._mode = 'graphic';
            this._parametric = ParametricEqualizer.createDefaultProfile();
        }
    }

    private parseGains(value: string): number[] {
        const gains: number[] = new Array<number>(AudioEqualizer.frequencies.length).fill(0);

        if (!value) {
            return gains;
        }

        const parts: string[] = value.split(';');

        for (let i = 0; i < gains.length && i < parts.length; i++) {
            const parsed: number = parseFloat(parts[i]);
            gains[i] = isNaN(parsed) ? 0 : parsed;
        }

        return gains;
    }

    private persistGains(): void {
        this.settings.audioEqualizerGains = this._gains.join(';');
    }

    private setParametricProfile(profile: ParametricProfile): void {
        this._parametric = ParametricEqualizer.normalize(profile);
        this.settings.audioEqualizerParametricProfile = ParametricEqualizer.serialize(this._parametric);

        if (this._mode === 'parametric') {
            this.applyToRegisteredEqualizers();
        }
    }

    private effectiveFilters(): { filters: EqualizerFilter[]; preamp: number } {
        if (!this._isEnabled) {
            // Flat graphic filters: the same node layout as the graphic mode, so enabling/disabling it does not click.
            return { filters: AudioEqualizer.graphicFilters(new Array<number>(this._gains.length).fill(0)), preamp: 0 };
        }

        if (this._mode === 'parametric') {
            return { filters: ParametricEqualizer.toFilters(this._parametric), preamp: this._parametric.preamp };
        }

        return { filters: AudioEqualizer.graphicFilters(this._gains), preamp: 0 };
    }

    private applyTo(equalizer: AudioEqualizer): void {
        const effective = this.effectiveFilters();
        equalizer.setFilters(effective.filters, effective.preamp);
    }

    private applyToRegisteredEqualizers(): void {
        for (const equalizer of this._registeredEqualizers) {
            this.applyTo(equalizer);
        }
    }
}
