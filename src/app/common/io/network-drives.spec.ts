import { NetworkDrives, NetworkDrivesFileSystem } from './network-drives';

function fileSystem(folders: Record<string, string[]>, mounts: string = '', existing: string[] = []): NetworkDrivesFileSystem {
    return {
        readFileSync: (path: string): string => {
            if (path !== '/proc/mounts') {
                throw new Error('ENOENT');
            }
            return mounts;
        },
        readdirSync: (path: string): string[] => {
            if (!(path in folders)) {
                throw new Error('ENOENT');
            }
            return folders[path];
        },
        existsSync: (path: string): boolean => existing.includes(path) || path in folders,
    };
}

describe('NetworkDrives', () => {
    const gvfs = '/run/user/1000/gvfs';

    it('the regular customer: a Samba share opened in GNOME Files', () => {
        const drives = new NetworkDrives(fileSystem({ [gvfs]: ['smb-share:server=192.168.10.183,share=storage'] }), 1000, 'linux').find();

        expect(drives).toEqual([
            { label: 'storage on 192.168.10.183', kind: 'samba', path: `${gvfs}/smb-share:server=192.168.10.183,share=storage` },
        ]);
    });

    it('should find KDE (kio-fuse) shares and system mounts too, each folder once', () => {
        const mounts = [
            '//nas/music /mnt/music cifs rw 0 0',
            'nas:/export/flac /mnt/my\\040flac nfs4 rw 0 0',
            'user@box:/srv /home/a/box fuse.sshfs rw 0 0',
            '/dev/sda1 / ext4 rw 0 0',
            'proc /proc proc rw 0 0',
            '//nas/music /mnt/music cifs rw 0 0',
        ].join('\n');
        const folders = {
            '/run/user/1000': ['kio-fuse-ABC', 'gvfs', 'bus'],
            '/run/user/1000/kio-fuse-ABC': ['smb'],
            '/run/user/1000/kio-fuse-ABC/smb': ['dell-bian'],
            '/run/user/1000/kio-fuse-ABC/smb/dell-bian': ['storage'],
        };

        const drives = new NetworkDrives(fileSystem(folders, mounts), 1000, 'linux').find();

        expect(drives.map((d) => [d.kind, d.path])).toEqual([
            ['samba', '/run/user/1000/kio-fuse-ABC/smb/dell-bian/storage'],
            ['samba', '/mnt/music'],
            ['nfs', '/mnt/my flac'],
            ['sftp', '/home/a/box'],
        ]);
    });

    it('should list nothing on Windows and macOS, and nothing without a user id', () => {
        expect(new NetworkDrives(fileSystem({ [gvfs]: ['smb-share:server=a,share=b'] }), 1000, 'win32').find()).toEqual([]);
        expect(new NetworkDrives(fileSystem({ [gvfs]: ['smb-share:server=a,share=b'] }), undefined, 'linux').find()).toEqual([]);
    });

    it('should turn an smb:// address into the GNOME folder when that share is connected', () => {
        const root = `${gvfs}/smb-share:server=192.168.10.183,share=storage`;
        const drives = new NetworkDrives(fileSystem({}, '', [root, `${root}/music`, `${root}/My Music`]), 1000, 'linux');

        expect(drives.resolveSmbUrl('smb://192.168.10.183/storage/music')).toEqual(`${root}/music`);
        expect(drives.resolveSmbUrl('SMB://192.168.10.183/Storage/')).toEqual(root);
        expect(drives.resolveSmbUrl('smb://192.168.10.183/storage/My%20Music')).toEqual(`${root}/My Music`);
        expect(drives.resolveSmbUrl('smb://other/storage/music')).toBeUndefined();
    });

    // Trying to break it.

    it.each([
        ['', undefined],
        ['smb://', undefined],
        ['smb://host', undefined],
        ['smb://host/', undefined],
        ['smb://host/share/../../etc', undefined],
        ['smb://host/../x', undefined],
        ['smb://host/share/%2e%2e/etc', undefined],
        ['smb://host/share/%00', undefined],
        ['smb://host/share/%E0%A4%A', undefined],
        ['http://host/share', undefined],
        ['smb://user:secret@host/share', { host: 'host', share: 'share', rest: '' }],
        ['smb://host:445/share/a//b/', { host: 'host', share: 'share', rest: 'a/b' }],
    ])('should parse %j safely', (url: string, expected: any) => {
        expect(NetworkDrives.parseSmbUrl(url)).toEqual(expected);
    });

    it('should describe GVFS folder names, odd ones included', () => {
        expect(NetworkDrives.describeGvfsName('sftp:host=box,user=me')).toEqual({ label: 'box', kind: 'sftp' });
        expect(NetworkDrives.describeGvfsName('dav:host=cloud,ssl=true,prefix=%2Fremote')).toEqual({
            label: 'remote on cloud',
            kind: 'webdav',
        });
        expect(NetworkDrives.describeGvfsName('smb-share:server=a,share=My%20Music')).toEqual({ label: 'My Music on a', kind: 'samba' });
        expect(NetworkDrives.describeGvfsName('lizard')).toEqual({ label: 'lizard', kind: 'other' });
        expect(NetworkDrives.describeGvfsName('smb-share:server=%E0%A4%A,share=x').kind).toEqual('samba');
    });

    it('should not be thrown by a broken /proc/mounts or folders that cannot be listed', () => {
        expect(NetworkDrives.parseMounts('garbage\n\n   \n//x cifs\n')).toEqual([]);
        expect(NetworkDrives.parseMounts(undefined as any)).toEqual([]);
        expect(new NetworkDrives(fileSystem({}), 1000, 'linux').find()).toEqual([]);
    });
});
