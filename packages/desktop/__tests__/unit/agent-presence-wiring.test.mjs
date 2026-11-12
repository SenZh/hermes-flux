/**
 * 在场指示器宿主接线守卫（packages/desktop/__tests__/unit/agent-presence-wiring.test.mjs）
 *
 * 【测试什么】宿主侧新增的在场接线是否满足四条不变量：
 *   1. host 挂在 pod 层而非滚动流内（否则画布整块替换时被销毁）；
 *   2. 快照指纹不包含 sinceMs / 正文（否则去重失效，流式期间每帧都协调 React 树）；
 *   3. 终态 TTL 定时器重复触发时先 clearTimeout（否则旧定时器提前清掉新终态）；
 *   4. 群聊说话者只在回合运行时非 null（否则高亮一个没在干活的人）。
 *
 * 【为什么用源码守卫而非运行时挂载】renderer/index.ts 是 1 万行的浏览器入口，
 *   顶层就有 `document.getElementById` 与 `window.hermesDesktop` 访问，无法在 node 里 import。
 *   仓库已有同一范式（`interactive-stage-wiring-guard.test.mjs`），这里沿用。
 *   纯领域逻辑本身（说话者归一化、工具分类、状态投影）已下沉到 core 并有真单测覆盖。
 *
 * 【变异杀伤力】把 host 移进 #conversation-stream、把 sinceMs 加进指纹、
 *   删掉 clearTimeout、把说话者改成无条件读 state，对应用例立刻变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const RENDERER = 'packages/desktop/src/renderer/index.ts';
const MIDDLE_POD = 'packages/ui/src/components/MiddlePod/MiddlePod.ts';

test('在场指示器宿主接线守卫', async (t) => {
  await t.test('1. host 挂在 pod 层，且不在 #conversation-stream 内部', () => {
    const html = read(MIDDLE_POD);
    assert.ok(html.includes('react-conv-presence-host'), '模板必须提供在场指示器 host');

    const streamOpen = html.indexOf('id="conversation-stream"');
    const presenceHost = html.indexOf('react-conv-presence-host');
    assert.ok(streamOpen >= 0, '必须存在 #conversation-stream');
    assert.ok(
      presenceHost > streamOpen,
      'host 必须在 #conversation-stream 之后声明（放流内会被 renderConversationCanvas 整块销毁）',
    );
  });

  await t.test('2. 快照指纹不得包含 sinceMs 与正文（否则去重失效）', () => {
    const src = read(RENDERER);
    const fnStart = src.indexOf('function agentPresenceFingerprint');
    assert.ok(fnStart >= 0, '必须存在指纹函数');
    // 取函数体到下一个顶层函数声明之前
    const body = src.slice(fnStart, src.indexOf('\nfunction ', fnStart + 10));
    assert.ok(body.length > 0, '指纹函数体不得为空');
    assert.ok(!body.includes('sinceMs'), '指纹不得包含 sinceMs（每毫秒都变，等于关掉去重）');
    assert.ok(!body.includes('.content'), '指纹不得包含正文（流式 token 每帧都变）');
    assert.ok(body.includes('tone'), '指纹必须包含语气档，它是时长跨档的唯一可感知变化');
    assert.ok(body.includes('presence.kind'), '指纹必须包含状态种类');
  });

  await t.test('3. 终态 TTL 必须成对：arm 内先 clearTimeout，clear 内也清定时器', () => {
    const src = read(RENDERER);
    const armStart = src.indexOf('function armPresenceTerminal');
    assert.ok(armStart >= 0, '必须存在终态装填函数');
    const armBody = src.slice(armStart, src.indexOf('\nfunction ', armStart + 10));
    assert.ok(armBody.includes('clearTimeout'), '重复触发终态必须先 clearTimeout 旧定时器，否则旧定时器会提前清掉新终态');
    assert.ok(armBody.includes('setTimeout'), '必须装填 TTL 定时器');

    const clearStart = src.indexOf('function clearPresenceTerminal');
    assert.ok(clearStart >= 0, '必须存在终态清理函数');
    const clearBody = src.slice(clearStart, src.indexOf('\nfunction ', clearStart + 10));
    assert.ok(clearBody.includes('clearTimeout'), '清理必须同时清掉定时器，禁止只清 state');
    assert.ok(clearBody.includes('presenceTerminal'), '清理必须清掉 state 字段');
  });

  await t.test('4. 群聊说话者只在回合运行时非 null', () => {
    const src = read(RENDERER);
    assert.ok(
      /speaker:\s*domain\.isRunning\s*\?\s*\(state\.activeGroupSpeaker\s*\?\?\s*null\)\s*:\s*null/.test(src),
      '说话者必须在回合未运行时强制 null，否则会高亮一个早已说完话的成员',
    );
  });

  await t.test('5. 群聊运行态必须读 activeRunningGroupRoomIds 而非单聊的 isStreaming', () => {
    const src = read(RENDERER);
    const fnStart = src.indexOf('function resolvePresenceDomain');
    assert.ok(fnStart >= 0, '必须存在运行态裁决函数');
    const body = src.slice(fnStart, src.indexOf('\nfunction ', fnStart + 10));
    assert.ok(body.includes('activeRunningGroupRoomIds'), '群聊回合从不写 state.isStreaming，必须读自己的运行集合');
    assert.ok(body.includes('isStreamingActiveForCurrentSession'), '单聊仍走既有判定');
  });

  await t.test('6. 节拍器必须在 idle 时停止（禁止无条件常驻 setInterval）', () => {
    const src = read(RENDERER);
    const fnStart = src.indexOf('function ensurePresenceTicker');
    assert.ok(fnStart >= 0, '必须存在节拍器函数');
    const body = src.slice(fnStart, src.indexOf('\nfunction ', fnStart + 10));
    assert.ok(body.includes("kind !== 'idle'"), '只有非 idle 才运行节拍器');
    assert.ok(body.includes('clearInterval'), '进入 idle 必须清掉定时器，禁止空转');
  });

  await t.test('7. 旧真值面必须已删除（双真值面是本 PR 要消灭的缺陷）', () => {
    for (const rel of [RENDERER, 'packages/ui/src/components/InputDock/InputDock.ts']) {
      const src = read(rel);
      // 注释里允许出现历史说明，故剥注释后断言
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
      assert.ok(!code.includes('updateActivityPill'), `${rel} 不得残留 updateActivityPill`);
      assert.ok(!code.includes('agentActivityStatus'), `${rel} 不得残留 agentActivityStatus`);
      assert.ok(!code.includes('agent-activity-pill'), `${rel} 不得残留 agent-activity-pill`);
      assert.ok(!code.includes('activityStatus'), `${rel} 不得残留 activityStatus`);
    }
  });

  await t.test('8. 页面隐藏时必须写入 data-app-hidden（否则 CSS 暂停规则是死代码）', () => {
    const src = read(RENDERER);
    assert.ok(
      src.includes('dataset.appHidden'),
      'CSS 的 html[data-app-hidden="true"] 暂停规则需要宿主写入该属性，否则形变/环/光晕在后台继续跑',
    );
  });
});
