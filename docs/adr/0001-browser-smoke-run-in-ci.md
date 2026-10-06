# Add a headless browser smoke run to CI, before the game-file split

Status: accepted (October 6, 2026). Not built yet.

`npm run check` catches syntax errors, manifest drift and undefined names, but it never runs the game. We decided to add a CI job that loads `index.html` in headless WebKit, waits for the `ModeSelect` scene, and fails on any console error or uncaught exception. WebKit is the engine on every iPad and iPhone the game is played on.

## Why

- **It costs no money.** The repo is public, so GitHub Actions minutes are free. Playwright is open source.
- **History alone did not justify it.** Of about 60 closed issues and 40 fix commits, none was a title screen that failed to load. The real bugs were gameplay, balance, iPad frame rate, iOS audio and a Day 4 crash, and a smoke run sees none of those.
- **The split of `src/game-scene.js` changes that.** Moving code between the plain `<script>` files creates a new failure: a file that uses a name at load time before the file that declares it has loaded. ESLint treats every file's top-level names as shared globals, so it passes this; the browser throws. The smoke run is the cheap guard, and it should be in place before any code moves.

## What it checks, and what it does not

- **Asserts on `ModeSelect` and the console, never on pixels.** WebGL in a headless or hidden browser is unreliable (the `Game` scene loses its context and screenshots go black), so the job stops before world build.
- **Does not cover:** real iPad GPU behaviour, touch, frame rate, audio, or anything past the title screen. The written browser steps in each PR still own those.

## Consequences

- Playwright (WebKit) becomes the repo's first dev dependency. Today the only tool fetched is ESLint through `npx`.
- Each PR's checks take an estimated 1 to 2 minutes longer while the browser downloads (not measured).
- Expect an occasional flaky failure that needs a re-run.

## Next build slice

One slice, before any code moves in the split: add the Playwright WebKit job to `.github/workflows/checks.yml`, with a small script that serves the repo, loads the game, waits for `ModeSelect`, and fails on console errors. Done when the job passes on `main`, and fails on a branch that deliberately references a not-yet-loaded name at load time.

## What would reopen this

- The job flakes often enough that people re-run it without reading the failure. Then drop it or make it advisory.
- The split is abandoned and nothing else moves code between script files. The guard then has little to catch.
- A real boot failure ships past it. Then it should go further than `ModeSelect`, for example into world build with the canvas renderer.
