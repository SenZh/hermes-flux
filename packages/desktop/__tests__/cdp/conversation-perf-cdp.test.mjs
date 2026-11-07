/**
 * 对话区真实浏览器性能门禁 (Gate 4e-B · Conversation Mount Budget)
 *
 * 设计意图 (Why)：
 *   Node 侧的 perf-benchmark 只测 renderToStaticMarkup 生成 HTML 字符串的耗时，
 *   量不到 DOM 提交、样式计算与布局——而这恰恰是浏览器里的大头。
 *   本门禁在真实 Blink 内核里挂载 50 条生产窗口消息，守护用户真实感知的首帧时间。
 *
 * 防范的历史坑 (Pitfall)：
 *   1. 只看 SSR 字符串数字，误以为 15ms 就等于用户不卡；
 *   2. 用 dev 版 React 测量，框架校验开销把预算吃掉一个数量级；
 *   3. 历史 harness 直接 import 已删除的 renderMessage，整套 CDP 用例静默全红。
 *
 * 约束与规则 (Rules)：
 *   1. 必须挂载真实 ConversationMessageList，禁止 mock；
 *   2. 数据与 Node 侧 perf-benchmark 同源（synthetic-messages.mjs）；
 *   3. 多轮取中位数，单轮毛刺不得判红，也不得因毛刺掩盖系统性劣化；
 *   4. 预算：首帧中位数 ≤ 120ms，提交完成中位数 ≤ 200ms，挂载期单条长任务 ≤ 120ms。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import esbuild from 'esbuild';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const REPO_ROOT = path.resolve('.');
const CDP_DIR = path.join(REPO_ROOT, 'packages/desktop/__tests__/cdp');
const BUNDLE_OUT = path.join(CDP_DIR, '.tmp/react-entry.js');
const HARNESS_PATH = '/packages/desktop/__tests__/cdp/perf-harness.html';

const BUDGET = {
  firstPaintMs: 120,
  settledMs: 200,
  longestTaskMs: 120,
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

test('Conversation Mount Budget - 真实 Blink 内核 50 条窗口挂载性能门禁', async (t) => {
  if (!fs.existsSync(EDGE_PATH)) {
    t.skip('Microsoft Edge not found on system');
    return;
  }

  // 1. 现场打包 React 测试桥（浏览器无法解析裸模块说明符）
  fs.mkdirSync(path.dirname(BUNDLE_OUT), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(REPO_ROOT, 'packages/ui/__tests__/cdp/react-entry.mjs')],
    outfile: BUNDLE_OUT,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  assert.ok(fs.existsSync(BUNDLE_OUT), 'React 测试桥必须打包成功');

  // 2. 静态服务器（根目录为仓库根，保证 dist / css 可直接取到）
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = HARNESS_PATH;
    const filePath = path.join(REPO_ROOT, reqPath);

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
      '.woff2': 'font/woff2',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverPort = server.address().port;
  const cdpPort = 9500 + Math.floor(Math.random() * 300);
  const tmpUserDataDir = path.resolve(
    os.tmpdir(),
    `edge-cdp-perf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );

  const browserProc = spawn(
    EDGE_PATH,
    [
      `--remote-debugging-port=${cdpPort}`,
      '--headless=new',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--font-render-hinting=none',
      `--user-data-dir=${tmpUserDataDir}`,
      `http://127.0.0.1:${serverPort}${HARNESS_PATH}`,
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

  // 3. 连接 CDP
  let targets = [];
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        targets = await res.json();
        if (targets.length > 0) break;
      }
    } catch {}
  }
  assert.ok(targets.length > 0, '必须能发现 CDP 页面目标');

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
      }, 15000);

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

  // 4. 等 harness 就绪
  let isReady = false;
  for (let i = 0; i < 50; i++) {
    const res = await sendCdp('Runtime.evaluate', {
      expression: 'window.__stageReady === true && Array.isArray(window.__perfMessages)',
      returnByValue: true,
    });
    if (res?.result?.value) {
      isReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const bootErrors = await sendCdp('Runtime.evaluate', {
    expression: 'document.querySelector("#perf-stage") ? "ok" : "missing-stage"',
    returnByValue: true,
  });
  assert.ok(isReady, `Harness 必须加载完成（当前: ${bootErrors?.result?.value}）`);

  await sendCdp('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await t.test('1. 50 条窗口消息真实挂载：首帧与提交耗时必须在预算内', async () => {
    const measurement = await sendCdp('Runtime.evaluate', {
      expression: `(async () => {
        const { mountMessages } = window.__fluxReact;
        const messages = window.__perfMessages;
        const stage = document.getElementById('perf-stage');
        const waitFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

        // 预热：避开 JIT 冷启动与首次样式失效，但只预热 5 条，避免占满样式缓存
        const warmHost = document.createElement('div');
        warmHost.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px;';
        document.body.appendChild(warmHost);
        const warm = mountMessages(warmHost, messages.slice(0, 5));
        await waitFrame();
        await waitFrame();
        warm.unmount();
        warmHost.remove();
        await waitFrame();

        const runs = [];
        for (let i = 0; i < 5; i++) {
          const host = document.createElement('div');
          host.style.cssText = 'width:100%;';
          stage.appendChild(host);

          const longTaskStart = performance.now();
          const t0 = performance.now();
          const mount = mountMessages(host, messages);
          await waitFrame();
          const firstPaint = performance.now() - t0;
          await waitFrame();
          // 强制同步布局，把「提交完成」口径钉死
          host.offsetHeight;
          const settled = performance.now() - t0;

          const tasks = (window.__longTasks || []).filter((e) => e.start >= longTaskStart);
          const longestTask = tasks.length ? Math.max(...tasks.map((e) => e.duration)) : 0;

          runs.push({
            firstPaint: Math.round(firstPaint * 10) / 10,
            settled: Math.round(settled * 10) / 10,
            longestTask: Math.round(longestTask * 10) / 10,
            messages: host.querySelectorAll('.conv-message').length,
            nodes: host.querySelectorAll('*').length,
            height: host.offsetHeight,
          });

          mount.unmount();
          await waitFrame();
          host.remove();
        }

        return {
          runs,
          windowSize: messages.length,
          longTaskSupported: window.__longTasksSupported !== false,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });

    const value = measurement?.result?.value;
    assert.ok(value, '测量脚本必须返回结果');
    const runs = value.runs;

    assert.equal(value.windowSize, 50, '门禁样本必须与生产窗口化窗口一致（50 条）');
    for (const run of runs) {
      assert.equal(run.messages, 50, '每轮必须完整挂载 50 条消息');
      assert.ok(run.nodes > 500, `挂载后 DOM 节点数异常偏低（${run.nodes}），可能未真实渲染`);
      assert.ok(run.height > 0, '挂载后必须产生真实布局高度');
    }

    const firstPaintMedian = Math.round(median(runs.map((r) => r.firstPaint)) * 10) / 10;
    const settledMedian = Math.round(median(runs.map((r) => r.settled)) * 10) / 10;
    const longestTask = Math.max(...runs.map((r) => r.longestTask));

    console.log(
      `[perf-cdp] 50 条首帧中位数 ${firstPaintMedian}ms / 提交中位数 ${settledMedian}ms / 最长长任务 ${longestTask}ms`
    );
    console.log(`[perf-cdp] 原始轮次 ${JSON.stringify(runs.map((r) => r.firstPaint))}`);

    assert.ok(
      firstPaintMedian <= BUDGET.firstPaintMs,
      `[Perf Budget Exceeded] 50 条首帧中位数 ${firstPaintMedian}ms 突破 ${BUDGET.firstPaintMs}ms 红线；原始轮次 ${JSON.stringify(runs.map((r) => r.firstPaint))}`
    );
    assert.ok(
      settledMedian <= BUDGET.settledMs,
      `[Perf Budget Exceeded] 50 条提交完成中位数 ${settledMedian}ms 突破 ${BUDGET.settledMs}ms 红线`
    );
    assert.ok(
      longestTask <= BUDGET.longestTaskMs,
      `[Perf Budget Exceeded] 挂载期出现 ${longestTask}ms 长任务，突破 ${BUDGET.longestTaskMs}ms 红线`
    );
  });
});
