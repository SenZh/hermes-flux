#!/usr/bin/env node
/**
 * 设计系统 Gallery 审查器（Design System Gallery Verifier）
 *
 * 【设计意图 (Why)】
 *   静态门禁只能证明"没有写违规类名"，证明不了"渲染出来是什么样"。
 *   本脚本把原子组件编译成真实页面，在真实 Blink 内核里截图，并对每个渲染元素的
 *   计算样式做一次普查（圆角 / 阴影 / 字号 / 间距 / 边框 / 行高），
 *   让"好看与否"从主观描述变成可复现的机器判定 + 一张可人工复核的截图。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 只做截图不做断言：截图存在 artifacts 里没人看，视觉退化只能靠人肉眼发现；
 *   2. 用像素基线做 diff：动态字体渲染与亚像素抗锯齿会让基线天天红，最终被关掉；
 *   3. 直接 require 组件源码：TSX 无法被浏览器执行，必须走 esbuild 真实编译，否则验证的不是产物。
 *
 * 【约束与规则 (Rules)】
 *   1. 全部端口由操作系统动态分配，user-data-dir 落在 os.tmpdir() 的独立目录，跑完清理；
 *   2. 只读仓库，唯一写入是 artifacts/gallery/ 下的构建产物与截图；
 *   3. 任何一项普查不通过 → 退出码 1，并把逐条问题打进 evidence.json。
 *
 * 用法：node scripts/verify/gallery.mjs [--open]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'artifacts/gallery');
const UI_DIR = path.join(REPO_ROOT, 'packages/ui');

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findBrowser() {
  return BROWSER_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

function step(label) {
  process.stdout.write(`\n[gallery] ${label}\n`);
}

/* ---------------- 1. 构建产物 ---------------- */

function buildCss() {
  step('编译 Tailwind（tailwind-entry.css → gallery.css）');
  const cli = [
    path.join(UI_DIR, 'node_modules/@tailwindcss/cli/dist/index.mjs'),
    path.join(REPO_ROOT, 'node_modules/@tailwindcss/cli/dist/index.mjs'),
  ].find((p) => fs.existsSync(p));
  if (!cli) throw new Error('未找到 @tailwindcss/cli 入口，请先安装依赖');

  const out = path.join(OUT_DIR, 'gallery.css');
  const res = spawnSync(
    process.execPath,
    [cli, '-i', path.join(UI_DIR, 'src/tailwind-entry.css'), '-o', out],
    { cwd: UI_DIR, encoding: 'utf8' },
  );
  if (res.status !== 0) throw new Error(`Tailwind 编译失败:\n${res.stderr || res.stdout}`);
  return out;
}

async function buildJs() {
  step('esbuild 打包 Gallery 入口（真实编译 TSX，不是要求源码可被浏览器执行）');
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [path.join(UI_DIR, 'src/components-react/gallery/entry.tsx')],
    outfile: path.join(OUT_DIR, 'gallery.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    absWorkingDir: UI_DIR,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
}

function writeHostPage() {
  step('写宿主页（复用真实 styles.css 的 :root 皮肤真值）');
  fs.copyFileSync(
    path.join(REPO_ROOT, 'packages/desktop/src/renderer/styles.css'),
    path.join(OUT_DIR, 'app.css'),
  );
  const html = `<!doctype html>
<html lang="zh-CN" data-theme="obsidian-gold">
<head>
<meta charset="utf-8" />
<title>Hermes Flux · Design System Gallery</title>
<link rel="stylesheet" href="./gallery.css" />
<link rel="stylesheet" href="./app.css" />
<style>
  html, body { margin: 0; padding: 0; }
  body { background: var(--background); }
</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="./gallery.js"></script>
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8');
}

/* ---------------- 2. 计算样式普查（在页面内执行） ---------------- */

const CENSUS = String.raw`(() => {
  const root = document.getElementById('gallery-root');
  if (!root) return { fatal: 'gallery-root 未渲染，说明 React 挂载或打包失败' };

  const px = (v) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const issues = [];
  const push = (el, dimension, detail) => {
    const tag = el.tagName.toLowerCase() + (el.dataset.atom ? '[' + el.dataset.atom + ']' : '');
    issues.push({ dimension, element: tag, text: (el.textContent || '').trim().slice(0, 24), detail });
  };

  const probeShadow = (cls) => {
    const el = document.createElement('div');
    el.className = cls;
    el.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
    document.body.appendChild(el);
    const value = getComputedStyle(el).boxShadow;
    el.remove();
    return value;
  };
  const shadowWhitelist = new Set(
    [probeShadow('shadow-card'), probeShadow('shadow-window'), probeShadow('shadow-dock')].filter(Boolean),
  );
  const fsWhitelist = new Set([10, 11, 12, 13, 14, 16, 20]);
  const radiusWhitelist = new Set([0, 4, 6, 8, 12]);

  const all = [root, ...root.querySelectorAll('*')];
  for (const el of all) {
    const cs = getComputedStyle(el);

    // 1. 圆角必须落在 5 档语义值里（胶囊另行放行）
    const radius = px(cs.borderTopLeftRadius);
    if (radius > 0 && radius < 1000 && !radiusWhitelist.has(radius)) {
      push(el, 'radius', cs.borderTopLeftRadius);
    }

    // 2. 阴影只允许三个语义 Token（其余一律为脏黑大阴影或自定义投影）
    const shadow = cs.boxShadow;
    if (shadow && shadow !== 'none' && !shadowWhitelist.has(shadow)) {
      // specular-top 的 1px ::before 自带内阴影，属于元素伪元素，不在本体上
      push(el, 'shadow', shadow);
    }

    // 3. 字号必须是 7 档阶梯之一（只检查直接承载文本的元素）
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (hasOwnText && !fsWhitelist.has(px(cs.fontSize))) {
      push(el, 'font-size', cs.fontSize);
    }

    // 4. 边框只能是 1px 发丝线或 0
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = px(cs['border' + side + 'Width']);
      if (w !== 0 && w !== 1) push(el, 'border-width', side + '=' + cs['border' + side + 'Width']);
    }

    // 5. 内边距必须落在 4px 网格
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const p = px(cs['padding' + side]);
      if (p % 4 !== 0) push(el, 'padding-grid', side + '=' + cs['padding' + side]);
    }

    // 6. flex/grid 间距必须落在 4px 网格
    const display = cs.display;
    if (display === 'flex' || display === 'grid') {
      for (const k of ['rowGap', 'columnGap']) {
        const g = px(cs[k]);
        if (g % 4 !== 0) push(el, 'gap-grid', k + '=' + cs[k]);
      }
    }
  }

  const rows = [...root.querySelectorAll('[data-atom="list-row"]')].map((el) => el.getBoundingClientRect().height);
  if (rows.length < 3) issues.push({ dimension: 'atom-count', element: 'list-row', text: '', detail: '期望至少 3 行，实际 ' + rows.length });
  if (rows.length && new Set(rows.map((h) => Math.round(h))).size !== 1) {
    issues.push({ dimension: 'row-height', element: 'list-row', text: '', detail: '行高不一致: ' + rows.map((h) => Math.round(h)).join('/') });
  } else if (rows.length && Math.round(rows[0]) !== 48) {
    issues.push({ dimension: 'row-height', element: 'list-row', text: '', detail: '基准行高应为 48px，实际 ' + Math.round(rows[0]) });
  }

  const toolbar = root.querySelector('[data-atom="toolbar"]');
  if (!toolbar) {
    issues.push({ dimension: 'atom-count', element: 'toolbar', text: '', detail: '未找到 toolbar 原子' });
  } else if (Math.round(toolbar.getBoundingClientRect().height) !== 36) {
    issues.push({ dimension: 'toolbar-height', element: 'toolbar', text: '', detail: '应为 36px，实际 ' + Math.round(toolbar.getBoundingClientRect().height) });
  }

  // 7. 受光线必须是真实存在的 1px 内阴影，而不是"声明了但算不出来"
  for (const surface of root.querySelectorAll('[data-atom="surface"]')) {
    if (!surface.classList.contains('specular-top')) continue;
    const before = getComputedStyle(surface, '::before');
    if (!before || before.content === 'none' || px(before.height) !== 1) {
      issues.push({ dimension: 'specular', element: 'surface', text: '', detail: '受光线伪元素缺失或高度非 1px' });
      continue;
    }
    if (!/inset/.test(before.boxShadow || '')) {
      issues.push({ dimension: 'specular', element: 'surface', text: '', detail: '受光线未渲染为内阴影: ' + before.boxShadow });
    }
  }

  return {
    issues,
    stats: {
      nodes: all.length,
      listRows: rows.map((h) => Math.round(h)),
      toolbarHeight: toolbar ? Math.round(toolbar.getBoundingClientRect().height) : null,
      surfaces: root.querySelectorAll('[data-atom="surface"]').length,
      stats: root.querySelectorAll('[data-atom="stat"]').length,
      // 记录关键槽位的真实解析结果：全为 undefined 说明宿主样式表没加载，
      // 此时"零违规"是假绿（所有 var() 都没有值，元素根本没有任何样式可违规）
      tokens: Object.fromEntries(
        ['--background', '--card', '--border-subtle', '--specular-line', '--fs-body', '--radius-card', '--shadow-card'].map(
          (k) => [k, getComputedStyle(document.documentElement).getPropertyValue(k).trim()],
        ),
      ),
    },
  };
})()`;

/* ---------------- 3. 真实内核驱动 ---------------- */

function serveDir(dir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.join(dir, rel);
    if (!filePath.startsWith(dir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.map': 'application/json; charset=utf-8',
    }[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function drive(pageUrl) {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('系统未安装 Edge/Chrome，无法做真实内核验证');

  const userDataDir = path.join(os.tmpdir(), `flux-gallery-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const cdpPort = probe.address().port;
  await new Promise((r) => probe.close(r));

  const proc = spawn(
    browserPath,
    [
      `--remote-debugging-port=${cdpPort}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,900',
      pageUrl,
    ],
    { stdio: 'ignore' },
  );

  let wsUrl = null;
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error('15 秒内未取得 CDP page target');
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
        else resolve(data.result);
      }
    } catch {}
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || '页面执行异常');
    return res.result?.value;
  };

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const ready = await evaluate(`Boolean(document.querySelector('#gallery-root'))`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = path.join(OUT_DIR, 'gallery.png');
  fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));

  const census = await evaluate(CENSUS);

  try {
    await send('Browser.close').catch(() => {});
    ws.close();
  } catch {}
  try { proc.kill(); } catch {}
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}

  return { screenshotPath, census };
}

/* ---------------- main ---------------- */

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  buildCss();
  await buildJs();
  writeHostPage();

  const server = await serveDir(OUT_DIR);
  const port = server.address().port;
  const pageUrl = `http://127.0.0.1:${port}/`;

  step(`启动真实内核内核载入 ${pageUrl}`);
  let result;
  try {
    result = await drive(pageUrl);
  } finally {
    server.close();
  }

  const issues = result.census?.issues ?? [];
  const evidence = {
    generatedAt: new Date().toISOString(),
    pageUrl,
    screenshot: path.relative(REPO_ROOT, result.screenshotPath).split(path.sep).join('/'),
    ok: !result.census?.fatal && issues.length === 0,
    fatal: result.census?.fatal ?? null,
    stats: result.census?.stats ?? null,
    issues,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  step('计算样式普查结果');
  console.log(JSON.stringify(evidence.stats, null, 2));
  console.log(`截图：${evidence.screenshot}`);
  console.log(`报告：artifacts/gallery/evidence.json`);

  if (evidence.fatal) {
    console.error(`\n[gallery] FAILED · ${evidence.fatal}`);
    process.exitCode = 1;
    return;
  }
  if (issues.length > 0) {
    console.error(`\n[gallery] FAILED · ${issues.length} 处视觉契约违规`);
    for (const issue of issues) {
      console.error(`  - [${issue.dimension}] ${issue.element}${issue.text ? ' "' + issue.text + '"' : ''} → ${issue.detail}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\n[gallery] PASS · 全部渲染元素符合视觉契约');
}

main().catch((err) => {
  console.error(`\n[gallery] 异常终止: ${err.stack || err.message}`);
  process.exitCode = 1;
});
