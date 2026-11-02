# Session management

Session management provides full lifecycle handling for ad-hoc user sessions, including creation, instantaneous switching, draft preservation across navigations, safe deletion, and composer focus recovery.

## Sub-features

- `session-create` creates a new conversation from the plus button and switches focus to it.
- `session-switch` switches active conversations instantaneously without conversation stream thrashing.
- `session-draft-preserve` saves unsubmitted text in `#dock-prompt-input` and restores it upon return.
- `session-delete` removes a session via context menu or trash button and transfers focus safely.
- `session-focus-restore` restores the composer caret automatically via dual-phase rAF.

## How to get to it (user POV)

- Choose the `+ 新建会话` button in the left drawer header.
- Choose any conversation row in `#rail-sessions-nested-list`.
- Right-click a conversation row to open the context menu and choose `删除会话`.

## Driving it with control-flux

Preconditions:

- `node scripts/verify/control-flux.mjs doctor` passes.
- At least two conversation items exist in the drawer session list.

- **Open new conversation.** Click the `+` button in the drawer. A blank conversation stream mounts and the prompt input receives focus.
- **Enter draft content.** Type `[Draft] 未发送的草稿文本` into `#dock-prompt-input`. Do not send.
- **Switch conversation.** Click another conversation row in `.session-item[data-id]`. The stream switches to the target session and its stored messages mount.
- **Return and verify draft.** Click the original conversation row again. The text `#dock-prompt-input` contains `[Draft] 未发送的草稿文本`.
- **Delete conversation.** Right-click the test conversation and choose `删除会话`. The item is removed from the DOM list and focus shifts to the adjacent session without unhandled errors.
- **Confirm focus.** Verify that the input box maintains an active caret (`setSelectionRange`) and is immediately typeable without an extra manual click.
- **Proof.** Capture `screenshot.png` showing the active conversation stream and `evidence.json` showing the focus restoration verification.

## Gotchas

- Switching sessions must never trigger a full re-render of untouched DOM outside `#conversation-stream`.
- Canceling a delete confirmation dialog must re-invoke `restoreComposerFocus` to prevent native modal focus theft.
- Draft preservation keys by stored session ID; do not switch before a session ID is assigned.
