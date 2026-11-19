import { ListeningDetailRecorder } from './listening-detail-recorder';
import { ListeningEndReason } from '../../data/entities/listening-end-reason';
import { ListeningSegment } from '../../data/entities/listening-segment';

describe('ListeningDetailRecorder', () => {
    const minute: number = 60000;
    let now: number;
    let recorder: ListeningDetailRecorder;

    // Plays from the current position for the given time, reporting progress every 500 ms like the player.
    function play(fromMs: number, forMs: number, speed: number = 1): number {
        let position: number = fromMs;
        for (let t = 0; t < forMs; t += 500) {
            now += 500;
            position += 500 * speed;
            recorder.progress(position, now);
        }
        return position;
    }

    function parts(): number[][] {
        return recorder.takeUnsaved().map((x: ListeningSegment) => [x.fromMs, x.toMs]);
    }

    beforeEach(() => {
        now = 1_000_000;
        recorder = new ListeningDetailRecorder(4 * minute);
    });

    it('should record one part for uninterrupted playback, and count it as completed at the end', () => {
        recorder.begin(0, now);
        play(0, 4 * minute);

        expect(recorder.endReason(ListeningEndReason.skipped)).toEqual(ListeningEndReason.completed);
        expect(parts()).toEqual([[0, 4 * minute]]);
        expect(recorder.furthestPositionMs).toEqual(4 * minute);
    });

    it('should start a new part at a seek and at a resume, and not count paused time', () => {
        recorder.begin(0, now);
        play(0, 30000);
        recorder.seek(120000, now);
        play(120000, 10000);
        recorder.end(); // pause
        now += 5 * minute;
        recorder.begin(130000, now); // resume
        play(130000, 5000);

        expect(recorder.endReason(ListeningEndReason.skipped)).toEqual(ListeningEndReason.skipped);
        expect(parts()).toEqual([
            [0, 30000],
            [120000, 130000],
            [130000, 135000],
        ]);
    });

    it('should hand over parts once, and take them back when saving failed', () => {
        recorder.begin(0, now);
        play(0, 10000);
        recorder.seek(60000, now);
        const first: ListeningSegment[] = recorder.takeUnsaved();
        play(60000, 10000);
        recorder.end();

        expect(recorder.takeUnsaved().length).toEqual(1);
        recorder.restore(first);
        expect(recorder.takeUnsaved().map((x) => x.fromMs)).toEqual([0]);
        expect(recorder.takeUnsaved()).toEqual([]);
    });

    // Trying to break it.

    it('should ignore positions that are not numbers', () => {
        recorder.begin(NaN, now);
        recorder.begin(0, now);
        play(0, 5000);
        for (const bad of [NaN, Infinity, -Infinity, undefined, null, '120000', {}]) {
            recorder.progress(bad as unknown as number, now + 1);
            recorder.seek(bad as unknown as number, now + 1);
        }
        play(5000, 5000);
        recorder.end();

        expect(parts()).toEqual([[0, 10000]]);
    });

    it('should not let a late position of the previous track mark the play as completed', () => {
        // The new track starts, but the first progress still reports the previous, longer track near its end.
        recorder.begin(0, now);
        now += 500;
        recorder.progress(9 * minute, now);
        now += 500;
        recorder.progress(500, now);
        play(500, 20000);

        expect(recorder.endReason(ListeningEndReason.skipped)).toEqual(ListeningEndReason.skipped);
        expect(parts()).toEqual([[500, 20500]]);
        expect(recorder.furthestPositionMs).toEqual(20500);
    });

    it('should treat unreported jumps as new parts', () => {
        recorder.begin(0, now);
        play(0, 10000);
        now += 500;
        recorder.progress(200000, now); // forward jump without a seek event
        play(200000, 5000);
        now += 500;
        recorder.progress(1000, now); // backward jump
        play(1000, 5000);
        recorder.end();

        expect(parts()).toEqual([
            [0, 10000],
            [200000, 205000],
            [1000, 6000],
        ]);
    });

    it('should accept fast playback speeds without splitting parts', () => {
        recorder.begin(0, now);
        play(0, 20000, 2);
        recorder.end();

        expect(parts()).toEqual([[0, 40000]]);
    });

    it('should keep positions within the track', () => {
        recorder.begin(-5000, now);
        play(0, 5000);
        recorder.seek(10 * minute, now); // past the end
        play(4 * minute, 5000);
        recorder.end();

        const recorded: number[][] = parts();
        expect(recorded[0]).toEqual([0, 5000]);
        expect(recorded.every(([from, to]) => from >= 0 && to <= 4 * minute)).toBe(true);
        expect(recorder.furthestPositionMs).toBeLessThanOrEqual(4 * minute);
    });

    it('should survive a seek storm without keeping thousands of tiny parts', () => {
        recorder.begin(0, now);
        for (let i = 0; i < 20000; i++) {
            now += 10;
            recorder.seek((i * 7919) % (4 * minute), now);
        }
        play(0, 3000);
        recorder.end();

        const recorded: number[][] = parts();
        expect(recorded.length).toBeLessThanOrEqual(ListeningDetailRecorder.maximumParts);
        expect(recorded.every(([from, to]) => to - from >= ListeningDetailRecorder.minimumPartMs)).toBe(true);
    });

    it('should cap the number of parts of a play', () => {
        recorder.begin(0, now);
        for (let i = 0; i < ListeningDetailRecorder.maximumParts + 500; i++) {
            const from: number = (i * 1000) % (4 * minute - 2000);
            recorder.seek(from, now);
            play(from, 500);
        }
        recorder.end();

        expect(parts().length).toEqual(ListeningDetailRecorder.maximumParts);
    });

    it('should handle a track without a known length (never completed, no clamping)', () => {
        recorder = new ListeningDetailRecorder(0);
        recorder.begin(0, now);
        play(0, 10 * minute);

        expect(recorder.endReason(ListeningEndReason.stopped)).toEqual(ListeningEndReason.stopped);
        expect(parts()).toEqual([[0, 10 * minute]]);
    });

    it('should not count time when the clock jumps (sleep, clock change) but the position does not', () => {
        recorder.begin(0, now);
        play(0, 5000);
        now += 8 * 60 * 60 * 1000; // computer slept for 8 hours
        recorder.progress(5500, now);
        play(5500, 5000);
        now -= 3 * 60 * 60 * 1000; // clock set back
        recorder.progress(11000, now);
        recorder.end();

        expect(parts()).toEqual([[0, 11000]]);
    });

    it('should do nothing harmful when used in the wrong order', () => {
        recorder.end();
        recorder.progress(5000, now);
        recorder.seek(1000, now);
        recorder.end();
        recorder.end();
        recorder.restore([]);

        expect(recorder.endReason(ListeningEndReason.stopped)).toEqual(ListeningEndReason.stopped);
        expect(parts()).toEqual([]);
    });
});
