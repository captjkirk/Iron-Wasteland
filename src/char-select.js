'use strict';
// ── src/char-select.js — CharSelectScene: the character carousel ─────────────
// The selected character stands large in the centre with its stats and ability; the others sit
// smaller and dimmed on an arc behind it. Left/right (keys, a swipe or mouse drag, the trackpad
// or mouse wheel, or a tap on a side character) turns the wheel; F, Enter or a tap on the centre confirms. In 2-player games P2
// turns the same wheel after P1 confirms, and P1's pick is skipped.
// Sized from S = min(W/1280, H/720): 1280x720 gives S=1, the 640x360 phone layout S=0.5.

class CharSelectScene extends Phaser.Scene {
  constructor() { super('CharSelect'); }

  create() {
    const { W, H } = CFG;
    this.cameras.main.fadeIn(300, 0, 0, 0);
    // "Play Again" bypasses ModeSelect (the only other Music.start() site), so music
    // stays silent on replay unless we restart it here. Music.start() is idempotent.
    if (!Music.playing) {
      Music.start();
      const _as = loadSettings();
      if (Music.gain) {
        const _mv = _as.musicVolume !== undefined ? _as.musicVolume : (_as.musicEnabled !== false ? 50 : 0);
        Music.gain.gain.value = (_mv / 100) * 0.14;
      }
      const _sv = _as.sfxVolume !== undefined ? _as.sfxVolume : (_as.sfxEnabled !== false ? 100 : 0);
      SFX._sfxVol = _sv / 100;
      SFX._enabled = _sv > 0;
      if (SFX.gain) SFX.gain.gain.value = SFX._sfxVol;
    }
    this.p1Idx = 0; this.p2Idx = 1;
    this.p1Done = false; this.p2Done = false;
    this.solo = STATE.mode === 1;

    this.add.graphics().fillStyle(0x0a0a14).fillRect(0, 0, W, H);

    const S = this._S = Math.min(W / 1280, H / 720);
    const modeLabel = STATE.difficulty === 'hardcore' ? '  ☠ HARDCORE' : '  ♥ SURVIVAL';
    this.add.text(W/2, 34, 'SELECT YOUR SURVIVOR' + (this.solo ? '' : 'S') + modeLabel, {
      fontFamily:'monospace', fontSize: Math.max(14, Math.round(24*S)) + 'px',
      color: STATE.difficulty === 'hardcore' ? '#ff6644' : '#cc8833',
      stroke:'#000', strokeThickness:3,
    }).setOrigin(0.5);

    const hint = this.solo ? 'Swipe or ◀ ▶ to turn  —  tap the centre or F to choose'
                           : 'P1: A/D + F   |   P2: Arrows + /   |   or swipe and tap';
    this.add.text(W/2, 66, hint, {
      fontFamily:'monospace', fontSize: Math.max(11, Math.round(13*S)) + 'px', color:'#666677',
    }).setOrigin(0.5);

    this._buildWheel(S);

    this.statusText = this.add.text(W/2, H-36, '', {
      fontFamily:'monospace', fontSize: Math.max(11, Math.round(14*S)) + 'px', color:'#aaaaaa',
    }).setOrigin(0.5);

    // Tutorial toggle checkbox — bottom-center, unobtrusive
    this._charSelTutOn = loadSettings().tutorial !== false;
    this._tutCheckTxt = this.add.text(W/2, H - 64, '', {
      fontFamily:'monospace', fontSize: Math.max(11, Math.round(11*S)) + 'px', color:'#557755',
      stroke:'#000', strokeThickness:1,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this._tutCheckTxt.on('pointerover', () => this._tutCheckTxt.setStyle({ color:'#88cc88' }));
    this._tutCheckTxt.on('pointerout',  () => this._tutCheckTxt.setStyle({ color:'#557755' }));
    this._tutCheckTxt.on('pointerdown', () => {
      this._charSelTutOn = !this._charSelTutOn;
      saveSettings({ tutorial: this._charSelTutOn });
      this._updateTutCheck();
    });
    this._updateTutCheck();

    // Keys: each player's bindings; in a solo game the arrows turn the wheel too. Enter confirms
    // for whoever's turn it is.
    const K = Phaser.Input.Keyboard.KeyCodes;
    const _CB = Object.assign({}, DEFAULT_BINDINGS, loadSettings().bindings || {});
    this.keys = this.input.keyboard.addKeys({
      p1L:K[_CB.p1left], p1R:K[_CB.p1right], p1OK:K[_CB.p1attack],
      p2L:K[_CB.p2left], p2R:K[_CB.p2right], p2OK:K[_CB.p2attack], enter:K.ENTER,
    });
    const arrows = this.solo ? 1 : 2;
    this.keys.p1L.on('down', () => this.nav(1,-1));
    this.keys.p1R.on('down', () => this.nav(1, 1));
    this.keys.p1OK.on('down',() => this.confirm(1));
    this.keys.p2L.on('down', () => this.nav(arrows,-1));
    this.keys.p2R.on('down', () => this.nav(arrows, 1));
    this.keys.p2OK.on('down',() => this.confirm(2));
    this.keys.enter.on('down', () => this.confirm(this._turn()));

    // Touch and mouse on the wheel: a swipe turns it, a tap on a side character turns to it,
    // a tap on the centre confirms. Only inside the wheel's band, so the back button and the
    // tutorial checkbox keep their own taps.
    const top = Math.round(90 * S), bottom = H - 80;
    // A drag moves the wheel with the pointer (300 px of travel per character); on release it
    // settles on the nearest character.
    const dragMin = Math.max(20, 40 * S), stepPx = 300 * S;
    this.input.on('pointerdown', p => {
      this._press = (p.y > top && p.y < bottom) ? { x: p.x, pos: this._pos, drag: false } : null;
    });
    this.input.on('pointermove', p => {
      const pr = this._press;
      if (!pr || !p.isDown) return;
      if (!pr.drag && Math.abs(p.x - pr.x) < dragMin) return;
      if (!pr.drag) { pr.drag = true; if (this._spin) this._spin.stop(); }
      this._pos = pr.pos - (p.x - pr.x) / stepPx;
      this._layoutWheel();
    });
    this.input.on('pointerup', p => {
      if (!this._press) return;
      const { drag, pos } = this._press, dx = p.x - W/2;
      this._press = null;
      if (drag) this._settle(pos);
      else if (Math.abs(dx) < 170 * S) this.confirm(this._turn());
      else this.nav(this._turn(), Math.sign(dx) * (Math.abs(dx) > 430 * S ? 2 : 1));
    });

    // Trackpad two-finger slide or mouse wheel: the wheel scrolls smoothly with it (a third of the drag
    // distance per character), and 120 ms after the last scroll event it settles on the nearest one.
    this.input.on('wheel', (p, objs, dx, dy) => {
      if (p.y <= top || p.y >= bottom) return;
      if (!this._wheelBase && this._wheelBase !== 0) { this._wheelBase = this._pos; if (this._spin) this._spin.stop(); }
      this._pos += (Math.abs(dx) > Math.abs(dy) ? dx : dy) / (0.5 * stepPx);
      this._layoutWheel();
      if (this._wheelEnd) this._wheelEnd.remove();
      this._wheelEnd = this.time.delayedCall(120, () => {
        const base = this._wheelBase; this._wheelBase = null;
        this._settle(base);
      });
    });

    // Back to main menu — top-left corner
    const backBtnBg = this.add.graphics();
    const backBtnPad = { x: 14, y: 10 };
    const backBtn = this.add.text(backBtnPad.x + 10, backBtnPad.y + 8, '← MAIN MENU', {
      fontFamily:'monospace', fontSize: Math.max(13, Math.round(17*S)) + 'px', color:'#cc8833',
      stroke:'#000', strokeThickness:2,
    }).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    const drawBackBg = (hover) => {
      backBtnBg.clear();
      backBtnBg.fillStyle(hover ? 0x1a1208 : 0x100c06, 0.9);
      backBtnBg.fillRoundedRect(backBtnPad.x, backBtnPad.y, backBtn.width + 20, backBtn.height + 16, 6);
      backBtnBg.lineStyle(2, hover ? 0xcc8833 : 0x4a3010);
      backBtnBg.strokeRoundedRect(backBtnPad.x, backBtnPad.y, backBtn.width + 20, backBtn.height + 16, 6);
    };
    drawBackBg(false);
    backBtn.on('pointerover', () => { backBtn.setColor('#ffcc44'); drawBackBg(true); });
    backBtn.on('pointerout',  () => { backBtn.setColor('#cc8833'); drawBackBg(false); });
    backBtn.on('pointerdown', () => goBack());
    const goBack = () => {
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => this.scene.start('ModeSelect'));
    };
    this.input.keyboard.addKey(K.ESC).on('down', goBack);

    this.refresh();
  }

  _updateTutCheck() {
    const on = this._charSelTutOn;
    this._tutCheckTxt.setText((on ? '[✔] ' : '[  ] ') + 'Show tutorial tips on first game');
  }

  // Whose turn it is: P1 until P1 confirms, then P2.
  _turn() { return this.p1Done && !this.solo ? 2 : 1; }

  // One portrait per character on the wheel, and the centre panel's texts (filled by refresh).
  // Centre text is 14 px at 1280x720 and never under 11 px on the phone layout.
  _buildWheel(S) {
    const { W } = CFG;
    const sc = n => Math.round(n * S);
    const fs = n => Math.max(11, Math.round(n * S)) + 'px';
    const rowH = n => Math.max(13, sc(n));
    this._feetY = sc(320);
    // Centre portrait scale: 3.2 at 1280x720; smaller on the phone layout, where the hint line
    // (fixed at y 66) would otherwise sit on the portrait's head. Frames are 66 px tall.
    this._big = Math.min(3.2 * S, (this._feetY - 80) / 66);
    this._portraits = CHARS.map(ch =>
      this.add.image(W/2, this._feetY, 'player_atlas', ch.id).setOrigin(0.5, 1));
    this._pos = this.p1Idx;
    this._layoutWheel();

    let y = this._feetY + sc(10);
    this._nameT = this.add.text(W/2, y, '', {
      fontFamily:'monospace', fontSize: Math.max(14, sc(26)) + 'px', stroke:'#000', strokeThickness:3,
    }).setOrigin(0.5, 0);
    y += Math.max(15, sc(32));
    this._titleT = this.add.text(W/2, y, '', { fontFamily:'monospace', fontSize: fs(14), color:'#8888a0' }).setOrigin(0.5, 0);
    y += rowH(28);
    const statX = W/2 - Math.max(70, sc(100));
    this._stats = ['HP','SPD','ATK','BLD'].map((label, si) => {
      const sy = y + si * rowH(22);
      this.add.text(statX, sy, label, { fontFamily:'monospace', fontSize: fs(14), color:'#8888a0' });
      return [0, 1, 2, 3, 4].map(b => this.add.rectangle(statX + Math.max(34, sc(56)) + b * Math.max(14, sc(24)), sy + 2,
        Math.max(11, sc(20)), Math.max(9, sc(14)), 0x222233).setOrigin(0, 0));
    });
    y += 4 * rowH(22) + rowH(8);
    this._descT = this.add.text(W/2, y, '', {
      fontFamily:'monospace', fontSize: fs(14), color:'#a0a0b4', align:'center', lineSpacing: Math.max(3, sc(8)),
    }).setOrigin(0.5, 0);
  }

  // Place every portrait by its offset r from the wheel position: x and y on an arc, smaller and
  // dimmer the further back, fading out past two steps so the wrap-around is never seen.
  _layoutWheel() {
    const { W } = CFG, S = this._S, n = CHARS.length;
    this._portraits.forEach((img, i) => {
      const r = Phaser.Math.Wrap(i - this._pos, -n / 2, n / 2), a = Math.abs(r);
      img.setPosition(W/2 + Math.sin(r * 0.62) * 560 * S, this._feetY + (1 - Math.cos(r * 0.62)) * 150 * S)
        .setScale(this._big / (1 + 0.8 * a))
        .setAlpha(Math.max(0, Math.min(1, (2.5 - a) * 2)) * (1 - 0.5 * Math.min(1, a)))
        .setDepth(10 - a);
    });
  }

  // Turn the wheel to the active player's character over ~250 ms, the short way round.
  _spinTo(idx) {
    const n = CHARS.length, from = this._pos;
    const to = from + Phaser.Math.Wrap(idx - from, -n / 2, n / 2);
    if (this._spin) this._spin.stop();
    this._spin = this.tweens.addCounter({
      from, to, duration: 250, ease: 'Sine.easeInOut',
      onUpdate: t => { this._pos = t.getValue(); this._layoutWheel(); },
    });
  }

  // After a drag or scroll that started at wheel position `from`: land on the nearest character
  // (a short flick still moves one).
  _settle(from) {
    const moved = this._pos - from, steps = Math.round(moved) || Math.sign(moved);
    if (!steps) return this.refresh();
    for (let i = 0; i < Math.abs(steps); i++) this.nav(this._turn(), Math.sign(steps));
  }

  nav(player, dir) {
    if (player===1 && !this.p1Done) {
      this.p1Idx = Phaser.Math.Wrap(this.p1Idx+dir, 0, CHARS.length);
      this.refresh();
    }
    if (player===2 && this.p1Done && !this.p2Done && !this.solo) {
      let n = Phaser.Math.Wrap(this.p2Idx+dir, 0, CHARS.length);
      if (n===this.p1Idx) n = Phaser.Math.Wrap(n+Math.sign(dir), 0, CHARS.length);
      this.p2Idx = n; this.refresh();
    }
  }

  confirm(player) {
    if (player===1 && !this.p1Done) {
      this.p1Done = true; STATE.p1CharId = CHARS[this.p1Idx].id;
      if (this.solo) { this.statusText.setText('Get ready…'); this.go(); return; }
      if (this.p2Idx===this.p1Idx) this.p2Idx = Phaser.Math.Wrap(this.p1Idx+1, 0, CHARS.length);
      this.statusText.setText('Now Player 2 — Arrows to pick, / to confirm');
    }
    if (player===2 && this.p1Done && !this.p2Done && !this.solo) {
      this.p2Done = true; STATE.p2CharId = CHARS[this.p2Idx].id;
      this.statusText.setText('Get ready…'); this.go();
    }
    this.refresh();
  }

  go() {
    const p2id = this.solo ? 'none' : STATE.p2CharId;
    _qlog(`CharSelect: starting game  P1=${STATE.p1CharId}  P2=${p2id}  solo=${this.solo}`, 'menu');
    this.time.delayedCall(500, () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.time.delayedCall(400, () => this.scene.start('Game'));
    });
  }

  // Show the active player's character in the centre panel and turn the wheel to it.
  refresh() {
    const idx = this._turn() === 2 ? this.p2Idx : this.p1Idx, ch = CHARS[idx];
    const hex = '#' + ch.color.toString(16).padStart(6, '0');
    this._nameT.setText(ch.player).setColor(hex);
    this._titleT.setText(ch.title);
    this._stats.forEach((bars, si) => bars.forEach((bar, b) => bar.setFillStyle(b < ch.stats[si] ? ch.color : 0x222233)));
    this._descT.setText(ch.desc.join('\n'));
    this._spinTo(idx);
    if (!this.p1Done) this.statusText.setText(this.solo ? '' : 'Player 1 — A/D to choose, F to confirm');
  }
}
