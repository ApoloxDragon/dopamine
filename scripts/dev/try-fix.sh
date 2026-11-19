#!/usr/bin/env bash
# After changing dependencies or "overrides" in package.json: installs, runs every gate and prints a compact verdict.
# Logs of failed steps are kept; their last lines are printed.
# Usage: scripts/dev/try-fix.sh [--skip-build]
set -uo pipefail
cd "$(dirname "$0")/../.."
logs="$(mktemp -d)"
failed=0

step() {
    local name="$1"
    shift
    if "$@" >"$logs/$name.log" 2>&1; then
        echo "PASS  $name"
    else
        echo "FAIL  $name  (log: $logs/$name.log)"
        grep -vE "^npm warn deprecated" "$logs/$name.log" | grep -E "FAIL|●|Error|ERR|error" | head -15
        failed=1
    fi
}

step install npm install --ignore-scripts --no-audit --no-fund
step electron-binary node node_modules/electron/install.js
step sqlite-for-node npm rebuild better-sqlite3
step install-patches bash -c 'node patch-discord-rpc.js && node patch-taglib-sharp.js'
step unit-tests npx jest -w 1 --silent --noStackTrace
step database-tests npx jest -w 1 --silent --noStackTrace --config jest.database.integration.config.js
[ "${1:-}" = "--skip-build" ] || step production-build npm run build:prod

grep -hE "^Tests:" "$logs/unit-tests.log" "$logs/database-tests.log" 2>/dev/null | sed 's/^/      /'
node scripts/dev/vuln-report.js --check scripts/dev/audit-baseline.json 2>&1 | grep -E "^npm audit|^Fixed since|^NEW|^No new" | cut -c1-400
exit "$failed"
