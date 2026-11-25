/**
 * Checks a folder path typed by hand (for a network share or a mounted drive) before it is added to the collection.
 * Returns the cleaned path, or why it cannot be used. Does not touch the disk or the network.
 */
export type NetworkFolderCheck = { path: string; problem: undefined } | { path: undefined; problem: 'empty' | 'url' | 'relative' };

export class NetworkFolderPath {
    public static check(typed: string | undefined | null): NetworkFolderCheck {
        // Quotes come along when a path is copied from a file manager or a terminal.
        const path: string = (typed ?? '')
            .trim()
            .replace(/^(["'])(.*)\1$/, '$2')
            .trim();

        if (path.length === 0) {
            return { path: undefined, problem: 'empty' };
        }

        // smb://, nfs://, sftp:// ... are addresses for a file manager, not folders the app can read: they must be mounted.
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
            return { path: undefined, problem: 'url' };
        }

        const isUnc: boolean = /^\\\\[^\\/]+[\\/][^\\/]+/.test(path) || /^\/\/[^/]+\/[^/]+/.test(path);
        const isWindowsDrive: boolean = /^[a-z]:[\\/]/i.test(path);
        const isPosixAbsolute: boolean = path.startsWith('/') && !path.startsWith('//');

        if (!isUnc && !isWindowsDrive && !isPosixAbsolute) {
            return { path: undefined, problem: 'relative' };
        }

        // A trailing separator would make the same folder look like a different one ("Z:\music\" and "Z:\music").
        const withoutTrailing: string = path.length > 3 ? path.replace(/[\\/]+$/, '') : path;

        return { path: withoutTrailing, problem: undefined };
    }
}
