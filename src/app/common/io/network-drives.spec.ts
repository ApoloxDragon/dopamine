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

describe('NetworkDrives: a share that moved', () => {
    const gvfs = '/run/user/1000/gvfs';
    const guest = `${gvfs}/smb-share:server=192.168.10.183,share=storage`;
    const withUser = `${gvfs}/smb-share:server=192.168.10.183,share=storage,user=apolox`;
    const song = `${guest}/music/Band/01 Song.flac`;

    it('the regular customer: opened in Files with a user name, found under its new name', () => {
        const drives = new NetworkDrives(
            fileSystem({ [gvfs]: [withUser.slice(gvfs.length + 1)] }, '', [`${withUser}/music/Band/01 Song.flac`]),
            1000,
            'linux',
        );

        expect(drives.findMovedShare(song)).toEqual({ from: guest, to: withUser });
    });

    it('should find it the other way round, and with other capitals', () => {
        const upper = `${gvfs}/smb-share:server=192.168.10.183,share=Storage`;
        const drives = new NetworkDrives(fileSystem({ [gvfs]: [upper.slice(gvfs.length + 1)] }, '', [`${upper}/music`]), 1000, 'linux');

        expect(drives.findMovedShare(`${withUser}/music`)).toEqual({ from: withUser, to: upper });
    });

    it('should find it mounted by the system or in KDE', () => {
        const mounts = '//192.168.10.183/storage /mnt/storage cifs rw 0 0';
        const system = new NetworkDrives(fileSystem({}, mounts, ['/mnt/storage/music']), 1000, 'linux');
        expect(system.findMovedShare(`${guest}/music`)).toEqual({ from: guest, to: '/mnt/storage' });

        const runtime = '/run/user/1000';
        const kde = new NetworkDrives(
            fileSystem(
                {
                    [runtime]: ['kio-fuse-AbCd'],
                    [`${runtime}/kio-fuse-AbCd/smb`]: ['apolox@192.168.10.183'],
                    [`${runtime}/kio-fuse-AbCd/smb/apolox@192.168.10.183`]: ['storage'],
                },
                '',
                [`${runtime}/kio-fuse-AbCd/smb/apolox@192.168.10.183/storage/music`],
            ),
            1000,
            'linux',
        );
        expect(kde.findMovedShare(`${guest}/music`)).toEqual({
            from: guest,
            to: `${runtime}/kio-fuse-AbCd/smb/apolox@192.168.10.183/storage`,
        });
    });

    it('should read the share of a stored path', () => {
        expect(NetworkDrives.sharePathOf(`${gvfs}/smb-share:domain=HOME,server=nas,share=Music%20Files,user=me/a/b.flac`)).toEqual({
            host: 'nas',
            share: 'Music Files',
            root: `${gvfs}/smb-share:domain=HOME,server=nas,share=Music%20Files,user=me`,
            rest: 'a/b.flac',
            user: 'me',
            domain: 'HOME',
        });
        expect(NetworkDrives.sharePathOf(guest)?.rest).toBe('');
    });

    it('should build the address to connect again with the same name', () => {
        expect(NetworkDrives.smbUrlOf(NetworkDrives.sharePathOf(guest)!)).toBe('smb://192.168.10.183/storage');
        expect(NetworkDrives.smbUrlOf(NetworkDrives.sharePathOf(`${withUser}/x`)!)).toBe('smb://apolox@192.168.10.183/storage');
        expect(NetworkDrives.smbUrlOf({ host: 'nas', share: 'a b', root: '', rest: '', user: 'me', domain: 'HOME' })).toBe(
            'smb://HOME;me@nas/a%20b',
        );
    });

    it('should say what is there instead, for the log', () => {
        expect(new NetworkDrives(fileSystem({}), 1000, 'linux').describeMissing(song)).toContain('gvfs-fuse is not running');
        expect(new NetworkDrives(fileSystem({ [gvfs]: [] }), 1000, 'linux').describeMissing(song)).toContain('is empty');
        expect(new NetworkDrives(fileSystem({ [gvfs]: ['smb-share:server=x,share=y'] }), 1000, 'linux').describeMissing(song)).toContain(
            'smb-share:server=x,share=y',
        );
        expect(new NetworkDrives(fileSystem({}), 1000, 'linux').describeMissing('/home/a/b.flac')).toBe(
            'not on a share mounted by the desktop',
        );
    });

    // Trying to break it.

    it('should not move anything when the path is there, or the share is nowhere else', () => {
        const there = new NetworkDrives(fileSystem({ [gvfs]: [guest.slice(gvfs.length + 1)] }, '', [song]), 1000, 'linux');
        expect(there.findMovedShare(song)).toBeUndefined();

        const nowhere = new NetworkDrives(fileSystem({ [gvfs]: [] }), 1000, 'linux');
        expect(nowhere.findMovedShare(song)).toBeUndefined();
    });

    it('should not take another share of the same server, or the same share name on another server', () => {
        const other = new NetworkDrives(
            fileSystem({ [gvfs]: ['smb-share:server=192.168.10.183,share=backup', 'smb-share:server=192.168.10.99,share=storage'] }, '', [
                `${gvfs}/smb-share:server=192.168.10.183,share=backup/music`,
                `${gvfs}/smb-share:server=192.168.10.99,share=storage/music`,
            ]),
            1000,
            'linux',
        );

        expect(other.findMovedShare(`${guest}/music`)).toBeUndefined();
    });

    it('should not take the share when the folder is not on it there', () => {
        const drives = new NetworkDrives(fileSystem({ [gvfs]: [withUser.slice(gvfs.length + 1)] }), 1000, 'linux');

        expect(drives.findMovedShare(`${guest}/music`)).toBeUndefined();
    });

    it.each([
        ['a local path', '/home/apolox/Music/a.flac'],
        ['nothing', undefined as unknown as string],
        ['an SFTP mount', `${gvfs}/sftp:host=box/a.flac`],
        ['a share without a server', `${gvfs}/smb-share:share=storage/a`],
        ['a share with an empty name', `${gvfs}/smb-share:server=nas,share=/a`],
        ['a sneaky path', `/home/x${gvfs}/smb-share:server=nas,share=s/a`],
    ])('should not see a share in %s', (_, path) => {
        expect(NetworkDrives.sharePathOf(path)).toBeUndefined();
        expect(new NetworkDrives(fileSystem({}), 1000, 'linux').findMovedShare(path)).toBeUndefined();
    });

    it('should do nothing on Windows and macOS, or without a user id', () => {
        expect(
            new NetworkDrives(fileSystem({ [gvfs]: [withUser.slice(gvfs.length + 1)] }), 1000, 'win32').findShareRoots(
                '192.168.10.183',
                'storage',
            ),
        ).toEqual([]);
        expect(
            new NetworkDrives(fileSystem({ [gvfs]: [withUser.slice(gvfs.length + 1)] }), undefined, 'linux').findShareRoots(
                '192.168.10.183',
                'storage',
            ),
        ).toEqual([]);
    });
});
