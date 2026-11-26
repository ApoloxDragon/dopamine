export abstract class PathRelocationRepositoryBase {
    /**
     * Moves every stored path under `from` to the same place under `to` (a network share that now appears under another
     * folder name). Returns how many rows changed, or undefined when nothing was done because `to` is already a music
     * folder (or inside one).
     */
    public abstract relocate(from: string, to: string): number | undefined;
}
