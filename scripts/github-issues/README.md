# Pending bug issues (Claude Code on the web)

Cloud sessions' built-in GitHub tools are **read + comment only** — they can't
open new issues. To let an agent file these, install `gh` and provide a token:

1. **Add a token.** In your environment settings, set `GH_TOKEN` to a GitHub
   PAT (`repo` scope, or fine-grained with `Issues: read/write`).
2. **Install gh.** Point your environment setup script at `scripts/web-setup.sh`
   (or paste `apt update && apt install -y gh` into it).
3. **Relaunch.** Env-var / setup-script changes only apply to a *new* session.
4. **Create the issues.** Run `bash scripts/github-issues/create-issues.sh`.

## Issue drafts in this folder
| File | Title |
|------|-------|
| `01-relic-unreachable-on-mountain.md` | Relic can spawn unreachable on a mountain → game becomes unwinnable |
| `02-freeze-around-day-4.md` | Game freezes ~day 4 (correlates with boss spawn) — capture forensic log |

The bodies are reusable: paste them into the GitHub web UI manually if you'd
rather not wire up `gh`.
