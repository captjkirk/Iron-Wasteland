// Every doorway in STRUCTURE_LAYOUTS (src/structures.js) is at least MIN_DOOR tiles wide. A
// doorway is a gap in a wall line with an inside tile (floor or indoor loot) on one side and open
// ground on the other. The player's body is 30 px wide, so a 1-tile (32 px) door is a snag (#309).
// Part of `npm run check`.
const fs = require('fs');
const vm = require('vm');

const MIN_DOOR = 2;
const SOLID = new Set(['#', 'R', 'P']);
const isInside = ch => ch === ',' || 'mafwi'.includes(ch);
const isOutside = ch => ch !== undefined && !SOLID.has(ch) && !isInside(ch);

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/structures.js', 'utf8') + '\nthis.L = STRUCTURE_LAYOUTS;', ctx);

// Doorways in each row of grid: runs of open tiles between two solids, inside on one side and
// outside on the other. Columns are checked by running this on the transposed grid.
function doorways(grid) {
  const found = [];
  grid.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x < row.length; x++) {
      if (!SOLID.has(row[x])) { if (start < 0) start = x; continue; }
      if (start > 0) {
        const cells = [];
        for (let i = start; i < x; i++) cells.push(i);
        const above = cells.map(i => (grid[y - 1] || [])[i]), below = cells.map(i => (grid[y + 1] || [])[i]);
        const leads = (a, b) => a.some(isInside) && b.some(isOutside);
        const inRoom = cells.every(i => isInside(row[i])); // a row of the room itself, not a gap
        if (!inRoom && (leads(above, below) || leads(below, above))) found.push({ y, x: start, width: x - start });
      }
      start = -1;
    }
  });
  return found;
}

let failures = 0, count = 0;
for (const [biome, layout] of Object.entries(ctx.L)) {
  const rows = layout.rows.map(r => [...r]);
  const cols = rows[0].map((_, x) => rows.map(r => r[x]));
  const all = [
    ...doorways(rows).map(d => ({ ...d, at: `row ${d.y}, column ${d.x}` })),
    ...doorways(cols).map(d => ({ ...d, at: `column ${d.y}, row ${d.x}` })),
  ];
  for (const d of all) {
    count++;
    if (d.width < MIN_DOOR) {
      console.error(`check-structures: ${biome} '${layout.label}' has a ${d.width}-tile doorway at ${d.at}; ` +
        `make it at least ${MIN_DOOR} tiles wide`);
      failures++;
    }
  }
}
if (failures) process.exit(1);
console.log(`check-structures: OK (${count} doorway${count === 1 ? "" : "s"}, all at least ${MIN_DOOR} tiles wide).`);
