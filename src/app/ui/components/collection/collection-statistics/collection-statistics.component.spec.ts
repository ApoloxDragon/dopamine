import { Subject } from 'rxjs';
import { IMock, It, Mock, Times } from 'typemoq';
import { CollectionStatisticsComponent } from './collection-statistics.component';
import {
    StatisticsService,
    StatisticsOverview,
    ListeningHistoryItem,
    DetailedStatistics,
} from '../../../../services/statistics/statistics.service';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { SettingsMock } from '../../../../testing/settings-mock';
import { Logger } from '../../../../common/logger';
import { statisticsPeriods } from '../../../../services/statistics/statistics-period';
import { ListeningTrackerService } from '../../../../services/statistics/listening-tracker.service';
import { DialogServiceBase } from '../../../../services/dialog/dialog.service.base';
import { TranslatorServiceBase } from '../../../../services/translator/translator.service.base';

describe('CollectionStatisticsComponent', () => {
    let statisticsServiceMock: IMock<StatisticsService>;
    let settings: SettingsMock;
    let started: Subject<unknown>;
    let stopped: Subject<void>;
    let trackerMock: IMock<ListeningTrackerService>;
    let dialogServiceMock: IMock<DialogServiceBase>;
    let translatorServiceMock: IMock<TranslatorServiceBase>;

    const emptyOverview: StatisticsOverview = {
        summary: { listenedMs: 0, plays: 0, distinctTracks: 0, distinctAlbums: 0, activeDays: 0 },
        topTracks: [],
        topAlbums: [],
        topArtists: [],
    };

    function historyItems(count: number): ListeningHistoryItem[] {
        return Array.from({ length: count }, (_, i) => ({
            listeningSessionId: i,
            endReason: null,
            heardParts: [],
            startedAtMs: i,
            title: `T${i}`,
            artists: 'A',
            albumTitle: 'Al',
            listenedMs: 1000,
            isCountedAsPlay: true,
        }));
    }

    function create(): CollectionStatisticsComponent {
        const playbackService = {
            playbackStarted$: started.asObservable(),
            playbackStopped$: stopped.asObservable(),
        } as unknown as PlaybackService;
        return new CollectionStatisticsComponent(
            statisticsServiceMock.object,
            playbackService,
            settings,
            Mock.ofType<Logger>().object,
            trackerMock.object,
            dialogServiceMock.object,
            translatorServiceMock.object,
        );
    }

    beforeEach(() => {
        statisticsServiceMock = Mock.ofType<StatisticsService>();
        statisticsServiceMock.setup((x) => x.getOverview(It.isAny())).returns(() => emptyOverview);
        statisticsServiceMock.setup((x) => x.getHistory(It.isAny(), It.isAny())).returns(() => []);
        settings = new SettingsMock();
        started = new Subject();
        stopped = new Subject();
        trackerMock = Mock.ofType<ListeningTrackerService>();
        dialogServiceMock = Mock.ofType<DialogServiceBase>();
        translatorServiceMock = Mock.ofType<TranslatorServiceBase>();
        translatorServiceMock.setup((x) => x.getAsync(It.isAny())).returns((key: string) => Promise.resolve(key));
    });

    it('should clear the history after confirmation and reload', async () => {
        dialogServiceMock
            .setup((x) => x.showConfirmationDialogAsync('clear-listening-history', 'confirm-clear-listening-history'))
            .returns(() => Promise.resolve(true));
        const component = create();
        component.ngOnInit();

        await component.clearHistoryAsync();

        trackerMock.verify((x) => x.clearHistory(), Times.once());
        statisticsServiceMock.verify((x) => x.getOverview(It.isAny()), Times.exactly(2));
    });

    it('should not clear the history when the confirmation is cancelled', async () => {
        dialogServiceMock.setup((x) => x.showConfirmationDialogAsync(It.isAny(), It.isAny())).returns(() => Promise.resolve(false));
        const component = create();
        component.ngOnInit();

        await component.clearHistoryAsync();

        trackerMock.verify((x) => x.clearHistory(), Times.never());
    });

    it('should start with the saved period', () => {
        settings.statisticsSelectedPeriod = 'last-30-days';
        const component = create();

        component.ngOnInit();

        expect(component.selectedPeriod.id).toEqual('last-30-days');
    });

    it('should fall back to all time for an unknown saved period', () => {
        settings.statisticsSelectedPeriod = 'nonsense';
        const component = create();

        component.ngOnInit();

        expect(component.selectedPeriod.id).toEqual('all-time');
    });

    it('should save the selected period and reload', () => {
        const component = create();
        component.ngOnInit();

        component.selectPeriod(statisticsPeriods[0]);

        expect(settings.statisticsSelectedPeriod).toEqual('last-7-days');
        statisticsServiceMock.verify((x) => x.getOverview(statisticsPeriods[0]), Times.once());
    });

    it('should report no data when nothing was listened to', () => {
        const component = create();
        component.ngOnInit();

        expect(component.hasData).toBeFalsy();
    });

    it('should reload when a track starts or playback stops', () => {
        const component = create();
        component.ngOnInit();

        started.next({});
        stopped.next();

        statisticsServiceMock.verify((x) => x.getOverview(It.isAny()), Times.exactly(3));
        component.ngOnDestroy();
    });

    it('should offer and load more history when a full page was returned', () => {
        statisticsServiceMock.reset();
        statisticsServiceMock.setup((x) => x.getOverview(It.isAny())).returns(() => emptyOverview);
        statisticsServiceMock.setup((x) => x.getHistory(It.isAny(), 0)).returns(() => historyItems(StatisticsService.historyPageSize));
        statisticsServiceMock.setup((x) => x.getHistory(It.isAny(), StatisticsService.historyPageSize)).returns(() => historyItems(3));
        const component = create();
        component.ngOnInit();

        expect(component.canLoadMoreHistory).toBeTruthy();
        expect(component.hasData).toBeTruthy();

        component.loadMoreHistory();

        expect(component.history.length).toEqual(StatisticsService.historyPageSize + 3);
        expect(component.canLoadMoreHistory).toBeFalsy();
    });

    describe('detailed statistics', () => {
        const details: DetailedStatistics = {
            ends: { completed: 3, skipped: 1, stopped: 0, averageCompletion: 0.8 },
            mostSkipped: [],
            alwaysFinished: [],
            heatmap: { cells: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)), maxMs: 1000 },
            barUnit: 'day',
            bars: [
                { startMs: 0, listenedMs: 0 },
                { startMs: 1, listenedMs: 500 },
                { startMs: 2, listenedMs: 1000 },
            ],
            barMaxMs: 1000,
            streaks: { currentDays: 2, longestDays: 5 },
        };

        beforeEach(() => {
            statisticsServiceMock.setup((x) => x.getDetails(It.isAny())).returns(() => details);
        });

        it('should not load detailed statistics while they are off', () => {
            const component = create();
            component.ngOnInit();

            expect(component.details).toBeUndefined();
            statisticsServiceMock.verify((x) => x.getDetails(It.isAny()), Times.never());
        });

        it('should turn detailed statistics on and off from the page and reload', () => {
            const component = create();
            component.ngOnInit();

            component.isDetailed = true;
            expect(settings.detailedListeningStatistics).toBe(true);
            expect(component.details).toBe(details);
            expect(component.hasDetails).toBe(true);

            component.isDetailed = false;
            expect(settings.detailedListeningStatistics).toBe(false);
            expect(component.details).toBeUndefined();
        });

        it('should scale bars and heat, and keep odd values on the page', () => {
            settings.detailedListeningStatistics = true;
            const component = create();
            component.ngOnInit();

            expect(details.bars.map((b) => component.barHeight(b))).toEqual([0, 50, 100]);
            expect(component.heat(0)).toEqual(0);
            expect(component.heat(1000)).toEqual(1);
            expect(component.heat(1)).toBeGreaterThan(0.15);
            expect([NaN, -1, 2, Infinity].map((x) => component.percent(x))).toEqual([0, 0, 100, 0]);
            expect(component.formatDate(undefined)).toEqual('');
            expect(component.formatDate(NaN)).toEqual('');
            expect(component.weekdays.length).toEqual(7);
        });

        it('should keep showing the page when loading detailed statistics fails', () => {
            statisticsServiceMock.reset();
            statisticsServiceMock.setup((x) => x.getOverview(It.isAny())).returns(() => emptyOverview);
            statisticsServiceMock.setup((x) => x.getHistory(It.isAny(), It.isAny())).returns(() => []);
            statisticsServiceMock.setup((x) => x.getDetails(It.isAny())).throws(new Error('database is locked'));
            settings.detailedListeningStatistics = true;
            const component = create();

            expect(() => component.ngOnInit()).not.toThrow();
        });
    });
});
