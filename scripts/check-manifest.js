#!/usr/bin/env node
// Verifies that the MANIFEST comment block at the top of game.js does not
// reference symbols (function names or CFG keys) that no longer exist in
// the file. Run by CI on every PR; also runnable locally:
//
//   node scripts/check-manifest.js
//
// Exits 0 if every referenced symbol is found, 1 otherwise.
'use strict';

const fs = require('fs');
const path = require('path');

const GAME_FILE = path.join(__dirname, '..', 'game.js');
const src = fs.readFileSync(GAME_FILE, 'utf8');

const startMarker = 'MANIFEST — NAVIGATION GUIDE';
const endMarker = "'use strict';";
const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker);
if (start < 0 || end < 0 || end < start) {
  console.error('check-manifest: MANIFEST block not found in game.js.');
  console.error('  Expected the marker "' + startMarker + '" before "' + endMarker + '".');
  process.exit(1);
}
const manifest = src.slice(start, end);
const code = src.slice(0, start) + src.slice(end);

// Labels whose values are function/state-variable identifiers.
const FN_LABELS = new Set([
  'fns', 'biome', 'placement', 'spawn', 'build', 'craft', 'barracks',
  'minimap', 'data', 'chars', 'class', 'scene', 'enemy', 'character',
  'draws',
]);
// Labels whose values are CFG.* keys (verified as `CFG.NAME` in source).
const CFG_LABELS = new Set(['cfg']);

const fnIds = new Set();
const cfgIds = new Set();
let bucket = null;

for (const raw of manifest.split('\n')) {
  const line = raw.replace(/\r$/, '');
  // "//   label: rest"
  const labelMatch = line.match(/^\/\/\s+(\w+):\s*(.*)$/);
  if (labelMatch) {
    const label = labelMatch[1].toLowerCase();
    if (FN_LABELS.has(label)) bucket = fnIds;
    else if (CFG_LABELS.has(label)) bucket = cfgIds;
    else bucket = null;
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
