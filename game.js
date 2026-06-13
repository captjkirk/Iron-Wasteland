'use strict';
// ============================================================
// IRON WASTELAND  |  Local Co-op Survival
// Made for Hudson, Zachary & Jared
// ============================================================
//
// ============================================================
// MANIFEST — NAVIGATION GUIDE
// ============================================================
// The game is split into src/ files loaded in order by index.html.
// All files share global scope (plain <script> tags, no ES modules).
// Use function/class names as grep targets — not line numbers, which drift.
//
//   grep -rn "functionName" src/          # find a definition across all files
//   grep -rn "CFG\.KEY_NAME" src/         # find all uses of a config key
//   grep -rn "_log('\[BUILD" src/         # find all build log entries
//   grep -n  "functionName" src/game-scene.js   # scope to gameplay
//
// ── FILE MAP ─────────────────────────────────────────────────
//   game.js              — THIS FILE. Header + Phaser.Game init only.
//
//   src/constants.js     — Global config + shared state
//                          VERSION, CFG, ENEMY_STATS, ENEMY_LOOT,
//                          _makeMulberry32, _worldRng, _pendingLogMsgs, _qlog,
//                          biome fns (getBiome, _buildBiomeMap, _biomeSeeds …),
//                          CHARS, STATE
//
//   src/audio.js         — Web Audio chiptune engine
//                          Music  (Music.play, Music.stop, Music.switchToBoss …)
//
//   src/textures.js      — Procedural texture generation (no image files)
//                          drawWolf, drawRat, drawBear, drawIceCrawler,
//                          drawSpiderRuins, drawBogLurker, drawDustHound, drawWaterLurker
//                          drawKnight*, drawGunslinger*, drawArchitect*,
//                          drawLauren*/charmer, drawAbigail*/ranger
//                          drawRaiderDirectionals, buildTextures, buildAtlases,
//                          makeScaleProxy
//
//   src/scenes.js        — All non-gameplay scenes + input helpers
//                          DEFAULT_BINDINGS, keyDisplayName, getControls,
//                          ControlsScene, BootScene, ModeSelectScene,
//                          SettingsScene, CharSelectScene
//
//   src/game-scene.js    — GameScene: all 22 gameplay systems (see list below)
//                          Also: GameScene.RECIPES static property
//
//   src/game-over.js     — GameOverScene (death + stats screen)
//
// ── GAMEPLAY SYSTEMS (all in src/game-scene.js) ──────────────
// Each system lists its primary functions and relevant CFG keys.
// Biome/world-gen helpers (getBiome, _buildBiomeMap …) live in src/constants.js.
//
// 1. WORLD / TERRAIN GENERATION
//    fns:  buildWorld, _buildPonds, _buildLakes, _buildRivers,
//          buildPOIs, buildRuinsCity, buildBiomeStructures
//    biome: getBiome, _biomeHash, _biomeNoise, _computeBiomeRaw,
//           _initBiomeSeeds, _buildBiomeMap, _buildBiomeMapChunked
//    placement: _isBlockedForPlacement, _footprintOnWaterOrIce
//    cfg:  MAP_W, MAP_H, TILE, SAFE_R, POND_SPECS, LAKE_SPECS,
//          RIVER_COUNT, RIVER_WANDER, RIVER_WIDTH_MIN, RIVER_WIDTH_MAX,
//          PLACEMENT, ROCKS
//    data: _biomeSeeds, _waterMap, _iceMap, waterTiles, iceTiles,
//          deepWaterTiles, mountainTiles, obstacles
//    ambient anim: _grassGroups, _grassPhase (grass sway);
//          _riverTex, _riverScroll, _riverOffLast + drawRiverFrame (shared scrolling
//          river canvas); _pondWaterTiles, _shimmerTable (pond/lake alpha shimmer)
//    log:  [WORLD ]
//
// 2. ENEMY AI / PATHFINDING / DAMAGE
//    fns:  updateEnemies, _steerToward, _hasLOS, _losBlocked,
//          _findWallOnPath, applyTerrainEffects, _hurtEnemy,
//          killEnemy, _startDormantIfFar
//    spawn: spawnEnemies, _spawnGroup, _spawnBiomeEnemy,
//           _spawnWaterLurker, spawnHuntingParty
//    cfg:  MAX_ENEMIES, MAX_ACTIVE_ENEMIES, DORMANT_RADIUS, WAKE_RADIUS
//    data: enemies[], ENEMY_STATS, ENEMY_LOOT
//    log:  [COMBAT], [WORLD ]
//
// 3. ENEMY DENS / RESPAWN
//    fns:  updateEnemyDens, updateWaterDens
//    data: enemyDens[], waterDens[]   (each: liveCount, type, pos, timer)
//
// 4. WAVES & BOSSES
//    fns:  updateWaves, updateBoss, spawnBoss, _bossExecuteSpecial,
//          _bossSmash, _bossTelegraph, _fireRaiderShot, _fireArrow, _fireNailGun,
//          _fireShieldThrow
//    data: waveNum, waveTimer, boss, _bossChance, huntNextDay
//    log:  [WORLD ], [COMBAT]
//
// 5. PLAYER MOVEMENT & INPUT
//    fns:  movePlayer, aimAtMouse, applyTouchInput, applyTerrainEffects,
//          getControls, initTouchControls, _onTouchDown/Move/Up,
//          openPauseSettings
//    data: p1, p2 (spr, hp, maxHp, charData, inv), _joy, _tcBtns, wasd, p2keys
//    cfg:  CAM_PAD, CAM_ZOOM_MIN, CAM_ZOOM_MAX
//
// 6. PLAYER COMBAT (per-character abilities)
//    fns:  doAttack, doAlt, meleeSwing, _triggerAtkAnim, _hitPause,
//          _floatDamage, _knightShieldBlock, _dropSpiderWeb,
//          _emitCharmSparkle, _emitLurkerBubble
//    chars by id: knight, gunslinger, architect, charmer,
//                 raider, spider, lurker, troll
//    data: player.atkCooldown, player.ammo, player.reserveAmmo, teamAmmoPool
//    log:  [COMBAT], [PLAYER]
//
// 7. DEATH & REVIVE
//    fns:  handleDeath, checkDeaths, updateDowned, updateRevive,
//          revivePlayer, checkBothDead, buildReviveBar, drawReviveBar,
//          _showSleepIndicator, _hideSleepIndicator
//    cfg:  DOWN_TIME, REVIVE_TIME, REVIVE_RANGE
//    data: player.isDowned, player.downedTimer, reviving, reviveProgress
//    log:  [PLAYER]
//
// 8. BUILDING & CRAFTING
//    build: toggleBuildMode, updateBuildMode, placeBuild, exitBuildMode,
//           tryInteract, _tryTeardownBuild, deployTurret
//    craft: openCraftMenu, closeCraftMenu, updateCraftMenu, craftSelected,
//           renderCraftMenu, _craftScrollToSel
//    barracks: openBarrack, closeBarrack, barrackNav, barrackConfirm,
//              refreshBarrackCards, buildBarrackOverlay, checkBarrackRange
//    data: buildType, buildRotation, buildOwner, RECIPES,
//          structures, teamAmmoPool
//    log:  [BUILD ], [PLAYER]
//
// 9. WALLS / SPIKES / STRUCTURE DAMAGE
//    fns:  updateSpikeTraps, damageStructure, _addWallToBuckets,
//          _removeWallFromBuckets, _wallBucketKey, _wallNearby,
//          _refreshWallClustersNear, _addFireGlow
//    data: structures, spikes, _wallBuckets, _wallTileSet
//    log:  [COMBAT], [BUILD ]
//
// 10. DAY/NIGHT & DIFFICULTY
//     fns:  updateDayNight, _diffMult, _diffSpeedMult, _updateDayLabel
//     data: dayNum, dayTimer, isNight, timeAlive, hardcore, hc
//
// 11. RELICS / RADIO TOWERS / ALTAR / CAMPFIRES
//     fns:  updateRelicChannels, checkRadioTowerRange, _relicCarrier,
//           _relicPressure, _cancelRelicChannel, _depositRelic,
//           _pickupRelic, _showRelicHint, _processHintQueue,
//           _spawnTorch, _addFireGlow, _updateFireGlows
//     cfg:  FOG_REVEAL_R, FOG_UPDATE_INTERVAL
//     data: _relicPOIs, relicsHeld, altarPos, altarDiscovered, _fireGlows
//
// 12. RAIDERS (camps + raid events)
//     fns:  updateRaiders, placeRaiderCamp, spawnRaiders,
//           checkRaidCacheRange, openRaidCache
//     data: raidCamp, raidRespawnDay, raiders
//
// 13. HARVESTING & RESOURCES
//     fns:  setupCratePickups, dropResource, _floatPickup
//     data: crates, items
//     cfg:  ITEM_DESPAWN_MS
//
// 14. CAMERAS (dual-cam: world + HUD)
//     The world camera is `this.cameras.main`; the HUD camera is `this.hudCam`.
//     cfg:  W, H, CAM_PAD, CAM_ZOOM_MIN, CAM_ZOOM_MAX
//     NOTE: any new world object MUST be ignored by hudCam.
//
// 15. HUD / MINIMAP / THREAT INDICATORS
//     fns:  _showStatus, _hideScoutPanel, _updateScoutPanel,
//           _drawThreatIndicators, hint
//     minimap: _renderMinimapBase, _paintMinimapTile, _unpaintMinimapTile,
//              _buildMinimapColorMap
//     data: hudCam, hudRelicText, minimapGfx, minimapDots, mmBounds, _scoutPanel, _hudDirty
//
// 16. FOG OF WAR
//     fns:  revealFog, updateFog, _hasLOS, _losBlocked
//     cfg:  FOG_REVEAL_R, FOG_UPDATE_INTERVAL
//     data: fogRevealed (Uint8Array), fogVisible, _fogVisibleBuilding
//
// 17. AUDIO (Web Audio API)
//     class: Music         (background + boss switch via Music.switchToBoss)
//     SFX wired into combat/pickup/build callsites.
//
// 18. PROCEDURAL TEXTURES (no image files)
//     fns:  buildTextures, makeScaleProxy
//     enemy draws: drawWolf, drawRat, drawBear, drawIceCrawler,
//                  drawSpiderRuins, drawBogLurker, drawDustHound, drawWaterLurker
//     character draws: drawKnight*, drawGunslinger*, drawArchitect*,
//                      drawLauren* (charmer), drawAbigail* (charmer alt)
//                      directional variants: Step/Front/Back/FSide/BSide/Atk
//
// 19. INPUT MODES (kbd / gamepad / touch)
//     fns:  getControls, activeInputMode, isTouchDevice,
//           _onBtnPress, keyDisplayName
//     data: wasd, p2keys, _joy, _tcBtns
//
// 20. DEBUG LOG & PERF
//     fns:  _log, _qlog, _dbgRefresh, _downloadLog, hint
//     log tags: [WORLD ], [PLAYER], [COMBAT], [BUILD ], [perf], [error]
//     data: _dbgEntries (persists across runs), _perfBudget
//     in-game: backtick ` toggles overlay; C copies, G downloads.
//     CLAUDE.md: ALWAYS ASK FOR THE LOG when investigating bugs.
//
// 21. TUTORIAL
//     fns:  startTutorial, _tutTrigger, _showNextTutTip,
//           _clearTutObjs, _endTutorial
//     cfg:  TUT_AUTO_ADVANCE_MS
//     data: _tutShown, _tutObjs, _tutQueue
//
// 22. GAME OVER / VICTORY
//     fns:  triggerGameOver, _triggerVictory, checkBothDead, handleDeath
//     scene: GameOverScene
//     win condition: relicsHeld === 5 (deposited at altar)
//
// 23. SETTINGS / SAVE
//     fns:  loadSettings, saveSettings, toggleSleep
//     data: STATE (mode/difficulty), persisted via localStorage
//
// ── COMMON GOTCHAS ───────────────────────────────────────────
// • Two cameras: new world objects must call hudCam.ignore(obj).
// • Water detection uses the _waterMap Uint8Array (index tx + ty*MAP_W), NOT physics overlap.
// • Enemy dormancy: enemies > DORMANT_RADIUS are physics-disabled and hidden;
//   they re-enable inside WAKE_RADIUS (hysteresis).
// • Edits must also land in the canonical iCloud folder (see CLAUDE.md).
// ============================================================

// ── PHASER GAME INIT ─────────────────────────────────────
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
  scene: [BootScene, ModeSelectScene, SettingsScene, ControlsScene, CharSelectScene, GameScene, GameOverScene],
});
// iOS PWA standalone mode: viewport layout may settle slightly after JS starts.
// A deferred refresh ensures the canvas fills the container correctly.
setTimeout(() => _phaserGame.scale.refresh(), 150);
window.addEventListener('resize', () => _phaserGame.scale.refresh());
