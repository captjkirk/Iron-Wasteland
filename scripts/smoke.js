// Browser smoke run in headless WebKit (the iPad engine), two passes. Run with `npm run smoke`.
//   1. Title screen: fails unless ModeSelect comes up with no console error and no page error.
//   2. In play: loads ?seed=1&renderer=canvas (headless WebKit loses the WebGL context in the
//      Game scene, so the canvas renderer stands in), starts a solo game, waits for the world,
//      plays PLAY_MS and fails on any console or page error. WebGL-only bugs stay invisible.
//      Also fails when textures and object canvases hold more than PIXEL_BUDGET_MB of pixels.
//      Then ends the run and types a two-word name on the game over screen (#328).
const { webkit } = require('playwright');
process.env.PORT = '0'; // any free port, so a running `npm run serve` is no obstacle
const server = require('../server.js');
const PLAY_MS = 10000;
const PIXEL_BUDGET_MB = 64; // RGBA bytes; an iPhone tab dies well short of 1 GB in total

async function pass(browser, name, url, run) {
  const page = await browser.newPage();
  const errors = [];
  const posts = []; // the global scoreboard is stubbed: no smoke run posts a real score
  await page.route('https://script.google.com/**', route => {
    if (route.request().method() === 'POST') posts.push(JSON.parse(route.request().postData()));
    route.fulfill({ contentType: 'application/json', body: route.request().method() === 'POST' ? '{"ok":true}' : '[]' });
  });
  page.on('console', m => { if (m.type() === 'error') errors.push('console error: ' + m.text()); });
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  try {
    await page.goto(url);
    await page.waitForFunction(
      () => typeof _phaserGame !== 'undefined' && _phaserGame.scene.isActive('ModeSelect'),
      null, { timeout: 30000 });
    await page.waitForTimeout(1000); // let ModeSelect run a few frames
    await run(page, posts);
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

  failures += await pass(browser, 'in play', base + '?seed=1&renderer=canvas', async (page, posts) => {
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
    // Game over name field: Phaser preventDefaults every key any scene ever captured (WASD,
    // Space, F…) unless the field keeps its keys; a name once came out as "nKi" (#328).
    await page.evaluate(() => _phaserGame.scene.getScene('Game').triggerGameOver('Smoke run over.'));
    await page.waitForFunction(() => _phaserGame.scene.isActive('GameOver') &&
      document.activeElement && document.activeElement.tagName === 'INPUT', null, { timeout: 10000 });
    await page.keyboard.type('Dad and Kids');
    const typed = await page.evaluate(() => document.activeElement.value);
    if (typed !== 'Dad and Kids' || await page.evaluate(() => _phaserGame.scene.isActive('CharSelect')))
      throw new Error(`name field holds "${typed}" after typing "Dad and Kids", or the game restarted`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (localStorage.getItem('iw_scores') || '').includes('"Dad and Kids"'), null, { timeout: 5000 });
    if (!posts.some(p => p.name === 'Dad and Kids')) throw new Error('the score was not posted to the (stubbed) scoreboard');
    console.log('game over: typed name kept and saved');
  });

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
