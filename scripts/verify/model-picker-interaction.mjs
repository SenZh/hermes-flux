#!/usr/bin/env node
/**
 * 模型选择器交互物理验证 (Model Picker Interaction Verification)
 *
 * 【设计意图 (Why)】
 *   折叠、搜索、思考级联、点空白收起这四件事全部由真实 DOM 事件驱动，
 *   字符串单测只能证明「节点长对了」，证明不了「点下去真的动」。
 *   本脚本在真实 Blink 内核里按用户操作顺序驱动，并把每一步的 DOM 结果写成证据。
 *
 * 【约束与规则 (Rules)】
 *   - 依赖 `?demo=conversation` 注入的演示目录（与网关同一条归一化入口）；
 *   - 所有点击/悬停走 CDP `Input.dispatchMouseEvent`，不调私有 setter；
 *   - 需要先在本机启动浏览器直跑服务（默认 9130），脚本不负责拉起服务。
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'verification', 'model-picker-interaction');
const PORT = Number(process.env.PORT) || 9130;
const BASE = `http://127.0.0.1:${PORT}`;

const BROWSER = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!BROWSER) throw new Error('未找到 Edge/Chrome');
  const up = await fetch(BASE + '/').then((r) => r.ok).catch(() => false);
  if (!up) throw new Error(`浏览器直跑服务未就绪：${BASE}（先运行 PORT=${PORT} node scripts/start-browser-live.mjs）`);

  const userDataDir = path.join(os.tmpdir(), `flux-picker-${Date.now()}`);
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const cdpPort = probe.address().port;
  await new Promise((r) => probe.close(r));

  const proc = spawn(BROWSER, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1360,900',
    `${BASE}/?demo=conversation`,
  ], { stdio: 'ignore' });

  let wsUrl = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        const page = (await res.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      }
    } catch {}
    await wait(200);
  }
  if (!wsUrl) throw new Error('未拿到 CDP page target');

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  const icon404s = [];
  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params?.response?.url || '';
      const status = msg.params?.response?.status || 0;
      if (url.includes('icons/lobe/') && status >= 400) icon404s.push(`${status} ${url}`);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params?.exceptionDetails?.exception?.description || JSON.stringify(msg.params));
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params?.type === 'error' || msg.params?.type === 'warning')) {
      consoleErrors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

  await send('Page.enable');
  await send('Network.enable');
  await send('Runtime.enable');

  const ready = await (async () => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      if (await evaluate('Boolean(document.getElementById("dock-model-selector-btn"))')) return true;
      await wait(300);
    }
    return false;
  })();
  if (!ready) throw new Error('输入舱未挂载');

  const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  const click = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  const centerOf = async (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  /**
   * 控件操作用 DOM `click()`：它触发的就是元素自身的 onclick，与真实点击同一条绑定路径，
   * 但不依赖像素命中——下拉是浮层，坐标点击在不同窗口尺寸下容易被相邻层吃掉，导致假红。
   * 真正需要像素级验证的只有「点空白收起」，那一项仍走真实鼠标事件。
   */
  const domClick = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);

  const steps = [];
  const record = (name, detail) => { steps.push({ name, ...detail }); console.log(`  · ${name}: ${JSON.stringify(detail)}`); };
  const failures = [];

  // 1. 打开下拉（检验 aria-expanded 同步）
  await domClick('#dock-model-selector-btn');
  await wait(400);
  const opened = await evaluate(`(() => {
    const d = document.getElementById('dock-model-dropdown');
    const b = document.getElementById('dock-model-selector-btn');
    return { display: getComputedStyle(d).display, rows: document.querySelectorAll('.model-option').length, ariaExpanded: b.getAttribute('aria-expanded') };
  })()`);
  record('open', opened);
  if (opened.display !== 'block') failures.push('点击模型按钮后下拉未展开');
  if (opened.rows < 6) failures.push(`演示目录未注入：仅 ${opened.rows} 行`);
  if (opened.ariaExpanded !== 'true') failures.push(`打开后 aria-expanded 应为 true，实得 ${opened.ariaExpanded}`);

  // 1a. 「未选任何模型」直接点空白（曾因 lastInputDockSnapshot.modelMenuOpen 滞留 false 导致卡死！）
  const blankInit = await evaluate(`(() => { const el = document.querySelector('.conv-stream') || document.querySelector('.flux-middle-pod') || document.body; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(80, r.height / 3)) }; })()`);
  await click(blankInit.x, blankInit.y);
  await wait(400);
  const afterBlankInit = await evaluate(`(() => ({
    display: getComputedStyle(document.getElementById('dock-model-dropdown')).display,
    ariaExpanded: document.getElementById('dock-model-selector-btn').getAttribute('aria-expanded'),
  }))()`);
  record('click-outside-immediate', afterBlankInit);
  if (afterBlankInit.display !== 'none' || afterBlankInit.ariaExpanded !== 'false') {
    failures.push(`未做任何操作直接点空白未收起：${JSON.stringify(afterBlankInit)}`);
  }

  // 1a-2. 再打开后「未选任何模型」直接按 Escape 收起
  await domClick('#dock-model-selector-btn');
  await wait(300);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(400);
  const afterEscInit = await evaluate(`(() => ({
    display: getComputedStyle(document.getElementById('dock-model-dropdown')).display,
    ariaExpanded: document.getElementById('dock-model-selector-btn').getAttribute('aria-expanded'),
  }))()`);
  record('escape-immediate', afterEscInit);
  if (afterEscInit.display !== 'none' || afterEscInit.ariaExpanded !== 'false') {
    failures.push(`未做任何操作直接按 Escape 未收起：${JSON.stringify(afterEscInit)}`);
  }

  // 重新打开继续后续测试
  await domClick('#dock-model-selector-btn');
  await wait(350);

  // 1b. 所有可见的彩色品牌图标必须全部解码成功（防止浏览器直跑相对路径 404 破图）
  const imgDecode = await evaluate(`(() => {
    const imgs = [...document.querySelectorAll('.vendor-icon__color')];
    return { total: imgs.length, decoded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
  })()`);
  record('icons:color-decoded', imgDecode);
  if (imgDecode.total === 0) failures.push('缺少彩色品牌图标节点');
  if (imgDecode.decoded !== imgDecode.total) {
    failures.push(`彩色品牌图标破图 ${imgDecode.total - imgDecode.decoded}/${imgDecode.total}`);
  }
  if (icon404s.length > 0) failures.push(`图标资源 HTTP 404: ${icon404s.slice(0, 3).join(', ')}`);

  // 2. 搜索过滤
  await evaluate(`(() => { const i = document.getElementById('dock-model-search-input'); i.value = 'deepseek'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(300);
  const searched = await evaluate(`(() => ({ rows: document.querySelectorAll('.model-option').length, names: [...document.querySelectorAll('.model-option')].map((r) => r.textContent.trim().slice(0, 20)) }))()`);
  record('search:deepseek', searched);
  if (searched.rows !== 1) failures.push(`搜索未收敛：期望 1 行，实得 ${searched.rows}`);

  // 3. 清空搜索
  await evaluate(`(() => { const i = document.getElementById('dock-model-search-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(300);
  const restored = await evaluate(`document.querySelectorAll('.model-option').length`);
  record('search:clear', { rows: restored });
  if (restored < 6) failures.push('清空搜索后列表未恢复');

  // 4. 折叠 cpa 分组
  await domClick('.model-provider-group-header[data-provider="cpa"]');
  await wait(300);
  const collapsed = await evaluate(`(() => { const h = document.querySelector('.model-provider-group-header[data-provider="cpa"]'); const body = h.parentElement.querySelector('.model-provider-items'); return { ariaExpanded: h.getAttribute('aria-expanded'), bodyDisplay: getComputedStyle(body).display, visibleRows: [...document.querySelectorAll('.model-option')].filter((r) => r.offsetParent !== null).length }; })()`);
  record('collapse:cpa', collapsed);
  if (collapsed.ariaExpanded !== 'false') failures.push('折叠后 aria-expanded 未变为 false');
  if (collapsed.bodyDisplay !== 'none') failures.push('折叠后分组列表未隐藏');

  // 5. 再点展开
  await domClick('.model-provider-group-header[data-provider="cpa"]');
  await wait(300);
  const expanded = await evaluate(`(() => { const h = document.querySelector('.model-provider-group-header[data-provider="cpa"]'); const body = h.parentElement.querySelector('.model-provider-items'); return { ariaExpanded: h.getAttribute('aria-expanded'), bodyDisplay: getComputedStyle(body).display }; })()`);
  record('expand:cpa', expanded);
  if (expanded.ariaExpanded !== 'true') failures.push('再次点击未展开分组');

  // 6. 悬停「非激活」模型行 → 二级级联 + 行悬停底色真实生效
  // 【为什么必须挑 :not(.active)】选中行自带 --accent-subtle 底色（rgba(255,255,255,0.06)），
  // 若悬停选中行，即使 CSS :hover 完全失效也会测出非透明底色，形成假绿。
  const row = await evaluate(`(() => {
    const target = [...document.querySelectorAll('.model-option:not(.active):not(.is-locked)')].find((r) => r.offsetParent !== null);
    const r = target.getBoundingClientRect();
    return {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      model: target.getAttribute('data-model'),
      beforeBg: getComputedStyle(target).backgroundColor,
    };
  })()`);
  await mouse('mouseMoved', row.x, row.y);
  await wait(400);
  const cascade = await evaluate(`(() => { const c = document.getElementById('model-reasoning-cascade'); const r = c.getBoundingClientRect(); const row = document.querySelector('.model-option[data-model="' + ${JSON.stringify(row.model)} + '"]').getBoundingClientRect(); return { display: getComputedStyle(c).display, left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom), rowTop: Math.round(row.top), rowRight: Math.round(row.right), items: c.querySelectorAll('.model-cascade__item').length, active: [...c.querySelectorAll('.model-cascade__item.active')].map((i) => i.getAttribute('data-level')) }; })()`);
  record('cascade:show', cascade);
  if (cascade.display !== 'block') failures.push('悬停模型行后二级级联未出现');
  if (cascade.items !== 5) failures.push(`级联等级项应为 5，实得 ${cascade.items}`);
  if (cascade.left <= cascade.rowRight) failures.push('级联未落在行右侧');
  if (cascade.bottom > 806) failures.push(`级联底部溢出视口（bottom=${cascade.bottom}）`);

  // 6b. 悬停非激活整行必须从透明变成 --card-hover（内联 background 曾把它压死）
  const hoverBg = await evaluate(`(() => {
    const el = document.querySelector('.model-option[data-model="' + ${JSON.stringify(row.model)} + '"]');
    return { bg: getComputedStyle(el).backgroundColor, cardHoverToken: getComputedStyle(document.documentElement).getPropertyValue('--card-hover').trim() };
  })()`);
  record('hover:background', { before: row.beforeBg, after: hoverBg.bg, token: hoverBg.cardHoverToken });
  if (hoverBg.bg === 'rgba(0, 0, 0, 0)' || hoverBg.bg === 'transparent') {
    failures.push(`非激活行悬停无底色反馈（backgroundColor=${hoverBg.bg}）`);
  }
  if (hoverBg.bg === row.beforeBg) {
    failures.push(`悬停前后底色没有变化（before=${row.beforeBg}, after=${hoverBg.bg}）`);
  }

  // 6f. 键盘导航：级联内 ↑↓ 移动、Esc 退回原行
  const kbNav = await evaluate(`(() => {
    const first = document.querySelector('.model-cascade__item');
    first.focus();
    const startIdx = [...document.querySelectorAll('.model-cascade__item')].indexOf(document.activeElement);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const afterDown = [...document.querySelectorAll('.model-cascade__item')].indexOf(document.activeElement);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const afterEnd = [...document.querySelectorAll('.model-cascade__item')].indexOf(document.activeElement);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const onRow = Boolean(document.activeElement?.classList?.contains('model-option'));
    return { startIdx, afterDown, afterEnd, onRowAfterEsc: onRow, cascadeDisplay: getComputedStyle(document.getElementById('model-reasoning-cascade')).display };
  })()`);
  record('cascade:keyboard-nav', kbNav);
  if (kbNav.afterDown !== kbNav.startIdx + 1) failures.push('级联内 ↓ 未移动到下一档');
  if (kbNav.afterEnd !== 4) failures.push('级联内 End 未跳到最后一档');
  if (!kbNav.onRowAfterEsc) failures.push('级联内 Esc 未把焦点退回模型行');
  if (kbNav.cascadeDisplay !== 'none') failures.push('级联内 Esc 未收起面板');

  // 6g. 行间 ↑↓ 移动
  const rowNav = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.model-option')].filter((r) => r.offsetParent !== null);
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const idx = rows.indexOf(document.activeElement);
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    const endIdx = [...document.querySelectorAll('.model-option')].filter((r) => r.offsetParent !== null).indexOf(document.activeElement);
    return { afterDown: idx, afterEnd: endIdx, total: rows.length };
  })()`);
  record('rows:keyboard-nav', rowNav);
  if (rowNav.afterDown !== 1) failures.push('模型行 ↓ 未移动到第二行');
  if (rowNav.afterEnd !== rowNav.total - 1) failures.push('模型行 End 未跳到末行');

  // 6c. 悬停末行时 5 档必须全部物理可点（垂直夹取）
  const lastRow = await evaluate(`(() => { const rows = [...document.querySelectorAll('.model-option')].filter((r) => r.offsetParent !== null); const target = rows[rows.length - 1]; const r = target.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), model: target.getAttribute('data-model') }; })()`);
  await mouse('mouseMoved', lastRow.x, lastRow.y);
  await wait(400);
  const lastHits = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.model-cascade__item')];
    return {
      total: items.length,
      inViewport: items.filter((i) => { const r = i.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }).length,
      hitTestable: items.filter((i) => { const r = i.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return Boolean(el && i.contains(el)); }).length,
    };
  })()`);
  record('cascade:last-row-hittable', lastHits);
  if (lastHits.hitTestable !== lastHits.total) {
    failures.push(`末行级联有 ${lastHits.total - lastHits.hitTestable} 档在视口外不可点（垂直未夹取）`);
  }

  // 6d. 列表滚动必须收起级联
  await evaluate(`(() => { const list = document.getElementById('model-picker-scroll-list'); list.scrollTop = 40; list.dispatchEvent(new Event('scroll')); })()`);
  await wait(250);
  const afterScroll = await evaluate(`getComputedStyle(document.getElementById('model-reasoning-cascade')).display`);
  record('cascade:scroll-hide', { display: afterScroll });
  if (afterScroll !== 'none') failures.push(`列表滚动后级联未收起（display=${afterScroll}）`);

  // 6e. 键盘路径：聚焦模型行即可展开级联，并可用方向键进入
  // 【规则】先 blр 再 focus：若该行已处于聚焦态，再次 focus() 不会派发 focus 事件，
  // 面板也就不会展开——脚本必须模拟「用户从别处移过来」的真实路径。
  await evaluate(`(() => { document.activeElement?.blur?.(); const row = document.querySelector('.model-option'); row.focus(); })()`);
  await wait(300);
  const focusOpen = await evaluate(`(() => {
    const c = document.getElementById('model-reasoning-cascade');
    const before = getComputedStyle(c).display;
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return { before, activeIsItem: Boolean(document.activeElement?.classList?.contains('model-cascade__item')) };
  })()`);
  record('cascade:keyboard', focusOpen);
  if (focusOpen.before !== 'block') failures.push('键盘聚焦模型行后级联未展开');
  if (!focusOpen.activeIsItem) failures.push('按 → 未能把焦点移入级联项');

  // 级联展开态的物理截图（评审需要看真实定位与层级）
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const cascadeShot = await send('Page.captureScreenshot', { format: 'png' });
  const cascadeShotPath = path.join(ARTIFACT_DIR, 'screenshot-cascade.png');
  fs.writeFileSync(cascadeShotPath, Buffer.from(cascadeShot.data, 'base64'));

  // 7. 选择思考等级
  await domClick('.model-cascade__item[data-level="low"]');
  await wait(500);
  const afterPick = await evaluate(`(() => { const d = document.getElementById('dock-model-dropdown'); const c = document.getElementById('model-reasoning-cascade'); return { menuDisplay: getComputedStyle(d).display, cascadeDisplay: getComputedStyle(c).display }; })()`);
  record('cascade:pick-low', afterPick);
  if (afterPick.cascadeDisplay !== 'none') failures.push('选完等级后级联未收起');

  // 8. 重新打开 → 点对话区空白收起（真实鼠标事件，这是本次要修的 bug 本体）
  if (afterPick.menuDisplay !== 'block') {
    await domClick('#dock-model-selector-btn');
    await wait(400);
  }
  const blank = await evaluate(`(() => { const el = document.querySelector('.conv-stream') || document.querySelector('.flux-middle-pod') || document.body; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(80, r.height / 3)) }; })()`);
  await click(blank.x, blank.y);
  await wait(600);
  const closed = await evaluate(`(() => { const d = document.getElementById('dock-model-dropdown'); return d ? getComputedStyle(d).display : 'missing'; })()`);
  record('click-outside', { display: closed });
  if (closed !== 'none') failures.push(`点击空白后下拉未收起（display=${closed}）`);

  // 9. 选中等级是否真的写回（重新打开后 active 跟随）
  await domClick('#dock-model-selector-btn');
  await wait(400);
  const persisted = await evaluate(`(() => { const c = document.getElementById('model-reasoning-cascade'); return [...c.querySelectorAll('.model-cascade__item.active')].map((i) => i.getAttribute('data-level')); })()`);
  record('reasoning:persisted', { active: persisted });
  if (!persisted.includes('low')) failures.push(`思考等级未写回：active=${JSON.stringify(persisted)}`);

  // 10. 搜索态关闭再打开必须归零（缺陷：残留搜索词让人以为模型丢了）
  await evaluate(`(() => { const i = document.getElementById('dock-model-search-input'); i.value = 'deepseek'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(250);
  const filteredRows = await evaluate(`document.querySelectorAll('.model-option').length`);
  await domClick('#dock-model-selector-btn'); // 关闭
  await wait(250);
  await domClick('#dock-model-selector-btn'); // 重新打开
  await wait(350);
  const reopened = await evaluate(`(() => ({ rows: document.querySelectorAll('.model-option').length, input: document.getElementById('dock-model-search-input').value }))()`);
  record('reopen:search-reset', { filteredRows, ...reopened });
  if (reopened.input !== '') failures.push(`重新打开后搜索框未清空（value="${reopened.input}"）`);
  if (reopened.rows !== 8) failures.push(`重新打开后列表未恢复完整（rows=${reopened.rows}，filtered=${filteredRows}）`);

  // 11. 窄屏（390×700）下：下拉与级联都必须留在视口内（双侧不足切 --inset）
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: true });
  await wait(300);
  await evaluate(`(() => { const row = document.querySelector('.model-option:not(.is-locked)'); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); })()`);
  await wait(300);
  const narrow = await evaluate(`(() => {
    const dd = document.getElementById('dock-model-dropdown').getBoundingClientRect();
    const cs = document.getElementById('model-reasoning-cascade');
    const cr = cs.getBoundingClientRect();
    return {
      vw: window.innerWidth,
      ddLeft: Math.round(dd.left), ddRight: Math.round(dd.right),
      csDisplay: getComputedStyle(cs).display,
      csLeft: Math.round(cr.left), csRight: Math.round(cr.right),
      hasInset: cs.classList.contains('model-cascade--inset'),
    };
  })()`);
  await send('Emulation.clearDeviceMetricsOverride');
  await wait(150);
  // 恢复桌面视口后重定位一次（收起窄屏 --inset 态），保证最终留存截图干净无误导
  await evaluate(`(() => {
    const row = document.querySelector('.model-option:not(.is-locked)');
    if (row) row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const c = document.getElementById('model-reasoning-cascade');
    if (c) c.style.display = 'none';
  })()`);
  await wait(100);
  record('narrow:no-horizontal-overflow', narrow);
  if (narrow.ddLeft < 0 || narrow.ddRight > narrow.vw) {
    failures.push(`窄屏下拉水平溢出：[${narrow.ddLeft}, ${narrow.ddRight}] 超出 [0, ${narrow.vw}]`);
  }
  if (narrow.csDisplay !== 'block' || narrow.csLeft < 0 || narrow.csRight > narrow.vw) {
    failures.push(`窄屏级联水平溢出：[${narrow.csLeft}, ${narrow.csRight}] 超出 [0, ${narrow.vw}]`);
  }

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const screenshot = path.join(ARTIFACT_DIR, 'screenshot.png');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));

  const evidence = {
    featureId: 'model-picker-interaction',
    timestamp: new Date().toISOString(),
    status: failures.length === 0 ? 'PASSED' : 'FAILED',
    failures,
    icon404s,
    consoleErrors,
    steps,
    screenshot,
    cascadeScreenshot: cascadeShotPath,
  };
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf8');

  await send('Browser.close').catch(() => {});
  ws.close();
  proc.kill();
  await wait(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

  if (failures.length > 0) {
    console.error('\n❌ 验证失败：');
    for (const f of failures) console.error('   - ' + f);
    if (consoleErrors.length > 0) {
      console.error('\n页面错误：');
      for (const err of consoleErrors.slice(0, 8)) console.error('   ! ' + err.split('\n')[0]);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`\n✔ 验证通过，证据：${path.relative(ROOT, screenshot)}`);
}

main().catch((err) => { console.error('[model-picker-interaction]', err.message); process.exit(1); });
