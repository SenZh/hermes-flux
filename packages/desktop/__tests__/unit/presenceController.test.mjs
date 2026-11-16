import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceController } from '../../dist/renderer/events/presenceController.mjs';

function createMockDeps(overrides = {}) {
  const state = {
    activeFocus: { type: 'solo', botName: 'bot-1' },
    activeSessionId: 'sess-1',
    messages: [],
    sideAgentCapsules: [],
    presenceTerminal: null,
    turnStartedAt: undefined,
    profiles: [{ name: 'bot-1', displayName: '助理 1' }],
    sessions: [],
    groupRooms: [],
    profileName: 'bot-1',
    lang: 'zh-CN',
    presenceLayout: 'stage',
    activeGroupSpeaker: undefined,
    ...(overrides.initialState || {}),
  };

  let unmounted = false;
  let updated = false;

  const mountHandle = {
    update: () => { updated = true; },
    unmount: () => { unmounted = true; },
  };

  const fakeHost = {
    isConnected: true,
  };

  const deps = {
    getState: () => state,
    resolveAgentAvatar: (name) => `avatar:${name}`,
    isGroupConversationActive: () => false,
    isStreamingActiveForCurrentSession: () => false,
    activeRunningGroupRoomIds: new Set(),
    mountAgentPresence: (host, getSnapshot) => {
      getSnapshot();
      return mountHandle;
    },
    ensureAgentPresenceHost: () => fakeHost,
    ...overrides,
  };

  return { state, deps, mountHandle, fakeHost, getUnmounted: () => unmounted, getUpdated: () => updated };
}

test('PresenceController: 宿主挂载与快照更新验证', () => {
  const { deps, getUpdated } = createMockDeps();
  const controller = createPresenceController(deps);

  // 1. 宿主同步与挂载
  controller.syncAgentPresenceHost();
  assert.ok(controller.getAgentPresenceHost());

  // 2. 指示器快照获取
  const snapshot = controller.getSnapshot();
  assert.ok(snapshot);
  assert.equal(snapshot.identity.kind, 'solo');

  // 3. 在场同步
  controller.syncAgentPresence();
  assert.ok(getUpdated());

  // 4. 重置宿主
  controller.resetPresenceHost();
  assert.equal(controller.getAgentPresenceHost(), null);
});
