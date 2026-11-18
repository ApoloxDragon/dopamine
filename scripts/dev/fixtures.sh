#!/usr/bin/env bash
# Generates a synthetic single-file CD rip (FLAC + WAV + EAC-style .cue) for testing CUE support.
# Each track is a different sine tone, so playback position/boundaries are easy to verify.
# Track lengths are deliberately not whole seconds, so the 75 frames/second conversion is exercised.
# Usage: scripts/dev/fixtures.sh <output-dir> [track-count=5]
set -euo pipefail

out="${1:?usage: fixtures.sh <output-dir> [track-count]}"
count="${2:-5}"
mkdir -p "$out"
cd "$out"

command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }

album="Test Artist - Test Album"
starts_ms=()
total_ms=0
inputs=()
filter=""

for i in $(seq 1 "$count"); do
    # 2.0s to 3.9s, in 0.2s steps that are not multiples of 1/75s
    len_ms=$((1800 + i * 200))
    freq=$((200 + i * 150))
    starts_ms+=("$total_ms")
    total_ms=$((total_ms + len_ms))
    inputs+=(-f lavfi -t "$(awk "BEGIN{printf \"%.3f\", $len_ms/1000}")" -i "sine=frequency=$freq:sample_rate=44100")
    filter+="[$((i - 1)):a]"
done
filter+="concat=n=$count:v=0:a=1[out]"

ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$filter" -map "[out]" -ac 2 -ar 44100 "$album.wav"
ffmpeg -y -loglevel error -i "$album.wav" -compression_level 5 "$album.flac"

ms_to_cue() { # milliseconds -> mm:ss:ff (75 frames per second)
    awk -v ms="$1" 'BEGIN{f=int(ms*75/1000+0.5); printf "%02d:%02d:%02d", int(f/75/60), int(f/75)%60, f%75}'
}

write_cue() { # $1 = audio file name, $2 = cue path
    {
        echo 'REM GENRE "Test"'
        echo 'REM DATE 2024'
        echo 'REM COMMENT "ExactAudioCopy v1.3"'
        echo 'PERFORMER "Test Artist"'
        echo 'TITLE "Test Album"'
        echo "FILE \"$1\" WAVE"
        for i in $(seq 1 "$count"); do
            printf '  TRACK %02d AUDIO\n    TITLE "Tone %d"\n    PERFORMER "Test Artist"\n    INDEX 01 %s\n' \
                "$i" "$i" "$(ms_to_cue "${starts_ms[$((i - 1))]}")"
        done
    } >"$2"
}

write_cue "$album.flac" "$album.flac.cue"
write_cue "$album.wav" "$album.wav.cue"

echo "Created in $out: $album.flac, $album.wav and .cue files ($count tracks, ${total_ms} ms total)"
