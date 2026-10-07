'use strict';
// ── src/game-scene.js — GameScene: gameplay systems 3, 5-7 and 9-22 ──────────
// Globals exported: GameScene, GameScene.RECIPES
// Systems: dens, player movement, player combat,
//          death/revive, craft recipes, walls/spikes, day/night, relics,
//          raiders, harvesting, cameras, HUD/minimap, fog-of-war, audio hooks,
//          input, debug log, tutorial, game-over/victory, settings/save
// grep: "// ── SYSTEM:"  "updateDayNight"  "_log("

// Four-band walk cycle: idle → stride A → idle → stride B. t counts 0..39.
function _walkStep(t) { return t < 10 ? '' : t < 20 ? '_step' : t < 30 ? '' : '_step2'; }
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

    // Two-camera tracking lists
    this._wo = []; this._ho = [];
    this._w = o => { this._wo.push(o); return o; };
    this._h = o => { this._ho.push(o); return o; };

    // Ambient grass sway — 3 staggered phase groups, updated only when frame changes
    this._grassGroups = [[], [], []];
    this._grassPhase = -1;

    // Water animation — rivers scroll a shared texture; ponds/lakes shimmer alpha.
    this._pondWaterTiles = [];  // Water-layer tiles — alpha pulse via shimmer table
    this._riverTex     = this.textures.exists('water_river') ? this.textures.get('water_river') : null;
    this._riverScroll  = 0;     // accumulated downstream offset (px)
    this._riverOffLast = -1;    // last integer offset uploaded — skip redundant refreshes
    // Shallow-water spatial index is lazily rebuilt per run (see applyTerrainEffects).
    // Null it on (re)create so a "Play Again" run can't query the previous world's
    // destroyed tiles (submersion visual would silently die otherwise).
    // Pre-compute 60-step shimmer alpha table (~3.3 s cycle, sin-smoothed 0.84→0.96)
    // Slow, narrow range keeps the shimmer subtle — ponds breathe, not strobe.
    this._shimmerTable = Array.from({length: 60}, (_, i) =>
      0.84 + 0.12 * (0.5 + 0.5 * Math.sin(i * Math.PI * 2 / 60))
    );

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
    // Lazily created elsewhere; reset so Play Again doesn't carry them over.
    this._toxicPoolsData = [];
    this._bedPrompts = [];

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
          // ?seed=N reproducibility: buildWorld is synchronous and Phaser's Between/FloatBetween
          // call Math.random, so route every random draw in it through the seeded _worldRng.
          const _realRandom = Math.random;
          Math.random = _worldRng;
          try { this.buildWorld(worldW, worldH, cx, cy); }
          finally { Math.random = _realRandom; }
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
            // Mouse in use = a real mouse moved or clicked over the canvas recently (touch does not count).
            this._mouseAt = -Infinity;
            const _markMouse = (p) => { if (!p.wasTouch) this._mouseAt = this.time.now; };
            this.input.on('pointermove', _markMouse);
            this.input.on('pointerdown', _markMouse);
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
                this.aimAtMouse(this.p1); // the click itself counts as mouse use, so aim at it
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
                this._log('World init: READY  display objects=' + this.children.length, 'world');
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
    if (loadSettings().fogEnabled === false) { this.fogGfx.setVisible(false); return; }
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

    // Paint the viewport's tiles into the fog texture: unexplored = dark,
    // explored-but-not-in-LOS = dim, in-LOS = clear.
    const vx = cam.worldView.x, vy = cam.worldView.y;
    const vw = cam.worldView.width, vh = cam.worldView.height;
    const startTX = Math.max(0, Math.floor(vx / TILE) - 3);
    const startTY = Math.max(0, Math.floor(vy / TILE) - 3);
    const endTX = Math.min(CFG.MAP_W - 1, Math.ceil((vx + vw) / TILE) + 3);
    const endTY = Math.min(CFG.MAP_H - 1, Math.ceil((vy + vh) / TILE) + 3);
    const w = endTX - startTX + 1, h = endTY - startTY + 1;
    const DARK = 217, DIM = 89; // 0.85 and 0.35 alpha
    const a = new Uint8Array(w * h), b = new Uint8Array(w * h);
    for (let ty = startTY; ty <= endTY; ty++) {
      for (let tx = startTX; tx <= endTX; tx++) {
        const key = tx + ',' + ty;
        a[(ty - startTY) * w + (tx - startTX)] =
          !this.fogRevealed.has(key) ? DARK : (this.fogVisible.has(key) ? 0 : DIM);
      }
    }
    // 5-tap box blur across then down, so zone edges fade over ~3 tiles instead of one;
    // linear texture filtering then smooths what is left between tiles.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += a[y * w + Math.min(w - 1, Math.max(0, x + k))];
      b[y * w + x] = sum / 5;
    }
    const ctx = this._fogTex.context;
    const img = ctx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += b[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      d[(y * w + x) * 4 + 3] = sum / 5;
    }
    ctx.putImageData(img, startTX, startTY);
    this._fogTex.refresh();
    // pixelArt mode re-uploads canvases with NEAREST filtering; set LINEAR after every refresh.
    this._fogTex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.fogGfx.setVisible(true);
  }

  // ── PLAYER ──────────────────────────────────────────────────
  spawnPlayer(x, y, charData, pNum) {
    const spr = this._w(this.physics.add.sprite(x, y, 'player_atlas', charData.id).setScale(1.5).setDepth(10));
    spr.setCollideWorldBounds(true);
    spr.body.setSize(20, 24).setOffset(13, 31); // frame is padded 1px for the outline

    const lbl = this._w(this.add.text(x, y-50, charData.player, {
      fontFamily:'monospace', fontSize:'12px',
      color: pNum===1 ? '#6699ff' : '#ff9944', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5).setDepth(11));

    const hpBar = this._w(this.add.graphics().setDepth(12));

    // Water submersion overlay — rendered above player to simulate wading
    const waterOverlay = this._w(this.add.image(x, y, 'water_sub_overlay')
      .setOrigin(0.5, 0).setDepth(11).setAlpha(0).setVisible(false));
    if (this.hudCam) this.hudCam.ignore(waterOverlay);

    const _hcMaxHp = Math.max(1, Math.round(charData.maxHp * this.hc.maxHpMult));
    const player = {
      spr, lbl, charData, pNum,
      hp: _hcMaxHp, maxHp: _hcMaxHp,
      ammo: charData.id==='gunslinger' ? 8 : Infinity,
      reserveAmmo: charData.id==='gunslinger' ? 32 : 0,
      carriedAmmo: 0, // picked up by a non-Gunslinger; handed over when close to the Gunslinger
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
    // Night torch: a fire glow that follows the player, driven by _updateFireGlows.
    this._addFireGlow(x, y, 1.1);
    this._fireGlows[this._fireGlows.length - 1].follow = player;
    return player;
  }

  // ── HUD ─────────────────────────────────────────────────────
  buildHUD() {
    const { W, H } = CFG;
    this._hudDirty = true;

    this.ammoIcons = { p1:null, p2:null };
    if (STATE.p1CharId==='gunslinger') this.ammoIcons.p1 = this.makeAmmoRow(14, 52, 0x6699ff);
    if (!this.solo && STATE.p2CharId==='gunslinger') this.ammoIcons.p2 = this.makeAmmoRow(W-108, 52, 0xff9944);
    if (this.ammoIcons.p1) this.ammoIcons.p1.forEach(ic => this._h(ic));
    if (this.ammoIcons.p2) this.ammoIcons.p2.forEach(ic => this._h(ic));

    // Reserve ammo counter (shown below clip icons for gunslinger players)
    this.ammoReserveText = { p1: null, p2: null };
    if (STATE.p1CharId === 'gunslinger') {
      this.ammoReserveText.p1 = this._h(this.add.text(14, 62, '', {
        fontFamily:'monospace', fontSize:'12px', color:'#aaaacc',
      }).setDepth(101));
    }
    if (!this.solo && STATE.p2CharId === 'gunslinger') {
      this.ammoReserveText.p2 = this._h(this.add.text(W - 12, 62, '', {
        fontFamily:'monospace', fontSize:'12px', color:'#ccaa88',
      }).setOrigin(1, 0).setDepth(101));
    }

    const dayBg = this._h(this.add.graphics().setDepth(100));
    dayBg.fillStyle(0x000000, 0.6); dayBg.fillRoundedRect(W/2-95, 5, 190, 66, 8);
    this.dayText = this._h(this.add.text(W/2, 10, 'DAY 1', { fontFamily:'monospace', fontSize:'13px', color:'#ffee44' }).setOrigin(0.5,0).setDepth(101));
    this.clockGfx = this._h(this.add.graphics().setDepth(102));

    // Off-screen threat indicators — issue #81. Drawn in HUD space; redrawn each frame
    // by _drawThreatIndicators() so the arrows track the camera as it pans.
    this.threatGfx = this._h(this.add.graphics().setDepth(103));

    const diffColor = this.hardcore ? '#ff4444' : '#44cc66';
    const diffLabel = this.hardcore ? '\u2620 HARDCORE' : '\u2665 SURVIVAL';
    this._h(this.add.text(W/2, 52, diffLabel, { fontFamily:'monospace', fontSize:'12px', color:diffColor }).setOrigin(0.5,0).setDepth(101));

    // Persistent MENU button — bottom-right, works for both keyboard and touch
    const menuBtn = this._h(this.add.text(W - 14, H - 12, '\u2630  MENU', {
      fontFamily:'monospace', fontSize:'12px', color:'#557755',
      backgroundColor:'#00000088', padding:{ x:8, y:4 },
    }).setOrigin(1, 1).setDepth(104).setInteractive({ useHandCursor: true }));
    menuBtn.on('pointerover', () => menuBtn.setColor('#aaffaa'));
    menuBtn.on('pointerout',  () => menuBtn.setColor('#557755'));
    menuBtn.on('pointerdown', () => { if (!this.isOver) this.toggleControls(); });

    // Down status texts
    this.p1DownStatus = this._h(this.add.text(12, 80, '', { fontFamily:'monospace', fontSize:'12px', color:'#ff4444' }).setDepth(103));
    this.p2DownStatus = this._h(this.add.text(W-12, 80, '', { fontFamily:'monospace', fontSize:'12px', color:'#ff4444' }).setOrigin(1,0).setDepth(103));

    // Resource panel: item icon + count, always visible. Bottom-left for P1, bottom-right for P2
    // (above the MENU button). Below the joystick hint ring, clear of the touch buttons (1P only).
    this.p1InvText = this._makeResPanel(12, H - 46, false);
    if (this.p2) this.p2InvText = this._makeResPanel(W - 12, H - 80, true);

    // Relic progress tracker — hidden until first relic activity
    this.hudRelicText = this._h(this.add.text(W/2, 76, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#cc44ff',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(101).setVisible(false));

    // P1 name badge (top-left)
    this.p1Badge = this._h(this.add.text(12, 10, this.p1.charData.player + ' \u2014 ' + this.p1.charData.title, {
      fontFamily:'monospace', fontSize:'12px', color:'#6699ff',
    }).setDepth(102));
    if (this.p2) {
      this.p2Badge = this._h(this.add.text(W-12, 10, this.p2.charData.player + ' \u2014 ' + this.p2.charData.title, {
        fontFamily:'monospace', fontSize:'12px', color:'#ff9944',
      }).setOrigin(1,0).setDepth(102));
    }

    // Status-effect strips under the name badges (drawn only from redrawHUD)
    this.p1StatusGfx = this._h(this.add.graphics().setDepth(102));
    if (this.p2) this.p2StatusGfx = this._h(this.add.graphics().setDepth(102));

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
      fontFamily:'monospace', fontSize:'12px', color:'#667788',
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
    // Biome structure floors are painted by buildBiomeStructures once it knows what it built.

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

  // Active status effects on a player, in draw order. They live in different fields.
  _activeStatuses(p) {
    const now = this.time.now, s = [];
    if (p._frostSlowed) s.push('frost');
    if (p._webbed) s.push('web');
    if (p._toxicUntil > now) s.push('toxic');
    if (p._rallyUntil > now) s.push('rally');
    if (p['_' + p.charData.id + 'Upgraded']) s.push('upgrade');
    if (p._sheltered) s.push('shelter');
    return s;
  }

  _drawStatusStrip(gfx, p, rightAlign, cacheKey) {
    const list = this._activeStatuses(p), key = list.join();
    if (this[cacheKey] === key) return;
    this[cacheKey] = key;
    const SZ = 13, GAP = 3, y = 28, W = this.scale.width;
    gfx.clear();
    list.forEach((name, i) => {
      const x = rightAlign ? W - 12 - SZ - i * (SZ + GAP) : 12 + i * (SZ + GAP);
      const cx = x + SZ / 2, cy = y + SZ / 2, r = SZ / 2;
      gfx.fillStyle(0x000000, 0.55).fillRect(x - 1, y - 1, SZ + 2, SZ + 2);
      if (name === 'frost') {          // blue diamond
        gfx.fillStyle(0x88ccff, 1).fillTriangle(cx, y, x + SZ, cy, cx, y + SZ).fillTriangle(cx, y, x, cy, cx, y + SZ);
      } else if (name === 'web') {     // white cross in a ring
        gfx.lineStyle(1.5, 0xdddddd, 1).strokeCircle(cx, cy, r - 1).lineBetween(x, cy, x + SZ, cy).lineBetween(cx, y, cx, y + SZ);
      } else if (name === 'toxic') {   // green drop
        gfx.fillStyle(0x44ff22, 1).fillCircle(cx, cy + 2, r - 2).fillTriangle(cx, y, cx - r + 2, cy + 1, cx + r - 2, cy + 1);
      } else if (name === 'rally') {   // yellow up arrow
        gfx.fillStyle(0xffdd44, 1).fillTriangle(cx, y, x, cy + 1, x + SZ, cy + 1).fillRect(cx - 2, cy, 4, r);
      } else if (name === 'shelter') { // warm house: roof over a wall with a lit door
        gfx.fillStyle(0xe8b060, 1).fillTriangle(cx, y, x, cy, x + SZ, cy).fillRect(x + 2, cy, SZ - 4, r);
        gfx.fillStyle(0xff7722, 1).fillRect(cx - 1.5, cy + 2, 3, r - 2);
      } else {                         // upgrade: orange square star
        gfx.fillStyle(0xffaa22, 1).fillRect(x + 2, y + 2, SZ - 4, SZ - 4).fillTriangle(cx, y - 1, x + 1, cy, x + SZ - 1, cy).fillTriangle(cx, y + SZ + 1, x + 1, cy, x + SZ - 1, cy);
      }
    });
  }

  // A row of item icon + count for wood, metal, fiber and food, plus carried ammo when a
  // non-Gunslinger holds some. A zero count is dimmed, not hidden, so the panel never jumps.
  _makeResPanel(x, y, right) {
    const SLOTS = [['wood', 'item_wood'], ['metal', 'item_metal'], ['fiber', 'item_fiber'], ['food', 'item_food'], ['carriedAmmo', 'item_ammo']];
    const SLOT_W = 52, PAD = 8, H = 28;
    const bg = this._h(this.add.graphics().setDepth(100));
    const slots = SLOTS.map(([key, tex]) => ({
      key,
      icon: this._h(this.add.image(0, 0, tex).setScale(2).setDepth(101)),
      txt: this._h(this.add.text(0, 0, '0', { fontFamily:'monospace', fontSize:'12px', color:'#ddeecc', stroke:'#000', strokeThickness:2 }).setOrigin(0, 0.5).setDepth(101)),
    }));
    let lastKey = '', shown = true;
    return {
      setVisible(v) { shown = v; bg.setVisible(v); lastKey = ''; slots.forEach(sl => { sl.icon.setVisible(false); sl.txt.setVisible(false); }); },
      update(p) {
        if (!shown || !p) return;
        const vals = SLOTS.map(([key]) => (key === 'carriedAmmo' ? p.carriedAmmo : p.inv[key]) || 0);
        const k = vals.join(',');
        if (k === lastKey) return;
        lastKey = k;
        const n = vals[4] > 0 ? 5 : 4;
        const w = n * SLOT_W + PAD, x0 = right ? x - w : x;
        bg.clear().fillStyle(0x000000, 0.5).fillRoundedRect(x0, y, w, H, 6);
        slots.forEach((sl, i) => {
          const on = i < n, dim = vals[i] > 0 ? 1 : 0.4;
          sl.icon.setVisible(on).setPosition(x0 + PAD + i * SLOT_W + 12, y + H / 2).setAlpha(dim);
          sl.txt.setVisible(on).setPosition(x0 + PAD + i * SLOT_W + 26, y + H / 2).setText(String(vals[i])).setAlpha(dim);
        });
      },
    };
  }

  redrawHUD() {
    this._drawStatusStrip(this.p1StatusGfx, this.p1, false, '_lastStatusP1');
    if (this.p2StatusGfx) this._drawStatusStrip(this.p2StatusGfx, this.p2, true, '_lastStatusP2');
    // Update ammo icons and reserve counter — only touch alphas/text when the
    // values actually changed (redrawHUD runs from update() only when _hudDirty is set).
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

    // Update name badges — cache the rendered string so an unrelated HUD dirty
    // (ammo, relic, build) doesn't re-layout glyphs that never changed.
    if (this.p1Badge) {
      const _b1 = this.p1.charData.player + ' — ' + this.p1.charData.title;
      if (this._lastBadgeP1 !== _b1) { this._lastBadgeP1 = _b1; this.p1Badge.setText(_b1); }
    }
    if (this.p2Badge && this.p2) {
      const _b2 = this.p2.charData.player + ' — ' + this.p2.charData.title;
      if (this._lastBadgeP2 !== _b2) { this._lastBadgeP2 = _b2; this.p2Badge.setText(_b2); }
    }

    // Resource panels — each redraws only when its counts change
    if (this.p1InvText) this.p1InvText.update(this.p1);
    if (this.p2InvText) this.p2InvText.update(this.p2);

    // Relic progress tracker
    if (this.hudRelicText) {
      const dep = this.relicsDeposited || 0;
      const held = this.relicsHeld || 0;
      const anyActivity = dep > 0 || held > 0;
      this.hudRelicText.setVisible(anyActivity);
      if (anyActivity) {
        const boxes = '◆'.repeat(dep) + '◇'.repeat(5 - dep);
        const carryStr = held > 0 ? '  ▶ carrying ' + held : '';
        const _rs = 'ALTAR ' + boxes + carryStr;
        if (this._lastRelicStr !== _rs) {
          this._lastRelicStr = _rs;
          this.hudRelicText.setText(_rs);
          this.hudRelicText.setColor(held > 0 ? '#ff8833' : '#cc44ff');
        }
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

    this.hint(player.charData.player + ' is DOWN! Get close and hold E / Enter to revive!', 5000, { urgent: true });
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
            fontFamily: 'monospace', fontSize: '12px', color: '#cc88ff', stroke: '#000', strokeThickness: 2,
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
        this.hint(player.charData.player + ' sleeping \u2014 ' + skipNote + '\n(+' + this.hc.bedHealPerTick + ' HP/tick)' + vulnWarn, 4500);
      } else {
        this.hint(player.charData.player + ' resting\u2026 (+' + this.hc.bedHealPerTick + ' HP/tick)  Sleep at night to skip to dawn.' + vulnWarn, 3800);
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

  // ── HINT ─────────────────────────────────────────────────────
  // Show a contextual tip. Hints are now QUEUED rather than overwriting:
  // a new call while one is on screen waits in line, so rapid events
  // (e.g. revive + frost + web in close succession) all get to read.
  // opts.title: bold heading line (tutorial tips). opts.urgent: jump the queue and cut a
  // tutorial tip short, so a boss alert is never stuck behind a 7 s tip.
  hint(text, duration, opts = {}) {
    this._log(`HINT: ${text}`, 'player');
    duration = Math.max(duration || 2500, 800);
    this._hintQueue = this._hintQueue || [];
    // Suppress immediate exact duplicates (the same hint fired twice in a
    // row is almost always a bug or a per-frame re-trigger; the queue
    // shouldn't compound it).
    const last = this._hintQueue[this._hintQueue.length - 1];
    if (last && last.text === text) return;
    if (this._activeHint && this._activeHint._hintText === text && this._hintQueue.length === 0) return;
    const item = { text, duration, title: opts.title };
    if (opts.urgent) {
      this._hintQueue.unshift(item);
      if (this._activeHint?._isTip && this._hintHide) { this._hintTimer?.remove(); this._hintTimer = null; this._hintHide(); }
    } else {
      // Cap queue length so a chaotic moment doesn't trail tips long after.
      if (this._hintQueue.length >= 4) this._hintQueue.shift();
      this._hintQueue.push(item);
    }
    this._processHintQueue();
  }

  _processHintQueue() {
    if (this._activeHint && this._activeHint.active) return;
    if (!this._hintQueue || this._hintQueue.length === 0) return;
    const { text, duration, title } = this._hintQueue.shift();
    const { W } = CFG;
    const PW = 560, PH = title ? 88 : 46, PX = (W - PW) / 2, PY = 108;

    const bg = this.add.graphics().setDepth(160).setAlpha(0);
    bg.fillStyle(0x050d05, 0.88);
    bg.fillRoundedRect(PX, PY, PW, PH, 8);
    bg.lineStyle(2, 0x4a7a38, 0.80);
    bg.strokeRoundedRect(PX, PY, PW, PH, 8);
    this.cameras.main.ignore(bg);

    const h = this.add.text(W / 2, title ? PY + 56 : PY + PH / 2, text, {
      fontFamily:'monospace', fontSize:'15px', color:'#ccdfc8',
      stroke:'#000', strokeThickness:2,
      wordWrap:{ width: PW - 32 },
    }).setOrigin(0.5).setDepth(161).setAlpha(0);
    this.cameras.main.ignore(h);
    h._hintText = text;
    h._isTip = !!title;
    const parts = [bg, h];
    if (title) {
      const t = this.add.text(W / 2, PY + 16, title, {
        fontFamily:'monospace', fontSize:'18px', color:'#aadd88',
        stroke:'#000', strokeThickness:3,
      }).setOrigin(0.5).setDepth(161).setAlpha(0);
      this.cameras.main.ignore(t);
      parts.push(t);
    }
    this._activeHint = h;
    this._activeHintBg = bg;

    const hide = () => {
      this._hintHide = null;
      this.tweens.killTweensOf(parts);
      this.tweens.add({ targets:parts, alpha:0, duration:450,
        onComplete:() => {
          if (h === this._activeHint) { this._activeHint = null; this._activeHintBg = null; }
          parts.forEach(o => o.destroy());
          // Small gap so consecutive hints don't bleed into each other visually.
          this.time.delayedCall(150, () => this._processHintQueue());
        }
      });
    };
    this._hintHide = hide;
    this.tweens.add({ targets:parts, alpha:1, duration:280,
      onComplete:() => {
        this._hintTimer = this.time.delayedCall(duration, () => { this._hintTimer = null; hide(); });
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
  // Tips go through hint() with a title, so they share its queue and timing.
  // Disabled if settings.tutorial === false.
  startTutorial() {
    if (loadSettings().tutorial === false) return;
    this._tutActive = true;
    // Seed from localStorage so returning players skip tips they've already seen
    const _savedTips = (() => { try { return JSON.parse(localStorage.getItem('iw_tutorial_state') || '{}'); } catch(e) { return {}; } })();
    this._tutShown = new Set(Object.keys(_savedTips).filter(k => _savedTips[k]));
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
    // Name the controls the player really has: touch buttons on touch, their bound keys on keyboard.
    const B = Object.assign({}, DEFAULT_BINDINGS, loadSettings().bindings || {});
    const k = a => keyDisplayName(B[a]);
    const touch = !!this._touchActive;
    const TIPS = {
      move:     { title: 'MOVE',          text: touch
        ? 'Drag the left side of the screen to move.  Explore each biome — grassland, wasteland, swamp, tundra, ruins.'
        : `P1: ${k('p1up')}${k('p1left')}${k('p1down')}${k('p1right')} · P2: ${k('p2up')}${k('p2left')}${k('p2down')}${k('p2right')}.  Explore each biome — grassland, wasteland, swamp, tundra, ruins.` },
      attack:   { title: 'ATTACK',        text: touch
        ? 'Tap the ATK button to attack in the direction you are facing.'
        : `P1: ${k('p1attack')} to attack · P2: ${k('p2attack')}.  In 1-player mode: aim with the mouse and left-click to shoot.` },
      gather:   { title: 'GATHER RESOURCES', text: touch
        ? 'Hold the USE button near a tree to harvest wood.  Open crates for metal, fiber, ammo, and food.'
        : `Hold ${k('p1interact')} (P1) or ${k('p2interact')} (P2) near a tree to harvest wood.  Open crates for metal, fiber, ammo, and food.` },
      craft:    { title: 'CRAFT & BUILD', text: touch
        ? 'Tap the BLD button to open the Crafting Menu.  Build walls, campfires, spike traps, and more.'
        : `Press ${k('p1build')} (P1) or ${k('p2build')} (P2) to open the Crafting Menu.  Build walls, campfires, spike traps, and more.` },
      nightfall:{ title: 'SURVIVE THE NIGHT', text: 'Enemies are stronger after dark.  Build a Bed (needs Craftbench) and sleep to fast-forward the night.' },
      caches:   { title: 'SUPPLY CACHES', text: 'Each biome hides a Supply Cache — rare loot but guarded by enemies.  Find them before the boss arrives!' },
      minimap:  { title: 'MINIMAP',       text: 'Top-right minimap shows biome edges, enemies (red dots), and points of interest.  Stay aware!' },
    };
    const step = TIPS[key];
    if (step) this.hint(step.text, CFG.TUT_AUTO_ADVANCE_MS, { title: step.title });
  }

  _endTutorial() {
    this._tutActive = false;
  }

  // Y-sorted draw order: scenery, players and enemies share the band 9..9.9, deeper down the
  // map = drawn later, so a sprite stands in front of whatever is above its feet. The band sits
  // above ground items and structures (<= 8) and below bullets (10) and bars/labels (>= 11).
  _sortDepth(feetY) { return 9 + feetY / (CFG.MAP_H * CFG.TILE) * 0.9; }

  // ── UPDATE ────────────────────────────────────────────────────
  update(time, delta) {
    if (!this._worldReady) return; // deferred world init not yet complete
    if (this.isOver) return;

    for (const p of [this.p1, this.p2]) if (p?.spr) p.spr.setDepth(this._sortDepth(p.spr.y + p.spr.displayHeight / 2));
    for (const e of this.enemies) if (e.spr?.active) e.spr.setDepth(this._sortDepth(e.spr.y + e.spr.displayHeight / 2));

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
        this._log(`frame budget (${_n}fr avg)  terrain=${_av('terrain')}ms  enemies=${_av('enemies')}ms  waves=${_av('waves')}ms  dens=${_av('dens')}ms  raiders=${_av('raiders')}ms  boss=${_av('boss')}ms  daynight=${_av('daynight')}ms  glows=${_av('glows')}ms  fog=${_av('fog')}ms  minimap=${_av('minimap')}ms  hud=${_av('hud')}ms  threats=${_av('threats')}ms  grass=${_av('grass')}ms  water=${_av('water')}ms`, 'perf');
        this._perfBudget = null;
      }
    }
    if (!this._perfBudget) this._perfBudget = { terrain: 0, enemies: 0, waves: 0, dens: 0, raiders: 0, boss: 0, daynight: 0, glows: 0, fog: 0, minimap: 0, hud: 0, threats: 0, grass: 0, water: 0, n: 0 };

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

    // Web slow cooldown ticking
    if (this.p1 && (this.p1._webSlowCd || 0) > 0) this.p1._webSlowCd = Math.max(0, this.p1._webSlowCd - delta);
    if (this.p2 && (this.p2._webSlowCd || 0) > 0) this.p2._webSlowCd = Math.max(0, this.p2._webSlowCd - delta);

    // Tundra slowdown effect
    { const _t = performance.now(); this.applyTerrainEffects(this.p1, delta); if (this.p2) this.applyTerrainEffects(this.p2, delta); this._perfBudget.terrain += performance.now() - _t; }

    // Ambient grass sway — pivot from origin (0.5,1) so blades rotate at their base.
    // 3 phase groups cycle out-of-sync for a natural, non-mechanical look.
    // setAngle only fires when the 600ms phase boundary crosses — negligible cost.
    { const _t = performance.now();
      const _gp = Math.floor(time / 600);
      if (_gp !== this._grassPhase) {
        this._grassPhase = _gp;
        const _angles = [-2, 2, 0];
        for (let _gi = 0; _gi < 3; _gi++) {
          const _a = _angles[(_gp + _gi) % 3];
          for (const _s of this._grassGroups[_gi]) _s.setAngle(_a);
        }
      }
      this._perfBudget.grass += performance.now() - _t; }

    // Water animation — river current + pond/lake shimmer.
    // Rivers: scroll the SINGLE shared 'water_river' canvas downstream. Every river
    //   tile is a plain add.image sharing this texture, so one redraw+upload animates
    //   them all in one batch (no per-tile TileSprite draw-call storm). The redraw is
    //   gated on the integer offset changing, so it fires only every ~2-3 frames.
    // Ponds/lakes: alpha oscillates per-tile via a pre-computed 60-step sin table;
    //   the per-tile phase offset (_shimmerOff) breaks the lockstep so tiles
    //   don't all brighten/darken together — gives a gentle ripple-across-the-water feel.
    { const _t = performance.now();
      if (this._riverTex && this._riverTex.context) {
        this._riverScroll += delta * 0.012; // ~12 px/sec downstream, frame-rate independent
        const _off = Math.floor(this._riverScroll) % 32;
        if (_off !== this._riverOffLast) {
          this._riverOffLast = _off;
          try { drawRiverFrame(this._riverTex.context, _off); this._riverTex.refresh(); } catch(e) {}
        }
      }
      if (this._shimmerTable && this._pondWaterTiles.length) {
        const _si = Math.floor(time / 55); // ~3.3 s full shimmer cycle
        for (const _pt of this._pondWaterTiles) {
          _pt.alpha = this._shimmerTable[(_si + _pt._shimmerOff) % 60];
        }
      }
      this._perfBudget.water += performance.now() - _t; }

    // Cache active players once per frame — reused by updateEnemyDens, updateWaterDens, etc.
    this._activePlayers = [this.p1, this.p2].filter(p => p && p.spr && p.spr.active);

    // Low-HP heal reminder — logs showed players limping at single-digit HP for whole
    // game-days without using any heal path (Med Kit / campfire / food). Nudge once when a
    // player first drops below 30%; re-arm after they recover past 60% so it can fire again
    // in a long run but never spams.
    for (const _pl of this._activePlayers) {
      if (_pl.isDowned || _pl.hp <= 0 || !_pl.maxHp) continue;
      if (_pl._lowHpArmed === undefined) _pl._lowHpArmed = true;
      const _hpR = _pl.hp / _pl.maxHp;
      if (_hpR < 0.30 && _pl._lowHpArmed) {
        _pl._lowHpArmed = false;
        this.hint('⚠ Low HP! Eat food, rest by a campfire, or craft a Med Kit at a bench.', 3500);
      } else if (_hpR > 0.60) {
        _pl._lowHpArmed = true;
      }
    }

    // Water submersion visual overlay
    this._updateWaterSubmersion(this.p1);
    if (this.p2) this._updateWaterSubmersion(this.p2);

    this.syncLabels();
    this.updateCamera();
    this.checkBarrackRange();
    this._handOverAmmo();
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
    // Terrain reaches raiders and animals too. After the AI, which sets their velocity; bosses skip.
    { const _t = performance.now();
      const _en = this.enemies;
      for (let _i = _en.length - 1; _i >= 0; _i--) { // backwards: a pool kill splices the array
        const _e = _en[_i];
        if (!_e || _e.dying || _e._dormant || _e.isBoss || !_e.spr || !_e.spr.active) continue;
        this.applyTerrainEffects(_e, delta, _e.isRaider ? 'raider' : 'animal');
      }
      this._perfBudget.terrain += performance.now() - _t; }
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
    _safe('_updateShelter', () => this._updateShelter());
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
      p.walkTimer = (p.walkTimer + 1) % 40;
      const step = _walkStep(p.walkTimer);
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

  // Terrain effects for any actor. kind: 'player' (all four effects), 'raider' (all four) or
  // 'animal' (shallow water + toxic pools; water_lurker and bog_lurker are exempt where they live).
  // Players scale their velocity every frame because movePlayer rewrites it every frame. AI actors
  // do not (a wanderer's velocity is set once per 1.5-3.5 s), so _scaleVel scales only fresh values.
  applyTerrainEffects(actor, delta = 0, kind = 'player') {
    if (!actor || actor.isDowned) return;
    if (!actor.spr || !actor.spr.body) return;
    const isPlayer = kind === 'player';
    const water = isPlayer || (actor.type !== 'water_lurker' && actor.type !== 'bog_lurker');
    const toxic = isPlayer || actor.type !== 'bog_lurker';
    const coldGround = isPlayer || kind === 'raider';
    const name = isPlayer ? actor.charData.player : actor.type;
    if (actor._toxicCd > 0) actor._toxicCd -= delta;

    // Shallow water + ice + toxic pools — all computed per-frame via Uint8Array maps
    const TILE = CFG.TILE, MW = CFG.MAP_W;
    const ptx = Math.floor(actor.spr.x / TILE);
    const pty = Math.floor(actor.spr.y / TILE);
    {
      const wm = this._waterMap;
      actor._inShallowWater = water && !!(wm &&
        (wm[ptx + pty * MW] || wm[(ptx+1) + pty * MW] ||
         wm[ptx + (pty+1) * MW] || wm[(ptx+1) + (pty+1) * MW]));
    }
    // Ice lookup (tundra lakes + frozen ponds)
    {
      const im = this._iceMap;
      actor._onIce = coldGround && !!(im &&
        (im[ptx + pty * MW] || im[(ptx+1) + pty * MW] ||
         im[ptx + (pty+1) * MW] || im[(ptx+1) + (pty+1) * MW]));
    }
    // Toxic pool lookup — tile-indexed list of AABBs (numeric key avoids string alloc).
    if (toxic && this._toxicTileIndex) {
      const arr = this._toxicTileIndex.get(pty * MW + ptx);
      if (arr) {
        const px = actor.spr.x, py = actor.spr.y;
        for (let i = 0; i < arr.length; i++) {
          const pool = arr[i];
          if (Math.abs(px - pool.x) <= pool.rx && Math.abs(py - pool.y) <= pool.ry) {
            if (!actor._toxicCd || actor._toxicCd <= 0) {
              actor.hp = Math.max(0, actor.hp - 3);
              actor._toxicCd = 500;
              if (isPlayer) {
                actor._toxicUntil = this.time.now + 900;
                this._hudDirty = true;
                this.time.delayedCall(950, () => { this._hudDirty = true; });
              }
              this._log(`${name} toxic pool dmg=3 hp=${actor.hp}/${actor.maxHp}`, 'combat');
              actor.spr.setTint(0x44ff22);
              this.time.delayedCall(150, () => {
                if (!actor.spr?.active) return;
                if (actor._frostSlowed) actor.spr.setTint(0x88ccff);
                else if (actor._charmTinted) actor.spr.setTint(0xffaacc);
                else actor.spr.clearTint();
              });
              // Straight to the kill path: no flinch, knockback or hit-pause per tick.
              if (!isPlayer && actor.hp <= 0) { this.killEnemy(actor); return; }
            }
            break;
          }
        }
      }
    }

    if (actor._inShallowWater) {
      this._scaleVel(actor, 0.5, isPlayer);
      return;
    }

    // Ice: momentum slide — 88/12 blend preserves previous velocity
    if (actor._onIce) {
      const vx = actor.spr.body.velocity.x, vy = actor.spr.body.velocity.y;
      if (actor._iceVx === undefined) { actor._iceVx = vx; actor._iceVy = vy; }
      actor._iceVx = actor._iceVx * 0.88 + vx * 0.12;
      actor._iceVy = actor._iceVy * 0.88 + vy * 0.12;
      actor.spr.setVelocity(actor._iceVx, actor._iceVy);
      return;
    }
    actor._iceVx = undefined; actor._iceVy = undefined;

    // Tundra ground slow (non-ice tiles, existing behavior)
    const biome = coldGround ? getBiome(ptx, pty) : null;
    if (biome === 'tundra') {
      if (isPlayer && !actor._inTundra) {
        actor._inTundra = true;
        this._log(`${name} entered tundra (speed x0.7)`, 'combat');
      }
      this._scaleVel(actor, 0.7, isPlayer);
    } else {
      actor._tvx = undefined; // no slow active: forget what we last wrote
      if (isPlayer && actor._inTundra) {
        actor._inTundra = false;
        this._log(`${name} left tundra`, 'combat');
      }
    }
  }

  // Scale an actor's velocity by m. Players: every frame (movePlayer rewrites it). AI actors:
  // only when the AI wrote a new velocity since our last scale, else a wanderer would decay to a stop.
  _scaleVel(actor, m, isPlayer) {
    const v = actor.spr.body.velocity;
    if (!isPlayer && actor._tvx !== undefined && Math.abs(v.x - actor._tvx) < 0.01 && Math.abs(v.y - actor._tvy) < 0.01) return;
    if (v.x === 0 && v.y === 0) { if (!isPlayer) actor._tvx = undefined; return; }
    actor.spr.setVelocity(v.x * m, v.y * m);
    if (!isPlayer) { actor._tvx = actor.spr.body.velocity.x; actor._tvy = actor.spr.body.velocity.y; }
  }

  // Wading: while a player stands in shallow water, the lower half of their sprite is cut
  // away (the water tile behind shows through) and a thin water-surface strip marks the waist.
  _updateWaterSubmersion(p) {
    if (!p || !p.waterOverlay || !p.waterOverlay.active) return;
    const s = p.spr;
    const wading = p._inShallowWater && !p.isDowned && s.visible;
    p.waterOverlay.setVisible(!!wading);
    if (!wading) {
      if (p._wadeCrop) { s.setCrop(); p._wadeCrop = false; }
      return;
    }
    s.setCrop(0, 0, s.frame.width, s.frame.height * 0.5);
    p._wadeCrop = true;
    p.waterOverlay.setPosition(s.x, s.y).setDisplaySize(s.displayWidth * 0.8, 6)
      .setAlpha(0.9).setDepth(s.depth + 0.0001);
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
      fontFamily: 'monospace', fontSize: '12px', color: '#ff4444', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(8));
    if (this.hudCam) this.hudCam.ignore(cacheLbl);
    const cachePrompt = this._w(this.add.text(cx, cy + 52 - 46, 'E \u2014 open cache', {
      fontFamily: 'monospace', fontSize: '12px', color: '#ccaa00',
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
      const spr = this.physics.add.image(rx, ry, 'raider_atlas', texKey).setScale(1.25).setDepth(9);
      spr.setCollideWorldBounds(true);
      spr.body.setSize(32, 40);
      if (this.hudCam) this.hudCam.ignore(spr);
      this.physics.add.collider(spr, this.obstacles);

      // Difficulty scaling — matches regular enemy formula (10% per day, caps at 3×)
      const diffScale = this._diffMult();
      const stats = RAIDER_STATS[rtype];

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
    const stats = RAIDER_STATS;
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
      const spr = this.physics.add.image(rx, ry, 'raider_atlas', texKey).setScale(1.25).setDepth(9);
      spr.setCollideWorldBounds(true);
      spr.body.setSize(32, 40);
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
    // When a charmer (Lauren) is in play, raiders are her allies — their movement +
    // attack is driven by the ally AI in updateEnemies. Skip the hostile raider AI
    // here so it doesn't override that velocity and re-aim them at the players.
    const _charmerAlive = [this.p1, this.p2].some(
      p => p && p.charData && p.charData.id === 'charmer' && !p.isDowned && p.spr && p.spr.active
    );

    this.raiders.forEach(raider => {
      if (raider.hp <= 0 || !raider.spr.active) return;
      if (_charmerAlive && !raider._aggroOverride) return; // charmed ally — handled by updateEnemies
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
        this.hint('⚠ Raiders closing in — get ready!', 4000, { urgent: true });
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
        const t = ENEMY_STATS[type];
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
        const atkInterval = Math.max(500, Math.round(t.atkInterval / D));
        const e = { spr, hp, maxHp:hp, speed:spd, dmg, atkInterval, type, attackTimer:0, wanderTimer:0, aggroRange:t.aggro, attackRange:30*sizeMult, sizeMult, _den: den, home: { x: den.x, y: den.y } };
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
      player.walkTimer = (player.walkTimer + 1) % 40;
      const step = _walkStep(player.walkTimer);
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
    // Facing rule (Jared): with a mouse in use, always face the cursor, even while walking;
    // with no mouse (keyboard only), keep the walking direction movePlayer set and aim that way.
    // ponytail: "in use" = mouse moved or clicked in the last 4 s; a stale cursor hands facing back to walking.
    if (this.time.now - this._mouseAt > 4000) { player.aimAngle = undefined; return; }
    player.aimAngle = Phaser.Math.Angle.Between(player.spr.x, player.spr.y, worldX, worldY);
    if (this.time.now < (player.atkAnimUntil || 0)) return;
    this._faceAngle(player, player.aimAngle);
    const moving = player.spr.body.velocity.x !== 0 || player.spr.body.velocity.y !== 0;
    const dirSuffix = player.dir === 'side' ? '' : ('_' + player.dir);
    player.spr.setTexture('player_atlas', player.charData.id + dirSuffix + (moving ? _walkStep(player.walkTimer) : ''));
  }

  // 8-directional facing from an angle (8 sectors of 45°); diagonals use fside/bside.
  _faceAngle(player, a) {
    const PI8 = Math.PI / 8;  // 22.5°
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
  }

  _triggerAtkAnim(player, dur) {
    const id = player.charData.id;
    if (this.solo && player === this.p1 && player.aimAngle !== undefined && !this._touchActive) this._faceAngle(player, player.aimAngle);
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
            fontFamily: 'monospace', fontSize: '12px', color: '#ccddff',
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

  // A non-Gunslinger carrying ammo tops up a live Gunslinger who is within barracks distance.
  _handOverAmmo() {
    const gun = [this.p1, this.p2].find(p => p && p.charData.id === 'gunslinger' && !p.isDowned && p.spr?.active);
    if (!gun) return;
    for (const p of [this.p1, this.p2]) {
      if (!p || p === gun || !(p.carriedAmmo > 0) || p.isDowned || !p.spr?.active) continue;
      if (Phaser.Math.Distance.Between(p.spr.x, p.spr.y, gun.spr.x, gun.spr.y) >= 110) continue;
      const room = Math.max(0, 40 - gun.ammo - gun.reserveAmmo);
      const moved = Math.min(p.carriedAmmo, room);
      if (moved <= 0) continue;
      p.carriedAmmo -= moved;
      gun.reserveAmmo += moved;
      this._hudDirty = true;
      this._log(`${p.charData.player} handed ${moved} ammo to ${gun.charData.player}  reserve=${gun.reserveAmmo}  carried=${p.carriedAmmo}`, 'player');
    }
  }

  doAlt(player) {
    const id = player.charData.id;
    if (id === 'gunslinger') {
      const clipSize = player._gunslingerClip || 8;
      // Reloads draw only from the Gunslinger's own reserve; ammo others carry arrives by hand-over.
      const totalAvailable = player.reserveAmmo || 0;
      if (player.ammo < clipSize && !player.reloading && totalAvailable > 0) {
        player.reloading = true;
        SFX.reload();
        this.hint('Reloading\u2026 (' + totalAvailable + ' available)', 1500);
        this.time.delayedCall(1500, () => {
          const needed = clipSize - player.ammo;
          let fill = Math.min(needed, player.reserveAmmo);
          player.ammo += fill;
          player.reserveAmmo -= fill;
          player.reloading = false;
          this._log(`${player.charData.player} reloaded  ammo=${player.ammo}  reserve=${player.reserveAmmo}`, 'player');
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
      rallyTarget._rallyUntil = this.time.now + 5000;
      this._hudDirty = true;
      this.time.delayedCall(5000, () => {
        rallyTarget.charData.speed = origSpeed;
        this._hudDirty = true;
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
        // Throttle the reminder — mashing attack with no flowers used to spam it ~7×/5s.
        if (this.time.now > (player._noFlowerHintAt || 0)) {
          player._noFlowerHintAt = this.time.now + 4000;
          this.hint('No flowers! Craft a Flower Bouquet.', 2000);
        }
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
      if (g.follow) {
        const fs = g.follow.spr;
        const lit = fs && fs.active && !g.follow.isDowned && nightNorm > 0;
        for (let k = 0; k < g.sprites.length; k++) g.sprites[k].setVisible(!!lit);
        if (!lit) continue;
        g.x = fs.x; g.y = fs.y + 6;
        for (let k = 0; k < g.sprites.length; k++) g.sprites[k].setPosition(g.x, g.y);
        const flick = 0.85 + 0.15 * Math.sin(t * 7.1 + g.phase) * Math.sin(t * 2.3);
        for (let k = 0; k < g.sprites.length; k++) {
          const sp = g.sprites[k];
          sp.alpha = sp._baseAlpha * nightNorm * flick;
        }
        continue;
      }

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
    // Don't force-resume if the player has the pause/Settings screen open — they
    // paused on purpose. Auto-resuming would unpause the world behind the still-open
    // (semi-transparent) menu, so enemies could move and kill them while "paused".
    const _settingsOpen = this.scene && this.scene.isActive && this.scene.isActive('Settings');
    if (!_settingsOpen && this.scene && this.scene.isPaused('Game')) this.scene.resume('Game');
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

    // Raiders carry the unprefixed type ('brawler'); SCOUT_DATA keys them 'raider_*'.
    const data = SCOUT_DATA[nearest.isRaider ? 'raider_' + nearest.type : nearest.type];
    if (!data) { this._hideScoutPanel(); return; }

    // Build panel lazily
    const { W, H } = CFG;
    if (!this._scoutPanel) {
      this._scoutPanel = {
        bg:   this._h(this.add.graphics().setDepth(105)),
        name: this._h(this.add.text(0, 0, '', { fontFamily:'monospace', fontSize:'12px', color:'#ffddaa', stroke:'#000', strokeThickness:2 }).setDepth(106)),
        atk:  this._h(this.add.text(0, 0, '', { fontFamily:'monospace', fontSize:'12px', color:'#ff9966' }).setDepth(106)),
        weak: this._h(this.add.text(0, 0, '', { fontFamily:'monospace', fontSize:'12px', color:'#88ff88' }).setDepth(106)),
        note: this._h(this.add.text(0, 0, '', { fontFamily:'monospace', fontSize:'12px', color:'#ddccff', wordWrap:{ width: 160 } }).setDepth(106)),
        visible: false,
      };
    }

    const p = this._scoutPanel;
    const px = W - 14, py = H / 2 - 40;
    const nameStr = nearest.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    p.bg.clear();
    p.bg.fillStyle(0x000000, 0.75); p.bg.fillRoundedRect(px - 178, py - 6, 178, 104, 6);
    p.bg.lineStyle(1, 0x886633, 0.8); p.bg.strokeRoundedRect(px - 178, py - 6, 178, 104, 6);

    p.name.setText('>> ' + nameStr).setPosition(px - 172, py);
    p.atk.setText('ATK: ' + data.atk).setPosition(px - 172, py + 18);
    p.weak.setText('WEAK: ' + data.weak).setPosition(px - 172, py + 34);
    p.note.setText(data.note).setPosition(px - 172, py + 52);

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
          this._hurtEnemy(e, CFG.SPIKE_TRAP_DMG, st.x, st.y, 0xff2233, st._builder || null);
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
            const newTree = this._placeScenery(Math.floor(sx / TILE), Math.floor(sy / TILE), treeKey, 0);
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
      // Type-specific drops via lookup table (flags: 0=plain rdm, 1=foodMult*rdm, 2=rare/hc-blocked)
      const _loot = ENEMY_LOOT[enemyType];
      if (_loot) {
        for (const [item, chance, flags] of _loot) {
          if (flags === 2 && this.hc.rareDropsBossOnly) continue;
          if (Math.random() < chance * (flags === 1 ? foodMult : 1) * rdm) drops.push(item);
        }
      } else {
        // Fallback so an enemy type with no table entry still drops something.
        if (Math.random() < 0.4 * foodMult * rdm) drops.push('item_food');
        if (Math.random() < 0.3 * rdm) drops.push('item_fiber');
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
            player.carriedAmmo += 3;
            this._log(`${player.charData.player} picked up ammo (carried)  carried=${player.carriedAmmo}`, 'player');
            label = '+3 Ammo (carried)';
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
            this._hudDirty = true;
            this._log(`${player.charData.player} stored food (full HP)  inv=${JSON.stringify(player.inv)}`, 'player');
            label = '+1 Food';
          }
        } else {
          player.inv[item.itemType] = (player.inv[item.itemType] || 0) + 1;
          this.resourcesGathered++;
          this._hudDirty = true;
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

  // Speed-specific multiplier — hard-capped at 1.4× so enemies top out near
  // average player speed (~171 px/s). Fastest common enemy (ice crawler, base 130)
  // hits ~182 at cap — above avg player but jukeble. HP/dmg keep scaling via _diffMult().
  _diffSpeedMult() {
    return Math.min(1.4, this._diffMult());
  }

  _relicPressure() {
    const d = this.relicsDeposited || 0;
    return {
      speedMult: 1 + d * 0.18,
      dmgMult:   1 + d * 0.15,
      aggroMult: 1 + d * 0.25,
    };
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
          const cdx = player.spr.x - cached.body.center.x, cdy = player.spr.y - cached.body.center.y; // trees stand on their base; measure to the trunk box
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
            const odx = player.spr.x - obj.body.center.x, ody = player.spr.y - obj.body.center.y;
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
              this._hudDirty = true;
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
          // A stump stays where the tree stood: decoration only (no body), sorted like other scenery.
          const _stumpKey = TREE_STUMP[nearestTree.texture.key];
          if (_stumpKey) {
            const _st = this.add.image(nearestTree.x, nearestTree.y, _stumpKey, Math.min(2, Number(nearestTree.frame.name) || 0))
              .setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(this._sortDepth(nearestTree.y));
            this._w(_st);
            if (this.hudCam) this.hudCam.ignore(_st);
          }
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
      this._shelterDirty = true;
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

    // Clock ring: the track shades the night span (where isNight is true: 60% to ~97% of the
    // cycle, from the nightAlpha ramp above), so the gap from the hand to it is the time left
    // before night. The arc turns red for the last 20 s of game time before night (#266).
    // Redrawn only when pct crosses a 0.5% step or the warning flips.
    if (this.clockGfx) {
      const NIGHT_START = 0.6, NIGHT_END = 0.9667;
      const warn = !this.isNight && pct < NIGHT_START && (NIGHT_START - pct) * this.DAY_DUR <= 20000;
      const clockKey = Math.round(pct * 200) * 2 + (warn ? 1 : 0);
      if (this._lastClockStep !== clockKey) {
        this._lastClockStep = clockKey;
        this.clockGfx.clear();
        const cx = CFG.W / 2, cy = 38, r = 12, top = -Math.PI / 2, TAU = Math.PI * 2;
        this.clockGfx.lineStyle(4, 0x333344, 0.7).strokeCircle(cx, cy, r);
        this.clockGfx.lineStyle(4, 0x223366, 0.9).beginPath()
          .arc(cx, cy, r, top + NIGHT_START * TAU, top + NIGHT_END * TAU, false, 0.02).strokePath();
        const arcColor = warn ? 0xff3344
          : this.isNight ? 0x6688ff
          : pct >= NIGHT_END ? 0xdd7799  // dawn
          : 0xffdd44;                    // day (the warning covers dusk)
        this.clockGfx.lineStyle(4, arcColor, 0.95).beginPath()
          .arc(cx, cy, r, top, top + pct * TAU, false, 0.02).strokePath();
        const a = top + pct * TAU;
        this.clockGfx.fillStyle(arcColor, 1).fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.5);
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
            player.carriedAmmo += 4;
            this._log(`${player.charData.player} crate ammo (carried)  carried=${player.carriedAmmo}`, 'player');
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
            this._hudDirty = true;
            this._log(`${player.charData.player} crate food stored (full HP)  inv=${JSON.stringify(player.inv)}`, 'player');
          }
        } else {
          player.inv[crate.itemType] = (player.inv[crate.itemType] || 0) + 2;
          this.resourcesGathered += 2;
          this._hudDirty = true;
          this._log(`${player.charData.player} crate ${crate.itemType}  inv=${JSON.stringify(player.inv)}`, 'player');
        }
        SFX._play(720, 'sine', 0.1, 0.08);
        crate.destroy();
      };
      this.physics.add.overlap(this.p1.spr, crate, () => { if(crate.active) pickupCrate(this.p1); });
      if (this.p2) this.physics.add.overlap(this.p2.spr, crate, () => { if(crate.active) pickupCrate(this.p2); });
    });
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
      { label: 'Bed',                key: 'bed',               cost: {wood:8, fiber:6, metal:2},needsBench: true,  type: 'build',   tooltip: 'Sleep in it to heal over time. When everyone sleeps, the night skips ahead.' },
      { label: 'Reinforced Wall',    key: 'reinforced_wall',   cost: {wood:4, metal:3},         needsBench: true,  type: 'build',   tooltip: 'Twice as durable as a standard wall. Holds the line against heavy raids.' },
      { label: 'Med Kit (+40 HP)',   key: 'med_kit',           cost: {fiber:3, food:2},         needsBench: true,  type: 'instant', tooltip: 'Instantly restores 40 HP to the crafter. Use when critically wounded.' },
      { label: 'Ammo Pack (+8)',     key: 'ammo_pack',         cost: {metal:2},                 needsBench: false, type: 'instant', charId: 'gunslinger', tooltip: 'Gunslinger only: adds 8 rounds to the Gunslinger\'s reserve immediately.' },
      { label: 'Knight Upgrade',     key: 'knight_upgrade',    cost: {metal:3, fiber:2},        needsBench: true,  type: 'upgrade', charId: 'knight',     tooltip: 'Knight: unlocks Shield Throw ability + passive 70% damage block.' },
      { label: 'Architect Upgrade',  key: 'architect_upgrade', cost: {metal:3, wood:2},         needsBench: true,  type: 'upgrade', charId: 'architect',  tooltip: 'Architect: unlocks Nail Gun secondary attack.' },
      { label: 'Gunslinger Upgrade', key: 'gunslinger_upgrade',cost: {metal:2, fiber:1},        needsBench: true,  type: 'upgrade', charId: 'gunslinger', tooltip: 'Gunslinger: increases clip size by 4 rounds (8 → 12).' },
      { label: 'Flower Bouquet (+8)',key: 'flower_bouquet',    cost: {wood:1, fiber:1},         needsBench: false, type: 'instant', charId: 'charmer',    tooltip: 'Lauren only: gives her 8 flower tosses immediately.' },
      { label: 'Lauren Upgrade',     key: 'charmer_upgrade',   cost: {metal:2, fiber:2},        needsBench: true,  type: 'upgrade', charId: 'charmer',    tooltip: 'Lauren: daytime charm aura 200→280px; night aura 0→140px.' },
      { label: 'Abigail Upgrade',    key: 'ranger_upgrade',    cost: {metal:3, wood:2},         needsBench: true,  type: 'upgrade', charId: 'ranger',     tooltip: 'Abigail: unlocks Ranger passive buff and special ability.' },
    ];
  }
}

