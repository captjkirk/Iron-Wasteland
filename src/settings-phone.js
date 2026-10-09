'use strict';
// ── src/settings-phone.js — the Settings screen in the phone layout ───────────
// SettingsScene.create() hands over to _createPhone() when PHONE_LAYOUT is on (canvas 360 high).
// The desktop layout scales one column to fit; 360 px cannot hold that column with 32 px tap
// targets, so here the audio sliders and the gameplay toggles sit side by side. The actions both
// layouts share (_setMusicVolume, _goBack, ...) live in src/scenes.js.
// Globals exported: none (adds SettingsScene.prototype._createPhone)
// grep: "_createPhone"

SettingsScene.prototype._createPhone = function () {
  const { W, H } = CFG;
  const fromGame = this._returnTo === 'Game';
  if (!fromGame) this.cameras.main.fadeIn(300, 0, 0, 0);
  const TAP = 32;                                   // smallest tap target; scripts/phone-menus.js checks it
  const mono = (size, color, extra) => Object.assign({ fontFamily: 'monospace', fontSize: size + 'px', color }, extra);

  const bg = this.add.graphics();
  if (fromGame) {
    bg.fillStyle(0x000000, 0.72).fillRect(0, 0, W, H);
    this.add.text(16, 20, '⏸ PAUSED', mono(11, '#88aabb', { stroke: '#000', strokeThickness: 2, letterSpacing: 2 })).setOrigin(0, 0.5);
  } else {
    bg.fillGradientStyle(0x0a0a14, 0x0a0a14, 0x080810, 0x080810, 1);
    bg.fillRect(0, 0, W, H);
  }

  this.add.text(W / 2, 20, 'SETTINGS', mono(22, '#cc8833', { stroke: '#7a4a1a', strokeThickness: 3 })).setOrigin(0.5);

  // ── INPUT MODE: three boxes in a row ──
  const touch = isTouchDevice();
  this.add.text(W / 2, 46, 'INPUT MODE  —  ' + (touch ? 'touch' : 'keyboard') + ' detected', mono(10, '#556655', { letterSpacing: 2 })).setOrigin(0.5);
  const inputOpts = [
    { key: 'auto',     label: 'AUTO',     sub: touch ? 'auto-detect (touch)' : 'auto-detect (kb)' },
    { key: 'touch',    label: 'TOUCH',    sub: 'virtual joystick + btns' },
    { key: 'keyboard', label: 'KEYBOARD', sub: 'WASD + mouse / arrows' },
  ];
  const curMode = loadSettings().inputMode || 'auto';
  const ibW = 186, ibH = 38, ibCy = 74, ibSpacing = Math.min(196, Math.floor((W - 60) / 3));
  this._inputBoxes = inputOpts.map((o, i) => {
    const x = W / 2 + (i - 1) * ibSpacing;
    const box = this.add.graphics();
    const lbl = this.add.text(x, ibCy - 8, o.label, mono(14, '#ffffff', { stroke: '#000', strokeThickness: 2 })).setOrigin(0.5);
    this.add.text(x, ibCy + 10, o.sub, mono(10, '#667755')).setOrigin(0.5);
    const zone = this.add.zone(x, ibCy, ibW, ibH).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => this.setInput(o.key));
    zone.on('pointerdown', () => { this.setInput(o.key); saveSettings({ inputMode: o.key }); });
    return { box, lbl, x, y: ibCy, key: o.key, bw: ibW, bh: ibH };
  });

  // ── Two columns: AUDIO (sliders) on the left, GAMEPLAY (toggles) on the right ──
  const st = loadSettings();
  const colL = W / 2 - 296, colR = W / 2 + 20;
  this.add.text(colL + 110, 104, 'AUDIO', mono(10, '#556655', { letterSpacing: 2 })).setOrigin(0.5);
  this.add.text(colR + 111, 104, 'GAMEPLAY', mono(10, '#556655', { letterSpacing: 2 })).setOrigin(0.5);
  const rowY = [126, 160, 194];

  const makeSlider = (label, cy, initial, onChange) => {
    const trackX = colL + 56, trackW = 140, trackH = 8, thumbW = 12, thumbH = 24;
    this.add.text(colL, cy, label, mono(10, '#778877', { letterSpacing: 1 })).setOrigin(0, 0.5);
    const gfx = this.add.graphics();
    const valTxt = this.add.text(trackX + trackW + 14, cy, '', mono(10, '#aaffaa')).setOrigin(0, 0.5);
    let val = Phaser.Math.Clamp(initial, 0, 100);
    const redraw = () => {
      const fillW = Math.floor(trackW * val / 100), thumbX = trackX + fillW - thumbW / 2;
      gfx.clear();
      gfx.fillStyle(0x111122, 0.95).fillRoundedRect(trackX, cy - trackH / 2, trackW, trackH, 4);
      gfx.lineStyle(1, 0x334433, 0.8).strokeRoundedRect(trackX, cy - trackH / 2, trackW, trackH, 4);
      if (fillW > 0) gfx.fillStyle(val > 0 ? 0x44aa44 : 0x333344, 0.9).fillRoundedRect(trackX, cy - trackH / 2, fillW, trackH, 4);
      gfx.fillStyle(val > 0 ? 0x88cc88 : 0x556655, 1).fillRoundedRect(thumbX, cy - thumbH / 2, thumbW, thumbH, 3);
      gfx.lineStyle(1.5, val > 0 ? 0xaaffaa : 0x445544, 0.9).strokeRoundedRect(thumbX, cy - thumbH / 2, thumbW, thumbH, 3);
      valTxt.setText(val + '%').setColor(val > 0 ? '#aaffaa' : '#556655');
    };
    const applyPtr = ptr => { val = Phaser.Math.Clamp(Math.round(((ptr.x - trackX) / trackW) * 100), 0, 100); redraw(); onChange(val); };
    const zone = this.add.zone(trackX + trackW / 2, cy, trackW + thumbW + 8, TAP).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', applyPtr);
    zone.on('pointermove', ptr => { if (ptr.isDown) applyPtr(ptr); });
    redraw();
  };
  makeSlider('MUSIC', rowY[0], st.musicVolume !== undefined ? st.musicVolume : (st.musicEnabled !== false ? 50 : 0), v => this._setMusicVolume(v));
  makeSlider('SFX',   rowY[1], st.sfxVolume   !== undefined ? st.sfxVolume   : (st.sfxEnabled   !== false ? 100 : 0), v => this._setSfxVolume(v));

  // A label with ON and OFF boxes beside it. Returns the redraw so a caller can drive the selection.
  const makeToggle = (label, cy, initial, onToggle) => {
    this.add.text(colR, cy, label, mono(10, '#778877', { letterSpacing: 1 })).setOrigin(0, 0.5);
    const tbW = 60, tbH = TAP;
    const boxes = [{ key: true, label: 'ON', x: colR + 126 }, { key: false, label: 'OFF', x: colR + 192 }].map(o => {
      const g = this.add.graphics();
      const lbl = this.add.text(o.x, cy, o.label, mono(13, '#fff', { stroke: '#000', strokeThickness: 2 })).setOrigin(0.5);
      const zone = this.add.zone(o.x, cy, tbW, tbH).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => { onToggle(o.key); redraw(o.key); });
      return { g, lbl, x: o.x, key: o.key, bw: tbW, bh: tbH, cy };
    });
    const redraw = sel => boxes.forEach(b => {
      this.drawSettingsBox(b.g, b.x, b.cy, b.key === sel, b.bw, b.bh);
      b.lbl.setColor(b.key === sel ? '#aaffaa' : '#888899');
    });
    redraw(initial);
    return boxes.map(b => ({ box: b.g, lbl: b.lbl, x: b.x, y: cy, key: b.key, bw: tbW, bh: tbH }));
  };
  makeToggle('FOG OF WAR', rowY[0], st.fogEnabled !== false,     v => saveSettings({ fogEnabled: v }));
  makeToggle('MINIMAP',    rowY[1], st.minimapEnabled !== false, v => saveSettings({ minimapEnabled: v }));
  const tutEnabled = st.tutorial !== false;
  this._tutSel = tutEnabled;
  // The tutorial toggle is also driven by RESET TUTORIAL, through setTutorial().
  this._tutBoxes = makeToggle('TUTORIAL TIPS', rowY[2], tutEnabled, v => { saveSettings({ tutorial: v }); this.setTutorial(v); });

  // ── Keys reference when paused and a keyboard is in use (touch needs no key list) ──
  if (fromGame && this._p1CharId && activeInputMode() === 'keyboard') this._phoneControlsList(220);

  // ── Buttons: utility row, then back ──
  const btn = (x, y, label, color, size, handler) => {
    const t = this.add.text(x, y, label, mono(size, color, { padding: { x: 10, y: 10 } })).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setColor('#ffffff'));
    t.on('pointerout',  () => t.setColor(color));
    t.on('pointerdown', handler);
    return t;
  };
  const utils = [];
  utils.push(btn(0, H - 60, '[ RESET TUTORIAL ]', '#667766', 11, () => this._resetTutorial(utils[0], '#667766')));
  utils.push(btn(0, H - 60, '[ REBIND CONTROLS ]', '#8888cc', 11, () => this._openRebind()));
  if (fromGame) utils.push(btn(0, H - 60, '[ QUIT TO MENU ]', '#cc6655', 11, () => this._quitToMenu()));
  const uSpacing = Math.min(200, Math.floor((W - 60) / utils.length));
  utils.forEach((b, i) => b.setX(W / 2 + (i - (utils.length - 1) / 2) * uSpacing));

  const back = btn(W / 2, H - 24, fromGame ? '[ BACK TO GAME ]' : '[ BACK TO MAIN MENU ]', '#aaffaa', 14, () => this._goBack());
  this.tweens.add({ targets: back, alpha: 0.5, duration: 700, yoyo: true, repeat: -1 });

  const K = Phaser.Input.Keyboard.KeyCodes;
  this.input.keyboard.addCapture(K.TAB);
  this.input.keyboard.addKey(K.ESC).on('down', () => this._goBack());
  this.input.keyboard.addKey(K.TAB).on('down', () => this._goBack());

  this.setInput(curMode);
  this.setTutorial(tutEnabled);
};

// The pause screen's key list on a phone with a keyboard, starting at y: each player's lines in two
// columns (a column holds 4 lines, so the block stays above the buttons). The passive-ability lines
// are left out; the character screen shows them.
SettingsScene.prototype._phoneControlsList = function (y) {
  const { W } = CFG, lnH = 13;
  const players = [getControls(1, this._p1CharId, this._isSolo)];
  if (!this._isSolo && this._p2CharId) players.push(getControls(2, this._p2CharId));
  const cols = [];
  players.forEach((all, p) => {
    const ls = all.filter(l => !l.startsWith('Passive:')), half = Math.ceil(ls.length / 2);
    cols.push({ ls: ls.slice(0, half), p }, { ls: ls.slice(half), p });
  });
  this.add.text(W / 2, y, 'YOUR CONTROLS', { fontFamily: 'monospace', fontSize: '10px', color: '#445566', letterSpacing: 2 }).setOrigin(0.5);
  const colW = Math.min(170, (W - 24) / cols.length);
  cols.forEach((c, i) => c.ls.forEach((l, r) => this.add.text(W / 2 + (i - (cols.length - 1) / 2) * colW, y + 10 + r * lnH, l, {
    fontFamily: 'monospace', fontSize: '10px', color: c.p ? '#eeddcc' : '#aabbcc', stroke: '#000', strokeThickness: 1,
  }).setOrigin(0.5, 0)));
};
