import { ListeningSession } from '../entities/listening-session';
import { ListeningSegment } from '../entities/listening-segment';

export interface ListeningSummary {
    listenedMs: number;
    plays: number;
    distinctTracks: number;
    distinctAlbums: number;
    activeDays: number;
}

export interface ListeningTotal {
    /** Track path, album key or artist name, depending on the query. */
    key: string;
    title: string;
    subtitle: string;
    listenedMs: number;
    plays: number;
    /** First and last time it was played, over the whole history (not only the period). */
    firstPlayedMs?: number;
    lastPlayedMs?: number;
}

/** How plays ended (detailed statistics only). */
export interface ListeningEndSummary {
    completed: number;
    skipped: number;
    stopped: number;
    /** Average of the furthest position reached as a fraction of the track (0-1). */
    averageCompletion: number;
}

export interface ListeningSkipTotal {
    key: string;
    title: string;
    subtitle: string;
    /** Plays with an end reason (detailed statistics). */
    sessions: number;
    skipped: number;
    completed: number;
}

/** Listening time of one play, for charts by time (hour, weekday, day, month). */
export interface ListeningTimeEntry {
    startedAtMs: number;
    listenedMs: number;
}

/** Optional details of a play, stored with detailed statistics. */
export interface ListeningDetails {
    endReason: number | null;
    furthestPositionMs: number;
}

export abstract class ListeningSessionRepositoryBase {
    /** Inserts the session and returns its id. */
    public abstract addSession(session: ListeningSession): number;
    public abstract updateListened(listeningSessionId: number, listenedMs: number, isCountedAsPlay: boolean, details?: ListeningDetails): void;
    public abstract addSegments(listeningSessionId: number, segments: ListeningSegment[]): void;
    /** Heard parts per play, for the given plays. */
    public abstract getSegments(listeningSessionIds: number[]): Map<number, ListeningSegment[]>;
    public abstract getEndSummary(sinceMs: number): ListeningEndSummary;
    public abstract getMostSkipped(sinceMs: number, limit: number): ListeningSkipTotal[];
    public abstract getAlwaysFinished(sinceMs: number, limit: number): ListeningSkipTotal[];
    public abstract getListeningTimes(sinceMs: number): ListeningTimeEntry[];
    /** Local days (YYYY-MM-DD) with at least the given listening time, oldest first, over the whole history. */
    public abstract getActiveDays(minimumListenedMs: number): string[];
    public abstract deleteSession(listeningSessionId: number): void;
    /** Deletes the whole listening history. Returns the number of deleted sessions. */
    public abstract deleteAllSessions(): number;
    public abstract getSummary(sinceMs: number): ListeningSummary;
    public abstract getTopTracks(sinceMs: number, limit: number): ListeningTotal[];
    public abstract getTopAlbums(sinceMs: number, limit: number): ListeningTotal[];
    public abstract getTopArtists(sinceMs: number, limit: number): ListeningTotal[];
    public abstract getHistory(sinceMs: number, limit: number, offset: number): ListeningSession[];
}
