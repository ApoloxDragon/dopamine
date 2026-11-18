# CUE sheet support: drafts and open questions

Items here are **not implemented** (unless marked otherwise). Each says what it would do, what it would change and why it is risky or uncertain,
so they can be reviewed before anything is built. Status values: `draft`, `approved`, `implemented`, `rejected`.

## D1. Block destructive file actions on CUE tracks: minimal guard `implemented`, full UX still `draft`

**Problem.** A virtual track points at the whole album file. Any action that touches "the track's file" would act on the entire album:
deleting one song would trash the whole album, editing one song's tags would rewrite the tags of the shared FLAC.

**What was implemented (safety only, no new features).** Because this feature is what creates the risk, a minimal guard was added:
- *Delete*: `CollectionService.deleteTracksAsync` skips CUE tracks entirely (no file deleted, no database row removed), logs a warning and
  returns `false`, so the existing "An error occurred while deleting songs" message is shown. Normal tracks in the same selection are still deleted.
- *Edit tags*: `DialogService.showEditTracksAsync` shows "Songs from a CUE sheet album cannot be edited..." instead of opening the editor
  when the selection contains a CUE track. New English text key `cue-tracks-cannot-be-edited` (other languages fall back to English).
- *Rating*: never written to the file of a CUE track (it was only ever written to `.mp3`, now made explicit).
- *Album artwork*: embedding artwork from the album editor is allowed: it writes to the real album file, once per file. This is the correct
  meaning for a single-file album.

**Still a draft (your decision).**
- Allow editing CUE tracks by storing the changes only in the Dopamine database (or by rewriting the `.cue` file).
- Better wording/UX, for example hiding or disabling the menu items instead of showing an error afterwards.

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

## D8. Folders view shows the album file, not its CUE tracks: `draft`, not started

The Folders view lists files on disk, so a single-file album appears there as one long file. Collection views (albums, artists,
genres, tracks, playlists) show the CUE tracks. Making the Folders view expand sheets is possible but separate work.
