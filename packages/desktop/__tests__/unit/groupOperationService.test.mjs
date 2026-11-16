/**
 * 群聊研讨室运维服务（Group Operation Service · D13）纯逻辑单测
 * (packages/desktop/__tests__/unit/groupOperationService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupOperationService } from '../../dist/renderer/services/groupOperationService.mjs';

function createMockGroupDeps(overrides = {}) {
  let renderCount = 0;
  let disarmCount = 0;
  let generation = 1;
  const unreadGroupRoomIds = new Set();
  const activeRunningGroupRoomIds = new Set();

  const state = {
    activeSessionId: 'sess-1',
    activeLiveSessionId: 'sess-1',
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    groupRooms: [
      { roomId: 'room-init', name: 'Init Room', members: ['bot-a'], updatedAt: 1000 },
    ],
    profiles: [
      { name: 'bot-a', displayName: 'Bot A' },
      { name: 'bot-b', displayName: 'Bot B' },
    ],
    messages: [],
    messagesPhase: 'ready',
    activeGroupSpeaker: null,
    isLoadingOlder: false,
    hasOlderMessages: false,
    ...(overrides.state || {}),
  };

  const mockCall = async (method, params) => {
    if (method === 'groups.list') {
      return {
        rooms: [
          { room_id: 'room-1', name: 'Room Alpha', members: [{ profile: 'bot-a' }, { profile: 'bot-b' }], updated_at: 2000 },
        ],
      };
    }
    if (method === 'groups.log') {
      return {
        events: [
          { event_id: 'm1', text: 'Hello team', actor: { kind: 'member', profile: 'bot-a' }, created_at: 1500 },
        ],
      };
    }
    return null;
  };

  const gatewayClient = overrides.gatewayClient ?? {
    call: mockCall,
    request: mockCall,
    listProfiles: async () => [{ name: 'bot-a' }, { name: 'bot-b' }],
  };

  const turnExecutionService = {
    resetActiveGroupThread: () => {},
    syncGroupRoomLogsToState: () => {},
    refreshGroupRoomLog: async () => 1,
    sendGroupMessage: async () => {},
    ...(overrides.turnExecutionService || {}),
  };

  const groupPollerManager = {
    isPolling: () => false,
    startAwaitReply: () => {},
    stop: () => {},
    stopAll: () => {},
  };

  return {
    getState: () => state,
    getGatewayClient: () => gatewayClient,
    render: () => { renderCount++; },
    getRenderCount: () => renderCount,
    t: (key, params) => `${key}:${JSON.stringify(params ?? {})}`,
    disarmRollbackOnLeave: () => { disarmCount++; },
    getDisarmCount: () => disarmCount,
    unreadGroupRoomIds,
    activeRunningGroupRoomIds,
    activityTransitionTracker: { clear: () => {} },
    turnExecutionService,
    groupPollerManager,
    persistGroupsToCache: () => {},
    resolveAgentAvatar: () => 'data:image/avatar',
    formatTimestamp: (ts) => String(ts),
    nextLoadMessagesGeneration: () => ++generation,
    getCurrentLoadMessagesGeneration: () => generation,
    logSession: () => {},
  };
}

test('groupOperationService: fetchGroupRooms normal fetching and authoritative gate', async () => {
  const deps = createMockGroupDeps();
  const service = createGroupOperationService(deps);

  await service.fetchGroupRooms();

  const state = deps.getState();
  assert.equal(state.groupRooms.length, 1);
  assert.equal(state.groupRooms[0].roomId, 'room-1');
  assert.equal(service.isHostedRoom('room-1'), true);
  assert.equal(deps.getRenderCount() > 0, true);
});

test('groupOperationService: fetchGroupRooms retains existing rooms on failure (Failure Is Not Empty)', async () => {
  const deps = createMockGroupDeps({
    gatewayClient: {
      call: async () => { throw new Error('Gateway disconnected'); },
      request: async () => { throw new Error('Gateway disconnected'); },
      listProfiles: async () => [],
    },
  });
  const service = createGroupOperationService(deps);

  await service.fetchGroupRooms();

  const state = deps.getState();
  // 保留 room-init
  assert.equal(state.groupRooms.length, 1);
  assert.equal(state.groupRooms[0].roomId, 'room-init');
});

test('groupOperationService: openGroupRoom disarms rollback, switches focus, loads logs, and syncs speaker', async () => {
  const deps = createMockGroupDeps();
  const service = createGroupOperationService(deps);

  // 先拉房间
  await service.fetchGroupRooms();
  await service.openGroupRoom('room-1');

  const state = deps.getState();
  assert.equal(deps.getDisarmCount(), 1);
  assert.equal(state.activeFocus.type, 'group');
  assert.equal(state.activeFocus.roomId, 'room-1');
  assert.equal(state.activeSessionId, 'room-1');
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].sender, 'bot-a');
  assert.equal(state.messagesPhase, 'ready');
  assert.equal(state.activeGroupSpeaker, 'bot-a');
});

test('groupOperationService: syncActiveGroupSpeakerFromMessages resets speaker when not in group focus', () => {
  const deps = createMockGroupDeps({
    state: {
      activeFocus: { type: 'session', sessionId: 's1' },
      activeGroupSpeaker: 'bot-a',
    },
  });
  const service = createGroupOperationService(deps);

  service.syncActiveGroupSpeakerFromMessages();

  assert.equal(deps.getState().activeGroupSpeaker, null);
});
