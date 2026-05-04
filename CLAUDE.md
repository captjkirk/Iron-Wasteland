# Iron Wasteland — Claude Code Reference

## Project Overview
Single-file Phaser 3 browser game (`game.js`, ~14.7k lines). No build step — edit `game.js` and refresh the browser. All game logic, textures (generated via `Phaser.Graphics.generateTexture`), audio (Web Audio API), and UI live in `game.js`. `index.html` is a thin shell; `lib/phaser.min.js` is the engine.

## Navigation Manifest (top of `game.js`)
The first ~190 lines of `game.js` are a comment-block **MANIFEST** that maps every gameplay system to its primary functions, `CFG` keys, and log tags. **Read it first** before searching the file — match the user's request to a numbered system, then grep the listed function name. Do not scroll the whole file.

### Manifest maintenance — REQUIRED on every change
Whenever you edit `game.js`, you MUST also update the MANIFEST block in the same commit if any of the following are true:
- You **add** a new gameplay system or major function (give it a numbered entry, or extend an existing one).
- You **rename** a function, `CFG.*` key, or `this.*` state variable that is listed in the manifest.
- You **remove** any function, `CFG.*` key, or state variable that is listed in the manifest.
- You **deprecate** a system (mark it as deprecated in the entry, or remove the entry).

CI enforces this via `.github/workflows/checks.yml` → `manifest-sync`. The check (`scripts/check-manifest.js`) parses the manifest and fails the PR if any referenced symbol is no longer present in the file. Run it locally before pushing:
```bash
node scripts/check-manifest.js
```

## VERSION constant — REQUIRED bump on every PR
The `VERSION` constant (top of `game.js`, line ~199) is rendered prominently on the title screen as "Last updated …". It must be different on every PR vs `main`.

- **Local:** `bash setup.sh` once configures git to run `.githooks/pre-commit`, which auto-stamps `VERSION` to the current UTC time on every commit.
- **CI:** `.github/workflows/checks.yml` → `version-bump` fails any PR where `VERSION` matches the base branch. This is the hard guarantee — it cannot be skipped, even if the local hook isn't installed.

If CI flags you, stamp manually:
```bash
sed -i "s|const VERSION = '[^']*';|const VERSION = '$(date -u +%Y-%m-%dT%H:%M:%SZ)';|" game.js
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
- **`buildWorld()`** — world generation entry point; calls `_buildPonds`, `_buildLakes`, structure placement, enemy spawn
- **`update(time, delta)`** — main game loop; delegates to `updateEnemies`, `updateWaves`, `updateEnemyDens`, `updateWaterDens`, `updateBoss`, etc.
- **`_log(msg, cat)`** — debug logger; add calls here for any new system worth troubleshooting
- **`_buildLakes(stx, sty)`** — generates 7 large lakes with water dens; each lake spawns `water_lurker` enemies
- **Two-camera setup:** `cameras.main` (world) + `hudCam` (HUD); new world objects must be ignored by `hudCam`
- **Enemy dormancy:** enemies beyond `CFG.DORMANT_RADIUS` (800px) are hidden and physics-disabled; they wake at `CFG.WAKE_RADIUS` (700px)
- **Water detection:** `_waterTileSet` (Set of `"tx,ty"` strings) checked per-frame in `applyTerrainEffects` — do not use physics overlap for water

## Key Configuration (`CFG`, lines ~20–45)
- `MAP_W / MAP_H` — map size in tiles (300×300)
- `TILE` — tile size in px (32)
- `SAFE_R` — spawn safe radius in tiles (10)
- `DORMANT_RADIUS / WAKE_RADIUS` — enemy activation thresholds in px

## Working Directory
**All edits must target the canonical project folder:** `~/Library/Mobile Documents/com~apple~CloudDocs/Family Sharing/Iron Wasteland/`

Never edit files only inside a worktree. When working in a worktree, always ensure changes are committed/merged back to `main` so the canonical folder stays up to date. If the user asks to update the game, confirm edits land in this folder.

## Branch
Active development: `main`
