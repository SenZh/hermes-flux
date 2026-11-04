/**
 * PR-3d 左轨形态回归门禁（真实 Blink CDP，驱动 packages/desktop/dist 真实产物）。
 *
 * 【设计意图 (Why)】PR-3d 的用户可观察变更：微轨底部 +/‹ 两按钮删除；会话/群聊 header
 *   放大且删箭头、右侧新增 + 新建入口；会话行时间内联标题行且走"昨天/前天/M/D"紧凑规格。
 *   静态单测能测字符串，测不了"点击 header + 后弹窗落在哪个甲板"这类真链路，必须物理驱动。
 * 【防范的历史坑 (Pitfall)】PR-3b 教训"测试全绿但截图全白方块"——凡触碰视觉必须出图，
 *   本测试把截图落盘 artifacts/verification/（不入 Git）。
 * 【约束与规则 (Rules)】仅允许经 window.__fluxState/__fluxRender 调试面注入快照，
 *   点击一律走真实 DOM click；断言针对用户可观察 DOM/文本/几何。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const RENDERER_ENTRY = 'packages/desktop/dist/renderer/index.html';
const DAY_MS = 86400000;

test('NewTaskModal 双调用点必须同传 initialType（骨架全量与定点更新不得漂移）', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'packages/desktop/src/renderer/index.ts'), 'utf8');
  const calls = src.match(/renderNewTaskModal\(\{[\s\S]*?\}\);/g) ?? [];
  assert.equal(calls.length, 2, '调用点数量变化必须同步本守卫与两侧行为验证');
  for (const call of calls) {
    assert.ok(call.includes('initialType: state.newTaskModalTab'), `调用点漏传 initialType 会让甲板态在定点重渲染后回跳 solo: ${call.slice(0, 120)}`);
  }
});

test('formatSessionTime 必须是纯委托体（本 PR 根除的"第二份格式化器"永远不得复活）', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'packages/desktop/src/renderer/index.ts'), 'utf8');
  const fn = /function formatSessionTime\([\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'formatSessionTime 必须存在');
  assert.ok(fn[0].includes('formatLeftRailTime(timestamp)'), `formatSessionTime 必须委托 ui 真值源: ${fn[0].slice(0, 200)}`);
  assert.ok(!/getHours|getMonth|toDateString/.test(fn[0]), '函数体内禁止再出现任何日期分支——出现即说明有人重新养出第二份格式化器');
});

test('rail-cockpit-form: 微轨按钮收编、header 形态与时间内联（真实 renderer + 出图）', async (t) => {
  const browserPath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
  if (!browserPath) { t.skip('未找到 Edge/Chrome'); return; }
  const rootDir = process.cwd();
  if (!fs.existsSync(path.join(rootDir, RENDERER_ENTRY))) { t.skip('renderer 产物缺失，先 npm run build'); return; }

  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = `/${RENDERER_ENTRY}`;
    const filePath = path.join(rootDir, reqPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.writeHead(404); res.end('Not Found'); return; }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverPort = server.address().port;
  const portProbe = http.createServer();
  await new Promise((r) => portProbe.listen(0, '127.0.0.1', r));
  const cdpPort = portProbe.address().port;
  await new Promise((r) => portProbe.close(r));

  const tmpUserDataDir = path.resolve(os.tmpdir(), `flux-cdp-form-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const proc = spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`, '--headless=new', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', `--user-data-dir=${tmpUserDataDir}`,
    '--window-size=1280,800',
    `http://127.0.0.1:${serverPort}/${RENDERER_ENTRY}`,
  ], { stdio: 'ignore' });

  let ws = null;
  t.after(async () => {
    try { if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' })); await new Promise((r) => setTimeout(r, 500)); ws.close(); } } catch {}
    try { proc.kill(); } catch {}
    try { server.close(); } catch {}
    try { fs.rmSync(tmpUserDataDir, { recursive: true, force: true }); } catch {}
  });

  let wsUrl = null;
  const start = Date.now();
  while (Date.now() - start < 15000 && !wsUrl) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) { const targets = await res.json(); const page = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); if (page) wsUrl = page.webSocketDebuggerUrl; }
    } catch {}
    if (!wsUrl) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(wsUrl, 'CDP page target 必须可达');
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++msgId; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) throw new Error('页面表达式异常: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    return res.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable');

  const booted = await (async () => { for (let i = 0; i < 60; i++) { if (await evaluate('Boolean(window.__fluxState && window.__fluxRender)')) return true; await new Promise((r) => setTimeout(r, 250)); } return false; })();
  assert.ok(booted, '真实 renderer 调试面必须挂载（__fluxState/__fluxRender）');

  // 注入面前置独占：CI/审查机若恰有本地网关监听默认端口，init() 的 connect 会触发权威对账覆盖注入快照
  const isolated = await (async () => {
    for (let i = 0; i < 30; i++) {
      if (await evaluate('Boolean(window.__fluxState) && !window.__fluxState.gatewayConnected')) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  })();
  assert.ok(isolated, 'seed 前网关必须处于未连接态，否则 fetchSessions 对账会覆盖注入快照使断言环境依赖（本机 9119 有网关监听时该测试不可运行）');

  // 注入确定性快照：当日/昨天/前天/更早 四条会话 + 一个两人群聊
  const seeded = await evaluate(`(() => {
    const DAY = 86400000;
    const dayStart = new Date().setHours(0, 0, 0, 0);
    window.__fluxState.sessions = [
      { id: 's-today', title: '今天的会话', botName: 'default', timestamp: dayStart + 9 * 3600000 },
      { id: 's-yesterday', title: '昨天的会话', botName: 'default', timestamp: dayStart - DAY + 23 * 3600000 },
      { id: 's-dbefore', title: '前天的会话', botName: 'default', timestamp: dayStart - 2 * DAY + 8 * 3600000 },
      { id: 's-old', title: '更早的会话', botName: 'default', timestamp: dayStart - 30 * DAY },
    ];
    window.__fluxState.groupRooms = [{ roomId: 'room-form-check', name: '形态验证群', members: ['default'], updatedAt: dayStart - DAY }];
    window.__fluxRender();
    return true;
  })()`);
  assert.ok(seeded);
  await new Promise((r) => setTimeout(r, 300));

  await t.test('微轨底部 +/‹ 两按钮已删除，且把手仍在位', async () => {
    const gone = await evaluate(`(() => ({
      newChat: Boolean(document.getElementById('new-chat-btn')),
      collapseInRail: Boolean(document.querySelector('#flux-station-rail svg.lucide-chevron-left')),
      handle: Boolean(document.querySelector('.rail-resize-handle[data-rail-handle=left]')),
    }))()`);
    assert.equal(gone.newChat, false, '#new-chat-btn 必须从微轨消失');
    assert.equal(gone.collapseInRail, false, '微轨内不得再有折叠按钮（入口收编顶栏与 Ctrl+B）');
    assert.equal(gone.handle, true, '拖拽把手必须保留（正向对照，证明左轨整体在渲染）');
  });

  await t.test('会话/群聊 header：13px 字号、无文本箭头、右侧 + 按钮在位', async () => {
    const headers = await evaluate(`(() => {
      const read = (sel, btnSel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const btn = document.querySelector(btnSel);
        return { fontSize: cs.fontSize, height: Math.round(el.getBoundingClientRect().height), hasArrow: /[⌄›]/.test(el.textContent), plusExists: Boolean(btn) };
      };
      return { sessions: read('#rail-sessions-accordion-trigger', '.rail-new-session-btn'), groups: read('#rail-groups-accordion-trigger', '.rail-new-group-btn') };
    })()`);
    for (const [name, h] of Object.entries(headers)) {
      assert.ok(h, `${name} header 必须存在`);
      assert.equal(h.hasArrow, false, `${name} header 禁止残留 ⌄/› 文本箭头`);
      assert.ok(parseFloat(h.fontSize) >= 13, `${name} header 字号必须 ≥13px（实测 ${h.fontSize}）`);
      assert.ok(h.height >= 28, `${name} header 行高必须 ≥28px（实测 ${h.height}px）`);
      assert.ok(h.plusExists, `${name} header 右侧 + 按钮必须在位`);
    }
  });

  await t.test('会话行时间内联标题行且走紧凑规格：昨天/前天/M/D 不带时分', async () => {
    const rows = await evaluate(`(() => {
      const grab = (id) => {
        const row = document.querySelector('.session-item[data-id="' + id + '"]');
        if (!row) return null;
        const time = row.querySelector('time');
        const titleSpan = row.querySelector('span > span');
        const inline = Boolean(time && titleSpan && titleSpan.contains(time));
        return { text: time?.textContent ?? '', inline, rowRight: row.getBoundingClientRect().right, timeRight: time ? +time.getBoundingClientRect().right.toFixed(0) : null };
      };
      return { today: grab('s-today'), yesterday: grab('s-yesterday'), dbefore: grab('s-dbefore'), old: grab('s-old') };
    })()`);
    assert.match(rows.today.text, /^\d{2}:\d{2}$/, `当日必须 HH:mm，实测 "${rows.today.text}"`);
    assert.equal(rows.yesterday.text, '昨天', `昨天必须只给日名，实测 "${rows.yesterday.text}"`);
    assert.equal(rows.dbefore.text, '前天', `前天必须只给日名，实测 "${rows.dbefore.text}"`);
    assert.match(rows.old.text, /^\d{1,2}\/\d{1,2}$/, `更早必须 M/D，实测 "${rows.old.text}"`);
    for (const [id, r] of Object.entries(rows)) {
      assert.ok(r.inline, `${id} 的时间必须内联在标题行内（与 GroupRow 同构），不得再挤占副标题列`);
      assert.ok(r.rowRight - r.timeRight <= 16, `${id} 时间必须贴近行右缘（实测差 ${r.rowRight - r.timeRight}px）`);
    }
  });

  await t.test('header + 物理点击：会话入新建弹窗 solo 甲板，群聊入 group 甲板', async () => {
    await evaluate(`document.querySelector('.rail-new-session-btn').click()`);
    await new Promise((r) => setTimeout(r, 400));
    const soloState = await evaluate(`(() => ({
      open: Boolean(document.getElementById('new-task-modal-container')),
      tab: window.__fluxState.newTaskModalTab,
      soloVisible: getComputedStyle(document.getElementById('modal-section-solo-agent')).display !== 'none',
      groupVisible: getComputedStyle(document.getElementById('modal-section-group-members')).display !== 'none',
    }))()`);
    assert.ok(soloState.open, '点击会话 header + 必须弹出新建弹窗');
    assert.equal(soloState.tab, 'solo');
    assert.ok(soloState.soloVisible && !soloState.groupVisible, `弹窗必须落在 solo 甲板: ${JSON.stringify(soloState)}`);
    await evaluate(`document.getElementById('btn-cancel-task-modal')?.click()`);
    await new Promise((r) => setTimeout(r, 300));

    await evaluate(`document.querySelector('.rail-new-group-btn').click()`);
    await new Promise((r) => setTimeout(r, 400));
    const groupState = await evaluate(`(() => ({
      tab: window.__fluxState.newTaskModalTab,
      groupVisible: getComputedStyle(document.getElementById('modal-section-group-members')).display !== 'none',
      soloVisible: getComputedStyle(document.getElementById('modal-section-solo-agent')).display !== 'none',
    }))()`);
    assert.equal(groupState.tab, 'group', '群聊 header + 必须把 newTaskModalTab 定为 group');
    assert.ok(groupState.groupVisible && !groupState.soloVisible, `弹窗必须落在 group 甲板: ${JSON.stringify(groupState)}`);
    await evaluate(`document.getElementById('btn-cancel-task-modal')?.click()`);
    await new Promise((r) => setTimeout(r, 300));
  });

  await t.test('视觉净化细化：会话选中去边框采用纯对比色、群聊移除3点且时间靠右、左轨剥离滚动条与微轨沉底', async () => {
    // 激活第一个会话
    await evaluate(`document.querySelector('.session-item[data-id="s-today"]')?.click()`);
    await new Promise((r) => setTimeout(r, 200));

    const check = await evaluate(`(() => {
      const activeSession = document.querySelector('.session-item[data-id="s-today"]');
      const cs = activeSession ? getComputedStyle(activeSession) : null;
      const innerBar = activeSession ? activeSession.querySelector('span.absolute.inset-y-2') : null;
      const groupDots = document.querySelector('.rail-group-item svg.lucide-more-horizontal');
      const groupRow = document.querySelector('.rail-group-item');
      const groupTime = groupRow ? groupRow.querySelector('time') : null;
      const groupRight = groupRow ? groupRow.getBoundingClientRect().right : 0;
      const groupTimeRight = groupTime ? groupTime.getBoundingClientRect().right : 0;

      const railEl = document.getElementById('flux-left-rail');
      const railCs = railEl ? getComputedStyle(railEl) : null;
      const stationEl = document.getElementById('flux-station-rail');
      const stationCs = stationEl ? getComputedStyle(stationEl) : null;
      const scrollArea = document.getElementById('session-list-container');
      const scrollCs = scrollArea ? getComputedStyle(scrollArea) : null;

      return {
        sessionBorderWidth: cs ? cs.borderLeftWidth : null,
        sessionHasActiveBg: activeSession ? activeSession.classList.contains('bg-card-active') : false,
        innerBarExists: Boolean(innerBar),
        groupDotsExists: Boolean(groupDots),
        groupIsButton: groupRow ? groupRow.tagName.toLowerCase() === 'button' : false,
        groupTimeRightDiff: Math.round(groupRight - groupTimeRight),
        railScrollbarWidth: railCs ? railCs.scrollbarWidth : null,
        scrollAreaScrollbarWidth: scrollCs ? scrollCs.scrollbarWidth : null,
        stationIsPanel: stationEl ? stationEl.classList.contains('bg-panel') : false,
      };
    })()`);

    assert.equal(check.innerBarExists, false, '选中会话必须彻底移除左内侧浮动高亮竖条');
    assert.equal(check.sessionBorderWidth, '0px', '选中会话不需要边框（对齐参考图：纯对比色无边框）');
    assert.equal(check.sessionHasActiveBg, true, '选中会话必须采用 bg-card-active 对比背景色');
    assert.equal(check.groupDotsExists, false, '群聊右侧 3 个点操作入口必须彻底删除');
    assert.equal(check.groupIsButton, true, '群聊列表项必须是单层 button 扁平化容器');
    assert.ok(check.groupTimeRightDiff <= 16, `群聊时间必须靠右对齐（当前差 ${check.groupTimeRightDiff}px）`);
    assert.equal(check.railScrollbarWidth, 'none', '左轨容器 scrollbarWidth 必须为 none');
    assert.equal(check.scrollAreaScrollbarWidth, 'none', '会话列表容器 scrollbarWidth 必须为 none');
    assert.equal(check.stationIsPanel, true, '微轨必须使用 bg-panel 沉底，修复浅色模式下纯白刺眼');

    // 状态指示点与时间同轴对齐、主工位卡去边框、微轨焦点保活
    const dotAlignment = await evaluate(`(() => {
      const primaryCard = document.querySelector('.rail-primary-agent-card');
      const primaryCs = primaryCard ? getComputedStyle(primaryCard) : null;

      const sessionRow = document.querySelector('.session-item[data-id="s-today"]');
      const timeEl = sessionRow ? sessionRow.querySelector('time') : null;
      const dotEl = sessionRow ? sessionRow.querySelector('.activity-pulse-indicator, .activity-unread-badge') : null;

      const defaultStationBtn = document.querySelector('#flux-station-rail [data-profile="default"]');
      const stationCs = defaultStationBtn ? getComputedStyle(defaultStationBtn) : null;

      return {
        primaryCardBorderWidth: primaryCs ? primaryCs.borderLeftWidth : null,
        timeRight: timeEl ? Math.round(timeEl.getBoundingClientRect().right) : null,
        dotRight: dotEl ? Math.round(dotEl.getBoundingClientRect().right) : null,
        stationHasPrimaryBorder: defaultStationBtn ? defaultStationBtn.classList.contains('border-primary') : false,
      };
    })()`);

    assert.equal(dotAlignment.primaryCardBorderWidth, '0px', '专职 Bot 主工位卡去边框纯对比色（对齐会话行）');
    assert.equal(dotAlignment.stationHasPrimaryBorder, true, '切到普通会话时微轨对应的 Agent 头像必须持续保持高亮选中态');
  });

  await t.test('PR-3e 壳层真值面：底栏彻底拔除、延迟移至顶栏右上角、标题栏真实头像去 (Forever Chat) 与小绿点', async () => {
    // 注入连接状态与网关延迟，切到专职 Bot 工位
    await evaluate(`(() => {
      window.__fluxState.gatewayConnected = true;
      window.__fluxState.gatewayLatencyMs = 24;
      window.__fluxState.activeFocus = { type: 'bot', botName: 'default' };
      window.__fluxState.profiles = [
        { name: 'default', displayName: 'Default 助理', avatar: 'data:image/png;base64,mockAvatar' }
      ];
      window.__fluxRender();
    })()`);
    await new Promise((r) => setTimeout(r, 300));

    const shellCheck = await evaluate(`(() => {
      const statusHost = document.getElementById('react-statusbar-host');
      const statusBar = document.getElementById('app-status-bar');
      const titleEl = document.querySelector('.titlebar-session-title');
      const titleCs = titleEl ? getComputedStyle(titleEl) : null;
      const titleText = titleEl?.textContent ?? '';
      const botAvatar = document.querySelector('.titlebar-center .titlebar-bot-avatar');
      const greenDot = document.querySelector('.titlebar-center .session-live-pulse');
      const latencyEl = document.querySelector('.titlebar-right .titlebar-latency');

      return {
        statusHostExists: Boolean(statusHost),
        statusBarExists: Boolean(statusBar),
        titleText,
        titleFontSize: titleCs ? titleCs.fontSize : '',
        hasForeverChat: titleText.includes('Forever Chat'),
        hasBotEmoji: titleText.includes('🤖'),
        greenDotExists: Boolean(greenDot),
        botAvatarExists: Boolean(botAvatar),
        latencyText: latencyEl?.textContent ?? '',
      };
    })()`);

    assert.equal(shellCheck.statusHostExists, false, '状态底栏宿主 react-statusbar-host 必须从 DOM 彻底删除');
    assert.equal(shellCheck.statusBarExists, false, '状态底栏 app-status-bar 必须彻底删除');
    assert.equal(shellCheck.hasForeverChat, false, '标题栏禁止夹带 (Forever Chat) 冗余后缀');
    assert.equal(shellCheck.hasBotEmoji, false, '标题栏禁止使用 🤖 emoji 伪冒头像');
    assert.equal(shellCheck.greenDotExists, false, '标题栏中心禁止插入 session-live-pulse 小绿点');
    assert.equal(shellCheck.titleFontSize, '12px', '顶栏标题字号必须收敛至 12px 极简规范');
    assert.equal(shellCheck.titleText, 'Default 助理', '专职 Bot 标题必须直接呈现纯净 Bot 名称');
    assert.equal(shellCheck.botAvatarExists, true, '专职 Bot 工位顶栏必须渲染真实 Bot 头像组件');
    assert.equal(shellCheck.latencyText, '24ms', '顶栏右上角必须低调呈现 24ms 网关延迟');

    // 切到群聊工位，验证群聊真实拼图微头像与纯净群名
    await evaluate(`(() => {
      window.__fluxState.activeFocus = { type: 'group', roomId: 'room-form-check' };
      window.__fluxRender();
    })()`);
    await new Promise((r) => setTimeout(r, 200));

    const groupCheck = await evaluate(`(() => {
      const titleText = document.querySelector('.titlebar-session-title')?.textContent ?? '';
      const groupAvatar = document.querySelector('.titlebar-center .titlebar-group-avatar');
      return {
        titleText,
        hasGroupEmoji: titleText.includes('👥'),
        groupAvatarExists: Boolean(groupAvatar),
      };
    })()`);

    assert.equal(groupCheck.hasGroupEmoji, false, '群聊顶栏标题禁止包含 👥 伪 emoji');
    assert.equal(groupCheck.titleText, '形态验证群', '群聊顶栏标题必须呈现纯净群名');
    assert.equal(groupCheck.groupAvatarExists, true, '群聊工位顶栏必须渲染真实拼图微头像');
  });

  // 出图取证（artifacts 不入 Git，教训 D.4：凡触碰视觉必须出图）
  const shotDir = path.join(rootDir, 'artifacts', 'verification');
  fs.mkdirSync(shotDir, { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, 'pr3e-shell-truth.png'), Buffer.from(shot.data, 'base64'));
  console.log(`  PR-3e 截图取证: ${path.join(shotDir, 'pr3e-shell-truth.png')}`);
});
