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
  return ctx.isShelteredAt((tx, ty) => '#G'.includes(at(tx, ty)), (tx, ty) => at(tx, ty) === 'F', x, y);
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
console.log('check-shelter: OK');
