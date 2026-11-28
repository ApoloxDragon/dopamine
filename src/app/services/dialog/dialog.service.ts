import { NetworkFolderDialogComponent } from '../../ui/components/dialogs/network-folder-dialog/network-folder-dialog.component';
import { Injectable } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../../ui/components/dialogs/confirmation-dialog/confirmation-dialog.component';
import { EditColumnsDialogComponent } from '../../ui/components/dialogs/edit-columns-dialog/edit-columns-dialog.component';
import { EditPlaylistDialogComponent } from '../../ui/components/dialogs/edit-playlist-dialog/edit-playlist-dialog.component';
import { ErrorDialogComponent } from '../../ui/components/dialogs/error-dialog/error-dialog.component';
import { InputDialogComponent } from '../../ui/components/dialogs/input-dialog/input-dialog.component';
import { LicenseDialogComponent } from '../../ui/components/dialogs/license-dialog/license-dialog.component';
import { PlaylistModel } from '../playlist/playlist-model';
import { PlaylistModelFactory } from '../playlist/playlist-model-factory';
import { ConfirmationData } from './confirmation-data';
import { ErrorData } from './error-data';
import { InputData } from './input-data';
import { PlaylistData } from './playlist-data';
import { DialogServiceBase } from './dialog.service.base';
import { TrackModel } from '../track/track-model';
import { EditTracksDialogComponent } from '../../ui/components/dialogs/edit-tracks-dialog/edit-tracks-dialog.component';
import { InfoDialogComponent } from '../../ui/components/dialogs/info-dialog/info-dialog.component';
import { InfoData } from './info-data';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { EditSmartPlaylistDialogComponent } from '../../ui/components/dialogs/edit-smart-playlist-dialog/edit-smart-playlist-dialog.component';
import { FileFormats } from '../../common/application/file-formats';
import { AlbumModel } from '../album/album-model';
import { EditAlbumDialogComponent } from '../../ui/components/dialogs/edit-album-dialog/edit-album-dialog.component';
import { ArtistModel } from '../artist/artist-model';
import { EditArtistDialogComponent } from '../../ui/components/dialogs/edit-artist-dialog/edit-artist-dialog.component';
import { EqualizerDialogComponent } from '../../ui/components/dialogs/equalizer-dialog/equalizer-dialog.component';

@Injectable()
export class DialogService implements DialogServiceBase {
    public constructor(
        private dialog: MatDialog,
        private playlistModelFactory: PlaylistModelFactory,
        private translatorService: TranslatorServiceBase,
    ) {}

    public async showConfirmationDialogAsync(dialogTitle: string, dialogText: string): Promise<boolean> {
        const dialogRef: MatDialogRef<ConfirmationDialogComponent, boolean> = this.dialog.open(ConfirmationDialogComponent, {
            width: '450px',
            data: new ConfirmationData(dialogTitle, dialogText),
        });

        const result: boolean | undefined = await dialogRef.afterClosed().toPromise();

        return result != undefined && result;
    }

    /** The text typed, or '' when cancelled (callers treat an empty answer as "do nothing"). */
    public async showInputDialogAsync(
        dialogTitle: string,
        placeHolderText: string,
        inputText: string,
        invalidCharacters: string[],
        description: string = '',
        icon: string = 'las la-question',
    ): Promise<string> {
        return (
            (await this.showInputDialogOrCancelAsync(dialogTitle, placeHolderText, inputText, invalidCharacters, description, icon)) ?? ''
        );
    }

    public async showInputDialogOrCancelAsync(
        dialogTitle: string,
        placeHolderText: string,
        inputText: string,
        invalidCharacters: string[],
        description: string = '',
        icon: string = 'las la-question',
        allowEmpty: boolean = false,
    ): Promise<string | undefined> {
        const inputData: InputData = new InputData(
            dialogTitle,
            inputText,
            placeHolderText,
            invalidCharacters,
            description,
            icon,
            allowEmpty,
        );
        const dialogRef: MatDialogRef<InputDialogComponent> = this.dialog.open(InputDialogComponent, {
            width: '450px',
            data: inputData,
        });

        // OK and Enter close with true; Cancel closes with false. Before, Cancel still gave back what was typed.
        const confirmed: unknown = await dialogRef.afterClosed().toPromise();

        return confirmed === true ? (inputData.inputText ?? '') : undefined;
    }

    public showErrorDialog(errorText: string): void {
        this.dialog.open(ErrorDialogComponent, {
            width: '450px',
            data: new ErrorData(errorText, false),
        });
    }

    public showInfoDialog(infoText: string): void {
        this.dialog.open(InfoDialogComponent, {
            width: '450px',
            data: new InfoData(infoText),
        });
    }

    public showLicenseDialog(): void {
        this.dialog.open(LicenseDialogComponent, {
            width: '450px',
        });
    }

    public async showEditPlaylistDialogAsync(playlist: PlaylistModel): Promise<void> {
        if (playlist.path.endsWith(FileFormats.dspl)) {
            await this.showEditSmartPlaylistDialogAsync(playlist);
            return;
        }

        const playlistData = new PlaylistData(playlist);
        const dialogRef: MatDialogRef<EditPlaylistDialogComponent> = this.dialog.open(EditPlaylistDialogComponent, {
            width: '450px',
            data: playlistData,
        });

        await dialogRef.afterClosed().toPromise();
    }

    public async showEditSmartPlaylistDialogAsync(playlist: PlaylistModel): Promise<void> {
        const playlistData = new PlaylistData(playlist);
        const dialogRef: MatDialogRef<EditSmartPlaylistDialogComponent> = this.dialog.open(EditSmartPlaylistDialogComponent, {
            width: '750px',
            data: playlistData,
        });

        await dialogRef.afterClosed().toPromise();
    }

    public async showCreatePlaylistDialogAsync(): Promise<void> {
        const defaultPlaylist: PlaylistModel = this.playlistModelFactory.createDefault();
        const playlistData: PlaylistData = new PlaylistData(defaultPlaylist);
        const dialogRef: MatDialogRef<EditPlaylistDialogComponent> = this.dialog.open(EditPlaylistDialogComponent, {
            width: '450px',
            data: playlistData,
        });

        await dialogRef.afterClosed().toPromise();
    }

    public async showCreateSmartPlaylistDialogAsync(): Promise<void> {
        const defaultPlaylist: PlaylistModel = this.playlistModelFactory.createDefault();
        const playlistData: PlaylistData = new PlaylistData(defaultPlaylist);
        const dialogRef: MatDialogRef<EditSmartPlaylistDialogComponent> = this.dialog.open(EditSmartPlaylistDialogComponent, {
            width: '750px',
            data: playlistData,
        });

        await dialogRef.afterClosed().toPromise();
    }

    public async showEditColumnsDialogAsync(): Promise<void> {
        const dialogRef: MatDialogRef<EditColumnsDialogComponent> = this.dialog.open(EditColumnsDialogComponent, {
            width: '450px',
        });

        await dialogRef.afterClosed().toPromise();
    }

    public async showEqualizerDialogAsync(): Promise<void> {
        const dialogRef: MatDialogRef<EqualizerDialogComponent> = this.dialog.open(EqualizerDialogComponent, {
            width: '520px',
        });

        await dialogRef.afterClosed().toPromise();
    }

    public async showNetworkFolderDialogAsync(): Promise<string> {
        const dialogRef: MatDialogRef<NetworkFolderDialogComponent> = this.dialog.open(NetworkFolderDialogComponent, {
            width: '520px',
        });
        const chosen: unknown = await dialogRef.afterClosed().toPromise();

        return typeof chosen === 'string' ? chosen : '';
    }

    public async showEditTracksAsync(tracks: TrackModel[]): Promise<boolean> {
        // Safety guard: editing writes tags into the file, and a CUE track's file holds the whole album
        // (see docs/cue-support/DRAFTS.md, D1).
        if (tracks.some((x) => x.isCueTrack)) {
            this.showErrorDialog(await this.translatorService.getAsync('cue-tracks-cannot-be-edited'));
            return false;
        }

        const dialogRef: MatDialogRef<EditTracksDialogComponent, boolean> = this.dialog.open(EditTracksDialogComponent, {
            data: tracks,
        });

        const result: boolean | undefined = await dialogRef.afterClosed().toPromise();

        return result != undefined && result;
    }

    public async showEditAlbumsAsync(albums: AlbumModel[]): Promise<void> {
        const dialogRef: MatDialogRef<EditAlbumDialogComponent> = this.dialog.open(EditAlbumDialogComponent, {
            width: '450px',
            data: albums,
        });

        await dialogRef.afterClosed().toPromise();
    }

    public async showEditArtistAsync(artist: ArtistModel): Promise<void> {
        const dialogRef: MatDialogRef<EditArtistDialogComponent> = this.dialog.open(EditArtistDialogComponent, {
            data: artist,
            width: '684px',
        });

        await dialogRef.afterClosed().toPromise();
    }

    public async cannotPlayM4aFileAsync(): Promise<void> {
        const message: string = await this.translatorService.getAsync('cannot-play-m4a-file');
        this.showErrorDialog(message);
    }

    public async cannotPlayAudioFileAsync(): Promise<void> {
        const message: string = await this.translatorService.getAsync('cannot-play-audio-file');
        this.showErrorDialog(message);
    }
}
