// Runs tools/scoreboard/Code.gs against a fake Sheet: good scores land, bad ones and repeats
// within the rate limit are refused, doGet returns the top 10 by score, and a live sheet with the
// old 11-column header gains the new columns and keeps its rows. Part of `npm run check`.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

// The live sheet as it was before the log column: the old header and one score row.
const OLD = ['name', 'date', 'chars', 'mode', 'difficulty', 'days', 'kills', 'score', 'version', 'seed', 'device'];
const rows = [OLD.slice(), ['Old', new Date(), 'knight', 1, 'survival', 1, 0, 50, 'v', '', 'olddevice01']];
const cache = new Map();
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (r, c, nr, nc) => ({ setValues: v => v.forEach((line, i) => rows[r - 1 + i].splice(c - 1, nc, ...line)) }),
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
assert.strictEqual(rows.length, 3, 'header row, the old row, and one score');
assert.deepStrictEqual([...rows[0]], [...OLD, 'runId', 'log'], 'the old header gained the new columns');
assert.strictEqual(rows[1][0], 'Old', 'the old row stayed');
assert.deepStrictEqual([...rows[2].slice(11)], ['', ''], 'a post without runId or log still lands');
assert.deepStrictEqual(post({ ...good, device: 'withlog0001', runId: '1759000000000:abc123', log: 'IRON WASTELAND SESSION LOG\nx' }), { ok: true });
assert.deepStrictEqual([...rows[3].slice(11)], ['1759000000000:abc123', 'IRON WASTELAND SESSION LOG\nx']);
rows.splice(3, 1);
assert.strictEqual(post(good).error, 'too soon');
assert.strictEqual(post('not json').ok, false);
// Each bad score gets a fresh device id, so the validation refuses it, not the rate limit.
let n = 0;
const fresh = () => 'fresh' + String(n++).padStart(6, '0');
const bad = [
  { ...good, name: '' }, { ...good, name: 'x'.repeat(17) }, { ...good, chars: 'dragon' },
  { ...good, mode: 2 }, { ...good, difficulty: 'easy' }, { ...good, days: 0 }, { ...good, kills: 1.5 },
  { ...good, score: -1 }, { ...good, score: '900' }, { ...good, version: '<b>' }, { ...good, seed: 'a b' },
  { ...good, runId: 'a b' }, { ...good, log: 'x'.repeat(50000) }, { ...good, log: 5 },
];
for (const b of bad) assert.strictEqual(post({ ...b, device: fresh() }).ok, false, JSON.stringify(b));
assert.strictEqual(post({ ...good, device: 'short' }).ok, false);
assert.strictEqual(rows.length, 3, 'no bad score was written');
post({ ...good, name: '=HYPERLINK("x")', log: '=1+1', device: 'formula0001' });
assert.strictEqual(rows[3][0], '\'=HYPERLINK("x")', 'a formula name is stored as text');
assert.strictEqual(rows[3][12], '\'=1+1', 'a formula log is stored as text');
for (let i = 0; i < 12; i++) post({ ...good, name: 'P' + i, score: i * 100, device: 'dev0000' + String(i).padStart(4, '0') });
const top = ctx.doGet();
assert.strictEqual(top.length, 10);
assert.deepStrictEqual(top.map(r => r.score), [1100, 1000, 900, 900, 900, 800, 700, 600, 500, 400]);
// GameOverScene._logForSheet: a log too long for a cell keeps its header and newest entries.
const go = fs.readFileSync('src/game-over.js', 'utf8');
const fn = vm.runInNewContext('(' + go.match(/\n  (_logForSheet\([\s\S]*?\n  \})\n/)[1].replace(/^_logForSheet/, 'function') + ')');
const scene = { _logLines: () => ['IRON WASTELAND SESSION LOG', 'HEAD'], _dbgEntries: Array.from({ length: 5000 }, (_, i) => 'entry ' + i + ' ' + 'x'.repeat(20)) };
const trimmed = fn.call(scene);
assert.ok(trimmed.length < 50000, 'trimmed log fits a cell');
assert.ok(trimmed.startsWith('IRON WASTELAND SESSION LOG\nHEAD\n…trimmed '), 'header kept, cut marked');
assert.ok(trimmed.endsWith('entry 4999 ' + 'x'.repeat(20)), 'newest entry kept');
scene._dbgEntries = ['a', 'b'];
assert.strictEqual(fn.call(scene), 'IRON WASTELAND SESSION LOG\nHEAD\na\nb', 'a short log is sent whole');
console.log('check-scoreboard: OK');
