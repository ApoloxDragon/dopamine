/** One time a track was played (see Migration16). Times are Unix milliseconds. */
export class ListeningSession {
    public listeningSessionId: number = 0;
    public trackPath: string = '';
    public trackTitle: string = '';
    /** Delimited like Track.artists (';a;;b;'). */
    public artists: string = '';
    public albumTitle: string = '';
    /** Delimited like Track.albumArtists. */
    public albumArtists: string = '';
    public albumKey: string = '';
    public startedAtMs: number = 0;
    public listenedMs: number = 0;
    public trackDurationMs: number = 0;
    public isCountedAsPlay: number = 0;
    /** ListeningEndReason, or null when detailed statistics were off. */
    public endReason: number | null = null;
    /** Furthest position reached in the track, or null when detailed statistics were off. */
    public furthestPositionMs: number | null = null;
}
