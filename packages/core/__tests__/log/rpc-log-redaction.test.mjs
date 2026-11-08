/**
 * RPC 日志脱敏接线（不是纯函数单测，而是验证 client 真的调了脱敏）。
 *
 * 【为什么需要】只测 `redactSensitive` 本身，把 `client.ts` 里的调用改回原始 params
 * 所有测试仍然全绿——凭据会重新以明文落进文件日志。这里用真实日志 sink 捕获
 * `rpc call` / `contract violation` 两条记录，断言密文不出现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HermesGatewayClient } from '../../dist/rpc/client.js';
import { addLogSink } from '../../dist/log/logger.js';

function capture() {
  const records = [];
  const off = addLogSink((record) => { records.push(record); }, 'trace');
  return { records, off };
}

function makeClient() {
  return new HermesGatewayClient({ url: 'ws://127.0.0.1:1', autoConnect: false, enableHeartbeat: false });
}

test('model.save_key 的调试日志不得出现明文 API Key', async () => {
  const { records, off } = capture();
  const client = makeClient();
  try {
    await client.call('model.save_key', { slug: 'openrouter', api_key: 'sk-live-plaintext' }).catch(() => {});
  } finally {
    off();
  }
  const text = JSON.stringify(records);
  assert.equal(text.includes('sk-live-plaintext'), false, '明文 API Key 不得进入任何日志记录');
  const callRecord = records.find((record) => record.message === 'rpc call');
  assert.ok(callRecord, '必须产生 rpc call 日志');
  assert.equal(callRecord.data.params.api_key, '[REDACTED]');
  assert.equal(callRecord.data.params.slug, 'openrouter');
});

test('契约违规的 error 日志同样不得出现明文凭据', async () => {
  const { records, off } = capture();
  const client = makeClient();
  try {
    await client
      .call('model.save_key', { slug: 'openrouter', api_key: 'sk-live-plaintext', bogus_field: 1 })
      .catch(() => {});
  } finally {
    off();
  }
  const violation = records.find((record) => record.message === 'contract violation');
  assert.ok(violation, '未登记的字段必须触发契约违规日志');
  assert.equal(JSON.stringify(violation).includes('sk-live-plaintext'), false);
  assert.equal(violation.data.params.api_key, '[REDACTED]');
});

test('mcp.servers.set_api_key 的 value 属于凭据，必须按 method 脱敏', async () => {
  const { records, off } = capture();
  const client = makeClient();
  try {
    await client
      .call('mcp.servers.set_api_key', { profile: 'default', name: 'github', value: 'sk-live-plaintext' })
      .catch(() => {});
  } finally {
    off();
  }
  const text = JSON.stringify(records);
  assert.equal(text.includes('sk-live-plaintext'), false);
  const callRecord = records.find((record) => record.message === 'rpc call');
  assert.equal(callRecord.data.params.value, '[REDACTED]');
  assert.equal(callRecord.data.params.name, 'github');
});
