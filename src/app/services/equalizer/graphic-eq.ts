import { AudioEqualizer } from '../playback/audio-player/audio-equalizer';
import { ParametricEqualizer } from './parametric-equalizer';

/** One point of a target curve: gain (dB) at a frequency (Hz). */
export interface CurvePoint {
    frequency: number;
    gain: number;
}

export interface GraphicFit {
    /** Gains (dB) for the 10 bands of the graphic equalizer (AudioEqualizer.frequencies). */
    gains: number[];
    /** Largest difference (dB) between the graphic equalizer's response and the target curve, from 20 Hz to 20 kHz. */
    maxErrorDb: number;
    /** Frequency (Hz) where that largest difference is. */
    maxErrorFrequency: number;
    /** Root mean square difference (dB) over 20 Hz to 20 kHz (log spaced). */
    rmsErrorDb: number;
}

/**
 * The AutoEQ / Equalizer APO "GraphicEQ" format: a target curve given as frequency/gain pairs, for example
 *   GraphicEQ: 20 -3.7; 21 -3.7; 22 -3.8; ... ; 19871 -3.1
 * It is not a list of filters, so it is applied by finding the 10 graphic equalizer gains whose combined response is
 * closest to the curve (least squares, taking the overlap of neighbouring bands into account).
 */
export class GraphicEq {
    /** Frequencies AutoEQ uses for GraphicEQ files (about 1/6 octave). Used when exporting. */
    public static exportFrequencies(): number[] {
        return ParametricEqualizer.responseFrequencies(127).map((f) => Math.round(f));
    }

    /** Reads the GraphicEQ line. Returns undefined when the text has no GraphicEQ line with at least 2 points. */
    public static parse(text: string): CurvePoint[] | undefined {
        const match: RegExpExecArray | null = /^\s*graphiceq\s*:(.*)$/im.exec(text);

        if (!match) {
            return undefined;
        }

        const points: CurvePoint[] = [];

        for (const pair of match[1].split(';')) {
            const numbers: number[] = pair
                .trim()
                .split(/\s+/)
                .map((x) => parseFloat(x.replace(',', '.')));

            if (numbers.length >= 2 && Number.isFinite(numbers[0]) && Number.isFinite(numbers[1]) && numbers[0] > 0) {
                points.push({ frequency: numbers[0], gain: numbers[1] });
            }
        }

        points.sort((a, b) => a.frequency - b.frequency);

        return points.length >= 2 ? points : undefined;
    }

    /** Gain of the curve at a frequency: linear interpolation on a log frequency axis, flat beyond the first/last point. */
    public static interpolate(points: CurvePoint[], frequency: number): number {
        if (frequency <= points[0].frequency) {
            return points[0].gain;
        }

        const last: CurvePoint = points[points.length - 1];

        if (frequency >= last.frequency) {
            return last.gain;
        }

        let i: number = 1;

        while (points[i].frequency < frequency) {
            i++;
        }

        const a: CurvePoint = points[i - 1];
        const b: CurvePoint = points[i];
        const t: number = (Math.log(frequency) - Math.log(a.frequency)) / (Math.log(b.frequency) - Math.log(a.frequency));

        return a.gain + t * (b.gain - a.gain);
    }

    /** Finds the graphic equalizer gains closest to the curve (damped Gauss-Newton), within the graphic gain limits. */
    public static fitToGraphic(points: CurvePoint[], minimumGain: number = -12, maximumGain: number = 12): GraphicFit {
        const frequencies: number[] = ParametricEqualizer.responseFrequencies(200);
        const target: number[] = frequencies.map((f) => GraphicEq.interpolate(points, f));
        const bands: number = AudioEqualizer.frequencies.length;
        const clamp = (g: number): number => Math.min(maximumGain, Math.max(minimumGain, g));
        const response = (gains: number[]): number[] => ParametricEqualizer.responseDb(AudioEqualizer.graphicFilters(gains), 0, frequencies);
        const cost = (r: number[]): number => r.reduce((sum, x, i) => sum + (x - target[i]) * (x - target[i]), 0);

        // Start from the curve at the band frequencies.
        let gains: number[] = AudioEqualizer.frequencies.map((f) => clamp(GraphicEq.interpolate(points, f)));
        let current: number[] = response(gains);
        let currentCost: number = cost(current);
        let damping: number = 0.01;

        for (let iteration = 0; iteration < 50; iteration++) {
            // Jacobian by finite differences: how the response changes per band.
            const step: number = 0.05;
            const jacobian: number[][] = [];

            for (let b = 0; b < bands; b++) {
                const nudged: number[] = [...gains];
                nudged[b] += step;
                const r: number[] = response(nudged);
                jacobian.push(r.map((x, i) => (x - current[i]) / step));
            }

            // Normal equations: (JᵀJ + damping·diag) Δ = Jᵀ (target - current)
            const a: number[][] = Array.from({ length: bands }, (_, i) =>
                Array.from({ length: bands }, (_, j) => jacobian[i].reduce((sum, x, k) => sum + x * jacobian[j][k], 0)),
            );
            const rhs: number[] = Array.from({ length: bands }, (_, i) => jacobian[i].reduce((sum, x, k) => sum + x * (target[k] - current[k]), 0));

            for (let i = 0; i < bands; i++) {
                a[i][i] *= 1 + damping;
            }

            const delta: number[] | undefined = GraphicEq.solve(a, rhs);

            if (delta === undefined) {
                break;
            }

            const candidate: number[] = gains.map((g, i) => clamp(g + delta[i]));
            const candidateResponse: number[] = response(candidate);
            const candidateCost: number = cost(candidateResponse);

            if (candidateCost < currentCost) {
                const improvement: number = currentCost - candidateCost;
                gains = candidate;
                current = candidateResponse;
                currentCost = candidateCost;
                damping = Math.max(1e-4, damping / 3);

                if (improvement < 1e-6) {
                    break;
                }
            } else {
                damping *= 4;

                if (damping > 1e6) {
                    break;
                }
            }
        }

        let maxErrorDb: number = 0;
        let maxErrorFrequency: number = frequencies[0];

        current.forEach((x, i) => {
            const error: number = Math.abs(x - target[i]);

            if (error > maxErrorDb) {
                maxErrorDb = error;
                maxErrorFrequency = frequencies[i];
            }
        });

        return {
            gains: gains.map((g) => Math.round(g * 10) / 10),
            maxErrorDb,
            maxErrorFrequency,
            rmsErrorDb: Math.sqrt(currentCost / frequencies.length),
        };
    }

    /** GraphicEQ text of the graphic equalizer's real response, sampled like AutoEQ does. */
    public static fromGraphicGains(gains: number[]): string {
        const frequencies: number[] = GraphicEq.exportFrequencies();
        const response: number[] = ParametricEqualizer.responseDb(AudioEqualizer.graphicFilters(gains), 0, frequencies);

        return 'GraphicEQ: ' + frequencies.map((f, i) => `${f} ${(Math.round(response[i] * 10) / 10).toFixed(1)}`).join('; ') + '\n';
    }

    /** Gaussian elimination with partial pivoting. Returns undefined for a singular system. */
    private static solve(matrix: number[][], vector: number[]): number[] | undefined {
        const n: number = vector.length;
        const a: number[][] = matrix.map((row, i) => [...row, vector[i]]);

        for (let col = 0; col < n; col++) {
            let pivot: number = col;

            for (let row = col + 1; row < n; row++) {
                if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
                    pivot = row;
                }
            }

            if (Math.abs(a[pivot][col]) < 1e-12) {
                return undefined;
            }

            [a[col], a[pivot]] = [a[pivot], a[col]];

            for (let row = col + 1; row < n; row++) {
                const factor: number = a[row][col] / a[col][col];

                for (let k = col; k <= n; k++) {
                    a[row][k] -= factor * a[col][k];
                }
            }
        }

        const x: number[] = new Array<number>(n).fill(0);

        for (let row = n - 1; row >= 0; row--) {
            let sum: number = a[row][n];

            for (let k = row + 1; k < n; k++) {
                sum -= a[row][k] * x[k];
            }

            x[row] = sum / a[row][row];
        }

        return x;
    }
}
