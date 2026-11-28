import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import electronLog from 'electron-log';
import { IMock, It, Mock, Times } from 'typemoq';
import { DevBuildService } from './dev-build.service';
import { DevBuild } from '../../common/application/dev-build';
import { Logger } from '../../common/logger';
import { SettingsMock } from '../../testing/settings-mock';
import { DialogServiceBase } from '../dialog/dialog.service.base';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { ProductInformation } from '../../common/application/product-information';
import { SettingsSearch } from '../../ui/components/settings/settings-search/settings-search';

describe('Development-only features', () => {
    let settings: SettingsMock;
    let dialogServiceMock: IMock<DialogServiceBase>;
    let translatorMock: IMock<TranslatorServiceBase>;
    let service: DevBuildService;

    beforeEach(() => {
        settings = new SettingsMock();
        dialogServiceMock = Mock.ofType<DialogServiceBase>();
        translatorMock = Mock.ofType<TranslatorServiceBase>();
        translatorMock.setup((x) => x.get(It.isAny())).returns((k: string) => k);
        service = new DevBuildService(settings, dialogServiceMock.object, translatorMock.object, Mock.ofType<Logger>().object);
    });

    afterEach(() => {
        DevBuild.override = undefined;
        Logger.extraLogging = false;
    });

    describe('in a development build', () => {
        beforeEach(() => (DevBuild.override = true));

        it('the regular customer: warns once per version, and extra logging follows the setting', () => {
            settings.devExtraLogging = true;

            service.initialize();
            service.showWarningIfNeeded();
            service.showWarningIfNeeded();

            expect(Logger.extraLogging).toBe(true);
            expect(settings.devWarningShownForVersion).toBe(ProductInformation.applicationVersion);
            dialogServiceMock.verify((x) => x.showInfoDialog('dev-build-warning'), Times.once());
        });

        it('should warn again for a new version', () => {
            settings.devWarningShownForVersion = '0.0.1-old';

            service.showWarningIfNeeded();

            dialogServiceMock.verify((x) => x.showInfoDialog(It.isAny()), Times.once());
        });

        it('should turn extra logging on and off from the developer options', () => {
            service.extraLogging = true;
            expect([settings.devExtraLogging, Logger.extraLogging]).toEqual([true, true]);

            service.extraLogging = false;
            expect([settings.devExtraLogging, Logger.extraLogging]).toEqual([false, false]);
        });

        it('should find the developer options in the Settings search', () => {
            expect(new SettingsSearch((k) => k, 'linux').search('developer').map((x) => x.entry.sectionKey)).toContain('developer-options');
        });
    });

    describe('in a release build: nothing of it, ever', () => {
        beforeEach(() => (DevBuild.override = false));

        it('should not warn, even with no warning shown before', () => {
            settings.devWarningShownForVersion = '';

            service.showWarningIfNeeded();

            dialogServiceMock.verify((x) => x.showInfoDialog(It.isAny()), Times.never());
            expect(settings.devWarningShownForVersion).toBe('');
        });

        it('should keep extra logging off, even when a dev build left it on in the settings', () => {
            settings.devExtraLogging = true;

            service.initialize();

            expect(Logger.extraLogging).toBe(false);
            expect(service.extraLogging).toBe(false);
            expect(service.isDevBuild).toBe(false);
        });

        it('should not let anything turn extra logging on', () => {
            service.extraLogging = true;

            expect(settings.devExtraLogging).toBe(false);
            expect(Logger.extraLogging).toBe(false);
        });

        it('should not write debug lines, even if the flag was forced on', () => {
            Logger.extraLogging = true;
            const log = jest.spyOn(electronLog, 'info').mockImplementation(() => undefined);

            new Logger().debug('secret detail', 'X', 'y');

            expect(log).not.toHaveBeenCalled();
            log.mockRestore();
        });

        it('should not show the developer options in the Settings search', () => {
            expect(new SettingsSearch((k) => k, 'linux').search('developer').map((x) => x.entry.sectionKey)).not.toContain(
                'developer-options',
            );
        });
    });

    describe('release workflow check (scripts/dev/check-release-channel.js)', () => {
        const script = path.join(__dirname, '../../../../scripts/dev/check-release-channel.js');
        const check = (channel: unknown): number => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-'));
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(channel === undefined ? {} : { apoloxChannel: channel }));
            const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
            fs.rmSync(dir, { recursive: true, force: true });
            return result.status ?? -1;
        };

        it.each([
            ['dev', 1],
            [undefined, 1],
            ['Release', 1],
            ['release ', 1],
            [true, 1],
            ['release', 0],
        ])('apoloxChannel %p gives exit code %p', (channel, code) => {
            expect(check(channel)).toBe(code);
        });

        it('should say the repository itself is a dev build (only the release workflow switches it)', () => {
            const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
            expect(result.status).toBe(1);
        });
    });
});
