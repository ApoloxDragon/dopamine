const { DismissMessage } = require('./messages/dismiss-message');

class Indexer {
    constructor(collectionChecker, trackIndexer, trackUpdater, trackRepository, workerProxy, logger) {
        this.collectionChecker = collectionChecker;
        this.trackIndexer = trackIndexer;
        this.trackUpdater = trackUpdater;
        this.trackRepository = trackRepository;
        this.workerProxy = workerProxy;
        this.logger = logger;
    }

    async indexCollectionIfOutdatedAsync() {
        this.logger.info('Indexing collection.', 'Indexer', 'indexCollectionIfOutdatedAsync');

        const collectionIsOutdated = await this.collectionChecker.isCollectionOutdatedAsync();

        if (collectionIsOutdated) {
            this.logger.info('Collection is outdated.', 'Indexer', 'indexCollectionIfOutdatedAsync');
            await this.trackIndexer.indexTracksAsync(false);
        } else {
            this.logger.info('Collection is not outdated.', 'Indexer', 'indexCollectionIfOutdatedAsync');
        }

        this.workerProxy.postMessage(new DismissMessage());
    }

    /**
     * Fast refresh: removes songs that are gone, re-reads songs whose file changed and adds new ones. Unchanged songs are not
     * read again. Unlike indexCollectionIfOutdatedAsync it does not first guess whether anything changed.
     */
    async indexCollectionFastAsync() {
        this.logger.info('Indexing collection (fast).', 'Indexer', 'indexCollectionFastAsync');

        await this.trackIndexer.indexTracksAsync(false);

        this.workerProxy.postMessage(new DismissMessage());
    }

    /** Full refresh: like the fast refresh, but every song is read again, also the ones that did not change. */
    async indexCollectionAlwaysAsync() {
        this.logger.info('Indexing collection.', 'Indexer', 'indexCollectionAlwaysAsync');

        await this.trackIndexer.indexTracksAsync(true);

        this.workerProxy.postMessage(new DismissMessage());
    }

    reindexReplayGainForExistingTracks() {
        this.logger.info('Reindexing ReplayGain for existing tracks.', 'Indexer', 'reindexReplayGainForExistingTracks');

        this.trackUpdater.reindexReplayGainForExistingTracks();

        this.workerProxy.postMessage(new DismissMessage());
    }
}

exports.Indexer = Indexer;
