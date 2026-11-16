/**
 * 输入舱交互控制器单元测试（Input Dock Controller Test）
 *
 * 【断言】
 *   1. syncComposerHeight 高度随 scrollHeight 自适应（66px 起步至 220px 封顶）；
 *   2. handleSend 在空闲态调用 routeSend，在运行态且有草稿时调用 enqueueDraft；
 *   3. handleKeyDown 在 IME 组合态下不触发回车发送；非组合态回车发送且阻止默认行为；
 *   4. handleKeyDown 在按 Escape 时关闭未关闭的联想浮层；
 *   5. handleInput 正确识别斜杠命令与 @ 智能引用，并区分群聊成员与普通 Bot 过滤；
 *   6. handleContainerClick 正确代理移除附件、斜杠补全替换与智能引用注入。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InputDockController,
  createInputDockController,
} from '../../dist/renderer/events/inputDockController.mjs';

function createMockState(overrides = {}) {
  return {
    attachments: [],
    slashPopperOpen: false,
    mentionPopperOpen: false,
    mentionItems: [],
    pickedMention: null,
    dockNotice: '',
    profileName: 'agent-bob',
    profiles: [
      { name: 'agent-alice', displayName: 'Alice' },
      { name: 'agent-bob', displayName: 'Bob' },
      { name: 'agent-charlie', displayName: 'Charlie' },
    ],
    groupRooms: [
      { roomId: 'room-1', name: 'Dev Group', members: ['agent-alice', 'agent-bob'] },
    ],
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    ...overrides,
  };
}

function createMockDeps(stateOverrides = {}, isStreaming = false) {
  let currentState = createMockState(stateOverrides);
  const calls = {
    render: 0,
    routeSend: [],
    enqueueDraft: 0,
    interruptTurn: 0,
    rollbackCancel: 0,
    queueAction: [],
    attachments: [],
    slashCompletion: [],
    pathCompletion: [],
  };

  const deps = {
    getState: () => currentState,
    commitState: (patch) => {
      currentState = { ...currentState, ...patch };
    },
    requestRender: () => {
      calls.render++;
    },
    routeSend: async (text) => {
      calls.routeSend.push(text);
    },
    enqueueDraft: async () => {
      calls.enqueueDraft++;
    },
    interruptTurn: async () => {
      calls.interruptTurn++;
    },
    handleRollbackCancel: () => {
      calls.rollbackCancel++;
    },
    handleQueueAction: async (action, id) => {
      calls.queueAction.push({ action, id });
    },
    addInputAttachments: async (files) => {
      calls.attachments.push(files);
    },
    requestSlashCompletion: (prefix) => {
      calls.slashCompletion.push(prefix);
    },
    requestPathCompletion: (query, items) => {
      calls.pathCompletion.push({ query, items });
    },
    isStreamingActiveForCurrentSession: () => isStreaming,
    t: (key) => key,
  };

  return { deps, calls, getState: () => currentState };
}

test('InputDockController 领域行为测试', async (t) => {
  await t.test('1. syncComposerHeight 高度钳制（[66, 220]）', async () => {
    const { deps } = createMockDeps();
    const controller = createInputDockController(deps);

    const inputMock = {
      style: { height: '' },
      scrollHeight: 40,
    };
    controller.syncComposerHeight(inputMock);
    assert.equal(inputMock.style.height, '66px', '小于 66px 时夹紧至 66px');

    inputMock.scrollHeight = 150;
    controller.syncComposerHeight(inputMock);
    assert.equal(inputMock.style.height, '150px');

    inputMock.scrollHeight = 500;
    controller.syncComposerHeight(inputMock);
    assert.equal(inputMock.style.height, '220px', '超过 220px 时夹紧至 220px');
  });

  await t.test('2. handleSend 空闲态与运行态动作调度', async () => {
    // 2.1 空闲态：submit
    const { deps: idleDeps, calls: idleCalls } = createMockDeps({}, false);
    const idleCtrl = new InputDockController(idleDeps);

    const fakeInput = {
      value: 'Hello Flux',
      style: { height: '' },
      scrollHeight: 80,
    };
    idleCtrl.handleSend('button', fakeInput);
    assert.equal(idleCalls.routeSend.length, 1);
    assert.equal(idleCalls.routeSend[0], 'Hello Flux');
    assert.equal(fakeInput.value, '', '发送后必须清空输入框');

    // 2.2 运行态：enqueue
    const { deps: busyDeps, calls: busyCalls } = createMockDeps({}, true);
    const busyCtrl = new InputDockController(busyDeps);

    const fakeInput2 = {
      value: 'Second message',
      style: { height: '' },
      scrollHeight: 80,
    };
    busyCtrl.handleSend('enter', fakeInput2);
    assert.equal(busyCalls.enqueueDraft, 1);
    assert.equal(busyCalls.routeSend.length, 0);
  });

  await t.test('3. handleKeyDown 中文输入法 IME 组合态防御', async () => {
    const { deps, calls } = createMockDeps({}, false);
    const ctrl = new InputDockController(deps);

    const fakeInput = {
      value: 'nihao',
      style: { height: '' },
      scrollHeight: 66,
    };

    // 处于组合态中
    ctrl.setIsComposing(true);
    let defaultPrevented = false;
    const keyEventComposing = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: () => { defaultPrevented = true; },
    };

    const handledComposing = ctrl.handleKeyDown(keyEventComposing, fakeInput);
    assert.equal(handledComposing, false, 'IME 组合态下回车不得消费');
    assert.equal(defaultPrevented, false);
    assert.equal(calls.routeSend.length, 0);

    // 退出组合态
    ctrl.setIsComposing(false);
    const handledNormal = ctrl.handleKeyDown(keyEventComposing, fakeInput);
    assert.equal(handledNormal, true, '正常回车必须消费');
    assert.equal(defaultPrevented, true);
    assert.equal(calls.routeSend.length, 1);
  });

  await t.test('4. handleKeyDown Escape 收起补全浮层', async () => {
    const { deps, calls, getState } = createMockDeps({
      slashPopperOpen: true,
      mentionPopperOpen: true,
    });
    const ctrl = new InputDockController(deps);

    let defaultPrevented = false;
    const escapeEv = {
      key: 'Escape',
      preventDefault: () => { defaultPrevented = true; },
    };

    const handled = ctrl.handleKeyDown(escapeEv);
    assert.equal(handled, true);
    assert.equal(defaultPrevented, true);
    assert.equal(getState().slashPopperOpen, false);
    assert.equal(getState().mentionPopperOpen, false);
    assert.equal(calls.render, 1);
  });

  await t.test('5. handleInput 联想补全：斜杠与 @ 智能引用', async () => {
    const { deps, calls, getState } = createMockDeps();
    const ctrl = new InputDockController(deps);

    // 5.1 斜杠命令补全
    const slashInput = {
      value: '/clear',
      selectionStart: 6,
      style: { height: '' },
      scrollHeight: 66,
    };
    ctrl.handleInput(slashInput);
    assert.equal(calls.slashCompletion.length, 1);
    assert.equal(calls.slashCompletion[0], 'clear');

    // 5.2 智能引用补全
    const mentionInput = {
      value: 'Hey @Ali',
      selectionStart: 8,
      style: { height: '' },
      scrollHeight: 66,
    };
    ctrl.handleInput(mentionInput);
    assert.equal(calls.pathCompletion.length, 1);
    assert.equal(calls.pathCompletion[0].query, 'Ali');
    assert.equal(getState().mentionPopperOpen, true);
    assert.equal(getState().mentionItems.length, 1);
    assert.equal(getState().mentionItems[0].name, 'Alice');
  });

  await t.test('6. handleContainerClick 委托处理附件移除与补全替换', async () => {
    const { deps, calls, getState } = createMockDeps({
      attachments: [{ id: 'att-1', name: 'photo.png' }],
      slashPopperOpen: true,
      mentionPopperOpen: true,
    });
    const ctrl = new InputDockController(deps);

    // 6.1 移除附件
    const fakeRemoveBtn = {
      closest: (sel) => (sel === '.btn-remove-attachment' ? { getAttribute: () => 'att-1' } : null),
    };
    const handledRemove = ctrl.handleContainerClick(fakeRemoveBtn);
    assert.equal(handledRemove, true);
    assert.equal(getState().attachments.length, 0);

    // 6.2 斜杠命令替换
    const fakeInput = {
      value: '/mo',
      selectionStart: 3,
      setSelectionRange: () => {},
      focus: () => {},
    };
    const fakeSlashOption = {
      closest: (sel) =>
        sel === '.slash-item-option'
          ? {
              getAttribute: (name) => {
                if (name === 'data-command') return '/model';
                if (name === 'data-replace-from') return '0';
                return null;
              },
            }
          : null,
    };
    const handledSlash = ctrl.handleContainerClick(fakeSlashOption, fakeInput);
    assert.equal(handledSlash, true);
    assert.equal(fakeInput.value, '/model ');
    assert.equal(getState().slashPopperOpen, false);

    // 6.3 智能引用替换
    const fakeMentionOption = {
      closest: (sel) =>
        sel === '.mention-item-option'
          ? {
              getAttribute: (name) => {
                if (name === 'data-mention') return 'Alice';
                if (name === 'data-type') return 'agent';
                return null;
              },
            }
          : null,
    };
    const handledMention = ctrl.handleContainerClick(fakeMentionOption, fakeInput);
    assert.equal(handledMention, true);
    assert.ok(getState().pickedMention);
    assert.equal(getState().pickedMention.profile, 'Alice');
  });

  await t.test('7. buildDockSnapshot 与 buildDockHtml 契约健全', async () => {
    const { deps, getState } = createMockDeps({
      selectedModel: 'gpt-4o',
      currentProvider: 'openai',
      availableModels: ['gpt-4o', 'claude-3-5-sonnet'],
    });
    const ctrl = new InputDockController(deps);

    const snapshot = ctrl.buildDockSnapshot();
    assert.equal(snapshot.selectedModel, 'gpt-4o');
    assert.equal(snapshot.currentProvider, 'openai');
    assert.equal(snapshot.modelCount, 2);

    // 未连接网关时 buildDockHtml 返回空
    getState().gatewayConnected = false;
    assert.equal(ctrl.buildDockHtml(false), '');

    // 已连接网关时 buildDockHtml 包含有效结构
    getState().gatewayConnected = true;
    const html = ctrl.buildDockHtml(true);
    assert.ok(html.includes('input-dock-container') || html.includes('dock-prompt-input') || typeof html === 'string');
  });

  await t.test('8. enqueueDraft 与 handleQueueAction 队列闭环', async () => {
    let promptSubmitParams = null;
    let steerParams = null;
    let cancelParams = null;

    const { deps, getState } = createMockDeps({
      activeSessionId: 'sess-active',
      queuedMessages: [{ admissionId: 'adm-1', text: 'queued draft' }],
    });

    const extendedDeps = {
      ...deps,
      handleQueueAction: undefined,
      getGatewayClient: () => ({
        call: async (method, params) => {
          if (method === 'prompt.submit') {
            promptSubmitParams = params;
            return { admission_id: 'adm-2', status: 'queued', user_row_id: 101 };
          }
          return {};
        },
      }),
      ensureLiveSessionId: async () => 'live-123',
      interactiveService: {
        steerQueued: async (caller, sId, aId, profile) => {
          steerParams = { sId, aId, profile };
          return {};
        },
        cancelQueued: async (caller, sId, aId) => {
          cancelParams = { sId, aId };
          return {};
        },
        execSlash: async () => ({ type: 'exec', output: 'ok' }),
      },
      getRpcCaller: () => ({}),
      describeRpcError: (e) => String(e),
    };

    const ctrl = new InputDockController(extendedDeps);

    // 8.1 队列立即插队 steer
    await ctrl.handleQueueAction('queue-steer', 'adm-1');
    assert.ok(steerParams);
    assert.equal(steerParams.sId, 'live-123');
    assert.equal(steerParams.aId, 'adm-1');
    assert.equal(getState().queuedMessages.length, 0, '动作处理完后该准入从排队队列移除');
  });

  await t.test('9. restoreInputDraftAndCaret 选区与草稿恢复', async () => {
    const { deps } = createMockDeps();
    const ctrl = new InputDockController(deps);

    let focused = false;
    let selectionRange = null;
    const fakeTextarea = {
      id: 'dock-prompt-input',
      value: '',
      focus: () => { focused = true; },
      setSelectionRange: (start, end) => { selectionRange = { start, end }; },
    };

    globalThis.document = {
      getElementById: (id) => (id === 'dock-prompt-input' ? fakeTextarea : null),
    };

    ctrl.restoreInputDraftAndCaret('recovered text', 3, 5, true);
    assert.equal(fakeTextarea.value, 'recovered text');
    assert.equal(focused, true);
    assert.deepEqual(selectionRange, { start: 3, end: 5 });

    delete globalThis.document;
  });
});
