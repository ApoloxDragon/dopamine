import { EqualizerFilter, ParametricEqualizer, ParametricProfile } from './parametric-equalizer';

// Typical AutoEQ ParametricEQ.txt (headphone correction profile)
const autoEq = `Preamp: -6.2 dB
Filter 1: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.70
Filter 2: ON PK Fc 21 Hz Gain 7.4 dB Q 0.47
Filter 3: ON PK Fc 3456 Hz Gain -4.2 dB Q 2.13
Filter 4: OFF PK Fc 6200 Hz Gain 3.0 dB Q 4.00
Filter 5: ON HSC Fc 10000 Hz Gain -2.1 dB Q 0.70
`;

describe('ParametricEqualizer', () => {
    const p = ParametricEqualizer;

    describe('parseApoText', () => {
        it('should read the preamp and every filter of an AutoEQ profile', () => {
            const result = p.parseApoText(autoEq)!;

            expect(result.profile.preamp).toEqual(-6.2);
            expect(result.profile.bands.length).toEqual(5);
            expect(result.profile.bands[0]).toEqual({ enabled: true, type: 'lowshelf', frequency: 105, gain: 5.5, q: 0.7 });
            expect(result.profile.bands[2]).toEqual({ enabled: true, type: 'peaking', frequency: 3456, gain: -4.2, q: 2.13 });
            expect(result.profile.bands[4].type).toEqual('highshelf');
            expect(result.skippedLines).toEqual(0);
        });

        it('should keep OFF filters as disabled bands', () => {
            expect(p.parseApoText(autoEq)!.profile.bands[3].enabled).toBeFalsy();
        });

        it('should read Equalizer APO variants (no filter number, LP/HP/NO, comma decimals, comments)', () => {
            const text = '# my eq\nPreamp: -3,5 dB\nFilter: ON HP Fc 30 Hz Q 0.71\nFilter: ON LPQ Fc 16000 Hz Q 0.71\nFilter: ON NO Fc 60 Hz Q 30\n';
            const result = p.parseApoText(text)!;

            expect(result.profile.preamp).toEqual(-3.5);
            expect(result.profile.bands.map((b) => b.type)).toEqual(['highpass', 'lowpass', 'notch']);
            // Q is limited to the allowed range
            expect(result.profile.bands[2].q).toEqual(p.maximumQ);
        });

        it('should count lines it cannot read and keep the rest', () => {
            const result = p.parseApoText('Filter 1: ON PK Fc 100 Hz Gain 1 dB Q 1\nFilter 2: ON XYZ Fc 200 Hz\nnonsense\n')!;

            expect(result.profile.bands.length).toEqual(1);
            expect(result.skippedLines).toEqual(2);
        });

        it('should return undefined when there is no filter', () => {
            expect(p.parseApoText('hello\nworld')).toBeUndefined();
        });

        it('should keep at most the maximum number of bands', () => {
            const text = Array.from({ length: 30 }, (_, i) => `Filter ${i + 1}: ON PK Fc ${100 + i} Hz Gain 1 dB Q 1`).join('\n');

            expect(p.parseApoText(text)!.profile.bands.length).toEqual(p.maximumBands);
        });
    });

    describe('toApoText', () => {
        it('should write a profile that reads back identically', () => {
            const profile: ParametricProfile = p.parseApoText(autoEq)!.profile;
            const text: string = p.toApoText(profile);

            expect(text.split('\n')[0]).toEqual('Preamp: -6.2 dB');
            expect(text).toContain('Filter 3: ON PK Fc 3456 Hz Gain -4.2 dB Q 2.13');
            expect(text).toContain('Filter 4: OFF PK Fc 6200 Hz Gain 3.0 dB Q 4.00');
            expect(p.parseApoText(text)!.profile).toEqual(profile);
        });

        it('should not write a gain for filters that do not use one', () => {
            expect(p.toApoText({ preamp: 0, bands: [{ enabled: true, type: 'highpass', frequency: 30, gain: 5, q: 0.71 }] })).toContain(
                'Filter 1: ON HPQ Fc 30 Hz Q 0.71',
            );
        });
    });

    describe('normalize and storage', () => {
        it('should limit values to the allowed ranges', () => {
            const profile = p.normalize({ preamp: -99, bands: [{ enabled: true, type: 'peaking', frequency: 5, gain: 99, q: 0 }] });

            expect(profile.preamp).toEqual(p.minimumPreamp);
            expect(profile.bands[0]).toEqual({ enabled: true, type: 'peaking', frequency: p.minimumFrequency, gain: p.maximumGain, q: p.minimumQ });
        });

        it('should replace unknown filter types and invalid numbers', () => {
            const profile = p.normalize({ preamp: NaN, bands: [{ enabled: true, type: 'bogus' as any, frequency: NaN, gain: NaN, q: NaN }] });

            expect(profile.preamp).toEqual(0);
            expect(profile.bands[0]).toEqual({ enabled: true, type: 'peaking', frequency: 1000, gain: 0, q: 1 });
        });

        it('should store and read back a profile', () => {
            const profile = p.parseApoText(autoEq)!.profile;

            expect(p.deserialize(p.serialize(profile))).toEqual(profile);
        });

        it('should fall back to the default profile for empty or broken settings', () => {
            expect(p.deserialize('')).toEqual(p.createDefaultProfile());
            expect(p.deserialize('{not json')).toEqual(p.createDefaultProfile());
            expect(p.deserialize('{"preamp":1}')).toEqual(p.createDefaultProfile());
        });

        it('should only put enabled bands in the audio graph', () => {
            const filters: EqualizerFilter[] = p.toFilters(p.parseApoText(autoEq)!.profile);

            expect(filters.length).toEqual(4);
            expect(filters.map((f) => f.frequency)).toEqual([105, 21, 3456, 10000]);
        });
    });

    describe('responseDb', () => {
        const at = (filters: EqualizerFilter[], frequency: number, preamp: number = 0): number => p.responseDb(filters, preamp, [frequency])[0];

        it('should be flat without filters and add the preamp', () => {
            expect(at([], 1000)).toBeCloseTo(0, 6);
            expect(at([], 1000, -6)).toBeCloseTo(-6, 6);
        });

        it('should reach the peaking gain at the center frequency and fall off away from it', () => {
            const peak: EqualizerFilter = { type: 'peaking', frequency: 1000, gain: 6, q: 1 };

            expect(at([peak], 1000)).toBeCloseTo(6, 3);
            expect(Math.abs(at([peak], 50))).toBeLessThan(0.2);
            expect(Math.abs(at([peak], 15000))).toBeLessThan(0.2);
        });

        it('should give a low shelf its full gain below and none above the corner', () => {
            const shelf: EqualizerFilter = { type: 'lowshelf', frequency: 200, gain: 6, q: 0.71 };

            expect(at([shelf], 20)).toBeCloseTo(6, 1);
            expect(at([shelf], 200)).toBeCloseTo(3, 1); // half the gain at the corner frequency
            expect(Math.abs(at([shelf], 10000))).toBeLessThan(0.05);
        });

        it('should be -3 dB at the corner of a Butterworth (Q 0.71) high-pass', () => {
            const hp: EqualizerFilter = { type: 'highpass', frequency: 100, gain: 0, q: Math.SQRT1_2 };

            expect(at([hp], 100)).toBeCloseTo(-3.01, 1);
            expect(at([hp], 10000)).toBeCloseTo(0, 1);
            expect(at([hp], 25)).toBeLessThan(-20);
        });

        it('should cut deeply at a notch', () => {
            expect(at([{ type: 'notch', frequency: 60, gain: 0, q: 10 }], 60)).toBeLessThan(-60);
        });

        it('should add up the filters', () => {
            const a: EqualizerFilter = { type: 'peaking', frequency: 1000, gain: 3, q: 1 };

            expect(at([a, a], 1000)).toBeCloseTo(6, 3);
        });

        it('should report the highest boost for the clipping protection', () => {
            expect(p.peakGainDb([{ type: 'peaking', frequency: 1000, gain: 6, q: 1 }])).toBeCloseTo(6, 1);
            expect(p.peakGainDb([{ type: 'peaking', frequency: 1000, gain: -6, q: 1 }])).toEqual(0);
        });
    });
});
