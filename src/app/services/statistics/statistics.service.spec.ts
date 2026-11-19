import { IMock, It, Mock, Times } from 'typemoq';
import { StatisticsService } from './statistics.service';
import { ListeningSessionRepositoryBase } from '../../data/repositories/listening-session-repository.base';
import { DateProxy } from '../../common/io/date-proxy';
import { statisticsPeriods } from './statistics-period';
import { ListeningSession } from '../../data/entities/listening-session';

describe('StatisticsService', () => {
    const now: number = 1_700_000_000_000;
    const day: number = 24 * 60 * 60 * 1000;
    let repositoryMock: IMock<ListeningSessionRepositoryBase>;
    let service: StatisticsService;

    beforeEach(() => {
        repositoryMock = Mock.ofType<ListeningSessionRepositoryBase>();
        service = new StatisticsService(repositoryMock.object, { now: (): number => now } as DateProxy);
    });

    it('should use rolling periods', () => {
        expect(service.getSinceMs(statisticsPeriods[0])).toEqual(now - 7 * day);
        expect(service.getSinceMs(statisticsPeriods[1])).toEqual(now - 30 * day);
        expect(service.getSinceMs(statisticsPeriods[2])).toEqual(now - 365 * day);
        expect(service.getSinceMs(statisticsPeriods[3])).toEqual(0);
    });

    it('should query summary and top lists for the period', () => {
        service.getOverview(statisticsPeriods[0]);

        const since: number = now - 7 * day;
        repositoryMock.verify((x) => x.getSummary(since), Times.once());
        repositoryMock.verify((x) => x.getTopTracks(since, StatisticsService.topListSize), Times.once());
        repositoryMock.verify((x) => x.getTopAlbums(since, StatisticsService.topListSize), Times.once());
        repositoryMock.verify((x) => x.getTopArtists(since, StatisticsService.topListSize), Times.once());
    });

    it('should page the history and join artists', () => {
        const s: ListeningSession = new ListeningSession();
        s.trackTitle = 'Duet';
        s.artists = ';A;;B;';
        s.albumTitle = 'Album';
        s.startedAtMs = now;
        s.listenedMs = 1000;
        s.isCountedAsPlay = 1;
        repositoryMock.setup((x) => x.getHistory(0, StatisticsService.historyPageSize, 50)).returns(() => [s]);

        const history = service.getHistory(statisticsPeriods[3], 50);

        expect(history).toEqual([{ startedAtMs: now, title: 'Duet', artists: 'A, B', albumTitle: 'Album', listenedMs: 1000, isCountedAsPlay: true }]);
        repositoryMock.verify((x) => x.getHistory(It.isAny(), It.isAny(), It.isAny()), Times.once());
    });
});
