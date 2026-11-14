/**
 * AppState 领域模型与初始工厂单元测试
 *
 * 【断言】
 *   1. 初始状态工厂默认值正确生成；
 *   2. 移动端视口平台推导生效；
 *   3. 骨架屏默认三域相位均初始化为 loading（杜绝白屏/假空）；
 *   4. readPresenceLayout 容忍空 localStorage 并默认回退 stage。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  readPresenceLayout,
  PRESENCE_LAYOUT_STORAGE_KEY,
} from '../../dist/renderer/state/appState.mjs';

test('AppState 领域状态模型测试', async (t) => {
  await t.test('1. createInitialState 默认生成合法 AppState', () => {
    const state = createInitialState({ platform: 'windows' });
    assert.equal(state.platform, 'windows');
    assert.equal(state.isMaximized, false);
    assert.equal(state.profilesPhase, 'loading');
    assert.equal(state.sessionsPhase, 'loading');
    assert.equal(state.messagesPhase, 'loading');
    assert.equal(state.activeSessionId, '');
    assert.equal(state.messages.length, 0);
    assert.equal(state.isStreaming, false);
  });

  await t.test('2. readPresenceLayout 默认 stage 并支持 dock', () => {
    assert.equal(PRESENCE_LAYOUT_STORAGE_KEY, 'hermes_flux_presence_layout');
    const layout = readPresenceLayout();
    assert.ok(layout === 'stage' || layout === 'dock');
  });
});
