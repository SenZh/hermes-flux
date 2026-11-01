import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9338;

test('Hermes Flux Core Delivery - Real Headless Browser CDP Physical Acceptance Test', async (t) => {
  if (!fs.existsSync(EDGE_PATH)) {
    t.skip('Microsoft Edge not found on system');
    return;
  }

  // 1. Static HTTP Server for zero-CORS ES module importing
  const rootDir = path.resolve('.');
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = '/packages/desktop/__tests__/cdp/e2e-acceptance-harness.html';
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

  // 2. Launch Edge in Headless Mode with remote debugging port
  const tmpUserDataDir = path.resolve(
    os.tmpdir(),
    `edge-cdp-accept-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );

  const browserProc = spawn(
    EDGE_PATH,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      '--headless=new',
      '--disable-gpu',
      `--user-data-dir=${tmpUserDataDir}`,
      `http://127.0.0.1:${serverPort}/packages/desktop/__tests__/cdp/e2e-acceptance-harness.html`,
    ],
    { stdio: 'ignore' }
  );

  let ws = null;

  t.after(async () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
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

  // 3. Connect CDP WebSocket
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

  assert.ok(targets.length > 0, 'Browser must respond on CDP port');
  const pageTarget = targets.find(
    (t) => t.type === 'page' && t.url.includes('e2e-acceptance-harness.html')
  );
  assert.ok(pageTarget, 'Must find exact page target');
  const wsUrl = pageTarget.webSocketDebuggerUrl;

  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const cdpCall = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      const timeout = setTimeout(() => {
        reject(new Error(`CDP method ${method} timed out after 5000ms`));
      }, 5000);

      const handler = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
          else resolve(data.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  // Wait for application mount & render
  for (let i = 0; i < 30; i++) {
    try {
      const check = await cdpCall('Runtime.evaluate', {
        expression: `Boolean(window.cdpApp && document.getElementById('rail-bots-accordion-trigger'))`,
        returnByValue: true,
      });
      if (check.result.value === true) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  await t.test('1. CDP 物理验证: 顶栏 Workspace 徽章与智能体折叠组渲染', async () => {
    const res = await cdpCall('Runtime.evaluate', {
      expression: `(() => {
        const badge = document.querySelector('.session-workspace-badge');
        const botTrigger = document.getElementById('rail-bots-accordion-trigger');
        const botList = document.getElementById('rail-bots-nested-list');
        const botCount = botTrigger ? botTrigger.textContent : '';
        return {
          hasBadge: Boolean(badge),
          badgeText: badge ? badge.textContent.trim() : '',
          hasBotTrigger: Boolean(botTrigger),
          botListVisible: botList ? getComputedStyle(botList).display : 'none',
          botCountText: botCount
        };
      })()`,
      returnByValue: true,
    });

    const info = res.result.value;
    assert.equal(info.hasBadge, true, '标题栏必须渲染会话所属 Workspace 徽章');
    assert.ok(info.badgeText.includes('电商微服务工程'), '徽章必须展示项目名称');
    assert.equal(info.hasBotTrigger, true, '左轨必须渲染智能体折叠组');
    assert.equal(info.botListVisible, 'flex', '智能体列表默认必须展开');
    assert.ok(info.botCountText.includes('智能体 (2)'), '智能体标题必须展示统计数量');
  });

  await t.test('2. CDP 物理验证: 工具执行卡片命令实时高亮与杜绝 [object Object]', async () => {
    const res = await cdpCall('Runtime.evaluate', {
      expression: `(() => {
        const card = document.querySelector('.tool-execution-package-card');
        const cmdBadge = document.querySelector('.tool-active-cmd-badge');
        const allText = card ? card.innerText : '';
        return {
          hasCard: Boolean(card),
          hasCmdBadge: Boolean(cmdBadge),
          cmdText: cmdBadge ? cmdBadge.textContent.trim() : '',
          hasObjectObject: allText.includes('[object Object]'),
          isOpen: card ? card.hasAttribute('open') : false
        };
      })()`,
      returnByValue: true,
    });

    const info = res.result.value;
    assert.equal(info.hasCard, true, '多工具调用必须渲染执行打包卡片');
    assert.equal(info.hasCmdBadge, true, '正在执行时头部必须渲染活动命令 Badge');
    assert.ok(info.cmdText.includes('npm test'), '活动命令必须展示具体命令字符串');
    assert.equal(info.hasObjectObject, false, '严禁泄露 [object Object] 裸字符');
    assert.equal(info.isOpen, true, '存在运行中工具时卡片必须自动 open 展开');
  });

  await t.test('3. CDP 物理验证: 群聊原地行内重命名 (inline rename)', async () => {
    const res = await cdpCall('Runtime.evaluate', {
      expression: `(() => {
        window.cdpApp.editingGroupRoomId = 'room-1';
        window.cdpApp.render();
        const input = document.getElementById('rail-group-rename-input-room-1');
        const confirmBtn = document.querySelector('.btn-confirm-group-rename');
        const cancelBtn = document.querySelector('.btn-cancel-group-rename');
        if (input) input.value = '全链路高可用研讨群';
        if (confirmBtn) confirmBtn.click();
        const updatedGroup = window.cdpApp.groupRooms.find(g => g.roomId === 'room-1');
        return {
          hasInput: Boolean(input),
          hasConfirm: Boolean(confirmBtn),
          hasCancel: Boolean(cancelBtn),
          finalName: updatedGroup ? updatedGroup.name : ''
        };
      })()`,
      returnByValue: true,
    });

    const info = res.result.value;
    assert.equal(info.hasInput, true, '编辑态必须渲染行内 input');
    assert.equal(info.hasConfirm, true, '必须渲染对号确认按钮');
    assert.equal(info.hasCancel, true, '必须渲染叉号取消按钮');
    assert.equal(info.finalName, '全链路高可用研讨群', '确认后群聊名称必须更新');
  });

  await t.test('4. CDP 物理核心验收: 右键删除当前会话后，输入框保持可用并成功打字', async () => {
    // 4.1 触发 Session 1 的右键菜单并点击删除
    const deleteActionRes = await cdpCall('Runtime.evaluate', {
      expression: `(() => {
        const sessEl = document.querySelector('.session-item[data-id="sess-1"]');
        if (sessEl) {
          sessEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
        }
        const delBtn = document.querySelector('#session-context-menu button[data-action="delete"]');
        const hadDelBtn = Boolean(delBtn);
        if (delBtn) delBtn.click();

        return {
          hadDelBtn,
          remainingSessions: window.cdpApp.sessions.length,
          activeSessionId: window.cdpApp.activeSessionId
        };
      })()`,
      returnByValue: true,
    });

    const delInfo = deleteActionRes.result.value;
    assert.equal(delInfo.hadDelBtn, true, '右键菜单必须包含删除会话操作');
    assert.equal(delInfo.remainingSessions, 1, '删除后仅剩余 1 条会话');
    assert.equal(delInfo.activeSessionId, 'sess-2', '活动会话必须自动平滑切至下一条');

    // 4.2 物理度量与断言输入框可用性
    const inputStateRes = await cdpCall('Runtime.evaluate', {
      expression: `(() => {
        const input = document.getElementById('dock-prompt-input');
        if (!input) return { exists: false };
        const rect = input.getBoundingClientRect();
        return {
          exists: true,
          disabled: input.disabled,
          readOnly: input.readOnly,
          pointerEvents: getComputedStyle(input).pointerEvents,
          width: rect.width,
          height: rect.height
        };
      })()`,
      returnByValue: true,
    });

    const inputState = inputStateRes.result.value;
    assert.equal(inputState.exists, true, '输入框 DOM 必须存在');
    assert.equal(inputState.disabled, false, '删除会话后输入框绝对禁止被 disabled');
    assert.equal(inputState.readOnly, false, '删除会话后输入框绝对禁止被 readOnly');
    assert.equal(inputState.pointerEvents, 'auto', '输入框指针事件必须为 auto');
    assert.ok(inputState.height >= 44, '输入框触控热区必须 >= 44px');

    // 4.3 物理聚焦并通过 CDP 协议驱动真实硬件按键输入
    await cdpCall('Runtime.evaluate', {
      expression: `document.getElementById('dock-prompt-input').focus()`,
    });

    // 模拟真实键入 "Hello Hermes CDP"
    const textToType = 'Hello Hermes CDP';
    for (const char of textToType) {
      await cdpCall('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
        unmodifiedText: char,
      });
      await cdpCall('Input.dispatchKeyEvent', {
        type: 'keyUp',
      });
    }

    // 4.4 读取输入框内部真实物理键入值
    const typedValueRes = await cdpCall('Runtime.evaluate', {
      expression: `document.getElementById('dock-prompt-input').value`,
      returnByValue: true,
    });

    assert.equal(
      typedValueRes.result.value,
      'Hello Hermes CDP',
      '删除会话后输入框必须能成功接收物理键盘键入！'
    );
  });



  await t.test('9. 动态时序闭环 4: 头像资产注入与全量会话回填验证 (防止时序冲刷丢失)', async () => {
    const avatarRes = await cdpCall('Runtime.evaluate', {
      expression: `(() => {
        // 模拟头像资产异步到达并持久注入
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const bot = window.cdpApp.profiles.find(p => p.name === 'arch-wang');
        if (bot) bot.avatar = dataUrl;
        window.cdpApp.sessions.forEach(s => {
          if (s.botName === 'arch-wang') s.botAvatar = dataUrl;
        });
        window.cdpApp.render();

        // 检查左轨 Bot 头像、会话行头像中是否成功渲染 img (此时活跃会话为 sess-2)
        const botImg = document.querySelector('.rail-pinned-bot-row[data-profile="arch-wang"] img');
        const sessImg = document.querySelector('.session-item[data-id="sess-2"] img');

        // 模拟会话对账刷新（不带头像的二次渲染）
        window.cdpApp.render();
        const botImgAfter = document.querySelector('.rail-pinned-bot-row[data-profile="arch-wang"] img');
        const sessImgAfter = document.querySelector('.session-item[data-id="sess-2"] img');

        return {
          hasBotImg: Boolean(botImg),
          hasSessImg: Boolean(sessImg),
          hasBotImgAfter: Boolean(botImgAfter),
          hasSessImgAfter: Boolean(sessImgAfter)
        };
      })()`,
      returnByValue: true,
    });

    const avInfo = avatarRes.result.value;
    assert.equal(avInfo.hasBotImg, true, '智能体行必须渲染真实图片头像');
    assert.equal(avInfo.hasSessImg, true, '会话行必须渲染对应智能体的真实图片头像');
    assert.equal(avInfo.hasBotImgAfter, true, '重新渲染后智能体图片头像严禁被冲刷丢失');
    assert.equal(avInfo.hasSessImgAfter, true, '重新渲染后会话行图片头像严禁被冲刷丢失');
  });
});
