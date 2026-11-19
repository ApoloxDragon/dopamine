import { ListeningSegment } from '../../data/entities/listening-segment';
import { ListeningEndReason } from '../../data/entities/listening-end-reason';

/**
 * Records, for one play, which parts of the track were heard (detailed statistics, opt-in).
 *
 * Positions come from the player's progress (every 500 ms), seeks, pauses and resumes. A "part" is a continuous stretch
 * of playback: a seek, a pause or a jump in position closes it and starts a new one. The recorder never trusts a
 * position on its own: positions that are not numbers are ignored, positions are kept within the track, a part only
 * counts when playback really moved forward, and a jump that was not reported as a seek (for example the previous
 * track's position arriving late) also starts a new part. The furthest position reached is taken from the parts, so a
 * stray position cannot mark a play as completed.
 */
export class ListeningDetailRecorder {
    /** Parts shorter than this are not kept (clicks around a seek, a stray position). */
    public static readonly minimumPartMs: number = 250;
    /** A play ending within this distance of the end counts as completed. */
    public static readonly completedWithinMs: number = 3000;
    /** At most this many parts per play (a seek storm must not flood the database). */
    public static readonly maximumParts: number = 2000;
    /** Positions may advance at most this much faster than the clock (playback speed) before it counts as a jump. */
    private static readonly maximumSpeed: number = 4;
    private static readonly jumpToleranceMs: number = 2000;

    private openFromMs: number | undefined;
    private openStartedAtMs: number = 0;
    private lastPositionMs: number = 0;
    private lastClockMs: number = 0;
    private furthestMs: number = 0;
    private partCount: number = 0;
    private unsaved: ListeningSegment[] = [];

    public constructor(private durationMs: number) {}

    /** Furthest position reached in a heard part, in milliseconds. */
    public get furthestPositionMs(): number {
        return this.furthestMs;
    }

    /** Playback (re)starts at the given position. */
    public begin(positionMs: number, nowMs: number): void {
        const position: number | undefined = this.clamp(positionMs);

        if (position == undefined || !Number.isFinite(nowMs)) {
            return;
        }

        this.end();
        this.openFromMs = position;
        this.openStartedAtMs = nowMs;
        this.lastPositionMs = position;
        this.lastClockMs = nowMs;
    }

    /** The player reports where it is. */
    public progress(positionMs: number, nowMs: number): void {
        const position: number | undefined = this.clamp(positionMs);

        if (position == undefined || !Number.isFinite(nowMs) || this.openFromMs == undefined) {
            return;
        }

        const elapsedMs: number = Math.max(0, nowMs - this.lastClockMs);
        const isBackward: boolean = position < this.lastPositionMs - ListeningDetailRecorder.jumpToleranceMs;
        const isTooFarForward: boolean =
            position > this.lastPositionMs + elapsedMs * ListeningDetailRecorder.maximumSpeed + ListeningDetailRecorder.jumpToleranceMs;

        if (isBackward || isTooFarForward) {
            // A jump that was not reported as a seek: the part ends where playback was, a new one starts here.
            this.begin(position, nowMs);
            return;
        }

        if (position >= this.lastPositionMs) {
            this.lastPositionMs = position;
        }

        this.lastClockMs = nowMs;
    }

    /** A seek: the current part ends where playback was, a new one starts at the new position. */
    public seek(positionMs: number, nowMs: number): void {
        this.begin(positionMs, nowMs);
    }

    /** Playback paused or ended: the current part ends at the last known position. */
    public end(): void {
        if (this.openFromMs == undefined) {
            return;
        }

        const part: ListeningSegment = {
            listeningSegmentId: 0,
            listeningSessionId: 0,
            startedAtMs: this.openStartedAtMs,
            fromMs: this.openFromMs,
            toMs: this.lastPositionMs,
        };
        this.openFromMs = undefined;

        if (part.toMs - part.fromMs < ListeningDetailRecorder.minimumPartMs || this.partCount >= ListeningDetailRecorder.maximumParts) {
            return;
        }

        this.partCount++;
        this.furthestMs = Math.max(this.furthestMs, part.toMs);
        this.unsaved.push(part);
    }

    /** How the play ended: completed when it got to within a few seconds of the end, otherwise the given reason. */
    public endReason(otherwise: ListeningEndReason): ListeningEndReason {
        this.end();
        const reachedEnd: boolean = this.durationMs > 0 && this.furthestMs >= this.durationMs - ListeningDetailRecorder.completedWithinMs;

        return reachedEnd ? ListeningEndReason.completed : otherwise;
    }

    /** Parts that were not saved yet. They are handed over once: give them back with restore() if saving failed. */
    public takeUnsaved(): ListeningSegment[] {
        const parts: ListeningSegment[] = this.unsaved;
        this.unsaved = [];

        return parts;
    }

    public restore(parts: ListeningSegment[]): void {
        this.unsaved = [...parts, ...this.unsaved];
    }

    private clamp(positionMs: number): number | undefined {
        if (typeof positionMs !== 'number' || !Number.isFinite(positionMs)) {
            return undefined;
        }

        const max: number = this.durationMs > 0 ? this.durationMs : Number.MAX_SAFE_INTEGER;

        return Math.min(Math.max(0, positionMs), max);
    }
}
