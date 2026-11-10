import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 【反 AI 假测试门禁 (Gate 2)】真实导入生产构建模块，禁止在测试内自造假闭包。
import { findPreviousUserPrompt } from '../../dist/renderer/messageActions.mjs';
import { bindTurnRowIds } from '../../dist/renderer/rollbackTransaction.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(path.resolve(__dirname, '../../src/renderer/index.ts'), 'utf8');

/**
 * display_kind 接线守卫
 *
 * 【设计意图 (Why)】
 *   判别逻辑本身由 core 的 projectDisplay 单测覆盖；本文件守的是"接线"：
 *   字段有没有真的从网关行搬进视图模型、有没有真的落进缓存、回滚有没有被机器行污染。
 *   这些是单测最能防回归、又最容易被后续重构悄悄删掉的地方。
 *
 * 【约束与规则 (Rules)】
 *   断言精确到调用语法特征，任何一处退化必须使测试变红。
 */

test('display_kind 接线守卫', async (t) => {
  await t.test('1. parseRawMessages 必须调用 projectDisplay，且把 kind 与 metadata 搬进视图模型', () => {
    assert.ok(
      /const projection = projectDisplay\(\{/.test(rendererSource),
      'parseRawMessages 必须调用 projectDisplay 做唯一判别'
    );
    assert.ok(
      /displayKind: projection\.kind,/.test(rendererSource),
      '投影结果必须写进 MessageViewModel.displayKind'
    );
    assert.ok(
      /displayMetadata: projection\.metadata,/.test(rendererSource),
      '投影结果必须写进 MessageViewModel.displayMetadata'
    );
  });

  await t.test('2. 行序守恒：空正文守卫必须先判 kind，只有 user 行才允许丢弃', () => {
    const guardStart = rendererSource.indexOf('const hasContent = Boolean(rawText && rawText.trim());');
    const tail = rendererSource.slice(guardStart);
    const guardBlock = tail.slice(0, tail.indexOf('const rawTs = m.timestamp ?? m.created_at;'));
    assert.ok(guardBlock.length > 0, '必须能定位到 parseRawMessages 的空正文守卫区段');
    assert.ok(
      /projection\.kind === 'user' && rawRole !== 'assistant' && !hasContent/.test(guardBlock),
      "空正文守卫必须写成「且 kind 为 user」，否则 hidden 行被删，fork 切点与分页 offset 漂移"
    );
    assert.ok(
      !/if \(rawRole !== 'assistant' && !hasContent\) \{\s*continue;/.test(guardBlock),
      '严禁保留不看 kind 的裸空正文守卫'
    );
  });

  await t.test('3. 缓存往返：两个字段必须落盘并还原', () => {
    assert.ok(
      /displayKind: view\.displayKind,/.test(rendererSource) && /displayMetadata: view\.displayMetadata,/.test(rendererSource),
      'toCachedMessage 必须写入两个字段，否则冷启动机器行会重新画成用户气泡'
    );
    assert.ok(
      /displayKind: \(row\.displayKind as MessageDisplayKind \| undefined\) \?\? 'user',/.test(rendererSource),
      'toMessageViewModel 必须还原 displayKind 并回落到 user'
    );
    assert.ok(
      /displayMetadata: row\.displayMetadata,/.test(rendererSource),
      'toMessageViewModel 必须还原 displayMetadata'
    );
  });

  await t.test('4. 快照缓存键必须包含 displayKind，否则同文本不同 kind 命中旧对象', () => {
    assert.ok(
      /&& cached\.displayKind === displayKind\)/.test(rendererSource),
      'conversationVmCache 命中条件必须比较 displayKind'
    );
    assert.ok(
      /displayKind,\s*\n\s*\}\);/.test(rendererSource),
      'conversationVmCache 写入时必须带 displayKind'
    );
  });

  await t.test('5. lastMessageId 必须跳过不上屏的行', () => {
    assert.ok(
      /if \(kind !== 'hidden'\) return windowedMessages\[i\]\.id;/.test(rendererSource),
      '末条若是 hidden，真正可见的最后一条必须拿到 isLastInTurn 与流式态'
    );
    assert.ok(
      !/const lastMessageId = windowedMessages\[windowedMessages\.length - 1\]\?\.id;/.test(rendererSource),
      '严禁保留直接取窗口末条的实现'
    );
  });

  await t.test('6. 翻页压缩过滤必须优先看 kind', () => {
    assert.ok(
      /if \(m\.display_kind === 'hidden'\) return false;/.test(rendererSource),
      'loadOlderMessages 必须优先用 display_kind 判定压缩交接行'
    );
    assert.ok(
      /return !text\.startsWith\('\[CONTEXT COMPACTION'\);/.test(rendererSource),
      'kind 缺失时必须保留 [CONTEXT COMPACTION 前缀兜底，兼容存量会话'
    );
  });

  await t.test('7. 左侧栏预览只取真实人类正文', () => {
    const block = rendererSource.slice(
      rendererSource.indexOf('function syncActiveSessionPreviewToRail'),
      rendererSource.indexOf('function syncActiveSessionPreviewToRail') + 1600
    );
    assert.ok(
      /const visibleMessages = messages\.filter\(\(m\) => \(m\.displayKind \?\? 'user'\) === 'user'\);/.test(block),
      '预览与 Bot 反哺必须只用可上屏的人类行'
    );
    assert.ok(
      /const lastMsg = visibleMessages\[visibleMessages\.length - 1\];/.test(block),
      '必须从过滤后的列表取末条'
    );
  });
});

test('findPreviousUserPrompt 必须跳过机器行', async (t) => {
  const base = [
    { id: 'u1', rowId: 1, role: 'user', content: '真正的第一问' },
    { id: 'a1', role: 'assistant', content: '回答一' },
    { id: 'u2', rowId: 2, role: 'user', content: '[OUT-OF-BAND USER MESSAGE]steer 原文', displayKind: 'steer' },
    { id: 'a2', role: 'assistant', content: '回答二' },
  ];

  await t.test('steer 行不得被当成上一轮用户提问回填进输入框', () => {
    const got = findPreviousUserPrompt('a2', base);
    assert.equal(got, '真正的第一问', '必须跳过 displayKind=steer 的机器行');
  });

  await t.test('普通会话行为不变', () => {
    assert.equal(findPreviousUserPrompt('a1', base), '真正的第一问');
  });

  await t.test('无更早用户行时返回 null，不得回退到机器行', () => {
    const onlyMachine = [
      { id: 'u1', rowId: 1, role: 'user', content: '[System: model changed]', displayKind: 'model_switch' },
      { id: 'a1', role: 'assistant', content: '回答' },
    ];
    assert.equal(findPreviousUserPrompt('a1', onlyMachine), null);
  });
});

test('bindTurnRowIds 不得把 user_row_id 绑到机器行', async (t) => {
  await t.test('最近一条 role=user 是 steer 行时必须继续向前找真实提问', () => {
    const messages = [
      { id: 'u1', rowId: 11, role: 'user', content: '真实提问' },
      { id: 'a1', rowId: 12, role: 'assistant', content: '回答' },
      { id: 'u2', role: 'user', content: '[OUT-OF-BAND]插话', displayKind: 'steer' },
      { id: 'a2', role: 'assistant', content: '' },
    ];
    const changed = bindTurnRowIds({
      messages,
      assistantMessageId: 'a2',
      assistantRowId: 21,
      userRowId: 20,
    });
    assert.equal(changed, true);
    assert.equal(messages[0].rowId, 20, 'user_row_id 必须绑到真实提问行');
    assert.equal(messages[2].rowId, undefined, 'steer 行不得被绑定');
  });

  await t.test('没有真实提问行时不得污染任何机器行', () => {
    const messages = [
      { id: 'u1', role: 'user', content: '[System: model changed]', displayKind: 'model_switch' },
      { id: 'a1', role: 'assistant', content: '' },
    ];
    bindTurnRowIds({ messages, assistantMessageId: 'a1', assistantRowId: 9, userRowId: 8 });
    assert.equal(messages[0].rowId, undefined, 'model_switch 行不得拿到回滚锚点');
  });
});
