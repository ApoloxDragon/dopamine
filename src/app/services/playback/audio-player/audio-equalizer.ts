import { EqualizerFilter, ParametricEqualizer } from '../../equalizer/parametric-equalizer';

/**
 * Builds a chain of BiquadFilterNodes that can be inserted into an audio graph:
 * input -> preamp -> filter 1 -> ... -> filter N -> output.
 *
 * Used for both equalizer modes:
 * - Graphic: the classic 10 bands (low shelf, 8 peaking, high shelf) at fixed frequencies; only the gains change.
 * - Parametric: any number of filters with their own type, frequency, gain and Q, plus a preamp.
 */
export class AudioEqualizer {
    // Classic ISO 10-band graphic equalizer center frequencies (Hz).
    public static readonly frequencies: number[] = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    public static readonly graphicPeakingQ: number = 1.4;

    private readonly _input: GainNode;
    private readonly _preamp: GainNode;
    private readonly _output: GainNode;
    private _filters: BiquadFilterNode[] = [];

    public constructor(private audioContext: BaseAudioContext) {
        this._input = audioContext.createGain();
        this._preamp = audioContext.createGain();
        this._output = audioContext.createGain();
        this._input.connect(this._preamp);

        this.setGains(new Array<number>(AudioEqualizer.frequencies.length).fill(0));
    }

    public get input(): AudioNode {
        return this._input;
    }

    public get output(): AudioNode {
        return this._output;
    }

    /** The filters of the graphic equalizer for the given gains (dB per band). */
    public static graphicFilters(gainsInDecibels: number[]): EqualizerFilter[] {
        const last: number = AudioEqualizer.frequencies.length - 1;

        return AudioEqualizer.frequencies.map((frequency, i) => ({
            type: i === 0 ? 'lowshelf' : i === last ? 'highshelf' : 'peaking',
            frequency,
            gain: gainsInDecibels[i] ?? 0,
            q: AudioEqualizer.graphicPeakingQ,
        }));
    }

    /** Graphic equalizer: one gain (dB) per band of AudioEqualizer.frequencies. */
    public setGains(gainsInDecibels: number[]): void {
        this.setFilters(AudioEqualizer.graphicFilters(gainsInDecibels), 0);
    }

    /**
     * Applies the given filters and preamp. When only values change (same number and types of filters), the existing
     * nodes are updated, which avoids clicks. Otherwise the chain is rebuilt.
     */
    public setFilters(filters: EqualizerFilter[], preampDb: number): void {
        // Assigning .value is the same as setValueAtTime(value, currentTime) (Web Audio spec), and also updates the value
        // immediately, so getFrequencyResponse() and the response curve agree with what is applied.
        this._preamp.gain.value = Math.pow(10, preampDb / 20);

        const sameShape: boolean = filters.length === this._filters.length && filters.every((f, i) => f.type === this._filters[i].type);

        if (!sameShape) {
            this.rebuild(filters);
        }

        filters.forEach((filter, i) => this.configure(this._filters[i], filter));
    }

    private rebuild(filters: EqualizerFilter[]): void {
        this._preamp.disconnect();

        for (const node of this._filters) {
            node.disconnect();
        }

        this._filters = filters.map((filter) => {
            const node: BiquadFilterNode = this.audioContext.createBiquadFilter();
            node.type = filter.type;
            return node;
        });

        let previous: AudioNode = this._preamp;

        for (const node of this._filters) {
            previous.connect(node);
            previous = node;
        }

        previous.connect(this._output);
    }

    private configure(node: BiquadFilterNode, filter: EqualizerFilter): void {
        node.frequency.value = filter.frequency;
        node.gain.value = ParametricEqualizer.usesGain(filter.type) ? filter.gain : 0;

        if (filter.type === 'lowpass' || filter.type === 'highpass') {
            // Web Audio reads the Q of low-pass and high-pass filters in dB.
            node.Q.value = ParametricEqualizer.linearQToDb(filter.q);
        } else if (ParametricEqualizer.usesQ(filter.type)) {
            node.Q.value = filter.q;
        }
        // Shelf filters ignore Q in Web Audio (fixed slope).
    }
}
