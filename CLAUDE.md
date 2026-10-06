# Iron Wasteland — Claude Code Reference

## The method

Plan work in vertical slices. When a task will outlast one session or touch more than one layer (constants, scene logic, textures or sprites, scenes and UI, the manifest, CI), show a numbered plan before starting and wait for my approval. Each slice is a thin path through every layer it needs and ends in something I can check myself: an automated check that passes, plus the exact steps I take in the browser to see it work. Slice 1 is the smallest end-to-end path, built first to prove the layers connect. Each slice fits one fresh session and says what blocks it and whether it needs me. Never plan "all of one layer, then the next". A mechanical change across many files (a rename, a split of the scene file) is the exception: add the new form, move callers over in batches, then remove the old form. When I review your plan, I am looking for the slice that finishes only one layer. Make sure there is none.

Slice only the route you can see. If the way to the goal is not clear yet, the first steps are questions to settle with me, not slices. Mark every item decide or build. A decide item ends in a recorded answer, one answered per session. What cannot yet be asked sharply goes under "Not yet specified" and is never sliced in advance. Charting every item up front fails the same way horizontal building does: the later items stop making sense before you reach them.

One map per effort, on GitHub. A multi-session effort is one issue labelled wayfinder:map with Destination, Notes, Decisions so far, Not yet specified, and Out of scope. Its tickets are child issues labelled wayfinder:research, wayfinder:prototype, wayfinder:grilling, or wayfinder:task. One such map already exists: issue 156, separate-view 2-player on home Wi-Fi. It is the model for every future map. The map is an index, not a store: an answer lives in its ticket's resolution comment, and the map only points at it. Never write product code inside a decision ticket, and never grant yourself an exemption to do so in the map's own Notes.

No commit without its check. A commit message never says "untested". Every commit passes npm run check. A change I need to see in the browser ships with the steps to see it, in the PR body or the commit message.

One word per concept. Agreed terms live in GLOSSARY.md at the repo root. Read it before planning. When a term is settled in conversation, add it right away: one or two sentences, then an "Avoid:" line listing the words it replaces. The codebase already has terms worth capturing (dormancy, wake radius, dens, waves, the manifest, the two cameras). If a word I use conflicts with the glossary, say so and ask which is meant.

## Keeping the repo clean

- Build the check, not the rule. When you catch a mechanical mistake, add a deterministic check (a script in npm run check, a pre-commit step, a CI job). The manifest check is the model. Prose in CLAUDE.md is only for judgement calls no check could make.
- Prune, never append. When you add a line to CLAUDE.md, remove or merge one. A file that only grows becomes sediment.
- Do not cache the environment. Instruction files hold only what cannot be looked up: the unwritten convention, the reason behind a choice, the gotcha (the two cameras, the water lookup, the dormancy radii).
- One source of truth per meaning. When two files would say the same thing, one owns it and the other links to it.
- Say what to do, not what to avoid. Phrase the positive target. Keep a ban only as a hard guardrail, paired with the positive.
- Prefer a new file over a longer scene. src/game-scene.js grows only when the change cannot sit behind a small interface in its own file. The map's own Notes already say this.
- Small steps, real feedback. If there is no feedback loop on a change, build one before the change.

## Where things live

- **Players:** iPads (touch, plus an iPad Pro with a keyboard), an older iPhone, a laptop and a Mac. Every iOS browser is WebKit. A change works only once it works on touch and on keyboard.
- **Code:** Phaser 3, plain `<script>` files sharing one global scope, no build step. Before searching, read the MANIFEST at the top of `game.js`: it maps every gameplay system to its functions, `CFG` keys and log tags, and ends with the common gotchas (the two cameras, water lookup, dormancy). Update it in the same commit whenever you add, rename, remove or deprecate anything it lists.
- **Setup, hooks, VERSION, CI:** `CONTRIBUTING.md` owns them.
- **Issues:** GitHub, via `gh`; see `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`. Terms and decisions: `GLOSSARY.md` and `docs/adr/`, per `docs/agents/domain.md`.
- **Knowledge graph:** if `graphify-out/` exists (local only, gitignored), ask `/graphify query "<question>"` before reading files by hand. Refresh with `/graphify . --update` after a big refactor or a pull.

## Bug reports

Ask for the session log on any bug report (how players get it: `CONTRIBUTING.md`, "Debug log"). It settles a crash or freeze (FPS and the last events), a balance complaint (damage and kill counts), a progression bug (timestamped world events) and a 2-player desync (both players' HP per event). When you add a system worth troubleshooting, give it `_log(msg, cat)` calls.

## Working directory

Start sessions in this repository's root, not a parent folder, and commit with plain `git`. Work done in a worktree or branch is finished only once it is merged to `main`.
