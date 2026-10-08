'use strict';
// ── src/scenes.js — All non-gameplay scenes + input/settings helpers ──────────
// Globals exported: DEFAULT_BINDINGS, keyDisplayName, getControls,
//                   ControlsScene, BootScene, ModeSelectScene,
//                   SettingsScene (CharSelectScene is in src/char-select.js)
// Note: buildTextures(scene) is called from BootScene.preload() (defined in textures.js).
// grep: "class BootScene"  "getControls"  "DEFAULT_BINDINGS"

// ── KEY BINDING DEFAULTS ─────────────────────────────────────
const DEFAULT_BINDINGS = {
  p1up:'W', p1down:'S', p1left:'A', p1right:'D',
  p1attack:'F', p1alt:'G', p1build:'Q', p1interact:'E',
  p2up:'UP', p2down:'DOWN', p2left:'LEFT', p2right:'RIGHT',
  p2attack:'FORWARD_SLASH', p2alt:'PERIOD', p2build:'ZERO', p2interact:'ENTER',
};
function keyDisplayName(k) {
  const m = { FORWARD_SLASH:'/', PERIOD:'.', ZERO:'0', UP:'↑', DOWN:'↓', LEFT:'←', RIGHT:'→',
               ENTER:'Enter', SPACE:'Space', BACK_SLASH:'\\', COMMA:',', SEMICOLON:';',
               OPEN_BRACKET:'[', CLOSED_BRACKET:']', QUOTES:"'", BACK_TICK:'`' };
  return m[k] !== undefined ? m[k] : k;
}

// ── SETTINGS HELPERS ─────────────────────────────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('iw_settings') || '{}'); } catch(e) { return {}; }
}
function saveSettings(obj) {
  try {
    const cur = loadSettings();
    localStorage.setItem('iw_settings', JSON.stringify(Object.assign(cur, obj)));
  } catch(e) {
    // Quota exceeded / storage disabled: no player-facing toast for settings
    // (they're low-stakes and the in-memory state is still correct for this session).
    // Surface in the console so a bug report can see it.
    console.warn('iw_settings save failed:', e && e.message ? e.message : e);
  }
}
function isTouchDevice() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}
// Returns 'touch' or 'keyboard' based on saved pref (or device auto-detect)
function activeInputMode() {
  const s = loadSettings();
  if (s.inputMode === 'touch')    return 'touch';
  if (s.inputMode === 'keyboard') return 'keyboard';
  return isTouchDevice() ? 'touch' : 'keyboard';  // auto
}

// ── SCENE: CONTROLS (KEY REBINDING) ──────────────────────────
class ControlsScene extends Phaser.Scene {
  constructor() { super('Controls'); }

  init(data) {
    this._returnTo = (data && data.returnTo) ? data.returnTo : null;
  }

  create() {
    const { W, H } = CFG;
    this.cameras.main.fadeIn(300, 0, 0, 0);

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0a0a14, 0x0a0a14, 0x080810, 0x080810, 1);
    bg.fillRect(0, 0, W, H);

    this.add.text(W/2, 44, 'REBIND CONTROLS', {
      fontFamily:'monospace', fontSize:'32px', color:'#cc8833',
      stroke:'#7a4a1a', strokeThickness:4,
    }).setOrigin(0.5);

    this.add.text(W/2, 76, 'Click a key box, then press the new key on your keyboard.', {
      fontFamily:'monospace', fontSize:'11px', color:'#556655',
    }).setOrigin(0.5);
    this.add.text(W/2, 90, 'Press ESC while a box is highlighted to cancel that rebind.', {
      fontFamily:'monospace', fontSize:'10px', color:'#445544',
    }).setOrigin(0.5);

    // Soft warning slot for duplicate key bindings — populated by checkDupes() below.
    this._warnText = this.add.text(W/2, 106, '', {
      fontFamily:'monospace', fontSize:'11px', color:'#ffaa44',
      stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);

    // Column headers
    this.add.text(W/2 - 120, 112, 'P1', { fontFamily:'monospace', fontSize:'14px', color:'#88cc44', letterSpacing:2 }).setOrigin(0.5);
    this.add.text(W/2 + 120, 112, 'P2', { fontFamily:'monospace', fontSize:'14px', color:'#4488cc', letterSpacing:2 }).setOrigin(0.5);

    const ACTIONS = [
      { label:'Move Up',    p1:'p1up',      p2:'p2up'      },
      { label:'Move Down',  p1:'p1down',    p2:'p2down'    },
      { label:'Move Left',  p1:'p1left',    p2:'p2left'    },
      { label:'Move Right', p1:'p1right',   p2:'p2right'   },
      { label:'Attack',     p1:'p1attack',  p2:'p2attack'  },
      { label:'Alt Attack', p1:'p1alt',     p2:'p2alt'     },
      { label:'Build',      p1:'p1build',   p2:'p2build'   },
      { label:'Interact',   p1:'p1interact',p2:'p2interact'},
    ];
    const ROW_START = 140, ROW_H = 60;

    this._listening = null; // { actionKey, box, lbl }
    this._keyBoxes = [];

    const getBindings = () => Object.assign({}, DEFAULT_BINDINGS, loadSettings().bindings || {});

    // Build a lookup of action key → human label for the duplicate-binding warning.
    const ACTION_LABELS = {};
    ACTIONS.forEach(row => {
      ACTION_LABELS[row.p1] = 'P1 ' + row.label;
      ACTION_LABELS[row.p2] = 'P2 ' + row.label;
    });
    const checkDupes = () => {
      const B = getBindings();
      const seen = new Map();
      const conflicts = [];
      for (const [action, key] of Object.entries(B)) {
        if (!key) continue;
        if (seen.has(key)) {
          conflicts.push({ key, a: seen.get(key), b: action });
        } else {
          seen.set(key, action);
        }
      }
      if (!this._warnText) return;
      if (conflicts.length === 0) {
        this._warnText.setText('');
      } else {
        const c = conflicts[0];
        const more = conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : '';
        this._warnText.setText(`⚠ ${keyDisplayName(c.key)} is bound to ${ACTION_LABELS[c.a]} AND ${ACTION_LABELS[c.b]}${more}`);
      }
    };
    this._checkDupes = checkDupes;

    const makeKeyBox = (actionKey, x, y, isP1) => {
      const B = getBindings();
      const g = this.add.graphics();
      const lbl = this.add.text(x, y, keyDisplayName(B[actionKey]), {
        fontFamily:'monospace', fontSize:'16px', color:'#ffffff', stroke:'#000', strokeThickness:2,
      }).setOrigin(0.5);
      const zone = this.add.zone(x, y, 100, 44).setInteractive({ useHandCursor: true });
      const redraw = (selected, listening) => {
        g.clear();
        if (listening) {
          g.fillStyle(0x2a1a00, 0.95); g.fillRoundedRect(x-46, y-18, 92, 36, 5);
          g.lineStyle(2, 0xffcc44); g.strokeRoundedRect(x-46, y-18, 92, 36, 5);
          lbl.setText('...').setColor('#ffcc44');
        } else {
          g.fillStyle(selected ? (isP1 ? 0x142014 : 0x0d1420) : 0x0d0d14, 0.95);
          g.fillRoundedRect(x-46, y-18, 92, 36, 5);
          g.lineStyle(2, selected ? (isP1 ? 0x88cc44 : 0x4488cc) : 0x222233);
          g.strokeRoundedRect(x-46, y-18, 92, 36, 5);
          lbl.setText(keyDisplayName(getBindings()[actionKey])).setColor(selected ? '#ffffff' : '#aaaaaa');
        }
      };
      redraw(false, false);
      zone.on('pointerover', () => { if (!this._listening) redraw(true, false); });
      zone.on('pointerout',  () => { if (!this._listening || this._listening.actionKey !== actionKey) redraw(false, false); });
      zone.on('pointerdown', () => {
        if (this._listening) {
          // Cancel previous listening
          const prev = this._listening;
          prev.redraw(false, false);
          this.input.keyboard.off('keydown', prev.handler);
        }
        redraw(true, true);
        const handler = (event) => {
          this._listening = null;
          if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.ESC) {
            redraw(false, false);
            return;
          }
          // Find the key name from keyCode
          const KC = Phaser.Input.Keyboard.KeyCodes;
          let keyName = Object.keys(KC).find(k => KC[k] === event.keyCode);
          if (!keyName) keyName = event.key.toUpperCase();
          // Reject keys we can't actually bind (dead/international keys with no KeyCodes
          // entry) — persisting one would leave the box looking set but the key inert.
          if (KC[keyName] === undefined) { redraw(false, false); return; }
          const cur = getBindings();
          // If this key already belongs to another action, SWAP: hand that action the
          // key this one is giving up. Previously we cleared it to '' , which left a
          // movement/attack key silently dead with no on-screen warning.
          const prevKey = cur[actionKey];
          for (const [otherAction, otherKey] of Object.entries(cur)) {
            if (otherAction !== actionKey && otherKey === keyName) cur[otherAction] = prevKey;
          }
          cur[actionKey] = keyName;
          saveSettings({ bindings: cur });
          redraw(false, false);
          // Other boxes may have been cleared by the duplicate-stealing logic
          // above — refresh their labels too so the UI reflects the new state.
          if (this._keyBoxes) {
            for (const kb of this._keyBoxes) {
              if (kb.actionKey !== actionKey) kb.redraw(false, false);
            }
          }
          checkDupes();
        };
        this._listening = { actionKey, redraw, handler };
        this.input.keyboard.once('keydown', handler);
      });
      return { g, lbl, redraw, zone, actionKey };
    };

    ACTIONS.forEach((row, i) => {
      const y = ROW_START + i * ROW_H;
      // Action label
      this.add.text(W/2 - 280, y, row.label, {
        fontFamily:'monospace', fontSize:'13px', color:'#667766', letterSpacing:1,
      }).setOrigin(0, 0.5);
      // Divider line
      const div = this.add.graphics();
      div.lineStyle(1, 0x1a1a2a); div.lineBetween(W/2-350, y+28, W/2+350, y+28);
      // Key boxes
      this._keyBoxes.push(makeKeyBox(row.p1, W/2 - 120, y, true));
      this._keyBoxes.push(makeKeyBox(row.p2, W/2 + 120, y, false));
    });

    // Surface any duplicate bindings the player walked in with.
    checkDupes();

    // Reset to defaults button
    const resetBtn = this.add.text(W/2, ROW_START + ACTIONS.length * ROW_H + 20, '[ RESET TO DEFAULTS ]', {
      fontFamily:'monospace', fontSize:'14px', color:'#cc4444',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    resetBtn.on('pointerover', () => resetBtn.setColor('#ff6666'));
    resetBtn.on('pointerout',  () => resetBtn.setColor('#cc4444'));
    resetBtn.on('pointerdown', () => {
      if (this._listening) {
        this.input.keyboard.off('keydown', this._listening.handler);
        this._listening = null;
      }
      saveSettings({ bindings: Object.assign({}, DEFAULT_BINDINGS) });
      this._keyBoxes.forEach(b => b.redraw(false, false));
      checkDupes();
    });

    // Back button
    const backBtn = this.add.text(W/2, H - 22, '[ BACK TO SETTINGS ]', {
      fontFamily:'monospace', fontSize:'18px', color:'#aaffaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerover', () => backBtn.setColor('#ffffff'));
    backBtn.on('pointerout',  () => backBtn.setColor('#aaffaa'));
    this.tweens.add({ targets: backBtn, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });

    const goBack = () => {
      if (this._listening) {
        this.input.keyboard.off('keydown', this._listening.handler);
        this._listening = null;
      }
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => {
        this.scene.start('Settings', { returnTo: this._returnTo });
      });
    };
    backBtn.on('pointerdown', goBack);
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.input.keyboard.addKey(K.ESC).on('down', () => {
      if (this._listening) {
        const prev = this._listening;
        this._listening = null;
        prev.redraw(false, false);
        this.input.keyboard.off('keydown', prev.handler);
      } else {
        goBack();
      }
    });
  }
}

// ── SCENE: BOOT ───────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() {
    _qlog(`session start  v=${_fmtVersion(VERSION)}  ua=${navigator.userAgent.slice(0,80)}`, 'boot');

    // Brief splash so slow mobile loads don't show a blank canvas.
    // buildTextures() is synchronous and blocks the JS thread for ~50–200 ms
    // on lower-end devices; running it inside a setTimeout(0) lets the splash
    // paint first, so the player sees IRON WASTELAND + Loading… right away.
    const { W, H } = CFG;
    this.cameras.main.setBackgroundColor('#0a0a14');
    const title = this.add.text(W/2, H/2 - 24, 'IRON WASTELAND', {
      fontFamily:'monospace', fontSize:'32px', color:'#cc8833',
      stroke:'#7a4a1a', strokeThickness:4, letterSpacing: 4,
    }).setOrigin(0.5).setAlpha(0);
    const sub = this.add.text(W/2, H/2 + 14, 'Loading…', {
      fontFamily:'monospace', fontSize:'12px', color:'#556655', letterSpacing: 2,
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({ targets: [title, sub], alpha: 1, duration: 220, ease: 'Sine.Out' });

    // Defer the heavy texture build so the splash actually paints.
    setTimeout(() => {
      buildTextures(this);
      // Hold the splash briefly after textures finish so it doesn't flash.
      this.time.delayedCall(280, () => {
        this.cameras.main.fadeOut(220, 0, 0, 0);
        this.time.delayedCall(220, () => this.scene.start('ModeSelect'));
      });
    }, 60);
  }
}

// ── SCENE: MODE SELECT ────────────────────────────────────────
class ModeSelectScene extends Phaser.Scene {
  constructor() { super('ModeSelect'); }

  create() {
    const { W, H } = CFG;
    this.cameras.main.fadeIn(400, 0, 0, 0);
    this.selMode = 2;
    this.selDiff = 'survival';

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d1a0d, 0x0d1a0d, 0x0a0a1a, 0x0a0a1a, 1);
    bg.fillRect(0, 0, W, H);

    for (let i = 0; i < 80; i++) {
      const x = Phaser.Math.Between(0, W), y = Phaser.Math.Between(0, H * 0.65);
      this.add.circle(x, y, Phaser.Math.FloatBetween(0.5, 1.8), 0xffffff, Phaser.Math.FloatBetween(0.2, 0.8));
    }
    const gnd = this.add.graphics();
    gnd.fillStyle(0x0d2a0d); gnd.fillRect(0, H * 0.7, W, H * 0.3);

    this.add.text(W/2, H*0.12, 'IRON WASTELAND', {
      fontFamily:'monospace', fontSize:'54px', color:'#cc8833',
      stroke:'#7a4a1a', strokeThickness:6,
      shadow:{offsetX:4, offsetY:4, color:'#000', blur:8, fill:true},
    }).setOrigin(0.5);

    // Build/version stamp — placed under the title so the date the player
    // is currently running is always visible at a glance.
    this.add.text(W/2, H*0.20, 'Last updated ' + _fmtVersion(VERSION), {
      fontFamily:'monospace', fontSize:'14px', color:'#d4a06a',
      stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);

    // ── PLAYERS row ──
    this.add.text(W/2, H*0.28, 'PLAYERS', {
      fontFamily:'monospace', fontSize:'15px', color:'#556655',
    }).setOrigin(0.5);

    const playerOpts = [
      { label:'1 PLAYER',  sub:'WASD + Mouse', mode:1, x: W/2 - 185 },
      { label:'2 PLAYERS', sub:'WASD + Arrows',  mode:2, x: W/2 + 185 },
    ];
    this.pBoxes = playerOpts.map(o => {
      const box = this.add.graphics();
      const lbl = this.add.text(o.x, H*0.38, o.label, { fontFamily:'monospace', fontSize:'20px', color:'#ffffff', stroke:'#000', strokeThickness:2 }).setOrigin(0.5);
      this.add.text(o.x, H*0.38+28, o.sub, { fontFamily:'monospace', fontSize:'12px', color:'#778866' }).setOrigin(0.5);
      // Clickable hit zone over the box
      const zone = this.add.zone(o.x, H*0.38+23, 230, 92).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.setMode(o.mode));
      zone.on('pointerdown', () => this.setMode(o.mode));
      return { box, lbl, x:o.x, y:H*0.38, mode:o.mode };
    });

    // ── DIFFICULTY row ──
    this.add.text(W/2, H*0.52, 'DIFFICULTY', {
      fontFamily:'monospace', fontSize:'15px', color:'#556655',
    }).setOrigin(0.5);

    const diffOpts = [
      {
        label:'SURVIVAL',
        sub1: '2P: Teammate can revive you',
        sub2: '1P: One life — don\'t die!',
        diff: 'survival',
        x: W/2 - 220,
      },
      {
        label:'HARDCORE',
        sub1: 'Death = permanent game over',
        sub2: 'No second chances. Ever.',
        diff: 'hardcore',
        x: W/2 + 220,
      },
    ];
    this.dBoxes = diffOpts.map(o => {
      const box = this.add.graphics();
      const lbl = this.add.text(o.x, H*0.63, o.label, { fontFamily:'monospace', fontSize:'20px', color:'#ffffff', stroke:'#000', strokeThickness:2 }).setOrigin(0.5);
      this.add.text(o.x, H*0.63+26, o.sub1, { fontFamily:'monospace', fontSize:'11px', color:'#889977' }).setOrigin(0.5);
      this.add.text(o.x, H*0.63+42, o.sub2, { fontFamily:'monospace', fontSize:'11px', color:'#667755' }).setOrigin(0.5);
      // Clickable hit zone over the box
      const zone = this.add.zone(o.x, H*0.63+32, 230, 110).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.setDiff(o.diff));
      zone.on('pointerdown', () => this.setDiff(o.diff));
      return { box, lbl, x:o.x, y:H*0.63, diff:o.diff };
    });

    this.promptText = this.add.text(W/2, H*0.82, '', {
      fontFamily:'monospace', fontSize:'16px', color:'#ffffff',
      backgroundColor:'#00000000', padding:{x:16, y:8},
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.promptText.on('pointerover', () => this.promptText.setAlpha(1));
    this.promptText.on('pointerout',  () => {});  // tween handles alpha
    this.promptText.on('pointerdown', () => this.confirm());
    this.tweens.add({ targets:this.promptText, alpha:0.3, duration:600, yoyo:true, repeat:-1 });

    this.add.text(W/2, H*0.93, 'Built for Hudson, Zachary & Jared', {
      fontFamily:'monospace', fontSize:'12px', color:'#334433',
    }).setOrigin(0.5);

    // Settings button — bottom left
    const settingsTxt = this.add.text(16, H - 16, '\u2699 Settings', {
      fontFamily:'monospace', fontSize:'13px', color:'#445544',
    }).setOrigin(0, 1).setInteractive({ useHandCursor: true });
    settingsTxt.on('pointerover', () => settingsTxt.setColor('#88cc88'));
    settingsTxt.on('pointerout',  () => settingsTxt.setColor('#445544'));
    settingsTxt.on('pointerdown', () => {
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => this.scene.start('Settings'));
    });

    const exitTxt = this.add.text(W - 16, H - 16, '[ EXIT GAME ]', {
      fontFamily:'monospace', fontSize:'12px', color:'#554444',
    }).setOrigin(1, 1).setInteractive({ useHandCursor: true });
    exitTxt.on('pointerover', () => exitTxt.setColor('#ff6644'));
    exitTxt.on('pointerout',  () => exitTxt.setColor('#554444'));
    exitTxt.on('pointerdown', () => window.close());

    // Keys
    const K = Phaser.Input.Keyboard.KeyCodes;
    const keys = this.input.keyboard.addKeys({
      left:K.LEFT, right:K.RIGHT, up:K.UP, down:K.DOWN,
      a:K.A, d:K.D, w:K.W, s:K.S,
      enter:K.ENTER, space:K.SPACE, esc:K.ESC,
    });
    keys.left.on('down',  () => this.setMode(1));
    keys.a.on('down',     () => this.setMode(1));
    keys.right.on('down', () => this.setMode(2));
    keys.d.on('down',     () => this.setMode(2));
    keys.up.on('down',    () => this.setDiff('survival'));
    keys.w.on('down',     () => this.setDiff('survival'));
    keys.down.on('down',  () => this.setDiff('hardcore'));
    keys.s.on('down',     () => this.setDiff('hardcore'));
    keys.enter.on('down', () => this.confirm());
    keys.space.on('down', () => this.confirm());
    keys.esc.on('down',   () => window.close());

    this.setMode(2);
    this.setDiff('survival');
  }

  drawBox(g, x, y, selected, color, tall) {
    g.clear();
    g.fillStyle(selected ? 0x1a261a : 0x0e0e16, 0.95);
    const h = tall ? 110 : 92;
    g.fillRoundedRect(x-115, y-46, 230, h, 8);
    g.lineStyle(2, selected ? (color || 0xcc8833) : 0x2a2a3a);
    g.strokeRoundedRect(x-115, y-46, 230, h, 8);
  }

  setMode(mode) {
    const changed = this.selMode !== mode;
    this.selMode = mode;
    this.pBoxes.forEach(b => {
      const isSel = b.mode === mode;
      this.drawBox(b.box, b.x, b.y, isSel, 0x6699ff, false);
      b.lbl.setColor(isSel ? '#88aaff' : '#aaaaaa');
      // Quick scale punch on the newly-chosen label so selection feels tactile.
      if (changed && isSel) this._punchLabel(b.lbl);
      else if (changed && !isSel) b.lbl.setScale(1);
    });
    this.updatePrompt();
  }

  setDiff(diff) {
    const changed = this.selDiff !== diff;
    this.selDiff = diff;
    const cols = { survival: 0x33cc55, hardcore: 0xff4444 };
    this.dBoxes.forEach(b => {
      const isSel = b.diff === diff;
      this.drawBox(b.box, b.x, b.y, isSel, cols[b.diff], true);
      b.lbl.setColor(isSel ? (diff === 'hardcore' ? '#ff6666' : '#55ee77') : '#aaaaaa');
      if (changed && isSel) this._punchLabel(b.lbl);
      else if (changed && !isSel) b.lbl.setScale(1);
    });
    this.updatePrompt();
  }

  // Brief scale-up tween (1.0 → 1.06 → 1.0) used for selection feedback.
  _punchLabel(lbl) {
    if (!lbl || !lbl.active) return;
    this.tweens.killTweensOf(lbl);
    lbl.setScale(1);
    this.tweens.add({
      targets: lbl, scale: 1.06, duration: 110, ease: 'Quad.Out',
      yoyo: true,
    });
  }

  updatePrompt() {
    const ps = this.selMode === 1 ? '1P' : '2P';
    const ds = this.selDiff === 'hardcore' ? 'HARDCORE' : 'SURVIVAL';
    this.promptText.setText('[ ' + ps + ' · ' + ds + ' ]   Click here  or  ENTER to start');
    this.promptText.setColor(this.selDiff === 'hardcore' ? '#ff8866' : '#aaffaa');
  }

  confirm() {
    STATE.mode = this.selMode;
    STATE.difficulty = this.selDiff;
    _qlog(`ModeSelect: confirmed  mode=${this.selMode === 1 ? '1P' : '2P'}  diff=${this.selDiff}`, 'menu');
    Music.start();
    // Apply saved audio settings (volume sliders; fall back to legacy on/off booleans)
    const _as = loadSettings();
    if (Music.gain) {
      const _mv = _as.musicVolume !== undefined ? _as.musicVolume : (_as.musicEnabled !== false ? 50 : 0);
      Music.gain.gain.value = (_mv / 100) * 0.14;
    }
    const _sv = _as.sfxVolume !== undefined ? _as.sfxVolume : (_as.sfxEnabled !== false ? 100 : 0);
    SFX._sfxVol = _sv / 100;
    SFX._enabled = _sv > 0;
    if (SFX.gain) SFX.gain.gain.value = SFX._sfxVol;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.time.delayedCall(300, () => this.scene.start('CharSelect'));
  }
}

// ── SCENE: SETTINGS ──────────────────────────────────────────
class SettingsScene extends Phaser.Scene {
  constructor() { super('Settings'); }

  init(data) {
    this._returnTo = (data && data.returnTo) ? data.returnTo : null;
    this._p1CharId = (data && data.p1CharId) ? data.p1CharId : null;
    this._p2CharId = (data && data.p2CharId) ? data.p2CharId : null;
    this._isSolo   = data ? !!data.solo : true;
  }

  create() {
    const { W, H } = CFG;
    // Scale factor so layout fits both desktop (1280x720) and iPad (640x360)
    const S  = Math.min(W / 1280, H / 720);
    const fs = (n) => Math.max(8, Math.round(n * S)) + 'px';
    const sp = (n) => Math.round(n * S);

    const fromGame = this._returnTo === 'Game';
    if (!fromGame) this.cameras.main.fadeIn(300, 0, 0, 0);

    // Background
    const bg = this.add.graphics();
    if (fromGame) {
      bg.fillStyle(0x000000, 0.72).fillRect(0, 0, W, H);
    } else {
      bg.fillGradientStyle(0x0a0a14, 0x0a0a14, 0x080810, 0x080810, 1);
      bg.fillRect(0, 0, W, H);
    }
    if (fromGame) {
      this.add.text(sp(20), sp(22), '⏸ PAUSED', {
        fontFamily: 'monospace', fontSize: fs(14), color: '#88aabb',
        stroke: '#000', strokeThickness: 2, letterSpacing: 3,
      }).setOrigin(0, 0.5);
    }

    let y = sp(40);

    // TITLE
    this.add.text(W / 2, y, 'SETTINGS', {
      fontFamily: 'monospace', fontSize: fs(28), color: '#cc8833',
      stroke: '#7a4a1a', strokeThickness: 3,
    }).setOrigin(0.5);
    y += sp(38);

    // INPUT MODE
    const devNote = isTouchDevice() ? '📱 touch' : '💻 keyboard';
    this.add.text(W / 2, y, 'INPUT MODE  —  ' + devNote + ' detected', {
      fontFamily: 'monospace', fontSize: fs(11), color: '#556655', letterSpacing: 3,
    }).setOrigin(0.5);
    y += sp(18);

    const inputOpts = [
      { key: 'auto',     label: 'AUTO',     sub: isTouchDevice() ? 'auto-detect (touch)' : 'auto-detect (kb)' },
      { key: 'touch',    label: 'TOUCH',    sub: 'virtual joystick + btns' },
      { key: 'keyboard', label: 'KEYBOARD', sub: 'WASD + mouse / arrows' },
    ];
    const curMode = loadSettings().inputMode || 'auto';
    this._inputSel = curMode;
    const ibW = sp(210), ibH = sp(50);
    const ibSpacing = Math.min(sp(240), Math.floor((W - sp(120)) / 3));
    const ibCy = y + ibH / 2;
    this._inputBoxes = inputOpts.map((o, i) => {
      const x = W / 2 + (i - 1) * ibSpacing;
      const box = this.add.graphics();
      const lbl = this.add.text(x, ibCy - sp(7), o.label, {
        fontFamily: 'monospace', fontSize: fs(16), color: '#ffffff',
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      this.add.text(x, ibCy + sp(11), o.sub, {
        fontFamily: 'monospace', fontSize: fs(9), color: '#667755',
      }).setOrigin(0.5);
      const zone = this.add.zone(x, ibCy, ibW, ibH).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.setInput(o.key));
      zone.on('pointerdown', () => { this.setInput(o.key); saveSettings({ inputMode: o.key }); });
      return { box, lbl, x, y: ibCy, key: o.key, bw: ibW, bh: ibH };
    });
    y += ibH + sp(14);

    y += sp(16);

    // AUDIO
    this.add.text(W / 2, y, 'AUDIO', {
      fontFamily: 'monospace', fontSize: fs(11), color: '#556655', letterSpacing: 3,
    }).setOrigin(0.5);
    y += sp(18);

    const st = loadSettings();
    const musicVol = st.musicVolume !== undefined ? st.musicVolume : (st.musicEnabled !== false ? 50 : 0);
    const sfxVol   = st.sfxVolume   !== undefined ? st.sfxVolume   : (st.sfxEnabled   !== false ? 100 : 0);

    const makeSlider = (label, cy, initialVal, onChange) => {
      const trackW = Math.min(sp(280), Math.floor(W * 0.38));
      const trackH = Math.max(4, sp(8)), thumbW = Math.max(8, sp(14)), thumbH = Math.max(14, sp(24));
      const cx = W / 2, trackX = cx - trackW / 2;
      this.add.text(cx, cy - sp(16), label, {
        fontFamily: 'monospace', fontSize: fs(10), color: '#445544', letterSpacing: 2,
      }).setOrigin(0.5);
      const trackGfx = this.add.graphics();
      const fillGfx  = this.add.graphics();
      const thumbGfx = this.add.graphics();
      const valTxt   = this.add.text(trackX + trackW + sp(16), cy, '100%', {
        fontFamily: 'monospace', fontSize: fs(10), color: '#aaffaa',
      }).setOrigin(0, 0.5);
      let val = Phaser.Math.Clamp(initialVal, 0, 100);
      const redraw = () => {
        const pct = val / 100, fillW = Math.max(0, Math.floor(trackW * pct));
        trackGfx.clear();
        trackGfx.fillStyle(0x111122, 0.95);
        trackGfx.fillRoundedRect(trackX, cy - trackH / 2, trackW, trackH, 4);
        trackGfx.lineStyle(1, 0x334433, 0.8);
        trackGfx.strokeRoundedRect(trackX, cy - trackH / 2, trackW, trackH, 4);
        fillGfx.clear();
        if (fillW > 0) {
          fillGfx.fillStyle(val > 0 ? 0x44aa44 : 0x333344, 0.9);
          fillGfx.fillRoundedRect(trackX, cy - trackH / 2, fillW, trackH, 4);
        }
        const thumbX = trackX + Math.floor(trackW * pct) - thumbW / 2;
        thumbGfx.clear();
        thumbGfx.fillStyle(val > 0 ? 0x88cc88 : 0x556655, 1);
        thumbGfx.fillRoundedRect(thumbX, cy - thumbH / 2, thumbW, thumbH, 3);
        thumbGfx.lineStyle(1.5, val > 0 ? 0xaaffaa : 0x445544, 0.9);
        thumbGfx.strokeRoundedRect(thumbX, cy - thumbH / 2, thumbW, thumbH, 3);
        valTxt.setText(val + '%').setColor(val > 0 ? '#aaffaa' : '#556655');
      };
      const applyPtr = (ptr) => {
        val = Phaser.Math.Clamp(Math.round(((ptr.x - trackX) / trackW) * 100), 0, 100);
        redraw(); onChange(val);
      };
      const zone = this.add.zone(cx, cy, trackW + thumbW + sp(20), thumbH + sp(12)).setInteractive({ useHandCursor: true, draggable: false });
      zone.on('pointerdown', applyPtr);
      zone.on('pointermove', (ptr) => { if (ptr.isDown) applyPtr(ptr); });
      redraw();
    };

    makeSlider('MUSIC', y + sp(14), musicVol, (v) => {
      saveSettings({ musicVolume: v, musicEnabled: v > 0 });
      if (Music.gain) Music.gain.gain.value = (v / 100) * 0.14;
    });
    y += sp(34);
    makeSlider('SFX', y + sp(14), sfxVol, (v) => {
      saveSettings({ sfxVolume: v, sfxEnabled: v > 0 });
      SFX._sfxVol = v / 100; SFX._enabled = v > 0;
      if (SFX.gain) SFX.gain.gain.value = SFX._sfxVol;
    });
    y += sp(38);

    y += sp(16);

    // GAMEPLAY TOGGLES
    const makeToggle = (label, tx, ty, initial, onToggle) => {
      const bx_off = sp(48), tbW = sp(84), tbH = sp(38);
      const opts = [{ key: true, label: 'ON' }, { key: false, label: 'OFF' }];
      this.add.text(tx, ty - sp(26), label, {
        fontFamily: 'monospace', fontSize: fs(10), color: '#445544', letterSpacing: 2,
      }).setOrigin(0.5);
      const boxes = opts.map((o, i) => {
        const bx = tx + (i === 0 ? -bx_off : bx_off), by = ty;
        const tbg = this.add.graphics();
        const lbl = this.add.text(bx, by, o.label, {
          fontFamily: 'monospace', fontSize: fs(14), color: '#fff',
          stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5);
        const zone = this.add.zone(bx, by, tbW, tbH).setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => { onToggle(o.key); redraw(o.key); });
        return { bg: tbg, lbl, bx, by, key: o.key, bw: tbW, bh: tbH };
      });
      const redraw = (sel) => boxes.forEach(b => {
        b.bg.clear();
        b.bg.fillStyle(b.key === sel ? 0x142014 : 0x0d0d14, 0.95);
        b.bg.fillRoundedRect(b.bx - tbW / 2, b.by - tbH / 2, tbW, tbH, 6);
        b.bg.lineStyle(2, b.key === sel ? 0x88cc44 : 0x222233);
        b.bg.strokeRoundedRect(b.bx - tbW / 2, b.by - tbH / 2, tbW, tbH, 6);
        b.lbl.setColor(b.key === sel ? '#aaffaa' : '#888899');
      });
      redraw(initial);
    };

    makeToggle('FOG OF WAR', W / 2 - sp(190), y + sp(28), st.fogEnabled !== false,         (v) => saveSettings({ fogEnabled: v }));
    makeToggle('MINIMAP',    W / 2,            y + sp(28), st.minimapEnabled !== false,       (v) => saveSettings({ minimapEnabled: v }));
    y += sp(62);

    y += sp(16);

    // TUTORIAL TIPS
    const tutEnabled = loadSettings().tutorial !== false;
    this._tutSel = tutEnabled;
    const tutBh = sp(50), tutBw = sp(200), tutSpacing = sp(130);
    const tutCy = y + tutBh / 2;
    const tutOpts = [
      { key: true,  label: 'ON',  sub: 'Tips during first game' },
      { key: false, label: 'OFF', sub: 'For experienced players' },
    ];
    this._tutBoxes = tutOpts.map((o, i) => {
      const tx = W / 2 + (i === 0 ? -tutSpacing : tutSpacing);
      const box = this.add.graphics();
      const lbl = this.add.text(tx, tutCy - sp(8), o.label, {
        fontFamily: 'monospace', fontSize: fs(16), color: '#ffffff',
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      this.add.text(tx, tutCy + sp(10), o.sub, {
        fontFamily: 'monospace', fontSize: fs(9), color: '#557755',
      }).setOrigin(0.5);
      const zone = this.add.zone(tx, tutCy, tutBw, tutBh).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.setTutorial(o.key));
      zone.on('pointerdown', () => { this.setTutorial(o.key); saveSettings({ tutorial: o.key }); });
      return { box, lbl, x: tx, y: tutCy, key: o.key, bw: tutBw, bh: tutBh };
    });
    this.add.text(W / 2, tutCy - tutBh / 2 - sp(14), 'TUTORIAL TIPS', {
      fontFamily: 'monospace', fontSize: fs(10), color: '#445544', letterSpacing: 2,
    }).setOrigin(0.5);
    y += tutBh + sp(14);

    // CONTROLS REFERENCE — in-game only
    if (fromGame && this._p1CharId) {
      y += sp(14);
      this.add.text(W / 2, y, 'YOUR CONTROLS', {
        fontFamily: 'monospace', fontSize: fs(10), color: '#445566', letterSpacing: 3,
      }).setOrigin(0.5);
      y += sp(16);

      const p1Lines = getControls(1, this._p1CharId, this._isSolo);
      const p2Lines = (!this._isSolo && this._p2CharId) ? getControls(2, this._p2CharId) : null;
      const lnH = Math.max(10, sp(13));

      const p1x = p2Lines ? Math.floor(W * 0.28) : W / 2;
      const p1Ch = CHARS.find(c => c.id === this._p1CharId);
      const p1Col = p1Ch ? '#' + (p1Ch.color || 0x88aaff).toString(16).padStart(6, '0') : '#88aaff';
      this.add.text(p1x, y, p1Ch ? p1Ch.player + ' — ' + p1Ch.title : 'Player 1', {
        fontFamily: 'monospace', fontSize: fs(10), color: p1Col,
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5);
      p1Lines.forEach((l, i) => {
        this.add.text(p1x, y + sp(14) + i * lnH, l, {
          fontFamily: 'monospace', fontSize: fs(9), color: '#aabbcc',
          stroke: '#000', strokeThickness: 1,
        }).setOrigin(0.5);
      });

      if (p2Lines) {
        const p2x = Math.floor(W * 0.72);
        const p2Ch = CHARS.find(c => c.id === this._p2CharId);
        const p2Col = p2Ch ? '#' + (p2Ch.color || 0xffbb77).toString(16).padStart(6, '0') : '#ffbb77';
        this.add.text(p2x, y, p2Ch ? p2Ch.player + ' — ' + p2Ch.title : 'Player 2', {
          fontFamily: 'monospace', fontSize: fs(10), color: p2Col,
          stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5);
        p2Lines.forEach((l, i) => {
          this.add.text(p2x, y + sp(14) + i * lnH, l, {
            fontFamily: 'monospace', fontSize: fs(9), color: '#eeddcc',
            stroke: '#000', strokeThickness: 1,
          }).setOrigin(0.5);
        });
        y += sp(14) + Math.max(p1Lines.length, p2Lines.length) * lnH + sp(8);
      } else {
        y += sp(14) + p1Lines.length * lnH + sp(8);
      }
    }

    // BOTTOM BUTTONS — anchored to H so they never overlap content
    const btnRuleY = H - sp(96);

    // Utility buttons row
    const utilBtns = [];
    const addUtil = (label, col, handler) => {
      const btn = this.add.text(0, H - sp(68), label, {
        fontFamily: 'monospace', fontSize: fs(11), color: col,
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#ffffff'));
      btn.on('pointerout',  () => btn.setColor(col));
      btn.on('pointerdown', handler);
      utilBtns.push(btn);
      return btn;
    };

    const resetTutBtn = addUtil('[ RESET TUTORIAL ]', '#556655', () => {
      try { localStorage.removeItem('iw_tutorial_state'); } catch (e) {}
      saveSettings({ tutorial: true });
      this.setTutorial(true);
      resetTutBtn.setColor('#aaffaa');
      this.time.delayedCall(1200, () => resetTutBtn.setColor('#556655'));
    });

    addUtil('[ REBIND CONTROLS ]', '#8888cc', () => {
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => this.scene.start('Controls', { returnTo: this._returnTo }));
    });

    if (fromGame) {
      addUtil('[ QUIT TO MENU ]', '#cc6655', () => {
        this.cameras.main.fadeOut(200, 0, 0, 0);
        this.time.delayedCall(200, () => {
          const gs = this.scene.get('Game');
          this.scene.stop('Settings');
          this.scene.resume('Game');
          if (gs && gs.triggerGameOver) gs.triggerGameOver('Run abandoned — better luck next time.');
        });
      });
    }

    // Space utility buttons evenly
    const uSpacing = Math.min(sp(280), Math.floor((W - sp(80)) / utilBtns.length));
    const uStartX  = W / 2 - uSpacing * (utilBtns.length - 1) / 2;
    utilBtns.forEach((b, i) => b.setX(uStartX + i * uSpacing));

    // BACK / CLOSE button
    const backLabel = fromGame ? '[ BACK TO GAME ]' : '[ BACK TO MAIN MENU ]';
    const backBtn = this.add.text(W / 2, H - sp(30), backLabel, {
      fontFamily: 'monospace', fontSize: fs(18), color: '#aaffaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerover', () => backBtn.setColor('#ffffff'));
    backBtn.on('pointerout',  () => backBtn.setColor('#aaffaa'));

    const goBack = () => {
      const _s = loadSettings();
      _qlog('Settings: back  returnTo=' + (this._returnTo || 'menu') + '  inputMode=' + (_s.inputMode || 'auto'), 'menu');
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => {
        if (this._returnTo === 'Game') {
          const gameScene = this.scene.get('Game');
          this.scene.stop('Settings');
          this.scene.resume('Game');
          if (gameScene && gameScene.cameras && gameScene.cameras.main) {
            gameScene._camFx('fadeIn', [300, 0, 0, 0]);
          }
        } else {
          this.scene.start('ModeSelect');
        }
      });
    };

    backBtn.on('pointerdown', goBack);
    this.tweens.add({ targets: backBtn, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });

    // Both ESC and TAB dismiss the settings overlay
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.input.keyboard.addCapture(K.TAB);
    this.input.keyboard.addKey(K.ESC).on('down', goBack);
    this.input.keyboard.addKey(K.TAB).on('down', goBack);

    this.setInput(curMode);
    this.setTutorial(tutEnabled);
  }

  // drawSettingsBox — optional bw/bh for compact variants
  drawSettingsBox(g, x, y, selected, bw, bh) {
    const w = bw || 260, h = bh || 90;
    g.clear();
    g.fillStyle(selected ? 0x142014 : 0x0d0d14, 0.95);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 8);
    g.lineStyle(2, selected ? 0x88cc44 : 0x222233);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 8);
  }

  setInput(key) {
    this._inputSel = key;
    this._inputBoxes.forEach(b => {
      this.drawSettingsBox(b.box, b.x, b.y, b.key === key, b.bw, b.bh);
      b.lbl.setColor(b.key === key ? '#aaffaa' : '#888899');
    });
  }

  setTutorial(key) {
    this._tutSel = key;
    if (this._tutBoxes) {
      this._tutBoxes.forEach(b => {
        this.drawSettingsBox(b.box, b.x, b.y, b.key === key, b.bw, b.bh);
        b.lbl.setColor(b.key === key ? '#aaffaa' : '#888899');
      });
    }
  }
}


// ── SCENE: GAME ───────────────────────────────────────────────
