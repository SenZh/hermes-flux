/**
 * Bot 主工位活动持久化的行为测试。
 *
 * 【设计意图 (Why)】
 *   该领域抽出前藏在 12000 行的 index.ts 里，19 个测试文件全部只做
 *   `readFileSync` + 正则断言源码，没有任何一个真正执行它。
 *   因此"冷启动不闪现旧时间戳"这条保护实际上从未被验证过。
 *   这里用可控 localStorage 与真实 core 纯函数，验证四件事：
 *   1. 恢复只接受合法记录（timestamp 必须是数字），脏数据被逐条丢弃；
 *   2. 更新会同时改内存、改 profile 列表、并落盘；
 *   3. 落盘失败不得中断更新（内存态仍然正确）；
 *   4. 借用 Map 的通道确实能让 core 的写入回到同一份状态。
 *
 * 【防范的历史坑 (Pitfall)】
 *   历史缺陷是"该 Map 仅纯内存，刷新后丢失，冷启动回退到普通会话池"。
 *   因此第 2 条必须断言"落盘内容里能看到这次更新"，否则刷新后依然会丢。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotActivityStore, BOT_ACTIVITY_PERSISTENCE_KEY } from '../../dist/renderer/persistence/botActivityStore.mjs';

/** 最小可控 localStorage 替身 */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    raw: map,
  };
}

/** 安装到全局，返回卸载函数 */
function installStorage(storage) {
  const prev = globalThis.localStorage;
  globalThis.localStorage = storage;
  return () => {
    if (prev === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prev;
  };
}

const formatTime = (ts) => `t${ts}`;

function makeHost(profiles = []) {
  let current = [...profiles];
  return {
    host: {
      profiles: () => current,
      setProfiles: (next) => { current = next; },
      formatTime,
    },
    read: () => current,
  };
}

test('botActivity · restore 只接受 timestamp 为数字的记录，脏数据逐条丢弃', (t) => {
  const storage = makeStorage({
    [BOT_ACTIVITY_PERSISTENCE_KEY]: JSON.stringify({
      good: { lastMessage: 'hello', timestamp: 1000 },
      badNoTs: { lastMessage: 'x' },
      badTsType: { lastMessage: 'x', timestamp: 'not-a-number' },
      notObject: 'nope',
    }),
  });
  const uninstall = installStorage(storage);
  t.after(uninstall);

  const { host } = makeHost();
  const store = createBotActivityStore(host);
  store.restore();

  const snap = store.snapshot();
  assert.equal(snap.size, 1, '只有一条合法记录应被接受');
  assert.equal(snap.get('good').lastMessage, 'hello');
  assert.equal(snap.get('good').timestamp, 1000);
  assert.equal(snap.has('badTsType'), false, 'timestamp 非数字必须丢弃（否则排序会得到 NaN）');
});

test('botActivity · restore 遇到损坏 JSON 不得抛出，且不得污染状态', (t) => {
  const storage = makeStorage({ [BOT_ACTIVITY_PERSISTENCE_KEY]: '{ not json' });
  const uninstall = installStorage(storage);
  t.after(uninstall);

  const { host } = makeHost();
  const store = createBotActivityStore(host);
  store.restore();
  assert.equal(store.snapshot().size, 0);
});

test('botActivity · updateLatestActivity 同时更新 profile、内存映射并落盘', (t) => {
  const storage = makeStorage();
  const uninstall = installStorage(storage);
  t.after(uninstall);

  const { host, read } = makeHost([
    { name: 'aura', displayName: 'Aura', lastMessage: '', timestamp: 0 },
  ]);
  const store = createBotActivityStore(host);
  store.restore();
  // 毫秒级时间戳：> 1e11，core 会原样保留（秒级输入会被 ×1000）
  const MS = 1_700_000_000_000;
  store.updateLatestActivity('aura', '最新一条', MS);

  assert.equal(read()[0].lastMessage, '最新一条', 'profile 列表必须被更新');
  assert.equal(read()[0].timestamp, MS);
  assert.equal(read()[0].lastTime, `t${MS}`, '时间必须经注入的格式化函数');
  assert.equal(store.snapshot().get('aura').timestamp, MS, '内存映射必须被更新');

  /**
   * 落盘断言是这条用例的核心：历史缺陷正是"只改内存不落盘"，
   * 刷新后 Bot 卡片回退到普通会话池的时间戳。
   *
   * 【为什么单独断言 storage 而不是只断言内存】内存态正确不代表刷新后正确。
   *   把两者分开断言，删掉落盘调用时这里会直接红，而不是靠别的副作用间接暴露。
   */
  const persistedRaw = storage.getItem(BOT_ACTIVITY_PERSISTENCE_KEY);
  assert.notEqual(persistedRaw, null, '必须落盘：storage 中应出现该键（否则刷新后丢失）');
  const persisted = JSON.parse(persistedRaw);
  assert.equal(persisted.aura.timestamp, MS, '落盘内容必须包含本次更新的时间戳');
  assert.equal(persisted.aura.lastMessage, '最新一条');
});

test('botActivity · 落盘失败不得中断更新：内存态与 profile 仍然正确', (t) => {
  let calledError = 0;
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceeded'); },
  };
  const uninstall = installStorage(storage);
  t.after(uninstall);

  const { read } = makeHost([{ name: 'aura', displayName: 'Aura', lastMessage: '', timestamp: 0 }]);
  let current = [{ name: 'aura', displayName: 'Aura', lastMessage: '', timestamp: 0 }];
  const store = createBotActivityStore({
    profiles: () => current,
    setProfiles: (next) => { current = next; },
    formatTime,
    onPersistError: () => { calledError += 1; },
  });

  assert.doesNotThrow(() => store.updateLatestActivity('aura', 'x', 1_700_000_000_000), '落盘失败不得抛错');
  assert.equal(current[0].timestamp, 1_700_000_000_000, '内存态必须已更新');
  assert.equal(store.snapshot().get('aura').timestamp, 1_700_000_000_000);
  assert.equal(calledError >= 1, true, '失败必须经由观测通道留痕，不得完全静默');
});

test('botActivity · 空 botName 是无效操作：不写入、不落盘', (t) => {
  const storage = makeStorage();
  const uninstall = installStorage(storage);
  t.after(uninstall);

  const { host, read } = makeHost([{ name: 'a', displayName: 'A', lastMessage: 'keep', timestamp: 1 }]);
  const store = createBotActivityStore(host);
  store.restore();
  store.updateLatestActivity('', 'ignored', 5000);

  assert.equal(store.snapshot().size, 0, '空名字不得写进映射');
  assert.equal(read()[0].lastMessage, 'keep', 'profile 不应被改动');
  /**
   * 空名字时 core 直接返回原列表，但 store 仍会走一次落盘（写入空对象）。
   * 这里断言的是「没有把空名字写进去」，而不是「没有发生落盘」——
   * 后者是当前实现的副作用，不属于契约，把它写进断言会让测试锁死实现细节。
   */
  const persisted = storage.getItem(BOT_ACTIVITY_PERSISTENCE_KEY);
  if (persisted !== null) {
    assert.deepEqual(JSON.parse(persisted), {}, '落盘内容不得包含空名字条目');
  }
});

test('botActivity · withActivityMap 借用同一份 Map：core 的写入能回到 store', (t) => {
  const storage = makeStorage();
  const uninstall = installStorage(storage);
  t.after(uninstall);

  const { host } = makeHost([]);
  const store = createBotActivityStore(host);
  store.restore();

  store.withActivityMap((map) => {
    map.set('direct', { lastMessage: 'via-map', timestamp: 777 });
  });
  store.persist();

  assert.equal(store.snapshot().get('direct').timestamp, 777, '借用通道必须操作同一份状态，不能是副本');
  const persisted = JSON.parse(storage.getItem(BOT_ACTIVITY_PERSISTENCE_KEY));
  assert.equal(persisted.direct.lastMessage, 'via-map', '借用后落盘必须包含该写入');
});

test('botActivity · 时间戳畸变由 core 纯函数归一化（秒级/字符串都收敛为有限数字）', (t) => {
  const storage = makeStorage();
  const uninstall = installStorage(storage);
  t.after(uninstall);

  const { host } = makeHost([{ name: 'aura', displayName: 'Aura', lastMessage: '', timestamp: 0 }]);
  const store = createBotActivityStore(host);
  store.restore();

  // 秒级数字：core 视为秒并 ×1000
  store.updateLatestActivity('aura', 'a', 1700000000);
  const secTs = store.snapshot().get('aura').timestamp;
  assert.equal(secTs, 1_700_000_000_000, '秒级时间戳必须被放大为毫秒');

  // ISO 字符串：应解析为毫秒
  store.updateLatestActivity('aura', 'b', '2024-01-01T00:00:00.000Z');
  const isoTs = store.snapshot().get('aura').timestamp;
  assert.equal(isoTs, Date.parse('2024-01-01T00:00:00.000Z'), 'ISO 字符串必须被解析');

  // 非法输入：回落到当前时间（不得为 NaN，也不得为 0）
  store.updateLatestActivity('aura', 'c', 'not-a-date');
  const badTs = store.snapshot().get('aura').timestamp;
  assert.equal(Number.isFinite(badTs), true, '畸变输入必须收敛为有限数字');
  assert.equal(badTs > 0, true, '畸变输入必须回落到有效时间而非 0');
});
