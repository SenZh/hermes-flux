/**
 * Agent 在场状态投影单元测试 (packages/core/__tests__/agent/agentPresence.test.mjs)
 *
 * 【测试什么】用户在指示器上真正能读到的语义：
 *   优先级短路顺序、工具类别与目标提取、时长分层的三档边界、眨眼的非等距与确定性。
 * 【不测什么】文案字符串（那是表现层与 i18n 的职责）、DOM 结构与样式。
 *
 * 【变异杀伤力】每条断言都对应生产逻辑的一条分支：
 *   把优先级顺序换一下、把阈值改一位、把 FNV 换成线性取模，对应断言即变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveAgentPresence,
  presenceTone,
  classifyPresenceTool,
  nextBlinkDelayMs,
  pickIdleQuipIndex,
  BLINK_MIN_INTERVAL_MS,
  BLINK_MAX_INTERVAL_MS,
  IDLE_QUIP_COUNT,
} from '../../dist/agent/agentPresence.js';

const NOW = 1_700_000_000_000;

function input(overrides = {}) {
  return {
    isStreaming: true,
    message: { thought: '', content: '', toolCalls: [] },
    now: NOW,
    turnStartedAt: NOW,
    ...overrides,
  };
}

test('deriveAgentPresence - 优先级短路顺序', async (t) => {
  await t.test('无流式且无消息 => idle', () => {
    const presence = deriveAgentPresence(input({ isStreaming: false, message: null }));
    assert.deepEqual(presence, { kind: 'idle' });
  });

  await t.test('有流式但消息为 null => idle（不猜测在途回合）', () => {
    const presence = deriveAgentPresence(input({ message: null }));
    assert.equal(presence.kind, 'idle');
  });

  await t.test('失败压过一切在途痕迹（含正在运行的工具）', () => {
    const presence = deriveAgentPresence(
      input({
        lastError: '工具超时 60s',
        activeSubagents: 2,
        message: {
          thought: '想一想',
          content: '写了一半',
          toolCalls: [{ name: 'shell', status: 'running', args: '{"command":"pnpm test"}' }],
        },
      })
    );
    assert.deepEqual(presence, { kind: 'failed', message: '工具超时 60s' });
  });

  await t.test('中断压过委派与工具', () => {
    const presence = deriveAgentPresence(
      input({
        interrupted: true,
        activeSubagents: 1,
        message: { toolCalls: [{ name: 'read', status: 'running', args: 'a.ts' }] },
      })
    );
    assert.deepEqual(presence, { kind: 'interrupted' });
  });

  await t.test('委派压过工具（活是派出去干的）', () => {
    const presence = deriveAgentPresence(
      input({
        activeSubagents: 2,
        subagentProfile: 'flux-code-reviewer',
        message: { toolCalls: [{ name: 'read', status: 'running', args: 'a.ts' }] },
      })
    );
    assert.deepEqual(presence, { kind: 'delegating', profile: 'flux-code-reviewer', count: 2 });
  });

  await t.test('工具压过正文（正文流式时也可能同时在跑工具）', () => {
    const presence = deriveAgentPresence(
      input({
        message: {
          content: '正在输出正文',
          thought: '想过',
          toolCalls: [{ name: 'shell', status: 'running', args: '{"command":"pnpm verify"}' }],
        },
      })
    );
    assert.equal(presence.kind, 'tool');
    assert.equal(presence.tool, 'command');
    assert.equal(presence.target, 'pnpm verify');
    assert.equal(presence.runningCount, 1);
  });

  await t.test('已完成/失败的工具不算在途 => 落到 writing', () => {
    const presence = deriveAgentPresence(
      input({
        message: {
          content: '正文已产出',
          toolCalls: [
            { name: 'shell', status: 'completed', args: '{}' },
            { name: 'read', status: 'failed', args: '{}' },
          ],
        },
      })
    );
    assert.equal(presence.kind, 'writing');
  });

  await t.test('只有思考 => thinking；思考与正文都空 => 仍 thinking（回合已开始但未产出）', () => {
    assert.equal(deriveAgentPresence(input({ message: { thought: '在想' } })).kind, 'thinking');
    assert.equal(deriveAgentPresence(input({ message: {} })).kind, 'thinking');
  });

  await t.test('空白字符串不算产出（trim 后为空）', () => {
    const presence = deriveAgentPresence(input({ message: { content: '   ', thought: '\n\t' } }));
    assert.equal(presence.kind, 'thinking');
  });
});

test('deriveAgentPresence - 时长与计数边界', async (t) => {
  await t.test('turnStartedAt 缺失时 sinceMs 记 0，不产生 NaN', () => {
    const presence = deriveAgentPresence(input({ turnStartedAt: undefined, message: { thought: 'x' } }));
    assert.equal(presence.sinceMs, 0);
  });

  await t.test('turnStartedAt 在未来时夹到 0（时钟回拨不得产生负时长）', () => {
    const presence = deriveAgentPresence(
      input({ turnStartedAt: NOW + 5000, message: { thought: 'x' } })
    );
    assert.equal(presence.sinceMs, 0);
  });

  await t.test('sinceMs 按 now - turnStartedAt 计算', () => {
    const presence = deriveAgentPresence(
      input({ turnStartedAt: NOW - 12_000, message: { thought: 'x' } })
    );
    assert.equal(presence.sinceMs, 12_000);
  });

  await t.test('activeSubagents 为负数或小数时归一到非负整数', () => {
    const negative = deriveAgentPresence(input({ activeSubagents: -3 }));
    assert.notEqual(negative.kind, 'delegating');
    const fractional = deriveAgentPresence(input({ activeSubagents: 2.9, subagentProfile: 'p' }));
    assert.equal(fractional.kind, 'delegating');
    assert.equal(fractional.count, 2);
  });

  await t.test('多个工具同时运行 => runningCount 正确，target 取第一个运行项', () => {
    const presence = deriveAgentPresence(
      input({
        message: {
          toolCalls: [
            { name: 'read', status: 'running', args: '{"path":"a.ts"}' },
            { name: 'shell', status: 'running', args: '{"command":"ls"}' },
          ],
        },
      })
    );
    assert.equal(presence.runningCount, 2);
    assert.equal(presence.target, 'a.ts');
  });
});

test('classifyPresenceTool - 关键字判定与写操作优先', async (t) => {
  const cases = [
    ['shell', 'command'],
    ['bash_exec', 'command'],
    ['terminal', 'command'],
    ['powershell', 'command'],
    ['write_file', 'edit'],
    ['edit_file', 'edit'],
    ['apply_patch', 'edit'],
    ['read_file', 'read'],
    ['cat', 'read'],
    ['grep', 'search'],
    ['search_files', 'search'],
    ['glob', 'search'],
    ['delegate_task', 'agent'],
    ['subagent_spawn', 'agent'],
    ['browser_navigate', 'browser'],
    ['playwright_click', 'browser'],
    ['unknown_tool', 'other'],
    ['', 'other'],
  ];
  for (const [name, expected] of cases) {
    await t.test(`${name || '(空)'} => ${expected}`, () => {
      assert.equal(classifyPresenceTool(name), expected);
    });
  }

  await t.test('write_file 不得被判成只读 read（历史缺陷回归）', () => {
    assert.notEqual(classifyPresenceTool('write_file'), 'read');
  });
});

test('presenceTone - 三档边界', async (t) => {
  await t.test('thinking：7999 fresh / 8000 patient / 29999 patient / 30000 long', () => {
    assert.equal(presenceTone({ kind: 'thinking', sinceMs: 7_999 }), 'fresh');
    assert.equal(presenceTone({ kind: 'thinking', sinceMs: 8_000 }), 'patient');
    assert.equal(presenceTone({ kind: 'thinking', sinceMs: 29_999 }), 'patient');
    assert.equal(presenceTone({ kind: 'thinking', sinceMs: 30_000 }), 'long');
  });

  await t.test('tool 与 writing 同样参与分层', () => {
    assert.equal(
      presenceTone({ kind: 'tool', tool: 'read', target: 'a.ts', runningCount: 1, sinceMs: 31_000 }),
      'long'
    );
    assert.equal(presenceTone({ kind: 'writing', sinceMs: 9_000 }), 'patient');
  });

  await t.test('终态与 idle/delegating 一律 fresh（不叠时长语义）', () => {
    assert.equal(presenceTone({ kind: 'failed', message: 'x' }), 'fresh');
    assert.equal(presenceTone({ kind: 'interrupted' }), 'fresh');
    assert.equal(presenceTone({ kind: 'idle' }), 'fresh');
    assert.equal(presenceTone({ kind: 'delegating', profile: 'p', count: 1 }), 'fresh');
  });
});

test('nextBlinkDelayMs - 非等距、确定性、分布不退化', async (t) => {
  await t.test('输出恒落在 [2800, 5400) 区间', () => {
    for (let i = 0; i < 500; i += 1) {
      const delay = nextBlinkDelayMs(i);
      assert.ok(delay >= BLINK_MIN_INTERVAL_MS, `${delay} 小于下界`);
      assert.ok(delay < BLINK_MAX_INTERVAL_MS, `${delay} 超出上界`);
      assert.ok(Number.isInteger(delay), `${delay} 必须是整数毫秒`);
    }
  });

  await t.test('同一 seed 恒等（可复现，不依赖随机源）', () => {
    assert.equal(nextBlinkDelayMs('turn-42'), nextBlinkDelayMs('turn-42'));
    assert.equal(nextBlinkDelayMs(7), nextBlinkDelayMs(7));
  });

  await t.test('相邻 seed 不产生等距节拍（等距会读成机器）', () => {
    const deltas = new Set();
    for (let i = 0; i < 20; i += 1) {
      deltas.add(nextBlinkDelayMs(i + 1) - nextBlinkDelayMs(i));
    }
    assert.ok(deltas.size > 1, '相邻 seed 的间隔差必须不止一种取值');
  });

  await t.test('1000 个 seed 覆盖到区间的多个分位（分布不塌缩到少数值）', () => {
    const buckets = new Set();
    for (let i = 0; i < 1000; i += 1) {
      buckets.add(Math.floor((nextBlinkDelayMs(i) - BLINK_MIN_INTERVAL_MS) / 260));
    }
    assert.ok(buckets.size >= 8, `分桶仅 ${buckets.size} 个，分布退化`);
  });
});

test('pickIdleQuipIndex - 空闲轮播的确定性、范围与遍历性', async (t) => {
  await t.test('返回值恒落在 [0, IDLE_QUIP_COUNT) 且为整数', () => {
    for (let tick = 0; tick < 200; tick += 1) {
      const index = pickIdleQuipIndex(`session-${tick % 7}`, tick);
      assert.ok(Number.isInteger(index), `${index} 必须是整数`);
      assert.ok(index >= 0 && index < IDLE_QUIP_COUNT, `${index} 越界`);
    }
  });

  await t.test('同一 seed + tick 恒等（禁止随机源，否则测试不可复现）', () => {
    assert.equal(pickIdleQuipIndex('session-a', 3), pickIdleQuipIndex('session-a', 3));
    assert.equal(pickIdleQuipIndex('', 0), pickIdleQuipIndex('', 0));
  });

  await t.test('连续 IDLE_QUIP_COUNT 拍走遍全部文案（不重复、不遗漏）', () => {
    const seen = new Set();
    for (let tick = 0; tick < IDLE_QUIP_COUNT; tick += 1) {
      seen.add(pickIdleQuipIndex('group:小发王,审核官', tick));
    }
    assert.equal(seen.size, IDLE_QUIP_COUNT, '一个周期内必须遍历全部文案');
  });

  await t.test('不同身份不会锁死在同一句（避免所有会话读同一句话）', () => {
    const firsts = new Set();
    for (let i = 0; i < 50; i += 1) firsts.add(pickIdleQuipIndex(`session-${i}`, 0));
    assert.ok(firsts.size >= 4, `50 个身份的起始文案仅 ${firsts.size} 种，分布退化`);
  });

  await t.test('非法 tick（负数 / NaN）按 0 处理，不产生越界或 NaN', () => {
    assert.equal(pickIdleQuipIndex('s', -5), pickIdleQuipIndex('s', 0));
    assert.equal(pickIdleQuipIndex('s', Number.NaN), pickIdleQuipIndex('s', 0));
  });
});
