/**
 * 流式直写锚点契约（回归守卫）
 *
 * 【设计意图 (Why)】
 *   `tokenStreamWriter` 只 patch 已存在的 `#msg-content-*` 节点（无 render / mount 能力）。
 *   流式首帧的助手行必然「正文/思考/工具」全空，若此时整行或正文容器被 `return null`，
 *   锚点就永远不存在，后续每一帧直写都空转，直到回合结束 React 重渲染才整段一次性上屏。
 *   本套用例把这个契约钉死：**正在流式的末条助手行必须有锚点**，而历史空行必须继续无占位。
 *
 * 【约束与规则 (Rules)】
 *   1. 断言粒度只到「行级 data-msg-id」与「锚点级 id="msg-content-*"」；
 *      禁止用 `.conv-turn` 计数推断空行是否渲染——TurnGroup 无条件渲染回合外壳。
 *   2. 空锚点必须是 `display:none` 的隐形锚点，不能是可见空 div：
 *      可见空 div 会让 flex gap 多出一档间距，等于回潮 89ca860 消除空容器间距的原始意图。
 *   3. 非流式空行不得产出任何消息节点，守 b22147c。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationStage } from '../dist/components-react/conversation/index.js';

const base = { mode: 'scratchpad', connection: 'connected', messages: [], isStreaming: false };

function render(snapshot) {
  return renderToStaticMarkup(React.createElement(ConversationStage, { snapshot: { ...base, ...snapshot } }));
}

const user = (id = 'u1') => ({ id, role: 'user', content: '问题' });
const assistant = (id, extra = {}) => ({ id, role: 'assistant', content: '', thought: '', ...extra });

/** 截取某条消息行自身的 HTML 片段：从它的 data-msg-id 起，到下一个 data-msg-id 为止。 */
function sliceByMessageId(html, id) {
  const start = html.indexOf(`data-msg-id="${id}"`);
  if (start < 0) return '';
  const next = html.indexOf('data-msg-id="', start + 1);
  return next < 0 ? html.slice(start) : html.slice(start, next);
}

test('流式空助手行必须存在隐形直写锚点', () => {
  const html = render({ isStreaming: true, messages: [user(), assistant('ast-x')] });

  assert.ok(html.includes('data-msg-id="ast-x"'), '流式末条空助手行必须挂载——否则直写锚点无处可生');
  assert.match(
    html,
    /<div id="msg-content-ast-x"[^>]*style="display:none"/,
    '空正文锚点必须以 display:none 隐形存在，供 tokenStreamWriter 首帧翻牌成 flex',
  );
});

test('非流式空助手行不得产出占位（守 b22147c）', () => {
  const html = render({ isStreaming: false, messages: [user(), assistant('ast-x')] });

  assert.ok(!html.includes('data-msg-id="ast-x"'), '非流式的空助手行必须整行跳过，不得留下空白占位块');
  assert.ok(!html.includes('id="msg-content-ast-x"'), '非流式空行更不允许产出正文锚点');
});

test('流式 + 工具先行 + 空正文：锚点隐形存在且工具锚点不受影响', () => {
  const toolCalls = [{ id: 't1', name: 'read_file', status: 'running', args: '{}' }];
  const html = render({
    isStreaming: true,
    messages: [user(), assistant('ast-x', { toolCalls })],
  });

  assert.ok(html.includes('id="msg-tools-ast-x"'), '工具锚点必须保留（增量补丁通道依赖它）');
  assert.match(
    html,
    /<div id="msg-content-ast-x"[^>]*style="display:none"/,
    '工具型回合的中间态同样需要正文锚点，且必须隐形',
  );
});

test('同一回合多条空助手行：只有流式末行挂锚点', () => {
  const html = render({
    isStreaming: true,
    messages: [user(), assistant('a1'), assistant('a2'), assistant('a3')],
  });

  assert.ok(html.includes('data-msg-id="a3"'), '末行必须挂载');
  assert.match(html, /<div id="msg-content-a3"[^>]*style="display:none"/, '末行必须有隐形锚点');
  assert.ok(!html.includes('id="msg-content-a1"'), '非末行空行不得挂锚点');
  assert.ok(!html.includes('id="msg-content-a2"'), '非末行空行不得挂锚点');
});

test('流式态工具不聚合：各行的工具留在各自 #msg-tools-*（守 TurnGroup 的 isStreaming 短路）', () => {
  const html = render({
    isStreaming: true,
    messages: [
      user(),
      assistant('a1', { content: '先', toolCalls: [{ id: 't1', name: 'read_file', status: 'completed', args: '{}' }] }),
      assistant('a2', { content: '后', toolCalls: [{ id: 't2', name: 'write_file', status: 'completed', args: '{}' }] }),
    ],
  });

  const firstRow = sliceByMessageId(html, 'a1');
  const secondRow = sliceByMessageId(html, 'a2');
  assert.ok(firstRow.includes('id="msg-tools-a1"'), 'a1 必须保留自己的工具锚点');
  assert.ok(secondRow.includes('id="msg-tools-a2"'), 'a2 必须保留自己的工具锚点');
  assert.ok(!firstRow.includes('write_file'), 'a1 不得持有 a2 的工具（一旦聚合，直写锚点会整体错位）');
});
