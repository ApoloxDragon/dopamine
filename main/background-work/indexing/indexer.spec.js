const { Indexer } = require('./indexer');

describe('Indexer', () => {
    function create(isOutdated) {
        const trackIndexer = { indexTracksAsync: jest.fn(() => Promise.resolve()) };
        const workerProxy = { postMessage: jest.fn() };
        const collectionChecker = { isCollectionOutdatedAsync: jest.fn(() => Promise.resolve(isOutdated)) };
        const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const indexer = new Indexer(collectionChecker, trackIndexer, undefined, undefined, workerProxy, logger);
        return { indexer, trackIndexer, collectionChecker, workerProxy };
    }

    it('fast refresh: indexes without re-reading unchanged songs, and without guessing first', async () => {
        const { indexer, trackIndexer, collectionChecker, workerProxy } = create(false);

        await indexer.indexCollectionFastAsync();

        expect(trackIndexer.indexTracksAsync).toHaveBeenCalledWith(false);
        expect(collectionChecker.isCollectionOutdatedAsync).not.toHaveBeenCalled();
        expect(workerProxy.postMessage).toHaveBeenCalledTimes(1);
    });

    it('full refresh: re-reads every song', async () => {
        const { indexer, trackIndexer } = create(false);

        await indexer.indexCollectionAlwaysAsync();

        expect(trackIndexer.indexTracksAsync).toHaveBeenCalledWith(true);
    });

    it('startup refresh: does nothing when the collection looks up to date', async () => {
        const { indexer, trackIndexer } = create(false);

        await indexer.indexCollectionIfOutdatedAsync();

        expect(trackIndexer.indexTracksAsync).not.toHaveBeenCalled();
    });
});
