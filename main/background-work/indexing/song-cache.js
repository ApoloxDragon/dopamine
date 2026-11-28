const path = require('path');
const zlib = require('zlib');

/**
 * A cache of every song's tags, kept in each music folder as `Dopamine/cache.json.gz`, so that a full refresh (or a new
 * computer, or a new library) reads one file per music folder instead of opening every song again. Worth it most for a
 * network share, where opening thousands of files is slow.
 *
 * A cached entry is only used when the song's size and modification time are still the same; otherwise the song is read
 * as usual and the entry is replaced. The music files themselves are never changed. The cache file is written once per
 * refresh, only when something changed, and only into folders that can be reached. It is checked before use: anything
 * odd (not gzip, not JSON, too big, wrong kinds of values, paths leaving the folder) is ignored and logged.
 */
class SongCache {
    static folderName = 'Dopamine';
    static fileName = 'cache.json.gz';
    static version = 1;
    static maximumFileBytes = 64 * 1024 * 1024;
    static maximumJsonBytes = 512 * 1024 * 1024;
    static maximumTextLength = 100000;

    /** The tag fields kept, and their kinds. The cover picture is not kept (it is read separately). */
    static fields = {
        bitRate: 'number',
        sampleRate: 'number',
        durationInMilliseconds: 'number',
        title: 'text',
        album: 'text',
        albumArtists: 'texts',
        artists: 'texts',
        genres: 'texts',
        comment: 'text',
        grouping: 'text',
        year: 'number',
        trackNumber: 'number',
        trackCount: 'number',
        discNumber: 'number',
        discCount: 'number',
        lyrics: 'text',
        rating: 'number',
        composers: 'texts',
        conductor: 'text',
        beatsPerMinute: 'number',
        replayGainTrackGain: 'number',
        replayGainTrackPeak: 'number',
        replayGainAlbumGain: 'number',
        replayGainAlbumPeak: 'number',
    };

    constructor(folderRepository, logger, isEnabled = () => true, fileSystem = require('fs')) {
        this.folderRepository = folderRepository;
        this.logger = logger;
        this.isEnabled = isEnabled;
        this.fileSystem = fileSystem;
        this.folders = undefined;
        this.used = 0;
        this.read = 0;
    }

    /** Cached tags for the song, when they are still right for the file as it is now. */
    get(filePath) {
        const folder = this.#folderFor(filePath);

        if (folder === undefined) {
            return undefined;
        }

        const entry = folder.entries.get(this.#relative(folder, filePath));
        const stamp = this.#stamp(filePath);

        if (entry === undefined || stamp === undefined || entry.size !== stamp.size || entry.modified !== stamp.modified) {
            return undefined;
        }

        this.used++;
        return { path: filePath, picture: undefined, ...entry.tags };
    }

    /** Remembers the tags just read from a song. */
    put(filePath, metadata) {
        const folder = this.#folderFor(filePath);
        const stamp = folder === undefined ? undefined : this.#stamp(filePath);

        if (folder === undefined || stamp === undefined || metadata === undefined || metadata === null) {
            return;
        }

        this.read++;
        folder.entries.set(this.#relative(folder, filePath), { ...stamp, tags: SongCache.pickTags(metadata) });
        folder.changed = true;
    }

    /**
     * Writes the cache of every folder that changed, keeping only songs that are still in the collection (`audioPaths`:
     * the real audio file of every song). Folders that cannot be reached are left alone. Never throws.
     */
    save(audioPaths) {
        if (this.folders === undefined) {
            return;
        }

        const keep = new Set(audioPaths ?? []);

        for (const folder of this.folders) {
            if (!folder.loaded) {
                continue;
            }

            for (const relative of [...folder.entries.keys()]) {
                if (!keep.has(path.join(folder.path, relative))) {
                    folder.entries.delete(relative);
                    folder.changed = true;
                }
            }

            this.logger.debug?.(
                `'${folder.path}': ${folder.entries.size} songs in the cache, ${folder.changed ? 'changed: saving' : 'unchanged: not saved'}`,
                'SongCache',
                'save',
            );

            if (folder.changed) {
                this.#write(folder);
            }
        }

        this.logger.info(`Used cached tags for ${this.used} songs, read ${this.read} songs from their files`, 'SongCache', 'save');
    }

    /** The known tag fields of a metadata object, with the right kinds only. */
    static pickTags(metadata) {
        const tags = {};

        for (const [field, kind] of Object.entries(SongCache.fields)) {
            const value = metadata[field];

            if (SongCache.#isKind(value, kind)) {
                tags[field] = kind === 'texts' ? [...value] : value;
            }
        }

        return tags;
    }

    /** Checks the text of a cache file. Returns its entries (relative path -> entry), or undefined when it can't be used. */
    static parse(json, warn = () => {}) {
        let data;

        try {
            data = JSON.parse(json);
        } catch (e) {
            warn('not valid JSON, ignored');
            return undefined;
        }

        if (
            data === null ||
            typeof data !== 'object' ||
            data.version !== SongCache.version ||
            typeof data.songs !== 'object' ||
            data.songs === null
        ) {
            warn('not a song cache of a version this Dopamine knows, ignored');
            return undefined;
        }

        const entries = new Map();
        let skipped = 0;

        for (const [relative, entry] of Object.entries(data.songs)) {
            if (
                !SongCache.#isSafeRelativePath(relative) ||
                entry === null ||
                typeof entry !== 'object' ||
                !Number.isFinite(entry.size) ||
                !Number.isFinite(entry.modified) ||
                entry.tags === null ||
                typeof entry.tags !== 'object'
            ) {
                skipped++;
                continue;
            }

            entries.set(relative, { size: entry.size, modified: entry.modified, tags: SongCache.pickTags(entry.tags) });
        }

        if (skipped > 0) {
            warn(`${skipped} entries were not usable and were ignored`);
        }

        return entries;
    }

    static #isKind(value, kind) {
        switch (kind) {
            case 'number':
                return typeof value === 'number' && Number.isFinite(value);
            case 'text':
                return typeof value === 'string' && value.length <= SongCache.maximumTextLength;
            case 'texts':
                return (
                    Array.isArray(value) &&
                    value.length <= 1000 &&
                    value.every((x) => typeof x === 'string' && x.length <= SongCache.maximumTextLength)
                );
            default:
                return false;
        }
    }

    static #isSafeRelativePath(relative) {
        if (typeof relative !== 'string' || relative.length === 0 || relative.length > 4096 || relative.includes('\0')) {
            return false;
        }

        if (path.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) {
            return false;
        }

        return !relative.split(/[\\/]/).some((part) => part === '..');
    }

    #folderFor(filePath) {
        if (!this.isEnabled() || typeof filePath !== 'string') {
            return undefined;
        }

        if (this.folders === undefined) {
            this.folders = this.#loadFolderList();
        }

        // The deepest music folder that holds the file (folders can be inside each other).
        let best = undefined;

        for (const folder of this.folders) {
            if (filePath.startsWith(folder.prefix) && (best === undefined || folder.prefix.length > best.prefix.length)) {
                best = folder;
            }
        }

        if (best !== undefined && !best.loaded) {
            this.#load(best);
        }

        return best;
    }

    #loadFolderList() {
        try {
            return this.folderRepository
                .getFolders()
                .map((x) => x.path)
                .filter((x) => typeof x === 'string' && x.length > 0)
                .map((x) => ({
                    path: x,
                    prefix: x.endsWith(path.sep) ? x : x + path.sep,
                    entries: new Map(),
                    loaded: false,
                    changed: false,
                }));
        } catch (e) {
            this.logger.warn(`Could not get the music folders: ${e?.message ?? e}`, 'SongCache', 'loadFolderList');
            return [];
        }
    }

    #cacheFile(folder) {
        return path.join(folder.path, SongCache.folderName, SongCache.fileName);
    }

    #load(folder) {
        folder.loaded = true;
        const file = this.#cacheFile(folder);
        const warn = (message) => this.logger.warn(`'${file}': ${message}`, 'SongCache', 'load');
        let data;

        try {
            // Only a real file in a real Dopamine folder: links are never followed (nor deleted).
            if (!this.#isRealCacheFolder(folder) || this.#kindOf(file) !== 'file') {
                if (this.#kindOf(file) === 'other') {
                    warn('is a link or not a file, ignored');
                }
                return;
            }

            const stats = this.fileSystem.lstatSync(file);

            if (stats.size > SongCache.maximumFileBytes) {
                this.#discard(folder, `too big (${stats.size} bytes)`);
                return;
            }

            data = this.fileSystem.readFileSync(file);
        } catch (e) {
            // No cache yet (the usual first time), or the share failed while reading: the file may be fine, so it stays.
            if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') {
                warn(`could not be read (${e?.message ?? e}), ignored for now`);
            }
            return;
        }

        let entries;

        try {
            const json = zlib.gunzipSync(data, { maxOutputLength: SongCache.maximumJsonBytes }).toString('utf8');
            entries = SongCache.parse(json, warn);
        } catch (e) {
            entries = undefined;
        }

        if (entries === undefined) {
            // The contents are broken: start over. The next refresh that reads songs (a full refresh reads all) writes a new one.
            this.#discard(folder, 'broken or of an unknown kind');
            return;
        }

        folder.entries = entries;
        this.logger.info(`Loaded ${folder.entries.size} cached songs from '${file}'`, 'SongCache', 'load');
    }

    /** Deletes a cache file that cannot be used. Never throws. */
    #discard(folder, reason) {
        const file = this.#cacheFile(folder);

        if (this.#safeUnlink(folder, SongCache.fileName)) {
            this.logger.warn(`'${file}' was ${reason}: deleted, it will be built again`, 'SongCache', 'load');
        } else {
            this.logger.warn(`'${file}' was ${reason}: ignored (not deleted)`, 'SongCache', 'load');
        }
    }

    #write(folder) {
        const file = this.#cacheFile(folder);
        // A random name, so a file or link someone placed in advance cannot be in the way (and 'wx' below refuses it anyway).
        const temporaryName = `${SongCache.fileName}.${require('crypto').randomInt(1, 1000000000)}.tmp`;
        const temporary = path.join(path.dirname(file), temporaryName);

        try {
            // Only into folders that are there right now (an offline share is left alone).
            if (!this.fileSystem.statSync(folder.path).isDirectory()) {
                return;
            }

            const songs = Object.fromEntries([...folder.entries.entries()].sort(([a], [b]) => a.localeCompare(b)));
            const data = zlib.gzipSync(JSON.stringify({ version: SongCache.version, writtenAtMs: Date.now(), songs }));

            this.fileSystem.mkdirSync(path.dirname(file), { recursive: true });

            // Never write through a link: the Dopamine folder must be a real folder, and the cache a real file (or absent).
            if (!this.#isRealCacheFolder(folder) || this.#kindOf(file) === 'other') {
                this.logger.warn(`'${file}' or its folder is a link or not a file: the song cache was not saved`, 'SongCache', 'write');
                return;
            }

            this.#safeUnlink(folder, temporaryName);
            // 'wx': fails when anything (also a link someone placed) has the temporary name, instead of writing through it.
            this.fileSystem.writeFileSync(temporary, data, { flag: 'wx', mode: 0o644 });
            this.fileSystem.renameSync(temporary, file);
            folder.changed = false;
            this.logger.info(`Saved ${folder.entries.size} songs to '${file}'`, 'SongCache', 'write');
        } catch (e) {
            this.logger.warn(`Could not save the song cache '${file}': ${e?.message ?? e}`, 'SongCache', 'write');
            this.#safeUnlink(folder, temporaryName);
        }
    }

    /**
     * The only way this class deletes anything: one regular file, directly in <music folder>/Dopamine, named
     * cache.json.gz or cache.json.gz.<number>.tmp. Never a folder, never a link (nor what it points to), never recursive,
     * never a path taken from the cache's contents. Returns whether it deleted the file. Never throws.
     */
    #safeUnlink(folder, name) {
        try {
            if (!SongCache.isCacheFileName(name) || !this.#isRealCacheFolder(folder)) {
                return false;
            }

            const cacheFolder = path.join(folder.path, SongCache.folderName);
            const target = path.join(cacheFolder, name);

            if (path.dirname(target) !== cacheFolder || this.#kindOf(target) !== 'file') {
                return false;
            }

            this.fileSystem.unlinkSync(target);
            return true;
        } catch (e) {
            return false;
        }
    }

    /** cache.json.gz, or its temporary file cache.json.gz.<random number>.tmp. Nothing else. */
    static isCacheFileName(name) {
        return typeof name === 'string' && (name === SongCache.fileName || /^cache\.json\.gz\.\d{1,10}\.tmp$/.test(name));
    }

    /** <music folder>/Dopamine is a real folder (not a link to somewhere else). */
    #isRealCacheFolder(folder) {
        try {
            const stats = this.fileSystem.lstatSync(path.join(folder.path, SongCache.folderName));
            return stats.isDirectory() && !stats.isSymbolicLink();
        } catch (e) {
            return false;
        }
    }

    /** 'none' when there is nothing, 'file' for a regular file, 'other' for a link, a folder or anything else. */
    #kindOf(target) {
        try {
            const stats = this.fileSystem.lstatSync(target);
            return stats.isFile() && !stats.isSymbolicLink() ? 'file' : 'other';
        } catch (e) {
            return e?.code === 'ENOENT' ? 'none' : 'other';
        }
    }

    #relative(folder, filePath) {
        return filePath.slice(folder.prefix.length);
    }

    #stamp(filePath) {
        try {
            const stats = this.fileSystem.statSync(filePath);
            return { size: stats.size, modified: Math.round(stats.mtimeMs) };
        } catch (e) {
            return undefined;
        }
    }
}

/** Gives cached tags when they are still right, and reads (and remembers) the song otherwise. */
class CachingFileMetadataFactory {
    constructor(fileMetadataFactory, songCache) {
        this.fileMetadataFactory = fileMetadataFactory;
        this.songCache = songCache;
    }

    create(filePath) {
        const cached = this.songCache.get(filePath);

        if (cached !== undefined) {
            return cached;
        }

        const metadata = this.fileMetadataFactory.create(filePath);
        this.songCache.put(filePath, metadata);

        return metadata;
    }
}

exports.SongCache = SongCache;
exports.CachingFileMetadataFactory = CachingFileMetadataFactory;
