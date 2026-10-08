// Browser smoke run in headless WebKit (the iPad engine), two passes. Run with `npm run smoke`.
//   1. Title screen: fails unless ModeSelect comes up with no console error and no page error.
//   2. In play: loads ?seed=1&renderer=canvas (headless WebKit loses the WebGL context in the
//      Game scene, so the canvas renderer stands in), starts a solo game, waits for the world,
//      plays PLAY_MS and fails on any console or page error. WebGL-only bugs stay invisible.
//      Walks east for the first WALK_MS and fails unless that leaves boot prints, none on water.
//      Fires wave 1 at the start and fails unless it is awake and closing on the player, and its
//      first group is small (night 1 comes in groups, not all at once).
//      Also fails when textures and object canvases hold more than PIXEL_BUDGET_MB of pixels.
//      Then spawns each boss beside the knight and fails unless its hitbox fits the drawing and
//      mirrors, and a knight swing from 20 px outside it, left and right, deals damage and one
//      from 100 px out does not (#312, #317).
//      Then jumps to boss days 5 and 10 and fails unless each brings a boss, of two types.
//      Then lines up three 1-HP enemies in front of the knight and fails unless one swing kills all three.
//      Then ends the run and types a two-word name on the game over screen (#328).
//      Also, on an iPad-sized touch screen (1180x820), fails unless every inventory icon and number has a real position above the fog (#414).
//   3. Hardcore: the same start with STATE.difficulty = 'hardcore'; fails unless timeAlive
//      advances over HARDCORE_MS of play. Hardcore's own multipliers once froze the tab (#327).
// Every in-game page call goes through `ask`, so a hung main thread fails the run, not stalls it.
const { webkit } = require('playwright');
process.env.PORT = '0'; // any free port, so a running `npm run serve` is no obstacle
const server = require('../server.js');
const PLAY_MS = 10000;
const WALK_MS = 3000; // spent walking east before the wave check
const PIXEL_BUDGET_MB = 64; // RGBA bytes; an iPhone tab dies well short of 1 GB in total
const HARDCORE_MS = 5000;
const FIRST_WAVE_MAX = 10; // night 1's first group; matches _spawnFirstWave's cap
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
        // The box's centre from its offset, in texture px off the frame centre. body.center - spr.x
        // drifts while the big body is pushed off scenery or a hit tween rescales it (#317).
        const out = [], offset = body.offset.x + b.hitbox.w / 2 - b.spr.width / 2;
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

  // Character screen at both layouts: 1280x720, and the 640x360 phone layout (a touch device
  // whose short side is under 600 px). Turns the wheel both ways and fails on any page error.
  for (const [name, opts] of [['character screen 1280x720', {}],
    ['character screen 640x360', { viewport: { width: 640, height: 360 }, hasTouch: true }]]) {
    failures += await pass(browser, name, base, async page => {
      await page.evaluate(() => { STATE.mode = 1; _phaserGame.scene.start('CharSelect'); });
      await page.waitForFunction(() => _phaserGame.scene.isActive('CharSelect'), null, { timeout: 10000 });
      for (const k of ['d', 'd', 'a', 'ArrowLeft']) { await page.keyboard.press(k); await page.waitForTimeout(300); }
      const w = await page.evaluate(() => CFG.W);
      if (w !== (opts.hasTouch ? 640 : 1280)) throw new Error(`canvas is ${w} wide`);
    }, opts);
  }

  failures += await pass(browser, 'in play', base + '?seed=1&renderer=canvas', async (page, posts) => {
    await play(page, 'survival', 0);
    // Walk east for WALK_MS: the player must leave tracks, and none on water (#308).
    await page.keyboard.down('d');
    await page.waitForTimeout(WALK_MS);
    await page.keyboard.up('d');
    const tracks = await ask(page, () => {
      const s = _phaserGame.scene.getScene('Game');
      return { n: s.tracks.live.length, wet: s.tracks.live.filter(r => s._waterMap[r.tile]).length };
    });
    console.log(`in play: walked ${WALK_MS / 1000} s and left ${tracks.n} boot prints, ${tracks.wet} on water`);
    if (!tracks.n) throw new Error('walking left no boot prints');
    if (tracks.wet) throw new Error(`${tracks.wet} boot prints sit on water`);
    // Fire wave 1 now, and play through its march. Waves used to spawn at the map edge
    // and go dormant on their first frame, so nothing ever arrived (#330).
    const march0 = await page.evaluate(() => {
      const s = _phaserGame.scene.getScene('Game');
      const before = new Set(s.enemies);
      s.waveTimer = s.WAVE_INTERVAL;
      s.updateWaves(0);
      const near = e => Math.min(...[s.p1, s.p2].filter(p => p && p.spr && p.spr.active)
        .map(p => Math.hypot(e.spr.x - p.spr.x, e.spr.y - p.spr.y)));
      window._smokeWave = s.enemies.filter(e => !before.has(e) && e._waveMarch && !e._dormant)
        .map(e => ({ e, d0: near(e) }));
      window._smokeNear = near;
      return { spawned: s.enemies.length - before.size, marching: window._smokeWave.length };
    });
    await page.waitForTimeout(PLAY_MS);
    const closed = await page.evaluate(() => window._smokeWave
      .filter(w => w.e.spr && w.e.spr.active && w.d0 - window._smokeNear(w.e) > 100).length);
    console.log(`in play: wave 1 spawned ${march0.spawned}, ${march0.marching} awake and marching, ` +
      `${closed} closed in by 100+ px in ${PLAY_MS / 1000} s`);
    if (!march0.marching || !closed) throw new Error('wave 1 did not march on the players (#330)');
    // Night 1 arrives in small groups: no more than FIRST_WAVE_MAX of wave 1 awake in its first group
    // (all 21 at once swarmed a young player). The later groups would reach the knight during the
    // checks below, so the pacing timer is stopped.
    await ask(page, () => { _phaserGame.scene.getScene('Game')._firstWaveTimer?.remove(); });
    if (march0.spawned > FIRST_WAVE_MAX) throw new Error(`wave 1 sent ${march0.spawned} animals at once, over ${FIRST_WAVE_MAX}`);
    // The wave would kill a knight who stands still in about 20 s; clear it so the checks
    // below run on a living player.
    await ask(page, () => {
      const s = _phaserGame.scene.getScene('Game');
      window._smokeWave.forEach(w => { if (!w.e.dying && w.e.spr?.active) s._hurtEnemy(w.e, 1e6); });
      s.p1.hp = s.p1.maxHp;
    });
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
    // Every obstacle, including one placed after world build the way a regrown tree is, is hidden
    // from the HUD camera; otherwise it is drawn twice, once fixed on the HUD (#346).
    const onHud = await page.evaluate(() => {
      const s = _phaserGame.scene.getScene('Game');
      const p = s.p1.spr, t = s._placeScenery(Math.floor(p.x / CFG.TILE) + 3, Math.floor(p.y / CFG.TILE), 'tree', 0);
      const bad = s.obstacles.getChildren().filter(o => !(o.cameraFilter & s.hudCam.id)).map(o => o.texture.key);
      t.destroy();
      return bad;
    });
    if (onHud.length) throw new Error(`${onHud.length} obstacles are drawn by the HUD camera too (first: ${onHud[0]})`);
    // One swing kills every 1-HP enemy in its arc (#341: a kill spliced this.enemies mid-loop,
    // so the enemy after it in the array was skipped).
    const swing = await page.evaluate(() => {
      const s = _phaserGame.scene.getScene('Game'), p = s.p1, en = s.enemies;
      const ok = e => e && !e.dying && !e.isBoss && !e.isRaider && e.spr?.active;
      const i = en.findIndex((e, k) => ok(e) && ok(en[k + 1]) && ok(en[k + 2]));
      if (i < 0) return 'no three live enemies in a row';
      const three = en.slice(i, i + 3), a = s.getAimAngle(p);
      three.forEach((e, k) => {
        const off = (k - 1) * 8; // side by side, 30 px ahead of the knight
        e.spr.setPosition(p.spr.x + Math.cos(a) * 30 - Math.sin(a) * off,
                          p.spr.y + Math.sin(a) * 30 + Math.cos(a) * off);
        e.hp = 1;
      });
      s.meleeSwing(p, 55, 0xdddddd, 0.18, 0);
      const dead = three.filter(e => e.dying).length;
      return dead === 3 ? '' : `a swing killed ${dead} of 3 lined-up 1-HP enemies`;
    });
    if (swing) throw new Error(swing);
    console.log('in play: one swing killed all three lined-up enemies');
    const mb = Math.round(px * 4 / 1e6);
    console.log(`in play: ${mb} MB of pixel memory (budget ${PIXEL_BUDGET_MB} MB)`);
    if (mb > PIXEL_BUDGET_MB) throw new Error(`pixel memory ${mb} MB is over the ${PIXEL_BUDGET_MB} MB budget`);
    await bossReach(page);
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

  // Phone layout, 1 player (#388): at 640x360 and at 874x402 (the canvas stays 640x360) reads the real
  // controls and panels and fails when the radar, the four buttons or the stick differ from the
  // agreed sizes by more than 2% of the screen height, or when any circle or box overlaps another
  // or runs off the screen. The stick ring is left out: it only appears where the thumb lands.
  for (const [name, vp] of [['phone layout 640x360', { width: 640, height: 360 }], ['phone layout 874x402', { width: 874, height: 402 }], ['iPad layout 1180x820', { width: 1180, height: 820 }]]) {
    failures += await pass(browser, name, base + '?seed=1&renderer=canvas', async page => {
      await page.evaluate(() => {
        saveSettings({ inputMode: 'touch', tutorial: false });
        STATE.mode = 1; STATE.p1CharId = 'knight'; _phaserGame.scene.start('Game');
      });
      await page.waitForFunction(() => _phaserGame.scene.getScene('Game')._worldReady === true, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      const err = await page.evaluate(() => {
        const g = _phaserGame.scene.getScene('Game'), { W, H } = CFG, tol = 0.02 * H;
        if (_isMobile && Math.abs(W / H - innerWidth / innerHeight) > 0.01) return `canvas is ${W}x${H}, not the shape of the screen`;
        const b = g._pads[0].btns, items = [], bad = [];
        const diam = (what, got, share) => { if (Math.abs(got - share * H) > tol) bad.push(`${what} is ${Math.round(got)} px across, wanted ${Math.round(share * H)}`); };
        const circle = (n, c) => items.push({ n, circle: true, ...c });
        const rd = g.radarCenter; diam('radar', rd.r * 2, PHONE1P.radar.d); circle('radar', { x: rd.x, y: rd.y, r: rd.r });
        for (const k of ['attack', 'alt', 'interact', 'build']) { diam(k + ' button', b[k].r * 2, PHONE1P.btn.d); circle(k, { x: b[k].hx, y: b[k].hy, r: b[k].r }); }
        circle('menu button', { x: b.menu.hx, y: b.menu.hy, r: b.menu.r });
        diam('stick', g._pads[0].joy.radius * 2, PHONE1P.stick.d);
        for (const [n, r] of Object.entries(g._hudRects)) items.push({ n: n + ' panel', ...r });
        const box = i => i.circle ? { x: i.x - i.r, y: i.y - i.r, w: i.r * 2, h: i.r * 2 } : i;
        const hit = (a, c) => {
          if (a.circle && c.circle) return Math.hypot(a.x - c.x, a.y - c.y) < a.r + c.r;
          if (!a.circle && !c.circle) return a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
          const [ci, re] = a.circle ? [a, c] : [c, a];
          const nx = Math.max(re.x, Math.min(ci.x, re.x + re.w)), ny = Math.max(re.y, Math.min(ci.y, re.y + re.h));
          return Math.hypot(ci.x - nx, ci.y - ny) < ci.r;
        };
        for (const i of items) { const q = box(i); if (q.x < 0 || q.y < 0 || q.x + q.w > W || q.y + q.h > H) bad.push(`${i.n} runs off the screen`); }
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (hit(items[i], items[j])) bad.push(`${items[i].n} overlaps ${items[j].n}`);
        return bad.join('; ');
      });
      if (err) throw new Error(err);
    }, { viewport: vp, hasTouch: true });
  }

  // iPad inventory (#414): the bottom-left resource panel must sit above the fog and night layers, and
  // every icon and number must have a real position on the screen. A scale named like the panel's
  // change-detection string once put them all at NaN, so the strip drew empty.
  failures += await pass(browser, 'iPad inventory panel', base + '?seed=1&renderer=canvas', async page => {
    await page.evaluate(() => {
      saveSettings({ inputMode: 'touch', tutorial: false });
      STATE.mode = 1; STATE.p1CharId = 'knight'; _phaserGame.scene.start('Game');
    });
    await page.waitForFunction(() => _phaserGame.scene.getScene('Game')._worldReady === true, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const err = await page.evaluate(() => {
      const g = _phaserGame.scene.getScene('Game'), { W, H } = CFG;
      if (W !== 1280) return `canvas is ${W} wide, wanted the iPad's 1280`;
      const parts = g._ho.filter(o => o.depth >= 100 && o.visible && ((o.type === 'Image' && /^item_/.test(o.texture.key)) || (o.type === 'Text' && /^\d+$/.test(o.text))));
      if (parts.length < 8) return `found ${parts.length} inventory icons and numbers, wanted 8`;
      const bad = [];
      for (const o of parts) {
        if (!(o.x >= 0 && o.x <= W && o.y >= 0 && o.y <= H)) bad.push(`${o.type} at ${o.x},${o.y}`);
        if (o.depth <= g.fogGfx.depth || o.depth <= g.nightOverlay.depth) bad.push(`${o.type} is not above the fog`);
        if (o.alpha < 0.1) bad.push(`${o.type} alpha ${o.alpha}`);
      }
      return bad.join('; ');
    });
    if (err) throw new Error(err);
  }, { viewport: { width: 1180, height: 820 }, hasTouch: true });


  // Canvas shape (#385): the canvas widens to the screen shape between 16:9 and 2.4:1 and keeps its
  // height; 16:9 and narrower screens stay exactly as before. At 874x402 (a phone) it fills the
  // viewport with no bars, and every text on the mode, character and settings screens lies inside it.
  for (const [vw, vh, touch, wantW, wantH] of [[874, 402, true, 0, 360], [640, 360, true, 640, 360], [1280, 720, false, 1280, 720],
    [1000, 700, false, 1280, 720], [2400, 720, false, 1728, 720]]) {
    failures += await pass(browser, `canvas shape ${vw}x${vh}`, base, async page => {
      const got = await page.evaluate(() => { const c = _phaserGame.canvas.getBoundingClientRect(); return { W: CFG.W, H: CFG.H, cw: c.width, ch: c.height }; });
      if (got.H !== wantH || (wantW && got.W !== wantW)) throw new Error(`canvas is ${got.W}x${got.H}, wanted ${wantW || 'any'}x${wantH}`);
      if (!wantW) {
        if (Math.abs(got.W / got.H - vw / vh) > 0.01) throw new Error(`canvas shape ${got.W}x${got.H} does not match the ${vw}x${vh} screen`);
        if (Math.abs(got.cw - vw) > 1 || Math.abs(got.ch - vh) > 1) throw new Error(`canvas fills ${Math.round(got.cw)}x${Math.round(got.ch)} of the ${vw}x${vh} screen: black bars`);
        for (const key of ['ModeSelect', 'CharSelect', 'Settings']) {
          const off = await page.evaluate(async key => {
            STATE.mode = 1; _phaserGame.scene.start(key);
            await new Promise(r => setTimeout(r, 800));
            const sc = _phaserGame.scene.getScene(key), { W, H } = CFG, bad = [];
            for (const o of sc.children.list) if (o.type === 'Text' && o.visible && o.text) {
              const b = o.getBounds(); if (b.x < -1 || b.y < -1 || b.right > W + 1 || b.bottom > H + 1) bad.push(o.text.slice(0, 24));
            }
            return bad;
          }, key);
          if (off.length) throw new Error(`${key}: text outside the canvas: ${off.join(' | ')}`);
        }
      }
    }, { viewport: { width: vw, height: vh }, hasTouch: touch });
  }
  // Touch USE button (#397): on a phone the keyboard key is never pressed, so the relic hold must
  // read the USE button. Player 1 stands next to a relic and holds it; fails unless the hold starts
  // and, 3.5 s later, the relic is picked up.
  failures += await pass(browser, 'touch relic pickup', base + '?seed=1&renderer=canvas', async page => {
    await page.evaluate(() => {
      saveSettings({ inputMode: 'touch', tutorial: false });
      STATE.mode = 1; STATE.p1CharId = 'knight'; _phaserGame.scene.start('Game');
    });
    await page.waitForFunction(() => _phaserGame.scene.getScene('Game')._worldReady === true, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const started = await page.evaluate(async () => {
      const g = _phaserGame.scene.getScene('Game'), r = g._relicPOIs[0];
      if (!r) throw new Error('no relic in this seed');
      g.p1.spr.setPosition(r.x + 10, r.y); g.p1.spr.setVelocity(0, 0);
      // Enemies guard relics and a hit cancels the hold, so keep the area clear for the test.
      window._clearRelicArea = setInterval(() => { for (const e of g.enemies.slice()) if (Math.hypot(e.spr.x - r.x, e.spr.y - r.y) < 500) g._hurtEnemy(e, 1e6); }, 150);
      g._tcBtns.interact.down = true;
      await new Promise(res => setTimeout(res, 600));
      return g._relicChannels.size;
    });
    if (started !== 1) throw new Error(`holding touch USE next to a relic started ${started} holds, wanted 1`);
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => { const g = _phaserGame.scene.getScene('Game'); clearInterval(window._clearRelicArea); g._tcBtns.interact.down = false; return g.relicsHeld; });
    if (after !== 1) throw new Error(`relicsHeld is ${after} after a 3.5 s touch USE hold, wanted 1`);
    console.log('touch relic pickup: hold started and the relic was picked up');
  }, { viewport: { width: 874, height: 402 }, hasTouch: true });

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
