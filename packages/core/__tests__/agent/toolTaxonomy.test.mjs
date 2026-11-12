/**
 * 工具分类单一真值源单元测试 (packages/core/__tests__/agent/toolTaxonomy.test.mjs)
 *
 * 【测试什么】真实工具名在两个消费者（工具轨迹胶囊 / 在场指示器）上的分类一致性。
 * 【为什么必须测】两处曾各写一套 `includes` 链，实测 14 个真实工具名里 4 个判定不一致，
 *   表现为「轨迹里写读取、指示器里写搜索」的双标。
 *
 * 【变异杀伤力】把 TAXONOMY_RULES 的任意两行顺序对调、把 readOnly 改一位、
 *   在 classifyPresenceTool 里再写一条 includes 分支，对应用例立刻变红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyToolName } from '../../dist/agent/toolTaxonomy.js';
import { classifyPresenceTool } from '../../dist/agent/agentPresence.js';

/**
 * 真实工具名表：来自网关契约与本地 MCP 工具的实测命名。
 * 每行给出期望类别与只读标志——改坏任何一行都必须变红。
 */
const TABLE = [
  // name, kind, readOnly
  ['shell', 'command', false],
  ['bash_exec', 'command', false],
  ['terminal', 'command', false],
  ['powershell', 'command', false],
  ['skill_run', 'skill', false],
  ['write_skill', 'skill', false],
  ['write_file', 'write', false],
  ['edit_file', 'edit', false],
  ['apply_patch', 'edit', false],
  ['read_file', 'read', true],
  ['cat', 'read', true],
  ['search_read_index', 'read', true],
  ['grep', 'search', false],
  ['search_files', 'search', false],
  ['glob', 'search', false],
  ['find', 'search', false],
  ['subagent_spawn', 'agent', false],
  ['delegate_task', 'agent', false],
  ['browser_navigate', 'browser', false],
  ['playwright_click', 'browser', false],
  ['unknown_tool', 'other', false],
  ['', 'other', false],
];

test('classifyToolName - 表驱动分类与只读标志', async (t) => {
  for (const [name, kind, readOnly] of TABLE) {
    await t.test(`${name || '(空)'} => ${kind}${readOnly ? ' (readOnly)' : ''}`, () => {
      assert.deepEqual(classifyToolName(name), { kind, readOnly });
    });
  }
});

test('classifyToolName - 判定顺序不变量', async (t) => {
  await t.test('write 早于 read：write_file 不得被折叠成只读', () => {
    const result = classifyToolName('write_file');
    assert.equal(result.kind, 'write');
    assert.equal(result.readOnly, false);
  });

  await t.test('read 早于 search：search_read_index 归类为 read', () => {
    // 该名字同时含 search 与 read，语义上读的是索引，必须判 read
    assert.equal(classifyToolName('search_read_index').kind, 'read');
  });

  await t.test('skill 早于 write：write_skill 是技能操作而非文件写入', () => {
    assert.equal(classifyToolName('write_skill').kind, 'skill');
  });

  await t.test('只读集合必须恰好是 read 一类', () => {
    const readOnlyKinds = new Set(
      TABLE.filter(([, , readOnly]) => readOnly).map(([, kind]) => kind),
    );
    assert.deepEqual([...readOnlyKinds], ['read'], '只允许 read 类为只读，写操作必须逐条可见');
  });
});

test('classifyPresenceTool - 与轨迹胶囊共用同一判定', async (t) => {
  /** 在场指示器的语义收敛：write→edit、skill→other，其余同类别 */
  const PRESENCE_MAP = {
    command: 'command',
    skill: 'other',
    write: 'edit',
    edit: 'edit',
    read: 'read',
    search: 'search',
    agent: 'agent',
    browser: 'browser',
    other: 'other',
  };

  await t.test('每个真实工具名的在场类别都等于「工具类别 → 在场类别」的映射', () => {
    for (const [name, kind] of TABLE) {
      assert.equal(
        classifyPresenceTool(name),
        PRESENCE_MAP[kind],
        `${name || '(空)'} 的在场类别与工具类别不一致（工具类别 ${kind}）`,
      );
    }
  });

  await t.test('两个消费者对同一 name 的「是否委派」判定必须一致', () => {
    // delegate_task 曾出现「胶囊判 other、指示器判 agent」的双标
    for (const name of ['delegate_task', 'subagent_spawn']) {
      assert.equal(classifyToolName(name).kind, 'agent');
      assert.equal(classifyPresenceTool(name), 'agent');
    }
  });

  await t.test('skill 类在指示器上归入 other，不产生独立动词', () => {
    assert.equal(classifyPresenceTool('skill_run'), 'other');
    assert.equal(classifyPresenceTool('write_skill'), 'other');
  });
});
