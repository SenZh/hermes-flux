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

function parseRgb(rgbStr) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgbStr || '');
  return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : null;
}

test('session-list-status-animation: 亮蓝色云朵 A 点阵、头像简洁角标、纯合成层动效与双肤出图', async (t) => {
  const browserPath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
  if (!browserPath) {
    t.skip('未找到 Edge/Chrome');
    return;
  }
  const rootDir = process.cwd();
  if (!fs.existsSync(path.join(rootDir, RENDERER_ENTRY))) {
    t.skip('renderer 产物缺失，请先执行 npm run build');
    return;
  }

  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = `/${RENDERER_ENTRY}`;
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
    `http://127.0.0.1:${serverPort}/${RENDERER_ENTRY}`,
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
    st.activeRailTab = 'chats';
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
      { id: 'proj-flux', name: 'hermes-flux', path: 'D:/ws/hermes-aura', sessions: [] }
    ];
    window.__fluxActivity.syncProjects();

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
    const sessRunDots = sessRun ? sessRun.querySelectorAll('.flux-cloud-dot') : [];
    const sessRunHasSvg = Boolean(sessRow && sessRow.querySelector('svg'));
    const sessHistUnread = document.querySelector('.session-item[data-id="s-unread-hist"] .activity-unread-badge');
    const sessHistOnDots = sessHistUnread ? sessHistUnread.querySelectorAll('.flux-cloud-dot[data-on="1"]') : [];
    const sessRead = document.querySelector('.session-item[data-id="s-read"]');

    const botCardRun = document.querySelector('.rail-primary-agent-card[data-primary-bot="arch-wang"] .activity-pulse-indicator');
    const stationBotRunBtn = document.querySelector('#flux-station-rail [data-station-profile="arch-wang"]');
    const stationBotRun = stationBotRunBtn ? stationBotRunBtn.querySelector('.activity-pulse-indicator') : null;
    const stationBotUnread = document.querySelector('#flux-station-rail [data-station-profile="fe-zhang"] .activity-unread-badge');
    const groupRowRun = document.querySelector('.rail-group-item[data-room-id="g-running"] .activity-pulse-indicator');
    const groupRowRead = document.querySelector('.rail-group-item[data-room-id="g-read"]');
    const groupStationBtn = document.getElementById('rail-station-groups-btn');
    const groupStationRun = groupStationBtn ? groupStationBtn.querySelector('.activity-pulse-indicator') : null;

    const firstCloudDot = sessRunDots[0] || null;
    const firstDoneDot = sessHistOnDots[0] || null;
    const csCorner = stationBotRun ? getComputedStyle(stationBotRun) : null;
    const csCornerAfter = stationBotRun ? getComputedStyle(stationBotRun, '::after') : null;
    const csCloudDot = firstCloudDot ? getComputedStyle(firstCloudDot) : null;
    const csDoneDot = firstDoneDot ? getComputedStyle(firstDoneDot) : null;
    const csHistUnread = sessHistUnread ? getComputedStyle(sessHistUnread) : null;
    const sessRunLabel = sessRun ? sessRun.querySelector('.flux-cloud-label--running') : null;
    const csSessRunLabel = sessRunLabel ? getComputedStyle(sessRunLabel) : null;
    const botCardTitle = document.querySelector('.rail-primary-agent-card[data-primary-bot="arch-wang"] .truncate.text-body');
    const botCardTitleEllipsis = botCardTitle ? botCardTitle.scrollWidth > botCardTitle.clientWidth : true;

    const botBtnRect = stationBotRunBtn ? stationBotRunBtn.getBoundingClientRect() : null;
    const botDotRect = stationBotRun ? stationBotRun.getBoundingClientRect() : null;
    const grpBtnRect = groupStationBtn ? groupStationBtn.getBoundingClientRect() : null;
    const grpDotRect = groupStationRun ? groupStationRun.getBoundingClientRect() : null;
    const timeEl = sessRow ? sessRow.querySelector('time') : null;
    const timeRight = timeEl ? timeEl.getBoundingClientRect().right : 0;
    const rowRight = sessRow ? sessRow.getBoundingClientRect().right : 0;

    return {
      hasAllRunning: Boolean(sessRun && botCardRun && stationBotRun && groupRowRun && groupStationRun),
      hasUnread: Boolean(sessHistUnread && stationBotUnread),
      readHasZeroDots: Boolean(
        sessRead && !sessRead.querySelector('.activity-pulse-indicator, .activity-unread-badge, .activity-settle-fade')
        && groupRowRead && !groupRowRead.querySelector('.activity-pulse-indicator, .activity-unread-badge, .activity-settle-fade')
      ),
      cloudDotCount: sessRunDots.length,
      doneCheckDotCount: sessHistOnDots.length,
      sessRunHasSvg,
      cornerIsSimple: Boolean(stationBotRun && !stationBotRun.querySelector('.flux-cloud-canvas')),
      cornerSize: csCorner ? [csCorner.width, csCorner.height] : null,
      cornerAfterAnim: csCornerAfter ? csCornerAfter.animationName : null,
      cloudDotBg: csCloudDot ? csCloudDot.backgroundColor : null,
      cloudDotAnim: csCloudDot ? csCloudDot.animationName : null,
      doneDotBg: csDoneDot ? csDoneDot.backgroundColor : null,
      runLabelDisplay: csSessRunLabel ? csSessRunLabel.display : null,
      runLabelColor: csSessRunLabel ? csSessRunLabel.color : null,
      runLabelAnim: csSessRunLabel ? csSessRunLabel.animationName : null,
      botCardTitleFull: !botCardTitleEllipsis,
      histUnreadTransition: sessHistUnread ? sessHistUnread.getAttribute('data-transition') : null,
      histUnreadDoneDotAnim: csDoneDot ? csDoneDot.animationName : null,
      botCornerInside: Boolean(botBtnRect && botDotRect && botDotRect.right <= botBtnRect.right + 1 && botDotRect.top >= botBtnRect.top - 1),
      grpCornerInside: Boolean(grpBtnRect && grpDotRect && grpDotRect.right <= grpBtnRect.right + 1 && grpDotRect.top >= grpBtnRect.top - 1),
      timeRightGap: Math.round(rowRight - timeRight),
      runningText: sessRun ? sessRun.textContent : '',
      unreadText: sessHistUnread ? sessHistUnread.textContent : '',
      botText: botCardRun ? botCardRun.textContent : '',
      groupText: groupRowRun ? groupRowRun.textContent : '',
    };
  })()`);

  assert.equal(lightMetrics.hasAllRunning, true, '三类列表、微轨 Bot 与群聊总按钮必须全部渲染 running 指示器');
  assert.equal(lightMetrics.hasUnread, true, '历史未读必须渲染已完成指示器');
  assert.equal(lightMetrics.readHasZeroDots, true, '静态已读会话与群聊必须零特殊状态节点');
  assert.equal(lightMetrics.cloudDotCount, 24, '云朵 A 必须精确渲染 24 颗微粒');
  assert.equal(lightMetrics.doneCheckDotCount, 7, '云朵 A 完成态必须精确点亮 7 颗对勾核心晶粒');
  assert.equal(lightMetrics.sessRunHasSvg, false, '普通会话行内严禁出现 <svg> 标签');
  assert.equal(lightMetrics.cornerIsSimple, true, '头像角标必须保持简洁圆点，不含云朵画布');
  assert.deepEqual(lightMetrics.cornerSize, ['8px', '8px'], '头像角标必须保持 8x8');
  assert.equal(lightMetrics.cornerAfterAnim, 'fluxActivityPulseRing', '头像角标脉冲环动画必须生效');
  assert.equal(lightMetrics.cloudDotAnim, 'fluxCloudDrift', '云朵微粒必须运行缓慢飘浮波浪动画');
  assert.equal(lightMetrics.histUnreadTransition, 'none', '超过窗口的历史未读必须回落 none');
  assert.equal(lightMetrics.histUnreadDoneDotAnim, 'none', '历史未读不得重播聚拢动画');
  assert.equal(lightMetrics.botCornerInside, true, '微轨 Bot 角标必须落在按钮边界内');
  assert.equal(lightMetrics.grpCornerInside, true, '微轨群聊角标必须落在按钮边界内');
  assert.ok(lightMetrics.timeRightGap <= 16, `时间必须紧贴行右缘，当前差 ${lightMetrics.timeRightGap}px`);
  assert.equal(lightMetrics.runningText, '执行中');
  assert.equal(lightMetrics.botText, '思考中');
  assert.equal(lightMetrics.groupText, '协作中');
  assert.equal(lightMetrics.unreadText, '已完成');

  const runRgb = parseRgb(lightMetrics.cloudDotBg);
  const doneRgb = parseRgb(lightMetrics.doneDotBg);
  const labelRgb = parseRgb(lightMetrics.runLabelColor);
  assert.ok(runRgb && runRgb.b > runRgb.g && runRgb.b > runRgb.r, `运行态必须为纯蓝色系，实测 ${lightMetrics.cloudDotBg}`);
  assert.ok(doneRgb && doneRgb.b > doneRgb.g && doneRgb.b > doneRgb.r, `完成态必须为纯蓝色系（严禁绿色），实测 ${lightMetrics.doneDotBg}`);
  assert.ok(labelRgb && labelRgb.b > labelRgb.g && labelRgb.b > labelRgb.r, `流光状态文字必须为纯蓝色系，实测 ${lightMetrics.runLabelColor}`);
  assert.notEqual(lightMetrics.runLabelDisplay, 'none', '普通会话行在默认宽度下必须展示流光状态文字');
  assert.equal(lightMetrics.runLabelAnim, 'fluxCloudLabelPulse', '流光状态文字必须走纯 GPU opacity 呼吸');
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
    const dot = document.querySelector('.session-item[data-id="s-running"] .flux-cloud-dot');
    return dot ? getComputedStyle(dot).backgroundColor : null;
  })()`);
  const darkRgb = parseRgb(darkBlue);
  assert.ok(darkRgb && darkRgb.b > darkRgb.g && darkRgb.b > darkRgb.r, `深色模式下云朵微粒仍须为透亮天蓝色系，实测 ${darkBlue}`);

  const darkShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(verifyDir, 'session-status-dark.png'), Buffer.from(darkShot.data, 'base64'));

  await evaluate(`(() => {
    document.documentElement.dataset.pageHidden = 'true';
    window.__fluxRender();
  })()`);
  const pausedState = await evaluate(`(() => {
    const dot = document.querySelector('.session-item[data-id="s-running"] .flux-cloud-dot');
    return dot ? getComputedStyle(dot).animationPlayState : null;
  })()`);
  assert.equal(pausedState, 'paused', '页面隐藏时云朵飘浮动画必须自动暂停');

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
    const gOverview = document.querySelector('#rail-station-groups-btn .activity-unread-badge');
    const onDot = sBadge ? sBadge.querySelector('.flux-cloud-dot[data-on="1"]') : null;
    const ripple = sBadge ? sBadge.querySelector('.flux-cloud-ripple') : null;
    return {
      allJustCompleted: [sBadge, bCorner, gBadge, gOverview].every((el) => el && el.getAttribute('data-transition') === 'just-completed'),
      checkDotAnimation: onDot ? getComputedStyle(onDot).animationName : null,
      rippleAnimation: ripple ? getComputedStyle(ripple).animationName : null,
    };
  })()`);
  assert.equal(transitionActive.allJustCompleted, true, '刚完成三类会话必须全部进入 just-completed 确认态');
  assert.equal(transitionActive.checkDotAnimation, 'fluxCloudCheckArrive', '云朵核心晶粒必须播放飞移聚拢对勾动画');
  assert.equal(transitionActive.rippleAnimation, 'fluxCloudRipple', '完成瞬间必须播放柔蓝扩散波纹');

  await new Promise((r) => setTimeout(r, 950));
  const afterWindow = await evaluate(`(() => {
    const sBadge = document.querySelector('.session-item[data-id="s-running"] .activity-unread-badge');
    const onDot = sBadge ? sBadge.querySelector('.flux-cloud-dot[data-on="1"]') : null;
    return {
      transition: sBadge ? sBadge.getAttribute('data-transition') : null,
      animation: onDot ? getComputedStyle(onDot).animationName : null,
    };
  })()`);
  assert.equal(afterWindow.transition, 'none', '850ms 窗口到期后必须自动切回静态 none');
  assert.equal(afterWindow.animation, 'none', '窗口到期后必须停止动画驻留静默蓝勾');

  await evaluate(`(() => {
    window.__fluxActivity.startTurn('session', 's-read');
  })()`);
  await evaluate(`(() => {
    window.__fluxActivity.completeTurn('session', 's-read', true);
  })()`);
  const focusSettle = await evaluate(`(() => {
    const row = document.querySelector('.session-item[data-id="s-read"]');
    const settle = row ? row.querySelector('.activity-settle-fade') : null;
    const legacy = row ? row.querySelector('.activity-pulse-indicator, .activity-unread-badge') : null;
    return {
      hasSettle: Boolean(settle),
      hasLegacy: Boolean(legacy),
      animation: settle ? getComputedStyle(settle).animationName : null,
    };
  })()`);
  assert.equal(focusSettle.hasSettle, true, '聚焦会话完成瞬间必须呈现独立收敛淡出');
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
    window.__fluxState.activeRailTab = 'projects';
    window.__fluxRender();
  })()`);
  const projRunning = await evaluate(`(() => {
    const el = document.querySelector('#rail-projects-deck .session-item[data-id="s-running"] .activity-pulse-indicator .flux-cloud-dot');
    return Boolean(el);
  })()`);
  assert.equal(projRunning, true, '项目甲板内归属会话必须实时透传云朵三态状态动画');
});
