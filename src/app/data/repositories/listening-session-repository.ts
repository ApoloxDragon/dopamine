/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@angular/core';
import { DatabaseFactory } from '../database-factory';
import { ListeningSession } from '../entities/listening-session';
import { DataDelimiter } from '../data-delimiter';
import { ListeningSegment } from '../entities/listening-segment';
import { ListeningEndReason } from '../entities/listening-end-reason';
import {
    ListeningDetails,
    ListeningEndSummary,
    ListeningSessionRepositoryBase,
    ListeningSkipTotal,
    ListeningSummary,
    ListeningTimeEntry,
    ListeningTotal,
} from './listening-session-repository.base';

@Injectable()
export class ListeningSessionRepository implements ListeningSessionRepositoryBase {
    public constructor(private databaseFactory: DatabaseFactory) {}

    public addSession(session: ListeningSession): number {
        const database: any = this.databaseFactory.create();
        const info: any = database
            .prepare(
                `INSERT INTO ListeningSession (TrackPath, TrackTitle, Artists, AlbumTitle, AlbumArtists, AlbumKey,
                                               StartedAtMs, ListenedMs, TrackDurationMs, IsCountedAsPlay)
                 VALUES (@trackPath, @trackTitle, @artists, @albumTitle, @albumArtists, @albumKey,
                         @startedAtMs, @listenedMs, @trackDurationMs, @isCountedAsPlay);`,
            )
            .run({
                trackPath: session.trackPath,
                trackTitle: session.trackTitle,
                artists: session.artists,
                albumTitle: session.albumTitle,
                albumArtists: session.albumArtists,
                albumKey: session.albumKey,
                startedAtMs: session.startedAtMs,
                listenedMs: session.listenedMs,
                trackDurationMs: session.trackDurationMs,
                isCountedAsPlay: session.isCountedAsPlay,
            });

        return Number(info.lastInsertRowid);
    }

    public updateListened(listeningSessionId: number, listenedMs: number, isCountedAsPlay: boolean, details?: ListeningDetails): void {
        const database: any = this.databaseFactory.create();

        if (details == undefined) {
            database
                .prepare('UPDATE ListeningSession SET ListenedMs=?, IsCountedAsPlay=? WHERE ListeningSessionID=?;')
                .run(Math.round(listenedMs), isCountedAsPlay ? 1 : 0, listeningSessionId);
            return;
        }

        database
            .prepare('UPDATE ListeningSession SET ListenedMs=?, IsCountedAsPlay=?, EndReason=?, FurthestPositionMs=? WHERE ListeningSessionID=?;')
            .run(Math.round(listenedMs), isCountedAsPlay ? 1 : 0, details.endReason, Math.round(details.furthestPositionMs), listeningSessionId);
    }

    public addSegments(listeningSessionId: number, segments: ListeningSegment[]): void {
        // Parts with invalid numbers (NaN, infinity, not a number, end before start) are not stored.
        const valid: ListeningSegment[] = segments.filter(
            (x) => [x.startedAtMs, x.fromMs, x.toMs].every((n) => typeof n === 'number' && Number.isFinite(n)) && x.toMs > x.fromMs,
        );

        if (valid.length === 0) {
            return;
        }

        const database: any = this.databaseFactory.create();
        const insert: any = database.prepare('INSERT INTO ListeningSegment (ListeningSessionID, StartedAtMs, FromMs, ToMs) VALUES (?, ?, ?, ?);');
        // One transaction: all parts are written, or none (they are then written again later).
        database.transaction(() => {
            for (const segment of valid) {
                insert.run(listeningSessionId, Math.round(segment.startedAtMs), Math.round(segment.fromMs), Math.round(segment.toMs));
            }
        })();
    }

    public getSegments(listeningSessionIds: number[]): Map<number, ListeningSegment[]> {
        const result: Map<number, ListeningSegment[]> = new Map<number, ListeningSegment[]>();
        const ids: number[] = listeningSessionIds.filter((id) => Number.isInteger(id));

        if (ids.length === 0) {
            return result;
        }

        const database: any = this.databaseFactory.create();
        const rows: any[] = database
            .prepare(
                `SELECT ListeningSegmentID AS listeningSegmentId, ListeningSessionID AS listeningSessionId, StartedAtMs AS startedAtMs,
                        FromMs AS fromMs, ToMs AS toMs
                 FROM ListeningSegment WHERE ListeningSessionID IN (${ids.map(() => '?').join(',')}) ORDER BY StartedAtMs, ListeningSegmentID;`,
            )
            .all(...ids);

        for (const row of rows) {
            const list: ListeningSegment[] = result.get(row.listeningSessionId) ?? [];
            list.push(row);
            result.set(row.listeningSessionId, list);
        }

        return result;
    }

    public deleteSession(listeningSessionId: number): void {
        const database: any = this.databaseFactory.create();
        database.transaction(() => {
            database.prepare('DELETE FROM ListeningSegment WHERE ListeningSessionID=?;').run(listeningSessionId);
            database.prepare('DELETE FROM ListeningSession WHERE ListeningSessionID=?;').run(listeningSessionId);
        })();
    }

    public deleteAllSessions(): number {
        const database: any = this.databaseFactory.create();
        let changes: number = 0;
        database.transaction(() => {
            database.prepare('DELETE FROM ListeningSegment;').run();
            changes = database.prepare('DELETE FROM ListeningSession;').run().changes;
        })();

        return changes;
    }

    public getEndSummary(sinceMs: number): ListeningEndSummary {
        const database: any = this.databaseFactory.create();
        const row: any = database
            .prepare(
                `SELECT COALESCE(SUM(EndReason = ${ListeningEndReason.completed}), 0) AS completed,
                        COALESCE(SUM(EndReason = ${ListeningEndReason.skipped}), 0) AS skipped,
                        COALESCE(SUM(EndReason = ${ListeningEndReason.stopped}), 0) AS stopped,
                        AVG(CASE WHEN TrackDurationMs > 0 THEN MIN(1.0, MAX(0.0, CAST(FurthestPositionMs AS REAL) / TrackDurationMs)) END) AS averageCompletion
                 FROM ListeningSession WHERE StartedAtMs >= ? AND EndReason IS NOT NULL;`,
            )
            .get(sinceMs);

        return { completed: row.completed, skipped: row.skipped, stopped: row.stopped, averageCompletion: row.averageCompletion ?? 0 };
    }

    public getMostSkipped(sinceMs: number, limit: number): ListeningSkipTotal[] {
        return this.getSkipTotals(sinceMs, limit, 'skipped > 0', 'skipped DESC, sessions DESC');
    }

    public getAlwaysFinished(sinceMs: number, limit: number): ListeningSkipTotal[] {
        return this.getSkipTotals(sinceMs, limit, `skipped = 0 AND completed >= 2`, 'completed DESC');
    }

    public getListeningTimes(sinceMs: number): ListeningTimeEntry[] {
        const database: any = this.databaseFactory.create();
        return database
            .prepare('SELECT StartedAtMs AS startedAtMs, ListenedMs AS listenedMs FROM ListeningSession WHERE StartedAtMs >= ? AND ListenedMs > 0;')
            .all(sinceMs);
    }

    public getActiveDays(minimumListenedMs: number): string[] {
        const database: any = this.databaseFactory.create();
        const rows: any[] = database
            .prepare(
                `SELECT DATE(StartedAtMs / 1000, 'unixepoch', 'localtime') AS day FROM ListeningSession
                 GROUP BY day HAVING SUM(ListenedMs) >= ? ORDER BY day;`,
            )
            .all(minimumListenedMs);

        return rows.map((r) => r.day).filter((d) => typeof d === 'string');
    }

    private getSkipTotals(sinceMs: number, limit: number, having: string, orderBy: string): ListeningSkipTotal[] {
        const database: any = this.databaseFactory.create();
        const rows: any[] = database
            .prepare(
                `SELECT TrackPath AS key,
                        (SELECT s2.TrackTitle FROM ListeningSession s2 WHERE s2.TrackPath = s.TrackPath ORDER BY s2.StartedAtMs DESC LIMIT 1) AS title,
                        (SELECT s2.Artists FROM ListeningSession s2 WHERE s2.TrackPath = s.TrackPath ORDER BY s2.StartedAtMs DESC LIMIT 1) AS artists,
                        COUNT(*) AS sessions,
                        SUM(EndReason = ${ListeningEndReason.skipped}) AS skipped,
                        SUM(EndReason = ${ListeningEndReason.completed}) AS completed
                 FROM ListeningSession s WHERE StartedAtMs >= ? AND EndReason IS NOT NULL
                 GROUP BY TrackPath HAVING ${having} ORDER BY ${orderBy} LIMIT ?;`,
            )
            .all(sinceMs, limit);

        return rows.map((r) => ({
            key: r.key,
            title: r.title ?? '',
            subtitle: this.joinDelimited(r.artists),
            sessions: r.sessions,
            skipped: r.skipped,
            completed: r.completed,
        }));
    }

    public getSummary(sinceMs: number): ListeningSummary {
        const database: any = this.databaseFactory.create();
        // Active days are counted in local time ('localtime'), so a late evening counts for that evening's day.
        const row: any = database
            .prepare(
                `SELECT COALESCE(SUM(ListenedMs), 0) AS listenedMs,
                        COALESCE(SUM(IsCountedAsPlay), 0) AS plays,
                        COUNT(DISTINCT TrackPath) AS distinctTracks,
                        COUNT(DISTINCT CASE WHEN TRIM(COALESCE(AlbumKey, '')) <> '' THEN AlbumKey END) AS distinctAlbums,
                        COUNT(DISTINCT DATE(StartedAtMs / 1000, 'unixepoch', 'localtime')) AS activeDays
                 FROM ListeningSession WHERE StartedAtMs >= ?;`,
            )
            .get(sinceMs);

        return {
            listenedMs: row.listenedMs,
            plays: row.plays,
            distinctTracks: row.distinctTracks,
            distinctAlbums: row.distinctAlbums,
            activeDays: row.activeDays,
        };
    }

    public getTopTracks(sinceMs: number, limit: number): ListeningTotal[] {
        const database: any = this.databaseFactory.create();
        // The most recent snapshot of title/artists is shown for each track.
        const rows: any[] = database
            .prepare(
                `SELECT TrackPath AS key,
                        (SELECT s2.TrackTitle FROM ListeningSession s2 WHERE s2.TrackPath = s.TrackPath ORDER BY s2.StartedAtMs DESC LIMIT 1) AS title,
                        (SELECT s2.Artists FROM ListeningSession s2 WHERE s2.TrackPath = s.TrackPath ORDER BY s2.StartedAtMs DESC LIMIT 1) AS artists,
                        SUM(ListenedMs) AS listenedMs,
                        SUM(IsCountedAsPlay) AS plays,
                        (SELECT MIN(s3.StartedAtMs) FROM ListeningSession s3 WHERE s3.TrackPath = s.TrackPath) AS firstPlayedMs,
                        (SELECT MAX(s3.StartedAtMs) FROM ListeningSession s3 WHERE s3.TrackPath = s.TrackPath) AS lastPlayedMs
                 FROM ListeningSession s WHERE StartedAtMs >= ?
                 GROUP BY TrackPath ORDER BY listenedMs DESC, plays DESC LIMIT ?;`,
            )
            .all(sinceMs, limit);

        return rows.map((r) => ({
            key: r.key,
            title: r.title ?? '',
            subtitle: this.joinDelimited(r.artists),
            listenedMs: r.listenedMs,
            plays: r.plays,
            firstPlayedMs: r.firstPlayedMs,
            lastPlayedMs: r.lastPlayedMs,
        }));
    }

    public getTopAlbums(sinceMs: number, limit: number): ListeningTotal[] {
        const database: any = this.databaseFactory.create();
        const rows: any[] = database
            .prepare(
                `SELECT AlbumKey AS key,
                        MAX(AlbumTitle) AS title,
                        MAX(AlbumArtists) AS albumArtists,
                        SUM(ListenedMs) AS listenedMs,
                        SUM(IsCountedAsPlay) AS plays,
                        (SELECT MIN(s3.StartedAtMs) FROM ListeningSession s3 WHERE s3.AlbumKey = s.AlbumKey) AS firstPlayedMs,
                        (SELECT MAX(s3.StartedAtMs) FROM ListeningSession s3 WHERE s3.AlbumKey = s.AlbumKey) AS lastPlayedMs
                 FROM ListeningSession s WHERE StartedAtMs >= ? AND TRIM(COALESCE(AlbumKey, '')) <> ''
                 GROUP BY AlbumKey ORDER BY listenedMs DESC, plays DESC LIMIT ?;`,
            )
            .all(sinceMs, limit);

        return rows.map((r) => ({
            key: r.key,
            title: r.title ?? '',
            subtitle: this.joinDelimited(r.albumArtists),
            listenedMs: r.listenedMs,
            plays: r.plays,
            firstPlayedMs: r.firstPlayedMs,
            lastPlayedMs: r.lastPlayedMs,
        }));
    }

    public getTopArtists(sinceMs: number, limit: number): ListeningTotal[] {
        const database: any = this.databaseFactory.create();
        // Artists is a delimited multi-value field: group by the whole value in SQL, then split and add up per artist.
        const rows: any[] = database
            .prepare(
                `SELECT Artists AS artists, SUM(ListenedMs) AS listenedMs, SUM(IsCountedAsPlay) AS plays
                 FROM ListeningSession WHERE StartedAtMs >= ? GROUP BY Artists;`,
            )
            .all(sinceMs);

        // First and last played over the whole history, per artist.
        const spans: Map<string, { first: number; last: number }> = new Map<string, { first: number; last: number }>();
        const allRows: any[] = database
            .prepare('SELECT Artists AS artists, MIN(StartedAtMs) AS first, MAX(StartedAtMs) AS last FROM ListeningSession GROUP BY Artists;')
            .all();

        for (const row of allRows) {
            for (const artist of DataDelimiter.fromDelimitedString(row.artists).filter((x) => x.trim().length > 0)) {
                const key: string = artist.toLowerCase();
                const span = spans.get(key);
                spans.set(key, { first: Math.min(span?.first ?? row.first, row.first), last: Math.max(span?.last ?? row.last, row.last) });
            }
        }

        const totals: Map<string, ListeningTotal> = new Map<string, ListeningTotal>();

        for (const row of rows) {
            const artists: string[] = DataDelimiter.fromDelimitedString(row.artists).filter((x) => x.trim().length > 0);

            for (const artist of artists) {
                const key: string = artist.toLowerCase();
                const total: ListeningTotal = totals.get(key) ?? {
                    key,
                    title: artist,
                    subtitle: '',
                    listenedMs: 0,
                    plays: 0,
                    firstPlayedMs: spans.get(key)?.first,
                    lastPlayedMs: spans.get(key)?.last,
                };
                total.listenedMs += row.listenedMs;
                total.plays += row.plays;
                totals.set(key, total);
            }
        }

        return Array.from(totals.values())
            .sort((a, b) => b.listenedMs - a.listenedMs || b.plays - a.plays)
            .slice(0, limit);
    }

    public getHistory(sinceMs: number, limit: number, offset: number): ListeningSession[] {
        const database: any = this.databaseFactory.create();
        return database
            .prepare(
                `SELECT ListeningSessionID AS listeningSessionId, TrackPath AS trackPath, TrackTitle AS trackTitle, Artists AS artists,
                        AlbumTitle AS albumTitle, AlbumArtists AS albumArtists, AlbumKey AS albumKey, StartedAtMs AS startedAtMs,
                        ListenedMs AS listenedMs, TrackDurationMs AS trackDurationMs, IsCountedAsPlay AS isCountedAsPlay,
                        EndReason AS endReason, FurthestPositionMs AS furthestPositionMs
                 FROM ListeningSession WHERE StartedAtMs >= ? ORDER BY StartedAtMs DESC LIMIT ? OFFSET ?;`,
            )
            .all(sinceMs, limit, offset);
    }

    private joinDelimited(value: string | undefined): string {
        return DataDelimiter.fromDelimitedString(value)
            .filter((x) => x.trim().length > 0)
            .join(', ');
    }
}
