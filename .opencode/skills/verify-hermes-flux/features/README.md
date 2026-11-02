# Hermes Flux verification map

This directory is the maintained source for verifying the user-facing behavior of Hermes Flux. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Ensure build artifacts are fresh: run `npm run build` so `packages/desktop/dist/` and sub-packages are compiled.
- Run `node scripts/verify/control-flux.mjs doctor` and require all checks to pass (Edge/Chrome found and artifacts complete).
- Never drive an instance on a fixed port: `control-flux.mjs` dynamically allocates free ports and isolated `user-data-dir` scratchpads under `os.tmpdir()`.
- Never delete `artifacts/verification/` during test teardown: proof artifacts must survive the cleanup.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions state otherwise.
- Prefer stable data attributes and IDs (`.rail-primary-agent-card`, `data-profile`, `#dock-prompt-input`, `#dock-send-btn`) over brittle CSS hierarchy.
- Run verification actions through `node scripts/verify/control-flux.mjs run <feature-id>`.
- UI proof must include a full Blink-rendered screenshot (`screenshot.png`) and state snapshot (`evidence.json`).

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order:

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-flux` starts with `Preconditions:` and pairs each user action with an exact step and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Bot primary chat](./bot-primary-chat.md) covers dedicated agent forever chat, atomic activity reflection, titlebar sync, and session pool physical isolation.
- [Session management](./session-management.md) covers creating sessions, switching between them, draft preservation, deleting sessions, and focus restoration.
- [Group room collaboration](./group-room-collaboration.md) covers multi-agent group rooms, collage avatars, and collaborative discussion flows.
- [Interactive input dock](./interactive-input-dock.md) covers the 740px golden width container, model tree accordion picker, and thinking depth controls.
