#!/usr/bin/env node
/**
 * 桌面单测模块定向极速构建器（Desktop Unit-Module Builder for Stryker）
 *
 * 【设计意图 (Why)】
 *   Stryker 变异测试在隔离沙箱 `.stryker-tmp/sandbox-*` 中只链接仓库根 `node_modules`，
 *   不复制 `packages/ui/node_modules`（`@tailwindcss/cli` 所在目录），且 `dist/**` 被忽略。
 *   桌面单测只导入 esbuild 编译出的单个 `.mjs` 模块，无需重新编译 core/ui、Tailwind CSS
 *   与全量渲染 bundle。本脚本按传入的相对源码路径，仅构建目标 `.mjs`（~80ms），
 *   让桌面领域变异测试可在 Stryker 沙箱中稳定、快速运行。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 若直接以 `npm run build` 作为桌面领域 `buildCommand`，在 Stryker 沙箱中会因找不到
 *      `packages/ui/node_modules/@tailwindcss/cli` 而全军覆没；
 *   2. 必须与 `packages/desktop/scripts/build.mjs` 保持一致的 esbuild 参数
 *      （`platform: 'node'`, `target: 'node20'`, `format: 'esm'`,
 *      `external: ['@hermes-flux/core', '@hermes-flux/ui']`），严禁把 React CJS 依赖打入 ESM。
 *
 * 【约束与规则 (Rules)】
 *   仅接受 `packages/desktop/` 下的 `src/*.ts` 相对路径；产出路径将前缀 `src/` 替换为 `dist/`、
 *   后缀 `.ts` 替换为 `.mjs`，与正式构建产物路径严格一致。
 */

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(HERE, '../../packages/desktop');

async function main() {
  const targets = process.argv.slice(2).filter(Boolean);
  if (targets.length === 0) {
    console.error('[build-desktop-unit] 请提供至少一个相对 packages/desktop 的 src/*.ts 路径');
    process.exit(1);
  }

  for (const relSrc of targets) {
    const normalized = relSrc.replaceAll('\\', '/');
    if (!normalized.startsWith('src/') || !normalized.endsWith('.ts')) {
      throw new Error(`[build-desktop-unit] 非法路径 "${relSrc}"，必须形如 src/.../*.ts`);
    }
    const entryPoint = path.join(DESKTOP_ROOT, normalized);
    if (!fs.existsSync(entryPoint)) {
      throw new Error(`[build-desktop-unit] 源文件不存在: ${entryPoint}`);
    }
    const relOut = normalized.replace(/^src\//, 'dist/').replace(/\.ts$/, '.mjs');
    const outFile = path.join(DESKTOP_ROOT, relOut);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });

    await esbuild.build({
      entryPoints: [entryPoint],
      outfile: outFile,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      external: ['@hermes-flux/core', '@hermes-flux/ui'],
      sourcemap: true,
    });
  }
}

main().catch((err) => {
  console.error('[build-desktop-unit] Build failed:', err);
  process.exit(1);
});
