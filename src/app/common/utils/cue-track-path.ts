// Renderer copy of main/background-work/indexing/cue-track-path.js. Keep both in sync.
// A track that is a range of a single-file album (described by a .cue sheet) is identified by a virtual path:
// "<audio file path>|<track number>". The real file is in Track.audioPath.

interface CueTrackLike {
    path: string;
    audioPath?: string | null;
}

export class CueTrackPath {
    private static readonly separator: string = '|';

    public static create(audioPath: string, trackNumber: number): string {
        return `${audioPath}${CueTrackPath.separator}${trackNumber}`;
    }

    public static parse(path: string | undefined | null): { audioPath: string; trackNumber: number } | undefined {
        if (path == undefined) {
            return undefined;
        }

        const index: number = path.lastIndexOf(CueTrackPath.separator);

        if (index <= 0) {
            return undefined;
        }

        const suffix: string = path.substring(index + 1);

        if (!/^\d+$/.test(suffix)) {
            return undefined;
        }

        return { audioPath: path.substring(0, index), trackNumber: parseInt(suffix, 10) };
    }

    public static isCueTrack(track: CueTrackLike | undefined | null): boolean {
        return track != undefined && typeof track.audioPath === 'string' && track.audioPath.length > 0;
    }

    /** The file that holds the audio: the album file for CUE tracks, the track path otherwise. */
    public static getAudioPath(track: CueTrackLike): string {
        return CueTrackPath.isCueTrack(track) ? track.audioPath! : track.path;
    }
}
