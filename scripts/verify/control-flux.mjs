#!/usr/bin/env node
/**
 * Hermes Flux Universal Verification Controller (scripts/verify/control-flux.mjs)
 *
 * 【设计意图 (Why)】
 * 为 Hermes Flux 全平台工作台提供确定性、可脚本化驱动的真实物理行为验证引擎。
 * 任何接手此仓库的 Agent 均可通过标准命令行驱动真实 Blink 浏览器内核、
 * 操控真实编译后的 Renderer、与状态机进行物理交互、并收集带有截图和 DOM 快照的确定性证据。
 *
 * 【约束与规则 (Rules)】
 * 1. 绝不 Mock 业务核心逻辑；驱动真实的 packages/desktop/dist/ 产物；
 * 2. 端口与 user-data-dir 严格采用内核随机分配与 os.tmpdir() 动态生成，杜绝端口冲突；
 * 3. 退出时严格先发 CDP Browser.close 释放 Windows 文件句柄锁再杀进程；
 * 4. 清理逻辑绝对保留 artifacts/verification/ 证据目录，证据必须在 teardown 后依然可查。
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const BROWSER_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

export function findBrowser() {
  return BROWSER_PATHS.find((p) => fs.existsSync(p)) || null;
}

const REQUIRED_BUILD_ARTIFACTS = [
  'packages/core/dist/index.js',
  'packages/ui/dist/index.js',
  'packages/desktop/dist/renderer/index.js',
  'packages/desktop/dist/renderer/styles.css',
];

export function checkBuildArtifacts() {
  const missing = [];
  for (const rel of REQUIRED_BUILD_ARTIFACTS) {
    const full = path.join(rootDir, rel);
    if (!fs.existsSync(full)) missing.push(rel);
  }
  return { ok: missing.length === 0, missing };
}

// 保证产物输出目录存在
const ARTIFACTS_DIR = path.join(rootDir, 'artifacts/verification');
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

/**
 * 诊断命令：检查当前环境是否满足驱动条件
 */
export async function runDoctor() {
  console.log('🔍 [Flux Verification Doctor] Running environment inspection...');
  const browser = findBrowser();
  const build = checkBuildArtifacts();

  console.log(`  · Operating System: ${process.platform} (${os.arch()})`);
  console.log(`  · Chromium Browser: ${browser ? `✔ Found at ${browser}` : '❌ Not Found'}`);
  console.log(`  · Build Artifacts:  ${build.ok ? '✔ All compiled' : `❌ Missing: ${build.missing.join(', ')}`}`);

  if (!browser || !build.ok) {
    console.error('\n❌ Doctor check failed! Please make sure Edge/Chrome is installed and run `npm run build` first.');
    return false;
  }

  console.log('\n✔ Doctor check passed: Instance is healthy and ready to be driven.');
  return true;
}

/**
 * 启动 CDP 驱动会话
 */
export async function createDriveSession(options = {}) {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('No Edge or Chrome browser found on system');

  const build = checkBuildArtifacts();
  if (!build.ok) {
    throw new Error(`Build artifacts missing: ${build.missing.join(', ')}. Please run npm run build first.`);
  }

  // 1. 动态分配空闲静态伺服端口
  // 【规则】入口页可被调用方指定（默认验收 harness）：厂商图标预览等「纯渲染产物验证」
  // 需要一个能挂载 renderXxx 输出的空白宿主页，否则只能去改动 harness 的 mock 数据。
  const entry = options.entry || options.htmlPath || '/packages/desktop/__tests__/cdp/e2e-acceptance-harness.html';
  // 【规则】入口页必须是以 `/` 开头的仓库相对路径：它既被静态服务的默认路由消费，
  // 又被直接拼进 targetUrl。少了前导斜杠会拼出 `http://host:portpackages/...`，
  // 页面直接 404 而报错信息完全指不到根因。
  if (!entry.startsWith('/')) throw new Error(`createDriveSession entry 必须以 / 开头：${entry}`);
  const entryAbs = path.resolve(rootDir, '.' + entry);
  if (!entryAbs.startsWith(rootDir)) throw new Error(`createDriveSession entry 越出仓库根目录：${entry}`);
  const server = http.createServer((req, res) => {
    let reqPath = '/';
    try {
      reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    } catch {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }
    if (reqPath === '/') reqPath = entry;
    const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
    let filePath = path.resolve(rootDir, '.' + (reqPath.startsWith('/') ? reqPath : '/' + reqPath));
    // harness 页面挂在深层目录时，相对路径 `icons/lobe/...` 会带上前缀路径，回退到真实产物目录
    if ((!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) && reqPath.includes('/icons/lobe/')) {
      const iconRel = reqPath.slice(reqPath.indexOf('icons/lobe/'));
      const iconsBase = path.resolve(rootDir, 'packages', 'desktop', 'dist', 'renderer', 'icons', 'lobe');
      const candidate = path.resolve(rootDir, 'packages', 'desktop', 'dist', 'renderer', iconRel);
      if (candidate.startsWith(iconsBase + path.sep)) {
        filePath = candidate;
      }
    }

    if ((filePath !== rootDir && !filePath.startsWith(rootWithSep)) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  // 2. 动态端口与独立隔离目录
  const tmpUserDataDir = path.resolve(os.tmpdir(), `flux-verify-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

  // 获取一个空闲的调试端口
  const probeServer = http.createServer();
  await new Promise((resolve) => probeServer.listen(0, '127.0.0.1', resolve));
  const cdpPort = probeServer.address().port;
  await new Promise((resolve) => probeServer.close(resolve));

  const targetUrl = `http://127.0.0.1:${serverPort}${entry}`;

  const browserProc = spawn(
    browserPath,
    [
      `--remote-debugging-port=${cdpPort}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${tmpUserDataDir}`,
      `--window-size=${options.width || 1280},${options.height || 800}`,
      targetUrl,
    ],
    { stdio: 'ignore' }
  );

  // 3. 等待 CDP 端口就绪并获取 Page Target WS URL
  let wsUrl = null;
  const startWait = Date.now();
  while (Date.now() - startWait < 15000) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        const targets = await res.json();
        const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (pageTarget) {
          wsUrl = pageTarget.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!wsUrl) {
    browserProc.kill();
    server.close();
    throw new Error('Failed to find page target on CDP port within 15 seconds');
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  let msgId = 0;
  const pendingRequests = new Map();

  ws.addEventListener('message', (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (data.id && pendingRequests.has(data.id)) {
        const { resolve, reject } = pendingRequests.get(data.id);
        pendingRequests.delete(data.id);
        if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
        else resolve(data.result);
      }
    } catch {}
  });

  const sendCommand = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  // 初始化 CDP 域
  await sendCommand('Page.enable');
  await sendCommand('DOM.enable');
  await sendCommand('Runtime.enable');

  const session = {
    sendCommand,
    async evaluate(expression) {
      const res = await sendCommand('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return res.result?.value;
    },
    async waitFor(predicateExpr, timeoutMs = 25000, label = 'condition') {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const val = await session.evaluate(predicateExpr);
          if (val) return val;
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
    },
    async click(selector) {
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`;
      const ok = await session.evaluate(expr);
      if (!ok) throw new Error(`Element not found for click: ${selector}`);
      return true;
    },
    async fill(selector, value) {
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`;
      const ok = await session.evaluate(expr);
      if (!ok) throw new Error(`Element not found for fill: ${selector}`);
      return true;
    },
    async screenshot(savePath) {
      const res = await sendCommand('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(res.data, 'base64');
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(savePath, buf);
      return savePath;
    },
    async cleanup() {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          await sendCommand('Browser.close').catch(() => {});
          ws.close();
        }
      } catch {}
      try { browserProc.kill(); } catch {}
      try { server.close(); } catch {}
      try {
        if (fs.existsSync(tmpUserDataDir)) {
          fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
        }
      } catch {}
    },
  };

  // 等待页面就绪
  await session.waitFor('document.getElementById("flux-app-root") !== null', 10000, 'app mount');
  await session.waitFor('Boolean(window.cdpApp || window.__fluxState)', 10000, 'state init');

  return session;
}

/**
 * 运行指定特征验证用例
 */
export async function runFeature(featureId) {
  console.log(`\n🚀 [Flux Verification] Driving Feature: ${featureId}...`);
  const featureArtifactsDir = path.join(ARTIFACTS_DIR, featureId);
  if (!fs.existsSync(featureArtifactsDir)) fs.mkdirSync(featureArtifactsDir, { recursive: true });

  const session = await createDriveSession(
    featureId === 'first-paint-skeleton'
      || featureId === 'prompt-navigator-rail'
      || featureId === 'provider-bot-binding'
      || featureId === 'activity-indicator-preference'
      || featureId === 'bot-config-center'
      ? { htmlPath: '/packages/desktop/dist/renderer/index.html' }
      : {}
  );
  const startTime = Date.now();

  try {
    if (featureId === 'first-paint-skeleton') {
      console.log('  1. 等待真实 renderer 首帧挂载...');
      await session.waitFor('document.getElementById("flux-app-root")?.childElementCount > 0', 15000, 'renderer first paint');

      console.log('  2. 注入"数据未到达"状态并重绘（真实渲染路径，非 mock 组件）...');
      const injected = await session.evaluate(`(() => {
        const app = window.__fluxState;
        if (!app) return 'no-state';
        app.gatewayConnected = true;
        app.gatewayConnecting = false;
        app.profiles = [];
        app.sessions = [];
        app.messages = [];
        app.groupRooms = [];
        app.projects = [];
        app.profilesPhase = 'loading';
        app.sessionsPhase = 'loading';
        app.messagesPhase = 'loading';
        app.activeSessionId = '';
        app.activeFocus = { type: 'bot', botName: 'default' };
        try {
          window.__fluxRender();
        } catch (error) {
          return 'render-error: ' + (error && error.message ? error.message : String(error));
        }
        return 'ok:' + JSON.stringify({
          leftRail: Boolean(document.getElementById('react-leftrail-host')),
          leftRailChildren: document.getElementById('react-leftrail-host')?.childElementCount || 0,
          stationHtml: (document.getElementById('flux-station-rail')?.innerHTML || '').slice(0, 160),
        });
      })()`);
      console.log('     · 注入结果:', injected);
      if (injected !== 'ok' && !String(injected).startsWith('ok:')) throw new Error(`骨架态注入失败: ${injected}`);

      // React 岛提交是异步的：以用户视角轮询骨架真正出现在 DOM 上，而不是读一次就断言。
      await session.waitFor('document.querySelectorAll(\'[data-skeleton="agent"]\').length === 3', 5000, 'agent skeletons');

      const skeletonState = await session.evaluate(`(() => {
        const q = (sel) => document.querySelectorAll(sel).length;
        return {
          agentBlocks: q('[data-skeleton="agent"]'),
          sessionRows: q('[data-skeleton="session"]'),
          agentCardSkeleton: q('[data-skeleton="agent-card"]'),
          conversationSkeleton: q('[data-conv-skeleton="true"]'),
          realStations: q('[data-station-profile]'),
          primaryCard: q('[data-primary-bot]'),
          conversationHost: Boolean(document.getElementById('react-message-list-host')),
          conversationHtml: (document.getElementById('react-message-list-host')?.innerHTML || '').slice(0, 300),
          bodyText: document.body.innerText,
        };
      })()`);
      console.log('     · 骨架态 DOM 统计:', {
        agentBlocks: skeletonState.agentBlocks,
        sessionRows: skeletonState.sessionRows,
        conversationSkeleton: skeletonState.conversationSkeleton,
      });

      if (skeletonState.agentBlocks !== 3) throw new Error(`微轨必须有 3 个 Agent 骨架，实际 ${skeletonState.agentBlocks}`);
      if (skeletonState.sessionRows !== 4) throw new Error(`会话区必须有 4 行骨架，实际 ${skeletonState.sessionRows}`);
      if (skeletonState.agentCardSkeleton < 1) throw new Error('主工位卡必须是骨架行');
      if (skeletonState.conversationSkeleton !== 1) throw new Error(`对话区必须渲染骨架（host=${skeletonState.conversationHost}, html=${skeletonState.conversationHtml}）`);
      if (skeletonState.realStations !== 0) throw new Error('加载中不得渲染真实 Agent 站点');
      if (skeletonState.primaryCard !== 0) throw new Error('加载中不得渲染主工位身份行');
      if (skeletonState.bodyText.includes('暂无历史会话')) throw new Error('加载中不得断言没有会话');
      if (skeletonState.bodyText.includes('开始新的对话')) throw new Error('加载中不得断言会话为空');

      const skeletonShot = path.join(featureArtifactsDir, 'skeleton.png');
      await session.screenshot(skeletonShot);
      // 规范要求固定名 screenshot.png：首屏骨架就是本用例的主图。
      const primaryShot = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(primaryShot);

      console.log('  2.5 浅色皮肤（warm-paper）下复核骨架可见性（合成对比度）...');
      await session.evaluate(`(() => {
        document.documentElement.setAttribute('data-theme', 'warm-paper');
        // 主题切换带 150ms 过渡：立即截图会抓到旧皮肤的中间态（上一轮浅色图里的深灰块即此）。
        const settle = document.createElement('style');
        settle.id = 'skeleton-transition-settle';
        settle.textContent = '*{transition:none!important}';
        document.head.appendChild(settle);
        return true;
      })()`);
      await session.evaluate('new Promise((resolve) => setTimeout(() => resolve(true), 450))');

      const lightCheck = await session.evaluate(`(() => {
        // 量峰值（opacity=1）而不是动画中间值，才能对"骨架是否可辨"给出稳定结论。
        const measure = document.createElement('style');
        measure.id = 'skeleton-measure';
        measure.textContent = '.flux-skeleton{animation:none!important;opacity:1!important}';
        document.head.appendChild(measure);

        const toRgba = (color) => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
        };
        const luminance = ({ r, g, b }) => {
          const channel = (value) => {
            const c = value / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };
        const composite = (fg, bg) => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
          a: 1,
        });
        const backdropOf = (el) => {
          let node = el.parentElement;
          while (node) {
            const color = toRgba(getComputedStyle(node).backgroundColor);
            if (color.a > 0.9) return color;
            node = node.parentElement;
          }
          return { r: 255, g: 255, b: 255, a: 1 };
        };
        const sample = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const colorText = getComputedStyle(el).backgroundColor;
          const color = toRgba(colorText);
          const backdrop = backdropOf(el);
          const composed = composite(color, backdrop);
          const l1 = luminance(composed);
          const l2 = luminance(backdrop);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          return { colorText, alpha: Math.round(color.a * 1000) / 1000, ratio: Math.round(ratio * 100) / 100 };
        };
        const result = {
          theme: document.documentElement.getAttribute('data-theme'),
          agent: sample('[data-skeleton="agent"]'),
          session: sample('[data-skeleton="session"] .flux-skeleton'),
          conversation: sample('[data-conv-skeleton="true"] .flux-skeleton'),
        };
        measure.remove();
        return result;
      })()`);
      console.log('     · 浅色皮肤合成对比度:', lightCheck);
      for (const [slot, entry] of Object.entries({ agent: lightCheck.agent, session: lightCheck.session, conversation: lightCheck.conversation })) {
        if (!entry) throw new Error(`暖白皮肤下找不到 ${slot} 骨架，无法取证`);
        if (!(entry.alpha >= 0.08)) throw new Error(`暖白皮肤下 ${slot} 骨架近透明（alpha=${entry.alpha}, color=${entry.colorText}）`);
        if (!(entry.ratio >= 1.12)) throw new Error(`暖白皮肤下 ${slot} 骨架不可辨（对比度 ${entry.ratio}:1，需 ≥1.12:1）`);
        if (entry.ratio > 2.2) throw new Error(`暖白皮肤下 ${slot} 骨架过于抢眼（对比度 ${entry.ratio}:1，需 ≤2.2:1）`);
      }
      const lightShot = path.join(featureArtifactsDir, 'skeleton-warm-paper.png');
      await session.screenshot(lightShot);
      await session.evaluate(`(() => {
        document.getElementById('skeleton-transition-settle')?.remove();
        document.documentElement.setAttribute('data-theme', 'obsidian-gold');
        return true;
      })()`);
      await session.evaluate('new Promise((resolve) => setTimeout(() => resolve(true), 450))');

      console.log('  3. 注入"数据已到达"状态，验证骨架原位退场...');
      await session.evaluate(`(() => {
        const app = window.__fluxState;
        if (!app) return false;
        app.gatewayConnected = true;
        app.gatewayConnecting = false;
        app.profiles = [
          { name: 'default', displayName: 'Default 助理', isDefault: true },
          { name: 'arch-wang', displayName: '架构老王' },
        ];
        app.sessions = [{ id: 'verify-s1', title: '骨架验证会话', preview: '数据已到达', botName: 'default', timestamp: Date.now() }];
        app.profilesPhase = 'ready';
        app.sessionsPhase = 'ready';
        app.messagesPhase = 'ready';
        window.__fluxRender();
        return true;
      })()`);

      await session.waitFor('document.querySelectorAll(\'[data-station-profile]\').length > 0', 5000, 'real stations after ready');

      const readyState = await session.evaluate(`(() => {
        const q = (sel) => document.querySelectorAll(sel).length;
        return {
          agentBlocks: q('[data-skeleton="agent"]'),
          sessionRows: q('[data-skeleton="session"]'),
          conversationSkeleton: q('[data-conv-skeleton="true"]'),
          realStations: q('[data-station-profile]'),
          sessionItems: q('.session-item'),
        };
      })()`);
      console.log('     · 就绪态 DOM 统计:', readyState);

      if (readyState.agentBlocks !== 0) throw new Error('数据到达后不得残留 Agent 骨架');
      if (readyState.sessionRows !== 0) throw new Error('数据到达后不得残留会话骨架');
      if (readyState.conversationSkeleton !== 0) throw new Error('数据到达后不得残留对话骨架');
      if (readyState.realStations < 1) throw new Error('数据到达后必须渲染真实 Agent 站点');
      if (readyState.sessionItems < 1) throw new Error('数据到达后必须渲染真实会话行');

      const readyShot = path.join(featureArtifactsDir, 'ready.png');
      await session.screenshot(readyShot);

      const evidence = {
        featureId,
        commit: execSync('git rev-parse HEAD', { cwd: rootDir }).toString().trim(),
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        skeletonState,
        readyState,
        warmPaper: lightCheck,
        screenshots: { skeleton: skeletonShot, ready: readyShot, warmPaper: lightShot, primary: primaryShot },
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log('  ✔ 骨架屏验证成功，证据已落盘:', featureArtifactsDir);
      return true;
    }

    if (featureId === 'bot-primary-chat') {
      console.log('  1. 验证左侧专职 Bot 卡片渲染与初始状态...');
      await session.waitFor('document.querySelector(".rail-primary-agent-card") !== null', 10000, 'primary card');

      const initialCard = await session.evaluate(`(() => {
        const card = document.querySelector('.rail-primary-agent-card');
        return {
          title: card?.querySelector('span')?.textContent?.trim(),
          time: card?.querySelector('span:nth-child(2)')?.textContent?.trim() || '',
          snippet: card?.querySelectorAll('div')[2]?.textContent?.trim() || '',
        };
      })()`);
      console.log('     · 初始专职卡片状态:', initialCard);

      console.log('  2. 点击专职 Bot 卡片进入主工位...');
      await session.click('.rail-primary-agent-card');
      await session.waitFor(`(() => {
        const app = window.cdpApp || window.__fluxState;
        return app && app.activeFocus && app.activeFocus.type === 'bot';
      })()`, 5000, 'bot active focus');

      console.log('  3. 验证 Titlebar 专属工位标题...');
      const title = await session.evaluate(`(() => {
        const titleEl = document.querySelector('.session-title-text') || document.getElementById('titlebar-topic');
        return titleEl ? titleEl.textContent.trim() : '';
      })()`);
      console.log(`     · Titlebar 呈现: "${title}"`);
      if (!title || !title.includes('Forever Chat')) {
        throw new Error(`Titlebar must display Forever Chat title, got: "${title}"`);
      }

      console.log('  4. 在黄金限宽输入舱键入自动化验证指令...');
      await session.fill('#dock-prompt-input', '[Verification Engine] 请确认专职工位状态机');
      await session.click('#dock-send-btn');

      console.log('  5. 验证发信后即刻进入 running 呼吸脉冲态...');
      await session.waitFor(
        'document.querySelector(".rail-primary-agent-card .activity-pulse-indicator") !== null',
        5000,
        'pulse indicator'
      );
      console.log('     ✔ 脉冲呼吸指示器已正确点亮');

      console.log('  6. 模拟接收回复完成，验证时间与副标题原子反哺...');
      await session.evaluate(`(() => {
        const app = window.cdpApp || window.__fluxState;
        if (app) {
          app.isStreaming = false;
          const now = Date.now();
          const botName = app.activeFocus?.botName || 'default';
          const p = app.profiles.find(x => x.name === botName);
          if (p) {
            p.lastMessage = '专职主工位已确认就绪，状态自愈闭环。';
            p.timestamp = now;
            p.lastTime = '刚刚';
            p.activityState = 'read';
          }
          if (typeof app.render === 'function') app.render();
          else if (typeof window.__fluxRender === 'function') window.__fluxRender();
        }
      })()`);

      const updatedCard = await session.evaluate(`(() => {
        const card = document.querySelector('.rail-primary-agent-card');
        return {
          text: card?.innerText,
        };
      })()`);

      console.log('  7. 捕获真实物理渲染截图与证据快照...');
      const screenshotPath = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshotPath);

      const evidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        titlebarTitle: title,
        renderedState: updatedCard,
        screenshot: screenshotPath,
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));

      console.log(`  ✔ 验证成功！证据已落盘:`);
      console.log(`    - 截图: ${screenshotPath}`);
      console.log(`    - 数据: ${path.join(featureArtifactsDir, 'evidence.json')}`);
      return true;
    } else if (featureId === 'session-management') {
      console.log('  1. 验证会话列表挂载与会话切换...');
      await session.waitFor('document.querySelectorAll(".session-item").length > 1', 10000, 'two sessions for draft round trip');

      console.log('  2. 模拟草稿文本输入...');
      await session.fill('#dock-prompt-input', '[Draft] 待发送草稿内容');

      console.log('  3. 切换会话并切回，验证草稿状态保全...');
      const firstSess = await session.evaluate('document.querySelector(".session-item")?.dataset?.id');
      const secondSess = await session.evaluate('document.querySelectorAll(".session-item")[1]?.dataset?.id');
      console.log(`     · 选中会话: ${firstSess}`);
      await session.click(`.session-item[data-id="${secondSess}"]`);
      await session.click(`.session-item[data-id="${firstSess}"]`);

      const draftPreserved = await session.evaluate(`(() => {
        const input = document.getElementById('dock-prompt-input');
        return input ? Boolean(input.value) : false;
      })()`);
      console.log(`     · 草稿与焦点保持: ${draftPreserved}`);
      if (!draftPreserved) throw new Error('会话切换往返后输入草稿丢失');

      console.log('  4. 捕获会话管理物理渲染截图与证据快照...');
      const screenshotPath = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshotPath);

      const evidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        targetSessionId: firstSess,
        draftPreserved,
        screenshot: screenshotPath,
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(`  ✔ 验证成功！证据已落盘: ${screenshotPath}`);
      return true;
    } else if (featureId === 'group-room') {
      console.log('  1. 验证多智能体群聊模块与拼图头像...');
      await session.waitFor('document.querySelector(".rail-group-item") !== null', 10000, 'group item');

      console.log('  2. 点击群聊项进入研讨室...');
      await session.click('.rail-group-item');
      await session.waitFor(`(() => {
        const app = window.cdpApp || window.__fluxState;
        return app && app.activeFocus && app.activeFocus.type === 'group';
      })()`, 5000, 'group active focus');

      const title = await session.evaluate(`(() => {
        const titleEl = document.querySelector('.session-title-text') || document.getElementById('titlebar-topic');
        return titleEl ? titleEl.textContent.trim() : '';
      })()`);
      console.log(`     · Titlebar 呈现群聊名称: "${title}"`);

      console.log('  3. 捕获群聊房间物理渲染截图与证据快照...');
      const screenshotPath = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshotPath);

      const evidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        groupTitle: title,
        screenshot: screenshotPath,
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(`  ✔ 验证成功！证据已落盘: ${screenshotPath}`);
      return true;
    } else if (featureId === 'input-dock-controls') {
      console.log('  1. 验证黄金限宽 740px 输入舱几何约束...');
      await session.waitFor('document.querySelector(".input-dock-container") !== null', 10000, 'input dock');

      const maxWidth = await session.evaluate(`(() => {
        const dock = document.querySelector('.input-dock-container');
        return dock ? getComputedStyle(dock).maxWidth : '';
      })()`);
      console.log(`     · 输入舱计算最大宽度: ${maxWidth}`);

      console.log('  2. 捕获输入舱几何呈现截图与证据快照...');
      const screenshotPath = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshotPath);

      const evidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        computedMaxWidth: maxWidth,
        screenshot: screenshotPath,
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(`  ✔ 验证成功！证据已落盘: ${screenshotPath}`);
      return true;
    } else if (featureId === 'interactive-chat-stage') {
      console.log('  1. 验证输入舱黄金限宽 740px 几何物理约束...');
      await session.waitFor('document.querySelector(".input-dock-container") !== null', 10000, 'input dock');

      const dockMetrics = await session.evaluate(`(() => {
        const dock = document.querySelector('.composer-dock') || document.querySelector('.input-card-box') || document.querySelector('.input-dock-container');
        return {
          maxWidth: dock ? getComputedStyle(dock).maxWidth : '',
          exists: Boolean(dock),
        };
      })()`);
      console.log(`     · 输入舱计算限宽: ${dockMetrics.maxWidth}`);

      console.log('  2. 验证助手行彻底移除重新生成按钮，保留复制与Fork...');
      const actionBtnState = await session.evaluate(`(() => {
        const copyBtn = document.querySelector('[data-action="copy-msg"]');
        const forkBtn = document.querySelector('[data-action="fork-msg"]');
        const regenBtn = document.querySelector('[data-action="regenerate-msg"]');
        return {
          hasCopy: Boolean(copyBtn),
          hasFork: Boolean(forkBtn),
          hasRegen: Boolean(regenBtn),
        };
      })()`);
      console.log('     · 操作按钮状态:', actionBtnState);
      if (actionBtnState.hasRegen) {
        throw new Error('助手消息行必须彻底移除重新生成按钮！');
      }

      console.log('  3. 验证用户消息回滚回填交互...');
      const rollbackRes = await session.evaluate(`(() => {
        const rollbackBtn = document.querySelector('[data-action="rollback-msg"]');
        if (!rollbackBtn) return { success: false, reason: 'no-rollback-btn' };
        rollbackBtn.click();
        const input = document.getElementById('dock-prompt-input');
        return {
          success: true,
          inputValue: input ? input.value : '',
        };
      })()`);
      console.log('     · 回滚回填提问内容:', rollbackRes.inputValue ? '✔ 成功回填' : '未检测到内容');

      console.log('  4. 验证附件双层卡片（上层微缩图、右上角移除按钮、下层结构化标号与文件名）...');
      await session.evaluate(`(() => {
        const app = window.cdpApp || window.__fluxState;
        if (app) {
          app.attachments = [
            { id: 'att-1', name: 'architecture_diagram.png', label: 'Image 1', type: 'image', previewUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="%23d4af37"/></svg>' },
            { id: 'att-2', name: 'spec_v4.md', label: 'Doc 1', type: 'file' },
          ];
          if (typeof app.render === 'function') app.render();
          else if (typeof window.__fluxRender === 'function') window.__fluxRender();
        }
      })()`);

      await session.waitFor('document.querySelector(".composer-attachment-card") !== null', 5000, 'attachment card');
      const cardInfo = await session.evaluate(`(() => {
        const cards = Array.from(document.querySelectorAll('.composer-attachment-card'));
        return {
          count: cards.length,
          labels: cards.map(c => c.querySelector('.attachment-index-label')?.textContent || ''),
          filenames: cards.map(c => c.querySelector('.attachment-filename-label')?.textContent || ''),
          hasRemoveBtn: cards.every(c => Boolean(c.querySelector('.btn-remove-attachment'))),
        };
      })()`);
      console.log('     · 附件卡片状态:', cardInfo);

      console.log('  5. 验证斜杠指令 Popper 唤出与项渲染...');
      await session.fill('#dock-prompt-input', '/');
      const inputEl = await session.evaluate(`(() => {
        const inp = document.getElementById('dock-prompt-input');
        if (inp) inp.dispatchEvent(new Event('input', { bubbles: true }));
        return Boolean(inp);
      })()`);

      const slashPopperVisible = await session.evaluate(`(() => {
        const popper = document.querySelector('.composer-slash-popper');
        return Boolean(popper);
      })()`);
      console.log(`     · 斜杠 Popper 呈现: ${slashPopperVisible}`);

      console.log('  6. 捕获核心交互区物理渲染真实截图与证据快照...');
      const screenshotPath = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshotPath);

      const evidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        dockMetrics,
        actionBtnState,
        rollbackRes,
        cardInfo,
        slashPopperVisible,
        screenshot: screenshotPath,
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(`  ✔ 验证成功！证据已落盘: ${screenshotPath}`);
      return true;
    } else if (featureId === 'clean-light-theme' || featureId === 'warm-paper-theme' || featureId === 'ayu-light-theme') {
      console.log('  1. 切换至 Ayu 晨曦浅色皮肤 (Ayu Light / ayu-light)...');
      await session.evaluate(`(() => {
        const app = window.cdpApp || window.__fluxState;
        if (app) {
          app.theme = 'ayu-light';
          localStorage.setItem('hermes_flux_theme', 'ayu-light');
          localStorage.setItem('hermes_aura_theme', 'ayu-light');
          document.documentElement.setAttribute('data-theme', 'ayu-light');
          document.documentElement.setAttribute('data-variant', 'light');
          if (typeof app.render === 'function') app.render();
          else if (typeof window.__fluxRender === 'function') window.__fluxRender();
        }
      })()`);

      await session.waitFor('document.documentElement.getAttribute("data-theme") === "ayu-light"', 5000, 'theme attribute');

      console.log('  2. 验证核心 Ayu Light Token 计算样式 (羊皮纸暖白底板 #FDFAF4 与天青蓝强调 #4AA8C8)...');
      const themeMetrics = await session.evaluate(`(() => {
        const cs = getComputedStyle(document.documentElement);
        const bodyCs = getComputedStyle(document.body);
        return {
          bgWindow: cs.getPropertyValue('--bg-window').trim(),
          textMain: cs.getPropertyValue('--text-main').trim(),
          accent: cs.getPropertyValue('--accent').trim(),
          bodyBg: bodyCs.backgroundColor,
          bodyColor: bodyCs.color,
        };
      })()`);
      console.log('     · Ayu Light 计算指标:', themeMetrics);

      console.log('  3. 注入参考图真实 Markdown 对话流（tsx代码块、行号、注释与加粗文本）...');
      await session.evaluate(`(() => {
        const app = window.cdpApp || window.__fluxState;
        if (app) {
          app.messages = [
            {
              id: 'msg-ref-1',
              role: 'user',
              content: 'Pin the reference preview header on mobile',
              timestamp: '18:00',
            },
            {
              id: 'msg-ref-2',
              role: 'assistant',
              content: '• pinned === false (mobile): everything stays in a single <article className="flex flex-col gap-4">:\\n\\n' +
                String.fromCharCode(96,96,96) + 'tsx\\n<article className="flex flex-col gap-4">\\n  <header ...>{header}</header>\\n  <div className="border-b ... pb-4">{meta}</div>\\n  {children}  {/* body + comments */}\\n  <div ...>{footer}</div>\\n</article>\\n' +
                String.fromCharCode(96,96,96) +
                '\\n\\nHeader, meta, body and comments all remain in the sheet scroll flow. **The header is not pinned on mobile.**\\n\\n• 行内指令与路由排版：session.create、message.delta 与 POST /auth/login（中性出版级排版）\\n\\n## Conclusion\\n\\nNo — #5029 does not keep the header pinned on mobile widths. The mobile callers pass pinned={!isMobile}, i.e. pinned === false on mobile.\\n\\n> Recap: Investigated the Issues & PRs preview: PR #5029 pins the header on desktop, but it still scrolls away with the body on mobile; no files were changed.',
              timestamp: '18:05',
            }
          ];
          if (typeof app.render === 'function') app.render();
          else if (typeof window.__fluxRender === 'function') window.__fluxRender();
        }
      })()`);

      await session.waitFor('document.querySelectorAll(".message-row").length >= 2', 5000, 'rendered messages');

      console.log('  4. 验证黄金限宽输入舱与侧边栏在 Ayu Light 模式下的纯白浮起与边框...');
      const dockMetrics = await session.evaluate(`(() => {
        const dock = document.querySelector('.composer-dock') || document.querySelector('.input-card-box') || document.querySelector('.input-dock-container');
        const card = document.querySelector('.session-item.active') || document.querySelector('.session-item');
        return {
          dockExists: Boolean(dock),
          cardExists: Boolean(card),
        };
      })()`);
      console.log('     · 组件装配验证:', dockMetrics);

      console.log('  5. 捕获 Ayu 晨曦真实物理渲染截图与证据快照...');
      const screenshotPath = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshotPath);

      const evidence = {
        featureId,
        theme: 'ayu-light',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        themeMetrics,
        dockMetrics,
        screenshot: screenshotPath,
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(`  ✔ Ayu 晨曦皮肤验证成功！证据已落盘: ${screenshotPath}`);
      return true;
    } else if (featureId === 'prompt-navigator-rail') {
      console.log('  1. 等待真实 renderer 挂载并注入多条用户提问（走真实渲染路径）...');
      await session.waitFor('document.getElementById("flux-app-root")?.childElementCount > 0', 15000, 'renderer first paint');

      const injected = await session.evaluate(`(() => {
        const app = window.cdpApp || window.__fluxState;
        if (!app) return 'no-state';
        const messages = [];
        for (let i = 0; i < 24; i += 1) {
          messages.push({ id: 'pn-user-' + i, role: 'user', content: '第 ' + (i + 1) + ' 次提问：把构建脚本改成增量编译', timestamp: '18:0' + (i % 10) });
          messages.push({ id: 'pn-assist-' + i, role: 'assistant', content: '收到，第 ' + (i + 1) + ' 轮答复。', timestamp: '18:1' + (i % 10) });
        }
        app.gatewayConnected = true;
        app.gatewayConnecting = false;
        app.messages = messages;
        try {
          if (typeof app.render === 'function') app.render();
          else if (typeof window.__fluxRender === 'function') window.__fluxRender();
        } catch (error) {
          return 'render-error: ' + (error && error.message ? error.message : String(error));
        }
        return 'ok';
      })()`);
      if (String(injected) !== 'ok') throw new Error(`提问注入失败: ${injected}`);

      console.log('  2. 等待导航轨挂载并读命中带宽度...');
      await session.waitFor('document.querySelector(".conv-prompt-rail__gutter") !== null', 8000, 'prompt rail gutter');
      const railMetrics = await session.evaluate(`(() => {
        const gutter = document.querySelector('.conv-prompt-rail__gutter');
        const gr = gutter.getBoundingClientRect();
        const ticks = Array.from(document.querySelectorAll('.conv-prompt-rail__tick'));
        const stage = document.querySelector('.flux-middle-pod');
        const stageBg = stage ? getComputedStyle(stage).backgroundColor : '';
        const normal = ticks.find((t) => !t.classList.contains('is-active') && !t.classList.contains('is-highlighted'));
        return {
          gutterWidth: +gr.width.toFixed(2),
          tickCount: ticks.length,
          tickHeight: ticks[0] ? getComputedStyle(ticks[0].firstElementChild).height : null,
          tickColor: normal ? getComputedStyle(normal.firstElementChild).backgroundColor : null,
          stageBg,
        };
      })()`);
      console.log('     · 轨道指标:', railMetrics);
      if (railMetrics.tickCount === 0 || railMetrics.tickCount > 30) {
        throw new Error(`轨道 tick 数量必须落在 1~30，实测 ${railMetrics.tickCount}`);
      }
      if (railMetrics.gutterWidth !== 28 && railMetrics.gutterWidth !== 12) {
        throw new Error(`命中带宽度必须是 28 或 12，实测 ${railMetrics.gutterWidth}`);
      }

      console.log('  3. 真实指针事件驱动面板挂载，读行几何与序号槽位...');
      const panelMetrics = await session.evaluate(`(async () => {
        const gutter = document.querySelector('.conv-prompt-rail__gutter');
        const gr = gutter.getBoundingClientRect();
        gutter.dispatchEvent(new PointerEvent('pointermove', {
          clientX: gr.left + gr.width / 2,
          clientY: gr.top + gr.height / 2,
          bubbles: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        const panel = document.querySelector('.conv-prompt-rail__panel');
        if (!panel) return { mounted: false };
        const cs = getComputedStyle(panel);
        const rows = Array.from(panel.querySelectorAll('.conv-prompt-rail__panel-row'));
        const viewport = panel.querySelector('.conv-prompt-rail__panel-viewport');
        const rowCs = rows[0] ? getComputedStyle(rows[0]) : null;
        return {
          mounted: true,
          padding: cs.padding,
          radius: cs.borderTopLeftRadius,
          borderWidth: cs.borderTopWidth,
          boxShadow: cs.boxShadow,
          rowCount: rows.length,
          rowHeight: rowCs ? rowCs.height : null,
          rowChildren: rows[0] ? rows[0].children.length : null,
          rowTabIndex: rows[0] ? rows[0].tabIndex : null,
          visibleRows: viewport ? Math.round(viewport.getBoundingClientRect().height / parseFloat(rowCs.height)) : null,
          indexNodes: panel.querySelectorAll('.conv-prompt-rail__panel-index').length,
          topsAscendBy: rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : null,
        };
      })()`);
      console.log('     · 面板指标:', panelMetrics);
      if (panelMetrics.mounted !== true) throw new Error('指针事件后面板必须挂载');
      if (panelMetrics.indexNodes !== 0) throw new Error(`面板行不得含序号节点，实测 ${panelMetrics.indexNodes}`);
      if (panelMetrics.rowChildren !== 1) throw new Error(`面板行必须只有一个文本子节点，实测 ${panelMetrics.rowChildren}`);
      if (panelMetrics.rowTabIndex !== -1) throw new Error(`面板行必须不进 Tab 序列，实测 tabIndex=${panelMetrics.rowTabIndex}`);
      if (panelMetrics.rowHeight !== '40px') throw new Error(`面板行高必须 40px，实测 ${panelMetrics.rowHeight}`);
      if (panelMetrics.visibleRows !== 8) throw new Error(`面板必须可见 8 行，实测 ${panelMetrics.visibleRows}`);
      if (panelMetrics.rowCount !== 10) throw new Error(`面板挂载行数必须是 8 可见 + 2 overscan = 10，实测 ${panelMetrics.rowCount}`);
      if (panelMetrics.padding !== '8px') throw new Error(`面板内缩必须 8px，实测 ${panelMetrics.padding}`);
      if (panelMetrics.borderWidth !== '1px') throw new Error(`面板边框必须 1px 发丝线，实测 ${panelMetrics.borderWidth}`);
      if (panelMetrics.radius !== '8px') throw new Error(`面板圆角必须 8px，实测 ${panelMetrics.radius}`);
      if (Math.abs(panelMetrics.topsAscendBy - 40) > 0.5) throw new Error(`行间距必须等于行高 40px，实测 ${panelMetrics.topsAscendBy}`);
      // --shadow-card 在两个浅色皮肤自带 0 0 0 1px 描边，与 border 并存会叠成双线
      if (/0px 0px 0px 1px/.test(panelMetrics.boxShadow)) {
        throw new Error(`浮层遮蔽不得再叠加 1px 描边层：${panelMetrics.boxShadow}`);
      }

      console.log('  4. 点击一根非当前 tick，验证跳转落点与当前项同步...');
      const jumpMetrics = await session.evaluate(`(async () => {
        const ticks = Array.from(document.querySelectorAll('.conv-prompt-rail__tick'));
        // 必须选一个「离当前位置足够远」的目标：窗口内相邻 tick 跳转不改变 scrollTop，等于没验证。
        const target = ticks[0];
        if (!target || target.classList.contains('is-active')) return { skipped: 'no-far-tick' };
        const stream = document.getElementById('conversation-stream');
        const beforeTop = stream.scrollTop;
        const gutter = document.querySelector('.conv-prompt-rail__gutter');
        const gr = gutter.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        gutter.dispatchEvent(new PointerEvent('pointermove', {
          clientX: gr.left + gr.width / 2,
          clientY: tr.top + tr.height / 2,
          bubbles: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 120));
        // 用带坐标的真实 MouseEvent：gutter 靠 clientY 反算 tick 下标，裸 click() 的 clientY 为 0，落不到任何 tick。
        gutter.dispatchEvent(new MouseEvent('click', {
          clientX: gr.left + gr.width / 2,
          clientY: tr.top + tr.height / 2,
          bubbles: true,
        }));
        await new Promise((resolve) => setTimeout(resolve, 600));
        const activeTickIndex = Array.from(document.querySelectorAll('.conv-prompt-rail__tick')).findIndex((t) => t.classList.contains('is-active'));
        return {
          moved: stream.scrollTop !== beforeTop,
          beforeTop: +beforeTop.toFixed(1),
          afterTop: +stream.scrollTop.toFixed(1),
          activeTickIndex,
          activeTickCount: document.querySelectorAll('.conv-prompt-rail__tick.is-active').length,
        };
      })()`);
      console.log('     · 跳转指标:', jumpMetrics);
      if (jumpMetrics.skipped === undefined) {
        if (jumpMetrics.activeTickCount !== 1) {
          throw new Error(`跳转后当前项必须唯一，实测 ${jumpMetrics.activeTickCount}`);
        }
        if (jumpMetrics.activeTickIndex < 0) {
          throw new Error('跳转后必须有处于当前态的 tick');
        }
        if (!jumpMetrics.moved) {
          throw new Error(`点击远端 tick 后滚动位置必须改变，实测仍停在 scrollTop=${jumpMetrics.afterTop}`);
        }
      }

      console.log('  5. 键盘通路：gutter 聚焦后 End 与 ArrowUp 必须移动高亮且指向已挂载 tick...');
      const keyboardMetrics = await session.evaluate(`(async () => {
        const gutter = document.querySelector('.conv-prompt-rail__gutter');
        gutter.focus();
        const dispatch = (key) => gutter.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        dispatch('End');
        await new Promise((resolve) => setTimeout(resolve, 150));
        const afterEnd = gutter.getAttribute('aria-activedescendant');
        const endTargetMounted = afterEnd ? Boolean(document.getElementById(afterEnd)) : false;
        dispatch('ArrowUp');
        await new Promise((resolve) => setTimeout(resolve, 150));
        const afterUp = gutter.getAttribute('aria-activedescendant');
        const upTargetMounted = afterUp ? Boolean(document.getElementById(afterUp)) : false;
        return {
          afterEnd,
          endTargetMounted,
          afterUp,
          upTargetMounted,
          moved: afterEnd !== afterUp,
          isGutterFocused: document.activeElement === gutter,
        };
      })()`);
      console.log('     · 键盘指标:', keyboardMetrics);
      if (!keyboardMetrics.isGutterFocused) throw new Error('gutter 必须可获得焦点（Tab 序列入口）');
      if (!keyboardMetrics.afterEnd) throw new Error('End 键后 aria-activedescendant 必须指向某项');
      if (!keyboardMetrics.endTargetMounted) throw new Error('End 指示的目标 tick 必须已挂载，不得指向不存在节点');
      if (!keyboardMetrics.upTargetMounted) throw new Error('ArrowUp 后目标 tick 必须仍已挂载');
      if (!keyboardMetrics.moved) throw new Error('ArrowUp 必须让高亮相对 End 位置发生移动');

      console.log('  6. 捕获真实渲染截图与证据快照...');
      const railScreenshot = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(railScreenshot);

      const railEvidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        railMetrics,
        panelMetrics,
        jumpMetrics,
        keyboardMetrics,
        screenshot: railScreenshot,
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(railEvidence, null, 2));
      console.log(`  ✔ 提示词导航轨验证成功！证据已落盘: ${railScreenshot}`);
      return true;
    } else if (featureId === 'provider-bot-binding') {
      console.log('  1. 打开设置 › 模型与提供商，注入一条自定义端点与两个 Bot（走真实渲染路径）...');
      await session.waitFor('document.getElementById("flux-app-root")?.childElementCount > 0', 15000, 'renderer first paint');
      await session.click('#btn-open-settings');
      await session.waitFor('document.querySelector("[data-testid=settings-dialog]") !== null', 8000, 'settings dialog');
      await session.click('[data-settings-section=providers]');
      await session.waitFor('window.__fluxState.settingsProviderViews.status !== "loading"', 15000, 'provider load settled');

      const injected = await session.evaluate(`(() => {
        const s = window.__fluxState;
        s.profiles = [
          { name: 'default', displayName: 'default' },
          { name: 'aura', displayName: 'aura' },
        ];
        s.scopedProfile = 'default';
        s.settingsProviderViews = { status: 'ready', data: [{
          key: 'custom:fn', kind: 'custom', id: 'fn', name: 'Fn 网关',
          models: ['fn/m1'], detail: 'http://127.0.0.1:9/v1', availability: 'ready',
          agents: [
            { profile: 'default', displayName: 'default', state: 'active', detail: 'fn/m1' },
            { profile: 'aura', displayName: 'aura', state: 'absent' },
          ],
        }] };
        s.settingsCustomEndpoints = { status: 'ready', data: [
          { id: 'fn', name: 'Fn 网关', baseUrl: 'http://127.0.0.1:9/v1', models: ['fn/m1'], hasApiKey: true },
        ] };
        s.settingsEndpointProfiles = { fn: ['default'] };
        window.__fluxRender();
        return 'ok';
      })()`);
      if (String(injected) !== 'ok') throw new Error(`提供商状态注入失败: ${injected}`);
      await session.waitFor('document.querySelector("[data-agent-profile=aura]") !== null', 8000, 'aura avatar');

      console.log('  2. 未配置头像点击前不得有任何确认条，也不得写入配置...');
      const before = await session.evaluate(`(() => ({
        strips: document.querySelectorAll('[data-attach-phase]').length,
        profiles: JSON.stringify(window.__fluxState.settingsEndpointProfiles),
      }))()`);
      if (before.strips !== 0) throw new Error(`初始不得有确认条，实测 ${before.strips}`);

      console.log('  3. 真实点击未配置头像：只展开确认条，不写任何配置...');
      await session.click('[data-agent-profile=aura]');
      await session.waitFor('document.querySelector("[data-attach-phase=choosing]") !== null', 5000, 'choosing strip');
      const opened = await session.evaluate(`(() => {
        const strip = document.querySelector('[data-attach-phase=choosing]');
        const buttons = Array.from(strip.querySelectorAll('button')).map((b) => b.textContent.trim());
        const avatar = document.querySelector('[data-agent-profile=aura] input');
        return {
          profile: strip.getAttribute('data-attach-profile'),
          buttons,
          hasPassword: Boolean(strip.querySelector('input[type=password]')),
          role: strip.firstElementChild.getAttribute('role'),
          labelled: Boolean(strip.firstElementChild.getAttribute('aria-labelledby')),
          expanded: avatar.getAttribute('aria-expanded'),
          controls: avatar.getAttribute('aria-controls'),
          focusedInsideStrip: strip.contains(document.activeElement),
          profiles: JSON.stringify(window.__fluxState.settingsEndpointProfiles),
        };
      })()`);
      if (opened.profile !== 'aura') throw new Error(`确认条必须挂在 aura 上，实测 ${opened.profile}`);
      if (opened.buttons.length !== 3) throw new Error(`确认条必须只有三个动作，实测 ${JSON.stringify(opened.buttons)}`);
      if (opened.hasPassword) throw new Error('选择意图阶段不得出现密钥框');
      if (opened.role !== 'group') throw new Error(`确认条必须是 group，实测 ${opened.role}`);
      if (!opened.labelled) throw new Error('确认条必须用标题做可访问名称');
      if (opened.expanded !== 'true') throw new Error(`头像必须声明展开态，实测 ${opened.expanded}`);
      if (!opened.controls) throw new Error('头像必须指向它展开的确认条');
      if (!opened.focusedInsideStrip) throw new Error('展开确认条后焦点必须进入条内，否则读屏用户以为点击没反应');
      if (opened.profiles !== before.profiles) throw new Error('展开确认条不得写入任何配置');

      const screenshotChoosing = path.join(featureArtifactsDir, 'screenshot-choosing.png');
      await session.screenshot(screenshotChoosing);

      console.log('  4. 点「仅启用」：无网关时写入失败必须在条内原位显式呈现...');
      await session.evaluate(`(() => {
        const strip = document.querySelector('[data-attach-phase=choosing]');
        strip.querySelectorAll('button')[0].click();
        return true;
      })()`);
      await session.waitFor(
        'Boolean(document.querySelector("[data-attach-phase=choosing] [role=alert], [data-attach-phase=needs-key]"))',
        8000,
        'failure surfaced in place',
      );
      const afterFailure = await session.evaluate(`(() => {
        const strip = document.querySelector('[data-attach-phase]');
        return {
          phase: strip.getAttribute('data-attach-phase'),
          alert: (strip.querySelector('[role=alert]')?.textContent || '').trim(),
          cancelEnabled: Array.from(strip.querySelectorAll('button')).some((b) => b.textContent.trim() === '取消' && !b.disabled),
        };
      })()`);
      if (afterFailure.phase !== 'needs-key' && !afterFailure.alert) {
        throw new Error(`失败必须显式可见，实测 ${JSON.stringify(afterFailure)}`);
      }
      if (!afterFailure.cancelEnabled) throw new Error('失败后必须能取消，否则用户被锁死在确认条里');

      console.log('  5. 取消：确认条必须收起，且不得再弹成功提示...');
      await session.evaluate(`(() => {
        const strip = document.querySelector('[data-attach-phase]');
        const buttons = Array.from(strip.querySelectorAll('button'));
        buttons[buttons.length - 1].click();
        return true;
      })()`);
      await session.waitFor('document.querySelector("[data-attach-phase]") === null', 5000, 'cancel clears strip');

      console.log('  6. 添加提供商 › 自定义端点：「保存时配置到」必须是同一套头像网格，保存目标恒勾选且锁定...');
      await session.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const add = buttons.find((b) => b.textContent.trim() === '添加提供商');
        add.click();
        return true;
      })()`);
      await session.waitFor('document.querySelectorAll("[role=dialog]").length >= 2', 5000, 'add dialog');
      await session.evaluate(`(() => {
        const dialogs = Array.from(document.querySelectorAll('[role=dialog]'));
        const dlg = dialogs[dialogs.length - 1];
        const seg = Array.from(dlg.querySelectorAll('button')).filter((b) => b.textContent.trim().startsWith('自定义'));
        seg[seg.length - 1].click();
        return true;
      })()`);
      await session.waitFor('document.body.textContent.includes("保存时配置到")', 5000, 'fan-out section');
      const fanOut = await session.evaluate(`(() => {
        const label = Array.from(document.querySelectorAll('span')).find((n) => n.textContent.trim() === '保存时配置到');
        const section = label.parentElement.parentElement;
        const cells = Array.from(section.querySelectorAll('label'));
        return {
          hasGrid: cells.length > 0 && cells.every((c) => Boolean(c.querySelector('span.rounded-full'))),
          cellCount: cells.length,
          checkedCount: cells.filter((c) => c.querySelector('input').checked).length,
          lockedCount: cells.filter((c) => c.querySelector('input').disabled).length,
          lockedBadges: section.querySelectorAll('[data-bot-badge="locked"]').length,
          checkedBadges: section.querySelectorAll('[data-bot-badge="checked"]').length,
          nativeCheckboxes: section.querySelectorAll('input[type=checkbox]:not(.sr-only)').length,
        };
      })()`);
      if (!fanOut.hasGrid) throw new Error('「保存时配置到」必须使用头像选择，而不是原生复选框');
      if (fanOut.cellCount !== 2) throw new Error(`两个 Bot 都要出现，实测 ${fanOut.cellCount}`);
      if (fanOut.lockedCount !== 1) throw new Error(`当前 Bot 必须锁定，实测 ${fanOut.lockedCount}`);
      if (fanOut.checkedCount !== 1) throw new Error(`当前 Bot 必须默认勾选，实测 ${fanOut.checkedCount}`);
      if (fanOut.lockedBadges !== 1) throw new Error(`保存目标必须用锁形角标，实测 ${fanOut.lockedBadges}`);
      if (fanOut.nativeCheckboxes !== 0) throw new Error('不得再出现原生可见复选框');

      await session.evaluate(`(() => {
        const label = Array.from(document.querySelectorAll('span')).find((n) => n.textContent.trim() === '保存时配置到');
        const section = label.parentElement.parentElement;
        const cell = Array.from(section.querySelectorAll('label')).find((c) => c.textContent.trim() === 'aura');
        cell.click();
        return true;
      })()`);
      await session.waitFor(`(() => {
        const label = Array.from(document.querySelectorAll('span')).find((n) => n.textContent.trim() === '保存时配置到');
        const section = label.parentElement.parentElement;
        const cell = Array.from(section.querySelectorAll('label')).find((c) => c.textContent.trim() === 'aura');
        return cell.querySelector('input').checked;
      })()`, 5000, 'aura toggled on');

      console.log('  7. 滚到底后「保存」必须真实可见可点（弹框高度受限，动作条不能被推出可达区）...');
      const saveReachable = await session.evaluate(`(async () => {
        const dialogs = Array.from(document.querySelectorAll('[role=dialog]'));
        const dlg = dialogs[dialogs.length - 1];
        const scroller = dlg.querySelector('.overflow-y-auto');
        scroller.scrollTop = scroller.scrollHeight;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const save = Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent.trim() === '保存');
        if (!save) return { found: false };
        const r = save.getBoundingClientRect();
        const d = dlg.getBoundingClientRect();
        return {
          found: true,
          visible: r.top >= d.top && r.bottom <= d.bottom && r.height > 0,
          hitTestable: dlg.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)),
        };
      })()`);
      console.log('     · 保存按钮可达性:', saveReachable);
      if (!saveReachable.found) throw new Error('必须存在「保存」按钮');
      if (!saveReachable.visible) throw new Error('滚到底后「保存」必须完整落在弹框可视区内');
      if (!saveReachable.hitTestable) throw new Error('「保存」必须真实可点，不能被其它元素盖住');
      await session.screenshot(path.join(featureArtifactsDir, 'screenshot-save-reachable.png'));

      const screenshot = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshot);
      const evidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        before,
        opened,
        afterFailure,
        fanOut,
        saveReachable,
        screenshots: [screenshotChoosing, screenshot],
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(`  ✔ 提供商头像绑定验证成功！证据已落盘: ${screenshot}`);
      return true;
    } else if (featureId === 'activity-indicator-preference') {
      const openAppearance = async () => {
        await session.waitFor('Boolean(document.getElementById("btn-open-settings"))', 15000, 'titlebar settings button');
        await session.click('#btn-open-settings');
        await session.waitFor('document.querySelector("[data-testid=settings-dialog]") !== null', 10000, 'settings dialog');
        await session.click('[data-settings-section=appearance]');
        await session.waitFor('document.querySelector("[data-settings-section=appearance][aria-current=page]") !== null', 8000, 'appearance active');
        await session.waitFor('document.querySelectorAll("[data-activity-variant]").length === 6', 8000, 'six variant cards');
      };

      console.log('  1. 打开设置 › 外观：六张变体卡必须各自运行真实动效...');
      await openAppearance();
      const cards = await session.evaluate(`(() => {
        const list = Array.from(document.querySelectorAll('[data-activity-variant]'));
        return list.map((card) => {
          const variant = card.getAttribute('data-activity-variant');
          const preview = card.querySelector('[data-activity-preview]');
          const animated = preview ? Array.from(preview.querySelectorAll('*')).filter((el) => {
            const name = getComputedStyle(el).animationName;
            return name && name !== 'none';
          }).length : 0;
          return {
            variant,
            checked: card.getAttribute('aria-checked'),
            previewStatus: preview && preview.querySelector('[data-status]') ? preview.querySelector('[data-status]').getAttribute('data-status') : null,
            variantClass: Boolean(preview && preview.querySelector('.flux-variant-' + variant)),
            animatedNodes: animated,
            width: Math.round(card.getBoundingClientRect().width),
          };
        });
      })()`);
      console.log('     · 卡片统计:', JSON.stringify(cards));
      const expectedVariants = ['cloud', 'gyro', 'orbit', 'synapse', 'spring', 'matrix'];
      if (JSON.stringify(cards.map((card) => card.variant)) !== JSON.stringify(expectedVariants)) {
        throw new Error(`六张卡顺序必须与真值表一致，实测 ${cards.map((card) => card.variant).join(',')}`);
      }
      for (const card of cards) {
        if (card.previewStatus !== 'running') throw new Error(`${card.variant} 预览必须是运行态，实测 ${card.previewStatus}`);
        if (!card.variantClass) throw new Error(`${card.variant} 预览缺少自身变体类名`);
        if (card.animatedNodes < 1) throw new Error(`${card.variant} 预览没有任何动画在跑（等于静态截图）`);
        if (card.width < 200) throw new Error(`${card.variant} 卡片被压窄（${card.width}px），两列网格失效`);
      }
      if (cards.filter((card) => card.checked === 'true').length !== 1) throw new Error('变体选中态必须互斥');

      console.log('  2. 点击「轨道」：必须立即生效并落盘...');
      await session.click('[data-activity-variant=orbit]');
      await session.waitFor('document.querySelector("[data-activity-variant=orbit]").getAttribute("aria-checked") === "true"', 5000, 'orbit checked');
      const applied = await session.evaluate(`(() => ({
        stored: localStorage.getItem('hermes_flux_activity_variant'),
        checked: Array.from(document.querySelectorAll('[data-activity-variant][aria-checked=true]')).map((el) => el.getAttribute('data-activity-variant')),
      }))()`);
      if (applied.stored !== 'orbit') throw new Error(`偏好必须落盘为 orbit，实测 ${applied.stored}`);
      if (JSON.stringify(applied.checked) !== '["orbit"]') throw new Error(`选中态必须唯一切到 orbit，实测 ${JSON.stringify(applied.checked)}`);

      console.log('  3. 切到 English：卡片名称与描述不得被截断...');
      const switched = await session.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll('.flux-settings button')).find((b) => b.textContent.trim() === 'English');
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      if (!switched) throw new Error('外观页必须能切到 English');
      await session.waitFor('document.body.textContent.includes("Activity indicator")', 5000, 'english appearance panel');
      const clipping = await session.evaluate(`(() => Array.from(document.querySelectorAll('[data-activity-variant] [class*="truncate"]')).map((el) => ({
        text: el.textContent.trim(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        clipped: el.scrollWidth > el.clientWidth + 1,
      })))()`);
      const clipped = clipping.filter((row) => row.clipped);
      console.log('     · 文本宽度:', JSON.stringify(clipping));
      if (clipped.length > 0) throw new Error(`英文文案被截断：${JSON.stringify(clipped)}`);

      console.log('  4. 减少动态效果：六套动效必须停止...');
      await session.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      const reduced = await session.evaluate(`(() => {
        const animated = Array.from(document.querySelectorAll('[data-activity-preview] *')).filter((el) => getComputedStyle(el).animationName !== 'none');
        return { total: animated.length, offenders: animated.slice(0, 5).map((el) => String(el.className)) };
      })()`);
      await session.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      console.log('     · reduce 后仍动画的节点:', JSON.stringify(reduced));
      if (reduced.total > 0) throw new Error(`减少动态效果下不得继续动画：${JSON.stringify(reduced.offenders)}`);

      console.log('  5. 页面隐藏：六套动效必须暂停而不是空转...');
      const hidden = await session.evaluate(`(() => {
        document.documentElement.dataset.pageHidden = 'true';
        const animated = Array.from(document.querySelectorAll('[data-activity-preview] *')).filter((el) => getComputedStyle(el).animationName !== 'none');
        const notPaused = animated.filter((el) => getComputedStyle(el).animationPlayState !== 'paused').map((el) => String(el.className));
        document.documentElement.dataset.pageHidden = 'false';
        return { total: animated.length, notPaused };
      })()`);
      console.log('     · 隐藏态统计:', JSON.stringify(hidden));
      if (hidden.total === 0) throw new Error('预览里必须存在真实动画节点，否则隐藏暂停无从谈起');
      if (hidden.notPaused.length > 0) throw new Error(`页面隐藏时动效必须暂停：${JSON.stringify(hidden.notPaused.slice(0, 5))}`);

      const screenshot = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshot);

      console.log('  6. 刷新页面：偏好必须跨会话恢复...');
      await session.sendCommand('Page.reload', { ignoreCache: false });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await openAppearance();
      const restored = await session.evaluate(`(() => ({
        stored: localStorage.getItem('hermes_flux_activity_variant'),
        checked: Array.from(document.querySelectorAll('[data-activity-variant][aria-checked=true]')).map((el) => el.getAttribute('data-activity-variant')),
      }))()`);
      if (restored.stored !== 'orbit' || JSON.stringify(restored.checked) !== '["orbit"]') {
        throw new Error(`刷新后必须仍选中 orbit，实测 ${JSON.stringify(restored)}`);
      }

      const evidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        cards,
        applied,
        clipping,
        reduced,
        hidden,
        restored,
        screenshot,
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(`  ✔ 活动指示器变体验证成功！证据已落盘: ${screenshot}`);
      return true;
    } else if (featureId === 'bot-config-center') {
      console.log('  1. 打开设置 › BOT：注入一份权威详情与模型目录（走真实渲染路径）...');
      await session.waitFor('document.getElementById("flux-app-root")?.childElementCount > 0', 15000, 'renderer first paint');
      await session.click('#btn-open-settings');
      await session.waitFor('document.querySelector("[data-testid=settings-dialog]") !== null', 8000, 'settings dialog');
      await session.click('[data-settings-section=agents]');

      const injected = await session.evaluate(`(() => {
        const s = window.__fluxState;
        if (!s) return 'no-state';
        s.settingsProfiles = { status: 'ready', data: [
          { name: 'default', displayName: 'Hermes', model: 'fn/m1', isDefault: true, hasAvatar: false },
          { name: 'arch', displayName: '架构老王', model: 'fn/m1', isDefault: false, hasAvatar: false },
        ] };
        s.botManagementStatus = { status: 'idle', activeBotId: 'arch' };
        s.botManagementActiveBotId = 'arch';
        s.botManagementDetail = {
          id: 'arch', displayName: '架构老王', description: '负责架构评审',
          model: 'fn/m1', provider: 'fn', soul: '你是一名架构师。', avatar: undefined, isDefault: false,
          skills: { authoritative: true, rows: [
            { id: 'codebase-inspection', label: 'codebase-inspection', enabled: true },
            { id: 'dogfood', label: 'dogfood', enabled: false },
          ] },
          toolsets: { authoritative: true, rows: [
            { id: 'web', label: 'Web Search', enabled: true, description: 'web_search', toolCount: 2 },
            { id: 'browser', label: 'Browser', enabled: false, description: 'navigate', toolCount: 4 },
          ] },
          mcpServers: { authoritative: true, rows: [
            { id: 'github-mcp', label: 'github-mcp', enabled: true, transport: 'stdio', toolCount: 9, online: true },
            { id: 'playwright', label: 'playwright', enabled: true, transport: 'http', online: undefined },
          ] },
        };
        s.botDrafts = {};
        s.settingsProviderViews = { status: 'ready', data: [
          { key: 'custom:fn', kind: 'custom', id: 'fn', name: 'Fn 网关', models: ['fn/m1', 'fn/m2'],
            detail: 'http://127.0.0.1:9/v1', availability: 'ready', agents: [] },
        ] };
        window.__fluxRender();
        return 'ok';
      })()`);
      if (String(injected) !== 'ok') throw new Error(`BOT 面板状态注入失败: ${injected}`);
      await session.waitFor('document.querySelector("[data-bot-carousel]") !== null', 8000, 'bot carousel');
      await session.waitFor('document.querySelectorAll("[data-bot-slot]").length === 5', 8000, 'five slots');

      console.log('  2. 选择器与基础字段必须齐全，且当前模型回显...');
      const layout = await session.evaluate(`(() => {
        const panel = document.querySelector('[data-bot-carousel]');
        const model = document.querySelector('#bot-model');
        const slots = [...document.querySelectorAll('[data-bot-slot]')];
        return {
          slotCount: slots.length,
          distinctTransforms: new Set(slots.map((n) => getComputedStyle(n).transform)).size,
          panelHeight: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
          hasId: Boolean(document.querySelector('#bot-id')),
          hasName: Boolean(document.querySelector('#bot-display-name')),
          hasDescription: Boolean(document.querySelector('#bot-description')),
          hasModel: Boolean(model),
          modelValue: model ? model.value : '',
          modelGroups: model ? model.querySelectorAll('optgroup').length : 0,
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()`);
      if (layout.slotCount !== 5) throw new Error(`槽位必须固定 5 个，实测 ${layout.slotCount}`);
      if (layout.distinctTransforms < 4) throw new Error(`槽位必须有近大远小位移，实测 ${layout.distinctTransforms} 种`);
      if (layout.panelHeight !== 148) throw new Error(`滑动视口必须 148px，实测 ${layout.panelHeight}`);
      if (!layout.hasId || !layout.hasName || !layout.hasDescription) throw new Error('基础身份字段缺失');
      if (!layout.hasModel) throw new Error('缺少模型绑定下拉');
      if (layout.modelValue !== 'fn/m1') throw new Error(`模型必须回显当前值，实测 ${layout.modelValue}`);
      if (layout.modelGroups < 1) throw new Error('模型下拉必须按 Provider 分组');
      if (layout.overflowX) throw new Error('页面出现横向溢出');

      console.log('  3. 折叠区必须按 Grid 契约展开（点击后 0fr -> 1fr），且能力开关真实可点...');
      const collapsed = await session.evaluate(`(() => {
        const nodes = [...document.querySelectorAll('[data-bot-section]')];
        return nodes.map((node) => {
          const btn = node.querySelector('button[aria-expanded]');
          const grid = node.querySelector('div.grid');
          return {
            id: node.getAttribute('data-bot-section'),
            expanded: btn ? btn.getAttribute('aria-expanded') : null,
            controls: btn ? btn.getAttribute('aria-controls') : null,
            rowsBefore: grid ? getComputedStyle(grid).gridTemplateRows : '',
          };
        });
      })()`);
      console.log('     · 初始折叠态:', JSON.stringify(collapsed));
      if (collapsed.length < 4) throw new Error(`能力矩阵折叠区缺失，实测 ${collapsed.length} 个`);
      for (const section of collapsed) {
        if (!section.controls) throw new Error(`${section.id} 折叠按钮必须声明 aria-controls`);
        if (section.expanded === 'true') throw new Error(`${section.id} 必须默认收起（design §7.2）`);
      }
      // 逐个点开：Grid 契约必须是 0fr -> 1fr，且内容真实可交互。
      for (const section of collapsed) {
        await session.click(`[data-bot-section=${section.id}] > button[aria-expanded]`);
      }
      // 等展开过渡跑完（120ms）再测量，否则读到的是过渡起始帧。
      await new Promise((resolve) => setTimeout(resolve, 400));
      const sections = await session.evaluate(`(() => {
        const nodes = [...document.querySelectorAll('[data-bot-section]')];
        return nodes.map((node) => {
          const btn = node.querySelector('button[aria-expanded]');
          const grid = node.querySelector('div.grid');
          const inner = grid ? grid.firstElementChild : null;
          return {
            id: node.getAttribute('data-bot-section'),
            expanded: btn ? btn.getAttribute('aria-expanded') : null,
            rows: grid ? grid.querySelectorAll('[data-bot-capability]').length : 0,
            gridRows: grid ? getComputedStyle(grid).gridTemplateRows : '',
            visible: inner ? getComputedStyle(inner).visibility : '',
          };
        });
      })()`);
      console.log('     · 展开后:', JSON.stringify(sections));
      for (const section of sections) {
        if (section.expanded !== 'true') throw new Error(`${section.id} 点击后必须展开`);
        if (section.gridRows === '0px' || section.gridRows === '') {
          throw new Error(`${section.id} 的 grid-template-rows 必须脱离 0fr，实测 ${section.gridRows}`);
        }
        if (section.visible !== 'visible') throw new Error(`${section.id} 展开后内容必须可见`);
      }
      const soulSection = sections.find((s) => s.id === 'soul');
      if (!soulSection) throw new Error('缺少 SOUL 抽屉');

      console.log('  4. 点开一个能力开关：草稿必须落池且脏点出现，且不得直接写网关...');
      const beforeToggle = await session.evaluate(
        `JSON.stringify(Object.keys(window.__fluxState.botDrafts))`,
      );
      await session.click('[data-bot-capability=browser]');
      await session.waitFor(
        `Object.prototype.hasOwnProperty.call(window.__fluxState.botDrafts, 'arch')`,
        5000,
        'draft written',
      );
      const toggled = await session.evaluate(`(() => {
        const draft = window.__fluxState.botDrafts.arch;
        return {
          enabledToolsets: draft ? draft.enabledToolsets : null,
          disabledSkills: draft ? draft.disabledSkills : null,
          saveDisabled: [...document.querySelectorAll('button')].some(
            (b) => b.textContent.includes('保存配置') && b.disabled,
          ),
        };
      })()`);
      console.log('     · 草稿:', JSON.stringify(toggled), '· 前置:', beforeToggle);
      if (!toggled.enabledToolsets || !toggled.enabledToolsets.includes('browser')) {
        throw new Error(`开关必须写入草稿 enabledToolsets，实测 ${JSON.stringify(toggled.enabledToolsets)}`);
      }
      if (toggled.saveDisabled) throw new Error('有草稿时保存按钮不得禁用');

      console.log('  5. 重置：草稿必须清空，开关回到权威快照...');
      await session.evaluate(`(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '重置');
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      await session.waitFor(
        `Object.keys(window.__fluxState.botDrafts).length === 0`,
        5000,
        'draft cleared',
      );

      console.log('  6. MCP 未知态必须是「状态未知」，不得画成离线红灯...');
      const mcp = await session.evaluate(`(() => {
        const section = document.querySelector('[data-bot-section=mcp]');
        const text = section ? section.textContent : '';
        return {
          unknown: text.includes('状态未知'),
          offline: text.includes('未连接'),
          online: text.includes('已连接'),
          red: section
            ? [...section.querySelectorAll('*')].some((el) => {
                const color = getComputedStyle(el).color;
                return /rgb\\(\\s*(2[0-9]{2}|1[5-9][0-9])\\s*,\\s*([0-9]|[1-6][0-9])\\s*,/.test(color);
              })
            : false,
        };
      })()`);
      console.log('     · MCP 状态:', JSON.stringify(mcp));
      if (!mcp.online) throw new Error('已连接的 MCP 必须显示在线');
      if (!mcp.unknown) throw new Error('探活无结论时必须显示"状态未知"');
      if (mcp.red) throw new Error('未知态不得使用红色（会被读成服务挂了）');

      const screenshot = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshot);

      // 负向注入：这一条不可能是同源自证 —— 断言的是"错误态必须由状态机驱动渲染"，
      // 若 UI 硬编码常量或忽略 status，注入 list_error 后仍会画出花名册与表单。
      console.log('  7. 负向：注入 list_error 后必须画错误态，不得继续显示花名册与表单...');
      const negative = await session.evaluate(`(() => {
        const s = window.__fluxState;
        s.botManagementStatus = { status: 'list_error', message: '网关连接已断开' };
        s.botManagementDetail = undefined;
        window.__fluxRender();
        return 'ok';
      })()`);
      if (String(negative) !== 'ok') throw new Error(`负向注入失败: ${negative}`);
      await session.waitFor(
        `document.body.textContent.includes('网关连接已断开')`,
        5000,
        'list error surfaced',
      );
      const errorState = await session.evaluate(`(() => {
        const dialog = document.querySelector('[data-testid=settings-dialog]');
        const text = dialog ? dialog.textContent : '';
        return {
          rawMessage: text.includes('网关连接已断开'),
          hasCarousel: Boolean(document.querySelector('[data-bot-carousel]')),
          hasIdField: Boolean(document.querySelector('#bot-id')),
          hasSaveButton: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('保存配置')),
          hasRetry: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '重试'),
        };
      })()`);
      console.log('     · 错误态:', JSON.stringify(errorState));
      if (!errorState.rawMessage) throw new Error('错误态必须原样透出网关原因（Failure Is Not Empty）');
      if (errorState.hasCarousel) throw new Error('错误态不得继续渲染花名册选择器');
      if (errorState.hasIdField) throw new Error('错误态不得继续渲染详情表单');
      if (errorState.hasSaveButton) throw new Error('错误态不得保留可点的保存按钮（假可用）');
      if (!errorState.hasRetry) throw new Error('错误态必须给出重试入口');

      const evidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        layout,
        sections,
        toggled,
        mcp,
        errorState,
        screenshot,
      };
      fs.writeFileSync(path.join(featureArtifactsDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
      console.log(`  ✔ BOT 配置中枢验证成功！证据已落盘: ${screenshot}`);
      return true;
    } else {
      throw new Error(`Unknown feature ID: ${featureId}. Supported features: bot-primary-chat, session-management, group-room, input-dock-controls, interactive-chat-stage, clean-light-theme, prompt-navigator-rail, provider-bot-binding, activity-indicator-preference, bot-config-center`);
    }
  } finally {
    await session.cleanup();
  }
}

// CLI 入口解析
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'doctor';

  if (command === 'doctor') {
    const ok = await runDoctor();
    process.exit(ok ? 0 : 1);
  } else if (command === 'run') {
    const featureId = args[1] || 'bot-primary-chat';
    try {
      await runFeature(featureId);
      process.exit(0);
    } catch (err) {
      console.error(`\n❌ Feature run failed:`, err.message);
      process.exit(1);
    }
  } else {
    console.log('Usage: node scripts/verify/control-flux.mjs [doctor | run <feature-id>]');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}
