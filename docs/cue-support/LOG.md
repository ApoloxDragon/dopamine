# CUE sheet support: development log

A general overview of what was added and changed while adding single-file-album (`.flac`/`.wav` + `.cue`) support.
This is **not** a replacement for the git history. It records intent and impact in plain language.
Newest entries are at the bottom. Add entries with `scripts/dev/devlog.sh`.

Entry kinds: `Added`, `Changed`, `Fixed`, `Tooling`, `Note`. Anything uncertain or risky goes in [DRAFTS.md](DRAFTS.md) first.

## Design summary

- A CUE album is expanded into one **virtual track** per `TRACK` entry. The audio file is never modified or split.
- Each virtual track has a unique identity path of the form `<audio file path>|<track number>` (for example `/music/Oracles.flac|3`),
  so queue, play statistics and playlists keep working as they key on path.
- Each virtual track also stores the real audio file path plus a start and end offset in milliseconds.
- A track ends where the next one starts (`INDEX 01`), so pregap audio is never dropped. The last track ends at the end of the file.
- Time format is `mm:ss:ff` with 75 frames per second.

## Log

- **2026-11-18** · `Tooling` · Added dev scripts in scripts/dev
    - check.sh: quiet jest/tsc runner
    - fixtures.sh: generates a synthetic FLAC/WAV + CUE album with ffmpeg
    - save.sh: commit with trailers and push with retries
    - devlog.sh: appends to this log

- **2026-11-18** · `Added` · CUE parser (main/background-work/indexing/cue-parser.js)
    - Decodes UTF-8/UTF-16/Windows-1252, parses REM/PERFORMER/TITLE/FILE/TRACK/INDEX, converts mm:ss:ff at 75 fps, builds track ranges

- **2026-11-18** · `Fixed` · CUE parser: TextDecoder now taken from Node util (works in jest and the worker), Latin-1 fallback

- **2026-11-18** · `Added` · CUE parser spec (31 tests) built from 3 real EAC sheets plus edge cases
    - Verified against all 4 uploaded sheets (Oracles 10, Mafia 5, Veleno 13, Agony 11 tracks) and the ffmpeg fixture

- **2026-11-18** · `Changed` · Database: Migration15 adds Track.AudioPath, CuePath, CueStartMs, CueEndMs (+ index on AudioPath)
    - Additive only (ALTER TABLE ADD COLUMN). Existing rows keep NULL and are treated as normal tracks.
    - Track entity (TS and worker JS), select query parts and both track repositories read and write the new columns.
    - Risk: low. Migrations cannot be rolled back, but adding nullable columns does not change existing data.

- **2026-11-18** · `Tooling` · scripts/dev/db-sandbox.js builds a SQLite db from the real migrations for repository checks
    - Requires better-sqlite3 built for Node (npm rebuild better-sqlite3)

- **2026-11-18** · `Added` · Worker indexing of CUE albums
    - cue-track-path.js: virtual path helpers ('<audio file>|<track number>')
    - cue-sheet-reader.js: reads and caches sheets, resolves the FILE line to an audio file on disk (see DRAFTS D7)
    - IndexablePathFetcher emits one path per cue track and skips the covered album file (DRAFTS D3)
    - TrackFiller reads tags from the real album file, then applies sheet values (title, performer, album, album artist, genre, year, number, count, start/end, duration). Lyrics and file rating are not copied to cue tracks.
    - TrackVerifier checks the album file and the sheet for changes; TrackRemover keeps cue tracks while file, sheet and track number exist
    - TrackAdder replaces an old whole-file row by the cue tracks (database row only, never the file)
    - All new constructor arguments are optional and last, so existing behaviour and the 152 existing tests are unchanged

- **2026-11-18** · `Fixed` · Whole-file track stayed listed until a second re-index after adding a sheet (indexer runs remove before add); TrackAdder now replaces it immediately

- **2026-11-18** · `Tooling` · index-sandbox.js runs the real indexing pipeline on a folder; cue-scenarios.sh runs 10 end-to-end scenarios; db-sandbox.js now reopens existing files
    - Verified with the real Oracles and Veleno sheets next to silent FLACs of album length

- **2026-11-18** · `Added` · Renderer understands CUE tracks
    - TrackModel: isCueTrack, audioPath, cueStartSeconds, cueEndSeconds; src/app/common/utils/cue-track-path.ts mirrors the worker helper
    - Artwork (album/track image, artwork indexing) and 'show in folder' use the real album file
    - File lyrics (embedded, .lrc, .srt) are not used for CUE tracks: they belong to the whole album

- **2026-11-18** · `Changed` · Safety guard for CUE tracks (minimal part of DRAFTS D1)
    - Delete skips CUE tracks (no file or row removed) and reports the existing error
    - Edit tracks shows a new message (en.json key cue-tracks-cannot-be-edited) instead of writing tags into the shared file
    - Album artwork embedding writes once per real file
    - Risk: low, it only blocks actions. Explained in DRAFTS D1.

- **2026-11-18** · `Tooling` · Downloaded the Electron binary (node node_modules/electron/install.js) so renderer specs that import electron can run
