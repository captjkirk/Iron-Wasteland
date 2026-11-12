// Tests the before-and-after pairing and the comment it builds (scripts/evidence.js). Part of `npm run check`.
const assert = require('assert');
const { pairShots, commentBody, marker } = require('./evidence.js');

const zlib = require('zlib');

// A 2x1 RGBA PNG whose pixels are [r, g, b, a] arrays, each row with a different filter, so decoding is
// tested on the same kind of file Playwright writes. CRCs are left at zero; the decoder ignores them.
function png(pixels, filter = 1) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(pixels.length, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const flat = pixels.flat(), row = [filter, ...flat.map((v, i) => filter === 1 && i >= 4 ? (v - flat[i - 4]) & 255 : v)];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(row))), chunk('IEND', Buffer.alloc(0))]);
}
const dark = [[10, 10, 10, 255], [200, 50, 50, 255]];
const before = { 'title.png': png(dark), 'settings.png': png(dark), 'old.png': png(dark), 'pulse.png': png(dark) };
const after = { 'title.png': png(dark), 'settings.png': png([[10, 10, 10, 255], [200, 90, 50, 255]]),
  'new-screen.png': png(dark), 'pulse.png': png([[14, 10, 10, 255], [200, 50, 46, 255]], 0) };
const pairs = pairShots(before, after);
assert.deepStrictEqual(pairs, [
  { name: 'new-screen.png', before: false, after: true },
  { name: 'old.png', before: true, after: false },
  { name: 'settings.png', before: true, after: true },
], 'identical pairs and a faint pulse are dropped; changed, new and gone screens are kept, by name');
assert.deepStrictEqual(pairShots(before, before), [], 'nothing changed, nothing paired');

const url = (side, name) => `https://x/${side}/${name}`;
const body = commentBody({ pr: 7, sha: '0123456789abcdef', set: 'fixed', pairs, total: 4, url, folder: 'https://x/' });
assert.ok(body.startsWith(marker(7, 'fixed') + '\n'), 'the marker is the first line, so the comment is found again');
assert.ok(body.includes('3 of 4 changed') && body.includes('at 0123456'), body);
assert.ok(body.includes('**settings**\n\n| Before | After |\n|---|---|\n| ![before](https://x/before/settings.png) | ![after](https://x/after/settings.png) |'), body);
assert.ok(body.includes('| _new screen_ | ![after](https://x/after/new-screen.png) |'), body);
assert.ok(body.includes('| ![before](https://x/before/old.png) | _gone_ |'), body);
assert.ok(!body.includes('title'), 'an unchanged screen is not in the comment');
const none = commentBody({ pr: 7, sha: 'abcdef0', set: 'fixed', pairs: [], total: 4, url });
assert.ok(none.includes('no screen changed (4 compared)') && none.includes('`extra` set'), 'an empty fixed set points to the extra set: ' + none);
assert.notStrictEqual(marker(7, 'fixed'), marker(7, 'extra'), 'a session\'s own shots get their own comment');

const many = Array.from({ length: 45 }, (_, i) => ({ name: `s${i}.png`, before: true, after: true }));
const big = commentBody({ pr: 7, sha: 'abcdef0', set: 'fixed', pairs: many, total: 45, url, folder: 'https://x/folder' });
assert.ok(big.includes('…and 5 more in [the evidence folder](https://x/folder)') && !big.includes('**s44**'), 'long lists are cut');

console.log('check-evidence: pairing and comment OK');
