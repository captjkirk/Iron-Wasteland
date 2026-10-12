// Stage of each ticket, from idea to live in the game (#428). Pure: takes the items from GitHub's
// /issues endpoint (issues and PRs together) and the Pages deploy runs, returns one row per ticket.
// Shared by the tracker page and scripts/check-tracker.js, so the check tests what the page runs.
(function (root) {
  const STAGES = ['idea', 'deciding', 'ready', 'building', 'review', 'shipping', 'live'];
  const DECIDE = ['question', 'wayfinder:grilling', 'wayfinder:research', 'wayfinder:prototype'];

  const labelsOf = it => (it.labels || []).map(l => (typeof l === 'string' ? l : l.name));

  // Issue numbers a PR delivers: "Closes #12" in its body, or "(#12)" / "(#12, #13)" in its title.
  function refsOf(pr) {
    const refs = new Set();
    for (const m of (pr.body || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)) refs.add(+m[1]);
    for (const m of (pr.title || '').matchAll(/\(([^)]*#\d+[^)]*)\)/g))
      for (const n of m[1].matchAll(/#(\d+)/g)) refs.add(+n[1]);
    return refs;
  }

  // The map a ticket belongs to: "Part of #421" (or "Map: #421", "Parent: #421") in its body.
  function mapOf(it) {
    const m = (it.body || '').match(/\b(?:part of|map:?|parent:?)\s+#(\d+)/i);
    return m ? +m[1] : null;
  }

  // When a merge reached the live game: the end of the first successful deploy started at or
  // after it. null while no such deploy has finished.
  function deployedAt(mergedAt, runs) {
    const t = Date.parse(mergedAt);
    let best = null;
    for (const r of runs) {
      if (r.conclusion !== 'success' || Date.parse(r.created_at) < t) continue;
      if (!best || Date.parse(r.created_at) < Date.parse(best.created_at)) best = r;
    }
    return best ? best.updated_at : null;
  }

  // One row per issue (maps and PRs excluded): {number, title, url, stage, map, labels, since, created, prs}.
  // `prs` lists every linked PR as {number, title, url, draft, state: 'open'|'closed'|'merged'}.
  // `since` is when the ticket entered its stage as far as GitHub tells us without the events
  // API: filed for open ones, PR opened for review, merged for shipping, deployed for live.
  // Closed as not planned (duplicates, superseded) comes back as stage 'dropped'.
  function classify(items, runs) {
    const prsFor = new Map();
    for (const it of items) {
      if (!it.pull_request) continue;
      for (const n of refsOf(it)) (prsFor.get(n) || prsFor.set(n, []).get(n)).push(it);
    }
    const rows = [];
    for (const it of items) {
      const labels = labelsOf(it);
      if (it.pull_request || labels.includes('wayfinder:map')) continue;
      const prs = prsFor.get(it.number) || [];
      const merged = prs.filter(p => p.pull_request.merged_at)
        .sort((a, b) => Date.parse(b.pull_request.merged_at) - Date.parse(a.pull_request.merged_at))[0];
      const open = prs.filter(p => p.state === 'open');
      let stage, since = it.created_at;
      if (it.state === 'closed') {
        if (merged) {
          const live = deployedAt(merged.pull_request.merged_at, runs);
          stage = live ? 'live' : 'shipping';
          since = live || merged.pull_request.merged_at;
        } else if (it.state_reason === 'not_planned') {
          stage = 'dropped'; since = it.closed_at;
        } else {
          stage = 'live'; since = it.closed_at; // closed as done with no linked PR: a decision, or fixed by another PR
        }
      } else if (open.some(p => !p.draft)) {
        stage = 'review'; since = open.find(p => !p.draft).created_at;
      } else if (open.length || (it.assignees || []).length) {
        stage = 'building'; if (open.length) since = open[0].created_at;
      } else if (labels.some(l => DECIDE.includes(l))) {
        stage = 'deciding';
      } else if (labels.includes('ready-for-agent')) {
        stage = 'ready';
      } else {
        stage = 'idea';
      }
      const linked = prs.map(p => ({ number: p.number, title: p.title, url: p.html_url, draft: !!p.draft,
        state: p.pull_request.merged_at ? 'merged' : p.state }));
      rows.push({ number: it.number, title: it.title, url: it.html_url, stage, map: mapOf(it), labels, since, created: it.created_at, prs: linked });
    }
    return rows;
  }

  const api = { STAGES, classify, deployedAt, refsOf, mapOf };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Tracker = api;
})(this);
