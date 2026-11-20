# Feature ideas (plan, not started)

Rule for everything here: it must still feel like Dopamine (a simple, fast player for your own music files). No accounts,
no streaming service, no social feed. Everything stays on the computer and can be turned off.

## 3.3.1 candidate: liking songs, albums and artists

Dopamine already has "love" for songs (heart, stored in `Track.Love`) and star ratings. Plan:
- Like albums and artists too (heart on the album and artist pages and in their right-click menu).
- A "Liked" section in the collection: liked songs, albums and artists, each sortable, playable as a whole.
- Liked songs as an automatic playlist ("Liked songs"), like Spotify.
- Storage: a new table `Liked (Kind, Key, LikedAtMs)` keyed by album key / artist name (needs a migration: high effort).
  Songs keep using `Track.Love`, so nothing existing changes.
- Optional: write the song heart to the file tag (like ratings can be) so it survives a new library.

## Other ideas, by how well they fit

Fits well (small or medium):
1. **Queue improvements:** "play next" vs "add to queue", save the queue as a playlist, clear played songs.
2. **Sleep timer:** stop (with fade out) after N minutes or at the end of the song/album.
3. **Recently added / recently played** views (data already exists: date added, statistics).
4. **Smart shuffle / "radio" from local files:** play songs similar to the current one by genre, artist and year.
5. **Album "Play from disc 2"** and grouping CD1/CD2 albums (see D17 in `cue-support/DRAFTS.md`).
6. **Lyrics view** improvements: synced `.lrc` scrolling full screen (lyrics already supported).
7. **ReplayGain / loudness normalisation** shown and toggled more clearly (already partly there).
8. **Year in review** from the detailed statistics (top songs per year, like "Wrapped", but private).
9. **Keyboard shortcuts page** and a mini command palette (Ctrl+K: search songs, albums, actions).

Fits, larger:
10. **Gapless + crossfade per album:** never crossfade inside an album, only between albums.
11. **Folder view browsing** as a first-class page (some users organise by folder).
12. **Duplicate finder** (same song in two formats or folders; the m4a/flac case).
13. **Built-in ALAC to FLAC conversion** (the `tools/alac-to-flac` logic inside the app).

Does not fit (left out on purpose): streaming services, social features, podcasts, video, cloud sync, online accounts
beyond the existing optional Last.fm.

## Order suggestion

3.3.1: liking (albums, artists, Liked page), sleep timer, recently added/played.
Later: queue improvements, command palette, year in review, duplicate finder.
