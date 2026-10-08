// Browser smoke run in headless WebKit (the iPad engine), two passes. Run with `npm run smoke`.
//   1. Title screen: fails unless ModeSelect comes up with no console error and no page error.
//   2. In play: loads ?seed=1&renderer=canvas (headless WebKit loses the WebGL context in the
//      Game scene, so the canvas renderer stands in), starts a solo game, waits for the world,
//      plays PLAY_MS and fails on any console or page error. WebGL-only bugs stay invisible.
//      Also fails when textures and object canvases hold more than PIXEL_BUDGET_MB of pixels.
const { webkit } = require('playwright');
process.env.PORT = '0'; // any free port, so a running `npm run serve` is no obstacle
const server = require('../server.js');
const PLAY_MS = 10000;
const PIXEL_BUDGET_MB = 64; // RGBA bytes; an iPhone tab dies well short of 1 GB in total

async function pass(browser, name, url, run, opts = {}) {
  const page = await browser.newPage(opts);
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

(async () => {
  if (!server.listening) await new Promise(r => server.once('listening', r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await webkit.launch();
  let failures = 0;

  failures += await pass(browser, 'title screen', base, async () => {});

  // Character screen at both layouts: 1280x720, and the 640x360 phone layout (a touch device
  // whose short side is under 600 px). Turns the wheel both ways and fails on any page error.
  for (const [name, opts] of [['character screen 1280x720', {}],
    ['character screen 640x360', { viewport: { width: 740, height: 390 }, hasTouch: true }]]) {
    failures += await pass(browser, name, base, async page => {
      await page.evaluate(() => { STATE.mode = 1; _phaserGame.scene.start('CharSelect'); });
      await page.waitForFunction(() => _phaserGame.scene.isActive('CharSelect'), null, { timeout: 10000 });
      for (const k of ['d', 'd', 'a', 'ArrowLeft']) { await page.keyboard.press(k); await page.waitForTimeout(300); }
      const w = await page.evaluate(() => CFG.W);
      if (w !== (opts.hasTouch ? 640 : 1280)) throw new Error(`canvas is ${w} wide`);
    }, opts);
  }

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
  });

  // 2-player on touch. Fingers on each player's stick move only that player; fails on any page error
  // or when a player does not move the way their stick was dragged.
  //  - phone (740x390, touch): left/right halves, P1 left and P2 right (#288).
  //  - tablet (1280x720): face-to-face split, P1 bottom half, P2 top half turned 180 degrees (#387).
  const twoPlayer = async (page, split) => {
    await page.evaluate(() => {
      saveSettings({ inputMode: 'touch', tutorial: false });
      STATE.mode = 2; STATE.p1CharId = 'knight'; STATE.p2CharId = 'gunslinger'; _phaserGame.scene.start('Game');
    });
    await page.waitForFunction(() => _phaserGame.scene.getScene('Game')._worldReady === true, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async (split) => {
      const g = _phaserGame.scene.getScene('Game'), { W, H } = CFG;
      if (!g._pads || g._pads.length !== 2) throw new Error('no split touch pads');
      if (g._split !== split) throw new Error(`_split is ${g._split}, expected ${split}`);
      const at = () => [g.p1.spr.x, g.p1.spr.y, g.p2.spr.x, g.p2.spr.y];
      const before = at();
      // Both fingers drag screen-right at once. P2's stick zone is top-right in a split.
      const p2x = split ? W * 0.85 : W * 0.65, p2y = split ? 100 : H * 0.8;
      g._onTouchDown({ id: 1, x: W * 0.15, y: H * 0.8 }); g._onTouchDown({ id: 2, x: p2x, y: p2y });
      g._onTouchMove({ id: 1, x: W * 0.15 + 60, y: H * 0.8 });
      g._onTouchMove({ id: 2, x: p2x + (split ? 60 : -60), y: p2y });
      await new Promise(r => setTimeout(r, 700));
      g._onTouchUp({ id: 1 }); g._onTouchUp({ id: 2 });
      const after = at();
      const cams = split && {
        count: g._worldCams().length, H, rot: g.cam2.rotation,
        h1: g.cameras.main.height, y1: g.cameras.main.y, h2: g.cam2.height, y2: g.cam2.y,
        d1: Math.hypot(g.cameras.main.midPoint.x - g.p1.spr.x, g.cameras.main.midPoint.y - g.p1.spr.y),
        d2: Math.hypot(g.cam2.midPoint.x - g.p2.spr.x, g.cam2.midPoint.y - g.p2.spr.y),
      };
      return { p1: after[0] - before[0], p2: after[2] - before[2], cams };
    }, split);
    console.log(`2-player touch (${split ? 'split' : 'phone'}): P1 moved ${Math.round(r.p1)} px, P2 moved ${Math.round(r.p2)} px`);
    // Phone: P2's finger dragged left. Split: P2's finger dragged screen-right, but P2's view is turned
    // around, so P2 walks world-left. Either way P1 goes right and P2 goes left.
    if (!(r.p1 > 5 && r.p2 < -5)) throw new Error('a player did not move the way their half was dragged');
    if (split) {
      const c = r.cams;
      if (c.count !== 2 || Math.abs(c.rot - Math.PI) > 1e-6) throw new Error('P2 has no camera turned 180 degrees');
      if (!(c.y1 > c.y2 && c.h1 === c.h2 && c.h1 < c.H / 2)) throw new Error('the halves are not top and bottom with a strip between');
      if (c.d1 > 60 || c.d2 > 60) throw new Error(`a half is not centred on its player (off by ${Math.round(c.d1)}, ${Math.round(c.d2)} px)`);
    }
  };
  failures += await pass(browser, '2-player touch, phone', base + '?seed=1&renderer=canvas',
    page => twoPlayer(page, false), { viewport: { width: 740, height: 390 }, hasTouch: true });
  failures += await pass(browser, '2-player touch, tablet split', base + '?seed=1&renderer=canvas',
    page => twoPlayer(page, true));

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
