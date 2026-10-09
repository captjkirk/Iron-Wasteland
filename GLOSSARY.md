# Glossary

**Smoke run** — `npm run smoke`: loads the game in headless WebKit and fails unless the
`ModeSelect` scene comes up with a clean console. It never reaches world build.
Avoid: browser test, e2e test, boot test.

**Tracks** — the boot prints a walker (a player or a raider) leaves behind on the ground, which
fade after 15–60 s by the ground they are on (#308). One print is a **boot print**. A
structure's **footprint** is something else: the tiles it covers.
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

**Split screen (face-to-face)** — an iPad (short side 600 points or more) lying flat in a 2-player touch game,
one player at each short end. The screen is cut top to bottom: P1 gets the left half, P2 the right half, each
turned a quarter turn so it reads upright from its player's end, with a thin centre strip for shared items.
Each half has its own world camera, stick zone and attack button.
Avoid: split view, side by side. Phones keep the left/right layout with nothing turned, called the phone layout.

**Wave marcher** — wildlife a wave spawns (`_waveMarch`, #330): it appears off-screen 900–1,300 px
from a player and walks in, awake, until it first reaches someone; then it is ordinary wildlife.
Avoid: wave spawn, edge spawn, attacker.

**Phone layout** — the layout for a touch screen whose short side is under 600 points (`PHONE_LAYOUT`): a canvas 360 high
and 640 to 864 wide, with its own coordinates in the title screen, settings, rebind and character screens. An iPad is not
the phone layout; it gets the 720-high canvas.
Avoid: mobile layout, compact layout, small screen.

**Tap target** — anything on a menu that takes a tap: a button, a box, a slider or a tap zone (an invisible `Zone` laid over a
drawn box). On the phone layout each is at least 32 px either way, and no two overlap (`scripts/phone-menus.js`).
Avoid: hit area, hit box, click zone.
