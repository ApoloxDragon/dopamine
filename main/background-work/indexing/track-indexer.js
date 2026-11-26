const { Timer } = require('../common/scheduling/timer');
const { RefreshingMessage } = require('./messages/refreshing-message');
const { DismissMessage } = require('./messages/dismiss-message');

class TrackIndexer {
    constructor(trackAdder, trackUpdater, trackRemover, workerProxy, logger, songCache = undefined, trackRepository = undefined) {
        this.trackAdder = trackAdder;
        this.songCache = songCache;
        this.trackRepository = trackRepository;
        this.trackUpdater = trackUpdater;
        this.trackRemover = trackRemover;
        this.workerProxy = workerProxy;
        this.logger = logger;
    }

    async indexTracksAsync(forceUpdateExistingTracks = false) {
        this.logger.info('+++ STARTED INDEXING TRACKS +++', 'TrackIndexer', 'indexTracksAsync');

        const timer = new Timer();
        timer.start();

        this.workerProxy.postMessage(new RefreshingMessage());

        // Remove tracks
        await this.trackRemover.removeTracksThatDoNoNotBelongToFoldersAsync();
        await this.trackRemover.removeTracksThatAreNotFoundOnDiskAsync();
        await this.trackRemover.removeFolderTracksForInexistingTracksAsync();

        // Update tracks
        await this.trackUpdater.updateTracksThatAreOutOfDateAsync(forceUpdateExistingTracks);

        // Add tracks
        await this.trackAdder.addTracksThatAreNotInTheDatabaseAsync();

        this.#saveSongCache();

        timer.stop();

        this.logger.info(
            `+++ FINISHED INDEXING TRACKS (Time required: ${timer.getElapsedMilliseconds()} ms) +++`,
            'TrackIndexer',
            'indexTracksAsync',
        );

        this.workerProxy.postMessage(new DismissMessage());
    }

    /** Writes the song cache in each music folder, keeping only songs still in the collection. Never throws. */
    #saveSongCache() {
        if (this.songCache === undefined || this.trackRepository === undefined) {
            return;
        }

        try {
            const audioPaths = (this.trackRepository.getAllTracks() ?? []).map((x) => x.audioPath || x.path);
            this.songCache.save(audioPaths);
        } catch (e) {
            this.logger.warn(`Could not save the song cache: ${e?.message ?? e}`, 'TrackIndexer', 'saveSongCache');
        }
    }
}

exports.TrackIndexer = TrackIndexer;
