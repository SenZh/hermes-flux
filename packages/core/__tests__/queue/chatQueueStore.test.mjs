import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatQueueStore } from '../../dist/queue/chatQueueStore.js';

test('ChatQueueStore - 消息队列不可变冻结、调序与生命周期测试', async (t) => {
  await t.test('1. Happy Path: 入队、不可变快照冻结与 FIFO 出队', () => {
    const store = new ChatQueueStore();
    const item = store.enqueue({
      sessionId: 'sess-1',
      text: '请帮我写单测',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      attachments: [{ id: 'att-1', name: 'test.ts', type: 'file', sizeBytes: 100 }],
    });

    assert.ok(item.id.startsWith('queue-'));
    assert.equal(store.getItems('sess-1').length, 1);
    assert.equal(store.peekNext('sess-1')?.text, '请帮我写单测');

    // 变异验证：修改入参对象不影响 store 内快照
    const popped = store.popNext('sess-1');
    assert.equal(popped?.text, '请帮我写单测');
    assert.equal(popped?.model, 'claude-3-7-sonnet');
    assert.equal(store.getItems('sess-1').length, 0);
  });

  await t.test('2. 自由调序与上移/下移边界测试', () => {
    const store = new ChatQueueStore();
    const a = store.enqueue({ sessionId: 's1', text: 'Task A', provider: 'p', model: 'm', attachments: [] });
    const b = store.enqueue({ sessionId: 's1', text: 'Task B', provider: 'p', model: 'm', attachments: [] });
    const c = store.enqueue({ sessionId: 's1', text: 'Task C', provider: 'p', model: 'm', attachments: [] });

    // 初始顺序: A, B, C
    assert.deepEqual(store.getItems('s1').map(i => i.text), ['Task A', 'Task B', 'Task C']);

    // C 上移 => A, C, B
    const movedUp = store.moveUp(c.id);
    assert.ok(movedUp);
    assert.deepEqual(store.getItems('s1').map(i => i.text), ['Task A', 'Task C', 'Task B']);

    // A 下移 => C, A, B
    const movedDown = store.moveDown(a.id);
    assert.ok(movedDown);
    assert.deepEqual(store.getItems('s1').map(i => i.text), ['Task C', 'Task A', 'Task B']);

    // 自由调序: 把索引 2 (B) 移到索引 0 => B, C, A
    const reordered = store.reorder('s1', 2, 0);
    assert.ok(reordered);
    assert.deepEqual(store.getItems('s1').map(i => i.text), ['Task B', 'Task C', 'Task A']);

    // 越界保护
    assert.equal(store.reorder('s1', -1, 2), false);
    assert.equal(store.reorder('s1', 0, 5), false);
    assert.equal(store.moveUp(b.id), false, '首项上移必须返回 false');
  });

  await t.test('3. 会话隔离性：不同 session 的队列互不干扰', () => {
    const store = new ChatQueueStore();
    store.enqueue({ sessionId: 's1', text: 'S1 Task', provider: 'p', model: 'm', attachments: [] });
    store.enqueue({ sessionId: 's2', text: 'S2 Task', provider: 'p', model: 'm', attachments: [] });

    assert.equal(store.getItems('s1').length, 1);
    assert.equal(store.getItems('s2').length, 1);

    const popped = store.popNext('s1');
    assert.equal(popped?.text, 'S1 Task');
    assert.equal(store.getItems('s1').length, 0);
    assert.equal(store.getItems('s2').length, 1, 's2 队列不应受 s1 弹出影响');
  });

  await t.test('4. 附件内存释放与销毁回调生命周期', () => {
    const store = new ChatQueueStore();
    const revoked = [];
    store.onAttachmentRevoke = (att) => {
      revoked.push(att.id);
    };

    const item = store.enqueue({
      sessionId: 's1',
      text: '带图片',
      provider: 'p',
      model: 'm',
      attachments: [
        { id: 'img-1', name: 'screenshot.png', type: 'image', sizeBytes: 2048, previewUrl: 'blob:mock-1' },
        { id: 'doc-2', name: 'spec.pdf', type: 'pdf', sizeBytes: 5000 },
      ],
    });

    // 移除单项
    const removed = store.remove(item.id);
    assert.ok(removed);
    assert.deepEqual(revoked, ['img-1', 'doc-2'], '移除排队项时必须触发所有附件的内存销毁回调');
    assert.equal(store.getItems('s1').length, 0);
  });

  await t.test('5. 负向拦截：空会话与空内容必须报错拒绝', () => {
    const store = new ChatQueueStore();
    assert.throws(() => {
      store.enqueue({ sessionId: '', text: 'Hello', provider: 'p', model: 'm', attachments: [] });
    }, /Session ID is mandatory/);

    assert.throws(() => {
      store.enqueue({ sessionId: 's1', text: '', provider: 'p', model: 'm', attachments: [] });
    }, /Cannot enqueue empty message/);
  });

  await t.test('6. 响应式订阅与取消订阅', () => {
    const store = new ChatQueueStore();
    let broadcastCount = 0;
    const unsubscribe = store.subscribe(() => {
      broadcastCount++;
    });

    store.enqueue({ sessionId: 's1', text: 'A', provider: 'p', model: 'm', attachments: [] });
    store.enqueue({ sessionId: 's1', text: 'B', provider: 'p', model: 'm', attachments: [] });
    assert.equal(broadcastCount, 2);

    unsubscribe();
    store.enqueue({ sessionId: 's1', text: 'C', provider: 'p', model: 'm', attachments: [] });
    assert.equal(broadcastCount, 2, '取消订阅后不应再收到广播');
  });

  await t.test('7. clear: 全量清空与按会话清空，断言触发 onAttachmentRevoke', () => {
    const store = new ChatQueueStore();
    const revoked = [];
    store.onAttachmentRevoke = (att) => {
      revoked.push(att.id);
    };

    store.enqueue({
      sessionId: 's1',
      text: 'S1 msg',
      provider: 'p',
      model: 'm',
      attachments: [{ id: 'att-s1', name: 's1.png', type: 'image', sizeBytes: 100 }],
    });
    store.enqueue({
      sessionId: 's2',
      text: 'S2 msg',
      provider: 'p',
      model: 'm',
      attachments: [{ id: 'att-s2', name: 's2.png', type: 'image', sizeBytes: 100 }],
    });

    // 1. 按会话清空 s1
    store.clear('s1');
    assert.equal(store.getItems('s1').length, 0, 's1 队列必须被清空');
    assert.equal(store.getItems('s2').length, 1, 's2 队列不受影响');
    assert.deepEqual(revoked, ['att-s1'], '必须且仅释放 s1 的附件内存');

    // 2. 全量清空
    store.clear();
    assert.equal(store.getItems().length, 0, '全量队列必须被清空');
    assert.deepEqual(revoked, ['att-s1', 'att-s2'], 's2 附件内存也必须被释放');
  });
});
