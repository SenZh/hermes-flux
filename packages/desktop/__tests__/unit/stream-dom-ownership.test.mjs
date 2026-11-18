/**
 * 流式 DOM 单所有者判定与正文显隐翻转（行为 + 装配守卫）
 *
 * 【设计意图 (Why)】
 *   `index.ts` 里这两条判定曾是裸内联代码，全库没有任何断言命中：
 *   1. `patchElement` 的三分支守卫决定「迟到的 rAF 工具补丁能否覆写 React 已收口的 `<ToolBlocks>`」；
 *   2. `setMessageContent` 的 display 翻转决定「收口瞬间回合会不会因 flex→block 边距折叠而长高」。
 *   两者都是「流式结束后视口跳上去」的成因，必须有可证伪的落盘测试。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 只判会话在流式就放行直写：同回合非末行被直写，收口后出现 `toolsChildren === 2`；
 *   2. 把 `display:none` 点亮成 `flex`：收口时 React 清内联样式触发 flex→block，
 *      回合高度突变（实测 dSh=+528px、dSt=0），视口被顶离底部。
 *
 * 【约束与规则 (Rules)】
 *   1. 断言必须能区分「删除守卫」「守卫恒真」「改成 flex」三类变异，禁止恒等断言；
 *   2. 装配守卫只读源码文本，禁止运行期 mock 倒推。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  revealStreamingContentDisplay,
  shouldPatchStreamingTools,
} from '../../dist/renderer/stream/streamDomOwnership.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererIndexSource = readFileSync(
  path.resolve(__dirname, '../../src/renderer/index.ts'),
  'utf8',
);

test('工具补丁单所有者判定：四象限必须全部可区分', async (t) => {
  await t.test('1. 流式活跃 + 目标即活跃消息：允许直写', () => {
    assert.equal(
      shouldPatchStreamingTools({
        isStreamingActive: true,
        activeStreamingMessageId: 'ast-1',
        messageId: 'ast-1',
      }),
      true,
      '活跃流式末行由 toolPatchQueue 独占 DOM，必须放行',
    );
  });

  await t.test('2. 会话已收口 + 迟到补丁：必须让位给 React', () => {
    assert.equal(
      shouldPatchStreamingTools({
        isStreamingActive: false,
        activeStreamingMessageId: 'ast-1',
        messageId: 'ast-1',
      }),
      false,
      '收口后 React 已挂载 <ToolBlocks>，迟到 rAF 直写会造成 toolsChildren === 2',
    );
  });

  await t.test('3. 流式活跃但不是目标行：同回合其它行必须让位', () => {
    assert.equal(
      shouldPatchStreamingTools({
        isStreamingActive: true,
        activeStreamingMessageId: 'ast-2',
        messageId: 'ast-1',
      }),
      false,
      '仅活跃流式消息拥有直写所有权，其余行由 React 渲染',
    );
  });

  await t.test('4. 无在途流式消息（null）：任何目标一律拒绝', () => {
    assert.equal(
      shouldPatchStreamingTools({
        isStreamingActive: true,
        activeStreamingMessageId: null,
        messageId: 'ast-1',
      }),
      false,
      'activeStreamingMessageId 为空时不存在合法所有者',
    );
  });
});

test('流式正文显隐翻转：只允许 none → block', async (t) => {
  await t.test('1. 隐形态点亮为 block，且绝不产生 flex / flexDirection', () => {
    const style = { display: 'none' };
    revealStreamingContentDisplay(style);
    assert.equal(style.display, 'block', '首写必须点亮为块级，与 .conv-markdown 默认布局一致');
    assert.equal('flexDirection' in style, false, '严禁写入 flexDirection');
  });

  await t.test('2. 已是可见态时不得覆盖既有 display', () => {
    const style = { display: 'inline-block' };
    revealStreamingContentDisplay(style);
    assert.equal(style.display, 'inline-block', '非 none 的既有布局语义必须原样保留');
  });

  await t.test('3. 已有 block 时重复调用保持幂等', () => {
    const style = { display: 'block' };
    revealStreamingContentDisplay(style);
    revealStreamingContentDisplay(style);
    assert.equal(style.display, 'block');
  });

  await t.test('4. 空 display（未设置）不视为隐形态', () => {
    const style = { display: '' };
    revealStreamingContentDisplay(style);
    assert.equal(style.display, '', '空值不得被判为 none，避免无谓内联样式写入');
  });
});

test('装配守卫：index.ts 必须复用纯函数，禁止把判定内联回去', async (t) => {
  await t.test('1. patchElement 必须走 shouldPatchStreamingTools', () => {
    const calls = rendererIndexSource.match(/shouldPatchStreamingTools\(\{/g) ?? [];
    assert.equal(calls.length, 1, `直写守卫必须且只能有一处委托，实际 ${calls.length} 处`);
    assert.equal(
      /activeStreamingMessageId\s*!==\s*messageId/.test(rendererIndexSource),
      false,
      '禁止恢复裸 ID 比较，否则守卫与单测脱钩',
    );
  });

  await t.test('2. setMessageContent 必须走 revealStreamingContentDisplay', () => {
    const calls = rendererIndexSource.match(/revealStreamingContentDisplay\(/g) ?? [];
    assert.equal(calls.length, 1, `正文点亮必须且只能有一处委托，实际 ${calls.length} 处`);
    assert.equal(
      /style\.display\s*=\s*'flex'/.test(rendererIndexSource),
      false,
      '禁止把正文容器点亮成 flex（收口边距折叠会撑高回合）',
    );
    assert.equal(
      /style\.flexDirection/.test(rendererIndexSource),
      false,
      '禁止写 flexDirection（tokenStreamWriter 与入口层同源约束）',
    );
  });
});
