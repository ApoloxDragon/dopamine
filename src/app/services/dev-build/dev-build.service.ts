import { Injectable } from '@angular/core';
import { DevBuild } from '../../common/application/dev-build';
import { ProductInformation } from '../../common/application/product-information';
import { Logger } from '../../common/logger';
import { SettingsBase } from '../../common/settings/settings.base';
import { DialogServiceBase } from '../dialog/dialog.service.base';
import { TranslatorServiceBase } from '../translator/translator.service.base';

/** Development builds only: extra logging and the warning at startup. Does nothing at all in a release build. */
@Injectable({ providedIn: 'root' })
export class DevBuildService {
    public constructor(
        private settings: SettingsBase,
        private dialogService: DialogServiceBase,
        private translatorService: TranslatorServiceBase,
        private logger: Logger,
    ) {}

    public get isDevBuild(): boolean {
        return DevBuild.isActive;
    }

    /** At startup: turns on extra logging when chosen. A release build always keeps it off. */
    public initialize(): void {
        Logger.extraLogging = DevBuild.isActive && this.settings.devExtraLogging === true;

        if (DevBuild.isActive) {
            this.logger.info(
                `Development build of ${ProductInformation.applicationVersion}; extra logging ${Logger.extraLogging ? 'on' : 'off'}`,
                'DevBuildService',
                'initialize',
            );
        }
    }

    public get extraLogging(): boolean {
        return DevBuild.isActive && this.settings.devExtraLogging === true;
    }

    public set extraLogging(value: boolean) {
        if (!DevBuild.isActive) {
            return;
        }

        this.settings.devExtraLogging = value;
        Logger.extraLogging = value;
        this.logger.info(`Extra logging turned ${value ? 'on' : 'off'}`, 'DevBuildService', 'extraLogging');
    }

    /** Once per version: says this is a development build. Never in a release build. Never throws. */
    public showWarningIfNeeded(): void {
        if (!DevBuild.isActive || this.settings.devWarningShownForVersion === ProductInformation.applicationVersion) {
            return;
        }

        try {
            this.settings.devWarningShownForVersion = ProductInformation.applicationVersion;
            this.dialogService.showInfoDialog(this.translatorService.get('dev-build-warning'));
        } catch (e: unknown) {
            this.logger.error(e, 'Could not show the development build warning', 'DevBuildService', 'showWarningIfNeeded');
        }
    }
}
