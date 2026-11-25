import { Component, ViewEncapsulation } from '@angular/core';
import { AppearanceServiceBase } from '../../../services/appearance/appearance.service.base';
import { NavigationServiceBase } from '../../../services/navigation/navigation.service.base';
import { DialogServiceBase } from '../../../services/dialog/dialog.service.base';
import { enterLeftToRight, enterRightToLeft } from '../../animations/animations';
import { AnimatedPage } from '../animated-page';
import { SettingsJump, SettingsSearchResult, scrollToSettingsSection } from './settings-search/settings-search';

@Component({
    selector: 'app-settings',
    host: { style: 'display: block; width: 100%;' },
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
    encapsulation: ViewEncapsulation.None,
    animations: [enterLeftToRight, enterRightToLeft],
})
export class SettingsComponent extends AnimatedPage {
    public constructor(
        public appearanceService: AppearanceServiceBase,
        private navigationService: NavigationServiceBase,
        private dialogService: DialogServiceBase,
    ) {
        super();
    }

    /** Opens what the settings search found: a section of Settings or Manage collection, or the equalizer. */
    public async goToAsync(result: SettingsSearchResult): Promise<void> {
        const entry = result?.entry;

        if (entry === undefined) {
            return;
        }

        if (entry.place === 'settings') {
            if (entry.page !== this.page) {
                this.setPage(entry.page);
            }

            scrollToSettingsSection(document, entry.sectionKey);
        } else if (entry.place === 'manage-collection') {
            SettingsJump.request(entry.page, entry.sectionKey);
            await this.navigationService.navigateToManageCollectionAsync();
        } else if (entry.place === 'equalizer') {
            await this.dialogService.showEqualizerDialogAsync();
        }
    }
}
