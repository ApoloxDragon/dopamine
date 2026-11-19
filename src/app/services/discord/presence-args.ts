export interface PresenceArgs {
    title: string;
    artists: string;
    smallImageKey?: string;
    smallImageText?: string;
    largeImageKey?: string;
    largeImageText?: string;
    shouldSendTimestamps?: boolean;
    startTime?: number;
    endTime?: number;
    type?: number;
    /** What the user's status shows: 0 = app name, 1 = state (the artist), 2 = details (the song). */
    statusDisplayType?: number;
}
