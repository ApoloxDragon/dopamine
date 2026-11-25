import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AlbumModel } from '../../../../services/album/album-model';
import { LikeService } from '../../../../services/like/like.service';
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
    private allAlbums: AlbumModel[] = [];

    public constructor(
        public settings: SettingsBase,
        private likeService?: LikeService,
    ) {}

    @Input()
    public set albums(albums: AlbumModel[] | undefined) {
        this.allAlbums = albums ?? [];
        this.recentlyAdded = AlbumShelvesComponent.recentlyAdded(this.allAlbums, AlbumShelvesComponent.albumsPerShelf);
        this.recentlyPlayed = AlbumShelvesComponent.recentlyPlayed(this.allAlbums, AlbumShelvesComponent.albumsPerShelf);
    }

    /** Liked albums (newest added first). Read each time, so a like in the menu shows at once. */
    public get liked(): AlbumModel[] {
        if (this.likeService === undefined) {
            return [];
        }

        // Read on every screen update: only filter the albums again when the likes or the albums changed.
        const likedKeys: string[] = this.likeService.likedAlbumKeys();
        const signature: string = likedKeys.join('\u0000');

        if (signature !== this.likedSignature || this.allAlbums !== this.likedFrom) {
            const keys: Set<string> = new Set(likedKeys);
            this.likedAlbums = keys.size === 0 ? [] : this.allAlbums.filter((x) => x != undefined && keys.has(x.albumKey));
            this.likedSignature = signature;
            this.likedFrom = this.allAlbums;
        }

        return this.likedAlbums;
    }

    private likedAlbums: AlbumModel[] = [];
    private likedSignature: string | undefined;
    private likedFrom: AlbumModel[] | undefined;

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
