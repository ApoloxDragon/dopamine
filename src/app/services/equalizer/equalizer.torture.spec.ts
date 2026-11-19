// Torture tests for equalizer imports: AutoEQ files with 0 points, -1 Hz, 999999999 dB, "qwertyuiop" and a lizard as
// filter type. The real AutoEQ files next to them must still import exactly.
import { GraphicEq } from './graphic-eq';
import { ParametricEqualizer, ParametricProfile } from './parametric-equalizer';

const finite = (values: number[]): boolean => values.every((x) => Number.isFinite(x));

describe('Equalizer import torture', () => {
    describe('GraphicEQ', () => {
        it('the regular customer: a plain AutoEQ line still fits', () => {
            const points = GraphicEq.parse('GraphicEQ: 20 -3; 1000 0; 20000 2')!;

            expect(points.length).toEqual(3);
            expect(finite(GraphicEq.fitToGraphic(points).gains)).toBe(true);
        });

        it.each([
            ['empty', ''],
            ['no points', 'GraphicEQ:'],
            ['one point', 'GraphicEQ: 1000 3'],
            ['only nonsense', 'GraphicEQ: qwertyuiop; 🦎 🍺; ;;;;'],
            ['negative and zero frequencies only', 'GraphicEQ: -1 3; 0 4; -1000 5'],
            ['NaN and Infinity', 'GraphicEQ: NaN 1; Infinity 2; 1000 Infinity; 2000 NaN'],
            ['a JPEG', '\xFF\xD8\xFF\xE0JFIF'],
        ])('should refuse %s', (_, text) => {
            expect(GraphicEq.parse(text)).toBeUndefined();
        });

        it('should keep the sane points of a mixed file, comma decimals included', () => {
            const points = GraphicEq.parse('GraphicEQ: 20 -3,5; lizard; -5 1; 1000 0; 0 9; 20000 2')!;

            expect(points).toEqual([
                { frequency: 20, gain: -3.5 },
                { frequency: 1000, gain: 0 },
                { frequency: 20000, gain: 2 },
            ]);
        });

        it('should stay within the graphic limits for absurd gains (999999999 dB, -1e300 dB)', () => {
            const points = GraphicEq.parse('GraphicEQ: 20 999999999; 1000 -1e300; 20000 1e300')!;
            const fit = GraphicEq.fitToGraphic(points);

            expect(finite(fit.gains)).toBe(true);
            expect(fit.gains.every((g) => g >= -12 && g <= 12)).toBe(true);
        });

        it('should handle duplicate frequencies, frequencies beyond hearing, and a single repeated frequency', () => {
            for (const text of ['GraphicEQ: 1000 3; 1000 -3; 1000 0', 'GraphicEQ: 1e-9 3; 1e12 -3', 'GraphicEQ: 0.001 1; 0.002 2']) {
                const points = GraphicEq.parse(text)!;
                expect(finite(GraphicEq.fitToGraphic(points).gains)).toBe(true);
                expect(Number.isFinite(GraphicEq.interpolate(points, 1000))).toBe(true);
            }
        });

        it('should fit 100 000 points and a 5 MB file quickly', () => {
            const pairs: string[] = [];
            for (let i = 0; i < 100000; i++) pairs.push(`${20 + i * 0.2} ${Math.sin(i / 1000) * 6}`);
            const started = Date.now();

            const points = GraphicEq.parse(`GraphicEQ: ${pairs.join('; ')}`)!;
            GraphicEq.fitToGraphic(points);
            GraphicEq.parse('x'.repeat(5_000_000));
            GraphicEq.parse(' '.repeat(5_000_000) + 'GraphicEQ: 1 1');

            expect(points.length).toEqual(100000);
            expect(Date.now() - started).toBeLessThan(5000);
        });
    });

    describe('Equalizer APO parametric text', () => {
        const valid = (profile: ParametricProfile): boolean =>
            profile.bands.length <= ParametricEqualizer.maximumBands &&
            profile.preamp >= ParametricEqualizer.minimumPreamp &&
            profile.preamp <= ParametricEqualizer.maximumPreamp &&
            profile.bands.every(
                (b) =>
                    ParametricEqualizer.filterTypes.includes(b.type) &&
                    b.frequency >= ParametricEqualizer.minimumFrequency &&
                    b.frequency <= ParametricEqualizer.maximumFrequency &&
                    b.gain >= ParametricEqualizer.minimumGain &&
                    b.gain <= ParametricEqualizer.maximumGain &&
                    b.q >= ParametricEqualizer.minimumQ &&
                    b.q <= ParametricEqualizer.maximumQ,
            );

        it('the regular customer: a plain AutoEQ ParametricEQ file imports exactly', () => {
            const result = ParametricEqualizer.parseApoText(
                'Preamp: -6.2 dB\nFilter 1: ON PK Fc 105 Hz Gain -2.5 dB Q 0.70\nFilter 2: ON LSC Fc 105 Hz Gain 5.6 dB Q 0.70',
            )!;

            expect(result.profile.preamp).toEqual(-6.2);
            expect(result.profile.bands.map((b) => [b.type, b.frequency, b.gain])).toEqual([
                ['peaking', 105, -2.5],
                ['lowshelf', 105, 5.6],
            ]);
            expect(result.skippedLines).toEqual(0);
        });

        it.each([
            'Preamp: -99999999 dB\nFilter 1: ON PK Fc 999999999 Hz Gain 999999999 dB Q 999999999',
            'Preamp: 1e308 dB\nFilter 1: ON PK Fc -1 Hz Gain -1e308 dB Q -1',
            'Filter 1: ON PK Fc 0 Hz Gain 0 dB Q 0',
            'Filter 1: ON PK Fc NaN Hz Gain Infinity dB Q NaN',
            'Filter 1: ON LIZARD Fc 1000 Hz Gain 3 dB Q 1',
            'Filter: ON PK Fc qwertyuiop Hz Gain 🍺 dB Q 🦎',
            Array.from({ length: 500 }, (_, i) => `Filter ${i + 1}: ON PK Fc ${100 + i} Hz Gain 1 dB Q 1`).join('\n'),
            'Filter 1: OFF PK Fc 1000 Hz Gain 3 dB Q 1',
            'Filter 1: ON PK Fc 1000 Hz Gain 3 dB Q 1\r\nFilter 2: ON PK Fc 2000 Hz Gain 3 dB Q 1\rFilter 3: ON PK Fc 3000 Hz Gain 3 dB Q 1',
            '',
            '\0\0\0',
            'Filter 1: ON PK Fc ' + '9'.repeat(100000) + ' Hz Gain 3 dB Q 1',
        ])('should give a profile within the limits, or nothing, for %#', (text) => {
            const result = ParametricEqualizer.parseApoText(text);

            if (result !== undefined) {
                expect(valid(result.profile)).toBe(true);
                expect(
                    finite(
                        ParametricEqualizer.responseDb(
                            ParametricEqualizer.toFilters(result.profile),
                            result.profile.preamp,
                            [20, 1000, 20000],
                        ),
                    ),
                ).toBe(true);
            }
        });

        it.each([
            undefined,
            '',
            'null',
            '{}',
            '[]',
            '{"bands": "lizard"}',
            '{"bands": [null, 1, "x", {"type": "lizard"}]}',
            '{"preamp": "qwertyuiop", "bands": [{"frequency": -1, "gain": 1e400, "q": 0}]}',
            '{'.repeat(10000),
        ])('should deserialize a broken stored profile %p into a valid one', (stored) => {
            expect(valid(ParametricEqualizer.deserialize(stored))).toBe(true);
        });

        it('should read its own export back the same', () => {
            const profile = ParametricEqualizer.parseApoText(
                'Preamp: -3 dB\nFilter 1: ON HSC Fc 8000 Hz Gain -4 dB Q 0.71\nFilter 2: ON NO Fc 60 Hz',
            )!.profile;

            expect(ParametricEqualizer.parseApoText(ParametricEqualizer.toApoText(profile))!.profile).toEqual(profile);
        });
    });
});
