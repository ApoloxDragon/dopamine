import { Injectable } from '@angular/core';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { NetworkDrive, NetworkDrives } from '../../common/io/network-drives';
import { NetworkDriveNicknames } from '../../common/io/network-drive-nicknames';
import { SettingsBase } from '../../common/settings/settings.base';
import { Logger } from '../../common/logger';

/**
 * Network drives that are already connected (see NetworkDrives). Opt-in: nothing is looked at unless the setting
 * "Look for network drives" is on. Connecting a share is only done when the user asks for it.
 */
@Injectable({ providedIn: 'root' })
export class NetworkDrivesService {
    public static readonly mountTimeoutMs: number = 20000;
    private readonly drives: NetworkDrives;
    public readonly nicknames: NetworkDriveNicknames;

    public constructor(
        private settings: SettingsBase,
        private logger: Logger,
    ) {
        const userId: number | undefined = typeof process.getuid === 'function' ? process.getuid() : undefined;
        this.drives = new NetworkDrives(fs, userId, process.platform);
        this.nicknames = new NetworkDriveNicknames(
            () => this.settings.networkDriveNicknames,
            (json) => (this.settings.networkDriveNicknames = json),
        );
    }

    /** The nickname view of a folder ("Home server › music"), or the path itself. */
    public displayNameOf(path: string): string {
        return this.nicknames.display(path) ?? path;
    }

    /** True when the user allowed looking for network drives. */
    public get isAllowed(): boolean {
        return this.settings.lookForNetworkDrives === true;
    }

    public allow(): void {
        this.settings.lookForNetworkDrives = true;
    }

    /** Can this computer connect smb:// shares itself (GNOME's gio)? */
    public get canConnectShares(): boolean {
        return process.platform === 'linux';
    }

    /** Connected network drives, or nothing when not allowed. */
    public find(): NetworkDrive[] {
        return this.isAllowed ? this.drives.find().map((x) => ({ ...x, label: this.nicknames.get(x.path) ?? x.label })) : [];
    }

    /** The folder for an smb:// address of a share that is connected, or undefined. */
    public resolveSmbUrl(url: string): string | undefined {
        return this.drives.resolveSmbUrl(url);
    }

    /**
     * Connects an smb:// share as a guest through the desktop (gio mount --anonymous), only when the user asked for it.
     * Resolves to the folder, or undefined when it could not be connected (for example when it needs a password).
     */
    public async connectAsGuestAsync(url: string): Promise<string | undefined> {
        const parsed = NetworkDrives.parseSmbUrl(url);

        if (parsed === undefined || !this.canConnectShares) {
            return undefined;
        }

        // Only the share itself is mounted; the folder inside it is found afterwards. execFile: no shell, so nothing in
        // the address can be run as a command.
        const shareUrl: string = `smb://${encodeURIComponent(parsed.host)}/${encodeURIComponent(parsed.share)}`;

        await new Promise<void>((resolve) => {
            execFile('gio', ['mount', '--anonymous', shareUrl], { timeout: NetworkDrivesService.mountTimeoutMs }, (error) => {
                if (error) {
                    this.logger.warn(`Could not connect ${shareUrl}: ${error.message}`, 'NetworkDrivesService', 'connectAsGuestAsync');
                }
                resolve();
            });
        });

        return this.drives.resolveSmbUrl(url);
    }
}
