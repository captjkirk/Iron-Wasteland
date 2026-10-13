// What the tracker page asks of GitHub once Jared has saved his access key (#432). Pure: builds the
// write requests and reads the answers, so scripts/check-tracker.js tests what the page sends.
// Paths are relative to the repo (https://api.github.com/repos/captjkirk/Iron-Wasteland).
(function (root) {
  // A reply on ticket n. null for an empty reply, so the page never posts a blank comment.
  function commentRequest(n, text) {
    const body = String(text || '').trim();
    if (!Number.isInteger(n) || n < 1 || !body) return null;
    return { method: 'POST', path: `/issues/${n}/comments`, body: { body } };
  }

  // Checking a key without changing anything: read the repo, then ask to create an issue and a PR
  // with nothing in them. GitHub refuses a key without write access (403 or 404); a key with it
  // gets as far as "you left out the title" (422), and nothing is created.
  const KEY_PROBES = [
    { method: 'GET', path: '', need: 'see' },
    { method: 'POST', path: '/issues', body: {}, need: 'issues' },
    { method: 'POST', path: '/pulls', body: {}, need: 'pulls' },
  ];

  // Before any request: only a fine-grained key can be limited to this one repo.
  function keyShapeProblem(key) {
    if (!key) return 'Paste your key first.';
    if (/^(ghp|gho|ghu|ghs)_/.test(key)) return 'That is a classic key, which reaches every repo you own. Make a fine-grained key instead (it starts with github_pat_).';
    if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(key)) return 'That does not look like a GitHub fine-grained key. It starts with github_pat_ and is about 90 characters long. Copy it again from GitHub.';
    return null;
  }

  // What is wrong with a key, from the status GitHub gave each probe in KEY_PROBES. null when it works.
  function keyProblem(statuses) {
    const [see, issues, pulls] = statuses;
    if (see === 401) return 'GitHub does not recognise this key. It may be mistyped, expired or deleted.';
    if (see !== 200) return 'This key cannot see captjkirk/Iron-Wasteland. Under Repository access, pick "Only select repositories" and choose it.';
    const cannot = [issues !== 422 && 'Issues', pulls !== 422 && 'Pull requests'].filter(Boolean);
    if (cannot.length) return 'This key cannot write ' + cannot.join(' or ') + '. Under Repository permissions, set ' + cannot.join(' and ') + ' to "Read and write".';
    return null;
  }

  // What each button does to a ticket's labels and state (#433). `answered` is set when Jared replies
  // because his tracker replies and Claude's comments post as the same GitHub user, so "who spoke
  // last" cannot tell an answer from a question; stages.js reads the label instead.
  const ACTIONS = {
    ready: { add: ['ready-for-agent'], remove: ['needs-triage'] },
    decide: { add: ['question'], remove: ['answered'] }, // asking again needs Jared again
    drop: { close: 'not_planned' },
    hold: { remove: ['ready-for-agent'] },
    reply: { add: ['answered'], remove: ['question'] },
    replyReady: { add: ['answered', 'ready-for-agent'], remove: ['question', 'needs-triage'] },
    answerClose: { add: ['answered'], remove: ['question'], close: 'completed' },
  };

  // The one request a button sends: the ticket's whole label list after the change, plus closing it
  // when the button closes. `labels` are the ticket's labels now (names or GitHub's label objects).
  // ponytail: the whole list overwrites a label added elsewhere since the board last loaded (5 min at most).
  function actionRequest(n, labels, action) {
    const a = ACTIONS[action];
    if (!Number.isInteger(n) || n < 1 || !a) return null;
    const body = {};
    if (a.add || a.remove) {
      const names = (labels || []).map(l => (typeof l === 'string' ? l : l.name)).filter(l => !(a.remove || []).includes(l));
      body.labels = [...names, ...(a.add || []).filter(l => !names.includes(l))];
    }
    if (a.close) Object.assign(body, { state: 'closed', state_reason: a.close });
    return { method: 'PATCH', path: `/issues/${n}`, body };
  }

  // The panel's buttons for a row from stages.js, as [label, action]. Stage buttons move the ticket;
  // reply buttons post the reply first. A decision ticket is never built itself, so it closes instead.
  const DECISION = ['question', 'wayfinder:grilling'];
  function stageButtons(row) {
    if (row.stage === 'idea') return [['Mark ready', 'ready'], ['Needs a decision', 'decide'], ['Drop', 'drop']];
    if (row.stage === 'ready') return [['Hold', 'hold']];
    return [];
  }
  function replyButtons(row) {
    if (!row.needsYou) return [['Post reply', null]];
    if (row.stage !== 'idea' && row.stage !== 'deciding') return [['Reply', 'reply']]; // already shaped or being built
    return [['Reply', 'reply'], row.labels.some(l => DECISION.includes(l)) ? ['Answer and close', 'answerClose'] : ['Reply and mark ready', 'replyReady']];
  }

  const api = { commentRequest, KEY_PROBES, keyShapeProblem, keyProblem, actionRequest, stageButtons, replyButtons };
  if (typeof module !== 'undefined') module.exports = api;
  else root.TrackerGitHub = api;
})(this);
