#!/usr/bin/env node
/**
 * 不变量映射表探针。
 *
 * 设计意图 (Why):
 *   "不变量"是本项目对状态机类逻辑的唯一强约束。但它此前只存在于 Markdown 表格里，
 *   无法被机器比对：编号有区间写法（INV-12~16）、有 7 处"同上"、
 *   没有源码锚点列，于是"新增逻辑减去已登记项"这个差集在数学上不可计算。
 *   结果就是映射表可以永远保持"看起来齐备"，而新逻辑完全没被守护。
 *
 * 防范的历史坑 (Pitfall)（均有实测依据）:
 *   1. 编号撞号：older-pagination 与 provider-attach-flow 都自称"定理 30~34"，
 *      同号异义让任何基于编号的比对都失去意义。因此改为全局唯一 id。
 *   2. 区间写法 `INV-12~16` 在文本上是一个 token，做不了差集。禁用区间。
 *   3. "同上"让 7 条不变量共用一个测试路径，无法判断某一条到底有没有被守护。禁用。
 *
 * 约束与规则 (Rules):
 *   1. id 必须全局唯一，且符合 `INV-<AREA>-<NN>`。
 *   2. test 必须是单一路径字符串，文件必须存在且含 `fc.assert`（属性测试）。
 *   3. source 必须是仓库内真实存在的源码路径。
 *   4. 表内每条记录的 source+symbol 组合必须唯一，避免同一锚点重复登记。
 *   5. `--render` 生成 docs/invariants.md；`--check` 断言 Markdown 与 JSON 一致。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const DEFAULT_JSON_PATH = path.join(REPO_ROOT, 'docs/invariants.json');
const DEFAULT_MD_PATH = path.join(REPO_ROOT, 'docs/invariants.md');

/**
 * 解析读写路径覆盖参数。
 *
 * 【设计意图 (Why)】
 *   证伪测试需要把"变体映射表"喂给探针逐条验证规则会红。若探针只认仓库固定路径，
 *   测试就必须写穿真实 docs/invariants.json，再靠 finally 还原。
 *
 * 【防范的历史坑 (Pitfall)】
 *   实测事故（2026-11-19）：全量测试期间一次 Windows 瞬时 IO 失败
 *   （UNKNOWN: unknown error, open）打断还原路径，变体
 *   `does-not-exist.test.mjs` 被永久留在仓库文件里，随后 invariant-map 6 个用例
 *   与 gates:invariants 连环失败，并把"脏状态"伪装成业务代码问题。
 *
 * 【约束与规则 (Rules)】
 *   1. `--json` / `--md` 只改变读写位置，`test` 与 `source` 的相对路径校验
 *      仍以 REPO_ROOT 为基准，因此规则语义完全不变；
 *   2. 缺省（不传参）必须仍是仓库内 docs/invariants.json 与 docs/invariants.md，
 *      保证 npm scripts 与门禁调用零改动。
 */
function parseArgs(argv) {
  const options = {
    jsonPath: DEFAULT_JSON_PATH,
    mdPath: DEFAULT_MD_PATH,
    render: false,
    check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--render') options.render = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--json') options.jsonPath = path.resolve(argv[i + 1] ?? '');
    else if (arg === '--md') options.mdPath = path.resolve(argv[i + 1] ?? '');
  }
  return options;
}

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

const ID_PATTERN = /^INV-[A-Z]+-\d{2}$/;

function load(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.invariants)) throw new Error('invariants.json 缺少 invariants 数组');
  return data;
}

/**
 * 校验映射表自身的完整性。
 * 返回问题列表（空表示通过）。
 */
function validate(data) {
  const problems = [];
  const ids = new Map();
  const anchors = new Map();

  for (const inv of data.invariants) {
    const where = inv.id ?? '(缺 id)';

    if (!inv.id || !ID_PATTERN.test(inv.id)) {
      problems.push(`${where}: id 必须匹配 INV-<AREA>-<NN>（禁区间、禁'同上'）`);
    } else if (ids.has(inv.id)) {
      problems.push(`${where}: id 重复（同号异义会让比对失效）`);
    } else {
      ids.set(inv.id, inv);
    }

    for (const field of ['topic', 'source', 'symbol', 'test', 'failure']) {
      if (!inv[field] || typeof inv[field] !== 'string' || inv[field].trim() === '') {
        problems.push(`${where}: 缺少必填字段 ${field}`);
      }
    }

    // test 必须是单一路径且真实存在
    if (typeof inv.test === 'string') {
      if (inv.test.includes('~') || inv.test.includes('同上')) {
        problems.push(`${where}: test 不得使用区间或'同上'，必须给出单一文件路径`);
      } else {
        const abs = path.join(REPO_ROOT, inv.test);
        if (!fs.existsSync(abs)) {
          problems.push(`${where}: test 指向的文件不存在: ${inv.test}`);
        } else if (!/fc\.assert\s*\(/.test(fs.readFileSync(abs, 'utf8'))) {
          problems.push(`${where}: test 文件内没有 fc.assert，不是属性测试: ${inv.test}`);
        }
      }
    }

    // source 必须真实存在
    if (typeof inv.source === 'string') {
      const abs = path.join(REPO_ROOT, inv.source);
      if (!fs.existsSync(abs)) {
        problems.push(`${where}: source 指向的源码不存在: ${inv.source}`);
      }
      const key = `${inv.source}::${inv.symbol}`;
      if (anchors.has(key)) {
        problems.push(`${where}: 锚点 ${key} 已被 ${anchors.get(key)} 占用（同一锚点应合并为一条）`);
      } else {
        anchors.set(key, inv.id);
      }
    }
  }

  return problems;
}

/** 渲染 Markdown 视图 */
function render(data) {
  const byArea = new Map();
  for (const inv of data.invariants) {
    const area = inv.id.split('-')[1];
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(inv);
  }

  const lines = [];
  lines.push('# 不变量映射表（Invariant Map）');
  lines.push('');
  lines.push('> **本文件由 `scripts/verify/invariant-map.mjs --render` 生成，禁止手工修改。**');
  lines.push('> 单一真值源是 [`invariants.json`](invariants.json)；改内容请改 JSON 再重新生成。');
  lines.push('> 设计说明见 [`testing-strategy.md`](testing-strategy.md) 第五章。');
  lines.push('');
  lines.push('## 为什么用 JSON 而不是手写表格');
  lines.push('');
  lines.push('旧版 Markdown 表格有三个结构性缺陷，导致它无法被机器校验：');
  lines.push('');
  lines.push('1. **编号撞号**：两个不同文件都自称「定理 30~34」，同号异义让任何比对失效；');
  lines.push('2. **区间写法**：`INV-12~16` 在文本上是一个 token，做不了差集；');
  lines.push('3. **7 处「同上」**：多条不变量共用一个路径，无法判断某一条是否真被守护。');
  lines.push('');
  lines.push('JSON 版本强制每条给出唯一 `id`、被测源码 `source`、`symbol` 与单一 `test` 路径，');
  lines.push('于是「新增逻辑 − 已登记项」这个差集才在数学上可计算。');
  lines.push('');
  lines.push('## 校验规则');
  lines.push('');
  lines.push('| 规则 | 判定 |');
  lines.push('|---|---|');
  lines.push('| id 唯一且匹配 `INV-<AREA>-<NN>` | 违者 FAIL |');
  lines.push('| `test` 为单一真实路径 | 违者 FAIL |');
  lines.push('| `test` 文件内含 `fc.assert` | 违者 FAIL |');
  lines.push('| `source` 为真实源码路径 | 违者 FAIL |');
  lines.push('| `source`+`symbol` 组合唯一 | 违者 FAIL |');
  lines.push('');
  lines.push(`## 总览（${data.invariants.length} 条，覆盖 ${byArea.size} 个领域）`);
  lines.push('');

  for (const [area, list] of [...byArea.entries()].sort()) {
    lines.push(`### ${area}（${list.length} 条）`);
    lines.push('');
    lines.push('| 编号 | 主题 | 源码锚点 | 守护测试 | 失效模式 |');
    lines.push('|---|---|---|---|---|');
    for (const inv of list) {
      lines.push(
        `| \`${inv.id}\` | ${inv.topic} | \`${inv.source}\` → \`${inv.symbol}\` | \`${inv.test.split('/').pop()}\` | ${inv.failure} |`,
      );
    }
    lines.push('');
  }

  lines.push('## 尚未覆盖的领域（刻意登记为空）');
  lines.push('');
  lines.push('以下领域当前没有任何形式化不变量。新增这些领域的可判定逻辑时应先补映射，');
  lines.push('否则它属于「没有被任何性质守护的新逻辑」：');
  lines.push('');
  lines.push('- `core/src/queue/`（写入队列）');
  lines.push('- `core/src/group/`（群聊研讨室）');
  lines.push('- `core/src/subagent/`（子代理运行时）');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const data = load(options.jsonPath);
  const problems = validate(data);

  console.log(`${C.cyan}${C.bold}不变量映射表探针${C.reset}`);
  console.log(`${C.dim}  ${data.invariants.length} 条不变量${C.reset}\n`);

  if (problems.length > 0) {
    console.log(`${C.red}${C.bold}✘ 映射表自身不合格（${problems.length} 项）${C.reset}`);
    for (const p of problems) console.log(`  ${C.red}·${C.reset} ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${C.green}✔${C.reset} 映射表结构合格：id 唯一、测试真实存在且含 fc.assert、锚点无重复`);

  const rendered = render(data);
  const isRender = options.render;
  const isCheck = options.check;

  if (isRender) {
    fs.writeFileSync(options.mdPath, rendered, 'utf8');
    console.log(`${C.green}✔${C.reset} 已生成 ${path.relative(REPO_ROOT, options.mdPath) || options.mdPath}（${rendered.split('\n').length} 行）`);
    process.exitCode = 0;
    return;
  }

  if (isCheck) {
    const current = fs.existsSync(options.mdPath) ? fs.readFileSync(options.mdPath, 'utf8') : '';
    const normalize = (t) => t.replace(/\r\n/g, '\n');
    if (normalize(current) !== normalize(rendered)) {
      console.log(`${C.red}✘ docs/invariants.md 与 invariants.json 不一致${C.reset}`);
      console.log(`${C.dim}  运行: node scripts/verify/invariant-map.mjs --render${C.reset}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${C.green}✔${C.reset} Markdown 视图与 JSON 一致`);
  }

  process.exitCode = 0;
}

main();
