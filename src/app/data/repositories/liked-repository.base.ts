export type LikedKind = 'album' | 'artist';

export abstract class LikedRepositoryBase {
    /** All likes (1) and dislikes (-1) of a kind, by key. */
    public abstract getAll(kind: LikedKind): Map<string, number>;
    /** Stores a like (1) or dislike (-1). 0 removes it. */
    public abstract set(kind: LikedKind, key: string, value: number, atMs: number): void;
}
