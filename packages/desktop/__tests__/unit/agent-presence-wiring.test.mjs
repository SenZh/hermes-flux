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

  await t.test('9. 布局偏好：键名必须声明在 state 之前（否则冷启动恒回 stage）', () => {
    const src = read(RENDERER);
    const keyDecl = src.indexOf("const PRESENCE_LAYOUT_STORAGE_KEY");
    const stateDecl = src.indexOf('const state: AppState = {');
    assert.ok(keyDecl >= 0, '必须存在布局偏好持久化键');
    assert.ok(stateDecl >= 0, '必须存在 state 初始化');
    /*
     * 【真实缺陷回归】键名声明在 state 之后时，打包成 var 后 state 初始化读到 undefined，
     *   `localStorage.getItem(undefined)` 恒为 null → 用户选了 dock，重启后又跳回顶部。
     *   这条断言锁死声明顺序。
     */
    assert.ok(
      keyDecl < stateDecl,
      'PRESENCE_LAYOUT_STORAGE_KEY 必须声明在 state 初始化之前，否则冷启动读不到已保存的布局',
    );
    // 读取失败不得静默：只有 localStorage 不可用时才回落，且必须留痕
    const readStart = src.indexOf('function readPresenceLayout');
    const readBody = src.slice(readStart, src.indexOf('\n}', readStart));
    assert.ok(readBody.includes('console.warn'), '读取失败必须留痕，禁止空 catch 吞掉');
    assert.ok(readBody.includes("'dock'"), '必须识别 dock');
    assert.ok(readBody.includes("'stage'"), '缺省必须回落 stage');
  });

  await t.test('10. host 定位：dock 必须插进输入舱首位，stage 必须回到 pod 的流之后', () => {
    const src = read(RENDERER);
    const fnStart = src.indexOf('function ensureAgentPresenceHost');
    assert.ok(fnStart >= 0, '必须存在 host 定位函数');
    const body = src.slice(fnStart, src.indexOf('\nfunction ', fnStart + 10));
    assert.ok(
      body.includes('dock.insertBefore(host, dock.firstElementChild)'),
      'dock 变体必须把 host 插到 .input-dock-container 首位（否则贴不住输入舱上沿）',
    );
    assert.ok(body.includes('presence-host--dock'), 'dock 变体必须加 presence-host--dock 类');
    assert.ok(
      body.includes('classList.remove(\'presence-host--dock\')'),
      '切回 stage 必须移除 dock 类，否则样式残留绝对定位',
    );
    assert.ok(body.includes('#conversation-stream'), 'stage 回落位置必须在对话流之后（放流内会被整块销毁）');
  });

  await t.test('11. 输入舱变更后必须重校宿主（三条路径同一出口）', () => {
    const src = read(RENDERER);
    /*
     * 【真实缺陷回归】dock 变体的 host 是输入舱首子节点，断连移除 / outerHTML 替换 /
     *   首次新建三条路径都会连带销毁它。重校若写进某一条分支，另外两条就会让指示器
     *   永久消失；若三条分支各写一次，又无法证明没有遗漏。
     *   契约因此收敛为：三条路径合进一个 `applyInputDockUpdate()`，
     *   调用之后紧跟唯一一次 `syncAgentPresenceHost()`。
     */
    const fnStart = src.indexOf('const applyInputDockUpdate = (): void => {');
    assert.ok(fnStart >= 0, '三条输入舱变更路径必须收敛到 applyInputDockUpdate');
    const rawFnBody = src.slice(fnStart, src.indexOf('\n    };', fnStart));
    // 剥注释：注释里也写了这三个调用名，不剥的话「把真实代码删掉只留注释」也能全绿
    const fnBody = rawFnBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    assert.ok(fnBody.includes('existingDock.remove()'), '断连移除路径必须在同一出口内');
    assert.ok(fnBody.includes('existingDock.outerHTML = nextDockHtml'), '整块替换路径必须在同一出口内');
    assert.ok(fnBody.includes('insertAdjacentHTML'), '首次新建路径必须在同一出口内');

    // 调用点必须紧跟在出口函数之后，且中间不得插入分支判断
    const callAt = src.indexOf('    applyInputDockUpdate();');
    assert.ok(callAt >= 0, '必须存在唯一调用点');
    const afterCall = src.slice(callAt, callAt + 2000);
    // 剥掉注释再比对，避免注释文字干扰（注释里也出现了这两个函数名）
    const stripped = afterCall.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    assert.ok(
      /^ {4}applyInputDockUpdate\(\);\s* {4}syncAgentPresenceHost\(\);\s* {4}syncAgentPresence\(\);/.test(stripped),
      'applyInputDockUpdate() 之后必须紧跟 syncAgentPresenceHost() 与 syncAgentPresence()，中间不得有分支',
    );

    // 重校不得只出现在某条分支内部：分支块内不允许出现重校调用
    const branchBody = /else if \(dockChanged && nextDockHtml\) \{([\s\S]*?)\n\s{6}\}/.exec(src)?.[1] ?? '';
    assert.ok(branchBody.length > 0, '必须能定位到整块替换分支');
    assert.ok(!branchBody.includes('syncAgentPresenceHost'), '重校禁止写进单个分支内（另外两条路径会被漏掉）');

    assert.ok(
      src.includes('agentPresenceHost?.isConnected'),
      'syncAgentPresence 必须校验宿主存活，否则会往脱离文档的 root 持续渲染',
    );
  });

  await t.test('12. 指纹必须真的带上快照里的布局值（不得写成常量）', () => {
    const src = read(RENDERER);
    const fnStart = src.indexOf('function agentPresenceFingerprint');
    const body = src.slice(fnStart, src.indexOf('\nfunction ', fnStart + 10));
    /*
     * 【变异杀伤力】`layout: 'stage'`（常量）同样满足「函数体里出现 layout」，
     *   但切到 dock 后指纹不变、组件永远按 stage 变体渲染。必须断言取值来自 snapshot。
     */
    assert.ok(
      /layout:\s*snapshot\.layout\s*\?\?\s*'stage'/.test(body),
      '指纹里的 layout 必须取自 snapshot.layout，禁止写死常量',
    );
    assert.ok(!/layout:\s*'stage'\s*[,}]/.test(body), '指纹不得把 layout 写成固定 stage');
  });

  await t.test('13. 设置动作必须写盘并清掉宿主引用（否则切换后不重挂）', () => {
    const src = read(RENDERER);
    const fnStart = src.indexOf('onPresenceLayoutChange:');
    assert.ok(fnStart >= 0, '必须存在布局切换动作');
    const body = src.slice(fnStart, src.indexOf('},', fnStart) + 2);
    assert.ok(body.includes('writePresenceLayout'), '切换必须持久化，否则重启丢失');
    assert.ok(body.includes('agentPresenceHost = null'), '切换必须清宿主引用，否则 host 换了也不重挂');
    assert.ok(body.includes('lastAgentPresenceFingerprint'), '切换必须清指纹，否则新布局首帧被去重吞掉');
    assert.ok(body.includes('render()'), '切换必须触发一次渲染');
  });

  await t.test('14. 未连接网关时不得渲染在场指示器（首屏会压住 onboarding 卡片）', () => {
    const src = read(RENDERER);
    const fnStart = src.indexOf('function ensureAgentPresenceHost');
    assert.ok(fnStart >= 0, '必须存在 host 定位函数');
    const body = src.slice(fnStart, src.indexOf('\nfunction ', fnStart + 10));
    /*
     * 【真实缺陷回归】未连接网关的首屏只有 onboarding 卡片，而 stage 指示器悬浮在
     *   对话区顶部：真实 Blink 实测卡片顶边 107px、指示器底边 160px，文案压在卡片标题上。
     *   没有连接就没有「在场者」，因此必须整段早退，而不是渲染一条假状态。
     */
    assert.ok(
      /if \(!state\.gatewayConnected\) \{/.test(body),
      '连接态守卫必须是函数开头的早退分支（不是分支内的条件渲染）',
    );
    assert.ok(body.includes('presenceMountHandle?.unmount()'), '未连接必须卸载 React root，不能只隐藏');
    assert.ok(body.includes('agentPresenceHost?.remove()'), '未连接必须移除 host 节点，否则残留在 pod 里');
    assert.ok(body.includes('ensurePresenceTicker(\'idle\')'), '未连接必须把节拍器停到 idle，禁止空转');
    /*
     * 【六处状态必须一起清 (Rules)】只卸载 DOM 是不够的：宿主引用、待渲染快照、
     *   指纹任一残留，重连后都会走「引用相同 → 直接 return」或「指纹相同 → 去重」，
     *   指示器静默不出现。三处引用一并断言。
     */
    assert.ok(body.includes('agentPresenceHost = null'), '必须清宿主引用（否则重连后引用比对误判已挂载）');
    assert.ok(body.includes('pendingPresenceSnapshot = null'), '必须清待渲染快照');
    assert.ok(body.includes("lastAgentPresenceFingerprint = ''"), '必须清指纹（否则重连首帧被去重吞掉）');

    /*
     * 【守卫必须用 ensure 的返回值 (Rules)】MiddlePod 模板里有一个同 id 的静态空宿主；
     *   `syncAgentPresenceHost` 若在 ensure 之后再 `getElementById` 取一次，未连接时
     *   ensure 返回的 null 会被那个空 div 覆盖，守卫等于没写。这条断言锁死单次取值。
     */
    const syncStart = src.indexOf('function syncAgentPresenceHost');
    assert.ok(syncStart >= 0, '必须存在 syncAgentPresenceHost');
    const syncBody = src.slice(syncStart, src.indexOf('\nfunction ', syncStart + 10));
    assert.ok(
      syncBody.includes('const presenceHost = ensureAgentPresenceHost(state.presenceLayout)'),
      'syncAgentPresenceHost 必须直接使用 ensure 的返回值',
    );
    assert.ok(
      !syncBody.includes("document.getElementById('react-conv-presence-host')"),
      '禁止在 ensure 之后再次 getElementById：模板静态空宿主会让未连接守卫失效',
    );
  });
});
