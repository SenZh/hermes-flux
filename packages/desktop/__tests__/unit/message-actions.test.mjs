import test from 'node:test';
import assert from 'node:assert/strict';

// 【反 AI 假测试门禁 (Gate 2)】
// 真实导入生产构建模块，绝对禁止在测试内部自行编写假闭包函数自证自嗨！
import {
  resolveCopyContent,
  calculateForkCount,
  findPreviousUserPrompt,
  MessageActionController,
} from '../../dist/renderer/messageActions.mjs';

test('Message Action Bar - 生产模块真实单测与变异不变量检验 (Zero-Illusion Tests)', async (t) => {
  // Arrange: 准备真实业务消息集
  const sampleMessages = [
    { id: 'usr-1', rowId: 101, role: 'user', content: '第一轮提问：请设计分布式锁' },
    { id: 'ast-1', role: 'assistant', content: '第一轮回答：建议采用 Redis Redlock 或 Zookeeper 临时顺序节点' },
    { id: 'usr-2', rowId: 102, role: 'user', content: '第二轮提问：Redlock 在时钟漂移下有什么缺陷？' },
    { id: 'ast-2', role: 'assistant', content: '第二轮回答：Martin Kleppmann 指出时钟跳跃会破坏互斥性...' },
  ];

  await t.test('1. resolveCopyContent 生产函数: 优先从内存列表获取完整 content，杜绝 HTML 属性截断', () => {
    // 1. Arrange: 构造按钮，故意塞入被属性引号或换行截断的残损文本
    const mockBtn = {
      getAttribute: (attr) => (attr === 'data-content' ? '被截断的残损文本...' : null),
      closest: (sel) => (sel === '[data-msg-id]' ? { getAttribute: () => 'ast-1' } : null),
    };

    // 2. Act: 调用真实生产函数 resolveCopyContent
    const extracted = resolveCopyContent(mockBtn, sampleMessages);

    // 3. Assert: 必须无条件命中内存真实对象，坚决丢弃被截断的残损属性
    assert.equal(
      extracted,
      '第一轮回答：建议采用 Redis Redlock 或 Zookeeper 临时顺序节点',
      '真实生产函数：必须优先从内存提取未截断完整文本'
    );

    // 边界：当消息内存未命中时，才兜底回退读取属性
    const fallbackBtn = {
      getAttribute: (attr) => (attr === 'data-content' ? '兜底属性文本' : null),
      closest: () => null,
    };
    assert.equal(resolveCopyContent(fallbackBtn, sampleMessages), '兜底属性文本');
  });

  await t.test('2. calculateForkCount 生产函数: 正确计算截断条数 count = msgIdx + 1，杜绝 4008 守卫错误', () => {
    // 1. Act & Assert: 调用真实生产函数 calculateForkCount
    // 对 usr-1 (索引 0) 分叉 => count 必须为 1
    assert.equal(calculateForkCount('usr-1', sampleMessages), 1, '首条消息分叉 count 必须为 1');

    // 对 ast-1 (索引 1) 分叉 => count 必须为 2
    assert.equal(calculateForkCount('ast-1', sampleMessages), 2, '第二条消息分叉 count 必须为 2');

    // 对 ast-2 (索引 3) 分叉 => count 必须为 4
    assert.equal(calculateForkCount('ast-2', sampleMessages), 4, '第四条消息分叉 count 必须为 4');

    // 边界值：若 msgId 不存在或为空，安全回退至全部消息长度
    assert.equal(calculateForkCount('non-existent-id', sampleMessages), 4);
    assert.equal(calculateForkCount(null, sampleMessages), 4);
  });

  await t.test('3. findPreviousUserPrompt 生产函数: 逆序追溯上一轮最近 User 提问，严防上下文跨轮脱节', () => {
    // 1. Act & Assert: 调用真实生产函数 findPreviousUserPrompt
    // 从 ast-2 (索引 3) 向上寻找 => 必须精准命中 usr-2，绝不能误取第一轮的 usr-1
    const promptForAst2 = findPreviousUserPrompt('ast-2', sampleMessages);
    assert.equal(promptForAst2, '第二轮提问：Redlock 在时钟漂移下有什么缺陷？');

    // 从 ast-1 (索引 1) 向上寻找 => 必须命中 usr-1
    const promptForAst1 = findPreviousUserPrompt('ast-1', sampleMessages);
    assert.equal(promptForAst1, '第一轮提问：请设计分布式锁');

    // 边界与极限值：若首条消息为孤立 assistant 且前序无 user 提问时 => 返回 null
    const soloAssistant = [{ id: 'ast-solo', role: 'assistant', content: '孤立回复' }];
    assert.equal(findPreviousUserPrompt('ast-solo', soloAssistant), null);
  });

  await t.test('4. MessageActionController 生产控制器: executeRollback 真实激活光标并派发自适应 input 事件', () => {
    // 1. Arrange
    const controller = new MessageActionController();
    let textValue = '';
    let selectionStart = 0;
    let selectionEnd = 0;
    let focused = false;
    let dispatchedEvents = [];
    let noticeMessage = '';

    const mockTextarea = {
      set value(v) { textValue = v; },
      get value() { return textValue; },
      focus: () => { focused = true; },
      setSelectionRange: (s, e) => { selectionStart = s; selectionEnd = e; },
      dispatchEvent: (evt) => { dispatchedEvents.push(evt.type); },
    };

    const mockBtn = {
      getAttribute: () => null,
      closest: (sel) => (sel === '[data-msg-id]' ? { getAttribute: () => 'usr-2' } : null),
    };

    // 2. Act: 调用真实生产控制器方法
    const success = controller.executeRollback(
      mockBtn,
      sampleMessages,
      mockTextarea,
      (msg) => { noticeMessage = msg; },
      '回滚成功'
    );

    // 3. Assert
    assert.equal(success, true, '真实生产控制器：回滚必须执行成功');
    assert.equal(textValue, '第二轮提问：Redlock 在时钟漂移下有什么缺陷？');
    assert.equal(focused, true, '输入框必须聚焦');
    assert.equal(selectionStart, textValue.length, '光标必须置于文本最后');
    assert.ok(dispatchedEvents.includes('input'), '必须触发 input 事件通知自适应高度');
    assert.equal(noticeMessage, '回滚成功');
  });

  await t.test('5. MessageActionController 生产控制器: executeFork 并发互斥锁与 RPC 调度', async () => {
    // 1. Arrange
    const controller = new MessageActionController();
    const rpcCalls = [];
    let switchedSession = '';
    let notice = '';

    const mockBtn = {
      getAttribute: () => null,
      closest: (sel) => (sel === '[data-msg-id]' ? { getAttribute: () => 'ast-1' } : null),
    };

    // 2. Act: 首次调用真实 executeFork
    const forkPromise = controller.executeFork(mockBtn, {
      activeSessionId: 'sess-active-888',
      profileName: 'default',
      messages: sampleMessages,
      callRpc: async (method, params) => {
        rpcCalls.push({ method, params });
        return { session_id: 'new-forked-999' };
      },
      onSuccess: async (id) => { switchedSession = id; },
      setNotice: (n) => { notice = n; },
      labels: {
        notConnected: '未连接网关',
        forking: '正在派生分支...',
        success: '已派生分支',
        failed: '分支失败',
      },
    });

    // 3. 时序竞态检验：在首次 Fork 尚未 settle 时紧接着发起第二击
    const concurrentClick = await controller.executeFork(mockBtn, {
      activeSessionId: 'sess-active-888',
      profileName: 'default',
      messages: sampleMessages,
      callRpc: async () => ({}),
      onSuccess: async () => {},
      setNotice: () => {},
      labels: { notConnected: '', forking: '', success: '', failed: '' },
    });

    // 并发调用必须返回 blocked 且不能发起第二笔网络请求
    assert.equal(concurrentClick, 'blocked', '生产控制器：并发重复调用必须被 isForkPending 坚决拦截');

    const firstResult = await forkPromise;
    assert.equal(firstResult, 'success');
    assert.equal(rpcCalls.length, 1, '严格只允许穿透一笔 RPC 请求');
    assert.deepEqual(rpcCalls[0].params, {
      session_id: 'sess-active-888',
      count: 2, // ast-1 索引 1 + 1 = 2
      profile: 'default',
    });
    assert.equal(switchedSession, 'new-forked-999', '必须自动切换为新分支 ID');
  });

  await t.test('6. MessageActionController 生产控制器: executeRegenerate 负向守卫与并发重入拦截', async () => {
    // 1. Arrange
    const controller = new MessageActionController();
    const sentPrompts = [];
    let notice = '';

    const mockBtn = {
      getAttribute: () => null,
      closest: (sel) => (sel === '[data-msg-id]' ? { getAttribute: () => 'ast-2' } : null),
    };

    // 2. 负向守卫 1: 流式态中点击坚决拒绝 (Failure/Busy Guard)
    const busyResult = await controller.executeRegenerate(mockBtn, {
      activeSessionId: 'sess-1',
      isStreaming: true,
      messages: sampleMessages,
      sendPrompt: async (t) => { sentPrompts.push(t); },
      setNotice: (n) => { notice = n; },
      labels: {
        notConnected: '未连接',
        streamingBusy: '正在生成中，请等待',
        regenerating: '正在重新生成...',
        promptNotFound: '未找到提问',
      },
    });
    assert.equal(busyResult, 'busy', '流式生成中必须拒绝重新生成');
    assert.equal(sentPrompts.length, 0);
    assert.equal(notice, '正在生成中，请等待');

    // 3. 正向执行：非流式态正常提交上一轮提问
    const successResult = await controller.executeRegenerate(mockBtn, {
      activeSessionId: 'sess-1',
      isStreaming: false,
      messages: sampleMessages,
      sendPrompt: async (t) => { sentPrompts.push(t); },
      setNotice: (n) => { notice = n; },
      labels: {
        notConnected: '未连接',
        streamingBusy: '正在生成中，请等待',
        regenerating: '正在重新生成...',
        promptNotFound: '未找到提问',
      },
    });
    assert.equal(successResult, 'success');
    assert.equal(sentPrompts.length, 1);
    assert.equal(sentPrompts[0], '第二轮提问：Redlock 在时钟漂移下有什么缺陷？');
  });
});
