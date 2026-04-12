// ============================================================
// IRON WASTELAND  |  Local Co-op Survival
// Made for Hudson, Zachary & Jared
// ============================================================
'use strict';

// ── CONSTANTS ─────────────────────────────────────────────────
const CFG = {
  W: 1280, H: 720,
  TILE: 32,
  MAP_W: 220, MAP_H: 220,
  SAFE_R: 10,
  CAM_ZOOM_MAX: 1.0,
  CAM_ZOOM_MIN: 0.25,
  CAM_PAD: 230,
  TREES: 420,
  ROCKS: 180,
  DOWN_TIME: 20,     // seconds before a downed player dies permanently
  REVIVE_TIME: 3,    // seconds to hold interact to revive
  REVIVE_RANGE: 80,  // px to be close enough to revive
  FOG_REVEAL_R: 6,   // tiles radius for fog reveal
  FOG_UPDATE_INTERVAL: 4, // update fog every N frames
};

// ── BIOME SYSTEM ──────────────────────────────────────────────
// Simple seeded hash for value noise
function _biomeHash(x, y) {
  let h = (x * 374761393 + y * 668265263 + 1013904223) | 0;
  h = ((h >> 13) ^ h) * 1274126177;
  h = ((h >> 16) ^ h);
  return (h & 0x7fffffff) / 0x7fffffff; // 0..1
}

function _biomeNoise(tx, ty, scale) {
  const sx = tx / scale, sy = ty / scale;
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const fx = sx - x0, fy = sy - y0;
  const a = _biomeHash(x0, y0), b = _biomeHash(x0+1, y0);
  const c = _biomeHash(x0, y0+1), d = _biomeHash(x0+1, y0+1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy; // 0..1
}

function getBiome(tileX, tileY) {
  const cx = CFG.MAP_W / 2, cy = CFG.MAP_H / 2;
  const dx = tileX - cx, dy = tileY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const noise = _biomeNoise(tileX, tileY, 12) * 8; // organic borders

  // Center = always grasslands
  if (dist < CFG.SAFE_R + 15 + noise * 0.5) return 'grass';

  // Beyond center, assign by quadrant with noise
  const angle = Math.atan2(dy, dx); // -PI..PI
  const n2 = _biomeNoise(tileX + 100, tileY + 100, 18) * 0.6;

  // NW quadrant (-PI..-PI/2) = tundra
  if (angle < -Math.PI / 2 + n2 && angle > -Math.PI + n2) return 'tundra';
  // NE quadrant (-PI/2..0) = ruins
  if (angle < 0 + n2 && angle > -Math.PI / 2 - n2) return 'ruins';
  // SE quadrant (0..PI/2) = swamp
  if (angle > 0 - n2 && angle < Math.PI / 2 + n2) return 'swamp';
  // SW + remaining = wasteland
  return 'waste';
}

// Biome color map for minimap
const BIOME_COLORS = {
  grass:  0x4a7c2f,
  waste:  0x8a7044,
  swamp:  0x2a4a2a,
  tundra: 0xbbccdd,
  ruins:  0x444450,
};

// ── CHARACTER DEFINITIONS ─────────────────────────────────────
const CHARS = [
  {
    id: 'knight', player: 'Hudson', title: 'Iron Knight',
    color: 0x4a6d8c, dark: 0x2d4a63,
    speed: 150, maxHp: 200,
    stats: [5, 3, 4, 2],
    desc: ['Highest HP. Sword & Shield.', 'RALLY: boosts partner speed'],
  },
  {
    id: 'gunslinger', player: 'Zachary', title: 'Gunslinger',
    color: 0xcc8833, dark: 0x7a4a1a,
    speed: 200, maxHp: 120,
    stats: [3, 5, 5, 1],
    desc: ['Fastest. 8-bullet clip (40 max).', 'RELOAD: draw from ammo belt'],
  },
  {
    id: 'architect', player: 'Jared', title: 'The Architect',
    color: 0x3a9a55, dark: 0x1a6030,
    speed: 165, maxHp: 140,
    stats: [3, 3, 2, 5],
    desc: ['Master builder. Wrench melee.', 'ORCHESTRATE: deploy auto-turret'],
  },
];

// Shared state across scenes
const STATE = {
  mode: 2,
  difficulty: 'survival',  // 'survival' | 'hardcore'
  p1CharId: 'knight',
  p2CharId: 'gunslinger',
};

// ── CHIPTUNE MUSIC (Web Audio, no files needed) ───────────────
const Music = {
  ctx: null, gain: null, playing: false, mode: 'day',
  start() {
    if (this.playing) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.07;
      this.gain.connect(this.ctx.destination);
      this.playing = true;
      this.mode = 'day';
      this._dayLoop(this.ctx.currentTime);
    } catch(e) {}
  },
  stop() {
    this.playing = false;
    if (this.ctx) { this.ctx.close(); this.ctx = null; }
  },
  switchToNight() {
    if (this.mode === 'night') return;
    this.mode = 'night';
    // The current loop will naturally end and _nightLoop will take over
  },
  switchToDay() {
    if (this.mode === 'day') return;
    this.mode = 'day';
    this._dawnJingle();
  },
  _note(freq, t, dur, type, vol) {
    if (!this.ctx || !this.playing) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.connect(g); g.connect(this.gain);
    o.type = type || 'square'; o.frequency.value = freq;
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0, now+t);
    g.gain.linearRampToValueAtTime(vol||1, now+t+0.02);
    g.gain.linearRampToValueAtTime(0, now+t+dur-0.02);
    o.start(now+t); o.stop(now+t+dur+0.05);
  },
  _dawnJingle() {
    if (!this.ctx || !this.playing) return;
    // Bright ascending chime — new day!
    const b = 0.15;
    [[523.25,0,b*2,'triangle',0.5],[659.25,b,b*2,'triangle',0.5],
     [783.99,b*2,b*2,'triangle',0.55],[1046.5,b*3,b*3,'triangle',0.6],
     [783.99,b*5,b*1.5,'square',0.3],[1046.5,b*6,b*4,'square',0.35],
    ].forEach(([f,t,d,ty,v]) => this._note(f,t,d,ty,v));
    // Sparkle high notes
    [[1318.5,b*1.5,b,'triangle',0.2],[1568,b*3.5,b*1.5,'triangle',0.2],
     [2093,b*5,b*2,'triangle',0.15],
    ].forEach(([f,t,d,ty,v]) => this._note(f,t,d,ty,v));
  },
  _dayLoop(startAt) {
    if (!this.playing || !this.ctx) return;
    if (this.mode === 'night') { this._nightLoop(this.ctx.currentTime); return; }
    const b = 60/125; // beats at 125 bpm
    const len = b*16;
    const now = this.ctx.currentTime;
    // If browser throttled us and we've fallen behind, snap forward to stay in sync
    if (startAt + len < now) {
      const skips = Math.ceil((now - startAt) / len);
      startAt += skips * len;
    }
    const o = startAt - now;
    // Melody (A minor pentatonic — adventure feel)
    [[220,0,b*.7],[261.63,b,b*.7],[329.63,b*2,b*.35],[293.66,b*2.5,b*.35],
     [261.63,b*3,b*.7],[220,b*4,b*.7],[196,b*5,b*.35],[220,b*5.5,b*.35],
     [261.63,b*6,b*1.4],[329.63,b*8,b*.7],[349.23,b*9,b*.7],
     [329.63,b*10,b*.35],[293.66,b*10.5,b*.35],[261.63,b*11,b*.7],
     [220,b*12,b*1.4],[196,b*14,b*.7],[220,b*15,b*.7]
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'square', 0.55); });
    // Bass
    [[55,0,b*1.8],[55,b*4,b*.8],[49,b*6,b*1.8],[49,b*8,b*.8],
     [43.65,b*10,b*1.8],[49,b*14,b*1.8]
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'sawtooth', 0.7); });
    // High arpeggios
    [[440,0,b*.25],[523.25,b*.5,b*.25],[659.25,b,b*.25],[523.25,b*1.5,b*.25],
     [440,b*2,b*.25],[523.25,b*2.5,b*.25],[659.25,b*3,b*.25],[523.25,b*3.5,b*.25],
     [440,b*4,b*.25],[523.25,b*4.5,b*.25],[587.33,b*5,b*.25],[523.25,b*5.5,b*.25],
     [493.88,b*6,b*.25],[587.33,b*6.5,b*.25],[659.25,b*7,b*.25],[587.33,b*7.5,b*.25],
     [440,b*8,b*.25],[554.37,b*8.5,b*.25],[659.25,b*9,b*.25],[554.37,b*9.5,b*.25],
     [523.25,b*10,b*.25],[622.25,b*10.5,b*.25],[698.46,b*11,b*.25],[622.25,b*11.5,b*.25],
     [392,b*12,b*.25],[493.88,b*12.5,b*.25],[587.33,b*13,b*.25],[493.88,b*13.5,b*.25],
     [440,b*14,b*.25],[523.25,b*14.5,b*.25],[587.33,b*15,b*.25],[523.25,b*15.5,b*.25]
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'triangle', 0.25); });

    // Schedule next loop using audio clock so browser throttling can't cause drift
    const nextStart = startAt + len;
    const delay = Math.max(50, (nextStart - 0.5 - this.ctx.currentTime) * 1000);
    setTimeout(() => this._dayLoop(nextStart), delay);
  },
  _nightLoop(startAt) {
    if (!this.playing || !this.ctx) return;
    if (this.mode === 'day') { this._dayLoop(this.ctx.currentTime); return; }
    const b = 60/80; // slower tempo — 80 bpm, more menacing
    const len = b*16;
    const now = this.ctx.currentTime;
    // Snap forward if browser throttled us
    if (startAt + len < now) {
      const skips = Math.ceil((now - startAt) / len);
      startAt += skips * len;
    }
    const o = startAt - now;
    // Low eerie melody — chromatic, dissonant
    [[110,0,b*1.5],[116.54,b*2,b*1.5],[103.83,b*4,b*1.5],[110,b*6,b*.7],
     [92.5,b*7,b*2],[87.31,b*9,b*1],[98,b*10,b*.5],[92.5,b*10.5,b*.5],
     [87.31,b*11,b*2],[82.41,b*13,b*1.5],[87.31,b*15,b*.7],
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'sawtooth', 0.45); });
    // Rumbling bass drone
    [[36.71,0,b*4],[34.65,b*4,b*4],[32.7,b*8,b*4],[36.71,b*12,b*4],
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'sawtooth', 0.55); });
    // Unsettling high stabs — sparse, sudden
    [[659.25,b*1,b*.12],[698.46,b*5,b*.12],
     [622.25,b*8.5,b*.15],[739.99,b*12,b*.12],[659.25,b*14.5,b*.1],
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'square', 0.2); });
    // Creepy whisper arpeggios — tritone intervals
    [[220,b*0,b*.3],[311.13,b*.5,b*.3],[220,b*1,b*.3],
     [207.65,b*4,b*.3],[293.66,b*4.5,b*.3],[207.65,b*5,b*.3],
     [196,b*8,b*.3],[277.18,b*8.5,b*.3],[196,b*9,b*.3],
     [207.65,b*12,b*.3],[293.66,b*12.5,b*.3],[207.65,b*13,b*.3],
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'triangle', 0.18); });
    // Heartbeat-like pulse
    [[55,b*3,b*.08],[55,b*3.3,b*.08],
     [55,b*7,b*.08],[55,b*7.3,b*.08],
     [55,b*11,b*.08],[55,b*11.3,b*.08],
     [55,b*15,b*.08],[55,b*15.3,b*.08],
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'square', 0.35); });

    // Schedule next loop using audio clock so browser throttling can't cause drift
    const nextStart = startAt + len;
    const delay = Math.max(50, (nextStart - 0.5 - this.ctx.currentTime) * 1000);
    setTimeout(() => this._nightLoop(nextStart), delay);
  },
};

const SFX = {
  _play(freq, type, dur, vol, shape) {
    try {
      const ctx = Music.ctx;
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(Music.gain || ctx.destination);
      o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (shape === 'drop') o.frequency.linearRampToValueAtTime(freq*0.3, ctx.currentTime+dur);
      if (shape === 'rise') o.frequency.linearRampToValueAtTime(freq*2, ctx.currentTime+dur);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime+dur);
      o.start(ctx.currentTime); o.stop(ctx.currentTime+dur+0.01);
    } catch(e) {}
  },
  _noise(dur, vol) {
    try {
      const ctx = Music.ctx; if (!ctx) return;
      const buf = ctx.createBuffer(1, ctx.sampleRate*dur, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i=0;i<d.length;i++) d[i] = (Math.random()*2-1)*vol;
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.connect(g); g.connect(Music.gain || ctx.destination);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime+dur);
      src.start(); src.stop(ctx.currentTime+dur+0.01);
    } catch(e) {}
  },
  sword()  { this._play(300,'square',0.08,0.4,'drop'); this._play(180,'sawtooth',0.12,0.2); },
  wrench() { this._play(220,'square',0.06,0.35,'drop'); this._play(140,'sawtooth',0.1,0.15); },
  shoot()  { this._noise(0.06,0.6); this._play(800,'square',0.04,0.3,'drop'); },
  reload() { this._play(400,'square',0.03,0.2); this._play(600,'square',0.03,0.15); },
  hit()    { this._play(160,'sawtooth',0.08,0.5,'drop'); this._noise(0.05,0.3); },
  playerHurt() { this._play(200,'sawtooth',0.15,0.6,'drop'); },
  enemyDie()   { this._play(120,'square',0.2,0.5,'drop'); this._noise(0.1,0.25); },
};

function drawWolf(g) {
  g.clear();
  g.fillStyle(0x888899); g.fillRect(2, 3, 14, 6);
  g.fillStyle(0x9999aa); g.fillRect(13, 1, 5, 6);
  g.fillStyle(0x777788); g.fillRect(16, 0, 2, 3); g.fillRect(14, 0, 2, 3);
  g.fillStyle(0xbbbbcc); g.fillRect(17, 3, 2, 3);
  g.fillStyle(0x222222); g.fillRect(18, 4, 1, 1);
  g.fillStyle(0xff4400); g.fillRect(16, 2, 1, 1);
  g.fillStyle(0x777788); g.fillRect(3, 8, 2, 3); g.fillRect(7, 8, 2, 3);
  g.fillRect(10, 8, 2, 3); g.fillRect(14, 8, 2, 3);
  g.fillStyle(0x777788); g.fillRect(0, 2, 3, 3);
  g.fillStyle(0xffffff); g.fillRect(0, 2, 2, 2);
  g.generateTexture('wolf', 20, 12);
}

function drawRat(g) {
  g.clear();
  g.fillStyle(0x8b5a2b); g.fillRect(3, 2, 9, 5);
  g.fillStyle(0xaa7744); g.fillRect(10, 1, 4, 5);
  g.fillStyle(0xff9999); g.fillRect(9, 0, 2, 2);
  g.fillStyle(0x333333); g.fillRect(13, 2, 1, 1);
  g.fillStyle(0xff4400); g.fillRect(12, 1, 1, 1);
  g.fillStyle(0x8b5a2b); g.fillRect(3, 6, 2, 2); g.fillRect(6, 6, 2, 2); g.fillRect(9, 6, 2, 2);
  g.fillStyle(0xcc8866); g.fillRect(0, 3, 4, 1); g.fillRect(0, 4, 2, 1);
  g.generateTexture('rat', 15, 9);
}

function drawBear(g) {
  g.clear();
  g.fillStyle(0x6b3a1f); g.fillRect(2, 4, 18, 10);
  g.fillStyle(0x8b5a2b); g.fillRect(14, 2, 8, 8);
  g.fillStyle(0x6b3a1f); g.fillRect(19, 0, 3, 3);
  g.fillStyle(0x6b3a1f); g.fillRect(15, 0, 3, 3);
  g.fillStyle(0xcc9966); g.fillRect(19, 4, 3, 4);
  g.fillStyle(0x111111); g.fillRect(20, 5, 2, 1);
  g.fillStyle(0xff3300); g.fillRect(18, 3, 1, 1);
  g.fillStyle(0x6b3a1f); g.fillRect(2, 13, 4, 4); g.fillRect(8, 13, 4, 4);
  g.fillRect(13, 13, 4, 4); g.fillRect(17, 13, 3, 4);
  g.generateTexture('bear', 24, 18);
}

function getControls(playerNum, charId, isSolo) {
  if (isSolo && playerNum === 1) {
    const map = {
      knight:     ['WASD — Move', 'Mouse — Aim', 'LClick — Sword', 'RClick — Rally', 'Q — Build', 'E — Interact', 'R — Rotate build'],
      gunslinger: ['WASD — Move', 'Mouse — Aim', 'LClick — Shoot', 'RClick — Reload', 'Q — Build', 'E — Interact', 'R — Rotate build'],
      architect:  ['WASD — Move', 'Mouse — Aim', 'LClick — Wrench', 'RClick — Turret', 'Q — Build', 'E — Interact', 'R — Rotate build'],
    };
    return map[charId] || ['WASD — Move'];
  }
  const move    = playerNum === 1 ? 'WASD — Move'         : 'Arrows — Move';
  const atk     = playerNum === 1 ? 'F'                   : '/';
  const atk2    = playerNum === 1 ? 'G'                   : '.';
  const build   = playerNum === 1 ? 'Q'                   : '0';
  const inter   = playerNum === 1 ? 'E'                   : 'Enter';
  const map = {
    knight:     [move, atk+' — Sword', atk2+' — Rally', build+' — Build', inter+' — Interact'],
    gunslinger: [move, atk+' — Shoot', atk2+' — Reload', build+' — Build', inter+' — Interact'],
    architect:  [move, atk+' — Wrench', atk2+' — Turret', build+' — Build', inter+' — Interact'],
  };
  return map[charId] || [move];
}

// ── TEXTURE GENERATION ────────────────────────────────────────
function buildTextures(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });

  // Ground — grass (natural, no grid lines)
  g.clear();
  g.fillStyle(0x4a7c2f); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x55882e); g.fillRect(4, 6, 4, 3); g.fillRect(22, 14, 3, 2); g.fillRect(10, 24, 5, 2);
  g.fillStyle(0x3d6626); g.fillRect(14, 3, 3, 2); g.fillRect(7, 19, 2, 3); g.fillRect(26, 26, 3, 2);
  g.fillStyle(0x5c9433, 0.6); g.fillRect(19, 8, 2, 2); g.fillRect(3, 27, 3, 2); g.fillRect(28, 4, 2, 3);
  g.generateTexture('grass', 32, 32);

  // grass2 — slightly lighter patches
  g.clear();
  g.fillStyle(0x4a7c2f); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x5c9433); g.fillRect(2, 2, 10, 8); g.fillRect(18, 16, 9, 7);
  g.fillStyle(0x3d6626); g.fillRect(8, 18, 6, 5); g.fillRect(24, 5, 5, 4);
  g.fillStyle(0x4a7c2f); g.fillRect(4, 4, 6, 4); g.fillRect(20, 18, 5, 3);
  g.fillStyle(0x55882e); g.fillRect(14, 10, 3, 3); g.fillRect(5, 26, 4, 2);
  g.generateTexture('grass2', 32, 32);

  // grass3 — darker with small dots
  g.clear();
  g.fillStyle(0x3a6622); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x2d5518); g.fillRect(5, 3, 8, 6); g.fillRect(20, 20, 7, 6);
  g.fillStyle(0x447728); g.fillRect(14, 12, 10, 5); g.fillRect(2, 22, 6, 4);
  g.fillStyle(0x233f12); g.fillRect(4, 4, 2, 2); g.fillRect(12, 18, 2, 2);
  g.fillStyle(0x233f12); g.fillRect(24, 8, 2, 2); g.fillRect(28, 26, 2, 2); g.fillRect(8, 28, 2, 2);
  g.fillStyle(0x4a7c2f); g.fillRect(17, 5, 2, 2); g.fillRect(25, 14, 2, 2); g.fillRect(6, 13, 2, 2);
  g.generateTexture('grass3', 32, 32);

  // Bush (16×14, decorative only)
  g.clear();
  g.fillStyle(0x1f5c0f); g.fillCircle(8, 9, 7);
  g.fillStyle(0x2a7a18); g.fillCircle(5, 8, 5); g.fillCircle(11, 8, 5);
  g.fillStyle(0x196010); g.fillCircle(8, 6, 4);
  g.fillStyle(0x3a9a22); g.fillCircle(6, 7, 2); g.fillCircle(10, 6, 2);
  g.fillStyle(0x1a3a0a); g.fillRect(6, 12, 4, 2);
  g.generateTexture('bush', 16, 14);

  // Tree
  g.clear();
  g.fillStyle(0x5c3317); g.fillRect(10, 22, 8, 14);
  g.fillStyle(0x3d2010); g.fillRect(10, 22, 2, 14);
  g.fillStyle(0x1f5c0f); g.fillCircle(14, 16, 12);
  g.fillStyle(0x2d8c1a); g.fillCircle(14, 13, 10);
  g.fillStyle(0x3daa22); g.fillCircle(12, 10, 7);
  g.fillStyle(0x4ec42a); g.fillCircle(15, 7, 5);
  g.generateTexture('tree', 28, 36);

  // Rock
  g.clear();
  g.fillStyle(0x888888); g.fillEllipse(11, 9, 18, 14);
  g.fillStyle(0x6a6a6a); g.fillEllipse(11, 11, 14, 10);
  g.fillStyle(0xaaaaaa); g.fillEllipse(8, 5, 6, 4);
  g.generateTexture('rock', 22, 16);

  // Barracks
  g.clear();
  g.fillStyle(0x556644); g.fillRect(0, 12, 80, 44);
  g.fillStyle(0x445533); g.fillRect(0, 8, 80, 8);
  g.fillStyle(0x334422); g.fillRect(0, 4, 80, 6);
  g.fillStyle(0x223311); g.fillRect(0, 0, 80, 6);
  g.fillStyle(0x667755); g.fillRect(2, 13, 76, 42);
  g.fillStyle(0x1a1a1a); g.fillRect(32, 34, 16, 22);
  g.fillStyle(0x4a3322); g.fillRect(33, 35, 14, 21);
  g.fillStyle(0x8b6914); g.fillRect(33, 43, 6, 3); g.fillRect(41, 43, 6, 3);
  g.fillStyle(0x222222); g.fillRect(44, 46, 2, 2);
  g.fillStyle(0xbbddff, 0.7); g.fillRect(8, 20, 14, 10); g.fillRect(58, 20, 14, 10);
  g.fillStyle(0x334422); g.fillRect(8, 24, 14, 2); g.fillRect(15, 20, 2, 10);
  g.fillStyle(0x334422); g.fillRect(58, 24, 14, 2); g.fillRect(65, 20, 2, 10);
  g.fillStyle(0x884422); g.fillRect(70, 0, 2, 14);
  g.fillStyle(0xcc2222); g.fillRect(72, 0, 10, 8);
  g.fillStyle(0xccaa22);
  for (let a = 0; a < 5; a++) {
    const ang = (a * 72 - 90) * Math.PI / 180;
    g.fillCircle(40 + Math.cos(ang)*7, 30 + Math.sin(ang)*7, 2);
  }
  g.fillCircle(40, 30, 3);
  g.generateTexture('barracks', 80, 56);

  // Characters — all directions & walk frames
  drawKnight(g);       drawKnightStep(g);
  drawKnightFront(g);  drawKnightFrontStep(g);
  drawKnightBack(g);   drawKnightBackStep(g);
  drawGunslinger(g);       drawGunslingerStep(g);
  drawGunslingerFront(g);  drawGunslingerFrontStep(g);
  drawGunslingerBack(g);   drawGunslingerBackStep(g);
  drawArchitect(g);       drawArchitectStep(g);
  drawArchitectFront(g);  drawArchitectFrontStep(g);
  drawArchitectBack(g);   drawArchitectBackStep(g);

  // Bullet
  g.clear();
  g.fillStyle(0xffee44); g.fillRect(2, 1, 6, 2);
  g.fillStyle(0xff9900); g.fillRect(0, 0, 3, 4);
  g.generateTexture('bullet', 8, 4);

  // Ammo icon
  g.clear();
  g.fillStyle(0xffee44); g.fillRect(3, 3, 4, 10);
  g.fillStyle(0xffcc00); g.fillRect(2, 0, 6, 4);
  g.fillStyle(0x777700); g.fillRect(3, 12, 4, 2);
  g.generateTexture('ammo_icon', 10, 14);

  // Resource items
  // Wood
  g.clear();
  g.fillStyle(0x8b5a2b); g.fillRect(1, 2, 10, 4);
  g.fillStyle(0xa67744); g.fillRect(2, 3, 8, 2);
  g.fillStyle(0x6b3a1f); g.fillRect(0, 3, 2, 2); g.fillRect(10, 3, 2, 2);
  g.generateTexture('item_wood', 12, 8);

  // Metal scrap
  g.clear();
  g.fillStyle(0x888899); g.fillRect(1, 1, 8, 6);
  g.fillStyle(0xaaaabb); g.fillRect(2, 2, 4, 3);
  g.fillStyle(0x666677); g.fillRect(6, 0, 4, 3);
  g.generateTexture('item_metal', 10, 8);

  // Fiber (from mutant plants)
  g.clear();
  g.fillStyle(0x44aa33); g.fillRect(0, 1, 2, 6); g.fillRect(4, 0, 2, 7); g.fillRect(8, 2, 2, 5);
  g.fillStyle(0x66cc44); g.fillRect(1, 0, 1, 4); g.fillRect(5, 1, 1, 3); g.fillRect(9, 3, 1, 3);
  g.generateTexture('item_fiber', 10, 8);

  // Ammo pickup
  g.clear();
  g.fillStyle(0xffcc00); g.fillRect(1, 1, 4, 6);
  g.fillStyle(0xffee44); g.fillRect(2, 0, 2, 3);
  g.fillStyle(0xffcc00); g.fillRect(6, 1, 4, 6);
  g.fillStyle(0xffee44); g.fillRect(7, 0, 2, 3);
  g.generateTexture('item_ammo', 10, 8);

  // Food (meat)
  g.clear();
  g.fillStyle(0xcc4433); g.fillEllipse(5, 4, 9, 7);
  g.fillStyle(0xddccbb); g.fillRect(2, 5, 2, 3);
  g.generateTexture('item_food', 10, 8);

  // Buildable structures
  // Wall segment
  g.clear();
  g.fillStyle(0x7a6644); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x665533); g.fillRect(1, 1, 14, 14); g.fillRect(17, 1, 14, 14);
  g.fillStyle(0x665533); g.fillRect(1, 17, 14, 14); g.fillRect(17, 17, 14, 14);
  g.fillStyle(0x8a7654); g.fillRect(2, 2, 12, 12); g.fillRect(18, 2, 12, 12);
  g.fillStyle(0x8a7654); g.fillRect(2, 18, 12, 12); g.fillRect(18, 18, 12, 12);
  g.fillStyle(0x555533); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32);
  g.generateTexture('wall', 32, 32);

  // Campfire
  g.clear();
  g.fillStyle(0x5c3317); g.fillRect(2, 10, 4, 4); g.fillRect(10, 10, 4, 4);
  g.fillRect(6, 12, 4, 2);
  g.fillStyle(0xff6600); g.fillEllipse(8, 8, 8, 10);
  g.fillStyle(0xffaa00); g.fillEllipse(8, 6, 5, 7);
  g.fillStyle(0xffee44); g.fillEllipse(8, 5, 3, 4);
  g.generateTexture('campfire', 16, 14);

  // Crafting bench
  g.clear();
  g.fillStyle(0x6b4422); g.fillRect(0, 6, 24, 12);
  g.fillStyle(0x885533); g.fillRect(1, 7, 22, 10);
  g.fillStyle(0x4a2a0a); g.fillRect(1, 14, 4, 6); g.fillRect(19, 14, 4, 6);
  g.fillStyle(0x888888); g.fillRect(3, 2, 6, 6); // anvil
  g.fillStyle(0xaaaaaa); g.fillRect(4, 0, 4, 3);
  g.fillStyle(0x8b5a2b); g.fillRect(14, 3, 7, 5); // hammer
  g.fillStyle(0x666666); g.fillRect(16, 0, 3, 4);
  g.generateTexture('craftbench', 24, 20);

  // Bed (top-down: wood frame, mattress, pillow, blanket)
  g.clear();
  g.fillStyle(0x5a3010); g.fillRect(0, 0, 40, 28);        // dark wood frame
  g.fillStyle(0xc9a87c); g.fillRect(2, 2, 36, 24);        // inner wood
  g.fillStyle(0x7755aa); g.fillRect(4, 12, 32, 12);       // purple blanket
  g.fillStyle(0x9977cc); g.fillRect(4, 12, 32, 5);        // blanket highlight
  g.fillStyle(0xeeeeff); g.fillRect(6, 4, 14, 9);         // white pillow
  g.fillStyle(0xccccee); g.fillRect(7, 5, 12, 7);         // pillow shadow
  g.fillStyle(0x5a3010); g.fillRect(0, 10, 40, 2);        // headboard/footboard divider
  g.generateTexture('bed', 40, 28);

  // Build ghost (translucent wall preview)
  g.clear();
  g.fillStyle(0x88ff88, 0.4); g.fillRect(0, 0, 32, 32);
  g.lineStyle(2, 0x44ff44, 0.6); g.strokeRect(0, 0, 32, 32);
  g.generateTexture('build_ghost', 32, 32);

  // ── BIOME GROUND TEXTURES ─────────────────────────────────────
  // Wasteland ground — brown/tan
  g.clear();
  g.fillStyle(0x8a7044); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x9a8050); g.fillRect(3, 5, 6, 4); g.fillRect(18, 20, 5, 3);
  g.fillStyle(0x7a6034); g.fillRect(12, 2, 4, 3); g.fillRect(24, 14, 3, 4);
  g.fillStyle(0x6a5028); g.fillRect(8, 16, 3, 2); g.fillRect(26, 6, 3, 2);
  g.fillStyle(0x9a8858); g.fillRect(1, 26, 4, 3); g.fillRect(20, 8, 2, 2);
  g.generateTexture('ground_waste', 32, 32);

  // Swamp ground — dark green/purple
  g.clear();
  g.fillStyle(0x2a4a2a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x1a3a1a); g.fillRect(4, 3, 8, 6); g.fillRect(20, 18, 6, 5);
  g.fillStyle(0x3a2a4a); g.fillRect(14, 10, 6, 4); g.fillRect(2, 22, 5, 3);
  g.fillStyle(0x223322); g.fillRect(8, 28, 3, 2); g.fillRect(26, 4, 2, 3);
  g.fillStyle(0x2a3a2a); g.fillRect(18, 2, 4, 2); g.fillRect(6, 14, 3, 2);
  g.generateTexture('ground_swamp', 32, 32);

  // Tundra ground — white/light blue
  g.clear();
  g.fillStyle(0xccddee); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xddeeff); g.fillRect(2, 4, 8, 5); g.fillRect(18, 16, 7, 6);
  g.fillStyle(0xbbccdd); g.fillRect(10, 12, 5, 4); g.fillRect(24, 4, 4, 3);
  g.fillStyle(0xaabbcc); g.fillRect(4, 24, 3, 2); g.fillRect(20, 8, 2, 2);
  g.fillStyle(0xeef4ff); g.fillRect(14, 26, 4, 3); g.fillRect(6, 8, 2, 2);
  g.generateTexture('ground_tundra', 32, 32);

  // Ruins ground — dark gray stone
  g.clear();
  g.fillStyle(0x444450); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x555560); g.fillRect(0, 0, 15, 15); g.fillRect(17, 17, 15, 15);
  g.fillStyle(0x3a3a44); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32);
  g.fillStyle(0x4a4a55); g.fillRect(3, 3, 10, 10); g.fillRect(19, 19, 10, 10);
  g.fillStyle(0x383844); g.fillRect(8, 22, 4, 3); g.fillRect(22, 6, 3, 2);
  g.generateTexture('ground_ruins', 32, 32);

  // Dead tree — gray trunk, bare branches, no foliage
  g.clear();
  g.fillStyle(0x666666); g.fillRect(11, 16, 6, 20);
  g.fillStyle(0x555555); g.fillRect(11, 16, 2, 20);
  g.fillStyle(0x777777); g.fillRect(8, 8, 3, 10); // left branch
  g.fillStyle(0x666666); g.fillRect(5, 4, 3, 6);
  g.fillStyle(0x777777); g.fillRect(17, 6, 3, 12); // right branch
  g.fillStyle(0x666666); g.fillRect(20, 2, 3, 6);
  g.fillStyle(0x888888); g.fillRect(12, 10, 4, 3); // top stub
  g.fillStyle(0x777777); g.fillRect(13, 6, 2, 5);
  g.generateTexture('tree_dead', 28, 36);

  // Snow tree — green tree with white snow cap
  g.clear();
  g.fillStyle(0x5c3317); g.fillRect(10, 22, 8, 14);
  g.fillStyle(0x3d2010); g.fillRect(10, 22, 2, 14);
  g.fillStyle(0x1a5010); g.fillCircle(14, 16, 12);
  g.fillStyle(0x2a7018); g.fillCircle(14, 13, 10);
  g.fillStyle(0xddeeff); g.fillCircle(14, 8, 9); // snow cap
  g.fillStyle(0xeef4ff); g.fillCircle(12, 6, 6);
  g.fillStyle(0xffffff); g.fillCircle(15, 4, 4);
  g.generateTexture('tree_snow', 28, 36);

  // Mushroom — red/purple cap, replacing bushes in swamp
  g.clear();
  g.fillStyle(0x887766); g.fillRect(6, 10, 4, 6); // stem
  g.fillStyle(0xaa8877); g.fillRect(7, 11, 2, 5);
  g.fillStyle(0xaa2244); g.fillEllipse(8, 8, 14, 10); // cap
  g.fillStyle(0xcc3355); g.fillEllipse(8, 6, 10, 6);
  g.fillStyle(0xffccdd); g.fillCircle(5, 7, 1); g.fillCircle(10, 5, 1); g.fillCircle(8, 9, 1);
  g.generateTexture('mushroom', 16, 16);

  // Broken stone pillar — for ruins biome
  g.clear();
  g.fillStyle(0x777788); g.fillRect(4, 8, 14, 28);
  g.fillStyle(0x888899); g.fillRect(6, 10, 10, 26);
  g.fillStyle(0x666677); g.fillRect(2, 28, 18, 6); // base
  g.fillStyle(0x999aaa); g.fillRect(8, 12, 6, 4); // detail
  // Broken top — jagged
  g.fillStyle(0x777788); g.fillRect(6, 6, 4, 6);
  g.fillStyle(0x888899); g.fillRect(12, 8, 5, 4);
  g.fillStyle(0x666677); g.fillRect(9, 4, 3, 6);
  g.generateTexture('pillar', 22, 36);

  // Toxic pool — green/yellow bubbling
  g.clear();
  g.fillStyle(0x44aa22, 0.8); g.fillEllipse(12, 10, 22, 16);
  g.fillStyle(0x66cc33, 0.7); g.fillEllipse(12, 9, 16, 10);
  g.fillStyle(0x88ee44, 0.6); g.fillEllipse(10, 8, 8, 5);
  g.fillStyle(0xaaff66, 0.5); g.fillCircle(8, 7, 2); g.fillCircle(14, 6, 2);
  g.fillStyle(0xccff88, 0.4); g.fillCircle(11, 5, 1);
  g.generateTexture('toxic_pool', 24, 20);

  // Ice rock — bluish-white
  g.clear();
  g.fillStyle(0x99bbdd); g.fillEllipse(11, 9, 18, 14);
  g.fillStyle(0x88aacc); g.fillEllipse(11, 11, 14, 10);
  g.fillStyle(0xccddee); g.fillEllipse(8, 5, 6, 4);
  g.fillStyle(0xddeeff); g.fillEllipse(6, 4, 3, 2);
  g.generateTexture('ice_rock', 22, 16);

  // Mountain — large impassable rock formation (48x40)
  g.clear();
  g.fillStyle(0x555555); g.fillTriangle(24, 0, 0, 38, 48, 38); // main peak
  g.fillStyle(0x666666); g.fillTriangle(24, 4, 4, 36, 44, 36); // lighter face
  g.fillStyle(0x777777); g.fillTriangle(24, 8, 10, 34, 38, 34); // highlight
  g.fillStyle(0xcccccc); g.fillTriangle(24, 0, 18, 12, 30, 12); // snow cap
  g.fillStyle(0xeeeeee); g.fillTriangle(24, 2, 20, 10, 28, 10); // snow shine
  g.fillStyle(0x444444); g.fillRect(0, 36, 48, 4); // base shadow
  g.generateTexture('mountain', 48, 40);

  // Mountain variant 2 — wider, double peak (56x44)
  g.clear();
  g.fillStyle(0x4a4a4a); g.fillTriangle(18, 2, 0, 42, 36, 42); // left peak
  g.fillStyle(0x555555); g.fillTriangle(38, 0, 20, 42, 56, 42); // right peak
  g.fillStyle(0x666666); g.fillTriangle(18, 6, 6, 38, 30, 38);
  g.fillStyle(0x666666); g.fillTriangle(38, 4, 24, 38, 52, 38);
  g.fillStyle(0xbbbbbb); g.fillTriangle(18, 2, 13, 10, 23, 10); // snow left
  g.fillStyle(0xcccccc); g.fillTriangle(38, 0, 33, 8, 43, 8);   // snow right
  g.fillStyle(0x3a3a3a); g.fillRect(0, 40, 56, 4); // base shadow
  g.generateTexture('mountain2', 56, 44);

  // Supply cache — small chest/crate
  g.clear();
  g.fillStyle(0x8a6622); g.fillRect(2, 4, 20, 14);
  g.fillStyle(0xaa8833); g.fillRect(3, 5, 18, 12);
  g.fillStyle(0x664411); g.fillRect(2, 4, 20, 2); // lid
  g.fillStyle(0xccaa00); g.fillRect(10, 8, 4, 4); // lock
  g.fillStyle(0xeedd22); g.fillRect(11, 9, 2, 2);
  g.generateTexture('supply_cache', 24, 20);

  // Enemy den — dark cave/burrow
  g.clear();
  g.fillStyle(0x443322); g.fillEllipse(16, 18, 30, 20);
  g.fillStyle(0x332211); g.fillEllipse(16, 16, 24, 14);
  g.fillStyle(0x110000); g.fillEllipse(16, 14, 16, 10); // cave opening
  g.fillStyle(0x554433); g.fillRect(2, 20, 28, 8); // ground
  g.fillStyle(0x665544); g.fillRect(4, 22, 4, 4); g.fillRect(24, 22, 4, 4); // rocks
  g.generateTexture('enemy_den', 32, 28);

  // Radio tower
  g.clear();
  g.fillStyle(0x666666); g.fillRect(14, 0, 4, 48); // main pole
  g.fillStyle(0x888888); g.fillRect(8, 6, 16, 2); // crossbar 1
  g.fillStyle(0x888888); g.fillRect(10, 16, 12, 2); // crossbar 2
  g.fillStyle(0x888888); g.fillRect(12, 26, 8, 2); // crossbar 3
  g.fillStyle(0xcc2222); g.fillCircle(16, 2, 3); // red light
  // Guy wires
  g.lineStyle(1, 0x999999, 0.5);
  g.lineBetween(8, 7, 2, 44); g.lineBetween(24, 7, 30, 44);
  g.fillStyle(0x555555); g.fillRect(6, 42, 20, 6); // base
  g.generateTexture('radio_tower', 32, 48);

  // Campsite (pre-built campfire with benches)
  g.clear();
  // Ground circle
  g.fillStyle(0x5a4a2a); g.fillCircle(16, 16, 14);
  g.fillStyle(0x6a5a3a); g.fillCircle(16, 16, 10);
  // Campfire in center
  g.fillStyle(0x5c3317); g.fillRect(12, 14, 3, 3); g.fillRect(17, 14, 3, 3);
  g.fillStyle(0xff6600); g.fillEllipse(16, 13, 6, 8);
  g.fillStyle(0xffaa00); g.fillEllipse(16, 11, 4, 5);
  g.fillStyle(0xffee44); g.fillCircle(16, 10, 2);
  // Log seats
  g.fillStyle(0x5c3317); g.fillRect(4, 10, 6, 3); g.fillRect(22, 10, 6, 3);
  g.fillRect(4, 19, 6, 3); g.fillRect(22, 19, 6, 3);
  g.generateTexture('campsite', 32, 32);

  // Enemy sprites
  drawWolf(g); drawRat(g); drawBear(g);

  g.destroy();
}

function drawKnight(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(3, 26, 7, 4); g.fillRect(12, 26, 7, 4);
  g.fillStyle(0x2d4a63); g.fillRect(3, 17, 7, 10); g.fillRect(12, 17, 7, 10);
  g.fillStyle(0x111111); g.fillRect(2, 16, 18, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x3a5a7a); g.fillRect(8, 9, 6, 7);
  g.fillStyle(0x5588aa); g.fillRect(8, 9, 6, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(0, 8, 3, 9);
  g.fillStyle(0x2244aa); g.fillRect(-1, 8, 4, 10);
  g.fillStyle(0x4466cc); g.fillRect(0, 9, 2, 8);
  g.fillStyle(0xccaa00); g.fillCircle(1, 13, 1);
  g.fillStyle(0x4a6d8c); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 18);
  g.fillStyle(0xdddddd); g.fillRect(22, 4, 1, 16);
  g.fillStyle(0xcc9900); g.fillRect(18, 7, 6, 2);
  g.fillStyle(0x8b6914); g.fillRect(21, 19, 2, 4);
  g.fillStyle(0xffcc99); g.fillRect(8, 5, 6, 4);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 3, 14, 4);
  g.fillStyle(0x080808); g.fillRect(5, 4, 12, 2);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight', 22, 30);
}

function drawGunslinger(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(3, 24, 7, 6); g.fillRect(12, 24, 7, 6);
  g.fillStyle(0x3a5a7a); g.fillRect(3, 16, 7, 9); g.fillRect(12, 16, 7, 9);
  g.fillStyle(0x3d2010); g.fillRect(14, 19, 5, 5);
  g.fillStyle(0x222222); g.fillRect(15, 21, 3, 3);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0xffeedd); g.fillRect(9, 8, 4, 8);
  g.fillStyle(0x9a6622); g.fillRect(2, 8, 3, 9); g.fillRect(17, 8, 3, 9);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0x333333); g.fillRect(19, 11, 8, 3);
  g.fillStyle(0x555555); g.fillRect(20, 9, 5, 5);
  g.fillStyle(0x3d2010); g.fillRect(21, 13, 3, 4);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 6);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 16, 3);
  g.fillStyle(0x553311); g.fillRect(6, 0, 10, 4);
  g.fillStyle(0x7a5533); g.fillRect(6, 0, 10, 1);
  g.generateTexture('gunslinger', 22, 30);
}

function drawArchitect(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(3, 24, 7, 6); g.fillRect(12, 24, 7, 6);
  g.fillStyle(0x334477); g.fillRect(3, 16, 7, 9); g.fillRect(12, 16, 7, 9);
  g.fillStyle(0x445588); g.fillRect(3, 16, 7, 2); g.fillRect(12, 16, 7, 2);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 18, 3);
  g.fillStyle(0xaaaaaa); g.fillRect(5, 14, 2, 5);
  g.fillStyle(0xcc8833); g.fillRect(9, 14, 2, 5);
  g.fillStyle(0x44aaff); g.fillRect(14, 14, 2, 5);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 18, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(18, 8, 2, 8);
  g.fillStyle(0x1a5533); g.fillRect(9, 8, 4, 8);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(21, 3, 3, 16);
  g.fillStyle(0x777777); g.fillRect(19, 2, 7, 4);
  g.fillStyle(0xbbbbbb); g.fillRect(20, 2, 2, 2);
  g.fillStyle(0x3a9a55); g.fillRect(21, 5, 3, 4);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 6);
  g.fillStyle(0x222222); g.fillRect(3, 3, 16, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5);
  g.fillStyle(0xeeee44); g.fillRect(5, 0, 12, 1);
  g.fillStyle(0x666600); g.fillRect(5, 4, 12, 1);
  g.generateTexture('architect', 22, 30);
}

// ── DIRECTIONAL / WALK-CYCLE SPRITES ─────────────────────────

// ── KNIGHT variants ──────────────────────────────────────────
function drawKnightStep(g) {
  g.clear();
  // left leg raised, right leg back
  g.fillStyle(0x1a2d3d); g.fillRect(3, 24, 7, 5); g.fillRect(12, 27, 7, 3);
  g.fillStyle(0x2d4a63); g.fillRect(3, 15, 7, 10); g.fillRect(12, 19, 7, 9);
  g.fillStyle(0x111111); g.fillRect(2, 16, 18, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x3a5a7a); g.fillRect(8, 9, 6, 7);
  g.fillStyle(0x5588aa); g.fillRect(8, 9, 6, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(0, 8, 3, 9);
  g.fillStyle(0x2244aa); g.fillRect(-1, 8, 4, 10);
  g.fillStyle(0x4466cc); g.fillRect(0, 9, 2, 8);
  g.fillStyle(0xccaa00); g.fillCircle(1, 13, 1);
  g.fillStyle(0x4a6d8c); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 18);
  g.fillStyle(0xdddddd); g.fillRect(22, 4, 1, 16);
  g.fillStyle(0xcc9900); g.fillRect(18, 7, 6, 2);
  g.fillStyle(0xffcc99); g.fillRect(8, 5, 6, 4);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 3, 14, 4);
  g.fillStyle(0x080808); g.fillRect(5, 4, 12, 2);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight_step', 22, 30);
}

function drawKnightFront(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(4, 26, 6, 4); g.fillRect(12, 26, 6, 4);
  g.fillStyle(0x2d4a63); g.fillRect(4, 17, 6, 10); g.fillRect(12, 17, 6, 10);
  g.fillStyle(0x111111); g.fillRect(2, 16, 18, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x3a5a7a); g.fillRect(6, 9, 10, 7);
  g.fillStyle(0x5588aa); g.fillRect(6, 9, 10, 2);
  g.fillStyle(0xccaa00); g.fillCircle(11, 13, 1);
  g.fillStyle(0x2244aa); g.fillRect(0, 8, 3, 10);
  g.fillStyle(0x4466cc); g.fillRect(1, 9, 1, 8);
  g.fillStyle(0x4a6d8c); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 14);
  g.fillStyle(0xcc9900); g.fillRect(18, 7, 6, 2);
  g.fillStyle(0xffcc99); g.fillRect(8, 5, 6, 4);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 2, 14, 5);
  g.fillStyle(0x080808); g.fillRect(5, 3, 12, 2);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight_front', 22, 30);
}

function drawKnightFrontStep(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(4, 24, 6, 5); g.fillRect(12, 27, 6, 3);
  g.fillStyle(0x2d4a63); g.fillRect(4, 15, 6, 10); g.fillRect(12, 19, 6, 9);
  g.fillStyle(0x111111); g.fillRect(2, 16, 18, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x3a5a7a); g.fillRect(6, 9, 10, 7);
  g.fillStyle(0x5588aa); g.fillRect(6, 9, 10, 2);
  g.fillStyle(0xccaa00); g.fillCircle(11, 13, 1);
  g.fillStyle(0x2244aa); g.fillRect(0, 8, 3, 10);
  g.fillStyle(0x4466cc); g.fillRect(1, 9, 1, 8);
  g.fillStyle(0x4a6d8c); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 14);
  g.fillStyle(0xcc9900); g.fillRect(18, 7, 6, 2);
  g.fillStyle(0xffcc99); g.fillRect(8, 5, 6, 4);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 2, 14, 5);
  g.fillStyle(0x080808); g.fillRect(5, 3, 12, 2);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight_front_step', 22, 30);
}

function drawKnightBack(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(4, 26, 6, 4); g.fillRect(12, 26, 6, 4);
  g.fillStyle(0x2d4a63); g.fillRect(4, 17, 6, 10); g.fillRect(12, 17, 6, 10);
  g.fillStyle(0x111111); g.fillRect(2, 16, 18, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x2d4a63); g.fillRect(6, 9, 10, 7);
  g.fillStyle(0x1a2d3d); g.fillRect(10, 9, 2, 7);
  g.fillStyle(0x4a6d8c); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 14);
  g.fillStyle(0xcc9900); g.fillRect(18, 7, 6, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 1, 14, 6);
  g.fillStyle(0x1a2d3d); g.fillRect(10, 0, 2, 8);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight_back', 22, 30);
}

function drawKnightBackStep(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(4, 24, 6, 5); g.fillRect(12, 27, 6, 3);
  g.fillStyle(0x2d4a63); g.fillRect(4, 15, 6, 10); g.fillRect(12, 19, 6, 9);
  g.fillStyle(0x111111); g.fillRect(2, 16, 18, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x2d4a63); g.fillRect(6, 9, 10, 7);
  g.fillStyle(0x1a2d3d); g.fillRect(10, 9, 2, 7);
  g.fillStyle(0x4a6d8c); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 14);
  g.fillStyle(0xcc9900); g.fillRect(18, 7, 6, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 1, 14, 6);
  g.fillStyle(0x1a2d3d); g.fillRect(10, 0, 2, 8);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight_back_step', 22, 30);
}

// ── GUNSLINGER variants ───────────────────────────────────────
function drawGunslingerStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(3, 23, 7, 6); g.fillRect(12, 26, 7, 4);
  g.fillStyle(0x3a5a7a); g.fillRect(3, 15, 7, 9); g.fillRect(12, 18, 7, 9);
  g.fillStyle(0x3d2010); g.fillRect(14, 19, 5, 5);
  g.fillStyle(0x222222); g.fillRect(15, 21, 3, 3);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0xffeedd); g.fillRect(9, 8, 4, 8);
  g.fillStyle(0x9a6622); g.fillRect(2, 8, 3, 9); g.fillRect(17, 8, 3, 9);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0x333333); g.fillRect(19, 11, 8, 3);
  g.fillStyle(0x555555); g.fillRect(20, 9, 5, 5);
  g.fillStyle(0x3d2010); g.fillRect(21, 13, 3, 4);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 6);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 16, 3);
  g.fillStyle(0x553311); g.fillRect(6, 0, 10, 4);
  g.fillStyle(0x7a5533); g.fillRect(6, 0, 10, 1);
  g.generateTexture('gunslinger_step', 22, 30);
}

function drawGunslingerFront(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(4, 24, 6, 6); g.fillRect(12, 24, 6, 6);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 16, 6, 9); g.fillRect(12, 16, 6, 9);
  g.fillStyle(0x3d2010); g.fillRect(14, 18, 4, 5);
  g.fillStyle(0x222222); g.fillRect(15, 20, 3, 3);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0xffeedd); g.fillRect(8, 8, 6, 8);
  g.fillStyle(0x9a6622); g.fillRect(2, 15, 18, 2);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0x333333); g.fillRect(19, 11, 4, 3);
  g.fillStyle(0x555555); g.fillRect(20, 9, 3, 5);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 6);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 16, 3);
  g.fillStyle(0x553311); g.fillRect(5, 0, 12, 4);
  g.fillStyle(0x7a5533); g.fillRect(5, 0, 12, 1);
  g.generateTexture('gunslinger_front', 22, 30);
}

function drawGunslingerFrontStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(4, 23, 6, 6); g.fillRect(12, 26, 6, 4);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 15, 6, 9); g.fillRect(12, 18, 6, 9);
  g.fillStyle(0x3d2010); g.fillRect(14, 18, 4, 5);
  g.fillStyle(0x222222); g.fillRect(15, 20, 3, 3);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0xffeedd); g.fillRect(8, 8, 6, 8);
  g.fillStyle(0x9a6622); g.fillRect(2, 15, 18, 2);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0x333333); g.fillRect(19, 11, 4, 3);
  g.fillStyle(0x555555); g.fillRect(20, 9, 3, 5);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 6);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 16, 3);
  g.fillStyle(0x553311); g.fillRect(5, 0, 12, 4);
  g.fillStyle(0x7a5533); g.fillRect(5, 0, 12, 1);
  g.generateTexture('gunslinger_front_step', 22, 30);
}

function drawGunslingerBack(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(4, 24, 6, 6); g.fillRect(12, 24, 6, 6);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 16, 6, 9); g.fillRect(12, 16, 6, 9);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x9a5511); g.fillRect(6, 8, 10, 9);
  g.fillStyle(0xaa6622); g.fillRect(2, 12, 18, 2);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 5);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 16, 3);
  g.fillStyle(0x553311); g.fillRect(5, 0, 12, 4);
  g.fillStyle(0x3d2010); g.fillRect(7, 0, 8, 3);
  g.generateTexture('gunslinger_back', 22, 30);
}

function drawGunslingerBackStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(4, 23, 6, 6); g.fillRect(12, 26, 6, 4);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 15, 6, 9); g.fillRect(12, 18, 6, 9);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x9a5511); g.fillRect(6, 8, 10, 9);
  g.fillStyle(0xaa6622); g.fillRect(2, 12, 18, 2);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 5);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 16, 3);
  g.fillStyle(0x553311); g.fillRect(5, 0, 12, 4);
  g.fillStyle(0x3d2010); g.fillRect(7, 0, 8, 3);
  g.generateTexture('gunslinger_back_step', 22, 30);
}

// ── ARCHITECT variants ────────────────────────────────────────
function drawArchitectStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(3, 23, 7, 6); g.fillRect(12, 26, 7, 4);
  g.fillStyle(0x334477); g.fillRect(3, 15, 7, 9); g.fillRect(12, 18, 7, 9);
  g.fillStyle(0x445588); g.fillRect(3, 15, 7, 2); g.fillRect(12, 18, 7, 2);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 18, 3);
  g.fillStyle(0xaaaaaa); g.fillRect(5, 14, 2, 5);
  g.fillStyle(0xcc8833); g.fillRect(9, 14, 2, 5);
  g.fillStyle(0x44aaff); g.fillRect(14, 14, 2, 5);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 18, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(18, 8, 2, 8);
  g.fillStyle(0x1a5533); g.fillRect(9, 8, 4, 8);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(21, 3, 3, 16);
  g.fillStyle(0x777777); g.fillRect(19, 2, 7, 4);
  g.fillStyle(0xbbbbbb); g.fillRect(20, 2, 2, 2);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 6);
  g.fillStyle(0x222222); g.fillRect(3, 3, 16, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5);
  g.fillStyle(0xeeee44); g.fillRect(5, 0, 12, 1);
  g.fillStyle(0x666600); g.fillRect(5, 4, 12, 1);
  g.generateTexture('architect_step', 22, 30);
}

function drawArchitectFront(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(4, 24, 6, 6); g.fillRect(12, 24, 6, 6);
  g.fillStyle(0x334477); g.fillRect(4, 16, 6, 9); g.fillRect(12, 16, 6, 9);
  g.fillStyle(0x445588); g.fillRect(4, 16, 6, 2); g.fillRect(12, 16, 6, 2);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 18, 3);
  g.fillStyle(0xaaaaaa); g.fillRect(4, 14, 2, 5);
  g.fillStyle(0xcc8833); g.fillRect(9, 14, 2, 5);
  g.fillStyle(0x44aaff); g.fillRect(14, 14, 2, 5);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 18, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(18, 8, 2, 8);
  g.fillStyle(0x1a5533); g.fillRect(8, 8, 6, 8);
  g.fillStyle(0xffcc00); g.fillRect(3, 11, 5, 1); g.fillRect(14, 11, 5, 1);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(21, 8, 3, 8);
  g.fillStyle(0x777777); g.fillRect(20, 7, 5, 3);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 6);
  g.fillStyle(0x222222); g.fillRect(3, 3, 16, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5);
  g.fillStyle(0xeeee44); g.fillRect(5, 0, 12, 1);
  g.fillStyle(0x666600); g.fillRect(3, 4, 16, 1);
  g.generateTexture('architect_front', 22, 30);
}

function drawArchitectFrontStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(4, 23, 6, 6); g.fillRect(12, 26, 6, 4);
  g.fillStyle(0x334477); g.fillRect(4, 15, 6, 9); g.fillRect(12, 18, 6, 9);
  g.fillStyle(0x445588); g.fillRect(4, 15, 6, 2); g.fillRect(12, 18, 6, 2);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 18, 3);
  g.fillStyle(0xaaaaaa); g.fillRect(4, 14, 2, 5);
  g.fillStyle(0xcc8833); g.fillRect(9, 14, 2, 5);
  g.fillStyle(0x44aaff); g.fillRect(14, 14, 2, 5);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 18, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(18, 8, 2, 8);
  g.fillStyle(0x1a5533); g.fillRect(8, 8, 6, 8);
  g.fillStyle(0xffcc00); g.fillRect(3, 11, 5, 1); g.fillRect(14, 11, 5, 1);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(21, 8, 3, 8);
  g.fillStyle(0x777777); g.fillRect(20, 7, 5, 3);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 6);
  g.fillStyle(0x222222); g.fillRect(3, 3, 16, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5);
  g.fillStyle(0xeeee44); g.fillRect(5, 0, 12, 1);
  g.fillStyle(0x666600); g.fillRect(3, 4, 16, 1);
  g.generateTexture('architect_front_step', 22, 30);
}

function drawArchitectBack(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(4, 24, 6, 6); g.fillRect(12, 24, 6, 6);
  g.fillStyle(0x334477); g.fillRect(4, 16, 6, 9); g.fillRect(12, 16, 6, 9);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 18, 3);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 18, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(18, 8, 2, 8);
  g.fillStyle(0x2a7a45); g.fillRect(8, 8, 6, 8);
  g.fillStyle(0xffcc00); g.fillRect(3, 11, 16, 1);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(21, 5, 3, 12);
  g.fillStyle(0x777777); g.fillRect(20, 4, 5, 3);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 5);
  g.fillStyle(0x222222); g.fillRect(3, 3, 16, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5);
  g.fillStyle(0xaa9900); g.fillRect(6, 1, 10, 3);
  g.fillStyle(0x666600); g.fillRect(5, 4, 12, 1);
  g.generateTexture('architect_back', 22, 30);
}

function drawArchitectBackStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(4, 23, 6, 6); g.fillRect(12, 26, 6, 4);
  g.fillStyle(0x334477); g.fillRect(4, 15, 6, 9); g.fillRect(12, 18, 6, 9);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 18, 3);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 18, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(18, 8, 2, 8);
  g.fillStyle(0x2a7a45); g.fillRect(8, 8, 6, 8);
  g.fillStyle(0xffcc00); g.fillRect(3, 11, 16, 1);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(21, 5, 3, 12);
  g.fillStyle(0x777777); g.fillRect(20, 4, 5, 3);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 6, 5);
  g.fillStyle(0x222222); g.fillRect(3, 3, 16, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5);
  g.fillStyle(0xaa9900); g.fillRect(6, 1, 10, 3);
  g.fillStyle(0x666600); g.fillRect(5, 4, 12, 1);
  g.generateTexture('architect_back_step', 22, 30);
}

// ── SCENE: BOOT ───────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  create() { buildTextures(this); this.scene.start('ModeSelect'); }
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
    this.selMode = mode;
    this.pBoxes.forEach(b => {
      this.drawBox(b.box, b.x, b.y, b.mode === mode, 0x6699ff, false);
      b.lbl.setColor(b.mode === mode ? '#88aaff' : '#aaaaaa');
    });
    this.updatePrompt();
  }

  setDiff(diff) {
    this.selDiff = diff;
    const cols = { survival: 0x33cc55, hardcore: 0xff4444 };
    this.dBoxes.forEach(b => {
      this.drawBox(b.box, b.x, b.y, b.diff === diff, cols[b.diff], true);
      b.lbl.setColor(b.diff === diff ? (diff === 'hardcore' ? '#ff6666' : '#55ee77') : '#aaaaaa');
    });
    this.updatePrompt();
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
    Music.start();
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.time.delayedCall(300, () => this.scene.start('CharSelect'));
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

    const modeLabel = STATE.difficulty === 'hardcore' ? '  ☠ HARDCORE' : '  ♥ SURVIVAL';
    this.add.text(W/2, 34, 'SELECT YOUR SURVIVOR' + (this.solo ? '' : 'S') + modeLabel, {
      fontFamily:'monospace', fontSize:'24px', color: STATE.difficulty === 'hardcore' ? '#ff6644' : '#cc8833',
      stroke:'#000', strokeThickness:3,
    }).setOrigin(0.5);

    const hint = this.solo ? 'Click a character  —  or  A/D to pick, F to confirm'
                           : 'Click to pick   |   P1: A/D + F   |   P2: Arrows + /';
    this.add.text(W/2, 66, hint, {
      fontFamily:'monospace', fontSize:'13px', color:'#555566',
    }).setOrigin(0.5);

    const cardW = 252, cardH = 370;
    const startX = W/2 - (CHARS.length-1) * ((cardW+18)/2);
    this.cards = CHARS.map((ch, i) => this.buildCard(ch, startX + i*(cardW+18), H/2+28, cardW, cardH));

    this.statusText = this.add.text(W/2, H-36, '', {
      fontFamily:'monospace', fontSize:'14px', color:'#aaaaaa',
    }).setOrigin(0.5);

    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = this.input.keyboard.addKeys({
      p1L:K.A, p1R:K.D, p1OK:K.F,
      p2L:K.LEFT, p2R:K.RIGHT, p2OK:K.FORWARD_SLASH,
    });
    this.keys.p1L.on('down', () => this.nav(1,-1));
    this.keys.p1R.on('down', () => this.nav(1, 1));
    this.keys.p1OK.on('down',() => this.confirm(1));
    this.keys.p2L.on('down', () => this.nav(2,-1));
    this.keys.p2R.on('down', () => this.nav(2, 1));
    this.keys.p2OK.on('down',() => this.confirm(2));
    this.refresh();
  }

  buildCard(ch, cx, cy, cW, cH) {
    const half = cW/2, hH = cH/2;
    const bg = this.add.graphics();
    bg.fillStyle(0x12121e, 0.95);
    bg.fillRoundedRect(cx-half, cy-hH, cW, cH, 8);

    const sprite = this.add.image(cx, cy-hH+60, ch.id).setScale(4.0);
    const nameT = this.add.text(cx, cy-hH+130, ch.player, {
      fontFamily:'monospace', fontSize:'21px',
      color:'#'+ch.color.toString(16).padStart(6,'0'), stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);
    this.add.text(cx, cy-hH+155, ch.title, {
      fontFamily:'monospace', fontSize:'13px', color:'#777788',
    }).setOrigin(0.5);

    const statNames = ['HP','SPD','ATK','BLD'];
    ch.stats.forEach((val, si) => {
      const sy = cy-hH+184+si*22;
      this.add.text(cx-half+12, sy, statNames[si], { fontFamily:'monospace', fontSize:'11px', color:'#777788' });
      for (let b=0; b<5; b++) {
        const bar = this.add.graphics();
        bar.fillStyle(b<val ? ch.color : 0x222233);
        bar.fillRect(cx-half+44+b*19, sy+1, 15, 11);
      }
    });
    ch.desc.forEach((line, li) => {
      this.add.text(cx, cy+hH-82+li*22, line, {
        fontFamily:'monospace', fontSize:'11px', color:'#888899',
        wordWrap:{width:cW-16},
      }).setOrigin(0.5);
    });

    const p1b = this.add.graphics();
    p1b.lineStyle(3, 0x4488ff);
    p1b.strokeRoundedRect(cx-half-4, cy-hH-4, cW+8, cH+8, 10);

    const p2b = this.add.graphics();
    p2b.lineStyle(3, 0xff8844);
    p2b.strokeRoundedRect(cx-half-8, cy-hH-8, cW+16, cH+16, 12);

    const p1badge = this.add.text(cx, cy+hH-26, '✓ PLAYER 1', {
      fontFamily:'monospace', fontSize:'13px', color:'#4488ff', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);
    const p2badge = this.add.text(cx, cy+hH-8, '✓ PLAYER 2', {
      fontFamily:'monospace', fontSize:'13px', color:'#ff8844', stroke:'#000', strokeThickness:2,
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
      c.sprite.setScale(p1s||p1l||p2s||p2l ? 4.5 : 4.0);
    });
    if (!this.p1Done) this.statusText.setText('Player 1 — A/D to choose, F to confirm');
  }
}

// ── SCENE: GAME ───────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    const worldW = CFG.MAP_W * CFG.TILE, worldH = CFG.MAP_H * CFG.TILE;
    const cx = worldW/2, cy = worldH/2;

    this.solo        = STATE.mode === 1;
    this.hardcore    = STATE.difficulty === 'hardcore';
    this.isOver      = false;
    this.timeAlive   = 0;
    this.barrackOpen = false;
    this.barrackOwner = null;
    this.barrackSel  = 0;
    this.controlsVis = false;
    this.fogRevealMult = 1; // doubled permanently when Radio Tower is activated
    this.reviveProgress = 0;
    this.reviving    = false;
    this.reviveTarget = null;
    this._toxicCd1   = 0;
    this._toxicCd2   = 0;

    // Two-camera tracking lists
    this._wo = []; this._ho = [];
    this._w = o => { this._wo.push(o); return o; };
    this._h = o => { this._ho.push(o); return o; };

    // Day/night state
    this.dayNum = 1; this.dayTimer = 0; this.DAY_DUR = 150000; this.isNight = false;

    // Build system state
    this.buildMode = false;
    this.buildGhost = null;
    this.builtWalls = [];
    this.craftBenchPlaced = false;
    this.beds = [];
    this.sleepSpeedMult = 1;   // 8x when all players are sleeping through night

    this.cameras.main.fadeIn(600, 0, 0, 0);
    this.physics.world.setBounds(0, 0, worldW, worldH);

    this.buildWorld(worldW, worldH, cx, cy);

    const p1Ch = CHARS.find(c => c.id === STATE.p1CharId);
    const p2Ch = this.solo ? null : CHARS.find(c => c.id === STATE.p2CharId);

    this.p1 = this.spawnPlayer(cx-55, cy, p1Ch, 1);
    this.p2 = this.solo ? null : this.spawnPlayer(cx+55, cy, p2Ch, 2);

    this.physics.add.collider(this.p1.spr, this.obstacles);
    if (this.p2) {
      this.physics.add.collider(this.p2.spr, this.obstacles);
      this.physics.add.collider(this.p1.spr, this.p2.spr);
    }

    // Setup crate pickups now that players exist
    this.setupCratePickups();

    // Setup toxic pool damage overlaps
    if (this.toxicPools) {
      this.toxicPools.forEach(pool => {
        this.physics.add.overlap(this.p1.spr, pool, () => {
          if (!this._toxicCd1 || this._toxicCd1 <= 0) {
            this.p1.hp = Math.max(0, this.p1.hp - 3);
            this._toxicCd1 = 500;
            this.p1.spr.setTint(0x44ff22);
            this.time.delayedCall(150, () => { if(this.p1.spr.active) this.p1.spr.clearTint(); });
          }
        });
        if (this.p2) {
          this.physics.add.overlap(this.p2.spr, pool, () => {
            if (!this._toxicCd2 || this._toxicCd2 <= 0) {
              this.p2.hp = Math.max(0, this.p2.hp - 3);
              this._toxicCd2 = 500;
              this.p2.spr.setTint(0x44ff22);
              this.time.delayedCall(150, () => { if(this.p2.spr.active) this.p2.spr.clearTint(); });
            }
          });
        }
      });
    }

    // Input
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.wasd    = this.input.keyboard.addKeys({ up:K.W, down:K.S, left:K.A, right:K.D });
    this.cursors = this.input.keyboard.createCursorKeys();
    this.hotkeys = this.input.keyboard.addKeys({ p1use:K.E, p2use:K.ENTER, tab:K.TAB, esc:K.ESC });

    this.hotkeys.p1use.on('down', () => { if (!this.barrackOpen && !this.isOver) this.tryInteract(this.p1); });
    if (this.p2) this.hotkeys.p2use.on('down', () => { if (!this.barrackOpen && !this.isOver) this.tryInteract(this.p2); });
    this.hotkeys.tab.on('down', () => this.toggleControls());
    this.hotkeys.esc.on('down', () => { this.closeBarrack(); if (this.controlsVis) this.toggleControls(); });

    // Barracks navigation keys
    this.bKeys = this.input.keyboard.addKeys({ L:K.A, R:K.D, La:K.LEFT, Ra:K.RIGHT, ok1:K.F, ok2:K.FORWARD_SLASH });
    this.bKeys.L.on('down',  () => { if (this.barrackOpen) this.barrackNav(-1); });
    this.bKeys.R.on('down',  () => { if (this.barrackOpen) this.barrackNav( 1); });
    this.bKeys.La.on('down', () => { if (this.barrackOpen) this.barrackNav(-1); });
    this.bKeys.Ra.on('down', () => { if (this.barrackOpen) this.barrackNav( 1); });
    this.bKeys.ok1.on('down',() => { if (this.barrackOpen) this.barrackConfirm(); });
    this.bKeys.ok2.on('down',() => { if (this.barrackOpen) this.barrackConfirm(); });

    // Attack keys
    this.atkKeys = this.input.keyboard.addKeys({
      p1atk: K.F, p1alt: K.G, p1build: K.Q,
      p2atk: K.FORWARD_SLASH, p2alt: K.PERIOD, p2build: K.ZERO,
    });
    this.atkKeys.p1atk.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p1.isDowned && !this.p1.isSleeping) { if (this.buildMode && this.buildOwner===this.p1) this.placeBuild(); else this.doAttack(this.p1); }});
    this.atkKeys.p1alt.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p1.isDowned && !this.p1.isSleeping) this.doAlt(this.p1); });
    this.atkKeys.p1build.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p1.isDowned && !this.p1.isSleeping) this.toggleBuildMode(this.p1); });
    if (this.p2) {
      this.atkKeys.p2atk.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p2.isDowned && !this.p2.isSleeping) { if (this.buildMode && this.buildOwner===this.p2) this.placeBuild(); else this.doAttack(this.p2); }});
      this.atkKeys.p2alt.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p2.isDowned && !this.p2.isSleeping) this.doAlt(this.p2); });
      this.atkKeys.p2build.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p2.isDowned && !this.p2.isSleeping) this.toggleBuildMode(this.p2); });
    }

    // Mouse controls for 1P mode
    if (this.solo) {
      this.input.on('pointerdown', (pointer) => {
        if (this.barrackOpen || this.isOver || this.p1.isDowned || this.p1.isSleeping) return;
        if (pointer.leftButtonDown()) {
          if (this.buildMode && this.buildOwner === this.p1) this.placeBuild();
          else this.doAttack(this.p1);
        }
        if (pointer.rightButtonDown()) {
          this.doAlt(this.p1);
        }
      });
      // Disable context menu on right-click
      this.input.mouse.disableContextMenu();
    }

    // Camera
    if (this.solo) {
      this.cameras.main.startFollow(this.p1.spr, true, 0.1, 0.1);
      this.cameras.main.setZoom(CFG.CAM_ZOOM_MAX);
    } else {
      this.cameras.main.setZoom(0.8);
      this.cameras.main.centerOn(cx, cy);
    }

    this.buildHUD();
    this.buildControlsOverlay();
    this.buildBarrackOverlay();
    this.buildReviveBar();

    // Set up HUD camera (fixed zoom=1, no scroll)
    this.hudCam = this.cameras.add(0, 0, CFG.W, CFG.H).setZoom(1).setName('hud');
    this.cameras.main.ignore(this._ho);
    this.hudCam.ignore(this._wo);
    this.hudCam.ignore(this.obstacles.getChildren());

    // Spawn enemies after camera setup
    this.spawnEnemies(worldW, worldH, cx, cy);

    // Opening hints (delayed to appear after the startup controls popup fades)
    const modeNote = this.hardcore ? '\u2620 HARDCORE \u2014 death is permanent!' : '\u2665 SURVIVAL mode';
    this.time.delayedCall(10000, () => this.hint(modeNote + ' Explore the biomes! Watch your minimap.', 5000));
    this.time.delayedCall(16500, () => this.hint('TAB for controls  |  Beware toxic swamps and frozen tundra!', 3500));

    this.showStartupControls();
  }

  showStartupControls() {
    const { W, H } = CFG;
    const objs = [];
    const push = o => { objs.push(o); this._h(o); return o; };

    // Dim backdrop
    const bg = push(this.add.graphics().setDepth(200));
    bg.fillStyle(0x000000, 0.75);
    bg.fillRect(0, 0, W, H);

    push(this.add.text(W/2, 34, 'IRON WASTELAND', {
      fontFamily:'monospace', fontSize:'22px', color:'#cc8833', stroke:'#000', strokeThickness:4,
    }).setOrigin(0.5).setDepth(201));

    const p1Ch = this.p1.charData;
    const p2Ch = this.p2 ? this.p2.charData : null;

    // ── P1 panel ──
    const p1Lines = getControls(1, p1Ch.id, this.solo);
    const p1Title = this.solo
      ? p1Ch.player + ' — ' + p1Ch.title + '  (1 Player)'
      : p1Ch.player + ' — ' + p1Ch.title + '  (Player 1)';
    const p1PanelW = 280, p1PanelH = p1Lines.length * 22 + 70;
    const p1X = this.solo ? W/2 - p1PanelW/2 : W/2 - p1PanelW - 20;
    const p1Y = H/2 - p1PanelH/2;

    const p1bg = push(this.add.graphics().setDepth(200));
    p1bg.fillStyle(0x000e22, 0.92);
    p1bg.fillRoundedRect(p1X, p1Y, p1PanelW, p1PanelH, 10);
    p1bg.lineStyle(2, 0x3355aa, 0.9);
    p1bg.strokeRoundedRect(p1X, p1Y, p1PanelW, p1PanelH, 10);

    push(this.add.text(p1X + p1PanelW/2, p1Y + 16, p1Title, {
      fontFamily:'monospace', fontSize:'11px', color:'#88aaff', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5).setDepth(201));

    if (this.solo) {
      push(this.add.text(p1X + p1PanelW/2, p1Y + 34, 'Mouse = aim & shoot direction', {
        fontFamily:'monospace', fontSize:'9px', color:'#aaccee', stroke:'#000', strokeThickness:2,
      }).setOrigin(0.5).setDepth(201));
    }

    p1Lines.forEach((l, i) => {
      push(this.add.text(p1X + 16, p1Y + (this.solo ? 50 : 38) + i * 22, l, {
        fontFamily:'monospace', fontSize:'10px', color:'#ccd8ee', stroke:'#000', strokeThickness:2,
      }).setDepth(201));
    });

    // ── P2 panel (2P mode only) ──
    if (p2Ch) {
      const p2Lines = getControls(2, p2Ch.id);
      const p2Title = p2Ch.player + ' — ' + p2Ch.title + '  (Player 2)';
      const p2PanelW = 280, p2PanelH = p2Lines.length * 22 + 58;
      const p2X = W/2 + 20;
      const p2Y = H/2 - p2PanelH/2;

      const p2bg = push(this.add.graphics().setDepth(200));
      p2bg.fillStyle(0x22000e, 0.92);
      p2bg.fillRoundedRect(p2X, p2Y, p2PanelW, p2PanelH, 10);
      p2bg.lineStyle(2, 0xaa5522, 0.9);
      p2bg.strokeRoundedRect(p2X, p2Y, p2PanelW, p2PanelH, 10);

      push(this.add.text(p2X + p2PanelW/2, p2Y + 16, p2Title, {
        fontFamily:'monospace', fontSize:'11px', color:'#ffbb77', stroke:'#000', strokeThickness:2,
      }).setOrigin(0.5).setDepth(201));

      p2Lines.forEach((l, i) => {
        push(this.add.text(p2X + 16, p2Y + 38 + i * 22, l, {
          fontFamily:'monospace', fontSize:'10px', color:'#eeddcc', stroke:'#000', strokeThickness:2,
        }).setDepth(201));
      });
    }

    push(this.add.text(W/2, H - 42, 'Press any key or wait to start', {
      fontFamily:'monospace', fontSize:'11px', color:'#667788', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5).setDepth(201));

    // Fade out after 8 seconds (or on any key press)
    const dismiss = () => {
      if (!objs[0] || !objs[0].active) return;
      this.tweens.add({
        targets: objs, alpha: 0, duration: 600,
        onComplete: () => objs.forEach(o => { if (o.active) o.destroy(); }),
      });
    };
    this.time.delayedCall(8000, dismiss);
    this.input.keyboard.once('keydown', dismiss);
  }

  // ── WORLD ──────────────────────────────────────────────────
  buildWorld(worldW, worldH, cx, cy) {
    const { TILE, SAFE_R } = CFG;
    const stx = cx/TILE, sty = cy/TILE;

    // Biome ground map — key for each tile
    const groundTexMap = { grass:'grass', waste:'ground_waste', swamp:'ground_swamp', tundra:'ground_tundra', ruins:'ground_ruins' };

    // Base ground fill (grass) then overlay biome tiles in patches
    this._w(this.add.tileSprite(cx, cy, worldW, worldH, 'grass').setOrigin(0.5).setDepth(0));

    // Place biome ground tiles in a grid (every 3 tiles for perf)
    for (let tx = 0; tx < CFG.MAP_W; tx += 3) {
      for (let ty = 0; ty < CFG.MAP_H; ty += 3) {
        const biome = getBiome(tx, ty);
        if (biome === 'grass') continue; // already grass base
        const key = groundTexMap[biome];
        const img = this.add.tileSprite(tx * TILE, ty * TILE, TILE * 3, TILE * 3, key).setOrigin(0).setDepth(0.5);
        this._w(img);
      }
    }

    // Grass variants in grassland areas
    for (let i = 0; i < 100; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-3), ty = Phaser.Math.Between(2, CFG.MAP_H-3);
      if (Math.abs(tx-stx)<SAFE_R+5 && Math.abs(ty-sty)<SAFE_R+5) continue;
      if (getBiome(tx, ty) !== 'grass') continue;
      const variant = ['grass2','grass3'][Math.floor(Math.random()*2)];
      this._w(this.add.image(tx*TILE, ty*TILE, variant).setOrigin(0).setDepth(1).setAlpha(0.65));
    }

    this.obstacles = this.physics.add.staticGroup();
    this.toxicPools = []; // for swamp damage

    // Trees — biome-appropriate
    for (let i = 0; i < CFG.TREES; i++) {
      const tx = Phaser.Math.Between(1, CFG.MAP_W-2), ty = Phaser.Math.Between(1, CFG.MAP_H-2);
      if (Math.abs(tx-stx)<SAFE_R+2 && Math.abs(ty-sty)<SAFE_R+2) continue;
      const biome = getBiome(tx, ty);
      let treeKey = 'tree';
      if (biome === 'waste') treeKey = 'tree_dead';
      else if (biome === 'tundra') treeKey = 'tree_snow';
      else if (biome === 'ruins') { if (Math.random() < 0.5) treeKey = 'tree_dead'; }
      else if (biome === 'swamp') { if (Math.random() < 0.4) treeKey = 'tree_dead'; }

      let sc;
      const roll = Math.random();
      if (roll < 0.70) sc = Phaser.Math.FloatBetween(1.8, 4.0);
      else if (roll < 0.90) sc = Phaser.Math.FloatBetween(0.6, 1.2);
      else sc = Phaser.Math.FloatBetween(1.2, 1.8);
      const t = this.obstacles.create(tx*TILE+14, ty*TILE+18, treeKey);
      t.setScale(sc).setDepth(5).setImmovable(true);
      t.body.setSize(Math.floor(10*sc), Math.floor(12*sc)).setOffset(Math.floor(9/sc), Math.floor(24/sc));
      t.refreshBody();
    }

    // Rocks — biome-appropriate
    for (let i = 0; i < CFG.ROCKS; i++) {
      const tx = Phaser.Math.Between(1, CFG.MAP_W-2), ty = Phaser.Math.Between(1, CFG.MAP_H-2);
      if (Math.abs(tx-stx)<SAFE_R && Math.abs(ty-sty)<SAFE_R) continue;
      const biome = getBiome(tx, ty);
      const rockKey = biome === 'tundra' ? 'ice_rock' : 'rock';
      const sc = Phaser.Math.FloatBetween(0.4, 3.5);
      const r = this.obstacles.create(tx*TILE+11, ty*TILE+8, rockKey);
      r.setScale(sc).setDepth(5).setImmovable(true);
      r.body.setSize(Math.floor(22*sc), Math.floor(16*sc));
      r.refreshBody();
    }

    // Extra rocks in wasteland
    for (let i = 0; i < 60; i++) {
      const tx = Phaser.Math.Between(1, CFG.MAP_W-2), ty = Phaser.Math.Between(1, CFG.MAP_H-2);
      if (getBiome(tx, ty) !== 'waste') continue;
      const sc = Phaser.Math.FloatBetween(0.3, 2.0);
      const r = this.obstacles.create(tx*TILE+11, ty*TILE+8, 'rock');
      r.setScale(sc).setDepth(5).setImmovable(true);
      r.body.setSize(Math.floor(22*sc), Math.floor(16*sc));
      r.refreshBody();
    }

    // Bushes/mushrooms — biome-appropriate decorative
    for (let i = 0; i < 120; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-3), ty = Phaser.Math.Between(2, CFG.MAP_H-3);
      if (Math.abs(tx-stx)<SAFE_R+3 && Math.abs(ty-sty)<SAFE_R+3) continue;
      const biome = getBiome(tx, ty);
      let decKey = 'bush';
      if (biome === 'swamp') decKey = 'mushroom';
      else if (biome === 'waste') { if (Math.random() < 0.7) continue; } // sparse in waste
      else if (biome === 'tundra') { if (Math.random() < 0.5) continue; } // sparse in tundra
      const sc = Phaser.Math.FloatBetween(1.0, 2.5);
      this._w(this.add.image(tx*TILE, ty*TILE, decKey).setScale(sc).setDepth(4).setAlpha(0.9));
    }

    // Pillars in ruins biome
    for (let i = 0; i < 50; i++) {
      const tx = Phaser.Math.Between(1, CFG.MAP_W-2), ty = Phaser.Math.Between(1, CFG.MAP_H-2);
      if (getBiome(tx, ty) !== 'ruins') continue;
      const sc = Phaser.Math.FloatBetween(1.0, 2.5);
      const p = this.obstacles.create(tx*TILE+11, ty*TILE+18, 'pillar');
      p.setScale(sc).setDepth(5).setImmovable(true);
      p.body.setSize(Math.floor(14*sc), Math.floor(28*sc));
      p.refreshBody();
    }

    // Toxic pools in swamp biome
    for (let i = 0; i < 30; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-3), ty = Phaser.Math.Between(2, CFG.MAP_H-3);
      if (getBiome(tx, ty) !== 'swamp') continue;
      if (Math.abs(tx-stx)<SAFE_R+5 && Math.abs(ty-sty)<SAFE_R+5) continue;
      const pool = this.physics.add.image(tx*TILE, ty*TILE, 'toxic_pool').setScale(Phaser.Math.FloatBetween(1.5, 3.0)).setDepth(2).setAlpha(0.85);
      pool.body.allowGravity = false; pool.body.setImmovable(true);
      pool.body.setSize(16, 12);
      if (this.hudCam) this.hudCam.ignore(pool);
      this._w(pool);
      this.toxicPools.push(pool);
    }

    // Mountain ranges — impassable formations with guaranteed gaps for navigation
    // Place ridgelines between biome transitions (ring around center, plus cross-biome ranges)
    this.mountainTiles = []; // stored for minimap rendering
    const mtns = this.mountainTiles;
    const mtnMinDist = 4; // min tiles between mountains (gap check)
    const placeMtn = (tx, ty, key, sc) => {
      // Don't place near spawn
      if (Math.abs(tx-stx)<SAFE_R+6 && Math.abs(ty-sty)<SAFE_R+6) return;
      // Don't place too close to other mountains (leave walking gaps)
      for (const m of mtns) {
        if (Math.abs(m.tx-tx) < mtnMinDist && Math.abs(m.ty-ty) < mtnMinDist) return;
      }
      const px = tx*TILE+24, py = ty*TILE+20;
      const ob = this.obstacles.create(px, py, key);
      ob.setScale(sc).setDepth(6).setImmovable(true);
      const bw = key === 'mountain2' ? 48 : 40;
      const bh = key === 'mountain2' ? 36 : 32;
      ob.body.setSize(Math.floor(bw*sc), Math.floor(bh*sc));
      ob.refreshBody();
      mtns.push({ tx, ty });
    };

    // Ring of mountains around the grasslands/center (with regular gaps every ~8 tiles)
    const ringR = SAFE_R + 18;
    for (let angle = 0; angle < Math.PI * 2; angle += 0.12) {
      // Leave a gap every ~0.5 radians for paths through
      const gapPhase = angle % 0.5;
      if (gapPhase > 0.3 && gapPhase < 0.5) continue; // gap
      const tx = Math.round(stx + Math.cos(angle) * (ringR + Math.sin(angle*3)*4));
      const ty = Math.round(sty + Math.sin(angle) * (ringR + Math.cos(angle*5)*3));
      if (tx < 2 || tx > CFG.MAP_W-3 || ty < 2 || ty > CFG.MAP_H-3) continue;
      const key = Math.random() < 0.4 ? 'mountain2' : 'mountain';
      const sc = Phaser.Math.FloatBetween(1.2, 2.0);
      placeMtn(tx, ty, key, sc);
    }

    // Scattered mountain clusters in outer biomes (small groups of 3-6)
    const clusterCenters = [
      { tx: Math.round(stx - CFG.MAP_W*0.3), ty: Math.round(sty - CFG.MAP_H*0.3) }, // tundra
      { tx: Math.round(stx + CFG.MAP_W*0.3), ty: Math.round(sty - CFG.MAP_H*0.25) }, // ruins
      { tx: Math.round(stx - CFG.MAP_W*0.25), ty: Math.round(sty + CFG.MAP_H*0.3) }, // wasteland
      { tx: Math.round(stx + CFG.MAP_W*0.28), ty: Math.round(sty + CFG.MAP_H*0.28) }, // swamp edge
      { tx: Math.round(stx - CFG.MAP_W*0.1), ty: Math.round(sty - CFG.MAP_H*0.35) }, // north
      { tx: Math.round(stx + CFG.MAP_W*0.1), ty: Math.round(sty + CFG.MAP_H*0.35) }, // south
    ];
    for (const cc of clusterCenters) {
      const count = Phaser.Math.Between(3, 6);
      for (let i = 0; i < count; i++) {
        const tx = cc.tx + Phaser.Math.Between(-5, 5);
        const ty = cc.ty + Phaser.Math.Between(-5, 5);
        if (tx < 2 || tx > CFG.MAP_W-3 || ty < 2 || ty > CFG.MAP_H-3) continue;
        const key = Math.random() < 0.35 ? 'mountain2' : 'mountain';
        const sc = Phaser.Math.FloatBetween(1.0, 2.2);
        placeMtn(tx, ty, key, sc);
      }
    }

    // Barracks
    const bTX = stx+20, bTY = sty-16;
    this.bPos = { x: bTX*TILE+40, y: bTY*TILE+28 };
    this._w(this.add.image(this.bPos.x, this.bPos.y, 'barracks').setDepth(5));
    this._w(this.add.text(this.bPos.x, this.bPos.y-48, 'BARRACKS', {
      fontFamily:'monospace', fontSize:'10px', color:'#99aa88', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5).setDepth(6));
    this.bPrompt = this._w(this.add.text(this.bPos.x, this.bPos.y-62, 'E / Enter  —  enter barracks', {
      fontFamily:'monospace', fontSize:'11px', color:'#ffee44', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5).setDepth(6).setVisible(false));

    // Spawn resource crates — biome-weighted loot
    this.worldCrates = [];
    for (let i = 0; i < 50; i++) {
      const tx = Phaser.Math.Between(3, CFG.MAP_W-4), ty = Phaser.Math.Between(3, CFG.MAP_H-4);
      if (Math.abs(tx-stx) < SAFE_R+2 && Math.abs(ty-sty) < SAFE_R+2) continue;
      const biome = getBiome(tx, ty);
      // Better loot in more dangerous biomes
      let items;
      if (biome === 'ruins') items = ['item_metal','item_metal','item_ammo','item_ammo','item_food'];
      else if (biome === 'swamp') items = ['item_fiber','item_fiber','item_food','item_ammo','item_metal'];
      else if (biome === 'tundra') items = ['item_wood','item_metal','item_food','item_food','item_ammo'];
      else if (biome === 'waste') items = ['item_metal','item_metal','item_wood','item_ammo','item_fiber'];
      else items = ['item_wood','item_metal','item_fiber','item_ammo','item_food'];
      const itemKey = items[Phaser.Math.Between(0, items.length-1)];
      const crate = this.physics.add.image(tx*TILE, ty*TILE, itemKey).setScale(2.5).setDepth(6);
      crate.body.allowGravity = false; crate.body.setImmovable(true);
      crate.itemType = itemKey.replace('item_', '');
      this._w(crate);
      this.worldCrates.push(crate);
    }

    // ── POINTS OF INTEREST ────────────────────────────────────
    this.pois = [];
    this.buildPOIs(stx, sty, TILE);

    // Night overlay
    this.nightOverlay = this._w(this.add.graphics().setDepth(49));

    // ── FOG OF WAR ────────────────────────────────────────────
    this.fogRevealed = new Set();
    this.fogGfx = this._w(this.add.graphics().setDepth(48));
    this._fogFrame = 0;
    // Reveal initial spawn area
    this.revealFog(stx, sty, CFG.FOG_REVEAL_R + 4);
  }

  buildPOIs(stx, sty, TILE) {
    const MAP_W = CFG.MAP_W, MAP_H = CFG.MAP_H;

    // Helper to find a position in a specific biome
    const findInBiome = (targetBiome, attempts) => {
      for (let i = 0; i < attempts; i++) {
        const tx = Phaser.Math.Between(10, MAP_W - 10);
        const ty = Phaser.Math.Between(10, MAP_H - 10);
        if (Math.abs(tx - stx) < CFG.SAFE_R + 8 && Math.abs(ty - sty) < CFG.SAFE_R + 8) continue;
        if (getBiome(tx, ty) === targetBiome) return { tx, ty };
      }
      // Fallback
      return { tx: Phaser.Math.Between(20, MAP_W - 20), ty: Phaser.Math.Between(20, MAP_H - 20) };
    };

    // Supply Caches (3-4 across map)
    for (let i = 0; i < 4; i++) {
      const biomes = ['waste', 'swamp', 'tundra', 'ruins'];
      const pos = findInBiome(biomes[i % biomes.length], 50);
      const px = pos.tx * TILE, py = pos.ty * TILE;
      const spr = this._w(this.add.image(px, py, 'supply_cache').setScale(2.5).setDepth(6));
      const lbl = this._w(this.add.text(px, py - 24, 'SUPPLY CACHE', {
        fontFamily:'monospace', fontSize:'8px', color:'#ccaa00', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(7));
      // Drop valuable crates near supply cache
      for (let j = 0; j < 3; j++) {
        const dx = px + Phaser.Math.Between(-40, 40), dy = py + Phaser.Math.Between(-40, 40);
        const rareItems = ['item_ammo','item_metal','item_food'];
        const itemKey = rareItems[Phaser.Math.Between(0, rareItems.length-1)];
        const crate = this.physics.add.image(dx, dy, itemKey).setScale(2.5).setDepth(6);
        crate.body.allowGravity = false; crate.body.setImmovable(true);
        crate.itemType = itemKey.replace('item_', '');
        this._w(crate);
        this.worldCrates.push(crate);
      }
      this.pois.push({ type:'cache', tx:pos.tx, ty:pos.ty, spr });
    }

    // Enemy Dens (3 across map)
    this.enemyDens = [];
    for (let i = 0; i < 3; i++) {
      const biomes = ['waste', 'swamp', 'tundra'];
      const pos = findInBiome(biomes[i % biomes.length], 50);
      const px = pos.tx * TILE, py = pos.ty * TILE;
      const spr = this._w(this.add.image(px, py, 'enemy_den').setScale(2).setDepth(5));
      const lbl = this._w(this.add.text(px, py - 24, 'ENEMY DEN', {
        fontFamily:'monospace', fontSize:'8px', color:'#cc4444', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(7));
      this.enemyDens.push({ x: px, y: py, tx: pos.tx, ty: pos.ty, respawnTimer: 0 });
      this.pois.push({ type:'den', tx:pos.tx, ty:pos.ty, spr });
    }

    // Old Radio Tower (1, in ruins biome)
    {
      const pos = findInBiome('ruins', 80);
      const px = pos.tx * TILE, py = pos.ty * TILE;
      const spr = this._w(this.add.image(px, py, 'radio_tower').setScale(2).setDepth(6));
      const lbl = this._w(this.add.text(px, py - 52, 'RADIO TOWER', {
        fontFamily:'monospace', fontSize:'8px', color:'#66aaff', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(7));
      this.radioTower = { x: px, y: py, tx: pos.tx, ty: pos.ty, used: false, spr, lbl };
      const prompt = this._w(this.add.text(px, py - 64, 'E / Enter to activate', {
        fontFamily:'monospace', fontSize:'9px', color:'#ffee44', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(7).setVisible(false));
      this.radioTower.prompt = prompt;
      this.pois.push({ type:'tower', tx:pos.tx, ty:pos.ty, spr });
    }

    // Campsites (2 across map)
    this.campsites = [];
    for (let i = 0; i < 2; i++) {
      const biomes = ['grass', 'waste'];
      const pos = findInBiome(biomes[i], 50);
      const px = pos.tx * TILE, py = pos.ty * TILE;
      const spr = this._w(this.add.image(px, py, 'campsite').setScale(2).setDepth(5));
      const lbl = this._w(this.add.text(px, py - 28, 'CAMPSITE', {
        fontFamily:'monospace', fontSize:'8px', color:'#44cc66', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(7));
      this.campsites.push({ x: px, y: py });
      this.pois.push({ type:'camp', tx:pos.tx, ty:pos.ty, spr });
    }

    // Campsite healing timer
    this.time.addEvent({
      delay: 2000, loop: true,
      callback: () => {
        this.campsites.forEach(cs => {
          [this.p1, this.p2].filter(Boolean).forEach(pl => {
            if (!pl || pl.isDowned || !pl.spr.active) return;
            const d = Phaser.Math.Distance.Between(pl.spr.x, pl.spr.y, cs.x, cs.y);
            if (d < 64) {
              pl.hp = Math.min(pl.maxHp, pl.hp + 5);
            }
          });
        });
      }
    });
  }

  // ── FOG OF WAR ────────────────────────────────────────────────
  revealFog(centerTX, centerTY, radius) {
    const r = radius || (CFG.FOG_REVEAL_R * (this.fogRevealMult || 1));
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (dx*dx + dy*dy > r*r) continue;
        const tx = Math.floor(centerTX + dx), ty = Math.floor(centerTY + dy);
        if (tx < 0 || ty < 0 || tx >= CFG.MAP_W || ty >= CFG.MAP_H) continue;
        this.fogRevealed.add(tx + ',' + ty);
      }
    }
  }

  updateFog() {
    if (!this.fogGfx) return;
    this._fogFrame++;
    if (this._fogFrame % CFG.FOG_UPDATE_INTERVAL !== 0) return;

    const TILE = CFG.TILE;
    const cam = this.cameras.main;

    // Reveal around players
    const revealP = (p) => {
      if (!p || !p.spr.active || p.isDowned) return;
      const ptx = Math.floor(p.spr.x / TILE), pty = Math.floor(p.spr.y / TILE);
      this.revealFog(ptx, pty);
    };
    revealP(this.p1);
    if (this.p2) revealP(this.p2);

    // Only draw fog tiles visible in camera viewport
    this.fogGfx.clear();
    const vx = cam.worldView.x, vy = cam.worldView.y;
    const vw = cam.worldView.width, vh = cam.worldView.height;
    const startTX = Math.max(0, Math.floor(vx / TILE) - 1);
    const startTY = Math.max(0, Math.floor(vy / TILE) - 1);
    const endTX = Math.min(CFG.MAP_W - 1, Math.ceil((vx + vw) / TILE) + 1);
    const endTY = Math.min(CFG.MAP_H - 1, Math.ceil((vy + vh) / TILE) + 1);

    this.fogGfx.fillStyle(0x000000, 0.85);
    for (let tx = startTX; tx <= endTX; tx++) {
      for (let ty = startTY; ty <= endTY; ty++) {
        if (!this.fogRevealed.has(tx + ',' + ty)) {
          this.fogGfx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        }
      }
    }
  }

  // ── PLAYER ──────────────────────────────────────────────────
  spawnPlayer(x, y, charData, pNum) {
    const spr = this._w(this.physics.add.sprite(x, y, charData.id).setScale(2.5).setDepth(10));
    spr.setCollideWorldBounds(true);
    spr.body.setSize(12, 16).setOffset(5, 12);

    const lbl = this._w(this.add.text(x, y-34, charData.player, {
      fontFamily:'monospace', fontSize:'11px',
      color: pNum===1 ? '#6699ff' : '#ff9944', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5).setDepth(11));

    const hpBar = this._w(this.add.graphics().setDepth(12));
    return {
      spr, lbl, charData, pNum,
      hp: charData.maxHp, maxHp: charData.maxHp,
      ammo: charData.id==='gunslinger' ? 8 : Infinity,
      reserveAmmo: charData.id==='gunslinger' ? 32 : 0, // 8 loaded + 32 reserve = 40 max
      isDowned: false, isPermanentlyDead: false, downTimer: 0, downText: null,
      hpBar, dir: 'front', walkTimer: 0,
      atkCooldown: 0, reloading: false,
      rallyCooldown: 0, turretCooldown: 0,
      isSleeping: false, zzzText: null,
      inv: { wood:0, metal:0, fiber:0, food:0 },
    };
  }

  // ── HUD ─────────────────────────────────────────────────────
  buildHUD() {
    const { W, H } = CFG;

    this.ammoIcons = { p1:null, p2:null };
    if (STATE.p1CharId==='gunslinger') this.ammoIcons.p1 = this.makeAmmoRow(14, 14, 0x6699ff);
    if (!this.solo && STATE.p2CharId==='gunslinger') this.ammoIcons.p2 = this.makeAmmoRow(W-108, 14, 0xff9944);
    if (this.ammoIcons.p1) this.ammoIcons.p1.forEach(ic => this._h(ic));
    if (this.ammoIcons.p2) this.ammoIcons.p2.forEach(ic => this._h(ic));

    // Reserve ammo counter (shown below clip icons for gunslinger players)
    this.ammoReserveText = { p1: null, p2: null };
    if (STATE.p1CharId === 'gunslinger') {
      this.ammoReserveText.p1 = this._h(this.add.text(14, 30, '', {
        fontFamily:'monospace', fontSize:'9px', color:'#aaaacc',
      }).setDepth(101));
    }
    if (!this.solo && STATE.p2CharId === 'gunslinger') {
      this.ammoReserveText.p2 = this._h(this.add.text(W - 12, 30, '', {
        fontFamily:'monospace', fontSize:'9px', color:'#ccaa88',
      }).setOrigin(1, 0).setDepth(101));
    }

    const dayBg = this._h(this.add.graphics().setDepth(100));
    dayBg.fillStyle(0x000000, 0.6); dayBg.fillRoundedRect(W/2-95, 5, 190, 50, 8);
    this.dayText = this._h(this.add.text(W/2, 10, 'DAY 1', { fontFamily:'monospace', fontSize:'13px', color:'#ffee44' }).setOrigin(0.5,0).setDepth(101));
    this.clockGfx = this._h(this.add.graphics().setDepth(102));

    const diffColor = this.hardcore ? '#ff4444' : '#44cc66';
    const diffLabel = this.hardcore ? '\u2620 HARDCORE' : '\u2665 SURVIVAL';
    this._h(this.add.text(W/2, 42, diffLabel, { fontFamily:'monospace', fontSize:'9px', color:diffColor }).setOrigin(0.5,0).setDepth(101));
    this._h(this.add.text(W-140, H-10, 'TAB = controls', { fontFamily:'monospace', fontSize:'10px', color:'#444455' }).setOrigin(1,1).setDepth(100));

    // Down status texts
    this.p1DownStatus = this._h(this.add.text(12, 54, '', { fontFamily:'monospace', fontSize:'11px', color:'#ff4444' }).setDepth(103));
    this.p2DownStatus = this._h(this.add.text(W-12, 54, '', { fontFamily:'monospace', fontSize:'11px', color:'#ff4444' }).setOrigin(1,0).setDepth(103));

    // Inventory display (bottom left for P1, bottom right for P2)
    const invStyle = { fontFamily:'monospace', fontSize:'10px', color:'#aabb88', stroke:'#000', strokeThickness:2 };
    this.p1InvText = this._h(this.add.text(12, H-50, '', invStyle).setDepth(101));
    if (this.p2) this.p2InvText = this._h(this.add.text(W-12, H-50, '', invStyle).setOrigin(1,0).setDepth(101));

    // P1 name badge (top-left)
    this.p1Badge = this._h(this.add.text(12, 10, this.p1.charData.player + ' \u2014 ' + this.p1.charData.title, {
      fontFamily:'monospace', fontSize:'11px', color:'#6699ff',
    }).setDepth(102));
    if (this.p2) {
      this.p2Badge = this._h(this.add.text(W-12, 10, this.p2.charData.player + ' \u2014 ' + this.p2.charData.title, {
        fontFamily:'monospace', fontSize:'11px', color:'#ff9944',
      }).setOrigin(1,0).setDepth(102));
    }

    // ── MINIMAP ─────────────────────────────────────────────────
    const mmW = 120, mmH = 120;
    const mmX = W - mmW - 10, mmY = 80; // top-right so it doesn't overlap P2 inventory
    // Background
    const mmBg = this._h(this.add.graphics().setDepth(110));
    mmBg.fillStyle(0x000000, 0.7); mmBg.fillRoundedRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4, 4);
    mmBg.lineStyle(1, 0x555566); mmBg.strokeRoundedRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4, 4);
    this.minimapGfx = this._h(this.add.graphics().setDepth(111));
    this.minimapDots = this._h(this.add.graphics().setDepth(112));
    this.mmBounds = { x: mmX, y: mmY, w: mmW, h: mmH };
    this._h(this.add.text(mmX + mmW/2, mmY - 10, 'MAP', {
      fontFamily:'monospace', fontSize:'8px', color:'#666677',
    }).setOrigin(0.5).setDepth(111));

    // Pre-render biome colors on minimap (static, done once)
    this._renderMinimapBase();
  }

  _renderMinimapBase() {
    if (!this.minimapGfx) return;
    const mm = this.mmBounds;
    const scaleX = mm.w / CFG.MAP_W, scaleY = mm.h / CFG.MAP_H;
    this.minimapGfx.clear();
    // Draw biome blocks (sample every 4 tiles for perf)
    const step = 4;
    for (let tx = 0; tx < CFG.MAP_W; tx += step) {
      for (let ty = 0; ty < CFG.MAP_H; ty += step) {
        const biome = getBiome(tx, ty);
        this.minimapGfx.fillStyle(BIOME_COLORS[biome] || 0x333333, 0.8);
        this.minimapGfx.fillRect(
          mm.x + tx * scaleX,
          mm.y + ty * scaleY,
          Math.ceil(step * scaleX),
          Math.ceil(step * scaleY)
        );
      }
    }
    // Draw mountain markers (small gray dots)
    if (this.mountainTiles) {
      this.minimapGfx.fillStyle(0x888899, 0.9);
      for (const m of this.mountainTiles) {
        this.minimapGfx.fillRect(mm.x + m.tx * scaleX - 0.5, mm.y + m.ty * scaleY - 0.5, 2, 2);
      }
    }
  }

  updateMinimap() {
    if (!this.minimapDots || !this.mmBounds) return;
    // Only update every 8 frames
    if (this._fogFrame % 8 !== 0) return;

    const mm = this.mmBounds;
    const scaleX = mm.w / CFG.MAP_W, scaleY = mm.h / CFG.MAP_H;
    const TILE = CFG.TILE;
    this.minimapDots.clear();

    // Draw fog coverage on minimap (sample every 6 tiles)
    const step = 6;
    this.minimapDots.fillStyle(0x000000, 0.6);
    for (let tx = 0; tx < CFG.MAP_W; tx += step) {
      for (let ty = 0; ty < CFG.MAP_H; ty += step) {
        if (!this.fogRevealed.has(tx + ',' + ty)) {
          this.minimapDots.fillRect(
            mm.x + tx * scaleX,
            mm.y + ty * scaleY,
            Math.ceil(step * scaleX),
            Math.ceil(step * scaleY)
          );
        }
      }
    }

    // POI dots
    if (this.pois) {
      this.pois.forEach(poi => {
        let col = 0xffffff;
        if (poi.type === 'cache') col = 0xccaa00;
        else if (poi.type === 'den') col = 0xcc4444;
        else if (poi.type === 'tower') col = 0x66aaff;
        else if (poi.type === 'camp') col = 0x44cc66;
        else if (poi.type === 'campfire') col = 0xff8833;   // orange — player-built campfire
        else if (poi.type === 'craftbench') col = 0xddcc44; // yellow — player-built workbench
        else if (poi.type === 'bed') col = 0xaa88ff;        // purple — player-built bed
        // Only show if revealed
        if (this.fogRevealed.has(poi.tx + ',' + poi.ty)) {
          this.minimapDots.fillStyle(col);
          this.minimapDots.fillRect(mm.x + poi.tx * scaleX - 1, mm.y + poi.ty * scaleY - 1, 3, 3);
        }
      });
    }

    // Player dots
    const drawDot = (p, color) => {
      if (!p || !p.spr.active) return;
      const ptx = p.spr.x / TILE, pty = p.spr.y / TILE;
      this.minimapDots.fillStyle(color);
      this.minimapDots.fillCircle(mm.x + ptx * scaleX, mm.y + pty * scaleY, 2.5);
    };
    drawDot(this.p1, 0x6699ff);
    if (this.p2) drawDot(this.p2, 0xff9944);
  }

  makeAmmoRow(x, y, tint) {
    const icons = [];
    for (let i=0; i<8; i++) {
      const ic = this.add.image(x+i*13, y, 'ammo_icon').setDepth(101).setTint(tint);
      this._h(ic);
      // If hudCam already exists (late creation after barrack swap), update ignore lists
      if (this.hudCam) {
        this.cameras.main.ignore(ic);
      }
      icons.push(ic);
    }
    return icons;
  }

  redrawHUD() {
    // Update ammo icons and reserve counter
    const refreshAmmo = (icons, reserveText, player) => {
      if (!icons || !player || player.charData.id!=='gunslinger') return;
      icons.forEach((ic, i) => ic.setAlpha(i<player.ammo ? 1 : 0.18));
      if (reserveText) reserveText.setText('+' + (player.reserveAmmo || 0) + ' reserve');
    };
    refreshAmmo(this.ammoIcons.p1, this.ammoReserveText && this.ammoReserveText.p1, this.p1);
    if (this.p2) refreshAmmo(this.ammoIcons.p2, this.ammoReserveText && this.ammoReserveText.p2, this.p2);

    // Update name badges
    if (this.p1Badge) this.p1Badge.setText(this.p1.charData.player + ' — ' + this.p1.charData.title);
    if (this.p2Badge && this.p2) this.p2Badge.setText(this.p2.charData.player + ' — ' + this.p2.charData.title);

    // Inventory display
    const invStr = p => {
      if (!p) return '';
      const i = p.inv;
      const parts = [];
      if (i.wood > 0) parts.push('Wood:' + i.wood);
      if (i.metal > 0) parts.push('Metal:' + i.metal);
      if (i.fiber > 0) parts.push('Fiber:' + i.fiber);
      if (i.food > 0) parts.push('Food:' + i.food);
      return parts.length ? parts.join('  ') : '';
    };
    if (this.p1InvText) this.p1InvText.setText(invStr(this.p1));
    if (this.p2InvText) this.p2InvText.setText(invStr(this.p2));
  }

  // ── REVIVE BAR (world-space) ──────────────────────────────────
  buildReviveBar() {
    this.revBar = this._w(this.add.graphics().setDepth(20).setVisible(false));
  }

  drawReviveBar(x, y, pct) {
    this.revBar.clear();
    this.revBar.fillStyle(0x000000, 0.7);  this.revBar.fillRect(x-30, y-8, 60, 10);
    this.revBar.fillStyle(0x33ff66);        this.revBar.fillRect(x-30, y-8, Math.floor(60*pct), 10);
    this.revBar.lineStyle(1, 0xffffff, 0.5); this.revBar.strokeRect(x-30, y-8, 60, 10);
    this.revBar.setVisible(true);
  }

  // ── DEATH & REVIVE ──────────────────────────────────────────
  checkDeaths() {
    const check = p => { if (p && !p.isDowned && !p.isPermanentlyDead && p.hp <= 0) this.handleDeath(p); };
    check(this.p1);
    if (this.p2) check(this.p2);
  }

  handleDeath(player) {
    if (this.hardcore || this.solo) {
      // Game over immediately
      this.triggerGameOver(player.charData.player + ' has fallen.');
      return;
    }

    // 2P Survival: if partner is already permanently dead, no one to revive — game over
    const partner = player === this.p1 ? this.p2 : this.p1;
    if (partner && partner.isPermanentlyDead) {
      this.triggerGameOver('Both survivors have fallen.');
      return;
    }

    // Go downed — partner has a chance to revive
    player.hp = 0;
    player.isDowned = true;
    player.downTimer = CFG.DOWN_TIME;
    player.spr.setTint(0xaa0000);
    player.spr.setAlpha(0.7);
    player.spr.setVelocity(0, 0);

    player.downText = this.add.text(player.spr.x, player.spr.y - 52,
      '\u2193 ' + Math.ceil(player.downTimer) + 's',
      { fontFamily:'monospace', fontSize:'16px', color:'#ff4444', stroke:'#000', strokeThickness:3 }
    ).setOrigin(0.5).setDepth(20);
    if (this.hudCam) this.hudCam.ignore(player.downText);

    this.hint(player.charData.player + ' is DOWN! Get close and hold E / Enter to revive!', 5000);
  }

  updateDowned(delta) {
    const sec = delta / 1000;
    const updateOne = (p, statusText) => {
      if (!p || !p.isDowned) { statusText.setText(''); return; }

      p.downTimer -= sec;

      // Keep downed text above sprite
      if (p.downText) {
        p.downText.setPosition(p.spr.x, p.spr.y - 52);
        p.downText.setText('↓ ' + Math.ceil(Math.max(0, p.downTimer)) + 's');
      }

      statusText.setText('↓ ' + p.charData.player.toUpperCase() + ' IS DOWN');

      if (p.downTimer <= 0) {
        // Time ran out — permanently dead
        if (p.downText) { p.downText.destroy(); p.downText = null; }
        p.isDowned = false;
        p.isPermanentlyDead = true;
        p.hp = 0;
        p.spr.setVisible(false);
        p.spr.setVelocity(0, 0);
        if (p.hpBar) p.hpBar.clear();
        if (p.lbl) p.lbl.setVisible(false);
        statusText.setText('');
        this.checkBothDead();
      }
    };

    updateOne(this.p1, this.p1DownStatus);
    if (this.p2) updateOne(this.p2, this.p2DownStatus);
  }

  checkBothDead() {
    const p1dead = !this.p1.spr.visible || (!this.p1.isDowned && this.p1.hp <= 0);
    const p2dead = !this.p2 || !this.p2.spr.visible || (!this.p2.isDowned && this.p2.hp <= 0);
    if (p1dead && p2dead) this.triggerGameOver('Both survivors have fallen.');
  }

  updateRevive(delta) {
    if (this.solo || this.isOver) return;

    const sec = delta / 1000;

    // Find if a downed player is near an active rescuer
    const pairs = [
      { downed: this.p1, rescuer: this.p2, key: this.hotkeys.p2use },
      { downed: this.p2, rescuer: this.p1, key: this.hotkeys.p1use },
    ];

    let anyReviving = false;
    for (const { downed, rescuer } of pairs) {
      if (!downed || !rescuer || !downed.isDowned || !rescuer.spr.visible) continue;
      if (downed.hp <= 0 && !downed.isDowned) continue;

      const dist = Phaser.Math.Distance.Between(downed.spr.x, downed.spr.y, rescuer.spr.x, rescuer.spr.y);

      if (dist < CFG.REVIVE_RANGE) {
        // Show revive prompt
        const keyName = rescuer === this.p1 ? 'E' : 'Enter';
        if (!this._revivePromptShown) {
          this._revivePromptShown = true;
          this.hint('Hold ' + keyName + ' to revive ' + downed.charData.player + '!', 3000);
        }

        // Check if rescue key is held
        const keyHeld = rescuer === this.p1
          ? this.hotkeys.p1use.isDown
          : this.hotkeys.p2use.isDown;

        if (keyHeld) {
          anyReviving = true;
          this.reviving = true;
          this.reviveTarget = downed;
          this.reviveProgress += sec / CFG.REVIVE_TIME;
          this.drawReviveBar(downed.spr.x, downed.spr.y - 70, Math.min(1, this.reviveProgress));

          if (this.reviveProgress >= 1) {
            this.revivePlayer(downed);
          }
        } else {
          this._revivePromptShown = false;
        }
      }
    }

    if (!anyReviving) {
      this.reviveProgress = 0;
      this.reviving = false;
      this.reviveTarget = null;
      this.revBar.setVisible(false);
    }
  }

  revivePlayer(player) {
    player.isDowned = false;
    player.hp = Math.floor(player.maxHp * 0.3);
    player.downTimer = 0;
    player.spr.clearTint();
    player.spr.setAlpha(1.0);
    if (player.downText) { player.downText.destroy(); player.downText = null; }
    this.reviveProgress = 0;
    this.reviving = false;
    this.revBar.setVisible(false);
    this._revivePromptShown = false;
    this.redrawHUD();
    this.hint(player.charData.player + ' is back up! (' + player.hp + ' HP)', 3000);
  }

  triggerGameOver(reason) {
    if (this.isOver) return;
    this.isOver = true;

    this.p1.spr.setVelocity(0, 0);
    if (this.p2) this.p2.spr.setVelocity(0, 0);

    this.cameras.main.fadeOut(800, 0, 0, 0);
    this.time.delayedCall(900, () => {
      this.scene.start('GameOver', {
        reason,
        timeAlive: this.timeAlive,
        mode: STATE.mode,
        difficulty: STATE.difficulty,
      });
    });
  }

  // ── CONTROLS OVERLAY ─────────────────────────────────────────
  buildControlsOverlay() {
    // Hidden by default — shown only when Tab is pressed
    const { W, H } = CFG;
    this.ctrlObjs = [];
    const push = o => { this.ctrlObjs.push(o); this._h(o); o.setVisible(false); return o; };

    const p1Ch = this.p1 ? this.p1.charData : CHARS.find(c => c.id === STATE.p1CharId);
    const p2Ch = this.p2 ? this.p2.charData : (this.solo ? null : CHARS.find(c => c.id === STATE.p2CharId));

    // Dimming backdrop (only visible when controls open)
    push(this.add.graphics().setDepth(94)).fillStyle(0x000000, 0.55).fillRect(0, 0, W, H);

    // P1 controls — left side
    const p1Lines = getControls(1, p1Ch.id, this.solo);
    const lbg = push(this.add.graphics().setDepth(95));
    lbg.fillStyle(0x000011, 0.88);
    lbg.fillRoundedRect(4, H/2 - 14 - p1Lines.length*10, 172, p1Lines.length*20 + 36, 8);
    lbg.lineStyle(1, 0x4466aa, 0.7);
    lbg.strokeRoundedRect(4, H/2 - 14 - p1Lines.length*10, 172, p1Lines.length*20 + 36, 8);
    push(this.add.text(10, H/2 - 10 - p1Lines.length*10, p1Ch.player + ' — ' + p1Ch.title, {
      fontFamily:'monospace', fontSize:'10px', color:'#88aaff', stroke:'#000', strokeThickness:2,
    }).setDepth(96));
    p1Lines.forEach((l, i) => {
      push(this.add.text(12, H/2 + 8 - p1Lines.length*10 + i*20, l, {
        fontFamily:'monospace', fontSize:'9px', color:'#ccd8ee', stroke:'#000', strokeThickness:2,
      }).setDepth(96));
    });

    // P2 controls — right side
    if (p2Ch) {
      const p2Lines = getControls(2, p2Ch.id);
      const rbg = push(this.add.graphics().setDepth(95));
      rbg.fillStyle(0x110008, 0.88);
      rbg.fillRoundedRect(W-176, H/2 - 14 - p2Lines.length*10, 172, p2Lines.length*20 + 36, 8);
      rbg.lineStyle(1, 0xaa6633, 0.7);
      rbg.strokeRoundedRect(W-176, H/2 - 14 - p2Lines.length*10, 172, p2Lines.length*20 + 36, 8);
      push(this.add.text(W-170, H/2 - 10 - p2Lines.length*10, p2Ch.player + ' — ' + p2Ch.title, {
        fontFamily:'monospace', fontSize:'10px', color:'#ffbb77', stroke:'#000', strokeThickness:2,
      }).setDepth(96));
      p2Lines.forEach((l, i) => {
        push(this.add.text(W-170, H/2 + 8 - p2Lines.length*10 + i*20, l, {
          fontFamily:'monospace', fontSize:'9px', color:'#eeddcc', stroke:'#000', strokeThickness:2,
        }).setDepth(96));
      });
    }

    push(this.add.text(W/2, H - 26, 'TAB or ESC to close', {
      fontFamily:'monospace', fontSize:'10px', color:'#556677', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5).setDepth(96));
  }

  toggleControls() {
    this.controlsVis = !this.controlsVis;
    // Destroy old overlay and rebuild with current character data, then show/hide
    this.ctrlObjs.forEach(o => o.destroy());
    this.buildControlsOverlay();
    if (this.controlsVis) {
      this.ctrlObjs.forEach(o => o.setVisible(true));
    }
    // When hiding: objects stay invisible (default from buildControlsOverlay)
  }

  // ── BARRACKS OVERLAY ─────────────────────────────────────────
  buildBarrackOverlay() {
    const { W, H } = CFG;
    this.bObjs = [];
    const push = o => { this.bObjs.push(o); this._h(o); return o; };
    const t = (x,y,str,sty) => push(this.add.text(x,y,str,sty).setDepth(211));

    push(this.add.graphics().setDepth(210)).fillStyle(0x000000, 0.92).fillRect(0,0,W,H);
    t(W/2,52,'BARRACKS \u2014 SWAP CHARACTER',{ fontFamily:'monospace', fontSize:'24px', color:'#cc8833', stroke:'#000', strokeThickness:3 }).setOrigin(0.5);
    this.bHintText = t(W/2, 90, '', { fontFamily:'monospace', fontSize:'13px', color:'#666677' }).setOrigin(0.5);

    this.bCards = CHARS.map((ch, i) => {
      const x = W/2 + (i-1)*250, y = H/2-10;
      const box    = push(this.add.graphics().setDepth(211));
      const spr    = push(this.add.image(x, y-52, ch.id).setScale(5).setDepth(212));
      const nameT  = push(t(x, y+16, ch.player, { fontFamily:'monospace', fontSize:'18px', color:'#'+ch.color.toString(16).padStart(6,'0') }).setOrigin(0.5));
      const titT   = push(t(x, y+40, ch.title,  { fontFamily:'monospace', fontSize:'12px', color:'#777788' }).setOrigin(0.5));
      const stateT = push(t(x, y+62, '',         { fontFamily:'monospace', fontSize:'12px', color:'#ff4444' }).setOrigin(0.5));
      return { box, spr, nameT, titT, stateT, x, y };
    });

    push(t(W/2, H-46, 'Move keys to browse   |   F / /  to confirm   |   ESC to cancel', { fontFamily:'monospace', fontSize:'12px', color:'#445544' }).setOrigin(0.5));
    this.bObjs.forEach(o => o.setVisible(false));
  }

  tryInteract(player) {
    const dist = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, this.bPos.x, this.bPos.y);
    if (dist < 110) { this.openBarrack(player); return; }

    // Radio tower interaction
    if (this.radioTower && !this.radioTower.used) {
      const td = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, this.radioTower.x, this.radioTower.y);
      if (td < 80) {
        this.radioTower.used = true;
        this.radioTower.spr.setTint(0x66aaff);
        this.fogRevealMult = 2; // permanently doubles player fog-of-war radius
        this.hint('Radio Tower online! Vision range doubled permanently!', 5000);
        SFX._play(800, 'triangle', 0.2, 0.3, 'rise');
        SFX._play(1200, 'triangle', 0.15, 0.2, 'rise');
        // Reveal large area around the tower itself
        this.revealFog(this.radioTower.tx, this.radioTower.ty, 35);
        if (this.radioTower.prompt) this.radioTower.prompt.setVisible(false);
        return;
      }
    }

    // Bed interaction — toggle sleep
    for (const bed of (this.beds || [])) {
      const bd = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, bed.x, bed.y);
      if (bd < 70) {
        this.toggleSleep(player, bed);
        return;
      }
    }
  }

  toggleSleep(player, bed) {
    if (player.isSleeping) {
      this.wakePlayer(player);
    } else {
      if (player.isDowned || player.isPermanentlyDead) return;
      player.isSleeping = true;
      player.spr.setTint(0x9977cc);
      player.spr.setAlpha(0.75);
      // Floating Zzz text
      if (player.zzzText) player.zzzText.destroy();
      player.zzzText = this._w(this.add.text(player.spr.x, player.spr.y - 30, 'Zzz…', {
        fontFamily: 'monospace', fontSize: '13px', color: '#ccaaff'
      }).setDepth(30).setOrigin(0.5));
      if (this.hudCam) this.hudCam.ignore(player.zzzText);
      this.tweens.add({ targets: player.zzzText, y: player.spr.y - 52, alpha: 0.7,
        duration: 2000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      SFX._play(220, 'sine', 0.05, 0.6);
      const allNote = this.solo ? '' : ' Both asleep = night speeds up!';
      this.hint(player.charData.player + ' is sleeping… (+8 HP/tick)' + allNote, 3000);
    }
  }

  wakePlayer(player) {
    if (!player.isSleeping) return;
    player.isSleeping = false;
    player.spr.clearTint();
    player.spr.setAlpha(1);
    if (player.zzzText) { player.zzzText.destroy(); player.zzzText = null; }
  }

  updateSleep(delta) {
    if (!this.beds || this.beds.length === 0) return;
    const players = [this.p1, this.p2].filter(p => p && !p.isPermanentlyDead);
    const sleeping = players.filter(p => p.isSleeping);

    // Show/hide bed proximity prompts
    if (this._bedPrompts) {
      this._bedPrompts.forEach(({ bed, prompt }) => {
        if (!prompt.active) return;
        const near = players.some(p => Phaser.Math.Distance.Between(p.spr.x, p.spr.y, bed.x, bed.y) < 70);
        prompt.setVisible(near && !players.every(p => p.isSleeping));
      });
    }

    // Auto-wake at dawn (pct just crossed back to < 0.05 = new day)
    const cycle = this.dayTimer % this.DAY_DUR;
    const pct = cycle / this.DAY_DUR;
    if (pct < 0.05 && sleeping.length > 0) {
      sleeping.forEach(p => {
        this.wakePlayer(p);
        this.hint(p.charData.player + ' wakes up refreshed!', 2000);
      });
      return;
    }

    // Move Zzz text with player
    sleeping.forEach(p => {
      if (p.zzzText && p.zzzText.active) {
        p.zzzText.x = p.spr.x;
      }
    });

    // Heal tick (every 2s via accumulator)
    this._sleepHealAcc = (this._sleepHealAcc || 0) + delta;
    if (this._sleepHealAcc >= 2000) {
      this._sleepHealAcc -= 2000;
      sleeping.forEach(p => {
        if (!p.isDowned) p.hp = Math.min(p.maxHp, p.hp + 8);
      });
    }

    // Night speed: all players sleeping during night → 8x
    const allSleeping = players.length > 0 && sleeping.length === players.length;
    if (allSleeping && this.isNight) {
      if (this.sleepSpeedMult !== 8) {
        this.sleepSpeedMult = 8;
        this.hint('Everyone asleep \u2014 night rushing by!', 3000);
      }
    } else {
      this.sleepSpeedMult = 1;
    }
  }

  openBarrack(player) {
    this.barrackOpen = true; this.barrackOwner = player;
    this.barrackSel = CHARS.findIndex(c => c.id === player.charData.id);
    this.bHintText.setText(player===this.p1 ? 'A / D to select   |   F to confirm' : 'Arrow keys   |   / to confirm');
    this.bObjs.forEach(o => o.setVisible(true));
    this.refreshBarrackCards();
  }

  barrackNav(dir) {
    this.barrackSel = Phaser.Math.Wrap(this.barrackSel+dir, 0, CHARS.length);
    this.refreshBarrackCards();
  }

  barrackConfirm() {
    if (!this.barrackOpen) return;
    const player = this.barrackOwner;
    const newCh  = CHARS[this.barrackSel];
    const other  = (player===this.p1 && this.p2) ? this.p2.charData : (player===this.p2) ? this.p1.charData : null;
    if (other && newCh.id===other.id) { this.hint('That character is already taken!', 1800); return; }

    const hpPct      = player.hp / player.maxHp;
    player.charData  = newCh;
    player.maxHp     = newCh.maxHp;
    player.hp        = Math.max(1, Math.round(newCh.maxHp * hpPct));
    player.spr.setTexture(newCh.id);
    player.lbl.setText(newCh.player);
    if (newCh.id==='gunslinger') player.ammo = 8;

    // Update STATE for consistency
    if (player === this.p1) STATE.p1CharId = newCh.id;
    else STATE.p2CharId = newCh.id;

    const key = player===this.p1 ? 'p1' : 'p2';
    if (newCh.id==='gunslinger' && !this.ammoIcons[key]) {
      const x = player===this.p1 ? 16 : CFG.W-112;
      this.ammoIcons[key] = this.makeAmmoRow(x, 52, player===this.p1 ? 0x6699ff : 0xff9944);
    } else if (newCh.id!=='gunslinger' && this.ammoIcons[key]) {
      this.ammoIcons[key].forEach(ic => ic.destroy()); this.ammoIcons[key] = null;
    }

    this.redrawHUD(); this.closeBarrack();
    this.hint('Now ' + newCh.player + ' — ' + newCh.title + '!', 2500);
  }

  refreshBarrackCards() {
    const otherId = (this.barrackOwner===this.p1 && this.p2) ? this.p2.charData.id : (this.barrackOwner===this.p2) ? this.p1.charData.id : null;
    this.bCards.forEach((card, i) => {
      const ch=CHARS[i], isSel=i===this.barrackSel, isCur=ch.id===this.barrackOwner.charData.id, isTaken=ch.id===otherId;
      card.box.clear();
      card.box.fillStyle(isSel?0x1e2e1e:0x0e0e1a, 0.96);
      card.box.fillRoundedRect(card.x-106, card.y-100, 212, 198, 10);
      card.box.lineStyle(isSel?3:2, isSel?0xcc8833:isCur?0x4488ff:isTaken?0x663333:0x2a2a3a);
      card.box.strokeRoundedRect(card.x-106, card.y-100, 212, 198, 10);
      card.spr.setAlpha(isTaken?0.28:1);
      card.stateT.setText(isCur?'(current)':isTaken?'(taken)':'');
      card.stateT.setColor(isCur?'#4488ff':'#ff4444');
    });
  }

  closeBarrack() {
    if (!this.barrackOpen) return;
    this.barrackOpen = false; this.barrackOwner = null;
    this.bObjs.forEach(o => o.setVisible(false));
  }

  // ── HINT ─────────────────────────────────────────────────────
  hint(text, duration) {
    // Destroy any existing hint immediately so they never overlap
    if (this._activeHint && this._activeHint.active) {
      this.tweens.killTweensOf(this._activeHint);
      this._activeHint.destroy();
    }
    const h = this.add.text(CFG.W/2, 112, text, {
      fontFamily:'monospace', fontSize:'14px', color:'#ffffff',
      stroke:'#000', strokeThickness:3, backgroundColor:'#00000099', padding:{x:12,y:6},
    }).setOrigin(0.5).setDepth(160).setAlpha(0);
    this.cameras.main.ignore(h);
    this._activeHint = h;
    this.tweens.add({ targets:h, alpha:1, duration:280,
      onComplete:()=>this.time.delayedCall(duration,()=>
        this.tweens.add({targets:h,alpha:0,duration:450,onComplete:()=>{ if(h===this._activeHint) this._activeHint=null; h.destroy(); }}))
    });
  }

  // ── UPDATE ────────────────────────────────────────────────────
  update(time, delta) {
    if (this.isOver) return;

    if (this.controlsVis || this.barrackOpen) {
      this.p1.spr.setVelocity(0,0);
      if (this.p2) this.p2.spr.setVelocity(0,0);
      return;
    }

    this.timeAlive += delta / 1000;

    // Movement — skip if downed or sleeping
    if (!this.p1.isDowned && !this.p1.isSleeping) {
      this.movePlayer(this.p1, this.wasd.left, this.wasd.right, this.wasd.up, this.wasd.down);
      // In 1P mode, facing is determined by mouse position
      if (this.solo) this.aimAtMouse(this.p1);
    }
    else this.p1.spr.setVelocity(0,0);

    if (this.p2) {
      if (!this.p2.isDowned && !this.p2.isSleeping) this.movePlayer(this.p2, this.cursors.left, this.cursors.right, this.cursors.up, this.cursors.down);
      else this.p2.spr.setVelocity(0,0);
    }

    // Tick attack cooldowns
    const tickCd = p => { if (p && p.atkCooldown > 0) p.atkCooldown -= delta; };
    tickCd(this.p1); tickCd(this.p2);

    // Toxic pool cooldown ticking
    if (this._toxicCd1 > 0) this._toxicCd1 -= delta;
    if (this._toxicCd2 > 0) this._toxicCd2 -= delta;

    // Tundra slowdown effect
    this.applyTundraSlowdown(this.p1);
    if (this.p2) this.applyTundraSlowdown(this.p2);

    this.syncLabels();
    this.updateCamera();
    this.checkBarrackRange();
    this.checkRadioTowerRange();
    this.checkDeaths();
    this.updateDowned(delta);
    this.updateRevive(delta);
    this.updateEnemies(delta);
    this.updateWaves(delta);
    this.updateEnemyDens(delta);
    this.updateSleep(delta);
    this.updateDayNight(delta);
    this.updateBuildMode();
    this.updateFog();
    this.updateMinimap();
    this.redrawHUD();
  }

  applyTundraSlowdown(player) {
    if (!player || player.isDowned) return;
    const TILE = CFG.TILE;
    const ptx = Math.floor(player.spr.x / TILE), pty = Math.floor(player.spr.y / TILE);
    const biome = getBiome(ptx, pty);
    if (biome === 'tundra') {
      const vx = player.spr.body.velocity.x, vy = player.spr.body.velocity.y;
      if (vx !== 0 || vy !== 0) {
        player.spr.setVelocity(vx * 0.7, vy * 0.7);
      }
    }
  }

  checkRadioTowerRange() {
    if (!this.radioTower || this.radioTower.used) {
      if (this.radioTower && this.radioTower.prompt) this.radioTower.prompt.setVisible(false);
      return;
    }
    const near = p => p && Phaser.Math.Distance.Between(p.spr.x, p.spr.y, this.radioTower.x, this.radioTower.y) < 80;
    this.radioTower.prompt.setVisible(near(this.p1) || near(this.p2));
  }

  updateEnemyDens(delta) {
    if (!this.enemyDens) return;
    this.enemyDens.forEach(den => {
      den.respawnTimer += delta;
      if (den.respawnTimer >= 30000) { // respawn enemies every 30s near dens
        den.respawnTimer = 0;
        const types = ['wolf','rat','rat'];
        const type = types[Phaser.Math.Between(0, types.length-1)];
        const typeDef = { wolf:{hp:60,speed:90,dmg:8,baseScale:1.8,w:20,h:12}, rat:{hp:30,speed:130,dmg:5,baseScale:1.4,w:15,h:9} };
        const t = typeDef[type];
        const sizeMult = Phaser.Math.FloatBetween(0.85, 1.3);
        const sc = t.baseScale * sizeMult;
        const ex = den.x + Phaser.Math.Between(-60, 60);
        const ey = den.y + Phaser.Math.Between(-60, 60);
        const spr = this.physics.add.image(ex, ey, type).setScale(sc).setDepth(8);
        spr.setCollideWorldBounds(true);
        spr.body.setSize(t.w, t.h);
        if (this.hudCam) this.hudCam.ignore(spr);
        this.physics.add.collider(spr, this.obstacles);
        const hp = Math.floor(t.hp * sizeMult);
        const dmg = Math.max(1, Math.floor(t.dmg * sizeMult));
        const spd = t.speed * (sizeMult < 0.85 ? 1.3 : sizeMult > 1.2 ? 0.8 : 1);
        const denBaseAggro = { wolf: 190, rat: 110, bear: 290 }[type] || 160;
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, type, attackTimer:0, wanderTimer:0, aggroRange:denBaseAggro, attackRange:30*sizeMult, sizeMult };
        this.enemies.push(e);
      }
    });
  }

  movePlayer(player, L, R, U, D) {
    const spd = player.charData.speed;
    let vx=0, vy=0;
    if (L.isDown) vx=-spd; if (R.isDown) vx=spd;
    if (U.isDown) vy=-spd; if (D.isDown) vy=spd;
    if (vx!==0 && vy!==0) { vx*=0.707; vy*=0.707; }
    player.spr.setVelocity(vx, vy);

    const moving = vx !== 0 || vy !== 0;
    const id = player.charData.id;

    if (moving) {
      // Determine facing direction
      if (Math.abs(vy) > Math.abs(vx)) {
        player.dir = vy > 0 ? 'front' : 'back';
      } else {
        player.dir = 'side';
      }
      // Walk cycle: toggle frame every ~10 update ticks
      player.walkTimer = (player.walkTimer + 1) % 20;
      const step = player.walkTimer < 10 ? '' : '_step';
      const dirSuffix = player.dir === 'side' ? '' : ('_' + player.dir);
      player.spr.setTexture(id + dirSuffix + step);
      // Flip for left movement (side view only)
      if (player.dir === 'side') {
        player.spr.setFlipX(vx < 0);
      } else {
        player.spr.setFlipX(false);
      }
    } else {
      player.walkTimer = 0;
      const dirSuffix = player.dir === 'side' ? '' : ('_' + player.dir);
      player.spr.setTexture(id + dirSuffix);
    }
  }

  aimAtMouse(player) {
    const cam = this.cameras.main;
    const pointer = this.input.activePointer;
    const worldX = pointer.x / cam.zoom + cam.worldView.x;
    const worldY = pointer.y / cam.zoom + cam.worldView.y;
    const angle = Phaser.Math.Angle.Between(player.spr.x, player.spr.y, worldX, worldY);
    // Convert angle to facing direction
    if (angle > -Math.PI/4 && angle <= Math.PI/4) {
      player.dir = 'side'; player.spr.setFlipX(false);
    } else if (angle > Math.PI/4 && angle <= 3*Math.PI/4) {
      player.dir = 'front';
    } else if (angle > -3*Math.PI/4 && angle <= -Math.PI/4) {
      player.dir = 'back';
    } else {
      player.dir = 'side'; player.spr.setFlipX(true);
    }
    // Store precise aim angle for attacks
    player.aimAngle = angle;
    // Update sprite — preserve walk cycle step frame
    const id = player.charData.id;
    const dirSuffix = player.dir === 'side' ? '' : ('_' + player.dir);
    const moving = player.spr.body.velocity.x !== 0 || player.spr.body.velocity.y !== 0;
    const step = (moving && player.walkTimer >= 10) ? '_step' : '';
    player.spr.setTexture(id + dirSuffix + step);
  }

  getAimAngle(player) {
    // In 1P mode, use precise mouse aim angle
    if (this.solo && player.aimAngle !== undefined) return player.aimAngle;
    // In 2P mode, use directional facing
    return player.dir === 'front'  ? Math.PI/2
         : player.dir === 'back'   ? -Math.PI/2
         : player.spr.flipX        ? Math.PI : 0;
  }

  syncLabels() {
    const sync = p => {
      const top = p.spr.y - p.spr.displayHeight/2;
      p.lbl.setPosition(p.spr.x, top - 8);
      // World-space HP bar above name label
      const bw = 42, bh = 5, bx = p.spr.x - bw/2, by = top - 20;
      p.hpBar.clear();
      p.hpBar.fillStyle(0x220000, 0.85); p.hpBar.fillRect(bx, by, bw, bh);
      const pct = Math.max(0, p.hp) / p.maxHp;
      if (pct > 0) {
        const col = pct > 0.5 ? 0x33dd33 : pct > 0.25 ? 0xeeaa00 : 0xdd2222;
        p.hpBar.fillStyle(col); p.hpBar.fillRect(bx, by, Math.floor(bw*pct), bh);
      }
    };
    sync(this.p1);
    if (this.p2) sync(this.p2);
  }

  updateCamera() {
    if (this.solo) return;
    const cam = this.cameras.main;
    const a = this.p1.spr, b = this.p2.spr;
    const midX=(a.x+b.x)/2, midY=(a.y+b.y)/2;
    const spread = Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y)) + CFG.CAM_PAD;
    const zoom = Phaser.Math.Clamp(Math.min(CFG.W/spread, CFG.H/spread), CFG.CAM_ZOOM_MIN, CFG.CAM_ZOOM_MAX);
    cam.zoom = Phaser.Math.Linear(cam.zoom, zoom, 0.06);
    cam.centerOn(midX, midY);
  }

  checkBarrackRange() {
    const near = p => p && Phaser.Math.Distance.Between(p.spr.x, p.spr.y, this.bPos.x, this.bPos.y) < 110;
    this.bPrompt.setVisible(near(this.p1) || near(this.p2));
  }

  doAttack(player) {
    if (player.atkCooldown > 0) return;
    const id = player.charData.id;
    if (id === 'gunslinger') {
      if (player.ammo <= 0) {
        // Pistol whip — melee fallback when out of ammo in clip
        SFX.wrench();
        player.atkCooldown = 500;
        this.meleeSwing(player, 38, 0xcc8833, 0.22, 0);
        this.hint('Out of ammo! Pistol whip!', 1200);
        return;
      }
      player.ammo--;
      this.redrawHUD();
      SFX.shoot();
      const angle = this.getAimAngle(player);
      const blt = this.physics.add.image(player.spr.x, player.spr.y, 'bullet').setDepth(15).setScale(1.5);
      blt.setRotation(angle);
      if (this.hudCam) this.hudCam.ignore(blt);
      this.physics.velocityFromAngle(Phaser.Math.RadToDeg(angle), 600, blt.body.velocity);
      blt.body.allowGravity = false;
      if (this.enemies) {
        this.enemies.forEach(e => {
          if (e.hp <= 0) return;
          this.physics.add.overlap(blt, e.spr, () => {
            if (!blt.active) return;
            blt.destroy();
            e.hp -= 35;
            SFX.hit();
            e.spr.setTint(0xff6644);
            this.time.delayedCall(100, () => { if (e.spr.active) e.spr.clearTint(); });
            if (e.hp <= 0) this.killEnemy(e);
          });
        });
      }
      this.time.delayedCall(1200, () => { if (blt.active) blt.destroy(); });
      player.atkCooldown = 350;
    } else if (id === 'knight') {
      SFX.sword();
      player.atkCooldown = 500;
      this.meleeSwing(player, 55, 0xdddddd, 0.18, 0);
    } else {
      SFX.wrench();
      player.atkCooldown = 450;
      this.meleeSwing(player, 45, 0xcc8833, 0.2, 350);
    }
  }

  doAlt(player) {
    const id = player.charData.id;
    if (id === 'gunslinger') {
      if (player.ammo < 8 && !player.reloading && player.reserveAmmo > 0) {
        player.reloading = true;
        SFX.reload();
        this.hint('Reloading\u2026 (' + player.reserveAmmo + ' in reserve)', 1500);
        this.time.delayedCall(1500, () => {
          const needed = 8 - player.ammo;
          const fill = Math.min(needed, player.reserveAmmo);
          player.ammo += fill;
          player.reserveAmmo -= fill;
          player.reloading = false;
          this.redrawHUD(); SFX.reload();
        });
      } else if (player.reserveAmmo <= 0 && player.ammo < 8) {
        this.hint('No ammo left! Find more drops.', 2000);
      }
    } else if (id === 'knight') {
      // RALLY — war cry boosts partner's speed for 5 seconds
      if (player.rallyCooldown > 0) return;
      player.rallyCooldown = 15000;
      this.tickCooldown(player, 'rallyCooldown', 15000);
      SFX._play(330, 'square', 0.15, 0.5, 'rise');
      SFX._play(440, 'square', 0.2, 0.4, 'rise');
      this.hint('RALLY! Speed boost!', 2000);
      // Boost visual
      const fx = this.add.graphics().setDepth(20);
      if (this.hudCam) this.hudCam.ignore(fx);
      fx.lineStyle(3, 0xffdd44, 0.8);
      fx.strokeCircle(player.spr.x, player.spr.y, 60);
      this.tweens.add({ targets:fx, alpha:0, duration:800, onComplete:()=>fx.destroy() });
      // Boost partner speed
      const partner = player === this.p1 ? this.p2 : this.p1;
      if (partner && !partner.isDowned) {
        const origSpeed = partner.charData.speed;
        partner.charData.speed = Math.floor(origSpeed * 1.5);
        partner.spr.setTint(0xffdd44);
        this.time.delayedCall(5000, () => {
          partner.charData.speed = origSpeed;
          if (partner.spr.active) partner.spr.clearTint();
        });
      }
    } else if (id === 'architect') {
      // ORCHESTRATE — deploy auto-turret for 30 seconds
      if (player.turretCooldown > 0) return;
      player.turretCooldown = 45000;
      this.tickCooldown(player, 'turretCooldown', 45000);
      SFX._play(500, 'square', 0.1, 0.3);
      SFX._play(700, 'triangle', 0.08, 0.2);
      this.hint('Turret deployed!', 2000);
      this.deployTurret(player.spr.x, player.spr.y);
    }
  }

  tickCooldown(player, key, dur) {
    const timer = this.time.addEvent({
      delay: 100, repeat: dur / 100,
      callback: () => { player[key] = Math.max(0, player[key] - 100); }
    });
  }

  deployTurret(x, y) {
    const turret = this.add.graphics().setDepth(15);
    if (this.hudCam) this.hudCam.ignore(turret);
    // Draw turret
    turret.fillStyle(0x557755); turret.fillRect(x-8, y-8, 16, 16);
    turret.fillStyle(0x88aa88); turret.fillRect(x-5, y-12, 10, 4);
    turret.fillStyle(0x446644); turret.fillRect(x-2, y-16, 4, 6);

    let lifetime = 30000;
    const shootTimer = this.time.addEvent({
      delay: 800, loop: true,
      callback: () => {
        if (!this.enemies) return;
        let nearest = null, nearDist = Infinity;
        this.enemies.forEach(e => {
          if (e.hp <= 0 || !e.spr.active) return;
          const d = Phaser.Math.Distance.Between(x, y, e.spr.x, e.spr.y);
          if (d < 200 && d < nearDist) { nearDist = d; nearest = e; }
        });
        if (nearest) {
          SFX.shoot();
          const ang = Phaser.Math.Angle.Between(x, y, nearest.spr.x, nearest.spr.y);
          // Visual bullet line
          const bfx = this.add.graphics().setDepth(16);
          if (this.hudCam) this.hudCam.ignore(bfx);
          bfx.lineStyle(2, 0xddff44, 0.8);
          bfx.lineBetween(x, y-10, nearest.spr.x, nearest.spr.y);
          this.tweens.add({ targets:bfx, alpha:0, duration:150, onComplete:()=>bfx.destroy() });
          nearest.hp -= 15;
          nearest.spr.setTint(0xff6644);
          this.time.delayedCall(100, () => { if(nearest.spr.active) nearest.spr.clearTint(); });
          if (nearest.hp <= 0) this.killEnemy(nearest);
        }
      }
    });
    this.time.delayedCall(lifetime, () => {
      shootTimer.destroy();
      this.tweens.add({ targets:turret, alpha:0, duration:500, onComplete:()=>turret.destroy() });
    });
  }

  meleeSwing(player, range, color, dur, knockback) {
    const fx = this.add.graphics().setDepth(20);
    if (this.hudCam) this.hudCam.ignore(fx);
    // Direction-based arc center and angle
    const dirAngle = this.getAimAngle(player);
    const cx = player.spr.x + Math.cos(dirAngle) * 20;
    const cy = player.spr.y + Math.sin(dirAngle) * 20;
    const startA = dirAngle - 0.8, endA = dirAngle + 0.8;
    fx.lineStyle(3, color, 0.9);
    fx.beginPath();
    fx.arc(cx, cy, range, startA, endA);
    fx.strokePath();
    fx.lineStyle(2, color, 0.5);
    fx.beginPath();
    fx.arc(cx, cy, range+6, startA+0.2, endA-0.2);
    fx.strokePath();
    if (this.enemies) {
      this.enemies.forEach(e => {
        if (e.hp <= 0) return;
        const d = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, e.spr.x, e.spr.y);
        if (d < range + 20) {
          // Check enemy is roughly in facing direction
          const angToE = Phaser.Math.Angle.Between(player.spr.x, player.spr.y, e.spr.x, e.spr.y);
          const diff = Phaser.Math.Angle.Wrap(angToE - dirAngle);
          if (Math.abs(diff) > Math.PI * 0.65) return;
          e.hp -= player.charData.id==='knight' ? 45 : 30;
          SFX.hit();
          e.spr.setTint(0xff6644);
          this.time.delayedCall(120, () => { if(e.spr.active) e.spr.clearTint(); });
          // Knockback (architect wrench)
          if (knockback && e.spr.body) {
            const kb = knockback;
            e.spr.body.velocity.x += Math.cos(angToE) * kb;
            e.spr.body.velocity.y += Math.sin(angToE) * kb;
          }
          if (e.hp <= 0) this.killEnemy(e);
        }
      });
    }
    this.tweens.add({ targets:fx, alpha:0, duration:dur*1000, onComplete:()=>fx.destroy() });
  }

  killEnemy(e) {
    e.hp = 0;
    SFX.enemyDie();
    e.spr.setTint(0xff2200);
    const ex = e.spr.x, ey = e.spr.y;
    this.time.delayedCall(200, () => {
      if (e.spr.active) e.spr.destroy();
      if (e.lbl && e.lbl.active) e.lbl.destroy();
    });
    // Drop resources
    this.dropResource(ex, ey, e.type);
  }

  dropResource(x, y, enemyType) {
    const drops = [];
    // All enemies drop food sometimes
    if (Math.random() < 0.4) drops.push('item_food');
    // Type-specific drops
    if (enemyType === 'wolf') {
      if (Math.random() < 0.5) drops.push('item_fiber');
      if (Math.random() < 0.3) drops.push('item_metal');
    } else if (enemyType === 'rat') {
      if (Math.random() < 0.6) drops.push('item_fiber');
      if (Math.random() < 0.25) drops.push('item_ammo');
    } else if (enemyType === 'bear') {
      drops.push('item_metal');
      if (Math.random() < 0.5) drops.push('item_wood');
      if (Math.random() < 0.4) drops.push('item_fiber');
    }
    drops.forEach((key, i) => {
      const dx = x + (i-drops.length/2) * 14;
      const item = this.physics.add.image(dx, y+8, key).setScale(2).setDepth(7);
      item.body.allowGravity = false;
      item.body.setImmovable(true);
      if (this.hudCam) this.hudCam.ignore(item);
      item.itemType = key.replace('item_', '');
      // Pickup overlap with players
      const pickupCb = (playerSpr) => {
        const player = playerSpr === this.p1.spr ? this.p1 : this.p2;
        if (!player) return;
        if (item.itemType === 'ammo' && player.charData.id === 'gunslinger') {
          const maxReserve = 40 - player.ammo;
          player.reserveAmmo = Math.min(maxReserve, player.reserveAmmo + 3);
          this.redrawHUD();
        } else if (item.itemType === 'food') {
          player.hp = Math.min(player.maxHp, player.hp + 15);
        } else {
          player.inv[item.itemType] = (player.inv[item.itemType] || 0) + 1;
        }
        SFX._play(600, 'triangle', 0.06, 0.2);
        item.destroy();
      };
      this.physics.add.overlap(this.p1.spr, item, () => { if(item.active) pickupCb(this.p1.spr); });
      if (this.p2) this.physics.add.overlap(this.p2.spr, item, () => { if(item.active) pickupCb(this.p2.spr); });
      // Despawn after 20 seconds
      this.time.delayedCall(20000, () => { if(item.active) { this.tweens.add({ targets:item, alpha:0, duration:500, onComplete:()=>item.destroy() }); }});
    });
  }

  spawnEnemies(worldW, worldH, cx, cy) {
    this.enemyWorldW = worldW; this.enemyWorldH = worldH;
    this.enemyCX = cx; this.enemyCY = cy;
    this.enemies = [];
    this.waveNum = 0;
    this.waveTimer = 0;
    this.WAVE_INTERVAL = 60000; // 60 seconds between waves
    this._spawnGroup(worldW, worldH, cx, cy, { wolf:12, rat:18, bear:6 }, false);
  }

  _spawnGroup(worldW, worldH, cx, cy, counts, fromEdges) {
    const { TILE, SAFE_R } = CFG;
    const types = [
      { key:'wolf', hp:60,  speed:90,  dmg:8,  baseScale:1.8, w:20, h:12 },
      { key:'rat',  hp:30,  speed:130, dmg:5,  baseScale:1.4, w:15, h:9  },
      { key:'bear', hp:140, speed:55,  dmg:18, baseScale:2.2, w:24, h:18 },
    ];
    types.forEach(t => {
      const n = counts[t.key] || 0;
      for (let i=0; i<n; i++) {
        let ex, ey;
        if (fromEdges) {
          // Spawn from map edges
          const side = Phaser.Math.Between(0,3);
          if (side===0)      { ex = Phaser.Math.Between(TILE*3, worldW-TILE*3); ey = TILE*4; }
          else if (side===1) { ex = Phaser.Math.Between(TILE*3, worldW-TILE*3); ey = worldH-TILE*4; }
          else if (side===2) { ex = TILE*4; ey = Phaser.Math.Between(TILE*3, worldH-TILE*3); }
          else               { ex = worldW-TILE*4; ey = Phaser.Math.Between(TILE*3, worldH-TILE*3); }
        } else {
          do {
            ex = Phaser.Math.Between(TILE*3, worldW-TILE*3);
            ey = Phaser.Math.Between(TILE*3, worldH-TILE*3);
          } while (Phaser.Math.Distance.Between(ex, ey, cx, cy) < SAFE_R*TILE*2.5);
        }
        // Size variance: 0.85x to 1.5x — floor raised so enemies are never too small to see
        const sizeMult = Phaser.Math.FloatBetween(0.85, 1.5);
        const sc = t.baseScale * sizeMult;
        const hp = Math.floor(t.hp * sizeMult);
        const dmg = Math.max(1, Math.floor(t.dmg * sizeMult));
        const spd = t.speed * (sizeMult < 0.85 ? 1.3 : sizeMult > 1.2 ? 0.8 : 1);
        const spr = this.physics.add.image(ex, ey, t.key).setScale(sc).setDepth(8);
        spr.setCollideWorldBounds(true);
        spr.body.setSize(t.w, t.h);
        if (this.hudCam) this.hudCam.ignore(spr);
        this.physics.add.collider(spr, this.obstacles);
        // Per-type aggro ranges: bears are territorial (wide), rats are skittish (narrow)
        const baseAggro = { wolf: 190, rat: 110, bear: 290 }[t.key] || 160;
        const aggroR = baseAggro * (sizeMult > 1.2 ? 1.2 : 1);
        const atkR = (30 + t.w/2) * sizeMult;
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, type:t.key, attackTimer:0, wanderTimer:Phaser.Math.Between(0,2000), aggroRange:aggroR, attackRange:atkR, sizeMult };
        this.enemies.push(e);
      }
    });
  }

  updateWaves(delta) {
    this.waveTimer += delta;
    if (this.waveTimer >= this.WAVE_INTERVAL) {
      this.waveTimer = 0;
      this.waveNum++;
      // Escalating counts
      const w = Math.min(6 + this.waveNum * 2, 20);
      const r = Math.min(8 + this.waveNum * 3, 30);
      const b = Math.min(1 + this.waveNum, 8);
      this._spawnGroup(this.enemyWorldW, this.enemyWorldH, this.enemyCX, this.enemyCY, { wolf:w, rat:r, bear:b }, true);
      this.hint('Wave ' + (this.waveNum+1) + '! Enemies approaching from the wastes!', 3000);
      SFX._play(200, 'sawtooth', 0.3, 0.4, 'drop');
    }
  }

  updateEnemies(delta) {
    if (!this.enemies || this.isOver) return;
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && p.hp > 0 && p.spr.visible);

    this.enemies.forEach(e => {
      if (e.hp <= 0 || !e.spr.active) return;
      let nearest = null, nearDist = Infinity;
      players.forEach(p => {
        const d = Phaser.Math.Distance.Between(e.spr.x, e.spr.y, p.spr.x, p.spr.y);
        if (d < nearDist) { nearDist = d; nearest = p; }
      });
      if (!nearest) { e.spr.setVelocity(0,0); return; }
      const nightMult = (this.isNight) ? 1.35 : 1;
      const aggroRange = e.aggroRange * nightMult;

      if (nearDist < aggroRange) {
        const ang = Phaser.Math.Angle.Between(e.spr.x, e.spr.y, nearest.spr.x, nearest.spr.y);
        const spd = e.speed * nightMult;
        e.spr.setVelocity(Math.cos(ang)*spd, Math.sin(ang)*spd);
        e.spr.setFlipX(nearest.spr.x < e.spr.x);
        if (nearDist < e.attackRange) {
          e.attackTimer -= delta;
          if (e.attackTimer <= 0) {
            nearest.hp -= e.dmg;
            nearest.hp = Math.max(0, nearest.hp);
            SFX.playerHurt();
            if (nearest.isSleeping) { this.wakePlayer(nearest); this.hint(nearest.charData.player + ' woke up!', 1500); }
            nearest.spr.setTint(0xff0000);
            this.time.delayedCall(150, () => { if(nearest.spr.active) nearest.spr.clearTint(); });
            e.attackTimer = e.type==='bear' ? 2200 : e.type==='wolf' ? 1400 : 900;
            this.checkDeaths();
          }
        }
      } else {
        e.wanderTimer -= delta;
        if (e.wanderTimer <= 0) {
          const ang = Math.random() * Math.PI * 2;
          const spd = e.speed * 0.3;
          e.spr.setVelocity(Math.cos(ang)*spd, Math.sin(ang)*spd);
          e.wanderTimer = Phaser.Math.Between(1500, 3500);
        }
      }
    });
  }

  updateDayNight(delta) {
    this.dayTimer += delta * (this.sleepSpeedMult || 1);
    const cycle = this.dayTimer % this.DAY_DUR;
    const pct = cycle / this.DAY_DUR;
    const worldW = CFG.MAP_W * CFG.TILE, worldH = CFG.MAP_H * CFG.TILE;

    let nightAlpha = 0;
    if (pct < 0.55) nightAlpha = 0;
    else if (pct < 0.7) nightAlpha = ((pct-0.55)/0.15) * 0.6;
    else if (pct < 0.9) nightAlpha = 0.6;
    else nightAlpha = ((1-pct)/0.1) * 0.6;

    const wasNight = this.isNight;
    this.isNight = nightAlpha > 0.2;
    this.nightOverlay.clear();
    if (nightAlpha > 0.01) {
      this.nightOverlay.fillStyle(0x000033, nightAlpha);
      this.nightOverlay.fillRect(0, 0, worldW, worldH);
    }

    // Music transitions
    if (this.isNight && !wasNight) {
      Music.switchToNight();
    }

    const newDay = Math.floor(this.dayTimer / this.DAY_DUR) + 1;
    if (newDay !== this.dayNum) {
      this.dayNum = newDay;
      Music.switchToDay();
      this.hint('Dawn of Day ' + this.dayNum + ' \u2014 enemies grow stronger!', 3000);
    }

    if (this.dayText) this.dayText.setText('DAY ' + this.dayNum);

    // Draw clock arc indicator
    if (this.clockGfx) {
      this.clockGfx.clear();
      const cx = CFG.W / 2, cy = 38, r = 10;
      // Background circle
      this.clockGfx.lineStyle(2, 0x333344, 0.6);
      this.clockGfx.strokeCircle(cx, cy, r);
      // Progress arc (sun = gold, dusk = orange, night = blue, dawn = pink)
      let arcColor;
      if (pct < 0.55) arcColor = 0xffdd44;        // day
      else if (pct < 0.7) arcColor = 0xff8833;     // dusk
      else if (pct < 0.9) arcColor = 0x4466cc;     // night
      else arcColor = 0xdd7799;                     // dawn
      this.clockGfx.lineStyle(3, arcColor, 0.9);
      this.clockGfx.beginPath();
      this.clockGfx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + pct * Math.PI * 2, false, 0.02);
      this.clockGfx.strokePath();
      // Small icon dot at current position
      const dotAngle = -Math.PI/2 + pct * Math.PI * 2;
      const dx = cx + Math.cos(dotAngle) * r;
      const dy = cy + Math.sin(dotAngle) * r;
      this.clockGfx.fillStyle(arcColor, 1);
      this.clockGfx.fillCircle(dx, dy, 3);
    }
  }

  // ── CRATE PICKUPS ─────────────────────────────────────────────
  setupCratePickups() {
    if (!this.worldCrates) return;
    this.worldCrates.forEach(crate => {
      const pickupCrate = (player) => {
        if (!crate.active) return;
        if (crate.itemType === 'ammo' && player.charData.id === 'gunslinger') {
          const maxReserve = 40 - player.ammo;
          player.reserveAmmo = Math.min(maxReserve, player.reserveAmmo + 4);
          this.redrawHUD();
        } else if (crate.itemType === 'food') {
          player.hp = Math.min(player.maxHp, player.hp + 20);
        } else {
          player.inv[crate.itemType] = (player.inv[crate.itemType] || 0) + 2;
        }
        SFX._play(600, 'triangle', 0.06, 0.2);
        crate.destroy();
      };
      this.physics.add.overlap(this.p1.spr, crate, () => { if(crate.active) pickupCrate(this.p1); });
      if (this.p2) this.physics.add.overlap(this.p2.spr, crate, () => { if(crate.active) pickupCrate(this.p2); });
    });
  }

  // ── BUILD SYSTEM ──────────────────────────────────────────────
  toggleBuildMode(player) {
    const BUILD_TYPES = ['wall', 'gate', 'campfire', 'craftbench', 'bed'];
    if (this.buildMode && this.buildOwner === player) {
      // Cycle to next build type, exit after last
      const idx = BUILD_TYPES.indexOf(this.buildType);
      if (idx >= BUILD_TYPES.length - 1) {
        this.exitBuildMode();
        this.hint('Build mode off', 1000);
        return;
      }
      this.buildType = BUILD_TYPES[idx + 1];
      const cost = this.getBuildCost(this.buildType);
      const costStr = Object.entries(cost).map(([k,v])=>v+' '+k).join(', ');
      this.hint('Build: ' + this.buildType.toUpperCase() + ' (cost: ' + costStr + ')', 2000);
      return;
    }
    this.buildMode = true;
    this.buildOwner = player;
    this.buildType = 'wall';
    this.buildRotation = 0;
    if (this.buildGhost) this.buildGhost.destroy();
    this.buildGhost = this.add.image(player.spr.x + 40, player.spr.y, 'build_ghost').setDepth(50).setAlpha(0.6);
    if (this.hudCam) this.hudCam.ignore(this.buildGhost);
    this.hint('BUILD: Q/0=cycle | Attack=place | R/1=rotate | Cost: 3 wood', 3000);
    this.buildRotKey1 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.buildRotKey2 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
  }

  exitBuildMode() {
    this.buildMode = false;
    this.buildOwner = null;
    if (this.buildGhost) { this.buildGhost.destroy(); this.buildGhost = null; }
  }

  updateBuildMode() {
    if (!this.buildMode || !this.buildOwner) return;
    const p = this.buildOwner;
    const TILE = CFG.TILE;
    // Position ghost in front of player
    const dirAngle = p.dir === 'front'  ? Math.PI/2
                   : p.dir === 'back'   ? -Math.PI/2
                   : p.spr.flipX        ? Math.PI : 0;
    const gx = Math.round((p.spr.x + Math.cos(dirAngle) * 48) / TILE) * TILE;
    const gy = Math.round((p.spr.y + Math.sin(dirAngle) * 48) / TILE) * TILE;
    if (this.buildGhost) {
      this.buildGhost.setPosition(gx, gy);
      this.buildGhost.setAngle(this.buildRotation * 90);
    }

    // Check for type cycle (same key as build mode — double tap cycles)
    if (Phaser.Input.Keyboard.JustDown(this.buildRotKey1) || Phaser.Input.Keyboard.JustDown(this.buildRotKey2)) {
      this.buildRotation = (this.buildRotation + 1) % 4;
    }
  }

  placeBuild() {
    if (!this.buildMode || !this.buildGhost) return;
    const p = this.buildOwner;
    const x = this.buildGhost.x, y = this.buildGhost.y;

    // Bed requires craftbench to be built first
    if (this.buildType === 'bed' && !this.craftBenchPlaced) {
      this.hint('Need a Craftbench first to build a bed!', 2500);
      return;
    }

    const cost = this.getBuildCost(this.buildType);
    // Check resources (use team total — both players)
    const team = this.getTeamInv();
    for (const [res, amt] of Object.entries(cost)) {
      if ((team[res] || 0) < amt) {
        this.hint('Need ' + amt + ' ' + res + '! (have ' + (team[res]||0) + ')', 2000);
        return;
      }
    }
    // Deduct from builder first, then partner
    for (const [res, amt] of Object.entries(cost)) {
      let left = amt;
      if (p.inv[res] >= left) { p.inv[res] -= left; left = 0; }
      else { left -= p.inv[res]; p.inv[res] = 0; }
      if (left > 0) {
        const partner = p === this.p1 ? this.p2 : this.p1;
        if (partner) partner.inv[res] = Math.max(0, partner.inv[res] - left);
      }
    }

    // Place the structure
    if (this.buildType === 'wall') {
      const w = this.obstacles.create(x, y, 'wall').setDepth(5).setImmovable(true);
      w.setAngle(this.buildRotation * 90);
      w.refreshBody();
      this.builtWalls.push(w);
      if (this.hudCam) this.hudCam.ignore(w);
    } else if (this.buildType === 'gate') {
      const gate = this.physics.add.image(x, y, 'wall').setDepth(5).setTint(0x88aaff);
      gate.setAngle(this.buildRotation * 90);
      gate.body.setImmovable(true);
      gate.body.allowGravity = false;
      gate.isGate = true; gate.gateOpen = false;
      if (this.hudCam) this.hudCam.ignore(gate);
      // Players can open/close by walking near
      this.builtWalls.push(gate);
      // Enemies collide with gate
      this.enemies.forEach(e => { if (e.spr.active) this.physics.add.collider(e.spr, gate); });
      this.physics.add.collider(this.p1.spr, gate, () => this.openGate(gate));
      if (this.p2) this.physics.add.collider(this.p2.spr, gate, () => this.openGate(gate));
    } else if (this.buildType === 'campfire') {
      const cf = this.add.image(x, y, 'campfire').setScale(2).setDepth(5);
      if (this.hudCam) this.hudCam.ignore(cf);
      this._w(cf);
      // Register as minimap POI
      const cfTX = Math.floor(x / CFG.TILE), cfTY = Math.floor(y / CFG.TILE);
      this.pois.push({ type: 'campfire', tx: cfTX, ty: cfTY, spr: cf });
      // Campfire heals nearby players over time
      this.time.addEvent({
        delay: 2000, loop: true,
        callback: () => {
          if (!cf.active) return;
          [this.p1, this.p2].filter(Boolean).forEach(pl => {
            if (pl.isDowned) return;
            const d = Phaser.Math.Distance.Between(pl.spr.x, pl.spr.y, cf.x, cf.y);
            if (d < 80) {
              pl.hp = Math.min(pl.maxHp, pl.hp + 3);
            }
          });
        }
      });
    } else if (this.buildType === 'craftbench') {
      const cb = this.add.image(x, y, 'craftbench').setScale(2).setDepth(5);
      if (this.hudCam) this.hudCam.ignore(cb);
      this._w(cb);
      this.craftBenchPlaced = true;
      this.craftBenchPos = { x, y };
      // Register as minimap POI
      const cbTX = Math.floor(x / CFG.TILE), cbTY = Math.floor(y / CFG.TILE);
      this.pois.push({ type: 'craftbench', tx: cbTX, ty: cbTY, spr: cb });
    } else if (this.buildType === 'bed') {
      const bd = this.add.image(x, y, 'bed').setScale(2).setDepth(5);
      if (this.hudCam) this.hudCam.ignore(bd);
      this._w(bd);
      const bedTX = Math.floor(x / CFG.TILE), bedTY = Math.floor(y / CFG.TILE);
      this.beds.push({ x, y, spr: bd });
      this.pois.push({ type: 'bed', tx: bedTX, ty: bedTY, spr: bd });
      // Show E prompt when players are nearby
      const bedPrompt = this._w(this.add.text(x, y - 30, 'E / Enter \u2014 sleep', {
        fontFamily: 'monospace', fontSize: '11px', color: '#ccaaff', backgroundColor: '#110022'
      }).setDepth(20).setOrigin(0.5).setVisible(false));
      if (this.hudCam) this.hudCam.ignore(bedPrompt);
      this._bedPrompts = this._bedPrompts || [];
      this._bedPrompts.push({ bed: { x, y }, prompt: bedPrompt });
    }

    SFX._play(400, 'triangle', 0.08, 0.2);
    this.hint(this.buildType.charAt(0).toUpperCase() + this.buildType.slice(1) + ' placed!', 1500);
  }

  openGate(gate) {
    if (gate.gateOpen) return;
    gate.gateOpen = true;
    gate.setAlpha(0.3);
    gate.body.enable = false;
    this.time.delayedCall(2000, () => {
      gate.gateOpen = false;
      gate.setAlpha(1);
      gate.body.enable = true;
    });
  }

  getBuildCost(type) {
    const costs = {
      wall:       { wood: 3 },
      gate:       { wood: 4, metal: 2 },
      campfire:   { wood: 5 },
      craftbench: { wood: 5, metal: 3 },
      bed:        { wood: 8, fiber: 6, metal: 2 },  // requires craftbench — deliberately costly
    };
    return costs[type] || {};
  }

  getTeamInv() {
    const inv = { wood:0, metal:0, fiber:0, food:0 };
    [this.p1, this.p2].filter(Boolean).forEach(p => {
      for (const k of Object.keys(inv)) inv[k] += (p.inv[k] || 0);
    });
    return inv;
  }
}

// ── SCENE: GAME OVER ─────────────────────────────────────────
class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  init(data) {
    this.reason    = data.reason    || 'You have fallen.';
    this.timeAlive = data.timeAlive || 0;
    this.mode      = data.mode      || 1;
    this.difficulty= data.difficulty|| 'survival';
  }

  create() {
    const { W, H } = CFG;
    this.cameras.main.fadeIn(500, 0, 0, 0);

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1a0000, 0x1a0000, 0x000000, 0x000000, 1);
    bg.fillRect(0, 0, W, H);

    // Skull or title
    this.add.text(W/2, H*0.22, 'GAME OVER', {
      fontFamily:'monospace', fontSize:'72px', color:'#cc2222',
      stroke:'#440000', strokeThickness:8,
      shadow:{offsetX:6, offsetY:6, color:'#000', blur:10, fill:true},
    }).setOrigin(0.5);

    this.add.text(W/2, H*0.40, this.reason, {
      fontFamily:'monospace', fontSize:'22px', color:'#cc8855',
      stroke:'#000', strokeThickness:3,
    }).setOrigin(0.5);

    // Stats
    const mins = Math.floor(this.timeAlive / 60);
    const secs = Math.floor(this.timeAlive % 60);
    const timeStr = mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
    const modeTxt = (this.mode===1?'1 Player':'2 Players') + '  ·  ' + (this.difficulty==='hardcore'?'HARDCORE':'SURVIVAL');

    this.add.text(W/2, H*0.52, 'Time survived:  ' + timeStr, {
      fontFamily:'monospace', fontSize:'20px', color:'#888888',
    }).setOrigin(0.5);

    this.add.text(W/2, H*0.60, modeTxt, {
      fontFamily:'monospace', fontSize:'16px', color:'#555566',
    }).setOrigin(0.5);

    // Prompt
    const prompt = this.add.text(W/2, H*0.76, 'PRESS ENTER or SPACE to try again', {
      fontFamily:'monospace', fontSize:'20px', color:'#ffffff',
    }).setOrigin(0.5);
    this.tweens.add({ targets:prompt, alpha:0.2, duration:600, yoyo:true, repeat:-1 });

    this.add.text(W/2, H*0.86, 'ESC — back to mode select', {
      fontFamily:'monospace', fontSize:'14px', color:'#444455',
    }).setOrigin(0.5);

    const K = Phaser.Input.Keyboard.KeyCodes;
    const keys = this.input.keyboard.addKeys({ enter:K.ENTER, space:K.SPACE, esc:K.ESC });
    keys.enter.on('down', () => this.restart());
    keys.space.on('down', () => this.restart());
    keys.esc.on('down',   () => this.goMenu());
  }

  restart() {
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.time.delayedCall(300, () => this.scene.start('CharSelect'));
  }

  goMenu() {
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.time.delayedCall(300, () => this.scene.start('ModeSelect'));
  }
}

// ── LAUNCH ────────────────────────────────────────────────────
new Phaser.Game({
  type: Phaser.AUTO,
  width: CFG.W, height: CFG.H,
  backgroundColor: '#0a0a0a',
  pixelArt: true,
  physics: { default:'arcade', arcade:{ gravity:{y:0}, debug:false } },
  scale: { mode:Phaser.Scale.FIT, autoCenter:Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, ModeSelectScene, CharSelectScene, GameScene, GameOverScene],
});
