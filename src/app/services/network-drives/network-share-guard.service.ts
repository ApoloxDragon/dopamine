import { Injectable } from '@angular/core';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { NetworkDrives, SharePath, ShareMove } from '../../common/io/network-drives';
import { SettingsBase } from '../../common/settings/settings.base';
import { Logger } from '../../common/logger';
import { FolderRepositoryBase } from '../../data/repositories/folder-repository.base';
import { PathRelocationRepositoryBase } from '../../data/repositories/path-relocation-repository.base';
import { DialogServiceBase } from '../dialog/dialog.service.base';
import { TranslatorServiceBase } from '../translator/translator.service.base';
import { Folder } from '../../data/entities/folder';

/** What happened when trying to reach a song on a network share. */
export interface ShareReachResult {
    reachable: boolean;
    /** Set when the share is now under another folder name: the stored paths were moved, and songs in memory must follow. */
    move?: ShareMove;
}

/**
 * Keeps music on a Samba share reachable (Linux, shares opened in GNOME Files or KDE Dolphin):
 * - The same share can appear under another folder name (GNOME adds ",user=..." when it is opened with a user name). Then
 *   the stored paths are moved to the new name, keeping play counts, likes and history.
 * - A share that is not open can be connected again (`gio mount`), with the same user as before: automatically when
 *   "Reconnect network drives" is on, otherwise after asking when a song on it is played.
 */
@Injectable({ providedIn: 'root' })
export class NetworkShareGuardService {
    public static readonly mountTimeoutMs: number = 20000;
    /** One connection attempt (or question) per share in this time. */
    public static readonly retryAfterMs: number = 60000;

    public drives: NetworkDrives;
    public exists: (path: string) => boolean = (path) => {
        try {
            return fs.existsSync(path);
        } catch (e: unknown) {
            return false;
        }
    };
    /** Runs `gio` with the given arguments; resolves with an error text, or undefined when it worked. */
    public runGio: (args: string[]) => Promise<string | undefined> = (args) => NetworkShareGuardService.run('gio', args);
    public platform: string = process.platform;
    public now: () => number = () => Date.now();

    private lastAttemptMs: Map<string, number> = new Map<string, number>();

    public constructor(
        private folderRepository: FolderRepositoryBase,
        private pathRelocationRepository: PathRelocationRepositoryBase,
        private dialogService: DialogServiceBase,
        private translatorService: TranslatorServiceBase,
        private settings: SettingsBase,
        private logger: Logger,
    ) {
        const userId: number | undefined = typeof process.getuid === 'function' ? process.getuid() : undefined;
        this.drives = new NetworkDrives(fs, userId, process.platform);
    }

    /**
     * At startup: music folders on a share that is now under another name are moved to it. Folders on a share that is not
     * there are logged with what is there instead. Returns the moves. Never throws.
     */
    public relocateMovedShares(): ShareMove[] {
        const moves: ShareMove[] = [];

        for (const folder of this.folders()) {
            try {
                if (this.exists(folder.path) || moves.some((x) => folder.path.startsWith(`${x.from}/`) || folder.path === x.from)) {
                    continue;
                }

                const move: ShareMove | undefined = this.drives.findMovedShare(folder.path);

                if (move === undefined) {
                    if (NetworkDrives.sharePathOf(folder.path) !== undefined) {
                        this.logger.warn(
                            `Music folder '${folder.path}' cannot be reached: ${this.drives.describeMissing(folder.path)}`,
                            'NetworkShareGuardService',
                            'relocateMovedShares',
                        );
                    }

                    continue;
                }

                if (this.relocate(move)) {
                    moves.push(move);
                }
            } catch (e: unknown) {
                this.logger.error(e, `Could not check music folder '${folder.path}'`, 'NetworkShareGuardService', 'relocateMovedShares');
            }
        }

        return moves;
    }

    /** At startup, when "Reconnect network drives" is on: connects the shares of music folders that are not there. */
    public async reconnectMissingSharesAsync(): Promise<void> {
        if (this.settings.reconnectNetworkDrives !== true) {
            return;
        }

        const roots: Set<string> = new Set<string>();

        for (const folder of this.folders()) {
            const share: SharePath | undefined = NetworkDrives.sharePathOf(folder.path);

            if (share !== undefined && !roots.has(share.root) && !this.exists(folder.path)) {
                roots.add(share.root);
                await this.connectAsync(share, folder.path);
            }
        }
    }

    /**
     * A song on a share could not be found: looks for the share under another name, then connects it (automatically, or
     * after asking). Returns whether the song can now be played. Never throws.
     */
    public async tryToReachAsync(songPath: string): Promise<ShareReachResult> {
        try {
            const share: SharePath | undefined = NetworkDrives.sharePathOf(songPath);

            if (share === undefined || this.platform !== 'linux') {
                return { reachable: false };
            }

            const moved: ShareMove | undefined = this.drives.findMovedShare(songPath);

            if (moved !== undefined) {
                this.relocate(moved);
                return { reachable: true, move: moved };
            }

            if (!this.mayTryNow(share)) {
                return { reachable: false };
            }

            // Asked (or tried) once per share for a while, so the next songs on it are skipped without asking again.
            this.lastAttemptMs.set(this.key(share), this.now());

            if (this.settings.reconnectNetworkDrives !== true) {
                const connect: boolean = await this.dialogService.showConfirmationDialogAsync(
                    this.translatorService.get('network-share-not-connected-title'),
                    this.translatorService.get('network-share-not-connected-text', { share: `${share.share} (${share.host})` }),
                );

                if (!connect) {
                    return { reachable: false };
                }
            }

            const after: ShareReachResult = await this.connectAsync(share, songPath);
            return after;
        } catch (e: unknown) {
            this.logger.error(e, `Could not reach '${songPath}'`, 'NetworkShareGuardService', 'tryToReachAsync');
            return { reachable: false };
        }
    }

    private async connectAsync(share: SharePath, path: string): Promise<ShareReachResult> {
        this.lastAttemptMs.set(this.key(share), this.now());

        const url: string = NetworkDrives.smbUrlOf(share);
        // Without a user name: as a guest, like the first time. With one: GNOME uses the password it saved (if any).
        const error: string | undefined = await this.runGio(share.user === undefined ? ['mount', '--anonymous', url] : ['mount', url]);

        if (this.exists(path)) {
            this.logger.info(`Connected ${url}`, 'NetworkShareGuardService', 'connectAsync');
            return { reachable: true };
        }

        const moved: ShareMove | undefined = this.drives.findMovedShare(path);

        if (moved !== undefined) {
            this.relocate(moved);
            return { reachable: true, move: moved };
        }

        this.logger.warn(
            `Could not connect ${url}${error !== undefined ? `: ${error}` : ''}. ${this.drives.describeMissing(path)}`,
            'NetworkShareGuardService',
            'connectAsync',
        );

        return { reachable: false };
    }

    private relocate(move: ShareMove): boolean {
        const changes: number | undefined = this.pathRelocationRepository.relocate(move.from, move.to);

        if (changes === undefined) {
            this.logger.warn(
                `The share '${move.from}' is now at '${move.to}', which is already a music folder: nothing was moved`,
                'NetworkShareGuardService',
                'relocate',
            );
            return false;
        }

        this.logger.info(
            `The share '${move.from}' is now at '${move.to}': moved ${changes} stored paths`,
            'NetworkShareGuardService',
            'relocate',
        );
        return true;
    }

    private mayTryNow(share: SharePath): boolean {
        const last: number | undefined = this.lastAttemptMs.get(this.key(share));
        return last === undefined || this.now() - last >= NetworkShareGuardService.retryAfterMs;
    }

    private key(share: SharePath): string {
        return `${share.host.toLowerCase()}/${share.share.toLowerCase()}`;
    }

    private folders(): Folder[] {
        try {
            return this.folderRepository.getFolders() ?? [];
        } catch (e: unknown) {
            this.logger.error(e, 'Could not get the music folders', 'NetworkShareGuardService', 'folders');
            return [];
        }
    }

    /** Runs a program without a terminal (so it cannot wait for a typed password) and with a time limit. */
    private static run(program: string, args: string[]): Promise<string | undefined> {
        return new Promise<string | undefined>((resolve) => {
            let errorText: string = '';
            let done: boolean = false;
            const finish = (result: string | undefined): void => {
                if (!done) {
                    done = true;
                    clearTimeout(timer);
                    resolve(result);
                }
            };

            const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] });
            const timer = setTimeout(() => {
                child.kill();
                finish('timed out');
            }, NetworkShareGuardService.mountTimeoutMs);

            child.stderr?.on('data', (x: Buffer) => (errorText = (errorText + x.toString()).slice(0, 2000)));
            child.on('error', (e: Error) => finish(e.message));
            child.on('close', (code: number | null) => {
                const text: string = errorText.trim();
                finish(code === 0 ? undefined : text.length > 0 ? text : `exit code ${String(code)}`);
            });
        });
    }
}
