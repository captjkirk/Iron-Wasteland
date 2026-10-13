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

  const api = { commentRequest, KEY_PROBES, keyShapeProblem, keyProblem };
  if (typeof module !== 'undefined') module.exports = api;
  else root.TrackerGitHub = api;
})(this);
