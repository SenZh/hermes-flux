import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSessionsByProfile, dedupeSessionsWithReport, isVisibleSession, pruneSupersededSessions, reconcileSessionList, sessionProfileKey } from '../../dist/session/sessionMerge.js';

function session(id, botName, title, timestamp) {
  return { id, botName, title, timestamp, model: '', time: '', preview: '', isArchived: false };
}

test('sessionMerge - 跨 Profile 会话合并与去重', async (t) => {
  await t.test('1. 跨 Profile 同 ID 会话必须全部保留（不得互相顶掉）', () => {
    // Arrange: 复刻真实网关数据形态——同一 sessionId 在两个 Profile 下各自存在
    const sessions = [
      session('20261031_082411_824c51', 'aura', '会话 20261031', 1793445296360),
      session('20261031_082411_824c51', 'xiaofawang', '评估 Relay 技术商业化可行性', 1793435052233),
      session('20261029_025716_6d9179', 'default', '会话 20261029', 1793448216472),
      session('20261029_025716_6d9179', 'aura', '新任务', 1793242639342),
      session('20261029_025716_6d9179', 'xiaofawang', '会话 20261029', 1793445495089),
    ];

    // Act
    const merged = dedupeSessionsByProfile(sessions);

    // Assert: 5 条 profile::id 组合各自唯一，必须全部保留；Relay 会话不得被 aura 的空白会话顶掉
    assert.equal(merged.length, 5, '跨 Profile 同 ID 必须各自保留（5 条），而不是被压成 1 条');
    const relay = merged.find((s) => s.title === '评估 Relay 技术商业化可行性');
    assert.ok(relay, '《评估 Relay 技术商业化可行性》必须存活');
    assert.equal(relay.botName, 'xiaofawang');
  });

  await t.test('2. 同 Profile 内重复 ID 仍必须去重', () => {
    const sessions = [
      session('dup-1', 'aura', '第一条', 100),
      session('dup-1', 'aura', '重复项', 200),
    ];

    const merged = dedupeSessionsByProfile(sessions);

    assert.equal(merged.length, 1, '同一 Profile 内同 ID 属于真重复，必须去重');
    assert.equal(merged[0].title, '第一条', '保留首次出现的记录');
  });

  await t.test('3. 结果必须按时间戳降序，缺失时间戳排末尾', () => {
    const sessions = [
      session('a', 'default', 'old', 100),
      session('b', 'default', 'newest', 900),
      session('c', 'default', 'middle', 500),
      { ...session('d', 'default', 'no-ts', 0), timestamp: undefined },
    ];

    const merged = dedupeSessionsByProfile(sessions);

    assert.deepEqual(
      merged.map((s) => s.title),
      ['newest', 'middle', 'old', 'no-ts']
    );
  });

  await t.test('4. 空输入与非法条目必须安全跳过', () => {
    assert.deepEqual(dedupeSessionsByProfile([]), []);
    const merged = dedupeSessionsByProfile([
      null,
      { id: '', botName: 'aura', title: 'no id', timestamp: 1 },
      session('ok-1', 'aura', 'valid', 1),
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'ok-1');
  });

  await t.test('5. botName 缺失时按 default 归类', () => {
    assert.equal(sessionProfileKey({ id: 'x', timestamp: 0 }), 'default');
    const merged = dedupeSessionsByProfile([
      session('same', undefined, '无归属', 10),
      session('same', 'default', '显式 default', 20),
    ]);
    assert.equal(merged.length, 1, '无归属与 default 视为同一 Profile，必须去重');
  });

  await t.test('6. 去重必须可对账：被丢弃的条目要能说出是哪条、为什么', () => {
    const sessions = [
      session('dup-1', 'aura', '第一条', 100),
      session('dup-1', 'aura', '重复项', 200),
      session('relay', 'xiaofawang', '评估 Relay 技术商业化可行性', 300),
      session('relay', 'aura', '同名不同库', 400),
    ];

    const report = dedupeSessionsWithReport(sessions);

    assert.equal(report.sessions.length, 3, '仅同一 Profile 内的同 ID 才算重复');
    assert.equal(report.dropped.length, 1, '必须精确报出被丢弃的条数');
    assert.equal(report.dropped[0].sessionId, 'dup-1');
    assert.equal(report.dropped[0].profile, 'aura');
    assert.equal(report.dropped[0].title, '重复项');
    assert.equal(report.dropped[0].reason, 'duplicate-profile-session');

    // 关键回归：Relay 会话在另一个 Profile 下必须保留，且不能被当作重复
    assert.ok(
      report.sessions.some((s) => s.title === '评估 Relay 技术商业化可行性' && s.botName === 'xiaofawang'),
      '跨 Profile 的真实会话必须存活'
    );
  });

  await t.test('7. 非法条目也要计入对账，而不是静默跳过', () => {
    const report = dedupeSessionsWithReport([
      null,
      { id: '', botName: 'aura', title: 'no id', timestamp: 1 },
      session('ok-1', 'aura', 'valid', 1),
    ]);
    assert.equal(report.sessions.length, 1);
    assert.equal(report.dropped.length, 2, '两条非法条目都必须被记录');
    assert.ok(report.dropped.every((d) => d.reason === 'invalid-session'));
  });

  await t.test('8. 同一 stored id 已由本次返回给出时，本地归档副本必须被剔除', () => {
    // Arrange: 真实事故形态——会话移交到 aura 后，default 库那份被归档；
    // session.list 只返回 aura 那条，本地列表仍缓存着 default 的旧副本。
    const existing = [
      session('20261031_155456_4192aa', 'default', 'DeepSeek Superagent prototype repository bookmark', 1793462096885),
      session('20261030_161541_b23bd3', 'aura', '另一条仍在的会话', 1793440000000),
    ];
    const returned = [
      session('20261031_155456_4192aa', 'aura', 'DeepSeek Superagent prototype repository bookmark', 1793462096885),
    ];

    // Act
    const kept = pruneSupersededSessions(existing, returned);

    // Assert: 同 id 的 default 副本被丢弃，不同 id 的本地会话必须原样保留
    assert.equal(kept.length, 1, '归档副本必须丢弃，不同 id 的会话必须保留');
    assert.equal(kept[0].id, '20261030_161541_b23bd3');
    assert.ok(
      !kept.some((s) => s.id === '20261031_155456_4192aa' && s.botName === 'default'),
      'default 下的归档副本不得残留'
    );
  });

  await t.test('9. 拉取失败必须保留本地列表，权威空必须清空残影', () => {
    const existing = [
      session('keep-1', 'aura', '断网时仍要显示', 100),
      session('keep-2', 'default', '同样保留', 200),
    ];

    // null = 本轮有 Profile 拉取失败：失败不等于"没有会话"，必须原样保留
    assert.deepEqual(pruneSupersededSessions(existing, null), existing, '拉取失败时不得抹掉本地列表');

    // [] = 全部 Profile 成功且权威端确认没有会话：必须收敛，否则归档/删除残影永远挂在列表上
    assert.deepEqual(pruneSupersededSessions(existing, []), [], '权威空必须清空本地残影');
    assert.deepEqual(pruneSupersededSessions([], null), [], '空本地列表无需处理');
  });

  await t.test('10. 活跃时间线可见性：归档、子代理、日期流水线、空标题都必须不可见', () => {
    // 正向：普通会话可见
    assert.equal(isVisibleSession(session('ok-1', 'aura', '正常的用户会话', 1)), true);

    // 负向四类
    assert.equal(
      isVisibleSession({ ...session('arch-1', 'default', '已归档副本', 1), isArchived: true }),
      false,
      '归档会话必须不可见（否则与活跃副本并存成两条同名条目）'
    );
    assert.equal(
      isVisibleSession({ ...session('sub-1', 'aura', '子代理会话', 1), isSubagent: true }),
      false,
      '子代理会话必须不可见'
    );
    assert.equal(
      isVisibleSession({ ...session('sub-2', 'aura', '子代理会话', 1), source: 'subagent' }),
      false,
      'source=subagent 的会话必须不可见'
    );
    assert.equal(
      isVisibleSession(session('date-1', 'aura', '会话 20261031', 1)),
      false,
      '子代理日期流水线占位必须不可见'
    );
    assert.equal(isVisibleSession(session('blank-1', 'aura', '   ', 1)), false, '空标题占位必须不可见');
    assert.equal(isVisibleSession(null), false, 'null 条目必须不可见');
    assert.equal(isVisibleSession({ ...session('no-id', 'aura', '无 id', 1), id: '' }), false, '缺 id 必须不可见');
  });

  await t.test('11. 归档行也是"该 id 已被权威端处置"的证据，必须驱动本地副本收敛', () => {
    // Arrange: 本地活跃会话与网关返回的归档行同 id
    const activeLocal = session('same-id', 'aura', '本地活跃会话', 100);
    const archivedRow = { ...session('same-id', 'default', '同 id 的归档行', 100), isArchived: true };
    const other = session('other-id', 'aura', '另一条会话', 200);

    // Assert 1: 归档行必须触发本地同 id 副本收敛（不能因为"归档行不可见"就丢掉这条证据）
    assert.deepEqual(
      pruneSupersededSessions([activeLocal], [archivedRow, other]),
      [],
      '权威结果里出现该 id 的归档行时，本地同 id 副本必须收敛'
    );

    // Assert 2: 反向对照——若调用方错误地先过滤掉归档行，本地副本会残留。
    // 这条断言保证用例能区分"传未过滤集合"与"传过滤后集合"两种实现，杜绝假测试。
    const filtered = [archivedRow, other].filter(isVisibleSession);
    assert.deepEqual(
      pruneSupersededSessions([activeLocal], filtered),
      [activeLocal],
      '过滤掉归档行后本地副本会残留，说明用例具备实现区分力'
    );
  });

  await t.test('12. 列表对账编排：权威成功、部分失败降级、权威空', () => {
    // archivedCopy 是"本地缓存的过期视图"：它自身 isArchived=false（本地从未拿到归档状态），
    // 真正的归档事实由网关返回的归档行承载（见用例 13-A）。
    const archivedCopy = session('20261031_155456_4192aa', 'default', 'DeepSeek Superagent prototype repository bookmark', 1793462096885);
    const auraActive = session('20261031_155456_4192aa', 'aura', 'DeepSeek Superagent prototype repository bookmark', 1793462096885);
    const pendingNew = session('pending-1', 'aura', '新建但还没落盘', 1793463000000);

    // 1) 权威成功：default 残影被剔除，aura 活跃条目与 pending 保留，按时间戳降序
    const ok = reconcileSessionList({
      previous: [archivedCopy, pendingNew],
      fetched: [auraActive],
      authoritative: true,
      pendingIds: ['pending-1'],
      profileName: 'aura',
    });
    assert.deepEqual(
      ok.sessions.map((s) => s.id),
      ['pending-1', '20261031_155456_4192aa'],
      '必须剔除同 id 的 default 残影，保留活跃条目与 pending，并按时间戳降序'
    );
    assert.equal(ok.pruned.length, 1, '被剔除的残影必须进入对账报告');
    assert.equal(ok.pruned[0].sessionId, '20261031_155456_4192aa');
    assert.equal(ok.pruned[0].reason, 'superseded-by-authority');

    // 2) 部分失败降级：成功 Profile 的新会话必须可见，本地旧会话必须保留，且不做剔除
    const partial = reconcileSessionList({
      previous: [session('old-1', 'default', '失败 Bot 的旧会话', 50)],
      fetched: [session('new-1', 'aura', '成功 Bot 的新会话', 900)],
      authoritative: false,
      pendingIds: [],
      profileName: 'aura',
    });
    assert.deepEqual(partial.sessions.map((s) => s.id), ['new-1', 'old-1'], '部分失败只降级剔除，不降级展示');
    assert.deepEqual(partial.pruned, [], '非权威结果不得剔除任何本地条目');

    // 3) 权威空：非 pending 残影收敛，pending 保留
    const empty = reconcileSessionList({
      previous: [archivedCopy, pendingNew],
      fetched: [],
      authoritative: true,
      pendingIds: ['pending-1'],
      profileName: 'aura',
    });
    assert.deepEqual(empty.sessions.map((s) => s.id), ['pending-1'], '权威空时残影收敛，pending 不丢');
  });

  await t.test('13. 编排变异守护：归档证据、排序、profileName 兜底、归档剔除、pending 清理', () => {
    const mk = (id, botName, title, isArchived, timestamp) => ({
      ...session(id, botName, title, timestamp),
      isArchived,
    });

    // A. 杀死"prune 传 visible 而非 allMerged"：归档行必须驱动同 id 副本收敛
    assert.deepEqual(
      reconcileSessionList({
        previous: [mk('X', 'aura', '本地活跃副本', false, 100)],
        fetched: [mk('X', 'default', '同 id 归档行', true, 100), mk('Y', 'aura', '其他会话', false, 200)],
        authoritative: true,
        pendingIds: [],
        profileName: 'aura',
      }).sessions.map((s) => s.id),
      ['Y'],
      '归档行也是权威处置证据，本地同 id 副本必须收敛'
    );

    // B. 杀死"删除最终排序"：必须按时间戳降序
    assert.deepEqual(
      reconcileSessionList({
        previous: [mk('P', 'aura', '临时', false, 100)],
        fetched: [mk('N', 'aura', '权威', false, 900)],
        authoritative: true,
        pendingIds: ['P'],
        profileName: 'aura',
      }).sessions.map((s) => s.id),
      ['N', 'P'],
      '最终列表必须按时间戳降序'
    );

    // C. 杀死"isSeen 去掉 profileName 兜底"：本地无 botName 时也要识别出同一条已落盘会话
    const fallback = reconcileSessionList({
      previous: [{ ...mk('P', undefined, '临时', false, 100), botName: undefined }],
      fetched: [mk('P', 'aura', '权威', false, 100)],
      authoritative: true,
      pendingIds: ['P'],
      profileName: 'aura',
    });
    assert.equal(fallback.sessions.length, 1, '同一条会话不得重复出现');
    assert.equal(fallback.sessions[0].botName, 'aura', '必须保留权威端的 botName');

    // D. 杀死"previous 不过滤归档"：本地已归档条目必须剔除
    assert.deepEqual(
      reconcileSessionList({
        previous: [mk('A', 'aura', '本地已归档', true, 100)],
        fetched: [mk('B', 'aura', '其他', false, 200)],
        authoritative: true,
        pendingIds: [],
        profileName: 'aura',
      }).sessions.map((s) => s.id),
      ['B'],
      '本地已归档条目不得进入时间线'
    );

    // E. 杀死"pendingIds 不清理"：已落盘的 pending 必须从待落盘集合移除
    assert.deepEqual(
      reconcileSessionList({
        previous: [],
        fetched: [mk('P', 'aura', '已落盘', false, 100)],
        authoritative: true,
        pendingIds: ['P'],
        profileName: 'aura',
      }).pendingIds,
      [],
      '已落盘的 pending 必须清理'
    );
  });

  await t.test('14. 部分失败降级：同 id 跨 Profile 冲突不得剔除、pending 延迟清理、同 Profile 去重', () => {
    const mk = (id, botName, title, isArchived, timestamp) => ({
      ...session(id, botName, title, timestamp),
      isArchived,
    });

    // F. 杀死"authoritative 恒 true"：部分失败时同 id 的本地副本必须保留，且不记账剔除
    const partialConflict = reconcileSessionList({
      previous: [mk('X', 'default', '失败 Bot 的旧副本', false, 100)],
      fetched: [mk('X', 'aura', '成功 Bot 的新条目', false, 200)],
      authoritative: false,
      pendingIds: [],
      profileName: 'aura',
    });
    assert.deepEqual(
      partialConflict.sessions.map((s) => `${s.botName}::${s.id}`),
      ['aura::X', 'default::X'],
      '部分失败时同 id 的两个 Profile 条目都必须保留'
    );
    assert.deepEqual(partialConflict.pruned, [], '部分失败不得记账剔除');

    // G. 失败 Profile 持有的 pending 延迟到下次权威成功才清理
    const delayedPending = reconcileSessionList({
      previous: [],
      fetched: [mk('other', 'aura', '其他会话', false, 100)],
      authoritative: false,
      pendingIds: ['P'],
      profileName: 'aura',
    });
    assert.deepEqual(delayedPending.pendingIds, ['P'], '失败 Profile 的 pending 必须保留到下次权威结果');

    // H. 可见集合必须取自去重后的结果：同 Profile 同 id 只能出现一条
    const duplicated = reconcileSessionList({
      previous: [],
      fetched: [mk('D', 'aura', '重复一', false, 100), mk('D', 'aura', '重复二', false, 200)],
      authoritative: true,
      pendingIds: [],
      profileName: 'aura',
    });
    assert.equal(duplicated.sessions.length, 1, '同 Profile 同 id 去重后只允许一条进入时间线');
    assert.equal(duplicated.sessions[0].title, '重复一', '保留首次出现的记录');

    // I. 切换 Profile 后已落盘的 pending 仍必须清理（按 id 判定，不依赖当前 profile 名）
    const switched = reconcileSessionList({
      previous: [],
      fetched: [mk('P', 'default', '在原 Profile 落盘', false, 100)],
      authoritative: true,
      pendingIds: ['P'],
      profileName: 'aura',
    });
    assert.deepEqual(switched.pendingIds, [], '切换 Profile 后 pending 也必须按 id 清理');
  });
});
