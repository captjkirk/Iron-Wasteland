#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Setup script for Claude Code on the web (cloud sessions).
#
# The built-in GitHub tools in a cloud session are READ + COMMENT only — they
# cannot create issues. This script installs the GitHub CLI (`gh`) so an agent
# (or you) can run `gh issue create`, `gh release`, etc., that the built-in
# tools don't cover.
#
# HOW TO USE
#   1. In your environment settings, add a GH_TOKEN environment variable.
#      Use a GitHub Personal Access Token with `repo` scope (classic) or a
#      fine-grained token with `Issues: read/write`. The container has no
#      secrets store and the built-in proxy token never enters the container,
#      so the PAT must arrive as an env var. `gh` reads GH_TOKEN automatically.
#   2. Point your environment's "setup script" at this file (e.g. run
#      `bash scripts/web-setup.sh`), or paste the apt line below into it.
#   3. Start a fresh session — env-var and setup-script changes only take
#      effect on a NEW session, not a running one.
#
# Then: bash scripts/github-issues/create-issues.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "[web-setup] Installing GitHub CLI (gh)…"
if command -v gh >/dev/null 2>&1; then
  echo "[web-setup] gh already present: $(gh --version | head -1)"
else
  apt-get update -y
  apt-get install -y gh
  echo "[web-setup] gh installed: $(gh --version | head -1)"
fi

if [ -n "${GH_TOKEN:-}" ]; then
  echo "[web-setup] GH_TOKEN detected — gh is authenticated for this session."
else
  echo "[web-setup] WARNING: GH_TOKEN is not set."
  echo "[web-setup]   Add it in your environment settings (PAT with repo /"
  echo "[web-setup]   Issues:read-write scope) so gh can create issues."
fi

echo "[web-setup] Done."
