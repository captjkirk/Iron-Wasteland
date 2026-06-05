// ============================================================
// IRON WASTELAND — GameOverScene — death/victory + leaderboard
// Split module — loaded by index.html as a classic <script> in
// dependency order. All split files share ONE global scope (no ES
// modules), so top-level symbols are visible across every file.
// Navigation map (MANIFEST) lives at the top of src/config.js.
// ============================================================
'use strict';


// ── SCENE: GAME OVER ─────────────────────────────────────────
class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOver'); }

  init(data) {
    this.reason        = data.reason        || 'You have fallen.';
    this.timeAlive     = data.timeAlive     || 0;
    this.mode          = data.mode          || 1;
    this.difficulty    = data.difficulty    || 'survival';
    this.kills         = data.kills         || 0;
    this.days          = data.days          || 1;
    this.resources     = data.resources     || 0;
    this.bossDefeated  = data.bossDefeated  || false;
    this.p1Name        = data.p1Name        || 'P1';
    this.p2Name        = data.p2Name        || null;
    this.p1Kills       = data.p1Kills       ?? 0;
    this.p2Kills       = data.p2Kills       ?? 0;
    this._dbgEntries   = data.dbgEntries    || null;
    this.won           = data.won           || false;
    this.relicsDeposited = data.relicsDeposited ?? 0;
    this.seed          = data.seed          || null;
    this.version       = data.version       || null;
  }

  _calcScore() {
    let s = 0;
    s += this.days * 100;
    s += this.kills * 25;
    s += this.resources * 5;
    s += Math.floor(this.timeAlive) * 2;
    if (this.bossDefeated) s += 500;
    if (this.won) s += 2000 + this.relicsDeposited * 400;
    if (this.difficulty === 'hardcore') s = Math.floor(s * 1.5);
    return s;
  }

  create() {
    const { W, H } = CFG;
    this.cameras.main.fadeIn(600, 0, 0, 0);
    this._score      = this._calcScore();
    this._nameSaved  = false;
    this._htmlInp    = null;
    this._defaultName = this.p2Name ? this.p1Name + ' & ' + this.p2Name : this.p1Name;

    // Clean up HTML inputs AND keyboard listeners if scene is stopped by any
    // means (back button, restart, etc.) — Key objects outlive the scene
    // otherwise and accumulate stacked callbacks across restarts.
    this.events.on('shutdown', () => {
      this._cleanupInput();
      this._cleanupFeedback();
      if (this._keys) {
        if (this._keys.enter) this._keys.enter.removeAllListeners();
        if (this._keys.space) this._keys.space.removeAllListeners();
        if (this._keys.esc)   this._keys.esc.removeAllListeners();
      }
    });

    // Background
    const bg = this.add.graphics();
    if (this.won) {
      bg.fillGradientStyle(0x001a1a, 0x001a1a, 0x000a0a, 0x000a0a, 1);
    } else {
      bg.fillGradientStyle(0x1a0000, 0x1a0000, 0x000000, 0x000000, 1);
    }
    bg.fillRect(0, 0, W, H);

    this.add.text(W/2, 46, this.won ? 'VICTORY!' : 'GAME OVER', {
      fontFamily:'monospace', fontSize:'64px',
      color: this.won ? '#ffdd44' : '#cc2222',
      stroke: this.won ? '#886600' : '#440000', strokeThickness:8,
    }).setOrigin(0.5);

    this.add.text(W/2, 116, this.reason, {
      fontFamily:'monospace', fontSize:'18px',
      color: this.won ? '#ffcc44' : '#cc8855', stroke:'#000', strokeThickness:3,
    }).setOrigin(0.5);

    // ── Score breakdown panel ──────────────────────────────
    const panelX = W/2 - 220, panelY = 148, panelW = 440;
    const panelH = (this.p2Name ? 262 : 236) + (this.won ? 26 : 0);
    const panel = this.add.graphics();
    const _panelFill = this.won ? 0x001111 : 0x110000;
    const _panelBorder = this.won ? 0x336655 : 0x553333;
    panel.fillStyle(_panelFill, 0.85); panel.fillRoundedRect(panelX, panelY, panelW, panelH, 10);
    panel.lineStyle(1, _panelBorder, 0.8); panel.strokeRoundedRect(panelX, panelY, panelW, panelH, 10);

    const mins = Math.floor(this.timeAlive / 60), secs = Math.floor(this.timeAlive % 60);
    const timeStr = mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
    const modeLabel = (this.mode===1?'1P':'2P') + ' ' + (this.difficulty==='hardcore'?'HARDCORE':'SURVIVAL');

    const killRows = this.p2Name
      ? [
          [this.p1Name + ' kills', this.p1Kills + ' kills', '#ff8844'],
          [this.p2Name + ' kills', this.p2Kills + ' kills', '#ff8844'],
        ]
      : [['Enemies killed', this.p1Kills + ' kills', '#ff8844']];

    const rows = [
      ['Survivors',       this._defaultName,                        '#aabbcc'],
      ['Mode',            modeLabel,                                '#8899aa'],
      ['Days survived',   'Day ' + this.days,                       '#ffee44'],
      ['Time alive',      timeStr,                                  '#cccccc'],
      ...killRows,
      ['Resources found', this.resources + ' items',                '#88cc66'],
      ['Boss defeated',   this.bossDefeated ? 'YES +500' : 'No',   this.bossDefeated ? '#ffdd44' : '#556666'],
      ...(this.won ? [['Relics deposited', this.relicsDeposited + ' / 5  +' + (2000 + this.relicsDeposited * 400), '#cc88ff']] : []),
    ];
    rows.forEach(([label, val, col], i) => {
      const y = panelY + 18 + i * 26;
      this.add.text(panelX + 18, y, label, { fontFamily:'monospace', fontSize:'13px', color:'#556677' }).setOrigin(0,0);
      this.add.text(panelX + panelW - 18, y, val, { fontFamily:'monospace', fontSize:'13px', color: col }).setOrigin(1,0);
    });

    // Total score — animates from 0 to final value over ~900 ms
    const scoreTxt = this.add.text(W/2, panelY + panelH + 18, 'SCORE   0', {
      fontFamily:'monospace', fontSize:'32px', color:'#ffdd44',
      stroke:'#000', strokeThickness:4,
    }).setOrigin(0.5);
    const _scoreTarget = this._score;
    this.time.delayedCall(350, () => {
      const _counter = { val: 0 };
      this.tweens.add({
        targets: _counter, val: _scoreTarget, duration: 900, ease: 'Quad.easeOut',
        onUpdate: () => { scoreTxt.setText('SCORE   ' + Math.floor(_counter.val).toLocaleString()); },
        onComplete: () => { scoreTxt.setText('SCORE   ' + _scoreTarget.toLocaleString()); },
      });
    });

    // ── Name entry section ─────────────────────────────────
    //   Layout (H=720): score total ~376, label ~414, input ~436, save btn ~472,
    //   leaderboard reveals from ~492, nav buttons at 636 (H-84).
    const nameAreaY = panelY + panelH + 56;  // 414
    this.add.text(W/2, nameAreaY, 'ENTER YOUR NAME', {
      fontFamily:'monospace', fontSize:'11px', color:'#778899',
    }).setOrigin(0.5);

    // HTML <input> overlaid on the Phaser canvas at game-space position
    this._htmlInp = this._createNameInput(this._defaultName, nameAreaY + 22);

    // SAVE button
    const saveY = nameAreaY + 58;   // 472
    this._saveBg  = this.add.graphics();
    this._saveTxt = this.add.text(W/2, saveY + 1, 'SAVE SCORE  \u21b5', {
      fontFamily:'monospace', fontSize:'13px', color:'#aaffaa', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);
    const _drawSave = (hl) => {
      this._saveBg.clear();
      this._saveBg.fillStyle(hl ? 0x113311 : 0x001a00, 0.9);
      this._saveBg.fillRoundedRect(W/2 - 90, saveY - 14, 180, 30, 8);
      this._saveBg.lineStyle(2, hl ? 0x66cc66 : 0x44aa44, 0.9);
      this._saveBg.strokeRoundedRect(W/2 - 90, saveY - 14, 180, 30, 8);
    };
    _drawSave(false);
    this._saveZone = this.add.zone(W/2, saveY, 180, 30).setInteractive({ useHandCursor: true });
    this._saveZone.on('pointerover',  () => { _drawSave(true);  this._saveTxt.setColor('#ffffff'); });
    this._saveZone.on('pointerout',   () => { _drawSave(false); this._saveTxt.setColor('#aaffaa'); });
    this._saveZone.on('pointerdown',  () => this._onNameSubmit());

    // Y anchor for leaderboard — revealed by _onNameSubmit after save btn hides
    this._postSaveY = saveY + 20;   // 492

    // ── Navigation buttons — always visible ──────────────
    const makeBtn = (x, label, sublabel, col, borderCol, action) => {
      const g = this.add.graphics();
      g.fillStyle(0x110000, 0.9); g.fillRoundedRect(x - 140, H - 84, 280, 64, 10);
      g.lineStyle(2, borderCol, 0.9); g.strokeRoundedRect(x - 140, H - 84, 280, 64, 10);
      const t = this.add.text(x, H - 63, label, {
        fontFamily:'monospace', fontSize:'20px', color: col, stroke:'#000', strokeThickness:3,
      }).setOrigin(0.5);
      this.add.text(x, H - 37, sublabel, {
        fontFamily:'monospace', fontSize:'10px', color:'#445566',
      }).setOrigin(0.5);
      const zone = this.add.zone(x, H - 52, 280, 64).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => { t.setColor('#ffffff'); g.clear(); g.fillStyle(borderCol, 0.25); g.fillRoundedRect(x-140, H-84, 280, 64, 10); g.lineStyle(2, borderCol, 1); g.strokeRoundedRect(x-140, H-84, 280, 64, 10); });
      zone.on('pointerout',  () => { t.setColor(col); g.clear(); g.fillStyle(0x110000, 0.9); g.fillRoundedRect(x-140, H-84, 280, 64, 10); g.lineStyle(2, borderCol, 0.9); g.strokeRoundedRect(x-140, H-84, 280, 64, 10); });
      zone.on('pointerdown', action);
      this.tweens.add({ targets: t, alpha: 0.45, duration: 700, yoyo: true, repeat: -1 });
      return zone;
    };

    makeBtn(W/2 - 165, '\u25b6  PLAY AGAIN', 'ENTER  /  SPACE', '#aaffaa', 0x44aa44, () => this.restart());
    makeBtn(W/2 + 165, '\u2302  MAIN MENU',  'ESC', '#aaccff', 0x4466aa, () => this.goMenu());

    const K = Phaser.Input.Keyboard.KeyCodes;
    this._keys = this.input.keyboard.addKeys({ enter:K.ENTER, space:K.SPACE, esc:K.ESC });
    this._keys.enter.on('down', () => {
      // Ignore if the HTML input currently has focus (its own keydown handler handles it)
      if (this._htmlInp && document.activeElement === this._htmlInp) return;
      if (!this._nameSaved) this._onNameSubmit();
      else this.restart();
    });
    this._keys.space.on('down', () => { if (this._nameSaved) this.restart(); });
    this._keys.esc.on('down',   () => this.goMenu());
  }

  // Create an HTML <input> element positioned over the Phaser canvas at game-space y.
  _createNameInput(defaultName, gameY) {
    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx = rect.width  / CFG.W;
    const sy = rect.height / CFG.H;

    const inp = document.createElement('input');
    inp.type      = 'text';
    inp.value     = defaultName;
    inp.maxLength = 28;
    inp.style.cssText = [
      'position:fixed',
      `left:${Math.round(rect.left + (CFG.W / 2 - 130) * sx)}px`,
      `top:${Math.round(rect.top  + gameY * sy)}px`,
      `width:${Math.round(260 * sx)}px`,
      `height:${Math.round(30 * sy)}px`,
      'background:#1a0808',
      'border:2px solid #885533',
      'color:#ffcc88',
      'font-family:monospace',
      `font-size:${Math.round(14 * Math.min(sx, sy))}px`,
      'text-align:center',
      'padding:2px 8px',
      'box-sizing:border-box',
      'z-index:9999',
      'outline:none',
      'border-radius:4px',
    ].join(';');

    // Enter in the HTML input saves the score; stopPropagation prevents Phaser
    // from also seeing the keydown and immediately triggering restart().
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this._onNameSubmit(); }
    });

    document.body.appendChild(inp);
    // Brief delay so Phaser's own focus-management doesn't steal it
    this.time.delayedCall(120, () => { if (inp.parentNode) { inp.focus(); inp.select(); } });
    return inp;
  }

  // Called when SAVE is clicked / Enter pressed in input / player navigates away.
  _onNameSubmit() {
    if (this._nameSaved) return;
    this._nameSaved = true;

    const name = (this._htmlInp ? this._htmlInp.value.trim() : '') || this._defaultName || 'Player';
    this._cleanupInput();

    // Swap save button text to a quick confirmation, then reveal leaderboard
    if (this._saveTxt) this._saveTxt.setText('\u2713  ' + name).setColor('#66ee66');
    if (this._saveZone) this._saveZone.disableInteractive();

    // Persist to localStorage
    const lb = this._loadLeaderboard();
    // isHighScore = true only if this score will appear in the visible top-5 after saving.
    // Compare against lb[4] (5th-best existing entry, 0-indexed) before the current run is added.
    const isHighScore = lb.length < 5 || this._score > (lb[4]?.score ?? -1);
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    this._savedName = name; // stash for leaderboard highlight
    lb.push({ name, score: this._score, days: this.days, time: Math.floor(this.timeAlive), date: dateStr });
    lb.sort((a, b) => b.score - a.score);
    lb.splice(10);
    try { localStorage.setItem('iw_scores', JSON.stringify(lb)); } catch(e) {}

    // After short delay, hide save button and show feedback prompt
    this.time.delayedCall(700, () => {
      if (this._saveBg)  this._saveBg.setVisible(false);
      if (this._saveTxt) this._saveTxt.setVisible(false);
      this._showFeedback(isHighScore);
    });
  }

  // Show optional feedback textarea after name is saved.
  _showFeedback(isHighScore) {
    const { W } = CFG;
    let y = this._postSaveY;

    const label = this.add.text(W/2, y, 'HOW WAS YOUR RUN?  (optional)', {
      fontFamily:'monospace', fontSize:'11px', color:'#556677',
    }).setOrigin(0.5);

    this._fbInp = this._createFeedbackInput(y + 18);

    // SEND button
    const sendG = this.add.graphics();
    const sendT = this.add.text(W/2 - 72, y + 86, 'SEND \u2191 LOG', {
      fontFamily:'monospace', fontSize:'13px', color:'#aaccff', stroke:'#000', strokeThickness:2,
    }).setOrigin(0.5);
    const _drawSend = (hl) => {
      sendG.clear();
      sendG.fillStyle(hl ? 0x112233 : 0x0a1520, 0.9);
      sendG.fillRoundedRect(W/2 - 138, y + 72, 132, 28, 6);
      sendG.lineStyle(2, hl ? 0x6699cc : 0x3a5a7a, 0.9);
      sendG.strokeRoundedRect(W/2 - 138, y + 72, 132, 28, 6);
    };
    _drawSend(false);
    const sendZ = this.add.zone(W/2 - 72, y + 86, 132, 28).setInteractive({ useHandCursor: true });
    sendZ.on('pointerover',  () => { _drawSend(true);  sendT.setColor('#ffffff'); });
    sendZ.on('pointerout',   () => { _drawSend(false); sendT.setColor('#aaccff'); });
    sendZ.on('pointerdown',  () => this._submitFeedback(isHighScore, [label, sendG, sendT, sendZ, skipT]));

    // SKIP link
    const skipT = this.add.text(W/2 + 60, y + 86, 'SKIP \u2192', {
      fontFamily:'monospace', fontSize:'12px', color:'#445566',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    skipT.on('pointerover',  () => skipT.setColor('#778899'));
    skipT.on('pointerout',   () => skipT.setColor('#445566'));
    skipT.on('pointerdown',  () => this._submitFeedback(isHighScore, [label, sendG, sendT, sendZ, skipT], true));
  }

  _createFeedbackInput(gameY) {
    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx = rect.width  / CFG.W;
    const sy = rect.height / CFG.H;

    const ta = document.createElement('textarea');
    ta.placeholder = 'What happened? Any bugs or suggestions? (max 300 chars)';
    ta.maxLength   = 300;
    ta.rows        = 3;
    ta.style.cssText = [
      'position:fixed',
      `left:${Math.round(rect.left + (CFG.W / 2 - 170) * sx)}px`,
      `top:${Math.round(rect.top  + gameY * sy)}px`,
      `width:${Math.round(340 * sx)}px`,
      `height:${Math.round(58 * sy)}px`,
      'background:#0d1a22',
      'border:2px solid #3a5a7a',
      'color:#aaccee',
      'font-family:monospace',
      `font-size:${Math.round(12 * Math.min(sx, sy))}px`,
      'padding:4px 8px',
      'box-sizing:border-box',
      'z-index:9999',
      'outline:none',
      'border-radius:4px',
      'resize:none',
    ].join(';');

    ta.addEventListener('keydown', (e) => { e.stopPropagation(); }); // don't let Phaser see keys
    document.body.appendChild(ta);
    this.time.delayedCall(120, () => { if (ta.parentNode) ta.focus(); });
    return ta;
  }

  _submitFeedback(isHighScore, uiObjs, skip = false) {
    const text = (!skip && this._fbInp) ? this._fbInp.value.trim() : '';
    this._cleanupFeedback();
    uiObjs.forEach(o => { if (o?.destroy) o.destroy(); });

    if (text) {
      if (this._dbgEntries) this._dbgEntries.push(`[FEEDBK] ${text}`);
      _qlog(`feedback: ${text.replace(/\n/g, ' ')}  score=${this._score}  day=${this.days}  kills=${this.kills}`, 'feedback');
      this._downloadFeedbackLog(text);
    }
    this._showLeaderboard(isHighScore);
  }

  _cleanupFeedback() {
    if (this._fbInp) {
      try { document.body.removeChild(this._fbInp); } catch(e) {}
      this._fbInp = null;
    }
  }

  // Download a second copy of the log with feedback appended — overwrites the
  // auto-downloaded copy in ./logs/ since the server key is by filename/timestamp.
  _downloadFeedbackLog(feedbackText) {
    if (!this._dbgEntries) return;
    const t    = Math.floor(this.timeAlive || 0);
    const mode = `${this.mode === 1 ? 'Solo' : '2P'} ${this.difficulty === 'hardcore' ? 'Hardcore' : 'Survival'}`;
    const lines = [
      `IRON WASTELAND SESSION LOG`,
      `─────────────────────────────────────────`,
      `Version  : ${_fmtVersion(VERSION)}`,
      `Exported : ${new Date().toLocaleString()}`,
      `Mode     : ${mode}`,
      `Session  : ${Math.floor(t/60)}m ${t%60}s`,
      `Day      : ${this.days}`,
      `Kills    : ${this.kills}`,
      `Feedback : ${feedbackText.replace(/\n/g, ' ')}`,
      `─────────────────────────────────────────`,
      `EVENT LOG (${this._dbgEntries.length} entries)`,
      `─────────────────────────────────────────`,
      ...this._dbgEntries,
    ].join('\n');
    const blob = new Blob([lines], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fname = `iron-wasteland-${ts}-feedback.txt`;
    const a = Object.assign(document.createElement('a'), { href: url, download: fname });
    a.click();
    URL.revokeObjectURL(url);
    if (location.protocol !== 'file:') {
      fetch('/save-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fname, content: lines }),
      })
      .then(r => { if (!r.ok) console.warn('[save-log] server returned', r.status); })
      .catch(e => console.warn('[save-log] failed:', e));
    }
  }

  // Render TOP SCORES after save.  Fits between postSaveY (492) and buttons (636).
  _showLeaderboard(isHighScore) {
    const { W } = CFG;
    let y = this._postSaveY;

    if (isHighScore) {
      this.add.text(W/2, y, '\u2605  NEW HIGH SCORE  \u2605', {
        fontFamily:'monospace', fontSize:'14px', color:'#ffcc22',
      }).setOrigin(0.5);
      y += 22;
    }

    this.add.text(W/2 - 200, y, 'TOP SCORES', {
      fontFamily:'monospace', fontSize:'10px', color:'#445566',
    });
    y += 16;
    const _lb = this._loadLeaderboard(); // includes current run — already saved above
    // Prefer the stable runId that was attached when this run was persisted; fall
    // back to name+score matching for legacy entries saved before runId existed.
    const _myRank = (this._runId && _lb.findIndex(e => e.runId === this._runId));
    const _fallbackRank = _lb.findIndex(e => e.score === this._score && e.name === (this._savedName || this._defaultName));
    const _highlightRank = (_myRank !== undefined && _myRank >= 0) ? _myRank : _fallbackRank;
    _lb.slice(0, 5).forEach((entry, i) => {
      const isMe = _highlightRank >= 0 && i === _highlightRank;
      const col = isMe ? '#ffdd44' : '#778899';
      const datePart = entry.date ? '  ' + entry.date : '';
      const txt = (i + 1) + '.  ' + entry.name.padEnd(14) + entry.score.toLocaleString() + '  Day ' + entry.days + datePart;
      this.add.text(W/2 - 200, y + i * 14, txt, { fontFamily:'monospace', fontSize:'10px', color: col });
    });
  }

  _cleanupInput() {
    if (this._htmlInp) {
      try { document.body.removeChild(this._htmlInp); } catch(e) {}
      this._htmlInp = null;
    }
  }

  // Save silently (no leaderboard reveal) — used when player navigates away before saving.
  _ensureSaved() {
    if (!this._nameSaved) {
      this._nameSaved = true;
      const name = (this._htmlInp ? this._htmlInp.value.trim() : '') || this._defaultName || 'Player';
      const lb = this._loadLeaderboard();
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const _runId = (this._runId ||= Date.now() + ':' + Math.random().toString(36).slice(2, 8));
      lb.push({
        name, score: this._score, days: this.days,
        time: Math.floor(this.timeAlive), date: dateStr, runId: _runId,
        // Verifiability metadata — lets top-score runs be reproduced/inspected
        // later (same seed replays the same world) and tagged by game build.
        difficulty: this.difficulty || null,
        seed: this.seed || null,
        version: this.version || null,
        won: this.won || false,
      });
      lb.sort((a, b) => b.score - a.score);
      lb.splice(10);
      try {
        localStorage.setItem('iw_scores', JSON.stringify(lb));
      } catch(e) {
        // Storage full / disabled: tell the player so they know the run
        // didn't make it onto the leaderboard.
        console.warn('iw_scores save failed:', e && e.message ? e.message : e);
        const warn = this.add.text(CFG.W/2, CFG.H - 12, '⚠ Could not save score (storage full?)', {
          fontFamily: 'monospace', fontSize: '10px', color: '#ff8844',
          backgroundColor: '#000000cc', padding: { x: 6, y: 3 },
        }).setOrigin(0.5).setDepth(500);
        this.time.delayedCall(4500, () => { if (warn && warn.active) warn.destroy(); });
      }
    }
  }

  _loadLeaderboard() {
    try {
      const d = JSON.parse(localStorage.getItem('iw_scores') || '[]');
      return Array.isArray(d) ? d.filter(e => e && typeof e.score === 'number') : [];
    } catch(e) { return []; }
  }

  restart() {
    _qlog(`GameOver: "Play Again" clicked  score=${this._score}  day=${this.days}  kills=${this.kills}`, 'menu');
    this._ensureSaved();
    this._cleanupInput();
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.time.delayedCall(300, () => this.scene.start('CharSelect'));
  }

  goMenu() {
    _qlog(`GameOver: "Main Menu" clicked  score=${this._score}  day=${this.days}  kills=${this.kills}`, 'menu');
    this._ensureSaved();
    this._cleanupInput();
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.time.delayedCall(300, () => this.scene.start('ModeSelect'));
  }
}
