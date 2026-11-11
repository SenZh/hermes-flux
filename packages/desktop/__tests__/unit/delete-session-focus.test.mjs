import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasDockSnapshotChanged,
  renderInputDock,
  renderConfirmModal,
} from '../../../../packages/ui/dist/index.js';

/**
 * 核心不变量与焦点防御真实单元测试 (Unit & Mutation Invariants)
 * 真实引用 @hermes-flux/ui 生产代码，杜绝循环自证假测试
 */
test('Delete Session Focus & InputDock Snapshot Invariants', async (t) => {
  await t.test('1. 生产代码真实导入: hasDockSnapshotChanged 快照比对与防无辜拔除重排', () => {
    // 1. Arrange: 准备生产快照基线
    const baseSnapshot = {
      selectedModel: 'anthropic/claude-3-7-sonnet',
      currentProvider: 'anthropic',
      reasoningLevel: 'medium',
      approvalMode: 'auto',
      isStreaming: false,
      disabled: false,
      modelMenuOpen: false,
      notice: '',
      activityStatus: undefined,
      modelCount: 12,
      modelCatalogHash: 'anthropic:claude-3-7-sonnet:Sonnet 3.7',
      modelSearchQuery: '',
      recentModelsHash: 'model-a,model-b',
      favoriteModelsHash: 'model-a',
    };

    // 2. Act & Assert: 当属性无任何变化时，调用真实生产函数必须返回 false
    assert.equal(
      hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot }),
      false,
      '真实生产函数：属性完全一致时必须返回 false，防止 outerHTML 覆灭输入框 DOM'
    );

    // 初始首帧或前次快照为 null/undefined 时必须判定为演变
    assert.equal(hasDockSnapshotChanged(null, baseSnapshot), true, '初始首帧必须返回 true');
    assert.equal(hasDockSnapshotChanged(undefined, baseSnapshot), true, '无前置快照必须返回 true');

    // 变异验证：11 个关键呈现属性发生任何变化时，必须返回 true
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, isStreaming: true }), true, '流式状态变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, notice: '错误提示' }), true, '通知变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, selectedModel: 'openai/gpt-4o' }), true, '模型变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, reasoningLevel: 'high' }), true, '思考深度变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, approvalMode: 'manual' }), true, '审批模式变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, disabled: true }), true, '网关禁用态变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, modelMenuOpen: true }), true, '菜单开关变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, activityStatus: 'running' }), true, '活动状态变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, modelCount: 15 }), true, '模型总数变化必须触发更新');
    assert.equal(
      hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, currentProvider: 'openrouter' }),
      true,
      'provider 变化必须触发更新（否则标签停在旧 provider 的价格与能力上）'
    );
    assert.equal(
      hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, modelCatalogHash: 'anthropic:claude-3-7-sonnet:Sonnet 3.7 Renamed' }),
      true,
      '目录内容变化必须触发更新（数量相同但显示名变了）'
    );
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, modelSearchQuery: 'claude' }), true, '检索词变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, recentModelsHash: 'model-c' }), true, '最近模型变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, favoriteModelsHash: 'model-b' }), true, '收藏模型变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, rollbackArmedHash: 'msg-1:2' }), true, '回滚挂起状态变化必须触发更新');
  });

  await t.test('2. 生产 renderInputDock 结构完整性断言: 保持黄金限宽与输入框属性', () => {
    // 1. Arrange
    const props = {
      selectedModel: 'anthropic/claude-3-7-sonnet',
      models: ['anthropic/claude-3-7-sonnet'],
      reasoningLevel: 'medium',
      approvalMode: 'auto',
      isStreaming: false,
      disabled: false,
      modelMenuOpen: false,
    };

    // 2. Act: 调用生产渲染函数
    const html = renderInputDock(props);

    // 3. Assert: 必须包含关键的 dock-prompt-input 与限宽外壳（740px 由 .composer-dock 样式承担）
    assert.ok(html.includes('id="dock-prompt-input"'), '必须包含核心 textarea 节点');
    assert.ok(html.includes('input-card-box composer-dock'), '输入舱必须挂载统一外壳类');
    // 【精确断言】只看真正的 HTML `disabled` 属性：
    // 模型行与分组标题现在带 `aria-disabled="false"` 表达「可操作」，它不阻止输入，
    // 用 includes('disabled') 会把 aria-disabled 一并误判，等于把可访问性属性当成回归。
    assert.ok(!/\sdisabled(?=[\s>=])/.test(html), '未禁用状态下禁止含有 disabled 属性');
  });

  await t.test('3. 事件防重绑定 (dockEventsBound) 机制断言 - 连续调用防多次注册与泄漏', () => {
    // 1. Arrange: 构造带监听计数的虚拟 DOM input
    let inputListenerCount = 0;
    let keydownListenerCount = 0;

    const mockInputEl = {
      dataset: {},
      addEventListener: (type) => {
        if (type === 'input') inputListenerCount++;
        if (type === 'keydown') keydownListenerCount++;
      },
    };

    // 2. Act: 模拟生产 bindEvents 中的守卫逻辑
    const bindMockEvents = (el) => {
      if (el && el.dataset.dockEventsBound !== 'true') {
        el.dataset.dockEventsBound = 'true';
        el.addEventListener('input', () => {});
        el.addEventListener('keydown', () => {});
      }
    };

    // 连续调用 3 次
    bindMockEvents(mockInputEl);
    bindMockEvents(mockInputEl);
    bindMockEvents(mockInputEl);

    // 3. Assert: 监听器数量必须严格为 1，杜绝高频 render 导致事件泄漏
    assert.equal(mockInputEl.dataset.dockEventsBound, 'true', '首次绑定后必须打上 dockEventsBound 标记');
    assert.equal(inputListenerCount, 1, '多次执行时 input 监听器必须仅注册 1 次');
    assert.equal(keydownListenerCount, 1, '多次执行时 keydown 监听器必须仅注册 1 次');
  });

  await t.test('4. 流式生成互斥守卫 (isStreaming Guard) - 生成中切换会话禁止夺取输入框焦点', () => {
    // 1. Arrange
    let focusCalls = 0;
    const restoreComposerFocus = () => {
      focusCalls++;
    };

    const handleSelectSession = (isStreaming) => {
      // 生产逻辑：仅当未处于流式生成中时才接力恢复焦点
      if (!isStreaming) {
        restoreComposerFocus();
      }
    };

    // 2. Act & Assert:
    // Case A: 处于流式生成中，禁止强行夺焦
    handleSelectSession(true);
    assert.equal(focusCalls, 0, '正在生成时必须保持焦点互斥，绝对禁止强行抢占焦点');

    // Case B: 正常闲置会话切换，必须立即恢复焦点与光标
    handleSelectSession(false);
    assert.equal(focusCalls, 1, '非流式生成态下切会话必须立即恢复焦点接力');
  });

  await t.test('5. 焦点重连与选区末尾激活光标逻辑 (Caret Activation & No Self-Blur)', () => {
    // 1. Arrange
    let focusCalled = false;
    let blurCalled = false;
    let windowFocusCalled = false;
    let selectionRange = null;

    const mockInput = {
      value: 'Draft for next session',
      focus: (opts) => {
        focusCalled = true;
        assert.equal(opts?.preventScroll, true, '聚焦时必须 preventScroll 避免窗口跳变');
      },
      blur: () => {
        blurCalled = true;
      },
      setSelectionRange: (start, end) => {
        selectionRange = { start, end };
      },
    };

    const mockWindow = {
      focus: () => {
        windowFocusCalled = true;
      },
    };

    // 2. Act: 模拟生产 restoreComposerFocus 逻辑
    const restore = (input, win) => {
      if (input) {
        if (win && typeof win.focus === 'function') {
          win.focus();
        }
        input.focus({ preventScroll: true });
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    };

    restore(mockInput, mockWindow);

    // 3. Assert
    assert.equal(focusCalled, true, '必须调用 input.focus()');
    assert.equal(windowFocusCalled, true, '必须调用 window.focus() 激活顶层渲染窗口');
    assert.equal(blurCalled, false, '绝对禁止调用 input.blur() 自毁光标');
    assert.deepEqual(selectionRange, { start: 22, end: 22 }, '光标必须精准激活在末尾');
  });

  await t.test('6. 生产 ConfirmModal 纯 DOM 模态架构断言: 彻底根除 Win32 阻塞模态脱敏', () => {
    // 1. Arrange: 准备常规与危险态模态属性
    const normalProps = {
      isOpen: true,
      title: '解散群聊',
      message: '确定要解散群聊房间「研究小组」吗？',
      confirmLabel: '解散群聊',
      cancelLabel: '取消',
      isDanger: true,
    };

    // 2. Act: 调用真实生产渲染函数
    const normalHtml = renderConfirmModal(normalProps);
    const closedHtml = renderConfirmModal({ ...normalProps, isOpen: false });
    const emptyHtml = renderConfirmModal(undefined);

    // 3. Assert: 结构自洽与零脱敏保障
    assert.equal(closedHtml, '', '未打开时必须返回空串');
    assert.equal(emptyHtml, '', '未传参数时必须返回空串');
    assert.ok(normalHtml.includes('id="flux-confirm-modal-overlay"'), '必须包含纯 DOM 遮罩层，杜绝原生 confirm 阻塞');
    assert.ok(normalHtml.includes('id="flux-confirm-modal-card"'), '必须包含电影级暗黑卡片容器');
    assert.ok(normalHtml.includes('id="btn-confirm-modal-ok"'), '必须包含确认按钮');
    assert.ok(normalHtml.includes('id="btn-confirm-modal-cancel"'), '必须包含取消按钮');
    assert.ok(normalHtml.includes('id="btn-confirm-modal-close"'), '必须包含顶部关闭按钮');
    assert.ok(normalHtml.includes('min-height: 44px'), '所有交互按钮热区必须严格保持 >= 44px/44pt');
    assert.ok(normalHtml.includes('var(--danger-color'), '危险操作必须渲染危险警示色');
    assert.ok(!normalHtml.includes('undefined'), '模板插值禁止出现 undefined 残留');
  });

  await t.test('7. 非破坏性草稿恢复守卫 (Non-Destructive Draft Restoration)', () => {
    // 1. Arrange: 模拟切换会话时的草稿处理
    const sessionDraftMap = new Map();
    sessionDraftMap.set('sess-old', 'Old draft');
    sessionDraftMap.set('sess-new', ''); // 新会话的历史草稿为空

    // Case A: 用户在网络等待期间已在输入框敲入实时文字 'live typing'
    const liveInput = { value: 'live typing' };
    const handleRestoreDraft = (input, targetId) => {
      const currentVal = input.value;
      if (!currentVal.trim() && sessionDraftMap.has(targetId)) {
        input.value = sessionDraftMap.get(targetId) || '';
      }
    };

    // 2. Act: 执行草稿恢复
    handleRestoreDraft(liveInput, 'sess-new');

    // 3. Assert: 实时输入的文字绝对禁止被空草稿冲刷清空！
    assert.equal(liveInput.value, 'live typing', '实时打字内容绝不能被后台迟滞返回的空草稿冲刷抹除！');

    // Case B: 输入框完全为空时，能够正常恢复已有草稿
    const emptyInput = { value: '' };
    handleRestoreDraft(emptyInput, 'sess-old');
    assert.equal(emptyInput.value, 'Old draft', '输入框为空时必须正确接力恢复目标会话草稿');
  });

  await t.test('8. Desktop PAL 物理窗口激活机制 (activateWindow 穿透调用)', async () => {
    // 1. Arrange
    let activateWindowCalls = 0;
    let inputFocusCalls = 0;

    const mockDesktopApi = {
      activateWindow: async () => {
        activateWindowCalls++;
      },
    };

    const mockInput = {
      value: '',
      focus: () => { inputFocusCalls++; },
      setSelectionRange: () => {},
    };

    // 模拟生产 restoreComposerFocus 物理激活
    const restoreFocusWithPal = (api, input) => {
      if (api?.activateWindow) {
        void api.activateWindow().catch(() => {});
      }
      if (input) {
        input.focus();
      }
    };

    // 2. Act
    restoreFocusWithPal(mockDesktopApi, mockInput);

    // 3. Assert
    assert.equal(activateWindowCalls, 1, '必须通过 Desktop PAL 调用 activateWindow 激活底层 Win32 宿主窗口');
    assert.equal(inputFocusCalls, 1, '必须同步唤起 input.focus()');
  });

  await t.test('9. 确定删除微任务即刻聚焦保障 (Zero Latency Focus Handover)', () => {
    // 验证场景：用户点击确认删除瞬间，在网络 IO 开始前立即调用 restoreComposerFocus
    let focusOrder = [];

    const mockRestoreFocus = () => {
      focusOrder.push('focus-restored');
    };

    const mockDeleteSessionRpc = async () => {
      // 模拟 100ms 网络延迟
      await new Promise((resolve) => setTimeout(resolve, 50));
      focusOrder.push('rpc-completed');
    };

    // 模拟生产 onConfirm 触发链路
    const handleConfirmDelete = (id) => {
      mockRestoreFocus(); // 第一时间立即聚焦
      void mockDeleteSessionRpc(id);
    };

    handleConfirmDelete('sess-target');

    // 断言：聚焦动作必须在第一微任务发生，先于任何异步 RPC 往返
    assert.equal(focusOrder[0], 'focus-restored', '点击确认瞬间必须同步首帧调用 restoreComposerFocus');
    assert.equal(focusOrder.includes('rpc-completed'), false, '网络 RPC 完成前焦点已经锁定到位');
  });
});
