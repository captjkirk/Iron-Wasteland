#!/usr/bin/env bash
# One-time dev setup for Iron Wasteland.
# Run this once after cloning the repo:
#   bash setup.sh
set -euo pipefail

echo "Setting up Iron Wasteland dev environment..."

# ── Git hooks ────────────────────────────────────────────────────────────────
# Point git at the repo's .githooks folder so the pre-commit VERSION stamp
# fires automatically on every commit.
git config core.hooksPath .githooks
echo "  ✓ git hooks configured (.githooks/pre-commit)"

# Ensure the hook is executable (git doesn't preserve +x across all platforms)
chmod +x .githooks/pre-commit
echo "  ✓ .githooks/pre-commit marked executable"

echo ""
echo "Setup complete. You're ready to go!"
echo "  Edit game.js, open index.html in a browser, no build step needed."
