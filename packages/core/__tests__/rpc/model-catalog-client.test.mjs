import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HermesGatewayClient } from '../../dist/rpc/client.js';
import { normalizeModelCatalog } from '../../dist/models/modelCatalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', 'fixtures', 'gateway', 'model_options.json');

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

/** 造一个"WS 已连接"的客户端替身，避免真开 socket。 */
function makeClientWithWs(callImpl) {
  const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:1', autoConnect: false });
  client.ws = { readyState: 1 };
  client.call = callImpl;
  return client;
}

test('getModelCatalog - WS 通道归一化契约', async (t) => {
  const fixture = loadFixture();

  await t.test('1. WS 请求必须携带 explicit_only，只列用户显式配置的 provider', async () => {
    let capturedParams = null;
    const client = makeClientWithWs(async (method, params) => {
      assert.equal(method, 'model.options');
      capturedParams = params;
      return fixture.result;
    });

    await client.getModelCatalog('default');

    assert.equal(capturedParams?.explicit_only, true, '不传 explicit_only 会把环境里残留的 Nous 会话也列出来');
    assert.equal(capturedParams?.profile, 'default');
  });

  await t.test('2. WS 成功时 entries / models / details 三视图同源', async () => {
    const client = makeClientWithWs(async (method) => {
      assert.equal(method, 'model.options');
      return fixture.result;
    });

    const catalog = await client.getModelCatalog('default');

    assert.equal(catalog.ok, true);
    assert.ok(catalog.entries.length > 0);

    const entryIds = new Set(catalog.entries.map((e) => e.id));
    for (const id of entryIds) {
      assert.ok(catalog.models.includes(id), `models 必须覆盖 entries 的 ${id}`);
    }
    const extras = catalog.models.filter((id) => !entryIds.has(id));
    assert.ok(
      extras.every((id) => id === fixture.result.model),
      `models 超出 entries 的只允许是根层当前模型，实际多出: ${extras.join(',')}`,
    );

    for (const detail of catalog.details) {
      assert.ok(catalog.models.includes(detail.id), `details 里的 ${detail.id} 必须也在 models 中`);
      assert.ok(!detail.id.startsWith('<'), 'details 不得含探针占位符');
    }
  });

  await t.test('3. 当前模型/provider 透传网关报告值', async () => {
    const client = makeClientWithWs(async () => fixture.result);
    const catalog = await client.getModelCatalog('default');
    assert.equal(catalog.currentModel, fixture.result.model);
    assert.equal(catalog.currentProvider, fixture.result.provider);
  });

  await t.test('4. entries 带完整可读显示名，且不含探针占位符', async () => {
    const client = makeClientWithWs(async () => fixture.result);
    const catalog = await client.getModelCatalog('default');
    for (const entry of catalog.entries) {
      assert.ok(entry.displayName.length > 0, `${entry.id} 必须有显示名`);
      assert.ok(!entry.id.startsWith('<'), '占位符不得进入 entries');
      // 后缀词必须在名字里，不得只留在字段
      if (entry.variant) {
        assert.ok(entry.displayName.includes(entry.variant), `${entry.id} 的显示名必须包含 ${entry.variant}`);
      }
    }
  });

  await t.test('5. WS 返回空列表时降级到 REST 通道', async () => {
    const client = makeClientWithWs(async () => ({ providers: [], model: '', provider: '' }));
    let restCalled = false;
    client.setRestFallbackHandler(async () => {
      restCalled = true;
      return fixture.result;
    });

    const catalog = await client.getModelCatalog('default');

    assert.equal(restCalled, true);
    assert.equal(catalog.ok, true);
    assert.ok(catalog.entries.length > 0);
  });
});

test('getModelCatalog - REST 兜底路径必须是真实存在的网关路由', async (t) => {
  const fixture = loadFixture();

  await t.test('1. REST 兜底必须打 /api/model/options（而非不存在的 /api/models）', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:1', autoConnect: false });
    let capturedPath = '';
    client.setRestFallbackHandler(async (requestPath) => {
      capturedPath = requestPath;
      return fixture.result;
    });

    const catalog = await client.getModelCatalog('default');

    assert.equal(capturedPath, '/api/model/options');
    assert.notEqual(capturedPath, '/api/models');
    assert.equal(catalog.ok, true);
  });

  await t.test('2. REST 兜底同时透传 profile 与 explicit_only', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:1', autoConnect: false });
    let capturedParams = null;
    client.setRestFallbackHandler(async (_p, options) => {
      capturedParams = options?.params;
      return fixture.result;
    });
    await client.getModelCatalog('my-bot');
    assert.equal(capturedParams?.profile, 'my-bot');
    assert.equal(capturedParams?.explicit_only, 1, 'REST 拼法沿用官方 explicit_only=1');
  });
});

test('getModelCatalog - 双通道失败语义（失败不可致空）', async (t) => {
  await t.test('1. 双通道全失败时 ok:false、entries 为空、error 必有值', async () => {
    const client = makeClientWithWs(async () => {
      throw new Error('WS boom');
    });
    client.setRestFallbackHandler(async () => {
      throw new Error('REST boom');
    });

    const catalog = await client.getModelCatalog('default');

    assert.equal(catalog.ok, false);
    assert.deepEqual(catalog.entries, []);
    assert.ok(typeof catalog.error === 'string' && catalog.error.length > 0);
  });

  await t.test('2. 失败时 fallbackModels 只作为 id 列表，不得伪造 entries', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:1', autoConnect: false });
    client.setRestFallbackHandler(async () => {
      throw new Error('REST boom');
    });

    const catalog = await client.getModelCatalog('default', ['fallback-1']);

    assert.equal(catalog.ok, false);
    assert.deepEqual(catalog.models, ['fallback-1']);
    assert.deepEqual(catalog.entries, []);
  });
});

test('normalizeModelCatalog - provider 可选性过滤', async (t) => {
  await t.test('1. authenticated:false 的 provider 整行丢弃', () => {
    const entries = normalizeModelCatalog({
      providers: [
        { slug: 'ok', name: 'OK', models: ['m1'], authenticated: true },
        { slug: 'dead', name: 'Dead', models: ['m2'], authenticated: false },
      ],
    });
    assert.deepEqual(entries.map((e) => e.id), ['m1']);
  });

  await t.test('2. authenticated:true 优先于任何历史负向标志', () => {
    const entries = normalizeModelCatalog({
      providers: [
        { slug: 'p', name: 'P', models: ['m1'], authenticated: true, configured: false, status: 'unconfigured' },
      ],
    });
    assert.equal(entries.length, 1);
  });

  await t.test('3. 真实 fixture 的已认证 provider 不得被误杀', () => {
    const fixture = loadFixture();
    const authedRows = fixture.result.providers.filter((p) => p.authenticated === true);
    const entries = normalizeModelCatalog(fixture.result);
    const slugs = new Set(entries.map((e) => e.providerSlug));
    for (const row of authedRows) {
      assert.ok(slugs.has(row.slug), `已认证 provider ${row.slug} 不得被误杀`);
    }
  });
});
