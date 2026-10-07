'use strict';
// ── src/textures.js — Procedural texture generation (no image files) ─────────
// Globals exported: drawWolf, drawRat, drawBear, drawIceCrawler,
//                   drawSpiderRuins, drawBogLurker, drawDustHound, drawWaterLurker,
//                   drawRiverFrame, drawEdgeVariants, buildTextures, buildAtlases, makeScaleProxy
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

// Edge autotiles: a border onto a neighbouring terrain, one 32 px variant per entry of EDGE_MASKS,
// side by side on one canvas, transparent where the tile's own ground shows. Mask bits: the sides
// that touch the neighbour (1=N, 2=E, 4=S, 8=W) and the lone corners, whose cell touches it only
// diagonally (16=NE, 32=SE, 64=SW, 128=NW; a corner counts only when both its sides are clear,
// which leaves 47 masks). The neighbour `fill` reaches R px in along each such side and in a
// radius-R quarter circle round each lone corner, so tiles join and convex corners come out round;
// a line of `fill` (lightened by `line`, 0 for none) and a band of `rim` follow it. Shorelines use it
// (water, mud), and biome edges use only its alpha, recoloured with the neighbour's ground.
const EDGE_MASKS = [...Array(256).keys()].filter(m =>
  [[16, 1, 2], [32, 4, 2], [64, 4, 8], [128, 1, 8]].every(([c, a, b]) => !(m & c) || !(m & (a | b))));
function drawEdgeVariants(fill, rim, line = 0.45) {
  const R = 6, N = EDGE_MASKS.length, cv = document.createElement('canvas');
  cv.width = N * 32; cv.height = 32;
  const c2 = cv.getContext('2d'), img = c2.createImageData(N * 32, 32), px = img.data;
  const corners = [[16, 32, 0], [32, 32, 32], [64, 0, 32], [128, 0, 0]]; // bit, x, y
  const lit = (c, k) => Math.round(c + (255 - c) * k);
  const put = (i, c, a, k = 0) => {
    px[i] = lit(c >> 16, k); px[i + 1] = lit((c >> 8) & 255, k); px[i + 2] = lit(c & 255, k); px[i + 3] = a * 255;
  };
  EDGE_MASKS.forEach((m, v) => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    let d = Infinity;
    if (m & 1) d = Math.min(d, cy);
    if (m & 2) d = Math.min(d, 32 - cx);
    if (m & 4) d = Math.min(d, 32 - cy);
    if (m & 8) d = Math.min(d, cx);
    for (const [bit, ax, ay] of corners) if (m & bit) d = Math.min(d, Math.hypot(cx - ax, cy - ay));
    const i = (y * N * 32 + v * 32 + x) * 4;
    if (d < R) put(i, fill, 0.92);
    else if (d < R + 1.5) put(i, fill, 0.7, line); // light line at the edge
    else if (d < R + 5) put(i, rim, 0.45);
  } });
  c2.putImageData(img, 0, 0);
  return cv;
}

// Enemy textures are drawn at the same pixel density as the player sprites
// (shown at roughly 1× world scale per texture pixel ×1.5), so their display
// scales in ENEMY_STATS / game-scene.js are half what they were at the old size.
// Heads face RIGHT; the game flips X to face left. Light comes from the top-left.

function drawWolf(g) {
  // Grey wolf, 40×24.
  g.clear();
  // ── TAIL: bushy, raised, pale tip (far left) ──
  g.fillStyle(0x666677); g.fillRect(2, 6, 6, 6);
  g.fillStyle(0x777788); g.fillRect(1, 4, 6, 5);
  g.fillStyle(0xddddee); g.fillRect(0, 4, 4, 4);             // pale tip
  g.fillStyle(0xffffff); g.fillRect(0, 4, 2, 2);             // tip highlight
  // ── LEGS: far pair darker, near pair lit on the front edge ──
  g.fillStyle(0x666677); g.fillRect(14, 16, 4, 5); g.fillRect(28, 16, 4, 5);   // far legs
  g.fillStyle(0x555566); g.fillRect(14, 21, 5, 2); g.fillRect(28, 21, 5, 2);   // far paws
  g.fillStyle(0x777788); g.fillRect(6, 16, 4, 5); g.fillRect(20, 16, 4, 5);    // near legs
  g.fillStyle(0x8a8a9b); g.fillRect(6, 16, 1, 4); g.fillRect(20, 16, 1, 4);    // leg highlight
  g.fillStyle(0x5a5a6a); g.fillRect(6, 21, 5, 2); g.fillRect(20, 21, 5, 2);    // near paws
  g.fillStyle(0xddddcc);                                                         // claws
  g.fillRect(10, 22, 1, 1); g.fillRect(18, 22, 1, 1); g.fillRect(24, 22, 1, 1); g.fillRect(32, 22, 1, 1);
  // ── BODY: lean torso, lit back, shaded underside ──
  g.fillStyle(0x888899); g.fillRect(5, 6, 25, 12); g.fillRect(4, 8, 28, 8);
  g.fillStyle(0xa0a0b0); g.fillRect(6, 6, 22, 3);             // lit back
  g.fillStyle(0xb4b4c4); g.fillRect(8, 6, 14, 1);             // top-light rim
  g.fillStyle(0x6c6c7c); g.fillRect(7, 15, 22, 3);            // shaded belly
  g.fillStyle(0x5c5c6c); g.fillRect(10, 17, 16, 1);           // belly underside
  g.fillStyle(0x7a7a8a); g.fillRect(4, 9, 7, 8);              // haunch over the hind leg
  g.fillStyle(0x9a9aaa); g.fillRect(5, 9, 4, 2);              // haunch highlight
  // fur strands: dark streaks swept toward the tail, pale flecks on the back
  g.fillStyle(0x76768a);
  g.fillRect(12, 10, 3, 1); g.fillRect(17, 11, 3, 1); g.fillRect(22, 10, 3, 1);
  g.fillRect(14, 13, 3, 1); g.fillRect(20, 13, 2, 1); g.fillRect(9, 12, 2, 1);
  g.fillStyle(0xb0b0c0);
  g.fillRect(11, 8, 2, 1); g.fillRect(15, 8, 2, 1); g.fillRect(21, 8, 2, 1);
  // chest ruff: pale fur at the front of the body
  g.fillStyle(0xa8a8b8); g.fillRect(27, 10, 5, 7);
  g.fillStyle(0xc4c4d4); g.fillRect(28, 11, 2, 3);
  // ── HEAD ──
  g.fillStyle(0x666677); g.fillTriangle(27, 6, 29, 0, 32, 6); // back ear
  g.fillStyle(0x777788); g.fillTriangle(30, 6, 33, 0, 36, 6); // front ear
  g.fillStyle(0x4a4a58); g.fillTriangle(32, 5, 33, 2, 34, 5); // inner ear
  g.fillStyle(0x9999aa); g.fillRect(26, 4, 9, 10);            // skull
  g.fillStyle(0xb0b0c0); g.fillRect(27, 4, 7, 2);             // lit crown
  g.fillStyle(0x7d7d8e); g.fillRect(27, 11, 8, 3);            // cheek / jaw shade
  // snout
  g.fillStyle(0xbbbbcc); g.fillRect(34, 6, 5, 6);
  g.fillStyle(0xd4d4e2); g.fillRect(34, 6, 4, 1);             // bridge highlight
  g.fillStyle(0x9999aa); g.fillRect(34, 11, 4, 1);            // under-jaw
  g.fillStyle(0x444455); g.fillRect(34, 10, 4, 1);            // mouth line
  g.fillStyle(0x222222); g.fillRect(37, 6, 2, 2);             // nose
  g.fillStyle(0x555555); g.fillRect(37, 6, 1, 1);             // nose glint
  g.fillStyle(0xffffff); g.fillRect(36, 11, 1, 1);            // fang
  // eye: red, hot glint, heavy brow
  g.fillStyle(0x555566); g.fillRect(30, 4, 4, 1);             // brow
  g.fillStyle(0xff4400); g.fillRect(31, 5, 2, 2);
  g.fillStyle(0xffcc88); g.fillRect(31, 5, 1, 1);
  g.generateTexture('wolf', 40, 24);
}

function drawRat(g) {
  // Giant rat, 30×18.
  g.clear();
  // ── TAIL: long, pink, curling down-left ──
  g.fillStyle(0xcc8866); g.fillRect(4, 7, 4, 2); g.fillRect(1, 8, 4, 2); g.fillRect(0, 10, 2, 2);
  g.fillStyle(0xddaa88); g.fillRect(4, 7, 3, 1); g.fillRect(1, 8, 2, 1);   // lit top edge
  g.fillStyle(0xaa6655); g.fillRect(2, 9, 3, 1); g.fillRect(0, 11, 2, 1);  // shaded underside
  // ── LEGS: far legs darker, pink feet, pale claws ──
  g.fillStyle(0x6b4220); g.fillRect(12, 12, 3, 4); g.fillRect(21, 12, 3, 4);   // far legs
  g.fillStyle(0x8b5a2b); g.fillRect(7, 12, 4, 4); g.fillRect(17, 12, 3, 4);    // near legs
  g.fillStyle(0xcc8866);                                                         // feet
  g.fillRect(7, 15, 5, 1); g.fillRect(12, 15, 4, 1); g.fillRect(17, 15, 4, 1); g.fillRect(21, 15, 4, 1);
  g.fillStyle(0xeeddcc); g.fillRect(11, 16, 1, 1); g.fillRect(20, 16, 1, 1); g.fillRect(24, 16, 1, 1);
  // ── BODY: hunched and round ──
  g.fillStyle(0x8b5a2b); g.fillEllipse(15, 9, 21, 11);
  g.fillStyle(0xa06a38); g.fillEllipse(14, 7, 16, 5);         // lit back
  g.fillStyle(0xb47c44); g.fillRect(10, 5, 7, 1);             // top-light rim
  g.fillStyle(0x6b4220); g.fillEllipse(15, 13, 16, 3);        // shaded belly
  g.fillStyle(0x7a4e24); g.fillEllipse(9, 10, 7, 6);          // haunch
  g.fillStyle(0x9a6634); g.fillRect(7, 8, 3, 1);              // haunch highlight
  g.fillStyle(0x6b4220);                                      // matted fur flecks
  g.fillRect(12, 9, 2, 1); g.fillRect(16, 8, 2, 1); g.fillRect(19, 10, 2, 1); g.fillRect(14, 11, 1, 1);
  g.fillStyle(0xc08a55); g.fillRect(13, 6, 1, 1); g.fillRect(17, 6, 1, 1);
  // ── HEAD: tapered snout ──
  g.fillStyle(0xaa7744); g.fillEllipse(23, 8, 9, 8);
  g.fillTriangle(24, 4, 24, 11, 29, 9);                       // snout wedge
  g.fillStyle(0xc08a55); g.fillRect(21, 4, 5, 2);             // lit crown
  g.fillStyle(0x8b5a2b); g.fillRect(21, 10, 6, 2);            // jaw shade
  g.fillStyle(0xaa7744); g.fillCircle(20, 3, 3);              // ear
  g.fillStyle(0xff9999); g.fillCircle(20, 3, 2);              // pink inner ear
  g.fillStyle(0xffcccc); g.fillRect(19, 2, 1, 1);
  g.fillStyle(0xff4400); g.fillRect(24, 5, 2, 2);             // eye
  g.fillStyle(0xffaa66); g.fillRect(24, 5, 1, 1);             // eye glint
  g.fillStyle(0x333333); g.fillRect(28, 8, 2, 2);             // nose
  g.fillStyle(0xffffee); g.fillRect(27, 10, 1, 2);            // buck teeth
  g.fillStyle(0xccbbaa); g.fillRect(25, 9, 2, 1); g.fillRect(25, 11, 2, 1); // whiskers
  g.generateTexture('rat', 30, 18);
}

function drawBear(g) {
  // Brown bear, 48×36: shoulder hump, heavy clawed paws.
  g.clear();
  // ── LEGS (behind the body): far pair in shadow ──
  g.fillStyle(0x4e2a14); g.fillRect(16, 26, 8, 6); g.fillRect(34, 26, 6, 6);   // far legs
  g.fillStyle(0x3a1e0e); g.fillRect(16, 31, 9, 3); g.fillRect(34, 31, 7, 3);   // far paws
  g.fillStyle(0x6b3a1f); g.fillRect(4, 26, 8, 6); g.fillRect(26, 26, 8, 6);    // near legs
  g.fillStyle(0x7d4826); g.fillRect(4, 26, 2, 5); g.fillRect(26, 26, 2, 5);    // lit edge
  g.fillStyle(0x4a2614); g.fillRect(4, 31, 9, 3); g.fillRect(26, 31, 9, 3);    // near paws
  g.fillStyle(0xddccaa);                                                         // claws
  g.fillRect(9, 34, 1, 1); g.fillRect(11, 34, 1, 1); g.fillRect(13, 33, 1, 1);
  g.fillRect(31, 34, 1, 1); g.fillRect(33, 34, 1, 1); g.fillRect(35, 33, 1, 1);
  // ── BODY ──
  g.fillStyle(0x6b3a1f); g.fillEllipse(21, 18, 38, 22); g.fillRect(4, 12, 34, 16);
  g.fillStyle(0x7a4526); g.fillEllipse(28, 11, 18, 10);       // shoulder hump
  g.fillStyle(0x8b5a2b); g.fillEllipse(18, 12, 28, 8);        // lit back
  g.fillStyle(0x9c6a3a); g.fillRect(10, 9, 14, 2); g.fillRect(25, 7, 7, 1); // top-light rim
  g.fillStyle(0x4e2a14); g.fillEllipse(21, 26, 32, 6);        // shaded belly
  g.fillStyle(0x5a3018); g.fillEllipse(6, 19, 6, 14);         // rump shade
  g.fillStyle(0x6b3a1f); g.fillRect(1, 12, 3, 3);             // stub tail
  g.fillStyle(0x5a3018);                                      // dark fur tufts
  g.fillRect(10, 15, 2, 1); g.fillRect(16, 17, 3, 1); g.fillRect(22, 14, 2, 1); g.fillRect(14, 20, 2, 1);
  g.fillRect(26, 19, 3, 1); g.fillRect(32, 16, 2, 1); g.fillRect(8, 20, 2, 1); g.fillRect(20, 21, 3, 1);
  g.fillStyle(0xa87444);                                      // sunlit tufts
  g.fillRect(12, 12, 2, 1); g.fillRect(19, 11, 2, 1); g.fillRect(27, 9, 2, 1); g.fillRect(31, 12, 2, 1);
  // ── HEAD ──
  g.fillStyle(0x6b3a1f); g.fillCircle(33, 3, 3); g.fillCircle(41, 3, 3);       // ears
  g.fillStyle(0x4e2a14); g.fillRect(32, 2, 2, 2); g.fillRect(40, 2, 2, 2);     // inner ears
  g.fillStyle(0x8b5a2b); g.fillEllipse(36, 12, 17, 16);       // skull
  g.fillStyle(0xa06a3a); g.fillEllipse(34, 9, 11, 6);         // lit brow
  g.fillStyle(0x6b3a1f); g.fillEllipse(35, 18, 14, 5);        // jaw shade
  g.fillStyle(0x7a4526); g.fillRect(28, 12, 3, 7);            // neck ruff
  g.fillStyle(0xcc9966); g.fillEllipse(42, 13, 9, 8);         // muzzle
  g.fillStyle(0xddb080); g.fillRect(39, 10, 5, 2);            // muzzle highlight
  g.fillStyle(0xaa7744); g.fillRect(39, 15, 6, 2);            // muzzle underside
  g.fillStyle(0x111111); g.fillRect(43, 10, 4, 3);            // nose
  g.fillStyle(0x555555); g.fillRect(43, 10, 1, 1);            // nose glint
  g.fillStyle(0x3a1e0e); g.fillRect(40, 15, 6, 1);            // mouth
  g.fillStyle(0xffffee); g.fillRect(44, 16, 1, 2);            // fang
  g.fillStyle(0x5a3018); g.fillRect(35, 6, 4, 1);             // brow
  g.fillStyle(0xff3300); g.fillRect(36, 7, 3, 2);             // eye
  g.fillStyle(0xffaa77); g.fillRect(36, 7, 1, 1);             // eye glint
  g.generateTexture('bear', 48, 36);
}

function drawIceCrawler(g) {
  // Ice crawler, 36×24: segmented frost beetle seen from above, head on the right.
  g.clear();
  // ── SIX LEGS (behind the shell), bent back toward the tail ──
  g.fillStyle(0x335577);
  g.fillRect(8, 16, 2, 4);  g.fillRect(6, 19, 2, 4);          // lower legs: thigh, then shin
  g.fillRect(14, 17, 2, 4); g.fillRect(12, 20, 2, 4);
  g.fillRect(20, 16, 2, 4); g.fillRect(18, 19, 2, 4);
  g.fillRect(8, 4, 2, 4);   g.fillRect(6, 1, 2, 4);           // upper legs mirror them
  g.fillRect(14, 3, 2, 4);  g.fillRect(12, 0, 2, 4);
  g.fillRect(20, 4, 2, 4);  g.fillRect(18, 1, 2, 4);
  g.fillStyle(0x5588aa);                                       // lit knee joints
  g.fillRect(6, 19, 1, 1); g.fillRect(12, 20, 1, 1); g.fillRect(18, 19, 1, 1);
  g.fillRect(6, 4, 1, 1);  g.fillRect(12, 3, 1, 1);  g.fillRect(18, 4, 1, 1);
  g.fillStyle(0xaaddff);                                       // icy claw tips
  g.fillRect(6, 22, 1, 1); g.fillRect(12, 23, 1, 1); g.fillRect(18, 22, 1, 1);
  g.fillRect(6, 1, 1, 1);  g.fillRect(12, 0, 1, 1);  g.fillRect(18, 1, 1, 1);
  // ── TAIL: pointed stinger on the left ──
  g.fillStyle(0x335577); g.fillTriangle(0, 12, 5, 9, 5, 15);
  g.fillStyle(0x4477aa); g.fillEllipse(6, 12, 6, 8);
  // ── SHELL: four plates, lit upper half, shaded lower half ──
  g.fillStyle(0x6699bb); g.fillEllipse(18, 12, 28, 12);
  g.fillStyle(0x88bbdd); g.fillEllipse(17, 10, 24, 5);        // lit upper shell
  g.fillStyle(0x4f80a8); g.fillEllipse(18, 15, 24, 4);        // shaded lower shell
  g.fillStyle(0x4477aa);                                       // plate seams
  g.fillRect(11, 7, 1, 10); g.fillRect(17, 6, 1, 12); g.fillRect(23, 7, 1, 10);
  g.fillStyle(0xaaddff);                                       // plate edge highlights
  g.fillRect(7, 8, 3, 1); g.fillRect(12, 7, 4, 1); g.fillRect(18, 7, 4, 1); g.fillRect(24, 8, 3, 1);
  g.fillStyle(0xcceeff);                                       // frost sparkles
  g.fillRect(9, 9, 1, 1); g.fillRect(15, 10, 1, 1); g.fillRect(20, 9, 1, 1); g.fillRect(26, 10, 1, 1);
  // ── HEAD (right) with mandibles ──
  g.fillStyle(0x335577);
  g.fillTriangle(32, 8, 36, 9, 32, 11);                        // upper mandible
  g.fillTriangle(32, 13, 36, 15, 32, 16);                      // lower mandible
  g.fillStyle(0xcceeff); g.fillRect(34, 9, 1, 1); g.fillRect(34, 15, 1, 1); // mandible tips
  g.fillStyle(0x4477aa); g.fillEllipse(30, 12, 8, 10);
  g.fillStyle(0x5588bb); g.fillEllipse(29, 10, 5, 4);         // lit head plate
  g.fillStyle(0xcceeff); g.fillRect(31, 9, 2, 2); g.fillRect(31, 14, 2, 2); // icy eyes
  g.fillStyle(0xffffff); g.fillRect(31, 9, 1, 1); g.fillRect(31, 14, 1, 1); // eye glints
  g.generateTexture('ice_crawler', 36, 24);
}

function drawSpiderRuins(g) {
  // Ruins spider, 32×24: seen from above, head at the TOP, 4 jointed legs per side.
  g.clear();
  // ── LEGS: inner segment rises to a knee, outer segment drops to the foot ──
  const legY = [7, 11, 14, 17];
  g.fillStyle(0x2a0e38);
  for (const y of legY) {
    g.fillRect(4, y, 6, 2);  g.fillRect(2, y - 2, 3, 3);  g.fillRect(0, y - 1, 2, 5);   // left
    g.fillRect(22, y, 6, 2); g.fillRect(27, y - 2, 3, 3); g.fillRect(30, y - 1, 2, 5);  // right
  }
  g.fillStyle(0x5a2a6a);                                       // lit knees
  for (const y of legY) { g.fillRect(2, y - 2, 2, 1); g.fillRect(27, y - 2, 2, 1); }
  g.fillStyle(0x1a0626);                                       // dark feet
  for (const y of legY) { g.fillRect(0, y + 3, 2, 1); g.fillRect(30, y + 3, 2, 1); }
  // ── ABDOMEN ──
  g.fillStyle(0x3a1a4a); g.fillCircle(16, 13, 9);
  g.fillStyle(0x4a2260); g.fillCircle(14, 11, 6);             // lit upper-left
  g.fillStyle(0x2a0e38); g.fillEllipse(17, 19, 14, 5);        // shaded underside
  g.fillStyle(0x7a3a9a); g.fillTriangle(13, 14, 19, 14, 16, 19); // violet chevron marking
  g.fillStyle(0xcc44ff); g.fillRect(15, 15, 2, 1);
  g.fillStyle(0x6a3a7a); g.fillRect(11, 9, 2, 1); g.fillRect(10, 10, 1, 1); // sheen
  g.fillStyle(0x2a0e38);                                       // bristles
  g.fillRect(9, 15, 1, 1); g.fillRect(22, 13, 1, 1); g.fillRect(20, 18, 1, 1); g.fillRect(11, 18, 1, 1);
  // ── HEAD (cephalothorax) ──
  g.fillStyle(0x1a0626); g.fillCircle(16, 7, 6);             // dark waist separating head from abdomen
  g.fillStyle(0x5a2a6a); g.fillCircle(16, 7, 5);
  g.fillStyle(0x7a3a8a); g.fillCircle(15, 6, 3);              // lit crown
  g.fillStyle(0x1a0626); g.fillRect(14, 1, 1, 2); g.fillRect(17, 1, 1, 2); // fangs
  g.fillStyle(0xcc44ff);                                       // eyes: 2 large, 2 small
  g.fillRect(12, 5, 2, 2); g.fillRect(18, 5, 2, 2); g.fillRect(14, 4, 1, 1); g.fillRect(17, 4, 1, 1);
  g.fillStyle(0xffccff); g.fillRect(12, 5, 1, 1); g.fillRect(18, 5, 1, 1); // glints
  g.generateTexture('spider_ruins', 32, 24);
}

function drawBogLurker(g) {
  // Bog lurker, 40×28: wet slime mound, face on the right, drips at the base.
  g.clear();
  g.fillStyle(0x1a3a1a); g.fillEllipse(20, 16, 36, 20);      // body
  g.fillStyle(0x0a1e0a); g.fillEllipse(20, 23, 30, 8);       // shaded base
  g.fillRect(9, 24, 3, 4); g.fillRect(17, 25, 2, 3); g.fillRect(26, 24, 3, 4); g.fillRect(32, 23, 2, 3); // drips
  g.fillStyle(0x2a5a2a); g.fillEllipse(19, 13, 28, 12);      // upper mass
  g.fillStyle(0x3a7a3a); g.fillEllipse(16, 10, 16, 5);       // lit top
  g.fillStyle(0x5a9a5a); g.fillRect(12, 8, 4, 1); g.fillRect(11, 9, 2, 1); // wet shine
  g.fillStyle(0x8acc8a); g.fillRect(12, 8, 1, 1);
  g.fillStyle(0x10280f);                                     // mottling
  g.fillRect(24, 15, 3, 2); g.fillRect(10, 15, 2, 2); g.fillRect(30, 13, 2, 2); g.fillRect(19, 19, 3, 1);
  g.fillStyle(0x3a7a3a); g.fillCircle(8, 18, 2); g.fillCircle(32, 20, 2); // slime bumps
  g.fillStyle(0x5a9a5a); g.fillRect(7, 17, 1, 1); g.fillRect(31, 19, 1, 1);
  // ── FACE ──
  g.fillStyle(0x0a1e0a); g.fillRect(22, 17, 10, 2);         // mouth slit
  g.fillStyle(0x99aa77); g.fillRect(24, 17, 1, 1); g.fillRect(27, 17, 1, 1); g.fillRect(30, 17, 1, 1); // teeth
  g.fillStyle(0x44aa44, 0.3); g.fillRect(15, 9, 6, 6);      // eye glow
  g.fillStyle(0x44aa44); g.fillRect(16, 10, 4, 4); g.fillRect(22, 12, 2, 2); // eyes
  g.fillStyle(0x0a1e0a); g.fillRect(18, 11, 1, 2);          // slit pupil
  g.fillStyle(0xccffcc); g.fillRect(16, 10, 1, 1); g.fillRect(22, 12, 1, 1); // glints
  g.generateTexture('bog_lurker', 40, 28);
}

function drawDustHound(g) {
  // Dust hound, 36×24: lean, spotted, hyena-like, raised hackles.
  g.clear();
  // ── TAIL ──
  g.fillStyle(0xaa7733); g.fillRect(1, 7, 7, 3);
  g.fillStyle(0x886622); g.fillRect(0, 5, 3, 4);             // dark tuft
  g.fillStyle(0xcc9944); g.fillRect(3, 7, 4, 1);             // lit edge
  // ── LEGS: far pair darker ──
  g.fillStyle(0x775511); g.fillRect(12, 17, 3, 5); g.fillRect(25, 17, 3, 5);   // far legs
  g.fillStyle(0x553311); g.fillRect(12, 21, 4, 2); g.fillRect(25, 21, 4, 2);   // far paws
  g.fillStyle(0x886622); g.fillRect(8, 17, 4, 5); g.fillRect(21, 17, 3, 5);    // near legs
  g.fillStyle(0xaa8833); g.fillRect(8, 17, 1, 4); g.fillRect(21, 17, 1, 4);    // lit edge
  g.fillStyle(0x553311); g.fillRect(8, 21, 5, 2); g.fillRect(21, 21, 4, 2);    // near paws
  g.fillStyle(0xddccaa); g.fillRect(12, 22, 1, 1); g.fillRect(24, 22, 1, 1); g.fillRect(28, 22, 1, 1); // claws
  // ── BODY: tucked belly, spotted coat ──
  g.fillStyle(0xaa7733); g.fillEllipse(17, 13, 24, 11);
  g.fillStyle(0xcc9944); g.fillEllipse(16, 11, 20, 5);       // lit back
  g.fillStyle(0xddaa55); g.fillRect(9, 9, 10, 1);            // top-light rim
  g.fillStyle(0x886622); g.fillEllipse(17, 16, 18, 4);       // shaded belly
  g.fillStyle(0x997722); g.fillEllipse(9, 13, 7, 8);         // haunch
  g.fillStyle(0xbb8833); g.fillRect(7, 10, 3, 2);            // haunch highlight
  g.fillStyle(0x775511);                                     // spots
  g.fillRect(11, 12, 2, 2); g.fillRect(15, 14, 2, 1); g.fillRect(18, 12, 2, 2); g.fillRect(22, 14, 2, 1); g.fillRect(13, 16, 1, 1);
  g.fillStyle(0x886622);                                     // hackles along the shoulders
  g.fillRect(17, 7, 2, 2); g.fillRect(20, 6, 2, 2); g.fillRect(23, 7, 2, 2);
  // ── HEAD ──
  g.fillStyle(0x997722); g.fillRect(24, 9, 4, 6);            // neck
  g.fillEllipse(29, 10, 9, 8);                               // skull
  g.fillStyle(0x886622); g.fillTriangle(26, 7, 27, 2, 29, 7); // ear
  g.fillStyle(0x553311); g.fillRect(27, 5, 1, 2);            // inner ear
  g.fillStyle(0xbb8833); g.fillRect(26, 7, 5, 2);            // lit crown
  g.fillStyle(0x775511); g.fillRect(27, 13, 6, 2);           // jaw shade
  g.fillStyle(0x886622); g.fillRect(31, 9, 4, 4);            // muzzle
  g.fillStyle(0x553311); g.fillRect(33, 9, 3, 2);            // nose
  g.fillRect(31, 12, 4, 1);                                  // mouth
  g.fillStyle(0xffffee); g.fillRect(33, 13, 1, 1);           // fang
  g.fillStyle(0x111111); g.fillRect(28, 8, 2, 2);            // eye
  g.fillStyle(0xffcc66); g.fillRect(28, 8, 1, 1);            // eye glint
  g.generateTexture('dust_hound', 36, 24);
}

function drawWaterLurker(g) {
  // Water lurker, 48×28: crocodilian, head and snout on the right.
  g.clear();
  // ── STUBBY LEGS: far pair on top, near pair at the bottom ──
  g.fillStyle(0x163d2e);
  g.fillRect(8, 4, 6, 5);  g.fillRect(20, 4, 6, 5);           // far legs
  g.fillRect(8, 22, 6, 4); g.fillRect(20, 22, 6, 4);          // near legs
  g.fillStyle(0x0d2e24); g.fillRect(8, 25, 7, 2); g.fillRect(20, 25, 7, 2); // webbed feet
  g.fillStyle(0xccccaa); g.fillRect(14, 26, 1, 1); g.fillRect(26, 26, 1, 1); // claws
  // ── TAIL: tapers left ──
  g.fillStyle(0x1a4a3a); g.fillRect(0, 11, 6, 10);
  g.fillStyle(0x0d2e24); g.fillRect(0, 14, 2, 4);             // tail tip
  g.fillRect(2, 10, 2, 1); g.fillRect(5, 10, 2, 1);           // tail scutes
  // ── BODY ──
  g.fillStyle(0x1a4a3a); g.fillRect(4, 8, 36, 16); g.fillRect(2, 10, 40, 12);
  g.fillStyle(0x256050); g.fillRect(4, 10, 36, 6);            // lit back stripe
  g.fillStyle(0x2f7462); g.fillRect(6, 10, 28, 1);            // top-light rim
  g.fillStyle(0x123a2e); g.fillRect(4, 20, 36, 4);            // shaded belly
  g.fillStyle(0x153f31);                                       // scale rows
  for (let x = 6; x < 38; x += 4) { g.fillRect(x, 13, 2, 2); g.fillRect(x + 2, 17, 2, 2); }
  g.fillStyle(0x2f7462);
  for (let x = 6; x < 38; x += 8) g.fillRect(x, 12, 1, 1);    // scale glints
  // ridged back spines
  g.fillStyle(0x0d2e24);
  g.fillTriangle(8, 10, 10, 5, 12, 10);  g.fillTriangle(16, 10, 18, 3, 20, 10);
  g.fillTriangle(24, 10, 26, 3, 28, 10); g.fillTriangle(32, 10, 34, 5, 36, 10);
  g.fillStyle(0x256050); g.fillRect(17, 6, 1, 2); g.fillRect(25, 6, 1, 2); // lit spine faces
  // ── HEAD: long flat snout ──
  g.fillStyle(0x1a4a3a); g.fillRect(38, 7, 10, 15);
  g.fillStyle(0x256050); g.fillRect(39, 9, 8, 3);             // lit snout top
  g.fillStyle(0x0d2e24); g.fillRect(40, 6, 5, 2);             // brow ridge
  g.fillRect(46, 10, 1, 1); g.fillRect(46, 12, 1, 1);         // nostrils
  g.fillRect(40, 17, 8, 1);                                   // mouth line
  g.fillStyle(0x163d2e); g.fillRect(40, 18, 8, 4);            // lower jaw
  g.fillStyle(0x0d2e24); g.fillRect(42, 22, 5, 3);            // jaw underside
  g.fillStyle(0xddddcc);                                      // teeth along the mouth line
  g.fillRect(41, 18, 1, 1); g.fillRect(43, 16, 1, 1); g.fillRect(45, 18, 1, 1); g.fillRect(47, 16, 1, 1);
  g.fillStyle(0xddcc00); g.fillRect(40, 8, 4, 4);             // near eye
  g.fillStyle(0xbbaa00); g.fillRect(44, 8, 2, 2);             // far eye
  g.fillStyle(0xffee55); g.fillRect(40, 8, 1, 1);             // eye glint
  g.fillStyle(0x111111); g.fillRect(42, 8, 1, 4);             // slit pupil
  g.generateTexture('water_lurker', 48, 28);
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
// Ground texture per biome; the index in this list is the tile index in 'ground_tileset'.
const GROUND_KEYS = ['grass', 'ground_waste', 'ground_swamp', 'ground_tundra', 'ground_ruins', 'ground_fungal', 'ground_desert'];

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

  // Tall grass — three shapes per biome: tall_grass (4 blades), _2 (two tall blades), _3 (six short blades).
  // Blades are [x, top, width]; each is a dark base, a mid body and a light tip, in the biome's palette.
  const TALL = {
    tall_grass:        [0x3a6820, 0x4e8a2a, 0x62aa36], // grassland: bright green
    tall_grass_waste:  [0x6a5020, 0x8a6e30, 0xaa8c44], // wasteland: dry stalks
    tall_grass_tundra: [0x8899aa, 0xaabbcc, 0xddeeff], // tundra: frost grass
    tall_grass_swamp:  [0x2a4a1a, 0x3a6628, 0x4f8a38], // swamp: murky reeds
  };
  const SHAPES = ['', '_2', '_3'];
  const BLADES = [
    [[6, 3, 3], [11, 1, 3], [16, 4, 2], [21, 2, 3]],
    [[9, 0, 3], [20, 2, 3]],
    [[3, 10, 2], [8, 8, 2], [13, 11, 2], [18, 9, 2], [23, 12, 2], [28, 10, 2]],
  ];
  for (const [key, [dark, mid, light]] of Object.entries(TALL)) {
    BLADES.forEach((blades, i) => {
      g.clear();
      for (const [x, top, w] of blades) {
        g.fillStyle(dark);  g.fillRect(x, top + 7, w, 24 - top - 7);
        g.fillStyle(mid);   g.fillRect(x, top + 3, w - 1, 8);
        g.fillStyle(light); g.fillRect(x, top, w - 1, 5);
      }
      g.generateTexture(key + SHAPES[i], 32, 24);
    });
  }





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

  // Players and raiders: hand-placed pixel grids in src/sprites.js
  buildPixelActors(scene);
  // Trees, rocks, bushes and built walls: painted pixel by pixel in src/sprites.js
  buildScenery(scene);

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

  // One tileset image: row 0 is every biome's base ground in GROUND_KEYS order; rows 1-3 are its
  // variants (lighter patch, darker patch, detail). Tile index = row * GROUND_KEYS.length + biome.
  // buildWorld paints the ground as a single Tilemap layer from it (a TileSprite per patch
  // allocated a canvas each and got the tab killed on iPhone, #238).
  // Variants only draw inside a 3 px inset, so every edge matches the base tile and any two tiles join.
  const N = GROUND_KEYS.length;
  const tileset = scene.textures.createCanvas('ground_tileset', N * 32, (4 + 2 * EDGE_MASKS.length) * 32);
  const ctx = tileset.context;
  const DETAIL = [ // per biome: [pebble color, pebble highlight, flower colors or null]
    [0x7d7d72, 0xa5a598, [0xe8d94a, 0xf2f2f2, 0xd96aa8]], // grass
    [0x5a4a38, 0x8a7458, null],                           // waste
    [0x2c3a24, 0x5a6e4a, [0xd8e070, 0x9ad0c0]],           // swamp
    [0x8a97a6, 0xdfe9f5, null],                           // tundra
    [0x555560, 0x8c8c9a, null],                           // ruins
    [0x6a3a8a, 0xb07ad8, [0x7af0c8, 0xe070e0]],           // fungal
    [0x9a7040, 0xd4b080, null],                           // desert
  ];
  const hex = (c, a = 1) => `rgba(${c >> 16}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;
  GROUND_KEYS.forEach((key, b) => {
    const base = scene.textures.get(key).getSourceImage();
    for (let row = 0; row < 4; row++) {
      const ox = b * 32, oy = row * 32;
      ctx.drawImage(base, ox, oy);
      let seed = (b + 1) * 7919 + row * 104729; // a fixed look per tile, not per session
      const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return 3 + seed % (n - 6); };
      if (row === 1 || row === 2) { // shade patch: a few blocky blobs, light or dark
        ctx.fillStyle = row === 1 ? 'rgba(255,255,255,0.11)' : 'rgba(0,0,0,0.15)';
        for (let k = 0; k < 3; k++) {
          const x = rnd(32), y = rnd(32);
          ctx.fillRect(ox + x, oy + y, Math.min(9, 29 - x) + 0, Math.min(6, 29 - y));
          ctx.fillRect(ox + x - (x > 6 ? 2 : 0), oy + y + 2, 3, Math.min(5, 29 - y - 2));
        }
      } else if (row === 3) { // detail: pebbles, plus flowers where the biome has them
        const [dark, lit, flowers] = DETAIL[b];
        for (let k = 0; k < 3; k++) {
          const x = rnd(32), y = rnd(32);
          ctx.fillStyle = hex(dark); ctx.fillRect(ox + x, oy + y, 3, 2);
          ctx.fillStyle = hex(lit);  ctx.fillRect(ox + x, oy + y, 2, 1);
        }
        if (flowers) for (let k = 0; k < 4; k++) {
          ctx.fillStyle = hex(flowers[k % flowers.length]);
          ctx.fillRect(ox + rnd(32), oy + rnd(32), 2, 2);
        }
      }
    }
  });
  // Bank tiles, from row 4: base ground with a shoreline over it, row 4 + kind * 47 + the mask's
  // index in EDGE_MASKS (drawEdgeVariants); kind 0 is still water, 1 the river. Mask 0 stays unused.
  [0x226688, 0x2277aa].forEach((water, k) => {
    const edges = drawEdgeVariants(water, 0x5a4a30);
    GROUND_KEYS.forEach((key, b) => {
      const base = scene.textures.get(key).getSourceImage();
      for (let v = 1; v < EDGE_MASKS.length; v++) {
        const ox = b * 32, oy = (4 + k * EDGE_MASKS.length + v) * 32;
        ctx.drawImage(base, ox, oy);
        ctx.drawImage(edges, v * 32, 0, 32, 32, ox, oy, 32, 32);
      }
    });
  });
  tileset.refresh();
  // Biome edges: an overlay tileset of its own (rows on the ground tileset would make it 15k px tall,
  // past what an iPhone's WebGL takes). Column = the neighbouring biome, row = the mask's index in
  // EDGE_MASKS: that biome's own ground fading in from the sides that touch it. Row 0 stays unused.
  const edgeSet = scene.textures.createCanvas('biome_edge_tileset', N * 32, EDGE_MASKS.length * 32);
  GROUND_KEYS.forEach((key, b) => {
    const edges = drawEdgeVariants(0, 0, 0), e2 = edges.getContext('2d');
    // Keep the fade, take the colours from the ground. One fill: source-in clears whatever a draw misses.
    e2.globalCompositeOperation = 'source-in';
    e2.fillStyle = e2.createPattern(scene.textures.get(key).getSourceImage(), 'repeat');
    e2.fillRect(0, 0, edges.width, 32);
    for (let v = 1; v < EDGE_MASKS.length; v++) edgeSet.context.drawImage(edges, v * 32, 0, 32, 32, b * 32, v * 32, 32, 32);
  });
  edgeSet.refresh();

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
  // River cells use this canvas as the tileset of the river layer (see buildWorld), so they batch into one
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

  // One tileset image for the still-water layer: shallow, deep and ice side by side
  // (WATER_TILE order). The river is a layer of its own, using the shared animated
  // 'water_river' canvas as its tileset, so one redraw animates every river cell.
  {
    const ts = scene.textures.createCanvas('water_tileset', 3 * 32, 32);
    ['water_shallow', 'water_deep', 'water_ice'].forEach((key, i) =>
      ts.context.drawImage(scene.textures.get(key).getSourceImage(), i * 32, 0));
    ts.refresh();
  }


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

  // Mountains — five irregular silhouettes, all 224x176 with the ground line at y=160 so
  // placeMtn can use one collision anchor for every variant. Drawn column by column from a
  // jagged ridgeline: faces that climb to the right are lit (light from top-left, like the
  // rock sprite), faces that fall away are shaded, three strata bands, snow that follows the
  // ridge, and a dark rubble foot. Rows below 160 stay transparent for the ground skirt.
  drawMountains(g);

  // Ground skirt placed under every mountain (depth 1.5, same layer as craters) so the peak
  // sits in the terrain instead of on it.
  g.clear();
  g.fillStyle(0x1a1410, 0.12); g.fillEllipse(140, 36, 280, 72);
  g.fillStyle(0x1a1410, 0.14); g.fillEllipse(140, 36, 220, 54);
  g.fillStyle(0x1a1410, 0.16); g.fillEllipse(140, 36, 150, 36);
  g.generateTexture('mountain_base', 280, 72);

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

  // Boss sprites — one per biome boss type, drawn at 112×120-ish (twice the
  // old 56×60) so their pixels match the player sprites. BOSS_SCALE in
  // game-scene.js is 1.5 (was 3), so the in-game footprint is unchanged.
  // No silhouette outline here: shading ramps carry the form.

  // Iron Golem (wasteland) — hulking, cracked, battle-damaged colossus
  g.clear();
  // ── LEGS: wide, planted, asymmetric stance ──
  g.fillStyle(0x445566); g.fillRect(22, 96, 28, 24); g.fillRect(66, 92, 28, 28); // right leg slightly forward
  g.fillStyle(0x556677); g.fillRect(26, 96, 12, 20); g.fillRect(70, 92, 12, 24);   // leg highlight
  g.fillStyle(0x2a3540); g.fillRect(20, 112, 32, 8); g.fillRect(64, 112, 32, 8);   // heavy feet
  g.fillStyle(0x7788aa); g.fillRect(24, 96, 2, 10); g.fillRect(68, 92, 2, 12);     // lit front edge
  g.fillStyle(0x3a4654); g.fillRect(46, 96, 4, 16); g.fillRect(90, 92, 4, 20);     // shaded right side
  g.fillRect(22, 106, 28, 2); g.fillRect(66, 104, 28, 2);                          // knee-plate seams
  g.fillStyle(0x445566); g.fillRect(20, 112, 32, 2); g.fillRect(64, 112, 32, 2);   // foot top bevel
  g.fillStyle(0x1c252e); g.fillRect(20, 118, 32, 2); g.fillRect(64, 118, 32, 2);   // soles
  g.fillRect(30, 114, 2, 4); g.fillRect(40, 114, 2, 4); g.fillRect(74, 114, 2, 4); g.fillRect(84, 114, 2, 4); // toe splits
  // ── ARMS: asymmetric — left raised high (ready to swing), right hanging ──
  // left arm raised
  g.fillStyle(0x556677); g.fillRect(2, 12, 22, 52); g.fillRect(0, 4, 26, 16);      // raised upper arm + fist up high
  g.fillStyle(0x7788aa); g.fillRect(4, 16, 8, 44);                                 // arm gleam
  g.fillStyle(0x3a4654); g.fillRect(0, 0, 26, 10);                                 // raised fist top
  // right arm lower
  g.fillStyle(0x556677); g.fillRect(90, 40, 22, 48); g.fillRect(88, 80, 26, 18);  // lower arm + fist
  g.fillStyle(0x7788aa); g.fillRect(100, 44, 8, 36);                               // arm gleam
  g.fillStyle(0x3a4654); g.fillRect(88, 92, 26, 8);                               // lower fist base
  g.fillStyle(0x445566); g.fillRect(106, 40, 6, 40);                              // hanging arm, shaded side
  g.fillStyle(0x3a4654);                                                           // arm plate bands
  g.fillRect(2, 30, 22, 2); g.fillRect(2, 46, 22, 2); g.fillRect(90, 56, 22, 2); g.fillRect(90, 70, 22, 2);
  g.fillStyle(0x88a0b8);                                                           // band lower lips catch light
  g.fillRect(4, 32, 18, 1); g.fillRect(4, 48, 18, 1); g.fillRect(92, 58, 14, 1); g.fillRect(92, 72, 14, 1);
  g.fillStyle(0x55687a);                                                           // knuckles, raised fist
  g.fillRect(2, 1, 6, 5); g.fillRect(10, 1, 6, 5); g.fillRect(18, 1, 6, 5);
  g.fillRect(90, 93, 6, 5); g.fillRect(98, 93, 6, 5); g.fillRect(106, 93, 6, 5);  // knuckles, lower fist
  g.fillStyle(0x88a0b8);                                                           // knuckle highlights
  g.fillRect(2, 1, 3, 1); g.fillRect(10, 1, 3, 1); g.fillRect(18, 1, 3, 1);
  g.fillRect(90, 93, 3, 1); g.fillRect(98, 93, 3, 1); g.fillRect(106, 93, 3, 1);
  // ── TORSO: wide barrel chest, hunched (narrower at shoulders top, bulging mid) ──
  g.fillStyle(0x556677); g.fillRect(18, 32, 76, 68);          // main body, fills more
  g.fillStyle(0x667a8c); g.fillRect(14, 44, 84, 36);          // bulging barrel mid-chest
  g.fillStyle(0x7788aa); g.fillRect(22, 36, 68, 18);          // upper chest gleam
  g.fillStyle(0x3a4654); g.fillRect(18, 88, 76, 12);           // lower-torso shadow (hunch)
  g.fillStyle(0x4a5c6c); g.fillRect(86, 36, 8, 52); g.fillRect(94, 44, 4, 36); // shaded right flank
  g.fillStyle(0x8a9cbc); g.fillRect(22, 36, 40, 2);            // top-light rim on the chest
  g.fillStyle(0x3a4654);                                       // armour plate seams
  g.fillRect(18, 56, 76, 2); g.fillRect(14, 78, 84, 2); g.fillRect(55, 38, 2, 50);
  g.fillStyle(0x7f93b0); g.fillRect(18, 58, 68, 1); g.fillRect(14, 80, 72, 1); // seam lips catch light
  // battle damage: dents with a lit upper rim, bright scratches
  g.fillStyle(0x445566); g.fillCircle(72, 48, 3); g.fillCircle(30, 70, 3); g.fillCircle(66, 86, 2);
  g.fillStyle(0x88a0b8); g.fillRect(70, 45, 3, 1); g.fillRect(28, 67, 3, 1);
  g.fillStyle(0x99aacc); g.fillRect(36, 44, 6, 1); g.fillRect(38, 45, 4, 1); g.fillRect(74, 68, 5, 1); g.fillRect(76, 69, 3, 1);
  // shoulder plates — left higher (raised arm), angular
  g.fillStyle(0x6b7e90); g.fillTriangle(8, 32, 32, 16, 36, 40);   // left pauldron, high
  g.fillStyle(0x6b7e90); g.fillTriangle(104, 44, 80, 28, 76, 52); // right pauldron, lower
  g.fillStyle(0x88a0b8); g.fillTriangle(12, 30, 28, 20, 30, 34);  // left pauldron gleam
  // ── GLOWING ORANGE CRACKS across the body ──
  g.lineStyle(4, 0xff6600);
  g.beginPath(); g.moveTo(28, 40); g.lineTo(40, 60); g.lineTo(34, 80); g.lineTo(46, 94); g.strokePath();
  g.beginPath(); g.moveTo(80, 44); g.lineTo(68, 62); g.lineTo(78, 78); g.strokePath();
  g.beginPath(); g.moveTo(56, 48); g.lineTo(60, 66); g.lineTo(52, 86); g.strokePath();
  g.lineStyle(2, 0xffaa44);
  g.beginPath(); g.moveTo(40, 60); g.lineTo(48, 56); g.strokePath();
  g.beginPath(); g.moveTo(68, 62); g.lineTo(62, 70); g.strokePath();
  g.lineStyle(1, 0xffdd88);                                    // white-hot core inside each crack
  g.beginPath(); g.moveTo(28, 40); g.lineTo(40, 60); g.lineTo(34, 80); g.lineTo(46, 94); g.strokePath();
  g.beginPath(); g.moveTo(80, 44); g.lineTo(68, 62); g.lineTo(78, 78); g.strokePath();
  g.beginPath(); g.moveTo(56, 48); g.lineTo(60, 66); g.lineTo(52, 86); g.strokePath();
  // crack glow embers
  g.fillStyle(0xff8822); g.fillRect(38, 58, 4, 4); g.fillRect(66, 60, 4, 4); g.fillRect(50, 84, 4, 4);
  g.fillStyle(0xffdd88); g.fillRect(39, 59, 2, 2); g.fillRect(67, 61, 2, 2); g.fillRect(51, 85, 2, 2);
  // rivets: dark heads with a lit top-left pixel
  g.fillStyle(0x2a3540);
  g.fillRect(24, 38, 4, 4); g.fillRect(86, 38, 4, 4);
  g.fillRect(24, 90, 4, 4); g.fillRect(86, 90, 4, 4);
  g.fillRect(24, 60, 4, 4); g.fillRect(86, 60, 4, 4); g.fillRect(20, 82, 4, 4); g.fillRect(90, 82, 4, 4);
  g.fillStyle(0x99aacc);
  g.fillRect(24, 38, 2, 1); g.fillRect(86, 38, 2, 1); g.fillRect(24, 90, 2, 1); g.fillRect(86, 90, 2, 1);
  g.fillRect(24, 60, 2, 1); g.fillRect(86, 60, 2, 1); g.fillRect(20, 82, 2, 1); g.fillRect(90, 82, 2, 1);
  // ── HEAD: large, angular, armored, visor band ──
  g.fillStyle(0x6b7e90); g.fillRect(32, 4, 48, 32);           // angular head block
  g.fillStyle(0x55687a); g.fillRect(28, 12, 56, 8);            // brow ridge wider than head
  g.fillStyle(0x223344); g.fillRect(30, 18, 52, 10);            // dark recessed visor band
  // glowing red eye slits + glow halo
  g.fillStyle(0xff2200, 0.35); g.fillRect(34, 16, 16, 14); g.fillRect(62, 16, 16, 14); // halo
  g.fillStyle(0xff2200); g.fillRect(38, 20, 10, 6); g.fillRect(66, 20, 10, 6);     // slits
  g.fillStyle(0xff7744); g.fillRect(40, 20, 4, 2); g.fillRect(68, 20, 4, 2);     // hot core
  g.fillStyle(0xffeedd); g.fillRect(39, 21, 1, 1); g.fillRect(67, 21, 1, 1);     // eye glints
  // head plating: lit crown bevel, crown seam, shaded right cheek
  g.fillStyle(0x88a0b8); g.fillRect(32, 4, 46, 2); g.fillRect(32, 6, 2, 6);
  g.fillStyle(0x55687a); g.fillRect(55, 6, 2, 6); g.fillRect(74, 28, 6, 8);
  g.fillStyle(0x7788aa); g.fillRect(28, 12, 54, 1);                              // brow ridge edge light
  // jaw vents
  g.fillStyle(0x2a3540); g.fillRect(40, 30, 8, 4); g.fillRect(56, 30, 8, 4); g.fillRect(72, 30, 8, 4);
  g.fillStyle(0xff6600, 0.6); g.fillRect(41, 32, 6, 1); g.fillRect(57, 32, 6, 1); g.fillRect(73, 32, 6, 1); // furnace glow
  g.generateTexture('boss_golem', 112, 120);

  // Alpha Wolf (grassland) — massive scarred predator, coiled to pounce
  g.clear();
  // ── TAIL: low, bushy, swept back ──
  g.fillStyle(0x554422); g.fillTriangle(0, 44, 24, 52, 4, 72);
  g.fillStyle(0x665533); g.fillTriangle(4, 48, 22, 54, 8, 66);
  g.fillStyle(0x887744); g.fillRect(4, 48, 8, 2); g.fillRect(8, 50, 8, 1);          // lit upper edge
  g.fillStyle(0x443311); g.fillRect(6, 56, 8, 1); g.fillRect(8, 60, 7, 1); g.fillRect(5, 64, 5, 1); // fur strands
  // ── BODY: muscular, low and coiled ──
  g.fillStyle(0x665533); g.fillEllipse(52, 68, 84, 48);            // bulk
  g.fillStyle(0x887744); g.fillEllipse(48, 58, 76, 28);           // back / shoulder mass
  g.fillStyle(0x4a3a22); g.fillEllipse(52, 84, 68, 20);           // belly shadow
  // fur texture: strands swept back, pale on the lit back, dark toward the belly
  g.fillStyle(0xa89860); g.fillRect(28, 46, 34, 1);               // top-light rim along the spine
  g.fillStyle(0x9a8855);
  for (let i = 0; i < 9; i++) g.fillRect(26 + i * 7, 50 + (i % 3) * 2, 4, 1);
  g.fillStyle(0x554422);
  for (let i = 0; i < 10; i++) g.fillRect(18 + i * 7, 66 + (i % 2) * 5, 4, 1);
  g.fillStyle(0x3a2e1a);
  for (let i = 0; i < 8; i++) g.fillRect(24 + i * 8, 78 + (i % 2) * 3, 3, 1);
  // ── RAISED HACKLES along the back ──
  g.fillStyle(0x332211);
  g.fillTriangle(24, 48, 32, 32, 40, 48);
  g.fillTriangle(38, 46, 48, 28, 58, 46);
  g.fillTriangle(54, 48, 64, 34, 74, 48);
  g.fillStyle(0x554433);
  g.fillTriangle(40, 44, 46, 34, 52, 44);
  // ── LEGS: wide, muscular, braced stance ──
  g.fillStyle(0x665533);
  g.fillRect(16, 76, 16, 32); g.fillRect(40, 80, 16, 28);            // front legs (one braced forward)
  g.fillRect(66, 76, 16, 32); g.fillRect(88, 80, 16, 28);           // back legs (spread wide)
  g.fillStyle(0x887744); g.fillRect(18, 78, 6, 24); g.fillRect(90, 82, 6, 22); // leg muscle highlight
  g.fillStyle(0x2a2012);
  g.fillRect(14, 102, 20, 8); g.fillRect(38, 102, 20, 8);
  g.fillRect(64, 102, 20, 8); g.fillRect(86, 102, 20, 8);          // big paws
  g.fillStyle(0x4a3a22);                                          // shaded right side of each leg
  g.fillRect(28, 78, 4, 24); g.fillRect(52, 82, 4, 20); g.fillRect(78, 78, 4, 24); g.fillRect(100, 82, 4, 20);
  g.fillStyle(0x887744); g.fillRect(42, 82, 3, 18); g.fillRect(68, 78, 3, 20); // lit front of the other legs
  g.fillStyle(0x3a2e1a); g.fillRect(14, 102, 20, 2); g.fillRect(38, 102, 20, 2); g.fillRect(64, 102, 20, 2); g.fillRect(86, 102, 20, 2); // paw tops
  g.fillStyle(0x1a1208);                                          // toe splits
  for (const px of [14, 38, 64, 86]) { g.fillRect(px + 6, 104, 1, 6); g.fillRect(px + 13, 104, 1, 6); }
  g.fillStyle(0xddccaa);                                          // claws
  g.fillRect(14, 108, 2, 4); g.fillRect(22, 108, 2, 4); g.fillRect(30, 108, 2, 4);
  g.fillRect(86, 108, 2, 4); g.fillRect(94, 108, 2, 4); g.fillRect(102, 108, 2, 4);
  g.fillRect(38, 108, 2, 3); g.fillRect(46, 108, 2, 3); g.fillRect(54, 108, 2, 3);  // far paws
  g.fillRect(64, 108, 2, 3); g.fillRect(72, 108, 2, 3); g.fillRect(80, 108, 2, 3);
  g.fillStyle(0xffffff); g.fillRect(14, 108, 1, 1); g.fillRect(22, 108, 1, 1); g.fillRect(30, 108, 1, 1); // claw glints
  g.fillRect(86, 108, 1, 1); g.fillRect(94, 108, 1, 1); g.fillRect(102, 108, 1, 1);
  // ── HEAD: oversized, lowered, aggressive ──
  g.fillStyle(0x554422);                                           // shaggy neck ruff behind the head
  g.fillTriangle(62, 36, 72, 44, 62, 50); g.fillTriangle(60, 48, 70, 54, 62, 62); g.fillTriangle(64, 60, 74, 62, 68, 72);
  g.fillStyle(0x665533); g.fillEllipse(88, 48, 48, 40);          // big head
  g.fillStyle(0x887744); g.fillEllipse(84, 36, 30, 12);          // lit crown
  g.fillStyle(0xa89860); g.fillRect(76, 31, 14, 1);               // crown rim light
  g.fillStyle(0x554422); g.fillRect(70, 46, 4, 1); g.fillRect(72, 52, 5, 1); g.fillRect(70, 58, 4, 1); // cheek fur
  g.fillStyle(0x554422); g.fillEllipse(88, 60, 40, 18);           // jaw shadow
  // ears — large, pinned-forward
  g.fillStyle(0x554422); g.fillTriangle(72, 12, 66, 32, 86, 28);  // back ear
  g.fillStyle(0x665533); g.fillTriangle(100, 12, 92, 32, 112, 28);  // front ear
  g.fillStyle(0x2a2012); g.fillTriangle(100, 18, 96, 30, 108, 28);  // ear inner
  // snout / muzzle, jutting
  g.fillStyle(0x776644); g.fillEllipse(104, 56, 24, 18);
  g.fillStyle(0x887755); g.fillRect(96, 49, 10, 2);               // muzzle bridge highlight
  g.fillStyle(0x1a1208); g.fillRect(106, 50, 6, 6);               // nose
  g.fillStyle(0x554433); g.fillRect(106, 50, 2, 2);               // nose glint
  g.fillStyle(0x4a3a22); g.fillRect(98, 58, 1, 1); g.fillRect(101, 60, 1, 1); g.fillRect(104, 58, 1, 1); // whisker pits
  // ── SCAR across muzzle ──
  g.lineStyle(2, 0xbbaa88);
  g.beginPath(); g.moveTo(80, 38); g.lineTo(100, 54); g.strokePath();
  g.fillStyle(0x4a3a22); g.fillRect(82, 40, 2, 2); g.fillRect(90, 46, 2, 2);
  // ── EYES: large, bright amber, glowing ──
  g.fillStyle(0xffcc33, 0.4); g.fillEllipse(84, 42, 16, 12);       // glow halo
  g.fillStyle(0xffcc33); g.fillRect(78, 38, 10, 8); g.fillRect(92, 38, 10, 8); // big amber eyes
  g.fillStyle(0x1a1208); g.fillRect(82, 40, 4, 4); g.fillRect(96, 40, 4, 4); // pupils
  g.fillStyle(0xffffaa); g.fillRect(78, 38, 2, 2); g.fillRect(92, 38, 2, 2); // glint
  // ── FANGS: prominent, bared ──
  g.fillStyle(0x332211); g.fillRect(92, 64, 22, 8);              // dark open maw
  g.fillStyle(0xffffff);
  g.fillTriangle(94, 64, 98, 64, 96, 76);   // upper fangs
  g.fillTriangle(106, 64, 110, 64, 108, 76);
  g.fillTriangle(96, 72, 100, 72, 98, 64);   // lower fangs
  g.fillTriangle(104, 72, 108, 72, 106, 64);
  g.fillStyle(0xccc4b0);                                          // shaded side of each fang
  g.fillTriangle(96, 64, 98, 64, 96, 76); g.fillTriangle(108, 64, 110, 64, 108, 76);
  g.fillStyle(0xaa3322); g.fillRect(100, 68, 4, 3);               // tongue
  g.generateTexture('boss_wolf', 112, 112);

  // Spider Queen (ruins) — venomous matriarch, legs spanning the full width
  g.clear();
  // ── 4 PAIRS OF LEGS: jagged, multi-jointed, outer feet near x=0 and x=110 ──
  // Each leg: foot → outer segment → knee → inner segment → body. Built with
  // lineStyle strokes for a sharp spindly look, anchored at the cephalothorax (x≈56).
  const spiderLegY = [32, 42, 54, 66];      // body anchor heights
  const spiderFootX = [2, 8, 12, 18];          // left outer feet; mirrored on right
  const spiderFootY = [20, 36, 60, 80];      // splayed foot heights
  g.lineStyle(6, 0x1a0626);
  for (let i = 0; i < 4; i++) {
    const ay = spiderLegY[i];
    // left leg
    g.beginPath();
    g.moveTo(spiderFootX[i], spiderFootY[i]);
    g.lineTo(spiderFootX[i] + 18, ay - 4);     // knee up
    g.lineTo(44, ay);                          // into body
    g.strokePath();
    // right leg (mirror)
    g.beginPath();
    g.moveTo(110 - spiderFootX[i], spiderFootY[i]);
    g.lineTo(110 - spiderFootX[i] - 18, ay - 4);
    g.lineTo(68, ay);
    g.strokePath();
  }
  // leg highlights (purple) over the knees
  g.lineStyle(2, 0x8833cc);
  for (let i = 0; i < 4; i++) {
    const ay = spiderLegY[i];
    g.beginPath(); g.moveTo(spiderFootX[i] + 18, ay - 4); g.lineTo(40, ay); g.strokePath();
    g.beginPath(); g.moveTo(110 - spiderFootX[i] - 18, ay - 4); g.lineTo(72, ay); g.strokePath();
  }
  // knee knobs, bristles on the outer segments, pale claw tips
  for (let i = 0; i < 4; i++) {
    const ay = spiderLegY[i], fx = spiderFootX[i], fy = spiderFootY[i];
    for (const [kx, foot] of [[fx + 18, fx], [110 - fx - 18, 110 - fx]]) {
      g.fillStyle(0x2d0a3d); g.fillCircle(kx, ay - 4, 4);
      g.fillStyle(0xaa55ee); g.fillRect(kx - 2, ay - 7, 2, 1);
      g.fillStyle(0x1a0626);
      for (let t = 0.25; t < 0.9; t += 0.25) {                  // bristles along the outer segment
        const bx = Math.round(foot + (kx - foot) * t), by = Math.round(fy + (ay - 4 - fy) * t);
        g.fillRect(bx, by - 4, 1, 2);
      }
      g.fillStyle(0xccaaee); g.fillRect(foot - 1, fy - 1, 2, 2);
    }
  }
  // ── ABDOMEN: deep purple-black, bulbous ──
  g.fillStyle(0x2d0a3d); g.fillEllipse(56, 74, 68, 52);
  g.fillStyle(0x4a1560); g.fillEllipse(56, 64, 52, 28);        // top sheen
  g.fillStyle(0x8833cc); g.fillEllipse(54, 58, 28, 12);         // bright purple highlight
  g.fillStyle(0x1a0626); g.fillEllipse(56, 88, 48, 18);         // underside shadow
  g.fillStyle(0xcc88ff); g.fillRect(46, 55, 8, 1); g.fillRect(44, 56, 3, 1); // wet top-left sheen
  g.fillStyle(0x3a0e4e);                                        // segment bands across the abdomen
  g.fillRect(30, 70, 14, 2); g.fillRect(68, 70, 14, 2); g.fillRect(28, 80, 16, 2); g.fillRect(68, 80, 16, 2);
  g.fillStyle(0x5a1d74); g.fillRect(30, 69, 14, 1); g.fillRect(68, 69, 14, 1); // band upper lips catch light
  g.fillStyle(0x1a0626);                                        // fine hairs
  for (const [hx, hy] of [[32, 62], [40, 58], [72, 58], [80, 62], [26, 76], [86, 76], [36, 90], [76, 90]]) g.fillRect(hx, hy, 1, 2);
  g.fillStyle(0x110018); g.fillRect(52, 98, 8, 3);              // spinnerets
  // ── HOURGLASS MARKING (bright red/orange) on the abdomen ──
  g.fillStyle(0xff3300);
  g.fillTriangle(48, 66, 64, 66, 56, 76);    // upper triangle
  g.fillTriangle(48, 90, 64, 90, 56, 80);    // lower triangle
  g.fillStyle(0xff8822); g.fillRect(54, 74, 4, 8);            // hot center
  g.fillStyle(0xaa1100);                                       // shaded lower edges of the hourglass
  g.fillRect(50, 66, 2, 1); g.fillRect(60, 66, 2, 1); g.fillRect(49, 89, 14, 1);
  g.fillStyle(0xffcc88); g.fillRect(55, 75, 1, 3);             // white-hot core
  // ── CEPHALOTHORAX (head section) ──
  g.fillStyle(0x4a1560); g.fillEllipse(56, 34, 44, 32);
  g.fillStyle(0x8833cc); g.fillEllipse(56, 26, 32, 14);        // bright highlight
  g.fillStyle(0x2d0a3d); g.fillEllipse(56, 42, 32, 12);        // chin shade
  g.fillStyle(0xbb77ee); g.fillRect(46, 21, 10, 1); g.fillRect(44, 22, 3, 1); // crown rim light
  g.fillStyle(0x3a0e4e);                                       // radial grooves on the carapace
  g.fillRect(36, 30, 4, 1); g.fillRect(72, 30, 4, 1); g.fillRect(40, 40, 4, 1); g.fillRect(68, 40, 4, 1);
  // ── 6 VIVID RED EYES with glow, two rows ──
  g.fillStyle(0xff1111, 0.4);                                  // glow halos
  g.fillRect(36, 20, 10, 10); g.fillRect(50, 18, 10, 10); g.fillRect(66, 20, 10, 10);
  g.fillRect(42, 32, 8, 8); g.fillRect(54, 32, 8, 8); g.fillRect(66, 32, 8, 8);
  g.fillStyle(0xff1111);                                       // eyes
  g.fillRect(38, 22, 6, 6); g.fillRect(52, 20, 6, 6); g.fillRect(68, 22, 6, 6); // top row
  g.fillRect(44, 34, 6, 6); g.fillRect(56, 34, 6, 6); g.fillRect(66, 34, 6, 6); // bottom row
  g.fillStyle(0xffbbbb);                                       // glints
  g.fillRect(38, 22, 2, 2); g.fillRect(52, 20, 2, 2); g.fillRect(68, 22, 2, 2);
  g.fillRect(44, 34, 1, 1); g.fillRect(56, 34, 1, 1); g.fillRect(66, 34, 1, 1);
  g.fillStyle(0xaa0000);                                       // shaded lower edge of each eye
  g.fillRect(38, 27, 6, 1); g.fillRect(52, 25, 6, 1); g.fillRect(68, 27, 6, 1);
  g.fillRect(44, 39, 6, 1); g.fillRect(56, 39, 6, 1); g.fillRect(66, 39, 6, 1);
  // ── FANGS / MANDIBLES + VENOM DRIP ──
  g.fillStyle(0x1a0626); g.fillRect(48, 44, 6, 10); g.fillRect(58, 44, 6, 10);
  g.fillStyle(0x553366); g.fillRect(48, 44, 2, 8); g.fillRect(58, 44, 2, 8);
  g.fillStyle(0xaaff00); g.fillRect(50, 52, 4, 8); g.fillRect(60, 52, 4, 6);  // venom drip
  g.fillStyle(0xccff66); g.fillRect(50, 58, 4, 2);                            // drip tip glow
  g.fillStyle(0xeeffaa); g.fillRect(50, 52, 1, 3); g.fillRect(60, 52, 1, 2);  // venom shine
  g.fillStyle(0x886699); g.fillRect(48, 44, 1, 4); g.fillRect(58, 44, 1, 4);  // fang edge light
  g.generateTexture('boss_spider', 112, 104);

  // Frost Troll (tundra) — hunched ice giant bristling with crystal spikes
  g.clear();
  // ── LEGS: thick, planted wide ──
  g.fillStyle(0x2a3a5a); g.fillRect(28, 96, 26, 24); g.fillRect(58, 96, 26, 24);
  g.fillStyle(0x3a4f78); g.fillRect(32, 96, 10, 20); g.fillRect(62, 96, 10, 20);   // leg highlight
  g.fillStyle(0x1c2840); g.fillRect(24, 112, 32, 8); g.fillRect(56, 112, 32, 8);   // big feet
  g.fillRect(48, 96, 6, 16); g.fillRect(78, 96, 6, 16);                            // shaded right side of legs
  g.fillStyle(0x2a3a5a); g.fillRect(24, 112, 32, 2); g.fillRect(56, 112, 32, 2);   // lit top of feet
  g.fillStyle(0x0e1626);                                                           // toe splits
  g.fillRect(32, 114, 1, 6); g.fillRect(40, 114, 1, 6); g.fillRect(48, 114, 1, 6);
  g.fillRect(64, 114, 1, 6); g.fillRect(72, 114, 1, 6); g.fillRect(80, 114, 1, 6);
  g.fillStyle(0xaaddff); g.fillRect(25, 113, 3, 1); g.fillRect(57, 113, 3, 1);    // rime on the toes
  // ── LEFT ARM: long, reaching to the ground ──
  g.fillStyle(0x4a5f88); g.fillRect(2, 32, 18, 60);
  g.fillStyle(0x6680a8); g.fillRect(4, 36, 8, 44);                                // arm gleam
  g.fillStyle(0x33445f); g.fillRect(0, 84, 22, 16);                                // left fist
  g.fillStyle(0x3a4f78); g.fillRect(14, 32, 6, 52);                                // arm, shaded side
  g.fillRect(4, 48, 4, 1); g.fillRect(8, 56, 4, 1); g.fillRect(4, 64, 5, 1); g.fillRect(9, 72, 3, 1); // shaggy hide
  g.fillStyle(0x4a5f88);                                                           // knuckles
  g.fillRect(1, 94, 5, 5); g.fillRect(8, 95, 5, 5); g.fillRect(15, 94, 5, 5);
  g.fillStyle(0xcceeff); g.fillRect(1, 94, 2, 1); g.fillRect(8, 95, 2, 1); g.fillRect(15, 94, 2, 1); // frosted knuckles
  g.fillStyle(0x6680a8); g.fillRect(0, 84, 20, 1);                                 // fist top edge light
  // ── MASSIVE ICE-CHUNK CLUB on the right ──
  g.fillStyle(0x556688); g.fillRect(100, 80, 10, 32);                              // handle/forearm grip
  g.fillStyle(0xaaccee); g.fillRect(84, 32, 28, 48);                             // big ice chunk
  g.fillStyle(0xcceeff); g.fillRect(88, 36, 14, 28);                              // ice gleam
  g.fillStyle(0x88bbe0); g.fillTriangle(84, 32, 100, 20, 112, 36);                 // jagged top facet
  g.fillStyle(0x88bbe0); g.fillTriangle(84, 80, 98, 92, 112, 80);                 // jagged bottom facet
  g.fillStyle(0xffffff); g.fillRect(92, 40, 4, 12);                              // sharp highlight
  g.fillStyle(0x88aacc); g.fillRect(106, 36, 6, 44);                              // club, shaded side
  g.lineStyle(1, 0x6699cc);                                                        // fracture lines in the ice
  g.beginPath(); g.moveTo(86, 50); g.lineTo(96, 58); g.lineTo(94, 70); g.strokePath();
  g.beginPath(); g.moveTo(104, 34); g.lineTo(100, 46); g.lineTo(108, 60); g.strokePath();
  g.fillStyle(0xffffff); g.fillRect(100, 26, 1, 1); g.fillRect(89, 70, 1, 1); g.fillRect(104, 66, 1, 1); // sparkles
  // right shoulder/arm gripping the club
  g.fillStyle(0x4a5f88); g.fillRect(88, 44, 16, 40);
  // ── TORSO: very wide, hunched, x=0..55 reach via shoulders ──
  g.fillStyle(0x4a5f88); g.fillRect(16, 36, 80, 64);            // wide body
  g.fillStyle(0x5a72a0); g.fillRect(12, 48, 88, 32);           // bulging hunched mass
  g.fillStyle(0x6680a8); g.fillRect(22, 40, 68, 18);          // upper highlight
  g.fillStyle(0x33445f); g.fillRect(16, 88, 80, 12);           // belly hunch shadow
  g.fillStyle(0x3e5078); g.fillRect(84, 48, 12, 40);           // shaded right flank
  g.fillStyle(0x7a94bc); g.fillRect(22, 40, 60, 1);            // top-light rim
  g.fillStyle(0x7a94bc);                                       // shaggy hide: pale strands up top...
  for (let i = 0; i < 8; i++) g.fillRect(24 + i * 8, 46 + (i % 2) * 4, 4, 1);
  g.fillStyle(0x3e5078);                                       // ...dark strands lower down
  for (let i = 0; i < 9; i++) g.fillRect(20 + i * 8, 78 + (i % 2) * 4, 4, 1);
  g.fillStyle(0x33445f);                                       // ragged fur fringe hanging over the legs
  for (let fx = 18; fx < 94; fx += 8) g.fillTriangle(fx, 98, fx + 6, 98, fx + 3, 104);
  // ── ICE-CRYSTAL SPIKES from shoulders and back (sharp pale-blue triangles) ──
  g.fillStyle(0xaaddff);
  g.fillTriangle(4, 44, 16, 12, 26, 44);      // left shoulder big spike
  g.fillTriangle(86, 44, 98, 8, 108, 44);    // right shoulder big spike
  g.fillTriangle(28, 40, 36, 16, 44, 40);    // back spike
  g.fillTriangle(68, 40, 76, 20, 84, 40);   // back spike
  g.fillStyle(0xcceeff);                     // spike inner gleam
  g.fillTriangle(12, 40, 16, 18, 22, 40);
  g.fillTriangle(94, 40, 98, 14, 104, 40);
  g.fillStyle(0x88bbe0);                     // shaded right facet of each spike
  g.fillTriangle(16, 12, 26, 44, 18, 44); g.fillTriangle(98, 8, 108, 44, 100, 44);
  g.fillTriangle(36, 16, 44, 40, 38, 40); g.fillTriangle(76, 20, 84, 40, 78, 40);
  g.fillStyle(0xffffff); g.fillRect(15, 14, 1, 3); g.fillRect(97, 10, 1, 3); // spike tip glints
  // ── GLOWING PALE-BLUE RUNES on torso ──
  g.fillStyle(0x88eeff, 0.3);                // rune glow
  g.fillRect(30, 58, 10, 10); g.fillRect(42, 66, 10, 10); g.fillRect(54, 60, 10, 10);
  g.fillRect(66, 68, 10, 10); g.fillRect(46, 78, 10, 10);
  g.fillStyle(0x88eeff);
  g.fillRect(32, 60, 6, 6); g.fillRect(44, 68, 6, 6); g.fillRect(56, 62, 6, 6);
  g.fillRect(68, 70, 6, 6); g.fillRect(48, 80, 6, 6);
  g.fillStyle(0xccffff);                      // rune cores
  g.fillRect(34, 62, 2, 2); g.fillRect(58, 64, 2, 2); g.fillRect(70, 72, 2, 2);
  // ── HEAD: blocky, recessed dark eye sockets, glowing icy eyes ──
  g.fillStyle(0x5a72a0); g.fillEllipse(56, 22, 60, 36);
  g.fillStyle(0x4a5f88); g.fillEllipse(56, 30, 48, 18);        // jaw shade
  g.fillStyle(0x6680a8); g.fillEllipse(50, 10, 34, 8);         // lit brow
  g.fillStyle(0x16203a); g.fillRect(52, 28, 2, 2); g.fillRect(58, 28, 2, 2); // nostrils
  g.fillStyle(0xaaddff);                                       // icicle beard at the jaw corners
  g.fillTriangle(34, 34, 40, 34, 37, 44); g.fillTriangle(72, 34, 78, 34, 75, 44);
  g.fillStyle(0xeeffff); g.fillRect(35, 35, 1, 3); g.fillRect(73, 35, 1, 3);
  // horns / tusk-horns, swept
  g.fillStyle(0x6688aa); g.fillTriangle(20, 16, 28, 0, 36, 16);
  g.fillStyle(0x6688aa); g.fillTriangle(76, 16, 84, 0, 92, 16);
  g.fillStyle(0x3a4f78); g.fillRect(24, 12, 8, 6); g.fillRect(80, 12, 8, 6);       // horn base shade
  g.fillStyle(0x88aacc); g.fillRect(25, 8, 6, 1); g.fillRect(81, 8, 6, 1); g.fillRect(26, 4, 4, 1); g.fillRect(82, 4, 4, 1); // horn ridges
  // recessed dark eye sockets
  g.fillStyle(0x16203a); g.fillRect(34, 14, 16, 12); g.fillRect(62, 14, 16, 12);
  // glowing icy eyes
  g.fillStyle(0x88eeff, 0.4); g.fillRect(36, 16, 12, 10); g.fillRect(64, 16, 12, 10);  // glow
  g.fillStyle(0xaaddff); g.fillRect(38, 18, 8, 6); g.fillRect(66, 18, 8, 6);       // eyes
  g.fillStyle(0xffffff); g.fillRect(40, 18, 2, 2); g.fillRect(68, 18, 2, 2);       // glint
  // mouth + tusks
  g.fillStyle(0x16203a); g.fillRect(44, 32, 24, 6);
  g.fillStyle(0xeeffff);
  g.fillTriangle(46, 32, 50, 32, 48, 42);   // tusks up
  g.fillTriangle(62, 32, 66, 32, 64, 42);
  g.fillStyle(0xaaccdd); g.fillTriangle(48, 32, 50, 32, 48, 42); g.fillTriangle(64, 32, 66, 32, 64, 42); // tusk shade
  g.generateTexture('boss_troll', 112, 120);

  // Bog Hydra (swamp) — three-headed serpent, coiled and bioluminescent
  g.clear();
  // ── COILED MAIN BODY: large, fills the lower canvas ──
  g.fillStyle(0x2a3a1c); g.fillEllipse(56, 96, 96, 44);        // big coil bulk
  g.fillStyle(0x3d5229); g.fillEllipse(56, 88, 80, 28);       // back highlight
  g.fillStyle(0x1a2610); g.fillEllipse(56, 110, 68, 16);        // belly shadow
  // a second coil loop for a serpentine, wrapped look
  g.fillStyle(0x33451f); g.fillEllipse(24, 100, 32, 28);
  g.fillStyle(0x33451f); g.fillEllipse(92, 100, 32, 28);
  g.fillStyle(0x223311); g.fillEllipse(24, 106, 24, 10); g.fillEllipse(92, 106, 24, 10);
  // ── SCALE-PATTERN TEXTURE on the body: staggered scales, lit top-left lip,
  // dark lower edge; the lower two rows sit in the belly shadow and are darker ──
  for (let row = 0; row < 4; row++) {
    const sy = 84 + row * 6;
    const base = row < 2 ? 0x46602f : 0x33451f, lip = row < 2 ? 0x5a7a3a : 0x46602f;
    for (let sx = 16 + (row % 2) * 4; sx <= 92; sx += 8) {
      const nx = (sx + 3 - 56) / 46, ny = (sy + 2 - 96) / 20;
      if (nx * nx + ny * ny > 1) continue;              // keep scales inside the coil
      g.fillStyle(base); g.fillRect(sx, sy, 6, 4);
      g.fillStyle(lip);  g.fillRect(sx, sy, 3, 1);
      g.fillStyle(0x223311); g.fillRect(sx + 1, sy + 4, 5, 1);
    }
  }
  g.fillStyle(0x2a3a1c);                                // ventral plate lines on the underside
  for (let vx = 36; vx <= 76; vx += 6) g.fillRect(vx, 108, 1, 5);
  g.fillStyle(0x6a8a4a);                                // wet glints on the top of the coil
  g.fillRect(30, 80, 5, 1); g.fillRect(70, 79, 4, 1); g.fillRect(14, 92, 3, 1);
  // ── BACK SPINES along the coil ──
  g.fillStyle(0x1a2610);
  g.fillTriangle(24, 80, 32, 60, 40, 80);
  g.fillTriangle(44, 80, 54, 56, 64, 80);
  g.fillTriangle(68, 80, 76, 60, 84, 80);
  g.fillStyle(0x33451f);                                // lit left face of each spine
  g.fillTriangle(24, 80, 32, 60, 29, 80); g.fillTriangle(44, 80, 54, 56, 50, 80); g.fillTriangle(68, 80, 76, 60, 73, 80);
  // ── THREE NECKS at very different heights ──
  g.fillStyle(0x33451f);
  g.fillRect(14, 48, 16, 48);     // left neck (mid)
  g.fillRect(48, 8, 16, 84);     // center neck (full height, reaching near top)
  g.fillRect(84, 60, 16, 36);    // right neck (low)
  g.fillStyle(0x46602f);        // neck highlights
  g.fillRect(18, 48, 6, 48); g.fillRect(52, 8, 6, 84); g.fillRect(88, 60, 6, 36);
  g.fillStyle(0x223311);                                // shaded right side of each neck
  g.fillRect(27, 48, 3, 48); g.fillRect(61, 8, 3, 84); g.fillRect(97, 60, 3, 36);
  g.fillStyle(0x2a3a1c);                                // scale bands ringing the necks
  for (let ny = 52; ny < 94; ny += 6) g.fillRect(14, ny, 16, 1);
  for (let ny = 30; ny < 90; ny += 6) g.fillRect(48, ny, 16, 1);
  for (let ny = 64; ny < 94; ny += 6) g.fillRect(84, ny, 16, 1);
  // ── BIOLUMINESCENT STRIPES on the necks/body ──
  g.fillStyle(0x44ff88);
  g.fillRect(22, 56, 4, 6); g.fillRect(22, 76, 4, 6);          // left neck
  g.fillRect(56, 24, 4, 6); g.fillRect(56, 48, 4, 6); g.fillRect(56, 72, 4, 6); // center neck
  g.fillRect(92, 68, 4, 6);                                    // right neck
  g.fillStyle(0x88ff44);                                       // body biolum spots
  g.fillRect(36, 92, 6, 6); g.fillRect(60, 96, 6, 6); g.fillRect(76, 90, 6, 6);
  g.fillRect(48, 104, 6, 6); g.fillRect(28, 100, 4, 4);
  // ── THREE HEADS ──
  g.fillStyle(0x4a6b33); g.fillEllipse(20, 36, 32, 22);       // left head
  g.fillStyle(0x4a6b33); g.fillEllipse(56, 12, 34, 24);        // center head (top)
  g.fillStyle(0x4a6b33); g.fillEllipse(92, 48, 30, 20);       // right head (low)
  g.fillStyle(0x33451f);                                       // jaw shadows
  g.fillEllipse(20, 42, 26, 8); g.fillEllipse(56, 20, 28, 8); g.fillEllipse(92, 54, 24, 8);
  g.fillStyle(0x5a8040);                                       // lit crowns
  g.fillEllipse(18, 31, 20, 6); g.fillEllipse(54, 6, 22, 6); g.fillEllipse(90, 43, 18, 5);
  g.fillStyle(0x1a2610);                                       // nostrils
  g.fillRect(6, 36, 2, 2); g.fillRect(42, 12, 2, 2); g.fillRect(79, 48, 2, 2);
  g.fillStyle(0x33451f);                                       // brow ridges
  g.fillRect(21, 25, 10, 2); g.fillRect(57, 1, 10, 2); g.fillRect(93, 37, 10, 2);
  // snout biolum stripe on each head
  g.fillStyle(0x44ff88);
  g.fillRect(8, 34, 8, 4); g.fillRect(44, 10, 8, 4); g.fillRect(80, 46, 8, 4);
  // ── GLOWING EYES on all three heads (bright yellow-green) ──
  g.fillStyle(0xccff22, 0.4);                                  // glow halos
  g.fillRect(20, 26, 12, 10); g.fillRect(56, 2, 12, 10); g.fillRect(92, 38, 12, 10);
  g.fillStyle(0xccff22);                                       // eyes
  g.fillRect(22, 28, 8, 6); g.fillRect(58, 4, 8, 6); g.fillRect(94, 40, 8, 6);
  g.fillStyle(0x223300);                                       // slit pupils
  g.fillRect(24, 30, 2, 4); g.fillRect(60, 6, 2, 4); g.fillRect(96, 42, 2, 4);
  g.fillStyle(0xffffcc);                                       // eye glints
  g.fillRect(22, 28, 1, 1); g.fillRect(58, 4, 1, 1); g.fillRect(94, 40, 1, 1);
  // ── FANGS on all three mouths ──
  g.fillStyle(0x1a2610);                                       // dark maws
  g.fillRect(8, 42, 20, 4); g.fillRect(44, 18, 24, 4); g.fillRect(80, 54, 20, 4);
  g.fillStyle(0xeeffdd);
  g.fillTriangle(10, 42, 14, 42, 12, 50);  g.fillTriangle(22, 42, 26, 42, 24, 50);   // left
  g.fillTriangle(48, 18, 52, 18, 50, 28); g.fillTriangle(62, 18, 66, 18, 64, 28);     // center
  g.fillTriangle(82, 54, 86, 54, 84, 62); g.fillTriangle(94, 54, 98, 54, 96, 62); // right
  g.fillStyle(0xbbccaa);                                       // shaded side of each fang
  g.fillTriangle(12, 42, 14, 42, 12, 50); g.fillTriangle(24, 42, 26, 42, 24, 50);
  g.fillTriangle(50, 18, 52, 18, 50, 28); g.fillTriangle(64, 18, 66, 18, 64, 28);
  g.fillTriangle(84, 54, 86, 54, 84, 62); g.fillTriangle(96, 54, 98, 54, 96, 62);
  g.generateTexture('boss_hydra', 112, 120);

  // Boss shadow — dark translucent ellipse that tracks under every boss
  g.clear();
  g.fillStyle(0x000000, 0.45); g.fillEllipse(28, 8, 52, 14);
  g.fillStyle(0x000000, 0.25); g.fillEllipse(28, 8, 56, 16);
  g.generateTexture('boss_shadow', 56, 16);

  // Enemy sprites
  drawWolf(g); drawRat(g); drawBear(g); drawIceCrawler(g); drawSpiderRuins(g); drawBogLurker(g); drawDustHound(g); drawWaterLurker(g);

  polishActors(scene);
  buildAtlases(scene);
  g.destroy();
}

// ── TEXTURE ATLASES ───────────────────────────────────────────────────────────
// Composites individually-generated textures into two GPU atlases so Phaser's
// WebGL batcher can group all player sprites — and all raider sprites — into
// a single texture bind per atlas per frame. Cuts draw calls by ~60–80%.
// Individual textures remain in the TextureManager (are not removed); only
// the atlas-backed sprites benefit from batching.
// ── MOUNTAIN RIDGES ───────────────────────────────────────────
// Five 224x176 variants: 'mountain', 'mountain2' … 'mountain5'. Ridge control points (in 112x88
// units, doubled on use) run
// left base → peaks → right base; each column gets ±2 px of hashed roughness.
function drawMountains(g) {
  // Drawn at 224x176 and shown near 1x so mountain pixels match the 1.5x characters.
  const W = 224, H = 176, BASE = 160, K = 2;
  const variants = [
    [[0,BASE],[14,58],[26,40],[38,22],[46,10],[52,16],[62,30],[74,44],[90,60],[112,BASE]],                      // tall peak left of centre
    [[0,BASE],[12,62],[22,36],[30,24],[36,30],[48,42],[60,34],[72,14],[78,20],[90,42],[100,60],[112,BASE]],     // twin peaks, right one higher
    [[0,BASE],[10,66],[20,50],[34,38],[44,30],[56,28],[66,32],[80,40],[94,56],[112,BASE]],                      // broad low dome
    [[0,BASE],[16,60],[28,34],[40,12],[44,18],[52,28],[58,24],[64,30],[76,48],[84,46],[96,62],[112,BASE]],      // spire with a shoulder
    [[0,BASE],[8,64],[18,46],[26,52],[36,32],[48,18],[56,8],[62,14],[70,26],[82,38],[92,50],[102,66],[112,BASE]], // stepped ridge
  ];
  const hash = (i, x) => {
    let h = (Math.imul(i + 1, 374761393) + Math.imul(x + 7, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const shade = (c, d) => { // add d to every channel, clamped
    const r = Math.max(0, Math.min(255, (c >> 16) + d)), gg = Math.max(0, Math.min(255, ((c >> 8) & 255) + d)), b = Math.max(0, Math.min(255, (c & 255) + d));
    return (r << 16) | (gg << 8) | b;
  };
  variants.forEach((pts0, vi) => {
    const pts = pts0.map(([x, y]) => [x * K, y === 80 ? BASE : y * K]);
    g.clear();
    const ridge = new Array(W), smooth = new Array(W);
    for (let x = 0; x < W; x++) {
      let k = 0; while (k < pts.length - 2 && pts[k + 1][0] <= x) k++;
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
      const t = (x - x0) / (x1 - x0);
      smooth[x] = y0 + (y1 - y0) * t;
      ridge[x] = Math.max(2, Math.round(smooth[x] + (hash(vi, x) - 0.5) * 5));
    }
    const peakY = Math.min(...ridge);
    const snowLine = peakY + 16 * K;
    for (let x = 0; x < W; x++) {
      const top = Math.min(ridge[x], BASE - 5);
      // Face shading from the smooth ridge (the jitter only roughens the silhouette):
      // climbing to the right = lit by the top-left light, falling away = in shadow.
      const slope = smooth[Math.min(W - 1, x + 6)] - smooth[Math.max(0, x - 6)];
      const face = slope < -0.5 ? 16 : slope > 0.5 ? -18 : 0;
      const snowDepth = (5 + Math.floor(hash(vi, x * 13) * 6)) * K;
      let runStart = top, runCol = null;
      const flush = (yEnd) => { if (runCol !== null && yEnd > runStart) { g.fillStyle(runCol); g.fillRect(x, runStart, 1, yEnd - runStart); } };
      for (let y = top; y < BASE; y++) {
        const f = (y - peakY) / (BASE - peakY);
        let col = f < 0.33 ? 0x5c5757 : f < 0.66 ? 0x4b4646 : 0x3b3737;
        col = shade(col, face);
        if (y % 22 < 2 && f > 0.3) col = shade(col, -10);                                     // faint strata line
        if (y < snowLine && y - top < snowDepth) col = face > 0 ? 0xf4f4f4 : face < 0 ? 0xcdd2d8 : 0xe6e8ec; // snow follows the ridge
        if (y >= BASE - 5) col = 0x241f1e;                                                     // rubble foot
        if (col !== runCol) { flush(y); runStart = y; runCol = col; }
      }
      flush(BASE);
    }
    g.generateTexture(vi === 0 ? 'mountain' : 'mountain' + (vi + 1), W, H);
  });
}

// ── ACTOR POLISH ──────────────────────────────────────────────
// ponytail: outline + baked ground shadow as one canvas pass over each generated actor
// texture, instead of editing every rectangle in ~3,800 lines of draw code. The shadow
// rides inside the frame (it flips and squashes with the sprite); upgrade path is a
// tracked shadow sprite per actor if that ever reads wrong.
function polishActor(scene, key, opts) {
  const shadow = !opts || opts.shadow !== false;
  const tex = scene.textures.get(key);
  if (!tex || tex.key !== key) return;
  const src = tex.getSourceImage();
  const w = src.width, h = src.height;
  const PAD = 1, FOOT = shadow ? 4 : 0;
  const nw = w + PAD * 2, nh = h + PAD * 2 + FOOT;
  const c = document.createElement('canvas'); c.width = nw; c.height = nh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, PAD, PAD);
  const img = ctx.getImageData(0, 0, nw, nh), d = img.data;
  const solid = new Uint8Array(nw * nh);
  let feet = -1, fx0 = nw, fx1 = -1;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    if (d[(y * nw + x) * 4 + 3] > 40) { solid[y * nw + x] = 1; feet = y; }
  }
  for (let y = Math.max(0, feet - 5); y <= feet; y++) for (let x = 0; x < nw; x++) {
    if (solid[y * nw + x]) { if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; }
  }
  // one-pixel near-black outline: every transparent pixel 4-adjacent to a solid one
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const i = y * nw + x;
    if (solid[i]) continue;
    if ((x > 0 && solid[i - 1]) || (x < nw - 1 && solid[i + 1]) || (y > 0 && solid[i - nw]) || (y < nh - 1 && solid[i + nw])) {
      d[i * 4] = 0x14; d[i * 4 + 1] = 0x10; d[i * 4 + 2] = 0x16; d[i * 4 + 3] = 255;
    }
  }
  // Cheap volume: lighten silhouette edges facing the top-left light, darken edges facing
  // away, and shade the lower part of the figure a little. Only silhouette edges are touched,
  // so interior colour borders stay crisp.
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const i = y * nw + x;
    if (!solid[i]) continue;
    const litEdge = (y > 0 && !solid[i - nw]) || (x > 0 && !solid[i - 1]);
    const darkEdge = (y < nh - 1 && !solid[i + nw]) || (x < nw - 1 && !solid[i + 1]);
    let m = 1;
    if (litEdge && !darkEdge) m = 1.22; else if (darkEdge && !litEdge) m = 0.78;
    const fy = feet > 0 ? y / feet : 0;
    if (fy > 0.6) m *= 1 - (fy - 0.6) * 0.3;
    if (m !== 1) { d[i * 4] = Math.min(255, d[i * 4] * m); d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] * m); d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] * m); }
  }
  ctx.putImageData(img, 0, 0);
  if (shadow && feet >= 0 && fx1 >= fx0) {
    ctx.globalCompositeOperation = 'destination-over';
    const cx = (fx0 + fx1 + 1) / 2, rx = Math.max(4, (fx1 - fx0 + 1) * 0.55);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath(); ctx.ellipse(cx, feet + 1.5, rx, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  scene.textures.remove(key);
  scene.textures.addCanvas(key, c);
}

const PLAYER_IDS = ['knight', 'gunslinger', 'architect', 'charmer', 'ranger'];
const RAIDER_IDS = ['raider_brawler', 'raider_shooter', 'raider_heavy'];
const DIRS = ['', '_front', '_back', '_fside', '_bside'];
const GROUND_ENEMY_KEYS = ['wolf', 'rat', 'bear', 'ice_crawler', 'spider_ruins', 'bog_lurker', 'dust_hound'];
const BOSS_KEYS = ['boss_golem', 'boss_wolf', 'boss_spider', 'boss_troll', 'boss_hydra'];

function polishActors(scene) {
  for (const id of PLAYER_IDS) {
    for (const dir of DIRS) for (const f of ['', '_step', '_step2']) polishActor(scene, id + dir + f);
    polishActor(scene, id + '_atk'); for (const dir of DIRS.slice(1)) polishActor(scene, id + '_atk' + dir);
  }
  for (const id of RAIDER_IDS) for (const dir of DIRS) for (const f of ['', '_step', '_step2']) polishActor(scene, id + dir + f);
  for (const k of GROUND_ENEMY_KEYS) polishActor(scene, k);
  polishActor(scene, 'water_lurker', { shadow: false });
  for (const k of BOSS_KEYS) polishActor(scene, k, { shadow: false }); // bosses already carry a tracked shadow sprite
}

function buildAtlases(scene) {
  if (scene.textures.exists('player_atlas')) return;

  // ── player_atlas: 5 characters × 20 frames = 100 frames (44×60 drawn, 46×66 after polish) ──
  const PLAYER_COLS = 20;
  const pSrc = scene.textures.get('knight').getSourceImage();
  const PW = pSrc.width, PH = pSrc.height;
  const PLAYER_KEYS = [
    'knight','knight_step','knight_front','knight_front_step','knight_back','knight_back_step',
    'knight_fside','knight_fside_step','knight_bside','knight_bside_step',
    'knight_atk','knight_atk_front','knight_atk_back','knight_atk_fside','knight_atk_bside',
    'knight_step2','knight_front_step2','knight_back_step2','knight_fside_step2','knight_bside_step2',
    'gunslinger','gunslinger_step','gunslinger_front','gunslinger_front_step','gunslinger_back','gunslinger_back_step',
    'gunslinger_fside','gunslinger_fside_step','gunslinger_bside','gunslinger_bside_step',
    'gunslinger_atk','gunslinger_atk_front','gunslinger_atk_back','gunslinger_atk_fside','gunslinger_atk_bside',
    'gunslinger_step2','gunslinger_front_step2','gunslinger_back_step2','gunslinger_fside_step2','gunslinger_bside_step2',
    'architect','architect_step','architect_front','architect_front_step','architect_back','architect_back_step',
    'architect_fside','architect_fside_step','architect_bside','architect_bside_step',
    'architect_atk','architect_atk_front','architect_atk_back','architect_atk_fside','architect_atk_bside',
    'architect_step2','architect_front_step2','architect_back_step2','architect_fside_step2','architect_bside_step2',
    'charmer','charmer_step','charmer_front','charmer_front_step','charmer_back','charmer_back_step',
    'charmer_fside','charmer_fside_step','charmer_bside','charmer_bside_step',
    'charmer_atk','charmer_atk_front','charmer_atk_back','charmer_atk_fside','charmer_atk_bside',
    'charmer_step2','charmer_front_step2','charmer_back_step2','charmer_fside_step2','charmer_bside_step2',
    'ranger','ranger_step','ranger_front','ranger_front_step','ranger_back','ranger_back_step',
    'ranger_fside','ranger_fside_step','ranger_bside','ranger_bside_step',
    'ranger_atk','ranger_atk_front','ranger_atk_back','ranger_atk_fside','ranger_atk_bside',
    'ranger_step2','ranger_front_step2','ranger_back_step2','ranger_fside_step2','ranger_bside_step2',
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

  // ── raider_atlas: 3 types × 15 frames = 45 frames (44×60 drawn, 46×66 after polish) ──
  const RAIDER_COLS = 15;
  const rSrc = scene.textures.get('raider_brawler').getSourceImage();
  const RW = rSrc.width, RH = rSrc.height;
  const RAIDER_KEYS = [
    'raider_brawler','raider_brawler_step','raider_brawler_front','raider_brawler_front_step',
    'raider_brawler_back','raider_brawler_back_step','raider_brawler_fside','raider_brawler_fside_step',
    'raider_brawler_bside','raider_brawler_bside_step',
    'raider_brawler_step2','raider_brawler_front_step2','raider_brawler_back_step2','raider_brawler_fside_step2','raider_brawler_bside_step2',
    'raider_shooter','raider_shooter_step','raider_shooter_front','raider_shooter_front_step',
    'raider_shooter_back','raider_shooter_back_step','raider_shooter_fside','raider_shooter_fside_step',
    'raider_shooter_bside','raider_shooter_bside_step',
    'raider_shooter_step2','raider_shooter_front_step2','raider_shooter_back_step2','raider_shooter_fside_step2','raider_shooter_bside_step2',
    'raider_heavy','raider_heavy_step','raider_heavy_front','raider_heavy_front_step',
    'raider_heavy_back','raider_heavy_back_step','raider_heavy_fside','raider_heavy_fside_step',
    'raider_heavy_bside','raider_heavy_bside_step',
    'raider_heavy_step2','raider_heavy_front_step2','raider_heavy_back_step2','raider_heavy_fside_step2','raider_heavy_bside_step2',
  ];
  const rAtlasW = RAIDER_COLS * RW;
  const rAtlasH = Math.ceil(RAIDER_KEYS.length / RAIDER_COLS) * RH;
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

// ── DIRECTIONAL / WALK-CYCLE SPRITES ─────────────────────────

// ── KNIGHT variants ──────────────────────────────────────────
// ── GUNSLINGER variants ───────────────────────────────────────
// ── ARCHITECT variants ────────────────────────────────────────
// ── 8-DIRECTIONAL DIAGONAL SPRITES ───────────────────────────
// fside = front-diagonal (3/4 view toward camera, moving sideways)
// bside = back-diagonal  (3/4 view away from camera, moving sideways)

// ── ENEMY RAIDER DIRECTIONAL SPRITES ─────────────────────────
// All 9 directional walk-frame variants for each of the 3 raider types.
// Called once from buildTextures(); generates 27 textures on the same 26×30 canvas.
// ── LAUREN (The Charmer) sprites ─────────────────────────────
// ── ABIGAIL (The Ranger) sprites ─────────────────────────────
// ── ATTACK-POSE FRAMES ──────────────────────────────────────────
// One attack frame per direction per character. Shown briefly by _triggerAtkAnim.

// ── KNIGHT attack variants ──────────────────────────────────────
// ── GUNSLINGER attack variants ──────────────────────────────────
// ── ARCHITECT attack variants ────────────────────────────────────
// ── CHARMER (Lauren) attack variants — all show pirouette arms-out spin ──