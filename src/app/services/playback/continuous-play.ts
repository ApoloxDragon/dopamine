import { TrackModel } from '../track/track-model';

/**
 * Continuous play: when the queue ends, picks songs from the library that fit what was just played. Songs by the same
 * artists, of the same genres or from the same years are more likely, and so are liked and highly rated songs. Disliked
 * songs and songs already in the queue are never picked. There is always some chance, so it does not repeat itself.
 */
export class ContinuousPlay {
    public static readonly songsPerTurn: number = 10;
    /** How many of the last played songs say what "fits". */
    public static readonly songsToLookAt: number = 10;

    public static pick(
        recentlyPlayed: TrackModel[],
        library: TrackModel[],
        inQueue: TrackModel[],
        count: number = ContinuousPlay.songsPerTurn,
        random: () => number = Math.random,
        isDisliked: (track: TrackModel) => boolean = () => false,
    ): TrackModel[] {
        const seeds: TrackModel[] = recentlyPlayed.filter((x) => x != undefined).slice(-ContinuousPlay.songsToLookAt);
        const queued: Set<string> = new Set(inQueue.filter((x) => x != undefined).map((x) => x.path));
        const artists: Set<string> = new Set(seeds.flatMap((x) => ContinuousPlay.names(x.rawArtists)));
        const genres: Set<string> = new Set(seeds.flatMap((x) => ContinuousPlay.names(x.rawGenres)));
        const years: number[] = seeds.map((x) => x.year).filter((y) => Number.isFinite(y) && y > 0);
        const averageYear: number = years.length > 0 ? years.reduce((a, b) => a + b, 0) / years.length : 0;

        const candidates = library
            .filter((x) => x != undefined && typeof x.path === 'string' && !queued.has(x.path) && x.love !== -1 && !isDisliked(x))
            .map((track) => {
                let score: number = 0.2; // every song has a chance

                if (ContinuousPlay.names(track.rawArtists).some((a) => artists.has(a))) {
                    score += 3;
                }

                if (ContinuousPlay.names(track.rawGenres).some((g) => genres.has(g))) {
                    score += 2;
                }

                if (averageYear > 0 && Number.isFinite(track.year) && track.year > 0 && Math.abs(track.year - averageYear) <= 5) {
                    score += 1;
                }

                if (track.love === 1) {
                    score += 2;
                }

                if (Number.isFinite(track.rating) && track.rating >= 4) {
                    score += 1;
                }

                // Weighted random order: random^(1 / weight), largest first.
                return { track, key: Math.pow(Math.max(random(), 1e-12), 1 / score) };
            })
            .sort((a, b) => b.key - a.key);

        // The same song can be in the library twice (two folders): pick each path once.
        const picked: TrackModel[] = [];
        const pickedPaths: Set<string> = new Set();

        for (const { track } of candidates) {
            if (picked.length >= Math.max(0, count)) {
                break;
            }

            if (!pickedPaths.has(track.path)) {
                pickedPaths.add(track.path);
                picked.push(track);
            }
        }

        return picked;
    }

    /** Names as compared: trimmed, lower case, empty ones left out. */
    private static names(values: string[] | undefined): string[] {
        return (values ?? []).map((x) => String(x).trim().toLowerCase()).filter((x) => x.length > 0);
    }
}
