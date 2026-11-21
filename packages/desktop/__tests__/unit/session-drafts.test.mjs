/**
 * 会话草稿持久化的行为测试。
 *
 * 【设计意图 (Why)】
 *   历史实现是「调用方 set 完再手动调 persistDraftsToStorage()」，
 *   漏调任何一处就丢草稿，而且不会有任何报错。抽出成 store 后
 *   "落盘"与"写入"合成一个动作，本测试要证明这个合并真的成立：
 *   每一次写操作都必须同时改变内存态与存储态。
 *
 * 【防范的历史坑 (Pitfall)】
 *   不能只断言内存态。只断言内存会让"忘了落盘"永远绿——
 *   那正是原实现最典型的失败方式（重启后草稿消失）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionDraftStore,
  SESSION_DRAFT_STORAGE_KEY,
  isCorruptedSystemErrorDraft,
} from '../../dist/renderer/persistence/sessionDrafts.mjs';

/** 可控 storage 替身 */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    dump: () => (map.has(SESSION_DRAFT_STORAGE_KEY) ? JSON.parse(map.get(SESSION_DRAFT_STORAGE_KEY)) : null),
  };
}

test('drafts · set 必须同时改内存与存储（否则重启后丢草稿）', () => {
  const storage = makeStorage();
  const store = createSessionDraftStore({ storage });

  store.set('sess-1', '未发送的提问');

  assert.equal(store.get('sess-1'), '未发送的提问', '内存态必须更新');
  assert.deepEqual(storage.dump(), { 'sess-1': '未发送的提问' }, '必须落盘，否则重启后丢失');
});

test('drafts · delete 必须同时清内存与存储', () => {
  const storage = makeStorage();
  const store = createSessionDraftStore({ storage });
  store.set('sess-1', 'x');
  store.delete('sess-1');

  assert.equal(store.get('sess-1'), '', '内存必须清空');
  assert.deepEqual(storage.dump(), {}, '存储必须同步清空');
});

test('drafts · 空白草稿等价于没有草稿：不得写进内存或存储', () => {
  const storage = makeStorage();
  const store = createSessionDraftStore({ storage });

  store.set('sess-1', '   \n\t ');
  assert.equal(store.has('sess-1'), false, '空白不得被视为草稿');
  // 未发生任何写入时存储里可以没有该键，也可能是空对象；两者都表达「没有草稿」
  assert.deepEqual(storage.dump() ?? {}, {}, '空白不得落盘为有效草稿');

  // 已有草稿被改成空白 → 应当被删除
  store.set('sess-1', 'real draft');
  store.set('sess-1', '  ');
  assert.equal(store.has('sess-1'), false, '改成空白必须删除');
  assert.deepEqual(storage.dump() ?? {}, {}, '存储不得残留空白项');
});

test('drafts · 恢复只接受非空字符串，脏数据逐条丢弃', () => {
  const storage = makeStorage({
    [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({
      good: 'draft',
      blank: '   ',
      num: 123,
      nul: null,
      obj: { a: 1 },
    }),
  });
  const store = createSessionDraftStore({ storage });

  assert.equal(store.has('good'), true);
  assert.equal(store.has('blank'), false, '空白值必须丢弃');
  assert.equal(store.has('num'), false, '非字符串必须丢弃');
  assert.equal(store.has('obj'), false);
  assert.equal(store.snapshot().size, 1);
});

test('drafts · 恢复遇到损坏 JSON 不得抛出，也不得污染状态', () => {
  const storage = makeStorage({ [SESSION_DRAFT_STORAGE_KEY]: '{ broken' });
  assert.doesNotThrow(() => createSessionDraftStore({ storage }));
  const store = createSessionDraftStore({ storage });
  assert.equal(store.snapshot().size, 0);
});

test('drafts · 落盘失败不得抛出，但必须经观测通道留痕', () => {
  const errors = [];
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceeded'); },
  };
  const store = createSessionDraftStore({ storage, onPersistError: (e) => errors.push(e) });

  assert.doesNotThrow(() => store.set('sess-1', 'x'), '存储失败不得阻断发送流程');
  assert.equal(store.get('sess-1'), 'x', '内存态仍必须正确');
  assert.equal(errors.length >= 1, true, '失败必须留痕，不得完全静默');
});

test('drafts · 空 sessionId 是无效操作：不写、不落盘', () => {
  const storage = makeStorage();
  const store = createSessionDraftStore({ storage });
  store.set('', 'x');
  store.delete('');
  assert.equal(store.snapshot().size, 0);
  assert.equal(storage.dump(), null, '不应产生落盘');
});

test('drafts · 多会话互不串扰（切会话不覆盖他人草稿）', () => {
  const storage = makeStorage();
  const store = createSessionDraftStore({ storage });
  store.set('a', 'A 的草稿');
  store.set('b', 'B 的草稿');

  assert.equal(store.get('a'), 'A 的草稿');
  assert.equal(store.get('b'), 'B 的草稿');
  assert.deepEqual(storage.dump(), { a: 'A 的草稿', b: 'B 的草稿' });
});

test('drafts · 反复删除同一会话是幂等的，且不产生多余落盘', () => {
  const storage = makeStorage();
  let writes = 0;
  const wrapped = {
    getItem: storage.getItem,
    setItem: (k, v) => { writes += 1; storage.setItem(k, v); },
  };
  const store = createSessionDraftStore({ storage: wrapped });
  store.set('a', 'x');
  const afterSet = writes;

  store.delete('a');
  store.delete('a');
  store.delete('a');
  assert.equal(writes, afterSet + 1, '第一次 delete 落盘，后续幂等不得再写');
});

test('drafts · 报错草稿防污染（防范系统执行失败文本持久化跨会话阴魂不散）', () => {
  const errMsg1 = "指令 /compress 执行失败: RPC request 'slash.exec' with id 74 timed out after 25000ms";
  const errMsgChinesePure = "指令 /compress 执行失败: 未知错误或者参数无效";
  const errMsg2 = "Command /plan failed: Network down";
  const errMsg3 = "skill command: use command.dispatch for /human-writing";
  const normalText = "请帮我重构一下 /compress 相关逻辑";

  assert.equal(isCorruptedSystemErrorDraft(errMsg1), true, '中文指令报错必须识别为损坏草稿');
  assert.equal(isCorruptedSystemErrorDraft(errMsgChinesePure), true, '无 RPC 超时特征的纯中文指令报错也必须识别为损坏草稿');
  assert.equal(isCorruptedSystemErrorDraft(errMsg2), true, '英文指令报错必须识别为损坏草稿');
  assert.equal(isCorruptedSystemErrorDraft(errMsg3), true, 'RPC 调度提示必须识别为损坏草稿');
  assert.equal(isCorruptedSystemErrorDraft(normalText), false, '正常用户输入绝不得被误杀');

  const storage = makeStorage({
    [SESSION_DRAFT_STORAGE_KEY]: JSON.stringify({
      'sess-clean': '正常提问',
      'sess-corrupted': errMsg1,
    }),
  });
  const store = createSessionDraftStore({ storage });

  assert.equal(store.has('sess-clean'), true);
  assert.equal(store.has('sess-corrupted'), false, '启动恢复时损坏报错草稿必须被彻底清除');
  assert.equal(store.get('sess-corrupted'), '', '损坏草稿读取必须回退为空');
  assert.deepEqual(storage.dump(), { 'sess-clean': '正常提问' }, '盘面必须自动重洗落盘，消除脏数据');

  // 尝试 set 写入报错草稿应当被拒绝并等价于删除
  store.set('sess-clean', errMsg2);
  assert.equal(store.has('sess-clean'), false, '写入报错草稿必须被阻断并直接清除');
  assert.deepEqual(storage.dump() ?? {}, {}, '存储不得残留报错草稿');
});
