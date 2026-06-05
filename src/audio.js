// ============================================================
// IRON WASTELAND — Music (chiptune) + SFX, both Web Audio
// Split module — loaded by index.html as a classic <script> in
// dependency order. All split files share ONE global scope (no ES
// modules), so top-level symbols are visible across every file.
// Navigation map (MANIFEST) lives at the top of src/config.js.
// ============================================================
'use strict';


// ── CHIPTUNE MUSIC (Web Audio, no files needed) ───────────────
const Music = {
  ctx: null, gain: null, playing: false, mode: 'day', _loopTimer: null,
  start() {
    if (this.playing) return;
    try {
      // Reuse a single AudioContext across runs — iOS/Safari can't resume a freshly
      // created context without a new user gesture, so we keep one alive and just
      // suspend/resume it. gain stays connected across pauses.
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = 0.07;
        this.gain.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.playing = true;
      this.mode = 'day';
      this._dayLoop(this.ctx.currentTime);
    } catch(e) {}
  },
  stop() {
    this.playing = false;
    // Cancel any scheduled loop callback — otherwise queued setTimeouts keep firing
    // and re-enter _*Loop against a stopped/suspended context.
    if (this._loopTimer) { clearTimeout(this._loopTimer); this._loopTimer = null; }
    // Suspend rather than close, so the same ctx can be resumed on restart (iOS).
    if (this.ctx && this.ctx.state === 'running') { try { this.ctx.suspend(); } catch(e) {} }
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
  switchFromBoss(hint) {
    if (this.mode !== 'boss') return;
    // Prefer an explicit hint from the scene ('day'/'night') so a day->night
    // transition during the boss fight doesn't make us resume day music at dusk.
    // Fall back to _preBossMode, then day.
    this.mode = (hint === 'day' || hint === 'night') ? hint : (this._preBossMode || 'day');
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
    if (this.mode === 'boss')  return; // boss loop runs independently; resume when switchFromBoss fires
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
    if (this._loopTimer) clearTimeout(this._loopTimer);
    this._loopTimer = setTimeout(() => this._dayLoop(nextStart), delay);
  },
  _nightLoop(startAt) {
    if (!this.playing || !this.ctx) return;
    if (this.mode === 'boss') return; // boss loop runs independently; resume when switchFromBoss fires
    if (this.mode === 'day')  { this._dayLoop(this.ctx.currentTime); return; }
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
    if (this._loopTimer) clearTimeout(this._loopTimer);
    this._loopTimer = setTimeout(() => this._nightLoop(nextStart), delay);
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
    const len = b * 8;  // 2 bars — halved from 4 to keep per-call oscillator count ~23 and prevent audio-thread stall on spawn
    const now = this.ctx.currentTime;
    if (startAt + len < now) {
      const skips = Math.ceil((now - startAt) / len);
      startAt += skips * len;
    }
    const o = startAt - now;

    // Driving bass line — low E minor root motion (2-bar pattern)
    [[82.41,0],[82.41,b*2],[98,b*4],[82.41,b*6],
    ].forEach(([f,t]) => { if (o+t > -0.05) this._note(f, o+t, b*1.8, 'sawtooth', 0.5); });

    // Heroic melody stabs — E minor / G major intervals, driving eighth notes (2 bars)
    [[329.63,0,b*.6],[392,b,b*.5],[440,b*2,b*.6],[392,b*3,b*.5],
     [329.63,b*4,b*.6],[311.13,b*5,b*.5],[349.23,b*6,b*.6],[392,b*7,b*.5],
    ].forEach(([f,t,d]) => { if (o+t > -0.05) this._note(f, o+t, d, 'square', 0.3); });

    // Power chord stabs on every other beat (two-note parallel fifths)
    [0, b*2, b*4, b*6].forEach(t => {
      if (o+t > -0.05) {
        this._note(196, o+t, b*0.4, 'sawtooth', 0.22);
        this._note(293.66, o+t, b*0.4, 'sawtooth', 0.18);
      }
    });

    // Snare-like noise burst on beat 2
    if (o + b*2 > -0.05) SFX._noise(0.06, 0.45);

    // Sustained pad swells (triangle, lower octave for warmth)
    [[98,0,b*4,0.15],[110,b*4,b*4,0.15],
    ].forEach(([f,t,d,v]) => { if (o+t > -0.05) this._note(f, o+t, d, 'triangle', v); });

    const nextStart = startAt + len;
    const delay = Math.max(50, (nextStart - 0.5 - this.ctx.currentTime) * 1000);
    if (this._loopTimer) clearTimeout(this._loopTimer);
    this._loopTimer = setTimeout(() => this._bossLoop(nextStart), delay);
  },
};

const SFX = {
  _enabled: true,
  _noiseBuf: null,
  gain: null,       // separate SFX gain node; initialized lazily on first _play call
  _sfxVol: 1.0,    // pending volume (0–1); applied to gain node once it's created
  _play(freq, type, dur, vol, shape) {
    if (!this._enabled) return;
    try {
      const ctx = Music.ctx;
      if (!ctx) return;
      if (!this.gain) {
        this.gain = ctx.createGain();
        this.gain.gain.value = this._sfxVol;
        this.gain.connect(ctx.destination);
      }
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(this.gain);
      o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (shape === 'drop') o.frequency.linearRampToValueAtTime(freq*0.3, ctx.currentTime+dur);
      if (shape === 'rise') o.frequency.linearRampToValueAtTime(freq*2, ctx.currentTime+dur);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime+dur);
      o.start(ctx.currentTime); o.stop(ctx.currentTime+dur+0.01);
    } catch(e) {}
  },
  _getNoiseBuf(ctx) {
    if (!this._noiseBuf || this._noiseBuf.sampleRate !== ctx.sampleRate) {
      // 2-second white-noise buffer reused for all noise events
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    return this._noiseBuf;
  },
  _noise(dur, vol) {
    if (!this._enabled) return;
    try {
      const ctx = Music.ctx; if (!ctx) return;
      if (!this.gain) {
        this.gain = ctx.createGain();
        this.gain.gain.value = this._sfxVol;
        this.gain.connect(ctx.destination);
      }
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = this._getNoiseBuf(ctx);
      src.connect(g); g.connect(this.gain);
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
      src.start(); src.stop(ctx.currentTime + dur + 0.01);
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
  hit(type) {
    // Pitch by enemy mass: heavier = lower thud, lighter = higher yip.
    // Falls back to the original 160 Hz for anything unrecognised.
    let f = 160;
    if (type === 'bear' || type === 'heavy') f = 90;
    else if (type === 'rat' || type === 'dust_hound' || type === 'ice_crawler') f = 220;
    else if (typeof type === 'string' && type.startsWith('boss_')) f = 65;
    this._play(f, 'sawtooth', 0.08, 0.5, 'drop');
    this._noise(0.05, 0.3);
  },
  playerHurt() { this._play(200,'sawtooth',0.15,0.6,'drop'); },
  enemyDie()   { this._play(120,'square',0.2,0.5,'drop'); this._noise(0.1,0.25); },
};
