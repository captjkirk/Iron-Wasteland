// Checks tools/tracker/stages.js, which puts each ticket in a stage on the live tracker page (#428).
// Part of `npm run check`. Sample issues and PRs cover every stage, a ticket dropped as a
// duplicate, and a merge before and after the last finished Pages deploy.
const assert = require('assert');
const { classify, refsOf } = require('../tools/tracker/stages.js');

process.on('uncaughtException', e => { console.error('check-tracker: ' + e.message.split('\n')[0]); process.exit(1); });

const issue = (number, extra) => ({ number, title: 't' + number, state: 'open', labels: [], assignees: [], created_at: '2026-10-01T00:00:00Z', ...extra });
const pr = (number, extra) => ({ ...issue(number, extra), pull_request: { merged_at: null, ...(extra.pull_request || {}) } });
const runs = [
  { conclusion: 'success', created_at: '2026-10-05T00:00:10Z', updated_at: '2026-10-05T00:01:00Z' },
  { conclusion: 'failure', created_at: '2026-10-06T00:00:10Z', updated_at: '2026-10-06T00:01:00Z' },
];

const items = [
  issue(1, { labels: [{ name: 'needs-triage' }] }),
  issue(2, { labels: [{ name: 'wayfinder:grilling' }] }),
  issue(3, { labels: [{ name: 'ready-for-agent' }], body: 'Part of #9.' }),
  issue(4, { labels: [{ name: 'ready-for-agent' }], assignees: [{ login: 'a' }] }),
  issue(5, { labels: [{ name: 'ready-for-agent' }] }),
  issue(6, { state: 'closed', state_reason: 'completed', closed_at: '2026-10-05T00:00:00Z' }),
  issue(7, { state: 'closed', state_reason: 'completed', closed_at: '2026-10-06T00:00:00Z' }),
  issue(8, { state: 'closed', state_reason: 'not_planned', closed_at: '2026-10-06T00:00:00Z' }),
  issue(9, { labels: [{ name: 'wayfinder:map' }] }),
  pr(20, { body: 'Closes #5', created_at: '2026-10-04T00:00:00Z' }),
  pr(21, { body: 'Fixes #6', state: 'closed', pull_request: { merged_at: '2026-10-05T00:00:00Z' } }),
  pr(22, { title: 'Thing (#7)', state: 'closed', pull_request: { merged_at: '2026-10-06T00:00:00Z' } }),
];

const got = Object.fromEntries(classify(items, runs).map(r => [r.number, r]));
const want = { 1: 'idea', 2: 'deciding', 3: 'ready', 4: 'building', 5: 'review', 6: 'live', 7: 'shipping', 8: 'dropped' };
for (const [n, stage] of Object.entries(want)) assert.strictEqual(got[n] && got[n].stage, stage, `#${n} should be ${stage}, got ${got[n] && got[n].stage}`);
assert.ok(!got[9] && !got[20], 'maps and PRs are not tickets');
assert.strictEqual(got[3].map, 9, '#3 belongs to map #9');
assert.strictEqual(got[6].since, '2026-10-05T00:01:00Z', '#6 went live when the deploy finished');
assert.strictEqual(got[5].since, '2026-10-04T00:00:00Z', '#5 entered review when its PR opened');
assert.deepStrictEqual([...refsOf({ title: 'Feedback (#275, #347) (#384)', body: '' })].sort(), [275, 347, 384]);
