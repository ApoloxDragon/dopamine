/** A continuous part of a track that was heard during a play (positions in the track, in milliseconds). */
export class ListeningSegment {
    public listeningSegmentId: number = 0;
    public listeningSessionId: number = 0;
    /** Wall clock time (Unix milliseconds) this part started playing. */
    public startedAtMs: number = 0;
    public fromMs: number = 0;
    public toMs: number = 0;
}
