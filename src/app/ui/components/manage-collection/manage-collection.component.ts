import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { AppearanceServiceBase } from '../../../services/appearance/appearance.service.base';
import { AnimatedPage } from '../animated-page';
import { enterLeftToRight, enterRightToLeft } from '../../animations/animations';
import { SettingsJump, scrollToSettingsSection } from '../settings/settings-search/settings-search';

@Component({
    selector: 'app-manage-collection',
    templateUrl: './manage-collection.component.html',
    styleUrls: ['./manage-collection.component.scss'],
    encapsulation: ViewEncapsulation.None,
    animations: [enterLeftToRight, enterRightToLeft],
})
export class ManageCollectionComponent extends AnimatedPage implements OnInit {
    public constructor(public appearanceService: AppearanceServiceBase) {
        super();
    }

    /** Opens the page and section that the settings search asked for, if any. */
    public ngOnInit(): void {
        const jump = SettingsJump.take();

        if (jump !== undefined) {
            this.setPage(jump.page);
            scrollToSettingsSection(document, jump.sectionKey);
        }
    }
}
