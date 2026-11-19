import { Injectable } from '@angular/core';
import { MediaSessionProxy } from '../../common/io/media-session-proxy';
import { TrackModel } from '../track/track-model';
import { Observable, Subject } from 'rxjs';
import { MetadataService } from '../metadata/metadata.service';

@Injectable({ providedIn: 'root' })
export class MediaSessionService {
    private playEvent = new Subject<void>();
    private pauseEvent = new Subject<void>();
    private previousTrackEvent = new Subject<void>();
    private nextTrackEvent = new Subject<void>();

    /** Shown when a track has no cover: the OS keeps the previous cover otherwise (it cannot be cleared). */
    public static readonly placeholderImagePath: string = 'assets/images/media-session-placeholder.png';

    private placeholderImageUrl: string | undefined;
    private metadataRequest: number = 0;

    public constructor(
        private metadataService: MetadataService,
        private mediaSessionProxy: MediaSessionProxy,
    ) {}

    public playEvent$: Observable<void> = this.playEvent.asObservable();
    public pauseEvent$: Observable<void> = this.pauseEvent.asObservable();
    public previousTrackEvent$: Observable<void> = this.previousTrackEvent.asObservable();
    public nextTrackEvent$: Observable<void> = this.nextTrackEvent.asObservable();

    public initialize(): void {
        this.mediaSessionProxy.setActionHandler('play', () => this.playEvent.next());
        this.mediaSessionProxy.setActionHandler('pause', () => this.pauseEvent.next());
        this.mediaSessionProxy.setActionHandler('previoustrack', () => this.previousTrackEvent.next());
        this.mediaSessionProxy.setActionHandler('nexttrack', () => this.nextTrackEvent.next());
    }

    public async setMetadataAsync(track: TrackModel): Promise<void> {
        const request: number = ++this.metadataRequest;

        // Text first, so the media controls update at once; the cover follows.
        this.mediaSessionProxy.setMetadata(track.title, track.artists, track.albumTitle, this.placeholderImageUrl ?? '');

        let imageUrl: string = await this.metadataService.createMediaSessionImageUrlAsync(track);

        if (imageUrl === '') {
            imageUrl = await this.getPlaceholderImageUrlAsync();
        }

        if (request !== this.metadataRequest) {
            // A newer track was set while the cover was loading.
            return;
        }

        this.mediaSessionProxy.setMetadata(track.title, track.artists, track.albumTitle, imageUrl);
    }

    private async getPlaceholderImageUrlAsync(): Promise<string> {
        if (this.placeholderImageUrl === undefined) {
            this.placeholderImageUrl = await this.mediaSessionProxy.loadImageAsDataUrlAsync(MediaSessionService.placeholderImagePath);
        }

        return this.placeholderImageUrl;
    }

    public clearMetadata(): void {
        this.metadataRequest++;
        this.mediaSessionProxy.setPlaybackState('none');
        this.mediaSessionProxy.setPositionState();
        this.mediaSessionProxy.clearMetadata();
    }

    public updatePlaybackState(duration: number, position: number, playbackRate: number, isPlaying: boolean): void {
        this.mediaSessionProxy.setPlaybackState(isPlaying ? 'playing' : 'paused');

        if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) ||
            !Number.isFinite(playbackRate) || playbackRate <= 0) {
            this.mediaSessionProxy.setPositionState();
            return;
        }

        this.mediaSessionProxy.setPositionState({
            duration,
            position: Math.min(duration, Math.max(0, position)),
            playbackRate,
        });
    }
}
