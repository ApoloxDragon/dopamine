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

## D3. Hide the raw album file when a CUE sheet covers it: `implemented`, needs your review

**What it does.** When a `.cue` sheet is parsed and its audio file is found, that audio file is no longer indexed as one long track.
Only its CUE tracks appear. If the album file was already in the collection as one track (from before the sheet existed),
that database row is replaced by the CUE tracks during the same indexing run.

**What changed.** `IndexablePathFetcher` skips covered audio files. `TrackAdder` deletes the old whole-file row when it adds CUE tracks.
`TrackRemover` also removes whole-file rows that are covered (a safety net).

**Why it was implemented now.** Without it every CUE album shows twice (the long track and its tracks). It is reversible:
delete or rename the `.cue` and the next re-index brings the whole-file track back (covered by `scripts/dev/cue-scenarios.sh`).

**Risk.** Only database rows are deleted, never files. What is lost when a whole-file row is replaced: its play count, skip count,
rating and love, as stored in the database for that one long track. If a sheet cannot be parsed or its file is not found, nothing is hidden.

## D4. FLAC files with an embedded CUESHEET: `draft`, not started

Some rips store the sheet inside the FLAC instead of a separate `.cue`. Not covered by the first version. Needs a look at what `node-taglib-sharp` exposes.

## D5. Multi-`FILE` sheets and per-disc albums: `draft`, not started

A sheet with several `FILE` entries (one file per disc) is parsed, but disc numbers and album grouping are not decided yet.

## D6. Hidden track one audio before `INDEX 01`: `draft`

If track 1 has `INDEX 00` before `INDEX 01`, that audio is currently skipped (track 1 starts at `INDEX 01`). Options: leave as is, or
expose it as a separate hidden track. Left as is for now.

## D7. Guessing the audio file when the sheet's FILE name matches nothing: `implemented`, needs your review

**What it does.** `CueSheetReader` resolves the `FILE` line in this order: exact name, different case, same name with another audio
extension (sheet says `.wav`, disk has `.flac`), the audio file named like the sheet, and finally the only audio file in the folder.

**Why.** Your Veleno sheet names a `.wav`, and sheet names often do not match after renaming or converting.

**Risk.** The last step is a guess. A folder with exactly one audio file and an unrelated `.cue` would get that file split by the wrong sheet.
Tracks that start after the end of the file are dropped, which limits the damage. It can be removed if you prefer strict matching.
