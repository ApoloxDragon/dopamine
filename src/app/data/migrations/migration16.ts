import { Migration } from '../migration';

/**
 * Adds the listening history used by the Statistics page. One row per time a track was played.
 * Title, artists and album are a snapshot taken when the track was played, so the history and statistics stay
 * readable after a track is removed from the collection or its tags change. Times are Unix milliseconds.
 * Only a new table is added: existing data is not changed.
 */
export class Migration16 extends Migration {
    public id: number = 16;
    public name: string = 'Migration16';

    public up(): void {
        this.sql(
            'CREATE TABLE ListeningSession (' +
                'ListeningSessionID INTEGER PRIMARY KEY AUTOINCREMENT, ' +
                'TrackPath TEXT, ' +
                'TrackTitle TEXT, ' +
                'Artists TEXT, ' +
                'AlbumTitle TEXT, ' +
                'AlbumArtists TEXT, ' +
                'AlbumKey TEXT, ' +
                'StartedAtMs INTEGER, ' +
                'ListenedMs INTEGER, ' +
                'TrackDurationMs INTEGER, ' +
                'IsCountedAsPlay INTEGER);',
        );
        this.sql('CREATE INDEX ListeningSessionStartedAtMsIndex ON ListeningSession(StartedAtMs);');
        this.sql('CREATE INDEX ListeningSessionTrackPathIndex ON ListeningSession(TrackPath);');
    }
}
