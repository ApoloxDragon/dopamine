import { ListeningSession } from '../entities/listening-session';

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
}

export abstract class ListeningSessionRepositoryBase {
    /** Inserts the session and returns its id. */
    public abstract addSession(session: ListeningSession): number;
    public abstract updateListened(listeningSessionId: number, listenedMs: number, isCountedAsPlay: boolean): void;
    public abstract deleteSession(listeningSessionId: number): void;
    /** Deletes the whole listening history. Returns the number of deleted sessions. */
    public abstract deleteAllSessions(): number;
    public abstract getSummary(sinceMs: number): ListeningSummary;
    public abstract getTopTracks(sinceMs: number, limit: number): ListeningTotal[];
    public abstract getTopAlbums(sinceMs: number, limit: number): ListeningTotal[];
    public abstract getTopArtists(sinceMs: number, limit: number): ListeningTotal[];
    public abstract getHistory(sinceMs: number, limit: number, offset: number): ListeningSession[];
}
