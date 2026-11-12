# Interactive input dock

Interactive input dock hosts the floating composer, bounded strictly to the 740px golden width, with the model picker accordion, the reasoning cascade, and multiline auto-expansion capped at 220px.

## Sub-features

- `dock-golden-width` enforces `max-width: 740px` centered within the active conversation pod.
- `dock-model-picker` opens the provider-grouped model accordion tree with search filtering.
- `dock-thinking-depth` switches between the five reasoning levels through the cascade anchored to the hovered model row.
- `dock-auto-expand` grows the textarea from 66px up to 220px, then scrolls internally. There is no collapse toggle and no cap notice.
- `dock-shortcut-send` submits the prompt on Enter (when not composing) and inserts a newline on Shift+Enter. While a turn runs, Enter enqueues the draft instead of blocking.
- `dock-slash-completion` lists every command the gateway returns; the client never truncates the list. Command names stay verbatim, descriptions follow the interface language.
- `dock-primary-action` renders Send when idle and Stop when a turn is running. The two never render together as separate glyphs.
- `dock-approval-mode` switches the gateway `approvals.mode` between manual, smart and off.
- `dock-attachment-rail` renders image thumbnails and file pills above the shell, outside the editor.

## How to get to it (user POV)

- Observe the bottom floating area within `#conversation-stream`.
- Click the model trigger in the dock footer (`#dock-model-selector-btn`) to read `model / level` and open the menu.
- Click the approval button (`#dock-approval-toggle-btn`) to switch approval mode.

## Driving it with control-flux

Preconditions:

- `node scripts/verify/control-flux.mjs doctor` passes.
- Gateway connection is online (`state.gatewayConnected === true`).

- **Measure container geometry.** Read computed CSS style for `.input-card-box.composer-dock`. Verify that `maxWidth` resolves to `740px`.
- **Open model picker.** Click `#dock-model-selector-btn`. Verify that `#dock-model-dropdown` mounts with `display: block`.
- **Filter model tree.** Fill `#dock-model-search-input` with `claude`. Verify that non-matching providers collapse while matching models remain visible.
- **Select model.** Click a model row. The menu closes, and the trigger text updates to the chosen model name with its reasoning level after the slash.
- **Test auto-expansion.** Fill `#dock-prompt-input` with 10 lines of text. Verify that the textarea height grows beyond 66px and stops at 220px, and that `overflow-y` becomes scrollable at the cap.
- **Test collapse on delete.** Clear the textarea. Verify that the height returns to 66px rather than sticking at the cap.
- **Test primary action.** With an empty composer and a running turn, verify `#dock-stop-btn` exists and `#dock-send-btn` does not.
- **Test enqueue on Enter.** With a running turn and a non-empty draft, press Enter. Verify the draft leaves the composer and a queue row appears, and that no "turn still running" notice is shown.
- **Test slash coverage.** Type `/`. Verify the popover lists every command the gateway returned (no 12-item cap), and that descriptions follow the interface language while command names stay verbatim.
- **Test mention in every focus.** Type `@` in a normal session, a group room, and a Bot forever chat. Verify agents are listed in all three, and that a Bot forever chat excludes the resident Bot itself.
- **Proof.** Capture `screenshot.png` showing the 740px dock with model picker open, and record `evidence.json`.

## Gotchas

- Input dock must never be mounted outside `.flux-middle-pod`.
- Do not submit on Enter when IME composition is active (`isComposing === true`).
- Model menu DOM updates must preserve textarea focus and caret position.
- The height measurement must reset `style.height` to `auto` before reading `scrollHeight`, or the field sticks at the cap after deleting text.
- The running-state button column is 58px tall, so the footer grows by 28px when a turn starts. Anything that reserves space for the dock must read the rendered height instead of assuming a constant.
