#!/usr/bin/env node
// Iron Wasteland dev server
// Run:  node server.js
// Then open:  http://localhost:8080
//
// Serves the game as static files AND accepts POST /save-log so the game
// can write session logs to ./logs/ — readable by Claude Code.

'use strict';
const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

function lanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

const PORT    = 8080;
const ROOT    = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain',
};

const server = http.createServer((req, res) => {
  // ── POST /save-log ────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/save-log') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { filename, content } = JSON.parse(body);
        // Derive a short client tag from the remote IP so LAN players' logs
        // are identifiable and don't overwrite each other on same-second saves.
        const ip = (req.socket.remoteAddress || '').replace(/[^0-9a-f.]/gi, '') || 'unknown';
        const clientTag = ip === '127.0.0.1' || ip === '::1' ? 'local' : ip.split('.').slice(-2).join('.');
        const base = (filename || 'session').replace(/[^a-zA-Z0-9_.\-]/g, '_');
        // Insert client tag before the .txt extension: iron-wasteland-…-192.168.txt
        const safe = base.replace(/\.txt$/, '') + '-' + clientTag + '.txt';
        const dest = path.join(LOG_DIR, safe);
        fs.writeFileSync(dest, content, 'utf8');
        console.log('[log saved]', dest, '  from', ip);
        res.writeHead(200); res.end('ok');
      } catch (e) {
        res.writeHead(400); res.end('bad request');
      }
    });
    return;
  }

  // ── OPTIONS preflight ─────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204); res.end();
    return;
  }

  // ── Static file serving ───────────────────────────────────────
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Iron Wasteland dev server running at:`);
  console.log(`  http://localhost:${PORT}        (this machine)`);
  console.log(`  http://${lanIP()}:${PORT}   (LAN)`);
  console.log(`Session logs will be saved to: ${LOG_DIR}`);
});
