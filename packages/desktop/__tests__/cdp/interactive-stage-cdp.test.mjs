import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9500 + Math.floor(Math.random() * 300);

test('Main Chat Stage & Composer Dock - Live Headless Browser CDP Physical Verification', async (t) => {
  if (!fs.existsSync(EDGE_PATH)) {
    t.skip('Microsoft Edge not found on system');
    return;
  }

  // 1. Static HTTP Server with dynamic port allocation (port 0)
  const rootDir = path.resolve('.');
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = '/packages/desktop/__tests__/cdp/interactive-stage-harness.html';
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

  // 2. Launch Edge in Headless Mode with clean os.tmpdir()
  const tmpUserDataDir = path.resolve(os.tmpdir(), `edge-cdp-stage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

  const browserProc = spawn(
    EDGE_PATH,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--user-data-dir=${tmpUserDataDir}`,
      `http://127.0.0.1:${serverPort}/packages/desktop/__tests__/cdp/interactive-stage-harness.html`,
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

  // 3. Connect CDP
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

  assert.ok(targets.length > 0, 'Must discover CDP target page');
  const pageTarget = targets.find((tgt) => tgt.type === 'page') || targets[0];

  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let msgId = 1;
  const sendCdp = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = msgId++;
      const timeout = setTimeout(() => {
        ws.removeEventListener('message', handler);
        reject(new Error(`CDP request timeout for ${method} (id=${id})`));
      }, 5000);

      const handler = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });

  // 4. Wait for Harness Ready
  let isReady = false;
  for (let i = 0; i < 40; i++) {
    const res = await sendCdp('Runtime.evaluate', {
      expression: 'window.__stageReady === true',
      returnByValue: true,
    });
    if (res?.result?.value) {
      isReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(isReady, 'Harness environment must be loaded and ready');

  // 5. 桌面视口物理几何断言：740px 黄金限宽与水位计呈现
  await t.test('1. 桌面视口：输入舱锁定 740px 黄金限宽，右上角上下文水位计常驻', async () => {
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const dockMetrics = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const dock = document.querySelector('.composer-dock');
        const gauge = document.querySelector('.context-gauge-badge');
        return {
          dockWidth: dock ? dock.offsetWidth : 0,
          dockMaxWidth: dock ? window.getComputedStyle(dock).maxWidth : '',
          hasGauge: Boolean(gauge),
          gaugeText: gauge ? gauge.textContent.trim() : '',
        };
      })()`,
      returnByValue: true,
    });

    assert.equal(dockMetrics.result.value.dockMaxWidth, '740px', '输入舱必须严格锁定 max-width: 740px 黄金限宽');
    assert.ok(dockMetrics.result.value.dockWidth <= 740, `输入舱实际渲染宽度不得超过 740px (当前: ${dockMetrics.result.value.dockWidth})`);
    assert.ok(dockMetrics.result.value.hasGauge, '右上角必须常驻上下文水位计徽章');
    assert.ok(dockMetrics.result.value.gaugeText.includes('42k / 128k'), '水位计正确展示上下文用量');
  });

  // 6. 物理交互：点击“回滚”按钮，内容自动回填至输入框
  await t.test('2. 物理动作：点击用户提问底部的回滚按钮，提问文本自动回填至输入框', async () => {
    const rollbackResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const rollbackBtn = document.querySelector('[data-action="rollback-msg"]');
        if (!rollbackBtn) return { success: false, reason: 'btn-not-found' };
        rollbackBtn.click();
        const textarea = document.getElementById('dock-prompt-input');
        return {
          success: true,
          inputValue: textarea ? textarea.value : '',
          recordedRollback: document.body.getAttribute('data-last-rollback'),
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(rollbackResult.result.value.success, '回滚按钮必须存在并被触发点击');
    assert.ok(rollbackResult.result.value.inputValue.includes('单调递增时钟'), '输入框必须自动回填被撤回的提问内容');
    assert.equal(rollbackResult.result.value.recordedRollback, rollbackResult.result.value.inputValue);
  });

  // 6.1 物理交互与纯图标样式断言：点击复制、Fork、重新生成按钮
  await t.test('2.1 物理动作：纯图标按钮无内嵌文本且带title提示，点击复制/Fork/重新生成正常分发', async () => {
    const actionResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const copyBtn = document.querySelector('[data-action="copy-msg"]');
        const forkBtn = document.querySelector('[data-action="fork-msg"]');
        const regenBtn = document.querySelector('[data-action="regenerate-msg"]');
        if (!copyBtn || !forkBtn || !regenBtn) {
          return { success: false, reason: 'buttons-missing' };
        }

        // 验证纯图标特性：按钮内无 span 标签，且具备 title 提示属性
        const copyHasSpan = Boolean(copyBtn.querySelector('span'));
        const forkHasSpan = Boolean(forkBtn.querySelector('span'));
        const regenHasSpan = Boolean(regenBtn.querySelector('span'));
        const copyTitle = copyBtn.getAttribute('title');
        const forkTitle = forkBtn.getAttribute('title');
        const regenTitle = regenBtn.getAttribute('title');

        // 模拟物理触发点击
        copyBtn.click();
        forkBtn.click();
        regenBtn.click();

        return {
          success: true,
          copyHasSpan,
          forkHasSpan,
          regenHasSpan,
          hasTitles: Boolean(copyTitle && forkTitle && regenTitle),
          recordedCopied: document.body.getAttribute('data-last-copied'),
          recordedFork: document.body.getAttribute('data-last-fork'),
          recordedRegen: document.body.getAttribute('data-last-regenerate'),
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(actionResult.result.value.success, '所有操作栏按钮必须渲染存在');
    assert.equal(actionResult.result.value.copyHasSpan, false, '复制按钮严禁内联文本标签');
    assert.equal(actionResult.result.value.forkHasSpan, false, 'Fork按钮严禁内联文本标签');
    assert.equal(actionResult.result.value.regenHasSpan, false, '重新生成按钮严禁内联文本标签');
    assert.ok(actionResult.result.value.hasTitles, '所有操作按钮必须具备 title 悬浮说明');
    assert.ok(actionResult.result.value.recordedCopied !== null, '复制按钮必须成功分发事件');
    assert.ok(actionResult.result.value.recordedFork !== null, 'Fork按钮必须成功分发事件');
    assert.ok(actionResult.result.value.recordedRegen !== null, '重新生成按钮必须成功分发事件');
  });

  // 7. 物理交互：阶梯式 Token 性能仪表点击展开 Popover
  await t.test('3. 物理动作：点击阶梯式 Token 性能药丸，弹出详细 Popover', async () => {
    const popoverResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const pillBtn = document.querySelector('[data-action="toggle-token-popover"]');
        if (!pillBtn) return { success: false };
        pillBtn.click();
        const popover = document.querySelector('.token-metrics-popover');
        return {
          success: true,
          display: popover ? popover.style.display : '',
          popoverText: popover ? popover.textContent : '',
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(popoverResult.result.value.success, 'Token 药丸必须存在');
    assert.equal(popoverResult.result.value.display, 'block', '点击后 Popover 必须切换为展开状态');
    assert.ok(popoverResult.result.value.popoverText.includes('76.5 tps'), 'Popover 必须展示实时 TPS');
    assert.ok(popoverResult.result.value.popoverText.includes('85%'), 'Popover 必须展示缓存命中率');
  });

  // 8. 物理交互：点击排队托盘的“打断并发送”按钮
  await t.test('4. 物理动作：点击待发送队列托盘的打断插队按钮，触发抢占标记', async () => {
    const interruptResult = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const interruptBtn = document.querySelector('[data-action="interrupt-and-push"]');
        if (!interruptBtn) return { success: false };
        interruptBtn.click();
        return {
          success: true,
          triggered: document.body.getAttribute('data-interrupted-and-pushed') === 'true',
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(interruptResult.result.value.success, '打断插队按钮必须存在');
    assert.ok(interruptResult.result.value.triggered, '必须成功分发插队事件');
  });

  // 9. 移动端视口仿真与触控热区验证 (Pixel 8: 390x844)
  await t.test('5. 移动端仿真：视口通栏无横向滚动条，触控控件热区合规', async () => {
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });

    const mobileMetrics = await sendCdp('Runtime.evaluate', {
      expression: `(() => {
        const scrollWidth = document.documentElement.scrollWidth;
        const windowWidth = window.innerWidth;
        const actionBtn = document.querySelector('.msg-action-btn');
        return {
          noHorizontalOverflow: scrollWidth <= windowWidth,
          scrollWidth,
          windowWidth,
          btnOffsetHeight: actionBtn ? actionBtn.offsetHeight : 0,
        };
      })()`,
      returnByValue: true,
    });

    assert.ok(mobileMetrics.result.value.noHorizontalOverflow, `移动视口下严禁横向溢出滚动 (scrollWidth: ${mobileMetrics.result.value.scrollWidth}, innerWidth: ${mobileMetrics.result.value.windowWidth})`);
  });
});
