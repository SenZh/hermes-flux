# Group room collaboration

Group room collaboration hosts multi-agent deliberation rooms with dynamic collage avatars, member badges, seed background memos, and asynchronous message streams.

## Sub-features

- `group-room-list` displays all participating group rooms with collage avatars and member counts.
- `group-room-enter` switches focus to a group room and updates the titlebar with group context.
- `group-room-seed-memo` renders the collapsible seed briefing memo at the top of the room feed.
- `group-room-send` broadcasts a collaborative goal to all group member agents.
- `group-room-read-status` clears unread status on entrance and tracks running pulses.

## How to get to it (user POV)

- Click any group row in `#rail-groups-nested-list`.
- Click the group shortcut icon at the bottom of the station rail.
- Upgrade an active conversation to a swarm room via `👥 升级为研讨群聊`.

## Driving it with control-flux

Preconditions:

- `node scripts/verify/control-flux.mjs doctor` passes.
- At least one multi-agent group room exists with members assigned.

- **Inspect group section.** Ensure `#rail-groups-nested-list` contains at least one `.rail-group-item`. Verify the presence of multi-agent collage avatars.
- **Enter group room.** Click the group row. Active focus updates to `{ type: 'group', roomId: '<id>' }`.
- **Verify titlebar.** Inspect `.session-title-text`. The titlebar shows `👥 <Group Name>`, verifying contextual title resolution.
- **Inspect room seed memo.** Verify the presence of the seed memo container at the top of the conversation stream displaying briefing context and participant specialists.
- **Broadcast prompt.** Fill `#dock-prompt-input` with `[Group Engine] 请各位专家展开协同推演` and click `#dock-send-btn`.
- **Verify pulse indicator.** The group item in the drawer activates `.activity-pulse-indicator`.
- **Proof.** Capture `screenshot.png` showing the group room view and collage avatars, and record `evidence.json`.

## Gotchas

- Group rooms are distinct from single agent forever chats and ad-hoc sessions: do not send ad-hoc `session.delete` commands against room IDs.
- Legacy local group rooms from historical desktop versions are read-only; verify on managed rooms.
- Collage avatars use CSS grid for 3-4 members and split halves for 2 members; assert container presence rather than individual img nodes.
