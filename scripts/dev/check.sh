#!/usr/bin/env bash
# Runs jest for the given file patterns and prints only the summary and failures.
# Usage: scripts/dev/check.sh [--tsc] [--db] [jest-path-pattern ...]
#   --db runs the repository specs (src/app/data/repositories) with the database integration config.
#        Needs better-sqlite3 built for Node (npm rebuild better-sqlite3); run npm install again before building the app.
#   scripts/dev/check.sh cue-parser            # one spec
#   scripts/dev/check.sh main/background-work  # a directory
#   scripts/dev/check.sh --tsc                 # also type-check the app (slow)
set -uo pipefail
cd "$(dirname "$0")/../.."

run_tsc=0
config=()
patterns=()
for arg in "$@"; do
    case "$arg" in
        --tsc) run_tsc=1 ;;
        --db) config=(--config jest.database.integration.config.js) ;;
        *) patterns+=("$arg") ;;
    esac
done

status=0
out="$(mktemp)"
trap 'rm -f "$out"' EXIT

npx jest --silent --noStackTrace "${config[@]}" "${patterns[@]}" >"$out" 2>&1 || status=$?

# Failures with their messages, then the summary lines.
grep -E "^(FAIL|  ●|    (expect|Expected|Received|TypeError|ReferenceError|Error))" "$out" | head -60
grep -E "^(Tests|Test Suites):" "$out"

if [ "$run_tsc" -eq 1 ]; then
    echo "--- tsc ---"
    npx tsc -p tsconfig.app.json --noEmit 2>&1 | head -40
    [ "${PIPESTATUS[0]}" -ne 0 ] && status=1
fi

exit "$status"
