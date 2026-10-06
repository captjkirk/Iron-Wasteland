#!/usr/bin/env node
// Verifies that the MANIFEST comment block at the top of game.js does not
// reference symbols (function names or CFG keys) that no longer exist in
// the file, and that each gameplay system's functions are defined in a file
// its heading names (src/game-scene.js when it names none). Run by CI on
// every PR; also runnable locally:
//
//   node scripts/check-manifest.js
//
// Exits 0 if every referenced symbol is found, 1 otherwise.
'use strict';

const fs = require('fs');
const path = require('path');

// Read game.js (manifest lives here) plus all src/ files (code lives here).
const GAME_FILE = path.join(__dirname, '..', 'game.js');
const SRC_DIR   = path.join(__dirname, '..', 'src');
const src = fs.readFileSync(GAME_FILE, 'utf8');
const srcFiles = fs.existsSync(SRC_DIR)
  ? fs.readdirSync(SRC_DIR)
      .filter(f => f.endsWith('.js'))
      .map(f => ({ name: 'src/' + f, text: fs.readFileSync(path.join(SRC_DIR, f), 'utf8') }))
  : [];
const srcCode = srcFiles.map(f => f.text).join('\n');

// Where each top-level function/const/class or class/prototype method is defined.
// ponytail: a regex, not a parser; a name it finds no definition for is not location-checked.
const defs = new Map();
for (const f of srcFiles) {
  const re = /^(?:function\s+([A-Za-z_]\w*)|(?:const|let|var|class)\s+([A-Za-z_]\w*)|\s{2,4}(?:static\s+(?:get\s+)?)?([A-Za-z_]\w*)\s*\([^)]*\)\s*\{)/gm;
  for (const m of f.text.matchAll(re)) {
    const id = m[1] || m[2] || m[3];
    if (!defs.has(id)) defs.set(id, new Set());
    defs.get(id).add(f.name);
  }
}

const startMarker = 'MANIFEST — NAVIGATION GUIDE';
const endMarker   = '// ── PHASER GAME INIT';
const start = src.indexOf(startMarker);
const end   = src.indexOf(endMarker);
if (start < 0 || end < 0 || end < start) {
  console.error('check-manifest: MANIFEST block not found in game.js.');
  console.error('  Expected "' + startMarker + '" followed by "' + endMarker + '".');
  process.exit(1);
}
const manifest = src.slice(start, end);
// Search game.js (minus the manifest block) + all src/ files.
const code = src.slice(0, start) + src.slice(end) + '\n' + srcCode;

// Labels whose values are function/state-variable identifiers.
const FN_LABELS = new Set([
  'fns', 'biome', 'placement', 'spawn', 'build', 'craft', 'barracks',
  'minimap', 'data', 'chars', 'class', 'scene', 'enemy', 'character',
  'draws',
]);
// Labels whose values are CFG.* keys (verified as `CFG.NAME` in source).
const CFG_LABELS = new Set(['cfg']);
// Labels that are state, not functions: not location-checked.
const STATE_LABELS = new Set(['data', 'chars']);

const fnIds = new Set();
const cfgIds = new Set();
const misplaced = [];
let bucket = null;
let system = null;      // "12" while inside "// 12. RAIDERS ..."
let systemFiles = [];   // files that system's heading names
let locate = false;     // current label's tokens are functions to locate

for (const raw of manifest.split('\n')) {
  const line = raw.replace(/\r$/, '');
  // "// 12. RAIDERS (camps + raid events)  (src/raiders.js)"
  const heading = line.match(/^\/\/ (\d+)\.\s/);
  if (heading) {
    system = heading[1];
    systemFiles = line.match(/src\/[\w-]+\.js/g) || ['src/game-scene.js'];
    bucket = null;
    continue;
  }
  // "//   label: rest" or "//   two words: rest"
  const labelMatch = line.match(/^\/\/\s+(\w+(?: \w+)?):\s*(.*)$/);
  if (labelMatch) {
    const label = labelMatch[1].toLowerCase().split(' ').pop();
    if (FN_LABELS.has(label)) bucket = fnIds;
    else if (CFG_LABELS.has(label)) bucket = cfgIds;
    else bucket = null;
    locate = bucket === fnIds && !STATE_LABELS.has(label);
    if (bucket) extractTokens(labelMatch[2], bucket);
    continue;
  }
  // continuation: "//          token, token"
  const cont = line.match(/^\/\/\s{6,}(.+)$/);
  if (cont && bucket) {
    extractTokens(cont[1], bucket);
    continue;
  }
  bucket = null;
}

function extractTokens(text, target) {
  // strip parenthetical descriptions, e.g. "(scene)" or "(persists)"
  text = text.replace(/\([^)]*\)/g, '');
  for (let tok of text.split(',')) {
    tok = tok.trim();
    if (!tok) continue;
    // ignore log-tag style "[WORLD ]"
    if (tok.startsWith('[')) continue;
    const where = locate && system && defs.get(tok);
    if (where && !systemFiles.some(f => where.has(f))) {
      misplaced.push({ system, id: tok, where: [...where], files: systemFiles });
    }
    // expand "FOO/BAR" into FOO and BAR (used for CFG_KEY_MIN/MAX patterns)
    for (const sub of tok.split('/')) {
      const t = sub.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*\*?$/.test(t)) target.add(t);
    }
  }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stale = [];
for (const id of fnIds) {
  let re;
  if (id.endsWith('*')) {
    const prefix = id.slice(0, -1);
    re = new RegExp('\\b' + escape(prefix) + '[A-Za-z0-9_]*\\b');
  } else {
    re = new RegExp('\\b' + escape(id) + '\\b');
  }
  if (!re.test(code)) stale.push({ kind: 'fn', id });
}
for (const id of cfgIds) {
  // Allow "RIVER_WIDTH_MIN" to match "CFG.RIVER_WIDTH_MIN" anywhere in source.
  const re = new RegExp('CFG\\.' + escape(id) + '\\b');
  if (!re.test(code)) stale.push({ kind: 'cfg', id: 'CFG.' + id });
}

if (misplaced.length) {
  console.error('check-manifest: ' + misplaced.length + ' function' +
    (misplaced.length === 1 ? '' : 's') + ' defined outside the file(s) its system heading names:');
  for (const m of misplaced) {
    console.error('  ' + m.system + '. ' + m.id + ' is in ' + m.where.join(', ') +
      '; heading names ' + m.files.join(', '));
  }
  console.error('');
  console.error('Fix: name the file in that system\'s heading in the MANIFEST, e.g.');
  console.error('  "// 5. PLAYER MOVEMENT & INPUT  (src/game-scene.js; getControls in src/textures.js)".');
  process.exit(1);
}

if (stale.length) {
  console.error('check-manifest: ' + stale.length + ' stale manifest entr' +
    (stale.length === 1 ? 'y' : 'ies') + ' (referenced symbol not found in code):');
  for (const s of stale) console.error('  [' + s.kind + '] ' + s.id);
  console.error('');
  console.error('Fix: open the MANIFEST block at the top of game.js and');
  console.error('  rename or remove these entries so they match the current code.');
  process.exit(1);
}

console.log('check-manifest: OK (' + fnIds.size + ' fn/state ids, ' +
  cfgIds.size + ' CFG keys verified).');
