/**
 * 桌面端安全目录读取（workspaceFs.ts）及 Main IPC / Preload 通道单元测试
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import {
  isSafeWorkspaceDirectory,
  listWorkspaceDirectory,
  resolveSafeLocalSourceFile,
} from '../../dist/main/workspaceFs.mjs';

test('workspaceFs: 安全边界校验拒绝空字节、父目录逃逸与系统敏感根', () => {
  const cwd = process.cwd();
  assert.equal(isSafeWorkspaceDirectory(undefined, cwd), path.resolve(cwd));
  assert.equal(isSafeWorkspaceDirectory('', ''), path.resolve(cwd));
  assert.equal(isSafeWorkspaceDirectory('foo\0bar', cwd), null);
  assert.equal(isSafeWorkspaceDirectory('../b/sub', path.join(cwd, 'a', 'b')), path.join(cwd, 'a', 'b', 'sub'));
  assert.equal(isSafeWorkspaceDirectory('../../outside', path.join(cwd, 'a', 'b')), null);
  assert.equal(isSafeWorkspaceDirectory('../../../outside', cwd), null);
  assert.equal(isSafeWorkspaceDirectory('System32/..', 'C:\\Windows'), null);
  assert.equal(isSafeWorkspaceDirectory('/', cwd), null);
  assert.equal(isSafeWorkspaceDirectory('/etc', cwd), null);
  assert.equal(isSafeWorkspaceDirectory('/etc/passwd', cwd), null);
  assert.equal(isSafeWorkspaceDirectory('C:\\Windows', cwd), null);
  assert.equal(isSafeWorkspaceDirectory('C:\\Windows\\System32', cwd), null);
  assert.equal(isSafeWorkspaceDirectory('', 'C:\\'), null);
  assert.equal(isSafeWorkspaceDirectory('sub/dir', '/ws'), path.resolve('/ws', 'sub/dir'));
});

test('workspaceFs: 真实临时目录单层读取、忽略 .git、排序与异常输入防护', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-ws-test-'));
  const subDir = path.join(tmpDir, 'src');
  const gitDir = path.join(tmpDir, '.git');
  const fileA = path.join(tmpDir, 'a.ts');
  const fileZ = path.join(tmpDir, 'z.md');
  const deepFile = path.join(subDir, 'nested.ts');
  const linkFile = path.join(tmpDir, 'link-a.ts');
  const brokenLink = path.join(tmpDir, 'broken-link');

  fs.mkdirSync(subDir);
  fs.mkdirSync(gitDir);
  fs.writeFileSync(fileA, 'export const a = 1;');
  fs.writeFileSync(fileZ, '# doc');
  fs.writeFileSync(deepFile, 'nested');

  const savedWarn = console.warn;
  console.warn = () => {};

  try {
    try {
      fs.symlinkSync(fileA, linkFile);
      fs.symlinkSync(path.join(tmpDir, 'does-not-exist'), brokenLink);
    } catch {
      // Windows 无开发者权限时跳过 symlink，不影响核心用例
    }

    const rootEntries = listWorkspaceDirectory('', { cwd: tmpDir });
    assert.ok(Array.isArray(rootEntries));
    assert.equal(rootEntries.some((e) => e.name === '.git'), false, '.git 元数据目录必须过滤');
    assert.equal(rootEntries[0].name, 'src');
    assert.equal(rootEntries[0].isDirectory, true);
    assert.ok(rootEntries.some((e) => e.name === 'a.ts' && e.size === 19));
    assert.equal(rootEntries.some((e) => e.name === 'nested.ts'), false, '单层读取严禁递归深层文件');

    const subEntries = listWorkspaceDirectory(subDir, { cwd: tmpDir });
    assert.equal(subEntries?.length, 1);
    assert.equal(subEntries?.[0].name, 'nested.ts');

    assert.equal(listWorkspaceDirectory(path.join(tmpDir, 'missing'), { cwd: tmpDir }), null);
    assert.equal(listWorkspaceDirectory(fileA, { cwd: tmpDir }), null, '传文件路径应返回 null');
    assert.equal(listWorkspaceDirectory('\0', { cwd: tmpDir }), null);
    assert.equal(listWorkspaceDirectory('', { cwd: 'C:\\' }), null);
    assert.ok(Array.isArray(listWorkspaceDirectory()));
  } finally {
    console.warn = savedWarn;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('workspaceFs: 符号链接、stat 失败与 readdir 异常降级全分支覆盖', () => {
  const origExists = fs.existsSync;
  const origStat = fs.statSync;
  const origReaddir = fs.readdirSync;
  const savedWarn = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a);

  const fakeRoot = path.join(os.tmpdir(), 'flux-mock-ws');
  try {
    fs.existsSync = (p) => (String(p) === path.resolve(fakeRoot) ? true : origExists(p));
    fs.statSync = (p) => {
      const s = String(p);
      if (s === path.resolve(fakeRoot) || s.endsWith('sym-dir')) {
        return { isDirectory: () => true, size: 0 };
      }
      if (s.endsWith('sym-file')) {
        return { isDirectory: () => false, size: 77 };
      }
      if (s.endsWith('sym-broken') || s.endsWith('unreadable.ts')) {
        throw new Error('EPERM');
      }
      return origStat(p);
    };

    let mode = 'entries';
    fs.readdirSync = (p, opts) => {
      if (String(p) !== path.resolve(fakeRoot)) return origReaddir(p, opts);
      if (mode === 'throw') throw new Error('EACCES');
      return [
        { name: 'sym-dir', isDirectory: () => false, isSymbolicLink: () => true },
        { name: 'sym-file', isDirectory: () => false, isSymbolicLink: () => true },
        { name: 'sym-broken', isDirectory: () => false, isSymbolicLink: () => true },
        { name: 'unreadable.ts', isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'dup.ts', isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'dup.ts', isDirectory: () => false, isSymbolicLink: () => false },
      ];
    };

    const entries = listWorkspaceDirectory(fakeRoot, { cwd: os.tmpdir() });
    assert.ok(Array.isArray(entries));
    assert.equal(entries.some((e) => e.name === 'sym-dir' && e.isDirectory === true), true);
    assert.equal(entries.some((e) => e.name === 'sym-file' && e.size === 77), true);
    assert.equal(entries.some((e) => e.name === 'sym-broken'), false);
    assert.equal(entries.some((e) => e.name === 'unreadable.ts' && e.size === undefined), true);

    mode = 'throw';
    assert.equal(listWorkspaceDirectory(fakeRoot, { cwd: os.tmpdir() }), null);
    assert.ok(warns.length >= 3);
  } finally {
    fs.existsSync = origExists;
    fs.statSync = origStat;
    fs.readdirSync = origReaddir;
    console.warn = savedWarn;
  }
});

test('Main IPC fs:list-directory 与 Preload listDirectory 真实链路覆盖', async () => {
  const req = createRequire(import.meta.url);
  const origLoad = Module._load;

  const registeredHandlers = new Map();
  const invokedCalls = [];
  let exposedBridge = null;

  const electronMock = {
    ipcMain: {
      on() {},
      handle(channel, fn) {
        registeredHandlers.set(channel, fn);
      },
    },
    BrowserWindow: class {},
    shell: { openExternal: async () => {}, openPath: async () => '' },
    dialog: { showOpenDialog: async () => ({ filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
    app: { getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
    clipboard: { writeText() {}, readText: () => '' },
    contextBridge: {
      exposeInMainWorld(_name, bridge) {
        exposedBridge = bridge;
      },
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        invokedCalls.push([channel, args]);
        return Promise.resolve(registeredHandlers.get(channel)?.({}, ...args) ?? null);
      },
      on() {},
      removeListener() {},
      send() {},
    },
  };

  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return origLoad.apply(this, arguments);
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-ipc-test-'));
  fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'ok');

  try {
    const ipcMod = req('../../dist/main/ipc.cjs');
    const mockWin = { isDestroyed: () => false, isFullScreen: () => false, isMaximized: () => false };
    ipcMod.registerIpcHandlers(mockWin);

    assert.equal(registeredHandlers.has('fs:list-directory'), true);
    assert.equal(registeredHandlers.has('fs:save-file'), true);

    delete req.cache[req.resolve('../../dist/preload/index.js')];
    req('../../dist/preload/index.js');
    assert.ok(exposedBridge && typeof exposedBridge.listDirectory === 'function');

    const entries = await exposedBridge.listDirectory(tmpDir);
    assert.ok(Array.isArray(entries));
    assert.equal(entries[0].name, 'hello.txt');
    assert.deepEqual(invokedCalls[0], ['fs:list-directory', [tmpDir]]);

    // 2. fs:save-file 完整覆盖：无 Cookie 远程失败 / 有 Cookie 回退 /api/files/download 写入二进制 / 本地 sourcePath 直拷
    const savedOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-ipc-save-'));
    const origFetch = globalThis.fetch;
    const origWarn = console.warn;
    console.warn = () => {};
    let currentSaveTarget = path.join(savedOutDir, 'out.bin');
    electronMock.dialog.showSaveDialog = async () => ({ canceled: false, filePath: currentSaveTarget });

    try {
      const fetchLog = [];
      let authMode = 'ok';
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('[::1')) throw new TypeError('Invalid URL');
        fetchLog.push({ url: u, headers: init?.headers || {} });
        if (u.endsWith('/api/status')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ auth_required: authMode !== 'noauth', version: '0.22.5' }),
          };
        }
        if (u.endsWith('/auth/password-login')) {
          if (authMode === '401') return { ok: false, status: 401, json: async () => ({}) };
          if (authMode === '500') return { ok: false, status: 500, json: async () => ({}) };
          return {
            ok: true,
            status: 200,
            headers: {
              getSetCookie: () =>
                authMode === 'nocookie' ? [] : ['sid=ipc-cookie; Path=/; HttpOnly'],
            },
            json: async () => ({ ok: true }),
          };
        }
        if (u.endsWith('/api/auth/ws-ticket')) {
          return { ok: true, status: 200, json: async () => ({ ticket: 'ipc-tkt' }) };
        }
        if (u.endsWith('/api/img.png')) {
          return {
            ok: true,
            status: 200,
            headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) },
            arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
          };
        }
        if (u.endsWith('/api/octet-img.png')) {
          return {
            ok: true,
            status: 200,
            headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/octet-stream' : null) },
            arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
          };
        }
        if (u.endsWith('/api/plain.txt')) {
          return {
            ok: true,
            status: 200,
            headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/plain' : null) },
            text: async () => 'plain text',
          };
        }
        if (u.endsWith('/api/spa-fallback.png')) {
          return {
            ok: true,
            status: 200,
            headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
            text: async () => '<html>SPA</html>',
          };
        }
        if (u.includes('/api/fs/download')) {
          return {
            ok: false,
            status: 404,
            body: { cancel: async () => {} },
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        }
        if (u.includes('/api/files/download?')) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => new Uint8Array([0x4d, 0x5a, 0x90, 0x00]).buffer,
          };
        }
        return { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) };
      };

      // 无 activeGatewayCookies 且服务端 500 -> 返回显式失败
      const failSave = await exposedBridge.saveFile({
        fileName: 'fail.bin',
        content: 'https://gw.example.com/custom.bin',
      });
      assert.equal(failSave.success, false);
      assert.match(failSave.error || '', /HTTP 500/);

      // 验证 gateway:authenticate 各失败/无认证分支会清理 Cookie 与 Origin 状态
      authMode = '401';
      const auth401 = await exposedBridge.authenticateGateway({ url: 'http://127.0.0.1:9999', username: 'u', password: 'p' });
      assert.equal(auth401.ok, false);
      authMode = '500';
      const auth500 = await exposedBridge.authenticateGateway({ url: 'http://127.0.0.1:9999', username: 'u', password: 'p' });
      assert.equal(auth500.ok, false);
      authMode = 'nocookie';
      await exposedBridge.authenticateGateway({ url: 'http://127.0.0.1:9999', username: 'u', password: 'p' });
      authMode = 'noauth';
      const noAuthRes = await exposedBridge.authenticateGateway({ url: 'http://127.0.0.1:9999' });
      assert.equal(noAuthRes.ok, true);
      authMode = 'ok';

      // 先登录写入 activeGatewayCookies，再验证同 Origin/跨 Origin 的 Cookie 隔离与图片防误判
      await exposedBridge.authenticateGateway({
        url: 'http://127.0.0.1:9999',
        username: 'u',
        password: 'p',
      });
      const sameOriginImg = await exposedBridge.httpProxy({
        baseUrl: 'http://127.0.0.1:9999',
        path: '/api/img.png',
        method: 'GET',
      });
      assert.match(sameOriginImg, /^data:image\/png;base64,/);
      assert.equal(fetchLog.at(-1).headers.Cookie, 'sid=ipc-cookie');

      const octetExtImg = await exposedBridge.httpProxy({
        baseUrl: 'http://127.0.0.1:9999',
        path: '/api/octet-img.png',
        method: 'GET',
      });
      assert.match(octetExtImg, /^data:application\/octet-stream;base64,|^data:image\/png;base64,/);

      const plainRes = await exposedBridge.httpProxy({
        baseUrl: 'http://127.0.0.1:9999',
        path: '/api/plain.txt',
        method: 'GET',
      });
      assert.equal(plainRes, 'plain text');

      const crossOriginHtml = await exposedBridge.httpProxy({
        baseUrl: 'https://thirdparty.example.com',
        path: '/api/spa-fallback.png',
        method: 'GET',
      });
      assert.equal(crossOriginHtml, '<html>SPA</html>');
      assert.equal(fetchLog.at(-1).headers.Cookie, undefined, '跨 Origin 请求严禁携带主网关 Cookie');

      currentSaveTarget = path.join(savedOutDir, 'tool.exe');
      const gwSave = await exposedBridge.saveFile({
        fileName: 'tool.exe',
        content: '',
        remoteUrl: 'http://127.0.0.1:9999/api/fs/download?path=%2Fws%2Ftool.exe&profile=coder',
      });
      assert.equal(gwSave.success, true);
      assert.deepEqual(fs.readFileSync(currentSaveTarget), Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
      const fallbackFetch = fetchLog.at(-1);
      assert.equal(fallbackFetch.headers.Cookie, 'sid=ipc-cookie');
      assert.equal(fallbackFetch.headers.Origin, 'http://127.0.0.1:9999');
      assert.equal(fallbackFetch.url.includes('profile='), false, '回退 /api/files/download 必须剥离额外查询参数');

      // 合法形式但 malformed IPv6 URL 以及非 http(s) scheme 都必须返回非法远程下载地址
      const malformedRemote = await exposedBridge.saveFile({
        fileName: 'bad.bin',
        content: '',
        remoteUrl: 'http://[::1',
      });
      assert.equal(malformedRemote.success, false);
      assert.match(malformedRemote.error || '', /非法远程下载地址/);

      // 无 Origin 的非法 scheme 同样返回非法远程下载地址
      const badRemote = await exposedBridge.saveFile({
        fileName: 'x.bin',
        content: '',
        remoteUrl: 'ftp://invalid-scheme/file.bin',
      });
      assert.equal(badRemote.success, false);

      // 无 query path 的 /api/fs/download 触发 404 回退 /api/files/download?path=，并覆盖 getGatewayOrigin catch 分支
      currentSaveTarget = path.join(savedOutDir, 'nopath.bin');
      const noPathDl = await exposedBridge.saveFile({
        fileName: 'nopath.bin',
        content: '',
        remoteUrl: 'http://127.0.0.1:9999/api/fs/download',
      });
      assert.equal(noPathDl.success, true);
      assert.equal(fetchLog.at(-1).url, 'http://127.0.0.1:9999/api/files/download?path=');

      await assert.rejects(
        () => exposedBridge.httpProxy({ baseUrl: 'http://[::1', path: '/x', method: 'GET' }),
        /Invalid URL/,
      );

      // 本地工作区 sourcePath 安全直拷（含 process.cwd() 内部文件、process.cwd() 外部合法工作区文件、app.temp 含 .. 回退及不可读 0 字节拦截）
      const localSrc = path.join(process.cwd(), 'package.json');
      currentSaveTarget = path.join(savedOutDir, 'copied-pkg.json');
      const localCopy = await exposedBridge.saveFile({
        fileName: 'copied-pkg.json',
        content: '',
        sourcePath: localSrc,
      });
      assert.equal(localCopy.success, true);
      assert.ok(fs.readFileSync(currentSaveTarget, 'utf8').includes('hermes-flux-monorepo'));

      // 非 process.cwd() 的合法工作区目录（tmpDir/hello.txt）同样允许安全直拷
      const externalCopyTarget = path.join(savedOutDir, 'ext-hello.txt');
      currentSaveTarget = externalCopyTarget;
      const extCopy = await exposedBridge.saveFile({
        fileName: 'hello.txt',
        content: '',
        sourcePath: path.join(tmpDir, 'hello.txt'),
      });
      assert.equal(extCopy.success, true);
      assert.equal(fs.readFileSync(externalCopyTarget, 'utf8'), 'ok');

      // 覆盖 isSafeReadablePath 对 tempDir 相对路径 `sub/../hello.txt` 的直拷回退分支
      const tempSubFallbackTarget = path.join(savedOutDir, 'sub-hello.txt');
      currentSaveTarget = tempSubFallbackTarget;
      const tempSubCopy = await exposedBridge.saveFile({
        fileName: 'hello.txt',
        content: '',
        sourcePath: path.join(tmpDir, 'sub', '..', 'hello.txt'),
      });
      assert.equal(tempSubCopy.success, true);
      assert.equal(fs.readFileSync(tempSubFallbackTarget, 'utf8'), 'ok');

      // 敏感/不可读源文件且无 content / remoteUrl 时必须显式返回失败，绝不写入 0 字节空文件
      const forbiddenZeroTarget = path.join(savedOutDir, 'should-not-exist.exe');
      currentSaveTarget = forbiddenZeroTarget;
      const forbiddenZero = await exposedBridge.saveFile({
        fileName: 'should-not-exist.exe',
        content: '',
        sourcePath: 'C:\\Windows\\win.ini',
      });
      assert.equal(forbiddenZero.success, false);
      assert.match(forbiddenZero.error || '', /无法读取本地源文件/);
      assert.equal(fs.existsSync(forbiddenZeroTarget), false);

      // sourcePath 缺失时：有 content 则继续回落写盘，content 为 http:// URL 时回落远程下载
      currentSaveTarget = path.join(savedOutDir, 'fallback.txt');
      const missingSrcFallback = await exposedBridge.saveFile({
        fileName: 'fallback.txt',
        content: 'hello plain',
        sourcePath: path.join(process.cwd(), '__not_exists__.txt'),
      });
      assert.equal(missingSrcFallback.success, true);
      assert.equal(fs.readFileSync(currentSaveTarget, 'utf8'), 'hello plain');

      currentSaveTarget = path.join(savedOutDir, 'http-content.exe');
      const httpContentDl = await exposedBridge.saveFile({
        fileName: 'http-content.exe',
        content: 'http://127.0.0.1:9999/api/fs/download?path=%2Fws%2Fhttp.exe',
      });
      assert.equal(httpContentDl.success, true);
    } finally {
      globalThis.fetch = origFetch;
      console.warn = origWarn;
      fs.rmSync(savedOutDir, { recursive: true, force: true });
    }
  } finally {
    Module._load = origLoad;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveSafeLocalSourceFile 校验非 CWD 工作区文件直拷、.env* 与 symlink 逃逸拦截', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-src-guard-'));
  try {
    const okFile = path.join(tmpRoot, 'tool.exe');
    const envExample = path.join(tmpRoot, '.env.example');
    const envSecret = path.join(tmpRoot, '.env');
    const envLocal = path.join(tmpRoot, '.env.local');
    fs.writeFileSync(okFile, 'MZ');
    fs.writeFileSync(envExample, 'KEY=val');
    fs.writeFileSync(envSecret, 'SECRET=1');
    fs.writeFileSync(envLocal, 'SECRET=2');

    assert.equal(resolveSafeLocalSourceFile('package.json'), fs.realpathSync(path.join(process.cwd(), 'package.json')));
    assert.equal(resolveSafeLocalSourceFile(undefined), null);
    assert.equal(resolveSafeLocalSourceFile('   '), null);
    assert.equal(resolveSafeLocalSourceFile('a\0b'), null);
    assert.equal(resolveSafeLocalSourceFile('.env', tmpRoot), null);
    assert.equal(resolveSafeLocalSourceFile('sub/.env.local', tmpRoot), null);
    assert.equal(resolveSafeLocalSourceFile(envLocal, process.cwd()), null);
    assert.equal(resolveSafeLocalSourceFile(envExample, process.cwd()), fs.realpathSync(envExample));
    assert.equal(resolveSafeLocalSourceFile(okFile, process.cwd()), fs.realpathSync(okFile));
    assert.equal(resolveSafeLocalSourceFile('../../../outside.exe', process.cwd()), null);
    assert.equal(resolveSafeLocalSourceFile('C:/Windows/win.ini', process.cwd()), null);
    assert.equal(resolveSafeLocalSourceFile(path.join(tmpRoot, 'missing.exe'), process.cwd()), null);
    assert.equal(resolveSafeLocalSourceFile(tmpRoot, process.cwd()), null);

    // 模拟 realpathSync 解析到系统目录、隐藏 .env 文件或抛出权限异常
    const origRealpath = fs.realpathSync;
    try {
      fs.realpathSync = () => 'C:\\Windows\\System32\\cmd.exe';
      assert.equal(resolveSafeLocalSourceFile(okFile, process.cwd()), null);

      fs.realpathSync = () => path.join(tmpRoot, '.env');
      assert.equal(resolveSafeLocalSourceFile(okFile, process.cwd()), null);

      fs.realpathSync = () => {
        throw new Error('EACCES');
      };
      assert.equal(resolveSafeLocalSourceFile(okFile, process.cwd()), null);
    } finally {
      fs.realpathSync = origRealpath;
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
