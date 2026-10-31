import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9448;

test('Hermes Flux Advanced Systems - Live Headless Browser CDP Physical Test', async (t) => {
  if (!fs.existsSync(EDGE_PATH)) {
    t.skip('Microsoft Edge not found on system');
    return;
  }

  // 1. Static HTTP Server with dynamic port allocation (port 0)
  const rootDir = path.resolve('.');
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = '/packages/desktop/__tests__/cdp/advanced-systems-harness.html';
    const filePath = path.join(rootDir, reqPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverPort = server.address().port;

  // 2. Launch Edge in Headless Mode with remote debugging port and clean os.tmpdir()
  const tmpUserDataDir = path.resolve(os.tmpdir(), `edge-cdp-adv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

  const browserProc = spawn(
    EDGE_PATH,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      '--headless=new',
      '--disable-gpu',
      `--user-data-dir=${tmpUserDataDir}`,
      `http://127.0.0.1:${serverPort}/packages/desktop/__tests__/cdp/advanced-systems-harness.html`,
    ],
    { stdio: 'ignore' }
  );

  let ws = null;

  t.after(async () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Send CDP Browser.close to cleanly release file locks on Windows
        await new Promise((resolve) => {
          const id = 999999;
          const onMsg = (evt) => {
            const data = JSON.parse(evt.data);
            if (data.id === id) {
              ws.removeEventListener('message', onMsg);
              resolve();
            }
          };
          ws.addEventListener('message', onMsg);
          ws.send(JSON.stringify({ id, method: 'Browser.close' }));
          setTimeout(resolve, 500);
        });
        ws.close();
      }
      browserProc.kill();
      server.close();
      await new Promise((r) => setTimeout(r, 400));
      fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
    } catch {}
  });

  // 3. Wait for CDP Port
  let targets = [];
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (res.ok) {
        targets = await res.json();
        if (targets.length > 0) break;
      }
    } catch {}
  }

  assert.ok(targets.length > 0, 'Browser must respond on CDP port and provide page target');
  const pageTarget = targets.find(
    (t) => t.type === 'page' && t.url.includes('advanced-systems-harness.html')
  );
  assert.ok(pageTarget, 'Must find exact advanced-systems-harness.html page target');
  const wsUrl = pageTarget.webSocketDebuggerUrl;
  assert.ok(wsUrl, 'CDP WebSocket URL must be valid');

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const cdpCall = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const handler = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  // Wait for harness ready
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    const chk = await cdpCall('Runtime.evaluate', {
      expression: 'Boolean(window.__harnessReady)',
      returnByValue: true,
    });
    if (chk.result.value === true) break;
  }

  // ==========================================
  // Test Case 1: Subagent Delegation Card & Steering Interaction
  // ==========================================
  await t.test('CDP verify WorkerDelegationCard live rendering and interrupt interaction', async () => {
    const cardInfo = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const card = document.querySelector('.worker-delegation-card');
          const title = card?.querySelector('span[style*="font-weight: 600"]')?.textContent.trim();
          const tag = card?.querySelector('span[style*="border-radius: 4px"]')?.textContent.trim();
          const btnInterrupt = card?.querySelector('.subagent-btn-interrupt');
          const btnInspect = card?.querySelector('.subagent-btn-inspect');
          return {
            hasCard: Boolean(card),
            title,
            tag,
            hasInterrupt: Boolean(btnInterrupt),
            hasInspect: Boolean(btnInspect),
            interruptHeight: btnInterrupt?.offsetHeight || 0,
            inspectHeight: btnInspect?.offsetHeight || 0
          };
        })()
      `,
      returnByValue: true,
    });

    const info = cardInfo.result.value;
    assert.equal(info.hasCard, true);
    assert.equal(info.title, 'CDP实时死锁分析任务');
    assert.equal(info.tag, '@arch-wang');
    assert.equal(info.hasInterrupt, true);
    assert.equal(info.hasInspect, true);
    // 物理触控热区验证 (HIG/Android 44pt/48dp)
    assert.ok(info.interruptHeight >= 44, `Interrupt button height must be >= 44px, got ${info.interruptHeight}`);
    assert.ok(info.inspectHeight >= 44, `Inspect button height must be >= 44px, got ${info.inspectHeight}`);

    // Click interrupt button via physical DOM dispatch
    const clickRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          document.querySelector('.subagent-btn-interrupt').click();
          return {
            status: window.cdpState.subagentTask.status,
            events: window.cdpState.lastEvents,
            interruptBtnGone: document.querySelector('.subagent-btn-interrupt') === null
          };
        })()
      `,
      returnByValue: true,
    });

    const clickData = clickRes.result.value;
    assert.equal(clickData.status, 'interrupted');
    assert.ok(clickData.events.includes('subagent_interrupted'));
    assert.equal(clickData.interruptBtnGone, true, '中断后终态卡片必须剥离中断按钮');
  });

  // ==========================================
  // Test Case 2: Subagent Live Terminal Stream & Steer Input (with Token Color & Touch Assertions)
  // ==========================================
  await t.test('CDP verify SubagentTerminalView log channel rendering & live steering dispatch', async () => {
    // 验证日志通道着色与输入控件物理高度
    const steerRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const terminalSlot = document.getElementById('subagent-terminal-slot');
          const input = terminalSlot.querySelector('.subagent-steer-input');
          const btnSteer = terminalSlot.querySelector('.subagent-btn-steer');
          const steerInputHeight = input?.offsetHeight || 0;
          const steerBtnHeight = btnSteer?.offsetHeight || 0;

          input.value = '切换为读写锁细粒度探测';
          btnSteer.click();

          const logElements = Array.from(terminalSlot.querySelectorAll('.subagent-terminal-stream > div'));
          const logChannelColors = logElements.map(el => {
            const tagSpan = el.querySelector('span[style*="font-weight: 600"]');
            return {
              tag: tagSpan?.textContent.trim(),
              color: window.getComputedStyle(tagSpan).color
            };
          });

          return {
            steerInputHeight,
            steerBtnHeight,
            logsCount: logElements.length,
            logChannelColors,
            lastLog: logElements[logElements.length - 1]?.textContent.trim(),
            lastEvent: window.cdpState.lastEvents[window.cdpState.lastEvents.length - 1]
          };
        })()
      `,
      returnByValue: true,
    });

    const steerData = steerRes.result.value;
    // 物理热区断言
    assert.ok(steerData.steerInputHeight >= 44, `Steer input height must be >= 44px, got ${steerData.steerInputHeight}`);
    assert.ok(steerData.steerBtnHeight >= 44, `Steer button height must be >= 44px, got ${steerData.steerBtnHeight}`);

    assert.equal(steerData.logsCount, 5, 'Must now have 5 log entries in terminal');
    assert.ok(steerData.lastLog.includes('[SYSTEM]'));
    assert.ok(steerData.lastLog.includes('切换为读写锁细粒度探测'));
    assert.equal(steerData.lastEvent, 'subagent_steered:切换为读写锁细粒度探测');

    // 验证通道标签已成功被 CSS 引擎着色 (非全透明)
    assert.ok(steerData.logChannelColors.length >= 5);
    for (const c of steerData.logChannelColors) {
      assert.notEqual(c.color, 'rgba(0, 0, 0, 0)', `Log channel ${c.tag} color must not be transparent`);
    }
  });

  // ==========================================
  // Test Case 3: Bot Profile Card & Forever Chat Entry
  // ==========================================
  await t.test('CDP verify BotProfileCard rendering and entering Canonical Forever Chat', async () => {
    const botRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const card = document.querySelector('.bot-profile-card');
          const name = card?.querySelector('span[style*="font-weight: 600"]')?.textContent.trim();
          const btn = card?.querySelector('.bot-btn-enter-forever-chat');
          btn.click();
          return {
            hasCard: Boolean(card),
            name,
            btnHeight: btn?.offsetHeight || 0,
            lastEvent: window.cdpState.lastEvents[window.cdpState.lastEvents.length - 1]
          };
        })()
      `,
      returnByValue: true,
    });

    const botData = botRes.result.value;
    assert.equal(botData.hasCard, true);
    assert.equal(botData.name, '架构老王');
    assert.ok(botData.btnHeight >= 44, `Bot enter button height must be >= 44px, got ${botData.btnHeight}`);
    assert.equal(botData.lastEvent, 'entered_forever_chat:sess-bot-forever-chat');
  });

  // ==========================================
  // Test Case 4: Multi-Agent Group Room View & Seed Memo Card
  // ==========================================
  await t.test('CDP verify GroupRoomView seed memo card and message submission', async () => {
    const groupRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const memoCard = document.querySelector('.group-seed-memo-card');
          const memoText = memoCard?.textContent.trim();
          const input = document.querySelector('.group-chat-input');
          const btnSend = document.querySelector('.group-btn-send');
          const groupInputHeight = input?.offsetHeight || 0;
          const groupSendBtnHeight = btnSend?.offsetHeight || 0;

          input.value = '同意，请安全审计专家复核。';
          btnSend.click();

          return {
            hasSeedMemo: Boolean(memoCard),
            memoTextSnippet: memoText?.slice(0, 50),
            entriesCount: window.cdpState.groupEntries.length,
            groupInputHeight,
            groupSendBtnHeight,
            lastEvent: window.cdpState.lastEvents[window.cdpState.lastEvents.length - 1]
          };
        })()
      `,
      returnByValue: true,
    });

    const gData = groupRes.result.value;
    assert.equal(gData.hasSeedMemo, true);
    assert.ok(gData.memoTextSnippet.includes('会议种子背景备忘录'));
    assert.equal(gData.entriesCount, 3);
    assert.ok(gData.groupInputHeight >= 44, `Group input height must be >= 44px, got ${gData.groupInputHeight}`);
    assert.ok(gData.groupSendBtnHeight >= 44, `Group send button height must be >= 44px, got ${gData.groupSendBtnHeight}`);
    assert.equal(gData.lastEvent, 'group_sent:同意，请安全审计专家复核。');
  });

  // ==========================================
  // Test Case 5: 4-Stage Group Promotion Dialog (Overlay Close, Cancel & Confirm Branches)
  // ==========================================
  await t.test('CDP verify GroupPromotionDialog modal open, overlay close, cancel and confirmation', async () => {
    // 5.1 测试点击遮罩层背景关闭分支
    const overlayRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          window.openPromotionDialog();
          const overlay = document.querySelector('.group-promotion-dialog-overlay');
          // 模拟点击半透明遮罩背景
          overlay.click();
          return {
            isClosed: document.querySelector('.group-promotion-dialog-overlay') === null,
            lastEvent: window.cdpState.lastEvents[window.cdpState.lastEvents.length - 1]
          };
        })()
      `,
      returnByValue: true,
    });
    assert.equal(overlayRes.result.value.isClosed, true, 'Clicking overlay background must dismiss promotion dialog');
    assert.equal(overlayRes.result.value.lastEvent, 'promotion_cancelled_via_overlay');

    // 5.2 测试点击取消按钮分支与触控高度
    const cancelRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          window.openPromotionDialog();
          const btnCancel = document.querySelector('.group-dialog-btn-cancel');
          const cancelHeight = btnCancel?.offsetHeight || 0;
          btnCancel.click();
          return {
            cancelHeight,
            isClosed: document.querySelector('.group-promotion-dialog-overlay') === null,
            lastEvent: window.cdpState.lastEvents[window.cdpState.lastEvents.length - 1]
          };
        })()
      `,
      returnByValue: true,
    });
    assert.ok(cancelRes.result.value.cancelHeight >= 44, `Cancel button height must be >= 44px, got ${cancelRes.result.value.cancelHeight}`);
    assert.equal(cancelRes.result.value.isClosed, true, 'Clicking cancel button must dismiss promotion dialog');
    assert.equal(cancelRes.result.value.lastEvent, 'promotion_cancelled');

    // 5.3 测试多选专家并确认分支
    const confirmRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          window.openPromotionDialog();
          const overlay = document.querySelector('.group-promotion-dialog-overlay');
          const btnConfirm = document.querySelector('.group-dialog-btn-confirm');
          const confirmHeight = btnConfirm?.offsetHeight || 0;
          const checkboxes = Array.from(document.querySelectorAll('.group-member-checkbox'));
          // Check arch-wang and fe-zhang
          checkboxes.forEach(cb => {
            if (cb.value === 'arch-wang' || cb.value === 'fe-zhang') {
              cb.checked = true;
            }
          });
          btnConfirm.click();
          return {
            confirmHeight,
            hasOverlayBefore: Boolean(overlay),
            checkboxCount: checkboxes.length,
            lastEvent: window.cdpState.lastEvents[window.cdpState.lastEvents.length - 1],
            isClosedAfter: document.querySelector('.group-promotion-dialog-overlay') === null
          };
        })()
      `,
      returnByValue: true,
    });

    const dData = confirmRes.result.value;
    assert.ok(dData.confirmHeight >= 44, `Confirm button height must be >= 44px, got ${dData.confirmHeight}`);
    assert.equal(dData.hasOverlayBefore, true);
    assert.equal(dData.checkboxCount, 3);
    assert.equal(dData.lastEvent, 'promoted_to_group:arch-wang,fe-zhang');
    assert.equal(dData.isClosedAfter, true, 'Dialog must be destroyed after confirm');
  });

  // ==========================================
  // Test Case 6: Project Workspace Tree Viewer
  // ==========================================
  await t.test('CDP verify ProjectTreeViewer node rendering and root path display', async () => {
    const treeRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const items = Array.from(document.querySelectorAll('.project-tree-item')).map(el => ({
            path: el.dataset.path,
            isDir: el.dataset.isDir === 'true',
            text: el.textContent.trim()
          }));
          const title = document.querySelector('.project-tree-viewer span[title]')?.getAttribute('title');
          return {
            items,
            title
          };
        })()
      `,
      returnByValue: true,
    });

    const tData = treeRes.result.value;
    assert.equal(tData.title, '/opt/hermes-flux');
    assert.ok(tData.items.length >= 4);
    assert.equal(tData.items[0].path, '/packages');
    assert.equal(tData.items[0].isDir, true);
    assert.ok(tData.items.some(i => i.path === '/package.json' && i.isDir === false));
  });

  // ==========================================
  // Test Case 7: BTW Isolated Advice Capsule Quote
  // ==========================================
  await t.test('CDP verify BtwCapsule read-only advice and quote-to-composer trigger', async () => {
    const btwRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const capsule = document.querySelector('.btw-isolated-capsule');
          const tag = capsule?.dataset.targetProfile;
          const quoteBtn = capsule?.querySelector('.btw-btn-quote');
          quoteBtn.click();
          return {
            hasCapsule: Boolean(capsule),
            tag,
            quoteBtnHeight: quoteBtn?.offsetHeight || 0,
            lastEvent: window.cdpState.lastEvents[window.cdpState.lastEvents.length - 1]
          };
        })()
      `,
      returnByValue: true,
    });

    const bData = btwRes.result.value;
    assert.equal(bData.hasCapsule, true);
    assert.equal(bData.tag, 'arch-wang');
    assert.ok(bData.quoteBtnHeight >= 44, `Quote button height must be >= 44px, got ${bData.quoteBtnHeight}`);
    assert.ok(bData.lastEvent.includes('btw_quoted:建议在写锁获取前增加超时断路器'));
  });

  // ==========================================
  // Test Case 8: Live Agent Mention Routing In-Browser Verification
  // ==========================================
  await t.test('CDP verify live Agent Router multi-mode triage inside browser engine', async () => {
    const routeRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const r1 = window.resolveMentionRoute('@arch-wang 分析死锁', 'scratchpad', ['arch-wang', 'fe-zhang']);
          const r2 = window.resolveMentionRoute('@arch-wang 这个接口改动大吗', 'bot_forever_chat', ['arch-wang', 'fe-zhang']);
          const r3 = window.resolveMentionRoute('@sec-auditor 检查Token', 'group_room', ['arch-wang', 'sec-auditor']);
          return { r1, r2, r3 };
        })()
      `,
      returnByValue: true,
    });

    const { r1, r2, r3 } = routeRes.result.value;
    assert.equal(r1.kind, 'subagent_delegation');
    assert.equal(r2.kind, 'btw_isolated_capsule');
    assert.equal(r3.kind, 'group_broadcast_mention');
  });

  // ==========================================
  // Test Case 9: Mobile Viewport Simulation & Safe Area Insets Probe (Pixel 8: 390x844 DPR=3)
  // ==========================================
  await t.test('CDP verify Mobile Viewport Emulation, touch heatmaps and Safe Area Insets', async () => {
    // 9.1 通过 CDP 协议模拟移动端视口 (Pixel 8)
    await cdpCall('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenOrientation: { angle: 0, type: 'portraitPrimary' }
    });

    const mobileRes = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          // 显示移动端 BottomSheet 容器
          const sheetSlot = document.getElementById('subagent-mobile-sheet-slot');
          sheetSlot.style.display = 'block';

          const docWidth = document.documentElement.scrollWidth;
          const winWidth = window.innerWidth;
          const closeBtn = sheetSlot.querySelector('.subagent-btn-close-sheet');
          const closeBtnHeight = closeBtn?.offsetHeight || 0;
          const closeBtnWidth = closeBtn?.offsetWidth || 0;

          // 读取底部输入舱的计算内边距 (包含 safe-area 避让)
          const bottomDock = sheetSlot.querySelector('div[style*="env(safe-area-inset-bottom)"]');
          const computedPaddingBottom = bottomDock ? window.getComputedStyle(bottomDock).paddingBottom : '0px';

          return {
            docWidth,
            winWidth,
            hasHorizontalScroll: docWidth > winWidth,
            hasCloseBtn: Boolean(closeBtn),
            closeBtnHeight,
            closeBtnWidth,
            computedPaddingBottom
          };
        })()
      `,
      returnByValue: true,
    });

    const mData = mobileRes.result.value;
    // 移动端不变量 1：严禁产生横向溢出滚动
    assert.equal(mData.hasHorizontalScroll, false, `Mobile viewport has horizontal scroll: doc=${mData.docWidth}, win=${mData.winWidth}`);
    // 移动端不变量 2：移动端专属 Sheet 关闭按钮必须存在且 >= 44x44
    assert.equal(mData.hasCloseBtn, true);
    assert.ok(mData.closeBtnHeight >= 44, `Close button height must be >= 44px, got ${mData.closeBtnHeight}`);
    assert.ok(mData.closeBtnWidth >= 44, `Close button width must be >= 44px, got ${mData.closeBtnWidth}`);
    // 移动端不变量 3：安全区底部内边距必须有效生效 (>= 12px)
    const pbNum = parseFloat(mData.computedPaddingBottom) || 0;
    assert.ok(pbNum >= 12, `Safe area bottom padding must be >= 12px, got ${pbNum}`);

    // 重置设备仿真
    await cdpCall('Emulation.clearDeviceMetricsOverride');
  });
});
