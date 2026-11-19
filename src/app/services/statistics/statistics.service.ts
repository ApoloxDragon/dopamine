import { Injectable } from '@angular/core';
import { DateProxy } from '../../common/io/date-proxy';
import { ListeningSession } from '../../data/entities/listening-session';
import { ListeningSessionRepositoryBase, ListeningSummary, ListeningTotal } from '../../data/repositories/listening-session-repository.base';
import { DataDelimiter } from '../../data/data-delimiter';
import { StatisticsPeriod } from './statistics-period';

export interface ListeningHistoryItem {
    startedAtMs: number;
    title: string;
    artists: string;
    albumTitle: string;
    listenedMs: number;
    isCountedAsPlay: boolean;
}

export interface StatisticsOverview {
    summary: ListeningSummary;
    topTracks: ListeningTotal[];
    topAlbums: ListeningTotal[];
    topArtists: ListeningTotal[];
}

/** Reads the listening history recorded by ListeningTrackerService, for the Statistics page. */
@Injectable({ providedIn: 'root' })
export class StatisticsService {
    public static readonly topListSize: number = 10;
    public static readonly historyPageSize: number = 50;

    public constructor(
        private repository: ListeningSessionRepositoryBase,
        private dateProxy: DateProxy,
    ) {}

    public getSinceMs(period: StatisticsPeriod): number {
        return period.days == undefined ? 0 : this.dateProxy.now() - period.days * 24 * 60 * 60 * 1000;
    }

    public getOverview(period: StatisticsPeriod): StatisticsOverview {
        const sinceMs: number = this.getSinceMs(period);

        return {
            summary: this.repository.getSummary(sinceMs),
            topTracks: this.repository.getTopTracks(sinceMs, StatisticsService.topListSize),
            topAlbums: this.repository.getTopAlbums(sinceMs, StatisticsService.topListSize),
            topArtists: this.repository.getTopArtists(sinceMs, StatisticsService.topListSize),
        };
    }

    public getHistory(period: StatisticsPeriod, offset: number): ListeningHistoryItem[] {
        return this.repository
            .getHistory(this.getSinceMs(period), StatisticsService.historyPageSize, offset)
            .map((s: ListeningSession) => ({
                startedAtMs: s.startedAtMs,
                title: s.trackTitle,
                artists: DataDelimiter.fromDelimitedString(s.artists)
                    .filter((x) => x.trim().length > 0)
                    .join(', '),
                albumTitle: s.albumTitle,
                listenedMs: s.listenedMs,
                isCountedAsPlay: s.isCountedAsPlay === 1,
            }));
    }
}
