'use strict';
// ── src/tracks.js — Tracks: the boot prints walkers leave behind (#308) ──────
// Globals exported: Tracks
// Players and raiders (isRaider) leave a boot print every CFG.TRACKS.STRIDE px, alternating
// left and right foot, turned to the way they walked. The ground under a print sets how long
// it lasts and how dark it starts (CFG.TRACKS.GROUND); water takes no print. A print holds
// full strength, then fades out over the last CFG.TRACKS.FADE of its life.
// Cost is bounded by CFG.TRACKS.CAP pooled sprites, not by the number of walkers: when the
// pool is full the oldest print is recycled early.
//
//   scene.tracks = new Tracks(scene);       // once the world and the HUD camera exist
//   scene.tracks.update(scene.time.now);    // every frame
//   scene.tracks.newestNear(tx, ty, 'player', 2)   // per-tile index, for raiders that follow tracks (#310)
//
// grep: "class Tracks"  "CFG.TRACKS"  "print_player"  "print_raider"

const TRACK_KINDS = ['player', 'raider'];

class Tracks {
  constructor(scene) {
    this.scene = scene;
    this.live = [];       // live prints, unordered (swap-remove)
    this.free = [];       // pooled print records with a hidden sprite
    this.made = 0;        // sprites created so far (never above CAP)
    this.byTile = new Map(); // (tile index << 1 | kind) -> newest live print of that kind on that tile
    this.walkers = new WeakMap(); // walker object -> { x, y, foot } (last print anchor)
    this.stats = { placed: 0, recycled: 0, skippedWater: 0 };
    this._lastLog = 0;
    // Deep water is an obstacle, not in _waterMap; mark it too so no print lands on it.
    const { MAP_W, MAP_H, TILE } = CFG;
    this.deep = new Uint8Array(MAP_W * MAP_H);
    for (const t of scene.deepWaterTiles || []) {
      this.deep[Math.floor(t.x / TILE) + Math.floor(t.y / TILE) * MAP_W] = 1;
    }
    scene._log(`Tracks ready  cap=${CFG.TRACKS.CAP}  stride=${CFG.TRACKS.STRIDE}px`, 'world');
  }

  // Each frame: lay prints for every walker that has moved a stride, then fade and expire.
  update(now) {
    const s = this.scene;
    for (const p of [s.p1, s.p2]) {
      if (p && p.spr?.active && !p.isDowned) this._step(p, 'player', now);
    }
    for (const r of s.raiders || []) {
      if (r.hp > 0 && r.spr?.active) this._step(r, 'raider', now);
    }
    const fade = CFG.TRACKS.FADE;
    const live = this.live;
    for (let i = live.length - 1; i >= 0; i--) {
      const rec = live[i];
      const left = rec.born + rec.life - now;
      if (left <= 0) this._release(rec);
      else if (left < rec.life * fade) rec.img.setAlpha(rec.alpha * left / (rec.life * fade));
    }
    if (now - this._lastLog > 30000) {
      this._lastLog = now;
      const st = this.stats;
      if (st.placed) s._log(`Tracks  live=${live.length}/${CFG.TRACKS.CAP}  placed=${st.placed}  recycled_early=${st.recycled}  on_water_skipped=${st.skippedWater}`, 'perf');
      st.placed = st.recycled = st.skippedWater = 0;
    }
  }

  // The newest live print of `kind` within r tiles of (tx, ty), or null. Each result is
  // { kind, born, tx, ty }; born is scene.time.now when it was made.
  newestNear(tx, ty, kind, r = 1) {
    const MW = CFG.MAP_W, MH = CFG.MAP_H, k = TRACK_KINDS.indexOf(kind);
    let best = null;
    for (let y = Math.max(0, ty - r); y <= Math.min(MH - 1, ty + r); y++) {
      for (let x = Math.max(0, tx - r); x <= Math.min(MW - 1, tx + r); x++) {
        const rec = this.byTile.get(((x + y * MW) << 1) | k);
        if (rec && (!best || rec.born > best.born)) best = rec;
      }
    }
    return best && { kind: best.kind, born: best.born, tx: best.tile % MW, ty: Math.floor(best.tile / MW) };
  }

  // Lay a print each stride a walker's feet cover. Feet: the sprite bottom _sortDepth reads, 6 px up onto the soles.
  _step(w, kind, now) {
    const spr = w.spr;
    const x = spr.x, y = spr.y + spr.displayHeight / 2 - 6;
    const { STRIDE, GAIT } = CFG.TRACKS;
    const st = this.walkers.get(w);
    if (!st) { this.walkers.set(w, { x, y, foot: 0 }); return; }
    let dx = x - st.x, dy = y - st.y;
    let d = Math.hypot(dx, dy);
    if (d > STRIDE * 4) { st.x = x; st.y = y; return; } // teleport, respawn, knockback: no trail
    // Each print sits exactly one stride on from the last, so spacing stays steady.
    for (let n = 0; d >= STRIDE && n < 3; n++) {
      const ux = dx / d, uy = dy / d;
      st.x += ux * STRIDE; st.y += uy * STRIDE;
      // Left of the walking line is (uy, -ux) on screen (y points down).
      const side = st.foot ? -1 : 1; // foot 0 = left, 1 = right
      this._place(st.x + uy * GAIT * side, st.y - ux * GAIT * side, Math.atan2(uy, ux), st.foot, kind, now);
      st.foot ^= 1;
      dx = x - st.x; dy = y - st.y; d = Math.hypot(dx, dy);
    }
  }

  _place(x, y, angle, foot, kind, now) {
    const s = this.scene, { TILE, MAP_W, MAP_H } = CFG;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return;
    const tile = tx + ty * MAP_W;
    if ((s._waterMap && s._waterMap[tile]) || this.deep[tile]) { this.stats.skippedWater++; return; }
    const ground = CFG.TRACKS.GROUND[(s._iceMap && s._iceMap[tile]) ? 'ice' : getBiome(tx, ty)];
    if (!ground) return;
    const rec = this._take();
    rec.kind = kind; rec.foot = foot; rec.tile = tile;
    rec.born = now; rec.life = ground.life; rec.alpha = ground.alpha;
    // Textures are drawn toe up (angle -90°); flipX turns the right boot into the left.
    rec.img.setTexture(kind === 'raider' ? 'print_raider' : 'print_player')
      .setPosition(x, y).setRotation(angle + Math.PI / 2).setFlipX(foot === 0)
      .setAlpha(ground.alpha).setVisible(true);
    rec.idx = this.live.length;
    this.live.push(rec);
    this.byTile.set((tile << 1) | TRACK_KINDS.indexOf(kind), rec);
    this.stats.placed++;
  }

  // A free record: from the pool, a new sprite while under the cap, else the oldest print.
  _take() {
    if (this.free.length) return this.free.pop();
    if (this.made < CFG.TRACKS.CAP) {
      this.made++;
      const img = this.scene.add.image(0, 0, 'print_player').setScale(1.5).setDepth(1);
      if (this.scene.hudCam) this.scene.hudCam.ignore(img); else this.scene._w(img);
      return { img };
    }
    let oldest = this.live[0];
    for (const rec of this.live) if (rec.born < oldest.born) oldest = rec;
    this.stats.recycled++;
    this._release(oldest);
    return this.free.pop();
  }

  _release(rec) {
    const live = this.live, last = live[live.length - 1];
    live[rec.idx] = last; last.idx = rec.idx; live.pop();
    const key = (rec.tile << 1) | TRACK_KINDS.indexOf(rec.kind);
    if (this.byTile.get(key) === rec) this.byTile.delete(key);
    rec.img.setVisible(false);
    this.free.push(rec);
  }
}
