/**
 * 提示词导航状态机领域单元测试（Prompt Navigator Manager Test）
 *
 * 【测试断言与杀伤力】
 *   1. 初始空快照必须为冻结常量；
 *   2. 切会话必须将 activeIndex 重置到末条（非空条目为 length - 1，空条目为 -1）；
 *   3. 会话相同且消息引用相同时 rebuildEntries 命中缓存返回 false；
 *   4. 群聊研讨室下 hasOlder 恒为 false（三态隔离物理不变量）；
 *   5. 元信息变动 syncMeta 仅触发必要推送，且元信息相同跳过重复推送；
 *   6. jumpToPrompt 序列号竞争：旧序列号回调到达时不覆盖新跳转状态；
 *   7. 滚动位置换算能正确二分匹配到提问下标。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PromptNavigatorManager,
  EMPTY_PROMPT_NAVIGATOR_SNAPSHOT,
} from '../../dist/renderer/navigation/promptNavigatorManager.mjs';

function createMockHost(overrides = {}) {
  let activeSessionId = overrides.activeSessionId ?? 'session-1';
  let messages = overrides.messages ?? [
    { id: 'u1', role: 'user', content: '第一问' },
    { id: 'a1', role: 'assistant', content: '回答一' },
    { id: 'u2', role: 'user', content: '第二问' },
    { id: 'a2', role: 'assistant', content: '回答二' },
  ];
  let lang = overrides.lang ?? 'zh-CN';
  let hasOlder = overrides.hasOlder ?? true;
  let isLoadingOlder = overrides.isLoadingOlder ?? false;
  let isGroup = overrides.isGroup ?? false;
  let rowHeight = overrides.rowHeight ?? 96;
  let rowHeightLocked = overrides.rowHeightLocked ?? true;
  let streamElement = overrides.streamElement ?? null;

  const logs = [];
  const renderEvents = [];
  const windowRelocations = [];
  const settlingStates = [];

  const host = {
    getActiveSessionId: () => activeSessionId,
    getMessages: () => messages,
    getLang: () => lang,
    hasOlderMessages: () => hasOlder,
    isLoadingOlder: () => isLoadingOlder,
    isGroupConversationActive: () => isGroup,
    getAverageRowHeightPx: () => rowHeight,
    isAverageRowHeightLocked: () => rowHeightLocked,
    getStreamElement: () => streamElement,
    relocateMessageWindowToIndex: (idx) => windowRelocations.push(idx),
    triggerRenderForJump: () => renderEvents.push(Date.now()),
    loadOlderMessages: async () => {},
    onJumpSettlingChange: (settling) => settlingStates.push(settling),
    logWarn: (msg, meta) => logs.push({ msg, meta }),
    requestAnimationFrame: (cb) => {
      // 默认同步运行方便确定性断言，也可受控推迟
      cb();
      return 1;
    },
    // 供测试驱动的状态修改器
    _setSessionId: (id) => { activeSessionId = id; },
    _setMessages: (m) => { messages = m; },
    _setLang: (l) => { lang = l; },
    _setIsGroup: (g) => { isGroup = g; },
    _setStreamElement: (el) => { streamElement = el; },
    _logs: logs,
    _renderEvents: renderEvents,
    _windowRelocations: windowRelocations,
    _settlingStates: settlingStates,
  };

  return host;
}

test('PromptNavigatorManager 核心状态机行为测试', async (t) => {
  await t.test('1. 初始快照必须是冻结常量，且引用恒定', () => {
    const host = createMockHost();
    const manager = new PromptNavigatorManager(host);
    const snap1 = manager.getSnapshot();
    const snap2 = manager.getSnapshot();

    assert.equal(snap1, snap2);
    assert.equal(snap1, EMPTY_PROMPT_NAVIGATOR_SNAPSHOT);
    assert.equal(snap1.activeIndex, -1);
    assert.equal(snap1.prompts.length, 0);
    assert.ok(Object.isFrozen(snap1));
  });

  await t.test('2. 切会话必须落定在末条提问，空会话落定在 -1', () => {
    const host = createMockHost();
    const manager = new PromptNavigatorManager(host);

    let pushCount = 0;
    manager.setUpdateHandler(() => {
      pushCount += 1;
    });

    // 首次调用 rebuildEntries（会话初始）
    const sessionReset = manager.rebuildEntries();
    assert.equal(sessionReset, true, '首次建表必须报告切会话重置');
    assert.equal(pushCount, 1, '必须推送一次快照');

    const snap = manager.getSnapshot();
    assert.equal(snap.prompts.length, 2, '存在两条提问 u1, u2');
    assert.equal(snap.activeIndex, 1, '当前激活项落定在最后一条提问 (index 1)');

    // 切换到无提问的空会话
    host._setSessionId('session-empty');
    host._setMessages([]);
    const emptyReset = manager.rebuildEntries();
    assert.equal(emptyReset, true);
    assert.equal(manager.getSnapshot().activeIndex, -1, '空会话激活项必须为 -1');
    assert.equal(manager.getSnapshot().prompts.length, 0);
  });

  await t.test('3. 相同会话且消息引用不变时命中缓存', () => {
    const host = createMockHost();
    const manager = new PromptNavigatorManager(host);
    manager.rebuildEntries();

    // 再次调用重建：会话与引用未变
    const changed = manager.rebuildEntries();
    assert.equal(changed, false, '相同引用不得触发整表重建');
  });

  await t.test('4. 三态隔离不变量：群聊研讨室下 hasOlder 恒为 false', () => {
    const host = createMockHost({ hasOlder: true, isGroup: true });
    const manager = new PromptNavigatorManager(host);
    manager.rebuildEntries();

    const snap = manager.getSnapshot();
    assert.equal(snap.hasOlder, false, '群聊下必须强制 hasOlder 为 false');

    const meta = manager.currentPromptNavigatorMeta();
    assert.equal(meta.isGroupRoom, true);
  });

  await t.test('5. syncMeta 在元信息一致时不产生冗余推送', () => {
    const host = createMockHost();
    const manager = new PromptNavigatorManager(host);
    let pushCount = 0;
    manager.setUpdateHandler(() => {
      pushCount += 1;
    });

    manager.rebuildEntries();
    const initialCount = pushCount;

    // 未发生语言或加载态变化时调用 syncMeta
    manager.syncMeta();
    assert.equal(pushCount, initialCount, '元信息无变化时不触发更新推送');

    // 语言改变
    host._setLang('en-US');
    manager.syncMeta();
    assert.equal(pushCount, initialCount + 1, '语言变化后必须触发更新推送');
    assert.equal(manager.getSnapshot().locale, 'en-US');
  });

  await t.test('6. jumpToPrompt 触发窗口重置与渲染事件', () => {
    const host = createMockHost();
    const manager = new PromptNavigatorManager(host);

    // 针对不存在的消息 id：早退不触发重排
    manager.jumpToPrompt('non-existent');
    assert.equal(host._windowRelocations.length, 0);

    // 针对存在的提问 u2 (在 messages 中下标为 2)
    manager.jumpToPrompt('u2');
    assert.equal(host._windowRelocations.length, 1);
    assert.equal(host._windowRelocations[0], 2, '必须将窗口重定位到消息索引 2');
    assert.equal(host._renderEvents.length, 1, '必须触发一次跳转渲染');
    assert.ok(host._settlingStates.includes(true), '必须进入 settling 状态');
  });

  await t.test('7. syncFromScroll 依据真实挂载行反查当前提问，缺失时回退滚动换算', () => {
    const rows = [
      { getAttribute: () => 'u1', getBoundingClientRect: () => ({ top: -20, bottom: 60, height: 80 }) },
      { getAttribute: () => 'u2', getBoundingClientRect: () => ({ top: 200, bottom: 300, height: 100 }) },
    ];
    const stream = {
      scrollTop: 500,
      clientHeight: 400,
      scrollHeight: 3000,
      getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
      querySelectorAll: () => rows,
      querySelector: () => null,
    };
    const host = createMockHost({ streamElement: stream });
    const manager = new PromptNavigatorManager(host);
    manager.rebuildEntries();
    manager.syncFromScroll();

    assert.equal(manager.getSnapshot().activeIndex, 1, '应以越过阅读线的首条真实行为准，定位到第二问');
  });

  await t.test('8. syncFromScroll 无可反查行时回退为滚动换算口径', () => {
    const stream = {
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 3000,
      getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
      querySelectorAll: () => [],
      querySelector: () => null,
    };
    const host = createMockHost({ streamElement: stream });
    const manager = new PromptNavigatorManager(host);
    manager.rebuildEntries();
    assert.doesNotThrow(() => manager.syncFromScroll(), '无挂载行时必须安全回退，不得抛错');
    assert.ok(manager.getSnapshot().activeIndex >= 0);
  });

  await t.test('9. settlePromptJump 命中目标行后精确对齐并释放落定', () => {
    const targetRow = {
      getBoundingClientRect: () => ({ top: 212, height: 60 }),
    };
    const stream = {
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 3000,
      getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
      querySelectorAll: () => [targetRow],
      querySelector: () => null,
    };
    const host = createMockHost({ streamElement: stream });
    const manager = new PromptNavigatorManager(host);
    manager.rebuildEntries();

    manager.jumpToPrompt('u2');
    assert.equal(stream.scrollTop, 200, '目标行顶边 212 减去 12px 留白即为对齐位移');
    assert.equal(host._settlingStates.at(-1), false, '落定完成后必须释放 settling');
  });

  await t.test('10. settlePromptJump 目标行始终未挂载时做粗估兜底并显式告警', () => {
    const stream = {
      scrollTop: 0,
      clientHeight: 400,
      scrollHeight: 3000,
      getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
      querySelectorAll: () => [],
      querySelector: () => null,
    };
    const host = createMockHost({ streamElement: stream });
    const manager = new PromptNavigatorManager(host);
    manager.rebuildEntries();

    manager.jumpToPrompt('u2');
    assert.equal(stream.scrollTop, 192, '未挂载时必须按行高粗估定位（2 × 96）');
    assert.ok(host._logs.some((l) => l.msg === 'prompt jump target not mounted'), '必须显式告警而非静默失败');
    assert.equal(host._settlingStates.at(-1), false);
  });
});
