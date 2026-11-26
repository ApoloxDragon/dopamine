import { NetworkDrives, SharePath } from './network-drives';

/**
 * Nicknames for network shares ("Home server" instead of /run/user/1000/gvfs/smb-share:server=192.168.10.183,share=storage),
 * kept per server and share, so a nickname stays when the share comes back under another folder name (other user name,
 * KDE instead of GNOME). Stored as JSON text in the settings. Only shares the desktop mounted (GNOME, KDE) can have one.
 */
export class NetworkDriveNicknames {
    public static readonly maximumLength: number = 60;
    public static readonly maximumCount: number = 100;

    public constructor(
        private read: () => string | undefined,
        private write: (json: string) => void,
    ) {}

    /** "192.168.10.183/storage" (lower case) for a path on a share, or undefined. */
    public static keyOf(path: string): string | undefined {
        const share: SharePath | undefined = NetworkDrives.sharePathOf(path);
        return share === undefined ? undefined : `${share.host}/${share.share}`.toLowerCase();
    }

    /** Trimmed, without control characters, at most 60 characters; '' when nothing is left. */
    public static clean(nickname: string | undefined): string {
        return (nickname ?? '')
            .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, NetworkDriveNicknames.maximumLength)
            .trim();
    }

    public canHaveNickname(path: string): boolean {
        return NetworkDriveNicknames.keyOf(path) !== undefined;
    }

    public get(path: string): string | undefined {
        const key: string | undefined = NetworkDriveNicknames.keyOf(path);
        return key === undefined ? undefined : this.all().get(key);
    }

    /** Sets the nickname of the share the path is on; an empty nickname removes it. Returns whether it was saved. */
    public set(path: string, nickname: string | undefined): boolean {
        const key: string | undefined = NetworkDriveNicknames.keyOf(path);

        if (key === undefined) {
            return false;
        }

        const all: Map<string, string> = this.all();
        const cleaned: string = NetworkDriveNicknames.clean(nickname);

        if (cleaned.length === 0) {
            all.delete(key);
        } else {
            if (!all.has(key) && all.size >= NetworkDriveNicknames.maximumCount) {
                return false;
            }

            all.set(key, cleaned);
        }

        this.write(JSON.stringify(Object.fromEntries(all)));
        return true;
    }

    /** "Home server › music/flac" for a folder on a share with a nickname, undefined otherwise. */
    public display(path: string): string | undefined {
        const nickname: string | undefined = this.get(path);

        if (nickname === undefined) {
            return undefined;
        }

        const rest: string = NetworkDrives.sharePathOf(path)?.rest ?? '';
        return rest.length > 0 ? `${nickname} › ${rest}` : nickname;
    }

    private all(): Map<string, string> {
        try {
            const data: unknown = JSON.parse(this.read() ?? '{}');

            if (data === null || typeof data !== 'object' || Array.isArray(data)) {
                return new Map<string, string>();
            }

            return new Map(
                Object.entries(data as Record<string, unknown>)
                    .filter(([key, value]) => typeof value === 'string' && /^[^/]+\/[^/]+$/.test(key))
                    .map(([key, value]) => [key, NetworkDriveNicknames.clean(value as string)] as [string, string])
                    .filter(([, value]) => value.length > 0)
                    .slice(0, NetworkDriveNicknames.maximumCount),
            );
        } catch (e: unknown) {
            return new Map<string, string>();
        }
    }
}
