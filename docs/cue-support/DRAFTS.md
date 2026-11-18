# CUE sheet support: drafts and open questions

Items here are **not implemented** (unless marked otherwise). Each says what it would do, what it would change and why it is risky or uncertain,
so they can be reviewed before anything is built. Status values: `draft`, `approved`, `implemented`, `rejected`.

## D1. Block destructive file actions on CUE tracks: `draft`, high priority

**Problem.** A virtual track points at the whole album file. Any action that touches "the track's file" would act on the entire album:
- *Delete file from disk / move to trash* would remove every track of the album.
- *Edit tags* would write the new title, artist and so on into the one shared FLAC, changing the tags of the whole album.
- Writing ratings or ReplayGain into the file has the same problem.

**Proposal.** Detect virtual tracks (they have a CUE start offset) and disable or warn on those actions, with a clear message.
Optionally allow tag edits that are stored only in the Dopamine database.

**Risk.** Touches several UI components and services. Needs a decision on the database-only tag edit option.

## D2. Gapless and crossfade players load the whole file: `draft`

**Problem.** `GaplessAudioPlayer` and `CrossfadeAudioPlayer` decode the full file into an `AudioBuffer` (32-bit float). A 60 minute stereo
44.1 kHz rip is about 1.3 GB in memory, which is likely to fail or freeze the app.

**Proposal.** Either (a) always play CUE tracks through the streaming `LegacyAudioPlayer`, or (b) decode and slice only the needed range.
(a) is simple and safe but gives up crossfade for CUE tracks. (b) keeps all features but is a bigger change to audio code.

**Risk.** Changes which player is used depending on the track. Behaviour should be reviewed before it is enabled.

## D3. Hide the raw album file when a CUE sheet covers it: `draft`

**Problem.** If the album's `.flac` is indexed as a normal track and its CUE tracks are also indexed, the album appears twice.

**Proposal.** When a CUE sheet is successfully parsed and references an audio file, skip indexing that audio file as a standalone track.
If the sheet cannot be parsed, fall back to the old behaviour so nothing disappears.

**Risk.** Changes what users see after re-indexing. Existing database rows for the raw file would need to be removed.

## D4. FLAC files with an embedded CUESHEET: `draft`, not started

Some rips store the sheet inside the FLAC instead of a separate `.cue`. Not covered by the first version. Needs a look at what `node-taglib-sharp` exposes.

## D5. Multi-`FILE` sheets and per-disc albums: `draft`, not started

A sheet with several `FILE` entries (one file per disc) is parsed, but disc numbers and album grouping are not decided yet.

## D6. Hidden track one audio before `INDEX 01`: `draft`

If track 1 has `INDEX 00` before `INDEX 01`, that audio is currently skipped (track 1 starts at `INDEX 01`). Options: leave as is, or
expose it as a separate hidden track. Left as is for now.
