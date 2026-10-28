import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenCoalescer } from '../../dist/coalesce/tokenCoalescer.js';

test('TokenCoalescer Streaming Coalescing Engine Unit Tests', async (t) => {
  await t.test('Coalescer should buffer multiple deltas and flush as a single batch', () => {
    let flushedBatches = [];
    const coalescer = new TokenCoalescer((batch) => {
      flushedBatches.push(batch);
    });

    coalescer.push({ messageId: 'msg-1', delta: 'Hello ' });
    coalescer.push({ messageId: 'msg-1', delta: 'Hermes ' });
    coalescer.push({ messageId: 'msg-1', delta: 'Aura!' });

    assert.equal(flushedBatches.length, 0, 'Should not flush synchronously before flush()');

    coalescer.flush();

    assert.equal(flushedBatches.length, 1, 'Should have exactly 1 flushed batch');
    const msg1 = flushedBatches[0].get('msg-1');
    assert.ok(msg1, 'Batch must contain msg-1');
    assert.equal(msg1.content, 'Hello Hermes Aura!');
    assert.equal(msg1.thought, '');
  });

  await t.test('Coalescer should distinguish reasoning thoughts and content chunks', () => {
    let flushedBatches = [];
    const coalescer = new TokenCoalescer((batch) => {
      flushedBatches.push(batch);
    });

    coalescer.push({ messageId: 'msg-2', delta: 'Thinking step 1... ', isThought: true });
    coalescer.push({ messageId: 'msg-2', delta: 'Thinking step 2.', isThought: true });
    coalescer.push({ messageId: 'msg-2', delta: 'Final Answer.', isThought: false });

    coalescer.flush();

    assert.equal(flushedBatches.length, 1);
    const msg2 = flushedBatches[0].get('msg-2');
    assert.equal(msg2.thought, 'Thinking step 1... Thinking step 2.');
    assert.equal(msg2.content, 'Final Answer.');
  });

  await t.test('Coalescer clear() should discard pending buffer', () => {
    let flushedBatches = [];
    const coalescer = new TokenCoalescer((batch) => {
      flushedBatches.push(batch);
    });

    coalescer.push({ messageId: 'msg-3', delta: 'Discard me' });
    coalescer.clear();
    coalescer.flush();

    assert.equal(flushedBatches.length, 0, 'Flushed batch should be empty after clear()');
  });
});
