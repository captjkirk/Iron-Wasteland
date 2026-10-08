'use strict';
// ── src/shelter.js — Sheltered: inside a closed ring of built walls with a hearth ──
// Loads after src/game-scene.js and adds _updateShelter to GameScene (ADR 0002).
// A player is Sheltered when the open tiles around them are closed off by built walls (gates count
// as closed, open or not) and one of those tiles holds a campfire, craftbench or bed. No gameplay
// effect yet: the status strip shows an icon (#292); the buffs come in #293.

// A ring holding more open tiles than this counts as open ground (about a 20x20 room).
const SHELTER_MAX_TILES = 400;
const SHELTER_HEARTHS = ['campfire', 'craftbench', 'bed'];

// Flood fill from (tx, ty) over tiles that are not walls, through all eight neighbours, so two
// walls that touch only at a corner leave a gap. True when the fill closes off within `limit`
// tiles and reaches a hearth. isWall(x, y) and isHearth(x, y) take tile coordinates.
function isShelteredAt(isWall, isHearth, tx, ty, limit = SHELTER_MAX_TILES) {
  if (isWall(tx, ty)) return false;
  const seen = new Set([tx + ',' + ty]), todo = [[tx, ty]];
  let hearth = false;
  while (todo.length) {
    const [x, y] = todo.pop();
    if (isHearth(x, y)) hearth = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (seen.has(k) || isWall(nx, ny)) continue;
      if (seen.size >= limit) return false;
      seen.add(k); todo.push([nx, ny]);
    }
  }
  return hearth;
}

Object.assign(GameScene.prototype, {
  // Rechecks each player when they step onto a new tile, or for everyone after a build or a
  // destroyed wall (_shelterDirty). Sets p._sheltered; the status strip reads it.
  _updateShelter() {
    const T = CFG.TILE;
    let hearths = null;
    for (const p of [this.p1, this.p2]) {
      if (!p || !p.spr) continue;
      const tx = Math.floor(p.spr.x / T), ty = Math.floor(p.spr.y / T), key = tx + ',' + ty;
      if (key === p._shelterTile && !this._shelterDirty) continue;
      p._shelterTile = key;
      hearths = hearths || new Set((this.pois || [])
        .filter(o => SHELTER_HEARTHS.includes(o.type) && o.spr && o.spr.active).map(o => o.tx + ',' + o.ty));
      const walls = this._wallBuckets;
      const on = !!walls && walls.size > 0 &&
        isShelteredAt((x, y) => walls.has(x + ',' + y), (x, y) => hearths.has(x + ',' + y), tx, ty);
      if (on !== !!p._sheltered) {
        p._sheltered = on;
        this._hudDirty = true;
        this._log(`${p.charData.player} ${on ? 'is sheltered' : 'left shelter'}  tile=(${tx},${ty})`, 'player');
      }
    }
    this._shelterDirty = false;
  },
});
