# Development workflow and dev builds

## Branches

| Branch | What it is | How it changes |
| --- | --- | --- |
| `master` | Mirror of official Dopamine (Digimezzo) | Only updated from upstream, never committed to |
| `apolox-dev` | Development: everything merged, ahead of the last release | Pull requests from `claude/...` (and `sync/upstream-...`, `deps/...`) branches |
| `apolox-master` | Released versions only | `apolox-dev` is merged into it for a release (one PR per release) |

Release steps:
1. The version's change log section in `CHANGELOG.md` is complete on `apolox-dev`.
2. Pull request `apolox-dev` → `apolox-master`, merge it.
3. Run `release.yml` on `apolox-master` (workflow_dispatch, `publish=true` to publish at once). It refuses any other branch
   except `claude/release-*` (for re-releasing an older version).

Checks (`pull-request.yml`: unit tests and the advisory check) run on pull requests and pushes to both `apolox-dev` and
`apolox-master`.

## Dev builds and release builds

Every build is a **development build** unless the release workflow made it: `package.json` has `"apoloxChannel": "dev"`,
and only `release.yml` changes it to `release` (`npm pkg set apoloxChannel=release`, not committed). So local builds
(`scripts/dev/build-linux.sh`), test debs, merge and nightly builds are dev builds, and merging `apolox-dev` into
`apolox-master` never conflicts on it.

A development build has:
- a warning at startup (once per version): this build is for developing and fixing bugs;
- "(development build)" after the version on the About page;
- **Developer options** in Settings, Advanced: **Extra logging** writes `[debug]` lines to the log (tab fill times,
  network share decisions, song cache per folder; the indexing worker gets the setting too).

## Safeguards: dev-only features never reach a release

1. **One switch:** `DevBuild.isActive` (`src/app/common/application/dev-build.ts`). Every dev-only feature checks it.
   A release build ignores dev settings left over from a dev install (extra logging stays off, no warning).
2. **`Logger.debug` writes nothing in a release build,** even if the flag were forced on.
3. **The release workflow checks itself:** `scripts/dev/check-release-channel.js` before building (package.json) and
   after the Linux build (the `package.json` inside `app.asar`); either fails the release when it is not `release`.
4. **Tests:** `src/app/services/dev-build/dev-build.service.spec.ts` (release: no warning, no extra logging, no
   developer options in the Settings search; the check script's exit codes).

Adding a dev-only feature: put it behind `DevBuild.isActive` (in templates: `*ngIf` on `devBuildService.isDevBuild`), mark
Settings search entries `devOnly: true`, and add a "release build: nothing of it" case to the spec.
