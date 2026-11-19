# Dependency upgrade plan

A step-by-step plan to fix the remaining vulnerable dependencies (see [dependency-audit.md](dependency-audit.md)) over a long period,
with testing between every step. Each phase is small enough to try, test, and throw away if it goes wrong.

## Ground rules (for every phase)

1. **One upgrade per branch and pull request.** Never combine two risky upgrades. Branch from `apolox-master`, name it `deps/<what>`
   (for example `deps/electron-39`).
2. **One major version at a time.** Electron 38 → 39 → 40, not 38 → 42. Angular 16 → 17 → 18 → 19. Each step gets its own build and test.
3. **Gates before merging** (all must pass):
   - `npm run test` is green (currently 319 suites, 3241 tests).
   - `scripts/dev/check.sh --db` (database repository specs) is green.
   - `scripts/dev/cue-scenarios.sh` and `node scripts/dev/playback-harness/run.js` pass (CUE indexing and playback).
   - `npm run build:prod` succeeds.
   - The manual smoke test below passes on at least the platform you use daily.
   - `npm audit --omit=dev` shows the targeted advisories gone and no new ones.
4. **Keep a way back.** Before installing a test build, copy the database (`Dopamine.db` in the app data folder) and keep the last
   good installer. Database migrations cannot be undone, so the copy is the only way back if a build corrupts data.
5. **Write down what happened** in `docs/cue-support/LOG.md` (or a new `docs/dependency-log.md`): what was tried, what broke, what was done.
   "Trial and error" is fine as long as the errors are recorded.

## Manual smoke test (15 minutes)

Run on an installed build, with a copy of the real database:

- [ ] App starts, collection loads, no error dialog. Refresh the collection.
- [ ] Play a normal FLAC and an MP3. Pause, resume, seek, next, previous, change volume.
- [ ] Play a CUE album across track boundaries (no gap or click). Try with gapless and crossfade on and off.
- [ ] Album covers show (embedded, folder.jpg and downloaded). Album accent colour changes with the album.
- [ ] Edit tags of a normal song, save, check the file. Rating and love.
- [ ] Playlists: create, add songs, reorder. Smart playlist opens (uses `fast-xml-parser`).
- [ ] Lyrics: embedded, `.lrc`, and online lyrics.
- [ ] Artist page: biography and image from Last.fm. Last.fm scrobbling (if used).
- [ ] Discord presence with cover (if used). Statistics page fills after playing a song.
- [ ] Media keys, tray icon, mini player, close and reopen (playback position restored).

## Urgent: artist biographies are inserted as HTML (do before anything else)

`now-playing-artist-info.component.html` shows the Last.fm artist biography with `[innerHTML]`. Last.fm biographies are wiki text that
any Last.fm user can edit. Angular cleans HTML inserted this way, but Angular 16 has known sanitizer bypasses (SVG script attributes,
namespace bypass: see the audit). Because the window has full Node access (Phase 5), a biography that gets past the sanitizer could run
code on the computer.

Small fix, independent of any upgrade: convert the biography to plain text (keeping links as links, or as text) instead of inserting HTML.
Test: open the now playing screen for a few artists with long biographies and links.

## Phase 0: Safety net (do first, about 1 week)

- [ ] **Turn on GitHub Actions on the fork** (Actions tab → "I understand my workflows, go ahead and enable them"). The nightly workflow
      builds Linux, Windows and macOS installers and runs the tests, so every upgrade branch can be built on every platform.
- [ ] Optional: add a workflow that runs `npm run test` and `npm audit --omit=dev` on every pull request (today tests only run in the
      build workflows).
- [ ] Optional: enable Dependabot security alerts (Settings → Code security). Alerts only, no automatic pull requests yet.

**Done when:** a pull request shows test results, and a nightly build can be downloaded and installed.

## Phase 1: Small leftovers (low risk, 1–2 weeks)

| Step | Change | Risk | What to test |
| --- | --- | --- | --- |
| 1a | `uuid` inside `@digimezzo/node-taglib-sharp`: add an npm `overrides` entry for `uuid` 11, or ask upstream for a release | Low | Reading and writing tags (edit a song, save, re-read) |
| 1b | `fast-xml-parser` 4.5.7 → 5.x (last low advisory) | Low to medium: 5.x changed some options | Smart playlists and online lyrics. Only `smart-playlist-parser.ts` and `chart-lyrics.api.ts` use it |
| 1c | Transitive `follow-redirects`, `@babel/runtime`: `npm update <name>` or `overrides` | Low | Full test suite, online features (Last.fm, lyrics) |

**Done when:** these advisories are gone from `npm audit --omit=dev`.

## Phase 2: Electron 38 → 42+ (medium risk, 4–8 weeks, one major per step)

Electron is the engine everything runs on, with 34 advisories. Do 39, then 40, 41, 42 (or the newest supported).

For each major version:
1. Read the "Breaking changes" page for that Electron version.
2. `npm install --save-dev electron@<major>`, then `npm install` (rebuilds `better-sqlite3` for that Electron).
3. Check the things this app relies on, which are the usual sources of breakage:
   - `nodeIntegration: true`, `contextIsolation: false` and `@electron/remote` in `main.ts` (see Phase 5).
   - Native modules: `better-sqlite3` (must rebuild), `discord-rpc` (IPC socket).
   - `setSinkId` audio output device selection, media keys, tray, `shell.openPath`, `moveFileToTrash`.
   - The bundled Node.js version changes with Electron: the indexing worker (`main/background-work`) runs on it.
4. Build, run the gates and the smoke test on Windows, Linux and macOS (via the nightly workflow).

**Done when:** on a supported Electron version with no high advisories. Then follow Electron's release schedule
(about every 8 weeks a new major; only the latest 3 get security fixes).

## Phase 3: Angular 16 → 19+ (large, 2–4 months, one major per step)

Fixes most Angular advisories and almost all build-tool advisories (including the 2 critical ones, `piscina` and `tar`).

For each major version (17, then 18, then 19, optionally 20+):
1. Follow the official guide at update.angular.dev for "from N to N+1".
2. `npx ng update @angular/core@<N> @angular/cli@<N>`, then `@angular/material@<N>` and `@angular/cdk@<N>`.
3. Update the packages that must match Angular's version, in the same branch:
   `@angular-eslint/*`, `@angular-builders/custom-webpack`, `jest-preset-angular`, `typescript` (the Angular version prescribes it),
   `zone.js`, `angular-split`, `@ngx-translate/core`.
4. Expect work in:
   - **RxJS 6.6 → 7** (needed by Angular 17+): `toPromise()` is used in `dialog.service.ts` and probably elsewhere; it is deprecated in RxJS 7.
   - **Angular Material**: theming and component styles change between majors; compare screens before and after (take screenshots first).
   - **TypeScript 4.9 → 5.x**: stricter checks may report new errors.
   - **Jest**: `jest-preset-angular` majors change configuration; `jest.config.js` and `src/test.ts` may need updates.
5. Gates and smoke test. Pay extra attention to the look of every page and dialog.

**Done when:** on an Angular version that is still supported (Angular supports each major for 18 months).

## Phase 4: Images (medium, 2–4 weeks)

| Step | Change | What to test |
| --- | --- | --- |
| 4a | `node-vibrant` 3.2.1-alpha.1 → 4.x (rewrite: the import changes from `node-vibrant/lib/bundle` to `node-vibrant/node`). Only `album-accent-color.service.ts` uses it. Removes the old jimp 0.16 with `file-type` 16 and `phin` 2 | Accent colour per album, with JPEG, PNG and WebP covers |
| 4b | `jimp` 1.6.0 → a release that uses `zod` 4, or an `overrides` entry for `zod` 4 (test carefully: jimp is written for zod 3) | `image-processor.spec.ts`, cover resizing, embedded and downloaded covers, artwork cache |
| 4c | If jimp 1.6.1+ is used: its `file-type` 21 is ESM-only and loaded with `import()`. Jest needs `--experimental-vm-modules` or a mock for `file-type`. This is what broke the tests when 1.6.1 was tried | Same as 4b |

## Phase 5: Electron security hardening (large, can run in parallel with phase 3)

The app window runs with `nodeIntegration: true`, `contextIsolation: false` and `@electron/remote`. That means any script running in the
window has full access to the computer. Because of this, the Angular "XSS" advisories matter more here than in a normal web app:
if untrusted text from the internet (artist biographies, lyrics, metadata) were ever inserted as HTML, it could run with full access.

Steps, each its own pull request:
1. Search for `innerHTML`, `[innerHTML]`, `bypassSecurityTrust*` and check that internet content is never inserted unsanitized.
2. Add a Content Security Policy to `index.html` (no remote scripts).
3. Long term: move Node and Electron access behind a `preload` script with `contextBridge`, turn on `contextIsolation`, turn off
   `nodeIntegration`, and remove `@electron/remote`. This is a big refactor touching most services that use `fs`, `electron` or
   `better-sqlite3` from the renderer.

## Phase 6: Build and test tools (low urgency, after phase 3)

`electron-builder`, `jest` 29 → 30, `eslint` 8 → 9 (new "flat" config format), remove `tslint` (deprecated since 2019),
`webpack-dev-server`. These run only on the build machine. Most are updated together with Angular in phase 3.

## Phase 7: Staying up to date

- Turn on Dependabot version updates (weekly, grouped: Angular packages together, Electron alone).
- Once a month: `npm audit --omit=dev`, update `docs/dependency-audit.md`.
- Follow Electron and Angular release schedules: update before a version reaches end of support.

## Tracking

| Phase | Status | Pull request | Notes |
| --- | --- | --- | --- |
| Quick fixes (`fast-xml-parser` 4.5.7, `moment` 2.31.0) | Done | ApoloxDragon/dopamine#2 | jimp 1.6.1 tried and reverted |
| Urgent: plain-text biographies | Not started | | Small, independent of upgrades |
| 0 Safety net | Not started | | Actions must be enabled on the fork |
| 1 Small leftovers | Not started | | |
| 2 Electron | Not started | | |
| 3 Angular | Not started | | |
| 4 Images | Not started | | |
| 5 Hardening | Not started | | |
| 6 Build tools | Not started | | |
| 7 Staying up to date | Not started | | |
