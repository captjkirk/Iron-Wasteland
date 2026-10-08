// Browser smoke run in headless WebKit (the iPad engine), two passes. Run with `npm run smoke`.
//   1. Title screen: fails unless ModeSelect comes up with no console error and no page error.
//   2. In play: loads ?seed=1&renderer=canvas (headless WebKit loses the WebGL context in the
//      Game scene, so the canvas renderer stands in), starts a solo game, waits for the world,
//      plays PLAY_MS and fails on any console or page error. WebGL-only bugs stay invisible.
//      Also fails when textures and object canvases hold more than PIXEL_BUDGET_MB of pixels.
//      Then jumps to boss days 5 and 10 and fails unless each brings a boss, of two types.
//      Then ends the run and types a two-word name on the game over screen (#328).
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

async function pass(browser, name, url, run, opts = {}) {
  const page = await browser.newPage(opts);
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

  failures += await pass(browser, 'in play', base + '?seed=1&renderer=canvas', async (page, posts) => {
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
    // Boss days (#329): the day-5 boss spawns, dies, and day 10 brings a second boss of
    // another type. The day is set directly; the day-10 roll is forced to 100%.
    const bosses = [];
    for (const day of [5, 10]) {
      await page.evaluate(day => {
        const s = _phaserGame.scene.getScene('Game');
        s._bossChance = 1;
        s.dayTimer = (day - 1) * s.DAY_DUR + 1000;
        s.p1.hp = s.p1.maxHp;
      }, day);
      await page.waitForFunction(() => _phaserGame.scene.getScene('Game').boss, null, { timeout: 30000 })
        .catch(() => { throw new Error(`no boss spawned on day ${day} (bosses so far: ${bosses.join(', ') || 'none'})`); });
      bosses.push(await page.evaluate(() => {
        const s = _phaserGame.scene.getScene('Game'), b = s.boss;
        s._hurtEnemy(b, 1e6);
        return b.type;
      }));
    }
    console.log(`in play: boss days 5 and 10 brought ${bosses.join(', ')}`);
    if (bosses[0] === bosses[1]) throw new Error(`day 10 brought the same boss again (${bosses[1]})`);
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

  failures += await pass(browser, 'hardcore', base + '?seed=1&renderer=canvas', async page => {
    const ran = await play(page, 'hardcore', HARDCORE_MS);
    console.log(`hardcore: world built, timeAlive advanced ${ran.toFixed(1)} s in ${HARDCORE_MS / 1000} s of play`);
    if (!(ran >= 1)) throw new Error(`timeAlive advanced only ${ran} s in ${HARDCORE_MS / 1000} s of Hardcore play`);
  });

  // 2-player on touch: split touch, one pad per half. Fingers on each half's stick move only that
  // half's player; fails on any page error or when a player does not move.
  failures += await pass(browser, '2-player touch', base + '?seed=1&renderer=canvas', async page => {
    await page.evaluate(() => {
      saveSettings({ inputMode: 'touch', tutorial: false });
      STATE.mode = 2; STATE.p1CharId = 'knight'; STATE.p2CharId = 'gunslinger'; _phaserGame.scene.start('Game');
    });
    await page.waitForFunction(() => _phaserGame.scene.getScene('Game')._worldReady === true, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const moved = await page.evaluate(async () => {
      const g = _phaserGame.scene.getScene('Game'), { W, H } = CFG;
      if (!g._pads || g._pads.length !== 2) throw new Error('no split touch pads');
      const at = () => [g.p1.spr.x, g.p1.spr.y, g.p2.spr.x, g.p2.spr.y];
      const before = at();
      // P1's finger drags right on the left half, P2's drags left on the right half, at once.
      g._onTouchDown({ id: 1, x: W * 0.15, y: H * 0.8 }); g._onTouchDown({ id: 2, x: W * 0.65, y: H * 0.8 });
      g._onTouchMove({ id: 1, x: W * 0.15 + 60, y: H * 0.8 }); g._onTouchMove({ id: 2, x: W * 0.65 - 60, y: H * 0.8 });
      await new Promise(r => setTimeout(r, 700));
      g._onTouchUp({ id: 1 }); g._onTouchUp({ id: 2 });
      const after = at();
      return { p1: after[0] - before[0], p2: after[2] - before[2] };
    });
    console.log(`2-player touch: P1 moved ${Math.round(moved.p1)} px, P2 moved ${Math.round(moved.p2)} px`);
    if (!(moved.p1 > 5 && moved.p2 < -5)) throw new Error('a player did not move the way their half was dragged');
  });

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
