'use strict';
// ── src/coach.js — the first-day checklist (#296, map #295) ──
// Loads after src/game-scene.js and adds these methods to GameScene (ADR 0002).
// A small panel lists five goals and ticks each the first time either player does it. It starts with
// the tutorial (startTutorial; `tutorial: false` hides it) and, once all five are ticked in one game,
// never shows on this device again (localStorage 'iw_coach_done'; RESET TUTORIAL clears it).
// Move and wood are read each frame in _coachUpdate; the crate, campfire and kill sites call _coachTick.

// The goals, in the order they are listed.
const COACH_GOALS = [
  { key: 'move',     label: 'Move' },
  { key: 'wood',     label: 'Gather wood' },
  { key: 'crate',    label: 'Open a crate' },
  { key: 'campfire', label: 'Build a campfire' },
  { key: 'kill',     label: 'Defeat an enemy' },
];
const COACH_MOVE_PX = 64; // a player this far from where the checklist started has moved

Object.assign(GameScene.prototype, {
  _coachStart() {
    this._coach = null;
    try { if (localStorage.getItem('iw_coach_done')) return; } catch (e) {}
    const players = [this.p1, this.p2].filter(p => p && p.spr);
    this._coach = {
      done: new Set(), rows: [], ended: false,
      from: players.map(p => ({ p, x: p.spr.x, y: p.spr.y })),
    };
    this._coachDraw();
    this._log('First-day checklist shown', 'player');
  },

  // Called every frame: ticks move and wood, which have no single event to hook.
  _coachUpdate() {
    const c = this._coach;
    if (!c || c.ended) return;
    if (!c.done.has('move')) {
      for (const f of c.from) {
        const dx = f.p.spr.x - f.x, dy = f.p.spr.y - f.y;
        if (dx * dx + dy * dy > COACH_MOVE_PX * COACH_MOVE_PX) { this._coachTick('move'); break; }
      }
    }
    if (!c.done.has('wood') && c.from.some(f => (f.p.inv.wood || 0) > 0)) this._coachTick('wood');
  },

  _coachTick(key) {
    const c = this._coach;
    if (!c || c.ended || c.done.has(key)) return;
    c.done.add(key);
    this._log(`First-day goal done: ${key}  (${c.done.size}/${COACH_GOALS.length})`, 'player');
    this._coachDraw();
    if (c.done.size < COACH_GOALS.length) return;
    c.ended = true;
    try { localStorage.setItem('iw_coach_done', '1'); } catch (e) {}
    // Leave the full list up for a moment, then fade it out.
    this.time.delayedCall(1500, () => {
      if (this._coach !== c) return;
      this.tweens.add({ targets: c.hosts, alpha: 0, duration: 600, onComplete: () => {
        c.hosts.forEach(o => o.destroy());
        if (this._coach === c) this._coach = null;
      } });
    });
  },

  // Builds the panel on first call; afterwards updates the ticks. Face-to-face (_split) draws one copy
  // in each player's half, turned toward them like their resource bar (buildHUD's resPanel).
  _coachDraw() {
    const c = this._coach;
    if (c.hosts) {
      c.rows.forEach(r => r.setText(this._coachLine(r._goal)).setColor(c.done.has(r._goal.key) ? '#77aa66' : '#ddeecc'));
      return;
    }
    const { W, H } = CFG;
    const small = PHONE_LAYOUT;
    const fs = small ? 12 : 15, lh = fs + (small ? 3 : 5), pad = small ? 7 : 10;
    const build = (x, y, rot) => {
      const host = this._h(this.add.container(x, y).setRotation(rot).setDepth(105));
      const title = this.add.text(pad, pad, 'FIRST DAY', {
        fontFamily: 'monospace', fontSize: fs + 'px', color: '#aadd88', stroke: '#000', strokeThickness: 2,
      });
      const rows = COACH_GOALS.map((g, i) => {
        const t = this.add.text(pad, pad + lh * (i + 1) + 2, '', {
          fontFamily: 'monospace', fontSize: fs + 'px', color: '#ddeecc', stroke: '#000', strokeThickness: 2,
        });
        t._goal = g;
        return t;
      });
      rows.forEach(r => r.setText(this._coachLine(r._goal)));
      const w = Math.ceil(Math.max(title.width, ...rows.map(r => r.width))) + pad * 2;
      const h = pad * 2 + lh * (COACH_GOALS.length + 1) + 2;
      const bg = this.add.graphics();
      bg.fillStyle(0x050d05, 0.8); bg.fillRoundedRect(0, 0, w, h, 6);
      bg.lineStyle(2, 0x4a7a38, 0.8); bg.strokeRoundedRect(0, 0, w, h, 6);
      host.add([bg, title, ...rows]);
      c.rows.push(...rows);
      return { host, w, h };
    };
    if (this._split) {
      // In each player's own view (touch.js: lx across, ly toward their near edge), along the top edge (the
      // centre strip) but clear of the day panel and the tip banner, which sit unturned at the top of the screen.
      const halfW = (W - CFG.SPLIT_STRIP) / 2, lx = 215, ly = 10;
      c.hosts = [build(halfW - ly, lx, Math.PI / 2).host, build(W - halfW + ly, H - lx, -Math.PI / 2).host];
      c.rect = null;
    } else {
      // Left edge, under the name badge and down text; on a touch layout (PHONE1P) under the menu button
      // and above the stick's resting ring.
      const P = this._layout1p();
      const x = 10, y = P ? P.menuBtn.cy * H + (small ? 28 : 44) : small ? 92 : 110;
      const b = build(x, y, 0);
      c.hosts = [b.host];
      c.rect = { x, y, w: b.w, h: b.h }; // read by the smoke run (first-day checklist)
    }
  },

  _coachLine(g) { return (this._coach.done.has(g.key) ? '[✔] ' : '[  ] ') + g.label; },
});
