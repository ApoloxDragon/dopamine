const fs = require('fs');
const { FoldersUnreachableMessage } = require('./messages/folders-unreachable-message');

/**
 * Tells which collection folders cannot be reached right now: a network share that is offline (server asleep, laptop away
 * from home, Wi-Fi down), an unplugged USB drive, or a share that is not mounted. Songs in such a folder must not be removed
 * from the collection (that would lose their play counts, ratings and likes), and must not be read one by one either (on a
 * network path each attempt can take many seconds before it fails).
 *
 * A folder counts as unreachable when it cannot be listed, or when it is empty while the collection has songs in it: an
 * unmounted share on Linux usually leaves an empty mount point behind. To really empty a folder, remove it from the collection.
 *
 * Each folder is checked once per check() call, not once per song.
 */
class FolderReachability {
    constructor(folderRepository, logger, fileSystem = fs, workerProxy = undefined) {
        this.workerProxy = workerProxy;
        this.folderRepository = folderRepository;
        this.logger = logger;
        this.fileSystem = fileSystem;
    }

    /**
     * Returns a function track => true when the track is inside a folder that cannot be reached. Never throws: if the
     * folders cannot be read from the database, nothing is treated as unreachable (the previous behaviour).
     */
    check(tracks) {
        let folders;

        try {
            folders = (this.folderRepository?.getFolders() ?? []).filter((x) => typeof x?.path === 'string' && x.path.length > 0);
        } catch (e) {
            this.logger.error(e, 'Could not get the collection folders', 'FolderReachability', 'check');
            return () => false;
        }

        const unreachable = [];
        const unreachablePaths = [];
        let numberOfKeptTracks = 0;

        for (const folder of folders) {
            const prefix = FolderReachability.#prefix(folder.path);
            const songs = tracks.filter((track) => FolderReachability.#isInside(track, prefix));
            const reason = this.#unreachableReason(folder.path, songs.length);

            if (reason !== undefined) {
                unreachable.push(prefix);
                unreachablePaths.push(folder.path);
                numberOfKeptTracks += songs.length;
                this.logger.warn(
                    `Folder '${folder.path}' cannot be reached (${reason}). Its ${songs.length} songs are kept and not checked until it is back.`,
                    'FolderReachability',
                    'check',
                );
            }
        }

        if (unreachable.length === 0) {
            return () => false;
        }

        // The window shows a notice once the refresh is done.
        this.workerProxy?.postMessage(new FoldersUnreachableMessage(unreachablePaths, numberOfKeptTracks));

        return (track) => unreachable.some((prefix) => FolderReachability.#isInside(track, prefix));
    }

    #unreachableReason(folderPath, numberOfSongs) {
        let entries;

        try {
            entries = this.fileSystem.readdirSync(folderPath);
        } catch (e) {
            return e?.code ?? 'cannot be listed';
        }

        if (entries.length === 0 && numberOfSongs > 0) {
            return 'empty, probably not mounted';
        }

        return undefined;
    }

    /** Folder path in a comparable form, ending with a separator ("/music" must not match "/music2"). */
    static #prefix(folderPath) {
        const normalized = FolderReachability.normalize(folderPath);
        return normalized.endsWith('/') ? normalized : normalized + '/';
    }

    static #isInside(track, prefix) {
        // CUE tracks have a virtual path ("album.flac|3"); their files are audioPath and cuePath.
        const paths = [track?.path, track?.audioPath, track?.cuePath].filter((x) => typeof x === 'string' && x.length > 0);
        return paths.some((x) => FolderReachability.normalize(x).startsWith(prefix));
    }

    /**
     * Forward slashes and lower case, so Windows paths compare the same whatever their case or separator. Lower case also
     * on Linux: in the worst case a song is kept a little longer, never removed by mistake.
     */
    static normalize(somePath) {
        return String(somePath).replace(/\\/g, '/').toLowerCase();
    }
}

exports.FolderReachability = FolderReachability;
