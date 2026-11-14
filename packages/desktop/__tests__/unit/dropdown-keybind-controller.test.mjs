import test from 'node:test';
import assert from 'node:assert/strict';

import { createDropdownKeybindController } from '../../dist/renderer/dropdownKeybindController.mjs';

test('DropdownKeybindController - 模型下拉与全局热键领域纯行为测试', async (t) => {
  function createHarness() {
    const state = {
      modelSearchQuery: 'claude',
      modelMenuOpen: true,
      selectedModel: 'anthropic/claude-3-opus',
      currentProvider: 'anthropic',
      availableModels: ['anthropic/claude-3-opus'],
      favoriteModels: [],
      recentModels: [],
      collapsedProviders: [],
      reasoningLevel: 'default',
      approvalMode: 'manual',
      isStreaming: false,
      leftRailCollapsed: false,
      inspectorCollapsed: false,
      isSettingsOpen: false,
      settingsSection: 'general',
    };

    let lastDock = {
      modelSearchQuery: 'claude',
      selectedModel: 'anthropic/claude-3-opus',
    };

    const sideEffects = {
      renders: 0,
      switchedModel: null,
      switchedReasoning: null,
      ensuredSection: null,
      escapedModal: false,
      enteredModal: false,
    };

    const controller = createDropdownKeybindController({
      getState: () => state,
      render: () => {
        sideEffects.renders += 1;
      },
      switchModel: async (model, provider) => {
        sideEffects.switchedModel = { model, provider };
      },
      switchReasoning: async (level) => {
        sideEffects.switchedReasoning = level;
      },
      modalInteractionController: {
        handleGlobalEscape: () => sideEffects.escapedModal,
        handleGlobalEnter: () => sideEffects.enteredModal,
        closeContextMenuIfClickedOutside: () => {},
      },
      ensureSettingsSectionData: (sec) => {
        sideEffects.ensuredSection = sec;
      },
      getLastInputDockSnapshot: () => lastDock,
      setLastInputDockSnapshot: (snapshot) => {
        lastDock = snapshot;
      },
    });

    return { state, controller, sideEffects, getLastDock: () => lastDock };
  }

  await t.test('1. pickReasoningLevel 校验白名单并分发合法思考等级', () => {
    const { controller, sideEffects } = createHarness();
    const fakeInvalidItem = {
      getAttribute: () => 'invalid-level',
    };
    controller.pickReasoningLevel(fakeInvalidItem);
    assert.equal(sideEffects.switchedReasoning, null);

    const fakeValidItem = {
      getAttribute: () => 'high',
    };
    controller.pickReasoningLevel(fakeValidItem);
    assert.equal(sideEffects.switchedReasoning, 'high');
  });

  await t.test('2. resetModelSearchOnOpen 清空搜索词并同步 inputDock 快照', () => {
    const { state, controller, getLastDock } = createHarness();
    assert.equal(state.modelSearchQuery, 'claude');

    controller.resetModelSearchOnOpen();
    assert.equal(state.modelSearchQuery, '');
    assert.equal(getLastDock().modelSearchQuery, '');
  });

  await t.test('3. closeModelMenu 关闭下拉状态并触发 render', () => {
    const { state, controller, sideEffects } = createHarness();
    assert.equal(state.modelMenuOpen, true);

    controller.closeModelMenu();
    assert.equal(state.modelMenuOpen, false);
    assert.ok(sideEffects.renders >= 1);
  });

  await t.test('4. setupGlobalKeybinds 快捷键分发逻辑', () => {
    const { state, controller, sideEffects } = createHarness();

    const listeners = [];
    const mockWindow = {
      addEventListener: (type, handler) => {
        listeners.push({ type, handler });
      },
      removeEventListener: () => {},
    };

    const cleanup = controller.setupGlobalKeybinds(mockWindow);
    assert.equal(listeners.length, 1);
    const keyHandler = listeners[0].handler;

    // Ctrl + B -> toggle leftRailCollapsed
    state.leftRailCollapsed = false;
    let prevented = false;
    keyHandler({ ctrlKey: true, key: 'b', preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(state.leftRailCollapsed, true);

    // Ctrl + \ -> toggle inspectorCollapsed
    state.inspectorCollapsed = false;
    prevented = false;
    keyHandler({ ctrlKey: true, key: '\\', preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(state.inspectorCollapsed, true);

    // Ctrl + , -> toggle isSettingsOpen
    state.isSettingsOpen = false;
    prevented = false;
    keyHandler({ ctrlKey: true, key: ',', preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(state.isSettingsOpen, true);
    assert.equal(sideEffects.ensuredSection, 'general');

    // Escape -> closeModelMenu
    state.modelMenuOpen = true;
    state.isSettingsOpen = false;
    keyHandler({ key: 'Escape' });
    assert.equal(state.modelMenuOpen, false);

    cleanup();
  });

  await t.test('5. dispose 释放定时器与事件清理', () => {
    const { controller } = createHarness();
    assert.doesNotThrow(() => {
      controller.dispose();
    });
  });
});
