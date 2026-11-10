import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldExpandWindow, shouldSettleInitialBottom } from '../../dist/renderer/messageWindow.mjs';

/**
 * 首屏落定与扩窗授权纯逻辑单测。
 *
 * 【设计意图 (Why)】
 *   冷启动渲染缓存会话时 `scrollTop` 初值为 0，视口天然"落在窗口上沿之上"，
 *   与读者向上回溯在 scroll 事件里同形。这两条判据决定"谁有权搬动窗口"与
 *   "何时把视口贴回最新消息"，判错任何一侧都会让读者打开会话后停在会话中部。
 *
 * 【断言口径】
 *   每条断言都给出可证伪的具体布尔值，且正反两侧同时覆盖，禁止 `assert.ok(x)` 这类恒真写法。
 */

const SESSION = 's-1128';

test('TC-101 读者未回溯过时禁止扩窗', () => {
  assert.equal(
    shouldExpandWindow({
      sessionId: SESSION,
      readerScrolledSessionId: '',
      total: 1128,
      capacity: 120,
    }),
    false
  );
  // 反向证据：同一会话记录过读者回溯后必须放行
  assert.equal(
    shouldExpandWindow({
      sessionId: SESSION,
      readerScrolledSessionId: SESSION,
      total: 1128,
      capacity: 120,
    }),
    true
  );
});

test('TC-102 其他会话的回溯记录不得授权本会话', () => {
  assert.equal(
    shouldExpandWindow({
      sessionId: SESSION,
      readerScrolledSessionId: 's-other',
      total: 1128,
      capacity: 120,
    }),
    false
  );
});

test('TC-103 总数未超过容量时不存在可扩内容', () => {
  assert.equal(
    shouldExpandWindow({
      sessionId: SESSION,
      readerScrolledSessionId: SESSION,
      total: 120,
      capacity: 120,
    }),
    false
  );
  assert.equal(
    shouldExpandWindow({
      sessionId: SESSION,
      readerScrolledSessionId: SESSION,
      total: 121,
      capacity: 120,
    }),
    true
  );
  // 异常入参兜底，绝不抛错
  assert.equal(
    shouldExpandWindow({ sessionId: '', readerScrolledSessionId: '', total: Number.NaN, capacity: 120 }),
    false
  );
});

test('TC-104 布局指纹变化要求重新落定首屏', () => {
  const base = {
    sessionId: SESSION,
    readerScrolledSessionId: '',
    atTail: true,
    settledSignature: '918:121.70',
    currentSignature: '918:121.70',
    drifted: false,
  };
  // 指纹相同且未漂移：已落定，不重跑
  assert.equal(shouldSettleInitialBottom(base), false);
  // 消息补齐：条数变化
  assert.equal(shouldSettleInitialBottom({ ...base, currentSignature: '1128:121.70' }), true);
  // 行高锁定：条数不变但口径变化
  assert.equal(shouldSettleInitialBottom({ ...base, currentSignature: '918:167.97' }), true);
  // 脱离一屏以上：即使指纹已记录也要重落定
  assert.equal(shouldSettleInitialBottom({ ...base, drifted: true }), true);
});

test('TC-105 读者回溯过或窗口未覆盖末尾时绝不自动落定', () => {
  const base = {
    sessionId: SESSION,
    readerScrolledSessionId: '',
    atTail: true,
    settledSignature: '',
    currentSignature: '1128:121.70',
    drifted: true,
  };
  assert.equal(shouldSettleInitialBottom(base), true);
  assert.equal(shouldSettleInitialBottom({ ...base, readerScrolledSessionId: SESSION }), false);
  assert.equal(shouldSettleInitialBottom({ ...base, atTail: false }), false);
  assert.equal(shouldSettleInitialBottom({ ...base, sessionId: '' }), false);
});
