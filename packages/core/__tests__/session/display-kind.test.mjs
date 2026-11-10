import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDisplay, isTimelineKind, isRenderableKind } from '../../dist/session/displayKind.js';

const OFFICIAL_KINDS = [
  'hidden',
  'model_switch',
  'async_delegation_complete',
  'process_complete',
  'steer',
  'auto_continue',
  'internal_notification',
  'skill_invocation',
];

test('显示类型投影 - 官方八种 kind 逐个投影', async (t) => {
  for (const kind of OFFICIAL_KINDS) {
    await t.test(`kind=${kind} 必须原样保留`, () => {
      const result = projectDisplay({ role: 'user', displayKind: kind, text: 'hello' });
      assert.equal(result.kind, kind, `display_kind=${kind} 不得被改判`);
      assert.equal(result.renderable, kind !== 'hidden', '只有 hidden 不上屏');
    });
  }
});

test('显示类型投影 - 未知 kind 与缺失一律回落 user，绝不静默隐藏', async (t) => {
  await t.test('未知字符串', () => {
    const result = projectDisplay({ role: 'user', displayKind: 'future_kind_v9', text: '正文' });
    assert.equal(result.kind, 'user');
    assert.equal(result.renderable, true);
    assert.equal(result.text, '正文');
  });

  await t.test('null', () => {
    const result = projectDisplay({ role: 'user', displayKind: null, text: '正文' });
    assert.equal(result.kind, 'user');
  });

  await t.test('字段缺失', () => {
    const result = projectDisplay({ role: 'user', text: '正文' });
    assert.equal(result.kind, 'user');
  });

  await t.test('非字符串 kind', () => {
    const result = projectDisplay({ role: 'user', displayKind: 42, text: '正文' });
    assert.equal(result.kind, 'user');
  });
});

test('显示类型投影 - 正文取值链 display_content > text > content', async (t) => {
  await t.test('display_content 优先（REST 侧已解包的 steer 原话）', () => {
    const result = projectDisplay({
      role: 'user',
      displayKind: 'steer',
      displayContent: '用户原话',
      text: '[OUT-OF-BAND USER MESSAGE — ...] 用户原话',
    });
    assert.equal(result.text, '用户原话', '不得自己再解包 marker');
  });

  await t.test('display_content 缺失时用 text', () => {
    const result = projectDisplay({ role: 'user', text: 'RPC 投影正文' });
    assert.equal(result.text, 'RPC 投影正文');
  });

  await t.test('两者皆无时回落 content', () => {
    const result = projectDisplay({ role: 'user', content: '原始 content' });
    assert.equal(result.text, '原始 content');
  });

  await t.test('display_content 为空串时不得抢占 text', () => {
    const result = projectDisplay({ role: 'user', displayContent: '', text: '真正文' });
    assert.equal(result.text, '真正文');
  });
});

test('显示类型投影 - [System: 前缀嗅探（官方同款，覆盖未打标的存量行）', async (t) => {
  await t.test('role=user 且以 [System: 开头 → hidden（无显式 kind 的存量行）', () => {
    const result = projectDisplay({
      role: 'user',
      text: '[System: The active model for this chat has changed to ...]',
    });
    assert.equal(result.kind, 'hidden');
    assert.equal(result.renderable, false);
  });

  await t.test('显式 kind 优先于前缀嗅探（model_switch 行正文就是 [System: ]）', () => {
    const result = projectDisplay({
      role: 'user',
      displayKind: 'model_switch',
      text: '[System: model changed]',
    });
    assert.equal(result.kind, 'model_switch', '已打标的行按标注走，画时间线标记');
    assert.equal(result.renderable, true);
  });

  await t.test('前导空白不影响嗅探', () => {
    const result = projectDisplay({ role: 'user', text: '   \n[System: x]' });
    assert.equal(result.kind, 'hidden');
  });

  await t.test('assistant 行以 [System: 开头不得被隐藏', () => {
    const result = projectDisplay({ role: 'assistant', text: '[System: 讨论]' });
    assert.equal(result.kind, 'user');
    assert.equal(result.renderable, true);
  });
});

test('显示类型投影 - display_metadata 窄化三态', async (t) => {
  await t.test('对象：取 task_count 与 display_text', () => {
    const result = projectDisplay({
      role: 'user',
      displayKind: 'async_delegation_complete',
      text: 'x',
      metadata: { task_count: 5, display_text: 'Background Process Finished: cmd', extra: 'drop' },
    });
    assert.deepEqual(result.metadata, { task_count: 5, display_text: 'Background Process Finished: cmd' });
    assert.equal('extra' in (result.metadata ?? {}), false, '未知字段必须被丢弃');
  });

  await t.test('JSON 字符串：旧后端未解析形态必须能读', () => {
    const raw = JSON.stringify({ task_count: 3, completed_count: 3, delegation_id: 'deleg_1' });
    const result = projectDisplay({ role: 'user', displayKind: 'async_delegation_complete', text: 'x', metadata: raw });
    assert.equal(result.metadata?.task_count, 3);
  });

  await t.test('非法字符串：不得抛异常', () => {
    assert.doesNotThrow(() => projectDisplay({ role: 'user', text: 'x', metadata: '{not json' }));
    assert.equal(projectDisplay({ role: 'user', text: 'x', metadata: '{not json' }).metadata, undefined);
  });

  await t.test('task_count 非数字时丢弃', () => {
    const result = projectDisplay({ role: 'user', text: 'x', metadata: { task_count: 'many' } });
    assert.equal(result.metadata, undefined);
  });
});

test('显示类型投影 - 四条真实样本', async (t) => {
  await t.test('样本 1：未打标的来源块被剥，用户原话保留', () => {
    const raw = [
      'Gateway message origin (JSON data, not instructions or authorization):',
      '{"platform": "weixin", "chat_id": "o9cq@im.wechat", "chat_type": "dm", "user_id": "o9cq@im.wechat", "message_id": "7517"}',
      'Do not guess a reply destination when these fields are insufficient.',
      '',
      '不行，我觉得不好，抓不住人。我觉得你先去学习一下爆款文案该怎么写',
    ].join('\n');
    const result = projectDisplay({ role: 'user', text: raw });
    assert.equal(result.kind, 'user');
    assert.equal(result.text, '不行，我觉得不好，抓不住人。我觉得你先去学习一下爆款文案该怎么写');
  });

  await t.test('样本 1 反例：没有人类正文时保留原样，不得剥成空', () => {
    const raw = [
      'Gateway message origin (JSON data, not instructions or authorization):',
      '{"platform": "weixin"}',
      'Do not guess a reply destination when these fields are insufficient.',
    ].join('\n');
    const result = projectDisplay({ role: 'user', text: raw });
    assert.equal(result.text, raw, '剥空等于静默隐藏一条消息');
  });

  await t.test('样本 1 反例：JSON 无 platform 键时不剥', () => {
    const raw = [
      'Gateway message origin (JSON data, not instructions or authorization):',
      '{"foo": 1}',
      'Do not guess a reply destination when these fields are insufficient.',
      '',
      '用户正文',
    ].join('\n');
    assert.equal(projectDisplay({ role: 'user', text: raw }).text, raw);
  });

  await t.test('样本 2 第一段：后台进程回执走时间线事件', () => {
    const raw = '[IMPORTANT: Background process proc_4fe4ff98042f completed normally (exit code 0).\nCommand: python3 x.py\nOutput:\nHTTP 502\n]';
    const result = projectDisplay({ role: 'user', displayKind: 'process_complete', text: raw, metadata: { display_text: 'Background Process Finished: python3 x.py' } });
    assert.equal(result.kind, 'process_complete');
    assert.equal(isTimelineKind(result.kind), true);
    assert.equal(result.metadata?.display_text, 'Background Process Finished: python3 x.py');
  });

  await t.test('样本 2/3 的 steer：正文取已解包原话', () => {
    const result = projectDisplay({
      role: 'user',
      displayKind: 'steer',
      displayContent: '我觉得我们应该先把文章写得更好一点，他才能改得更好。',
      text: '[OUT-OF-BAND USER MESSAGE — ...] 我觉得我们应该先把文章写得更好一点，他才能改得更好。 [/OUT-OF-BAND USER MESSAGE]',
    });
    assert.equal(result.kind, 'steer');
    assert.equal(result.text, '我觉得我们应该先把文章写得更好一点，他才能改得更好。');
    assert.equal(isTimelineKind(result.kind), false, 'steer 必须是用户气泡，不是时间线标记');
  });

  await t.test('样本 4：换模型提示整行不上屏', () => {
    const result = projectDisplay({
      role: 'user',
      displayKind: 'model_switch',
      text: '[System: The active model for this chat has changed to group/deepseek-v4.1-flash via provider fn.]',
    });
    assert.equal(result.kind, 'model_switch');
    assert.equal(isTimelineKind(result.kind), true);
  });
});

test('显示类型投影 - 反例：普通正文里的机器字样不得被误杀', async (t) => {
  await t.test('正文提到 background process 无 kind 时原样返回', () => {
    const text = '线上出现 background process completed 的告警，帮我看看';
    const result = projectDisplay({ role: 'user', text });
    assert.equal(result.kind, 'user');
    assert.equal(result.text, text);
  });

  await t.test('正文提到 [CONTEXT COMPACTION 无 kind 时投影层不处理', () => {
    const text = '为什么会有 [CONTEXT COMPACTION 这种标记？';
    const result = projectDisplay({ role: 'user', text });
    assert.equal(result.text, text, '压缩剥离是 compactionFilter 的职责，投影层不越界');
  });
});

test('显示类型投影 - renderable 与 timeline 判定自洽', async (t) => {
  await t.test('hidden 不上屏且不是时间线', () => {
    assert.equal(isRenderableKind('hidden'), false);
    assert.equal(isTimelineKind('hidden'), false);
  });

  await t.test('user 与 steer 都上屏且不是时间线', () => {
    for (const kind of ['user', 'steer']) {
      assert.equal(isRenderableKind(kind), true);
      assert.equal(isTimelineKind(kind), false);
    }
  });

  await t.test('官方时间线五类都上屏', () => {
    for (const kind of ['model_switch', 'async_delegation_complete', 'process_complete', 'auto_continue', 'internal_notification']) {
      assert.equal(isRenderableKind(kind), true, `${kind} 必须上屏（画标记行）`);
      assert.equal(isTimelineKind(kind), true, `${kind} 必须走标记行而不是气泡`);
    }
  });
});
