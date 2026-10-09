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
let lockBusy = false;
let token = null; // the GITHUB_TOKEN script property
let githubStatus = 201;
const fetched = []; // each request made to the (fake) GitHub API
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (r, c, nr, nc) => ({ setValues: v => v.forEach((line, i) => rows[r - 1 + i].splice(c - 1, nc, ...line)) }),
    appendRow: r => rows.push(r),
    deleteRow: i => rows.splice(i - 1, 1),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
  }) }) },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, String(v)), remove: k => cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ waitLock() { if (lockBusy) throw new Error('timeout'); }, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => JSON.parse(s) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'GITHUB_TOKEN' ? token : null) }) },
  UrlFetchApp: { fetch: (url, opt) => {
    fetched.push({ url, opt, payload: JSON.parse(opt.payload) });
    return { getResponseCode: () => githubStatus, getContentText: () => JSON.stringify({ number: 500 + fetched.length }) };
  } },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('tools/scoreboard/Code.gs', 'utf8'), ctx);

const good = { name: 'Hudson', chars: 'knight', mode: 1, difficulty: 'survival', days: 3, kills: 12,
  score: 900, version: '2026-10-07T12:00:00Z', seed: '1', device: 'abc123def456' };
const post = d => ctx.doPost({ postData: { contents: typeof d === 'string' ? d : JSON.stringify(d) } });

assert.deepStrictEqual(post(good), { ok: true });
assert.strictEqual(rows.length, 3, 'header row, the old row, and one score');
assert.deepStrictEqual([...rows[0]], [...OLD, 'runId', 'log', 'feedback', 'platform', 'issue'], 'the old header gained the new columns');
assert.strictEqual(rows[1][0], 'Old', 'the old row stayed');
assert.deepStrictEqual([...rows[2].slice(11)], ['', '', '', '', ''], 'a post without runId or log still lands');
assert.deepStrictEqual(post({ ...good, device: 'withlog0001', runId: '1759000000000:abc123', log: 'IRON WASTELAND SESSION LOG\nx' }), { ok: true });
assert.deepStrictEqual([...rows[3].slice(11)], ['1759000000000:abc123', 'IRON WASTELAND SESSION LOG\nx', '', '', '']);
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
// Feedback: lands in the run's own row; creates the row when the score is not there yet; capped, limited, validated.
const saved = rows.map(r => r.slice()); // the feedback cases add rows; put the sheet back after
rows.splice(3, 1);
const fb = (o) => post({ ...good, kind: 'feedback', platform: 'touch 1024x768', ...o });
assert.deepStrictEqual(post({ ...good, device: 'fbdevice001', runId: 'run:1' }), { ok: true });
assert.deepStrictEqual(fb({ device: 'fbdevice001', runId: 'run:1', comment: 'too hard' }), { ok: true });
assert.strictEqual(rows.length, 4, 'feedback for a saved run adds no row');
assert.deepStrictEqual([...rows[3].slice(11)], ['run:1', '', 'too hard', 'touch 1024x768', '']);
assert.strictEqual(fetched.length, 0, 'no token, no GitHub call');
assert.deepStrictEqual(fb({ device: 'fbdevice002', runId: 'run:2', comment: '=1+1' }), { ok: true });
assert.strictEqual(rows.length, 5, 'feedback before its score creates the row');
assert.strictEqual(rows[4][13], "'=1+1", 'a formula comment is stored as text');
assert.deepStrictEqual(post({ ...good, device: 'fbdevice002', runId: 'run:2', log: 'L' }), { ok: true });
assert.strictEqual(rows.length, 5, 'the late score fills the feedback row, no second row');
assert.deepStrictEqual([rows[4][7], rows[4][12], rows[4][13]], [900, 'L', "'=1+1"], 'score filled in, feedback kept');
assert.deepStrictEqual(fb({ device: 'fbdevice003', runId: 'run:3', comment: 'x'.repeat(2500) }), { ok: true });
assert.strictEqual(rows[5][13].length, 2000, 'the comment is capped at 2,000 characters');
for (let i = 0; i < 2; i++) assert.strictEqual(fb({ device: 'fbdevice003', runId: 'run:3', comment: 'again' + i }).ok, true);
assert.strictEqual(fb({ device: 'fbdevice003', runId: 'run:3', comment: 'fourth' }).error, 'too many');
const before = rows.length;
for (const b of [{ comment: '' }, { comment: 5 }, { runId: '' }, { name: '' }]) {
  assert.strictEqual(fb({ device: 'fbdevice004', runId: 'run:4', comment: 'ok', ...b }).ok, false, JSON.stringify(b));
}
assert.strictEqual(rows.length, before, 'no bad feedback was written');
fb({ device: 'fbdevice004', runId: 'run:4', comment: 'ok', platform: '<b>' });
assert.strictEqual(rows[rows.length - 1][14], '', 'a bad platform is dropped, the comment still lands');
// Issues: a token makes each feedback row an issue; a GitHub failure leaves the column empty for the retry.
token = 'ghp_test';
const log40 = Array.from({ length: 40 }, (_, i) => 'event ' + i).join('\n');
assert.deepStrictEqual(post({ ...good, name: 'Hud', device: 'issdevice01', runId: 'run:5', log: log40 }), { ok: true });
githubStatus = 500;
assert.deepStrictEqual(fb({ name: 'Hud', device: 'issdevice01', runId: 'run:5', comment: '@octocat the wolf is\nunfair '.padEnd(90, 'x') }), { ok: true });
const row5 = () => rows.find(r => r[11] === 'run:5');
assert.ok(fetched.length >= 1 && row5()[15] === '', 'GitHub failed: the issue column stays empty');
githubStatus = 201;
fetched.length = 0;
ctx.retryIssues();
assert.ok(fetched.length <= 5, 'at most 5 issues filed per run');
const made = fetched.find(f => f.payload.body.includes('runId run:5'));
assert.ok(made && row5()[15] > 500, 'the retry filed the issue and wrote its number in the row');
assert.strictEqual(made.url, 'https://api.github.com/repos/captjkirk/iron-wasteland/issues');
assert.strictEqual(made.opt.headers.Authorization, 'Bearer ghp_test');
assert.deepStrictEqual(made.payload.labels, ['feedback', 'needs-triage']);
assert.ok(made.payload.title.replace(/\u200b/g, '').length <= 'Feedback: '.length + 60, 'title is at most 60 characters of the comment');
assert.ok(!made.payload.title.includes('\n') && !/@(?!\u200b)/.test(made.payload.body + made.payload.title), 'no raw @ mention, no newline in the title');
assert.ok(made.payload.body.includes('> ') && made.payload.body.includes('Hud') && made.payload.body.includes('run:5') && made.payload.body.includes('touch 1024x768'));
assert.ok(made.payload.body.includes('event 39') && made.payload.body.includes('event 10') && !made.payload.body.includes('event 9\n'), 'the newest 30 events only');
const filed = fetched.length;
ctx.retryIssues();
assert.strictEqual(fetched.length, filed, 'a row with an issue is not filed again');
assert.deepStrictEqual(post({ ...good, name: 'Hud', device: 'issdevice01', runId: 'run:5', log: log40, score: 901 }), { ok: false, error: 'too soon' });
token = null;
rows.length = 0;
rows.push(...saved);
for (let i = 0; i < 12; i++) post({ ...good, name: 'P' + i, score: i * 100, device: 'dev0000' + String(i).padStart(4, '0') });
const top = ctx.doGet();
assert.strictEqual(top.length, 10);
assert.deepStrictEqual(top.map(r => r.score), [1100, 1000, 900, 900, 900, 800, 700, 600, 500, 400]);
// Hardening: an implausible run, a rude or empty name, a held lock, the row cap, and the cached top 10.
const fresh2 = () => 'plaus' + String(n++).padStart(6, '0');
const refused = (o, why) => assert.strictEqual(post({ ...good, device: fresh2(), ...o }).ok, false, why);
refused({ score: 99999999, days: 1 }, 'a 100-million score on day 1');
refused({ score: 40000, days: 1, kills: 0 }, 'a score no run can reach');
refused({ kills: 500, days: 1 }, 'more kills than a day holds');
for (const name of ['!!!', '...', 'Fuck', 'xXfUcKXx', 'big dick', 'SH1T'.toLowerCase().replace('1', 'i')]) refused({ name }, 'name ' + name);
assert.strictEqual(post({ ...good, name: '  Dad   and  Kids ', device: fresh2() }).ok, true, 'spaces collapse, name is fine');
assert.strictEqual(rows[rows.length - 1][0], 'Dad and Kids', 'whitespace collapsed');
for (const name of ['Dickens', 'Hancock', 'Cassidy', 'Skyler']) assert.strictEqual(post({ ...good, name, device: fresh2() }).ok, true, 'name ' + name);
assert.strictEqual(post({ ...good, score: 30000, days: 10, kills: 100, difficulty: 'hardcore', device: fresh2() }).ok, true, 'a long hardcore run is plausible');
lockBusy = true;
assert.deepStrictEqual(post({ ...good, device: fresh2() }), { ok: false, error: 'busy' }, 'a held lock answers JSON');
lockBusy = false;
const cachedTop = ctx.doGet();
post({ ...good, name: 'Newtop', score: 31000, days: 5, device: fresh2() });
assert.strictEqual(ctx.doGet()[0].name, 'Newtop', 'a new score clears the cached top 10');
assert.deepStrictEqual(ctx.doGet(), ctx.doGet(), 'the second read is the cached one');
assert.notDeepStrictEqual(cachedTop, ctx.doGet());
ctx.MAX_ROWS = rows.length - 1; // as many rows as there are now; the next post must push the lowest out
const lowest = Math.min(...rows.slice(1).map(r => r[7]));
assert.ok(post({ ...good, name: 'Fits', score: lowest + 5, device: fresh2() }).ok);
assert.strictEqual(rows.length - 1, ctx.MAX_ROWS, 'the sheet is held at its cap');
assert.ok(!rows.slice(1).some(r => r[7] === lowest) && rows.some(r => r[0] === 'Fits'), 'the lowest went, the new row stayed');
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
