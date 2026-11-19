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

## D2. Gapless and crossfade players load the whole file: `implemented` (option a), needs your review

**Problem.** `GaplessAudioPlayer` and `CrossfadeAudioPlayer` decode the full file into an `AudioBuffer` (32-bit float). A 60 minute stereo
44.1 kHz rip is about 1.3 GB in memory. They also decide that a track has ended from the end of the file, so they cannot play a range.

**What was implemented.** Option (a): CUE tracks always play through the streaming `LegacyAudioPlayer`, which was given range support.
A new `CueAwareAudioPlayer` (created by `AudioPlayerFactory` around whichever player the settings choose) routes CUE tracks to it and
everything else to the configured player. If the configured player already streams (gapless and crossfade off), the same player is used.
Otherwise the streaming player is created only when the first CUE track plays. CUE tracks are never handed to the gapless/crossfade preload.

**What you get.**
- Gapless between tracks of the same CUE album, independent of the gapless setting: the audio element keeps playing across the boundary
  (no reload, no seek). Verified in real Chromium: same element, 0 seeks, 0 ms stall at every boundary (`scripts/dev/playback-harness/run.js`).
- Normal tracks behave exactly as before, with the player chosen in the settings.

**Trade-offs to review.**
- No crossfade into, out of, or between CUE tracks (crossfading between tracks of a continuous album is usually unwanted anyway).
- Moving from a CUE album to a normal track (or back) has the small gap of a normal non-gapless track change.
- With gapless or crossfade on, a second `AudioContext` exists once a CUE track has played (only one equalizer graph is active at a time;
  both are registered with the equalizer service).

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

## D9. Discord album cover lookup is on by default: `implemented`, needs your review

**What it does.** With Discord Rich Presence enabled (still off by default), the album cover is shown. Discord only accepts images from the
internet, so the cover is looked up on Last.fm (`album.getInfo`): the album title and album artist are sent to Last.fm. Results are cached per album
while the app runs. There is a separate switch under Settings > Online > Discord ("Show the album cover"), on by default because you asked for covers.

**Open points.**
- Whether the switch should default to off, for privacy.
- Albums that Last.fm does not know keep the Dopamine icon. Covers from your own files cannot be shown on Discord.
- Song titles of one character are padded to Discord's minimum length with a space. Not verified that Discord accepts this.
