# Glossary

**Smoke run** — `npm run smoke`: loads the game in headless WebKit and fails unless the
`ModeSelect` scene comes up with a clean console. It never reaches world build.
Avoid: browser test, e2e test, boot test.

**Tracks** — the boot prints a walker leaves behind on the ground, which fade after 30–60 s
(#308). One print is a **boot print**. A structure's **footprint** is something else: the tiles it covers.
Avoid: footprints, footsteps, trail (for the prints themselves).

**Raider** — a human enemy (`isRaider`): a camp raider (brawler, shooter, heavy) or a member of a
hunt party. Wildlife (wolves, bears, spiders and the rest) is not.
Avoid: bandit, human enemy, NPC.

**Carousel** — the character screen (`src/char-select.js`): the selected character large in the
centre with its stats and ability, the others smaller and dimmed on an arc. Keys, a swipe or a tap turn it.
Avoid: card row, character picker.

**Two cameras** — the world camera (`cameras.main`) draws the map and everything in it; the HUD camera
(`hudCam`) draws the screen furniture at a fixed zoom. Each object is drawn by one of them.
Avoid: overlay camera, UI camera.

**Split screen (face-to-face)** — an iPad (short side 600 points or more) in a 2-player touch game: the
screen is cut into a bottom half for P1 and a top half for P2 turned 180 degrees, with a thin centre strip
for shared items. Each half has its own world camera, stick zone and attack button.
Avoid: split view, side by side. Phones keep the left/right layout, called the phone layout.
