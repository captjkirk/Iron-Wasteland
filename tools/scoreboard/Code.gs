// Iron Wasteland global scoreboard: an Apps Script web app bound to one Google Sheet.
// Setup: SETUP.md beside this file. This file is public (GitHub Pages serves the repo):
// nothing secret lives here. Anyone can post, so every field is checked and one device
// may post once per 30 seconds. Worst case is a fake score, deleted by hand in the sheet.

var SHEET = 'Scores';
var HEADER = ['name', 'date', 'chars', 'mode', 'difficulty', 'days', 'kills', 'score', 'version', 'seed', 'device'];
var CHARS = ['knight', 'gunslinger', 'architect', 'charmer', 'ranger'];
var DIFFICULTIES = ['survival', 'hardcore'];
var RATE_LIMIT_S = 30;

function scoresSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(HEADER);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function int_(v, min, max) {
  return typeof v === 'number' && v === Math.floor(v) && v >= min && v <= max;
}

// Returns the row to append, or a string saying what was wrong.
function validate_(d) {
  if (!d || typeof d !== 'object') return 'not an object';
  var name = typeof d.name === 'string' ? d.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!name || name.length > 16) return 'name';
  if (/^[=+\-@]/.test(name)) name = "'" + name; // never let a name run as a sheet formula
  var chars = typeof d.chars === 'string' ? d.chars.split('+') : [];
  if (chars.length < 1 || chars.length > 2 || chars.some(function (c) { return CHARS.indexOf(c) < 0; })) return 'chars';
  if (d.mode !== 1 && d.mode !== 2) return 'mode';
  if (chars.length !== d.mode) return 'chars for mode';
  if (DIFFICULTIES.indexOf(d.difficulty) < 0) return 'difficulty';
  if (!int_(d.days, 1, 10000)) return 'days';
  if (!int_(d.kills, 0, 1000000)) return 'kills';
  if (!int_(d.score, 0, 100000000)) return 'score';
  if (typeof d.version !== 'string' || d.version.length > 40 || /[^\w .:\-+]/.test(d.version)) return 'version';
  if (typeof d.seed !== 'string' || !/^[\w\-]{0,40}$/.test(d.seed)) return 'seed';
  if (typeof d.device !== 'string' || !/^[a-z0-9]{8,40}$/.test(d.device)) return 'device';
  return [name, new Date(), d.chars, d.mode, d.difficulty, d.days, d.kills, d.score, d.version, d.seed, d.device];
}

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'not JSON' }); }
  var row = validate_(d);
  if (typeof row === 'string') return json_({ ok: false, error: 'bad ' + row });
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (cache.get('dev:' + d.device)) return json_({ ok: false, error: 'too soon' });
    cache.put('dev:' + d.device, '1', RATE_LIMIT_S);
    scoresSheet_().appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

function doGet() {
  var rows = scoresSheet_().getDataRange().getValues().slice(1);
  rows.sort(function (a, b) { return b[7] - a[7]; });
  return json_(rows.slice(0, 10).map(function (r) {
    return {
      name: String(r[0]),
      date: r[1] instanceof Date ? Utilities.formatDate(r[1], 'UTC', 'yyyy-MM-dd') : String(r[1]),
      chars: r[2], days: r[5], kills: r[6], score: r[7],
    };
  }));
}
