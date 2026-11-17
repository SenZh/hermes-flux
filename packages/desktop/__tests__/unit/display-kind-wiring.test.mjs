import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 【反 AI 假测试门禁 (Gate 2)】真实导入生产构建产物。
import { findPreviousUserPrompt } from '../../dist/renderer/messageActions.mjs';
import { bindTurnRowIds } from '../../dist/renderer/rollbackTransaction.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const renderCoordPath = path.resolve(__dirname, '../../src/renderer/renderCoordinator.ts');
const rendererSource = [
  readFileSync(path.resolve(__dirname, '../../src/renderer/index.ts'), 'utf8'),
  existsSync(renderCoordPath) ? readFileSync(renderCoordPath, 'utf8') : '',
].join('\n');

/**
 * display_kind 接线守卫（宿主编排层）
 *
 * 【设计意图 (Why)】
 *   行翻译逻辑本身由 transcript-rows.test.mjs 做行为级覆盖（真实导入 dist，变异必红）。
 *   本文件只守 renderer 入口里那几处无法单独导出的编排接线：快照缓存键、末条判定、
 *   翻页过滤、左侧栏预览、导出。这些地方改错不会让任何纯函数测试变红。
 *
 * 【约束与规则 (Rules)】
 *   断言必须是**精确到整行**的契约字符串，任何对语义的改写都要让它变红；
 *   禁止使用宽松正则（历史上这类断言在 5 个真实业务变异下全部保持绿灯）。
 */

test('display_kind 宿主编排接线（精确字符串契约）', async (t) => {
  await t.test('1. 快照缓存键必须同时比对 displayKind 与 displayMetadata', () => {
    const start = rendererSource.indexOf('const cached = conversationVmCache.get(m);');
    const block = rendererSource.slice(start, start + 420);
    assert.ok(
      block.includes('&& cached.displayKind === displayKind') && block.includes('&& cached.displayMetadata === m.displayMetadata)'),
      '缓存命中条件必须同时比对 kind 与 metadata，否则同文本不同元数据会命中旧对象'
    );
    const writeStart = rendererSource.indexOf('conversationVmCache.set(m, {');
    const writeBlock = rendererSource.slice(writeStart, writeStart + 400);
    assert.ok(
      writeBlock.includes('displayKind,') && writeBlock.includes('displayMetadata: m.displayMetadata,'),
      '缓存写入必须同时落 kind 与 metadata'
    );
  });

  await t.test('2. 末条判定必须跳过不上屏的行（统一口径 helper）', () => {
    // 【统一口径 (Why)】hidden 行不上屏，末条判定必须跳过它；且快照的 isLastInTurn/流式态
    //   与进入会话的探针 id 必须共用同一实现。历史上两处各写一套，导致探针指向 hidden 行、
    //   DOM 里没有该 [data-msg-id]，进入计划整段静默空转。
    //
    // 【行尾归一 (Rules)】本机 `core.autocrlf=true` 会把工作区源码检出为 CRLF，而仓库索引与
    //   CI 检出为 LF：跨行契约串若直接对原始文本匹配，同一守卫在本机恒红、在 CI 恒绿。
    //   因此对归一后的投影匹配（只抹平 CR，不抹平任何字符与缩进），契约强度不变且两侧等价。
    const sourceLf = rendererSource.replace(/\r\n/g, '\n');
    assert.ok(
      sourceLf.includes("    const kind = messages[i].displayKind ?? 'user';\n    if (kind !== 'hidden') return messages[i].id;"),
      '倒序查找必须比较 displayKind 并跳过 hidden'
    );
    assert.ok(
      sourceLf.includes('const lastMessageId = lastVisibleMessageId(windowedMessages);'),
      '快照末条必须走统一 helper'
    );
    assert.ok(
      sourceLf.includes("lastVisibleMessageId(state.messages) ?? ''"),
      '进入计划的探针必须走统一 helper，严禁直接取 state.messages 原始末条'
    );
    assert.ok(
      !sourceLf.includes('state.messages[state.messages.length - 1].id'),
      '严禁保留直接取原始末条的实现'
    );
  });

  await t.test('3. 翻页过滤不得删 hidden 行（行序守恒）', () => {
    const msgLoadPath = path.resolve(__dirname, '../../src/renderer/services/messageLoadingService.ts');
    const targetSrc = existsSync(msgLoadPath) ? readFileSync(msgLoadPath, 'utf8') : rendererSource;
    const start = targetSrc.indexOf('const payload = outcome.messages.filter((m');
    const block = targetSrc.slice(start, start + 400);
    assert.ok(block.length > 0, '必须能定位到翻页过滤区段');
    assert.ok(
      !block.includes("if (m.display_kind === 'hidden') return false;"),
      '翻页时删掉 hidden 行会让本地数组与服务端数组失去逐行对应，fork 切点与 offset 漂移'
    );
    assert.ok(
      block.includes('if (typeof m.display_kind === \'string\' && m.display_kind.length > 0) return true;'),
      '有 kind 的行必须无条件保留，只对 kind 缺失的存量行做前缀兜底'
    );
  });

  await t.test('4. 左侧栏预览与 Bot 反哺只取真实人类正文', () => {
    const msgLoadPath = path.resolve(__dirname, '../../src/renderer/services/messageLoadingService.ts');
    const targetSrc = existsSync(msgLoadPath) ? readFileSync(msgLoadPath, 'utf8') : rendererSource;
    const start = targetSrc.indexOf('syncActiveSessionPreviewToRail(sessionId: string');
    const block = targetSrc.slice(start, start + 1600);
    assert.ok(
      block.includes("const visibleMessages = messages.filter((m) => (m.displayKind ?? 'user') === 'user');"),
      '预览必须只用可上屏的人类行，否则副标题会显示 [System:] 或后台回执'
    );
    assert.ok(
      block.includes('const lastMsg = visibleMessages[visibleMessages.length - 1];'),
      '必须从过滤后的列表取末条'
    );
  });

  await t.test('5. 导出口径与视图一致：hidden 不导出，事件单独标注', () => {
    const sessionOpPath = path.resolve(__dirname, '../../src/renderer/services/sessionOperationService.ts');
    const targetSrc = existsSync(sessionOpPath) ? readFileSync(sessionOpPath, 'utf8') : rendererSource;
    const start = targetSrc.indexOf('exportMarkdown(');
    const block = targetSrc.slice(start, start + 900);
    assert.ok(
      block.includes(".filter((m) => (m.displayKind ?? 'user') !== 'hidden')"),
      'hidden 行不得导出成 ### User'
    );
    assert.ok(
      block.includes('`### Event (${kind})`'),
      '时间线事件必须标注为 Event，不能冒充用户发言'
    );
  });

  await t.test('6. 持久层回读必须窄化，禁止裸 as 断言', () => {
    const cacheBridgePath = path.resolve(__dirname, '../../src/renderer/cache/desktopCacheBridge.ts');
    const targetSource = existsSync(cacheBridgePath) ? readFileSync(cacheBridgePath, 'utf8') : rendererSource;
    assert.ok(
      targetSource.includes("displayKind: isKnownDisplayKind(row.displayKind) ? row.displayKind : 'user',"),
      'IndexedDB 是不可信来源，非法 kind 必须回落 user'
    );
    assert.ok(
      !targetSource.includes("displayKind: (row.displayKind as MessageDisplayKind | undefined) ?? 'user',"),
      '严禁用 as 断言把未知值带进下游分派'
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
    assert.equal(findPreviousUserPrompt('a2', base), '真正的第一问');
  });

  await t.test('普通会话行为不变', () => {
    assert.equal(findPreviousUserPrompt('a1', base), '真正的第一问');
  });

  await t.test('无更早真实用户行时返回 null，不得回退到机器行', () => {
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
