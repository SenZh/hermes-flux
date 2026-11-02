# Bot primary chat

Bot primary chat provides a dedicated forever workspace for each specialized agent, ensuring that messages, activity timestamps, and snippets reflect only this permanent channel and remain physically isolated from ad-hoc session pools.

## Sub-features

- `bot-chat-select` selects an agent from the micro-rail or top drawer card and switches to its forever chat.
- `bot-chat-titlebar` displays the dedicated agent title `🤖 <Name> (Forever Chat)` instead of fallback text.
- `bot-chat-streaming-pulse` lights up the jade breathing indicator on the bot card during active turn execution.
- `bot-chat-atomic-sync` reflects the latest response text and natural-date timestamp onto the bot card.
- `bot-chat-pool-isolation` strictly prevents regular user sessions from polluting the dedicated bot card.

## How to get to it (user POV)

- Click any agent avatar icon on the 52px left micro-rail.
- Click the prominent dedicated primary bot card at the top of the left drawer (`.rail-primary-agent-card`).
- Switch focus to the bot's forever chat from an active conversation.

## Driving it with control-flux

Preconditions:

- `node scripts/verify/control-flux.mjs doctor` passes.
- Build artifacts are present in `packages/desktop/dist/`.

- **Inspect initial state.** Observe the primary bot card before driving. Run `control-flux.mjs run bot-primary-chat`. The drawer top renders `.rail-primary-agent-card` with the bot name and default description.
- **Select primary bot.** Choose the top card. The active focus updates to `{ type: 'bot', botName: '<name>' }`.
- **Verify titlebar.** Inspect the top titlebar. The title element `.session-title-text` displays `🤖 <Name> (Forever Chat)`, proving titlebar synchronization.
- **Submit verification prompt.** Focus `#dock-prompt-input`, fill in `[Verification Engine] 请确认专职工位状态机`, and click `#dock-send-btn`. The primary card immediately displays `.activity-pulse-indicator`.
- **Receive turn completion.** Complete the assistant turn. The primary card reflects the final response snippet and formatted timestamp `刚刚`, while the breathing indicator clears.
- **Assert session isolation.** Verify that ordinary sessions in the drawer keep their own titles and timestamps, and that the bot card contains no text from external sessions.
- **Proof.** Capture visual and DOM artifacts. `screenshot.png` shows the active bot conversation and drawer state; `evidence.json` records `status: 'PASSED'`.

## Gotchas

- Do not confuse ordinary sessions that belong to an agent with the agent's forever chat: forever chat is a dedicated channel with `hidden=true`.
- Titles and snippets are trimmed on save; assert the rendered snippet, not raw multiline whitespace.
- Never assert exact absolute timestamps across dates; assert the formatted natural date string produced by `formatSessionTime`.
