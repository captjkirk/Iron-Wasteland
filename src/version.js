// ============================================================
// IRON WASTELAND — VERSION constant + local-time formatter
// Split module — loaded by index.html as a classic <script> in
// dependency order. All split files share ONE global scope (no ES
// modules), so top-level symbols are visible across every file.
// Navigation map (MANIFEST) lives at the top of src/config.js.
// ============================================================
'use strict';


// ── VERSION ───────────────────────────────────────────────────
// Update this each commit so the title screen reflects the build date.
// Stored as UTC ISO so it can be displayed in each player's local timezone.
const VERSION = '2026-06-05T19:08:15Z';
// Format VERSION into the viewer's local time with abbreviated tz name (EDT, PDT, BST, etc.)
function _fmtVersion(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch (_) { return iso; }
}
