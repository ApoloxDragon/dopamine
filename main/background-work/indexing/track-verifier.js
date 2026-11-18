const { CueTrackPath } = require('./cue-track-path');

class TrackVerifier {
    constructor(fileAccess) {
        this.fileAccess = fileAccess;
    }

    isTrackOutOfDate(track) {
        if (track.fileSize === 0) {
            return true;
        }

        // For CUE tracks, check the album file (not the virtual path) and the sheet.
        const audioPath = CueTrackPath.getAudioPath(track);

        if (track.fileSize !== this.fileAccess.getFileSizeInBytes(audioPath)) {
            return true;
        }

        if (CueTrackPath.isCueTrack(track)) {
            const dateModified = Math.max(
                this.fileAccess.getDateModifiedInTicks(audioPath),
                this.fileAccess.getDateModifiedInTicks(track.cuePath),
            );

            return track.dateFileModified !== dateModified;
        }

        return track.dateFileModified !== this.fileAccess.getDateModifiedInTicks(audioPath);
    }

    doesTrackNeedIndexing(track) {
        if (track.needsIndexing === undefined || track.needsIndexing === null) {
            return true;
        }

        if (Number.isNaN(track.needsIndexing)) {
            return true;
        }

        return track.needsIndexing === 1;
    }
}

exports.TrackVerifier = TrackVerifier;
