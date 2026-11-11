# Prompt navigator rail

A vertical rail pinned to the right edge of the conversation stage folds every user prompt of the loaded session into one 2px tick. Hovering a tick opens a floating panel listing the nearby prompts; clicking a tick or a panel row jumps the conversation viewport to that prompt.

## Sub-features

- `rail-ticks`: up to 30 visible ticks, current prompt solid, hovered prompt one step dimmer, others one step dimmer still.
- `rail-window`: the tick window follows the active prompt; edge hot zones (18px top and bottom) carousel outside the window.
- `panel-list`: 8 visible rows at 40px each, preview text only, no ordinal column, no border doubling.
- `panel-jump`: clicking a row jumps by message id, never by volatile index.
- `rail-a11y`: the gutter is a `listbox` with `aria-activedescendant`; Arrow/Home/End/Enter/Escape drive it; panel rows stay out of the Tab order.

## How to get to it (user POV)

- Open any session that has at least two user prompts. The rail appears at the right edge, vertically centered.
- Hover the rail to open the floating list; move the pointer along the rail to walk the window.
- Click a tick to jump to that prompt.
- Focus the rail with `Tab` (it is the only tab stop in this widget), then use Arrow keys, `Home`/`End`, `Enter`, `Esc`.

## Driving it with control-flux

Preconditions: `npm run build` is fresh, `node scripts/verify/control-flux.mjs doctor` passes, and the active session has two or more user prompts.

1. Run `node scripts/verify/control-flux.mjs run prompt-navigator-rail`.
   Observable: `.conv-prompt-rail` exists, `.conv-prompt-rail__gutter` has width 28px on a wide column and 12px when the canvas right edge is within 40px of the pod right edge.
2. Drive a real `pointermove` across the gutter midpoint.
   Observable: `.conv-prompt-rail__panel` mounts; its computed `padding` is 8px, its viewport height is 320px (8 × 40), and `.conv-prompt-rail__panel-index` count is 0.
3. Read the first panel row.
   Observable: it has exactly one child span (`.conv-prompt-rail__panel-text`), `tabIndex` is -1, and its `top` advances by 40px per row.
4. Click a tick whose prompt is not the current one.
   Observable: the viewport lands within 12px of that prompt's top and the active tick moves to it.
5. Focus the gutter and press `End`, then `ArrowUp` repeatedly.
   Observable: `aria-activedescendant` always points at a mounted tick and the panel highlight follows.

## Gotchas

- Do not measure contrast by eye: the ticks are 2px graphics, so WCAG 1.4.11 wants 3:1 against the stage background. `--muted-foreground` clears it on every skin; foreground percentage mixes do not.
- Do not reuse `--shadow-card` for a floating panel border: on `warm-paper` and `ayu-light` it already carries a `0 0 0 1px` ring, which doubles with `border`.
- `--specular-line` is a `box-shadow` fragment, not a color. Assigning it to `border-color` makes the browser drop the whole declaration.
- The rail is hidden below a 720px viewport; there is no hit band to drive there.
- Panel rows are `tabIndex=-1` on purpose: the gutter owns the keyboard. If a row becomes focusable, `ArrowDown` is intercepted by the gutter handler and `Enter` selects `highlightedIndex` rather than the focused row.
- `artifacts/verification/` is gitignored, so re-run the command above to regenerate `evidence.json` and the screenshots instead of trusting a stale copy.
