#!/usr/bin/env bash
# Shows what Dopamine publishes to the Linux desktop (MPRIS over D-Bus) while playing a file: title, artist, album and
# mpris:artUrl, which lock screens and media widgets use for the cover.
# Runs the built app (npm run build:prod) in a private D-Bus session on a virtual display.
# Usage: scripts/dev/mpris-probe.sh <audio-file> [seconds-to-wait=12]
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
file="${1:?usage: mpris-probe.sh <audio-file> [seconds]}"
wait="${2:-12}"

inner() {
    home="$(mktemp -d)"
    mkdir -p "$home/.config/Dopamine"
    echo '{"showWelcome": false}' >"$home/.config/Dopamine/config.json"
    HOME="$home" XDG_CONFIG_HOME="$home/.config" NODE_OPTIONS= \
        xvfb-run -a -s "-screen 0 1280x800x24" "$root/node_modules/.bin/electron" "$root" --no-sandbox --disable-gpu "$file" \
        >"$home/app.log" 2>&1 &
    sleep "$wait"

    name="$(gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.ListNames | grep -o "org.mpris.MediaPlayer2[^']*" | head -1)"
    echo "MPRIS name: ${name:-<none>}"
    if [ -n "$name" ]; then
        gdbus call --session --dest "$name" --object-path /org/mpris/MediaPlayer2 \
            --method org.freedesktop.DBus.Properties.Get org.mpris.MediaPlayer2.Player Metadata |
            sed -E "s/('mpris:artUrl': <')([^']{0,160})[^']*'/\1\2...'/" | tr ',' '\n' | sed 's/^ *//' | head -20
        gdbus call --session --dest "$name" --object-path /org/mpris/MediaPlayer2 \
            --method org.freedesktop.DBus.Properties.Get org.mpris.MediaPlayer2.Player PlaybackStatus
        art="$(gdbus call --session --dest "$name" --object-path /org/mpris/MediaPlayer2 --method org.freedesktop.DBus.Properties.Get org.mpris.MediaPlayer2.Player Metadata | grep -o "mpris:artUrl': <'[^']*" | sed "s/.*<'//")"
        case "$art" in
            file://*) f="${art#file://}"; echo "artUrl file: $f"; ls -la "$f" 2>&1; file "$f" 2>/dev/null ;;
            "") echo "artUrl: <missing>" ;;
            *) echo "artUrl starts with: ${art:0:40} (length ${#art})" ;;
        esac
    fi
    pkill -f "$root/node_modules/electron" 2>/dev/null
    sleep 1
}

export -f inner
export root file wait
dbus-run-session -- bash -c inner
