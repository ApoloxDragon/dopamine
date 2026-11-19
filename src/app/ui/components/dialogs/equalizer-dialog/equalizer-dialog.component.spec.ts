import * as fs from 'fs';
import * as path from 'path';
import { IMock, It, Mock, Times } from 'typemoq';
import { MatDialogRef } from '@angular/material/dialog';
import { EqualizerDialogComponent } from './equalizer-dialog.component';
import { EqualizerService } from '../../../../services/equalizer/equalizer.service';
import { DesktopBase } from '../../../../common/io/desktop.base';
import { FileAccessBase } from '../../../../common/io/file-access.base';
import { TranslatorServiceBase } from '../../../../services/translator/translator.service.base';
import { Logger } from '../../../../common/logger';
import { SettingsMock } from '../../../../testing/settings-mock';

const testData = (name: string): string => fs.readFileSync(path.join(__dirname, '../../../../services/equalizer/test-data', name), 'utf8');

describe('EqualizerDialogComponent import and export', () => {
    let service: EqualizerService;
    let settings: SettingsMock;
    let desktopMock: IMock<DesktopBase>;
    let fileAccessMock: IMock<FileAccessBase>;
    let dialogRefMock: IMock<MatDialogRef<EqualizerDialogComponent>>;
    let component: EqualizerDialogComponent;
    let translatedParams: any;

    function chooseFile(content: string): void {
        desktopMock.setup((x) => x.showSelectFileDialogAsync(It.isAny(), It.isAny())).returns(() => Promise.resolve('/eq/file.txt'));
        fileAccessMock.setup((x) => x.getFileContentAsString('/eq/file.txt')).returns(() => content);
    }

    beforeEach(() => {
        settings = new SettingsMock();
        settings.audioEqualizerEnabled = false;
        settings.audioEqualizerGains = '0;0;0;0;0;0;0;0;0;0';
        settings.audioEqualizerParametricProfile = '';
        service = new EqualizerService(settings, Mock.ofType<Logger>().object);
        desktopMock = Mock.ofType<DesktopBase>();
        fileAccessMock = Mock.ofType<FileAccessBase>();
        dialogRefMock = Mock.ofType<MatDialogRef<EqualizerDialogComponent>>();
        const translatorMock = Mock.ofType<TranslatorServiceBase>();
        translatorMock
            .setup((x) => x.get(It.isAny(), It.isAny()))
            .returns((key: string, params: any) => {
                translatedParams = params;
                return key;
            });
        translatorMock.setup((x) => x.get(It.isAny())).returns((key: string) => key);
        component = new EqualizerDialogComponent(
            service,
            dialogRefMock.object,
            desktopMock.object,
            fileAccessMock.object,
            translatorMock.object,
            Mock.ofType<Logger>().object,
        );
    });

    it('should import the QCY H3 Pro ParametricEQ file into the parametric equalizer', async () => {
        chooseFile(testData('QCY H3 Pro ParametricEQ.txt'));

        await component.importAsync();

        expect(service.mode).toEqual('parametric');
        expect(service.parametricProfile.bands.length).toEqual(10);
        expect(service.parametricProfile.preamp).toEqual(-3.1);
        expect(service.isEnabled).toBeTruthy();
        expect(component.message).toEqual('equalizer-import-result');
        expect(translatedParams).toEqual({ bands: 10, skipped: 0 });
        dialogRefMock.verify((x) => x.updateSize(EqualizerDialogComponent.parametricWidth), Times.atLeastOnce());
    });

    it('should fit the QCY H3 Pro GraphicEQ file to the graphic equalizer and report the accuracy', async () => {
        settings.audioEqualizerMode = 'parametric';
        chooseFile(testData('QCY H3 Pro GraphicEQ.txt'));

        await component.importAsync();

        expect(service.mode).toEqual('graphic');
        expect(service.selectedPreset).toEqual('manual');
        expect(service.gains.some((g) => g !== 0)).toBeTruthy();
        expect(component.message).toEqual('equalizer-import-graphic-result');
        expect(translatedParams.points).toEqual(127);
        expect(parseFloat(translatedParams.rms)).toBeLessThan(2.5);
        expect(translatedParams.frequency).toMatch(/kHz$/);
    });

    it('should report a file without equalizer settings and change nothing', async () => {
        chooseFile('just some notes');

        await component.importAsync();

        expect(component.message).toEqual('equalizer-import-nothing-found');
        expect(service.isEnabled).toBeFalsy();
        expect(service.mode).toEqual('graphic');
    });

    it('should do nothing when the file dialog is cancelled', async () => {
        desktopMock.setup((x) => x.showSelectFileDialogAsync(It.isAny(), It.isAny())).returns(() => Promise.resolve(''));

        await component.importAsync();

        fileAccessMock.verify((x) => x.getFileContentAsString(It.isAny()), Times.never());
        expect(component.message).toEqual('');
    });

    it('should export a GraphicEQ file in graphic mode and an Equalizer APO file in parametric mode', async () => {
        desktopMock.setup((x) => x.showSaveFileDialogAsync(It.isAny(), 'GraphicEQ.txt', It.isAny())).returns(() => Promise.resolve('/eq/g.txt'));
        desktopMock.setup((x) => x.showSaveFileDialogAsync(It.isAny(), 'ParametricEQ.txt', It.isAny())).returns(() => Promise.resolve('/eq/p.txt'));

        await component.exportAsync();
        service.mode = 'parametric';
        await component.exportAsync();

        fileAccessMock.verify((x) => x.writeToFile('/eq/g.txt', It.is((t: string) => t.startsWith('GraphicEQ: '))), Times.once());
        fileAccessMock.verify((x) => x.writeToFile('/eq/p.txt', It.is((t: string) => t.startsWith('Preamp: '))), Times.once());
    });
});
