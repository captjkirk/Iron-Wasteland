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

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
