'use strict';
// ── src/structures.js — authored biome structures (data only) ────────────────────────────
// buildBiomeStructures (src/world-gen.js) builds the first valid slot of a biome from the layout
// here; the other slot and every biome without a layout keep the generic 7×5 box. The door of a
// layout faces south. Every row is exactly W characters, and H rows make the footprint.
//
// Legend (one character = one tile):
//   .  open ground          ,  floor (the biome's floor tile)
//   #  wall (the biome's wall tile)             R  wreck: a solid ruin block
//   P  pillar (solid)       T  torch with a night glow (no body)       C  supply cache (decoration)
//   m a f w i   loot item on a floor tile: metal, ammo, food, wood, fiber
//   M A F W I   the same loot with no floor under it (outdoors)
//
// guards: the types that spawn around it (see the guard table in src/enemy-ai.js). The number of
// guards is the list length; if there is no list, 2-4 of the biome's animal spawn.

const STRUCTURE_LAYOUTS = {
  waste: {
    label: 'GAS STATION',
    guards: ['bear', 'dust_hound', 'dust_hound'],
    rows: [
      '.T.#####.TA',   // garage back wall, a torch each side, one hidden ammo behind it
      '...#mmm#...',   // garage: 3 metal, 2 ammo, 1 food, always
      '...#aaf#...',
      '...##.##...',   // garage door, south
      'P.R.....R.P',   // canopy posts, and a wreck each side as cover
      '.....C.....',   // the pump row's cache
      'P.........P',
    ],
  },
};

const STRUCTURE_LOOT = { m: 'item_metal', a: 'item_ammo', f: 'item_food', w: 'item_wood', i: 'item_fiber' };
