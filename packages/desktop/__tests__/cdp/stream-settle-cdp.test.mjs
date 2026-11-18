import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import esbuild from 'esbuild';

/**
 * 流式收口锚定的真实 Blink 物理验证
 *
 * 【设计意图 (Why)】
 *   单测里的 DOM 桩无法证明两件关键事实：
 *   1. React 真实协调下，「流式空壳 + toolPatchQueue 直写 → 收口提交」会不会留下重复工具包
 *      （实测旧实现 `#msg-tools-*` 有 2 个子节点）；
 *   2. `--conv-intrinsic-median-height` 抬升时，真实内核会不会保持 scrollTop 不变而撑高文档
 *      （这正是用户看到的「视口跳上去」，ΔSh > 0 且 ΔSt = 0）。
 *   本用例在真实 Blink 内复现两者，并用「同 key 外壳」对照实验证明断言具备杀伤力。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 静态 `renderToStaticMarkup` 计数工具包对「DOM 级重复节点」恒真，删掉 key 交接也全绿；
 *   2. 手写 DOM 桩把「Blink 会 clamp scrollTop」当夹具，等于把待验事实写进桩里。
 *
 * 【约束与规则 (Rules)】
 *   1. 必须加载生产同一份 conversation.css，占位高度与 content-visibility 只由 CSS 生效；
 *   2. 对照实验只复刻结构（同 key / 零子 fiber / 外部直写），不得修改生产组件来迁就断言；
 *   3. 用户数据目录一律取 os.tmpdir() 独立沙箱，结束后连同 CDP 与静态服务一并清理。
 */

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9900 + Math.floor(Math.random() * 90);
const BUNDLE_OUT = 'packages/desktop/__tests__/cdp/.tmp/react-entry.js';
const HARNESS = '/packages/desktop/__tests__/cdp/stream-settle-harness.html';

test('流式收口：工具包唯一性与占位高度漂移的真实 Blink 验证', async (t) => {
  if (!fs.existsSync(EDGE_PATH)) {
    t.skip('Microsoft Edge not found on system');
    return;
  }

  fs.mkdirSync(path.dirname(path.resolve(BUNDLE_OUT)), { recursive: true });
  await esbuild.build({
    entryPoints: [path.resolve('packages/ui/__tests__/cdp/react-entry.mjs')],
    outfile: path.resolve(BUNDLE_OUT),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });

  const rootDir = path.resolve('.');
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = HARNESS;
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
      '.woff2': 'font/woff2',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const serverPort = server.address().port;

  const tmpUserDataDir = path.resolve(
    os.tmpdir(),
    `edge-cdp-settle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );

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
      `http://127.0.0.1:${serverPort}${HARNESS}`,
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
      }, 8000);
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

  let ready = false;
  for (let i = 0; i < 60; i++) {
    const res = await sendCdp('Runtime.evaluate', {
      expression: 'window.__stageReady === true',
      returnByValue: true,
    });
    if (res?.result?.value) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, 'Harness environment must be loaded and ready');

  /** 在页面内执行异步场景并取回结构化结果。 */
  const runScenario = async (name) => {
    const res = await sendCdp('Runtime.evaluate', {
      expression: `${name}()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`场景 ${name} 抛错: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result.value;
  };

  await sendCdp('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await t.test('1. 流式直写后收口：工具锚点必须只保留唯一一份工具包', async () => {
    const r = await runScenario('__runToolSwap');
    assert.equal(r.shellFound, true, '流式末行必须产出 #msg-tools-* 外壳');
    assert.equal(r.childrenBefore, 0, '流式态外壳必须零 React 子 fiber，DOM 所有权完整让给 toolPatchQueue');
    assert.equal(r.childrenAfterWrite, 1, '直写补丁后容器内应恰有 1 个节点');
    assert.equal(r.shellStillMounted, true, '收口后锚点必须仍在，否则后续直写与定位全断');
    assert.equal(
      r.childrenAfterSettle,
      1,
      `收口后 #msg-tools-* 必须恰好 1 个子节点（实测旧实现为 2）；实际 ${r.childrenAfterSettle}`
    );
    assert.equal(r.packageNodes, 1, `收口后必须只存在唯一工具包；实际 ${r.packageNodes}`);
    assert.equal(r.patchNodeSurvived, false, '直写残留节点必须随旧外壳一起卸载，不得残留到收口态');
  });

  await t.test('2. 同 key 外壳对照实验：证明上述断言真的能杀死重复节点回归', async () => {
    const r = await runScenario('__runLegacySwap');
    assert.equal(r.shellFound, true, '对照外壳必须挂载');
    assert.equal(
      r.childrenAfterSettle,
      2,
      `同 key 结构下 React 会保留直写节点并追加新节点（实测应为 2）；实际 ${r.childrenAfterSettle}`
    );
    assert.equal(r.packageNodes, 2, '同 key 结构必然出现两份工具包，证明工具包唯一性断言具备杀伤力');
  });

  await t.test('3. 占位高度抬升：真实内核确实按变量放大离屏回合占位（缺陷机制成立）', async () => {
    const r = await runScenario('__runIntrinsicDrift');
    console.log('[stream-settle] intrinsic-drift', JSON.stringify(r));
    assert.ok(
      r.renderedTurns >= 300,
      `长列表必须完整挂载（至少 300 个 .conv-turn，实际 ${r.renderedTurns}）`
    );
    assert.ok(
      r.deltaScrollHeight > 0,
      `抬升 --conv-intrinsic-median-height 必须撑高离屏回合占位（实际 ΔSh=${r.deltaScrollHeight}）`
    );
    assert.equal(
      r.after.scrollHeight - r.after.clientHeight - r.after.scrollTop,
      r.after.dist,
      '距离口径必须自洽（scrollHeight - scrollTop - clientHeight）'
    );
  });

  await t.test('4. 收口一帧后视口锚点行不得位移（读者视线不被拽走）', async () => {
    const r = await runScenario('__runSettleAnchor');
    console.log('[stream-settle] settle-anchor', JSON.stringify(r));
    assert.ok(r.anchorBefore, '收口前必须能定位到第一条可见行');
    assert.ok(r.anchorAfter, '收口后同一条可见行必须仍在 DOM 中');
    assert.ok(
      Math.abs(r.anchorShift) <= 48,
      `收口后可见行相对视口的位移必须限制在安全线内（实际 ${r.anchorShift}px）`
    );
  });
});
