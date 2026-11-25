const { Timer } = require('../common/scheduling/timer');
const { RemovingTracksMessage } = require('./messages/removing-tracks-message');
const { CueTrackPath } = require('./cue-track-path');

class TrackRemover {
    constructor(
        folderTrackRepository,
        trackRepository,
        fileAccess,
        workerProxy,
        logger,
        cueSheetReader = undefined,
        folderReachability = undefined,
    ) {
        this.cueSheetReader = cueSheetReader;
        this.folderReachability = folderReachability;
        this.folderTrackRepository = folderTrackRepository;
        this.trackRepository = trackRepository;
        this.fileAccess = fileAccess;
        this.workerProxy = workerProxy;
        this.logger = logger;
    }

    async removeTracksThatDoNoNotBelongToFoldersAsync() {
        const timer = new Timer();
        timer.start();

        try {
            const numberOfTracksToRemove = this.trackRepository.getNumberOfTracksThatDoNotBelongFolders();

            if (numberOfTracksToRemove === 0) {
                timer.stop();

                this.logger.info(
                    `There are no tracks to remove. Time required: ${timer.getElapsedMilliseconds()} ms`,
                    'TrackRemover',
                    'removeTracksThatDoNoNotBelongToFoldersAsync',
                );

                return;
            }

            this.logger.info(
                `Found ${numberOfTracksToRemove} tracks to remove.`,
                'TrackRemover',
                'removeTracksThatDoNoNotBelongToFoldersAsync',
            );

            this.workerProxy.postMessage(new RemovingTracksMessage());

            const numberOfRemovedTracks = this.trackRepository.deleteTracksThatDoNotBelongFolders();

            timer.stop();

            this.logger.info(
                `Removed ${numberOfRemovedTracks} tracks. Time required: ${timer.getElapsedMilliseconds()} ms`,
                'TrackRemover',
                'removeTracksThatDoNoNotBelongToFoldersAsync',
            );
        } catch (e) {
            timer.stop();

            this.logger.error(e, 'Could not remove tracks', 'TrackRemover', 'removeTracksThatDoNoNotBelongToFoldersAsync');
        }
    }

    async removeTracksThatAreNotFoundOnDiskAsync() {
        const timer = new Timer();
        timer.start();

        try {
            const tracks = this.trackRepository.getAllTracks() ?? [];

            this.logger.info(`Found ${tracks.length} tracks.`, 'TrackRemover', 'removeTracksThatAreNotFoundOnDiskAsync');

            let numberOfRemovedTracks = 0;

            // Album files that are now indexed through a .cue sheet. Their old whole-file track is removed from the
            // database (not from disk) so the album does not show twice. Only database rows are affected.
            const audioPathsCoveredByCueTracks = new Set(tracks.filter((x) => CueTrackPath.isCueTrack(x)).map((x) => x.audioPath));

            // Songs in a folder that cannot be reached (network share offline, drive unplugged) are kept as they are.
            const isUnreachable = this.folderReachability?.check(tracks) ?? (() => false);
            let numberOfKeptTracks = 0;

            for (const track of tracks) {
                if (isUnreachable(track)) {
                    numberOfKeptTracks++;
                    continue;
                }

                if (!this.#trackExists(track, audioPathsCoveredByCueTracks)) {
                    this.trackRepository.deleteTrack(track.trackId);
                    numberOfRemovedTracks++;
                }

                // Only send message once
                if (numberOfRemovedTracks === 1) {
                    this.workerProxy.postMessage(new RemovingTracksMessage());
                }
            }

            timer.stop();

            this.logger.info(
                `Removed ${numberOfRemovedTracks} tracks, kept ${numberOfKeptTracks} in folders that cannot be reached. Time required: ${timer.getElapsedMilliseconds()} ms`,
                'TrackRemover',
                'removeTracksThatAreNotFoundOnDiskAsync',
            );
        } catch (e) {
            timer.stop();

            this.logger.error(e, 'Could not remove tracks', 'TrackRemover', 'removeTracksThatAreNotFoundOnDiskAsync');
        }
    }

    #trackExists(track, audioPathsCoveredByCueTracks) {
        if (!CueTrackPath.isCueTrack(track)) {
            return this.fileAccess.pathExists(track.path) && !audioPathsCoveredByCueTracks.has(track.path);
        }

        if (!this.fileAccess.pathExists(track.audioPath) || !this.fileAccess.pathExists(track.cuePath)) {
            return false;
        }

        if (this.cueSheetReader === undefined) {
            return true;
        }

        // The track must still be in the sheet (a sheet can be edited to have fewer tracks).
        const parsedPath = CueTrackPath.parse(track.path);
        return (
            parsedPath !== undefined && this.cueSheetReader.getTrack(track.cuePath, track.audioPath, parsedPath.trackNumber) !== undefined
        );
    }

    async removeFolderTracksForInexistingTracksAsync() {
        const timer = new Timer();
        timer.start();

        try {
            const numberOfFolderTracksToRemove = this.folderTrackRepository.getNumberOfFolderTracksForInexistingTracks();

            if (numberOfFolderTracksToRemove === 0) {
                timer.stop();

                this.logger.info(
                    `There are no folder tracks to remove. Time required: ${timer.getElapsedMilliseconds()} ms`,
                    'TrackRemover',
                    'removeFolderTracksForInexistingTracksAsync',
                );

                return;
            }

            this.logger.info(
                `Found ${numberOfFolderTracksToRemove} folder tracks to remove.`,
                'TrackRemover',
                'removeFolderTracksForInexistingTracksAsync',
            );

            this.workerProxy.postMessage(new RemovingTracksMessage());

            const numberOfRemovedFolderTracks = this.folderTrackRepository.deleteFolderTracksForInexistingTracks();

            timer.stop();

            this.logger.info(
                `Removed ${numberOfRemovedFolderTracks} folder tracks. Time required: ${timer.getElapsedMilliseconds()} ms`,
                'TrackRemover',
                'removeFolderTracksForInexistingTracksAsync',
            );
        } catch (e) {
            timer.stop();

            this.logger.error(e, `Could not remove folder tracks`, 'TrackRemover', 'removeFolderTracksForInexistingTracks');
        }
    }
}

exports.TrackRemover = TrackRemover;
