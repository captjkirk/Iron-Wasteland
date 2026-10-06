'use strict';
// ── PIXEL-GRID ACTORS ─────────────────────────────────────────
// Player and raider art as hand-placed pixel maps: one character = one pixel, '.' is clear,
// '_' erases (attack overlays use it to remove the resting weapon arm), every other
// character is looked up in the actor's palette. Frames are 44x60 and the figure is
// centred on x = 22 so flipX does not shift it. Layers paint in order: legs, body, head.
// grep: "paintGrid"  "SPRITE_ART"  "PLAYER_PAL"  "LEGS"

function paintGrid(layers, pal, w, h) {
  const c = document.createElement('canvas'); c.width = w || 44; c.height = h || 60;
  const ctx = c.getContext('2d');
  for (const L of layers) {
    if (!L) continue;
    const [ox, oy] = L.at;
    L.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        const px = ox + (L.flip ? row.length - 1 - x : x), py = oy + y;
        if (ch === '_') { ctx.clearRect(px, py, 1, 1); continue; }
        const col = pal[ch];
        if (col === undefined) throw new Error('paintGrid: no colour for "' + ch + '"');
        ctx.fillStyle = col; ctx.fillRect(px, py, 1, 1);
      }
    });
  }
  return c;
}

// Shared leg band. P/p trousers, F/f boots, centred on x = 22, top y = 34 (4 hip rows).
const LEGS = {
  front: [
    '..PPPPPPPPPPPp..',
    '..PPPPPPPPPPPp..',
    '..PPPPPPPPPPPp..',
    '..PPPPPPPPPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '.FFFFFf..FFFFFf.',
    '.FFFFFf..FFFFFf.',
    '.FFFFFf..FFFFFf.',
    'FFFFFFf..FFFFFFf',
    'FFFFFFf..FFFFFFf',
    'ffffff....ffffff',
  ],
  front_step: [
    '..PPPPPPPPPPPp..',
    '..PPPPPPPPPPPp..',
    '..PPPPPPPPPPPp..',
    '..PPPPPPPPPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '..PPPPp..PPPPp..',
    '.FFFFFf..PPPPp..',
    '.FFFFFf..PPPPp..',
    '.FFFFFf..PPPPp..',
    'FFFFFFf..FFFFFf.',
    'FFFFFFf..FFFFFf.',
    'ffffff...FFFFFf.',
    '.........FFFFFFf',
    '.........FFFFFFf',
    '..........ffffff',
  ],
  side: [
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppFFFFFf.....',
    '.....ppppFFFFFf.....',
    '.....ffffFFFFFf.....',
    '.....ffffFFFFFFFf...',
    '.....ffffFFFFFFFFf..',
    '.....ffffffffffff...',
  ],
  side_step: [
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '.....ppppPPPPPp.....',
    '....pppp.pPPPPPp....',
    '....pppp..PPPPPp....',
    '...pppp...pPPPPPp...',
    '...pppp....PPPPPp...',
    '...pppp....pPPPPPp..',
    '..pppp......PPPPPp..',
    '..pppp......pPPPPPp.',
    '..pppp.......PPPPPp.',
    '.pppp........PPPPPp.',
    '.pppp........PPPPPp.',
    '.pppp........PPPPPp.',
    '.pppp........PPPPPp.',
    '.ffff........FFFFFf.',
    '.ffff........FFFFFf.',
    'fffff........FFFFFFf',
    'fffff........FFFFFFF',
    'ffff.........FFFFFFF',
    '.............fffffff',
  ],
};

// The heavy raider's armour needs thicker legs than the shared set.
const HEAVY_LEGS = {
  front: [
    '..PPPPPPPPPPPPPPPp..',
    '..PPPPPPPPPPPPPPPp..',
    '..PPPPPPPPPPPPPPPp..',
    '..PPPPPPPPPPPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '.FFFFFFFf..FFFFFFFf.',
    '.FFFFFFFf..FFFFFFFf.',
    '.FFFFFFFf..FFFFFFFf.',
    'FFFFFFFFf..FFFFFFFFf',
    'FFFFFFFFf..FFFFFFFFf',
    'ffffffff....ffffffff',
  ],
  front_step: [
    '..PPPPPPPPPPPPPPPp..',
    '..PPPPPPPPPPPPPPPp..',
    '..PPPPPPPPPPPPPPPp..',
    '..PPPPPPPPPPPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '..PPPPPPp..PPPPPPp..',
    '.FFFFFFFf..PPPPPPp..',
    '.FFFFFFFf..PPPPPPp..',
    '.FFFFFFFf..PPPPPPp..',
    'FFFFFFFFf..FFFFFFFf.',
    'FFFFFFFFf..FFFFFFFf.',
    'ffffffff...FFFFFFFf.',
    '...........FFFFFFFFf',
    '...........FFFFFFFFf',
    '............ffffffff',
  ],
  side: [
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppFFFFFFf.....',
    '.....fffffFFFFFFf.....',
    '.....fffffFFFFFFFFf...',
    '.....fffffffffffff....',
  ],
  side_step: [
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '.....pppppPPPPPPp.....',
    '....ppppp.pPPPPPPp....',
    '....ppppp..PPPPPPp....',
    '...ppppp...pPPPPPPp...',
    '...ppppp....PPPPPPp...',
    '...ppppp....pPPPPPPp..',
    '..ppppp......PPPPPPp..',
    '..ppppp......pPPPPPPp.',
    '..ppppp.......PPPPPPp.',
    '.ppppp........PPPPPPp.',
    '.ppppp........PPPPPPp.',
    '.ppppp........PPPPPPp.',
    '.ppppp........PPPPPPp.',
    '.ppppp........PPPPPPp.',
    '.ppppp........PPPPPPp.',
    '.fffff........FFFFFFf.',
    'ffffff........FFFFFFFf',
    'ffffff........FFFFFFFF',
    'fffff.........FFFFFFFF',
    '..............ffffffff',
  ],
};

const PLAYER_PAL = {
  knight: {
    A: '#5d7fa0', a: '#3b5670', Q: '#a9c6e0', o: '#1c2733',
    S: '#f2c39b', s: '#d59a72', E: '#1a1420', W: '#ffffff', m: '#b0605a',
    R: '#d63c3c', r: '#8f2222', B: '#2c52b4', b: '#1b3680', G: '#ecbc34', g: '#a87818',
    L: '#5a3a20', M: '#e4e9ef', N: '#9aa6b4', D: '#6e4a24',
    P: '#4d6b88', p: '#33495f', F: '#2a3a4c', f: '#161f2a',
  },
  gunslinger: {
    H: '#6b4423', h: '#45290f', I: '#8e6236', K: '#24160a',
    C: '#c98a3a', c: '#8a5a22', Y: '#e6ae60', W: '#ebe4d4', w: '#b8ae9c',
    R: '#b83030', r: '#7a1e1e', O: '#4a3020', X: '#2e1c10',
    S: '#eab48c', s: '#c98d66', E: '#1a1420',
    L: '#3a2412', G: '#d8b040', M: '#a4acb6', N: '#4a5058', D: '#6e4a24',
    P: '#3d5a8a', p: '#2a3f63', F: '#5a3a1e', f: '#36220e',
  },
  architect: {
    Y: '#f0c020', y: '#b08410', Z: '#fff4a0',
    A: '#3a9a55', a: '#1f6635', Q: '#6cc884', o: '#123d20', W: '#dfe6df',
    H: '#6a4428', h: '#43280f', S: '#eab48c', s: '#c98d66', E: '#1a1420',
    L: '#4a3018', T: '#a07040', t: '#6e4a24', G: '#d8b040',
    M: '#c4ccd4', N: '#6a727c',
    P: '#2e3a5c', p: '#1e2640', F: '#4a3420', f: '#2a1c10',
  },
  charmer: {
    H: '#c0612c', h: '#84391a', J: '#e08a4a',
    A: '#8a4fb8', a: '#5c2e80', Q: '#b07ad8', o: '#2a1630',
    K: '#d988bb', k: '#995577', U: '#f0b0d8',
    S: '#f0c4a0', s: '#cf9a76', E: '#1a1420', m: '#b85a6a',
    L: '#4a2a3a', G: '#d8b040', R: '#ff5070', r: '#b02848', Y: '#ffd040', V: '#3a8a3a', v: '#24602a',
    P: '#4a3058', p: '#2e1c38', F: '#6a3a50', f: '#3e2030',
  },
  ranger: {
    A: '#4f6e2e', a: '#304418', Q: '#7a9a4a', o: '#1a2410',
    T: '#8a5a30', t: '#5a3818', H: '#6a4020', h: '#43260f',
    S: '#eab48c', s: '#c98d66', E: '#1a1420',
    D: '#a87438', d: '#6a4418', W: '#e8e0c8', M: '#c8d0d8', L: '#3a2410', G: '#c0a040', R: '#c84040',
    P: '#4a4030', p: '#2e281c', F: '#3e2a18', f: '#24180c',
  },
  raider_brawler: {
    R: '#b02e22', r: '#6a160e', V: '#5a3020', v: '#3a1c10', S: '#c98a5c', s: '#9a6440',
    E: '#1a1010', o: '#1a0e08', M: '#b8bec6', D: '#7a5228', d: '#4a3014',
    L: '#2a1a10', G: '#9a8a50', P: '#5a4a38', p: '#3a3024', F: '#2a2018', f: '#160f0a',
  },
  raider_shooter: {
    H: '#7a6a50', h: '#4e4230', J: '#9a8a6a', C: '#5e6040', c: '#3c3e28', Y: '#7e8058',
    K: '#c08030', B: '#5fd4e8', b: '#2a7080', X: '#8a3a2a', x: '#5a2218',
    S: '#c98a5c', s: '#9a6440', L: '#2a1a10', M: '#7a828c', N: '#3a4048', D: '#6e4a24',
    P: '#4a4438', p: '#2e2a22', F: '#2a2018', f: '#160f0a',
  },
  raider_heavy: {
    A: '#6a7a8a', a: '#45525e', Q: '#98a8b8', o: '#1a2026', r: '#9a5a30', E: '#ff4a2a',
    L: '#2a1a10', G: '#9a8a50', D: '#6e4a24', d: '#4a3014', M: '#5a626c', N: '#353b42',
    P: '#3e4248', p: '#272a2e', F: '#2a2a2a', f: '#141414',
  },
};

// Each part: { at: [x, y], rows }. Frames list which parts they stack.
const SPRITE_ART = {
  knight: {
    front: {
      arms: { rows: [13, 15], cols: [[2, 5], [18, 21]] },
      head: { at: [15, 3], rows: [
        '......RRr.....',
        '.....RRRRr....',
        '.....RRRRr....',
        '....rRRRr.....',
        '...aAQQQAAa...',
        '..aAQQAAAAAa..',
        '.aAQAAAAAAAAa.',
        '.aAAAAAAAAAAa.',
        '.aAooooooooAa.',
        '.aAosEssEsoAa.',
        '.aAoSESSESoAa.',
        '.aAoSSssSSoAa.',
        '.aAAosSSsoAAa.',
        '.aAAAossoAAAa.',
        '..aAAAAAAAAa..',
        '...aaaaaaaa...',
      ] },
      body: { at: [10, 19], rows: [
        '........aAAAAAAa........',
        '..aQQAAa.aAAAAa.aQQAAa..',
        '.aQQAAAAaBBBBBBaQQAAAAa.',
        '.aQAAAAAaBBBBBBaQAAAAAa.',
        '.aAAAAAaABBGGBBAaAAAAAa.',
        '..aaaaaoABGGGGBAoaaaaa..',
        '..aAAaoAABBGGBBAAoaAAa..',
        '..aAAaoAABBBBBBAAoaAAa..',
        '..aAAaoAAABBBBAAAoaAAa..',
        '..aAAaoaAABBBBAAaoaAAa..',
        '..aAAaoLLLLGGLLLLoaAAa..',
        '..aAAaoaAABBBBAAaoaAAa..',
        '..aAAa.aAABBBBAAa.aAAa..',
        '..aQQa.aAABBBBAAa.aQQa..',
        '..aAAa.aaaBBBBaaa.aAAa..',
        '...aa...aaBBBBaa...aa...',
        '.........aBBBBa.........',
        '..........bBBb..........',
        '...........bb...........',
      ] },
      over: { at: [8, 25], rows: [
        'GGGGGGGGg',
        'GBBBBBBBg',
        'GBQBBBBbg',
        'GBBBGBBbg',
        'GBBGGGBbg',
        'GBBBGBBbg',
        'GBBBBBBbg',
        '.GBBBBbg.',
        '.GBBBBbg.',
        '..GBBbg..',
        '..GBbbg..',
        '...Gg....',
      ] },
      weapon: { at: [26, 8], rows: [
        '....M....', '...MN....', '...MN....', '...MN....', '...MN....', '...MN....',
        '...MN....', '...MN....', '...MN....', '...MN....', '...MN....', '...MN....',
        '...MN....', '...MN....', '...MN....', '...MN....', '...MN....', '...MN....',
        '...MN....', '...MN....', '...MN....', '...MN....',
        '.GGGGGGg.',
        '...DD....',
        '..aQQa...',
        '..aAAa...',
        '...DD....',
        '...Gg....',
      ] },
      atk: { at: [26, 29], rows: [
        '..................',
        '..aQQaGMMMMMMMMMMM',
        '..aAAaGNNNNNNNNNNN',
        '......g...........',
      ] },
    },
    back: {
      arms: { rows: [13, 15], cols: [[2, 5], [18, 21]] },
      head: { at: [15, 3], rows: [
        '......RRr.....',
        '.....RRRRr....',
        '.....RRRRr....',
        '....rRRRr.....',
        '...aAQQQAAa...',
        '..aAQQAAAAAa..',
        '.aAQAAAAAAAAa.',
        '.aAAAAAAAAAAa.',
        '.aAAAAAAAAAAa.',
        '.aAAAAAAAAAAa.',
        '.aAAAAAAAAAAa.',
        '.aaAAAAAAAAaa.',
        '.aaaAAAAAAaaa.',
        '.oaaaaaaaaaao.',
        '..aAAAAAAAAa..',
        '...aaaaaaaa...',
      ] },
      body: { at: [10, 19], rows: [
        '........aAAAAAAa........',
        '..aQQAAa.aAAAAa.aQQAAa..',
        '.aQQAAAAaAAAAAAaQQAAAAa.',
        '.aQAAAAAaAQAAAAaQAAAAAa.',
        '.aAAAAAaAAAAAAAAaAAAAAa.',
        '..aaaaaoAAAAAAAAoaaaaa..',
        '..aAAaoAAAAAAAAAAoaAAa..',
        '..aAAaoAAAaAAaAAAoaAAa..',
        '..aAAaoAAAaAAaAAAoaAAa..',
        '..aAAaoaAAAAAAAAaoaAAa..',
        '..aAAaoLLLLLLLLLLoaAAa..',
        '..aAAaoaAAAAAAAAaoaAAa..',
        '..aAAa.aAAAaaAAAa.aAAa..',
        '..aQQa.aAAAaaAAAa.aQQa..',
        '..aAAa.aaaaaaaaaa.aAAa..',
        '...aa...aa....aa...aa...',
      ] },
      behind: { at: [8, 25], rows: [
        'GGGGGGGGg',
        'GbbbbbbbG',
        'GbLbbbLbg',
        'GbLbbbLbg',
        'GbbbbbbbG',
        'GbbbbbbbG',
        'GbbbbbbbG',
        '.GbbbbbG.',
        '.GbbbbbG.',
        '..GbbbG..',
        '..GbbbG..',
        '...Gg....',
      ] },
      weapon: { at: [26, 8], rows: [
        '....M....', '...MN....', '...MN....', '...MN....', '...MN....', '...MN....',
        '...MN....', '...MN....', '...MN....', '...MN....', '...MN....', '...MN....',
        '...MN....', '...MN....', '...MN....', '...MN....', '...MN....', '...MN....',
        '...MN....', '...MN....', '...MN....', '...MN....',
        '.GGGGGGg.',
      ] },
      atk: { at: [26, 4], rows: [
        '............MN....',
        '...........MN.....',
        '..........MN......',
        '.........MN.......',
        '........MN........',
        '.......MN.........',
        '......MN..........',
        '.....MN...........',
        '....MN............',
        '...MN.............',
        '..GMg.............',
        '.G.Dg.............',
      ] },
    },
    side: {
      arms: { rows: [12, 14], cols: [[8, 14]] },
      head: { at: [15, 3], rows: [
        '...RRr........',
        '..RRRRr.......',
        '.rRRRr........',
        'rRr.aAQQAAa...',
        'r..aAQQAAAAAa.',
        '..aAQAAAAAAAAa',
        '..aAAAAAAAAAAa',
        '..aAAAAAAoooo.',
        '..aAAAAAAosEs.',
        '..aAAAAAAoSES.',
        '..aAAAAAAoSSs.',
        '..aAAAAAAAosS.',
        '..aAAAAAAAAAa.',
        '...aAAAAAAAa..',
        '...aaaaaaaa...',
      ] },
      body: { at: [10, 19], rows: [
        '.........aAAAAa.........',
        '.......aAAAAAAAAa.......',
        '......aAAAQQAAAAAa......',
        '......aAAQQQQAAAAa......',
        '......aAAQAAAAAABa......',
        '......aAaaaaaaAABa......',
        '......aAoaAAAaoABa......',
        '......aAoaAAAaoABa......',
        '......aAoaAAAaoABa......',
        '......aAoaAAAaoABa......',
        '......LLoaAAAaoLLL......',
        '......aAoaAAAaoABa......',
        '......aAoaQQQaoABa......',
        '......aAoaAAAaoaBa......',
        '.......aa.aaa..aBb......',
        '...............bb.......',
      ] },
      behind: { at: [27, 25], rows: [
        'GGGg',
        'BBBg',
        'BBBg',
        'GBBg',
        'GBBg',
        'BBBg',
        'BBbg',
        'Bbg.',
        'bg..',
      ] },
      weapon: { at: [19, 13], rows: [
        '.................M..',
        '................MN..',
        '...............MN...',
        '..............MN....',
        '.............MN.....',
        '............MN......',
        '...........MN.......',
        '..........MN........',
        '.........MN.........',
        '........MN..........',
        '.......MN...........',
        '......MN............',
        '...G.MN.............',
        '....GN..............',
        '...DGg..............',
        '..DD.g..............',
        '.aQQa...............',
        '.aAAa...............',
        '.D..................',
      ] },
      atk: { at: [16, 25], rows: [
        'aAAAAAAAABa.................',
        'aAAAAAAAABa.................',
        'aAAAQQQAaaaaaaG.............',
        'aAAAAAAAAAAaQQGMMMMMMMMMMMMM',
        'aAAAAAAAAAAaAAGNNNNNNNNNNNNN',
        'LLLLLLLLLLL...g.............',
        'aAAAAAAAABa.................',
        'aAAAAAAAABa.................',
        'aAAAAAAAaBa.................',
      ] },
    },
    fside: { base: 'front',
      head: { at: [15, 3], rows: [
        '......RRr.....',
        '.....RRRRr....',
        '....rRRRRr....',
        '...rRRRr......',
        '...aAQQQAAa...',
        '..aAQQAAAAAa..',
        '.aAQAAAAAAAAa.',
        '.aAAAAAAAAAAa.',
        '.aAAAoooooooa.',
        '.aAAAosEssEsa.',
        '.aAAAoSESSESa.',
        '.aAAAoSSsSSsa.',
        '.aAAAAosSSsoa.',
        '.aAAAAAossoAa.',
        '..aAAAAAAAAa..',
        '...aaaaaaaa...',
      ] },
    },
    bside: { base: 'back' },
  },
  gunslinger: {
    front: {
      arms: { rows: [13, 14], cols: [[2, 5], [18, 21]] },
      head: { at: [13, 5], rows: [
        '......hHHHHh......',
        '.....hHHIHHHh.....',
        '.....hHIHHHHh.....',
        '.....hKKKKKKh.....',
        'hh..hHHHHHHHHh..hh',
        '.hhhHHIHHHHHHHhhh.',
        '...hhhhhhhhhhhh...',
        '....ssssssssss....',
        '....SsEsSSsEsS....',
        '....SSESSSSESS....',
        '....SSSSssSSSS....',
        '....sSSSSSSSSs....',
        '....sSSSssSSSs....',
        '.....ssssssss.....',
      ] },
      body: { at: [10, 19], rows: [
        '........RRRRRRRR........',
        '...cCCYCrRRRRRRrCYCCc...',
        '..cCCYCCCrRRRRrCCCYCCc..',
        '..cCYCCCCWrRRrWCCCCYCc..',
        '..cCCCcCCWWrrWWCCcCCCc..',
        '..cCCCccCWWWWWWCccCCCc..',
        '..cCCCcCCWWWWWWCCcCCCc..',
        '..cCCCcCCWWwWWWCCcCCCc..',
        '..cCCCcCCWWWWWWCCcCCCc..',
        '..cCCCcCCWWWWWWCCcCCCc..',
        '..cCCCcLLLLGGLLLLcCCCc..',
        '..cCCCcCCPPPPPPCCcCCCc..',
        '..cCCCcCCPPPPPPCCcCCCc..',
        '..sSSs.CCPPPPPPCC.sSSs..',
        '..sSSs.CCPPPPPPCC.sSSs..',
        '.......CCCPPPPCCC.......',
        '.......cCCPppPCCc.......',
        '.......cCCC..CCCc.......',
        '.......cCCC..CCCc.......',
        '.......cCCc..cCCc.......',
        '.......cCCc..cCCc.......',
        '.......ccc....ccc.......',
      ] },
      weapon: { at: [28, 33], rows: [
        '.DDN',
        '.NMMN',
        '.NMMN',
        '..MN.',
        '..MN.',
        '..N..',
      ].map(r => r.padEnd(5, '.')) },
      atk: { at: [26, 30], rows: [
        '......NNMMMMMMMN..',
        '..sSSsNMMNNNNNN...',
        '..sSSsDD..........',
        '.......D..........',
      ] },
    },
    back: {
      arms: { rows: [13, 14], cols: [[2, 5], [18, 21]] },
      head: { at: [13, 5], rows: [
        '......hHHHHh......',
        '.....hHHIHHHh.....',
        '.....hHIHHHHh.....',
        '.....hKKKKKKh.....',
        'hh..hHHHHHHHHh..hh',
        '.hhhHHIHHHHHHHhhh.',
        '...hhhhhhhhhhhh...',
        '....OOOOOOOOOO....',
        '....OOOOOOOOOO....',
        '....OOOOOOOOOO....',
        '....XOOOOOOOOX....',
        '....sXOOOOOOXs....',
        '....sSSSSSSSSs....',
        '.....ssssssss.....',
      ] },
      body: { at: [10, 19], rows: [
        '........RRRRRRRR........',
        '...cCCYCCCCCCCCCCYCCc...',
        '..cCCYCCCCCCCCCCCCYCCc..',
        '..cCYCCCCCCCCCCCCCCYCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcLLLLLLLLLLcCCCc..',
        '..cCCCcCCCCcCCCCCcCCCc..',
        '..cCCCcCCCCcCCCCCcCCCc..',
        '..sSSs.CCCCcCCCCC.sSSs..',
        '..sSSs.CCCCcCCCCC.sSSs..',
        '.......CCCCcCCCCC.......',
        '.......cCCCcCCCCc.......',
        '.......cCCCccCCCc.......',
        '.......cCCC..CCCc.......',
        '.......cCCc..cCCc.......',
        '.......cCCc..cCCc.......',
        '.......ccc....ccc.......',
      ] },
    },
    side: {
      arms: { rows: [12, 13], cols: [[8, 13]] },
      head: { at: [13, 5], rows: [
        '.......hHHHHh.....',
        '......hHIHHHHh....',
        '......hHHHHHHh....',
        '......hKKKKKKh....',
        '..hhhhHHHHHHHHhhh.',
        '...hhhhhhhhhhhhhhh',
        '......OOOsssssss..',
        '......OOOSSSSEsS..',
        '......OOOSSSSESS..',
        '......OOOSSSSSSSs.',
        '......XOOSSSSSSs..',
        '.......XsSSSSSs...',
        '........ssssss....',
      ] },
      body: { at: [10, 19], rows: [
        '.........RRRRRr.........',
        '.......cCCCCCCWRc.......',
        '......cCCYYCCCCWWc......',
        '......cCYYYYCCCWWc......',
        '......cCYCCCCCCWWc......',
        '......cCCccccccWWc......',
        '......cCcCCCCcCWWc......',
        '......cCcCCCCcCWWc......',
        '......cCcCCCCcCWWc......',
        '......cCcCCCCcCWWc......',
        '......cLcCCCCcLLLc......',
        '......cCcCCCCcCPPc......',
        '......cCcsSSScCPPc......',
        '......cCcsSSScCPPc......',
        '......cCCccccCCCCc......',
        '......cCCCCCCCCCCc......',
        '......cCCCCCCCCCCc......',
        '.....cCCCCCCCCCCCc......',
        '.....cCCCCCCCCCCc.......',
        '.....ccCCCCCCCCc........',
        '......cccccccccc........',
      ] },
      weapon: { at: [20, 33], rows: [
        '..DDN',
        '.NMMN',
        '.NMMN',
        '..MN.',
        '..MN.',
        '..N..',
      ] },
      atk: { at: [16, 25], rows: [
        'cCCCCCCCCWWc................',
        'cCYYYYYYYYYYYYYYYYYc........',
        'cCCCCCCCCCCCCCCCCCCcsSSsMMMM',
        'cCccccccccccccccccccsSSsDNN.',
        'cLLLLLLLLLLc........DD......',
        'cCCCCCCCCPPc................',
        'cCCCCCCCCPPc................',
        'cCCCCCCCCPPc................',
      ] },
    },
    fside: { base: 'front',
      head: { at: [13, 5], rows: [
        '......hHHHHh......',
        '.....hHHIHHHh.....',
        '.....hHIHHHHh.....',
        '.....hKKKKKKh.....',
        'hh..hHHHHHHHHh..hh',
        '.hhhHHIHHHHHHHhhh.',
        '...hhhhhhhhhhhh...',
        '....OOssssssss....',
        '....OOSSsEsSsE....',
        '....OOSSSESSSE....',
        '....OOSSSSSSSSs...',
        '....XOSSSSSSSs....',
        '....XsSSSSSSSs....',
        '.....ssssssss.....',
      ] },
    },
    bside: { base: 'back' },
  },
  architect: {
    front: {
      arms: { rows: [12, 14], cols: [[2, 6], [17, 21]] },
      head: { at: [14, 5], rows: [
        '.....yYYYYy.....',
        '...yYZZYYYYYy...',
        '..yYZYYYYYYYYy..',
        '..yYYYYYYYYYYy..',
        '.yyyyyyyyyyyyyy.',
        '...hhhhhhhhhh...',
        '...hsEssssEsh...',
        '...SSESSSSESS...',
        '...SSSSssSSSS...',
        '...HSSSSSSSSH...',
        '...HHHHSSHHHH...',
        '...HHHHHHHHHH...',
        '....HHHHHHHH....',
        '.....hhhhhh.....',
      ] },
      body: { at: [10, 19], rows: [
        '.........aAAAAa.........',
        '..aQQAAAaAAAAAAaQQAAAa..',
        '.aQQAAAAaAAAAAAaQQAAAAa.',
        '.aQAAAAAaAAAoAAaQAAAAAa.',
        '.aAAAAAaWWWWWWWWaAAAAAa.',
        '..aAAAaaAAAoAAAAaaAAAa..',
        '..aAAAaoAAAoAAAAoaAAAa..',
        '..aAAAaoAAAoAAAAoaAAAa..',
        '..aAAAaoWWWWWWWWoaAAAa..',
        '..aAAAaoAAAoAAAAoaAAAa..',
        '..aAAAaoTTLGGLTToaAAAa..',
        '..aAAAaoTtPPPPtToaAAAa..',
        '..sSSSs.TtPPPPtT.sSSSs..',
        '..sSSSs..PPPPPP..sSSSs..',
        '...sss...PPPPPP...sss...',
      ] },
      weapon: { at: [28, 33], rows: [
        '..MN.',
        '..MN.',
        '..MN.',
        '..MN.',
        '.MNNM',
        'MN..M',
        'MN..N',
      ] },
      atk: { at: [27, 30], rows: [
        '..............M.M',
        'sSSSsMMMMMMMMMMNM',
        'sSSSsNNNNNNNNNNNN',
        '..............N.N',
      ] },
    },
    back: {
      arms: { rows: [12, 14], cols: [[2, 6], [17, 21]] },
      head: { at: [14, 5], rows: [
        '.....yYYYYy.....',
        '...yYZZYYYYYy...',
        '..yYZYYYYYYYYy..',
        '..yYYYYYYYYYYy..',
        '.yyyyyyyyyyyyyy.',
        '...hhhhhhhhhh...',
        '...hHHHHHHHHh...',
        '...hHHHHHHHHh...',
        '...hHHHHHHHHh...',
        '...shHHHHHHhs...',
        '...sShhhhhhSs...',
        '...sSSSSSSSSs...',
        '....ssssssss....',
      ] },
      body: { at: [10, 19], rows: [
        '.........aAAAAa.........',
        '..aQQAAAaAAAAAAaQQAAAa..',
        '.aQQAAAAaAAAAAAaQQAAAAa.',
        '.aQAAAAAaAAAAAAaQAAAAAa.',
        '.aAAAAAaWWWWWWWWaAAAAAa.',
        '..aAAAaaAAAAAAAAaaAAAa..',
        '..aAAAaoAAAAAAAAoaAAAa..',
        '..aAAAaoAAAAAAAAoaAAAa..',
        '..aAAAaoWWWWWWWWoaAAAa..',
        '..aAAAaoAAAAAAAAoaAAAa..',
        '..aAAAaoTTLLLLTToaAAAa..',
        '..aAAAaoTtPPPPtToaAAAa..',
        '..sSSSs.TtPPPPtT.sSSSs..',
        '..sSSSs..PPPPPP..sSSSs..',
        '...sss...PPPPPP...sss...',
      ] },
    },
    side: {
      arms: { rows: [12, 14], cols: [[9, 15]] },
      head: { at: [14, 5], rows: [
        '......yYYYYy....',
        '....yYZZYYYYy...',
        '...yYZYYYYYYYy..',
        '...yYYYYYYYYYy..',
        '..yyyyyyyyyyyyyy',
        '....hhhhhhhhh...',
        '....hhhhssEss...',
        '....hhhhSSSES...',
        '....hhhSSSSSSs..',
        '....hhHSSSSSS...',
        '.....hHHHHHHH...',
        '.....hHHHHHHH...',
        '......HHHHHH....',
        '.......hhhh.....',
      ] },
      body: { at: [10, 19], rows: [
        '..........aAAAa.........',
        '........aAAAAAAAa.......',
        '.......aAAQQAAAAAa......',
        '.......aAQQQQAAAAa......',
        '.......aAQAAAAAAWa......',
        '.......aAaaaaaaAWa......',
        '.......aAoaAAAaoWa......',
        '.......aAoaAAAaoAa......',
        '.......aAoaAAAaoAa......',
        '.......aWoWWWWWoWa......',
        '.......TToaAAAaoLT......',
        '.......TtoaAAAaoPt......',
        '.......TtosSSSsoPt......',
        '........PPsSSSsPPP......',
        '........PPPsssPPPP......',
      ] },
      weapon: { at: [20, 33], rows: [
        '..MN.',
        '..MN.',
        '..MN.',
        '..MN.',
        '.MNNM',
        'MN..M',
        'MN..N',
      ] },
      atk: { at: [17, 24], rows: [
        'aAAAAAAAAWa................',
        'aAAAAAAAAWa................',
        'aAQQQQQQQQQQQQQQQQa........',
        'aAAAAAAAAAAAAAAAAAasSSsM.M.',
        'aWaaaaaaaaaaaaaaaaasSSsMMMM',
        'TTLLLLLLLLLT.........NNNNNN',
        'TtAAAAAAAPPt...........N.N.',
        'TtAAAAAAAPPt...............',
      ] },
    },
    fside: { base: 'front',
      head: { at: [14, 5], rows: [
        '.....yYYYYy.....',
        '...yYZZYYYYYy...',
        '..yYZYYYYYYYYy..',
        '..yYYYYYYYYYYy..',
        '.yyyyyyyyyyyyyy.',
        '...hhhhhhhhhh...',
        '...hhhssEssssE..',
        '...hhSSSESSSSE..',
        '...hhSSSSSSsSSs.',
        '...hHSSSSSSSSS..',
        '...hHHHHSSHHHH..',
        '....HHHHHHHHHH..',
        '.....HHHHHHHH...',
        '......hhhhhh....',
      ] },
    },
    bside: { base: 'back' },
  },
  charmer: {
    front: {
      arms: { rows: [10, 11], cols: [[3, 6], [17, 20]], atkDrop: 1 },
      head: { at: [14, 4], rows: [
        '.....hHHHHh.....',
        '...hHHJJHHHHh...',
        '..hHJJHHHHHHHh..',
        '.hHJHHHHHHHHHHh.',
        '.hHHHHHHHHHHRYh.',
        '.hHHhhhhhhhhRrh.',
        '.hHhSSSSSSSShHh.',
        '.hHhsEssssEshHh.',
        '.hHhSESSSSEShHh.',
        '.hHhSSSssSSShHh.',
        '.hHHsSSSSSSsHHh.',
        '.hHHhsSmmSshHHh.',
        '.hHHHhsssshHHHh.',
        '.hHHh......hHHh.',
        '.hHHh......hHHh.',
        '..hh........hh..',
      ] },
      body: { at: [10, 19], rows: [
        '..........SSSS..........',
        '....aQAaAAAAAAAAaAQa....',
        '...aQQAaAAQAAAAAaAQQa...',
        '...aQAAaAAAAAAAAaAQAa...',
        '...aAAaoAAAGGAAAoaAAa...',
        '...aAAaoAAAAAAAAoaAAa...',
        '...aAAaoaAAAAAAaoaAAa...',
        '...aAAa.oaAAAAao.aAAa...',
        '...aAAa.oLLGGLLo.aAAa...',
        '...aAAa.KKKKKKKK.aAAa...',
        '...sSSsKKUKKKKKKksSSs...',
        '...sSSsKUKKKKKKKksSSs...',
        '......KUKKKKKKKKKk......',
        '.....KUKKKKKKKKKKKk.....',
        '.....kKkKKkKKkKKkKk.....',
        '......kk.kk..kk.kk......',
      ] },
      weapon: { at: [26, 24], rows: [
        '.R.Rr.',
        'RYRRYR',
        'rRrRRr',
        '.VRYV.',
        '..VV..',
        '..vV..',
      ] },
      atk: { at: [27, 20], rows: [
        'Q................',
        'QQQQQQQQQsSs.R.Rr',
        'aaaaaaaaasSsRYRRY',
        '___.......V.rRrRr',
        '___........V.VV..',
        '___..............',
        '___..............',
        '___..............',
        '___..............',
        '___..............',
        '___..............',
        '___..............',
      ] },
    },
    back: {
      arms: { rows: [10, 11], cols: [[3, 6], [17, 20]], atkDrop: 1 },
      head: { at: [14, 4], rows: [
        '.....hHHHHh.....',
        '...hHHJJHHHHh...',
        '..hHJJHHHHHHHh..',
        '.hHJHHHHHHHHHHh.',
        '.hHHHHHHHHHHRYh.',
        '.hHHHHHHHHHHRrh.',
        '.hHHHHJHHHHHHHh.',
        '.hHHHJHHHHHHHHh.',
        '.hHHHHHHHHHHHHh.',
        '.hHHHHHHHHHHHHh.',
        '.hHHHHHHHHHHHHh.',
        '.hHHHHHHHHHHHHh.',
        '.hHHHHHHHHHHHHh.',
        '.hHHHHHHHHHHHHh.',
        '..hHHHHHHHHHHh..',
        '...hHHHHHHHHh...',
        '....hHHHHHHh....',
        '.....hhhhhh.....',
      ] },
      body: { at: [10, 19], rows: [
        '..........SSSS..........',
        '....aQAaAAAAAAAAaAQa....',
        '...aQQAaAAAAAAAAaAQQa...',
        '...aQAAaAAAAAAAAaAQAa...',
        '...aAAaoAAAAAAAAoaAAa...',
        '...aAAaoAAAAAAAAoaAAa...',
        '...aAAaoaAAAAAAaoaAAa...',
        '...aAAa.oaAAAAao.aAAa...',
        '...aAAa.oLLLLLLo.aAAa...',
        '...aAAa.KKKKKKKK.aAAa...',
        '...sSSsKKUKKKKKKksSSs...',
        '...sSSsKUKKKKKKKksSSs...',
        '......KUKKKKKKKKKk......',
        '.....KUKKKKKKKKKKKk.....',
        '.....kKkKKkKKkKKkKk.....',
        '......kk.kk..kk.kk......',
      ] },
      weapon: { at: [26, 24], rows: [
        '.R.Rr.',
        'RYRRYR',
        'rRrRRr',
        '.VRYV.',
        '..VV..',
        '..vV..',
      ] },
      atk: { at: [27, 18], rows: [
        '..........R.Rr',
        '.........RYRRY',
        '........sSrRrR',
        '.......sSs.V..',
        '......sSs.....',
        '.....aQa......',
        '....aQa.......',
        '...aQa........',
      ] },
    },
    side: {
      arms: { rows: [10, 11], cols: [[9, 14]] },
      head: { at: [14, 4], rows: [
        '....hHHHHh......',
        '..hHHJJHHHHh....',
        '.hHJJHHHHHHHh...',
        '.hHJHHHHHHHHHh..',
        'hHHHHHHHHRYHHh..',
        'hHHHHHHHHRrhhSh.',
        'hHHHHHHHHhSSSSh.',
        'hHHHHHHHhSSsEs..',
        'hHHHHHHHhSSSES..',
        'hHHHHHHHhSSSSSs.',
        'hHHHHHHHHsSSSs..',
        'hHHHHHHHHhsSmS..',
        'hHHHHHHHHhhss...',
        'hHHHHHHHHh......',
        '.hHHHHHHh.......',
        '.hHHHHHHh.......',
        '..hHHHHh........',
        '...hhhh.........',
      ] },
      body: { at: [10, 19], rows: [
        '...........SSS..........',
        '........aAAAAAAa........',
        '.......aAAQQAAAAa.......',
        '.......aAQQQQAAAa.......',
        '.......aAQAAAAAGa.......',
        '.......aAaaaaaAAa.......',
        '.......aAoaAAaoAa.......',
        '........aoaAAao.a.......',
        '........oLaAAaLLo.......',
        '........KKaAAaKKK.......',
        '.......KKKsSSsKKKk......',
        '......KUKKsSSsKKKKk.....',
        '......KUKKKKKKKKKKk.....',
        '.....KUKKKKKKKKKKKKk....',
        '.....kKkKKkKKkKKkKk.....',
        '......kk.kk..kk.kk......',
      ] },
      weapon: { at: [21, 24], rows: [
        '.R.Rr.',
        'RYRRYR',
        'rRrRRr',
        '.VRYV.',
        '..VV..',
        '..vV..',
      ] },
      atk: { at: [17, 24], rows: [
        'aAAAAAAa.............',
        'aAQQQQQQQQQQsSsR.Rr..',
        'aaaaaaaaaaaasSsRYRRYR',
        '.oAAAAAAo...V.rRrRr..',
        '.oLLLLLLo....V.VV....',
        '.KKAAAAKKK...........',
        'KKKAAAAKKKk..........',
      ] },
    },
    fside: { base: 'front',
      head: { at: [14, 4], rows: [
        '.....hHHHHh.....',
        '...hHHJJHHHHh...',
        '..hHJJHHHHHHHh..',
        '.hHJHHHHHHHHHHh.',
        '.hHHHHHHHHHHRYh.',
        '.hHHHhhhhhhhRrh.',
        '.hHHhSSSSSSSShh.',
        '.hHHhssEssssEh..',
        '.hHHhSSESSSSEs..',
        '.hHHhSSSSSsSSS..',
        '.hHHHsSSSSSSSs..',
        '.hHHHhsSSmmSs...',
        '.hHHHHhssssss...',
        '.hHHHh..........',
        '.hHHHh..........',
        '..hhh...........',
      ] },
    },
    bside: { base: 'back' },
  },
  ranger: {
    front: {
      arms: { rows: [10, 11], cols: [[2, 5], [18, 21]] },
      head: { at: [14, 4], rows: [
        '.......aA.......',
        '......aAAa......',
        '.....aAQAAa.....',
        '....aAQAAAAa....',
        '...aAQAAAAAAa...',
        '..aAQAAAAAAAAa..',
        '..aAAhhhhhhAAa..',
        '..aAhsEssEshAa..',
        '..aAhSESSEShAa..',
        '..aAhSSssSShAa..',
        '..aAhsSSSSshAa..',
        '..aAAhsssshAAa..',
        '..aAAAhhhhAAAa..',
        '...aAAAAAAAAa...',
        '....aaaaaaaa....',
      ] },
      body: { at: [10, 19], rows: [
        '.........aAAAAa.........',
        '...aAQQAAAAAAAAAAQQAa...',
        '..aAQAAAAAAAAAAAAAAQAa..',
        '..aAAAAaTTTTTTTTaAAAAa..',
        '..aAAAaoTTTGTTTToaAAAa..',
        '..aAAAaoTTTTTTTToaAAAa..',
        '..aaaaaoTTTTTTTToaaaaa..',
        '..ttTt.oTTTTTTTTo.tTtt..',
        '..tTTt.oLLLGLLLLo.tTTt..',
        '..tTTt.oTTTTTTTTo.tTTt..',
        '..sSSs.oTTTTTTTTo.sSSs..',
        '..sSSs..TtTTTTtT..sSSs..',
        '........tTTTTTTt........',
        '........tttttttt........',
        '......PPPPPPPPPPPp......',
      ] },
      weapon: { at: [8, 16], rows: [
        '.d....', 'Wdd...', 'W.dD..', 'W..dD.', 'W..dD.', 'W...dD', 'W...dD', 'W...dD',
        'W...dD', 'W...dD', 'W...dD', 'W...LL', 'W...LL', 'W...LL', 'W...dD', 'W...dD',
        'W...dD', 'W...dD', 'W...dD', 'W...dD', 'W..dD.', 'W..dD.', 'W.dD..', 'Wdd...', '.d....',
      ] },
      atk: { at: [30, 17], rows: [
        '.......d......', '......Wdd.....', '......W.dD....', '.....W...dD...', '.....W...dD...',
        '....W.....dD..', '....W.....dD..', '...W......dD..', '...W......dD..', '..W.......dD..',
        '..W.......LL..', '.W........LL..', 'sSDDDDDDDDLLMM', '.W........LL..', '..W.......LL..',
        '..W.......dD..', '...W......dD..', '...W......dD..', '....W.....dD..', '....W.....dD..',
        '.....W...dD...', '.....W...dD...', '......W.dD....', '......Wdd.....', '.......d......',
      ] },
    },
    back: {
      arms: { rows: [10, 11], cols: [[2, 5], [18, 21]] },
      head: { at: [14, 4], rows: [
        '.......aA.......',
        '......aAAa......',
        '.....aAQAAa.....',
        '....aAQAAAAa....',
        '...aAQAAAAAAa...',
        '..aAQAAAAAAAAa..',
        '..aAQAAAAAAAAa..',
        '..aAAAAAAAAAAa..',
        '..aAAAAAAAAAAa..',
        '..aAAAAAAAAAAa..',
        '..aAAAAAAAAAAa..',
        '..aaAAAAAAAAaa..',
        '..aaaAAAAAAaaa..',
        '...aAAAAAAAAa...',
        '....aaaaaaaa....',
      ] },
      behind: { at: [24, 12], rows: [
        'R.R.R..',
        'WRWRWR.',
        '.dDdDd.',
        '..tTTt.',
        '..tTTt.',
        '..tTTt.',
        '..tTTt.',
        '..tTTt.',
      ] },
      body: { at: [10, 19], rows: [
        '.........aAAAAa.........',
        '...aAQQAAAAAAAAAAQQAa...',
        '..aAQAAAAAAAAAAAAAAQAa..',
        '..aAAAAAAAAAAAAAAAAAAa..',
        '..aAAAAAAAAAAAAAAAAAAa..',
        '..aAAAAAAAAAAAAAAAAAAa..',
        '..aaaaaAAAAAAAAAAaaaaa..',
        '..ttTt.aAAAAAAAAa.tTtt..',
        '..tTTt.aAAAAAAAAa.tTTt..',
        '..tTTt.aAAAAAAAAa.tTTt..',
        '..sSSs.aAAAAAAAAa.sSSs..',
        '..sSSs.aAAAAAAAAa.sSSs..',
        '.......aAAAAAAAAa.......',
        '.......aAaAAAaAAa.......',
        '......aAAaAAAaAAAa......',
        '......aaa.aaa.aaaa......',
      ] },
      weapon: { at: [30, 16], rows: [
        '....d.', '...ddW', '..Dd.W', '.Dd..W', '.Dd..W', 'Dd...W', 'Dd...W', 'Dd...W',
        'Dd...W', 'Dd...W', 'Dd...W', 'LL...W', 'LL...W', 'LL...W', 'Dd...W', 'Dd...W',
        'Dd...W', 'Dd...W', 'Dd...W', 'Dd...W', '.Dd..W', '.Dd..W', '..Dd.W', '...ddW', '....d.',
      ] },
      atk: { at: [8, 17], rows: [
        '......d.......', '.....ddW......', '....Dd.W......', '...Dd...W.....', '...Dd...W.....',
        '..Dd.....W....', '..Dd.....W....', '..Dd......W...', '..Dd......W...', '..Dd.......W..',
        '..LL.......W..', '..LL........W.', 'MMLLDDDDDDDDSs', '..LL........W.', '..LL.......W..',
        '..Dd.......W..', '..Dd......W...', '..Dd......W...', '..Dd.....W....', '..Dd.....W....',
        '...Dd...W.....', '...Dd...W.....', '....Dd.W......', '.....ddW......', '......d.......',
      ] },
    },
    side: {
      arms: { rows: [10, 11], cols: [[10, 14]] },
      head: { at: [14, 4], rows: [
        '...aA...........',
        '...aAAa.........',
        '...aAQAAa.......',
        '..aAQAAAAAa.....',
        '..aAQAAAAAAAa...',
        '.aAQAAAAAAAAAa..',
        '.aAAAAAAAhhhAa..',
        '.aAAAAAAhssEsa..',
        '.aAAAAAAhSSES...',
        '.aAAAAAAhSSSSs..',
        '.aAAAAAAAhSSS...',
        '.aAAAAAAAAhss...',
        '..aAAAAAAAAa....',
        '...aAAAAAAa.....',
        '....aaaaaa......',
      ] },
      body: { at: [10, 19], rows: [
        '.........aAAAa..........',
        '.....aAAAAAAAAAa........',
        '....aAQAAAAAAAAAa.......',
        '....aAAAAAAAAAaTa.......',
        '....aAAAAAaaaaaTa.......',
        '....aAAAAAattTatTa......',
        '....aAAAAAatTTatTa......',
        '....aAAAAAatTTatTa......',
        '....aAAAAAatTTaLLa......',
        '.....aAAAAatTTaTTa......',
        '.....aAAAAasSSsTTa......',
        '......aAAAasSSsTt.......',
        '......aAAAAaTTTTt.......',
        '.......aAAAattttt.......',
        '........aaaPPPPPp.......',
      ] },
      weapon: { at: [23, 16], rows: [
        '..d...', '..ddW.', '...dDW', '...dDW', '....dD', '....dD', '....dD', '....dD',
        '....dD', '....dD', '....dD', '....LL', '....LL', '....LL', '....dD', '....dD',
        '....dD', '....dD', '....dD', '....dD', '...dDW', '...dDW', '..ddW.', '..d...',
      ].map(r => r.slice(0, 6)) },
      atk: { at: [20, 17], rows: [
        '..............d.......', '.............Wdd......', '.............W.dD.....', '............W...dD....', '............W...dD....',
        '...........W.....dD...', '...........W.....dD...', '..........W......dD...', '..........W......dD...', '.........W.......dD...',
        'AAAAAAAAAW.......LL...', 'aaaaaaaaW........LL...', 'tTTTTTTsSDDDDDDDDLLMMM', 'ttttttttW........LL...', '.........W.......LL...',
        '..........W......dD...', '..........W......dD...', '...........W.....dD...', '...........W.....dD...', '............W...dD....',
        '............W...dD....', '.............W.dD.....', '.............Wdd......', '..............d.......',
      ] },
    },
    fside: { base: 'front',
      head: { at: [14, 4], rows: [
        '.......aA.......',
        '......aAAa......',
        '.....aAQAAa.....',
        '....aAQAAAAa....',
        '...aAQAAAAAAa...',
        '..aAQAAAAAAAAa..',
        '..aAAAhhhhhhAa..',
        '..aAAhssEsssEa..',
        '..aAAhSSESSSEa..',
        '..aAAhSSSSsSSa..',
        '..aAAhsSSSSSsa..',
        '..aAAAhssssshA..',
        '..aAAAAhhhhAAa..',
        '...aAAAAAAAAa...',
        '....aaaaaaaa....',
      ] },
    },
    bside: { base: 'back' },
  },
  raider_brawler: {
    front: {
      arms: { rows: [11, 13], cols: [[2, 5], [18, 21]] },
      head: { at: [15, 4], rows: [
        '......Rr......',
        '......RRr.....',
        '.....rRRr.....',
        '...sSSRRSSs...',
        '..sSSSRRSSSs..',
        '.sSSSSSSSSSSs.',
        '.sSoooSSoooSs.',
        '.sSsEsSSsEsSs.',
        '.sSSSSssSSSSs.',
        '.sRRRRRRRRRRs.',
        '.sRRrRRRRrRRs.',
        '..RRRRRRRRRR..',
        '...rRRRRRRr...',
        '....rrrrrr....',
      ] },
      body: { at: [10, 19], rows: [
        '.........sSSSSs.........',
        '..MMMMsVVVSSSSVVVsSSSs..',
        '.MMMMMMVVVSSSSVVVSSSSSs.',
        '.oMoMoMVVVsSSsVVVSSSSSs.',
        '.sSSSSsVVVSSSSVVVsSSSSs.',
        '.sSSSSsVVVsSSsVVVsSSSSs.',
        '.sSSSsoVVVSSSSVVVosSSSs.',
        '.sSSSsoVVVsSSsVVVosSSSs.',
        '..sSSsoVVVVVVVVVVosSSs..',
        '..sSSsoLLLLGGLLLLosSSs..',
        '..sSSs.PPPPPPPPPP.sSSs..',
        '..oSSo.PPPPPPPPPP.oSSo..',
        '..sSSs.PPPPpPPPPP.sSSs..',
        '...ss..PPPPpPPPPP..ss...',
        '.......PPPPpPPPPP.......',
      ] },
      weapon: { at: [28, 31], rows: [
        '..DD..', '..Dd..', '.DDdd.', 'MDDDdM', '.DDDd.', 'MDDDdM', '.DDdd.', '..Md..',
      ] },
    },
    back: {
      arms: { rows: [11, 13], cols: [[2, 5], [18, 21]] },
      head: { at: [15, 4], rows: [
        '......Rr......',
        '......RRr.....',
        '.....rRRr.....',
        '...sSSRRSSs...',
        '..sSSSRRSSSs..',
        '.sSSSSRRSSSSs.',
        '.sSSSSRRSSSSs.',
        '.sSSSSrRSSSSs.',
        '.sSSSSSSSSSSs.',
        '.sRRRRRRRRRRs.',
        '.sRRRRrRRRRRs.',
        '..RRRRrrRRRR..',
        '...ss.Rr.ss...',
        '....ssRrss....',
      ] },
      body: { at: [10, 19], rows: [
        '.........sSSSSs.........',
        '..sSSSsVVVVVVVVVVsMMMM..',
        '.sSSSSSVVVVVVVVVVMMMMMM.',
        '.sSSSSSVVVVVVVVVVMoMoMo.',
        '.sSSSSsVVVVVVVVVVsSSSSs.',
        '.sSSSSsVVVVvVVVVVsSSSSs.',
        '.sSSSsoVVVVvVVVVVosSSSs.',
        '.sSSSsoVVVVvVVVVVosSSSs.',
        '..sSSsoVVVVvVVVVVosSSs..',
        '..sSSsoLLLLLLLLLLosSSs..',
        '..sSSs.PPPPPPPPPP.sSSs..',
        '..oSSo.PPPPPPPPPP.oSSo..',
        '..sSSs.PPPPpPPPPP.sSSs..',
        '...ss..PPPPpPPPPP..ss...',
        '.......PPPPpPPPPP.......',
      ] },
      weapon: { at: [28, 31], rows: [
        '..DD..', '..Dd..', '.DDdd.', 'MDDDdM', '.DDDd.', 'MDDDdM', '.DDdd.', '..Md..',
      ] },
    },
    side: {
      arms: { rows: [9, 11], cols: [[9, 13]] },
      head: { at: [15, 4], rows: [
        '....Rr........',
        '...RRRr.......',
        '..rRRRRr......',
        '..RRsSSSSs....',
        '.RRsSSSSSSs...',
        '.RsSSSSSSSSs..',
        '.sSSSSSSoooo..',
        '.sSSSSSSSsEs..',
        '.sSSSSSSSSSSs.',
        '.sSSSSSRRRRRR.',
        '.RRRRRRRRRrRR.',
        '..rRRRRRRRRR..',
        '...rRRRRRRr...',
        '....rrrrrr....',
      ] },
      body: { at: [10, 19], rows: [
        '..........sSSSs.........',
        '.......vVVVVVVVVs.......',
        '......vVVVVVVVVVSs......',
        '......vVVsSSSsVVSs......',
        '......vVsSSSSSsVSs......',
        '......vVsSSSSSsVSs......',
        '......vVsSSSSSsVSs......',
        '......vVsSSSSSsVSs......',
        '......vVVsSSSsVVVs......',
        '......LLLoSSSoLLLL......',
        '.......PPoSSSoPPPP......',
        '.......PPPSSSPPPPP......',
        '.......PPPPPPPPPPP......',
        '.......PPPPPPPPPPP......',
        '.......PPPPPPPPPPP......',
      ] },
      weapon: { at: [20, 30], rows: [
        '..DD..', '..Dd..', '.DDdd.', 'MDDDdM', '.DDDd.', 'MDDDdM', '.DDdd.', '..Md..',
      ] },
    },
    fside: { base: 'front' },
    bside: { base: 'back' },
  },
  raider_shooter: {
    front: {
      arms: { rows: [11, 12], cols: [[2, 5], [18, 21]] },
      head: { at: [15, 6], rows: [
        '....hHHHHh....',
        '...hHJJHHHh...',
        '..hHJHHHHHHh..',
        '.hHJHHHHHHHHh.',
        '.hHHHHHHHHHHh.',
        '.hHHhSSSShHHh.',
        '.hHhKBKKBKhHh.',
        '.hHhKbKKbKhHh.',
        '.hHhsSSSSshHh.',
        '.hHXXXXXXXXHh.',
        '.hHXxXXXXxXHh.',
        '..hXXXXXXXXh..',
        '...xxxxxxxx...',
      ] },
      body: { at: [10, 19], rows: [
        '.........XXXXXX.........',
        '...cCCCCXXXXXXXXCCCCc...',
        '..cCYCCCCCxXXCCCCCCYCc..',
        '..cCYCCCCCCCCCCCCCCYCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCLLCCCCCcCCCc..',
        '..cCCCcCCCCLLCCCCcCCCc..',
        '..cCCCcCCCCCLLCCCcCCCc..',
        '..cCCCcCCCCCCLLCCcCCCc..',
        '..cCCCcLLLLLLLLLLcCCCc..',
        '..cCCCcCCPPPPPPCCcCCCc..',
        '..sSSs.CCPPPPPPCC.sSSs..',
        '..sSSs.CCPPPPPPCC.sSSs..',
        '.......CCPPPPPPCC.......',
        '.......cCCPPPPCCc.......',
        '.......cCC....CCc.......',
        '.......cCc....cCc.......',
        '.......ccc....ccc.......',
      ] },
      weapon: { at: [30, 16], rows: [
        '..N.', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM',
        '..NM', '.DNM', 'DDDN', 'DDDD', 'DDD.', '.DD.',
      ] },
    },
    back: {
      arms: { rows: [11, 12], cols: [[2, 5], [18, 21]] },
      head: { at: [15, 6], rows: [
        '....hHHHHh....',
        '...hHJJHHHh...',
        '..hHJHHHHHHh..',
        '.hHJHHHHHHHHh.',
        '.hHHHHHHHHHHh.',
        '.hHHHHHHHHHHh.',
        '.hKKKKKKKKKKh.',
        '.hHHHHHHHHHHh.',
        '.hHHHHHHHHHHh.',
        '.hHHHHHHHHHHh.',
        '.hXXXXXXXXXXh.',
        '..hXXxxXXXXh..',
        '...xx..xxxx...',
      ] },
      body: { at: [10, 19], rows: [
        '.........XXXXXX.........',
        '...cCCCCCCCCCCCCCCCCc...',
        '..cCYCCCCCCCCCCCCCCYCc..',
        '..cCYCCCCCCCCCCCCCCYCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcCCCCCCCCCCcCCCc..',
        '..cCCCcLLLLLLLLLLcCCCc..',
        '..cCCCcCCCCcCCCCCcCCCc..',
        '..sSSs.CCCCcCCCCC.sSSs..',
        '..sSSs.CCCCcCCCCC.sSSs..',
        '.......CCCCcCCCCC.......',
        '.......cCCCcCCCCc.......',
        '.......cCCC..CCCc.......',
        '.......cCCc..cCCc.......',
        '.......ccc....ccc.......',
      ] },
      weapon: { at: [30, 16], rows: [
        '..N.', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM', '..NM',
        '..NM', '.DNM', 'DDDN', 'DDDD', 'DDD.', '.DD.',
      ] },
    },
    side: {
      head: { at: [15, 6], rows: [
        '....hHHHh.....',
        '...hHJJHHh....',
        '..hHJHHHHHh...',
        '.hHJHHHHHHHh..',
        '.hHHHHHHHHHh..',
        '.hHHHHHHhSSh..',
        '.hHHHHHHKKBK..',
        '.hHHHHHHKKbK..',
        '.hHHHHHHhSSSs.',
        '.hHHHHHXXXXXX.',
        '.hHHHHXXXXxXX.',
        '..hHHXXXXXXX..',
        '...xxxxxxxx...',
      ] },
      body: { at: [10, 19], rows: [
        '..........XXXX..........',
        '........cCCCCCCXc.......',
        '.......cCCYYCCCCCc......',
        '.......cCYYYYCCCCc......',
        '.......cCYCCCCCCCc......',
        '.......cCCcccccCCc......',
        '.......cCcCCCCcLCc......',
        '.......cCcCCCCcCLc......',
        '.......cCcCCCCcCCc......',
        '.......cLcCCCCcLLc......',
        '.......cCcsSSScPPc......',
        '.......cCcsSSScPPc......',
        '.......cCCccccCCCc......',
        '.......cCCCCCCCCCc......',
        '......cCCCCCCCCCCc......',
        '......cCCCCCCCCCc.......',
        '......ccCCCCCCCc........',
        '.......ccccccccc........',
      ] },
      weapon: { at: [18, 27], rows: [
        '..........NNNNNNNNNNMM',
        '..DDDDDDNNMMMMMMMMMMMN',
        '.DDDDDDDsSN...........',
        'DDDD.....N............',
        'DDD...................',
      ] },
    },
    fside: { base: 'front' },
    bside: { base: 'back' },
  },
  raider_heavy: {
    legs: HEAVY_LEGS,
    front: {
      arms: { rows: [10, 13], cols: [[2, 8], [19, 25]] },
      head: { at: [14, 6], rows: [
        '....aAAAAAAa....',
        '..aAQQAAAAAAAa..',
        '.aAQQAAAAAAAAAa.',
        '.aAQAAAAAAAAAAa.',
        '.aAAArAAAAArAAa.',
        '.aAAAAAAAAAAAAa.',
        '.aooooooooooooa.',
        '.aoEEooooooEEoa.',
        '.aooooooooooooa.',
        '.aAAAAAAAAAAAAa.',
        '.aArAAAAAAAArAa.',
        '..aAAAAAAAAAAa..',
        '...aaaaaaaaaa...',
      ] },
      body: { at: [8, 19], rows: [
        '..........aAAAAAAa..........',
        '..aQQAAAAaAAAAAAAAaAAQQAAa..',
        '.aQQAAAAAaAQAAAAAAaAQQAAAAa.',
        '.aQAAAAAAaAAAAAAAAaAQAAAAAa.',
        '.aAAArAAAaAArrAAAAaAAArAAAa.',
        '..aaaaaaaoAAAAAAAAoaaaaaaa..',
        '..aAAAAAaoAAArAAAAoaAAAAAa..',
        '..aAAAAAaoAAAAAAAAoaAAAAAa..',
        '..aAAAAAaoAArAAAAAoaAAAAAa..',
        '..aAAAAAaoLLLGGLLLoaAAAAAa..',
        '..aQQQQQa.PPPPPPPP.aQQQQQa..',
        '..aAAAAAa.PPPPPPPP.aAAAAAa..',
        '..aAAAAAa.PPPPPPPP.aAAAAAa..',
        '...aaaaa.PPPPPPPPPP.aaaaa...',
        '........PPPPPPPPPPPP........',
      ] },
      weapon: { at: [27, 32], rows: [
        '....Dd....', '....Dd....', '....Dd....', '....Dd....', '....Dd....', '....Dd....',
        '....Dd....', '....Dd....', '....Dd....', '.NMMMMMMN.', 'NMMMMMMMMN', 'NMMMMMMMMN',
        'NNNNNNNNNN', '.NNNNNNNN.',
      ] },
    },
    back: {
      arms: { rows: [10, 13], cols: [[2, 8], [19, 25]] },
      head: { at: [14, 6], rows: [
        '....aAAAAAAa....',
        '..aAQQAAAAAAAa..',
        '.aAQQAAAAAAAAAa.',
        '.aAQAAAAAAAAAAa.',
        '.aAAArAAAAArAAa.',
        '.aAAAAAAAAAAAAa.',
        '.aAAAAAAAAAAAAa.',
        '.aAAArAAAArAAAa.',
        '.aAAAAAAAAAAAAa.',
        '.aAAAAAAAAAAAAa.',
        '.aaAAAAAAAAAAaa.',
        '..aaaAAAAAAaaa..',
        '...aaaaaaaaaa...',
      ] },
      body: { at: [8, 19], rows: [
        '..........aAAAAAAa..........',
        '..aQQAAAAaAAAAAAAAaAAQQAAa..',
        '.aQQAAAAAaAQAAAAAAaAQQAAAAa.',
        '.aQAAAAAAaAAAAAAAAaAQAAAAAa.',
        '.aAAArAAAaAAAAAAAAaAAArAAAa.',
        '..aaaaaaaoAAAArrAAoaaaaaaa..',
        '..aAAAAAaoAAAArrAAoaAAAAAa..',
        '..aAAAAAaoAAAAAAAAoaAAAAAa..',
        '..aAAAAAaoAAAAAAAAoaAAAAAa..',
        '..aAAAAAaoLLLLLLLLoaAAAAAa..',
        '..aQQQQQa.PPPPPPPP.aQQQQQa..',
        '..aAAAAAa.PPPPPPPP.aAAAAAa..',
        '..aAAAAAa.PPPPPPPP.aAAAAAa..',
        '...aaaaa.PPPPPPPPPP.aaaaa...',
        '........PPPPPPPPPPPP........',
      ] },
      weapon: { at: [27, 32], rows: [
        '....Dd....', '....Dd....', '....Dd....', '....Dd....', '....Dd....', '....Dd....',
        '....Dd....', '....Dd....', '....Dd....', '.NMMMMMMN.', 'NMMMMMMMMN', 'NMMMMMMMMN',
        'NNNNNNNNNN', '.NNNNNNNN.',
      ] },
    },
    side: {
      arms: { rows: [10, 13], cols: [[10, 17]] },
      head: { at: [14, 6], rows: [
        '....aAAAAAa.....',
        '..aAQQAAAAAAa...',
        '.aAQQAAAAAAAAa..',
        '.aAQAAAAAAAAAa..',
        '.aAAArAAAAAAAa..',
        '.aAAAAAAAAAAAa..',
        '.aAAAAAAAAoooo..',
        '.aAAAAAAAAoEEo..',
        '.aAAAAAAAAoooo..',
        '.aAAAAAAAAAAAa..',
        '.aAAArAAAAAAAa..',
        '..aAAAAAAAAAa...',
        '...aaaaaaaaa....',
      ] },
      body: { at: [8, 19], rows: [
        '...........aAAAAAa..........',
        '.........aAAAAAAAAAa........',
        '........aAAAAQQQAAAAa.......',
        '.......aAAAAQQQQQAAAAa......',
        '.......aAAAAQAAAAAAAAa......',
        '.......aAAAAArAAAAAAAa......',
        '.......aAAaaaaaaaaAAAa......',
        '.......aAAaAAAAAAaAAAa......',
        '.......aAAaAAAAAAaAAAa......',
        '.......aLLaAAAAAAaLLLa......',
        '.......aPPaQQQQQQaPPPa......',
        '.......aPPaAAAAAAaPPPa......',
        '.......aPPaAAAAAAaPPPa......',
        '........PPPaaaaaaPPP........',
        '........PPPPPPPPPPPP........',
      ] },
      weapon: { at: [17, 32], rows: [
        '....Dd....', '....Dd....', '....Dd....', '....Dd....', '....Dd....', '....Dd....',
        '....Dd....', '....Dd....', '....Dd....', '.NMMMMMMN.', 'NMMMMMMMMN', 'NMMMMMMMMN',
        'NNNNNNNNNN', '.NNNNNNNN.',
      ] },
    },
    fside: { base: 'front' },
    bside: { base: 'back' },
  },
};

// Frame list per actor, matching the keys buildAtlases packs:
// <id><dir>, <id><dir>_step, <id><dir>_step2, <id>_atk<dir>. Side is the bare key.
// Back views paint the weapon before the body so it reads as held in front of him.
const ART_DIRS = { '': 'side', '_front': 'front', '_back': 'back', '_fside': 'fside', '_bside': 'bside' };

function _artParts(art, dir) {
  const d = art[dir];
  return d.base ? Object.assign({}, art[d.base], d, { back: art[d.base].back || d.base === 'back' }) : Object.assign({}, d, { back: dir === 'back' });
}

// Hands used to stop at the belt, so every figure read as a hard T at the waist. The arm
// layer redraws each arm ARM_DROP rows longer: the sleeve row above the hand fills the gap
// and the hand rows move down beside the thighs. Held weapons move down with the hand.
const ARM_DROP = 5;

function _armLayer(body, spec, cols) {
  const [h, e] = spec.rows, w = body.rows[0].length;
  const grid = Array.from({ length: e + ARM_DROP + 1 }, () => Array(w).fill('.'));
  for (const [a, b] of cols) for (let x = a; x <= b; x++) {
    const sleeve = body.rows[h - 1][x];
    for (let r = h; r < h + ARM_DROP; r++) grid[r][x] = sleeve === '.' ? '_' : sleeve;
    for (let r = h; r <= e; r++) if (body.rows[r][x] !== '.') grid[r + ARM_DROP][x] = body.rows[r][x];
  }
  return { at: body.at, rows: grid.map(r => r.join('')) };
}

const _drop = (L) => L && { at: [L.at[0], L.at[1] + ARM_DROP], rows: L.rows };

function _artLayers(parts, legs, atk, side) {
  const spec = parts.arms;
  // Side attacks raise the near (only) arm, so they keep the short body arm; atkDrop leaves
  // out the weapon-side arm for overlays that draw it raised from the shoulder.
  let arms = null;
  if (spec && !(atk && side)) {
    const cols = atk && spec.atkDrop != null ? spec.cols.filter((_, i) => i !== spec.atkDrop) : spec.cols;
    arms = _armLayer(parts.body, spec, cols);
  }
  let weapon = parts.weapon;
  if (spec) weapon = _drop(weapon);
  if (atk && parts.atk) weapon = spec && !side && spec.atkDrop == null ? _drop(parts.atk) : parts.atk;
  return parts.back
    ? [legs, weapon, parts.behind, parts.body, arms, parts.over, parts.head]
    : [legs, parts.behind, parts.body, arms, parts.over, weapon, parts.head];
}

function pixelActorFrames(id) {
  const art = SPRITE_ART[id], pal = PLAYER_PAL[id], out = {};
  for (const [sfx, dir] of Object.entries(ART_DIRS)) {
    const parts = _artParts(art, dir);
    const kind = dir === 'side' ? 'side' : 'front';
    const L = (rows, flip) => ({ at: [22 - rows[0].length / 2, 34], rows, flip });
    const legs = art.legs || LEGS;
    const side = kind === 'side';
    out[id + sfx] = paintGrid(_artLayers(parts, L(legs[kind])), pal);
    out[id + sfx + '_step'] = paintGrid(_artLayers(parts, L(legs[kind + '_step'])), pal);
    out[id + sfx + '_step2'] = paintGrid(_artLayers(parts, L(legs[kind + '_step'], true)), pal);
    if (art.front.atk) out[id + '_atk' + sfx] = paintGrid(_artLayers(parts, L(legs[kind]), true, side), pal);
  }
  return out;
}

// Called from buildTextures before polishActors/buildAtlases, which add the outline and
// foot shadow and pack these into player_atlas / raider_atlas.
function buildPixelActors(scene) {
  for (const id of Object.keys(SPRITE_ART)) {
    for (const [key, canvas] of Object.entries(pixelActorFrames(id))) scene.textures.addCanvas(key, canvas);
  }
}

// ── SCENERY ───────────────────────────────────────────────────
// Trees, rocks, bushes and built walls are painted pixel by pixel at native size and always
// shown at ART_SCALE, the characters' pixel size, so nothing in the world is stretched.
// Size variety comes from drawn variants (texture frames 0..n), never from random scaling.
// Shapes are seeded, so every load paints the same pixels.
// grep: "SCENERY_SPECS"  "buildScenery"  "placeScenery"
const ART_SCALE = 1.5;

function _buf(w, h) { return { w, h, c: new Array(w * h).fill(null) }; }
function _put(b, x, y, col) {
  x = Math.floor(x); y = Math.floor(y);
  if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.c[y * b.w + x] = col;
}
function _at(b, x, y) { return x >= 0 && y >= 0 && x < b.w && y < b.h ? b.c[y * b.w + x] : null; }
function _noise(x, y, s) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const _rng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// Shaded ellipse. ramp runs dark to light; light comes from the upper left, like the actors.
// bias darkens (negative) or lightens a whole shape; rough eats into the edge for leafy rims.
function _blob(b, cx, cy, rx, ry, ramp, seed, rough, bias) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
    const n = _noise(x, y, seed);
    if (d > 1 - (rough || 0) * n) continue;
    const l = 0.6 - 0.5 * dx - 0.65 * dy - 0.25 * d + (n - 0.5) * 0.22 + (bias || 0);
    _put(b, x, y, ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(l * ramp.length)))]);
  }
}
function _line(b, x0, y0, x1, y1, col, wdt) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
    for (let k = 0; k < (wdt || 1); k++) _put(b, x + k, y, col);
  }
}
// Bark/stem column from (cx, y0) down to y1, width tapering from w0 (top) to w1 (bottom).
function _trunk(b, cx, y0, y1, w0, w1, ramp, seed) {
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0), w = w0 + (w1 - w0) * t;
    for (let x = Math.round(cx - w / 2); x < Math.round(cx + w / 2); x++) {
      const u = (x + 0.5 - (cx - w / 2)) / w, n = _noise(x, y, seed);
      _put(b, x, y, ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor((0.9 - u * 0.8 + (n - 0.5) * 0.35) * ramp.length)))]);
    }
  }
}

// Outline + base shadow, then paint to a canvas the size of the buffer.
function _bufCanvas(b, outline, shadow) {
  const c = document.createElement('canvas'); c.width = b.w; c.height = b.h;
  const ctx = c.getContext('2d');
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const dx = (x + 0.5 - shadow[0]) / shadow[2], dy = (y + 0.5 - shadow[1]) / shadow[3];
      if (dx * dx + dy * dy <= 1) ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    let col = b.c[y * b.w + x];
    if (!col && outline && (_at(b, x - 1, y) || _at(b, x + 1, y) || _at(b, x, y - 1) || _at(b, x, y + 1))) col = outline;
    if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }
  }
  return c;
}

const SC_PAL = {
  bark:   ['#2e1c10', '#4a2e18', '#6a4424', '#8a5e34'],
  leaf:   ['#163a14', '#245a1c', '#357a26', '#4c9a32', '#74bc48'],
  pine:   ['#0e2a1c', '#173f28', '#225836', '#2f7044'],
  snow:   ['#c8d8e8', '#eef6ff'],
  dead:   ['#2a2420', '#4a4038', '#6a5e52', '#8a7e70'],
  swamp:  ['#1a2810', '#2a3c16', '#3c5020', '#52682c'],
  moss:   ['#4a5a2a', '#6a7a3a'],
  stalk:  ['#a89a88', '#cfc2ae', '#e8dcc8'],
  cap:    ['#3a1448', '#5a2070', '#7a3494', '#a050b8'],
  cactus: ['#1e4a24', '#2e6630', '#3e8040', '#5aa058'],
  rock:   ['#3a3a40', '#55555c', '#707078', '#8c8c94', '#a8a8b0'],
  sand:   ['#6a4a2a', '#8a6438', '#aa8048', '#c89c5c', '#e0bc7c'],
  ice:    ['#3a5a7a', '#5a84a8', '#80aed0', '#aed4ec', '#e0f2ff'],
  shroom: ['#7a2a3a', '#a83a50', '#d0566c'],
  wall:   ['#3a2c1c', '#5a4428', '#7a6038', '#9a7c4c', '#b89a64'],
};
const SC_OUT = '#141016';

function _leafyTree(w, h, seed, opts) {
  const b = _buf(w, h), r = _rng(seed), cx = w / 2, base = h - 3;
  const trunkTop = Math.round(h * (opts.trunkTop || 0.5));
  _trunk(b, cx, trunkTop, base, Math.max(3, w * 0.09), Math.max(4, w * 0.14), SC_PAL.bark, seed);
  _line(b, cx - w * 0.1, base, cx + w * 0.1, base, SC_PAL.bark[0], 1); // root flare
  const ccx = cx, ccy = h * (opts.canopyY || 0.36), crx = w * 0.46, cry = h * (opts.canopyRy || 0.33);
  const clumps = [];
  for (let i = 0; i < (opts.clumps || 9); i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.6;
    clumps.push({ x: ccx + Math.cos(a) * crx * d, y: ccy + Math.sin(a) * cry * d, rr: 0.38 + r() * 0.16 });
  }
  clumps.sort((p, q) => p.y - q.y);
  _blob(b, ccx, ccy + cry * 0.15, crx * 0.85, cry * 0.85, opts.ramp, seed + 7, 0.1, -0.25); // dark core
  clumps.forEach((k, i) => _blob(b, k.x, k.y, crx * k.rr, cry * k.rr * 1.1, opts.ramp, seed + i, 0.25, -0.18 * (k.y - ccy) / cry));
  if (opts.moss) for (let x = Math.floor(ccx - crx * 0.8); x < ccx + crx * 0.8; x += 2) {
    if (_noise(x, 1, seed) < 0.45) continue;
    let y = ccy; while (y < h && _at(b, x, Math.floor(y))) y++;
    _line(b, x, y - 1, x, y - 1 + 3 + Math.floor(_noise(x, 2, seed) * h * 0.18), opts.moss[_noise(x, 3, seed) < 0.5 ? 0 : 1], 1);
  }
  return _bufCanvas(b, SC_OUT, [cx, base, w * 0.32, Math.max(2, h * 0.04)]);
}

function _pineTree(w, h, seed, snow) {
  const b = _buf(w, h), cx = w / 2, base = h - 3, tiers = 5, tierOf = new Int8Array(w * h).fill(-1);
  _trunk(b, cx, Math.round(h * 0.8), base, 4, 5, SC_PAL.bark, seed);
  const top = 1, bottom = h * 0.86;
  for (let t = tiers - 1; t >= 0; t--) {
    const yt = top + (bottom - top) * t / (tiers + 1.2), yb = top + (bottom - top) * (t + 1.6) / (tiers + 0.4);
    const wb = (w / 2 - 1) * (0.45 + 0.55 * (t + 1) / tiers);
    for (let y = Math.floor(yt); y <= yb; y++) {
      const half = (y - yt) / (yb - yt) * wb;
      for (let x = Math.floor(cx - half); x <= cx + half; x++) {
        const n = _noise(x, y, seed + t);
        if (y > yb - 2 && n < 0.4) continue; // ragged hem
        const u = (x - (cx - half)) / Math.max(1, 2 * half);
        const l = 0.8 - 0.6 * u + (n - 0.5) * 0.25 - 0.35 * (y - yt) / (yb - yt);
        _put(b, x, y, SC_PAL.pine[Math.max(0, Math.min(3, Math.floor(l * 4)))]);
        if (x >= 0 && y >= 0 && x < w && y < h) tierOf[Math.floor(y) * w + x] = t;
      }
    }
  }
  // Each tier's top surface is the strip just under the hem of the tier above: shade the
  // first row (the hem's shadow), then lay snow on the left-lit part below it.
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
    const t = tierOf[y * w + x], above = tierOf[(y - 1) * w + x];
    if (t < 0 || above === t) continue;
    if (above >= 0) _put(b, x, y, SC_PAL.pine[0]);
    if (!snow) continue;
    const u = (x - cx) / (w / 2);
    for (let k = above >= 0 ? 1 : 0; k < 3; k++) {
      if (tierOf[(y + k) * w + x] !== t || _noise(x, y + k, 99) < 0.2 + k * 0.25) break;
      _put(b, x, y + k, SC_PAL.snow[u < 0.15 ? 1 : 0]);
    }
  }
  return _bufCanvas(b, SC_OUT, [cx, base, w * 0.3, Math.max(2, h * 0.035)]);
}

function _deadTree(w, h, seed) {
  const b = _buf(w, h), r = _rng(seed), cx = w / 2, base = h - 3;
  _trunk(b, cx, Math.round(h * 0.2), base, 3, Math.max(5, w * 0.14), SC_PAL.dead, seed);
  const branch = (x, y, ang, len, wdt, depth) => {
    const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
    _line(b, x, y, x1, y1, SC_PAL.dead[depth > 1 ? 2 : 1], wdt);
    if (depth > 0) for (let i = 0; i < 2; i++) branch(x1, y1, ang + (r() - 0.5) * 1.3, len * 0.62, Math.max(1, wdt - 1), depth - 1);
  };
  for (let i = 0; i < 4; i++) {
    const y = h * (0.22 + 0.42 * r()), side = i % 2 ? 1 : -1;
    branch(cx, y, -Math.PI / 2 + side * (0.6 + r() * 0.5), w * (0.22 + r() * 0.14), 2, 2);
  }
  branch(cx, h * 0.22, -Math.PI / 2 + (r() - 0.5) * 0.4, h * 0.18, 2, 2);
  return _bufCanvas(b, SC_OUT, [cx, base, w * 0.26, Math.max(2, h * 0.04)]);
}

function _mushroomTree(w, h, seed) {
  const b = _buf(w, h), cx = w / 2, base = h - 3;
  _trunk(b, cx, Math.round(h * 0.4), base, w * 0.2, w * 0.26, SC_PAL.stalk, seed);
  const capH = h * 0.46;
  for (let y = 1; y < capH; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - cx) / (w / 2 - 1), dy = (capH - y) / (capH - 1);
    if (dx * dx + dy * dy > 1) continue;
    const n = _noise(x, y, seed), l = 0.6 - 0.45 * dx - 0.3 * (1 - dy) + (n - 0.5) * 0.25;
    _put(b, x, y, y > capH - 3 ? '#2a0e34' : SC_PAL.cap[Math.max(0, Math.min(3, Math.floor(l * 4)))]);
  }
  const r = _rng(seed);
  for (let i = 0; i < 5; i++) {
    const sx = cx + (r() - 0.5) * w * 0.65, sy = capH * (0.25 + r() * 0.5), sr = 1 + r() * 1.6;
    if (_at(b, Math.floor(sx), Math.floor(sy))) _blob(b, sx, sy, sr, sr, ['#d8c8e0', '#f4ecf8'], seed + i, 0, 0.2);
  }
  return _bufCanvas(b, SC_OUT, [cx, base, w * 0.3, Math.max(2, h * 0.04)]);
}

function _cactus(w, h, seed) {
  const b = _buf(w, h), r = _rng(seed), cx = w / 2, base = h - 3, bw = Math.max(6, Math.round(w * 0.3));
  const column = (x0, y0, y1, cw) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x < x0 + cw; x++) {
      const u = (x - x0 + 0.5) / cw, top = y - y0 < cw / 2 ? Math.abs(u - 0.5) * 2 > Math.sqrt(1 - ((cw / 2 - (y - y0)) / (cw / 2)) ** 2) : false;
      if (top) continue;
      const rib = (x - x0) % 2 === 0 ? 0.12 : 0;
      _put(b, x, y, SC_PAL.cactus[Math.max(0, Math.min(3, Math.floor((0.85 - 0.7 * u + rib) * 4)))]);
    }
  };
  column(Math.round(cx - bw / 2), 1, base, bw);
  const aw = Math.max(4, bw - 2);
  [-1, 1].forEach((side, i) => {
    const ay = Math.round(h * (0.35 + r() * 0.2)), ax = side < 0 ? Math.round(cx - bw / 2 - aw - 1) : Math.round(cx + bw / 2 + 1);
    column(ax, Math.round(ay - h * (0.12 + r() * 0.1)), ay + aw, aw);
    for (let x = Math.min(ax, Math.round(cx)); x < Math.max(ax + aw, Math.round(cx)); x++) for (let y = ay; y < ay + aw - 1; y++) if (!_at(b, x, y)) _put(b, x, y, SC_PAL.cactus[1 + i]);
  });
  return _bufCanvas(b, SC_OUT, [cx, base, w * 0.3, 2]);
}

function _rock(w, h, seed, ramp) {
  const b = _buf(w, h), r = _rng(seed), base = h - 2;
  for (let i = 0; i < 3; i++) {
    const rx = w * (0.3 + r() * 0.16), ry = h * (0.34 + r() * 0.14);
    _blob(b, w * (0.3 + 0.2 * i) + (r() - 0.5) * 2, base - ry, rx, ry, ramp, seed + i, 0.08, i === 1 ? 0.08 : -0.05);
  }
  for (let i = 0; i < 2; i++) { // cracks
    let x = w * (0.3 + r() * 0.4), y = h * (0.3 + r() * 0.2);
    for (let k = 0; k < h * 0.35; k++) { if (_at(b, Math.floor(x), Math.floor(y))) _put(b, x, y, ramp[0]); x += r() - 0.5; y += 1; }
  }
  return _bufCanvas(b, SC_OUT, [w / 2, base, w * 0.5, Math.max(2, h * 0.15)]);
}

function _bush(w, h, seed, berries) {
  const b = _buf(w, h), r = _rng(seed), base = h - 2;
  for (let i = 0; i < 4; i++) _blob(b, w * (0.25 + 0.5 * r()), base - h * (0.3 + 0.2 * r()), w * 0.3, h * 0.38, SC_PAL.leaf, seed + i, 0.3, -0.05);
  if (berries) for (let i = 0; i < 5; i++) { const x = Math.floor(w * (0.2 + 0.6 * r())), y = Math.floor(h * (0.25 + 0.5 * r())); if (_at(b, x, y)) _put(b, x, y, '#d8344a'); }
  return _bufCanvas(b, SC_OUT, [w / 2, base, w * 0.45, 2]);
}

function _mushrooms(w, h, seed) {
  const b = _buf(w, h), r = _rng(seed), base = h - 2;
  for (let i = 0; i < 3; i++) {
    const x = w * (0.2 + 0.3 * i) + (r() - 0.5) * 2, ch = h * (0.35 + r() * 0.4), cw = 2.5 + r() * 2;
    _line(b, x, base, x, base - ch, SC_PAL.stalk[1], 2);
    _blob(b, x + 1, base - ch, cw, cw * 0.7, SC_PAL.shroom, seed + i, 0, 0.1);
  }
  return _bufCanvas(b, SC_OUT, [w / 2, base, w * 0.45, 2]);
}

// Built wall: front face fills the 32 px tile (21 art px at 32/21 scale), with a top face
// above it. Displayed at WALL_SCALE so the front face lines up with the tile grid exactly.
const WALL_SCALE = 32 / 21;
function _wall(seed) {
  const w = 21, h = 30, top = 9, b = _buf(w, h), ramp = SC_PAL.wall;
  for (let y = 0; y < top; y++) for (let x = 0; x < w; x++) {
    const n = _noise(x, y, seed);
    _put(b, x, y, ramp[y < 1 ? 4 : (n < 0.15 ? 2 : 3)]);
  }
  for (let y = top; y < h; y++) {
    const row = Math.floor((y - top) / 5), off = row % 2 ? 5 : 0;
    for (let x = 0; x < w; x++) {
      const mortar = (y - top) % 5 === 4 || (x + off) % 10 === 9;
      const n = _noise(x, y, seed), l = 0.7 - 0.35 * (y - top) / (h - top) + (n - 0.5) * 0.3;
      _put(b, x, y, mortar ? ramp[0] : ramp[Math.max(1, Math.min(3, Math.floor(l * 4)))]);
    }
  }
  for (let x = 0; x < w; x++) _put(b, x, top, ramp[1]); // lip shadow under the top face
  return _bufCanvas(b, null, null);
}

// key → list of [w, h] variants (art pixels) and the painter. Heights are measured against a
// person, who is about 55 art pixels tall: trees 1.2-1.9 people, rocks knee to waist.
const SCENERY_SPECS = {
  tree:           { sizes: [[46, 66], [56, 82], [66, 98]],  paint: (w, h, s) => _leafyTree(w, h, s, { ramp: SC_PAL.leaf }) },
  tree_snow:      { sizes: [[36, 72], [44, 90], [52, 106]], paint: (w, h, s) => _pineTree(w, h, s, true) },
  tree_dead:      { sizes: [[40, 64], [48, 80], [56, 94]],  paint: (w, h, s) => _deadTree(w, h, s) },
  tree_swamp:     { sizes: [[54, 64], [66, 78], [76, 90]],  paint: (w, h, s) => _leafyTree(w, h, s, { ramp: SC_PAL.swamp, canopyRy: 0.26, canopyY: 0.3, trunkTop: 0.4, moss: SC_PAL.moss }) },
  tree_mushroom:  { sizes: [[40, 52], [50, 66], [60, 80]],  paint: (w, h, s) => _mushroomTree(w, h, s) },
  tree_cactus:    { sizes: [[22, 44], [28, 58], [32, 70]],  paint: (w, h, s) => _cactus(w, h, s) },
  great_oak:      { sizes: [[110, 150]], paint: (w, h, s) => _leafyTree(w, h, s, { ramp: SC_PAL.leaf, clumps: 16 }) },
  great_pine:     { sizes: [[70, 170]],  paint: (w, h, s) => _pineTree(w, h, s, true) },
  great_mangrove: { sizes: [[130, 110]], paint: (w, h, s) => _leafyTree(w, h, s, { ramp: SC_PAL.swamp, canopyRy: 0.28, canopyY: 0.32, trunkTop: 0.42, clumps: 16, moss: SC_PAL.moss }) },
  rock:           { sizes: [[18, 12], [26, 17], [34, 23]], paint: (w, h, s) => _rock(w, h, s, SC_PAL.rock) },
  rock_desert:    { sizes: [[20, 11], [28, 15], [36, 20]], paint: (w, h, s) => _rock(w, h, s, SC_PAL.sand) },
  ice_rock:       { sizes: [[18, 13], [26, 18], [34, 24]], paint: (w, h, s) => _rock(w, h, s, SC_PAL.ice) },
  bush:           { sizes: [[16, 12], [22, 15], [26, 18]], paint: (w, h, s) => _bush(w, h, s, s % 3 === 0) },
  mushroom:       { sizes: [[14, 12], [18, 15]],           paint: (w, h, s) => _mushrooms(w, h, s) },
  wall:           { sizes: [[21, 30]],                      paint: (w, h, s) => _wall(s) },
};

// One texture per key; each size variant is a frame (0..n), bottom-aligned in one strip.
function buildScenery(scene) {
  for (const [key, spec] of Object.entries(SCENERY_SPECS)) {
    const cans = spec.sizes.map(([w, h], i) => spec.paint(w, h, 1000 + i * 97 + key.length * 13));
    const W = cans.reduce((s, c) => s + c.width, 0), H = Math.max(...cans.map(c => c.height));
    const strip = document.createElement('canvas'); strip.width = W; strip.height = H;
    let x = 0;
    for (const c of cans) { strip.getContext('2d').drawImage(c, x, H - c.height); x += c.width; }
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.addCanvas(key, strip);
    x = 0;
    cans.forEach((c, i) => { tex.add(i, 0, x, H - c.height, c.width, c.height); x += c.width; });
  }
}
