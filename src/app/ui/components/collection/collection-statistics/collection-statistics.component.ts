import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { Logger } from '../../../../common/logger';
import { SettingsBase } from '../../../../common/settings/settings.base';
import { ListeningTotal } from '../../../../data/repositories/listening-session-repository.base';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { StatisticsPeriod, statisticsPeriods } from '../../../../services/statistics/statistics-period';
import { ListeningHistoryItem, StatisticsOverview, StatisticsService } from '../../../../services/statistics/statistics.service';

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

    public constructor(
        private statisticsService: StatisticsService,
        private playbackService: PlaybackService,
        public settings: SettingsBase,
        private logger: Logger,
    ) {}

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

    public formatDateTime(ms: number): string {
        return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }

    public trackByKey(_: number, item: ListeningTotal): string {
        return item.key;
    }
}
