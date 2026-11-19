# Working on this fork (ApoloxDragon/dopamine)

Work on a `claude/...` branch with pull requests to `apolox-master`. Write overviews in `docs/cue-support/LOG.md` (use `scripts/dev/devlog.sh`) and anything uncertain or risky in `docs/cue-support/DRAFTS.md`. Explain drafts and risky edits before doing them. Don't delete code just to delete it.

## Effort and usage

The owner has a limited usage budget. Match the work to the session's effort level.

**Medium is fine for:**
- release and CI checks, rerunning workflows
- small UI, text or translation changes
- docs
- dependency bumps within a major version, checked with `scripts/dev/try-fix.sh`
- fixes where a log or test already shows the cause

**Needs high (or more):**
- Angular, Electron, RxJS or TypeScript major upgrades
- Electron hardening (contextIsolation, preload, removing @electron/remote)
- database migrations
- changes to audio playback (players, gapless, crossfade, equalizer, fade)
- security fixes
- refactors
- bugs that can't be reproduced

A UserPromptSubmit hook (`scripts/dev/effort-check.js`) flags these. If it fires and you don't know the session is on high, say so in one line and ask before starting.

**Limits that hold at every effort level:**
- After 2 failed attempts at the same fix, stop and report what you found instead of trying a third approach.
- Run single specs while working (`scripts/dev/check.sh <pattern>`) and the full suite once at the end. Use `scripts/dev/try-fix.sh` for dependency changes.
- Use the tools in `scripts/dev` (listed in `docs/dependency-upgrade-plan.md`) instead of doing the same steps by hand. If a repeated task has no tool yet, write one.
- Don't read large files whole: search them, or read the part you need. Keep command output short (`tail`, `grep`, quiet flags).
- Keep replies short. Only send files for major releases, or when asked.
- No subagents unless the owner asks.
