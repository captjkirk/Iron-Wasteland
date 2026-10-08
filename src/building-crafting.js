'use strict';
// ── src/building-crafting.js — GameScene system 8: building & crafting ──────
// Loads right after src/waves-bosses.js and adds these methods to GameScene (ADR 0002).
// create() wires the build, craft and barracks keys; update() calls updateBuildMode,
// updateCraftMenu and checkBarrackRange. RECIPES (what everything costs) is in src/recipes.js.

const CRAFTER_NAME = { gunslinger: 'Gunslinger', charmer: 'Lauren' };
// Recipe cost by key, built once from RECIPES so getBuildCost charges what the craft menu shows.
const RECIPE_COSTS = new Map(RECIPES.map(r => [r.key, r.cost]));

Object.assign(GameScene.prototype, {
  // ── BUILD SYSTEM ──────────────────────────────────────────────
  exitBuildMode() {
    if (this.buildMode) this._log(`${this.buildOwner?.charData?.player || 'unknown'} build mode OFF  was=${this.buildType}`, 'player');
    this.buildMode = false;
    this.buildOwner = null;
    if (this.buildGhost) { this.buildGhost.destroy(); this.buildGhost = null; }
  },

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
      // Green = spot is fine, red = placement would be refused.
      if (this._buildSpotError(gx, gy)) this.buildGhost.setTint(0xff5555); else this.buildGhost.clearTint();
    }

    // Check for type cycle (same key as build mode — double tap cycles)
    if (Phaser.Input.Keyboard.JustDown(this.buildRotKey1) || Phaser.Input.Keyboard.JustDown(this.buildRotKey2)) {
      this.buildRotation = (this.buildRotation + 1) % 4;
      this._log(`${this.buildOwner?.charData?.player} build rotate  type=${this.buildType}  rot=${this.buildRotation * 90}°`, 'player');
    }
  },

  // Tear down the nearest player-built wall/gate within ~40px of the player
  // and refund 50% of its build cost. Enemy-caused destruction goes through
  // damageStructure directly and is unaffected. Called from tryInteract when
  // the player is in build mode. Returns true if something was torn down.
  _tryTeardownBuild(player) {
    if (!player || !player.spr || !player.spr.active) return false;
    const R2 = 40 * 40;
    let best = null, bestD2 = R2;
    for (const w of (this.builtWalls || [])) {
      if (!w || !w.active) continue;
      const dx = w.x - player.spr.x, dy = w.y - player.spr.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = w; }
    }
    if (!best) return false;

    const wx = best.x, wy = best.y;
    const kind = best.isGate ? 'gate' : 'wall';
    const cost = this.getBuildCost(kind);
    const refund = {};
    for (const [res, amt] of Object.entries(cost)) {
      const give = Math.max(0, Math.floor(amt * 0.5));
      if (give > 0) {
        player.inv[res] = (player.inv[res] || 0) + give;
        refund[res] = give;
      }
    }
    this._hudDirty = true;

    // Reuse the existing destroy path (bucket + cluster + minimap + fade tween).
    this.damageStructure(best, (best.hp || 1) + 1);

    let oy = 0;
    for (const [res, amt] of Object.entries(refund)) {
      this._floatPickup(wx, wy - 10 - oy, '+' + amt + ' ' + res);
      oy += 12;
    }
    this._log(`${player.charData.player} tore down ${kind}  refund=${JSON.stringify(refund)}`, 'build');
    return true;
  },

  // Why a structure can't go at (x, y): water, ice, mountain, toxic ground, too close to another
  // structure, or an enemy on top. Returns the hint text, or null if the spot is fine.
  // placeBuild shows it; updateBuildMode tints the ghost from it, so the two cannot disagree.
  _buildSpotError(x, y) {
    const tx = Math.floor(x / CFG.TILE), ty = Math.floor(y / CFG.TILE);
    if (this._waterMap && this._waterMap[tx + ty * CFG.MAP_W]) return "Can't build on water!";
    if (this._iceMap && this._iceMap[tx + ty * CFG.MAP_W]) return "Can't build on ice!";
    if (this._solidTileSet && this._solidTileSet.has(tx + ',' + ty)) return "Can't build on a mountain!";
    if (this._toxicTileIndex && this._toxicTileIndex.has(ty * CFG.MAP_W + tx)) return "Can't build on toxic ground!";
    if (this._wallNearby(x, y, 24)) return "Too close to existing structure!";
    // Enemy overlap — an active enemy within ~24px of the placement point blocks it.
    const eArr = this.enemies || [];
    for (let i = 0; i < eArr.length; i++) {
      const e = eArr[i];
      if (!e || !e.spr || !e.spr.active || e._dormant) continue;
      const dx = e.spr.x - x, dy = e.spr.y - y;
      if (dx * dx + dy * dy < 24 * 24) return "Can't build on top of an enemy!";
    }
    return null;
  },

  placeBuild() {
    if (!this.buildMode || !this.buildGhost) return;
    const p = this.buildOwner;
    const x = this.buildGhost.x, y = this.buildGhost.y;

    const spotError = this._buildSpotError(x, y);
    if (spotError) { this.hint(spotError, 2000); return; }

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
    this._hudDirty = true;

    // Place the structure
    this._log(`Build placed: ${this.buildType}  pos=(${Math.floor(x/CFG.TILE)},${Math.floor(y/CFG.TILE)})  by=${this.buildOwner?.charData?.player||'?'}  cost=${JSON.stringify(cost)}`, 'build');
    if (this.buildType === 'wall') {
      const w = this._placeWallSprite(this.obstacles.create(x, y, 'wall'));
      w.hp = 200; w.maxHp = 200; // destructible
      this.builtWalls.push(w);
      this._addWallToBuckets(w);
      this._refreshWallClustersNear(w.x, w.y);
      this._paintMinimapTile(w.x, w.y, 0xeeeeff);
      if (this.hudCam) this.hudCam.ignore(w);
    } else if (this.buildType === 'gate') {
      const gate = this._placeWallSprite(this.physics.add.image(x, y, 'wall')).setTint(0x88aaff);
      gate.body.setImmovable(true);
      gate.body.allowGravity = false;
      gate.isGate = true; gate.gateOpen = false;
      gate.hp = 200; gate.maxHp = 200; // destructible
      if (this.hudCam) this.hudCam.ignore(gate);
      // Players can open/close by walking near
      this.builtWalls.push(gate);
      this._addWallToBuckets(gate);
      this._refreshWallClustersNear(gate.x, gate.y);
      this._paintMinimapTile(gate.x, gate.y, 0x88aaff);
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
      this._paintMinimapTile(x, y, 0xff8833);
      // Campfire heals nearby players over time
      this.time.addEvent({
        delay: CFG.CAMPFIRE_HEAL_MS, loop: true,
        callback: () => {
          if (!cf.active) return;
          [this.p1, this.p2].filter(Boolean).forEach(pl => {
            if (pl.isDowned) return;
            const d = Phaser.Math.Distance.Between(pl.spr.x, pl.spr.y, cf.x, cf.y);
            if (d < CFG.CAMPFIRE_HEAL_R) {
              const _cfHeal = this.hc.campfireHeal;
              const _cfHpBefore = pl.hp;
              pl.hp = Math.min(pl.maxHp, pl.hp + _cfHeal);
              // Suppress log spam when already at max HP — only log actual healing
              if (_cfHpBefore < pl.maxHp) {
                this._log(`${pl.charData.player} campfire heal +${_cfHeal}  hp=${pl.hp}/${pl.maxHp}`, 'player');
              }
            }
          });
        }
      });
    } else if (this.buildType === 'torch') {
      this._spawnTorch(x, y);
      this._paintMinimapTile(x, y, 0xffaa33);
    } else if (this.buildType === 'craftbench') {
      const cb = this.add.image(x, y, 'craftbench').setScale(2).setDepth(5);
      if (this.hudCam) this.hudCam.ignore(cb);
      this._w(cb);
      this.craftBenchPlaced = true;
      this.craftBenchPos = { x, y };
      // Register as minimap POI
      const cbTX = Math.floor(x / CFG.TILE), cbTY = Math.floor(y / CFG.TILE);
      this.pois.push({ type: 'craftbench', tx: cbTX, ty: cbTY, spr: cb });
      this._paintMinimapTile(x, y, 0xddcc44);
    } else if (this.buildType === 'bed') {
      const bd = this.add.image(x, y, 'bed').setScale(2).setDepth(5);
      if (this.hudCam) this.hudCam.ignore(bd);
      this._w(bd);
      const bedTX = Math.floor(x / CFG.TILE), bedTY = Math.floor(y / CFG.TILE);
      this.beds.push({ x, y, spr: bd });
      this.pois.push({ type: 'bed', tx: bedTX, ty: bedTY, spr: bd });
      this._paintMinimapTile(x, y, 0xaa88ff);
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
      st._builder = this.buildOwner || p;
      this.spikeTraps.push(st);
      this._paintMinimapTile(x, y, 0xdd2233);
      SFX._play(300, 'triangle', 0.08, 0.15);
      this.hint('Spike trap placed!', 1200);
      this.exitBuildMode(); return;
    }

    // Reinforced wall (300 HP variant)
    if (this.buildType === 'reinforced_wall') {
      const w = this._placeWallSprite(this.obstacles.create(x, y, 'wall')).setTint(0xaaaaff);
      w.hp = 300; w.maxHp = 300;
      this.builtWalls.push(w);
      this._addWallToBuckets(w);
      this._refreshWallClustersNear(w.x, w.y);
      this._paintMinimapTile(w.x, w.y, 0xccccff);
      if (this.hudCam) this.hudCam.ignore(w);
      SFX._play(400, 'triangle', 0.08, 0.2);
      this.hint('Reinforced Wall placed!', 1500);
      this.exitBuildMode(); return;
    }

    this.exitBuildMode();
    SFX._play(400, 'triangle', 0.08, 0.2);
    this.hint(this.buildType.charAt(0).toUpperCase() + this.buildType.slice(1) + ' placed!', 1500);
  },

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
  },

  // A recipe's cost, the same object the craft menu shows. {} for a key with no recipe.
  getBuildCost(type) {
    return RECIPE_COSTS.get(type) || {};
  },

  // Built walls and gates: the front face covers exactly the 32 px tile at (x, y) and the
  // top face rises above it. Not rotated: the art has a top, and a square wall needs no turn.
  _placeWallSprite(w) {
    const TOP = 9, ART_H = 30;
    w.setOrigin(0.5, (TOP + (ART_H - TOP) / 2) / ART_H).setScale(WALL_SCALE).setDepth(5 + Math.floor(w.y / CFG.TILE) * 0.01);
    if (w.body.physicsType === Phaser.Physics.Arcade.STATIC_BODY) {
      w.setImmovable(true); w.refreshBody();
      w.body.setSize(CFG.TILE, CFG.TILE, false);
      w.body.setOffset(0, TOP * WALL_SCALE);
    } else {
      w.body.setSize(ART_H - TOP, ART_H - TOP, false).setOffset(0, TOP);
    }
    return w;
  },

  openCraftMenu(player) {
    if (this.craftMenuOpen) { this.closeCraftMenu(); return; }
    this.craftMenuOpen = true;
    this._log(`${player.charData.player} opened craft menu`, 'player');
    this.craftMenuOwner = player;
    this.craftMenuSel = 0;
    this.craftMenuScroll = 0;
    // Recompute in case selection was restored — no-op on a fresh open at index 0.
    this._craftScrollToSel();
    // Contextual tip: first time opening crafting menu
    if (!this._ctx.firstCraft) {
      this._ctx.firstCraft = true;
      this._tutTrigger('craft');
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
      const PW = 440, PH = _isMobile ? 330 : 380;
      const ROW_H = 25, N_VISIBLE = Math.floor((PH - 94) / ROW_H);
      const PX = (W - PW) / 2, PY = H - PH - 20;
      const px = ptr.x, py = ptr.y;
      if (px < PX || px > PX + PW || py < PY || py > PY + PH) return;
      const scroll = this.craftMenuScroll || 0;
      for (let visIdx = 0; visIdx < N_VISIBLE; visIdx++) {
        const idx = visIdx + scroll;
        if (idx >= RECIPES.length) break;
        const rowY = PY + 34 + visIdx * ROW_H;
        if (py >= rowY - 2 && py < rowY + ROW_H) {
          if (idx === this.craftMenuSel) {
            this._log(`craft click confirm  sel=${idx} (${RECIPES[idx].label})  owner=${this.craftMenuOwner?.charData?.player}`, 'player');
            this.craftSelected();
          } else {
            this._log(`craft click select  sel=${idx} (${RECIPES[idx].label})  owner=${this.craftMenuOwner?.charData?.player}`, 'player');
            this.craftMenuSel = idx;
            this._craftScrollToSel();
          }
          return;
        }
      }
    };
    this.input.on('pointerdown', this._craftMenuPointerFn);

    this._craftMenuWheelFn = (pointer, currentlyOver, deltaX, deltaY) => {
      if (!this.craftMenuOpen) return;
      const PH = _isMobile ? 330 : 380;
      const ROW_H = 25, N_VISIBLE = Math.floor((PH - 94) / ROW_H);
      const maxScroll = Math.max(0, RECIPES.length - N_VISIBLE);
      this.craftMenuScroll = Phaser.Math.Clamp((this.craftMenuScroll || 0) + (deltaY > 0 ? 1 : -1), 0, maxScroll);
    };
    this.input.on('wheel', this._craftMenuWheelFn);
  },

  _craftScrollToSel() {
    const N_VISIBLE = Math.floor(((_isMobile ? 330 : 380) - 94) / 25);
    const maxScroll = Math.max(0, RECIPES.length - N_VISIBLE);
    let s = this.craftMenuScroll || 0;
    if (this.craftMenuSel < s) s = this.craftMenuSel;
    else if (this.craftMenuSel >= s + N_VISIBLE) s = this.craftMenuSel - N_VISIBLE + 1;
    // Clamp so we never scroll past the final row — otherwise the view leaves
    // an empty gap at the bottom when the selection is near the tail of the list.
    this.craftMenuScroll = Phaser.Math.Clamp(s, 0, maxScroll);
  },

  closeCraftMenu() {
    this._log(`craft menu closed`, 'player');
    this.craftMenuOpen = false;
    this.craftMenuOwner = null;
    if (this._craftMenuPointerFn) {
      this.input.off('pointerdown', this._craftMenuPointerFn);
      this._craftMenuPointerFn = null;
    }
    if (this._craftMenuWheelFn) {
      this.input.off('wheel', this._craftMenuWheelFn);
      this._craftMenuWheelFn = null;
    }
    if (this.craftMenuGfx) { this.craftMenuGfx.destroy(); this.craftMenuGfx = null; }
    this._craftMenuText && this._craftMenuText.forEach(t => t.destroy());
    this._craftMenuText = [];
  },

  updateCraftMenu(delta) {
    if (!this.craftMenuOpen) return;

    // Keyboard navigate up / down
    if (Phaser.Input.Keyboard.JustDown(this._craftNavUp) || Phaser.Input.Keyboard.JustDown(this._craftNavUp2)) {
      this.craftMenuSel = (this.craftMenuSel - 1 + RECIPES.length) % RECIPES.length;
      this._craftScrollToSel();
      this._log(`craft nav up  sel=${this.craftMenuSel} (${RECIPES[this.craftMenuSel].label})  owner=${this.craftMenuOwner?.charData?.player}`, 'player');
    }
    if (Phaser.Input.Keyboard.JustDown(this._craftNavDn) || Phaser.Input.Keyboard.JustDown(this._craftNavDn2)) {
      this.craftMenuSel = (this.craftMenuSel + 1) % RECIPES.length;
      this._craftScrollToSel();
      this._log(`craft nav dn  sel=${this.craftMenuSel} (${RECIPES[this.craftMenuSel].label})  owner=${this.craftMenuOwner?.charData?.player}`, 'player');
    }

    // Touch joystick navigate up / down (350ms repeat debounce)
    if (this._touchActive && this._joy) {
      this._craftTouchNavCd = (this._craftTouchNavCd || 0) - delta;
      const jy = this._joy.vec.y;
      if (this._craftTouchNavCd <= 0 && Math.abs(jy) > 0.5) {
        this.craftMenuSel = (this.craftMenuSel + (jy > 0 ? 1 : -1) + RECIPES.length) % RECIPES.length;
        this._craftScrollToSel();
        this._craftTouchNavCd = 350;
        this._log(`craft nav joy  sel=${this.craftMenuSel} (${RECIPES[this.craftMenuSel].label})  owner=${this.craftMenuOwner?.charData?.player}`, 'player');
      }
    }

    this.renderCraftMenu();
  },

  renderCraftMenu() {
    const { W, H } = CFG;
    const team = this.getTeamInv();
    const PW = 440, PH = _isMobile ? 330 : 380;
    const ROW_H = 25, N_VISIBLE = Math.floor((PH - 94) / ROW_H);
    const PX = (W - PW) / 2, PY = H - PH - 20;
    const scroll = this.craftMenuScroll || 0;

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

    // Scroll indicators
    if (scroll > 0) {
      addTxt(PX + PW/2, PY + 26, `▲  ${scroll} more above`, { fontSize:'9px', color:'#778866' }).setOrigin(0.5);
    }
    const moreBelow = RECIPES.length - (scroll + N_VISIBLE);
    if (moreBelow > 0) {
      const arrowY = PY + 34 + N_VISIBLE * ROW_H + 3;
      addTxt(PX + PW/2, arrowY, `▼  ${moreBelow} more below`, { fontSize:'9px', color:'#778866' }).setOrigin(0.5);
    }

    // Hover detection for mouse (skip on touch)
    const mPtr = this._touchActive ? null : this.input.activePointer;
    let hoverIdx = -1;
    if (mPtr) {
      for (let visIdx = 0; visIdx < N_VISIBLE; visIdx++) {
        const idx = visIdx + scroll;
        if (idx >= RECIPES.length) break;
        const rowY = PY + 34 + visIdx * ROW_H;
        if (mPtr.x >= PX && mPtr.x <= PX + PW && mPtr.y >= rowY - 2 && mPtr.y < rowY + ROW_H) {
          hoverIdx = idx; break;
        }
      }
    }

    // Render visible items
    for (let visIdx = 0; visIdx < N_VISIBLE; visIdx++) {
      const idx = visIdx + scroll;
      if (idx >= RECIPES.length) break;
      const rec = RECIPES[idx];
      const rowY = PY + 34 + visIdx * ROW_H;
      const isSelected = idx === this.craftMenuSel;
      const isHovered = idx === hoverIdx && !isSelected;

      // Selection highlight
      if (isSelected) {
        g.fillStyle(0x224411, 0.9); g.fillRect(PX + 6, rowY - 2, PW - 12, 22);
        g.lineStyle(1, 0x44aa22, 0.8); g.strokeRect(PX + 6, rowY - 2, PW - 12, 22);
      } else if (isHovered) {
        g.fillStyle(0x1a2a11, 0.7); g.fillRect(PX + 6, rowY - 2, PW - 12, 22);
      }

      // Bench requirement and affordability
      const wrongChar = rec.type === 'instant' && rec.charId && this.craftMenuOwner?.charData.id !== rec.charId;
      const locked = (rec.needsBench && !this.craftBenchPlaced) || wrongChar;
      const canAfford = !locked && Object.entries(rec.cost).every(([r,a]) => (team[r]||0) >= a);

      const nameColor = locked ? '#555544' : isSelected ? '#ffffff' : isHovered ? '#ddeedd' : '#aabbaa';
      const costColor = canAfford ? '#66ee44' : '#ee4422';

      const costStr = Object.entries(rec.cost).map(([r,a]) => a+' '+r).join(', ');
      const suffix  = wrongChar ? ` [${CRAFTER_NAME[rec.charId]} only]` : locked ? ' [bench reqd]' : '';
      addTxt(PX + 18, rowY + 2, rec.label + suffix, { color: nameColor });
      addTxt(PX + PW - 18, rowY + 2, costStr, { color: costColor }).setOrigin(1, 0);
    }

    // Tooltip section — shows description for hovered item (mouse) or selected item (keyboard/touch)
    const tooltipRec = RECIPES[hoverIdx >= 0 ? hoverIdx : this.craftMenuSel];
    const itemsEnd = PY + 34 + N_VISIBLE * ROW_H;
    const sepY = itemsEnd + (moreBelow > 0 ? 16 : 6);
    g.lineStyle(1, 0x334422, 0.8); g.lineBetween(PX + 12, sepY, PX + PW - 12, sepY);
    if (tooltipRec) {
      const typeTag = { build: '[BUILD]', instant: '[INSTANT]', upgrade: '[UPGRADE]' }[tooltipRec.type] || '';
      addTxt(PX + 18, sepY + 6, `${typeTag}  ${tooltipRec.label}`, { fontSize:'10px', color:'#aacc88' });
      addTxt(PX + 18, sepY + 19, tooltipRec.tooltip || '', { fontSize:'10px', color:'#889977' });
    }
  },

  craftSelected() {
    if (!this.craftMenuOpen) return;
    const rec = RECIPES[this.craftMenuSel];
    const player = this.craftMenuOwner;
    const team = this.getTeamInv();

    // Bench requirement
    if (rec.needsBench && !this.craftBenchPlaced) {
      this.hint('Need a Craftbench first!', 2000); return;
    }
    // Instant items with a charId are for that character's crafter only
    if (rec.type === 'instant' && rec.charId && player.charData.id !== rec.charId) {
      this.hint(`Only ${CRAFTER_NAME[rec.charId]} can craft that!`, 2000); return;
    }
    if (rec.key === 'ammo_pack' && player.reserveAmmo >= 40 - player.ammo) {
      this.hint('Ammo reserve is full!', 2000); return;
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
      this._log(`Craft queued: ${rec.label}  by=${player.charData.player}`, 'build');
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
    this._hudDirty = true; // inventory (Wood/Metal/Fiber/Food) changed — refresh the readout

    if (rec.type === 'instant' && rec.key === 'flower_bouquet') {
      // Flower Bouquet: +8 flowers for Lauren (only she can craft it)
      player.flowerAmmo = (player.flowerAmmo || 0) + 8;
      this._log(`${player.charData.player} got +8 flowers  flowers=${player.flowerAmmo}`, 'player');
      this.hint('+8 Flowers for Lauren! (' + player.flowerAmmo + ' total)', 2000);
      this._hudDirty = true;
    } else if (rec.type === 'instant' && rec.key === 'ammo_pack') {
      // Ammo Pack: +8 reserve ammo for the Gunslinger (only the Gunslinger can craft it)
      const maxReserve = 40 - player.ammo;
      const added = Math.min(8, maxReserve - player.reserveAmmo);
      player.reserveAmmo += added;
      this.hint('+' + added + ' ammo (Gunslinger)', 2000);
      this._hudDirty = true;
    } else if (rec.type === 'instant' && rec.key === 'med_kit') {
      // D8 — Med Kit: restore HP (difficulty-scaled) to the crafting player, green flash
      const _medHeal = this.hc.medkitHeal;
      player.hp = Math.min(player.maxHp, player.hp + _medHeal);
      this._log(`${player.charData.player} used Med Kit +${_medHeal}  hp=${player.hp}/${player.maxHp}`, 'player');
      player.spr.setTint(0x44ff44);
      this.time.delayedCall(300, () => {
        if (!player.spr?.active) return;
        if (player._frostSlowed) player.spr.setTint(0x88ccff);
        else player.spr.clearTint();
      });
      this.hint(player.charData.player + ' used Med Kit: +' + _medHeal + ' HP!', 2000);
      this._hudDirty = true;
    } else if (rec.type === 'upgrade') {
      const target = [this.p1, this.p2].filter(Boolean).find(p => p.charData.id === rec.charId);
      if (!target) { this.hint('That character isn\'t in the game!', 2000); return; }
      // Per-character upgrade flags so each character tracks its own upgrade independently
      const upgradeFlag = '_' + rec.charId + 'Upgraded';
      if (target[upgradeFlag]) { this.hint('Already upgraded!', 1500); return; }
      target[upgradeFlag] = true;
      this._hudDirty = true;
      if (rec.charId === 'gunslinger') target._gunslingerClip = 12;
      if (rec.charId === 'charmer') target._charmerUpgraded = true;
      if (rec.charId === 'ranger') target._rangerUpgraded = true;
      const _upgradeEffect = rec.charId === 'knight'     ? 'shield_throw=on  block=70%'
                           : rec.charId === 'architect'  ? 'nail_gun=on'
                           : rec.charId === 'gunslinger' ? 'clip=8→12'
                           : rec.charId === 'charmer'    ? 'aura_expanded=on  night_partial=on'
                           : rec.charId === 'ranger'     ? 'explosive_arrows=on'
                           : 'flag_set';
      this._log(`${target.charData.player} upgrade applied: ${rec.charId}  effect=${_upgradeEffect}  flag=${upgradeFlag}=true`, 'player');
      target.spr.setTint(0xffaa22);
      this.time.delayedCall(400, () => {
        if (!target.spr?.active) return;
        if (target._frostSlowed) target.spr.setTint(0x88ccff);
        else target.spr.clearTint();
      });
      const upgradeDesc = rec.charId === 'charmer' ? ' — Aura 280px by day, 140px at night!' :
                          rec.charId === 'ranger'  ? ' — Explosive arrows unlocked!' : '';
      this.hint(rec.label + ' unlocked for ' + target.charData.player + '!' + upgradeDesc, 3000);
    }
  },

  getTeamInv() {
    const inv = { wood:0, metal:0, fiber:0, food:0 };
    [this.p1, this.p2].filter(p => p && p.inv).forEach(p => {
      for (const k of Object.keys(inv)) inv[k] += (p.inv[k] || 0);
    });
    return inv;
  },

  // ── BARRACKS OVERLAY ─────────────────────────────────────────
  buildBarrackOverlay() {
    const { W, H } = CFG;
    this.bObjs = [];
    const push = o => { this.bObjs.push(o); this._h(o); return o; };
    const t = (x,y,str,sty) => push(this.add.text(x,y,str,sty).setDepth(211));

    // 0.70 alpha so the player can still see the world they're stepping
    // away from — earlier 0.92 felt like a full scene transition.
    push(this.add.graphics().setDepth(210)).fillStyle(0x000000, 0.70).fillRect(0,0,W,H);
    t(W/2,52,'BARRACKS \u2014 SWAP CHARACTER',{ fontFamily:'monospace', fontSize:'24px', color:'#cc8833', stroke:'#000', strokeThickness:3 }).setOrigin(0.5);
    this.bHintText = t(W/2, 90, '', { fontFamily:'monospace', fontSize:'13px', color:'#666677' }).setOrigin(0.5);

    this.bCards = CHARS.map((ch, i) => {
      const spacing = Math.min(250, Math.floor((W - 240) / (CHARS.length - 1)));
      // y shifted down so the taller card (sprite + text below it) stays vertically centred
      const x = W/2 + (i - Math.floor(CHARS.length / 2)) * spacing, y = H/2+20;
      const box    = push(this.add.graphics().setDepth(211));
      // sprite at y-60; at scale 2.5 the 60px-tall texture → 150px, so top = y-135, bottom = y+15
      const spr    = push(this.add.image(x, y-60, 'player_atlas', ch.id).setScale(2.5).setDepth(212));
      // name/title/state all sit below sprite bottom (y+15) with comfortable clearance
      const nameT  = push(t(x, y+28, ch.player, { fontFamily:'monospace', fontSize:'18px', color:'#'+ch.color.toString(16).padStart(6,'0') }).setOrigin(0.5));
      const titT   = push(t(x, y+50, ch.title,  { fontFamily:'monospace', fontSize:'12px', color:'#777788' }).setOrigin(0.5));
      const stateT = push(t(x, y+70, '',         { fontFamily:'monospace', fontSize:'12px', color:'#ff4444' }).setOrigin(0.5));
      return { box, spr, nameT, titT, stateT, x, y };
    });

    push(t(W/2, H-46, 'Move keys to browse   |   F / /  to confirm   |   ESC to cancel', { fontFamily:'monospace', fontSize:'12px', color:'#445544' }).setOrigin(0.5));
    this.bObjs.forEach(o => o.setVisible(false));
  },

  openBarrack(player) {
    this._log(`${player.charData.player} opened barracks`, 'player');
    this.barrackOpen = true; this.barrackOwner = player;
    this.barrackSel = CHARS.findIndex(c => c.id === player.charData.id);
    this.bHintText.setText(player===this.p1 ? 'A / D to select   |   F to confirm' : 'Arrow keys   |   / to confirm');
    this.bObjs.forEach(o => o.setVisible(true));
    this.refreshBarrackCards();

    // Remove any stale handler first — guards against openBarrack being called
    // twice without an intervening closeBarrack (e.g. both players interact same frame).
    if (this._barrackPointerFn) this.input.off('pointerdown', this._barrackPointerFn);
    this._barrackPointerFn = (ptr) => {
      if (!this.barrackOpen) return;
      for (let i = 0; i < this.bCards.length; i++) {
        const c = this.bCards[i];
        if (ptr.x >= c.x - 106 && ptr.x <= c.x + 106 && ptr.y >= c.y - 140 && ptr.y <= c.y + 85) {
          if (i === this.barrackSel) { this.barrackConfirm(); }
          else { this.barrackSel = i; this.refreshBarrackCards(); }
          return;
        }
      }
    };
    this.input.on('pointerdown', this._barrackPointerFn);
  },

  barrackNav(dir) {
    this.barrackSel = Phaser.Math.Wrap(this.barrackSel+dir, 0, CHARS.length);
    this._log(`barracks nav ${dir > 0 ? 'right' : 'left'}  sel=${this.barrackSel} (${CHARS[this.barrackSel].id})  owner=${this.barrackOwner?.charData?.player}`, 'player');
    this.refreshBarrackCards();
  },

  barrackConfirm() {
    if (!this.barrackOpen) return;
    const player = this.barrackOwner;
    const newCh  = CHARS[this.barrackSel];
    const other  = (player===this.p1 && this.p2) ? this.p2.charData : (player===this.p2) ? this.p1.charData : null;
    if (other && newCh.id===other.id) { this._log(`barracks confirm blocked – ${newCh.id} already taken`, 'player'); this.hint('That character is already taken!', 1800); return; }

    const hpPct      = player.hp / player.maxHp;
    const _prevChar  = player.charData.id;
    this._log(`Barracks: ${player.charData.player} swapped ${_prevChar} → ${newCh.id}`, 'player');
    player.charData  = newCh;
    player.maxHp     = Math.max(1, Math.round(newCh.maxHp * this.hc.maxHpMult));
    player.hp        = Math.max(1, Math.round(player.maxHp * hpPct));
    player.spr.setTexture('player_atlas', newCh.id);
    player.lbl.setText(newCh.player);

    // Reset transient debuffs/status so effects from the previous class don't
    // carry over. Upgrade flags are left alone — they're per-character and
    // remain active if the player swaps back to that class later.
    player._speedMult = 1;
    player._frostSlowed = false;
    player._webbed = false;
    player._webSlowCd = 0;
    player._allyTarget = null;
    player.atkAnimUntil = 0;
    if (player.spr?.active) player.spr.clearTint();
    if (newCh.id==='gunslinger') {
      player.ammo = 8;
      const maxReserve = 40 - player.ammo;
      // A new Gunslinger starts at the cap (8 clip + 32 reserve), so carried ammo adds nothing here
      // and is lost by design (Jared, October 6, 2026: accept the loss).
      const carried = player.carriedAmmo || 0;
      player.reserveAmmo = Math.min(maxReserve, 32 + carried);
      player.carriedAmmo = 0;
      if (carried > 0) this._log(`Barracks: ${carried} carried ammo → reserveAmmo=${player.reserveAmmo}`, 'player');
    }

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

    this._hudDirty = true; this.closeBarrack();
    this.hint('Now ' + newCh.player + ' — ' + newCh.title + '!', 2500);
  },

  refreshBarrackCards() {
    const otherId = (this.barrackOwner===this.p1 && this.p2) ? this.p2.charData.id : (this.barrackOwner===this.p2) ? this.p1.charData.id : null;
    this.bCards.forEach((card, i) => {
      const ch=CHARS[i], isSel=i===this.barrackSel, isCur=ch.id===this.barrackOwner.charData.id, isTaken=ch.id===otherId;
      card.box.clear();
      card.box.fillStyle(isSel?0x1e2e1e:0x0e0e1a, 0.96);
      card.box.fillRoundedRect(card.x-106, card.y-140, 212, 225, 10);
      card.box.lineStyle(isSel?3:2, isSel?0xcc8833:isCur?0x4488ff:isTaken?0x663333:0x2a2a3a);
      card.box.strokeRoundedRect(card.x-106, card.y-140, 212, 225, 10);
      card.spr.setAlpha(isTaken?0.28:1);
      card.stateT.setText(isCur?'(current)':isTaken?'(taken)':'');
      card.stateT.setColor(isCur?'#4488ff':'#ff4444');
    });
  },

  closeBarrack() {
    if (!this.barrackOpen) return;
    this._log(`barracks closed`, 'player');
    this.barrackOpen = false; this.barrackOwner = null;
    this.bObjs.forEach(o => o.setVisible(false));
    if (this._barrackPointerFn) {
      this.input.off('pointerdown', this._barrackPointerFn);
      this._barrackPointerFn = null;
    }
  },

  checkBarrackRange() {
    const near = p => p && p.spr && Phaser.Math.Distance.Between(p.spr.x, p.spr.y, this.bPos.x, this.bPos.y) < 110;
    this.bPrompt.setVisible(near(this.p1) || near(this.p2));
  },
});
