# Contributing to Iron Wasteland

## First-time setup

After cloning, run once:

```bash
bash setup.sh
```

It points git at `.githooks/`. There is no build step and no `npm install`.

## Development workflow

Open `index.html` in a browser (or `npm run serve` to play over the home network). Edit any
file in `src/` and refresh. `index.html` loads `lib/phaser.min.js`, then the `src/` files in
dependency order, then `game.js`; they share one global scope. `game.js` opens with the
MANIFEST, an index of every gameplay system: read it first to find where a system lives.

## Making commits

The pre-commit hook does two things:

1. Stamps `VERSION` in `src/constants.js` with the current UTC time. The title screen shows
   it as "Last updated …" in the player's own timezone.
2. Runs `npm run check`: a syntax check of `game.js` and every `src/*.js`, the manifest check,
   and ESLint. A failure aborts the commit.

A post-commit hook refreshes a local graphify knowledge graph in `graphify-out/` (gitignored) if
you have built one. It runs in the background and never blocks a commit.

Run `npm run check` yourself any time. If you add, rename, remove or deprecate anything
the MANIFEST lists, update the MANIFEST in the same commit.

## CI checks (run on every PR)

`.github/workflows/checks.yml` runs two checks; both must pass before merge.

- **`version-bump`** fails the PR if `VERSION` matches `main`. The hook normally prevents
  this. If it flags you:

  ```bash
  perl -i -pe "s|const VERSION = '[^']*';|const VERSION = '$(date -u +%Y-%m-%dT%H:%M:%SZ)';|" src/constants.js
  ```

  then commit again.
- **`check`** runs `npm run check`, the same as the hook.

On deploy, `.github/workflows/pages.yml` re-stamps `VERSION` with the publish time.

## Debug log

Press `` ` `` in-game to open the debug overlay. **`C`** copies the session log to the
clipboard; **`G`** downloads it as a `.txt` file. It also downloads on its own when the game
ends.

## Reporting bugs

Use the bug report template at `.github/ISSUE_TEMPLATE/bug_report.md` and attach the session
log. It timestamps everything and makes root causes much faster to find.
