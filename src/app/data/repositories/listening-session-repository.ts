/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@angular/core';
import { DatabaseFactory } from '../database-factory';
import { ListeningSession } from '../entities/listening-session';
import { DataDelimiter } from '../data-delimiter';
import { ListeningSessionRepositoryBase, ListeningSummary, ListeningTotal } from './listening-session-repository.base';

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

    public updateListened(listeningSessionId: number, listenedMs: number, isCountedAsPlay: boolean): void {
        const database: any = this.databaseFactory.create();
        database
            .prepare('UPDATE ListeningSession SET ListenedMs=?, IsCountedAsPlay=? WHERE ListeningSessionID=?;')
            .run(Math.round(listenedMs), isCountedAsPlay ? 1 : 0, listeningSessionId);
    }

    public deleteSession(listeningSessionId: number): void {
        const database: any = this.databaseFactory.create();
        database.prepare('DELETE FROM ListeningSession WHERE ListeningSessionID=?;').run(listeningSessionId);
    }

    public deleteAllSessions(): number {
        const database: any = this.databaseFactory.create();
        const info: any = database.prepare('DELETE FROM ListeningSession;').run();

        return info.changes;
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
                        SUM(IsCountedAsPlay) AS plays
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
                        SUM(IsCountedAsPlay) AS plays
                 FROM ListeningSession WHERE StartedAtMs >= ? AND TRIM(COALESCE(AlbumKey, '')) <> ''
                 GROUP BY AlbumKey ORDER BY listenedMs DESC, plays DESC LIMIT ?;`,
            )
            .all(sinceMs, limit);

        return rows.map((r) => ({
            key: r.key,
            title: r.title ?? '',
            subtitle: this.joinDelimited(r.albumArtists),
            listenedMs: r.listenedMs,
            plays: r.plays,
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

        const totals: Map<string, ListeningTotal> = new Map<string, ListeningTotal>();

        for (const row of rows) {
            const artists: string[] = DataDelimiter.fromDelimitedString(row.artists).filter((x) => x.trim().length > 0);

            for (const artist of artists) {
                const key: string = artist.toLowerCase();
                const total: ListeningTotal = totals.get(key) ?? { key, title: artist, subtitle: '', listenedMs: 0, plays: 0 };
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
                        ListenedMs AS listenedMs, TrackDurationMs AS trackDurationMs, IsCountedAsPlay AS isCountedAsPlay
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
