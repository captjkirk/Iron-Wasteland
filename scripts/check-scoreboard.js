// Runs tools/scoreboard/Code.gs against a fake Sheet: good scores land, bad ones and repeats
// within the rate limit are refused, and doGet returns the top 10 by score. Part of `npm run check`.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const rows = [];
const cache = new Map();
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({
    getLastRow: () => rows.length,
    appendRow: r => rows.push(r),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
  }) }) },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: k => cache.set(k, '1') }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('tools/scoreboard/Code.gs', 'utf8'), ctx);

const good = { name: 'Hudson', chars: 'knight', mode: 1, difficulty: 'survival', days: 3, kills: 12,
  score: 900, version: '2026-10-07T12:00:00Z', seed: '1', device: 'abc123def456' };
const post = d => ctx.doPost({ postData: { contents: typeof d === 'string' ? d : JSON.stringify(d) } });

assert.deepStrictEqual(post(good), { ok: true });
assert.strictEqual(rows.length, 2, 'header row plus one score');
assert.strictEqual(post(good).error, 'too soon');
assert.strictEqual(post('not json').ok, false);
// Each bad score gets a fresh device id, so the validation refuses it, not the rate limit.
let n = 0;
const fresh = () => 'fresh' + String(n++).padStart(6, '0');
const bad = [
  { ...good, name: '' }, { ...good, name: 'x'.repeat(17) }, { ...good, chars: 'dragon' },
  { ...good, mode: 2 }, { ...good, difficulty: 'easy' }, { ...good, days: 0 }, { ...good, kills: 1.5 },
  { ...good, score: -1 }, { ...good, score: '900' }, { ...good, version: '<b>' }, { ...good, seed: 'a b' },
];
for (const b of bad) assert.strictEqual(post({ ...b, device: fresh() }).ok, false, JSON.stringify(b));
assert.strictEqual(post({ ...good, device: 'short' }).ok, false);
assert.strictEqual(rows.length, 2, 'no bad score was written');
post({ ...good, name: '=HYPERLINK("x")', device: 'formula0001' });
assert.strictEqual(rows[2][0], '\'=HYPERLINK("x")', 'a formula name is stored as text');
for (let i = 0; i < 12; i++) post({ ...good, name: 'P' + i, score: i * 100, device: 'dev0000' + String(i).padStart(4, '0') });
const top = ctx.doGet();
assert.strictEqual(top.length, 10);
assert.deepStrictEqual(top.map(r => r.score), [1100, 1000, 900, 900, 900, 800, 700, 600, 500, 400]);
console.log('check-scoreboard: OK');
