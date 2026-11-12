/**
 * 四项修复的端到端取证。
 *
 * 用网关真实数据驱动真实渲染，断言用户可观察的结果。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createDriveSession } from './control-flux.mjs';

const OUT = path.resolve('artifacts/verification/dock-three-defects');
fs.mkdirSync(OUT, { recursive: true });

const catalog = JSON.parse(
  fs.readFileSync('C:/Users/470785/AppData/Local/Temp/opencode/catalog.json', 'utf8'),
);

const session = await createDriveSession({ entry: '/packages/desktop/dist/renderer/index.html' });
const settle = () => session.evaluate('new Promise((r) => setTimeout(() => r(true), 500))');

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

try {
  await session.waitFor(`Boolean(window.__fluxState && window.__fluxRender)`, 25000, 'app');
  await session.evaluate(`(() => {
    const s = window.__fluxState;
    s.gatewayConnected = true;
    s.gatewayConnecting = false;
    s.activeSessionId = 'sess-live';
    s.activeFocus = { type: 'session', sessionId: 'sess-live' };
    window.__fluxRender();
    return true;
  })()`);
  await session.waitFor(`Boolean(document.getElementById('dock-prompt-input'))`, 10000, 'dock');

  // ---------- 1. 点击空白处关闭浮层 ----------
  const rootItems = (catalog.slash['/']?.items || []).map((it) => ({
    name: it.text?.startsWith('/') ? it.text : `/${it.text}`,
    description: it.meta || '',
    isSkill: it.kind === 'skill',
  }));
  await session.evaluate(`(() => {
    window.__fluxState.slashItems = ${JSON.stringify(rootItems.slice(0, 20))};
    window.__fluxState.slashPopperOpen = true;
    window.__fluxRender();
    return true;
  })()`);
  const before = await session.evaluate(`(() => ({
    open: window.__fluxState.slashPopperOpen,
    rows: document.querySelectorAll('.slash-item-option').length,
  }))()`);
  // 点会话流空白处
  await session.evaluate(`(() => {
    const el = document.getElementById('conversation-stream');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 }));
    return true;
  })()`);
  await settle();
  const after = await session.evaluate(`(() => ({
    open: window.__fluxState.slashPopperOpen,
    rows: document.querySelectorAll('.slash-item-option').length,
  }))()`);
  check('点空白处后斜杠浮层关闭', before.open === true && after.open === false, { before, after });

  // 点输入舱内部不应关闭
  await session.evaluate(`(() => {
    window.__fluxState.slashItems = ${JSON.stringify(rootItems.slice(0, 5))};
    window.__fluxState.slashPopperOpen = true;
    window.__fluxRender();
    const el = document.getElementById('dock-prompt-input');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  })()`);
  await settle();
  const keep = await session.evaluate(`window.__fluxState.slashPopperOpen`);
  check('点输入舱内部不关闭浮层', keep === true, { open: keep });

  // ---------- 2. 斜杠过滤：desktop 标记 + 别名折叠 ----------
  const marks = Object.fromEntries(
    Object.entries(catalog.catalog?.commands || {}).map(([k, v]) => [k.replace(/^\//, '').trim(), v?.desktop ?? null]),
  );
  const canon = catalog.catalog?.canon || {};
  const filtered = await session.evaluate(`(async () => {
    const mod = await import('/packages/desktop/dist/renderer/slashVisibility.mjs');
    const marks = new Map(Object.entries(${JSON.stringify(marks)}));
    const aliases = mod.buildAliasSet(${JSON.stringify(canon)});
    const items = ${JSON.stringify(rootItems)};
    const visible = mod.filterDesktopCommands({ items, desktopMarks: marks, aliases });
    return {
      before: items.length,
      after: visible.length,
      hidden: items.length - visible.length,
      names: visible.map((i) => i.name),
    };
  })()`);
  check('斜杠列表经过滤后变短', filtered.after < filtered.before, {
    before: filtered.before,
    after: filtered.after,
    hidden: filtered.hidden,
  });
  const stillHas = (n) => filtered.names.includes(n);
  check('/redraw 已隐藏（terminal 专属）', !stillHas('/redraw'), { has: stillHas('/redraw') });
  check('/model 已隐藏（网关标 hidden）', !stillHas('/model'), { has: stillHas('/model') });
  check('/compact 已折叠（/compress 的别名）', !stillHas('/compact'), { has: stillHas('/compact') });
  check('/compress 仍保留（主命令）', stillHas('/compress'), { has: stillHas('/compress') });
  check('/goal 仍保留（GUI 无等价入口）', stillHas('/goal'), { has: stillHas('/goal') });

  // ---------- 3. @ 路径 token ----------
  const mention = await session.evaluate(`(async () => {
    const mod = await import('/packages/desktop/dist/renderer/mentionToken.mjs');
    return {
      absPath: mod.parseMentionToken('看看 @/opt'),
      relPath: mod.parseMentionToken('@src/opt'),
      botName: mod.parseMentionToken('@aura'),
      fuzzyOpt: mod.fuzzyPathMatch('src/opt/data/cache', 'opt'),
      fuzzyNested: mod.fuzzyPathMatch('packages/desktop/src/renderer/index.ts', 'renderer/index'),
    };
  })()`);
  check('@/opt 被识别为路径查询', mention.absPath?.isPath === true, mention.absPath);
  check('@src/opt 被识别为路径', mention.relPath?.isPath === true, mention.relPath);
  check('@aura 仍是 Bot 名', mention.botName?.isPath === false, mention.botName);
  check('模糊匹配 opt 命中嵌套路径', mention.fuzzyOpt === true, { fuzzyOpt: mention.fuzzyOpt });
  check('跨段匹配 renderer/index 命中', mention.fuzzyNested === true, { fuzzyNested: mention.fuzzyNested });

  // ---------- 4. 队列回执 ----------
  const queue = await session.evaluate(`(async () => {
    const mod = await import('/packages/desktop/dist/renderer/queueControl.mjs');
    return {
      runningQueued: mod.applyEnqueueReceipt({ status: 'queued' }, '排队内容'),
      idleStreaming: mod.applyEnqueueReceipt({ status: 'streaming', user_row_id: 44507 }, '空闲内容'),
      failed: mod.applyEnqueueReceipt({ status: 'failed' }, '失败内容'),
      noReceipt: mod.applyEnqueueReceipt(null, '空回执'),
    };
  })()`);
  check('运行态 status=queued 判成功（历史误判为失败）', queue.runningQueued.kind === 'queued', queue.runningQueued);
  check('空闲态 status=streaming 判成功', queue.idleStreaming.kind === 'queued', queue.idleStreaming);
  check('失败终态仍判失败并保留草稿', queue.failed.kind === 'failed', queue.failed);

  const shot = await session.sendCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'four-fixes.png'), Buffer.from(shot.data, 'base64'));

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} finally {
  await session.cleanup();
}
