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
step unit-tests npx jest --silent --noStackTrace
step database-tests npx jest --silent --noStackTrace --config jest.database.integration.config.js
[ "${1:-}" = "--skip-build" ] || step production-build npm run build:prod

# Lint must run and must not report more errors than the known pre-existing ones (scripts/dev/lint-baseline.txt).
lint_check() {
    local out errors
    out="$(npx ng lint 2>&1)"
    if echo "$out" | grep -q "An unhandled exception occurred"; then
        echo "$out" | grep "An unhandled exception" >&2
        return 1
    fi
    errors="$(echo "$out" | grep -cE '^\s+[0-9]+:[0-9]+\s+error')"
    echo "lint errors: $errors (baseline $(cat scripts/dev/lint-baseline.txt))"
    [ "$errors" -le "$(cat scripts/dev/lint-baseline.txt)" ]
}
step lint lint_check
grep -h "^lint errors" "$logs/lint.log" 2>/dev/null | sed 's/^/      /'

grep -hE "^Tests:" "$logs/unit-tests.log" "$logs/database-tests.log" 2>/dev/null | sed 's/^/      /'
node scripts/dev/vuln-report.js --check scripts/dev/audit-baseline.json 2>&1 | grep -E "^npm audit|^Fixed since|^WARNING|^NEW|^No new" | cut -c1-400
exit "$failed"
