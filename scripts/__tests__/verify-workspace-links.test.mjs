import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  WORKSPACE_PACKAGES,
  checkLink,
  verifyWorkspaceLinks,
} from '../gates/verify-workspace-links.mjs';

/**
 * workspace 链接校验探针的单元测试
 *
 * 【设计意图 (Why)】
 *   本脚本的存在理由就是「门禁自己造过一处假红」：旧实现用 require.resolve
 *   校验链接，而 core 的 main 指向被 .gitignore 忽略的 dist/index.js，
 *   CI 又在 build 之前执行该步骤，于是两个平台稳定 MODULE_NOT_FOUND。
 *   测试必须在真实文件系统上重放「链接正确 / 链接缺失 / 链接指向别处 / 包名不符」
 *   四种物理情形，证明它既能放行正确状态，也能拦住每一种错误状态。
 *
 * 【防范的历史坑 (Pitfall)】
 *   只断言「函数返回 false」是不够的——一个永远返回 false 的实现也能通过。
 *   因此每种错误情形都必须同时断言 ok 为 false 且 detail 命中对应原因，
 *   正确情形必须断言 ok 为 true，形成双向证伪。
 *
 * 【约束与规则 (Rules)】
 *   全部夹具建在 os.tmpdir() 下的独立目录，after 钩子必须清理；
 *   断言落在结论字段（ok / detail / failures）上，不断言日志文本。
 */

const created = [];

/** 建一个临时「仓库」，按 links 声明建立 node_modules/@hermes-flux/<name> */
function tempRepo({ packages = [], links = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-wslinks-'));
  created.push(root);

  for (const name of packages) {
    const pkgDir = path.join(root, 'packages', name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: `@hermes-flux/${name}`, main: 'dist/index.js' }),
    );
  }

  const scopeDir = path.join(root, 'node_modules', '@hermes-flux');
  fs.mkdirSync(scopeDir, { recursive: true });

  for (const [name, spec] of Object.entries(links)) {
    const linkPath = path.join(scopeDir, name);
    if (spec.kind === 'symlink') {
      fs.symlinkSync(path.join(root, 'packages', spec.target), linkPath, 'junction');
      continue;
    }
    // 实体目录（模拟 registry 下载的同名包，而不是指向本仓的 file link）
    fs.mkdirSync(linkPath, { recursive: true });
    fs.writeFileSync(
      path.join(linkPath, 'package.json'),
      JSON.stringify({ name: spec.name ?? `@hermes-flux/${name}` }),
    );
  }

  return root;
}

test.after(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('链接正确指向本仓时判定通过', () => {
  const root = tempRepo({
    packages: WORKSPACE_PACKAGES,
    links: Object.fromEntries(
      WORKSPACE_PACKAGES.map((name) => [name, { kind: 'symlink', target: name }]),
    ),
  });

  const { failures, results } = verifyWorkspaceLinks(root);
  assert.equal(failures.length, 0, `不得有失败项，实际：${JSON.stringify(results)}`);
  assert.ok(results.every((r) => r.ok), '每个包都必须判定为 ok');
});

test('链接缺失时必须失败，且原因指向未建立链接', () => {
  const root = tempRepo({
    packages: WORKSPACE_PACKAGES,
    links: { core: { kind: 'symlink', target: 'core' } },
  });

  const { failures } = verifyWorkspaceLinks(root);
  assert.deepEqual(failures.sort(), ['desktop', 'mobile', 'ui'], '缺失的包必须逐个报出，不能只报第一个');

  const detail = checkLink('ui', root);
  assert.equal(detail.ok, false);
  assert.match(detail.detail, /链接不存在/, '原因必须指向「链接不存在」而不是泛化失败');
});

test('链接指向别处（同名实体目录）时必须失败', () => {
  const root = tempRepo({
    packages: WORKSPACE_PACKAGES,
    links: Object.fromEntries(
      WORKSPACE_PACKAGES.map((name) => [name, { kind: 'dir' }]),
    ),
  });

  const result = checkLink('core', root);
  assert.equal(result.ok, false, '实体目录不是 file link，必须判定失败');
  assert.match(result.detail, /链接指向别处/, '原因必须指出 realpath 未落在本仓 packages/');
});

test('包名不符时必须失败', () => {
  const root = tempRepo({
    packages: WORKSPACE_PACKAGES,
    links: Object.fromEntries(
      WORKSPACE_PACKAGES.map((name) => [
        name,
        name === 'ui' ? { kind: 'dir', name: '@hermes-flux/not-ui' } : { kind: 'symlink', target: name },
      ]),
    ),
  });

  const result = checkLink('ui', root);
  assert.equal(result.ok, false, '包名不符必须判定失败');
  assert.match(result.detail, /包名不符/);
});

test('packages/<name> 目录缺失时必须失败而不是抛异常', () => {
  const root = tempRepo({
    packages: ['core'],
    links: { core: { kind: 'symlink', target: 'core' } },
  });

  // 建一个指向不存在目录的悬空链接，模拟目录被改名后的残留
  const scopeDir = path.join(root, 'node_modules', '@hermes-flux');
  fs.mkdirSync(scopeDir, { recursive: true });
  const dangling = path.join(scopeDir, 'ui');
  try {
    fs.symlinkSync(path.join(root, 'packages', 'ui-missing'), dangling, 'junction');
  } catch {
    // 平台不支持创建符号链接时跳过该断言，避免把环境限制伪装成逻辑失败
    return;
  }

  const result = checkLink('ui', root);
  assert.equal(result.ok, false, '悬空链接必须判定失败');
  assert.ok(result.detail.length > 0, '失败必须给出可读原因');
});
