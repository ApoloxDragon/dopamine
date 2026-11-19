# Android: draft plan (not started)

**Status: draft, on hold.** Dopamine stays a desktop app for now. This file keeps the findings, so a decision can be
made later without starting over. The owner's current preference is route C: fork an existing FOSS Android player.

## Why it is not a simple port

The app is TypeScript, but much of it depends on Electron and Node, which Android does not have:

| Part | Desktop today | Android needs |
| --- | --- | --- |
| Interface (Angular) | Electron window | Reusable in a WebView (Capacitor) |
| Pure logic: CUE parser, statistics, equalizer math, settings, playlists, translations | TypeScript | Reusable as is |
| Database | `better-sqlite3` (native Node module) | Android SQLite plugin |
| Library scan | Node worker thread with `fs` | Android storage access (SAF / MediaStore), much more restricted |
| Tags and covers | `node-taglib-sharp` over `fs` | A native tag reader, or reading files through a plugin |
| Playback | `<audio>` / Web Audio in the window | **Native playback service (Media3 / ExoPlayer)**: a WebView's audio stops or is throttled in the background and with the screen off. Lock screen, audio focus and Bluetooth buttons also need it |
| Discord, MPRIS, tray, mini player | Desktop integrations | Not applicable |

## Routes

### A. Capacitor (most reuse from this project)
Keep the Angular interface in a WebView. Replace every Node or Electron use with a Capacitor plugin, and add a small
native Kotlin playback plugin (Media3) for background playback.
- **Pro:** most of the interface and logic is reused; one codebase for both.
- **Con:** a WebView music player is a compromise (battery, feel). Two playback paths to maintain.

### B. Native Kotlin app (Media3)
A new app with the same ideas.
- **Pro:** best Android behaviour and battery life. ExoPlayer has gapless playback, and its `ClippingMediaSource`
  plays a range of a file, which suits CUE albums.
- **Con:** a rewrite: only ideas and tests carry over, not code.

### C. Fork an existing FOSS Android player (owner's preference)
Start from a maintained open-source player that already has background playback, Android storage handling and
lock-screen controls. Then add what Dopamine has that it lacks:
- CUE albums (gapless)
- listening statistics (detailed mode)
- parametric equalizer and AutoEQ import
- fades
- Discord-like "now playing" where Android allows

Check the candidates for: license (GPL-3.0 is compatible with Dopamine's), activity of the project, Media3 use,
existing CUE support, gapless playback, code quality, and how open the maintainers are to contributions.
Candidates to look at (features and status **not verified**, check each before choosing):
- Auxio (Kotlin, Media3)
- Gramophone (Kotlin, Media3)
- Vinyl Music Player
- Odyssey
- VLC for Android (very complete, much larger codebase)

## If route A is chosen: phases

0. **Groundwork on desktop (useful anyway):** phase 5 of `dependency-upgrade-plan.md`. Move Node and Electron
   access behind one boundary (preload / IPC), then extend the existing `*Base` abstractions (`FileAccessBase`,
   `DesktopBase`, `SettingsBase`, …) so the interface never touches Node directly. This also makes the desktop
   app safer.
1. **Proof of concept:** the Angular build in Capacitor; pick a music folder (SAF); play one FLAC + CUE album in the
   background with lock-screen controls through a native Media3 plugin. Go or no-go point.
2. Database (SQLite plugin, the same migrations) and library scan (SAF/MediaStore), tags and covers.
3. Playback parity: queue, gapless, CUE ranges, equalizer and fades (Media3 audio processors, or Web Audio only
   in the foreground), replay gain.
4. Interface for small screens, touch, the back button and permissions.
5. Builds: an APK on GitHub Actions (signed), sideloading. The Play Store is optional and later.

**Effort:** multi-week, all high-effort sessions.

**Testing limits:** Claude cannot run an Android emulator or device in its cloud environment. It can build APKs
in CI, but testing on a phone is the owner's.
