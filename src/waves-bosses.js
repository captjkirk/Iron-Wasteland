'use strict';
// ── src/waves-bosses.js — GameScene system 4: waves & bosses ─────────────────
// Loads right after src/world-gen.js and adds these methods to GameScene (ADR 0002).
// update() calls updateWaves and updateBoss; updateDayNight calls spawnBoss.

Object.assign(GameScene.prototype, {
  // ── BOSS SYSTEM ───────────────────────────────────────────────
  // forceKey ('boss_wolf', ...) skips the biome pick; _debugBossFromUrl uses it.
  spawnBoss(forceKey) {
    if (this.bossSpawned) return;
    this.bossSpawned = true;
    this._stageTrace = false; // we made it — stop per-stage trace
    this._log('spawnBoss: enter', 'world');

    const worldW = CFG.MAP_W * CFG.TILE, worldH = CFG.MAP_H * CFG.TILE;
    const { TILE } = CFG;

    // Pick boss type based on biome spread — random for now
    const bossTypes = [
      // hitbox: texture px, facing right (x mirrors when the boss faces left); it covers the drawn
      // body and head, not the thin bits (the wolf's tail, the spider's outer legs, the troll's horn
      // and spike tips). Redraw a boss texture, refit its box: `node tools/render-texture.js <key>`.
      // shadowY/shadowW: centre below the sprite centre and width of the shadow, world px; it sits
      // under the feet.
      { key: 'boss_golem',  name: 'Iron Golem',   biome: 'waste',  hp: 600, speed: 55,  dmg: 22, armor: 4, specialType: 'slam',   specialInterval: 5000,
        hitbox: { x: 2, y: 4, w: 112, h: 118 }, shadowY: 86, shadowW: 160 },
      { key: 'boss_wolf',   name: 'Alpha Wolf',    biome: 'grass',  hp: 420, speed: 100, dmg: 16, armor: 1, specialType: 'charge', specialInterval: 3500,
        hitbox: { x: 30, y: 42, w: 150, h: 88 }, shadowY: 92, shadowW: 230 },
      { key: 'boss_spider', name: 'Spider Queen',  biome: 'ruins',  hp: 480, speed: 85,  dmg: 18, armor: 2, specialType: 'spray',  specialInterval: 4200,
        hitbox: { x: 20, y: 18, w: 74, h: 85 }, shadowY: 66, shadowW: 150 },
      { key: 'boss_troll',  name: 'Frost Troll',   biome: 'tundra', hp: 700, speed: 65,  dmg: 28, armor: 5, specialType: 'slam',   specialInterval: 5800,
        hitbox: { x: 1, y: 10, w: 113, h: 112 }, shadowY: 86, shadowW: 160 },
      { key: 'boss_hydra',  name: 'Bog Hydra',     biome: 'swamp',  hp: 540, speed: 65,  dmg: 20, armor: 2, specialType: 'spray',  specialInterval: 4800,
        hitbox: { x: 5, y: 2, w: 104, h: 118 }, shadowY: 83, shadowW: 150 },
    ];
    // Biome-anchored pick — prefer a boss whose biome matches where the
    // players currently are, among the bosses this run has not met yet (#329).
    const bt = (forceKey && bossTypes.find(b => b.key === forceKey)) || this._pickBossType(bossTypes);
    this._bossesSeen.push(bt.key);
    this._log(`boss #${this._bossesSeen.length} spawned key=${bt.key}${forceKey ? ' (forced)' : ''}  day=${this.dayNum}`, 'world');

    // Spawn at a random map edge
    let bx, by;
    const side = Phaser.Math.Between(0, 3);
    if (side === 0)      { bx = Phaser.Math.Between(TILE*4, worldW-TILE*4); by = TILE*4; }
    else if (side === 1) { bx = Phaser.Math.Between(TILE*4, worldW-TILE*4); by = worldH-TILE*4; }
    else if (side === 2) { bx = TILE*4; by = Phaser.Math.Between(TILE*4, worldH-TILE*4); }
    else                 { bx = worldW-TILE*4; by = Phaser.Math.Between(TILE*4, worldH-TILE*4); }

    this._log(`spawnBoss: picked ${bt.name} at (${bx|0},${by|0})`, 'world');
    // Boss sprite: 1.5× on 112×120 textures ≈ 168×180 in-game (same pixel density as the players).
    const BOSS_SCALE = 1.5;
    // The 'boss_shadow' texture (56 px wide) was not redrawn: height keeps the old 3× base,
    // width comes from each boss's shadowW.
    const BOSS_SHADOW_SCALE_Y = 2.4;
    const spr = this.physics.add.image(bx, by, bt.key).setScale(BOSS_SCALE).setDepth(12);
    spr.setCollideWorldBounds(true);
    const hb = bt.hitbox;
    spr.body.setSize(hb.w, hb.h, false).setOffset(hb.x, hb.y);
    if (this.hudCam) this.hudCam.ignore(spr);
    this._log('spawnBoss: sprite created; adding collider', 'world');
    this.physics.add.collider(spr, this.obstacles, (bSpr, obstacle) => {
        // Terrain stays standing; only trees, rocks and player walls smash (#151).
        const k = obstacle?.texture?.key || '';
        if (k.startsWith('mountain') || k === 'ruin_block' || k === 'water_deep') return;
        const now = this.time.now;
        if (obstacle?.active && now > (this.boss?._smashCooldown || 0)) {
            if (this.boss) {
              this.boss._smashCooldown = now + 350;
              // Smashing costs momentum — slow the boss briefly so walls/terrain actually
              // delay it instead of being plowed through at full speed (player feedback:
              // "slow them down, not stop them"). Each smash refreshes the slow, so a wall
              // line meaningfully holds the boss up.
              this.boss._smashSlowUntil = now + 550;
            }
            this._bossSmash(obstacle);
        }
    });
    this._log('spawnBoss: collider added', 'world');

    // Shadow — tracks boss every frame, sits below the sprite so terrain still reads.
    const shadowY = bt.shadowY;
    const shadow = this.add.image(bx, by + shadowY, 'boss_shadow')
      .setScale(bt.shadowW / 56, BOSS_SHADOW_SCALE_Y)
      .setDepth(3).setAlpha(0.75);
    if (this.hudCam) this.hudCam.ignore(shadow);

    // HP bar (world-space, follows boss). Geometry is drawn once relative to origin
    // and the Graphics objects are just repositioned each frame; fill is refreshed
    // only when HP changes (see updateBoss).
    const hpBg  = this.add.graphics().setDepth(13);
    const hpBar = this.add.graphics().setDepth(14);
    if (this.hudCam) { this.hudCam.ignore(hpBg); this.hudCam.ignore(hpBar); }
    // Static background geometry — drawn once.
    {
      const _bw = 80, _bh = 8;
      hpBg.fillStyle(0x220000, 0.85);
      hpBg.fillRect(-_bw/2 - 1, -90, _bw + 2, _bh + 2);
      hpBg.fillStyle(0x440000, 0.7);
      hpBg.fillRect(-_bw/2 - 1, -103, _bw + 2, 14);
    }

    // Gentle day scaling: +10% per 5 days from day 10, cap 2.0x. Armor is not scaled.
    const _bossCycle = Math.max(0, Math.floor(((this.dayNum || 1) - 5) / 5));
    const _bossScale = Math.min(2.0, 1 + _bossCycle * 0.10);
    const _bossHp  = Math.max(1, Math.round(bt.hp  * this.hc.bossHpMult * _bossScale));
    const _bossDmg = Math.max(1, Math.round(bt.dmg * this.hc.bossDmgMult * _bossScale));
    this.boss = {
      spr, hp: _bossHp, maxHp: _bossHp,
      speed: bt.speed, dmg: _bossDmg, name: bt.name,
      isBoss: true, type: bt.key, armor: bt.armor || 0,
      attackTimer: 0, atkInterval: 1900,
      aggroRange: 99999, attackRange: 70, wanderTimer: 0, sizeMult: 1,
      hpBg, hpBar,
      shadow, shadowY, hitbox: hb, baseScale: BOSS_SCALE, _hitTweenUntil: 0,
      specialType: bt.specialType, specialInterval: bt.specialInterval,
      specialTimer: bt.specialInterval * 0.6, // first special fires sooner
      _bossState: 'chase', _telegraphTimer: 0, _telegraphGfx: null,
    };
    // Add boss to main enemy array so melee + bullets can hit it
    this.enemies.push(this.boss);

    // Screen-edge indicator \u2014 pulsing arrow visible on HUD when boss is off-screen
    const _bossInd = this.add.graphics().setDepth(200);
    this._ignoreInWorldCams(_bossInd); // HUD-only: main camera skips it, hudCam renders it
    this.boss._indicator = _bossInd;

    // Announce arrival
    this._log(`Boss spawned: ${bt.name}  hp=${_bossHp}  dmg=${_bossDmg}  armor=${bt.armor||0}  day=${this.dayNum}  cycle=${_bossCycle} scale=${_bossScale.toFixed(2)}x  diff=${this._diffMult().toFixed(1)}x`, 'world');
    this.hint('\u2620 ' + bt.name.toUpperCase() + ' APPROACHES! \u2620', 6000, { urgent: true });
    SFX.bossRoar();
    this._log('spawnBoss: roar done', 'world');
    // Defer boss music off the spawn frame. Prior freezes traced here: the first
    // _bossLoop call synchronously schedules 44+ Web Audio oscillators in one
    // shot, and Safari's audio thread can wedge the main thread when saturated.
    // By deferring, spawnBoss completes cleanly and the game stays responsive
    // even if audio stalls. Wrapped in try/catch as a final safety net.
    setTimeout(() => {
      try { Music.switchToBoss(); this._log('spawnBoss: music switched (deferred)', 'world'); }
      catch (e) { this._log('Music.switchToBoss ERR: ' + (e && e.message || e), 'error'); }
    }, 100);
    this._log('spawnBoss: music scheduled', 'world');

    // Camera shake
    this._camFx('shake', [800, 0.012]);
    this._log('spawnBoss: shake scheduled', 'world');

    // Schedule entourage — 4-8 regular enemies nearby, spaced across frames so the
    // physics world isn't asked to register N colliders in a single frame (the sync
    // spawn was a freeze culprit on Day-5 with 400+ bodies already active).
    const entourageCount = Phaser.Math.Between(4, 8);
    this._log(`spawnBoss: entourage scheduled  count=${entourageCount}`, 'world');
    const typeKey = (bt.biome === 'tundra') ? 'wolf' : (bt.biome === 'swamp') ? 'rat' : 'wolf';
    const t = typeKey === 'wolf'
      ? { key:'wolf', hp:60, speed:100, dmg:9, baseScale:0.9, w:40, h:24 }
      : { key:'rat',  hp:30, speed:140, dmg:6, baseScale:0.7, w:30, h:18 };
    const baseAggro = { wolf: 190, rat: 110 }[t.key] || 160;
    for (let i = 0; i < entourageCount; i++) {
      this.time.delayedCall(i * 120, () => {
        if (this.isOver || !this.boss || !this.boss.spr?.active) return;
        const ang = (i / entourageCount) * Math.PI * 2;
        const ex = bx + Math.cos(ang) * 100;
        const ey = by + Math.sin(ang) * 100;
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
        this.enemies.push({
          spr: eSpr, hp: Math.floor(t.hp * sizeMult), maxHp: Math.floor(t.hp * sizeMult),
          speed: t.speed * sizeMult, dmg: Math.max(1, Math.floor(t.dmg * sizeMult)),
          type: t.key, attackTimer: 0,
          wanderTimer: Phaser.Math.Between(0, 1000),
          // Escort: map-wide aggro + dormancy-exempt so they actively march toward the
          // player WITH the boss instead of going dormant at the distant edge spawn and
          // never being seen (the "boss had no entourage" report).
          aggroRange: 99999, attackRange: (30 + t.w/4) * sizeMult,
          _bossEscort: true,
          sizeMult,
        });
        this._log(`spawnBoss: entourage spawned  i=${i}`, 'world');
        if (i === entourageCount - 1) {
          this._log(`spawnBoss: entourage complete  spawned=${entourageCount}  total_enemies=${this.enemies.length}`, 'world');
        }
      });
    }
  },

  // Next boss type: every boss once before any repeats (_bossesSeen, oldest first), and within
  // that the one whose biome the players stand in, else a random one. A new round never opens
  // with the boss that just left.
  _pickBossType(bossTypes) {
    const seen = this._bossesSeen;
    const roundSeen = seen.slice(seen.length - (seen.length % bossTypes.length));
    let pool = bossTypes.filter(b => !roundSeen.includes(b.key));
    const last = seen[seen.length - 1];
    if (pool.length > 1) pool = pool.filter(b => b.key !== last);
    let matches = [];
    try {
      const anchor = (this.p1 && this.p1.spr) ? this.p1 : (this.p2 && this.p2.spr ? this.p2 : null);
      const pbiome = anchor ? getBiome(Math.floor(anchor.spr.x / CFG.TILE), Math.floor(anchor.spr.y / CFG.TILE)) : null;
      matches = pool.filter(b => b.biome === pbiome);
    } catch (e) { /* no biome: random from the pool */ }
    const from = matches.length ? matches : pool;
    return from[Phaser.Math.Between(0, from.length - 1)];
  },

  // Boss barrels through obstacles instead of getting stuck. Removes the tile from
  // the solid set, repaints the minimap, plays a flash + debris + shake, destroys it.
  _bossSmash(obstacle) {
    try {
      const ox = obstacle.x, oy = obstacle.y;
      const tx = Math.floor(ox / CFG.TILE), ty = Math.floor(oy / CFG.TILE);
      // Free the tile so pathfinding/placement no longer treats it as solid.
      if (this._solidTileSet) this._solidTileSet.delete(tx + ',' + ty);
      // Repaint the minimap cell back to its underlying terrain (takes world coords).
      if (this._unpaintMinimapTile) this._unpaintMinimapTile(ox, oy);

      // Brief orange impact flash.
      const flash = this.add.graphics().setDepth(13);
      if (this.hudCam) this.hudCam.ignore(flash);
      flash.fillStyle(0xff6600, 0.6); flash.fillCircle(ox, oy, 28);
      flash.fillStyle(0xffcc44, 0.9); flash.fillCircle(ox, oy, 18);
      this.time.delayedCall(120, () => { if (flash && flash.active) flash.destroy(); });

      // Three debris chips flung outward in different directions, fading out.
      for (let i = 0; i < 3; i++) {
        const ang = (Math.PI * 2 / 3) * i + Phaser.Math.FloatBetween(-0.4, 0.4);
        const chip = this.add.graphics().setDepth(13);
        if (this.hudCam) this.hudCam.ignore(chip);
        chip.fillStyle(0x6b4a2a, 1); chip.fillRect(-2.5, -2.5, 5, 5);
        chip.setPosition(ox, oy);
        const dist = Phaser.Math.Between(14, 26);
        this.tweens.add({
          targets: chip,
          x: ox + Math.cos(ang) * dist,
          y: oy + Math.sin(ang) * dist,
          alpha: 0,
          duration: 350,
          ease: 'Quad.easeOut',
          onComplete: () => { if (chip && chip.active) chip.destroy(); },
        });
      }

      this._camFx('shake', [180, 0.009]);
      this._log('boss smash  type=' + (this.boss?.type || '?') + '  tile=(' + tx + ',' + ty + ')', 'world');
      obstacle.destroy();
    } catch (e) {
      this._log('boss smash ERR: ' + (e && e.message || e), 'error');
    }
  },

  // Reach distance from a boss to (x, y). Every boss once had the same 84 px square body, and
  // the bite, charge, slam and player-melee ranges were tuned as centre distances for it. Each
  // boss now has a drawn-to-fit hitbox (#312, #317) and measures to the edge of that hitbox plus
  // the old half-width (42), so the same ranges reach from its whole body, not just its middle.
  _bossDist(b, x, y) {
    const body = b.hitbox && b.spr.body;
    if (!body) return Phaser.Math.Distance.Between(b.spr.x, b.spr.y, x, y);
    const dx = Math.max(body.x - x, 0, x - body.right), dy = Math.max(body.y - y, 0, y - body.bottom);
    return Math.hypot(dx, dy) + 42;
  },

  // ?boss=wolf (or golem, spider, troll, hydra) spawns that boss 3 s after the world is ready,
  // to test a boss without playing to it. Called once at world-ready.
  _debugBossFromUrl() {
    let name = null;
    try { name = new URLSearchParams(location.search).get('boss'); } catch (e) { return; }
    if (!name) return;
    const key = name.startsWith('boss_') ? name : 'boss_' + name;
    this._log(`debug: ?boss=${name}, spawning ${key} in 3 s`, 'world');
    this.time.delayedCall(3000, () => { if (!this.isOver && !this.bossSpawned) this.spawnBoss(key); });
  },

  updateBoss(delta) {
    if (!this.boss || this.isOver) return;
    const b = this.boss;
    if (b.hp <= 0 || !b.spr.active) {
      // Clean up HP bar
      if (b.hpBg && b.hpBg.active) b.hpBg.destroy();
      if (b.hpBar && b.hpBar.active) b.hpBar.destroy();
      if (b.shadow && b.shadow.active) b.shadow.destroy();
      this.boss = null;
      this.bossSpawned = false; // the next boss day may spawn again (#329)
      return;
    }

    // Decay the boss flinch timer here — the boss is excluded from the main enemy
    // loop (where every other enemy's _flinchTimer is decremented), so without this
    // a single hit would pin it > 0 forever and the regen gate below could never open.
    if (b._flinchTimer > 0) b._flinchTimer -= delta;

    // Bog Hydra passive HP regen — 8 HP/s. Suppress while flinching from a
    // recent hit so sustained DPS actually drops HP instead of racing regen.
    if (b.type === 'boss_hydra' && b.hp < b.maxHp && b.hp > 0 && !(b._flinchTimer > 0)) {
      b.hp = Math.min(b.maxHp, b.hp + 8 * (delta / 1000));
    }

    // ── Animation: shadow, idle breathing, walk bob ─────────────
    // Shadow tracks the boss's true world position (not the bobbed sprite y).
    if (b.shadow && b.shadow.active) {
      b.shadow.setPosition(b.spr.x, b.spr.y + b.shadowY);
    }
    // Idle breath — gentle scale pulse. Walk bob — vertical sprite offset when moving.
    // Skipped while hit-squash tween is overriding scale (b._hitTweenUntil > now).
    const nowMs = this.time.now;
    if (b.baseScale && nowMs > (b._hitTweenUntil || 0)) {
      const breath = 1 + Math.sin(nowMs / 450) * 0.035;
      b.spr.setScale(b.baseScale * breath, b.baseScale * (2 - breath));
    }
    const vx = b.spr.body ? b.spr.body.velocity.x : 0;
    const vy = b.spr.body ? b.spr.body.velocity.y : 0;
    // Only bob the visual display via setDisplayOrigin offset won't work cleanly;
    // instead we leave physics unaffected and let the walk bob ride as the
    // sprite's natural y while the body continues its motion. Phaser physics
    // bodies track sprite.y, so we add the bob to a display-only offset field.
    const movingMag2 = vx*vx + vy*vy;
    if (movingMag2 > 100) {
      // Tilt/bob via rotation in radians — cheap and doesn't fight physics.
      b.spr.setRotation(Math.sin(nowMs / 140) * 0.04);
    } else {
      b.spr.setRotation(Phaser.Math.Linear(b.spr.rotation, 0, 0.2));
    }

    // Update world-space HP bar above boss — position tracks every frame, fill only
    // refreshes when HP crosses a 1% step. Background geometry is drawn once at spawn.
    const bx = b.spr.x, by = b.spr.y;
    const barW = 80, barH = 8;
    // Defensive: if the HP graphics were destroyed out-of-band (tween or
    // restart edge case) skip the draw rather than crash on .clear().
    if (!b.hpBg || !b.hpBg.active || !b.hpBar || !b.hpBar.active) return;
    // Position-track every frame (cheap). The fill inside the bar is redrawn
    // only when the display HP changes, combining HEAD's dirty-step
    // optimization with the smooth-lerp ghost segment from the review branch.
    b.hpBg.setPosition(bx, by);
    b.hpBar.setPosition(bx, by);
    if (b._hpDisplay === undefined) b._hpDisplay = b.hp;
    b._hpDisplay += (b.hp - b._hpDisplay) * Math.min(1, delta / 120);
    const truePct = Math.max(0, b.hp / b.maxHp);
    const dispPct = Math.max(0, Math.min(1, b._hpDisplay / b.maxHp));
    const trueStep = Math.round(truePct * 100);
    const dispStep = Math.round(dispPct * 100);
    if (b._lastTrueStep !== trueStep || b._lastDispStep !== dispStep) {
      b._lastTrueStep = trueStep;
      b._lastDispStep = dispStep;
      const col = truePct > 0.5 ? 0xff3300 : truePct > 0.25 ? 0xff8800 : 0xff0000;
      b.hpBar.clear();
      if (dispPct > truePct) {
        b.hpBar.fillStyle(0xffee88, 0.55);
        b.hpBar.fillRect(-barW/2, -89, barW * dispPct, barH);
      }
      b.hpBar.fillStyle(col, 1);
      b.hpBar.fillRect(-barW/2, -89, barW * truePct, barH);
    }
    // (we'll draw text via label instead of graphics)
    if (!b.nameLabel) {
      b.nameLabel = this.add.text(0, 0, '\u2620 ' + b.name.toUpperCase(), {
        fontFamily:'monospace', fontSize:'9px', color:'#ffaaaa',
      }).setDepth(15).setOrigin(0.5, 0);
      if (this.hudCam) this.hudCam.ignore(b.nameLabel);
    }
    b.nameLabel.setPosition(bx, by - 103);

    // Radar-edge threat indicator — pulsing arrow just outside the radar circle when boss is off-screen
    if (b._indicator && b._indicator.active) {
      const rc = this.radarCenter;
      if (rc) {
        const cam = this.cameras.main;
        const GW = CFG.W, GH = CFG.H;
        const screenX = (bx - cam.scrollX) * cam.zoom;
        const screenY = (by - cam.scrollY) * cam.zoom;
        const offScreen = screenX < -40 || screenX > GW + 40 || screenY < -40 || screenY > GH + 40;
        // Clear only when we need to redraw (off-screen) or when transitioning on-screen.
        if (offScreen || b._indicatorWasOff) b._indicator.clear();
        b._indicatorWasOff = offScreen;
        if (offScreen) {
          // Angle from viewport center (≈ player) to boss, same compass as the radar dot
          const ang = Math.atan2(by - cam.worldView.centerY, bx - cam.worldView.centerX);
          // Place arrow just outside the radar circle perimeter
          const ex = rc.x + Math.cos(ang) * (rc.r + 9);
          const ey = rc.y + Math.sin(ang) * (rc.r + 9);
          const pulse = Math.sin(this.time.now / 220) * 0.35 + 0.65;
          const tip = { x: ex + Math.cos(ang) * 9,   y: ey + Math.sin(ang) * 9 };
          const l   = { x: ex + Math.cos(ang + 2.3) * 6, y: ey + Math.sin(ang + 2.3) * 6 };
          const r   = { x: ex + Math.cos(ang - 2.3) * 6, y: ey + Math.sin(ang - 2.3) * 6 };
          b._indicator.fillStyle(0xff2200, pulse);
          b._indicator.fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
          b._indicator.lineStyle(1.5, 0xff5500, pulse * 0.45);
          b._indicator.strokeCircle(ex, ey, 7 + Math.sin(this.time.now / 180) * 2);
        }
      }
    }

    // Boss chases nearest player — relentless, no wander
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && p.hp > 0);
    if (players.length === 0) { b.spr.setVelocity(0, 0); return; }

    // Periodic position snapshot so logs can trace boss pathing (throttled to ~every 5s)
    if (!b._lastPosLog || this.time.now - b._lastPosLog > 5000) {
      b._lastPosLog = this.time.now;
      const _p1dist = this.p1?.spr ? Phaser.Math.Distance.Between(bx, by, this.p1.spr.x, this.p1.spr.y) : -1;
      this._log(`boss pos  type=${b.type}  tile=(${Math.floor(bx/CFG.TILE)},${Math.floor(by/CFG.TILE)})  hp=${b.hp}/${b.maxHp}  dist_p1=${Math.round(_p1dist)}  state=${b._bossState}`, 'world');
    }

    let nearest = players[0], nearDist = Phaser.Math.Distance.Between(b.spr.x, b.spr.y, players[0].spr.x, players[0].spr.y);
    players.forEach(p => {
      const d = Phaser.Math.Distance.Between(b.spr.x, b.spr.y, p.spr.x, p.spr.y);
      if (d < nearDist) { nearDist = d; nearest = p; }
    });

    // ── HP-THRESHOLD PHASES ──────────────────────────────────────
    // Unlock two enrage tiers as the boss loses HP. Each tier bumps
    // aggression so the fight has arcs instead of a flat DPS race.
    const _hpPct = b.hp / b.maxHp;
    if (!b._phase2 && _hpPct <= 0.66) {
      b._phase2 = true;
      b.specialInterval = Math.max(2200, Math.floor(b.specialInterval * 0.75));
      b.speed = Math.floor(b.speed * 1.15);
      b.dmg   = Math.ceil(b.dmg * 1.10);
      this._log(`boss enraged (66%)  type=${b.type}  newSpeed=${b.speed}  newDmg=${b.dmg}`, 'world');
      this.hint('⚠ ' + b.name.toUpperCase() + ' is ENRAGED!', 2500, { urgent: true });
      if (typeof SFX !== 'undefined' && SFX._play) SFX._play(130, 'sawtooth', 0.3, 0.4, 'drop');
      b.spr.setTint(0xffbb88);
      this.time.delayedCall(240, () => { if (b.spr && b.spr.active) b.spr.clearTint(); });
    }
    if (!b._phase3 && _hpPct <= 0.33) {
      b._phase3 = true;
      b.specialInterval = Math.max(1600, Math.floor(b.specialInterval * 0.65));
      b.speed = Math.floor(b.speed * 1.20);
      b.dmg   = Math.ceil(b.dmg * 1.15);
      this._log(`boss FERAL (33%)  type=${b.type}  newSpeed=${b.speed}  newDmg=${b.dmg}`, 'world');
      this.hint('⚠ ' + b.name.toUpperCase() + ' is FERAL!', 2500, { urgent: true });
      if (typeof SFX !== 'undefined' && SFX._play) SFX._play(100, 'sawtooth', 0.4, 0.6, 'drop');
      b.spr.setTint(0xff5533);
      this.time.delayedCall(320, () => { if (b.spr && b.spr.active) b.spr.clearTint(); });
    }

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

      // Chase toward nearest foe — use obstacle steering so the boss can't freeze on terrain.
      // Halve speed briefly after smashing an obstacle so walls/terrain slow it down.
      const _chaseSpd = (this.time.now < (b._smashSlowUntil || 0)) ? b.speed * 0.5 : b.speed;
      const vel = this._steerToward(b, foeX, foeY, _chaseSpd);
      b._bossEscTimer = (b._bossEscTimer || 0) - delta;
      if (b._bossEscTimer > 0) {
        // escape burst active — keep current velocity, don't overwrite
      } else if (vel.x === 0 && vel.y === 0) {
        b._bossStuckDur = (b._bossStuckDur || 0) + delta;
        if (b._bossStuckDur > 600) {
          b._bossStuckDur = 0;
          const escAng = Phaser.Math.FloatBetween(0, Math.PI * 2);
          b.spr.setVelocity(Math.cos(escAng) * b.speed * 2, Math.sin(escAng) * b.speed * 2);
          b._bossEscTimer = 800;
          this._log(`boss unstuck  type=${b.type}  tile=(${Math.floor(b.spr.x/CFG.TILE)},${Math.floor(b.spr.y/CFG.TILE)})`, 'world');
        }
      } else {
        b._bossStuckDur = 0;
        b.spr.setVelocity(vel.x, vel.y);
      }
      b.spr.setFlipX(foeX < b.spr.x);
      if (b.hitbox) { // Arcade bodies do not mirror with flipX
        const hb = b.hitbox;
        b.spr.body.setOffset(b.spr.flipX ? b.spr.width - hb.x - hb.w : hb.x, hb.y);
      }

      // Special attacks always target the nearest player even when fighting raiders
      if (b.specialTimer <= 0 && nearDist < 300) {
        b._bossState = 'telegraph';
        b._telegraphTimer = 900;
        b._lockedTarget = nearest;
        this._bossTelegraph(b, nearest);
      }

      // Alpha Wolf howl — summon 2 wolves when below 50% HP, every 12s
      if (b.type === 'boss_wolf' && b.hp < b.maxHp * 0.65) {
        if (!b._howlTimer) b._howlTimer = 12000;
        b._howlTimer -= delta;
        if (b._howlTimer <= 0) {
          b._howlTimer = 12000;
          this.hint('\u2620 Alpha Wolf HOWLS! Wolves incoming!', 2000, { urgent: true });
          SFX._play(180, 'sawtooth', 0.2, 0.65, 'drop');
          this._camFx('shake', [400, 0.007]);
          const wW = CFG.MAP_W * CFG.TILE, wH = CFG.MAP_H * CFG.TILE;
          for (let i = 0; i < 2; i++) {
            const ang = Math.random() * Math.PI * 2;
            const ex = Phaser.Math.Clamp(b.spr.x + Math.cos(ang) * 90, CFG.TILE*2, wW-CFG.TILE*2);
            const ey = Phaser.Math.Clamp(b.spr.y + Math.sin(ang) * 90, CFG.TILE*2, wH-CFG.TILE*2);
            const sizeMult = Phaser.Math.FloatBetween(0.9, 1.15);
            const sc = 0.95 * sizeMult;
            const eSpr = this.physics.add.image(ex, ey, 'wolf').setScale(sc).setDepth(9);
            eSpr.setCollideWorldBounds(true);
            eSpr.body.setSize(40, 24);
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
      if (this._bossDist(b, foeX, foeY) < 70) {
        b.attackTimer -= delta;
        if (b.attackTimer <= 0) {
          b.attackTimer = b.atkInterval;
          if (aggroRaider) {
            // Hit the raider — uses _hurtEnemy so flinch + log applies
            this._hurtEnemy(aggroRaider, b.dmg, b.spr.x, b.spr.y);
          } else {
            nearest.hp = Math.max(0, nearest.hp - b.dmg);
            this._log(nearest.charData.player + ' hit for ' + b.dmg + '  hp=' + nearest.hp + '/' + nearest.maxHp, 'combat');
            SFX.playerHurt();
            this._floatDamage(nearest.spr.x, nearest.spr.y - 18, b.dmg);
            nearest.spr.setTint(0xff0000);
            this._camFx('shake', [300, 0.008]);
            this.time.delayedCall(200, () => {
              if (!nearest.spr?.active) return;
              if (nearest._frostSlowed) nearest.spr.setTint(0x88ccff);
              else nearest.spr.clearTint();
            });
            // Frost Troll — apply frost slow on melee hit
            if (b.type === 'boss_troll' && !nearest._frostSlowed) {
              nearest._frostSlowed = true;
              this._hudDirty = true;
              nearest._speedMult = 0.55;
              this._log(`${nearest.charData.player} frost slowed  hp=${nearest.hp}/${nearest.maxHp}`, 'combat');
              this._showStatus('FROST SLOW! (-45% speed)', 1500);
              this.time.delayedCall(280, () => { if (nearest.spr?.active && nearest._frostSlowed) nearest.spr.setTint(0x88ccff); });
              this.time.delayedCall(3000, () => {
                if (!nearest) return;
                nearest._frostSlowed = false;
                this._hudDirty = true;
                nearest._speedMult = 1;
                this._log(`${nearest.charData.player} frost slow expired`, 'combat');
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
  },

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
  },

  // Execute the telegraphed special attack — called 900ms after _bossTelegraph.
  _bossExecuteSpecial(b, nearest) {
    if (b._telegraphGfx && b._telegraphGfx.active) { b._telegraphGfx.destroy(); b._telegraphGfx = null; }
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && p.hp > 0 && p.spr.active);
    this._log(`Boss special: ${b.specialType}  boss=${b.type}  hp=${b.hp}/${b.maxHp}  pct=${Math.round(b.hp/b.maxHp*100)}%`, 'combat');

    if (b.specialType === 'slam') {
      // ── Ground Slam: AoE damage within 130px, big shake ──────
      this._camFx('shake', [500, 0.02]);
      SFX._play(55, 'sawtooth', 0.45, 0.55, 'drop');
      // Impact ring flash
      const ring = this.add.graphics().setDepth(20);
      if (this.hudCam) this.hudCam.ignore(ring);
      ring.lineStyle(6, b.type === 'boss_troll' ? 0x88ccff : 0xff4400, 1.0);
      ring.strokeCircle(b.spr.x, b.spr.y, 130);
      this.tweens.add({ targets: ring, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
      // Damage
      players.forEach(p => {
        if (this._bossDist(b, p.spr.x, p.spr.y) < 130) {
          const slamDmg = this._knightShieldBlock(p, b.spr.x, b.spr.y, Math.round(b.dmg * 0.85));
          p.hp = Math.max(0, p.hp - slamDmg);
          this._log(`${p.charData.player} boss stomp  dmg=${slamDmg}  hp=${p.hp}/${p.maxHp}`, 'combat');
          SFX.playerHurt();
          this._floatDamage(p.spr.x, p.spr.y - 18, slamDmg);
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
          if (this._bossDist(b, p.spr.x, p.spr.y) < 55) {
            const chargeDmg = this._knightShieldBlock(p, b.spr.x, b.spr.y, Math.round(b.dmg * 1.3));
            p.hp = Math.max(0, p.hp - chargeDmg);
            this._log(`${p.charData.player} troll charge  dmg=${chargeDmg}  hp=${p.hp}/${p.maxHp}`, 'combat');
            SFX.playerHurt();
            this._floatDamage(p.spr.x, p.spr.y - 18, chargeDmg);
            p.spr.setTint(0xff8800);
            this._camFx('shake', [250, 0.01]);
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
            if (!blt.active || !p.spr?.active) return;
            const bx = blt.x, by = blt.y;
            blt.destroy();
            const sprayDmg = this._knightShieldBlock(p, bx, by, Math.round(b.dmg * 0.75));
            p.hp = Math.max(0, p.hp - sprayDmg);
            this._log(`${p.charData.player} boss spray  dmg=${sprayDmg}  hp=${p.hp}/${p.maxHp}`, 'combat');
            SFX.playerHurt();
            this._floatDamage(p.spr.x, p.spr.y - 18, sprayDmg);
            p.spr.setTint(col);
            // Spider Queen web: root player briefly (1.5s)
            if (b.type === 'boss_spider' && !p._webbed) {
              p._webbed = true;
              this._hudDirty = true;
              p._speedMult = 0;
              this._log(`${p.charData.player} webbed by boss_spider – immobilised 1.5s hp=${p.hp}/${p.maxHp}`, 'combat');
              this._showStatus('WEBBED! Can\'t move!', 1500);
              this.time.delayedCall(1500, () => {
                if (!p) return;
                p._webbed = false;
                this._hudDirty = true;
                p._speedMult = 1;
                this._log(`${p.charData.player} web expired`, 'combat');
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
  },

  // Night 1 comes in three small groups, 12 s apart, each strung out over a wide arc and distance, never more than 10 of the wave on the
  // field at once, so a first-time player is met rather than swarmed (Hudson, Oct 2026: all 21
  // animals reached him together). Day 1 only; every later wave spawns whole.
  _spawnFirstWave(counts) {
    const GROUPS = 3, GAP_MS = 12000, MAX_AT_ONCE = 10, GIVE_UP_MS = 60000, FIRST_WAVE_SPREAD = 1000; // px: the ring runs 900-2300 out, not 900-1300
    const left = { ...counts }, wn = this.waveNum, t0 = this.time.now;
    const send = () => {
      if (this.isOver || !this.enemies) return;
      let room = MAX_AT_ONCE - this.enemies.filter(e => e._waveNum === wn && e.spr?.active && !e.dying).length;
      const g = {};
      for (const k in left) { g[k] = Math.max(0, Math.min(left[k], Math.ceil(counts[k] / GROUPS), room)); room -= g[k]; left[k] -= g[k]; }
      if (Object.values(g).some(n => n > 0)) this._spawnGroup(this.enemyWorldW, this.enemyWorldH, this.enemyCX, this.enemyCY, g, true, FIRST_WAVE_SPREAD);
      // ponytail: a group sent while no player is up is lost, as a whole wave already was.
      if (Object.values(left).some(n => n > 0) && this.time.now - t0 < GIVE_UP_MS) this._firstWaveTimer = this.time.delayedCall(GAP_MS, send);
    };
    send();
  },

  updateWaves(delta) {
    this.waveTimer += delta;
    if (this.waveTimer >= this.WAVE_INTERVAL) {
      this.waveTimer = 0;
      this.waveNum++;
      if (this.enemies.length >= CFG.MAX_ENEMIES) {
        const _wSkip = Math.min(6 + this.waveNum * 2, 20), _rSkip = Math.min(8 + this.waveNum * 3, 30), _bSkip = Math.min(1 + this.waveNum, 8);
        this._log('Wave ' + this.waveNum + ' capped — MAX_ENEMIES reached (' + this.enemies.length + '/' + CFG.MAX_ENEMIES + ')  skipped: w=' + _wSkip + ' r=' + _rSkip + ' b=' + _bSkip, 'world');
        return;
      }
      // Escalating counts — clamped to the remaining headroom under MAX_ENEMIES so a
      // day-boundary wave can't blow past the cap (was overshooting 280 → 305-318,
      // which then starved biome/den spawns and added pointless update cost).
      let _head = Math.max(0, CFG.MAX_ENEMIES - this.enemies.length);
      const _take = n => { const v = Math.min(n, _head); _head -= v; return v; };
      const w = _take(Math.min(6 + this.waveNum * 2, 20));
      const r = _take(Math.min(8 + this.waveNum * 3, 30));
      const b = _take(Math.min(1 + this.waveNum, 8));
      if (this.dayNum === 1) this._spawnFirstWave({ wolf:w, rat:r, bear:b });
      else this._spawnGroup(this.enemyWorldW, this.enemyWorldH, this.enemyCX, this.enemyCY, { wolf:w, rat:r, bear:b }, true);
      if (this.dayNum >= 2) {
        const wn = this.waveNum;
        this._spawnBiomeEnemy('ice_crawler',  'tundra', _take(Math.min(2 + wn, 6)),  1);
        this._spawnBiomeEnemy('spider_ruins', 'ruins',  _take(Math.min(2 + wn, 6)),  1);
        this._spawnBiomeEnemy('bog_lurker',   'swamp',  _take(Math.min(1 + wn, 4)),  1);
        this._spawnBiomeEnemy('dust_hound',   'waste',  _take(Math.min(3 * wn, 9)),  3);
      }
      this._log('Wave ' + this.waveNum + ' day=' + this.dayNum + ' diff=' + this._diffMult().toFixed(1) + 'x  speed=' + this._diffSpeedMult().toFixed(1) + 'x  w=' + w + ' r=' + r + ' b=' + b, 'world');
      this.hint('Wave ' + this.waveNum + '! Enemies approaching from the wastes!', 3000, { urgent: true });
      SFX._play(150, 'triangle', 0.55, 0.12, 'drop');
    }
  },
});
