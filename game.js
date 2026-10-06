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
//   src/sprites.js       — Player + raider art as hand-placed pixel grids (one char = one pixel)
//                          paintGrid, pixelActorFrames, buildPixelActors,
//                          SPRITE_ART, PLAYER_PAL, LEGS;
//                          scenery (trees, rocks, bush, mushroom, wall): SCENERY_SPECS, buildScenery, ART_SCALE, WALL_SCALE
//
//   src/textures.js      — Procedural texture generation (no image files)
//                          drawWolf, drawRat, drawBear, drawIceCrawler,
//                          drawSpiderRuins, drawBogLurker, drawDustHound, drawWaterLurker
//                          buildTextures, buildAtlases,
//                          drawMountains, polishActors, polishActor,
//                          makeScaleProxy, getControls (the controls help text)
//
//   src/scenes.js        — All non-gameplay scenes + input helpers
//                          DEFAULT_BINDINGS, keyDisplayName,
//                          ControlsScene, BootScene, ModeSelectScene,
//                          SettingsScene, CharSelectScene
//
//   src/game-scene.js    — GameScene: gameplay systems 3, 5-7, 9-16 and 19-23 (see list below)
//                          Also: GameScene.RECIPES static property (system 8's recipe list)
//
//   src/world-gen.js     — System 1, added to GameScene.prototype; loads after game-scene.js
//
//   src/waves-bosses.js  — System 4, added to GameScene.prototype; loads after world-gen.js
//
//   src/building-crafting.js — System 8, added to GameScene.prototype; loads after waves-bosses.js
//
//   src/enemy-ai.js      — System 2, added to GameScene.prototype; loads after building-crafting.js
//
//   src/game-over.js     — GameOverScene (death + stats screen)
//
// ── GAMEPLAY SYSTEMS (in src/game-scene.js unless noted) ─────
// Each system lists its primary functions and relevant CFG keys.
// A heading's note names every file its functions live in; npm run check verifies it.
//
// 1. WORLD / TERRAIN GENERATION  (src/world-gen.js; biome fns in src/constants.js; the ambient anim stays in update())
//    fns:  buildWorld, _buildPonds, _buildLakes, _buildRivers,
//          buildPOIs, buildRuinsCity, buildBiomeStructures,
//          _placeScenery (trees/rocks stand on their tile base; body set after refreshBody)
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
// 2. ENEMY AI / PATHFINDING / DAMAGE  (src/enemy-ai.js)
//    fns:  updateEnemies, _steerToward, _hasLOS,
//          _findWallOnPath, _hurtEnemy,
//          killEnemy, _startDormantIfFar
//    spawn: spawnEnemies, _spawnGroup, _spawnBiomeEnemy,
//           _spawnWaterLurker
//    cfg:  MAX_ENEMIES, MAX_ACTIVE_ENEMIES, DORMANT_RADIUS, WAKE_RADIUS
//    data: enemies[], ENEMY_STATS, ENEMY_LOOT
//    log:  [COMBAT], [WORLD ]
//
// 3. ENEMY DENS / RESPAWN
//    fns:  updateEnemyDens, updateWaterDens
//    data: enemyDens[], waterDens[]   (each: liveCount, type, pos, timer)
//
// 4. WAVES & BOSSES  (src/waves-bosses.js)
//    fns:  updateWaves, updateBoss, spawnBoss, _bossExecuteSpecial,
//          _bossSmash, _bossTelegraph
//    data: waveNum, waveTimer, boss, _bossChance, huntNextDay
//    log:  [WORLD ], [COMBAT]
//
// 5. PLAYER MOVEMENT & INPUT  (src/game-scene.js; getControls in src/textures.js)
//    fns:  movePlayer, aimAtMouse (faces the cursor while _mouseAt is recent), _faceAngle,
//          applyTouchInput, applyTerrainEffects,
//          getControls, initTouchControls, _onTouchDown/Move/Up,
//          openPauseSettings, _walkStep,
//          tryInteract (the Interact key: build teardown, barracks, radio tower, raid cache, bed, relics, altar)
//    data: p1, p2 (spr, hp, maxHp, charData, inv), _joy, _tcBtns, wasd, p2keys
//    cfg:  CAM_PAD, CAM_ZOOM_MIN, CAM_ZOOM_MAX
//
// 6. PLAYER COMBAT (per-character abilities)
//    fns:  doAttack, doAlt, meleeSwing, _triggerAtkAnim, _hitPause,
//          _floatDamage, _knightShieldBlock, _dropSpiderWeb,
//          _emitCharmSparkle, _emitLurkerBubble,
//          _fireArrow, _fireNailGun, _fireShieldThrow, deployTurret
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
// 8. BUILDING & CRAFTING  (src/building-crafting.js; GameScene.RECIPES stays in src/game-scene.js)
//    build: toggleBuildMode, updateBuildMode, placeBuild, exitBuildMode, _placeWallSprite,
//           _tryTeardownBuild, openGate, getBuildCost, getTeamInv
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
//     fns:  updateRaiders, placeRaiderCamp, spawnRaiders, spawnHuntingParty,
//           checkRaidCacheRange, openRaidCache, _fireRaiderShot
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
//           _drawThreatIndicators, hint, _activeStatuses, _drawStatusStrip
//     minimap: _renderMinimapBase, _paintMinimapTile, _unpaintMinimapTile,
//              _buildMinimapColorMap
//     data: hudCam, hudRelicText, minimapGfx, minimapDots, mmBounds, _scoutPanel, _hudDirty,
//           _toxicUntil, _rallyUntil (status-strip timestamps)
//
// 16. FOG OF WAR
//     fns:  revealFog, updateFog, _losBlocked
//     cfg:  FOG_REVEAL_R, FOG_UPDATE_INTERVAL
//     data: fogRevealed (Uint8Array), fogVisible, _fogVisibleBuilding
//
// 17. AUDIO (Web Audio API)  (src/audio.js)
//     class: Music         (background + boss switch via Music.switchToBoss)
//     SFX wired into combat/pickup/build callsites.
//
// 18. PROCEDURAL TEXTURES (no image files)  (src/textures.js; character draws in src/sprites.js)
//     fns:  buildTextures, makeScaleProxy, drawMountains, polishActors, polishActor
//     enemy draws: drawWolf, drawRat, drawBear, drawIceCrawler,
//                  drawSpiderRuins, drawBogLurker, drawDustHound, drawWaterLurker
//     character draws: paintGrid, pixelActorFrames, buildPixelActors
//                      art in SPRITE_ART[id][front|back|side|fside|bside]; step2 = step legs mirrored
//
// 19. INPUT MODES (kbd / gamepad / touch)  (src/scenes.js; getControls in src/textures.js; _onBtnPress in src/game-scene.js)
//     fns:  getControls, activeInputMode, isTouchDevice,
//           _onBtnPress, keyDisplayName
//     data: wasd, p2keys, _joy, _tcBtns
//
// 20. DEBUG LOG & PERF  (src/game-scene.js; _qlog in src/constants.js)
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
// 22. GAME OVER / VICTORY  (src/game-scene.js; GameOverScene in src/game-over.js)
//     fns:  triggerGameOver, _triggerVictory, checkBothDead, handleDeath
//     scene: GameOverScene
//     win condition: relicsDeposited === 5 (deposited at altar)
//
// 23. SETTINGS / SAVE  (src/scenes.js; toggleSleep in src/game-scene.js)
//     fns:  loadSettings, saveSettings, toggleSleep
//     data: STATE (mode/difficulty), persisted via localStorage
//
// ── COMMON GOTCHAS ───────────────────────────────────────────
// • Two cameras: new world objects must call hudCam.ignore(obj).
// • Water detection uses the _waterMap Uint8Array (index tx + ty*MAP_W), NOT physics overlap.
// • Enemy dormancy: enemies > DORMANT_RADIUS are physics-disabled and hidden;
//   they re-enable inside WAKE_RADIUS (hysteresis).
// ============================================================

// ── PHASER GAME INIT ─────────────────────────────────────
const _phaserGame = new Phaser.Game({
  // ?renderer=canvas forces the canvas renderer; the in-play smoke run (scripts/smoke.js)
  // needs it because headless WebKit loses the WebGL context in the Game scene.
  type: new URLSearchParams(location.search).get('renderer') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
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
// Watch the container, not just the window: an embedding pane (or an iPad split view) can
// change size without a window resize event, and a stale size let the CSS max-width squash
// the canvas sideways while its height stayed, stretching the whole game vertically.
new ResizeObserver(() => { if (_phaserGame.canvas) _phaserGame.scale.refresh(); }).observe(document.getElementById('game-container'));
