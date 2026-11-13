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
  await t.test('1. idle：头像常驻、轮播文案常驻、不塌高度', () => {
    const html = render({ kind: 'idle' });
    assert.ok(html.includes('data-presence="idle"'), 'idle 必须写在 data-presence 上');
    assert.ok(html.includes('conv-presence__avatar'), 'idle 头像必须常驻，不能整条退场');
    /*
     * 【契约变更 (Rules)】用户裁定空闲态要「弱化头像 + 轮播短句」：
     *   文案行必须常驻并标 `data-idle-quip`，不再走「高度归零」的退场；
     *   任何「隐藏文案行」的实现都会让空闲态看起来像进程挂了。
     */
    assert.ok(html.includes('data-idle-quip="true"'), 'idle 文案行必须以 data-idle-quip 标记轮播态');
    assert.ok(
      html.includes('conv-presence__verb'),
      'idle 必须渲染轮播短句（文案由 presence.idle.* 字典提供）',
    );
    assert.ok(!html.includes('data-empty'), '不得再回到「高度归零」的空态契约');
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
    // 【规则】key 必须同时携带状态、语气与空闲轮播序号：少任何一个都会让对应维度的
    //   文案切换变成「复用节点 + 硬替换」，交叉淡入永不触发。
    assert.ok(
      /key=\{`\$\{presence\.kind\}:\$\{tone\}:\$\{text\.isIdleQuip \? idleQuip\.tick : ''\}`\}/.test(src),
      '文案行 key 必须包含 presence.kind / tone / 空闲轮播序号',
    );
  });

  await t.test('18. 指示器必须有确定宽度（否则文案行塌成 0 宽）', () => {
    const css = read('packages/ui/src/styles/conversation.css');
    const rootBlock = /\.conv-presence \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    // 【真实缺陷回归】`.conv-presence` 若保持 shrink-to-fit，文案行的
    //   `max-width: calc(100% - 96px)` 会与内容形成循环依赖：实测塌成头像宽 56px，
    //   `56 - 96` 为负被钳成 0，状态文案完全不可见（Blink 实测 textWidth=0）。
    assert.ok(
      /\bwidth:\s*min\(420px/.test(rootBlock),
      '根节点必须给确定宽度，否则文案行的百分比 max-width 没有参照',
    );
    const textBlock = /\.conv-presence__text \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    assert.ok(
      !/max-width:\s*min\(420px,\s*calc\(100% - 96px\)\)/.test(textBlock),
      '文案行不得再自引用父级的百分比宽度（循环依赖的根源）',
    );
  });

  await t.test('20. 指示器背后禁止铺开的面：底板只允许贴合真实文案宽度', () => {
    const css = read('packages/ui/src/styles/conversation.css');
    // 【真实缺陷回归】`.conv-presence::before` 曾是一块按容器宽度（`min(420px, 100% - 96px)`）
    //   铺开的椭圆径向 `--panel` 遮罩。它无法贴合真实文案宽度（常见文案只有 50~200px），
    //   在真实对话区里始终是「比头像 + 文案多出一大圈的背景」，压住会话流首条消息。
    //   用户已裁定不需要这块背景（最小化），整块删除；正反两个伪元素都不许回加。
    assert.ok(
      !/\.conv-presence::before\s*\{/.test(css),
      '禁止回加 .conv-presence::before 背景层：任何按容器铺开的面都会比真实文案宽',
    );
    assert.ok(!/\.conv-presence::after\s*\{/.test(css), '禁止用 ::after 变相回加背景层');

    /*
     * 【可读性契约 (Rules)】遮罩删除后，隔离改由 `.conv-presence__text` 自带的
     *   shrink-to-fit 胶囊承担：该元素是 flex 子项，宽度由「动词 + 目标」决定，
     *   永远不会像旧遮罩那样比文案宽。底板接棒后，原来的字形阴影必须撤掉——
     *   背景色晕叠在卡片边缘是脏影，不是可读性。
     */
    const textBlock = /\.conv-presence__text \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    assert.ok(textBlock, '.conv-presence__text 规则必须存在');
    assert.ok(
      /background:\s*var\(--card\)/.test(textBlock),
      '可读性必须由文案行自带的胶囊底板承担（裸字压在滚动内容上会与消息互相穿透）',
    );
    assert.ok(
      /border-radius:\s*var\(--radius-pill/.test(textBlock),
      '胶囊圆角必须走 --radius-pill',
    );
    assert.ok(!/text-shadow/.test(textBlock), '底板已承担隔离，字形阴影必须撤掉');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(textBlock), '胶囊禁止裸十六进制色值');
    assert.ok(
      /box-sizing:\s*border-box/.test(textBlock),
      '胶囊必须 border-box：仓库没有全局 box-sizing，否则 padding 会把 max-width: 100% 顶破',
    );

    /*
     * 【入场动画终态 (Rules)】探针用 `getAnimations().finish()` 驱动到终态再量像素：
     *   终态若被改成 `opacity < 1`，文字在真实运行到 160ms 后就会消失，而底板上只是「变淡」。
     *   这里锁死终态不透明，并禁止在文案行上声明 opacity（隐藏必须走动画或 display）。
     */
    const textInKeyframes = /@keyframes convPresenceTextIn \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    assert.ok(textInKeyframes, '必须存在 convPresenceTextIn 入场动画');
    assert.ok(
      /to\s*\{[^}]*opacity:\s*1/.test(textInKeyframes),
      '入场动画终态必须 opacity: 1（否则文案在 160ms 后消失）',
    );
    assert.ok(!/^\s*opacity:/m.test(textBlock), '文案行不得声明 opacity（会让终态与动画不一致）');

    /*
     * 【根节点禁令 (Rules)】`.conv-presence` 是 `width: min(420px, ...)`（dock 下 100%）的容器：
     *   一旦它带上背景或圆角，就是历史上那块「比文案宽一圈」的椭圆遮罩原貌。
     *   只禁 dock 变体块不够——基础根块才是最容易被人顺手加上的那个。
     */
    const baseRootBlock = /^\.conv-presence \{([\s\S]*?)\n\}/m.exec(css)?.[1] ?? '';
    assert.ok(baseRootBlock, '必须存在基础 .conv-presence 规则');
    assert.ok(!/background/.test(baseRootBlock), '基础根节点禁止任何背景面（会铺满 420px/740px）');
    assert.ok(!/border-radius/.test(baseRootBlock), '基础根节点禁止圆角：有圆角即有面');
  });

  await t.test('21. dock 布局：与输入舱同宽同位、头像贴左边缘、不参与 flow', () => {
    const dockHtml = renderToStaticMarkup(
      React.createElement(AgentPresence, {
        snapshot: { presence: { kind: 'thinking', sinceMs: 0 }, identity: SOLO, layout: 'dock' },
      }),
    );
    assert.ok(dockHtml.includes('data-layout="dock"'), 'layout=dock 必须写到 data-layout 上');

    // 缺省必须是 stage：老宿主不传 layout 时行为不能漂移
    const stageHtml = renderToStaticMarkup(
      React.createElement(AgentPresence, {
        snapshot: { presence: { kind: 'thinking', sinceMs: 0 }, identity: SOLO },
      }),
    );
    assert.ok(stageHtml.includes('data-layout="stage"'), 'layout 缺省必须回落 stage');

    const css = read('packages/ui/src/styles/conversation.css');
    const dockBlock = /\.conv-presence\[data-layout="dock"\] \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    assert.ok(dockBlock, '必须存在 dock 布局变体');
    assert.ok(/max-width:\s*740px/.test(dockBlock), 'dock 变体必须与输入舱同宽（740px）');
    const dockSizeCss = /--presence-size:\s*(\d+)px/.exec(dockBlock)?.[1] ?? '';
    assert.equal(dockSizeCss, '28', 'dock 变体头像必须收到 28px');
    /*
     * 【两侧真值同源 (Rules)】组件侧的 `PRESENCE_DOCK_AVATAR_SIZE`（真实资产内联尺寸）
     *   与 CSS 的 `--presence-size`（容器几何）是同一真值。若两条断言各自钉死一个数字，
     *   「改了一边、忘了另一边」会被 `width: 100% !important` 兜住而全绿通过——
     *   视觉暂时无缺陷，但契约已经脱钩，注释在说谎且下一次改动会踩坑。
     *   这里直接把两侧取值拉出来比对，让脱钩在测试里当场变红。
     */
    const dockSizeTs =
      /const PRESENCE_DOCK_AVATAR_SIZE = (\d+);/.exec(
        read('packages/ui/src/components-react/AgentPresence.tsx'),
      )?.[1] ?? '';
    assert.equal(
      dockSizeTs,
      dockSizeCss,
      '组件常量 PRESENCE_DOCK_AVATAR_SIZE 必须与 CSS 的 --presence-size 同值',
    );
    assert.ok(
      /justify-content:\s*flex-start/.test(dockBlock),
      'dock 变体必须左对齐：头像外沿要贴输入舱左边缘',
    );
    assert.ok(/position:\s*static/.test(dockBlock), 'dock 变体不得再绝对定位（位置由宿主决定）');

    // 【不占流 (Rules)】宿主用 bottom: calc(100% + 8px) 贴在输入舱上沿；
    //   任何 margin/padding 让位的写法都会把输入舱顶起来，输入舱高度一变就上下跳。
    const hostBlock = /#react-conv-presence-host\.presence-host--dock \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    assert.ok(hostBlock, '必须存在 dock 宿主定位规则');
    assert.ok(
      /bottom:\s*calc\(100% \+ 8px\)/.test(hostBlock),
      'dock 宿主必须绝对贴在输入舱上沿，禁止参与 flex 流',
    );
    assert.ok(/pointer-events:\s*none/.test(hostBlock), 'dock 宿主必须只读，不得拦截输入舱点击');
    assert.ok(
      !/padding:\s*0 24px/.test(hostBlock),
      '宿主不得复制 .input-dock-container 的 gutter（双写真值会让对齐静默失效）',
    );

    // 空闲轮播的两个钩子必须在样式里落地，否则文案换了但头像不动
    assert.ok(
      css.includes('.conv-presence__text[data-idle-quip="true"] .conv-presence__verb'),
      '空闲弱化必须命中 .conv-presence__verb（它自己声明了前景色，父级继承会被覆盖）',
    );
    assert.ok(
      css.includes('.conv-presence__avatar[data-idle-turn="true"]'),
      '空闲换句的侧头动作必须挂在 avatar 上（face 已被呼吸动画占用）',
    );

    /*
     * 【底板契约 (Rules)】文案的胶囊底板必须挂在 `.conv-presence__text` 上：
     *   它是 shrink-to-fit 的 flex 子项，宽度等于真实文案宽度；若有人把 background
     *   挪到根 `.conv-presence`（`width: 100%` / `max-width: 740px`），底板就会铺满
     *   整条输入舱宽度并压住会话流——这正是历史上被永久删除的椭圆遮罩缺陷。
     *   下面两组断言互相咬合：基础行有胶囊，且根节点不得出现任何背景面。
     */
    const baseTextBlock = /^\.conv-presence__text \{([\s\S]*?)\n\}/m.exec(css)?.[1] ?? '';
    assert.ok(baseTextBlock, '必须存在基础文案行规则');
    assert.ok(
      /background:\s*var\(--card\)/.test(baseTextBlock),
      '胶囊底板必须挂在基础 `.conv-presence__text` 上，stage 与 dock 共用同一套表面',
    );
    assert.ok(
      /border-radius:\s*var\(--radius-pill/.test(baseTextBlock),
      '胶囊圆角必须走 --radius-pill',
    );
    assert.ok(
      /border:\s*1px solid var\(--border\)/.test(baseTextBlock),
      '胶囊描边必须 1px --border：--border-subtle 在卡片同色底上轮廓会消失',
    );
    assert.ok(/padding:\s*4px 12px/.test(baseTextBlock), '胶囊内距必须落 4px 网格');
    assert.ok(
      /box-shadow:\s*var\(--specular-line\)/.test(baseTextBlock),
      '胶囊只允许顶部内受光，不得补投影',
    );
    assert.ok(
      !/text-shadow/.test(baseTextBlock),
      '胶囊已承担隔离，字形阴影必须撤掉（叠在卡片边缘会变成脏影）',
    );
    const dockTextBlocks = [
      ...css.matchAll(/\.conv-presence\[data-layout="dock"\] \.conv-presence__text \{([\s\S]*?)\n\}/g),
    ].map((m) => m[1]);
    assert.ok(dockTextBlocks.length > 0, 'dock 文案必须有自己的字阶/内距规则');
    assert.ok(
      dockTextBlocks.some((block) => /padding:\s*4px 8px/.test(block)),
      'dock 胶囊内距必须收紧到 4px 8px（caption 档与 28px 头像配平）',
    );
    assert.ok(
      dockTextBlocks.every((block) => !/background/.test(block)),
      'dock 变体不得重复声明胶囊底色（两套底板必然漂移）',
    );
    assert.ok(
      !/background/.test(dockBlock),
      'dock 根节点禁止挂任何背景面：width: 100% 的底板会铺满输入舱宽度并压住会话流',
    );

    // 【减动效 (Rules)】新增的 avatar 级旋转必须进 reduced-motion 白名单，
    //   否则前庭敏感用户仍会看到头像旋转（本文件历史 P0-1 的同类缺陷）。
    const reducedBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map(
      (m) => m[1],
    );
    const presenceBlock = reducedBlocks.find((block) => block.includes('.conv-presence')) ?? '';
    assert.ok(
      /\.conv-presence \.conv-presence__avatar[\s\S]{0,400}?animation:\s*none\s*!important/.test(presenceBlock),
      'reduced-motion 白名单必须包含 .conv-presence__avatar',
    );

    // dock 字阶必须锁整数档，不得用 calc 相减产生小数字号
    const dockTextBlock =
      /\.conv-presence\[data-layout="dock"\] \.conv-presence__text \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    assert.ok(
      !/calc\(/.test(dockTextBlock),
      'dock 文案字号不得用 calc 相减（会得到 10.7px 这类小数字号，违反整数阶梯）',
    );
    assert.ok(/font-size:\s*var\(--fs-caption/.test(dockTextBlock), 'dock 文案必须锁 caption 档');

    /*
     * 【真实图片资产防裁切 (Rules)】自定义头像（带有 avatar 图片 URL）会由 `renderBotAvatar`
     *   渲染为带有内联样式的 `<img>`。在 dock 变体下：
     *   1. 组件输出的 `<img>` 内联尺寸必须根据 layout 切换为 28px（stage 为 56px）；
     *   2. CSS 的 `.conv-presence__face > img` 必须带 `!important` 覆盖内联样式，
     *      防止 56px 大图塞进 28px 容器被裁成局部一个角（真实用户截图缺陷）。
     */
    const dockCustomImgHtml = renderToStaticMarkup(
      React.createElement(AgentPresence, {
        snapshot: {
          presence: { kind: 'idle' },
          identity: { kind: 'solo', name: 'cat', avatar: 'https://example.com/cat.png' },
          layout: 'dock',
        },
      }),
    );
    assert.ok(
      dockCustomImgHtml.includes(`width: ${dockSizeCss}px`) &&
        dockCustomImgHtml.includes(`height: ${dockSizeCss}px`),
      `dock 模式下自定义头像 <img> 内联样式必须输出 ${dockSizeCss}px，不得输出 56px`,
    );

    const stageCustomImgHtml = renderToStaticMarkup(
      React.createElement(AgentPresence, {
        snapshot: {
          presence: { kind: 'idle' },
          identity: { kind: 'solo', name: 'cat', avatar: 'https://example.com/cat.png' },
          layout: 'stage',
        },
      }),
    );
    assert.ok(
      stageCustomImgHtml.includes('width: 56px') && stageCustomImgHtml.includes('height: 56px'),
      'stage 模式下自定义头像 <img> 内联样式必须输出 56px',
    );

    /*
     * 【群聊 + dock 组合路径 (Rules)】群聊成员与单聊共用同一个 `avatarSize` 实参，
     *   但历史用例全部走 stage：若有人把群聊分支改回 `PRESENCE_AVATAR_SIZE`，
     *   没有任何断言会变红，群聊 dock 头像会悄悄回到 56px 并撑爆 28px 容器。
     *   这里渲染一次群聊 dock，核对每个槽位的下发尺寸。
     */
    const dockGroupHtml = renderToStaticMarkup(
      React.createElement(AgentPresence, {
        snapshot: {
          presence: { kind: 'idle' },
          identity: {
            kind: 'group',
            members: ['虫虫', '卷卷'],
            speaker: '虫虫',
            profiles: [{ name: '虫虫' }, { name: '卷卷' }],
          },
          layout: 'dock',
        },
      }),
    );
    const dockGroupSizeMarks = [
      ...dockGroupHtml.matchAll(new RegExp(`width="${dockSizeCss}"`, 'g')),
    ];
    assert.equal(dockGroupSizeMarks.length, 2, '群聊 dock 的每个头像槽位都必须按 28px 下发');
    assert.ok(
      !dockGroupHtml.includes('width="56"') && !dockGroupHtml.includes('width: 56px'),
      '群聊 dock 不得回落到 stage 的 56px 尺寸',
    );

    const imgRule = /\.conv-presence__face > img \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    assert.ok(
      /width:\s*100%\s*!important/.test(imgRule) && /height:\s*100%\s*!important/.test(imgRule),
      'CSS .conv-presence__face > img 必须带 !important 保证能压过 HTML 内联 style',
    );
  });

  await t.test('22. 实景探针骨架必须与组件契约同构（防止证据静默漂移）', () => {
    /*
     * 【为什么 (Rules)】`scripts/verify/agent-presence-screens.cjs` 里的指示器骨架是手写的，
     *   组件契约一改（新增/改名 data 属性或子节点类名）证据就会静默漂移，
     *   而探针断言仍然全绿——那是「假证据」。这里锁住必须出现的契约面。
     */
    const probe = read('scripts/verify/agent-presence-screens.cjs');
    for (const marker of [
      'class="conv-presence"',
      'data-presence=',
      'data-mode=',
      'data-tone=',
      'data-layout=',
      'conv-presence__avatars',
      'conv-presence__avatar"',
      'conv-presence__halo',
      'conv-presence__ring',
      'conv-presence__face',
      'conv-presence__text',
    ]) {
      assert.ok(probe.includes(marker), `实景探针骨架缺少契约面：${marker}`);
    }
    // 空闲轮播的两个标记也必须出现在探针里，否则截出来的永远是「没有空闲态」的旧图
    assert.ok(probe.includes('data-idle-turn='), '探针必须带 data-idle-turn');
    assert.ok(probe.includes('data-idle-quip='), '探针必须带 data-idle-quip');
    /*
     * 【宿主契约也必须登记 (Rules)】探针手写了宿主定位，一旦 `ensureAgentPresenceHost`
     *   改了宿主 id / 类名 / 插入位置，截图证据会静默偏离真实实现而断言仍绿。
     */
    assert.ok(probe.includes('react-conv-presence-host'), '探针必须复刻真实宿主 id');
    assert.ok(probe.includes('presence-host--dock'), '探针必须复刻 dock 宿主类名');
    assert.ok(
      probe.includes('dock.insertBefore(host, dock.firstElementChild)'),
      '探针必须复刻「host 插到输入舱首位」这一关键落点',
    );
    // 探针不得在注释里满足断言：剥注释后仍须包含骨架类名
    const probeCode = probe.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    assert.ok(probeCode.includes('conv-presence__text'), '剥注释后骨架仍须包含文案行类名');
    assert.ok(probeCode.includes('conv-presence__avatars'), '剥注释后骨架仍须包含头像容器类名');
  });
});
