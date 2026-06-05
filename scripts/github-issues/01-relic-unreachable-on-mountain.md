## Type
Bug / world-gen

## Problem
A relic POI can spawn on top of (or inside the collision footprint of) a
mountain, where the player physically cannot reach it. Because winning requires
depositing all 5 relics at the altar (`relicsHeld === 5`), a single unreachable
relic makes the run **permanently unwinnable**.

Observed live: a relic sitting on a mountain ridge with the player unable to
path to it (screenshot in original report — relic glows on dark mountain
terrain, "carrying 1 / ALTAR ◇◇◇◇◇").

## Root cause
Relics are placed in `buildPOIs()` via `findInBiome()`, which rejects tiles
flagged by `_isImpassable()`:
- `game.js:6666` — `_isImpassable` checks `_waterMap` and `_solidTileSet`
- `game.js:6824` — relic placement calls `findInBiome(biome, 80)`

The gap is in `_solidTileSet` coverage. It is built by marking only a **3×3
tile** neighborhood around each mountain's *anchor* tile:
- `game.js:6515-6521`

But mountains are rendered at scale up to **4.0×** (`game.js:6480`, `:6508`).
A `mountain` sprite is 96×80 px; at 4× that is 384×320 px ≈ **12×10 tiles** of
visual footprint. The marked 3×3 set covers only a fraction of the area a large
mountain visually/physically occupies.

Result: a relic tile can pass the `_isImpassable` check (not in the 3×3 set,
not water) yet sit buried in a mountain cluster, ringed by mountain collision
bodies the player can't cross. There is also **no reachability check** from
spawn and **no relocation fallback** if the chosen tile ends up boxed in.

Note: each mountain's *physics* body is only a ~13px-radius circle at the
visual base (`game.js:6445-6457`), so it is the surrounding cluster of these
circles — plus the visual burial — that strands the relic, not a single body.

## Why this is a hard blocker
Win condition is `relicsHeld === 5` deposited at the altar (manifest §22;
`_depositRelic`). One unreachable relic ⇒ can never reach 5 ⇒ run cannot be won.

## Proposed fixes (any/all)
1. **Expand `_solidTileSet` to the real mountain footprint.** When marking a
   mountain, mark a radius derived from its display size
   (`Math.ceil(displayWidth / TILE / 2)`) instead of a fixed ±1, so impassable
   checks reflect large mountains.
2. **Reachability validation for relics.** After placement, BFS/flood-fill from
   spawn over passable tiles; if a relic tile is unreachable, relocate it to the
   nearest reachable tile in the same biome (mirrors the relocation logic
   proposed in #109 for underwater POIs).
3. **Widen `findInBiome` fallback** so it never returns a possibly-blocked tile
   (`game.js:6681-6687`).
4. **Runtime safety net:** if a relic is still unreachable in play, allow
   pickup/channel from an adjacent tile, or auto-return it to a reachable spot.

## Related
- #109 (POIs placed on unreachable/underwater tiles) — same *class* of bug
  (unreachable POIs), different root cause (this is solid-tile under-coverage,
  not water-gen ordering). A shared "relocate POIs off impassable tiles" pass
  could fix both.

## Repro notes
- Procedurally generated, so it is intermittent — depends on a relic biome
  roll landing in a large mountain cluster. The fix should be deterministic
  (coverage + reachability), not RNG-reroll-only.
