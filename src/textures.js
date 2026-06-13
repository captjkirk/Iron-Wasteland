'use strict';
// ── src/textures.js — Procedural texture generation (no image files) ─────────
// Globals exported: drawWolf, drawRat, drawBear, drawIceCrawler,
//                   drawSpiderRuins, drawBogLurker, drawDustHound, drawWaterLurker,
//                   drawKnight* drawGunslinger* drawArchitect* drawLauren* drawAbigail*
//                   drawRaiderDirectionals, drawRiverFrame, buildTextures, buildAtlases, makeScaleProxy
// All draw* fns take (g: Phaser.GameObjects.Graphics).
// buildTextures(scene) is called from BootScene.preload().
// buildAtlases(scene) is called internally by buildTextures after all frames generated.
// grep: "function draw"  "buildTextures"  "buildAtlases"  "generateTexture"  "drawRiverFrame"

// River current — draws the wavy stripe pattern onto a 32×32 canvas at a vertical
// scroll offset. Used both to bake the shared 'water_river' CanvasTexture and to
// re-scroll it each frame from GameScene. ONE shared texture animates every river
// tile at once, so river tiles stay plain (batchable) add.image objects instead of
// per-tile TileSprites (which each allocate their own WebGL texture → draw-call storm).
// The pattern is drawn twice (at off and off-32) so the vertical scroll wraps seamlessly.
function drawRiverFrame(ctx, off) {
  off = ((off % 32) + 32) % 32;
  ctx.fillStyle = '#2277aa';
  ctx.fillRect(0, 0, 32, 32);
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (const dy of [off, off - 32]) {
    ctx.strokeStyle = 'rgba(85,204,238,0.88)';
    // Wave 1 — centre y=8
    ctx.beginPath(); ctx.moveTo(0, 8 + dy);
    ctx.lineTo(4, 5 + dy); ctx.lineTo(8, 3 + dy); ctx.lineTo(12, 5 + dy);
    ctx.lineTo(16, 8 + dy); ctx.lineTo(20, 12 + dy); ctx.lineTo(24, 13 + dy); ctx.lineTo(28, 12 + dy);
    ctx.lineTo(32, 8 + dy); ctx.stroke();
    // Wave 2 — centre y=19 (opposite phase)
    ctx.beginPath(); ctx.moveTo(0, 19 + dy);
    ctx.lineTo(4, 23 + dy); ctx.lineTo(8, 24 + dy); ctx.lineTo(12, 23 + dy);
    ctx.lineTo(16, 19 + dy); ctx.lineTo(20, 16 + dy); ctx.lineTo(24, 14 + dy); ctx.lineTo(28, 16 + dy);
    ctx.lineTo(32, 19 + dy); ctx.stroke();
    // Wave 3 — centre y=29 (clamped to ≤32 so no mid-tile seam)
    ctx.beginPath(); ctx.moveTo(0, 29 + dy);
    ctx.lineTo(4, 26 + dy); ctx.lineTo(8, 24 + dy); ctx.lineTo(12, 26 + dy);
    ctx.lineTo(16, 29 + dy); ctx.lineTo(20, 31 + dy); ctx.lineTo(24, 32 + dy); ctx.lineTo(28, 31 + dy);
    ctx.lineTo(32, 29 + dy); ctx.stroke();
    // Scattered glints
    ctx.fillStyle = 'rgba(170,238,255,0.20)';
    ctx.fillRect(4, 5 + dy, 5, 1); ctx.fillRect(19, 16 + dy, 4, 1); ctx.fillRect(7, 26 + dy, 5, 1);
  }
}

function drawWolf(g) {
  g.clear();
  g.fillStyle(0x888899); g.fillRect(2, 3, 14, 6);
  g.fillStyle(0x9999aa); g.fillRect(13, 1, 5, 6);
  g.fillStyle(0x777788); g.fillRect(16, 0, 2, 3); g.fillRect(14, 0, 2, 3);
  g.fillStyle(0xbbbbcc); g.fillRect(17, 3, 2, 3);
  g.fillStyle(0x222222); g.fillRect(18, 4, 1, 1);
  g.fillStyle(0xff4400); g.fillRect(16, 2, 1, 1);
  g.fillStyle(0x777788); g.fillRect(3, 8, 2, 3); g.fillRect(7, 8, 2, 3);
  g.fillRect(10, 8, 2, 3); g.fillRect(14, 8, 2, 3);
  g.fillStyle(0x777788); g.fillRect(0, 2, 3, 3);
  g.fillStyle(0xffffff); g.fillRect(0, 2, 2, 2);
  g.generateTexture('wolf', 20, 12);
}

function drawRat(g) {
  g.clear();
  g.fillStyle(0x8b5a2b); g.fillRect(3, 2, 9, 5);
  g.fillStyle(0xaa7744); g.fillRect(10, 1, 4, 5);
  g.fillStyle(0xff9999); g.fillRect(9, 0, 2, 2);
  g.fillStyle(0x333333); g.fillRect(13, 2, 1, 1);
  g.fillStyle(0xff4400); g.fillRect(12, 1, 1, 1);
  g.fillStyle(0x8b5a2b); g.fillRect(3, 6, 2, 2); g.fillRect(6, 6, 2, 2); g.fillRect(9, 6, 2, 2);
  g.fillStyle(0xcc8866); g.fillRect(0, 3, 4, 1); g.fillRect(0, 4, 2, 1);
  g.generateTexture('rat', 15, 9);
}

function drawBear(g) {
  g.clear();
  g.fillStyle(0x6b3a1f); g.fillRect(2, 4, 18, 10);
  g.fillStyle(0x8b5a2b); g.fillRect(14, 2, 8, 8);
  g.fillStyle(0x6b3a1f); g.fillRect(19, 0, 3, 3);
  g.fillStyle(0x6b3a1f); g.fillRect(15, 0, 3, 3);
  g.fillStyle(0xcc9966); g.fillRect(19, 4, 3, 4);
  g.fillStyle(0x111111); g.fillRect(20, 5, 2, 1);
  g.fillStyle(0xff3300); g.fillRect(18, 3, 1, 1);
  g.fillStyle(0x6b3a1f); g.fillRect(2, 13, 4, 4); g.fillRect(8, 13, 4, 4);
  g.fillRect(13, 13, 4, 4); g.fillRect(17, 13, 3, 4);
  g.generateTexture('bear', 24, 18);
}

function drawIceCrawler(g) {
  g.clear();
  g.fillStyle(0x6699bb); g.fillRect(2, 3, 14, 6);          // body
  g.fillStyle(0x88bbdd); g.fillRect(3, 4, 12, 4);           // highlight
  g.fillStyle(0x4477aa); g.fillRect(2, 3, 2, 2); g.fillRect(14, 3, 2, 2); // head/tail caps
  // Six legs — 3 per side
  g.fillStyle(0x335577);
  g.fillRect(4, 8, 1, 3); g.fillRect(7, 9, 1, 3); g.fillRect(10, 8, 1, 3);
  g.fillRect(4, 1, 1, 3); g.fillRect(7, 0, 1, 3); g.fillRect(10, 1, 1, 3);
  g.fillStyle(0xcceeff); g.fillRect(8, 5, 2, 1); // icy eye glint
  g.generateTexture('ice_crawler', 18, 12);
}

function drawSpiderRuins(g) {
  g.clear();
  g.fillStyle(0x3a1a4a); g.fillCircle(8, 6, 5);             // body
  g.fillStyle(0x5a2a6a); g.fillCircle(8, 4, 3);             // head
  g.fillStyle(0xcc44ff); g.fillRect(6, 3, 1, 1); g.fillRect(9, 3, 1, 1); // eyes
  // 4 legs per side
  g.fillStyle(0x2a0e38);
  g.fillRect(0, 4, 4, 1); g.fillRect(1, 6, 4, 1); g.fillRect(0, 8, 4, 1); g.fillRect(1, 9, 3, 1);
  g.fillRect(12, 4, 4, 1); g.fillRect(11, 6, 4, 1); g.fillRect(12, 8, 4, 1); g.fillRect(12, 9, 3, 1);
  g.generateTexture('spider_ruins', 16, 12);
}

function drawBogLurker(g) {
  g.clear();
  g.fillStyle(0x1a3a1a); g.fillEllipse(10, 8, 18, 10);      // body
  g.fillStyle(0x2a5a2a); g.fillEllipse(10, 7, 14, 7);       // highlight
  g.fillStyle(0x0a1e0a); g.fillRect(4, 10, 12, 4);          // bottom shadow
  g.fillStyle(0x44aa44); g.fillRect(8, 5, 2, 2); g.fillRect(11, 6, 1, 1); // eyes
  g.fillStyle(0x3a7a3a); g.fillRect(3, 8, 2, 2); g.fillRect(15, 9, 2, 2); // slime bumps
  g.generateTexture('bog_lurker', 20, 14);
}

function drawDustHound(g) {
  g.clear();
  g.fillStyle(0xaa7733); g.fillRect(3, 4, 11, 6);           // body
  g.fillStyle(0xcc9944); g.fillRect(4, 5, 9, 4);            // highlight
  g.fillStyle(0x997722); g.fillRect(13, 3, 4, 5);           // head
  g.fillStyle(0x553311); g.fillRect(15, 4, 2, 1);           // snout
  g.fillStyle(0x111111); g.fillRect(14, 3, 1, 1);           // eye
  g.fillStyle(0x886622);
  g.fillRect(5, 9, 2, 3); g.fillRect(9, 9, 2, 3);          // back legs
  g.fillRect(4, 5, 2, 3); g.fillRect(1, 5, 2, 2);          // front legs
  g.fillStyle(0xaa7733); g.fillRect(0, 3, 3, 2);            // tail
  g.generateTexture('dust_hound', 18, 12);
}

function drawWaterLurker(g) {
  g.clear();
  // Elongated crocodilian body — dark teal
  g.fillStyle(0x1a4a3a); g.fillRect(1, 4, 20, 8);
  g.fillStyle(0x256050); g.fillRect(2, 5, 18, 5);   // highlight stripe
  // Ridged back spines
  g.fillStyle(0x0d2e24);
  g.fillRect(4, 3, 2, 2); g.fillRect(8, 2, 2, 3); g.fillRect(12, 2, 2, 3); g.fillRect(16, 3, 2, 2);
  // Head (wider snout at left)
  g.fillStyle(0x1a4a3a); g.fillRect(19, 3, 5, 8);
  g.fillStyle(0x0d2e24); g.fillRect(21, 11, 3, 2);  // jaw underside
  // Eyes — yellow slitted
  g.fillStyle(0xddcc00); g.fillRect(20, 4, 2, 2); g.fillRect(22, 4, 1, 1);
  g.fillStyle(0x111111); g.fillRect(21, 5, 1, 1);   // slit pupil
  // Stubby legs
  g.fillStyle(0x163d2e);
  g.fillRect(4, 11, 3, 3); g.fillRect(10, 11, 3, 3);
  g.fillRect(4, 2, 3, 2);  g.fillRect(10, 2, 3, 2);
  // Tail — tapers left
  g.fillStyle(0x1a4a3a); g.fillRect(0, 5, 2, 6);
  g.fillStyle(0x0d2e24); g.fillRect(0, 7, 1, 2);
  g.generateTexture('water_lurker', 24, 14);
}

function getControls(playerNum, charId, isSolo) {
  if (isSolo && playerNum === 1) {
    const map = {
      knight:     ['WASD — Move', 'Mouse — Aim', 'LClick — Sword', 'RClick — Rally', 'Q — Build', 'E — Interact', 'R — Rotate build'],
      gunslinger: ['WASD — Move', 'Mouse — Aim', 'LClick — Shoot', 'RClick — Reload', 'Q — Build', 'E — Interact', 'R — Rotate build'],
      architect:  ['WASD — Move', 'Mouse — Aim', 'LClick — Wrench', 'RClick — Turret', 'Q — Build', 'E — Interact', 'R — Rotate build'],
      charmer:    ['WASD — Move', 'Mouse — Aim', 'LClick — Pirouette (360° AoE)', 'RClick — Flower Toss', 'Q — Build', 'E — Interact', 'Passive: Raiders are allies; charm aura near enemies'],
      ranger:     ['WASD — Move', 'Mouse — Aim', 'LClick — Bow Shot', 'RClick — Knife Strike', 'Q — Build', 'E — Interact', 'Passive: Scout panel on nearby enemies'],
    };
    return map[charId] || ['WASD — Move'];
  }
  const move    = playerNum === 1 ? 'WASD — Move'         : 'Arrows — Move';
  const atk     = playerNum === 1 ? 'F'                   : '/';
  const atk2    = playerNum === 1 ? 'G'                   : '.';
  const build   = playerNum === 1 ? 'Q'                   : '0';
  const inter   = playerNum === 1 ? 'E'                   : 'Enter';
  const map = {
    knight:     [move, atk+' — Sword', atk2+' — Rally', build+' — Build', inter+' — Interact'],
    gunslinger: [move, atk+' — Shoot', atk2+' — Reload', build+' — Build', inter+' — Interact'],
    architect:  [move, atk+' — Wrench', atk2+' — Turret', build+' — Build', inter+' — Interact'],
    charmer:    [move, atk+' — Pirouette (360° AoE)', atk2+' — Flower Toss', build+' — Build', inter+' — Interact', 'Passive: Raiders are allies; charm aura'],
    ranger:     [move, atk+' — Bow Shot', atk2+' — Knife Strike', build+' — Build', inter+' — Interact', 'Passive: Scout panel on nearby enemies'],
  };
  return map[charId] || [move];
}

// ── SCALE PROXY ───────────────────────────────────────────────
// Wraps a Phaser Graphics object so all coordinates are multiplied by s.
// Used to generate high-res character sprites without rewriting every draw fn.
function makeScaleProxy(g, s) {
  return {
    clear:            ()                   => g.clear(),
    fillStyle:        (c, a)               => g.fillStyle(c, a),
    lineStyle:        (w, c, a)            => g.lineStyle(w * s, c, a),
    fillRect:         (x,y,w,h)            => g.fillRect(x*s,y*s,w*s,h*s),
    fillRoundedRect:  (x,y,w,h,r)         => g.fillRoundedRect(x*s,y*s,w*s,h*s,r*s),
    fillCircle:       (x,y,r)             => g.fillCircle(x*s,y*s,r*s),
    fillEllipse:      (x,y,w,h,sm)        => g.fillEllipse(x*s,y*s,w*s,h*s,sm),
    fillTriangle:     (x1,y1,x2,y2,x3,y3)=> g.fillTriangle(x1*s,y1*s,x2*s,y2*s,x3*s,y3*s),
    fillPoints:       (pts,cl)             => g.fillPoints(pts.map(p=>({x:p.x*s,y:p.y*s})),cl),
    strokeRect:       (x,y,w,h)           => g.strokeRect(x*s,y*s,w*s,h*s),
    strokeCircle:     (x,y,r)             => g.strokeCircle(x*s,y*s,r*s),
    lineBetween:      (x1,y1,x2,y2)       => g.lineBetween(x1*s,y1*s,x2*s,y2*s),
    generateTexture:  (key,w,h)           => g.generateTexture(key,w*s,h*s),
  };
}

// ── TEXTURE GENERATION ────────────────────────────────────────
function buildTextures(scene) {
  // Textures are keyed by name in Phaser's global TextureManager and persist
  // across scene restarts; regenerating them every time leaks memory.
  if (scene.textures.exists('grass')) return;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });

  // Ground — grass (natural, no grid lines)
  g.clear();
  g.fillStyle(0x4a7c2f); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x55882e); g.fillRect(4, 6, 4, 3); g.fillRect(22, 14, 3, 2); g.fillRect(10, 24, 5, 2);
  g.fillStyle(0x3d6626); g.fillRect(14, 3, 3, 2); g.fillRect(7, 19, 2, 3); g.fillRect(26, 26, 3, 2);
  g.fillStyle(0x5c9433, 0.6); g.fillRect(19, 8, 2, 2); g.fillRect(3, 27, 3, 2); g.fillRect(28, 4, 2, 3);
  g.generateTexture('grass', 32, 32);

  // grass2 — slightly lighter patches
  g.clear();
  g.fillStyle(0x4a7c2f); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x5c9433); g.fillRect(2, 2, 10, 8); g.fillRect(18, 16, 9, 7);
  g.fillStyle(0x3d6626); g.fillRect(8, 18, 6, 5); g.fillRect(24, 5, 5, 4);
  g.fillStyle(0x4a7c2f); g.fillRect(4, 4, 6, 4); g.fillRect(20, 18, 5, 3);
  g.fillStyle(0x55882e); g.fillRect(14, 10, 3, 3); g.fillRect(5, 26, 4, 2);
  g.generateTexture('grass2', 32, 32);

  // grass3 — darker with small dots
  g.clear();
  g.fillStyle(0x3a6622); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x2d5518); g.fillRect(5, 3, 8, 6); g.fillRect(20, 20, 7, 6);
  g.fillStyle(0x447728); g.fillRect(14, 12, 10, 5); g.fillRect(2, 22, 6, 4);
  g.fillStyle(0x233f12); g.fillRect(4, 4, 2, 2); g.fillRect(12, 18, 2, 2);
  g.fillStyle(0x233f12); g.fillRect(24, 8, 2, 2); g.fillRect(28, 26, 2, 2); g.fillRect(8, 28, 2, 2);
  g.fillStyle(0x4a7c2f); g.fillRect(17, 5, 2, 2); g.fillRect(25, 14, 2, 2); g.fillRect(6, 13, 2, 2);
  g.generateTexture('grass3', 32, 32);

  // Tall grass — grassland biome (bright green blades)
  g.clear();
  g.fillStyle(0x3a6820); g.fillRect(6, 10, 3, 14); g.fillRect(11, 8, 3, 16); g.fillRect(16, 11, 2, 13); g.fillRect(21, 9, 3, 15);
  g.fillStyle(0x4e8a2a); g.fillRect(7, 6, 2, 8); g.fillRect(12, 4, 2, 9); g.fillRect(17, 7, 2, 7); g.fillRect(22, 5, 2, 8);
  g.fillStyle(0x62aa36); g.fillRect(7, 3, 1, 5); g.fillRect(12, 1, 2, 5); g.fillRect(17, 4, 1, 5); g.fillRect(22, 2, 1, 5);
  g.generateTexture('tall_grass', 32, 24);

  // Tall grass — wasteland (dry yellow-brown stalks)
  g.clear();
  g.fillStyle(0x6a5020); g.fillRect(5, 12, 3, 12); g.fillRect(11, 10, 2, 14); g.fillRect(16, 13, 3, 11); g.fillRect(22, 11, 2, 13);
  g.fillStyle(0x8a6e30); g.fillRect(5, 7, 2, 7); g.fillRect(11, 6, 2, 6); g.fillRect(16, 8, 2, 7); g.fillRect(22, 7, 2, 6);
  g.fillStyle(0xaa8c44); g.fillRect(5, 4, 2, 4); g.fillRect(11, 3, 2, 4); g.fillRect(16, 5, 2, 4); g.fillRect(22, 4, 1, 4);
  g.generateTexture('tall_grass_waste', 32, 24);

  // Tall grass — tundra (pale blue-white frost grass)
  g.clear();
  g.fillStyle(0x8899aa); g.fillRect(6, 12, 3, 12); g.fillRect(12, 10, 2, 14); g.fillRect(17, 13, 3, 11); g.fillRect(23, 11, 2, 13);
  g.fillStyle(0xaabbcc); g.fillRect(6, 7, 2, 7); g.fillRect(12, 6, 2, 6); g.fillRect(17, 8, 2, 7); g.fillRect(23, 7, 2, 6);
  g.fillStyle(0xddeeff); g.fillRect(6, 4, 2, 4); g.fillRect(12, 3, 2, 4); g.fillRect(17, 5, 2, 4); g.fillRect(23, 4, 1, 4);
  g.generateTexture('tall_grass_tundra', 32, 24);

  // Tall grass — swamp (dark murky reeds)
  g.clear();
  g.fillStyle(0x2a4a1a); g.fillRect(5, 8, 3, 16); g.fillRect(11, 6, 2, 18); g.fillRect(17, 9, 3, 15); g.fillRect(23, 7, 2, 17);
  g.fillStyle(0x3a6628); g.fillRect(5, 4, 2, 6); g.fillRect(11, 2, 2, 6); g.fillRect(17, 5, 2, 6); g.fillRect(23, 3, 2, 6);
  g.fillStyle(0x1a3010); g.fillRect(4, 12, 2, 4); g.fillRect(10, 14, 2, 4); g.fillRect(16, 11, 2, 4); g.fillRect(22, 13, 2, 4);
  g.generateTexture('tall_grass_swamp', 32, 24);

  // Bush (16×14, decorative only)
  g.clear();
  g.fillStyle(0x1f5c0f); g.fillCircle(8, 9, 7);
  g.fillStyle(0x2a7a18); g.fillCircle(5, 8, 5); g.fillCircle(11, 8, 5);
  g.fillStyle(0x196010); g.fillCircle(8, 6, 4);
  g.fillStyle(0x3a9a22); g.fillCircle(6, 7, 2); g.fillCircle(10, 6, 2);
  g.fillStyle(0x1a3a0a); g.fillRect(6, 12, 4, 2);
  g.generateTexture('bush', 16, 14);

  // Tree
  g.clear();
  g.fillStyle(0x5c3317); g.fillRect(10, 22, 8, 14);
  g.fillStyle(0x3d2010); g.fillRect(10, 22, 2, 14);
  g.fillStyle(0x1f5c0f); g.fillCircle(14, 16, 12);
  g.fillStyle(0x2d8c1a); g.fillCircle(14, 13, 10);
  g.fillStyle(0x3daa22); g.fillCircle(12, 10, 7);
  g.fillStyle(0x4ec42a); g.fillCircle(15, 7, 5);
  g.generateTexture('tree', 28, 36);

  // Rock — polygon-based with lit top face for depth
  g.clear();
  // Main body: dark warm-grey base mass
  g.fillStyle(0x706860);
  g.fillPoints([{x:2,y:15},{x:0,y:9},{x:3,y:3},{x:9,y:1},{x:15,y:1},{x:20,y:4},{x:22,y:10},{x:18,y:15}], true);
  // Top-left highlight face: lighter grey creates lit-top depth illusion
  g.fillStyle(0xc0b8a8);
  g.fillPoints([{x:3,y:13},{x:1,y:8},{x:4,y:3},{x:9,y:2},{x:14,y:2},{x:17,y:6},{x:18,y:11},{x:15,y:13}], true);
  // Cracks: thin dark lines for texture
  g.lineStyle(1, 0x3e3836);
  g.beginPath(); g.moveTo(8,7); g.lineTo(11,11); g.lineTo(9,15); g.strokePath();
  g.beginPath(); g.moveTo(14,4); g.lineTo(16,8); g.strokePath();
  g.generateTexture('rock', 22, 16);

  // Desert rock — sandstone orange-red (22×16)
  g.clear();
  g.fillStyle(0xcc7744);
  g.fillPoints([{x:2,y:15},{x:0,y:9},{x:3,y:3},{x:9,y:1},{x:15,y:1},{x:20,y:4},{x:22,y:10},{x:18,y:15}], true);
  g.fillStyle(0xdd9966);
  g.fillPoints([{x:3,y:13},{x:1,y:8},{x:4,y:3},{x:9,y:2},{x:14,y:2},{x:17,y:6},{x:18,y:11},{x:15,y:13}], true);
  g.fillStyle(0xeebb88); g.fillRect(6, 4, 2, 2); g.fillRect(12, 6, 1, 1);
  g.generateTexture('rock_desert', 22, 16);

  // Barracks
  g.clear();
  g.fillStyle(0x556644); g.fillRect(0, 12, 80, 44);
  g.fillStyle(0x445533); g.fillRect(0, 8, 80, 8);
  g.fillStyle(0x334422); g.fillRect(0, 4, 80, 6);
  g.fillStyle(0x223311); g.fillRect(0, 0, 80, 6);
  g.fillStyle(0x667755); g.fillRect(2, 13, 76, 42);
  g.fillStyle(0x1a1a1a); g.fillRect(32, 34, 16, 22);
  g.fillStyle(0x4a3322); g.fillRect(33, 35, 14, 21);
  g.fillStyle(0x8b6914); g.fillRect(33, 43, 6, 3); g.fillRect(41, 43, 6, 3);
  g.fillStyle(0x222222); g.fillRect(44, 46, 2, 2);
  g.fillStyle(0xbbddff, 0.7); g.fillRect(8, 20, 14, 10); g.fillRect(58, 20, 14, 10);
  g.fillStyle(0x334422); g.fillRect(8, 24, 14, 2); g.fillRect(15, 20, 2, 10);
  g.fillStyle(0x334422); g.fillRect(58, 24, 14, 2); g.fillRect(65, 20, 2, 10);
  g.fillStyle(0x884422); g.fillRect(70, 0, 2, 14);
  g.fillStyle(0xcc2222); g.fillRect(72, 0, 10, 8);
  g.fillStyle(0xccaa22);
  for (let a = 0; a < 5; a++) {
    const ang = (a * 72 - 90) * Math.PI / 180;
    g.fillCircle(40 + Math.cos(ang)*7, 30 + Math.sin(ang)*7, 2);
  }
  g.fillCircle(40, 30, 3);
  g.generateTexture('barracks', 80, 56);

  // Characters — all directions & walk frames (drawn at native 44×60 for full pixel precision)
  drawKnight(g);       drawKnightStep(g);
  drawKnightFront(g);  drawKnightFrontStep(g);
  drawKnightBack(g);   drawKnightBackStep(g);
  drawKnightFSide(g);  drawKnightFSideStep(g);
  drawKnightBSide(g);  drawKnightBSideStep(g);
  drawGunslinger(g);       drawGunslingerStep(g);
  drawGunslingerFront(g);  drawGunslingerFrontStep(g);
  drawGunslingerBack(g);   drawGunslingerBackStep(g);
  drawGunslingerFSide(g);  drawGunslingerFSideStep(g);
  drawGunslingerBSide(g);  drawGunslingerBSideStep(g);
  drawArchitect(g);       drawArchitectStep(g);
  drawArchitectFront(g);  drawArchitectFrontStep(g);
  drawArchitectBack(g);   drawArchitectBackStep(g);
  drawArchitectFSide(g);  drawArchitectFSideStep(g);
  drawArchitectBSide(g);  drawArchitectBSideStep(g);
  drawLauren(g);       drawLaurenStep(g);
  drawLaurenFront(g);  drawLaurenFrontStep(g);
  drawLaurenBack(g);   drawLaurenBackStep(g);
  drawLaurenFSide(g);  drawLaurenFSideStep(g);
  drawLaurenBSide(g);  drawLaurenBSideStep(g);
  drawAbigail(g);       drawAbigailStep(g);
  drawAbigailFront(g);  drawAbigailFrontStep(g);
  drawAbigailBack(g);   drawAbigailBackStep(g);
  drawAbigailFSide(g);  drawAbigailFSideStep(g);
  drawAbigailBSide(g);  drawAbigailBSideStep(g);
  // Attack-pose frames
  drawKnightAtk(g); drawKnightAtkFront(g); drawKnightAtkBack(g); drawKnightAtkFSide(g); drawKnightAtkBSide(g);
  drawGunslingerAtk(g); drawGunslingerAtkFront(g); drawGunslingerAtkBack(g); drawGunslingerAtkFSide(g); drawGunslingerAtkBSide(g);
  drawArchitectAtk(g); drawArchitectAtkFront(g); drawArchitectAtkBack(g); drawArchitectAtkFSide(g); drawArchitectAtkBSide(g);
  drawLaurenAtk(g); drawLaurenAtkFront(g); drawLaurenAtkBack(g); drawLaurenAtkFSide(g); drawLaurenAtkBSide(g);
  drawAbigailAtk(g); drawAbigailAtkFront(g); drawAbigailAtkBack(g); drawAbigailAtkFSide(g); drawAbigailAtkBSide(g);
  // Enemy raider directional sprites
  drawRaiderDirectionals(g);

  // Bullet
  g.clear();
  g.fillStyle(0xffee44); g.fillRect(2, 1, 6, 2);
  g.fillStyle(0xff9900); g.fillRect(0, 0, 3, 4);
  g.generateTexture('bullet', 8, 4);

  // Ammo icon
  g.clear();
  g.fillStyle(0xffee44); g.fillRect(3, 3, 4, 10);
  g.fillStyle(0xffcc00); g.fillRect(2, 0, 6, 4);
  g.fillStyle(0x777700); g.fillRect(3, 12, 4, 2);
  g.generateTexture('ammo_icon', 10, 14);

  // Flower projectile (Lauren's toss)
  g.clear();
  g.fillStyle(0xff99bb); g.fillCircle(6, 6, 5);
  g.fillStyle(0xffccdd); g.fillCircle(6, 6, 3);
  g.fillStyle(0xffee44); g.fillCircle(6, 6, 2);
  g.fillStyle(0x44aa22); g.fillRect(5, 9, 2, 5);
  g.generateTexture('item_flower', 12, 14);

  // Resource items
  // Wood
  g.clear();
  g.fillStyle(0x8b5a2b); g.fillRect(1, 2, 10, 4);
  g.fillStyle(0xa67744); g.fillRect(2, 3, 8, 2);
  g.fillStyle(0x6b3a1f); g.fillRect(0, 3, 2, 2); g.fillRect(10, 3, 2, 2);
  g.generateTexture('item_wood', 12, 8);

  // Metal scrap
  g.clear();
  g.fillStyle(0x888899); g.fillRect(1, 1, 8, 6);
  g.fillStyle(0xaaaabb); g.fillRect(2, 2, 4, 3);
  g.fillStyle(0x666677); g.fillRect(6, 0, 4, 3);
  g.generateTexture('item_metal', 10, 8);

  // Fiber (from mutant plants)
  g.clear();
  g.fillStyle(0x44aa33); g.fillRect(0, 1, 2, 6); g.fillRect(4, 0, 2, 7); g.fillRect(8, 2, 2, 5);
  g.fillStyle(0x66cc44); g.fillRect(1, 0, 1, 4); g.fillRect(5, 1, 1, 3); g.fillRect(9, 3, 1, 3);
  g.generateTexture('item_fiber', 10, 8);

  // Ammo pickup
  g.clear();
  g.fillStyle(0xffcc00); g.fillRect(1, 1, 4, 6);
  g.fillStyle(0xffee44); g.fillRect(2, 0, 2, 3);
  g.fillStyle(0xffcc00); g.fillRect(6, 1, 4, 6);
  g.fillStyle(0xffee44); g.fillRect(7, 0, 2, 3);
  g.generateTexture('item_ammo', 10, 8);

  // Food (meat)
  g.clear();
  g.fillStyle(0xcc4433); g.fillEllipse(5, 4, 9, 7);
  g.fillStyle(0xddccbb); g.fillRect(2, 5, 2, 3);
  g.generateTexture('item_food', 10, 8);

  // Rare boss drop — glowing crystal shard
  g.clear();
  g.fillStyle(0xff6600); g.fillTriangle(5, 0, 0, 10, 10, 10);
  g.fillStyle(0xffaa44); g.fillTriangle(5, 2, 2, 9, 8, 9);
  g.fillStyle(0xffdd88); g.fillRect(4, 3, 2, 4);
  g.generateTexture('item_rare', 10, 10);

  // Buildable structures
  // Wall segment
  g.clear();
  g.fillStyle(0x7a6644); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x665533); g.fillRect(1, 1, 14, 14); g.fillRect(17, 1, 14, 14);
  g.fillStyle(0x665533); g.fillRect(1, 17, 14, 14); g.fillRect(17, 17, 14, 14);
  g.fillStyle(0x8a7654); g.fillRect(2, 2, 12, 12); g.fillRect(18, 2, 12, 12);
  g.fillStyle(0x8a7654); g.fillRect(2, 18, 12, 12); g.fillRect(18, 18, 12, 12);
  g.fillStyle(0x555533); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32);
  g.generateTexture('wall', 32, 32);

  // Campfire
  g.clear();
  g.fillStyle(0x5c3317); g.fillRect(2, 10, 4, 4); g.fillRect(10, 10, 4, 4);
  g.fillRect(6, 12, 4, 2);
  g.fillStyle(0xff6600); g.fillEllipse(8, 8, 8, 10);
  g.fillStyle(0xffaa00); g.fillEllipse(8, 6, 5, 7);
  g.fillStyle(0xffee44); g.fillEllipse(8, 5, 3, 4);
  g.generateTexture('campfire', 16, 14);

  // Fire glow — radial warm gradient with softer falloff so it reads as
  // a real pool of light rather than concentric color rings.
  g.clear();
  g.fillStyle(0xff6611, 0.08); g.fillCircle(64, 64, 64);
  g.fillStyle(0xff7722, 0.10); g.fillCircle(64, 64, 56);
  g.fillStyle(0xff8833, 0.12); g.fillCircle(64, 64, 48);
  g.fillStyle(0xff9944, 0.14); g.fillCircle(64, 64, 40);
  g.fillStyle(0xffaa55, 0.16); g.fillCircle(64, 64, 32);
  g.fillStyle(0xffbb66, 0.18); g.fillCircle(64, 64, 24);
  g.fillStyle(0xffcc77, 0.20); g.fillCircle(64, 64, 16);
  g.fillStyle(0xffee99, 0.22); g.fillCircle(64, 64, 8);
  g.generateTexture('fire_glow', 128, 128);

  // Torch — wall sconce (bracket + cup + flame, top-down isometric style)
  g.clear();
  // Wall mounting plate
  g.fillStyle(0x3a2a1a); g.fillRect(3, 13, 5, 5);
  // Stem / handle
  g.fillStyle(0x7a5a2a); g.fillRect(4, 7, 3, 7);
  // Cup / holder
  g.fillStyle(0xa07838); g.fillRect(2, 5, 7, 3);
  g.fillStyle(0x7a5a2a); g.fillRect(1, 7, 9, 1); // rim shadow
  // Flame
  g.fillStyle(0xff6600); g.fillEllipse(5, 3, 6, 7);
  g.fillStyle(0xffaa00); g.fillEllipse(5, 2, 4, 5);
  g.fillStyle(0xffee44); g.fillEllipse(5, 1, 2, 3);
  g.generateTexture('torch', 10, 18);

  // Crafting bench
  g.clear();
  g.fillStyle(0x6b4422); g.fillRect(0, 6, 24, 12);
  g.fillStyle(0x885533); g.fillRect(1, 7, 22, 10);
  g.fillStyle(0x4a2a0a); g.fillRect(1, 14, 4, 6); g.fillRect(19, 14, 4, 6);
  g.fillStyle(0x888888); g.fillRect(3, 2, 6, 6); // anvil
  g.fillStyle(0xaaaaaa); g.fillRect(4, 0, 4, 3);
  g.fillStyle(0x8b5a2b); g.fillRect(14, 3, 7, 5); // hammer
  g.fillStyle(0x666666); g.fillRect(16, 0, 3, 4);
  g.generateTexture('craftbench', 24, 20);

  // Bed (top-down: wood frame, mattress, pillow, blanket)
  g.clear();
  g.fillStyle(0x5a3010); g.fillRect(0, 0, 40, 28);        // dark wood frame
  g.fillStyle(0xc9a87c); g.fillRect(2, 2, 36, 24);        // inner wood
  g.fillStyle(0x7755aa); g.fillRect(4, 12, 32, 12);       // purple blanket
  g.fillStyle(0x9977cc); g.fillRect(4, 12, 32, 5);        // blanket highlight
  g.fillStyle(0xeeeeff); g.fillRect(6, 4, 14, 9);         // white pillow
  g.fillStyle(0xccccee); g.fillRect(7, 5, 12, 7);         // pillow shadow
  g.fillStyle(0x5a3010); g.fillRect(0, 10, 40, 2);        // headboard/footboard divider
  g.generateTexture('bed', 40, 28);

  // Spike trap — wooden board with metal spikes
  g.clear();
  g.fillStyle(0x6a4a2a); g.fillRect(2, 2, 28, 28);
  g.fillStyle(0x4a3018); g.fillRect(2, 2, 28, 4); g.fillRect(2, 26, 28, 4);
  g.fillStyle(0xaaaaaa); // spikes
  for (let si = 0; si < 4; si++) {
    const sx = 5 + si * 7;
    g.fillTriangle(sx, 22, sx+3, 22, sx+1, 8);
    g.fillTriangle(sx+1, 22, sx+4, 22, sx+2, 9);
  }
  g.fillStyle(0x888888);
  for (let si = 0; si < 4; si++) {
    const sx = 5 + si * 7;
    g.fillRect(sx, 20, 3, 3);
  }
  g.generateTexture('spike_trap', 32, 32);

  // Build ghost (translucent wall preview)
  g.clear();
  g.fillStyle(0x88ff88, 0.4); g.fillRect(0, 0, 32, 32);
  g.lineStyle(2, 0x44ff44, 0.6); g.strokeRect(0, 0, 32, 32);
  g.generateTexture('build_ghost', 32, 32);

  // ── BIOME GROUND TEXTURES ─────────────────────────────────────
  // Wasteland ground — brown/tan
  g.clear();
  g.fillStyle(0x8a7044); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x9a8050); g.fillRect(3, 5, 6, 4); g.fillRect(18, 20, 5, 3);
  g.fillStyle(0x7a6034); g.fillRect(12, 2, 4, 3); g.fillRect(24, 14, 3, 4);
  g.fillStyle(0x6a5028); g.fillRect(8, 16, 3, 2); g.fillRect(26, 6, 3, 2);
  g.fillStyle(0x9a8858); g.fillRect(1, 26, 4, 3); g.fillRect(20, 8, 2, 2);
  g.generateTexture('ground_waste', 32, 32);

  // Swamp ground — dark green/purple
  g.clear();
  g.fillStyle(0x2a4a2a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x1a3a1a); g.fillRect(4, 3, 8, 6); g.fillRect(20, 18, 6, 5);
  g.fillStyle(0x3a2a4a); g.fillRect(14, 10, 6, 4); g.fillRect(2, 22, 5, 3);
  g.fillStyle(0x223322); g.fillRect(8, 28, 3, 2); g.fillRect(26, 4, 2, 3);
  g.fillStyle(0x2a3a2a); g.fillRect(18, 2, 4, 2); g.fillRect(6, 14, 3, 2);
  g.generateTexture('ground_swamp', 32, 32);

  // Tundra ground — white/light blue
  g.clear();
  g.fillStyle(0xccddee); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xddeeff); g.fillRect(2, 4, 8, 5); g.fillRect(18, 16, 7, 6);
  g.fillStyle(0xbbccdd); g.fillRect(10, 12, 5, 4); g.fillRect(24, 4, 4, 3);
  g.fillStyle(0xaabbcc); g.fillRect(4, 24, 3, 2); g.fillRect(20, 8, 2, 2);
  g.fillStyle(0xeef4ff); g.fillRect(14, 26, 4, 3); g.fillRect(6, 8, 2, 2);
  g.generateTexture('ground_tundra', 32, 32);

  // Ruins ground — dark gray stone
  g.clear();
  g.fillStyle(0x444450); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x555560); g.fillRect(0, 0, 15, 15); g.fillRect(17, 17, 15, 15);
  g.fillStyle(0x3a3a44); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32);
  g.fillStyle(0x4a4a55); g.fillRect(3, 3, 10, 10); g.fillRect(19, 19, 10, 10);
  g.fillStyle(0x383844); g.fillRect(8, 22, 4, 3); g.fillRect(22, 6, 3, 2);
  g.generateTexture('ground_ruins', 32, 32);

  // Fungal ground (32×32) — dark purple-teal with bioluminescent spore clusters
  g.clear();
  g.fillStyle(0x1a0a2a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x2a1a3a); g.fillRect(2, 2, 14, 14); g.fillRect(18, 18, 12, 12);
  g.fillStyle(0x221533); g.fillRect(16, 2, 14, 14); g.fillRect(2, 18, 14, 12);
  g.fillStyle(0xaa44cc); g.fillCircle(8, 6, 2); g.fillCircle(22, 21, 2); g.fillCircle(13, 27, 1);
  g.fillStyle(0x8833aa); g.fillCircle(4, 19, 1); g.fillCircle(28, 8, 2); g.fillCircle(20, 13, 1);
  g.fillStyle(0xcc66ee); g.fillCircle(10, 11, 1); g.fillCircle(26, 26, 1); g.fillCircle(17, 4, 1);
  g.generateTexture('ground_fungal', 32, 32);

  // Desert ground (32×32) — sandy gold with wind-ripple marks and pebbles
  g.clear();
  g.fillStyle(0xd4a56a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xbb9050); g.fillRect(0, 8, 32, 2); g.fillRect(0, 18, 32, 2); g.fillRect(0, 26, 32, 1);
  g.fillStyle(0xe8c07a); g.fillRect(0, 10, 32, 1); g.fillRect(0, 20, 32, 1);
  g.fillStyle(0xc99055); g.fillRect(0, 14, 32, 1);
  g.fillStyle(0x997744); g.fillCircle(6, 4, 1); g.fillCircle(24, 14, 1); g.fillCircle(14, 28, 1);
  g.fillStyle(0xaa8855); g.fillCircle(20, 5, 1); g.fillCircle(4, 24, 1);
  g.generateTexture('ground_desert', 32, 32);

  // Dead tree — gray trunk, bare branches, no foliage
  g.clear();
  g.fillStyle(0x666666); g.fillRect(11, 16, 6, 20);
  g.fillStyle(0x555555); g.fillRect(11, 16, 2, 20);
  g.fillStyle(0x777777); g.fillRect(8, 8, 3, 10); // left branch
  g.fillStyle(0x666666); g.fillRect(5, 4, 3, 6);
  g.fillStyle(0x777777); g.fillRect(17, 6, 3, 12); // right branch
  g.fillStyle(0x666666); g.fillRect(20, 2, 3, 6);
  g.fillStyle(0x888888); g.fillRect(12, 10, 4, 3); // top stub
  g.fillStyle(0x777777); g.fillRect(13, 6, 2, 5);
  g.generateTexture('tree_dead', 28, 36);

  // Snow tree — green tree with white snow cap
  g.clear();
  g.fillStyle(0x5c3317); g.fillRect(10, 22, 8, 14);
  g.fillStyle(0x3d2010); g.fillRect(10, 22, 2, 14);
  g.fillStyle(0x1a5010); g.fillCircle(14, 16, 12);
  g.fillStyle(0x2a7018); g.fillCircle(14, 13, 10);
  g.fillStyle(0xddeeff); g.fillCircle(14, 8, 9); // snow cap
  g.fillStyle(0xeef4ff); g.fillCircle(12, 6, 6);
  g.fillStyle(0xffffff); g.fillCircle(15, 4, 4);
  g.generateTexture('tree_snow', 28, 36);

  // Swamp tree — dark murky green with hanging moss
  g.clear();
  g.fillStyle(0x2a1c08); g.fillRect(10, 20, 8, 16);
  g.fillStyle(0x1e1406); g.fillRect(10, 20, 2, 16);
  g.fillStyle(0x1a3012); g.fillCircle(14, 14, 12);
  g.fillStyle(0x223818); g.fillCircle(14, 11, 9);
  g.fillStyle(0x0e1a0a); g.fillCircle(11, 13, 3);
  // Hanging moss streaks
  g.fillStyle(0x1c2e14); g.fillRect(8, 18, 2, 9); g.fillRect(14, 17, 2, 8); g.fillRect(19, 18, 2, 10);
  g.fillStyle(0x162410); g.fillRect(11, 19, 1, 7); g.fillRect(17, 18, 1, 8);
  g.generateTexture('tree_swamp', 28, 36);

  // Mushroom tree (28×40) — thick gray-brown stalk, wide purple cap with spots
  g.clear();
  g.fillStyle(0x887766); g.fillRect(10, 22, 8, 18); // stalk
  g.fillStyle(0x665544); g.fillRect(10, 22, 2, 18); // shadow side
  g.fillStyle(0xaa33bb); g.fillEllipse(14, 20, 28, 18); // cap
  g.fillStyle(0xcc55dd); g.fillEllipse(14, 18, 22, 12); // cap highlight
  g.fillStyle(0x8822aa); g.fillEllipse(14, 22, 28, 8); // cap underside
  g.fillStyle(0xeebb44); g.fillCircle(8, 15, 2); g.fillCircle(20, 14, 2); g.fillCircle(14, 12, 1); // spots
  g.generateTexture('tree_mushroom', 28, 40);

  // Cactus (16×36) — green pillar with two offset arms
  g.clear();
  g.fillStyle(0x2d7a3a); g.fillRect(5, 4, 6, 32); // main trunk
  g.fillStyle(0x3d9a4a); g.fillRect(5, 6, 3, 26); // highlight
  g.fillStyle(0x2d7a3a); g.fillRect(2, 14, 5, 4); g.fillRect(2, 10, 4, 6); // left arm
  g.fillStyle(0x3d9a4a); g.fillRect(2, 14, 2, 4);
  g.fillStyle(0x2d7a3a); g.fillRect(9, 20, 5, 4); g.fillRect(9, 16, 4, 6); // right arm (lower)
  g.fillStyle(0x3d9a4a); g.fillRect(11, 20, 2, 4);
  g.generateTexture('tree_cactus', 16, 36);

  // Great Oak — wide round canopy, thick trunk, grassland landmark (40×52)
  g.clear();
  g.fillStyle(0x5c3415); g.fillRect(15, 33, 10, 19);
  g.fillStyle(0x3d2010); g.fillRect(15, 33, 3, 19);
  g.fillStyle(0x6e4022); g.fillRect(21, 35, 3, 17);
  // Root buttresses
  g.fillStyle(0x5c3415); g.fillTriangle(8, 52, 17, 42, 17, 52);
  g.fillStyle(0x5c3415); g.fillTriangle(32, 52, 23, 42, 23, 52);
  // Canopy layers — dark to bright (bottom to top)
  g.fillStyle(0x144010); g.fillEllipse(20, 29, 38, 28);
  g.fillStyle(0x1e5818); g.fillEllipse(20, 23, 32, 24);
  g.fillStyle(0x2a6820); g.fillEllipse(20, 16, 26, 20);
  g.fillStyle(0x387828); g.fillEllipse(18, 12, 16, 12);
  g.generateTexture('great_oak', 40, 52);

  // Great Pine — tall narrow layered pine, tundra landmark (30×64)
  g.clear();
  g.fillStyle(0x5c3317); g.fillRect(13, 48, 4, 16);
  g.fillStyle(0x3d2010); g.fillRect(13, 48, 1, 16);
  // 4 tiers: bottom (wide) to top (narrow)
  g.fillStyle(0x164010); g.fillTriangle(15, 48, 1, 56, 29, 56);
  g.fillStyle(0x1e5018); g.fillTriangle(15, 45, 3, 54, 27, 54);
  g.fillStyle(0xe8f2ff); g.fillTriangle(15, 45, 8, 49, 22, 49);
  g.fillStyle(0x1a4812); g.fillTriangle(15, 36, 4, 47, 26, 47);
  g.fillStyle(0x225a1a); g.fillTriangle(15, 34, 6, 45, 24, 45);
  g.fillStyle(0xe8f2ff); g.fillTriangle(15, 34, 9, 38, 21, 38);
  g.fillStyle(0x185010); g.fillTriangle(15, 24, 6, 36, 24, 36);
  g.fillStyle(0x206018); g.fillTriangle(15, 22, 7, 34, 23, 34);
  g.fillStyle(0xe8f2ff); g.fillTriangle(15, 22, 10, 26, 20, 26);
  g.fillStyle(0x1a5812); g.fillTriangle(15, 12, 8, 25, 22, 25);
  g.fillStyle(0x246820); g.fillTriangle(15, 10, 9, 23, 21, 23);
  g.fillStyle(0xeef6ff); g.fillTriangle(15, 4, 11, 13, 19, 13);
  g.fillStyle(0xffffff); g.fillTriangle(15, 2, 12, 9, 18, 9);
  g.generateTexture('great_pine', 30, 64);

  // Great Mangrove — wide gnarled roots, swamp landmark (52×50)
  g.clear();
  // Spreading root trunks
  g.fillStyle(0x2e1c08);
  g.fillTriangle(20, 50, 4, 50, 16, 28);
  g.fillTriangle(22, 50, 14, 50, 20, 26);
  g.fillRect(22, 22, 8, 28);
  g.fillTriangle(30, 50, 36, 50, 32, 26);
  g.fillTriangle(32, 50, 48, 50, 36, 28);
  g.fillStyle(0x3d2810); g.fillRect(23, 22, 3, 28);
  // Wide irregular canopy
  g.fillStyle(0x182e12); g.fillEllipse(26, 18, 50, 32);
  g.fillStyle(0x1e3818); g.fillEllipse(24, 13, 44, 24);
  g.fillStyle(0x142810); g.fillCircle(18, 14, 10); g.fillCircle(34, 12, 8);
  // Hanging moss
  g.fillStyle(0x162a10);
  g.fillRect(8, 28, 2, 14); g.fillRect(16, 24, 2, 11); g.fillRect(30, 24, 2, 9); g.fillRect(40, 26, 2, 13);
  // Canopy highlight
  g.fillStyle(0x284a1e); g.fillEllipse(22, 10, 18, 12);
  g.generateTexture('great_mangrove', 52, 50);

  // Mushroom — red/purple cap, replacing bushes in swamp
  g.clear();
  g.fillStyle(0x887766); g.fillRect(6, 10, 4, 6); // stem
  g.fillStyle(0xaa8877); g.fillRect(7, 11, 2, 5);
  g.fillStyle(0xaa2244); g.fillEllipse(8, 8, 14, 10); // cap
  g.fillStyle(0xcc3355); g.fillEllipse(8, 6, 10, 6);
  g.fillStyle(0xffccdd); g.fillCircle(5, 7, 1); g.fillCircle(10, 5, 1); g.fillCircle(8, 9, 1);
  g.generateTexture('mushroom', 16, 16);

  // Broken stone pillar — for ruins biome
  g.clear();
  g.fillStyle(0x777788); g.fillRect(4, 8, 14, 28);
  g.fillStyle(0x888899); g.fillRect(6, 10, 10, 26);
  g.fillStyle(0x666677); g.fillRect(2, 28, 18, 6); // base
  g.fillStyle(0x999aaa); g.fillRect(8, 12, 6, 4); // detail
  // Broken top — jagged
  g.fillStyle(0x777788); g.fillRect(6, 6, 4, 6);
  g.fillStyle(0x888899); g.fillRect(12, 8, 5, 4);
  g.fillStyle(0x666677); g.fillRect(9, 4, 3, 6);
  g.generateTexture('pillar', 22, 36);

  // Toxic pool — murky poison water tile (large, clearly reads as dangerous liquid)
  g.clear();
  // Deep murky base
  g.fillStyle(0x1a3a1a); g.fillEllipse(32, 26, 60, 44);
  // Mid-tone water body
  g.fillStyle(0x2a5a20); g.fillEllipse(32, 25, 52, 36);
  // Lighter surface sheen
  g.fillStyle(0x3a7a28); g.fillEllipse(30, 23, 40, 26);
  // Toxic highlight — sickly yellow-green shimmer
  g.fillStyle(0x6ab830, 0.7); g.fillEllipse(28, 21, 26, 14);
  g.fillStyle(0x88cc44, 0.5); g.fillEllipse(26, 19, 14, 8);
  // Bubble spots
  g.fillStyle(0x9edd55, 0.8); g.fillCircle(20, 18, 3); g.fillCircle(38, 24, 2); g.fillCircle(30, 30, 2);
  g.fillStyle(0xccff77, 0.6); g.fillCircle(22, 17, 1); g.fillCircle(36, 22, 1);
  // Dark edge for depth
  g.lineStyle(2, 0x0a2010, 0.9); g.strokeEllipse(32, 26, 60, 44);
  g.generateTexture('toxic_pool', 64, 52);

  // Shallow water (32×32) — solid blue-green ground tile
  g.clear();
  g.fillStyle(0x226688); g.fillRect(0, 0, 32, 32);  // edge-to-edge — no 1px dark ring
  g.lineStyle(1, 0x66aac8, 0.85);
  g.beginPath(); g.moveTo(4,  8); g.lineTo(14,  8); g.strokePath();
  g.beginPath(); g.moveTo(18, 15); g.lineTo(27, 15); g.strokePath();
  g.beginPath(); g.moveTo(5,  23); g.lineTo(17, 23); g.strokePath();
  g.fillStyle(0xaadeee, 0.18); g.fillRect(5, 3, 9, 2); g.fillRect(20, 10, 5, 1);
  g.generateTexture('water_shallow', 32, 32);

  // River tile (32×32) — a SHARED animated CanvasTexture (not a per-tile TileSprite).
  // River tiles are plain add.image('water_river') objects so they batch into one
  // draw call; GameScene scrolls this single canvas each frame (see drawRiverFrame +
  // the river block in update()), animating every river tile at once with one upload.
  {
    const _riverTex = scene.textures.exists('water_river')
      ? scene.textures.get('water_river')
      : scene.textures.createCanvas('water_river', 32, 32);
    if (_riverTex && _riverTex.context) {
      drawRiverFrame(_riverTex.context, 0);
      _riverTex.refresh();
    }
  }

  // Deep water (32×32) — darker, impassable
  g.clear();
  g.fillStyle(0x112840); g.fillRect(0, 0, 32, 32);  // edge-to-edge — no 1px dark ring
  g.lineStyle(1, 0x1a4060, 0.6);
  g.beginPath(); g.moveTo(5, 10); g.lineTo(13, 10); g.strokePath();
  g.beginPath(); g.moveTo(17, 19); g.lineTo(27, 19); g.strokePath();
  g.generateTexture('water_deep', 32, 32);

  // Water submersion overlay — semi-transparent water surface drawn over player's lower body
  g.clear();
  g.fillStyle(0x1a6080, 0.62); g.fillRect(0, 0, 32, 22);
  g.fillStyle(0x44aacc, 0.22); g.fillRect(0, 0, 32, 6);   // surface highlight
  g.lineStyle(1, 0x66ccee, 0.4);
  g.beginPath(); g.moveTo(3, 8);  g.lineTo(12, 8);  g.strokePath();
  g.beginPath(); g.moveTo(16, 14); g.lineTo(27, 14); g.strokePath();
  g.beginPath(); g.moveTo(5, 18); g.lineTo(15, 18); g.strokePath();
  g.generateTexture('water_sub_overlay', 32, 22);

  // Ice tile (32×32) — light blue, passable, slippery momentum
  g.clear();
  g.fillStyle(0x9dc5e8); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xb5d8f2); g.fillRect(1, 1, 30, 30);
  g.lineStyle(1, 0x7aa8c8);
  g.beginPath(); g.moveTo(4, 8); g.lineTo(16, 4); g.strokePath();
  g.beginPath(); g.moveTo(8, 20); g.lineTo(20, 14); g.strokePath();
  g.beginPath(); g.moveTo(20, 26); g.lineTo(28, 20); g.strokePath();
  g.beginPath(); g.moveTo(10, 8); g.lineTo(10, 18); g.strokePath();
  g.beginPath(); g.moveTo(22, 14); g.lineTo(22, 28); g.strokePath();
  g.generateTexture('water_ice', 32, 32);

  // Ice rock — polygon-based, blue-grey with icy highlight face
  g.clear();
  // Main body: cool blue-grey
  g.fillStyle(0x7090a8);
  g.fillPoints([{x:2,y:15},{x:0,y:9},{x:3,y:3},{x:9,y:1},{x:15,y:1},{x:20,y:4},{x:22,y:10},{x:18,y:15}], true);
  // Top-left highlight face: pale icy blue-white
  g.fillStyle(0xbcd8e8);
  g.fillPoints([{x:3,y:13},{x:1,y:8},{x:4,y:3},{x:9,y:2},{x:14,y:2},{x:17,y:6},{x:18,y:11},{x:15,y:13}], true);
  // Frost sparkle highlights
  g.fillStyle(0xeef6ff);
  g.fillRect(7, 4, 2, 2); g.fillRect(13, 6, 1, 1); g.fillRect(5, 9, 1, 1);
  // Cracks: dark blue-grey
  g.lineStyle(1, 0x507080);
  g.beginPath(); g.moveTo(8,7); g.lineTo(11,11); g.lineTo(9,15); g.strokePath();
  g.beginPath(); g.moveTo(14,4); g.lineTo(16,8); g.strokePath();
  g.generateTexture('ice_rock', 22, 16);

  // Ice spire — tundra biome, jagged ice spike cluster (16×32)
  g.clear();
  g.fillStyle(0x3a6080); g.fillTriangle(8, 0, 1, 31, 15, 31);     // dark back spike
  g.fillStyle(0x5a8aaa); g.fillTriangle(8, 2, 3, 29, 13, 29);     // mid face
  g.fillStyle(0x8ab8d0); g.fillTriangle(8, 4, 5, 22, 11, 22);     // bright front face
  g.fillStyle(0xc0dff0); g.fillRect(7, 5, 2, 4); g.fillRect(5, 15, 1, 2); g.fillRect(10, 12, 1, 1); // frost sparkles
  g.fillStyle(0x2a4a60); g.fillTriangle(8, 0, 1, 31, 4, 20);      // shadow side
  g.fillStyle(0x1a2e3a); g.fillRect(2, 29, 12, 3);                // base shadow
  g.generateTexture('ice_spire', 16, 32);

  // Rock spire — wasteland biome, tall jagged rock formation (14×36)
  g.clear();
  g.fillStyle(0x5a3a20); g.fillTriangle(7, 0, 0, 35, 14, 35);    // dark rock body
  g.fillStyle(0x7a5234); g.fillTriangle(7, 2, 2, 31, 12, 31);    // mid face
  g.fillStyle(0x9a6848); g.fillTriangle(7, 4, 4, 22, 10, 22);    // bright highlight
  g.fillStyle(0x3a2010); g.fillTriangle(7, 0, 0, 35, 3, 22);     // shadow side
  g.fillStyle(0x4a2e18); g.fillRect(0, 33, 14, 3);               // base
  g.fillStyle(0x6a4830); g.fillRect(4, 10, 2, 2); g.fillRect(8, 17, 1, 2); // rock detail
  g.generateTexture('rock_spire', 14, 36);

  // Mangrove root tangle — swamp biome, wide twisted roots (36×18)
  g.clear();
  g.fillStyle(0x1e1208); g.fillRect(0, 8, 36, 10);               // root base fill
  g.fillStyle(0x2e1e10); g.fillRect(0, 10, 36, 5);               // mid tone
  // Arching root segments
  g.fillStyle(0x1e1208);
  g.fillRect(2, 4, 4, 8); g.fillRect(10, 2, 5, 9); g.fillRect(20, 3, 4, 8); g.fillRect(28, 5, 5, 7);
  // Mossy/wet highlights on root tops
  g.fillStyle(0x1a3010); g.fillRect(2, 5, 2, 3); g.fillRect(11, 3, 2, 4); g.fillRect(21, 4, 2, 3);
  g.fillStyle(0x3a2a14); g.fillRect(0, 8, 36, 2);                // top edge
  g.fillStyle(0x0e0a04); g.fillRect(0, 16, 36, 2);               // base shadow
  g.generateTexture('mangrove_roots', 36, 18);

  // Spiderweb — ruins biome decoration (24×24)
  g.clear();
  g.lineStyle(1, 0xaaaaaa, 0.85);
  // 8 radial spokes from center
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.lineBetween(12, 12, Math.round(12 + Math.cos(a) * 11), Math.round(12 + Math.sin(a) * 11));
  }
  // 3 concentric silk rings
  for (let r = 3; r <= 11; r += 4) {
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = 12 + Math.cos(a) * r, y = 12 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.strokePath();
  }
  g.generateTexture('spiderweb', 24, 24);

  // Mountain — large terrain feature (96x80) — visible from across the map
  g.clear();
  g.fillStyle(0x333030); g.fillTriangle(48, 0, 0, 76, 96, 76);   // dark base mass
  g.fillStyle(0x454040); g.fillTriangle(48, 6, 8, 70, 88, 70);   // mid face
  g.fillStyle(0x575252); g.fillTriangle(48, 18, 20, 62, 76, 62); // upper face
  g.fillStyle(0x2e2b2b); g.fillTriangle(48, 0, 0, 76, 32, 44);  // left shadow face
  g.fillStyle(0x3e3b3b); g.fillTriangle(20, 52, 8, 72, 40, 68); // left rock detail
  g.fillStyle(0x3e3b3b); g.fillTriangle(72, 46, 58, 70, 88, 70); // right rock detail
  g.fillStyle(0xcccccc); g.fillTriangle(48, 0, 34, 28, 62, 28); // snow cap
  g.fillStyle(0xdedede); g.fillTriangle(48, 2, 38, 20, 58, 20); // snow mid
  g.fillStyle(0xf5f5f5); g.fillTriangle(48, 4, 42, 14, 54, 14); // snow tip
  g.fillStyle(0x201e1e); g.fillRect(0, 73, 96, 7);               // base shadow
  g.generateTexture('mountain', 96, 80);

  // Mountain variant 2 — wide double-peak ridge (112x88)
  g.clear();
  g.fillStyle(0x303030); g.fillTriangle(30, 2, 0, 84, 62, 84);   // left peak
  g.fillStyle(0x303030); g.fillTriangle(82, 0, 50, 84, 112, 84); // right peak
  g.fillStyle(0x424040); g.fillTriangle(30, 8, 8, 78, 56, 78);
  g.fillStyle(0x424040); g.fillTriangle(82, 6, 54, 78, 108, 78);
  g.fillStyle(0x282828); g.fillTriangle(30, 2, 0, 84, 22, 50);   // left shadow
  g.fillStyle(0x282828); g.fillTriangle(82, 0, 50, 84, 64, 46);  // right shadow
  g.fillStyle(0x3a3838); g.fillTriangle(44, 46, 58, 84, 72, 84); // saddle
  g.fillStyle(0x484646); g.fillTriangle(46, 48, 60, 80, 70, 80);
  g.fillStyle(0xbbbbbb); g.fillTriangle(30, 2, 20, 24, 40, 24); // left snow
  g.fillStyle(0xcccccc); g.fillTriangle(30, 4, 23, 18, 37, 18);
  g.fillStyle(0xbbbbbb); g.fillTriangle(82, 0, 72, 22, 92, 22); // right snow
  g.fillStyle(0xcccccc); g.fillTriangle(82, 2, 75, 16, 89, 16);
  g.fillStyle(0x1e1e1e); g.fillRect(0, 81, 112, 7);
  g.generateTexture('mountain2', 112, 88);

  // Supply cache — small chest/crate
  g.clear();
  g.fillStyle(0x8a6622); g.fillRect(2, 4, 20, 14);
  g.fillStyle(0xaa8833); g.fillRect(3, 5, 18, 12);
  g.fillStyle(0x664411); g.fillRect(2, 4, 20, 2); // lid
  g.fillStyle(0xccaa00); g.fillRect(10, 8, 4, 4); // lock
  g.fillStyle(0xeedd22); g.fillRect(11, 9, 2, 2);
  g.generateTexture('supply_cache', 24, 20);

  // Relic — glowing violet crystal shard
  g.clear();
  g.fillStyle(0x110022); g.fillRect(0, 0, 14, 14);
  g.fillStyle(0x7722bb); g.fillTriangle(7, 1, 2, 11, 12, 11);
  g.fillStyle(0xaa55ee); g.fillTriangle(7, 3, 4, 10, 10, 10);
  g.fillStyle(0xddaaff); g.fillRect(6, 2, 2, 2);
  g.fillStyle(0x44ddff); g.fillRect(5, 9, 4, 2);
  g.generateTexture('item_relic', 14, 14);

  // Altar — stone pedestal with 5 rune slots
  g.clear();
  g.fillStyle(0x333333); g.fillRect(2, 18, 28, 10);
  g.fillStyle(0x444444); g.fillRect(4, 10, 24, 10);
  g.fillStyle(0x555555); g.fillRect(6, 4, 20, 8);
  g.fillStyle(0x777777); g.fillRect(7, 5, 18, 2);
  g.fillStyle(0x110022);
  for (let _ri = 0; _ri < 5; _ri++) g.fillRect(8 + _ri * 4, 6, 3, 4);
  g.generateTexture('altar_struct', 32, 28);

  // Raid loot cache — locked military crate (dark green, red lock)
  g.clear();
  g.fillStyle(0x2e3d1e); g.fillRect(2, 4, 22, 14);   // dark military body
  g.fillStyle(0x3e5028); g.fillRect(3, 5, 20, 12);   // body highlight
  g.fillStyle(0x1e2d0e); g.fillRect(2, 4, 22, 2);    // lid top edge
  g.fillStyle(0x5a6a44); g.fillRect(3, 5, 20, 3);    // lid face
  g.fillStyle(0x7a8a60); g.fillRect(2, 10, 22, 1);   // metal band
  g.fillStyle(0x7a8a60); g.fillRect(13, 4, 1, 14);   // vertical divider
  g.fillStyle(0xcc2222); g.fillRect(10, 7, 5, 6);    // red lock body
  g.fillStyle(0xee3333); g.fillRect(11, 5, 3, 4);    // lock shackle
  g.fillStyle(0x881111); g.fillRect(12, 9, 1, 2);    // keyhole
  g.generateTexture('raid_cache', 26, 22);

  // Ruin wall block — crumbling brick wall tile (high contrast for readability)
  g.clear();
  g.fillStyle(0x2a2a36); g.fillRect(0, 0, 32, 32);           // dark mortar base
  g.fillStyle(0x6a5c4a); g.fillRect(1, 1, 14, 6);             // brick row 1 left
  g.fillStyle(0x7a6c5a); g.fillRect(17, 1, 14, 6);            // brick row 1 right
  g.fillStyle(0x7a6c5a); g.fillRect(1, 9, 6, 6);              // brick row 2 far left
  g.fillStyle(0x6a5c4a); g.fillRect(9, 9, 14, 6);             // brick row 2 mid
  g.fillStyle(0x5a4c3a); g.fillRect(25, 9, 6, 6);             // brick row 2 right (darker)
  g.fillStyle(0x6a5c4a); g.fillRect(1, 17, 14, 6);            // brick row 3 left
  g.fillStyle(0x7a6c5a); g.fillRect(17, 17, 14, 6);           // brick row 3 right
  g.fillStyle(0x5a4c3a); g.fillRect(1, 25, 6, 6);             // brick row 4 far left
  g.fillStyle(0x7a6c5a); g.fillRect(9, 25, 14, 6);            // brick row 4 mid
  g.fillStyle(0x6a5c4a); g.fillRect(25, 25, 6, 6);            // brick row 4 right
  // Mortar cracks / damage marks
  g.fillStyle(0x1a1a24); g.fillRect(3, 4, 1, 3); g.fillRect(20, 20, 2, 2);
  g.fillStyle(0x1a1a24); g.fillRect(14, 11, 1, 4); g.fillRect(27, 28, 2, 2);
  // Bright highlight edge on top-left (gives depth)
  g.fillStyle(0x9a8c7a); g.fillRect(1, 1, 13, 1); g.fillRect(17, 1, 13, 1);
  g.fillStyle(0x9a8c7a); g.fillRect(1, 9, 5, 1); g.fillRect(9, 9, 13, 1);
  g.generateTexture('ruin_block', 32, 32);

  // Ruin interior floor — worn stone tile
  g.clear();
  g.fillStyle(0x3a3a48); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x424252); g.fillRect(1, 1, 14, 14); g.fillRect(17, 17, 14, 14);
  g.fillStyle(0x383846); g.fillRect(1, 17, 14, 14); g.fillRect(17, 1, 14, 14);
  g.fillStyle(0x2e2e3a); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32);
  g.fillStyle(0x2a2a38); g.fillRect(4, 4, 3, 3); g.fillRect(22, 20, 3, 2);
  g.generateTexture('ruin_floor', 32, 32);

  // Plank wall — weathered wood for farmhouse structures
  g.clear();
  g.fillStyle(0x8b5e3c); g.fillRect(0, 0, 32, 32); // base wood
  g.fillStyle(0x6d4a2e); // grain lines / plank seams
  g.fillRect(0, 10, 32, 2); g.fillRect(0, 22, 32, 2);
  g.fillRect(15, 0, 2, 32); // center seam
  g.fillStyle(0x4a3020); g.fillRect(3, 3, 5, 7); g.fillRect(20, 14, 6, 5); // dark weathering
  g.fillStyle(0xaa7a55); g.fillRect(2, 2, 3, 3); g.fillRect(18, 13, 3, 2); // light weathering
  g.fillStyle(0x333333); g.fillRect(5, 1, 2, 2); g.fillRect(23, 12, 2, 2); g.fillRect(5, 24, 2, 2); // nail heads
  g.generateTexture('plank_wall', 32, 32);

  // Metal wall — rusty corrugated metal for bunker structures
  g.clear();
  g.fillStyle(0x6e4438); g.fillRect(0, 0, 32, 32); // rust base
  // Corrugation ridges
  for (let ry = 0; ry < 32; ry += 8) {
    g.fillStyle(0x7e5448); g.fillRect(0, ry,   32, 4);
    g.fillStyle(0x523028); g.fillRect(0, ry+4, 32, 4);
  }
  g.fillStyle(0xb06040); g.fillRect(3, 4, 5, 5); g.fillRect(18, 12, 7, 3); g.fillRect(7, 22, 4, 6); // rust patches
  g.fillStyle(0x555555); g.fillRect(1, 2, 3, 2); g.fillRect(25, 10, 3, 2); g.fillRect(1, 18, 3, 2); // bolt heads
  g.generateTexture('metal_wall', 32, 32);

  // Rotted plank — dark waterlogged wood for swamp shack
  g.clear();
  g.fillStyle(0x2c1a0a); g.fillRect(0, 0, 32, 32); // dark wet wood
  g.fillStyle(0x1a0e06); g.fillRect(0, 10, 32, 2); g.fillRect(0, 22, 32, 2); g.fillRect(15, 0, 2, 32);
  g.fillStyle(0x0a1a0a); g.fillRect(2, 4, 8, 5); g.fillRect(18, 15, 7, 7); // standing water patches
  g.fillStyle(0x1a2e14); g.fillRect(5, 14, 5, 5); g.fillRect(22, 3, 6, 3); // algae/mold
  g.fillStyle(0x3a280e); g.fillRect(3, 2, 3, 4); g.fillRect(20, 12, 3, 3); // wet sheen
  g.generateTexture('rot_plank', 32, 32);

  // Ice floor — pale blue cracked tile for outpost interiors
  g.clear();
  g.fillStyle(0xc0d8ee); g.fillRect(0, 0, 32, 32); // icy base
  g.fillStyle(0x90b0cc); // tile grid and cracks
  g.fillRect(0, 0, 32, 1); g.fillRect(0, 15, 32, 1); g.fillRect(0, 16, 32, 1); g.fillRect(0, 31, 32, 1);
  g.fillRect(0, 0, 1, 32); g.fillRect(15, 0, 1, 32); g.fillRect(16, 0, 1, 32); g.fillRect(31, 0, 1, 32);
  g.fillStyle(0x6888a0); // crack lines
  g.fillRect(4, 4, 1, 9); g.fillRect(4, 12, 5, 1); g.fillRect(20, 18, 7, 1); g.fillRect(26, 18, 1, 6);
  g.fillStyle(0xdcf0ff); g.fillRect(2, 2, 5, 5); g.fillRect(18, 18, 6, 6); // frost highlights
  g.generateTexture('ice_floor', 32, 32);

  // Plank floor — warm wood planks for farmhouse interiors
  g.clear();
  g.fillStyle(0x7a5a30); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x8a6a3a); g.fillRect(0, 0, 32, 7); g.fillRect(0, 16, 32, 8);
  g.fillStyle(0x6a4c28); g.fillRect(0, 8, 32, 7); g.fillRect(0, 24, 32, 8);
  g.fillStyle(0x5a3c1e); g.fillRect(0, 7, 32, 1); g.fillRect(0, 15, 32, 1); g.fillRect(0, 23, 32, 1);
  g.fillStyle(0x5a3c1e); g.fillRect(10, 0, 1, 7); g.fillRect(22, 8, 1, 7); g.fillRect(6, 16, 1, 8); g.fillRect(18, 24, 1, 8);
  g.fillStyle(0x9a7a4a, 0.4); g.fillRect(2, 2, 8, 4); g.fillRect(14, 18, 8, 4);
  g.generateTexture('plank_floor', 32, 32);

  // Rot plank floor — decayed wood for swamp shack interiors
  g.clear();
  g.fillStyle(0x3a2c18); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x4a3820); g.fillRect(0, 0, 32, 7); g.fillRect(0, 16, 32, 8);
  g.fillStyle(0x2e2010); g.fillRect(0, 8, 32, 7); g.fillRect(0, 24, 32, 8);
  g.fillStyle(0x1e1208); g.fillRect(0, 7, 32, 1); g.fillRect(0, 15, 32, 1); g.fillRect(0, 23, 32, 1);
  g.fillStyle(0x1e1208); g.fillRect(10, 0, 1, 7); g.fillRect(22, 8, 1, 7); g.fillRect(6, 16, 1, 8);
  g.fillStyle(0x283810, 0.5); g.fillRect(4, 3, 3, 2); g.fillRect(18, 20, 4, 2); g.fillRect(26, 10, 3, 3);
  g.generateTexture('rot_plank_floor', 32, 32);

  // Metal floor — industrial grating for bunker interiors
  g.clear();
  g.fillStyle(0x3a3a3a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x4a4a4a); g.fillRect(0, 0, 15, 15); g.fillRect(17, 17, 15, 15);
  g.fillStyle(0x2e2e2e); g.fillRect(17, 0, 15, 15); g.fillRect(0, 17, 15, 15);
  g.fillStyle(0x222222); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32);
  g.fillStyle(0x5a5a5a, 0.6); g.fillRect(2, 2, 11, 1); g.fillRect(19, 19, 11, 1);
  g.fillStyle(0x1a1a1a); g.fillRect(4, 6, 1, 1); g.fillRect(8, 10, 1, 1); g.fillRect(20, 22, 1, 1);
  g.generateTexture('metal_floor', 32, 32);

  // Fungal wall — dark wood with purple mycelium tendrils (32×32)
  g.clear();
  g.fillStyle(0x1a0e08); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x2a1a10); g.fillRect(0, 0, 14, 14); g.fillRect(18, 18, 14, 14);
  g.fillStyle(0x1e1208); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32); // plank lines
  g.fillStyle(0x8822aa); g.fillRect(4, 6, 1, 8); g.fillRect(7, 3, 1, 5); // mycelium tendrils
  g.fillStyle(0xaa44cc); g.fillRect(20, 18, 1, 9); g.fillRect(24, 20, 1, 7);
  g.fillStyle(0xcc66ee); g.fillCircle(4, 6, 1); g.fillCircle(20, 18, 1); g.fillCircle(7, 3, 1);
  g.generateTexture('fungal_wall', 32, 32);

  // Fungal floor — dark planks with spore patterns (32×32)
  g.clear();
  g.fillStyle(0x18100a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0x221810); g.fillRect(0, 0, 32, 7); g.fillRect(0, 16, 32, 8);
  g.fillStyle(0x0e0a06); g.fillRect(0, 7, 32, 1); g.fillRect(0, 24, 32, 1); // plank seams
  g.fillStyle(0x8822aa); g.fillCircle(6, 4, 1); g.fillCircle(22, 20, 1); g.fillCircle(14, 27, 1);
  g.fillStyle(0xaa44cc); g.fillCircle(28, 5, 1); g.fillCircle(4, 20, 1);
  g.generateTexture('fungal_floor', 32, 32);

  // Sandstone wall — beige/tan stone brick for desert outpost (32×32)
  g.clear();
  g.fillStyle(0xc8a868); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xb09050); g.fillRect(0, 0, 14, 14); g.fillRect(18, 18, 14, 14);
  g.fillStyle(0x907840); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32); // mortar lines
  g.fillStyle(0xddb870); g.fillRect(1, 1, 12, 4); g.fillRect(17, 17, 12, 4); // highlight face
  g.fillStyle(0x887030); g.fillRect(3, 10, 4, 2); g.fillRect(20, 8, 3, 2); // shadow detail
  g.generateTexture('sandstone_wall', 32, 32);

  // Sandstone floor — sandy tile for desert outpost interiors (32×32)
  g.clear();
  g.fillStyle(0xd4a86a); g.fillRect(0, 0, 32, 32);
  g.fillStyle(0xbc9055); g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32); // tile seams
  g.fillStyle(0xe0bb7a); g.fillRect(2, 2, 12, 12); g.fillRect(18, 18, 12, 12); // lighter tiles
  g.fillStyle(0xb08040); g.fillRect(3, 10, 2, 2); g.fillRect(24, 4, 2, 2); // small chips
  g.generateTexture('sandstone_floor', 32, 32);

  // Crater (large) — decorative ground depression
  g.clear();
  g.fillStyle(0x1e1e1e); g.fillEllipse(24, 19, 44, 34);
  g.fillStyle(0x2a2a2a); g.fillEllipse(24, 18, 36, 26);
  g.fillStyle(0x343434); g.fillEllipse(24, 17, 24, 17);
  g.fillStyle(0x151515); g.fillEllipse(24, 19, 12, 9);
  g.generateTexture('crater_large', 48, 38);

  // Crater (small) — decorative ground depression
  g.clear();
  g.fillStyle(0x1e1e1e); g.fillEllipse(14, 12, 26, 20);
  g.fillStyle(0x2a2a2a); g.fillEllipse(14, 11, 20, 14);
  g.fillStyle(0x151515); g.fillEllipse(14, 12, 10, 7);
  g.generateTexture('crater_small', 28, 24);

  // Enemy den — dark cave/burrow
  g.clear();
  g.fillStyle(0x443322); g.fillEllipse(16, 18, 30, 20);
  g.fillStyle(0x332211); g.fillEllipse(16, 16, 24, 14);
  g.fillStyle(0x110000); g.fillEllipse(16, 14, 16, 10); // cave opening
  g.fillStyle(0x554433); g.fillRect(2, 20, 28, 8); // ground
  g.fillStyle(0x665544); g.fillRect(4, 22, 4, 4); g.fillRect(24, 22, 4, 4); // rocks
  g.generateTexture('enemy_den', 32, 28);

  // Radio tower
  g.clear();
  g.fillStyle(0x666666); g.fillRect(14, 0, 4, 48); // main pole
  g.fillStyle(0x888888); g.fillRect(8, 6, 16, 2); // crossbar 1
  g.fillStyle(0x888888); g.fillRect(10, 16, 12, 2); // crossbar 2
  g.fillStyle(0x888888); g.fillRect(12, 26, 8, 2); // crossbar 3
  g.fillStyle(0xcc2222); g.fillCircle(16, 2, 3); // red light
  // Guy wires
  g.lineStyle(1, 0x999999, 0.5);
  g.lineBetween(8, 7, 2, 44); g.lineBetween(24, 7, 30, 44);
  g.fillStyle(0x555555); g.fillRect(6, 42, 20, 6); // base
  g.generateTexture('radio_tower', 32, 48);

  // Campsite (pre-built campfire with benches)
  g.clear();
  // Ground circle
  g.fillStyle(0x5a4a2a); g.fillCircle(16, 16, 14);
  g.fillStyle(0x6a5a3a); g.fillCircle(16, 16, 10);
  // Campfire in center
  g.fillStyle(0x5c3317); g.fillRect(12, 14, 3, 3); g.fillRect(17, 14, 3, 3);
  g.fillStyle(0xff6600); g.fillEllipse(16, 13, 6, 8);
  g.fillStyle(0xffaa00); g.fillEllipse(16, 11, 4, 5);
  g.fillStyle(0xffee44); g.fillCircle(16, 10, 2);
  // Log seats
  g.fillStyle(0x5c3317); g.fillRect(4, 10, 6, 3); g.fillRect(22, 10, 6, 3);
  g.fillRect(4, 19, 6, 3); g.fillRect(22, 19, 6, 3);
  g.generateTexture('campsite', 32, 32);

  // Raider camp — rough tent cluster
  g.clear();
  g.fillStyle(0x553311); g.fillTriangle(16, 2, 0, 28, 32, 28); // tent shape
  g.fillStyle(0x442200); g.fillRect(0, 26, 32, 6);
  g.fillStyle(0x664422); g.fillTriangle(16, 4, 4, 26, 28, 26);
  g.fillStyle(0x220000); g.fillRect(14, 18, 4, 10); // door
  g.fillStyle(0xff4400); g.fillEllipse(8, 30, 6, 4); // small fire
  g.fillStyle(0xff8800); g.fillEllipse(8, 29, 4, 3);
  g.generateTexture('raid_camp', 32, 32);

  // Raider: Brawler (melee tank — dark red, stocky)
  g.clear();
  g.fillStyle(0x993322); g.fillRect(6, 8, 14, 16); // body
  g.fillStyle(0x773311); g.fillRect(4, 14, 4, 8);  // left arm
  g.fillStyle(0x773311); g.fillRect(18, 14, 4, 8); // right arm
  g.fillStyle(0xcc8855); g.fillEllipse(13, 7, 12, 10); // head
  g.fillStyle(0x551111); g.fillRect(6, 2, 14, 5);  // helmet
  g.fillStyle(0x664422); g.fillRect(6, 24, 5, 6); g.fillRect(15, 24, 5, 6); // legs
  g.generateTexture('raider_brawler', 26, 30);

  // Raider: Shooter (ranged — brown coat, slim)
  g.clear();
  g.fillStyle(0x775533); g.fillRect(7, 8, 12, 16);
  g.fillStyle(0x664422); g.fillRect(5, 14, 4, 7);
  g.fillStyle(0x664422); g.fillRect(17, 13, 6, 4); // gun arm extended
  g.fillStyle(0x444433); g.fillRect(21, 14, 6, 2); // gun barrel
  g.fillStyle(0xcc9966); g.fillEllipse(13, 7, 10, 10); // head
  g.fillStyle(0x553322); g.fillRect(7, 24, 4, 6); g.fillRect(15, 24, 4, 6);
  g.generateTexture('raider_shooter', 26, 30);

  // Raider: Heavy (both — dark gray, large)
  g.clear();
  g.fillStyle(0x445566); g.fillRect(4, 7, 18, 18); // armored body
  g.fillStyle(0x334455); g.fillRect(2, 13, 4, 10); g.fillRect(20, 13, 4, 10); // arms
  g.fillStyle(0x556677); g.fillRect(4, 7, 18, 6);  // chest plate
  g.fillStyle(0xbbaa88); g.fillEllipse(13, 6, 12, 10); // head
  g.fillStyle(0x334455); g.fillRect(4, 25, 7, 5); g.fillRect(15, 25, 7, 5);
  g.generateTexture('raider_heavy', 26, 30);

  // Boss sprites — one per biome boss type. All sprites are 56×60 px for
  // twice the pixel density of the old 40×44; spawn scale is reduced from 4× to
  // 3× so in-game footprint stays roughly similar. Outline + shading ramps
  // sharpen the silhouette against busy terrain.

  // Iron Golem (wasteland) — hulking, cracked, battle-damaged colossus
  g.clear();
  // ── LEGS: wide, planted, asymmetric stance ──
  g.fillStyle(0x445566); g.fillRect(11, 48, 14, 12); g.fillRect(33, 46, 14, 14); // right leg slightly forward
  g.fillStyle(0x556677); g.fillRect(13, 48, 6, 10); g.fillRect(35, 46, 6, 12);   // leg highlight
  g.fillStyle(0x2a3540); g.fillRect(10, 56, 16, 4); g.fillRect(32, 56, 16, 4);   // heavy feet
  // ── ARMS: asymmetric — left raised high (ready to swing), right hanging ──
  // left arm raised
  g.fillStyle(0x556677); g.fillRect(1, 6, 11, 26); g.fillRect(0, 2, 13, 8);      // raised upper arm + fist up high
  g.fillStyle(0x7788aa); g.fillRect(2, 8, 4, 22);                                 // arm gleam
  g.fillStyle(0x3a4654); g.fillRect(0, 0, 13, 5);                                 // raised fist top
  // right arm lower
  g.fillStyle(0x556677); g.fillRect(45, 20, 11, 24); g.fillRect(44, 40, 13, 9);  // lower arm + fist
  g.fillStyle(0x7788aa); g.fillRect(50, 22, 4, 18);                               // arm gleam
  g.fillStyle(0x3a4654); g.fillRect(44, 46, 13, 4);                               // lower fist base
  // ── TORSO: wide barrel chest, hunched (narrower at shoulders top, bulging mid) ──
  g.fillStyle(0x556677); g.fillRect(9, 16, 38, 34);          // main body, fills more
  g.fillStyle(0x667a8c); g.fillRect(7, 22, 42, 18);          // bulging barrel mid-chest
  g.fillStyle(0x7788aa); g.fillRect(11, 18, 34, 9);          // upper chest gleam
  g.fillStyle(0x3a4654); g.fillRect(9, 44, 38, 6);           // lower-torso shadow (hunch)
  // shoulder plates — left higher (raised arm), angular
  g.fillStyle(0x6b7e90); g.fillTriangle(4, 16, 16, 8, 18, 20);   // left pauldron, high
  g.fillStyle(0x6b7e90); g.fillTriangle(52, 22, 40, 14, 38, 26); // right pauldron, lower
  g.fillStyle(0x88a0b8); g.fillTriangle(6, 15, 14, 10, 15, 17);  // left pauldron gleam
  // ── GLOWING ORANGE CRACKS across the body ──
  g.lineStyle(2, 0xff6600);
  g.beginPath(); g.moveTo(14, 20); g.lineTo(20, 30); g.lineTo(17, 40); g.lineTo(23, 47); g.strokePath();
  g.beginPath(); g.moveTo(40, 22); g.lineTo(34, 31); g.lineTo(39, 39); g.strokePath();
  g.beginPath(); g.moveTo(28, 24); g.lineTo(30, 33); g.lineTo(26, 43); g.strokePath();
  g.lineStyle(1, 0xffaa44);
  g.beginPath(); g.moveTo(20, 30); g.lineTo(24, 28); g.strokePath();
  g.beginPath(); g.moveTo(34, 31); g.lineTo(31, 35); g.strokePath();
  // crack glow embers
  g.fillStyle(0xff8822); g.fillRect(19, 29, 2, 2); g.fillRect(33, 30, 2, 2); g.fillRect(25, 42, 2, 2);
  // rivets
  g.fillStyle(0x2a3540);
  g.fillRect(12, 19, 2, 2); g.fillRect(43, 19, 2, 2);
  g.fillRect(12, 45, 2, 2); g.fillRect(43, 45, 2, 2);
  // ── HEAD: large, angular, armored, visor band ──
  g.fillStyle(0x6b7e90); g.fillRect(16, 2, 24, 16);           // angular head block
  g.fillStyle(0x55687a); g.fillRect(14, 6, 28, 4);            // brow ridge wider than head
  g.fillStyle(0x223344); g.fillRect(15, 9, 26, 5);            // dark recessed visor band
  // glowing red eye slits + glow halo
  g.fillStyle(0xff2200, 0.35); g.fillRect(17, 8, 8, 7); g.fillRect(31, 8, 8, 7); // halo
  g.fillStyle(0xff2200); g.fillRect(19, 10, 5, 3); g.fillRect(33, 10, 5, 3);     // slits
  g.fillStyle(0xff7744); g.fillRect(20, 10, 2, 1); g.fillRect(34, 10, 2, 1);     // hot core
  // jaw vents
  g.fillStyle(0x2a3540); g.fillRect(20, 15, 4, 2); g.fillRect(28, 15, 4, 2); g.fillRect(36, 15, 4, 2);
  // outline
  g.lineStyle(1, 0x223344);
  g.strokeRect(9, 16, 38, 34);
  g.generateTexture('boss_golem', 56, 60);

  // Alpha Wolf (grassland) — massive scarred predator, coiled to pounce
  g.clear();
  // ── TAIL: low, bushy, swept back ──
  g.fillStyle(0x554422); g.fillTriangle(0, 22, 12, 26, 2, 36);
  g.fillStyle(0x665533); g.fillTriangle(2, 24, 11, 27, 4, 33);
  // ── BODY: muscular, low and coiled ──
  g.fillStyle(0x665533); g.fillEllipse(26, 34, 42, 24);            // bulk
  g.fillStyle(0x887744); g.fillEllipse(24, 29, 38, 14);           // back / shoulder mass
  g.fillStyle(0x4a3a22); g.fillEllipse(26, 42, 34, 10);           // belly shadow
  // ── RAISED HACKLES along the back ──
  g.fillStyle(0x332211);
  g.fillTriangle(12, 24, 16, 16, 20, 24);
  g.fillTriangle(19, 23, 24, 14, 29, 23);
  g.fillTriangle(27, 24, 32, 17, 37, 24);
  g.fillStyle(0x554433);
  g.fillTriangle(20, 22, 23, 17, 26, 22);
  // ── LEGS: wide, muscular, braced stance ──
  g.fillStyle(0x665533);
  g.fillRect(8, 38, 8, 16); g.fillRect(20, 40, 8, 14);            // front legs (one braced forward)
  g.fillRect(33, 38, 8, 16); g.fillRect(44, 40, 8, 14);           // back legs (spread wide)
  g.fillStyle(0x887744); g.fillRect(9, 39, 3, 12); g.fillRect(45, 41, 3, 11); // leg muscle highlight
  g.fillStyle(0x2a2012);
  g.fillRect(7, 51, 10, 4); g.fillRect(19, 51, 10, 4);
  g.fillRect(32, 51, 10, 4); g.fillRect(43, 51, 10, 4);          // big paws
  g.fillStyle(0xddccaa);                                          // claws
  g.fillRect(7, 54, 1, 2); g.fillRect(11, 54, 1, 2); g.fillRect(15, 54, 1, 2);
  g.fillRect(43, 54, 1, 2); g.fillRect(47, 54, 1, 2); g.fillRect(51, 54, 1, 2);
  // ── HEAD: oversized, lowered, aggressive ──
  g.fillStyle(0x665533); g.fillEllipse(44, 24, 24, 20);          // big head
  g.fillStyle(0x554422); g.fillEllipse(44, 30, 20, 9);           // jaw shadow
  // ears — large, pinned-forward
  g.fillStyle(0x554422); g.fillTriangle(36, 6, 33, 16, 43, 14);  // back ear
  g.fillStyle(0x665533); g.fillTriangle(50, 6, 46, 16, 56, 14);  // front ear
  g.fillStyle(0x2a2012); g.fillTriangle(50, 9, 48, 15, 54, 14);  // ear inner
  // snout / muzzle, jutting
  g.fillStyle(0x776644); g.fillEllipse(52, 28, 12, 9);
  g.fillStyle(0x1a1208); g.fillRect(53, 25, 3, 3);               // nose
  // ── SCAR across muzzle ──
  g.lineStyle(1, 0xbbaa88);
  g.beginPath(); g.moveTo(40, 19); g.lineTo(50, 27); g.strokePath();
  g.fillStyle(0x4a3a22); g.fillRect(41, 20, 1, 1); g.fillRect(45, 23, 1, 1);
  // ── EYES: large, bright amber, glowing ──
  g.fillStyle(0xffcc33, 0.4); g.fillEllipse(42, 21, 8, 6);       // glow halo
  g.fillStyle(0xffcc33); g.fillRect(39, 19, 5, 4); g.fillRect(46, 19, 5, 4); // big amber eyes
  g.fillStyle(0x1a1208); g.fillRect(41, 20, 2, 2); g.fillRect(48, 20, 2, 2); // pupils
  g.fillStyle(0xffffaa); g.fillRect(39, 19, 1, 1); g.fillRect(46, 19, 1, 1); // glint
  // ── FANGS: prominent, bared ──
  g.fillStyle(0x332211); g.fillRect(46, 32, 11, 4);              // dark open maw
  g.fillStyle(0xffffff);
  g.fillTriangle(47, 32, 49, 32, 48, 38);   // upper fangs
  g.fillTriangle(53, 32, 55, 32, 54, 38);
  g.fillTriangle(48, 36, 50, 36, 49, 32);   // lower fangs
  g.fillTriangle(52, 36, 54, 36, 53, 32);
  // outline
  g.lineStyle(1, 0x2a2012);
  g.strokeEllipse(26, 34, 42, 24);
  g.generateTexture('boss_wolf', 56, 56);

  // Spider Queen (ruins) — venomous matriarch, legs spanning the full width
  g.clear();
  // ── 4 PAIRS OF LEGS: jagged, multi-jointed, outer feet near x=0 and x=55 ──
  // Each leg: foot → outer segment → knee → inner segment → body. Built with
  // lineStyle strokes for a sharp spindly look, anchored at the cephalothorax (x≈28).
  const spiderLegY = [16, 21, 27, 33];      // body anchor heights
  const spiderFootX = [1, 4, 6, 9];          // left outer feet; mirrored on right
  const spiderFootY = [10, 18, 30, 40];      // splayed foot heights
  g.lineStyle(3, 0x1a0626);
  for (let i = 0; i < 4; i++) {
    const ay = spiderLegY[i];
    // left leg
    g.beginPath();
    g.moveTo(spiderFootX[i], spiderFootY[i]);
    g.lineTo(spiderFootX[i] + 9, ay - 2);     // knee up
    g.lineTo(22, ay);                          // into body
    g.strokePath();
    // right leg (mirror)
    g.beginPath();
    g.moveTo(55 - spiderFootX[i], spiderFootY[i]);
    g.lineTo(55 - spiderFootX[i] - 9, ay - 2);
    g.lineTo(34, ay);
    g.strokePath();
  }
  // leg highlights (purple) over the knees
  g.lineStyle(1, 0x8833cc);
  for (let i = 0; i < 4; i++) {
    const ay = spiderLegY[i];
    g.beginPath(); g.moveTo(spiderFootX[i] + 9, ay - 2); g.lineTo(20, ay); g.strokePath();
    g.beginPath(); g.moveTo(55 - spiderFootX[i] - 9, ay - 2); g.lineTo(36, ay); g.strokePath();
  }
  // ── ABDOMEN: deep purple-black, bulbous ──
  g.fillStyle(0x2d0a3d); g.fillEllipse(28, 37, 34, 26);
  g.fillStyle(0x4a1560); g.fillEllipse(28, 32, 26, 14);        // top sheen
  g.fillStyle(0x8833cc); g.fillEllipse(27, 29, 14, 6);         // bright purple highlight
  g.fillStyle(0x1a0626); g.fillEllipse(28, 44, 24, 9);         // underside shadow
  // ── HOURGLASS MARKING (bright red/orange) on the abdomen ──
  g.fillStyle(0xff3300);
  g.fillTriangle(24, 33, 32, 33, 28, 38);    // upper triangle
  g.fillTriangle(24, 45, 32, 45, 28, 40);    // lower triangle
  g.fillStyle(0xff8822); g.fillRect(27, 37, 2, 4);            // hot center
  // ── CEPHALOTHORAX (head section) ──
  g.fillStyle(0x4a1560); g.fillEllipse(28, 17, 22, 16);
  g.fillStyle(0x8833cc); g.fillEllipse(28, 13, 16, 7);        // bright highlight
  g.fillStyle(0x2d0a3d); g.fillEllipse(28, 21, 16, 6);        // chin shade
  // ── 6 VIVID RED EYES with glow, two rows ──
  g.fillStyle(0xff1111, 0.4);                                  // glow halos
  g.fillRect(18, 10, 5, 5); g.fillRect(25, 9, 5, 5); g.fillRect(33, 10, 5, 5);
  g.fillRect(21, 16, 4, 4); g.fillRect(27, 16, 4, 4); g.fillRect(33, 16, 4, 4);
  g.fillStyle(0xff1111);                                       // eyes
  g.fillRect(19, 11, 3, 3); g.fillRect(26, 10, 3, 3); g.fillRect(34, 11, 3, 3); // top row
  g.fillRect(22, 17, 3, 3); g.fillRect(28, 17, 3, 3); g.fillRect(33, 17, 3, 3); // bottom row
  g.fillStyle(0xffbbbb);                                       // glints
  g.fillRect(19, 11, 1, 1); g.fillRect(26, 10, 1, 1); g.fillRect(34, 11, 1, 1);
  // ── FANGS / MANDIBLES + VENOM DRIP ──
  g.fillStyle(0x1a0626); g.fillRect(24, 22, 3, 5); g.fillRect(29, 22, 3, 5);
  g.fillStyle(0x553366); g.fillRect(24, 22, 1, 4); g.fillRect(29, 22, 1, 4);
  g.fillStyle(0xaaff00); g.fillRect(25, 26, 2, 4); g.fillRect(30, 26, 2, 3);  // venom drip
  g.fillStyle(0xccff66); g.fillRect(25, 29, 2, 1);                            // drip tip glow
  // outline
  g.lineStyle(1, 0x110022);
  g.strokeEllipse(28, 37, 34, 26);
  g.generateTexture('boss_spider', 56, 52);

  // Frost Troll (tundra) — hunched ice giant bristling with crystal spikes
  g.clear();
  // ── LEGS: thick, planted wide ──
  g.fillStyle(0x2a3a5a); g.fillRect(14, 48, 13, 12); g.fillRect(29, 48, 13, 12);
  g.fillStyle(0x3a4f78); g.fillRect(16, 48, 5, 10); g.fillRect(31, 48, 5, 10);   // leg highlight
  g.fillStyle(0x1c2840); g.fillRect(12, 56, 16, 4); g.fillRect(28, 56, 16, 4);   // big feet
  // ── LEFT ARM: long, reaching to the ground ──
  g.fillStyle(0x4a5f88); g.fillRect(1, 16, 9, 30);
  g.fillStyle(0x6680a8); g.fillRect(2, 18, 4, 22);                                // arm gleam
  g.fillStyle(0x33445f); g.fillRect(0, 42, 11, 8);                                // left fist
  // ── MASSIVE ICE-CHUNK CLUB on the right ──
  g.fillStyle(0x556688); g.fillRect(50, 40, 5, 16);                              // handle/forearm grip
  g.fillStyle(0xaaccee); g.fillRect(42, 16, 14, 24);                             // big ice chunk
  g.fillStyle(0xcceeff); g.fillRect(44, 18, 7, 14);                              // ice gleam
  g.fillStyle(0x88bbe0); g.fillTriangle(42, 16, 50, 10, 56, 18);                 // jagged top facet
  g.fillStyle(0x88bbe0); g.fillTriangle(42, 40, 49, 46, 56, 40);                 // jagged bottom facet
  g.fillStyle(0xffffff); g.fillRect(46, 20, 2, 6);                              // sharp highlight
  // right shoulder/arm gripping the club
  g.fillStyle(0x4a5f88); g.fillRect(44, 22, 8, 20);
  // ── TORSO: very wide, hunched, x=0..55 reach via shoulders ──
  g.fillStyle(0x4a5f88); g.fillRect(8, 18, 40, 32);            // wide body
  g.fillStyle(0x5a72a0); g.fillRect(6, 24, 44, 16);           // bulging hunched mass
  g.fillStyle(0x6680a8); g.fillRect(11, 20, 34, 9);          // upper highlight
  g.fillStyle(0x33445f); g.fillRect(8, 44, 40, 6);           // belly hunch shadow
  // ── ICE-CRYSTAL SPIKES from shoulders and back (sharp pale-blue triangles) ──
  g.fillStyle(0xaaddff);
  g.fillTriangle(2, 22, 8, 6, 13, 22);      // left shoulder big spike
  g.fillTriangle(43, 22, 49, 4, 54, 22);    // right shoulder big spike
  g.fillTriangle(14, 20, 18, 8, 22, 20);    // back spike
  g.fillTriangle(34, 20, 38, 10, 42, 20);   // back spike
  g.fillStyle(0xcceeff);                     // spike inner gleam
  g.fillTriangle(6, 20, 8, 9, 11, 20);
  g.fillTriangle(47, 20, 49, 7, 52, 20);
  // ── GLOWING PALE-BLUE RUNES on torso ──
  g.fillStyle(0x88eeff);
  g.fillRect(16, 30, 3, 3); g.fillRect(22, 34, 3, 3); g.fillRect(28, 31, 3, 3);
  g.fillRect(34, 35, 3, 3); g.fillRect(24, 40, 3, 3);
  g.fillStyle(0xccffff);                      // rune cores
  g.fillRect(17, 31, 1, 1); g.fillRect(29, 32, 1, 1); g.fillRect(35, 36, 1, 1);
  // ── HEAD: blocky, recessed dark eye sockets, glowing icy eyes ──
  g.fillStyle(0x5a72a0); g.fillEllipse(28, 11, 30, 18);
  g.fillStyle(0x4a5f88); g.fillEllipse(28, 15, 24, 9);        // jaw shade
  // horns / tusk-horns, swept
  g.fillStyle(0x6688aa); g.fillTriangle(10, 8, 14, 0, 18, 8);
  g.fillStyle(0x6688aa); g.fillTriangle(38, 8, 42, 0, 46, 8);
  g.fillStyle(0x3a4f78); g.fillRect(12, 6, 4, 3); g.fillRect(40, 6, 4, 3);       // horn base shade
  // recessed dark eye sockets
  g.fillStyle(0x16203a); g.fillRect(17, 7, 8, 6); g.fillRect(31, 7, 8, 6);
  // glowing icy eyes
  g.fillStyle(0x88eeff, 0.4); g.fillRect(18, 8, 6, 5); g.fillRect(32, 8, 6, 5);  // glow
  g.fillStyle(0xaaddff); g.fillRect(19, 9, 4, 3); g.fillRect(33, 9, 4, 3);       // eyes
  g.fillStyle(0xffffff); g.fillRect(20, 9, 1, 1); g.fillRect(34, 9, 1, 1);       // glint
  // mouth + tusks
  g.fillStyle(0x16203a); g.fillRect(22, 16, 12, 3);
  g.fillStyle(0xeeffff);
  g.fillTriangle(23, 16, 25, 16, 24, 21);   // tusks up
  g.fillTriangle(31, 16, 33, 16, 32, 21);
  // outline
  g.lineStyle(1, 0x223355);
  g.strokeRect(8, 18, 40, 32);
  g.generateTexture('boss_troll', 56, 60);

  // Bog Hydra (swamp) — three-headed serpent, coiled and bioluminescent
  g.clear();
  // ── COILED MAIN BODY: large, fills the lower canvas ──
  g.fillStyle(0x2a3a1c); g.fillEllipse(28, 48, 48, 22);        // big coil bulk
  g.fillStyle(0x3d5229); g.fillEllipse(28, 44, 40, 14);       // back highlight
  g.fillStyle(0x1a2610); g.fillEllipse(28, 55, 34, 8);        // belly shadow
  // a second coil loop for a serpentine, wrapped look
  g.fillStyle(0x33451f); g.fillEllipse(12, 50, 16, 14);
  g.fillStyle(0x33451f); g.fillEllipse(46, 50, 16, 14);
  g.fillStyle(0x223311); g.fillEllipse(12, 53, 12, 5); g.fillEllipse(46, 53, 12, 5);
  // ── SCALE-PATTERN TEXTURE on the body ──
  g.fillStyle(0x46602f);
  for (let sx = 12; sx <= 44; sx += 8) {
    for (let sy = 42; sy <= 54; sy += 6) {
      g.fillRect(sx + ((sy / 6) % 2 ? 0 : 4), sy, 3, 3);
    }
  }
  g.fillStyle(0x2a3a1c);                  // scale shading
  for (let sx = 14; sx <= 46; sx += 8) {
    g.fillRect(sx, 47, 2, 2);
  }
  // ── BACK SPINES along the coil ──
  g.fillStyle(0x1a2610);
  g.fillTriangle(12, 40, 16, 30, 20, 40);
  g.fillTriangle(22, 40, 27, 28, 32, 40);
  g.fillTriangle(34, 40, 38, 30, 42, 40);
  // ── THREE NECKS at very different heights ──
  g.fillStyle(0x33451f);
  g.fillRect(7, 24, 8, 24);     // left neck (mid)
  g.fillRect(24, 4, 8, 42);     // center neck (full height, reaching near top)
  g.fillRect(42, 30, 8, 18);    // right neck (low)
  g.fillStyle(0x46602f);        // neck highlights
  g.fillRect(9, 24, 3, 24); g.fillRect(26, 4, 3, 42); g.fillRect(44, 30, 3, 18);
  // ── BIOLUMINESCENT STRIPES on the necks/body ──
  g.fillStyle(0x44ff88);
  g.fillRect(11, 28, 2, 3); g.fillRect(11, 38, 2, 3);          // left neck
  g.fillRect(28, 12, 2, 3); g.fillRect(28, 24, 2, 3); g.fillRect(28, 36, 2, 3); // center neck
  g.fillRect(46, 34, 2, 3);                                    // right neck
  g.fillStyle(0x88ff44);                                       // body biolum spots
  g.fillRect(18, 46, 3, 3); g.fillRect(30, 48, 3, 3); g.fillRect(38, 45, 3, 3);
  g.fillRect(24, 52, 3, 3); g.fillRect(14, 50, 2, 2);
  // ── THREE HEADS ──
  g.fillStyle(0x4a6b33); g.fillEllipse(10, 18, 16, 11);       // left head
  g.fillStyle(0x4a6b33); g.fillEllipse(28, 6, 17, 12);        // center head (top)
  g.fillStyle(0x4a6b33); g.fillEllipse(46, 24, 15, 10);       // right head (low)
  g.fillStyle(0x33451f);                                       // jaw shadows
  g.fillEllipse(10, 21, 13, 4); g.fillEllipse(28, 10, 14, 4); g.fillEllipse(46, 27, 12, 4);
  // snout biolum stripe on each head
  g.fillStyle(0x44ff88);
  g.fillRect(4, 17, 4, 2); g.fillRect(22, 5, 4, 2); g.fillRect(40, 23, 4, 2);
  // ── GLOWING EYES on all three heads (bright yellow-green) ──
  g.fillStyle(0xccff22, 0.4);                                  // glow halos
  g.fillRect(10, 13, 6, 5); g.fillRect(28, 1, 6, 5); g.fillRect(46, 19, 6, 5);
  g.fillStyle(0xccff22);                                       // eyes
  g.fillRect(11, 14, 4, 3); g.fillRect(29, 2, 4, 3); g.fillRect(47, 20, 4, 3);
  g.fillStyle(0x223300);                                       // slit pupils
  g.fillRect(12, 15, 1, 2); g.fillRect(30, 3, 1, 2); g.fillRect(48, 21, 1, 2);
  // ── FANGS on all three mouths ──
  g.fillStyle(0x1a2610);                                       // dark maws
  g.fillRect(4, 21, 10, 2); g.fillRect(22, 9, 12, 2); g.fillRect(40, 27, 10, 2);
  g.fillStyle(0xeeffdd);
  g.fillTriangle(5, 21, 7, 21, 6, 25);  g.fillTriangle(11, 21, 13, 21, 12, 25);   // left
  g.fillTriangle(24, 9, 26, 9, 25, 14); g.fillTriangle(31, 9, 33, 9, 32, 14);     // center
  g.fillTriangle(41, 27, 43, 27, 42, 31); g.fillTriangle(47, 27, 49, 27, 48, 31); // right
  // outline
  g.lineStyle(1, 0x112200);
  g.strokeEllipse(28, 48, 48, 22);
  g.generateTexture('boss_hydra', 56, 60);

  // Boss shadow — dark translucent ellipse that tracks under every boss
  g.clear();
  g.fillStyle(0x000000, 0.45); g.fillEllipse(28, 8, 52, 14);
  g.fillStyle(0x000000, 0.25); g.fillEllipse(28, 8, 56, 16);
  g.generateTexture('boss_shadow', 56, 16);

  // Enemy sprites
  drawWolf(g); drawRat(g); drawBear(g); drawIceCrawler(g); drawSpiderRuins(g); drawBogLurker(g); drawDustHound(g); drawWaterLurker(g);

  buildAtlases(scene);
  g.destroy();
}

// ── TEXTURE ATLASES ───────────────────────────────────────────────────────────
// Composites individually-generated textures into two GPU atlases so Phaser's
// WebGL batcher can group all player sprites — and all raider sprites — into
// a single texture bind per atlas per frame. Cuts draw calls by ~60–80%.
// Individual textures remain in the TextureManager (are not removed); only
// the atlas-backed sprites benefit from batching.
function buildAtlases(scene) {
  if (scene.textures.exists('player_atlas')) return;

  // ── player_atlas: 5 characters × 15 frames = 75 frames, all 44×60 ──────────
  const PLAYER_COLS = 15;
  const PW = 44, PH = 60;
  const PLAYER_KEYS = [
    'knight','knight_step','knight_front','knight_front_step','knight_back','knight_back_step',
    'knight_fside','knight_fside_step','knight_bside','knight_bside_step',
    'knight_atk','knight_atk_front','knight_atk_back','knight_atk_fside','knight_atk_bside',
    'gunslinger','gunslinger_step','gunslinger_front','gunslinger_front_step','gunslinger_back','gunslinger_back_step',
    'gunslinger_fside','gunslinger_fside_step','gunslinger_bside','gunslinger_bside_step',
    'gunslinger_atk','gunslinger_atk_front','gunslinger_atk_back','gunslinger_atk_fside','gunslinger_atk_bside',
    'architect','architect_step','architect_front','architect_front_step','architect_back','architect_back_step',
    'architect_fside','architect_fside_step','architect_bside','architect_bside_step',
    'architect_atk','architect_atk_front','architect_atk_back','architect_atk_fside','architect_atk_bside',
    'charmer','charmer_step','charmer_front','charmer_front_step','charmer_back','charmer_back_step',
    'charmer_fside','charmer_fside_step','charmer_bside','charmer_bside_step',
    'charmer_atk','charmer_atk_front','charmer_atk_back','charmer_atk_fside','charmer_atk_bside',
    'ranger','ranger_step','ranger_front','ranger_front_step','ranger_back','ranger_back_step',
    'ranger_fside','ranger_fside_step','ranger_bside','ranger_bside_step',
    'ranger_atk','ranger_atk_front','ranger_atk_back','ranger_atk_fside','ranger_atk_bside',
  ];
  const pAtlasW = PLAYER_COLS * PW;                                    // 660
  const pAtlasH = Math.ceil(PLAYER_KEYS.length / PLAYER_COLS) * PH;   // 300
  const pRT = scene.add.renderTexture(0, 0, pAtlasW, pAtlasH);
  pRT.setVisible(false).setActive(false);
  const pFrames = {};
  PLAYER_KEYS.forEach((key, i) => {
    const col = i % PLAYER_COLS;
    const row = Math.floor(i / PLAYER_COLS);
    const x = col * PW, y = row * PH;
    pRT.drawFrame(key, undefined, x, y);
    pFrames[key] = { x, y, w: PW, h: PH };
  });
  const pTex = pRT.saveTexture('player_atlas');
  Object.entries(pFrames).forEach(([key, f]) => pTex.add(key, 0, f.x, f.y, f.w, f.h));

  // ── raider_atlas: 3 types × 10 frames = 30 frames, all 26×30 ────────────────
  const RAIDER_COLS = 10;
  const RW = 26, RH = 30;
  const RAIDER_KEYS = [
    'raider_brawler','raider_brawler_step','raider_brawler_front','raider_brawler_front_step',
    'raider_brawler_back','raider_brawler_back_step','raider_brawler_fside','raider_brawler_fside_step',
    'raider_brawler_bside','raider_brawler_bside_step',
    'raider_shooter','raider_shooter_step','raider_shooter_front','raider_shooter_front_step',
    'raider_shooter_back','raider_shooter_back_step','raider_shooter_fside','raider_shooter_fside_step',
    'raider_shooter_bside','raider_shooter_bside_step',
    'raider_heavy','raider_heavy_step','raider_heavy_front','raider_heavy_front_step',
    'raider_heavy_back','raider_heavy_back_step','raider_heavy_fside','raider_heavy_fside_step',
    'raider_heavy_bside','raider_heavy_bside_step',
  ];
  const rAtlasW = RAIDER_COLS * RW;                                    // 260
  const rAtlasH = Math.ceil(RAIDER_KEYS.length / RAIDER_COLS) * RH;   // 90
  const rRT = scene.add.renderTexture(0, 0, rAtlasW, rAtlasH);
  rRT.setVisible(false).setActive(false);
  const rFrames = {};
  RAIDER_KEYS.forEach((key, i) => {
    const col = i % RAIDER_COLS;
    const row = Math.floor(i / RAIDER_COLS);
    const x = col * RW, y = row * RH;
    rRT.drawFrame(key, undefined, x, y);
    rFrames[key] = { x, y, w: RW, h: RH };
  });
  const rTex = rRT.saveTexture('raider_atlas');
  Object.entries(rFrames).forEach(([key, f]) => rTex.add(key, 0, f.x, f.y, f.w, f.h));
}

function drawKnight(g) {
  g.clear();
  // boots
  g.fillStyle(0x1a2d3d); g.fillRect(5,52,11,8); g.fillRect(18,52,11,8);
  g.fillStyle(0x2d4a63); g.fillRect(18,52,4,6);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(5,34,11,20); g.fillRect(18,34,11,20);
  g.fillStyle(0x3a5a7a); g.fillRect(19,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(5,46,11,2); g.fillRect(18,46,11,2);
  // belt/tassets
  g.fillStyle(0x111111); g.fillRect(2,30,28,6);
  g.fillStyle(0x2d4a63); g.fillRect(4,31,10,4); g.fillRect(16,31,10,4);
  // torso/breastplate
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,28,20);
  g.fillStyle(0x3a5a7a); g.fillRect(6,14,18,16);
  g.fillStyle(0x5588aa); g.fillRect(6,14,18,4);
  // shield (left arm)
  g.fillStyle(0x2244aa); g.fillRect(0,12,6,24);
  g.fillStyle(0x4466cc); g.fillRect(1,13,3,20);
  g.fillStyle(0xccaa00); g.fillCircle(2,23,3);
  g.fillStyle(0xeecc22); g.fillCircle(2,23,1);
  // sword arm (right)
  g.fillStyle(0x4a6d8c); g.fillRect(28,12,8,22);
  g.fillStyle(0x3a5a7a); g.fillRect(28,12,4,20);
  // sword
  g.fillStyle(0xcc9900); g.fillRect(34,10,9,5);
  g.fillStyle(0x8b6914); g.fillRect(36,15,5,6);
  g.fillStyle(0xbbbbbb); g.fillRect(40,2,3,44);
  g.fillStyle(0xdddddd); g.fillRect(42,2,1,42);
  // gorget/neck
  g.fillStyle(0x4a6d8c); g.fillRect(14,10,16,4);
  // helmet
  g.fillStyle(0x4a6d8c); g.fillRect(8,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(8,4,24,8);
  g.fillStyle(0x080808); g.fillRect(10,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(12,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(8,0,4,13); g.fillRect(28,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(8,0,24,3);
  g.generateTexture('knight', 44, 60);
}

function drawGunslinger(g) {
  g.clear();
  // boots
  g.fillStyle(0x3d2010); g.fillRect(5,52,11,8); g.fillRect(18,52,11,8);
  g.fillStyle(0x5c3318); g.fillRect(18,52,4,6);
  // pants
  g.fillStyle(0x3a5a7a); g.fillRect(5,34,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x4a6a8a); g.fillRect(19,34,4,16);
  // holster
  g.fillStyle(0x3d2010); g.fillRect(18,42,10,8);
  g.fillStyle(0x222222); g.fillRect(20,44,6,6);
  // belt
  g.fillStyle(0x9a6622); g.fillRect(2,30,28,6);
  g.fillStyle(0xccaa44); g.fillRect(16,31,6,4);
  // coat body
  g.fillStyle(0xcc8833); g.fillRect(2,12,28,20);
  g.fillStyle(0xffeedd); g.fillRect(8,13,12,17);
  g.fillStyle(0x9a6622); g.fillRect(2,12,4,20); g.fillRect(26,12,4,20);
  // gun arm (right)
  g.fillStyle(0xcc8833); g.fillRect(28,12,8,22);
  g.fillStyle(0x9a6622); g.fillRect(28,12,4,20);
  g.fillStyle(0x333333); g.fillRect(34,11,10,4);
  g.fillStyle(0x555555); g.fillRect(35,9,7,6);
  g.fillStyle(0x222222); g.fillRect(36,15,6,4);
  // left arm
  g.fillStyle(0xcc8833); g.fillRect(0,12,4,22);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  // face
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  // hat brim
  g.fillStyle(0x7a4a1a); g.fillRect(2,3,34,3);
  // hat crown
  g.fillStyle(0x553311); g.fillRect(8,0,20,6);
  g.fillStyle(0x7a5533); g.fillRect(8,0,20,1);
  g.fillStyle(0x7a4a1a); g.fillRect(8,4,20,1);
  g.generateTexture('gunslinger', 44, 60);
}

function drawArchitect(g) {
  g.clear();
  // boots
  g.fillStyle(0x222222); g.fillRect(5,52,11,8); g.fillRect(18,52,11,8);
  g.fillStyle(0x444444); g.fillRect(18,52,4,6);
  // pants
  g.fillStyle(0x334477); g.fillRect(5,34,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x445588); g.fillRect(19,34,4,16);
  // tool belt
  g.fillStyle(0x8b6914); g.fillRect(2,30,28,6);
  g.fillStyle(0xaaaaaa); g.fillRect(4,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(8,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(12,29,3,5);
  // vest body
  g.fillStyle(0x3a9a55); g.fillRect(2,12,28,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,12,16);
  g.fillStyle(0xffcc00); g.fillRect(2,12,4,4); g.fillRect(26,12,4,4);
  // left arm
  g.fillStyle(0x3a9a55); g.fillRect(0,12,4,22);
  // right arm + wrench
  g.fillStyle(0x3a9a55); g.fillRect(28,12,8,22);
  g.fillStyle(0x777777); g.fillRect(33,5,6,4);
  g.fillStyle(0x999999); g.fillRect(34,9,4,16);
  g.fillStyle(0xbbbbbb); g.fillRect(34,9,2,14);
  g.fillStyle(0x555555); g.fillRect(33,4,6,2);
  g.fillStyle(0x555555); g.fillRect(33,8,2,2); g.fillRect(37,8,2,2);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  // face
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  // hard hat
  g.fillStyle(0x222222); g.fillRect(6,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(6,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(6,0,26,2);
  g.fillStyle(0x666600); g.fillRect(6,4,26,2);
  g.generateTexture('architect', 44, 60);
}

// ── DIRECTIONAL / WALK-CYCLE SPRITES ─────────────────────────

// ── KNIGHT variants ──────────────────────────────────────────
function drawKnightStep(g) {
  g.clear();
  // boots - left raised, right planted
  g.fillStyle(0x1a2d3d); g.fillRect(5,49,11,10); g.fillRect(18,52,11,8);
  g.fillStyle(0x2d4a63); g.fillRect(18,52,4,6);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(5,32,11,18); g.fillRect(18,34,11,20);
  g.fillStyle(0x3a5a7a); g.fillRect(19,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(5,44,11,2); g.fillRect(18,46,11,2);
  // belt/tassets
  g.fillStyle(0x111111); g.fillRect(2,30,28,6);
  g.fillStyle(0x2d4a63); g.fillRect(4,31,10,4); g.fillRect(16,31,10,4);
  // torso
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,28,20);
  g.fillStyle(0x3a5a7a); g.fillRect(6,14,18,16);
  g.fillStyle(0x5588aa); g.fillRect(6,14,18,4);
  // shield (raised slightly in stride)
  g.fillStyle(0x2244aa); g.fillRect(0,10,6,26);
  g.fillStyle(0x4466cc); g.fillRect(1,11,3,22);
  g.fillStyle(0xccaa00); g.fillCircle(2,22,3);
  g.fillStyle(0xeecc22); g.fillCircle(2,22,1);
  // sword arm (forward)
  g.fillStyle(0x4a6d8c); g.fillRect(28,10,8,24);
  g.fillStyle(0x3a5a7a); g.fillRect(28,10,4,22);
  g.fillStyle(0xcc9900); g.fillRect(34,8,9,5);
  g.fillStyle(0x8b6914); g.fillRect(36,13,5,6);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,3,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // gorget/neck
  g.fillStyle(0x4a6d8c); g.fillRect(14,10,16,4);
  // helmet
  g.fillStyle(0x4a6d8c); g.fillRect(8,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(8,4,24,8);
  g.fillStyle(0x080808); g.fillRect(10,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(12,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(8,0,4,13); g.fillRect(28,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(8,0,24,3);
  g.generateTexture('knight_step', 44, 60);
}

function drawKnightFront(g) {
  g.clear();
  // boots
  g.fillStyle(0x1a2d3d); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(7,34,12,20); g.fillRect(23,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(9,34,4,18); g.fillRect(25,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(7,46,12,2); g.fillRect(23,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  g.fillStyle(0x2d4a63); g.fillRect(6,31,10,4); g.fillRect(20,31,10,4);
  g.fillStyle(0xccaa00); g.fillRect(19,30,5,4);
  // torso/breastplate
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x3a5a7a); g.fillRect(10,14,24,16);
  g.fillStyle(0x5588aa); g.fillRect(10,14,24,4);
  g.fillStyle(0xccaa00); g.fillCircle(22,22,3);
  // left arm/shield
  g.fillStyle(0x4a6d8c); g.fillRect(0,12,6,22);
  g.fillStyle(0x2244aa); g.fillRect(0,12,4,24);
  g.fillStyle(0x4466cc); g.fillRect(1,13,2,20);
  g.fillStyle(0xccaa00); g.fillCircle(1,23,2);
  // right arm/sword
  g.fillStyle(0x4a6d8c); g.fillRect(36,12,8,22);
  g.fillStyle(0xcc9900); g.fillRect(36,10,10,5);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,4,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  // helmet
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,4,24,8);
  g.fillStyle(0x080808); g.fillRect(12,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(14,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_front', 44, 60);
}

function drawKnightFrontStep(g) {
  g.clear();
  // boots - left raised, right planted
  g.fillStyle(0x1a2d3d); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(7,32,12,18); g.fillRect(23,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(9,32,4,16); g.fillRect(25,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(7,44,12,2); g.fillRect(23,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  g.fillStyle(0x2d4a63); g.fillRect(6,31,10,4); g.fillRect(20,31,10,4);
  g.fillStyle(0xccaa00); g.fillRect(19,30,5,4);
  // torso
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x3a5a7a); g.fillRect(10,14,24,16);
  g.fillStyle(0x5588aa); g.fillRect(10,14,24,4);
  g.fillStyle(0xccaa00); g.fillCircle(22,22,3);
  // left arm/shield (back in stride)
  g.fillStyle(0x4a6d8c); g.fillRect(0,12,6,22);
  g.fillStyle(0x2244aa); g.fillRect(0,14,4,22);
  g.fillStyle(0x4466cc); g.fillRect(1,15,2,18);
  g.fillStyle(0xccaa00); g.fillCircle(1,24,2);
  // right arm/sword (forward)
  g.fillStyle(0x4a6d8c); g.fillRect(36,12,8,22);
  g.fillStyle(0xcc9900); g.fillRect(36,8,10,5);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,4,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  // helmet
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,4,24,8);
  g.fillStyle(0x080808); g.fillRect(12,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(14,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_front_step', 44, 60);
}

function drawKnightBack(g) {
  g.clear();
  // boots
  g.fillStyle(0x1a2d3d); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(7,34,12,20); g.fillRect(23,34,12,20);
  g.fillStyle(0x1a2d3d); g.fillRect(7,46,12,2); g.fillRect(23,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  // back plate torso
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,24,16);
  g.fillStyle(0x1a2d3d); g.fillRect(20,14,4,16);
  // arms (both pauldrons visible)
  g.fillStyle(0x4a6d8c); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  // shield strap on left back
  g.fillStyle(0x2244aa); g.fillRect(0,14,4,22);
  g.fillStyle(0xccaa00); g.fillRect(1,20,2,4);
  // sword from behind
  g.fillStyle(0xcc9900); g.fillRect(36,10,10,5);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,4,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // neck (back)
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  // helmet back
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(20,0,4,12);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_back', 44, 60);
}

function drawKnightBackStep(g) {
  g.clear();
  // boots - left raised, right planted
  g.fillStyle(0x1a2d3d); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  // greaves
  g.fillStyle(0x2d4a63); g.fillRect(7,32,12,18); g.fillRect(23,34,12,20);
  g.fillStyle(0x1a2d3d); g.fillRect(7,44,12,2); g.fillRect(23,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  // torso back
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,24,16);
  g.fillStyle(0x1a2d3d); g.fillRect(20,14,4,16);
  // arms
  g.fillStyle(0x4a6d8c); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x2244aa); g.fillRect(0,12,4,24);
  g.fillStyle(0xccaa00); g.fillRect(1,18,2,4);
  g.fillStyle(0xcc9900); g.fillRect(36,8,10,5);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,4,44);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,42);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  // helmet back
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(20,0,4,12);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_back_step', 44, 60);
}

// ── GUNSLINGER variants ───────────────────────────────────────
function drawGunslingerStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(5,49,11,10); g.fillRect(18,52,11,8);
  g.fillStyle(0x5c3318); g.fillRect(18,52,4,6);
  g.fillStyle(0x3a5a7a); g.fillRect(5,32,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x4a6a8a); g.fillRect(19,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(18,42,10,8);
  g.fillStyle(0x222222); g.fillRect(20,44,6,6);
  g.fillStyle(0x9a6622); g.fillRect(2,30,28,6);
  g.fillStyle(0xccaa44); g.fillRect(16,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(2,12,28,20);
  g.fillStyle(0xffeedd); g.fillRect(8,13,12,17);
  g.fillStyle(0x9a6622); g.fillRect(2,12,4,20); g.fillRect(26,12,4,20);
  g.fillStyle(0xcc8833); g.fillRect(28,10,8,24);
  g.fillStyle(0x9a6622); g.fillRect(28,10,4,22);
  g.fillStyle(0x333333); g.fillRect(34,9,10,4);
  g.fillStyle(0x555555); g.fillRect(35,7,7,6);
  g.fillStyle(0x222222); g.fillRect(36,13,6,4);
  g.fillStyle(0xcc8833); g.fillRect(0,14,4,20);
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  g.fillStyle(0x7a4a1a); g.fillRect(2,3,34,3);
  g.fillStyle(0x553311); g.fillRect(8,0,20,6);
  g.fillStyle(0x7a5533); g.fillRect(8,0,20,1);
  g.fillStyle(0x7a4a1a); g.fillRect(8,4,20,1);
  g.generateTexture('gunslinger_step', 44, 60);
}

function drawGunslingerFront(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(9,34,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(27,40,10,10);
  g.fillStyle(0x222222); g.fillRect(29,42,7,7);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  g.fillStyle(0xccaa44); g.fillRect(19,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  g.fillStyle(0x9a6622); g.fillRect(4,12,6,20); g.fillRect(34,12,6,20);
  g.fillStyle(0xcc8833); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  g.fillStyle(0x333333); g.fillRect(36,15,10,4);
  g.fillStyle(0x555555); g.fillRect(38,12,8,6);
  g.fillStyle(0x222222); g.fillRect(40,19,6,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,24,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_front', 44, 60);
}

function drawGunslingerFrontStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,32,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(9,32,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(27,40,10,10);
  g.fillStyle(0x222222); g.fillRect(29,42,7,7);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  g.fillStyle(0xccaa44); g.fillRect(19,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  g.fillStyle(0x9a6622); g.fillRect(4,12,6,20); g.fillRect(34,12,6,20);
  g.fillStyle(0xcc8833); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x333333); g.fillRect(36,13,10,4);
  g.fillStyle(0x555555); g.fillRect(38,10,8,6);
  g.fillStyle(0x222222); g.fillRect(40,17,6,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,24,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_front_step', 44, 60);
}

function drawGunslingerBack(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  // coat back
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,24,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,8,17);
  g.fillStyle(0xcc8833); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  g.fillStyle(0x333333); g.fillRect(36,16,10,4);
  g.fillStyle(0x555555); g.fillRect(38,14,8,5);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,16,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_back', 44, 60);
}

function drawGunslingerBackStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,32,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,24,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,8,17);
  g.fillStyle(0xcc8833); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x333333); g.fillRect(36,14,10,4);
  g.fillStyle(0x555555); g.fillRect(38,12,8,5);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,16,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_back_step', 44, 60);
}

// ── ARCHITECT variants ────────────────────────────────────────
function drawArchitectStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(5,49,11,10); g.fillRect(18,52,11,8);
  g.fillStyle(0x444444); g.fillRect(18,52,4,6);
  g.fillStyle(0x334477); g.fillRect(5,32,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x445588); g.fillRect(19,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(2,30,28,6);
  g.fillStyle(0xaaaaaa); g.fillRect(4,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(8,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(12,29,3,5);
  g.fillStyle(0x3a9a55); g.fillRect(2,12,28,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,12,16);
  g.fillStyle(0xffcc00); g.fillRect(2,12,4,4); g.fillRect(26,12,4,4);
  g.fillStyle(0x3a9a55); g.fillRect(0,14,4,20);
  g.fillStyle(0x3a9a55); g.fillRect(28,10,8,24);
  g.fillStyle(0x777777); g.fillRect(33,3,6,4);
  g.fillStyle(0x999999); g.fillRect(34,7,4,16);
  g.fillStyle(0xbbbbbb); g.fillRect(34,7,2,14);
  g.fillStyle(0x555555); g.fillRect(33,2,6,2);
  g.fillStyle(0x555555); g.fillRect(33,6,2,2); g.fillRect(37,6,2,2);
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  g.fillStyle(0x222222); g.fillRect(6,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(6,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(6,0,26,2);
  g.fillStyle(0x666600); g.fillRect(6,4,26,2);
  g.generateTexture('architect_step', 44, 60);
}

function drawArchitectFront(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x445588); g.fillRect(9,34,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(20,29,3,5);
  // vest front
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(16,13,12,17);
  g.fillStyle(0xffcc00); g.fillRect(3,11,8,4); g.fillRect(33,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(5,19,5,2); g.fillRect(34,19,5,2);
  // arms
  g.fillStyle(0x3a9a55); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  // wrench on right arm
  g.fillStyle(0x777777); g.fillRect(36,8,7,5);
  g.fillStyle(0x999999); g.fillRect(38,13,4,14);
  g.fillStyle(0xbbbbbb); g.fillRect(38,13,2,12);
  g.fillStyle(0x555555); g.fillRect(36,7,7,2);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xeeee44); g.fillRect(8,0,28,2);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_front', 44, 60);
}

function drawArchitectFrontStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,32,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x445588); g.fillRect(9,32,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(20,29,3,5);
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(16,13,12,17);
  g.fillStyle(0xffcc00); g.fillRect(3,11,8,4); g.fillRect(33,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(5,19,5,2); g.fillRect(34,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x777777); g.fillRect(36,6,7,5);
  g.fillStyle(0x999999); g.fillRect(38,11,4,14);
  g.fillStyle(0xbbbbbb); g.fillRect(38,11,2,12);
  g.fillStyle(0x555555); g.fillRect(36,5,7,2);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xeeee44); g.fillRect(8,0,28,2);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_front_step', 44, 60);
}

function drawArchitectBack(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  // vest back
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(10,13,24,17);
  g.fillStyle(0xffcc00); g.fillRect(4,11,8,4); g.fillRect(32,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(6,19,5,2); g.fillRect(33,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(0,12,6,22); g.fillRect(36,12,8,22);
  // wrench visible from behind
  g.fillStyle(0x999999); g.fillRect(38,10,4,14);
  g.fillStyle(0x777777); g.fillRect(36,8,7,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xaa9900); g.fillRect(10,1,24,4);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_back', 44, 60);
}

function drawArchitectBackStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,49,12,10); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,32,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(10,13,24,17);
  g.fillStyle(0xffcc00); g.fillRect(4,11,8,4); g.fillRect(32,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(6,19,5,2); g.fillRect(33,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(0,14,6,20); g.fillRect(36,12,8,22);
  g.fillStyle(0x999999); g.fillRect(38,8,4,14);
  g.fillStyle(0x777777); g.fillRect(36,6,7,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xaa9900); g.fillRect(10,1,24,4);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_back_step', 44, 60);
}

// ── 8-DIRECTIONAL DIAGONAL SPRITES ───────────────────────────
// fside = front-diagonal (3/4 view toward camera, moving sideways)
// bside = back-diagonal  (3/4 view away from camera, moving sideways)

function drawKnightFSide(g) {
  g.clear();
  // legs - near (right) lower, far (left) slightly higher = depth/stride
  g.fillStyle(0x1a2d3d); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,34,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,45,10,2); g.fillRect(22,46,12,2);
  // belt
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  g.fillStyle(0x2d4a63); g.fillRect(8,31,8,4); g.fillRect(20,31,10,4);
  // torso - near/right side lighter, far/left darker = 3/4 angle
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(6,14,8,16);
  g.fillStyle(0x3a5a7a); g.fillRect(14,14,20,16);
  g.fillStyle(0x5588aa); g.fillRect(18,14,16,4);
  // far arm/shield (compressed)
  g.fillStyle(0x2244aa); g.fillRect(2,12,6,24);
  g.fillStyle(0x4466cc); g.fillRect(3,13,3,20);
  g.fillStyle(0xccaa00); g.fillCircle(4,23,2);
  // near arm + sword (prominent)
  g.fillStyle(0x4a6d8c); g.fillRect(34,12,8,22);
  g.fillStyle(0x3a5a7a); g.fillRect(34,12,4,20);
  g.fillStyle(0xcc9900); g.fillRect(38,10,8,5);
  g.fillStyle(0x8b6914); g.fillRect(40,15,4,6);
  g.fillStyle(0xbbbbbb); g.fillRect(41,2,3,44);
  g.fillStyle(0xdddddd); g.fillRect(43,2,1,42);
  // gorget
  g.fillStyle(0x4a6d8c); g.fillRect(16,10,14,4);
  // helmet - face turned toward near side
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,4,24,8);
  g.fillStyle(0x080808); g.fillRect(11,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(16,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_fside', 44, 60);
}
function drawKnightFSideStep(g) {
  g.clear();
  // legs - near planted, far raised (striding)
  g.fillStyle(0x1a2d3d); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,32,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,43,10,2); g.fillRect(22,46,12,2);
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  g.fillStyle(0x2d4a63); g.fillRect(8,31,8,4); g.fillRect(20,31,10,4);
  // torso
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(6,14,8,16);
  g.fillStyle(0x3a5a7a); g.fillRect(14,14,20,16);
  g.fillStyle(0x5588aa); g.fillRect(18,14,16,4);
  // far arm/shield (back)
  g.fillStyle(0x2244aa); g.fillRect(2,14,6,22);
  g.fillStyle(0x4466cc); g.fillRect(3,15,3,18);
  g.fillStyle(0xccaa00); g.fillCircle(4,24,2);
  // near arm + sword (forward)
  g.fillStyle(0x4a6d8c); g.fillRect(34,10,8,24);
  g.fillStyle(0x3a5a7a); g.fillRect(34,10,4,22);
  g.fillStyle(0xcc9900); g.fillRect(38,8,8,5);
  g.fillStyle(0x8b6914); g.fillRect(40,13,4,6);
  g.fillStyle(0xbbbbbb); g.fillRect(41,0,3,44);
  g.fillStyle(0xdddddd); g.fillRect(43,0,1,42);
  g.fillStyle(0x4a6d8c); g.fillRect(16,10,14,4);
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,4,24,8);
  g.fillStyle(0x080808); g.fillRect(11,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(16,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_fside_step', 44, 60);
}
function drawKnightBSide(g) {
  g.clear();
  // legs - same stride offset
  g.fillStyle(0x1a2d3d); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,34,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,44,10,2); g.fillRect(22,46,12,2);
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  // torso back - darker, back plate prominent
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,22,16);
  g.fillStyle(0x1a2d3d); g.fillRect(18,14,6,16);
  // far arm (left, back shoulder visible)
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,8,22);
  g.fillStyle(0x2d4a63); g.fillRect(2,14,6,18);
  g.fillStyle(0x2244aa); g.fillRect(2,14,4,22);
  g.fillStyle(0xccaa00); g.fillRect(3,20,2,4);
  // near arm + sword from behind
  g.fillStyle(0x4a6d8c); g.fillRect(34,12,8,22);
  g.fillStyle(0xcc9900); g.fillRect(38,10,8,5);
  g.fillStyle(0xbbbbbb); g.fillRect(41,2,3,44);
  g.fillStyle(0xdddddd); g.fillRect(43,2,1,42);
  // neck (tiny skin patch, back view)
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  // helmet back
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(19,0,6,12);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_bside', 44, 60);
}
function drawKnightBSideStep(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,32,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,43,10,2); g.fillRect(22,46,12,2);
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,22,16);
  g.fillStyle(0x1a2d3d); g.fillRect(18,14,6,16);
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,8,22);
  g.fillStyle(0x2244aa); g.fillRect(2,12,4,24);
  g.fillStyle(0xccaa00); g.fillRect(3,18,2,4);
  g.fillStyle(0x4a6d8c); g.fillRect(34,10,8,24);
  g.fillStyle(0xcc9900); g.fillRect(38,8,8,5);
  g.fillStyle(0xbbbbbb); g.fillRect(41,0,3,44);
  g.fillStyle(0xdddddd); g.fillRect(43,0,1,42);
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(19,0,6,12);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_bside_step', 44, 60);
}

function drawGunslingerFSide(g) {
  g.clear();
  // legs - near lower, far higher (3/4 stride)
  g.fillStyle(0x3d2010); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(24,34,4,16);
  // holster on near side
  g.fillStyle(0x3d2010); g.fillRect(24,40,8,8);
  g.fillStyle(0x222222); g.fillRect(26,42,5,5);
  // belt
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  g.fillStyle(0xccaa44); g.fillRect(20,31,6,4);
  // coat - near/right side vest visible, far/left coat trim
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0x9a6622); g.fillRect(6,12,4,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  // far arm (compressed)
  g.fillStyle(0xcc8833); g.fillRect(2,12,6,22);
  g.fillStyle(0x9a6622); g.fillRect(2,14,4,18);
  // near arm + gun (prominent)
  g.fillStyle(0xcc8833); g.fillRect(34,12,8,22);
  g.fillStyle(0x333333); g.fillRect(38,11,8,4);
  g.fillStyle(0x555555); g.fillRect(39,9,7,6);
  g.fillStyle(0x222222); g.fillRect(40,15,6,3);
  // neck + face (shifted right)
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  // hat brim slightly angled
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,22,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_fside', 44, 60);
}
function drawGunslingerFSideStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,32,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(24,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(24,40,8,8);
  g.fillStyle(0x222222); g.fillRect(26,42,5,5);
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  g.fillStyle(0xccaa44); g.fillRect(20,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0x9a6622); g.fillRect(6,12,4,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  g.fillStyle(0xcc8833); g.fillRect(2,14,6,20);
  g.fillStyle(0x9a6622); g.fillRect(2,16,4,16);
  g.fillStyle(0xcc8833); g.fillRect(34,10,8,24);
  g.fillStyle(0x333333); g.fillRect(38,9,8,4);
  g.fillStyle(0x555555); g.fillRect(39,7,7,6);
  g.fillStyle(0x222222); g.fillRect(40,13,6,3);
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,22,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_fside_step', 44, 60);
}
function drawGunslingerBSide(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  // coat back - angled
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,22,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,6,17);
  // far arm (compressed, back shoulder)
  g.fillStyle(0xcc8833); g.fillRect(2,12,8,22);
  g.fillStyle(0x9a6622); g.fillRect(2,14,6,18);
  // near arm + gun from behind
  g.fillStyle(0xcc8833); g.fillRect(34,12,8,22);
  g.fillStyle(0x333333); g.fillRect(38,13,8,4);
  g.fillStyle(0x555555); g.fillRect(39,11,7,5);
  // neck back
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  // hat back
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,14,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_bside', 44, 60);
}
function drawGunslingerBSideStep(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,32,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,22,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,6,17);
  g.fillStyle(0xcc8833); g.fillRect(2,14,8,20);
  g.fillStyle(0x9a6622); g.fillRect(2,16,6,16);
  g.fillStyle(0xcc8833); g.fillRect(34,10,8,24);
  g.fillStyle(0x333333); g.fillRect(38,11,8,4);
  g.fillStyle(0x555555); g.fillRect(39,9,7,5);
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,14,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_bside_step', 44, 60);
}

function drawArchitectFSide(g) {
  g.clear();
  // legs - near lower, far higher
  g.fillStyle(0x222222); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x445588); g.fillRect(24,34,4,16);
  // tool belt
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  // vest - near side brighter
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(8,14,10,16);
  g.fillStyle(0x4dbb66); g.fillRect(18,14,16,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(22,19,5,2);
  // far arm (compressed)
  g.fillStyle(0x3a9a55); g.fillRect(2,12,6,22);
  g.fillStyle(0x1a5533); g.fillRect(2,14,4,18);
  // near arm + wrench (prominent)
  g.fillStyle(0x3a9a55); g.fillRect(34,12,8,22);
  g.fillStyle(0x777777); g.fillRect(38,5,6,5);
  g.fillStyle(0x999999); g.fillRect(39,10,4,16);
  g.fillStyle(0xbbbbbb); g.fillRect(39,10,2,14);
  g.fillStyle(0x555555); g.fillRect(38,4,6,2);
  // neck + face shifted right
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  // hard hat
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(7,0,26,2);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_fside', 44, 60);
}
function drawArchitectFSideStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,32,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x445588); g.fillRect(24,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(8,14,10,16);
  g.fillStyle(0x4dbb66); g.fillRect(18,14,16,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(22,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(2,14,6,20);
  g.fillStyle(0x1a5533); g.fillRect(2,16,4,16);
  g.fillStyle(0x3a9a55); g.fillRect(34,10,8,24);
  g.fillStyle(0x777777); g.fillRect(38,3,6,5);
  g.fillStyle(0x999999); g.fillRect(39,8,4,16);
  g.fillStyle(0xbbbbbb); g.fillRect(39,8,2,14);
  g.fillStyle(0x555555); g.fillRect(38,2,6,2);
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(7,0,26,2);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_fside_step', 44, 60);
}
function drawArchitectBSide(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  // vest back - angled, back panel visible
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,22,16);
  g.fillStyle(0x2a7a45); g.fillRect(18,14,6,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(8,20,5,2); g.fillRect(23,20,5,2);
  // far arm (compressed)
  g.fillStyle(0x3a9a55); g.fillRect(2,12,8,22);
  g.fillStyle(0x1a5533); g.fillRect(2,14,6,18);
  // near arm (prominent shoulder) + wrench from behind
  g.fillStyle(0x3a9a55); g.fillRect(34,12,8,22);
  g.fillStyle(0x999999); g.fillRect(39,6,4,16);
  g.fillStyle(0x777777); g.fillRect(37,5,7,4);
  // neck back
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  // hard hat back
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xaa9900); g.fillRect(9,1,22,4);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_bside', 44, 60);
}
function drawArchitectBSideStep(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(9,47,10,12); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,32,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,22,16);
  g.fillStyle(0x2a7a45); g.fillRect(18,14,6,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(8,20,5,2); g.fillRect(23,20,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(2,14,8,20);
  g.fillStyle(0x1a5533); g.fillRect(2,16,6,16);
  g.fillStyle(0x3a9a55); g.fillRect(34,10,8,24);
  g.fillStyle(0x999999); g.fillRect(39,4,4,16);
  g.fillStyle(0x777777); g.fillRect(37,3,7,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xaa9900); g.fillRect(9,1,22,4);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_bside_step', 44, 60);
}

// ── ENEMY RAIDER DIRECTIONAL SPRITES ─────────────────────────
// All 9 directional walk-frame variants for each of the 3 raider types.
// Called once from buildTextures(); generates 27 textures on the same 26×30 canvas.
function drawRaiderDirectionals(g) {

  // ── BRAWLER variants (dark red, stocky melee tank) ───────────
  g.clear();
  g.fillStyle(0x993322); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x773311); g.fillRect(4, 14, 4, 8); g.fillRect(18, 14, 4, 8);
  g.fillStyle(0xcc8855); g.fillEllipse(13, 7, 12, 10);
  g.fillStyle(0x551111); g.fillRect(6, 2, 14, 5);
  g.fillStyle(0x664422); g.fillRect(5, 23, 5, 7); g.fillRect(16, 25, 5, 5);
  g.generateTexture('raider_brawler_step', 26, 30);

  g.clear();
  g.fillStyle(0x993322); g.fillRect(5, 8, 16, 16);
  g.fillStyle(0x773311); g.fillRect(2, 13, 4, 9); g.fillRect(20, 13, 4, 9);
  g.fillStyle(0x884433); g.fillRect(8, 14, 10, 6);
  g.fillStyle(0xcc8855); g.fillEllipse(13, 7, 12, 10);
  g.fillStyle(0xaa6644); g.fillRect(10, 5, 3, 3); g.fillRect(13, 4, 3, 3);
  g.fillStyle(0x551111); g.fillRect(5, 2, 16, 5);
  g.fillStyle(0x664422); g.fillRect(7, 24, 5, 6); g.fillRect(14, 24, 5, 6);
  g.generateTexture('raider_brawler_front', 26, 30);

  g.clear();
  g.fillStyle(0x993322); g.fillRect(5, 8, 16, 16);
  g.fillStyle(0x773311); g.fillRect(2, 13, 4, 9); g.fillRect(20, 13, 4, 9);
  g.fillStyle(0x884433); g.fillRect(8, 14, 10, 6);
  g.fillStyle(0xcc8855); g.fillEllipse(13, 7, 12, 10);
  g.fillStyle(0xaa6644); g.fillRect(10, 5, 3, 3); g.fillRect(13, 4, 3, 3);
  g.fillStyle(0x551111); g.fillRect(5, 2, 16, 5);
  g.fillStyle(0x664422); g.fillRect(6, 23, 5, 6); g.fillRect(15, 25, 5, 5);
  g.generateTexture('raider_brawler_front_step', 26, 30);

  g.clear();
  g.fillStyle(0x882211); g.fillRect(5, 8, 16, 16);
  g.fillStyle(0x663300); g.fillRect(2, 13, 4, 9); g.fillRect(20, 13, 4, 9);
  g.fillStyle(0x773322); g.fillRect(8, 10, 10, 10);
  g.fillStyle(0x551111); g.fillRect(5, 8, 16, 4);
  g.fillStyle(0x664411); g.fillEllipse(13, 5, 12, 8);
  g.fillStyle(0x664422); g.fillRect(7, 24, 5, 6); g.fillRect(14, 24, 5, 6);
  g.generateTexture('raider_brawler_back', 26, 30);

  g.clear();
  g.fillStyle(0x882211); g.fillRect(5, 8, 16, 16);
  g.fillStyle(0x663300); g.fillRect(2, 13, 4, 9); g.fillRect(20, 13, 4, 9);
  g.fillStyle(0x773322); g.fillRect(8, 10, 10, 10);
  g.fillStyle(0x551111); g.fillRect(5, 8, 16, 4);
  g.fillStyle(0x664411); g.fillEllipse(13, 5, 12, 8);
  g.fillStyle(0x664422); g.fillRect(6, 23, 5, 6); g.fillRect(15, 25, 5, 5);
  g.generateTexture('raider_brawler_back_step', 26, 30);

  g.clear();
  g.fillStyle(0x993322); g.fillRect(5, 8, 15, 16);
  g.fillStyle(0x773311); g.fillRect(3, 14, 3, 8); g.fillRect(19, 13, 4, 9);
  g.fillStyle(0x884433); g.fillRect(7, 13, 8, 6);
  g.fillStyle(0xcc8855); g.fillEllipse(12, 7, 11, 10);
  g.fillStyle(0x551111); g.fillRect(5, 2, 14, 5);
  g.fillStyle(0x664422); g.fillRect(6, 24, 5, 6); g.fillRect(14, 24, 5, 6);
  g.generateTexture('raider_brawler_fside', 26, 30);

  g.clear();
  g.fillStyle(0x993322); g.fillRect(5, 8, 15, 16);
  g.fillStyle(0x773311); g.fillRect(3, 14, 3, 8); g.fillRect(19, 13, 4, 9);
  g.fillStyle(0x884433); g.fillRect(7, 13, 8, 6);
  g.fillStyle(0xcc8855); g.fillEllipse(12, 7, 11, 10);
  g.fillStyle(0x551111); g.fillRect(5, 2, 14, 5);
  g.fillStyle(0x664422); g.fillRect(5, 23, 5, 6); g.fillRect(15, 25, 5, 5);
  g.generateTexture('raider_brawler_fside_step', 26, 30);

  g.clear();
  g.fillStyle(0x882211); g.fillRect(5, 8, 15, 16);
  g.fillStyle(0x663300); g.fillRect(3, 13, 3, 9); g.fillRect(19, 13, 4, 9);
  g.fillStyle(0x773322); g.fillRect(7, 10, 8, 10);
  g.fillStyle(0x664411); g.fillEllipse(12, 5, 11, 8);
  g.fillStyle(0x664422); g.fillRect(6, 24, 5, 6); g.fillRect(14, 24, 5, 6);
  g.generateTexture('raider_brawler_bside', 26, 30);

  g.clear();
  g.fillStyle(0x882211); g.fillRect(5, 8, 15, 16);
  g.fillStyle(0x663300); g.fillRect(3, 13, 3, 9); g.fillRect(19, 13, 4, 9);
  g.fillStyle(0x773322); g.fillRect(7, 10, 8, 10);
  g.fillStyle(0x664411); g.fillEllipse(12, 5, 11, 8);
  g.fillStyle(0x664422); g.fillRect(5, 23, 5, 6); g.fillRect(15, 25, 5, 5);
  g.generateTexture('raider_brawler_bside_step', 26, 30);

  // ── SHOOTER variants (brown coat, slim, gun arm) ─────────────
  g.clear();
  g.fillStyle(0x775533); g.fillRect(7, 8, 12, 16);
  g.fillStyle(0x664422); g.fillRect(5, 14, 4, 7);
  g.fillStyle(0x664422); g.fillRect(17, 13, 6, 4); g.fillStyle(0x444433); g.fillRect(21, 14, 6, 2);
  g.fillStyle(0xcc9966); g.fillEllipse(13, 7, 10, 10);
  g.fillStyle(0x553322); g.fillRect(6, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_step', 26, 30);

  g.clear();
  g.fillStyle(0x775533); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x664422); g.fillRect(3, 13, 4, 8); g.fillRect(19, 13, 4, 8);
  g.fillStyle(0x444433); g.fillRect(20, 14, 6, 2);
  g.fillStyle(0x555544); g.fillRect(20, 15, 3, 4);
  g.fillStyle(0xcc9966); g.fillEllipse(13, 7, 10, 10);
  g.fillStyle(0xaa7744); g.fillRect(10, 5, 2, 3); g.fillRect(13, 4, 3, 3);
  g.fillStyle(0x553322); g.fillRect(7, 24, 4, 6); g.fillRect(15, 24, 4, 6);
  g.generateTexture('raider_shooter_front', 26, 30);

  g.clear();
  g.fillStyle(0x775533); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x664422); g.fillRect(3, 13, 4, 8); g.fillRect(19, 13, 4, 8);
  g.fillStyle(0x444433); g.fillRect(20, 14, 6, 2);
  g.fillStyle(0x555544); g.fillRect(20, 15, 3, 4);
  g.fillStyle(0xcc9966); g.fillEllipse(13, 7, 10, 10);
  g.fillStyle(0xaa7744); g.fillRect(10, 5, 2, 3); g.fillRect(13, 4, 3, 3);
  g.fillStyle(0x553322); g.fillRect(6, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_front_step', 26, 30);

  g.clear();
  g.fillStyle(0x664422); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x553311); g.fillRect(3, 13, 4, 8); g.fillRect(19, 13, 6, 4);
  g.fillStyle(0x444433); g.fillRect(23, 14, 4, 2);
  g.fillStyle(0xaa7744); g.fillEllipse(13, 5, 10, 8);
  g.fillStyle(0x553322); g.fillRect(7, 24, 4, 6); g.fillRect(15, 24, 4, 6);
  g.generateTexture('raider_shooter_back', 26, 30);

  g.clear();
  g.fillStyle(0x664422); g.fillRect(6, 8, 14, 16);
  g.fillStyle(0x553311); g.fillRect(3, 13, 4, 8); g.fillRect(19, 13, 6, 4);
  g.fillStyle(0x444433); g.fillRect(23, 14, 4, 2);
  g.fillStyle(0xaa7744); g.fillEllipse(13, 5, 10, 8);
  g.fillStyle(0x553322); g.fillRect(6, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_back_step', 26, 30);

  g.clear();
  g.fillStyle(0x775533); g.fillRect(6, 8, 13, 16);
  g.fillStyle(0x664422); g.fillRect(4, 14, 3, 7);
  g.fillStyle(0x664422); g.fillRect(17, 13, 6, 4); g.fillStyle(0x444433); g.fillRect(21, 14, 5, 2);
  g.fillStyle(0xcc9966); g.fillEllipse(12, 7, 10, 10);
  g.fillStyle(0x553322); g.fillRect(6, 24, 4, 6); g.fillRect(14, 24, 4, 6);
  g.generateTexture('raider_shooter_fside', 26, 30);

  g.clear();
  g.fillStyle(0x775533); g.fillRect(6, 8, 13, 16);
  g.fillStyle(0x664422); g.fillRect(4, 14, 3, 7);
  g.fillStyle(0x664422); g.fillRect(17, 13, 6, 4); g.fillStyle(0x444433); g.fillRect(21, 14, 5, 2);
  g.fillStyle(0xcc9966); g.fillEllipse(12, 7, 10, 10);
  g.fillStyle(0x553322); g.fillRect(5, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_fside_step', 26, 30);

  g.clear();
  g.fillStyle(0x664422); g.fillRect(6, 8, 13, 16);
  g.fillStyle(0x553311); g.fillRect(4, 13, 3, 8); g.fillRect(18, 13, 5, 4);
  g.fillStyle(0x444433); g.fillRect(21, 14, 4, 2);
  g.fillStyle(0xaa7744); g.fillEllipse(12, 5, 10, 8);
  g.fillStyle(0x553322); g.fillRect(6, 24, 4, 6); g.fillRect(14, 24, 4, 6);
  g.generateTexture('raider_shooter_bside', 26, 30);

  g.clear();
  g.fillStyle(0x664422); g.fillRect(6, 8, 13, 16);
  g.fillStyle(0x553311); g.fillRect(4, 13, 3, 8); g.fillRect(18, 13, 5, 4);
  g.fillStyle(0x444433); g.fillRect(21, 14, 4, 2);
  g.fillStyle(0xaa7744); g.fillEllipse(12, 5, 10, 8);
  g.fillStyle(0x553322); g.fillRect(5, 23, 4, 6); g.fillRect(15, 25, 4, 5);
  g.generateTexture('raider_shooter_bside_step', 26, 30);

  // ── HEAVY variants (dark gray, large armored tank) ───────────
  g.clear();
  g.fillStyle(0x445566); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x334455); g.fillRect(2, 13, 4, 10); g.fillRect(20, 13, 4, 10);
  g.fillStyle(0x556677); g.fillRect(4, 7, 18, 6);
  g.fillStyle(0xbbaa88); g.fillEllipse(13, 6, 12, 10);
  g.fillStyle(0x334455); g.fillRect(3, 24, 7, 6); g.fillRect(16, 26, 7, 4);
  g.generateTexture('raider_heavy_step', 26, 30);

  g.clear();
  g.fillStyle(0x445566); g.fillRect(3, 7, 20, 18);
  g.fillStyle(0x334455); g.fillRect(1, 12, 4, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x556677); g.fillRect(3, 7, 20, 7);
  g.fillStyle(0x667788); g.fillRect(7, 10, 12, 6);
  g.fillStyle(0xbbaa88); g.fillEllipse(13, 6, 14, 10);
  g.fillStyle(0x998877); g.fillRect(10, 4, 3, 3); g.fillRect(13, 3, 3, 3);
  g.fillStyle(0x334455); g.fillRect(5, 25, 7, 5); g.fillRect(14, 25, 7, 5);
  g.generateTexture('raider_heavy_front', 26, 30);

  g.clear();
  g.fillStyle(0x445566); g.fillRect(3, 7, 20, 18);
  g.fillStyle(0x334455); g.fillRect(1, 12, 4, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x556677); g.fillRect(3, 7, 20, 7);
  g.fillStyle(0x667788); g.fillRect(7, 10, 12, 6);
  g.fillStyle(0xbbaa88); g.fillEllipse(13, 6, 14, 10);
  g.fillStyle(0x334455); g.fillRect(4, 24, 7, 5); g.fillRect(15, 26, 7, 4);
  g.generateTexture('raider_heavy_front_step', 26, 30);

  g.clear();
  g.fillStyle(0x3a4a55); g.fillRect(3, 7, 20, 18);
  g.fillStyle(0x293545); g.fillRect(1, 12, 4, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x4a5a66); g.fillRect(3, 7, 20, 7);
  g.fillStyle(0x445566); g.fillRect(7, 10, 12, 10);
  g.fillStyle(0xaa9977); g.fillEllipse(13, 5, 14, 8);
  g.fillStyle(0x334455); g.fillRect(5, 25, 7, 5); g.fillRect(14, 25, 7, 5);
  g.generateTexture('raider_heavy_back', 26, 30);

  g.clear();
  g.fillStyle(0x3a4a55); g.fillRect(3, 7, 20, 18);
  g.fillStyle(0x293545); g.fillRect(1, 12, 4, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x4a5a66); g.fillRect(3, 7, 20, 7);
  g.fillStyle(0x445566); g.fillRect(7, 10, 12, 10);
  g.fillStyle(0xaa9977); g.fillEllipse(13, 5, 14, 8);
  g.fillStyle(0x334455); g.fillRect(4, 24, 7, 5); g.fillRect(15, 26, 7, 4);
  g.generateTexture('raider_heavy_back_step', 26, 30);

  g.clear();
  g.fillStyle(0x445566); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x334455); g.fillRect(2, 12, 3, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x556677); g.fillRect(4, 7, 18, 7);
  g.fillStyle(0x667788); g.fillRect(6, 10, 10, 5);
  g.fillStyle(0xbbaa88); g.fillEllipse(12, 6, 13, 10);
  g.fillStyle(0x334455); g.fillRect(5, 25, 7, 5); g.fillRect(14, 25, 7, 5);
  g.generateTexture('raider_heavy_fside', 26, 30);

  g.clear();
  g.fillStyle(0x445566); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x334455); g.fillRect(2, 12, 3, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x556677); g.fillRect(4, 7, 18, 7);
  g.fillStyle(0x667788); g.fillRect(6, 10, 10, 5);
  g.fillStyle(0xbbaa88); g.fillEllipse(12, 6, 13, 10);
  g.fillStyle(0x334455); g.fillRect(4, 24, 7, 5); g.fillRect(15, 26, 7, 4);
  g.generateTexture('raider_heavy_fside_step', 26, 30);

  g.clear();
  g.fillStyle(0x3a4a55); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x293545); g.fillRect(2, 12, 3, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x4a5a66); g.fillRect(4, 7, 18, 7);
  g.fillStyle(0x445566); g.fillRect(6, 10, 10, 10);
  g.fillStyle(0xaa9977); g.fillEllipse(12, 5, 13, 8);
  g.fillStyle(0x334455); g.fillRect(5, 25, 7, 5); g.fillRect(14, 25, 7, 5);
  g.generateTexture('raider_heavy_bside', 26, 30);

  g.clear();
  g.fillStyle(0x3a4a55); g.fillRect(4, 7, 18, 18);
  g.fillStyle(0x293545); g.fillRect(2, 12, 3, 11); g.fillRect(21, 12, 4, 11);
  g.fillStyle(0x4a5a66); g.fillRect(4, 7, 18, 7);
  g.fillStyle(0x445566); g.fillRect(6, 10, 10, 10);
  g.fillStyle(0xaa9977); g.fillEllipse(12, 5, 13, 8);
  g.fillStyle(0x334455); g.fillRect(4, 24, 7, 5); g.fillRect(15, 26, 7, 4);
  g.generateTexture('raider_heavy_bside_step', 26, 30);
}

// ── LAUREN (The Charmer) sprites ─────────────────────────────
function drawLauren(g) {
  g.clear();
  // shoe (side view)
  g.fillStyle(0x774455); g.fillRect(8,52,14,8);
  // lower skirt (wide fan)
  g.fillStyle(0xbb6699); g.fillRect(0,42,36,10);
  g.fillStyle(0xd988bb); g.fillRect(2,36,34,14);
  g.fillStyle(0xeeccdd); g.fillRect(4,34,22,4);
  g.fillStyle(0xcc77aa); g.fillRect(2,50,34,2);
  // waist ribbon
  g.fillStyle(0xff99bb); g.fillRect(14,32,10,4);
  g.fillStyle(0xff77aa); g.fillRect(17,29,4,6);
  // bodice
  g.fillStyle(0x9966aa); g.fillRect(10,14,18,20);
  g.fillStyle(0x775588); g.fillRect(10,14,4,18);
  g.fillStyle(0xbb88cc); g.fillRect(14,14,6,6);
  // arms
  g.fillStyle(0xffcc99); g.fillRect(28,16,8,12);
  g.fillStyle(0xffcc99); g.fillRect(4,16,6,12);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(15,10,10,6);
  // face
  g.fillStyle(0xffcc99); g.fillRect(11,4,16,8);
  // hair
  g.fillStyle(0xcc8844); g.fillRect(10,0,18,8);
  g.fillStyle(0xdd9955); g.fillRect(10,0,18,3);
  g.fillStyle(0xcc8844); g.fillRect(6,4,6,10);
  g.fillStyle(0xaa6622); g.fillRect(24,6,6,8);
  g.generateTexture('charmer', 44, 60);
}

function drawLaurenStep(g) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(8,49,14,11);
  g.fillStyle(0xbb6699); g.fillRect(0,42,36,10);
  g.fillStyle(0xd988bb); g.fillRect(2,36,34,14);
  g.fillStyle(0xeeccdd); g.fillRect(4,34,22,4);
  g.fillStyle(0xcc77aa); g.fillRect(2,50,34,2);
  g.fillStyle(0xff99bb); g.fillRect(14,32,10,4);
  g.fillStyle(0xff77aa); g.fillRect(17,29,4,6);
  g.fillStyle(0x9966aa); g.fillRect(10,14,18,20);
  g.fillStyle(0x775588); g.fillRect(10,14,4,18);
  g.fillStyle(0xbb88cc); g.fillRect(14,14,6,6);
  g.fillStyle(0xffcc99); g.fillRect(28,14,8,12);
  g.fillStyle(0xffcc99); g.fillRect(4,18,6,12);
  g.fillStyle(0xffcc99); g.fillRect(15,10,10,6);
  g.fillStyle(0xffcc99); g.fillRect(11,4,16,8);
  g.fillStyle(0xcc8844); g.fillRect(10,0,18,8);
  g.fillStyle(0xdd9955); g.fillRect(10,0,18,3);
  g.fillStyle(0xcc8844); g.fillRect(6,4,6,10);
  g.fillStyle(0xaa6622); g.fillRect(24,6,6,8);
  g.generateTexture('charmer_step', 44, 60);
}

function drawLaurenFront(g) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(9,52,10,8); g.fillRect(25,52,10,8);
  g.fillStyle(0xbb6699); g.fillRect(1,44,42,8);
  g.fillStyle(0xd988bb); g.fillRect(3,36,38,14);
  g.fillStyle(0xeeccdd); g.fillRect(7,34,30,6);
  g.fillStyle(0xcc77aa); g.fillRect(3,50,38,2);
  g.fillStyle(0xff99bb); g.fillRect(16,32,12,5);
  g.fillStyle(0xff77aa); g.fillRect(20,28,4,6);
  g.fillStyle(0x9966aa); g.fillRect(12,14,20,20);
  g.fillStyle(0x775588); g.fillRect(12,14,4,18);
  g.fillStyle(0xbb88cc); g.fillRect(16,14,10,6);
  g.fillStyle(0xffcc99); g.fillRect(4,16,8,14);
  g.fillStyle(0xffcc99); g.fillRect(32,16,8,14);
  g.fillStyle(0xffcc99); g.fillRect(18,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(14,4,16,8);
  g.fillStyle(0xcc8844); g.fillRect(12,0,20,8);
  g.fillStyle(0xdd9955); g.fillRect(12,0,20,3);
  g.fillStyle(0xcc8844); g.fillRect(8,4,6,10);
  g.fillStyle(0xcc8844); g.fillRect(30,4,6,10);
  g.generateTexture('charmer_front', 44, 60);
}

function drawLaurenFrontStep(g) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(9,49,10,11); g.fillRect(25,52,10,8);
  g.fillStyle(0xbb6699); g.fillRect(1,44,42,8);
  g.fillStyle(0xd988bb); g.fillRect(3,36,38,14);
  g.fillStyle(0xeeccdd); g.fillRect(7,34,30,6);
  g.fillStyle(0xcc77aa); g.fillRect(3,50,38,2);
  g.fillStyle(0xff99bb); g.fillRect(16,32,12,5);
  g.fillStyle(0xff77aa); g.fillRect(20,28,4,6);
  g.fillStyle(0x9966aa); g.fillRect(12,14,20,20);
  g.fillStyle(0x775588); g.fillRect(12,14,4,18);
  g.fillStyle(0xbb88cc); g.fillRect(16,14,10,6);
  g.fillStyle(0xffcc99); g.fillRect(4,14,8,14);
  g.fillStyle(0xffcc99); g.fillRect(32,18,8,14);
  g.fillStyle(0xffcc99); g.fillRect(18,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(14,4,16,8);
  g.fillStyle(0xcc8844); g.fillRect(12,0,20,8);
  g.fillStyle(0xdd9955); g.fillRect(12,0,20,3);
  g.fillStyle(0xcc8844); g.fillRect(8,4,6,10);
  g.fillStyle(0xcc8844); g.fillRect(30,4,6,10);
  g.generateTexture('charmer_front_step', 44, 60);
}

function drawLaurenBack(g) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(9,52,10,8); g.fillRect(25,52,10,8);
  g.fillStyle(0xbb6699); g.fillRect(1,44,42,8);
  g.fillStyle(0xd988bb); g.fillRect(3,36,38,14);
  g.fillStyle(0xcc77aa); g.fillRect(3,50,38,2);
  g.fillStyle(0xff99bb); g.fillRect(17,32,10,4);
  g.fillStyle(0x775588); g.fillRect(12,14,20,20);
  g.fillStyle(0x9966aa); g.fillRect(16,14,12,18);
  g.fillStyle(0x553366); g.fillRect(20,14,4,18);
  g.fillStyle(0xffcc99); g.fillRect(4,16,8,14);
  g.fillStyle(0xffcc99); g.fillRect(32,16,8,14);
  g.fillStyle(0xffcc99); g.fillRect(18,10,8,6);
  // hair bun (back view)
  g.fillStyle(0xcc8844); g.fillRect(12,0,20,12);
  g.fillStyle(0xdd9955); g.fillRect(12,0,20,4);
  g.fillStyle(0xcc8844); g.fillRect(8,4,6,10);
  g.fillStyle(0xcc8844); g.fillRect(30,4,6,10);
  g.fillStyle(0xaa6622); g.fillEllipse(22,10,12,8);
  g.generateTexture('charmer_back', 44, 60);
}

function drawLaurenBackStep(g) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(9,52,10,8); g.fillRect(25,49,10,11);
  g.fillStyle(0xbb6699); g.fillRect(1,44,42,8);
  g.fillStyle(0xd988bb); g.fillRect(3,36,38,14);
  g.fillStyle(0xcc77aa); g.fillRect(3,50,38,2);
  g.fillStyle(0xff99bb); g.fillRect(17,32,10,4);
  g.fillStyle(0x775588); g.fillRect(12,14,20,20);
  g.fillStyle(0x9966aa); g.fillRect(16,14,12,18);
  g.fillStyle(0x553366); g.fillRect(20,14,4,18);
  g.fillStyle(0xffcc99); g.fillRect(4,18,8,14);
  g.fillStyle(0xffcc99); g.fillRect(32,14,8,14);
  g.fillStyle(0xffcc99); g.fillRect(18,10,8,6);
  g.fillStyle(0xcc8844); g.fillRect(12,0,20,12);
  g.fillStyle(0xdd9955); g.fillRect(12,0,20,4);
  g.fillStyle(0xcc8844); g.fillRect(8,4,6,10);
  g.fillStyle(0xcc8844); g.fillRect(30,4,6,10);
  g.fillStyle(0xaa6622); g.fillEllipse(22,10,12,8);
  g.generateTexture('charmer_back_step', 44, 60);
}

function drawLaurenFSide(g) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(9,52,12,8); g.fillRect(22,53,10,7);
  g.fillStyle(0xbb6699); g.fillRect(1,43,40,9);
  g.fillStyle(0xd988bb); g.fillRect(3,36,36,14);
  g.fillStyle(0xeeccdd); g.fillRect(6,34,24,5);
  g.fillStyle(0xcc77aa); g.fillRect(3,50,36,2);
  g.fillStyle(0xff99bb); g.fillRect(15,32,12,4);
  g.fillStyle(0xff77aa); g.fillRect(19,29,4,5);
  g.fillStyle(0x9966aa); g.fillRect(11,14,20,20);
  g.fillStyle(0x775588); g.fillRect(11,14,5,18);
  g.fillStyle(0xbb88cc); g.fillRect(16,14,8,6);
  g.fillStyle(0xffcc99); g.fillRect(4,16,7,14);
  g.fillStyle(0xffcc99); g.fillRect(30,16,8,14);
  g.fillStyle(0xffcc99); g.fillRect(17,10,9,6);
  g.fillStyle(0xffcc99); g.fillRect(13,4,16,8);
  g.fillStyle(0xcc8844); g.fillRect(11,0,20,8);
  g.fillStyle(0xdd9955); g.fillRect(11,0,20,3);
  g.fillStyle(0xcc8844); g.fillRect(7,4,6,10);
  g.fillStyle(0xcc8844); g.fillRect(29,4,6,10);
  g.generateTexture('charmer_fside', 44, 60);
}

function drawLaurenFSideStep(g) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(9,49,12,11); g.fillRect(22,53,10,7);
  g.fillStyle(0xbb6699); g.fillRect(1,43,40,9);
  g.fillStyle(0xd988bb); g.fillRect(3,36,36,14);
  g.fillStyle(0xeeccdd); g.fillRect(6,34,24,5);
  g.fillStyle(0xcc77aa); g.fillRect(3,50,36,2);
  g.fillStyle(0xff99bb); g.fillRect(15,32,12,4);
  g.fillStyle(0xff77aa); g.fillRect(19,29,4,5);
  g.fillStyle(0x9966aa); g.fillRect(11,14,20,20);
  g.fillStyle(0x775588); g.fillRect(11,14,5,18);
  g.fillStyle(0xbb88cc); g.fillRect(16,14,8,6);
  g.fillStyle(0xffcc99); g.fillRect(4,14,7,14);
  g.fillStyle(0xffcc99); g.fillRect(30,18,8,14);
  g.fillStyle(0xffcc99); g.fillRect(17,10,9,6);
  g.fillStyle(0xffcc99); g.fillRect(13,4,16,8);
  g.fillStyle(0xcc8844); g.fillRect(11,0,20,8);
  g.fillStyle(0xdd9955); g.fillRect(11,0,20,3);
  g.fillStyle(0xcc8844); g.fillRect(7,4,6,10);
  g.fillStyle(0xcc8844); g.fillRect(29,4,6,10);
  g.generateTexture('charmer_fside_step', 44, 60);
}

function drawLaurenBSide(g) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(9,52,12,8); g.fillRect(23,52,10,8);
  g.fillStyle(0xbb6699); g.fillRect(1,44,40,8);
  g.fillStyle(0xd988bb); g.fillRect(3,36,36,14);
  g.fillStyle(0xcc77aa); g.fillRect(3,50,36,2);
  g.fillStyle(0xff99bb); g.fillRect(16,32,10,4);
  g.fillStyle(0x775588); g.fillRect(11,14,20,20);
  g.fillStyle(0x9966aa); g.fillRect(15,14,12,18);
  g.fillStyle(0x553366); g.fillRect(20,14,3,18);
  g.fillStyle(0xffcc99); g.fillRect(4,16,7,14);
  g.fillStyle(0xffcc99); g.fillRect(31,16,8,14);
  g.fillStyle(0xffcc99); g.fillRect(17,10,9,6);
  g.fillStyle(0xcc8844); g.fillRect(11,0,20,10);
  g.fillStyle(0xdd9955); g.fillRect(11,0,20,3);
  g.fillStyle(0xcc8844); g.fillRect(7,4,6,10);
  g.fillStyle(0xcc8844); g.fillRect(29,4,6,10);
  g.fillStyle(0xaa6622); g.fillEllipse(23,9,10,7);
  g.generateTexture('charmer_bside', 44, 60);
}

function drawLaurenBSideStep(g) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(9,52,12,8); g.fillRect(23,49,10,11);
  g.fillStyle(0xbb6699); g.fillRect(1,44,40,8);
  g.fillStyle(0xd988bb); g.fillRect(3,36,36,14);
  g.fillStyle(0xcc77aa); g.fillRect(3,50,36,2);
  g.fillStyle(0xff99bb); g.fillRect(16,32,10,4);
  g.fillStyle(0x775588); g.fillRect(11,14,20,20);
  g.fillStyle(0x9966aa); g.fillRect(15,14,12,18);
  g.fillStyle(0x553366); g.fillRect(20,14,3,18);
  g.fillStyle(0xffcc99); g.fillRect(4,18,7,14);
  g.fillStyle(0xffcc99); g.fillRect(31,14,8,14);
  g.fillStyle(0xffcc99); g.fillRect(17,10,9,6);
  g.fillStyle(0xcc8844); g.fillRect(11,0,20,10);
  g.fillStyle(0xdd9955); g.fillRect(11,0,20,3);
  g.fillStyle(0xcc8844); g.fillRect(7,4,6,10);
  g.fillStyle(0xcc8844); g.fillRect(29,4,6,10);
  g.fillStyle(0xaa6622); g.fillEllipse(23,9,10,7);
  g.generateTexture('charmer_bside_step', 44, 60);
}

// ── ABIGAIL (The Ranger) sprites ─────────────────────────────
function drawAbigail(g) {
  g.clear();
  // boots
  g.fillStyle(0x222211); g.fillRect(7,52,11,8); g.fillRect(20,52,11,8);
  g.fillStyle(0x3d3320); g.fillRect(20,52,4,6);
  // leggings — narrower
  g.fillStyle(0x334422); g.fillRect(7,34,11,18); g.fillRect(20,34,11,18);
  g.fillStyle(0x446633); g.fillRect(21,34,3,16);
  // cloak body — slimmer (22px vs 28px)
  g.fillStyle(0x446622); g.fillRect(6,14,22,22);
  g.fillStyle(0x557733); g.fillRect(8,15,16,20);
  g.fillStyle(0x668844); g.fillRect(9,15,10,6);
  g.fillStyle(0x334411); g.fillRect(6,14,3,20); g.fillRect(25,14,3,20);
  // belt
  g.fillStyle(0x8b5e3c); g.fillRect(6,32,22,4);
  g.fillStyle(0x6b3f1e); g.fillRect(14,31,6,5);
  // bow (right side, vertical stave)
  g.fillStyle(0x8b5e3c); g.fillRect(33,4,4,52);
  g.fillStyle(0x7a4a28); g.fillRect(33,4,4,4); g.fillRect(33,52,4,4);
  g.fillStyle(0xddcc99); g.fillRect(35,4,1,52);
  // arms
  g.fillStyle(0x557733); g.fillRect(3,14,4,22);
  g.fillStyle(0xffcc99); g.fillRect(3,26,4,8);
  g.fillStyle(0x557733); g.fillRect(27,18,4,14);
  g.fillStyle(0xffcc99); g.fillRect(27,28,4,8);
  // long brown hair — flows from hood past shoulder on left side
  g.fillStyle(0x8b4513); g.fillRect(0,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(1,4,3,12);
  g.fillStyle(0x7a3d10); g.fillRect(0,20,4,10);
  // neck + face
  g.fillStyle(0xffcc99); g.fillRect(14,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(11,4,12,8);
  // hood — same width as slimmer body
  g.fillStyle(0x446622); g.fillRect(9,0,16,12);
  g.fillStyle(0x334411); g.fillRect(9,0,3,10); g.fillRect(22,0,3,10);
  g.fillStyle(0x557733); g.fillRect(11,0,12,5);
  g.fillStyle(0x2d1f15); g.fillRect(11,6,8,5);
  g.generateTexture('ranger', 44, 60);
}

function drawAbigailStep(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(7,49,11,11); g.fillRect(20,52,11,8);
  g.fillStyle(0x3d3320); g.fillRect(20,52,4,6);
  g.fillStyle(0x334422); g.fillRect(7,32,11,18); g.fillRect(20,34,11,18);
  g.fillStyle(0x446633); g.fillRect(21,34,3,16);
  g.fillStyle(0x446622); g.fillRect(6,14,22,22);
  g.fillStyle(0x557733); g.fillRect(8,15,16,20);
  g.fillStyle(0x668844); g.fillRect(9,15,10,6);
  g.fillStyle(0x334411); g.fillRect(6,14,3,20); g.fillRect(25,14,3,20);
  g.fillStyle(0x8b5e3c); g.fillRect(6,32,22,4);
  g.fillStyle(0x6b3f1e); g.fillRect(14,31,6,5);
  g.fillStyle(0x8b5e3c); g.fillRect(33,4,4,52);
  g.fillStyle(0x7a4a28); g.fillRect(33,4,4,4); g.fillRect(33,52,4,4);
  g.fillStyle(0xddcc99); g.fillRect(35,4,1,52);
  g.fillStyle(0x557733); g.fillRect(3,18,4,22);
  g.fillStyle(0xffcc99); g.fillRect(3,28,4,8);
  g.fillStyle(0x557733); g.fillRect(27,14,4,14);
  g.fillStyle(0xffcc99); g.fillRect(27,24,4,8);
  g.fillStyle(0x8b4513); g.fillRect(0,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(1,4,3,12);
  g.fillStyle(0x7a3d10); g.fillRect(0,20,4,10);
  g.fillStyle(0xffcc99); g.fillRect(14,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(11,4,12,8);
  g.fillStyle(0x446622); g.fillRect(9,0,16,12);
  g.fillStyle(0x334411); g.fillRect(9,0,3,10); g.fillRect(22,0,3,10);
  g.fillStyle(0x557733); g.fillRect(11,0,12,5);
  g.fillStyle(0x2d1f15); g.fillRect(11,6,8,5);
  g.generateTexture('ranger_step', 44, 60);
}

function drawAbigailFront(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(9,52,11,8); g.fillRect(24,52,11,8);
  g.fillStyle(0x334422); g.fillRect(9,34,11,18); g.fillRect(24,34,11,18);
  g.fillStyle(0x446633); g.fillRect(11,34,3,16); g.fillRect(26,34,3,16);
  // slimmer body — 26px wide instead of 36px
  g.fillStyle(0x446622); g.fillRect(9,14,26,22);
  g.fillStyle(0x557733); g.fillRect(11,15,20,20);
  g.fillStyle(0x668844); g.fillRect(13,15,16,6);
  g.fillStyle(0x334411); g.fillRect(9,14,3,20); g.fillRect(32,14,3,20);
  g.fillStyle(0x8b5e3c); g.fillRect(9,32,26,4);
  g.fillStyle(0x6b3f1e); g.fillRect(19,31,6,5);
  // bow to the right
  g.fillStyle(0x8b5e3c); g.fillRect(39,4,4,52);
  g.fillStyle(0x7a4a28); g.fillRect(39,4,4,4); g.fillRect(39,52,4,4);
  g.fillStyle(0xddcc99); g.fillRect(41,4,1,52);
  // arms
  g.fillStyle(0x557733); g.fillRect(5,16,5,22);
  g.fillStyle(0xffcc99); g.fillRect(5,28,5,8);
  g.fillStyle(0x557733); g.fillRect(34,16,5,14);
  g.fillStyle(0xffcc99); g.fillRect(34,26,5,8);
  // long brown hair — visible on both sides of hood
  g.fillStyle(0x8b4513); g.fillRect(5,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(6,4,3,14);
  g.fillStyle(0x8b4513); g.fillRect(34,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(35,4,3,14);
  // neck + face
  g.fillStyle(0xffcc99); g.fillRect(18,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(15,4,14,8);
  // hood
  g.fillStyle(0x446622); g.fillRect(12,0,20,13);
  g.fillStyle(0x334411); g.fillRect(12,0,4,12); g.fillRect(28,0,4,12);
  g.fillStyle(0x557733); g.fillRect(14,0,16,5);
  g.fillStyle(0x2d1f15); g.fillRect(15,6,14,6);
  g.generateTexture('ranger_front', 44, 60);
}

function drawAbigailFrontStep(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(9,49,11,11); g.fillRect(24,52,11,8);
  g.fillStyle(0x334422); g.fillRect(9,32,11,18); g.fillRect(24,34,11,18);
  g.fillStyle(0x446633); g.fillRect(11,32,3,16); g.fillRect(26,34,3,16);
  g.fillStyle(0x446622); g.fillRect(9,14,26,22);
  g.fillStyle(0x557733); g.fillRect(11,15,20,20);
  g.fillStyle(0x668844); g.fillRect(13,15,16,6);
  g.fillStyle(0x334411); g.fillRect(9,14,3,20); g.fillRect(32,14,3,20);
  g.fillStyle(0x8b5e3c); g.fillRect(9,32,26,4);
  g.fillStyle(0x6b3f1e); g.fillRect(19,31,6,5);
  g.fillStyle(0x8b5e3c); g.fillRect(39,4,4,52);
  g.fillStyle(0x7a4a28); g.fillRect(39,4,4,4); g.fillRect(39,52,4,4);
  g.fillStyle(0xddcc99); g.fillRect(41,4,1,52);
  g.fillStyle(0x557733); g.fillRect(5,14,5,22);
  g.fillStyle(0xffcc99); g.fillRect(5,24,5,8);
  g.fillStyle(0x557733); g.fillRect(34,18,5,14);
  g.fillStyle(0xffcc99); g.fillRect(34,28,5,8);
  g.fillStyle(0x8b4513); g.fillRect(5,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(6,4,3,14);
  g.fillStyle(0x8b4513); g.fillRect(34,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(35,4,3,14);
  g.fillStyle(0xffcc99); g.fillRect(18,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(15,4,14,8);
  g.fillStyle(0x446622); g.fillRect(12,0,20,13);
  g.fillStyle(0x334411); g.fillRect(12,0,4,12); g.fillRect(28,0,4,12);
  g.fillStyle(0x557733); g.fillRect(14,0,16,5);
  g.fillStyle(0x2d1f15); g.fillRect(15,6,14,6);
  g.generateTexture('ranger_front_step', 44, 60);
}

function drawAbigailBack(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(9,52,11,8); g.fillRect(24,52,11,8);
  g.fillStyle(0x334422); g.fillRect(9,34,11,18); g.fillRect(24,34,11,18);
  // slimmer body
  g.fillStyle(0x446622); g.fillRect(9,14,26,22);
  g.fillStyle(0x557733); g.fillRect(11,15,20,20);
  g.fillStyle(0x334411); g.fillRect(9,14,3,20); g.fillRect(32,14,3,20);
  g.fillStyle(0x334411); g.fillRect(20,14,4,20);
  // quiver on back (left side)
  g.fillStyle(0x8b5e3c); g.fillRect(6,14,5,22);
  g.fillStyle(0x7a4a28); g.fillRect(6,14,5,4);
  g.fillStyle(0xddcc99); g.fillRect(7,8,2,10); g.fillRect(10,8,2,10);
  g.fillStyle(0x8b5e3c); g.fillRect(9,32,26,4);
  // arms
  g.fillStyle(0x557733); g.fillRect(5,16,5,22);
  g.fillStyle(0x557733); g.fillRect(34,16,5,22);
  // long brown hair — flowing down the back (most visible from this angle)
  g.fillStyle(0x8b4513); g.fillRect(9,0,26,30);
  g.fillStyle(0xaa6633); g.fillRect(11,0,14,16);
  g.fillStyle(0x7a3d10); g.fillRect(9,18,26,12);
  g.fillStyle(0xcc8844); g.fillRect(13,2,10,8);
  // hood over hair
  g.fillStyle(0x446622); g.fillRect(12,0,20,14);
  g.fillStyle(0x334411); g.fillRect(12,0,4,12); g.fillRect(28,0,4,12);
  g.fillStyle(0x2d1f15); g.fillRect(14,6,16,8);
  g.generateTexture('ranger_back', 44, 60);
}

function drawAbigailBackStep(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(9,52,11,8); g.fillRect(24,49,11,11);
  g.fillStyle(0x334422); g.fillRect(9,34,11,18); g.fillRect(24,32,11,18);
  g.fillStyle(0x446622); g.fillRect(9,14,26,22);
  g.fillStyle(0x557733); g.fillRect(11,15,20,20);
  g.fillStyle(0x334411); g.fillRect(9,14,3,20); g.fillRect(32,14,3,20);
  g.fillStyle(0x334411); g.fillRect(20,14,4,20);
  g.fillStyle(0x8b5e3c); g.fillRect(6,14,5,22);
  g.fillStyle(0x7a4a28); g.fillRect(6,14,5,4);
  g.fillStyle(0xddcc99); g.fillRect(7,8,2,10); g.fillRect(10,8,2,10);
  g.fillStyle(0x8b5e3c); g.fillRect(9,32,26,4);
  g.fillStyle(0x557733); g.fillRect(5,18,5,22);
  g.fillStyle(0x557733); g.fillRect(34,14,5,22);
  g.fillStyle(0x8b4513); g.fillRect(9,0,26,30);
  g.fillStyle(0xaa6633); g.fillRect(11,0,14,16);
  g.fillStyle(0x7a3d10); g.fillRect(9,18,26,12);
  g.fillStyle(0xcc8844); g.fillRect(13,2,10,8);
  g.fillStyle(0x446622); g.fillRect(12,0,20,14);
  g.fillStyle(0x334411); g.fillRect(12,0,4,12); g.fillRect(28,0,4,12);
  g.fillStyle(0x2d1f15); g.fillRect(14,6,16,8);
  g.generateTexture('ranger_back_step', 44, 60);
}

function drawAbigailFSide(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(8,52,11,8); g.fillRect(22,53,10,7);
  g.fillStyle(0x334422); g.fillRect(8,34,11,18); g.fillRect(22,35,10,17);
  g.fillStyle(0x446633); g.fillRect(10,34,3,16);
  // slimmer diagonal body
  g.fillStyle(0x446622); g.fillRect(6,14,24,22);
  g.fillStyle(0x557733); g.fillRect(8,15,18,20);
  g.fillStyle(0x668844); g.fillRect(10,15,12,6);
  g.fillStyle(0x334411); g.fillRect(6,14,3,20); g.fillRect(27,14,3,20);
  g.fillStyle(0x8b5e3c); g.fillRect(6,32,24,4);
  g.fillStyle(0x6b3f1e); g.fillRect(15,31,6,5);
  g.fillStyle(0x8b5e3c); g.fillRect(37,4,4,52);
  g.fillStyle(0x7a4a28); g.fillRect(37,4,4,4); g.fillRect(37,52,4,4);
  g.fillStyle(0xddcc99); g.fillRect(39,4,1,52);
  // arms
  g.fillStyle(0x557733); g.fillRect(3,16,4,22);
  g.fillStyle(0xffcc99); g.fillRect(3,28,4,8);
  g.fillStyle(0x557733); g.fillRect(29,18,4,14);
  g.fillStyle(0xffcc99); g.fillRect(29,28,4,8);
  // brown hair on left side
  g.fillStyle(0x8b4513); g.fillRect(0,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(1,4,3,12);
  g.fillStyle(0x7a3d10); g.fillRect(0,20,4,10);
  // neck + face
  g.fillStyle(0xffcc99); g.fillRect(15,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(12,4,12,8);
  // hood
  g.fillStyle(0x446622); g.fillRect(10,0,18,13);
  g.fillStyle(0x334411); g.fillRect(10,0,3,12); g.fillRect(25,0,3,12);
  g.fillStyle(0x557733); g.fillRect(12,0,14,5);
  g.fillStyle(0x2d1f15); g.fillRect(13,6,11,6);
  g.generateTexture('ranger_fside', 44, 60);
}

function drawAbigailFSideStep(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(8,49,11,11); g.fillRect(22,53,10,7);
  g.fillStyle(0x334422); g.fillRect(8,32,11,18); g.fillRect(22,35,10,17);
  g.fillStyle(0x446633); g.fillRect(10,32,3,16);
  g.fillStyle(0x446622); g.fillRect(6,14,24,22);
  g.fillStyle(0x557733); g.fillRect(8,15,18,20);
  g.fillStyle(0x668844); g.fillRect(10,15,12,6);
  g.fillStyle(0x334411); g.fillRect(6,14,3,20); g.fillRect(27,14,3,20);
  g.fillStyle(0x8b5e3c); g.fillRect(6,32,24,4);
  g.fillStyle(0x6b3f1e); g.fillRect(15,31,6,5);
  g.fillStyle(0x8b5e3c); g.fillRect(37,4,4,52);
  g.fillStyle(0x7a4a28); g.fillRect(37,4,4,4); g.fillRect(37,52,4,4);
  g.fillStyle(0xddcc99); g.fillRect(39,4,1,52);
  g.fillStyle(0x557733); g.fillRect(3,14,4,22);
  g.fillStyle(0xffcc99); g.fillRect(3,24,4,8);
  g.fillStyle(0x557733); g.fillRect(29,22,4,14);
  g.fillStyle(0xffcc99); g.fillRect(29,32,4,8);
  g.fillStyle(0x8b4513); g.fillRect(0,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(1,4,3,12);
  g.fillStyle(0x7a3d10); g.fillRect(0,20,4,10);
  g.fillStyle(0xffcc99); g.fillRect(15,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(12,4,12,8);
  g.fillStyle(0x446622); g.fillRect(10,0,18,13);
  g.fillStyle(0x334411); g.fillRect(10,0,3,12); g.fillRect(25,0,3,12);
  g.fillStyle(0x557733); g.fillRect(12,0,14,5);
  g.fillStyle(0x2d1f15); g.fillRect(13,6,11,6);
  g.generateTexture('ranger_fside_step', 44, 60);
}

function drawAbigailBSide(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(8,52,11,8); g.fillRect(23,52,10,8);
  g.fillStyle(0x334422); g.fillRect(8,34,11,18); g.fillRect(23,34,10,18);
  // slimmer diagonal body
  g.fillStyle(0x446622); g.fillRect(6,14,24,22);
  g.fillStyle(0x557733); g.fillRect(8,15,18,20);
  g.fillStyle(0x334411); g.fillRect(6,14,3,20); g.fillRect(27,14,3,20);
  g.fillStyle(0x334411); g.fillRect(18,14,3,20);
  // quiver visible on left
  g.fillStyle(0x8b5e3c); g.fillRect(3,14,5,20);
  g.fillStyle(0xddcc99); g.fillRect(4,8,2,10); g.fillRect(7,8,2,10);
  g.fillStyle(0x8b5e3c); g.fillRect(6,32,24,4);
  // arms
  g.fillStyle(0x557733); g.fillRect(3,16,4,22);
  g.fillStyle(0x557733); g.fillRect(29,16,5,22);
  // long brown hair — prominent from back-diagonal
  g.fillStyle(0x8b4513); g.fillRect(28,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(29,4,3,14);
  g.fillStyle(0x7a3d10); g.fillRect(28,20,5,10);
  // neck
  g.fillStyle(0xffcc99); g.fillRect(16,10,8,6);
  // hood
  g.fillStyle(0x446622); g.fillRect(10,0,18,13);
  g.fillStyle(0x334411); g.fillRect(10,0,3,12); g.fillRect(25,0,3,12);
  g.fillStyle(0x2d1f15); g.fillRect(12,6,14,8);
  g.fillStyle(0x8b4513); g.fillRect(25,0,6,12);
  g.fillStyle(0xaa6633); g.fillRect(26,0,4,6);
  g.generateTexture('ranger_bside', 44, 60);
}

function drawAbigailBSideStep(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(8,52,11,8); g.fillRect(23,49,10,11);
  g.fillStyle(0x334422); g.fillRect(8,34,11,18); g.fillRect(23,32,10,18);
  g.fillStyle(0x446622); g.fillRect(6,14,24,22);
  g.fillStyle(0x557733); g.fillRect(8,15,18,20);
  g.fillStyle(0x334411); g.fillRect(6,14,3,20); g.fillRect(27,14,3,20);
  g.fillStyle(0x334411); g.fillRect(18,14,3,20);
  g.fillStyle(0x8b5e3c); g.fillRect(3,14,5,20);
  g.fillStyle(0xddcc99); g.fillRect(4,8,2,10); g.fillRect(7,8,2,10);
  g.fillStyle(0x8b5e3c); g.fillRect(6,32,24,4);
  g.fillStyle(0x557733); g.fillRect(3,18,4,22);
  g.fillStyle(0x557733); g.fillRect(29,14,5,22);
  g.fillStyle(0x8b4513); g.fillRect(28,4,5,26);
  g.fillStyle(0xaa6633); g.fillRect(29,4,3,14);
  g.fillStyle(0x7a3d10); g.fillRect(28,20,5,10);
  g.fillStyle(0xffcc99); g.fillRect(16,10,8,6);
  g.fillStyle(0x446622); g.fillRect(10,0,18,13);
  g.fillStyle(0x334411); g.fillRect(10,0,3,12); g.fillRect(25,0,3,12);
  g.fillStyle(0x2d1f15); g.fillRect(12,6,14,8);
  g.fillStyle(0x8b4513); g.fillRect(25,0,6,12);
  g.fillStyle(0xaa6633); g.fillRect(26,0,4,6);
  g.generateTexture('ranger_bside_step', 44, 60);
}

// ── ATTACK-POSE FRAMES ──────────────────────────────────────────
// One attack frame per direction per character. Shown briefly by _triggerAtkAnim.

// ── KNIGHT attack variants ──────────────────────────────────────
function drawKnightAtk(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(5,52,11,8); g.fillRect(18,52,11,8);
  g.fillStyle(0x2d4a63); g.fillRect(18,52,4,6);
  g.fillStyle(0x2d4a63); g.fillRect(5,34,11,20); g.fillRect(18,34,11,20);
  g.fillStyle(0x3a5a7a); g.fillRect(19,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(5,46,11,2); g.fillRect(18,46,11,2);
  g.fillStyle(0x111111); g.fillRect(2,30,28,6);
  g.fillStyle(0x2d4a63); g.fillRect(4,31,10,4); g.fillRect(16,31,10,4);
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,28,20);
  g.fillStyle(0x3a5a7a); g.fillRect(6,14,18,16);
  g.fillStyle(0x5588aa); g.fillRect(6,14,18,4);
  g.fillStyle(0x2244aa); g.fillRect(0,12,6,24);
  g.fillStyle(0x4466cc); g.fillRect(1,13,3,20);
  g.fillStyle(0xccaa00); g.fillCircle(2,23,3);
  g.fillStyle(0xeecc22); g.fillCircle(2,23,1);
  // sword arm — extended forward at waist (swing follow-through)
  g.fillStyle(0x4a6d8c); g.fillRect(28,20,14,8);
  g.fillStyle(0x3a5a7a); g.fillRect(28,20,6,6);
  g.fillStyle(0xcc9900); g.fillRect(38,16,6,5);
  g.fillStyle(0x8b6914); g.fillRect(40,21,4,4);
  g.fillStyle(0xbbbbbb); g.fillRect(38,14,5,2);
  g.fillStyle(0xbbbbbb); g.fillRect(42,14,2,14);
  g.fillStyle(0xdddddd); g.fillRect(43,14,1,12);
  g.fillStyle(0x4a6d8c); g.fillRect(14,10,16,4);
  g.fillStyle(0x4a6d8c); g.fillRect(8,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(8,4,24,8);
  g.fillStyle(0x080808); g.fillRect(10,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(12,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(8,0,4,13); g.fillRect(28,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(8,0,24,3);
  g.generateTexture('knight_atk', 44, 60);
}
function drawKnightAtkFront(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(7,34,12,20); g.fillRect(23,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(9,34,4,18); g.fillRect(25,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(7,46,12,2); g.fillRect(23,46,12,2);
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  g.fillStyle(0x2d4a63); g.fillRect(6,31,10,4); g.fillRect(20,31,10,4);
  g.fillStyle(0xccaa00); g.fillRect(19,30,5,4);
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x3a5a7a); g.fillRect(10,14,24,16);
  g.fillStyle(0x5588aa); g.fillRect(10,14,24,4);
  g.fillStyle(0xccaa00); g.fillCircle(22,22,3);
  g.fillStyle(0x4a6d8c); g.fillRect(0,12,6,22);
  g.fillStyle(0x2244aa); g.fillRect(0,12,4,24);
  g.fillStyle(0x4466cc); g.fillRect(1,13,2,20);
  g.fillStyle(0xccaa00); g.fillCircle(1,23,2);
  // right arm lowered, sword thrust down-forward (foreshortened)
  g.fillStyle(0x4a6d8c); g.fillRect(36,22,8,12);
  g.fillStyle(0xcc9900); g.fillRect(34,32,10,4);
  g.fillStyle(0xbbbbbb); g.fillRect(38,34,4,8);
  g.fillStyle(0xdddddd); g.fillRect(40,34,1,7);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,4,24,8);
  g.fillStyle(0x080808); g.fillRect(12,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(14,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_atk_front', 44, 60);
}
function drawKnightAtkBack(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(7,34,12,20); g.fillRect(23,34,12,20);
  g.fillStyle(0x1a2d3d); g.fillRect(7,46,12,2); g.fillRect(23,46,12,2);
  g.fillStyle(0x111111); g.fillRect(4,30,36,6);
  g.fillStyle(0x4a6d8c); g.fillRect(4,12,36,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,24,16);
  g.fillStyle(0x1a2d3d); g.fillRect(20,14,4,16);
  // sword arm raised high (upswing), shield arm normal
  g.fillStyle(0x4a6d8c); g.fillRect(0,12,6,22); g.fillRect(36,6,8,16);
  g.fillStyle(0x2244aa); g.fillRect(0,14,4,22);
  g.fillStyle(0xccaa00); g.fillRect(1,20,2,4);
  g.fillStyle(0xcc9900); g.fillRect(34,4,10,5);
  g.fillStyle(0xbbbbbb); g.fillRect(40,0,3,6);
  g.fillStyle(0xdddddd); g.fillRect(42,0,1,5);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x4a6d8c); g.fillRect(10,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(10,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(20,0,4,12);
  g.fillStyle(0x3a5a7a); g.fillRect(10,0,4,13); g.fillRect(30,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(10,0,24,3);
  g.generateTexture('knight_atk_back', 44, 60);
}
function drawKnightAtkFSide(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,34,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,45,10,2); g.fillRect(22,46,12,2);
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  g.fillStyle(0x2d4a63); g.fillRect(8,31,8,4); g.fillRect(20,31,10,4);
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(6,14,8,16);
  g.fillStyle(0x3a5a7a); g.fillRect(14,14,20,16);
  g.fillStyle(0x5588aa); g.fillRect(18,14,16,4);
  g.fillStyle(0x2244aa); g.fillRect(2,12,6,24);
  g.fillStyle(0x4466cc); g.fillRect(3,13,3,20);
  g.fillStyle(0xccaa00); g.fillCircle(4,23,2);
  // near arm — extended in swing
  g.fillStyle(0x4a6d8c); g.fillRect(34,20,10,8);
  g.fillStyle(0x3a5a7a); g.fillRect(34,20,5,6);
  g.fillStyle(0xcc9900); g.fillRect(40,16,5,5);
  g.fillStyle(0x8b6914); g.fillRect(41,21,3,4);
  g.fillStyle(0xbbbbbb); g.fillRect(40,14,4,2);
  g.fillStyle(0xbbbbbb); g.fillRect(43,14,1,12);
  g.fillStyle(0xdddddd); g.fillRect(43,14,1,10);
  g.fillStyle(0x4a6d8c); g.fillRect(16,10,14,4);
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,4,24,8);
  g.fillStyle(0x080808); g.fillRect(11,5,20,5);
  g.fillStyle(0xffcc99); g.fillRect(16,6,16,3);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_atk_fside', 44, 60);
}
function drawKnightAtkBSide(g) {
  g.clear();
  g.fillStyle(0x1a2d3d); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x2d4a63); g.fillRect(9,34,10,16); g.fillRect(22,34,12,20);
  g.fillStyle(0x3a5a7a); g.fillRect(24,34,4,18);
  g.fillStyle(0x1a2d3d); g.fillRect(9,44,10,2); g.fillRect(22,46,12,2);
  g.fillStyle(0x111111); g.fillRect(6,30,30,6);
  g.fillStyle(0x4a6d8c); g.fillRect(6,12,30,20);
  g.fillStyle(0x2d4a63); g.fillRect(10,14,22,16);
  g.fillStyle(0x1a2d3d); g.fillRect(18,14,6,16);
  g.fillStyle(0x4a6d8c); g.fillRect(2,12,8,22);
  g.fillStyle(0x2d4a63); g.fillRect(2,14,6,18);
  g.fillStyle(0x2244aa); g.fillRect(2,14,4,22);
  g.fillStyle(0xccaa00); g.fillRect(3,20,2,4);
  // near arm raised (upswing from back-diagonal)
  g.fillStyle(0x4a6d8c); g.fillRect(34,6,8,16);
  g.fillStyle(0xcc9900); g.fillRect(36,4,8,5);
  g.fillStyle(0xbbbbbb); g.fillRect(41,0,3,6);
  g.fillStyle(0xdddddd); g.fillRect(43,0,1,5);
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  g.fillStyle(0x4a6d8c); g.fillRect(9,0,24,13);
  g.fillStyle(0x2d4a63); g.fillRect(9,2,24,10);
  g.fillStyle(0x1a2d3d); g.fillRect(19,0,6,12);
  g.fillStyle(0x3a5a7a); g.fillRect(9,0,4,13); g.fillRect(29,0,4,13);
  g.fillStyle(0x6688bb); g.fillRect(9,0,24,3);
  g.generateTexture('knight_atk_bside', 44, 60);
}

// ── GUNSLINGER attack variants ──────────────────────────────────
function drawGunslingerAtk(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(5,52,11,8); g.fillRect(18,52,11,8);
  g.fillStyle(0x5c3318); g.fillRect(18,52,4,6);
  g.fillStyle(0x3a5a7a); g.fillRect(5,34,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x4a6a8a); g.fillRect(19,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(18,42,10,8);
  g.fillStyle(0x222222); g.fillRect(20,44,6,6);
  g.fillStyle(0x9a6622); g.fillRect(2,30,28,6);
  g.fillStyle(0xccaa44); g.fillRect(16,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(2,12,28,20);
  g.fillStyle(0xffeedd); g.fillRect(8,13,12,17);
  g.fillStyle(0x9a6622); g.fillRect(2,12,4,20); g.fillRect(26,12,4,20);
  // gun arm fully extended at waist height
  g.fillStyle(0xcc8833); g.fillRect(28,20,16,6);
  g.fillStyle(0x9a6622); g.fillRect(28,20,4,5);
  g.fillStyle(0x333333); g.fillRect(38,17,8,5);
  g.fillStyle(0x555555); g.fillRect(39,15,7,5);
  g.fillStyle(0x222222); g.fillRect(43,19,4,3);
  // left arm
  g.fillStyle(0xcc8833); g.fillRect(0,12,4,22);
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  g.fillStyle(0x7a4a1a); g.fillRect(2,3,34,3);
  g.fillStyle(0x553311); g.fillRect(8,0,20,6);
  g.fillStyle(0x7a5533); g.fillRect(8,0,20,1);
  g.fillStyle(0x7a4a1a); g.fillRect(8,4,20,1);
  g.generateTexture('gunslinger_atk', 44, 60);
}
function drawGunslingerAtkFront(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(9,34,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(27,40,10,10);
  g.fillStyle(0x222222); g.fillRect(29,42,7,7);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  g.fillStyle(0xccaa44); g.fillRect(19,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  g.fillStyle(0x9a6622); g.fillRect(4,12,6,20); g.fillRect(34,12,6,20);
  // left arm normal, right arm forward (foreshortened) with gun face-on
  g.fillStyle(0xcc8833); g.fillRect(0,12,6,22); g.fillRect(36,18,8,8);
  g.fillStyle(0x333333); g.fillRect(37,16,8,6);
  g.fillStyle(0x555555); g.fillRect(38,14,7,5);
  g.fillStyle(0x222222); g.fillCircle(41,22,3);
  g.fillStyle(0x444444); g.fillCircle(41,22,1);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,24,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_atk_front', 44, 60);
}
function drawGunslingerAtkBack(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(4,30,36,6);
  g.fillStyle(0xcc8833); g.fillRect(4,12,36,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,24,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,8,17);
  // left arm normal, right arm raised with gun pointed up
  g.fillStyle(0xcc8833); g.fillRect(0,12,6,22); g.fillRect(36,8,8,16);
  g.fillStyle(0x333333); g.fillRect(36,6,10,4);
  g.fillStyle(0x555555); g.fillRect(38,4,8,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,36,3);
  g.fillStyle(0x553311); g.fillRect(10,0,24,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,16,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,24,1);
  g.generateTexture('gunslinger_atk_back', 44, 60);
}
function drawGunslingerAtkFSide(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x4a6a8a); g.fillRect(24,34,4,16);
  g.fillStyle(0x3d2010); g.fillRect(24,40,8,8);
  g.fillStyle(0x222222); g.fillRect(26,42,5,5);
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  g.fillStyle(0xccaa44); g.fillRect(20,31,6,4);
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0x9a6622); g.fillRect(6,12,4,20);
  g.fillStyle(0xffeedd); g.fillRect(14,13,16,17);
  g.fillStyle(0xcc8833); g.fillRect(2,12,6,22);
  g.fillStyle(0x9a6622); g.fillRect(2,14,4,18);
  // near arm — gun fully extended
  g.fillStyle(0xcc8833); g.fillRect(34,20,10,6);
  g.fillStyle(0x333333); g.fillRect(40,17,6,5);
  g.fillStyle(0x555555); g.fillRect(40,15,6,5);
  g.fillStyle(0x222222); g.fillRect(43,21,4,3);
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x7a5533); g.fillRect(10,0,22,1);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_atk_fside', 44, 60);
}
function drawGunslingerAtkBSide(g) {
  g.clear();
  g.fillStyle(0x3d2010); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x3a5a7a); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x9a6622); g.fillRect(6,30,30,6);
  g.fillStyle(0xcc8833); g.fillRect(6,12,30,20);
  g.fillStyle(0xaa7030); g.fillRect(10,13,22,17);
  g.fillStyle(0x8a4a18); g.fillRect(18,13,6,17);
  g.fillStyle(0xcc8833); g.fillRect(2,12,8,22);
  g.fillStyle(0x9a6622); g.fillRect(2,14,6,18);
  // near arm raised (shooting upward from back-diagonal)
  g.fillStyle(0xcc8833); g.fillRect(34,8,8,16);
  g.fillStyle(0x333333); g.fillRect(36,6,8,4);
  g.fillStyle(0x555555); g.fillRect(38,4,7,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  g.fillStyle(0x7a4a1a); g.fillRect(4,3,34,3);
  g.fillStyle(0x553311); g.fillRect(10,0,22,6);
  g.fillStyle(0x3d2010); g.fillRect(14,1,14,4);
  g.fillStyle(0x7a4a1a); g.fillRect(10,4,22,1);
  g.generateTexture('gunslinger_atk_bside', 44, 60);
}

// ── ARCHITECT attack variants ────────────────────────────────────
function drawArchitectAtk(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(5,52,11,8); g.fillRect(18,52,11,8);
  g.fillStyle(0x444444); g.fillRect(18,52,4,6);
  g.fillStyle(0x334477); g.fillRect(5,34,11,18); g.fillRect(18,34,11,18);
  g.fillStyle(0x445588); g.fillRect(19,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(2,30,28,6);
  g.fillStyle(0xaaaaaa); g.fillRect(4,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(8,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(12,29,3,5);
  g.fillStyle(0x3a9a55); g.fillRect(2,12,28,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,12,16);
  g.fillStyle(0xffcc00); g.fillRect(2,12,4,4); g.fillRect(26,12,4,4);
  g.fillStyle(0x3a9a55); g.fillRect(0,12,4,22);
  // right arm + wrench — arm horizontal, wrench swung forward
  g.fillStyle(0x3a9a55); g.fillRect(28,18,14,8);
  g.fillStyle(0x777777); g.fillRect(36,14,7,5);
  g.fillStyle(0x999999); g.fillRect(37,19,4,12);
  g.fillStyle(0xbbbbbb); g.fillRect(37,19,2,10);
  g.fillStyle(0x555555); g.fillRect(36,13,7,2);
  g.fillStyle(0x555555); g.fillRect(36,17,2,2); g.fillRect(40,17,2,2);
  g.fillStyle(0xffcc99); g.fillRect(14,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(10,4,18,8);
  g.fillStyle(0x222222); g.fillRect(6,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(6,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(6,0,26,2);
  g.fillStyle(0x666600); g.fillRect(6,4,26,2);
  g.generateTexture('architect_atk', 44, 60);
}
function drawArchitectAtkFront(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x445588); g.fillRect(9,34,4,16); g.fillRect(25,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  g.fillStyle(0x44aaff); g.fillRect(20,29,3,5);
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(16,13,12,17);
  g.fillStyle(0xffcc00); g.fillRect(3,11,8,4); g.fillRect(33,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(5,19,5,2); g.fillRect(34,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(0,12,6,22);
  // right arm raised, wrench swung overhead
  g.fillStyle(0x3a9a55); g.fillRect(36,6,8,20);
  g.fillStyle(0x777777); g.fillRect(34,4,9,5);
  g.fillStyle(0x999999); g.fillRect(38,9,4,14);
  g.fillStyle(0xbbbbbb); g.fillRect(38,9,2,12);
  g.fillStyle(0x555555); g.fillRect(34,3,9,2);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0xffcc99); g.fillRect(12,4,20,8);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xeeee44); g.fillRect(8,0,28,2);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_atk_front', 44, 60);
}
function drawArchitectAtkBack(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(7,52,12,8); g.fillRect(23,52,12,8);
  g.fillStyle(0x334477); g.fillRect(7,34,12,18); g.fillRect(23,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(4,30,36,6);
  g.fillStyle(0x3a9a55); g.fillRect(4,12,36,20);
  g.fillStyle(0x1a5533); g.fillRect(10,13,24,17);
  g.fillStyle(0xffcc00); g.fillRect(4,11,8,4); g.fillRect(32,11,8,4);
  g.fillStyle(0xffcc00); g.fillRect(6,19,5,2); g.fillRect(33,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(0,12,6,22);
  // right arm raised from behind, wrench overhead
  g.fillStyle(0x3a9a55); g.fillRect(36,6,8,16);
  g.fillStyle(0x999999); g.fillRect(38,4,4,4);
  g.fillStyle(0x777777); g.fillRect(34,2,10,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,10,4);
  g.fillStyle(0x222222); g.fillRect(8,3,28,3);
  g.fillStyle(0xddcc22); g.fillRect(8,0,28,6);
  g.fillStyle(0xaa9900); g.fillRect(10,1,24,4);
  g.fillStyle(0x666600); g.fillRect(8,4,28,2);
  g.generateTexture('architect_atk_back', 44, 60);
}
function drawArchitectAtkFSide(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x445588); g.fillRect(24,34,4,16);
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  g.fillStyle(0xaaaaaa); g.fillRect(8,29,3,5);
  g.fillStyle(0xcc8833); g.fillRect(14,29,3,5);
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(8,14,10,16);
  g.fillStyle(0x4dbb66); g.fillRect(18,14,16,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(22,19,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(2,12,6,22);
  g.fillStyle(0x1a5533); g.fillRect(2,14,4,18);
  // near arm — wrench swung forward
  g.fillStyle(0x3a9a55); g.fillRect(34,18,10,8);
  g.fillStyle(0x777777); g.fillRect(40,14,6,5);
  g.fillStyle(0x999999); g.fillRect(41,19,3,12);
  g.fillStyle(0xbbbbbb); g.fillRect(41,19,2,10);
  g.fillStyle(0x555555); g.fillRect(40,13,5,2);
  g.fillStyle(0xffcc99); g.fillRect(16,10,14,4);
  g.fillStyle(0xffcc99); g.fillRect(14,4,20,8);
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xeeee44); g.fillRect(7,0,26,2);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_atk_fside', 44, 60);
}
function drawArchitectAtkBSide(g) {
  g.clear();
  g.fillStyle(0x222222); g.fillRect(9,50,10,10); g.fillRect(22,52,12,8);
  g.fillStyle(0x334477); g.fillRect(9,34,10,16); g.fillRect(22,34,12,18);
  g.fillStyle(0x8b6914); g.fillRect(6,30,30,6);
  g.fillStyle(0x3a9a55); g.fillRect(6,12,30,20);
  g.fillStyle(0x1a5533); g.fillRect(10,14,22,16);
  g.fillStyle(0x2a7a45); g.fillRect(18,14,6,16);
  g.fillStyle(0xffcc00); g.fillRect(6,11,6,4); g.fillRect(30,11,6,4);
  g.fillStyle(0xffcc00); g.fillRect(8,20,5,2); g.fillRect(23,20,5,2);
  g.fillStyle(0x3a9a55); g.fillRect(2,12,8,22);
  g.fillStyle(0x1a5533); g.fillRect(2,14,6,18);
  // near arm raised (overhead swing from back-diagonal)
  g.fillStyle(0x3a9a55); g.fillRect(34,6,8,16);
  g.fillStyle(0x999999); g.fillRect(38,4,4,4);
  g.fillStyle(0x777777); g.fillRect(34,2,10,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,8,4);
  g.fillStyle(0x222222); g.fillRect(7,3,26,3);
  g.fillStyle(0xddcc22); g.fillRect(7,0,26,6);
  g.fillStyle(0xaa9900); g.fillRect(9,1,22,4);
  g.fillStyle(0x666600); g.fillRect(7,4,26,2);
  g.generateTexture('architect_atk_bside', 44, 60);
}

// ── CHARMER (Lauren) attack variants — all show pirouette arms-out spin ──
function _drawLaurenAtkPose(g, key) {
  g.clear();
  g.fillStyle(0x774455); g.fillRect(9,52,10,8); g.fillRect(25,52,10,8);
  g.fillStyle(0xbb6699); g.fillRect(1,44,42,8);
  g.fillStyle(0xd988bb); g.fillRect(3,36,38,14);
  g.fillStyle(0xeeccdd); g.fillRect(7,34,30,6);
  g.fillStyle(0xcc77aa); g.fillRect(3,50,38,2);
  g.fillStyle(0xff99bb); g.fillRect(16,32,12,5);
  g.fillStyle(0xff77aa); g.fillRect(20,28,4,6);
  g.fillStyle(0x9966aa); g.fillRect(12,14,20,20);
  g.fillStyle(0x775588); g.fillRect(12,14,4,18);
  g.fillStyle(0xbb88cc); g.fillRect(16,14,10,6);
  // arms extended wide (spinning)
  g.fillStyle(0xffcc99); g.fillRect(0,16,10,8);
  g.fillStyle(0xffcc99); g.fillRect(34,16,10,8);
  g.fillStyle(0xffcc99); g.fillRect(18,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(14,4,16,8);
  g.fillStyle(0xcc8844); g.fillRect(12,0,20,8);
  g.fillStyle(0xdd9955); g.fillRect(12,0,20,3);
  g.fillStyle(0xcc8844); g.fillRect(8,4,6,10);
  g.fillStyle(0xcc8844); g.fillRect(30,4,6,10);
  g.generateTexture(key, 44, 60);
}
function drawLaurenAtk(g)      { _drawLaurenAtkPose(g, 'charmer_atk'); }
function drawLaurenAtkFront(g) { _drawLaurenAtkPose(g, 'charmer_atk_front'); }
function drawLaurenAtkBack(g)  { _drawLaurenAtkPose(g, 'charmer_atk_back'); }
function drawLaurenAtkFSide(g) { _drawLaurenAtkPose(g, 'charmer_atk_fside'); }
function drawLaurenAtkBSide(g) { _drawLaurenAtkPose(g, 'charmer_atk_bside'); }

// ── RANGER (Abigail) attack variants ─────────────────────────────
function drawAbigailAtk(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(6,52,12,8); g.fillRect(19,52,12,8);
  g.fillStyle(0x3d3320); g.fillRect(19,52,4,6);
  g.fillStyle(0x334422); g.fillRect(6,34,12,18); g.fillRect(19,34,12,18);
  g.fillStyle(0x446633); g.fillRect(20,34,4,16);
  g.fillStyle(0x446622); g.fillRect(2,14,28,22);
  g.fillStyle(0x557733); g.fillRect(4,15,22,20);
  g.fillStyle(0x668844); g.fillRect(6,15,14,6);
  g.fillStyle(0x334411); g.fillRect(2,14,4,20); g.fillRect(26,14,4,20);
  g.fillStyle(0x8b5e3c); g.fillRect(2,32,28,4);
  g.fillStyle(0x6b3f1e); g.fillRect(14,31,6,5);
  // bow drawn forward (moved to center-left)
  g.fillStyle(0x8b5e3c); g.fillRect(18,4,4,52);
  g.fillStyle(0x7a4a28); g.fillRect(18,4,4,4); g.fillRect(18,52,4,4);
  g.fillStyle(0xddcc99); g.fillRect(20,4,1,52);
  // left (far) arm at bow
  g.fillStyle(0x557733); g.fillRect(0,14,4,22);
  g.fillStyle(0xffcc99); g.fillRect(0,26,4,8);
  // right arm — draw arm pulled back horizontally
  g.fillStyle(0x557733); g.fillRect(22,18,10,6);
  g.fillStyle(0xffcc99); g.fillRect(28,18,5,6);
  // nocked arrow
  g.fillStyle(0x886633); g.fillRect(18,22,12,2);
  g.fillStyle(0x446622); g.fillRect(18,21,3,4);
  g.fillStyle(0xffcc99); g.fillRect(14,10,10,6);
  g.fillStyle(0xffcc99); g.fillRect(10,4,14,8);
  g.fillStyle(0x446622); g.fillRect(8,0,20,12);
  g.fillStyle(0x334411); g.fillRect(8,0,4,10); g.fillRect(24,0,4,10);
  g.fillStyle(0x557733); g.fillRect(10,0,14,5);
  g.fillStyle(0x2d1f15); g.fillRect(10,6,10,6);
  g.generateTexture('ranger_atk', 44, 60);
}
function drawAbigailAtkFront(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(8,52,12,8); g.fillRect(24,52,12,8);
  g.fillStyle(0x334422); g.fillRect(8,34,12,18); g.fillRect(24,34,12,18);
  g.fillStyle(0x446633); g.fillRect(10,34,4,16); g.fillRect(26,34,4,16);
  g.fillStyle(0x446622); g.fillRect(4,14,36,22);
  g.fillStyle(0x557733); g.fillRect(8,15,28,20);
  g.fillStyle(0x668844); g.fillRect(10,15,20,6);
  g.fillStyle(0x334411); g.fillRect(4,14,5,20); g.fillRect(35,14,5,20);
  g.fillStyle(0x8b5e3c); g.fillRect(4,32,36,4);
  g.fillStyle(0x6b3f1e); g.fillRect(19,31,6,5);
  // bow in draw position (right side, slightly forward)
  g.fillStyle(0x8b5e3c); g.fillRect(39,4,4,52);
  g.fillStyle(0x7a4a28); g.fillRect(39,4,4,4); g.fillRect(39,52,4,4);
  g.fillStyle(0xddcc99); g.fillRect(41,4,1,52);
  // left arm extended forward to bow
  g.fillStyle(0x557733); g.fillRect(0,16,5,22);
  g.fillStyle(0xffcc99); g.fillRect(0,28,5,8);
  // right arm (draw arm) pulled back at shoulder
  g.fillStyle(0x557733); g.fillRect(34,16,6,10);
  g.fillStyle(0xffcc99); g.fillRect(34,20,5,6);
  // arrow foreshortened (nocked, points toward viewer)
  g.fillStyle(0x886633); g.fillRect(36,22,6,2);
  g.fillStyle(0x446622); g.fillRect(38,20,3,4);
  g.fillStyle(0xffcc99); g.fillRect(18,10,8,6);
  g.fillStyle(0xffcc99); g.fillRect(14,4,16,8);
  g.fillStyle(0x446622); g.fillRect(10,0,24,13);
  g.fillStyle(0x334411); g.fillRect(10,0,5,12); g.fillRect(29,0,5,12);
  g.fillStyle(0x557733); g.fillRect(13,0,18,5);
  g.fillStyle(0x2d1f15); g.fillRect(15,6,14,6);
  g.generateTexture('ranger_atk_front', 44, 60);
}
function drawAbigailAtkBack(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(8,52,12,8); g.fillRect(24,52,12,8);
  g.fillStyle(0x334422); g.fillRect(8,34,12,18); g.fillRect(24,34,12,18);
  g.fillStyle(0x446622); g.fillRect(4,14,36,22);
  g.fillStyle(0x557733); g.fillRect(8,15,28,20);
  g.fillStyle(0x334411); g.fillRect(4,14,5,20); g.fillRect(35,14,5,20);
  g.fillStyle(0x334411); g.fillRect(20,14,4,20);
  // quiver on back
  g.fillStyle(0x8b5e3c); g.fillRect(2,14,6,22);
  g.fillStyle(0x7a4a28); g.fillRect(2,14,6,4);
  g.fillStyle(0xddcc99); g.fillRect(3,8,2,10); g.fillRect(6,8,2,10);
  g.fillStyle(0x8b5e3c); g.fillRect(4,32,36,4);
  g.fillStyle(0x6b3f1e); g.fillRect(19,31,6,5);
  // left arm (bow arm) extended up-forward
  g.fillStyle(0x557733); g.fillRect(0,16,5,22);
  // right arm (draw arm) pulled far back
  g.fillStyle(0x557733); g.fillRect(39,16,5,10);
  g.fillStyle(0xffcc99); g.fillRect(39,20,5,6);
  // arrow drawn back, tip visible at right edge
  g.fillStyle(0x886633); g.fillRect(34,22,9,2);
  g.fillStyle(0xffcc99); g.fillRect(18,10,8,6);
  g.fillStyle(0x446622); g.fillRect(10,0,24,13);
  g.fillStyle(0x334411); g.fillRect(10,0,5,12); g.fillRect(29,0,5,12);
  g.fillStyle(0x2d1f15); g.fillRect(14,6,16,8);
  g.fillStyle(0x443322); g.fillRect(16,2,12,6);
  g.generateTexture('ranger_atk_back', 44, 60);
}
function drawAbigailAtkFSide(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(8,52,12,8); g.fillRect(22,53,10,7);
  g.fillStyle(0x334422); g.fillRect(8,34,12,18); g.fillRect(22,35,10,17);
  g.fillStyle(0x446633); g.fillRect(10,34,4,16);
  g.fillStyle(0x446622); g.fillRect(4,14,34,22);
  g.fillStyle(0x557733); g.fillRect(7,15,26,20);
  g.fillStyle(0x668844); g.fillRect(9,15,16,6);
  g.fillStyle(0x334411); g.fillRect(4,14,4,20); g.fillRect(34,14,4,20);
  g.fillStyle(0x8b5e3c); g.fillRect(4,32,34,4);
  g.fillStyle(0x6b3f1e); g.fillRect(17,31,6,5);
  // bow drawn (moved forward to center)
  g.fillStyle(0x8b5e3c); g.fillRect(20,4,4,52);
  g.fillStyle(0x7a4a28); g.fillRect(20,4,4,4); g.fillRect(20,52,4,4);
  g.fillStyle(0xddcc99); g.fillRect(22,4,1,52);
  // far arm at bow
  g.fillStyle(0x557733); g.fillRect(0,16,5,22);
  g.fillStyle(0xffcc99); g.fillRect(0,28,5,8);
  // near arm pulled back (draw arm)
  g.fillStyle(0x557733); g.fillRect(22,18,12,6);
  g.fillStyle(0xffcc99); g.fillRect(30,18,6,6);
  // arrow
  g.fillStyle(0x886633); g.fillRect(20,22,14,2);
  g.fillStyle(0x446622); g.fillRect(20,21,3,4);
  g.fillStyle(0xffcc99); g.fillRect(17,10,9,6);
  g.fillStyle(0xffcc99); g.fillRect(13,4,14,8);
  g.fillStyle(0x446622); g.fillRect(10,0,22,13);
  g.fillStyle(0x334411); g.fillRect(10,0,5,12); g.fillRect(28,0,4,12);
  g.fillStyle(0x557733); g.fillRect(13,0,16,5);
  g.fillStyle(0x2d1f15); g.fillRect(14,6,12,6);
  g.generateTexture('ranger_atk_fside', 44, 60);
}
function drawAbigailAtkBSide(g) {
  g.clear();
  g.fillStyle(0x222211); g.fillRect(8,52,12,8); g.fillRect(23,52,10,8);
  g.fillStyle(0x334422); g.fillRect(8,34,12,18); g.fillRect(23,34,10,18);
  g.fillStyle(0x446622); g.fillRect(4,14,34,22);
  g.fillStyle(0x557733); g.fillRect(7,15,24,20);
  g.fillStyle(0x334411); g.fillRect(4,14,4,20); g.fillRect(34,14,4,20);
  g.fillStyle(0x334411); g.fillRect(18,14,3,20);
  g.fillStyle(0x8b5e3c); g.fillRect(2,14,5,20);
  g.fillStyle(0xddcc99); g.fillRect(3,8,2,10); g.fillRect(6,8,2,10);
  g.fillStyle(0x8b5e3c); g.fillRect(4,32,34,4);
  g.fillStyle(0x6b3f1e); g.fillRect(17,31,6,5);
  // far arm (left, bow arm)
  g.fillStyle(0x557733); g.fillRect(0,16,5,22);
  // near arm (draw arm) pulled far back
  g.fillStyle(0x557733); g.fillRect(37,16,5,10);
  g.fillStyle(0xffcc99); g.fillRect(37,20,5,6);
  // arrow drawn back
  g.fillStyle(0x886633); g.fillRect(32,22,10,2);
  g.fillStyle(0xffcc99); g.fillRect(17,10,9,6);
  g.fillStyle(0x446622); g.fillRect(10,0,22,13);
  g.fillStyle(0x334411); g.fillRect(10,0,5,12); g.fillRect(28,0,4,12);
  g.fillStyle(0x2d1f15); g.fillRect(13,6,14,8);
  g.fillStyle(0x443322); g.fillRect(15,2,12,6);
  g.generateTexture('ranger_atk_bside', 44, 60);
}

