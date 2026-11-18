#!/usr/bin/env bash
# End-to-end CUE indexing scenarios against the real worker pipeline (see index-sandbox.js).
# Each scenario prints PASS/FAIL. Exit code is non-zero when any scenario fails.
# Usage: scripts/dev/cue-scenarios.sh [work-dir]
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="${1:-$(mktemp -d)}"
fails=0

index() { # $1 music dir, $2 db -> prints "count|path,path,..." sorted
    node -e '
        const { indexFolder } = require(process.argv[1]);
        const path = require("path");
        indexFolder(process.argv[2], process.argv[3], true).then(({ tracks }) => {
            const rows = tracks.filter((t) => t.indexingSuccess === 1).map((t) => path.basename(t.path)).sort();
            console.log(rows.length + "|" + rows.join(","));
        });' "$root/scripts/dev/index-sandbox.js" "$1" "$2" 2>&1 | grep -v '^\[' | tail -1
}

check() { # $1 name, $2 expected, $3 actual
    if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1"; echo "      expected: $2"; echo "      actual:   $3"; fails=$((fails + 1)); fi
}

setup() { # fresh music dir with one album (flac + cue) -> sets $music and $db
    music="$work/$1/music"; db="$work/$1/db.sqlite"
    rm -rf "$work/$1"; mkdir -p "$music"
    "$root/scripts/dev/fixtures.sh" "$music" 3 >/dev/null
    rm -f "$music"/*.wav "$music"/*.wav.cue
}

A="Test Artist - Test Album.flac"
all3="3|$A|1,$A|2,$A|3"

# 1. A single-file album is indexed as one track per cue track, not as one long track
setup s1
check "album with cue is indexed per track" "$all3" "$(index "$music" "$db")"

# 2. Re-indexing an unchanged folder keeps the same tracks
check "re-index is stable" "$all3" "$(index "$music" "$db")"

# 3. A raw file indexed before the cue existed is replaced by the cue tracks
setup s3
mv "$music/$A.cue" "$work/s3/held.cue"
check "without cue the file is one track" "1|$A" "$(index "$music" "$db")"
mv "$work/s3/held.cue" "$music/$A.cue"
check "adding the cue replaces the whole-file track" "$all3" "$(index "$music" "$db")"

# 4. Removing the cue brings back the whole-file track
rm "$music/$A.cue"
check "removing the cue falls back to the whole file" "1|$A" "$(index "$music" "$db")"

# 5. Editing the sheet to fewer tracks removes the missing track
setup s5
index "$music" "$db" >/dev/null
sleep 1 # make sure the modified time changes
python3 - "$music/$A.cue" <<'EOF'
import sys,re
p=sys.argv[1]; s=open(p).read()
s=s[:s.index('  TRACK 03')]
open(p,'w').write(s)
EOF
check "editing the sheet to fewer tracks" "2|$A|1,$A|2" "$(index "$music" "$db")"

# 6. Sheet refers to a .wav, but the album was converted to .flac
setup s6
sed -i 's/Test Album.flac" WAVE/Test Album.wav" WAVE/' "$music/$A.cue"
check "sheet says .wav, disk has .flac" "$all3" "$(index "$music" "$db")"

# 7. Sheet named differently from the audio file (Veleno.cue -> 'Artist - Veleno.wav' style)
setup s7
mv "$music/$A.cue" "$music/Other Name.cue"
check "sheet named differently from the audio file" "$all3" "$(index "$music" "$db")"

# 8. Sheet pointing to a missing file, with two candidate files: nothing is guessed, both stay normal tracks
setup s8
sed -i 's/Test Album.flac" WAVE/Missing.flac" WAVE/' "$music/$A.cue"
mv "$music/$A.cue" "$music/Other.cue"
cp "$music/$A" "$music/y.flac"
mv "$music/$A" "$music/x.flac"
check "unresolvable sheet leaves files as normal tracks" "2|x.flac,y.flac" "$(index "$music" "$db")"

# 9. Sheet pointing to a missing file, with exactly one audio file in the folder: that file is used (see DRAFTS D7)
setup s9
sed -i 's/Test Album.flac" WAVE/Missing.flac" WAVE/' "$music/$A.cue"
mv "$music/$A.cue" "$music/Other.cue"
mv "$music/$A" "$music/x.flac"
check "single audio file in folder is used for an unmatched sheet" "3|x.flac|1,x.flac|2,x.flac|3" "$(index "$music" "$db")"

# 10. A cue track that starts beyond the end of the audio file is skipped, the others are kept
setup s10
sed -i 's/INDEX 01 00:04:15/INDEX 01 59:00:00/' "$music/$A.cue"
check "track starting after the end of the file is skipped" "2|$A|1,$A|2" "$(index "$music" "$db")"

echo
[ "$fails" -eq 0 ] && echo "All scenarios passed ($work)" || echo "$fails scenario(s) failed ($work)"
exit "$fails"
