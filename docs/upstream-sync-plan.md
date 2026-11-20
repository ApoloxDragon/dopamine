# Keeping up with official Dopamine (upstream sync plan)

**Status: plan, for when Digimezzo releases the next major stable version.** Goal: keep everything from official Dopamine
**plus** everything this fork added, as a fork that no longer depends on GitHub's "fork" link (a detached fork).

## How the branches work

| Branch | What it is | Rule |
| --- | --- | --- |
| `master` | An exact copy of upstream (`digimezzo/dopamine`, branch `master`) | **Never commit to it.** Only update it from upstream |
| `apolox-master` | The fork: upstream plus our changes | All our work lands here through pull requests |
| `sync/upstream-<version>` | One branch per upstream release being merged | Made from `apolox-master`, merges `master` in, becomes a PR |

Merging (not rebasing) keeps the history honest: every upstream release shows up as one merge, and our 3.x-apolox
releases and tags stay valid.

## Where we are (2026-11-20)

From `scripts/dev/upstream-diff.sh`:
- Shared starting point: upstream on 2026-11-16 (Dopamine 3.0.12 plus website updates). Upstream has had no new commits since.
- The fork is 62 commits ahead: 222 files, about 21,600 lines added. 127 upstream files were changed; the rest are new files.
- The busiest upstream files we changed (where an upstream change will most likely conflict): `playback.service.ts`,
  `legacy-audio-player.ts`, `audio-equalizer.ts`, `equalizer.service.ts`, `track-filler.js`, `discord.service.ts`,
  `discord-api.ts`, `metadata.service.ts`, `settings.ts`, `external-artwork-path-getter.ts`, `indexable-path-fetcher.js`,
  `clause-creator.ts`, the equalizer dialog, the behaviour settings page, the workflows (`merge.yml`, `nightly.yml`),
  and all 25 translation files.

## Detaching the fork (once, when you decide)

GitHub only detaches a fork through GitHub Support ("Detach this fork" request; the repository, its issues and releases stay).
After that the "Sync fork" button is gone, so syncing `master` is done by a workflow or by hand:

```bash
git remote add upstream https://github.com/digimezzo/dopamine.git
```

```bash
git fetch upstream master && git push origin upstream/master:master
```

Better: a small workflow (`.github/workflows/sync-upstream.yml`, run by hand or weekly) that fetches upstream `master` into the
fork's `master` and fails instead of forcing if `master` ever has commits of its own. Upstream is public, so it needs no secrets.
Before detaching, the "Sync fork" button on GitHub does the same.

## Merging a new upstream release, step by step

1. **Update `master`** from upstream (the workflow or the commands above). Check that it is a fast-forward.
2. **Look before merging:** `scripts/dev/upstream-diff.sh`. It lists commits on each side, files changed on both sides,
   migration numbers added on both sides, and settings or translation keys added on both sides.
3. **Read upstream's change log** for that release and write down anything that touches the same features as ours
   (playback, equalizer, Discord, indexing, statistics, covers).
4. **Branch and merge:** `git checkout -b sync/upstream-<version> origin/apolox-master`, then `git merge origin/master`.
5. **Resolve conflicts with these rules:**
   - Keep upstream's change *and* ours. When both changed the same lines, take upstream's version and put our change back on top.
   - Our features stay behind their settings (detailed statistics, Discord covers, fades, equalizer modes), so upstream's
     defaults keep working.
   - `package.json` / `package-lock.json`: take upstream's versions, keep `versionSuffix: "apolox"`, then `npm install` to rebuild
     the lock file. Do not merge the lock file by hand.
   - Translations: keep both sets of keys; for the same key, upstream's text wins unless it is one of ours.
   - Workflows: keep ours (release builds, checksums, database tests); add upstream's new steps by hand.
6. **Database migrations** (see below): never merge two migrations with the same number.
7. **All gates** from [dependency-upgrade-plan.md](dependency-upgrade-plan.md): unit tests, database tests, harnesses, production
   build, screenshots of every page, the manual smoke test with a **copy** of a real database.
8. **Version:** the fork follows upstream's major and minor version: upstream 4.0.0 → our `4.0.0-apolox`, then 4.0.1-apolox
   and so on for our own fixes. Change log entry: "Based on Dopamine <version> by Digimezzo" plus what changed.
9. **PR to `apolox-master`**, merge builds on all platforms, then the release workflow as usual.

## Database migrations (the riskiest part)

Each migration has a number, stored in the database file (`PRAGMA user_version`); the app runs every migration whose number
is higher than the database's. Our releases already added **15, 16 and 17** (CUE columns, statistics). If upstream adds its
own migration 15, a database at our 17 would **never run it**, and a fresh install would run both 15s in a mixed order.

Rule when merging:
1. Keep our numbers as they are (users' databases are already at 17).
2. Give upstream's new migrations the next free numbers (18, 19, ...), in upstream's order, renaming the files and classes.
3. Make each moved migration safe to run on a database that already has our changes: check whether a column or table
   exists before adding it (SQLite has no `ADD COLUMN IF NOT EXISTS`; use `PRAGMA table_info`).
4. Add a database test: a database at our 17 and a fresh one both end at the same schema after migrating
   (compare `sqlite_master`), and a copy of a real database migrates without errors.
5. Write the mapping (upstream 15 → ours 18, ...) in the change log and in `docs/cue-support/LOG.md`.

If upstream ever moves to a different database or migration system, that release gets its own plan before merging.

## Things that must stay separate from official Dopamine

- `appId` is still `com.digimezzo.dopamine` (`electron-builder.config.js`), so both apps share settings and the database folder.
  That is fine while the fork is the only one installed. If you ever want both installed side by side, change the `appId` and the
  data folder name, with a one-time copy of the old data folder. Decide this before detaching.
- The update check already points at this fork's releases (`ProductInformation.releasesOwner`). Keep it that way when merging.
- Keep the license (GPL-3.0) and Digimezzo's copyright notices; add ours next to them.

## When upstream does something we already did

Upstream may add its own version of a feature this fork has (for example statistics or an equalizer change). Then decide per
feature: keep ours, switch to theirs, or combine. Note it as a draft in `docs/cue-support/DRAFTS.md` and explain the trade-offs
before changing anything. Data (statistics, settings) must be kept or migrated, never dropped.

## Effort

A small upstream release: one medium-effort session. A major release (for example 4.0 with an Angular or Electron upgrade of its
own): plan it like 3.4.0, step by step, high effort. If upstream's major upgrade overlaps with our 3.4.0 work, take upstream's
upgrade first and redo only what is left of ours.

## Tools

- `scripts/dev/upstream-diff.sh [upstream-ref] [fork-ref]`: commits on each side, files changed on both sides, clashing
  migration numbers, settings and translation keys added on both sides. Read-only.
