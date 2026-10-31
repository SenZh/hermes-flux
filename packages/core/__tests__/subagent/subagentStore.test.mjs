import test from 'node:test';
import assert from 'node:assert/strict';
import { RingBuffer } from '../../dist/subagent/ringBuffer.js';
import { SubagentStore } from '../../dist/subagent/subagentStore.js';

test('RingBuffer - 内存定长截断与顺序保护 (Anti-OOM)', async (t) => {
  await t.test('1. 正向路径：定长写入与时间先后顺序导出', () => {
    // Arrange
    const rb = new RingBuffer(3);

    // Act
    rb.push('log-1');
    rb.push('log-2');

    // Assert
    assert.equal(rb.getSize(), 2);
    assert.deepEqual(rb.toArray(), ['log-1', 'log-2']);
  });

  await t.test('2. 极限边界：超出容量时自动挤出最旧数据，保持单调性', () => {
    // Arrange
    const rb = new RingBuffer(3);

    // Act
    rb.push('log-1');
    rb.push('log-2');
    rb.push('log-3');
    rb.push('log-4'); // 挤出 log-1
    rb.push('log-5'); // 挤出 log-2

    // Assert
    assert.equal(rb.getSize(), 3);
    assert.deepEqual(rb.toArray(), ['log-3', 'log-4', 'log-5']);
  });

  await t.test('3. 负向路径：非正数容量必须显式报错拒绝', () => {
    assert.throws(() => new RingBuffer(0), /capacity must be positive/);
    assert.throws(() => new RingBuffer(-5), /capacity must be positive/);
  });

  await t.test('4. 资源清空：clear 重置状态为 0', () => {
    const rb = new RingBuffer(5);
    rb.push('a');
    rb.push('b');
    rb.clear();
    assert.equal(rb.getSize(), 0);
    assert.deepEqual(rb.toArray(), []);
  });
});

test('SubagentStore - 子代理生命周期与穿透日志流状态机', async (t) => {
  await t.test('1. 任务创建、更新与会话维度检索', () => {
    // Arrange
    const store = new SubagentStore(100);
    let notifyCount = 0;
    const unsub = store.subscribe(() => {
      notifyCount++;
    });

    // Act
    store.upsertTask({
      subagentId: 'sub-1',
      parentSessionId: 'sess-A',
      targetProfile: 'arch-wang',
      taskTitle: '审查死锁',
      status: 'running',
      progressPercent: 20,
    });

    store.upsertTask({
      subagentId: 'sub-2',
      parentSessionId: 'sess-B',
      targetProfile: 'fe-zhang',
      taskTitle: '优化渲染',
      status: 'thinking',
    });

    // Assert
    assert.equal(notifyCount, 2);
    const sessATasks = store.getTasksBySession('sess-A');
    assert.equal(sessATasks.length, 1);
    assert.equal(sessATasks[0].subagentId, 'sub-1');
    assert.equal(sessATasks[0].targetProfile, 'arch-wang');

    const sessBTasks = store.getTasksBySession('sess-B');
    assert.equal(sessBTasks.length, 1);
    assert.equal(sessBTasks[0].subagentId, 'sub-2');

    unsub();
  });

  await t.test('2. 穿透日志流订阅与 RingBuffer 定长广播', () => {
    // Arrange
    const store = new SubagentStore(5);
    const receivedEntries = [];
    const unsubTail = store.subscribeTail('sub-stream-1', (entry) => {
      receivedEntries.push(entry);
    });

    // Act
    store.appendLog('sub-stream-1', { seq: 1, timestamp: 100, kind: 'stdout', text: 'line 1' });
    store.appendLog('sub-stream-1', { seq: 2, timestamp: 200, kind: 'thought', text: 'thinking...' });
    store.appendLog('sub-other', { seq: 3, timestamp: 300, kind: 'stdout', text: 'other line' });

    // Assert: 只有目标 subagentId 的监听器收到广播
    assert.equal(receivedEntries.length, 2);
    assert.equal(receivedEntries[0].text, 'line 1');
    assert.equal(receivedEntries[1].text, 'thinking...');

    // 缓存校验
    const logs = store.getLogs('sub-stream-1');
    assert.equal(logs.length, 2);

    unsubTail();
    store.appendLog('sub-stream-1', { seq: 4, timestamp: 400, kind: 'stdout', text: 'line after unsub' });
    assert.equal(receivedEntries.length, 2, '注销后不再接收推送');
  });

  await t.test('3. spawnSubagent：乐观反馈与真实 RPC 状态流转', async () => {
    // Arrange
    const store = new SubagentStore(100);
    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'subagent.spawn');
        return {
          subagent_id: 'sub-real-888',
          status: 'running',
        };
      },
    };

    // Act
    const task = await store.spawnSubagent(
      {
        parent_session_id: 'sess-100',
        target_profile: 'arch-wang',
        task_title: '推演并发竞态',
        instruction: '查锁',
      },
      mockBridge
    );

    // Assert
    assert.equal(task.subagentId, 'sub-real-888');
    assert.equal(task.status, 'running');
    assert.equal(task.parentSessionId, 'sess-100');
    assert.equal(store.getTask('sub-real-888')?.taskTitle, '推演并发竞态');
  });

  await t.test('4. steerSubagent：实时干预指令下发与日志记录', async () => {
    // Arrange
    const store = new SubagentStore(100);
    store.upsertTask({
      subagentId: 'sub-live-1',
      parentSessionId: 'sess-1',
      targetProfile: 'arch-wang',
      status: 'running',
    });

    let steeredInstruction = '';
    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'subagent.steer');
        steeredInstruction = params.instruction;
        return { accepted: true };
      },
    };

    // Act
    const accepted = await store.steerSubagent('sub-live-1', '优先分析读写锁', mockBridge);

    // Assert
    assert.equal(accepted, true);
    assert.equal(steeredInstruction, '优先分析读写锁');
    const logs = store.getLogs('sub-live-1');
    assert.ok(logs.some((l) => l.text.includes('优先分析读写锁')));
  });

  await t.test('5. interruptSubagent：乐观锁置灰与终止中断指令下发', async () => {
    // Arrange
    const store = new SubagentStore(100);
    store.upsertTask({
      subagentId: 'sub-kill-1',
      parentSessionId: 'sess-1',
      targetProfile: 'arch-wang',
      status: 'running',
    });

    let interruptedId = '';
    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'subagent.interrupt');
        interruptedId = params.subagent_id;
        return { interrupted: true };
      },
    };

    // Act
    const ok = await store.interruptSubagent('sub-kill-1', mockBridge);

    // Assert
    assert.equal(ok, true);
    assert.equal(interruptedId, 'sub-kill-1');
    const task = store.getTask('sub-kill-1');
    assert.equal(task?.status, 'interrupted');
    assert.ok(task?.completedAt);
  });

  await t.test('6. syncSessionSubagents：冷启动与重连数据批量回补', async () => {
    // Arrange
    const store = new SubagentStore(100);
    const mockBridge = {
      async request(method, params) {
        assert.equal(method, 'subagent.list');
        return {
          subagents: [
            {
              subagent_id: 'sub-remote-1',
              parent_session_id: 'sess-sync',
              profile: 'arch-wang',
              title: '远程历史任务',
              status: 'completed',
              progress: 100,
            },
          ],
        };
      },
    };

    // Act
    await store.syncSessionSubagents('sess-sync', mockBridge);

    // Assert
    const tasks = store.getTasksBySession('sess-sync');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].subagentId, 'sub-remote-1');
    assert.equal(tasks[0].status, 'completed');
  });
});
