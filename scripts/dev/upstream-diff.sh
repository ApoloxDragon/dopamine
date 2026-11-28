#!/usr/bin/env bash
# Before merging a new upstream (Digimezzo) release: what changed on each side, and where conflicts will be.
# Usage: scripts/dev/upstream-diff.sh [upstream-ref] [fork-ref]
#   defaults: upstream-ref = origin/master (the fork's copy of upstream), fork-ref = origin/apolox-dev
# Read-only: it only fetches and compares.
set -euo pipefail
cd "$(dirname "$0")/../.."

upstream="${1:-origin/master}"
fork="${2:-origin/apolox-dev}"

git fetch -q origin 2>/dev/null || true
if ! base=$(git merge-base "$upstream" "$fork" 2>/dev/null); then
    echo "No common history between $upstream and $fork: is $upstream really the upstream branch (fetched)?" >&2
    exit 2
fi

echo "== merge base: $(git log -1 --format='%h %ad %s' --date=short "$base")"
echo "== upstream since base: $(git rev-list --count "$base..$upstream") commits"
echo "== fork since base:     $(git rev-list --count "$base..$fork") commits"

upstream_files=$(git diff --name-only "$base" "$upstream" | sort)
fork_files=$(git diff --name-only "$base" "$fork" | sort)
both=$(comm -12 <(echo "$upstream_files") <(echo "$fork_files") | grep -v '^$' || true)

echo
echo "== changed on BOTH sides (likely conflicts): $(echo "$both" | grep -c . || true)"
for f in $both; do
    printf '   %-80s upstream %s, fork %s\n' "$f" \
        "$(git diff --numstat "$base" "$upstream" -- "$f" | awk '{print "+"$1"/-"$2}')" \
        "$(git diff --numstat "$base" "$fork" -- "$f" | awk '{print "+"$1"/-"$2}')"
done

echo
echo "== database migrations"
list_migrations() { git ls-tree --name-only "$1" src/app/data/migrations/ | grep -o 'migration[0-9]*\.ts' | sort -V; }
up_m=$(list_migrations "$upstream"); fork_m=$(list_migrations "$fork"); base_m=$(list_migrations "$base")
echo "   base:     $(echo "$base_m" | tail -1)"
echo "   upstream: $(echo "$up_m" | tail -1)"
echo "   fork:     $(echo "$fork_m" | tail -1)"
new_up=$(comm -13 <(echo "$base_m") <(echo "$up_m") || true)
new_fork=$(comm -13 <(echo "$base_m") <(echo "$fork_m") || true)
clash=$(comm -12 <(echo "$new_up") <(echo "$new_fork") | grep -v '^$' || true)
if [ -n "$clash" ]; then
    echo "   !! the same migration number was added on both sides: $(echo $clash)"
    echo "   !! see docs/upstream-sync-plan.md, 'Database migrations', before merging"
else
    echo "   no clashing migration numbers"
fi

echo
echo "== settings and translation keys added on both sides"
keys() { git diff "$base" "$1" -- src/app/common/settings/settings.ts src/assets/i18n/en.json | grep '^+' | grep -oE '"[A-Za-z0-9-]+":|public (get|set) [A-Za-z0-9]+' | sort -u; }
comm -12 <(keys "$upstream") <(keys "$fork") | sed 's/^/   /' || true
