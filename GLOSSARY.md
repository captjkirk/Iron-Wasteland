# Glossary

**Smoke run** — `npm run smoke`: loads the game in headless WebKit and fails unless the
`ModeSelect` scene comes up with a clean console. It never reaches world build.
Avoid: browser test, e2e test, boot test.

**Carousel** — the character screen (`src/char-select.js`): the selected character large in the
centre with its stats and ability, the others smaller and dimmed on an arc. Keys, a swipe or a tap turn it.
Avoid: card row, character picker.
