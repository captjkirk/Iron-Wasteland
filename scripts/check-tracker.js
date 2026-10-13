// Checks tools/tracker/stages.js, which puts each ticket in a stage on the live tracker page (#428).
// Part of `npm run check`. Sample issues and PRs cover every stage, a ticket dropped as a
// duplicate, and a merge before and after the last finished Pages deploy.
const assert = require('assert');
const { classify, refsOf, matches, openBlockers } = require('../tools/tracker/stages.js');

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
assert.deepStrictEqual(got[5].prs.map(p => [p.number, p.state]), [[20, 'open']], '#5 lists its open PR #20');
assert.deepStrictEqual(got[6].prs.map(p => [p.number, p.state]), [[21, 'merged']], '#6 lists its merged PR #21');
assert.deepStrictEqual(got[1].prs, [], '#1 has no PRs');
assert.deepStrictEqual([...refsOf({ title: 'Feedback (#275, #347) (#384)', body: '' })].sort(), [275, 347, 384]);

// Tickets that wait on Jared stand out on the board (#440).
const held = Object.fromEntries(classify([
  issue(30, { labels: [{ name: 'question' }] }),
  issue(31, { labels: [{ name: 'ready-for-human' }] }),
  issue(32, { labels: [{ name: 'ready-for-agent' }] }),
  issue(33, { labels: [{ name: 'question' }], state: 'closed', state_reason: 'completed', closed_at: '2026-10-05T00:00:00Z' }),
  pr(40, { body: 'Closes #32', labels: [{ name: 'needs-owner-look' }] }),
], runs).map(r => [r.number, r.needsYou]));
assert.deepStrictEqual(held, { 30: true, 31: true, 32: true, 33: false }, 'needs you: decision and ready-for-human labels, a held PR, never a closed ticket');
assert.strictEqual(got[1].needsYou, false, 'needs-triage alone does not wait on Jared');

// Writes with Jared's access key (#432): tools/tracker/github.js builds them.
const gh = require('../tools/tracker/github.js');
assert.deepStrictEqual(gh.commentRequest(432, '  Looks good.\n'), { method: 'POST', path: '/issues/432/comments', body: { body: 'Looks good.' } });
assert.strictEqual(gh.commentRequest(432, '   '), null, 'a blank reply is never posted');
assert.strictEqual(gh.commentRequest(NaN, 'hi'), null, 'a reply needs a ticket number');
assert.ok(gh.KEY_PROBES.every(p => p.method === 'GET' || (p.method === 'POST' && Object.keys(p.body).length === 0)), 'checking a key writes nothing');
assert.ok(gh.keyShapeProblem('abc') && gh.keyShapeProblem('ghp_' + 'a'.repeat(36)), 'only a fine-grained key is taken');
assert.strictEqual(gh.keyShapeProblem('github_pat_' + 'A1_'.repeat(28)), null);
assert.strictEqual(gh.keyProblem([200, 422, 422]), null, 'a key that sees the repo and writes both works');
assert.match(gh.keyProblem([401, 0, 0]), /does not recognise/);
assert.match(gh.keyProblem([404, 0, 0]), /cannot see/);
assert.match(gh.keyProblem([200, 403, 422]), /cannot write Issues\./);
assert.match(gh.keyProblem([200, 422, 404]), /cannot write Pull requests\./);

// Search (#446): a linked PR's number finds its ticket, with or without #; titles still match.
assert.ok(matches(got[5], '20') && matches(got[5], '#20'), 'searching PR #20 finds ticket #5');
assert.ok(matches(got[5], '#5') && matches(got[5], 'T5') && matches(got[5], ''), 'ticket number, title words and an empty box match');
assert.ok(!matches(got[1], '20'), 'a ticket without PR #20 does not match it');
// Waiting tickets (#446): the count comes from the issue, the numbers from the blocked_by answer (open ones only).
const waiting = classify([issue(30, { issue_dependencies_summary: { blocked_by: 1 } }), issue(31, { state: 'closed', issue_dependencies_summary: { blocked_by: 1 } })], [])
  .map(r => [r.number, r.blockedBy]);
assert.deepStrictEqual(waiting, [[30, 1], [31, 0]], 'an open ticket counts its blockers; a closed one waits on nothing');
assert.deepStrictEqual(openBlockers([{ number: 389, state: 'open' }, { number: 387, state: 'closed' }]), [389], 'only open blockers are named');

// Buttons (#433): the exact request each one sends, and the stage the card lands in after it.
const after = (it, action) => {
  const req = gh.actionRequest(it.number, it.labels, action);
  const next = { ...it, ...req.body, labels: req.body.labels || it.labels };
  return { req, row: classify([next], [])[0] };
};
const idea = issue(50, { labels: [{ name: 'needs-triage' }, { name: 'enhancement' }] });
assert.deepStrictEqual(after(idea, 'ready').req, { method: 'PATCH', path: '/issues/50', body: { labels: ['enhancement', 'ready-for-agent'] } });
assert.strictEqual(after(idea, 'ready').row.stage, 'ready', 'Mark ready moves an idea to Ready');
assert.deepStrictEqual(after(idea, 'decide').req.body, { labels: ['needs-triage', 'enhancement', 'question'] });
assert.ok(after(idea, 'decide').row.stage === 'deciding' && after(idea, 'decide').row.needsYou, 'Needs a decision moves it to Deciding and asks Jared');
assert.deepStrictEqual(after(idea, 'drop').req.body, { state: 'closed', state_reason: 'not_planned' });
assert.strictEqual(after(idea, 'drop').row.stage, 'dropped');
const ready = issue(51, { labels: [{ name: 'ready-for-agent' }] });
assert.deepStrictEqual(after(ready, 'hold').req.body, { labels: [] });
assert.strictEqual(after(ready, 'hold').row.stage, 'idea', 'Hold moves Ready back to Idea');
assert.deepStrictEqual(gh.stageButtons({ stage: 'idea' }).map(b => b[1]), ['ready', 'decide', 'drop']);
assert.deepStrictEqual(gh.stageButtons({ stage: 'ready' }).map(b => b[1]), ['hold']);
assert.deepStrictEqual(gh.stageButtons({ stage: 'review' }), []);

// Replying clears Needs you (#433): `answered` turns it off, also on a grilling ticket.
const asked = issue(52, { labels: [{ name: 'question' }, { name: 'needs-triage' }] });
assert.deepStrictEqual(after(asked, 'reply').req.body, { labels: ['needs-triage', 'answered'] });
assert.strictEqual(after(asked, 'reply').row.needsYou, false, 'Reply clears Needs you');
assert.deepStrictEqual(after(asked, 'replyReady').req.body, { labels: ['answered', 'ready-for-agent'] });
assert.ok(after(asked, 'replyReady').row.stage === 'ready' && !after(asked, 'replyReady').row.needsYou, 'Reply and mark ready moves it to Ready');
assert.deepStrictEqual(after(asked, 'answerClose').req.body, { labels: ['needs-triage', 'answered'], state: 'closed', state_reason: 'completed' });
const grill = issue(53, { labels: [{ name: 'wayfinder:grilling' }] });
assert.ok(after(grill, 'reply').row.stage === 'deciding' && !after(grill, 'reply').row.needsYou, 'an answered grilling ticket stays Deciding without Needs you');
assert.strictEqual(after(grill, 'answerClose').row.stage, 'live', 'Answer and close ends a decision ticket');
assert.strictEqual(after({ ...asked, labels: ['needs-triage', 'answered'] }, 'decide').row.needsYou, true, 'asking again needs Jared again');
const heldAnswered = Object.fromEntries(classify([issue(54, { labels: [{ name: 'answered' }, { name: 'ready-for-human' }] }),
  pr(55, { body: 'Closes #54', labels: [{ name: 'needs-owner-look' }] })], []).map(r => [r.number, r.needsYou]));
assert.deepStrictEqual(heldAnswered, { 54: true }, 'a PR held for Jared still needs him after an answer');
const row = labels => ({ needsYou: true, stage: 'deciding', labels });
assert.deepStrictEqual(gh.replyButtons(row(['question'])), [['Reply', 'reply'], ['Answer and close', 'answerClose']]);
assert.deepStrictEqual(gh.replyButtons(row(['wayfinder:grilling'])).map(b => b[0]), ['Reply', 'Answer and close']);
assert.deepStrictEqual(gh.replyButtons({ needsYou: true, stage: 'idea', labels: ['ready-for-human'] }).map(b => b[0]), ['Reply', 'Reply and mark ready']);
assert.deepStrictEqual(gh.replyButtons({ needsYou: false, stage: 'idea', labels: [] }), [['Post reply', null]], 'a ticket not waiting on Jared gets a plain reply');
assert.strictEqual(gh.actionRequest(52, [], 'nope'), null);
