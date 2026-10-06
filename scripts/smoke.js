#!/usr/bin/env node
// Smoke run (docs/adr/0001-browser-smoke-run-in-ci.md): load the game in headless WebKit, wait for
// the ModeSelect scene, and fail on any console error or uncaught exception. It checks the scene
// and the console only, never pixels: WebGL in a headless browser is unreliable.
// Needs Playwright, which only CI installs; see CONTRIBUTING.md to run it locally.
'use strict';
const { webkit } = require('playwright');
require('../server.js'); // serves the repo on $PORT, default 8080
const PORT = Number(process.env.PORT) || 8080;

(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('exception: ' + e.message));
  try {
    await page.goto(`http://localhost:${PORT}/`);
    // _phaserGame is game.js's top-level const; if any script failed to load it never exists.
    await page.waitForFunction(
      () => typeof _phaserGame === 'object' && _phaserGame.scene.isActive('ModeSelect'),
      null, { timeout: 30000 });
  } catch (e) {
    errors.push('ModeSelect never became active: ' + e.message.split('\n')[0]);
  }
  await browser.close();
  if (errors.length) {
    console.error('Smoke run FAILED:\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  console.log('Smoke run passed: ModeSelect active, no console errors.');
  process.exit(0);
})();
