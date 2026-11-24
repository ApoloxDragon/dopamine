import { SmartShuffler } from './smart-shuffler';
import { TrackModel } from '../track/track-model';

function track(
    id: number,
    extra: Partial<Record<'love' | 'rating' | 'playCount' | 'skipCount' | 'artists' | 'albumKey', any>> = {},
): TrackModel {
    return {
        id,
        love: 0,
        rating: 0,
        playCount: 0,
        skipCount: 0,
        artists: `;Artist ${id};`,
        albumKey: `album ${id}`,
        ...extra,
    } as unknown as TrackModel;
}

function seeded(seed: number): () => number {
    let state: number = seed;
    return (): number => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

describe('SmartShuffler', () => {
    it('the regular customer: every song is played once, in some order', () => {
        const tracks: TrackModel[] = Array.from({ length: 50 }, (_, i) => track(i));

        const order: number[] = SmartShuffler.order(tracks, seeded(1));

        expect([...order].sort((a, b) => a - b)).toEqual(tracks.map((_, i) => i));
    });

    it('should put disliked songs last', () => {
        const tracks: TrackModel[] = [track(0, { love: -1 }), track(1), track(2, { love: -1 }), track(3)];

        const order: number[] = SmartShuffler.order(tracks, seeded(2));

        expect(order.slice(2).sort()).toEqual([0, 2]);
    });

    it('should bring liked and highly rated songs earlier on average', () => {
        const tracks: TrackModel[] = Array.from({ length: 40 }, (_, i) => track(i, i < 5 ? { love: 1, rating: 5 } : {}));
        let positionOfFavourites: number = 0;
        const runs: number = 200;
        const random = seeded(3);

        for (let run = 0; run < runs; run++) {
            const order: number[] = SmartShuffler.order(tracks, random);
            positionOfFavourites += [0, 1, 2, 3, 4].reduce((sum, id) => sum + order.indexOf(id), 0) / 5;
        }

        // A normal shuffle would average about 19.5.
        expect(positionOfFavourites / runs).toBeLessThan(10);
    });

    it('should avoid the same artist twice in a row when it can', () => {
        const tracks: TrackModel[] = [
            ...Array.from({ length: 10 }, (_, i) => track(i, { artists: ';Black Sabbath;', albumKey: 'paranoid' })),
            ...Array.from({ length: 10 }, (_, i) => track(10 + i)),
        ];

        const order: number[] = SmartShuffler.order(tracks, seeded(4));
        let repeats: number = 0;
        for (let i = 1; i < order.length; i++) {
            repeats += order[i] < 10 && order[i - 1] < 10 ? 1 : 0;
        }

        expect(repeats).toBeLessThanOrEqual(1);
    });

    // Trying to break it.

    it('should work for no songs, one song, and songs that are all by one artist', () => {
        expect(SmartShuffler.order([])).toEqual([]);
        expect(SmartShuffler.order([track(0)])).toEqual([0]);
        expect(SmartShuffler.order([track(0, { artists: ';A;' }), track(1, { artists: ';A;' })]).sort()).toEqual([0, 1]);
    });

    it('should not be thrown by odd values', () => {
        const odd: TrackModel[] = [
            track(0, { rating: NaN, playCount: -5, skipCount: Infinity }),
            track(1, { rating: 99, playCount: NaN, skipCount: NaN, love: 7 }),
            track(2, { artists: undefined, albumKey: undefined }),
        ];

        const order: number[] = SmartShuffler.order(odd, () => 0);

        expect([...order].sort()).toEqual([0, 1, 2]);
        expect(odd.every((t) => Number.isFinite(SmartShuffler.weight(t)) && SmartShuffler.weight(t) > 0)).toBe(true);
    });

    it('should shuffle 20 000 songs quickly', () => {
        const tracks: TrackModel[] = Array.from({ length: 20000 }, (_, i) =>
            track(i, { artists: `;A${i % 50};`, albumKey: `B${i % 300}` }),
        );
        const started: number = Date.now();

        expect(SmartShuffler.order(tracks).length).toEqual(20000);
        expect(Date.now() - started).toBeLessThan(2000);
    });
});
