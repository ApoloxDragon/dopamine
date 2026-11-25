import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { PlaybackService } from '../playback/playback.service';

export type SleepTimerMode = 'off' | 'time' | 'endOfTrack';

/**
 * Stops playback after a while (with a slow fade out), or at the end of the current song. Nothing is stored: the timer is
 * gone when the app closes.
 */
@Injectable({ providedIn: 'root' })
export class SleepTimerService implements OnDestroy {
    public static readonly presetMinutes: number[] = [15, 30, 45, 60, 90];
    public static readonly fadeOutMs: number = 10000;
    public static readonly maximumMinutes: number = 24 * 60;

    private _mode: SleepTimerMode = 'off';
    private _endsAtMs: number = 0;
    private _timeout: ReturnType<typeof setTimeout> | undefined;
    private readonly subscription: Subscription = new Subscription();

    public constructor(private playbackService: PlaybackService) {
        // A stop from anywhere (stop button, end of the queue) also ends "stop at the end of this song".
        this.subscription.add(
            this.playbackService.playbackStopped$.subscribe(() => {
                if (this._mode === 'endOfTrack') {
                    this._mode = 'off';
                }
            }),
        );
    }

    public get mode(): SleepTimerMode {
        return this._mode;
    }

    public get isActive(): boolean {
        return this._mode !== 'off';
    }

    /** Milliseconds left (0 when off or stopping at the end of the song). */
    public get remainingMs(): number {
        return this._mode === 'time' ? Math.max(0, this._endsAtMs - Date.now()) : 0;
    }

    /** "29:59", or "1:05:00" from an hour. */
    public get remainingText(): string {
        const totalSeconds: number = Math.ceil(this.remainingMs / 1000);
        const hours: number = Math.floor(totalSeconds / 3600);
        const minutes: number = Math.floor((totalSeconds % 3600) / 60);
        const seconds: number = totalSeconds % 60;
        const two = (n: number): string => String(n).padStart(2, '0');

        return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
    }

    /** Starts (or restarts) the timer. Ignores anything that is not between 1 minute and 24 hours. */
    public start(minutes: number): void {
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > SleepTimerService.maximumMinutes) {
            return;
        }

        this.clear();
        this._mode = 'time';
        this._endsAtMs = Date.now() + Math.round(minutes * 60000);
        this.schedule();
    }

    /** Adds time to a running timer (or starts one). */
    public addMinutes(minutes: number): void {
        if (this._mode !== 'time') {
            this.start(minutes);
            return;
        }

        if (!Number.isFinite(minutes) || minutes <= 0) {
            return;
        }

        const maximumEnd: number = Date.now() + SleepTimerService.maximumMinutes * 60000;
        this._endsAtMs = Math.min(maximumEnd, this._endsAtMs + Math.round(minutes * 60000));
        this.schedule();
    }

    public stopAtEndOfTrack(): void {
        this.clear();
        this._mode = 'endOfTrack';
        this.playbackService.stopAfterCurrentTrack = true;
    }

    public turnOff(): void {
        this.clear();
    }

    public ngOnDestroy(): void {
        this.clear();
        this.subscription.unsubscribe();
    }

    private schedule(): void {
        if (this._timeout !== undefined) {
            clearTimeout(this._timeout);
        }

        // Timers can be late (a sleeping computer): the check runs again until the end time has really passed.
        this._timeout = setTimeout(() => this.tick(), Math.min(this.remainingMs, 60000));
    }

    private tick(): void {
        this._timeout = undefined;

        if (this._mode !== 'time') {
            return;
        }

        if (this.remainingMs > 0) {
            this.schedule();
            return;
        }

        this.clear();
        this.playbackService.stopPlayback(SleepTimerService.fadeOutMs);
    }

    private clear(): void {
        if (this._timeout !== undefined) {
            clearTimeout(this._timeout);
            this._timeout = undefined;
        }

        if (this._mode === 'endOfTrack') {
            this.playbackService.stopAfterCurrentTrack = false;
        }

        this._mode = 'off';
        this._endsAtMs = 0;
    }
}
