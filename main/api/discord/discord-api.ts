import { Client, Presence } from 'discord-rpc';
import log from 'electron-log';
import { PresenceArgs } from './presence-args';

export class DiscordApi {
    private readonly _clientId: string;
    private _client: Client;
    private _isReady: boolean;
    private _presenceToSetWhenReady: PresenceArgs | undefined;
    private _isReconnecting: boolean = false;

    public constructor(clientId: string) {
        this._clientId = clientId;
    }

    private reconnect(): void {
        if (this._isReconnecting) {
            log.info('[DiscordApi] [reconnect] Already attempting to reconnect. Skipping...');
            return;
        }

        this._isReconnecting = true;
        this._isReady = false;
        this._client = new Client({ transport: 'ipc' });

        this._client.on('ready', () => {
            log.info('[DiscordApi] [ready] Discord client is ready!');
            this._isReady = true;

            if (this._presenceToSetWhenReady) {
                this.setPresence(this._presenceToSetWhenReady);
                this._presenceToSetWhenReady = undefined;
            }
        });

        this._client.on('disconnected', () => {
            log.info('[DiscordApi] [disconnected] Discord client disconnected. Attempting to reconnect...');
            this._isReady = false;
            this.login();
        });

        this.login();
    }

    private async login(): Promise<void> {
        try {
            await this._client.login({ clientId: this._clientId });
            log.info('[DiscordApi] [login] Successfully logged into Discord client');
        } catch (error) {
            log.error(`[DiscordApi] [login] Failed to log into Discord client: ${error}`);
        } finally {
            this._isReconnecting = false;
        }
    }

    public setPresence(args: PresenceArgs): void {
        if (!this._isReady) {
            log.warn('[DiscordApi] [setPresence] Discord client is not ready. Attempting reconnect.');
            this._presenceToSetWhenReady = args;
            this.reconnect();

            return;
        }

        // Discord rejects the whole activity when a text is shorter than 2 or longer than 128 characters, or a value is
        // not what it expects, so everything is checked here (the renderer can send anything).
        const presence: Presence & { type?: number; statusDisplayType?: number } = {
            details: DiscordApi.fitText(args.title) ?? 'Unknown title',
            state: DiscordApi.fitText(args.artists) ?? 'Unknown artist',
            largeImageKey: DiscordApi.isImageKey(args.largeImageKey) ? args.largeImageKey : 'icon',
            largeImageText: DiscordApi.fitText(args.largeImageText),
            smallImageKey: args.smallImageKey,
            smallImageText: DiscordApi.fitText(args.smallImageText),
            type: args.type,
            // Sent as status_display_type (see patch-discord-rpc.js).
            statusDisplayType: args.statusDisplayType,
        };

        if (args.shouldSendTimestamps && DiscordApi.isTimestamp(args.startTime)) {
            // Discord activity timestamps are Unix time in milliseconds (seconds made the progress bar end in 1970).
            presence.startTimestamp = Math.floor(args.startTime);

            // With an end time Discord shows a progress bar, like Spotify does.
            if (DiscordApi.isTimestamp(args.endTime) && Math.floor(args.endTime) > presence.startTimestamp) {
                presence.endTimestamp = Math.floor(args.endTime);
            }
        }

        if (!this._client) {
            log.error('[DiscordApi] [setPresence] Discord client not found.');
            return;
        }

        try {
            // setActivity returns a promise in discord-rpc; a lost connection must not become an unhandled rejection.
            const result: unknown = this._client.setActivity(presence);

            if (result instanceof Promise) {
                result.catch((e: unknown) => log.warn(`[DiscordApi] [setPresence] Could not update Rich Presence: ${String(e)}`));
            }
        } catch (e: unknown) {
            log.warn(`[DiscordApi] [setPresence] Could not update Rich Presence: ${String(e)}`);
            return;
        }

        log.info(`[DiscordApi] [setPresence] Rich Presence updated: ${presence.state} - ${presence.details} (${presence.smallImageKey})`);
    }

    /** The 'icon' asset, or a cover URL Discord can show (https, at most 256 characters). */
    private static isImageKey(key: unknown): key is string {
        return key === 'icon' || (typeof key === 'string' && key.startsWith('https://') && key.length <= 256);
    }

    /** A Unix time in milliseconds that Discord accepts. */
    private static isTimestamp(value: unknown): value is number {
        return typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isSafeInteger(Math.floor(value));
    }

    /**
     * Text that Discord accepts (2 to 128 characters), or undefined when there is no text. Cuts between characters, never
     * through an emoji (a cut surrogate pair is invalid text), and replaces broken surrogates.
     */
    private static fitText(value: unknown): string | undefined {
        if (typeof value !== 'string' && typeof value !== 'number') {
            return undefined;
        }

        const text: string = String(value)
            .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
            .replace(/\0/g, '')
            .trim();

        if (text.length === 0) {
            return undefined;
        }

        if (text.length > 128) {
            let cut: string = '';

            for (const character of text) {
                if (cut.length + character.length > 127) {
                    break;
                }

                cut += character;
            }

            return cut + '…';
        }

        // Pad very short texts (e.g. a one letter title) to Discord's minimum of 2 characters.
        return text.length < 2 ? text.padEnd(2, ' ') : text;
    }

    public clearPresence(): void {
        this._presenceToSetWhenReady = undefined;

        if (!this._isReady) {
            log.warn('[DiscordApi] [clearPresence] Discord client is not ready. Cannot clear presence.');
            return;
        }

        if (!this._client) {
            log.error('[DiscordApi] [clearPresence] Discord client not found.');
            return;
        }

        this._client.clearActivity();
        log.info('[DiscordApi] [clearPresence] Rich Presence cleared.');
    }

    public shutdown(): void {
        this._presenceToSetWhenReady = undefined;

        if (!this._client) {
            log.warn('[DiscordApi] [shutdown] Discord client not found.');
            return;
        }

        if (this._isReady) {
            this._client.clearActivity();
        }

        this._client.destroy();
        log.info('[DiscordApi] [shutdown] Discord client destroyed.');
    }
}
