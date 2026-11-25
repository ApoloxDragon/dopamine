import { SettingsSearchEntry, settingsPageKeys, settingsSearchIndex } from './settings-search-index';

export interface SettingsSearchResult {
    entry: SettingsSearchEntry;
    /** The section title, in the app's language. */
    title: string;
    /** Where it is, for example "Behavior". */
    where: string;
    /** The setting that matched, when it was a setting and not the section title. */
    detail: string;
}

/** Finds sections of Settings (and Manage collection and the equalizer) from what the user typed. */
export class SettingsSearch {
    public static readonly maximumResults: number = 8;
    public static readonly maximumQueryLength: number = 100;

    public constructor(
        private translate: (key: string) => string,
        private platform: string,
        private index: SettingsSearchEntry[] = settingsSearchIndex,
    ) {}

    /** Lower case, no accents ("Música" -> "musica"), single spaces. */
    public static normalize(text: string | undefined): string {
        return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /** Every word typed must appear somewhere in the section (title, a setting or a search word). Best matches first. */
    public search(query: string | undefined): SettingsSearchResult[] {
        const wanted: string = SettingsSearch.normalize((query ?? '').slice(0, SettingsSearch.maximumQueryLength));
        const words: string[] = wanted.split(' ').filter((x) => x.length > 0);

        if (words.length === 0) {
            return [];
        }

        const scored: { result: SettingsSearchResult; score: number; order: number }[] = [];

        this.index.forEach((entry, order) => {
            if (entry.onlyOn !== undefined && entry.onlyOn !== this.platform) {
                return;
            }

            const title: string = this.safeTranslate(entry.sectionKey);
            const labels: string[] = entry.labelKeys.map((x) => this.safeTranslate(x));
            const normalizedTitle: string = SettingsSearch.normalize(title);
            const normalizedLabels: string[] = labels.map((x) => SettingsSearch.normalize(x));
            const everything: string = [
                normalizedTitle,
                ...normalizedLabels,
                ...entry.words.map((x) => SettingsSearch.normalize(x)),
                entry.sectionKey.replace(/-/g, ' '),
            ].join(' | ');

            if (!words.every((word) => everything.includes(word))) {
                return;
            }

            const labelIndex: number = normalizedLabels.findIndex((x) => x.includes(wanted));
            const score: number = normalizedTitle.startsWith(wanted) ? 4 : normalizedTitle.includes(wanted) ? 3 : labelIndex >= 0 ? 2 : 1;

            scored.push({
                result: {
                    entry,
                    title,
                    where: this.safeTranslate(settingsPageKeys[entry.place][entry.page] ?? entry.place),
                    detail: score <= 2 && labelIndex >= 0 ? labels[labelIndex] : '',
                },
                score,
                order,
            });
        });

        return scored
            .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.order - b.order))
            .slice(0, SettingsSearch.maximumResults)
            .map((x) => x.result);
    }

    private safeTranslate(key: string): string {
        try {
            const text: unknown = this.translate(key);
            return typeof text === 'string' && text.length > 0 ? text : key;
        } catch (e: unknown) {
            return key;
        }
    }
}

/**
 * Scrolls to a section once its page has appeared (pages slide in), and highlights it for a moment.
 * Gives up quietly after about a second when the section is not there (for example hidden on this computer).
 */
export function scrollToSettingsSection(document: Document, sectionKey: string, attemptsLeft: number = 20): void {
    if (!/^[a-z0-9-]+$/.test(sectionKey ?? '')) {
        return;
    }

    const element: Element | null = document.querySelector(`[data-settings-section="${sectionKey}"]`);

    if (element === null) {
        if (attemptsLeft > 0) {
            setTimeout(() => scrollToSettingsSection(document, sectionKey, attemptsLeft - 1), 50);
        }

        return;
    }

    element.scrollIntoView({ block: 'start', behavior: 'smooth' });
    element.classList.add('settings-search-found');
    setTimeout(() => element.classList.remove('settings-search-found'), 2000);
}

/** A jump to a section of a page that is not open yet (Manage collection), picked up when that page opens. */
export class SettingsJump {
    private static pending: { page: number; sectionKey: string } | undefined;

    public static request(page: number, sectionKey: string): void {
        SettingsJump.pending = { page, sectionKey };
    }

    /** The waiting jump, once. */
    public static take(): { page: number; sectionKey: string } | undefined {
        const pending = SettingsJump.pending;
        SettingsJump.pending = undefined;
        return pending;
    }
}
