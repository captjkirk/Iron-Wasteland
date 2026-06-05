// ============================================================
// IRON WASTELAND — key bindings + Boot/Controls/ModeSelect/Settings/CharSelect scenes
// Split module — loaded by index.html as a classic <script> in
// dependency order. All split files share ONE global scope (no ES
// modules), so top-level symbols are visible across every file.
// Navigation map (MANIFEST) lives at the top of src/config.js.
// ============================================================
'use strict';


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
          const cur = getBindings();
          // If this key is already bound to a different action, clear that old
          // action first so we never persist duplicate bindings (which would
          // leave one of the two actions silently non-functional).
          for (const [otherAction, otherKey] of Object.entries(cur)) {
            if (otherAction !== actionKey && otherKey === keyName) cur[otherAction] = '';
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
    // Remember who launched us so the back button can return there
    this._returnTo = (data && data.returnTo) ? data.returnTo : null;
  }

  create() {
    const { W, H } = CFG;
    const fromGame = this._returnTo === 'Game';
    // Skip the menu fade-in when we're popping over a paused game — the
    // pause overlay should appear instantly so the player knows the world froze.
    if (!fromGame) this.cameras.main.fadeIn(300, 0, 0, 0);

    const bg = this.add.graphics();
    if (fromGame) {
      // Pause overlay: 65% dim so the frozen world peeks through.
      bg.fillStyle(0x000000, 0.65).fillRect(0, 0, W, H);
    } else {
      bg.fillGradientStyle(0x0a0a14, 0x0a0a14, 0x080810, 0x080810, 1);
      bg.fillRect(0, 0, W, H);
    }

    // Discreet PAUSED watermark — only when overlaying gameplay.
    if (fromGame) {
      this.add.text(20, 22, '⏸ PAUSED', {
        fontFamily:'monospace', fontSize:'14px', color:'#88aabb',
        stroke:'#000', strokeThickness:2, letterSpacing: 3,
      }).setOrigin(0, 0.5);
    }

    this.add.text(W/2, 44, 'SETTINGS', {
      fontFamily:'monospace', fontSize:'36px', color:'#cc8833',
      stroke:'#7a4a1a', strokeThickness:4,
    }).setOrigin(0.5);

    // ── Input mode section ──────────────────────────────────
    this.add.text(W/2, 98, 'INPUT MODE', {
      fontFamily:'monospace', fontSize:'13px', color:'#556655', letterSpacing: 3,
    }).setOrigin(0.5);

    this.add.text(W/2, 120, 'Choose how you control the game. "Auto" detects your device automatically.', {
      fontFamily:'monospace', fontSize:'11px', color:'#445544',
    }).setOrigin(0.5);

    const inputOpts = [
      { key:'auto',     label:'AUTO',     sub: isTouchDevice() ? '(will use Touch on this device)' : '(will use Keyboard on this device)' },
      { key:'touch',    label:'TOUCH',    sub: 'Virtual joystick + on-screen buttons' },
      { key:'keyboard', label:'KEYBOARD', sub: 'WASD + Mouse (or arrow keys for P2)' },
    ];

    const curMode = loadSettings().inputMode || 'auto';
    this._inputSel = curMode;
    this._inputBoxes = inputOpts.map((o, i) => {
      const x = W/2 + (i - 1) * 290;
      const y = 212;
      const box = this.add.graphics();
      const lbl = this.add.text(x, y, o.label, {
        fontFamily:'monospace', fontSize:'22px', color:'#ffffff', stroke:'#000', strokeThickness:2,
      }).setOrigin(0.5);
      this.add.text(x, y + 30, o.sub, {
        fontFamily:'monospace', fontSize:'10px', color:'#667755', wordWrap:{width:240},
      }).setOrigin(0.5, 0);
      const zone = this.add.zone(x, y + 20, 260, 80).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.setInput(o.key));
      zone.on('pointerdown', () => { this.setInput(o.key); saveSettings({ inputMode: o.key }); });
      return { box, lbl, x, y, key: o.key };
    });

    // Current device note
    const deviceNote = isTouchDevice()
      ? '\uD83D\uDCF1  iPad / touch device detected'
      : '\uD83D\uDCBB  Keyboard device detected';
    this.add.text(W/2, 318, deviceNote, {
      fontFamily:'monospace', fontSize:'12px', color:'#4a6a4a',
    }).setOrigin(0.5);

    // ── Audio settings ───────────────────────────────────────
    this.add.text(W/2, 352, 'AUDIO', {
      fontFamily:'monospace', fontSize:'13px', color:'#556655', letterSpacing: 3,
    }).setOrigin(0.5);

    const s = loadSettings();
    const fogOn = s.fogEnabled !== false;

    // ── Volume sliders ───────────────────────────────────────────
    const musicVol = s.musicVolume !== undefined ? s.musicVolume : (s.musicEnabled !== false ? 50 : 0);
    const sfxVol   = s.sfxVolume   !== undefined ? s.sfxVolume   : (s.sfxEnabled   !== false ? 100 : 0);

    const makeSlider = (label, cy, initialVal, onChange) => {
      const trackW = Math.min(300, W * 0.4), trackH = 8, thumbW = 14, thumbH = 26;
      const cx = W / 2, trackX = cx - trackW / 2;

      this.add.text(cx, cy - 18, label, {
        fontFamily:'monospace', fontSize:'10px', color:'#445544', letterSpacing:2,
      }).setOrigin(0.5);

      const trackGfx = this.add.graphics();
      const fillGfx  = this.add.graphics();
      const thumbGfx = this.add.graphics();
      const valTxt   = this.add.text(trackX + trackW + 18, cy, '100%', {
        fontFamily:'monospace', fontSize:'10px', color:'#aaffaa',
      }).setOrigin(0, 0.5);

      let val = Phaser.Math.Clamp(initialVal, 0, 100);

      const redraw = () => {
        const pct   = val / 100;
        const fillW = Math.max(0, Math.floor(trackW * pct));
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
        redraw();
        onChange(val);
      };

      const zone = this.add.zone(cx, cy, trackW + thumbW + 20, thumbH + 12)
        .setInteractive({ useHandCursor: true, draggable: false });
      zone.on('pointerdown', applyPtr);
      zone.on('pointermove', (ptr) => { if (ptr.isDown) applyPtr(ptr); });

      redraw();
    };

    makeSlider('MUSIC', 385, musicVol, (v) => {
      saveSettings({ musicVolume: v, musicEnabled: v > 0 });
      if (Music.gain) Music.gain.gain.value = (v / 100) * 0.14;
    });
    makeSlider('SFX', 425, sfxVol, (v) => {
      saveSettings({ sfxVolume: v, sfxEnabled: v > 0 });
      SFX._sfxVol = v / 100;
      SFX._enabled = v > 0;
      if (SFX.gain) SFX.gain.gain.value = SFX._sfxVol;
    });

    const makeToggle = (label, x, y, initial, onToggle) => {
      const opts = [{ key:true, label:'ON' }, { key:false, label:'OFF' }];
      this.add.text(x, y - 36, label, { fontFamily:'monospace', fontSize:'10px', color:'#445544', letterSpacing:2 }).setOrigin(0.5);
      const boxes = opts.map((o, i) => {
        const bx = x + (i === 0 ? -60 : 60), by = y;
        const bg = this.add.graphics();
        const lbl = this.add.text(bx, by, o.label, { fontFamily:'monospace', fontSize:'16px', color:'#fff', stroke:'#000', strokeThickness:2 }).setOrigin(0.5);
        const zone = this.add.zone(bx, by, 100, 46).setInteractive({ useHandCursor:true });
        zone.on('pointerdown', () => { onToggle(o.key); redraw(o.key); });
        return { bg, lbl, bx, by, key: o.key };
      });
      const redraw = (sel) => boxes.forEach(b => {
        b.bg.clear();
        b.bg.fillStyle(b.key === sel ? 0x142014 : 0x0d0d14, 0.95);
        b.bg.fillRoundedRect(b.bx - 46, b.by - 20, 92, 40, 6);
        b.bg.lineStyle(2, b.key === sel ? 0x88cc44 : 0x222233);
        b.bg.strokeRoundedRect(b.bx - 46, b.by - 20, 92, 40, 6);
        b.lbl.setColor(b.key === sel ? '#aaffaa' : '#888899');
      });
      redraw(initial);
    };

    // ── Gameplay settings ────────────────────────────────────
    this.add.text(W/2, 444, 'GAMEPLAY', {
      fontFamily:'monospace', fontSize:'13px', color:'#556655', letterSpacing: 3,
    }).setOrigin(0.5);

    makeToggle('FOG OF WAR', W/2 - 200, 486, fogOn, (v) => {
      saveSettings({ fogEnabled: v });
    });
    makeToggle('MINIMAP', W/2, 486, s.minimapEnabled !== false, (v) => {
      saveSettings({ minimapEnabled: v });
    });

    // (legacy touch-controls hint — one compact line)
    const btnDefs = [
      { lx: 0, ly: 0, r: 0, col: 0, label: '' },
    ];
    btnDefs.forEach(b => {
      void b; // replaced by new settings above
    });

    // ── Tutorial toggle ──────────────────────────────────────
    this.add.text(W/2, 536, 'TUTORIAL TIPS', {
      fontFamily:'monospace', fontSize:'11px', color:'#445544', letterSpacing: 3,
    }).setOrigin(0.5);

    const tutEnabled = loadSettings().tutorial !== false; // default ON
    this._tutSel = tutEnabled;
    const tutOpts = [
      { key: true,  label: 'ON',  sub: 'Tips appear at top of screen during first game' },
      { key: false, label: 'OFF', sub: 'No tutorial tips — for experienced players' },
    ];
    this._tutBoxes = tutOpts.map((o, i) => {
      const x = W/2 + (i === 0 ? -140 : 140), y = 596;
      const box = this.add.graphics();
      const lbl = this.add.text(x, y, o.label, {
        fontFamily:'monospace', fontSize:'18px', color:'#ffffff', stroke:'#000', strokeThickness:2,
      }).setOrigin(0.5);
      this.add.text(x, y + 22, o.sub, {
        fontFamily:'monospace', fontSize:'9px', color:'#557755', wordWrap:{width:220},
      }).setOrigin(0.5, 0);
      const zone = this.add.zone(x, y + 10, 230, 62).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.setTutorial(o.key));
      zone.on('pointerdown', () => { this.setTutorial(o.key); saveSettings({ tutorial: o.key }); });
      return { box, lbl, x, y, key: o.key };
    });

    // ── Reset tutorial ───────────────────────────────────────
    const resetTutBtn = this.add.text(W/2, H - 88, '[ RESET TUTORIAL ]', {
      fontFamily:'monospace', fontSize:'11px', color:'#556655',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    resetTutBtn.on('pointerover', () => resetTutBtn.setColor('#88cc88'));
    resetTutBtn.on('pointerout',  () => resetTutBtn.setColor('#556655'));
    resetTutBtn.on('pointerdown', () => {
      try { localStorage.removeItem('iw_tutorial_state'); } catch(e) {}
      saveSettings({ tutorial: true });
      this.setTutorial(true);
      this.hint('Tutorial reset — tips will show again next run.', 2500);
      resetTutBtn.setColor('#aaffaa');
      this.time.delayedCall(1200, () => resetTutBtn.setColor('#556655'));
    });

    // ── Rebind controls link ─────────────────────────────────
    const rebindBtn = this.add.text(W/2, H - 60, '[ REBIND CONTROLS ]', {
      fontFamily:'monospace', fontSize:'14px', color:'#8888cc',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    rebindBtn.on('pointerover', () => rebindBtn.setColor('#aaaaff'));
    rebindBtn.on('pointerout',  () => rebindBtn.setColor('#8888cc'));
    rebindBtn.on('pointerdown', () => {
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => {
        this.scene.start('Controls', { returnTo: this._returnTo });
      });
    });

    // ── Back button ──────────────────────────────────────────
    const backLabel = this._returnTo === 'Game' ? '[ BACK TO GAME ]' : '[ BACK TO MAIN MENU ]';
    const backBtn = this.add.text(W/2, H - 22, backLabel, {
      fontFamily:'monospace', fontSize:'18px', color:'#aaffaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerover', () => backBtn.setColor('#ffffff'));
    backBtn.on('pointerout',  () => backBtn.setColor('#aaffaa'));

    const goBack = () => {
      const _s = loadSettings();
      _qlog(`Settings: back  returnTo=${this._returnTo||'menu'}  inputMode=${_s.inputMode||'auto'}  music=${_s.musicEnabled!==false}  sfx=${_s.sfxEnabled!==false}`, 'menu');
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => {
        if (this._returnTo === 'Game') {
          const gameScene = this.scene.get('Game');
          this.scene.stop('Settings');
          this.scene.resume('Game');
          if (gameScene && gameScene.cameras && gameScene.cameras.main) {
            gameScene.cameras.main.fadeIn(300, 0, 0, 0);
          }
        } else {
          this.scene.start('ModeSelect');
        }
      });
    };

    backBtn.on('pointerdown', goBack);
    this.tweens.add({ targets: backBtn, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });

    const K = Phaser.Input.Keyboard.KeyCodes;
    this.input.keyboard.addKey(K.ESC).on('down', goBack);

    this.setInput(curMode);
    this.setTutorial(tutEnabled);
  }

  drawSettingsBox(g, x, y, selected) {
    g.clear();
    g.fillStyle(selected ? 0x142014 : 0x0d0d14, 0.95);
    g.fillRoundedRect(x - 130, y - 46, 260, 90, 8);
    g.lineStyle(2, selected ? 0x88cc44 : 0x222233);
    g.strokeRoundedRect(x - 130, y - 46, 260, 90, 8);
  }

  setInput(key) {
    this._inputSel = key;
    this._inputBoxes.forEach(b => {
      this.drawSettingsBox(b.box, b.x, b.y, b.key === key);
      b.lbl.setColor(b.key === key ? '#aaffaa' : '#888899');
    });
  }

  setTutorial(key) {
    this._tutSel = key;
    if (this._tutBoxes) {
      this._tutBoxes.forEach(b => {
        this.drawSettingsBox(b.box, b.x, b.y, b.key === key);
        b.lbl.setColor(b.key === key ? '#aaffaa' : '#888899');
      });
    }
  }
}

// ── SCENE: CHARACTER SELECT ────────────────────────────────────
class CharSelectScene extends Phaser.Scene {
  constructor() { super('CharSelect'); }

  create() {
    const { W, H } = CFG;
    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.p1Idx = 0; this.p2Idx = 1;
    this.p1Done = false; this.p2Done = false;
    this.solo = STATE.mode === 1;

    this.add.graphics().fillStyle(0x0a0a14).fillRect(0, 0, W, H);

    // Scale the entire card layout proportionally so it fits any canvas size
    // (desktop 1280×720 → S=1.0; mobile 640×360 → S=0.5)
    const S = this._S = Math.min(W / 1280, H / 720);
    const modeLabel = STATE.difficulty === 'hardcore' ? '  ☠ HARDCORE' : '  ♥ SURVIVAL';
    this.add.text(W/2, 34, 'SELECT YOUR SURVIVOR' + (this.solo ? '' : 'S') + modeLabel, {
      fontFamily:'monospace', fontSize: Math.max(14, Math.round(24*S)) + 'px',
      color: STATE.difficulty === 'hardcore' ? '#ff6644' : '#cc8833',
      stroke:'#000', strokeThickness:3,
    }).setOrigin(0.5);

    const hint = this.solo ? 'Click a character  —  or  A/D to pick, F to confirm'
                           : 'Click to pick   |   P1: A/D + F   |   P2: Arrows + /';
    this.add.text(W/2, 66, hint, {
      fontFamily:'monospace', fontSize: Math.max(9, Math.round(13*S)) + 'px', color:'#555566',
    }).setOrigin(0.5);

    const gap = Math.round(14 * S);
    const maxCardW = Math.round(252 * S);
    const cardW = Math.min(maxCardW, Math.floor((W - Math.round(40*S) - gap * (CHARS.length - 1)) / CHARS.length));
    const cardH = Math.round(cardW * (370/252));
    const startX = W/2 - (CHARS.length-1) * ((cardW+gap)/2);
    this.cards = CHARS.map((ch, i) => this.buildCard(ch, startX + i*(cardW+gap), H/2+Math.round(28*S), cardW, cardH, S));

    this.statusText = this.add.text(W/2, H-36, '', {
      fontFamily:'monospace', fontSize: Math.max(10, Math.round(14*S)) + 'px', color:'#aaaaaa',
    }).setOrigin(0.5);

    // Tutorial toggle checkbox — bottom-center, unobtrusive
    const _tutOn = loadSettings().tutorial !== false;
    this._charSelTutOn = _tutOn;
    this._tutCheckTxt = this.add.text(W/2, H - 64, '', {
      fontFamily:'monospace', fontSize: Math.max(9, Math.round(11*S)) + 'px', color:'#557755',
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

    const K = Phaser.Input.Keyboard.KeyCodes;
    const _CB = Object.assign({}, DEFAULT_BINDINGS, loadSettings().bindings || {});
    this.keys = this.input.keyboard.addKeys({
      p1L:K[_CB.p1left], p1R:K[_CB.p1right], p1OK:K[_CB.p1attack],
      p2L:K[_CB.p2left], p2R:K[_CB.p2right], p2OK:K[_CB.p2attack],
    });
    this.keys.p1L.on('down', () => this.nav(1,-1));
    this.keys.p1R.on('down', () => this.nav(1, 1));
    this.keys.p1OK.on('down',() => this.confirm(1));
    this.keys.p2L.on('down', () => this.nav(2,-1));
    this.keys.p2R.on('down', () => this.nav(2, 1));
    this.keys.p2OK.on('down',() => this.confirm(2));

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
    const escKey = this.input.keyboard.addKey(K.ESC);
    const goBack = () => {
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => this.scene.start('ModeSelect'));
    };
    escKey.on('down', goBack);

    this.refresh();
  }

  _updateTutCheck() {
    const on = this._charSelTutOn;
    this._tutCheckTxt.setText((on ? '[\u2714] ' : '[\u00a0\u00a0] ') + 'Show tutorial tips on first game');
  }

  buildCard(ch, cx, cy, cW, cH, S=1) {
    const half = cW/2, hH = cH/2;
    const sc = n => Math.round(n * S);
    const fs = n => Math.max(8, Math.round(n * S)) + 'px';
    const bg = this.add.graphics();
    bg.fillStyle(0x12121e, 0.95);
    bg.fillRoundedRect(cx-half, cy-hH, cW, cH, 8);

    const sprite = this.add.image(cx, cy-hH+sc(60), ch.id).setScale(2.0*S);
    const nameT = this.add.text(cx, cy-hH+sc(130), ch.player, {
      fontFamily:'monospace', fontSize:fs(21),
      color:'#'+ch.color.toString(16).padStart(6,'0'), stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);
    this.add.text(cx, cy-hH+sc(155), ch.title, {
      fontFamily:'monospace', fontSize:fs(13), color:'#777788',
    }).setOrigin(0.5);

    const statNames = ['HP','SPD','ATK','BLD'];
    ch.stats.forEach((val, si) => {
      const sy = cy-hH+sc(184+si*22);
      this.add.text(cx-half+sc(12), sy, statNames[si], { fontFamily:'monospace', fontSize:fs(11), color:'#777788' });
      for (let b=0; b<5; b++) {
        const bar = this.add.graphics();
        bar.fillStyle(b<val ? ch.color : 0x222233);
        bar.fillRect(cx-half+sc(44)+b*sc(19), sy+1, sc(15), sc(11));
      }
    });
    ch.desc.forEach((line, li) => {
      this.add.text(cx, cy+hH-sc(82)+li*sc(22), line, {
        fontFamily:'monospace', fontSize:fs(11), color:'#888899',
        wordWrap:{width:cW-16},
      }).setOrigin(0.5);
    });

    const p1b = this.add.graphics();
    p1b.lineStyle(Math.max(2, sc(3)), 0x4488ff);
    p1b.strokeRoundedRect(cx-half-4, cy-hH-4, cW+8, cH+8, 10);

    const p2b = this.add.graphics();
    p2b.lineStyle(Math.max(2, sc(3)), 0xff8844);
    p2b.strokeRoundedRect(cx-half-8, cy-hH-8, cW+16, cH+16, 12);

    const p1badge = this.add.text(cx, cy+hH-sc(26), '✓ PLAYER 1', {
      fontFamily:'monospace', fontSize:fs(13), color:'#4488ff', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);
    const p2badge = this.add.text(cx, cy+hH-sc(8), '✓ PLAYER 2', {
      fontFamily:'monospace', fontSize:fs(13), color:'#ff8844', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);

    // Clickable hit zone over the whole card
    const zone = this.add.zone(cx, cy, cW, cH).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      // Highlight card on hover for the active player
      const idx = CHARS.indexOf(ch);
      if (!this.p1Done) this.p1Idx = idx;
      else if (!this.p2Done && !this.solo && idx !== this.p1Idx) this.p2Idx = idx;
      this.refresh();
    });
    zone.on('pointerdown', () => {
      const idx = CHARS.indexOf(ch);
      if (!this.p1Done) {
        this.p1Idx = idx;
        this.refresh();
        this.confirm(1);
      } else if (!this.p2Done && !this.solo) {
        if (idx === this.p1Idx) return; // can't pick same char
        this.p2Idx = idx;
        this.refresh();
        this.confirm(2);
      }
    });

    return { bg, sprite, p1b, p2b, p1badge, p2badge };
  }

  nav(player, dir) {
    if (player===1 && !this.p1Done) {
      this.p1Idx = Phaser.Math.Wrap(this.p1Idx+dir, 0, CHARS.length);
      this.refresh();
    }
    if (player===2 && this.p1Done && !this.p2Done && !this.solo) {
      let n = Phaser.Math.Wrap(this.p2Idx+dir, 0, CHARS.length);
      if (n===this.p1Idx) n = Phaser.Math.Wrap(n+dir, 0, CHARS.length);
      this.p2Idx = n; this.refresh();
    }
  }

  confirm(player) {
    if (player===1 && !this.p1Done) {
      this.p1Done = true; STATE.p1CharId = CHARS[this.p1Idx].id;
      if (this.solo) { this.go(); return; }
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

  refresh() {
    this.cards.forEach((c, i) => {
      const p1s = !this.p1Done && i===this.p1Idx, p1l = this.p1Done && i===this.p1Idx;
      const p2s = this.p1Done && !this.p2Done && i===this.p2Idx, p2l = this.p2Done && i===this.p2Idx;
      c.p1b.setVisible(p1s||p1l); c.p2b.setVisible(p2s||p2l);
      c.p1badge.setVisible(p1l);  c.p2badge.setVisible(p2l);
      c.sprite.setScale((p1s||p1l||p2s||p2l ? 3.0 : 2.0) * this._S);
    });
    if (!this.p1Done) this.statusText.setText('Player 1 — A/D to choose, F to confirm');
  }
}
