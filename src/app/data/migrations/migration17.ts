import { Migration } from '../migration';

/**
 * Detailed listening statistics (opt-in). Only adds: existing data is not changed.
 * - ListeningSession.EndReason: how a play ended (see ListeningEndReason); NULL when detailed statistics were off.
 * - ListeningSession.FurthestPositionMs: the furthest position reached in the track; NULL when they were off.
 * - ListeningSegment: the parts of a track that were actually heard during a play (positions in the track, from-to),
 *   one row per continuous stretch (a seek or a pause starts a new one), with the wall clock time it started.
 */
export class Migration17 extends Migration {
    public id: number = 17;
    public name: string = 'Migration17';

    public up(): void {
        this.sql('ALTER TABLE ListeningSession ADD COLUMN EndReason INTEGER;');
        this.sql('ALTER TABLE ListeningSession ADD COLUMN FurthestPositionMs INTEGER;');
        this.sql(
            'CREATE TABLE ListeningSegment (' +
                'ListeningSegmentID INTEGER PRIMARY KEY AUTOINCREMENT, ' +
                'ListeningSessionID INTEGER NOT NULL, ' +
                'StartedAtMs INTEGER, ' +
                'FromMs INTEGER, ' +
                'ToMs INTEGER);',
        );
        this.sql('CREATE INDEX ListeningSegmentSessionIndex ON ListeningSegment(ListeningSessionID);');
    }
}
