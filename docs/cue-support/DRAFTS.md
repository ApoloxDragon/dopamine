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

## D10. Clearing the listening history: `implemented`

A "Clear listening history" button at the bottom of the Statistics page deletes the whole history (all periods) after a confirmation
dialog. It only deletes listening sessions: songs, their play counts, ratings and playlists are not touched. The song that is playing
while you clear keeps being recorded, as if it started at that moment. Removing single entries and exporting to CSV are still open ideas.

## D11. Two kinds of play counts: `note`, needs your review

The Statistics page counts plays from its own history: a song counts after half of it or 4 minutes was actually played (the Last.fm rule).
The play count Dopamine already showed for songs (Track.PlayCount) has its own older rule and also includes plays from before this feature existed.
So the two numbers can differ. The history starts empty when you install this version: earlier listening cannot be reconstructed
(only per-song play counts and the last-played date were kept before).

## D12. FLAC files whose cover has an empty MIME type do not play as CUE tracks: `implemented` (option 2, approved)

**Cause (confirmed on a sample of the real file):** the album FLAC has a PICTURE block with an empty MIME type (the JPEG
data itself is fine). Chromium's FFmpeg refuses to open such a file in the `<audio>` element
(`DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed`). CUE tracks use that element (the streaming player);
normal tracks are decoded differently, which is why other songs play. Adding an empty-MIME cover to a good FLAC
reproduces it; removing the cover, or importing it again with `metaflac`, fixes it (audio identical).

**Options:**
1. Fix the files (no app change): export the cover, remove it, import it again; `metaflac` sets the MIME type. Lossless,
   but it changes the user's files. A script could find and fix all such files in a folder (dry run first).
2. Fix in the app: serve CUE album files to the `<audio>` element through a small custom protocol that reads the file
   and changes one byte, the type of such a PICTURE block, to PADDING, so FFmpeg skips it. Byte offsets stay the same,
   so seeking (HTTP ranges) maps 1:1. Needs care: the protocol must only serve audio files of the collection, and must
   support ranges. Playback change, so a high-effort session.
3. Fall back to a decoding player for such files: not suitable, it would decode the whole album into memory (about
   1.3 GB per hour).

**Implemented (option 2):** `main/audio-protocol.js` registers `dopamine-audio://`. It serves absolute paths of supported
audio files only, read-only, with HTTP ranges, and in FLAC files changes the type byte of every PICTURE block to
PADDING while streaming. LegacyAudioPlayer uses it only as a fallback for CUE tracks: when file:// fails with media
error 4, the same file is opened once more through the protocol, and a warning is logged. Files that open normally
keep using file://. Checked:
- `main/audio-protocol.spec.js`: patching, ranges, refusals
- `scripts/dev/playback-harness/electron-fallback.js`: real Electron, real protocol and player, a 30 MB sample of the
  user's file. It plays from the right place and seeking works; a good file still uses file://.

## D13. The same FLAC files as normal (non-CUE) tracks: `draft`, not started

The gapless player (the default) decodes whole files with `decodeAudioData`, which fails on the same files ("Unable to
decode audio data", checked in Electron). The crossfade and legacy players use the `<audio>` element, which fails as
in D12. This is the same in upstream Dopamine. Fix: the same fallback in each player. The gapless player would
re-fetch through the protocol (registered with `supportFetchAPI`) when decoding fails; the crossfade and legacy players
would retry the element with the protocol URL. Playback change, so a high-effort session, with a test per player.

## D14. The indexing worker keeps the database busy: `implemented` (WAL, approved for 3.2.1)

While the collection is indexed (63 s in a user's log), writes from the window fail with "database is locked". The
listening tracker now retries them (3.2.1). Other writes from the window (play counts, ratings, playlists) can still
fail during indexing, also in upstream Dopamine. A root fix is SQLite's WAL journal mode
(`PRAGMA journal_mode=WAL`): readers and the writer no longer block each other. That is a lasting change to the
database file (it adds -wal and -shm files next to it), so it needs your decision and a test with the real indexer.

**Implemented:** both DatabaseFactory classes (window and indexing worker) set `PRAGMA journal_mode = WAL` when they
open the database (a no-op once the file is in WAL mode; retried by the next connection if the switch fails).
`scripts/dev/db-lock-check.js` compares both modes with a continuous writer like the indexer: before, the window got
1 write through in 4 s and was blocked for 4 s; with WAL, 58 writes, none failed, longest 28 ms (and the indexer wrote
about 6 times faster). Database and unit tests pass.

## D15. Android version: `draft`, on hold

Written up in [docs/android-plan.md](../android-plan.md). Electron and Node parts (database, library scan, tags,
playback) have no Android equivalent; background playback needs a native Media3 service. Routes: Capacitor (most
reuse), native Kotlin, or forking an existing FOSS Android player (the owner's preference for now). Dopamine stays
desktop-only until decided.

## D16. Equalizer: warn when the curve can clip: `draft`, low priority (owner keeps 0 dB on purpose)

Found in the owner's settings: the parametric profile (QCY H3 Pro, AutoEQ) is stored with preamp 0 dB, while the AutoEQ
file says -3.1 dB, and it has a +12 dB peak at 4 kHz. The import reads -3.1 dB correctly, so it was changed afterwards.
With 0 dB the curve peaks at about +3.1 dB, which can clip on loud masters. Nothing in the dialog says so.
Proposal: show the peak gain under the curve ("Peak +3.1 dB: may distort on loud songs") with a "Set preamp to -3.1 dB"
button. UI + 25 translations: medium effort.
Owner's answer: the 0 dB preamp is intentional (likes it loud). If this is ever built, it must only inform, never change the
preamp by itself, and should be easy to dismiss.

## D17. Albums split into "(CD1)" / "(CD2)" albums: `draft`, needs your decision

The library has albums tagged "Deceiver Of The Gods (CD1)" and "(CD2)" with no disc number, so they show as two albums.
Options: (1) leave as is; (2) an option to merge such albums in the album list, grouping by the title without the disc part
(the same rule as the Discord cover lookup) and sorting by disc; (3) only suggest retagging (album "Deceiver Of The Gods",
disc 1/2). Option 2 changes album keys, so it needs care with existing playlists and statistics: high effort.

## D18. A .cue copy inside Scans/ next to the real one: `note`

The Veleno album has a sheet in the album folder (works) and a copy in Scans/ that refers to a .wav. The copy is skipped
with a warning on every index. It is not resolved against the parent folder on purpose: two sheets for one album would
give every track twice. Deleting or renaming the copy (for example to .cue.old) stops the warning.


## D19. Change album details with a small file in the album folder: `implemented` (3.3.2, JSON only)

Owner's idea: fix small things such as an album's year without retagging every file, using a file next to the music.
Proposal: an optional `dopamine.json` in the album folder (or next to a .cue sheet), read by the indexer, for example:

```json
{ "year": 1970, "albumTitle": "Paranoid", "albumArtist": "Black Sabbath", "genre": "Heavy Metal", "discNumber": 1, "discCount": 2 }
```

- Only those fields, all optional; it overrides the tags and the .cue values for every song in that folder. The files are never changed.
- Read with a size limit and strict checks (unknown keys ignored, wrong types ignored and logged); torture-tested like the CUE parser.
- Changing the file triggers a re-read of that folder on the next collection refresh.
- `discNumber`/`discCount` would also give a simple answer to D17 (CD1/CD2 albums) without merging logic.
- Open question: JSON only, or also a simple `key = value` text format (easier to type)? JSON is stricter and easier to check.
Effort: medium to high (indexer, refresh detection, tests).

## D20. Network share under another name, reconnecting, song cache (3.3.4): `implemented`, risky parts noted

Cause seen in the 2026-11-25 log: the share was open in Files, but not at
`/run/user/1000/gvfs/smb-share:server=192.168.10.183,share=storage` (ENOENT). Most likely it was opened with a user name
this time, so GNOME named it `...,share=storage,user=<name>`. A missing gvfs-fuse would look the same; the log now says
which one it is (`describeMissing`).

Risky parts, and what limits them:
- **Stored paths are rewritten** when the same share (same server and share, any user or capitals, also KDE or a system
  mount) has the folder: Folder, Track (Path, SafePath, AudioPath, CuePath, AlbumKey3), RemovedTrack, QueuedTrack,
  TrackStatistic, PlaylistSessionTrack, ListeningSession (TrackPath, AlbumKey) and album likes. One transaction; whole
  folder names only; refused when the new place is already a music folder (no duplicate songs). Moves back the same way
  when the share returns under its first name.
- **`gio mount`** runs without a shell or terminal (arguments passed as a list, stdin closed, 20 s limit), as a guest
  when the stored path had no user, otherwise with the same user (GNOME uses its saved password). Automatic only with
  "Reconnect network drives" (off by default); otherwise Dopamine asks once per share per minute.
- **Writing into music folders**: `Dopamine/cache.json.gz` in each music folder, only when something changed, only into
  folders that are there, atomically (temporary file + rename). Read with limits (64 MB file, 512 MB unpacked), version
  check, known fields and types only, no paths leaving the folder. On by default; can be turned off.
A cache with broken contents is deleted and built again by the next refresh that reads songs; a read error (share hiccup) leaves it in place.
Open: the cache trusts size + modification time, like the fast refresh. A tag edit that keeps both (very rare) needs the
cache turned off for one full refresh.
