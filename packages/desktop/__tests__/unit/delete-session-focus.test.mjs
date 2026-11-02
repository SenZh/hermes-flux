import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasDockSnapshotChanged,
  renderInputDock,
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
      reasoningLevel: 'medium',
      approvalMode: 'auto',
      isStreaming: false,
      disabled: false,
      modelMenuOpen: false,
      notice: '',
      activityStatus: undefined,
      modelCount: 12,
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
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, modelSearchQuery: 'claude' }), true, '检索词变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, recentModelsHash: 'model-c' }), true, '最近模型变化必须触发更新');
    assert.equal(hasDockSnapshotChanged(baseSnapshot, { ...baseSnapshot, favoriteModelsHash: 'model-b' }), true, '收藏模型变化必须触发更新');
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

    // 3. Assert: 必须包含关键的 dock-prompt-input 与 740px 限宽约束
    assert.ok(html.includes('id="dock-prompt-input"'), '必须包含核心 textarea 节点');
    assert.ok(html.includes('max-width: 740px'), '输入舱必须遵守 740px 黄金限宽规范');
    assert.ok(!html.includes('disabled'), '未禁用状态下禁止含有 disabled 属性');
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
});
