#!/usr/bin/env bash
# Commits all changes with the standard attribution trailers and pushes to the current branch (retries on network errors).
# Refuses to commit files that look like secrets.
# Usage: scripts/dev/save.sh "commit message"
set -euo pipefail
cd "$(dirname "$0")/../.."

msg="${1:?usage: save.sh \"commit message\"}"
branch="$(git branch --show-current)"

if git status --porcelain | grep -Eiq '(\.env|credentials|secret|\.pem|id_rsa)'; then
    echo "Refusing to commit: a file looks like it contains secrets:" >&2
    git status --porcelain | grep -Ei '(\.env|credentials|secret|\.pem|id_rsa)' >&2
    exit 1
fi

git add -A

# Refuse large files (build tools, packages, audio) that end up in the working tree by accident.
large="$(git diff --cached --name-only --diff-filter=AM -z | xargs -0 -r -I{} sh -c 'f="{}"; [ -f "$f" ] && [ "$(stat -c %s "$f")" -gt 5000000 ] && echo "$f"' || true)"
if [ -n "$large" ]; then
    git reset -q
    echo "Refusing to commit files larger than 5 MB (add them to .gitignore or commit them by hand):" >&2
    echo "$large" >&2
    exit 1
fi

if git diff --cached --quiet; then
    echo "Nothing to commit."
    exit 0
fi

# Override with COMMIT_COAUTHOR="Name <email>" when the attribution changes.
coauthor="${COMMIT_COAUTHOR:-Claude Opus 5.5 <noreply@anthropic.com>}"

git commit -q -m "$msg

Co-Authored-By: $coauthor
Claude-Session: https://claude.ai/code/session_01WgX28eMc9BiHUXSMwTeQfU"

for delay in 0 2 4 8 16; do
    sleep "$delay"
    if git push -u origin "$branch" 2>&1 | tail -1; then
        # tail succeeds even when push fails, so check the remote explicitly
        if [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$branch" 2>/dev/null || true)" ]; then
            echo "Pushed $(git rev-parse --short HEAD) to $branch"
            exit 0
        fi
    fi
done

echo "Push failed after retries" >&2
exit 1
