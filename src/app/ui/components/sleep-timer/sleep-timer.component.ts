import { Component, OnDestroy, OnInit } from '@angular/core';
import { SleepTimerService } from '../../../services/sleep-timer/sleep-timer.service';
import { DialogServiceBase } from '../../../services/dialog/dialog.service.base';
import { TranslatorServiceBase } from '../../../services/translator/translator.service.base';

/** Moon button in the player: sleep timer presets, and the countdown while it runs. */
@Component({
    selector: 'app-sleep-timer',
    host: { style: 'display: flex; align-items: center' },
    templateUrl: './sleep-timer.component.html',
    styleUrls: ['./sleep-timer.component.scss'],
})
export class SleepTimerComponent implements OnInit, OnDestroy {
    public readonly presets: number[] = SleepTimerService.presetMinutes;
    public countdown: string = '';
    private interval: ReturnType<typeof setInterval> | undefined;

    public constructor(
        public sleepTimer: SleepTimerService,
        private dialogService: DialogServiceBase,
        private translatorService: TranslatorServiceBase,
    ) {}

    public ngOnInit(): void {
        this.update();
        this.interval = setInterval(() => this.update(), 1000);
    }

    public ngOnDestroy(): void {
        if (this.interval !== undefined) {
            clearInterval(this.interval);
        }
    }

    public start(minutes: number): void {
        this.sleepTimer.start(minutes);
        this.update();
    }

    public addMinutes(minutes: number): void {
        this.sleepTimer.addMinutes(minutes);
        this.update();
    }

    public stopAtEndOfTrack(): void {
        this.sleepTimer.stopAtEndOfTrack();
        this.update();
    }

    public turnOff(): void {
        this.sleepTimer.turnOff();
        this.update();
    }

    public async customAsync(): Promise<void> {
        const title: string = await this.translatorService.getAsync('sleep-timer-custom');
        const placeholder: string = await this.translatorService.getAsync('sleep-timer-custom-placeholder');
        const description: string = await this.translatorService.getAsync('sleep-timer-custom-description');
        const typed: string = await this.dialogService.showInputDialogAsync(title, placeholder, '', [], description, 'las la-moon');
        const minutes: number = SleepTimerComponent.parseMinutes(typed);

        if (minutes > 0) {
            this.start(minutes);
        }
    }

    /** "45", "45 min", "1:30" (hours:minutes) or "1h30" -> minutes; 0 when it cannot be read. */
    public static parseMinutes(typed: string | undefined): number {
        const text: string = (typed ?? '').trim().toLowerCase();
        let match: RegExpExecArray | null = /^(\d{1,2})\s*[:h]\s*(\d{1,2})\s*(m|min)?$/.exec(text);

        if (match !== null) {
            return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
        }

        match = /^(\d{1,4})\s*(m|min|minutes?)?$/.exec(text);

        return match !== null ? parseInt(match[1], 10) : 0;
    }

    private update(): void {
        this.countdown = this.sleepTimer.mode === 'time' ? this.sleepTimer.remainingText : '';
    }
}
