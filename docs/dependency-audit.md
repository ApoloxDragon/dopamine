# Dependency security audit

Snapshot of `npm audit` on branch `claude/beautiful-faraday-hdjqhv` (2026-11-19).

## Fixed so far

| Package | Before | After | Result |
| --- | --- | --- | --- |
| `fast-xml-parser` | 4.3.2 | 4.5.7 | The critical and both high advisories are gone. One low one remains (quadratic CPU use on unterminated tags), fixed only in 5.x (major). |
| `moment` | 2.29.4 | 2.31.0 | Fixed. |

After these: **109** vulnerable packages in total (was 110), **0 critical** in the shipped app (was 1). Counts are per package, so the
high count does not move even though the high `fast-xml-parser` advisories are fixed. All tests pass except the pre-existing
`contact-information.spec.ts` failure.

**`jimp` was tried and reverted.** 1.6.1 does not fix its advisories: even the newest jimp requires `zod` 3, and the fix is only in `zod` 4;
`file-type` and `phin` also come in through `node-vibrant` (below). It also moved to the ESM-only `file-type` 21, loaded with a dynamic
`import()`, which broke the artwork tests (`image-processor.spec.ts`) and might behave differently in the app. Not an easy update after all.

The tables below describe the state **before** these fixes.

**110 vulnerable packages**: 3 critical, 64 high, 36 moderate, 7 low. Most are not separate problems: they come from
a handful of direct dependencies that pull in many sub-packages (`jimp` alone accounts for 30 of them).

- **47 are in the app you ship** (`npm audit --omit=dev`): 1 critical, 34 high, 12 moderate.
- **63 are build and test tools only** (Angular CLI, webpack dev server, Jest, ESLint, electron-builder). They run on the developer's
  machine while building, never inside the installed app. Still worth updating, but much less urgent.

Re-run with `npm audit` (all) or `npm audit --omit=dev` (shipped code only).

## Shipped in the app, ordered by how easy the fix is

| Package | Installed | Fixed in | Effort | What the problem is | Relevance for Dopamine |
| --- | --- | --- | --- | --- | --- |
| `fast-xml-parser` | 4.3.2 | 4.5.7 | **Easy** (minor update) | 1 critical, 2 high: crafted XML can bypass entity encoding or blow up memory/CPU (entity expansion), plus injection in the XML builder | **Real.** Used to parse smart playlist files and the XML answer of the online lyrics service (`chart-lyrics.api.ts`), so it reads data from the internet. Fix first. |
| `jimp` (+29 `@jimp/*` sub-packages) | 1.6.0 | none yet | **Not easy** (see "Fixed so far") | Comes from its dependencies: `zod` (high, memory exhaustion), `file-type` (moderate, infinite loop on malformed files), `phin` (moderate, leaks headers on redirect) | Low to moderate. `zod` only validates jimp's own options, not file contents. `file-type` and `phin` mostly come from `node-vibrant` 3.2.1-alpha.1 (album accent colours), which bundles an old jimp 0.16; the fix there is `node-vibrant` 4, a rewrite. |
| `moment` | 2.29.4 | 2.31.0 | **Easy** (minor update) | Moderate: path traversal via a crafted locale name | Low. Only exploitable if an attacker controls the locale name passed to moment. |
| `electron` | 38.8.6 | 42.11.16 or newer | **Medium** (4 major versions) | 34 advisories: use-after-free, context-isolation bypass, sandbox escapes for popups and iframes, cross-origin reads, compromised certificates mitigation | **Real.** Electron is the browser engine the whole app runs in. Most issues need web content to open popups or iframes, which Dopamine mostly does not do, but Electron is the base everything else runs on. Needs a test pass after the update (native modules such as `better-sqlite3` must be rebuilt). |
| `@angular/*` (core, common, animations, cdk, material, forms, platform-browser) | 16.2.12 | 19.2.26 or newer | **Large** (3 major versions, code migration) | XSS via sanitization bypasses, i18n XSS, denial of service in date/number formatting, cache issues in `HttpTransferCache` | Many advisories are about server-side rendering, hydration and the HTTP transfer cache, which a desktop app does not use. **The sanitization bypasses do matter:** the Last.fm artist biography is inserted as HTML, and the window has full Node access, so a bypass could become code running on the computer. See "Urgent" in [dependency-upgrade-plan.md](dependency-upgrade-plan.md). The Angular upgrade is a project of its own. |
| `uuid` (inside `@digimezzo/node-taglib-sharp`) | 9.0.0 | 11.1.1 | **Upstream** | Moderate: missing bounds check when a buffer is passed to v3/v5/v6 | Very low. Needs a new release of `node-taglib-sharp` (maintained by the Dopamine author); can be forced with an npm `overrides` entry. |
| `follow-redirects`, `extract-zip`, `@babel/runtime` | (transitive) | newer versions | Easy to medium | Header leaks on redirect, path traversal when unzipping, inefficient regex | Low. Pulled in by other packages; `extract-zip` comes from Electron's installer. |

## Build and test tools only (not shipped)

The other 63 come from the development tool chain: `@angular-devkit/build-angular`, `@angular/cli`, `@angular-eslint/*`,
`@angular-builders/custom-webpack`, `jest-preset-angular`, `electron-builder` and their dependencies (webpack dev server, `sockjs`,
`ws`, etc.). Almost all of them are fixed by the same Angular upgrade as above. They are a risk only on the machine that builds the app.

## Suggested order

1. ~~Quick, low risk: `fast-xml-parser` and `moment`.~~ Done (see "Fixed so far").
   `jimp` turned out not to be easy: it needs either a newer jimp release that moves to `zod` 4, or an npm `overrides` entry with testing.
2. **Electron** 38 to the newest supported major, with a full manual test of the app on each platform.
3. **Angular** 16 to 19 or newer, following the official update guide one major version at a time (also fixes most build tool issues).
4. Ask upstream for a `node-taglib-sharp` release with `uuid` 11, or add an npm `overrides` entry.
5. Replace or update `node-vibrant` (accent colours) to drop the old jimp 0.16 with `file-type` 16 and `phin` 2.

The 2 critical issues left are both in build tooling only: `piscina` (prototype pollution) and `tar` (path traversal when unpacking),
pulled in by the Angular CLI. The Angular upgrade (step 3) removes them.
