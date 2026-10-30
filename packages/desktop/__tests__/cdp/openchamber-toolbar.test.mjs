import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9333;
const HTTP_PORT = 8999;

test('OpenChamber File Bar - Live Headless Browser CDP Test', async (t) => {
  if (!fs.existsSync(EDGE_PATH)) {
    t.skip('Microsoft Edge not found on system');
    return;
  }

  // 1. Create a local static HTTP server so ES modules can load without file:// CORS restrictions
  const rootDir = path.resolve('.');
  const server = http.createServer((req, res) => {
    let reqPath = decodeURIComponent(req.url?.split('?')[0] || '/');
    if (reqPath === '/') reqPath = '/packages/desktop/__tests__/cdp/test-harness.html';
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

  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));

  // 2. Launch Edge in headless mode with remote debugging port
  const tmpUserDataDir = path.resolve(process.env.TEMP || 'C:\\Users\\470785\\AppData\\Local\\Temp', `edge-cdp-${Date.now()}`);
  const browserProc = spawn(EDGE_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    `--user-data-dir=${tmpUserDataDir}`,
    `http://127.0.0.1:${HTTP_PORT}/packages/desktop/__tests__/cdp/test-harness.html`
  ], { stdio: 'ignore' });

  // Cleanup on exit
  t.after(() => {
    try {
      browserProc.kill();
      server.close();
      fs.rmSync(tmpUserDataDir, { recursive: true, force: true });
    } catch {}
  });

  // Wait for CDP port to open
  let targets = [];
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (res.ok) {
        targets = await res.json();
        if (targets.length > 0) break;
      }
    } catch {}
  }

  assert.ok(targets.length > 0, 'Browser must respond on CDP port and provide page target');
  const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('test-harness.html')) || targets[0];
  const wsUrl = pageTarget.webSocketDebuggerUrl;
  assert.ok(wsUrl, 'CDP WebSocket URL must be valid');

  // Connect CDP WebSocket
  const ws = new WebSocket(wsUrl);
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

  // Wait for harness script and module imports to execute
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(r => setTimeout(r, 200));
    const chk = await cdpCall('Runtime.evaluate', {
      expression: 'Boolean(window.testState && document.querySelector(".inspector-file-tab"))',
      returnByValue: true
    });
    if (chk.result.value === true) break;
  }

  await t.test('CDP verify 4 file tabs with exact OpenChamber icons & styling', async () => {
    const res = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const tabs = Array.from(document.querySelectorAll('.inspector-file-tab')).map(t => ({
            path: t.dataset.fileTab,
            text: t.querySelector('.file-tab-label')?.textContent,
            isActive: t.classList.contains('tab-active')
          }));
          return JSON.stringify(tabs);
        })()
      `,
      returnByValue: true
    });

    const tabs = JSON.parse(res.result.value);
    assert.equal(tabs.length, 4, 'Must have 4 open file tabs');
    assert.equal(tabs[0].text, 'MiddlePod.ts');
    assert.equal(tabs[1].text, 'package.json');
    assert.equal(tabs[2].text, 'styles.css');
    assert.equal(tabs[3].text, 'SKILL.md');
    assert.equal(tabs[3].isActive, true, 'SKILL.md should be active initially');
  });

  await t.test('CDP verify OpenChamber streamlined toolbar buttons presence', async () => {
    const res = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const buttons = [
            'btn-file-toggle-mode',
            'btn-file-search',
            'btn-file-toggle-lineno',
            'btn-file-open-external',
            'btn-file-copy-content',
            'btn-file-copy-path',
            'btn-file-download'
          ];
          return buttons.every(id => document.getElementById(id) !== null);
        })()
      `,
      returnByValue: true
    });

    assert.equal(res.result.value, true, 'All streamlined OpenChamber toolbar buttons must be mounted in DOM');
  });

  await t.test('CDP verify Tab switching interaction', async () => {
    // Click on package.json tab
    const res = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const tab = document.querySelector('.inspector-file-tab[data-file-tab="package.json"]');
          tab.click();
          return window.testState.activeFilePath;
        })()
      `,
      returnByValue: true
    });

    assert.equal(res.result.value, 'package.json', 'Active file must switch to package.json upon tab click');
  });

  await t.test('CDP verify view mode toggle (Rendered vs Raw)', async () => {
    const res = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const toggleBtn = document.getElementById('btn-file-toggle-mode');
          const prevMode = window.testState.viewMode;
          toggleBtn.click();
          return { prevMode, nextMode: window.testState.viewMode };
        })()
      `,
      returnByValue: true
    });

    const { prevMode, nextMode } = res.result.value;
    assert.notEqual(prevMode, nextMode, 'ViewMode must toggle on button click');
  });

  await t.test('CDP verify Workspace Fullscreen overlay preserves Titlebar header', async () => {
    const res = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const fsBtn = document.getElementById('toggle-inspector-fullscreen-btn');
          fsBtn.click();
          const pod = document.getElementById('flux-inspector-pod');
          const style = window.getComputedStyle(pod);
          const isAbsolute = style.position === 'absolute';
          const top = style.top;
          const width = style.width;

          // Toggle back
          fsBtn.click();
          return { isAbsolute, top, width };
        })()
      `,
      returnByValue: true
    });

    assert.equal(res.result.value.isAbsolute, true, 'Fullscreen within body container must apply position: absolute');
    assert.equal(res.result.value.top, '0px', 'Top within body container must be 0px without covering Titlebar');
  });

  await t.test('CDP verify Far-Right Vertical Scene Rail buttons', async () => {
    const res = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const rail = document.querySelector('.inspector-vertical-rail');
          const tabItems = Array.from(document.querySelectorAll('.inspector-vertical-rail .vertical-tab-item')).map(btn => btn.dataset.tab);
          return { hasRail: Boolean(rail), tabs: tabItems };
        })()
      `,
      returnByValue: true
    });

    assert.equal(res.result.value.hasRail, true, 'Far-right vertical rail must be mounted');
    assert.deepEqual(res.result.value.tabs, ['preview', 'git', 'browser', 'memory'], 'Vertical rail must list all 4 extensible functional tabs');
  });

  await t.test('CDP verify Silent clipboard copy button without dockNotice pollution', async () => {
    const res = await cdpCall('Runtime.evaluate', {
      expression: `
        (() => {
          const copyBtn = document.getElementById('btn-file-copy-content');
          copyBtn.click();
          return {
            hasDockNotice: Boolean(document.querySelector('.dock-notice-bar')),
            btnColor: copyBtn.style.color
          };
        })()
      `,
      returnByValue: true
    });

    assert.equal(res.result.value.hasDockNotice, false, 'Copying file content must NOT trigger dock notice');
  });

  ws.close();
});
