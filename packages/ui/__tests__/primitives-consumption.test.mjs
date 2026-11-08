/**
 * shadcn primitives 消费守卫。
 *
 * 【为什么需要】primitives 入库后一度零消费（grep 全域无 import），等价于入库即死代码，
 *   与历史上 accordion / tabs / avatar 三个死文件的失效模式完全相同。
 * 【本探针怎么守】
 *   1. 每个 primitive 必须在登记表里有明确状态：`consumed`（有生产消费者）或 `pending`（尚未消费，且写明落地 PR）。
 *   2. `consumed` 集合只增不减：谁把消费改回去，这里立刻变红。
 *   3. `pending` 集合只减不增：禁止再新增"入库即死"的组件。
 *   4. 登记为 consumed 的组件必须真有生产代码 import 并渲染，不能只写在表里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const UI_SRC = path.resolve(import.meta.dirname, '../src');
const PRIMITIVES_DIR = path.join(UI_SRC, 'components-react/primitives');

/**
 * 消费登记表。
 * 【约束】consumed 至少一项；pending 的每项必须写清消费它的后续 PR，禁止"以后再说"。
 */
const CONSUMPTION = {
  Button: { state: 'consumed', consumers: ['components-react/LeftRail.tsx', 'components-react/settings/SettingsModal.tsx'] },
  Input: { state: 'consumed', consumers: ['components-react/LeftRail.tsx', 'components-react/settings/SettingsModal.tsx'] },
  Badge: { state: 'consumed', consumers: ['components-react/LeftRail.tsx', 'components-react/settings/SettingsModal.tsx'] },
  Dialog: { state: 'pending', target: 'SettingsModal / Modal 族迁移 PR（波③）' },
  Menu: { state: 'pending', target: 'ContextMenu 舱迁移 PR（波③，右键菜单三态收编）' },
  Switch: { state: 'pending', target: 'SettingsModal 布尔开关迁移 PR（波③）' },
};

/** 收集 ui 包内所有未被排除的生产源文件（排除 primitives 自身与 barrel）。 */
function productionSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'primitives' || entry.name === 'i18n') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
      const rel = path.relative(UI_SRC, full).split(path.sep).join('/');
      if (rel === 'index.ts') continue;
      out.push({ rel, source: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(UI_SRC);
  return out;
}

test('primitives 消费守卫：登记表结构完整且状态合法', async (t) => {
  const primitiveNames = fs.readdirSync(PRIMITIVES_DIR)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => name.replace(/\.tsx$/, ''))
    .sort();

  await t.test('磁盘上的每个 primitive 都在登记表里，不存在漏登记的组件', () => {
    assert.deepEqual(primitiveNames, Object.keys(CONSUMPTION).sort(), '新增 primitive 必须同步登记消费状态');
  });

  await t.test('每项状态只能是 consumed / pending，且 pending 必须写明落地 PR', () => {
    for (const [name, entry] of Object.entries(CONSUMPTION)) {
      assert.ok(['consumed', 'pending'].includes(entry.state), `${name} 状态非法`);
      if (entry.state === 'pending') {
        assert.ok(entry.target && entry.target.length > 0, `${name} 标为 pending 时必须写明消费它的 PR`);
      } else {
        assert.ok(Array.isArray(entry.consumers) && entry.consumers.length > 0, `${name} 标为 consumed 时必须列出消费者`);
      }
    }
  });

  await t.test('consumed 集合至少三项，且只允许增长', () => {
    const consumed = Object.entries(CONSUMPTION).filter(([, entry]) => entry.state === 'consumed').map(([name]) => name).sort();
    assert.ok(consumed.length >= 3, `已消费 primitives 不得少于 3 个，当前 ${consumed.length}`);
    // 冻结当前消费集合：删除任何一项都必须先解释清楚，不能悄悄发生
    assert.deepEqual(consumed, ['Badge', 'Button', 'Input'], '已消费集合只增不减；若确有迁移请同步更新本断言并在 PR 里说明');
  });
});

test('primitives 消费守卫：consumed 的组件必须真有生产消费者', async (t) => {
  const sources = productionSources();

  for (const [name, entry] of Object.entries(CONSUMPTION)) {
    if (entry.state !== 'consumed') continue;

    await t.test(`${name} 必须被声明的消费者真实 import 并渲染`, () => {
      for (const consumerRel of entry.consumers) {
        const consumer = sources.find((file) => file.rel === consumerRel);
        assert.ok(consumer, `${name} 声明的消费者 ${consumerRel} 不存在`);
        const importRe = new RegExp(`from\\s+['"][^'"]*primitives/${name}\\.js['"]`);
        assert.ok(importRe.test(consumer.source), `${consumerRel} 必须 import ${name}`);
        const usageRe = new RegExp(`<${name}[\\s>]`);
        assert.ok(usageRe.test(consumer.source), `${consumerRel} 必须真实渲染 <${name}>`);
      }
    });

    await t.test(`${name} 的消费者不止声明的那一处时也必须可枚举`, () => {
      const importRe = new RegExp(`from\\s+['"][^'"]*primitives/${name}\\.js['"]`);
      const actual = sources.filter((file) => importRe.test(file.source)).map((file) => file.rel).sort();
      for (const file of actual) {
        assert.ok(
          entry.consumers.includes(file),
          `${name} 出现未登记的消费者 ${file}；请把它补进登记表，让消费面始终可枚举`,
        );
      }
    });
  }
});

test('primitives 消费守卫：pending 的组件不得被"顺带"用上却仍标记 pending', async (t) => {
  const sources = productionSources();

  for (const [name, entry] of Object.entries(CONSUMPTION)) {
    if (entry.state !== 'pending') continue;

    await t.test(`${name} 标为 pending 期间不得已有生产消费者（否则应转正）`, () => {
      const importRe = new RegExp(`from\\s+['"][^'"]*primitives/${name}\\.js['"]`);
      const consumers = sources.filter((file) => importRe.test(file.source)).map((file) => file.rel);
      assert.deepEqual(
        consumers,
        [],
        `${name} 已被 ${consumers.join(', ')} 消费，必须把登记表状态改为 consumed 并补上消费者清单`,
      );
    });
  }
});
