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
- [First paint skeleton](./first-paint-skeleton.md) covers the loading placeholders for the agent rail, session list and conversation canvas, and their in-place retirement once data lands.
- [Left rail cockpit](./left-rail-cockpit.md) covers the React island left rail: micro rail, primary card, agent scoping, session row shape, group collage and width clamping.
- [Session management](./session-management.md) covers creating sessions, switching between them, draft preservation, deleting sessions, and focus restoration.
- [Group room collaboration](./group-room-collaboration.md) covers multi-agent group rooms, collage avatars, and collaborative discussion flows.
- [Interactive input dock](./interactive-input-dock.md) covers the 740px golden width container, model tree accordion picker, and thinking depth controls.
- [Interactive chat stage](./interactive-chat-stage.md) covers action bars (copy/fork/rollback), attachment trays, and slash command poppers.
- [Clean light theme](./clean-light-theme.md) covers Ayu Light / Warm Paper / Jade White publication typography, tone tokens, and sunken surfaces.

## Feature File vs. Registered Runner ID Mapping (Naming Debt)

> **Warning (命名债说明)**:  
> `features/*.md` 的文件名与 `scripts/verify/control-flux.mjs` 中的真实注册 `featureId` 存在历史命名分叉。  
> 运行 CDP 自动化物理验证驱动脚本时，**必须以 `control-flux.mjs` 的注册 ID 为准**，禁止直接使用带前缀或后缀的 md 文件名猜测命令参数。

| 特征说明文档 (`features/*.md`) | control-flux 注册 ID (`run <id>`) | 支持的别名 (Aliases) | 命名分叉说明 (Naming Debt Note) |
|---|---|---|---|
| `bot-primary-chat.md` | `bot-primary-chat` | — | 名称一致 |
| `first-paint-skeleton.md` | `first-paint-skeleton` | — | 名称一致（驱动真实 renderer 而非 E2E harness） |
| `session-management.md` | `session-management` | — | 名称一致 |
| `group-room-collaboration.md` | `group-room` | — | **分叉**：文件名带 `-collaboration` 后缀，而 runner 注册 ID 仅为 `group-room` |
| `interactive-input-dock.md` | `input-dock-controls` | — | **分叉**：文件名使用 `interactive-input-dock`，而 runner 注册 ID 为 `input-dock-controls` |
| `interactive-chat-stage.md` | `interactive-chat-stage` | — | 名称一致 |
| `clean-light-theme.md` | `clean-light-theme` | `warm-paper-theme`, `ayu-light-theme` | runner 内部针对同一用例支持浅色皮肤别名多路映射 |

