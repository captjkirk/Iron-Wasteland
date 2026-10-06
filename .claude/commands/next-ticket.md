Work one ready ticket, then stop. Run again (or `/loop 30m /next-ticket`) for the next one. Several sessions may run this at once on this machine; the branch name is the lock.

1. Clean up first: for each local branch `ticket-*` whose PR has merged, remove its worktree and delete the branch. For each of your open `ticket-*` PRs that GitHub reports as CONFLICTING: leave it and report it.
2. Frontier: open issues labelled `ready-for-agent`, no assignee, no open blocker (`issue_dependencies_summary.blocked_by` is 0). Lowest number first. Empty frontier: say "frontier empty" and stop. Never take an issue without the label.
3. Claim it before anything else: `gh issue edit <n> --add-assignee @me`. Then from a fresh `main` (`git pull --ff-only` in the main checkout; if git reports `index.lock`, another session is pulling, wait a few seconds and retry): `git worktree add ../wt/ticket-<n> -b ticket-<n>`. If that fails because branch `ticket-<n>` already exists, another session has this ticket: leave the assignee as is and go back to step 2 for the next number.
4. Read the issue with its comments. If it has no "Check" section saying what passes when it is done, comment asking for one, remove the label, unassign yourself, and stop.
5. Build it the way CLAUDE.md says. `npm run check` and `npm run smoke` must pass before the commit. Push and open the PR with `Closes #<n>` and the check output in the body. Do not merge.
6. Report the ticket, the PR link, and what the checks showed. Stop.
