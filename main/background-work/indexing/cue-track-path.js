// A track that is a range of a single-file album (described by a .cue sheet) is identified by a virtual path:
// "<audio file path>|<track number>", e.g. "/music/Oracles.flac|3". "|" is not allowed in Windows file names and is
// very rare elsewhere, so a real file path is never mistaken for a virtual one (the suffix must also be a number).
const SEPARATOR = '|';

class CueTrackPath {
    static create(audioPath, trackNumber) {
        return `${audioPath}${SEPARATOR}${trackNumber}`;
    }

    /** Returns { audioPath, trackNumber } for a virtual path, or undefined for a normal path. */
    static parse(path) {
        if (path === undefined || path === null) {
            return undefined;
        }

        const index = path.lastIndexOf(SEPARATOR);

        if (index <= 0) {
            return undefined;
        }

        const suffix = path.substring(index + 1);

        if (!/^\d+$/.test(suffix)) {
            return undefined;
        }

        return { audioPath: path.substring(0, index), trackNumber: parseInt(suffix, 10) };
    }

    /** True when the track (entity or model) is a CUE track. Rows created before Migration15 have null/empty audioPath. */
    static isCueTrack(track) {
        return track !== undefined && track !== null && typeof track.audioPath === 'string' && track.audioPath.length > 0;
    }

    /** The file that holds the audio of the track: the album file for CUE tracks, the track path otherwise. */
    static getAudioPath(track) {
        return CueTrackPath.isCueTrack(track) ? track.audioPath : track.path;
    }
}

exports.CueTrackPath = CueTrackPath;
