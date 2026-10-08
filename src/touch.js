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
      // Layout: ATK bottom-right, ALT above ATK, USE left of ATK, BLD left of ALT, MENU top-right.
      // The stick takes the left 45% of the screen, bottom 55%.
      this._pads = [{
        who: 'p1', x0: 0, x1: W, y0: 0, y1: H, joy: stick(), hintX: W * 0.12, hintY: H * 0.82,
        stickZone: (px, py) => px < W * 0.45 && py > H * 0.35,
        btns: {
          attack:   btn(W - 100, H - 100, 52, 0xff6644, '⚔ ATK'),
          alt:      btn(W - 185, H - 195, 44, 0x6699ff, '★ ALT'),
          interact: btn(W - 195, H - 95,  40, 0x44cc66, 'E USE'),
          build:    btn(W - 282, H - 195, 40, 0xccaa33, '■ BLD'),
          menu:     btn(W - 32,  32,      28, 0x888888, '☰'),
        },
      }];
    } else if (this._split) {
      const halfW = (W - CFG.SPLIT_STRIP) / 2;
      this._pads = [0, 1].map(i => {
        // P1 (left end, view turned +90): near edge is screen-left; their left is screen-top.
        // P2 (right end, view turned -90): near edge is screen-right; their left is screen-bottom.
        const x0 = i ? W - halfW : 0, x1 = x0 + halfW;
        return {
          who: i ? 'p2' : 'p1', x0, x1, y0: 0, y1: H, joy: stick(), rot: i ? -Math.PI / 2 : Math.PI / 2,
          hintX: i ? x1 - 80 : x0 + 80, hintY: i ? H * 0.78 : H * 0.22,
          stickZone: i ? (px, py) => px > x1 - halfW * 0.65 && py > H * 0.55
                       : (px, py) => px < x0 + halfW * 0.65 && py < H * 0.45,
          btns: { attack: btn(i ? x1 - 80 : x0 + 80, i ? 100 : H - 100, 56, i ? 0xff8844 : 0x4488ff, '⚔ ATK') },
        };
      });
    } else {
      // Each half: the stick in its left 60%, bottom 55%; ATK at its bottom-right corner.
      this._pads = [0, 1].map(i => {
        const x0 = i * W / 2, x1 = x0 + W / 2;
        return {
          who: i ? 'p2' : 'p1', x0, x1, y0: 0, y1: H, joy: stick(), hintX: x0 + W * 0.12, hintY: H * 0.82,
          stickZone: (px, py) => px < x0 + W * 0.3 && py > H * 0.35,
          btns: { attack: btn(x1 - 100, H - 100, 56, i ? 0xff8844 : 0x4488ff, '⚔ ATK') },
        };
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
        if (p && p.spr && p.spr.body) p.spr.setVelocity(0, 0);
      }
      for (const btn of Object.values(pad.btns)) {
        if (btn.pid === pointer.id) { btn.down = false; btn.pid = -1; }
      }
    }
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

    for (const { joy, btns, hintX, hintY } of this._pads) {
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
        gfx.strokeCircle(hintX, hintY, 55);
        gfx.fillStyle(0xffffff, 0.03);
        gfx.fillCircle(hintX, hintY, 55);
      }

      // Action buttons
      for (const btn of Object.values(btns)) {
        const alpha = btn.down ? 0.75 : 0.4;
        gfx.fillStyle(btn.col, alpha * 0.38);
        gfx.fillCircle(btn.hx, btn.hy, btn.r);
        gfx.lineStyle(2, btn.col, alpha);
        gfx.strokeCircle(btn.hx, btn.hy, btn.r);
      }
    }
  },
});
