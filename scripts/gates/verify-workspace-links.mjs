#!/usr/bin/env node
/**
 * workspace 链接校验探针。
 *
 * 【设计意图 (Why)】
 *   依赖装不上时后续所有门禁都是空跑，而 `node --test` 命中 0 文件、`tsc` 无输入
 *   都仍可能退出 0。因此必须在执行任何门禁之前，显式证明 workspace 链接已建立，
 *   且指向本仓的 packages/<name> 而不是 registry 上的同名包。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 曾把校验写成 `require.resolve('@hermes-flux/core')`。core 的 `main` 指向
 *      `dist/index.js`，而 `dist/` 被 .gitignore 忽略、该步骤又在 `npm run build`
 *      之前执行，于是两个平台稳定 MODULE_NOT_FOUND——门禁自己造了一处假红。
 *      链接是否建立与产物是否存在是两件事，不能互相代替。
 *   2. 曾把校验内联在 workflow 的 `run: |` 里，并用了 bash 的
 *      `for p in ...; do ... done`。GitHub 的 windows runner 默认 shell 是 pwsh，
 *      同一段脚本直接 ParserError。跨平台逻辑必须落在 Node 脚本里，
 *      CI 只负责调用，不承载 shell 语义。
 *
 * 【约束与规则 (Rules)】
 *   1. 判定依据是「链接实体存在 + package.json 的 name 对得上 + realpath 指向本仓
 *      packages/<name>」三件同时成立，缺一即失败；
 *   2. 不 require、不读 dist，产物是否存在由后面的构建门禁负责；
 *   3. 不依赖任何 shell 特性，Windows / Linux / macOS 同一份实现；
 *   4. 失败必须非零退出并逐条打印缺失项，绝不静默降级（Failure Is Not Empty）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

/** 参与 workspace 的包名后缀。顺序仅影响输出，不影响判定。 */
export const WORKSPACE_PACKAGES = ['core', 'ui', 'desktop', 'mobile'];

/**
 * 校验单个 workspace 链接。
 *
 * @param {string} name 包名后缀，例如 `core` 对应 `@hermes-flux/core`
 * @param {string} [repoRoot] 仓库根目录，默认取本文件所在仓库
 * @returns {{ ok: boolean, detail: string }}
 */
export function checkLink(name, repoRoot = REPO_ROOT) {
  const linkPath = path.join(repoRoot, 'node_modules', '@hermes-flux', name);
  const expectedName = `@hermes-flux/${name}`;
  const expectedTarget = path.join(repoRoot, 'packages', name);

  if (!fs.existsSync(linkPath)) {
    return { ok: false, detail: '链接不存在（npm ci 未建立 workspace 链接）' };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(linkPath, 'package.json'), 'utf8'));
  } catch (err) {
    return { ok: false, detail: `package.json 不可读：${err.message}` };
  }

  if (manifest.name !== expectedName) {
    return { ok: false, detail: `包名不符：期望 ${expectedName}，实际 ${manifest.name}` };
  }

  // realpath 比对是这里唯一能区分「指向本仓的 file link」与「同名目录/下载包」的手段
  let actualTarget;
  try {
    actualTarget = fs.realpathSync(linkPath);
  } catch (err) {
    return { ok: false, detail: `realpath 解析失败：${err.message}` };
  }
  let expectedResolved;
  try {
    expectedResolved = fs.realpathSync(expectedTarget);
  } catch (err) {
    return { ok: false, detail: `packages/${name} 目录不存在：${err.message}` };
  }
  if (actualTarget !== expectedResolved) {
    return { ok: false, detail: `链接指向别处：${actualTarget}（期望 ${expectedResolved}）` };
  }

  return { ok: true, detail: 'ok' };
}

/**
 * 校验全部 workspace 链接。
 *
 * @param {string} [repoRoot]
 * @returns {{ failures: string[], results: Array<{ name: string, ok: boolean, detail: string }> }}
 */
export function verifyWorkspaceLinks(repoRoot = REPO_ROOT) {
  const results = WORKSPACE_PACKAGES.map((name) => ({ name, ...checkLink(name, repoRoot) }));
  return { failures: results.filter((r) => !r.ok).map((r) => r.name), results };
}

function main() {
  const { failures, results } = verifyWorkspaceLinks();
  for (const r of results) {
    console.log(r.ok ? `  ✓ @hermes-flux/${r.name}` : `  ✗ @hermes-flux/${r.name}：${r.detail}`);
  }

  if (failures.length > 0) {
    console.error(`\n✖ workspace 链接校验失败：${failures.length}/${WORKSPACE_PACKAGES.length} 个包未建立正确链接`);
    console.error('  排查：npm ci --ignore-scripts 是否成功；packages/*/package.json 的 name 是否与目录一致\n');
    process.exit(1);
  }

  console.log('\n✓ workspace 链接全部指向本仓 packages/<name>');
}

// 仅在作为入口执行时跑校验；被测试 import 时保持纯函数语义
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
