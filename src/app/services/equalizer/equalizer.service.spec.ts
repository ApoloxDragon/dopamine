import { Mock } from 'typemoq';
import { EqualizerService } from './equalizer.service';
import { AudioEqualizer } from '../playback/audio-player/audio-equalizer';
import { EqualizerFilter, ParametricEqualizer } from './parametric-equalizer';
import { GraphicEq } from './graphic-eq';
import { SettingsMock } from '../../testing/settings-mock';
import { Logger } from '../../common/logger';

class FakeEqualizer {
    public filters: EqualizerFilter[] = [];
    public preamp: number = 0;

    public setFilters(filters: EqualizerFilter[], preamp: number): void {
        this.filters = filters;
        this.preamp = preamp;
    }
}

describe('EqualizerService', () => {
    let settings: SettingsMock;
    let equalizer: FakeEqualizer;

    function create(): EqualizerService {
        const service = new EqualizerService(settings, Mock.ofType<Logger>().object);
        service.register(equalizer as unknown as AudioEqualizer);
        return service;
    }

    beforeEach(() => {
        settings = new SettingsMock();
        settings.audioEqualizerEnabled = true;
        settings.audioEqualizerPreset = 'flat';
        settings.audioEqualizerGains = '0;0;0;0;0;0;0;0;0;0';
        settings.audioEqualizerMode = 'graphic';
        settings.audioEqualizerParametricProfile = '';
        equalizer = new FakeEqualizer();
    });

    describe('graphic mode', () => {
        it('should apply the 10 graphic bands with the saved gains', () => {
            settings.audioEqualizerGains = '1;2;3;4;5;6;7;8;9;10';
            create();

            expect(equalizer.filters).toEqual(AudioEqualizer.graphicFilters([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
            expect(equalizer.preamp).toEqual(0);
        });

        it('should apply a preset', () => {
            const service = create();

            service.applyPreset('bass-boost');

            expect(equalizer.filters[0].gain).toEqual(7);
            expect(settings.audioEqualizerPreset).toEqual('bass-boost');
        });

        it('should apply flat graphic filters when disabled', () => {
            settings.audioEqualizerEnabled = false;
            settings.audioEqualizerMode = 'parametric';
            create();

            expect(equalizer.filters).toEqual(AudioEqualizer.graphicFilters(new Array(10).fill(0)));
            expect(equalizer.preamp).toEqual(0);
        });
    });

    describe('parametric mode', () => {
        it('should start with the default profile', () => {
            const service = create();

            expect(service.parametricProfile).toEqual(ParametricEqualizer.createDefaultProfile());
        });

        it('should apply the parametric filters and preamp when switched to parametric', () => {
            const service = create();

            service.mode = 'parametric';

            expect(settings.audioEqualizerMode).toEqual('parametric');
            expect(equalizer.filters).toEqual(ParametricEqualizer.toFilters(ParametricEqualizer.createDefaultProfile()));
        });

        it('should load a saved profile', () => {
            settings.audioEqualizerMode = 'parametric';
            settings.audioEqualizerParametricProfile = ParametricEqualizer.serialize({
                preamp: -4,
                bands: [{ enabled: true, type: 'peaking', frequency: 2000, gain: 4, q: 2 }],
            });
            create();

            expect(equalizer.filters).toEqual([{ type: 'peaking', frequency: 2000, gain: 4, q: 2 }]);
            expect(equalizer.preamp).toEqual(-4);
        });

        it('should save and apply band changes', () => {
            const service = create();
            service.mode = 'parametric';

            service.updateParametricBand(1, { gain: 5.5, q: 3 });

            expect(service.parametricProfile.bands[1]).toEqual({ enabled: true, type: 'peaking', frequency: 300, gain: 5.5, q: 3 });
            expect(equalizer.filters[1].gain).toEqual(5.5);
            expect(ParametricEqualizer.deserialize(settings.audioEqualizerParametricProfile).bands[1].gain).toEqual(5.5);
        });

        it('should leave disabled bands out of the audio graph', () => {
            const service = create();
            service.mode = 'parametric';

            service.updateParametricBand(0, { enabled: false });

            expect(equalizer.filters.length).toEqual(4);
        });

        it('should keep values within limits', () => {
            const service = create();

            service.updateParametricBand(0, { gain: 100, frequency: 1 });

            expect(service.parametricProfile.bands[0].gain).toEqual(ParametricEqualizer.maximumGain);
            expect(service.parametricProfile.bands[0].frequency).toEqual(ParametricEqualizer.minimumFrequency);
        });

        it('should add a band in the widest free frequency range and remove bands', () => {
            const service = create();

            service.addParametricBand();
            const added = service.parametricProfile.bands[5];
            service.removeParametricBand(0);

            expect(added.type).toEqual('peaking');
            expect(added.gain).toEqual(0);
            // The widest gap (log scale) of 20, 105, 300, 1000, 3000, 10000, 20000 Hz is 20-105 Hz
            expect(added.frequency).toBeGreaterThan(20);
            expect(added.frequency).toBeLessThan(105);
            expect(service.parametricProfile.bands.length).toEqual(5);
        });

        it('should not add more than the maximum number of bands', () => {
            const service = create();

            for (let i = 0; i < 30; i++) {
                service.addParametricBand();
            }

            expect(service.parametricProfile.bands.length).toEqual(ParametricEqualizer.maximumBands);
        });

        it('should import AutoEQ text and report what was read', () => {
            const service = create();
            service.mode = 'parametric';

            const result = service.importParametricText('Preamp: -6.2 dB\nFilter 1: ON PK Fc 21 Hz Gain 7.4 dB Q 0.47\nbad line\n');

            expect(result).toEqual({ bands: 1, skippedLines: 1 });
            expect(equalizer.filters).toEqual([{ type: 'peaking', frequency: 21, gain: 7.4, q: 0.47 }]);
            expect(equalizer.preamp).toEqual(-6.2);
        });

        it('should keep the profile when the imported text has no filters', () => {
            const service = create();

            expect(service.importParametricText('nothing here')).toBeUndefined();
            expect(service.parametricProfile).toEqual(ParametricEqualizer.createDefaultProfile());
        });

        it('should export the profile as Equalizer APO text', () => {
            const service = create();

            expect(service.exportParametricText()).toContain('Filter 3: ON PK Fc 1000 Hz Gain 0.0 dB Q 1.00');
        });

        it('should lower the preamp by the highest boost to prevent clipping', () => {
            const service = create();
            service.updateParametricBand(2, { gain: 6 });

            service.preventParametricClipping();

            expect(service.parametricProfile.preamp).toBeCloseTo(-6, 1);
        });

        it('should not change the graphic equalizer when editing the parametric profile in graphic mode', () => {
            const service = create();

            service.updateParametricBand(2, { gain: 6 });

            expect(equalizer.filters).toEqual(AudioEqualizer.graphicFilters(new Array(10).fill(0)));
        });

        it('should go back to the default profile on reset', () => {
            const service = create();
            service.updateParametricBand(2, { gain: 6 });

            service.resetParametric();

            expect(service.parametricProfile).toEqual(ParametricEqualizer.createDefaultProfile());
        });
    });

    describe('importText and exportText', () => {
        it('should fit a GraphicEQ curve to the graphic equalizer and switch to graphic mode', () => {
            settings.audioEqualizerMode = 'parametric';
            const service = create();
            const curve = GraphicEq.fromGraphicGains([6, 4, 2, 0, -2, -3, 0, 3, 5, 6]);

            const result = service.importText(curve);

            expect(result?.kind).toEqual('graphic');
            expect(service.mode).toEqual('graphic');
            expect(service.selectedPreset).toEqual('manual');
            service.gains.forEach((g, i) => expect(g).toBeCloseTo([6, 4, 2, 0, -2, -3, 0, 3, 5, 6][i], 0));
            expect(equalizer.filters).toEqual(AudioEqualizer.graphicFilters(service.gains));
            expect(settings.audioEqualizerGains).toEqual(service.gains.join(';'));
        });

        it('should load parametric filters and switch to parametric mode', () => {
            const service = create();

            const result = service.importText('Preamp: -3.1 dB\nFilter 1: ON PK Fc 62 Hz Gain -4.2 dB Q 0.900\n');

            expect(result).toEqual({ kind: 'parametric', bands: 1, skippedLines: 0 });
            expect(service.mode).toEqual('parametric');
            expect(equalizer.filters).toEqual([{ type: 'peaking', frequency: 62, gain: -4.2, q: 0.9 }]);
        });

        it('should change nothing for text in neither format', () => {
            const service = create();

            expect(service.importText('hello')).toBeUndefined();
            expect(service.mode).toEqual('graphic');
        });

        it('should export the format of the current mode', () => {
            const service = create();

            expect(service.exportText().startsWith('GraphicEQ: ')).toBeTruthy();

            service.mode = 'parametric';

            expect(service.exportText().startsWith('Preamp: ')).toBeTruthy();
        });
    });
});
