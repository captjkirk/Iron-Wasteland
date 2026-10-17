// Tests the Sheltered ring test (isShelteredAt, src/shelter.js) on hand-drawn grids.
// # wall, G gate (a wall to the test), F hearth (campfire/craftbench/bed), P the player. Part of `npm run check`.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const ctx = { GameScene: class {}, CFG: { TILE: 32 } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/shelter.js', 'utf8'), ctx);

function sheltered(grid) {
  const rows = grid.trim().split('\n').map(r => r.trim());
  const at = (x, y) => (rows[y] || '')[x] || '.';
  const y = rows.findIndex(r => r.includes('P')), x = rows[y].indexOf('P');
  return !!ctx.isShelteredAt((tx, ty) => '#G'.includes(at(tx, ty)), (tx, ty) => at(tx, ty) === 'F', x, y);
}

assert.strictEqual(sheltered(`
  ......
  .####.
  .#PF#.
  .#..#.
  .####.
  ......`), true, 'closed ring with a campfire');
assert.strictEqual(sheltered(`
  ......
  .####.
  .#PF..
  .#..#.
  .####.
  ......`), false, 'a gap in the ring');
assert.strictEqual(sheltered(`
  .......
  .###...
  .#PF#..
  .#..#..
  .####..
  .......`), false, 'a diagonal gap (walls touching only at a corner)');
assert.strictEqual(sheltered(`
  ......
  .####.
  .#PFG.
  .#..#.
  .####.
  ......`), true, 'a gate closes the ring');
assert.strictEqual(sheltered(`
  ......
  .####.
  .#P.#.
  .#..#.
  .####.
  ......`), false, 'a closed ring with no campfire');
assert.strictEqual(sheltered(`
  ......
  ...F..
  ..P...
  ......`), false, 'open ground stops at the tile limit');
// The returned ring feeds the spawn block (nearShelterTiles): inside and the pad count, beyond does not.
const ring = ctx.isShelteredAt((x, y) => x === 0 || y === 0 || x === 4 || y === 4, (x, y) => x === 2 && y === 2, 1, 1);
assert.strictEqual(ring.size, 9, 'the ring holds its 3x3 open tiles');
assert.strictEqual(ctx.nearShelterTiles(ring, 3, 3, 0), true, 'a tile inside the ring');
assert.strictEqual(ctx.nearShelterTiles(ring, 5, 2, 0), false, 'a tile outside, no pad');
assert.strictEqual(ctx.nearShelterTiles(ring, 4, 2, 1), true, 'the wall tile is within a 1-tile pad');
assert.strictEqual(ctx.nearShelterTiles(ring, 5, 2, 1), false, 'two tiles out is beyond a 1-tile pad');
console.log('check-shelter: OK');
