#!/usr/bin/env bash
# Merge a PR for the judge, or refuse: the path rules of .claude/commands/judge.md live here, as code.
# Usage: scripts/judge-merge.sh <pr-number> [--dry-run]
# Refuses when any changed file is on the gate list (the checks and the loop) or the irreversible
# list (money, live data, dependencies, the deploy), whatever the judge decided. Otherwise squash-merges.
set -euo pipefail
n=${1:?pr number}; dry=${2:-}
gate='^(\.github/|\.githooks/|\.claude/|scripts/|eslint\.config\.js$|package\.json$|package-lock\.json$)'
irreversible='^(tools/scoreboard/|server\.js$|setup\.sh$|\.github/workflows/pages\.yml$)'
files=$(gh pr view "$n" --json files --jq '.files[].path')
held=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if grep -Eq "$irreversible" <<<"$f"; then echo "refuse $n (irreversible): $f"; held=1
  elif grep -Eq "$gate" <<<"$f"; then echo "refuse $n (gate): $f"; held=1; fi
done <<<"$files"
[ "$held" = 1 ] && exit 2
if [ "$dry" = "--dry-run" ]; then echo "would merge $n"; exit 0; fi
gh pr merge "$n" --squash
