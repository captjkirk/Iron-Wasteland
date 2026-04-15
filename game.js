// ============================================================
// IRON WASTELAND  |  Local Co-op Survival
// Made for Hudson, Zachary & Jared
// ============================================================
'use strict';

// ── VERSION ───────────────────────────────────────────────────
// Update this each commit so the title screen reflects the build date.
const VERSION = 'Apr 15, 2026  06:40 AM EDT';

// ── CONSTANTS ─────────────────────────────────────────────────
// Detect mobile/phone: touch device with a small screen.
// We halve the canvas resolution on phones so that sprites and HUD
// appear at their designed sizes rather than being CSS-shrunk to ~50%.
const _isMobile = typeof navigator !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) &&
  typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600;

const CFG = {
  W: _isMobile ? 640 : 1280, H: _isMobile ? 360 : 720,
  TILE: 32,
  MAP_W: 300, MAP_H: 300,
  SAFE_R: 10,
  CAM_ZOOM_MAX: 1.0,
  CAM_ZOOM_MIN: _isMobile ? 0.15 : 0.25, // mobile: show more world at min zoom
  CAM_PAD: _isMobile ? 115 : 230,        // mobile: tighter 2-player framing
  TREES: 400,
  ROCKS: 280,
  DOWN_TIME: 20,     // seconds before a downed player dies permanently
  REVIVE_TIME: 3,    // seconds to hold interact to revive
  REVIVE_RANGE: 80,  // px to be close enough to revive
  FOG_REVEAL_R: 6,   // tiles radius for fog reveal
  FOG_UPDATE_INTERVAL: 4, // update fog every N frames
  DORMANT_RADIUS: 800, // px — wildlife enemy goes dormant beyond this from all players
  WAKE_RADIUS:    700, // px — hysteresis: dormant enemy wakes when closer than this
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

// Biome seeds set at scene init — Voronoi regions produce a unique map each session
let _biomeSeeds = [];

function getBiome(tileX, tileY) {
  const cx = CFG.MAP_W / 2, cy = CFG.MAP_H / 2;
  const dist = Math.sqrt((tileX - cx) ** 2 + (tileY - cy) ** 2);
  if (dist < CFG.SAFE_R + 15) return 'grass';
  if (_biomeSeeds.length === 0) return 'waste'; // fallback before init

  // Domain warp: nudge coordinates with low-freq noise for organic borders
  const warpX = _biomeNoise(tileX * 0.8, tileY * 0.8, 7) * 18;
  const warpY = _biomeNoise(tileX * 0.8 + 50, tileY * 0.8 + 50, 7) * 18;
  const wtx = tileX + warpX, wty = tileY + warpY;

  // Nearest Voronoi seed wins
  let nearest = null, nearestDist = Infinity;
  for (const seed of _biomeSeeds) {
    const d = (wtx - seed.tx) ** 2 + (wty - seed.ty) ** 2;
    if (d < nearestDist) { nearestDist = d; nearest = seed; }
  }
  return nearest ? nearest.biome : 'waste';
}

// Biome color map for minimap
const BIOME_COLORS = {
  grass:  0x4a7c2f,
  waste:  0x8a7044,
  swamp:  0x2a4a2a,
  tundra: 0xbbccdd,
  ruins:  0x444450,
  fungal: 0x4a1a5a,
  desert: 0xc8a060,
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
    if (this.mode === 'night' || this.mode === 'boss') return;
    this._preBossMode = null;
    this.mode = 'night';
    // The current loop will naturally end and _nightLoop will take over
  },
  switchToDay() {
    if (this.mode === 'day' || this.mode === 'boss') return;
    this._preBossMode = null;
    this.mode = 'day';
    this._dawnJingle();
  },
  switchToBoss() {
    if (this.mode === 'boss') return;
    this._preBossMode = this.mode; // remember day/night so we can restore it
    this.mode = 'boss';
    this._bossLoop(this.ctx ? this.ctx.currentTime + 0.15 : 0);
  },
  switchFromBoss() {
    if (this.mode !== 'boss') return;
    this.mode = this._preBossMode || 'day';
    this._preBossMode = null;
    if (this.mode === 'night') this._nightLoop(this.ctx ? this.ctx.currentTime + 0.1 : 0);
    else { this._dawnJingle(); this._dayLoop(this.ctx ? this.ctx.currentTime + 2 : 0); }
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

  // ── BOSS BATTLE LOOP ─────────────────────────────────────────
  // Intense, driving 130 BPM loop — heroic tension, not pure horror.
  _bossLoop(startAt) {
    if (!this.playing || !this.ctx) return;
    if (this.mode !== 'boss') {
      if (this.mode === 'night') this._nightLoop(this.ctx.currentTime);
      else this._dayLoop(this.ctx.currentTime);
      return;
    }
    const b = 60 / 130; // 130 BPM
    const len = b * 16;  // 4 bars
    const now = this.ctx.currentTime;
    if (startAt + len < now) {
      const skips = Math.ceil((now - startAt) / len);
      startAt += skips * len;
    }
    const o = startAt - now;

    // Driving bass line — low E minor root motion
    [[82.41,0],[82.41,b*2],[98,b*4],[82.41,b*6],
     [92.5,b*8],[82.41,b*10],[73.42,b*12],[82.41,b*14],
    ].forEach(([f,t]) => { if (o+t > -0.05) this._note(f, o+t, b*1.8, 'sawtooth', 0.5); });

    // Heroic melody stabs — E minor / G major intervals, driving eighth notes
    [[329.63,0,b*.6],[392,b,b*.5],[440,b*2,b*.6],[392,b*3,b*.5],
     [329.63,b*4,b*.6],[311.13,b*5,b*.5],[349.23,b*6,b*.6],[392,b*7,b*.5],
     [329.63,b*8,b*.6],[440,b*9,b*.5],[392,b*10,b*.6],[349.23,b*11,b*.5],
     [329.63,b*12,b*.8],[293.66,b*13,b*.5],[311.13,b*14,b*.6],[349.23,b*15,b*.8],
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'square', 0.3); });

    // Power chord stabs on every beat (two-note parallel fifths)
    [0, b*2, b*4, b*6, b*8, b*10, b*12, b*14].forEach(t => {
      if (o+t > -0.05) {
        this._note(196, o+t, b*0.4, 'sawtooth', 0.22);
        this._note(293.66, o+t, b*0.4, 'sawtooth', 0.18);
      }
    });

    // Snare-like noise bursts on beats 2 and 4
    [b*2, b*6, b*10, b*14].forEach(t => {
      if (o+t > -0.05) this._noise(0.06, 0.45);
    });

    // Sustained pad swells (triangle, lower octave for warmth)
    [[98,0,b*4,0.15],[110,b*4,b*4,0.15],[98,b*8,b*4,0.15],[87.31,b*12,b*4,0.18],
    ].forEach(([f,t,d,v]) => { if (o+t > -0.05) this._note(f, o+t, d, 'triangle', v); });

    const nextStart = startAt + len;
    const delay = Math.max(50, (nextStart - 0.5 - this.ctx.currentTime) * 1000);
    setTimeout(() => this._bossLoop(nextStart), delay);
  },
};

const SFX = {
  _enabled: true,
  _play(freq, type, dur, vol, shape) {
    if (!this._enabled) return;
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
    if (!this._enabled) return;
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
  bossRoar() {
    // Deep, rumbling roar — overlapping sawtooth drones that drop in pitch
    this._play(55,  'sawtooth', 2.0, 0.7, 'drop');
    this._play(73.4,'sawtooth', 1.5, 0.5, 'drop');
    this._play(41.2,'sawtooth', 2.5, 0.4, 'drop');
    this._noise(0.6, 0.3);
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

function drawIceCrawler(g) {
  g.clear();
  g.fillStyle(0x6699bb); g.fillRect(2, 3, 14, 6);          // body
  g.fillStyle(0x88bbdd); g.fillRect(3, 4, 12, 4);           // highlight
  g.fillStyle(0x4477aa); g.fillRect(2, 3, 2, 2); g.fillRect(14, 3, 2, 2); // head/tail caps
  // Six legs — 3 per side
  g.fillStyle(0x335577);
  g.fillRect(4, 8, 1, 3); g.fillRect(7, 9, 1, 3); g.fillRect(10, 8, 1, 3);
  g.fillRect(4, 1, 1, 3); g.fillRect(7, 0, 1, 3); g.fillRect(10, 1, 1, 3);
  g.fillStyle(0xcceeff); g.fillRect(8, 5, 2, 1); // icy eye glint
  g.generateTexture('ice_crawler', 18, 12);
}

function drawSpiderRuins(g) {
  g.clear();
  g.fillStyle(0x3a1a4a); g.fillCircle(8, 6, 5);             // body
  g.fillStyle(0x5a2a6a); g.fillCircle(8, 4, 3);             // head
  g.fillStyle(0xcc44ff); g.fillRect(6, 3, 1, 1); g.fillRect(9, 3, 1, 1); // eyes
  // 4 legs per side
  g.fillStyle(0x2a0e38);
  g.fillRect(0, 4, 4, 1); g.fillRect(1, 6, 4, 1); g.fillRect(0, 8, 4, 1); g.fillRect(1, 9, 3, 1);
  g.fillRect(12, 4, 4, 1); g.fillRect(11, 6, 4, 1); g.fillRect(12, 8, 4, 1); g.fillRect(12, 9, 3, 1);
  g.generateTexture('spider_ruins', 16, 12);
}

function drawBogLurker(g) {
  g.clear();
  g.fillStyle(0x1a3a1a); g.fillEllipse(10, 8, 18, 10);      // body
  g.fillStyle(0x2a5a2a); g.fillEllipse(10, 7, 14, 7);       // highlight
  g.fillStyle(0x0a1e0a); g.fillRect(4, 10, 12, 4);          // bottom shadow
  g.fillStyle(0x44aa44); g.fillRect(8, 5, 2, 2); g.fillRect(11, 6, 1, 1); // eyes
  g.fillStyle(0x3a7a3a); g.fillRect(3, 8, 2, 2); g.fillRect(15, 9, 2, 2); // slime bumps
  g.generateTexture('bog_lurker', 20, 14);
}

function drawDustHound(g) {
  g.clear();
  g.fillStyle(0xaa7733); g.fillRect(3, 4, 11, 6);           // body
  g.fillStyle(0xcc9944); g.fillRect(4, 5, 9, 4);            // highlight
  g.fillStyle(0x997722); g.fillRect(13, 3, 4, 5);           // head
  g.fillStyle(0x553311); g.fillRect(15, 4, 2, 1);           // snout
  g.fillStyle(0x111111); g.fillRect(14, 3, 1, 1);           // eye
  g.fillStyle(0x886622);
  g.fillRect(5, 9, 2, 3); g.fillRect(9, 9, 2, 3);          // back legs
  g.fillRect(4, 5, 2, 3); g.fillRect(1, 5, 2, 2);          // front legs
  g.fillStyle(0xaa7733); g.fillRect(0, 3, 3, 2);            // tail
  g.generateTexture('dust_hound', 18, 12);
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

// ── SCALE PROXY ───────────────────────────────────────────────
// Wraps a Phaser Graphics object so all coordinates are multiplied by s.
// Used to generate high-res character sprites without rewriting every draw fn.
function makeScaleProxy(g, s) {
  return {
    clear:            ()                   => g.clear(),
    fillStyle:        (c, a)               => g.fillStyle(c, a),
    lineStyle:        (w, c, a)            => g.lineStyle(w * s, c, a),
    fillRect:         (x,y,w,h)            => g.fillRect(x*s,y*s,w*s,h*s),
    fillRoundedRect:  (x,y,w,h,r)         => g.fillRoundedRect(x*s,y*s,w*s,h*s,r*s),
    fillCircle:       (x,y,r)             => g.fillCircle(x*s,y*s,r*s),
    fillEllipse:      (x,y,w,h,sm)        => g.fillEllipse(x*s,y*s,w*s,h*s,sm),
    fillTriangle:     (x1,y1,x2,y2,x3,y3)=> g.fillTriangle(x1*s,y1*s,x2*s,y2*s,x3*s,y3*s),
    fillPoints:       (pts,cl)             => g.fillPoints(pts.map(p=>({x:p.x*s,y:p.y*s})),cl),
    strokeRect:       (x,y,w,h)           => g.strokeRect(x*s,y*s,w*s,h*s),
    strokeCircle:     (x,y,r)             => g.strokeCircle(x*s,y*s,r*s),
    lineBetween:      (x1,y1,x2,y2)       => g.lineBetween(x1*s,y1*s,x2*s,y2*s),
    generateTexture:  (key,w,h)           => g.generateTexture(key,w*s,h*s),
  };
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

  // Tall grass — grassland biome (bright green blades)
  g.clear();
  g.fillStyle(0x3a6820); g.fillRect(6, 10, 3, 14); g.fillRect(11, 8, 3, 16); g.fillRect(16, 11, 2, 13); g.fillRect(21, 9, 3, 15);
  g.fillStyle(0x4e8a2a); g.fillRect(7, 6, 2, 8); g.fillRect(12, 4, 2, 9); g.fillRect(17, 7, 2, 7); g.fillRect(22, 5, 2, 8);
  g.fillStyle(0x62aa36); g.fillRect(7, 3, 1, 5); g.fillRect(12, 1, 2, 5); g.fillRect(17, 4, 1, 5); g.fillRect(22, 2, 1, 5);
  g.generateTexture('tall_grass', 32, 24);

  // Tall grass — wasteland (dry yellow-brown stalks)
  g.clear();
  g.fillStyle(0x6a5020); g.fillRect(5, 12, 3, 12); g.fillRect(11, 10, 2, 14); g.fillRect(16, 13, 3, 11); g.fillRect(22, 11, 2, 13);
  g.fillStyle(0x8a6e30); g.fillRect(5, 7, 2, 7); g.fillRect(11, 6, 2, 6); g.fillRect(16, 8, 2, 7); g.fillRect(22, 7, 2, 6);
  g.fillStyle(0xaa8c44); g.fillRect(5, 4, 2, 4); g.fillRect(11, 3, 2, 4); g.fillRect(16, 5, 2, 4); g.fillRect(22, 4, 1, 4);
  g.generateTexture('tall_grass_waste', 32, 24);

  // Tall grass — tundra (pale blue-white frost grass)
  g.clear();
  g.fillStyle(0x8899aa); g.fillRect(6, 12, 3, 12); g.fillRect(12, 10, 2, 14); g.fillRect(17, 13, 3, 11); g.fillRect(23, 11, 2, 13);
  g.fillStyle(0xaabbcc); g.fillRect(6, 7, 2, 7); g.fillRect(12, 6, 2, 6); g.fillRect(17, 8, 2, 7); g.fillRect(23, 7, 2, 6);
  g.fillStyle(0xddeeff); g.fillRect(6, 4, 2, 4); g.fillRect(12, 3, 2, 4); g.fillRect(17, 5, 2, 4); g.fillRect(23, 4, 1, 4);
  g.generateTexture('tall_grass_tundra', 32, 24);

  // Tall grass — swamp (dark murky reeds)
  g.clear();
  g.fillStyle(0x2a4a1a); g.fillRect(5, 8, 3, 16); g.fillRect(11, 6, 2, 18); g.fillRect(17, 9, 3, 15); g.fillRect(23, 7, 2, 17);
  g.fillStyle(0x3a6628); g.fillRect(5, 4, 2, 6); g.fillRect(11, 2, 2, 6); g.fillRect(17, 5, 2, 6); g.fillRect(23, 3, 2, 6);
  g.fillStyle(0x1a3010); g.fillRect(4, 12, 2, 4); g.fillRect(10, 14, 2, 4); g.fillRect(16, 11, 2, 4); g.fillRect(22, 13, 2, 4);
  g.generateTexture('tall_grass_swamp', 32, 24);

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

  // Desert rock — sandstone orange-red (22×16)
  g.clear();
  g.fillStyle(0xcc7744);
  g.fillPoints([{x:2,y:15},{x:0,y:9},{x:3,y:3},{x:9,y:1},{x:15,y:1},{x:20,y:4},{x:22,y:10},{x:18,y:15}], true);
  g.fillStyle(0xdd9966);
  g.fillPoints([{x:3,y:13},{x:1,y:8},{x:4,y:3},{x:9,y:2},{x:14,y:2},{x:17,y:6},{x:18,y:11},{x:15,y:13}], true);
  g.fillStyle(0xeebb88); g.fillRect(6, 4, 2, 2); g.fillRect(12, 6, 1, 1);
  g.generateTexture('rock_desert', 22, 16);

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

  // Characters — all directions & walk frames (drawn at native 44×60 for full pixel precision)
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
  // Enemy raider directional sprites
  drawRaiderDirectionals(g);

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

  // Fire glow (radial warm gradient, used for pulsating campfire/campsite glow)
  g.clear();
  g.fillStyle(0xff7711, 0.12); g.fillCircle(64, 64, 64);
  g.fillStyle(0xff8822, 0.14); g.fillCircle(64, 64, 50);
  g.fillStyle(0xffaa33, 0.16); g.fillCircle(64, 64, 36);
  g.fillStyle(0xffcc55, 0.18); g.fillCircle(64, 64, 22);
  g.fillStyle(0xffee88, 0.20); g.fillCircle(64, 64, 10);
  g.generateTexture('fire_glow', 128, 128);

  // Torch — wall sconce (bracket + cup + flame, top-down isometric style)
  g.clear();
  // Wall mounting plate
  g.fillStyle(0x3a2a1a); g.fillRect(3, 13, 5, 5);
  // Stem / handle
  g.fillStyle(0x7a5a2a); g.fillRect(4, 7, 3, 7);
  // Cup / holder
  g.fillStyle(0xa07838); g.fillRect(2, 5, 7, 3);
  g.fillStyle(0x7a5a2a); g.fillRect(1, 7, 9, 1); // rim shadow
  // Flame
  g.fillStyle(0xff6600); g.fillEllipse(5, 3, 6, 7);
  g.fillStyle(0xffaa00); g.fillEllipse(5, 2, 4, 5);
  g.fillStyle(0xffee44); g.fillEllipse(5, 1, 2, 3);
  g.generateTexture('torch', 10, 18);

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

  // Spike trap — wooden board with metal spikes
  g.clear();
  g.fillStyle(0x6a4a2a); g.fillRect(2, 2, 28, 28);
  g.fillStyle(0x4a3018); g.fillRect(2, 2, 28, 4); g.fillRect(2, 26, 28, 4);
  g.fillStyle(0xaaaaaa); // spikes
  for (let si = 0; si < 4; si++) {
    const sx = 5 + si * 7;
    g.fillTriangle(sx, 22, sx+3, 22, sx+1, 8);
    g.fillTriangle(sx+1, 22, sx+4, 22, sx+2, 9);
  }
  g.fillStyle(0x888888);
  for (let si = 0; si < 4; si++) {
    const sx = 5 + si * 7;
    g.fillRect(sx, 20, 3, 3);
  }
  g.generateTexture('spike_trap', 32, 32);

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

  // Fungal ground (32×32) — dark purple-teal with bioluminescent spore clusters
  g.clear();
  g.fillStyle(0x1a0a2a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x2a1a3a); g.fillRect(2, 2, 14, 14); g.fillRect(18, 18, 12, 12);
  g.fillStyle(0x221533); g.fillRect(16, 2, 14, 14); g.fillRect(2, 18, 14, 12);
  g.fillStyle(0xaa44cc); g.fillCircle(8, 6, 2); g.fillCircle(22, 21, 2); g.fillCircle(13, 27, 1);
  g.fillStyle(0x8833aa); g.fillCircle(4, 19, 1); g.fillCircle(28, 8, 2); g.fillCircle(20, 13, 1);
  g.fillStyle(0xcc66ee); g.fillCircle(10, 11, 1); g.fillCircle(26, 26, 1); g.fillCircle(17, 4, 1);
  g.generateTexture('ground_fungal', 32, 32);

  // Desert ground (32×32) — sandy gold with wind-ripple marks and pebbles
  g.clear();
  g.fillStyle(0xd4a56a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xbb9050); g.fillRect(0, 8, 32, 2); g.fillRect(0, 18, 32, 2); g.fillRect(0, 26, 32, 1);
  g.fillStyle(0xe8c07a); g.fillRect(0, 10, 32, 1); g.fillRect(0, 20, 32, 1);
  g.fillStyle(0xc99055); g.fillRect(0, 14, 32, 1);
  g.fillStyle(0x997744); g.fillCircle(6, 4, 1); g.fillCircle(24, 14, 1); g.fillCircle(14, 28, 1);
  g.fillStyle(0xaa8855); g.fillCircle(20, 5, 1); g.fillCircle(4, 24, 1);
  g.generateTexture('ground_desert', 32, 32);

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

  // Mushroom tree (28×40) — thick gray-brown stalk, wide purple cap with spots
  g.clear();
  g.fillStyle(0x887766); g.fillRect(10, 22, 8, 18); // stalk
  g.fillStyle(0x665544); g.fillRect(10, 22, 2, 18); // shadow side
  g.fillStyle(0xaa33bb); g.fillEllipse(14, 20, 28, 18); // cap
  g.fillStyle(0xcc55dd); g.fillEllipse(14, 18, 22, 12); // cap highlight
  g.fillStyle(0x8822aa); g.fillEllipse(14, 22, 28, 8); // cap underside
  g.fillStyle(0xeebb44); g.fillCircle(8, 15, 2); g.fillCircle(20, 14, 2); g.fillCircle(14, 12, 1); // spots
  g.generateTexture('tree_mushroom', 28, 40);

  // Cactus (16×36) — green pillar with two offset arms
  g.clear();
  g.fillStyle(0x2d7a3a); g.fillRect(5, 4, 6, 32); // main trunk
  g.fillStyle(0x3d9a4a); g.fillRect(5, 6, 3, 26); // highlight
  g.fillStyle(0x2d7a3a); g.fillRect(2, 14, 5, 4); g.fillRect(2, 10, 4, 6); // left arm
  g.fillStyle(0x3d9a4a); g.fillRect(2, 14, 2, 4);
  g.fillStyle(0x2d7a3a); g.fillRect(9, 20, 5, 4); g.fillRect(9, 16, 4, 6); // right arm (lower)
  g.fillStyle(0x3d9a4a); g.fillRect(11, 20, 2, 4);
  g.generateTexture('tree_cactus', 16, 36);

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

  // Toxic pool — murky poison water tile (large, clearly reads as dangerous liquid)
  g.clear();
  // Deep murky base
  g.fillStyle(0x1a3a1a); g.fillEllipse(32, 26, 60, 44);
  // Mid-tone water body
  g.fillStyle(0x2a5a20); g.fillEllipse(32, 25, 52, 36);
  // Lighter surface sheen
  g.fillStyle(0x3a7a28); g.fillEllipse(30, 23, 40, 26);
  // Toxic highlight — sickly yellow-green shimmer
  g.fillStyle(0x6ab830, 0.7); g.fillEllipse(28, 21, 26, 14);
  g.fillStyle(0x88cc44, 0.5); g.fillEllipse(26, 19, 14, 8);
  // Bubble spots
  g.fillStyle(0x9edd55, 0.8); g.fillCircle(20, 18, 3); g.fillCircle(38, 24, 2); g.fillCircle(30, 30, 2);
  g.fillStyle(0xccff77, 0.6); g.fillCircle(22, 17, 1); g.fillCircle(36, 22, 1);
  // Dark edge for depth
  g.lineStyle(2, 0x0a2010, 0.9); g.strokeEllipse(32, 26, 60, 44);
  g.generateTexture('toxic_pool', 64, 52);

  // Shallow water (32×32) — translucent tint, drawn at low alpha so ground shows through
  g.clear();
  g.fillStyle(0x4488bb, 0.55); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x66aacc, 0.25); g.fillRect(0, 0, 32, 14);  // faint surface sheen
  g.fillStyle(0x88ccee, 0.3); g.fillRect(4, 10, 12, 1); g.fillRect(16, 16, 10, 1); g.fillRect(7, 22, 8, 1); // subtle ripples
  g.generateTexture('water_shallow', 32, 32);

  // Deep water (32×32) — slightly more opaque to signal impassable
  g.clear();
  g.fillStyle(0x1a3a66, 0.7); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x224488, 0.3); g.fillRect(0, 0, 32, 12);
  g.fillStyle(0x3366aa, 0.2); g.fillRect(6, 10, 8, 1); g.fillRect(17, 18, 7, 1);
  g.generateTexture('water_deep', 32, 32);

  // Ice tile (32×32) — pale cyan, passable, slippery momentum
  g.clear();
  g.fillStyle(0xbbddee); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xddeeff); g.fillRect(1, 1, 30, 30);
  g.lineStyle(1, 0x99bbcc);
  g.beginPath(); g.moveTo(4, 8); g.lineTo(16, 4); g.strokePath();
  g.beginPath(); g.moveTo(8, 20); g.lineTo(20, 14); g.strokePath();
  g.beginPath(); g.moveTo(20, 26); g.lineTo(28, 20); g.strokePath();
  g.beginPath(); g.moveTo(10, 8); g.lineTo(10, 18); g.strokePath();
  g.beginPath(); g.moveTo(22, 14); g.lineTo(22, 28); g.strokePath();
  g.generateTexture('water_ice', 32, 32);

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

  // Ice spire — tundra biome, jagged ice spike cluster (16×32)
  g.clear();
  g.fillStyle(0x3a6080); g.fillTriangle(8, 0, 1, 31, 15, 31);     // dark back spike
  g.fillStyle(0x5a8aaa); g.fillTriangle(8, 2, 3, 29, 13, 29);     // mid face
  g.fillStyle(0x8ab8d0); g.fillTriangle(8, 4, 5, 22, 11, 22);     // bright front face
  g.fillStyle(0xc0dff0); g.fillRect(7, 5, 2, 4); g.fillRect(5, 15, 1, 2); g.fillRect(10, 12, 1, 1); // frost sparkles
  g.fillStyle(0x2a4a60); g.fillTriangle(8, 0, 1, 31, 4, 20);      // shadow side
  g.fillStyle(0x1a2e3a); g.fillRect(2, 29, 12, 3);                // base shadow
  g.generateTexture('ice_spire', 16, 32);

  // Rock spire — wasteland biome, tall jagged rock formation (14×36)
  g.clear();
  g.fillStyle(0x5a3a20); g.fillTriangle(7, 0, 0, 35, 14, 35);    // dark rock body
  g.fillStyle(0x7a5234); g.fillTriangle(7, 2, 2, 31, 12, 31);    // mid face
  g.fillStyle(0x9a6848); g.fillTriangle(7, 4, 4, 22, 10, 22);    // bright highlight
  g.fillStyle(0x3a2010); g.fillTriangle(7, 0, 0, 35, 3, 22);     // shadow side
  g.fillStyle(0x4a2e18); g.fillRect(0, 33, 14, 3);               // base
  g.fillStyle(0x6a4830); g.fillRect(4, 10, 2, 2); g.fillRect(8, 17, 1, 2); // rock detail
  g.generateTexture('rock_spire', 14, 36);

  // Mangrove root tangle — swamp biome, wide twisted roots (36×18)
  g.clear();
  g.fillStyle(0x1e1208); g.fillRect(0, 8, 36, 10);               // root base fill
  g.fillStyle(0x2e1e10); g.fillRect(0, 10, 36, 5);               // mid tone
  // Arching root segments
  g.fillStyle(0x1e1208);
  g.fillRect(2, 4, 4, 8); g.fillRect(10, 2, 5, 9); g.fillRect(20, 3, 4, 8); g.fillRect(28, 5, 5, 7);
  // Mossy/wet highlights on root tops
  g.fillStyle(0x1a3010); g.fillRect(2, 5, 2, 3); g.fillRect(11, 3, 2, 4); g.fillRect(21, 4, 2, 3);
  g.fillStyle(0x3a2a14); g.fillRect(0, 8, 36, 2);                // top edge
  g.fillStyle(0x0e0a04); g.fillRect(0, 16, 36, 2);               // base shadow
  g.generateTexture('mangrove_roots', 36, 18);

  // Spiderweb — ruins biome decoration (24×24)
  g.clear();
  g.lineStyle(1, 0xaaaaaa, 0.85);
  // 8 radial spokes from center
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.lineBetween(12, 12, Math.round(12 + Math.cos(a) * 11), Math.round(12 + Math.sin(a) * 11));
  }
  // 3 concentric silk rings
  for (let r = 3; r <= 11; r += 4) {
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = 12 + Math.cos(a) * r, y = 12 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.strokePath();
  }
  g.generateTexture('spiderweb', 24, 24);

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

  // Raid loot cache — locked military crate (dark green, red lock)
  g.clear();
  g.fillStyle(0x2e3d1e); g.fillRect(2, 4, 22, 14);   // dark military body
  g.fillStyle(0x3e5028); g.fillRect(3, 5, 20, 12);   // body highlight
  g.fillStyle(0x1e2d0e); g.fillRect(2, 4, 22, 2);    // lid top edge
  g.fillStyle(0x5a6a44); g.fillRect(3, 5, 20, 3);    // lid face
  g.fillStyle(0x7a8a60); g.fillRect(2, 10, 22, 1);   // metal band
  g.fillStyle(0x7a8a60); g.fillRect(13, 4, 1, 14);   // vertical divider
  g.fillStyle(0xcc2222); g.fillRect(10, 7, 5, 6);    // red lock body
  g.fillStyle(0xee3333); g.fillRect(11, 5, 3, 4);    // lock shackle
  g.fillStyle(0x881111); g.fillRect(12, 9, 1, 2);    // keyhole
  g.generateTexture('raid_cache', 26, 22);

  // Ruin wall block — crumbling brick wall tile (high contrast for readability)
  g.clear();
  g.fillStyle(0x2a2a36); g.fillRect(0, 0, 32, 32);           // dark mortar base
  g.fillStyle(0x6a5c4a); g.fillRect(1, 1, 14, 6);             // brick row 1 left
  g.fillStyle(0x7a6c5a); g.fillRect(17, 1, 14, 6);            // brick row 1 right
  g.fillStyle(0x7a6c5a); g.fillRect(1, 9, 6, 6);              // brick row 2 far left
  g.fillStyle(0x6a5c4a); g.fillRect(9, 9, 14, 6);             // brick row 2 mid
  g.fillStyle(0x5a4c3a); g.fillRect(25, 9, 6, 6);             // brick row 2 right (darker)
  g.fillStyle(0x6a5c4a); g.fillRect(1, 17, 14, 6);            // brick row 3 left
  g.fillStyle(0x7a6c5a); g.fillRect(17, 17, 14, 6);           // brick row 3 right
  g.fillStyle(0x5a4c3a); g.fillRect(1, 25, 6, 6);             // brick row 4 far left
  g.fillStyle(0x7a6c5a); g.fillRect(9, 25, 14, 6);            // brick row 4 mid
  g.fillStyle(0x6a5c4a); g.fillRect(25, 25, 6, 6);            // brick row 4 right
  // Mortar cracks / damage marks
  g.fillStyle(0x1a1a24); g.fillRect(3, 4, 1, 3); g.fillRect(20, 20, 2, 2);
  g.fillStyle(0x1a1a24); g.fillRect(14, 11, 1, 4); g.fillRect(27, 28, 2, 2);
  // Bright highlight edge on top-left (gives depth)
  g.fillStyle(0x9a8c7a); g.fillRect(1, 1, 13, 1); g.fillRect(17, 1, 13, 1);
  g.fillStyle(0x9a8c7a); g.fillRect(1, 9, 5, 1); g.fillRect(9, 9, 13, 1);
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

  // Plank floor — warm wood planks for farmhouse interiors
  g.clear();
  g.fillStyle(0x7a5a30); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x8a6a3a); g.fillRect(0, 0, 32, 7); g.fillRect(0, 16, 32, 8);
  g.fillStyle(0x6a4c28); g.fillRect(0, 8, 32, 7); g.fillRect(0, 24, 32, 8);
  g.fillStyle(0x5a3c1e); g.fillRect(0, 7, 32, 1); g.fillRect(0, 15, 32, 1); g.fillRect(0, 23, 32, 1);
  g.fillStyle(0x5a3c1e); g.fillRect(10, 0, 1, 7); g.fillRect(22, 8, 1, 7); g.fillRect(6, 16, 1, 8); g.fillRect(18, 24, 1, 8);
  g.fillStyle(0x9a7a4a, 0.4); g.fillRect(2, 2, 8, 4); g.fillRect(14, 18, 8, 4);
  g.generateTexture('plank_floor', 32, 32);

  // Rot plank floor — decayed wood for swamp shack interiors
  g.clear();
  g.fillStyle(0x3a2c18); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x4a3820); g.fillRect(0, 0, 32, 7); g.fillRect(0, 16, 32, 8);
  g.fillStyle(0x2e2010); g.fillRect(0, 8, 32, 7); g.fillRect(0, 24, 32, 8);
  g.fillStyle(0x1e1208); g.fillRect(0, 7, 32, 1); g.fillRect(0, 15, 32, 1); g.fillRect(0, 23, 32, 1);
  g.fillStyle(0x1e1208); g.fillRect(10, 0, 1, 7); g.fillRect(22, 8, 1, 7); g.fillRect(6, 16, 1, 8);
  g.fillStyle(0x283810, 0.5); g.fillRect(4, 3, 3, 2); g.fillRect(18, 20, 4, 2); g.fillRect(26, 10, 3, 3);
  g.generateTexture('rot_plank_floor', 32, 32);

  // Metal floor — industrial grating for bunker interiors
  g.clear();
  g.fillStyle(0x3a3a3a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x4a4a4a); g.fillRect(0, 0, 15, 15); g.fillRect(17, 17, 15, 15);
  g.fillStyle(0x2e2e2e); g.fillRect(17, 0, 15, 15); g.fillRect(0, 17, 15, 15);
  g.fillStyle(0x222222); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32);
  g.fillStyle(0x5a5a5a, 0.6); g.fillRect(2, 2, 11, 1); g.fillRect(19, 19, 11, 1);
  g.fillStyle(0x1a1a1a); g.fillRect(4, 6, 1, 1); g.fillRect(8, 10, 1, 1); g.fillRect(20, 22, 1, 1);
  g.generateTexture('metal_floor', 32, 32);

  // Fungal wall — dark wood with purple mycelium tendrils (32×32)
  g.clear();
  g.fillStyle(0x1a0e08); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x2a1a10); g.fillRect(0, 0, 14, 14); g.fillRect(18, 18, 14, 14);
  g.fillStyle(0x1e1208); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32); // plank lines
  g.fillStyle(0x8822aa); g.fillRect(4, 6, 1, 8); g.fillRect(7, 3, 1, 5); // mycelium tendrils
  g.fillStyle(0xaa44cc); g.fillRect(20, 18, 1, 9); g.fillRect(24, 20, 1, 7);
  g.fillStyle(0xcc66ee); g.fillCircle(4, 6, 1); g.fillCircle(20, 18, 1); g.fillCircle(7, 3, 1);
  g.generateTexture('fungal_wall', 32, 32);

  // Fungal floor — dark planks with spore patterns (32×32)
  g.clear();
  g.fillStyle(0x18100a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x221810); g.fillRect(0, 0, 32, 7); g.fillRect(0, 16, 32, 8);
  g.fillStyle(0x0e0a06); g.fillRect(0, 7, 32, 1); g.fillRect(0, 24, 32, 1); // plank seams
  g.fillStyle(0x8822aa); g.fillCircle(6, 4, 1); g.fillCircle(22, 20, 1); g.fillCircle(14, 27, 1);
  g.fillStyle(0xaa44cc); g.fillCircle(28, 5, 1); g.fillCircle(4, 20, 1);
  g.generateTexture('fungal_floor', 32, 32);

  // Sandstone wall — beige/tan stone brick for desert outpost (32×32)
  g.clear();
  g.fillStyle(0xc8a868); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xb09050); g.fillRect(0, 0, 14, 14); g.fillRect(18, 18, 14, 14);
  g.fillStyle(0x907840); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32); // mortar lines
  g.fillStyle(0xddb870); g.fillRect(1, 1, 12, 4); g.fillRect(17, 17, 12, 4); // highlight face
  g.fillStyle(0x887030); g.fillRect(3, 10, 4, 2); g.fillRect(20, 8, 3, 2); // shadow detail
  g.generateTexture('sandstone_wall', 32, 32);

  // Sandstone floor — sandy tile for desert outpost interiors (32×32)
  g.clear();
  g.fillStyle(0xd4a86a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xbc9055); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32); // tile seams
  g.fillStyle(0xe0bb7a); g.fillRect(2, 2, 12, 12); g.fillRect(18, 18, 12, 12); // lighter tiles
  g.fillStyle(0xb08040); g.fillRect(3, 10, 2, 2); g.fillRect(24, 4, 2, 2); // small chips
  g.generateTexture('sandstone_floor', 32, 32);

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
  drawWolf(g); drawRat(g); drawBear(g); drawIceCrawler(g); drawSpiderRuins(g); drawBogLurker(g); drawDustHound(g);

  g.destroy();
}

function drawKnight(g) {
  g.clear();
  // boots
  g.fillStyle(0x1a2d3d); g.fillRect(5,52,11,8); g.fillRect(18,52,11,8);
  g.fillStyle(0x2d4a63); g.fillRect(18,52,4,6);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(5,34,11,20); g.fillRect(18,34,11,20);
  g.fillStyle(0x3a5a7a); g.fillRect(19,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(5,46,11,2); g.fillRect(18,46,11,2);
  // belt/tassets
  g.fillStyle(0x111111); g.fillRect(2,30,28,6);
  g.fillStyle(0x2d4a63); g.fillRect(4,31,10,4); g.fillRect(16,31,10,4);
  // torso/breastplate
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,28,20);
  g.fillStyle(0x3a5a7a); g.fillRect(6,14,18,16);
  g.fillStyle(0x5588aa); g.fillRect(6,14,18,4);
  // shield (left arm)
  g.fillStyle(0x2244aa); g.fillRect(0,12,6,24);
  g.fillStyle(0x4466cc); g.fillRect(1,13,3,20);
  g.fillStyle(0xccaa00); g.fillCircle(2,23,3);
  g.fillStyle(0xeecc22); g.fillCircle(2,23,1);
  // sword arm (right)
  g.fillStyle(0x4a6d8c); g.fillRect(28,12,8,22);
  g.fillStyle(0x3a5a7a); g.fillRect(28,12,4,20);
  // sword
  g.fillStyle(0xcc9900); g.fillRect(34,10,9,5);
  g.fillStyle(0x8b6914); g.fillRect(36,15,5,6);
  g.fillStyle(0xbbbbbb); g.fillRect(40,2,3,44);
  g.fillStyle(0xdddddd); g.fillRect(42,2,1,42);
  // gorget/neck
  g.fillStyle(0x4a6d8c); g.fillRect(14,10,16,4);
  // helmet
  g.fillStyle(0x4a6d8c); g.fillRect(8,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(8,4,24,8);
  g.fillStyle(0x080808); g.fillRect(10,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(12,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(8,0,4,13); g.fillRect(28,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(8,0,24,3);
  g.generateTexture('knight', 44, 60);
}

function drawGunslinger(g) {
  g.clear();
  // boots
  g.fillStyle(0x3d2010); g.fillRect(5,52,11,8); g.fillRect(18,52,11,8);
  g.fillStyle(0x5c3318); g.fillRect(18,52,4,6);
  // pants
  g.fillStyle(0x3a5a7a); g.fillRect(5,34,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x4a6a8a); g.fillRect(19,34,4,16);
  // holster
  g.fillStyle(0x3d2010); g.fillRect(18,42,10,8);
  g.fillStyle(0x222222); g.fillRect(20,44,6,6);
  // belt
  g.fillStyle(0x9a6622); g.fillRect(2,30,28,6);
  g.fillStyle(0xccaa44); g.fillRect(16,31,6,4);
  // coat body
  g.fillStyle(0xcc8833); g.fillRect(2,12,28,20);
  g.fillStyle(0xffeedd); g.fillRect(8,13,12,17);
  g.fillStyle(0x9a6622); g.fillRect(2,12,4,20); g.fillRect(26,12,4,20);
  // gun arm (right)
  g.fillStyle(0xcc8833); g.fillRect(28,12,8,22);
  g.fillStyle(0x9a6622); g.fillRect(28,12,4,20);
  g.fillStyle(0x333333); g.fillRect(34,11,10,4);
  g.fillStyle(0x555555); g.fillRect(35,9,7,6);
  g.fillStyle(0x222222); g.fillRect(36,15,6,4);
  // left arm
  g.fillStyle(0xcc8833); g.fillRect(0,12,4,22);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  // face
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  // hat brim
  g.fillStyle(0x7a4a1a); g.fillRect(2,3,34,3);
  // hat crown
  g.fillStyle(0x553311); g.fillRect(8,0,20,6);
  g.fillStyle(0x7a5533); g.fillRect(8,0,20,1);
  g.fillStyle(0x7a4a1a); g.fillRect(8,4,20,1);
  g.generateTexture('gunslinger', 44, 60);
}

function drawArchitect(g) {
  g.clear();
  // boots
  g.fillStyle(0x222222); g.fillRect(5,52,11,8); g.fillRect(18,52,11,8);
  g.fillStyle(0x444444); g.fillRect(18,52,4,6);
  // pants
  g.fillStyle(0x334477); g.fillRect(5,34,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x445588); g.fillRect(19,34,4,16);
  // tool belt
  g.fillStyle(0x8b6914); g.fillRect(2,30,28,6);
  g.fillStyle(0xaaaaaa); g.fillRect(4,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(8,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(12,29,3,5);
  // vest body
  g.fillStyle(0x3a9a55); g.fillRect(2,12,28,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,12,16);
  g.fillStyle(0xffcc00); g.fillRect(2,12,4,4); g.fillRect(26,12,4,4);
  // left arm
  g.fillStyle(0x3a9a55); g.fillRect(0,12,4,22);
  // right arm + wrench
  g.fillStyle(0x3a9a55); g.fillRect(28,12,8,22);
  g.fillStyle(0x777777); g.fillRect(33,5,6,4);
  g.fillStyle(0x999999); g.fillRect(34,9,4,16);
  g.fillStyle(0xbbbbbb); g.fillRect(34,9,2,14);
  g.fillStyle(0x555555); g.fillRect(33,4,6,2);
  g.fillStyle(0x555555); g.fillRect(33,8,2,2); g.fillRect(37,8,2,2);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  // face
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  // hard hat
  g.fillStyle(0x222222); g.fillRect(6,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(6,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(6,0,26,2);
  g.fillStyle(0x666600); g.fillRect(6,4,26,2);
  g.generateTexture('architect', 44, 60);
}

// ── DIRECTIONAL / WALK-CYCLE SPRITES ─────────────────────────

// ── KNIGHT variants ──────────────────────────────────────────
function drawKnightStep(g) {
  g.clear();
  // boots - left raised, right planted
  g.fillStyle(0x1a2d3d); g.fillRect(5,49,11,10); g.fillRect(18,52,11,8);
  g.fillStyle(0x2d4a63); g.fillRect(18,52,4,6);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(5,32,11,18); g.fillRect(18,34,11,20);
  g.fillStyle(0x3a5a7a); g.fillRect(19,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(5,44,11,2); g.fillRect(18,46,11,2);
  // belt/tassets
  g.fillStyle(0x111111); g.fillRect(2,30,28,6);
  g.fillStyle(0x2d4a63); g.fillRect(4,31,10,4); g.fillRect(16,31,10,4);
  // torso
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,28,20);
  g.fillStyle(0x3a5a7a); g.fillRect(6,14,18,16);
  g.fillStyle(0x5588aa); g.fillRect(6,14,18,4);
  // shield (raised slightly in stride)
  g.fillStyle(0x2244aa); g.fillRect(0,10,6,26);
  g.fillStyle(0x4466cc); g.fillRect(1,11,3,22);
  g.fillStyle(0xccaa00); g.fillCircle(2,22,3);
  g.fillStyle(0xeecc22); g.fillCircle(2,22,1);
  // sword arm (forward)
  g.fillStyle(0x4a6d8c); g.fillRect(28,10,8,24);
  g.fillStyle(0x3a5a7a); g.fillRect(28,10,4,22);
  g.fillStyle(0xcc9900); g.fillRect(34,8,9,5);
  g.fillStyle(0x8b6914); g.fillRect(36,13,5,6);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,3,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // gorget/neck
  g.fillStyle(0x4a6d8c); g.fillRect(14,10,16,4);
  // helmet
  g.fillStyle(0x4a6d8c); g.fillRect(8,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(8,4,24,8);
  g.fillStyle(0x080808); g.fillRect(10,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(12,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(8,0,4,13); g.fillRect(28,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(8,0,24,3);
  g.generateTexture('knight_step', 44, 60);
}

function drawKnightFront(g) {
  g.clear();
  // boots
  g.fillStyle(0x1a2d3d); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(7,34,12,20); g.fillRect(23,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(9,34,4,18); g.fillRect(25,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(7,46,12,2); g.fillRect(23,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  g.fillStyle(0x2d4a63); g.fillRect(6,31,10,4); g.fillRect(20,31,10,4);
  g.fillStyle(0xccaa00); g.fillRect(19,30,5,4);
  // torso/breastplate
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x3a5a7a); g.fillRect(10,14,24,16);
  g.fillStyle(0x5588aa); g.fillRect(10,14,24,4);
  g.fillStyle(0xccaa00); g.fillCircle(22,22,3);
  // left arm/shield
  g.fillStyle(0x4a6d8c); g.fillRect(0,12,6,22);
  g.fillStyle(0x2244aa); g.fillRect(0,12,4,24);
  g.fillStyle(0x4466cc); g.fillRect(1,13,2,20);
  g.fillStyle(0xccaa00); g.fillCircle(1,23,2);
  // right arm/sword
  g.fillStyle(0x4a6d8c); g.fillRect(36,12,8,22);
  g.fillStyle(0xcc9900); g.fillRect(36,10,10,5);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,4,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  // helmet
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,4,24,8);
  g.fillStyle(0x080808); g.fillRect(12,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(14,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_front', 44, 60);
}

function drawKnightFrontStep(g) {
  g.clear();
  // boots - left raised, right planted
  g.fillStyle(0x1a2d3d); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(7,32,12,18); g.fillRect(23,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(9,32,4,16); g.fillRect(25,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(7,44,12,2); g.fillRect(23,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  g.fillStyle(0x2d4a63); g.fillRect(6,31,10,4); g.fillRect(20,31,10,4);
  g.fillStyle(0xccaa00); g.fillRect(19,30,5,4);
  // torso
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x3a5a7a); g.fillRect(10,14,24,16);
  g.fillStyle(0x5588aa); g.fillRect(10,14,24,4);
  g.fillStyle(0xccaa00); g.fillCircle(22,22,3);
  // left arm/shield (back in stride)
  g.fillStyle(0x4a6d8c); g.fillRect(0,12,6,22);
  g.fillStyle(0x2244aa); g.fillRect(0,14,4,22);
  g.fillStyle(0x4466cc); g.fillRect(1,15,2,18);
  g.fillStyle(0xccaa00); g.fillCircle(1,24,2);
  // right arm/sword (forward)
  g.fillStyle(0x4a6d8c); g.fillRect(36,12,8,22);
  g.fillStyle(0xcc9900); g.fillRect(36,8,10,5);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,4,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  // helmet
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,4,24,8);
  g.fillStyle(0x080808); g.fillRect(12,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(14,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_front_step', 44, 60);
}

function drawKnightBack(g) {
  g.clear();
  // boots
  g.fillStyle(0x1a2d3d); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(7,34,12,20); g.fillRect(23,34,12,20);
  g.fillStyle(0x1a2d3d); g.fillRect(7,46,12,2); g.fillRect(23,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  // back plate torso
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,24,16);
  g.fillStyle(0x1a2d3d); g.fillRect(20,14,4,16);
  // arms (both pauldrons visible)
  g.fillStyle(0x4a6d8c); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  // shield strap on left back
  g.fillStyle(0x2244aa); g.fillRect(0,14,4,22);
  g.fillStyle(0xccaa00); g.fillRect(1,20,2,4);
  // sword from behind
  g.fillStyle(0xcc9900); g.fillRect(36,10,10,5);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,4,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // neck (back)
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  // helmet back
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(20,0,4,12);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_back', 44, 60);
}

function drawKnightBackStep(g) {
  g.clear();
  // boots - left raised, right planted
  g.fillStyle(0x1a2d3d); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(7,32,12,18); g.fillRect(23,34,12,20);
  g.fillStyle(0x1a2d3d); g.fillRect(7,44,12,2); g.fillRect(23,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  // torso back
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,24,16);
  g.fillStyle(0x1a2d3d); g.fillRect(20,14,4,16);
  // arms
  g.fillStyle(0x4a6d8c); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x2244aa); g.fillRect(0,12,4,24);
  g.fillStyle(0xccaa00); g.fillRect(1,18,2,4);
  g.fillStyle(0xcc9900); g.fillRect(36,8,10,5);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,4,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  // helmet back
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(20,0,4,12);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_back_step', 44, 60);
}

// ── GUNSLINGER variants ───────────────────────────────────────
function drawGunslingerStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(5,49,11,10); g.fillRect(18,52,11,8);
  g.fillStyle(0x5c3318); g.fillRect(18,52,4,6);
  g.fillStyle(0x3a5a7a); g.fillRect(5,32,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x4a6a8a); g.fillRect(19,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(18,42,10,8);
  g.fillStyle(0x222222); g.fillRect(20,44,6,6);
  g.fillStyle(0x9a6622); g.fillRect(2,30,28,6);
  g.fillStyle(0xccaa44); g.fillRect(16,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(2,12,28,20);
  g.fillStyle(0xffeedd); g.fillRect(8,13,12,17);
  g.fillStyle(0x9a6622); g.fillRect(2,12,4,20); g.fillRect(26,12,4,20);
  g.fillStyle(0xcc8833); g.fillRect(28,10,8,24);
  g.fillStyle(0x9a6622); g.fillRect(28,10,4,22);
  g.fillStyle(0x333333); g.fillRect(34,9,10,4);
  g.fillStyle(0x555555); g.fillRect(35,7,7,6);
  g.fillStyle(0x222222); g.fillRect(36,13,6,4);
  g.fillStyle(0xcc8833); g.fillRect(0,14,4,20);
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  g.fillStyle(0x7a4a1a); g.fillRect(2,3,34,3);
  g.fillStyle(0x553311); g.fillRect(8,0,20,6);
  g.fillStyle(0x7a5533); g.fillRect(8,0,20,1);
  g.fillStyle(0x7a4a1a); g.fillRect(8,4,20,1);
  g.generateTexture('gunslinger_step', 44, 60);
}

function drawGunslingerFront(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(9,34,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(27,40,10,10);
  g.fillStyle(0x222222); g.fillRect(29,42,7,7);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  g.fillStyle(0xccaa44); g.fillRect(19,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  g.fillStyle(0x9a6622); g.fillRect(4,12,6,20); g.fillRect(34,12,6,20);
  g.fillStyle(0xcc8833); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  g.fillStyle(0x333333); g.fillRect(36,15,10,4);
  g.fillStyle(0x555555); g.fillRect(38,12,8,6);
  g.fillStyle(0x222222); g.fillRect(40,19,6,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,24,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_front', 44, 60);
}

function drawGunslingerFrontStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,32,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(9,32,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(27,40,10,10);
  g.fillStyle(0x222222); g.fillRect(29,42,7,7);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  g.fillStyle(0xccaa44); g.fillRect(19,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  g.fillStyle(0x9a6622); g.fillRect(4,12,6,20); g.fillRect(34,12,6,20);
  g.fillStyle(0xcc8833); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x333333); g.fillRect(36,13,10,4);
  g.fillStyle(0x555555); g.fillRect(38,10,8,6);
  g.fillStyle(0x222222); g.fillRect(40,17,6,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,24,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_front_step', 44, 60);
}

function drawGunslingerBack(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  // coat back
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,24,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,8,17);
  g.fillStyle(0xcc8833); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  g.fillStyle(0x333333); g.fillRect(36,16,10,4);
  g.fillStyle(0x555555); g.fillRect(38,14,8,5);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,16,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_back', 44, 60);
}

function drawGunslingerBackStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,32,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,24,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,8,17);
  g.fillStyle(0xcc8833); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x333333); g.fillRect(36,14,10,4);
  g.fillStyle(0x555555); g.fillRect(38,12,8,5);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,16,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_back_step', 44, 60);
}

// ── ARCHITECT variants ────────────────────────────────────────
function drawArchitectStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(5,49,11,10); g.fillRect(18,52,11,8);
  g.fillStyle(0x444444); g.fillRect(18,52,4,6);
  g.fillStyle(0x334477); g.fillRect(5,32,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x445588); g.fillRect(19,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(2,30,28,6);
  g.fillStyle(0xaaaaaa); g.fillRect(4,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(8,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(12,29,3,5);
  g.fillStyle(0x3a9a55); g.fillRect(2,12,28,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,12,16);
  g.fillStyle(0xffcc00); g.fillRect(2,12,4,4); g.fillRect(26,12,4,4);
  g.fillStyle(0x3a9a55); g.fillRect(0,14,4,20);
  g.fillStyle(0x3a9a55); g.fillRect(28,10,8,24);
  g.fillStyle(0x777777); g.fillRect(33,3,6,4);
  g.fillStyle(0x999999); g.fillRect(34,7,4,16);
  g.fillStyle(0xbbbbbb); g.fillRect(34,7,2,14);
  g.fillStyle(0x555555); g.fillRect(33,2,6,2);
  g.fillStyle(0x555555); g.fillRect(33,6,2,2); g.fillRect(37,6,2,2);
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  g.fillStyle(0x222222); g.fillRect(6,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(6,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(6,0,26,2);
  g.fillStyle(0x666600); g.fillRect(6,4,26,2);
  g.generateTexture('architect_step', 44, 60);
}

function drawArchitectFront(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x445588); g.fillRect(9,34,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(20,29,3,5);
  // vest front
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(16,13,12,17);
  g.fillStyle(0xffcc00); g.fillRect(3,11,8,4); g.fillRect(33,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(5,19,5,2); g.fillRect(34,19,5,2);
  // arms
  g.fillStyle(0x3a9a55); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  // wrench on right arm
  g.fillStyle(0x777777); g.fillRect(36,8,7,5);
  g.fillStyle(0x999999); g.fillRect(38,13,4,14);
  g.fillStyle(0xbbbbbb); g.fillRect(38,13,2,12);
  g.fillStyle(0x555555); g.fillRect(36,7,7,2);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xeeee44); g.fillRect(8,0,28,2);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_front', 44, 60);
}

function drawArchitectFrontStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,32,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x445588); g.fillRect(9,32,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(20,29,3,5);
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(16,13,12,17);
  g.fillStyle(0xffcc00); g.fillRect(3,11,8,4); g.fillRect(33,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(5,19,5,2); g.fillRect(34,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x777777); g.fillRect(36,6,7,5);
  g.fillStyle(0x999999); g.fillRect(38,11,4,14);
  g.fillStyle(0xbbbbbb); g.fillRect(38,11,2,12);
  g.fillStyle(0x555555); g.fillRect(36,5,7,2);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xeeee44); g.fillRect(8,0,28,2);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_front_step', 44, 60);
}

function drawArchitectBack(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  // vest back
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(10,13,24,17);
  g.fillStyle(0xffcc00); g.fillRect(4,11,8,4); g.fillRect(32,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(6,19,5,2); g.fillRect(33,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  // wrench visible from behind
  g.fillStyle(0x999999); g.fillRect(38,10,4,14);
  g.fillStyle(0x777777); g.fillRect(36,8,7,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xaa9900); g.fillRect(10,1,24,4);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_back', 44, 60);
}

function drawArchitectBackStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,32,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(10,13,24,17);
  g.fillStyle(0xffcc00); g.fillRect(4,11,8,4); g.fillRect(32,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(6,19,5,2); g.fillRect(33,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x999999); g.fillRect(38,8,4,14);
  g.fillStyle(0x777777); g.fillRect(36,6,7,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xaa9900); g.fillRect(10,1,24,4);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_back_step', 44, 60);
}

// ── 8-DIRECTIONAL DIAGONAL SPRITES ───────────────────────────
// fside = front-diagonal (3/4 view toward camera, moving sideways)
// bside = back-diagonal  (3/4 view away from camera, moving sideways)

function drawKnightFSide(g) {
  g.clear();
  // legs - near (right) lower, far (left) slightly higher = depth/stride
  g.fillStyle(0x1a2d3d); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,34,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,45,10,2); g.fillRect(22,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  g.fillStyle(0x2d4a63); g.fillRect(8,31,8,4); g.fillRect(20,31,10,4);
  // torso - near/right side lighter, far/left darker = 3/4 angle
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(6,14,8,16);
  g.fillStyle(0x3a5a7a); g.fillRect(14,14,20,16);
  g.fillStyle(0x5588aa); g.fillRect(18,14,16,4);
  // far arm/shield (compressed)
  g.fillStyle(0x2244aa); g.fillRect(2,12,6,24);
  g.fillStyle(0x4466cc); g.fillRect(3,13,3,20);
  g.fillStyle(0xccaa00); g.fillCircle(4,23,2);
  // near arm + sword (prominent)
  g.fillStyle(0x4a6d8c); g.fillRect(34,12,8,22);
  g.fillStyle(0x3a5a7a); g.fillRect(34,12,4,20);
  g.fillStyle(0xcc9900); g.fillRect(38,10,8,5);
  g.fillStyle(0x8b6914); g.fillRect(40,15,4,6);
  g.fillStyle(0xbbbbbb); g.fillRect(41,2,3,44);
  g.fillStyle(0xdddddd); g.fillRect(43,2,1,42);
  // gorget
  g.fillStyle(0x4a6d8c); g.fillRect(16,10,14,4);
  // helmet - face turned toward near side
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,4,24,8);
  g.fillStyle(0x080808); g.fillRect(11,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(16,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_fside', 44, 60);
}
function drawKnightFSideStep(g) {
  g.clear();
  // legs - near planted, far raised (striding)
  g.fillStyle(0x1a2d3d); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,32,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,43,10,2); g.fillRect(22,46,12,2);
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  g.fillStyle(0x2d4a63); g.fillRect(8,31,8,4); g.fillRect(20,31,10,4);
  // torso
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(6,14,8,16);
  g.fillStyle(0x3a5a7a); g.fillRect(14,14,20,16);
  g.fillStyle(0x5588aa); g.fillRect(18,14,16,4);
  // far arm/shield (back)
  g.fillStyle(0x2244aa); g.fillRect(2,14,6,22);
  g.fillStyle(0x4466cc); g.fillRect(3,15,3,18);
  g.fillStyle(0xccaa00); g.fillCircle(4,24,2);
  // near arm + sword (forward)
  g.fillStyle(0x4a6d8c); g.fillRect(34,10,8,24);
  g.fillStyle(0x3a5a7a); g.fillRect(34,10,4,22);
  g.fillStyle(0xcc9900); g.fillRect(38,8,8,5);
  g.fillStyle(0x8b6914); g.fillRect(40,13,4,6);
  g.fillStyle(0xbbbbbb); g.fillRect(41,0,3,44);
  g.fillStyle(0xdddddd); g.fillRect(43,0,1,42);
  g.fillStyle(0x4a6d8c); g.fillRect(16,10,14,4);
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,4,24,8);
  g.fillStyle(0x080808); g.fillRect(11,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(16,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_fside_step', 44, 60);
}
function drawKnightBSide(g) {
  g.clear();
  // legs - same stride offset
  g.fillStyle(0x1a2d3d); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,34,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,44,10,2); g.fillRect(22,46,12,2);
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  // torso back - darker, back plate prominent
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,22,16);
  g.fillStyle(0x1a2d3d); g.fillRect(18,14,6,16);
  // far arm (left, back shoulder visible)
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,8,22);
  g.fillStyle(0x2d4a63); g.fillRect(2,14,6,18);
  g.fillStyle(0x2244aa); g.fillRect(2,14,4,22);
  g.fillStyle(0xccaa00); g.fillRect(3,20,2,4);
  // near arm + sword from behind
  g.fillStyle(0x4a6d8c); g.fillRect(34,12,8,22);
  g.fillStyle(0xcc9900); g.fillRect(38,10,8,5);
  g.fillStyle(0xbbbbbb); g.fillRect(41,2,3,44);
  g.fillStyle(0xdddddd); g.fillRect(43,2,1,42);
  // neck (tiny skin patch, back view)
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  // helmet back
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(19,0,6,12);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_bside', 44, 60);
}
function drawKnightBSideStep(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,32,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,43,10,2); g.fillRect(22,46,12,2);
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,22,16);
  g.fillStyle(0x1a2d3d); g.fillRect(18,14,6,16);
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,8,22);
  g.fillStyle(0x2244aa); g.fillRect(2,12,4,24);
  g.fillStyle(0xccaa00); g.fillRect(3,18,2,4);
  g.fillStyle(0x4a6d8c); g.fillRect(34,10,8,24);
  g.fillStyle(0xcc9900); g.fillRect(38,8,8,5);
  g.fillStyle(0xbbbbbb); g.fillRect(41,0,3,44);
  g.fillStyle(0xdddddd); g.fillRect(43,0,1,42);
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(19,0,6,12);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_bside_step', 44, 60);
}

function drawGunslingerFSide(g) {
  g.clear();
  // legs - near lower, far higher (3/4 stride)
  g.fillStyle(0x3d2010); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(24,34,4,16);
  // holster on near side
  g.fillStyle(0x3d2010); g.fillRect(24,40,8,8);
  g.fillStyle(0x222222); g.fillRect(26,42,5,5);
  // belt
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  g.fillStyle(0xccaa44); g.fillRect(20,31,6,4);
  // coat - near/right side vest visible, far/left coat trim
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0x9a6622); g.fillRect(6,12,4,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  // far arm (compressed)
  g.fillStyle(0xcc8833); g.fillRect(2,12,6,22);
  g.fillStyle(0x9a6622); g.fillRect(2,14,4,18);
  // near arm + gun (prominent)
  g.fillStyle(0xcc8833); g.fillRect(34,12,8,22);
  g.fillStyle(0x333333); g.fillRect(38,11,8,4);
  g.fillStyle(0x555555); g.fillRect(39,9,7,6);
  g.fillStyle(0x222222); g.fillRect(40,15,6,3);
  // neck + face (shifted right)
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  // hat brim slightly angled
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,22,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_fside', 44, 60);
}
function drawGunslingerFSideStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,32,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(24,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(24,40,8,8);
  g.fillStyle(0x222222); g.fillRect(26,42,5,5);
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  g.fillStyle(0xccaa44); g.fillRect(20,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0x9a6622); g.fillRect(6,12,4,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  g.fillStyle(0xcc8833); g.fillRect(2,14,6,20);
  g.fillStyle(0x9a6622); g.fillRect(2,16,4,16);
  g.fillStyle(0xcc8833); g.fillRect(34,10,8,24);
  g.fillStyle(0x333333); g.fillRect(38,9,8,4);
  g.fillStyle(0x555555); g.fillRect(39,7,7,6);
  g.fillStyle(0x222222); g.fillRect(40,13,6,3);
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,22,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_fside_step', 44, 60);
}
function drawGunslingerBSide(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  // coat back - angled
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,22,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,6,17);
  // far arm (compressed, back shoulder)
  g.fillStyle(0xcc8833); g.fillRect(2,12,8,22);
  g.fillStyle(0x9a6622); g.fillRect(2,14,6,18);
  // near arm + gun from behind
  g.fillStyle(0xcc8833); g.fillRect(34,12,8,22);
  g.fillStyle(0x333333); g.fillRect(38,13,8,4);
  g.fillStyle(0x555555); g.fillRect(39,11,7,5);
  // neck back
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  // hat back
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,14,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_bside', 44, 60);
}
function drawGunslingerBSideStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,32,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,22,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,6,17);
  g.fillStyle(0xcc8833); g.fillRect(2,14,8,20);
  g.fillStyle(0x9a6622); g.fillRect(2,16,6,16);
  g.fillStyle(0xcc8833); g.fillRect(34,10,8,24);
  g.fillStyle(0x333333); g.fillRect(38,11,8,4);
  g.fillStyle(0x555555); g.fillRect(39,9,7,5);
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,14,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_bside_step', 44, 60);
}

function drawArchitectFSide(g) {
  g.clear();
  // legs - near lower, far higher
  g.fillStyle(0x222222); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x445588); g.fillRect(24,34,4,16);
  // tool belt
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  // vest - near side brighter
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(8,14,10,16);
  g.fillStyle(0x4dbb66); g.fillRect(18,14,16,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(22,19,5,2);
  // far arm (compressed)
  g.fillStyle(0x3a9a55); g.fillRect(2,12,6,22);
  g.fillStyle(0x1a5533); g.fillRect(2,14,4,18);
  // near arm + wrench (prominent)
  g.fillStyle(0x3a9a55); g.fillRect(34,12,8,22);
  g.fillStyle(0x777777); g.fillRect(38,5,6,5);
  g.fillStyle(0x999999); g.fillRect(39,10,4,16);
  g.fillStyle(0xbbbbbb); g.fillRect(39,10,2,14);
  g.fillStyle(0x555555); g.fillRect(38,4,6,2);
  // neck + face shifted right
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  // hard hat
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(7,0,26,2);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_fside', 44, 60);
}
function drawArchitectFSideStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,32,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x445588); g.fillRect(24,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(8,14,10,16);
  g.fillStyle(0x4dbb66); g.fillRect(18,14,16,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(22,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(2,14,6,20);
  g.fillStyle(0x1a5533); g.fillRect(2,16,4,16);
  g.fillStyle(0x3a9a55); g.fillRect(34,10,8,24);
  g.fillStyle(0x777777); g.fillRect(38,3,6,5);
  g.fillStyle(0x999999); g.fillRect(39,8,4,16);
  g.fillStyle(0xbbbbbb); g.fillRect(39,8,2,14);
  g.fillStyle(0x555555); g.fillRect(38,2,6,2);
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(7,0,26,2);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_fside_step', 44, 60);
}
function drawArchitectBSide(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  // vest back - angled, back panel visible
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,22,16);
  g.fillStyle(0x2a7a45); g.fillRect(18,14,6,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(8,20,5,2); g.fillRect(23,20,5,2);
  // far arm (compressed)
  g.fillStyle(0x3a9a55); g.fillRect(2,12,8,22);
  g.fillStyle(0x1a5533); g.fillRect(2,14,6,18);
  // near arm (prominent shoulder) + wrench from behind
  g.fillStyle(0x3a9a55); g.fillRect(34,12,8,22);
  g.fillStyle(0x999999); g.fillRect(39,6,4,16);
  g.fillStyle(0x777777); g.fillRect(37,5,7,4);
  // neck back
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  // hard hat back
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xaa9900); g.fillRect(9,1,22,4);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_bside', 44, 60);
}
function drawArchitectBSideStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,32,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,22,16);
  g.fillStyle(0x2a7a45); g.fillRect(18,14,6,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(8,20,5,2); g.fillRect(23,20,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(2,14,8,20);
  g.fillStyle(0x1a5533); g.fillRect(2,16,6,16);
  g.fillStyle(0x3a9a55); g.fillRect(34,10,8,24);
  g.fillStyle(0x999999); g.fillRect(39,4,4,16);
  g.fillStyle(0x777777); g.fillRect(37,3,7,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xaa9900); g.fillRect(9,1,22,4);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_bside_step', 44, 60);
}

// ── ENEMY RAIDER DIRECTIONAL SPRITES ─────────────────────────
// All 9 directional walk-frame variants for each of the 3 raider types.
// Called once from buildTextures(); generates 27 textures on the same 26×30 canvas.
function drawRaiderDirectionals(g) {

  // ── BRAWLER variants (dark red, stocky melee tank) ───────────
  g.clear();
  g.fillStyle(0x993322); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x773311); g.fillRect(4, 14, 4, 8); g.fillRect(18, 14, 4, 8);
  g.fillStyle(0xcc8855); g.fillEllipse(13, 7, 12, 10);
  g.fillStyle(0x551111); g.fillRect(6, 2, 14, 5);
  g.fillStyle(0x664422); g.fillRect(5, 23, 5, 7); g.fillRect(16, 25, 5, 5);
  g.generateTexture('raider_brawler_step', 26, 30);

  g.clear();
  g.fillStyle(0x993322); g.fillRect(5, 8, 16, 16);
  g.fillStyle(0x773311); g.fillRect(2, 13, 4, 9); g.fillRect(20, 13, 4, 9);
  g.fillStyle(0x884433); g.fillRect(8, 14, 10, 6);
  g.fillStyle(0xcc8855); g.fillEllipse(13, 7, 12, 10);
  g.fillStyle(0xaa6644); g.fillRect(10, 5, 3, 3); g.fillRect(13, 4, 3, 3);
  g.fillStyle(0x551111); g.fillRect(5, 2, 16, 5);
  g.fillStyle(0x664422); g.fillRect(7, 24, 5, 6); g.fillRect(14, 24, 5, 6);
  g.generateTexture('raider_brawler_front', 26, 30);

  g.clear();
  g.fillStyle(0x993322); g.fillRect(5, 8, 16, 16);
  g.fillStyle(0x773311); g.fillRect(2, 13, 4, 9); g.fillRect(20, 13, 4, 9);
  g.fillStyle(0x884433); g.fillRect(8, 14, 10, 6);
  g.fillStyle(0xcc8855); g.fillEllipse(13, 7, 12, 10);
  g.fillStyle(0xaa6644); g.fillRect(10, 5, 3, 3); g.fillRect(13, 4, 3, 3);
  g.fillStyle(0x551111); g.fillRect(5, 2, 16, 5);
  g.fillStyle(0x664422); g.fillRect(6, 23, 5, 6); g.fillRect(15, 25, 5, 5);
  g.generateTexture('raider_brawler_front_step', 26, 30);

  g.clear();
  g.fillStyle(0x882211); g.fillRect(5, 8, 16, 16);
  g.fillStyle(0x663300); g.fillRect(2, 13, 4, 9); g.fillRect(20, 13, 4, 9);
  g.fillStyle(0x773322); g.fillRect(8, 10, 10, 10);
  g.fillStyle(0x551111); g.fillRect(5, 8, 16, 4);
  g.fillStyle(0x664411); g.fillEllipse(13, 5, 12, 8);
  g.fillStyle(0x664422); g.fillRect(7, 24, 5, 6); g.fillRect(14, 24, 5, 6);
  g.generateTexture('raider_brawler_back', 26, 30);

  g.clear();
  g.fillStyle(0x882211); g.fillRect(5, 8, 16, 16);
  g.fillStyle(0x663300); g.fillRect(2, 13, 4, 9); g.fillRect(20, 13, 4, 9);
  g.fillStyle(0x773322); g.fillRect(8, 10, 10, 10);
  g.fillStyle(0x551111); g.fillRect(5, 8, 16, 4);
  g.fillStyle(0x664411); g.fillEllipse(13, 5, 12, 8);
  g.fillStyle(0x664422); g.fillRect(6, 23, 5, 6); g.fillRect(15, 25, 5, 5);
  g.generateTexture('raider_brawler_back_step', 26, 30);

  g.clear();
  g.fillStyle(0x993322); g.fillRect(5, 8, 15, 16);
  g.fillStyle(0x773311); g.fillRect(3, 14, 3, 8); g.fillRect(19, 13, 4, 9);
  g.fillStyle(0x884433); g.fillRect(7, 13, 8, 6);
  g.fillStyle(0xcc8855); g.fillEllipse(12, 7, 11, 10);
  g.fillStyle(0x551111); g.fillRect(5, 2, 14, 5);
  g.fillStyle(0x664422); g.fillRect(6, 24, 5, 6); g.fillRect(14, 24, 5, 6);
  g.generateTexture('raider_brawler_fside', 26, 30);

  g.clear();
  g.fillStyle(0x993322); g.fillRect(5, 8, 15, 16);
  g.fillStyle(0x773311); g.fillRect(3, 14, 3, 8); g.fillRect(19, 13, 4, 9);
  g.fillStyle(0x884433); g.fillRect(7, 13, 8, 6);
  g.fillStyle(0xcc8855); g.fillEllipse(12, 7, 11, 10);
  g.fillStyle(0x551111); g.fillRect(5, 2, 14, 5);
  g.fillStyle(0x664422); g.fillRect(5, 23, 5, 6); g.fillRect(15, 25, 5, 5);
  g.generateTexture('raider_brawler_fside_step', 26, 30);

  g.clear();
  g.fillStyle(0x882211); g.fillRect(5, 8, 15, 16);
  g.fillStyle(0x663300); g.fillRect(3, 13, 3, 9); g.fillRect(19, 13, 4, 9);
  g.fillStyle(0x773322); g.fillRect(7, 10, 8, 10);
  g.fillStyle(0x664411); g.fillEllipse(12, 5, 11, 8);
  g.fillStyle(0x664422); g.fillRect(6, 24, 5, 6); g.fillRect(14, 24, 5, 6);
  g.generateTexture('raider_brawler_bside', 26, 30);

  g.clear();
  g.fillStyle(0x882211); g.fillRect(5, 8, 15, 16);
  g.fillStyle(0x663300); g.fillRect(3, 13, 3, 9); g.fillRect(19, 13, 4, 9);
  g.fillStyle(0x773322); g.fillRect(7, 10, 8, 10);
  g.fillStyle(0x664411); g.fillEllipse(12, 5, 11, 8);
  g.fillStyle(0x664422); g.fillRect(5, 23, 5, 6); g.fillRect(15, 25, 5, 5);
  g.generateTexture('raider_brawler_bside_step', 26, 30);

  // ── SHOOTER variants (brown coat, slim, gun arm) ─────────────
  g.clear();
  g.fillStyle(0x775533); g.fillRect(7, 8, 12, 16);
  g.fillStyle(0x664422); g.fillRect(5, 14, 4, 7);
  g.fillStyle(0x664422); g.fillRect(17, 13, 6, 4); g.fillStyle(0x444433); g.fillRect(21, 14, 6, 2);
  g.fillStyle(0xcc9966); g.fillEllipse(13, 7, 10, 10);
  g.fillStyle(0x553322); g.fillRect(6, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_step', 26, 30);

  g.clear();
  g.fillStyle(0x775533); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x664422); g.fillRect(3, 13, 4, 8); g.fillRect(19, 13, 4, 8);
  g.fillStyle(0x444433); g.fillRect(20, 14, 6, 2);
  g.fillStyle(0x555544); g.fillRect(20, 15, 3, 4);
  g.fillStyle(0xcc9966); g.fillEllipse(13, 7, 10, 10);
  g.fillStyle(0xaa7744); g.fillRect(10, 5, 2, 3); g.fillRect(13, 4, 3, 3);
  g.fillStyle(0x553322); g.fillRect(7, 24, 4, 6); g.fillRect(15, 24, 4, 6);
  g.generateTexture('raider_shooter_front', 26, 30);

  g.clear();
  g.fillStyle(0x775533); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x664422); g.fillRect(3, 13, 4, 8); g.fillRect(19, 13, 4, 8);
  g.fillStyle(0x444433); g.fillRect(20, 14, 6, 2);
  g.fillStyle(0x555544); g.fillRect(20, 15, 3, 4);
  g.fillStyle(0xcc9966); g.fillEllipse(13, 7, 10, 10);
  g.fillStyle(0xaa7744); g.fillRect(10, 5, 2, 3); g.fillRect(13, 4, 3, 3);
  g.fillStyle(0x553322); g.fillRect(6, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_front_step', 26, 30);

  g.clear();
  g.fillStyle(0x664422); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x553311); g.fillRect(3, 13, 4, 8); g.fillRect(19, 13, 6, 4);
  g.fillStyle(0x444433); g.fillRect(23, 14, 4, 2);
  g.fillStyle(0xaa7744); g.fillEllipse(13, 5, 10, 8);
  g.fillStyle(0x553322); g.fillRect(7, 24, 4, 6); g.fillRect(15, 24, 4, 6);
  g.generateTexture('raider_shooter_back', 26, 30);

  g.clear();
  g.fillStyle(0x664422); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x553311); g.fillRect(3, 13, 4, 8); g.fillRect(19, 13, 6, 4);
  g.fillStyle(0x444433); g.fillRect(23, 14, 4, 2);
  g.fillStyle(0xaa7744); g.fillEllipse(13, 5, 10, 8);
  g.fillStyle(0x553322); g.fillRect(6, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_back_step', 26, 30);

  g.clear();
  g.fillStyle(0x775533); g.fillRect(6, 8, 13, 16);
  g.fillStyle(0x664422); g.fillRect(4, 14, 3, 7);
  g.fillStyle(0x664422); g.fillRect(17, 13, 6, 4); g.fillStyle(0x444433); g.fillRect(21, 14, 5, 2);
  g.fillStyle(0xcc9966); g.fillEllipse(12, 7, 10, 10);
  g.fillStyle(0x553322); g.fillRect(6, 24, 4, 6); g.fillRect(14, 24, 4, 6);
  g.generateTexture('raider_shooter_fside', 26, 30);

  g.clear();
  g.fillStyle(0x775533); g.fillRect(6, 8, 13, 16);
  g.fillStyle(0x664422); g.fillRect(4, 14, 3, 7);
  g.fillStyle(0x664422); g.fillRect(17, 13, 6, 4); g.fillStyle(0x444433); g.fillRect(21, 14, 5, 2);
  g.fillStyle(0xcc9966); g.fillEllipse(12, 7, 10, 10);
  g.fillStyle(0x553322); g.fillRect(5, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_fside_step', 26, 30);

  g.clear();
  g.fillStyle(0x664422); g.fillRect(6, 8, 13, 16);
  g.fillStyle(0x553311); g.fillRect(4, 13, 3, 8); g.fillRect(18, 13, 5, 4);
  g.fillStyle(0x444433); g.fillRect(21, 14, 4, 2);
  g.fillStyle(0xaa7744); g.fillEllipse(12, 5, 10, 8);
  g.fillStyle(0x553322); g.fillRect(6, 24, 4, 6); g.fillRect(14, 24, 4, 6);
  g.generateTexture('raider_shooter_bside', 26, 30);

  g.clear();
  g.fillStyle(0x664422); g.fillRect(6, 8, 13, 16);
  g.fillStyle(0x553311); g.fillRect(4, 13, 3, 8); g.fillRect(18, 13, 5, 4);
  g.fillStyle(0x444433); g.fillRect(21, 14, 4, 2);
  g.fillStyle(0xaa7744); g.fillEllipse(12, 5, 10, 8);
  g.fillStyle(0x553322); g.fillRect(5, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_bside_step', 26, 30);

  // ── HEAVY variants (dark gray, large armored tank) ───────────
  g.clear();
  g.fillStyle(0x445566); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x334455); g.fillRect(2, 13, 4, 10); g.fillRect(20, 13, 4, 10);
  g.fillStyle(0x556677); g.fillRect(4, 7, 18, 6);
  g.fillStyle(0xbbaa88); g.fillEllipse(13, 6, 12, 10);
  g.fillStyle(0x334455); g.fillRect(3, 24, 7, 6); g.fillRect(16, 26, 7, 4);
  g.generateTexture('raider_heavy_step', 26, 30);

  g.clear();
  g.fillStyle(0x445566); g.fillRect(3, 7, 20, 18);
  g.fillStyle(0x334455); g.fillRect(1, 12, 4, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x556677); g.fillRect(3, 7, 20, 7);
  g.fillStyle(0x667788); g.fillRect(7, 10, 12, 6);
  g.fillStyle(0xbbaa88); g.fillEllipse(13, 6, 14, 10);
  g.fillStyle(0x998877); g.fillRect(10, 4, 3, 3); g.fillRect(13, 3, 3, 3);
  g.fillStyle(0x334455); g.fillRect(5, 25, 7, 5); g.fillRect(14, 25, 7, 5);
  g.generateTexture('raider_heavy_front', 26, 30);

  g.clear();
  g.fillStyle(0x445566); g.fillRect(3, 7, 20, 18);
  g.fillStyle(0x334455); g.fillRect(1, 12, 4, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x556677); g.fillRect(3, 7, 20, 7);
  g.fillStyle(0x667788); g.fillRect(7, 10, 12, 6);
  g.fillStyle(0xbbaa88); g.fillEllipse(13, 6, 14, 10);
  g.fillStyle(0x334455); g.fillRect(4, 24, 7, 5); g.fillRect(15, 26, 7, 4);
  g.generateTexture('raider_heavy_front_step', 26, 30);

  g.clear();
  g.fillStyle(0x3a4a55); g.fillRect(3, 7, 20, 18);
  g.fillStyle(0x293545); g.fillRect(1, 12, 4, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x4a5a66); g.fillRect(3, 7, 20, 7);
  g.fillStyle(0x445566); g.fillRect(7, 10, 12, 10);
  g.fillStyle(0xaa9977); g.fillEllipse(13, 5, 14, 8);
  g.fillStyle(0x334455); g.fillRect(5, 25, 7, 5); g.fillRect(14, 25, 7, 5);
  g.generateTexture('raider_heavy_back', 26, 30);

  g.clear();
  g.fillStyle(0x3a4a55); g.fillRect(3, 7, 20, 18);
  g.fillStyle(0x293545); g.fillRect(1, 12, 4, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x4a5a66); g.fillRect(3, 7, 20, 7);
  g.fillStyle(0x445566); g.fillRect(7, 10, 12, 10);
  g.fillStyle(0xaa9977); g.fillEllipse(13, 5, 14, 8);
  g.fillStyle(0x334455); g.fillRect(4, 24, 7, 5); g.fillRect(15, 26, 7, 4);
  g.generateTexture('raider_heavy_back_step', 26, 30);

  g.clear();
  g.fillStyle(0x445566); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x334455); g.fillRect(2, 12, 3, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x556677); g.fillRect(4, 7, 18, 7);
  g.fillStyle(0x667788); g.fillRect(6, 10, 10, 5);
  g.fillStyle(0xbbaa88); g.fillEllipse(12, 6, 13, 10);
  g.fillStyle(0x334455); g.fillRect(5, 25, 7, 5); g.fillRect(14, 25, 7, 5);
  g.generateTexture('raider_heavy_fside', 26, 30);

  g.clear();
  g.fillStyle(0x445566); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x334455); g.fillRect(2, 12, 3, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x556677); g.fillRect(4, 7, 18, 7);
  g.fillStyle(0x667788); g.fillRect(6, 10, 10, 5);
  g.fillStyle(0xbbaa88); g.fillEllipse(12, 6, 13, 10);
  g.fillStyle(0x334455); g.fillRect(4, 24, 7, 5); g.fillRect(15, 26, 7, 4);
  g.generateTexture('raider_heavy_fside_step', 26, 30);

  g.clear();
  g.fillStyle(0x3a4a55); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x293545); g.fillRect(2, 12, 3, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x4a5a66); g.fillRect(4, 7, 18, 7);
  g.fillStyle(0x445566); g.fillRect(6, 10, 10, 10);
  g.fillStyle(0xaa9977); g.fillEllipse(12, 5, 13, 8);
  g.fillStyle(0x334455); g.fillRect(5, 25, 7, 5); g.fillRect(14, 25, 7, 5);
  g.generateTexture('raider_heavy_bside', 26, 30);

  g.clear();
  g.fillStyle(0x3a4a55); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x293545); g.fillRect(2, 12, 3, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x4a5a66); g.fillRect(4, 7, 18, 7);
  g.fillStyle(0x445566); g.fillRect(6, 10, 10, 10);
  g.fillStyle(0xaa9977); g.fillEllipse(12, 5, 13, 8);
  g.fillStyle(0x334455); g.fillRect(4, 24, 7, 5); g.fillRect(15, 26, 7, 4);
  g.generateTexture('raider_heavy_bside_step', 26, 30);
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

    this.add.text(W - 8, H - 8, 'Last updated ' + VERSION, {
      fontFamily:'monospace', fontSize:'10px', color:'#2a3a2a',
    }).setOrigin(1, 1);

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
    // Apply saved audio settings
    const _as = loadSettings();
    if (_as.musicEnabled === false && Music.gain) Music.gain.gain.value = 0;
    SFX._enabled = _as.sfxEnabled !== false;
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

    // ── Audio settings ───────────────────────────────────────
    this.add.text(W/2, 390, 'AUDIO', {
      fontFamily:'monospace', fontSize:'13px', color:'#556655', letterSpacing: 3,
    }).setOrigin(0.5);

    const s = loadSettings();
    const musicOn = s.musicEnabled !== false;
    const sfxOn   = s.sfxEnabled   !== false;
    const fogOn   = s.fogEnabled   !== false;

    const makeToggle = (label, x, y, initial, onToggle) => {
      const opts = [{ key:true, label:'ON' }, { key:false, label:'OFF' }];
      this.add.text(x, y - 20, label, { fontFamily:'monospace', fontSize:'10px', color:'#445544', letterSpacing:2 }).setOrigin(0.5);
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

    makeToggle('MUSIC', W/2 - 200, 445, musicOn, (v) => {
      saveSettings({ musicEnabled: v });
      if (Music.gain) Music.gain.gain.value = v ? 0.07 : 0;
    });
    makeToggle('SFX', W/2, 445, sfxOn, (v) => {
      saveSettings({ sfxEnabled: v });
      SFX._enabled = v;
    });

    // ── Gameplay settings ────────────────────────────────────
    this.add.text(W/2, 506, 'GAMEPLAY', {
      fontFamily:'monospace', fontSize:'13px', color:'#556655', letterSpacing: 3,
    }).setOrigin(0.5);

    makeToggle('FOG OF WAR', W/2 - 200, 560, fogOn, (v) => {
      saveSettings({ fogEnabled: v });
    });
    makeToggle('MINIMAP', W/2, 560, s.minimapEnabled !== false, (v) => {
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
    this.add.text(W/2, 606, 'TUTORIAL TIPS', {
      fontFamily:'monospace', fontSize:'11px', color:'#445544', letterSpacing: 3,
    }).setOrigin(0.5);

    const tutEnabled = loadSettings().tutorial !== false; // default ON
    this._tutSel = tutEnabled;
    const tutOpts = [
      { key: true,  label: 'ON',  sub: 'Tips appear at top of screen during first game' },
      { key: false, label: 'OFF', sub: 'No tutorial tips — for experienced players' },
    ];
    this._tutBoxes = tutOpts.map((o, i) => {
      const x = W/2 + (i === 0 ? -140 : 140), y = 648;
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

    // ── Back button ──────────────────────────────────────────
    const backBtn = this.add.text(W/2, H - 22, '[ BACK TO MAIN MENU ]', {
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

    const cardW = Math.round(252 * S), cardH = Math.round(370 * S);
    const gap = Math.round(18 * S);
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

    // Pause state
    this._paused = false;
    this._pauseOverlay = null;

    // Contextual tutorial hint flags (each fires once)
    this._ctx = {
      nearTree: false, firstHarvest: false, firstCraft: false,
      firstNight: false, firstUpgradeHint: false,
    };

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
    this.spikeTraps = [];      // D7 spike traps

    // D1 — Craft menu state
    this.craftMenuOpen = false;
    this.craftMenuOwner = null;
    this.craftMenuSel = 0;
    this.craftMenuGfx = null;

    // Show loading indicator on the black screen — iOS PWA needs at least one yielded
    // frame before heavy synchronous work, otherwise WKWebView may not render at all.
    const _loadTxt = this.add.text(CFG.W / 2, CFG.H / 2, 'Building world...', {
      fontFamily: 'monospace', fontSize: '16px', color: '#555555'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(999);

    this.time.delayedCall(64, () => {
      if (_loadTxt.active) _loadTxt.destroy();
      this.cameras.main.fadeIn(600, 0, 0, 0);
      this.physics.world.setBounds(0, 0, worldW, worldH);

      this._initBiomeSeeds();
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
            this.time.delayedCall(150, () => {
              if (!this.p1.spr?.active) return;
              if (this.p1._frostSlowed) this.p1.spr.setTint(0x88ccff);
              else this.p1.spr.clearTint();
            });
          }
        });
        if (this.p2) {
          this.physics.add.overlap(this.p2.spr, pool, () => {
            if (!this._toxicCd2 || this._toxicCd2 <= 0) {
              this.p2.hp = Math.max(0, this.p2.hp - 3);
              this._toxicCd2 = 500;
              this.p2.spr.setTint(0x44ff22);
              this.time.delayedCall(150, () => {
                if (!this.p2.spr?.active) return;
                if (this.p2._frostSlowed) this.p2.spr.setTint(0x88ccff);
                else this.p2.spr.clearTint();
              });
            }
          });
        }
      });
    }

    // Shallow water — flags player as in water each frame while overlapping
    if (this.waterTiles && this.waterTiles.length) {
      this.waterTiles.forEach(t => {
        this.physics.add.overlap(this.p1.spr, t, () => { this.p1._inShallowWater = true; });
        if (this.p2) this.physics.add.overlap(this.p2.spr, t, () => { this.p2._inShallowWater = true; });
      });
    }
    // Ice tiles — flags player for slippery momentum physics
    if (this.iceTiles && this.iceTiles.length) {
      this.iceTiles.forEach(t => {
        this.physics.add.overlap(this.p1.spr, t, () => { this.p1._onIce = true; });
        if (this.p2) this.physics.add.overlap(this.p2.spr, t, () => { this.p2._onIce = true; });
      });
    }

    // Input
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.wasd    = this.input.keyboard.addKeys({ up:K.W, down:K.S, left:K.A, right:K.D });
    this.cursors = this.input.keyboard.createCursorKeys();
    this.hotkeys = this.input.keyboard.addKeys({ p1use:K.E, p2use:K.ENTER, tab:K.TAB, esc:K.ESC });

    this.hotkeys.p1use.on('down', () => { if (!this.barrackOpen && !this.isOver) this.tryInteract(this.p1); });
    if (this.p2) this.hotkeys.p2use.on('down', () => { if (!this.barrackOpen && !this.isOver) this.tryInteract(this.p2); });
    this.hotkeys.tab.on('down', () => { if (!this.barrackOpen && !this.craftMenuOpen && !this.isOver) this.togglePause(); });
    this.hotkeys.esc.on('down', () => {
      this.closeBarrack();
      if (this._paused) { this.togglePause(); return; }
      if (this.controlsVis) this.toggleControls();
    });

    // Backtick/grave (`) toggles the debug event log
    this.input.keyboard.addKey(192).on('down', () => {
      this._dbgVisible = !this._dbgVisible;
      if (this._dbgTxt) {
        this._dbgTxt.setVisible(this._dbgVisible);
        if (this._dbgVisible) {
          const lines = (this._dbgEntries && this._dbgEntries.length > 0)
            ? ['── debug log ──', ...this._dbgEntries]
            : ['── debug log (no events yet) ──'];
          this._dbgTxt.setText(lines.join('\n'));
        }
      }
    });

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
    this.atkKeys.p1atk.on('down', () => {
      if (!this.barrackOpen && !this.isOver && !this.p1.isDowned && !this.p1.isSleeping) {
        if (this.craftMenuOpen && this.craftMenuOwner === this.p1) { this.craftSelected(); return; }
        if (this.buildMode && this.buildOwner === this.p1) this.placeBuild();
        else this.doAttack(this.p1);
      }
    });
    this.atkKeys.p1alt.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p1.isDowned && !this.p1.isSleeping) this.doAlt(this.p1); });
    this.atkKeys.p1build.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p1.isDowned && !this.p1.isSleeping) this.openCraftMenu(this.p1); });
    if (this.p2) {
      this.atkKeys.p2atk.on('down', () => {
        if (!this.barrackOpen && !this.isOver && !this.p2.isDowned && !this.p2.isSleeping) {
          if (this.craftMenuOpen && this.craftMenuOwner === this.p2) { this.craftSelected(); return; }
          if (this.buildMode && this.buildOwner === this.p2) this.placeBuild();
          else this.doAttack(this.p2);
        }
      });
      this.atkKeys.p2alt.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p2.isDowned && !this.p2.isSleeping) this.doAlt(this.p2); });
      this.atkKeys.p2build.on('down', () => { if (!this.barrackOpen && !this.isOver && !this.p2.isDowned && !this.p2.isSleeping) this.openCraftMenu(this.p2); });
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

    // Tutorial sequence — starts after startup controls dismiss (~9 s)
    this.time.delayedCall(9200, () => this.startTutorial());

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

  // Scatter Voronoi biome seeds randomly — called once before buildWorld each session
  _initBiomeSeeds() {
    const biomes = ['waste', 'swamp', 'tundra', 'ruins', 'fungal', 'desert'];
    const seedsPerBiome = 3; // multiple seeds → more irregular, organic shapes
    _biomeSeeds = [];
    const cx = CFG.MAP_W / 2, cy = CFG.MAP_H / 2;
    biomes.forEach(biome => {
      for (let i = 0; i < seedsPerBiome; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = CFG.MAP_W * Phaser.Math.FloatBetween(0.25, 0.48);
        _biomeSeeds.push({
          biome,
          tx: cx + Math.cos(angle) * dist,
          ty: cy + Math.sin(angle) * dist,
        });
      }
    });
  }

  // ── WORLD ──────────────────────────────────────────────────
  buildWorld(worldW, worldH, cx, cy) {
    const { TILE, SAFE_R } = CFG;
    const stx = cx/TILE, sty = cy/TILE;

    // Biome ground map — key for each tile
    const groundTexMap = { grass:'grass', waste:'ground_waste', swamp:'ground_swamp', tundra:'ground_tundra', ruins:'ground_ruins', fungal:'ground_fungal', desert:'ground_desert' };

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

    // Tall grass — biome-specific decorative blades (depth 4 = below player, above ground)
    const tallGrassMap = { grass:'tall_grass', waste:'tall_grass_waste', tundra:'tall_grass_tundra', swamp:'tall_grass_swamp' };
    for (let i = 0; i < 600; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-3), ty = Phaser.Math.Between(2, CFG.MAP_H-3);
      if (Math.abs(tx-stx) < SAFE_R+3 && Math.abs(ty-sty) < SAFE_R+3) continue;
      const biome = getBiome(tx, ty);
      const key = tallGrassMap[biome];
      if (!key) continue; // ruins gets no tall grass
      const sc = Phaser.Math.FloatBetween(0.7, 1.3);
      const ox = Phaser.Math.Between(-10, 10), oy = Phaser.Math.Between(-8, 8);
      this._w(this.add.image(tx*TILE+ox, ty*TILE+oy, key)
        .setOrigin(0.5, 1).setScale(sc).setDepth(4 + ty*0.001).setAlpha(0.82));
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
    this.waterTiles = [];     // shallow water — overlap (slow)
    this.deepWaterTiles = []; // deep water — obstacles (impassable)
    this.iceTiles = [];       // frozen water — overlap (slippery)
    this._iceTileSet = new Set(); // O(1) lookup for ice_crawler AI

    // Trees — dense forest clusters, biome-appropriate, non-overlapping
    const treesPlaced = [];
    const placeTree = (tx, ty, biome) => {
      if (tx < 2 || tx > CFG.MAP_W-2 || ty < 2 || ty > CFG.MAP_H-2) return;
      if (Math.abs(tx-stx) < SAFE_R+3 && Math.abs(ty-sty) < SAFE_R+3) return;
      if (treesPlaced.some(p => Math.abs(p.tx-tx) <= 1 && Math.abs(p.ty-ty) <= 1)) return;
      let treeKey = 'tree';
      if (biome === 'waste') treeKey = 'tree_dead';
      else if (biome === 'tundra') treeKey = 'tree_snow';
      else if (biome === 'ruins' && Math.random() < 0.5) treeKey = 'tree_dead';
      else if (biome === 'swamp') treeKey = Math.random() < 0.55 ? 'tree_swamp' : 'tree';
      else if (biome === 'fungal') treeKey = 'tree_mushroom';
      else if (biome === 'desert') { if (Math.random() < 0.4) treeKey = 'tree_cactus'; else return; } // desert sparse
      const sc = Phaser.Math.FloatBetween(1.6, 2.8);
      const t = this.obstacles.create(tx*TILE+14, ty*TILE+18, treeKey);
      t.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      // Trunk-only hitbox: 8px wide × 12px tall at the base of the sprite (28×36)
      t.body.setSize(8, 12).setOffset(10, 24);
      t.refreshBody();
      t.isTree = true;
      treesPlaced.push({ tx, ty });
    };

    // 55 forest clusters — each is a tight pack of 28-45 trees (scaled for 400×400 map)
    for (let f = 0; f < 55; f++) {
      let cx, cy, attempts = 0;
      do {
        cx = Phaser.Math.Between(18, CFG.MAP_W-18);
        cy = Phaser.Math.Between(18, CFG.MAP_H-18);
        attempts++;
      } while (attempts < 40 && (Math.abs(cx-stx) < SAFE_R+20 && Math.abs(cy-sty) < SAFE_R+20));
      const biome = getBiome(cx, cy);
      const radius = Phaser.Math.Between(6, 11); // larger radius clusters
      const count  = Phaser.Math.Between(28, 45); // denser clusters
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist  = Math.sqrt(Math.random()) * radius; // sqrt = uniform density
        placeTree(Math.round(cx + Math.cos(angle)*dist), Math.round(cy + Math.sin(angle)*dist), biome);
      }
    }

    // Scattered fringe trees outside clusters (sparse woodland, not in clusters)
    for (let i = 0; i < 180; i++) {
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
      const biome = getBiome(tx, ty);
      const rockKey = biome === 'tundra' ? 'ice_rock' : biome === 'desert' ? 'rock_desert' : 'rock';
      const sc = Phaser.Math.FloatBetween(0.4, 3.5);
      const r = this.obstacles.create(tx*TILE+11, ty*TILE+8, rockKey);
      r.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      // Tighter oval hitbox (rock sprite is 22×16, use ~65% size)
      r.body.setCircle(6, 5, 2);
      r.refreshBody();
    }

    // Extra rocks in wasteland
    for (let i = 0; i < 180; i++) {
      const tx = Phaser.Math.Between(1, CFG.MAP_W-2), ty = Phaser.Math.Between(1, CFG.MAP_H-2);
      if (getBiome(tx, ty) !== 'waste') continue;
      const sc = Phaser.Math.FloatBetween(0.3, 2.0);
      const r = this.obstacles.create(tx*TILE+11, ty*TILE+8, 'rock');
      r.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      r.body.setCircle(6, 5, 2);
      r.refreshBody();
    }

    // ── BIOME-SPECIFIC TERRAIN OBSTACLES ────────────────────────
    // Ice spires — tundra (impassable jagged ice formations)
    for (let i = 0; i < 80; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-2), ty = Phaser.Math.Between(2, CFG.MAP_H-2);
      if (getBiome(tx, ty) !== 'tundra') continue;
      if (Math.abs(tx-stx)<SAFE_R+3 && Math.abs(ty-sty)<SAFE_R+3) continue;
      const sc = Phaser.Math.FloatBetween(1.2, 2.2);
      const spr = this.obstacles.create(tx*TILE+8, ty*TILE+6, 'ice_spire');
      spr.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      spr.body.setSize(6, 8).setOffset(5, 22);
      spr.refreshBody();
    }
    // Rock spires — wasteland (impassable jagged rock pillars)
    for (let i = 0; i < 80; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-2), ty = Phaser.Math.Between(2, CFG.MAP_H-2);
      if (getBiome(tx, ty) !== 'waste') continue;
      if (Math.abs(tx-stx)<SAFE_R+3 && Math.abs(ty-sty)<SAFE_R+3) continue;
      const sc = Phaser.Math.FloatBetween(1.2, 2.0);
      const spr = this.obstacles.create(tx*TILE+7, ty*TILE+8, 'rock_spire');
      spr.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      spr.body.setSize(6, 8).setOffset(4, 26);
      spr.refreshBody();
    }
    // Mangrove root clusters — swamp (impassable tangled roots)
    for (let i = 0; i < 55; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-2), ty = Phaser.Math.Between(2, CFG.MAP_H-2);
      if (getBiome(tx, ty) !== 'swamp') continue;
      if (Math.abs(tx-stx)<SAFE_R+4 && Math.abs(ty-sty)<SAFE_R+4) continue;
      const sc = Phaser.Math.FloatBetween(1.0, 1.8);
      const spr = this.obstacles.create(tx*TILE+18, ty*TILE+9, 'mangrove_roots');
      spr.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      spr.body.setSize(28, 8).setOffset(4, 6);
      spr.refreshBody();
    }
    // Spiderwebs — ruins (decorative, visual only)
    for (let i = 0; i < 90; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-2), ty = Phaser.Math.Between(2, CFG.MAP_H-2);
      if (getBiome(tx, ty) !== 'ruins') continue;
      if (Math.abs(tx-stx)<SAFE_R+3 && Math.abs(ty-sty)<SAFE_R+3) continue;
      const sc = Phaser.Math.FloatBetween(0.9, 2.2);
      this._w(this.add.image(tx*TILE, ty*TILE, 'spiderweb').setScale(sc).setDepth(3).setAlpha(0.65));
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

    // Toxic pools in swamp biome — large murky water tiles, clustered for density
    for (let i = 0; i < 200; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-3), ty = Phaser.Math.Between(2, CFG.MAP_H-3);
      if (getBiome(tx, ty) !== 'swamp') continue;
      if (Math.abs(tx-stx)<SAFE_R+5 && Math.abs(ty-sty)<SAFE_R+5) continue;
      const sc = Phaser.Math.FloatBetween(0.8, 2.2);
      const pool = this.physics.add.image(tx*TILE + Phaser.Math.Between(-8,8), ty*TILE + Phaser.Math.Between(-8,8), 'toxic_pool')
        .setScale(sc).setDepth(2).setAlpha(0.9);
      pool.body.allowGravity = false; pool.body.setImmovable(true);
      // Physics body scales with sprite size
      pool.body.setSize(Math.round(40 * sc), Math.round(28 * sc));
      if (this.hudCam) this.hudCam.ignore(pool);
      this._w(pool);
      this.toxicPools.push(pool);
    }

    // Water ponds — swamp/tundra/fungal/grass (shallow+deep or ice)
    this._buildPonds(stx, sty);

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
      const CLEAR_R = 160;
      const ROCK_KEYS = new Set(['rock', 'rock2', 'ice_rock', 'rock_desert', 'ice_spire', 'rock_spire', 'mangrove_roots']);
      this.obstacles.getChildren().slice().forEach(ob => {
        const k = ob.texture && ob.texture.key;
        if (k === 'mountain' || k === 'mountain2') return;
        if (!ob.isTree && !ROCK_KEYS.has(k)) return; // keep structure walls, ruin blocks, etc.
        const obR = (ob.displayWidth || 32) / 2;
        for (const pos of this._preCacheTiles) {
          const dx = ob.x - pos.tx * TILE, dy = ob.y - pos.ty * TILE;
          if (dx * dx + dy * dy < (CLEAR_R + obR) * (CLEAR_R + obR)) { ob.destroy(); break; }
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
      // Drop valuable crates near supply cache — more items the further from center
      const distFromCenter = Math.sqrt(Math.pow(pos.tx - CFG.MAP_W/2, 2) + Math.pow(pos.ty - CFG.MAP_H/2, 2));
      const lootCount = distFromCenter > 70 ? 5 : distFromCenter > 45 ? 4 : 3;
      const rareItems = distFromCenter > 70
        ? ['item_ammo','item_ammo','item_metal','item_metal','item_fiber']
        : ['item_ammo','item_metal','item_food'];
      for (let j = 0; j < lootCount; j++) {
        const dx = px + Phaser.Math.Between(-40, 40), dy = py + Phaser.Math.Between(-40, 40);
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
      this._addFireGlow(px, py);
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
      w.hp = 200; w.maxHp = 200;
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

    // Torch sconces on building exteriors — one per block on a street-facing wall
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const bx = cl + col * (blockW + streetW);
        const by = ct + row * (blockH + streetH);
        // N or S wall torch (30% chance per block)
        if (Math.random() < 0.30) {
          const side = Math.random() < 0.5 ? 'N' : 'S';
          const wx = (bx + Math.floor(blockW / 2)) * TILE;
          const wy = side === 'N' ? by * TILE : (by + blockH - 1) * TILE;
          this._spawnTorch(wx, wy);
        }
        // E or W wall torch (10% chance per block)
        if (Math.random() < 0.10) {
          const side = Math.random() < 0.5 ? 'W' : 'E';
          const wx = side === 'W' ? bx * TILE : (bx + blockW - 1) * TILE;
          const wy = (by + Math.floor(blockH / 2)) * TILE;
          this._spawnTorch(wx, wy);
        }
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
      { biome: 'grass',  wallKey: 'plank_wall',    floorKey: 'plank_floor',     label: 'FARMHOUSE'    },
      { biome: 'tundra', wallKey: 'ruin_block',    floorKey: 'ice_floor',       label: 'OUTPOST'      },
      { biome: 'swamp',  wallKey: 'rot_plank',     floorKey: 'rot_plank_floor', label: 'SHACK'        },
      { biome: 'waste',  wallKey: 'metal_wall',    floorKey: 'metal_floor',     label: 'BUNKER'       },
      { biome: 'fungal', wallKey: 'fungal_wall',   floorKey: 'fungal_floor',    label: 'SPORE SHRINE' },
      { biome: 'desert', wallKey: 'sandstone_wall',floorKey: 'sandstone_floor', label: 'DESERT OUTPOST'},
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
    if (loadSettings().fogEnabled === false) { this.fogGfx.clear(); return; }
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
    const spr = this._w(this.physics.add.sprite(x, y, charData.id).setScale(1.5).setDepth(10));
    spr.setCollideWorldBounds(true);
    spr.body.setSize(20, 24).setOffset(12, 30);

    const lbl = this._w(this.add.text(x, y-50, charData.player, {
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
    const mmX = W - mmW - 10, mmY = 96; // top-right so it doesn't overlap P2 inventory
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

    // ── DEBUG LOG (toggle with backtick `) ──────────────────────
    this._dbgEntries = [];
    this._dbgVisible = false;
    this._dbgTxt = this._h(this.add.text(8, 28, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#00ff88',
      stroke: '#000', strokeThickness: 1,
      backgroundColor: '#00000099',
      padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(500).setVisible(false));
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
    if (loadSettings().minimapEnabled === false) {
      this.minimapGfx && this.minimapGfx.setVisible(false);
      this.minimapDots.setVisible(false);
      return;
    }
    this.minimapGfx && this.minimapGfx.setVisible(true);
    this.minimapDots.setVisible(true);
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

    // 2P Survival: if partner is already dead or also downed, no one to revive — game over
    const partner = player === this.p1 ? this.p2 : this.p1;
    if (partner && partner.isPermanentlyDead) {
      this.triggerGameOver('Both survivors have fallen.');
      return;
    }
    if (partner && partner.isDowned) {
      this.triggerGameOver('Both survivors are down!');
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
        // Hide HUD elements specific to this player so nothing lingers
        const key = p === this.p1 ? 'p1' : 'p2';
        if (key === 'p1') {
          if (this.p1Badge) this.p1Badge.setVisible(false);
          if (this.p1InvText) this.p1InvText.setVisible(false);
        } else {
          if (this.p2Badge) this.p2Badge.setVisible(false);
          if (this.p2InvText) this.p2InvText.setVisible(false);
        }
        if (this.ammoIcons[key]) this.ammoIcons[key].forEach(ic => ic.setVisible(false));
        if (this.ammoReserveText && this.ammoReserveText[key]) this.ammoReserveText[key].setVisible(false);
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
    if (!player || !player.isDowned) return; // guard: timer may have expired same frame
    player.isDowned = false;
    player.hp = Math.floor(player.maxHp * 0.3);
    player.downTimer = 0;
    if (player._frostSlowed) player.spr.setTint(0x88ccff);
    else player.spr.clearTint();
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
    // Close controls overlay if it was open when game ended
    if (this.controlsVis && this.ctrlObjs) {
      this.ctrlObjs.forEach(o => o.setVisible(false));
      this.controlsVis = false;
    }

    this.p1.spr.setVelocity(0, 0);
    if (this.p2) this.p2.spr.setVelocity(0, 0);

    Music.stop();
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
        p2Name: (this.p2 && !this.p2.isPermanentlyDead) ? this.p2.charData.player : null,
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
    push(this.add.graphics().setDepth(94)).fillStyle(0x000000, 0.75).fillRect(0, 0, W, H);

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

  togglePause() {
    this._paused = !this._paused;
    if (this._paused) {
      this.physics.world.pause();
      if (!this._pauseOverlay) {
        const { W, H } = CFG;
        const g = this.add.graphics().setScrollFactor(0).setDepth(200);
        g.fillStyle(0x000000, 0.55);
        g.fillRect(0, 0, W, H);
        const t = this.add.text(W/2, H/2, 'PAUSED', {
          fontFamily: 'monospace', fontSize: '36px', color: '#ffffff',
          stroke: '#000', strokeThickness: 4,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(201);
        const sub = this.add.text(W/2, H/2 + 44, 'Press TAB to resume', {
          fontFamily: 'monospace', fontSize: '14px', color: '#aaaaaa',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(201);
        this._pauseOverlay = [g, t, sub];
        this._pauseOverlay.forEach(o => this._h(o));
      }
      this._pauseOverlay.forEach(o => o.setVisible(true));
    } else {
      this.physics.world.resume();
      if (this._pauseOverlay) this._pauseOverlay.forEach(o => o.setVisible(false));
    }
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
      const spr    = push(this.add.image(x, y-52, ch.id).setScale(2.5).setDepth(212));
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

    // Raid camp loot cache — only interactable after all raiders are killed
    if (this.raidCamp && this.raidCamp.cache && !this.raidCamp.cache.locked && !this.raidCamp.cache.opened) {
      const cache = this.raidCamp.cache;
      const cd = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, cache.x, cache.y);
      if (cd < 70) { this.openRaidCache(cache); return; }
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

      // Check for nearby enemies — warn but still allow sleep
      const nearEnemy = this.enemies && this.enemies.some(e =>
        !e.dying && Phaser.Math.Distance.Between(player.spr.x, player.spr.y, e.spr.x, e.spr.y) < 200
      );

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

      // Context-aware hint with vulnerability warning
      const vulnWarn = nearEnemy
        ? ' \u26a0 ENEMIES NEARBY \u2014 you will be woken!'
        : ' Enemies will wake you.';
      if (this.isNight) {
        const skipNote = this.solo ? 'Night fast-forwarding to dawn!' : 'Both asleep = night speeds up!';
        this.hint(player.charData.player + ' sleeping \u2014 ' + skipNote + '\n(+8 HP/tick)' + vulnWarn, 4500);
      } else {
        this.hint(player.charData.player + ' resting\u2026 (+8 HP/tick)  Sleep at night to skip to dawn.' + vulnWarn, 3800);
      }
    }
  }

  wakePlayer(player) {
    if (!player.isSleeping) return;
    player.isSleeping = false;
    if (player._frostSlowed) player.spr.setTint(0x88ccff);
    else player.spr.clearTint();
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
      this._hideSleepIndicator();
      sleeping.forEach(p => {
        this.wakePlayer(p);
        this.hint(p.charData.player + ' wakes up refreshed! (+HP restored)', 2500);
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
        // Show fast-forward HUD indicator
        this._showSleepIndicator();
      }
    } else {
      if (this.sleepSpeedMult === 8) this._hideSleepIndicator();
      this.sleepSpeedMult = 1;
    }
  }

  _showSleepIndicator() {
    if (this._sleepIndicator && this._sleepIndicator.active) return;
    const W = this.scale.width;
    this._sleepIndicator = this._h(this.add.text(W / 2, 52, '\u23e9  NIGHT SKIP  \u23e9', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ccaaff',
      backgroundColor: '#1a0033', padding: { x: 10, y: 4 },
    }).setOrigin(0.5, 0).setDepth(300).setScrollFactor(0).setAlpha(0));
    this.tweens.add({ targets: this._sleepIndicator, alpha: 0.9, duration: 400, ease: 'Sine.Out' });
    // Pulse the text while active
    this.tweens.add({ targets: this._sleepIndicator, alpha: 0.5, duration: 700,
      yoyo: true, loop: -1, delay: 400, ease: 'Sine.InOut' });
  }

  _hideSleepIndicator() {
    if (!this._sleepIndicator || !this._sleepIndicator.active) return;
    const ind = this._sleepIndicator;
    this._sleepIndicator = null;
    this.tweens.add({ targets: ind, alpha: 0, duration: 600, ease: 'Sine.In',
      onComplete: () => { if (ind.active) ind.destroy(); } });
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
    if (newCh.id==='gunslinger') { player.ammo = 8; player.reserveAmmo = 32; }

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
    // Cancel orphaned delayedCall from the previous hint (killTweensOf won't reach it)
    if (this._hintTimer) { this._hintTimer.remove(false); this._hintTimer = null; }
    const minDur = 3500;
    duration = Math.max(duration, minDur);
    const h = this.add.text(CFG.W/2, 112, text, {
      fontFamily:'monospace', fontSize:'17px', color:'#ffffff',
      stroke:'#000', strokeThickness:4, backgroundColor:'#000000bb', padding:{x:16,y:9},
    }).setOrigin(0.5).setDepth(160).setAlpha(0);
    this.cameras.main.ignore(h);
    this._activeHint = h;
    this.tweens.add({ targets:h, alpha:1, duration:280,
      onComplete:() => {
        this._hintTimer = this.time.delayedCall(duration, () => {
          this._hintTimer = null;
          this.tweens.add({ targets:h, alpha:0, duration:450,
            onComplete:() => { if (h === this._activeHint) this._activeHint = null; h.destroy(); }
          });
        });
      }
    });
  }

  // ── TUTORIAL ─────────────────────────────────────────────────
  // A sequence of non-blocking tip banners at the top of the screen.
  // Each auto-advances after 5 s; clicking the banner or pressing TAB skips to next;
  // the SKIP button dismisses all. Disabled if settings.tutorial === false.
  startTutorial() {
    if (loadSettings().tutorial === false) return;

    const STEPS = [
      { title: 'MOVE',          text: 'P1: WASD to move.  P2: Arrow keys.  Explore each biome — grassland, wasteland, swamp, tundra, ruins.' },
      { title: 'ATTACK',        text: 'P1: F to attack.  P2: / (slash).  In 1-player mode, aim with the mouse and left-click to shoot.' },
      { title: 'GATHER',        text: 'Hold E (P1) or Enter (P2) near a tree to harvest wood.  Open crates for metal, fiber, ammo, and food.' },
      { title: 'CRAFT & BUILD', text: 'Press Q (P1) or 0 (P2) to open the Crafting Menu.  Build walls, campfires, spike traps, and more.' },
      { title: 'SURVIVE NIGHT', text: 'Enemies are stronger after dark.  Build a Bed (needs Craftbench) and sleep to fast-forward the night.' },
      { title: 'SUPPLY CACHES', text: 'Each biome hides a Supply Cache — rare loot but guarded by enemies.  Check your minimap!' },
      { title: 'MINIMAP',       text: 'Top-right minimap shows biome edges, enemies (red dots), and points of interest.  Stay aware!' },
    ];

    this._tutActive = true;
    this._tutStep = 0;
    this._tutObjs = [];
    this._tutTimer = null;
    this._showTutStep(STEPS);
  }

  _showTutStep(STEPS) {
    if (!this._tutActive || this._tutStep >= STEPS.length) { this._endTutorial(); return; }
    const step = STEPS[this._tutStep];
    const { W } = CFG;
    const PW = 680, PH = 72, PX = (W - PW) / 2, PY = 6;

    this._clearTutObjs();

    const push = o => { this._tutObjs.push(o); this._h(o); return o; };

    // Translucent panel background
    const bg = push(this.add.graphics().setDepth(170).setAlpha(0));
    bg.fillStyle(0x050d05, 0.82);
    bg.fillRoundedRect(PX, PY, PW, PH, 7);
    bg.lineStyle(1, 0x3a6630, 0.65);
    bg.strokeRoundedRect(PX, PY, PW, PH, 7);

    // Step counter
    push(this.add.text(PX + 14, PY + 7, 'TUTORIAL  ' + (this._tutStep + 1) + ' / ' + STEPS.length, {
      fontFamily:'monospace', fontSize:'9px', color:'#5a7a4a', stroke:'#000', strokeThickness:1,
    }).setDepth(171).setAlpha(0));

    // Title
    push(this.add.text(PX + 14, PY + 20, step.title, {
      fontFamily:'monospace', fontSize:'13px', color:'#aadd88',
      stroke:'#000', strokeThickness:2,
    }).setDepth(171).setAlpha(0));

    // Body text
    push(this.add.text(PX + 14, PY + 40, step.text, {
      fontFamily:'monospace', fontSize:'11px', color:'#ccdfc8',
      stroke:'#000', strokeThickness:2,
    }).setDepth(171).setAlpha(0));

    // Progress dots (bottom-right area of panel)
    for (let i = 0; i < STEPS.length; i++) {
      const dx = PX + PW - 14 - (STEPS.length - 1 - i) * 11;
      const dotG = push(this.add.graphics().setDepth(171).setAlpha(0));
      dotG.fillStyle(i === this._tutStep ? 0x88cc66 : 0x3a5a2a, i === this._tutStep ? 1 : 0.7);
      dotG.fillCircle(dx, PY + PH - 11, i === this._tutStep ? 4 : 2.5);
    }

    // SKIP button
    const skipBtn = push(this.add.text(PX + PW - 10, PY + 7, '[ SKIP ALL ]', {
      fontFamily:'monospace', fontSize:'9px', color:'#667755', stroke:'#000', strokeThickness:1,
    }).setOrigin(1, 0).setDepth(172).setAlpha(0).setInteractive({ useHandCursor: true }));
    skipBtn.on('pointerover', () => skipBtn.setStyle({ color:'#aaddaa' }));
    skipBtn.on('pointerout',  () => skipBtn.setStyle({ color:'#667755' }));
    skipBtn.on('pointerdown', (ptr) => { ptr.event.stopPropagation(); this._endTutorial(); });

    // Tap-banner-to-advance (click anywhere on the panel area)
    const hitZone = push(this.add.zone(PX, PY, PW, PH).setOrigin(0).setDepth(173).setInteractive({ useHandCursor: true }));
    hitZone.on('pointerdown', () => { this._tutStep++; this._showTutStep(STEPS); });

    // Fade in all objects
    const fadeTargets = this._tutObjs.filter(o => o.setAlpha && o !== hitZone);
    this.tweens.add({ targets: fadeTargets, alpha: 1, duration: 300 });

    // Auto-advance after 5 seconds
    this._tutTimer = this.time.delayedCall(5000, () => { this._tutStep++; this._showTutStep(STEPS); });
  }

  _clearTutObjs() {
    if (this._tutTimer) { this._tutTimer.remove(); this._tutTimer = null; }
    if (this._tutObjs && this._tutObjs.length) {
      const tgts = this._tutObjs.filter(o => o.active);
      if (tgts.length) {
        this.tweens.add({ targets: tgts, alpha: 0, duration: 250,
          onComplete: () => tgts.forEach(o => { if (o.active) o.destroy(); }) });
      }
      this._tutObjs = [];
    }
  }

  _endTutorial() {
    this._tutActive = false;
    this._clearTutObjs();
  }

  // ── UPDATE ────────────────────────────────────────────────────
  update(time, delta) {
    if (!this._worldReady) return; // deferred world init not yet complete
    if (this.isOver) return;
    if (this._paused) return;

    // Reset per-frame water/ice flags — overlap callbacks re-set them while active
    if (this.p1) { this.p1._inShallowWater = false; this.p1._onIce = false; }
    if (this.p2) { this.p2._inShallowWater = false; this.p2._onIce = false; }

    if (this.controlsVis || this.barrackOpen) {
      this.p1.spr.setVelocity(0,0);
      if (this.p2) this.p2.spr.setVelocity(0,0);
      return;
    }

    this.timeAlive += delta / 1000;

    // Movement — skip if downed, sleeping, or owns the open craft menu
    const p1CraftHalt = this.craftMenuOpen && this.craftMenuOwner === this.p1;
    if (!this.p1.isDowned && !this.p1.isSleeping && !p1CraftHalt) {
      if (this._touchActive) {
        this.applyTouchInput();  // touch: joystick drives movement + facing
      } else {
        this.movePlayer(this.p1, this.wasd.left, this.wasd.right, this.wasd.up, this.wasd.down);
        if (this.solo) this.aimAtMouse(this.p1); // 1P: mouse aims
      }
    }
    else this.p1.spr.setVelocity(0,0);

    if (this.p2) {
      const p2CraftHalt = this.craftMenuOpen && this.craftMenuOwner === this.p2;
      if (!this.p2.isDowned && !this.p2.isSleeping && !p2CraftHalt) this.movePlayer(this.p2, this.cursors.left, this.cursors.right, this.cursors.up, this.cursors.down);
      else this.p2.spr.setVelocity(0,0);
    }

    // Tick attack cooldowns
    const tickCd = p => { if (p && p.atkCooldown > 0) p.atkCooldown -= delta; };
    tickCd(this.p1); tickCd(this.p2);

    // Toxic pool cooldown ticking
    if (this._toxicCd1 > 0) this._toxicCd1 -= delta;
    if (this._toxicCd2 > 0) this._toxicCd2 -= delta;

    // Web slow cooldown ticking
    if (this.p1 && (this.p1._webSlowCd || 0) > 0) this.p1._webSlowCd = Math.max(0, this.p1._webSlowCd - delta);
    if (this.p2 && (this.p2._webSlowCd || 0) > 0) this.p2._webSlowCd = Math.max(0, this.p2._webSlowCd - delta);

    // Tundra slowdown effect
    this.applyTerrainEffects(this.p1);
    if (this.p2) this.applyTerrainEffects(this.p2);

    this.syncLabels();
    this.updateCamera();
    this.checkBarrackRange();
    this.checkRadioTowerRange();
    this.checkRaidCacheRange();
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
    this.updateCraftMenu(delta);
    this.updateHarvest(delta);
    this.updateSpikeTraps();
    this.updateFog();
    this.updateMinimap();
    this.updateTreeSeeds(delta);
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

    // Skip joystick/button activation when tapping inside the craft menu panel
    if (this.craftMenuOpen) {
      const PW = 440, PH = 330, PX = (W - PW) / 2, PY = H - PH - 20;
      if (px >= PX && px <= PX + PW && py >= PY && py <= PY + PH) return;
    }

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
      if (this.craftMenuOpen && this.craftMenuOwner === this.p1) { this.craftSelected(); return; }
      if (this.buildMode && this.buildOwner === this.p1) this.placeBuild();
      else this.doAttack(this.p1);
    } else if (name === 'alt') {
      if (!this.p1.isDowned && !this.p1.isSleeping) this.doAlt(this.p1);
    } else if (name === 'interact') {
      if (!this.barrackOpen) this.tryInteract(this.p1);
    } else if (name === 'build') {
      if (!this.p1.isDowned && !this.p1.isSleeping) this.openCraftMenu(this.p1);
    } else if (name === 'menu') {
      this.toggleControls();
    }
  }

  applyTouchInput() {
    const p = this.p1;
    if (!p || p.isDowned || p.isSleeping) return;
    const jv = this._joy.vec;
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

  applyTerrainEffects(player) {
    if (!player || player.isDowned) return;

    // Shallow water: 50% speed cap (flag set by overlap callback)
    if (player._inShallowWater) {
      const vx = player.spr.body.velocity.x, vy = player.spr.body.velocity.y;
      player.spr.setVelocity(vx * 0.5, vy * 0.5);
      return;
    }

    // Ice: momentum slide — 88/12 blend preserves previous velocity
    if (player._onIce) {
      const vx = player.spr.body.velocity.x, vy = player.spr.body.velocity.y;
      if (player._iceVx === undefined) { player._iceVx = vx; player._iceVy = vy; }
      player._iceVx = player._iceVx * 0.88 + vx * 0.12;
      player._iceVy = player._iceVy * 0.88 + vy * 0.12;
      player.spr.setVelocity(player._iceVx, player._iceVy);
      return;
    }
    player._iceVx = undefined; player._iceVy = undefined;

    // Tundra ground slow (non-ice tiles, existing behavior)
    const TILE = CFG.TILE;
    const ptx = Math.floor(player.spr.x / TILE), pty = Math.floor(player.spr.y / TILE);
    const biome = getBiome(ptx, pty);
    if (biome === 'tundra') {
      const vx = player.spr.body.velocity.x, vy = player.spr.body.velocity.y;
      if (vx !== 0 || vy !== 0) player.spr.setVelocity(vx * 0.7, vy * 0.7);
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

  checkRaidCacheRange() {
    const cache = this.raidCamp && this.raidCamp.cache;
    if (!cache || cache.locked || cache.opened) {
      if (cache && cache.prompt && cache.prompt.active) cache.prompt.setVisible(false);
      return;
    }
    const near = p => p && Phaser.Math.Distance.Between(p.spr.x, p.spr.y, cache.x, cache.y) < 70;
    if (cache.prompt && cache.prompt.active) cache.prompt.setVisible(near(this.p1) || near(this.p2));
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

    // Locked loot cache — visible but inaccessible until all raiders are killed
    const cacheSpr = this._w(this.add.image(cx, cy + 52, 'raid_cache').setScale(2.5).setDepth(6));
    if (this.hudCam) this.hudCam.ignore(cacheSpr);
    const cacheLbl = this._w(this.add.text(cx, cy + 52 - 30, '\uD83D\uDD12 LOCKED', {
      fontFamily: 'monospace', fontSize: '9px', color: '#ff4444', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(8));
    if (this.hudCam) this.hudCam.ignore(cacheLbl);
    const cachePrompt = this._w(this.add.text(cx, cy + 52 - 46, 'E \u2014 open cache', {
      fontFamily: 'monospace', fontSize: '10px', color: '#ccaa00',
      stroke: '#000000', strokeThickness: 2, backgroundColor: '#00000088', padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(8).setVisible(false));
    if (this.hudCam) this.hudCam.ignore(cachePrompt);
    this.raidCamp.cache = { x: cx, y: cy + 52, spr: cacheSpr, lbl: cacheLbl, prompt: cachePrompt, locked: true, opened: false };

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
      const spr = this.physics.add.image(rx, ry, texKey).setScale(2.5).setDepth(9);
      spr.setCollideWorldBounds(true);
      spr.body.setSize(16, 20);
      if (this.hudCam) this.hudCam.ignore(spr);
      this.physics.add.collider(spr, this.obstacles);

      // Difficulty scaling — matches regular enemy formula (10% per day, caps at 3×)
      const diffScale = this._diffMult();
      const stats = {
        brawler: { hp: 130, speed: 110, dmg: 20, range: 36, atkInterval: 1100, shootRange: 0 },
        shooter: { hp: 80,  speed: 90,  dmg: 16, range: 40, atkInterval: 1200, shootRange: 280 },
        heavy:   { hp: 200, speed: 75,  dmg: 28, range: 42, atkInterval: 1400, shootRange: 200 },
      }[rtype];

      const raider = {
        spr, type: rtype, isRaider: true,
        hp: Math.floor(stats.hp * diffScale), maxHp: Math.floor(stats.hp * diffScale),
        speed: stats.speed * Math.min(1.6, diffScale),
        dmg: Math.floor(stats.dmg * diffScale),
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

      // Mutual aggro: redirect toward boss if closer and within 220px
      let target = nearest, targetDist = nearDist;
      if (this.boss && !this.boss.dying && this.boss.spr && this.boss.spr.active) {
        const bd = Phaser.Math.Distance.Between(raider.spr.x, raider.spr.y, this.boss.spr.x, this.boss.spr.y);
        if (bd < 220 && bd < nearDist) { target = this.boss; targetDist = bd; }
      }

      // Brawler charge lunge: triple speed for 400ms when closing within 100px
      if (raider.type === 'brawler') {
        raider.chargeCooldown = (raider.chargeCooldown || 0) - delta;
        raider.chargeTimer   = (raider.chargeTimer   || 0) - delta;
        if (raider.chargeTimer > 0) {
          // Mid-charge: override movement speed to triple via velocity boost
          const ang = Phaser.Math.Angle.Between(raider.spr.x, raider.spr.y, target.spr.x, target.spr.y);
          raider.spr.setVelocity(Math.cos(ang) * raider.speed * 3, Math.sin(ang) * raider.speed * 3);
          raider.spr.setTint(0xff4422);
        } else {
          if (raider.spr.tintTopLeft === 0xff4422) raider.spr.clearTint();
          if (targetDist < 100 && targetDist > raider.attackRange && raider.chargeCooldown <= 0) {
            raider.chargeTimer   = 400;
            raider.chargeCooldown = 2000;
          }
        }
        return; // brawlers skip ranged logic
      }

      // Shooters and heavy: ranged fire when in range
      if (!raider.shootRange) return;
      if (targetDist < raider.shootRange && targetDist > raider.attackRange * 1.5) {
        raider.rangedTimer -= delta;
        if (raider.rangedTimer <= 0) {
          raider.rangedTimer = raider.atkInterval;
          this._fireRaiderShot(raider, target);
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
    bullet.setRotation(ang);
    SFX._play(320, 'square', 0.04, 0.15);
    // Raider bullets blocked by terrain and player-built structures
    if (this.obstacles) {
      this.physics.add.collider(bullet, this.obstacles, () => { if (bullet.active) bullet.destroy(); });
    }

    const hitPlayers = [this.p1, this.p2].filter(Boolean);
    hitPlayers.forEach(p => {
      this.physics.add.overlap(p.spr, bullet, () => {
        if (!bullet.active) return;
        const baseDmg = raider.dmg * 0.7;
        const dmg = this._knightShieldBlock(p, bullet.x, bullet.y, baseDmg);
        bullet.destroy();
        p.hp = Math.max(0, p.hp - dmg);
        SFX.playerHurt();
        // Only apply red hurt tint if shield didn't already flash blue
        if (dmg >= baseDmg) {
          p.spr.setTint(0xff0000);
          this.time.delayedCall(150, () => {
            if (!p.spr?.active) return;
            if (p._frostSlowed) p.spr.setTint(0x88ccff);
            else p.spr.clearTint();
          });
        }
        this.checkDeaths();
      });
    });
    // Raider bullets also hit the boss (mutual aggro — 40% of raider damage)
    if (this.boss && this.boss.spr && this.boss.spr.active) {
      this.physics.add.overlap(bullet, this.boss.spr, () => {
        if (!bullet.active) return;
        bullet.destroy();
        this._hurtEnemy(this.boss, Math.round(raider.dmg * 0.4), bullet.x, bullet.y);
      });
    }
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
      { key: 'boss_golem',  name: 'Iron Golem',   biome: 'waste',  hp: 600, speed: 55,  dmg: 22, specialType: 'slam',   specialInterval: 5500 },
      { key: 'boss_wolf',   name: 'Alpha Wolf',    biome: 'grass',  hp: 420, speed: 100, dmg: 16, specialType: 'charge', specialInterval: 4000 },
      { key: 'boss_spider', name: 'Spider Queen',  biome: 'ruins',  hp: 480, speed: 85,  dmg: 18, specialType: 'spray',  specialInterval: 5000 },
      { key: 'boss_troll',  name: 'Frost Troll',   biome: 'tundra', hp: 700, speed: 65,  dmg: 28, specialType: 'slam',   specialInterval: 6500 },
      { key: 'boss_hydra',  name: 'Bog Hydra',     biome: 'swamp',  hp: 540, speed: 65,  dmg: 20, specialType: 'spray',  specialInterval: 5500 },
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
      specialType: bt.specialType, specialInterval: bt.specialInterval,
      specialTimer: bt.specialInterval * 0.6, // first special fires sooner
      _bossState: 'chase', _telegraphTimer: 0, _telegraphGfx: null,
    };
    // Add boss to main enemy array so melee + bullets can hit it
    this.enemies.push(this.boss);

    // Announce arrival
    this.hint('\u2620 ' + bt.name.toUpperCase() + ' APPROACHES! \u2620', 6000);
    SFX.bossRoar();
    Music.switchToBoss();

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

    // Bog Hydra passive HP regen — 5 HP/s
    if (b.type === 'boss_hydra' && b.hp < b.maxHp && b.hp > 0) {
      b.hp = Math.min(b.maxHp, b.hp + 5 * (delta / 1000));
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

    // ── SPECIAL ATTACK STATE MACHINE ─────────────────────────────
    b.specialTimer -= delta;

    if (b._bossState === 'telegraph') {
      // Frozen during telegraph windup
      b.spr.setVelocity(0, 0);
      b._telegraphTimer -= delta;
      if (b._telegraphTimer <= 0) {
        b._bossState = 'chase';
        this._bossExecuteSpecial(b, nearest);
        b.specialTimer = b.specialInterval;
      }
    } else {
      // Mutual aggro — if a raider is within 160px and closer than the nearest player,
      // redirect the boss to fight the raider instead.
      let foeX = nearest.spr.x, foeY = nearest.spr.y, foeDist = nearDist;
      let aggroRaider = null;
      if (this.raiders && this.raiders.length > 0) {
        this.raiders.forEach(r => {
          if (r.dying || !r.spr.active) return;
          const d = Phaser.Math.Distance.Between(b.spr.x, b.spr.y, r.spr.x, r.spr.y);
          if (d < 160 && d < foeDist) { foeDist = d; foeX = r.spr.x; foeY = r.spr.y; aggroRaider = r; }
        });
      }

      // Chase toward nearest foe (raider or player)
      const ang = Phaser.Math.Angle.Between(b.spr.x, b.spr.y, foeX, foeY);
      b.spr.setVelocity(Math.cos(ang) * b.speed, Math.sin(ang) * b.speed);
      b.spr.setFlipX(foeX < b.spr.x);

      // Special attacks always target the nearest player even when fighting raiders
      if (b.specialTimer <= 0 && nearDist < 300) {
        b._bossState = 'telegraph';
        b._telegraphTimer = 900;
        b._lockedTarget = nearest;
        this._bossTelegraph(b, nearest);
      }

      // Alpha Wolf howl — summon 2 wolves when below 50% HP, every 12s
      if (b.type === 'boss_wolf' && b.hp < b.maxHp * 0.5) {
        if (!b._howlTimer) b._howlTimer = 12000;
        b._howlTimer -= delta;
        if (b._howlTimer <= 0) {
          b._howlTimer = 12000;
          this.hint('\u2620 Alpha Wolf HOWLS! Wolves incoming!', 2000);
          SFX._play(180, 'sawtooth', 0.2, 0.65, 'drop');
          this.cameras.main.shake(400, 0.007);
          const wW = CFG.MAP_W * CFG.TILE, wH = CFG.MAP_H * CFG.TILE;
          for (let i = 0; i < 2; i++) {
            const ang = Math.random() * Math.PI * 2;
            const ex = Phaser.Math.Clamp(b.spr.x + Math.cos(ang) * 90, CFG.TILE*2, wW-CFG.TILE*2);
            const ey = Phaser.Math.Clamp(b.spr.y + Math.sin(ang) * 90, CFG.TILE*2, wH-CFG.TILE*2);
            const sizeMult = Phaser.Math.FloatBetween(0.9, 1.15);
            const sc = 1.9 * sizeMult;
            const eSpr = this.physics.add.image(ex, ey, 'wolf').setScale(sc).setDepth(9);
            eSpr.setCollideWorldBounds(true);
            eSpr.body.setSize(20, 12);
            if (this.hudCam) this.hudCam.ignore(eSpr);
            this.physics.add.collider(eSpr, this.obstacles);
            this.enemies.push({
              spr: eSpr, hp: Math.floor(75 * sizeMult), maxHp: Math.floor(75 * sizeMult),
              speed: 105 * sizeMult, dmg: Math.max(1, Math.floor(9 * sizeMult)),
              type: 'wolf', attackTimer: 0, wanderTimer: 0,
              aggroRange: 220, attackRange: 48, sizeMult,
            });
          }
        }
      }

      // Melee — swipe nearest raider or player depending on what's in range
      if (foeDist < 70) {
        b.attackTimer -= delta;
        if (b.attackTimer <= 0) {
          b.attackTimer = b.atkInterval;
          if (aggroRaider) {
            // Hit the raider — uses _hurtEnemy so flinch + log applies
            this._hurtEnemy(aggroRaider, b.dmg, b.spr.x, b.spr.y);
          } else {
            nearest.hp = Math.max(0, nearest.hp - b.dmg);
            this._log(nearest.charData.player + ' hit for ' + b.dmg + '  hp=' + nearest.hp + '/' + nearest.maxHp);
            SFX.playerHurt();
            nearest.spr.setTint(0xff0000);
            this.cameras.main.shake(300, 0.008);
            this.time.delayedCall(200, () => {
              if (!nearest.spr?.active) return;
              if (nearest._frostSlowed) nearest.spr.setTint(0x88ccff);
              else nearest.spr.clearTint();
            });
            // Frost Troll — apply frost slow on melee hit
            if (b.type === 'boss_troll' && !nearest._frostSlowed) {
              nearest._frostSlowed = true;
              nearest._speedMult = 0.55;
              this.hint('FROST SLOW! (-45% speed)', 1500);
              this.time.delayedCall(280, () => { if (nearest.spr?.active && nearest._frostSlowed) nearest.spr.setTint(0x88ccff); });
              this.time.delayedCall(3000, () => {
                if (!nearest) return;
                nearest._frostSlowed = false;
                nearest._speedMult = 1;
                if (nearest.spr?.active) nearest.spr.clearTint();
              });
            }
            this.checkDeaths();
          }
        }
      }
    }

    // Boss can be damaged by player attacks — handled in doAttack via enemies array
    // Add boss to enemies array for bullet hit detection (done in spawnBoss)
  }

  // Show the telegraphed windup visual for each boss special type.
  _bossTelegraph(b, nearest) {
    if (b._telegraphGfx && b._telegraphGfx.active) b._telegraphGfx.destroy();
    b._telegraphGfx = null;
    const bx = b.spr.x, by = b.spr.y;

    if (b.specialType === 'slam') {
      if (b.type === 'boss_troll') {
        // ── Club overhead swing ──────────────────────────────────
        // Draw a club as a Graphics object (pivot at handle grip = boss position).
        // Starts raised over-the-shoulder (-1.9 rad) and sweeps to a slam (+1.0 rad).
        const club = this.add.graphics().setDepth(20);
        if (this.hudCam) this.hudCam.ignore(club);
        club.fillStyle(0x5a3010); club.fillRect(-4, -58, 8, 46);  // handle
        club.fillStyle(0x3a1808); club.fillRect(-11, -72, 22, 16); // club head
        club.fillStyle(0x6a4020); club.fillRect(-9, -70, 18, 12);  // head highlight
        club.fillStyle(0x888888); club.fillRect(-3, -76, 6, 5);    // metal cap
        club.setPosition(bx, by).setRotation(-1.9);
        b._telegraphGfx = club;
        this.tweens.add({
          targets: club, rotation: 1.0, duration: 900, ease: 'Cubic.In',
          onUpdate: () => { if (club.active && b.spr.active) club.setPosition(b.spr.x, b.spr.y); },
        });
        SFX._play(110, 'sawtooth', 0.12, 0.4, 'rise');
      } else {
        // ── Iron Golem — expanding red ground ring ───────────────
        const ring = this.add.graphics().setDepth(20);
        if (this.hudCam) this.hudCam.ignore(ring);
        b._telegraphGfx = ring;
        const tweenObj = { t: 0 };
        this.tweens.add({
          targets: tweenObj, t: 1, duration: 900, ease: 'Sine.Out',
          onUpdate: () => {
            if (!ring.active) return;
            ring.clear();
            ring.lineStyle(4, 0xff3300, 0.3 + tweenObj.t * 0.55);
            ring.strokeCircle(b.spr.x, b.spr.y, 130 * tweenObj.t);
          },
        });
        SFX._play(75, 'sawtooth', 0.18, 0.5, 'drop');
      }

    } else if (b.specialType === 'charge') {
      // ── Alpha Wolf — pulsing yellow directional arrow ─────────
      b._chargeAngle = Phaser.Math.Angle.Between(bx, by, nearest.spr.x, nearest.spr.y);
      const arrow = this.add.graphics().setDepth(20);
      if (this.hudCam) this.hudCam.ignore(arrow);
      b._telegraphGfx = arrow;
      const tweenObj = { t: 0 };
      this.tweens.add({
        targets: tweenObj, t: 1, duration: 900, ease: 'Linear',
        onUpdate: () => {
          if (!arrow.active) return;
          arrow.clear();
          const a = b._chargeAngle;
          const pulse = 0.4 + Math.sin(tweenObj.t * Math.PI * 5) * 0.35;
          arrow.lineStyle(3, 0xffcc00, pulse);
          arrow.lineBetween(b.spr.x, b.spr.y,
            b.spr.x + Math.cos(a) * 90, b.spr.y + Math.sin(a) * 90);
          // Arrow head
          arrow.lineBetween(
            b.spr.x + Math.cos(a) * 90, b.spr.y + Math.sin(a) * 90,
            b.spr.x + Math.cos(a - 0.5) * 60, b.spr.y + Math.sin(a - 0.5) * 60);
          arrow.lineBetween(
            b.spr.x + Math.cos(a) * 90, b.spr.y + Math.sin(a) * 90,
            b.spr.x + Math.cos(a + 0.5) * 60, b.spr.y + Math.sin(a + 0.5) * 60);
        },
      });
      SFX._play(500, 'square', 0.05, 0.15);

    } else if (b.specialType === 'spray') {
      // ── Spider / Hydra — colored boss flash ───────────────────
      b._sprayAngle = Phaser.Math.Angle.Between(bx, by, nearest.spr.x, nearest.spr.y);
      const col = b.type === 'boss_spider' ? 0xaa44ff : 0x44bb44;
      b.spr.setTint(col);
      this.time.delayedCall(900, () => { if (b.spr && b.spr.active) b.spr.clearTint(); });
      SFX._play(b.type === 'boss_spider' ? 900 : 280, 'square', 0.06, 0.25);
    }
  }

  // Execute the telegraphed special attack — called 900ms after _bossTelegraph.
  _bossExecuteSpecial(b, nearest) {
    if (b._telegraphGfx && b._telegraphGfx.active) { b._telegraphGfx.destroy(); b._telegraphGfx = null; }
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && p.hp > 0 && p.spr.active);

    if (b.specialType === 'slam') {
      // ── Ground Slam: AoE damage within 130px, big shake ──────
      this.cameras.main.shake(500, 0.02);
      SFX._play(55, 'sawtooth', 0.45, 0.55, 'drop');
      // Impact ring flash
      const ring = this.add.graphics().setDepth(20);
      if (this.hudCam) this.hudCam.ignore(ring);
      ring.lineStyle(6, b.type === 'boss_troll' ? 0x88ccff : 0xff4400, 1.0);
      ring.strokeCircle(b.spr.x, b.spr.y, 130);
      this.tweens.add({ targets: ring, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
      // Damage
      players.forEach(p => {
        if (Phaser.Math.Distance.Between(b.spr.x, b.spr.y, p.spr.x, p.spr.y) < 130) {
          p.hp = Math.max(0, p.hp - Math.round(b.dmg * 0.85));
          SFX.playerHurt();
          p.spr.setTint(b.type === 'boss_troll' ? 0x88ccff : 0xff4400);
          this.time.delayedCall(250, () => {
            if (!p.spr?.active) return;
            if (p._frostSlowed) p.spr.setTint(0x88ccff);
            else p.spr.clearTint();
          });
        }
      });
      this.checkDeaths();

    } else if (b.specialType === 'charge') {
      // ── Charge Dash: velocity burst, hit on contact ───────────
      const ang = b._chargeAngle || 0;
      SFX._play(200, 'sawtooth', 0.18, 0.22, 'drop');
      b.spr.setVelocity(Math.cos(ang) * b.speed * 4.5, Math.sin(ang) * b.speed * 4.5);
      this.time.delayedCall(380, () => {
        if (!b || !b.spr || !b.spr.active) return;
        b.spr.setVelocity(0, 0);
        players.forEach(p => {
          if (Phaser.Math.Distance.Between(b.spr.x, b.spr.y, p.spr.x, p.spr.y) < 55) {
            p.hp = Math.max(0, p.hp - Math.round(b.dmg * 1.3));
            SFX.playerHurt();
            p.spr.setTint(0xff8800);
            this.cameras.main.shake(250, 0.01);
            this.time.delayedCall(200, () => {
              if (!p.spr?.active) return;
              if (p._frostSlowed) p.spr.setTint(0x88ccff);
              else p.spr.clearTint();
            });
          }
        });
        this.checkDeaths();
      });

    } else if (b.specialType === 'spray') {
      // ── Projectile Spray: 3 shots in spread ──────────────────
      const baseAng = b._sprayAngle || 0;
      const col = b.type === 'boss_spider' ? 0xcc55ff : 0x55dd55;
      SFX._play(b.type === 'boss_spider' ? 1100 : 380, 'square', 0.1, 0.3);
      for (let i = -1; i <= 1; i++) {
        const ang = baseAng + i * 0.38;
        const blt = this.physics.add.image(b.spr.x, b.spr.y, 'bullet')
          .setScale(2.5).setTint(col).setDepth(15).setRotation(ang);
        blt.body.allowGravity = false;
        if (this.hudCam) this.hudCam.ignore(blt);
        blt.setVelocity(Math.cos(ang) * 210, Math.sin(ang) * 210);
        if (this.obstacles) this.physics.add.collider(blt, this.obstacles, () => { if (blt.active) blt.destroy(); });
        players.forEach(p => {
          this.physics.add.overlap(p.spr, blt, () => {
            if (!blt.active) return;
            blt.destroy();
            p.hp = Math.max(0, p.hp - Math.round(b.dmg * 0.75));
            SFX.playerHurt();
            p.spr.setTint(col);
            // Spider Queen web: root player briefly (1.5s)
            if (b.type === 'boss_spider' && !p._webbed) {
              p._webbed = true;
              p._speedMult = 0;
              this.hint('WEBBED! Can\'t move!', 1500);
              this.time.delayedCall(1500, () => {
                if (!p) return;
                p._webbed = false;
                p._speedMult = 1;
                if (!p.spr?.active) return;
                if (p._frostSlowed) p.spr.setTint(0x88ccff);
                else p.spr.clearTint();
              });
            } else {
              this.time.delayedCall(220, () => {
                if (!p.spr?.active) return;
                if (p._frostSlowed) p.spr.setTint(0x88ccff);
                else p.spr.clearTint();
              });
            }
            this.checkDeaths();
          });
        });
        this.time.delayedCall(2200, () => { if (blt.active) blt.destroy(); });
      }
    }
  }

  updateEnemyDens(delta) {
    if (!this.enemyDens) return;
    this.enemyDens.forEach(den => {
      den.respawnTimer += delta;
      if (den.respawnTimer >= 30000) { // respawn enemies every 30s near dens
        den.respawnTimer = 0;
        const types = ['wolf','rat','rat'];
        const type = types[Phaser.Math.Between(0, types.length-1)];
        const typeDef = { wolf:{hp:60,speed:75,dmg:6,baseScale:1.8,w:20,h:12}, rat:{hp:30,speed:105,dmg:4,baseScale:1.4,w:15,h:9} };
        const t = typeDef[type];
        const sizeMult = Phaser.Math.FloatBetween(1.0, 1.3);
        const sc = t.baseScale * sizeMult;
        const ex = den.x + Phaser.Math.Between(-60, 60);
        const ey = den.y + Phaser.Math.Between(-60, 60);
        const spr = this.physics.add.image(ex, ey, type).setScale(sc).setDepth(8);
        spr.setCollideWorldBounds(true);
        spr.body.setSize(t.w, t.h);
        if (this.hudCam) this.hudCam.ignore(spr);
        this.physics.add.collider(spr, this.obstacles);
        const D = this._diffMult();
        const hp  = Math.floor(t.hp  * sizeMult * D);
        const dmg = Math.max(1, Math.floor(t.dmg * sizeMult * D));
        const spd = t.speed * D * (sizeMult < 0.85 ? 1.3 : sizeMult > 1.2 ? 0.8 : 1);
        const atkInterval = Math.max(500, Math.round(({ wolf:1600, rat:1200, bear:2400 }[type] || 1400) / D));
        const denBaseAggro = { wolf: 190, rat: 110, bear: 290 }[type] || 160;
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, atkInterval, type, attackTimer:0, wanderTimer:0, aggroRange:denBaseAggro, attackRange:30*sizeMult, sizeMult };
        // Start dormant if far from all players
        {
          const _ap = [this.p1, this.p2].filter(p => p && p.spr && p.spr.active);
          const _sd = _ap.length ? Math.min(..._ap.map(p => Phaser.Math.Distance.Between(ex, ey, p.spr.x, p.spr.y))) : Infinity;
          if (_sd > CFG.DORMANT_RADIUS) { e._dormant = true; spr.setVisible(false); if (spr.body) spr.body.enable = false; }
        }
        this.enemies.push(e);
      }
    });
  }

  movePlayer(player, L, R, U, D) {
    const spd = player.charData.speed * (player._speedMult !== undefined ? player._speedMult : 1);
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
          if (e.dying) return;
          this.physics.add.overlap(blt, e.spr, () => {
            if (!blt.active || e.dying) return; // dying guard: second in-flight bullet can't double-kill
            blt.destroy();
            this._hurtEnemy(e, 35, blt.x, blt.y);
          });
        });
      }
      this.time.delayedCall(1200, () => { if (blt.active) blt.destroy(); });
      player.atkCooldown = 350;
    } else if (id === 'knight') {
      SFX.sword();
      player.atkCooldown = 500;
      this.meleeSwing(player, 55, 0xdddddd, 0.18, 0);
      if (player._knightUpgraded) this._fireShieldThrow(player);
    } else {
      // Architect
      SFX.wrench();
      player.atkCooldown = 450;
      this.meleeSwing(player, 45, 0xcc8833, 0.2, 350);
      if (player._architectUpgraded) this._fireNailGun(player);
    }
  }

  _fireShieldThrow(player) {
    const angle = this.getAimAngle(player);
    const blt = this.physics.add.image(player.spr.x, player.spr.y, 'bullet')
      .setDepth(15).setScale(3.5).setTint(0x5599ff);
    blt.setRotation(angle);
    if (this.hudCam) this.hudCam.ignore(blt);
    this.physics.velocityFromAngle(Phaser.Math.RadToDeg(angle), 280, blt.body.velocity);
    blt.body.allowGravity = false;
    if (this.obstacles) {
      this.physics.add.collider(blt, this.obstacles, () => { if (blt.active) blt.destroy(); });
    }
    if (this.enemies) {
      this.enemies.forEach(e => {
        if (e.dying) return;
        this.physics.add.overlap(blt, e.spr, () => {
          if (!blt.active || e.dying) return;
          blt.destroy();
          this._hurtEnemy(e, 28, blt.x, blt.y, 0x5599ff);
        });
      });
    }
    this.time.delayedCall(700, () => { if (blt.active) blt.destroy(); });
  }

  _fireNailGun(player) {
    const angle = this.getAimAngle(player);
    const blt = this.physics.add.image(player.spr.x, player.spr.y, 'bullet')
      .setDepth(15).setScale(1.0).setTint(0xff8833);
    blt.setRotation(angle);
    if (this.hudCam) this.hudCam.ignore(blt);
    this.physics.velocityFromAngle(Phaser.Math.RadToDeg(angle), 540, blt.body.velocity);
    blt.body.allowGravity = false;
    if (this.obstacles) {
      this.physics.add.collider(blt, this.obstacles, () => { if (blt.active) blt.destroy(); });
    }
    if (this.enemies) {
      this.enemies.forEach(e => {
        if (e.dying) return;
        this.physics.add.overlap(blt, e.spr, () => {
          if (!blt.active || e.dying) return;
          blt.destroy();
          this._hurtEnemy(e, 14, blt.x, blt.y, 0xff8833);
        });
      });
    }
    this.time.delayedCall(900, () => { if (blt.active) blt.destroy(); });
  }

  doAlt(player) {
    const id = player.charData.id;
    if (id === 'gunslinger') {
      const clipSize = player._gunslingerClip || 8;
      if (player.ammo < clipSize && !player.reloading && player.reserveAmmo > 0) {
        player.reloading = true;
        SFX.reload();
        this.hint('Reloading\u2026 (' + player.reserveAmmo + ' in reserve)', 1500);
        this.time.delayedCall(1500, () => {
          const needed = clipSize - player.ammo;
          const fill = Math.min(needed, player.reserveAmmo);
          player.ammo += fill;
          player.reserveAmmo -= fill;
          player.reloading = false;
          this.redrawHUD(); SFX.reload();
        });
      } else if (player.reserveAmmo <= 0 && player.ammo < clipSize) {
        this.hint('No ammo left! Find more drops.', 2000);
      }
    } else if (id === 'knight') {
      // RALLY — war cry boosts speed + frightens nearby enemies (30s cooldown)
      if (player.rallyCooldown > 0) {
        this.hint('RALLY: ' + Math.ceil(player.rallyCooldown / 1000) + 's', 1200);
        return;
      }
      player.rallyCooldown = 30000;
      this.tickCooldown(player, 'rallyCooldown', 30000);
      this.time.delayedCall(30000, () => this.hint('RALLY is ready!', 2000));
      SFX._play(330, 'square', 0.15, 0.5, 'rise');
      SFX._play(440, 'square', 0.2, 0.4, 'rise');
      this.hint('RALLY! Speed boost + enemies flee!', 2500);
      // Inner gold circle (speed boost range)
      const fx = this.add.graphics().setDepth(20);
      if (this.hudCam) this.hudCam.ignore(fx);
      fx.lineStyle(3, 0xffdd44, 0.8);
      fx.strokeCircle(player.spr.x, player.spr.y, 60);
      this.tweens.add({ targets:fx, alpha:0, duration:800, onComplete:()=>fx.destroy() });
      // Outer blue circle (frighten radius)
      const fx2 = this.add.graphics().setDepth(20);
      if (this.hudCam) this.hudCam.ignore(fx2);
      fx2.lineStyle(2, 0xaaddff, 0.7);
      fx2.strokeCircle(player.spr.x, player.spr.y, 200);
      this.tweens.add({ targets:fx2, alpha:0, duration:700, onComplete:()=>fx2.destroy() });
      // Boost partner speed — or self if solo
      const partner = player === this.p1 ? this.p2 : this.p1;
      const rallyTarget = (partner && !partner.isDowned) ? partner : player;
      const origSpeed = rallyTarget.charData.speed;
      rallyTarget.charData.speed = Math.floor(origSpeed * 1.5);
      rallyTarget.spr.setTint(0xffdd44);
      this.time.delayedCall(5000, () => {
        rallyTarget.charData.speed = origSpeed;
        if (rallyTarget.spr.active) rallyTarget.spr.clearTint();
      });
      // Frighten nearby enemies — they flee for 5 seconds
      const rallyX = player.spr.x;
      const rallyY = player.spr.y;
      this.enemies.forEach(e => {
        if (!e.spr?.active) return;
        const d = Phaser.Math.Distance.Between(e.spr.x, e.spr.y, rallyX, rallyY);
        if (d < 200) {
          e._scaredTimer = 5000;
          e._scaredFromX = rallyX;
          e._scaredFromY = rallyY;
          e._fearFlashTimer = 0;
          e.spr.setTint(0xaaddff);
        }
      });
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
          if (e.dying || !e.spr.active) return;
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
          this._hurtEnemy(nearest, 18, x, y);
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
        if (e.dying) return;
        const d = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, e.spr.x, e.spr.y);
        if (d < range + 20) {
          // Check enemy is roughly in facing direction
          const angToE = Phaser.Math.Angle.Between(player.spr.x, player.spr.y, e.spr.x, e.spr.y);
          const diff = Phaser.Math.Angle.Wrap(angToE - dirAngle);
          if (Math.abs(diff) > Math.PI * 0.65) return;
          const meleeDmg = player.charData.id === 'knight' ? 45 : 30;
          this._hurtEnemy(e, meleeDmg, player.spr.x, player.spr.y);
          // Extra architect knockback (stacks on top of _hurtEnemy base impulse)
          if (knockback && e.spr.body) {
            e.spr.body.velocity.x += Math.cos(angToE) * knockback;
            e.spr.body.velocity.y += Math.sin(angToE) * knockback;
          }
        }
      });
    }
    this.tweens.add({ targets:fx, alpha:0, duration:dur*1000, onComplete:()=>fx.destroy() });
  }

  // Knight (Hudson) shield block check — call before applying damage to the player.
  // Returns the adjusted damage; also triggers visual/audio block effects if facing attacker.
  // fromX/fromY = world position of the attacker or projectile.
  _knightShieldBlock(player, fromX, fromY, baseDmg) {
    if (player.charData.id !== 'knight' || player.isSleeping || player.isDowned) return baseDmg;
    const facingAngle = this.getAimAngle(player);
    const toSrcAngle  = Phaser.Math.Angle.Between(player.spr.x, player.spr.y, fromX, fromY);
    const diff = Math.abs(Phaser.Math.Angle.Wrap(toSrcAngle - facingAngle));
    if (diff >= Math.PI * 7 / 18) return baseDmg; // enemy outside front 140° arc (±70°) — no block

    // Shield absorbs 60% of damage (70% with upgrade)
    const blockPct = player._knightUpgraded ? 0.70 : 0.60;
    const dmg = Math.max(1, Math.round(baseDmg * (1 - blockPct)));

    // Blue shield flash instead of red hurt tint
    player.spr.setTint(0x7799ff);
    this.time.delayedCall(200, () => {
      if (!player.spr?.active) return;
      if (player._frostSlowed) player.spr.setTint(0x88ccff);
      else player.spr.clearTint();
    });
    // Metallic clank
    SFX._play(380, 'square', 0.06, 0.08);
    // Floating "BLOCK!" label
    const bt = this.add.text(player.spr.x, player.spr.y - 20, 'BLOCK!', {
      fontFamily: 'monospace', fontSize: '14px', color: '#88aaff',
      stroke: '#000033', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(150);
    if (this.hudCam) this.hudCam.ignore(bt);
    this.tweens.add({ targets: bt, y: player.spr.y - 56, alpha: 0, duration: 900,
      ease: 'Cubic.Out', onComplete: () => bt.destroy() });

    return dmg;
  }

  // Central damage handler: applies damage, 220ms flinch stagger, knockback impulse,
  // hit-flash tint, SFX, and kill check. Use instead of inline e.hp -= X everywhere.
  _hurtEnemy(e, dmg, fromX, fromY, tint = 0xff6644) {
    if (!e || e.dying) return;
    e.hp -= dmg;
    e._flinchTimer = 220;
    if (e._dormant) { e._dormant = false; if (e.spr.body) e.spr.body.enable = true; }
    if (fromX !== undefined && e.spr.body) {
      const ang = Phaser.Math.Angle.Between(fromX, fromY, e.spr.x, e.spr.y);
      e.spr.body.velocity.x += Math.cos(ang) * 90;
      e.spr.body.velocity.y += Math.sin(ang) * 90;
    }
    e.spr.setTint(tint);
    this.time.delayedCall(110, () => { if (e.spr && e.spr.active) e.spr.clearTint(); });
    SFX.hit();
    this._log(e.type + ' hit  dmg=' + dmg + '  hp=' + e.hp + '/' + (e.maxHp || '?'));
    if (e.hp <= 0) this.killEnemy(e);
  }

  // Floating pickup notification — shows "+N Item" rising from world position
  _floatPickup(x, y, label) {
    const t = this.add.text(x, y - 10, label, {
      fontFamily: 'monospace', fontSize: '12px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(150).setAlpha(1);
    if (this.hudCam) this.hudCam.ignore(t);
    this.tweens.add({
      targets: t, y: y - 28, duration: 900, ease: 'Cubic.Out',
      onComplete: () => {
        this.tweens.add({
          targets: t, y: y - 48, alpha: 0, duration: 350,
          ease: 'Cubic.In', onComplete: () => t.destroy(),
        });
      },
    });
  }

  _dropSpiderWeb(x, y) {
    if (!this.activeWebs) this.activeWebs = [];
    const web = this.physics.add.image(x, y, 'spiderweb').setScale(1.8).setDepth(3).setAlpha(0.8);
    web.body.allowGravity = false;
    web.body.setImmovable(true);
    web.body.setSize(20, 20);
    if (this.hudCam) this.hudCam.ignore(web);
    this._w(web);
    this.activeWebs.push(web);
    [this.p1, this.p2].forEach(p => {
      if (!p) return;
      this.physics.add.overlap(p.spr, web, () => {
        if (!web.active || (p._webSlowCd || 0) > 0) return;
        p._webSlowCd = 2500;
        p._speedMult = 0.4;
        this.hint('Caught in a web!', 1500);
        this.time.delayedCall(2500, () => {
          if (p && p.spr?.active) { p._speedMult = 1; p._webSlowCd = 0; }
        });
      });
    });
    this.time.delayedCall(20000, () => {
      if (web.active) web.destroy();
      this.activeWebs = (this.activeWebs || []).filter(w => w !== web);
    });
  }

  // Attach a pulsating warm-glow halo to a campfire, campsite, or torch.
  // baseScale controls the radius: 1.0 = campfire/campsite, 0.45 = torch.
  _addFireGlow(x, y, baseScale = 1.0) {
    const glow = this.add.image(x, y, 'fire_glow')
      .setScale(baseScale).setAlpha(0.55).setDepth(3)
      .setBlendMode(Phaser.BlendModes.ADD);
    this._w(glow);
    if (this.hudCam) this.hudCam.ignore(glow);
    // Pulse scale
    this.tweens.add({
      targets: glow, scale: baseScale * 1.28, duration: 1400,
      ease: 'Sine.InOut', yoyo: true, loop: -1,
    });
    // Pulse alpha (slightly offset phase for organic feel)
    this.tweens.add({
      targets: glow, alpha: 0.80, duration: 1100,
      ease: 'Sine.InOut', yoyo: true, loop: -1, delay: 200,
    });
    return glow;
  }

  // Spawn a wall-mounted torch sprite + glow at world position (x, y).
  // Used by world-gen (ruins) and placeBuild().
  _spawnTorch(x, y) {
    this._addFireGlow(x, y, 0.45);
    const tc = this._w(this.add.image(x, y, 'torch').setScale(2).setDepth(5));
    if (this.hudCam) this.hudCam.ignore(tc);
    return tc;
  }

  // Push a timestamped entry to the in-game debug log (` key to show/hide).
  _log(msg) {
    if (!this._dbgEntries) return;
    const d = new Date();
    const ts = d.getMinutes().toString().padStart(2,'0') + ':' + d.getSeconds().toString().padStart(2,'0');
    this._dbgEntries.push('[' + ts + '] ' + msg);
    if (this._dbgEntries.length > 18) this._dbgEntries.shift();
    if (this._dbgTxt) this._dbgTxt.setText(['── debug log ──', ...this._dbgEntries].join('\n'));
  }

  killEnemy(e) {
    if (e.dying) return; // already being killed — prevent double-kill & double-count
    e.dying = true;
    e.hp = 0;
    this.kills++;
    this._log('Enemy killed  type=' + e.type + '  kills=' + this.kills);
    // Remove from update loop immediately so dead entries don't accumulate
    this.enemies = this.enemies.filter(e2 => e2 !== e);
    SFX.enemyDie();
    // Stop movement immediately — prevent corpse from drifting
    if (e.spr.body) { e.spr.body.setVelocity(0, 0); e.spr.body.enable = false; }
    if (e.lbl && e.lbl.scene) e.lbl.setVisible(false);
    // Red flash then 500ms fade to nothing
    e.spr.setTint(0xff2200);
    const ex = e.spr.x, ey = e.spr.y;
    this.tweens.add({
      targets: e.spr,
      alpha: 0,
      duration: 500,
      ease: 'Linear',
      onComplete: () => {
        if (e.spr && e.spr.scene) e.spr.destroy();
        if (e.lbl && e.lbl.scene) e.lbl.destroy();
      }
    });
    // Raider kill — check if camp cleared
    if (e.isRaider) {
      this.raiders = this.raiders.filter(r => r !== e);
      if (this.raiders.length === 0 && this.raidCamp) {
        this.hint('Raider camp cleared! Loot cache unlocked — raiders return in 10 days…', 4500);
        this.raidRespawnDay = this.dayNum + 10;
        if (this.raidCamp.spr && this.raidCamp.spr.active) this.raidCamp.spr.setTint(0x555555);
        // Unlock the loot cache
        const cache = this.raidCamp.cache;
        if (cache && cache.locked && cache.spr.active) {
          cache.locked = false;
          cache.lbl.setText('LOOT CACHE').setStyle({ color: '#ccaa00', stroke: '#000000', strokeThickness: 2 });
          // Unlock pop animation
          this.tweens.add({ targets: cache.spr, scale: 3.3, duration: 180, yoyo: true, ease: 'Back.Out' });
          SFX._play(660, 'triangle', 0.12, 0.3, 'rise');
          SFX._play(880, 'triangle', 0.10, 0.25, 'rise');
        }
      }
    }
    // Boss kill
    if (e.isBoss) {
      if (e.hpBg && e.hpBg.active) e.hpBg.destroy();
      if (e.hpBar && e.hpBar.active) e.hpBar.destroy();
      if (e.nameLabel && e.nameLabel.active) e.nameLabel.destroy();
      if (e._telegraphGfx && e._telegraphGfx.active) e._telegraphGfx.destroy();
      this.boss = null;
      this.bossDefeated = true;
      this.hint('BOSS DEFEATED! A rare material was left behind…', 5000);
      Music.switchFromBoss();
      SFX._play(880, 'triangle', 0.3, 0.6, 'rise');
      SFX._play(1100, 'triangle', 0.25, 0.5, 'rise');
      this.cameras.main.shake(600, 0.018);
      this.dropResource(ex, ey, 'rare');
    }
    // Dust Hound pack frenzy — surviving packmates speed up for 4s on death
    if (e.type === 'dust_hound' && e._packId !== undefined) {
      this.enemies.forEach(other => {
        if (other.type === 'dust_hound' && other._packId === e._packId && other.spr?.active) {
          other._frenzied = true;
          other.spr.setTint(0xff8800);
          this.time.delayedCall(4000, () => {
            if (other.spr?.active) { other._frenzied = false; other.spr.clearTint(); }
          });
        }
      });
    }
    this.dropResource(ex, ey, e.type);
  }

  // Per-frame proximity check for spike traps.  Replaces physics.add.overlap because
  // add.image() has no physics body, and it also covers enemies that spawn after placement.
  updateSpikeTraps() {
    if (!this.spikeTraps || !this.spikeTraps.length || !this.enemies) return;
    for (let si = this.spikeTraps.length - 1; si >= 0; si--) {
      const st = this.spikeTraps[si];
      if (!st.active) { this.spikeTraps.splice(si, 1); continue; }
      for (const e of this.enemies) {
        if (e.dying || !e.spr.active) continue;
        if (Phaser.Math.Distance.Between(e.spr.x, e.spr.y, st.x, st.y) < 26) {
          this._hurtEnemy(e, 35, st.x, st.y);
          st.destroy();
          this.spikeTraps.splice(si, 1);
          break; // trap gone — move to next trap
        }
      }
    }
  }

  updateTreeSeeds(delta) {
    if (!this.obstacles || this.isOver) return;
    // Tick seed spawn timer — every 90 seconds, randomly sprout seeds near trees
    this._seedTimer = (this._seedTimer || 0) + delta;
    if (this._seedTimer >= 90000) {
      this._seedTimer = 0;
      const trees = this.obstacles.getChildren().filter(o => o.isTree && o.active);
      if (trees.length > 0) {
        // Pick up to 3 random trees; each has a 15% chance to drop a seed
        for (let i = 0; i < Math.min(3, trees.length); i++) {
          const t = trees[Phaser.Math.Between(0, trees.length - 1)];
          if (Math.random() > 0.15) continue;
          const { TILE } = CFG;
          const angle = Math.random() * Math.PI * 2;
          const dist = Phaser.Math.Between(TILE * 2, TILE * 4);
          const sx = t.x + Math.cos(angle) * dist;
          const sy = t.y + Math.sin(angle) * dist;
          // Grow into a tree after 90s
          const seedGfx = this.add.graphics().setDepth(4);
          if (this.hudCam) this.hudCam.ignore(seedGfx);
          seedGfx.fillStyle(0x44aa44, 0.85);
          seedGfx.fillCircle(sx, sy, 4);
          this._w(seedGfx);
          this.time.delayedCall(90000, () => {
            if (!seedGfx.active) return;
            seedGfx.destroy();
            // Choose biome-appropriate tree key
            const biome = getBiome(Math.floor(sx / TILE), Math.floor(sy / TILE));
            let treeKey = 'tree';
            if (biome === 'tundra') treeKey = 'tree_snow';
            else if (biome === 'ruins') treeKey = Math.random() < 0.5 ? 'tree_dead' : 'tree';
            else if (biome === 'swamp') treeKey = Math.random() < 0.55 ? 'tree_swamp' : 'tree';
            const sc = Phaser.Math.FloatBetween(1.4, 2.0);
            const newTree = this.obstacles.create(sx, sy, treeKey);
            newTree.setScale(sc).setDepth(5 + (sy / TILE) * 0.01).setImmovable(true);
            newTree.body.setSize(8, 12).setOffset(10, 24);
            newTree.refreshBody();
            newTree.isTree = true;
            this._w(newTree);
          });
        }
      }
    }
    // Also tick any saplings already queued — handled via delayedCall above
  }

  openRaidCache(cache) {
    if (cache.opened || cache.locked) return;
    cache.opened = true;
    if (cache.prompt && cache.prompt.active) cache.prompt.destroy();
    // Pop animation then destroy
    this.tweens.add({
      targets: cache.spr, scaleY: 0, duration: 280, ease: 'Back.In',
      onComplete: () => { if (cache.spr.active) cache.spr.destroy(); if (cache.lbl.active) cache.lbl.destroy(); }
    });
    SFX._play(440, 'triangle', 0.15, 0.35);
    this.cameras.main.shake(160, 0.006);
    this.dropResource(cache.x, cache.y, 'raid_cache');
    this.hint('Raider cache opened! Supplies recovered.', 3000);
  }

  dropResource(x, y, enemyType) {
    const drops = [];
    // Raid cache — guaranteed haul of ammo, metal and food, small chance of rare
    if (enemyType === 'raid_cache') {
      drops.push('item_ammo', 'item_ammo', 'item_metal', 'item_metal', 'item_food');
      if (Math.random() < 0.45) drops.push('item_fiber');
      if (Math.random() < 0.25) drops.push('item_rare');
    }
    // Rare boss drop — guaranteed crystal shard
    else if (enemyType === 'rare') {
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
      } else if (enemyType === 'ice_crawler') {
        if (Math.random() < 0.5) drops.push('item_fiber');
        if (Math.random() < 0.2) drops.push('item_rare');
      } else if (enemyType === 'spider_ruins') {
        if (Math.random() < 0.7) drops.push('item_fiber');
        if (Math.random() < 0.25) drops.push('item_metal');
      } else if (enemyType === 'bog_lurker') {
        if (Math.random() < 0.5) drops.push('item_food');
        if (Math.random() < 0.3) drops.push('item_fiber');
      } else if (enemyType === 'dust_hound') {
        if (Math.random() < 0.4) drops.push('item_food');
        if (Math.random() < 0.35) drops.push('item_fiber');
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
        let label = '';
        if (item.itemType === 'ammo' && player.charData.id === 'gunslinger') {
          const maxReserve = 40 - player.ammo;
          player.reserveAmmo = Math.min(maxReserve, player.reserveAmmo + 3);
          this.redrawHUD();
          label = '+3 Ammo';
        } else if (item.itemType === 'food') {
          player.hp = Math.min(player.maxHp, player.hp + 15);
          label = '+15 HP';
        } else {
          player.inv[item.itemType] = (player.inv[item.itemType] || 0) + 1;
          this.resourcesGathered++;
          label = '+1 ' + item.itemType.charAt(0).toUpperCase() + item.itemType.slice(1);
        }
        SFX._play(600, 'triangle', 0.06, 0.2);
        this._floatPickup(item.x, item.y, label);
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
    this.WAVE_INTERVAL = 90000; // 90 seconds between waves
    this._spawnGroup(worldW, worldH, cx, cy, { wolf:15, rat:20, bear:6 }, false);

    // Initial biome-exclusive enemy spawns
    this._nextPackId = 0;
    this._spawnBiomeEnemy('ice_crawler',  'tundra', 15, 1);
    this._spawnBiomeEnemy('spider_ruins', 'ruins',  15, 1);
    this._spawnBiomeEnemy('bog_lurker',   'swamp',  10, 1);
    this._spawnBiomeEnemy('bog_lurker',   'fungal', 8,  1);
    this._spawnBiomeEnemy('dust_hound',   'waste',  18, 3);
    this._spawnBiomeEnemy('dust_hound',   'desert', 12, 3);

    // Spawn structure guards — 2-4 enemies per biome structure (high danger zone)
    if (this._structureLocs) {
      const biomeGuardType = { grass:'wolf', tundra:'wolf', swamp:'rat', waste:'bear', fungal:'bog_lurker', desert:'dust_hound' };
      for (const loc of this._structureLocs) {
        const type = biomeGuardType[loc.biome] || 'wolf';
        const t = { wolf:      {key:'wolf',      hp:70, speed:95, dmg:10,baseScale:2.0,w:20,h:12},
                    rat:       {key:'rat',       hp:38, speed:145,dmg:7, baseScale:1.6,w:15,h:9 },
                    bear:      {key:'bear',      hp:160,speed:58, dmg:20,baseScale:2.4,w:24,h:18},
                    bog_lurker:{key:'bog_lurker',hp:65, speed:60, dmg:14,baseScale:1.8,w:20,h:14},
                    dust_hound:{key:'dust_hound',hp:35, speed:125,dmg:6, baseScale:1.3,w:18,h:12} }[type];
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
          const eGuard = {
            spr, type: t.key,
            hp: Math.floor(t.hp * sizeMult), maxHp: Math.floor(t.hp * sizeMult),
            speed: t.speed * sizeMult, dmg: Math.max(1, Math.floor(t.dmg * sizeMult)),
            attackTimer: 0, wanderTimer: 0,
            aggroRange: aggroR, attackRange: (30 + t.w / 2) * sizeMult,
            sizeMult, structureGuard: true,
          };
          // Start dormant if far from all players
          {
            const _ap = [this.p1, this.p2].filter(p => p && p.spr && p.spr.active);
            const _sd = _ap.length ? Math.min(..._ap.map(p => Phaser.Math.Distance.Between(ex, ey, p.spr.x, p.spr.y))) : Infinity;
            if (_sd > CFG.DORMANT_RADIUS) { eGuard._dormant = true; spr.setVisible(false); if (spr.body) spr.body.enable = false; }
          }
          this.enemies.push(eGuard);
        }
      }
    }
  }

  // ── POND GENERATION ──────────────────────────────────────────
  // BFS blob growth: organic irregular shapes with deep center + shallow edges.
  // Tundra ponds become ice tiles (passable, slippery); others have deep impassable center.
  _buildPonds(stx, sty) {
    const { TILE, SAFE_R } = CFG;
    const specs = [
      ...Array.from({length: 35}, () => 'swamp'),   // 35 swamp ponds
      ...Array.from({length: 25}, () => 'tundra'),  // 25 tundra ice ponds
      ...Array.from({length: 20}, () => 'fungal'),  // 20 fungal ponds
      ...Array.from({length: 10}, () => 'grass'),   // 10 grassland ponds
    ];
    for (const biome of specs) {
      const isIce = biome === 'tundra';
      // Pick center tile in correct biome
      let cx = -1, cy = -1;
      for (let attempt = 0; attempt < 40; attempt++) {
        const tx = Phaser.Math.Between(8, CFG.MAP_W - 8);
        const ty = Phaser.Math.Between(8, CFG.MAP_H - 8);
        if (getBiome(tx, ty) !== biome) continue;
        if (Math.abs(tx - stx) < SAFE_R + 10 && Math.abs(ty - sty) < SAFE_R + 10) continue;
        if (this._structureLocs && this._structureLocs.some(s =>
          Math.abs(s.x / TILE - tx) < 10 && Math.abs(s.y / TILE - ty) < 10)) continue;
        cx = tx; cy = ty; break;
      }
      if (cx < 0) continue;
      // BFS blob expansion
      const tileSet = new Set();
      const visited = new Set();
      const queue = [[cx, cy, 1.0]];
      while (queue.length) {
        const [tx, ty, prob] = queue.shift();
        const key = `${tx},${ty}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (Math.random() > prob) continue;
        tileSet.add(key);
        [[tx-1,ty],[tx+1,ty],[tx,ty-1],[tx,ty+1]].forEach(([nx, ny]) => {
          if (!visited.has(`${nx},${ny}`) && prob * 0.58 > 0.08) {
            queue.push([nx, ny, prob * 0.58]);
          }
        });
      }
      // Classify and place tiles
      tileSet.forEach(key => {
        const [tx, ty] = key.split(',').map(Number);
        if (tx < 1 || ty < 1 || tx >= CFG.MAP_W - 1 || ty >= CFG.MAP_H - 1) return;
        const x = tx * TILE, y = ty * TILE;
        const neighborCount = [[tx-1,ty],[tx+1,ty],[tx,ty-1],[tx,ty+1]]
          .filter(([nx, ny]) => tileSet.has(`${nx},${ny}`)).length;
        if (isIce) {
          const tile = this.physics.add.image(x, y, 'water_ice').setDepth(1).setAlpha(0.75);
          tile.body.allowGravity = false; tile.body.setImmovable(true);
          tile.body.setSize(30, 30);
          if (this.hudCam) this.hudCam.ignore(tile);
          this._w(tile);
          this.iceTiles.push(tile);
          this._iceTileSet.add(key);
        } else if (neighborCount >= 3) {
          const tile = this.obstacles.create(x, y, 'water_deep').setDepth(1).setAlpha(1);
          if (this.hudCam) this.hudCam.ignore(tile);
          tile.refreshBody();
          this.deepWaterTiles.push(tile);
        } else {
          const tile = this.physics.add.image(x, y, 'water_shallow').setDepth(1).setAlpha(1);
          tile.body.allowGravity = false; tile.body.setImmovable(true);
          tile.body.setSize(30, 30);
          if (this.hudCam) this.hudCam.ignore(tile);
          this._w(tile);
          this.waterTiles.push(tile);
        }
      });
    }
  }

  _spawnBiomeEnemy(type, biome, count, packSize) {
    const { TILE, SAFE_R } = CFG;
    const D = this._diffMult();
    const worldW = this.enemyWorldW, worldH = this.enemyWorldH;
    const cx = this.enemyCX, cy = this.enemyCY;
    const defs = {
      ice_crawler:  { hp:45,  speed:130, dmg:7,  baseScale:1.6, w:18, h:12, atkInterval:1400 },
      spider_ruins: { hp:40,  speed:70,  dmg:8,  baseScale:1.6, w:16, h:12, atkInterval:1800 },
      bog_lurker:   { hp:55,  speed:55,  dmg:13, baseScale:1.8, w:20, h:14, atkInterval:2000 },
      dust_hound:   { hp:28,  speed:118, dmg:5,  baseScale:1.3, w:18, h:12, atkInterval:1300 },
    };
    const aggros = { ice_crawler:160, spider_ruins:130, bog_lurker:80, dust_hound:200 };
    const t = defs[type];
    if (!t) return;
    const ps = packSize || 1;
    let placed = 0;
    const maxAttempts = count * 8;
    let packId = this._nextPackId || 0;
    for (let attempt = 0; attempt < maxAttempts && placed < count; attempt++) {
      const tx = Phaser.Math.Between(TILE * 5, worldW - TILE * 5);
      const ty = Phaser.Math.Between(TILE * 5, worldH - TILE * 5);
      if (getBiome(Math.round(tx / TILE), Math.round(ty / TILE)) !== biome) continue;
      if (Phaser.Math.Distance.Between(tx, ty, cx, cy) < SAFE_R * TILE * 2.5) continue;
      // For pack types, spawn ps enemies clustered near this point
      const spawnCount = (type === 'dust_hound') ? ps : 1;
      for (let pi = 0; pi < spawnCount && placed < count; pi++) {
        const ex = tx + Phaser.Math.Between(-20, 20);
        const ey = ty + Phaser.Math.Between(-20, 20);
        const sizeMult = Phaser.Math.FloatBetween(1.0, 1.4);
        const sc = t.baseScale * sizeMult;
        const hp  = Math.floor(t.hp  * sizeMult * D);
        const dmg = Math.max(1, Math.floor(t.dmg * sizeMult * D));
        const spd = t.speed * D * (sizeMult > 1.2 ? 0.85 : 1);
        const atkInterval = Math.max(500, Math.round(t.atkInterval / D));
        const spr = this.physics.add.image(
          Phaser.Math.Clamp(ex, TILE*3, worldW-TILE*3),
          Phaser.Math.Clamp(ey, TILE*3, worldH-TILE*3), type
        ).setScale(sc).setDepth(8);
        spr.setCollideWorldBounds(true);
        spr.body.setSize(t.w, t.h);
        if (this.hudCam) this.hudCam.ignore(spr);
        this.physics.add.collider(spr, this.obstacles);
        const aggroR = aggros[type] || 160;
        const atkR = (30 + t.w / 2) * sizeMult;
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, atkInterval, type, attackTimer:0,
          wanderTimer:Phaser.Math.Between(0,2000), aggroRange:aggroR, attackRange:atkR, sizeMult };
        if (type === 'bog_lurker') { e._lurking = true; spr.setAlpha(0.25); }
        if (type === 'dust_hound') { e._packId = packId; }
        // Start dormant if far from all players
        {
          const _ap = [this.p1, this.p2].filter(p => p && p.spr && p.spr.active);
          const _sd = _ap.length ? Math.min(..._ap.map(p => Phaser.Math.Distance.Between(ex, ey, p.spr.x, p.spr.y))) : Infinity;
          if (_sd > CFG.DORMANT_RADIUS) { e._dormant = true; spr.setVisible(false); if (spr.body) spr.body.enable = false; }
        }
        this.enemies.push(e);
        placed++;
      }
      if (type === 'dust_hound') packId++;
    }
    this._nextPackId = packId;
  }

  // Day-based difficulty multiplier.
  // Day 1 = 1.0× (base tuned values). Grows 10% per day, caps at 3.0× on day 21+.
  // Applies to enemy HP, damage, speed, and attack rate at spawn time.
  _diffMult() {
    return Math.min(3.0, 1 + (this.dayNum - 1) * 0.1);
  }

  _spawnGroup(worldW, worldH, cx, cy, counts, fromEdges) {
    const { TILE, SAFE_R } = CFG;
    const D = this._diffMult();
    // Base attack intervals (ms) — divided by D so enemies attack faster on later days
    const baseAtkInterval = { wolf: 1600, rat: 1200, bear: 2400, ice_crawler: 1400, spider_ruins: 1800, bog_lurker: 2000, dust_hound: 1300 };
    const types = [
      { key:'wolf',         hp:60,  speed:75,  dmg:6,  baseScale:1.8, w:20, h:12 },
      { key:'rat',          hp:30,  speed:105, dmg:4,  baseScale:1.4, w:15, h:9  },
      { key:'bear',         hp:140, speed:50,  dmg:16, baseScale:2.2, w:24, h:18 },
      { key:'ice_crawler',  hp:45,  speed:130, dmg:7,  baseScale:1.6, w:18, h:12 },
      { key:'spider_ruins', hp:40,  speed:70,  dmg:8,  baseScale:1.6, w:16, h:12 },
      { key:'bog_lurker',   hp:55,  speed:55,  dmg:13, baseScale:1.8, w:20, h:14 },
      { key:'dust_hound',   hp:28,  speed:118, dmg:5,  baseScale:1.3, w:18, h:12 },
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
        // Size variance: 1.0x to 1.5x — floor raised so enemies are never too small to see
        const sizeMult = Phaser.Math.FloatBetween(1.0, 1.5);
        const sc = t.baseScale * sizeMult;
        const hp  = Math.floor(t.hp    * sizeMult * D);
        const dmg = Math.max(1, Math.floor(t.dmg  * sizeMult * D));
        const spd = t.speed * D * (sizeMult < 0.85 ? 1.3 : sizeMult > 1.2 ? 0.8 : 1);
        const atkInterval = Math.max(500, Math.round(baseAtkInterval[t.key] / D));
        const spr = this.physics.add.image(ex, ey, t.key).setScale(sc).setDepth(8);
        spr.setCollideWorldBounds(true);
        spr.body.setSize(t.w, t.h);
        if (this.hudCam) this.hudCam.ignore(spr);
        this.physics.add.collider(spr, this.obstacles);
        // Per-type aggro ranges: bears are territorial (wide), rats are skittish (narrow)
        const baseAggro = { wolf: 190, rat: 110, bear: 290, ice_crawler: 160, spider_ruins: 130, bog_lurker: 80, dust_hound: 200 }[t.key] || 160;
        const aggroR = baseAggro * (sizeMult > 1.2 ? 1.2 : 1);
        const atkR = (30 + t.w/2) * sizeMult;
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, atkInterval, type:t.key, attackTimer:0, wanderTimer:Phaser.Math.Between(0,2000), aggroRange:aggroR, attackRange:atkR, sizeMult };
        // Start dormant if far from all players
        {
          const _ap = [this.p1, this.p2].filter(p => p && p.spr && p.spr.active);
          const _sd = _ap.length ? Math.min(..._ap.map(p => Phaser.Math.Distance.Between(ex, ey, p.spr.x, p.spr.y))) : Infinity;
          if (_sd > CFG.DORMANT_RADIUS) { e._dormant = true; spr.setVisible(false); if (spr.body) spr.body.enable = false; }
        }
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
      if (this.dayNum >= 2) {
        const wn = this.waveNum;
        this._spawnBiomeEnemy('ice_crawler',  'tundra', Math.min(2 + wn, 6),  1);
        this._spawnBiomeEnemy('spider_ruins', 'ruins',  Math.min(2 + wn, 6),  1);
        this._spawnBiomeEnemy('bog_lurker',   'swamp',  Math.min(1 + wn, 4),  1);
        this._spawnBiomeEnemy('dust_hound',   'waste',  Math.min(3 * wn, 9),  3);
      }
      this._log('Wave ' + (this.waveNum+1) + ' day=' + this.dayNum + ' diff=' + this._diffMult().toFixed(1) + 'x  w=' + w + ' r=' + r + ' b=' + b);
      this.hint('Wave ' + (this.waveNum+1) + '! Enemies approaching from the wastes!', 3000);
      SFX._play(200, 'sawtooth', 0.3, 0.4, 'drop');
    }
  }

  updateHarvest(delta) {
    if (!this.obstacles || !this.harvestGfx) return;
    this.harvestGfx.clear();

    const HARVEST_RANGE = 72; // px
    const HARVEST_TIMES = { architect: 1500, knight: 2500, gunslinger: 4000 };
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && !p.isSleeping && p.hp > 0);

    for (const player of players) {
      // On mobile the keyboard key is never held; use the touch USE button's tracked down state instead
      const touchHeld = this._touchActive && this._tcBtns && this._tcBtns.interact.down;
      const keyHeld = player === this.p1
        ? (this.hotkeys.p1use.isDown || touchHeld)
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

      // Contextual tip: first time near a harvestable tree
      if (!this._ctx.nearTree && nearestTree) {
        this._ctx.nearTree = true;
        this.hint('Hold E (P1) or Enter (P2) near a tree to harvest Wood', 5000);
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

        // Draw harvest progress as a donut chart above the tree
        const tx = nearestTree.x, ty = nearestTree.y - 36;
        const r = 18;
        // Dark backdrop circle for contrast on any biome
        this.harvestGfx.fillStyle(0x000000, 0.65);
        this.harvestGfx.fillCircle(tx, ty, r + 5);
        // Background ring (empty track)
        this.harvestGfx.lineStyle(7, 0x334422, 0.9);
        this.harvestGfx.strokeCircle(tx, ty, r);
        // Progress arc — bright chartreuse, thick, drawn clockwise from top
        const endAngle = -Math.PI / 2 + player.harvestProgress * Math.PI * 2;
        this.harvestGfx.lineStyle(7, 0xaaff33, 1.0);
        this.harvestGfx.beginPath();
        this.harvestGfx.arc(tx, ty, r, -Math.PI / 2, endAngle, false);
        this.harvestGfx.strokePath();
        // Axe icon: small white dot in center confirms action is active
        this.harvestGfx.fillStyle(0xffffff, 0.85);
        this.harvestGfx.fillCircle(tx, ty, 4);

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
              this._floatPickup(item.x, item.y, '+1 Wood');
              if (!this._ctx.firstHarvest) {
                this._ctx.firstHarvest = true;
                this.time.delayedCall(800, () => this.hint('Press Q (P1) or 0 (P2) to open the Crafting Menu', 5000));
              }
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
      if (wall._hpBg && wall._hpBg.active) wall._hpBg.destroy();
      if (wall._hpBar && wall._hpBar.active) wall._hpBar.destroy();
      this.tweens.add({ targets: wall, alpha: 0, duration: 200, onComplete: () => { if (wall.active) wall.destroy(); } });
      this.hint('Structure destroyed!', 1500);
      this._log('Wall destroyed');
    } else if (pct < 0.25) {
      wall.setTint(0xff2200); // nearly gone — red
    } else if (pct < 0.5) {
      wall.setTint(0xff8800); // damaged — orange
    } else {
      wall.clearTint();
    }
    // D4 — draw HP bar above the wall
    if (wall.active && wall.hp > 0) {
      if (!wall._hpBar) {
        const bg = this.add.graphics().setDepth(12);
        const bar = this.add.graphics().setDepth(13);
        if (this.hudCam) { this.hudCam.ignore(bg); this.hudCam.ignore(bar); }
        this._w(bg); this._w(bar);
        wall._hpBg = bg; wall._hpBar = bar;
      }
      const bw = 28, bh = 4;
      wall._hpBg.clear(); wall._hpBg.fillStyle(0x220000, 0.8); wall._hpBg.fillRect(wall.x - bw/2, wall.y - 22, bw, bh);
      wall._hpBar.clear(); wall._hpBar.fillStyle(pct > 0.5 ? 0x44ee22 : pct > 0.25 ? 0xffaa00 : 0xff2200, 1);
      wall._hpBar.fillRect(wall.x - bw/2, wall.y - 22, Math.round(bw * pct), bh);
    }
    // D5 — night hint when wall is first attacked at night
    if (this.isNight && !this._nightWallHinted) {
      this._nightWallHinted = true;
      this.hint('\u26a0 Enemies are attacking your base!', 4000);
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
    // Hoist camera view once per frame for dormancy + culling checks
    const _cam = this.cameras.main;
    const _view = _cam.worldView;
    const _VIEW_BUF = 400; // px buffer outside viewport before hiding sprite

    this.enemies.forEach(e => {
      if (e.dying || !e.spr.active) return;
      if (e.isBoss) return; // boss movement/attack handled by updateBoss

      // ── Dormancy: wildlife enemies far from all players sleep (no AI, no physics) ──
      // Raiders are always aggressive — never dormant. Boss already excluded above.
      if (!e.isRaider) {
        let _minDist2 = Infinity;
        for (const p of players) {
          const _dx = e.spr.x - p.spr.x, _dy = e.spr.y - p.spr.y;
          const _d2 = _dx * _dx + _dy * _dy;
          if (_d2 < _minDist2) _minDist2 = _d2;
        }

        if (e._dormant) {
          if (_minDist2 < CFG.WAKE_RADIUS * CFG.WAKE_RADIUS) {
            // Wake up
            e._dormant = false;
            if (e.spr.body) e.spr.body.enable = true;
          } else {
            // Stay dormant — update visibility only, skip all AI
            const _onScr = (e.spr.x > _view.x - _VIEW_BUF && e.spr.x < _view.x + _view.width  + _VIEW_BUF &&
                            e.spr.y > _view.y - _VIEW_BUF && e.spr.y < _view.y + _view.height + _VIEW_BUF);
            e.spr.setVisible(_onScr);
            return;
          }
        } else {
          if (_minDist2 > CFG.DORMANT_RADIUS * CFG.DORMANT_RADIUS) {
            // Go dormant
            e._dormant = true;
            e.spr.setVelocity(0, 0);
            if (e.spr.body) e.spr.body.enable = false;
            e.spr.setVisible(false);
            return;
          }
        }
      }

      // ── Viewport culling for active enemies — hide sprite if off-screen ──
      {
        const _onScr = (e.spr.x > _view.x - _VIEW_BUF && e.spr.x < _view.x + _view.width  + _VIEW_BUF &&
                        e.spr.y > _view.y - _VIEW_BUF && e.spr.y < _view.y + _view.height + _VIEW_BUF);
        e.spr.setVisible(_onScr);
      }

      // Flinch stagger — freeze AI and movement briefly after being hit
      if ((e._flinchTimer || 0) > 0) { e._flinchTimer -= delta; e.spr.setVelocity(0, 0); return; }
      // Scared — flee away from Rally cast point for 5 seconds
      if ((e._scaredTimer || 0) > 0) {
        e._scaredTimer -= delta;
        const dx = e.spr.x - e._scaredFromX;
        const dy = e.spr.y - e._scaredFromY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        e.spr.setVelocity((dx / dist) * e.speed * 1.3, (dy / dist) * e.speed * 1.3);
        // Flicker tint between white and light-blue while scared
        if (!e._fearFlashTimer || e._fearFlashTimer <= 0) {
          e._fearFlashTimer = 400;
          e.spr.setTint(0xffffff);
          this.time.delayedCall(150, () => { if (e.spr?.active) e.spr.setTint(0xaaddff); });
        } else {
          e._fearFlashTimer -= delta;
        }
        if (e._scaredTimer <= 0) {
          if (e.spr?.active) e.spr.clearTint();
          e._scaredFromX = null; e._scaredFromY = null;
        }
        return;
      }
      // ── Biome-enemy special pre-frame logic ──────────────────
      // Bog Lurker: stays hidden until player is within 90px, then bursts
      if (e.type === 'bog_lurker') {
        if (e._lurking) {
          const closePlayer = [this.p1, this.p2].find(p =>
            p && !p.isDowned && Phaser.Math.Distance.Between(e.spr.x, e.spr.y, p.spr.x, p.spr.y) < 90
          );
          if (closePlayer) {
            e._lurking = false;
            e.spr.setAlpha(1);
            e._ambushTimer = 2200;
            SFX._play(200, 'sawtooth', 0.1, 0.3, 'drop');
          } else {
            e.spr.setVelocity(0, 0);
            return;
          }
        }
        if ((e._ambushTimer || 0) > 0) {
          e._ambushTimer -= delta;
          e._effectiveSpeed = e.speed * 2.8;
        } else {
          e._effectiveSpeed = e.speed;
        }
      } else if (e.type === 'ice_crawler') {
        const btile = getBiome(Math.round(e.spr.x / CFG.TILE), Math.round(e.spr.y / CFG.TILE));
        e._effectiveSpeed = (btile === 'tundra') ? e.speed : Math.floor(e.speed * 0.6);
      } else if (e.type === 'dust_hound') {
        e._effectiveSpeed = e._frenzied ? Math.floor(e.speed * 1.35) : e.speed;
      } else {
        e._effectiveSpeed = e.speed;
      }
      // Spider: drop a web every 8 seconds
      if (e.type === 'spider_ruins') {
        e._webDropTimer = (e._webDropTimer || 8000) - delta;
        if (e._webDropTimer <= 0) {
          e._webDropTimer = 8000;
          this._dropSpiderWeb(e.spr.x, e.spr.y);
        }
      }

      let nearest = null, nearDist = Infinity;
      players.forEach(p => {
        const d = Phaser.Math.Distance.Between(e.spr.x, e.spr.y, p.spr.x, p.spr.y);
        if (d < nearDist) { nearDist = d; nearest = p; }
      });
      if (!nearest) { e.spr.setVelocity(0,0); return; }
      const nightMult = (this.isNight) ? 1.35 : 1;
      const aggroRange = e.aggroRange * nightMult;

      if (nearDist < aggroRange) {
        const spd = (e._effectiveSpeed !== undefined ? e._effectiveSpeed : e.speed) * nightMult;

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
                e.wallAttackTimer = this.isNight ? 900 : 1400;
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
          // directional flip is handled below in the walk-cycle block
        }

        if (nearDist < e.attackRange) {
          e.attackTimer -= delta;
          if (e.attackTimer <= 0) {
            const dmg = this._knightShieldBlock(nearest, e.spr.x, e.spr.y, e.dmg);
            nearest.hp -= dmg;
            nearest.hp = Math.max(0, nearest.hp);
            SFX.playerHurt();
            if (nearest.isSleeping) { this.wakePlayer(nearest); this._hideSleepIndicator(); this.hint(nearest.charData.player + ' was woken by an enemy!', 2000); }
            // Only apply red hurt tint if shield didn't already flash blue
            if (dmg >= e.dmg) {
              nearest.spr.setTint(0xff0000);
              this.time.delayedCall(150, () => {
                if (!nearest.spr?.active) return;
                if (nearest._frostSlowed) nearest.spr.setTint(0x88ccff);
                else nearest.spr.clearTint();
              });
            }
            e.attackTimer = e.atkInterval || (e.type==='bear' ? 2400 : e.type==='wolf' ? 1600 : 1200);
            this.checkDeaths();
          }
        }
      } else {
        e.wanderTimer -= delta;
        if (e.wanderTimer <= 0) {
          const ang = Math.random() * Math.PI * 2;
          const wspd = (e._effectiveSpeed !== undefined ? e._effectiveSpeed : e.speed) * 0.3;
          e.spr.setVelocity(Math.cos(ang)*wspd, Math.sin(ang)*wspd);
          e.wanderTimer = Phaser.Math.Between(1500, 3500);
        }
      }

      // ── Walk cycle + 8-direction sprites (raiders only) — skip if off-screen ──
      if (e.spr.visible) {
        e._walkTimer = ((e._walkTimer || 0) + delta) % 600;
        const _step = e._walkTimer < 300 ? '' : '_step';
        const _vx = e.spr.body.velocity.x, _vy = e.spr.body.velocity.y;
        const _moving = Math.abs(_vx) > 5 || Math.abs(_vy) > 5;
        if (_moving) {
          const _diagX = Math.abs(_vx) > 20, _diagY = Math.abs(_vy) > 20;
          if (_diagX && _diagY) e._dir = _vy > 0 ? 'fside' : 'bside';
          else if (Math.abs(_vy) > Math.abs(_vx)) e._dir = _vy > 0 ? 'front' : 'back';
          else e._dir = 'side';
        }
        const _dir = e._dir || 'side';
        const _flip = _vx < 0 || (_vx === 0 && e.spr.flipX);
        if (_dir === 'side' || _dir === 'fside' || _dir === 'bside') {
          e.spr.setFlipX(_vx < 0);
        } else {
          e.spr.setFlipX(false);
        }
        if (e.isRaider) {
          const _dirSuffix = _dir === 'side' ? '' : '_' + _dir;
          e.spr.setTexture('raider_' + e.type + _dirSuffix + (_moving ? _step : ''));
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

    // Music transitions + first-night contextual tip
    if (this.isNight && !wasNight) {
      Music.switchToNight();
      if (!this._ctx.firstNight) {
        this._ctx.firstNight = true;
        this.hint('Night falls — enemies are faster and more dangerous! Build Walls or sleep in a Bed.', 6000);
      }
    }

    const newDay = Math.floor(this.dayTimer / this.DAY_DUR) + 1;
    if (newDay !== this.dayNum) {
      this.dayNum = newDay;
      this._nightWallHinted = false; // D5 — reset so next night gives warning again
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
      // Boss daily check: after day 5, 25% chance each dawn — but not the same dawn a raid respawns
      else if (!this.bossSpawned && this.dayNum > 5 && Math.random() < 0.25) {
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
      this._addFireGlow(x, y);
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
    } else if (this.buildType === 'torch') {
      this._spawnTorch(x, y);
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

    // D7 — Spike trap placement (no physics body; triggers on enemy overlap)
    if (this.buildType === 'spike_trap') {
      const st = this.add.image(x, y, 'spike_trap').setScale(1.5).setDepth(4);
      if (this.hudCam) this.hudCam.ignore(st);
      this._w(st);
      // NOTE: st is a non-physics image — detection handled by updateSpikeTraps() each frame
      // so it works for enemies that spawn after placement too.
      this.spikeTraps.push(st);
      SFX._play(300, 'triangle', 0.08, 0.15);
      this.hint('Spike trap placed!', 1200);
      this.exitBuildMode(); return;
    }

    // Reinforced wall (300 HP variant)
    if (this.buildType === 'reinforced_wall') {
      const w = this.obstacles.create(x, y, 'wall').setDepth(5).setImmovable(true).setTint(0xaaaaff);
      w.setAngle(this.buildRotation * 90); w.refreshBody();
      w.hp = 300; w.maxHp = 300;
      this.builtWalls.push(w);
      if (this.hudCam) this.hudCam.ignore(w);
      SFX._play(400, 'triangle', 0.08, 0.2);
      this.hint('Reinforced Wall placed!', 1500);
      this.exitBuildMode(); return;
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
      if (!gate.active) return; // gate may have been destroyed by enemies
      gate.gateOpen = false;
      gate.setAlpha(1);
      gate.body.enable = true;
    });
  }

  getBuildCost(type) {
    const costs = {
      wall:              { wood: 3 },
      gate:              { wood: 4, metal: 2 },
      campfire:          { wood: 5 },
      craftbench:        { wood: 5, metal: 3 },
      bed:               { wood: 8, fiber: 6, metal: 2 },
      reinforced_wall:   { wood: 4, metal: 3 },
      spike_trap:        { wood: 2, metal: 1 },
      med_kit:           { fiber: 3, food: 2 },
      knight_upgrade:    { metal: 3, fiber: 2 },
      architect_upgrade: { metal: 3, wood: 2 },
      gunslinger_upgrade:{ metal: 2, fiber: 1 },
    };
    return costs[type] || {};
  }

  // ── CRAFT MENU ─────────────────────────────────────────────────
  static get RECIPES() {
    return [
      { label: 'Wall',               key: 'wall',              cost: {wood:3},                  needsBench: false, type: 'build' },
      { label: 'Gate',               key: 'gate',              cost: {wood:4, metal:2},         needsBench: false, type: 'build' },
      { label: 'Campfire',           key: 'campfire',          cost: {wood:5},                  needsBench: false, type: 'build' },
      { label: 'Torch',              key: 'torch',             cost: {wood:2, fiber:1},         needsBench: false, type: 'build' },
      { label: 'Spike Trap',         key: 'spike_trap',        cost: {wood:2, metal:1},         needsBench: false, type: 'build' },
      { label: 'Craftbench',         key: 'craftbench',        cost: {wood:5, metal:3},         needsBench: false, type: 'build' },
      { label: 'Bed',                key: 'bed',               cost: {wood:8, fiber:6, metal:2},needsBench: true,  type: 'build' },
      { label: 'Reinforced Wall',    key: 'reinforced_wall',   cost: {wood:4, metal:3},         needsBench: true,  type: 'build' },
      { label: 'Med Kit (+40 HP)',   key: 'med_kit',           cost: {fiber:3, food:2},         needsBench: true,  type: 'instant' },
      { label: 'Ammo Pack (+8)',     key: 'ammo_pack',         cost: {metal:2},                 needsBench: false, type: 'instant' },
      { label: 'Knight Upgrade',     key: 'knight_upgrade',    cost: {metal:3, fiber:2},        needsBench: true,  type: 'upgrade', charId: 'knight' },
      { label: 'Architect Upgrade',  key: 'architect_upgrade', cost: {metal:3, wood:2},         needsBench: true,  type: 'upgrade', charId: 'architect' },
      { label: 'Gunslinger Upgrade', key: 'gunslinger_upgrade',cost: {metal:2, fiber:1},        needsBench: true,  type: 'upgrade', charId: 'gunslinger' },
    ];
  }

  openCraftMenu(player) {
    if (this.craftMenuOpen) { this.closeCraftMenu(); return; }
    this.craftMenuOpen = true;
    this.craftMenuOwner = player;
    this.craftMenuSel = 0;
    // Contextual tip: first time opening crafting menu
    if (!this._ctx.firstCraft) {
      this._ctx.firstCraft = true;
      const craftHint = this._touchActive
        ? 'Tap to select, tap again (or ATK) to craft. Build Walls to protect yourself!'
        : 'Click to select, click again (or Attack) to craft. Build Walls to protect yourself!';
      this.time.delayedCall(400, () => this.hint(craftHint, 5000));
    } else if (!this._ctx.firstUpgradeHint && this.dayNum >= 2) {
      this._ctx.firstUpgradeHint = true;
      this.time.delayedCall(400, () => this.hint('Craft a Craftbench to unlock character upgrades — enemies get stronger each day!', 6000));
    }
    // Nav keys (reuse attack confirm, movement for up/down)
    this._craftNavUp   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this._craftNavUp2  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this._craftNavDn   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this._craftNavDn2  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    // Close is handled by the p1build/p2build key listeners (toggle via openCraftMenu)

    // Tap / click to select or craft — works for mouse and touch
    this._craftMenuPointerFn = (ptr) => {
      const { W, H } = CFG;
      const PW = 440, PH = 330, PX = (W - PW) / 2, PY = H - PH - 20;
      const px = ptr.x, py = ptr.y;
      if (px < PX || px > PX + PW || py < PY || py > PY + PH) return;
      const RECIPES = GameScene.RECIPES;
      for (let idx = 0; idx < RECIPES.length; idx++) {
        const rowY = PY + 34 + idx * 25;
        if (py >= rowY - 2 && py < rowY + 20) {
          if (idx === this.craftMenuSel) this.craftSelected();
          else this.craftMenuSel = idx;
          return;
        }
      }
    };
    this.input.on('pointerdown', this._craftMenuPointerFn);
  }

  closeCraftMenu() {
    this.craftMenuOpen = false;
    this.craftMenuOwner = null;
    if (this._craftMenuPointerFn) {
      this.input.off('pointerdown', this._craftMenuPointerFn);
      this._craftMenuPointerFn = null;
    }
    if (this.craftMenuGfx) { this.craftMenuGfx.destroy(); this.craftMenuGfx = null; }
    this._craftMenuText && this._craftMenuText.forEach(t => t.destroy());
    this._craftMenuText = [];
  }

  updateCraftMenu(delta) {
    if (!this.craftMenuOpen) return;
    const RECIPES = GameScene.RECIPES;

    // Keyboard navigate up / down
    if (Phaser.Input.Keyboard.JustDown(this._craftNavUp) || Phaser.Input.Keyboard.JustDown(this._craftNavUp2)) {
      this.craftMenuSel = (this.craftMenuSel - 1 + RECIPES.length) % RECIPES.length;
    }
    if (Phaser.Input.Keyboard.JustDown(this._craftNavDn) || Phaser.Input.Keyboard.JustDown(this._craftNavDn2)) {
      this.craftMenuSel = (this.craftMenuSel + 1) % RECIPES.length;
    }

    // Touch joystick navigate up / down (350ms repeat debounce)
    if (this._touchActive && this._joy) {
      this._craftTouchNavCd = (this._craftTouchNavCd || 0) - delta;
      const jy = this._joy.vec.y;
      if (this._craftTouchNavCd <= 0 && Math.abs(jy) > 0.5) {
        this.craftMenuSel = (this.craftMenuSel + (jy > 0 ? 1 : -1) + RECIPES.length) % RECIPES.length;
        this._craftTouchNavCd = 350;
      }
    }

    this.renderCraftMenu();
  }

  renderCraftMenu() {
    const RECIPES = GameScene.RECIPES;
    const { W, H } = CFG;
    const team = this.getTeamInv();
    const PW = 440, PH = 330, PX = (W - PW) / 2, PY = H - PH - 20;

    // Recreate graphics each frame (simple approach)
    if (this.craftMenuGfx) this.craftMenuGfx.destroy();
    this.craftMenuGfx = this.add.graphics().setScrollFactor(0).setDepth(96);
    if (this.hudCam) this.hudCam.ignore(this.craftMenuGfx);

    const g = this.craftMenuGfx;
    // Panel background
    g.fillStyle(0x0a1208, 0.92); g.fillRoundedRect(PX, PY, PW, PH, 8);
    g.lineStyle(2, 0x445533, 1); g.strokeRoundedRect(PX, PY, PW, PH, 8);

    // Destroy old text
    this._craftMenuText && this._craftMenuText.forEach(t => t.destroy());
    this._craftMenuText = [];

    const addTxt = (x, y, str, style) => {
      const t = this.add.text(x, y, str, Object.assign({ fontFamily:'monospace', fontSize:'11px' }, style))
        .setScrollFactor(0).setDepth(97);
      if (this.hudCam) this.hudCam.ignore(t);
      this._craftMenuText.push(t);
      return t;
    };

    addTxt(PX + PW/2, PY + 14, '[ CRAFTING ]', { fontSize:'14px', color:'#aacc88', stroke:'#000', strokeThickness:2 }).setOrigin(0.5);
    const navHint = this._touchActive
      ? 'Tap to select  |  Tap again / ATK = craft  |  BLD = close'
      : 'Click / W/S = select  |  Click again / Attack = craft  |  Q/0 = close';
    addTxt(PX + PW/2, PY + PH - 14, navHint, { fontSize:'9px', color:'#556644' }).setOrigin(0.5);

    // Hover detection for mouse (skip on touch)
    const mPtr = this._touchActive ? null : this.input.activePointer;
    const hoverIdx = mPtr
      ? RECIPES.findIndex((_, idx) => {
          const rowY = PY + 34 + idx * 25;
          return mPtr.x >= PX && mPtr.x <= PX + PW && mPtr.y >= rowY - 2 && mPtr.y < rowY + 20;
        })
      : -1;

    RECIPES.forEach((rec, idx) => {
      const rowY = PY + 34 + idx * 25;
      const isSelected = idx === this.craftMenuSel;
      const isHovered = idx === hoverIdx && !isSelected;

      // Selection highlight
      if (isSelected) {
        g.fillStyle(0x224411, 0.9); g.fillRect(PX + 6, rowY - 2, PW - 12, 22);
        g.lineStyle(1, 0x44aa22, 0.8); g.strokeRect(PX + 6, rowY - 2, PW - 12, 22);
      } else if (isHovered) {
        g.fillStyle(0x1a2a11, 0.7); g.fillRect(PX + 6, rowY - 2, PW - 12, 22);
      }

      // Bench requirement
      const locked = rec.needsBench && !this.craftBenchPlaced;
      // Can afford?
      const canAfford = !locked && Object.entries(rec.cost).every(([r,a]) => (team[r]||0) >= a);

      const nameColor = locked ? '#555544' : isSelected ? '#ffffff' : isHovered ? '#ddeedd' : '#aabbaa';
      const costColor = canAfford ? '#66ee44' : '#ee4422';

      const costStr = Object.entries(rec.cost).map(([r,a]) => a+' '+r).join(', ');
      const suffix  = locked ? ' [bench reqd]' : '';
      addTxt(PX + 18, rowY + 2, rec.label + suffix, { color: nameColor });
      addTxt(PX + PW - 18, rowY + 2, costStr, { color: costColor }).setOrigin(1, 0);
    });
  }

  craftSelected() {
    if (!this.craftMenuOpen) return;
    const RECIPES = GameScene.RECIPES;
    const rec = RECIPES[this.craftMenuSel];
    const player = this.craftMenuOwner;
    const team = this.getTeamInv();

    // Bench requirement
    if (rec.needsBench && !this.craftBenchPlaced) {
      this.hint('Need a Craftbench first!', 2000); return;
    }
    // Afford check — use rec.cost so display and deduction always agree
    const cost = rec.cost;
    for (const [res, amt] of Object.entries(cost)) {
      if ((team[res] || 0) < amt) {
        this.hint('Need ' + amt + ' ' + res + '! (have ' + (team[res]||0) + ')', 2000); return;
      }
    }

    this.closeCraftMenu();

    if (rec.type === 'build') {
      // Enter ghost build mode; resources are deducted in placeBuild() as normal
      this.buildMode = true;
      this.buildOwner = player;
      this.buildType = rec.key;
      this.buildRotation = 0;
      if (this.buildGhost) this.buildGhost.destroy();
      this.buildGhost = this.add.image(player.spr.x + 40, player.spr.y, 'build_ghost').setDepth(50).setAlpha(0.6);
      if (this.hudCam) this.hudCam.ignore(this.buildGhost);
      this.buildRotKey1 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
      this.buildRotKey2 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
      const costStr = Object.entries(cost).map(([k,v])=>v+' '+k).join(', ');
      this.hint('BUILD ' + rec.label.toUpperCase() + ': R/1=rotate | Attack=place | Cost: ' + costStr, 3000);
      return; // resources deducted at placement
    }

    // Deduct resources for instant/upgrade items
    for (const [res, amt] of Object.entries(cost)) {
      let left = amt;
      for (const p of [player, this.p1, this.p2].filter(Boolean)) {
        const take = Math.min(left, p.inv[res] || 0);
        p.inv[res] = (p.inv[res] || 0) - take; left -= take;
        if (left <= 0) break;
      }
    }

    if (rec.type === 'instant' && rec.key === 'ammo_pack') {
      // Ammo Pack: +8 reserve ammo for Gunslinger; small metal refund hint for others
      const gunslinger = [this.p1, this.p2].filter(Boolean).find(p => p.charData.id === 'gunslinger');
      if (gunslinger) {
        const maxReserve = 40 - gunslinger.ammo;
        const added = Math.min(8, maxReserve - gunslinger.reserveAmmo);
        gunslinger.reserveAmmo = Math.min(maxReserve, gunslinger.reserveAmmo + 8);
        this.hint('+' + Math.max(0, added) + ' ammo (Gunslinger)', 2000);
        this.redrawHUD();
      } else {
        this.hint('No Gunslinger in play — ammo wasted!', 2000);
      }
    } else if (rec.type === 'instant' && rec.key === 'med_kit') {
      // D8 — Med Kit: restore 40 HP to the crafting player, green flash
      player.hp = Math.min(player.maxHp, player.hp + 40);
      player.spr.setTint(0x44ff44);
      this.time.delayedCall(300, () => {
        if (!player.spr?.active) return;
        if (player._frostSlowed) player.spr.setTint(0x88ccff);
        else player.spr.clearTint();
      });
      this.hint(player.charData.player + ' used Med Kit: +40 HP!', 2000);
    } else if (rec.type === 'upgrade') {
      const target = [this.p1, this.p2].filter(Boolean).find(p => p.charData.id === rec.charId);
      if (!target) { this.hint('That character isn\'t in the game!', 2000); return; }
      // Per-character upgrade flags so each character tracks its own upgrade independently
      const upgradeFlag = '_' + rec.charId + 'Upgraded';
      if (target[upgradeFlag]) { this.hint('Already upgraded!', 1500); return; }
      target[upgradeFlag] = true;
      if (rec.charId === 'gunslinger') target._gunslingerClip = 12;
      target.spr.setTint(0xffaa22);
      this.time.delayedCall(400, () => {
        if (!target.spr?.active) return;
        if (target._frostSlowed) target.spr.setTint(0x88ccff);
        else target.spr.clearTint();
      });
      this.hint(rec.label + ' unlocked for ' + target.charData.player + '!', 3000);
    }
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
    this._score      = this._calcScore();
    this._nameSaved  = false;
    this._htmlInp    = null;
    this._defaultName = this.p2Name ? this.p1Name + ' & ' + this.p2Name : this.p1Name;

    // Clean up HTML input if scene is stopped by any means (back button, etc.)
    this.events.on('shutdown', () => this._cleanupInput());

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
    const modeLabel = (this.mode===1?'1P':'2P') + ' ' + (this.difficulty==='hardcore'?'HARDCORE':'SURVIVAL');

    const rows = [
      ['Survivors',       this._defaultName,                        '#aabbcc'],
      ['Mode',            modeLabel,                                '#8899aa'],
      ['Days survived',   'Day ' + this.days,                       '#ffee44'],
      ['Time alive',      timeStr,                                  '#cccccc'],
      ['Enemies killed',  this.kills + ' kills',                    '#ff8844'],
      ['Resources found', this.resources + ' items',                '#88cc66'],
      ['Boss defeated',   this.bossDefeated ? 'YES +500' : 'No',   this.bossDefeated ? '#ffdd44' : '#556666'],
    ];
    rows.forEach(([label, val, col], i) => {
      const y = panelY + 18 + i * 26;
      this.add.text(panelX + 18, y, label, { fontFamily:'monospace', fontSize:'13px', color:'#556677' }).setOrigin(0,0);
      this.add.text(panelX + panelW - 18, y, val, { fontFamily:'monospace', fontSize:'13px', color: col }).setOrigin(1,0);
    });

    // Total score
    this.add.text(W/2, panelY + panelH + 18, 'SCORE   ' + this._score.toLocaleString(), {
      fontFamily:'monospace', fontSize:'32px', color:'#ffdd44',
      stroke:'#000', strokeThickness:4,
    }).setOrigin(0.5);

    // ── Name entry section ─────────────────────────────────
    //   Layout (H=720): score total ~376, label ~414, input ~436, save btn ~472,
    //   leaderboard reveals from ~492, nav buttons at 636 (H-84).
    const nameAreaY = panelY + panelH + 56;  // 414
    this.add.text(W/2, nameAreaY, 'ENTER YOUR NAME', {
      fontFamily:'monospace', fontSize:'11px', color:'#778899',
    }).setOrigin(0.5);

    // HTML <input> overlaid on the Phaser canvas at game-space position
    this._htmlInp = this._createNameInput(this._defaultName, nameAreaY + 22);

    // SAVE button
    const saveY = nameAreaY + 58;   // 472
    this._saveBg  = this.add.graphics();
    this._saveTxt = this.add.text(W/2, saveY + 1, 'SAVE SCORE  \u21b5', {
      fontFamily:'monospace', fontSize:'13px', color:'#aaffaa', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);
    const _drawSave = (hl) => {
      this._saveBg.clear();
      this._saveBg.fillStyle(hl ? 0x113311 : 0x001a00, 0.9);
      this._saveBg.fillRoundedRect(W/2 - 90, saveY - 14, 180, 30, 8);
      this._saveBg.lineStyle(2, hl ? 0x66cc66 : 0x44aa44, 0.9);
      this._saveBg.strokeRoundedRect(W/2 - 90, saveY - 14, 180, 30, 8);
    };
    _drawSave(false);
    this._saveZone = this.add.zone(W/2, saveY, 180, 30).setInteractive({ useHandCursor: true });
    this._saveZone.on('pointerover',  () => { _drawSave(true);  this._saveTxt.setColor('#ffffff'); });
    this._saveZone.on('pointerout',   () => { _drawSave(false); this._saveTxt.setColor('#aaffaa'); });
    this._saveZone.on('pointerdown',  () => this._onNameSubmit());

    // Y anchor for leaderboard — revealed by _onNameSubmit after save btn hides
    this._postSaveY = saveY + 20;   // 492

    // ── Navigation buttons — always visible ──────────────
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
    this._keys = this.input.keyboard.addKeys({ enter:K.ENTER, space:K.SPACE, esc:K.ESC });
    this._keys.enter.on('down', () => {
      // Ignore if the HTML input currently has focus (its own keydown handler handles it)
      if (this._htmlInp && document.activeElement === this._htmlInp) return;
      if (!this._nameSaved) this._onNameSubmit();
      else this.restart();
    });
    this._keys.space.on('down', () => { if (this._nameSaved) this.restart(); });
    this._keys.esc.on('down',   () => this.goMenu());
  }

  // Create an HTML <input> element positioned over the Phaser canvas at game-space y.
  _createNameInput(defaultName, gameY) {
    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx = rect.width  / CFG.W;
    const sy = rect.height / CFG.H;

    const inp = document.createElement('input');
    inp.type      = 'text';
    inp.value     = defaultName;
    inp.maxLength = 28;
    inp.style.cssText = [
      'position:fixed',
      `left:${Math.round(rect.left + (CFG.W / 2 - 130) * sx)}px`,
      `top:${Math.round(rect.top  + gameY * sy)}px`,
      `width:${Math.round(260 * sx)}px`,
      `height:${Math.round(30 * sy)}px`,
      'background:#1a0808',
      'border:2px solid #885533',
      'color:#ffcc88',
      'font-family:monospace',
      `font-size:${Math.round(14 * Math.min(sx, sy))}px`,
      'text-align:center',
      'padding:2px 8px',
      'box-sizing:border-box',
      'z-index:9999',
      'outline:none',
      'border-radius:4px',
    ].join(';');

    // Enter in the HTML input saves the score; stopPropagation prevents Phaser
    // from also seeing the keydown and immediately triggering restart().
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this._onNameSubmit(); }
    });

    document.body.appendChild(inp);
    // Brief delay so Phaser's own focus-management doesn't steal it
    this.time.delayedCall(120, () => { if (inp.parentNode) { inp.focus(); inp.select(); } });
    return inp;
  }

  // Called when SAVE is clicked / Enter pressed in input / player navigates away.
  _onNameSubmit() {
    if (this._nameSaved) return;
    this._nameSaved = true;

    const name = (this._htmlInp ? this._htmlInp.value.trim() : '') || this._defaultName || 'Player';
    this._cleanupInput();

    // Swap save button text to a quick confirmation, then reveal leaderboard
    if (this._saveTxt) this._saveTxt.setText('\u2713  ' + name).setColor('#66ee66');
    if (this._saveZone) this._saveZone.disableInteractive();

    // Persist to localStorage
    const lb = this._loadLeaderboard();
    const isHighScore = lb.length < 5 || this._score > (lb[lb.length - 1]?.score ?? -1);
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    lb.push({ name, score: this._score, days: this.days, time: Math.floor(this.timeAlive), date: dateStr });
    lb.sort((a, b) => b.score - a.score);
    lb.splice(10);
    try { localStorage.setItem('iw_scores', JSON.stringify(lb)); } catch(e) {}

    // After short delay, hide save button and show leaderboard
    this.time.delayedCall(700, () => {
      if (this._saveBg)  this._saveBg.setVisible(false);
      if (this._saveTxt) this._saveTxt.setVisible(false);
      this._showLeaderboard(isHighScore);
    });
  }

  // Render TOP SCORES after save.  Fits between postSaveY (492) and buttons (636).
  _showLeaderboard(isHighScore) {
    const { W } = CFG;
    let y = this._postSaveY;

    if (isHighScore) {
      this.add.text(W/2, y, '\u2605  NEW HIGH SCORE  \u2605', {
        fontFamily:'monospace', fontSize:'14px', color:'#ffcc22',
      }).setOrigin(0.5);
      y += 22;
    }

    this.add.text(W/2 - 200, y, 'TOP SCORES', {
      fontFamily:'monospace', fontSize:'10px', color:'#445566',
    });
    y += 16;
    this._loadLeaderboard().slice(0, 5).forEach((entry, i) => {
      const col = i === 0 ? '#ffdd44' : '#778899';
      const datePart = entry.date ? '  ' + entry.date : '';
      const txt = (i + 1) + '.  ' + entry.name.padEnd(14) + entry.score.toLocaleString() + '  Day ' + entry.days + datePart;
      this.add.text(W/2 - 200, y + i * 14, txt, { fontFamily:'monospace', fontSize:'10px', color: col });
    });
  }

  _cleanupInput() {
    if (this._htmlInp) {
      try { document.body.removeChild(this._htmlInp); } catch(e) {}
      this._htmlInp = null;
    }
  }

  // Save silently (no leaderboard reveal) — used when player navigates away before saving.
  _ensureSaved() {
    if (!this._nameSaved) {
      this._nameSaved = true;
      const name = (this._htmlInp ? this._htmlInp.value.trim() : '') || this._defaultName || 'Player';
      const lb = this._loadLeaderboard();
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      lb.push({ name, score: this._score, days: this.days, time: Math.floor(this.timeAlive), date: dateStr });
      lb.sort((a, b) => b.score - a.score);
      lb.splice(10);
      try { localStorage.setItem('iw_scores', JSON.stringify(lb)); } catch(e) {}
    }
  }

  _loadLeaderboard() {
    try {
      const d = JSON.parse(localStorage.getItem('iw_scores') || '[]');
      return Array.isArray(d) ? d.filter(e => e && typeof e.score === 'number') : [];
    } catch(e) { return []; }
  }

  restart() {
    this._ensureSaved();
    this._cleanupInput();
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.time.delayedCall(300, () => this.scene.start('CharSelect'));
  }

  goMenu() {
    this._ensureSaved();
    this._cleanupInput();
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
