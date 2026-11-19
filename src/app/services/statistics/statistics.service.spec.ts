import { IMock, It, Mock, Times } from 'typemoq';
import { ListeningSegment } from '../../data/entities/listening-segment';
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

        expect(history).toEqual([
            {
                listeningSessionId: 0,
                endReason: null,
                heardParts: [],
                startedAtMs: now,
                title: 'Duet',
                artists: 'A, B',
                albumTitle: 'Album',
                listenedMs: 1000,
                isCountedAsPlay: true,
            },
        ]);
        repositoryMock.verify((x) => x.getHistory(It.isAny(), It.isAny(), It.isAny()), Times.once());
        // No details recorded: the heard parts are not even looked up.
        repositoryMock.verify((x) => x.getSegments(It.isAny()), Times.never());
    });

    describe('detailed statistics', () => {
        const local = (y: number, m: number, d: number, h: number = 12): number => new Date(y, m - 1, d, h).getTime();

        it('should put listening time in the right weekday and hour, Monday first', () => {
            const monday9: number = local(2026, 11, 16, 9);
            const sunday23: number = local(2026, 11, 22, 23);

            const map = StatisticsService.heatmap([
                { startedAtMs: monday9, listenedMs: 1000 },
                { startedAtMs: monday9 + 60000, listenedMs: 2000 },
                { startedAtMs: sunday23, listenedMs: 500 },
            ]);

            expect(map.cells[0][9]).toEqual(3000);
            expect(map.cells[6][23]).toEqual(500);
            expect(map.maxMs).toEqual(3000);
        });

        it('should make one bar per day with empty days included, today last', () => {
            const today: number = local(2026, 11, 19, 15);
            const bars = StatisticsService.bars(
                [
                    { startedAtMs: local(2026, 11, 19, 1), listenedMs: 1000 },
                    { startedAtMs: local(2026, 11, 13, 23), listenedMs: 2000 },
                    { startedAtMs: local(2026, 11, 1), listenedMs: 9999 }, // before the period
                ],
                'day',
                7,
                today,
            );

            expect(bars.length).toEqual(7);
            expect(bars[6]).toEqual({ startMs: local(2026, 11, 19, 0), listenedMs: 1000 });
            expect(bars[0]).toEqual({ startMs: local(2026, 11, 13, 0), listenedMs: 2000 });
            expect(bars.slice(1, 6).every((b) => b.listenedMs === 0)).toBe(true);
        });

        it('should make one bar per month from the first listening for all time', () => {
            const bars = StatisticsService.bars(
                [
                    { startedAtMs: local(2025, 12, 31, 23), listenedMs: 1 },
                    { startedAtMs: local(2026, 11, 1, 0), listenedMs: 2 },
                ],
                'month',
                undefined,
                local(2026, 11, 19),
            );

            expect(bars.length).toEqual(12); // December 2025 to November 2026
            expect(bars[0]).toEqual({ startMs: local(2025, 12, 1, 0), listenedMs: 1 });
            expect(bars[11]).toEqual({ startMs: local(2026, 11, 1, 0), listenedMs: 2 });
        });

        it('should count streaks of consecutive days, and keep the current one alive until today ends', () => {
            const now: number = local(2026, 11, 19, 8);

            expect(StatisticsService.streaks(['2026-11-16', '2026-11-17', '2026-11-18'], now)).toEqual({ currentDays: 3, longestDays: 3 });
            expect(StatisticsService.streaks(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-19'], now)).toEqual({
                currentDays: 1,
                longestDays: 4,
            });
            expect(StatisticsService.streaks(['2026-11-10', '2026-11-11'], now)).toEqual({ currentDays: 0, longestDays: 2 });
        });

        it('should turn heard parts into fractions of the track', () => {
            const parts = StatisticsService.heardParts(
                [
                    { listeningSegmentId: 1, listeningSessionId: 1, startedAtMs: 0, fromMs: 0, toMs: 60000 },
                    { listeningSegmentId: 2, listeningSessionId: 1, startedAtMs: 0, fromMs: 180000, toMs: 240000 },
                ],
                240000,
            );

            expect(parts).toEqual([
                { from: 0, to: 0.25 },
                { from: 0.75, to: 1 },
            ]);
        });

        it('should load heard parts only for plays with details', () => {
            const withDetails = { listeningSessionId: 7, endReason: 2, trackDurationMs: 1000, artists: '', startedAtMs: 1 } as any;
            const without = { listeningSessionId: 8, endReason: null, trackDurationMs: 1000, artists: '', startedAtMs: 2 } as any;
            repositoryMock.setup((x) => x.getHistory(It.isAny(), It.isAny(), It.isAny())).returns(() => [withDetails, without]);
            repositoryMock
                .setup((x) => x.getSegments(It.isAny()))
                .returns(() => new Map([[7, [{ listeningSegmentId: 1, listeningSessionId: 7, startedAtMs: 1, fromMs: 0, toMs: 500 }]]]));

            const history = service.getHistory({ id: 'all-time', translationKey: 'all-time', days: undefined }, 0);

            repositoryMock.verify((x) => x.getSegments(It.is((ids: number[]) => ids.length === 1 && ids[0] === 7)), Times.once());
            expect(history[0].heardParts).toEqual([{ from: 0, to: 0.5 }]);
            expect(history[1].heardParts).toEqual([]);
            expect(history[1].endReason).toBeNull();
        });

        // Trying to break it.

        it('should ignore garbage entries in the heatmap and the bars', () => {
            const garbage: any[] = [
                { startedAtMs: NaN, listenedMs: 1000 },
                { startedAtMs: local(2026, 11, 16, 9), listenedMs: NaN },
                { startedAtMs: local(2026, 11, 16, 9), listenedMs: -5000 },
                { startedAtMs: Infinity, listenedMs: 1 },
                { startedAtMs: '2026-11-16', listenedMs: 1 },
                null,
                undefined,
            ];

            const map = StatisticsService.heatmap(garbage);
            const bars = StatisticsService.bars(garbage, 'month', undefined, local(2026, 11, 19));

            expect(map.maxMs).toEqual(0);
            expect(bars.length).toEqual(1);
            expect(bars[0].listenedMs).toEqual(0);
        });

        it('should not put entries from the future (clock changed) into bars', () => {
            const bars = StatisticsService.bars([{ startedAtMs: local(2030, 1, 1), listenedMs: 5000 }], 'day', 7, local(2026, 11, 19));

            expect(bars.every((b) => b.listenedMs === 0)).toBe(true);
        });

        it('should cap all-time bars when the history starts decades ago', () => {
            const bars = StatisticsService.bars([{ startedAtMs: local(1970, 1, 2), listenedMs: 1 }], 'month', undefined, local(2026, 11, 19));

            expect(bars.length).toEqual(StatisticsService.maximumBars);
        });

        it('should count streaks across daylight saving changes, month and year ends, and leap days', () => {
            expect(StatisticsService.streaks(['2026-03-28', '2026-03-29', '2026-03-30'], local(2026, 3, 30)).longestDays).toEqual(3); // EU DST
            expect(StatisticsService.streaks(['2026-03-07', '2026-03-08', '2026-03-09'], local(2026, 3, 9)).longestDays).toEqual(3); // US DST
            expect(StatisticsService.streaks(['2026-10-24', '2026-10-25', '2026-10-26'], local(2026, 10, 26)).longestDays).toEqual(3);
            expect(StatisticsService.streaks(['2025-12-31', '2026-01-01'], local(2026, 1, 1)).currentDays).toEqual(2);
            expect(StatisticsService.streaks(['2028-02-28', '2028-02-29', '2028-03-01'], local(2028, 3, 1)).currentDays).toEqual(3);
        });

        it('should ignore invalid, impossible, duplicate, unsorted and future days in streaks', () => {
            const now: number = local(2026, 11, 19);
            const days: string[] = ['2026-11-18', 'garbage', '', '2026-02-30', '2026-13-01', '2026-11-17', '2026-11-18', '2026-11-17', '2027-01-01', '2026-11-19'];

            expect(StatisticsService.streaks(days, now)).toEqual({ currentDays: 3, longestDays: 3 });
            expect(StatisticsService.streaks([], now)).toEqual({ currentDays: 0, longestDays: 0 });
        });

        it('should handle a very long streak quickly', () => {
            const days: string[] = [];
            for (let d = new Date(2000, 0, 1, 12); d.getTime() <= local(2026, 11, 19); d.setDate(d.getDate() + 1)) {
                days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
            }

            const started: number = Date.now();
            const result = StatisticsService.streaks(days, local(2026, 11, 19));

            expect(result.currentDays).toEqual(days.length);
            expect(result.longestDays).toEqual(days.length);
            expect(Date.now() - started).toBeLessThan(500);
        });

        it('should give no heard parts for tracks without a length, and keep parts within the track', () => {
            const part = (fromMs: number, toMs: number): ListeningSegment => ({ listeningSegmentId: 0, listeningSessionId: 0, startedAtMs: 0, fromMs, toMs });

            expect(StatisticsService.heardParts([part(0, 1000)], 0)).toEqual([]);
            expect(StatisticsService.heardParts([part(0, 1000)], NaN)).toEqual([]);
            expect(StatisticsService.heardParts([part(-500, 500), part(900, 5000), part(NaN, 1), part(700, 600), part(2000, 3000)], 1000)).toEqual([
                { from: 0, to: 0.5 },
                { from: 0.9, to: 1 },
            ]);
        });
    });
});
