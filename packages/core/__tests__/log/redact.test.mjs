/**
 * 日志脱敏不变量。
 *
 * 【为什么需要】`model.save_key` 的 API Key 会经过 GatewayClient.call 的统一调试日志。
 * 若只断言"代码里调用了 redactSensitive"，把实现改成恒等函数也不会变红；
 * 这里直接对函数输出做断言，并覆盖嵌套、数组、缩写键与循环引用。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitive, isSensitiveKey } from '../../dist/log/redact.js';

test('api_key / password / token 等键必须被替换为固定掩码', () => {
  const input = {
    slug: 'openrouter',
    api_key: 'sk-or-secret-value',
    apiKey: 'camel-case',
    'x-api-key': 'header-case',
    password: 'hunter2',
    access_token: 'at-123',
    Authorization: 'Bearer xyz',
    client_secret: 'sekret',
    cookie: 'hermes_session=abc',
  };
  const out = redactSensitive(input);
  assert.equal(out.slug, 'openrouter');
  for (const key of ['api_key', 'apiKey', 'x-api-key', 'password', 'access_token', 'Authorization', 'client_secret', 'cookie']) {
    assert.equal(out[key], '[REDACTED]', `${key} 必须脱敏`);
  }
});

test('普通字段、数字与布尔值原样保留', () => {
  const out = redactSensitive({ profile: 'default', include_unconfigured: true, count: 3, ratio: 0.5, nil: null });
  assert.deepEqual(out, { profile: 'default', include_unconfigured: true, count: 3, ratio: 0.5, nil: null });
});

test('嵌套对象与数组递归脱敏，数组本身不被整体替换', () => {
  const out = redactSensitive({
    servers: [
      { name: 'github', bearer_token: 'ghp_xxx' },
      { name: 'slack', env: [{ key: 'SLACK_TOKEN', value: 'xoxb' }] },
    ],
    auth: { password: 'nested' },
  });
  assert.equal(out.servers.length, 2);
  assert.equal(out.servers[0].bearer_token, '[REDACTED]');
  assert.equal(out.servers[0].name, 'github');
  assert.equal(out.servers[1].env[0].value, 'xoxb', 'value 不是敏感键，不应被误杀');
  assert.equal(out.auth.password, '[REDACTED]');
});

test('不得修改入参（日志脱敏不能污染真实请求）', () => {
  const input = { api_key: 'sk-live', nested: { token: 't' } };
  const snapshot = JSON.stringify(input);
  redactSensitive(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('循环引用与超深结构不得抛错', () => {
  const cyclic = { name: 'root' };
  cyclic.self = cyclic;
  const out = redactSensitive(cyclic);
  assert.equal(out.self, '[Circular]');

  let deep = { value: 1 };
  for (let i = 0; i < 20; i += 1) deep = { child: deep };
  assert.doesNotThrow(() => redactSensitive(deep));
  assert.equal(JSON.stringify(redactSensitive(deep)).includes('[Truncated]'), true);
});

test('键名判定：snake_case 与 camelCase 都命中，key_env / token_count 不误杀', () => {
  assert.equal(isSensitiveKey('api_key'), true);
  assert.equal(isSensitiveKey('API-KEY'), true);
  assert.equal(isSensitiveKey('accessToken'), true);
  assert.equal(isSensitiveKey('refreshToken'), true);
  assert.equal(isSensitiveKey('clientSecret'), true);
  assert.equal(isSensitiveKey('key_env'), false);
  assert.equal(isSensitiveKey('token_count'), false);
  assert.equal(isSensitiveKey('model'), false);
});

test('camelCase 凭据字段必须脱敏（曾经只认 snake_case 而漏网）', () => {
  const out = redactSensitive({ accessToken: 'at', refreshToken: 'rt', apiKey: 'ak' });
  assert.deepEqual(out, { accessToken: '[REDACTED]', refreshToken: '[REDACTED]', apiKey: '[REDACTED]' });
});

test('method 级额外字段：mcp.servers.set_api_key 的 value 必须脱敏', () => {
  const params = { profile: 'default', name: 'github', value: 'sk-live-secret' };
  const withoutExtra = redactSensitive(params);
  assert.equal(withoutExtra.value, 'sk-live-secret', '通用规则不猜未知键名');
  const withExtra = redactSensitive(params, { extraKeys: ['value'] });
  assert.equal(withExtra.value, '[REDACTED]');
  assert.equal(withExtra.name, 'github');
});
