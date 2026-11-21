import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isImageExtension,
  isBinaryExtension,
  hasBinaryNullBytes,
  formatFileSize,
  decodeDataUrlUtf8,
  normalizeHttpBaseUrl,
  buildGatewayDownloadUrl,
  evaluateFilePreviewGuard,
  MAX_PREVIEW_FILE_BYTES,
  MAX_PREVIEW_IMAGE_BYTES,
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

  await t.test('二进制与超大文件守卫、体积格式化、DataURL UTF-8 解码与下载链接构造', async () => {
    const savedWarn = console.warn;
    console.warn = () => {};
    try {
      // 1. 扩展名与空字节检测
      assert.equal(isBinaryExtension(''), false);
      assert.equal(isBinaryExtension('folder/'), false);
      assert.equal(isBinaryExtension('.gitignore'), false);
      assert.equal(isBinaryExtension('/opt/data/workspace/app.exe?dl=1'), true);
      assert.equal(isBinaryExtension('/opt/data/workspace/archive.tar.gz'), true);
      assert.equal(isBinaryExtension('/opt/data/workspace/logo.png'), false);

      assert.equal(hasBinaryNullBytes(''), false);
      assert.equal(hasBinaryNullBytes('plain utf8 text'), false);
      assert.equal(hasBinaryNullBytes('ELF\x00\x01binary'), true);

      // 2. formatFileSize 阶梯
      assert.equal(formatFileSize(undefined), '');
      assert.equal(formatFileSize(-1), '');
      assert.equal(formatFileSize(512), '512 B');
      assert.equal(formatFileSize(2048), '2.0 KB');
      assert.equal(formatFileSize(3 * 1024 * 1024), '3.0 MB');
      assert.equal(formatFileSize(2 * 1024 * 1024 * 1024), '2.00 GB');

      // 3. decodeDataUrlUtf8
      assert.equal(decodeDataUrlUtf8('plain'), null);
      assert.equal(decodeDataUrlUtf8('data:text/plain'), null);
      assert.equal(decodeDataUrlUtf8('data:text/plain,hello%20world'), 'hello world');
      assert.equal(decodeDataUrlUtf8('data:text/plain,%ZZ'), null);
      assert.equal(decodeDataUrlUtf8('data:text/plain;base64,' + Buffer.from('你好 Hermes').toString('base64')), '你好 Hermes');
      assert.equal(decodeDataUrlUtf8('data:text/plain;base64,!!!invalid!!!'), null);

      // 4. normalizeHttpBaseUrl & buildGatewayDownloadUrl
      assert.equal(normalizeHttpBaseUrl(''), '');
      assert.equal(normalizeHttpBaseUrl('ws://127.0.0.1:9119/'), 'http://127.0.0.1:9119');
      assert.equal(normalizeHttpBaseUrl('wss://gw.example.com/'), 'https://gw.example.com');
      assert.equal(normalizeHttpBaseUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080');
      assert.equal(normalizeHttpBaseUrl('gw.example.com'), 'https://gw.example.com');
      assert.equal(buildGatewayDownloadUrl('', '/a.exe'), '');
      assert.equal(
        buildGatewayDownloadUrl('wss://gw.example.com/', '/opt/data/app.exe', 'coder', 's-1'),
        'https://gw.example.com/api/fs/download?path=%2Fopt%2Fdata%2Fapp.exe&profile=coder&session_id=s-1',
      );

      // 5. evaluateFilePreviewGuard（含无 byteSize 的分支）
      assert.deepEqual(evaluateFilePreviewGuard({ filePath: '/ws/tool.exe', isImage: false }), { status: 'binary' });
      assert.deepEqual(evaluateFilePreviewGuard({ filePath: '/ws/big.txt', isImage: false, serverTruncated: true }), { status: 'too_large' });
      assert.equal(
        evaluateFilePreviewGuard({ filePath: '/ws/tool.exe', isImage: false, byteSize: 2048 }).status,
        'binary',
      );
      assert.equal(
        evaluateFilePreviewGuard({ filePath: '/ws/huge.log', isImage: false, byteSize: MAX_PREVIEW_FILE_BYTES + 1 }).status,
        'too_large',
      );
      assert.equal(
        evaluateFilePreviewGuard({ filePath: '/ws/giant.png', isImage: true, byteSize: MAX_PREVIEW_IMAGE_BYTES + 1 }).status,
        'too_large',
      );
      assert.equal(
        evaluateFilePreviewGuard({ filePath: '/ws/ok.png', isImage: true, byteSize: 4096 }).status,
        'ok',
      );

      // 6. resolveFileContent 前置阻断：已知 .exe（含无 knownSize 与 HTTP 链接）与超大文件绝不打网关
      const preHttpExe = await resolveFileContent('https://example.com/setup.exe');
      assert.equal(preHttpExe.isBinary, true);
      assert.equal(preHttpExe.source, 'remote_http');
      assert.equal(preHttpExe.byteSize, undefined);
      let networkHit = false;
      const preBlockedExe = await resolveFileContent('/ws/setup.exe', {
        gatewayUrl: 'https://gw.example.com',
        knownSize: 8192,
        platformBridge: {
          httpProxy: async () => {
            networkHit = true;
            return '';
          },
        },
      });
      assert.equal(networkHit, false);
      assert.equal(preBlockedExe.isBinary, true);
      assert.equal(preBlockedExe.source, 'fallback');
      assert.equal(preBlockedExe.byteSize, 8192);

      const preBlockedLarge = await resolveFileContent('/ws/dump.log', {
        gatewayUrl: 'https://gw.example.com',
        knownSize: MAX_PREVIEW_FILE_BYTES + 100,
        platformBridge: {
          httpProxy: async () => {
            networkHit = true;
            return '';
          },
        },
      });
      assert.equal(networkHit, false);
      assert.equal(preBlockedLarge.isTooLarge, true);

      // 7. 远程网关标准 /api/fs/read-text（正常文本、0 字节空文件、服务端 binary/truncated 标记）
      const okRemote = await resolveFileContent('/opt/data/workspace/SOUL.md', {
        gatewayUrl: 'https://gw.example.com',
        profile: 'default',
        sessionId: 'sess-1',
        platformBridge: {
          httpProxy: async ({ path: ep }) => {
            if (ep.startsWith('/api/fs/read-text?')) {
              return { binary: false, byteSize: 12, text: '# Soul Doc\n', truncated: false };
            }
            return null;
          },
        },
      });
      assert.equal(okRemote.source, 'gateway_api');
      assert.equal(okRemote.content, '# Soul Doc\n');

      const emptyRemote = await resolveFileContent('/opt/data/workspace/empty.txt', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async () => ({ binary: false, byteSize: 0, text: '', truncated: false }),
        },
      });
      assert.equal(emptyRemote.source, 'gateway_api');
      assert.equal(emptyRemote.content, '');

      const elfRemote = await resolveFileContent('/opt/data/workspace/mybin', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async () => ({ binary: true, byteSize: 65536, text: null, truncated: false }),
        },
      });
      assert.equal(elfRemote.isBinary, true);
      assert.equal(elfRemote.byteSize, 65536);

      const truncRemote = await resolveFileContent('/opt/data/workspace/big.log', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async () => ({ binary: false, byteSize: 5_000_000, text: 'head', truncated: true }),
        },
      });
      assert.equal(truncRemote.isTooLarge, true);

      // 8. /api/files/read Data URL 解码 + 体积阻断 + /api/files 目录识别 + 远程图片 Data URL
      const filesReadText = await resolveFileContent('/opt/data/workspace/readme.md', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async ({ path: ep }) => {
            if (ep.startsWith('/api/fs/read-text')) throw new Error('404');
            if (ep.startsWith('/api/files/read')) {
              return {
                size: 11,
                data_url: 'data:text/markdown;base64,' + Buffer.from('# From Read').toString('base64'),
              };
            }
            return null;
          },
        },
      });
      assert.equal(filesReadText.content, '# From Read');

      const filesReadTooLarge = await resolveFileContent('/opt/data/workspace/huge.md', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async ({ path: ep }) => {
            if (ep.startsWith('/api/fs/read-text')) throw new Error('404');
            if (ep.startsWith('/api/files/read')) {
              return { size: MAX_PREVIEW_FILE_BYTES + 1, data_url: 'data:text/plain;base64,QQ==' };
            }
            return null;
          },
        },
      });
      assert.equal(filesReadTooLarge.isTooLarge, true);

      const remoteDir = await resolveFileContent('/opt/data/workspace/memory', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async ({ path: ep }) => {
            if (ep.startsWith('/api/files?')) return { path: '/opt/data/workspace/memory', entries: [] };
            throw new Error('400');
          },
        },
      });
      assert.equal(remoteDir.isDirectory, true);

      const remoteImg = await resolveFileContent('/opt/data/workspace/shot.png', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async ({ path: ep }) => {
            if (ep.startsWith('/api/fs/read-data-url')) return { dataUrl: 'data:image/png;base64,AAAA' };
            return null;
          },
        },
      });
      assert.equal(remoteImg.isImage, true);
      assert.equal(remoteImg.content, 'data:image/png;base64,AAAA');

      const remoteImgFallback = await resolveFileContent('/opt/data/workspace/shot2.jpg', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async ({ path: ep }) => {
            if (ep.startsWith('/api/fs/read-data-url')) throw new Error('404');
            if (ep.startsWith('/api/files/read')) return { data_url: 'data:image/jpeg;base64,BBBB', size: 256 };
            return null;
          },
        },
      });
      assert.equal(remoteImgFallback.content, 'data:image/jpeg;base64,BBBB');

      const remoteImgDownload = await resolveFileContent('/opt/data/workspace/shot3.png', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async ({ path: ep }) => {
            if (ep.startsWith('/api/files/download')) return 'data:image/png;base64,CCCC';
            throw new Error('404');
          },
        },
      });
      assert.equal(remoteImgDownload.content, 'data:image/png;base64,CCCC');

      // 非 data:image/ 的字符串 data URL（如 data:text/html）不得被当作图片渲染
      const remoteHtmlDataRejected = await resolveFileContent('/opt/data/workspace/spoof.png', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async () => 'data:text/html;base64,PGh0bWw+',
        },
      });
      assert.equal(remoteHtmlDataRejected.source, 'fallback');

      // 同时支持对象响应中的 byteSize 字段（兼容 /api/fs/read-data-url 返回 rec.byteSize）
      const remoteImgByteSize = await resolveFileContent('/opt/data/workspace/sized.png', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async () => ({ dataUrl: 'data:image/png;base64,DDDD', byteSize: 512 }),
        },
      });
      assert.equal(remoteImgByteSize.byteSize, 512);

      const remoteImgAllFail = await resolveFileContent('/opt/data/workspace/missing.png', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: { httpProxy: async () => null },
      });
      assert.equal(remoteImgAllFail.source, 'fallback');

      const localNullBin = await resolveFileContent('/ws/elf-bin', {
        platformBridge: { readFile: async () => 'ELF\x00data' },
      });
      assert.equal(localNullBin.isBinary, true);

      const httpLarge = await resolveFileContent('https://example.com/big.txt', {
        platformBridge: { httpProxy: async () => 'x'.repeat(MAX_PREVIEW_FILE_BYTES + 10) },
      });
      assert.equal(httpLarge.isTooLarge, true);

      const fallbackTextEndpoint = await resolveFileContent('/opt/data/workspace/plain.txt', {
        gatewayUrl: 'https://gw.example.com',
        platformBridge: {
          httpProxy: async ({ path: ep }) => {
            if (ep.startsWith('/api/files/download')) return 'downloaded plain body';
            if (ep.startsWith('/api/fs/download')) return { content: 'bad Cannot GET' };
            throw new Error('404');
          },
        },
      });
      assert.equal(fallbackTextEndpoint.content, 'downloaded plain body');
    } finally {
      console.warn = savedWarn;
    }
  });
});
