/**
 * Parametric equalizer: data model, limits, the AutoEQ / Equalizer APO text format, and the frequency response.
 * Pure code (no Web Audio), so it can be unit tested and used to draw the response curve.
 */

export type ParametricFilterType = 'peaking' | 'lowshelf' | 'highshelf' | 'lowpass' | 'highpass' | 'notch';

export interface ParametricBand {
    enabled: boolean;
    type: ParametricFilterType;
    /** Hz */
    frequency: number;
    /** dB. Not used by low-pass, high-pass and notch filters. */
    gain: number;
    /** Linear Q (bandwidth). Shelf filters use a fixed slope in Web Audio (equivalent to Q 0.71) and ignore it. */
    q: number;
}

export interface ParametricProfile {
    /** dB applied before the filters, to make room for boosts without clipping. */
    preamp: number;
    bands: ParametricBand[];
}

/** A filter as applied to the audio graph (see AudioEqualizer). */
export interface EqualizerFilter {
    type: ParametricFilterType;
    frequency: number;
    gain: number;
    q: number;
}

export class ParametricEqualizer {
    public static readonly filterTypes: ParametricFilterType[] = ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'notch'];
    public static readonly maximumBands: number = 20;
    public static readonly minimumFrequency: number = 20;
    public static readonly maximumFrequency: number = 20000;
    public static readonly minimumGain: number = -24;
    public static readonly maximumGain: number = 24;
    public static readonly minimumQ: number = 0.1;
    public static readonly maximumQ: number = 20;
    public static readonly minimumPreamp: number = -30;
    public static readonly maximumPreamp: number = 12;
    /** Web Audio shelf filters have a fixed slope S = 1, which corresponds to this Q. */
    public static readonly shelfQ: number = Math.SQRT1_2;

    public static createDefaultProfile(): ParametricProfile {
        return {
            preamp: 0,
            bands: [
                { enabled: true, type: 'lowshelf', frequency: 105, gain: 0, q: 0.71 },
                { enabled: true, type: 'peaking', frequency: 300, gain: 0, q: 1 },
                { enabled: true, type: 'peaking', frequency: 1000, gain: 0, q: 1 },
                { enabled: true, type: 'peaking', frequency: 3000, gain: 0, q: 1 },
                { enabled: true, type: 'highshelf', frequency: 10000, gain: 0, q: 0.71 },
            ],
        };
    }

    public static createBand(frequency: number = 1000): ParametricBand {
        return { enabled: true, type: 'peaking', frequency: ParametricEqualizer.clampFrequency(frequency), gain: 0, q: 1 };
    }

    public static usesGain(type: ParametricFilterType): boolean {
        return type === 'peaking' || type === 'lowshelf' || type === 'highshelf';
    }

    public static usesQ(type: ParametricFilterType): boolean {
        return type !== 'lowshelf' && type !== 'highshelf';
    }

    public static clampFrequency(value: number): number {
        return ParametricEqualizer.clamp(value, ParametricEqualizer.minimumFrequency, ParametricEqualizer.maximumFrequency, 1000);
    }

    /** Returns a copy with every value inside the allowed range and at most maximumBands bands. */
    public static normalize(profile: ParametricProfile): ParametricProfile {
        const p = ParametricEqualizer;

        return {
            preamp: p.round(p.clamp(profile.preamp, p.minimumPreamp, p.maximumPreamp, 0), 1),
            bands: (profile.bands ?? []).slice(0, p.maximumBands).map((b) => ({
                enabled: b.enabled !== false,
                type: p.filterTypes.includes(b.type) ? b.type : 'peaking',
                frequency: Math.round(p.clampFrequency(b.frequency)),
                gain: p.round(p.clamp(b.gain, p.minimumGain, p.maximumGain, 0), 1),
                q: p.round(p.clamp(b.q, p.minimumQ, p.maximumQ, 1), 2),
            })),
        };
    }

    /** The filters to put in the audio graph: enabled bands only. */
    public static toFilters(profile: ParametricProfile): EqualizerFilter[] {
        return profile.bands.filter((b) => b.enabled).map((b) => ({ type: b.type, frequency: b.frequency, gain: b.gain, q: b.q }));
    }

    // ---- Settings storage ----

    public static serialize(profile: ParametricProfile): string {
        return JSON.stringify(ParametricEqualizer.normalize(profile));
    }

    /** Reads a stored profile. Returns the default profile when the value is empty or invalid. */
    public static deserialize(value: string | undefined): ParametricProfile {
        if (value == undefined || value.trim().length === 0) {
            return ParametricEqualizer.createDefaultProfile();
        }

        try {
            const parsed: ParametricProfile = JSON.parse(value) as ParametricProfile;

            if (parsed == undefined || !Array.isArray(parsed.bands)) {
                return ParametricEqualizer.createDefaultProfile();
            }

            return ParametricEqualizer.normalize(parsed);
        } catch {
            return ParametricEqualizer.createDefaultProfile();
        }
    }

    // ---- AutoEQ / Equalizer APO text format ----
    //   Preamp: -6.2 dB
    //   Filter 1: ON PK Fc 105 Hz Gain 5.5 dB Q 0.70
    //   Filter 2: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.70

    private static readonly apoTypes: { [code: string]: ParametricFilterType } = {
        PK: 'peaking',
        PEQ: 'peaking',
        LS: 'lowshelf',
        LSC: 'lowshelf',
        LSQ: 'lowshelf',
        HS: 'highshelf',
        HSC: 'highshelf',
        HSQ: 'highshelf',
        LP: 'lowpass',
        LPQ: 'lowpass',
        HP: 'highpass',
        HPQ: 'highpass',
        NO: 'notch',
    };

    /**
     * Parses AutoEQ "ParametricEQ.txt" / Equalizer APO filter text. Unknown lines are ignored.
     * Returns undefined when no filter line could be read.
     */
    public static parseApoText(text: string): { profile: ParametricProfile; skippedLines: number } | undefined {
        const bands: ParametricBand[] = [];
        let preamp: number = 0;
        let skippedLines: number = 0;

        for (const rawLine of text.split(/\r\n|\r|\n/)) {
            const line: string = rawLine.trim();

            if (line.length === 0 || line.startsWith('#')) {
                continue;
            }

            const preampMatch: RegExpExecArray | null = /^preamp\s*:\s*([-+]?\d+(?:[.,]\d+)?)\s*db/i.exec(line);

            if (preampMatch) {
                preamp = ParametricEqualizer.parseNumber(preampMatch[1]);
                continue;
            }

            const filterMatch: RegExpExecArray | null = /^filter(?:\s*\d+)?\s*:\s*(on|off)\s+([a-z]+)\s+(.*)$/i.exec(line);

            if (!filterMatch) {
                skippedLines++;
                continue;
            }

            const type: ParametricFilterType | undefined = ParametricEqualizer.apoTypes[filterMatch[2].toUpperCase()];
            const frequency: number | undefined = ParametricEqualizer.readValue(filterMatch[3], /fc\s+([-+]?\d+(?:[.,]\d+)?)\s*hz/i);

            if (type === undefined || frequency === undefined) {
                skippedLines++;
                continue;
            }

            const gain: number = ParametricEqualizer.readValue(filterMatch[3], /gain\s+([-+]?\d+(?:[.,]\d+)?)\s*db/i) ?? 0;
            const q: number = ParametricEqualizer.readValue(filterMatch[3], /\bq\s+([-+]?\d+(?:[.,]\d+)?)/i) ?? 0.71;

            bands.push({ enabled: filterMatch[1].toLowerCase() === 'on', type, frequency, gain, q });
        }

        if (bands.length === 0) {
            return undefined;
        }

        return { profile: ParametricEqualizer.normalize({ preamp, bands }), skippedLines };
    }

    public static toApoText(profile: ParametricProfile): string {
        const codes: { [type in ParametricFilterType]: string } = {
            peaking: 'PK',
            lowshelf: 'LSC',
            highshelf: 'HSC',
            lowpass: 'LPQ',
            highpass: 'HPQ',
            notch: 'NO',
        };
        const lines: string[] = [`Preamp: ${profile.preamp.toFixed(1)} dB`];

        profile.bands.forEach((b, i) => {
            const gain: string = ParametricEqualizer.usesGain(b.type) ? ` Gain ${b.gain.toFixed(1)} dB` : '';
            lines.push(`Filter ${i + 1}: ${b.enabled ? 'ON' : 'OFF'} ${codes[b.type]} Fc ${Math.round(b.frequency)} Hz${gain} Q ${b.q.toFixed(2)}`);
        });

        return lines.join('\n') + '\n';
    }

    // ---- Frequency response ----

    /** Log-spaced frequencies from 20 Hz to 20 kHz, for drawing the response curve. */
    public static responseFrequencies(points: number): number[] {
        const min: number = Math.log10(ParametricEqualizer.minimumFrequency);
        const max: number = Math.log10(ParametricEqualizer.maximumFrequency);
        return Array.from({ length: points }, (_, i) => Math.pow(10, min + ((max - min) * i) / (points - 1)));
    }

    /**
     * Total response in dB (filters and preamp) at the given frequencies, using the same biquad formulas as the
     * Web Audio BiquadFilterNode (Audio EQ Cookbook, with Web Audio's dB Q for low-pass/high-pass and S = 1 shelves).
     */
    public static responseDb(filters: EqualizerFilter[], preamp: number, frequencies: number[], sampleRate: number = 48000): number[] {
        const coefficients = filters.map((f) => ParametricEqualizer.coefficients(f, sampleRate));

        return frequencies.map((frequency) => {
            const w: number = (2 * Math.PI * frequency) / sampleRate;
            let db: number = preamp;

            for (const c of coefficients) {
                db += ParametricEqualizer.magnitudeDb(c, w);
            }

            return db;
        });
    }

    /** Biquad coefficients [b0, b1, b2, a0, a1, a2] as defined for BiquadFilterNode in the Web Audio spec. */
    public static coefficients(filter: EqualizerFilter, sampleRate: number): number[] {
        const nyquist: number = sampleRate / 2;
        const f0: number = Math.min(filter.frequency, nyquist * 0.999);
        const w0: number = (2 * Math.PI * f0) / sampleRate;
        const cos: number = Math.cos(w0);
        const sin: number = Math.sin(w0);
        const A: number = Math.pow(10, filter.gain / 40);

        switch (filter.type) {
            case 'lowpass':
            case 'highpass': {
                // Web Audio interprets Q of low-pass/high-pass in dB.
                const qDb: number = ParametricEqualizer.linearQToDb(filter.q);
                const alpha: number = sin / (2 * Math.pow(10, qDb / 20));

                return filter.type === 'lowpass'
                    ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha]
                    : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
            }
            case 'notch': {
                const alpha: number = sin / (2 * filter.q);
                return [1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha];
            }
            case 'lowshelf':
            case 'highshelf': {
                // S = 1 (Web Audio): alpha = sin(w0) / 2 * sqrt(2)
                const alpha: number = (sin / 2) * Math.SQRT2;
                const twoSqrtAAlpha: number = 2 * Math.sqrt(A) * alpha;

                if (filter.type === 'lowshelf') {
                    return [
                        A * (A + 1 - (A - 1) * cos + twoSqrtAAlpha),
                        2 * A * (A - 1 - (A + 1) * cos),
                        A * (A + 1 - (A - 1) * cos - twoSqrtAAlpha),
                        A + 1 + (A - 1) * cos + twoSqrtAAlpha,
                        -2 * (A - 1 + (A + 1) * cos),
                        A + 1 + (A - 1) * cos - twoSqrtAAlpha,
                    ];
                }

                return [
                    A * (A + 1 + (A - 1) * cos + twoSqrtAAlpha),
                    -2 * A * (A - 1 + (A + 1) * cos),
                    A * (A + 1 + (A - 1) * cos - twoSqrtAAlpha),
                    A + 1 - (A - 1) * cos + twoSqrtAAlpha,
                    2 * (A - 1 - (A + 1) * cos),
                    A + 1 - (A - 1) * cos - twoSqrtAAlpha,
                ];
            }
            case 'peaking':
            default: {
                const alpha: number = sin / (2 * filter.q);
                return [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
            }
        }
    }

    /** Web Audio expects the Q of low-pass/high-pass filters in dB (resonance). AutoEQ and APO use linear Q. */
    public static linearQToDb(q: number): number {
        return 20 * Math.log10(Math.max(q, 0.0001));
    }

    /** The highest boost of the response (filters only), to suggest a preamp that prevents clipping. */
    public static peakGainDb(filters: EqualizerFilter[]): number {
        const response: number[] = ParametricEqualizer.responseDb(filters, 0, ParametricEqualizer.responseFrequencies(400));
        return Math.max(0, ...response);
    }

    private static magnitudeDb(c: number[], w: number): number {
        // H(e^jw) = (b0 + b1 e^-jw + b2 e^-2jw) / (a0 + a1 e^-jw + a2 e^-2jw)
        const cos1: number = Math.cos(w);
        const sin1: number = Math.sin(w);
        const cos2: number = Math.cos(2 * w);
        const sin2: number = Math.sin(2 * w);
        const numRe: number = c[0] + c[1] * cos1 + c[2] * cos2;
        const numIm: number = -(c[1] * sin1 + c[2] * sin2);
        const denRe: number = c[3] + c[4] * cos1 + c[5] * cos2;
        const denIm: number = -(c[4] * sin1 + c[5] * sin2);
        const magnitude: number = Math.sqrt((numRe * numRe + numIm * numIm) / (denRe * denRe + denIm * denIm));

        return 20 * Math.log10(Math.max(magnitude, 1e-12));
    }

    private static readValue(text: string, pattern: RegExp): number | undefined {
        const match: RegExpExecArray | null = pattern.exec(text);
        return match ? ParametricEqualizer.parseNumber(match[1]) : undefined;
    }

    private static parseNumber(value: string): number {
        return parseFloat(value.replace(',', '.'));
    }

    private static clamp(value: number, min: number, max: number, fallback: number): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, value));
    }

    private static round(value: number, decimals: number): number {
        const factor: number = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }
}
