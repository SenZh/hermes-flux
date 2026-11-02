# Interactive input dock

Interactive input dock hosts the floating composer, bounded strictly to the 740px golden width, with model picker accordion, thinking depth controls, and multiline auto-expansion.

## Sub-features

- `dock-golden-width` enforces `max-width: 740px` centered within the active conversation pod.
- `dock-model-picker` opens the provider-grouped model accordion tree with search filtering.
- `dock-thinking-depth` switches between off, low, medium, and high reasoning budgets.
- `dock-auto-expand` expands textarea dynamically based on scrollHeight up to 240px with collapse toggle.
- `dock-shortcut-send` submits prompt on Enter (when not composing) and inserts newline on Shift+Enter.

## How to get to it (user POV)

- Observe the bottom floating area within `#conversation-stream`.
- Click the model trigger badge in the dock footer (`#dock-model-trigger`).
- Click the reasoning level selector chip (`#dock-thinking-trigger`).

## Driving it with control-flux

Preconditions:

- `node scripts/verify/control-flux.mjs doctor` passes.
- Gateway connection is online (`state.gatewayConnected === true`).

- **Measure container geometry.** Read computed CSS style for `.input-dock-container`. Verify that `maxWidth` resolves to `740px`.
- **Open model picker.** Click `#dock-model-trigger`. Verify that `#dock-model-menu` mounts with `display: block`.
- **Filter model tree.** Fill `#dock-model-search-input` with `claude`. Verify that non-matching providers collapse while matching models remain visible.
- **Select model.** Click a model row. The menu closes, and the trigger badge text updates to the chosen model name.
- **Test auto-expansion.** Fill `#dock-prompt-input` with 10 lines of text. Verify that textarea height expands beyond initial 48px and that `#dock-input-collapse-toggle` becomes visible.
- **Toggle collapse.** Click `#dock-input-collapse-toggle`. The input collapses to 64px and the button text updates to `展开`. Click again to restore full height.
- **Proof.** Capture `screenshot.png` showing the 740px dock with model picker open, and record `evidence.json`.

## Gotchas

- Input dock must never be mounted outside `.flux-middle-pod`.
- Do not submit on Enter when IME composition is active (`isComposing === true`).
- Model menu DOM updates must preserve textarea focus and caret position.
