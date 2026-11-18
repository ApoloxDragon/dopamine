#!/usr/bin/env bash
# Runs jest for the given file patterns and prints only the summary and failures.
# Usage: scripts/dev/check.sh [--tsc] [jest-path-pattern ...]
#   scripts/dev/check.sh cue-parser            # one spec
#   scripts/dev/check.sh main/background-work  # a directory
#   scripts/dev/check.sh --tsc                 # also type-check the app (slow)
set -uo pipefail
cd "$(dirname "$0")/../.."

run_tsc=0
patterns=()
for arg in "$@"; do
    if [ "$arg" = "--tsc" ]; then run_tsc=1; else patterns+=("$arg"); fi
done

status=0
out="$(mktemp)"
trap 'rm -f "$out"' EXIT

npx jest -w 1 --silent --noStackTrace "${patterns[@]}" >"$out" 2>&1 || status=$?

# Failures with their messages, then the summary lines.
grep -E "^(FAIL|  ●|    (expect|Expected|Received|TypeError|ReferenceError|Error))" "$out" | head -60
grep -E "^(Tests|Test Suites):" "$out"

if [ "$run_tsc" -eq 1 ]; then
    echo "--- tsc ---"
    npx tsc -p tsconfig.app.json --noEmit 2>&1 | head -40
    [ "${PIPESTATUS[0]}" -ne 0 ] && status=1
fi

exit "$status"
