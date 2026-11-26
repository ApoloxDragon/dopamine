/**
 * Network drives that are already connected on this computer, so a music folder on them can be added like any folder.
 * Dopamine does not speak Samba (SMB) itself: it uses what the desktop already mounted.
 *
 * Linux:
 * - GNOME (Files/Nautilus) shows shares it opened under /run/user/<uid>/gvfs, for example
 *   "smb-share:server=192.168.10.183,share=storage".
 * - KDE (Dolphin, with kio-fuse) shows them under /run/user/<uid>/kio-fuse-XXXX/smb/<host>/<share>.
 * - Shares mounted by the system (/etc/fstab, mount -t cifs/nfs, sshfs) are listed in /proc/mounts.
 * Windows and macOS: mapped drives and /Volumes are ordinary folders already; nothing is listed here (for now).
 */
export type NetworkDriveKind = 'samba' | 'nfs' | 'sftp' | 'webdav' | 'ftp' | 'other';

export interface NetworkDrive {
    /** What to show, for example "storage on 192.168.10.183". */
    label: string;
    kind: NetworkDriveKind;
    /** A folder that can be read like any other. */
    path: string;
}

/** A Samba share that a stored path is on, as the desktop shows it. */
export interface SharePath {
    host: string;
    share: string;
    /** Folder where the share itself is (for example /run/user/1000/gvfs/smb-share:server=nas,share=music). */
    root: string;
    /** The rest of the path inside the share ('' for the share itself). */
    rest: string;
    user?: string;
    domain?: string;
}

/** Where a share that moved now is: replace `from` by `to` at the start of the stored paths. */
export interface ShareMove {
    from: string;
    to: string;
}

export interface NetworkDrivesFileSystem {
    readFileSync(path: string, encoding: 'utf8'): string;
    readdirSync(path: string): string[];
    existsSync(path: string): boolean;
}

export class NetworkDrives {
    public constructor(
        private fileSystem: NetworkDrivesFileSystem,
        private userId: number | undefined,
        private platform: string,
    ) {}

    /** Connected network drives, each folder once. Never throws. */
    public find(): NetworkDrive[] {
        if (this.platform !== 'linux') {
            return [];
        }

        const drives: NetworkDrive[] = [...this.fromGvfs(), ...this.fromKioFuse(), ...this.fromMounts()];
        const seen: Set<string> = new Set();

        return drives.filter((x) => (seen.has(x.path) ? false : (seen.add(x.path), true)));
    }

    /**
     * smb://host/share/some/folder -> the folder where GNOME mounted that share, when it is mounted. Returns undefined for
     * anything that is not an smb:// address of a mounted share.
     */
    public resolveSmbUrl(url: string): string | undefined {
        const parsed = NetworkDrives.parseSmbUrl(url);

        if (parsed === undefined || this.userId === undefined) {
            return undefined;
        }

        const root: string = `${this.gvfsRoot()}/smb-share:server=${parsed.host.toLowerCase()},share=${parsed.share.toLowerCase()}`;
        const folder: string = parsed.rest.length > 0 ? `${root}/${parsed.rest}` : root;

        return this.safeExists(folder) ? folder : undefined;
    }

    /**
     * The Samba share a path is on, when it is on one the desktop mounted (GNOME's gvfs folder or KDE's kio-fuse folder).
     * Shares mounted by the system (/mnt, /media) are not recognised: they keep their path.
     */
    public static sharePathOf(path: string): SharePath | undefined {
        const text: string = path ?? '';
        const gvfs: RegExpExecArray | null = /^(\/run\/user\/\d+\/gvfs\/(smb-share:[^/]+))(?:\/(.*))?$/.exec(text);

        if (gvfs !== null) {
            const keys: Map<string, string> = NetworkDrives.gvfsKeys(gvfs[2]);
            const host: string | undefined = keys.get('server');
            const share: string | undefined = keys.get('share');

            if (host === undefined || share === undefined || host.length === 0 || share.length === 0) {
                return undefined;
            }

            return { host, share, root: gvfs[1], rest: gvfs[3] ?? '', user: keys.get('user'), domain: keys.get('domain') };
        }

        const kio: RegExpExecArray | null = /^(\/run\/user\/\d+\/kio-fuse-[^/]+\/smb\/([^/]+)\/([^/]+))(?:\/(.*))?$/.exec(text);

        if (kio !== null) {
            const at: number = kio[2].lastIndexOf('@');
            return {
                host: at >= 0 ? kio[2].slice(at + 1) : kio[2],
                share: kio[3],
                root: kio[1],
                rest: kio[4] ?? '',
                user: at >= 0 ? kio[2].slice(0, at) : undefined,
            };
        }

        return undefined;
    }

    /** Folders where the share is mounted right now (any user, any desktop, or by the system), best first. Never throws. */
    public findShareRoots(host: string, share: string): string[] {
        const same = (a: string | undefined, b: string): boolean => (a ?? '').toLowerCase() === b.toLowerCase();
        const roots: string[] = [];

        if (this.platform !== 'linux') {
            return roots;
        }

        if (this.userId !== undefined) {
            for (const name of this.safeList(this.gvfsRoot()).filter((x) => x.startsWith('smb-share:'))) {
                const keys: Map<string, string> = NetworkDrives.gvfsKeys(name);

                if (same(keys.get('server'), host) && same(keys.get('share'), share)) {
                    roots.push(`${this.gvfsRoot()}/${name}`);
                }
            }

            const runtime: string = `/run/user/${this.userId}`;

            for (const kio of this.safeList(runtime).filter((x) => x.startsWith('kio-fuse-'))) {
                for (const hostFolder of this.safeList(`${runtime}/${kio}/smb`)) {
                    const hostName: string = hostFolder.slice(hostFolder.lastIndexOf('@') + 1);

                    for (const shareFolder of this.safeList(`${runtime}/${kio}/smb/${hostFolder}`)) {
                        if (same(hostName, host) && same(shareFolder, share)) {
                            roots.push(`${runtime}/${kio}/smb/${hostFolder}/${shareFolder}`);
                        }
                    }
                }
            }
        }

        for (const drive of this.fromMounts().filter((x) => x.kind === 'samba')) {
            // The label starts with the source, for example "//192.168.10.183/storage (/mnt/storage)".
            const source: RegExpExecArray | null = /^[\\/]{2}([^\\/]+)[\\/]([^\\/ ]+)/.exec(drive.label);

            if (source !== null && same(source[1], host) && same(source[2], share)) {
                roots.push(drive.path);
            }
        }

        return roots;
    }

    /**
     * For a path that is not there: the same share mounted under another name (for example opened in Files with a user
     * name, which adds ",user=..." to GNOME's folder name), where the same folder exists. Undefined when the path is there,
     * is not on a share, or the share is not mounted anywhere else.
     */
    public findMovedShare(path: string): ShareMove | undefined {
        if (this.safeExists(path)) {
            return undefined;
        }

        const share: SharePath | undefined = NetworkDrives.sharePathOf(path);

        if (share === undefined) {
            return undefined;
        }

        for (const root of this.findShareRoots(share.host, share.share)) {
            if (root !== share.root && this.safeExists(share.rest.length > 0 ? `${root}/${share.rest}` : root)) {
                return { from: share.root, to: root };
            }
        }

        return undefined;
    }

    /** What is there instead, for the log when a share folder is missing. */
    public describeMissing(path: string): string {
        const share: SharePath | undefined = NetworkDrives.sharePathOf(path);

        if (share === undefined || this.userId === undefined) {
            return 'not on a share mounted by the desktop';
        }

        if (!this.safeExists(this.gvfsRoot())) {
            return `${this.gvfsRoot()} does not exist (GNOME's gvfs-fuse is not running, so shares opened in Files are not visible to other apps)`;
        }

        const names: string[] = this.safeList(this.gvfsRoot());
        return names.length === 0
            ? `${this.gvfsRoot()} is empty (no share is open in Files)`
            : `${this.gvfsRoot()} has: ${names.join(', ')}`;
    }

    /** The address to connect a share again with the same name as before: smb://[domain;][user@]host/share. */
    public static smbUrlOf(share: SharePath): string {
        const user: string =
            share.user !== undefined
                ? `${share.domain !== undefined ? `${encodeURIComponent(share.domain)};` : ''}${encodeURIComponent(share.user)}@`
                : '';
        return `smb://${user}${encodeURIComponent(share.host)}/${encodeURIComponent(share.share)}`;
    }

    /** smb://host/share/rest -> its parts, or undefined. Percent-encoded characters are decoded. */
    public static parseSmbUrl(url: string): { host: string; share: string; rest: string } | undefined {
        const match: RegExpExecArray | null = /^smb:\/\/(?:[^@/]*@)?([^/:?#]+)(?::\d+)?\/([^/?#]+)\/?([^?#]*)$/i.exec((url ?? '').trim());

        if (match === null) {
            return undefined;
        }

        try {
            const decode = (x: string): string => decodeURIComponent(x);
            const rest: string = match[3]
                .split('/')
                .filter((x) => x.length > 0)
                .map(decode)
                .join('/');
            const parts = { host: decode(match[1]), share: decode(match[2]), rest };

            // No way out of the share ("..") and nothing that could not be a folder name.
            if ([parts.host, parts.share, ...rest.split('/')].some((x) => x === '..' || x === '.' || x.includes('\0'))) {
                return undefined;
            }

            return parts;
        } catch (e: unknown) {
            return undefined;
        }
    }

    /** "smb-share:server=192.168.10.183,share=storage" -> a label and kind. */
    public static describeGvfsName(name: string): { label: string; kind: NetworkDriveKind } {
        const [scheme, rest] = name.split(/:(.*)/s);
        const values: Map<string, string> = new Map(
            (rest ?? '')
                .split(',')
                .map((pair) => pair.split('='))
                .filter((pair) => pair.length === 2)
                .map(([key, value]) => [key, NetworkDrives.unescapeGvfs(value)]),
        );
        const host: string = values.get('server') ?? values.get('host') ?? '';
        const share: string = values.get('share') ?? values.get('prefix')?.replace(/^\//, '') ?? '';
        const kind: NetworkDriveKind = scheme.startsWith('smb')
            ? 'samba'
            : scheme.startsWith('sftp')
              ? 'sftp'
              : scheme.startsWith('dav')
                ? 'webdav'
                : scheme.startsWith('ftp')
                  ? 'ftp'
                  : scheme.startsWith('nfs')
                    ? 'nfs'
                    : 'other';

        const label: string = share.length > 0 && host.length > 0 ? `${share} on ${host}` : host.length > 0 ? host : name;
        return { label, kind };
    }

    /** Lines of /proc/mounts for network file systems -> drives. */
    public static parseMounts(text: string): NetworkDrive[] {
        const kinds: Record<string, NetworkDriveKind> = {
            cifs: 'samba',
            smb3: 'samba',
            smbfs: 'samba',
            nfs: 'nfs',
            nfs4: 'nfs',
            'fuse.sshfs': 'sftp',
            davfs: 'webdav',
            'fuse.rclone': 'other',
        };
        const drives: NetworkDrive[] = [];

        for (const line of (text ?? '').split('\n')) {
            const [source, mountPoint, type] = line.split(' ');
            const kind: NetworkDriveKind | undefined = kinds[type];

            if (kind === undefined || mountPoint === undefined || mountPoint.length === 0) {
                continue;
            }

            // /proc/mounts writes spaces and the like as octal escapes (\040).
            const path: string = mountPoint.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
            const from: string = (source ?? '').replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
            drives.push({ label: `${from} (${path})`, kind, path });
        }

        return drives;
    }

    /** "smb-share:server=nas,share=music,user=me" -> its keys (values unescaped, keys lower case). */
    private static gvfsKeys(name: string): Map<string, string> {
        const rest: string = name.slice(name.indexOf(':') + 1);
        return new Map(
            rest
                .split(',')
                .map((pair) => pair.split('='))
                .filter((pair) => pair.length === 2 && pair[0].length > 0)
                .map(([key, value]) => [key.toLowerCase(), NetworkDrives.unescapeGvfs(value)]),
        );
    }

    private fromGvfs(): NetworkDrive[] {
        if (this.userId === undefined) {
            return [];
        }

        return this.safeList(this.gvfsRoot()).map((name) => ({
            ...NetworkDrives.describeGvfsName(name),
            path: `${this.gvfsRoot()}/${name}`,
        }));
    }

    private fromKioFuse(): NetworkDrive[] {
        if (this.userId === undefined) {
            return [];
        }

        const drives: NetworkDrive[] = [];
        const runtime: string = `/run/user/${this.userId}`;

        for (const kio of this.safeList(runtime).filter((x) => x.startsWith('kio-fuse-'))) {
            for (const protocol of this.safeList(`${runtime}/${kio}`)) {
                const kind: NetworkDriveKind =
                    protocol === 'smb' ? 'samba' : protocol === 'sftp' ? 'sftp' : protocol.startsWith('webdav') ? 'webdav' : 'other';

                for (const host of this.safeList(`${runtime}/${kio}/${protocol}`)) {
                    for (const share of this.safeList(`${runtime}/${kio}/${protocol}/${host}`)) {
                        drives.push({ label: `${share} on ${host}`, kind, path: `${runtime}/${kio}/${protocol}/${host}/${share}` });
                    }
                }
            }
        }

        return drives;
    }

    private fromMounts(): NetworkDrive[] {
        try {
            return NetworkDrives.parseMounts(this.fileSystem.readFileSync('/proc/mounts', 'utf8'));
        } catch (e: unknown) {
            return [];
        }
    }

    private gvfsRoot(): string {
        return `/run/user/${this.userId}/gvfs`;
    }

    private safeList(folder: string): string[] {
        try {
            return this.fileSystem.readdirSync(folder).sort((a, b) => a.localeCompare(b));
        } catch (e: unknown) {
            return [];
        }
    }

    private safeExists(path: string): boolean {
        try {
            return this.fileSystem.existsSync(path);
        } catch (e: unknown) {
            return false;
        }
    }

    /** GVFS escapes characters in its folder names as %XX. */
    private static unescapeGvfs(value: string): string {
        try {
            return decodeURIComponent(value);
        } catch (e: unknown) {
            return value;
        }
    }
}
