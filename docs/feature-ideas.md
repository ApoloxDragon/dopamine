# Feature ideas (plan, not started)

Rule for everything here: it must still feel like Dopamine (a simple, fast player for your own music files). No accounts,
no streaming service, no social feed. Everything stays on the computer and can be turned off.

## 3.3.1 candidate: liking songs, albums and artists

Dopamine already has "love" for songs (a heart, off by default: Settings, Behavior, "Show 'Love'") and star ratings. Plan:
- Replace the heart with **like / dislike** (thumbs up / down), shown by default. Star ratings stay as they are.
  `Track.Love` keeps working: 1 = liked, -1 = disliked (new), 0 = neither, so existing hearts become likes.
- Disliked songs can be skipped in shuffle and smart playlists (an option, off by default).
- Like or dislike albums and artists too (thumbs on the album and artist pages and in their right-click menu).
  Disliked albums and artists are left out of smart shuffle and continuous play.
- A "Liked" section in the collection: liked songs, albums and artists, each sortable, playable as a whole.
- Liked songs as an automatic playlist ("Liked songs"), like Spotify.
- Storage: a new table `Liked (Kind, Key, Value (1 like / -1 dislike), LikedAtMs)` keyed by album key / artist name (needs a migration: high effort).
  Songs keep using `Track.Love`, so nothing existing changes.
- Optional: write the song heart to the file tag (like ratings can be) so it survives a new library.

## Album details from a file in the album folder

An optional `dopamine.json` next to the music (or the .cue sheet) fixes small things without retagging the files, for
example `{ "year": 1970, "albumTitle": "Paranoid", "discNumber": 1, "discCount": 2 }`. It overrides the tags for every song
in that folder; the music files are never changed. Disc numbers also solve "(CD1)/(CD2)" albums. Details and open
questions: D19 in `cue-support/DRAFTS.md`. Medium to high effort.

## Smart shuffle and continuous play

- **Smart shuffle:** shuffle that favours liked and highly rated songs, avoids disliked ones, and does not play the same
  artist or album twice in a row. Uses the play counts and skips from statistics. A toggle next to normal shuffle.
- **Continuous play (autoplay):** when the queue ends, keep going with similar songs from the library (same artist, genre
  or era, liked first) instead of stopping. Off by default; the added songs are marked in the queue.

## Other ideas, by how well they fit

Fits well (small or medium):
1. **Queue improvements:** "play next" vs "add to queue", save the queue as a playlist, clear played songs.
2. **Sleep timer:** stop (with fade out) after N minutes or at the end of the song/album. Presets 15, 30, 45, 60 and
   90 minutes plus a custom time; a countdown shows in the player (click it to add time or cancel).
3. **Recently added / recently played** views (data already exists: date added, statistics). Shown as two rows of
   album covers at the top of the Albums page (can be hidden), each with a "see all" list of songs and albums for the
   last 7, 30 or 90 days; recently played works even with detailed statistics off.
4. **Smart shuffle / "radio" from local files:** play songs similar to the current one by genre, artist and year.
5. **Album "Play from disc 2"** and grouping CD1/CD2 albums (see D17 in `cue-support/DRAFTS.md`).
6. **Lyrics view** improvements: synced `.lrc` scrolling full screen (lyrics already supported).
7. **ReplayGain / loudness normalisation** shown and toggled more clearly (already partly there).
8. **Year in review** from the statistics, like "Wrapped" but private: top songs, albums, artists and genres of the
   year, total listening time, longest streak, most played day, first and last song of the year. A few full-screen cards
   on the Statistics page, from December; can be saved as an image. Nothing leaves the computer.
9. **Keyboard shortcuts page** and a mini command palette (Ctrl+K: search songs, albums, actions).

Fits, larger:
10. **Gapless + crossfade per album:** never crossfade inside an album, only between albums.
11. **Folder view browsing** as a first-class page (some users organise by folder).
12. **Duplicate finder** (same song in two formats or folders; the m4a/flac case).
13. **Built-in ALAC to FLAC conversion** (the `tools/alac-to-flac` logic inside the app).

Does not fit (left out on purpose): streaming services, social features, podcasts, video, cloud sync, online accounts
beyond the existing optional Last.fm.

## Done

- 3.3.1: like/dislike songs, sleep timer, smart shuffle, recently added/played rows, network folders (LAN parts 1-2),
  fast/full refresh.
- 3.3.2: continuous play, album/artist like/dislike with a liked albums row, `dopamine.json`, year in review.
- 3.3.3: connected network drives in "Add a network folder" (opt-in), search box in Settings.

## Planned for 3.4 (with the upgrade to current Angular and Electron, see `3.4.0-plan.md`)

The upgrade itself comes first; these features follow it, each its own PR. All high effort.

1. **Navidrome / Subsonic client (LAN part 3).** Play from a music server the proper way: browse its library and stream
   from it, instead of a mounted share. Fits the home server (Navidrome is already planned there). A "server" source next
   to the local folders; playback counts and likes stay local. Needs: Subsonic API client (token auth, no password stored
   in plain text), streaming through the existing player, offline handling like the network folders.
2. **Bit-perfect output on Linux, with optional EQ.** A native output path (ALSA directly, or PipeWire following the
   file's sample rate) past Chromium's audio engine, which resamples and mixes in float. A "bit-perfect" switch: with the
   EQ off (or flat) and volume at 100%, the samples pass untouched; with the EQ on, no resampling, 64-bit float EQ and
   dither to the device's bit depth. The player shows which one is active. Windows (WASAPI exclusive) and macOS (CoreAudio
   hog mode) later.
3. **MusicBrainz auto-tagging, batch tag editor and file organiser.** Look up a CD rip or download on MusicBrainz (by
   disc ID from the .cue/log, or by album and artist), show the differences, write tags only after confirming. Edit tags
   of many songs at once. Optionally move files into `Artist/Year - Album/NN Title` (the alac2flac layout). Never changes
   files without a preview and a confirmation.

Smaller ones that can ride along (the Settings search box shipped in 3.3.3): queue improvements ("play next", clear played songs),
a Ctrl+K quick search, the
year in review as an image and with the first song's title, a duplicate finder (same song in two formats or folders).

## Planned for 3.5 (with the Electron security hardening)

The hardening (contextIsolation, a preload with a narrow API, no `@electron/remote`, a Content Security Policy) comes
first. These features open the app to the network or to devices, which is why they wait for it.

1. **Phone remote.** Control playback from a phone on the home network: a small local web page (play/pause, next,
   volume, queue, likes). Off by default, local network only, paired with a code shown in the app, no internet service.
2. **CD ripping.** Secure ripping (AccurateRip check where possible) to FLAC + .cue + log, with MusicBrainz tags and the
   cover, straight into the collection. Linux first (cdparanoia / libcdio).
3. **Casting and device sync.** Play to DLNA/UPnP and Chromecast speakers; copy a playlist or albums to a phone or
   player, converting when the device needs it.

4. **Sync between your Dopamine installs (local network, peer to peer).** Likes, ratings, play counts, listening
   history, playlists and nicknames shared between your own computers; the stronger ones do the heavy work for the
   others. Off by default, local network only, no server and no internet. Details and open questions: D21 in
   `cue-support/DRAFTS.md`. Shares the small built-in server and the pairing with the phone remote.

Not planned at any version: streaming services, social features, podcasts, video, cloud sync, accounts.

## Planned for 3.3.2 (done)

1. **Continuous play:** when the queue ends, keep going with similar songs from the library (same artist, genre or era,
   liked first, disliked never), marked in the queue. Off by default.
2. **Like / dislike for albums and artists**, and a **Liked** page (needs a database migration).
3. **Album details from `dopamine.json`** in the album folder (D19).
4. **Year in review** cards on the Statistics page.

## Order suggestion

3.3.1: liking (albums, artists, Liked page), sleep timer, recently added/played.
Later: queue improvements, command palette, year in review, duplicate finder.

## From other local players (foobar2000, MusicBee, Strawberry) — drafts, checked against what Dopamine has

Fit well:
- **Batch tag editor and file organiser:** edit tags of many songs at once; rename and move files into
  `Artist/Year - Album/NN Title` (the alac2flac layout) from inside the app.
- **Auto-tagging from MusicBrainz** (and cover lookup there), for CD rips and Bandcamp downloads with thin tags.
- **Headphone crossfeed** (a small DSP next to the equalizer) and a **ReplayGain album mode** switch.
- **Bit-perfect output:** today Chromium's audio engine resamples and mixes in float, and the equalizer, volume and fades
  change samples, so nothing is bit-perfect yet. Needs a native output path that bypasses Chromium, plus a "bit-perfect"
  switch that turns off the equalizer, volume and fades. Linux first (direct ALSA device, or PipeWire following the
  file's sample rate); Windows (WASAPI exclusive) and macOS (CoreAudio hog mode) later. High effort.
  With the equalizer on: "bit-perfect path" mode — no resampling (output at the file's own rate), EQ in 64-bit float,
  dither down to the device's bit depth. When the EQ is off or flat (and volume 100%, no fade), the samples pass through
  untouched: true bit-perfect. The player shows which of the two is active.
- **Waveform seek bar** (optional) and **A-B repeat** for a part of a song.
- **Resume position** per long track or audiobook-like files.
- **Web remote:** control playback from a phone on the same network (off by default, local only).

Maybe later (bigger):
- **CD ripping** (secure, with CUE + FLAC output) — fits the CD collection workflow.
- **Device sync** (copy a playlist to a phone or player, converting if needed).
- **Casting** to DLNA or Chromecast speakers.

Not planned: streaming services, plugin/skin systems as complex as foobar2000's.
