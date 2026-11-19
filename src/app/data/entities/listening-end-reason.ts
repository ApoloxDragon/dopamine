/** How a play ended (ListeningSession.EndReason). Only recorded with detailed statistics. */
export enum ListeningEndReason {
    /** Played to the end (or to within a few seconds of it). */
    completed = 1,
    /** Another track was started before the end. */
    skipped = 2,
    /** Playback was stopped, or the app was closed. */
    stopped = 3,
}
