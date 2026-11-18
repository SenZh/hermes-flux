/**
 * 流式 Token 写入器纯单测 (Token Stream Writer Unit Test)
 * (packages/desktop/__tests__/unit/tokenStreamWriter.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenStreamWriter } from '../../dist/renderer/stream/tokenStreamWriter.mjs';

function createMockDeps(overrides = {}) {
  const state = {
    activeSessionId: 'sess-active',
    messages: [
      { id: 'm1', role: 'assistant', content: 'Hello ', thought: '' },
    ],
    sessions: [
      { id: 'sess-active', preview: '' },
    ],
    activeFocus: { type: 'session', sessionId: 'sess-active' },
    ...(overrides.state || {}),
  };

  const sessionMessagesCache = new Map();
  sessionMessagesCache.set('sess-active', state.messages.map((m) => ({ ...m })));

  const botActivityUpdates = [];
  const botActivityStore = {
    updateLatestActivity: (botName, content, ts) => {
      botActivityUpdates.push({ botName, content, ts });
    },
  };

  const deps = {
    getState: () => state,
    sessionMessagesCache,
    botActivityStore,
    getActiveStreamingStoredSessionId: () => 'sess-active',
    isStreamNearBottom: () => true,
    markProgrammaticScroll: () => {},
    logStream: { trace: () => {} },
    ...(overrides.deps || {}),
  };

  return {
    deps,
    state,
    sessionMessagesCache,
    botActivityUpdates,
  };
}

test('TokenStreamWriter: 能够将增量 token 写入活跃会话 assistant 消息', () => {
  const { deps, state } = createMockDeps();
  const writer = createTokenStreamWriter(deps);

  const flushedMap = new Map();
  flushedMap.set('m1', { content: 'world!', thought: 'pondering' });

  writer.writeFlushedTokens(flushedMap);

  assert.equal(state.messages[0].content, 'Hello world!');
  assert.equal(state.messages[0].thought, 'pondering');
});

test('TokenStreamWriter: 当 targetMsg 与 cachedTarget 为同一内存引用时，严禁重复拼接', () => {
  const sharedMsg = { id: 'm-shared', role: 'assistant', content: 'Start: ', thought: '' };
  const state = {
    activeSessionId: 'sess-1',
    messages: [sharedMsg],
    sessions: [{ id: 'sess-1', preview: '' }],
    activeFocus: { type: 'session', sessionId: 'sess-1' },
  };

  const sessionMessagesCache = new Map();
  // 浅拷贝：数组不同，但元素对象引用完全相同！
  sessionMessagesCache.set('sess-1', [sharedMsg]);

  const deps = {
    getState: () => state,
    sessionMessagesCache,
    botActivityStore: { updateLatestActivity: () => {} },
    getActiveStreamingStoredSessionId: () => 'sess-1',
    isStreamNearBottom: () => true,
    markProgrammaticScroll: () => {},
    logStream: { trace: () => {} },
  };

  const writer = createTokenStreamWriter(deps);
  const flushedMap = new Map();
  flushedMap.set('m-shared', { content: 'ChunkA', thought: 'ThinkingA' });

  writer.writeFlushedTokens(flushedMap);

  assert.equal(sharedMsg.content, 'Start: ChunkA', '同一对象引用必须仅累加一次，严禁出现 ChunkA 重复');
  assert.equal(sharedMsg.thought, 'ThinkingA');
});

test('TokenStreamWriter: 后台会话写入 sessionMessagesCache，不影响当前会话 messages', () => {
  const state = {
    activeSessionId: 'sess-current-viewing',
    messages: [{ id: 'm-current', role: 'user', content: 'Viewing' }],
    sessions: [{ id: 'sess-background-stream', preview: '' }],
    activeFocus: { type: 'session', sessionId: 'sess-current-viewing' },
  };

  const sessionMessagesCache = new Map();
  const bgMsg = { id: 'm-bg', role: 'assistant', content: 'Background: ', thought: '' };
  sessionMessagesCache.set('sess-background-stream', [bgMsg]);

  const deps = {
    getState: () => state,
    sessionMessagesCache,
    botActivityStore: { updateLatestActivity: () => {} },
    getActiveStreamingStoredSessionId: () => 'sess-background-stream',
    isStreamNearBottom: () => true,
    markProgrammaticScroll: () => {},
    logStream: { trace: () => {} },
  };

  const writer = createTokenStreamWriter(deps);
  const flushedMap = new Map();
  flushedMap.set('m-bg', { content: 'DeltaBg', thought: 'ThoughtBg' });

  writer.writeFlushedTokens(flushedMap);

  assert.equal(bgMsg.content, 'Background: DeltaBg', '后台缓存必须持续累加');
  assert.equal(state.messages.length, 1, '当前查看的前台会话不得被污染');
});

test('TokenStreamWriter: 当 targetMsg.content 初始为空字符串时触发假值回退分支', () => {
  const emptyMsg = { id: 'm-empty', role: 'assistant', content: '', thought: '' };
  const state = {
    activeSessionId: 'sess-empty',
    messages: [emptyMsg],
    sessions: [{ id: 'sess-empty', preview: '' }],
    activeFocus: { type: 'session', sessionId: 'sess-empty' },
  };
  const sessionMessagesCache = new Map();
  sessionMessagesCache.set('sess-empty', [{ ...emptyMsg }]);

  const deps = {
    getState: () => state,
    sessionMessagesCache,
    botActivityStore: { updateLatestActivity: () => {} },
    getActiveStreamingStoredSessionId: () => 'sess-empty',
    isStreamNearBottom: () => true,
    markProgrammaticScroll: () => {},
    logStream: { trace: () => {} },
  };

  const writer = createTokenStreamWriter(deps);
  const flushedMap = new Map();
  flushedMap.set('m-empty', { content: 'FirstToken', thought: '' });
  writer.writeFlushedTokens(flushedMap);

  assert.equal(emptyMsg.content, 'FirstToken');
});

test('TokenStreamWriter: 命中锚点时点亮 display 并直写 innerHTML', (t) => {
  const el = { id: 'msg-content-m1', innerHTML: '', style: { display: 'none', flexDirection: '' } };
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => (id === 'msg-content-m1' ? el : null) };
  t.after(() => { globalThis.document = previousDocument; });

  const { deps } = createMockDeps();
  const writer = createTokenStreamWriter(deps);
  const flushedMap = new Map();
  flushedMap.set('m1', { content: 'world!', thought: '' });
  writer.writeFlushedTokens(flushedMap);

  assert.match(el.innerHTML, /world/, '内容必须直写进锚点');
  assert.equal(el.style.display, 'block', '隐形锚点（display:none）必须在首写时切回 block，与 .conv-markdown 默认块级布局一致');
  assert.equal(el.style.flexDirection, '', '不得改写 flexDirection，避免收口时 flex→block 边距折叠引发高度突变');
});

test('TokenStreamWriter: 锚点缺失必须留痕并计入 flush 统计（Failure Is Not Empty）', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  t.after(() => { globalThis.document = previousDocument; });

  const traces = [];
  const { deps } = createMockDeps({
    deps: { logStream: { trace: (msg, meta) => traces.push([msg, meta]) } },
  });
  const writer = createTokenStreamWriter(deps);
  const flushedMap = new Map();
  flushedMap.set('m1', { content: 'lost', thought: '' });
  writer.writeFlushedTokens(flushedMap);

  const miss = traces.filter(([msg]) => msg === 'stream-anchor-miss');
  assert.equal(miss.length, 1, '缺锚点必须打点，否则「一次性上屏」与「流式正常」在日志上无法区分');
  assert.equal(miss[0][1].id, 'm1', '打点必须带消息 id');
  const flush = traces.find(([msg]) => msg === 'flush');
  assert.equal(flush[1].anchorsMissing, 1, 'flush 统计必须带上缺锚点计数');
  assert.equal(flush[1].chars, 4, 'flush 统计必须记录本次渲染字符数');
  assert.equal(flush[1].messages, 1);
  assert.equal(flush[1].followBottom, true);
  assert.equal(flush[1].scrollTop, null);
});

test('TokenStreamWriter: 贴底时自动滚动并登记 markProgrammaticScroll，上翻时严禁拖拽回底', (t) => {
  const streamEl = { id: 'conversation-stream', scrollTop: 120, scrollHeight: 960 };
  const contentEl = { id: 'msg-content-m1', innerHTML: '', style: { display: 'inline-block', flexDirection: '' } };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => {
      if (id === 'conversation-stream') return streamEl;
      if (id === 'msg-content-m1') return contentEl;
      return null;
    },
  };
  t.after(() => { globalThis.document = previousDocument; });

  // 1. followBottom = true：必须把 scrollTop 拉齐 scrollHeight 并登记程序滚动
  const marked = [];
  const nearBottomChecks = [];
  const traces = [];
  const { deps } = createMockDeps({
    deps: {
      isStreamNearBottom: (el) => {
        nearBottomChecks.push({ el, innerHTMLAtCheck: contentEl.innerHTML });
        return true;
      },
      markProgrammaticScroll: (el) => marked.push(el),
      logStream: { trace: (msg, meta) => traces.push([msg, meta]) },
    },
  });
  const writer = createTokenStreamWriter(deps);
  writer.writeFlushedTokens(new Map([['m1', { content: 'tail' }]]));

  assert.equal(nearBottomChecks.length, 1);
  assert.equal(nearBottomChecks[0].el, streamEl, '贴底判定必须收到 conversation-stream 元素');
  assert.equal(nearBottomChecks[0].innerHTMLAtCheck, '', '贴底判定必须在 DOM 内容变更之前测量');
  assert.equal(streamEl.scrollTop, 960, '贴底态流式写入必须将 scrollTop 拉齐至 scrollHeight');
  assert.deepEqual(marked, [streamEl], '贴底写入后必须登记 markProgrammaticScroll');
  assert.equal(contentEl.style.display, 'inline-block', '非 none 的既有 display 不得被无条件覆盖为 block');
  const flushTrace = traces.find(([msg]) => msg === 'flush');
  assert.equal(flushTrace[1].scrollTop, 960);
  assert.equal(flushTrace[1].followBottom, true);

  // 2. followBottom = false：用户已上翻阅读，严禁改动 scrollTop 或调用 markProgrammaticScroll
  streamEl.scrollTop = 200;
  streamEl.scrollHeight = 1400;
  marked.length = 0;
  const writerPaused = createTokenStreamWriter({
    ...deps,
    isStreamNearBottom: () => false,
    logStream: undefined,
  });
  writerPaused.writeFlushedTokens(new Map([['m1', { content: ' more' }]]));

  assert.equal(streamEl.scrollTop, 200, '用户上翻离开底部后，流式写入严禁把视口拉回底部');
  assert.equal(marked.length, 0, '未触发自动滚动时不得误登记 markProgrammaticScroll');
});

test('TokenStreamWriter: 缓存空缺时自动建桶与补齐 assistant 消息、同步 preview/timestamp 与 bot 活跃度', () => {
  const state = {
    activeSessionId: 'sess-new',
    messages: [],
    sessions: [{ id: 'sess-new', preview: '', timestamp: 0 }],
    activeFocus: { type: 'bot', botName: 'hermes-bot' },
  };
  const sessionMessagesCache = new Map();
  const botUpdates = [];
  const deps = {
    getState: () => state,
    sessionMessagesCache,
    botActivityStore: {
      updateLatestActivity: (botName, content, ts) => botUpdates.push({ botName, content, ts }),
    },
    getActiveStreamingStoredSessionId: () => 'sess-new',
    isStreamNearBottom: () => false,
    markProgrammaticScroll: () => {},
  };

  const writer = createTokenStreamWriter(deps);
  writer.writeFlushedTokens(new Map([['m-fresh', { content: 'First', thought: 'Step 1' }]]));

  const cached = sessionMessagesCache.get('sess-new');
  assert.equal(cached.length, 1);
  assert.equal(cached[0].id, 'm-fresh');
  assert.equal(cached[0].role, 'assistant');
  assert.equal(cached[0].content, 'First');
  assert.equal(cached[0].thought, 'Step 1');
  assert.match(cached[0].timestamp, /^\d{2}:\d{2}:\d{2}$/, '新建缓存消息必须带 HH:MM:SS 时间戳');
  assert.equal(state.messages.length, 1, '活跃会话缺失消息时应自动补入 state.messages');
  assert.equal(state.messages[0], cached[0]);
  assert.equal(state.sessions[0].preview, 'First', '必须同步会话 preview');
  assert.ok(state.sessions[0].timestamp > 0, '必须同步会话 timestamp');
  assert.equal(botUpdates.length, 1);
  assert.equal(botUpdates[0].botName, 'hermes-bot');
  assert.equal(botUpdates[0].content, 'First');

  // 二次写入继续拼接既有 thought（防止 || 被变异为 && 丢弃前段）
  writer.writeFlushedTokens(new Map([['m-fresh', { thought: ' -> Step 2' }]]));
  assert.equal(cached[0].thought, 'Step 1 -> Step 2');
  assert.equal(botUpdates.length, 1, '仅写 thought 时不得重复更新 bot 正文活跃度');
});

test('TokenStreamWriter: 思维链直写 DOM 展开 details 折叠面板并更新摘要，且忽略非 assistant 与无 storedSessionId 写入', (t) => {
  const summaryEl = { innerText: '' };
  const foldEl = {
    style: { display: 'none' },
    open: false,
    querySelector: (sel) => (sel === 'summary span:last-child' ? summaryEl : null),
  };
  const thoughtEl = {
    id: 'msg-thought-m1',
    innerText: '',
    closest: (sel) => (sel === 'details' ? foldEl : null),
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === 'msg-thought-m1' ? thoughtEl : null),
  };
  t.after(() => { globalThis.document = previousDocument; });

  const { deps, state, sessionMessagesCache } = createMockDeps({
    state: {
      messages: [
        { id: 'u1', role: 'user', content: 'hi', thought: '' },
        { id: 'm1', role: 'assistant', content: 'Hello ', thought: 'Part1 ' },
      ],
    },
  });
  const writer = createTokenStreamWriter(deps);
  writer.writeFlushedTokens(
    new Map([
      ['u1', { content: 'SHOULD_IGNORE', thought: 'SHOULD_IGNORE' }],
      ['m1', { thought: 'Part2 reasoning' }],
    ])
  );

  assert.equal(state.messages[0].content, 'hi', '严禁向 user 消息直写流式 token');
  assert.equal(state.messages[1].thought, 'Part1 Part2 reasoning', '既有 thought 必须累加而非覆盖');
  assert.equal(thoughtEl.innerText, 'Part1 Part2 reasoning', '思维链正文必须直写到 #msg-thought-*');
  assert.equal(foldEl.style.display, 'block', '思维链折叠面板必须切回 display:block');
  assert.equal(foldEl.open, true, '思维链折叠面板必须在流式输出时展开');
  assert.ok(summaryEl.innerText.includes('Part1 Part2 reasoning'), '折叠摘要必须同步为清洗后的思维链文本');

  // storedSessionId 为 null 且非当前活跃会话时，不污染缓存也不改 state
  const cacheSizeBefore = sessionMessagesCache.size;
  const writerNullSess = createTokenStreamWriter({
    ...deps,
    getActiveStreamingStoredSessionId: () => null,
  });
  writerNullSess.writeFlushedTokens(new Map([['m1', { content: 'NOOP' }]]));
  assert.equal(sessionMessagesCache.size, cacheSizeBefore);
  assert.equal(state.messages[1].content, 'Hello ');
});
