'use strict';
// ── src/world-gen.js — GameScene system 1: world / terrain generation ─────────
// Loads right after src/game-scene.js and adds these methods to GameScene (ADR 0002).
// create() calls _initBiomeSeeds and buildWorld; updateTreeSeeds reuses _placeScenery.

// Tile index in 'water_tileset' (see buildTextures).
const WATER_TILE = { shallow: 0, deep: 1, ice: 2 };
// The deep part of a pond or lake ('x,y' keys): cells whose eight neighbours are all in the blob,
// kept only where four of them make a 2×2 square. So deep water is a solid core at least one tile
// in from every shore, never a lone dark square or a one-tile line.
function _deepCore(tileSet) {
  const has = (x, y) => tileSet.has(x + ',' + y);
  const cand = new Set();
  tileSet.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    if ([-1, 0, 1].every(dx => [-1, 0, 1].every(dy => has(x + dx, y + dy)))) cand.add(key);
  });
  const c = (x, y) => cand.has(x + ',' + y);
  const core = new Set();
  cand.forEach(key => {
    const [x, y] = key.split(',').map(Number);
    if ([[-1, -1], [0, -1], [-1, 0], [0, 0]].some(([ox, oy]) =>
      c(x + ox, y + oy) && c(x + ox + 1, y + oy) && c(x + ox, y + oy + 1) && c(x + ox + 1, y + oy + 1))) core.add(key);
  });
  return core;
}

// Static hitbox in texture pixels, scaled with the sprite. refreshBody() resets a static body to
// the whole sprite and drops its offset (Phaser 3.60), so it runs first, then size and offset (#268).
function staticHitbox(spr, w, h, ox, oy) {
  const s = spr.scaleX;
  spr.refreshBody();
  spr.body.setSize(w * s, h * s, false).setOffset(ox * s, oy * s);
  return spr;
}

Object.assign(GameScene.prototype, {
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
  },

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
  },

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
  },

  // ── WORLD ──────────────────────────────────────────────────
  buildWorld(worldW, worldH, cx, cy) {
    const { TILE, SAFE_R } = CFG;
    const stx = cx/TILE, sty = cy/TILE;

    // Ground: one Tilemap layer, one tile per map cell, from 'ground_tileset' (see buildTextures).
    // Tile index = position of the biome's ground in GROUND_KEYS.
    const groundTile = { grass:0, waste:1, swamp:2, tundra:3, ruins:4, fungal:5, desert:6 };
    const _before = this.children.length;
    const map = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: CFG.MAP_W, height: CFG.MAP_H });
    const tiles = map.addTilesetImage('ground', 'ground_tileset', TILE, TILE, 0, 0);
    const ground = map.createBlankLayer('ground', tiles, 0, 0).setDepth(0.5);
    this._w(ground);
    // Water: two more layers, each on a map of its own so tile indices start at 0 in every tileset
    // (tilesets that share one map share one index space). 'water' holds shallow, deep and ice
    // cells; 'river' holds river cells, whose tileset is the shared animated 'water_river' canvas
    // (see GameScene update). Deep ponds also keep an invisible physics sprite each, so they block.
    const _layer = (name, tileset) => {
      const m = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: CFG.MAP_W, height: CFG.MAP_H });
      return this._w(m.createBlankLayer(name, m.addTilesetImage(name, tileset, TILE, TILE, 0, 0), 0, 0).setDepth(0.75));
    };
    this._waterLayer = _layer('water', 'water_tileset');
    this._riverLayer = _layer('river', 'water_river');
    for (let tx = 0; tx < CFG.MAP_W; tx++) {
      for (let ty = 0; ty < CFG.MAP_H; ty++) {
        // Row 0 of the tileset is the base tile, rows 1-3 its variants (see buildTextures). A hash of the
        // cell picks the row, so a seed always paints the same ground: 55% base, 15% each variant.
        const h = _biomeHash(tx * 3 + 1, ty * 5 + 2);
        const row = h < 0.55 ? 0 : h < 0.70 ? 1 : h < 0.85 ? 2 : 3;
        ground.putTileAt(row * GROUND_KEYS.length + (groundTile[getBiome(tx, ty)] || 0), tx, ty);
      }
    }
    this._log(`ground tile layer: ${CFG.MAP_W * CFG.MAP_H} tiles, display objects ${_before} -> ${this.children.length}`, 'world');

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

    // One density mask for the scatter below: low-frequency noise gives dense patches and bare flats.
    // A tile is kept when _worldRng() <= density. The mean density is ~0.47, so each scatter loop
    // runs SCATTER_X times as many tries to keep the total near what an even sprinkle gave.
    const SCATTER_X = 2;
    const _density = (tx, ty) => Math.min(1, Math.max(0, (_biomeNoise(tx, ty, 50) - 0.3) * 2));
    const _sparse = (tx, ty) => _worldRng() > _density(tx, ty);

    // Tall grass — biome-specific decorative blades (depth 4 = below player, above ground)
    const tallGrassMap = { grass:'tall_grass', waste:'tall_grass_waste', tundra:'tall_grass_tundra', swamp:'tall_grass_swamp', desert:'tall_grass_waste' };
    for (let i = 0; i < 2500 * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-3), ty = Phaser.Math.Between(2, CFG.MAP_H-3);
      if (_sparse(tx, ty)) continue;
      if (Math.abs(tx-stx) < SAFE_R+3 && Math.abs(ty-sty) < SAFE_R+3) continue;
      const biome = getBiome(tx, ty);
      const key = tallGrassMap[biome];
      if (!key) continue; // ruins gets no tall grass
      const sc = Phaser.Math.FloatBetween(0.7, 1.3);
      const ox = Phaser.Math.Between(-10, 10), oy = Phaser.Math.Between(-8, 8);
      const _gs = this._w(this.add.image(tx*TILE+ox, ty*TILE+oy, key + ['', '_2', '_3'][Phaser.Math.Between(0, 2)])
        .setOrigin(0.5, 1).setScale(sc).setDepth(4 + ty*0.001).setAlpha(0.82));
      this._grassGroups[i % 3].push(_gs);
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
      const t = this._placeScenery(tx, ty, treeKey);
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
    for (let i = 0; i < 180 * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-2), ty = Phaser.Math.Between(2, CFG.MAP_H-2);
      if (_sparse(tx, ty)) continue;
      placeTree(tx, ty, getBiome(tx, ty));
    }

    // Great Trees — landmark-scale trees, 2-3 per relevant biome
    const greatTreeBiomes = [
      { biome: 'grass',  key: 'great_oak' },
      { biome: 'tundra', key: 'great_pine' },
      { biome: 'swamp',  key: 'great_mangrove' },
    ];
    for (const { biome, key } of greatTreeBiomes) {
      let placed = 0;
      for (let att = 0; att < 120 && placed < 3; att++) {
        const tx = Phaser.Math.Between(8, CFG.MAP_W-8);
        const ty = Phaser.Math.Between(8, CFG.MAP_H-8);
        if (getBiome(tx, ty) !== biome) continue;
        if (Math.abs(tx-stx) < SAFE_R+6 && Math.abs(ty-sty) < SAFE_R+6) continue;
        if (treesPlaced.some(p => Math.abs(p.tx-tx) <= 2 && Math.abs(p.ty-ty) <= 2)) continue;
        Phaser.Math.FloatBetween(2.6, 3.4); // ponytail: keeps the seeded world's random sequence unchanged
        const t = this._placeScenery(tx, ty, key, 0);
        t.isTree = true;
        treesPlaced.push({ tx, ty });
        placed++;
      }
    }

    // Rocks — biome-appropriate
    for (let i = 0; i < CFG.ROCKS * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(1, CFG.MAP_W-2), ty = Phaser.Math.Between(1, CFG.MAP_H-2);
      if (_sparse(tx, ty)) continue;
      if (Math.abs(tx-stx)<SAFE_R && Math.abs(ty-sty)<SAFE_R) continue;
      const biome = getBiome(tx, ty);
      const rockKey = biome === 'tundra' ? 'ice_rock' : biome === 'desert' ? 'rock_desert' : 'rock';
      this._placeScenery(tx, ty, rockKey);
    }

    // Extra rocks in wasteland
    for (let i = 0; i < 180 * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(1, CFG.MAP_W-2), ty = Phaser.Math.Between(1, CFG.MAP_H-2);
      if (_sparse(tx, ty)) continue;
      if (getBiome(tx, ty) !== 'waste') continue;
      this._placeScenery(tx, ty, 'rock');
    }

    // ── BIOME-SPECIFIC TERRAIN OBSTACLES ────────────────────────
    // Ice spires — tundra (impassable jagged ice formations)
    for (let i = 0; i < 80 * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-2), ty = Phaser.Math.Between(2, CFG.MAP_H-2);
      if (_sparse(tx, ty)) continue;
      if (getBiome(tx, ty) !== 'tundra') continue;
      if (Math.abs(tx-stx)<SAFE_R+3 && Math.abs(ty-sty)<SAFE_R+3) continue;
      const sc = Phaser.Math.FloatBetween(1.2, 2.2);
      const spr = this.obstacles.create(tx*TILE+8, ty*TILE+6, 'ice_spire');
      spr.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      staticHitbox(spr, 6, 8, 5, 22);
    }
    // Rock spires — wasteland (impassable jagged rock pillars)
    for (let i = 0; i < 80 * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-2), ty = Phaser.Math.Between(2, CFG.MAP_H-2);
      if (_sparse(tx, ty)) continue;
      if (getBiome(tx, ty) !== 'waste') continue;
      if (Math.abs(tx-stx)<SAFE_R+3 && Math.abs(ty-sty)<SAFE_R+3) continue;
      const sc = Phaser.Math.FloatBetween(1.2, 2.0);
      const spr = this.obstacles.create(tx*TILE+7, ty*TILE+8, 'rock_spire');
      spr.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      staticHitbox(spr, 6, 8, 4, 26);
    }
    // Mangrove root clusters — swamp (impassable tangled roots)
    for (let i = 0; i < 55 * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-2), ty = Phaser.Math.Between(2, CFG.MAP_H-2);
      if (_sparse(tx, ty)) continue;
      if (getBiome(tx, ty) !== 'swamp') continue;
      if (Math.abs(tx-stx)<SAFE_R+4 && Math.abs(ty-sty)<SAFE_R+4) continue;
      const sc = Phaser.Math.FloatBetween(1.0, 1.8);
      const spr = this.obstacles.create(tx*TILE+18, ty*TILE+9, 'mangrove_roots');
      spr.setScale(sc).setDepth(5 + ty*0.01).setImmovable(true);
      staticHitbox(spr, 28, 8, 4, 6);
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
    for (let i = 0; i < 120 * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(2, CFG.MAP_W-3), ty = Phaser.Math.Between(2, CFG.MAP_H-3);
      if (_sparse(tx, ty)) continue;
      if (Math.abs(tx-stx)<SAFE_R+3 && Math.abs(ty-sty)<SAFE_R+3) continue;
      const biome = getBiome(tx, ty);
      let decKey = 'bush';
      if (biome === 'swamp') decKey = 'mushroom';
      else if (biome === 'waste') { if (Math.random() < 0.7) continue; } // sparse in waste
      else if (biome === 'tundra') { if (Math.random() < 0.5) continue; } // sparse in tundra
      const frame = Phaser.Math.Between(0, SCENERY_SPECS[decKey].sizes.length - 1);
      this._w(this.add.image(tx*TILE + TILE/2, ty*TILE + TILE - 2, decKey, frame).setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(4));
    }

    // Ruins city — navigable abandoned city grid (replaces scattered pillars)
    this._mmFloorTiles = []; // flat tx,ty pairs — filled by buildRuinsCity for minimap
    this._log('buildWorld: buildRuinsCity start', 'world');
    this.buildRuinsCity(stx, sty, TILE);
    this._log('buildWorld: buildRuinsCity done', 'world');

    // Decorative craters — visual only, non-blocking
    for (let i = 0; i < 36 * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(3, CFG.MAP_W-4), ty = Phaser.Math.Between(3, CFG.MAP_H-4);
      if (_sparse(tx, ty)) continue;
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
    for (let i = 0; i < 55 * SCATTER_X; i++) {
      const tx = Phaser.Math.Between(3, CFG.MAP_W-4), ty = Phaser.Math.Between(3, CFG.MAP_H-4);
      if (_sparse(tx, ty)) continue;
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
    this._fillWaterIslands();
    this._log(`buildWorld: _buildLakes done  water=${(this.waterTiles||[]).length} ice=${(this.iceTiles||[]).length} dens=${(this.waterDens||[]).length}`, 'world');

    // _preCacheTiles already populated above (all POI positions, before tree/rock placement)

    // Mountain ranges — impassable ridgelines with walkable gaps
    this.mountainTiles = [];
    const mtns = this.mountainTiles;
    const mtnMinDist = 2; // tighter packing for visible ridgeline
    const MTN_KEYS = ['mountain', 'mountain2', 'mountain3', 'mountain4', 'mountain5'];
    const pickMtn = () => MTN_KEYS[Math.floor(Math.random() * MTN_KEYS.length)];
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
      // Every mountain texture is 224×176 with its ground line at texture y=160. Anchor the
      // sprite there (origin 0.5, 160/176) so peaks of any scale share one ground line, and
      // put the ground skirt (depth 1.5, crater layer) on that line.
      this._w(this.add.image(px, py, 'mountain_base').setScale(sc).setDepth(1.5));
      const ob = this.obstacles.create(px, py, key);
      ob.setOrigin(0.5, 160 / 176).setScale(sc).setDepth(this._sortDepth(py)).setImmovable(true);
      // Blocks the body of the peak (texture x 40-184, y 64-160), so nobody walks behind a mountain
      // (#301); the open sky beside the slopes and above the summit stays walkable (#268). Ridges sit
      // 2 tiles apart, so neighbouring boxes overlap and a ridge stays solid.
      staticHitbox(ob, 144, 96, 40, 64);
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
      placeMtn(tx, ty, pickMtn(), Phaser.Math.FloatBetween(1.0, 1.4));
      // Double-layer: second ring row for a thick visible ridge (skip in exit zones)
      if (Math.random() < 0.6) {
        const tx2 = Math.round(stx + Math.cos(angle) * (ringR + 3 + Math.sin(angle*5)*2));
        const ty2 = Math.round(sty + Math.sin(angle) * (ringR + 3 + Math.cos(angle*3)*2));
        placeMtn(tx2, ty2, pickMtn(), Phaser.Math.FloatBetween(0.9, 1.2));
      }
    }

    // Large mountain clusters in outer biomes — 8-15 mountains each. Per seed: each centre is
    // jittered by up to +/-8% of the map size, and 1-2 of the eight clusters are dropped. Everything
    // here draws from _worldRng, so the same seed gives the same cluster layout.
    const _crng = _worldRng;
    const _cint = (a, b) => a + Math.floor(_crng() * (b - a + 1));
    const _jit = size => Math.round((_crng() * 2 - 1) * size * 0.08);
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
    for (const cc of clusterCenters) { // jitter, but keep the whole cluster (+/-8 tiles) on the map
      cc.tx = Phaser.Math.Clamp(cc.tx + _jit(CFG.MAP_W), 10, CFG.MAP_W - 11);
      cc.ty = Phaser.Math.Clamp(cc.ty + _jit(CFG.MAP_H), 10, CFG.MAP_H - 11);
    }
    for (let drop = _cint(1, 2); drop > 0; drop--) clusterCenters.splice(_cint(0, clusterCenters.length - 1), 1);
    for (const cc of clusterCenters) {
      const count = _cint(8, 15);
      for (let i = 0; i < count; i++) {
        const tx = cc.tx + _cint(-8, 8);
        const ty = cc.ty + _cint(-8, 8);
        if (tx < 2 || tx > CFG.MAP_W-3 || ty < 2 || ty > CFG.MAP_H-3) continue;
        placeMtn(tx, ty, pickMtn(), Phaser.Math.FloatBetween(1.0, 1.4));
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
    this._fillWaterIslands();

    // Shorelines: a land cell touching water, by a side or only by a corner, gets a bank tile (ground
    // tileset rows from 4, see buildTextures and drawEdgeVariants). Ice counts as land here; tundra ice edges are deferred (#217).
    {
      const MW = CFG.MAP_W, MH = CFG.MAP_H, NG = GROUND_KEYS.length;
      const kind = new Uint8Array(MW * MH); // 1 = still water, 2 = river
      for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
        const w = this._waterLayer.getTileAt(tx, ty);
        if (this._riverLayer.getTileAt(tx, ty)) kind[tx + ty * MW] = 2;
        else if (w && w.index !== WATER_TILE.ice) kind[tx + ty * MW] = 1;
      }
      const at = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MH) ? 0 : kind[x + y * MW];
      let banks = 0;
      for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
        if (kind[tx + ty * MW] || this._waterLayer.getTileAt(tx, ty)) continue; // water, or ice
        const n = at(tx, ty - 1), e = at(tx + 1, ty), s = at(tx, ty + 1), w = at(tx - 1, ty);
        // A corner counts only when both its sides are dry (EDGE_MASKS).
        const ne = n || e ? 0 : at(tx + 1, ty - 1), se = s || e ? 0 : at(tx + 1, ty + 1);
        const sw = s || w ? 0 : at(tx - 1, ty + 1), nw = n || w ? 0 : at(tx - 1, ty - 1);
        const m = (n && 1) | (e && 2) | (s && 4) | (w && 8) | (ne && 16) | (se && 32) | (sw && 64) | (nw && 128);
        if (!m) continue;
        const k = Math.max(n, e, s, w, ne, se, sw, nw) - 1;
        ground.putTileAt((4 + k * EDGE_MASKS.length + EDGE_MASKS.indexOf(m)) * NG + (groundTile[getBiome(tx, ty)] || 0), tx, ty);
        banks++;
      }
      this._log(`shoreline bank tiles: ${banks}`, 'world');
    }

    // ── TERRAIN OVERLAP CLEANUP ───────────────────────────────────────────────
    // Sweep every tree, rock, and biome spire placed earlier in buildWorld and
    // destroy any that landed on water (shallow or deep) or inside a mountain zone.
    {
      const _overlapKeys = new Set(['rock', 'rock2', 'ice_rock', 'rock_desert', 'ice_spire', 'rock_spire', 'mangrove_roots']);
      let _overlapRemoved = 0;
      this.obstacles.getChildren().slice().forEach(ob => {
        const k = ob.texture && ob.texture.key;
        if (k.startsWith('mountain')) return; // never cull mountains
        if (!ob.isTree && !_overlapKeys.has(k)) return;   // keep walls, ruin blocks
        const tx = Math.floor(ob.x / TILE), ty = Math.floor(ob.y / TILE);
        if (this._waterMap[tx + ty * CFG.MAP_W] || this._impassableTileSet.has(tx + ',' + ty)) {
          ob.destroy();
          _overlapRemoved++;
        }
      });
      this._log(`terrain overlap cleanup  removed=${_overlapRemoved}`, 'world');
    }

    // Clear banks: no tree within 1 tile of water or ice, and reeds (the swamp tall-grass texture)
    // within 2 tiles of it, at a far higher density than the ambient tall grass.
    {
      const MW = CFG.MAP_W, MH = CFG.MAP_H;
      const wet = new Uint8Array(MW * MH);
      for (let i = 0; i < wet.length; i++) if (this._waterMap[i] || (this._iceMap && this._iceMap[i])) wet[i] = 1;
      for (const dt of this.deepWaterTiles) {
        const dx = Math.floor(dt.x / TILE), dy = Math.floor(dt.y / TILE);
        if (dx >= 0 && dx < MW && dy >= 0 && dy < MH) wet[dx + dy * MW] = 1;
      }
      // dist[i]: 1 or 2 for a dry tile that many (Chebyshev) steps from wet, else 0
      const dist = new Uint8Array(MW * MH);
      for (let ty = 2; ty < MH - 2; ty++) {
        for (let tx = 2; tx < MW - 2; tx++) {
          if (wet[tx + ty * MW]) continue;
          let d = 0;
          for (let dy = -2; dy <= 2 && d !== 1; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (!wet[(tx + dx) + (ty + dy) * MW]) continue;
              const cd = Math.max(Math.abs(dx), Math.abs(dy));
              if (d === 0 || cd < d) d = cd;
              if (d === 1) break;
            }
          }
          dist[tx + ty * MW] = d;
        }
      }
      let _banksCleared = 0;
      this.obstacles.getChildren().slice().forEach(ob => {
        if (!ob.isTree) return;
        const tx = Math.floor(ob.x / TILE), ty = Math.floor(ob.y / TILE);
        if (wet[tx + ty * MW] || dist[tx + ty * MW] === 1) { ob.destroy(); _banksCleared++; } // on ice, or on the bank
      });
      let _reeds = 0;
      const REED_P = 0.1;
      for (let ty = 2; ty < MH - 2; ty++) {
        for (let tx = 2; tx < MW - 2; tx++) {
          if (!dist[tx + ty * MW] || Math.random() > REED_P) continue;
          if (this._impassableTileSet.has(tx + ',' + ty)) continue;
          if (Math.abs(tx - stx) < SAFE_R + 3 && Math.abs(ty - sty) < SAFE_R + 3) continue;
          const sc = Phaser.Math.FloatBetween(0.7, 1.3);
          const ox = Phaser.Math.Between(-10, 10), oy = Phaser.Math.Between(-8, 8);
          const reed = this._w(this.add.image(tx*TILE + ox, ty*TILE + oy, 'tall_grass_swamp' + ['', '_2', '_3'][Phaser.Math.Between(0, 2)])
            .setOrigin(0.5, 1).setScale(sc).setDepth(4 + ty*0.001).setAlpha(0.82));
          this._grassGroups[_reeds % 3].push(reed);
          _reeds++;
        }
      }
      this._log(`clear banks  trees removed=${_banksCleared}  reeds=${_reeds}`, 'world');
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
        if (k.startsWith('mountain')) return;
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
    // ponytail: fog is one texel per tile, scaled up with linear filtering, so the GPU
    // blends the three zones into soft edges. Map-sized (300x300, 360 KB) and re-uploaded
    // every FOG_UPDATE_INTERVAL frames; upgrade path is a camera-sized canvas if the
    // upload shows in the [perf] fog= line on iPad.
    if (this.textures.exists('fog_map')) this.textures.remove('fog_map');
    this._fogTex = this.textures.createCanvas('fog_map', CFG.MAP_W, CFG.MAP_H);
    this.fogGfx = this._w(this.add.image(0, 0, 'fog_map').setOrigin(0).setScale(CFG.TILE).setDepth(48));
    this._fogFrame = 0;
    // Reveal initial spawn area
    this.revealFog(stx, sty, CFG.FOG_REVEAL_R + 4);
  },

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
          const guardspr = this.physics.add.image(gx, gy, 'bear').setScale(1.1 * sizeMult).setDepth(8);
          guardspr.setCollideWorldBounds(true);
          guardspr.body.setSize(48, 36);
          if (this.hudCam) this.hudCam.ignore(guardspr);
          this.physics.add.collider(guardspr, this.obstacles);
          const eg = {
            spr: guardspr, type: 'bear',
            hp: Math.floor(140 * sizeMult * D * 1.6), maxHp: Math.floor(140 * sizeMult * D * 1.6),
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
  },

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
      staticHitbox(w, 28, 28, 2, 2); // slightly smaller than full tile for passability at seams
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
            this._w(this.add.image(wx*TILE, wy*TILE, 'ruin_floor').setOrigin(0).setDepth(0.6));
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
        staticHitbox(p, 10, 20, 6, 16);
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
  },

  // ── BIOME STRUCTURES ──────────────────────────────────────────
  // Small abandoned structures in each biome — high risk, high reward.
  // Enemies spawn inside/around each structure (see spawnEnemies).
  buildBiomeStructures(stx, sty, TILE) {
    this._structureLocs = [];
    const { MAP_W, MAP_H, SAFE_R } = CFG;

    const biomeConfig = [
      { biome: 'grass',  wallKey: 'plank_wall',    floorKey: 'plank_floor',     label: 'FARMHOUSE'    },
      { biome: 'tundra', wallKey: 'ruin_block',    floorKey: 'ice_floor',       label: 'OUTPOST'      },
      { biome: 'swamp',  wallKey: 'rot_plank',     floorKey: 'rot_plank_floor', label: 'SHACK'        },
      { biome: 'waste',  wallKey: 'metal_wall',    floorKey: 'metal_floor',     label: 'BUNKER'       },
      { biome: 'fungal', wallKey: 'fungal_wall',   floorKey: 'fungal_floor',    label: 'SPORE SHRINE' },
      { biome: 'desert', wallKey: 'sandstone_wall',floorKey: 'sandstone_floor', label: 'DESERT OUTPOST'},
    ];

    const _paintMinimap = (tx, ty) => { // the radar shows a structure's floor as gray
      if (this._mmColorMap && tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H) this._mmColorMap[tx + ty * MAP_W] = 0x7a7a8a;
    };

    for (const { biome, wallKey, floorKey, label } of biomeConfig) {
      const layout = STRUCTURE_LAYOUTS[biome] || null;
      const W = layout ? layout.rows[0].length : 7, H = layout ? layout.rows.length : 5; // footprint, tiles
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
      for (const [slot, pos] of _positions.entries()) {
        const cx = pos.tx, cy = pos.ty;
        const x0 = cx - Math.floor(W / 2);
        const y0 = cy - Math.floor(H / 2);

        // The first slot with room is the authored layout (if the biome has one); the rest are boxes.
        if (layout && slot === 0) {
          this._buildAuthoredStructure(layout, { wallKey, floorKey }, x0, y0, TILE, _paintMinimap);
          this._structureLocs.push({ x: cx * TILE, y: cy * TILE, biome, guards: layout.guards });
          continue;
        }
        // Generic box: its interior shows as floor on the radar (7×5, interior 5×3).
        for (let dx = 1; dx < 6; dx++) for (let dy = 1; dy < 4; dy++) _paintMinimap(x0 + dx, y0 + dy);

        // Floor tiles (tundra only — ice_floor)
        if (floorKey) {
          for (let dx = 1; dx < W - 1; dx++) {
            for (let dy = 1; dy < H - 1; dy++) {
              const tx = x0 + dx, ty = y0 + dy;
              if (tx < 2 || tx > MAP_W - 3 || ty < 2 || ty > MAP_H - 3) continue;
              this._w(this.add.image(tx * TILE, ty * TILE, floorKey).setOrigin(0).setDepth(0.65));
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
  },

  // Builds one authored structure (see STRUCTURE_LAYOUTS in src/structures.js) with its top-left
  // tile at (x0, y0). paintMinimap(tx, ty) marks a floor tile on the radar.
  _buildAuthoredStructure(layout, { wallKey, floorKey }, x0, y0, TILE, paintMinimap) {
    const { MAP_W, MAP_H } = CFG;
    const solid = (tx, ty, key) => {
      const w = this.obstacles.create(tx * TILE + 16, ty * TILE + 16, key);
      w.setDepth(5 + ty * 0.01).setImmovable(true);
      w.body.setSize(32, 32); w.refreshBody();
      this._wallTileSet.add(tx + ',' + ty);
    };
    layout.rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const ch = row[dx], tx = x0 + dx, ty = y0 + dy;
        if (tx < 2 || tx > MAP_W - 3 || ty < 2 || ty > MAP_H - 3) continue;
        const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
        const loot = STRUCTURE_LOOT[ch.toLowerCase()];
        if (ch === ',' || (loot && ch === ch.toLowerCase())) { // floor, under indoor loot too
          this._w(this.add.image(tx * TILE, ty * TILE, floorKey).setOrigin(0).setDepth(0.65));
          paintMinimap(tx, ty);
        }
        if (ch === '#') solid(tx, ty, wallKey);
        else if (ch === 'R') solid(tx, ty, 'ruin_block');
        else if (ch === 'P') {
          const p = this.obstacles.create(cx, ty * TILE + TILE - 4, 'pillar');
          p.setOrigin(0.5, 1).setDepth(this._sortDepth(ty * TILE + TILE - 4)).setImmovable(true);
          p.refreshBody(); p.body.setSize(14, 14, false); p.body.setOffset((p.displayWidth - 14) / 2, p.displayHeight - 14);
        } else if (ch === 'T') this._spawnTorch(cx, cy);
        else if (ch === 'C') this._w(this.add.image(cx, cy, 'supply_cache').setScale(2.5).setDepth(6));
        else if (loot) {
          const item = this.physics.add.image(cx, cy, loot).setScale(2).setDepth(6);
          item.body.allowGravity = false; item.body.setImmovable(true);
          item.itemType = loot.replace('item_', '');
          this._w(item);
          this.worldCrates.push(item);
        }
      }
    });
    const labelX = (x0 + layout.rows[0].length / 2) * TILE, labelY = y0 * TILE - 12;
    this._w(this.add.text(labelX, labelY, layout.label, {
      fontFamily: 'monospace', fontSize: '8px', color: '#cc9944', stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(7).setAlpha(0.85));
  },

  // ── SCENERY PLACEMENT ───────────────────────────────────────
  // Scenery from src/sprites.js is shown at ART_SCALE and stands on its tile (origin at the
  // base). Phaser resets a static body to the whole sprite on refreshBody, so trees and rocks
  // always blocked their full picture; the body is set after the refresh to roughly that old
  // footprint (lower 3/4 width, lower half height) so forests stay as passable as before.
  _placeScenery(tx, ty, key, frame) {
    const TILE = CFG.TILE;
    if (frame == null) frame = Phaser.Math.Between(0, SCENERY_SPECS[key].sizes.length - 1);
    const baseY = ty * TILE + TILE - 2;
    const o = this.obstacles.create(tx * TILE + TILE / 2, baseY, key, frame);
    o.setOrigin(0.5, 1).setScale(ART_SCALE).setDepth(this._sortDepth(baseY)).setImmovable(true);
    o.refreshBody();
    const bw = o.displayWidth * 0.75, bh = o.displayHeight * 0.5;
    o.body.setSize(bw, bh, false);
    o.body.setOffset((o.displayWidth - bw) / 2, o.displayHeight - bh);
    return o;
  },

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
      const deepSet = isIce ? new Set() : _deepCore(tileSet);
      tileSet.forEach(key => {
        const [tx, ty] = key.split(',').map(Number);
        if (tx < 1 || ty < 1 || tx >= CFG.MAP_W - 1 || ty >= CFG.MAP_H - 1) return;
        const x = tx * TILE, y = ty * TILE;
        const isDeep = deepSet.has(key);
        if (isIce) {
          // Visual only — detection via _iceMap per-frame (see applyTerrainEffects)
          const tile = this._waterLayer.putTileAt(WATER_TILE.ice, tx, ty);
          tile.alpha = 0.75;
          this.iceTiles.push(tile);
          this._iceMap[tx + ty * CFG.MAP_W] = 1;
        } else if (isDeep) {
          // The cell is drawn on the water layer; an invisible sprite on the cell carries the
          // physics body (and the x/y the minimap and impassable set read from deepWaterTiles).
          this._waterLayer.putTileAt(WATER_TILE.deep, tx, ty);
          const tile = this.obstacles.create(x + TILE / 2, y + TILE / 2, 'water_deep').setVisible(false);
          tile.refreshBody();
          this.deepWaterTiles.push(tile);
        } else {
          // Pure visual ground tile — no physics body. Detection via _waterMap per-frame.
          const tile = this._waterLayer.putTileAt(WATER_TILE.shallow, tx, ty);
          this.waterTiles.push(tile);
          this._waterMap[tx + ty * CFG.MAP_W] = 1;
          tile._shimmerOff = (tx * 7 + ty * 13) % 60;
          this._pondWaterTiles.push(tile);
        }
      });
      _pondPlaced++;
      this._log(`pond ${biome} placed  tiles=${tileSet.size} cx=${cx},cy=${cy}`, 'world');
    }
    this._log(`_buildPonds done  placed=${_pondPlaced} skip_center=${_pondSkipCenter} skip_blob=${_pondSkipBlob}  water=${this.waterTiles.length} ice=${this.iceTiles.length} deep=${this.deepWaterTiles.length}`, 'world');
  },

  // Islands and slivers: a dry cell with water on three or four sides (left where two ponds, a pond
  // and a lake, or a river and a lake meet) becomes water too, repeated until none is left, so no
  // one- or two-tile island or one-tile spit of land survives. Ice if all its wet sides are ice,
  // river if all are river, else shallow. Mountains stay. Runs after lakes and again after rivers.
  _fillWaterIslands() {
    const { MAP_W, MAP_H } = CFG;
    const kindAt = (x, y) => {
      if (this._riverLayer.getTileAt(x, y)) return 'river';
      const w = this._waterLayer.getTileAt(x, y);
      return w ? (w.index === WATER_TILE.ice ? 'ice' : 'still') : null;
    };
    let filled = 0, more = true;
    while (more) { more = false; for (let ty = 1; ty < MAP_H - 1; ty++) for (let tx = 1; tx < MAP_W - 1; tx++) {
      if (kindAt(tx, ty) || (this._solidTileSet && this._solidTileSet.has(tx + ',' + ty))) continue;
      const k = [kindAt(tx, ty - 1), kindAt(tx + 1, ty), kindAt(tx, ty + 1), kindAt(tx - 1, ty)].filter(Boolean);
      if (k.length < 3) continue;
      more = true;
      const i = tx + ty * MAP_W;
      if (k.every(x => x === 'ice')) {
        const tile = this._waterLayer.putTileAt(WATER_TILE.ice, tx, ty);
        tile.alpha = 0.75;
        this.iceTiles.push(tile);
        this._iceMap[i] = 1;
      } else if (k.every(x => x === 'river')) {
        this.waterTiles.push(this._riverLayer.putTileAt(0, tx, ty));
        this._waterMap[i] = 1;
      } else {
        const tile = this._waterLayer.putTileAt(WATER_TILE.shallow, tx, ty);
        tile._shimmerOff = (tx * 7 + ty * 13) % 60;
        this.waterTiles.push(tile);
        this._pondWaterTiles.push(tile);
        this._waterMap[i] = 1;
      }
      filled++;
    } }
    this._log(`island and sliver cells filled: ${filled}`, 'world');
  },

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

      const deepLakeTiles = biome === 'tundra' ? new Set() : _deepCore(tileSet);

      // Place tiles — deep center uses water_deep (traversable); shallow edges stay water_shallow
      tileSet.forEach(key => {
        const [tx, ty] = key.split(',').map(Number);
        if (tx < 1 || ty < 1 || tx >= CFG.MAP_W - 1 || ty >= CFG.MAP_H - 1) return;
        const x = tx * TILE, y = ty * TILE;
        if (biome === 'tundra') {
          // Tundra lakes become ice — visual only, detection via _iceMap per-frame
          const tile = this._waterLayer.putTileAt(WATER_TILE.ice, tx, ty);
          tile.alpha = 0.75;
          this.iceTiles.push(tile);
          this._iceMap[tx + ty * CFG.MAP_W] = 1;
        } else if (deepLakeTiles.has(key)) {
          // Deep center — visually dark, traversable (no physics obstacle)
          const tile = this._waterLayer.putTileAt(WATER_TILE.deep, tx, ty);
          this.waterTiles.push(tile);
          this._waterMap[tx + ty * CFG.MAP_W] = 1;
          tile._shimmerOff = (tx * 7 + ty * 13) % 60;
          this._pondWaterTiles.push(tile);
        } else {
          const tile = this._waterLayer.putTileAt(WATER_TILE.shallow, tx, ty);
          this.waterTiles.push(tile);
          this._waterMap[tx + ty * CFG.MAP_W] = 1;
          tile._shimmerOff = (tx * 7 + ty * 13) % 60;
          this._pondWaterTiles.push(tile);
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
  },

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
        // A cell on the river layer, whose tileset is the shared animated 'water_river' canvas:
        // one redraw per frame animates every river cell, with no per-cell object.
        const tile = this._riverLayer.putTileAt(0, rtx, rty);
        this.waterTiles.push(tile);
        this._waterMap[rtx + rty * MAP_W] = 1;
        tilesPlaced++;
      });

      this.rivers.push({ tiles: riverTiles, from: fromPt, to: toPt, length: centerline.size, width });
      _placed++;
      this._log(`river placed  tiles=${tilesPlaced}  from=(${fromPt.tx},${fromPt.ty})  to=(${toPt.tx},${toPt.ty})  width=${width * 2 + 1}  centerline=${centerline.size}`, 'world');
    }

    this._log(`_buildRivers done  placed=${_placed}  skipped=${_skipped}  total_water=${this.waterTiles.length}`, 'world');
  },
});
