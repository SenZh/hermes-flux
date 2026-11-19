/**
 * 不变量映射表探针的证伪测试。
 *
 * 【设计意图 (Why)】
 *   探针守护的是"新增逻辑必须有不变量"，而探针自己失效时不会有任何报错：
 *   映射表照样存在、照样好看，只是那些条目不指向任何真实测试。
 *   因此必须用真实 JSON 变体逐条验证它的每条规则都会红。
 *
 * 【约束与规则 (Rules)】
 *   每个用例都在临时副本上跑，不触碰仓库内的真实文件。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const JSON_PATH = path.join(REPO_ROOT, 'docs/invariants.json');

/** 读取真实映射表作为基底（只读，绝不写回） */
function baseData() {
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
}

/**
 * 在临时副本上跑探针。
 *
 * 【设计意图 (Why)】
 *   探针校验 `test` / `source` 时以 REPO_ROOT 为基准拼路径，因此变体只需替换被读取的
 *   JSON 与 Markdown 位置，仓库锚点校验语义不受影响。
 *
 * 【防范的历史坑 (Pitfall)】
 *   旧实现直接改写仓库 docs/invariants.json 再在 finally 还原。实测一次 Windows 瞬时
 *   IO 失败（UNKNOWN: unknown error, open）打断还原，变体
 *   `does-not-exist.test.mjs` 被永久写入仓库文件，导致 6 个用例与 gates:invariants 连环失败。
 *   证伪测试自身绝不允许污染被它守护的真值源。
 *
 * 【约束与规则 (Rules)】
 *   每个用例使用独立的 mkdtemp 目录，跑完立即删除；仓库文件只读不写。
 */
function runWith(data, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-invariant-map-'));
  const jsonPath = path.join(dir, 'invariants.json');
  const mdPath = path.join(dir, 'invariants.md');
  try {
    fs.writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    const r = spawnSync(
      process.execPath,
      ['scripts/verify/invariant-map.mjs', '--json', jsonPath, '--md', mdPath, ...args],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 120000,
      },
    );
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('invariant-map · 真实映射表必须通过（这是所有变体的对照基准）', () => {
  const r = runWith(baseData());
  assert.equal(r.status, 0, `真实映射表应通过，实际输出:\n${r.out}`);
  assert.match(r.out, /映射表结构合格/);
});

test('invariant-map · 区间编号必须被拒绝（差集无法计算）', () => {
  const d = baseData();
  d.invariants[0].id = 'INV-12~16';
  const r = runWith(d);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /id 必须匹配/);
});

test('invariant-map · id 撞号必须被拒绝（同号异义会让比对失效）', () => {
  const d = baseData();
  d.invariants[1].id = d.invariants[0].id;
  const r = runWith(d);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /id 重复/);
});

test('invariant-map · test 用「同上」必须被拒绝', () => {
  const d = baseData();
  d.invariants[0].test = '同上';
  const r = runWith(d);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /不得使用区间或'同上'/);
});

test('invariant-map · test 指向不存在的文件必须被拒绝', () => {
  const d = baseData();
  d.invariants[0].test = 'packages/core/__tests__/formal/does-not-exist.test.mjs';
  const r = runWith(d);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /test 指向的文件不存在/);
});

test('invariant-map · test 文件不含 fc.assert 必须被拒绝（非属性测试不算不变量）', () => {
  const d = baseData();
  d.invariants[0].test = 'packages/core/__tests__/architecture/gate-engine.test.mjs';
  const r = runWith(d);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /没有 fc\.assert/);
});

test('invariant-map · source 指向不存在的源码必须被拒绝', () => {
  const d = baseData();
  d.invariants[0].source = 'packages/core/src/does-not-exist.ts';
  const r = runWith(d);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /source 指向的源码不存在/);
});

test('invariant-map · 缺少必填字段必须被拒绝', () => {
  for (const field of ['topic', 'source', 'symbol', 'test', 'failure']) {
    const d = baseData();
    delete d.invariants[0][field];
    const r = runWith(d);
    assert.notEqual(r.status, 0, `缺少 ${field} 时必须失败`);
    assert.match(r.out, new RegExp(`缺少必填字段 ${field}`));
  }
});

test('invariant-map · --check 在 Markdown 视图过期时必须失败', () => {
  const d = baseData();
  d.invariants.push({
    id: 'INV-NEW-01',
    topic: '临时新增条目',
    source: 'packages/core/src/cache/cacheMerge.ts',
    symbol: 'maxOrderKey',
    test: 'packages/core/__tests__/formal/cache-fence-formal.test.mjs',
    failure: '用于验证 --check 能发现 Markdown 未同步',
  });
  const r = runWith(d, ['--check']);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /与 invariants\.json 不一致/);
});

test('invariant-map · 已登记的每条不变量都真实存在并含 fc.assert', () => {
  const d = baseData();
  assert.ok(d.invariants.length >= 30, `不变量数量应 >= 30，实际 ${d.invariants.length}`);
  for (const inv of d.invariants) {
    const abs = path.join(REPO_ROOT, inv.test);
    assert.ok(fs.existsSync(abs), `${inv.id} 的测试文件必须存在: ${inv.test}`);
    assert.match(fs.readFileSync(abs, 'utf8'), /fc\.assert\s*\(/, `${inv.id} 的测试必须含 fc.assert`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, inv.source)), `${inv.id} 的源码锚点必须存在: ${inv.source}`);
  }
});
