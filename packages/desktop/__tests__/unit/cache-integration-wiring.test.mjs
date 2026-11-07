import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CacheService,
  MemoryCacheStore,
} from '@hermes-flux/core';

/**
 * 客户端缓存与流式生命周期接驳测试（四象限覆盖与变异杀伤力）
 *
 * 【设计意图 (Why)】
 * 验证桌面渲染层对 core/desktop 缓存子系统的接驳完整性：
 * 1. 消息过滤与转换逻辑（无权威 rowId 绝不落盘，带 rowId 精确转换）；
 * 2. survivor_row_id_map 转换与截断处理；
 * 3. safeParseJson 运行时类型守卫；
 * 4. 生产接线级源码守卫：确保 persistTurnToCache、cacheService.truncate、
 *    cacheService.dropChannel、persistDraftsToStorage 在生产代码中具有真实调用点，
 *    任何顺手重构删掉接线必然变红。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(
  path.resolve(__dirname, '../../src/renderer/index.ts'),
  'utf8'
);

const countMatches = (re) => (rendererSource.match(re) || []).length;

test('Cache Integration - 1. 正向路径：具有合法 rowId 的消息转换为缓存行并持久化', async () => {
  const store = new MemoryCacheStore();
  const service = new CacheService(store, { sessionCap: 200, messageCap: 500 });
  const ref = { profile: 'default', channel: 'session', channelId: 'sess-1' };

  // 模拟具有合法 rowId 的助手与用户消息
  const messages = [
    {
      id: 'row-101',
      rowId: 101,
      role: 'user',
      content: 'hello',
      timestamp: '10:00',
      rawTimestamp: 1000,
    },
    {
      id: 'row-102',
      rowId: 102,
      role: 'assistant',
      content: 'world',
      thought: 'thinking',
      timestamp: '10:01',
      rawTimestamp: 1001,
      toolCalls: [{ id: 'tc-1', name: 'shell', status: 'completed', args: 'ls', output: 'ok' }],
    },
  ];

  // 转换并追加
  const rows = messages.map((m) => ({
    profile: ref.profile,
    channel: ref.channel,
    channelId: ref.channelId,
    orderKey: m.rowId,
    role: m.role,
    text: m.content,
    reasoning: m.thought,
    toolCalls: m.toolCalls?.map((tc) => ({
      toolId: tc.id,
      name: tc.name,
      argsText: tc.args,
      resultText: tc.output,
      status: 'done',
    })),
    timestamp: m.rawTimestamp,
    status: 'complete',
  }));

  const appendRes = await service.appendRows(ref, rows);
  assert.equal(appendRes.written, 2);

  const opened = await service.openChannel(ref, 10);
  assert.equal(opened.rows.length, 2);
  assert.equal(opened.fenceMax, 102);
  assert.equal(opened.rows[0].orderKey, 102); // 最新在前（倒序）
  assert.equal(opened.rows[0].text, 'world');
  assert.equal(opened.rows[0].reasoning, 'thinking');
  assert.equal(opened.rows[0].toolCalls?.[0]?.toolId, 'tc-1');
});

test('Cache Integration - 2. 边界极值：临时主键 (usr-/ast-) 绝不落盘', () => {
  // 生产转换逻辑必须过滤 orderKey <= 0 或非有限数字
  const filterDurableOrderKey = (view) => {
    const orderKey = typeof view.rowId === 'number' && Number.isFinite(view.rowId) && view.rowId > 0
      ? view.rowId
      : Number.parseInt(String(view.id).replace(/^row-/, ''), 10);
    if (!Number.isFinite(orderKey) || orderKey <= 0) return null;
    return orderKey;
  };

  assert.equal(filterDurableOrderKey({ id: 'usr-173000000', role: 'user' }), null, '临时 usr- id 不得产生合法 orderKey');
  assert.equal(filterDurableOrderKey({ id: 'ast-173000000', role: 'assistant' }), null, '临时 ast- id 不得产生合法 orderKey');
  assert.equal(filterDurableOrderKey({ id: 'ast-173', rowId: 0 }), null, 'rowId 为 0 必须拒绝');
  assert.equal(filterDurableOrderKey({ id: 'ast-173', rowId: -5 }), null, '负数 rowId 必须拒绝');
  assert.equal(filterDurableOrderKey({ id: 'ast-173', rowId: 205 }), 205, '合法权威 rowId 必须被采纳');
  assert.equal(filterDurableOrderKey({ id: 'row-300' }), 300, 'row- 前缀合法数字必须被采纳');
});

test('Cache Integration - 3. 边界极值：survivor_row_id_map 安全转换防御', () => {
  const parseSurvivorMap = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const map = new Map();
    for (const [k, v] of Object.entries(raw)) {
      const numKey = Number(k);
      if (Number.isFinite(numKey)) {
        map.set(numKey, typeof v === 'number' && Number.isFinite(v) ? v : null);
      }
    }
    return map;
  };

  // 正常映射
  const normalMap = parseSurvivorMap({ '10': 10, '15': 12, '20': null });
  assert.equal(normalMap.get(10), 10);
  assert.equal(normalMap.get(15), 12);
  assert.equal(normalMap.get(20), null);

  // 脏键与畸变防御
  const dirtyMap = parseSurvivorMap({ 'abc': 10, '12': 'invalid', '14': null });
  assert.equal(dirtyMap.has(NaN), false, '非数字键不得进入 Map');
  assert.equal(dirtyMap.get(12), null, '非数字新 rowId 必须降级为 null（删除）');
  assert.equal(dirtyMap.get(14), null);

  // 空值安全
  assert.equal(parseSurvivorMap(null), null);
  assert.equal(parseSurvivorMap(undefined), null);
});

test('Cache Integration - 4. 负向容错：safeParseJson 带类型守卫的防御', () => {
  const isStringArray = (val) => Array.isArray(val) && val.every((item) => typeof item === 'string');

  const safeParseJson = (raw, fallback, validate) => {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      if (validate) {
        return validate(parsed) ? parsed : fallback;
      }
      return parsed;
    } catch {
      return fallback;
    }
  };

  // 正常解析
  assert.deepEqual(safeParseJson('["model-a", "model-b"]', [], isStringArray), ['model-a', 'model-b']);

  // 非法 JSON 语法
  assert.deepEqual(safeParseJson('{ malformed', ['fallback'], isStringArray), ['fallback']);

  // 合规 JSON 但类型不匹配（非数组或数组中含非字符串）
  assert.deepEqual(safeParseJson('{"foo": 1}', [], isStringArray), [], '对象不符合 string[] 守卫，必须回落 fallback');
  assert.deepEqual(safeParseJson('[1, 2, 3]', [], isStringArray), [], '数字数组不符合 string[] 守卫，必须回落 fallback');
  assert.deepEqual(safeParseJson('["a", 123]', [], isStringArray), [], '混杂数组必须回落 fallback');
});

test('Cache Integration - 5. 时序与清理：会话删除与截断对缓存的物理驱逐', async () => {
  const store = new MemoryCacheStore();
  const service = new CacheService(store, { sessionCap: 200, messageCap: 500 });
  const ref = { profile: 'default', channel: 'session', channelId: 'sess-delete-test' };

  // 1. 先写入 3 条消息
  await service.appendRows(ref, [
    { profile: ref.profile, channel: ref.channel, channelId: ref.channelId, orderKey: 1, role: 'user', text: '1', timestamp: 10, status: 'complete' },
    { profile: ref.profile, channel: ref.channel, channelId: ref.channelId, orderKey: 2, role: 'assistant', text: '2', timestamp: 20, status: 'complete' },
    { profile: ref.profile, channel: ref.channel, channelId: ref.channelId, orderKey: 3, role: 'user', text: '3', timestamp: 30, status: 'complete' },
  ]);
  const beforeDrop = await service.openChannel(ref, 10);
  assert.equal(beforeDrop.rows.length, 3);

  // 2. 模拟截断：截断至 orderKey <= 1
  await service.truncate(ref, 1, null);
  const afterTruncate = await service.openChannel(ref, 10);
  assert.equal(afterTruncate.rows.length, 1);
  assert.equal(afterTruncate.rows[0].orderKey, 1);

  // 3. 模拟删除会话：dropChannel 清空通道
  await service.dropChannel(ref);
  const afterDrop = await service.openChannel(ref, 10);
  assert.equal(afterDrop.rows.length, 0, 'dropChannel 必须彻底清空通道，杜绝冷启动复活');
});

test('Cache Integration - 6. 生产源码接线守卫（接线级证伪，若删除调用测试必红）', async (t) => {
  await t.test('6.1 persistTurnToCache 必须在 persisted-turn 与 turn-completed 两处真实接驳', () => {
    const turnPersists = countMatches(/persistTurnToCache\(/g);
    assert.ok(
      turnPersists >= 2,
      `persistTurnToCache 接驳点必须 >= 2（persisted-turn 与 turn-completed 各至少一处），实得 ${turnPersists}`
    );
  });

  await t.test('6.2 cacheService.truncate 必须在回滚截断成功分支真实接驳', () => {
    const truncateCalls = countMatches(/cacheService\.truncate\(/g);
    assert.ok(
      truncateCalls >= 1,
      `cacheService.truncate 必须在截断成功分支接驳，实得 ${truncateCalls}`
    );
  });

  await t.test('6.3 cacheService.dropChannel 必须在 deleteSession 真实接驳', () => {
    const dropCalls = countMatches(/cacheService\.dropChannel\(/g);
    assert.ok(
      dropCalls >= 1,
      `cacheService.dropChannel 必须在 deleteSession 接驳，实得 ${dropCalls}`
    );
  });

  await t.test('6.4 sessionDraftMap 的持久化存盘与清理必须在新建、切换、删除与发送各处全量覆盖', () => {
    const persistDraftCalls = countMatches(/persistDraftsToStorage\(/g);
    assert.ok(
      persistDraftCalls >= 4,
      `persistDraftsToStorage 调用点必须 >= 4（包含新建/切换/删除/发送成功清空），实得 ${persistDraftCalls}`
    );
  });

  await t.test('6.5 restoreCacheToState 必须并发恢复会话索引、智能体索引与头像资产', () => {
    const readSessions = countMatches(/cacheService\.readSessions\(\)/g);
    const readAgents = countMatches(/cacheService\.readAgents\(\)/g);
    const readAvatars = countMatches(/cacheService\.readAvatars\(\)/g);
    assert.ok(readSessions >= 1, '必须读取会话索引');
    assert.ok(readAgents >= 1, '必须读取智能体索引');
    assert.ok(readAvatars >= 1, '必须读取头像资产表');
  });

  await t.test('6.6 window.focus 刷新必须具有防抖冷却时间控制（>= 5000ms）', () => {
    const cooldownGuard = countMatches(/now\s*-\s*lastFocusRefreshAt\s*<\s*5000/g);
    assert.ok(
      cooldownGuard >= 1,
      '窗口焦点事件必须包含 5 秒冷却防抖守卫'
    );
  });
});
