import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AlbumModel } from '../../../../services/album/album-model';
import { SettingsBase } from '../../../../common/settings/settings.base';

/** Two rows of covers above the albums: recently added and recently played. Click selects, double-click plays. */
@Component({
    selector: 'app-album-shelves',
    templateUrl: './album-shelves.component.html',
    styleUrls: ['./album-shelves.component.scss'],
})
export class AlbumShelvesComponent {
    public static readonly albumsPerShelf: number = 12;

    public recentlyAdded: AlbumModel[] = [];
    public recentlyPlayed: AlbumModel[] = [];

    public constructor(public settings: SettingsBase) {}

    @Input()
    public set albums(albums: AlbumModel[] | undefined) {
        this.recentlyAdded = AlbumShelvesComponent.recentlyAdded(albums ?? [], AlbumShelvesComponent.albumsPerShelf);
        this.recentlyPlayed = AlbumShelvesComponent.recentlyPlayed(albums ?? [], AlbumShelvesComponent.albumsPerShelf);
    }

    @Output() public albumSelected: EventEmitter<AlbumModel> = new EventEmitter<AlbumModel>();
    @Output() public albumPlayed: EventEmitter<AlbumModel> = new EventEmitter<AlbumModel>();

    public get isOpen(): boolean {
        return this.settings.showAlbumShelves;
    }

    public toggle(): void {
        this.settings.showAlbumShelves = !this.settings.showAlbumShelves;
    }

    /** Newest first. Albums without a date are left out. */
    public static recentlyAdded(albums: AlbumModel[], count: number): AlbumModel[] {
        return AlbumShelvesComponent.newest(albums, (x) => x.dateAddedInTicks, count);
    }

    /** Last played first. Albums never played are left out. */
    public static recentlyPlayed(albums: AlbumModel[], count: number): AlbumModel[] {
        return AlbumShelvesComponent.newest(albums, (x) => x.dateLastPlayedInTicks, count);
    }

    private static newest(albums: AlbumModel[], date: (album: AlbumModel) => number, count: number): AlbumModel[] {
        return albums
            .filter((x) => x != undefined && Number.isFinite(date(x)) && date(x) > 0)
            .sort((a, b) => date(b) - date(a))
            .slice(0, Math.max(0, count));
    }
}
