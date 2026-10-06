// Browser smoke run: loads the game in headless WebKit (the iPad engine) and fails unless
// the ModeSelect scene comes up with no console error and no uncaught page error.
// It stops at ModeSelect on purpose: headless WebGL loses its context in the Game scene,
// so world build and pixels are out of reach here. Run with `npm run smoke`.
const { webkit } = require('playwright');
process.env.PORT = '0'; // any free port, so a running `npm run serve` is no obstacle
const server = require('../server.js');

(async () => {
  if (!server.listening) await new Promise(r => server.once('listening', r));
  const browser = await webkit.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console error: ' + m.text()); });
  page.on('pageerror', e => errors.push('page error: ' + e.message));

  try {
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(
      () => typeof _phaserGame !== 'undefined' && _phaserGame.scene.isActive('ModeSelect'),
      null, { timeout: 30000 });
    await page.waitForTimeout(1000); // let ModeSelect run a few frames
  } catch (e) {
    errors.push('ModeSelect never became active: ' + e.message.split('\n')[0]);
  }
  await browser.close();

  for (const e of errors) console.error('::error::' + e);
  if (!errors.length) console.log('Smoke run OK: ModeSelect active, console clean.');
  process.exit(errors.length ? 1 : 0);
})();
