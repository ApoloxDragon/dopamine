#!/usr/bin/env bash
# Appends a dated entry to the CUE support dev log (docs/cue-support/LOG.md).
# Usage: scripts/dev/devlog.sh <Added|Changed|Fixed|Tooling|Note> "one-line summary" ["extra detail line" ...]
set -euo pipefail
cd "$(dirname "$0")/../.."

kind="${1:?usage: devlog.sh <kind> \"summary\" [detail ...]}"
summary="${2:?missing summary}"
shift 2

log="docs/cue-support/LOG.md"
{
    echo
    echo "- **$(date -u +%Y-%m-%d)** · \`$kind\` · $summary"
    for detail in "$@"; do
        echo "    - $detail"
    done
} >>"$log"
