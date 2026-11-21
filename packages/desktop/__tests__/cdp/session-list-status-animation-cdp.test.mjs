import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const REQUIRED_ARTIFACTS = [
  'packages/core/dist/index.js',
  'packages/ui/dist/index.js',
  'packages/desktop/dist/renderer/leftrail/leftRailSnapshotManager.mjs',
  'packages/desktop/dist/renderer/styles.css',
  'packages/desktop/dist/renderer/conversation.css',
  'packages/desktop/dist/renderer/tailwind.css',
];

function parseRgb(rgbStr) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgbStr || '');
  return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : null;
}

test('session-list-status-animation: 流云渐变丝带、轻盈状态词、纯合成层多谐波动效与双肤出图', async (t) => {
  const browserPath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
  if (!browserPath) {
    t.skip('未找到 Edge/Chrome');
    return;
  }
  const rootDir = process.cwd();
  if (REQUIRED_ARTIFACTS.some((rel) => !fs.existsSync(path.join(rootDir, rel)))) {
    t.skip('构建产物缺失，请先执行 npm run build');
    return;
  }

  const harnessCode = `
    import { mountLeftRail, setLocale } from './packages/ui/dist/index.js';
    import {
      ActivityTransitionTracker,
      applyTurnStarted,
      applyTurnCompleted,
      applyEnteredRead,
    } from './packages/core/dist/index.js';
    import { LeftRailSnapshotManager } from './packages/desktop/dist/renderer/leftrail/leftRailSnapshotManager.mjs';

    setLocale('zh-CN');
    const runningSessions = new Set();
    const unreadSessions = new Set();
    const runningBots = new Set();
    const unreadBots = new Set();
    const runningGroups = new Set();
    const unreadGroups = new Set();
    const tracker = new ActivityTransitionTracker({ windowMs: 850 });
    let refreshTimer = null;

    const state = {
      theme: 'obsidian-gold',
      gatewayConnected: false,
      gatewayLatencyMs: 0,
      profilesPhase: 'ready',
      sessionsPhase: 'ready',
      profileName: 'default',
      activeFocus: { type: 'bot', botName: 'default' },
      activeSessionId: '',
      profiles: [],
      sessions: [],
      groupRooms: [],
      projects: [],
      sessionSearchQuery: '',
      isSessionsGroupExpanded: true,
      isGroupsGroupExpanded: true,
      sessionListError: '',
      leftRailCollapsed: false,
      editingGroupRoomId: undefined,
      activityVariant: 'cloud',
    };

    const snapshotManager = new LeftRailSnapshotManager({
      getSessions: () => state.sessions,
      getGroupRooms: () => state.groupRooms,
      getProfiles: () => state.profiles,
      getActiveSessionId: () => state.activeSessionId,
      getActiveFocus: () => state.activeFocus,
      getProfileName: () => state.profileName,
      getSearchQuery: () => state.sessionSearchQuery,
      isSessionsGroupExpanded: () => state.isSessionsGroupExpanded,
      isGroupsGroupExpanded: () => state.isGroupsGroupExpanded,
      getError: () => state.sessionListError,
      isCollapsed: () => state.leftRailCollapsed,
      getEditingGroupRoomId: () => state.editingGroupRoomId,
      getProfilesPhase: () => state.profilesPhase,
      getSessionsPhase: () => state.sessionsPhase,
      getActivityVariant: () => state.activityVariant,
      getActiveRunningSessionIds: () => runningSessions,
      getUnreadSessionIds: () => unreadSessions,
      getActiveStreamingStoredSessionId: () => null,
      getActiveRunningGroupRoomIds: () => runningGroups,
      getUnreadGroupRoomIds: () => unreadGroups,
      getActiveRunningBotNames: () => runningBots,
      getUnreadBotNames: () => unreadBots,
      resolveAgentAvatar: () => '',
      resolveTransition: (scope, id, st, now) => tracker.resolveTransition(scope, id, st, now),
    });

    const noop = () => {};
    const actions = {
      onSelectSession: noop,
      onSelectBot: noop,
      onSelectGroup: noop,
      onOpenSessionMenu: noop,
      onOpenBotMenu: noop,
      onOpenGroupMenu: noop,
      onSearchChange: noop,
      onNewChat: noop,
      onToggleSessions: noop,
      onToggleGroups: noop,
      onStartGroupRename: noop,
      onConfirmGroupRename: noop,
      onCancelGroupRename: noop,
      onResizeStart: noop,
    };

    const host = document.getElementById('rail-host');
    const pushRail = mountLeftRail(host, () => snapshotManager.getSnapshot(), actions);
    const render = () => pushRail();

    function scheduleRefresh() {
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      const delay = tracker.nextExpiryDelayMs(Date.now());
      if (delay === null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        scheduleRefresh();
        render();
      }, delay);
    }

    function domainSets(domain) {
      if (domain === 'session') return [runningSessions, unreadSessions];
      if (domain === 'bot') return [runningBots, unreadBots];
      return [runningGroups, unreadGroups];
    }

    window.__fluxState = state;
    window.__fluxRender = render;
    window.__fluxActivity = {
      startTurn: (domain, entityId) => {
        const [running, unread] = domainSets(domain);
        applyTurnStarted(running, unread, entityId);
        tracker.clear(domain, entityId);
        render();
      },
      completeTurn: (domain, entityId, isFocused) => {
        const [running, unread] = domainSets(domain);
        const wasRunning = running.has(entityId);
        applyTurnCompleted(running, unread, entityId, isFocused);
        if (wasRunning) {
          tracker.recordCompleted(domain, entityId, isFocused ? 'read' : 'unread', Date.now());
          scheduleRefresh();
        }
        render();
      },
      enterRead: (domain, entityId) => {
        const [, unread] = domainSets(domain);
        applyEnteredRead(unread, entityId);
        tracker.clear(domain, entityId);
        render();
      },
    };
  `;

  const built = await esbuild.build({
    stdin: { contents: harnessCode, resolveDir: rootDir, loader: 'js' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const harnessJs = built.outputFiles[0].text;
  const harnessHtml = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="obsidian-gold">
<head>
  <meta charset="UTF-8">
  <title>Hermes Flux Activity Indicator CDP</title>
  <link rel="stylesheet" href="/packages/desktop/dist/renderer/styles.css">
  <link rel="stylesheet" href="/packages/desktop/dist/renderer/conversation.css">
  <link rel="stylesheet" href="/packages/desktop/dist/renderer/tailwind.css">
</head>
<body style="margin:0;width:100vw;height:100vh;display:flex;background:var(--background);color:var(--foreground);font-family:var(--font-sans);">
  <div id="rail-host" style="display:flex;height:100%;"></div>
  <script src="/harness.js"></script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/' || reqPath === '/harness.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(harnessHtml);
      return;
    }
    if (reqPath === '/harness.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(harnessJs);
      return;
    }
    const filePath = path.join(rootDir, reqPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.map': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
    };
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverPort = server.address().port;
  const portProbe = http.createServer();
  await new Promise((r) => portProbe.listen(0, '127.0.0.1', r));
  const cdpPort = portProbe.address().port;
  await new Promise((r) => portProbe.close(r));

  const tmpUserDataDir = path.resolve(os.tmpdir(), `flux-cdp-anim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const proc = spawn(browserPath, [
    `--remote-debugging-port=${cdpPort}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${tmpUserDataDir}`,
    '--window-size=1280,800',
    `http://127.0.0.1:${serverPort}/harness.html`,
  ], { stdio: 'ignore' });

  let ws = null;
  t.after(async () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: 999999, method: 'Browser.close' }));
        await new Promise((r) => setTimeout(r, 400));
        ws.close();
      }
    } catch {}
    try { proc.kill(); } catch {}
    try { server.close(); } catch {}
    try { fs.rmSync(tmpUserDataDir, { recursive: true, force: true }); } catch {}
  });

  let wsUrl = null;
  const start = Date.now();
  while (Date.now() - start < 15000 && !wsUrl) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
        if (page) wsUrl = page.webSocketDebuggerUrl;
      }
    } catch {}
    if (!wsUrl) await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(wsUrl, 'CDP page target 必须可达');

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result);
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++msgId;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error(`Evaluate 失败: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  let hooksReady = false;
  for (let i = 0; i < 60; i++) {
    hooksReady = Boolean(await evaluate('Boolean(window.__fluxState && window.__fluxRender && window.__fluxActivity && document.getElementById("flux-station-rail"))'));
    if (hooksReady) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.equal(hooksReady, true, '渲染器调试挂点与左轨必须完成挂载');

  const now = Date.now();
  await evaluate(`(() => {
    const st = window.__fluxState;
    st.theme = 'warm-paper';
    document.documentElement.setAttribute('data-theme', 'warm-paper');
    document.documentElement.setAttribute('data-appearance', 'light');
    st.gatewayConnected = true;
    st.gatewayLatencyMs = 18;
    st.profilesPhase = 'ready';
    st.sessionsPhase = 'ready';
    st.profileName = 'arch-wang';
    st.activeFocus = { type: 'bot', botName: 'arch-wang' };
    st.activeSessionId = 's-read';
    st.profiles = [
      { name: 'default', displayName: 'Default 助理', isDefault: true, lastMessage: '全局在线', lastTime: '10:00', timestamp: ${now - 600000} },
      { name: 'arch-wang', displayName: '架构老王', description: '系统架构师', lastMessage: '正在分析并发锁模型', lastTime: '10:42', timestamp: ${now - 60000} },
      { name: 'fe-zhang', displayName: '前端小张', description: 'UI 专家', lastMessage: '组件重构已完成', lastTime: '09:30', timestamp: ${now - 120000} }
    ];
    st.sessions = [
      { id: 's-running', title: '并发轮询修复任务', preview: '正在推演状态机边界...', timestamp: ${now - 10000}, time: '10:41', botName: 'arch-wang', projectId: 'proj-flux', cwd: 'D:/ws/hermes-aura' },
      { id: 's-unread-hist', title: '历史已完成会话', preview: '构建验证全部通过', timestamp: ${now - 90000}, time: '10:12', botName: 'arch-wang' },
      { id: 's-read', title: '已读稳定会话', preview: '已完成查看', timestamp: ${now - 180000}, time: '09:50', botName: 'arch-wang' }
    ];
    st.groupRooms = [
      { roomId: 'g-running', name: '三态架构评审群', members: ['arch-wang', 'fe-zhang'], lastMessage: '成员正在讨论中...', updatedAt: ${now - 15000} },
      { roomId: 'g-read', name: '已读历史群', members: ['default', 'arch-wang'], lastMessage: '结论已确认', updatedAt: ${now - 300000} }
    ];
    st.projects = [
      { id: 'proj-flux', name: 'hermes-flux', path: 'D:/ws/hermes-aura' }
    ];

    window.__fluxActivity.startTurn('session', 's-running');
    window.__fluxActivity.startTurn('session', 's-unread-hist');
    window.__fluxActivity.completeTurn('session', 's-unread-hist', false);

    window.__fluxActivity.startTurn('bot', 'arch-wang');
    window.__fluxActivity.startTurn('bot', 'fe-zhang');
    window.__fluxActivity.completeTurn('bot', 'fe-zhang', false);

    window.__fluxActivity.startTurn('group', 'g-running');
  })()`);

  await new Promise((r) => setTimeout(r, 950));

  const lightMetrics = await evaluate(`(() => {
    const sessRow = document.querySelector('.session-item[data-id="s-running"]');
    const sessRun = sessRow ? sessRow.querySelector('.activity-pulse-indicator') : null;
    const sessRunStreams = sessRun ? Array.from(sessRun.querySelectorAll('.flux-cloud-stream')) : [];
    const sessRunGlint = sessRun ? sessRun.querySelector('.flux-cloud-glint') : null;
    const sessRunHasSvg = Boolean(sessRow && sessRow.querySelector('svg'));
    const sessHistUnread = document.querySelector('.session-item[data-id="s-unread-hist"] .activity-unread-badge');
    const sessHistDoneRing = sessHistUnread ? sessHistUnread.querySelector('.flux-cloud-done-ring') : null;
    const sessHistCheck = sessHistUnread ? sessHistUnread.querySelector('.flux-cloud-check') : null;
    const sessHistDoneLabel = sessHistUnread ? sessHistUnread.querySelector('.flux-cloud-label--done') : null;
    const sessRead = document.querySelector('.session-item[data-id="s-read"]');

    const botCardRun = document.querySelector('.rail-primary-agent-card[data-primary-bot="arch-wang"] .activity-pulse-indicator');
    const stationBotRunBtn = document.querySelector('#flux-station-rail [data-station-profile="arch-wang"]');
    const stationBotRun = stationBotRunBtn ? stationBotRunBtn.querySelector('.activity-pulse-indicator') : null;
    const stationBotUnread = document.querySelector('#flux-station-rail [data-station-profile="fe-zhang"] .activity-unread-badge');
    const groupRowRun = document.querySelector('.rail-group-item[data-room-id="g-running"] .activity-pulse-indicator');
    const groupRowRead = document.querySelector('.rail-group-item[data-room-id="g-read"]');

    const firstStream = sessRunStreams[0] || null;
    const csCorner = stationBotRun ? getComputedStyle(stationBotRun) : null;
    const csCornerAfter = stationBotRun ? getComputedStyle(stationBotRun, '::after') : null;
    const csFirstStream = firstStream ? getComputedStyle(firstStream) : null;
    const csGlint = sessRunGlint ? getComputedStyle(sessRunGlint) : null;
    const csDoneRing = sessHistDoneRing ? getComputedStyle(sessHistDoneRing) : null;
    const csDoneLabel = sessHistDoneLabel ? getComputedStyle(sessHistDoneLabel) : null;
    const sessRunLabel = sessRun ? sessRun.querySelector('.flux-cloud-label--running') : null;
    const csSessRunLabel = sessRunLabel ? getComputedStyle(sessRunLabel) : null;
    const botCardTitle = document.querySelector('.rail-primary-agent-card[data-primary-bot="arch-wang"] .truncate.text-body');
    const botCardTitleEllipsis = botCardTitle ? botCardTitle.scrollWidth > botCardTitle.clientWidth : true;

    const botBtnRect = stationBotRunBtn ? stationBotRunBtn.getBoundingClientRect() : null;
    const botDotRect = stationBotRun ? stationBotRun.getBoundingClientRect() : null;
    const timeEl = sessRow ? sessRow.querySelector('time') : null;
    const timeRight = timeEl ? timeEl.getBoundingClientRect().right : 0;
    const rowRight = sessRow ? sessRow.getBoundingClientRect().right : 0;
    const harmonicDurations = [...sessRunStreams, sessRunGlint].filter(Boolean).map((el) => getComputedStyle(el).animationDuration);

    return {
      hasAllRunning: Boolean(sessRun && botCardRun && stationBotRun && groupRowRun),
      hasUnread: Boolean(sessHistUnread && stationBotUnread),
      readHasZeroDots: Boolean(
        sessRead && !sessRead.querySelector('.activity-pulse-indicator, .activity-unread-badge, .activity-settle-fade')
        && groupRowRead && !groupRowRead.querySelector('.activity-pulse-indicator, .activity-unread-badge, .activity-settle-fade')
      ),
      cloudStreamCount: sessRunStreams.length,
      hasGlint: Boolean(sessRunGlint),
      hasDoneCheck: Boolean(sessHistDoneRing && sessHistCheck),
      harmonicDurations,
      sessRunHasSvg,
      cornerIsSimple: Boolean(stationBotRun && !stationBotRun.querySelector('.flux-cloud-canvas')),
      cornerSize: csCorner ? [csCorner.width, csCorner.height] : null,
      cornerAfterAnim: csCornerAfter ? csCornerAfter.animationName : null,
      runInkBg: csGlint ? csGlint.backgroundColor : null,
      cloudStreamAnim: csFirstStream ? csFirstStream.animationName : null,
      doneRingColor: csDoneRing ? csDoneRing.borderTopColor : null,
      runLabelDisplay: csSessRunLabel ? csSessRunLabel.display : null,
      runLabelColor: csSessRunLabel ? csSessRunLabel.color : null,
      runLabelAnim: csSessRunLabel ? csSessRunLabel.animationName : null,
      runLabelFontWeight: csSessRunLabel ? csSessRunLabel.fontWeight : null,
      runLabelFontSize: csSessRunLabel ? csSessRunLabel.fontSize : null,
      doneLabelFontWeight: csDoneLabel ? csDoneLabel.fontWeight : null,
      botCardTitleFull: !botCardTitleEllipsis,
      histUnreadTransition: sessHistUnread ? sessHistUnread.getAttribute('data-transition') : null,
      histUnreadDoneRingAnim: csDoneRing ? csDoneRing.animationName : null,
      botCornerInside: Boolean(botBtnRect && botDotRect && botDotRect.right <= botBtnRect.right + 1 && botDotRect.top >= botBtnRect.top - 1),
      timeRightGap: Math.round(rowRight - timeRight),
      runningText: sessRun ? sessRun.textContent : '',
      unreadText: sessHistUnread ? sessHistUnread.textContent : '',
      botText: botCardRun ? botCardRun.textContent : '',
      groupText: groupRowRun ? groupRowRun.textContent : '',
    };
  })()`);

  assert.equal(lightMetrics.hasAllRunning, true, '三类列表与微轨 Bot 必须全部渲染 running 指示器');
  assert.equal(lightMetrics.hasUnread, true, '历史未读必须渲染已完成指示器');
  assert.equal(lightMetrics.readHasZeroDots, true, '静态已读会话与群聊必须零特殊状态节点');
  assert.equal(lightMetrics.cloudStreamCount, 3, '流云必须精确渲染 3 条渐变丝带');
  assert.equal(lightMetrics.hasGlint, true, '流云必须包含 1 颗微星流光');
  assert.equal(lightMetrics.hasDoneCheck, true, '流云完成态必须渲染完成环与对勾');
  assert.equal(new Set(lightMetrics.harmonicDurations).size, 4, `流云四层运动周期必须互不相同，实测 ${JSON.stringify(lightMetrics.harmonicDurations)}`);
  assert.equal(lightMetrics.sessRunHasSvg, false, '普通会话行内严禁出现 <svg> 标签');
  assert.equal(lightMetrics.cornerIsSimple, true, '头像角标必须保持简洁圆点，不含云朵画布');
  assert.deepEqual(lightMetrics.cornerSize, ['8px', '8px'], '头像角标必须保持 8x8');
  assert.equal(lightMetrics.cornerAfterAnim, 'fluxActivityPulseRing', '头像角标脉冲环动画必须生效');
  assert.equal(lightMetrics.cloudStreamAnim, 'fluxCloudRibbonTop', '流云丝带必须运行渐变漂移动画');
  assert.equal(lightMetrics.histUnreadTransition, 'none', '超过窗口的历史未读必须回落 none');
  assert.equal(lightMetrics.histUnreadDoneRingAnim, 'none', '历史未读不得重播完成环动画');
  assert.equal(lightMetrics.botCornerInside, true, '微轨 Bot 角标必须落在按钮边界内');
  assert.ok(lightMetrics.timeRightGap <= 16, `时间必须紧贴行右缘，当前差 ${lightMetrics.timeRightGap}px`);
  assert.equal(lightMetrics.runningText, '执行中');
  assert.equal(lightMetrics.botText, '思考中');
  assert.equal(lightMetrics.groupText, '协作中');
  assert.equal(lightMetrics.unreadText, '已完成');

  const runRgb = parseRgb(lightMetrics.runInkBg);
  const doneRgb = parseRgb(lightMetrics.doneRingColor);
  const labelRgb = parseRgb(lightMetrics.runLabelColor);
  assert.ok(runRgb && runRgb.b > runRgb.g && runRgb.b > runRgb.r, `运行态必须为纯蓝色系，实测 ${lightMetrics.runInkBg}`);
  assert.ok(doneRgb && doneRgb.b > doneRgb.g && doneRgb.b > doneRgb.r, `完成态必须为纯蓝色系（严禁绿色），实测 ${lightMetrics.doneRingColor}`);
  assert.ok(labelRgb && labelRgb.b > labelRgb.g && labelRgb.b > labelRgb.r, `流光状态文字必须为纯蓝色系，实测 ${lightMetrics.runLabelColor}`);
  assert.notEqual(lightMetrics.runLabelDisplay, 'none', '普通会话行在默认宽度下必须展示流光状态文字');
  assert.equal(lightMetrics.runLabelAnim, 'fluxCloudLabelPulse', '流光状态文字必须走纯 GPU opacity 呼吸');
  assert.equal(lightMetrics.runLabelFontWeight, '400', '运行状态文字必须保持轻盈 regular (400) 字重');
  assert.equal(lightMetrics.runLabelFontSize, '11px', '运行状态文字必须对齐 11px caption 阶梯');
  assert.equal(lightMetrics.doneLabelFontWeight, '400', '已完成文字必须保持轻盈 regular (400) 字重');
  assert.equal(lightMetrics.botCardTitleFull, true, '窄抽屉下主工位卡大标题「架构老王」必须完整显示不被截断');

  const verifyDir = path.join(rootDir, 'artifacts', 'verification');
  fs.mkdirSync(verifyDir, { recursive: true });
  const lightShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(verifyDir, 'session-status-light.png'), Buffer.from(lightShot.data, 'base64'));

  await evaluate(`(() => {
    window.__fluxState.theme = 'obsidian-gold';
    document.documentElement.setAttribute('data-theme', 'obsidian-gold');
    document.documentElement.setAttribute('data-appearance', 'dark');
    window.__fluxRender();
  })()`);
  await new Promise((r) => setTimeout(r, 150));

  const darkBlue = await evaluate(`(() => {
    const dot = document.querySelector('.session-item[data-id="s-running"] .flux-cloud-glint');
    return dot ? getComputedStyle(dot).backgroundColor : null;
  })()`);
  const darkRgb = parseRgb(darkBlue);
  // 深色皮肤的活动态取亮白（与 --primary 同源），浅色皮肤仍是蓝；判据必须跟着主题极性走。
  assert.ok(
    darkRgb
      && Math.abs(darkRgb.r - darkRgb.g) <= 2
      && Math.abs(darkRgb.g - darkRgb.b) <= 2
      && darkRgb.r >= 200,
    `深色模式下活动指示器必须为亮白色系，实测 ${darkBlue}`,
  );

  const darkShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(verifyDir, 'session-status-dark.png'), Buffer.from(darkShot.data, 'base64'));

  await evaluate(`(() => {
    document.documentElement.dataset.pageHidden = 'true';
    window.__fluxRender();
  })()`);
  const pausedState = await evaluate(`(() => {
    const els = Array.from(document.querySelectorAll('.session-item[data-id="s-running"] .flux-cloud-stream, .session-item[data-id="s-running"] .flux-cloud-glint'));
    return els.length > 0 && els.every((el) => getComputedStyle(el).animationPlayState === 'paused');
  })()`);
  assert.equal(pausedState, true, '页面隐藏时流云丝带与微星流光动画必须自动暂停');

  await evaluate(`(() => {
    delete document.documentElement.dataset.pageHidden;
    window.__fluxActivity.completeTurn('session', 's-running', false);
    window.__fluxActivity.completeTurn('bot', 'arch-wang', false);
    window.__fluxActivity.completeTurn('group', 'g-running', false);
  })()`);

  const transitionActive = await evaluate(`(() => {
    const sBadge = document.querySelector('.session-item[data-id="s-running"] .activity-unread-badge');
    const bCorner = document.querySelector('#flux-station-rail [data-station-profile="arch-wang"] .activity-unread-badge');
    const gBadge = document.querySelector('.rail-group-item[data-room-id="g-running"] .activity-unread-badge');
    const doneRing = sBadge ? sBadge.querySelector('.flux-cloud-done-ring') : null;
    const ripple = sBadge ? sBadge.querySelector('.flux-cloud-ripple') : null;
    return {
      allJustCompleted: [sBadge, bCorner, gBadge].every((el) => el && el.getAttribute('data-transition') === 'just-completed'),
      checkRingAnimation: doneRing ? getComputedStyle(doneRing).animationName : null,
      rippleAnimation: ripple ? getComputedStyle(ripple).animationName : null,
    };
  })()`);
  assert.equal(transitionActive.allJustCompleted, true, '刚完成三类会话必须全部进入 just-completed 确认态');
  assert.equal(transitionActive.checkRingAnimation, 'fluxCloudCheckArrive', '完成瞬间必须播放完成环落定动画');
  assert.equal(transitionActive.rippleAnimation, 'fluxCloudRipple', '完成瞬间必须播放柔蓝扩散波纹');

  await new Promise((r) => setTimeout(r, 950));
  const afterWindow = await evaluate(`(() => {
    const sBadge = document.querySelector('.session-item[data-id="s-running"] .activity-unread-badge');
    const doneRing = sBadge ? sBadge.querySelector('.flux-cloud-done-ring') : null;
    return {
      transition: sBadge ? sBadge.getAttribute('data-transition') : null,
      animation: doneRing ? getComputedStyle(doneRing).animationName : null,
    };
  })()`);
  assert.equal(afterWindow.transition, 'none', '850ms 窗口到期后必须自动切回静态 none');
  assert.equal(afterWindow.animation, 'none', '窗口到期后必须停止动画驻留静默完成环');

  await evaluate(`(() => {
    window.__fluxActivity.startTurn('session', 's-read');
  })()`);
  await evaluate(`(() => {
    window.__fluxActivity.completeTurn('session', 's-read', true);
  })()`);
  const focusSettle = await evaluate(`(() => {
    const row = document.querySelector('.session-item[data-id="s-read"]');
    const settle = row ? row.querySelector('.activity-settle-fade') : null;
    const streams = settle ? settle.querySelectorAll('.flux-cloud-settle-stream').length : 0;
    const legacy = row ? row.querySelector('.activity-pulse-indicator, .activity-unread-badge') : null;
    return {
      hasSettle: Boolean(settle),
      streams,
      hasLegacy: Boolean(legacy),
      animation: settle ? getComputedStyle(settle).animationName : null,
    };
  })()`);
  assert.equal(focusSettle.hasSettle, true, '聚焦会话完成瞬间必须呈现独立收敛淡出');
  assert.equal(focusSettle.streams, 3, '收敛淡出必须包含 3 条收拢丝带');
  assert.equal(focusSettle.hasLegacy, false, '聚焦完成态绝不得混入脉冲或未读类名');
  assert.equal(focusSettle.animation, 'fluxCloudSettleFade');

  await new Promise((r) => setTimeout(r, 950));
  const afterFocusWindow = await evaluate(`(() => {
    const row = document.querySelector('.session-item[data-id="s-read"]');
    return row ? Boolean(row.querySelector('.activity-settle-fade, .activity-pulse-indicator, .activity-unread-badge')) : true;
  })()`);
  assert.equal(afterFocusWindow, false, '聚焦收敛窗口到期后必须彻底清空归零');

  await evaluate(`(() => {
    window.__fluxActivity.enterRead('session', 's-running');
    window.__fluxActivity.startTurn('session', 's-running');
  })()`);
  const railRunning = await evaluate(`(() => {
    const el = document.querySelector('#session-list-container .session-item[data-id="s-running"] .activity-pulse-indicator .flux-cloud-stream');
    return Boolean(el);
  })()`);
  assert.equal(railRunning, true, '会话甲板内的会话必须实时透传流云三态状态动画');
  const projectsDeckGone = await evaluate(`(() => document.getElementById('rail-projects-deck') === null)()`);
  assert.equal(projectsDeckGone, true, '项目甲板已随微轨项目入口移除，任何状态切换都不得把它渲染回来');

  // 切换为 30×16 宽幅 3D 点云「abyss-whale」，实测物理尺寸、26 颗动画粒子、pageHidden 与 reduced-motion
  await evaluate(`(() => {
    window.__fluxState.activityVariant = 'abyss-whale';
    window.__fluxRender();
  })()`);
  await new Promise((r) => setTimeout(r, 80));

  const whaleMetrics = await evaluate(`(() => {
    const canvas = document.querySelector('.session-item[data-id="s-running"] .flux-pc-canvas--wide');
    const dots = canvas ? Array.from(canvas.querySelectorAll('.flux-pc-dot')) : [];
    const csCanvas = canvas ? getComputedStyle(canvas) : null;
    const activeAnim = dots.filter((d) => getComputedStyle(d).animationName.startsWith('fluxPcG')).length;
    const xs = dots.map((d) => d.getBoundingClientRect().left);
    const spanX = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    return {
      hasCanvas: Boolean(canvas),
      canvasSize: csCanvas ? [csCanvas.width, csCanvas.height] : null,
      dotCount: dots.length,
      activeAnim,
      spanX,
    };
  })()`);
  assert.equal(whaleMetrics.hasCanvas, true, 'abyss-whale 必须挂载 .flux-pc-canvas--wide');
  assert.deepEqual(whaleMetrics.canvasSize, ['30px', '16px'], '宽幅 3D 点云画布必须严格为 30px×16px');
  assert.equal(whaleMetrics.dotCount, 26, '深海光鲸必须精确挂载 26 颗点云粒子');
  assert.equal(whaleMetrics.activeAnim, 26, '深海光鲸全部 26 颗粒子必须运行独立关键帧动画');
  assert.ok(whaleMetrics.spanX >= 14, `点云粒子必须在 30px 画布上舒展分布，实测 spanX=${whaleMetrics.spanX}`);

  await evaluate(`(() => {
    document.documentElement.dataset.pageHidden = 'true';
  })()`);
  const whalePaused = await evaluate(`(() => {
    const dots = Array.from(document.querySelectorAll('.session-item[data-id="s-running"] .flux-pc-dot'));
    return dots.length === 26 && dots.every((d) => getComputedStyle(d).animationPlayState === 'paused');
  })()`);
  assert.equal(whalePaused, true, '页面隐藏时全部 26 颗点云粒子动画必须暂停');
  await evaluate(`(() => {
    delete document.documentElement.dataset.pageHidden;
  })()`);

  // 验证三套负 delay 共享轨道变体（torus-mesh / sphere-mesh / mobius-band）与宽幅变体（abyss-whale）在 reduced-motion 下全部停动且保持舒展分布
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reducedPointClouds = [
    { variant: 'abyss-whale', count: 26, minSpanX: 20, minSpanY: 6.5 },
    { variant: 'torus-mesh', count: 20, minSpanX: 10, minSpanY: 7.5 },
    { variant: 'sphere-mesh', count: 20, minSpanX: 10, minSpanY: 10.5 },
    { variant: 'mobius-band', count: 18, minSpanX: 9.5, minSpanY: 6.5 },
  ];
  for (const item of reducedPointClouds) {
    await evaluate(`(() => {
      window.__fluxState.activityVariant = ${JSON.stringify(item.variant)};
      window.__fluxRender();
    })()`);
    await new Promise((r) => setTimeout(r, 40));
    const stats = await evaluate(`(() => {
      const dots = Array.from(document.querySelectorAll('.session-item[data-id="s-running"] .flux-pc-dot'));
      const allStopped = dots.length === ${item.count} && dots.every((d) => getComputedStyle(d).animationName === 'none');
      const allAutoWillChange = dots.length === ${item.count} && dots.every((d) => getComputedStyle(d).willChange === 'auto');
      const xs = dots.map((d) => d.getBoundingClientRect().left);
      const ys = dots.map((d) => d.getBoundingClientRect().top);
      return {
        count: dots.length,
        allStopped,
        allAutoWillChange,
        spanX: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
        spanY: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
      };
    })()`);
    assert.equal(stats.count, item.count, `${item.variant} 必须渲染 ${item.count} 颗点云粒子`);
    assert.equal(stats.allStopped, true, `减弱动效下 ${item.variant} 全部粒子必须停止动画`);
    assert.equal(stats.allAutoWillChange, true, `减弱动效下 ${item.variant} 必须释放 will-change 合成层提示`);
    assert.ok(
      stats.spanX >= item.minSpanX && stats.spanY >= item.minSpanY,
      `减弱动效下 ${item.variant} 不得坍缩，实测 span=${stats.spanX.toFixed(2)}x${stats.spanY.toFixed(2)}`,
    );
  }
  await send('Emulation.setEmulatedMedia', { features: [] });
});
