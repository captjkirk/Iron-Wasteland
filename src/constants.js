'use strict';
// ── src/constants.js — Global config, shared state, biome logic ──────────────
// Globals exported: VERSION, CFG, ENEMY_STATS, ENEMY_LOOT, CHARS, STATE,
//                   _worldRng, _pendingLogMsgs, _qlog,
//                   getBiome, _buildBiomeMap, _buildBiomeMapChunked, _biomeSeeds
// grep: "const CFG"  "ENEMY_STATS"  "_qlog"  "getBiome"

// ── VERSION ───────────────────────────────────────────────────
// Update this each commit so the title screen reflects the build date.
// Stored as UTC ISO so it can be displayed in each player's local timezone.
const VERSION = '2026-09-08T19:08:44Z';
// Format VERSION into the viewer's local time with abbreviated tz name (EDT, PDT, BST, etc.)
function _fmtVersion(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch (_) { return iso; }
}

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
  FOG_REVEAL_R: 8,   // tiles radius for fog reveal
  FOG_UPDATE_INTERVAL: 4, // update fog every N frames
  DORMANT_RADIUS: 800,  // px — wildlife enemy goes dormant beyond this from all players
  WAKE_RADIUS:    700,  // px — hysteresis: dormant enemy wakes when closer than this
  MAX_ACTIVE_ENEMIES: 180, // hard cap on simultaneously active (non-dormant) enemies
  MAX_ENEMIES: 280, // hard cap on this.enemies.length across all spawners (den/wave)
  ITEM_DESPAWN_MS: 20000, // harvested / dropped item pickups auto-expire after this long
  TUT_AUTO_ADVANCE_MS: 7000, // how long each tutorial tip stays on screen before advancing
  MINIMAP_HINT_DELAY_MS: 20000, // delay before minimap contextual tip first appears
};

// ── ENEMY LOOT TABLES ─────────────────────────────────────────
// Format: [item_key, base_chance, flags]  flags: 0=plain, 1=multiply by foodMult, 2=rare (skip if hc.rareDropsBossOnly)
// Chance > 1 = always drops (e.g. bears always drop metal, boss_wolf always drops food).
const _RAIDER_LOOT = [['item_ammo', 0.6, 0], ['item_metal', 0.4, 0], ['item_food', 0.3, 1]];

// Canonical base stats for wave/biome enemies. Structure and tower guards keep
// their own tuned values (they're tuned harder to make POIs dangerous); these
// apply to _spawnGroup (wave spawns) and _spawnBiomeEnemy (day>=2 biome enemies).
// HP/dmg/speed/atkInterval are scaled at spawn time by _diffMult().
const ENEMY_STATS = {
  wolf:         { hp:60,  speed:75,  dmg:6,  baseScale:1.8, w:20, h:12, atkInterval:1600, aggro:190 },
  rat:          { hp:30,  speed:105, dmg:4,  baseScale:1.4, w:15, h:9,  atkInterval:1200, aggro:110 },
  bear:         { hp:140, speed:50,  dmg:16, baseScale:2.2, w:24, h:18, atkInterval:2400, aggro:290 },
  ice_crawler:  { hp:45,  speed:130, dmg:7,  baseScale:1.6, w:18, h:12, atkInterval:1400, aggro:160 },
  spider_ruins: { hp:40,  speed:70,  dmg:8,  baseScale:1.6, w:16, h:12, atkInterval:1800, aggro:130 },
  bog_lurker:   { hp:55,  speed:55,  dmg:13, baseScale:1.8, w:20, h:14, atkInterval:2000, aggro: 80 },
  dust_hound:   { hp:28,  speed:118, dmg:5,  baseScale:1.3, w:18, h:12, atkInterval:1500, aggro:200 },
};
const ENEMY_LOOT = {
  // ── Grass / common wildlife ──────────────────────────────────
  wolf:         [['item_fiber', 0.6, 0],   // pelt
                 ['item_food',  0.5, 1],   // meat — wolves are hunted for food
                 ['item_metal', 0.15, 0]], // canine teeth (small scrap chance)

  rat:          [['item_fiber', 0.6, 0],   // fur
                 ['item_ammo',  0.3, 0],   // gnaws through ammo boxes
                 ['item_wood',  0.2, 0]],  // nesting scraps

  bear:         [['item_metal', 1e9, 0],   // claws — always drops metal
                 ['item_food',  0.85, 1],  // massive animal = big meat haul
                 ['item_wood',  0.5, 0],   // clawed-up logs
                 ['item_fiber', 0.4, 0]],  // dense fur

  // ── Raider camps ────────────────────────────────────────────
  brawler:      _RAIDER_LOOT,
  shooter:      _RAIDER_LOOT,
  heavy:        _RAIDER_LOOT,

  // ── Tundra: rare items + ammo from frozen caches ─────────────
  ice_crawler:  [['item_fiber', 0.55, 0],  // chitinous fibers
                 ['item_ammo',  0.3,  0],  // frozen military cache
                 ['item_rare',  0.25, 2]], // tundra ice crystal shard

  // ── Ruins: THE fiber biome; spiders hoard ancient relics ─────
  spider_ruins: [['item_fiber', 0.8,  0],  // webbing
                 ['item_metal', 0.3,  0],  // hoarded scrap
                 ['item_rare',  0.15, 2]], // ancient artifact snagged in web

  // ── Swamp / Fungal: food + bioluminescent rares ──────────────
  bog_lurker:   [['item_food',  0.65, 1],  // large creature = lots of meat
                 ['item_fiber', 0.35, 0],  // leathery hide
                 ['item_rare',  0.12, 2]], // bioluminescent gland

  // ── Waste / Desert: ammo scavenging + food ───────────────────
  dust_hound:   [['item_food',  0.5,  1],  // pack animal, decent meat
                 ['item_fiber', 0.4,  0],  // tough wasteland hide
                 ['item_ammo',  0.3,  0]], // scavenged from ruins

  // ── Lakes: aquatic food + water pearls ───────────────────────
  water_lurker: [['item_food',  0.7,  1],  // rich aquatic meat
                 ['item_fiber', 0.45, 0],  // scales/membrane
                 ['item_rare',  0.15, 2]], // iridescent water pearl

  // ── Biome bosses (on top of the guaranteed rare+metal+ammo) ──
  boss_golem:   [['item_ammo',  0.9,  0],  // wasteland warlord stockpile
                 ['item_metal', 0.75, 0]],
  boss_wolf:    [['item_food',  1e9,  1],  // alpha predator — always drops food
                 ['item_fiber', 0.8,  0]],
  boss_spider:  [['item_fiber', 1e9,  0],  // ruins hoard — always drops fiber
                 ['item_metal', 0.7,  0]],
  boss_troll:   [['item_wood',  1e9,  0],  // permafrost giant — always drops wood
                 ['item_food',  0.8,  1]],
  boss_hydra:   [['item_food',  1e9,  1],  // apex aquatic — always drops food
                 ['item_rare',  0.5,  2]], // extra rare chance (large specimen)
};

// ── WORLD GEN CONFIG KNOBS ────────────────────────────────────
CFG.POND_SPECS    = { swamp:35, tundra:25, fungal:20, grass:16, grass_near:8 };
CFG.LAKE_SPECS    = ['grass','grass','swamp','swamp','waste','tundra','fungal'];
CFG.PLACEMENT     = { POND_EXCL:10, LAKE_EXCL:14, CACHE_EXCL:8,
                      POND_MIN_SIZE:12, LAKE_MIN_SIZE:25, RAIDER_MIN_DIST:60 };
CFG.RIVER_COUNT      = 4;    // rivers per map
CFG.RIVER_WANDER     = 0.50; // per-step chance of perpendicular jitter (higher = more organic)
CFG.RIVER_WIDTH_MIN  = 1;    // BFS spread radius min (1 → ~3-tile channel)
CFG.RIVER_WIDTH_MAX  = 3;    // BFS spread radius max (3 → ~7-tile channel)

// ── MULBERRY32 SEEDED RNG ─────────────────────────────────────
// Deterministic, fast, good statistical quality.
// _worldRng is set in initWorldRng(); call _worldRng() instead of Math.random() in world gen.
let _worldRng = Math.random; // default to Math.random until seed is set
function _makeMulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return function() {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// Module-level log queue: other scenes (GameOver, CharSelect) push messages here;
// GameScene flushes them into _dbgEntries at the start of each run.
let _pendingLogMsgs = [];
function _qlog(msg, cat) {
  const tag = (cat || 'menu').toUpperCase().padEnd(6).slice(0, 6);
  _pendingLogMsgs.push(`[${tag}] ${msg}`);
  console.log('[IW]', msg);
}

// Pre-computed biome map — populated once after biome seeds are set.
// O(1) lookup replaces the per-call Voronoi + noise computation.
let _biomeMap = null;
const _BIOME_IDX  = { grass:0, waste:1, swamp:2, tundra:3, ruins:4, fungal:5, desert:6 };
const _BIOME_NAME = ['grass','waste','swamp','tundra','ruins','fungal','desert'];

function _computeBiomeRaw(tileX, tileY) {
  const cx = CFG.MAP_W / 2, cy = CFG.MAP_H / 2;
  const dist = Math.sqrt((tileX - cx) ** 2 + (tileY - cy) ** 2);
  if (dist < CFG.SAFE_R + 15) return 'grass';
  if (_biomeSeeds.length === 0) return 'waste';
  const warpX = _biomeNoise(tileX * 0.8, tileY * 0.8, 7) * 18;
  const warpY = _biomeNoise(tileX * 0.8 + 50, tileY * 0.8 + 50, 7) * 18;
  const wtx = tileX + warpX, wty = tileY + warpY;
  let nearest = null, nearestDist = Infinity;
  for (const seed of _biomeSeeds) {
    const d = (wtx - seed.tx) ** 2 + (wty - seed.ty) ** 2;
    if (d < nearestDist) { nearestDist = d; nearest = seed; }
  }
  return nearest ? nearest.biome : 'waste';
}

function getBiome(tileX, tileY) {
  if (_biomeMap) {
    const tx = Math.max(0, Math.min(CFG.MAP_W - 1, tileX | 0));
    const ty = Math.max(0, Math.min(CFG.MAP_H - 1, tileY | 0));
    return _BIOME_NAME[_biomeMap[tx + ty * CFG.MAP_W]] || 'waste';
  }
  return _computeBiomeRaw(tileX, tileY);
}

function _buildBiomeMap() {
  const { MAP_W, MAP_H } = CFG;
  _biomeMap = new Uint8Array(MAP_W * MAP_H);
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      _biomeMap[tx + ty * MAP_W] = _BIOME_IDX[_computeBiomeRaw(tx, ty)] || 0;
    }
  }
}

// Chunked variant of _buildBiomeMap. The synchronous version blocks the JS
// thread for ~300 ms on a 300×300 map (1.6M Voronoi distance ops); driving it
// in row-chunks lets the loading bar actually paint while it runs.
//   onProgress(frac) — called after each chunk with frac in [0..1]
//   onDone()        — called when the full map is built
// Uses setTimeout(0) instead of scene.time.delayedCall so it does not depend
// on the scene's update loop running during init.
function _buildBiomeMapChunked(onProgress, onDone) {
  const { MAP_W, MAP_H } = CFG;
  _biomeMap = new Uint8Array(MAP_W * MAP_H);
  const ROWS_PER_CHUNK = 30; // 300 / 30 = 10 chunks → ~30 ms each on a slow phone
  let ty = 0;
  const step = () => {
    const end = Math.min(ty + ROWS_PER_CHUNK, MAP_H);
    for (; ty < end; ty++) {
      const row = ty * MAP_W;
      for (let tx = 0; tx < MAP_W; tx++) {
        _biomeMap[row + tx] = _BIOME_IDX[_computeBiomeRaw(tx, ty)] || 0;
      }
    }
    if (typeof onProgress === 'function') onProgress(ty / MAP_H);
    if (ty < MAP_H) setTimeout(step, 0);
    else if (typeof onDone === 'function') onDone();
  };
  setTimeout(step, 0);
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
    speed: 128, maxHp: 200,
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
  {
    id: 'charmer', player: 'Lauren', title: 'The Charmer',
    color: 0xd988bb, dark: 0x995577,
    speed: 175, maxHp: 130,
    stats: [3, 4, 3, 2],
    desc: ['Daytime aura charms enemies.', 'FLOWER: charm-on-hit bouquet toss'],
  },
  {
    id: 'ranger', player: 'Abigail', title: 'The Ranger',
    color: 0x557733, dark: 0x334422,
    speed: 185, maxHp: 120,
    stats: [3, 5, 4, 2],
    desc: ['Bow & knife. Scout panel passive.', 'KNIFE: quick close-range strike'],
  },
];

// Shared state across scenes
const STATE = {
  mode: 2,
  difficulty: 'survival',  // 'survival' | 'hardcore'
  p1CharId: 'knight',
  p2CharId: 'gunslinger',
};
