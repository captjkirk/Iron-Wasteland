// Phone layout check for the menus and the title screen; smoke.js runs it at each PHONE_SIZES entry.
// Starts each menu scene on a touch phone (canvas 360 high, 640 to 864 wide) and fails when, in
// any state a player can reach:
//   - a text, picture or tap zone sticks out of the canvas;
//   - two texts overlap;
//   - two tap zones (or buttons) overlap;
//   - a tap zone or button is smaller than MIN_TAP game pixels either way, or sits at less than
//     EDGE_GAP from the canvas edge (the notch and the home bar eat into that).
// The checks read object bounds from the live scenes, so they hold whatever the layout code does.
// Text inside a drawn box is not tested against the box (a box is a Graphics object with no
// bounds); a tap zone must cover the texts it labels.
const MIN_TAP = 32;       // game pixels; the canvas shows about 1:1 on a phone
const EDGE_GAP = 4;       // pixels a tap target keeps from the canvas edge
const OVERLAP_SLACK = 1;  // pixels two texts may share (glyph padding)

const PHONE_SIZES = [[667, 375], [844, 390], [932, 430], [640, 360], [568, 320]];

// Each entry brings one scene up in one state. `solo`/`p2` are CharSelect states.
const MENUS = [
  { name: 'title', scene: 'ModeSelect' },
  { name: 'settings', scene: 'Settings' },
  { name: 'settings paused 1P', scene: 'Settings', data: { returnTo: 'Game', p1CharId: 'knight', solo: true } },
  { name: 'settings paused 2P', scene: 'Settings', data: { returnTo: 'Game', p1CharId: 'knight', p2CharId: 'ranger', solo: false } },
  // With a keyboard in use the pause screen lists the keys; the longest lists are the charmer's and the ranger's.
  { name: 'settings paused 1P, keyboard', scene: 'Settings', input: 'keyboard', data: { returnTo: 'Game', p1CharId: 'charmer', solo: true } },
  { name: 'settings paused 2P, keyboard', scene: 'Settings', input: 'keyboard', data: { returnTo: 'Game', p1CharId: 'charmer', p2CharId: 'ranger', solo: false } },
  { name: 'rebind controls', scene: 'Controls' },
  { name: 'characters 1P', scene: 'CharSelect', mode: 1, turns: 'all' },
  { name: 'characters 2P', scene: 'CharSelect', mode: 2, turns: 'all' },
  { name: 'characters 2P, P2 turn', scene: 'CharSelect', mode: 2, p1Done: true },
];

// Runs in the page: brings the scene up and returns the bounds of everything on it.
function readScene(m) {
  return new Promise(resolve => {
    STATE.mode = m.mode || STATE.mode || 1;
    const game = _phaserGame;
    const before = loadSettings().inputMode;
    saveSettings({ inputMode: m.input || 'touch' });
    game.scene.getScenes(true).forEach(s => game.scene.stop(s.scene.key));
    game.scene.start(m.scene, m.data);
    const sc = game.scene.getScene(m.scene);
    const snap = label => {
      const objs = [];
      sc.children.list.forEach(o => {
        if (!o.visible || o.alpha === 0 || !o.getBounds) return;
        const kind = o.type === 'Text' ? 'text' : o.type === 'Zone' ? 'zone' : o.type === 'Image' ? 'image' : null;
        if (!kind) return;
        const b = o.getBounds();
        objs.push({ kind, label: o.type === 'Text' ? o.text.replace(/\n/g, ' / ').slice(0, 30) : '',
          tap: !!o.input, x: b.x, y: b.y, r: b.right, b: b.bottom });
      });
      return { label, objs };
    };
    setTimeout(() => {
      const out = [];
      if (m.turns === 'all') {
        // Every character's stats and ability text, because the panel's height follows them.
        for (let i = 0; i < CHARS.length; i++) {
          sc.p1Idx = i; sc.refresh();
          if (m.mode === 2) { sc.p1Done = true; sc.p2Idx = (i + 1) % CHARS.length; sc.refresh(); sc.p1Done = false; }
          sc._pos = i; sc._layoutWheel(); out.push(snap(`character ${i}`));
        }
      } else {
        if (m.p1Done) { sc.confirm(1); sc.statusText.setText('Now Player 2 — Arrows to pick, / to confirm'); }
        out.push(snap('as shown'));
      }
      saveSettings({ inputMode: before });
      resolve({ W: CFG.W, H: CFG.H, states: out });
    }, 700);
  });
}

function overlap(a, b) {
  return Math.min(a.r, b.r) - Math.max(a.x, b.x) > OVERLAP_SLACK && Math.min(a.b, b.b) - Math.max(a.y, b.y) > OVERLAP_SLACK;
}
const box = o => `${o.label ? '"' + o.label + '"' : o.kind}[${Math.round(o.x)},${Math.round(o.y)}-${Math.round(o.r)},${Math.round(o.b)}]`;

// Returns the problems for one scene state, as strings.
function findProblems({ W, H }, objs) {
  const bad = [];
  for (const o of objs) {
    if (o.x < -0.5 || o.y < -0.5 || o.r > W + 0.5 || o.b > H + 0.5) bad.push(`outside the canvas (${W}x${H}): ${box(o)}`);
  }
  const texts = objs.filter(o => o.kind === 'text');
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    if (overlap(texts[i], texts[j])) bad.push(`texts overlap: ${box(texts[i])} and ${box(texts[j])}`);
  }
  const taps = objs.filter(o => o.tap);
  for (let i = 0; i < taps.length; i++) {
    const t = taps[i];
    if (t.r - t.x < MIN_TAP || t.b - t.y < MIN_TAP) bad.push(`tap target under ${MIN_TAP}px: ${box(t)}`);
    if (t.x < EDGE_GAP || t.y < EDGE_GAP || t.r > W - EDGE_GAP || t.b > H - EDGE_GAP) bad.push(`tap target within ${EDGE_GAP}px of the edge: ${box(t)}`);
    for (let j = i + 1; j < taps.length; j++) {
      if (overlap(t, taps[j])) bad.push(`tap targets overlap: ${box(t)} and ${box(taps[j])}`);
    }
  }
  // A tap zone holds the texts whose centre lies in it, all of each text, or its edge cannot be tapped.
  for (const z of objs.filter(o => o.kind === 'zone')) {
    for (const t of texts) {
      const cx = (t.x + t.r) / 2, cy = (t.y + t.b) / 2;
      const inside = cx > z.x && cx < z.r && cy > z.y && cy < z.b;
      if (inside && (t.x < z.x - 0.5 || t.r > z.r + 0.5 || t.y < z.y - 0.5 || t.b > z.b + 0.5)) bad.push(`text runs past its tap zone: ${box(t)} in ${box(z)}`);
    }
  }
  return [...new Set(bad)];
}

// Page function for smoke.js: throws one Error listing every problem on every menu.
async function checkPhoneMenus(page, size) {
  const found = [];
  for (const m of MENUS) {
    const r = await page.evaluate(readScene, m);
    for (const s of r.states) {
      for (const p of findProblems(r, s.objs)) found.push(`${size} ${m.name} (${s.label}): ${p}`);
    }
  }
  for (const f of found) console.error(`::error::phone menus: ${f}`);
  if (found.length) throw new Error(`${found.length} menu layout problems at ${size} (listed above)`);
}

module.exports = { checkPhoneMenus, findProblems, PHONE_SIZES, MENUS };
