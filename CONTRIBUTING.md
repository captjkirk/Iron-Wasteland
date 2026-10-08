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

The pre-commit hook refuses a commit on `main`, and any commit from the main checkout (every
session works in its own worktree; see `CLAUDE.md`, "Working directory"), then runs
`npm run check`: a syntax check of `game.js` and every `src/*.js`, a check that every `src/*.js`
has a `<script>` tag in `index.html`, the manifest check, a check that every doorway in
`STRUCTURE_LAYOUTS` is at least 2 tiles wide, and ESLint. A failure aborts the commit.

`VERSION` in `src/constants.js` stays `'dev build'` in git. `npm run serve` stamps it with the
commit time of `HEAD` on every request, and the deploy stamps it with the publish time, so the
title screen's "Last updated" is real in both places and no two PRs ever edit that line
([ADR 0003](docs/adr/0003-stamp-version-on-serve-not-in-commits.md)). Opening `index.html`
straight from disk shows "dev build".

A post-commit hook refreshes a local graphify knowledge graph in `graphify-out/` (gitignored) if
you have built one. It runs in the background and never blocks a commit.

Run `npm run check` yourself any time. If you add, rename, remove or deprecate anything
the MANIFEST lists, update the MANIFEST in the same commit.

## CI checks (run on every PR)

`.github/workflows/checks.yml` runs two checks; both must pass before merge.

- **`check`** runs `npm run check`, the same as the hook.
- **`smoke`** runs `npm run smoke`: it fetches Playwright's WebKit (pinned in `package.json`,
  never installed into the repo) and makes three passes. The first loads the game and fails
  unless `ModeSelect` comes up with no console error; it catches a file using a name from a
  file that loads after it, which ESLint passes. The second loads `?seed=1&renderer=canvas`
  (headless WebKit loses the WebGL context in play, so the canvas renderer stands in), starts
  a solo game, waits for the world, plays ten seconds and fails on any console or page error.
  Then it ends the run, types a two-word name on the game over screen and presses Enter; the
  global scoreboard is stubbed, so no smoke run posts a real score. The third starts the same
  game in Hardcore and fails unless the clock runs for five seconds; a page that stops answering
  fails the run instead of stalling it. Shader and WebGL-only bugs stay invisible to it. Run it
  locally before moving code between `src/` files or touching a system that runs every frame.

On deploy, `.github/workflows/pages.yml` stamps `VERSION` with the publish time.

## The ticket loop

A fully specified issue (it has a "Check" section) gets the `ready-for-agent` label. In Claude
Code, `/next-ticket` first runs `/judge` in a fresh subagent, which merges green PRs whose
ticket it can verify and labels the rest `needs-owner-look` for the owner (rules in
`.claude/commands/judge.md`). Then it claims the lowest such issue, builds it in its own
worktree, and opens a PR; `/loop 30m /next-ticket` keeps going until the frontier is empty. After a few tickets the
session is no longer fresh: start a new one and run the loop again.

## Seeing a sprite or a boss without playing to it

- `node tools/render-texture.js boss_wolf wolf` writes each named texture to
  `texture-renders/<key>.png` at 4× (needs Playwright: `npm install --no-save playwright`).
  Put before/after images of any sprite change in its PR.
- Add `?boss=wolf` to the game URL (or `golem`, `spider`, `troll`, `hydra`) to have that boss
  spawn 3 s after the world is built. Works on iPad too.

## Debug log

Every run's session log is saved with its score: it lands in the `log` column of the
scoreboard sheet's `Scores` tab, one row per run (`runId` column), on any host. A log longer
than one sheet cell keeps its header and newest entries. On home play (`node server.js`) a copy
also lands in `logs/` when the game ends.

To get one by hand: press `` ` `` in-game to open the debug overlay. **`C`** copies the session
log to the clipboard; **`G`** downloads it as a `.txt` file. The game-over screen has a
"download log" button too.

## Reporting bugs

Use the bug report template at `.github/ISSUE_TEMPLATE/bug_report.md` and attach the session
log. It timestamps everything and makes root causes much faster to find.
