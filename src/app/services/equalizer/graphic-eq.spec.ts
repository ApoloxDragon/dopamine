import * as fs from 'fs';
import * as path from 'path';
import { GraphicEq } from './graphic-eq';
import { ParametricEqualizer } from './parametric-equalizer';
import { AudioEqualizer } from '../playback/audio-player/audio-equalizer';

// Real AutoEQ files for the QCY H3 Pro headphones
const graphicText: string = fs.readFileSync(path.join(__dirname, 'test-data', 'QCY H3 Pro GraphicEQ.txt'), 'utf8');
const parametricText: string = fs.readFileSync(path.join(__dirname, 'test-data', 'QCY H3 Pro ParametricEQ.txt'), 'utf8');

describe('GraphicEq', () => {
    describe('parse', () => {
        it('should read every point of an AutoEQ GraphicEQ file', () => {
            const points = GraphicEq.parse(graphicText)!;

            expect(points.length).toEqual(127);
            expect(points[0]).toEqual({ frequency: 20, gain: -3.7 });
            expect(points[points.length - 1]).toEqual({ frequency: 19871, gain: -3.1 });
            expect(points.find((p) => p.frequency === 5052)!.gain).toEqual(-10);
        });

        it('should sort points and skip broken pairs', () => {
            expect(GraphicEq.parse('GraphicEQ: 1000 2; abc; 100 -1; 50')).toEqual([
                { frequency: 100, gain: -1 },
                { frequency: 1000, gain: 2 },
            ]);
        });

        it('should return undefined for text without a GraphicEQ line', () => {
            expect(GraphicEq.parse(parametricText)).toBeUndefined();
            expect(GraphicEq.parse('GraphicEQ: 100 1')).toBeUndefined();
        });
    });

    describe('interpolate', () => {
        const points = [
            { frequency: 100, gain: 0 },
            { frequency: 1000, gain: 10 },
        ];

        it('should interpolate on a log frequency axis', () => {
            // sqrt(100 * 1000) is halfway on a log axis
            expect(GraphicEq.interpolate(points, Math.sqrt(100 * 1000))).toBeCloseTo(5, 6);
        });

        it('should stay flat beyond the first and last point', () => {
            expect(GraphicEq.interpolate(points, 20)).toEqual(0);
            expect(GraphicEq.interpolate(points, 20000)).toEqual(10);
        });
    });

    describe('fitToGraphic', () => {
        it('should recover the gains of a curve made by the graphic equalizer itself', () => {
            const gains = [6, 4, 2, 0, -2, -3, 0, 3, 5, 6];
            const curve = GraphicEq.parse(GraphicEq.fromGraphicGains(gains))!;

            const fit = GraphicEq.fitToGraphic(curve);

            fit.gains.forEach((g, i) => expect(g).toBeCloseTo(gains[i], 0));
            expect(fit.maxErrorDb).toBeLessThan(0.3);
        });

        it('should fit the QCY H3 Pro GraphicEQ within the graphic limits and report the remaining error', () => {
            const fit = GraphicEq.fitToGraphic(GraphicEq.parse(graphicText)!);

            expect(fit.gains.length).toEqual(10);
            fit.gains.forEach((g) => {
                expect(g).toBeGreaterThanOrEqual(-12);
                expect(g).toBeLessThanOrEqual(12);
            });
            // The broad shape fits; the narrow 3-5 kHz details cannot be followed by 10 bands.
            expect(fit.rmsErrorDb).toBeLessThan(2.5);
            expect(fit.maxErrorFrequency).toBeGreaterThan(2500);
            expect(fit.maxErrorFrequency).toBeLessThan(6500);
            // eslint-disable-next-line no-console
            console.log(`QCY H3 Pro GraphicEQ fit: gains ${fit.gains.join(', ')}; RMS ${fit.rmsErrorDb.toFixed(2)} dB; max ${fit.maxErrorDb.toFixed(1)} dB at ${Math.round(fit.maxErrorFrequency)} Hz`);
        });

        it('should be better than reading the curve at the band frequencies', () => {
            const points = GraphicEq.parse(graphicText)!;
            const naive = AudioEqualizer.frequencies.map((f) => GraphicEq.interpolate(points, f));
            const frequencies = ParametricEqualizer.responseFrequencies(200);
            const target = frequencies.map((f) => GraphicEq.interpolate(points, f));
            const naiveResponse = ParametricEqualizer.responseDb(AudioEqualizer.graphicFilters(naive), 0, frequencies);
            const naiveRms = Math.sqrt(naiveResponse.reduce((s, x, i) => s + (x - target[i]) ** 2, 0) / frequencies.length);

            expect(GraphicEq.fitToGraphic(points).rmsErrorDb).toBeLessThan(naiveRms);
        });
    });

    describe('fromGraphicGains', () => {
        it('should export a GraphicEQ line with AutoEQ-like frequencies', () => {
            const text = GraphicEq.fromGraphicGains(new Array(10).fill(0));

            expect(text.startsWith('GraphicEQ: 20 0.0; ')).toBeTruthy();
            expect(GraphicEq.parse(text)!.length).toEqual(127);
        });
    });
});

describe('ParametricEqualizer with the QCY H3 Pro ParametricEQ file', () => {
    it('should import all 10 filters and the preamp exactly', () => {
        const result = ParametricEqualizer.parseApoText(parametricText)!;

        expect(result.skippedLines).toEqual(0);
        expect(result.profile.preamp).toEqual(-3.1);
        expect(result.profile.bands.length).toEqual(10);
        expect(result.profile.bands[0]).toEqual({ enabled: true, type: 'peaking', frequency: 62, gain: -4.2, q: 0.9 });
        expect(result.profile.bands[8]).toEqual({ enabled: true, type: 'peaking', frequency: 4000, gain: 12, q: 2 });
        expect(result.profile.bands[9]).toEqual({ enabled: true, type: 'peaking', frequency: 4900, gain: -11.9, q: 2 });
    });
});
