import { ContinuousPlay } from './continuous-play';
import { TrackModel } from '../track/track-model';

type Extra = Partial<{ rawArtists: string[]; rawGenres: string[]; year: number; love: number; rating: number }>;

function track(path: string, extra: Extra = {}): TrackModel {
    return { path, rawArtists: [], rawGenres: [], year: 0, love: 0, rating: 0, ...extra } as unknown as TrackModel;
}

function seeded(seed: number): () => number {
    let state: number = seed;
    return (): number => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
    };
}

describe('ContinuousPlay', () => {
    const sabbath = (path: string, extra: Extra = {}): TrackModel =>
        track(path, { rawArtists: ['Black Sabbath'], rawGenres: ['Heavy Metal'], year: 1971, ...extra });

    it('the regular customer: picks 10 new songs, mostly ones that fit', () => {
        const played: TrackModel[] = [sabbath('/q/1'), sabbath('/q/2')];
        const fitting: TrackModel[] = Array.from({ length: 15 }, (_, i) => sabbath(`/fit/${i}`));
        const other: TrackModel[] = Array.from({ length: 100 }, (_, i) =>
            track(`/other/${i}`, { rawArtists: ['Schubert'], rawGenres: ['Lied'], year: 1827 }),
        );

        const picked: TrackModel[] = ContinuousPlay.pick(played, [...played, ...fitting, ...other], played, 10, seeded(1));

        expect(picked.length).toEqual(10);
        expect(picked.filter((x) => x.path.startsWith('/fit/')).length).toBeGreaterThanOrEqual(6);
    });

    it('should never pick disliked songs or songs already in the queue', () => {
        const played: TrackModel[] = [sabbath('/q/1')];
        const library: TrackModel[] = [...played, sabbath('/a', { love: -1 }), sabbath('/b'), track('/c')];

        const picked: TrackModel[] = ContinuousPlay.pick(played, library, played, 10, seeded(2));

        expect(picked.map((x) => x.path).sort()).toEqual(['/b', '/c']);
    });

    it('should favour liked and highly rated songs among songs that do not fit otherwise', () => {
        const library: TrackModel[] = [
            ...Array.from({ length: 50 }, (_, i) => track(`/plain/${i}`)),
            ...Array.from({ length: 5 }, (_, i) => track(`/fav/${i}`, { love: 1, rating: 5 })),
        ];
        let favourites: number = 0;
        const random = seeded(3);

        for (let run = 0; run < 100; run++) {
            favourites += ContinuousPlay.pick([], library, [], 5, random).filter((x) => x.path.startsWith('/fav/')).length;
        }

        // Without the preference about 0.45 of 5 picks would be favourites.
        expect(favourites / 100).toBeGreaterThan(2);
    });

    // Trying to break it.

    it('should handle an empty library, a library that is all queued or disliked, and no history', () => {
        expect(ContinuousPlay.pick([], [], [])).toEqual([]);
        const all: TrackModel[] = [track('/a'), track('/b', { love: -1 })];
        expect(ContinuousPlay.pick(all, all, all)).toEqual([]);
        expect(ContinuousPlay.pick([], [track('/x')], []).map((x) => x.path)).toEqual(['/x']);
    });

    it('should pick a song that is in the library twice only once', () => {
        const picked: TrackModel[] = ContinuousPlay.pick([], [track('/same'), track('/same'), track('/other')], [], 10);

        expect(picked.map((x) => x.path).sort()).toEqual(['/other', '/same']);
    });

    it('should not be thrown by odd values', () => {
        const odd: TrackModel[] = [
            track('/1', { year: NaN, rating: Infinity }),
            track('/2', { rawArtists: undefined as any, rawGenres: [null as any, ''], year: -5 }),
            undefined as unknown as TrackModel,
            { path: 42 } as unknown as TrackModel,
        ];

        expect(() => ContinuousPlay.pick(odd, odd, [], 10, () => 0)).not.toThrow();
        expect(ContinuousPlay.pick([], [track('/a')], [], -3)).toEqual([]);
    });

    it('should pick from 50 000 songs quickly', () => {
        const library: TrackModel[] = Array.from({ length: 50000 }, (_, i) =>
            track(`/m/${i}`, { rawArtists: [`A${i % 300}`], rawGenres: [`G${i % 20}`], year: 1960 + (i % 60) }),
        );
        const started: number = Date.now();

        expect(ContinuousPlay.pick(library.slice(0, 10), library, library.slice(0, 10)).length).toEqual(10);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('should never pick songs on disliked albums or by disliked artists', () => {
        const library: TrackModel[] = [track('/a', { rawArtists: ['Bad'] }), track('/b')];

        expect(ContinuousPlay.pick([], library, [], 10, seeded(5), (t) => t.rawArtists.includes('Bad')).map((x) => x.path)).toEqual(['/b']);
    });
});
