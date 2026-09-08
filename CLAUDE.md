# Iron Wasteland — Claude Code Reference

## Project Overview
Phaser 3 browser game. No build step — edit files in `src/` and refresh the browser. `index.html` loads scripts in dependency order; all files share global scope (no ES modules). `lib/phaser.min.js` is the engine.

## File Map
| File | Contents |
|---|---|
| `game.js` | Header manifest + `Phaser.Game` init only (~211 lines) |
| `src/constants.js` | `VERSION`, `CFG`, `ENEMY_STATS`, `ENEMY_LOOT`, `CHARS`, `STATE`, `_worldRng`, `_pendingLogMsgs`, `_qlog`, biome functions |
| `src/audio.js` | `Music` — Web Audio chiptune engine |
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
