#!/usr/bin/env bash
# Merge a PR for the judge, or refuse: the path rules of .claude/commands/judge.md live here, as code.
# Usage: scripts/judge-merge.sh <pr-number> [--dry-run]
# Refuses when any changed file is on the gate list (the checks and the loop) or the irreversible
# list (money, live data, dependencies, the deploy), whatever the judge decided. Otherwise squash-merges the head
# whose file list it read (--match-head-commit), so a later push cannot slip in unchecked.
set -euo pipefail
n=${1:?pr number}; dry=${2:-}
gate='^(\.github/|\.githooks/|\.claude/|scripts/|eslint\.config\.js$|package\.json$|package-lock\.json$)'
irreversible='^(tools/scoreboard/|server\.js$|setup\.sh$|\.github/workflows/pages\.yml$)'
# files and head come from one read, and the merge is pinned to that head: a push between the read and the merge
# would otherwise land files this list never saw (#474).
view=$(gh pr view "$n" --json files,headRefOid)
files=$(jq -r '.files[].path' <<<"$view")
sha=$(jq -r '.headRefOid' <<<"$view")
[ -n "$sha" ] && [ "$sha" != null ] || { echo "refuse $n: cannot read its head commit"; exit 2; }
held=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if grep -Eq "$irreversible" <<<"$f"; then echo "refuse $n (irreversible): $f"; held=1
  elif grep -Eq "$gate" <<<"$f"; then echo "refuse $n (gate): $f"; held=1; fi
done <<<"$files"
[ "$held" = 1 ] && exit 2
if [ "$dry" = "--dry-run" ]; then echo "would merge $n at ${sha:0:7}"; exit 0; fi
gh pr merge "$n" --squash --match-head-commit "$sha"
