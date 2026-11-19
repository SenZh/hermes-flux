/**
 * localStorage 安全读写原语（P-032）单元测试。
 *
 * 【断言】
 *   1. 非浏览器环境（无 localStorage）读写均安全降级；
 *   2. 隐私模式 SecurityError 与配额 QuotaExceededError 被区分返回，不抛异常；
 *   3. 显式注入的 storage 替身优先于全局 localStorage（保留既有依赖注入语义）；
 *   4. 错误对象形状异常（非对象 / 无 name / name 非字符串）不得让判定本身抛错。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { safeGetItem, safeSetItem } from '../dist/lib/safeStorage.js';

function withLocalStorage(value, fn) {
  const had = 'localStorage' in globalThis;
  const saved = globalThis.localStorage;
  try {
    if (value === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = value;
    return fn();
  } finally {
    if (had) globalThis.localStorage = saved;
    else delete globalThis.localStorage;
  }
}

function throwWithName(name) {
  return () => {
    const error = new Error(name);
    error.name = name;
    throw error;
  };
}

test('safeGetItem：无存储、正常值、读取抛错三种路径', () => {
  withLocalStorage(undefined, () => {
    assert.equal(safeGetItem('any'), null, '无 localStorage 必须回落 null');
  });

  withLocalStorage({ getItem: (key) => (key === 'k' ? 'v' : null) }, () => {
    assert.equal(safeGetItem('k'), 'v');
    assert.equal(safeGetItem('missing'), null);
  });

  withLocalStorage({ getItem: throwWithName('SecurityError') }, () => {
    assert.doesNotThrow(() => safeGetItem('k'), '隐私模式读取抛错不得外泄');
    assert.equal(safeGetItem('k'), null);
  });
});

test('safeSetItem：无存储返回 unavailable，正常写入返回 ok', () => {
  withLocalStorage(undefined, () => {
    assert.deepEqual(safeSetItem('k', 'v'), { ok: false, reason: 'unavailable', error: null });
  });

  const writes = [];
  withLocalStorage({ setItem: (key, value) => writes.push([key, value]) }, () => {
    assert.deepEqual(safeSetItem('k', 'v'), { ok: true });
    assert.deepEqual(writes, [['k', 'v']]);
  });
});

test('safeSetItem：SecurityError 与两种配额错误被区分，且不外抛', () => {
  withLocalStorage({ setItem: throwWithName('SecurityError') }, () => {
    const result = safeSetItem('k', 'v');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'security');
    assert.ok(result.error instanceof Error);
  });

  for (const name of ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']) {
    withLocalStorage({ setItem: throwWithName(name) }, () => {
      const result = safeSetItem('k', 'v');
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'quota', `${name} 必须归类为配额失败`);
    });
  }
});

test('safeSetItem：错误对象形状异常时判定自身不得抛错', () => {
  const weirdErrors = ['plain string', null, {}, { name: 123 }];
  for (const error of weirdErrors) {
    withLocalStorage(
      {
        setItem: () => {
          throw error;
        },
      },
      () => {
        const result = safeSetItem('k', 'v');
        assert.equal(result.ok, false, `抛出 ${String(error)} 时仍须返回失败而非外抛`);
        assert.equal(result.reason, 'security', '无法识别名称的错误按 security 处理');
      },
    );
  }
});

test('safeSetItem：显式注入的 storage 优先于全局 localStorage', () => {
  const injected = [];
  const globalWrites = [];
  withLocalStorage({ setItem: (key, value) => globalWrites.push([key, value]) }, () => {
    const result = safeSetItem('k', 'v', { setItem: (key, value) => injected.push([key, value]) });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(injected, [['k', 'v']], '必须写入注入的 storage');
    assert.deepEqual(globalWrites, [], '不得写入全局 localStorage');
  });

  withLocalStorage(undefined, () => {
    const result = safeSetItem('k', 'v', undefined);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unavailable', '未注入且无全局存储时返回 unavailable');
  });
});

test('safeGetItem / safeSetItem：localStorage getter 抛错（禁用站点数据）必须在 try 内被捕获', () => {
  // 【杀伤力】把 `typeof localStorage` 提到 try 之外，本用例立刻抛 SecurityError 变红。
  const hadStorage = 'localStorage' in globalThis;
  const savedStorage = globalThis.localStorage;
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        const error = new Error('denied');
        error.name = 'SecurityError';
        throw error;
      },
    });

    assert.doesNotThrow(() => safeGetItem('k'), 'getter 抛错不得外泄');
    assert.equal(safeGetItem('k'), null);

    let result;
    assert.doesNotThrow(() => {
      result = safeSetItem('k', 'v');
    }, 'getter 抛错不得外泄');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'security', 'getter 抛错必须归类为 security 而非 unavailable');
  } finally {
    delete globalThis.localStorage;
    if (hadStorage) globalThis.localStorage = savedStorage;
  }
});
