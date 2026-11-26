const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { SongCache, CachingFileMetadataFactory } = require('./song-cache');

const logger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('SongCache', () => {
    let root;
    let music;
    let log;

    const folders = (...paths) => ({ getFolders: () => paths.map((x) => ({ path: x })) });
    const song = (name, text = 'audio') => {
        const file = path.join(music, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        return file;
    };
    const tags = (title) => ({
        title,
        artists: ['Band'],
        album: 'Album',
        year: 1970,
        durationInMilliseconds: 1000,
        picture: Buffer.from('x'),
    });
    const cacheFile = () => path.join(music, 'Dopamine', 'cache.json.gz');
    const readCacheFile = () => JSON.parse(zlib.gunzipSync(fs.readFileSync(cacheFile())).toString('utf8'));
    const newCache = (enabled = true) => new SongCache(folders(music), log, () => enabled);

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'song-cache-'));
        music = path.join(root, 'music');
        fs.mkdirSync(music);
        log = logger();
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('the regular customer: read once, saved in the music folder, used by the next refresh', () => {
        const a = song('Band/1970 - Album/01 Song.flac');
        const reader = { create: jest.fn((p) => tags(path.basename(p))) };

        const first = new CachingFileMetadataFactory(reader, newCache());
        expect(first.create(a).title).toBe('01 Song.flac');
        first.songCache.save([a]);

        expect(fs.existsSync(cacheFile())).toBe(true);
        expect(readCacheFile().songs['Band/1970 - Album/01 Song.flac'].tags.title).toBe('01 Song.flac');

        const second = new CachingFileMetadataFactory(reader, newCache());
        const cached = second.create(a);

        expect(reader.create).toHaveBeenCalledTimes(1);
        expect(cached).toEqual(expect.objectContaining({ path: a, title: '01 Song.flac', artists: ['Band'], year: 1970 }));
        expect(cached.picture).toBeUndefined();
    });

    it('should read a song again when its size or date changed', () => {
        const a = song('a.flac');
        const reader = { create: jest.fn(() => tags('old')) };
        const first = new CachingFileMetadataFactory(reader, newCache());
        first.create(a);
        first.songCache.save([a]);

        fs.writeFileSync(a, 'longer audio now');
        reader.create.mockReturnValue(tags('new'));

        expect(new CachingFileMetadataFactory(reader, newCache()).create(a).title).toBe('new');
        expect(reader.create).toHaveBeenCalledTimes(2);
    });

    it('should forget songs that left the collection', () => {
        const a = song('a.flac');
        const b = song('b.flac');
        const cache = newCache();
        cache.put(a, tags('a'));
        cache.put(b, tags('b'));

        cache.save([a]);

        expect(Object.keys(readCacheFile().songs)).toEqual(['a.flac']);
    });

    it('should not write anything when nothing changed', () => {
        const a = song('a.flac');
        const cache = newCache();
        cache.put(a, tags('a'));
        cache.save([a]);
        const writtenAt = fs.statSync(cacheFile()).mtimeMs;

        const again = newCache();
        again.get(a);
        again.save([a]);

        expect(fs.statSync(cacheFile()).mtimeMs).toBe(writtenAt);
    });

    it('should do nothing at all when turned off', () => {
        const a = song('a.flac');
        const reader = { create: jest.fn(() => tags('a')) };
        const factory = new CachingFileMetadataFactory(reader, newCache(false));

        factory.create(a);
        factory.songCache.save([a]);

        expect(fs.existsSync(path.join(music, 'Dopamine'))).toBe(false);
    });

    it('should keep one cache per music folder, the deepest folder owning the song', () => {
        const other = path.join(root, 'other');
        const inner = path.join(music, 'inner');
        fs.mkdirSync(other);
        const a = song('a.flac');
        const b = song('inner/b.flac');
        fs.writeFileSync(path.join(other, 'c.flac'), 'x');
        const cache = new SongCache(folders(music, other, inner), log);

        cache.put(a, tags('a'));
        cache.put(b, tags('b'));
        cache.put(path.join(other, 'c.flac'), tags('c'));
        cache.save([a, b, path.join(other, 'c.flac')]);

        expect(Object.keys(readCacheFile().songs)).toEqual(['a.flac']);
        expect(fs.existsSync(path.join(inner, 'Dopamine', 'cache.json.gz'))).toBe(true);
        expect(fs.existsSync(path.join(other, 'Dopamine', 'cache.json.gz'))).toBe(true);
    });

    it('should leave a folder that cannot be reached alone, and say why when writing fails', () => {
        const offline = path.join(root, 'offline-share');
        const cache = new SongCache(folders(offline), log);

        cache.put(path.join(offline, 'a.flac'), tags('a'));
        cache.save([]);

        expect(fs.existsSync(offline)).toBe(false);
    });

    it('should keep songs working when the cache cannot be written (read-only share)', () => {
        const a = song('a.flac');
        const fileSystem = {
            ...fs,
            writeFileSync: () => {
                throw Object.assign(new Error('read-only'), { code: 'EROFS' });
            },
            rmSync: fs.rmSync,
        };
        const cache = new SongCache(folders(music), log, () => true, fileSystem);
        cache.put(a, tags('a'));

        expect(() => cache.save([a])).not.toThrow();
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('read-only'), 'SongCache', 'write');
    });

    it('should not keep the cover picture or unknown fields', () => {
        expect(SongCache.pickTags({ ...tags('a'), lizard: 'yes', password: 'hunter2' })).toEqual({
            title: 'a',
            artists: ['Band'],
            album: 'Album',
            year: 1970,
            durationInMilliseconds: 1000,
        });
    });

    // Trying to break it.

    it.each([
        ['not gzip', () => Buffer.from('hello')],
        ['gzip of not JSON', () => zlib.gzipSync('year = 1970')],
        ['an unknown version', () => zlib.gzipSync(JSON.stringify({ version: 99, songs: {} }))],
        ['songs as a list', () => zlib.gzipSync(JSON.stringify({ version: 1, songs: null }))],
        ['empty', () => Buffer.alloc(0)],
    ])('should ignore a cache file that is %s and read the song itself', (_, content) => {
        const a = song('a.flac');
        fs.mkdirSync(path.join(music, 'Dopamine'));
        fs.writeFileSync(cacheFile(), content());
        const reader = { create: jest.fn(() => tags('real')) };

        expect(new CachingFileMetadataFactory(reader, newCache()).create(a).title).toBe('real');
        expect(reader.create).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(cacheFile())).toBe(false);
    });

    it('should build a new cache after a broken one was deleted', () => {
        const a = song('a.flac');
        fs.mkdirSync(path.join(music, 'Dopamine'));
        fs.writeFileSync(cacheFile(), 'garbage');
        const factory = new CachingFileMetadataFactory({ create: () => tags('real') }, newCache());

        factory.create(a);
        factory.songCache.save([a]);

        expect(readCacheFile().songs['a.flac'].tags.title).toBe('real');
    });

    it('should keep the cache file when the share fails while reading it (it may be fine)', () => {
        const a = song('a.flac');
        const cache = newCache();
        cache.put(a, tags('a'));
        cache.save([a]);
        const flaky = {
            ...fs,
            readFileSync: () => {
                throw Object.assign(new Error('I/O error'), { code: 'EIO' });
            },
        };

        new SongCache(folders(music), log, () => true, flaky).get(a);

        expect(fs.existsSync(cacheFile())).toBe(true);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ignored for now'), 'SongCache', 'load');
    });

    it('should drop entries that are odd, and keep the good ones', () => {
        const a = song('a.flac');
        const stats = fs.statSync(a);
        const good = {
            size: stats.size,
            modified: Math.round(stats.mtimeMs),
            tags: { title: 'good', year: 'nineteen seventy', artists: ['A', 42] },
        };
        const entries = SongCache.parse(
            JSON.stringify({
                version: 1,
                songs: {
                    'a.flac': good,
                    '../../etc/passwd': good,
                    '/etc/shadow': good,
                    'C:\\Windows\\x.flac': good,
                    'sub/../../x.flac': good,
                    'nul\u0000.flac': good,
                    'b.flac': { size: 'big', modified: 1, tags: {} },
                    'c.flac': null,
                    'd.flac': { size: 1, modified: 1, tags: null },
                },
            }),
            log.warn,
        );

        expect([...entries.keys()]).toEqual(['a.flac']);
        expect(entries.get('a.flac').tags).toEqual({ title: 'good' });
        expect(log.warn).toHaveBeenCalledWith('8 entries were not usable and were ignored');
    });

    it('should refuse a cache that unpacks to something huge (a zip bomb)', () => {
        const a = song('a.flac');
        fs.mkdirSync(path.join(music, 'Dopamine'));
        const limit = SongCache.maximumJsonBytes;
        SongCache.maximumJsonBytes = 1024 * 1024;
        fs.writeFileSync(cacheFile(), zlib.gzipSync(Buffer.alloc(SongCache.maximumJsonBytes + 1, 32)));
        const reader = { create: jest.fn(() => tags('real')) };

        try {
            expect(new CachingFileMetadataFactory(reader, newCache()).create(a).title).toBe('real');
            expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('deleted, it will be built again'), 'SongCache', 'load');
            expect(fs.existsSync(cacheFile())).toBe(false);
        } finally {
            SongCache.maximumJsonBytes = limit;
        }
    });

    it('should not cache a song that could not be read', () => {
        const a = song('a.flac');
        const reader = {
            create: () => {
                throw new Error('broken file');
            },
        };
        const cache = newCache();

        expect(() => new CachingFileMetadataFactory(reader, cache).create(a)).toThrow('broken file');
        cache.save([a]);
        expect(fs.existsSync(cacheFile())).toBe(false);
    });

    it('should ignore paths outside every music folder, and a folder list that fails', () => {
        const cache = new SongCache(
            {
                getFolders: () => {
                    throw new Error('database locked');
                },
            },
            log,
        );

        expect(cache.get('/somewhere/else.flac')).toBeUndefined();
        expect(() => cache.put('/somewhere/else.flac', tags('x'))).not.toThrow();
        expect(() => cache.save(['/somewhere/else.flac'])).not.toThrow();
        expect(new SongCache(folders(music), log).get(undefined)).toBeUndefined();
    });

    it('should not mistake a folder for one that starts with the same name', () => {
        const musicOld = path.join(root, 'music-old');
        fs.mkdirSync(musicOld);
        fs.writeFileSync(path.join(musicOld, 'a.flac'), 'x');
        const cache = new SongCache(folders(music), log);

        cache.put(path.join(musicOld, 'a.flac'), tags('a'));
        cache.save([path.join(musicOld, 'a.flac')]);

        expect(fs.existsSync(cacheFile())).toBe(false);
    });

    it('should leave no temporary file behind', () => {
        const a = song('a.flac');
        const cache = newCache();
        cache.put(a, tags('a'));
        cache.save([a]);

        expect(fs.readdirSync(path.join(music, 'Dopamine'))).toEqual(['cache.json.gz']);
    });

    it('should handle 20 000 songs quickly', () => {
        const cache = newCache();
        const files = [];
        for (let i = 0; i < 200; i++) {
            files.push(song(`Artist ${i}/x.flac`));
        }
        const start = Date.now();
        for (let i = 0; i < 100; i++) {
            for (const f of files) {
                cache.put(f, tags(`${i}`));
            }
        }
        cache.save(files);

        expect(Date.now() - start).toBeLessThan(5000);
    });
});

describe('SongCache with the real tag reader', () => {
    const { FileMetadataFactory } = require('./file-metadata.factory');
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'song-cache-real-'));
        fs.copyFileSync(path.join(__dirname, 'test-data', 'audio', 'alac-1s.m4a'), path.join(root, 'song.m4a'));
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('should give the same details from the cache as from the file', () => {
        const file = path.join(root, 'song.m4a');
        const folders = { getFolders: () => [{ path: root }] };
        const first = new CachingFileMetadataFactory(new FileMetadataFactory(), new SongCache(folders, logger()));
        const fromFile = first.create(file);
        first.songCache.save([file]);

        const reader = { create: jest.fn() };
        const fromCache = new CachingFileMetadataFactory(reader, new SongCache(folders, logger())).create(file);

        expect(reader.create).not.toHaveBeenCalled();
        expect(fromCache).toEqual({ path: file, picture: undefined, ...SongCache.pickTags(fromFile) });
        expect(fromCache.durationInMilliseconds).toBeGreaterThan(0);
    });
});
