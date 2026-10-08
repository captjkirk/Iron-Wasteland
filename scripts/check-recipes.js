// Checks src/recipes.js, the one table of what everything costs. Part of `npm run check`.
// Every cost names a known resource with a whole positive amount, every charId is a CHARS id,
// keys are unique, and getBuildCost (src/building-crafting.js) charges each recipe's own cost,
// so no second cost table can creep back in (#354: one had, and the Torch was free to place).
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const RESOURCES = ['wood', 'metal', 'fiber', 'food', 'rare'];
const TYPES = ['build', 'instant', 'upgrade'];

// The src/ files share one global scope; a top-level const is not a property of the context,
// so each file's names are copied onto it after the file runs.
const ctx = { GameScene: function GameScene() {} };
vm.createContext(ctx);
const load = (file, names) =>
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\n' + names.map(n => `this.${n} = ${n};`).join(' '), ctx, { filename: file });
load('src/constants.js', ['CHARS']);
load('src/recipes.js', ['RECIPES']);
load('src/building-crafting.js', []);

const { CHARS, RECIPES } = ctx;
process.on('uncaughtException', e => { console.error('check-recipes: ' + e.message.split('\n')[0]); process.exit(1); });
const charIds = CHARS.map(c => c.id);
const seen = new Set();
for (const r of RECIPES) {
  const at = `recipe ${r.key || r.label}`;
  assert.ok(r.key && !seen.has(r.key), `${at}: key missing or used twice`);
  seen.add(r.key);
  assert.ok(TYPES.includes(r.type), `${at}: type "${r.type}" is not one of ${TYPES.join('|')}`);
  assert.ok(Object.keys(r.cost).length > 0, `${at}: no cost`);
  for (const [res, amt] of Object.entries(r.cost)) {
    assert.ok(RESOURCES.includes(res), `${at}: cost names "${res}", not one of ${RESOURCES.join('|')}`);
    assert.ok(Number.isInteger(amt) && amt > 0, `${at}: ${res} amount ${amt} is not a whole number above 0`);
  }
  if (r.charId !== undefined) assert.ok(charIds.includes(r.charId), `${at}: charId "${r.charId}" is not in CHARS`);
  assert.deepStrictEqual(ctx.GameScene.prototype.getBuildCost(r.key), r.cost,
    `${at}: getBuildCost charges something other than the craft menu's cost`);
}
console.log(`check-recipes: OK (${RECIPES.length} recipes)`);
