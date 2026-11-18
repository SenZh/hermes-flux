/**
 * 会话视口滚动记忆状态机 (SessionScrollMemory) 行为与形式化安全测试
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionScrollMemory } from '../../dist/viewport/sessionScrollMemory.js';

test('SessionScrollMemory Unit & Invariants Tests', async (t) => {
  await t.test('1. 新会话默认输出 pin-to-bottom', () => {
    const memory = new SessionScrollMemory();
    const strategy = memory.planSessionEnter('session-brand-new');
    assert.deepEqual(strategy, { type: 'pin-to-bottom', reason: 'new-session' });
    assert.deepEqual(memory.planSessionEnter(''), { type: 'pin-to-bottom', reason: 'new-session' });
  });

  await t.test('2. 离开时处于贴底区 (<=48px) 时，恢复决策恒为 pin-to-bottom', () => {
    const memory = new SessionScrollMemory({ nearBottomThresholdPx: 48 });
    // scrollHeight: 2000, clientHeight: 800, scrollTop: 1180 => 距离底部 20px <= 48px
    memory.recordSnapshot({
      sessionId: 'session-tail',
      scrollTop: 1180,
      scrollHeight: 2000,
      clientHeight: 800,
      anchorMessageId: 'msg-99',
    });

    const strategy = memory.planSessionEnter('session-tail');
    assert.deepEqual(strategy, { type: 'pin-to-bottom', reason: 'was-near-bottom' });
  });

  await t.test('3. 离开时处于历史回溯区，优先输出带比例的 restore-anchor', () => {
    const memory = new SessionScrollMemory({ nearBottomThresholdPx: 48 });
    // scrollHeight: 5000, clientHeight: 800, scrollTop: 1200 => 距离底部 3000px > 48px
    memory.recordSnapshot({
      sessionId: 'session-history',
      scrollTop: 1200,
      scrollHeight: 5000,
      clientHeight: 800,
      anchorMessageId: 'msg-42',
      anchorOffsetRatio: 0.35,
    });

    const snapshot = memory.getSnapshot('session-history');
    assert.ok(snapshot);
    assert.equal(snapshot.anchorMessageId, 'msg-42');
    assert.equal(snapshot.anchorOffsetRatio, 0.35);

    const strategy = memory.planSessionEnter('session-history');
    assert.equal(strategy.type, 'restore-anchor');
    if (strategy.type === 'restore-anchor') {
      assert.equal(strategy.anchorMessageId, 'msg-42');
      assert.equal(strategy.anchorOffsetRatio, 0.35);
      assert.equal(strategy.fallbackScrollTop, 1200);
    }
  });

  await t.test('4. 回溯区无锚点消息 ID 时降级为 restore-scroll-top，防御空 ID', () => {
    const memory = new SessionScrollMemory();
    memory.recordSnapshot({
      sessionId: '', // 空 sessionId 安全忽略
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 500,
    });
    assert.equal(memory.size, 0);

    memory.recordSnapshot({
      sessionId: 'session-no-anchor',
      scrollTop: 850,
      scrollHeight: 3000,
      clientHeight: 600,
    });

    // 覆盖已有 sessionId 刷新
    memory.recordSnapshot({
      sessionId: 'session-no-anchor',
      scrollTop: 860,
      scrollHeight: 3000,
      clientHeight: 600,
    });

    const strategy = memory.planSessionEnter('session-no-anchor');
    assert.deepEqual(strategy, { type: 'restore-scroll-top', scrollTop: 860 });
  });

  await t.test('5. LRU 严格容量上限证明 (有界性定理)', () => {
    const maxEntries = 5;
    const memory = new SessionScrollMemory({ maxEntries });

    for (let i = 1; i <= 8; i++) {
      memory.recordSnapshot({
        sessionId: `ses-${i}`,
        scrollTop: i * 100,
        scrollHeight: 2000,
        clientHeight: 500,
      });
    }

    assert.equal(memory.size, 5, '缓存容量不得超过 maxEntries');
    // ses-1, ses-2, ses-3 应该已经被淘汰
    assert.deepEqual(memory.planSessionEnter('ses-1'), { type: 'pin-to-bottom', reason: 'new-session' });
    assert.deepEqual(memory.planSessionEnter('ses-2'), { type: 'pin-to-bottom', reason: 'new-session' });
    assert.deepEqual(memory.planSessionEnter('ses-3'), { type: 'pin-to-bottom', reason: 'new-session' });
    // ses-8 仍然存在
    const s8 = memory.planSessionEnter('ses-8');
    assert.equal(s8.type, 'restore-scroll-top');
  });

  await t.test('6. deleteSession 与 clear 彻底释放记忆', () => {
    const memory = new SessionScrollMemory();
    memory.recordSnapshot({
      sessionId: 'ses-del',
      scrollTop: 300,
      scrollHeight: 1000,
      clientHeight: 400,
    });
    assert.equal(memory.size, 1);

    memory.deleteSession('ses-del');
    assert.equal(memory.size, 0);
    assert.deepEqual(memory.planSessionEnter('ses-del'), { type: 'pin-to-bottom', reason: 'new-session' });

    memory.recordSnapshot({
      sessionId: 'ses-clear-1',
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 400,
    });
    assert.equal(memory.size, 1);
    memory.clear();
    assert.equal(memory.size, 0);
  });

  await t.test('7. 构造函数参数全路径覆盖', () => {
    const memory = new SessionScrollMemory({ maxEntries: 20, nearBottomThresholdPx: 64 });
    assert.equal(memory.size, 0);

    const clampedMemory = new SessionScrollMemory({ maxEntries: -5, nearBottomThresholdPx: -10 });
    assert.equal(clampedMemory.size, 0);
  });

  await t.test('8. 分支覆盖：非法数值触发安全回退', () => {
    const memory = new SessionScrollMemory({ maxEntries: 0, nearBottomThresholdPx: -5 });
    assert.equal(memory.size, 0);
  });

  await t.test('9. 恰好等于贴底阈值时必须按贴底处理（边界不可差一）', () => {
    const memory = new SessionScrollMemory({ nearBottomThresholdPx: 48 });
    // 2000 - (1152 + 800) = 48，恰好等于阈值
    memory.recordSnapshot({ sessionId: 'edge-tail', scrollTop: 1152, scrollHeight: 2000, clientHeight: 800 });
    assert.deepEqual(memory.planSessionEnter('edge-tail'), { type: 'pin-to-bottom', reason: 'was-near-bottom' });
  });

  await t.test('10. LRU 触达必须刷新热度：淘汰最久未用而不是最早写入', () => {
    const memory = new SessionScrollMemory({ maxEntries: 3 });
    for (const id of ['a', 'b', 'c']) {
      memory.recordSnapshot({ sessionId: id, scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    }
    // 触达 a：a 变成最新，b 成为最久未用
    memory.planSessionEnter('a');
    memory.recordSnapshot({ sessionId: 'd', scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });

    assert.ok(memory.getSnapshot('a'), '被触达的会话不得被淘汰，否则切回即丢位置');
    assert.equal(memory.getSnapshot('b'), undefined, '最久未用的会话必须被淘汰');
    assert.ok(memory.getSnapshot('c'), '未触达但更近使用的会话必须保留');
    assert.ok(memory.getSnapshot('d'), '刚写入的会话必须保留');
    assert.equal(memory.size, 3);
  });

  await t.test('11. 容量未满时不得淘汰任何会话', () => {
    const memory = new SessionScrollMemory({ maxEntries: 5 });
    for (const id of ['x', 'y']) {
      memory.recordSnapshot({ sessionId: id, scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    }
    assert.ok(memory.getSnapshot('x'), '容量未满时写入新会话不得连带淘汰旧会话');
    assert.ok(memory.getSnapshot('y'));
    assert.equal(memory.size, 2);
  });

  await t.test('12. capturedAt 与锚点比例只接受合法数值', () => {
    const memory = new SessionScrollMemory();
    memory.recordSnapshot({
      sessionId: 'dirty',
      scrollTop: 100,
      scrollHeight: 2000,
      clientHeight: 400,
      anchorMessageId: 'm1',
      anchorOffsetRatio: Number.NaN,
      now: 0,
    });
    const snapshot = memory.getSnapshot('dirty');
    assert.equal(snapshot?.capturedAt, 0, '显式 now=0 必须原样保留，不能被逻辑或换成当前时间');
    assert.equal(snapshot?.anchorOffsetRatio, undefined, 'NaN 比例必须被丢弃而不是写进记忆');

    memory.recordSnapshot({
      sessionId: 'dirty-2',
      scrollTop: 100,
      scrollHeight: 2000,
      clientHeight: 400,
      anchorMessageId: 'm1',
      anchorOffsetRatio: 2,
      now: 10,
    });
    assert.equal(memory.getSnapshot('dirty-2')?.anchorOffsetRatio, 1, '越界比例必须夹到 [0,1]');
  });

  await t.test('13. 同一会话重复记录必须刷新为最新热度', () => {
    const memory = new SessionScrollMemory({ maxEntries: 2 });
    memory.recordSnapshot({ sessionId: 'a', scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    memory.recordSnapshot({ sessionId: 'b', scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });

    // 再次记录 a：即使没有切走过，它也必须变成最新
    memory.recordSnapshot({ sessionId: 'a', scrollTop: 120, scrollHeight: 1000, clientHeight: 200 });
    memory.recordSnapshot({ sessionId: 'c', scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });

    assert.ok(memory.getSnapshot('a'), '重复记录必须刷新热度，否则刚离开的会话会被当场淘汰');
    assert.equal(memory.getSnapshot('a')?.scrollTop, 120, '重复记录必须覆盖为新位置');
    assert.equal(memory.getSnapshot('b'), undefined, '此时最久未用的必须是 b');
    assert.equal(memory.size, 2);
  });

  await t.test('14. 未显式给 now 时 capturedAt 必须取当前时间', () => {
    const memory = new SessionScrollMemory();
    const before = Date.now();
    memory.recordSnapshot({ sessionId: 'auto-now', scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    const capturedAt = memory.getSnapshot('auto-now')?.capturedAt ?? 0;
    assert.ok(capturedAt >= before, '缺省 now 时必须回落到当前时间戳');
    assert.ok(capturedAt <= Date.now());
  });

  await t.test('15. 容量未满时重复记录也必须是「移到末尾」而非原地保留', () => {
    const memory = new SessionScrollMemory({ maxEntries: 3 });
    memory.recordSnapshot({ sessionId: 'p', scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    memory.recordSnapshot({ sessionId: 'q', scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    // 重复记录 p：此时容量未满，若实现只在「已满」时才维护顺序，p 会原地不动
    memory.recordSnapshot({ sessionId: 'p', scrollTop: 88, scrollHeight: 1000, clientHeight: 200 });
    memory.recordSnapshot({ sessionId: 'r', scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    memory.recordSnapshot({ sessionId: 's', scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });

    assert.ok(memory.getSnapshot('p'), 'p 刚被重新记录过，不得先于 q 被淘汰');
    assert.equal(memory.getSnapshot('q'), undefined, '此时最久未用的必须是 q');
    assert.equal(memory.getSnapshot('p')?.scrollTop, 88, '重复记录必须覆盖为新位置');
    assert.equal(memory.size, 3);
  });

  await t.test('17. 视觉贴底（末行对齐输入舱安全线）必须记为贴底，不得记成回溯态', () => {
    const memory = new SessionScrollMemory({ nearBottomThresholdPx: 48 });
    memory.recordSnapshot({
      sessionId: 'ses-visual-bottom',
      scrollTop: 19080,
      scrollHeight: 20000,
      clientHeight: 760,
      anchorMessageId: 'msg-mid',
      anchorOffsetRatio: 0.5,
      nearBottomReservePx: 160,
    });

    assert.equal(memory.getSnapshot('ses-visual-bottom')?.isNearBottom, true, 'gutter 内必须判定为贴底');
    assert.deepEqual(memory.planSessionEnter('ses-visual-bottom'), {
      type: 'pin-to-bottom',
      reason: 'was-near-bottom',
    });
  });

  await t.test('18. 未传 reserve 时保持既有 48px 语义（旧调用方不得被改变）', () => {
    const memory = new SessionScrollMemory({ nearBottomThresholdPx: 48 });
    memory.recordSnapshot({
      sessionId: 'ses-legacy',
      scrollTop: 19080,
      scrollHeight: 20000,
      clientHeight: 760,
      anchorMessageId: 'msg-mid',
    });

    assert.equal(memory.getSnapshot('ses-legacy')?.isNearBottom, false, '缺省 reserve 时必须沿用 48px 判据');
    assert.equal(memory.planSessionEnter('ses-legacy').type, 'restore-anchor');
  });

  await t.test('19. reserve 只能放宽阈值，不得收窄；非法 reserve 一律忽略', () => {
    const memory = new SessionScrollMemory({ nearBottomThresholdPx: 48 });
    // 距离 60px：reserve=0 时阈值仍是 48，必须判为非贴底
    memory.recordSnapshot({
      sessionId: 'ses-narrow',
      scrollTop: 0,
      scrollHeight: 1060,
      clientHeight: 1000,
      nearBottomReservePx: 0,
    });
    assert.equal(memory.getSnapshot('ses-narrow')?.isNearBottom, false, 'reserve 不得把阈值压到 48 以下');

    // 距离 60px + reserve=160 ⇒ 阈值 max(48, 168)=168，必须判为贴底
    memory.recordSnapshot({
      sessionId: 'ses-wide',
      scrollTop: 0,
      scrollHeight: 1060,
      clientHeight: 1000,
      nearBottomReservePx: 160,
    });
    assert.equal(memory.getSnapshot('ses-wide')?.isNearBottom, true);

    // 非法 reserve（NaN / 负数 / 字符串）必须按未传处理，退回 48px
    for (const bad of [Number.NaN, -100, '160']) {
      memory.recordSnapshot({
        sessionId: `ses-bad-${String(bad)}`,
        scrollTop: 0,
        scrollHeight: 1060,
        clientHeight: 1000,
        nearBottomReservePx: bad,
      });
      assert.equal(
        memory.getSnapshot(`ses-bad-${String(bad)}`)?.isNearBottom,
        false,
        `非法 reserve=${String(bad)} 必须被忽略，退回 48px 判据`
      );
    }
  });

  await t.test('16. 非数值比例必须被丢弃，不得被隐式转成数字', () => {
    const memory = new SessionScrollMemory();
    memory.recordSnapshot({
      sessionId: 'str-ratio',
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 200,
      anchorMessageId: 'm-1',
      anchorOffsetRatio: '0.5',
    });
    assert.equal(
      memory.getSnapshot('str-ratio')?.anchorOffsetRatio,
      undefined,
      '字符串比例必须丢弃：Math.min 会把它隐式转成 0.5，等于接受脏数据'
    );
  });
});
