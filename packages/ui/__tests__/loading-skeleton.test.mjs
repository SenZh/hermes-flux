/**
 * 首屏骨架守卫测试。
 *
 * 【测试什么】用户能观察到的行为差异：
 *   数据未到达时只出现骨架、不出现伪造的默认助理 / 假会话 / "开始新的对话"；
 *   数据到达后骨架必须消失，真实空态与原有文案原样回来。
 * 【不测什么】骨架的像素与配色 —— 由 CDP 计算样式与 style-review 负责。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeftRail } from '../dist/components-react/LeftRail.js';
import { buildLeftRailModel } from '../dist/components-react/leftRailModel.js';
import { ConversationMessageList, ConversationStage } from '../dist/components-react/conversation/index.js';
import { renderConversationCanvas } from '../dist/components/MiddlePod/MiddlePod.js';

const NOW = new Date(2026, 10, 3, 15, 30).getTime();

const PROFILES = [
  { name: 'default', displayName: 'Default 助理', isDefault: true },
  { name: 'arch-wang', displayName: '架构老王' },
];

const SESSIONS = [
  { id: 's-a', title: '电商支付重构方案', preview: '幂等键下沉到 core', botName: 'default', timestamp: NOW },
];

function rail(overrides = {}) {
  const noop = () => {};
  const model = buildLeftRailModel({
    activeSessionId: '',
    activeFocus: { type: 'bot', botName: 'default' },
    sessions: [],
    profileName: 'default',
    profiles: [],
    groups: [],
    projects: [],
    activeRailTab: 'chats',
    searchQuery: '',
    ...overrides,
  });
  return renderToStaticMarkup(React.createElement(LeftRail, {
    model,
    collapsed: false,
    searchQuery: '',
    onSelectSession: noop,
    onSelectBot: noop,
    onSelectGroup: noop,
    onOpenSessionMenu: noop,
    onOpenBotMenu: noop,
    onOpenGroupMenu: noop,
    onSearchChange: noop,
    onNewChat: noop,
    onSetTab: noop,
    onToggleSessions: noop,
    onToggleGroups: noop,
    onStartGroupRename: noop,
    onConfirmGroupRename: noop,
    onCancelGroupRename: noop,
    onResizeStart: noop,
  }));
}

const countOf = (html, marker) => (html.match(new RegExp(marker, 'g')) || []).length;

test('Agent 域未就绪：微轨与主工位卡只出骨架，绝不伪造默认助理', () => {
  const html = rail({ profilesPhase: 'loading', sessionsPhase: 'loading' });
  assert.equal(countOf(html, 'data-skeleton="agent"'), 3, '微轨必须给 3 个 Agent 骨架');
  assert.ok(html.includes('data-skeleton="agent-card"'), '抽屉主工位卡必须是骨架行');
  assert.ok(!html.includes('data-station-profile'), '加载中不得渲染任何真实 Agent 站点');
  assert.ok(!html.includes('data-primary-bot'), '加载中不得渲染主工位身份行');
  assert.ok(!html.includes('Default 助理'), '加载中不得出现默认助理称呼');
});

test('会话域未就绪：只出骨架行，不说"暂无历史会话"', () => {
  const html = rail({ profilesPhase: 'ready', profiles: PROFILES, sessionsPhase: 'loading' });
  assert.equal(countOf(html, 'data-skeleton="session"'), 4, '会话区必须给 4 行骨架');
  assert.ok(!html.includes('暂无历史会话'), '加载中不得断言没有会话');
  assert.ok(html.includes('data-station-profile="default"'), 'Agent 已就绪时微轨必须显示真实站点');
});

test('两域就绪且确实为空：骨架消失，原有空态文案回来', () => {
  const html = rail({ profilesPhase: 'ready', profiles: PROFILES, sessionsPhase: 'ready' });
  assert.equal(countOf(html, 'data-skeleton="session"'), 0, '数据到达后不得残留会话骨架');
  assert.equal(countOf(html, 'data-skeleton="agent"'), 0, '数据到达后不得残留 Agent 骨架');
  assert.ok(html.includes('暂无历史会话'), '真实空列表必须保留原空态');
});

test('未提供相位（旧调用方）：行为与改造前一致，不出现骨架', () => {
  const html = rail({ profiles: PROFILES, sessions: SESSIONS });
  assert.ok(!html.includes('flux-skeleton'), '缺省相位必须视为 ready');
  assert.ok(html.includes('data-id="s-a"'), '缺省相位下必须渲染真实会话行');
});

test('对话区：历史未到达时出骨架，不出"开始新的对话"', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationMessageList, {
    snapshot: { mode: 'scratchpad', connection: 'connected', messages: [], isStreaming: false, messagesPhase: 'loading' },
  }));
  assert.ok(html.includes('data-conv-skeleton="true"'), '加载中必须渲染对话骨架');
  assert.ok(!html.includes('conv-state'), '加载中不得渲染空态');
  assert.ok(!html.includes('开始新的对话'), '加载中不得下"没有对话"的结论');
});

test('对话区：历史到达且为空时恢复空态文案', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationMessageList, {
    snapshot: { mode: 'scratchpad', connection: 'connected', messages: [], isStreaming: false, messagesPhase: 'ready' },
  }));
  assert.ok(html.includes('conv-state'), '数据到达后的空会话必须渲染空态');
  assert.ok(!html.includes('data-conv-skeleton'), '不得残留骨架');
});

test('对话区：已有消息时骨架绝不覆盖真实内容', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationMessageList, {
    snapshot: {
      mode: 'scratchpad',
      connection: 'connected',
      messages: [{ id: 'u1', role: 'user', content: '真实提问' }],
      isStreaming: false,
      messagesPhase: 'loading',
    },
  }));
  assert.ok(html.includes('data-msg-id="u1"'), '已有消息必须优先上屏');
  assert.ok(!html.includes('data-conv-skeleton'), '有消息时不得插入骨架');
});

test('舞台：连接中且历史未到达时同样只出骨架', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationStage, {
    snapshot: { mode: 'scratchpad', connection: 'connecting', messages: [], isStreaming: false, messagesPhase: 'loading' },
  }));
  assert.ok(html.includes('data-conv-skeleton="true"'), '连接中必须出骨架');
  assert.ok(!html.includes('正在连接 Hermes 网关'), '连接中文案让位于骨架');
});

test('舞台：已有消息时 loading 不得覆盖真实内容', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationStage, {
    snapshot: {
      mode: 'scratchpad',
      connection: 'connected',
      messages: [{ id: 'u1', role: 'user', content: '真实提问' }],
      isStreaming: false,
      messagesPhase: 'loading',
    },
  }));
  assert.ok(html.includes('data-msg-id="u1"'), '已有消息必须优先上屏');
  assert.ok(!html.includes('data-conv-skeleton'), '有消息时舞台也不得插入骨架');
});

test('模板画布：历史未到达时把画布交还 React 宿主，不输出欢迎空态', () => {
  const html = renderConversationCanvas({ gatewayConnected: true, messages: [], messagesPhase: 'loading' });
  assert.ok(html.includes('id="react-message-list-host"'), '加载中画布必须保留 React 宿主');
  assert.ok(!html.includes('conv-state'), '加载中不得输出欢迎空态');
});

test('模板画布：就绪且为空时恢复欢迎空态，且不再挂宿主', () => {
  const html = renderConversationCanvas({ gatewayConnected: true, messages: [], messagesPhase: 'ready' });
  assert.ok(!html.includes('id="react-message-list-host"'), '就绪空态走模板欢迎页');
  assert.ok(html.includes('conv-canvas'), '画布结构必须保留');
});
