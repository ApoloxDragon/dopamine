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

- **2026-11-19** · `Fixed` · appimagetool-x86_64.AppImage (15 MB build tool) was committed by accident in 114d3e7 and removed again; now in .gitignore, and save.sh refuses files over 5 MB
    - The binary is still in the branch history unless that commit is rewritten (your decision)

- **2026-11-19** · `Changed` · Discord status now reads 'Listening to <artist>' instead of 'Listening to Dopamine' (status_display_type = 1)
    - patch-discord-rpc.js now also passes status_display_type; each field is patched on its own so existing installs pick it up on the next npm install
    - Field values checked against discord-api-types (StatusDisplayType: Name 0, State 1, Details 2); discord.com itself is not reachable from the build container

- **2026-11-19** · `Added` · Parametric equalizer engine (UI follows)
    - parametric-equalizer.ts: bands (peak, low/high shelf, low/high-pass, notch), limits, AutoEQ / Equalizer APO import and export, response curve
    - AudioEqualizer now builds input -> preamp -> N filters -> output; graphic mode is the same 10 filters as before; value changes update the existing nodes (no clicks)
    - EqualizerService: graphic/parametric mode, parametric profile saved in settings (audioEqualizerMode, audioEqualizerParametricProfile), add/remove/edit bands, preamp, prevent clipping
    - Low-pass/high-pass Q is converted to dB for Web Audio; shelves use Web Audio's fixed slope (about Q 0.71)

- **2026-11-19** · `Tooling` · scripts/dev/eq-harness/run.js compares the drawn response curve with Chromium's real BiquadFilterNodes (exact match) and checks the audio level through the filters

- **2026-11-19** · `Added` · Parametric equalizer UI (Settings: equalizer dialog > Parametric)
    - Graphic | Parametric switch; each mode keeps its own settings; the dialog widens to 760 px in parametric mode only
    - Response curve with draggable band handles (drag: frequency and gain, scroll: Q), band table (on/off, type, frequency, gain, Q, remove), preamp, clipping warning with 'Prevent clipping'
    - Import and export of AutoEQ ParametricEQ.txt / Equalizer APO files; DesktopBase save/open dialogs accept file type filters (default unchanged: images)
    - 24 new text keys in all 25 languages (English placeholder)
    - Checked in the real app (Electron, Playwright): both modes render, dragging a handle updates the band and the saved settings

- **2026-11-19** · `Tooling` · scripts/dev/app-screenshots.js launches the built app with a fresh profile and screenshots the equalizer (both modes) and the Statistics page

- **2026-11-19** · `Added` · Import of AutoEQ GraphicEQ files (fitted to the 10-band graphic equalizer)
    - graphic-eq.ts: parses 'GraphicEQ: f g; ...', least-squares fit of the 10 graphic gains taking band overlap into account, reports average (RMS) and largest deviation
    - One Import button in the dialog (both modes) detects the format: parametric filters -> parametric mode, GraphicEQ -> graphic mode; a successful import also turns the equalizer on
    - Export writes the current mode: GraphicEQ.txt (the graphic equalizer's real response at 127 AutoEQ-style frequencies) or ParametricEQ.txt
    - Checked with the real QCY H3 Pro AutoEQ files (kept as test data): ParametricEQ imports exactly; GraphicEQ fits within 1.4 dB on average, 4.9 dB at most (narrow 3.9 kHz peak)
    - Verified in the running app (Playwright, native file dialog stubbed in the main process)

- **2026-11-19** · `Added` · Fade on pause, resume and stop (Settings > Behavior > Fade on pause)
    - Off by default. One duration (1 ms to 60 s), plus an optional separate fade-in duration
    - Pause shows at once; the audio fades out and then pauses. Resume fades in from silence; pressing play during a fade-out turns it around from the current level. User stop (tray, media keys) fades out too
    - A new track, skipping, or the end of the queue always restores full volume and cancels a pending fade
    - Implemented as a fade gain at the start of the equalizer chain (all three players), exponential ramp (even in dB), cancelAndHoldAtTime for reversals
    - Checked in real Chromium (eq-harness): -20 dB a quarter in, -40 dB half way, ends in silence, no jump when reversed half way, 1 ms works
    - 7 new text keys in all 25 languages (English placeholder)

- **2026-11-19** · `Fixed` · Album cover missing (or stale) on the lock screen and OS media controls
    - Found with a private D-Bus session and the real app (MPRIS, what GNOME/KDE lock screens read): Electron's media session only shows data URLs (file:// covers are never loaded) and silently skips large covers (a 3000x3000 scan was ignored); a failed or missing cover leaves the previous song's cover in place
    - MediaSessionService now sends a cover made for this: embedded/folder cover, else the cached cover file read from disk, resized to at most 512x512 JPEG, as a data URL (MetadataService.createMediaSessionImageUrlAsync)
    - Songs without a cover show the Dopamine logo (new asset src/assets/images/media-session-placeholder.png), since the old cover cannot be cleared otherwise
    - Title/artist/album are set at once, the cover follows; a slow cover of an older song can no longer overwrite a newer one
    - Verified over MPRIS: a 6.9 MB embedded cover now shows; after Next to a song without cover the logo shows
    - Not verified: the Windows/macOS media controls (same Chromium media session code, likely to benefit too)

- **2026-11-19** · `Tooling` · scripts/dev/mpris-probe.sh and mpris-cover-check.js read what the app publishes to the Linux desktop over D-Bus

- **2026-11-19** · `Changed` · Release 3.1.0-apolox.1 prepared
    - Version 3.1.0 with versionSuffix apolox.1 (installers: Dopamine-3.1.0-apolox.1.*); CHANGELOG.md section for it
    - Update check and download link point to ApoloxDragon/dopamine (ProductInformation.releasesOwner)
    - VersionComparer: custom build lines (apolox.N) now compare correctly (3.1.0-apolox.1 < 3.1.0-apolox.2 < 3.2.0-apolox.1); official preview/rc rules unchanged
    - .github/workflows/release.yml: on a pushed v* tag builds all platforms (same jobs as nightly) and creates a DRAFT release with installers, SHA256SUMS.txt and the change log section; refuses a tag that does not match the app version; manual runs can publish at once

- **2026-11-19** · `Changed` · Version is now 3.1.0-apolox (tag v3.1.0-apolox); version comparison handles the suffix without an iteration

- **2026-11-19** · `Added` · Links to both the original Dopamine and this version
    - About page: 'About this version' section with this version's repository, its downloads, and the original Dopamine repository (the original author's contact links stay)
    - README: note at the top with the same links and a short list of what this version adds
    - 5 new text keys in all 25 languages (English placeholder)

- **2026-11-19** · `Tooling` · Security tooling
    - scripts/dev/vuln-report.js: compact npm audit report per vulnerable package (app or dev, fix within the compatible range or major, which direct dependencies pull it in); --write-baseline / --check for new critical/high advisories
    - scripts/dev/audit-baseline.json: the 139 known critical/high advisories as of today
    - scripts/dev/try-fix.sh: after a dependency change, runs install, unit tests, database tests, production build and the advisory check, printing PASS/FAIL per step

- **2026-11-19** · `Changed` · CI workflows (nightly, merge, release): faster and safer
    - actions/checkout v2 -> v4 and actions/setup-node @master (unpinned branch) -> v4
    - Removed the third-party notiz-dev/github-action-json-property steps (12): their output was never used
    - npm install -> npm ci (exact lockfile install) with the npm download cache; Electron and electron-builder downloads cached per lockfile

- **2026-11-19** · `Fixed` · Security: 40 critical/high advisories fixed with npm overrides kept within compatible versions
    - piscina ^4.9.4 (critical), follow-redirects ^1.16.2 (in the app), joi, js-yaml, node-forge, picomatch, postcss, minimatch 3.x, tmp 0.2.x
    - npm audit: critical 2 -> 1, high 64 -> 57; all gates pass (unit and database tests, production build); baseline updated
