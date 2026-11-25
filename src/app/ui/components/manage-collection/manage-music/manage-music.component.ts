import { Component, Optional, ViewEncapsulation } from '@angular/core';
import { SettingsBase } from '../../../../common/settings/settings.base';

@Component({
    selector: 'app-manage-music',
    host: { style: 'display: block; width: 100%;' },
    templateUrl: './manage-music.component.html',
    styleUrls: ['./manage-music.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class ManageMusicComponent {
    public constructor(@Optional() public settings?: SettingsBase) {}
}
