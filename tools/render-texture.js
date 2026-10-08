// Save game textures as PNGs, so a sprite change can be seen without playing to it.
//   node tools/render-texture.js [--scale N] [--out DIR] <key> [<key> ...]
// Loads the game in headless Chromium, waits for ModeSelect (every texture is built at boot),
// and writes DIR/<key>.png for each key at N× (default 4×, nearest-neighbour), on a grass-green
// background so outlines read as they do in game. Keys are texture keys: 'boss_wolf', 'wolf'.
// Needs Playwright: `npm install --no-save playwright` (or NODE_PATH pointing at a global one).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
let scale = 4, out = 'texture-renders';
const keys = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scale') scale = Number(args[++i]);
  else if (args[i] === '--out') out = args[++i];
  else keys.push(args[i]);
}
if (!keys.length || !(scale > 0)) {
  console.error('usage: node tools/render-texture.js [--scale N] [--out DIR] <key> [<key> ...]');
  process.exit(2);
}

process.env.PORT = '0'; // any free port
const server = require('../server.js');

(async () => {
  if (!server.listening) await new Promise(r => server.once('listening', r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('page error: ' + e.message));
  await page.goto(base);
  await page.waitForFunction(
    () => typeof _phaserGame !== 'undefined' && _phaserGame.scene.isActive('ModeSelect'),
    null, { timeout: 60000 });
  const pngs = await page.evaluate(({ keys, scale }) => keys.map(key => {
    if (!_phaserGame.textures.exists(key)) return { key, missing: true };
    const img = _phaserGame.textures.get(key).getSourceImage();
    const c = document.createElement('canvas');
    c.width = img.width * scale; c.height = img.height * scale;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3c5a32'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { key, w: img.width, h: img.height, data: c.toDataURL('image/png').split(',')[1] };
  }), { keys, scale });
  fs.mkdirSync(out, { recursive: true });
  let missing = 0;
  for (const p of pngs) {
    if (p.missing) { console.error(`no texture '${p.key}'`); missing++; continue; }
    const file = path.join(out, p.key + '.png');
    fs.writeFileSync(file, Buffer.from(p.data, 'base64'));
    console.log(`${file}  (${p.w}×${p.h} at ${scale}×)`);
  }
  await browser.close();
  server.close();
  process.exit(missing ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
