import { TrackModel } from '../track/track-model';

/**
 * Smart shuffle: a random order that favours songs you like and rate highly, puts disliked songs last, and avoids the same
 * artist or album twice in a row when it can. Every song stays in the queue: only the order changes.
 */
export class SmartShuffler {
    /** How likely a song is to come early. 1 is a normal song. */
    public static weight(track: TrackModel): number {
        let weight: number = 1;

        if (track.love === 1) {
            weight *= 3;
        }

        const rating: number = Number.isFinite(track.rating) ? track.rating : 0;

        if (rating >= 4) {
            weight *= 2;
        } else if (rating > 0 && rating <= 2) {
            weight *= 0.5;
        }

        // Songs you usually skip come a little later.
        const plays: number = Math.max(0, Number.isFinite(track.playCount) ? track.playCount : 0);
        const skips: number = Math.max(0, Number.isFinite(track.skipCount) ? track.skipCount : 0);
        weight *= (plays + 1) / (plays + skips + 1);

        return Math.max(weight, 0.01);
    }

    /** Indexes of tracks in the order they should play. random() is Math.random in the app (replaceable for tests). */
    public static order(
        tracks: TrackModel[],
        random: () => number = Math.random,
        isDisliked: (track: TrackModel) => boolean = () => false,
    ): number[] {
        // Weighted random order (Efraimidis-Spirakis): sort by random^(1 / weight), largest first.
        const keyed = tracks.map((track, index) => ({
            index,
            track,
            key: Math.pow(Math.max(random(), 1e-12), 1 / SmartShuffler.weight(track)),
        }));
        const dislikedSong = (track: TrackModel): boolean => track.love === -1 || isDisliked(track);
        const liked = keyed.filter((x) => !dislikedSong(x.track)).sort((a, b) => b.key - a.key);
        const disliked = keyed.filter((x) => dislikedSong(x.track)).sort((a, b) => b.key - a.key);

        return [...SmartShuffler.spreadOut(liked), ...SmartShuffler.spreadOut(disliked)].map((x) => x.index);
    }

    /** Moves songs so the same artist or album does not play twice in a row, when another song can go in between. */
    private static spreadOut<T extends { track: TrackModel }>(items: T[]): T[] {
        const result: T[] = [];
        const waiting: T[] = [...items];
        const remaining: Map<string, number> = new Map();

        for (const item of items) {
            const artist: string = SmartShuffler.artistKey(item.track);
            remaining.set(artist, (remaining.get(artist) ?? 0) + 1);
        }

        while (waiting.length > 0) {
            const previous: T | undefined = result[result.length - 1];
            let pick: number = 0;

            if (previous !== undefined) {
                // When one artist has more songs left than all others together, its songs must be spread out now, or
                // they end up together at the end.
                const [biggestArtist, biggestCount] = [...remaining.entries()].reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
                const mustSpread: boolean =
                    biggestArtist.length > 0 &&
                    biggestCount > waiting.length - biggestCount &&
                    SmartShuffler.artistKey(previous.track) !== biggestArtist;
                const lookAhead: number = mustSpread ? waiting.length : Math.min(waiting.length, 8);

                for (let i = 0; i < lookAhead; i++) {
                    const candidate: TrackModel = waiting[i].track;
                    const fits: boolean = mustSpread
                        ? SmartShuffler.artistKey(candidate) === biggestArtist
                        : !SmartShuffler.sameArtistOrAlbum(previous.track, candidate);

                    if (fits) {
                        pick = i;
                        break;
                    }
                }
            }

            const picked: T = waiting.splice(pick, 1)[0];
            const artist: string = SmartShuffler.artistKey(picked.track);
            remaining.set(artist, (remaining.get(artist) ?? 1) - 1);
            result.push(picked);
        }

        return result;
    }

    private static artistKey(track: TrackModel): string {
        return (track.artists ?? '').toLowerCase();
    }

    private static sameArtistOrAlbum(a: TrackModel, b: TrackModel): boolean {
        const albumA: string = a.albumKey ?? '';
        const artistA: string = (a.artists ?? '').toLowerCase();

        return (albumA.length > 0 && albumA === (b.albumKey ?? '')) || (artistA.length > 0 && artistA === (b.artists ?? '').toLowerCase());
    }
}
