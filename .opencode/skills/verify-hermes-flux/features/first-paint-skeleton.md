# First paint skeleton

While the gateway data is still in flight, the workspace shows neutral skeleton placeholders instead of fabricated defaults: no placeholder agent identity, no fake sessions, no "start a new conversation" verdict. As soon as the data lands, the skeletons are replaced in place by the real agent list, session list and conversation.

## Sub-features

- `skeleton-agent-list` renders three 42px agent placeholders on the micro rail while agent profiles have not arrived.
- `skeleton-agent-card` renders the drawer's primary agent row as a skeleton row, including a 36px avatar placeholder.
- `skeleton-session-list` renders four session skeleton rows instead of the "no conversation history" empty state.
- `skeleton-conversation` renders three turn-shaped placeholders in the conversation canvas instead of the welcome empty state.
- `skeleton-retires-in-place` swaps every skeleton for real content once the matching domain reaches `ready`, without layout jump.
- `cold-start-first-agent` selects the first agent profile once profiles arrive, and shows that agent's conversation.

## How to get to it (user POV)

- Cold start the desktop app with a configured gateway: the first paint happens before any profile or session list arrives.
- Open the app from a clean profile directory, where caches cannot pre-fill the rail.
- Any action that clears the message viewport before history arrives (entering an agent's forever chat for the first time).

## Driving it with control-flux

Preconditions:

- `node scripts/verify/control-flux.mjs doctor` passes.
- Build artifacts are present in `packages/desktop/dist/` (this recipe drives the real renderer, not the E2E harness).

- **Mount the real renderer.** Run `control-flux.mjs run first-paint-skeleton`. The runner loads `/packages/desktop/dist/renderer/index.html` and waits for `#flux-app-root` to have children.
- **Inject the loading snapshot.** Set the three domain phases to `loading` with empty profiles, sessions and messages, then call `window.__fluxRender()`. `[data-skeleton="agent"]` appears exactly 3 times, `[data-skeleton="session"]` exactly 4 times, `[data-skeleton="agent-card"]` at least once and `[data-conv-skeleton="true"]` exactly once.
- **Assert no fabricated defaults.** `[data-station-profile]` and `[data-primary-bot]` are absent, and `document.body.innerText` contains neither "暂无历史会话" nor "开始新的对话".
- **Retire the skeletons.** Inject two real profiles plus one session and flip all phases to `ready`, then call `window.__fluxRender()`. All skeleton counts drop to zero, `[data-station-profile]` becomes 2 and `.session-item` becomes 1.
- **Proof.** `skeleton.png` and `ready.png` are captured from the real Blink renderer; `evidence.json` records both DOM snapshots and `status: 'PASSED'`.

## Gotchas

- React islands commit asynchronously. Always poll (`waitFor`) for the skeleton count instead of reading the DOM immediately after `__fluxRender()`; a single read can observe the previous commit and look like a failure.
- The production conversation canvas is owned by the renderer template (`renderConversationCanvas`), not by `ConversationStage`. The loading branch must hand the canvas back to `#react-message-list-host`, otherwise the template's welcome empty state wins.
- Do not assert skeleton geometry by screenshot alone: the skeleton row reuses `RailEntityRow`, so any row-height regression shows up as a data-row vs skeleton-row delta, not as a colour change.
- Skeleton blocks are `aria-hidden`; assert them through `data-skeleton` and `[data-conv-skeleton]`, never through text content.
