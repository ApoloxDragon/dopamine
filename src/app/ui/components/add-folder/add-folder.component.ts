import { NetworkDrivesService } from '../../../services/network-drives/network-drives.service';
import { FileAccessBase } from '../../../common/io/file-access.base';
import { NetworkFolderPath, NetworkFolderCheck } from '../../../common/io/network-folder-path';
import { Component, Input, OnInit, ViewEncapsulation } from '@angular/core';
import { Logger } from '../../../common/logger';
import { StringUtils } from '../../../common/utils/string-utils';
import { PromiseUtils } from '../../../common/utils/promise-utils';
import { FolderModel } from '../../../services/folder/folder-model';
import { TranslatorServiceBase } from '../../../services/translator/translator.service.base';
import { FolderServiceBase } from '../../../services/folder/folder.service.base';
import { IndexingService } from '../../../services/indexing/indexing.service';
import { DialogServiceBase } from '../../../services/dialog/dialog.service.base';
import { DesktopBase } from '../../../common/io/desktop.base';
import { SettingsBase } from '../../../common/settings/settings.base';

@Component({
    selector: 'app-add-folder',
    host: { style: 'display: block' },
    templateUrl: './add-folder.component.html',
    styleUrls: ['./add-folder.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class AddFolderComponent implements OnInit {
    public constructor(
        private desktop: DesktopBase,
        private translatorService: TranslatorServiceBase,
        private folderService: FolderServiceBase,
        private dialogService: DialogServiceBase,
        public indexingService: IndexingService,
        private settings: SettingsBase,
        private logger: Logger,
        private fileAccess?: FileAccessBase,
        private networkDrivesService?: NetworkDrivesService,
    ) {}

    /** "Home server › music" for a folder on a network share with a nickname, the path otherwise. */
    public displayNameOf(path: string): string {
        return this.networkDrivesService?.displayNameOf(path) ?? path;
    }

    public canHaveNickname(path: string): boolean {
        return this.networkDrivesService?.nicknames.canHaveNickname(path) === true;
    }

    /** Asks for a nickname for the network share the folder is on (empty removes it). */
    public async setNicknameAsync(folder: FolderModel): Promise<void> {
        const nicknames = this.networkDrivesService?.nicknames;

        if (nicknames === undefined || !nicknames.canHaveNickname(folder.path)) {
            return;
        }

        const nickname: string | undefined = await this.dialogService.showInputDialogOrCancelAsync(
            this.translatorService.get('network-drive-nickname'),
            this.translatorService.get('network-drive-nickname-placeholder'),
            nicknames.get(folder.path) ?? '',
            [],
            this.translatorService.get('network-drive-nickname-description'),
            'las la-pen',
            true,
        );

        // Cancel changes nothing; OK with an empty field removes the nickname.
        if (nickname === undefined) {
            return;
        }

        nicknames.set(folder.path, nickname);
    }

    @Input() public showCheckBoxes: boolean = false;

    public selectedFolder: FolderModel;
    public folders: FolderModel[] = [];

    public get showAllFoldersInCollection(): boolean {
        return this.settings.showAllFoldersInCollection;
    }

    public set showAllFoldersInCollection(v: boolean) {
        this.settings.showAllFoldersInCollection = v;

        if (v) {
            try {
                this.folderService.setAllFoldersVisible();
                PromiseUtils.noAwait(this.getFoldersAsync());
            } catch (e: unknown) {
                this.logger.error(e, 'Could not set all folders visible', 'AddFolderComponent', 'showAllFoldersInCollection');
            }
        }
    }

    public async ngOnInit(): Promise<void> {
        await this.getFoldersAsync();
    }

    public setFolderVisibility(folder: FolderModel): void {
        this.showAllFoldersInCollection = false;

        try {
            this.folderService.setFolderVisibility(folder);
        } catch (e: unknown) {
            this.logger.error(e, 'Could not set folder visibility', 'AddFolderComponent', 'setFolderVisibility');
        }
    }

    public async getFoldersAsync(): Promise<void> {
        try {
            this.folders = this.folderService.getFolders();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not get folders', 'AddFolderComponent', 'getFolders');

            const errorText: string = await this.translatorService.getAsync('get-folders-error');
            this.dialogService.showErrorDialog(errorText);
        }
    }

    public setSelectedFolder(folder: FolderModel): void {
        this.selectedFolder = folder;
    }

    public async addFolderAsync(): Promise<void> {
        const dialogTitle: string = await this.translatorService.getAsync('select-folder');

        const selectedFolderPath: string = await this.desktop.showSelectFolderDialogAsync(dialogTitle);

        if (!StringUtils.isNullOrWhiteSpace(selectedFolderPath)) {
            try {
                await this.folderService.addFolderAsync(selectedFolderPath);
                await this.getFoldersAsync();
            } catch (e: unknown) {
                this.logger.error(e, `Could not add folder with path='${selectedFolderPath}'`, 'AddFolderComponent', 'addFolderAsync');

                const errorText: string = await this.translatorService.getAsync('add-folder-error');
                this.dialogService.showErrorDialog(errorText);
            }
        }
    }

    /** Adds a folder by typing its path: a network share (for example \\\\server\\share\\music) or a mounted drive. */
    public async addNetworkFolderAsync(): Promise<void> {
        const typed: string = await this.dialogService.showNetworkFolderDialogAsync();

        if (StringUtils.isNullOrWhiteSpace(typed)) {
            return;
        }

        const checked: NetworkFolderCheck = NetworkFolderPath.check(typed);

        if (checked.path === undefined) {
            const key: string = checked.problem === 'url' ? 'network-folder-url' : 'network-folder-not-a-path';
            this.dialogService.showErrorDialog(await this.translatorService.getAsync(key));
            return;
        }

        // A share that is offline right now can still be added: its songs appear once it can be reached.
        if (this.fileAccess !== undefined && !this.fileAccess.pathExists(checked.path)) {
            const confirmTitle: string = await this.translatorService.getAsync('add-network-folder');
            const confirmText: string = await this.translatorService.getAsync('network-folder-unreachable-confirm', {
                folderPath: checked.path,
            });

            if (!(await this.dialogService.showConfirmationDialogAsync(confirmTitle, confirmText))) {
                return;
            }
        }

        try {
            await this.folderService.addFolderAsync(checked.path);
            await this.getFoldersAsync();
        } catch (e: unknown) {
            this.logger.error(e, `Could not add folder with path='${checked.path}'`, 'AddFolderComponent', 'addNetworkFolderAsync');
            this.dialogService.showErrorDialog(await this.translatorService.getAsync('add-folder-error'));
        }
    }

    public async deleteFolderAsync(folder: FolderModel): Promise<void> {
        const dialogTitle: string = await this.translatorService.getAsync('confirm-delete-folder');
        const dialogText: string = await this.translatorService.getAsync('confirm-delete-folder-long', { folderPath: folder.path });

        const userHasConfirmed: boolean = await this.dialogService.showConfirmationDialogAsync(dialogTitle, dialogText);

        if (userHasConfirmed) {
            try {
                this.folderService.deleteFolder(folder);
                await this.getFoldersAsync();
            } catch (e: unknown) {
                this.logger.error(e, 'Could not delete folder', 'AddFolderComponent', 'deleteFolderAsync');

                const errorText: string = await this.translatorService.getAsync('delete-folder-error');
                this.dialogService.showErrorDialog(errorText);
            }
        }
    }
}
