# Left rail cockpit

The left rail is a React island: a 52px micro rail for agent identity plus a 212px context drawer. It shows the focused agent's own sessions and group rooms, and never another agent's. Session rows carry no avatar, keep a 48px rhythm, and pin a compact timestamp to the right edge.

## Sub-features

- `rail-micro` — the 52px micro rail stays visible while expanded and collapsed, and scrolls its agent list independently.
- `rail-primary-card` — the drawer's first row is the focused agent's primary card, fed only by the profile snapshot.
- `rail-agent-scope` — the drawer lists only the focused agent's sessions and group rooms.
- `rail-session-row` — session rows have no avatar, are 48px tall, truncate a 12px muted subtitle, and pin the time to the right edge.
- `rail-group-collage` — group rows render a collage avatar: two cells for two members, four for four, placeholder for none.
- `rail-width-clamp` — dragging, double-click reset and cold-start restore all clamp to the `LEFT_RAIL_WIDTH` contract.
- `rail-search` — typing filters rows by derived list while the input node stays mounted.

## How to get to it (user POV)

- Launch the desktop app; the left rail is always present.
- Click an agent avatar in the 52px micro rail to focus that agent.
- Click a session row in the drawer to open that conversation.
- Click the group or project button at the bottom of the micro rail to switch the drawer deck.
- Drag the drawer's right edge to resize; double-click it to reset.
- Click the `›` button above the micro rail's bottom cluster, or press `Ctrl+B`, to collapse the rail.

## Driving it with control-flux

Preconditions: `npm run build` has produced fresh `packages/desktop/dist/`, `node scripts/verify/control-flux.mjs doctor` passes, and the app has at least two agents, two sessions and one group room.

1. Seed agents and sessions, then read `#flux-left-rail` width — expect `52` when collapsed, `264` when expanded.
2. Inspect `#flux-station-rail` — every agent must appear with `data-station-profile`, and the list must be independently scrollable (`overflow-y-auto`, `scrollbar-width:none`).
3. Inspect `.rail-primary-agent-card` — expect `data-primary-bot` equal to the focused agent, and a subtitle/time taken from the profile snapshot only.
4. Seed a session titled `电商支付重构方案` under `default`, then focus `arch-wang` — that title must be absent from the drawer, and the arch-wang session must be present.
5. Measure a `.session-item` — expect height `48`, no `<img>`/`<svg>` child, a `12px` muted subtitle, and a `<time>` element within 12px of the row's right edge.
6. Inspect a two-member `.rail-group-item` — expect two collage cells; a four-member room expects four; a zero-member room expects the `👥` placeholder.
7. Drag `.rail-resize-handle[data-rail-handle="left"]` far right — expect the rail to stop at `320` and `hermes_flux_rail_w_left` to equal `320`.
8. Drag the handle far left — expect the rail to stop at `264`.
9. Double-click the handle — expect the rail to return to `264`.
10. Write `900` into `hermes_flux_rail_w_left`, then reload — expect width `320` and the stored value rewritten to `320`.
11. Type a query into `#session-search-input` — expect only matching rows, the same input node, and the full list restored after clearing.

Pass when every measurement above holds and no uncaught page error was recorded during the run.

## Gotchas

- The drag handle lives outside the drawer on purpose: the drawer is `overflow: hidden`, so a handle inside it gets clipped and hit-testing lands on the drawer, which makes physical dragging silently do nothing.
- `#react-leftrail-host` uses `display: contents`. Never target it or `.flux-body-container` with `innerHTML`/`outerHTML`: it would tear down the React tree.
- Session rows are `<button>` elements now, not `<div>`s. Selectors based on `.session-item[data-id]` still work; selectors that assumed a div (e.g. `div.session-item`) do not.
- The rail width contract lives in one place, `LEFT_RAIL_WIDTH` in `packages/desktop/src/renderer/index.ts`. Never hardcode `264`/`320` in a new call site.
- The idle breathing pulse is intentionally absent: it needs the centralized duration ticker. The orphan `jadePulse` keyframes were removed alongside the old template.
- Evidence lives in `artifacts/verification/pr3b-left-rail-expanded.png` and `artifacts/verification/pr3b-left-rail-collapsed.png`.
