#!/usr/bin/env bash
# Fast local Linux build to try out changes. Release builds are made by .github/workflows/release.yml.
# - skips npm ci when node_modules is newer than package-lock.json
# - reuses Angular's build cache (.angular/cache)
# - rebuilds only better-sqlite3 for Electron, then packages without a second native rebuild
# - builds an AppImage by default (repackaged with the fuse3 runtime, like the official builds)
# Usage: scripts/dev/build-linux.sh [AppImage|deb|rpm|all]
set -euo pipefail
cd "$(dirname "$0")/../.."
target="${1:-AppImage}"
[ "$target" = "all" ] && targets="AppImage deb rpm" || targets="$target"
start=$(date +%s)

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
    echo "== npm ci"
    npm ci
fi

echo "== better-sqlite3 for Electron"
npm run rebuild-sqlite >/dev/null
node patch-discord-rpc.js >/dev/null
node patch-taglib-sharp.js >/dev/null

echo "== Angular production build"
npm run build:prod >/dev/null

echo "== package: $targets"
npx electron-builder build --linux $targets --x64 --config electron-builder.config.js -c.npmRebuild=false >/dev/null

if [[ " $targets " == *" AppImage "* ]]; then
    echo "== fuse3 runtime for the AppImage"
    APPIMAGE_EXTRACT_AND_RUN=1 bash scripts/repackage-appimage-fuse3.sh release x86_64 >/dev/null
fi

ls -la release | grep -E "\.(AppImage|deb|rpm)$"
echo "Done in $(( $(date +%s) - start )) s"
