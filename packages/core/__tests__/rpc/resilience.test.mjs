import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSessionsResult, extractAvailableModels } from '../../dist/models/types.js';
import { HermesGatewayClient } from '../../dist/rpc/client.js';

test('Core Model Extractors - normalizeSessionsResult', async (t) => {
  await t.test('should extract sessions from nested "sessions" property', () => {
    // 1. Arrange
    const payload = {
      sessions: [
        { id: 'ses-101', title: 'Code Refactoring', model: 'claude-3-7', last_active: 1710000000 },
        { id: 'ses-102', model: 'deepseek-v4.1', started_at: 1710000010 },
      ],
    };

    // 2. Act
    const result = normalizeSessionsResult(payload);

    // 3. Assert
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'ses-101');
    assert.equal(result[0].title, 'Code Refactoring');
    assert.equal(result[0].model, 'claude-3-7');
    assert.equal(result[1].id, 'ses-102');
    assert.equal(result[1].title, '会话 ses-102'); // Auto fallback title
  });

  await t.test('should extract sessions from "data" array property and handle empty payloads', () => {
    // 1. Arrange
    const payload = {
      data: [{ session_id: 'ses-201', title: 'Data Analysis', preview: 'Initial results...' }],
    };

    // 2. Act
    const result = normalizeSessionsResult(payload);
    const emptyResult = normalizeSessionsResult(null);

    // 3. Assert
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'ses-201');
    assert.equal(result[0].title, 'Data Analysis');
    assert.equal(result[0].preview, 'Initial results...');
    assert.equal(emptyResult.length, 0);
  });

  await t.test('时间戳语义：last_active 必须优先于 started_at（真实网关 WS 只给 started_at）', () => {
    // Arrange: 真实 REST 行形态——started_at 是创建时间，last_active 是最后一条消息时间
    const payload = {
      sessions: [{
        id: 'ses-real-1',
        title: '安卓开发',
        started_at: 1792252789.687694,
        last_active: 1793290266.1687338,
      }],
    };

    // Act
    const result = normalizeSessionsResult(payload);

    // Assert: 必须以 last_active 为准（两者相差约 12 天）
    assert.equal(result[0].timestamp, 1793290266.1687338 * 1000, '必须取 last_active 而非 started_at');
    assert.equal(result[0].timeSource, 'last_active', '必须记录时间来源为 last_active');
  });

  await t.test('缺失 last_active 时降级到 started_at，并如实标注来源', () => {
    const payload = { sessions: [{ id: 'ses-ws-only', title: '只有创建时间', started_at: 1792252789.687694 }] };
    const result = normalizeSessionsResult(payload);
    assert.equal(result[0].timeSource, 'started_at');
    assert.equal(result[0].timestamp, 1792252789.687694 * 1000);
  });

  await t.test('hidden / unread / pinned 必须原样透传（供可见性与三态判定）', () => {
    const payload = {
      sessions: [{ id: 'ses-h', title: '隐藏会话', hidden: 1, unread: true, pinned: true, last_active: 1793000000 }],
    };
    const result = normalizeSessionsResult(payload);
    assert.equal(result[0].hidden, true, 'hidden=1 必须归一为 true');
    assert.equal(result[0].unread, true);
    assert.equal(result[0].pinned, true);
  });

  await t.test('无任何时间字段时 timestamp 为 0（不得伪造为当前时间）', () => {
    const payload = { sessions: [{ id: 'ses-no-time', title: '无时间' }] };
    const result = normalizeSessionsResult(payload);
    assert.equal(result[0].timestamp, 0, '缺失时间不得伪造为 Date.now()');
    assert.equal(result[0].timeSource, 'none');
  });
});

test('Core Model Extractors - extractAvailableModels', async (t) => {
  await t.test('should recursively parse models, providers and root model while deduplicating', () => {
    // 1. Arrange
    const payload = {
      model: 'default-hermes',
      models: ['claude-3-7-sonnet', 'deepseek-chat'],
      providers: [
        {
          provider: 'openai',
          models: ['gpt-4o', { id: 'o3-mini', name: 'O3 Mini' }],
        },
        {
          provider: 'anthropic',
          models: ['claude-3-7-sonnet'], // Duplicate check
        },
      ],
    };

    // 2. Act
    const models = extractAvailableModels(payload);

    // 3. Assert
    assert.ok(models.includes('default-hermes'));
    assert.ok(models.includes('claude-3-7-sonnet'));
    assert.ok(models.includes('deepseek-chat'));
    assert.ok(models.includes('gpt-4o'));
    assert.ok(models.includes('o3-mini'));
    assert.equal(models.filter((m) => m === 'claude-3-7-sonnet').length, 1);
  });

  await t.test('should return fallback models if payload is empty or yields no models', () => {
    // 1. Arrange
    const fallbacks = ['fallback-model-a', 'fallback-model-b'];

    // 2. Act
    const models = extractAvailableModels(null, fallbacks);

    // 3. Assert
    assert.deepEqual(models, fallbacks);
  });
});

test('HermesGatewayClient Resilience - Dual-Channel Fallback', async (t) => {
  await t.test('listSessions 必须优先 REST（只有它给 last_active），而不是 WS session.list', async () => {
    // Arrange: 两条通道都可用，且各自返回不同的时间戳来源
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    const restRows = [{ id: 'ses-rest', title: 'REST 会话', last_active: 1793290266 }];
    let restCalls = 0;
    client.setRestFallbackHandler(async (path, options) => {
      assert.equal(path, '/api/sessions');
      assert.equal(options?.params?.profile, 'flux-test');
      restCalls++;
      return { sessions: restRows };
    });
    // 伪造一个"已连接"的 WS，使两条通道同时可用
    client.ws = { readyState: 1, send() {}, close() {} };
    client.call = async () => ({ sessions: [{ id: 'ses-ws', title: 'WS 会话', started_at: 1792000000 }] });

    // Act
    const outcome = await client.listSessions('flux-test', 50);

    // Assert: 必须走 REST 并拿到 last_active 语义的时间
    assert.equal(restCalls, 1, '必须优先调用 REST /api/sessions');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.sessions[0].id, 'ses-rest');
    assert.equal(outcome.sessions[0].timeSource, 'last_active');
  });

  await t.test('listSessions 的 limit 必须收敛到 [1,100]（REST 超过 100 会 422）', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    let seenLimit = null;
    client.setRestFallbackHandler(async (_path, options) => {
      seenLimit = options?.params?.limit;
      return { sessions: [] };
    });

    await client.listSessions('default', 500);

    assert.equal(seenLimit, 100, 'limit=500 必须收敛为 100，避免网关 422');
  });

  await t.test('REST 失败时必须回落 WS，且仍能拿到会话（弱网可用）', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    client.setRestFallbackHandler(async () => { throw new Error('REST down'); });
    client.ws = { readyState: 1, send() {}, close() {} };
    client.call = async () => ({ sessions: [{ id: 'ses-ws-2', title: 'WS 兜底', started_at: 1792000000 }] });

    const outcome = await client.listSessions('default', 50);

    assert.equal(outcome.ok, true);
    assert.equal(outcome.sessions[0].id, 'ses-ws-2');
    assert.equal(outcome.sessions[0].timeSource, 'started_at', 'WS 只能给 started_at，必须如实标注');
  });

  await t.test('fetchLastMessage 必须走单条 latest 接口，并返回压平文本', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    let capturedPath = '';
    let capturedParams = null;
    client.setRestFallbackHandler(async (path, options) => {
      capturedPath = path;
      capturedParams = options?.params;
      return { messages: [{ role: 'assistant', content: '  已收到\n自动化验证消息  ', timestamp: 1793540000 }] };
    });

    const last = await client.fetchLastMessage('ses-x', { profile: 'xiaofawang' });

    assert.equal(capturedPath, '/api/sessions/ses-x/messages');
    assert.equal(capturedParams.limit, 1, '只取 1 条，避免拉全量历史');
    assert.equal(capturedParams.order, 'latest');
    assert.equal(capturedParams.profile, 'xiaofawang', '必须透传 profile 参数，确保专职 Agent 会话不报 404');
    assert.equal(last.text, '已收到 自动化验证消息', '换行必须压平为空格');
    assert.equal(last.timestamp, 1793540000000, '秒级时间戳必须换算为毫秒');
  });

  await t.test('fetchSessionMessages 必须透传 limit/offset/order 与 profile 参数', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    let capturedPath = '';
    let capturedParams = null;
    client.setRestFallbackHandler(async (path, options) => {
      capturedPath = path;
      capturedParams = options?.params;
      return { messages: [{ id: 1, role: 'user', content: '你好' }], pagination: { returned: 1 } };
    });

    const outcome = await client.fetchSessionMessages('ses-msg-1', {
      limit: 20,
      offset: 5,
      order: 'latest',
      profile: 'xiaofawang',
    });

    assert.equal(capturedPath, '/api/sessions/ses-msg-1/messages');
    assert.equal(capturedParams.limit, 20);
    assert.equal(capturedParams.offset, 5);
    assert.equal(capturedParams.order, 'latest');
    assert.equal(capturedParams.profile, 'xiaofawang', '必须向 REST query params 透传 profile');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.messages.length, 1);
  });

  await t.test('fetchLastMessage 在无 REST 通道时返回 null（失败 ≠ 空字符串）', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    const last = await client.fetchLastMessage('ses-x');
    assert.equal(last, null, '无通道必须返回 null，让调用方保留既有副标题');
  });

  await t.test('fetchLastMessage 请求抛错时返回 null，绝不伪装成空消息', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    client.setRestFallbackHandler(async () => { throw new Error('HTTP 500'); });
    const last = await client.fetchLastMessage('ses-x');
    assert.equal(last, null, '请求失败必须返回 null（失败 ≠ 空消息）');
  });

  await t.test('listSessions 双通道全失败必须 ok:false 并携带错误原因（失败 ≠ 空）', async () => {
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    client.setRestFallbackHandler(async () => { throw new Error('REST 500'); });
    client.ws = { readyState: 1, send() {}, close() {} };
    client.call = async () => { throw new Error('WS 4001'); };

    const outcome = await client.listSessions('default', 50);

    assert.equal(outcome.ok, false, '双通道失败不得返回 ok:true');
    assert.equal(outcome.sessions.length, 0);
    assert.ok(outcome.error && outcome.error.length > 0, '必须保留失败原因，供界面区分"失败"与"空"');
  });

  await t.test('listSessionsSafe should seamlessly fall back to REST handler when WS is disconnected', async () => {
    // 1. Arrange
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    client.setRestFallbackHandler(async (path, options) => {
      assert.equal(path, '/api/sessions');
      assert.equal(options?.params?.profile, 'flux-test');
      return {
        data: [{ id: 'ses-rest-1', title: 'Restored from REST' }],
      };
    });

    // 2. Act
    const sessions = await client.listSessionsSafe('flux-test');

    // 3. Assert
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'ses-rest-1');
    assert.equal(sessions[0].title, 'Restored from REST');
  });

  await t.test('getModelOptionsSafe should fall back to REST then fallback list on WS failure', async () => {
    // 1. Arrange
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    client.setRestFallbackHandler(async () => {
      throw new Error('REST network down');
    });

    // 2. Act
    const models = await client.getModelOptionsSafe('default', ['safe-fallback-1']);

    // 3. Assert
    assert.deepEqual(models, ['safe-fallback-1']);
  });

  await t.test('fetchSessionMessages should route to official REST endpoint with pagination params', async () => {
    // 1. Arrange
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    let capturedPath = '';
    let capturedOptions = null;
    client.setRestFallbackHandler(async (path, options) => {
      capturedPath = path;
      capturedOptions = options;
      return {
        session_id: 's-android-01',
        messages: [{ role: 'user', content: 'hello' }],
        pagination: { limit: 50, offset: 0, order: 'latest', returned: 1 },
      };
    });

    // 2. Act
    const res = await client.fetchSessionMessages('s-android-01', { limit: 50, offset: 0, order: 'latest' });

    // 3. Assert
    assert.equal(capturedPath, '/api/sessions/s-android-01/messages');
    assert.deepEqual(capturedOptions?.params, { limit: 50, offset: 0, order: 'latest' });
    assert.equal(res.ok, true);
    assert.equal(res.messages.length, 1);
    assert.equal(res.pagination.returned, 1);
  });

  await t.test('fetchSessionMessages should gracefully report error when restFallbackHandler throws', async () => {
    // 1. Arrange
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    client.setRestFallbackHandler(async () => {
      throw new Error('HTTP 401: Unauthorized');
    });

    // 2. Act
    const res = await client.fetchSessionMessages('s-err-01');

    // 3. Assert
    assert.equal(res.ok, false);
    assert.equal(res.messages.length, 0);
    assert.ok(res.error.includes('401'));
  });
});
