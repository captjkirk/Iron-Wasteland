# Contributing to Iron Wasteland

## First-time setup

After cloning, run the setup script once:

```bash
bash setup.sh
```

This does two things:
- Configures git to use the repo's `.githooks/` folder
- Marks the pre-commit hook executable

That's it. There is no build step, no `npm install`, no compiler.

## Development workflow

Open `index.html` directly in a browser. Edit a file in `src/` and refresh — changes are live immediately. Still no build step.

```
index.html      ← thin shell; loads Phaser then the src/*.js files in order
src/version.js  ← VERSION constant + local-time formatter
src/config.js   ← MANIFEST + CFG, data tables, biome/RNG/log helpers
src/audio.js    ← Music + SFX (Web Audio)
src/sprites.js  ← all draw*() textures + buildTextures
src/scenes-menu.js     ← key bindings + Boot/Controls/ModeSelect/Settings/CharSelect
src/scene-game.js      ← GameScene (the bulk of the game)
src/scene-gameover.js  ← GameOverScene
src/main.js     ← new Phaser.Game(...) launch (loaded last)
lib/phaser.min.js
```

These are CLASSIC scripts (not ES modules), so they share one global scope — symbols
defined in one file are visible in all the others, just like the old single `game.js`.
Load order matters: `index.html` lists them in dependency order, with `src/main.js` last.

## Making commits

The pre-commit hook in `.githooks/pre-commit` automatically stamps the `VERSION`
constant in `src/version.js` with the current UTC time before each commit. You don't need
to touch it manually — just commit and the timestamp updates itself.

Players see the timestamp converted to their own local timezone (EDT, PDT, BST, etc.)
via `_fmtVersion()` in `src/version.js`. It's rendered prominently on the title
screen as "Last updated …".

## CI checks (run on every PR)

`.github/workflows/checks.yml` runs two required checks. Both must pass before merge.

### `version-bump`
Fails the PR if `VERSION` in `src/version.js` is identical to `main`. The pre-commit hook
normally handles this, but CI is the hard guarantee. If it flags you:

```bash
sed -i "s|const VERSION = '[^']*';|const VERSION = '$(date -u +%Y-%m-%dT%H:%M:%SZ)';|" src/version.js
git commit --amend --no-edit
```

### `manifest-sync`
The top of `src/config.js` contains a **MANIFEST** comment block that indexes every
gameplay system. CI fails the PR if the manifest references any function name,
`CFG.*` key, or state variable that no longer exists in **any** `src/*.js` file (catches
renames, deletions, typos).

Whenever you rename, remove, or add a manifest-listed symbol, update the
manifest in the same commit. Run the check locally:

```bash
node scripts/check-manifest.js
```

## Debug log

Press `` ` `` in-game to open the debug overlay. From there:
- **`C`** — copy the full session log to clipboard
- **`G`** — download as a `.txt` file

The log captures combat events, player actions, UI interactions, and world
generation details. See `CLAUDE.md` for the full tag reference.

## Reporting bugs

Use the bug report template at `.github/ISSUE_TEMPLATE/bug_report.md`.
Always attach the session log (downloaded with **`G`**) — it timestamps
everything and makes root causes much faster to find.
