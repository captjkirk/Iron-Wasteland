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
