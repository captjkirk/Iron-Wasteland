# Iron Wasteland — Claude Code Reference

## The method

Plan work in vertical slices. When a task will outlast one session or touch more than one layer (constants, scene logic, textures or sprites, scenes and UI, the manifest, CI), show a numbered plan before starting and wait for my approval. Each slice is a thin path through every layer it needs and ends in something I can check myself: an automated check that passes, plus the exact steps I take in the browser to see it work. Slice 1 is the smallest end-to-end path, built first to prove the layers connect. Each slice fits one fresh session and says what blocks it and whether it needs me. Never plan "all of one layer, then the next". A mechanical change across many files (a rename, a split of the scene file) is the exception: add the new form, move callers over in batches, then remove the old form. When I review your plan, I am looking for the slice that finishes only one layer. Make sure there is none.

Slice only the route you can see. If the way to the goal is not clear yet, the first steps are questions to settle with me, not slices. Mark every item decide or build. A decide item ends in a recorded answer, one answered per session. What cannot yet be asked sharply goes under "Not yet specified" and is never sliced in advance. Charting every item up front fails the same way horizontal building does: the later items stop making sense before you reach them.

One map per effort, on GitHub. A multi-session effort is one issue labelled wayfinder:map with Destination, Notes, Decisions so far, Not yet specified, and Out of scope. Its tickets are child issues labelled wayfinder:research, wayfinder:prototype, wayfinder:grilling, or wayfinder:task. One such map already exists: issue 156, separate-view 2-player on home Wi-Fi. It is the model for every future map. The map is an index, not a store: an answer lives in its ticket's resolution comment, and the map only points at it. Never write product code inside a decision ticket, and never grant yourself an exemption to do so in the map's own Notes.

No commit without its check. A commit message never says "untested". Every commit passes npm run check (which slice 1 below makes real). A change I need to see in the browser ships with the steps to see it, in the PR body or the commit message.

One word per concept. Agreed terms live in GLOSSARY.md at the repo root. Read it before planning. When a term is settled in conversation, add it right away: one or two sentences, then an "Avoid:" line listing the words it replaces. The codebase already has terms worth capturing (dormancy, wake radius, dens, waves, the manifest, the two cameras). If a word I use conflicts with the glossary, say so and ask which is meant.

## Keeping the repo clean

- Build the check, not the rule. When you catch a mechanical mistake, add a deterministic check (a script in npm run check, a pre-commit step, a CI job). The manifest check is the model. Prose in CLAUDE.md is only for judgement calls no check could make.
- Prune, never append. When you add a line to CLAUDE.md, remove or merge one. A file that only grows becomes sediment.
- Do not cache the environment. The file map, the CFG keys, and the function list in CLAUDE.md duplicate the manifest and the source. Instruction files hold only what cannot be looked up: the unwritten convention, the reason behind a choice, the gotcha (the two cameras, the water tile set, the dormancy radii).
- One source of truth per meaning. CONTRIBUTING.md and CLAUDE.md disagree today about where VERSION lives. One of them links to the other.
- Say what to do, not what to avoid. Phrase the positive target. Keep a ban only as a hard guardrail, paired with the positive.
- Prefer a new file over a longer scene. src/game-scene.js grows only when the change cannot sit behind a small interface in its own file. The map's own Notes already say this.
- Small steps, real feedback. If there is no feedback loop on a change, build one before the change.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, read and written with `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), alongside the existing topic labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Project Overview
Phaser 3 browser game. No build step — edit files in `src/` and refresh the browser. `index.html` loads scripts in dependency order; all files share global scope (no ES modules). `lib/phaser.min.js` is the engine.

## File Map
| File | Contents |
|---|---|
| `game.js` | Header manifest + `Phaser.Game` init only (~211 lines) |
| `src/constants.js` | `VERSION`, `CFG`, `ENEMY_STATS`, `ENEMY_LOOT`, `CHARS`, `STATE`, `_worldRng`, `_pendingLogMsgs`, `_qlog`, biome functions |
| `src/audio.js` | `Music` — Web Audio chiptune engine |
| `src/sprites.js` | Player and raider art as pixel grids: `SPRITE_ART`, `PLAYER_PAL`, `LEGS`, `paintGrid`, `pixelActorFrames`, `buildPixelActors` |
| `src/textures.js` | All `draw*` functions, `buildTextures`, `buildAtlases`, `makeScaleProxy` |
| `src/scenes.js` | `BootScene`, `ModeSelectScene`, `SettingsScene`, `ControlsScene`, `CharSelectScene`, `getControls`, `DEFAULT_BINDINGS` |
| `src/game-scene.js` | `GameScene` — all 22 gameplay systems, `GameScene.RECIPES` |
| `src/game-over.js` | `GameOverScene` |

**To find something:** `grep -rn "functionName" src/` searches all source files. Scope with `src/game-scene.js` for gameplay, `src/constants.js` for config, `src/textures.js` for draw code.

## Navigation Manifest (top of `game.js`)
The first ~220 lines of `game.js` are a comment-block **MANIFEST** with the file map above plus a numbered breakdown of all 22 gameplay systems and their primary functions, `CFG` keys, and log tags. **Read it first** before searching — match the request to a numbered system, grep the listed function name in `src/game-scene.js`. Do not scroll the whole file.

### Manifest maintenance — REQUIRED on every change
Whenever you edit any source file, you MUST also update the MANIFEST block in `game.js` in the same commit if any of the following are true:
- You **add** a new gameplay system or major function (give it a numbered entry, or extend an existing one).
- You **rename** a function, `CFG.*` key, or `this.*` state variable that is listed in the manifest.
- You **remove** any function, `CFG.*` key, or state variable that is listed in the manifest.
- You **deprecate** a system (mark it as deprecated in the entry, or remove the entry).

CI enforces this via `.github/workflows/checks.yml` → `manifest-sync`. The check (`scripts/check-manifest.js`) parses the manifest in `game.js` and verifies every referenced symbol exists across `game.js` + all `src/` files. Run locally before pushing:
```bash
node scripts/check-manifest.js
```

## VERSION constant — REQUIRED bump on every PR
The `VERSION` constant (top of `src/constants.js`) is rendered prominently on the title screen as "Last updated …". It must be different on every PR vs `main`.

- **Local:** `bash setup.sh` once configures git to run `.githooks/pre-commit`, which auto-stamps `VERSION` to the current UTC time on every commit.
- **CI:** `.github/workflows/checks.yml` → `version-bump` fails any PR where `VERSION` matches the base branch. This is the hard guarantee — it cannot be skipped, even if the local hook isn't installed.
- **Deploy:** `.github/workflows/pages.yml` re-stamps `VERSION` at publish time so the live "Last updated" reflects the true deploy moment.

(All three — hook, CI check, deploy stamp — target `src/constants.js`. VERSION moved there from `game.js` in the 7-file split; keep them in sync if it ever moves again.)

If CI flags you, stamp manually:
```bash
perl -i -pe "s|const VERSION = '[^']*';|const VERSION = '$(date -u +%Y-%m-%dT%H:%M:%SZ)';|" src/constants.js
```

## Debug Log System
The game has a built-in session log. **Always ask for this file when investigating a bug report.**

### How to get the log
- **In-game:** press the backtick key `` ` `` to open the overlay
  - **`C`** — copy to clipboard
  - **`G`** — download as `iron-wasteland-YYYY-MM-DD.txt`
- **On game over:** the `.txt` file downloads automatically (800 ms after the screen appears)

### What the log captures
Every entry is timestamped with game-time (`T00:00`) and tagged by category:

| Tag | Events |
|-----|--------|
| `[WORLD ]` | Day/night transitions, wave spawns, boss spawn/defeat, raider attacks, game over |
| `[PLAYER]` | Player downed/revived, med kit used, upgrades applied, barracks character swap |
| `[COMBAT]` | Enemy hit, enemy killed, wall destroyed, water_lurker ambush |
| `[BUILD ]` | Build queued via craft menu, structure placed (with tile coords) |

The live overlay header also shows: FPS, day/phase, difficulty multiplier, active vs total enemy count, kill count, and both players' current HP.

### When to ask for the log
- Any crash or freeze report — FPS reading and last few events show where it happened
- Combat balance complaints — damage numbers and kill counts are explicit
- Progression issues (e.g. boss not spawning, waves skipping) — world events are timestamped
- Multiplayer desync — both P1 and P2 HP tracked per event

## Architecture Notes
- **`buildWorld()`** (`src/game-scene.js`) — world generation entry point; calls `_buildPonds`, `_buildLakes`, structure placement, enemy spawn
- **`update(time, delta)`** (`src/game-scene.js`) — main game loop; delegates to `updateEnemies`, `updateWaves`, `updateEnemyDens`, `updateWaterDens`, `updateBoss`, etc.
- **`_log(msg, cat)`** (`src/game-scene.js`) — debug logger; add calls here for any new system worth troubleshooting
- **`_buildLakes(stx, sty)`** (`src/game-scene.js`) — generates 7 large lakes with water dens; each lake spawns `water_lurker` enemies
- **`buildTextures(scene)`** (`src/textures.js`) — called from `BootScene.preload()` in `src/scenes.js`; generates all procedural textures then calls `buildAtlases`
- **`getBiome / _buildBiomeMap`** (`src/constants.js`) — biome logic lives here, not in game-scene.js
- **Two-camera setup:** `cameras.main` (world) + `hudCam` (HUD); new world objects must be ignored by `hudCam`
- **Enemy dormancy:** enemies beyond `CFG.DORMANT_RADIUS` (800px) are hidden and physics-disabled; they wake at `CFG.WAKE_RADIUS` (700px)
- **Water detection:** `_waterTileSet` (Set of `"tx,ty"` strings) checked per-frame in `applyTerrainEffects` — do not use physics overlap for water

## Key Configuration (`CFG` in `src/constants.js`)
- `MAP_W / MAP_H` — map size in tiles (300×300)
- `TILE` — tile size in px (32)
- `SAFE_R` — spawn safe radius in tiles (10)
- `DORMANT_RADIUS / WAKE_RADIUS` — enemy activation thresholds in px

## Knowledge Graph (graphify)
A graphify knowledge graph lives in `graphify-out/`. Use it before reading files manually.

- **Query the graph:** `/graphify query "<question>"` — traces cross-file connections, finds what calls what, explains system relationships
- **The graph is kept current automatically** via the `.githooks/post-commit` hook — it runs an incremental `--update` in the background after every commit
- **If the graph ever feels stale** (e.g. after a big refactor or pulling someone else's changes): `/graphify . --update` from the repo root
- **Full rebuild** (rare, only if graph is corrupted): `/graphify .` from the repo root

God nodes (highest connectivity): `GameScene` (177 edges), `buildTextures()` (86), `GameOverScene` (26), `getBiome()` (15).

## Working Directory
**All edits must target the canonical project folder:** this repository's root, wherever it is cloned. Start sessions there (not in a parent folder) and commit with plain `git`.

Never edit files only inside a worktree. When working in a worktree, always ensure changes are committed/merged back to `main` so the canonical folder stays up to date. If the user asks to update the game, confirm edits land in this folder.

## Branch
Active development: `main`
