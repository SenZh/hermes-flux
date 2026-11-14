/**
 * 全局模态弹窗与右键菜单交互控制器单元测试（Modal Interaction Controller Test）
 *
 * 【断言】
 *   1. closeConfirmModal('ok') 触发 onConfirm，并先置空 state.confirmModal；
 *   2. closeConfirmModal('cancel') 优先触发 onCancel，无 onCancel 时兜底调用 restoreComposerFocus()；
 *   3. handleGlobalEscape 与 handleGlobalEnter 在有确认弹窗时正确拦截并分发；
 *   4. submitTaskModal 单人模式调用 createNewSession，群聊模式补足成员并调用 createGroupRoom / openGroupRoom；
 *   5. handleContextMenuAction 正确分发各右键指令并弹出危险操作确认；
 *   6. closeContextMenuIfClickedOutside 在菜单外部点击时关闭菜单。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ModalInteractionController,
  createModalInteractionController,
} from '../../dist/renderer/events/modalInteractionController.mjs';

function createMockState(overrides = {}) {
  return {
    confirmModal: undefined,
    isNewTaskModalOpen: true,
    newTaskModalTab: 'solo',
    profileName: 'agent-alice',
    sessionContextMenu: undefined,
    editingGroupRoomId: undefined,
    dockNotice: '',
    sessions: [
      { id: 'sess-1', title: 'Session 1' },
      { id: 'sess-2', title: 'Session 2' },
    ],
    activeFocus: { type: 'session', sessionId: 'sess-1' },
    ...overrides,
  };
}

function createMockDeps(stateOverrides = {}) {
  let currentState = createMockState(stateOverrides);
  const calls = {
    render: 0,
    restoreFocus: 0,
    newSession: [],
    deleteSession: [],
    renameSession: [],
    pinSession: [],
    archiveSession: [],
    exportMarkdown: [],
    copySessionId: [],
    openBotChat: [],
    openBotSettings: [],
    openGroupRoom: [],
    createGroupRoom: [],
    disbandGroupRoom: [],
    fetchGroupRooms: 0,
  };

  const deps = {
    getState: () => currentState,
    commitState: (patch) => {
      currentState = { ...currentState, ...patch };
    },
    requestRender: () => {
      calls.render++;
    },
    restoreComposerFocus: () => {
      calls.restoreFocus++;
    },
    createNewSession: async (options) => {
      calls.newSession.push(options);
    },
    deleteSession: async (id) => {
      calls.deleteSession.push(id);
    },
    renameSession: async (id, title) => {
      calls.renameSession.push({ id, title });
    },
    pinSession: async (id) => {
      calls.pinSession.push(id);
    },
    archiveSession: async (id) => {
      calls.archiveSession.push(id);
    },
    exportMarkdown: async (id) => {
      calls.exportMarkdown.push(id);
    },
    copySessionId: async (id) => {
      calls.copySessionId.push(id);
    },
    openBotChat: (profile) => {
      calls.openBotChat.push(profile);
    },
    openBotSettings: (profile) => {
      calls.openBotSettings.push(profile);
    },
    openGroupRoom: async (roomId) => {
      calls.openGroupRoom.push(roomId);
    },
    createGroupRoom: async (title, members) => {
      calls.createGroupRoom.push({ title, members });
      return { room_id: 'room-new-123' };
    },
    disbandGroupRoom: async (roomId) => {
      calls.disbandGroupRoom.push(roomId);
    },
    fetchGroupRooms: async () => {
      calls.fetchGroupRooms++;
    },
    t: (key, params) => `${key}:${JSON.stringify(params || {})}`,
  };

  return { deps, calls, getState: () => currentState };
}

test('ModalInteractionController 领域行为测试', async (t) => {
  await t.test('1. closeConfirmModal("ok") 触发 onConfirm 并先清空弹窗状态', async () => {
    let confirmCalled = false;
    let stateAtConfirm = null;
    const { deps, calls, getState } = createMockDeps({
      confirmModal: {
        title: 'Delete?',
        message: 'Are you sure?',
        onConfirm: () => {
          confirmCalled = true;
          stateAtConfirm = getState().confirmModal;
        },
      },
    });

    const controller = createModalInteractionController(deps);
    controller.closeConfirmModal('ok');

    assert.equal(confirmCalled, true);
    assert.equal(stateAtConfirm, undefined, '确认回调执行时 confirmModal 必须已经清空');
    assert.equal(getState().confirmModal, undefined);
    assert.equal(calls.render, 1);
  });

  await t.test('2. closeConfirmModal("cancel") 触发 onCancel 或兜底 restoreComposerFocus', async () => {
    let cancelCalled = false;
    const { deps, calls } = createMockDeps({
      confirmModal: {
        title: 'Cancel?',
        message: 'Cancel?',
        onCancel: () => {
          cancelCalled = true;
        },
      },
    });

    const controller = new ModalInteractionController(deps);
    controller.closeConfirmModal('cancel');

    assert.equal(cancelCalled, true);
    assert.equal(calls.restoreFocus, 0, '有 onCancel 时不执行默认焦点恢复');

    // 测试没有 onCancel 时的兜底
    const { deps: depsNoCancel, calls: callsNoCancel } = createMockDeps({
      confirmModal: {
        title: 'Cancel?',
        message: 'Cancel?',
      },
    });
    const controller2 = new ModalInteractionController(depsNoCancel);
    controller2.closeConfirmModal('cancel');
    assert.equal(callsNoCancel.restoreFocus, 1, '无 onCancel 时执行兜底焦点恢复');
  });

  await t.test('3. 全局按键 Escape 与 Enter 拦截', async () => {
    let confirmed = false;
    let cancelled = false;

    const { deps } = createMockDeps({
      confirmModal: {
        title: 'Test',
        message: 'Test',
        onConfirm: () => { confirmed = true; },
        onCancel: () => { cancelled = true; },
      },
    });

    const controller = new ModalInteractionController(deps);
    assert.equal(controller.handleGlobalEscape(), true);
    assert.equal(cancelled, true);

    deps.commitState({
      confirmModal: {
        title: 'Test',
        message: 'Test',
        onConfirm: () => { confirmed = true; },
      },
    });

    assert.equal(controller.handleGlobalEnter(), true);
    assert.equal(confirmed, true);

    // 弹窗为空时均返回 false
    assert.equal(controller.handleGlobalEscape(), false);
    assert.equal(controller.handleGlobalEnter(), false);
  });

  await t.test('4. submitTaskModal 单人模式与群聊模式分流', async () => {
    const { deps, calls, getState } = createMockDeps();
    const controller = new ModalInteractionController(deps);

    // 单人模式
    controller.setModalTab('solo');
    controller.setSelectedAgent('agent-bob');
    await controller.submitTaskModal({ title: 'My Task', projectId: 'p-1' });

    assert.equal(calls.newSession.length, 1);
    assert.deepEqual(calls.newSession[0], {
      profile: 'agent-bob',
      projectId: 'p-1',
      title: 'My Task',
    });
    assert.equal(getState().isNewTaskModalOpen, false);

    // 群聊模式：不足 2 人时自动补齐
    controller.setModalTab('group');
    controller.setSelectedAgent('agent-carol');
    await controller.submitTaskModal({ title: 'My Group', members: ['agent-carol'] });

    assert.equal(calls.createGroupRoom.length, 1);
    assert.equal(calls.createGroupRoom[0].title, 'My Group');
    assert.deepEqual(calls.createGroupRoom[0].members, ['agent-carol', 'default']);
    assert.equal(calls.openGroupRoom.length, 1);
    assert.equal(calls.openGroupRoom[0], 'room-new-123');
    assert.equal(calls.fetchGroupRooms, 1);
  });

  await t.test('5. handleContextMenuAction 右键动作分发与删除确认', async () => {
    const { deps, calls, getState } = createMockDeps({
      sessionContextMenu: {
        x: 100,
        y: 100,
        targetType: 'session',
        targetId: 'sess-1',
        targetName: 'Session 1',
      },
    });

    const controller = new ModalInteractionController(deps);

    // 1. rename
    controller.handleContextMenuAction('rename');
    assert.equal(calls.renameSession.length, 1);
    assert.equal(calls.renameSession[0].id, 'sess-1');
    assert.equal(getState().sessionContextMenu, undefined, '动作执行后菜单必须关闭');

    // 2. copy-id
    controller.handleContextMenuAction('copy-id', { targetId: 'sess-2', targetName: 'Session 2' });
    assert.equal(calls.copySessionId.length, 1);
    assert.equal(calls.copySessionId[0], 'sess-2');

    // 3. delete 发起危险确认
    controller.handleContextMenuAction('delete', { targetId: 'sess-1', targetName: 'Session 1' });
    const modal = getState().confirmModal;
    assert.ok(modal);
    assert.equal(modal.isDanger, true);
    // 执行 onConfirm
    modal.onConfirm();
    assert.equal(calls.deleteSession.length, 1);
    assert.equal(calls.deleteSession[0], 'sess-1');
  });

  await t.test('6. closeContextMenuIfClickedOutside 点击外部关闭菜单', async () => {
    const { deps, getState } = createMockDeps({
      sessionContextMenu: {
        x: 10,
        y: 20,
        targetType: 'bot',
        targetId: 'bot-1',
      },
    });

    const controller = new ModalInteractionController(deps);
    const mockMenu = {
      contains: (node) => node && node.id === 'inside-node',
    };

    // 点在内部不关闭
    const insideRes = controller.closeContextMenuIfClickedOutside({ id: 'inside-node' }, mockMenu);
    assert.equal(insideRes, false);
    assert.ok(getState().sessionContextMenu);

    // 点在外部关闭
    const outsideRes = controller.closeContextMenuIfClickedOutside({ id: 'outside-node' }, mockMenu);
    assert.equal(outsideRes, true);
    assert.equal(getState().sessionContextMenu, undefined);
  });
});
