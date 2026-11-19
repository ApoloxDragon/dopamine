import { TrackModel } from './track-model';

export class TrackModels {
    private _totalDurationInMilliseconds: number = 0;
    private _totalFileSizeInBytes: number = 0;
    // Files already counted in the total size. All tracks of a CUE album are ranges of one file, and each of them
    // reports that file's size: without this, a 10 track album counted 10 times (177 GB shown for 53 GB of music).
    private readonly _countedFiles: Set<string> = new Set<string>();

    public tracks: TrackModel[] = [];

    public get totalDurationInMilliseconds(): number {
        return this._totalDurationInMilliseconds;
    }

    public get totalFileSizeInBytes(): number {
        return this._totalFileSizeInBytes;
    }

    public get numberOfTracks(): number {
        return this.tracks.length;
    }

    public addTrack(track: TrackModel | undefined): void {
        if (track == undefined) {
            return;
        }

        this.tracks.push(track);
        this._totalDurationInMilliseconds += track.durationInMilliseconds;

        const file: string = track.audioPath ?? '';
        const size: number = Number.isFinite(track.fileSizeInBytes) && track.fileSizeInBytes > 0 ? track.fileSizeInBytes : 0;

        if (file.length === 0) {
            this._totalFileSizeInBytes += size;
        } else if (!this._countedFiles.has(file)) {
            this._countedFiles.add(file);
            this._totalFileSizeInBytes += size;
        }
    }
}
