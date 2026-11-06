/**
 * 对话区 React 骨架测试（P1）
 *
 * 断言结构钩子与回合分组，不依赖真实浏览器；几何与滚动由 CDP 用例负责。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationStage, groupTurns } from '../dist/components-react/conversation/index.js';

const base = {
  mode: 'scratchpad',
  connection: 'connected',
  messages: [],
  isStreaming: false,
};

test('空态：四个结构钩子齐全，渲染 conv-state', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationStage, { snapshot: base }));
  for (const layer of ['stage', 'stream', 'canvas', 'scrim']) {
    assert.ok(html.includes(`data-conv-layer="${layer}"`), `缺少 data-conv-layer="${layer}"`);
  }
  assert.ok(html.includes('conv-state'), '空态必须渲染 conv-state');
  assert.ok(html.includes('conv-stream'), '必须使用 conv-stream');
  assert.ok(html.includes('conv-canvas'), '必须使用 conv-canvas');
});

test('消息流：用户与助手回合分开，连续同角色合并', () => {
  const snapshot = {
    ...base,
    messages: [
      { id: 'u1', role: 'user', content: '问题一' },
      { id: 'a1', role: 'assistant', content: '回答一' },
      { id: 'a2', role: 'assistant', content: '补充' },
      { id: 'u2', role: 'user', content: '问题二' },
    ],
  };
  const html = renderToStaticMarkup(React.createElement(ConversationStage, { snapshot }));
  assert.equal((html.match(/class="conv-turn"/g) || []).length, 3, '应为 3 个回合');
  assert.ok(html.includes('data-role="user"'), '必须渲染用户消息');
  assert.ok(html.includes('data-role="assistant"'), '必须渲染助手消息');
  assert.ok(html.includes('id="msg-content-a1"'), '助手正文必须保留增量锚点 ID');
});

test('群聊：不同 sender 的连续 assistant 必须断开回合', () => {
  const turns = groupTurns([
    { id: 'a1', role: 'assistant', content: 'A 说', sender: 'AgentA' },
    { id: 'a2', role: 'assistant', content: 'B 说', sender: 'AgentB' },
  ]);
  assert.equal(turns.length, 2, '不同 sender 必须分成两个回合');
});

test('连接中与未连接：不渲染消息，但保留舞台结构', () => {
  for (const connection of ['connecting', 'disconnected']) {
    const html = renderToStaticMarkup(
      React.createElement(ConversationStage, { snapshot: { ...base, connection } })
    );
    assert.ok(html.includes('data-conv-layer="stage"'), `${connection} 必须保留舞台`);
    assert.ok(!html.includes('conv-message'), `${connection} 不得渲染消息`);
  }
});
