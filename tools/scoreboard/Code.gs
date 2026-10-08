// Iron Wasteland global scoreboard: an Apps Script web app bound to one Google Sheet.
// Setup: SETUP.md beside this file. This file is public (GitHub Pages serves the repo):
// nothing secret lives here. Anyone can post, so every field is checked and one device
// may post once per 30 seconds. Worst case is a fake score, deleted by hand in the sheet.

var SHEET = 'Scores';
// doGet reads columns by position, so new columns go on the end; scoresSheet_ adds them to a live sheet.
var HEADER = ['name', 'date', 'chars', 'mode', 'difficulty', 'days', 'kills', 'score', 'version', 'seed', 'device',
  'runId', 'log', 'feedback', 'platform'];
var LOG_MAX = 50000; // a Sheets cell holds at most 50,000 characters; the game trims to fit
var CHARS = ['knight', 'gunslinger', 'architect', 'charmer', 'ranger'];
var DIFFICULTIES = ['survival', 'hardcore'];
var RATE_LIMIT_S = 30;
var FEEDBACK_MAX = 2000; // characters of comment kept
var FEEDBACK_PER_HOUR = 3; // per device
var MAX_ROWS = 500; // the lowest scores beyond this are removed
var TOP_CACHE_S = 60;
// Names are shown to every player. The first list is matched anywhere in the name (spaces and symbols
// ignored); the second only as whole words, so names like Dickens or Hancock stay legal. Edit freely.
var BLOCK_ANYWHERE = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'hitler', 'rapist'];
var BLOCK_WORDS = ['fag', 'dick', 'cock', 'pussy', 'penis', 'vagina', 'porn', 'nazi', 'rape', 'ass', 'anus', 'sex'];

function scoresSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(HEADER);
  var have = sh.getLastColumn();
  if (have < HEADER.length) sh.getRange(1, have + 1, 1, HEADER.length - have).setValues([HEADER.slice(have)]);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function int_(v, min, max) {
  return typeof v === 'number' && v === Math.floor(v) && v >= min && v <= max;
}

function blockedName_(name) {
  var lower = name.toLowerCase();
  var squashed = lower.replace(/[^a-z0-9]/g, '');
  if (BLOCK_ANYWHERE.some(function (w) { return squashed.indexOf(w) >= 0; })) return true;
  return lower.split(/[^a-z0-9]+/).some(function (w) { return BLOCK_WORDS.indexOf(w) >= 0; });
}

// Returns the row to append, or a string saying what was wrong.
function validate_(d) {
  if (!d || typeof d !== 'object') return 'not an object';
  var name = typeof d.name === 'string' ? d.name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > 16 || !/[A-Za-z0-9\u00c0-\uffff]/.test(name) || blockedName_(name)) return 'name';
  if (/^[=+\-@]/.test(name)) name = "'" + name; // never let a name run as a sheet formula
  var chars = typeof d.chars === 'string' ? d.chars.split('+') : [];
  if (chars.length < 1 || chars.length > 2 || chars.some(function (c) { return CHARS.indexOf(c) < 0; })) return 'chars';
  if (d.mode !== 1 && d.mode !== 2) return 'mode';
  if (chars.length !== d.mode) return 'chars for mode';
  if (DIFFICULTIES.indexOf(d.difficulty) < 0) return 'difficulty';
  if (!int_(d.days, 1, 10000)) return 'days';
  if (!int_(d.kills, 0, 1000000)) return 'kills';
  if (!int_(d.score, 0, 100000000)) return 'score';
  if (d.kills > d.days * 400) return 'kills for days';
  // The most _calcScore can give: days, kills and seconds alive (150 s a day, 2 points each), a win and a
  // boss, and 20,000 for gathered resources, all x1.5 on hardcore. Anything above it was not played.
  if (d.score > (d.days * 400 + d.kills * 25 + 20000) * 1.5) return 'score for run';
  if (typeof d.version !== 'string' || d.version.length > 40 || /[^\w .:\-+]/.test(d.version)) return 'version';
  if (typeof d.seed !== 'string' || !/^[\w\-]{0,40}$/.test(d.seed)) return 'seed';
  if (typeof d.device !== 'string' || !/^[a-z0-9]{8,40}$/.test(d.device)) return 'device';
  // runId and log are optional: a game loaded before they existed still posts its score.
  var runId = d.runId == null ? '' : d.runId;
  if (typeof runId !== 'string' || !/^[\w:.\-]{0,40}$/.test(runId)) return 'runId';
  var log = d.log == null ? '' : d.log;
  if (typeof log !== 'string' || log.length > LOG_MAX - 1) return 'log';
  if (/^[=+\-@]/.test(log)) log = "'" + log;
  return [name, new Date(), d.chars, d.mode, d.difficulty, d.days, d.kills, d.score, d.version, d.seed, d.device,
    runId, log, '', ''];
}

// The 0-based index in rows of the score row for this run, or -1.
function findRun_(rows, runId) {
  for (var i = rows.length - 1; i > 0; i--) if (rows[i][11] === runId) return i;
  return -1;
}

// A feedback message is the run's summary plus kind 'feedback', comment and platform. It fills the run's own
// row; when the score is not there yet (still in flight) it creates the row, and the score post fills it in.
function feedback_(d, sh) {
  var row = validate_(d);
  if (typeof row === 'string') return 'bad ' + row;
  if (!row[11]) return 'bad runId';
  var comment = typeof d.comment === 'string' ? d.comment.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim() : '';
  if (!comment) return 'bad comment';
  comment = comment.slice(0, FEEDBACK_MAX);
  if (/^[=+\-@]/.test(comment)) comment = "'" + comment;
  var platform = typeof d.platform === 'string' && /^[\w .,x\-]{0,40}$/.test(d.platform) ? d.platform : '';
  var cache = CacheService.getScriptCache();
  var key = 'fb:' + d.device;
  var sent = Number(cache.get(key)) || 0;
  if (sent >= FEEDBACK_PER_HOUR) return 'too many';
  cache.put(key, String(sent + 1), 3600);
  var rows = sh.getDataRange().getValues();
  var at = findRun_(rows, row[11]);
  if (at < 0) { row[13] = comment; row[14] = platform; sh.appendRow(row); return ''; }
  sh.getRange(at + 1, 14, 1, 2).setValues([[comment, platform]]);
  return '';
}

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'not JSON' }); }
  var isFeedback = d && d.kind === 'feedback';
  var row = isFeedback ? null : validate_(d);
  if (typeof row === 'string') return json_({ ok: false, error: 'bad ' + row });
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) { return json_({ ok: false, error: 'busy' }); }
  try {
    var sh = scoresSheet_();
    if (isFeedback) {
      var problem = feedback_(d, sh);
      if (problem) return json_({ ok: false, error: problem });
    } else {
      if (cache.get('dev:' + d.device)) return json_({ ok: false, error: 'too soon' });
      cache.put('dev:' + d.device, '1', RATE_LIMIT_S);
      // Feedback that beat the score here made this run's row already: fill it, keep the feedback.
      var rows = row[11] ? sh.getDataRange().getValues() : [];
      var at = row[11] ? findRun_(rows, row[11]) : -1;
      if (at < 0) sh.appendRow(row);
      else { row[13] = rows[at][13]; row[14] = rows[at][14]; sh.getRange(at + 1, 1, 1, row.length).setValues([row]); }
    }
    trim_(sh);
    cache.remove('top');
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

// Keep the sheet to MAX_ROWS scores: remove the lowest beyond that.
function trim_(sh) {
  var excess = sh.getLastRow() - 1 - MAX_ROWS;
  if (excess <= 0) return;
  var rows = sh.getDataRange().getValues();
  var order = [];
  for (var i = 1; i < rows.length; i++) order.push(i);
  order.sort(function (a, b) { return rows[a][7] - rows[b][7] || b - a; }); // lowest first, newest first on a tie
  order.slice(0, excess).sort(function (a, b) { return b - a; }).forEach(function (i) { sh.deleteRow(i + 1); });
}

function doGet() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('top');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  var rows = scoresSheet_().getDataRange().getValues().slice(1);
  rows.sort(function (a, b) { return b[7] - a[7]; });
  var top = rows.slice(0, 10).map(function (r) {
    return {
      name: String(r[0]),
      date: r[1] instanceof Date ? Utilities.formatDate(r[1], 'UTC', 'yyyy-MM-dd') : String(r[1]),
      chars: r[2], days: r[5], kills: r[6], score: r[7],
    };
  });
  cache.put('top', JSON.stringify(top), TOP_CACHE_S);
  return json_(top);
}
