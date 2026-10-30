import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isImageExtension,
  isSpaFallbackHtml,
  extractFileContentFromSessionTools,
  resolveFileContent,
} from '../../dist/fs/fileService.js';

test('Unified File Service (packages/core/src/fs/fileService.ts)', async (t) => {
  await t.test('isImageExtension detects image formats reliably', () => {
    assert.equal(isImageExtension('/path/to/diagram.png'), true);
    assert.equal(isImageExtension('https://example.com/photo.jpg?w=800'), true);
    assert.equal(isImageExtension('icon.svg#symbol'), true);
    assert.equal(isImageExtension('document.pdf'), false);
    assert.equal(isImageExtension('index.html'), false);
  });

  await t.test('extractFileContentFromSessionTools extracts from write_file toolCalls', () => {
    const messages = [
      {
        toolCalls: [
          {
            name: 'write_file',
            args: JSON.stringify({
              path: '/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-workspace.html',
              content: '<!DOCTYPE html><html><body><h1>Prototype</h1></body></html>',
            }),
          },
        ],
      },
    ];

    const content = extractFileContentFromSessionTools(
      '/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-workspace.html',
      messages
    );
    assert.ok(content?.includes('<h1>Prototype</h1>'));

    // Should also match by basename
    const contentByBaseName = extractFileContentFromSessionTools('desktop-v4-workspace.html', messages);
    assert.ok(contentByBaseName?.includes('<h1>Prototype</h1>'));
  });

  await t.test('resolveFileContent falls back gracefully with explicit source indicator', async () => {
    const result = await resolveFileContent('/remote/path/unknown.ts', {
      messages: [],
      fallbackNotice: 'CUSTOM_FALLBACK',
    });

    assert.equal(result.source, 'fallback');
    assert.equal(result.fromCache, false);
    assert.equal(result.content, 'CUSTOM_FALLBACK');
  });

  await t.test('resolveFileContent prioritizes session tool output before network', async () => {
    let mockPalCalled = false;
    const mockBridge = {
      getSystemInfo: async () => ({
        platform: 'windows',
        arch: 'x64',
        osVersion: '10',
        appVersion: '1.0.0',
        isDesktop: true,
        isMobile: false,
        isWeb: false,
      }),
      minimize: async () => {},
      maximize: async () => {},
      unmaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      onWindowStateChange: () => () => {},
      openExternal: async () => {},
      readFile: async () => {
        mockPalCalled = true;
        return 'DISK_CONTENT';
      },
    };

    const messages = [
      {
        toolCalls: [
          {
            name: 'write',
            args: { path: 'src/main.ts', content: 'SESSION_CONTENT' },
          },
        ],
      },
    ];

    const result = await resolveFileContent('src/main.ts', {
      messages,
      platformBridge: mockBridge,
    });

    assert.equal(result.source, 'session_tool');
    assert.equal(result.fromCache, true);
    assert.equal(result.content, 'SESSION_CONTENT');
    assert.equal(mockPalCalled, false, 'Should extract from session cache without hitting physical disk');
  });

  await t.test('isSpaFallbackHtml detects SPA Dashboard HTML and protects code files', () => {
    const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<title>Hermes Agent - Dashboard</title>
<script>window.__HERMES_DASHBOARD_EMBEDDED_CHAT__=true;</script>
<body><div id="root"></div></body>
</html>`;

    // .py file receiving dashboard html must be rejected
    assert.equal(isSpaFallbackHtml(dashboardHtml, '/opt/hermes/gateway/session_recovery.py'), true);
    assert.equal(isSpaFallbackHtml(dashboardHtml, 'methods_profiles.py'), true);

    // Genuine python code must NOT be flagged as SPA html
    const pythonCode = `import os\n\ndef recover_session(session_id: str):\n    return True\n`;
    assert.equal(isSpaFallbackHtml(pythonCode, 'session_recovery.py'), false);

    // Regular clean HTML prototype must NOT be rejected unless it is the dashboard itself
    const cleanHtml = `<!DOCTYPE html><html><body><h1>Prototype</h1></body></html>`;
    assert.equal(isSpaFallbackHtml(cleanHtml, 'prototype.html'), false);
  });

  await t.test('resolveFileContent strictly discards SPA fallback and isolates different python files', async () => {
    const dashboardHtml = `<!doctype html><html><head><title>Hermes Agent - Dashboard</title></head><body><div id="root"></div></body></html>`;

    // Simulate gateway returning SPA dashboard html for 404 endpoints
    const mockBridge = {
      httpProxy: async () => dashboardHtml,
    };

    const messages = [
      {
        toolCalls: [
          {
            name: 'read_file',
            args: { path: '/opt/hermes/gateway/methods_profiles.py' },
            output: 'class ProfileMethods:\n    def list_profiles(self):\n        return []',
          },
          {
            name: 'read_file',
            args: { path: '/opt/hermes/gateway/session_recovery.py', offset: 308, limit: 50 },
            output: '308: def perform_recovery():\n309:     print("recovering")\n',
          },
        ],
      },
    ];

    // 1. Requesting methods_profiles.py should return python code, NOT dashboard html
    const resProfiles = await resolveFileContent('/opt/hermes/gateway/methods_profiles.py', {
      messages,
      platformBridge: mockBridge,
    });
    assert.notEqual(resProfiles.content, dashboardHtml, 'Must not return SPA dashboard html');
    assert.ok(resProfiles.content.includes('class ProfileMethods'), 'Must return methods_profiles code');

    // 2. Requesting session_recovery.py should return session_recovery slice, NOT dashboard html and NOT methods_profiles code
    const resRecovery = await resolveFileContent('/opt/hermes/gateway/session_recovery.py', {
      messages,
      platformBridge: mockBridge,
    });
    assert.notEqual(resRecovery.content, dashboardHtml, 'Must not return SPA dashboard html');
    assert.ok(resRecovery.content.includes('def perform_recovery'), 'Must return session_recovery code');
    assert.ok(!resRecovery.content.includes('class ProfileMethods'), 'Must not leak another file code');
  });

  await t.test('extractFileContentFromSessionTools stitches multiple read slices into a unified file view', () => {
    // 模拟真实场景：文件有 300+ 行，智能体先后分两次读取了前 50 行和第 200~210 行
    const messages = [
      {
        toolCalls: [
          {
            name: 'read_file',
            args: { path: '/opt/hermes/gateway/session_recovery.py', offset: 1, limit: 50 },
            output: ' 1: import os\n 2: import sys\n 3: def initialize_recovery():\n 4:     pass\n',
          },
          {
            name: 'read_file',
            args: { path: '/opt/hermes/gateway/session_recovery.py', offset: 200, limit: 20 },
            output: '200: def perform_recovery(session_id: str):\n201:     return True\n',
          },
        ],
      },
    ];

    const stitched = extractFileContentFromSessionTools(
      '/opt/hermes/gateway/session_recovery.py',
      messages
    );

    assert.ok(stitched, 'Must stitch multiple slices together');
    // 必须保留第 1 行与开头代码，绝不能因为后面读了 200 行而丢失前 50 行！
    assert.ok(stitched.includes('import os'), 'Must preserve line 1 from first slice');
    assert.ok(stitched.includes('def initialize_recovery'), 'Must preserve early functions');
    // 同时也必须包含后置切片内容
    assert.ok(stitched.includes('def perform_recovery'), 'Must preserve line 200 from second slice');
    // 代码本身必须 100% 纯净，严禁注入虚假的中文伪代码占位符
    assert.ok(!stitched.includes('会话工具切片读取'), 'Must NOT inject fake placeholder comments into source code');
  });

  await t.test('extractFileContentFromSessionTools prioritizes full write over late read slices', () => {
    // 如果工具先全量写入了 300 行文件，后面虽有局部切片读取，也绝不能被切片覆盖
    const fullContent = 'import time\n\n' + Array.from({ length: 300 }, (_, i) => `def func_${i}(): pass`).join('\n');
    const messages = [
      {
        toolCalls: [
          {
            name: 'write_file',
            args: { path: 'full_module.py', content: fullContent },
          },
          {
            name: 'read_file',
            args: { path: 'full_module.py', offset: 200 },
            output: '200: def func_200(): pass\n201: def func_201(): pass\n',
          },
        ],
      },
    ];

    const extracted = extractFileContentFromSessionTools('full_module.py', messages);
    assert.equal(extracted, fullContent, 'Full write must take absolute priority over late slice');
    assert.ok(extracted.includes('func_0'), 'Must contain func_0 (line 1 area)');
  });

  await t.test('extractFileContentFromSessionTools preserves clean code without injecting fake notice comments', () => {
    // 场景：会话中只有第 200~210 行切片，输出格式保留真实行号，绝不强行注入伪代码注释行
    const messages = [
      {
        toolCalls: [
          {
            name: 'read_file',
            args: { path: 'late_only.py', offset: 200 },
            output: '200: def late_action():\n201:     return 42\n',
          },
        ],
      },
    ];

    const extracted = extractFileContentFromSessionTools('late_only.py', messages);
    assert.ok(extracted, 'Must extract slice');
    assert.ok(extracted.includes('200: def late_action'), 'Must preserve clean code with original line number');
    assert.ok(!extracted.includes('会话工具切片读取'), 'Must never inject fake notice comments into code');
  });
});
