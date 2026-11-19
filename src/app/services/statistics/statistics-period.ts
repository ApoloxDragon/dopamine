/** Rolling periods (not calendar weeks/months), so they do not depend on the first day of the week. */
export interface StatisticsPeriod {
    id: string;
    translationKey: string;
    /** undefined = all time */
    days: number | undefined;
}

export const statisticsPeriods: StatisticsPeriod[] = [
    { id: 'last-7-days', translationKey: 'last-7-days', days: 7 },
    { id: 'last-30-days', translationKey: 'last-30-days', days: 30 },
    { id: 'last-365-days', translationKey: 'last-365-days', days: 365 },
    { id: 'all-time', translationKey: 'all-time', days: undefined },
];
