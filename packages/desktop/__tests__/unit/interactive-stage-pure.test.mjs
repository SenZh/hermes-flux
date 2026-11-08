import test from 'node:test';
import assert from 'node:assert/strict';

// 【反 AI 假测试门禁】真实导入生产构建产物，禁止测试内自写假实现自证。
import {
  applyOptimisticCut,
  planSessionLoadMerge,
  planRollbackLeaveRestore,
  takeServerPriority,
} from '../../dist/renderer/rollbackTransaction.mjs';
import { createToolPatchQueue } from '../../dist/renderer/toolPatchQueue.mjs';

test('回滚事务与工具补丁队列 - 生产模块真实单测与变异检验', async (t) => {
  await t.test('1. applyOptimisticCut: 锚点命中前缀裁撤，kept+removed 恒等原列表', () => {
    const msgs = [
      { id: 'usr-1', rowId: 101, role: 'user', content: 'A' },
      { id: 'ast-1', rowId: 102, role: 'assistant', content: 'B' },
      { id: 'usr-2', rowId: 201, role: 'user', content: 'C' },
      { id: 'ast-2', rowId: 202, role: 'assistant', content: 'D' },
    ];
    const original = msgs.map((m) => ({ ...m }));
    const cut = applyOptimisticCut(msgs, { kind: 'row', rowId: 201 });
    assert.ok(cut, '锚点存在必须返回切分');
    assert.deepEqual(cut.kept.map((m) => m.id), ['usr-1', 'ast-1']);
    assert.deepEqual(cut.removed.map((m) => m.id), ['usr-2', 'ast-2']);
    assert.deepEqual(
      [...cut.kept, ...cut.removed].map((m) => m.id),
      original.map((m) => m.id),
      '分解必须可逆恒等'
    );
    assert.equal(msgs.length, 4, '输入零变异');
  });

  await t.test('2. applyOptimisticCut: 锚点消失返回 null（绝不猜测切点）', () => {
    const msgs = [
      { id: 'usr-1', rowId: 101, role: 'user', content: 'A' },
      { id: 'ast-1', role: 'assistant', content: 'B' },
    ];
    assert.equal(applyOptimisticCut(msgs, { kind: 'row', rowId: 999 }), null, '不存在的 rowId 必须拒绝');
    assert.equal(applyOptimisticCut(msgs, { kind: 'none' }), null, '无锚点必须拒绝');
  });

  await t.test('2b. planSessionLoadMerge: server-priority 强制以服务端为准（防截断后消息复活）', () => {
    const parsed = [
      { id: 'row-1', role: 'user' },
      { id: 'row-2', role: 'assistant' },
    ];
    // 本地更长（含刚发送未落盘尾部）
    const existing = [
      { id: 'row-1', role: 'user' },
      { id: 'row-2', role: 'assistant' },
      { id: 'usr-3', role: 'user' },
    ];
    // 普通加载：保留本地未落盘尾部
    const keepLocal = planSessionLoadMerge(parsed, existing, false);
    assert.deepEqual(keepLocal.map((m) => m.id), ['row-1', 'row-2', 'usr-3'], '非截断加载保留本地更长尾部');
    // 截断成功后首次加载：即使本地更长也必须以服务端为准，绝不复活
    const serverFirst = planSessionLoadMerge(parsed, existing, true);
    assert.deepEqual(serverFirst.map((m) => m.id), ['row-1', 'row-2'], 'server-priority 必须丢弃本地尾部防复活');
  });

  await t.test('2c. planSessionLoadMerge: 不同源整体保留本地 / existing 缺失 / parsed 空 三负向分支', () => {
    const parsed = [
      { id: 'row-9', role: 'assistant' },
      { id: 'row-10', role: 'user' },
    ];
    // 不同源：existing 末尾 id 与 parsed 末尾 id 不匹配 → 整体保留本地更长列表，绝不用服务端覆盖
    const existingDifferentSource = [
      { id: 'usr-A', role: 'user' },
      { id: 'usr-B', role: 'assistant' },
      { id: 'usr-C', role: 'user' },
      { id: 'usr-D', role: 'assistant' },
    ];
    const merged = planSessionLoadMerge(parsed, existingDifferentSource, false);
    assert.deepEqual(merged.map((m) => m.id), ['usr-A', 'usr-B', 'usr-C', 'usr-D'], '不同源必须整体保留本地');

    // existing 缺失（首次加载）→ 直接采用权威
    assert.deepEqual(planSessionLoadMerge(parsed, undefined, false).map((m) => m.id), ['row-9', 'row-10']);

    // parsed 为空 + existing 更长 + 非 server-priority → 保留本地（Failure Is Not Empty）
    assert.deepEqual(
      planSessionLoadMerge([], [{ id: 'usr-1', role: 'user' }], false).map((m) => m.id),
      ['usr-1'],
      '权威空不得抹掉本地已有'
    );
    // parsed 为空 + server-priority → 以服务端空为准（截断清空场景）
    assert.deepEqual(planSessionLoadMerge([], [{ id: 'usr-1', role: 'user' }], true), [], 'server-priority 空权威必须清空');
  });

  await t.test('2c-2. planSessionLoadMerge: 增量追加与窗口滑动合并（含未落盘尾部保护）', () => {
    // 场景 1：服务端返回全局递增的新消息（例如本地已有 1-3，服务端返回 4-5，首尾 rowId 单调递增）
    const existingOld = [
      { id: 'row-1', rowId: 1, role: 'user' },
      { id: 'row-2', rowId: 2, role: 'assistant' },
      { id: 'row-3', rowId: 3, role: 'user' },
    ];
    const parsedNew = [
      { id: 'row-4', rowId: 4, role: 'assistant' },
      { id: 'row-5', rowId: 5, role: 'user' },
    ];
    const appended = planSessionLoadMerge(parsedNew, existingOld, false);
    assert.deepEqual(
      appended.map((m) => m.id),
      ['row-1', 'row-2', 'row-3', 'row-4', 'row-5'],
      '纯递增新消息必须安全追加到本地历史之后，绝不忽略'
    );

    // 场景 2：局部窗口滑动重叠（本地有 1, 2, 3，服务端返回 2, 3, 4，且本地包含正在发送的未落盘提问 usr-pending）
    const existingWithPending = [
      { id: 'row-1', rowId: 1, role: 'user' },
      { id: 'row-2', rowId: 2, role: 'assistant' },
      { id: 'row-3', rowId: 3, role: 'user' },
      { id: 'usr-pending', role: 'user' }, // 未落盘消息，无 rowId
    ];
    const parsedWindow = [
      { id: 'row-2', rowId: 2, role: 'assistant' },
      { id: 'row-3', rowId: 3, role: 'user' },
      { id: 'row-4', rowId: 4, role: 'assistant' },
    ];
    const windowMerged = planSessionLoadMerge(parsedWindow, existingWithPending, false);
    assert.deepEqual(
      windowMerged.map((m) => m.id),
      ['row-1', 'row-2', 'row-3', 'row-4', 'usr-pending'],
      '窗口重叠时必须拼接新消息同时完整保留本地未落盘尾部，符合 Failure-Is-Not-Empty 原则'
    );
  });

  await t.test('2d. planRollbackLeaveRestore: armed 会话匹配才恢复快照，跨会话只丢弃不污染', () => {
    const snapshot = [
      { id: 'usr-1', rowId: 101, role: 'user', content: 'A' },
      { id: 'ast-1', rowId: 102, role: 'assistant', content: 'B' },
    ];
    // 匹配当前离开的会话：返回恢复计划
    const plan = planRollbackLeaveRestore({ sessionId: 's1', snapshot }, 's1');
    assert.ok(plan);
    assert.equal(plan.restoreSessionId, 's1');
    assert.deepEqual(plan.restore.map((m) => m.id), ['usr-1', 'ast-1']);
    assert.notEqual(plan.restore[0], snapshot[0], '恢复必须是深拷贝，不共享引用');
    // 不匹配（armed 属于别的会话）：不恢复，绝不写进当前离开会话
    assert.equal(planRollbackLeaveRestore({ sessionId: 's1', snapshot }, 's2'), null);
    // 无 armed：无操作
    assert.equal(planRollbackLeaveRestore(null, 's1'), null);
  });

  await t.test('2e. takeServerPriority: 一次性消费即删除（接线级证伪）', () => {
    const trust = new Map();
    trust.set('s1', 'server-priority');
    assert.equal(takeServerPriority(trust, 's1'), true, '命中必须返回 true');
    assert.equal(trust.has('s1'), false, '消费后必须立即删除，禁止悬挂');
    assert.equal(takeServerPriority(trust, 's1'), false, '二次读取必须为 false（一次性）');
    assert.equal(takeServerPriority(trust, 's2'), false, '未标记会话返回 false');
    assert.equal(trust.has('s2'), false, '未标记会话不得被凭空写入');
  });

  await t.test('3. toolPatchQueue: 同帧多次事件合并为一次直写（Set 去重 + 单 RAF）', () => {
    let rafCb = null;
    const renderCalls = [];
    const q = createToolPatchQueue({
      renderSlot: (id) => {
        renderCalls.push(id);
        return `<span>${id}</span>`;
      },
      patchElement: () => true,
      isNearBottom: () => false,
      scrollBottom: () => {},
      markStructureDirty: () => {},
      schedule: (cb) => {
        rafCb = cb;
      },
    });

    q.schedulePatch('m1');
    q.schedulePatch('m1');
    q.schedulePatch('m2');
    assert.ok(rafCb, '必须安排一帧 RAF');
    rafCb();
    assert.deepEqual(renderCalls.sort(), ['m1', 'm2'], 'm1 去重，只各渲染一次');
  });

  await t.test('4. toolPatchQueue: 容器缺失回灌 structureDirty 全量兜底', () => {
    let dirty = 0;
    const q = createToolPatchQueue({
      renderSlot: () => '<x/>',
      patchElement: () => false,
      isNearBottom: () => false,
      scrollBottom: () => {},
      markStructureDirty: () => { dirty++; },
      schedule: (cb) => cb(),
    });
    q.schedulePatch('missing-row');
    assert.equal(dirty, 1, '锚点不存在必须置结构脏，交下次全量重建');
  });

  await t.test('5. toolPatchQueue: 帧尾仅在贴底时滚动一次；空队列不触发渲染', () => {
    let scrolls = 0;
    let rendered = 0;
    let rafCb = null;
    const q = createToolPatchQueue({
      renderSlot: () => { rendered++; return ''; },
      patchElement: () => true,
      isNearBottom: () => true,
      scrollBottom: () => { scrolls++; },
      markStructureDirty: () => {},
      schedule: (cb) => { rafCb = cb; },
    });
    q.schedulePatch('a');
    q.schedulePatch('b');
    rafCb();
    assert.equal(scrolls, 1, '一帧只写一次 scrollTop');
    assert.equal(rendered, 2);
    // 空队列 flush 不应产生额外渲染或滚动
    q.flush();
    assert.equal(rendered, 2, '空队列不渲染');
    assert.equal(scrolls, 1, '空队列不滚动');
  });

  await t.test('6. toolPatchQueue: clear 后丢弃挂起 id（防切会话残留污染）', () => {
    let rendered = 0;
    const q = createToolPatchQueue({
      renderSlot: () => { rendered++; return ''; },
      patchElement: () => true,
      isNearBottom: () => false,
      scrollBottom: () => {},
      markStructureDirty: () => {},
      schedule: () => {},
    });
    q.schedulePatch('a');
    q.clear();
    assert.equal(q.size, 0, 'clear 必须清空挂起集');
    assert.equal(rendered, 0);
    q.flush();
    assert.equal(rendered, 0, 'clear 后 flush 不得复活挂起 id');
  });
});
