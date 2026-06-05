#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Creates the two bug issues from the markdown bodies in this directory.
#
# Prereqs (see scripts/web-setup.sh):
#   • gh installed         → bash scripts/web-setup.sh
#   • GH_TOKEN env var set  → PAT with repo / Issues:read-write scope
#
# Idempotency: this is a plain `gh issue create`; running it twice creates
# duplicates. Check `gh issue list` first if unsure.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${IRON_WASTELAND_REPO:-captjkirk/iron-wasteland}"

echo "Creating issues in $REPO …"

gh issue create --repo "$REPO" \
  --title "Relic can spawn unreachable on a mountain → game becomes unwinnable" \
  --label "bug" --label "world-gen" \
  --body-file "$DIR/01-relic-unreachable-on-mountain.md"

gh issue create --repo "$REPO" \
  --title "Game freezes ~day 4 (correlates with boss spawn) — capture forensic log" \
  --label "bug" \
  --body-file "$DIR/02-freeze-around-day-4.md"

echo "Done. Verify with: gh issue list --repo $REPO"
