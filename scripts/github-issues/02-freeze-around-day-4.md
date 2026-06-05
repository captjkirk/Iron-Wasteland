## Type
Bug / stability

## Problem
The local build froze completely around **day 4**, requiring a reload. A freeze
at this point is severe: combined with the relic-on-mountain bug, a single run
can become both frozen and unwinnable.

## Day-4 correlation
"~Day 4" lines up with the **boss spawn** schedule:
- Boss first spawns on `hc.bossStartDay` — **Hardcore = day 4**, Survival = day 5
  (`game.js:13592`)
- The hunting party also keys off early days via `huntNextDay`
  (`game.js:13566`), and can overlap the boss window.

The boss code path already carries freeze forensics, which strongly suggests
this area has stalled before:
- On a boss roll it sets `this._stageTrace = true` so every `update()` stage
  logs its entry until the boss spawns (`game.js:13600`)
- It **auto-downloads the session log ~250 ms before spawn** (`game.js:13607`)
- There is an existing comment describing a prior **Safari** freeze where a
  *synchronous* `a.click()` log download stalled the scheduler so the 5 s
  `spawnBoss` `delayedCall` never fired (`game.js:13602-13606`)

## What we need to confirm root cause
The forensic log that **auto-downloads around day 4/5** on the frozen run:
- File: `iron-wasteland-YYYY-MM-DD.txt` (downloads automatically; or press the
  backtick `` ` `` key then `G`)
- Look at: final FPS reading, the last `[WORLD ]` entries, and whether the
  per-stage trace shows which `update()` stage was last entered before the
  freeze.

Per `CLAUDE.md`, the debug log is the primary tool for freeze/crash reports —
attaching it here will localize the stall.

## Hypotheses to check (pending log)
- Boss spawn / telegraph path stalling the update loop — consistent with the
  forensic instrumentation living exactly here.
- Synchronous log download (`_downloadLog(true)`) re-introducing the documented
  scheduler stall on some browsers.
- A spike in active enemies / particles at the boss + hunting-party overlap
  around day 4 (`spawnHuntingParty`, `spawnBoss`).

## Please include when reporting
- Browser + OS (Chrome / Safari / Firefox).
- Mode: **Survival or Hardcore?** (Hardcore puts the first boss on day 4,
  matching the freeze timing exactly.)
- The auto-downloaded `iron-wasteland-*.txt` from the frozen run.
