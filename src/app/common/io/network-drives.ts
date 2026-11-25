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
