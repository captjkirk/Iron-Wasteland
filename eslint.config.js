// Lint config for `npm run check` (flat config, ESLint 10).
// The game is plain <script> files sharing one global scope, loaded in order by
// index.html. So each file is told about every top-level name the OTHER files
// declare; that keeps no-undef able to catch real typos across files.
const fs = require('fs');

const FILES = ['game.js', ...fs.readdirSync('src').filter(f => f.endsWith('.js')).map(f => 'src/' + f)];
const TOP_LEVEL = /^(?:async +)?(?:const|let|var|function\*?|class) +([A-Za-z_$][\w$]*)/gm;
const declared = Object.fromEntries(FILES.map(f =>
  [f, [...fs.readFileSync(f, 'utf8').matchAll(TOP_LEVEL)].map(m => m[1])]));

// ponytail: hand list instead of the `globals` package (nothing is npm-installed here).
// A new browser API in the code fails no-undef until it is added here.
const BROWSER = [
  'window', 'document', 'navigator', 'console', 'location', 'localStorage', 'performance',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'Blob', 'URL', 'URLSearchParams', 'Image', 'fetch', 'alert', 'ResizeObserver',
  'AudioContext', 'webkitAudioContext', 'OfflineAudioContext',
  'Phaser',
];

module.exports = FILES.map(f => {
  const globals = {};
  for (const name of BROWSER) globals[name] = 'readonly';
  for (const [other, names] of Object.entries(declared)) {
    if (other !== f) for (const name of names) globals[name] = 'writable';
  }
  return {
    files: [f],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
    },
  };
});
