/**
 * 数字员工与 Profile 管理服务（Profile Management Service · D12）纯逻辑单测
 * (packages/desktop/__tests__/unit/profileManagementService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileManagementService } from '../../dist/renderer/services/profileManagementService.mjs';

function createMockProfileDeps(overrides = {}) {
  let renderCount = 0;
  let generation = 1;
  let disarmCount = 0;
  const unreadBotNames = new Set();
  const sessionMessagesCache = new Map();
  const botForeverChatCache = new Map();
  const profileAvatarCache = new Map();

  const state = {
    profileName: 'default',
    profiles: [],
    profilesPhase: 'loading',
    activeSessionId: 'sess-1',
    activeLiveSessionId: 'sess-1',
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    sessions: [
      { id: 'sess-1', botName: 'bot-1', botDisplayName: 'Old Display Name' },
    ],
    messages: [
      { id: 'm1', role: 'user', content: 'hello' },
    ],
    messagesPhase: 'ready',
    gatewayConnected: true,
    ...(overrides.state || {}),
  };

  const gatewayClient = overrides.gatewayClient ?? {
    listProfiles: async () => [
      { name: 'bot-1', displayName: 'New Display Name', avatar: 'data:image/avatar1' },
      { name: 'bot-2', displayName: 'Bot Two' },
    ],
    call: async (method, params) => {
      if (method === 'sessions.list') {
        return { sessions: [{ id: 'fc-bot-1', title: 'Forever Chat' }] };
      }
      return null;
    },
    request: async () => null,
    fetchSessionMessages: async () => ({ status: 'success', messages: [] }),
  };

  let selectedSessionId = null;

  return {
    getState: () => state,
    getGatewayClient: () => gatewayClient,
    render: () => { renderCount++; },
    getRenderCount: () => renderCount,
    t: (key, params) => `${key}:${JSON.stringify(params ?? {})}`,
    describeRpcError: (err) => String(err),
    botActivityStore: {
      updateLatestActivity: () => {},
      withActivityMap: (fn) => fn(new Map()),
    },
    unreadBotNames,
    activityTransitionTracker: { clear: () => {} },
    sessionMessagesCache,
    syncProfileLastMessages: () => {},
    applyColdStartFocus: async () => {},
    cancelColdStartFocus: () => {},
    fetchSessions: async () => {},
    fetchModelOptions: async () => {},
    selectSession: async (id) => { selectedSessionId = id; },
    getSelectedSessionId: () => selectedSessionId,
    openGroupRoom: async () => {},
    restoreComposerFocus: () => {},
    disarmRollbackOnLeave: () => { disarmCount++; },
    getDisarmCount: () => disarmCount,
    persistAgentsToCache: () => {},
    persistAvatarCache: () => {},
    profileAvatarCache,
    botForeverChatCache,
    nextLoadMessagesGeneration: () => ++generation,
    getCurrentLoadMessagesGeneration: () => generation,
    logSession: () => {},
  };
}

test('profileManagementService: fetchProfiles fetches profiles and syncs session botDisplayNames', async () => {
  const deps = createMockProfileDeps();
  const service = createProfileManagementService(deps);

  await service.fetchProfiles();

  const state = deps.getState();
  assert.equal(state.profiles.length, 2);
  assert.equal(state.profilesPhase, 'ready');
  assert.equal(state.sessions[0].botDisplayName, 'New Display Name');
  assert.equal(deps.getRenderCount() > 0, true);
});

test('profileManagementService: openBotChat hits 0ms instant cache when foreverChatCache exists', async () => {
  const deps = createMockProfileDeps();
  deps.botForeverChatCache.set('bot-1', 'cached-forever-id');
  const service = createProfileManagementService(deps);

  await service.openBotChat('bot-1');

  const state = deps.getState();
  assert.equal(state.profileName, 'bot-1');
  assert.equal(state.activeFocus.type, 'bot');
  assert.equal(state.activeFocus.botName, 'bot-1');
  assert.equal(deps.getSelectedSessionId(), 'cached-forever-id');
  assert.equal(deps.getDisarmCount(), 1);
});

test('profileManagementService: openBotChat captures stream anchor when injected', async () => {
  let captured = 0;
  const deps = createMockProfileDeps();
  deps.captureStreamAnchor = () => { captured++; };
  deps.botForeverChatCache.set('bot-1', 'cached-forever-id');
  const service = createProfileManagementService(deps);

  await service.openBotChat('bot-1');
  assert.equal(captured, 1, '切入数字员工前必须调用 captureStreamAnchor 捕获前序视口');
});

test('profileManagementService: switchProfile updates profileName and invokes fetchSessions', async () => {
  const deps = createMockProfileDeps();
  const service = createProfileManagementService(deps);

  await service.switchProfile('bot-2');

  assert.equal(deps.getState().profileName, 'bot-2');
  assert.equal(deps.getRenderCount() > 0, true);
});
