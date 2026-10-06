# Stamp VERSION on serve and at deploy, never in commits

Status: accepted (October 6, 2026). Built in the same change.

Until today the pre-commit hook rewrote `const VERSION = '…'` in `src/constants.js` with the current time on every commit, and a CI job failed any PR whose VERSION matched `main`. The title screen shows that value as "Last updated".

## Why it had to change

Every PR edited the same line, so the second of two concurrent PRs conflicted on it the moment the first merged. It happened on October 6, 2026 (PR 198 after PR 202), and with the `/next-ticket` loop running in more than one session it would happen to every pair. The deploy workflow already re-stamps VERSION with the publish time, so the committed value only ever served `npm run serve` and opening `index.html` from disk.

## What we do instead

- Git holds `VERSION = 'dev build'`. Nothing rewrites it in a commit.
- `server.js` replaces it with the committer time of `HEAD` whenever it serves `src/constants.js`, so a refresh after a commit shows the new time. Without git it serves the file as is.
- `.github/workflows/pages.yml` keeps stamping the publish time at deploy, unchanged.
- `_fmtVersion` returns a non-date unchanged, so a file opened from disk shows "Last updated dev build".
- The `version-bump` CI job and its required status check on `main` are gone.

## Considered options

- **Keep the stamp and merge `main` plus re-stamp on every conflict.** Works, but it is a chore on every concurrent PR, forever, for a value the deploy overwrites anyway.
- **A git merge driver for that line.** GitHub's merge does not run custom drivers, so the conflict would still block the PR.
- **A bot commit that stamps `main` after each merge.** Branch protection requires PRs for everyone, and the stamp would race the next merge.

## Consequences

- A PR never touches `src/constants.js` unless it changes a constant on purpose.
- The session log and the game-over screen show HEAD's commit time under `npm run serve`, the publish time on the deployed site, and "dev build" from disk.

## What would reopen this

- Players report the title screen's date as wrong or missing on a path that matters, most likely the from-disk open.
