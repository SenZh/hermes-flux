import test from 'node:test';
import assert from 'node:assert/strict';

// 【反 AI 假测试门禁 (Gate 2)】真实导入生产构建产物，禁止在测试内自造假闭包。
import { parseTranscriptRows } from '../../dist/renderer/transcriptRows.mjs';

const scope = { isGroupRoom: false, isBotRoom: false };
const formatTimestamp = (ts) => `t${ts}`;

const parse = (list) => parseTranscriptRows(list, { scope, formatTimestamp });

/** 官方 sample 的形状：REST 侧 display_content 已解包 steer 原话。 */
const STEER_ROW = {
  role: 'user',
  row_id: 12,
  content: '[OUT-OF-BAND USER MESSAGE — a direct message from the user] 我觉得应该先改文章 [/OUT-OF-BAND USER MESSAGE]',
  display_content: '我觉得应该先改文章',
  display_kind: 'steer',
  timestamp: 1700000000,
};

const HIDDEN_ROW = {
  role: 'user',
  row_id: 13,
  content: '',
  display_kind: 'hidden',
  timestamp: 1700000001,
};

const PROCESS_ROW = {
  role: 'user',
  row_id: 14,
  content: '[IMPORTANT: Background process proc_1 completed normally (exit code 0).]',
  display_kind: 'process_complete',
  display_metadata: '{"display_text":"Background Process Finished: python3 x.py"}',
  timestamp: 1700000002,
};

const MODEL_SWITCH_ROW = {
  role: 'user',
  row_id: 15,
  content: '[System: The active model for this chat has changed to x]',
  display_kind: 'model_switch',
  timestamp: 1700000003,
};

const USER_TEXT_ROW = {
  role: 'user',
  row_id: 11,
  content: '帮我把这段文案改得更有冲击力',
  timestamp: 1699999999,
};

const ASSISTANT_ROW = {
  role: 'assistant',
  row_id: 16,
  content: '好的，我来改写。',
  timestamp: 1700000004,
};

test('parseTranscriptRows - 长度守恒（输入 N 行输出 N 行）', async (t) => {
  await t.test('真实样本混合列：六行进六行出，hidden 行不得被删', () => {
    const rows = [USER_TEXT_ROW, STEER_ROW, HIDDEN_ROW, PROCESS_ROW, MODEL_SWITCH_ROW, ASSISTANT_ROW];
    const parsed = parse(rows);
    assert.equal(parsed.length, rows.length, '行序守恒：一串行输入必须得到同样长度的数组');
    assert.deepEqual(parsed.map((m) => m.rowId), [11, 12, 13, 14, 15, 16], 'rowId 顺序必须与服务端逐行对应');
  });

  await t.test('非法元素被跳过（null / 非对象），但合法行不受影响', () => {
    const parsed = parse([USER_TEXT_ROW, null, 'x', ASSISTANT_ROW]);
    assert.equal(parsed.length, 2, '非法元素不该产出，也不该吃掉后续合法行');
  });
});

test('parseTranscriptRows - snake_case 字段映射（变异必红）', async (t) => {
  await t.test('display_kind 原样落到 displayKind', () => {
    const [steer] = parse([STEER_ROW]);
    assert.equal(steer.displayKind, 'steer', 'display_kind 必须映射为 displayKind，否则所有机器行退回用户气泡');
  });

  await t.test('display_content 优先于 content', () => {
    const [steer] = parse([STEER_ROW]);
    assert.equal(steer.content, '我觉得应该先改文章', 'steer 必须显示用户原话，不是 [OUT-OF-BAND] 包装');
  });

  await t.test('display_metadata 字符串被窄化成对象', () => {
    const [process] = parse([PROCESS_ROW]);
    assert.deepEqual(process.displayMetadata, { display_text: 'Background Process Finished: python3 x.py' });
  });

  await t.test('display_metadata 非法字符串不抛异常，字段为 undefined', () => {
    const row = { ...PROCESS_ROW, display_metadata: '{not json' };
    const [process] = parse([row]);
    assert.equal(process.displayMetadata, undefined);
    assert.equal(process.displayKind, 'process_complete', '元数据坏了不影响 kind 判别');
  });

  await t.test('tool_use part 占位文案走 i18n', () => {
    const parsed = parse([{ role: 'user', content: [{ type: 'tool_use', name: 'grep' }], timestamp: 1 }]);
    assert.equal(parsed.length, 1);
    assert.ok(!parsed[0].content.includes('tool_use'), '结构化工具调用必须转成占位文案');
    assert.ok(parsed[0].content.length > 0, '不得产出空正文');
  });
});

test('parseTranscriptRows - 空正文守卫按 kind 分派（行序守恒）', async (t) => {
  await t.test('空正文的 hidden 行必须保留', () => {
    const parsed = parse([USER_TEXT_ROW, HIDDEN_ROW]);
    assert.equal(parsed.length, 2, '官方把独立压缩摘要投影成 content:"" + hidden，删掉就破坏行序');
    assert.equal(parsed[1].displayKind, 'hidden');
  });

  await t.test('空正文的普通用户行仍应丢弃', () => {
    const parsed = parse([{ role: 'user', content: '   ', timestamp: 1 }]);
    assert.equal(parsed.length, 0, '真正空的用户行不该产出空气泡');
  });

  await t.test('空正文的助手行仍应丢弃', () => {
    const parsed = parse([{ role: 'assistant', content: '', timestamp: 1 }]);
    assert.equal(parsed.length, 0);
  });

  await t.test('空正文的 model_switch 行必须保留', () => {
    const parsed = parse([{ role: 'user', row_id: 20, content: '', display_kind: 'model_switch', timestamp: 1 }]);
    assert.equal(parsed.length, 1, '时间线事件正文可能为空，但标记必须保留');
  });
});

test('parseTranscriptRows - tool-payload 合成不得吞掉机器行', async (t) => {
  await t.test('机器行正文是 JSON 时不得被当作工具结果合并进上一条 assistant', () => {
    const machine = {
      role: 'user',
      row_id: 30,
      content: '{"output":"fake","stdout":"x"}',
      display_kind: 'process_complete',
      timestamp: 1700000010,
    };
    const parsed = parse([ASSISTANT_ROW, machine]);
    assert.equal(parsed.length, 2, '机器行必须独立成行，不能被合成进 assistant 的 toolCalls');
    assert.equal(parsed[1].displayKind, 'process_complete');
    assert.equal(parsed[1].content, '{"output":"fake","stdout":"x"}', '正文原样保留，不改成工具输出');
  });

  await t.test('普通用户行的 JSON 工具载荷仍按原逻辑合成（既有行为不回归）', () => {
    const payload = { role: 'user', content: '{"output":"build ok"}', timestamp: 1700000011 };
    const parsed = parse([{ ...ASSISTANT_ROW, toolCalls: [{ id: 'tc1', name: 'shell', status: 'running', args: '' }] }, payload]);
    assert.equal(parsed.length, 1, '工具载荷应收敛进前一条 assistant');
    assert.equal(parsed[0].toolCalls.length, 1);
    assert.equal(parsed[0].toolCalls[0].output, 'build ok');
  });
});

test('parseTranscriptRows - 作用域与持久锚点', async (t) => {
  await t.test('群聊作用域标记会落到每一行', () => {
    const parsed = parseTranscriptRows([USER_TEXT_ROW], {
      scope: { isGroupRoom: true, isBotRoom: false },
      formatTimestamp,
    });
    assert.equal(parsed[0].isGroupRoom, true);
  });

  await t.test('row_id 必须转成持久 rowId，回滚才有可信锚点', () => {
    const [user] = parse([USER_TEXT_ROW]);
    assert.equal(user.rowId, 11);
  });

  await t.test('回滚锚点缺失时 rowId 为 undefined 而非伪造值', () => {
    const [user] = parse([{ role: 'user', content: '没有 row_id', timestamp: 1 }]);
    assert.equal(user.rowId, undefined);
  });
});

test('parseTranscriptRows - 未知 kind 一律回落 user（fail-open）', async (t) => {
  await t.test('未来版本写入的未知 kind 按普通用户消息显示', () => {
    const futureRow = { role: 'user', row_id: 40, content: '真实提问', display_kind: 'future_kind_v9', timestamp: 1 };
    const [row] = parse([futureRow]);
    assert.equal(row.displayKind, 'user', '未知 kind 不得静默隐藏用户消息');
    assert.equal(row.content, '真实提问');
  });
});

test('parseTranscriptRows - 时间戳解析绝不伪造 Date.now()（常规行与 synthesizedToolCall 双分支）', () => {
  let formatCalls = 0;
  const parseTrack = (list) =>
    parseTranscriptRows(list, {
      scope,
      formatTimestamp: (ts) => {
        formatCalls += 1;
        return `t${ts}`;
      },
    });

  // 1. 常规消息分支：缺省、0、负数、NaN、非法字符串一律返回 undefined 且不调 formatTimestamp
  const invalidCases = [
    { role: 'user', row_id: 101, content: 'no-ts' },
    { role: 'user', row_id: 102, content: 'zero-ts', timestamp: 0 },
    { role: 'user', row_id: 103, content: 'neg-ts', timestamp: -100 },
    { role: 'user', row_id: 104, content: 'nan-ts', timestamp: Number.NaN },
    { role: 'user', row_id: 105, content: 'bad-str', timestamp: 'not-a-date' },
  ];
  const parsedInvalid = parseTrack(invalidCases);
  assert.equal(parsedInvalid.length, 5);
  for (const m of parsedInvalid) {
    assert.equal(m.rawTimestamp, undefined, `常规行 ${m.rowId} 非法/缺失时间戳不得伪造成 Date.now() 或 1`);
    assert.equal(m.timestamp, '', `常规行 ${m.rowId} 无有效时间戳时展示串必须为空`);
  }
  assert.equal(formatCalls, 0, '无有效时间戳时不得调用 formatTimestamp');

  // 2. synthesizedToolCall 独立工具载荷分支（前面没有 assistant 可合并时独立成行，必须逐条独立解析）
  const synthCases = [
    { role: 'user', row_id: 201, content: '{"output":"ok-no-ts"}' },
    { role: 'user', row_id: 202, content: '{"output":"ok-zero"}', timestamp: 0 },
    { role: 'user', row_id: 203, content: '{"output":"ok-bad"}', created_at: 'invalid-date' },
  ];
  const parsedSynth = synthCases.map((row) => {
    const res = parseTrack([row]);
    assert.equal(res.length, 1, `独立工具载荷行 ${row.row_id} 应生成 1 条独立消息`);
    return res[0];
  });
  for (const m of parsedSynth) {
    assert.equal(m.rawTimestamp, undefined, `synthesizedToolCall 行 ${m.rowId} 绝不可伪造 Date.now()`);
    assert.equal(m.timestamp, '', `synthesizedToolCall 行 ${m.rowId} 展示串必须为空`);
    assert.equal(m.toolCalls?.length, 1, `行 ${m.rowId} 必须命中 synthesizedToolCall 分支`);
  }
  assert.equal(formatCalls, 0);

  // 3. 10 位秒级归一为 13 位毫秒、13 位毫秒原样保留（常规行与独立 synthesizedToolCall 双分支验证）
  const validRows = [
    { role: 'user', row_id: 301, content: 'sec', timestamp: 1700000000 },
    { role: 'assistant', row_id: 302, content: 'ms', created_at: 1700000005123 },
  ];
  const parsedValid = parseTrack(validRows);
  assert.equal(parsedValid[0].rawTimestamp, 1700000000000);
  assert.equal(parsedValid[0].timestamp, 't1700000000000');
  assert.equal(parsedValid[1].rawTimestamp, 1700000005123);

  const [parsedSynthValid] = parseTrack([
    { role: 'user', row_id: 303, content: '{"output":"synth-sec"}', timestamp: 1700000009 },
  ]);
  assert.equal(parsedSynthValid.rawTimestamp, 1700000009000);
  assert.equal(parsedSynthValid.timestamp, 't1700000009000');
  assert.equal(parsedSynthValid.toolCalls?.length, 1);
  assert.equal(formatCalls, 3);
});
