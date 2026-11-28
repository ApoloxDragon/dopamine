# ApoloxDragon's fork of Dopamine: overview

Everything in one place: what the fork has, what was checked and found, where official Dopamine (upstream) is, and what
comes next. Written 2026-11-27 from the change log, `cue-support/LOG.md`, `cue-support/DRAFTS.md`, the plans in `docs/`,
the pull requests and all branches. The detailed files stay the source; this is the map.

Free and open source under GPL-3.0, based on Dopamine 3.0.12 by Digimezzo.

## 1. Releases

| Version | Date | Pull requests | In short |
| --- | --- | --- | --- |
| 3.1.0-apolox | 2026-11-19 | 1–5 | CUE sheet albums, Discord "Listening to", Statistics page, parametric EQ, AutoEQ import, fade on pause, lock-screen cover (draft release only) |
| 3.2.0-apolox | 2026-11-19 | 6 | Security fixes (0 critical), faster CI, AppImage permissions, Discord progress bar |
| 3.2.1-apolox | 2026-11-19 | 7–9 | CUE albums whose FLAC cover has no MIME type; WAL database; Windows build fix |
| 3.2.2-apolox | 2026-11-19 | 10 | Detailed listening statistics (opt-in) |
| 3.3.0-apolox | 2026-11-19 | 11 | Fade-out fix, split-CD covers, torture tests and their fixes, real-library fixes |
| 3.3.1-apolox | 2026-11-24 | 12, 14 | Offline network folders keep their songs, like/dislike, sleep timer, smart shuffle, recently added/played, fast/full refresh, alac2flac tool |
| 3.3.2-apolox | 2026-11-25 | 13, 16 | Continuous play, album/artist likes (migration 18), `dopamine.json`, year in review, clearer input dialogs |
| 3.3.3-apolox | 2026-11-25 | 15, 17 | Connected network drives (opt-in), smb:// addresses, search box in Settings |
| 3.3.4-apolox | not released | 18, 19 (merged), 20 (upstream sync), 21 (review fixes) | Share under another name, reconnect, song cache, network drive nicknames, strict cache safety |

Release process: `claude/release-X` branch (or `apolox-master`) + `release.yml` with `publish=true` (tags cannot be pushed
from the sessions). Notes come from the change log section via `scripts/release-notes.js`. Publish oldest first.

## 2. What the fork adds (by area)

- **CUE albums:** parser (EAC sheets, Latin-1/UTF-16), worker indexing, playback in all players, safety guards, loose
  FILE matching, covers in Artwork/Scans/Covers, split-disc covers, `dopamine.json` album details.
- **Playback:** fade on pause/resume/stop, sleep timer with fade, smart shuffle, continuous play, skipping songs on an
  offline share (max 10 in a row), reconnecting shares.
- **Equalizer:** parametric EQ, AutoEQ GraphicEQ import (fitted to 10 bands), response curve checked against Chromium.
- **Library:** like/dislike for songs, albums and artists; recently added/played rows; fast and full refresh; network
  folders that survive an offline server; network drives list, smb:// addresses, nicknames; song cache per music folder.
- **Statistics:** offline listening log, detailed statistics (opt-in), year in review, clear history.
- **Desktop:** Discord "Listening to" with cover and progress, lock-screen / MPRIS cover, Settings search.
- **Tools:** `tools/alac-to-flac` (bit-perfect, curses interface, Linux), `scripts/dev/*` (below).
- **Security and build:** 0 critical advisories, overrides kept compatible, WAL database, faster CI, nightly by hand only.

Database: migrations 15 (CUE columns), 16 (ListeningSession), 17 (ListeningSegment), 18 (Liked). Upstream is at 14.

## 3. What was checked, and what it found

### The owner's real data
- **Database, log, settings, file list (3.2.2):** integrity ok, WAL, 1938 tracks (1041 CUE tracks). No "database is
  locked", no CUE load failures after the 3.2.1 fixes. Found and fixed: CUE track count per FILE (Black Sabbath vinyl
  "N of 1"), ALAC bit rate 0, covers in subfolders (4 albums had none).
- **Total size 177 GB instead of 53 GB:** CUE album files counted once per track (173.9 GB for 140 files of 33.7 GB).
  Fixed in 3.3.0.
- **Veleno:** a second .cue copy in Scans/ points to a .wav that does not exist (warning in every refresh; D18).
- **"Database is locked" (3.2.0 log):** statistics lost while indexing. Fixed with WAL (D14).
- **3.1.0 CUE FLAC fails after 15 ms:** FLAC cover with an empty MIME type (D12), fixed in 3.2.1.
- **1,878 items / network share (3.3.3 log, 2026-11-25):** the share was open in Files but not at the stored gvfs path
  (ENOENT); on 11-24 the same path worked. Most likely opened with a user name (`,user=...`). Fixed in 3.3.4 (find it
  under its new name, reconnect, clearer log). Owner tested the 3.3.4 build: playback from the share works.
- **Mac ARM release build broke on 3.2.1:** runner/hdiutil flakiness; rerun worked. Rule: rerun failed jobs once.

### Torture tests ("a tester walks into a bar")
- CUE: duplicate/negative/huge track numbers, odd UTF-16, NaN ranges, ranges past the end, 2 GB sheets (now 10 MB
  limit). Fades: failed fades lost pause/stop and left volume at 0. Discord: odd text, surrogate pairs, bad timestamps.
- Real SQLite: NUL in tags, >1000 OR conditions, Infinity in smart playlists, LIKE wildcards, odd LIMITs.
  `electron-jest.js` ignored Jest's exit code (failures looked green): fixed, and the database tests run in CI.
- Since then every feature ships with "trying to break it" cases (song cache: zip bomb, path tricks, symlinks; share
  names with `; rm -rf ~`; Settings search: regex/HTML/100 000 characters; and so on).

### Harnesses (scripts/dev)
`check.sh` (single specs, `--db`), `try-fix.sh` (dependency changes), `build-linux.sh`, `index-sandbox.js` (real indexer;
`--song-cache --full`), `cue-scenarios.sh`, `db-sandbox.js`, `db-lock-check.js`, `playback-harness/` (real players in
Chromium, `real-music.js`), `eq-harness/`, `app-screenshots.js` (real app: equalizer, statistics, Settings search),
`mpris-probe.sh` + `mpris-cover-check.js`, `seed-statistics.js`, `fixtures.sh`, `i18n-add.js`, `apply-overrides.js`,
`vuln-report.js`, `upstream-diff.sh`, `devlog.sh`, `effort-check.js`.

### Numbers (2026-11-26)
- Tests: 349 suites, 4011 passed (20 todo); database integration: 6 suites.
- Song cache on 300 songs: a new library used the cache for all 300 and opened none of the files; results identical.
  About 0.5 KB per song; limits 64 MB file / 512 MB unpacked (around 700 000 songs).
- `npm audit` (2026-11-19): critical 0; 88 advisories left (high 41, moderate 41, low 6), almost all Angular 16,
  Electron 38, jimp and build tools; 47 direct packages a major version behind (see `3.4.0-plan.md`).

## 4. Upstream (official Dopamine) and the update plan

Checked 2026-11-27 against `github.com/digimezzo/dopamine` `master`:

- Latest upstream release: **3.0.12** (2026-11-07). No newer release.
- Our shared starting point: `19bd0ab8` (2026-11-16, "Update website"). The fork's `master` copy is 1 commit behind
  upstream (`a557b309`); upstream has **3 commits** since the shared point:
  1. `30c647e8` Move patches to their own subdirectory (`patches/patch-discord-rpc.js`, `patches/patch-taglib-sharp.js`).
  2. `a557b309` Add missing build update for the taglib patch.
  3. `713ada97` Replace the node-taglib-sharp patch by the updated npm package (`@digimezzo/node-taglib-sharp` ^1.0.3 → ^1.0.5;
     `patches/patch-taglib-sharp.js` deleted; postinstall only runs the discord-rpc patch).
- Earlier upstream fixes (#1294 package files, #1296 Ctrl/Cmd+A, #1297 selected count, #1298 "Multiple values") are
  before the shared point, so the fork already has them.
- The fork is 118 commits ahead: 332 files, about 32 800 lines added. No clashing migration numbers (upstream 14, fork 18).

**Expected conflicts:** only `package.json` and `package-lock.json`. Also by hand: the fork changed
`patch-discord-rpc.js` (26 lines) at the root; upstream moved it to `patches/`. Move the fork's version there.

**Steps (small, medium effort, one PR `sync/upstream-2026-11`):**
1. Update `master` from upstream (fast-forward; `master` only ever mirrors upstream).
2. Branch from `apolox-master`, merge `master`.
3. Resolve: keep the fork's `package.json` (version 3.3.x, scripts) but take `@digimezzo/node-taglib-sharp` ^1.0.5 and the
   `patches/` postinstall path; move the fork's `patch-discord-rpc.js` into `patches/`; delete `patch-taglib-sharp.js`;
   regenerate the lock file with `npm install` (do not hand-merge it).
4. Gates: `scripts/dev/try-fix.sh`, full suite, database tests, `index-sandbox.js` on the CUE fixtures (taglib reads
   all tags), a deb build, play a CUE album and an ALAC file.
5. Ship in the next patch release (3.3.5) with "Based on Dopamine 3.0.12" unchanged (no new upstream release).

For the next upstream release (3.0.13 or 3.1): same steps, following `upstream-sync-plan.md` (conflict hot spots:
`playback.service.ts`, the players, equalizer, `track-filler.js`, Discord, `settings.ts`, workflows, translations).

## 5. What comes next

- **3.3.4:** merge PRs 20 and 21, then release (`release.yml` on `apolox-master`, publish=true). Optional new test deb first.
- **Upstream sync:** done in PR 20 (taglib 1.0.5, `patches/` folder), shipped with 3.3.4.
- **3.4.0 (high effort, many sessions):** everything up to date (`3.4.0-plan.md`: clean-up, Electron 38 → 45, Angular
  16 → 22, test/lint tools, parsers), then Navidrome/Subsonic client, bit-perfect output on Linux with optional EQ,
  MusicBrainz tagging + batch tag editor + file organiser. Small ones: queue improvements, Ctrl+K, duplicate finder.
- **3.5.0:** Electron hardening (contextIsolation, preload, no @electron/remote, CSP) first, then the **phone remote**
  (local web page, off by default, paired with a code), CD ripping, casting and device sync. An Android companion app can
  use the same connection later (`android-plan.md`, D15).
- **Remote control today:** KDE Connect (Android) + GSConnect/KDE Connect controls Dopamine through MPRIS (play/pause,
  next, seek, volume, cover), local network only, no code needed.

## 6. Open decisions (from DRAFTS.md)

| Draft | Subject | Status |
| --- | --- | --- |
| D1 | Destructive file actions on CUE tracks | minimal guard done, full UX draft |
| D2, D3, D7, D9 | Whole-file loading in gapless/crossfade; hiding the raw album file; guessing FILE names; Discord cover lookup on by default | done, need your review |
| D4, D5, D6, D8, D13 | Embedded CUESHEET; multi-FILE sheets; hidden track one; Folders view; same FLAC as normal tracks | drafts, not started |
| D11 | Two kinds of play counts | note, needs review |
| D15 | Android version | on hold |
| D16 | EQ clipping warning | low priority (you keep 0 dB on purpose) |
| D17 | Merging "(CD1)"/"(CD2)" albums | needs your decision (`dopamine.json` discNumber is a workaround) |
| D18 | Duplicate Veleno sheet in Scans/ | note |
| D20 | Share relocation, reconnect, song cache | done, risky parts noted |

## 7. Branches and pull requests

- `master`: mirror of upstream (1 commit behind). `apolox-master`: the fork, everything lands here by PR.
- All work from these sessions is in one branch, `claude/beautiful-faraday-hdjqhv` (see the commit that collapsed the
  others). PRs 1–19 are merged; 20 (upstream sync) and 21 (review fixes) are open.
- Old branches to delete by hand on GitHub (the sessions cannot delete branches): the merged `claude/beautiful-faraday-hdjqhv-*`
  branches and `claude/release-*`. Keep `claude/experimental`.
- Release branches (`claude/release-3.2.1`, `claude/release-3.3.1-apolox`, `claude/release-3.3.2-apolox`) were used for
  release builds, not PRs. `claude/experimental` was never used in a PR.
- Older non-Claude branches (`armBuild`, `audioDeviceSelection`, `discord`, `fix1241`, `fix1262`, `1101_…`, `1215_…`,
  `1279_…`, `supportWebPCovers`) come from upstream's history and are left alone.

## 8. Review of 3.3.4 (2026-11-28): fixed and still to do

Fixed (PR 21):
- Cancel in text dialogs gave back what was typed (nicknames, sleep timer custom time, sort prefixes, artist
  separators, playlist folders). Cancel now gives nothing; `DialogService.showInputDialogOrCancelAsync` tells cancel
  apart from an empty answer.
- A nickname could not be removed (OK was off with an empty field): `InputData.allowEmpty`.

Still to do, each small and on its own (in this order):
1. **Song cache vs. "Full refresh" after a reader update.** With the cache on, a full refresh reuses cached tags, so an
   update that reads tags better (like taglib 1.0.5) is not applied. Fix: write a `reader` field in the cache file
   (Dopamine version + `@digimezzo/node-taglib-sharp` version); in `SongCache.parse`, treat a different reader as no
   cache (it is then rebuilt). Files: `main/background-work/indexing/song-cache.js` (+ spec).
2. **Startup could wait on a sleeping share.** `NetworkShareGuardService.relocateMovedShares` checks each music folder
   with a synchronous `existsSync` in the window process; a gvfs share whose server sleeps can block it. Fix: make it
   async (`fs.promises.access` with a 3 s timeout per share) and in `app.component.ts` await it with an overall cap.
   High effort (startup and playback paths).
3. **One extra network check per new song.** `SongCache.get` stats the file before looking for an entry. Fix: return
   early when there is no entry, then stat.
4. **Translations.** The 3.3.4 texts (reconnect, song cache, share not connected, nicknames: 12 keys) are English in the
   other 24 languages. Use the same approach as the Settings search keys (one node script over `src/assets/i18n`).
