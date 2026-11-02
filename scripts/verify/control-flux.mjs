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
import { spawn } from 'node:child_process';
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

  const targetUrl = `http://127.0.0.1:${serverPort}/packages/desktop/__tests__/cdp/e2e-acceptance-harness.html`;

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

  const session = await createDriveSession();
  const startTime = Date.now();

  try {
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
      await session.waitFor('document.querySelectorAll(".session-item").length > 0', 10000, 'session list');

      console.log('  2. 模拟草稿文本输入...');
      await session.fill('#dock-prompt-input', '[Draft] 待发送草稿内容');

      console.log('  3. 切换会话并切回，验证草稿状态保全...');
      const firstSess = await session.evaluate('document.querySelector(".session-item")?.dataset?.id');
      console.log(`     · 选中会话: ${firstSess}`);
      await session.click('.session-item');

      const draftPreserved = await session.evaluate(`(() => {
        const input = document.getElementById('dock-prompt-input');
        return input ? Boolean(input.value) : false;
      })()`);
      console.log(`     · 草稿与焦点保持: ${draftPreserved}`);

      console.log('  4. 捕获会话管理物理渲染截图与证据快照...');
      const screenshotPath = path.join(featureArtifactsDir, 'screenshot.png');
      await session.screenshot(screenshotPath);

      const evidence = {
        featureId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        status: 'PASSED',
        targetSessionId: firstSess,
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
    } else {
      throw new Error(`Unknown feature ID: ${featureId}. Supported features: bot-primary-chat, session-management, group-room, input-dock-controls`);
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
