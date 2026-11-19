# CUE sheet support: development log

A general overview of what was added and changed while adding single-file-album (`.flac`/`.wav` + `.cue`) support.
This is **not** a replacement for the git history. It records intent and impact in plain language.
Newest entries are at the bottom. Add entries with `scripts/dev/devlog.sh`.

Entry kinds: `Added`, `Changed`, `Fixed`, `Tooling`, `Note`. Anything uncertain or risky goes in [DRAFTS.md](DRAFTS.md) first.

## Design summary

- A CUE album is expanded into one **virtual track** per `TRACK` entry. The audio file is never modified or split.
- Each virtual track has a unique identity path of the form `<audio file path>|<track number>` (for example `/music/Oracles.flac|3`),
  so queue, play statistics and playlists keep working as they key on path.
- Each virtual track also stores the real audio file path plus a start and end offset in milliseconds.
- A track ends where the next one starts (`INDEX 01`), so pregap audio is never dropped. The last track ends at the end of the file.
- Time format is `mm:ss:ff` with 75 frames per second.

## How to verify

| What | Command |
| --- | --- |
| Unit tests for everything touched | `scripts/dev/check.sh main/background-work src/app/services src/app/common` |
| Indexing scenarios (10, real worker pipeline) | `scripts/dev/cue-scenarios.sh` |
| Playback in real Chromium (16 checks) | `node scripts/dev/playback-harness/run.js` |
| Index a folder and print the tracks | `node scripts/dev/index-sandbox.js <music-folder> [db-file]` |

The scenario and playback tools need `ffmpeg` and `better-sqlite3` built for Node (`npm rebuild better-sqlite3`).
None of this replaces trying it in the app with real albums: see "Testing in the app" below.

## Testing in the app

1. Build or run the app from this branch. The database is migrated automatically (Migration15 only adds columns).
2. Point a collection folder at a few single-file albums with `.cue` sheets and refresh the collection.
3. Check: each album shows its tracks with the sheet's titles and lengths; the long whole-file track is gone.
4. Play an album from the first track and listen across track boundaries. There should be no gap or click.
5. Seek inside a track, skip to the next and previous track, pause and resume, restart the app (it should resume at the same spot).
6. Try with gapless playback and crossfade turned on and off in the settings.
7. Try deleting or editing a CUE track: both are blocked (see DRAFTS D1).

## Log

- **2026-11-18** · `Tooling` · Added dev scripts in scripts/dev
    - check.sh: quiet jest/tsc runner
    - fixtures.sh: generates a synthetic FLAC/WAV + CUE album with ffmpeg
    - save.sh: commit with trailers and push with retries
    - devlog.sh: appends to this log

- **2026-11-18** · `Added` · CUE parser (main/background-work/indexing/cue-parser.js)
    - Decodes UTF-8/UTF-16/Windows-1252, parses REM/PERFORMER/TITLE/FILE/TRACK/INDEX, converts mm:ss:ff at 75 fps, builds track ranges

- **2026-11-18** · `Fixed` · CUE parser: TextDecoder now taken from Node util (works in jest and the worker), Latin-1 fallback

- **2026-11-18** · `Added` · CUE parser spec (31 tests) built from 3 real EAC sheets plus edge cases
    - Verified against all 4 uploaded sheets (Oracles 10, Mafia 5, Veleno 13, Agony 11 tracks) and the ffmpeg fixture

- **2026-11-18** · `Changed` · Database: Migration15 adds Track.AudioPath, CuePath, CueStartMs, CueEndMs (+ index on AudioPath)
    - Additive only (ALTER TABLE ADD COLUMN). Existing rows keep NULL and are treated as normal tracks.
    - Track entity (TS and worker JS), select query parts and both track repositories read and write the new columns.
    - Risk: low. Migrations cannot be rolled back, but adding nullable columns does not change existing data.

- **2026-11-18** · `Tooling` · scripts/dev/db-sandbox.js builds a SQLite db from the real migrations for repository checks
    - Requires better-sqlite3 built for Node (npm rebuild better-sqlite3)

- **2026-11-18** · `Added` · Worker indexing of CUE albums
    - cue-track-path.js: virtual path helpers ('<audio file>|<track number>')
    - cue-sheet-reader.js: reads and caches sheets, resolves the FILE line to an audio file on disk (see DRAFTS D7)
    - IndexablePathFetcher emits one path per cue track and skips the covered album file (DRAFTS D3)
    - TrackFiller reads tags from the real album file, then applies sheet values (title, performer, album, album artist, genre, year, number, count, start/end, duration). Lyrics and file rating are not copied to cue tracks.
    - TrackVerifier checks the album file and the sheet for changes; TrackRemover keeps cue tracks while file, sheet and track number exist
    - TrackAdder replaces an old whole-file row by the cue tracks (database row only, never the file)
    - All new constructor arguments are optional and last, so existing behaviour and the 152 existing tests are unchanged

- **2026-11-18** · `Fixed` · Whole-file track stayed listed until a second re-index after adding a sheet (indexer runs remove before add); TrackAdder now replaces it immediately

- **2026-11-18** · `Tooling` · index-sandbox.js runs the real indexing pipeline on a folder; cue-scenarios.sh runs 10 end-to-end scenarios; db-sandbox.js now reopens existing files
    - Verified with the real Oracles and Veleno sheets next to silent FLACs of album length

- **2026-11-18** · `Added` · Renderer understands CUE tracks
    - TrackModel: isCueTrack, audioPath, cueStartSeconds, cueEndSeconds; src/app/common/utils/cue-track-path.ts mirrors the worker helper
    - Artwork (album/track image, artwork indexing) and 'show in folder' use the real album file
    - File lyrics (embedded, .lrc, .srt) are not used for CUE tracks: they belong to the whole album

- **2026-11-18** · `Changed` · Safety guard for CUE tracks (minimal part of DRAFTS D1)
    - Delete skips CUE tracks (no file or row removed) and reports the existing error
    - Edit tracks shows a new message (en.json key cue-tracks-cannot-be-edited) instead of writing tags into the shared file
    - Album artwork embedding writes once per real file
    - Risk: low, it only blocks actions. Explained in DRAFTS D1.

- **2026-11-18** · `Tooling` · Downloaded the Electron binary (node node_modules/electron/install.js) so renderer specs that import electron can run

- **2026-11-18** · `Added` · Playback of CUE tracks
    - LegacyAudioPlayer: CUE branch (only for CUE tracks) streams the album file, seeks to the track start, reports progress/length/seek relative to the track, detects the track end (50 ms check, file 'ended' for the last track)
    - Gapless within an album: at a boundary the audio keeps playing; when the next track is the adjacent range of the same file it is neither reloaded nor seeked
    - Overrun guard: if nothing takes over within 1 s after a track ends, the audio pauses
    - CueAwareAudioPlayer (new) routes CUE tracks to a streaming player and other tracks to the configured player; AudioPlayerFactory wraps every player in it (DRAFTS D2)
    - Risk: medium. Touches the audio path. Normal tracks run the unchanged code path; the CUE path is covered by 16 real-browser checks and 11 router unit tests

- **2026-11-18** · `Tooling` · scripts/dev/playback-harness: bundles the real players with esbuild and plays the ffmpeg fixture in headless Chromium
    - Checks relative progress/seek, restore, overrun guard, router switching and gapless continuity (same element, no seek, no stall)

- **2026-11-18** · `Fixed` · Translation key cue-tracks-cannot-be-edited added to all 25 language files (the i18n spec requires every file to have every key)
    - Non-English files contain the English text for now; translators can update it

- **2026-11-18** · `Note` · Full test run: 315 suites, 3200 passed, 3 failed before the i18n fix; after it the only failures are 2 in contact-information.spec.ts
    - contact-information.spec.ts fails on the base commit too (website URL changed in 'Update website'); not touched by this branch
    - Lint: no file changed by this branch has more errors than before; legacy-audio-player.ts keeps its 3 pre-existing errors in code that was not changed

- **2026-11-19** · `Changed` · Albums page is now visible by default (main/common/settings/default-settings.ts: showAlbumsPage true)
    - Applies to new installs and to installs where the Albums toggle was never changed; a stored choice is kept

- **2026-11-19** · `Changed` · Discord Rich Presence looks like Spotify's 'Listening to'
    - Song title, artist, album name (cover caption), album cover, progress bar (start and end time, adjusted for playback speed)
    - New DiscordAlbumArtResolver looks covers up on Last.fm and caches them; the Dopamine icon is shown until a cover is found or when there is none
    - New setting showAlbumCoverInDiscordRichPresence (default on) with a toggle under Settings > Online > Discord; 2 new text keys in all 25 languages (English placeholder)
    - Texts are trimmed to Discord's 2-128 character limits so long titles no longer make Discord reject the presence
    - Kept discord-rpc 4.0.1: npm audit reports no advisories for it, ws 7.5.13 or node-fetch 2.6.11
    - See DRAFTS D9 for the privacy default

- **2026-11-19** · `Note` · npm audit reports 110 vulnerable packages elsewhere in the dependency tree (not Discord related); not changed, worth a separate review

- **2026-11-19** · `Added` · Statistics page with an offline listening tracker
    - Migration16 adds a ListeningSession table (one row per time a song plays: path, snapshot of title/artists/album, start time, listened ms, counted-as-play). Additive only.
    - ListeningTrackerService records actual playing time (pauses excluded), saves every 15 s and when the app closes, drops sessions under 1 s, counts a play after half the song or 4 minutes
    - New Statistics tab (page 6): rolling periods (7/30/365 days, all time), listening time, plays, songs, albums, days with music, top 10 songs/albums/artists, listening history with 'Load more'
    - New settings showStatisticsPage (default on, toggle under Appearance > Pages) and statisticsSelectedPeriod; 14 new text keys in all 25 languages (English placeholder)
    - Everything stays in the local database. Open points in DRAFTS D10 (clearing history) and D11 (two kinds of play counts)

- **2026-11-19** · `Tooling` · check.sh --db runs repository specs against SQLite (src/app/data/repositories)

- **2026-11-19** · `Added` · Clear listening history button on the Statistics page, with a confirmation dialog (DRAFTS D10)
    - Deletes all ListeningSession rows only; the playing song keeps being recorded from that moment
    - 2 new text keys in all 25 languages (English placeholder)

- **2026-11-19** · `Note` · Dependency audit written to docs/dependency-audit.md: 110 vulnerable packages, 47 of them shipped in the app; nothing changed yet

- **2026-11-19** · `Changed` · Security updates: fast-xml-parser 4.3.2 -> 4.5.7 (removes the only critical issue in the app) and moment 2.29.4 -> 2.31.0
    - jimp 1.6.1 was tried and reverted: it does not fix its advisories (zod 3) and broke the artwork tests (ESM-only file-type 21). Details in docs/dependency-audit.md
    - Full test run: everything passes except the pre-existing contact-information.spec.ts failure

- **2026-11-19** · `Fixed` · contact-information.spec.ts expected the old website URLs; updated to the URLs the code uses since 'Update website'
    - The full test suite is now green (319 suites), which the CI build workflows require before they build

- **2026-11-19** · `Added` · docs/dependency-upgrade-plan.md: phased plan to fix all remaining vulnerable dependencies, with test gates, a smoke test and rollback rules
    - Found and documented an urgent risk: the Last.fm artist biography is inserted as HTML while the window has full Node access

- **2026-11-19** · `Note` · Built Linux packages in the container from commit dd7a88d: release/Dopamine-3.0.12.AppImage (fuse3 runtime) and release/Dopamine-3.0.12.deb
    - Same steps as the CI Linux job, but rpm/pacman/snap skipped (tools not available) and electron-builder's native rebuild turned off (-c.npmRebuild=false)
    - Reason: the network here blocks www.electronjs.org (Electron headers), needed only to compile register-scheme, an optional discord-rpc module that is never loaded under Electron. better-sqlite3 was rebuilt for Electron 38.8.6 and verified
    - Smoke test: AppImage starts on a virtual display, shows the welcome screen, creates a database at version 16 with the CUE columns and ListeningSession table
