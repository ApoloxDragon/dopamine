import { Migration } from '../migration';

/**
 * Adds support for tracks that are a range of a single-file album described by a .cue sheet.
 * For such a track, Path is a unique virtual path ("<audio file>|<track number>"), AudioPath is the real audio file,
 * CuePath is the .cue sheet and CueStartMs/CueEndMs delimit the track inside the audio file.
 * For normal tracks these columns stay NULL. Only columns are added, so existing data is not changed.
 */
export class Migration15 extends Migration {
    public id: number = 15;
    public name: string = 'Migration15';

    public up(): void {
        this.sql('ALTER TABLE Track ADD COLUMN AudioPath TEXT;');
        this.sql('ALTER TABLE Track ADD COLUMN CuePath TEXT;');
        this.sql('ALTER TABLE Track ADD COLUMN CueStartMs INTEGER;');
        this.sql('ALTER TABLE Track ADD COLUMN CueEndMs INTEGER;');
        this.sql('CREATE INDEX TrackAudioPathIndex ON Track(AudioPath);');
    }
}
