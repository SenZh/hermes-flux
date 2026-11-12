import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  applyEnqueueReceipt,
  canSendDraft,
  clampComposerHeight,
  planEnqueue,
  planEnterAction,
  planQueueAction,
  queuedAfterAction,
  resolveComposerPhase,
  shouldShowQueueButton,
} from '../../dist/renderer/queueControl.mjs';

test('输入区高度：66 起、220 顶、回删可收回', async (t) => {
  await t.test('单行落在下界', () => {
    assert.equal(clampComposerHeight(22), COMPOSER_MIN_HEIGHT);
    assert.equal(clampComposerHeight(0), COMPOSER_MIN_HEIGHT);
  });

  await t.test('中间值原样返回', () => {
    assert.equal(clampComposerHeight(132), 132);
  });

  await t.test('超长封顶在 220，不再增长', () => {
    assert.equal(clampComposerHeight(682), COMPOSER_MAX_HEIGHT);
    assert.equal(clampComposerHeight(99999), COMPOSER_MAX_HEIGHT);
  });

  await t.test('非有限值回落到下界，绝不写 NaN 进 style', () => {
    assert.equal(clampComposerHeight(Number.NaN), COMPOSER_MIN_HEIGHT);
    assert.equal(clampComposerHeight(Number.POSITIVE_INFINITY), COMPOSER_MAX_HEIGHT);
  });

  await t.test('小数取整，避免半像素高度', () => {
    assert.equal(clampComposerHeight(87.6), 88);
  });
});

test('入队决策：空草稿跳过，两种失败给不同原因', async (t) => {
  await t.test('空草稿不是错误', () => {
    assert.deepEqual(planEnqueue({ text: '   ', hasGateway: true, hasLiveSession: true }), { kind: 'skip' });
  });

  await t.test('无网关与无实时通道必须是两条不同的提示', () => {
    const noGateway = planEnqueue({ text: 'hi', hasGateway: false, hasLiveSession: true });
    const noSession = planEnqueue({ text: 'hi', hasGateway: true, hasLiveSession: false });
    assert.deepEqual(noGateway, { kind: 'fail', reasonKey: 'chat.gatewayNotConnected' });
    assert.deepEqual(noSession, { kind: 'fail', reasonKey: 'dock.queueNoLive' });
    assert.notDeepEqual(noGateway, noSession, '两种失败不能共用一条文案');
  });

  await t.test('正常草稿带上 trim 后的文本', () => {
    assert.deepEqual(planEnqueue({ text: '  把队列行加进键盘导航  ', hasGateway: true, hasLiveSession: true }), {
      kind: 'submit',
      text: '把队列行加进键盘导航',
    });
  });
});

test('入队回执：判据是 status，不是 admission_id', async (t) => {
  await t.test('回执带准入 id 时落地为队列行', () => {
    const outcome = applyEnqueueReceipt({ admission_id: 'adm-9', status: 'queued' }, '排队内容');
    assert.equal(outcome.kind, 'queued');
    assert.deepEqual(outcome.kind === 'queued' ? outcome.entry : null, {
      id: 'adm-9',
      admissionId: 'adm-9',
      text: '排队内容',
    });
  });

  await t.test('运行态排队：网关只回 status=queued，必须判成功', () => {
    // 【规则】网关实测运行态回执就是 {status:'queued'}，没有 admission_id。
    //   历史实现要求 admission_id，于是每次成功排队都报「加入队列失败」。
    const outcome = applyEnqueueReceipt({ status: 'queued' }, '排队内容');
    assert.equal(outcome.kind, 'queued');
    assert.ok(outcome.kind === 'queued' && outcome.entry.admissionId.length > 0, '必须生成稳定展示 id');
  });

  await t.test('空闲态提交：status=streaming 同样算排上', () => {
    const outcome = applyEnqueueReceipt({ status: 'streaming', user_row_id: 44507 }, '内容');
    assert.equal(outcome.kind, 'queued');
  });

  await t.test('无 status 或失败终态才判失败，并保留草稿', () => {
    assert.deepEqual(applyEnqueueReceipt({}, '内容'), { kind: 'failed', reasonKey: 'dock.queueFailed' });
    assert.deepEqual(applyEnqueueReceipt(null, '内容'), { kind: 'failed', reasonKey: 'dock.queueFailed' });
    assert.deepEqual(applyEnqueueReceipt(undefined, '内容'), { kind: 'failed', reasonKey: 'dock.queueFailed' });
    assert.deepEqual(applyEnqueueReceipt({ status: 'failed' }, '内容'), { kind: 'failed', reasonKey: 'dock.queueFailed' });
    assert.deepEqual(applyEnqueueReceipt({ status: 'terminal' }, '内容'), { kind: 'failed', reasonKey: 'dock.queueFailed' });
  });

  await t.test('status 大小写与空格不敏感', () => {
    assert.equal(applyEnqueueReceipt({ status: ' QUEUED ' }, 'x').kind, 'queued');
  });

  await t.test('同一批多条排队行不会互相覆盖', () => {
    const a = applyEnqueueReceipt({ status: 'queued', user_row_id: 1 }, '第一条');
    const b = applyEnqueueReceipt({ status: 'queued', user_row_id: 2 }, '第二条');
    assert.ok(a.kind === 'queued' && b.kind === 'queued');
    assert.notEqual(a.entry.id, b.entry.id);
  });
});

test('输入舱相位与回车分派：渲染与按键必须读同一份真值', async (t) => {
  await t.test('相位只由本会话活跃回合决定', () => {
    assert.equal(resolveComposerPhase({ activeTurn: false }), 'idle');
    assert.equal(resolveComposerPhase({ activeTurn: true }), 'running');
  });

  await t.test('空闲态回车一律提交，含空草稿', () => {
    assert.deepEqual(planEnterAction({ phase: 'idle', text: '你好', attachmentCount: 0 }), { kind: 'submit' });
    assert.deepEqual(planEnterAction({ phase: 'idle', text: '', attachmentCount: 0 }), { kind: 'submit' });
  });

  await t.test('运行态回车入队，绝不返回阻断提示', () => {
    // 【规则】历史缺陷：运行态回车弹「当前回合仍在生成中」，用户无从下手；
    //   停止是主按钮职责，回车只负责把草稿交给队列。
    assert.deepEqual(planEnterAction({ phase: 'running', text: '排队内容', attachmentCount: 0 }), { kind: 'enqueue' });
  });

  await t.test('运行态空草稿静默跳过，不算失败', () => {
    assert.deepEqual(planEnterAction({ phase: 'running', text: '   ', attachmentCount: 0 }), { kind: 'ignore' });
  });

  await t.test('附件也算草稿', () => {
    assert.deepEqual(planEnterAction({ phase: 'running', text: '', attachmentCount: 1 }), { kind: 'enqueue' });
  });
});

test('队列三动作：映射到正确 RPC，未知动作不落到取消', async (t) => {
  await t.test('立即发送走 steer_queued', () => {
    assert.deepEqual(planQueueAction('queue-steer', '文本'), { kind: 'steer', method: 'prompt.steer_queued' });
  });

  await t.test('取消走 prompt.cancel', () => {
    assert.deepEqual(planQueueAction('queue-cancel', '文本'), { kind: 'cancel', method: 'prompt.cancel' });
  });

  await t.test('放回编辑复用 cancel 并带回原文', () => {
    assert.deepEqual(planQueueAction('queue-replace', '待改的文本'), {
      kind: 'replace',
      method: 'prompt.cancel',
      restoreText: '待改的文本',
    });
  });

  await t.test('未知动作必须显式 unknown，绝不默认取消', () => {
    assert.deepEqual(planQueueAction('queue-up', '文本'), { kind: 'unknown' });
    assert.deepEqual(planQueueAction('', '文本'), { kind: 'unknown' });
  });
});

test('动作成功后队列行必须移除（含立即发送）', async (t) => {
  const queued = [
    { admissionId: 'adm-1' },
    { admissionId: 'adm-2' },
    { admissionId: 'adm-3' },
  ];

  await t.test('只移除被操作的那一条', () => {
    assert.deepEqual(queuedAfterAction(queued, 'adm-2'), [
      { admissionId: 'adm-1' },
      { admissionId: 'adm-3' },
    ]);
  });

  await t.test('立即发送的行同样要移除，否则界面永久残留', () => {
    // 这条断言直接守护「steer 成功后不清理」这个缺陷：三个动作走同一条清理路径。
    assert.deepEqual(queuedAfterAction(queued, 'adm-1'), [
      { admissionId: 'adm-2' },
      { admissionId: 'adm-3' },
    ]);
  });

  await t.test('不存在的 id 不影响其它行', () => {
    assert.deepEqual(queuedAfterAction(queued, 'adm-404'), queued);
  });
});

test('主按钮可见性与可用性共用同一条草稿判据', async (t) => {
  await t.test('空文本无附件：发送禁用、入队隐藏', () => {
    assert.equal(canSendDraft({ text: '  ', attachmentCount: 0 }), false);
    assert.equal(shouldShowQueueButton({ text: '  ', attachmentCount: 0 }), false);
  });

  await t.test('有文本无附件：两者都成立', () => {
    assert.equal(canSendDraft({ text: 'hi', attachmentCount: 0 }), true);
    assert.equal(shouldShowQueueButton({ text: 'hi', attachmentCount: 0 }), true);
  });

  await t.test('只有附件也算有草稿', () => {
    assert.equal(canSendDraft({ text: '', attachmentCount: 2 }), true);
    assert.equal(shouldShowQueueButton({ text: '', attachmentCount: 2 }), true);
  });
});
