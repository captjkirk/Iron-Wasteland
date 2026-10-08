'use strict';
// ── src/touch.js — GameScene system 19: touch controls ───────────────────────
// Loads after src/game-scene.js and adds these methods to GameScene (ADR 0002).
// One touch pad per player: a stick that appears where the finger lands, plus buttons. A finger
// belongs to the pad whose area it landed in. 1 player: one pad over the whole screen (stick on
// the left, five buttons on the right). 2 players on a touch device: each half of the screen is
// one player's pad, P1 left and P2 right, each with a stick and a big attack button.
// Face-to-face (this._split, #387): the iPad lies flat with a player at each short end. P1's pad is the
// left half, P2's the right half, each turned a quarter turn (pad.rot) toward its player: the stick
// zone and attack button sit at the player's near edge, and the stick vector is turned back into world axes.
// this._joy and this._tcBtns stay P1's stick and buttons (the craft menu and harvesting read them).

Object.assign(GameScene.prototype, {
  initTouchControls() {
    const { W, H } = CFG;
    this._touchActive = true;

    // Support up to 4 simultaneous touches
    this.input.addPointer(4);

    // A stick: dynamic base, appears where the finger lands.
    const stick = () => ({ active: false, pointerId: -1, baseX: 0, baseY: 0, knobX: 0, knobY: 0, radius: 72, vec: { x: 0, y: 0 } });
    const btn = (hx, hy, r, col, label) => ({ hx, hy, r, down: false, pid: -1, col, label });
    if (this.solo) {
      // Layout: ATK, ALT, USE, BLD in a diamond (ATK bottom, ALT right, USE left, BLD top);
      // the stick takes the left 45% of the screen, bottom 65%. On a phone (#388) the sizes and
      // positions are shares of the screen height, from PHONE1P.
      const P = this._layout1p();
      let hx = W * 0.12, hy = H * 0.82, hr = 55;
      let attack = btn(W - 100, H - 100, 52, 0xff6644, '⚔ ATK');
      let alt = btn(W - 185, H - 195, 44, 0x6699ff, '★ ALT');
      let interact = btn(W - 195, H - 95, 40, 0x44cc66, 'E USE');
      let build = btn(W - 282, H - 195, 40, 0xccaa33, '■ BLD');
      let menu = btn(W - 32, 32, 28, 0x888888, '☰');
      if (P) {
        const r = P.btn.d * H / 2, g = P.btn.gap * r, cx = P.btn.cx * W, cy = P.btn.cy * H;
        attack = btn(cx, cy + g, r, 0xff6644, '⚔ ATK');
        alt = btn(cx + g, cy, r, 0x6699ff, '★ ALT');
        interact = btn(cx - g, cy, r, 0x44cc66, 'E USE');
        build = btn(cx, cy - g, r, 0xccaa33, '■ BLD');
        menu = btn(P.menuBtn.cx * W, P.menuBtn.cy * H, 20, 0x888888, '☰');
        hx = P.stick.cx * W; hy = P.stick.cy * H; hr = P.stick.d * H / 2;
      }
      this._pads = [{
        who: 'p1', x0: 0, x1: W, y0: 0, y1: H, joy: stick(), hintX: hx, hintY: hy, hintR: hr,
        stickZone: (px, py) => px < W * 0.45 && py > H * 0.35,
        btns: { attack, alt, interact, build, menu },
      }];
      if (P) this._pads[0].joy.radius = P.stick.d * H / 2; // scales with the screen height (#406)
    } else {
      // 2 players (#403): each pad mirrors the 1-player layout (PHONE1P) in its own view; sizes are shares
      // of that view's height. Phone: the view is a half of the screen. Face-to-face (#387): the view is a
      // half turned a quarter turn, so it is H wide and halfW tall. lx, ly are points in the player's own
      // view (ly grows toward the near edge); toScreen and toLocal convert.
      const P = PHONE1P, split = this._split;
      const halfW = split ? (W - CFG.SPLIT_STRIP) / 2 : W / 2, Lw = split ? H : halfW, Lh = split ? halfW : H;
      const sr = P.stick.d * Lh / 2, br = P.btn.d * Lh / 2, pad2 = 0.02 * Lh;
      this._pads = [0, 1].map(i => {
        const x0 = i ? W - halfW : 0, x1 = x0 + halfW;
        // P1 (left end, view turned +90): near edge is screen-left; their left is screen-top.
        // P2 (right end, view turned -90): near edge is screen-right; their left is screen-bottom.
        const toScreen = !split ? (lx, ly) => [x0 + lx, ly]
          : i ? (lx, ly) => [x1 - (Lh - ly), H - lx] : (lx, ly) => [x0 + (Lh - ly), lx];
        const toLocal = !split ? (px, py) => [px - x0, py]
          : i ? (px, py) => [H - py, Lh - (x1 - px)] : (px, py) => [py, Lh - (px - x0)];
        const [hintX, hintY] = toScreen(Math.max(P.stick.cx * Lw, sr + pad2), P.stick.cy * Lh);
        const [ax, ay] = toScreen(Lw - Math.max((1 - P.btn.cx) * Lw, br + pad2), P.btn.cy * Lh + P.btn.gap * br);
        const pad = {
          who: i ? 'p2' : 'p1', x0, x1, y0: 0, y1: H, joy: stick(), hintX, hintY, hintR: sr,
          stickZone: (px, py) => { const [lx, ly] = toLocal(px, py); return lx < Lw * 0.6 && ly > Lh * 0.35; },
          btns: { attack: btn(ax, ay, br, i ? 0xff8844 : 0x4488ff, '⚔ ATK') },
        };
        pad.joy.radius = sr;
        if (split) pad.rot = i ? -Math.PI / 2 : Math.PI / 2;
        return pad;
      });
    }
    this._joy = this._pads[0].joy;
    this._tcBtns = this._pads[0].btns;

    // Graphics layer on HUD (single object, redrawn each frame)
    this._tcGfx = this.add.graphics().setDepth(150);
    this._h(this._tcGfx);

    // Text labels for buttons (created once, positioned at button centers)
    for (const pad of this._pads) for (const [name, b] of Object.entries(pad.btns)) {
      this._h(this.add.text(b.hx, b.hy, b.label, {
        fontFamily: 'monospace', fontSize: name === 'attack' ? '11px' : '9px',
        color: '#ffffff', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(151).setAngle((pad.rot || 0) * 180 / Math.PI));
    }

    // Remove before re-adding to prevent listener accumulation on scene restart
    this.input.off('pointerdown',       this._onTouchDown, this);
    this.input.off('pointermove',       this._onTouchMove, this);
    this.input.off('pointerup',         this._onTouchUp,   this);
    this.input.off('pointerupoutside',  this._onTouchUp,   this);
    this.input.on('pointerdown',        this._onTouchDown, this);
    this.input.on('pointermove',        this._onTouchMove, this);
    this.input.on('pointerup',          this._onTouchUp,   this);
    this.input.on('pointerupoutside',   this._onTouchUp,   this);
  },

  _onTouchDown(pointer) {
    if (!this._touchActive) return;
    const { W, H } = CFG;
    const px = pointer.x, py = pointer.y;

    // Skip joystick/button activation when tapping inside the craft menu panel
    if (this.craftMenuOpen) {
      const PW = 440, PH = 330, PX = (W - PW) / 2, PY = H - PH - 20;
      if (px >= PX && px <= PX + PW && py >= PY && py <= PY + PH) return;
    }

    const pad = this._pads.find(p => px >= p.x0 && px < p.x1 && py >= p.y0 && py < p.y1);
    if (!pad) return;
    const joy = pad.joy;
    if (pad.stickZone(px, py) && !joy.active) {
      Object.assign(joy, { active: true, pointerId: pointer.id, baseX: px, baseY: py, knobX: px, knobY: py, vec: { x: 0, y: 0 } });
      this._logTouchStick('down', pad);
      return;
    }

    // Check action buttons
    for (const [name, btn] of Object.entries(pad.btns)) {
      if (btn.down) continue;
      const dx = px - btn.hx, dy = py - btn.hy;
      if (dx*dx + dy*dy <= btn.r * btn.r) {
        btn.down = true;
        btn.pid = pointer.id;
        this._onBtnPress(name, this[pad.who]);
        return;
      }
    }
  },

  _onTouchMove(pointer) {
    if (!this._touchActive) return;
    const pad = this._pads.find(p => p.joy.active && p.joy.pointerId === pointer.id);
    if (!pad) return;
    const joy = pad.joy;
    const dx = pointer.x - joy.baseX;
    const dy = pointer.y - joy.baseY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const r = joy.radius;
    if (dist > r) {
      joy.knobX = joy.baseX + (dx/dist)*r;
      joy.knobY = joy.baseY + (dy/dist)*r;
    } else {
      joy.knobX = pointer.x;
      joy.knobY = pointer.y;
    }
    const clamped = Math.min(dist, r), rot = pad.rot || 0; // a turned view: drag turned back into world axes
    const sx = (dx/Math.max(dist,1)) * (clamped/r), sy = (dy/Math.max(dist,1)) * (clamped/r);
    joy.vec.x = Math.cos(rot) * sx + Math.sin(rot) * sy;
    joy.vec.y = -Math.sin(rot) * sx + Math.cos(rot) * sy;
  },

  _onTouchUp(pointer) {
    if (!this._touchActive) return;
    for (const pad of this._pads) {
      const joy = pad.joy, p = this[pad.who];
      if (joy.active && pointer.id === joy.pointerId) {
        Object.assign(joy, { active: false, pointerId: -1, vec: { x: 0, y: 0 } });
        this._logTouchStick('up', pad);
        if (p && p.spr && p.spr.body) p.spr.setVelocity(0, 0);
      }
      for (const btn of Object.values(pad.btns)) {
        if (btn.pid === pointer.id) { btn.down = false; btn.pid = -1; }
      }
    }
  },

  // 2-player only: both players' positions and stick vectors at each stick down/up, so a session log shows
  // whether each finger drives its own player (#387).
  _logTouchStick(what, pad) {
    if (this.solo) return;
    const f = p => p && p.spr ? `(${Math.round(p.spr.x)},${Math.round(p.spr.y)})` : '-';
    const v = j => `(${j.vec.x.toFixed(2)},${j.vec.y.toFixed(2)})`;
    this._log(`touch stick ${what}  pad=${pad.who}  p1=${f(this.p1)} p2=${f(this.p2)}  joy1=${v(this._pads[0].joy)} joy2=${v(this._pads[1].joy)}`, 'touch');
  },

  _onBtnPress(name, p = this.p1) {
    if (this.isOver || !p) return;
    if (name === 'attack') {
      if (this.barrackOpen || p.isDowned || p.isSleeping) return;
      if (this.craftMenuOpen && this.craftMenuOwner === p) { this.craftSelected(); return; }
      if (this.buildMode && this.buildOwner === p) this.placeBuild();
      else this.doAttack(p);
    } else if (name === 'alt') {
      if (!p.isDowned && !p.isSleeping) this.doAlt(p);
    } else if (name === 'interact') {
      if (!this.barrackOpen) this.tryInteract(p);
    } else if (name === 'build') {
      if (!p.isDowned && !p.isSleeping) this.openCraftMenu(p);
    } else if (name === 'menu') {
      this.toggleControls();
    }
  },

  // Drive one player from their pad's stick: movement and facing. GameScene.update calls it per
  // player that has a pad.
  applyTouchInput(p = this.p1, joy = this._joy) {
    if (!p || p.isDowned || p.isSleeping) return;
    const jv = joy.vec;
    const spd = p.charData.speed * (p._speedMult !== undefined ? p._speedMult : 1);
    const vx = jv.x * spd, vy = jv.y * spd;
    p.spr.setVelocity(vx, vy);

    const moving = Math.abs(vx) > 8 || Math.abs(vy) > 8;
    const isDiag = Math.abs(vx) > 8 && Math.abs(vy) > 8;
    const id = p.charData.id;
    if (moving) {
      // 8-directional facing from joystick vector
      if (isDiag) {
        p.dir = vy > 0 ? 'fside' : 'bside';
      } else if (Math.abs(vy) > Math.abs(vx)) {
        p.dir = vy > 0 ? 'front' : 'back';
      } else {
        p.dir = 'side';
      }
      p.walkTimer = (p.walkTimer + 1) % 40;
      const step = _walkStep(p.walkTimer);
      const dirSuffix = p.dir === 'side' ? '' : ('_' + p.dir);
      p.spr.setTexture('player_atlas', id + dirSuffix + step);
      if (p.dir === 'side' || p.dir === 'fside' || p.dir === 'bside') {
        p.spr.setFlipX(vx < 0);
      } else {
        p.spr.setFlipX(false);
      }
      p.aimAngle = Math.atan2(vy, vx);
    } else {
      p.walkTimer = 0;
      const dirSuffix = p.dir === 'side' ? '' : ('_' + p.dir);
      p.spr.setTexture('player_atlas', id + dirSuffix);
    }
  },

  _drawTouchHUD() {
    const gfx = this._tcGfx;
    if (!gfx || !gfx.active) return;
    // Build a fast state hash — if nothing visibly changed since last frame, skip
    // clear/fill entirely. Knob position is rounded so sub-pixel moves don't spam.
    let hash = '';
    for (const { joy, btns } of this._pads) {
      hash += joy.active ? ('J' + (joy.knobX|0) + ',' + (joy.knobY|0)) : 'J-';
      for (const [name, btn] of Object.entries(btns)) hash += '|' + name + (btn.down ? '1' : '0');
    }
    if (this._tcHudHash === hash) return;
    this._tcHudHash = hash;
    gfx.clear();

    const { H } = CFG;
    for (const { joy, btns, hintX, hintY = H * 0.82, hintR = 55 } of this._pads) {
      if (joy.active) {
        // Base ring
        gfx.lineStyle(2, 0xffffff, 0.35);
        gfx.strokeCircle(joy.baseX, joy.baseY, joy.radius);
        gfx.fillStyle(0xffffff, 0.07);
        gfx.fillCircle(joy.baseX, joy.baseY, joy.radius);
        // Knob
        gfx.fillStyle(0xffffff, 0.55);
        gfx.fillCircle(joy.knobX, joy.knobY, 30);
        gfx.lineStyle(2, 0xffffff, 0.7);
        gfx.strokeCircle(joy.knobX, joy.knobY, 30);
      } else {
        // Hint ring — very faint, shows where joystick zone is
        gfx.lineStyle(1, 0xffffff, 0.1);
        gfx.strokeCircle(hintX, hintY, hintR);
        gfx.fillStyle(0xffffff, 0.03);
        gfx.fillCircle(hintX, hintY, hintR);
      }

      // Action buttons
      for (const btn of Object.values(btns)) {
        const alpha = btn.down ? 0.75 : (this._layout1p() ? 0.35 : 0.4);
        gfx.fillStyle(btn.col, alpha * 0.38);
        gfx.fillCircle(btn.hx, btn.hy, btn.r);
        gfx.lineStyle(2, btn.col, alpha);
        gfx.strokeCircle(btn.hx, btn.hy, btn.r);
      }
    }
  },
});
