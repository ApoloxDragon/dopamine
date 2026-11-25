import { Subject } from 'rxjs';
import { SleepTimerService } from './sleep-timer.service';
import { PlaybackService } from '../playback/playback.service';
import { SleepTimerComponent } from '../../ui/components/sleep-timer/sleep-timer.component';

describe('SleepTimerService', () => {
    let stopped: Subject<void>;
    let playback: { stopPlayback: jest.Mock; stopAfterCurrentTrack: boolean; playbackStopped$: Subject<void> };
    let timer: SleepTimerService;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 10, 24, 23, 0, 0));
        stopped = new Subject<void>();
        playback = { stopPlayback: jest.fn(), stopAfterCurrentTrack: false, playbackStopped$: stopped };
        timer = new SleepTimerService(playback as unknown as PlaybackService);
    });

    afterEach(() => {
        timer.ngOnDestroy();
        jest.useRealTimers();
    });

    it('the regular customer: 30 minutes counts down and stops with a slow fade', () => {
        timer.start(30);
        expect(timer.remainingText).toEqual('30:00');

        jest.advanceTimersByTime(29 * 60000 + 59000);
        expect(timer.remainingText).toEqual('0:01');
        expect(playback.stopPlayback).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1000);
        expect(playback.stopPlayback).toHaveBeenCalledWith(SleepTimerService.fadeOutMs);
        expect(timer.isActive).toBe(false);
    });

    it('should show hours from 60 minutes and add 15 minutes to a running timer', () => {
        timer.start(90);
        expect(timer.remainingText).toEqual('1:30:00');

        timer.addMinutes(15);
        expect(timer.remainingText).toEqual('1:45:00');
    });

    it('should stop at the end of the song, and forget that after any stop', () => {
        timer.stopAtEndOfTrack();
        expect(playback.stopAfterCurrentTrack).toBe(true);
        expect(timer.mode).toEqual('endOfTrack');

        stopped.next();
        expect(timer.mode).toEqual('off');
    });

    it('should turn off cleanly, also the end-of-song stop', () => {
        timer.stopAtEndOfTrack();
        timer.turnOff();
        expect(playback.stopAfterCurrentTrack).toBe(false);

        timer.start(15);
        timer.turnOff();
        jest.advanceTimersByTime(16 * 60000);
        expect(playback.stopPlayback).not.toHaveBeenCalled();
    });

    // Trying to break it.

    it.each([0, -5, NaN, Infinity, 0.5, 24 * 60 + 1, 1e12])('should ignore a time of %p minutes', (minutes: number) => {
        timer.start(minutes);
        expect(timer.isActive).toBe(false);
    });

    it('should not add negative or absurd time, and never more than 24 hours', () => {
        timer.start(30);
        timer.addMinutes(-10);
        timer.addMinutes(NaN);
        expect(timer.remainingText).toEqual('30:00');

        timer.addMinutes(1e9);
        expect(timer.remainingMs).toBeLessThanOrEqual(SleepTimerService.maximumMinutes * 60000);
    });

    it('should still stop when the computer slept past the end time', () => {
        timer.start(15);
        jest.setSystemTime(Date.now() + 3 * 3600000); // woke up 3 hours later; the timer callback is late
        jest.advanceTimersByTime(60000);

        expect(playback.stopPlayback).toHaveBeenCalledTimes(1);
    });

    it('should restart instead of running two timers when started twice', () => {
        timer.start(15);
        timer.start(15);
        jest.advanceTimersByTime(16 * 60000);

        expect(playback.stopPlayback).toHaveBeenCalledTimes(1);
    });
});

describe('SleepTimerComponent.parseMinutes', () => {
    it.each([
        ['45', 45],
        [' 45 min ', 45],
        ['20 minutes', 20],
        ['1:30', 90],
        ['1h30', 90],
        ['2H05', 125],
        ['', 0],
        [undefined, 0],
        ['qwertyuiop', 0],
        ['-5', 0],
        ['1e3', 0],
        ['٣٠', 0],
        ['99999', 0],
    ])('%j -> %p', (typed: any, minutes: number) => {
        expect(SleepTimerComponent.parseMinutes(typed)).toEqual(minutes);
    });
});
