import { Injectable } from '@angular/core';
import { LikedKind, LikedRepositoryBase } from '../../data/repositories/liked-repository.base';
import { Logger } from '../../common/logger';
import { TrackModel } from '../track/track-model';

/**
 * Likes and dislikes of albums and artists (songs keep theirs in Track.Love). Kept in memory after the first read; every
 * change is stored at once.
 */
@Injectable({ providedIn: 'root' })
export class LikeService {
    private cache: Map<LikedKind, Map<string, number>> = new Map();

    public constructor(
        private repository: LikedRepositoryBase,
        private logger: Logger,
    ) {}

    /** 1 liked, -1 disliked, 0 neither. */
    public albumLike(albumKey: string | undefined): number {
        return this.get('album', albumKey);
    }

    public artistLike(artist: string | undefined): number {
        return this.get('artist', LikeService.artistKey(artist));
    }

    /** Likes the album, or clears the like when it is already liked. */
    public toggleAlbumLike(albumKey: string, value: 1 | -1): void {
        this.toggle('album', albumKey, value);
    }

    public toggleArtistLike(artist: string, value: 1 | -1): void {
        this.toggle('artist', LikeService.artistKey(artist), value);
    }

    /** Album keys that are liked. */
    public likedAlbumKeys(): string[] {
        return [...this.all('album').entries()].filter(([, v]) => v === 1).map(([k]) => k);
    }

    /** True when the song's album or one of its artists is disliked (smart shuffle and continuous play leave it out). */
    public isDislikedByAlbumOrArtist(track: TrackModel): boolean {
        if (this.albumLike(track.albumKey) === -1) {
            return true;
        }

        return (track.rawArtists ?? []).some((artist) => this.artistLike(artist) === -1);
    }

    private get(kind: LikedKind, key: string | undefined): number {
        return key === undefined || key.length === 0 ? 0 : (this.all(kind).get(key) ?? 0);
    }

    private toggle(kind: LikedKind, key: string, value: 1 | -1): void {
        if (key === undefined || key.length === 0) {
            return;
        }

        const next: number = this.get(kind, key) === value ? 0 : value;

        try {
            this.repository.set(kind, key, next, Date.now());
            const values: Map<string, number> = this.all(kind);
            next === 0 ? values.delete(key) : values.set(key, next);
        } catch (e: unknown) {
            this.logger.error(e, `Could not save the ${kind} like`, 'LikeService', 'toggle');
        }
    }

    private all(kind: LikedKind): Map<string, number> {
        let values: Map<string, number> | undefined = this.cache.get(kind);

        if (values === undefined) {
            try {
                values = this.repository.getAll(kind);
            } catch (e: unknown) {
                this.logger.error(e, `Could not read the ${kind} likes`, 'LikeService', 'all');
                values = new Map();
            }

            this.cache.set(kind, values);
        }

        return values;
    }

    private static artistKey(artist: string | undefined): string {
        return (artist ?? '').trim().toLowerCase();
    }
}
