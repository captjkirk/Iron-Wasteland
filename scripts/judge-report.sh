#!/usr/bin/env bash
# The judge's trail per ISO week: holds by category, unattended merges, merges with no verdict, and the owner's look labels.
# Reads GitHub through `gh api graphql`; writes nothing. Usage: scripts/judge-report.sh [weeks]   (default 8, newest last)
# Holds come from `Judge: hold (<category>)` comments (by comment date); unattended merges are merged PRs with a
# `Judge: merge` comment; no-verdict merges are merged PRs with no `Judge:` comment at all; look-ok / look-defect are the
# owner's labels on merged PRs (by merge date). Zero means nothing happened that week; the labels exist since 2026-10-22.
# A merge the judge made without a `Judge: merge` comment is indistinguishable from the owner's own merge (both are the same
# GitHub user) and counts as no-verdict: judge.md step 5 makes that comment the first act of a merge.
set -euo pipefail
weeks=${1:-8}
[[ "$weeks" =~ ^[1-9][0-9]*$ ]] || { echo "usage: scripts/judge-report.sh [weeks]" >&2; exit 2; }
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh api graphql --paginate -f owner="${repo%/*}" -f name="${repo#*/}" -f query='
  query($owner: String!, $name: String!, $endCursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequests(first: 50, after: $endCursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
        pageInfo { hasNextPage endCursor }
        nodes { number state mergedAt labels(first: 30) { nodes { name } } comments(first: 100) { nodes { body createdAt } } }
      }
    }
  }' --jq '.data.repository.pullRequests.nodes[] | @json' | node -e '
  const weeks = Number(process.argv[1]);
  const isoWeek = (d) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear(); const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return `${y}-W${String(w).padStart(2, "0")}`;
  };
  const cats = ["observability", "gate", "irreversible", "no-ticket", "scope"];
  const row = () => ({ holds: Object.fromEntries(cats.map((c) => [c, 0])), other: 0, unattended: 0, noVerdict: 0, lookOk: 0, lookDefect: 0 });
  const byWeek = new Map();
  const at = (k) => { if (!byWeek.has(k)) byWeek.set(k, row()); return byWeek.get(k); };
  const lines = require("fs").readFileSync(0, "utf8").split("\n").filter((l) => l.trim());
  for (const line of lines) {
    const pr = JSON.parse(line);
    const judge = pr.comments.nodes.filter((c) => /^Judge:/i.test(c.body.trim()));
    for (const c of judge) {
      const m = /^Judge:\s*hold\s*\(([a-z-]+)\)/i.exec(c.body.trim());
      if (!m) continue;
      const r = at(isoWeek(new Date(c.createdAt)));
      const cat = m[1].toLowerCase();
      if (cat in r.holds) r.holds[cat]++; else r.other++;
    }
    if (pr.state === "MERGED" && pr.mergedAt) {
      const r = at(isoWeek(new Date(pr.mergedAt)));
      if (judge.some((c) => /^Judge:\s*merge/i.test(c.body.trim()))) r.unattended++;
      if (judge.length === 0) r.noVerdict++;
      const names = pr.labels.nodes.map((l) => l.name);
      if (names.includes("look-ok")) r.lookOk++;
      if (names.includes("look-defect")) r.lookDefect++;
    }
  }
  const keys = []; const d = new Date();
  for (let i = 0; i < weeks; i++) { keys.unshift(isoWeek(d)); d.setUTCDate(d.getUTCDate() - 7); }
  console.log(`${lines.length} pull requests read. Holds by category: ${cats.join("/")}${[...byWeek.values()].some((r) => r.other) ? " (+other)" : ""}`);
  console.log("week      holds                 unattended-merges  no-verdict-merges  look-ok  look-defect");
  for (const k of keys) {
    const r = byWeek.get(k) ?? row();
    const holds = cats.map((c) => r.holds[c]).join("/") + (r.other ? `+${r.other}` : "");
    console.log(`${k}  ${holds.padEnd(20)}  ${String(r.unattended).padStart(17)}  ${String(r.noVerdict).padStart(17)}  ${String(r.lookOk).padStart(7)}  ${String(r.lookDefect).padStart(11)}`);
  }
' "$weeks"
