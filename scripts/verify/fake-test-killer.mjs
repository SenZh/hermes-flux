#!/usr/bin/env node
/**
 * 假测试证伪器（Fake-Test Killer）。
 *
 * 设计意图 (Why):
 *   "这个测试有没有用"只有一个客观判据：把被测生产代码删掉，它会不会红。
 *   本仓历史上出现过三处「测试全绿但生产代码删掉仍全绿」的假测试，
 *   它们的共同病根是测试在内部重写了一份实现，或在断言里复用了被测代码的同一函数。
 *
 *   这类缺陷没法靠读代码发现——测试文件本身看起来完全合理。
 *   唯一可靠的办法是机械地删一次生产代码再看它红不红。
 *   本脚本把这件事做成可重复执行的流程，而不是一次性的手工核对。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 必须还原。脚本用 try/finally 保证无论如何都把产物还原，
 *      否则一次中断就会留下被破坏的构建产物，后续所有测试结果都不可信。
 *   2. 必须断言"失败原因对得上"。只断言"exit != 0"不够：
 *      语法错误、模块找不到、导入路径写错同样会让 exit != 0，
 *      那样会得出"测试有效"的错误结论。
 *      因此每条变异都要求输出里出现指定的断言文案。
 *   3. 只变异构建产物（dist），不改源码。源码变异会触发重新构建，
 *      让整条链路变慢且难以还原。
 *
 * 约束与规则 (Rules):
 *   - 每条变异必须写明 `expect`：变异后应当出现的断言片段。
 *   - 还原必须在 finally 里完成，且还原后要验证文件长度恢复。
 *   - 任一变异"没杀掉"即整体失败。
 *
 * 用法:
 *   node scripts/verify/fake-test-killer.mjs
 *   node scripts/verify/fake-test-killer.mjs persistedJson   # 只跑名字匹配的
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

/**
 * 变异清单。
 *
 * `file`   构建产物路径（相对仓库根）
 * `find`   要被删掉的实现片段（正则）
 * `test`   应当因此变红的测试文件
 * `expect` 变红时输出里必须出现的断言文案（防止"因语法错误而红"被误判为有效）
 * `why`    这条变异对应哪个历史缺陷
 */
const MUTATIONS = [
  {
    name: 'persistedJson: 删掉类型守卫 validate',
    file: 'packages/desktop/dist/renderer/persistence/persistedJson.mjs',
    find: /if \(validate\) \{\s*return validate\(parsed\) \? parsed : fallback;\s*\}/,
    test: 'packages/desktop/__tests__/unit/cache-integration-wiring.test.mjs',
    expect: '带守卫时必须回落',
    why: '原测试在内部重写了一份实现，删掉生产代码的守卫后仍 12/12 全绿',
  },
  {
    name: 'persistedJson: resolveDurableOrderKey 不再拒绝非法主键',
    file: 'packages/desktop/dist/renderer/persistence/persistedJson.mjs',
    find: /if \(!Number\.isFinite\(parsed\) \|\| parsed <= 0\)\s*return null;/,
    test: 'packages/desktop/__tests__/unit/cache-integration-wiring.test.mjs',
    expect: '不得产生合法 orderKey',
    why: '临时主键绝不落盘的保护曾在测试里被副本替代，生产实现未被验证',
  },
  {
    name: 'botActivityStore: 删掉落盘 persist()',
    file: 'packages/desktop/dist/renderer/persistence/botActivityStore.mjs',
    find: /(\n\s*)persist\(\);/,
    test: 'packages/desktop/__tests__/unit/bot-activity-store.test.mjs',
    expect: '必须落盘',
    why: '历史缺陷是只改内存不落盘，刷新后 Bot 卡片回退到普通会话池时间戳',
  },
  {
    name: 'sessionDrafts: 删掉 set 后的落盘',
    file: 'packages/desktop/dist/renderer/persistence/sessionDrafts.mjs',
    find: /drafts\.set\(sessionId, text\);\s*\n\s*persist\(\);/,
    test: 'packages/desktop/__tests__/unit/session-drafts.test.mjs',
    expect: '必须同时改内存与存储',
    why: '原实现要求调用方手动落盘，漏调就丢草稿且无任何报错',
  },
  {
    name: 'inputCompletion: 把 `resolved !== null` 改成 `resolved.length > 0`',
    file: 'packages/desktop/dist/renderer/completion/inputCompletion.mjs',
    // 必须保持语法有效：直接抹掉会变成语法错误，那样"变红"不证明测试有效
    find: /resolved !== null\b/,
    replace: 'resolved.length > 0',
    test: 'packages/desktop/__tests__/unit/completion-domain.test.mjs',
    expect: '网关确认无结果时必须如实呈现空',
    why: '「全部被隐藏」曾被误判为「请求失败」，回退快照后隐藏静默失效',
  },
];

function runTest(relTest) {
  const env = { ...process.env, FORCE_COLOR: '0' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', relTest], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 180000, env,
  });
  return { status: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

function main() {
  const filter = process.argv[2];
  const list = filter ? MUTATIONS.filter((m) => m.name.includes(filter)) : MUTATIONS;

  console.log(`${C.cyan}${C.bold}假测试证伪器${C.reset}`);
  console.log(`${C.dim}  判据：删掉生产代码后，测试必须变红，且失败原因必须对得上${C.reset}\n`);

  let failed = 0;
  for (const m of list) {
    const abs = path.join(REPO_ROOT, m.file);
    if (!fs.existsSync(abs)) {
      console.log(`${C.yellow}!${C.reset} ${m.name}`);
      console.log(`  ${C.dim}跳过：产物不存在（先跑 npm run build）: ${m.file}${C.reset}`);
      continue;
    }

    const orig = fs.readFileSync(abs, 'utf8');
    /**
     * 两种变异方式：
     *   - 给了 `replace` 就做语义等价的替换（保持语法有效）
     *   - 否则把命中片段抹成空白，再补一个块注释占位（同样是语法无效的常见来源，
     *     因此一定要配合 `expect` 断言失败原因，不能只看 exit code）
     */
    const mutated = m.replace !== undefined
      ? orig.replace(m.find, m.replace)
      : orig.replace(m.find, (match) => `${match.replace(/\S/g, ' ')}/* mutated */`);
    if (mutated === orig) {
      failed += 1;
      console.log(`${C.red}✘${C.reset} ${m.name}`);
      console.log(`  ${C.red}锚点未匹配：产物形态已变化，需更新变异规则${C.reset}`);
      continue;
    }

    let res;
    try {
      fs.writeFileSync(abs, mutated, 'utf8');
      res = runTest(m.test);
    } finally {
      fs.writeFileSync(abs, orig, 'utf8');
      // 还原必须自证：长度一致才算真的还原
      const restored = fs.readFileSync(abs, 'utf8');
      if (restored.length !== orig.length) {
        console.error(`${C.red}严重：${m.file} 还原失败，请手动检查${C.reset}`);
        process.exitCode = 1;
        return;
      }
    }

    const killed = res.status !== 0;
    const reasonMatched = res.out.includes(m.expect);
    if (killed && reasonMatched) {
      console.log(`${C.green}✔${C.reset} ${m.name}`);
      console.log(`  ${C.dim}失败原因命中「${m.expect}」${C.reset}`);
    } else if (killed && !reasonMatched) {
      failed += 1;
      console.log(`${C.red}✘${C.reset} ${m.name}`);
      console.log(`  ${C.red}测试变红了，但原因不是预期的断言——可能是导入错误或语法错误${C.reset}`);
      console.log(`  ${C.dim}期望片段: ${m.expect}${C.reset}`);
    } else {
      failed += 1;
      console.log(`${C.red}✘${C.reset} ${m.name}`);
      console.log(`  ${C.red}删掉生产代码后测试仍全绿：这是假测试${C.reset}`);
      console.log(`  ${C.dim}历史缺陷: ${m.why}${C.reset}`);
    }
  }

  console.log('');
  if (failed === 0) {
    console.log(`${C.green}${C.bold}✔ ${list.length} 条变异全部被正确杀死：对应测试具备真实证伪性${C.reset}`);
    process.exitCode = 0;
    return;
  }
  console.log(`${C.red}${C.bold}✘ ${failed} / ${list.length} 条变异判定失败${C.reset}`);
  process.exitCode = 1;
}

main();
