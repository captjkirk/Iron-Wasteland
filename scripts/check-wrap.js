// Cycling through a list must wrap to 0 after the last item. Phaser.Math.Wrap(5, 0, 5) returns 5
// (its top is inclusive), which sent character select to a character that does not exist (#459).
// Part of `npm run check`: (1) no src file wraps an index with Phaser's Wrap from 0, (2) the
// character carousel's nav() visits every character going Right and going Left, skipping P1's pick.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

process.on('uncaughtException', e => { console.error('check-wrap: ' + e.message.split('\n')[0]); process.exit(1); });

for (const f of [...fs.readdirSync('src').map(n => 'src/' + n), 'game.js']) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) =>
    assert.ok(!/Math\.Wrap\([^)]*,\s*0\s*,/.test(line), `${f}:${i + 1}: Phaser.Math.Wrap(x, 0, n) returns n, not 0; use wrapIndex(x, n)`));
}

const ctx = { Phaser: { Scene: class {}, Math: { Wrap: (t, e, i) => (t >= e && t <= i ? t : e + ((t - e) % (i - e) + (i - e)) % (i - e)) } } };
vm.createContext(ctx);
const load = (file, names) =>
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\n' + names.map(n => `this.${n} = ${n};`).join(' '), ctx, { filename: file });
load('src/constants.js', ['CHARS', 'wrapIndex']);
load('src/char-select.js', ['CharSelectScene']);
const { CHARS, CharSelectScene } = ctx, n = CHARS.length;

const scene = () => Object.assign(Object.create(CharSelectScene.prototype),
  { p1Idx: 0, p2Idx: 1, p1Done: false, p2Done: false, solo: false, _turn: () => 2,
    refresh() { assert.ok(CHARS[this.p2Idx] && CHARS[this.p1Idx], `index out of range: p1=${this.p1Idx} p2=${this.p2Idx}`); } });

for (const p1 of CHARS.keys()) {
  for (const dir of [1, -1]) {
    const s = scene();
    s.p1Idx = p1; s.p1Done = true; s.p2Idx = ctx.wrapIndex(p1 + 1, n);
    const seen = [];
    for (let i = 0; i < n * 2; i++) { s.nav(2, dir); seen.push(s.p2Idx); }
    const want = Array.from(CHARS, (_, i) => i).filter(i => i !== p1);
    assert.deepStrictEqual([...new Set(seen)].sort(), want, `P1=${CHARS[p1].player}, dir ${dir}: P2 reached ${seen.join(',')}`);
  }
}
console.log('check-wrap: ok');
