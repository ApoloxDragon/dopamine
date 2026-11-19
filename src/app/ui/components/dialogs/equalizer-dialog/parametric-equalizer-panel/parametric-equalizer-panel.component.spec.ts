import { Mock } from 'typemoq';
import { ParametricEqualizerPanelComponent } from './parametric-equalizer-panel.component';
import { EqualizerService } from '../../../../../services/equalizer/equalizer.service';
import { Logger } from '../../../../../common/logger';
import { SettingsMock } from '../../../../../testing/settings-mock';

describe('ParametricEqualizerPanelComponent', () => {
    let service: EqualizerService;
    let component: ParametricEqualizerPanelComponent;

    beforeEach(() => {
        const settings = new SettingsMock();
        settings.audioEqualizerGains = '0;0;0;0;0;0;0;0;0;0';
        settings.audioEqualizerParametricProfile = '';
        service = new EqualizerService(settings, Mock.ofType<Logger>().object);
        component = new ParametricEqualizerPanelComponent(service);
        component.update();
    });

    it('should place one handle per enabled band, at its frequency', () => {
        expect(component.markers.length).toEqual(5);

        service.updateParametricBand(0, { enabled: false });
        component.update();

        expect(component.markers.map((m) => m.index)).toEqual([1, 2, 3, 4]);
    });

    it('should place a 1 kHz handle exactly in the middle of the log scale', () => {
        // 20 Hz .. 20 kHz: 1 kHz is at log10(50) / log10(1000) of the width
        const marker = component.markers.find((m) => m.index === 2)!;

        expect(marker.x).toBeCloseTo((Math.log10(50) / 3) * component.width, 0);
        expect(marker.y).toBeCloseTo(component.height / 2, 0);
    });

    it('should widen the dB range for large boosts', () => {
        expect(component.range).toEqual(12);

        service.updateParametricBand(2, { gain: 20 });
        component.update();

        expect(component.range).toEqual(24);
    });

    it('should warn about clipping and fix it with the preamp', () => {
        service.updateParametricBand(2, { gain: 6 });
        component.update();

        expect(component.mayClip).toBeTruthy();

        component.preventClipping();

        expect(component.mayClip).toBeFalsy();
        expect(service.parametricProfile.preamp).toBeCloseTo(-6, 1);
    });

    it('should ignore number fields that are not numbers', () => {
        component.setNumber(1, 'gain', 'abc');
        component.setNumber(1, 'frequency', '440,5');

        expect(service.parametricProfile.bands[1].gain).toEqual(0);
        expect(service.parametricProfile.bands[1].frequency).toEqual(441);
    });
});
