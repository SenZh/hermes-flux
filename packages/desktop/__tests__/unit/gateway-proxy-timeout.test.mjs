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
 *   因此这里做**结构化**校验：把 `fetchOptions` 的对象字面量切出来按花括号配对，
 *   只在这个字面量内部找 `signal`。区间子串扫描会被任何同名变量骗过。
 */
const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'packages/desktop/src/main/ipc.ts'), 'utf8');

function handlerBody(channel) {
  const start = source.indexOf(`ipcMain.handle('${channel}'`);
  assert.notEqual(start, -1, `ipc.ts 必须注册 ${channel}`);
  const nextHandler = source.indexOf('ipcMain.handle(', start + 10);
  return source.slice(start, nextHandler === -1 ? source.length : nextHandler);
}

/** 从 `const fetchOptions = {` 起，按花括号配对切出完整对象字面量。 */
function fetchOptionsLiteral(body) {
  const at = body.indexOf('const fetchOptions');
  assert.notEqual(at, -1, '必须构造 fetchOptions');
  const open = body.indexOf('{', at);
  assert.notEqual(open, -1, 'fetchOptions 必须是对象字面量');
  let depth = 0;
  for (let i = open; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return body.slice(open, i + 1);
    }
  }
  assert.fail('fetchOptions 对象字面量未闭合');
}

test('gateway:http-proxy 必须给 fetch 挂超时，否则在途锁会被永久占用', () => {
  const body = handlerBody('gateway:http-proxy');
  assert.ok(
    /signal:\s*AbortSignal\.timeout\(\s*\d[\d_]*\s*\)/.test(body),
    '必须使用 AbortSignal.timeout(...)：手写 AbortController 容易漏掉清理',
  );
  const match = body.match(/AbortSignal\.timeout\(\s*(\d[\d_]*)\s*\)/);
  const ms = Number(match[1].replace(/_/g, ''));
  assert.ok(ms > 0 && ms <= 120_000, `超时必须是有界正数且在 2 分钟内，实测 ${ms}`);
});

test('signal 必须写在 fetchOptions 对象字面量内部，声明在外部等于没生效', () => {
  const body = handlerBody('gateway:http-proxy');
  const literal = fetchOptionsLiteral(body);
  assert.ok(
    /signal:\s*AbortSignal\.timeout\(/.test(literal),
    `signal 必须属于 fetchOptions 自身字段，实测字面量为 ${literal}`,
  );
  assert.notEqual(body.indexOf('fetch(fullUrl, fetchOptions)'), -1, '必须把 fetchOptions 交给 fetch');
});
