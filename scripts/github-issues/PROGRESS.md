# Progress & Open Items — Iron Wasteland

_Working note. Lives on branch `claude/intelligent-tesla-Dg8U8` / PR #120.
Last touched: 2026-06-05._

## Context (how we got here)
A local-folder playtest surfaced two bugs:
1. The game **froze around day 4**.
2. A **relic spawned on a mountain**, unreachable — and since winning needs all
   5 relics deposited at the altar, that run was unwinnable.

Goal was to file these as GitHub issues. Discovered the current session is a
**Claude Code on the web (cloud)** session, whose built-in GitHub tools are
**read + comment only** — no issue creation, and `gh`/raw API are sandboxed off.
(Local desktop sessions pointed at the iCloud `Iron Wasteland` folder can create
issues because they use the Mac's authenticated `gh`. Cloud sessions start
blank, so they can't without setup.)

## Done
- **Filed both issues** (the GitHub MCP reconnected mid-session exposing
  `mcp__github__issue_write`, so creation worked directly — no token/setup
  needed after all):
  - #122 — Relic can spawn unreachable on a mountain → unwinnable.
  - #123 — Game freezes ~day 4 (correlates with boss spawn).
- Root-caused both bugs (see Findings below).
- Committed tooling + issue drafts to this branch (PR #120, CI green):
  - `scripts/web-setup.sh` — installs `gh` in cloud sessions; documents `GH_TOKEN`.
  - `scripts/github-issues/01-relic-unreachable-on-mountain.md` — issue body.
  - `scripts/github-issues/02-freeze-around-day-4.md` — issue body.
  - `scripts/github-issues/create-issues.sh` — one-shot `gh issue create` runner.
  - `scripts/github-issues/README.md` — the end-to-end flow.
- Bumped `VERSION` (required by `version-bump` CI on every PR).

## Open items / next steps
- [x] **File the two issues.** Done → #122, #123 (via `mcp__github__issue_write`).
- [ ] **Fix bug #1 (relic-on-mountain, #122)** — well understood, self-contained.
- [ ] **Fix bug #2 (day-4 freeze, #123)** — needs the auto-downloaded forensic
      log from a frozen run to confirm root cause before fixing.
- [ ] **Sync to canonical folder.** This cloud work is on a GitHub branch, NOT
      the local iCloud `Iron Wasteland` folder. Merge PR #120 + `git pull`
      locally (per CLAUDE.md's "edits must land in the iCloud folder" rule).
- [ ] Decide what to do with **PR #120**: the issue drafts/runner are now
      redundant (issues are filed), but `scripts/web-setup.sh` is still useful
      if you ever want cloud sessions to use `gh`. Keep, trim, or close.

## Findings (root-cause detail, for later reference)

### Bug 1 — Relic can spawn unreachable on a mountain (unwinnable)
- Relics placed in `buildPOIs()` via `findInBiome()`, which rejects tiles
  flagged by `_isImpassable()` (`game.js:6666`); relic call at `game.js:6824`.
- `_isImpassable` checks `_waterMap` + `_solidTileSet`. The gap: `_solidTileSet`
  marks only a **3×3 tile** box around each mountain's anchor tile
  (`game.js:6515-6521`), while mountains render up to **4×** (`game.js:6480`,
  `:6508`) — a 96×80 sprite at 4× ≈ **12×10 tiles**. So a relic can pass the
  check yet land buried in a mountain cluster, ringed by collision bodies.
- No reachability check from spawn; no relocation fallback.
- Mountain physics body is only a ~13px circle at the visual base
  (`game.js:6445-6457`) — it's the *cluster* of these + visual burial that
  strands the relic.
- Win condition: `relicsHeld === 5` at altar (manifest §22, `_depositRelic`).
- **Proposed fix:** size `_solidTileSet` coverage to each mountain's real
  footprint (`ceil(displayWidth / TILE / 2)`), + a BFS reachability/relocation
  pass for relics (mirrors the underwater-POI relocation in issue #109).
- Related: **#109** (POIs on unreachable/underwater tiles) — same class,
  different root cause (water-gen ordering vs solid-tile under-coverage).

### Bug 2 — Freeze ~day 4 (correlates with boss spawn)
- "~Day 4" matches **boss spawn**: `hc.bossStartDay` = 4 (Hardcore), 5
  (Survival) (`game.js:13592`). Hunting party (`huntNextDay`, `game.js:13566`)
  can overlap.
- Boss path already carries freeze forensics: sets `_stageTrace = true`
  (`game.js:13600`) and **auto-downloads the session log ~250ms before spawn**
  (`game.js:13607`). Existing comment notes a prior Safari freeze from a
  *synchronous* `a.click()` log download stalling the scheduler
  (`game.js:13602-13606`).
- **Need:** the auto-downloaded `iron-wasteland-*.txt` from the frozen run
  (final FPS, last `[WORLD ]` entries, last `update()` stage in the trace).
- Hypotheses: boss spawn/telegraph stalling the loop; sync log download
  re-introducing the documented stall; enemy/particle spike at the
  boss+hunting-party overlap.

## Key references
- PR: https://github.com/captjkirk/Iron-Wasteland/pull/120
- Branch: `claude/intelligent-tesla-Dg8U8`
- Cloud-session docs: https://code.claude.com/docs/en/claude-code-on-the-web
