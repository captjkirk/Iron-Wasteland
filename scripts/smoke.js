// Browser smoke run in headless WebKit (the iPad engine), two passes. Run with `npm run smoke`.
//   1. Title screen: fails unless ModeSelect comes up with no console error and no page error.
//   2. In play: loads ?seed=1&renderer=canvas (headless WebKit loses the WebGL context in the
//      Game scene, so the canvas renderer stands in), starts a solo game, waits for the world,
//      plays PLAY_MS and fails on any console or page error. WebGL-only bugs stay invisible.
//      Also fails when textures and object canvases hold more than PIXEL_BUDGET_MB of pixels.
//   3. Hardcore: the same start with STATE.difficulty = 'hardcore'; fails unless timeAlive
//      advances over HARDCORE_MS of play. Hardcore's own multipliers once froze the tab (#327).
// Every in-game page call goes through `ask`, so a hung main thread fails the run, not stalls it.
const { webkit } = require('playwright');
process.env.PORT = '0'; // any free port, so a running `npm run serve` is no obstacle
const server = require('../server.js');
const PLAY_MS = 10000;
const PIXEL_BUDGET_MB = 64; // RGBA bytes; an iPhone tab dies well short of 1 GB in total
const HARDCORE_MS = 5000;
const ASK_MS = 10000; // a page call that takes longer means the game's main thread is stuck

// page.evaluate with a deadline: Playwright waits forever on a page whose script never yields.
function ask(page, fn, arg) {
  let timer;
  return Promise.race([
    page.evaluate(fn, arg),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`page did not answer in ${ASK_MS / 1000} s (main thread stuck?)`)), ASK_MS); }),
  ]).finally(() => clearTimeout(timer));
}

// Starts a solo knight game at the given difficulty, waits for the world and plays ms of it.
// Returns how many seconds of timeAlive passed during that play.
async function play(page, difficulty, ms) {
  await ask(page, d => { STATE.mode = 1; STATE.p1CharId = 'knight'; STATE.difficulty = d; _phaserGame.scene.start('Game'); }, difficulty);
  await page.waitForFunction(() => _phaserGame.scene.getScene('Game')._worldReady === true,
    null, { timeout: 60000 });
  const t0 = await ask(page, () => _phaserGame.scene.getScene('Game').timeAlive);
  await page.waitForTimeout(ms);
  return (await ask(page, () => _phaserGame.scene.getScene('Game').timeAlive)) - t0;
}

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
  await Promise.race([page.close(), new Promise(r => setTimeout(r, ASK_MS))]);
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

  failures += await pass(browser, 'in play', base + '?seed=1&renderer=canvas', async page => {
    await play(page, 'survival', PLAY_MS);
    const fps = await ask(page, () => Math.round(_phaserGame.loop.actualFps));
    console.log(`in play: world built, ${PLAY_MS / 1000} s played at ${fps} fps`);
    // Pixel memory: every texture plus every canvas a game object owns (TileSprite, Text).
    // A world-sized TileSprite and 10k patch TileSprites once came to ~735 MB here and got
    // the tab killed on iPhone (#238).
    const px = await ask(page, () => {
      let n = 0;
      for (const t of Object.values(_phaserGame.textures.list)) for (const s of t.source) n += s.width * s.height;
      for (const o of _phaserGame.scene.getScene('Game').children.list) if (o.canvas) n += o.canvas.width * o.canvas.height;
      return n;
    });
    // Scenery hitboxes cover the base, not the whole sprite (#268: refreshBody() after setSize
    // silently reset them to the full picture, blocking open ground beside every mountain).
    const fat = await ask(page, () => _phaserGame.scene.getScene('Game').obstacles.getChildren()
      .filter(o => /^(mountain|ice_spire|rock_spire|mangrove_roots|pillar)/.test(o.texture.key))
      .filter(o => o.body.height > o.displayHeight * 0.75)
      .map(o => o.texture.key));
    if (fat.length) throw new Error(`${fat.length} scenery hitboxes are nearly the whole sprite (first: ${fat[0]})`);
    const mb = Math.round(px * 4 / 1e6);
    console.log(`in play: ${mb} MB of pixel memory (budget ${PIXEL_BUDGET_MB} MB)`);
    if (mb > PIXEL_BUDGET_MB) throw new Error(`pixel memory ${mb} MB is over the ${PIXEL_BUDGET_MB} MB budget`);
  });

  failures += await pass(browser, 'hardcore', base + '?seed=1&renderer=canvas', async page => {
    const ran = await play(page, 'hardcore', HARDCORE_MS);
    console.log(`hardcore: world built, timeAlive advanced ${ran.toFixed(1)} s in ${HARDCORE_MS / 1000} s of play`);
    if (!(ran >= 1)) throw new Error(`timeAlive advanced only ${ran} s in ${HARDCORE_MS / 1000} s of Hardcore play`);
  });

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
