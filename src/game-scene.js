'use strict';
// ── src/game-scene.js — GameScene: all 22 gameplay systems ───────────────────
// Globals exported: GameScene, GameScene.RECIPES
// Systems: world-gen, enemy AI, dens, waves/bosses, player movement, player combat,
//          death/revive, building/crafting, walls/spikes, day/night, relics,
//          raiders, harvesting, cameras, HUD/minimap, fog-of-war, audio hooks,
//          input, debug log, tutorial, game-over/victory, settings/save
// grep: "// ── SYSTEM:"  "spawnBoss"  "updateEnemies"  "buildWorld"  "_log("
// ALWAYS ask for the debug log when investigating bugs (backtick in-game to view).

class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    // Reset world-ready flag immediately — Phaser reuses the same class instance
    // on scene restart, so the flag from the previous run would otherwise keep
    // update() running against stale state before the deferred init fires.
    this._worldReady = false;

    // Drop stale references from the previous run before buildWorld repopulates them.
    // Most of these are re-assigned during world-gen, but explicit clearing here
    // prevents update() from seeing last-run data during the staged init window.
    this._toxicTileIndex = null;
    this._waterMap = null;
    this._iceMap = null;
    this._packIndex = null;
    this.fogRevealed = null;
    this.fogVisible = null;
    this._fogVisibleBuilding = false;
    this._activePlayers = null;
    this._sleepIndicator = null;
    this._fireGlows = [];
    this._glowFlicker = { t: 0 };
    this._glowFrame = 0;
    this.reviving = false;
    this.reviveProgress = 0;
    this.reviveTarget = null;

    // One-time shutdown hook: remove touch listeners (guards against double-add
    // if scene restarts mid-session) and kill any leftover scene-owned tweens.
    if (!this._shutdownRegistered) {
      this._shutdownRegistered = true;
      this.events.on('shutdown', () => {
        if (this.input) {
          this.input.off('pointerdown',      this._onTouchDown, this);
          this.input.off('pointermove',      this._onTouchMove, this);
          this.input.off('pointerup',        this._onTouchUp,   this);
          this.input.off('pointerupoutside', this._onTouchUp,   this);
        }
        if (this.tweens) this.tweens.killAll();
        if (this._onVisibilityChange) {
          document.removeEventListener('visibilitychange', this._onVisibilityChange);
          window.removeEventListener('blur',  this._onBlur);
          window.removeEventListener('focus', this._onFocus);
          this._onVisibilityChange = null;
        }
      });
    }

    // Auto-pause when the tab is hidden or window loses focus. Without this the
    // physics loop keeps running in the background; on refocus Phaser delivers
    // a multi-second delta that teleports enemies and desyncs co-op.
    this._onVisibilityChange = () => {
      if (document.hidden) this._autoPause('hidden');
      else                 this._autoResume();
    };
    this._onBlur  = () => this._autoPause('blur');
    this._onFocus = () => this._autoResume();
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    window.addEventListener('blur',  this._onBlur);
    window.addEventListener('focus', this._onFocus);

    const worldW = CFG.MAP_W * CFG.TILE, worldH = CFG.MAP_H * CFG.TILE;
    const cx = worldW/2, cy = worldH/2;

    // Debug log persists across restarts so the full session history is always in the download.
    // Flush any menu-button events that were queued between scenes.
    if (!this._dbgEntries) this._dbgEntries = [];
    this._dbgVisible = false;
    this._runCount = (this._runCount || 0) + 1;
    const _runLabel = `=== RUN #${this._runCount} === mode=${STATE.mode === 1 ? '1P' : '2P'} diff=${STATE.difficulty || 'survival'}`;
    this._dbgEntries.push(_runLabel);
    _pendingLogMsgs.forEach(m => this._dbgEntries.push(m));
    _pendingLogMsgs = [];

    this.solo        = STATE.mode === 1;
    this.hardcore    = STATE.difficulty === 'hardcore';
    // Difficulty modifier table — Survival uses identity values, Hardcore tightens every axis.
    // Centralising here so every call-site reads `this.hc.*` instead of a bare constant.
    this.hc = this.hardcore ? {
      // Flavor 1 — survivability
      maxHpMult: 0.9, campfireHeal: 2, bedHealPerTick: 5, foodHealMult: 0.75, medkitHeal: 25,
      // Flavor 2 — enemy aggression
      diffBase: 1.15, diffRamp: 0.15, diffCap: 3.5,
      nightMult: 1.55, waveInterval: 75000,
      denRespawn: 20000, waterDenRespawn: 18000, huntingPartyStartDay: 1,
      // Flavor 3 — boss / pressure events
      bossStartDay: 4, bossHpMult: 1.20, bossDmgMult: 1.15, raidRespawnDays: 7,
      // Flavor 4 — scarcity / info
      resourceDropMult: 0.75, rareDropsBossOnly: true, fogRevealMult: 0.8, minimapDefaultOff: true,
    } : {
      maxHpMult: 1.0, campfireHeal: 3, bedHealPerTick: 8, foodHealMult: 1.0, medkitHeal: 40,
      diffBase: 1.0,  diffRamp: 0.10, diffCap: 3.0,
      nightMult: 1.35, waveInterval: 90000,
      denRespawn: 30000, waterDenRespawn: 25000, huntingPartyStartDay: 2,
      bossStartDay: 5, bossHpMult: 1.0, bossDmgMult: 1.0, raidRespawnDays: 10,
      resourceDropMult: 1.0, rareDropsBossOnly: false, fogRevealMult: 1.0, minimapDefaultOff: false,
    };
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

    // Contextual tutorial hint flags (each fires once)
    this._ctx = {
      nearTree: false, firstHarvest: false, firstCraft: false,
      firstNight: false, firstUpgradeHint: false,
    };

    // Day/night state
    this.dayNum = 1; this.dayTimer = 0; this.DAY_DUR = 150000; this.isNight = false;
    this.kills = 0;
    this.resourcesGathered = 0;
    this.teamAmmoPool = 0;
    this.bossSpawned = false;
    this.bossDefeated = false;
    this.boss = null;

    // Relic / win condition state
    this.relicsHeld      = 0;
    this.relicsDeposited = 0;
    this._relicPOIs      = [];
    this.altarPos        = null;
    this.altarDiscovered = false;
    this._relicHintShown = false;
    // Track who actually picked up a relic so the aura/apocalypse converge on
    // the real carrier, not just "first alive player". Critical for co-op —
    // otherwise P2 runs free while P1 gets swarmed.
    this._relicCarrierPlayer = null;
    this.raiders = [];
    this.raidCamp = null;
    this.raidRespawnDay = null;
    // Per-player relic pickup channel — 3s hold of Interact key to acquire.
    this._relicChannels = new Map();
    // First hunting party arrives on day 2-3; every 2-3 days after.
    this.huntNextDay = 2 + Phaser.Math.Between(0, 1);
    this.enemies = [];

    // Build system state
    this.buildMode = false;
    this.buildGhost = null;
    this.builtWalls = [];
    // Spatial bucket: tile-coord key -> array of walls. Keeps LOS/steering/placement
    // checks O(1) per sample instead of O(walls).
    this._wallBuckets = new Map();
    this.craftBenchPlaced = false;
    this.beds = [];
    this.sleepSpeedMult = 1;   // 8x when all players are sleeping through night
    this.spikeTraps = [];      // D7 spike traps

    // D1 — Craft menu state
    this.craftMenuOpen = false;
    this.craftMenuOwner = null;
    this.craftMenuSel = 0;
    this.craftMenuGfx = null;

    // Show loading progress bar on the black screen.
    // iOS PWA needs at least one yielded frame before heavy synchronous work.
    // Staged init lets the browser repaint between each phase so the bar stays live.
    const _BAR_W = 300, _BAR_H = 14;
    const _barX = CFG.W / 2 - _BAR_W / 2, _barY = CFG.H / 2 + 8;
    const _barBg  = this.add.graphics().setScrollFactor(0).setDepth(999);
    const _barFg  = this.add.graphics().setScrollFactor(0).setDepth(999);
    const _loadTx = this.add.text(CFG.W / 2, CFG.H / 2 - 18, 'Building world...', {
      fontFamily: 'monospace', fontSize: '14px', color: '#556655',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(999);
    const _pctTx  = this.add.text(CFG.W / 2, _barY + _BAR_H + 7, '0%', {
      fontFamily: 'monospace', fontSize: '10px', color: '#334433',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(999);

    const _setProgress = (pct, label) => {
      _barBg.clear();
      _barBg.fillStyle(0x1a1a28);
      _barBg.fillRect(_barX, _barY, _BAR_W, _BAR_H);
      _barFg.clear();
      _barFg.fillStyle(0x3a6a3a);
      _barFg.fillRect(_barX, _barY, Math.max(2, Math.floor(_BAR_W * pct / 100)), _BAR_H);
      if (label) _loadTx.setText(label);
      _pctTx.setText(pct + '%');
    };
    const _destroyBar = () => {
      [_barBg, _barFg, _loadTx, _pctTx].forEach(o => { if (o?.active) o.destroy(); });
    };
    const _initFail = (err) => {
      _destroyBar();
      const msg = err?.message || String(err);
      this._log('INIT FAILED: ' + msg, 'error');
      if (err?.stack) this._log('stack: ' + err.stack.split('\n').slice(0, 4).join(' | '), 'error');
      console.error('[IW] World init exception:', err);
      this.add.text(CFG.W / 2, CFG.H / 2,
        'Load error on run #' + this._runCount + '\n' + msg + '\n\nCheck console (F12) or press ` to view log',
        { fontFamily: 'monospace', fontSize: '12px', color: '#ff4444',
          backgroundColor: '#000000cc', padding: { x: 12, y: 8 }, align: 'center' }
      ).setOrigin(0.5).setScrollFactor(0).setDepth(1000);
    };
    _setProgress(0, 'Building world...');

    // ── Stage 0 (t≈64 ms): physics bounds + biome seeds ────────
    this.time.delayedCall(64, () => {
      try {
        // Initialise world seed from URL (?seed=N) or a fresh timestamp value
        const _urlSeed = (() => { try { return parseInt(new URLSearchParams(location.search).get('seed') || ''); } catch(e) { return NaN; } })();
        this._worldSeed = isNaN(_urlSeed) ? (Date.now() & 0x7fffffff) : _urlSeed;
        _worldRng = _makeMulberry32(this._worldSeed);
        this._log(`World init start  run=#${this._runCount}  ${this.solo?'1P':'2P'}  ${this.hardcore?'hardcore':'survival'}  seed=${this._worldSeed}`, 'world');
        // Hardcore tuning snapshot — lets session logs show exactly what modifiers were active
        const _hc = this.hc;
        this._log(
          `HC tuning  hp=${_hc.maxHpMult}x  camp=${_hc.campfireHeal}  bed=${_hc.bedHealPerTick}  food=${_hc.foodHealMult}x  med=${_hc.medkitHeal}  ` +
          `diff=${_hc.diffBase}+${_hc.diffRamp}/day cap=${_hc.diffCap}x  night=${_hc.nightMult}x  wave=${_hc.waveInterval/1000}s  ` +
          `den=${_hc.denRespawn/1000}/${_hc.waterDenRespawn/1000}s  huntDay=${_hc.huntingPartyStartDay}  ` +
          `boss=day${_hc.bossStartDay} hp${_hc.bossHpMult}x dmg${_hc.bossDmgMult}x  raidBack=${_hc.raidRespawnDays}d  ` +
          `loot=${_hc.resourceDropMult}x rareBossOnly=${_hc.rareDropsBossOnly}  fog=${_hc.fogRevealMult}x  mmOff=${_hc.minimapDefaultOff}`,
          'world'
        );
        this.physics.world.setBounds(0, 0, worldW, worldH);
        _setProgress(5, 'Seeding biomes...');
        this._log('World init: biome seeds', 'world');
        this._initBiomeSeeds();
      } catch (err) { _initFail(err); return; }

      // ── Stage 0.5: chunked biome map build ───────────────────
      // The biome map is 90 000 tiles × ~18 Voronoi distance ops each. Done
      // sync this blocks for hundreds of ms — the user-reported "5% hang."
      // Drive it across frames so the bar moves 5% → 28% smoothly.
      _buildBiomeMapChunked(
        (frac) => {
          const pct = 5 + Math.floor(frac * 23); // 5 → 28
          _setProgress(pct, 'Painting biomes...');
        },
        () => {
          this._log('World init: biome map ready', 'world');

      // ── Stage 1: world generation ───────────────────────────
      this.time.delayedCall(16, () => {
        try {
          _setProgress(30, 'Building world...');
          this._log('World init: buildWorld start', 'world');
          this.buildWorld(worldW, worldH, cx, cy);
          this._log(`World init: buildWorld done  enemies_placed=${(this.enemies||[]).length}`, 'world');
          _setProgress(58, 'Spawning players...');
        } catch (err) { _initFail(err); return; }

        // ── Stage 2 (t≈96 ms): players + input + camera ──────
        this.time.delayedCall(16, () => {
          try {
            const p1Ch = CHARS.find(c => c.id === STATE.p1CharId);
            const p2Ch = this.solo ? null : CHARS.find(c => c.id === STATE.p2CharId);

            this.p1 = this.spawnPlayer(cx - 55, cy, p1Ch, 1);
            this.p2 = this.solo ? null : this.spawnPlayer(cx + 55, cy, p2Ch, 2);

            this.physics.add.collider(this.p1.spr, this.obstacles);
            if (this.p2) {
              this.physics.add.collider(this.p2.spr, this.obstacles);
              this.physics.add.collider(this.p1.spr, this.p2.spr);
            }

            // Setup crate pickups now that players exist
            this.setupCratePickups();

            // Toxic pool damage — handled per-frame via _toxicTileIndex in applyTerrainEffects
            // (physics overlap approach replaced: scaled O(pools * players) every frame)

            // Shallow water wading + ice + toxic detection — all handled per-frame via
            // _waterMap / _iceMap / _toxicMap Uint8Array lookups in applyTerrainEffects.
            // Physics overlap approach was both buggy (stale flags) and slow (~1000 bodies).

            // Input — load saved bindings (falls back to DEFAULT_BINDINGS)
            const K = Phaser.Input.Keyboard.KeyCodes;
            const _B = Object.assign({}, DEFAULT_BINDINGS, loadSettings().bindings || {});
            this.wasd    = this.input.keyboard.addKeys({ up:K[_B.p1up], down:K[_B.p1down], left:K[_B.p1left], right:K[_B.p1right] });
            // P2 keys and interact hotkey only registered in 2P mode — avoids a dangling
            // Key object (and its scan in the keyboard manager's per-frame loop) in solo play.
            this.p2keys  = this.p2 ? this.input.keyboard.addKeys({ up:K[_B.p2up], down:K[_B.p2down], left:K[_B.p2left], right:K[_B.p2right] }) : null;
            const _hk = { p1use:K[_B.p1interact], tab:K.TAB, esc:K.ESC };
            if (this.p2) _hk.p2use = K[_B.p2interact];
            this.hotkeys = this.input.keyboard.addKeys(_hk);
            // Prevent browser from stealing Tab (focus cycle) while the game is running
            this.input.keyboard.addCapture(K.TAB);

            this.hotkeys.p1use.on('down', () => { if (!this.barrackOpen && !this.isOver) this.tryInteract(this.p1); });
            if (this.p2) this.hotkeys.p2use.on('down', () => { if (!this.barrackOpen && !this.isOver) this.tryInteract(this.p2); });
            // Tab and Escape share the same menu-dismiss priority chain.
            // When nothing is open: Tab → show controls overlay; Esc → open pause/settings.
            // This makes Tab a full Escape substitute on keyboards without an Esc key.
            const _makeMenuHandler = (fallback) => () => {
              if (this.isOver) return;
              if (this.barrackOpen)   { this.closeBarrack(); return; }
              if (this.craftMenuOpen) { this.closeCraftMenu(); return; }
              if (this.controlsVis)   { this.toggleControls(); return; }
              fallback();
            };
            this.hotkeys.tab.on('down', _makeMenuHandler(() => this.openPauseSettings()));
            this.hotkeys.esc.on('down', _makeMenuHandler(() => this.openPauseSettings()));

            // Backtick/grave (`) toggles the debug event log
            this.input.keyboard.addKey(192).on('down', () => {
              this._dbgVisible = !this._dbgVisible;
              if (this._dbgTxt) {
                this._dbgTxt.setVisible(this._dbgVisible);
                if (this._dbgVisible) this._dbgRefresh(true);
              }
            });
            // C — copy log to clipboard while overlay is open
            this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C).on('down', () => {
              if (!this._dbgVisible || !this._dbgEntries) return;
              const t = Math.floor(this.timeAlive || 0);
              const text = [
                `IRON WASTELAND SESSION LOG`,
                `Version : ${_fmtVersion(VERSION)}  Exported: ${new Date().toLocaleString()}`,
                `Time    : ${Math.floor(t/60)}m ${t%60}s  Day: ${this.dayNum||1}  Kills: ${this.kills||0}`,
                ``,
                ...this._dbgEntries,
              ].join('\n');
              navigator.clipboard.writeText(text)
                .then(() => this.hint('Log copied to clipboard!', 2000))
                .catch(() => this.hint('Copy failed — try G to download instead', 2000));
            });
            // G — download full log as .txt while overlay is open
            this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G).on('down', () => {
              if (!this._dbgVisible) return;
              this._downloadLog();
              this.hint('Log saved as .txt file!', 2000);
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
              p1atk: K[_B.p1attack], p1alt: K[_B.p1alt], p1build: K[_B.p1build],
              p2atk: K[_B.p2attack], p2alt: K[_B.p2alt], p2build: K[_B.p2build],
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
                // Craft menu consumes click — don't bleed into attack (gunslinger loses ammo otherwise)
                if (this.craftMenuOpen) return;
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

            _setProgress(75, 'Building HUD...');
          } catch (err) { _initFail(err); return; }

          // ── Stage 3 (t≈112 ms): HUD + cameras ───────────────
          this.time.delayedCall(16, () => {
            try {
              this._log('World init: HUD + overlays', 'world');
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

              _setProgress(88, 'Spawning enemies...');
            } catch (err) { _initFail(err); return; }

            // ── Stage 4 (t≈128 ms): enemies + touch controls ─
            this.time.delayedCall(16, () => {
              try {
                // Spawn enemies after camera setup
                this._log('World init: spawning enemies', 'world');
                this.spawnEnemies(worldW, worldH, cx, cy);
                this.placeRaiderCamp(worldW, worldH);
                this._log(`World init: enemies spawned  total=${(this.enemies||[]).length}  dens=${(this.enemyDens||[]).length}+${(this.waterDens||[]).length}w`, 'world');

                // Touch controls (1P only — 2P touch is out of scope)
                if (this.solo && activeInputMode() === 'touch') {
                  this.initTouchControls();
                }

                _setProgress(100, 'Ready!');
              } catch (err) { _initFail(err); return; }

              // ── Stage 5 (t≈144 ms): finalize ─────────────
              this.time.delayedCall(16, () => {
                _destroyBar();
                this.cameras.main.fadeIn(600, 0, 0, 0);

                // Opening hints (delayed to appear after the startup controls popup fades)
                const modeNote = this.hardcore ? '\u2620 HARDCORE \u2014 death is permanent!' : '\u2665 SURVIVAL mode';
                this.time.delayedCall(10000, () => this.hint(modeNote + ' Explore the biomes! Watch your minimap.', 5000));
                this.time.delayedCall(16500, () => this.hint('TAB for controls  |  Beware toxic swamps and frozen tundra!', 3500));

                // Tutorial sequence — starts after startup controls dismiss (~9 s)
                this.time.delayedCall(9200, () => this.startTutorial());

                this._worldReady = true;
                this._log('World init: READY', 'world');
                this.showStartupControls();
              });
            });
          });
        });
      });
        }  // end _buildBiomeMapChunked onDone
      ); // end _buildBiomeMapChunked
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
    _biomeMap = null; // invalidate cached map; rebuilt below
    _biomeSeeds = [];
    const cx = CFG.MAP_W / 2, cy = CFG.MAP_H / 2;
    // Use world seed RNG so biome layout is reproducible
    const _rng = _worldRng;
    biomes.forEach(biome => {
      for (let i = 0; i < seedsPerBiome; i++) {
        const angle = _rng() * Math.PI * 2;
        const dist = CFG.MAP_W * (0.25 + _rng() * 0.23); // FloatBetween(0.25, 0.48)
        _biomeSeeds.push({
          biome,
          tx: cx + Math.cos(angle) * dist,
          ty: cy + Math.sin(angle) * dist,
        });
      }
    });
    // NOTE: the heavy 90 000-tile _buildBiomeMap() call used to live here, but
    // it was the cause of the loading-bar "5% hang" — it blocked the JS thread
    // for hundreds of ms in one frame. The caller now drives the chunked
    // variant (_buildBiomeMapChunked) so the bar can paint between chunks.
  }

  // Returns true if (tx,ty) is within the spawn safe zone or overlaps a structure.
  // Used by pond, lake, cache, and den placement to avoid collisions.
  _isBlockedForPlacement(tx, ty, excl, stx, sty) {
    if (Math.abs(tx - stx) < excl && Math.abs(ty - sty) < excl) return true;
    if (this._structureLocs) {
      const { TILE } = CFG;
      for (const s of this._structureLocs) {
        if (Math.abs(s.x / TILE - tx) < 10 && Math.abs(s.y / TILE - ty) < 10) return true;
      }
    }
    // Also reject if the tile is already water or ice — prevents caches, dens,
    // and late placements from landing inside a pond or lake.
    const { MAP_W } = CFG;
    const i = tx + ty * MAP_W;
    if (this._waterMap && this._waterMap[i]) return true;
    if (this._iceMap && this._iceMap[i]) return true;
    return false;
  }

  // Returns true if any tile in the (W×H) footprint centered on (cx, cy) lies
  // on water or ice. Used to filter biome-structure positions picked before
  // ponds/lakes were built.
  _footprintOnWaterOrIce(cx, cy, W, H) {
    if (!this._waterMap && !this._iceMap) return false;
    const { MAP_W, MAP_H } = CFG;
    const x0 = cx - Math.floor(W / 2), y0 = cy - Math.floor(H / 2);
    for (let dx = 0; dx < W; dx++) {
      for (let dy = 0; dy < H; dy++) {
        const tx = x0 + dx, ty = y0 + dy;
        if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
        const i = tx + ty * MAP_W;
        if (this._waterMap && this._waterMap[i]) return true;
        if (this._iceMap && this._iceMap[i]) return true;
      }
    }
    return false;
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

    // Ground wave shading — two sine waves at different angles produce broad organic shade bands.
    // Depth 0.55 sits above biome tiles (0.5) but below all water tiles (0.6+), so the effect
    // applies only to dry land and is naturally occluded by water.
    {
      const wgfx = this.add.graphics().setDepth(0.55);
      this._w(wgfx);
      const WSTEP = 3, WSZ = TILE * WSTEP;
      for (let tx = 0; tx < CFG.MAP_W; tx += WSTEP) {
        for (let ty = 0; ty < CFG.MAP_H; ty += WSTEP) {
          // Domain-warp the wave inputs with low-frequency noise so the bands
          // bend and drift organically rather than repeating as obvious stripes.
          const wx = (_biomeNoise(tx, ty, 40) - 0.5) * 28;
          const wy = (_biomeNoise(tx + 137, ty + 213, 40) - 0.5) * 28;
          const w = Math.sin((tx + wx) * 0.10 + (ty + wy) * 0.06) * 0.55
                  + Math.sin((tx + wx) * 0.04 - (ty + wy) * 0.09 + 2.3) * 0.45;
          const a = Math.abs(w) * 0.18;
          if (a < 0.008) continue;
          wgfx.fillStyle(w < 0 ? 0x000000 : 0xffffff, a);
          wgfx.fillRect(tx * TILE, ty * TILE, WSZ, WSZ);
        }
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

      // Biome structures (up to 2 per biome) — all biomes must be here for fjord + exclusion
      this._preStructureTiles = {};
      for (const biome of ['grass', 'tundra', 'swamp', 'waste', 'fungal', 'desert']) {
        this._preStructureTiles[biome] = [];
        for (let i = 0; i < 2; i++) {
          const pt = _prePickBiome(biome, SAFE_R + 12, this._preCacheTiles);
          if (pt) { this._preStructureTiles[biome].push(pt); this._preCacheTiles.push(pt); }
        }
      }
    }

    this.obstacles = this.physics.add.staticGroup();
    this.toxicPools = []; // for swamp damage
    this.waterTiles = [];       // shallow water — visual only (no physics body)
    this.deepWaterTiles = [];   // deep water — obstacles (impassable)
    this.iceTiles = [];         // frozen water — overlap (slippery)
    this.rivers = [];           // river metadata — rebuilt each run by _buildRivers
    this._cityCenter = null;    // set by buildRuinsCity, read by _buildRivers
    // Typed-array terrain maps — numeric index (tx + ty*MAP_W), no string allocations
    this._waterMap = new Uint8Array(CFG.MAP_W * CFG.MAP_H); // 1=shallow water
    this._iceMap   = new Uint8Array(CFG.MAP_W * CFG.MAP_H); // 1=ice tile
    this._wallTileSet = new Set(); // O(1) wall tile lookup for LOS raycasting (sparse)

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
    this._mmFloorTiles = []; // flat tx,ty pairs — filled by buildRuinsCity for minimap
    this._log('buildWorld: buildRuinsCity start', 'world');
    this.buildRuinsCity(stx, sty, TILE);
    this._log('buildWorld: buildRuinsCity done', 'world');

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
      const px = tx*TILE + Phaser.Math.Between(-8,8);
      const py = ty*TILE + Phaser.Math.Between(-8,8);
      // Visual only — collision detection via _toxicPoolsData + _toxicMap per-frame
      const pool = this.add.image(px, py, 'toxic_pool').setScale(sc).setDepth(2).setAlpha(0.9);
      if (this.hudCam) this.hudCam.ignore(pool);
      this._w(pool);
      this.toxicPools.push(pool);
      // Axis-aligned rect for per-frame player collision (half-width/height)
      const rx = Math.round(20 * sc), ry = Math.round(14 * sc);
      if (!this._toxicPoolsData) this._toxicPoolsData = [];
      if (!this._toxicTileIndex) this._toxicTileIndex = new Map();
      const poolData = { x: px, y: py, rx, ry };
      this._toxicPoolsData.push(poolData);
      // Register this pool in every tile its AABB overlaps (for O(1) coarse reject)
      const tx0 = Math.floor((px - rx) / TILE), tx1 = Math.floor((px + rx) / TILE);
      const ty0 = Math.floor((py - ry) / TILE), ty1 = Math.floor((py + ry) / TILE);
      const _MW = CFG.MAP_W;
      for (let txx = tx0; txx <= tx1; txx++) {
        for (let tyy = ty0; tyy <= ty1; tyy++) {
          const key = tyy * _MW + txx;
          let arr = this._toxicTileIndex.get(key);
          if (!arr) { arr = []; this._toxicTileIndex.set(key, arr); }
          arr.push(poolData);
        }
      }
    }

    // Water ponds — swamp/tundra/fungal/grass (shallow+deep or ice)
    this._log('buildWorld: _buildPonds start', 'world');
    this._buildPonds(stx, sty);
    this._log(`buildWorld: _buildPonds done  water=${(this.waterTiles||[]).length} ice=${(this.iceTiles||[]).length} deep=${(this.deepWaterTiles||[]).length}`, 'world');
    // ── POINTS OF INTEREST (initialised early so _buildLakes can push to it) ──
    this.pois = [];

    // Larger lakes (6–8 per map) with water-den spawners
    this._log('buildWorld: _buildLakes start', 'world');
    this._buildLakes(stx, sty);
    this._log(`buildWorld: _buildLakes done  water=${(this.waterTiles||[]).length} ice=${(this.iceTiles||[]).length} dens=${(this.waterDens||[]).length}`, 'world');

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
      // All-sides exclusion zone for structures — fjord only protects one direction
      if (this._preStructureTiles) {
        for (const structs of Object.values(this._preStructureTiles)) {
          for (const pos of structs) {
            if (Math.abs(tx - pos.tx) < 8 && Math.abs(ty - pos.ty) < 8) return;
          }
        }
      }
      const px = tx*TILE+24, py = ty*TILE+20;
      const ob = this.obstacles.create(px, py, key);
      ob.setScale(sc).setDepth(6 + ty*0.01).setImmovable(true);
      // Scale-compensated circle hitbox: world radius stays ~13px regardless of mountain scale.
      // StaticBody world radius = r * scale, so divide desired world radius by sc.
      {
        const R = 13;
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

    // Unified impassable tile set — mountains + deep water.
    // Built here (before rivers) so terrain cleanup and POI relocation can use it.
    // deepWaterTiles is already complete (_buildPonds is the only writer; _buildLakes and _buildRivers do not add to it).
    this._impassableTileSet = new Set(this._solidTileSet);
    for (const dt of this.deepWaterTiles) {
      const _itx = Math.floor(dt.x / TILE), _ity = Math.floor(dt.y / TILE);
      this._impassableTileSet.add(_itx + ',' + _ity);
    }

    // Rivers — organic shallow-water channels connecting lakes and map edges.
    // Runs after _solidTileSet is ready (mountain avoidance) and before terrain
    // overlap cleanup (so trees/rocks on river tiles are auto-culled below).
    this._log('buildWorld: _buildRivers start', 'world');
    this._buildRivers(stx, sty);

    // ── TERRAIN OVERLAP CLEANUP ───────────────────────────────────────────────
    // Sweep every tree, rock, and biome spire placed earlier in buildWorld and
    // destroy any that landed on water (shallow or deep) or inside a mountain zone.
    {
      const _overlapKeys = new Set(['rock', 'rock2', 'ice_rock', 'rock_desert', 'ice_spire', 'rock_spire', 'mangrove_roots']);
      let _overlapRemoved = 0;
      this.obstacles.getChildren().slice().forEach(ob => {
        const k = ob.texture && ob.texture.key;
        if (k === 'mountain' || k === 'mountain2') return; // never cull mountains
        if (!ob.isTree && !_overlapKeys.has(k)) return;   // keep walls, ruin blocks
        const tx = Math.floor(ob.x / TILE), ty = Math.floor(ob.y / TILE);
        if (this._waterMap[tx + ty * CFG.MAP_W] || this._impassableTileSet.has(tx + ',' + ty)) {
          ob.destroy();
          _overlapRemoved++;
        }
      });
      this._log(`terrain overlap cleanup  removed=${_overlapRemoved}`, 'world');
    }

    // Post-water POI relocation — pre-computed positions were picked before ponds/
    // lakes/rivers, so some may now sit on water. Find nearest dry tile for each.
    {
      const _isDry = (tx, ty) => {
        if (tx < 5 || tx >= CFG.MAP_W - 5 || ty < 5 || ty >= CFG.MAP_H - 5) return false;
        const i = tx + ty * CFG.MAP_W;
        if (this._waterMap && this._waterMap[i]) return false;
        if (this._iceMap && this._iceMap[i]) return false; // ice is walkable but avoidable for POI placement
        if (this._impassableTileSet && this._impassableTileSet.has(tx + ',' + ty)) return false;
        return true;
      };
      const _relocateWet = (pos) => {
        if (!pos || _isDry(pos.tx, pos.ty)) return pos;
        for (let r = 1; r <= 14; r++) {
          for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
              const tx = pos.tx + dx, ty = pos.ty + dy;
              if (_isDry(tx, ty)) {
                this._log(`POI relocated (${pos.tx},${pos.ty})→(${tx},${ty}) — was underwater`, 'world');
                return { ...pos, tx, ty };
              }
            }
          }
        }
        return pos;
      };
      let _wetCount = 0;
      const _rel = arr => arr ? arr.map(p => { const n = _relocateWet(p); if (n !== p) _wetCount++; return n; }) : arr;
      this._preCacheTiles_caches = _rel(this._preCacheTiles_caches);
      this._preDenTiles = _rel(this._preDenTiles);
      if (this._preTowerTile) {
        const n = _relocateWet(this._preTowerTile);
        if (n !== this._preTowerTile) _wetCount++;
        this._preTowerTile = n;
      }
      this._preCampsiteTiles = _rel(this._preCampsiteTiles);
      if (this._preStructureTiles) {
        for (const biome of Object.keys(this._preStructureTiles)) {
          this._preStructureTiles[biome] = _rel(this._preStructureTiles[biome]);
        }
      }
      // Rebuild unified list so the post-buildPOIs clearance pass uses updated positions
      this._preCacheTiles = [
        ...(this._preCacheTiles_caches || []),
        ...(this._preDenTiles || []),
        ...(this._preTowerTile ? [this._preTowerTile] : []),
        ...(this._preCampsiteTiles || []),
        ...Object.values(this._preStructureTiles || {}).flat(),
      ];
      if (_wetCount) this._log(`post-water POI relocation  relocated=${_wetCount}`, 'world');
    }

    // Pre-build minimap terrain color map — makes trees, water, rocks, and buildings
    // visible on the radar without any per-frame cost.
    this._buildMinimapColorMap(TILE);

    // Barracks — random grass-biome placement (outside spawn safe zone).
    // The old fixed offset (stx+20, sty-16) was hidden behind mountains ~90% of
    // the time. We search up to 200 random tiles for a grass tile with a 5-tile
    // grass cross (so the player can walk up to the door) and fall back to the
    // old offset if nothing qualifies.
    let bTX = stx + 20, bTY = sty - 16;
    for (let att = 0; att < 200; att++) {
      const tx = Phaser.Math.Between(12, CFG.MAP_W - 12);
      const ty = Phaser.Math.Between(12, CFG.MAP_H - 12);
      if (getBiome(tx, ty) !== 'grass') continue;
      if (Math.abs(tx - stx) < SAFE_R + 6 && Math.abs(ty - sty) < SAFE_R + 6) continue;
      const clear =
        getBiome(tx + 1, ty) === 'grass' && getBiome(tx - 1, ty) === 'grass' &&
        getBiome(tx, ty + 1) === 'grass' && getBiome(tx, ty - 1) === 'grass' &&
        !(this._wallTileSet && this._wallTileSet.has(tx + ',' + ty));
      if (!clear) continue;
      bTX = tx; bTY = ty;
      break;
    }
    this._log(`Barracks placed at tile (${bTX},${bTY})`, 'world');
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
    // (this.pois already initialised above before _buildLakes)
    this._log('buildWorld: buildPOIs start', 'world');
    this.buildPOIs(stx, sty, TILE);
    this._log(`buildWorld: buildPOIs done  pois=${(this.pois||[]).length}`, 'world');

    // ── BIOME STRUCTURES ─────────────────────────────────────
    this._log('buildWorld: buildBiomeStructures start', 'world');
    this.buildBiomeStructures(stx, sty, TILE);
    this._log(`buildWorld: buildBiomeStructures done  structures=${(this._structureLocs||[]).length}`, 'world');

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

    // Night overlay — fill the world once at full alpha, then modulate .alpha per frame
    // (avoids clearing + re-filling a ~9600x9600 px rect every tick in updateDayNight).
    this.nightOverlay = this._w(this.add.graphics().setDepth(49));
    {
      const _nw = CFG.MAP_W * CFG.TILE, _nh = CFG.MAP_H * CFG.TILE;
      this.nightOverlay.fillStyle(0x000033, 1);
      this.nightOverlay.fillRect(0, 0, _nw, _nh);
      this.nightOverlay.alpha = 0;
    }

    // ── FOG OF WAR ────────────────────────────────────────────
    this.fogRevealed = new Set(); // persistent — tiles ever seen (drives fog overlay)
    this.fogVisible = new Set();  // current-frame LOS — drives enemy visibility
    this.fogGfx = this._w(this.add.graphics().setDepth(48));
    this._fogFrame = 0;
    // Reveal initial spawn area
    this.revealFog(stx, sty, CFG.FOG_REVEAL_R + 4);
  }

  buildPOIs(stx, sty, TILE) {
    const MAP_W = CFG.MAP_W, MAP_H = CFG.MAP_H;

    // Reject tiles the player can't stand on — water (shallow or deep) and
    // mountain-cluster tiles. Without this, a POI can land somewhere the
    // player physically can't reach and the interaction never fires.
    const _isImpassable = (tx, ty) => {
      if (this._waterMap && this._waterMap[tx + ty * MAP_W]) return true;
      if (this._impassableTileSet && this._impassableTileSet.has(tx + ',' + ty)) return true;
      return false;
    };

    // Helper to find a position in a specific biome
    const findInBiome = (targetBiome, attempts) => {
      for (let i = 0; i < attempts; i++) {
        const tx = Phaser.Math.Between(10, MAP_W - 10);
        const ty = Phaser.Math.Between(10, MAP_H - 10);
        if (Math.abs(tx - stx) < CFG.SAFE_R + 8 && Math.abs(ty - sty) < CFG.SAFE_R + 8) continue;
        if (_isImpassable(tx, ty)) continue;
        if (getBiome(tx, ty) === targetBiome) return { tx, ty };
      }
      // Fallback — still avoid impassable tiles if possible
      for (let i = 0; i < 40; i++) {
        const tx = Phaser.Math.Between(20, MAP_W - 20);
        const ty = Phaser.Math.Between(20, MAP_H - 20);
        if (!_isImpassable(tx, ty)) return { tx, ty };
      }
      return { tx: Phaser.Math.Between(20, MAP_W - 20), ty: Phaser.Math.Between(20, MAP_H - 20) };
    };

    // BFS flood-fill from spawn — confirms a tile is physically walkable-to.
    // Catches the relic-in-mountain-cluster case where _isImpassable passes the
    // tile itself but the surrounding ring of physics bodies makes it unreachable.
    const _reachableFromSpawn = (rtx, rty) => {
      const visited = new Uint8Array(MAP_W * MAP_H);
      const startIdx = stx + sty * MAP_W;
      visited[startIdx] = 1;
      const q = [startIdx];
      let head = 0;
      const target = rtx + rty * MAP_W;
      while (head < q.length) {
        const idx = q[head++];
        if (idx === target) return true;
        const tx = idx % MAP_W, ty = (idx / MAP_W) | 0;
        for (let d = 0; d < 4; d++) {
          const ntx = tx + (d === 0 ? -1 : d === 1 ? 1 : 0);
          const nty = ty + (d === 2 ? -1 : d === 3 ? 1 : 0);
          if (ntx < 0 || ntx >= MAP_W || nty < 0 || nty >= MAP_H) continue;
          const ni = ntx + nty * MAP_W;
          if (visited[ni]) continue;
          if (_isImpassable(ntx, nty)) continue;
          visited[ni] = 1;
          q.push(ni);
        }
      }
      return false;
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
      // Pre-computed den tiles are picked BEFORE mountains are placed; validate now.
      // If the tile ended up inside a mountain or deep water, find a fresh clear spot.
      let actualPos = pos;
      if (this._impassableTileSet && this._impassableTileSet.has(pos.tx + ',' + pos.ty)) {
        const fb = findInBiome(getBiome(pos.tx, pos.ty), 60);
        if (fb) actualPos = fb;
        this._log(`den relocated from (${pos.tx},${pos.ty}) to (${actualPos.tx},${actualPos.ty}) — was inside mountain`, 'world');
      }
      const px = actualPos.tx * TILE, py = actualPos.ty * TILE;
      const spr = this._w(this.add.image(px, py, 'enemy_den').setScale(2).setDepth(5));
      const lbl = this._w(this.add.text(px, py - 24, 'ENEMY DEN', {
        fontFamily:'monospace', fontSize:'8px', color:'#cc4444', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(7));
      this.enemyDens.push({ x: px, y: py, tx: actualPos.tx, ty: actualPos.ty, respawnTimer: 0 });
      this.pois.push({ type:'den', tx: actualPos.tx, ty: actualPos.ty, spr });
    }

    // Radio Tower (1, in ruins biome) — use pre-computed position
    {
      const pos = this._preTowerTile || findInBiome('ruins', 80);
      const px = pos.tx * TILE, py = pos.ty * TILE;
      const spr = this._w(this.add.image(px, py, 'radio_tower').setScale(2).setDepth(6));
      const lbl = this._w(this.add.text(px, py - 52, 'RADIO TOWER', {
        fontFamily:'monospace', fontSize:'8px', color:'#66aaff', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(7));
      this.radioTower = { x: px, y: py, tx: pos.tx, ty: pos.ty, used: false,
        activating: false, activateProgress: 0, spr, lbl };
      const prompt = this._w(this.add.text(px, py - 64, 'Hold E / Enter to activate (10s)', {
        fontFamily:'monospace', fontSize:'9px', color:'#ffee44', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(7).setVisible(false));
      this.radioTower.prompt = prompt;
      // Progress bar rendered on HUD (world-space, but added to HUD group via _wh)
      const activateBar = this.add.graphics().setDepth(92);
      if (this.hudCam) this.hudCam.ignore(activateBar);
      activateBar.setVisible(false);
      const activateLabel = this.add.text(px, py - 80, '', {
        fontFamily:'monospace', fontSize:'9px', color:'#ffcc44', stroke:'#000', strokeThickness:2
      }).setOrigin(0.5).setDepth(93);
      if (this.hudCam) this.hudCam.ignore(activateLabel);
      activateLabel.setVisible(false);
      this.radioTower.activateBar = activateBar;
      this.radioTower.activateLabel = activateLabel;
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
              pl.hp = Math.min(pl.maxHp, pl.hp + Math.max(1, Math.round(5 * this.hc.foodHealMult)));
            }
          });
        });
      }
    });

    // ── ALTAR — random placement far from spawn ──────────────────
    {
      const ALTAR_MIN_DIST = 40; // tiles from spawn
      const ALTAR_BIOMES = ['waste', 'swamp', 'tundra', 'ruins', 'fungal'];
      let altarPos = null;
      for (let _ai = 0; _ai < 120 && !altarPos; _ai++) {
        const tx = Phaser.Math.Between(12, MAP_W - 12);
        const ty = Phaser.Math.Between(12, MAP_H - 12);
        const dx = tx - stx, dy = ty - sty;
        if (dx*dx + dy*dy < ALTAR_MIN_DIST*ALTAR_MIN_DIST) continue;
        if (_isImpassable(tx, ty)) continue;
        if (ALTAR_BIOMES.includes(getBiome(tx, ty))) altarPos = { tx, ty };
      }
      if (!altarPos) altarPos = findInBiome(ALTAR_BIOMES[Phaser.Math.Between(0, ALTAR_BIOMES.length - 1)], 80);
      const ax = altarPos.tx * TILE, ay = altarPos.ty * TILE;
      const altarSpr = this._w(this.add.image(ax, ay, 'altar_struct').setScale(2.5).setDepth(6));
      // No visible label — player must discover it
      this.altarPos = { x: ax, y: ay, tx: altarPos.tx, ty: altarPos.ty, spr: altarSpr };
      this.pois.push({ type: 'altar', tx: altarPos.tx, ty: altarPos.ty, spr: altarSpr });
      this._log(`Altar placed  tx=${altarPos.tx}  ty=${altarPos.ty}  biome=${getBiome(altarPos.tx, altarPos.ty)}`, 'world');
    }

    // ── RELICS — one per outer biome, with elite guards ──────────
    {
      const RELIC_BIOMES = ['waste', 'swamp', 'tundra', 'ruins', 'fungal'];
      const D = this._diffMult();
      const S = this._diffSpeedMult();
      const RELIC_ALTAR_MIN = 18; // tiles — keep relics away from the altar so E doesn't conflict
      this._relicPOIs = [];
      // Find a valid relic position: right biome, clear of altar, reachable from spawn
      const _findRelicPos = (biome) => {
        const _altarClear = (p) => {
          if (!this.altarPos) return p;
          for (let _t = 0; _t < 8; _t++) {
            const dtx = p.tx - this.altarPos.tx, dty = p.ty - this.altarPos.ty;
            if (dtx*dtx + dty*dty >= RELIC_ALTAR_MIN*RELIC_ALTAR_MIN) return p;
            p = findInBiome(biome, 80);
          }
          return p;
        };
        let p = _altarClear(findInBiome(biome, 80));
        for (let _r = 0; _r < 5 && !_reachableFromSpawn(p.tx, p.ty); _r++) {
          p = _altarClear(findInBiome(biome, 80));
        }
        return p;
      };

      for (const biome of RELIC_BIOMES) {
        let pos = _findRelicPos(biome);
        const px = pos.tx * TILE, py = pos.ty * TILE;
        const spr = this._w(this.add.image(px, py, 'item_relic').setScale(3).setDepth(7));
        this.tweens.add({ targets: spr, alpha: 0.45, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const lbl = this._w(this.add.text(px, py - 22, 'RELIC', {
          fontFamily: 'monospace', fontSize: '8px', color: '#cc44ff',
          stroke: '#000', strokeThickness: 2,
        }).setOrigin(0.5).setDepth(8).setVisible(false));
        this._relicPOIs.push({ x: px, y: py, tx: pos.tx, ty: pos.ty, spr, lbl, biome });
        this.pois.push({ type: 'relic', tx: pos.tx, ty: pos.ty, spr });

        // Elite guard bears — 1.4× HP, 1.3× damage, spawn dormant nearby
        for (let _gi = 0; _gi < 3; _gi++) {
          const ang = (_gi / 3) * Math.PI * 2;
          const gx = Phaser.Math.Clamp(px + Math.cos(ang) * 80, TILE * 4, (MAP_W - 4) * TILE);
          const gy = Phaser.Math.Clamp(py + Math.sin(ang) * 80, TILE * 4, (MAP_H - 4) * TILE);
          const sizeMult = Phaser.Math.FloatBetween(1.2, 1.6);
          const guardspr = this.physics.add.image(gx, gy, 'bear').setScale(2.2 * sizeMult).setDepth(8);
          guardspr.setCollideWorldBounds(true);
          guardspr.body.setSize(24, 18);
          if (this.hudCam) this.hudCam.ignore(guardspr);
          this.physics.add.collider(guardspr, this.obstacles);
          const eg = {
            spr: guardspr, type: 'bear',
            hp: Math.floor(140 * sizeMult * D * 1.4), maxHp: Math.floor(140 * sizeMult * D * 1.4),
            speed: 50 * S, dmg: Math.max(1, Math.floor(16 * sizeMult * D * 1.3)),
            atkInterval: Math.max(500, Math.round(2400 / D)), attackTimer: 0,
            wanderTimer: Phaser.Math.Between(0, 2000),
            aggroRange: 320, attackRange: (30 + 12) * sizeMult,
            sizeMult, relicGuard: true, _dormant: true,
          };
          guardspr.setVisible(false);
          if (guardspr.body) { guardspr.body.enable = false; this.physics.world.bodies.delete(guardspr.body); }
          if (this.enemies.length < CFG.MAX_ENEMIES) {
            this.enemies.push(eg);
          } else {
            guardspr.destroy();
          }
        }
        this._log(`Relic placed  biome=${biome}  tx=${pos.tx}  ty=${pos.ty}`, 'world');
      }
    }
  }

  // ── RUINS CITY ────────────────────────────────────────────────
  // Procedural navigable city grid placed at a random location each session
  buildRuinsCity(stx, sty, TILE) {
    const blockW = 9, blockH = 8;    // block size in tiles (walls inclusive)
    const streetW = 4, streetH = 4;  // street width in tiles
    const cols = 5, rows = 4;
    const totalW = cols * blockW + (cols - 1) * streetW;
    const totalH = rows * blockH + (rows - 1) * streetH;

    // Random angle and distance from spawn, kept within map and away from safe zone
    const minDist = CFG.SAFE_R + 35;
    const maxDist = CFG.MAP_W * 0.30;
    const angle = Math.random() * Math.PI * 2;
    const dist  = minDist + Math.random() * (maxDist - minDist);
    const cityTX = Math.round(stx + Math.cos(angle) * dist);
    const cityTY = Math.round(sty + Math.sin(angle) * dist);
    const cityLeft = cityTX - Math.floor(totalW / 2);
    const cityTop  = cityTY - Math.floor(totalH / 2);

    // Clamp so the entire city fits within map bounds
    const cl = Math.max(3, Math.min(cityLeft, CFG.MAP_W - totalW - 3));
    const ct = Math.max(3, Math.min(cityTop,  CFG.MAP_H - totalH - 3));

    // Store for river generation — rivers avoid a radius around the city
    this._cityCenter = { tx: Math.round(cl + totalW / 2), ty: Math.round(ct + totalH / 2) };

    // Helper — place one wall segment (obstacle with tight hitbox)
    const placeWall = (tx, ty) => {
      if (tx < 2 || tx > CFG.MAP_W-3 || ty < 2 || ty > CFG.MAP_H-3) return;
      if (Math.abs(tx-stx) < CFG.SAFE_R+3 && Math.abs(ty-sty) < CFG.SAFE_R+3) return;
      const w = this.obstacles.create(tx*TILE+16, ty*TILE+16, 'ruin_block');
      w.setDepth(5 + ty*0.01).setImmovable(true);
      w.body.setSize(28, 28); // slightly smaller than full tile for passability at seams
      w.refreshBody();
      w.hp = 200; w.maxHp = 200;
      this._wallTileSet.add(tx + ',' + ty);
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
            if (this._mmFloorTiles) this._mmFloorTiles.push(wx, wy);
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
      // Filter pre-computed positions whose footprint landed on water/ice — these
      // are picked before _buildPonds/_buildLakes, so tundra/swamp structures can
      // fall on top of a lake otherwise.
      const _prePos = ((this._preStructureTiles && this._preStructureTiles[biome]) || [])
        .filter(p => !this._footprintOnWaterOrIce(p.tx, p.ty, W, H));
      const _positions = _prePos.length ? _prePos : (() => {
        const fb = [];
        for (let att = 0; att < 120 && fb.length < 2; att++) {
          const tx = Phaser.Math.Between(12, MAP_W - 12), ty = Phaser.Math.Between(12, MAP_H - 12);
          if (getBiome(tx, ty) !== biome) continue;
          if (Math.abs(tx - stx) < SAFE_R + 12 && Math.abs(ty - sty) < SAFE_R + 12) continue;
          if (this._footprintOnWaterOrIce(tx, ty, W, H)) continue;
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
          w.body.setSize(32, 32); w.refreshBody();
          this._wallTileSet.add(tx + ',' + ty);
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

  // Returns true if a wall tile lies on the strictly-intermediate steps of the
  // Bresenham line from (x0,y0) to (x1,y1) — i.e. the target itself is NOT checked.
  _losBlocked(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let x = x0, y = y0;
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (x === x1 && y === y1) return false; // reached target without hitting a wall
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 <  dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) return false; // about to step onto target — still clear
      if (this._wallTileSet && this._wallTileSet.has(x + ',' + y)) return true;
    }
  }

  revealFog(centerTX, centerTY, radius) {
    const r = radius || (CFG.FOG_REVEAL_R * (this.fogRevealMult || 1) * this.hc.fogRevealMult);
    const cx = Math.floor(centerTX), cy = Math.floor(centerTY);
    // Clear and rebuild current-frame visible set for this reveal call
    // (updateFog calls this once per player per tick, so we reset before p1 and union p2).
    // Reuse the existing Set to avoid a fresh allocation every fog update.
    if (!this._fogVisibleBuilding) {
      if (this.fogVisible) this.fogVisible.clear();
      else this.fogVisible = new Set();
      this._fogVisibleBuilding = true;
    }
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (dx*dx + dy*dy > r*r) continue;
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= CFG.MAP_W || ty >= CFG.MAP_H) continue;
        // Always reveal adjacent tiles so walls at edge of radius are visible
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          this.fogRevealed.add(tx + ',' + ty);
          this.fogVisible.add(tx + ',' + ty);
          continue;
        }
        if (this._losBlocked(cx, cy, tx, ty)) continue;
        this.fogRevealed.add(tx + ',' + ty);
        this.fogVisible.add(tx + ',' + ty);
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

    // Reveal around players (radius-bounded, wall-blocked) — skip the reveal pass
    // entirely if neither player has moved tiles since the last update. This is
    // the biggest win on the fog hot path (otherwise O(r²) LOS rays every tick).
    const tileOf = (p) => (p && p.spr && p.spr.active && !p.isDowned)
      ? { tx: Math.floor(p.spr.x / TILE), ty: Math.floor(p.spr.y / TILE), active: true }
      : { tx: -1, ty: -1, active: false };
    const p1t = tileOf(this.p1);
    const p2t = tileOf(this.p2);
    const p1Same = p1t.active && this._lastFogP1
      && this._lastFogP1.tx === p1t.tx && this._lastFogP1.ty === p1t.ty
      && this._lastFogP1.active === p1t.active;
    const p2Same = (!this.p2) || (p2t.active && this._lastFogP2
      && this._lastFogP2.tx === p2t.tx && this._lastFogP2.ty === p2t.ty
      && this._lastFogP2.active === p2t.active);
    const skipReveal = p1Same && p2Same && this.fogVisible;
    if (!skipReveal) {
      this._fogVisibleBuilding = false;
      const revealP = (p, t) => {
        if (!t.active) return;
        this.revealFog(t.tx, t.ty);
      };
      revealP(this.p1, p1t);
      if (this.p2) revealP(this.p2, p2t);
      this._fogVisibleBuilding = false;
      this._lastFogP1 = p1t;
      this._lastFogP2 = p2t;
    }

    // Only draw fog tiles in camera viewport
    this.fogGfx.clear();
    const vx = cam.worldView.x, vy = cam.worldView.y;
    const vw = cam.worldView.width, vh = cam.worldView.height;
    const startTX = Math.max(0, Math.floor(vx / TILE) - 1);
    const startTY = Math.max(0, Math.floor(vy / TILE) - 1);
    const endTX = Math.min(CFG.MAP_W - 1, Math.ceil((vx + vw) / TILE) + 1);
    const endTY = Math.min(CFG.MAP_H - 1, Math.ceil((vy + vh) / TILE) + 1);

    // Three-zone fog: unexplored = dark, explored-but-not-in-LOS = dim, in-LOS = clear.
    // Two-pass draw (dark then dim) avoids toggling fillStyle per tile.
    const DARK_ALPHA = 0.85;
    const DIM_ALPHA = 0.35;
    this.fogGfx.fillStyle(0x000000, DARK_ALPHA);
    for (let tx = startTX; tx <= endTX; tx++) {
      for (let ty = startTY; ty <= endTY; ty++) {
        if (!this.fogRevealed.has(tx + ',' + ty)) {
          this.fogGfx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        }
      }
    }
    this.fogGfx.fillStyle(0x000000, DIM_ALPHA);
    for (let tx = startTX; tx <= endTX; tx++) {
      for (let ty = startTY; ty <= endTY; ty++) {
        const key = tx + ',' + ty;
        if (this.fogRevealed.has(key) && !this.fogVisible.has(key)) {
          this.fogGfx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        }
      }
    }
  }

  // ── PLAYER ──────────────────────────────────────────────────
  spawnPlayer(x, y, charData, pNum) {
    const spr = this._w(this.physics.add.sprite(x, y, 'player_atlas', charData.id).setScale(1.5).setDepth(10));
    spr.setCollideWorldBounds(true);
    spr.body.setSize(20, 24).setOffset(12, 30);

    const lbl = this._w(this.add.text(x, y-50, charData.player, {
      fontFamily:'monospace', fontSize:'11px',
      color: pNum===1 ? '#6699ff' : '#ff9944', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5).setDepth(11));

    const hpBar = this._w(this.add.graphics().setDepth(12));

    // Water submersion overlay — rendered above player to simulate wading
    const waterOverlay = this._w(this.add.image(x, y, 'water_sub_overlay')
      .setOrigin(0.5, 0).setDepth(11).setAlpha(0).setVisible(false));
    if (this.hudCam) this.hudCam.ignore(waterOverlay);

    const _hcMaxHp = Math.max(1, Math.round(charData.maxHp * this.hc.maxHpMult));
    return {
      spr, lbl, charData, pNum,
      hp: _hcMaxHp, maxHp: _hcMaxHp,
      ammo: charData.id==='gunslinger' ? 8 : Infinity,
      reserveAmmo: charData.id==='gunslinger' ? 32 : 0,
      flowerAmmo: charData.id==='charmer' ? 0 : undefined,
      knifeCooldown: 0,
      bowCooldown: 0,
      isDowned: false, isPermanentlyDead: false, downTimer: 0, downText: null,
      hpBar, dir: 'front', walkTimer: 0,
      atkCooldown: 0, atkAnimUntil: 0, reloading: false,
      rallyCooldown: 0, turretCooldown: 0,
      isSleeping: false, zzzText: null,
      inv: { wood:0, metal:0, fiber:0, food:0 },
      kills: 0,
      waterOverlay,
    };
  }

  // ── HUD ─────────────────────────────────────────────────────
  buildHUD() {
    const { W, H } = CFG;
    this._hudDirty = true;

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

    // Off-screen threat indicators — issue #81. Drawn in HUD space; redrawn each frame
    // by _drawThreatIndicators() so the arrows track the camera as it pans.
    this.threatGfx = this._h(this.add.graphics().setDepth(103));

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

    // Relic progress tracker — hidden until first relic activity
    this.hudRelicText = this._h(this.add.text(W/2, 58, '', {
      fontFamily: 'monospace', fontSize: '10px', color: '#cc44ff',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(101).setVisible(false));

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
    const mmW = 160, mmH = 160;
    const mmX = W - mmW - 10, mmY = 96; // top-right so it doesn't overlap P2 inventory
    const mmCX = mmX + mmW / 2, mmCY = mmY + mmH / 2, mmR = mmW / 2;
    // Circular background
    const mmBg = this._h(this.add.graphics().setDepth(110));
    mmBg.fillStyle(0x000000, 0.75); mmBg.fillCircle(mmCX, mmCY, mmR + 3);
    mmBg.lineStyle(1.5, 0x445566, 0.9); mmBg.strokeCircle(mmCX, mmCY, mmR + 3);
    this.minimapGfx = this._h(this.add.graphics().setDepth(111));
    this.minimapDots = this._h(this.add.graphics().setDepth(112));
    this.mmBounds = { x: mmX, y: mmY, w: mmW, h: mmH };
    // Store radar geometry for boss indicator positioning
    this.radarCenter = { x: mmCX, y: mmCY, r: mmR };
    this._h(this.add.text(mmCX, mmY - 11, 'RADAR', {
      fontFamily:'monospace', fontSize:'8px', color:'#667788',
    }).setOrigin(0.5).setDepth(111));

    // Circular clip mask — tiles drawn outside the circle are hidden
    const _mmMaskGfx = this._h(this.add.graphics());
    _mmMaskGfx.fillStyle(0xffffff, 1);
    _mmMaskGfx.fillCircle(mmCX, mmCY, mmR);
    this.minimapDots.setMask(_mmMaskGfx.createGeometryMask());

    // Pre-render biome colors on minimap (static, done once)
    this._renderMinimapBase();

    // ── DEBUG LOG (toggle with backtick `) ──────────────────────
    // NOTE: _dbgEntries is initialized early in create() and persists across restarts.
    this._dbgTxt = this._h(this.add.text(8, 28, '', {
      fontFamily: 'monospace', fontSize: '9px', color: '#00ff88',
      stroke: '#000000', strokeThickness: 1,
      backgroundColor: '#000000bb',
      padding: { x: 7, y: 5 },
    }).setScrollFactor(0).setDepth(500).setVisible(false));
  }

  _renderMinimapBase() {
    // Radar is now fully dynamic (player-centered, fog-aware) — no static pre-render needed.
    if (this.minimapGfx) this.minimapGfx.clear();
  }

  // Paint a single tile on the cached minimap color map. Used by player-placed
  // structures so they show up on the radar immediately instead of being hidden
  // by the original biome color.
  _paintMinimapTile(worldX, worldY, color) {
    if (!this._mmColorMap) return;
    const { TILE, MAP_W, MAP_H } = CFG;
    const tx = Math.floor(worldX / TILE), ty = Math.floor(worldY / TILE);
    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return;
    this._mmColorMap[tx + ty * MAP_W] = color;
  }

  // Reset a minimap tile to its biome color. Used when a player-built structure
  // is destroyed so the radar stops showing it.
  _unpaintMinimapTile(worldX, worldY) {
    if (!this._mmColorMap) return;
    const { TILE, MAP_W, MAP_H } = CFG;
    const tx = Math.floor(worldX / TILE), ty = Math.floor(worldY / TILE);
    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return;
    const i = tx + ty * MAP_W;
    // Prefer water/ice colors if the tile was water — walls can't be placed on
    // water, so in practice this falls through to the biome color.
    if (this._waterMap && this._waterMap[i]) { this._mmColorMap[i] = 0x2255aa; return; }
    if (this._iceMap && this._iceMap[i])     { this._mmColorMap[i] = 0x88aadd; return; }
    this._mmColorMap[i] = BIOME_COLORS[getBiome(tx, ty)] || 0x333333;
  }

  // Build a full-map color lookup (Uint32Array, one entry per tile).
  // Called once at end of world-gen; each updateMinimap() call reads it in O(1).
  // Layer order: biome → water → ice → deep water → trees → rocks → building floors → walls → mountains.
  _buildMinimapColorMap(TILE) {
    const { MAP_W, MAP_H } = CFG;
    this._mmColorMap = new Uint32Array(MAP_W * MAP_H);

    // Base layer — biome color for every tile, with same wave shading as the world ground.
    // Subsequent layers (water, trees, buildings) override these values so the shade only
    // appears on visible ground tiles, matching the in-world behaviour.
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        let col = BIOME_COLORS[getBiome(tx, ty)] || 0x333333;
        const wx = (_biomeNoise(tx, ty, 40) - 0.5) * 28;
        const wy = (_biomeNoise(tx + 137, ty + 213, 40) - 0.5) * 28;
        const w = Math.sin((tx + wx) * 0.10 + (ty + wy) * 0.06) * 0.55
                + Math.sin((tx + wx) * 0.04 - (ty + wy) * 0.09 + 2.3) * 0.45;
        const f = 1 + w * 0.14;
        const r = Math.min(255, Math.max(0, Math.round(((col >> 16) & 0xff) * f)));
        const g = Math.min(255, Math.max(0, Math.round(((col >>  8) & 0xff) * f)));
        const b = Math.min(255, Math.max(0, Math.round(( col        & 0xff) * f)));
        this._mmColorMap[tx + ty * MAP_W] = (r << 16) | (g << 8) | b;
      }
    }

    // Water (shallow)
    if (this._waterMap) {
      for (let i = 0; i < this._waterMap.length; i++) {
        if (this._waterMap[i]) this._mmColorMap[i] = 0x2255aa;
      }
    }
    // Ice
    if (this._iceMap) {
      for (let i = 0; i < this._iceMap.length; i++) {
        if (this._iceMap[i]) this._mmColorMap[i] = 0x88aadd;
      }
    }
    // Deep water (overrides shallow)
    if (this.deepWaterTiles) {
      for (const dt of this.deepWaterTiles) {
        const tx = Math.floor(dt.x / TILE), ty = Math.floor(dt.y / TILE);
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H)
          this._mmColorMap[tx + ty * MAP_W] = 0x112277;
      }
    }

    // Rivers — brighter flowing blue (0x1a88dd), distinct from still-water colors:
    // shallow pond = 0x2255aa, deep lake = 0x112277, ice = 0x88aadd
    if (this.rivers) {
      for (const river of this.rivers) {
        for (const key of river.tiles) {
          const sep = key.indexOf(',');
          const tx = parseInt(key, 10), ty = parseInt(key.slice(sep + 1), 10);
          if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H)
            this._mmColorMap[tx + ty * MAP_W] = 0x1a88dd;
        }
      }
    }

    // Obstacle features — trees, rocks, biome spires, mangroves
    const _ROCK_KEYS = new Set(['rock','rock2','ice_rock','rock_desert','ice_spire','rock_spire','mangrove_roots']);
    if (this.obstacles) {
      for (const ob of this.obstacles.getChildren()) {
        const k = ob.texture?.key;
        if (!k) continue;
        const tx = Math.floor(ob.x / TILE), ty = Math.floor(ob.y / TILE);
        if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) continue;
        if (ob.isTree)             this._mmColorMap[tx + ty * MAP_W] = 0x1a4a10; // dark green
        else if (_ROCK_KEYS.has(k)) this._mmColorMap[tx + ty * MAP_W] = 0x776655; // warm gray
      }
    }

    // Building interior floors — ruins city (tracked in _mmFloorTiles) + biome structures
    const _FLOOR_COL = 0x7a7a8a; // medium gray, readable on all biome backgrounds
    if (this._mmFloorTiles) {
      for (let i = 0; i < this._mmFloorTiles.length; i += 2) {
        const tx = this._mmFloorTiles[i], ty = this._mmFloorTiles[i + 1];
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H)
          this._mmColorMap[tx + ty * MAP_W] = _FLOOR_COL;
      }
    }
    // Biome structures: W=7 H=5, interior dx:1..5 dy:1..3, centered on _preStructureTiles pos
    if (this._preStructureTiles) {
      for (const positions of Object.values(this._preStructureTiles)) {
        for (const pos of positions) {
          const x0 = pos.tx - 3, y0 = pos.ty - 2; // floor(7/2)=3, floor(5/2)=2
          for (let dx = 1; dx <= 5; dx++) {
            for (let dy = 1; dy <= 3; dy++) {
              const tx = x0 + dx, ty = y0 + dy;
              if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H)
                this._mmColorMap[tx + ty * MAP_W] = _FLOOR_COL;
            }
          }
        }
      }
    }

    // Ruins + biome structure walls — bright white outline so structures are clearly legible
    if (this._wallTileSet) {
      for (const key of this._wallTileSet) {
        const sep = key.indexOf(',');
        const tx = parseInt(key, 10), ty = parseInt(key.slice(sep + 1), 10);
        if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H)
          this._mmColorMap[tx + ty * MAP_W] = 0xeeeeff; // near-white wall outline
      }
    }

    // Mountains — bright so ridgelines read clearly against all biomes
    if (this.mountainTiles) {
      for (const m of this.mountainTiles) {
        if (m.tx >= 0 && m.tx < MAP_W && m.ty >= 0 && m.ty < MAP_H)
          this._mmColorMap[m.tx + m.ty * MAP_W] = 0xddeeff; // very light blue-white
      }
    }
  }

  updateMinimap() {
    if (!this.minimapDots || !this.mmBounds) return;
    const _mmSet = loadSettings().minimapEnabled;
    const _mmOn  = (_mmSet === undefined) ? !this.hc.minimapDefaultOff : (_mmSet !== false);
    if (!_mmOn) {
      this.minimapGfx.setVisible(false);
      this.minimapDots.setVisible(false);
      return;
    }
    this.minimapGfx.setVisible(true);
    this.minimapDots.setVisible(true);
    // Update every 5 frames — dynamic view is cheaper per-frame than the old full-map render
    if (this._fogFrame % 5 !== 0) return;

    const mm = this.mmBounds;
    const TILE = CFG.TILE;
    this.minimapDots.clear();

    // Reference player for centering: P1 if active, else P2
    const refP = (this.p1?.spr?.active && !this.p1.isDowned) ? this.p1
               : (this.p2?.spr?.active && !this.p2.isDowned) ? this.p2 : null;
    if (!refP) return;

    // Radar shows a 40-tile radius (1280px world) around the reference player.
    // scale: minimap pixels per world tile.
    const VIEW = 40;
    const scale = mm.w / (VIEW * 2);
    const centerTX = Math.floor(refP.spr.x / TILE);
    const centerTY = Math.floor(refP.spr.y / TILE);
    const minTX = centerTX - VIEW, maxTX = centerTX + VIEW;
    const minTY = centerTY - VIEW, maxTY = centerTY + VIEW;
    const tileSize = Math.max(1, scale);

    // Single unified terrain pass — color map encodes biome, water, ice, trees,
    // rocks, ruins/structure walls, and mountains all at O(1) per tile.
    // Falls back to live getBiome lookup if color map wasn't built yet.
    for (let tx = minTX; tx <= maxTX; tx++) {
      for (let ty = minTY; ty <= maxTY; ty++) {
        if (tx < 0 || ty < 0 || tx >= CFG.MAP_W || ty >= CFG.MAP_H) continue;
        if (!this.fogRevealed.has(tx + ',' + ty)) continue;
        const color = this._mmColorMap
          ? this._mmColorMap[tx + ty * CFG.MAP_W]
          : (BIOME_COLORS[getBiome(tx, ty)] || 0x333333);
        this.minimapDots.fillStyle(color, 0.9);
        this.minimapDots.fillRect(
          mm.x + (tx - minTX) * scale,
          mm.y + (ty - minTY) * scale,
          tileSize + 0.5, tileSize + 0.5
        );
      }
    }

    // POI dots — revealed and within radar range
    if (this.pois) {
      this.pois.forEach(poi => {
        if (poi.tx < minTX || poi.tx > maxTX || poi.ty < minTY || poi.ty > maxTY) return;
        if (!this.fogRevealed.has(poi.tx + ',' + poi.ty)) return;
        let col = 0xffffff;
        if      (poi.type === 'cache')      col = 0xccaa00;
        else if (poi.type === 'den')        col = 0xcc4444;
        else if (poi.type === 'tower')      col = 0x66aaff;
        else if (poi.type === 'camp')       col = 0x44cc66;
        else if (poi.type === 'campfire')   col = 0xff8833;
        else if (poi.type === 'craftbench') col = 0xddcc44;
        else if (poi.type === 'bed')        col = 0xaa88ff;
        else if (poi.type === 'raidcamp')   col = 0xff2222;
        else if (poi.type === 'relic')      col = 0xcc44ff;
        else if (poi.type === 'altar')      col = 0xffdd44;
        const mx = mm.x + (poi.tx - minTX) * scale;
        const my = mm.y + (poi.ty - minTY) * scale;
        this.minimapDots.fillStyle(col, 1);
        this.minimapDots.fillRect(mx - 1, my - 1, 3, 3);
      });
    }

    // Player-built walls — dynamic overlay (not in the static color map)
    if (this.builtWalls && this.builtWalls.length) {
      this.minimapDots.fillStyle(0xaaccff, 0.85);
      for (const w of this.builtWalls) {
        if (!w.active) continue;
        const wtx = Math.floor(w.x / TILE), wty = Math.floor(w.y / TILE);
        if (wtx < minTX || wtx > maxTX || wty < minTY || wty > maxTY) continue;
        this.minimapDots.fillRect(
          mm.x + (wtx - minTX) * scale,
          mm.y + (wty - minTY) * scale,
          tileSize + 0.5, tileSize + 0.5
        );
      }
    }

    // Boss dot — always visible when alive; projected to the circle edge if outside radar range.
    if (this.boss && this.boss.spr?.active && this.boss.hp > 0) {
      const btx = Math.floor(this.boss.spr.x / TILE);
      const bty = Math.floor(this.boss.spr.y / TILE);
      const rawMX = mm.x + (btx - minTX) * scale;
      const rawMY = mm.y + (bty - minTY) * scale;
      // Project to circle perimeter if boss is outside the radar view
      const rcx = mm.x + mm.w / 2, rcy = mm.y + mm.h / 2;
      const dx = rawMX - rcx, dy = rawMY - rcy;
      const edgeDist = Math.sqrt(dx * dx + dy * dy);
      const innerR = mm.w / 2 - 5;
      let bmx = rawMX, bmy = rawMY;
      if (edgeDist > innerR) {
        bmx = rcx + (dx / edgeDist) * innerR;
        bmy = rcy + (dy / edgeDist) * innerR;
      }
      const pulse = Math.sin(this.time.now / 280) * 0.3 + 0.7;
      this.minimapDots.fillStyle(0xff2200, pulse);
      this.minimapDots.fillCircle(bmx, bmy, 3.5);
      this.minimapDots.lineStyle(1.5, 0xff5500, pulse * 0.6);
      this.minimapDots.strokeCircle(bmx, bmy, 5.5);
    }

    // Player dots
    const drawPlayer = (p, color) => {
      if (!p || !p.spr?.active) return;
      const pmx = mm.x + (Math.floor(p.spr.x / TILE) - minTX) * scale;
      const pmy = mm.y + (Math.floor(p.spr.y / TILE) - minTY) * scale;
      this.minimapDots.fillStyle(color, 1);
      this.minimapDots.fillCircle(pmx, pmy, 3);
      this.minimapDots.lineStyle(1, 0xffffff, 0.7);
      this.minimapDots.strokeCircle(pmx, pmy, 3);
    };
    drawPlayer(this.p1, 0x6699ff);
    if (this.p2) drawPlayer(this.p2, 0xff9944);

    // Subtle crosshair at center for orientation
    const cx = mm.x + mm.w / 2, cy = mm.y + mm.h / 2;
    this.minimapDots.lineStyle(1, 0x445566, 0.35);
    this.minimapDots.lineBetween(cx - 5, cy, cx + 5, cy);
    this.minimapDots.lineBetween(cx, cy - 5, cx, cy + 5);
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

  // Off-screen threat indicators (issue #81). Draws small triangles on the
  // viewport edge for active enemies that are near a player but outside the
  // visible camera. Capped to 8 to avoid clutter during swarms.
  _drawThreatIndicators() {
    const g = this.threatGfx;
    if (!g || !g.active) return;
    g.clear();
    if (this.isOver || !this.enemies || this.enemies.length === 0) return;

    const cam = this.cameras.main;
    if (!cam) return;
    const view = cam.worldView;
    const { W, H } = CFG;
    // Inset a few px so triangles sit just inside the viewport edge.
    const PAD = 12;
    const RANGE = 400, RANGE2 = RANGE * RANGE;

    const players = [this.p1, this.p2].filter(p => p && p.spr && p.spr.active);
    if (players.length === 0) return;

    // Collect candidate threats (off-screen + near a player), tag with distance
    // to the closer player so we can keep the most relevant ones.
    const threats = [];
    const enemies = this.enemies;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || !e.spr || !e.spr.active || e._dormant) continue;
      const ex = e.spr.x, ey = e.spr.y;
      if (view.contains(ex, ey)) continue;
      let bestD2 = Infinity;
      for (let j = 0; j < players.length; j++) {
        const dx = players[j].spr.x - ex, dy = players[j].spr.y - ey;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) bestD2 = d2;
      }
      if (bestD2 > RANGE2) continue;
      threats.push({ ex, ey, d2: bestD2 });
    }
    if (threats.length === 0) return;

    // Closest first; cap at 8 so a swarm doesn't paint the whole frame.
    threats.sort((a, b) => a.d2 - b.d2);
    const cap = Math.min(8, threats.length);

    // Project each threat from the camera centre onto the viewport rectangle.
    const cxw = view.x + view.width / 2;
    const cyw = view.y + view.height / 2;
    const halfW = W / 2 - PAD;
    const halfH = H / 2 - PAD;

    for (let k = 0; k < cap; k++) {
      const t = threats[k];
      const dxw = t.ex - cxw, dyw = t.ey - cyw;
      // Scale so the larger axis hits the viewport edge.
      const ax = Math.abs(dxw), ay = Math.abs(dyw);
      const s = (ax * halfH > ay * halfW) ? halfW / ax : halfH / ay;
      const sx = W / 2 + dxw * s;
      const sy = H / 2 + dyw * s;
      const angle = Math.atan2(dyw, dxw);
      const dist = Math.sqrt(t.d2);
      const a = Math.max(0.3, 1 - dist / RANGE);
      // Simple triangle pointing outward.
      const SIZE = 9;
      const c1x = sx + Math.cos(angle) * SIZE;
      const c1y = sy + Math.sin(angle) * SIZE;
      const c2x = sx + Math.cos(angle + 2.5) * SIZE;
      const c2y = sy + Math.sin(angle + 2.5) * SIZE;
      const c3x = sx + Math.cos(angle - 2.5) * SIZE;
      const c3y = sy + Math.sin(angle - 2.5) * SIZE;
      g.fillStyle(0xff4444, a);
      g.fillTriangle(c1x, c1y, c2x, c2y, c3x, c3y);
      g.lineStyle(1, 0x000000, a * 0.8);
      g.strokeTriangle(c1x, c1y, c2x, c2y, c3x, c3y);
    }
  }

  redrawHUD() {
    // Update ammo icons and reserve counter — only touch alphas/text when the
    // values actually changed (redrawHUD fires every frame from update()).
    const refreshAmmo = (icons, reserveText, player) => {
      if (!icons || !player || player.charData.id!=='gunslinger') return;
      if (player._lastAmmoShown !== player.ammo) {
        player._lastAmmoShown = player.ammo;
        icons.forEach((ic, i) => ic.setAlpha(i<player.ammo ? 1 : 0.18));
      }
      if (reserveText && player._lastReserveShown !== player.reserveAmmo) {
        player._lastReserveShown = player.reserveAmmo;
        reserveText.setText('+' + (player.reserveAmmo || 0) + ' reserve');
      }
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

    // Relic progress tracker
    if (this.hudRelicText) {
      const dep = this.relicsDeposited || 0;
      const held = this.relicsHeld || 0;
      const anyActivity = dep > 0 || held > 0;
      this.hudRelicText.setVisible(anyActivity);
      if (anyActivity) {
        const boxes = '◆'.repeat(dep) + '◇'.repeat(5 - dep);
        const carryStr = held > 0 ? '  ▶ carrying ' + held : '';
        this.hudRelicText.setText('ALTAR ' + boxes + carryStr);
        this.hudRelicText.setColor(held > 0 ? '#ff8833' : '#cc44ff');
      }
    }
  }

  // ── REVIVE BAR (world-space) ──────────────────────────────────
  buildReviveBar() {
    this.revBar = this._w(this.add.graphics().setDepth(20).setVisible(false));
  }

  _emitCharmSparkle(x, y) {
    // Pink mote rising from the target marks the charm transition.
    const t = this.add.text(x, y - 8, '♥', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffaacc',
      stroke: '#330022', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(22);
    if (this.hudCam) this.hudCam.ignore(t);
    this.tweens.add({
      targets: t, y: y - 30, alpha: 0, duration: 620, ease: 'Sine.Out',
      onComplete: () => t.destroy(),
    });
  }

  _emitLurkerBubble(x, y) {
    // Small expanding ripple to telegraph a water_lurker ambush.
    const g = this.add.graphics().setDepth(9);
    g.lineStyle(2, 0x66ccff, 0.9);
    g.strokeCircle(0, 0, 4);
    g.setPosition(x + Phaser.Math.Between(-8, 8), y + Phaser.Math.Between(-4, 4));
    if (this.hudCam) this.hudCam.ignore(g);
    this.tweens.add({
      targets: g, scaleX: 4, scaleY: 4, alpha: 0, duration: 600, ease: 'Sine.Out',
      onComplete: () => g.destroy(),
    });
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
    player.atkAnimUntil = 0;
    // If this player owned the craft menu, close it so input routing doesn't
    // reference a downed player and strand the menu on screen.
    if (this.craftMenuOpen && this.craftMenuOwner === player) this.closeCraftMenu();
    this._log(`${player.charData.player} (${player.charData.id}) DOWNED  day=${this.dayNum}`, 'player');
    // Audible + visual cue — partners need to register the down even if they
    // aren't looking at the HUD hint.
    try {
      if (typeof SFX !== 'undefined' && SFX._play) {
        SFX._play(200, 'sawtooth', 0.25, 0.35, 'drop');
        SFX._play(140, 'triangle', 0.20, 0.50, 'drop');
      }
      this.cameras.main.flash(260, 90, 10, 10, true);
      this.cameras.main.shake(200, 0.004);
    } catch(e) {}
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
    const p1dead = !this.p1 || !this.p1.spr || !this.p1.spr.visible || (!this.p1.isDowned && this.p1.hp <= 0);
    const p2dead = !this.p2 || !this.p2.spr || !this.p2.spr.visible || (!this.p2.isDowned && this.p2.hp <= 0);
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
      if (!downed || !rescuer || !downed.spr || !rescuer.spr || !downed.isDowned || !rescuer.spr.visible) continue;
      if (downed.hp <= 0 && !downed.isDowned) continue;

      const dist = Phaser.Math.Distance.Between(downed.spr.x, downed.spr.y, rescuer.spr.x, rescuer.spr.y);

      if (dist < CFG.REVIVE_RANGE) {
        // Show revive prompt — flag lives on the downed player so each player's
        // first down (or each re-entry to range) triggers its own prompt.
        const keyName = rescuer === this.p1 ? 'E' : 'Enter';
        if (!downed._revivePromptShown) {
          downed._revivePromptShown = true;
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
        }
      } else {
        // Rescuer walked out of range — re-show the prompt next time they return.
        downed._revivePromptShown = false;
      }
    }

    if (!anyReviving) {
      this.reviveProgress = 0;
      this.reviving = false;
      this.reviveTarget = null;
      if (this.revBar) this.revBar.setVisible(false);
    }
  }

  revivePlayer(player) {
    if (!player || !player.isDowned) return; // guard: timer may have expired same frame
    player.isDowned = false;
    player.hp = Math.floor(player.maxHp * 0.3);
    this._log(`${player.charData.player} revived  hp=${player.hp}/${player.maxHp}`, 'player');
    player.downTimer = 0;
    if (player._frostSlowed) player.spr.setTint(0x88ccff);
    else player.spr.clearTint();
    player.spr.setAlpha(1.0);
    if (player.downText) { player.downText.destroy(); player.downText = null; }
    this.reviveProgress = 0;
    this.reviving = false;
    if (this.revBar) this.revBar.setVisible(false);
    player._revivePromptShown = false;
    this._hudDirty = true;
    this.hint(player.charData.player + ' is back up! (' + player.hp + ' HP)', 3000);
  }

  triggerGameOver(reason) {
    if (this.isOver) return;
    this.isOver = true;
    this._log(`GAME OVER — ${reason}  day=${this.dayNum}  kills=${this.kills||0}  T=${Math.floor(this.timeAlive||0)}s`, 'world');
    // Auto-download log so players can share/report without remembering to copy
    this.time.delayedCall(800, () => this._downloadLog(true));
    // Close controls overlay if it was open when game ended
    if (this.controlsVis && this.ctrlObjs) {
      this.ctrlObjs.forEach(o => o.setVisible(false));
      this.controlsVis = false;
    }
    // Close any overlays that register input listeners — otherwise those
    // listeners leak into subsequent scenes and the next run.
    if (this.craftMenuOpen) this.closeCraftMenu();
    if (this.barrackOpen) this.closeBarrack();
    // Drop any queued hints so they don't surface on the next run.
    if (this._hintQueue) this._hintQueue.length = 0;

    if (this.p1 && this.p1.spr && this.p1.spr.body) this.p1.spr.setVelocity(0, 0);
    if (this.p2 && this.p2.spr && this.p2.spr.body) this.p2.spr.setVelocity(0, 0);

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
        p1Kills: this.p1 ? this.p1.kills : 0,
        p2Kills: this.p2 ? this.p2.kills : 0,
        dbgEntries: this._dbgEntries,
        seed: this._worldSeed,
        version: VERSION,
      });
    });
  }

  _triggerVictory() {
    if (this.isOver) return;
    this.isOver = true;
    this._log(`VICTORY: all 5 relics deposited  day=${this.dayNum}  kills=${this.kills||0}  T=${Math.floor(this.timeAlive||0)}s`, 'world');
    this.time.delayedCall(800, () => this._downloadLog(true));
    if (this.controlsVis && this.ctrlObjs) {
      this.ctrlObjs.forEach(o => o.setVisible(false));
      this.controlsVis = false;
    }
    if (this.p1 && this.p1.spr && this.p1.spr.body) this.p1.spr.setVelocity(0, 0);
    if (this.p2 && this.p2.spr && this.p2.spr.body) this.p2.spr.setVelocity(0, 0);
    Music.stop();
    this.cameras.main.fadeOut(800, 0, 0, 0);
    this.time.delayedCall(900, () => {
      this.scene.start('GameOver', {
        won: true,
        reason: 'All relics returned to the Ancient Altar',
        relicsDeposited: this.relicsDeposited,
        timeAlive: this.timeAlive,
        mode: STATE.mode,
        difficulty: STATE.difficulty,
        kills: this.kills,
        days: this.dayNum,
        resources: this.resourcesGathered,
        bossDefeated: this.bossDefeated,
        p1Name: this.p1 ? this.p1.charData.player : 'P1',
        p2Name: (this.p2 && !this.p2.isPermanentlyDead) ? this.p2.charData.player : null,
        p1Kills: this.p1 ? this.p1.kills : 0,
        p2Kills: this.p2 ? this.p2.kills : 0,
        dbgEntries: this._dbgEntries,
        seed: this._worldSeed,
        version: VERSION,
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
      this._log('controls: SETTINGS button pressed – launching Settings scene', 'player');
      this.ctrlObjs.forEach(o => o.setVisible(false));
      this.controlsVis = false;
      this.cameras.main.fadeOut(200, 0, 0, 0);
      this.time.delayedCall(200, () => {
        this.scene.pause();
        this.scene.launch('Settings', { returnTo: 'Game' });
        this.scene.bringToTop('Settings');
      });
    });

    const quitBtn = push(this.add.text(W/2 + 140, btnY, '\u2715  QUIT TO MENU', btnStyle('#cc6655'))
      .setOrigin(0.5).setDepth(97).setInteractive({ useHandCursor: true }));
    quitBtn.on('pointerover', () => quitBtn.setColor('#ff9988'));
    quitBtn.on('pointerout',  () => quitBtn.setColor('#cc6655'));
    quitBtn.on('pointerdown', () => {
      this._log('controls: QUIT TO MENU button pressed', 'player');
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
    this._log(`controls overlay ${this.controlsVis ? 'opened' : 'closed'}`, 'player');
    // Destroy old overlay and rebuild with current character data, then show/hide
    this.ctrlObjs.forEach(o => o.destroy());
    this.buildControlsOverlay();
    if (this.controlsVis) {
      this.ctrlObjs.forEach(o => o.setVisible(true));
    }
    // When hiding: objects stay invisible (default from buildControlsOverlay)
  }

  openPauseSettings() {
    this._log('game paused — settings opened', 'player');
    // Close any open overlays first so their pointer/wheel listeners don't
    // keep firing while paused / through the Settings overlay.
    if (this.craftMenuOpen) this.closeCraftMenu();
    if (this.barrackOpen) this.closeBarrack();
    // Gather character data so the Settings scene can show the controls reference.
    const p1Ch = this.p1 ? this.p1.charData : CHARS.find(c => c.id === STATE.p1CharId);
    const p2Ch = (!this.solo && this.p2) ? this.p2.charData : null;
    // Pause immediately so the world freezes mid-frame; Settings overlays on top.
    // We deliberately do NOT fade the world to black — Settings now uses a
    // semi-transparent background so the paused world peeks through.
    this.scene.pause();
    this.scene.launch('Settings', {
      returnTo: 'Game',
      p1CharId: p1Ch ? p1Ch.id : null,
      p2CharId: p2Ch ? p2Ch.id : null,
      solo: !!this.solo,
    });
    this.scene.bringToTop('Settings');
  }

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
  }

  tryInteract(player) {
    this._log(`${player.charData.player} interact  pos=(${Math.floor(player.spr.x/CFG.TILE)},${Math.floor(player.spr.y/CFG.TILE)})`, 'player');
    // In build mode, Interact tears down the nearest own wall/gate within ~40px
    // and refunds 50% of its cost. Lets the player undo misclicks without a
    // separate keybind.
    if (this.buildMode && this.buildOwner === player) {
      if (this._tryTeardownBuild(player)) return;
    }
    const dist = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, this.bPos.x, this.bPos.y);
    if (dist < 110) { this.openBarrack(player); return; }

    // Radio tower interaction — starts 10-second activation (handled in checkRadioTowerRange)
    if (this.radioTower && !this.radioTower.used) {
      const td = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, this.radioTower.x, this.radioTower.y);
      if (td < 80 && !this.radioTower.activating) {
        this.radioTower.activating = true;
        this.radioTower.activateProgress = 0;
        this._log(`${player.charData.player} began activating Radio Tower  day=${this.dayNum}`, 'world');
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

    // Relic pickup now requires a 3-second hold of the Interact key — handled
    // per-frame in updateRelicChannels so cancel conditions (out of range, key
    // released, downed, damaged) can be checked continuously. tryInteract only
    // logs that the player is in range of a relic if they're tapping.
    if (this._relicPOIs && this._relicPOIs.length > 0) {
      for (const _rel of this._relicPOIs) {
        if (!_rel.spr || !_rel.spr.active) continue;
        const _rd = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, _rel.x, _rel.y);
        if (_rd < 70) {
          this.hint('Hold Interact for 3s to retrieve relic', 1800);
          return;
        }
      }
    }

    // Altar deposit
    if (this.altarPos && this.relicsHeld > 0) {
      const _ad = Phaser.Math.Distance.Between(player.spr.x, player.spr.y, this.altarPos.x, this.altarPos.y);
      if (_ad < 90) {
        this._depositRelic();
        return;
      }
    }

    // Nothing interactable in range — log so we can diagnose "E key not working" reports
    this._log(`${player.charData.player} interact: nothing in range  pos=(${Math.floor(player.spr.x/CFG.TILE)},${Math.floor(player.spr.y/CFG.TILE)})`, 'player');
  }

  // Per-frame relic pickup channel. Mirrors checkRadioTowerRange — requires
  // Interact key held for 3s, cancels on out-of-range / release / downed /
  // damage taken mid-channel. Completes into _pickupRelic.
  updateRelicChannels(delta) {
    const RANGE = 70, RANGE2 = RANGE * RANGE;
    const HOLD_DUR = 3000;
    const BAR_W = 70, BAR_H = 6;
    const list = [
      { p: this.p1, keyName: 'p1use' },
      { p: this.p2, keyName: 'p2use' },
    ];
    for (const { p, keyName } of list) {
      if (!p || !p.spr || !p.spr.active) { this._cancelRelicChannel(p); continue; }
      const key = this.hotkeys && this.hotkeys[keyName];
      const keyDown = !!(key && key.isDown);
      const blocked = p.isDowned || p.isSleeping || this.barrackOpen || this.craftMenuOpen || this.isOver;
      if (blocked || !keyDown) { this._cancelRelicChannel(p); continue; }

      let nearest = null, bestD2 = RANGE2;
      const pool = this._relicPOIs || [];
      for (const r of pool) {
        if (!r.spr || !r.spr.active) continue;
        const dx = p.spr.x - r.x, dy = p.spr.y - r.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; nearest = r; }
      }
      if (!nearest) { this._cancelRelicChannel(p); continue; }

      let state = this._relicChannels.get(p);
      if (state && state.rel !== nearest) { this._cancelRelicChannel(p); state = null; }
      if (state && state.lastHp != null && p.hp < state.lastHp) {
        this._cancelRelicChannel(p);
        this.hint('Retrieval cancelled — hit!', 1500);
        continue;
      }
      if (!state) {
        state = {
          rel: nearest,
          progress: 0,
          lastHp: p.hp,
          bar: this._w(this.add.graphics().setDepth(25)),
          label: this._w(this.add.text(nearest.x, nearest.y - 36, 'Retrieving... 3.0s', {
            fontFamily: 'monospace', fontSize: '10px', color: '#cc88ff', stroke: '#000', strokeThickness: 2,
          }).setOrigin(0.5, 0.5).setDepth(25)),
        };
        if (this.hudCam) { this.hudCam.ignore(state.bar); this.hudCam.ignore(state.label); }
        this._relicChannels.set(p, state);
        this._log(`${p.charData.player} started retrieving relic  biome=${nearest.biome || '?'}`, 'player');
      }

      state.progress += (delta || 0);
      state.lastHp = p.hp;
      const pct = Math.min(state.progress / HOLD_DUR, 1);
      const remaining = Math.max(0, (HOLD_DUR - state.progress) / 1000).toFixed(1);
      const bx = nearest.x - BAR_W / 2, by = nearest.y - 28;
      state.bar.clear();
      state.bar.fillStyle(0x111122, 0.85);
      state.bar.fillRect(bx - 1, by - 1, BAR_W + 2, BAR_H + 2);
      state.bar.fillStyle(0xcc44ff, 1);
      state.bar.fillRect(bx, by, Math.floor(BAR_W * pct), BAR_H);
      state.bar.lineStyle(1, 0x7733aa);
      state.bar.strokeRect(bx - 1, by - 1, BAR_W + 2, BAR_H + 2);
      state.label.setPosition(nearest.x, nearest.y - 36);
      state.label.setText(`Retrieving... ${remaining}s`);

      if (state.progress >= HOLD_DUR) {
        const rel = state.rel;
        this._cancelRelicChannel(p);
        const idx = this._relicPOIs.indexOf(rel);
        if (idx !== -1 && rel.spr && rel.spr.active) {
          this._log(`${p.charData.player} finished retrieving relic  biome=${rel.biome || '?'}`, 'player');
          this._pickupRelic(rel, idx, p);
        }
      }
    }
  }

  _cancelRelicChannel(player) {
    if (!player) return;
    const s = this._relicChannels.get(player);
    if (!s) return;
    if (s.bar && s.bar.active) s.bar.destroy();
    if (s.label && s.label.active) s.label.destroy();
    this._relicChannels.delete(player);
  }

  _pickupRelic(rel, idx, player) {
    this.tweens.killTweensOf(rel.spr);
    this.tweens.add({
      targets: rel.spr, scaleX: 0, scaleY: 0, alpha: 0, duration: 220, ease: 'Back.In',
      onComplete: () => { if (rel.spr?.active) rel.spr.destroy(); if (rel.lbl?.active) rel.lbl.destroy(); },
    });
    this._relicPOIs.splice(idx, 1);
    this.pois = this.pois.filter(p => !(p.type === 'relic' && p.tx === rel.tx && p.ty === rel.ty));
    this.relicsHeld++;
    this._relicCarrierPlayer = player;

    this._floatPickup(rel.x, rel.y - 10, 'Relic acquired!');
    this.hint('⬛ Relic in hand…', 5000);
    this._log(`${player.charData.player} picked up relic  biome=${rel.biome}  held=${this.relicsHeld}  remaining=${this._relicPOIs.length}`, 'player');
    this._hudDirty = true;

    // 5th relic: all enemies converge — apocalypse
    // Wake up to MAX_ACTIVE_ENEMIES immediately; the aggro aura wakes the rest each frame
    if (this._relicPOIs.length === 0) {
      this._log('RELIC ALERT: final relic collected — all enemies converging!', 'world');
      const carrier = this._relicCarrier();
      let _woken = this._activeEnemyCount || 0;
      for (const _e of (this.enemies || [])) {
        if (!_e.spr?.active) continue;
        if (_e._dormant && _woken < CFG.MAX_ACTIVE_ENEMIES) {
          _e._dormant = false;
          if (_e.spr.body && !_e.spr.body.destroyed) {
            this.physics.world.bodies.set(_e.spr.body);
            _e.spr.body.enable = true;
            _e.spr.body.reset(_e.spr.x, _e.spr.y);
          }
          _e.spr.setVisible(true);
          _woken++;
        }
        if (carrier) _e.target = carrier;
      }
      this.cameras.main.shake(700, 0.015);
      this._showRelicHint('Every living thing\nknows where you are.\nRun.');
    }
  }

  _depositRelic() {
    this.relicsDeposited += this.relicsHeld;
    this.relicsHeld = 0;
    this._relicCarrierPlayer = null;
    // Clear the target override on every enemy — otherwise anything that was
    // tagged by the aura keeps chasing the former carrier forever because
    // updateEnemies honors e.target even when no relic is currently held.
    if (this.enemies) {
      for (const _e of this.enemies) if (_e) _e.target = null;
    }
    const dep = this.relicsDeposited;

    // Visual: tint altar progressively violet as relics are deposited
    const tints = [0xffffff, 0xddaaff, 0xbb66ff, 0x9944dd, 0x7722cc, 0x5500aa];
    if (this.altarPos?.spr?.active) this.altarPos.spr.setTint(tints[Math.min(dep, 5)]);

    this.cameras.main.shake(200 + dep * 40, 0.006 + dep * 0.002);
    this._floatPickup(this.altarPos.x, this.altarPos.y - 10, dep + '/5 Relics Deposited!');
    this._log(`Relic deposited  deposited=${dep}/5  diffMult=${this._diffMult().toFixed(2)}x`, 'world');
    this._hudDirty = true;

    if (dep >= 5) {
      this._triggerVictory();
    } else {
      const rem = 5 - dep;
      this.hint('⚠ ' + dep + '/5 deposited — enemy pressure rising! ' + rem + ' relic' + (rem !== 1 ? 's' : '') + ' remain.', 5000);
    }
  }

  _relicCarrier() {
    if (!this.relicsHeld) return null;
    const isAlive = p => p && p.spr?.active && !p.isDowned && p.hp > 0;
    // Prefer the actual picker. If they died/downed while carrying, the relic
    // effectively transfers to the surviving teammate so aggro still funnels.
    if (isAlive(this._relicCarrierPlayer)) return this._relicCarrierPlayer;
    const other = (this._relicCarrierPlayer === this.p1) ? this.p2 : this.p1;
    if (isAlive(other)) { this._relicCarrierPlayer = other; return other; }
    return [this.p1, this.p2].find(isAlive) || null;
  }

  _showRelicHint(msg) {
    const { W, H } = CFG;
    const t = this.add.text(W / 2, H * 0.38, msg, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ccccaa',
      stroke: '#000', strokeThickness: 3, align: 'center', wordWrap: { width: 340 },
    }).setOrigin(0.5).setDepth(300).setAlpha(0).setScrollFactor(0);
    if (this.hudCam) this.hudCam.ignore(t);
    this.tweens.add({
      targets: t, alpha: 0.9, duration: 1200, ease: 'Sine.In',
      onComplete: () => this.tweens.add({
        targets: t, alpha: 0, duration: 2800, delay: 3500, ease: 'Sine.Out',
        onComplete: () => t.destroy(),
      }),
    });
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
      this._log(`${player.charData.player} sleeping  hp=${player.hp}/${player.maxHp}  day=${this.dayNum}`, 'player');
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
    this._log(`${player.charData.player} woke up  hp=${player.hp}/${player.maxHp}`, 'player');
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
        if (!p.isDowned) {
          const _bedHeal = this.hc.bedHealPerTick;
          p.hp = Math.min(p.maxHp, p.hp + _bedHeal);
          this._log(`${p.charData.player} sleep heal +${_bedHeal}  hp=${p.hp}/${p.maxHp}`, 'player');
        }
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
  }

  barrackNav(dir) {
    this.barrackSel = Phaser.Math.Wrap(this.barrackSel+dir, 0, CHARS.length);
    this._log(`barracks nav ${dir > 0 ? 'right' : 'left'}  sel=${this.barrackSel} (${CHARS[this.barrackSel].id})  owner=${this.barrackOwner?.charData?.player}`, 'player');
    this.refreshBarrackCards();
  }

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
      const fromPool = Math.min(this.teamAmmoPool, maxReserve);
      player.reserveAmmo = Math.min(maxReserve, 32 + fromPool);
      this.teamAmmoPool = Math.max(0, this.teamAmmoPool - fromPool);
      if (fromPool > 0) this._log(`Barracks: drained ${fromPool} from team pool → reserveAmmo=${player.reserveAmmo}  pool=${this.teamAmmoPool}`, 'player');
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
  }

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
  }

  closeBarrack() {
    if (!this.barrackOpen) return;
    this._log(`barracks closed`, 'player');
    this.barrackOpen = false; this.barrackOwner = null;
    this.bObjs.forEach(o => o.setVisible(false));
    if (this._barrackPointerFn) {
      this.input.off('pointerdown', this._barrackPointerFn);
      this._barrackPointerFn = null;
    }
  }

  // ── HINT ─────────────────────────────────────────────────────
  // Show a contextual tip. Hints are now QUEUED rather than overwriting:
  // a new call while one is on screen waits in line, so rapid events
  // (e.g. revive + frost + web in close succession) all get to read.
  hint(text, duration) {
    this._log(`HINT: ${text}`, 'player');
    duration = Math.max(duration || 2500, 800);
    this._hintQueue = this._hintQueue || [];
    // Suppress immediate exact duplicates (the same hint fired twice in a
    // row is almost always a bug or a per-frame re-trigger; the queue
    // shouldn't compound it).
    const last = this._hintQueue[this._hintQueue.length - 1];
    if (last && last.text === text) return;
    if (this._activeHint && this._activeHint._hintText === text && this._hintQueue.length === 0) return;
    // Cap queue length so a chaotic moment doesn't trail tips long after.
    if (this._hintQueue.length >= 4) this._hintQueue.shift();
    this._hintQueue.push({ text, duration });
    this._processHintQueue();
  }

  _processHintQueue() {
    if (this._tutBusy) return; // wait until tutorial panel is gone
    if (this._activeHint && this._activeHint.active) return;
    if (!this._hintQueue || this._hintQueue.length === 0) return;
    const { text, duration } = this._hintQueue.shift();
    const { W } = CFG;
    const PW = 560, PH = 46, PX = (W - PW) / 2, PY = 108;

    const bg = this.add.graphics().setDepth(160).setAlpha(0);
    bg.fillStyle(0x050d05, 0.88);
    bg.fillRoundedRect(PX, PY, PW, PH, 8);
    bg.lineStyle(2, 0x4a7a38, 0.80);
    bg.strokeRoundedRect(PX, PY, PW, PH, 8);
    this.cameras.main.ignore(bg);

    const h = this.add.text(W / 2, PY + PH / 2, text, {
      fontFamily:'monospace', fontSize:'15px', color:'#ccdfc8',
      stroke:'#000', strokeThickness:2,
      wordWrap:{ width: PW - 32 },
    }).setOrigin(0.5).setDepth(161).setAlpha(0);
    this.cameras.main.ignore(h);
    h._hintText = text;
    this._activeHint = h;
    this._activeHintBg = bg;

    this.tweens.add({ targets:[bg, h], alpha:1, duration:280,
      onComplete:() => {
        this._hintTimer = this.time.delayedCall(duration, () => {
          this._hintTimer = null;
          this.tweens.add({ targets:[bg, h], alpha:0, duration:450,
            onComplete:() => {
              if (h === this._activeHint) { this._activeHint = null; this._activeHintBg = null; }
              bg.destroy();
              h.destroy();
              // Small gap so consecutive hints don't bleed into each other visually.
              this.time.delayedCall(150, () => this._processHintQueue());
            }
          });
        });
      }
    });
  }

  // ── STATUS ───────────────────────────────────────────────────
  // Immediate, non-queued status line for rapid-fire reactive feedback
  // (cooldown counters, per-hit status effects, per-attack warnings).
  // Always replaces whatever was showing — no queue, no lag.
  _showStatus(text, duration) {
    if (this._statusTimer) { this._statusTimer.remove(); this._statusTimer = null; }
    if (this._statusTxt?.active) {
      this.tweens.killTweensOf(this._statusTxt);
      this._statusTxt.setText(text).setAlpha(1);
    } else {
      this._statusTxt = this.add.text(CFG.W / 2, 162, text, {
        fontFamily:'monospace', fontSize:'15px', color:'#ffffff',
        stroke:'#000', strokeThickness:3, backgroundColor:'#000000bb', padding:{x:14,y:7},
      }).setOrigin(0.5).setDepth(158).setAlpha(1);
      this.cameras.main.ignore(this._statusTxt);
    }
    this._statusTimer = this.time.delayedCall(duration || 1500, () => {
      this._statusTimer = null;
      if (this._statusTxt?.active) {
        this.tweens.add({ targets:this._statusTxt, alpha:0, duration:300,
          onComplete:() => { if (this._statusTxt?.active) { this._statusTxt.destroy(); this._statusTxt = null; } }
        });
      }
    });
  }

  // ── TUTORIAL ─────────────────────────────────────────────────
  // Context-triggered tip banners. Only MOVE + ATTACK show at game start;
  // all other tips fire when the relevant event first occurs.
  // Each panel auto-advances after 7 s or on click. SKIP dismisses all.
  // Disabled if settings.tutorial === false.
  startTutorial() {
    if (loadSettings().tutorial === false) return;
    this._tutActive = true;
    this._tutObjs = [];
    this._tutTimer = null;
    // Seed from localStorage so returning players skip tips they've already seen
    const _savedTips = (() => { try { return JSON.parse(localStorage.getItem('iw_tutorial_state') || '{}'); } catch(e) { return {}; } })();
    this._tutShown = new Set(Object.keys(_savedTips).filter(k => _savedTips[k]));
    this._tutQueue = [];
    this._tutBusy  = false;
    // Show controls tips immediately; everything else is context-triggered
    this._tutTrigger('move');
    this._tutTrigger('attack');
    // Minimap tip fires after 20 s — player should have oriented by then
    this.time.delayedCall(CFG.MINIMAP_HINT_DELAY_MS, () => this._tutTrigger('minimap'));
  }

  _tutTrigger(key) {
    if (!this._tutActive || !this._tutShown) return;
    if (this._tutShown.has(key)) return;
    this._tutShown.add(key);
    try {
      const _ts = JSON.parse(localStorage.getItem('iw_tutorial_state') || '{}');
      _ts[key] = true;
      localStorage.setItem('iw_tutorial_state', JSON.stringify(_ts));
    } catch(e) {}
    const TIPS = {
      move:     { title: 'MOVE',          text: 'P1: WASD · P2: Arrow keys.  Explore each biome — grassland, wasteland, swamp, tundra, ruins.' },
      attack:   { title: 'ATTACK',        text: 'P1: F to attack · P2: / (slash).  In 1-player mode: aim with the mouse and left-click to shoot.' },
      gather:   { title: 'GATHER RESOURCES', text: 'Hold E (P1) or Enter (P2) near a tree to harvest wood.  Open crates for metal, fiber, ammo, and food.' },
      craft:    { title: 'CRAFT & BUILD', text: 'Press Q (P1) or 0 (P2) to open the Crafting Menu.  Build walls, campfires, spike traps, and more.' },
      nightfall:{ title: 'SURVIVE THE NIGHT', text: 'Enemies are stronger after dark.  Build a Bed (needs Craftbench) and sleep to fast-forward the night.' },
      caches:   { title: 'SUPPLY CACHES', text: 'Each biome hides a Supply Cache — rare loot but guarded by enemies.  Find them before the boss arrives!' },
      minimap:  { title: 'MINIMAP',       text: 'Top-right minimap shows biome edges, enemies (red dots), and points of interest.  Stay aware!' },
    };
    const step = TIPS[key];
    if (!step) return;
    this._tutQueue.push(step);
    if (!this._tutBusy) this._showNextTutTip();
  }

  _showNextTutTip() {
    if (!this._tutActive || !this._tutQueue.length) {
      this._tutBusy = false;
      this._processHintQueue(); // release any hints that were waiting
      return;
    }
    this._tutBusy = true;
    this._showTutPanel(this._tutQueue.shift());
  }

  _showTutPanel(step) {
    const { W } = CFG;
    const PW = 580, PH = 100, PX = (W - PW) / 2, PY = 8;

    this._clearTutObjs();

    const push = o => { this._tutObjs.push(o); this._h(o); return o; };

    // Panel background
    const bg = push(this.add.graphics().setDepth(170).setAlpha(0));
    bg.fillStyle(0x050d05, 0.88);
    bg.fillRoundedRect(PX, PY, PW, PH, 8);
    bg.lineStyle(2, 0x4a7a38, 0.80);
    bg.strokeRoundedRect(PX, PY, PW, PH, 8);

    // Title
    push(this.add.text(PX + 16, PY + 14, step.title, {
      fontFamily:'monospace', fontSize:'18px', color:'#aadd88',
      stroke:'#000', strokeThickness:3,
    }).setDepth(171).setAlpha(0));

    // Body text
    push(this.add.text(PX + 16, PY + 46, step.text, {
      fontFamily:'monospace', fontSize:'14px', color:'#ccdfc8',
      stroke:'#000', strokeThickness:2,
      wordWrap:{ width: PW - 32 },
    }).setDepth(171).setAlpha(0));

    // SKIP button
    const skipBtn = push(this.add.text(PX + PW - 12, PY + 12, '[ SKIP ]', {
      fontFamily:'monospace', fontSize:'11px', color:'#667755', stroke:'#000', strokeThickness:1,
    }).setOrigin(1, 0).setDepth(172).setAlpha(0).setInteractive({ useHandCursor: true }));
    skipBtn.on('pointerover', () => skipBtn.setStyle({ color:'#aaddaa' }));
    skipBtn.on('pointerout',  () => skipBtn.setStyle({ color:'#667755' }));
    skipBtn.on('pointerdown', (ptr) => { ptr.event.stopPropagation(); this._endTutorial(); });

    // Click panel to advance early
    const hitZone = push(this.add.zone(PX, PY, PW, PH).setOrigin(0).setDepth(173).setInteractive({ useHandCursor: true }));
    hitZone.on('pointerdown', () => {
      if (this._tutTimer) { this._tutTimer.remove(); this._tutTimer = null; }
      this._clearTutObjs();
      this._showNextTutTip();
    });

    // Fade in
    const fadeTargets = this._tutObjs.filter(o => o.setAlpha && o !== hitZone);
    this.tweens.add({ targets: fadeTargets, alpha: 1, duration: 300 });

    // Auto-advance after 7 s
    this._tutTimer = this.time.delayedCall(CFG.TUT_AUTO_ADVANCE_MS, () => { this._clearTutObjs(); this._showNextTutTip(); });
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
    this._tutQueue = [];
    this._tutBusy = false;
    this._clearTutObjs();
  }

  // ── UPDATE ────────────────────────────────────────────────────
  update(time, delta) {
    if (!this._worldReady) return; // deferred world init not yet complete
    if (this.isOver) return;

    // Clamp delta — a backgrounded tab, long GC pause, or debugger break can
    // produce multi-second deltas that teleport enemies across walls and
    // desync co-op. 50ms matches a 20 FPS floor; physics/AI stays stable.
    if (delta > 50) delta = 50;

    // Heartbeat — wall-clock, so it shows even if the game clock stalls.
    const _hbNow = Date.now();
    if (!this._lastHeartbeat || _hbNow - this._lastHeartbeat > 5000) {
      this._lastHeartbeat = _hbNow;
      this._log(`update heartbeat  gameT=${(this.timeAlive||0).toFixed(1)}s  day=${this.dayNum}  fps=${Math.round(this.game.loop.actualFps)}  bodies=${this.physics.world.bodies.size}`, 'perf');
      if (this._perfBudget && this._perfBudget.n > 0) {
        const _n = this._perfBudget.n;
        const _av = k => (this._perfBudget[k] / _n).toFixed(2);
        this._log(`frame budget (${_n}fr avg)  terrain=${_av('terrain')}ms  enemies=${_av('enemies')}ms  waves=${_av('waves')}ms  dens=${_av('dens')}ms  raiders=${_av('raiders')}ms  boss=${_av('boss')}ms  daynight=${_av('daynight')}ms  glows=${_av('glows')}ms  fog=${_av('fog')}ms  minimap=${_av('minimap')}ms  hud=${_av('hud')}ms  threats=${_av('threats')}ms`, 'perf');
        this._perfBudget = null;
      }
    }
    if (!this._perfBudget) this._perfBudget = { terrain: 0, enemies: 0, waves: 0, dens: 0, raiders: 0, boss: 0, daynight: 0, glows: 0, fog: 0, minimap: 0, hud: 0, threats: 0, n: 0 };

    // _onIce, _inShallowWater, and toxic pool detection are now all computed per-frame
    // inside applyTerrainEffects via Uint8Array map lookups — no reset needed here.

    if (this.controlsVis || this.barrackOpen) {
      this.p1.spr.setVelocity(0,0);
      if (this.p2) this.p2.spr.setVelocity(0,0);
      return;
    }

    this.timeAlive += delta / 1000;
    if (this._dbgVisible) this._dbgRefresh(); // throttled live stats refresh

    // ── Relic proximity hints (cheap squared-distance check, runs every frame) ──
    if (!this.isOver) {
      const _players = [this.p1, this.p2].filter(p => p && p.spr?.active && !p.isDowned);
      if (_players.length) {
        // First-ever relic proximity hint
        if (!this._relicHintShown && this._relicPOIs?.length) {
          for (const _rel of this._relicPOIs) {
            if (!_rel.spr?.active) continue;
            for (const _p of _players) {
              const _dx = _p.spr.x - _rel.x, _dy = _p.spr.y - _rel.y;
              if (_dx*_dx + _dy*_dy < 130*130) {
                this._relicHintShown = true;
                this._showRelicHint('...what\'s this?\nSome faint power radiates from it.\nBetter hold onto it for something.');
                if (_rel.lbl?.active) _rel.lbl.setVisible(true);
                break;
              }
            }
            if (this._relicHintShown) break;
          }
        }
        // Show relic label when near any relic
        if (this._relicPOIs) {
          for (const _rel of this._relicPOIs) {
            if (!_rel.spr?.active || !_rel.lbl?.active) continue;
            let _near = false;
            for (const _p of _players) {
              const _dx = _p.spr.x - _rel.x, _dy = _p.spr.y - _rel.y;
              if (_dx*_dx + _dy*_dy < 100*100) { _near = true; break; }
            }
            _rel.lbl.setVisible(_near);
          }
        }
        // First-ever altar proximity hint
        if (!this.altarDiscovered && this.altarPos) {
          for (const _p of _players) {
            const _dx = _p.spr.x - this.altarPos.x, _dy = _p.spr.y - this.altarPos.y;
            if (_dx*_dx + _dy*_dy < 150*150) {
              this.altarDiscovered = true;
              this._showRelicHint('There\'s something about this place.\nRemember it.');
              break;
            }
          }
        }
      }
    }

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

    if (this.p2 && this.p2.spr) {
      const p2CraftHalt = this.craftMenuOpen && this.craftMenuOwner === this.p2;
      if (!this.p2.isDowned && !this.p2.isSleeping && !p2CraftHalt && this.p2keys) this.movePlayer(this.p2, this.p2keys.left, this.p2keys.right, this.p2keys.up, this.p2keys.down);
      else if (this.p2.spr.body) this.p2.spr.setVelocity(0,0);
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
    { const _t = performance.now(); this.applyTerrainEffects(this.p1); if (this.p2) this.applyTerrainEffects(this.p2); this._perfBudget.terrain += performance.now() - _t; }

    // Cache active players once per frame — reused by updateEnemyDens, updateWaterDens, etc.
    this._activePlayers = [this.p1, this.p2].filter(p => p && p.spr && p.spr.active);

    // Water submersion visual overlay
    this._updateWaterSubmersion(this.p1);
    if (this.p2) this._updateWaterSubmersion(this.p2);

    this.syncLabels();
    this.updateCamera();
    this.checkBarrackRange();
    this.checkRadioTowerRange(delta);
    this.updateRelicChannels(delta);
    this.checkRaidCacheRange();
    this.checkDeaths();
    this.updateDowned(delta);
    this.updateRevive(delta);
    { const _t = performance.now(); this.updateEnemies(delta); this._perfBudget.enemies += performance.now() - _t; }
    { const _t = performance.now(); this.updateWaves(delta); this._perfBudget.waves += performance.now() - _t; }
    { const _t = performance.now(); this.updateEnemyDens(delta); this.updateWaterDens(delta); this._perfBudget.dens += performance.now() - _t; }
    { const _t = performance.now(); this.updateRaiders(delta); this._perfBudget.raiders += performance.now() - _t; }
    { const _t = performance.now(); this.updateBoss(delta); this._perfBudget.boss += performance.now() - _t; }
    this.updateSleep(delta);
    { const _t = performance.now(); this.updateDayNight(delta); this._perfBudget.daynight += performance.now() - _t; }
    { const _t = performance.now(); this._updateFireGlows(delta); this._perfBudget.glows += performance.now() - _t; }
    this._perfBudget.n++;
    // Post-updateDayNight stages — wrapped so a throw or stall is attributable.
    // _stageTrace is armed briefly around the Day-5 boss transition to give
    // per-stage checkpoints; otherwise only errors log.
    // Only trace stages on genuinely stalled frames (>100ms delta) to avoid log flood.
    const _stageLog = (name) => { if (this._stageTrace && delta > 100) this._log('stage: ' + name + ' (stall ' + delta.toFixed(0) + 'ms)', 'perf'); };
    const _safe = (name, fn) => { _stageLog(name); try { fn(); } catch (e) { this._log(`${name} ERR: ${e && e.message || e}`, 'error'); } };
    _safe('updateBuildMode',  () => this.updateBuildMode());
    _safe('updateCraftMenu',  () => this.updateCraftMenu(delta));
    _safe('updateHarvest',    () => this.updateHarvest(delta));
    _safe('updateSpikeTraps', () => this.updateSpikeTraps());
    { const _t0 = performance.now(); _safe('updateFog',        () => this.updateFog());               this._perfBudget.fog     += performance.now() - _t0; }
    { const _t0 = performance.now(); _safe('updateMinimap',    () => this.updateMinimap());            this._perfBudget.minimap += performance.now() - _t0; }
    _safe('updateTreeSeeds',  () => this.updateTreeSeeds(delta));
    { const _t0 = performance.now(); if (this._hudDirty) { _safe('redrawHUD', () => { this.redrawHUD(); this._hudDirty = false; }); } this._perfBudget.hud += performance.now() - _t0; }
    { const _t0 = performance.now(); _safe('threatIndicators', () => this._drawThreatIndicators());   this._perfBudget.threats += performance.now() - _t0; }
    _safe('_updateScoutPanel', () => this._updateScoutPanel());
    if (this._touchActive) _safe('_drawTouchHUD', () => this._drawTouchHUD());
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
      alt:      { hx: W - 185, hy: H - 195, r: 44, down: false, pid: -1, col: 0x6699ff, label: '\u2605 ALT' },
      interact: { hx: W - 195, hy: H - 95,  r: 40, down: false, pid: -1, col: 0x44cc66, label: 'E USE' },
      build:    { hx: W - 282, hy: H - 195, r: 40, down: false, pid: -1, col: 0xccaa33, label: '\u25a0 BLD' },
      menu:     { hx: W - 32,  hy: 32,      r: 28, down: false, pid: -1, col: 0x888888, label: '\u2630' },
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

    // Remove before re-adding to prevent listener accumulation on scene restart
    this.input.off('pointerdown',       this._onTouchDown, this);
    this.input.off('pointermove',       this._onTouchMove, this);
    this.input.off('pointerup',         this._onTouchUp,   this);
    this.input.off('pointerupoutside',  this._onTouchUp,   this);
    this.input.on('pointerdown',        this._onTouchDown, this);
    this.input.on('pointermove',        this._onTouchMove, this);
    this.input.on('pointerup',          this._onTouchUp,   this);
    this.input.on('pointerupoutside',   this._onTouchUp,   this);
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
      p.spr.setTexture('player_atlas', id + dirSuffix + step);
      if (p.dir === 'side' || p.dir === 'fside' || p.dir === 'bside') {
        p.spr.setFlipX(vx < 0);
      } else {
        p.spr.setFlipX(false);
      }
      p.aimAngle = Math.atan2(vy, vx);
    } else {
      p.walkTimer = 0;
      const dirSuffix = p.dir === 'side' ? '' : ('_' + p.dir);
      p.spr.setTexture('player_atlas', id + dirSuffix);
    }
  }

  _drawTouchHUD() {
    const gfx = this._tcGfx;
    if (!gfx || !gfx.active) return;
    // Build a fast state hash — if nothing visibly changed since last frame, skip
    // clear/fill entirely. Knob position is rounded so sub-pixel moves don't spam.
    const joy = this._joy;
    let hash = joy.active ? ('J' + (joy.knobX|0) + ',' + (joy.knobY|0)) : 'J-';
    for (const [name, btn] of Object.entries(this._tcBtns)) {
      hash += '|' + name + (btn.down ? '1' : '0');
    }
    if (this._tcHudHash === hash) return;
    this._tcHudHash = hash;
    gfx.clear();

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
    if (!player.spr || !player.spr.body) return;

    // Shallow water + ice + toxic pools — all computed per-frame via Uint8Array maps
    const TILE = CFG.TILE, MW = CFG.MAP_W;
    const ptx = Math.floor(player.spr.x / TILE);
    const pty = Math.floor(player.spr.y / TILE);
    {
      const wm = this._waterMap;
      player._inShallowWater = !!(wm &&
        (wm[ptx + pty * MW] || wm[(ptx+1) + pty * MW] ||
         wm[ptx + (pty+1) * MW] || wm[(ptx+1) + (pty+1) * MW]));
    }
    // Ice lookup (tundra lakes + frozen ponds)
    {
      const im = this._iceMap;
      player._onIce = !!(im &&
        (im[ptx + pty * MW] || im[(ptx+1) + pty * MW] ||
         im[ptx + (pty+1) * MW] || im[(ptx+1) + (pty+1) * MW]));
    }
    // Toxic pool lookup — tile-indexed list of AABBs (numeric key avoids string alloc).
    if (this._toxicTileIndex) {
      const arr = this._toxicTileIndex.get(pty * MW + ptx);
      if (arr) {
        const px = player.spr.x, py = player.spr.y;
        for (let i = 0; i < arr.length; i++) {
          const pool = arr[i];
          if (Math.abs(px - pool.x) <= pool.rx && Math.abs(py - pool.y) <= pool.ry) {
            const isP1 = (player === this.p1);
            const cdKey = isP1 ? '_toxicCd1' : '_toxicCd2';
            if (!this[cdKey] || this[cdKey] <= 0) {
              player.hp = Math.max(0, player.hp - 3);
              this[cdKey] = 500;
              this._log(`${player.charData.player} toxic pool dmg=3 hp=${player.hp}/${player.maxHp}`, 'combat');
              player.spr.setTint(0x44ff22);
              this.time.delayedCall(150, () => {
                if (!player.spr?.active) return;
                if (player._frostSlowed) player.spr.setTint(0x88ccff);
                else player.spr.clearTint();
              });
            }
            break;
          }
        }
      }
    }

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
    const biome = getBiome(ptx, pty);
    if (biome === 'tundra') {
      if (!player._inTundra) {
        player._inTundra = true;
        this._log(`${player.charData.player} entered tundra (speed x0.7)`, 'combat');
      }
      const vx = player.spr.body.velocity.x, vy = player.spr.body.velocity.y;
      if (vx !== 0 || vy !== 0) player.spr.setVelocity(vx * 0.7, vy * 0.7);
    } else if (player._inTundra) {
      player._inTundra = false;
      this._log(`${player.charData.player} left tundra`, 'combat');
    }
  }

  _updateWaterSubmersion(p) {
    if (!p || !p.waterOverlay || !p.waterOverlay.active) return;
    // Restore any previously elevated tiles
    if (p._waterSubmersionTiles) {
      p._waterSubmersionTiles.forEach(t => {
        if (t.active) t.setDepth(0.75).setAlpha(1);
      });
      p._waterSubmersionTiles = null;
    }
    p.waterOverlay.setVisible(false);
    if (p._inShallowWater && !p.isDowned && p.spr.visible) {
      const TILE = CFG.TILE;
      const px = p.spr.x, py = p.spr.y;
      // Lazy-build a spatial index once: Map<"tx,ty" -> tile sprite>. The
      // original implementation filtered ALL waterTiles every frame; with 100+
      // water tiles that was ~0.3-0.5ms/frame per player.
      if (!this._waterTileByCoord) {
        this._waterTileByCoord = new Map();
        const src = this.waterTiles || [];
        for (let i = 0; i < src.length; i++) {
          const t = src[i];
          const tx = Math.floor((t.x + TILE / 2) / TILE);
          const ty = Math.floor(t.y / TILE);
          this._waterTileByCoord.set(tx + ',' + ty, t);
        }
      }
      // Query the 3-wide window matching the original bounding box.
      const cx = Math.floor(px / TILE);
      const yTop = Math.floor((py - TILE * 1.5) / TILE);
      const yBot = Math.floor((py + TILE * 0.5) / TILE);
      const elevated = [];
      for (let tx = cx - 1; tx <= cx + 1; tx++) {
        for (let ty = yTop; ty <= yBot; ty++) {
          const t = this._waterTileByCoord.get(tx + ',' + ty);
          if (t && t.active &&
              Math.abs(t.x + TILE / 2 - px) < TILE * 1.5 &&
              t.y <= py + TILE * 0.5 &&
              t.y >= py - TILE * 1.5) {
            t.setDepth(10).setAlpha(0.72);
            elevated.push(t);
          }
        }
      }
      p._waterSubmersionTiles = elevated;
    }
  }

  checkRadioTowerRange(delta) {
    const tower = this.radioTower;
    if (!tower || tower.used) {
      if (tower && tower.prompt) tower.prompt.setVisible(false);
      if (tower && tower.activateBar)   { tower.activateBar.setVisible(false); }
      if (tower && tower.activateLabel) { tower.activateLabel.setVisible(false); }
      return;
    }
    const ACTIVATE_DURATION = 10000; // ms
    const BAR_W = 80, BAR_H = 8;
    const near = p => p && p.spr && p.spr.active &&
      Phaser.Math.Distance.Between(p.spr.x, p.spr.y, tower.x, tower.y) < 80;
    const anyNear = near(this.p1) || near(this.p2);

    if (tower.activating) {
      if (!anyNear) {
        // Player walked away — cancel activation
        tower.activating = false;
        tower.activateProgress = 0;
        if (tower.activateBar)   { tower.activateBar.clear(); tower.activateBar.setVisible(false); }
        if (tower.activateLabel) { tower.activateLabel.setVisible(false); }
        tower.prompt.setVisible(false);
        this.hint('Radio Tower activation cancelled.', 2000);
        return;
      }
      tower.activateProgress += (delta || 0);
      const pct = Math.min(tower.activateProgress / ACTIVATE_DURATION, 1);
      const remaining = Math.max(0, (ACTIVATE_DURATION - tower.activateProgress) / 1000).toFixed(1);

      // Draw progress bar in world space (follows tower position)
      if (tower.activateBar) {
        const bx = tower.x - BAR_W / 2, by = tower.y - 90;
        tower.activateBar.clear();
        tower.activateBar.fillStyle(0x111122, 0.85);
        tower.activateBar.fillRect(bx - 1, by - 1, BAR_W + 2, BAR_H + 2);
        tower.activateBar.fillStyle(0x44aaff, 1);
        tower.activateBar.fillRect(bx, by, Math.floor(BAR_W * pct), BAR_H);
        tower.activateBar.lineStyle(1, 0x4466aa);
        tower.activateBar.strokeRect(bx - 1, by - 1, BAR_W + 2, BAR_H + 2);
        tower.activateBar.setVisible(true);
      }
      if (tower.activateLabel) {
        tower.activateLabel.setText(`Activating... ${remaining}s`);
        tower.activateLabel.setVisible(true);
      }

      if (tower.activateProgress >= ACTIVATE_DURATION) {
        // Activation complete — apply fog buff
        tower.used = true;
        tower.activating = false;
        if (tower.activateBar)   { tower.activateBar.clear(); tower.activateBar.setVisible(false); }
        if (tower.activateLabel) { tower.activateLabel.setVisible(false); }
        if (tower.prompt) tower.prompt.setVisible(false);
        const _rtBodies = this.physics.world.bodies.size;
        const _rtEnemies = (this.enemies || []).length;
        const _rtActive  = this._activeEnemyCount ?? (this.enemies || []).filter(e => e.spr?.active && !e._dormant).length;
        this._log(`Radio Tower activated  day=${this.dayNum}  bodies=${_rtBodies}  enemies=${_rtEnemies}  active=${_rtActive}`, 'world');
        tower.spr.setTint(0x66aaff);
        this.fogRevealMult = 2;
        this.hint('Radio Tower online! Vision range doubled permanently!', 5000);
        SFX._play(800, 'triangle', 0.2, 0.3, 'rise');
        SFX._play(1200, 'triangle', 0.15, 0.2, 'rise');
        this.revealFog(tower.tx, tower.ty, 35);
      }
      return;
    }

    // Not activating — show/hide approach prompt
    tower.prompt.setVisible(anyNear);
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
    } while (attempts < 30 && Phaser.Math.Distance.Between(cx, cy, worldW/2, worldH/2) < TILE * 60);
    this._log(`Raider camp placed  cx=${Math.floor(cx/TILE)},cy=${Math.floor(cy/TILE)}  distTiles=${Math.round(Phaser.Math.Distance.Between(cx,cy,worldW/2,worldH/2)/TILE)}`, 'world');

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
    this._log(`Raider attack!  count=${count}  day=${this.dayNum}`, 'world');
    const types = ['brawler', 'shooter', 'brawler', 'shooter', 'heavy', 'brawler', 'shooter', 'heavy', 'brawler', 'shooter'];
    for (let i = 0; i < count; i++) {
      const rtype = types[i % types.length];
      const angle = Math.random() * Math.PI * 2;
      const dist = Phaser.Math.Between(40, 90);
      const rx = cx + Math.cos(angle) * dist;
      const ry = cy + Math.sin(angle) * dist;
      const texKey = 'raider_' + rtype;
      const spr = this.physics.add.image(rx, ry, 'raider_atlas', texKey).setScale(2.5).setDepth(9);
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
        home: { x: cx, y: cy }, // leash anchor — raiders return here when not aggroed and drifting too far
      };
      this.raiders.push(raider);
      this.enemies.push(raider); // raiders participate in the normal enemy array so updateEnemies handles them
    }
  }

  // Periodic hunting party — spawns at a random map edge and actively seeks the
  // player across the whole map. Additive to the raid camp respawn system.
  spawnHuntingParty() {
    if (this.isOver) return;
    // Don't pile on during an active boss fight.
    if (this.bossSpawned && this.boss && this.boss.spr && this.boss.spr.active) return;
    const { TILE } = CFG;
    const worldW = CFG.MAP_W * TILE, worldH = CFG.MAP_H * TILE;
    const count = Phaser.Math.Between(3, 5);
    // Prefer a player as the approach reference so the party can be seen coming.
    const anchor = this.p1 && this.p1.spr ? this.p1.spr : (this.p2 && this.p2.spr ? this.p2.spr : null);
    const axx = anchor ? anchor.x : worldW / 2;
    const axy = anchor ? anchor.y : worldH / 2;
    // Pick a map edge far-ish from the player.
    const side = Phaser.Math.Between(0, 3);
    let baseX, baseY;
    if (side === 0)      { baseX = Phaser.Math.Between(TILE*4, worldW-TILE*4); baseY = TILE*6; }
    else if (side === 1) { baseX = Phaser.Math.Between(TILE*4, worldW-TILE*4); baseY = worldH-TILE*6; }
    else if (side === 2) { baseX = TILE*6; baseY = Phaser.Math.Between(TILE*4, worldH-TILE*4); }
    else                 { baseX = worldW-TILE*6; baseY = Phaser.Math.Between(TILE*4, worldH-TILE*4); }
    // Nudge toward the player so the party heads the right direction immediately.
    const toPlayer = Phaser.Math.Angle.Between(baseX, baseY, axx, axy);
    const diffScale = this._diffMult();
    const types = ['brawler', 'shooter', 'brawler', 'shooter', 'brawler'];
    const stats = {
      brawler: { hp: 130, speed: 110, dmg: 20, range: 36, atkInterval: 1100, shootRange: 0 },
      shooter: { hp: 80,  speed: 90,  dmg: 16, range: 40, atkInterval: 1200, shootRange: 280 },
    };
    const huntExpires = this.time.now + 300000; // 5 minutes
    for (let i = 0; i < count; i++) {
      const rtype = types[i % types.length];
      const s = stats[rtype];
      const offAng = toPlayer + Phaser.Math.FloatBetween(-0.35, 0.35);
      const rx = Phaser.Math.Clamp(baseX + Math.cos(offAng) * Phaser.Math.Between(20, 70),
        TILE*3, worldW - TILE*3);
      const ry = Phaser.Math.Clamp(baseY + Math.sin(offAng) * Phaser.Math.Between(20, 70),
        TILE*3, worldH - TILE*3);
      const texKey = 'raider_' + rtype;
      const spr = this.physics.add.image(rx, ry, 'raider_atlas', texKey).setScale(2.5).setDepth(9);
      spr.setCollideWorldBounds(true);
      spr.body.setSize(16, 20);
      if (this.hudCam) this.hudCam.ignore(spr);
      this.physics.add.collider(spr, this.obstacles);
      const raider = {
        spr, type: rtype, isRaider: true, isHuntParty: true, huntExpires,
        hp: Math.floor(s.hp * diffScale), maxHp: Math.floor(s.hp * diffScale),
        speed: s.speed * Math.min(1.6, diffScale) * 1.15,
        dmg: Math.floor(s.dmg * diffScale),
        attackRange: s.range, attackTimer: 0, atkInterval: s.atkInterval,
        shootRange: s.shootRange, rangedTimer: 0,
        aggroRange: 99999, wanderTimer: 0, sizeMult: 1,
      };
      this.raiders.push(raider);
      this.enemies.push(raider);
    }
    // Compass direction from player to the spawn edge
    const _huntDeg = (Math.atan2(baseY - axy, baseX - axx) * 180 / Math.PI + 360) % 360;
    const _huntDir = ['E','SE','S','SW','W','NW','N','NE'][Math.round(_huntDeg / 45) % 8];
    this._log(`Hunting party incoming!  count=${count}  day=${this.dayNum}  from=${_huntDir}  spawn_tile=(${Math.floor(baseX/CFG.TILE)},${Math.floor(baseY/CFG.TILE)})`, 'world');
    this.hint('\u26a0 Raiders spotted at the wastes edge!', 4000);
    this._huntPartyAlertFired = false;
    this._huntDirReminderAt = this.time.now + 45000; // first reminder 45s after spawn
    SFX._play(120, 'sawtooth', 0.3, 0.5, 'drop');
  }

  updateRaiders(delta) {
    // Shooters fire projectiles; brawlers get a charge lunge
    if (!this.raiders || this.isOver) return;
    const players = [this.p1, this.p2].filter(p => p && p.spr && !p.isDowned && p.hp > 0 && p.spr.visible);

    this.raiders.forEach(raider => {
      if (raider.hp <= 0 || !raider.spr.active) return;
      // Hunt-party expiration — after 3 minutes the hunter demotes to a normal raider.
      if (raider.isHuntParty && this.time.now > (raider.huntExpires || 0)) {
        raider.isHuntParty = false;
        raider.aggroRange = 320;
        raider.speed = raider.speed / 1.15; // undo the hunt speed boost
        const _huntAlive = this.raiders.filter(r => r.isHuntParty && r.hp > 0 && r.spr?.active).length;
        this._log(`Hunt party expired  type=${raider.type}  remaining_hunters=${_huntAlive}  pos=(${Math.floor(raider.spr.x/CFG.TILE)},${Math.floor(raider.spr.y/CFG.TILE)})`, 'world');
      }

      let nearest = null, nearDist = Infinity;
      players.forEach(p => {
        const d = Phaser.Math.Distance.Between(raider.spr.x, raider.spr.y, p.spr.x, p.spr.y);
        if (d < nearDist) { nearDist = d; nearest = p; }
      });
      if (!nearest) return;

      // Fire a "closing in" alert when the first hunt-party raider reaches ~1200px.
      if (raider.isHuntParty && !this._huntPartyAlertFired && nearDist < 1200) {
        this._huntPartyAlertFired = true;
        this.hint('⚠ Raiders closing in — get ready!', 4000);
        this._log('Hunt party closing in  dist=' + nearDist.toFixed(0), 'world');
        SFX._play(200, 'sawtooth', 0.2, 0.6, 'drop');
      }

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

    // Periodic reminder while hunt party is still alive
    if (this._huntDirReminderAt && this.time.now > this._huntDirReminderAt) {
      const _huntActive = this.raiders.filter(r => r.isHuntParty && r.hp > 0 && r.spr?.active);
      if (_huntActive.length > 0) {
        this._huntDirReminderAt = this.time.now + 45000;
        this.hint('⚠ Raiders still hunting you...', 4000);
        this._log(`Hunt party reminder  alive=${_huntActive.length}`, 'world');
      } else {
        this._huntDirReminderAt = null;
      }
    }
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
        if (!bullet.active || !p.spr?.active) return;
        const baseDmg = raider.dmg * 0.7;
        const dmg = this._knightShieldBlock(p, bullet.x, bullet.y, baseDmg);
        bullet.destroy();
        const _rdmg = Math.round(dmg);
        p.hp = Math.max(0, p.hp - _rdmg);
        this._log(`${p.charData.player} shot by raider  dmg=${_rdmg}  hp=${p.hp}/${p.maxHp}`, 'combat');
        SFX.playerHurt();
        this._floatDamage(p.spr.x, p.spr.y - 18, _rdmg);
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
    this._stageTrace = false; // we made it — stop per-stage trace
    this._log('spawnBoss: enter', 'world');

    const worldW = CFG.MAP_W * CFG.TILE, worldH = CFG.MAP_H * CFG.TILE;
    const { TILE } = CFG;

    // Pick boss type based on biome spread — random for now
    const bossTypes = [
      { key: 'boss_golem',  name: 'Iron Golem',   biome: 'waste',  hp: 600, speed: 55,  dmg: 22, armor: 4, specialType: 'slam',   specialInterval: 5500 },
      { key: 'boss_wolf',   name: 'Alpha Wolf',    biome: 'grass',  hp: 420, speed: 100, dmg: 16, armor: 1, specialType: 'charge', specialInterval: 4000 },
      { key: 'boss_spider', name: 'Spider Queen',  biome: 'ruins',  hp: 480, speed: 85,  dmg: 18, armor: 2, specialType: 'spray',  specialInterval: 5000 },
      { key: 'boss_troll',  name: 'Frost Troll',   biome: 'tundra', hp: 700, speed: 65,  dmg: 28, armor: 5, specialType: 'slam',   specialInterval: 6500 },
      { key: 'boss_hydra',  name: 'Bog Hydra',     biome: 'swamp',  hp: 540, speed: 65,  dmg: 20, armor: 2, specialType: 'spray',  specialInterval: 5500 },
    ];
    // Biome-anchored pick — prefer a boss whose biome matches where the
    // players currently are, so the boss reads as something emerging from
    // the surrounding world instead of a random spawn. Falls back to random
    // if the current biome has no matching boss type.
    let bt;
    try {
      const anchor = (this.p1 && this.p1.spr) ? this.p1 : (this.p2 && this.p2.spr ? this.p2 : null);
      const pbiome = anchor ? getBiome(Math.floor(anchor.spr.x / TILE), Math.floor(anchor.spr.y / TILE)) : null;
      const matches = pbiome ? bossTypes.filter(b => b.biome === pbiome) : [];
      bt = matches.length ? matches[Phaser.Math.Between(0, matches.length - 1)]
                          : bossTypes[Phaser.Math.Between(0, bossTypes.length - 1)];
    } catch(e) {
      bt = bossTypes[Phaser.Math.Between(0, bossTypes.length - 1)];
    }

    // Spawn at a random map edge
    let bx, by;
    const side = Phaser.Math.Between(0, 3);
    if (side === 0)      { bx = Phaser.Math.Between(TILE*4, worldW-TILE*4); by = TILE*4; }
    else if (side === 1) { bx = Phaser.Math.Between(TILE*4, worldW-TILE*4); by = worldH-TILE*4; }
    else if (side === 2) { bx = TILE*4; by = Phaser.Math.Between(TILE*4, worldH-TILE*4); }
    else                 { bx = worldW-TILE*4; by = Phaser.Math.Between(TILE*4, worldH-TILE*4); }

    this._log(`spawnBoss: picked ${bt.name} at (${bx|0},${by|0})`, 'world');
    // Boss sprite: 3× on new 56×60 textures ≈ 168×180 in-game (twice the pixel density of the old 4×40).
    const BOSS_SCALE = 3;
    const spr = this.physics.add.image(bx, by, bt.key).setScale(BOSS_SCALE).setDepth(12);
    spr.setCollideWorldBounds(true);
    spr.body.setSize(28, 28);
    if (this.hudCam) this.hudCam.ignore(spr);
    this._log('spawnBoss: sprite created; adding collider', 'world');
    this.physics.add.collider(spr, this.obstacles, (bSpr, obstacle) => {
        const now = this.time.now;
        if (obstacle?.active && now > (this.boss?._smashCooldown || 0)) {
            if (this.boss) this.boss._smashCooldown = now + 350;
            this._bossSmash(obstacle);
        }
    });
    this._log('spawnBoss: collider added', 'world');

    // Shadow — tracks boss every frame, sits below the sprite so terrain still reads.
    const shadow = this.add.image(bx, by + 36, 'boss_shadow')
      .setScale(BOSS_SCALE * 0.9, BOSS_SCALE * 0.8)
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

    const _bossHp  = Math.max(1, Math.round(bt.hp  * this.hc.bossHpMult));
    const _bossDmg = Math.max(1, Math.round(bt.dmg * this.hc.bossDmgMult));
    this.boss = {
      spr, hp: _bossHp, maxHp: _bossHp,
      speed: bt.speed, dmg: _bossDmg, name: bt.name,
      isBoss: true, type: bt.key, armor: bt.armor || 0,
      attackTimer: 0, atkInterval: 2200,
      aggroRange: 99999, attackRange: 70, wanderTimer: 0, sizeMult: 1,
      hpBg, hpBar,
      shadow, baseScale: BOSS_SCALE, _hitTweenUntil: 0,
      specialType: bt.specialType, specialInterval: bt.specialInterval,
      specialTimer: bt.specialInterval * 0.6, // first special fires sooner
      _bossState: 'chase', _telegraphTimer: 0, _telegraphGfx: null,
    };
    // Add boss to main enemy array so melee + bullets can hit it
    this.enemies.push(this.boss);

    // Screen-edge indicator \u2014 pulsing arrow visible on HUD when boss is off-screen
    const _bossInd = this.add.graphics().setDepth(200);
    this.cameras.main.ignore(_bossInd); // HUD-only: main camera skips it, hudCam renders it
    this.boss._indicator = _bossInd;

    // Announce arrival
    this._log(`Boss spawned: ${bt.name}  hp=${_bossHp}  dmg=${_bossDmg}  armor=${bt.armor||0}  day=${this.dayNum}  diff=${this._diffMult().toFixed(1)}x`, 'world');
    this.hint('\u2620 ' + bt.name.toUpperCase() + ' APPROACHES! \u2620', 6000);
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
    this.cameras.main.shake(800, 0.012);
    this._log('spawnBoss: shake scheduled', 'world');

    // Schedule entourage — 4-8 regular enemies nearby, spaced across frames so the
    // physics world isn't asked to register N colliders in a single frame (the sync
    // spawn was a freeze culprit on Day-5 with 400+ bodies already active).
    const entourageCount = Phaser.Math.Between(4, 8);
    this._log(`spawnBoss: entourage scheduled  count=${entourageCount}`, 'world');
    const typeKey = (bt.biome === 'tundra') ? 'wolf' : (bt.biome === 'swamp') ? 'rat' : 'wolf';
    const t = typeKey === 'wolf'
      ? { key:'wolf', hp:60, speed:100, dmg:9, baseScale:1.8, w:20, h:12 }
      : { key:'rat',  hp:30, speed:140, dmg:6, baseScale:1.4, w:15, h:9  };
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
          aggroRange: baseAggro * 1.4, attackRange: (30 + t.w/2) * sizeMult,
          sizeMult,
        });
        this._log(`spawnBoss: entourage spawned  i=${i}`, 'world');
        if (i === entourageCount - 1) {
          this._log(`spawnBoss: entourage complete  spawned=${entourageCount}  total_enemies=${this.enemies.length}`, 'world');
        }
      });
    }
  }

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

      this.cameras.main.shake(180, 0.009);
      this._log('boss smash  type=' + (this.boss?.type || '?') + '  tile=(' + tx + ',' + ty + ')', 'world');
      obstacle.destroy();
    } catch (e) {
      this._log('boss smash ERR: ' + (e && e.message || e), 'error');
    }
  }

  updateBoss(delta) {
    if (!this.boss || this.isOver) return;
    const b = this.boss;
    if (b.hp <= 0 || !b.spr.active) {
      // Clean up HP bar
      if (b.hpBg && b.hpBg.active) b.hpBg.destroy();
      if (b.hpBar && b.hpBar.active) b.hpBar.destroy();
      if (b.shadow && b.shadow.active) b.shadow.destroy();
      this.boss = null;
      return;
    }

    // Bog Hydra passive HP regen — 5 HP/s. Suppress while flinching from a
    // recent hit so sustained DPS actually drops HP instead of racing regen.
    if (b.type === 'boss_hydra' && b.hp < b.maxHp && b.hp > 0 && !(b._flinchTimer > 0)) {
      b.hp = Math.min(b.maxHp, b.hp + 5 * (delta / 1000));
    }

    // ── Animation: shadow, idle breathing, walk bob ─────────────
    // Shadow tracks the boss's true world position (not the bobbed sprite y).
    if (b.shadow && b.shadow.active) {
      b.shadow.setPosition(b.spr.x, b.spr.y + 36);
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
      this.hint('⚠ ' + b.name.toUpperCase() + ' is ENRAGED!', 2500);
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
      this.hint('⚠ ' + b.name.toUpperCase() + ' is FERAL!', 2500);
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

      // Chase toward nearest foe — use obstacle steering so the boss can't freeze on terrain
      const vel = this._steerToward(b, foeX, foeY, b.speed);
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
            this._log(nearest.charData.player + ' hit for ' + b.dmg + '  hp=' + nearest.hp + '/' + nearest.maxHp, 'combat');
            SFX.playerHurt();
            this._floatDamage(nearest.spr.x, nearest.spr.y - 18, b.dmg);
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
              this._log(`${nearest.charData.player} frost slowed  hp=${nearest.hp}/${nearest.maxHp}`, 'combat');
              this._showStatus('FROST SLOW! (-45% speed)', 1500);
              this.time.delayedCall(280, () => { if (nearest.spr?.active && nearest._frostSlowed) nearest.spr.setTint(0x88ccff); });
              this.time.delayedCall(3000, () => {
                if (!nearest) return;
                nearest._frostSlowed = false;
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
    this._log(`Boss special: ${b.specialType}  boss=${b.type}  hp=${b.hp}/${b.maxHp}  pct=${Math.round(b.hp/b.maxHp*100)}%`, 'combat');

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
          if (Phaser.Math.Distance.Between(b.spr.x, b.spr.y, p.spr.x, p.spr.y) < 55) {
            const chargeDmg = this._knightShieldBlock(p, b.spr.x, b.spr.y, Math.round(b.dmg * 1.3));
            p.hp = Math.max(0, p.hp - chargeDmg);
            this._log(`${p.charData.player} troll charge  dmg=${chargeDmg}  hp=${p.hp}/${p.maxHp}`, 'combat');
            SFX.playerHurt();
            this._floatDamage(p.spr.x, p.spr.y - 18, chargeDmg);
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
              p._speedMult = 0;
              this._log(`${p.charData.player} webbed by boss_spider – immobilised 1.5s hp=${p.hp}/${p.maxHp}`, 'combat');
              this._showStatus('WEBBED! Can\'t move!', 1500);
              this.time.delayedCall(1500, () => {
                if (!p) return;
                p._webbed = false;
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
  }

  updateEnemyDens(delta) {
    if (!this.enemyDens) return;
    this.enemyDens.forEach(den => {
      den.respawnTimer += delta;
      if (den.respawnTimer >= this.hc.denRespawn) {
        den.respawnTimer = 0;
        if (this.enemies.length >= CFG.MAX_ENEMIES) return;
        // Only respawn when a player is nearby — prevents offscreen accumulation
        const _ap = this._activePlayers || [];
        let nearDist = Infinity;
        for (const p of _ap) { const _d = Phaser.Math.Distance.Between(den.x, den.y, p.spr.x, p.spr.y); if (_d < nearDist) nearDist = _d; }
        if (nearDist > 1200) return;
        // Cap per-den live population
        den.liveCount = den.liveCount || 0;
        if (den.liveCount >= 4) return;
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
        const spd = t.speed * this._diffSpeedMult() * (sizeMult < 0.85 ? 1.3 : sizeMult > 1.2 ? 0.8 : 1);
        const atkInterval = Math.max(500, Math.round(({ wolf:1600, rat:1200, bear:2400 }[type] || 1400) / D));
        const denBaseAggro = { wolf: 190, rat: 110, bear: 290 }[type] || 160;
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, atkInterval, type, attackTimer:0, wanderTimer:0, aggroRange:denBaseAggro, attackRange:30*sizeMult, sizeMult, _den: den, home: { x: den.x, y: den.y } };
        den.liveCount++;
        this._startDormantIfFar(e, ex, ey);
        this._log(`Den respawn: ${type}  total_enemies=${this.enemies.length+1}  den_pop=${den.liveCount}/4`, 'world');
        this.enemies.push(e);
      }
    });
  }

  updateWaterDens(delta) {
    if (!this.waterDens) return;
    this.waterDens.forEach(den => {
      den.respawnTimer += delta;
      if (den.respawnTimer < this.hc.waterDenRespawn) return;
      den.respawnTimer = 0;
      if (this.enemies.length >= CFG.MAX_ENEMIES) return;
      // Only respawn when a player is nearby — prevents offscreen accumulation
      const _ap = this._activePlayers || [];
      let nearDist = Infinity;
      for (const p of _ap) { const _d = Phaser.Math.Distance.Between(den.x, den.y, p.spr.x, p.spr.y); if (_d < nearDist) nearDist = _d; }
      if (nearDist > 1200) return;
      // Cap per-den live population
      den.liveCount = den.liveCount || 0;
      if (den.liveCount >= 3) return;
      // Pick a random tile within the lake's tileSet to spawn from
      if (!den.tileSet || den.tileSet.size === 0) return;
      const keys = Array.from(den.tileSet);
      const rk = keys[Phaser.Math.Between(0, keys.length - 1)];
      const [ltx, lty] = rk.split(',').map(Number);
      this._log(`Water den respawn: water_lurker  total_enemies=${this.enemies.length+1}`, 'world');
      const e = this._spawnWaterLurker(ltx * CFG.TILE, lty * CFG.TILE);
      e._den = den;
      e.home = { x: den.x, y: den.y }; // leash anchor: lurkers return toward lake after combat
      den.liveCount++;
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
      if (this.time.now < (player.atkAnimUntil || 0)) return;
      player.walkTimer = (player.walkTimer + 1) % 20;
      const step = player.walkTimer < 10 ? '' : '_step';
      const dirSuffix = (player.dir === 'side') ? '' : ('_' + player.dir);
      player.spr.setTexture('player_atlas', id + dirSuffix + step);
      // Flip for leftward movement on all side-facing variants
      if (player.dir === 'side' || player.dir === 'fside' || player.dir === 'bside') {
        player.spr.setFlipX(vx < 0);
      } else {
        player.spr.setFlipX(false);
      }
    } else {
      if (this.time.now < (player.atkAnimUntil || 0)) return;
      player.walkTimer = 0;
      const dirSuffix = (player.dir === 'side') ? '' : ('_' + player.dir);
      player.spr.setTexture('player_atlas', id + dirSuffix);
    }
  }

  aimAtMouse(player) {
    const cam = this.cameras.main;
    const pointer = this.input && this.input.activePointer;
    if (!pointer || !player || !player.spr) return;
    const worldX = pointer.x / cam.zoom + cam.worldView.x;
    const worldY = pointer.y / cam.zoom + cam.worldView.y;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return;
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
    if (this.time.now < (player.atkAnimUntil || 0)) return;
    // Update sprite — preserve walk cycle step frame
    const id = player.charData.id;
    const dirSuffix = player.dir === 'side' ? '' : ('_' + player.dir);
    const moving = player.spr.body.velocity.x !== 0 || player.spr.body.velocity.y !== 0;
    const step = (moving && player.walkTimer >= 10) ? '_step' : '';
    player.spr.setTexture('player_atlas', id + dirSuffix + step);
  }

  _triggerAtkAnim(player, dur) {
    const id = player.charData.id;
    const atkKey = (player.dir === 'side') ? id + '_atk' : id + '_atk_' + player.dir;
    player.spr.setTexture('player_atlas', atkKey);
    player.atkAnimUntil = this.time.now + dur;
    player.walkTimer = 0;
    this.tweens.add({
      targets: player.spr,
      scaleX: 1.75, scaleY: 1.25,
      duration: 70, yoyo: true, ease: 'Quad.Out',
    });
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
      // Cooldown readout — only shown when an ability is on cd, so it doesn't
      // clutter the HUD for characters that don't use timed abilities.
      const parts = [];
      if ((p.rallyCooldown  || 0) > 250) parts.push('R ' + Math.ceil(p.rallyCooldown  / 1000) + 's');
      if ((p.turretCooldown || 0) > 250) parts.push('T ' + Math.ceil(p.turretCooldown / 1000) + 's');
      if (parts.length) {
        if (!p._cdText) {
          p._cdText = this.add.text(0, 0, '', {
            fontFamily: 'monospace', fontSize: '9px', color: '#ccddff',
            stroke: '#000', strokeThickness: 2,
          }).setOrigin(0.5, 0).setDepth(21);
          if (this.hudCam) this.hudCam.ignore(p._cdText);
        }
        p._cdText.setText(parts.join('  '));
        p._cdText.setPosition(p.spr.x, by + bh + 1);
        p._cdText.setVisible(true);
      } else if (p._cdText) {
        p._cdText.setVisible(false);
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
    const near = p => p && p.spr && Phaser.Math.Distance.Between(p.spr.x, p.spr.y, this.bPos.x, this.bPos.y) < 110;
    this.bPrompt.setVisible(near(this.p1) || near(this.p2));
  }

  doAttack(player) {
    if (player.atkCooldown > 0) return;
    const id = player.charData.id;
    this._log(`${player.charData.player} attack  char=${id}  hp=${player.hp}/${player.maxHp}`, 'player');
    if (id === 'gunslinger') {
      if (player.ammo <= 0) {
        // Pistol whip — melee fallback when out of ammo in clip
        SFX.wrench();
        player.atkCooldown = 500;
        this._triggerAtkAnim(player, 225);
        this.meleeSwing(player, 38, 0xcc8833, 0.22, 0);
        this._showStatus('Out of ammo! Pistol whip!', 1200);
        return;
      }
      player.ammo--;
      this._hudDirty = true;
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
            this._hurtEnemy(e, 35, blt.x, blt.y, 0xff6644, player);
          });
        });
      }
      this.time.delayedCall(1200, () => { if (blt.active) blt.destroy(); });
      player.atkCooldown = 350;
      this._triggerAtkAnim(player, 140);
    } else if (id === 'knight') {
      SFX.sword();
      player.atkCooldown = 500;
      this._triggerAtkAnim(player, 225);
      this.meleeSwing(player, 55, 0xdddddd, 0.18, 0);
      if (player._knightUpgraded) this._fireShieldThrow(player);
    } else if (id === 'charmer') {
      // Pirouette — 360° AoE spin
      SFX._play(660, 'sine', 0.12, 0.4);
      player.atkCooldown = 1500;
      this._triggerAtkAnim(player, 675);
      this._log(`${player.charData.player} Pirouette  hp=${player.hp}/${player.maxHp}`, 'player');
      // Visual circle radius 50 expands to 50*1.4=70 — hit radius matches final visual
      const PIRO_R = 70;
      const pfx = this.add.graphics().setDepth(20).setPosition(player.spr.x, player.spr.y);
      if (this.hudCam) this.hudCam.ignore(pfx);
      pfx.lineStyle(5, 0xff88cc, 0.9);
      pfx.strokeCircle(0, 0, 50);
      pfx.lineStyle(3, 0xffccee, 0.6);
      pfx.strokeCircle(0, 0, 34);
      this.tweens.add({ targets: pfx, alpha: 0, scaleX: 1.4, scaleY: 1.4, duration: 400, onComplete: () => pfx.destroy() });
      const px = player.spr.x, py = player.spr.y;
      this.enemies.forEach(e => {
        if (e.dying) return;
        const d = Phaser.Math.Distance.Between(px, py, e.spr.x, e.spr.y);
        if (d < PIRO_R) {
          e._aggroOverride = true;
          e._charmTinted = false;
          if (e.spr?.active) e.spr.clearTint();
          // Falloff: 35 dmg at center, 15 dmg at edge
          const dmg = Math.round(Phaser.Math.Linear(35, 15, d / PIRO_R));
          this._hurtEnemy(e, dmg, px, py, 0xff88cc, player);
        }
      });
    } else if (id === 'ranger') {
      // Bow shot — ranged arrow, infinite ammo
      SFX._play(280, 'triangle', 0.08, 0.2);
      player.atkCooldown = 800;
      this._triggerAtkAnim(player, 320);
      this._log(`${player.charData.player} bow shot  hp=${player.hp}/${player.maxHp}`, 'player');
      this._fireArrow(player);
    } else {
      // Architect
      SFX.wrench();
      player.atkCooldown = 450;
      this._triggerAtkAnim(player, 202);
      // Architect melee gets extra knockback — tuned to ~2x the default bullet
      // impulse so it feels heavier without launching enemies across the screen.
      this.meleeSwing(player, 45, 0xcc8833, 0.2, 100);
      if (player._architectUpgraded) this._fireNailGun(player);
    }
  }

  _fireArrow(player) {
    const angle = this.getAimAngle(player);
    const arrow = this.physics.add.image(player.spr.x, player.spr.y, 'bullet')
      .setDepth(15).setScale(1.8, 0.9).setTint(0x886633);
    arrow.setRotation(angle);
    if (this.hudCam) this.hudCam.ignore(arrow);
    this.physics.velocityFromAngle(Phaser.Math.RadToDeg(angle), 520, arrow.body.velocity);
    arrow.body.allowGravity = false;
    if (this.obstacles) {
      this.physics.add.collider(arrow, this.obstacles, () => { if (arrow.active) arrow.destroy(); });
    }
    if (this.enemies) {
      this.enemies.forEach(e => {
        if (e.dying) return;
        this.physics.add.overlap(arrow, e.spr, () => {
          if (!arrow.active || e.dying) return;
          arrow.destroy();
          const dmg = player._rangerUpgraded ? 50 : 35;
          this._hurtEnemy(e, dmg, arrow.x, arrow.y, 0x886633, player);
          if (player._rangerUpgraded) {
            // Explosive arrow: splash damage to nearby enemies
            const ax = arrow.x, ay = arrow.y;
            this.enemies.forEach(ne => {
              if (ne === e || ne.dying) return;
              if (Phaser.Math.Distance.Between(ax, ay, ne.spr.x, ne.spr.y) < 60) {
                this._hurtEnemy(ne, 20, ax, ay, 0xff8833, player);
              }
            });
            const sfx = this.add.graphics().setDepth(20);
            if (this.hudCam) this.hudCam.ignore(sfx);
            sfx.fillStyle(0xff8833, 0.7); sfx.fillCircle(ax, ay, 60);
            this.tweens.add({ targets: sfx, alpha: 0, scaleX: 1.5, scaleY: 1.5, duration: 300, onComplete: () => sfx.destroy() });
          }
        });
      });
    }
    this.time.delayedCall(1800, () => { if (arrow.active) arrow.destroy(); });
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
          this._hurtEnemy(e, 28, blt.x, blt.y, 0x5599ff, player);
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
          this._hurtEnemy(e, 14, blt.x, blt.y, 0xff8833, player);
        });
      });
    }
    this.time.delayedCall(900, () => { if (blt.active) blt.destroy(); });
  }

  doAlt(player) {
    const id = player.charData.id;
    if (id === 'gunslinger') {
      const clipSize = player._gunslingerClip || 8;
      // Pull from team pool if the personal reserve is empty \u2014 otherwise P2's
      // ammo crate pickups are unreachable and gunslinger gets starved in co-op.
      const totalAvailable = (player.reserveAmmo || 0) + (this.teamAmmoPool || 0);
      if (player.ammo < clipSize && !player.reloading && totalAvailable > 0) {
        player.reloading = true;
        SFX.reload();
        this.hint('Reloading\u2026 (' + totalAvailable + ' available)', 1500);
        this.time.delayedCall(1500, () => {
          const needed = clipSize - player.ammo;
          let fill = Math.min(needed, player.reserveAmmo);
          player.ammo += fill;
          player.reserveAmmo -= fill;
          // Top up from the shared team pool if still short.
          const stillNeeded = (clipSize - player.ammo);
          if (stillNeeded > 0 && this.teamAmmoPool > 0) {
            const fromPool = Math.min(stillNeeded, this.teamAmmoPool);
            player.ammo += fromPool;
            this.teamAmmoPool -= fromPool;
          }
          player.reloading = false;
          this._log(`${player.charData.player} reloaded  ammo=${player.ammo}  reserve=${player.reserveAmmo}  pool=${this.teamAmmoPool}`, 'player');
          this._hudDirty = true; SFX.reload();
        });
      } else if (totalAvailable <= 0 && player.ammo < clipSize) {
        this.hint('No ammo left! Find more drops.', 2000);
      }
    } else if (id === 'knight') {
      // RALLY — war cry boosts speed + frightens nearby enemies (30s cooldown)
      if (player.rallyCooldown > 0) {
        this._showStatus('RALLY: ' + Math.ceil(player.rallyCooldown / 1000) + 's', 1200);
        return;
      }
      player.rallyCooldown = 30000;
      this._log(`${player.charData.player} used RALLY  hp=${player.hp}/${player.maxHp}  enemies_nearby=${(this.enemies||[]).filter(e=>e.spr?.active&&!e._dormant&&Phaser.Math.Distance.Between(e.spr.x,e.spr.y,player.spr.x,player.spr.y)<300).length}`, 'player');
      this.tickCooldown(player, 'rallyCooldown', 30000);
      this.time.delayedCall(30000, () => this.hint('RALLY is ready!', 2000));
      SFX._play(330, 'square', 0.15, 0.5, 'rise');
      SFX._play(440, 'square', 0.2, 0.4, 'rise');
      this.hint('RALLY! Speed boost + enemies flee!', 2500);
      // Inner gold circle (visual flair — speed boost has no range, always hits partner or self)
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
      if (player.turretCooldown > 0) {
        this._showStatus('TURRET: ' + Math.ceil(player.turretCooldown / 1000) + 's', 1200);
        return;
      }
      player.turretCooldown = 45000;
      this.tickCooldown(player, 'turretCooldown', 45000);
      this.time.delayedCall(45000, () => { if (!this.isOver) this.hint('TURRET is ready!', 2000); });
      SFX._play(500, 'square', 0.1, 0.3);
      SFX._play(700, 'triangle', 0.08, 0.2);
      this._log(`${player.charData.player} deployed TURRET  pos=(${Math.floor(player.spr.x/CFG.TILE)},${Math.floor(player.spr.y/CFG.TILE)})`, 'player');
      this.hint('Turret deployed!', 2000);
      this.deployTurret(player.spr.x, player.spr.y, player);
    } else if (id === 'charmer') {
      // FLOWER TOSS — charm-on-hit bouquet
      if ((player.flowerAmmo || 0) <= 0) {
        this.hint('No flowers! Craft a Flower Bouquet.', 2000);
        return;
      }
      player.flowerAmmo--;
      SFX._play(880, 'sine', 0.1, 0.3);
      this._log(`${player.charData.player} Flower Toss  flowers_left=${player.flowerAmmo}`, 'player');
      this.hint('Flower Toss! (' + player.flowerAmmo + ' left)', 1200);
      const angle = this.getAimAngle(player);
      const flower = this.physics.add.image(player.spr.x, player.spr.y, 'item_flower')
        .setDepth(15).setScale(1.5).setTint(0xff88cc);
      flower.setRotation(angle);
      if (this.hudCam) this.hudCam.ignore(flower);
      this.physics.velocityFromAngle(Phaser.Math.RadToDeg(angle), 280, flower.body.velocity);
      flower.body.allowGravity = false;
      if (this.enemies) {
        this.enemies.forEach(e => {
          if (e.dying) return;
          this.physics.add.overlap(flower, e.spr, () => {
            if (!flower.active || e.dying) return;
            flower.destroy();
            this._hurtEnemy(e, 20, flower.x, flower.y, 0xff88cc, player);
            // Brief charm even on aggroed enemies — override clears after 2s
            e._aggroOverride = false;
            e._charmedTimer = 2000;
          });
        });
      }
      this.time.delayedCall(1500, () => { if (flower.active) flower.destroy(); });
    } else if (id === 'ranger') {
      // KNIFE STRIKE — quick melee
      if (player.knifeCooldown > 0) {
        this.hint('Knife: ' + Math.ceil(player.knifeCooldown / 1000) + 's', 800);
        return;
      }
      player.knifeCooldown = 500;
      this.tickCooldown(player, 'knifeCooldown', 500);
      SFX._play(400, 'square', 0.06, 0.12);
      player.atkCooldown = 500;
      this._triggerAtkAnim(player, 225);
      this._log(`${player.charData.player} Knife Strike  hp=${player.hp}/${player.maxHp}`, 'player');
      this.meleeSwing(player, 35, 0x886633, 0.15, 0);
    }
  }

  tickCooldown(player, key, dur) {
    const timer = this.time.addEvent({
      delay: 100, repeat: dur / 100,
      callback: () => { player[key] = Math.max(0, player[key] - 100); }
    });
  }

  deployTurret(x, y, owner) {
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
          this._hurtEnemy(nearest, 18, x, y, 0xff6644, owner);
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
          const meleeDmg = player.charData.id === 'knight' ? 45 : (player.charData.id === 'ranger' ? 25 : 30);
          this._hurtEnemy(e, meleeDmg, player.spr.x, player.spr.y, 0xff6644, player);
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
    this._log(`${player.charData.player} shield block absorbed ${baseDmg - dmg} (${dmg} through) hp=${player.hp}/${player.maxHp}`, 'combat');

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
  }

  // Brief physics-world freeze (ms) for impact weight. Rate-limited to once per
  // 300ms to prevent sustained stutter during multi-enemy engagements and
  // suppressed entirely on mobile where the freeze reads as frame-drop.
  _hitPause(ms) {
    if (this._hitPauseActive || this.isOver || !this.physics || !this.physics.world) return;
    if (_isMobile) return;
    const now = this.time.now;
    if (this._lastHitPauseEnd && now - this._lastHitPauseEnd < 260) return;
    this._hitPauseActive = true;
    try { this.physics.world.pause(); } catch(e) {}
    this.time.delayedCall(ms, () => {
      this._hitPauseActive = false;
      this._lastHitPauseEnd = this.time.now;
      try { this.physics.world.resume(); } catch(e) {}
    });
  }

  // Floating damage number — reuses the pickup-float pattern but colour-codes
  // by magnitude so bigger hits feel impactful.
  //   < 15   off-white (chip)
  //   15-39  yellow    (solid)
  //   40+    orange    (heavy / crit)
  _floatDamage(x, y, dmg) {
    if (!dmg || dmg < 1) return;
    const colour = dmg >= 40 ? '#ff8844' : dmg >= 15 ? '#ffee44' : '#e8e8ee';
    const size   = dmg >= 40 ? '15px'    : dmg >= 15 ? '13px'    : '11px';
    const t = this.add.text(x, y, '-' + dmg, {
      fontFamily: 'monospace', fontSize: size, color: colour,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(150).setAlpha(1);
    if (this.hudCam) this.hudCam.ignore(t);
    // Slight horizontal jitter so multi-hits in one frame don't stack perfectly.
    const jx = (Math.random() - 0.5) * 14;
    this.tweens.add({
      targets: t, x: x + jx, y: y - 22, duration: 520, ease: 'Cubic.Out',
      onComplete: () => {
        this.tweens.add({
          targets: t, y: y - 40, alpha: 0, duration: 260,
          ease: 'Cubic.In', onComplete: () => t.destroy(),
        });
      },
    });
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
        this._log(`${p.charData.player} caught in spider web  hp=${p.hp}/${p.maxHp}`, 'combat');
        this._showStatus('Caught in a web!', 1500);
        this.time.delayedCall(2500, () => {
          if (p && p.spr?.active) { p._speedMult = 1; p._webSlowCd = 0; }
        });
      });
    });
    this.time.delayedCall(CFG.ITEM_DESPAWN_MS, () => {
      if (web.active) web.destroy();
      this.activeWebs = (this.activeWebs || []).filter(w => w !== web);
    });
  }

  // Three-layer additive glow stack rendered ABOVE the night overlay (depth 49),
  // so warm photons add directly to the darkened terrain instead of being dimmed
  // by it. Zero tweens are created per glow — a single shared driver in
  // _updateFireGlows drives alpha/scale for every active glow, and dormancy
  // culling hides distant glows (mirrors enemy dormancy at CFG.DORMANT_RADIUS).
  // baseScale controls radius: 1.6 = campfire/campsite, 0.45 = torch.
  _addFireGlow(x, y, baseScale = 1.6) {
    const mkLayer = (depth, baseAlpha, scaleMult, tint) => {
      const s = this.add.image(x, y, 'fire_glow')
        .setScale(baseScale * scaleMult)
        .setAlpha(0)
        .setDepth(depth)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false);
      if (tint != null) s.setTint(tint);
      s._baseAlpha = baseAlpha;
      s._baseScale = baseScale * scaleMult;
      this._w(s);
      if (this.hudCam) this.hudCam.ignore(s);
      return s;
    };
    const ground = mkLayer(50, 0.18, 0.9,  0xffaa55); // warm wash on terrain
    const main   = mkLayer(51, 0.55, 1.0,  null);     // primary bloom
    const core   = mkLayer(52, 0.45, 0.35, 0xffeecc); // hot core
    const rec = {
      sprites: [ground, main, core],
      x, y,
      phase: Math.random() * Math.PI * 2,
      _active: false,
    };
    if (!this._fireGlows) this._fireGlows = [];
    this._fireGlows.push(rec);
    return main; // preserve prior return type for any call-site assumptions
  }

  // Single shared driver for all fire glows. Per-frame cost scales linearly
  // with active (non-dormant) glow count: ~2 sin + 3 sprite writes per glow.
  // Dormancy check is throttled to every 3rd frame since player positions
  // change slowly relative to frame rate.
  _updateFireGlows(delta) {
    const arr = this._fireGlows;
    if (!arr || arr.length === 0) return;
    const ap = this._activePlayers;
    if (!ap || ap.length === 0) return;

    this._glowFlicker.t += delta;
    const t = this._glowFlicker.t * 0.001;
    const nightAlpha = (this.nightOverlay && this.nightOverlay.alpha) || 0;
    const nightNorm = Math.min(1, nightAlpha / 0.6);
    const nightBoost = 0.15 + 0.85 * nightNorm;

    const dormR2 = CFG.DORMANT_RADIUS * CFG.DORMANT_RADIUS;
    const wakeR2 = CFG.WAKE_RADIUS * CFG.WAKE_RADIUS;
    this._glowFrame = (this._glowFrame | 0) + 1;
    const doCull = (this._glowFrame % 3) === 0;

    for (let i = arr.length - 1; i >= 0; i--) {
      const g = arr[i];
      // Lazy prune: if underlying sprites were destroyed by world reset, drop the record.
      if (!g.sprites[0] || !g.sprites[0].active) { arr.splice(i, 1); continue; }

      if (doCull) {
        let min2 = Infinity;
        for (let j = 0; j < ap.length; j++) {
          const p = ap[j]; if (!p || !p.spr) continue;
          const dx = p.spr.x - g.x, dy = p.spr.y - g.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < min2) min2 = d2;
        }
        if (g._active && min2 > dormR2) {
          g._active = false;
          for (let k = 0; k < g.sprites.length; k++) g.sprites[k].setVisible(false);
        } else if (!g._active && min2 < wakeR2) {
          g._active = true;
          for (let k = 0; k < g.sprites.length; k++) g.sprites[k].setVisible(true);
        }
      }
      if (!g._active) continue;

      const wobble = 0.85 + 0.15 * Math.sin(t * 5.3 + g.phase);
      const breathe = 1 + 0.08 * Math.sin(t * 1.4 + g.phase);
      const aMul = nightBoost * wobble;
      for (let k = 0; k < g.sprites.length; k++) {
        const sp = g.sprites[k];
        sp.alpha = sp._baseAlpha * aMul;
        sp.setScale(sp._baseScale * breathe);
      }
    }
  }

  // Spawn a wall-mounted torch sprite + glow at world position (x, y).
  // Used by world-gen (ruins) and placeBuild().
  _spawnTorch(x, y) {
    this._addFireGlow(x, y, 0.45);
    const tc = this._w(this.add.image(x, y, 'torch').setScale(2).setDepth(5));
    if (this.hudCam) this.hudCam.ignore(tc);
    return tc;
  }

  _autoPause(reason) {
    if (this.isOver || this._autoPaused) return;
    this._autoPaused = true;
    this._log(`auto-pause (${reason})`, 'world');
    if (this.scene && !this.scene.isPaused('Game')) this.scene.pause('Game');
    // Suspend the shared AudioContext so background-tab CPU stays near zero.
    try {
      if (typeof Music !== 'undefined' && Music.ctx && Music.ctx.state === 'running') {
        Music.ctx.suspend();
      }
    } catch(e) {}
  }
  _autoResume() {
    if (!this._autoPaused) return;
    this._autoPaused = false;
    this._log('auto-resume', 'world');
    if (this.scene && this.scene.isPaused('Game')) this.scene.resume('Game');
    // Clear stale key-down states so nothing is "stuck" after the tab was backgrounded.
    // Without this, a key held before the tab-switch stays .isDown = true forever.
    try { if (this.input && this.input.keyboard) this.input.keyboard.resetKeys(); } catch(e) {}
    try {
      if (typeof Music !== 'undefined' && Music.ctx && Music.ctx.state === 'suspended' && Music.playing) {
        Music.ctx.resume();
      }
    } catch(e) {}
  }

  // Push a timestamped event entry to the in-game debug log (` key to show/hide).
  // cat (optional): 'world' | 'player' | 'combat' | 'build'
  _log(msg, cat) {
    if (!this._dbgEntries) return;
    const t = Math.floor(this.timeAlive || 0);
    const ts = `${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`;
    const tag = (cat || 'info').toUpperCase().padEnd(6).slice(0, 6);
    this._dbgEntries.push(`T${ts} [${tag}] ${msg}`);
    // Soft cap so multi-hour sessions don't accumulate GB of log lines. FIFO
    // drop from the front keeps the most recent activity — still useful for
    // bug reports. Overlay shows last 28 lines either way.
    if (this._dbgEntries.length > 50000) {
      this._dbgEntries.splice(0, this._dbgEntries.length - 50000);
    }
    this._dbgRefresh(true);
  }

  // Rebuild the debug overlay text. force=true skips throttle (use from _log).
  _dbgRefresh(force) {
    if (!this._dbgTxt || !this._dbgVisible) return;
    if (!force) {
      this._dbgRefreshCd = (this._dbgRefreshCd || 0) - (this.game.loop.delta || 16);
      if (this._dbgRefreshCd > 0) return;
      this._dbgRefreshCd = 500; // refresh stats header 2× per second
    }
    // Smoothed FPS — the raw actualFps jitters wildly on variable-refresh
    // displays; a trailing average makes real regressions readable.
    const rawFps = this.game.loop.actualFps || 60;
    this._fpsAvg = this._fpsAvg ? (this._fpsAvg * 0.88 + rawFps * 0.12) : rawFps;
    const fps    = Math.round(this._fpsAvg);
    // Log FPS warnings (throttled: at most once every 10 s)
    if (fps < 30 && (!this._lastFpsWarn || (this.timeAlive||0) - this._lastFpsWarn > 10)) {
      this._lastFpsWarn = this.timeAlive || 0;
      const _all = this.enemies || [];
      const _activeCount = this._activeEnemyCount ?? _all.filter(e => e.spr?.active && !e._dormant).length;
      const _bodies = this.physics.world.bodies.size;
      const _dormantCount = _all.filter(e => e._dormant).length;
      const _campfireCount = (this.pois || []).filter(p => p.type === 'campfire').length;
      this._dbgEntries && this._dbgEntries.push(
        `T${Math.floor((this.timeAlive||0)/60).toString().padStart(2,'0')}:${(Math.floor(this.timeAlive||0)%60).toString().padStart(2,'0')} [PERF  ] FPS drop: ${fps}  active=${_activeCount}/${_all.length}  dormant=${_dormantCount}  bodies=${_bodies}  campfires=${_campfireCount}`
      );
    }
    const t      = Math.floor(this.timeAlive || 0);
    const ts     = `${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`;
    const active = this._activeEnemyCount ?? (this.enemies || []).filter(e => e.spr?.active && !e._dormant).length;
    const total  = (this.enemies || []).length;
    const phase  = this.isNight ? 'NIGHT' : 'DAY';
    const p1s    = this.p1
      ? `P1(${this.p1.charData?.id||'?'}): ${this.p1.hp}/${this.p1.maxHp}hp${this.p1.isDowned?' [DOWN]':''}`
      : '';
    const p2s    = this.p2
      ? `  P2(${this.p2.charData?.id||'?'}): ${this.p2.hp}/${this.p2.maxHp}hp${this.p2.isDowned?' [DOWN]':''}`
      : '';
    const diff   = this._diffMult ? this._diffMult().toFixed(1) : '?';
    const header = [
      `── Iron Wasteland Debug Log ──  ${_fmtVersion(VERSION)}`,
      `FPS:${fps}  ${phase} ${this.dayNum||1}  T:${ts}  Diff:${diff}x  Seed:${this._worldSeed||'?'}`,
      `Enemies: ${active} active / ${total} total  |  Kills: ${this.kills||0}`,
      `${p1s}${p2s}`,
      `[\`] close  [C] copy  [G] download .txt`,
      `────────────────────────────────────────────────────`,
    ];
    const allEntries = this._dbgEntries.length ? this._dbgEntries : ['(no events yet)'];
    const entries = allEntries.slice(-28); // overlay shows last 28; download has everything
    if (allEntries.length > 28) entries.unshift(`  … ${allEntries.length - 28} earlier entries (G to download all)`);
    this._dbgTxt.setText([...header, ...entries].join('\n'));
  }

  // Trigger a .txt download of the full session log.
  // auto=true means the caller is an auto-trigger (game over, crash); those
  // respect the settings opt-out so fullscreen/kiosk sessions aren't spammed
  // with a download prompt. Manual calls (G in overlay) always download.
  _downloadLog(auto) {
    if (!this._dbgEntries) return;
    const isLAN = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
    if (!isLAN) return;
    if (auto) {
      try {
        if (loadSettings().autoDownloadLog === false) {
          this._log('auto log download suppressed by setting', 'world');
          return;
        }
      } catch(e) {}
    }
    const t    = Math.floor(this.timeAlive || 0);
    const mode = `${this.solo ? 'Solo' : '2P'} ${this.hardcore ? 'Hardcore' : 'Survival'}`;
    const p1s  = this.p1 ? `P1 (${this.p1.charData?.id||'?'}): HP ${this.p1.hp}/${this.p1.maxHp}` : '';
    const p2s  = this.p2 ? `P2 (${this.p2.charData?.id||'?'}): HP ${this.p2.hp}/${this.p2.maxHp}` : '';
    const lines = [
      `IRON WASTELAND SESSION LOG`,
      `─────────────────────────────────────────`,
      `Version  : ${_fmtVersion(VERSION)}`,
      `Exported : ${new Date().toLocaleString()}`,
      `Mode     : ${mode}`,
      `Session  : ${Math.floor(t/60)}m ${t%60}s`,
      `Day      : ${this.dayNum||1}   Diff: ${this._diffMult ? this._diffMult().toFixed(1) : '?'}x`,
      `Kills    : ${this.kills||0}  (P1:${this.p1?.kills||0}${this.p2 ? '  P2:'+this.p2.kills : ''})`,
      `Seed     : ${this._worldSeed||'?'}`,
      p1s, p2s,
      `─────────────────────────────────────────`,
      `EVENT LOG (${this._dbgEntries.length} entries)`,
      `─────────────────────────────────────────`,
      ...this._dbgEntries,
    ].filter(Boolean).join('\n');
    const blob = new Blob([lines], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fname = `iron-wasteland-${ts}.txt`;
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: fname,
    });
    a.click();
    URL.revokeObjectURL(url);
    // Also save to ./logs/ via dev server — same-origin so it works whether served
    // as localhost, 127.0.0.1, or LAN IP. No-op if running from file:// (no server).
    if (location.protocol !== 'file:') {
      const body = JSON.stringify({ filename: fname, content: lines });
      const tryPost = (attempt) => fetch('/save-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      .then(r => {
        if (r.ok) return;
        if (attempt < 2) { setTimeout(() => tryPost(attempt + 1), 800); return; }
        console.warn('[save-log] server returned', r.status, 'after', attempt + 1, 'tries');
      })
      .catch(e => {
        if (attempt < 2) { setTimeout(() => tryPost(attempt + 1), 800); return; }
        console.warn('[save-log] failed after', attempt + 1, 'tries:', e);
      });
      tryPost(0);
    } else {
      console.warn('[save-log] skipped — running from file://; run `node server.js` to save logs to disk');
    }
  }

  killEnemy(e, owner = null) {
    if (e.dying) return; // already being killed — prevent double-kill & double-count
    e.dying = true;
    e.hp = 0;
    if (e._den) e._den.liveCount = Math.max(0, (e._den.liveCount || 0) - 1);
    this.kills++;
    if (owner) owner.kills++;
    this._log('Enemy killed  type=' + e.type + '  kills=' + this.kills, 'combat');
    // Remove from update loop — defer splice if iteration is active to avoid
    // Array.forEach skipping the element after the removed index.
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
      const bs = e.baseScale || 3;
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
        boss_wolf:   [0x888855, 0xeeeecc, 0x554422],
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
  }

  // Per-frame proximity check for spike traps.  Replaces physics.add.overlap because
  // add.image() has no physics body, and it also covers enemies that spawn after placement.
  _updateScoutPanel() {
    const SCOUT_DATA = {
      wolf:           { atk: 'Bite',         weak: 'Spikes / fire',  note: '"Asked three questions. Got a growl."' },
      rat:            { atk: 'Swarm nip',     weak: 'AoE attacks',   note: '"Honestly? Kind of cute. Still a threat."' },
      bear:           { atk: 'Maul',          weak: 'Keep distance', note: '"Named this one Gerald."' },
      raider_brawler: { atk: 'Melee rush',    weak: 'Kite & shoot',  note: '"Very passionate. Very punchy."' },
      raider_shooter: { atk: 'Ranged shots',  weak: 'Get close fast',note: '"Asked about reload rate. He ran."' },
      raider_heavy:   { atk: 'Heavy melee',   weak: 'Fire & retreat',note: '"Too slow for questions. Very big."' },
      dust_hound:     { atk: 'Pack nip',      weak: 'Separate them', note: '"Pack mentality. Asked the alpha. Complicated."' },
      ice_crawler:    { atk: 'Frost slow',    weak: 'Fire attacks',  note: '"Cold outside, deeply misunderstood."' },
      bog_lurker:     { atk: 'Ambush lunge',  weak: 'Light it up',   note: '"Lurks. Did not answer questions. Rude."' },
      spider_ruins:   { atk: 'Web drop',      weak: 'Keep moving',   note: '"Eight eyes. Eight chances to connect."' },
      water_lurker:   { atk: 'Drag under',    weak: 'Stay off water',note: '"Waved at it. It didn\'t wave back."' },
    };

    const abigail = [this.p1, this.p2].find(p => p && p.charData && p.charData.id === 'ranger' && !p.isDowned && p.spr && p.spr.active);
    if (!abigail) { this._hideScoutPanel(); return; }

    // Find nearest enemy within scout range
    let nearest = null, nearDist = Infinity;
    if (this.enemies) {
      for (const e of this.enemies) {
        if (!e.spr?.active || e.dying || e._dormant) continue;
        const d = Phaser.Math.Distance.Between(abigail.spr.x, abigail.spr.y, e.spr.x, e.spr.y);
        if (d < 120 && d < nearDist) { nearDist = d; nearest = e; }
      }
    }

    if (!nearest) { this._hideScoutPanel(); return; }

    const data = SCOUT_DATA[nearest.type];
    if (!data) { this._hideScoutPanel(); return; }

    // Build panel lazily
    const { W, H } = CFG;
    if (!this._scoutPanel) {
      this._scoutPanel = {
        bg:   this._h(this.add.graphics().setDepth(105)),
        name: this._h(this.add.text(0, 0, '', { fontFamily:'monospace', fontSize:'11px', color:'#ffddaa', stroke:'#000', strokeThickness:2 }).setDepth(106)),
        atk:  this._h(this.add.text(0, 0, '', { fontFamily:'monospace', fontSize:'9px',  color:'#ff9966' }).setDepth(106)),
        weak: this._h(this.add.text(0, 0, '', { fontFamily:'monospace', fontSize:'9px',  color:'#88ff88' }).setDepth(106)),
        note: this._h(this.add.text(0, 0, '', { fontFamily:'monospace', fontSize:'8px',  color:'#ddccff', wordWrap:{ width: 160 } }).setDepth(106)),
        visible: false,
      };
    }

    const p = this._scoutPanel;
    const px = W - 14, py = H / 2 - 40;
    const nameStr = nearest.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    p.bg.clear();
    p.bg.fillStyle(0x000000, 0.75); p.bg.fillRoundedRect(px - 178, py - 6, 178, 90, 6);
    p.bg.lineStyle(1, 0x886633, 0.8); p.bg.strokeRoundedRect(px - 178, py - 6, 178, 90, 6);

    p.name.setText('>> ' + nameStr).setPosition(px - 172, py);
    p.atk.setText('ATK: ' + data.atk).setPosition(px - 172, py + 16);
    p.weak.setText('WEAK: ' + data.weak).setPosition(px - 172, py + 30);
    p.note.setText(data.note).setPosition(px - 172, py + 46);

    if (!p.visible) {
      p.visible = true;
      [p.bg, p.name, p.atk, p.weak, p.note].forEach(o => o.setAlpha(0).setVisible(true));
      this.tweens.add({ targets: [p.bg, p.name, p.atk, p.weak, p.note], alpha: 1, duration: 200 });
    }

    // Auto-hide timer refresh
    if (this._scoutHideTimer) this._scoutHideTimer.remove();
    this._scoutHideTimer = this.time.delayedCall(4000, () => this._hideScoutPanel());
  }

  _hideScoutPanel() {
    if (!this._scoutPanel || !this._scoutPanel.visible) return;
    this._scoutPanel.visible = false;
    const objs = [this._scoutPanel.bg, this._scoutPanel.name, this._scoutPanel.atk, this._scoutPanel.weak, this._scoutPanel.note];
    this.tweens.add({ targets: objs, alpha: 0, duration: 250, onComplete: () => objs.forEach(o => o.setVisible(false)) });
  }

  updateSpikeTraps() {
    if (!this.spikeTraps || !this.spikeTraps.length || !this.enemies) return;
    for (let si = this.spikeTraps.length - 1; si >= 0; si--) {
      const st = this.spikeTraps[si];
      if (!st.active) { this.spikeTraps.splice(si, 1); continue; }
      for (const e of this.enemies) {
        if (e.dying || !e.spr.active) continue;
        if (Phaser.Math.Distance.Between(e.spr.x, e.spr.y, st.x, st.y) < 26) {
          // Credit the trap's builder so kill counts track correctly in HUD / game-over.
          this._hurtEnemy(e, 35, st.x, st.y, 0xff2233, st._builder || null);
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
      // Food drops scale down each day so mid-game survival stays tense.
      // Hardcore additionally multiplies every roll by hc.resourceDropMult (0.75).
      const rdm      = this.hc.resourceDropMult;
      const foodMult = Math.max(0.35, 1 - 0.12 * ((this.dayNum || 1) - 1));
      // All enemies drop food sometimes
      if (Math.random() < 0.4 * foodMult * rdm) drops.push('item_food');
      // Type-specific drops via lookup table (flags: 0=plain rdm, 1=foodMult*rdm, 2=rare/hc-blocked)
      const _loot = ENEMY_LOOT[enemyType];
      if (_loot) {
        for (const [item, chance, flags] of _loot) {
          if (flags === 2 && this.hc.rareDropsBossOnly) continue;
          if (Math.random() < chance * (flags === 1 ? foodMult : 1) * rdm) drops.push(item);
        }
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
        if (item.itemType === 'ammo') {
          if (player.charData.id === 'gunslinger') {
            const maxReserve = 40 - player.ammo;
            player.reserveAmmo = Math.min(maxReserve, player.reserveAmmo + 3);
            this._log(`${player.charData.player} picked up ammo  reserve=${player.reserveAmmo}`, 'player');
            label = '+3 Ammo';
          } else {
            this.teamAmmoPool += 3;
            this._log(`${player.charData.player} picked up ammo → team pool  pool=${this.teamAmmoPool}`, 'player');
            label = '+3 Ammo (Team)';
          }
          this._hudDirty = true;
        } else if (item.itemType === 'food') {
          if (player.hp < player.maxHp) {
            const _foodHeal = Math.max(1, Math.round(15 * this.hc.foodHealMult));
            player.hp = Math.min(player.maxHp, player.hp + _foodHeal);
            this._log(`${player.charData.player} picked up food  hp=${player.hp}/${player.maxHp}`, 'player');
            label = '+' + _foodHeal + ' HP';
          } else {
            player.inv.food = (player.inv.food || 0) + 1;
            this.resourcesGathered++;
            this._log(`${player.charData.player} stored food (full HP)  inv=${JSON.stringify(player.inv)}`, 'player');
            label = '+1 Food';
          }
        } else {
          player.inv[item.itemType] = (player.inv[item.itemType] || 0) + 1;
          this.resourcesGathered++;
          this._log(`${player.charData.player} +1 ${item.itemType}  inv=${JSON.stringify(player.inv)}`, 'player');
          label = '+1 ' + item.itemType.charAt(0).toUpperCase() + item.itemType.slice(1);
        }
        SFX._play(720, 'sine', 0.1, 0.08);
        this._floatPickup(item.x, item.y, label);
        item.destroy();
      };
      this.physics.add.overlap(this.p1.spr, item, () => { if(item.active) pickupCb(this.p1.spr); });
      if (this.p2) this.physics.add.overlap(this.p2.spr, item, () => { if(item.active) pickupCb(this.p2.spr); });
      // Despawn after a while
      this.time.delayedCall(CFG.ITEM_DESPAWN_MS, () => { if(item.active) { this.tweens.add({ targets:item, alpha:0, duration:500, onComplete:()=>item.destroy() }); }});
    });
  }

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
      for (const loc of this._structureLocs) {
        const type = biomeGuardType[loc.biome] || 'wolf';
        const t = { wolf:      {key:'wolf',      hp:70, speed:95, dmg:10,baseScale:2.0,w:20,h:12},
                    rat:       {key:'rat',       hp:38, speed:145,dmg:7, baseScale:1.6,w:15,h:9 },
                    bear:      {key:'bear',      hp:160,speed:58, dmg:20,baseScale:2.4,w:24,h:18},
                    bog_lurker:{key:'bog_lurker',hp:65, speed:60, dmg:14,baseScale:1.8,w:20,h:14},
                    dust_hound:{key:'dust_hound',hp:35, speed:125,dmg:6, baseScale:1.3,w:18,h:12,atkInterval:1500} }[type];
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
            hp: Math.floor(t.hp * sizeMult * guardDiff), maxHp: Math.floor(t.hp * sizeMult * guardDiff),
            speed: t.speed * sizeMult * guardSpeed, dmg: Math.max(1, Math.floor(t.dmg * sizeMult * guardDiff)),
            attackTimer: 0, wanderTimer: 0,
            aggroRange: aggroR, attackRange: (30 + t.w / 2) * sizeMult,
            sizeMult, structureGuard: true,
          };
          this._startDormantIfFar(eGuard, ex, ey);
          this.enemies.push(eGuard);
        }
      }
    }

    // Spawn guards around the Radio Tower (ruins biome spiders, aggressive patrol)
    if (this.radioTower) {
      const t = { key:'spider_ruins', hp:55, speed:85, dmg:9, baseScale:1.8, w:18, h:12 };
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
          hp: Math.floor(t.hp * sizeMult * towerDiff), maxHp: Math.floor(t.hp * sizeMult * towerDiff),
          speed: t.speed * sizeMult * towerSpeed, dmg: Math.max(1, Math.floor(t.dmg * sizeMult * towerDiff)),
          attackTimer: 0, wanderTimer: 0,
          aggroRange: 260, attackRange: 35 * sizeMult,
          sizeMult, towerGuard: true,
        };
        this._startDormantIfFar(eGuard, ex, ey);
        this.enemies.push(eGuard);
      }
      this._log(`spawnEnemies: spawned ${count} tower guards around radio tower`, 'world');
    }
  }

  // ── POND GENERATION ──────────────────────────────────────────
  // BFS blob growth: organic irregular shapes with deep center + shallow edges.
  // Tundra ponds become ice tiles (passable, slippery); others have deep impassable center.
  _buildPonds(stx, sty) {
    const { TILE, SAFE_R, MAP_W, MAP_H, POND_SPECS, PLACEMENT } = CFG;
    const _rng = _worldRng;
    const _ri = (a, b) => a + Math.floor(_rng() * (b - a + 1)); // seeded randInt
    let _pondPlaced = 0, _pondSkipCenter = 0, _pondSkipBlob = 0;
    // Build spec list from CFG.POND_SPECS — config-driven
    const specs = Object.entries(POND_SPECS).flatMap(([b, n]) => Array.from({length: n}, () => b));
    for (const biome of specs) {
      const isIce = biome === 'tundra';
      const realBiome = biome === 'grass_near' ? 'grass' : biome;
      // Pick center tile in correct biome
      let cx = -1, cy = -1;
      for (let attempt = 0; attempt < 120; attempt++) {
        let tx, ty;
        if (biome === 'grass_near') {
          // Place in a ring 12–22 tiles from spawn — use seeded RNG
          const angle = _rng() * Math.PI * 2;
          const dist  = 12 + _rng() * 10;
          tx = Phaser.Math.Clamp(Math.round(stx + Math.cos(angle) * dist), 8, MAP_W - 8);
          ty = Phaser.Math.Clamp(Math.round(sty + Math.sin(angle) * dist), 8, MAP_H - 8);
        } else {
          tx = _ri(8, MAP_W - 8);
          ty = _ri(8, MAP_H - 8);
        }
        if (getBiome(tx, ty) !== realBiome) continue;
        const excl = biome === 'grass_near' ? SAFE_R : SAFE_R + PLACEMENT.POND_EXCL;
        if (this._isBlockedForPlacement(tx, ty, excl, stx, sty)) continue;
        cx = tx; cy = ty; break;
      }
      if (cx < 0) { _pondSkipCenter++; continue; }
      // BFS blob expansion
      const tileSet = new Set();
      const visited = new Set();
      const queue = [[cx, cy, 1.0]];
      while (queue.length) {
        const [tx, ty, prob] = queue.shift();
        const key = `${tx},${ty}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (_rng() > prob) continue;
        tileSet.add(key);
        [[tx-1,ty],[tx+1,ty],[tx,ty-1],[tx,ty+1],
         [tx-1,ty-1],[tx+1,ty+1],[tx-1,ty+1],[tx+1,ty-1]]
          .forEach(([nx, ny]) => {
            const decay = (nx !== tx && ny !== ty) ? 0.65 : 0.70;
            if (!visited.has(`${nx},${ny}`) && prob * decay > 0.06) {
              queue.push([nx, ny, prob * decay]);
            }
          });
      }
      // Fill holes: non-water cells with 3+ orthogonal water neighbors get pulled in
      const toFill = [];
      visited.forEach(key => {
        if (tileSet.has(key)) return;
        const [fx, fy] = key.split(',').map(Number);
        const wn = [[fx-1,fy],[fx+1,fy],[fx,fy-1],[fx,fy+1]]
          .filter(([nx,ny]) => tileSet.has(`${nx},${ny}`)).length;
        if (wn >= 3) toFill.push(key);
      });
      toFill.forEach(k => tileSet.add(k));
      // Erosion: strip tiles with <3 orthogonal water neighbors to kill arms/filaments
      for (let pass = 0; pass < 2; pass++) {
        const toErode = [];
        tileSet.forEach(key => {
          const [ex, ey] = key.split(',').map(Number);
          const wn = [[ex-1,ey],[ex+1,ey],[ex,ey-1],[ex,ey+1]]
            .filter(([nx,ny]) => tileSet.has(`${nx},${ny}`)).length;
          if (wn < 3) toErode.push(key);
        });
        toErode.forEach(k => tileSet.delete(k));
        if (toErode.length === 0) break;
      }
      // Discard blobs smaller than minimum — prevents isolated puddles
      if (tileSet.size < (PLACEMENT.POND_MIN_SIZE || 12)) { _pondSkipBlob++; continue; }
      // Classify and place tiles
      tileSet.forEach(key => {
        const [tx, ty] = key.split(',').map(Number);
        if (tx < 1 || ty < 1 || tx >= CFG.MAP_W - 1 || ty >= CFG.MAP_H - 1) return;
        const x = tx * TILE, y = ty * TILE;
        const neighbors = [[tx-1,ty],[tx+1,ty],[tx,ty-1],[tx,ty+1]];
        const neighborCount = neighbors.filter(([nx, ny]) => tileSet.has(`${nx},${ny}`)).length;
        // Deep water only when fully surrounded (no dry-ground border)
        const isDeep = !isIce && neighborCount === 4;
        if (isIce) {
          // Visual only — detection via _iceMap per-frame (see applyTerrainEffects)
          const tile = this._w(this.add.image(x, y, 'water_ice').setOrigin(0.5).setDepth(0.6).setAlpha(0.75));
          if (this.hudCam) this.hudCam.ignore(tile);
          this.iceTiles.push(tile);
          this._iceMap[tx + ty * CFG.MAP_W] = 1;
        } else if (isDeep) {
          const tile = this.obstacles.create(x, y, 'water_deep').setDepth(0.6).setAlpha(1);
          if (this.hudCam) this.hudCam.ignore(tile);
          tile.refreshBody();
          this.deepWaterTiles.push(tile);
        } else {
          // Pure visual ground tile — no physics body. Detection via _waterMap per-frame.
          const tile = this._w(this.add.image(x, y, 'water_shallow').setOrigin(0).setDepth(0.75));
          if (this.hudCam) this.hudCam.ignore(tile);
          this.waterTiles.push(tile);
          this._waterMap[tx + ty * CFG.MAP_W] = 1;
        }
      });
      _pondPlaced++;
      this._log(`pond ${biome} placed  tiles=${tileSet.size} cx=${cx},cy=${cy}`, 'world');
    }
    this._log(`_buildPonds done  placed=${_pondPlaced} skip_center=${_pondSkipCenter} skip_blob=${_pondSkipBlob}  water=${this.waterTiles.length} ice=${this.iceTiles.length} deep=${this.deepWaterTiles.length}`, 'world');
  }

  // ── LAKE GENERATION ──────────────────────────────────────────────────────
  // Lakes are larger than ponds (60–120 tiles), appear in varied biomes, and
  // each lake hosts a water-den that respawns water_lurker enemies.
  _buildLakes(stx, sty) {
    const { TILE, SAFE_R, MAP_W, MAP_H, LAKE_SPECS, PLACEMENT } = CFG;
    const _rng = _worldRng;
    const _ri = (a, b) => a + Math.floor(_rng() * (b - a + 1));
    // Rebuilt fresh each run — previously `this.waterDens || []` reused the
    // prior run's array, leaking stale den references across restarts.
    this.waterDens = [];
    this.lakeCenters = []; // river endpoint pool — populated as lakes succeed
    this.pois = this.pois || [];
    let _lakePlaced = 0, _lakeSkipCenter = 0, _lakeSkipBlob = 0;
    for (const biome of LAKE_SPECS) {
      // Pick a center tile — lakes stay farther from spawn than ponds
      let cx = -1, cy = -1;
      for (let attempt = 0; attempt < 150; attempt++) {
        const tx = _ri(12, MAP_W - 12);
        const ty = _ri(12, MAP_H - 12);
        if (getBiome(tx, ty) !== biome) continue;
        const spawnExcl = biome === 'grass' ? SAFE_R + 8 : SAFE_R + PLACEMENT.LAKE_EXCL;
        if (this._isBlockedForPlacement(tx, ty, spawnExcl, stx, sty)) continue;
        cx = tx; cy = ty; break;
      }
      if (cx < 0) { _lakeSkipCenter++; this._log(`lake ${biome} no center found – skipped`, 'world'); continue; }

      // BFS blob — slower decay (0.82) grows larger blobs than ponds (0.70)
      const tileSet = new Set();
      const visited = new Set();
      const queue = [[cx, cy, 1.0]];
      while (queue.length) {
        const [tx, ty, prob] = queue.shift();
        const key = `${tx},${ty}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (_rng() > prob) continue;
        tileSet.add(key);
        [[tx-1,ty],[tx+1,ty],[tx,ty-1],[tx,ty+1],[tx-1,ty-1],[tx+1,ty+1],[tx-1,ty+1],[tx+1,ty-1]]
          .forEach(([nx, ny]) => {
            if (!visited.has(`${nx},${ny}`) && prob * 0.82 > 0.05) {
              queue.push([nx, ny, prob * 0.82]);
            }
          });
      }
      // Fill holes: non-water cells with 3+ orthogonal water neighbors get pulled in
      const toFillL = [];
      visited.forEach(key => {
        if (tileSet.has(key)) return;
        const [fx, fy] = key.split(',').map(Number);
        const wn = [[fx-1,fy],[fx+1,fy],[fx,fy-1],[fx,fy+1]]
          .filter(([nx,ny]) => tileSet.has(`${nx},${ny}`)).length;
        if (wn >= 3) toFillL.push(key);
      });
      toFillL.forEach(k => tileSet.add(k));
      // Erosion: strip tiles with <3 orthogonal water neighbors to kill arms/filaments
      for (let pass = 0; pass < 2; pass++) {
        const toErodeL = [];
        tileSet.forEach(key => {
          const [ex, ey] = key.split(',').map(Number);
          const wn = [[ex-1,ey],[ex+1,ey],[ex,ey-1],[ex,ey+1]]
            .filter(([nx,ny]) => tileSet.has(`${nx},${ny}`)).length;
          if (wn < 3) toErodeL.push(key);
        });
        toErodeL.forEach(k => tileSet.delete(k));
        if (toErodeL.length === 0) break;
      }
      // Lakes need to be substantial — skip tiny results
      if (tileSet.size < (PLACEMENT.LAKE_MIN_SIZE || 25)) { _lakeSkipBlob++; this._log(`lake ${biome} blob too small (${tileSet.size}) – skipped`, 'world'); continue; }

      // Classify deep tiles: fully surrounded by water on all 4 orthogonal sides
      const deepLakeTiles = new Set();
      if (biome !== 'tundra') {
        tileSet.forEach(key => {
          const [tx, ty] = key.split(',').map(Number);
          if ([[tx-1,ty],[tx+1,ty],[tx,ty-1],[tx,ty+1]]
              .every(([nx,ny]) => tileSet.has(`${nx},${ny}`))) {
            deepLakeTiles.add(key);
          }
        });
      }

      // Place tiles — deep center uses water_deep (traversable); shallow edges stay water_shallow
      tileSet.forEach(key => {
        const [tx, ty] = key.split(',').map(Number);
        if (tx < 1 || ty < 1 || tx >= CFG.MAP_W - 1 || ty >= CFG.MAP_H - 1) return;
        const x = tx * TILE, y = ty * TILE;
        if (biome === 'tundra') {
          // Tundra lakes become ice — visual only, detection via _iceMap per-frame
          const tile = this._w(this.add.image(x, y, 'water_ice').setOrigin(0.5).setDepth(0.6).setAlpha(0.75));
          if (this.hudCam) this.hudCam.ignore(tile);
          this.iceTiles.push(tile);
          this._iceMap[tx + ty * CFG.MAP_W] = 1;
        } else if (deepLakeTiles.has(key)) {
          // Deep center — visually dark, traversable (no physics obstacle)
          const tile = this._w(this.add.image(x, y, 'water_deep').setOrigin(0).setDepth(0.75));
          if (this.hudCam) this.hudCam.ignore(tile);
          this.waterTiles.push(tile);
          this._waterMap[tx + ty * CFG.MAP_W] = 1;
        } else {
          const tile = this._w(this.add.image(x, y, 'water_shallow').setOrigin(0).setDepth(0.75));
          if (this.hudCam) this.hudCam.ignore(tile);
          this.waterTiles.push(tile);
          this._waterMap[tx + ty * CFG.MAP_W] = 1;
        }
      });

      // Place a water den at the deep tile nearest the lake center (skip tundra — ice, not water dens)
      if (biome !== 'tundra') {
        let denTx = cx, denTy = cy;
        if (deepLakeTiles.size > 0) {
          let bestDist = Infinity;
          deepLakeTiles.forEach(key => {
            const [dtx, dty] = key.split(',').map(Number);
            const d = (dtx - cx) ** 2 + (dty - cy) ** 2;
            if (d < bestDist) { bestDist = d; denTx = dtx; denTy = dty; }
          });
        }
        const denX = denTx * TILE, denY = denTy * TILE;
        const spr = this._w(this.add.image(denX, denY, 'enemy_den')
          .setScale(1.6).setDepth(5).setTint(0x226688));
        const lbl = this._w(this.add.text(denX, denY - 20, 'WATER DEN', {
          fontFamily:'monospace', fontSize:'8px', color:'#44aacc',
          stroke:'#000', strokeThickness:2
        }).setOrigin(0.5).setDepth(7));
        if (this.hudCam) { this.hudCam.ignore(spr); this.hudCam.ignore(lbl); }
        this.waterDens.push({ x: denX, y: denY, respawnTimer: 0, tileSet });
        this.pois.push({ type:'den', tx: cx, ty: cy, spr });

        // Spawn 2 water_lurkers lurking inside this lake at world start.
        // Attach _den + home so they leash back toward the lake after an ambush chase ends.
        const _thisWaterDen = this.waterDens[this.waterDens.length - 1];
        for (let i = 0; i < 2; i++) {
          const keys = Array.from(tileSet);
          const rk = keys[Phaser.Math.Between(0, keys.length - 1)];
          const [ltx, lty] = rk.split(',').map(Number);
          const e = this._spawnWaterLurker(ltx * TILE, lty * TILE);
          e._den = _thisWaterDen;
          e.home = { x: denX, y: denY };
        }
      }
      this.lakeCenters.push({ tx: cx, ty: cy });
      _lakePlaced++;
      this._log(`lake ${biome} placed  tiles=${tileSet.size} deep=${deepLakeTiles.size} cx=${cx},cy=${cy}  den=${biome !== 'tundra'}`, 'world');
    }
    this._log(`_buildLakes done  placed=${_lakePlaced} skip_center=${_lakeSkipCenter} skip_blob=${_lakeSkipBlob}  water=${this.waterTiles.length} ice=${this.iceTiles.length} dens=${this.waterDens.length}`, 'world');
  }

  // ── RIVER GENERATION ─────────────────────────────────────────────────────
  // Places 3–5 organic rivers per map. Each river connects two endpoints (lake
  // centers or map-edge entry points) via a jittered waypoint path, then BFS-
  // widens it to 3–7 tiles. All river tiles are shallow water — passable but
  // slow — and are automatically excluded from the terrain overlap cleanup pass
  // (which reads _waterMap) so trees/rocks on river tiles are culled for free.
  _buildRivers(stx, sty) {
    const { TILE, SAFE_R, MAP_W, MAP_H } = CFG;
    const RIVER_COUNT     = CFG.RIVER_COUNT     ?? 4;
    const RIVER_WANDER    = CFG.RIVER_WANDER    ?? 0.50;
    const RIVER_WIDTH_MIN = CFG.RIVER_WIDTH_MIN ?? 1;
    const RIVER_WIDTH_MAX = CFG.RIVER_WIDTH_MAX ?? 3;
    const _rng = _worldRng;
    const _ri  = (a, b) => a + Math.floor(_rng() * (b - a + 1));
    const _rf  = (a, b) => a + _rng() * (b - a);

    this.rivers = [];

    // ── EXCLUSION ZONES ──────────────────────────────────────────────────────
    // Rivers skip tiles inside the spawn grassland and the ruins city so they
    // don't carve through the starting area or the abandoned city.
    const SPAWN_EXCL = SAFE_R + 22; // 32 tiles — covers the starting grassland biome
    const CITY_EXCL  = 42;          // covers the full ruins city footprint + buffer
    const _inExcl = (tx, ty) => {
      const dsx = tx - stx, dsy = ty - sty;
      if (dsx * dsx + dsy * dsy < SPAWN_EXCL * SPAWN_EXCL) return true;
      if (this._cityCenter) {
        const dcx = tx - this._cityCenter.tx, dcy = ty - this._cityCenter.ty;
        if (dcx * dcx + dcy * dcy < CITY_EXCL * CITY_EXCL) return true;
      }
      return false;
    };

    // ── ENDPOINT POOL ───────────────────────────────────────────────────────
    // Lake centers (populated by _buildLakes above); exclude any that fall in a zone
    const lakePts = (this.lakeCenters || [])
      .filter(lc => !_inExcl(lc.tx, lc.ty))
      .map(lc => ({ tx: lc.tx, ty: lc.ty, isEdge: false }));

    // Map-edge entry points — 4 per side, seeded positions for variety.
    // Rivers that start/end here look like they flow in from off-screen.
    const MARGIN = 4;
    const edgePts = [];
    for (let i = 0; i < 4; i++) {
      edgePts.push({ tx: _ri(MARGIN, MAP_W - MARGIN), ty: MARGIN,         isEdge: true }); // north
      edgePts.push({ tx: _ri(MARGIN, MAP_W - MARGIN), ty: MAP_H - MARGIN, isEdge: true }); // south
      edgePts.push({ tx: MARGIN,                      ty: _ri(MARGIN, MAP_H - MARGIN), isEdge: true }); // west
      edgePts.push({ tx: MAP_W - MARGIN,              ty: _ri(MARGIN, MAP_H - MARGIN), isEdge: true }); // east
    }

    const allPts = [...lakePts, ...edgePts];
    if (allPts.length < 2) {
      this._log('_buildRivers skipped — not enough endpoints', 'world');
      return;
    }

    let _placed = 0, _skipped = 0;
    const usedPairs = new Set();

    for (let attempt = 0; attempt < RIVER_COUNT * 6 && _placed < RIVER_COUNT; attempt++) {
      // ── PICK TWO ENDPOINTS ───────────────────────────────────────────────
      const fromIdx = _ri(0, allPts.length - 1);
      const fromPt  = allPts[fromIdx];

      const candidates = [];
      for (let i = 0; i < allPts.length; i++) {
        if (i === fromIdx) continue;
        const tp = allPts[i];
        const dx = tp.tx - fromPt.tx, dy = tp.ty - fromPt.ty;
        if (dx*dx + dy*dy < 20*20) continue; // must be ≥20 tiles apart
        const pairKey = Math.min(fromIdx, i) + ':' + Math.max(fromIdx, i);
        if (usedPairs.has(pairKey)) continue;
        candidates.push({ idx: i, pt: tp });
      }
      if (candidates.length === 0) { _skipped++; continue; }

      const pick    = candidates[_ri(0, candidates.length - 1)];
      const toIdx   = pick.idx;
      const toPt    = pick.pt;
      usedPairs.add(Math.min(fromIdx, toIdx) + ':' + Math.max(fromIdx, toIdx));

      // ── FIND ACTUAL START/END TILES ──────────────────────────────────────
      // For lake endpoints, walk outward from the center until we exit the water.
      // Edge endpoints are already at the map border — use as-is.
      const findEdgeTile = (pt, targetPt) => {
        if (pt.isEdge) return { tx: pt.tx, ty: pt.ty };
        const dx = Math.sign(targetPt.tx - pt.tx), dy = Math.sign(targetPt.ty - pt.ty);
        for (let step = 1; step < 30; step++) {
          const ex = pt.tx + dx * step, ey = pt.ty + dy * step;
          if (ex < 1 || ey < 1 || ex >= MAP_W - 1 || ey >= MAP_H - 1) break;
          if (!this._waterMap[ex + ey * MAP_W]) return { tx: ex, ty: ey };
        }
        return { tx: pt.tx, ty: pt.ty };
      };

      const startTile = findEdgeTile(fromPt, toPt);
      const endTile   = findEdgeTile(toPt, fromPt);

      if (_inExcl(startTile.tx, startTile.ty) || _inExcl(endTile.tx, endTile.ty)) {
        _skipped++; continue;
      }

      // ── JITTERED WAYPOINTS ───────────────────────────────────────────────
      // Divide the path into segments; jitter each intermediate waypoint
      // perpendicularly for an organic meander.
      const sx0 = startTile.tx, sy0 = startTile.ty;
      const ex0 = endTile.tx,   ey0 = endTile.ty;
      const totalDist = Math.sqrt((ex0 - sx0) ** 2 + (ey0 - sy0) ** 2);
      const numSeg    = Math.max(3, Math.floor(totalDist / 10));

      const mainDx  = ex0 - sx0, mainDy = ey0 - sy0;
      const mainLen = Math.sqrt(mainDx * mainDx + mainDy * mainDy) || 1;
      const perpX   = -mainDy / mainLen; // unit perpendicular vector
      const perpY   =  mainDx / mainLen;

      const waypoints = [{ tx: sx0, ty: sy0 }];
      for (let w = 1; w < numSeg; w++) {
        const t   = w / numSeg;
        const bx  = sx0 + mainDx * t;
        const by  = sy0 + mainDy * t;
        const amp = (totalDist / numSeg) * 0.7;
        const jit = _rf(-amp, amp);
        waypoints.push({
          tx: Phaser.Math.Clamp(Math.round(bx + perpX * jit), 2, MAP_W - 3),
          ty: Phaser.Math.Clamp(Math.round(by + perpY * jit), 2, MAP_H - 3),
        });
      }
      waypoints.push({ tx: ex0, ty: ey0 });

      // ── WALK CENTERLINE ──────────────────────────────────────────────────
      // Step tile-by-tile between waypoints; RIVER_WANDER adds diagonal steps
      // for extra wobble. Mountain tiles (_solidTileSet) are simply skipped so
      // the river visually gaps at rock faces — it doesn't tunnel through them.
      const centerline = new Set();
      for (let wi = 0; wi < waypoints.length - 1; wi++) {
        let cx = waypoints[wi].tx, cy = waypoints[wi].ty;
        const nx = waypoints[wi + 1].tx, ny = waypoints[wi + 1].ty;
        let safety = 0;
        while ((cx !== nx || cy !== ny) && ++safety < 1200) {
          const key = cx + ',' + cy;
          if ((!this._solidTileSet || !this._solidTileSet.has(key)) && !_inExcl(cx, cy)) centerline.add(key);
          const remX = nx - cx, remY = ny - cy;
          let stepX = 0, stepY = 0;
          if (Math.abs(remX) >= Math.abs(remY)) {
            stepX = Math.sign(remX);
            if (_rng() < RIVER_WANDER && remY !== 0) stepY = Math.sign(remY);
          } else {
            stepY = Math.sign(remY);
            if (_rng() < RIVER_WANDER && remX !== 0) stepX = Math.sign(remX);
          }
          if (stepX === 0 && stepY === 0) break;
          cx = Phaser.Math.Clamp(cx + stepX, 1, MAP_W - 2);
          cy = Phaser.Math.Clamp(cy + stepY, 1, MAP_H - 2);
        }
      }

      if (centerline.size < 10) { _skipped++; continue; }

      // ── BFS SPREAD ───────────────────────────────────────────────────────
      // Widen the centerline by `width` tiles using a circular spread.
      // Mountain tiles are never included — the river stops at rock faces.
      const width = _ri(RIVER_WIDTH_MIN, RIVER_WIDTH_MAX);
      const riverTiles = new Set(centerline);
      const r2 = (width + 0.5) * (width + 0.5); // circular radius check
      for (const key of centerline) {
        const [ctxN, ctyN] = key.split(',').map(Number);
        for (let dx = -width; dx <= width; dx++) {
          for (let dy = -width; dy <= width; dy++) {
            if (dx === 0 && dy === 0) continue;
            if (dx * dx + dy * dy > r2) continue; // circular cross-section
            const nx = ctxN + dx, ny = ctyN + dy;
            if (nx < 1 || ny < 1 || nx >= MAP_W - 1 || ny >= MAP_H - 1) continue;
            const nk = nx + ',' + ny;
            if (riverTiles.has(nk)) continue;
            if (this._solidTileSet && this._solidTileSet.has(nk)) continue;
            if (_inExcl(nx, ny)) continue;
            riverTiles.add(nk);
          }
        }
      }

      // ── PLACE TILES ──────────────────────────────────────────────────────
      let tilesPlaced = 0;
      riverTiles.forEach(key => {
        const [rtx, rty] = key.split(',').map(Number);
        if (rtx < 1 || rty < 1 || rtx >= MAP_W - 1 || rty >= MAP_H - 1) return;
        if (_inExcl(rtx, rty)) return;
        if (this._waterMap[rtx + rty * MAP_W]) return; // already water — skip
        const tile = this._w(this.add.image(rtx * TILE, rty * TILE, 'water_river').setOrigin(0).setDepth(0.75));
        if (this.hudCam) this.hudCam.ignore(tile);
        this.waterTiles.push(tile);
        this._waterMap[rtx + rty * MAP_W] = 1;
        tilesPlaced++;
      });

      this.rivers.push({ tiles: riverTiles, from: fromPt, to: toPt, length: centerline.size, width });
      _placed++;
      this._log(`river placed  tiles=${tilesPlaced}  from=(${fromPt.tx},${fromPt.ty})  to=(${toPt.tx},${toPt.ty})  width=${width * 2 + 1}  centerline=${centerline.size}`, 'world');
    }

    this._log(`_buildRivers done  placed=${_placed}  skipped=${_skipped}  total_water=${this.waterTiles.length}`, 'world');
  }

  _spawnWaterLurker(x, y) {
    const sizeMult = Phaser.Math.FloatBetween(1.0, 1.4);
    const sc = 2.0 * sizeMult;
    const D = this._diffMult();
    const hp  = Math.floor(75 * sizeMult * D);
    const dmg = Math.max(1, Math.floor(14 * sizeMult * D));
    const spd = 52 * this._diffSpeedMult();
    const spr = this.physics.add.image(x, y, 'water_lurker').setScale(sc).setDepth(8);
    spr.setCollideWorldBounds(true);
    spr.body.setSize(22, 12);
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
  }

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
        const atkR = (30 + t.w / 2) * sizeMult;
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
  }

  // Day-based difficulty multiplier.
  // Survival: base 1.0, +10% per day, cap 3.0× on day 21+.
  // Hardcore: base 1.15, +15% per day, cap 3.5× (see this.hc).
  // Applies to enemy HP, damage, speed, and attack rate at spawn time.
  _diffMult() {
    const hc = this.hc || { diffBase: 1.0, diffRamp: 0.10, diffCap: 3.0 };
    const day = Math.max(1, this.dayNum || 1);
    const rawDayScale = hc.diffBase + (day - 1) * hc.diffRamp;
    // Soft post-cap: once rawDayScale hits the cap, keep adding ~1/3 of the
    // daily ramp so late-game tension never flatlines. Prevents the
    // day-21+ plateau the audit flagged without making numbers runaway.
    const capped = Math.min(hc.diffCap, rawDayScale);
    const overflow = Math.max(0, rawDayScale - hc.diffCap) * 0.33;
    const dayScale = capped + overflow;
    const relicScale = 1 + (this.relicsDeposited || 0) * 0.2;
    return dayScale * relicScale;
  }

  // Speed-specific multiplier — hard-capped at 2.0× so late-game enemies
  // never permanently outrun the player. HP and damage keep scaling via _diffMult().
  _diffSpeedMult() {
    return Math.min(2.0, this._diffMult());
  }

  _relicPressure() {
    const d = this.relicsDeposited || 0;
    return {
      speedMult: 1 + d * 0.18,
      dmgMult:   1 + d * 0.15,
      aggroMult: 1 + d * 0.25,
    };
  }

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
  }

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
        const atkR = (30 + t.w/2) * sizeMult;
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, atkInterval, type:key, attackTimer:0, wanderTimer:Phaser.Math.Between(0,2000), aggroRange:aggroR, attackRange:atkR, sizeMult };
        this._startDormantIfFar(e, ex, ey);
        this.enemies.push(e);
      }
    });
  }

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
      this._log('Wave ' + this.waveNum + ' day=' + this.dayNum + ' diff=' + this._diffMult().toFixed(1) + 'x  speed=' + this._diffSpeedMult().toFixed(1) + 'x  w=' + w + ' r=' + r + ' b=' + b, 'world');
      this.hint('Wave ' + this.waveNum + '! Enemies approaching from the wastes!', 3000);
      SFX._play(150, 'triangle', 0.55, 0.12, 'drop');
    }
  }

  updateHarvest(delta) {
    if (!this.obstacles || !this.harvestGfx) return;
    // Only clear when a donut was drawn last frame; avoids per-frame GL work when
    // nobody is harvesting. We'll set _harvestDrewThisFrame to true below if we draw.
    if (this._harvestDrewLastFrame) this.harvestGfx.clear();
    let _harvestDrewThisFrame = false;

    const HARVEST_RANGE = 72; // px
    const HARVEST_TIMES = { architect: 1500, knight: 2500, gunslinger: 4000 };
    const players = [this.p1, this.p2].filter(p => p && !p.isDowned && !p.isSleeping && p.hp > 0);

    for (const player of players) {
      // On mobile the keyboard key is never held; use the touch USE button's tracked down state instead
      const touchHeld = this._touchActive && this._tcBtns && this._tcBtns.interact.down;
      const keyHeld = player === this.p1
        ? (this.hotkeys.p1use.isDown || touchHeld)
        : (this.hotkeys.p2use ? this.hotkeys.p2use.isDown : false);

      // Find nearest tree within range. Throttled: full scan at most every
      // 200ms per player, otherwise re-validate the cached tree. This avoids
      // iterating all ~300 obstacles every frame while the harvest key is held.
      let nearestTree = null, nearDist = Infinity;
      if (keyHeld && this.obstacles) {
        player._treeScanCd = (player._treeScanCd || 0) - delta;
        const cached = player._cachedTree;
        if (cached && cached.active && cached.isTree) {
          const cdx = player.spr.x - cached.x, cdy = player.spr.y - cached.y;
          const cd2 = cdx * cdx + cdy * cdy;
          if (cd2 < HARVEST_RANGE * HARVEST_RANGE) {
            nearestTree = cached;
            nearDist = Math.sqrt(cd2);
          }
        }
        if (!nearestTree || player._treeScanCd <= 0) {
          player._treeScanCd = 200;
          for (const obj of this.obstacles.getChildren()) {
            if (!obj.isTree || !obj.active) continue;
            const odx = player.spr.x - obj.x, ody = player.spr.y - obj.y;
            const od2 = odx * odx + ody * ody;
            if (od2 < HARVEST_RANGE * HARVEST_RANGE && od2 < nearDist * nearDist) {
              nearDist = Math.sqrt(od2);
              nearestTree = obj;
            }
          }
          player._cachedTree = nearestTree;
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
        // Ensure canvas is cleared before we draw — if nothing drew last frame
        // we skipped the clear at the top of updateHarvest, so lazily clear here.
        if (!this._harvestDrewLastFrame && !_harvestDrewThisFrame) this.harvestGfx.clear();
        _harvestDrewThisFrame = true;
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
              SFX._play(720, 'sine', 0.1, 0.08);
              this._floatPickup(item.x, item.y, '+1 Wood');
              if (!this._ctx.firstHarvest) {
                this._ctx.firstHarvest = true;
                this._tutTrigger('gather');
                if (this._tutShown?.has('gather')) this.hint('Resources collected! Press Q to Craft — build Walls and more.', 6000);
              }
              item.destroy();
            };
            this.physics.add.overlap(this.p1.spr, item, () => pickupCb(this.p1));
            if (this.p2) this.physics.add.overlap(this.p2.spr, item, () => pickupCb(this.p2));
            this.time.delayedCall(CFG.ITEM_DESPAWN_MS, () => { if (item.active) item.destroy(); });
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
    this._harvestDrewLastFrame = _harvestDrewThisFrame;
  }

  // ── Wall spatial hash ────────────────────────────────────────
  // Bucket walls by tile coord so LOS/steering/placement probes check only
  // the 3×3 tiles around a sample, not the entire builtWalls array.
  _wallBucketKey(tx, ty) { return tx + ',' + ty; }
  _addWallToBuckets(w) {
    const T = CFG.TILE;
    const tx = Math.floor(w.x / T), ty = Math.floor(w.y / T);
    const k = this._wallBucketKey(tx, ty);
    let arr = this._wallBuckets.get(k);
    if (!arr) { arr = []; this._wallBuckets.set(k, arr); }
    arr.push(w);
    w._bucketKey = k;
  }
  _removeWallFromBuckets(w) {
    if (!w._bucketKey) return;
    const arr = this._wallBuckets.get(w._bucketKey);
    if (!arr) return;
    const i = arr.indexOf(w);
    if (i !== -1) arr.splice(i, 1);
    if (arr.length === 0) this._wallBuckets.delete(w._bucketKey);
    w._bucketKey = null;
  }
  // Returns true if any active wall is within `radius` px of (x, y). Checks only
  // the 3×3 tile buckets around the sample, so this is O(1) regardless of wall count.
  _wallNearby(x, y, radius) {
    if (!this._wallBuckets || this._wallBuckets.size === 0) return false;
    const T = CFG.TILE;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    const r2 = radius * radius;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this._wallBuckets.get(this._wallBucketKey(tx + dx, ty + dy));
        if (!arr) continue;
        for (const w of arr) {
          if (!w.active) continue;
          const ddx = w.x - x, ddy = w.y - y;
          if (ddx*ddx + ddy*ddy < r2) return true;
        }
      }
    }
    return false;
  }

  // Recompute `_clusterCount` (active walls within 130px) for every wall within
  // 130px of (x, y). Called on wall placement/destruction only — the per-frame
  // AI loop reads the cached value instead of a fresh O(walls²) filter.
  _refreshWallClustersNear(x, y) {
    if (!this.builtWalls) return;
    const R = 130, R2 = R * R;
    const touched = [];
    for (const w of this.builtWalls) {
      if (!w.active) continue;
      const dx = w.x - x, dy = w.y - y;
      if (dx*dx + dy*dy < R2) touched.push(w);
    }
    for (const w of touched) {
      let c = 0;
      for (const n of this.builtWalls) {
        if (!n.active) continue;
        const dx = w.x - n.x, dy = w.y - n.y;
        if (dx*dx + dy*dy < R2) c++;
      }
      w._clusterCount = c;
    }
  }

  // ── Structure damage ─────────────────────────────────────────
  // Subtract dmg from a player-built wall/gate. Updates tint to reflect health.
  // Destroys the wall with a fade when hp reaches 0.
  damageStructure(wall, dmg) {
    if (!wall.active) return;
    wall.hp = Math.max(0, (wall.hp || 200) - dmg);
    const pct = wall.hp / (wall.maxHp || 200);
    this._log(`Wall hit  dmg=${Math.round(dmg)}  hp=${wall.hp}/${wall.maxHp || 200}`, 'combat');
    if (wall.hp <= 0) {
      const wx = wall.x, wy = wall.y;
      this._removeWallFromBuckets(wall);
      this.builtWalls = this.builtWalls.filter(w => w !== wall);
      this._refreshWallClustersNear(wx, wy);
      this._unpaintMinimapTile(wx, wy);
      if (wall._hpBg && wall._hpBg.active) wall._hpBg.destroy();
      if (wall._hpBar && wall._hpBar.active) wall._hpBar.destroy();
      this.tweens.add({ targets: wall, alpha: 0, duration: 200, onComplete: () => { if (wall.active) wall.destroy(); } });
      this.hint('Structure destroyed!', 1500);
      this._log('Wall destroyed', 'combat');
    } else if (pct < 0.25) {
      wall.setTint(0xff2200); // nearly gone — red
    } else if (pct < 0.5) {
      wall.setTint(0xff8800); // damaged — orange
    } else {
      wall.clearTint();
    }
    // D4 — draw HP bar above the wall. BG geometry is drawn once at origin; the
    // bar only refills when pct crosses a 1% step. Both Graphics objects are
    // repositioned via setPosition (cheaper than clear + fillRect each hit).
    if (wall.active && wall.hp > 0) {
      const bw = 28, bh = 4;
      if (!wall._hpBar) {
        const bg = this.add.graphics().setDepth(12);
        const bar = this.add.graphics().setDepth(13);
        if (this.hudCam) { this.hudCam.ignore(bg); this.hudCam.ignore(bar); }
        this._w(bg); this._w(bar);
        bg.fillStyle(0x220000, 0.8);
        bg.fillRect(-bw/2, -22, bw, bh);
        wall._hpBg = bg; wall._hpBar = bar; wall._lastHpStep = -1;
      }
      wall._hpBg.setPosition(wall.x, wall.y);
      const pctStep = Math.round(pct * 100);
      if (wall._lastHpStep !== pctStep) {
        wall._lastHpStep = pctStep;
        wall._hpBar.clear();
        wall._hpBar.fillStyle(pct > 0.5 ? 0x44ee22 : pct > 0.25 ? 0xffaa00 : 0xff2200, 1);
        wall._hpBar.fillRect(-bw/2, -22, Math.round(bw * pct), bh);
      }
      wall._hpBar.setPosition(wall.x, wall.y);
    }
    // D5 — night hint when wall is first attacked at night
    if (this.isNight && !this._nightWallHinted) {
      this._nightWallHinted = true;
      this.hint('\u26a0 Enemies are attacking your base!', 4000);
    }
  }

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
  }

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
      if (this._wallNearby(px, py, 24)) return false;
      return true;
    };
    // Try direct angle, then ±37°, ±75°, ±112°, ±150°, 180° until a clear heading is found
    for (const off of [0, 0.65, -0.65, 1.3, -1.3, 1.95, -1.95, 2.6, -2.6, Math.PI]) {
      const ang = baseAng + off;
      if (isHeadingClear(ang)) return { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
    }
    return { x: 0, y: 0 };
  }

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

    // HUMAN_ENEMY_TYPES hoisted to module scope so we don't reallocate per frame.
    const charmerPlayer = [this.p1, this.p2].find(
      p => p && p.charData && p.charData.id === 'charmer' && !p.isDowned && p.spr && p.spr.active
    );

    // Enable deferred-removal guard: killEnemy() splices would otherwise skip
    // the next element during this forEach.
    this._enemyIterActive = true;
    this.enemies.forEach(e => {
      if (e.dying || !e.spr.active) return;
      if (e.isBoss) return; // boss movement/attack handled by updateBoss

      // ── Dormancy: wildlife enemies far from all players sleep (no AI, no physics) ──
      // Raiders are always aggressive — never dormant. Boss already excluded above.
      if (!e.isRaider) {
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
      // charmerPlayer + HUMAN_ENEMY_TYPES are hoisted above forEach for performance
      const isHumanEnemy = HUMAN_ENEMY_TYPES.includes(e.type);
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
                  !HUMAN_ENEMY_TYPES.includes(t.type) &&
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
          const _tex = 'raider_' + e.type + _dirSuffix + (_moving ? _step : '');
          if (e._lastTexKey !== _tex) { e._lastTexKey = _tex; e.spr.setTexture('raider_atlas', _tex); }
        }
      }
    });
    this._enemyIterActive = false;
    // Drain deferred removals now that iteration is over.
    if (this._pendingEnemyRemovals && this._pendingEnemyRemovals.length) {
      for (const dead of this._pendingEnemyRemovals) {
        const _ei = this.enemies.indexOf(dead);
        if (_ei !== -1) this.enemies.splice(_ei, 1);
      }
      this._pendingEnemyRemovals.length = 0;
    }
  }

  _updateDayLabel() {
    if (!this.dayText) return;
    const night = !!this.isNight;
    const day = this.dayNum || 1;
    if (this._lastDayLabelPhase === night && this._lastDayLabelDay === day) return;
    this._lastDayLabelPhase = night;
    this._lastDayLabelDay = day;
    this.dayText.setText((night ? 'NIGHT ' : 'DAY ') + day);
    this.dayText.setColor(night ? '#88aaff' : '#ffee44');
  }

  updateDayNight(delta) {
    this.dayTimer += delta * (this.sleepSpeedMult || 1);
    const cycle = this.dayTimer % this.DAY_DUR;
    const pct = cycle / this.DAY_DUR;

    let nightAlpha = 0;
    if (pct < 0.55) nightAlpha = 0;
    else if (pct < 0.7) nightAlpha = ((pct-0.55)/0.15) * 0.6;
    else if (pct < 0.9) nightAlpha = 0.6;
    else nightAlpha = ((1-pct)/0.1) * 0.6;

    const wasNight = this.isNight;
    this.isNight = nightAlpha > 0.2;
    // nightOverlay geometry is filled once at startup; only modulate alpha per frame.
    this.nightOverlay.alpha = nightAlpha;
    this._updateDayLabel();

    // Music transitions + first-night contextual tip
    if (this.isNight && !wasNight) {
      Music.switchToNight();
      this._log(`Night ${this.dayNum} begins  active_enemies=${(this.enemies||[]).filter(e=>e.spr?.active&&!e._dormant).length}`, 'world');
      // Low horn punctuates the transition — camera flash was removed
      // (felt too aggressive; SFX alone is enough to register nightfall).
      try {
        if (typeof SFX !== 'undefined' && SFX._play) {
          SFX._play(110, 'triangle', 0.35, 0.14, 'drop');
          SFX._play(85,  'sine',     0.45, 0.10);
        }
      } catch(e) {}
      if (!this._ctx.firstNight) {
        this._ctx.firstNight = true;
        this._tutTrigger('nightfall');
        if (this._tutShown?.has('nightfall')) this.hint('Night falls — enemies are faster and more dangerous! Build Walls or sleep in a Bed.', 6000);
      }
    }
    // Dawn cue — rising chime only (camera flash removed, felt too aggressive).
    if (!this.isNight && wasNight) {
      try {
        if (typeof SFX !== 'undefined' && SFX._play) {
          SFX._play(520, 'triangle', 0.12, 0.35);
          SFX._play(780, 'sine',     0.10, 0.35);
        }
      } catch(e) {}
    }

    const newDay = Math.floor(this.dayTimer / this.DAY_DUR) + 1;
    if (newDay !== this.dayNum) {
      this.dayNum = newDay;
      this._nightWallHinted = false; // D5 — reset so next night gives warning again
      Music.switchToDay();
      this._log(`Day ${this.dayNum} begins  diff=${this._diffMult().toFixed(1)}x  kills_so_far=${this.kills||0}  enemies=${(this.enemies||[]).filter(e=>e.spr?.active).length}`, 'world');
      this.hint('Dawn of Day ' + this.dayNum + ' \u2014 enemies grow stronger!', 3000);
      if (this.dayNum === 2) this._tutTrigger('caches');
      // Player defense scaling — +8 max HP every 3 days. Heals the granted
      // amount so the buff reads immediately. Keeps players in rough parity
      // with the enemy diffMult ramp so late game isn't pure camping.
      if (this.dayNum >= 3 && this.dayNum % 3 === 0) {
        const boost = 8;
        const bump = p => {
          if (!p || p.isPermanentlyDead) return;
          p.maxHp += boost;
          p.hp = Math.min(p.maxHp, p.hp + boost);
          this._log(`${p.charData.player} endurance +${boost}  maxHp=${p.maxHp}`, 'player');
        };
        bump(this.p1); bump(this.p2);
        this.hint('Endurance grows — max HP +' + boost, 2600);
      }
      // Periodic hunting party — separate cadence from raid camp respawn.
      // Suppress during an active boss fight so players don't get double-squeezed.
      const bossActive = !!(this.boss && this.boss.spr?.active && this.boss.hp > 0);
      if (!bossActive && this.dayNum >= (this.huntNextDay || 0) && this.dayNum >= this.hc.huntingPartyStartDay) {
        this.huntNextDay = this.dayNum + Phaser.Math.Between(2, 3);
        this.time.delayedCall(6000, () => {
          if (this.isOver) return;
          // Re-check at spawn time — boss could spawn during the 6s delay.
          if (this.boss && this.boss.spr?.active && this.boss.hp > 0) {
            this.huntNextDay = this.dayNum + 1;
            return;
          }
          this.spawnHuntingParty();
        });
      }
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
      // Boss schedule: first boss on hc.bossStartDay (guaranteed), then on every
      // bossStartDay-multiple interval (Survival: days 5, 10, 15…; Hardcore: 4, 8, 12…).
      // First check rolls at 100%; subsequent missed rolls grow +10% toward guaranteed.
      else if (!this.bossSpawned && this.dayNum >= this.hc.bossStartDay && this.dayNum % this.hc.bossStartDay === 0) {
        if (this._bossChance === undefined) this._bossChance = 1.0; // day-5 guaranteed
        const roll = this._bossChance;
        if (Math.random() < roll) {
          this._log(`Boss check day=${this.dayNum}  chance=${(roll*100)|0}%  -> SPAWN`, 'world');
          this._bossChance = 0.5; // reset for post-boss hypotheticals
          // Arm per-stage trace so every update()-stage logs its entry until the
          // boss spawns — helps locate any freeze that happens on the way.
          this._stageTrace = true;
          setTimeout(() => { this._stageTrace = false; }, 10000);
          // Defer forensic log flush off the current update frame. Synchronous
          // a.click() inside Phaser's update loop was stalling the Safari
          // scheduler, so the 5s spawnBoss delayedCall never fired. Using
          // setTimeout (not Phaser.time) so the flush still fires even if the
          // game clock stalls.
          setTimeout(() => { try { this._downloadLog(true); } catch (e) {} }, 250);
          this.time.delayedCall(5000, () => {
            if (!this.isOver && !this.bossSpawned) this.spawnBoss();
          });
        } else {
          this._bossChance = Math.min(1.0, roll + 0.10);
          this._log(`Boss check day=${this.dayNum}  chance=${(roll*100)|0}% -> missed  next_chance=${(this._bossChance*100)|0}%`, 'world');
        }
      }
    }

    this._updateDayLabel();

    // Draw clock arc indicator — only refresh when pct crosses a 0.5% step
    // (≈ 200 redraws per in-game day instead of 60fps × DAY_DUR).
    if (this.clockGfx) {
      const pctStep = Math.round(pct * 200);
      if (this._lastClockStep !== pctStep) {
        this._lastClockStep = pctStep;
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
  }

  // ── CRATE PICKUPS ─────────────────────────────────────────────
  setupCratePickups() {
    if (!this.worldCrates) return;
    this.worldCrates.forEach(crate => {
      const pickupCrate = (player) => {
        if (!crate.active) return;
        if (crate.itemType === 'ammo') {
          if (player.charData.id === 'gunslinger') {
            const maxReserve = 40 - player.ammo;
            player.reserveAmmo = Math.min(maxReserve, player.reserveAmmo + 4);
            this._log(`${player.charData.player} crate ammo  reserve=${player.reserveAmmo}`, 'player');
          } else {
            this.teamAmmoPool += 4;
            this._log(`${player.charData.player} crate ammo → team pool  pool=${this.teamAmmoPool}`, 'player');
          }
          this._hudDirty = true;
        } else if (crate.itemType === 'food') {
          if (player.hp < player.maxHp) {
            const _crateFoodHeal = Math.max(1, Math.round(20 * this.hc.foodHealMult));
            player.hp = Math.min(player.maxHp, player.hp + _crateFoodHeal);
            this._log(`${player.charData.player} crate food +${_crateFoodHeal}  hp=${player.hp}/${player.maxHp}`, 'player');
          } else {
            player.inv.food = (player.inv.food || 0) + 2;
            this.resourcesGathered += 2;
            this._log(`${player.charData.player} crate food stored (full HP)  inv=${JSON.stringify(player.inv)}`, 'player');
          }
        } else {
          player.inv[crate.itemType] = (player.inv[crate.itemType] || 0) + 2;
          this.resourcesGathered += 2;
          this._log(`${player.charData.player} crate ${crate.itemType}  inv=${JSON.stringify(player.inv)}`, 'player');
        }
        SFX._play(720, 'sine', 0.1, 0.08);
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
        this._log(`${player.charData.player} build mode off (cycled past last type)`, 'player');
        this.exitBuildMode();
        this.hint('Build mode off', 1000);
        return;
      }
      this.buildType = BUILD_TYPES[idx + 1];
      const cost = this.getBuildCost(this.buildType);
      const costStr = Object.entries(cost).map(([k,v])=>v+' '+k).join(', ');
      this._log(`${player.charData.player} build cycle → ${this.buildType}  cost=${costStr}`, 'player');
      this.hint('Build: ' + this.buildType.toUpperCase() + ' (cost: ' + costStr + ')', 2000);
      return;
    }
    this.buildMode = true;
    this.buildOwner = player;
    this.buildType = 'wall';
    this.buildRotation = 0;
    this._log(`${player.charData.player} build mode ON  type=wall`, 'player');
    if (this.buildGhost) this.buildGhost.destroy();
    this.buildGhost = this.add.image(player.spr.x + 40, player.spr.y, 'build_ghost').setDepth(50).setAlpha(0.6);
    if (this.hudCam) this.hudCam.ignore(this.buildGhost);
    this.hint('BUILD: Q/0=cycle | Attack=place | R/1=rotate | Interact=teardown (50% refund)', 3400);
    this.buildRotKey1 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.buildRotKey2 = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
  }

  exitBuildMode() {
    if (this.buildMode) this._log(`${this.buildOwner?.charData?.player || 'unknown'} build mode OFF  was=${this.buildType}`, 'player');
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
      this._log(`${this.buildOwner?.charData?.player} build rotate  type=${this.buildType}  rot=${this.buildRotation * 90}°`, 'player');
    }
  }

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

    // Reuse the existing destroy path (bucket + cluster + minimap + fade tween).
    this.damageStructure(best, (best.hp || 1) + 1);

    let oy = 0;
    for (const [res, amt] of Object.entries(refund)) {
      this._floatPickup(wx, wy - 10 - oy, '+' + amt + ' ' + res);
      oy += 12;
    }
    this._log(`${player.charData.player} tore down ${kind}  refund=${JSON.stringify(refund)}`, 'build');
    return true;
  }

  placeBuild() {
    if (!this.buildMode || !this.buildGhost) return;
    const p = this.buildOwner;
    const x = this.buildGhost.x, y = this.buildGhost.y;

    // Terrain validation — reject placement on water, ice, mountain, toxic, or occupied tiles
    {
      const tx = Math.floor(x / CFG.TILE), ty = Math.floor(y / CFG.TILE);
      if (this._waterMap && this._waterMap[tx + ty * CFG.MAP_W]) {
        this.hint("Can't build on water!", 2000); return;
      }
      if (this._iceMap && this._iceMap[tx + ty * CFG.MAP_W]) {
        this.hint("Can't build on ice!", 2000); return;
      }
      if (this._solidTileSet && this._solidTileSet.has(tx + ',' + ty)) {
        this.hint("Can't build on a mountain!", 2000); return;
      }
      if (this._toxicTileIndex && this._toxicTileIndex.has(ty * CFG.MAP_W + tx)) {
        this.hint("Can't build on toxic ground!", 2000); return;
      }
      if (this._wallNearby(x, y, 24)) {
        this.hint("Too close to existing structure!", 2000); return;
      }
      // Enemy overlap — refuse if an active enemy is within ~24px of the placement point.
      const _eArr = this.enemies || [];
      for (let _ei = 0; _ei < _eArr.length; _ei++) {
        const _e = _eArr[_ei];
        if (!_e || !_e.spr || !_e.spr.active || _e._dormant) continue;
        const _edx = _e.spr.x - x, _edy = _e.spr.y - y;
        if (_edx * _edx + _edy * _edy < 24 * 24) {
          this.hint("Can't build on top of an enemy!", 2000); return;
        }
      }
    }

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
    this._log(`Build placed: ${this.buildType}  pos=(${Math.floor(x/CFG.TILE)},${Math.floor(y/CFG.TILE)})  by=${this.buildOwner?.charData?.player||'?'}`, 'build');
    if (this.buildType === 'wall') {
      const w = this.obstacles.create(x, y, 'wall').setDepth(5).setImmovable(true);
      w.setAngle(this.buildRotation * 90);
      w.refreshBody();
      w.hp = 200; w.maxHp = 200; // destructible
      this.builtWalls.push(w);
      this._addWallToBuckets(w);
      this._refreshWallClustersNear(w.x, w.y);
      this._paintMinimapTile(w.x, w.y, 0xeeeeff);
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
        delay: 2000, loop: true,
        callback: () => {
          if (!cf.active) return;
          [this.p1, this.p2].filter(Boolean).forEach(pl => {
            if (pl.isDowned) return;
            const d = Phaser.Math.Distance.Between(pl.spr.x, pl.spr.y, cf.x, cf.y);
            if (d < 80) {
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
      const w = this.obstacles.create(x, y, 'wall').setDepth(5).setImmovable(true).setTint(0xaaaaff);
      w.setAngle(this.buildRotation * 90); w.refreshBody();
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
      { label: 'Wall',               key: 'wall',              cost: {wood:3},                  needsBench: false, type: 'build',   tooltip: 'Blocks enemies and absorbs damage before collapsing.' },
      { label: 'Gate',               key: 'gate',              cost: {wood:4, metal:2},         needsBench: false, type: 'build',   tooltip: 'Players pass through freely; blocks all enemies. Toggle with interact.' },
      { label: 'Campfire',           key: 'campfire',          cost: {wood:5},                  needsBench: false, type: 'build',   tooltip: 'Slowly restores HP for nearby players. Provides light at night.' },
      { label: 'Torch',              key: 'torch',             cost: {wood:2, fiber:1},         needsBench: false, type: 'build',   tooltip: 'Lights a small area at night. Cheap — place liberally around your base.' },
      { label: 'Spike Trap',         key: 'spike_trap',        cost: {wood:2, metal:1},         needsBench: false, type: 'build',   tooltip: 'Damages any enemy that steps on it. Stays active indefinitely.' },
      { label: 'Craftbench',         key: 'craftbench',        cost: {wood:5, metal:3},         needsBench: false, type: 'build',   tooltip: 'Required to unlock advanced recipes, upgrades, and the Bed.' },
      { label: 'Bed',                key: 'bed',               cost: {wood:8, fiber:6, metal:2},needsBench: true,  type: 'build',   tooltip: 'Sets your respawn point. Sleep in it to greatly reduce down-timer.' },
      { label: 'Reinforced Wall',    key: 'reinforced_wall',   cost: {wood:4, metal:3},         needsBench: true,  type: 'build',   tooltip: 'Twice as durable as a standard wall. Holds the line against heavy raids.' },
      { label: 'Med Kit (+40 HP)',   key: 'med_kit',           cost: {fiber:3, food:2},         needsBench: true,  type: 'instant', tooltip: 'Instantly restores 40 HP to the crafter. Use when critically wounded.' },
      { label: 'Ammo Pack (+8)',     key: 'ammo_pack',         cost: {metal:2},                 needsBench: false, type: 'instant', tooltip: 'Adds 8 rounds to the shared team ammo pool immediately.' },
      { label: 'Knight Upgrade',     key: 'knight_upgrade',    cost: {metal:3, fiber:2},        needsBench: true,  type: 'upgrade', charId: 'knight',     tooltip: 'Knight: unlocks Shield Throw ability + passive 70% damage block.' },
      { label: 'Architect Upgrade',  key: 'architect_upgrade', cost: {metal:3, wood:2},         needsBench: true,  type: 'upgrade', charId: 'architect',  tooltip: 'Architect: unlocks Nail Gun secondary attack.' },
      { label: 'Gunslinger Upgrade', key: 'gunslinger_upgrade',cost: {metal:2, fiber:1},        needsBench: true,  type: 'upgrade', charId: 'gunslinger', tooltip: 'Gunslinger: increases clip size by 4 rounds (8 → 12).' },
      { label: 'Flower Bouquet (+8)',key: 'flower_bouquet',    cost: {wood:1, fiber:1},         needsBench: false, type: 'instant', charId: 'charmer',    tooltip: 'Lauren only: gives her 8 flower tosses immediately.' },
      { label: 'Lauren Upgrade',     key: 'charmer_upgrade',   cost: {metal:2, fiber:2},        needsBench: true,  type: 'upgrade', charId: 'charmer',    tooltip: 'Lauren: daytime charm aura 200→280px; night aura 0→140px.' },
      { label: 'Abigail Upgrade',    key: 'ranger_upgrade',    cost: {metal:3, wood:2},         needsBench: true,  type: 'upgrade', charId: 'ranger',     tooltip: 'Abigail: unlocks Ranger passive buff and special ability.' },
    ];
  }

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
      const RECIPES = GameScene.RECIPES;
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
      const maxScroll = Math.max(0, GameScene.RECIPES.length - N_VISIBLE);
      this.craftMenuScroll = Phaser.Math.Clamp((this.craftMenuScroll || 0) + (deltaY > 0 ? 1 : -1), 0, maxScroll);
    };
    this.input.on('wheel', this._craftMenuWheelFn);
  }

  _craftScrollToSel() {
    const N_VISIBLE = Math.floor(((_isMobile ? 330 : 380) - 94) / 25);
    const maxScroll = Math.max(0, GameScene.RECIPES.length - N_VISIBLE);
    let s = this.craftMenuScroll || 0;
    if (this.craftMenuSel < s) s = this.craftMenuSel;
    else if (this.craftMenuSel >= s + N_VISIBLE) s = this.craftMenuSel - N_VISIBLE + 1;
    // Clamp so we never scroll past the final row — otherwise the view leaves
    // an empty gap at the bottom when the selection is near the tail of the list.
    this.craftMenuScroll = Phaser.Math.Clamp(s, 0, maxScroll);
  }

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
  }

  updateCraftMenu(delta) {
    if (!this.craftMenuOpen) return;
    const RECIPES = GameScene.RECIPES;

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
  }

  renderCraftMenu() {
    const RECIPES = GameScene.RECIPES;
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
      const locked = rec.needsBench && !this.craftBenchPlaced;
      const canAfford = !locked && Object.entries(rec.cost).every(([r,a]) => (team[r]||0) >= a);

      const nameColor = locked ? '#555544' : isSelected ? '#ffffff' : isHovered ? '#ddeedd' : '#aabbaa';
      const costColor = canAfford ? '#66ee44' : '#ee4422';

      const costStr = Object.entries(rec.cost).map(([r,a]) => a+' '+r).join(', ');
      const suffix  = locked ? ' [bench reqd]' : '';
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

    if (rec.type === 'instant' && rec.key === 'flower_bouquet') {
      // Flower Bouquet: +8 flowers for Lauren; hint if Lauren not in game
      const charmer = [this.p1, this.p2].filter(Boolean).find(p => p.charData.id === 'charmer');
      if (charmer) {
        charmer.flowerAmmo = (charmer.flowerAmmo || 0) + 8;
        this._log(`${charmer.charData.player} got +8 flowers  flowers=${charmer.flowerAmmo}`, 'player');
        this.hint('+8 Flowers for Lauren! (' + charmer.flowerAmmo + ' total)', 2000);
        this._hudDirty = true;
      } else {
        this.hint('Lauren isn\'t in play — flowers wasted!', 2000);
      }
    } else if (rec.type === 'instant' && rec.key === 'ammo_pack') {
      // Ammo Pack: +8 reserve ammo for Gunslinger; small metal refund hint for others
      const gunslinger = [this.p1, this.p2].filter(Boolean).find(p => p.charData.id === 'gunslinger');
      if (gunslinger) {
        const maxReserve = 40 - gunslinger.ammo;
        const added = Math.min(8, maxReserve - gunslinger.reserveAmmo);
        gunslinger.reserveAmmo = Math.min(maxReserve, gunslinger.reserveAmmo + 8);
        this.hint('+' + Math.max(0, added) + ' ammo (Gunslinger)', 2000);
        this._hudDirty = true;
      } else {
        this.hint('No Gunslinger in play — ammo wasted!', 2000);
      }
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
  }

  getTeamInv() {
    const inv = { wood:0, metal:0, fiber:0, food:0 };
    [this.p1, this.p2].filter(p => p && p.inv).forEach(p => {
      for (const k of Object.keys(inv)) inv[k] += (p.inv[k] || 0);
    });
    return inv;
  }
}

