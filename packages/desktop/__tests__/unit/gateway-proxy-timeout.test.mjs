import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * REST 代理超时守卫。
 *
 * 【为什么需要】提供商绑定、模型目录读取等所有网关 REST 调用都走 `gateway:http-proxy`。
 *   它一旦没有超时，调用方的在途锁（`inFlightProviderBindings`）就会被永久占用：
 *   界面从此点不动，只能重启应用。这条不是"防御性编程"，是可复现的死锁。
 *
 * 【为什么用静态断言】主进程 IPC 依赖 Electron 运行时，无法在 Node 测试里直接挂载。
 *   这条守卫的价值在于"超时参数存在且挂在 fetch 上"——删掉它就必须变红。
 */
const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'packages/desktop/src/main/ipc.ts'), 'utf8');

function handlerBody(channel) {
  const start = source.indexOf(`ipcMain.handle('${channel}'`);
  assert.notEqual(start, -1, `ipc.ts 必须注册 ${channel}`);
  const nextHandler = source.indexOf('ipcMain.handle(', start + 10);
  return source.slice(start, nextHandler === -1 ? source.length : nextHandler);
}

test('gateway:http-proxy 必须给 fetch 挂超时，否则在途锁会被永久占用', () => {
  const body = handlerBody('gateway:http-proxy');
  assert.ok(body.includes('signal:'), 'fetch 必须带 signal，否则请求可以无限挂起');
  assert.ok(
    /signal:\s*AbortSignal\.timeout\(\s*\d[\d_]*\s*\)/.test(body),
    'signal 必须是 AbortSignal.timeout(...)：手写 AbortController 容易漏掉清理',
  );
  const match = body.match(/AbortSignal\.timeout\(\s*(\d[\d_]*)\s*\)/);
  const ms = Number(match[1].replace(/_/g, ''));
  assert.ok(ms > 0 && ms <= 120_000, `超时必须是有界正数且在 2 分钟内，实测 ${ms}`);
});

test('超时必须落在 fetchOptions 上，而不是只声明不用', () => {
  const body = handlerBody('gateway:http-proxy');
  const optionsAt = body.indexOf('const fetchOptions');
  assert.notEqual(optionsAt, -1, '必须构造 fetchOptions');
  const fetchAt = body.indexOf('fetch(fullUrl, fetchOptions)');
  assert.notEqual(fetchAt, -1, '必须把 fetchOptions 交给 fetch');
  const slice = body.slice(optionsAt, fetchAt);
  assert.ok(slice.includes('signal:'), 'signal 必须在 fetchOptions 对象内部，否则不会生效');
});
