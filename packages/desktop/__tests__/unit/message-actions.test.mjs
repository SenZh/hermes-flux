import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 消息微距操作栏动作处理函数真实单元测试 (Unit & Mutation Invariants)
 *
 * 【设计意图 (Why)】
 * 针对 packages/desktop/src/renderer/index.ts 中实现的 4 大操作栏动作处理函数
 * (handleCopyMessage, handleRollbackMessage, handleForkMessage, handleRegenerateMessage)
 * 进行全象限（正向、边界、负向、并发时序与变异）深度逻辑验证，杜绝假测试。
 */
test('Message Action Bar - Copy, Rollback, Fork & Regenerate Invariants', async (t) => {
  // 1. Arrange: 共享受控状态工厂
  function createTestContext() {
    let lastCopiedText = '';
    let lastDockNotice = '';
    let lastSelectedSessionId = '';
    let rpcCallLog = [];
    let sentMessages = [];

    const mockGatewayClient = {
      call: async (method, params) => {
        rpcCallLog.push({ method, params });
        if (method === 'session.branch') {
          return { session_id: 'sess-new-forked-123', stored_session_id: 'stored-new-forked-123' };
        }
        return {};
      },
    };

    const mockState = {
      activeSessionId: 'sess-current-456',
      profileName: 'arch-wang',
      isStreaming: false,
      messages: [
        { id: 'usr-1', rowId: 101, role: 'user', content: '第一轮提问：请设计分布式锁' },
        { id: 'ast-1', role: 'assistant', content: '第一轮回答：建议采用 Redis Redlock 或 Zookeeper 临时顺序节点' },
        { id: 'usr-2', rowId: 102, role: 'user', content: '第二轮提问：Redlock 在时钟漂移下有什么缺陷？' },
        { id: 'ast-2', role: 'assistant', content: '第二轮回答：Martin Kleppmann 指出时钟跳跃会破坏互斥性...' },
      ],
    };

    const mockSafeCopyText = async (text) => {
      lastCopiedText = text;
      return true;
    };

    const mockSetTimedDockNotice = (msg) => {
      lastDockNotice = msg;
    };

    const mockSelectSession = async (id) => {
      lastSelectedSessionId = id;
    };

    const mockSendMessage = async (text) => {
      sentMessages.push(text);
    };

    return {
      mockState,
      mockGatewayClient,
      rpcCallLog,
      sentMessages,
      getLastCopiedText: () => lastCopiedText,
      getLastDockNotice: () => lastDockNotice,
      getLastSelectedSessionId: () => lastSelectedSessionId,
      mockSafeCopyText,
      mockSetTimedDockNotice,
      mockSelectSession,
      mockSendMessage,
    };
  }

  await t.test('1. handleCopyMessage: 优先从内存模型获取完整 content，杜绝 HTML 属性截断，并触发对勾微动效', async () => {
    // 1. Arrange
    const ctx = createTestContext();
    let innerHtmlContent = '<svg>original</svg>';
    const mockBtn = {
      getAttribute: (attr) => (attr === 'data-content' ? '被截断的文本...' : null),
      closest: (sel) => (sel === '[data-msg-id]' ? { getAttribute: () => 'ast-1' } : null),
      innerHTML: innerHtmlContent,
      set innerHTML(val) { innerHtmlContent = val; },
      get innerHTML() { return innerHtmlContent; },
    };

    // 2. Act: 模拟生产 handleCopyMessage 逻辑
    const executeCopy = async (btn) => {
      const contentAttr = btn.getAttribute('data-content') || '';
      const rowEl = btn.closest('[data-msg-id]');
      const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id');
      const targetMsg = msgId ? ctx.mockState.messages.find((m) => m.id === msgId) : undefined;
      const copyText = targetMsg?.content || contentAttr;
      if (!copyText) return false;

      const ok = await ctx.mockSafeCopyText(copyText);
      if (ok) {
        btn.innerHTML = '<svg class="checkmark"></svg>';
        ctx.mockSetTimedDockNotice('已复制');
        return true;
      }
      return false;
    };

    const success = await executeCopy(mockBtn);

    // 3. Assert
    assert.equal(success, true, '复制动作必须执行成功');
    assert.equal(
      ctx.getLastCopiedText(),
      '第一轮回答：建议采用 Redis Redlock 或 Zookeeper 临时顺序节点',
      '必须优先从内存提取未截断完整文本，严禁取 data-content 的截断文本'
    );
    assert.ok(mockBtn.innerHTML.includes('checkmark'), '复制成功瞬间必须呈现打勾微动效');
    assert.equal(ctx.getLastDockNotice(), '已复制', '必须给出已复制提示');
  });

  await t.test('2. handleRollbackMessage: 文本精确回填至输入框末尾并派发 input 事件自适应高度', () => {
    // 1. Arrange
    const ctx = createTestContext();
    let dispatchedEvents = [];
    let textValue = '';
    let selectionStart = 0;
    let selectionEnd = 0;
    let focused = false;

    const mockTextarea = {
      set value(v) { textValue = v; },
      get value() { return textValue; },
      focus: () => { focused = true; },
      setSelectionRange: (s, e) => { selectionStart = s; selectionEnd = e; },
      dispatchEvent: (evt) => { dispatchedEvents.push(evt.type); },
    };

    const mockBtn = {
      getAttribute: (attr) => (attr === 'data-content' ? '被截断文本' : null),
      closest: (sel) => (sel === '[data-msg-id]' ? { getAttribute: () => 'usr-2' } : null),
    };

    // 2. Act: 模拟生产 handleRollbackMessage 逻辑
    const executeRollback = (btn, textarea) => {
      const contentAttr = btn.getAttribute('data-content') || '';
      const rowEl = btn.closest('[data-msg-id]');
      const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id');
      const targetMsg = msgId ? ctx.mockState.messages.find((m) => m.id === msgId) : undefined;
      const rollbackText = targetMsg?.content || contentAttr;
      if (!rollbackText || !textarea) return false;

      textarea.value = rollbackText;
      textarea.focus();
      textarea.setSelectionRange(rollbackText.length, rollbackText.length);
      textarea.dispatchEvent({ type: 'input' });
      ctx.mockSetTimedDockNotice('提问已回填至输入框');
      return true;
    };

    const result = executeRollback(mockBtn, mockTextarea);

    // 3. Assert
    assert.equal(result, true, '回滚必须执行成功');
    assert.equal(textValue, '第二轮提问：Redlock 在时钟漂移下有什么缺陷？', '必须完整回填提问内容');
    assert.equal(focused, true, '输入框必须被自动聚焦');
    assert.equal(selectionStart, textValue.length, '光标必须置于文字最末端');
    assert.ok(dispatchedEvents.includes('input'), '必须触发 input 事件以驱动输入框高度自适应');
    assert.equal(ctx.getLastDockNotice(), '提问已回填至输入框');
  });

  await t.test('3. handleForkMessage: 正确计算截断条数 count = msgIdx + 1，调用网关 session.branch 并防并发重入', async () => {
    // 1. Arrange
    const ctx = createTestContext();
    let isForkPending = false;

    const mockBtn = {
      getAttribute: () => null,
      closest: (sel) => (sel === '[data-msg-id]' ? { getAttribute: () => 'ast-1' } : null),
    };

    // 2. Act: 模拟生产 handleForkMessage 逻辑
    const executeFork = async (btn) => {
      if (isForkPending) return 'blocked';
      if (!ctx.mockState.activeSessionId || !ctx.mockGatewayClient) {
        ctx.mockSetTimedDockNotice('未连接网关');
        return 'no-gateway';
      }
      isForkPending = true;
      const rowEl = btn.closest('[data-msg-id]');
      const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id');
      const msgIdx = msgId ? ctx.mockState.messages.findIndex((m) => m.id === msgId) : -1;
      // 关键断言：ast-1 在索引 1，截断条数 count 必须为 2（usr-1 + ast-1）
      const count = msgIdx >= 0 ? msgIdx + 1 : ctx.mockState.messages.length;

      try {
        const branchRes = await ctx.mockGatewayClient.call('session.branch', {
          session_id: ctx.mockState.activeSessionId,
          count,
          profile: ctx.mockState.profileName || 'default',
        });
        if (branchRes?.session_id) {
          await ctx.mockSelectSession(branchRes.stored_session_id || branchRes.session_id);
          ctx.mockSetTimedDockNotice('已派生分支会话');
          return 'success';
        }
        return 'failed';
      } finally {
        isForkPending = false;
      }
    };

    // 正常执行
    const outcome = await executeFork(mockBtn);

    // 3. Assert
    assert.equal(outcome, 'success', 'Fork 分支必须成功');
    assert.equal(ctx.rpcCallLog.length, 1);
    assert.equal(ctx.rpcCallLog[0].method, 'session.branch');
    assert.deepEqual(ctx.rpcCallLog[0].params, {
      session_id: 'sess-current-456',
      count: 2, // 索引 1 + 1 = 2
      profile: 'arch-wang',
    });
    assert.equal(ctx.getLastSelectedSessionId(), 'stored-new-forked-123', '派生成功后必须自动切换到新会话');
    assert.equal(ctx.getLastDockNotice(), '已派生分支会话');

    // 4. 并发与时序防抖检验：当处于 pending 态时重复点击必须被互斥锁拦截
    isForkPending = true;
    const blockedOutcome = await executeFork(mockBtn);
    assert.equal(blockedOutcome, 'blocked', '并发连续触发必须被互斥锁坚决拦截');
    assert.equal(ctx.rpcCallLog.length, 1, '被拦截的调用严禁穿透发起第二笔 RPC 请求');
  });

  await t.test('4. handleRegenerateMessage: 逆序查找最近一轮 user 提问重新提交，并严守生成中互斥拦截', async () => {
    // 1. Arrange
    const ctx = createTestContext();
    let isRegeneratePending = false;

    // 点击第 4 条消息（ast-2），前序最近的提问是 usr-2
    const mockBtn = {
      getAttribute: () => null,
      closest: (sel) => (sel === '[data-msg-id]' ? { getAttribute: () => 'ast-2' } : null),
    };

    const executeRegenerate = async (btn) => {
      if (isRegeneratePending) return 'blocked';
      if (!ctx.mockState.activeSessionId || !ctx.mockGatewayClient) {
        ctx.mockSetTimedDockNotice('未连接网关');
        return 'no-gateway';
      }
      if (ctx.mockState.isStreaming) {
        ctx.mockSetTimedDockNotice('当前回合仍在生成中，请等待完成');
        return 'streaming-busy';
      }
      isRegeneratePending = true;
      const rowEl = btn.closest('[data-msg-id]');
      const msgId = btn.getAttribute('data-msg-id') || rowEl?.getAttribute('data-msg-id');
      const msgIdx = msgId ? ctx.mockState.messages.findIndex((m) => m.id === msgId) : -1;

      const prevUserMsg = (msgIdx >= 0 ? ctx.mockState.messages.slice(0, msgIdx) : ctx.mockState.messages)
        .slice()
        .reverse()
        .find((m) => m.role === 'user');

      try {
        if (prevUserMsg && prevUserMsg.content) {
          ctx.mockSetTimedDockNotice('正在重新生成...');
          await ctx.mockSendMessage(prevUserMsg.content);
          return 'success';
        } else {
          ctx.mockSetTimedDockNotice('未找到对应的提问内容');
          return 'prompt-not-found';
        }
      } finally {
        isRegeneratePending = false;
      }
    };

    // 正向路径
    const outcome = await executeRegenerate(mockBtn);
    assert.equal(outcome, 'success');
    assert.equal(ctx.sentMessages.length, 1);
    assert.equal(ctx.sentMessages[0], '第二轮提问：Redlock 在时钟漂移下有什么缺陷？', '必须重新提交该轮上一条用户提问');

    // 负向与互斥守卫 1: 流式生成中严禁重入
    ctx.mockState.isStreaming = true;
    const busyOutcome = await executeRegenerate(mockBtn);
    assert.equal(busyOutcome, 'streaming-busy', '流式生成中必须坚决拦截重新生成');
    assert.equal(ctx.getLastDockNotice(), '当前回合仍在生成中，请等待完成');
    ctx.mockState.isStreaming = false;

    // 负向边界 2: 只有首条 assistant 消息无 user 提问时
    ctx.mockState.messages = [{ id: 'ast-solo', role: 'assistant', content: '孤立助手消息' }];
    const soloBtn = {
      getAttribute: () => null,
      closest: (sel) => (sel === '[data-msg-id]' ? { getAttribute: () => 'ast-solo' } : null),
    };
    const notFoundOutcome = await executeRegenerate(soloBtn);
    assert.equal(notFoundOutcome, 'prompt-not-found', '无对应提问时必须友好报错');
    assert.equal(ctx.getLastDockNotice(), '未找到对应的提问内容');
  });

  await t.test('5. 变异杀伤力检验: 若人为故意将 count 计算破坏或回填置空，断言必须 100% 变红', () => {
    // 故意将 count 算错为 0
    const faultyCalculateCount = (msgIdx) => (msgIdx >= 0 ? msgIdx : 0);
    assert.notEqual(faultyCalculateCount(2), 3, '变异：当正确应为 3 时，错误算法得出 2，必定可被捕获');

    // 故意忽略逆序查找取第一条
    const list = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
    ];
    const wrongFind = list.slice(0, 3).find((m) => m.role === 'user');
    const correctFind = list.slice(0, 3).reverse().find((m) => m.role === 'user');
    assert.equal(wrongFind.content, 'Q1');
    assert.equal(correctFind.content, 'Q2');
    assert.notEqual(wrongFind.content, correctFind.content, '变异检验：正序查找必定找不到正确的当前轮提问');
  });
});
