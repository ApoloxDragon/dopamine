#!/usr/bin/env bash
# Checks that everything inside an AppImage can be used by every user: folders readable and enterable (r-x for
# "others"), files readable. An AppImage with owner-only folders gives "Permission denied" to other users.
# Usage: scripts/check-appimage-permissions.sh Dopamine-x.y.z.AppImage   (needs unsquashfs: squashfs-tools)
set -euo pipefail

APPIMAGE="$(realpath "$1")"
if [[ ! -x "$APPIMAGE" ]]; then
    echo "ERROR: $1 is not executable (chmod +x it first)" >&2
    exit 1
fi
if ! command -v unsquashfs >/dev/null; then
    echo "ERROR: unsquashfs not found (install squashfs-tools)" >&2
    exit 1
fi

# The AppImage runtime prints where the squashfs image starts.
OFFSET="$(APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGE" --appimage-offset)"
LISTING="$(unsquashfs -o "$OFFSET" -lln "$APPIMAGE")"

# Mode string like drwxr-xr-x: character 8 is "others read", 10 is "others execute".
BAD="$(awk '
    $1 ~ /^d/ && (substr($1, 8, 1) != "r" || substr($1, 10, 1) != "x") { print }
    $1 ~ /^-/ && substr($1, 8, 1) != "r" { print }
' <<<"$LISTING")"

TOTAL="$(wc -l <<<"$LISTING")"
if [[ -n "$BAD" ]]; then
    echo "ERROR: $(wc -l <<<"$BAD") of $TOTAL entries in $APPIMAGE are not usable by other users:" >&2
    head -20 <<<"$BAD" >&2
    exit 1
fi
echo "AppImage permissions OK ($TOTAL entries): $APPIMAGE"
