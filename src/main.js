// ============================================================
// IRON WASTELAND — Phaser.Game launch + resize handlers (loads last)
// Split module — loaded by index.html as a classic <script> in
// dependency order. All split files share ONE global scope (no ES
// modules), so top-level symbols are visible across every file.
// Navigation map (MANIFEST) lives at the top of src/config.js.
// ============================================================
'use strict';


// ── LAUNCH ────────────────────────────────────────────────────
const _phaserGame = new Phaser.Game({
  type: Phaser.AUTO,
  width: CFG.W, height: CFG.H,
  backgroundColor: '#0a0a0a',
  pixelArt: true,
  physics: { default:'arcade', arcade:{ gravity:{y:0}, debug:false } },
  // Mount into our CSS-centered container.  NO_CENTER tells Phaser not to
  // fight the flex layout by setting its own margin offsets on the canvas.
  parent: 'game-container',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
  scene: [BootScene, ModeSelectScene, SettingsScene, ControlsScene, CharSelectScene, GameScene, GameOverScene],
});
// iOS PWA standalone mode: viewport layout may settle slightly after JS starts.
// A deferred refresh ensures the canvas fills the container correctly.
setTimeout(() => _phaserGame.scale.refresh(), 150);
window.addEventListener('resize', () => _phaserGame.scale.refresh());
