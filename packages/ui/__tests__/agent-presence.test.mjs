/**
 * Agent 在场指示器 · 表现层契约测试
 *
 * 【测试什么】用户在指示器上真正能读到的东西：状态钩子、时长语气、工具目标裁剪、
 *   打字波、终态降级、群聊说话者与溢出、以及「零内联 style / 零裸色值」与样式守卫。
 * 【不测什么】像素几何与动画观感（由 CDP 用例负责）；core 的优先级与分层（已由
 *   packages/core/__tests__/agent/agentPresence.test.mjs 覆盖）。
 *
 * 【变异杀伤力】每条断言都对应实现的一条分支或一条工程约束：
 *   把 tone 换成常量、把路径裁剪去掉、把 speaker 未知时的降级改成「猜第一个」、
 *   把 style={{ 加回来、把 --presence-beat 改名，对应断言立刻变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentPresence } from '../dist/components-react/AgentPresence.js';
import { t as translate } from '../dist/i18n/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

/** 单聊身份：默认被测主体 */
const SOLO = { kind: 'solo', name: 'flux-agent', displayName: 'Flux Agent' };

/** 群聊身份：4 位成员，speaker 可覆盖 */
const GROUP = {
  kind: 'group',
  members: ['小发王', '审查员', '测试员', '架构师'],
  speaker: '小发王',
  profiles: [
    { name: '小发王', displayName: '小发王' },
    { name: '审查员', displayName: '审查员' },
    { name: '测试员', displayName: '测试员' },
    { name: '架构师', displayName: '架构师' },
  ],
};

function render(presence, identity = SOLO) {
  return renderToStaticMarkup(React.createElement(AgentPresence, { snapshot: { presence, identity } }));
}

/** 从 HTML 中按 class 切出全部元素的属性片段（不含嵌套内容），用于逐槽位断言 */
function avatarAttrs(html) {
  return [...html.matchAll(/<span class="conv-presence__avatar[^"]*"([^>]*)>/g)].map((m) => m[1]);
}

test('在场指示器 · 14 条表现层契约', async (t) => {
  await t.test('1. idle：data-presence=idle、头像常驻、文案行高度归零但节点常驻', () => {
    const html = render({ kind: 'idle' });
    assert.ok(html.includes('data-presence="idle"'), 'idle 必须写在 data-presence 上');
    assert.ok(html.includes('conv-presence__avatar'), 'idle 头像必须常驻，不能整条退场');
    // 【规则】文案节点必须常驻并标 data-empty：整节点卸载会让容器高度从 84px
    //   瞬间塌到 56px，在对话区顶部造成一次布局弹跳（样式审查 P1-3）。
    assert.ok(html.includes('data-empty="true"'), 'idle 文案行必须以 data-empty 标记，不能卸载节点');
    assert.ok(!html.includes('conv-presence__verb'), 'idle 不得渲染任何状态文案');
  });

  await t.test('2. thinking 时长分层：0s→fresh、9s→patient、31s→long', () => {
    const fresh = render({ kind: 'thinking', sinceMs: 0 });
    assert.ok(fresh.includes('data-tone="fresh"'), '0ms 必须落在 fresh 档');
    assert.ok(fresh.includes(translate('presence.thinking.fresh')), 'fresh 文案必须来自 i18n 字典');

    const patient = render({ kind: 'thinking', sinceMs: 9000 });
    assert.ok(patient.includes('data-tone="patient"'), '9s 必须升到 patient 档');
    assert.ok(patient.includes(translate('presence.thinking.patient')), 'patient 文案必须切换');

    const long = render({ kind: 'thinking', sinceMs: 31000 });
    assert.ok(long.includes('data-tone="long"'), '31s 必须升到 long 档');
    assert.ok(long.includes(translate('presence.thinking.long')), 'long 文案必须切换');
  });

  await t.test('3. tool 目标裁剪：路径只留末两段，不得出现全路径', () => {
    const html = render({
      kind: 'tool',
      tool: 'read',
      target: 'packages/core/src/gateway.ts',
      runningCount: 1,
      sinceMs: 0,
    });
    assert.ok(html.includes('core/gateway.ts'), '路径型目标必须保留末两段');
    assert.ok(!html.includes('packages/core/src/gateway.ts'), '不得输出完整路径');
    assert.ok(html.includes('conv-presence__target'), 'tool 态必须渲染目标片段');
  });

  await t.test('4. tool 命令截断：60 字符命令必须以省略号收尾', () => {
    const command = 'x'.repeat(60);
    const html = render({ kind: 'tool', tool: 'command', target: command, runningCount: 1, sinceMs: 0 });
    const shown = /<span class="conv-presence__target">([^<]*)<\/span>/.exec(html)?.[1] ?? '';
    assert.ok(shown.endsWith('…'), `命令目标必须以省略号收尾，实际为「${shown}」`);
    assert.ok(shown.length <= 41, '截断后长度必须收敛到 40 字符 + 省略号');
  });

  await t.test('5. writing：渲染三根打字波竖条', () => {
    const html = render({ kind: 'writing', sinceMs: 0 });
    assert.ok(html.includes('conv-presence__bars'), 'writing 态必须渲染打字波');
    const bars = /<span class="conv-presence__bars"[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1] ?? '';
    assert.equal((bars.match(/<i><\/i>/g) || []).length, 3, '打字波必须恰好三根竖条');
  });

  await t.test('6. delegating：有 profile 用实名，空 profile 走匿名降级', () => {
    const named = render({ kind: 'delegating', profile: 'flux-code-reviewer', count: 1 });
    assert.ok(named.includes('flux-code-reviewer'), '必须点名子代理 profile');
    assert.ok(named.includes(translate('presence.delegating', { profile: 'flux-code-reviewer' })));

    const anonymous = render({ kind: 'delegating', profile: '', count: 1 });
    assert.ok(
      anonymous.includes(translate('presence.delegatingAnonymous')),
      'profile 为空必须走 presence.delegatingAnonymous，不得留空占位',
    );
  });

  await t.test('7. failed：不眨眼，长 message 截断后以省略号收尾', () => {
    const message = 'y'.repeat(80);
    const html = render({ kind: 'failed', message });
    // 【规则】只断言 data-blinkable：SSR 下 usePresenceTicker 恒返回 false，
    //   任何状态的 data-blink 都是 "false"，断言它等于恒真断言，无杀伤力。
    assert.ok(html.includes('data-blinkable="false"'), '终态必须关闭眨眼');
    const shown = message.slice(0, 60);
    assert.ok(html.includes(shown), '必须包含截断后的前 60 字符');
    assert.ok(html.includes(`${shown}…`), '超长 message 必须以省略号收尾');
  });

  await t.test('8. interrupted：不眨眼，文案为已停手', () => {
    const html = render({ kind: 'interrupted' });
    assert.ok(html.includes('data-blinkable="false"'), '中断态必须关闭眨眼');
    assert.ok(html.includes(translate('presence.interrupted')), '文案必须是 presence.interrupted');
  });

  await t.test('9. 群聊 speaker 已知：最左为说话者并加前缀', () => {
    const html = render({ kind: 'thinking', sinceMs: 0 }, GROUP);
    const attrs = avatarAttrs(html);
    assert.equal(attrs.length, 4, '4 位成员必须渲染 4 个头像槽位');
    assert.ok(attrs[0].includes('data-speaker="true"'), '第一个头像必须是说话者');
    assert.ok(attrs[0].includes('data-lead="true"'), '说话者必须置最左（lead）');
    assert.ok(attrs[1].includes('data-speaker="false"'), '其余成员不得标记为说话者');
    assert.ok(attrs[1].includes('data-lead="false"'), '其余成员只挂极轻呼吸');
    // 环与光晕只挂最左：多个成员各转一个环会立刻变成多个焦点（D6 裁定）
    assert.equal((html.match(/conv-presence__ring/g) || []).length, 1, '群聊只允许一个活动环');
    assert.equal((html.match(/conv-presence__halo/g) || []).length, 1, '群聊只允许一个光晕');
    assert.ok(html.includes('conv-presence__prefix'), '已知说话者必须渲染名字前缀');
    assert.ok(html.includes('小发王'), '前缀必须含说话者名');
  });

  await t.test('10. 群聊 speaker 为 null：全员不高亮且不加前缀', () => {
    const html = render({ kind: 'thinking', sinceMs: 0 }, { ...GROUP, speaker: null });
    const attrs = avatarAttrs(html);
    assert.equal(attrs.length, 4);
    for (const [index, attr] of attrs.entries()) {
      assert.ok(attr.includes('data-speaker="false"'), `第 ${index + 1} 个头像必须 data-speaker=false`);
    }
    assert.ok(!html.includes('conv-presence__prefix'), '说话者未知时绝不加前缀，禁止伪造身份');
    assert.ok(!html.includes('conv-presence__sep'), '说话者未知时不得渲染分隔符');

    // 说话者字段有值但成员列表里查无此人（成员已退出 / 事件乱序）同样必须降级：
    // 否则界面会出现一个指向不存在头像的人名前缀。
    const ghost = render({ kind: 'thinking', sinceMs: 0 }, { ...GROUP, speaker: '已退出的成员' });
    for (const attr of avatarAttrs(ghost)) {
      assert.ok(attr.includes('data-speaker="false"'), '说话者不在成员列表时必须全员降级');
    }
    assert.ok(!ghost.includes('conv-presence__prefix'), '说话者不在成员列表时不得渲染前缀');
  });

  await t.test('11. 群聊溢出：5 人渲染 4 槽位，末位为 +2 计数块', () => {
    const html = render(
      { kind: 'thinking', sinceMs: 0 },
      { ...GROUP, members: ['小发王', '审查员', '测试员', '架构师', '运维'], speaker: '小发王' },
    );
    const attrs = avatarAttrs(html);
    assert.equal(attrs.length, 4, '溢出时必须收敛到 4 个槽位');
    assert.ok(html.includes('conv-presence__avatar--more'), '第 4 位必须是计数块');
    assert.ok(html.includes('>+2<'), '5 人时计数块文案必须是 +2');
  });

  await t.test('12. 单聊：不渲染前缀，data-mode=solo', () => {
    const html = render({ kind: 'thinking', sinceMs: 0 });
    assert.ok(html.includes('data-mode="solo"'), '单聊必须标记 solo');
    assert.ok(!html.includes('conv-presence__prefix'), '单聊没有第二个人，不得渲染前缀');
  });

  await t.test('12b. 空片段不渲染：long 档工具文案不得出现空 verb', () => {
    // long 档模板形如「{target} 跑了有些久」，动词在目标之后，verbBefore 是空串。
    // 空 span 虽宽 0，仍会在 gap:6px 的 flex 容器里多贡献一个间隙。
    const html = render({
      kind: 'tool',
      tool: 'command',
      target: 'pnpm run verify',
      runningCount: 1,
      sinceMs: 31_000,
    });
    const verbs = [...html.matchAll(/<span class="conv-presence__verb">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
    assert.ok(verbs.length > 0, 'long 档必须渲染目标之后的动词');
    for (const verb of verbs) {
      assert.ok(verb.trim().length > 0, '不得渲染空 verb 片段');
    }
  });

  await t.test('12c. 读屏语义：根节点必须有 role=status 与 aria-label', () => {
    const html = render({ kind: 'thinking', sinceMs: 0 });
    assert.ok(html.includes('role="status"'), '根节点必须是活区，读屏器才能播报状态变化');
    assert.ok(html.includes(`aria-label="${translate('presence.aria')}"`), 'aria-label 必须走 i18n 字典');
  });

  await t.test('12d. 空目标不渲染：target 为空串时不得出现空 span', () => {
    // 与 12b 同类问题：.conv-presence__text 是 gap:6px 的 flex，空 span 多贡献 6px 间隙
    const html = render({ kind: 'tool', tool: 'read', target: '', runningCount: 1, sinceMs: 0 });
    const targets = [...html.matchAll(/<span class="conv-presence__target">([\s\S]*?)<\/span>/g)];
    for (const [, inner] of targets) {
      assert.ok(inner.trim().length > 0, '不得渲染空目标片段');
    }
  });

  await t.test('12e. 群聊成员表为空：退化为单聊形态，不得渲染空 avatars 容器', () => {
    const html = render({ kind: 'thinking', sinceMs: 0 }, { ...GROUP, members: [], speaker: null });
    assert.ok(html.includes('data-mode="solo"'), '空成员表必须退化 solo，否则文案浮在无主体的位置');
    const avatars = /<div class="conv-presence__avatars"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    assert.ok(avatars.includes('conv-presence__avatar'), '必须至少渲染一个兜底头像');
    assert.ok(!html.includes('conv-presence__prefix'), '空成员表不得渲染说话者前缀');
  });

  await t.test('13. 源码守卫：零内联 style、零裸色值', () => {
    const src = read('packages/ui/src/components-react/AgentPresence.tsx');
    // 注释里允许出现「禁止 style={{...}}」这类说明，故先剥注释再断言
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    assert.ok(!code.includes('style={{'), '组件内禁止任何内联 style');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), '组件内禁止十六进制色值');
    assert.ok(!/\brgba?\(/.test(code), '组件内禁止 rgb/rgba');
    assert.ok(!/\bhsla?\(/.test(code), '组件内禁止 hsl');
  });

  await t.test('14. CSS 守卫：主时钟、侧头关键帧、减动效与隐藏即停', () => {
    const css = read('packages/ui/src/styles/conversation.css');
    assert.ok(css.includes('--presence-beat'), '必须存在共用主时钟 --presence-beat');
    assert.ok(css.includes('@keyframes convPresenceTilt'), 'thinking 侧头关键帧必须存在');
    assert.ok(css.includes('html[data-app-hidden="true"] .conv-presence'), '页面隐藏必须暂停动画');

    // 【减动效必须真的生效 (Rules)】只断言「某个 reduced 块里含 .conv-presence」是假绿：
    //   状态形变规则的特异性 (0,3,0) / 群聊 ambient (0,5,0) 都高于 reduced 块的 (0,2,0)，
    //   而媒体查询不贡献特异性——不加 !important 时，最耗合成器的头像形变会继续无限运行。
    const reducedBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map(
      (m) => m[1],
    );
    const presenceBlock = reducedBlocks.find((block) => block.includes('.conv-presence'));
    assert.ok(presenceBlock, '减动效块内必须包含 .conv-presence');
    assert.ok(
      /\.conv-presence__face[\s\S]{0,200}?animation:\s*none\s*!important/.test(presenceBlock),
      '头像形变的 animation: none 必须带 !important，否则输给状态形变的高特异性选择器',
    );
    assert.ok(
      /data-mode="group"[\s\S]{0,160}?\.conv-presence__face[\s\S]{0,80}?animation:\s*none\s*!important/.test(
        presenceBlock,
      ),
      '群聊非说话者的 ambient 呼吸同样必须被 !important 停掉',
    );

    // 【后台暂停必须真的生效 (Rules)】状态规则用 animation shorthand，会隐式重置
    //   animation-play-state 回 running；长写 paused 不加 !important 会被压制。
    assert.ok(
      /html\[data-app-hidden="true"\][\s\S]{0,240}?animation-play-state:\s*paused\s*!important/.test(css),
      'data-app-hidden 的 animation-play-state: paused 必须带 !important',
    );
  });

  await t.test('15. 文案行：可收缩项与安全居中（防止两端硬裁）', () => {
    const css = read('packages/ui/src/styles/conversation.css');
    // text-overflow 对 flex 容器无效；flex 子项默认 min-width:auto 不会收缩。
    // 缺 min-width:0 时长路径会把行宽顶爆，再叠加居中就变成两端同时被裁。
    const targetBlock = /\.conv-presence__target \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    assert.ok(targetBlock.includes('min-width: 0'), '可收缩的 target 必须有 min-width: 0，否则省略号不生效');
    assert.ok(
      /justify-content:\s*safe center/.test(css),
      '文案行必须用 safe center：溢出时退回 start，保证左侧动词不被裁掉',
    );
    // 间距必须落在 4px 网格
    const textBlock = /\.conv-presence__text \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    assert.ok(!/gap:\s*6px/.test(textBlock), 'gap: 6px 落在 4px 网格外');
  });

  await t.test('16. 打字波用 transform 而非 height（避免逐帧 layout）', () => {
    const css = read('packages/ui/src/styles/conversation.css');
    const wave = /@keyframes convPresenceWave \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    assert.ok(wave.includes('scaleY'), '打字波必须用 transform: scaleY 驱动');
    assert.ok(!/\bheight\s*:/.test(wave), '打字波关键帧内禁止逐帧改 height（会触发 layout + paint）');
  });

  await t.test('17. 交叉淡入必须靠 key 重挂（否则文本替换不重播动画）', () => {
    const src = read('packages/ui/src/components-react/AgentPresence.tsx');
    assert.ok(
      /key=\{`\$\{presence\.kind\}:\$\{tone\}`\}/.test(src),
      '文案行必须带随状态与语气变化的 key，否则 React 复用节点导致交叉淡入永不触发',
    );
  });
});
