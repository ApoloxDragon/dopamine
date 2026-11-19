import { Subject } from 'rxjs';
import { IMock, It, Mock, Times } from 'typemoq';
import { CollectionStatisticsComponent } from './collection-statistics.component';
import { StatisticsService, StatisticsOverview, ListeningHistoryItem } from '../../../../services/statistics/statistics.service';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { SettingsMock } from '../../../../testing/settings-mock';
import { Logger } from '../../../../common/logger';
import { statisticsPeriods } from '../../../../services/statistics/statistics-period';

describe('CollectionStatisticsComponent', () => {
    let statisticsServiceMock: IMock<StatisticsService>;
    let settings: SettingsMock;
    let started: Subject<unknown>;
    let stopped: Subject<void>;

    const emptyOverview: StatisticsOverview = {
        summary: { listenedMs: 0, plays: 0, distinctTracks: 0, distinctAlbums: 0, activeDays: 0 },
        topTracks: [],
        topAlbums: [],
        topArtists: [],
    };

    function historyItems(count: number): ListeningHistoryItem[] {
        return Array.from({ length: count }, (_, i) => ({
            startedAtMs: i,
            title: `T${i}`,
            artists: 'A',
            albumTitle: 'Al',
            listenedMs: 1000,
            isCountedAsPlay: true,
        }));
    }

    function create(): CollectionStatisticsComponent {
        const playbackService = { playbackStarted$: started.asObservable(), playbackStopped$: stopped.asObservable() } as unknown as PlaybackService;
        return new CollectionStatisticsComponent(statisticsServiceMock.object, playbackService, settings, Mock.ofType<Logger>().object);
    }

    beforeEach(() => {
        statisticsServiceMock = Mock.ofType<StatisticsService>();
        statisticsServiceMock.setup((x) => x.getOverview(It.isAny())).returns(() => emptyOverview);
        statisticsServiceMock.setup((x) => x.getHistory(It.isAny(), It.isAny())).returns(() => []);
        settings = new SettingsMock();
        started = new Subject();
        stopped = new Subject();
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
});
