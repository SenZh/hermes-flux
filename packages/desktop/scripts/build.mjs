/**
 * Hermes Flux Desktop Fast esbuild Pipeline
 */

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function buildAll() {
  console.log('[Hermes Flux Build] Starting esbuild compilation...');
  const startTime = Date.now();

  // Ensure dist directories
  fs.mkdirSync(path.join(rootDir, 'dist/main'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dist/preload'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dist/renderer'), { recursive: true });

  // Tailwind v4 从 UI 组件源码扫描类名，并保留皮肤变量的运行时解析。
  // 设计意图(Why)：bun 把 workspace 依赖就近装在 packages/ui/node_modules，跨包管理器稳健的调用方式是直接 spawn CLI 的 JS 入口，不依赖 .bin shim 的平台后缀。
  // 防范的历史坑(Pitfall)：初版写死根 node_modules/.bin/tailwindcss.cmd，该路径在本仓库布局下根本不存在，build 必炸。
  const repoDir = path.resolve(rootDir, '..', '..');
  const tailwindCliCandidates = [
    path.join(repoDir, 'packages', 'ui', 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs'),
    path.join(repoDir, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs'),
  ];
  const tailwindCli = tailwindCliCandidates.find((p) => fs.existsSync(p));
  if (!tailwindCli) throw new Error('未找到 @tailwindcss/cli 入口，请先在仓库根执行 bun install');
  const tailwind = spawnSync(process.execPath, [
    tailwindCli,
    '-i', path.join(repoDir, 'packages/ui/src/tailwind-entry.css'),
    '-o', path.join(rootDir, 'dist/renderer/tailwind.css'),
    '--minify',
  ], { cwd: repoDir, encoding: 'utf8' });
  if (tailwind.status !== 0) throw new Error(tailwind.stderr || 'Tailwind CSS build failed');
  console.log('  ✔ Tailwind design tokens compiled');

  // 1. Build Main Process
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/main/index.ts')],
    outfile: path.join(rootDir, 'dist/main/index.js'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true,
  });
  console.log('  ✔ Main process compiled');

  // 2. Build Preload Script
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/preload/index.ts')],
    outfile: path.join(rootDir, 'dist/preload/index.js'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true,
  });
  console.log('  ✔ Preload script compiled');

  // 3. Build Renderer Script
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/index.ts')],
    outfile: path.join(rootDir, 'dist/renderer/index.js'),
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'esm',
    sourcemap: true,
  });
  console.log('  ✔ Renderer script compiled');

  // 3.1 Build Message Actions Module (for runtime & test execution)
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/messageActions.ts')],
    outfile: path.join(rootDir, 'dist/renderer/messageActions.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
  });
  console.log('  ✔ Message actions module compiled');

  // 3b. 交互区纯逻辑模块（回滚事务 + 工具补丁队列）独立产物，供真实单测导入
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/rollbackTransaction.ts')],
    outfile: path.join(rootDir, 'dist/renderer/rollbackTransaction.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/toolPatchQueue.ts')],
    outfile: path.join(rootDir, 'dist/renderer/toolPatchQueue.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/conversationPush.ts')],
    outfile: path.join(rootDir, 'dist/renderer/conversationPush.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
  });
  console.log('  ✔ Interactive-stage pure modules compiled (rollbackTransaction, toolPatchQueue, conversationPush)');

  // 4. Copy static assets
  fs.copyFileSync(
    path.join(rootDir, 'src/renderer/index.html'),
    path.join(rootDir, 'dist/renderer/index.html')
  );
  fs.copyFileSync(
    path.join(rootDir, 'src/renderer/styles.css'),
    path.join(rootDir, 'dist/renderer/styles.css')
  );

  // 对话区样式资产来自 UI 包，供 desktop 与后续 web/mobile 共用。
  fs.copyFileSync(
    path.join(repoDir, 'packages', 'ui', 'src', 'styles', 'conversation.css'),
    path.join(rootDir, 'dist/renderer', 'conversation.css')
  );

  // 字体清单由 scripts/font-manifest.json 提供（与 tokens/fonts.ts 的 source 字段一一对应）。
  // 只拷贝 latin 子集；中文继续走系统字体，避免引入 MB 级 CJK 字重。
  const fontTargetDir = path.join(rootDir, 'dist/renderer/fonts');
  fs.mkdirSync(fontTargetDir, { recursive: true });
  const fontManifest = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'scripts', 'font-manifest.json'), 'utf8')
  );
  let copiedFonts = 0;
  let missingFonts = 0;
  for (const { packageName, filePrefix, weights } of fontManifest.sources) {
    const filesDir = path.join(rootDir, 'node_modules', packageName, 'files');
    for (const weight of weights) {
      const name = `${filePrefix}-latin-${weight}-normal.woff2`;
      const source = path.join(filesDir, name);
      if (!fs.existsSync(source)) {
        missingFonts += 1;
        continue;
      }
      fs.copyFileSync(source, path.join(fontTargetDir, name));
      copiedFonts += 1;
    }
  }
  console.log(`  ✔ Web fonts copied (${copiedFonts} woff2, ${missingFonts} missing)`);

  // 5. Ship the brand icons next to the compiled main process
  const iconDir = path.join(rootDir, 'build');
  const iconTargets = ['icon.ico', 'icon.png'];
  const shippedIcons = iconTargets.filter((name) => fs.existsSync(path.join(iconDir, name)));
  if (shippedIcons.length > 0) {
    fs.mkdirSync(path.join(rootDir, 'dist/build'), { recursive: true });
    for (const name of shippedIcons) {
      fs.copyFileSync(path.join(iconDir, name), path.join(rootDir, 'dist/build', name));
    }
  }
  console.log(`  ✔ Static renderer assets copied (icons: ${shippedIcons.join(', ') || 'none'})`);

  const elapsed = Date.now() - startTime;
  console.log(`[Hermes Flux Build] Compilation complete in ${elapsed}ms`);
}

buildAll().catch((err) => {
  console.error('[Hermes Flux Build] Build failed:', err);
  process.exit(1);
});
