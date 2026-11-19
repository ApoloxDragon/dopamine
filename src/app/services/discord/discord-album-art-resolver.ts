import { Injectable } from '@angular/core';
import { LastfmApi } from '../../common/api/lastfm/lastfm.api';
import { LastfmAlbum } from '../../common/api/lastfm/lastfm-album';
import { Logger } from '../../common/logger';
import { StringUtils } from '../../common/utils/string-utils';
import { TrackModel } from '../track/track-model';

/**
 * Finds a public URL of an album cover for Discord Rich Presence.
 *
 * Discord can only show images that are reachable on the internet (or uploaded to the Discord application), so a
 * cover stored on this computer cannot be sent. The cover is looked up on Last.fm, which means the album title and
 * album artist are sent to Last.fm. Results (also "not found") are cached per album for the lifetime of the app.
 */
@Injectable({ providedIn: 'root' })
export class DiscordAlbumArtResolver {
    private readonly cache: Map<string, string> = new Map<string, string>();
    private readonly pending: Map<string, Promise<string>> = new Map<string, Promise<string>>();

    public constructor(
        private lastfmApi: LastfmApi,
        private logger: Logger,
    ) {}

    /** Returns the cached cover URL, '' when the album has no cover, or undefined when it was not looked up yet. */
    public getCachedUrl(track: TrackModel): string | undefined {
        const key: string | undefined = this.createKey(track);
        return key === undefined ? '' : this.cache.get(key);
    }

    /** Looks up the cover URL. Resolves to '' when there is none. Never rejects. */
    public async resolveAsync(track: TrackModel): Promise<string> {
        const key: string | undefined = this.createKey(track);

        if (key === undefined) {
            return '';
        }

        const cached: string | undefined = this.cache.get(key);

        if (cached !== undefined) {
            return cached;
        }

        let request: Promise<string> | undefined = this.pending.get(key);

        if (request === undefined) {
            request = this.lookUpAsync(track.rawFirstAlbumArtist, track.rawAlbumTitle).then((url: string) => {
                this.cache.set(key, url);
                this.pending.delete(key);
                return url;
            });
            this.pending.set(key, request);
        }

        return request;
    }

    private createKey(track: TrackModel): string | undefined {
        const album: string = track.rawAlbumTitle;
        const artist: string = track.rawFirstAlbumArtist;

        if (StringUtils.isNullOrWhiteSpace(album) || StringUtils.isNullOrWhiteSpace(artist)) {
            return undefined;
        }

        return `${artist.toLowerCase()}\u0000${album.toLowerCase()}`;
    }

    private async lookUpAsync(artist: string, album: string): Promise<string> {
        try {
            const lastfmAlbum: LastfmAlbum = await this.lastfmApi.getAlbumInfoAsync(artist, album, false, 'EN');
            const candidates: string[] = [lastfmAlbum.imageExtraLarge, lastfmAlbum.imageLarge, lastfmAlbum.imageMega, lastfmAlbum.imageMedium];
            const url: string | undefined = candidates.find((x) => !StringUtils.isNullOrWhiteSpace(x) && x.startsWith('https://'));

            return url ?? '';
        } catch (e: unknown) {
            this.logger.warn(`Could not look up album cover for Discord: ${String(e)}`, 'DiscordAlbumArtResolver', 'lookUpAsync');
            return '';
        }
    }
}
