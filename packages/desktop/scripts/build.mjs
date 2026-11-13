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
    // 【设计意图 (Why)】React 的 development 构建会保留 DevTools 提示、双调用 render 与额外校验，
    // 实测会把一次会话切换的渲染成本放大近一倍。桌面产物默认走 production，
    // 需要调试 React 警告时用 NODE_ENV=development 重新构建即可。
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV === 'development' ? 'development' : 'production'),
    },
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
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/settingsController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/settingsController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
  });
  // 消息窗口与 Profile 刷新是热路径纯逻辑，独立产物供行为级单测直接导入（不依赖 DOM）。
  // 提示词导航轨的滚动换算与缓存判定同为纯逻辑，一并独立产物，供 host 侧单测覆盖。
  // transcriptRows 是网关行 → 视图模型的唯一翻译点，同理由行为测试直接导入。
  // 【规则】它依赖 @hermes-flux/ui 与 core，必须以 external 保留裸包说明符：
  //   打进产物会把 React 的 CJS 依赖塞进 ESM，Node 直接 import 就炸 "Dynamic require of util"。
  for (const moduleName of ['messageWindow', 'profileRefresh', 'promptNavigator', 'coldStartFocus', 'providerAdminController', 'providerAdminRest', 'providerCatalog', 'gatewayConnection', 'queueControl', 'slashVisibility', 'botManagementController']) {
    await esbuild.build({
      entryPoints: [path.join(rootDir, `src/renderer/${moduleName}.ts`)],
      outfile: path.join(rootDir, `dist/renderer/${moduleName}.mjs`),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      sourcemap: true,
    });
  }
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/main/cookieHeader.ts')],
    outfile: path.join(rootDir, 'dist/main/cookieHeader.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
  });
  console.log('  ✔ Interactive-stage pure modules compiled (rollbackTransaction, toolPatchQueue, conversationPush, settingsController, botManagementController, messageWindow, profileRefresh, promptNavigator, coldStartFocus, providerAdminController, providerAdminRest, providerCatalog, gatewayConnection, cookieHeader)');

  // transcriptRows 单独编译：它以 external 保留 @hermes-flux/ui 与 core 的裸说明符，
  // 否则 React 的 CJS 依赖会被塞进 ESM 产物，Node 直接 import 时炸 "Dynamic require of util"。
  await esbuild.build({
    entryPoints: [
      path.join(rootDir, 'src/renderer/transcriptRows.ts'),
      path.join(rootDir, 'src/renderer/slashCatalog.ts'),
      path.join(rootDir, 'src/renderer/mentionToken.ts'),
    ],
    outdir: path.join(rootDir, 'dist/renderer'),
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/ui', '@hermes-flux/core'],
    sourcemap: true,
  });
  console.log('  ✔ Transcript rows + slash catalog modules compiled');

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

  // 模型厂商图标资产同样来自 UI 包：组件以 `icons/lobe/<slug>.svg` 相对 index.html 引用，
  // 因此必须原样落在渲染产物根目录下，桌面（file://）与浏览器直跑（HTTP 静态服务）才都能解析。
  const vendorIconSourceDir = path.join(repoDir, 'packages', 'ui', 'src', 'icons', 'lobe');
  const vendorIconTargetDir = path.join(rootDir, 'dist', 'renderer', 'icons', 'lobe');
  fs.mkdirSync(vendorIconTargetDir, { recursive: true });
  let copiedVendorIcons = 0;
  for (const name of fs.readdirSync(vendorIconSourceDir)) {
    if (!name.endsWith('.svg')) continue;
    fs.copyFileSync(path.join(vendorIconSourceDir, name), path.join(vendorIconTargetDir, name));
    copiedVendorIcons += 1;
  }
  // 【规则】MIT 要求所有副本随附许可声明：图标资产进了分发产物，LICENSE 必须同行，
  // 否则安装包里只有一堆无出处的品牌矢量图。
  const vendorIconLicense = path.join(vendorIconSourceDir, 'LICENSE');
  if (!fs.existsSync(vendorIconLicense)) throw new Error('缺少 lobe 图标 LICENSE，禁止在无许可声明的情况下分发品牌资产');
  fs.copyFileSync(vendorIconLicense, path.join(vendorIconTargetDir, 'LICENSE'));
  console.log(`  ✔ Model vendor icons copied (${copiedVendorIcons} svg + LICENSE)`);

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
