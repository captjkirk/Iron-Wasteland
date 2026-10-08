'use strict';
// ── src/enemy-ai.js — GameScene system 2: enemy AI, pathfinding & damage ─────
// Loads right after src/building-crafting.js and adds these methods to GameScene (ADR 0002).
// create() calls spawnEnemies; update() calls updateEnemies. Fog of war's _losBlocked,
// the players' applyTerrainEffects and the raiders' spawnHuntingParty stay in src/game-scene.js.

Object.assign(GameScene.prototype, {
  // Central damage handler: applies damage, 220ms flinch stagger, knockback impulse,
  // hit-flash tint, SFX, and kill check. Use instead of inline e.hp -= X everywhere.
  _hurtEnemy(e, dmg, fromX, fromY, tint = 0xff6644, owner = null) {
    if (!e || e.dying) return;
    const eff = e.isBoss ? Math.max(1, dmg - (e.armor || 0)) : dmg;
    e.hp -= eff;
    e._flinchTimer = 132;
    if (e._dormant) { e._dormant = false; if (e.spr.body) { this.physics.world.bodies.set(e.spr.body); e.spr.body.enable = true; e.spr.body.reset(e.spr.x, e.spr.y); } }
    if (fromX !== undefined && e.spr.body) {
      const ang = Phaser.Math.Angle.Between(fromX, fromY, e.spr.x, e.spr.y);
      e.spr.body.velocity.x += Math.cos(ang) * 90;
      e.spr.body.velocity.y += Math.sin(ang) * 90;
    }
    e.spr.setTint(tint);
    this.time.delayedCall(110, () => { if (e.spr && e.spr.active) e.spr.clearTint(); });
    // Hit squash for bosses — overrides the idle-breath scale briefly.
    if (e.isBoss && e.baseScale) {
      e._hitTweenUntil = this.time.now + 170;
      this.tweens.add({
        targets: e.spr,
        scaleX: e.baseScale * 1.15, scaleY: e.baseScale * 0.85,
        duration: 80, yoyo: true, ease: 'Quad.Out',
      });
    }
    SFX.hit(e.type);
    // Floating damage number — styled by magnitude so big crits pop visually.
    this._floatDamage(e.spr.x, e.spr.y - (e.isBoss ? 28 : 14), eff);
    // Hit-pause: brief physics freeze on impact for weight. Guarded so
    // multiple hits in the same frame don't stack into a visible stutter.
    this._hitPause(40);
    if (e.isBoss && e.armor) {
      this._log(e.type + ' hit  dmg=' + eff + ' (raw=' + dmg + ' armor=' + e.armor + ')  hp=' + e.hp + '/' + (e.maxHp || '?'), 'combat');
    } else {
      this._log(e.type + ' hit  dmg=' + eff + '  hp=' + e.hp + '/' + (e.maxHp || '?'), 'combat');
    }
    if (e.hp <= 0) this.killEnemy(e, owner);
  },

  // Calls fn(e) for every enemy. Use it for any loop over this.enemies that can kill: a kill
  // inside it is spliced out only after the loop, so the next enemy is not skipped (#341).
  // Nests safely: only the outermost loop drains the removals.
  _forEachEnemy(fn) {
    const outer = !this._enemyIterActive;
    this._enemyIterActive = true;
    try {
      this.enemies.forEach(fn);
    } finally {
      if (outer) {
        this._enemyIterActive = false;
        const dead = this._pendingEnemyRemovals;
        if (dead && dead.length) {
          for (const d of dead) {
            const _ei = this.enemies.indexOf(d);
            if (_ei !== -1) this.enemies.splice(_ei, 1);
          }
          dead.length = 0;
        }
      }
    }
  },

  killEnemy(e, owner = null) {
    if (e.dying) return; // already being killed — prevent double-kill & double-count
    e.dying = true;
    e.hp = 0;
    if (e._den) e._den.liveCount = Math.max(0, (e._den.liveCount || 0) - 1);
    this.kills++;
    if (owner) owner.kills++;
    this._log('Enemy killed  type=' + e.type + '  kills=' + this.kills, 'combat');
    // Remove from this.enemies; inside _forEachEnemy the splice waits for the loop to end.
    if (this._enemyIterActive) {
      (this._pendingEnemyRemovals ||= []).push(e);
    } else {
      const _ei = this.enemies.indexOf(e);
      if (_ei !== -1) this.enemies.splice(_ei, 1);
    }
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
    // Kill debris pop — 4 small chunks fly outward, matching the enemy's tint.
    // Skipped for bosses (they get the full 12-chunk flourish in the isBoss block).
    if (!e.isBoss) {
      for (let _ki = 0; _ki < 4; _ki++) {
        const _ang = (_ki / 4) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.5, 0.5);
        const _dist = Phaser.Math.Between(12, 28);
        const _chip = this.add.graphics().setDepth(13);
        if (this.hudCam) this.hudCam.ignore(_chip);
        _chip.fillStyle(0xff3300, 0.9);
        _chip.fillRect(-2, -2, Phaser.Math.Between(3, 6), Phaser.Math.Between(3, 6));
        _chip.setPosition(ex, ey);
        this.tweens.add({
          targets: _chip,
          x: ex + Math.cos(_ang) * _dist,
          y: ey + Math.sin(_ang) * _dist - 8,
          alpha: 0, scaleX: 0.1, scaleY: 0.1,
          duration: 320, ease: 'Quad.Out',
          onComplete: () => { if (_chip && _chip.active) _chip.destroy(); },
        });
      }
    }
    // Raider kill — check if camp cleared
    if (e.isRaider) {
      const _ri = this.raiders.indexOf(e); if (_ri !== -1) this.raiders.splice(_ri, 1);
      if (this.raiders.length === 0 && this.raidCamp) {
        const _raidDays = this.hc.raidRespawnDays;
        this._log(`Raider camp cleared!  day=${this.dayNum}  kills=${this.kills}  raiders_return_day=${this.dayNum+_raidDays}`, 'world');
        this.hint('Raider camp cleared! Loot cache unlocked — raiders return in ' + _raidDays + ' days…', 4500);
        this.raidRespawnDay = this.dayNum + _raidDays;
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
    // Boss kill — play a full death flourish: shake, scale-up tween, particle
    // puff matching the boss biome palette, shadow fade. The generic fade-to-0
    // tween above still runs in parallel, so the sprite destroys itself cleanly.
    if (e.isBoss) {
      if (e.hpBg && e.hpBg.active) e.hpBg.destroy();
      if (e.hpBar && e.hpBar.active) e.hpBar.destroy();
      if (e.nameLabel && e.nameLabel.active) e.nameLabel.destroy();
      if (e._telegraphGfx && e._telegraphGfx.active) e._telegraphGfx.destroy();
      if (e._indicator && e._indicator.active) e._indicator.destroy();
      this.boss = null;
      this.bossDefeated = true;
      this._log(`Boss defeated: ${e.name||e.type}  day=${this.dayNum}  kills=${this.kills}`, 'world');
      this.hint('BOSS DEFEATED! A rare material was left behind…', 5000);
      Music.switchFromBoss(this.isNight ? 'night' : 'day');
      SFX._play(880, 'triangle', 0.3, 0.6, 'rise');
      SFX._play(1100, 'triangle', 0.25, 0.5, 'rise');
      this.cameras.main.shake(600, 0.018);
      // Scale-up flash on the corpse sprite — tween fights with the fade, but
      // since it targets scale not alpha, both complete naturally.
      const bs = e.baseScale || 1.5;
      this.tweens.add({ targets: e.spr, scaleX: bs * 1.35, scaleY: bs * 1.35, duration: 500, ease: 'Cubic.Out' });
      e.spr.setTint(0xffffff);
      // Shadow fade
      if (e.shadow && e.shadow.active) {
        this.tweens.add({
          targets: e.shadow, alpha: 0, duration: 500,
          onComplete: () => { if (e.shadow && e.shadow.scene) e.shadow.destroy(); },
        });
      }
      // Debris puff — 12 chunks in boss-biome palette, outward velocity.
      const biomeCol = {
        boss_golem:  [0x778899, 0x556677, 0xff3300],
        boss_wolf:   [0x55556a, 0xc0c0d0, 0x3a3a46],
        boss_spider: [0x442255, 0x553366, 0x88ff44],
        boss_troll:  [0x8899bb, 0xbbccdd, 0xaaddff],
        boss_hydra:  [0x334422, 0x446633, 0x88bb44],
      }[e.type] || [0xffffff, 0xcccccc, 0x888888];
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
        const sp = Phaser.Math.Between(80, 160);
        const col = biomeCol[i % biomeCol.length];
        const dbr = this.add.rectangle(ex, ey, 4, 4, col).setDepth(15);
        if (this.hudCam) this.hudCam.ignore(dbr);
        this.tweens.add({
          targets: dbr,
          x: ex + Math.cos(ang) * sp * 0.6,
          y: ey + Math.sin(ang) * sp * 0.6,
          alpha: 0, scale: 0.4,
          duration: 600, ease: 'Cubic.Out',
          onComplete: () => dbr.destroy(),
        });
      }
      this.dropResource(ex, ey, 'rare');
    }
    // Dust Hound pack frenzy — surviving packmates speed up for 4s on death
    if (e.type === 'dust_hound' && e._packId !== undefined) {
      const packmates = this._packIndex?.get(e._packId) || [];
      for (const other of packmates) {
        if (other !== e && other.spr?.active) {
          other._frenzied = true;
          other.spr.setTint(0xff8800);
          this.time.delayedCall(4000, () => {
            if (other.spr?.active) { other._frenzied = false; other.spr.clearTint(); }
          });
        }
      }
    }
    this.dropResource(ex, ey, e.type);
  },

  spawnEnemies(worldW, worldH, cx, cy) {
    this.enemyWorldW = worldW; this.enemyWorldH = worldH;
    this.enemyCX = cx; this.enemyCY = cy;
    // this.enemies already initialised in create() so water lurkers from _buildLakes are preserved
    this.waveNum = 0;
    this.waveTimer = 0;
    this.WAVE_INTERVAL = this.hc.waveInterval; // Survival 90s / Hardcore 75s
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
      const guardDiff = this._diffMult();
      const guardSpeed = this._diffSpeedMult();
      const biomeGuardType = { grass:'wolf', tundra:'wolf', swamp:'rat', waste:'bear', fungal:'bog_lurker', desert:'dust_hound' };
      // Guards are ENEMY_STATS with these overrides: tougher, faster and bigger than wildlife so a
      // structure is a danger zone, and a wider aggro (times 1.3 below). Body size comes from ENEMY_STATS.
      const GUARD_DEFS = Object.fromEntries(Object.entries({
        wolf:       { hp:70,  speed:95,  dmg:10, baseScale:1.0, aggro:220 },
        rat:        { hp:38,  speed:145, dmg:7,  baseScale:0.8, aggro:140 },
        bear:       { hp:160, speed:58,  dmg:20, baseScale:1.2, aggro:320 },
        bog_lurker: { hp:65,  speed:60,  dmg:14,                aggro:180 },
        dust_hound: { hp:35,  speed:125, dmg:6 },
      }).map(([type, o]) => [type, { ...ENEMY_STATS[type], ...o }]));
      for (const loc of this._structureLocs) {
        // An authored structure names its guards; otherwise 2-4 of the biome's animal.
        const types = loc.guards || Array.from({ length: Phaser.Math.Between(2, 4) }, () => biomeGuardType[loc.biome] || 'wolf');
        const count = types.length;
        for (let i = 0; i < count; i++) {
          const type = types[i], t = GUARD_DEFS[type];
          const ang = (i / count) * Math.PI * 2;
          const dist = Phaser.Math.Between(30, 90);
          const ex = loc.x + Math.cos(ang) * dist;
          const ey = loc.y + Math.sin(ang) * dist;
          const sizeMult = Phaser.Math.FloatBetween(1.0, 1.5); // bigger = harder
          const sc = t.baseScale * sizeMult;
          const spr = this.physics.add.image(
            Phaser.Math.Clamp(ex, CFG.TILE*4, worldW - CFG.TILE*4),
            Phaser.Math.Clamp(ey, CFG.TILE*4, worldH - CFG.TILE*4), type
          ).setScale(sc).setDepth(8);
          spr.setCollideWorldBounds(true);
          spr.body.setSize(t.w, t.h);
          if (this.hudCam) this.hudCam.ignore(spr);
          this.physics.add.collider(spr, this.obstacles);
          const aggroR = t.aggro * 1.3; // very aggressive
          const eGuard = {
            spr, type,
            hp: Math.floor(t.hp * sizeMult * guardDiff), maxHp: Math.floor(t.hp * sizeMult * guardDiff),
            speed: t.speed * (sizeMult > 1.2 ? 0.8 : 1) * guardSpeed, dmg: Math.max(1, Math.floor(t.dmg * sizeMult * guardDiff)),
            attackTimer: 0, wanderTimer: 0,
            aggroRange: aggroR, attackRange: (30 + t.w / 4) * sizeMult,
            sizeMult, structureGuard: true,
          };
          this._startDormantIfFar(eGuard, ex, ey);
          this.enemies.push(eGuard);
        }
      }
    }

    // Spawn guards around the Radio Tower (ruins biome spiders, aggressive patrol)
    if (this.radioTower) {
      const t = { key:'spider_ruins', hp:55, speed:85, dmg:9, baseScale:0.9, w:36, h:24 };
      const towerDiff = this._diffMult();
      const towerSpeed = this._diffSpeedMult();
      const count = Phaser.Math.Between(4, 6);
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        const dist = Phaser.Math.Between(80, 150);
        const ex = this.radioTower.x + Math.cos(ang) * dist;
        const ey = this.radioTower.y + Math.sin(ang) * dist;
        const sizeMult = Phaser.Math.FloatBetween(1.0, 1.4);
        const sc = t.baseScale * sizeMult;
        const spr = this.physics.add.image(
          Phaser.Math.Clamp(ex, CFG.TILE*4, worldW - CFG.TILE*4),
          Phaser.Math.Clamp(ey, CFG.TILE*4, worldH - CFG.TILE*4), t.key
        ).setScale(sc).setDepth(8);
        spr.setCollideWorldBounds(true);
        spr.body.setSize(t.w, t.h);
        if (this.hudCam) this.hudCam.ignore(spr);
        this.physics.add.collider(spr, this.obstacles);
        const eGuard = {
          spr, type: t.key,
          hp: Math.floor(t.hp * sizeMult * towerDiff * 1.4), maxHp: Math.floor(t.hp * sizeMult * towerDiff * 1.4),
          speed: t.speed * (sizeMult > 1.2 ? 0.8 : 1) * towerSpeed, dmg: Math.max(1, Math.floor(t.dmg * sizeMult * towerDiff * 1.2)),
          attackTimer: 0, wanderTimer: 0,
          aggroRange: 260, attackRange: 35 * sizeMult,
          sizeMult, towerGuard: true,
        };
        this._startDormantIfFar(eGuard, ex, ey);
        this.enemies.push(eGuard);
      }
      this._log(`spawnEnemies: spawned ${count} tower guards around radio tower`, 'world');
    }
  },

  _spawnWaterLurker(x, y) {
    const sizeMult = Phaser.Math.FloatBetween(1.0, 1.4);
    const sc = 1.0 * sizeMult;
    const D = this._diffMult();
    const hp  = Math.floor(75 * sizeMult * D);
    const dmg = Math.max(1, Math.floor(14 * sizeMult * D));
    const spd = 52 * this._diffSpeedMult();
    const spr = this.physics.add.image(x, y, 'water_lurker').setScale(sc).setDepth(8);
    spr.setCollideWorldBounds(true);
    spr.body.setSize(44, 24);
    if (this.hudCam) this.hudCam.ignore(spr);
    this.physics.add.collider(spr, this.obstacles);
    const e = {
      spr, hp, maxHp: hp, speed: spd, dmg, atkInterval: 2000,
      type: 'water_lurker', attackTimer: 0, wanderTimer: 0,
      aggroRange: 180, attackRange: 28 * sizeMult, sizeMult,
      _lurking: true,
    };
    spr.setAlpha(0.15);
    this._startDormantIfFar(e, x, y);
    this.enemies.push(e);
    return e;
  },

  _spawnBiomeEnemy(type, biome, count, packSize) {
    const { TILE, SAFE_R } = CFG;
    const D = this._diffMult();
    const S = this._diffSpeedMult();
    const worldW = this.enemyWorldW, worldH = this.enemyWorldH;
    const cx = this.enemyCX, cy = this.enemyCY;
    const t = ENEMY_STATS[type];
    if (!t) return;
    if (this.enemies.length >= CFG.MAX_ENEMIES) {
      this._log('Biome spawn skipped — cap reached  type=' + type + '  ' + this.enemies.length + '/' + CFG.MAX_ENEMIES, 'world');
      return;
    }
    const ps = packSize || 1;
    let placed = 0;
    const maxAttempts = count * 8;
    let packId = this._nextPackId || 0;
    for (let attempt = 0; attempt < maxAttempts && placed < count; attempt++) {
      if (this.enemies.length >= CFG.MAX_ENEMIES) break;
      const tx = Phaser.Math.Between(TILE * 5, worldW - TILE * 5);
      const ty = Phaser.Math.Between(TILE * 5, worldH - TILE * 5);
      if (getBiome(Math.round(tx / TILE), Math.round(ty / TILE)) !== biome) continue;
      if (Phaser.Math.Distance.Between(tx, ty, cx, cy) < SAFE_R * TILE * 2.5) continue;
      // For pack types, spawn ps enemies clustered near this point
      const spawnCount = (type === 'dust_hound') ? ps : 1;
      for (let pi = 0; pi < spawnCount && placed < count; pi++) {
        if (this.enemies.length >= CFG.MAX_ENEMIES) break;
        const ex = tx + Phaser.Math.Between(-20, 20);
        const ey = ty + Phaser.Math.Between(-20, 20);
        const sizeMult = Phaser.Math.FloatBetween(1.0, 1.4);
        const sc = t.baseScale * sizeMult;
        const hp  = Math.floor(t.hp  * sizeMult * D);
        const dmg = Math.max(1, Math.floor(t.dmg * sizeMult * D));
        const spd = t.speed * S * (sizeMult > 1.2 ? 0.85 : 1);
        const atkInterval = Math.max(500, Math.round(t.atkInterval / D));
        const spr = this.physics.add.image(
          Phaser.Math.Clamp(ex, TILE*3, worldW-TILE*3),
          Phaser.Math.Clamp(ey, TILE*3, worldH-TILE*3), type
        ).setScale(sc).setDepth(8);
        spr.setCollideWorldBounds(true);
        spr.body.setSize(t.w, t.h);
        if (this.hudCam) this.hudCam.ignore(spr);
        this.physics.add.collider(spr, this.obstacles);
        const aggroR = t.aggro || 160;
        const atkR = (30 + t.w / 4) * sizeMult;
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, atkInterval, type, attackTimer:0,
          wanderTimer:Phaser.Math.Between(0,2000), aggroRange:aggroR, attackRange:atkR, sizeMult };
        if (type === 'bog_lurker') { e._lurking = true; spr.setAlpha(0.25); }
        if (type === 'dust_hound') { e._packId = packId; }
        this._startDormantIfFar(e, ex, ey);
        this.enemies.push(e);
        placed++;
      }
      if (type === 'dust_hound') packId++;
    }
    this._nextPackId = packId;
  },

  // Put an enemy to sleep immediately if it spawned out of both players' awake
  // radius. Shared across _spawnGroup, _spawnBiomeEnemy, structure/tower
  // guards, water lurker, and den spawns — keeps the 7-line block from being
  // duplicated 6 times.
  _startDormantIfFar(e, ex, ey) {
    const spr = e.spr;
    if (!spr) return;
    const p1 = this.p1, p2 = this.p2;
    let minD2 = Infinity;
    if (p1 && p1.spr && p1.spr.active) {
      const dx = ex - p1.spr.x, dy = ey - p1.spr.y;
      minD2 = dx * dx + dy * dy;
    }
    if (p2 && p2.spr && p2.spr.active) {
      const dx = ex - p2.spr.x, dy = ey - p2.spr.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) minD2 = d2;
    }
    const R = CFG.DORMANT_RADIUS;
    if (minD2 > R * R) {
      e._dormant = true;
      spr.setVisible(false);
      if (spr.body) { spr.body.enable = false; this.physics.world.bodies.delete(spr.body); }
    }
  },

  _spawnGroup(worldW, worldH, cx, cy, counts, fromEdges) {
    const { TILE, SAFE_R } = CFG;
    const D = this._diffMult();
    const S = this._diffSpeedMult();
    // Canonical stats live at module top (ENEMY_STATS). atkInterval is divided
    // by D so enemies attack faster on later days.
    const keys = Object.keys(counts);
    keys.forEach(key => {
      const t = ENEMY_STATS[key];
      if (!t) return;
      const n = counts[key] || 0;
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
        // Nudge spawn off solid tiles (mountains) — up to 8 attempts at a random offset
        if (this._solidTileSet) {
          const _stx = Math.round(ex / TILE), _sty = Math.round(ey / TILE);
          if (this._solidTileSet.has(_stx + ',' + _sty)) {
            for (let _sa = 0; _sa < 8; _sa++) {
              const _ox = Phaser.Math.Between(-3, 3), _oy = Phaser.Math.Between(-3, 3);
              if (!this._solidTileSet.has((_stx + _ox) + ',' + (_sty + _oy))) {
                ex = (_stx + _ox) * TILE; ey = (_sty + _oy) * TILE;
                break;
              }
            }
          }
        }
        // Size variance: 1.0x to 1.5x — floor raised so enemies are never too small to see
        const sizeMult = Phaser.Math.FloatBetween(1.0, 1.5);
        const sc = t.baseScale * sizeMult;
        const hp  = Math.floor(t.hp    * sizeMult * D);
        const dmg = Math.max(1, Math.floor(t.dmg  * sizeMult * D));
        const spd = t.speed * S * (sizeMult < 0.85 ? 1.3 : sizeMult > 1.2 ? 0.8 : 1);
        const atkInterval = Math.max(500, Math.round(t.atkInterval / D));
        const spr = this.physics.add.image(ex, ey, key).setScale(sc).setDepth(8);
        spr.setCollideWorldBounds(true);
        spr.body.setSize(t.w, t.h);
        if (this.hudCam) this.hudCam.ignore(spr);
        this.physics.add.collider(spr, this.obstacles);
        // Per-type aggro ranges (bears territorial, rats skittish) from ENEMY_STATS.
        const aggroR = (t.aggro || 160) * (sizeMult > 1.2 ? 1.2 : 1);
        const atkR = (30 + t.w/4) * sizeMult;
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, atkInterval, type:key, attackTimer:0, wanderTimer:Phaser.Math.Between(0,2000), aggroRange:aggroR, attackRange:atkR, sizeMult };
        this._startDormantIfFar(e, ex, ey);
        this.enemies.push(e);
      }
    });
  },

  // Find the nearest player-built wall that sits between (ex,ey) and (px,py)
  // and is within 80px of the enemy. Returns the wall, or null. Uses the wall
  // spatial hash so cost scales with nearby walls, not total wall count.
  _findWallOnPath(ex, ey, px, py) {
    if (!this._wallBuckets || this._wallBuckets.size === 0) return null;
    const playerAngDeg = Phaser.Math.RadToDeg(Phaser.Math.Angle.Between(ex, ey, px, py));
    const T = CFG.TILE;
    const ctx = Math.floor(ex / T), cty = Math.floor(ey / T);
    // 80px radius → 3 tiles out (80/32 ≈ 2.5, round up for safety)
    const RAD_T = 3;
    let best = null, bestDist = Infinity;
    for (let dy = -RAD_T; dy <= RAD_T; dy++) {
      for (let dx = -RAD_T; dx <= RAD_T; dx++) {
        const arr = this._wallBuckets.get(this._wallBucketKey(ctx + dx, cty + dy));
        if (!arr) continue;
        for (const w of arr) {
          if (!w.active) continue;
          const ddx = w.x - ex, ddy = w.y - ey;
          const wd2 = ddx*ddx + ddy*ddy;
          if (wd2 > 80 * 80) continue;
          const wallAngDeg = Phaser.Math.RadToDeg(Phaser.Math.Angle.Between(ex, ey, w.x, w.y));
          const diff = Math.abs(Phaser.Math.Angle.ShortestBetween(wallAngDeg, playerAngDeg));
          if (diff < 70 && wd2 < bestDist) { best = w; bestDist = wd2; }
        }
      }
    }
    return best;
  },

  // ── Enemy LOS helpers ────────────────────────────────────────
  // Returns true if the straight line from (x1,y1) to (x2,y2) is NOT blocked
  // by any mountain tile or player-built wall.  Fast: uses pre-built tile Set.
  _hasLOS(x1, y1, x2, y2) {
    if (!this._solidTileSet) return true;
    const T = CFG.TILE;
    // Inline sqrt — hotter than Phaser.Math.Distance.Between on the per-frame LOS path.
    const ddx = x2 - x1, ddy = y2 - y1;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < 576) return true; // 24²
    const dist = Math.sqrt(d2);
    const steps = Math.ceil(dist / 28); // sample every ~28 px
    const dx = (x2 - x1) / steps, dy = (y2 - y1) / steps;
    for (let i = 1; i < steps; i++) {
      const sx = x1 + dx * i, sy = y1 + dy * i;
      const tx = Math.round(sx / T), ty = Math.round(sy / T);
      if (this._solidTileSet.has(tx + ',' + ty)) return false;
      // Also check player-built walls — spatial hash keeps this O(1) per sample
      if (this._wallNearby(sx, sy, 20)) return false;
    }
    return true;
  },

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
      if (this._wallNearby(px, py, 24)) return false;
      return true;
    };
    // Try direct angle, then ±37°, ±75°, ±112°, ±150°, 180° until a clear heading is found
    for (const off of [0, 0.65, -0.65, 1.3, -1.3, 1.95, -1.95, 2.6, -2.6, Math.PI]) {
      const ang = baseAng + off;
      if (isHeadingClear(ang)) return { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
    }
    return { x: 0, y: 0 };
  },

  updateEnemies(delta) {
    if (!this.enemies || this.isOver) return;
    // Reuse persistent scratch arrays/objects to avoid per-frame allocation
    // (filter + map each allocated a fresh array + wrapper objects every tick).
    const _scratchPlayers = this._scratchPlayers || (this._scratchPlayers = []);
    const _scratchPPos = this._scratchPPos || (this._scratchPPos = [{x:0,y:0}, {x:0,y:0}]);
    _scratchPlayers.length = 0;
    let _pc = 0;
    const _pRaw = [this.p1, this.p2];
    for (let i = 0; i < _pRaw.length; i++) {
      const p = _pRaw[i];
      if (p && p.spr && !p.isDowned && p.hp > 0 && p.spr.visible) {
        _scratchPlayers.push(p);
        const slot = _scratchPPos[_pc] || (_scratchPPos[_pc] = {x:0, y:0});
        slot.x = p.spr.x; slot.y = p.spr.y;
        _pc++;
      }
    }
    _scratchPPos.length = _pc;
    const players = _scratchPlayers;
    const _pPos = _scratchPPos;
    // Hoist camera view once per frame for dormancy + culling checks
    const _cam = this.cameras.main;
    const _view = _cam.worldView;
    const _VIEW_BUF = 400; // px buffer outside viewport before hiding sprite
    // Single pass: count active enemies AND build pack index (was two separate O(n) loops).
    // Reuse the Map and its array values across frames so we don't allocate them every tick.
    let _activeCount = 0;
    const _packIndex = this._packIndex || (this._packIndex = new Map());
    for (const _arr of _packIndex.values()) _arr.length = 0;
    for (const _e of this.enemies) {
      if (_e.spr?.active && !_e._dormant) _activeCount++;
      if (_e._packId !== undefined && _e.spr?.active) {
        let _arr = _packIndex.get(_e._packId);
        if (!_arr) { _arr = []; _packIndex.set(_e._packId, _arr); }
        _arr.push(_e);
      }
    }
    this._activeEnemyCount = _activeCount;

    // Relic carrier beacon — cached once per frame for use in per-enemy loop
    const _relicCarrier = (this.relicsHeld > 0) ? this._relicCarrier() : null;
    const _carrierX = _relicCarrier?.spr.x, _carrierY = _relicCarrier?.spr.y;
    const _AURA_R2 = 700 * 700;
    const _rp = this._relicPressure();

    // Resolve the charmer once per frame for the per-enemy charm/ally pass below.
    const charmerPlayer = [this.p1, this.p2].find(
      p => p && p.charData && p.charData.id === 'charmer' && !p.isDowned && p.spr && p.spr.active
    );

    // _forEachEnemy defers kills to the end of the loop so none skips the next enemy.
    this._forEachEnemy(e => {
      if (e.dying || !e.spr.active) return;
      if (e.isBoss) return; // boss movement/attack handled by updateBoss

      // ── Dormancy: wildlife enemies far from all players sleep (no AI, no physics) ──
      // Raiders + boss escorts are always aggressive — never dormant. Boss already excluded above.
      if (!e.isRaider && !e._bossEscort) {
        let _minDist2 = Infinity;
        for (const _pp of _pPos) {
          const _dx = e.spr.x - _pp.x, _dy = e.spr.y - _pp.y;
          const _d2 = _dx * _dx + _dy * _dy;
          if (_d2 < _minDist2) _minDist2 = _d2;
        }

        if (e._dormant) {
          if (_minDist2 < CFG.WAKE_RADIUS * CFG.WAKE_RADIUS && _activeCount < CFG.MAX_ACTIVE_ENEMIES) {
            // Wake up (only if under active-enemy cap)
            e._dormant = false;
            if (e.spr.body && !e.spr.body.destroyed) {
              this.physics.world.bodies.set(e.spr.body);
              e.spr.body.enable = true;
              e.spr.body.reset(e.spr.x, e.spr.y);
            }
            _activeCount++;
          } else {
            // Stay dormant — update visibility only, skip all AI
            const _onScr = (e.spr.x > _view.x - _VIEW_BUF && e.spr.x < _view.x + _view.width  + _VIEW_BUF &&
                            e.spr.y > _view.y - _VIEW_BUF && e.spr.y < _view.y + _view.height + _VIEW_BUF);
            e.spr.setVisible(_onScr);
            return;
          }
        } else {
          if (_minDist2 > CFG.DORMANT_RADIUS * CFG.DORMANT_RADIUS) {
            // Go dormant — remove body from physics world to reduce simulation overhead
            e._dormant = true;
            e.spr.setVelocity(0, 0);
            if (e.spr.body) { e.spr.body.enable = false; this.physics.world.bodies.delete(e.spr.body); }
            e.spr.setVisible(false);
            return;
          }
        }
      }

      // ── Relic carrier beacon — override target + wake dormant enemies nearby ──
      if (_relicCarrier && !e.isRaider) {
        const _cdx = e.spr.x - _carrierX, _cdy = e.spr.y - _carrierY;
        const _cd2 = _cdx * _cdx + _cdy * _cdy;
        if (_cd2 < _AURA_R2 && e._dormant && _activeCount < CFG.MAX_ACTIVE_ENEMIES) {
          e._dormant = false;
          if (e.spr.body && !e.spr.body.destroyed) {
            this.physics.world.bodies.set(e.spr.body);
            e.spr.body.enable = true;
            e.spr.body.reset(e.spr.x, e.spr.y);
          }
          _activeCount++;
        }
        if (!e._dormant && _cd2 < Math.pow((e.aggroRange || 180) * 3.5, 2)) {
          e.target = _relicCarrier;
        }
      }

      // ── Viewport culling for active enemies — hide sprite if off-screen ──
      {
        const _onScr = (e.spr.x > _view.x - _VIEW_BUF && e.spr.x < _view.x + _view.width  + _VIEW_BUF &&
                        e.spr.y > _view.y - _VIEW_BUF && e.spr.y < _view.y + _view.height + _VIEW_BUF);
        if (!_onScr) { e.spr.setVisible(false); }
        else {
          // Hide enemies that are on-screen but outside current LOS fog
          const etx = (e.spr.x / CFG.TILE) | 0;
          const ety = (e.spr.y / CFG.TILE) | 0;
          const _inLOS = !this.fogVisible || this.fogVisible.has(etx + ',' + ety);
          e.spr.setVisible(_inLOS);
        }
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
      // Lauren (charmer) passive — human enemies are permanent allies; others charmed within aura
      // (charmerPlayer is resolved once above the forEach for performance).
      // "Human enemy" = any raider (brawler/shooter/heavy, incl. hunt parties). Keyed
      // off the isRaider flag, not the type string: raiders carry the UNPREFIXED type
      // ('brawler'), while HUMAN_ENEMY_TYPES held the texture-key form ('raider_brawler'),
      // so the old includes() was always false and the charmer's signature passive
      // (raiders are allies) never fired.
      const isHumanEnemy = !!e.isRaider;
      if (!e._aggroOverride) {
        if (charmerPlayer) {
          let charmed = false;
          if (isHumanEnemy) {
            // Human enemies are always Lauren's allies — no range or day/night restriction
            charmed = true;
          } else {
            // Non-human enemies: charm within aura radius (day always, night only if upgraded)
            const auraR = charmerPlayer._charmerUpgraded ? 280 : 200;
            const effectiveR = this.isNight ? (charmerPlayer._charmerUpgraded ? 140 : 0) : auraR;
            if (effectiveR > 0) {
              const d = Phaser.Math.Distance.Between(e.spr.x, e.spr.y, charmerPlayer.spr.x, charmerPlayer.spr.y);
              if (d < effectiveR) charmed = true;
            }
          }
          if (charmed) {
            if (!e._charmTinted) {
              e._charmTinted = true;
              e.spr.setTint(0xffaacc);
              // One-shot tell on charm transition — sparkle + soft chime so
              // the charmer's core mechanic isn't silent.
              this._emitCharmSparkle(e.spr.x, e.spr.y);
              if (typeof SFX !== 'undefined' && SFX._play) SFX._play(880, 'sine', 0.05, 0.18);
            }
            if (isHumanEnemy) {
              // Ally AI: protect Lauren — find nearest non-human enemy and attack it.
              // Retargeting scans all enemies, so throttle to ~4×/sec per ally and cache.
              e._allyRetargetCd = (e._allyRetargetCd || 0) - delta;
              const cached = e._allyTarget;
              const cachedValid = cached && !cached.dying && cached.spr && cached.spr.active &&
                Phaser.Math.Distance.Between(e.spr.x, e.spr.y, cached.spr.x, cached.spr.y) < 400;
              if (!cachedValid || e._allyRetargetCd <= 0) {
                e._allyRetargetCd = 250;
                e._allyTarget = this.enemies.find(t =>
                  t !== e && !t.dying && t.spr && t.spr.active &&
                  !t.isRaider && !t.isBoss &&
                  Phaser.Math.Distance.Between(e.spr.x, e.spr.y, t.spr.x, t.spr.y) < 350
                ) || null;
              }
              const allyTarget = e._allyTarget;
              if (allyTarget) {
                const spd = e.speed * 0.85;
                const vel = this._steerToward(e, allyTarget.spr.x, allyTarget.spr.y, spd);
                e.spr.setVelocity(vel.x, vel.y);
                const allyDist = Phaser.Math.Distance.Between(e.spr.x, e.spr.y, allyTarget.spr.x, allyTarget.spr.y);
                if (allyDist < e.attackRange) {
                  e.attackTimer = (e.attackTimer || 0) - delta;
                  if (e.attackTimer <= 0) {
                    this._hurtEnemy(allyTarget, e.dmg, e.spr.x, e.spr.y, 0xff88cc, null);
                    e.attackTimer = e.atkInterval || 1200;
                  }
                }
              } else {
                // No nearby threat — escort Lauren
                const d = Phaser.Math.Distance.Between(e.spr.x, e.spr.y, charmerPlayer.spr.x, charmerPlayer.spr.y);
                if (d > 80) {
                  const vel = this._steerToward(e, charmerPlayer.spr.x, charmerPlayer.spr.y, e.speed * 0.6);
                  e.spr.setVelocity(vel.x, vel.y);
                } else {
                  e.spr.setVelocity(0, 0);
                }
              }
              return;
            } else {
              // Charmed non-human: wander peacefully instead of freezing in place
              e.wanderTimer = (e.wanderTimer || 0) - delta;
              if (e.wanderTimer <= 0) {
                const ang = Math.random() * Math.PI * 2;
                const wspd = (e._effectiveSpeed !== undefined ? e._effectiveSpeed : e.speed) * 0.3;
                const wx = e.spr.x + Math.cos(ang) * 200;
                const wy = e.spr.y + Math.sin(ang) * 200;
                const vel = this._steerToward(e, wx, wy, wspd);
                e.spr.setVelocity(vel.x, vel.y);
                e.wanderTimer = Phaser.Math.Between(1500, 3500);
              }
              return;
            }
          }
        }
      }
      // Clear charm tint when conditions no longer apply
      if (e._charmTinted && (e._aggroOverride || !charmerPlayer || (isHumanEnemy && e._aggroOverride))) {
        e._charmTinted = false;
        if (e.spr?.active) e.spr.clearTint();
      }
      // Flower-charm: brief suppress from Flower Toss hit
      if ((e._charmedTimer || 0) > 0 && !e._aggroOverride) {
        e._charmedTimer -= delta;
        // Wander peacefully instead of freezing
        e.wanderTimer = (e.wanderTimer || 0) - delta;
        if (e.wanderTimer <= 0) {
          const ang = Math.random() * Math.PI * 2;
          const wspd = (e._effectiveSpeed !== undefined ? e._effectiveSpeed : e.speed) * 0.3;
          const wx = e.spr.x + Math.cos(ang) * 200;
          const wy = e.spr.y + Math.sin(ang) * 200;
          const vel = this._steerToward(e, wx, wy, wspd);
          e.spr.setVelocity(vel.x, vel.y);
          e.wanderTimer = Phaser.Math.Between(1500, 3500);
        }
        if (!e._charmTinted) { e._charmTinted = true; e.spr.setTint(0xffaacc); }
        return;
      } else if (e._charmedTimer <= 0 && e._charmTinted && !e._aggroOverride) {
        e._charmTinted = false;
        if (e.spr?.active) e.spr.clearTint();
      }
      // ── Biome-enemy special pre-frame logic ──────────────────
      // Bog Lurker: stays hidden until player is within 90px, then bursts
      if (e.type === 'bog_lurker') {
        if (e._lurking) {
          const closePlayer = [this.p1, this.p2].find(p => {
            if (!p || p.isDowned) return false;
            const dx = e.spr.x - p.spr.x, dy = e.spr.y - p.spr.y;
            return dx*dx + dy*dy < 8100; // 90²
          });
          if (closePlayer) {
            e._lurking = false;
            e.spr.setAlpha(1);
            e._ambushTimer = 2200;
            this._log(`bog_lurker ambush  target=${closePlayer.charData.player}  pos=(${Math.floor(e.spr.x/CFG.TILE)},${Math.floor(e.spr.y/CFG.TILE)})`, 'combat');
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
      } else if (e.type === 'water_lurker') {
        // Lurks nearly invisible until player steps within 110px, then bursts.
        // Between 110-170px we telegraph with a bubble ripple + low tone so
        // the ambush reads as skill-testable rather than cheap.
        if (e._lurking) {
          let minDistSq = Infinity, closePlayer = null;
          for (const p of [this.p1, this.p2]) {
            if (!p || p.isDowned) continue;
            const dx = e.spr.x - p.spr.x, dy = e.spr.y - p.spr.y;
            const d2 = dx*dx + dy*dy;
            if (d2 < minDistSq) { minDistSq = d2; closePlayer = p; }
          }
          if (closePlayer && minDistSq < 12100) { // 110² — ambush triggers
            e._lurking = false;
            e.spr.setAlpha(1);
            e._ambushTimer = 2000;
            this._log(`water_lurker ambush  target=${closePlayer.charData.player}  pos=(${Math.floor(e.spr.x/CFG.TILE)},${Math.floor(e.spr.y/CFG.TILE)})`, 'combat');
            SFX._play(160, 'sawtooth', 0.12, 0.4, 'drop');
          } else if (closePlayer && minDistSq < 28900) { // 170² — telegraph band
            e._bubbleTimer = (e._bubbleTimer || 0) - delta;
            if (e._bubbleTimer <= 0) {
              e._bubbleTimer = 480;
              this._emitLurkerBubble(e.spr.x, e.spr.y);
              SFX._play(90, 'sine', 0.04, 0.25);
            }
            e.spr.setVelocity(0, 0);
            return;
          } else {
            e.spr.setVelocity(0, 0);
            return;
          }
        }
        // Speed burst on ambush; faster in water than on land
        const _wtx = Math.floor(e.spr.x / CFG.TILE), _wty = Math.floor(e.spr.y / CFG.TILE);
        const onWater = this._waterMap && this._waterMap[_wtx + _wty * CFG.MAP_W];
        const waterMult = onWater ? 2.2 : 1.0;
        if ((e._ambushTimer || 0) > 0) {
          e._ambushTimer -= delta;
          e._effectiveSpeed = e.speed * 2.4 * waterMult;
        } else {
          e._effectiveSpeed = e.speed * waterMult;
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
      // Relic carrier beacon — override nearest so movement actually chases carrier
      if (e.target && e.target.spr?.active && !e.target.isDowned && e.target.hp > 0) {
        nearest = e.target;
        nearDist = Phaser.Math.Distance.Between(e.spr.x, e.spr.y, nearest.spr.x, nearest.spr.y);
      }
      if (!nearest) { e.spr.setVelocity(0,0); return; }
      const nightMult = (this.isNight) ? this.hc.nightMult : 1;
      const aggroRange = e.aggroRange * nightMult * _rp.aggroMult;

      if (nearDist < aggroRange) {
        const spd = (e._effectiveSpeed !== undefined ? e._effectiveSpeed : e.speed) * nightMult * _rp.speedMult;

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
              // Count walls clustered near the blocker — 3+ nearby = enclosed space → always attack.
              // Cached by _refreshWallClustersNear on placement/destruction to avoid O(walls²) per frame.
              const clusterCount = blockingWall._clusterCount || 1;
              if (clusterCount >= 3) {
                attackingWall = true; // enclosure — break through
              } else {
                // Single stray wall: 35% chance, re-evaluated every 3 seconds.
                // Reset the roll if the blocking wall changed (prior wall was
                // destroyed or the enemy routed to a new one) so each wall
                // gets a fresh chance instead of inheriting the prior verdict.
                if (e._wallDecideFor !== blockingWall) {
                  e._wallDecideFor = blockingWall;
                  e._wallDecideTimer = 0;
                }
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
          e._escapeTimer = (e._escapeTimer || 0) - delta;
          if (e._escapeTimer > 0) {
            // Keep the escape burst velocity — don't overwrite it
          } else if (vel.x === 0 && vel.y === 0) {
            e._stuckDur = (e._stuckDur || 0) + delta;
            if (e._stuckDur > 800) {
              this._log(`enemy unstuck  type=${e.type}  pos=(${Math.floor(e.spr.x/CFG.TILE)},${Math.floor(e.spr.y/CFG.TILE)})`, 'combat');
              e._stuckDur = 0;
              const escAng = Phaser.Math.FloatBetween(0, Math.PI * 2);
              e.spr.setVelocity(Math.cos(escAng) * spd * 1.5, Math.sin(escAng) * spd * 1.5);
              e._escapeTimer = 600;
            }
          } else {
            e._stuckDur = 0;
            e.spr.setVelocity(vel.x, vel.y);
          }
          // directional flip is handled below in the walk-cycle block
        }

        if (nearDist < e.attackRange) {
          e.attackTimer -= delta;
          if (e.attackTimer <= 0) {
            const dmg = this._knightShieldBlock(nearest, e.spr.x, e.spr.y, Math.round(e.dmg * _rp.dmgMult));
            nearest.hp -= dmg;
            nearest.hp = Math.max(0, nearest.hp);
            this._log(`${e.type} hit ${nearest.charData.player} dmg=${dmg} hp=${nearest.hp}/${nearest.maxHp}`, 'combat');
            SFX.playerHurt();
            this._floatDamage(nearest.spr.x, nearest.spr.y - 18, Math.round(dmg));
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
            e.attackTimer = e.atkInterval || (e.type==='bear' ? 2400 : e.type==='wolf' ? 1600 : e.type==='dust_hound' ? 1500 : 1200);
            this.checkDeaths();
          }
        }
      } else {
        e.wanderTimer -= delta;
        if (e.wanderTimer <= 0) {
          let wanderX, wanderY;
          // Leash: raiders with a home position return to camp when they've drifted too far
          if (e.home && Phaser.Math.Distance.Between(e.spr.x, e.spr.y, e.home.x, e.home.y) > 400) {
            const homeAng = Phaser.Math.Angle.Between(e.spr.x, e.spr.y, e.home.x, e.home.y);
            wanderX = e.spr.x + Math.cos(homeAng) * 200;
            wanderY = e.spr.y + Math.sin(homeAng) * 200;
          } else {
            const ang = Math.random() * Math.PI * 2;
            wanderX = e.spr.x + Math.cos(ang) * 200;
            wanderY = e.spr.y + Math.sin(ang) * 200;
          }
          const wspd = (e._effectiveSpeed !== undefined ? e._effectiveSpeed : e.speed) * 0.3;
          const vel = this._steerToward(e, wanderX, wanderY, wspd);
          e.spr.setVelocity(vel.x, vel.y);
          e.wanderTimer = Phaser.Math.Between(1500, 3500);
        }
      }

      // ── Walk cycle + 8-direction sprites (raiders only) — skip if off-screen ──
      if (e.spr.visible) {
        e._walkTimer = ((e._walkTimer || 0) + delta) % 600;
        const _step = _walkStep(Math.floor(e._walkTimer / 15));
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
          const _tex = 'raider_' + e.type + _dirSuffix + (_moving ? _step : '');
          if (e._lastTexKey !== _tex) { e._lastTexKey = _tex; e.spr.setTexture('raider_atlas', _tex); }
        }
      }
    });
  },
});
