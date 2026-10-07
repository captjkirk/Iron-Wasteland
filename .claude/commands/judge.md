Judge each open PR once, then stop. You did not write these PRs and you change no code: you merge, hold, or wait. The owner has authorized the merges this file describes, and no others.

For each open, non-draft PR without the `needs-owner-look` label, lowest number first:

1. **Wait** (no comment) if a required check is pending or the PR is CONFLICTING. If it failed a check, comment the failing job once and move on. If GitHub reports it BEHIND `main`, run `gh pr update-branch <n>` and leave it for the next run.
2. **Find its ticket** from `Closes #<n>`. No ticket: hold.
3. **Hold for the owner** when any of these is true:
   - the ticket is labelled `visual`, `ux`, `world-gen` or `performance` (the headless checks cannot see how it looks or how fast it runs on an iPad);
   - the diff changes what is drawn on screen (textures, sprites, colours, layout, HUD) even if the labels say otherwise;
   - the diff touches the checks or the loop: `package.json`, `scripts/`, `.github/`, `.githooks/`, `eslint.config.js`, `.claude/`.
4. **Judge the rest** against the ticket: read the issue with its comments, its "Check" section, and `gh pr diff <n>`. Merge only if the diff does what the ticket asks and nothing outside it, and the Check section is met. If the Check section names something CI does not run, run it yourself in `git worktree add ../wt/judge-<n> <branch>` and remove that worktree after. Any doubt: hold.
5. **Act and leave a trail.** Every verdict is a PR comment starting `Judge:`, saying merge or hold and the one reason.
   - Merge: `gh pr merge <n> --squash`.
   - Hold: `gh pr edit <n> --add-label needs-owner-look`. The owner merges it or removes the label to send it back.

Report one line per PR: number, verdict, reason.
