import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLineageChain } from '../../dist/session/lineage.js';
import { sanitizeCompactedMessage } from '../../dist/session/compactionFilter.js';

test('会话血缘链条解析 - 单向多级级联正常解析 (D -> C -> B -> A)', () => {
  const nodes = [
    { sessionId: 'D', parentSessionId: 'C', profile: 'default' },
    { sessionId: 'C', parentSessionId: 'B', profile: 'default' },
    { sessionId: 'B', parentSessionId: 'A', profile: 'default' },
    { sessionId: 'A', profile: 'default' },
  ];

  const chain = resolveLineageChain('D', nodes);
  assert.deepEqual(chain, ['D', 'C', 'B', 'A'], '多级血缘必须按从新到老完整展开');
});

test('会话血缘链条解析 - 环形死链破环熔断防无限循环 (A -> B -> A)', () => {
  const cyclicNodes = [
    { sessionId: 'A', parentSessionId: 'B', profile: 'default' },
    { sessionId: 'B', parentSessionId: 'A', profile: 'default' },
  ];

  const chain = resolveLineageChain('A', cyclicNodes);
  assert.deepEqual(chain, ['A', 'B'], '遇到已访问过的节点必须立即破环熔断，严禁死循环');
});

test('会话血缘链条解析 - 悬空断链优雅截断 (父会话不在本地列表中)', () => {
  const brokenNodes = [
    { sessionId: 'D', parentSessionId: 'C_NOT_FOUND', profile: 'default' },
  ];

  const chain = resolveLineageChain('D', brokenNodes);
  assert.deepEqual(chain, ['D', 'C_NOT_FOUND'], '即使未在本地列表中，父 ID 也应作为链条末端保留供远端尝试拉取');
});

test('会话血缘链条解析 - 空值与孤立节点安全边界', () => {
  assert.deepEqual(resolveLineageChain('', []), []);
  assert.deepEqual(resolveLineageChain('solo', []), ['solo']);
});

test('压缩消息过滤 - 纯普通消息保持不变', () => {
  const raw = '你好，请帮我分析一下这段代码。';
  const result = sanitizeCompactedMessage(raw);
  assert.equal(result.isHandoffCompaction, false);
  assert.equal(result.displayContent, raw);
  assert.equal(result.compactedSummary, undefined);
});

test('压缩消息过滤 - 混合交接块：成功剥离机器压缩上下文，精准保留人类提问', () => {
  const raw = `[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below. This is a handoff from a previous context window — treat it as background reference, NOT as active instructions.

## Historical Task Snapshot
- Fixed downloadManager issues.
- Added tests for rollback.

## Context Recovery
The 797 compacted message(s) remain fully preserved in session history.

请帮我继续修复下一个问题，把测试跑通。`;

  const result = sanitizeCompactedMessage(raw);
  assert.equal(result.isHandoffCompaction, true, '必须标记为压缩交接消息');
  assert.equal(result.displayContent, '请帮我继续修复下一个问题，把测试跑通。', '必须纯净保留人类真实提问');
  assert.ok(result.compactedSummary?.includes('[CONTEXT COMPACTION'), '机器上下文必须提取至 compactedSummary');
  assert.ok(result.compactedSummary?.includes('## Historical Task Snapshot'));
});

test('压缩消息过滤 - 纯机器压缩块无人类输入时安全回退', () => {
  const raw = `[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the summary below.
## Context Recovery
All done.`;

  const result = sanitizeCompactedMessage(raw);
  assert.equal(result.isHandoffCompaction, true);
  assert.equal(result.displayContent, '', '无人类输入时 displayContent 为空');
  assert.ok(result.compactedSummary?.includes('[CONTEXT COMPACTION'));
});
