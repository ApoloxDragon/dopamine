import { IMock, It, Mock, Times } from 'typemoq';
import { ParametricEqualizerPanelComponent } from './parametric-equalizer-panel.component';
import { EqualizerService } from '../../../../../services/equalizer/equalizer.service';
import { DesktopBase } from '../../../../../common/io/desktop.base';
import { FileAccessBase } from '../../../../../common/io/file-access.base';
import { TranslatorServiceBase } from '../../../../../services/translator/translator.service.base';
import { Logger } from '../../../../../common/logger';
import { SettingsMock } from '../../../../../testing/settings-mock';

describe('ParametricEqualizerPanelComponent', () => {
    let service: EqualizerService;
    let desktopMock: IMock<DesktopBase>;
    let fileAccessMock: IMock<FileAccessBase>;
    let translatorMock: IMock<TranslatorServiceBase>;
    let component: ParametricEqualizerPanelComponent;

    beforeEach(() => {
        const settings = new SettingsMock();
        settings.audioEqualizerGains = '0;0;0;0;0;0;0;0;0;0';
        settings.audioEqualizerParametricProfile = '';
        service = new EqualizerService(settings, Mock.ofType<Logger>().object);
        desktopMock = Mock.ofType<DesktopBase>();
        fileAccessMock = Mock.ofType<FileAccessBase>();
        translatorMock = Mock.ofType<TranslatorServiceBase>();
        translatorMock.setup((x) => x.get(It.isAny(), It.isAny())).returns((key: string) => key);
        translatorMock.setup((x) => x.get(It.isAny())).returns((key: string) => key);
        component = new ParametricEqualizerPanelComponent(
            service,
            desktopMock.object,
            fileAccessMock.object,
            translatorMock.object,
            Mock.ofType<Logger>().object,
        );
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

    it('should import a file chosen by the user', async () => {
        desktopMock.setup((x) => x.showSelectFileDialogAsync(It.isAny(), It.isAny())).returns(() => Promise.resolve('/eq/ParametricEQ.txt'));
        fileAccessMock
            .setup((x) => x.getFileContentAsString('/eq/ParametricEQ.txt'))
            .returns(() => 'Preamp: -3 dB\nFilter 1: ON PK Fc 21 Hz Gain 7.4 dB Q 0.47\n');

        await component.importAsync();

        expect(service.parametricProfile.bands.length).toEqual(1);
        expect(component.message).toEqual('equalizer-import-result');
        expect(component.markers.length).toEqual(1);
    });

    it('should do nothing when the file dialog is cancelled', async () => {
        desktopMock.setup((x) => x.showSelectFileDialogAsync(It.isAny(), It.isAny())).returns(() => Promise.resolve(''));

        await component.importAsync();

        expect(service.parametricProfile.bands.length).toEqual(5);
        fileAccessMock.verify((x) => x.getFileContentAsString(It.isAny()), Times.never());
    });

    it('should tell the user when a file has no filters', async () => {
        desktopMock.setup((x) => x.showSelectFileDialogAsync(It.isAny(), It.isAny())).returns(() => Promise.resolve('/eq/notes.txt'));
        fileAccessMock.setup((x) => x.getFileContentAsString(It.isAny())).returns(() => 'just some notes');

        await component.importAsync();

        expect(component.message).toEqual('equalizer-import-nothing-found');
        expect(service.parametricProfile.bands.length).toEqual(5);
    });

    it('should export the profile as a text file', async () => {
        desktopMock.setup((x) => x.showSaveFileDialogAsync(It.isAny(), 'ParametricEQ.txt', It.isAny())).returns(() => Promise.resolve('/eq/out.txt'));

        await component.exportAsync();

        fileAccessMock.verify((x) => x.writeToFile('/eq/out.txt', It.is((t: string) => t.startsWith('Preamp: 0.0 dB'))), Times.once());
    });
});
