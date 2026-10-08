// Browser smoke run in headless WebKit (the iPad engine), two passes. Run with `npm run smoke`.
//   1. Title screen: fails unless ModeSelect comes up with no console error and no page error.
//   2. In play: loads ?seed=1&renderer=canvas (headless WebKit loses the WebGL context in the
//      Game scene, so the canvas renderer stands in), starts a solo game, waits for the world,
//      plays PLAY_MS and fails on any console or page error. WebGL-only bugs stay invisible.
//      Also fails when textures and object canvases hold more than PIXEL_BUDGET_MB of pixels.
//      Then spawns each boss beside the knight and fails unless its hitbox fits the drawing and
//      mirrors, and a knight swing from 20 px outside it, left and right, deals damage and one
//      from 100 px out does not (#312, #317).
const { webkit } = require('playwright');
process.env.PORT = '0'; // any free port, so a running `npm run serve` is no obstacle
const server = require('../server.js');
const PLAY_MS = 10000;
const PIXEL_BUDGET_MB = 64; // RGBA bytes; an iPhone tab dies well short of 1 GB in total

async function pass(browser, name, url, run) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console error: ' + m.text()); });
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  try {
    await page.goto(url);
    await page.waitForFunction(
      () => typeof _phaserGame !== 'undefined' && _phaserGame.scene.isActive('ModeSelect'),
      null, { timeout: 30000 });
    await page.waitForTimeout(1000); // let ModeSelect run a few frames
    await run(page);
  } catch (e) {
    errors.push(`${name}: ${e.message.split('\n')[0]}`);
  }
  await page.close();
  for (const e of errors) console.error(`::error::${name}: ${e}`);
  if (!errors.length) console.log(`Smoke ${name} OK.`);
  return errors.length;
}

// Boss hitboxes fit the drawing (#312, #317): each box spans at least 60% of the drawn width and
// height (the old 84 px square was under half), mirrors when the boss turns, and the knight's
// sword (range 55, as doAttack swings it) reaches it from 20 px outside, not from 100 px.
async function bossReach(page) {
  const keys = ['boss_golem', 'boss_wolf', 'boss_spider', 'boss_troll', 'boss_hydra'];
  const misses = [];
  for (const key of keys) {
    misses.push(...await page.evaluate(key => {
      const g = _phaserGame.scene.getScene('Game');
      g.bossSpawned = false; g.spawnBoss(key);
      const b = g.boss; // stands still and holds its attacks
      b.speed = 0; b.specialTimer = b.specialInterval = b.attackTimer = b.atkInterval = 1e9;
      g.p1.hp = g.p1.maxHp = 1e6;
      g._reachHome = g._reachHome || { x: g.p1.spr.x, y: g.p1.spr.y };
      const img = g.textures.get(key).getSourceImage(), c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const a = ctx.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        if (a[(y * c.width + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = y; }
      }
      const hb = b.hitbox, fit = Math.min(hb.w / (x1 - x0 + 1), hb.h / (y1 - y0 + 1));
      return fit < 0.6 ? [`${key}: hitbox ${hb.w}x${hb.h} covers only ${Math.round(fit * 100)}% of the ${x1 - x0 + 1}x${y1 - y0 + 1} drawing`] : [];
    }, key));
    const offsets = [];
    for (const side of [-1, 1]) {
      await page.evaluate(side => { // the boss turns toward the knight and mirrors its box
        const g = _phaserGame.scene.getScene('Game'), h = g._reachHome;
        g.boss.spr.body.reset(h.x, h.y);
        g.p1.spr.body.reset(h.x + side * 300, h.y);
      }, side);
      await page.waitForTimeout(300);
      const r = await page.evaluate(({ key, side }) => {
        const g = _phaserGame.scene.getScene('Game'), b = g.boss, body = b.spr.body, p = g.p1;
        const out = [], offset = (body.center.x - b.spr.x) / b.spr.scaleX;
        for (const gap of [100, 20]) {
          p.spr.setPosition(side < 0 ? body.left - gap : body.right + gap, body.center.y);
          p.aimAngle = side < 0 ? 0 : Math.PI;
          const hp = b.hp;
          g.meleeSwing(p, 55, 0xdddddd, 0.18, 0);
          if ((b.hp < hp) !== (gap === 20)) out.push(`${key}: swing ${gap} px ${side < 0 ? 'left' : 'right'} of the hitbox ${b.hp < hp ? 'hit' : 'missed'}`);
        }
        return { out, offset };
      }, { key, side });
      misses.push(...r.out); offsets.push(r.offset);
    }
    if (Math.abs(offsets[0] + offsets[1]) > 1) misses.push(`${key}: hitbox does not mirror (centre ${offsets.map(o => o.toFixed(1)).join(' vs ')} texture px off the sprite centre)`);
    await page.evaluate(() => { const g = _phaserGame.scene.getScene('Game'); g.killEnemy(g.boss); });
  }
  if (misses.length) throw new Error(misses.join('; '));
  console.log(`in play: ${keys.length} boss hitboxes fit, mirror, and the knight reaches them from 20 px out, not 100 px`);
}

(async () => {
  if (!server.listening) await new Promise(r => server.once('listening', r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await webkit.launch();
  let failures = 0;

  failures += await pass(browser, 'title screen', base, async () => {});

  failures += await pass(browser, 'in play', base + '?seed=1&renderer=canvas', async page => {
    await page.evaluate(() => { STATE.mode = 1; STATE.p1CharId = 'knight'; _phaserGame.scene.start('Game'); });
    await page.waitForFunction(() => _phaserGame.scene.getScene('Game')._worldReady === true,
      null, { timeout: 60000 });
    await page.waitForTimeout(PLAY_MS);
    const fps = await page.evaluate(() => Math.round(_phaserGame.loop.actualFps));
    console.log(`in play: world built, ${PLAY_MS / 1000} s played at ${fps} fps`);
    // Pixel memory: every texture plus every canvas a game object owns (TileSprite, Text).
    // A world-sized TileSprite and 10k patch TileSprites once came to ~735 MB here and got
    // the tab killed on iPhone (#238).
    const px = await page.evaluate(() => {
      let n = 0;
      for (const t of Object.values(_phaserGame.textures.list)) for (const s of t.source) n += s.width * s.height;
      for (const o of _phaserGame.scene.getScene('Game').children.list) if (o.canvas) n += o.canvas.width * o.canvas.height;
      return n;
    });
    // Scenery hitboxes cover the base, not the whole sprite (#268: refreshBody() after setSize
    // silently reset them to the full picture, blocking open ground beside every mountain).
    const fat = await page.evaluate(() => _phaserGame.scene.getScene('Game').obstacles.getChildren()
      .filter(o => /^(mountain|ice_spire|rock_spire|mangrove_roots|pillar)/.test(o.texture.key))
      .filter(o => o.body.height > o.displayHeight * 0.75)
      .map(o => o.texture.key));
    if (fat.length) throw new Error(`${fat.length} scenery hitboxes are nearly the whole sprite (first: ${fat[0]})`);
    const mb = Math.round(px * 4 / 1e6);
    console.log(`in play: ${mb} MB of pixel memory (budget ${PIXEL_BUDGET_MB} MB)`);
    if (mb > PIXEL_BUDGET_MB) throw new Error(`pixel memory ${mb} MB is over the ${PIXEL_BUDGET_MB} MB budget`);
    await bossReach(page);
  });

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
