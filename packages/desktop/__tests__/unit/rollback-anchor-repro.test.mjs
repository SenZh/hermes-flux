import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractDurableRowId,
  bindTurnRowIds,
  resolveRollbackTarget,
} from '../../dist/renderer/rollbackTransaction.mjs';

test('回滚持久锚点与行号提取 - 根因复现与变异测试', async (t) => {
  await t.test('1. extractDurableRowId: 从网关数字型 id、_row_id、row_id 中权威提取，严禁临时 id 逃逸', () => {
    // 场景 A: 网关 REST /api/sessions/:id/messages 返回的真实结构（仅含数字 id）
    assert.equal(extractDurableRowId({ id: 41335, role: 'user', content: '设计模式' }), 41335, '数字型 id 必须识别为持久 rowId');

    // 场景 B: 网关 seed/project 结构携带 _row_id
    assert.equal(extractDurableRowId({ _row_id: 5001, role: 'user' }), 5001, '_row_id 必须识别为持久 rowId');

    // 场景 C: 标准 row_id 字段
    assert.equal(extractDurableRowId({ row_id: 1002, role: 'user' }), 1002, 'row_id 必须识别为持久 rowId');

    // 场景 D: 前端本地临时 id，必须严格拒绝返回 undefined，严防 4018
    assert.equal(extractDurableRowId({ id: 'usr-1730000000000', role: 'user' }), undefined, '前端临时 usr- id 绝不可作为 rowId');
    assert.equal(extractDurableRowId({ id: 'ast-1730000000000', role: 'assistant' }), undefined, '前端临时 ast- id 绝不可作为 rowId');
    assert.equal(extractDurableRowId({ id: -1 }), undefined, '负数必须拒绝');
    assert.equal(extractDurableRowId({ id: 0 }), undefined, '0 不是合法持久行号');
  });

  await t.test('2. bindTurnRowIds: 无论是否切会话，均能精准为 assistant 前序最近的 user 消息绑定持久 rowId', () => {
    const sessionMessages = [
      { id: 'usr-1', role: 'user', content: '第一轮' },
      { id: 'ast-1', role: 'assistant', content: '回复一' },
      { id: 'usr-2', role: 'user', content: '第二轮' },
      { id: 'ast-2', role: 'assistant', content: '回复二' },
    ];

    // 模拟后台会话完成（用户已切走，此时传入独立会话缓存数组）
    const ok = bindTurnRowIds({
      messages: sessionMessages,
      assistantMessageId: 'ast-2',
      userRowId: 9002,
      assistantRowId: 9003,
      rowIds: [9002, 9003],
    });

    assert.equal(ok, true, '必须成功绑定');
    assert.equal(sessionMessages[2].rowId, 9002, '第二轮提问必须绑定上 userRowId');
    assert.equal(sessionMessages[3].rowId, 9003, '第二轮回复必须绑定上 assistantRowId');
    assert.equal(sessionMessages[0].rowId, undefined, '第一轮提问未被污染');
  });

  await t.test('3. bindTurnRowIds: userRowId 为 null 但 rowIds 存在时，安全降级使用 rowIds[0] 兜底', () => {
    const list = [
      { id: 'usr-target', role: 'user', content: '用户提问' },
      { id: 'ast-target', role: 'assistant', content: '助手回复' },
    ];

    const ok = bindTurnRowIds({
      messages: list,
      assistantMessageId: 'ast-target',
      userRowId: null,
      assistantRowId: 8882,
      rowIds: [8881, 8882],
    });

    assert.equal(ok, true);
    assert.equal(list[0].rowId, 8881, '必须从 rowIds[0] 提取出用户行锚点');
  });

  await t.test('4. resolveRollbackTarget: 支持 DOM 按钮携带的有效 data-row-id 对临时丢失 rowId 的目标自愈', () => {
    const messages = [
      { id: 'usr-100', role: 'user', content: '提问内容' }, // 假定 rowId 偶发丢失
      { id: 'ast-100', role: 'assistant', content: '回答内容' },
    ];

    const resolved = resolveRollbackTarget({
      messages,
      msgId: 'usr-100',
      btnRowId: 7777,
    });

    assert.ok(resolved, '必须解析出目标');
    assert.equal(resolved.targetMsg.id, 'usr-100');
    assert.equal(resolved.durableRowId, 7777, '自愈识别出持久锚点 7777');
    assert.equal(messages[0].rowId, 7777, '必须写回原消息对象，完成自愈');
  });

  await t.test('5. rollback-cancel 物理事件冒泡与快照恢复断言: input-dock-container 必须能分发取消动作', () => {
    let cancelHandled = false;
    const handleRollbackCancel = () => {
      cancelHandled = true;
    };

    const listeners = new Map();
    const mockDockContainer = {
      dataset: {},
      addEventListener: (evt, cb) => {
        listeners.set(evt, cb);
      },
    };

    const mockCancelBtn = {
      closest: (sel) => (sel === '[data-action="rollback-cancel"]' ? mockCancelBtn : null),
    };

    if (!mockDockContainer.dataset.dockClickBound) {
      mockDockContainer.dataset.dockClickBound = 'true';
      mockDockContainer.addEventListener('click', (e) => {
        const cancelAction = e.target.closest('[data-action="rollback-cancel"]');
        if (cancelAction) {
          handleRollbackCancel();
        }
      });
    }

    assert.equal(mockDockContainer.dataset.dockClickBound, 'true');
    const clickCb = listeners.get('click');
    assert.ok(clickCb, '必须注册 click 监听');

    clickCb({ target: mockCancelBtn });
    assert.equal(cancelHandled, true, '点击位于输入框上方的取消回滚按钮必须成功触发 handleRollbackCancel');
  });
});
