import { Injectable } from '@angular/core';

@Injectable({providedIn: 'root'})
export class MediaSessionProxy {
    public setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler): void {
        window.navigator.mediaSession.setActionHandler(action, handler);
    }

    public clearActionHandler(action: MediaSessionAction): void {
        window.navigator.mediaSession.setActionHandler(action, () => undefined);
    }

    public setMetadata(title: string, artist: string, album: string, artwork: string): void {
        window.navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: artist,
            album: album,
            artwork: artwork === '' ? [] : [{ src: artwork }],
        });
    }

    /** Loads an image bundled with the app as a data URL (the only kind of URL the OS media controls show). '' on failure. */
    public async loadImageAsDataUrlAsync(relativePath: string): Promise<string> {
        try {
            const response: Response = await fetch(relativePath);
            const blob: Blob = await response.blob();

            return await new Promise<string>((resolve) => {
                const reader: FileReader = new FileReader();
                reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
                reader.onerror = () => resolve('');
                reader.readAsDataURL(blob);
            });
        } catch {
            return '';
        }
    }

    public clearMetadata(): void {
        window.navigator.mediaSession.metadata = null;
    }

    public setPlaybackState(state: MediaSessionPlaybackState): void {
        window.navigator.mediaSession.playbackState = state;
    }

    public setPositionState(state?: MediaPositionState): void {
        if (typeof window.navigator.mediaSession.setPositionState === 'function') {
            window.navigator.mediaSession.setPositionState(state);
        }
    }
}
