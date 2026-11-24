import { Injectable } from '@angular/core';
import { DateProxy } from '../../common/io/date-proxy';
import { ListeningSession } from '../../data/entities/listening-session';
import {
    ListeningEndSummary,
    ListeningSessionRepositoryBase,
    ListeningSkipTotal,
    ListeningSummary,
    ListeningTimeEntry,
    ListeningTotal,
} from '../../data/repositories/listening-session-repository.base';
import { ListeningSegment } from '../../data/entities/listening-segment';
import { DataDelimiter } from '../../data/data-delimiter';
import { StatisticsPeriod } from './statistics-period';

/** A heard part of a play, as fractions of the track (0-1), for drawing. */
export interface HeardPart {
    from: number;
    to: number;
}

export interface ListeningHistoryItem {
    listeningSessionId: number;
    /** ListeningEndReason, or null without detailed statistics. */
    endReason: number | null;
    /** Heard parts (detailed statistics); empty when unknown. */
    heardParts: HeardPart[];
    startedAtMs: number;
    title: string;
    artists: string;
    albumTitle: string;
    listenedMs: number;
    isCountedAsPlay: boolean;
}

/** Listening time per weekday (0 = Monday) and hour (0-23), local time. */
export interface ListeningHeatmap {
    cells: number[][];
    maxMs: number;
}

export interface ListeningBar {
    /** Start of the day or month, local time (Unix milliseconds). */
    startMs: number;
    listenedMs: number;
}

export interface ListeningStreaks {
    /** Days in a row with listening, up to today (or yesterday, if nothing was played yet today). */
    currentDays: number;
    longestDays: number;
}

export interface DetailedStatistics {
    ends: ListeningEndSummary;
    mostSkipped: ListeningSkipTotal[];
    alwaysFinished: ListeningSkipTotal[];
    heatmap: ListeningHeatmap;
    barUnit: 'day' | 'month';
    bars: ListeningBar[];
    barMaxMs: number;
    streaks: ListeningStreaks;
}

export interface StatisticsOverview {
    summary: ListeningSummary;
    topTracks: ListeningTotal[];
    topAlbums: ListeningTotal[];
    topArtists: ListeningTotal[];
}

/** The year so far (or the whole year from December), like "Wrapped" but only on this computer. */
export interface YearInReview {
    year: number;
    /** True from December: the year is (nearly) complete. */
    isYearEnd: boolean;
    summary: ListeningSummary;
    topTracks: ListeningTotal[];
    topAlbums: ListeningTotal[];
    topArtists: ListeningTotal[];
    /** The day with the most listening time (local date, YYYY-MM-DD). */
    mostPlayedDay: { day: string; listenedMs: number } | undefined;
    longestStreakDays: number;
    /** When the first song of the year was played. */
    firstListenMs: number | undefined;
}

/** Reads the listening history recorded by ListeningTrackerService, for the Statistics page. */
@Injectable({ providedIn: 'root' })
export class StatisticsService {
    public static readonly yearInReviewListSize: number = 5;

    public static readonly topListSize: number = 10;
    public static readonly historyPageSize: number = 50;
    /** A day counts for streaks with at least this much listening. */
    public static readonly streakMinimumMs: number = 60 * 1000;
    /** At most this many bars (months) for all time. */
    public static readonly maximumBars: number = 120;
    private static readonly dayMs: number = 24 * 60 * 60 * 1000;

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

    /** Detailed statistics for the period (skips, when you listen, streaks). */
    public getDetails(period: StatisticsPeriod): DetailedStatistics {
        const sinceMs: number = this.getSinceMs(period);
        const times: ListeningTimeEntry[] = this.repository.getListeningTimes(sinceMs);
        const barUnit: 'day' | 'month' = period.days != undefined && period.days <= 31 ? 'day' : 'month';
        const bars: ListeningBar[] = StatisticsService.bars(times, barUnit, period.days, this.dateProxy.now());

        return {
            ends: this.repository.getEndSummary(sinceMs),
            mostSkipped: this.repository.getMostSkipped(sinceMs, StatisticsService.topListSize),
            alwaysFinished: this.repository.getAlwaysFinished(sinceMs, StatisticsService.topListSize),
            heatmap: StatisticsService.heatmap(times),
            barUnit,
            bars,
            barMaxMs: bars.reduce((max, b) => Math.max(max, b.listenedMs), 0),
            streaks: StatisticsService.streaks(this.repository.getActiveDays(StatisticsService.streakMinimumMs), this.dateProxy.now()),
        };
    }

    /** The current year in review, or undefined when nothing was played this year. */
    public getYearInReview(): YearInReview | undefined {
        const now: Date = new Date(this.dateProxy.now());
        const year: number = now.getFullYear();
        const sinceMs: number = new Date(year, 0, 1).getTime();
        const summary: ListeningSummary = this.repository.getSummary(sinceMs);

        if (!(summary?.listenedMs > 0)) {
            return undefined;
        }

        const times: ListeningTimeEntry[] = this.repository.getListeningTimes(sinceMs).filter((t) => StatisticsService.isValidTime(t));
        const days: string[] = this.repository.getActiveDays(StatisticsService.streakMinimumMs).filter((d) => d.startsWith(`${year}-`));

        return {
            year,
            isYearEnd: now.getMonth() === 11,
            summary,
            topTracks: this.repository.getTopTracks(sinceMs, StatisticsService.yearInReviewListSize),
            topAlbums: this.repository.getTopAlbums(sinceMs, StatisticsService.yearInReviewListSize),
            topArtists: this.repository.getTopArtists(sinceMs, StatisticsService.yearInReviewListSize),
            mostPlayedDay: StatisticsService.mostPlayedDay(times),
            longestStreakDays: StatisticsService.streaks(days, this.dateProxy.now()).longestDays,
            firstListenMs: times.length > 0 ? times.reduce((first, t) => Math.min(first, t.startedAtMs), Infinity) : undefined,
        };
    }

    /** The local day with the most listening time. Ties go to the earlier day. */
    public static mostPlayedDay(times: ListeningTimeEntry[]): { day: string; listenedMs: number } | undefined {
        const perDay: Map<string, number> = new Map();

        for (const t of times) {
            if (!StatisticsService.isValidTime(t)) {
                continue;
            }

            const date: Date = new Date(t.startedAtMs);
            const day: string = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            perDay.set(day, (perDay.get(day) ?? 0) + t.listenedMs);
        }

        let best: { day: string; listenedMs: number } | undefined;

        for (const [day, listenedMs] of [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            if (best === undefined || listenedMs > best.listenedMs) {
                best = { day, listenedMs };
            }
        }

        return best;
    }

    /** Listening time per weekday and hour (local time). Entries that are not valid are left out. */
    public static heatmap(times: ListeningTimeEntry[]): ListeningHeatmap {
        const cells: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
        let maxMs: number = 0;

        for (const t of times) {
            if (!StatisticsService.isValidTime(t)) {
                continue;
            }

            const date: Date = new Date(t.startedAtMs);
            const weekday: number = (date.getDay() + 6) % 7; // Monday first
            const hour: number = date.getHours();
            cells[weekday][hour] += t.listenedMs;
            maxMs = Math.max(maxMs, cells[weekday][hour]);
        }

        return { cells, maxMs };
    }

    /**
     * Listening time per day (the last `days` days, including today) or per month (the last 12 months for a year,
     * from the first listening for all time, at most maximumBars). Days and months without listening are included.
     */
    public static bars(times: ListeningTimeEntry[], unit: 'day' | 'month', days: number | undefined, nowMs: number): ListeningBar[] {
        const valid: ListeningTimeEntry[] = times.filter((t) => StatisticsService.isValidTime(t) && t.startedAtMs <= nowMs);
        const now: Date = new Date(nowMs);
        const starts: number[] = [];

        if (unit === 'day') {
            const count: number = Math.max(1, Math.min(days ?? 31, 31));
            for (let i = count - 1; i >= 0; i--) {
                starts.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i).getTime());
            }
        } else {
            const first: number = valid.reduce((min, t) => Math.min(min, t.startedAtMs), nowMs);
            const firstDate: Date = new Date(first);
            let months: number =
                days == undefined ? (now.getFullYear() - firstDate.getFullYear()) * 12 + now.getMonth() - firstDate.getMonth() + 1 : 12;
            months = Math.max(1, Math.min(months, StatisticsService.maximumBars));
            for (let i = months - 1; i >= 0; i--) {
                starts.push(new Date(now.getFullYear(), now.getMonth() - i, 1).getTime());
            }
        }

        const bars: ListeningBar[] = starts.map((startMs) => ({ startMs, listenedMs: 0 }));

        for (const t of valid) {
            // The last bar that starts at or before the entry.
            let index: number = -1;
            for (let i = bars.length - 1; i >= 0; i--) {
                if (bars[i].startMs <= t.startedAtMs) {
                    index = i;
                    break;
                }
            }
            if (index >= 0) {
                bars[index].listenedMs += t.listenedMs;
            }
        }

        return bars;
    }

    /** Current and longest run of consecutive days, from local days as YYYY-MM-DD (any order, duplicates allowed). */
    public static streaks(days: string[], nowMs: number): ListeningStreaks {
        // Day numbers counted from local noon, so daylight saving changes cannot shift them.
        const toNumber = (day: string): number | undefined => {
            const match: RegExpExecArray | null = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
            if (match == undefined) {
                return undefined;
            }
            const date: Date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
            const isRealDate: boolean = date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
            return isRealDate ? Math.round(date.getTime() / StatisticsService.dayMs) : undefined;
        };
        const now: Date = new Date(nowMs);
        const today: number = Math.round(
            new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime() / StatisticsService.dayMs,
        );
        const numbers: number[] = [...new Set(days.map(toNumber).filter((n): n is number => n != undefined && n <= today))].sort(
            (a, b) => a - b,
        );

        let longest: number = 0;
        let run: number = 0;
        for (let i = 0; i < numbers.length; i++) {
            run = i > 0 && numbers[i] === numbers[i - 1] + 1 ? run + 1 : 1;
            longest = Math.max(longest, run);
        }

        const last: number | undefined = numbers[numbers.length - 1];
        const current: number = last != undefined && today - last <= 1 ? run : 0;

        return { currentDays: current, longestDays: longest };
    }

    private static isValidTime(t: ListeningTimeEntry): boolean {
        return Number.isFinite(t?.startedAtMs) && Number.isFinite(t?.listenedMs) && t.listenedMs > 0;
    }

    public getHistory(period: StatisticsPeriod, offset: number): ListeningHistoryItem[] {
        const sessions: ListeningSession[] = this.repository.getHistory(this.getSinceMs(period), StatisticsService.historyPageSize, offset);
        const withDetails: number[] = sessions.filter((s) => s.endReason != undefined).map((s) => s.listeningSessionId);
        const parts: Map<number, ListeningSegment[]> =
            withDetails.length > 0 ? this.repository.getSegments(withDetails) : new Map<number, ListeningSegment[]>();

        return sessions.map((s: ListeningSession) => ({
            listeningSessionId: s.listeningSessionId,
            endReason: s.endReason ?? null,
            heardParts: StatisticsService.heardParts(parts.get(s.listeningSessionId) ?? [], s.trackDurationMs),
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

    /** Heard parts as fractions of the track, kept within 0-1. Nothing for a track without a known length. */
    public static heardParts(parts: ListeningSegment[], durationMs: number): HeardPart[] {
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return [];
        }

        const clamp = (x: number): number => Math.min(1, Math.max(0, x / durationMs));

        return parts
            .filter((p) => Number.isFinite(p.fromMs) && Number.isFinite(p.toMs) && p.toMs > p.fromMs)
            .map((p) => ({ from: clamp(p.fromMs), to: clamp(p.toMs) }))
            .filter((p) => p.to > p.from);
    }
}
