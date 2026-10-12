// Before-and-after screenshots on a PR and on its linked tickets (.github/workflows/shots.yml).
//   node scripts/evidence.js wants <pr>
//     prints yes when the PR or a ticket it closes carries the `visual` or `ux` label, else no.
//   node scripts/evidence.js <pr> <sha> <before-dir> <after-dir> [set]
//     pairs the PNGs in the two folders by file name, drops pairs whose bytes are identical, pushes
//     the rest to the `evidence` branch (pr-<pr>/<sha>/before|after/<name>.png) and posts or updates
//     one comment per set (default `fixed`, the screens scripts/shots.js takes) on the PR and on each
//     ticket it closes. The ticket copy is what the tracker panel shows. Needs `gh` signed in.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LABELS = ['visual', 'ux'];
const MAX_SCREENS = 40; // keeps a comment well under GitHub's 65,536 characters

// before and after map a screen name to its PNG bytes. Returns the screens that changed, appeared or
// went away, by name: [{ name, before: bool, after: bool }].
function pairShots(before, after) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names.filter(n => !(before[n] && after[n] && before[n].equals(after[n])))
    .map(n => ({ name: n, before: !!before[n], after: !!after[n] }));
}

const marker = (pr, set) => `<!-- evidence:pr-${pr}:${set} -->`;

// The comment: a before | after table per changed screen. url(side, name) is an image's address.
function commentBody({ pr, sha, set, pairs, total, url, folder }) {
  const head = `${marker(pr, set)}\n**Before and after** (${set === 'fixed' ? 'the fixed set of screens' : set}) for #${pr} at ${sha.slice(0, 7)}: `;
  if (!pairs.length) return head + `no screen changed (${total} compared).\n`;
  const cell = (on, side, name) => on ? `![${side}](${url(side, name)})` : `_${side === 'before' ? 'new screen' : 'gone'}_`;
  const shown = pairs.slice(0, MAX_SCREENS).map(p => `**${p.name.replace(/\.png$/, '').replace(/-/g, ' ')}**\n\n` +
    `| Before | After |\n|---|---|\n| ${cell(p.before, 'before', p.name)} | ${cell(p.after, 'after', p.name)} |\n`);
  const more = pairs.length > MAX_SCREENS ? `\n…and ${pairs.length - MAX_SCREENS} more in [the evidence folder](${folder}).\n` : '';
  return head + `${pairs.length} of ${total} changed.\n\n` + shown.join('\n') + more;
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: INDEX } }).trim();
const INDEX = path.join(os.tmpdir(), `evidence-index-${process.pid}`);

// The PR's labels and the tickets it closes, with theirs.
function linked(pr) {
  const q = 'query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){' +
    'labels(first:30){nodes{name}} closingIssuesReferences(first:10){nodes{number labels(first:30){nodes{name}}}}}}}';
  const p = JSON.parse(gh('api', 'graphql', '-f', `query=${q}`, '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `pr=${pr}`)).data.repository.pullRequest;
  const names = n => n.labels.nodes.map(l => l.name);
  return { labels: names(p), tickets: p.closingIssuesReferences.nodes.map(t => ({ number: t.number, labels: names(t) })) };
}

// Adds the files ({ 'pr-1/abc/before/x.png': localPath }) to the evidence branch in one commit, without
// touching the working tree or the shared index. Retries when another job pushed in between.
function pushImages(files) {
  for (let attempt = 1; ; attempt++) {
    let parent = null;
    try { git('fetch', '--depth=1', 'origin', 'evidence'); parent = git('rev-parse', 'FETCH_HEAD'); } catch (_) { /* first use: no branch yet */ }
    if (parent) git('read-tree', parent); else git('read-tree', '--empty');
    for (const [dest, src] of Object.entries(files)) git('update-index', '--add', '--cacheinfo', `100644,${git('hash-object', '-w', src)},${dest}`);
    const commit = git('commit-tree', git('write-tree'), ...(parent ? ['-p', parent] : []), '-m', `Screenshots: ${Object.keys(files)[0].split('/').slice(0, 2).join('/')}`);
    try { git('push', 'origin', `${commit}:refs/heads/evidence`); fs.rmSync(INDEX, { force: true }); return; } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

// Posts body on an issue or PR, or replaces the comment there that carries the same marker.
function upsert(number, body) {
  const mark = body.slice(0, body.indexOf('\n'));
  const id = gh('api', '--paginate', `repos/{owner}/{repo}/issues/${number}/comments`, '--jq', `.[] | select(.body | startswith(${JSON.stringify(mark)})) | .id`).split('\n')[0];
  if (id) gh('api', '-X', 'PATCH', `repos/{owner}/{repo}/issues/comments/${id}`, '-f', `body=${body}`, '--silent');
  else gh('api', `repos/{owner}/{repo}/issues/${number}/comments`, '-f', `body=${body}`, '--silent');
  console.log(`evidence: ${id ? 'updated' : 'posted'} the comment on #${number}`);
}

function main(argv) {
  if (argv[0] === 'wants') {
    const l = linked(Number(argv[1]));
    console.log([...l.labels, ...l.tickets.flatMap(t => t.labels)].some(n => LABELS.includes(n)) ? 'yes' : 'no');
    return;
  }
  const [pr, sha, beforeDir, afterDir, set = 'fixed'] = argv;
  if (!(Number(pr) > 0 && /^[0-9a-f]{7,40}$/.test(sha || '') && beforeDir && afterDir)) {
    console.error('usage: node scripts/evidence.js wants <pr>\n       node scripts/evidence.js <pr> <sha> <before-dir> <after-dir> [set]');
    process.exit(2);
  }
  const read = dir => Object.fromEntries((fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => f.endsWith('.png'))
    .map(f => [f, fs.readFileSync(path.join(dir, f))]));
  const before = read(beforeDir), after = read(afterDir);
  const pairs = pairShots(before, after);
  const total = new Set([...Object.keys(before), ...Object.keys(after)]).size;
  const repo = process.env.GITHUB_REPOSITORY || gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner');
  const dir = `pr-${pr}/${sha.slice(0, 12)}`;
  const files = {};
  for (const p of pairs) for (const side of ['before', 'after']) if (p[side]) files[`${dir}/${side}/${p.name}`] = path.join(side === 'before' ? beforeDir : afterDir, p.name);
  if (pairs.length) pushImages(files);
  const body = commentBody({ pr, sha, set, pairs, total,
    url: (side, name) => `https://raw.githubusercontent.com/${repo}/evidence/${dir}/${side}/${encodeURIComponent(name)}`,
    folder: `https://github.com/${repo}/tree/evidence/${dir}` });
  for (const n of [pr, ...linked(Number(pr)).tickets.map(t => t.number)]) upsert(n, body);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { pairShots, commentBody, marker };
