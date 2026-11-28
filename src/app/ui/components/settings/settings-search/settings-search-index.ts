/**
 * Every section of Settings, Manage collection and the equalizer, for the search box in Settings.
 * The section title and setting labels are searched in the app's language; `words` are extra English search words
 * (other names people use for the same thing), so "eq", "tray" or "samba" find the right place in any language.
 * A spec checks that every section title in the templates is listed here.
 */
export type SettingsPlace = 'settings' | 'manage-collection' | 'equalizer';

export interface SettingsSearchEntry {
    place: SettingsPlace;
    /** Page (tab) inside the place. */
    page: number;
    /** Translation key of the section title; also the value of the title's data-settings-section attribute. */
    sectionKey: string;
    /** Translation keys of the settings in the section. */
    labelKeys: string[];
    words: string[];
    /** Only shown on this platform (process.platform). */
    onlyOn?: string;
    /** Only in development builds (DevBuild.isActive). */
    devOnly?: boolean;
}

/** Translation keys of the page names, per place. */
export const settingsPageKeys: Record<SettingsPlace, string[]> = {
    settings: ['appearance', 'behavior', 'advanced', 'online'],
    'manage-collection': ['music', 'refresh', 'artists-and-albums'],
    equalizer: ['equalizer'],
};

const entry = (
    place: SettingsPlace,
    page: number,
    sectionKey: string,
    labelKeys: string[],
    words: string[],
    onlyOn?: string,
): SettingsSearchEntry => ({ place, page, sectionKey, labelKeys, words, onlyOn });

export const settingsSearchIndex: SettingsSearchEntry[] = [
    // Settings, Appearance
    entry('settings', 0, 'theme', ['follow-system-theme', 'use-light-theme'], ['dark mode', 'light mode', 'night', 'colours']),
    entry(
        'settings',
        0,
        'color',
        ['follow-system-color', 'follow-album-cover-color', 'refresh-themes', 'add-more-themes'],
        ['accent', 'colour', 'themes'],
    ),
    entry('settings', 0, 'images', ['i-prefer-square-images'], ['covers', 'square', 'round', 'artwork']),
    entry('settings', 0, 'tracklist', ['compact-tracklist-view', 'compact-total-duration'], ['song list', 'compact', 'dense']),
    entry('settings', 0, 'title-bar', ['use-system-title-bar'], ['window', 'frame', 'decorations', 'titlebar']),
    entry('settings', 0, 'language', ['choose-language', 'add-more-languages'], ['translation', 'locale']),
    entry('settings', 0, 'text-size', ['choose-text-size'], ['font', 'zoom', 'bigger', 'smaller', 'scale']),
    entry(
        'settings',
        0,
        'pages',
        ['which-pages-should-be-visible'],
        ['tabs', 'hide', 'artists', 'genres', 'albums', 'tracks', 'playlists', 'folders', 'statistics'],
    ),
    entry(
        'settings',
        0,
        'progress-bar',
        ['show-wave-progress', 'use-thick-progress-and-volume-bars'],
        ['seek bar', 'waveform', 'volume bar'],
    ),
    entry('settings', 0, 'audio-visualizer', ['show-audio-visualizer'], ['spectrum', 'visualiser', 'fps', 'frame rate']),
    entry(
        'settings',
        0,
        'lyrics',
        ['show-rich-lyrics', 'rich-lyric-size', 'rich-lyric-count'],
        ['lyrics size', 'karaoke', 'synced lyrics'],
    ),

    // Settings, Behavior
    entry(
        'settings',
        1,
        'notification-area',
        [
            'show-icon-in-notification-area',
            'minimize-to-notification-area',
            'close-to-notification-area',
            'invert-notification-area-icon-color',
        ],
        ['tray', 'system tray', 'minimise', 'background', 'taskbar'],
    ),
    entry('settings', 1, 'dock', ['show-album-art-on-dock-icon'], ['macos', 'icon'], 'darwin'),
    entry('settings', 1, 'follow-song', ['jump-to-playing-song'], ['current song', 'scroll to song']),
    entry('settings', 1, 'scrolling', ['remember-scroll-position'], ['scroll position']),
    entry('settings', 1, 'rating', ['show-rating', 'save-rating-to-audio-files'], ['stars', 'tags']),
    entry(
        'settings',
        1,
        'love',
        ['show-love', 'smart-shuffle', 'continuous-play'],
        ['like', 'dislike', 'thumbs', 'heart', 'shuffle', 'autoplay', 'radio'],
    ),
    entry(
        'settings',
        1,
        'now-playing',
        ['keep-playback-controls-visible-on-now-playing-page', 'show-album-on-now-playing-page', 'show-year-on-now-playing-page'],
        ['full screen', 'fullscreen', 'cover player'],
    ),
    entry('settings', 1, 'playback-controls', ['show-stop-button'], ['buttons', 'stop']),
    entry('settings', 1, 'playback-state', ['remember-playback-state-after-restart'], ['resume', 'restore', 'queue', 'restart']),
    entry(
        'settings',
        1,
        'audio-output-device',
        ['audio-output-device-system-default'],
        ['speakers', 'headphones', 'sound card', 'dac', 'output', 'device'],
    ),
    entry('settings', 1, 'gapless-playback', ['enable-gapless-playback'], ['gap', 'silence', 'seamless', 'gapless']),
    entry('settings', 1, 'crossfade', ['use-crossfade', 'crossfade-duration'], ['fade', 'mix', 'transition']),
    entry(
        'settings',
        1,
        'fade-on-pause',
        ['enable-fade-on-pause', 'use-separate-fade-in-duration', 'fade-in-duration'],
        ['fade', 'fade out', 'fade in', 'pause', 'resume', 'stop'],
    ),
    entry(
        'settings',
        1,
        'replaygain-normalization',
        ['enable-replaygain-normalization', 'replaygain-mode', 'replaygain-preamp-db', 'replaygain-prevent-clipping'],
        ['loudness', 'volume', 'normalize', 'normalise', 'rsgain', 'loud', 'quiet', 'clipping'],
    ),
    entry('settings', 1, 'sort-prefixes', [], ['the', 'sorting', 'sort order', 'articles']),
    entry(
        'settings',
        1,
        'split-artists',
        ['symbols-to-split-multiple-artists', 'artists-to-never-split'],
        ['featuring', 'feat', 'separator', 'multiple artists'],
    ),

    // Settings, Advanced
    entry(
        'settings',
        2,
        'welcome-screen',
        ['show-welcome-screen-on-next-restart', 'show-welcome-screen-now'],
        ['intro', 'setup', 'first start'],
    ),
    entry('settings', 2, 'ratings-backup', ['restore-ratings-from-backup'], ['backup', 'restore', 'stars']),
    entry('settings', 2, 'log-file', ['view-log'], ['log', 'debug', 'problem', 'bug', 'error', 'crash']),
    { ...entry('settings', 2, 'developer-options', ['extra-logging'], ['dev', 'developer', 'debug', 'verbose', 'logging']), devOnly: true },

    // Settings, Online
    entry('settings', 3, 'updates', ['check-for-updates', 'also-check-for-pre-releases'], ['new version', 'release', 'beta', 'update']),
    entry('settings', 3, 'lyrics', ['download-lyrics-online'], ['download lyrics', 'internet']),
    entry(
        'settings',
        3,
        'discord',
        ['enable-discord-rich-presence', 'show-album-cover-in-discord'],
        ['rich presence', 'status', 'listening to'],
    ),
    entry(
        'settings',
        3,
        'last-fm',
        ['download-artist-information-from-lastfm', 'enable-last-fm-scrobbling'],
        ['lastfm', 'last.fm', 'scrobble', 'scrobbling', 'biography', 'account'],
    ),
    entry('settings', 3, 'listenbrainz', ['enable-listenbrainz-scrobbling'], ['scrobble', 'scrobbling', 'token', 'musicbrainz']),

    // Manage collection
    entry(
        'manage-collection',
        0,
        'folders',
        ['add-folders-with-your-music', 'look-for-network-drives', 'reconnect-network-drives'],
        [
            'library',
            'music folder',
            'add folder',
            'network',
            'samba',
            'smb',
            'nas',
            'server',
            'share',
            'lan',
            'nfs',
            'home server',
            'reconnect',
            'mount',
        ],
    ),
    entry(
        'manage-collection',
        1,
        'automatic-refresh',
        ['refresh-collection-automatically', 'show-refresh-notification-at-startup', 'skip-previously-removed-files', 'use-song-cache'],
        ['scan', 'rescan', 'index', 'startup', 'cache'],
    ),
    entry(
        'manage-collection',
        1,
        'manual-refresh',
        ['fast-refresh', 'full-refresh', 'refresh-replaygain'],
        ['scan now', 'rescan', 'update library'],
    ),
    entry(
        'manage-collection',
        2,
        'download-title',
        ['download-missing-album-covers', 'download-artist-images', 'show-artist-images-as-background'],
        ['covers', 'artwork', 'pictures', 'internet'],
    ),
    entry(
        'manage-collection',
        2,
        'refresh-covers',
        ['refresh-all-covers', 'overwrite-manually-edited-covers', 'refresh-missing-covers'],
        ['artwork', 'album art'],
    ),
    entry(
        'manage-collection',
        2,
        'refresh-artist-images',
        ['refresh-all-artist-images', 'overwrite-manually-edited-artist-images', 'refresh-missing-artist-images'],
        ['artist pictures', 'photos'],
    ),
    entry(
        'manage-collection',
        2,
        'grouping',
        [
            'albums-defined-by-tags-album-title-and-album-artist',
            'albums-defined-by-tag-album-title',
            'albums-defined-by-folders-on-computer',
        ],
        ['group albums', 'album grouping', 'cd1', 'cd2'],
    ),

    // Equalizer (a dialog)
    entry(
        'equalizer',
        0,
        'equalizer',
        ['enable-equalizer', 'equalizer-mode-graphic', 'equalizer-mode-parametric', 'equalizer-preamp'],
        ['eq', 'bass', 'treble', 'autoeq', 'preset', 'sound', 'headphones'],
    ),
];
