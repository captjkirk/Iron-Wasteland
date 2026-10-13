// Screenshots for before-and-after evidence on visual PRs (.github/workflows/shots.yml).
//   node scripts/shots.js <out-dir> [game-dir]
// Serves game-dir (default: this checkout) in headless WebKit and writes one PNG per screen to
// out-dir: every menu state scripts/phone-menus.js reaches, at each of its PHONE_SIZES, plus one
// in-play frame (?seed=1, as the smoke run plays it).
// Renders are deterministic, so a screen nobody changed looks the same on both sides: the page
// runs on Playwright's paused clock, advanced in fixed steps by `pump`; Math.random and Phaser's RND
// are reseeded before each screen; network calls answer inside the page; each screen runs SETTLE_MS
// and its animations are settled before its shot; VERSION is pinned (the server stamps it with the
// commit time).
const fs = require('fs');
const path = require('path');
const { webkit } = require('playwright');
const { MENUS, PHONE_SIZES, readScene } = require('./phone-menus.js');

const [out, gameDir = path.join(__dirname, '..')] = process.argv.slice(2);
if (!out) { console.error('usage: node scripts/shots.js <out-dir> [game-dir]'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
process.env.PORT = '0';
const server = require(path.resolve(gameDir, 'server.js'));
const T0 = new Date('2026-01-01T12:00:00Z').getTime();
const STEP_MS = 50;
const SETTLE_MS = 1000; // game time a screen runs before its shot, so a wheel or a fade has come to rest

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Runs fn(arg) in the page while advancing the paused clock STEP_MS at a time, until fn returns. The
// page itself reports, between steps, whether fn is still running and whether it called
// `window.__shot(label)`; a shot is taken right there and fn resumes. So every shot and every return
// lands on the same fake time on every run. (Watching the evaluate's own promise, or a Playwright
// binding, now and then notices a step late, which shifts every later screen.)
async function pump(page, fn, arg, take = () => {}) {
  await page.evaluate(() => { window.__busy = true; });
  const p = page.evaluate(async ({ src, arg }) => {
    try { return await (0, eval)('(' + src + ')')(arg); } finally { window.__busy = false; }
  }, { src: fn.toString(), arg });
  p.catch(() => {}); // read below, once the page says fn is done
  for (;;) {
    await page.clock.runFor(STEP_MS);
    const s = await page.evaluate(() => ({ busy: window.__busy, label: window.__shotWanted ? window.__shotWanted.label : null }));
    if (s.label != null) {
      // A one-frame jitter still creeps in now and then (cause not found), so the screen first runs
      // SETTLE_MS more, then every animation is settled: one-off tweens jump to their end, looping
      // ones to their start, and the frame is redrawn without moving time.
      await page.clock.runFor(SETTLE_MS);
      await page.evaluate(() => {
        for (const sc of _phaserGame.scene.getScenes(true)) for (const t of sc.tweens.getTweens()) t.seek(t.isInfinite ? 0 : t.totalDuration + 1000, 16, true);
        _phaserGame.step(_phaserGame.loop.now, 0);
      });
      await take(s.label);
      await page.evaluate(() => { const w = window.__shotWanted; window.__shotWanted = null; w.resolve(); });
    } else if (!s.busy) return p;
  }
}

async function newPage(browser, opts) {
  const page = await browser.newPage(opts);
  await page.clock.install({ time: T0 });
  // The global scoreboard (its top 10 at its longest) and the log upload answer at once, inside the
  // page: a stubbed network reply arrives in real time, so it would land on a different step each run.
  const rows = Array.from({ length: 10 }, (_, i) => ({ name: 'Wasteland Walker ' + i, score: 123456 - i * 9000, days: 10 + i }));
  await page.addInitScript(rows => {
    const realFetch = window.fetch;
    window.fetch = (url, opts) => /script\.google\.com|\/save-log/.test(String(url))
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(opts && opts.method === 'POST' ? { ok: true } : rows), text: () => Promise.resolve('ok') })
      : realFetch(url, opts);
  }, rows);
  await page.addInitScript(() => {
    window.__reseed = () => {
      let s = 1; // mulberry32
      Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      if (window.Phaser) Phaser.Math.RND.sow(['shots']);
    };
    window.__reseed();
    window.__shot = label => new Promise(resolve => { window.__shotWanted = { label, resolve }; });
  });
  await page.route('**/src/constants.js', async route => {
    const r = await route.fetch();
    route.fulfill({ response: r, body: (await r.text()).replace(/const VERSION = '[^']*';/, "const VERSION = 'dev build';") });
  });
  return page;
}

// Loads the page on the paused clock and steps it until the title screen is up. Every frame, from
// the first, lands on the same fake times on every run.
async function boot(page, url) {
  await page.clock.pauseAt(T0 + 1000);
  await page.goto(url);
  await pump(page, async () => {
    while (!(typeof _phaserGame !== 'undefined' && _phaserGame.scene.isActive('ModeSelect'))) await new Promise(r => setTimeout(r, 50));
  });
}

(async () => {
  if (!server.listening) await new Promise(r => server.once('listening', r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await webkit.launch();
  let n = 0, failed = 0;

  for (const [w, h] of PHONE_SIZES) {
    const page = await newPage(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await boot(page, base);
    for (const m of MENUS) {
      const take = async label => { await page.screenshot({ path: path.join(out, slug(`${w}x${h} ${m.name} ${label}`) + '.png') }); n++; };
      try {
        await page.evaluate(() => window.__reseed());
        await pump(page, readScene, m, take);
      } catch (e) { failed++; console.error(`${w}x${h} ${m.name}: ${e.message.split('\n')[0]}`); }
    }
    await page.close();
  }

  // The in-play frame: a solo knight game on seed 1, 9 s after the world is built (the controls card
  // closes at 8 s).
  const page = await newPage(browser, {});
  const take = async () => { await page.screenshot({ path: path.join(out, 'in-play-1280x720.png') }); n++; };
  try {
    await boot(page, base + '?seed=1&renderer=canvas');
    await pump(page, async () => {
      window.__reseed();
      saveSettings({ tutorial: false });
      STATE.mode = 1; STATE.p1CharId = 'knight'; STATE.difficulty = 'survival'; _phaserGame.scene.start('Game');
      while (!_phaserGame.scene.getScene('Game')._worldReady) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 9000));
      await window.__shot('in play');
    }, null, take);
  } catch (e) { failed++; console.error(`in play: ${e.message.split('\n')[0]}`); }

  await browser.close();
  console.log(`shots: ${n} screens written to ${out}${failed ? `, ${failed} could not be reached (listed above)` : ''}`);
  process.exit(0); // a screen the base cannot reach is no failure: it shows as new in the comment
})();
