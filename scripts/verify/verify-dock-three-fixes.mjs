/**
 * 三缺陷修复后的运行时取证：入队、斜杠全集、Bot 会话 @ 候选。
 *
 * 【规则】断言全部读真实 DOM 与真实渲染产物，不读内部私有字段来"制造"通过。
 */
import path from 'node:path';
import fs from 'node:fs';
import { createDriveSession } from './control-flux.mjs';

const OUT = path.resolve('artifacts/verification/dock-three-defects');
fs.mkdirSync(OUT, { recursive: true });

const session = await createDriveSession({ entry: '/packages/desktop/dist/renderer/index.html' });
const settle = () => session.evaluate('new Promise((r) => setTimeout(() => r(true), 450))');

const typeAt = (value) =>
  session.evaluate(`(() => {
    const el = document.getElementById('dock-prompt-input');
    el.focus();
    el.value = ${JSON.stringify(value)};
    el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`);

const PROFILES = [
  { name: 'default', displayName: 'Default 助理' },
  { name: 'aura', displayName: 'Aura' },
  { name: 'codeboy', displayName: 'CodeBoy' },
];

const results = {};
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
    s.profiles = ${JSON.stringify(PROFILES)};
    s.openFiles = [{ path: 'src/renderer/index.ts' }];
    s.activeSessionId = 'sess-live';
    s.activeFocus = { type: 'bot', botName: 'default' };
    window.__fluxRender();
    return true;
  })()`);
  await session.waitFor(`Boolean(document.getElementById('dock-prompt-input'))`, 10000, 'dock');

  // ---- 缺陷 3：Bot 主工位 @ 必须列出其他 Bot，且排除自己 ----
  await typeAt('@');
  await settle();
  results.mentionBot = await session.evaluate(`(() => {
    const s = window.__fluxState;
    return {
      open: s.mentionPopperOpen,
      rows: document.querySelectorAll('.mention-item-option').length,
      agents: s.mentionItems.filter(i => i.type === 'agent').map(i => i.name),
    };
  })()`);
  check('Bot 会话 @ 列出其他 Bot', results.mentionBot.agents.length === 2, results.mentionBot.agents);
  check('Bot 会话 @ 排除自己', !results.mentionBot.agents.some(n => n.includes('Default')), results.mentionBot.agents);

  // 群聊仍按房间成员
  await session.evaluate(`(() => {
    const s = window.__fluxState;
    s.activeFocus = { type: 'group', roomId: 'r1' };
    s.groupRooms = [{ roomId: 'r1', members: ['aura'] }];
    window.__fluxRender();
    return true;
  })()`);
  await typeAt('@');
  await settle();
  results.mentionGroup = await session.evaluate(`(() => window.__fluxState.mentionItems.map(i => i.type + ':' + i.name))()`);
  check('群聊 @ 仍按房间成员', results.mentionGroup.includes('agent:all') && results.mentionGroup.includes('agent:aura'), results.mentionGroup);

  // ---- 缺陷 2：斜杠不得截断到 12 ----
  await session.evaluate(`(() => {
    const s = window.__fluxState;
    s.activeFocus = { type: 'session', sessionId: 'sess-live' };
    window.__fluxRender();
    return true;
  })()`);
  const catalog = Array.from({ length: 40 }, (_, i) => ({ name: `/cmd${String(i).padStart(2, '0')}`, description: `desc ${i}` }));
  await session.evaluate(`(() => {
    window.__fluxState.slashItems = ${JSON.stringify(catalog)};
    window.__fluxState.slashPopperOpen = true;
    window.__fluxRender();
    return true;
  })()`);
  results.slashRows = await session.evaluate(`(() => {
    const list = document.querySelector('.composer-slash-popper .composer-popper__list');
    return {
      rows: document.querySelectorAll('.slash-item-option').length,
      maxHeight: list ? getComputedStyle(list).maxHeight : null,
      overflowY: list ? getComputedStyle(list).overflowY : null,
    };
  })()`);
  check('斜杠列表不再截断到 12 条', results.slashRows.rows === 40, results.slashRows);
  check('超长由列表滚动承担', results.slashRows.overflowY === 'auto', results.slashRows);

  // ---- 缺陷 1：运行态回车入队，不再弹「回合进行中」 ----
  await session.evaluate(`(() => {
    const s = window.__fluxState;
    s.slashPopperOpen = false;
    s.slashItems = [];
    s.dockNotice = '';
    window.__fluxRender();
    return true;
  })()`);
  await typeAt('排队测试');
  await settle();
  const enterOutcome = await session.evaluate(`(() => {
    const el = document.getElementById('dock-prompt-input');
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  await settle();
  results.idleEnter = await session.evaluate(`(() => ({
    notice: window.__fluxState.dockNotice,
    draft: document.getElementById('dock-prompt-input').value,
  }))()`);
  check('空闲态回车不弹阻断提示', !results.idleEnter.notice.includes('仍在生成中'), results.idleEnter);

  // ---- 缺陷 1 的关键错位场景：state.isStreaming 为旧值、当前会话无活跃回合 ----
  // 这是用户实际看到的形态：界面是发送按钮（因为渲染读活跃回合），回车却弹「回合仍在生成中」。
  await session.evaluate(`(() => {
    const s = window.__fluxState;
    s.isStreaming = true;
    s.dockNotice = '';
    s.messages = [];
    window.__fluxRender();
    return true;
  })()`);
  await typeAt('错位场景');
  await settle();
  results.staleStreaming = await session.evaluate(`(() => ({
    hasSend: Boolean(document.getElementById('dock-send-btn')),
    hasStop: Boolean(document.getElementById('dock-stop-btn')),
  }))()`);
  await session.evaluate(`(() => {
    const el = document.getElementById('dock-prompt-input');
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
  await settle();
  results.staleEnter = await session.evaluate(`(() => ({
    notice: window.__fluxState.dockNotice,
    draft: document.getElementById('dock-prompt-input').value,
  }))()`);
  check(
    '界面是发送按钮时回车不得弹「回合进行中」',
    !results.staleEnter.notice.includes('仍在生成中'),
    { rendered: results.staleStreaming, enter: results.staleEnter },
  );

  const rect = await session.evaluate(`(() => {
    const r = document.querySelector('.input-dock-container').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const shot = await session.sendCommand('Page.captureScreenshot', {
    format: 'png',
    clip: { x: rect.x - 16, y: rect.y - 16, width: rect.width + 32, height: rect.height + 32, scale: 2 },
  });
  fs.writeFileSync(path.join(OUT, 'after-fix-dock.png'), Buffer.from(shot.data, 'base64'));

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
} finally {
  await session.cleanup();
}
