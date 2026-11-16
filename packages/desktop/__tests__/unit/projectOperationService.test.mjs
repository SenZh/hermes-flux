/**
 * 项目树管理与会话归属服务（Project Operation Service · D15）纯逻辑单测
 * (packages/desktop/__tests__/unit/projectOperationService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectOperationService } from '../../dist/renderer/services/projectOperationService.mjs';

function createMockProjectDeps(overrides = {}) {
  let renderCount = 0;
  const state = {
    projects: [
      { id: 'initial-proj', name: 'Initial Project', path: '/workspace/initial' },
    ],
    profiles: [
      { name: 'bot-1', displayName: 'Bot 1', lastActive: 0, preview: '' },
      { name: 'bot-2', displayName: 'Bot 2', lastActive: 0, preview: '' },
    ],
    sessions: [
      { id: 'sess-1', title: 'Side Chat', botName: 'bot-1', preview: 'Side task preview', timestamp: 999999 },
    ],
    ...(overrides.state || {}),
  };

  const botActivityMap = new Map([
    ['bot-1', { lastMessage: 'Forever Chat Activity', timestamp: 1234567890 }],
  ]);

  const botActivityStore = {
    withActivityMap: (fn) => fn(botActivityMap),
    updateLatestActivity: (botName, text, timestamp) => {
      botActivityMap.set(botName, { text, timestamp });
    },
  };

  const botForeverChatCache = new Map([
    ['bot-1', 'forever-sess-bot-1'],
  ]);

  const sessionMessagesCache = new Map();

  const gatewayClient = overrides.gatewayClient ?? {
    call: async (method) => {
      if (method === 'projects.list') {
        return {
          projects: [
            { id: 'p1', name: 'Project Alpha', path: '/path/alpha' },
            { id: 'p2', name: 'Project Beta', path: '/path/beta' },
          ],
        };
      }
      return null;
    },
  };

  return {
    getState: () => state,
    getGatewayClient: () => gatewayClient,
    render: () => { renderCount++; },
    getRenderCount: () => renderCount,
    botActivityStore,
    botForeverChatCache,
    sessionMessagesCache,
    formatSessionTime: (ts) => `TIME:${ts}`,
  };
}

test('projectOperationService: fetchProjects normal resolution and mapping', async () => {
  const deps = createMockProjectDeps();
  const service = createProjectOperationService(deps);

  await service.fetchProjects();

  const state = deps.getState();
  assert.equal(state.projects.length, 2);
  assert.equal(state.projects[0].id, 'p1');
  assert.equal(state.projects[0].name, 'Project Alpha');
  assert.equal(state.projects[0].path, '/path/alpha');
  assert.equal(deps.getRenderCount() > 0, true);
});

test('projectOperationService: fetchProjects handles network failure with Failure Is Not Empty', async () => {
  const deps = createMockProjectDeps({
    gatewayClient: {
      call: async () => {
        throw new Error('Network timeout');
      },
    },
  });
  const service = createProjectOperationService(deps);

  await service.fetchProjects();

  const state = deps.getState();
  // 必须保留先前的项目，严禁抹杀为空
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].id, 'initial-proj');
  assert.equal(deps.getRenderCount() > 0, true);
});

test('projectOperationService: syncProfileLastMessages uses botActivity and foreverChatCache without being polluted by side sessions', () => {
  const deps = createMockProjectDeps();
  const service = createProjectOperationService(deps);

  service.syncProfileLastMessages();

  const state = deps.getState();
  const bot1 = state.profiles.find((p) => p.name === 'bot-1');
  assert.ok(bot1);
  // 必须来自 Forever Chat 活动，绝不能被普通旁聊 'Side task preview' 覆盖
  assert.equal(bot1.lastMessage, 'Forever Chat Activity');
  assert.equal(bot1.lastTime, 'TIME:1234567890');
});
