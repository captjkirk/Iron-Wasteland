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

  // Rock — polygon-based with lit top face for depth
  g.clear();
  // Main body: dark warm-grey base mass
  g.fillStyle(0x706860);
  g.fillPoints([{x:2,y:15},{x:0,y:9},{x:3,y:3},{x:9,y:1},{x:15,y:1},{x:20,y:4},{x:22,y:10},{x:18,y:15}], true);
  // Top-left highlight face: lighter grey creates lit-top depth illusion
  g.fillStyle(0xc0b8a8);
  g.fillPoints([{x:3,y:13},{x:1,y:8},{x:4,y:3},{x:9,y:2},{x:14,y:2},{x:17,y:6},{x:18,y:11},{x:15,y:13}], true);
  // Cracks: thin dark lines for texture
  g.lineStyle(1, 0x3e3836);
  g.beginPath(); g.moveTo(8,7); g.lineTo(11,11); g.lineTo(9,15); g.strokePath();
  g.beginPath(); g.moveTo(14,4); g.lineTo(16,8); g.strokePath();
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
  drawKnightFSide(g);  drawKnightFSideStep(g);
  drawKnightBSide(g);  drawKnightBSideStep(g);
  drawGunslinger(g);       drawGunslingerStep(g);
  drawGunslingerFront(g);  drawGunslingerFrontStep(g);
  drawGunslingerBack(g);   drawGunslingerBackStep(g);
  drawGunslingerFSide(g);  drawGunslingerFSideStep(g);
  drawGunslingerBSide(g);  drawGunslingerBSideStep(g);
  drawArchitect(g);       drawArchitectStep(g);
  drawArchitectFront(g);  drawArchitectFrontStep(g);
  drawArchitectBack(g);   drawArchitectBackStep(g);
  drawArchitectFSide(g);  drawArchitectFSideStep(g);
  drawArchitectBSide(g);  drawArchitectBSideStep(g);

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

  // Rare boss drop — glowing crystal shard
  g.clear();
  g.fillStyle(0xff6600); g.fillTriangle(5, 0, 0, 10, 10, 10);
  g.fillStyle(0xffaa44); g.fillTriangle(5, 2, 2, 9, 8, 9);
  g.fillStyle(0xffdd88); g.fillRect(4, 3, 2, 4);
  g.generateTexture('item_rare', 10, 10);

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

  // Swamp tree — dark murky green with hanging moss
  g.clear();
  g.fillStyle(0x2a1c08); g.fillRect(10, 20, 8, 16);
  g.fillStyle(0x1e1406); g.fillRect(10, 20, 2, 16);
  g.fillStyle(0x1a3012); g.fillCircle(14, 14, 12);
  g.fillStyle(0x223818); g.fillCircle(14, 11, 9);
  g.fillStyle(0x0e1a0a); g.fillCircle(11, 13, 3);
  // Hanging moss streaks
  g.fillStyle(0x1c2e14); g.fillRect(8, 18, 2, 9); g.fillRect(14, 17, 2, 8); g.fillRect(19, 18, 2, 10);
  g.fillStyle(0x162410); g.fillRect(11, 19, 1, 7); g.fillRect(17, 18, 1, 8);
  g.generateTexture('tree_swamp', 28, 36);

  // Great Oak — wide round canopy, thick trunk, grassland landmark (40×52)
  g.clear();
  g.fillStyle(0x5c3415); g.fillRect(15, 33, 10, 19);
  g.fillStyle(0x3d2010); g.fillRect(15, 33, 3, 19);
  g.fillStyle(0x6e4022); g.fillRect(21, 35, 3, 17);
  // Root buttresses
  g.fillStyle(0x5c3415); g.fillTriangle(8, 52, 17, 42, 17, 52);
  g.fillStyle(0x5c3415); g.fillTriangle(32, 52, 23, 42, 23, 52);
  // Canopy layers — dark to bright (bottom to top)
  g.fillStyle(0x144010); g.fillEllipse(20, 29, 38, 28);
  g.fillStyle(0x1e5818); g.fillEllipse(20, 23, 32, 24);
  g.fillStyle(0x2a6820); g.fillEllipse(20, 16, 26, 20);
  g.fillStyle(0x387828); g.fillEllipse(18, 12, 16, 12);
  g.generateTexture('great_oak', 40, 52);

  // Great Pine — tall narrow layered pine, tundra landmark (30×64)
  g.clear();
  g.fillStyle(0x5c3317); g.fillRect(13, 48, 4, 16);
  g.fillStyle(0x3d2010); g.fillRect(13, 48, 1, 16);
  // 4 tiers: bottom (wide) to top (narrow)
  g.fillStyle(0x164010); g.fillTriangle(15, 48, 1, 56, 29, 56);
  g.fillStyle(0x1e5018); g.fillTriangle(15, 45, 3, 54, 27, 54);
  g.fillStyle(0xe8f2ff); g.fillTriangle(15, 45, 8, 49, 22, 49);
  g.fillStyle(0x1a4812); g.fillTriangle(15, 36, 4, 47, 26, 47);
  g.fillStyle(0x225a1a); g.fillTriangle(15, 34, 6, 45, 24, 45);
  g.fillStyle(0xe8f2ff); g.fillTriangle(15, 34, 9, 38, 21, 38);
  g.fillStyle(0x185010); g.fillTriangle(15, 24, 6, 36, 24, 36);
  g.fillStyle(0x206018); g.fillTriangle(15, 22, 7, 34, 23, 34);
  g.fillStyle(0xe8f2ff); g.fillTriangle(15, 22, 10, 26, 20, 26);
  g.fillStyle(0x1a5812); g.fillTriangle(15, 12, 8, 25, 22, 25);
  g.fillStyle(0x246820); g.fillTriangle(15, 10, 9, 23, 21, 23);
  g.fillStyle(0xeef6ff); g.fillTriangle(15, 4, 11, 13, 19, 13);
  g.fillStyle(0xffffff); g.fillTriangle(15, 2, 12, 9, 18, 9);
  g.generateTexture('great_pine', 30, 64);

  // Great Mangrove — wide gnarled roots, swamp landmark (52×50)
  g.clear();
  // Spreading root trunks
  g.fillStyle(0x2e1c08);
  g.fillTriangle(20, 50, 4, 50, 16, 28);
  g.fillTriangle(22, 50, 14, 50, 20, 26);
  g.fillRect(22, 22, 8, 28);
  g.fillTriangle(30, 50, 36, 50, 32, 26);
  g.fillTriangle(32, 50, 48, 50, 36, 28);
  g.fillStyle(0x3d2810); g.fillRect(23, 22, 3, 28);
  // Wide irregular canopy
  g.fillStyle(0x182e12); g.fillEllipse(26, 18, 50, 32);
  g.fillStyle(0x1e3818); g.fillEllipse(24, 13, 44, 24);
  g.fillStyle(0x142810); g.fillCircle(18, 14, 10); g.fillCircle(34, 12, 8);
  // Hanging moss
  g.fillStyle(0x162a10);
  g.fillRect(8, 28, 2, 14); g.fillRect(16, 24, 2, 11); g.fillRect(30, 24, 2, 9); g.fillRect(40, 26, 2, 13);
  // Canopy highlight
  g.fillStyle(0x284a1e); g.fillEllipse(22, 10, 18, 12);
  g.generateTexture('great_mangrove', 52, 50);

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

  // Ice rock — polygon-based, blue-grey with icy highlight face
  g.clear();
  // Main body: cool blue-grey
  g.fillStyle(0x7090a8);
  g.fillPoints([{x:2,y:15},{x:0,y:9},{x:3,y:3},{x:9,y:1},{x:15,y:1},{x:20,y:4},{x:22,y:10},{x:18,y:15}], true);
  // Top-left highlight face: pale icy blue-white
  g.fillStyle(0xbcd8e8);
  g.fillPoints([{x:3,y:13},{x:1,y:8},{x:4,y:3},{x:9,y:2},{x:14,y:2},{x:17,y:6},{x:18,y:11},{x:15,y:13}], true);
  // Frost sparkle highlights
  g.fillStyle(0xeef6ff);
  g.fillRect(7, 4, 2, 2); g.fillRect(13, 6, 1, 1); g.fillRect(5, 9, 1, 1);
  // Cracks: dark blue-grey
  g.lineStyle(1, 0x507080);
  g.beginPath(); g.moveTo(8,7); g.lineTo(11,11); g.lineTo(9,15); g.strokePath();
  g.beginPath(); g.moveTo(14,4); g.lineTo(16,8); g.strokePath();
  g.generateTexture('ice_rock', 22, 16);

  // Mountain — large terrain feature (96x80) — visible from across the map
  g.clear();
  g.fillStyle(0x333030); g.fillTriangle(48, 0, 0, 76, 96, 76);   // dark base mass
  g.fillStyle(0x454040); g.fillTriangle(48, 6, 8, 70, 88, 70);   // mid face
  g.fillStyle(0x575252); g.fillTriangle(48, 18, 20, 62, 76, 62); // upper face
  g.fillStyle(0x2e2b2b); g.fillTriangle(48, 0, 0, 76, 32, 44);  // left shadow face
  g.fillStyle(0x3e3b3b); g.fillTriangle(20, 52, 8, 72, 40, 68); // left rock detail
  g.fillStyle(0x3e3b3b); g.fillTriangle(72, 46, 58, 70, 88, 70); // right rock detail
  g.fillStyle(0xcccccc); g.fillTriangle(48, 0, 34, 28, 62, 28); // snow cap
  g.fillStyle(0xdedede); g.fillTriangle(48, 2, 38, 20, 58, 20); // snow mid
  g.fillStyle(0xf5f5f5); g.fillTriangle(48, 4, 42, 14, 54, 14); // snow tip
  g.fillStyle(0x201e1e); g.fillRect(0, 73, 96, 7);               // base shadow
  g.generateTexture('mountain', 96, 80);

  // Mountain variant 2 — wide double-peak ridge (112x88)
  g.clear();
  g.fillStyle(0x303030); g.fillTriangle(30, 2, 0, 84, 62, 84);   // left peak
  g.fillStyle(0x303030); g.fillTriangle(82, 0, 50, 84, 112, 84); // right peak
  g.fillStyle(0x424040); g.fillTriangle(30, 8, 8, 78, 56, 78);
  g.fillStyle(0x424040); g.fillTriangle(82, 6, 54, 78, 108, 78);
  g.fillStyle(0x282828); g.fillTriangle(30, 2, 0, 84, 22, 50);   // left shadow
  g.fillStyle(0x282828); g.fillTriangle(82, 0, 50, 84, 64, 46);  // right shadow
  g.fillStyle(0x3a3838); g.fillTriangle(44, 46, 58, 84, 72, 84); // saddle
  g.fillStyle(0x484646); g.fillTriangle(46, 48, 60, 80, 70, 80);
  g.fillStyle(0xbbbbbb); g.fillTriangle(30, 2, 20, 24, 40, 24); // left snow
  g.fillStyle(0xcccccc); g.fillTriangle(30, 4, 23, 18, 37, 18);
  g.fillStyle(0xbbbbbb); g.fillTriangle(82, 0, 72, 22, 92, 22); // right snow
  g.fillStyle(0xcccccc); g.fillTriangle(82, 2, 75, 16, 89, 16);
  g.fillStyle(0x1e1e1e); g.fillRect(0, 81, 112, 7);
  g.generateTexture('mountain2', 112, 88);

  // Supply cache — small chest/crate
  g.clear();
  g.fillStyle(0x8a6622); g.fillRect(2, 4, 20, 14);
  g.fillStyle(0xaa8833); g.fillRect(3, 5, 18, 12);
  g.fillStyle(0x664411); g.fillRect(2, 4, 20, 2); // lid
  g.fillStyle(0xccaa00); g.fillRect(10, 8, 4, 4); // lock
  g.fillStyle(0xeedd22); g.fillRect(11, 9, 2, 2);
  g.generateTexture('supply_cache', 24, 20);

  // Ruin wall block — crumbling brick wall tile
  g.clear();
  g.fillStyle(0x555566); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x666677); g.fillRect(0, 0, 32, 8); g.fillRect(0, 16, 32, 8);
  g.fillStyle(0x4a4a5a); g.fillRect(0, 8, 32, 8); g.fillRect(0, 24, 32, 8);
  g.fillStyle(0x333344); g.fillRect(0, 7, 32, 2); g.fillRect(0, 15, 32, 2); g.fillRect(0, 23, 32, 2);
  g.fillStyle(0x333344); g.fillRect(15, 0, 2, 7); g.fillRect(7, 8, 2, 7); g.fillRect(22, 8, 2, 7);
  g.fillStyle(0x333344); g.fillRect(10, 16, 2, 7); g.fillRect(25, 16, 2, 7); g.fillRect(4, 24, 2, 8);
  g.fillStyle(0x222233); g.fillRect(2, 2, 3, 3); g.fillRect(20, 18, 4, 4); g.fillRect(27, 10, 4, 3);
  g.lineStyle(1, 0x222233, 1); g.lineBetween(5, 0, 3, 7); g.lineBetween(18, 8, 22, 14); g.lineBetween(9, 16, 7, 24);
  g.generateTexture('ruin_block', 32, 32);

  // Ruin interior floor — worn stone tile
  g.clear();
  g.fillStyle(0x3a3a48); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x424252); g.fillRect(1, 1, 14, 14); g.fillRect(17, 17, 14, 14);
  g.fillStyle(0x383846); g.fillRect(1, 17, 14, 14); g.fillRect(17, 1, 14, 14);
  g.fillStyle(0x2e2e3a); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32);
  g.fillStyle(0x2a2a38); g.fillRect(4, 4, 3, 3); g.fillRect(22, 20, 3, 2);
  g.generateTexture('ruin_floor', 32, 32);

  // Plank wall — weathered wood for farmhouse structures
  g.clear();
  g.fillStyle(0x8b5e3c); g.fillRect(0, 0, 32, 32); // base wood
  g.fillStyle(0x6d4a2e); // grain lines / plank seams
  g.fillRect(0, 10, 32, 2); g.fillRect(0, 22, 32, 2);
  g.fillRect(15, 0, 2, 32); // center seam
  g.fillStyle(0x4a3020); g.fillRect(3, 3, 5, 7); g.fillRect(20, 14, 6, 5); // dark weathering
  g.fillStyle(0xaa7a55); g.fillRect(2, 2, 3, 3); g.fillRect(18, 13, 3, 2); // light weathering
  g.fillStyle(0x333333); g.fillRect(5, 1, 2, 2); g.fillRect(23, 12, 2, 2); g.fillRect(5, 24, 2, 2); // nail heads
  g.generateTexture('plank_wall', 32, 32);

  // Metal wall — rusty corrugated metal for bunker structures
  g.clear();
  g.fillStyle(0x6e4438); g.fillRect(0, 0, 32, 32); // rust base
  // Corrugation ridges
  for (let ry = 0; ry < 32; ry += 8) {
    g.fillStyle(0x7e5448); g.fillRect(0, ry,   32, 4);
    g.fillStyle(0x523028); g.fillRect(0, ry+4, 32, 4);
  }
  g.fillStyle(0xb06040); g.fillRect(3, 4, 5, 5); g.fillRect(18, 12, 7, 3); g.fillRect(7, 22, 4, 6); // rust patches
  g.fillStyle(0x555555); g.fillRect(1, 2, 3, 2); g.fillRect(25, 10, 3, 2); g.fillRect(1, 18, 3, 2); // bolt heads
  g.generateTexture('metal_wall', 32, 32);

  // Rotted plank — dark waterlogged wood for swamp shack
  g.clear();
  g.fillStyle(0x2c1a0a); g.fillRect(0, 0, 32, 32); // dark wet wood
  g.fillStyle(0x1a0e06); g.fillRect(0, 10, 32, 2); g.fillRect(0, 22, 32, 2); g.fillRect(15, 0, 2, 32);
  g.fillStyle(0x0a1a0a); g.fillRect(2, 4, 8, 5); g.fillRect(18, 15, 7, 7); // standing water patches
  g.fillStyle(0x1a2e14); g.fillRect(5, 14, 5, 5); g.fillRect(22, 3, 6, 3); // algae/mold
  g.fillStyle(0x3a280e); g.fillRect(3, 2, 3, 4); g.fillRect(20, 12, 3, 3); // wet sheen
  g.generateTexture('rot_plank', 32, 32);

  // Ice floor — pale blue cracked tile for outpost interiors
  g.clear();
  g.fillStyle(0xc0d8ee); g.fillRect(0, 0, 32, 32); // icy base
  g.fillStyle(0x90b0cc); // tile grid and cracks
  g.fillRect(0, 0, 32, 1); g.fillRect(0, 15, 32, 1); g.fillRect(0, 16, 32, 1); g.fillRect(0, 31, 32, 1);
  g.fillRect(0, 0, 1, 32); g.fillRect(15, 0, 1, 32); g.fillRect(16, 0, 1, 32); g.fillRect(31, 0, 1, 32);
  g.fillStyle(0x6888a0); // crack lines
  g.fillRect(4, 4, 1, 9); g.fillRect(4, 12, 5, 1); g.fillRect(20, 18, 7, 1); g.fillRect(26, 18, 1, 6);
  g.fillStyle(0xdcf0ff); g.fillRect(2, 2, 5, 5); g.fillRect(18, 18, 6, 6); // frost highlights
  g.generateTexture('ice_floor', 32, 32);

  // Crater (large) — decorative ground depression
  g.clear();
  g.fillStyle(0x1e1e1e); g.fillEllipse(24, 19, 44, 34);
  g.fillStyle(0x2a2a2a); g.fillEllipse(24, 18, 36, 26);
  g.fillStyle(0x343434); g.fillEllipse(24, 17, 24, 17);
  g.fillStyle(0x151515); g.fillEllipse(24, 19, 12, 9);
  g.generateTexture('crater_large', 48, 38);

  // Crater (small) — decorative ground depression
  g.clear();
  g.fillStyle(0x1e1e1e); g.fillEllipse(14, 12, 26, 20);
  g.fillStyle(0x2a2a2a); g.fillEllipse(14, 11, 20, 14);
  g.fillStyle(0x151515); g.fillEllipse(14, 12, 10, 7);
  g.generateTexture('crater_small', 28, 24);

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

  // Raider camp — rough tent cluster
  g.clear();
  g.fillStyle(0x553311); g.fillTriangle(16, 2, 0, 28, 32, 28); // tent shape
  g.fillStyle(0x442200); g.fillRect(0, 26, 32, 6);
  g.fillStyle(0x664422); g.fillTriangle(16, 4, 4, 26, 28, 26);
  g.fillStyle(0x220000); g.fillRect(14, 18, 4, 10); // door
  g.fillStyle(0xff4400); g.fillEllipse(8, 30, 6, 4); // small fire
  g.fillStyle(0xff8800); g.fillEllipse(8, 29, 4, 3);
  g.generateTexture('raid_camp', 32, 32);

  // Raider: Brawler (melee tank — dark red, stocky)
  g.clear();
  g.fillStyle(0x993322); g.fillRect(6, 8, 14, 16); // body
  g.fillStyle(0x773311); g.fillRect(4, 14, 4, 8);  // left arm
  g.fillStyle(0x773311); g.fillRect(18, 14, 4, 8); // right arm
  g.fillStyle(0xcc8855); g.fillEllipse(13, 7, 12, 10); // head
  g.fillStyle(0x551111); g.fillRect(6, 2, 14, 5);  // helmet
  g.fillStyle(0x664422); g.fillRect(6, 24, 5, 6); g.fillRect(15, 24, 5, 6); // legs
  g.generateTexture('raider_brawler', 26, 30);

  // Raider: Shooter (ranged — brown coat, slim)
  g.clear();
  g.fillStyle(0x775533); g.fillRect(7, 8, 12, 16);
  g.fillStyle(0x664422); g.fillRect(5, 14, 4, 7);
  g.fillStyle(0x664422); g.fillRect(17, 13, 6, 4); // gun arm extended
  g.fillStyle(0x444433); g.fillRect(21, 14, 6, 2); // gun barrel
  g.fillStyle(0xcc9966); g.fillEllipse(13, 7, 10, 10); // head
  g.fillStyle(0x553322); g.fillRect(7, 24, 4, 6); g.fillRect(15, 24, 4, 6);
  g.generateTexture('raider_shooter', 26, 30);

  // Raider: Heavy (both — dark gray, large)
  g.clear();
  g.fillStyle(0x445566); g.fillRect(4, 7, 18, 18); // armored body
  g.fillStyle(0x334455); g.fillRect(2, 13, 4, 10); g.fillRect(20, 13, 4, 10); // arms
  g.fillStyle(0x556677); g.fillRect(4, 7, 18, 6);  // chest plate
  g.fillStyle(0xbbaa88); g.fillEllipse(13, 6, 12, 10); // head
  g.fillStyle(0x334455); g.fillRect(4, 25, 7, 5); g.fillRect(15, 25, 7, 5);
  g.generateTexture('raider_heavy', 26, 30);

  // Boss sprites — one per biome boss type
  // Iron Golem (wasteland) — large, armored
  g.clear();
  g.fillStyle(0x778899); g.fillRect(6, 4, 28, 30); // massive body
  g.fillStyle(0x667788); g.fillRect(2, 10, 6, 18); g.fillRect(32, 10, 6, 18); // arms
  g.fillStyle(0x556677); g.fillRect(6, 4, 28, 8);  // shoulder plates
  g.fillStyle(0x99aaaa); g.fillRect(8, 6, 24, 6);  // chest gleam
  g.fillStyle(0x889999); g.fillRect(10, 34, 8, 8); g.fillRect(22, 34, 8, 8); // legs
  g.fillStyle(0xbbccdd); g.fillEllipse(20, 4, 18, 14); // head
  g.fillStyle(0xff3300); g.fillRect(13, 2, 4, 2); g.fillRect(21, 2, 4, 2); // eye glow
  g.generateTexture('boss_golem', 40, 44);

  // Alpha Wolf (grassland) — sleek, large wolf
  g.clear();
  g.fillStyle(0x888855); g.fillEllipse(20, 20, 30, 20); // body
  g.fillStyle(0x777744); g.fillEllipse(32, 14, 14, 12); // head
  g.fillStyle(0x999966); g.fillTriangle(36, 8, 32, 16, 40, 14); // ear
  g.fillStyle(0x888855); g.fillRect(6, 22, 4, 10); g.fillRect(14, 22, 4, 10); // front legs
  g.fillStyle(0x888855); g.fillRect(24, 22, 4, 10); g.fillRect(32, 22, 4, 10); // back legs
  g.fillStyle(0x666633); g.fillRect(2, 18, 6, 6); // tail stub
  g.fillStyle(0xeeeecc); g.fillEllipse(34, 14, 6, 5); // snout
  g.fillStyle(0xff2200); g.fillRect(34, 16, 4, 2); // fangs hint
  g.generateTexture('boss_wolf', 40, 36);

  // Spider Queen (ruins) — large spider body
  g.clear();
  g.fillStyle(0x442255); g.fillEllipse(20, 22, 24, 18); // abdomen
  g.fillStyle(0x553366); g.fillEllipse(20, 12, 16, 14); // cephalothorax
  g.fillStyle(0x332244); // legs — 4 pairs
  for (let i = 0; i < 4; i++) {
    g.fillRect(4 - i*1, 10 + i*4, 12, 3);  // left legs
    g.fillRect(24 + i*1, 10 + i*4, 12, 3); // right legs
  }
  g.fillStyle(0xff3333); g.fillRect(16, 8, 3, 3); g.fillRect(21, 8, 3, 3); // eyes
  g.fillStyle(0x221133); g.fillEllipse(20, 23, 16, 10); // abdomen pattern
  g.generateTexture('boss_spider', 40, 38);

  // Frost Troll (tundra) — hulking blue-white giant
  g.clear();
  g.fillStyle(0x8899bb); g.fillRect(8, 6, 24, 28); // body
  g.fillStyle(0x7788aa); g.fillRect(4, 10, 6, 20); g.fillRect(30, 10, 6, 20); // long arms
  g.fillStyle(0xaabbcc); g.fillRect(8, 6, 24, 10); // upper body highlight
  g.fillStyle(0xbbccdd); g.fillEllipse(20, 5, 20, 16); // large head
  g.fillStyle(0x334466); g.fillRect(14, 34, 7, 8); g.fillRect(23, 34, 7, 8); // legs
  g.fillStyle(0x6688aa); g.fillRect(8, 2, 4, 6); g.fillRect(28, 2, 4, 6); // horns
  g.generateTexture('boss_troll', 40, 44);

  // Bog Hydra (swamp) — multi-headed serpent
  g.clear();
  g.fillStyle(0x334422); g.fillEllipse(20, 28, 28, 20); // main body
  g.fillStyle(0x445533); g.fillEllipse(20, 26, 22, 14); // body highlight
  // Three necks/heads
  g.fillStyle(0x334422); g.fillRect(8, 8, 6, 20); // left neck
  g.fillStyle(0x334422); g.fillRect(18, 4, 6, 22); // center neck
  g.fillStyle(0x334422); g.fillRect(28, 9, 6, 19); // right neck
  g.fillStyle(0x446633); g.fillEllipse(11, 6, 10, 8); // left head
  g.fillStyle(0x446633); g.fillEllipse(21, 3, 10, 8); // center head
  g.fillStyle(0x446633); g.fillEllipse(31, 7, 10, 8); // right head
  g.fillStyle(0xff2200); g.fillRect(9,4,2,2); g.fillRect(19,1,2,2); g.fillRect(29,5,2,2); // eyes
  g.generateTexture('boss_hydra', 40, 40);

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

// ── 8-DIRECTIONAL DIAGONAL SPRITES ───────────────────────────
// fside = front-diagonal (moving toward-camera + sideways)
// bside = back-diagonal  (moving away-from-camera + sideways)

function drawKnightFSide(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(4, 26, 6, 4); g.fillRect(13, 26, 5, 4);
  g.fillStyle(0x2d4a63); g.fillRect(4, 17, 6, 10); g.fillRect(13, 17, 5, 10);
  g.fillStyle(0x111111); g.fillRect(2, 16, 17, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 17, 9);
  g.fillStyle(0x3a5a7a); g.fillRect(6, 9, 9, 7); g.fillStyle(0x5588aa); g.fillRect(6, 9, 9, 2);
  g.fillStyle(0xccaa00); g.fillCircle(10, 13, 1);
  g.fillStyle(0x2244aa); g.fillRect(0, 8, 3, 10); g.fillStyle(0x4466cc); g.fillRect(1, 9, 2, 8);
  g.fillStyle(0x4a6d8c); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 16); g.fillStyle(0xcc9900); g.fillRect(18, 7, 5, 2);
  g.fillStyle(0xffcc99); g.fillRect(7, 5, 7, 4);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 2, 14, 5); g.fillStyle(0x080808); g.fillRect(5, 3, 11, 2);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight_fside', 22, 30);
}
function drawKnightFSideStep(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(4, 24, 6, 5); g.fillRect(13, 27, 5, 3);
  g.fillStyle(0x2d4a63); g.fillRect(4, 15, 6, 10); g.fillRect(13, 19, 5, 9);
  g.fillStyle(0x111111); g.fillRect(2, 16, 17, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 17, 9);
  g.fillStyle(0x3a5a7a); g.fillRect(6, 9, 9, 7); g.fillStyle(0x5588aa); g.fillRect(6, 9, 9, 2);
  g.fillStyle(0xccaa00); g.fillCircle(10, 13, 1);
  g.fillStyle(0x2244aa); g.fillRect(0, 8, 3, 10); g.fillStyle(0x4466cc); g.fillRect(1, 9, 2, 8);
  g.fillStyle(0x4a6d8c); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 16); g.fillStyle(0xcc9900); g.fillRect(18, 7, 5, 2);
  g.fillStyle(0xffcc99); g.fillRect(7, 5, 7, 4);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 2, 14, 5); g.fillStyle(0x080808); g.fillRect(5, 3, 11, 2);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight_fside_step', 22, 30);
}
function drawKnightBSide(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(4, 26, 6, 4); g.fillRect(12, 26, 6, 4);
  g.fillStyle(0x2d4a63); g.fillRect(4, 17, 6, 10); g.fillRect(12, 17, 6, 10);
  g.fillStyle(0x111111); g.fillRect(2, 16, 18, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x2d4a63); g.fillRect(5, 9, 11, 7); g.fillStyle(0x1a2d3d); g.fillRect(9, 9, 3, 7);
  g.fillStyle(0x4a6d8c); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 14); g.fillStyle(0xcc9900); g.fillRect(18, 7, 6, 2);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 7, 5);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 1, 14, 6); g.fillStyle(0x1a2d3d); g.fillRect(9, 0, 3, 8);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight_bside', 22, 30);
}
function drawKnightBSideStep(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(4, 24, 6, 5); g.fillRect(12, 27, 6, 3);
  g.fillStyle(0x2d4a63); g.fillRect(4, 15, 6, 10); g.fillRect(12, 19, 6, 9);
  g.fillStyle(0x111111); g.fillRect(2, 16, 18, 2);
  g.fillStyle(0x4a6d8c); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x2d4a63); g.fillRect(5, 9, 11, 7); g.fillStyle(0x1a2d3d); g.fillRect(9, 9, 3, 7);
  g.fillStyle(0x4a6d8c); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0xbbbbbb); g.fillRect(21, 4, 2, 14); g.fillStyle(0xcc9900); g.fillRect(18, 7, 6, 2);
  g.fillStyle(0xffcc99); g.fillRect(8, 4, 7, 5);
  g.fillStyle(0x4a6d8c); g.fillRect(4, 0, 14, 8);
  g.fillStyle(0x2d4a63); g.fillRect(4, 1, 14, 6); g.fillStyle(0x1a2d3d); g.fillRect(9, 0, 3, 8);
  g.fillStyle(0x6688bb); g.fillRect(4, 0, 14, 2);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 0, 2, 8); g.fillRect(16, 0, 2, 8);
  g.generateTexture('knight_bside_step', 22, 30);
}

function drawGunslingerFSide(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(4, 24, 6, 6); g.fillRect(13, 25, 5, 5);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 16, 6, 9); g.fillRect(13, 17, 5, 9);
  g.fillStyle(0x3d2010); g.fillRect(14, 19, 4, 4); g.fillStyle(0x222222); g.fillRect(15, 21, 3, 3);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 17, 9);
  g.fillStyle(0xffeedd); g.fillRect(7, 8, 7, 8);
  g.fillStyle(0x9a6622); g.fillRect(2, 15, 17, 2);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0x333333); g.fillRect(19, 11, 4, 3); g.fillStyle(0x555555); g.fillRect(20, 9, 3, 5);
  g.fillStyle(0xffcc99); g.fillRect(7, 4, 7, 6);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 15, 3);
  g.fillStyle(0x553311); g.fillRect(5, 0, 12, 4); g.fillStyle(0x7a5533); g.fillRect(5, 0, 12, 1);
  g.generateTexture('gunslinger_fside', 22, 30);
}
function drawGunslingerFSideStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(4, 23, 6, 6); g.fillRect(13, 26, 5, 4);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 15, 6, 9); g.fillRect(13, 18, 5, 9);
  g.fillStyle(0x3d2010); g.fillRect(14, 19, 4, 4); g.fillStyle(0x222222); g.fillRect(15, 21, 3, 3);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 17, 9);
  g.fillStyle(0xffeedd); g.fillRect(7, 8, 7, 8);
  g.fillStyle(0x9a6622); g.fillRect(2, 15, 17, 2);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0x333333); g.fillRect(19, 11, 4, 3); g.fillStyle(0x555555); g.fillRect(20, 9, 3, 5);
  g.fillStyle(0xffcc99); g.fillRect(7, 4, 7, 6);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 15, 3);
  g.fillStyle(0x553311); g.fillRect(5, 0, 12, 4); g.fillStyle(0x7a5533); g.fillRect(5, 0, 12, 1);
  g.generateTexture('gunslinger_fside_step', 22, 30);
}
function drawGunslingerBSide(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(4, 24, 6, 6); g.fillRect(12, 24, 6, 6);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 16, 6, 9); g.fillRect(12, 16, 6, 9);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x9a5511); g.fillRect(5, 8, 12, 9);
  g.fillStyle(0xaa6622); g.fillRect(2, 12, 18, 2);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0x333333); g.fillRect(19, 11, 6, 3); g.fillStyle(0x555555); g.fillRect(20, 9, 5, 5);
  g.fillStyle(0xffcc99); g.fillRect(7, 4, 7, 5);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 16, 3);
  g.fillStyle(0x553311); g.fillRect(5, 0, 12, 4); g.fillStyle(0x3d2010); g.fillRect(7, 0, 8, 3);
  g.generateTexture('gunslinger_bside', 22, 30);
}
function drawGunslingerBSideStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(4, 23, 6, 6); g.fillRect(12, 26, 6, 4);
  g.fillStyle(0x3a5a7a); g.fillRect(4, 15, 6, 9); g.fillRect(12, 18, 6, 9);
  g.fillStyle(0xcc8833); g.fillRect(2, 8, 18, 9);
  g.fillStyle(0x9a5511); g.fillRect(5, 8, 12, 9);
  g.fillStyle(0xaa6622); g.fillRect(2, 12, 18, 2);
  g.fillStyle(0xcc8833); g.fillRect(0, 8, 3, 9); g.fillRect(19, 8, 3, 9);
  g.fillStyle(0x333333); g.fillRect(19, 11, 6, 3); g.fillStyle(0x555555); g.fillRect(20, 9, 5, 5);
  g.fillStyle(0xffcc99); g.fillRect(7, 4, 7, 5);
  g.fillStyle(0x7a4a1a); g.fillRect(3, 2, 16, 3);
  g.fillStyle(0x553311); g.fillRect(5, 0, 12, 4); g.fillStyle(0x3d2010); g.fillRect(7, 0, 8, 3);
  g.generateTexture('gunslinger_bside_step', 22, 30);
}

function drawArchitectFSide(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(4, 24, 6, 6); g.fillRect(13, 25, 5, 5);
  g.fillStyle(0x334477); g.fillRect(4, 16, 6, 9); g.fillRect(13, 17, 5, 9);
  g.fillStyle(0x445588); g.fillRect(4, 16, 6, 2); g.fillRect(13, 17, 5, 2);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 17, 3);
  g.fillStyle(0xaaaaaa); g.fillRect(3, 14, 2, 5); g.fillStyle(0xcc8833); g.fillRect(8, 14, 2, 5);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 17, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(17, 8, 2, 8);
  g.fillStyle(0x1a5533); g.fillRect(7, 8, 8, 8);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(20, 6, 3, 9); g.fillStyle(0x777777); g.fillRect(19, 5, 5, 3);
  g.fillStyle(0xffcc99); g.fillRect(7, 4, 7, 6);
  g.fillStyle(0x222222); g.fillRect(3, 3, 15, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5); g.fillStyle(0xeeee44); g.fillRect(5, 0, 12, 1);
  g.fillStyle(0x666600); g.fillRect(5, 4, 12, 1);
  g.generateTexture('architect_fside', 22, 30);
}
function drawArchitectFSideStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(4, 23, 6, 6); g.fillRect(13, 26, 5, 4);
  g.fillStyle(0x334477); g.fillRect(4, 15, 6, 9); g.fillRect(13, 18, 5, 9);
  g.fillStyle(0x445588); g.fillRect(4, 15, 6, 2); g.fillRect(13, 18, 5, 2);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 17, 3);
  g.fillStyle(0xaaaaaa); g.fillRect(3, 14, 2, 5); g.fillStyle(0xcc8833); g.fillRect(8, 14, 2, 5);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 17, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(17, 8, 2, 8);
  g.fillStyle(0x1a5533); g.fillRect(7, 8, 8, 8);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(20, 6, 3, 9); g.fillStyle(0x777777); g.fillRect(19, 5, 5, 3);
  g.fillStyle(0xffcc99); g.fillRect(7, 4, 7, 6);
  g.fillStyle(0x222222); g.fillRect(3, 3, 15, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5); g.fillStyle(0xeeee44); g.fillRect(5, 0, 12, 1);
  g.fillStyle(0x666600); g.fillRect(5, 4, 12, 1);
  g.generateTexture('architect_fside_step', 22, 30);
}
function drawArchitectBSide(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(4, 24, 6, 6); g.fillRect(12, 24, 6, 6);
  g.fillStyle(0x334477); g.fillRect(4, 16, 6, 9); g.fillRect(12, 16, 6, 9);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 18, 3);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 18, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(18, 8, 2, 8);
  g.fillStyle(0x2a7a45); g.fillRect(7, 8, 8, 8);
  g.fillStyle(0xffcc00); g.fillRect(3, 11, 14, 1);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(20, 4, 3, 13); g.fillStyle(0x777777); g.fillRect(19, 3, 5, 3);
  g.fillStyle(0xffcc99); g.fillRect(7, 4, 7, 5);
  g.fillStyle(0x222222); g.fillRect(3, 3, 16, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5); g.fillStyle(0xaa9900); g.fillRect(6, 1, 10, 3);
  g.fillStyle(0x666600); g.fillRect(5, 4, 12, 1);
  g.generateTexture('architect_bside', 22, 30);
}
function drawArchitectBSideStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(4, 23, 6, 6); g.fillRect(12, 26, 6, 4);
  g.fillStyle(0x334477); g.fillRect(4, 15, 6, 9); g.fillRect(12, 18, 6, 9);
  g.fillStyle(0x8b6914); g.fillRect(2, 15, 18, 3);
  g.fillStyle(0x3a9a55); g.fillRect(2, 8, 18, 8);
  g.fillStyle(0xffcc00); g.fillRect(2, 8, 2, 8); g.fillRect(18, 8, 2, 8);
  g.fillStyle(0x2a7a45); g.fillRect(7, 8, 8, 8);
  g.fillStyle(0xffcc00); g.fillRect(3, 11, 14, 1);
  g.fillStyle(0x3a9a55); g.fillRect(0, 8, 3, 8); g.fillRect(19, 8, 3, 8);
  g.fillStyle(0x999999); g.fillRect(20, 4, 3, 13); g.fillStyle(0x777777); g.fillRect(19, 3, 5, 3);
  g.fillStyle(0xffcc99); g.fillRect(7, 4, 7, 5);
  g.fillStyle(0x222222); g.fillRect(3, 3, 16, 2);
  g.fillStyle(0xddcc22); g.fillRect(5, 0, 12, 5); g.fillStyle(0xaa9900); g.fillRect(6, 1, 10, 3);
  g.fillStyle(0x666600); g.fillRect(5, 4, 12, 1);
  g.generateTexture('architect_bside_step', 22, 30);
}

// ── SETTINGS HELPERS ─────────────────────────────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('iw_settings') || '{}'); } catch(e) { return {}; }
}
function saveSettings(obj) {
  try {
    const cur = loadSettings();
    localStorage.setItem('iw_settings', JSON.stringify(Object.assign(cur, obj)));
  } catch(e) {}
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

// ── SCENE: SETTINGS ──────────────────────────────────────────
class SettingsScene extends Phaser.Scene {
  constructor() { super('Settings'); }

  create() {
    const { W, H } = CFG;
    this.cameras.main.fadeIn(300, 0, 0, 0);

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0a0a14, 0x0a0a14, 0x080810, 0x080810, 1);
    bg.fillRect(0, 0, W, H);

    this.add.text(W/2, 44, 'SETTINGS', {
      fontFamily:'monospace', fontSize:'36px', color:'#cc8833',
      stroke:'#7a4a1a', strokeThickness:4,
    }).setOrigin(0.5);

    // ── Input mode section ──────────────────────────────────
    this.add.text(W/2, 115, 'INPUT MODE', {
      fontFamily:'monospace', fontSize:'13px', color:'#556655', letterSpacing: 3,
    }).setOrigin(0.5);

    this.add.text(W/2, 140, 'Choose how you control the game. "Auto" detects your device automatically.', {
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
      const y = 240;
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
    this.add.text(W/2, 340, deviceNote, {
      fontFamily:'monospace', fontSize:'12px', color:'#4a6a4a',
    }).setOrigin(0.5);

    // ── Touch controls preview ───────────────────────────────
    this.add.text(W/2, 390, 'TOUCH CONTROLS LAYOUT', {
      fontFamily:'monospace', fontSize:'11px', color:'#334433', letterSpacing: 2,
    }).setOrigin(0.5);

    // Mini preview diagram
    const prev = this.add.graphics();
    const px = W/2 - 220, py = 410, pw = 440, ph = 160;
    prev.lineStyle(1, 0x223322, 0.6); prev.strokeRoundedRect(px, py, pw, ph, 6);
    prev.fillStyle(0x0d160d, 0.7); prev.fillRoundedRect(px, py, pw, ph, 6);
    // Joystick placeholder
    prev.lineStyle(1, 0x448844, 0.5); prev.strokeCircle(px + 75, py + ph/2, 45);
    prev.fillStyle(0x448844, 0.3); prev.fillCircle(px + 75, py + ph/2, 25);
    this.add.text(px + 75, py + ph/2, 'MOVE', { fontFamily:'monospace', fontSize:'9px', color:'#66aa66' }).setOrigin(0.5);
    // Buttons placeholder
    const btnDefs = [
      { lx: pw - 65, ly: ph/2 + 12, r: 34, col: 0xff6644, label: 'ATK' },
      { lx: pw - 140, ly: ph/2 + 20, r: 24, col: 0x44cc66, label: 'USE' },
      { lx: pw - 65, ly: ph/2 - 48, r: 24, col: 0x6699ff, label: 'ALT' },
      { lx: pw - 148, ly: ph/2 - 48, r: 24, col: 0xccaa33, label: 'BLD' },
    ];
    btnDefs.forEach(b => {
      prev.fillStyle(b.col, 0.25); prev.fillCircle(px + b.lx, py + b.ly, b.r);
      prev.lineStyle(1, b.col, 0.6); prev.strokeCircle(px + b.lx, py + b.ly, b.r);
      this.add.text(px + b.lx, py + b.ly, b.label, { fontFamily:'monospace', fontSize:'8px', color:'#ffffff' }).setOrigin(0.5);
    });
    this.add.text(px + pw - 65, py + 14, 'MENU', { fontFamily:'monospace', fontSize:'8px', color:'#888888' }).setOrigin(0.5);
    prev.fillStyle(0x888888, 0.2); prev.fillCircle(px + pw - 65, py + 14, 16);
    prev.lineStyle(1, 0x888888, 0.4); prev.strokeCircle(px + pw - 65, py + 14, 16);

    this.add.text(W/2, py + ph + 14, 'Joystick appears wherever you touch on the left side — no need to aim precisely!', {
      fontFamily:'monospace', fontSize:'10px', color:'#334433',
    }).setOrigin(0.5);

    // ── Back button ──────────────────────────────────────────
    const backBtn = this.add.text(W/2, H - 44, '[ BACK TO MAIN MENU ]', {
      fontFamily:'monospace', fontSize:'18px', color:'#aaffaa',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerover', () => backBtn.setColor('#ffffff'));
    backBtn.on('pointerout',  () => backBtn.setColor('#aaffaa'));
    backBtn.on('pointerdown', () => {
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => this.scene.start('ModeSelect'));
    });
    this.tweens.add({ targets: backBtn, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });

    const K = Phaser.Input.Keyboard.KeyCodes;
    this.input.keyboard.addKey(K.ESC).on('down', () => {
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => this.scene.start('ModeSelect'));
    });

    this.setInput(curMode);
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
    // Reset world-ready flag immediately — Phaser reuses the same class instance
    // on scene restart, so the flag from the previous run would otherwise keep
    // update() running against stale state before the deferred init fires.
    this._worldReady = false;

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
    this.kills = 0;
    this.resourcesGathered = 0;
    this.bossSpawned = false;
    this.bossDefeated = false;
    this.boss = null;
    this.raiders = [];
    this.raidCamp = null;
    this.raidRespawnDay = null;

    // Build system state
    this.buildMode = false;
    this.buildGhost = null;
    this.builtWalls = [];
    this.craftBenchPlaced = false;
    this.beds = [];
    this.sleepSpeedMult = 1;   // 8x when all players are sleeping through night

    // Show loading indicator on the black screen — iOS PWA needs at least one yielded
    // frame before heavy synchronous work, otherwise WKWebView may not render at all.
    const _loadTxt = this.add.text(CFG.W / 2, CFG.H / 2, 'Building world...', {
      fontFamily: 'monospace', fontSize: '16px', color: '#555555'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(999);

    this.time.delayedCall(64, () => {
      if (_loadTxt.active) _loadTxt.destroy();
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

    // Mouse controls for 1P keyboard mode (touch mode uses button overlay instead)
    if (this.solo) {
      this.input.on('pointerdown', (pointer) => {
        if (activeInputMode() === 'touch') return; // touch mode handles its own attack
        if (this.barrackOpen || this.isOver || this.p1.isDowned || this.p1.isSleeping) return;
        if (pointer.leftButtonDown()) {
          if (this.buildMode && this.buildOwner === this.p1) this.placeBuild();
          else this.doAttack(this.p1);
        }
        if (pointer.rightButtonDown()) {
          this.doAlt(this.p1);
        }
      });
      // Disable context menu on right-click (no-op on iOS but safe to call)
      if (this.input.mouse) this.input.mouse.disableContextMenu();
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

    // Harvest progress graphics — world-space, depth 20
    this.harvestGfx = this._w(this.add.graphics().setDepth(20));

    // Spawn enemies after camera setup
    this.spawnEnemies(worldW, worldH, cx, cy);
    this.placeRaiderCamp(worldW, worldH);

    // Touch controls (1P only — 2P touch is out of scope)
    if (this.solo && activeInputMode() === 'touch') {
      this.initTouchControls();
    }

    // Opening hints (delayed to appear after the startup controls popup fades)
    const modeNote = this.hardcore ? '\u2620 HARDCORE \u2014 death is permanent!' : '\u2665 SURVIVAL mode';
    this.time.delayedCall(10000, () => this.hint(modeNote + ' Explore the biomes! Watch your minimap.', 5000));
    this.time.delayedCall(16500, () => this.hint('TAB for controls  |  Beware toxic swamps and frozen tundra!', 3500));

      this._worldReady = true;
      this.showStartupControls();
    }); // end deferred world init
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

    // ── PRE-COMPUTE ALL POI POSITIONS ────────────────────────────────────────
    // Must happen BEFORE trees, rocks, and mountains so that:
    //  • placeTree / rock loops can skip tiles near any POI
    //  • placeMtn's fjord algorithm leaves entrance gaps toward ALL POIs
    // _preCacheTiles is the unified list read by placeMtn and the clearance pass.
    {
      const _prePickBiome = (biome, minDist, existing) => {
        for (let att = 0; att < 120; att++) {
          const tx = Phaser.Math.Between(12, CFG.MAP_W - 12);
          const ty = Phaser.Math.Between(12, CFG.MAP_H - 12);
          if (Math.abs(tx - stx) < minDist && Math.abs(ty - sty) < minDist) continue;
          if (getBiome(tx, ty) !== biome) continue;
          if (existing.some(p => Math.abs(p.tx - tx) < 10 && Math.abs(p.ty - ty) < 10)) continue;
          return { tx, ty, gapAngle: Math.atan2(sty - ty, stx - tx) };
        }
        return null;
      };

      this._preCacheTiles = []; // unified fjord-protection + clearance list

      // Supply caches (one per outer biome)
      this._preCacheTiles_caches = [];
      for (const biome of ['waste', 'swamp', 'tundra', 'ruins']) {
        const pt = _prePickBiome(biome, SAFE_R + 10, this._preCacheTiles);
        if (pt) { this._preCacheTiles_caches.push(pt); this._preCacheTiles.push(pt); }
      }

      // Enemy dens (one per outer biome)
      this._preDenTiles = [];
      for (const biome of ['waste', 'swamp', 'tundra']) {
        const pt = _prePickBiome(biome, SAFE_R + 10, this._preCacheTiles);
        if (pt) { this._preDenTiles.push(pt); this._preCacheTiles.push(pt); }
      }

      // Radio tower (ruins biome)
      const _towerPt = _prePickBiome('ruins', SAFE_R + 10, this._preCacheTiles);
      this._preTowerTile = _towerPt || null;
      if (_towerPt) this._preCacheTiles.push(_towerPt);

      // Campsites (grass + waste)
      this._preCampsiteTiles = [];
      for (const biome of ['grass', 'waste']) {
        const pt = _prePickBiome(biome, SAFE_R + 8, this._preCacheTiles);
        if (pt) { this._preCampsiteTiles.push(pt); this._preCacheTiles.push(pt); }
      }

      // Biome structures (up to 2 per biome)
      this._preStructureTiles = {};
      for (const biome of ['grass', 'tundra', 'swamp', 'waste']) {
        this._preStructureTiles[biome] = [];
        for (let i = 0; i < 2; i++) {
          const pt = _prePickBiome(biome, SAFE_R + 12, this._preCacheTiles);
          if (pt) { this._preStructureTiles[biome].push(pt); this._preCacheTiles.push(pt); }
        }
      }
    }

    this.obstacles = this.physics.add.staticGroup();
    this.toxicPools = []; // for swamp damage

    // Trees — dense forest clusters, biome-appropriate, non-overlapping
    const treesPlaced = [];
    const placeTree = (tx, ty, biome) => {
      if (tx < 2 || tx > CFG.MAP_W-2 || ty < 2 || ty > CFG.MAP_H-2) return;
      if (Math.abs(tx-stx) < SAFE_R+3 && Math.abs(ty-sty) < SAFE_R+3) return;
      if (treesPlaced.some(p => Math.abs(p.tx-tx) <= 1 && Math.abs(p.ty-ty) <= 1)) return;
      // Don't plant trees within 4 tiles of any pre-computed POI
      if (this._preCacheTiles && this._preCacheTiles.some(p => Math.abs(p.tx-tx) <= 4 && Math.abs(p.ty-ty) <= 4)) return;
      let treeKey = 'tree';
      if (biome === 'waste') treeKey = 'tree_dead';
      else if (biome === 'tundra') treeKey = 'tree_snow';
      else if (biome === 'ruins' && Math.random() < 0.5) treeKey = 'tree_dead';
      else if (biome === 'swamp') treeKey = Math.random() < 0.55 ? 'tree_swamp' : 'tree';
      const sc = Phaser.Math.FloatBetween(1.6, 2.8);
      const t = this.obstacles.create(tx*TILE+14, ty*TILE+18, treeKey);
      t.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      // Trunk-only hitbox: 8px wide × 12px tall at the base of the sprite (28×36)
      t.body.setSize(8, 12).setOffset(10, 24);
      t.refreshBody();
      t.isTree = true;
      treesPlaced.push({ tx, ty });
    };

    // 12 forest clusters — each is a tight pack of 20-35 trees
    for (let f = 0; f < 12; f++) {
      let cx, cy, attempts = 0;
      do {
        cx = Phaser.Math.Between(18, CFG.MAP_W-18);
        cy = Phaser.Math.Between(18, CFG.MAP_H-18);
        attempts++;
      } while (attempts < 40 && (Math.abs(cx-stx) < SAFE_R+20 && Math.abs(cy-sty) < SAFE_R+20));
      const biome = getBiome(cx, cy);
      const radius = Phaser.Math.Between(5, 9); // 5-9 tile radius cluster
      const count  = Phaser.Math.Between(22, 35);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist  = Math.sqrt(Math.random()) * radius; // sqrt = uniform density
        placeTree(Math.round(cx + Math.cos(angle)*dist), Math.round(cy + Math.sin(angle)*dist), biome);
      }
    }

    // Scattered fringe trees outside clusters (sparse woodland, not in clusters)
    for (let i = 0; i < 100; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-2), ty = Phaser.Math.Between(2, CFG.MAP_H-2);
      placeTree(tx, ty, getBiome(tx, ty));
    }

    // Great Trees — landmark-scale trees, 2-3 per relevant biome
    const greatTreeBiomes = [
      { biome: 'grass', key: 'great_oak',      ox: 20, oy: 14, bw: 10, bh: 12, bx: 15, by: 36 },
      { biome: 'tundra', key: 'great_pine',    ox: 15, oy: 10, bw: 5,  bh: 14, bx: 12, by: 46 },
      { biome: 'swamp',  key: 'great_mangrove',ox: 26, oy: 14, bw: 28, bh: 10, bx: 12, by: 38 },
    ];
    for (const { biome, key, ox, oy, bw, bh, bx, by } of greatTreeBiomes) {
      let placed = 0;
      for (let att = 0; att < 120 && placed < 3; att++) {
        const tx = Phaser.Math.Between(8, CFG.MAP_W-8);
        const ty = Phaser.Math.Between(8, CFG.MAP_H-8);
        if (getBiome(tx, ty) !== biome) continue;
        if (Math.abs(tx-stx) < SAFE_R+6 && Math.abs(ty-sty) < SAFE_R+6) continue;
        if (treesPlaced.some(p => Math.abs(p.tx-tx) <= 2 && Math.abs(p.ty-ty) <= 2)) continue;
        const sc = Phaser.Math.FloatBetween(2.6, 3.4);
        const t = this.obstacles.create(tx*TILE+ox, ty*TILE+oy, key);
        t.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
        t.body.setSize(bw, bh).setOffset(bx, by);
        t.refreshBody();
        t.isTree = true;
        treesPlaced.push({ tx, ty });
        placed++;
      }
    }

    // Rocks — biome-appropriate
    for (let i = 0; i < CFG.ROCKS; i++) {
      const tx = Phaser.Math.Between(1, CFG.MAP_W-2), ty = Phaser.Math.Between(1, CFG.MAP_H-2);
      if (Math.abs(tx-stx)<SAFE_R && Math.abs(ty-sty)<SAFE_R) continue;
      if (this._preCacheTiles && this._preCacheTiles.some(p => Math.abs(p.tx-tx) <= 4 && Math.abs(p.ty-ty) <= 4)) continue;
      const biome = getBiome(tx, ty);
      const rockKey = biome === 'tundra' ? 'ice_rock' : 'rock';
      const sc = Phaser.Math.FloatBetween(0.4, 3.5);
      const r = this.obstacles.create(tx*TILE+11, ty*TILE+8, rockKey);
      r.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      // Tighter oval hitbox (rock sprite is 22×16, use ~65% size)
      r.body.setCircle(6, 5, 2);
      r.refreshBody();
    }

    // Extra rocks in wasteland
    for (let i = 0; i < 60; i++) {
      const tx = Phaser.Math.Between(1, CFG.MAP_W-2), ty = Phaser.Math.Between(1, CFG.MAP_H-2);
      if (getBiome(tx, ty) !== 'waste') continue;
      if (this._preCacheTiles && this._preCacheTiles.some(p => Math.abs(p.tx-tx) <= 4 && Math.abs(p.ty-ty) <= 4)) continue;
      const sc = Phaser.Math.FloatBetween(0.3, 2.0);
      const r = this.obstacles.create(tx*TILE+11, ty*TILE+8, 'rock');
      r.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      r.body.setCircle(6, 5, 2);
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

    // Ruins city — navigable abandoned city grid (replaces scattered pillars)
    this.buildRuinsCity(stx, sty, TILE);

    // Decorative craters — visual only, non-blocking
    for (let i = 0; i < 36; i++) {
      const tx = Phaser.Math.Between(3, CFG.MAP_W-4), ty = Phaser.Math.Between(3, CFG.MAP_H-4);
      if (Math.abs(tx-stx) < SAFE_R+4 && Math.abs(ty-sty) < SAFE_R+4) continue;
      const b = getBiome(tx, ty);
      if (b !== 'waste' && b !== 'ruins') continue;
      // Rare mega crater (1 in 6): very large, landmark-scale impact site
      const isMega = Math.random() < 0.17;
      const key = (isMega || Math.random() < 0.45) ? 'crater_large' : 'crater_small';
      const sc = isMega ? Phaser.Math.FloatBetween(2.8, 4.2) : Phaser.Math.FloatBetween(0.6, 2.4);
      const alpha = isMega ? 0.85 : 0.7;
      this._w(this.add.image(tx*TILE, ty*TILE, key).setScale(sc).setDepth(1.5).setAlpha(alpha));
    }
    // Dense small craters in wasteland core + extras
    for (let i = 0; i < 55; i++) {
      const tx = Phaser.Math.Between(3, CFG.MAP_W-4), ty = Phaser.Math.Between(3, CFG.MAP_H-4);
      if (getBiome(tx, ty) !== 'waste') continue;
      const sc = Phaser.Math.FloatBetween(0.4, 1.8);
      this._w(this.add.image(tx*TILE + Phaser.Math.Between(-8, 8), ty*TILE + Phaser.Math.Between(-8, 8), 'crater_small').setScale(sc).setDepth(1.5).setAlpha(0.55));
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

    // _preCacheTiles already populated above (all POI positions, before tree/rock placement)

    // Mountain ranges — impassable ridgelines with walkable gaps
    this.mountainTiles = [];
    const mtns = this.mountainTiles;
    const mtnMinDist = 2; // tighter packing for visible ridgeline
    const placeMtn = (tx, ty, key, sc) => {
      if (Math.abs(tx-stx)<SAFE_R+6 && Math.abs(ty-sty)<SAFE_R+6) return;
      for (const m of mtns) {
        if (Math.abs(m.tx-tx) < mtnMinDist && Math.abs(m.ty-ty) < mtnMinDist) return;
      }
      // Fjord protection: leave entrance gap toward map center for each supply cache
      for (const cache of this._preCacheTiles) {
        const dx = tx - cache.tx, dy = ty - cache.ty;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 8 && dist > 0.5) {
          // Angle from cache to this mountain position
          const mtnAngle = Math.atan2(dy, dx);
          let relAngle = mtnAngle - cache.gapAngle;
          while (relAngle > Math.PI)  relAngle -= 2*Math.PI;
          while (relAngle < -Math.PI) relAngle += 2*Math.PI;
          // Block mountains in the entrance sector (~100° gap toward center)
          if (Math.abs(relAngle) < 0.87) return; // 0.87 rad ≈ 50° each side
        }
      }
      const px = tx*TILE+24, py = ty*TILE+20;
      const ob = this.obstacles.create(px, py, key);
      ob.setScale(sc).setDepth(6 + ty*0.01).setImmovable(true);
      // Scale-compensated circle hitbox: world radius stays ~16px regardless of mountain scale.
      // StaticBody world radius = r * scale, so divide desired world radius by sc.
      {
        const R = 16;
        const r = Math.round(R / sc);
        if (key === 'mountain2') {
          // mountain2 (112×88): visual base center at sprite (56, 62)
          ob.body.setCircle(r, Math.round(56 / sc - r), Math.round(62 / sc - r));
        } else {
          // mountain (96×80): visual base center at sprite (48, 62)
          ob.body.setCircle(r, Math.round(48 / sc - r), Math.round(62 / sc - r));
        }
      }
      ob.refreshBody();
      mtns.push({ tx, ty });
    };

    // Ring of mountains around the grasslands/center — dense ridgeline with randomised exits
    const ringR = SAFE_R + 18;

    // Choose 2 or 3 random cardinal exits (different every game)
    const cardinalDirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2]; // E, S, W, N
    Phaser.Utils.Array.Shuffle(cardinalDirs);
    const exitAngles = cardinalDirs.slice(0, Phaser.Math.Between(2, 3));
    this._exitAngles = exitAngles; // stored for future minimap markers
    const EXIT_HALF_ARC = 0.30; // radians each side — gives ~17-tile wide corridor at ringR=32
    const angDist = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };

    for (let angle = 0; angle < Math.PI * 2; angle += 0.08) {
      // Skip mountains inside any exit corridor
      if (exitAngles.some(ea => angDist(angle, ea) < EXIT_HALF_ARC)) continue;
      const tx = Math.round(stx + Math.cos(angle) * (ringR + Math.sin(angle*3)*3));
      const ty = Math.round(sty + Math.sin(angle) * (ringR + Math.cos(angle*5)*3));
      if (tx < 2 || tx > CFG.MAP_W-3 || ty < 2 || ty > CFG.MAP_H-3) continue;
      const key = Math.random() < 0.45 ? 'mountain2' : 'mountain';
      const sc = Phaser.Math.FloatBetween(2.0, 3.2);
      placeMtn(tx, ty, key, sc);
      // Double-layer: second ring row for a thick visible ridge (skip in exit zones)
      if (Math.random() < 0.6) {
        const tx2 = Math.round(stx + Math.cos(angle) * (ringR + 3 + Math.sin(angle*5)*2));
        const ty2 = Math.round(sty + Math.sin(angle) * (ringR + 3 + Math.cos(angle*3)*2));
        placeMtn(tx2, ty2, Math.random() < 0.4 ? 'mountain2' : 'mountain', Phaser.Math.FloatBetween(1.8, 2.6));
      }
    }

    // Large mountain clusters in outer biomes — 8-15 mountains each
    const clusterCenters = [
      { tx: Math.round(stx - CFG.MAP_W*0.3), ty: Math.round(sty - CFG.MAP_H*0.3) }, // tundra
      { tx: Math.round(stx + CFG.MAP_W*0.3), ty: Math.round(sty - CFG.MAP_H*0.25) }, // ruins
      { tx: Math.round(stx - CFG.MAP_W*0.25), ty: Math.round(sty + CFG.MAP_H*0.3) }, // wasteland
      { tx: Math.round(stx + CFG.MAP_W*0.28), ty: Math.round(sty + CFG.MAP_H*0.28) }, // swamp
      { tx: Math.round(stx - CFG.MAP_W*0.1),  ty: Math.round(sty - CFG.MAP_H*0.38) }, // far north
      { tx: Math.round(stx + CFG.MAP_W*0.1),  ty: Math.round(sty + CFG.MAP_H*0.38) }, // far south
      { tx: Math.round(stx - CFG.MAP_W*0.38), ty: Math.round(sty + CFG.MAP_H*0.05) }, // far west
      { tx: Math.round(stx + CFG.MAP_W*0.38), ty: Math.round(sty - CFG.MAP_H*0.05) }, // far east
    ];
    for (const cc of clusterCenters) {
      const count = Phaser.Math.Between(8, 15);
      for (let i = 0; i < count; i++) {
        const tx = cc.tx + Phaser.Math.Between(-8, 8);
        const ty = cc.ty + Phaser.Math.Between(-8, 8);
        if (tx < 2 || tx > CFG.MAP_W-3 || ty < 2 || ty > CFG.MAP_H-3) continue;
        const key = Math.random() < 0.4 ? 'mountain2' : 'mountain';
        const sc = Phaser.Math.FloatBetween(2.2, 4.0);
        placeMtn(tx, ty, key, sc);
      }
    }

    // Pre-build LOS blocker set for enemy AI — mountain tile coords → O(1) lookup
    this._solidTileSet = new Set();
    for (const m of this.mountainTiles) {
      // Mark a small neighbourhood so the set works at diagonal query positions
      for (let dtx = -1; dtx <= 1; dtx++) {
        for (let dty = -1; dty <= 1; dty++) {
          this._solidTileSet.add((m.tx + dtx) + ',' + (m.ty + dty));
        }
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

    // ── BIOME STRUCTURES ─────────────────────────────────────
    this.buildBiomeStructures(stx, sty, TILE);

    // Clear trees and rocks near ALL pre-computed POI positions.
    // Runs after buildBiomeStructures so structure wall tiles are never destroyed.
    // Mountains excluded — fjord algorithm already handles their entrance gaps.
    if (this._preCacheTiles && this.obstacles) {
      const CLEAR_R = 80;
      const ROCK_KEYS = new Set(['rock', 'rock2', 'ice_rock']);
      this.obstacles.getChildren().slice().forEach(ob => {
        const k = ob.texture && ob.texture.key;
        if (k === 'mountain' || k === 'mountain2') return;
        if (!ob.isTree && !ROCK_KEYS.has(k)) return; // keep structure walls, ruin blocks, etc.
        for (const pos of this._preCacheTiles) {
          const dx = ob.x - pos.tx * TILE, dy = ob.y - pos.ty * TILE;
          if (dx * dx + dy * dy < CLEAR_R * CLEAR_R) { ob.destroy(); break; }
        }
      });
    }

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

    // Supply Caches — use pre-computed positions (fjord + tree-clear guaranteed)
    const cachePositions = (this._preCacheTiles_caches && this._preCacheTiles_caches.length)
      ? this._preCacheTiles_caches
      : ['waste', 'swamp', 'tundra', 'ruins'].map(b => findInBiome(b, 50));
    for (let i = 0; i < cachePositions.length; i++) {
      const pos = cachePositions[i];
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

    // Enemy Dens — use pre-computed positions (fjord-protected + tree-clear)
    this.enemyDens = [];
    const denPositions = (this._preDenTiles && this._preDenTiles.length)
      ? this._preDenTiles
      : ['waste', 'swamp', 'tundra'].map(b => findInBiome(b, 50));
    for (const pos of denPositions) {
      const px = pos.tx * TILE, py = pos.ty * TILE;
      const spr = this._w(this.add.image(px, py, 'enemy_den').setScale(2).setDepth(5));
      const lbl = this._w(this.add.text(px, py - 24, 'ENEMY DEN', {
        fontFamily:'monospace', fontSize:'8px', color:'#cc4444', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(7));
      this.enemyDens.push({ x: px, y: py, tx: pos.tx, ty: pos.ty, respawnTimer: 0 });
      this.pois.push({ type:'den', tx:pos.tx, ty:pos.ty, spr });
    }

    // Radio Tower (1, in ruins biome) — use pre-computed position
    {
      const pos = this._preTowerTile || findInBiome('ruins', 80);
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

    // Campsites — use pre-computed positions (fjord-protected + tree-clear)
    this.campsites = [];
    const campsitePositions = (this._preCampsiteTiles && this._preCampsiteTiles.length)
      ? this._preCampsiteTiles
      : ['grass', 'waste'].map(b => findInBiome(b, 50));
    for (const pos of campsitePositions) {
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

  // ── RUINS CITY ────────────────────────────────────────────────
  // Procedural navigable city grid in the ruins biome (NE quadrant)
  buildRuinsCity(stx, sty, TILE) {
    const blockW = 9, blockH = 8;    // block size in tiles (walls inclusive)
    const streetW = 4, streetH = 4;  // street width in tiles
    const cols = 5, rows = 4;

    // Place city in ruins biome (NE quadrant: right + up from center)
    const cityTX = Math.round(stx + CFG.MAP_W * 0.21);
    const cityTY = Math.round(sty - CFG.MAP_H * 0.21);
    const totalW = cols * blockW + (cols - 1) * streetW;
    const totalH = rows * blockH + (rows - 1) * streetH;
    const cityLeft = cityTX - Math.floor(totalW / 2);
    const cityTop  = cityTY - Math.floor(totalH / 2);

    // Clamp to map bounds
    const cl = Math.max(3, cityLeft), ct = Math.max(3, cityTop);

    // Helper — place one wall segment (obstacle with tight hitbox)
    const placeWall = (tx, ty) => {
      if (tx < 2 || tx > CFG.MAP_W-3 || ty < 2 || ty > CFG.MAP_H-3) return;
      if (Math.abs(tx-stx) < CFG.SAFE_R+3 && Math.abs(ty-sty) < CFG.SAFE_R+3) return;
      const w = this.obstacles.create(tx*TILE+16, ty*TILE+16, 'ruin_block');
      w.setDepth(5 + ty*0.01).setImmovable(true);
      w.body.setSize(28, 28); // slightly smaller than full tile for passability at seams
      w.refreshBody();
    };

    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const bx = cl + col * (blockW + streetW);
        const by = ct + row * (blockH + streetH);

        // Assign block type: 50% residential, 30% commercial, 20% tower
        const rnd = Math.random();
        const blockType = rnd < 0.5 ? 'residential' : rnd < 0.8 ? 'commercial' : 'tower';

        // Towers: small solid building in center of block, no street doorways
        if (blockType === 'tower') {
          const tw = 4, th = 4;
          const tx0 = bx + Math.floor((blockW - tw) / 2);
          const ty0 = by + Math.floor((blockH - th) / 2);
          // Solid walls — no doorways
          for (let i = 0; i < tw; i++) { placeWall(tx0+i, ty0); placeWall(tx0+i, ty0+th-1); }
          for (let j = 1; j < th-1; j++) { placeWall(tx0, ty0+j); placeWall(tx0+tw-1, ty0+j); }
          // Extra-depth overlay to suggest height
          for (let i = 1; i < tw-1; i++) {
            for (let j = 0; j < th-1; j++) {
              if (tx0+i < 2 || ty0+j < 2) continue;
              this._w(this.add.image((tx0+i)*TILE+16, (ty0+j)*TILE+10, 'ruin_block').setDepth(7 + (ty0+j)*0.01).setAlpha(0.6));
            }
          }
          // Central tall pillar
          const sc = Phaser.Math.FloatBetween(1.5, 2.2);
          this._w(this.add.image((tx0+tw/2)*TILE, (ty0+th/2)*TILE, 'pillar').setScale(sc).setDepth(6 + (ty0+th/2)*0.01));
          continue; // skip normal wall drawing for towers
        }

        const doorCenter = { N: Math.floor(blockW/2)-1, S: Math.floor(blockW/2)-1,
                             W: Math.floor(blockH/2)-1, E: Math.floor(blockH/2)-1 };
        const hasDoorN = row > 0;
        const hasDoorS = row < rows-1;
        const hasDoorW = col > 0;
        const hasDoorE = col < cols-1;
        // Commercial blocks have wider doorways (3 tiles) and more decay
        const doorSize   = blockType === 'commercial' ? 3 : 2;
        const decayChance = blockType === 'commercial' ? 0.18 : 0.1;

        // Interior floor tiles
        for (let wx = bx+1; wx < bx+blockW-1; wx++) {
          for (let wy = by+1; wy < by+blockH-1; wy++) {
            if (wx < 2 || wx > CFG.MAP_W-3 || wy < 2 || wy > CFG.MAP_H-3) continue;
            this._w(this.add.tileSprite(wx*TILE, wy*TILE, TILE, TILE, 'ruin_floor').setOrigin(0).setDepth(0.6));
          }
        }

        // Scatter interior rubble / pillars — more in commercial blocks
        const rubbleCount = blockType === 'commercial' ? Phaser.Math.Between(3, 6) : Phaser.Math.Between(1, 3);
        for (let r = 0; r < rubbleCount; r++) {
          const rx = bx + 1 + Phaser.Math.Between(0, blockW-3);
          const ry = by + 1 + Phaser.Math.Between(0, blockH-3);
          if (rx < 2 || rx > CFG.MAP_W-3 || ry < 2 || ry > CFG.MAP_H-3) continue;
          const sc = Phaser.Math.FloatBetween(0.5, 1.2);
          const key = Math.random() < 0.5 ? 'pillar' : 'ruin_block';
          this._w(this.add.image(rx*TILE + Phaser.Math.Between(-6, 6), ry*TILE + Phaser.Math.Between(-6, 6),
            key).setScale(sc).setDepth(4 + ry*0.01).setAlpha(0.9));
        }

        // North wall
        for (let i = 0; i < blockW; i++) {
          const isDoor = hasDoorN && i >= doorCenter.N && i < doorCenter.N + doorSize;
          if (!isDoor && Math.random() >= decayChance) placeWall(bx+i, by);
        }
        // South wall
        for (let i = 0; i < blockW; i++) {
          const isDoor = hasDoorS && i >= doorCenter.S && i < doorCenter.S + doorSize;
          if (!isDoor && Math.random() >= decayChance) placeWall(bx+i, by+blockH-1);
        }
        // West wall
        for (let j = 1; j < blockH-1; j++) {
          const isDoor = hasDoorW && j >= doorCenter.W && j < doorCenter.W + doorSize;
          if (!isDoor && Math.random() >= decayChance) placeWall(bx, by+j);
        }
        // East wall
        for (let j = 1; j < blockH-1; j++) {
          const isDoor = hasDoorE && j >= doorCenter.E && j < doorCenter.E + doorSize;
          if (!isDoor && Math.random() >= decayChance) placeWall(bx+blockW-1, by+j);
        }
      }
    }

    // Outskirt rubble — scattered ruined walls outside the main grid
    for (let i = 0; i < 30; i++) {
      const tx = cl + Phaser.Math.Between(-8, totalW+8);
      const ty = ct + Phaser.Math.Between(-8, totalH+8);
      if (tx >= cl-2 && tx <= cl+totalW+2 && ty >= ct-2 && ty <= ct+totalH+2) continue; // skip inside city
      if (getBiome(tx, ty) !== 'ruins') continue;
      const sc = Phaser.Math.FloatBetween(0.8, 1.8);
      if (Math.random() < 0.5) {
        const p = this.obstacles.create(tx*TILE+11, ty*TILE+18, 'pillar');
        p.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
        p.body.setSize(10, 20).setOffset(6, 16);
        p.refreshBody();
      } else {
        placeWall(tx, ty);
      }
    }
  }

  // ── BIOME STRUCTURES ──────────────────────────────────────────
  // Small abandoned structures in each biome — high risk, high reward.
  // Enemies spawn inside/around each structure (see spawnEnemies).
  buildBiomeStructures(stx, sty, TILE) {
    this._structureLocs = [];
    const { MAP_W, MAP_H, SAFE_R } = CFG;
    const W = 7, H = 5; // structure footprint in tiles

    const biomeConfig = [
      { biome: 'grass',  wallKey: 'plank_wall', floorKey: null,        label: 'FARMHOUSE' },
      { biome: 'tundra', wallKey: 'ruin_block',  floorKey: 'ice_floor', label: 'OUTPOST'   },
      { biome: 'swamp',  wallKey: 'rot_plank',   floorKey: null,        label: 'SHACK'     },
      { biome: 'waste',  wallKey: 'metal_wall',  floorKey: null,        label: 'BUNKER'    },
    ];

    for (const { biome, wallKey, floorKey, label } of biomeConfig) {
      // Use pre-computed positions (fjord-protected + tree-clear guaranteed).
      // Fall back to random if pre-computation returned nothing for this biome.
      const _prePos = (this._preStructureTiles && this._preStructureTiles[biome]) || [];
      const _positions = _prePos.length ? _prePos : (() => {
        const fb = [];
        for (let att = 0; att < 120 && fb.length < 2; att++) {
          const tx = Phaser.Math.Between(12, MAP_W - 12), ty = Phaser.Math.Between(12, MAP_H - 12);
          if (getBiome(tx, ty) !== biome) continue;
          if (Math.abs(tx - stx) < SAFE_R + 12 && Math.abs(ty - sty) < SAFE_R + 12) continue;
          fb.push({ tx, ty });
        }
        return fb;
      })();
      for (const pos of _positions) {
        const cx = pos.tx, cy = pos.ty;
        const x0 = cx - Math.floor(W / 2);
        const y0 = cy - Math.floor(H / 2);

        // Floor tiles (tundra only — ice_floor)
        if (floorKey) {
          for (let dx = 1; dx < W - 1; dx++) {
            for (let dy = 1; dy < H - 1; dy++) {
              const tx = x0 + dx, ty = y0 + dy;
              if (tx < 2 || tx > MAP_W - 3 || ty < 2 || ty > MAP_H - 3) continue;
              this._w(this.add.tileSprite(tx * TILE, ty * TILE, TILE, TILE, floorKey).setOrigin(0).setDepth(0.65));
            }
          }
        }

        const doorTile = Math.floor(W / 2) - 1; // 2-tile doorway centered on south wall

        // Helper to place one wall tile
        const placeW = (tx, ty) => {
          if (tx < 2 || tx > MAP_W - 3 || ty < 2 || ty > MAP_H - 3) return;
          const w = this.obstacles.create(tx * TILE + 16, ty * TILE + 16, wallKey);
          w.setDepth(5 + ty * 0.01).setImmovable(true);
          w.body.setSize(28, 28); w.refreshBody();
        };

        // North wall (solid)
        for (let dx = 0; dx < W; dx++) placeW(x0 + dx, y0);
        // South wall with doorway
        for (let dx = 0; dx < W; dx++) {
          if (dx !== doorTile && dx !== doorTile + 1) placeW(x0 + dx, y0 + H - 1);
        }
        // West wall
        for (let dy = 1; dy < H - 1; dy++) placeW(x0, y0 + dy);
        // East wall
        for (let dy = 1; dy < H - 1; dy++) placeW(x0 + W - 1, y0 + dy);

        // Interior loot — resource items scattered inside
        const lootKeys = ['item_wood', 'item_metal', 'item_fiber', 'item_food'];
        for (let l = 0; l < Phaser.Math.Between(2, 4); l++) {
          const lx = (x0 + 1 + Phaser.Math.Between(0, W - 3)) * TILE + Phaser.Math.Between(-6, 6);
          const ly = (y0 + 1 + Phaser.Math.Between(0, H - 3)) * TILE + Phaser.Math.Between(-6, 6);
          const itemKey = lootKeys[Phaser.Math.Between(0, lootKeys.length - 1)];
          const item = this.physics.add.image(lx, ly, itemKey).setScale(2).setDepth(6);
          item.body.allowGravity = false; item.body.setImmovable(true);
          item.itemType = itemKey.replace('item_', '');
          this._w(item);
          this.worldCrates.push(item);
        }

        // Label above structure
        const wx = (x0 + W / 2) * TILE, wy = y0 * TILE - 12;
        this._w(this.add.text(wx, wy, label, {
          fontFamily: 'monospace', fontSize: '8px', color: '#cc9944', stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(7).setAlpha(0.85));

        // Record for enemy spawning
        this._structureLocs.push({ x: cx * TILE, y: cy * TILE, biome });
      }
    }
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

    // Persistent MENU button — bottom-right, works for both keyboard and touch
    const menuBtn = this._h(this.add.text(W - 14, H - 12, '\u2630  MENU', {
      fontFamily:'monospace', fontSize:'12px', color:'#557755',
      backgroundColor:'#00000088', padding:{ x:8, y:4 },
    }).setOrigin(1, 1).setDepth(104).setInteractive({ useHandCursor: true }));
    menuBtn.on('pointerover', () => menuBtn.setColor('#aaffaa'));
    menuBtn.on('pointerout',  () => menuBtn.setColor('#557755'));
    menuBtn.on('pointerdown', () => { if (!this.isOver) this.toggleControls(); });

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
        else if (poi.type === 'raidcamp') col = 0xff2222;   // red — raider camp
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
        kills: this.kills,
        days: this.dayNum,
        resources: this.resourcesGathered,
        bossDefeated: this.bossDefeated,
        p1Name: this.p1 ? this.p1.charData.player : 'P1',
        p2Name: this.p2 ? this.p2.charData.player : null,
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

    // P1 controls — left side (margin from edge to avoid browser chrome clipping)
    const p1Lines = getControls(1, p1Ch.id, this.solo);
    const lbg = push(this.add.graphics().setDepth(95));
    lbg.fillStyle(0x000011, 0.88);
    lbg.fillRoundedRect(20, H/2 - 14 - p1Lines.length*10, 188, p1Lines.length*20 + 36, 8);
    lbg.lineStyle(1, 0x4466aa, 0.7);
    lbg.strokeRoundedRect(20, H/2 - 14 - p1Lines.length*10, 188, p1Lines.length*20 + 36, 8);
    push(this.add.text(28, H/2 - 10 - p1Lines.length*10, p1Ch.player + ' — ' + p1Ch.title, {
      fontFamily:'monospace', fontSize:'10px', color:'#88aaff', stroke:'#000', strokeThickness:2,
    }).setDepth(96));
    p1Lines.forEach((l, i) => {
      push(this.add.text(28, H/2 + 8 - p1Lines.length*10 + i*20, l, {
        fontFamily:'monospace', fontSize:'9px', color:'#ccd8ee', stroke:'#000', strokeThickness:2,
      }).setDepth(96));
    });

    // P2 controls — right side
    if (p2Ch) {
      const p2Lines = getControls(2, p2Ch.id);
      const rbg = push(this.add.graphics().setDepth(95));
      rbg.fillStyle(0x110008, 0.88);
      rbg.fillRoundedRect(W-208, H/2 - 14 - p2Lines.length*10, 188, p2Lines.length*20 + 36, 8);
      rbg.lineStyle(1, 0xaa6633, 0.7);
      rbg.strokeRoundedRect(W-208, H/2 - 14 - p2Lines.length*10, 188, p2Lines.length*20 + 36, 8);
      push(this.add.text(W-200, H/2 - 10 - p2Lines.length*10, p2Ch.player + ' — ' + p2Ch.title, {
        fontFamily:'monospace', fontSize:'10px', color:'#ffbb77', stroke:'#000', strokeThickness:2,
      }).setDepth(96));
      p2Lines.forEach((l, i) => {
        push(this.add.text(W-200, H/2 + 8 - p2Lines.length*10 + i*20, l, {
          fontFamily:'monospace', fontSize:'9px', color:'#eeddcc', stroke:'#000', strokeThickness:2,
        }).setDepth(96));
      });
    }

    // Bottom action buttons — Settings and Quit
    const btnY = H - 64;
    const btnStyle = (col) => ({
      fontFamily:'monospace', fontSize:'14px', color: col,
      backgroundColor:'#00000099', padding:{ x:16, y:8 },
      stroke:'#000', strokeThickness:2,
    });

    const settBtn = push(this.add.text(W/2 - 140, btnY, '\u2699  SETTINGS', btnStyle('#88aacc'))
      .setOrigin(0.5).setDepth(97).setInteractive({ useHandCursor: true }));
    settBtn.on('pointerover', () => settBtn.setColor('#ccddff'));
    settBtn.on('pointerout',  () => settBtn.setColor('#88aacc'));
    settBtn.on('pointerdown', () => {
      this.ctrlObjs.forEach(o => o.setVisible(false));
      this.controlsVis = false;
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => this.scene.start('Settings'));
    });

    const quitBtn = push(this.add.text(W/2 + 140, btnY, '\u2715  QUIT TO MENU', btnStyle('#cc6655'))
      .setOrigin(0.5).setDepth(97).setInteractive({ useHandCursor: true }));
    quitBtn.on('pointerover', () => quitBtn.setColor('#ff9988'));
    quitBtn.on('pointerout',  () => quitBtn.setColor('#cc6655'));
    quitBtn.on('pointerdown', () => {
      this.ctrlObjs.forEach(o => o.setVisible(false));
      this.controlsVis = false;
      this.triggerGameOver('Run abandoned — better luck next time.');
    });

    push(this.add.text(W/2, H - 18, 'TAB  or  ESC  to close   \u2022   \u2630 MENU button bottom-right', {
      fontFamily:'monospace', fontSize:'9px', color:'#334455', stroke:'#000', strokeThickness:2,
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
    if (!this._worldReady) return; // deferred world init not yet complete
    if (this.isOver) return;

    if (this.controlsVis || this.barrackOpen) {
      this.p1.spr.setVelocity(0,0);
      if (this.p2) this.p2.spr.setVelocity(0,0);
      return;
    }

    this.timeAlive += delta / 1000;

    // Movement — skip if downed or sleeping
    if (!this.p1.isDowned && !this.p1.isSleeping) {
      if (this._touchActive) {
        this.applyTouchInput();  // touch: joystick drives movement + facing
      } else {
        this.movePlayer(this.p1, this.wasd.left, this.wasd.right, this.wasd.up, this.wasd.down);
        if (this.solo) this.aimAtMouse(this.p1); // 1P: mouse aims
      }
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
    this.updateRaiders(delta);
    this.updateBoss(delta);
    this.updateSleep(delta);
    this.updateDayNight(delta);
    this.updateBuildMode();
    this.updateHarvest(delta);
    this.updateFog();
    this.updateMinimap();
    this.redrawHUD();
    if (this._touchActive) this._drawTouchHUD();
  }

  // ── TOUCH CONTROLS ────────────────────────────────────────────
  initTouchControls() {
    const { W, H } = CFG;
    this._touchActive = true;

    // Support up to 4 simultaneous touches
    this.input.addPointer(4);

    // Joystick state — dynamic base: appears where finger lands
    this._joy = {
      active: false, pointerId: -1,
      baseX: 0, baseY: 0,
      knobX: 0, knobY: 0,
      radius: 72,
      vec: { x: 0, y: 0 },
    };

    // Buttons (HUD-space coordinates, radius for hit detection)
    // Layout: ATK bottom-right, ALT above ATK, USE left of ATK, BLD left of ALT, MENU top-right
    this._tcBtns = {
      attack:   { hx: W - 100, hy: H - 100, r: 52, down: false, pid: -1, col: 0xff6644, label: '\u2694 ATK' },
      alt:      { hx: W - 185, hy: H - 195, r: 38, down: false, pid: -1, col: 0x6699ff, label: '\u2605 ALT' },
      interact: { hx: W - 195, hy: H - 95,  r: 34, down: false, pid: -1, col: 0x44cc66, label: 'E USE' },
      build:    { hx: W - 282, hy: H - 195, r: 34, down: false, pid: -1, col: 0xccaa33, label: '\u25a0 BLD' },
      menu:     { hx: W - 32,  hy: 32,      r: 22, down: false, pid: -1, col: 0x888888, label: '\u2630' },
    };

    // Graphics layer on HUD (single object, redrawn each frame)
    this._tcGfx = this.add.graphics().setDepth(150);
    this._h(this._tcGfx);

    // Text labels for buttons (created once, positioned at button centers)
    this._tcLabels = {};
    for (const [name, btn] of Object.entries(this._tcBtns)) {
      const t = this.add.text(btn.hx, btn.hy, btn.label, {
        fontFamily: 'monospace', fontSize: name === 'attack' ? '11px' : '9px',
        color: '#ffffff', stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(151);
      this._h(t);
      this._tcLabels[name] = t;
    }

    // Pointer event handlers
    this.input.on('pointerdown', this._onTouchDown, this);
    this.input.on('pointermove', this._onTouchMove, this);
    this.input.on('pointerup',   this._onTouchUp,   this);
    this.input.on('pointerupoutside', this._onTouchUp, this);
  }

  _onTouchDown(pointer) {
    if (!this._touchActive) return;
    const { W, H } = CFG;
    const px = pointer.x, py = pointer.y;

    // Left 45% of screen and bottom 55% → joystick
    if (px < W * 0.45 && py > H * 0.35 && !this._joy.active) {
      this._joy.active = true;
      this._joy.pointerId = pointer.id;
      this._joy.baseX = px;
      this._joy.baseY = py;
      this._joy.knobX = px;
      this._joy.knobY = py;
      this._joy.vec = { x: 0, y: 0 };
      return;
    }

    // Check action buttons
    for (const [name, btn] of Object.entries(this._tcBtns)) {
      if (btn.down) continue;
      const dx = px - btn.hx, dy = py - btn.hy;
      if (dx*dx + dy*dy <= btn.r * btn.r) {
        btn.down = true;
        btn.pid = pointer.id;
        this._onBtnPress(name);
        return;
      }
    }
  }

  _onTouchMove(pointer) {
    if (!this._touchActive || !this._joy.active) return;
    if (pointer.id !== this._joy.pointerId) return;
    const dx = pointer.x - this._joy.baseX;
    const dy = pointer.y - this._joy.baseY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const r = this._joy.radius;
    if (dist > r) {
      this._joy.knobX = this._joy.baseX + (dx/dist)*r;
      this._joy.knobY = this._joy.baseY + (dy/dist)*r;
    } else {
      this._joy.knobX = pointer.x;
      this._joy.knobY = pointer.y;
    }
    const clamped = Math.min(dist, r);
    this._joy.vec.x = (dx/Math.max(dist,1)) * (clamped/r);
    this._joy.vec.y = (dy/Math.max(dist,1)) * (clamped/r);
  }

  _onTouchUp(pointer) {
    if (!this._touchActive) return;
    if (this._joy.active && pointer.id === this._joy.pointerId) {
      this._joy.active = false;
      this._joy.pointerId = -1;
      this._joy.vec = { x: 0, y: 0 };
      if (this.p1) this.p1.spr.setVelocity(0, 0);
    }
    for (const btn of Object.values(this._tcBtns)) {
      if (btn.pid === pointer.id) { btn.down = false; btn.pid = -1; }
    }
  }

  _onBtnPress(name) {
    if (this.isOver || !this.p1) return;
    if (name === 'attack') {
      if (this.barrackOpen || this.p1.isDowned || this.p1.isSleeping) return;
      if (this.buildMode && this.buildOwner === this.p1) this.placeBuild();
      else this.doAttack(this.p1);
    } else if (name === 'alt') {
      if (!this.p1.isDowned && !this.p1.isSleeping) this.doAlt(this.p1);
    } else if (name === 'interact') {
      if (!this.barrackOpen) this.tryInteract(this.p1);
    } else if (name === 'build') {
      if (!this.p1.isDowned && !this.p1.isSleeping) this.toggleBuildMode(this.p1);
    } else if (name === 'menu') {
      this.toggleControls();
    }
  }

  applyTouchInput() {
    const p = this.p1;
    if (!p || p.isDowned || p.isSleeping) return;
    const jv = this._joy.vec;
    const spd = p.charData.speed;
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
      p.walkTimer = (p.walkTimer + 1) % 20;
      const step = p.walkTimer < 10 ? '' : '_step';
      const dirSuffix = p.dir === 'side' ? '' : ('_' + p.dir);
      p.spr.setTexture(id + dirSuffix + step);
      if (p.dir === 'side' || p.dir === 'fside' || p.dir === 'bside') {
        p.spr.setFlipX(vx < 0);
      } else {
        p.spr.setFlipX(false);
      }
      p.aimAngle = Math.atan2(vy, vx);
    } else {
      p.walkTimer = 0;
      const dirSuffix = p.dir === 'side' ? '' : ('_' + p.dir);
      p.spr.setTexture(id + dirSuffix);
    }
  }

  _drawTouchHUD() {
    const gfx = this._tcGfx;
    if (!gfx || !gfx.active) return;
    gfx.clear();

    // Joystick
    const joy = this._joy;
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
      const { W, H } = CFG;
      gfx.lineStyle(1, 0xffffff, 0.1);
      gfx.strokeCircle(W * 0.12, H * 0.82, 55);
      gfx.fillStyle(0xffffff, 0.03);
      gfx.fillCircle(W * 0.12, H * 0.82, 55);
    }

    // Action buttons
    for (const [name, btn] of Object.entries(this._tcBtns)) {
      const alpha = btn.down ? 0.75 : 0.4;
      gfx.fillStyle(btn.col, alpha * 0.38);
      gfx.fillCircle(btn.hx, btn.hy, btn.r);
      gfx.lineStyle(2, btn.col, alpha);
      gfx.strokeCircle(btn.hx, btn.hy, btn.r);
    }
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

  // ── RAIDER CAMP ───────────────────────────────────────────────
  placeRaiderCamp(worldW, worldH) {
    const { TILE } = CFG;
    // Pick a location in wasteland or ruins biome, away from center
    let cx, cy, attempts = 0;
    do {
      const side = Phaser.Math.Between(0, 3);
      const edgePad = TILE * 15;
      if (side === 0) { cx = Phaser.Math.Between(edgePad, worldW * 0.4); cy = Phaser.Math.Between(edgePad, worldH - edgePad); }
      else if (side === 1) { cx = Phaser.Math.Between(worldW * 0.6, worldW - edgePad); cy = Phaser.Math.Between(edgePad, worldH - edgePad); }
      else if (side === 2) { cx = Phaser.Math.Between(edgePad, worldW - edgePad); cy = Phaser.Math.Between(edgePad, worldH * 0.4); }
      else { cx = Phaser.Math.Between(edgePad, worldW - edgePad); cy = Phaser.Math.Between(worldH * 0.6, worldH - edgePad); }
      attempts++;
    } while (attempts < 20 && Phaser.Math.Distance.Between(cx, cy, worldW/2, worldH/2) < TILE * 40);

    const campSpr = this.physics.add.image(cx, cy, 'raid_camp').setScale(3).setDepth(6);
    campSpr.body.setImmovable(true);
    campSpr.body.allowGravity = false;
    if (this.hudCam) this.hudCam.ignore(campSpr);

    this.raidCamp = { x: cx, y: cy, spr: campSpr };
    const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
    this.pois.push({ type: 'raidcamp', tx, ty, spr: campSpr });

    this.spawnRaiders(cx, cy);
  }

  spawnRaiders(cx, cy) {
    const { TILE } = CFG;
    const count = Phaser.Math.Between(5, 10);
    const types = ['brawler', 'shooter', 'brawler', 'shooter', 'heavy', 'brawler', 'shooter', 'heavy', 'brawler', 'shooter'];
    for (let i = 0; i < count; i++) {
      const rtype = types[i % types.length];
      const angle = Math.random() * Math.PI * 2;
      const dist = Phaser.Math.Between(40, 90);
      const rx = cx + Math.cos(angle) * dist;
      const ry = cy + Math.sin(angle) * dist;
      const texKey = 'raider_' + rtype;
      const spr = this.physics.add.image(rx, ry, texKey).setScale(2.2).setDepth(9);
      spr.setCollideWorldBounds(true);
      spr.body.setSize(18, 22);
      if (this.hudCam) this.hudCam.ignore(spr);
      this.physics.add.collider(spr, this.obstacles);

      const stats = {
        brawler: { hp: 130, speed: 110, dmg: 20, range: 36, atkInterval: 1100, shootRange: 0 },
        shooter: { hp: 80,  speed: 90,  dmg: 16, range: 40, atkInterval: 1200, shootRange: 280 },
        heavy:   { hp: 200, speed: 75,  dmg: 28, range: 42, atkInterval: 1400, shootRange: 200 },
      }[rtype];

      const raider = {
        spr, type: rtype, isRaider: true,
        hp: stats.hp, maxHp: stats.hp,
        speed: stats.speed, dmg: stats.dmg,
        attackRange: stats.range, attackTimer: 0, atkInterval: stats.atkInterval,
        shootRange: stats.shootRange, rangedTimer: 0,
        aggroRange: 320, wanderTimer: Phaser.Math.Between(0, 2000), sizeMult: 1,
      };
      this.raiders.push(raider);
      this.enemies.push(raider); // raiders participate in the normal enemy array so updateEnemies handles them
    }
  }

  updateRaiders(delta) {
    // Shooters fire projectiles; brawlers get a charge lunge
    if (!this.raiders || this.isOver) return;
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && p.hp > 0 && p.spr.visible);

    this.raiders.forEach(raider => {
      if (raider.hp <= 0 || !raider.spr.active) return;

      let nearest = null, nearDist = Infinity;
      players.forEach(p => {
        const d = Phaser.Math.Distance.Between(raider.spr.x, raider.spr.y, p.spr.x, p.spr.y);
        if (d < nearDist) { nearDist = d; nearest = p; }
      });
      if (!nearest) return;

      // Brawler charge lunge: triple speed for 400ms when closing within 100px
      if (raider.type === 'brawler') {
        raider.chargeCooldown = (raider.chargeCooldown || 0) - delta;
        raider.chargeTimer   = (raider.chargeTimer   || 0) - delta;
        if (raider.chargeTimer > 0) {
          // Mid-charge: override movement speed to triple via velocity boost
          const ang = Phaser.Math.Angle.Between(raider.spr.x, raider.spr.y, nearest.spr.x, nearest.spr.y);
          raider.spr.setVelocity(Math.cos(ang) * raider.speed * 3, Math.sin(ang) * raider.speed * 3);
          raider.spr.setTint(0xff4422);
        } else {
          if (raider.spr.tintTopLeft === 0xff4422) raider.spr.clearTint();
          if (nearDist < 100 && nearDist > raider.attackRange && raider.chargeCooldown <= 0) {
            raider.chargeTimer   = 400;
            raider.chargeCooldown = 2000;
          }
        }
        return; // brawlers skip ranged logic
      }

      // Shooters and heavy: ranged fire when in range
      if (!raider.shootRange) return;
      if (nearDist < raider.shootRange && nearDist > raider.attackRange * 1.5) {
        raider.rangedTimer -= delta;
        if (raider.rangedTimer <= 0) {
          raider.rangedTimer = raider.atkInterval;
          this._fireRaiderShot(raider, nearest);
        }
      }
    });
  }

  _fireRaiderShot(raider, target) {
    const ang = Phaser.Math.Angle.Between(raider.spr.x, raider.spr.y, target.spr.x, target.spr.y);
    const bullet = this.physics.add.image(raider.spr.x, raider.spr.y, 'bullet').setScale(2).setDepth(10);
    bullet.body.allowGravity = false;
    if (this.hudCam) this.hudCam.ignore(bullet);
    const speed = 380;
    bullet.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);
    SFX._play(320, 'square', 0.04, 0.15);
    // Raider bullets blocked by terrain and player-built structures
    if (this.obstacles) {
      this.physics.add.collider(bullet, this.obstacles, () => { if (bullet.active) bullet.destroy(); });
    }

    const hitPlayers = [this.p1, this.p2].filter(Boolean);
    hitPlayers.forEach(p => {
      this.physics.add.overlap(p.spr, bullet, () => {
        if (!bullet.active) return;
        bullet.destroy();
        p.hp = Math.max(0, p.hp - raider.dmg * 0.7);
        SFX.playerHurt();
        p.spr.setTint(0xff0000);
        this.time.delayedCall(150, () => { if (p.spr.active) p.spr.clearTint(); });
        this.checkDeaths();
      });
    });
    // Auto-destroy after 2s
    this.time.delayedCall(2000, () => { if (bullet.active) bullet.destroy(); });
  }

  // ── BOSS SYSTEM ───────────────────────────────────────────────
  spawnBoss() {
    if (this.bossSpawned) return;
    this.bossSpawned = true;

    const worldW = CFG.MAP_W * CFG.TILE, worldH = CFG.MAP_H * CFG.TILE;
    const { TILE } = CFG;

    // Pick boss type based on biome spread — random for now
    const bossTypes = [
      { key: 'boss_golem',  name: 'Iron Golem',   biome: 'waste',  hp: 600, speed: 55,  dmg: 22 },
      { key: 'boss_wolf',   name: 'Alpha Wolf',    biome: 'grass',  hp: 420, speed: 130, dmg: 16 },
      { key: 'boss_spider', name: 'Spider Queen',  biome: 'ruins',  hp: 480, speed: 85,  dmg: 18 },
      { key: 'boss_troll',  name: 'Frost Troll',   biome: 'tundra', hp: 700, speed: 45,  dmg: 28 },
      { key: 'boss_hydra',  name: 'Bog Hydra',     biome: 'swamp',  hp: 540, speed: 65,  dmg: 20 },
    ];
    const bt = bossTypes[Phaser.Math.Between(0, bossTypes.length - 1)];

    // Spawn at a random map edge
    let bx, by;
    const side = Phaser.Math.Between(0, 3);
    if (side === 0)      { bx = Phaser.Math.Between(TILE*4, worldW-TILE*4); by = TILE*4; }
    else if (side === 1) { bx = Phaser.Math.Between(TILE*4, worldW-TILE*4); by = worldH-TILE*4; }
    else if (side === 2) { bx = TILE*4; by = Phaser.Math.Between(TILE*4, worldH-TILE*4); }
    else                 { bx = worldW-TILE*4; by = Phaser.Math.Between(TILE*4, worldH-TILE*4); }

    const spr = this.physics.add.image(bx, by, bt.key).setScale(4).setDepth(12);
    spr.setCollideWorldBounds(true);
    spr.body.setSize(28, 28);
    if (this.hudCam) this.hudCam.ignore(spr);
    this.physics.add.collider(spr, this.obstacles);

    // HP bar (world-space, follows boss)
    const hpBg  = this.add.graphics().setDepth(13);
    const hpBar = this.add.graphics().setDepth(14);
    if (this.hudCam) { this.hudCam.ignore(hpBg); this.hudCam.ignore(hpBar); }

    this.boss = {
      spr, hp: bt.hp, maxHp: bt.hp,
      speed: bt.speed, dmg: bt.dmg, name: bt.name,
      isBoss: true, type: bt.key,
      attackTimer: 0, atkInterval: 2200,
      aggroRange: 99999, attackRange: 70, wanderTimer: 0, sizeMult: 1,
      hpBg, hpBar,
    };
    // Add boss to main enemy array so melee + bullets can hit it
    this.enemies.push(this.boss);

    // Announce arrival
    this.hint('\u2620 ' + bt.name.toUpperCase() + ' APPROACHES! \u2620', 6000);
    SFX._play(80,  'sawtooth', 0.6, 0.7, 'drop');
    SFX._play(60,  'sawtooth', 0.4, 0.6, 'drop');

    // Camera shake
    this.cameras.main.shake(800, 0.012);

    // Spawn entourage — 4-8 regular enemies nearby
    const entourageCount = Phaser.Math.Between(4, 8);
    for (let i = 0; i < entourageCount; i++) {
      const ang = (i / entourageCount) * Math.PI * 2;
      const ex = bx + Math.cos(ang) * 100;
      const ey = by + Math.sin(ang) * 100;
      const typeKey = (bt.biome === 'tundra') ? 'wolf' : (bt.biome === 'swamp') ? 'rat' : 'wolf';
      const t = typeKey === 'wolf'
        ? { key:'wolf', hp:60, speed:100, dmg:9, baseScale:1.8, w:20, h:12 }
        : { key:'rat',  hp:30, speed:140, dmg:6, baseScale:1.4, w:15, h:9  };
      const sizeMult = Phaser.Math.FloatBetween(0.9, 1.3);
      const sc = t.baseScale * sizeMult;
      const eSpr = this.physics.add.image(
        Phaser.Math.Clamp(ex, TILE*4, worldW-TILE*4),
        Phaser.Math.Clamp(ey, TILE*4, worldH-TILE*4), t.key
      ).setScale(sc).setDepth(9);
      eSpr.setCollideWorldBounds(true);
      eSpr.body.setSize(t.w, t.h);
      if (this.hudCam) this.hudCam.ignore(eSpr);
      this.physics.add.collider(eSpr, this.obstacles);
      const baseAggro = { wolf: 190, rat: 110 }[t.key] || 160;
      this.enemies.push({
        spr: eSpr, hp: Math.floor(t.hp * sizeMult), maxHp: Math.floor(t.hp * sizeMult),
        speed: t.speed * sizeMult, dmg: Math.max(1, Math.floor(t.dmg * sizeMult)),
        type: t.key, attackTimer: 0,
        wanderTimer: Phaser.Math.Between(0, 1000),
        aggroRange: baseAggro * 1.4, attackRange: (30 + t.w/2) * sizeMult,
        sizeMult,
      });
    }
  }

  updateBoss(delta) {
    if (!this.boss || this.isOver) return;
    const b = this.boss;
    if (b.hp <= 0 || !b.spr.active) {
      // Clean up HP bar
      if (b.hpBg && b.hpBg.active) b.hpBg.destroy();
      if (b.hpBar && b.hpBar.active) b.hpBar.destroy();
      this.boss = null;
      return;
    }

    // Update world-space HP bar above boss
    const bx = b.spr.x, by = b.spr.y;
    const barW = 80, barH = 8;
    b.hpBg.clear();
    b.hpBg.fillStyle(0x220000, 0.85);
    b.hpBg.fillRect(bx - barW/2 - 1, by - 90, barW + 2, barH + 2);
    b.hpBar.clear();
    const pct = Math.max(0, b.hp / b.maxHp);
    const col = pct > 0.5 ? 0xff3300 : pct > 0.25 ? 0xff8800 : 0xff0000;
    b.hpBar.fillStyle(col, 1);
    b.hpBar.fillRect(bx - barW/2, by - 89, barW * pct, barH);
    // Boss name label above bar
    b.hpBg.fillStyle(0x440000, 0.7);
    b.hpBg.fillRect(bx - barW/2 - 1, by - 103, barW + 2, 14);
    b.hpBar.fillStyle(0xffaaaa, 1);
    // (we'll draw text via label instead of graphics)
    if (!b.nameLabel) {
      b.nameLabel = this.add.text(0, 0, '\u2620 ' + b.name.toUpperCase(), {
        fontFamily:'monospace', fontSize:'9px', color:'#ffaaaa',
      }).setDepth(15).setOrigin(0.5, 0);
      if (this.hudCam) this.hudCam.ignore(b.nameLabel);
    }
    b.nameLabel.setPosition(bx, by - 103);

    // Boss chases nearest player — relentless, no wander
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && p.hp > 0);
    if (players.length === 0) { b.spr.setVelocity(0, 0); return; }

    let nearest = players[0], nearDist = Phaser.Math.Distance.Between(b.spr.x, b.spr.y, players[0].spr.x, players[0].spr.y);
    players.forEach(p => {
      const d = Phaser.Math.Distance.Between(b.spr.x, b.spr.y, p.spr.x, p.spr.y);
      if (d < nearDist) { nearDist = d; nearest = p; }
    });

    const ang = Phaser.Math.Angle.Between(b.spr.x, b.spr.y, nearest.spr.x, nearest.spr.y);
    b.spr.setVelocity(Math.cos(ang) * b.speed, Math.sin(ang) * b.speed);
    b.spr.setFlipX(nearest.spr.x < b.spr.x);

    // Attack when in range
    if (nearDist < 70) {
      b.attackTimer -= delta;
      if (b.attackTimer <= 0) {
        b.attackTimer = b.atkInterval;
        nearest.hp = Math.max(0, nearest.hp - b.dmg);
        SFX.playerHurt();
        nearest.spr.setTint(0xff0000);
        this.cameras.main.shake(300, 0.008);
        this.time.delayedCall(200, () => { if (nearest.spr.active) nearest.spr.clearTint(); });
        this.checkDeaths();
      }
    }

    // Boss can be damaged by player attacks — handled in doAttack via enemies array
    // Add boss to enemies array for bullet hit detection (done in spawnBoss)
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
    const isDiag = vx !== 0 && vy !== 0;

    if (moving) {
      // 8-directional facing: diagonal uses fside/bside variants
      if (isDiag) {
        player.dir = vy > 0 ? 'fside' : 'bside';
      } else if (Math.abs(vy) > Math.abs(vx)) {
        player.dir = vy > 0 ? 'front' : 'back';
      } else {
        player.dir = 'side';
      }
      player.walkTimer = (player.walkTimer + 1) % 20;
      const step = player.walkTimer < 10 ? '' : '_step';
      const dirSuffix = (player.dir === 'side') ? '' : ('_' + player.dir);
      player.spr.setTexture(id + dirSuffix + step);
      // Flip for leftward movement on all side-facing variants
      if (player.dir === 'side' || player.dir === 'fside' || player.dir === 'bside') {
        player.spr.setFlipX(vx < 0);
      } else {
        player.spr.setFlipX(false);
      }
    } else {
      player.walkTimer = 0;
      const dirSuffix = (player.dir === 'side') ? '' : ('_' + player.dir);
      player.spr.setTexture(id + dirSuffix);
    }
  }

  aimAtMouse(player) {
    const cam = this.cameras.main;
    const pointer = this.input.activePointer;
    const worldX = pointer.x / cam.zoom + cam.worldView.x;
    const worldY = pointer.y / cam.zoom + cam.worldView.y;
    const angle = Phaser.Math.Angle.Between(player.spr.x, player.spr.y, worldX, worldY);
    // 8-directional facing from mouse angle (8 sectors of 45°)
    const PI8 = Math.PI / 8;  // 22.5°
    const a = angle;
    let flip = false;
    if (a > -PI8 && a <= PI8)          { player.dir = 'side';  flip = false; }  // E
    else if (a > PI8 && a <= 3*PI8)    { player.dir = 'fside'; flip = false; }  // SE
    else if (a > 3*PI8 && a <= 5*PI8)  { player.dir = 'front'; }                // S
    else if (a > 5*PI8 && a <= 7*PI8)  { player.dir = 'fside'; flip = true;  }  // SW
    else if (a > -3*PI8 && a <= -PI8)  { player.dir = 'bside'; flip = false; }  // NE
    else if (a > -5*PI8 && a <= -3*PI8){ player.dir = 'back';  }                // N
    else if (a > -7*PI8 && a <= -5*PI8){ player.dir = 'bside'; flip = true;  }  // NW
    else                               { player.dir = 'side';  flip = true;  }  // W
    player.spr.setFlipX(flip);
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
    // In 2P mode, derive aim angle from 8-directional facing
    const flip = player.spr.flipX;
    if (player.dir === 'front')      return Math.PI/2;
    if (player.dir === 'back')       return -Math.PI/2;
    if (player.dir === 'fside')      return flip ? 3*Math.PI/4  : Math.PI/4;
    if (player.dir === 'bside')      return flip ? -3*Math.PI/4 : -Math.PI/4;
    return flip ? Math.PI : 0; // side
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
      // Player bullets blocked by terrain and player-built structures
      if (this.obstacles) {
        this.physics.add.collider(blt, this.obstacles, () => { if (blt.active) blt.destroy(); });
      }
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
    this.kills++;
    SFX.enemyDie();
    e.spr.setTint(0xff2200);
    const ex = e.spr.x, ey = e.spr.y;
    this.time.delayedCall(200, () => {
      if (e.spr.active) e.spr.destroy();
      if (e.lbl && e.lbl.active) e.lbl.destroy();
    });
    // Raider kill — check if camp cleared
    if (e.isRaider) {
      this.raiders = this.raiders.filter(r => r !== e);
      if (this.raiders.length === 0 && this.raidCamp) {
        this.hint('Raider camp cleared! They\'ll return in 10 days…', 4000);
        this.raidRespawnDay = this.dayNum + 10;
        if (this.raidCamp.spr && this.raidCamp.spr.active) this.raidCamp.spr.setTint(0x555555);
      }
    }
    // Boss kill
    if (e.isBoss) {
      if (e.hpBg && e.hpBg.active) e.hpBg.destroy();
      if (e.hpBar && e.hpBar.active) e.hpBar.destroy();
      if (e.nameLabel && e.nameLabel.active) e.nameLabel.destroy();
      this.boss = null;
      this.bossDefeated = true;
      this.hint('BOSS DEFEATED! A rare material was left behind…', 5000);
      SFX._play(880, 'triangle', 0.3, 0.6, 'rise');
      SFX._play(1100, 'triangle', 0.25, 0.5, 'rise');
      this.cameras.main.shake(600, 0.018);
      this.dropResource(ex, ey, 'rare');
    }
    this.dropResource(ex, ey, e.type);
  }

  dropResource(x, y, enemyType) {
    const drops = [];
    // Rare boss drop — guaranteed crystal shard
    if (enemyType === 'rare') {
      drops.push('item_rare');
      drops.push('item_metal');
      drops.push('item_ammo');
    } else {
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
      } else if (enemyType === 'brawler' || enemyType === 'shooter' || enemyType === 'heavy') {
        // Raiders drop ammo and supplies
        if (Math.random() < 0.6) drops.push('item_ammo');
        if (Math.random() < 0.4) drops.push('item_metal');
        if (Math.random() < 0.3) drops.push('item_food');
      }
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
          this.resourcesGathered++;
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

    // Spawn structure guards — 2-4 enemies per biome structure (high danger zone)
    if (this._structureLocs) {
      const biomeGuardType = { grass:'wolf', tundra:'wolf', swamp:'rat', waste:'bear' };
      for (const loc of this._structureLocs) {
        const type = biomeGuardType[loc.biome] || 'wolf';
        const t = { wolf:{key:'wolf',hp:70,speed:95,dmg:10,baseScale:2.0,w:20,h:12},
                    rat: {key:'rat', hp:38,speed:145,dmg:7, baseScale:1.6,w:15,h:9 },
                    bear:{key:'bear',hp:160,speed:58,dmg:20,baseScale:2.4,w:24,h:18} }[type];
        const count = Phaser.Math.Between(2, 4);
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * Math.PI * 2;
          const dist = Phaser.Math.Between(30, 90);
          const ex = loc.x + Math.cos(ang) * dist;
          const ey = loc.y + Math.sin(ang) * dist;
          const sizeMult = Phaser.Math.FloatBetween(1.0, 1.5); // bigger = harder
          const sc = t.baseScale * sizeMult;
          const spr = this.physics.add.image(
            Phaser.Math.Clamp(ex, CFG.TILE*4, worldW - CFG.TILE*4),
            Phaser.Math.Clamp(ey, CFG.TILE*4, worldH - CFG.TILE*4), t.key
          ).setScale(sc).setDepth(8);
          spr.setCollideWorldBounds(true);
          spr.body.setSize(t.w, t.h);
          if (this.hudCam) this.hudCam.ignore(spr);
          this.physics.add.collider(spr, this.obstacles);
          const aggroR = { wolf:220, rat:140, bear:320 }[type] * 1.3; // very aggressive
          this.enemies.push({
            spr, type: t.key,
            hp: Math.floor(t.hp * sizeMult), maxHp: Math.floor(t.hp * sizeMult),
            speed: t.speed * sizeMult, dmg: Math.max(1, Math.floor(t.dmg * sizeMult)),
            attackTimer: 0, wanderTimer: 0,
            aggroRange: aggroR, attackRange: (30 + t.w / 2) * sizeMult,
            sizeMult, structureGuard: true,
          });
        }
      }
    }
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

  updateHarvest(delta) {
    if (!this.obstacles || !this.harvestGfx) return;
    this.harvestGfx.clear();

    const HARVEST_RANGE = 50; // px
    const HARVEST_TIMES = { architect: 1500, knight: 2500, gunslinger: 4000 };
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && !p.isSleeping && p.hp > 0);

    for (const player of players) {
      const keyHeld = player === this.p1
        ? this.hotkeys.p1use.isDown
        : (this.hotkeys.p2use ? this.hotkeys.p2use.isDown : false);

      // Find nearest tree within range
      let nearestTree = null, nearDist = Infinity;
      if (keyHeld && this.obstacles) {
        for (const obj of this.obstacles.getChildren()) {
          if (!obj.isTree || !obj.active) continue;
          const d = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, obj.x, obj.y);
          if (d < HARVEST_RANGE && d < nearDist) { nearDist = d; nearestTree = obj; }
        }
      }

      if (keyHeld && nearestTree) {
        // Don't harvest if barracks/menus open or another menu-blocking state active
        if (this.barrackOpen || this.isOver) { player.harvestProgress = 0; player.harvestTarget = null; continue; }
        if (player.harvestTarget !== nearestTree) {
          player.harvestProgress = 0;
          player.harvestTarget = nearestTree;
        }
        const harvestTime = HARVEST_TIMES[player.charData.id] || 2500;
        player.harvestProgress = (player.harvestProgress || 0) + delta / harvestTime;

        // Draw progress arc above the tree
        const tx = nearestTree.x, ty = nearestTree.y - 28;
        const r = 10;
        this.harvestGfx.lineStyle(3, 0x88cc44, 0.9);
        this.harvestGfx.beginPath();
        this.harvestGfx.arc(tx, ty, r, -Math.PI / 2, -Math.PI / 2 + player.harvestProgress * Math.PI * 2, false);
        this.harvestGfx.strokePath();
        // Background ring
        this.harvestGfx.lineStyle(2, 0x224411, 0.5);
        this.harvestGfx.strokeCircle(tx, ty, r);

        if (player.harvestProgress >= 1) {
          // Harvest complete — spawn 2-3 wood items, destroy tree
          const woodCount = Phaser.Math.Between(2, 3);
          for (let i = 0; i < woodCount; i++) {
            const dx = nearestTree.x + Phaser.Math.Between(-12, 12);
            const item = this.physics.add.image(dx, nearestTree.y, 'item_wood').setScale(2).setDepth(7);
            item.body.allowGravity = false;
            item.body.setImmovable(true);
            if (this.hudCam) this.hudCam.ignore(item);
            item.itemType = 'wood';
            const pickupCb = (p) => {
              if (!item.active) return;
              p.inv.wood = (p.inv.wood || 0) + 1;
              this.resourcesGathered++;
              SFX._play(600, 'triangle', 0.06, 0.2);
              item.destroy();
            };
            this.physics.add.overlap(this.p1.spr, item, () => pickupCb(this.p1));
            if (this.p2) this.physics.add.overlap(this.p2.spr, item, () => pickupCb(this.p2));
            this.time.delayedCall(20000, () => { if (item.active) item.destroy(); });
          }
          SFX._play(220, 'sawtooth', 0.15, 0.3, 'drop');
          this.obstacles.remove(nearestTree, true, true);
          player.harvestProgress = 0;
          player.harvestTarget = null;
        }
      } else {
        // Key released or no tree in range — reset progress
        player.harvestProgress = 0;
        player.harvestTarget = null;
      }
    }
  }

  // ── Structure damage ─────────────────────────────────────────
  // Subtract dmg from a player-built wall/gate. Updates tint to reflect health.
  // Destroys the wall with a fade when hp reaches 0.
  damageStructure(wall, dmg) {
    if (!wall.active) return;
    wall.hp = Math.max(0, (wall.hp || 200) - dmg);
    const pct = wall.hp / (wall.maxHp || 200);
    if (wall.hp <= 0) {
      this.builtWalls = this.builtWalls.filter(w => w !== wall);
      this.tweens.add({ targets: wall, alpha: 0, duration: 200, onComplete: () => { if (wall.active) wall.destroy(); } });
      this.hint('Structure destroyed!', 1500);
    } else if (pct < 0.25) {
      wall.setTint(0xff2200); // nearly gone — red
    } else if (pct < 0.5) {
      wall.setTint(0xff8800); // damaged — orange
    } else {
      wall.clearTint();
    }
  }

  // Find the nearest player-built wall that sits between (ex,ey) and (px,py)
  // and is within 80px of the enemy. Returns the wall, or null.
  _findWallOnPath(ex, ey, px, py) {
    if (!this.builtWalls || this.builtWalls.length === 0) return null;
    const playerAngDeg = Phaser.Math.RadToDeg(Phaser.Math.Angle.Between(ex, ey, px, py));
    let best = null, bestDist = Infinity;
    for (const w of this.builtWalls) {
      if (!w.active) continue;
      const wd = Phaser.Math.Distance.Between(ex, ey, w.x, w.y);
      if (wd > 80) continue;
      const wallAngDeg = Phaser.Math.RadToDeg(Phaser.Math.Angle.Between(ex, ey, w.x, w.y));
      const diff = Math.abs(Phaser.Math.Angle.ShortestBetween(wallAngDeg, playerAngDeg));
      if (diff < 70 && wd < bestDist) { best = w; bestDist = wd; }
    }
    return best;
  }

  // ── Enemy LOS helpers ────────────────────────────────────────
  // Returns true if the straight line from (x1,y1) to (x2,y2) is NOT blocked
  // by any mountain tile or player-built wall.  Fast: uses pre-built tile Set.
  _hasLOS(x1, y1, x2, y2) {
    if (!this._solidTileSet) return true;
    const T = CFG.TILE;
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    if (dist < 24) return true;
    const steps = Math.ceil(dist / 28); // sample every ~28 px
    const dx = (x2 - x1) / steps, dy = (y2 - y1) / steps;
    for (let i = 1; i < steps; i++) {
      const sx = x1 + dx * i, sy = y1 + dy * i;
      const tx = Math.round(sx / T), ty = Math.round(sy / T);
      if (this._solidTileSet.has(tx + ',' + ty)) return false;
      // Also check player-built walls
      if (this.builtWalls) {
        for (const w of this.builtWalls) {
          if (w.active && Math.abs(sx - w.x) < 20 && Math.abs(sy - w.y) < 20) return false;
        }
      }
    }
    return true;
  }

  // Navigate enemy toward (targetX, targetY) at speed spd, steering around mountains
  // and walls.  Tries the direct heading first, then progressively wider offsets.
  _steerToward(e, targetX, targetY, spd) {
    if (!this._solidTileSet) {
      const ang = Phaser.Math.Angle.Between(e.spr.x, e.spr.y, targetX, targetY);
      return { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
    }
    const T = CFG.TILE;
    const baseAng = Phaser.Math.Angle.Between(e.spr.x, e.spr.y, targetX, targetY);
    const PROBE = 48;
    const isHeadingClear = (ang) => {
      const px = e.spr.x + Math.cos(ang) * PROBE;
      const py = e.spr.y + Math.sin(ang) * PROBE;
      const tx = Math.round(px / T), ty = Math.round(py / T);
      if (this._solidTileSet.has(tx + ',' + ty)) return false;
      if (this.builtWalls) {
        for (const w of this.builtWalls) {
          if (w.active && Math.abs(px - w.x) < 24 && Math.abs(py - w.y) < 24) return false;
        }
      }
      return true;
    };
    // Try direct angle, then ±37°, ±75°, ±112° until a clear heading is found
    for (const off of [0, 0.65, -0.65, 1.3, -1.3, 1.95, -1.95]) {
      const ang = baseAng + off;
      if (isHeadingClear(ang)) return { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
    }
    return { x: 0, y: 0 };
  }

  updateEnemies(delta) {
    if (!this.enemies || this.isOver) return;
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && p.hp > 0 && p.spr.visible);

    this.enemies.forEach(e => {
      if (e.hp <= 0 || !e.spr.active) return;
      if (e.isBoss) return; // boss movement/attack handled by updateBoss
      let nearest = null, nearDist = Infinity;
      players.forEach(p => {
        const d = Phaser.Math.Distance.Between(e.spr.x, e.spr.y, p.spr.x, p.spr.y);
        if (d < nearDist) { nearDist = d; nearest = p; }
      });
      if (!nearest) { e.spr.setVelocity(0,0); return; }
      const nightMult = (this.isNight) ? 1.35 : 1;
      const aggroRange = e.aggroRange * nightMult;

      if (nearDist < aggroRange) {
        const spd = e.speed * nightMult;

        // LOS check — can the enemy see the player through mountains/walls?
        const canSee = this._hasLOS(e.spr.x, e.spr.y, nearest.spr.x, nearest.spr.y);
        if (canSee) {
          // Clear sightline — remember where the player was
          e.lastKnownX = nearest.spr.x;
          e.lastKnownY = nearest.spr.y;
        }

        // When LOS is blocked, check if a player-built wall is the obstacle — attack it if so
        let attackingWall = false;
        if (!canSee && this.builtWalls && this.builtWalls.length > 0) {
          const blockingWall = this._findWallOnPath(e.spr.x, e.spr.y, nearest.spr.x, nearest.spr.y);
          if (blockingWall) {
            const wallDist = Phaser.Math.Distance.Between(e.spr.x, e.spr.y, blockingWall.x, blockingWall.y);
            if (wallDist < 58) {
              // Count walls clustered near the blocker — 3+ nearby = enclosed space → always attack
              const clusterCount = this.builtWalls.filter(w => w.active &&
                Phaser.Math.Distance.Between(w.x, w.y, blockingWall.x, blockingWall.y) < 130).length;
              if (clusterCount >= 3) {
                attackingWall = true; // enclosure — break through
              } else {
                // Single stray wall: 35% chance, re-evaluated every 3 seconds
                e._wallDecideTimer = (e._wallDecideTimer || 0) - delta;
                if (e._wallDecideTimer <= 0) {
                  e._wallDecide = Math.random() < 0.35;
                  e._wallDecideTimer = 3000;
                }
                attackingWall = !!e._wallDecide;
              }
            }
            if (attackingWall) {
              e.wallAttackTimer = (e.wallAttackTimer || 0) - delta;
              if (e.wallAttackTimer <= 0) {
                this.damageStructure(blockingWall, e.dmg * 0.7);
                e.wallAttackTimer = 1400;
              }
              e.spr.setVelocity(0, 0);
              e.spr.setFlipX(blockingWall.x < e.spr.x);
            }
          }
        }

        if (!attackingWall) {
          // Chase toward player if visible, or toward last known position if blocked
          const chaseX = e.lastKnownX !== undefined ? e.lastKnownX : nearest.spr.x;
          const chaseY = e.lastKnownY !== undefined ? e.lastKnownY : nearest.spr.y;
          // Steer around obstacles instead of running straight into them
          const vel = this._steerToward(e, chaseX, chaseY, spd);
          e.spr.setVelocity(vel.x, vel.y);
          e.spr.setFlipX(chaseX < e.spr.x);
        }

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
      // Raider respawn check
      if (this.raidRespawnDay !== null && this.dayNum >= this.raidRespawnDay) {
        this.raidRespawnDay = null;
        this.time.delayedCall(3000, () => {
          if (!this.isOver) {
            this.hint('\u26a0 Raiders have returned to their camp!', 5000);
            SFX._play(180, 'sawtooth', 0.4, 0.5, 'drop');
            if (this.raidCamp) this.spawnRaiders(this.raidCamp.x, this.raidCamp.y);
          }
        });
      }
      // Boss daily check: after day 5, 25% chance each dawn
      if (!this.bossSpawned && this.dayNum > 5 && Math.random() < 0.25) {
        this.time.delayedCall(5000, () => {
          if (!this.isOver && !this.bossSpawned) this.spawnBoss();
        });
      }
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
          this.resourcesGathered += 2;
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
                   : p.dir === 'fside'  ? (p.spr.flipX ? 3*Math.PI/4 : Math.PI/4)
                   : p.dir === 'bside'  ? (p.spr.flipX ? -3*Math.PI/4 : -Math.PI/4)
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
      w.hp = 200; w.maxHp = 200; // destructible
      this.builtWalls.push(w);
      if (this.hudCam) this.hudCam.ignore(w);
    } else if (this.buildType === 'gate') {
      const gate = this.physics.add.image(x, y, 'wall').setDepth(5).setTint(0x88aaff);
      gate.setAngle(this.buildRotation * 90);
      gate.body.setImmovable(true);
      gate.body.allowGravity = false;
      gate.isGate = true; gate.gateOpen = false;
      gate.hp = 200; gate.maxHp = 200; // destructible
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
    this.reason        = data.reason        || 'You have fallen.';
    this.timeAlive     = data.timeAlive     || 0;
    this.mode          = data.mode          || 1;
    this.difficulty    = data.difficulty    || 'survival';
    this.kills         = data.kills         || 0;
    this.days          = data.days          || 1;
    this.resources     = data.resources     || 0;
    this.bossDefeated  = data.bossDefeated  || false;
    this.p1Name        = data.p1Name        || 'P1';
    this.p2Name        = data.p2Name        || null;
  }

  _calcScore() {
    let s = 0;
    s += this.days * 100;
    s += this.kills * 25;
    s += this.resources * 5;
    s += Math.floor(this.timeAlive) * 2;
    if (this.bossDefeated) s += 500;
    if (this.difficulty === 'hardcore') s = Math.floor(s * 1.5);
    return s;
  }

  create() {
    const { W, H } = CFG;
    this.cameras.main.fadeIn(600, 0, 0, 0);
    const score = this._calcScore();

    // Background
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1a0000, 0x1a0000, 0x000000, 0x000000, 1);
    bg.fillRect(0, 0, W, H);

    this.add.text(W/2, 46, 'GAME OVER', {
      fontFamily:'monospace', fontSize:'64px', color:'#cc2222',
      stroke:'#440000', strokeThickness:8,
    }).setOrigin(0.5);

    this.add.text(W/2, 116, this.reason, {
      fontFamily:'monospace', fontSize:'18px', color:'#cc8855', stroke:'#000', strokeThickness:3,
    }).setOrigin(0.5);

    // ── Score breakdown panel ──────────────────────────────
    const panelX = W/2 - 220, panelY = 148, panelW = 440, panelH = 210;
    const panel = this.add.graphics();
    panel.fillStyle(0x110000, 0.85); panel.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    panel.lineStyle(1, 0x553333, 0.8); panel.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);

    const mins = Math.floor(this.timeAlive / 60), secs = Math.floor(this.timeAlive % 60);
    const timeStr = mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
    const names = this.p2Name ? this.p1Name + ' & ' + this.p2Name : this.p1Name;
    const modeLabel = (this.mode===1?'1P':'2P') + ' ' + (this.difficulty==='hardcore'?'HARDCORE':'SURVIVAL');

    const rows = [
      ['Survivors',       names,                          '#aabbcc'],
      ['Mode',            modeLabel,                      '#8899aa'],
      ['Days survived',   'Day ' + this.days,             '#ffee44'],
      ['Time alive',      timeStr,                        '#cccccc'],
      ['Enemies killed',  this.kills + ' kills',          '#ff8844'],
      ['Resources found', this.resources + ' items',      '#88cc66'],
      ['Boss defeated',   this.bossDefeated ? 'YES +500':'No',  this.bossDefeated?'#ffdd44':'#556666'],
    ];
    rows.forEach(([label, val, col], i) => {
      const y = panelY + 18 + i * 26;
      this.add.text(panelX + 18, y, label, { fontFamily:'monospace', fontSize:'13px', color:'#556677' }).setOrigin(0,0);
      this.add.text(panelX + panelW - 18, y, val, { fontFamily:'monospace', fontSize:'13px', color: col }).setOrigin(1,0);
    });

    // Total score
    this.add.text(W/2, panelY + panelH + 18, 'SCORE   ' + score.toLocaleString(), {
      fontFamily:'monospace', fontSize:'32px', color:'#ffdd44',
      stroke:'#000', strokeThickness:4,
    }).setOrigin(0.5);

    // ── Local leaderboard ──────────────────────────────────
    const lb = this._loadLeaderboard();
    const isHighScore = lb.length < 5 || score > lb[lb.length-1].score;

    if (isHighScore) {
      this._saveScore(lb, score);
      this.add.text(W/2, panelY + panelH + 62, '★  NEW HIGH SCORE  ★', {
        fontFamily:'monospace', fontSize:'16px', color:'#ffcc22',
      }).setOrigin(0.5);
    }

    // Top 5 board
    const lbX = W/2 + 10, lbY = panelY + panelH + 86;
    this.add.text(lbX - 200, lbY - 2, 'TOP SCORES', { fontFamily:'monospace', fontSize:'11px', color:'#445566' });
    this._loadLeaderboard().slice(0,5).forEach((entry, i) => {
      const col = i === 0 ? '#ffdd44' : '#778899';
      const txt = (i+1) + '.  ' + entry.name.padEnd(14) + entry.score.toLocaleString() + '  Day ' + entry.days;
      this.add.text(lbX - 200, lbY + 16 + i*18, txt, { fontFamily:'monospace', fontSize:'11px', color:col });
    });

    // ── Navigation buttons — tappable for touch, keyboard shortcuts too ──
    const makeBtn = (x, label, sublabel, col, borderCol, action) => {
      const g = this.add.graphics();
      g.fillStyle(0x110000, 0.9); g.fillRoundedRect(x - 140, H - 84, 280, 64, 10);
      g.lineStyle(2, borderCol, 0.9); g.strokeRoundedRect(x - 140, H - 84, 280, 64, 10);
      const t = this.add.text(x, H - 63, label, {
        fontFamily:'monospace', fontSize:'20px', color: col, stroke:'#000', strokeThickness:3,
      }).setOrigin(0.5);
      this.add.text(x, H - 37, sublabel, {
        fontFamily:'monospace', fontSize:'10px', color:'#445566',
      }).setOrigin(0.5);
      const zone = this.add.zone(x, H - 52, 280, 64).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => { t.setColor('#ffffff'); g.clear(); g.fillStyle(borderCol, 0.25); g.fillRoundedRect(x-140, H-84, 280, 64, 10); g.lineStyle(2, borderCol, 1); g.strokeRoundedRect(x-140, H-84, 280, 64, 10); });
      zone.on('pointerout',  () => { t.setColor(col); g.clear(); g.fillStyle(0x110000, 0.9); g.fillRoundedRect(x-140, H-84, 280, 64, 10); g.lineStyle(2, borderCol, 0.9); g.strokeRoundedRect(x-140, H-84, 280, 64, 10); });
      zone.on('pointerdown', action);
      this.tweens.add({ targets: t, alpha: 0.45, duration: 700, yoyo: true, repeat: -1 });
      return zone;
    };

    makeBtn(W/2 - 165, '\u25b6  PLAY AGAIN', 'ENTER  /  SPACE', '#aaffaa', 0x44aa44, () => this.restart());
    makeBtn(W/2 + 165, '\u2302  MAIN MENU',  'ESC', '#aaccff', 0x4466aa, () => this.goMenu());

    const K = Phaser.Input.Keyboard.KeyCodes;
    const keys = this.input.keyboard.addKeys({ enter:K.ENTER, space:K.SPACE, esc:K.ESC });
    keys.enter.on('down', () => this.restart());
    keys.space.on('down', () => this.restart());
    keys.esc.on('down',   () => this.goMenu());
  }

  _loadLeaderboard() {
    try {
      return JSON.parse(localStorage.getItem('iw_scores') || '[]');
    } catch(e) { return []; }
  }

  _saveScore(lb, score) {
    const names = this.p2Name ? this.p1Name + '/' + this.p2Name : this.p1Name;
    lb.push({ name: names, score, days: this.days, time: Math.floor(this.timeAlive) });
    lb.sort((a,b) => b.score - a.score);
    lb.splice(10); // keep top 10
    try { localStorage.setItem('iw_scores', JSON.stringify(lb)); } catch(e) {}
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
const _phaserGame = new Phaser.Game({
  type: Phaser.AUTO,
  width: CFG.W, height: CFG.H,
  backgroundColor: '#0a0a0a',
  pixelArt: true,
  physics: { default:'arcade', arcade:{ gravity:{y:0}, debug:false } },
  // Mount into our CSS-centered container.  NO_CENTER tells Phaser not to
  // fight the flex layout by setting its own margin offsets on the canvas.
  parent: 'game-container',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
  scene: [BootScene, ModeSelectScene, SettingsScene, CharSelectScene, GameScene, GameOverScene],
});
// iOS PWA standalone mode: viewport layout may settle slightly after JS starts.
// A deferred refresh ensures the canvas fills the container correctly.
setTimeout(() => _phaserGame.scale.refresh(), 150);
window.addEventListener('resize', () => _phaserGame.scale.refresh());
