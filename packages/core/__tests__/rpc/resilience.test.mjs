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
  await t.test('listSessionsSafe should seamlessly fall back to REST handler when WS is disconnected', async () => {
    // 1. Arrange
    const client = new HermesGatewayClient({ url: 'ws://127.0.0.1:99999', autoConnect: false });
    client.setRestFallbackHandler(async (path, options) => {
      assert.equal(path, '/api/sessions');
      assert.equal(options?.params?.profile, 'aura-test');
      return {
        data: [{ id: 'ses-rest-1', title: 'Restored from REST' }],
      };
    });

    // 2. Act
    const sessions = await client.listSessionsSafe('aura-test');

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
});
