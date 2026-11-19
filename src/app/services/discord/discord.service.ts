import { Injectable } from '@angular/core';
import { Subscription } from 'rxjs';
import { DateProxy } from '../../common/io/date-proxy';
import { Logger } from '../../common/logger';
import { SettingsBase } from '../../common/settings/settings.base';
import { PlaybackService } from '../playback/playback.service';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { IpcProxyBase } from '../../common/io/ipc-proxy.base';
import { DiscordApiCommandType } from './discord-api-command-type';
import { DiscordApiCommand } from './discord-api-command';
import { PresenceArgs } from './presence-args';
import { DiscordAlbumArtResolver } from './discord-album-art-resolver';
import { TrackModel } from '../track/track-model';
import { StringUtils } from '../../common/utils/string-utils';

@Injectable({ providedIn: 'root' })
export class DiscordService {
    /** Discord activity type: "Listening to". */
    public static readonly listeningActivityType: number = 2;
    /** Discord status display type: show the activity's state (the artist) in the status. */
    public static readonly showStateInStatus: number = 1;

    private _subscription: Subscription | undefined;
    private _updatePresenceTimeout: ReturnType<typeof setTimeout>;
    private _updatePresenceTimeoutMillis: number = 1000;

    public constructor(
        private playbackService: PlaybackService,
        private translatorService: TranslatorServiceBase,
        private dateProxy: DateProxy,
        private ipcProxy: IpcProxyBase,
        private settings: SettingsBase,
        private logger: Logger,
        private albumArtResolver: DiscordAlbumArtResolver,
    ) {}

    public get enableDiscordRichPresence(): boolean {
        return this.settings.enableDiscordRichPresence;
    }

    public set enableDiscordRichPresence(v: boolean) {
        this.settings.enableDiscordRichPresence = v;
        this.initialize();
    }

    public get showAlbumCover(): boolean {
        return this.settings.showAlbumCoverInDiscordRichPresence;
    }

    public set showAlbumCover(v: boolean) {
        this.settings.showAlbumCoverInDiscordRichPresence = v;
        this.updatePresence();
    }

    public initialize(): void {
        if (this.settings.enableDiscordRichPresence) {
            this.addSubscriptions();
            this.updatePresence();
        } else {
            this.removeSubscriptions();
            this.clearPresence();
        }
    }

    private addSubscriptions(): void {
        this._subscription = new Subscription();

        this._subscription.add(
            this.playbackService.playbackStarted$.subscribe(() => {
                this.updatePresence();
            }),
        );

        this._subscription.add(
            this.playbackService.playbackPaused$.subscribe(() => {
                this.updatePresence();
            }),
        );

        this._subscription.add(
            this.playbackService.playbackResumed$.subscribe(() => {
                this.updatePresence();
            }),
        );

        this._subscription.add(
            this.playbackService.playbackStopped$.subscribe(() => {
                this.clearPresence();
            }),
        );

        this._subscription.add(
            this.playbackService.playbackSkipped$.subscribe(() => {
                this.updatePresence();
            }),
        );
    }

    private removeSubscriptions(): void {
        if (this._subscription) {
            this._subscription.unsubscribe();
        }
    }

    private calculateElapsedTimeInMilliseconds(): number {
        return this.playbackService.progress.progressSeconds * 1000;
    }

    private clearPresence(): void {
        this.ipcProxy.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.ClearPresence, undefined));
    }

    private updatePresence(): void {
        if (this._updatePresenceTimeout) {
            clearTimeout(this._updatePresenceTimeout);
        }

        this._updatePresenceTimeout = setTimeout(() => {
            if (this.playbackService.currentTrack == undefined) {
                this.logger.info(`No currentTrack was found. Not setting Discord Rich Presence.`, 'DiscordService', 'updatePresence');
                return;
            }

            const track: TrackModel = this.playbackService.currentTrack;
            let smallImageKey: string = 'pause';
            let smallImageText: string = this.translatorService.get('paused');
            let startTime: number = 0;
            let endTime: number | undefined;
            let shouldSendTimestamps: boolean = false;

            if (this.playbackService.canPause) {
                const now: number = this.dateProxy.now();
                startTime = now - this.calculateElapsedTimeInMilliseconds();
                endTime = this.calculateEndTime(now);
                shouldSendTimestamps = true;
                smallImageKey = 'play';
                smallImageText = this.translatorService.get('playing');
            }

            // Like Spotify: song title, artist, and the album as the cover's caption.
            const album: string = track.rawAlbumTitle;
            const coverUrl: string | undefined = this.showAlbumCover ? this.albumArtResolver.getCachedUrl(track) : '';

            const args: PresenceArgs = {
                title: track.title,
                artists: track.artists,
                smallImageKey: smallImageKey,
                smallImageText: smallImageText,
                largeImageKey: StringUtils.isNullOrWhiteSpace(coverUrl) ? 'icon' : coverUrl,
                largeImageText: StringUtils.isNullOrWhiteSpace(album) ? this.translatorService.get('playing-with-dopamine') : album,
                shouldSendTimestamps: shouldSendTimestamps,
                startTime: startTime,
                endTime: endTime,
                type: DiscordService.listeningActivityType,
                // The status reads "Listening to <artist>" instead of "Listening to Dopamine".
                statusDisplayType: DiscordService.showStateInStatus,
            };

            this.ipcProxy.sendToMainProcess('discord-api-command', new DiscordApiCommand(DiscordApiCommandType.SetPresence, args));

            if (this.showAlbumCover && coverUrl === undefined) {
                // Not looked up yet: show the Dopamine icon now, the cover once it is found.
                void this.albumArtResolver.resolveAsync(track).then((url: string) => {
                    if (!StringUtils.isNullOrWhiteSpace(url) && this.playbackService.currentTrack?.path === track.path) {
                        this.updatePresence();
                    }
                });
            }
        }, this._updatePresenceTimeoutMillis);
    }

    /** End of the track in wall clock time, for Discord's progress bar. Takes the playback speed into account. */
    private calculateEndTime(now: number): number | undefined {
        const progress = this.playbackService.progress;
        // Right after a song starts the player may not know its length yet: then use the length from the collection.
        const totalSeconds: number =
            progress.totalSeconds > 0 ? progress.totalSeconds : (this.playbackService.currentTrack?.durationInMilliseconds ?? 0) / 1000;
        const remainingSeconds: number = totalSeconds - progress.progressSeconds;

        if (!(totalSeconds > 0) || remainingSeconds < 0) {
            return undefined;
        }

        const speed: number = this.playbackService.playbackSpeed > 0 ? this.playbackService.playbackSpeed : 1;
        return now + Math.round((remainingSeconds * 1000) / speed);
    }
}
