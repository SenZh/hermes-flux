/**
 * PR-3c 把手对称性回归门禁（真实 Blink CDP）。
 *
 * 【设计意图 (Why)】左/右拖拽把手必须几何同源、可见蓝带等宽。本测试驱动真实编译产物
 *   packages/desktop/dist/renderer/index.html（非 mock harness），物理拖拽并断言几何。
 * 【防范的历史坑 (Pitfall)】左把手曾 8px 全可见、右把手 6px 被 pod 的 overflow:hidden
 *   裁成 3px，用户实测"左蓝带非常宽、右很窄"（2026-11-04 反馈，像素级复现取证 8px vs 3px）。
 * 【约束与规则 (Rules)】端口与 user-data-dir 一律动态分配；退出先发 Browser.close
 *   解开 Windows 文件锁；断言只针对用户可观察几何，不测实现细节。
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
const HANDLE = (side) => `.rail-resize-handle[data-rail-handle=${side}]`;

test('rail-handle-symmetry: 左右拖拽把手几何同源且不被裁剪', async (t) => {
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

  const tmpUserDataDir = path.resolve(os.tmpdir(), `flux-cdp-handle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
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
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
  await send('Page.enable'); await send('Runtime.enable');

  const mounted = await (async () => { for (let i = 0; i < 60; i++) { if (await evaluate(`!!document.querySelector(${JSON.stringify(HANDLE('left'))})`)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; })();
  assert.ok(mounted, '真实 renderer 必须挂载左把手');

  // 检查舱默认收起时先物理展开，右把手必须可达
  await evaluate(`(() => { const pod = document.getElementById('flux-inspector-pod'); if (!pod || pod.getBoundingClientRect().width < 10) document.getElementById('toggle-inspector-btn')?.click(); return true; })()`);
  const podReady = await (async () => { for (let i = 0; i < 20; i++) { if (await evaluate(`!!document.querySelector(${JSON.stringify(HANDLE('right'))})`)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; })();
  assert.ok(podReady, '展开检查舱后右把手必须存在');

  await t.test('两个把手宽度一致（同一 --geo-resize-handle 真值源）', async () => {
    const widths = await evaluate(`(() => {
      const w = (sel) => document.querySelector(sel)?.getBoundingClientRect().width ?? -1;
      return { left: w(${JSON.stringify(HANDLE('left'))}), right: w(${JSON.stringify(HANDLE('right'))}) };
    })()`);
    assert.ok(widths.left > 0 && widths.right > 0, `把手宽度必须为正: ${JSON.stringify(widths)}`);
    assert.ok(Math.abs(widths.left - 6) < 0.5 && Math.abs(widths.right - 6) < 0.5, `左右把手绝对宽度必须钉死在 --geo-resize-handle: 6px，实测左 ${widths.left}px 右 ${widths.right}px（防后段层叠覆盖使整体漂移仍对称逃逸）`);
    assert.ok(Math.abs(widths.left - widths.right) < 0.5, `左右把手宽度必须一致，实测左 ${widths.left}px 右 ${widths.right}px`);
  });

  await t.test('把手完整落在各自轨道内：不被 overflow 裁剪、也不越界盖内容', async () => {
    const containment = await evaluate(`(() => {
      const lh = document.querySelector(${JSON.stringify(HANDLE('left'))})?.getBoundingClientRect();
      const aside = document.getElementById('flux-left-rail')?.getBoundingClientRect();
      const rh = document.querySelector(${JSON.stringify(HANDLE('right'))})?.getBoundingClientRect();
      const pod = document.getElementById('flux-inspector-pod')?.getBoundingClientRect();
      return { leftInside: lh && aside ? lh.right <= aside.right + 0.5 && lh.left >= aside.left - 0.5 : null, rightInside: rh && pod ? rh.left >= pod.left - 0.5 && rh.right <= pod.right + 0.5 : null, lh, rh, aside, pod };
    })()`);
    assert.ok(containment.leftInside, `左把手必须完整位于 aside 边界盒内（不得悬出被内容遮挡或骑跨边界）: ${JSON.stringify({ lh: containment.lh, aside: containment.aside })}`);
    assert.ok(containment.rightInside, `右把手必须完整位于 pod 边界盒内，否则被 overflow:hidden 裁半（历史坑 8px vs 3px）: ${JSON.stringify({ rh: containment.rh, pod: containment.pod })}`);
  });

  await t.test('命中归属：滚动条带不被把手劫持，把手带仍命中把手（正向对照）', async () => {
    const hit = await evaluate(`(() => {
      const handle = document.querySelector(${JSON.stringify(HANDLE('left'))});
      const hr = handle.getBoundingClientRect();
      const sc = document.getElementById('session-list-container')?.getBoundingClientRect();
      if (!sc) return { skip: 'no scroll container' };
      const onHandle = document.elementFromPoint(hr.left + hr.width / 2, hr.top + 200);
      const onScrollbarBand = document.elementFromPoint(sc.right - 3, sc.top + 200);
      return {
        handleHitIsHandle: onHandle === handle,
        scrollbarBandIsHandle: onScrollbarBand === handle,
        scrollbarBandTag: onScrollbarBand ? onScrollbarBand.id || onScrollbarBand.className.slice(0, 48) : null,
        scRight: +sc.right.toFixed(1), hrLeft: +hr.left.toFixed(1),
      };
    })()`);
    assert.equal(hit.skip, undefined, '会话滚动容器必须存在');
    assert.ok(hit.handleHitIsHandle, `把手带中心必须命中把手（正向对照，证明探针在线）: ${JSON.stringify(hit)}`);
    assert.ok(!hit.scrollbarBandIsHandle, `滚动条中线必须落在滚动容器而非把手，否则 6px 滑块被 pointer capture 劫持（双审 P1）: ${JSON.stringify(hit)}`);
  });

  await t.test('pod 左缘把手带下方不得覆盖可交互控件', async () => {
    const band = await evaluate(`(() => {
      const rh = document.querySelector(${JSON.stringify(HANDLE('right'))});
      const r = rh.getBoundingClientRect();
      const stack = document.elementsFromPoint(r.left + 3, r.top + 200);
      const below = stack.find((el) => el !== rh);
      const interactive = below ? below.closest('button,a,input,select,textarea,[role=button]') : null;
      return { belowTag: below ? below.id || below.className.slice(0, 48) : null, interactiveUnder: Boolean(interactive), interactiveTag: interactive ? interactive.tagName : null };
    })()`);
    assert.ok(!band.interactiveUnder, `pod 左缘 6px 把手带下压住了可交互控件，命中被劫持: ${JSON.stringify(band)}`);
  });

  await t.test('移动端视口（390×844 DPR3）把手物理剥离', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    const hidden = await evaluate(`(() => {
      const l = document.querySelector(${JSON.stringify(HANDLE('left'))});
      const r = document.querySelector(${JSON.stringify(HANDLE('right'))});
      return { left: l ? getComputedStyle(l).display : 'absent', right: r ? getComputedStyle(r).display : 'absent' };
    })()`);
    await send('Emulation.clearDeviceMetricsOverride');
    assert.equal(hidden.left, 'none', `移动端左把手必须 display:none（--rail-w-left 被媒体查询锁死，保留即不可用残影）: ${JSON.stringify(hidden)}`);
    assert.equal(hidden.right, 'none', `移动端右把手必须 display:none: ${JSON.stringify(hidden)}`);
  });

  await t.test('物理拖拽左把手：宽度全程稳定且夹取生效', async () => {
    // 视口仿真子测清空 override 后布局恢复是异步的，必须等把手重新可命中再拖，否则坐标落空（间歇红根因）
    const restored = await (async () => {
      for (let i = 0; i < 50; i++) {
        const ok = await evaluate(`(() => { const h = document.querySelector(${JSON.stringify(HANDLE('left'))}); const a = document.getElementById('flux-left-rail'); return Boolean(h && a && getComputedStyle(h).display !== 'none' && Math.abs(a.getBoundingClientRect().width - 264) < 1); })()`);
        if (ok) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    })();
    assert.ok(restored, '清除视口仿真后必须恢复桌面布局（把手可见且轨道回到 264px）');
    const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(HANDLE('left'))}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 200 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 40 * i, y: box.y, button: 'left' });
    const during = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(HANDLE('left'))}); const r = el.getBoundingClientRect();
      return { width: r.width, railVar: getComputedStyle(document.documentElement).getPropertyValue('--rail-w-left').trim(), bg: getComputedStyle(el).backgroundColor };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 240, y: box.y, button: 'left' });
    assert.ok(Math.abs(during.width - (await evaluate(`document.querySelector(${JSON.stringify(HANDLE('left'))}).getBoundingClientRect().width`))) < 0.5, '拖拽期间把手宽度不得漂移');
    assert.ok(during.railVar === '320px', `拖满必须夹取到上限 320px，实测 ${during.railVar}`);
    assert.notEqual(during.bg, 'rgba(0, 0, 0, 0)', '拖拽（hover 锁定）期间必须有高亮反馈');
  });
});
