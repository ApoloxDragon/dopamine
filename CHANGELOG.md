# Dopamine change log

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.3.3-apolox] - 2026-11-25

Easier music from a home server. ApoloxDragon's fork of Dopamine, based on Dopamine 3.0.12 by Digimezzo.

### Added

- "Add a network folder" can list the network drives your computer is already connected to (for example a share opened
  in your file manager on Linux), so you just pick the music folder on them. It also understands smb:// addresses: a
  connected share is found, and one that isn't can be connected as a guest after asking. Looking for network drives is
  off until you turn it on (Settings, Collection, or in that window).

## [3.3.2-apolox] - 2026-11-25

More ways to enjoy what's already in your library. ApoloxDragon's fork of Dopamine, based on Dopamine 3.0.12 by Digimezzo.

### Added

- Like or dislike whole albums and artists (right-click an album or artist). Liked albums get their own row at the top
  of the Albums page. Smart shuffle and continuous play leave out disliked albums and artists.
- Your year in music, at the top of the Statistics page: listening time and plays this year, your top 5 songs, albums and
  artists, your longest streak, your most played day and when you played your first song of the year. Like "Wrapped",
  but it stays on your computer.
- Fix an album's title, artist, year, genre or disc numbers with a small `dopamine.json` file in its folder, without
  changing your music files. Two folders like "Album (CD1)" and "Album (CD2)" can become one album with two discs this way.
  See docs/album-details-file.md.
- Continuous play (Settings, Behavior): when the queue ends, the music keeps going with similar songs from your library:
  the same artists, genres or years, liked songs first and disliked songs never. Added songs have a small mark in the
  queue. Off by default.

### Good to know

- The database is upgraded (one new table for album and artist likes). Nothing existing changes, and 3.3.1 can still
  open it.

### Changed

- The "Add a network folder" and sleep timer "Other time…" windows now explain what to type, with examples that fit on
  screen.

## [3.3.1-apolox] - 2026-11-24

A release for listening at home: music on a home server keeps working when the server is asleep, and some small
favourites from other players. ApoloxDragon's fork of Dopamine, based on Dopamine 3.0.12 by Digimezzo.

### Added

- Smart shuffle (Settings, Behavior): shuffle favours songs you like and rate highly, plays disliked songs last, and
  avoids the same artist or album twice in a row. Off by default; every song still plays.
- "Recently added" and "Recently played" rows of album covers at the top of the Albums page. Click a cover to see its
  songs, double-click to play it. The rows can be folded away.
- Sleep timer (the moon button in the player): stop the music after 15, 30, 45, 60 or 90 minutes, another time you
  type, or at the end of the current song. The time left counts down in the player, you can add 15 minutes, and the music
  fades out slowly at the end.
- Like and dislike buttons (thumbs up and down) next to each song and in the player, shown by default. They replace the
  heart: songs you loved are now liked. Star ratings stay as they are.
- "Add a network folder" in Settings, Collection: type the path of a shared folder (for example \\\\192.168.1.10\\music on
  Windows, or a mounted share such as /mnt/music on Linux). A share that is offline right now can still be added.
- When a music folder can't be reached during a refresh, a short message says so. Its songs stay in your collection.
- A song whose folder can't be reached is skipped with a short message, instead of stopping with an error. If many songs in
  a row can't be reached, playback stops.
- A small separate tool for the terminal, `tools/alac-to-flac`, turns Apple Lossless (.m4a) songs into FLAC without changing
  the sound at all. It checks every song after converting it, and keeps the tags and the cover. See its README.
- Two refresh buttons in Settings, Collection: "Fast refresh" only looks at songs that were added, changed or removed,
  and "Full refresh" reads every song again (what "Refresh now" did before).

### Fixed

- Music on a network share or an external drive is no longer removed from your collection when the share or drive can't
  be reached (server asleep, laptop away from home, drive unplugged). The songs stay, with their play counts and ratings,
  and are checked again once the folder is back. Refreshing is also much faster while it is away.
- The total size shown under your songs is right again. Albums ripped as one big file with a .cue sheet were counted once
  for every song on them, so a library could show 177 GB when it was really 53 GB.

## [3.3.0-apolox] - 2026-11-19

A release full of fixes. Many were found by testing the app with deliberately silly input, and by checking a real music
library. ApoloxDragon's fork of Dopamine, based on Dopamine 3.0.12 by Digimezzo.

### Added

- Albums split into discs, like "Album (CD1)" and "Album (CD2)", now show their cover on Discord too.
- Album covers kept in a subfolder such as "Artwork", "Scans" or "Covers" are now found (common with vinyl rips and box sets).

### Fixed

- Pausing with fade on now fades out smoothly every time. Before, it cut off almost at once after the first fade in.
- If your audio device disappears during a fade, the music still pauses or stops instead of playing on while the app says it is paused.
- Albums with a .cue sheet: songs no longer get mixed up when the sheet has odd or repeated track numbers, and every song
  shows the right track count (vinyl rips showed "track 3 of 1").
- Apple Lossless (.m4a) songs now show their bit rate instead of 0.
- Playing a very large selection (more than about 1000 artists or genres at once) works again.
- Artists, albums and genres with unusual characters in their names (like "AC_DC" or "100%") now find exactly the right songs.
- Smart playlists with an unusual song limit or number no longer fail to open.
- Discord no longer drops your status for songs with very short, very long or emoji-heavy titles.
- A huge file that only pretends to be a .cue sheet is skipped instead of slowing the app down.

### Good to know

- After updating, press "Refresh now" once (Settings, Collection) so track counts, bit rates and covers are updated.

## [3.2.2-apolox] - 2026-11-19

ApoloxDragon's fork of Dopamine, based on Dopamine 3.0.12 by Digimezzo.

### Added

- Detailed statistics, an opt-in switch on the Statistics page (off by default). Everything stays on this computer:
    - How songs end: finished, skipped or stopped, the average completion, the most skipped songs and the songs you always finish
    - Which parts of a song you heard, shown as a bar under each play in the listening history (parts heard more than once show stronger)
    - When you listen: listening time per weekday and hour, and per day (last 7 or 30 days) or month (last year, all time)
    - Your current and longest streak of days with music, and when you first and last played each top song, album and artist

## [3.2.1-apolox] - 2026-11-19

ApoloxDragon's fork of Dopamine, based on Dopamine 3.0.12 by Digimezzo.

### Changed

- The database uses SQLite's WAL mode, so the app no longer freezes or fails to save (play counts, ratings, statistics) while the collection is being indexed. If you back up `Dopamine.db` by hand, close Dopamine first, and copy `Dopamine.db-wal` and `Dopamine.db-shm` too if they are there

### Fixed

- Listening statistics: songs played while the collection was being indexed were not recorded, or lost their last seconds ("database is locked"). Such writes are now retried
- CUE albums whose FLAC file has a cover without a file type (MIME type) did not play ("open context failed"). They now play: such files are streamed through the app with the cover hidden from the player. The file itself is not changed

## [3.2.0-apolox] - 2026-11-19

ApoloxDragon's fork of Dopamine, based on Dopamine 3.0.12 by Digimezzo.

### Security

- No critical vulnerabilities left in the dependencies (there were 2), and far fewer high ones. 164 known advisories went down to 77, and none were added
- Every change is now checked for new critical or high vulnerabilities before it can be released

### Fixed

- The AppImage could fail with "Permission denied" when started by another user than the one who built it (its folders were owner-only)
- The progress bar was missing from the Discord Rich Presence
- Update check with release tags written in capitals (for example V3.1.0-Apolox)
- CUE sheets: a FILE name that differs only in spaces or punctuation from the file on disk is found (when only one file matches), and spaces inside quoted titles are removed
- CUE tracks that cannot be played now log why (the media error), to find the cause

### Changed

- Faster and more reliable builds: exact dependency installs, cached downloads and parallel tests

## [3.1.0-apolox] - 2026-11-19

ApoloxDragon's fork of Dopamine, based on Dopamine 3.0.12 by Digimezzo.

### Added

- Single-file albums with a CUE sheet (for example a FLAC or WAV CD rip with a .cue file) are shown and played as separate tracks, gapless between tracks
- Statistics page: listening time, plays, top songs, albums and artists, and listening history, for the last 7, 30 or 365 days or all time. Everything stays on your computer. The history can be cleared
- Parametric equalizer, next to the graphic equalizer: up to 20 bands (peak, shelves, low/high-pass, notch) with frequency, gain and Q, a preamp and clipping protection
- Import and export of AutoEQ and Equalizer APO files: ParametricEQ.txt for the parametric equalizer, GraphicEQ.txt fitted to the graphic equalizer
- Optional fade when pausing, resuming and stopping, from 1 ms to 60 s, with an optional separate fade-in duration
- Discord Rich Presence shows "Listening to" with the artist, song, album, album cover and a progress bar. The album cover is looked up on Last.fm (can be turned off)

### Changed

- The Albums page is shown by default
- Updates are checked against this fork's releases
- Security updates: fast-xml-parser 4.5.7, moment 2.31.0

### Fixed

- Album covers missing or outdated on the lock screen and in the operating system's media controls (large covers and cached covers were not shown)
- Long song titles no longer make Discord drop the Rich Presence

## [3.0.12] - 2026-11-07

### Added

- Slider to resize album covers in the list of albums
- Support for WebP album covers
- Synced lyrics support for Windhawk's Desktop Audio Visualizer Plus
- Support for the Turkish alphabet in the list of artists
- Audio device output settings
- Skipping of prefixes in the artists screen has been re-added, but this time it's configurable.
- It is now possible to create and use your own translations
- Flatpak installation via FlatPark (Thank you @jing2uo)

### Changed

- Updated the German translation (Thank you @mgfirewater)
- Updated the Portuguese (Brazil) translation (Thank you @henrique-coder)
- Updated the Turkish translation (Thank you @mertssmnoglu)
 
### Fixed

- Wave progress bar glitches
- Album cover shown even though a file does not have any
- Artists tab doesn't filter the albums when artist splitting is disabled
- Metadata (Album, Year, Cover) is sometimes not displayed in the showcase view
- Last.fm "Now Playing" expires prematurely (Thank you @jonson-zero)
- Memory leak in the audio player, causing glitches that worsen over long playback sessions. (Thank you @ThatOnePersonCalledAnon)
- Accented lyrics lookups (Thank you @dbqp01)
- Star ratings of loved songs are not backed up or restored correctly
- Memory leak on Linux causing a rogue Dopamine process to remain alive even after closing
- Drop shadows on now playing pictures have banding and look ugly

## [3.0.11] - 2026-09-25

### Added

- Added optional wave progress bar
- Ctrl+F now selects all text in the search box for quick replacement
- Added optional Stop button (Hidden by default, but can be enabled in the settings.)
- Scroll position is now remembered when switching screens
- Added buttons to the playback queue to clear the queue and to add the queued songs to a playlist
- Added album release date to album image tooltips and optionally on the nog playing page
- Added a playback speed control (Thank you @henryshuen)

### Changed

- Updated the Simplified Chinese translation (Thank you @jeremyooh)
- Updated the Vietnamese translation (Thank you @honhatduy)

### Fixed

- Adding artist image doesn't always work
- Crash when displaying rich lyrics of songs with a lot of artists
- On KDE, Dopamine appears under "Lost & Found" in the application menu instead of "Multimedia" (Thank you @adem4ik).
- Failure to index files with malformed TXXX frames

## [3.0.10] - 2026-08-28

### Changed

- Improved the equalizer design
- Updated the German translation (Thank you @mgfirewater)
- Updated the Russian translation (Thank you @adem4ik)

### Fixed

- Empty strings in Equalizer with incomplete language packs
- When sorting large playlists, songs sometimes still move back to their original position.
- Mini player has incorrect size on macOS
- Window restore issues on macOS and GNU/Linux (Wayland)

## [3.0.9] - 2026-08-19

### Added

- Added an equalizer
- Added a clear selection button on artists, genres, albums, playlist folders and playlists screens.
- Added an option to show a more compact total duration in songs lists


### Changed

- Updated the Portuguese (Brazil) translation

### Fixed

- Crash on startup when failing to get the system color when "Follow system color" is enabled
- Snap version does not start on the first launch
- Artists whose names start with accented letters (e.g. Ş, Ü) incorrectly grouped under # instead of their base letter in the artists list
- Tracks of multi-disc albums were grouped by disc number across albums instead of being listed per album
- When sorting large playlists, songs sometimes move back to their original position.
- Newline character not processed correctly on some lyrics

## [3.0.8] - 2026-08-05

### Added

- Pressing a letter on the keyboard, scrolls to the pressed letter on artists and genres screens and selects all artists and genres starting with that letter focussing on albums for those artists or genres
- Added option to show artist image as background (Thank you @FranzDeschler)
- Added option to edit artist images (Thank you @FranzDeschler)

## Changed

- Improved rating and love backup
- Updated the Bulgarian translation (Thank you @kukata)
- Updated the Simplified Chinese translation (Thank you @jeremyooh)
- Updated the Portuguese translation (Thank you @Blackspirits)
- Updated the Vietnamese translation (Thank you @honhatduy)

### Fixed

- Scroll issues on the playlists screen when using compact songs list
- "Show in Folder" in Snap version does not work for directories outside of /home (Thank you @mvanhorn)
- Snap package is broken

## [3.0.7] - 2026-07-03

### Added

- Added automatic rating and love backup for situations where the database needs to be reset
- Added a search field on the queue screens
- Added possibility to download and show artist images in the list of artists (Thank you @FranzDeschler)
- Added BPM filter to smart playlists
- Added Kadbury theme (Thank you @kkdeep)
- Added a button to jump to the playing song on each songs list
- Added option to show a more compact song list
- Added ListenBrainz scrobbling (Thank you @ugokitakunai)

### Fixed

- ReplayGain issues
- Double-clicking next to an artists group letter causes a crash
- Album shuffle button in Genres tab shuffles globally instead of within the genre (Thank you @UrielJaloto)
- Lyrics are too small and sizing doesn't work when there are no smart lyrics
- Window is outside of the screen when external display is disconnected

## [3.0.6] - 2026-06-13

### Fixed

- Manually edited album covers are overwritten on the next collection refresh
- Fixed AppImage package not working on modern GNU/Linux distributions
- Deleting song from playlist sometimes fails
- Playback controls only work when clicking on upper half of the buttons
- It's unclear that files must be tagged with an external ReplayGain scanner (for example rsgain) before normalization can take effect.
- Change to Artist or Album tags is not reflected in the song list view nor in the Now Playing information
- ReplayGain issues
- Smart playlist filters ignore text containing accents or other special characters
- Some MP3 files trigger an "MPEG header not found" error due to a too-narrow initial MPEG header scan range

### Changed

- Updated the Vietnamese translation

## [3.0.5] - 2026-05-31

### Added

- Added an Adwaita theme, because GNU/Linux deserves some love.
- Added Windows taskbar media controls accessible by hovering over the app icon in the taskbar
- Added a "Refresh now" button to the main menu
- Added ReplayGain support
- Added option to show album name on the now playing page
- Added possibility to edit the album cover

### Changed

- Discord Rich Presence says "Listening to" instead of "Playing"
- Improved scaling of different parts of the user interface
- Updated the Czech translation
- Updated the German translation
- Updated the Hebrew translation
- Updated the Russian translation
- Updated the Vietnamese translation

### Fixed

- Saving a rating to an MP3 file could create an ID3v1 tag, causing genres to be stored and displayed as their numeric ID3v1 code (e.g. "Eurodance" becoming "54")
- It is not possible to edit songs from the Songs screen
- There is no scroll bar in the smart playlist editor
- Loop one does not work correctly when using gapless or crossfading playback
- When exiting Dopamine, the Discord status doesn't disappear.
- It's not always clear when Dopamine is refreshing the collection

## [3.0.4] - 2026-04-08

### Added

- Added ability to enlarge the cover image on the Now playing screen
- Clicking the visualization switches it between the available styles
- Added karaoke-style SRT lyrics support (Thank you Friendlygamemaker!)

### Changed

- Updated the Portuguese (brazilian) translation
- Updated the Swedish translation

### Fixed

- Delete button is not visible when folder is not selected in "Manage collection" screen
- Window size increases when dragging
- Attempting to delete a song from a smart playlist, breaks the playlist.
- Deleting of a song from a playlist while filtering via search, removes most of the files from the playlist.
- Playback progress bar does not react to touch input
- The cover image on the Now playing screen has glitches
- Browsing folders on a NAS gets stuck in an infinite loop
- Follow the system color does not work on GNU/Linux

## [3.0.3] - 2026-03-30

### Added

- Added shuffle option to the artist, genre and album context menus.
- Added shuffle all on artist, genre, album and songs screens.
- Added crossfade
- Added smart playlists
- Added Catppuccin and Dracula themes (Thank you BlackSpirits!)
- Added "Always on top" and "Lock position" options to the mini player context menu

### Changed

- Updated the Croatian translation
- Updated the German translation
- Updated the Italian translation
- Updated the Portuguese (brazilian) translation
- Updated the Portuguese (Portugal) translation
- Updated the Simplified Chinese translation
- Updated the Spanish translation
- Updated the Vietnamese translation

### Fixed

- Genres which are starting with numbers are incorrectly detected
- Play and skip count are not updated when collection songs are played from playlists
- Flac rating is lost after editing tags
- Dopamine window doesn't show when clicking on pinned Taskbar icon in Windows
- Error when deleting songs that are on a network drive
- The titlebar is only draggable in empty spots

## [3.0.2] - 2026-01-17

### Added

- Added a Highlights screen showing your most played albums
- Added Composers, Conductor and BPM to tag editor.

### Changed

- Updated the Turkish translation
- Updated the Vietnamese translation

### Fixed

- Fixed a crash that occurred when playing a song from the playback queue
- Fixed some album view issues
- Fixed an issue causing the wrong song to play when started from the Operating System

## [3.0.1] - 2025-12-19

### Added

- Added half-star rating support, expanding the song rating scale to a range of 0–10.
- Added song sorting options on the 'Folders' screen
- Added a button to toggle between the default expanded album view and Dopamine 2's compact album view
- Added the removable-media plug to the Snap configuration, allowing the Snap version of Dopamine to access /media.

### Changed

- Updated the Kurdish translation
- Updated the Russian translation
- Updated the Spanish translation
- Updated the Swedish translation
- Updated the Vietnamese translation

### Fixed

- m3u8 playlists are not recognized
- Ratings are not read from files
- Developer console opens when pressing F12
- Crash when trying to play a deleted file
- Song length in right sidebar displays double the time of the real length
- Some issues with fetching of lyrics
- Folders context menu opens too much the left on the Folders screen
- Crash when the user has no Music directory
- Crash when trying to play ALAC M4A file. Those are not supported. Instead of a crash, the user is now informed why the file doesn't play.
- Crash when starting files from the operating system's file browser
- Issue where the Edit song dialog replaces '/' by ';' for artists containing a '/' in their name
- GNU/Linux Snap issue that caused file dialog text to appear as squares instead of readable characters

## [3.0.0] - 2025-11-06

First release!

Highlights:

- Multi-platform support - Dopamine now runs seamlessly on Windows, GNU/Linux, and macOS.
- Playlist folders - Organize your playlists into folders for better structure and easier navigation.
- Gapless playback - Enjoy smooth, uninterrupted transitions between tracks.
- Logarithmic volume control - Experience more natural and precise volume adjustments.
- Artist splitting - Automatically split multiple artists using customizable separators (e.g., “ft.”, “feat.”).
- Album grouping options - Choose how albums are defined and displayed for greater control over your library organization.
- Last.fm integration - Scrobble your music and download artist information directly from Last.fm.
- Lyrics support - Display offline or online lyrics while listening to your favorite songs.
- Discord integration - Show your currently playing track on Discord in real time.
