import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { Logger } from '../../../../common/logger';
import { SettingsBase } from '../../../../common/settings/settings.base';
import { ListeningTotal } from '../../../../data/repositories/listening-session-repository.base';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { StatisticsPeriod, statisticsPeriods } from '../../../../services/statistics/statistics-period';
import {
    DetailedStatistics,
    ListeningBar,
    ListeningHistoryItem,
    StatisticsOverview,
    StatisticsService,
} from '../../../../services/statistics/statistics.service';
import { ListeningEndReason } from '../../../../data/entities/listening-end-reason';
import { ListeningTrackerService } from '../../../../services/statistics/listening-tracker.service';
import { DialogServiceBase } from '../../../../services/dialog/dialog.service.base';
import { TranslatorServiceBase } from '../../../../services/translator/translator.service.base';

@Component({
    selector: 'app-collection-statistics',
    host: { style: 'display: block; width: 100%;' },
    templateUrl: './collection-statistics.component.html',
    styleUrls: ['./collection-statistics.component.scss'],
})
export class CollectionStatisticsComponent implements OnInit, OnDestroy {
    private subscription: Subscription = new Subscription();

    public periods: StatisticsPeriod[] = statisticsPeriods;
    public selectedPeriod: StatisticsPeriod = statisticsPeriods[3];
    public overview: StatisticsOverview | undefined;
    public history: ListeningHistoryItem[] = [];
    public canLoadMoreHistory: boolean = false;
    /** Detailed statistics, only loaded when they are turned on. */
    public details: DetailedStatistics | undefined;
    public readonly hours: number[] = Array.from({ length: 24 }, (_, i) => i);
    /** Short weekday names in the user's language, Monday first. */
    public readonly weekdays: string[] = Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }),
    );
    public readonly endReasons: typeof ListeningEndReason = ListeningEndReason;

    public constructor(
        private statisticsService: StatisticsService,
        private playbackService: PlaybackService,
        public settings: SettingsBase,
        private logger: Logger,
        private listeningTracker: ListeningTrackerService,
        private dialogService: DialogServiceBase,
        private translatorService: TranslatorServiceBase,
    ) {}

    public get isDetailed(): boolean {
        return this.settings.detailedListeningStatistics;
    }

    public set isDetailed(value: boolean) {
        this.settings.detailedListeningStatistics = value;
        this.refresh();
    }

    /** Whether anything was recorded with detailed statistics in the period. */
    public get hasDetails(): boolean {
        const ends = this.details?.ends;
        return ends != undefined && ends.completed + ends.skipped + ends.stopped > 0;
    }

    public get hasData(): boolean {
        return this.overview != undefined && (this.overview.summary.listenedMs > 0 || this.history.length > 0);
    }

    public ngOnInit(): void {
        const saved: StatisticsPeriod | undefined = this.periods.find((x) => x.id === this.settings.statisticsSelectedPeriod);
        this.selectedPeriod = saved ?? this.selectedPeriod;
        this.refresh();

        // Show a finished track straight away.
        this.subscription.add(this.playbackService.playbackStarted$.subscribe(() => this.refresh()));
        this.subscription.add(this.playbackService.playbackStopped$.subscribe(() => this.refresh()));
    }

    public ngOnDestroy(): void {
        this.subscription.unsubscribe();
    }

    public selectPeriod(period: StatisticsPeriod): void {
        this.selectedPeriod = period;
        this.settings.statisticsSelectedPeriod = period.id;
        this.refresh();
    }

    public refresh(): void {
        try {
            this.overview = this.statisticsService.getOverview(this.selectedPeriod);
            this.details = this.isDetailed ? this.statisticsService.getDetails(this.selectedPeriod) : undefined;
            this.history = this.statisticsService.getHistory(this.selectedPeriod, 0);
            this.canLoadMoreHistory = this.history.length === StatisticsService.historyPageSize;
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load statistics', 'CollectionStatisticsComponent', 'refresh');
        }
    }

    public loadMoreHistory(): void {
        try {
            const more: ListeningHistoryItem[] = this.statisticsService.getHistory(this.selectedPeriod, this.history.length);
            this.history = [...this.history, ...more];
            this.canLoadMoreHistory = more.length === StatisticsService.historyPageSize;
        } catch (e: unknown) {
            this.logger.error(e, 'Could not load listening history', 'CollectionStatisticsComponent', 'loadMoreHistory');
        }
    }

    /** Deletes the whole listening history (all periods), after the user confirms. */
    public async clearHistoryAsync(): Promise<void> {
        const title: string = await this.translatorService.getAsync('clear-listening-history');
        const text: string = await this.translatorService.getAsync('confirm-clear-listening-history');

        if (!(await this.dialogService.showConfirmationDialogAsync(title, text))) {
            return;
        }

        try {
            this.listeningTracker.clearHistory();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not clear listening history', 'CollectionStatisticsComponent', 'clearHistoryAsync');
        }

        this.refresh();
    }

    /** Opacity of a heatmap cell (0 when nothing was played, otherwise at least a little visible). */
    public heat(ms: number): number {
        const max: number = this.details?.heatmap.maxMs ?? 0;
        return max > 0 && ms > 0 ? 0.15 + 0.85 * (ms / max) : 0;
    }

    /** Height of a bar in percent. */
    public barHeight(bar: ListeningBar): number {
        const max: number = this.details?.barMaxMs ?? 0;
        return max > 0 ? Math.max(bar.listenedMs > 0 ? 2 : 0, (bar.listenedMs / max) * 100) : 0;
    }

    public formatBar(bar: ListeningBar): string {
        const date: Date = new Date(bar.startMs);
        return this.details?.barUnit === 'month'
            ? date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
            : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    }

    public formatDate(ms: number | undefined): string {
        return ms == undefined || !Number.isFinite(ms) ? '' : new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
    }

    public percent(fraction: number): number {
        return Number.isFinite(fraction) ? Math.round(Math.min(1, Math.max(0, fraction)) * 100) : 0;
    }

    public formatDateTime(ms: number): string {
        return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }

    public trackByKey(_: number, item: ListeningTotal): string {
        return item.key;
    }
}
