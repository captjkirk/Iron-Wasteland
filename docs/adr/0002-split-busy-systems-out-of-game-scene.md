# Move the four busiest systems out of the game scene, one at a time

Status: accepted (October 6, 2026). Not built yet; blocked on the smoke run from [ADR 0001](0001-browser-smoke-run-in-ci.md).

`src/game-scene.js` is 9,388 lines, all one `GameScene` class. We decided to move four of the MANIFEST's numbered systems into their own files and leave the rest where they are: 1 (world / terrain generation), 2 (enemy AI / pathfinding / damage), 4 (waves & bosses) and 8 (building & crafting). Together they are about 4,700 lines, half the file, and they take most of the edits.

## Why only these four

Counted across the 202 commits that touched the game scene (in `game.js` before the 7-file split, `src/game-scene.js` after), skipping wholesale moves:

| System | Commits that touched it | Lines today |
|---|---|---|
| 2. Enemy AI | 74 | ~1,200 |
| 1. World generation | 55 | ~1,700 |
| 8. Building & crafting | 55 | ~900 |
| 4. Waves & bosses | 39 | ~880 |

Nine of the other 18 systems were touched 16 times or fewer. Moving them would cost a reviewed move each and save nothing. The counts are approximate: a changed line is credited to the method above it, so they rank the systems rather than measure them.

## How a system moves

Each new file adds its methods to the existing class, unchanged:

```js
// src/world-gen.js (loads right after src/game-scene.js)
Object.assign(GameScene.prototype, {
  buildWorld(worldW, worldH) { /* body moved as-is */ },
  // ...
});
```

Method bodies move with no edits and every `this.foo()` call keeps working, so each move is a cut and paste a reviewer can check by diff. No moved method uses `super`, which an object-literal method would break.

- **ESLint:** no change. A moved file declares no new top-level names, and it reads `GameScene` from the shared globals the config already builds.
- **Manifest check:** no change. It already searches every `src/*.js` file; only the MANIFEST's file map and the "(all in src/game-scene.js)" heading need editing.
- **Load order:** the new file must load after `src/game-scene.js` in `index.html`. Loading it earlier throws at startup, which is exactly what the smoke run catches.

## Considered options

- **No split.** Free and safe, and git already merges edits to separate methods cleanly. Rejected because every change to the busy systems still means working inside a 9,400-line file.
- **Split all 22 systems.** Rejected: most of the moves would land on code that almost never changes.
- **Plain functions that take the scene** (`buildWorld(scene, ...)`). Gives each system a visible interface, but means rewriting every `this.` by hand across thousands of lines. A missed one fails only in play, past the title screen where the smoke run stops.

## Consequences

- One system per slice, each after the smoke run lands, each with `npm run check` passing and browser steps to see that system still work.
- `create()` and `update()` stay in `src/game-scene.js` and keep calling the moved methods by name.
- New systems still go in new files from the start, under the same `Object.assign` shape.

## What would reopen this

- A moved system needs `super`, or a private field, which this shape cannot carry.
- Edits shift to systems that stayed behind. Recount and move those instead.
