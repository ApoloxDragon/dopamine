const fs = require('fs');
const os = require('os');
const path = require('path');
const { FolderReachability } = require('./folder-reachability');
const { TrackRemover } = require('./track-remover');
const { TrackUpdater } = require('./track-updater');

// A network share that is offline, a drive that is unplugged, a share that is not mounted: the songs in it must stay in
// the collection. Songs that are really gone from a folder that can be reached must still be removed.

function logger() {
    return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function folders(...paths) {
    return { getFolders: () => paths.map((p, i) => ({ folderId: i + 1, path: p, showInCollection: 1 })) };
}

// readdirSync per folder: an array of names, or an Error to throw.
function fileSystem(listing) {
    return {
        readdirSync: jest.fn((p) => {
            const result = listing[p];
            if (result === undefined) {
                throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
            }
            if (result instanceof Error) {
                throw result;
            }
            return result;
        }),
    };
}

function track(id, trackPath, extra = {}) {
    return { trackId: id, path: trackPath, ...extra };
}

describe('FolderReachability', () => {
    it('the regular customer: a folder that is there is reachable, nothing is skipped', () => {
        const reachability = new FolderReachability(folders('/music'), logger(), fileSystem({ '/music': ['a.flac'] }));

        const isUnreachable = reachability.check([track(1, '/music/a.flac')]);

        expect(isUnreachable(track(1, '/music/a.flac'))).toBe(false);
    });

    it.each([
        ['an offline share (host down)', Object.assign(new Error('EHOSTDOWN'), { code: 'EHOSTDOWN' })],
        ['a share that times out', Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })],
        ['no permission', Object.assign(new Error('EACCES'), { code: 'EACCES' })],
        ['an unplugged drive (missing)', undefined],
    ])('should treat %s as unreachable', (_, error) => {
        const log = logger();
        const listing = error === undefined ? {} : { '//server/music': error };
        const reachability = new FolderReachability(folders('//server/music'), log, fileSystem(listing));

        const isUnreachable = reachability.check([track(1, '//server/music/a.flac')]);

        expect(isUnreachable(track(1, '//server/music/a.flac'))).toBe(true);
        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('should treat an empty folder that has songs as not mounted, and an empty folder without songs as fine', () => {
        const reachability = new FolderReachability(folders('/mnt/nas', '/new'), logger(), fileSystem({ '/mnt/nas': [], '/new': [] }));

        const isUnreachable = reachability.check([track(1, '/mnt/nas/a.flac')]);

        expect(isUnreachable(track(1, '/mnt/nas/a.flac'))).toBe(true);
        expect(isUnreachable(track(2, '/new/b.flac'))).toBe(false);
    });

    it('should check each folder once, however many songs it has', () => {
        const fsMock = fileSystem({});
        const tracks = Array.from({ length: 100000 }, (_, i) => track(i, `/music/${i}.flac`));
        const reachability = new FolderReachability(folders('/music'), logger(), fsMock);

        const started = Date.now();
        const isUnreachable = reachability.check(tracks);
        const skipped = tracks.filter(isUnreachable).length;

        expect(fsMock.readdirSync).toHaveBeenCalledTimes(1);
        expect(skipped).toBe(100000);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    // Trying to break it.

    it('should tell the window which folders could not be reached, and stay quiet when all can', () => {
        const workerProxy = { postMessage: jest.fn() };
        const offline = new FolderReachability(folders('/music', '//nas/music'), logger(), fileSystem({ '/music': ['a'] }), workerProxy);

        offline.check([track(1, '//nas/music/a.flac'), track(2, '//nas/music/b.flac'), track(3, '/music/a.flac')]);

        expect(workerProxy.postMessage).toHaveBeenCalledWith({
            type: 'foldersUnreachable',
            folders: ['//nas/music'],
            numberOfKeptTracks: 2,
        });

        workerProxy.postMessage.mockClear();
        new FolderReachability(folders('/music'), logger(), fileSystem({ '/music': ['a'] }), workerProxy).check([]);
        expect(workerProxy.postMessage).not.toHaveBeenCalled();
    });

    it('should not mix up /music and /music2', () => {
        const reachability = new FolderReachability(folders('/music', '/music2'), logger(), fileSystem({ '/music2': ['x'] }));

        const isUnreachable = reachability.check([track(1, '/music/a.flac'), track(2, '/music2/b.flac')]);

        expect(isUnreachable(track(1, '/music/a.flac'))).toBe(true);
        expect(isUnreachable(track(2, '/music2/b.flac'))).toBe(false);
    });

    it('should match Windows paths whatever their case or slashes, and folders that end with a separator', () => {
        const reachability = new FolderReachability(folders('\\\\192.168.10.183\\storage\\music\\', 'Z:\\Music'), logger(), fileSystem({}));

        const isUnreachable = reachability.check([]);

        expect(isUnreachable(track(1, '\\\\192.168.10.183\\Storage\\MUSIC\\Album\\01.flac'))).toBe(true);
        expect(isUnreachable(track(2, 'z:/music/a.flac'))).toBe(true);
        expect(isUnreachable(track(3, 'C:\\Users\\Admin\\Music\\a.flac'))).toBe(false);
    });

    it('should cover CUE tracks by their album file and sheet', () => {
        const reachability = new FolderReachability(folders('/nas'), logger(), fileSystem({}));

        const isUnreachable = reachability.check([]);

        expect(
            isUnreachable(track(1, '/nas/Album/Album.flac|3', { audioPath: '/nas/Album/Album.flac', cuePath: '/nas/Album/Album.cue' })),
        ).toBe(true);
    });

    it('should keep a song when one of two nested folders is unreachable', () => {
        const reachability = new FolderReachability(folders('/music', '/music/nas'), logger(), fileSystem({ '/music': ['nas'] }));

        const isUnreachable = reachability.check([track(1, '/music/nas/a.flac')]);

        expect(isUnreachable(track(1, '/music/nas/a.flac'))).toBe(true);
        expect(isUnreachable(track(2, '/music/local.flac'))).toBe(false);
    });

    it.each([
        [
            'the folders cannot be read',
            {
                getFolders: () => {
                    throw new Error('database is locked');
                },
            },
        ],
        ['there is no folder repository', undefined],
        ['the folder list has garbage', { getFolders: () => [null, {}, { path: '' }, { path: 42 }, undefined] }],
    ])('should fall back to the old behaviour when %s', (_, repository) => {
        const reachability = new FolderReachability(repository, logger(), fileSystem({}));

        expect(reachability.check([track(1, '/music/a.flac')])(track(1, '/music/a.flac'))).toBe(false);
    });

    it('should not throw on songs with odd or missing paths', () => {
        const reachability = new FolderReachability(folders('/music'), logger(), fileSystem({}));
        const isUnreachable = reachability.check([null, {}, track(1, undefined), track(2, 42)]);

        for (const odd of [null, undefined, {}, track(1, undefined), track(2, 42), track(3, '')]) {
            expect(() => isUnreachable(odd)).not.toThrow();
        }
    });

    it('should work with real folders: a folder that disappears keeps its songs', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reachability-'));
        const local = path.join(root, 'local');
        const share = path.join(root, 'share');
        fs.mkdirSync(local);
        fs.writeFileSync(path.join(local, 'a.flac'), '');
        const reachability = new FolderReachability(folders(local, share), logger());

        const isUnreachable = reachability.check([track(1, path.join(local, 'a.flac')), track(2, path.join(share, 'b.flac'))]);

        expect(isUnreachable(track(1, path.join(local, 'a.flac')))).toBe(false);
        expect(isUnreachable(track(2, path.join(share, 'b.flac')))).toBe(true);
        fs.rmSync(root, { recursive: true, force: true });
    });
});

describe('TrackRemover and TrackUpdater with folders that cannot be reached', () => {
    const local = track(1, '/music/a.flac');
    const goneLocal = track(2, '/music/deleted.flac');
    const onShare = track(3, '//server/music/b.flac');

    function remover(tracks, reachability) {
        const repository = { getAllTracks: () => tracks, deleteTrack: jest.fn() };
        const fileAccess = { pathExists: jest.fn((p) => p === '/music/a.flac') };
        const sut = new TrackRemover({}, repository, fileAccess, { postMessage: jest.fn() }, logger(), undefined, reachability);
        return { sut, repository, fileAccess };
    }

    it('should keep songs on an offline share, remove songs that are really gone, and not touch the share at all', async () => {
        const reachability = new FolderReachability(folders('/music', '//server/music'), logger(), fileSystem({ '/music': ['a.flac'] }));
        const { sut, repository, fileAccess } = remover([local, goneLocal, onShare], reachability);

        await sut.removeTracksThatAreNotFoundOnDiskAsync();

        expect(repository.deleteTrack.mock.calls.map((x) => x[0])).toEqual([2]);
        expect(fileAccess.pathExists).not.toHaveBeenCalledWith('//server/music/b.flac');
    });

    it('should remove songs from the share once it is back and they are really gone', async () => {
        const reachability = new FolderReachability(folders('//server/music'), logger(), fileSystem({ '//server/music': ['other.flac'] }));
        const { sut, repository } = remover([onShare], reachability);

        await sut.removeTracksThatAreNotFoundOnDiskAsync();

        expect(repository.deleteTrack).toHaveBeenCalledWith(3);
    });

    it('should not read songs on an offline share during a full refresh', async () => {
        const reachability = new FolderReachability(folders('/music', '//server/music'), logger(), fileSystem({ '/music': ['a.flac'] }));
        const repository = { getAllTracks: () => [local, onShare], updateTrack: jest.fn() };
        const filler = { addFileMetadataToTrack: jest.fn((t) => Promise.resolve(t)) };
        const sut = new TrackUpdater(repository, {}, filler, { postMessage: jest.fn() }, logger(), reachability);

        await sut.updateTracksThatAreOutOfDateAsync(true);

        expect(filler.addFileMetadataToTrack.mock.calls.map((x) => x[0].trackId)).toEqual([1]);
    });
});
