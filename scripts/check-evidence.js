// Tests the before-and-after pairing and the comment it builds (scripts/evidence.js). Part of `npm run check`.
const assert = require('assert');
const { pairShots, commentBody, marker } = require('./evidence.js');

const b = s => Buffer.from(s);
const before = { 'title.png': b('A'), 'settings.png': b('S'), 'old.png': b('O') };
const after = { 'title.png': b('A'), 'settings.png': b('S2'), 'new-screen.png': b('N') };
const pairs = pairShots(before, after);
assert.deepStrictEqual(pairs, [
  { name: 'new-screen.png', before: false, after: true },
  { name: 'old.png', before: true, after: false },
  { name: 'settings.png', before: true, after: true },
], 'identical pairs are dropped; changed, new and gone screens are kept, by name');
assert.deepStrictEqual(pairShots(before, before), [], 'nothing changed, nothing paired');

const url = (side, name) => `https://x/${side}/${name}`;
const body = commentBody({ pr: 7, sha: '0123456789abcdef', set: 'fixed', pairs, total: 4, url, folder: 'https://x/' });
assert.ok(body.startsWith(marker(7, 'fixed') + '\n'), 'the marker is the first line, so the comment is found again');
assert.ok(body.includes('3 of 4 changed') && body.includes('at 0123456'), body);
assert.ok(body.includes('**settings**\n\n| Before | After |\n|---|---|\n| ![before](https://x/before/settings.png) | ![after](https://x/after/settings.png) |'), body);
assert.ok(body.includes('| _new screen_ | ![after](https://x/after/new-screen.png) |'), body);
assert.ok(body.includes('| ![before](https://x/before/old.png) | _gone_ |'), body);
assert.ok(!body.includes('title'), 'an unchanged screen is not in the comment');
assert.ok(commentBody({ pr: 7, sha: 'abcdef0', set: 'fixed', pairs: [], total: 4, url }).includes('no screen changed (4 compared)'));
assert.notStrictEqual(marker(7, 'fixed'), marker(7, 'extra'), 'a session\'s own shots get their own comment');

const many = Array.from({ length: 45 }, (_, i) => ({ name: `s${i}.png`, before: true, after: true }));
const big = commentBody({ pr: 7, sha: 'abcdef0', set: 'fixed', pairs: many, total: 45, url, folder: 'https://x/folder' });
assert.ok(big.includes('…and 5 more in [the evidence folder](https://x/folder)') && !big.includes('**s44**'), 'long lists are cut');

console.log('check-evidence: pairing and comment OK');
