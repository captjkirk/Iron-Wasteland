// Iron Wasteland global scoreboard: an Apps Script web app bound to one Google Sheet.
// Setup: SETUP.md beside this file. This file is public (GitHub Pages serves the repo):
// nothing secret lives here. Anyone can post, so every field is checked and one device
// may post once per 30 seconds. Worst case is a fake score, deleted by hand in the sheet.

var SHEET = 'Scores';
// doGet reads columns by position, so new columns go on the end; scoresSheet_ adds them to a live sheet.
var HEADER = ['name', 'date', 'chars', 'mode', 'difficulty', 'days', 'kills', 'score', 'version', 'seed', 'device',
  'runId', 'log', 'feedback', 'platform', 'issue'];
var LOG_MAX = 50000; // a Sheets cell holds at most 50,000 characters; the game trims to fit
var CHARS = ['knight', 'gunslinger', 'architect', 'charmer', 'ranger'];
var DIFFICULTIES = ['survival', 'hardcore'];
var RATE_LIMIT_S = 30;
var FEEDBACK_MAX = 2000; // characters of comment kept
var FEEDBACK_PER_HOUR = 3; // per device
var GITHUB_REPO = 'captjkirk/iron-wasteland';
var ISSUE_LOG_EVENTS = 30; // the issue gets the newest events only; the full log stays in the private sheet
var ISSUES_PER_RUN = 5; // rows tried per post or retry, so a GitHub outage cannot hold the lock for long
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
    runId, log, '', '', ''];
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
      fileIssues_(sh);
    } else {
      if (cache.get('dev:' + d.device)) return json_({ ok: false, error: 'too soon' });
      cache.put('dev:' + d.device, '1', RATE_LIMIT_S);
      // Feedback that beat the score here made this run's row already: fill it, keep the feedback.
      var rows = row[11] ? sh.getDataRange().getValues() : [];
      var at = row[11] ? findRun_(rows, row[11]) : -1;
      if (at < 0) sh.appendRow(row);
      else { row[13] = rows[at][13]; row[14] = rows[at][14]; row[15] = rows[at][15]; sh.getRange(at + 1, 1, 1, row.length).setValues([row]); }
    }
    trim_(sh);
    cache.remove('top');
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

// A leading apostrophe was added to keep a value from running as a formula; the issue shows the original.
function plain_(v) {
  return String(v).replace(/^'(?=[=+\-@])/, '');
}

function issueFor_(r) {
  var comment = plain_(r[13]);
  var date = r[1] instanceof Date ? Utilities.formatDate(r[1], 'UTC', 'yyyy-MM-dd') : String(r[1]);
  var events = String(r[12]).split('\n').filter(function (l) { return l; }).slice(-ISSUE_LOG_EVENTS);
  var body = [
    '**From:** ' + plain_(r[0]) + ' on ' + date,
    '**Game version:** ' + r[8],
    '**Device:** ' + (r[14] || 'unknown'),
    '**Run:** ' + (r[3] === 2 ? '2 players' : '1 player') + ', ' + r[2] + ', ' + r[4] + ', day ' + r[5] +
      ', ' + r[6] + ' kills, score ' + r[7] + ', seed ' + (r[9] || 'none') + ', runId ' + r[11],
    '',
    comment.split('\n').map(function (l) { return '> ' + l; }).join('\n'),
    '',
    events.length ? 'Last ' + events.length + ' log events:\n\n```\n' + events.join('\n').replace(/`/g, "'") + '\n```' : '(no log sent)',
  ].join('\n');
  // A zero-width space after @ so a comment cannot mention (notify) anyone.
  body = body.replace(/@/g, '@\u200b');
  return {
    title: 'Feedback: ' + comment.replace(/\s+/g, ' ').slice(0, 60).replace(/@/g, '@\u200b'),
    body: body,
    labels: ['feedback', 'needs-triage'],
  };
}

// Returns the new issue number, or 0 when GitHub (or the token) is not there; the caller leaves the column empty.
function createIssue_(r, token) {
  try {
    var res = UrlFetchApp.fetch('https://api.github.com/repos/' + GITHUB_REPO + '/issues', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      payload: JSON.stringify(issueFor_(r)),
      muteHttpExceptions: true,
    });
    return res.getResponseCode() === 201 ? Number(JSON.parse(res.getContentText()).number) || 0 : 0;
  } catch (err) {
    return 0;
  }
}

// File an issue for each row that has feedback and no issue yet (the oldest first, a few at a time).
// The caller holds the script lock.
function fileIssues_(sh) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return;
  var rows = sh.getDataRange().getValues();
  var tried = 0;
  for (var i = 1; i < rows.length && tried < ISSUES_PER_RUN; i++) {
    if (!rows[i][13] || rows[i][15]) continue;
    tried++;
    var n = createIssue_(rows[i], token);
    if (n) sh.getRange(i + 1, 16, 1, 1).setValues([[n]]);
  }
}

// Run by a time-driven trigger every 15 minutes (SETUP.md): files the issues GitHub refused earlier.
function retryIssues() {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) { return; }
  try { fileIssues_(scoresSheet_()); } finally { lock.releaseLock(); }
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
