import * as fs from 'fs';
import * as path from 'path';
import { SettingsJump, SettingsSearch, scrollToSettingsSection } from './settings-search';
import { settingsPageKeys, settingsSearchIndex } from './settings-search-index';

const english: Record<string, string> = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../../assets/i18n/en.json'), 'utf8'));
const translate = (key: string): string => english[key] ?? key;
const search = (query: string, platform: string = 'linux') => new SettingsSearch(translate, platform).search(query);
const firstKey = (query: string): string | undefined => search(query)[0]?.entry.sectionKey;

describe('SettingsSearch', () => {
    it.each([
        ['fade', 'fade-on-pause'],
        ['crossfade', 'crossfade'],
        ['network', 'folders'],
        ['samba', 'folders'],
        ['equalizer', 'equalizer'],
        ['eq', 'equalizer'],
        ['tray', 'notification-area'],
        ['replaygain', 'replaygain-normalization'],
        ['loudness', 'replaygain-normalization'],
        ['dark mode', 'theme'],
        ['discord', 'discord'],
        ['scrobble', 'last-fm'],
        ['smart shuffle', 'love'],
        ['gapless', 'gapless-playback'],
        ['font', 'text-size'],
        ['cover', 'refresh-covers'],
        ['square', 'images'],
        ['log', 'log-file'],
        ['fast refresh', 'manual-refresh'],
    ])('the regular customer: "%s" finds %s first', (query, sectionKey) => {
        expect(firstKey(query)).toBe(sectionKey);
    });

    it('should find a section by a setting inside it, and say which setting', () => {
        const results = search('jump to the playing song');

        expect(results[0].entry.sectionKey).toBe('follow-song');
        expect(results[0].detail).toBe(english['jump-to-playing-song']);
        expect(results[0].where).toBe(english['behavior']);
    });

    it('should not repeat the section title as the detail', () => {
        expect(search('crossfade')[0].detail).toBe('');
    });

    it('should find both lyrics sections, each on its own page', () => {
        const lyrics = search('lyrics').filter((x) => x.entry.sectionKey === 'lyrics');

        expect(lyrics.map((x) => x.entry.page).sort()).toEqual([0, 3]);
    });

    it('should search in the app language, and still know the English words', () => {
        const spanish: Record<string, string> = {
            crossfade: 'Fundido cruzado',
            'fade-on-pause': 'Fundido al pausar',
            behavior: 'Comportamiento',
        };
        const inSpanish = new SettingsSearch((key) => spanish[key] ?? key, 'linux');

        expect(inSpanish.search('fundido').map((x) => x.entry.sectionKey)).toEqual(['crossfade', 'fade-on-pause']);
        expect(inSpanish.search('fade').length).toBeGreaterThan(0);
        expect(inSpanish.search('fundido')[0].where).toBe('Comportamiento');
    });

    it('should ignore accents and capitals', () => {
        const words = new SettingsSearch((key) => (key === 'folders' ? 'Música' : key), 'linux');

        expect(words.search('MUSICA')[0].entry.sectionKey).toBe('folders');
        expect(words.search('música')[0].entry.sectionKey).toBe('folders');
    });

    it('should only show the dock on macOS', () => {
        expect(search('dock', 'linux').map((x) => x.entry.sectionKey)).not.toContain('dock');
        expect(search('dock', 'darwin').map((x) => x.entry.sectionKey)).toContain('dock');
    });

    it('should need every word typed', () => {
        expect(search('fade discord')).toEqual([]);
    });

    // Trying to break it.

    it.each([[''], ['   '], ['\n\t'], [undefined as unknown as string], [null as unknown as string]])(
        'should find nothing for nothing (%p)',
        (query) => {
            expect(search(query)).toEqual([]);
        },
    );

    it.each([
        ['nonsense', 'zzqxj'],
        ['a regular expression', '.*'],
        ['brackets', '[(*+?'],
        ['an HTML tag', '<img src=x onerror=alert(1)>'],
        ['a selector', '"] , * , [x="'],
        ['emoji', '🦎🍺'],
        ['a NUL', 'fa\0de'],
    ])('should find nothing, and not crash, for %s', (_, query) => {
        expect(search(query)).toEqual([]);
    });

    it('should cope with a 100 000 character query quickly', () => {
        const start = Date.now();

        expect(search('fade '.repeat(20000)).length).toBeGreaterThan(0);
        expect(Date.now() - start).toBeLessThan(500);
    });

    it('should never show more than a handful of results', () => {
        expect(search('e').length).toBe(SettingsSearch.maximumResults);
    });

    it('should survive a translator that throws or gives nothing', () => {
        const broken = new SettingsSearch((key) => {
            if (key === 'crossfade') {
                throw new Error('no translations yet');
            }
            return undefined as unknown as string;
        }, 'linux');

        expect(broken.search('crossfade')[0].title).toBe('crossfade');
    });
});

describe('settingsSearchIndex', () => {
    const templates: [string, string, number][] = [
        ['settings', 'appearance-settings', 0],
        ['settings', 'behavior-settings', 1],
        ['settings', 'advanced-settings', 2],
        ['settings', 'online-settings', 3],
        ['manage-collection', 'manage-music', 0],
        ['manage-collection', 'manage-refresh', 1],
        ['manage-collection', 'manage-albums', 2],
    ];
    const componentsDirectory = path.join(__dirname, '../../');
    const folderOf = (place: string, name: string): string =>
        path.join(componentsDirectory, place === 'settings' ? 'settings' : 'manage-collection', name, `${name}.component.html`);

    it.each(templates)('should list every section of %s/%s, on the right page', (place, name, page) => {
        const html = fs.readFileSync(folderOf(place, name), 'utf8');
        const inTemplate = (html.match(/data-settings-section="[a-z0-9-]+"/g) ?? []).map((x) => x.split('"')[1]).sort();
        const inIndex = settingsSearchIndex
            .filter((x) => x.place === place && x.page === page)
            .map((x) => x.sectionKey)
            .sort();

        expect(inTemplate.length).toBeGreaterThan(0);
        expect(inIndex).toEqual(inTemplate);
    });

    it('should give every section title a jump target', () => {
        for (const [place, name] of templates) {
            const html = fs.readFileSync(folderOf(place, name), 'utf8');
            expect(html).not.toMatch(/<div class="title">/);
        }
    });

    it('should only use keys that have an English text', () => {
        const keys = settingsSearchIndex.flatMap((x) => [x.sectionKey, ...x.labelKeys]);
        keys.push(...Object.values(settingsPageKeys).flat(), 'search-settings', 'no-settings-found');

        expect(keys.filter((x) => english[x] === undefined)).toEqual([]);
    });

    it('should have a page name for every page used', () => {
        for (const x of settingsSearchIndex) {
            expect(settingsPageKeys[x.place][x.page]).toBeDefined();
        }
    });
});

describe('scrollToSettingsSection', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('should wait for the page to slide in, then scroll and highlight for a moment', () => {
        document.body.innerHTML = '';
        scrollToSettingsSection(document, 'crossfade');

        document.body.innerHTML = '<div data-settings-section="crossfade"></div>';
        const element = document.body.firstElementChild!;
        element.scrollIntoView = jest.fn();
        jest.advanceTimersByTime(60);

        expect(element.scrollIntoView).toHaveBeenCalledTimes(1);
        expect(element.classList.contains('settings-search-found')).toBe(true);

        jest.advanceTimersByTime(2100);
        expect(element.classList.contains('settings-search-found')).toBe(false);
    });

    it('should give up quietly on a section that never appears', () => {
        document.body.innerHTML = '';
        scrollToSettingsSection(document, 'dock');

        jest.advanceTimersByTime(5000);

        expect(jest.getTimerCount()).toBe(0);
    });

    it.each([['"] , body , [x="'], ['../x'], [''], [undefined as unknown as string]])('should ignore a strange section name %p', (key) => {
        document.body.innerHTML = '<div data-settings-section="x"></div>';

        expect(() => scrollToSettingsSection(document, key)).not.toThrow();
        expect(jest.getTimerCount()).toBe(0);
    });
});

describe('SettingsJump', () => {
    it('should hand over a jump once', () => {
        SettingsJump.request(1, 'manual-refresh');

        expect(SettingsJump.take()).toEqual({ page: 1, sectionKey: 'manual-refresh' });
        expect(SettingsJump.take()).toBeUndefined();
    });

    it('should keep only the last jump asked for', () => {
        SettingsJump.request(0, 'folders');
        SettingsJump.request(2, 'grouping');

        expect(SettingsJump.take()).toEqual({ page: 2, sectionKey: 'grouping' });
    });
});
