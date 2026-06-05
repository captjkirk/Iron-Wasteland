# File-Split Progress Notes (game.js → src/*.js)

> Working note for the multi-file split. Tracked on branch
> `claude/dazzling-edison-pTcuk` / **PR #121** (draft):
> https://github.com/captjkirk/Iron-Wasteland/pull/121
>
> This is a scratch/handoff doc — fine to delete before merging to `main`.

## Goal
Split the single ~14.9k-line `game.js` into focused files **without a build step**
and **without breaking local play or GitHub Pages**.

## Key decisions (locked)
- **Classic `<script>` tags, NOT ES modules.** All files share one global scope,
  exactly like the old single file. This keeps:
  - No build step (edit a `src/` file, refresh).
  - **Double-click `index.html` (`file://`) still works** — ES modules would have
    broken that via CORS. This was the deciding factor.
  - Identical behavior on GitHub Pages (static files served by extension).
- **The split is a verbatim slice** of the original (no code rewritten). Proven
  **byte-for-byte identical**: concatenating the slices reproduces `game.js`
  lines 193→EOF exactly.
- **GameScene kept whole** (one file). A class can't span classic-script files;
  breaking it further (prototype mixins) is a deferred follow-up.

## File map (load order — see `index.html`)
| File | ~Lines | Contents |
|------|------:|----------|
| `src/version.js` | 23 | `VERSION` + `_fmtVersion` (VERSION lives here now) |
| `src/config.js` | 486 | **MANIFEST** + `CFG`, data tables, biome/RNG/log helpers, `CHARS`, `STATE` |
| `src/audio.js` | 302 | `Music`, `SFX` |
| `src/sprites.js` | 3,600 | all `draw*()`, `getControls`, `makeScaleProxy`, `buildTextures` |
| `src/scenes-menu.js` | 1,054 | key bindings + Boot/Controls/ModeSelect/Settings/CharSelect |
| `src/scene-game.js` | 8,959 | `GameScene` (the bulk) |
| `src/scene-gameover.js` | 507 | `GameOverScene` |
| `src/main.js` | 27 | `new Phaser.Game(...)` launch — **loads last** |

## Tooling repointed off `game.js` (all done)
- `index.html` — loads the eight scripts in dependency order, `main.js` last.
- VERSION → `src/version.js`; updated `checks.yml` (`version-bump`),
  `pages.yml` (deploy-time stamp), `.githooks/pre-commit`, docs.
- `scripts/check-manifest.js` — reads MANIFEST from `src/config.js`, validates
  symbols against **all** `src/*.js` (excludes the manifest block itself).
- `package.json` — `check` loops `node --check` over `src/*.js`; `lint` bundles
  `src/*.js` then runs eslint (avoids cross-file `no-undef`).
- `CLAUDE.md` / `CONTRIBUTING.md` / `setup.sh` — describe new layout.
- `game.js` removed; `.lint-bundle.js` gitignored.

## Verification done
- `node scripts/check-manifest.js` → OK (216 fn/state ids, 28 CFG keys).
- `node --check` on all 8 files → pass.
- `node server.js` smoke test → `index.html` 200 + every `src/*.js` 200
  `text/javascript` (mirrors Pages).
- Byte-equivalence proof vs original `game.js` → identical.
- **CI:** `version-bump` ✅ passed; `manifest-sync` verified green locally.

## OPEN ITEMS
- [ ] **In-browser click-test** before merge: open `index.html`, confirm title
      screen + "Last updated…" line render, start a game, move/attack. (Automated
      checks all pass; this is the final human confirmation.)
- [ ] Decide whether to **mark PR ready for review** (currently draft) after the
      click-test.
- [ ] Confirm `manifest-sync` CI run finished green on the PR (was in-progress).
- [ ] Delete this `SPLIT-NOTES.md` before merge if you don't want it in `main`.
- [ ] (Optional, future) **Phase 2:** break `GameScene` itself into per-system
      files via prototype assignment (combat / world-gen / building / HUD …).
- [ ] (Pre-existing, out of scope) `npm run lint` uses ESLint legacy flags
      (`--no-eslintrc`/`--config`) that error under ESLint v9 — a separate
      migration, not caused by this split.

## Notes for whoever resumes
- Remember the **canonical iCloud folder** rule in `CLAUDE.md` — changes should
  also land there so local play stays current.
- `send_later` self-check-in tool was NOT available this session, so PR
  monitoring relies on webhook events (CI failures / review comments).
