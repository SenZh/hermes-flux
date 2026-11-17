/**
 * 流式直写锚点定理（INV-STREAM-01）
 *
 * 设计意图 (Why)：`tokenStreamWriter` 只 patch 已存在的 `#msg-content-*`，它没有 render / mount
 *   能力。流式首帧的助手行必然「正文/思考/工具」全空，这个状态是每一轮对话的必经态。
 *   一旦 UI 层在空态把整行或正文容器 `return null`，锚点就永远不存在，后续每一帧直写全部空转，
 *   用户看到的是「思考完一次性铺满」——2026-11-07/11-09 两次「消除空白占位」改动正是这样
 *   把流式弄没了，且 630+ 单测全绿。
 *
 * 防范的历史坑 (Pitfall)：用可见空 div 补锚点会以另一种形态回潮空容器间距；
 *   用 `.conv-turn` 计数推断行是否渲染会把「回合外壳恒渲染」误判成「行渲染了」。
 *
 * 约束与规则 (Rules)：任意消息序列 × 流式开关下必须满足两条定理；
 *   修改 MessageRow / MarkdownBlock 的空行策略必须同步修订本套件，禁止缩小生成空间迎合。
 *
 * 【为何放在 ui 而不放 core】core 是零 React 依赖的纯逻辑层，本定理需要对 React SSR 产物断言，
 *   放进 core 会把 react 拽进 core 的依赖边界；ui 既有 react 依赖，又是该契约的源码所在。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 相对本文件定位 ui 产物，不依赖 cwd；Windows 下必须走 file:// URL
const UI_ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../dist/components-react/conversation/index.js',
);
const { ConversationStage } = await import(pathToFileURL(UI_ENTRY).href);

const baseSnapshot = { mode: 'scratchpad', connection: 'connected', messages: [], isStreaming: false };

function render(snapshot) {
  return renderToStaticMarkup(React.createElement(ConversationStage, { snapshot }));
}

/** 任意一条历史消息：正文/思考可空可非空，工具可有可无。 */
const arbHistoryMessage = fc.record({
  role: fc.constantFrom('user', 'assistant'),
  content: fc.string({ maxLength: 8 }),
  thought: fc.string({ maxLength: 5 }),
  hasTools: fc.boolean(),
});

/** 末条助手行：正文任意（含全空），这正是流式首帧的真实形态。 */
const arbTailAssistant = fc.record({
  content: fc.string({ maxLength: 6 }),
  thought: fc.string({ maxLength: 4 }),
  hasTools: fc.boolean(),
});

const toMessage = (spec, id) => ({
  id,
  role: spec.role ?? 'assistant',
  content: spec.content,
  thought: spec.thought,
  ...(spec.hasTools ? { toolCalls: [{ id: `${id}-t1`, name: 'read_file', status: 'completed', args: '{}' }] } : {}),
});

test('定理 27 [流式末行锚点存在性]: 任意历史 × 任意末条助手行，流式时恒有 #msg-content-*', async () => {
  // 【为何包一层 try/catch】fast-check 失败时只打印 "Property failed after…" 与 counterexample，
  // 不会透传断言文案；而证伪器（fake-test-killer）要求"变红的原因对得上"，必须把契约文案带出来。
  try {
    await fc.assert(
      fc.property(fc.array(arbHistoryMessage, { maxLength: 5 }), arbTailAssistant, (history, tail) => {
        const messages = [
          ...history.map((spec, index) => toMessage(spec, `h${index}`)),
          toMessage({ role: 'assistant', ...tail }, 'ast-tail'),
        ];
        const html = render({ ...baseSnapshot, messages, isStreaming: true });

        assert.ok(
          html.includes('id="msg-content-ast-tail"'),
          `流式末行必须产出直写锚点（正文="${tail.content}"，思考="${tail.thought}"，工具=${tail.hasTools}）`,
        );
      }),
      { numRuns: 300 },
    );
  } catch (error) {
    throw new Error(`流式末行必须产出直写锚点：${error instanceof Error ? error.message : String(error)}`);
  }
});

test('定理 28 [非流式空行不占位]: 正文/思考/工具全空的助手行，非流式时恒不产出消息节点', async () => {
  try {
    await fc.assert(
      fc.property(fc.array(arbHistoryMessage, { maxLength: 4 }), (history) => {
        const messages = [
          ...history.map((spec, index) => toMessage(spec, `h${index}`)),
          { id: 'ast-empty', role: 'assistant', content: '', thought: '' },
        ];
        const html = render({ ...baseSnapshot, messages, isStreaming: false });

        assert.ok(
          !html.includes('data-msg-id="ast-empty"'),
          '非流式空助手行必须整行跳过（守 89ca860 / b22147c 的间距意图）',
        );
      }),
      { numRuns: 300 },
    );
  } catch (error) {
    throw new Error(`非流式空助手行必须整行跳过：${error instanceof Error ? error.message : String(error)}`);
  }
});
