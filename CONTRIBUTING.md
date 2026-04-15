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

Open `index.html` directly in a browser. Edit `game.js` and refresh — changes are live immediately.

```
index.html      ← thin shell, just loads Phaser and game.js
game.js         ← everything: logic, textures, audio, UI (~9000 lines)
lib/phaser.min.js
```

## Making commits

The pre-commit hook in `.githooks/pre-commit` automatically stamps the `VERSION`
constant in `game.js` with the current UTC time before each commit. You don't need
to touch it manually — just commit and the timestamp updates itself.

Players see the timestamp converted to their own local timezone (EDT, PDT, BST, etc.)
via `_fmtVersion()` at the top of `game.js`.

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
