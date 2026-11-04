import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSessionHandles,
  toPendingSession,
  upsertSession,
  applySessionTitle,
  SessionHandleRegistry,
} from '../../dist/session/sessionRegistry.js';

// Shapes below were captured from a live Hermes Gateway v0.22.5.
const CREATE_RESULT = {
  session_id: '46546345',
  stored_session_id: '20261028_155631_8bcc62',
  message_count: 0,
  messages: [],
  info: { model: 'gemini-3.8-flash', cwd: '/opt/data/workspace', lazy: true },
};

const RESUME_RESULT = {
  session_id: '35573db6',
  session_key: '20261028_155738_9669aa',
  resumed: '20261028_155738_9669aa',
  message_count: 2,
  messages: [{ role: 'user', text: '只回复数字 9', timestamp: 1793203000, row_id: 1 }],
};

function railEntry(id, title, extra = {}) {
  return { id, title, model: '', time: '10:00', preview: '', isArchived: false, timestamp: 1, ...extra };
}

test('Session registry - live/stored identity pairing', async (t) => {
  await t.test('session.create result yields two distinct ids', () => {
    // 1. Arrange & 2. Act
    const handles = readSessionHandles(CREATE_RESULT);

    // 3. Assert: prompt.submit only accepts the live id, session.list only knows the stored id
    assert.deepEqual(handles, { liveId: '46546345', storedId: '20261028_155631_8bcc62' });
    assert.notEqual(handles.liveId, handles.storedId, 'Live and stored ids must not be confused');
  });

  await t.test('session.resume bridges a stored id back to a live id', () => {
    // 1. Arrange & 2. Act
    const handles = readSessionHandles(RESUME_RESULT);

    // 3. Assert
    assert.deepEqual(handles, { liveId: '35573db6', storedId: '20261028_155738_9669aa' });
  });

  await t.test('a resume result missing the stored ids falls back to the requested one', () => {
    // 1. Arrange
    const partial = { session_id: 'abc123', messages: [] };

    // 2. Act
    const handles = readSessionHandles(partial, '20261028_120000_ffffff');

    // 3. Assert
    assert.deepEqual(handles, { liveId: 'abc123', storedId: '20261028_120000_ffffff' });
  });

  await t.test('unusable results produce null instead of a half-filled id pair', () => {
    // 1. Arrange
    const samples = [null, undefined, {}, { session_id: '   ' }, { messages: [] }, 'session'];

    // 2. Act & Assert
    for (const sample of samples) {
      assert.equal(readSessionHandles(sample), null, `Result ${JSON.stringify(sample)} must not yield handles`);
    }
  });
});

test('Session registry - rail list maintenance', async (t) => {
  await t.test('a freshly created session is inserted at the head of the rail', () => {
    // 1. Arrange
    const existing = [railEntry('20261028_100000_aaaaaa', '旧会话')];
    const handles = readSessionHandles(CREATE_RESULT);

    // 2. Act
    const next = upsertSession(existing, toPendingSession(handles, '新任务', 1793202885000));

    // 3. Assert
    assert.equal(next.length, 2);
    assert.equal(next[0].id, '20261028_155631_8bcc62', 'New session must be visible immediately');
    assert.equal(next[0].title, '新任务');
    assert.equal(next[1].id, '20261028_100000_aaaaaa', 'Existing entries keep their order');
  });

  await t.test('upsert merges into an existing entry without mutating the input list', () => {
    // 1. Arrange
    const existing = [railEntry('s1', '标题一'), railEntry('s2', '标题二')];
    const snapshot = JSON.parse(JSON.stringify(existing));

    // 2. Act
    const next = upsertSession(existing, railEntry('s2', '服务端标题', { preview: '服务器返回的预览' }));

    // 3. Assert
    assert.equal(next.length, 2, 'Merging must not duplicate the entry');
    assert.equal(next[1].title, '服务端标题');
    assert.equal(next[1].preview, '服务器返回的预览');
    assert.deepEqual(existing, snapshot, 'Input list must stay untouched (no mutation)');
  });

  await t.test('session.title updates only the targeted entry', () => {
    // 1. Arrange
    const existing = [railEntry('s1', '旧标题'), railEntry('s2', '不该被改')];

    // 2. Act
    const next = applySessionTitle(existing, 's1', '模型生成的标题');

    // 3. Assert
    assert.equal(next[0].title, '模型生成的标题');
    assert.equal(next[1].title, '不该被改');
    assert.equal(existing[0].title, '旧标题', 'Original list must stay untouched');
  });

  await t.test('session.title also matches the live id alias the rail does not store', () => {
    // 1. Arrange
    const existing = [railEntry('20261028_155631_8bcc62', '新任务')];

    // 2. Act
    const next = applySessionTitle(existing, 'live-unknown', '别名匹配的标题', '20261028_155631_8bcc62');

    // 3. Assert
    assert.equal(next[0].title, '别名匹配的标题');
  });

  await t.test('an unmatched or blank title leaves the list reference intact', () => {
    // 1. Arrange
    const existing = [railEntry('s1', '标题')];

    // 2. Act & Assert
    assert.equal(applySessionTitle(existing, 'missing', '新标题'), existing, 'No match must not allocate a new list');
    assert.equal(applySessionTitle(existing, 's1', '   '), existing, 'Blank titles must be ignored');
  });
});

test('SessionHandleRegistry - Live/Stored 句柄双向注册与归一化全象限验证', async (t) => {
  await t.test('1. 正向双向解析：liveId 映射回 storedId，storedId 映射到 liveId', () => {
    const reg = new SessionHandleRegistry();
    reg.register({ liveId: 'live-100', storedId: 'stored-20261104' });

    assert.equal(reg.toStoredId('live-100'), 'stored-20261104', 'liveId 必须精确解析为 storedId');
    assert.equal(reg.toLiveId('stored-20261104'), 'live-100', 'storedId 必须精确解析为 liveId');
  });

  await t.test('2. 已知 storedId 直通与未知 ID 降级保真', () => {
    const reg = new SessionHandleRegistry();
    reg.register({ liveId: 'live-1', storedId: 'stored-1' });

    // 传入自身就是 storedId 的情况
    assert.equal(reg.toStoredId('stored-1'), 'stored-1');
    assert.equal(reg.toStoredId('stored-unknown', ['stored-unknown']), 'stored-unknown');

    // 既不是 live 也不在已知列表中的未知 ID 原样返回，不崩溃
    assert.equal(reg.toStoredId('unregistered-id'), 'unregistered-id');
  });

  await t.test('3. 边界值：null、undefined、空串安全防御', () => {
    const reg = new SessionHandleRegistry();
    reg.register(null);
    reg.register(undefined);
    reg.register({ liveId: '', storedId: '' });

    assert.equal(reg.toStoredId(null), null);
    assert.equal(reg.toStoredId(undefined), null);
    assert.equal(reg.toStoredId(''), null);
    assert.equal(reg.toLiveId(null), null);
    assert.equal(reg.toLiveId(undefined), null);
  });

  await t.test('4. 批量获取 getLiveIds：从一组 running storedId 获取全部绑定的 liveId', () => {
    const reg = new SessionHandleRegistry();
    reg.register({ liveId: 'l1', storedId: 's1' });
    reg.register({ liveId: 'l2', storedId: 's2' });

    const liveIds = reg.getLiveIds(['s1', 's2', 's3-no-live']);
    assert.deepEqual(liveIds, ['l1', 'l2'], '必须只提取已知绑定的 liveId');
  });

  await t.test('5. 生命周期注销 unregister：删除会话时双向清理，杜绝内存泄漏', () => {
    const reg = new SessionHandleRegistry();
    reg.register({ liveId: 'live-del', storedId: 'stored-del' });

    assert.equal(reg.toStoredId('live-del'), 'stored-del');

    // 通过 storedId 注销
    reg.unregister('stored-del');
    assert.equal(reg.toStoredId('live-del'), 'live-del', '注销后不再具有映射');
    assert.equal(reg.toLiveId('stored-del'), 'stored-del', '注销后 liveId 回退自身');

    // 再次注册，并通过 liveId 注销
    reg.register({ liveId: 'live-del-2', storedId: 'stored-del-2' });
    reg.unregister('live-del-2');
    assert.equal(reg.toStoredId('live-del-2'), 'live-del-2');
  });
});
