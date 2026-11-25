import { Component, OnInit } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { NetworkDrive } from '../../../../common/io/network-drives';
import { NetworkFolderCheck, NetworkFolderPath } from '../../../../common/io/network-folder-path';
import { DesktopBase } from '../../../../common/io/desktop.base';
import { TranslatorServiceBase } from '../../../../services/translator/translator.service.base';
import { DialogServiceBase } from '../../../../services/dialog/dialog.service.base';
import { NetworkDrivesService } from '../../../../services/network-drives/network-drives.service';

/**
 * Add a network folder: pick a network drive that is already connected (when looking for them is allowed) and then a
 * folder inside it, or type a path or an smb:// address. Closes with the folder path, or '' when cancelled.
 */
@Component({
    selector: 'app-network-folder-dialog',
    templateUrl: './network-folder-dialog.component.html',
    styleUrls: ['./network-folder-dialog.component.scss'],
})
export class NetworkFolderDialogComponent implements OnInit {
    public drives: NetworkDrive[] = [];
    public typed: string = '';
    public problem: string = '';
    public isBusy: boolean = false;

    public constructor(
        public networkDrives: NetworkDrivesService,
        private desktop: DesktopBase,
        private translatorService: TranslatorServiceBase,
        private dialogService: DialogServiceBase,
        private dialogRef: MatDialogRef<NetworkFolderDialogComponent>,
    ) {}

    public ngOnInit(): void {
        this.refresh();
    }

    public refresh(): void {
        this.drives = this.networkDrives.find();
    }

    /** The user opts in from here: look for network drives from now on. */
    public allow(): void {
        this.networkDrives.allow();
        this.refresh();
    }

    public icon(drive: NetworkDrive): string {
        return drive.kind === 'samba' ? 'las la-server' : drive.kind === 'nfs' ? 'las la-hdd' : 'las la-network-wired';
    }

    /** Opens the folder picker inside the drive, so the music folder on it can be chosen. */
    public async pickInAsync(drive: NetworkDrive): Promise<void> {
        const title: string = await this.translatorService.getAsync('select-folder');
        const path: string = await this.desktop.showSelectFolderDialogAsync(title, drive.path);

        if (path.length > 0) {
            this.dialogRef.close(path);
        }
    }

    /** A typed path is used as is; an smb:// address is turned into the folder of the connected share. */
    public async useTypedAsync(): Promise<void> {
        this.problem = '';
        const checked: NetworkFolderCheck = NetworkFolderPath.check(this.typed);

        if (checked.path !== undefined) {
            this.dialogRef.close(checked.path);
            return;
        }

        if (checked.problem === 'url' && /^smb:\/\//i.test(this.typed.trim())) {
            await this.useSmbAddressAsync(this.typed.trim());
            return;
        }

        this.problem = await this.translatorService.getAsync(
            checked.problem === 'url' ? 'network-folder-url' : 'network-folder-not-a-path',
        );
    }

    public cancel(): void {
        this.dialogRef.close('');
    }

    private async useSmbAddressAsync(url: string): Promise<void> {
        let folder: string | undefined = this.networkDrives.resolveSmbUrl(url);

        if (folder === undefined && this.networkDrives.canConnectShares) {
            // Never connect without asking.
            const title: string = await this.translatorService.getAsync('add-network-folder');
            const text: string = await this.translatorService.getAsync('connect-share-as-guest', { address: url });

            if (await this.dialogService.showConfirmationDialogAsync(title, text)) {
                this.isBusy = true;
                folder = await this.networkDrives.connectAsGuestAsync(url);
                this.isBusy = false;
            } else {
                return;
            }
        }

        if (folder !== undefined) {
            this.dialogRef.close(folder);
            return;
        }

        this.problem = await this.translatorService.getAsync('share-could-not-be-connected');
    }
}
