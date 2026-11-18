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

/**
 * 校验 workspace 包的 dist 不比源码陈旧。
 *
 * 【设计意图 (Why)】入口 bundle 现在从 `@hermes-flux/core` / `@hermes-flux/ui` 的 dist
 *   解析依赖（构建脚本第 3 步会注明原因）。而 `desktop run start` 与打包脚本只跑本文件、
 *   不会重建 core/ui：改了 core 源码却直接打包，会把过期实现静默打进产物，
 *   现象是"改了代码但运行时没变"。这里把它变成一次明确失败。
 *
 * 【约束与规则 (Rules)】只比 mtime，不做内容哈希；分不出差异时宁可放行也不误报。
 */
function assertWorkspaceDistFresh(pkgName) {
  const pkgRoot = path.join(rootDir, '..', pkgName);
  const distEntry = path.join(pkgRoot, 'dist/index.js');
  if (!fs.existsSync(distEntry)) {
    throw new Error(`[Hermes Flux Build] 缺少 ${pkgName}/dist/index.js：请先执行 npm run build:core && npm run build:ui`);
  }
  const distMtime = fs.statSync(distEntry).mtimeMs;
  let newest = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const mtime = fs.statSync(abs).mtimeMs;
      if (mtime > newest) newest = mtime;
    }
  };
  const srcDir = path.join(pkgRoot, 'src');
  if (fs.existsSync(srcDir)) walk(srcDir);
  if (newest > distMtime) {
    throw new Error(
      `[Hermes Flux Build] ${pkgName} 的 dist 落后于源码：请先执行 npm run build:core && npm run build:ui`,
    );
  }
}

async function buildAll() {
  console.log('[Hermes Flux Build] Starting esbuild compilation...');
  const startTime = Date.now();

  assertWorkspaceDistFresh('core');
  assertWorkspaceDistFresh('ui');

  // Ensure dist directories
  fs.mkdirSync(path.join(rootDir, 'dist/main'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dist/preload'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dist/renderer'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dist/renderer/services'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dist/renderer/gateway'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dist/renderer/bootstrap'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dist/renderer/events'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'dist/renderer/stream'), { recursive: true });

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
    /**
     * 【跨包依赖走编译产物 (Why)】core / ui 直接以源码内联时，入口 bundle 的 sourcemap
     *   会把整棵 core/ui 源树再映射一次；增量覆盖率按「源文件 + 行」累加分支，
     *   入口里未执行的函数会给已测分支贡献一条 taken=0，门禁因此对同一行反复报红
     *   （实测 renderer/index.js 让 slidingWatchdog 的一条已覆盖分支长期判红）。
     *   这里改用一份不带 `paths` 的运行时 tsconfig：`@hermes-flux/*` 按包入口解析到
     *   各自 dist，映射落点不再指向 src；运行时语义不变。
     * 【约束与规则 (Rules)】该 tsconfig 只服务入口 bundle，
     *   类型检查仍以 tsconfig.json 的唯一真值为准，禁止在运行时配置里加 paths。
     */
    tsconfig: path.join(rootDir, 'tsconfig.runtime.json'),
    /**
     * 【切断对上游 sourcemap 的追溯 (Why)】esbuild 会读取输入文件末尾的
     *   `//# sourceMappingURL=`，并把映射一路追回 core/ui 的 src。
     *   入口 bundle 因此再次映射整棵跨包源树，未执行函数的分支会给已测分支贡献 taken=0。
     *   剥掉这一行注释后，映射落点停在 dist 文件本身，门禁不再按 src 重复计数。
     */
    plugins: [
      {
        name: 'strip-upstream-sourcemap-comment',
        setup(build) {
          build.onLoad({ filter: /packages[\\/](core|ui)[\\/]dist[\\/].*\.js$/ }, (args) => ({
            contents: fs.readFileSync(args.path, 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, ''),
            loader: 'js',
          }));
        },
      },
    ],
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

  /**
   * 独立产物共享的运行时外部依赖。
   *
   * 【设计意图 (Why)】两个理由必须同时成立：
   *   1. 打进产物会把 React 的 CJS 依赖塞进 ESM，Node 直接 import 就炸 "Dynamic require of util"；
   *   2. 内联后同一份 core 源码会出现在多个产物的 sourcemap 里，增量覆盖率按「源文件 + 行」
   *      累加分支，某个 bundle 未执行的分支会把已测分支压成未覆盖（实测：botManagementController
   *      内联副本曾让 slidingWatchdog 的一条已测分支长期报红）。
   */
  const SHARED_RUNTIME_EXTERNALS = ['@hermes-flux/core', '@hermes-flux/ui'];

  // 3b. 交互区纯逻辑模块（回滚事务 + 工具补丁队列）独立产物，供真实单测导入
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/rollbackTransaction.ts')],
    outfile: path.join(rootDir, 'dist/renderer/rollbackTransaction.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: SHARED_RUNTIME_EXTERNALS,
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/toolPatchQueue.ts')],
    outfile: path.join(rootDir, 'dist/renderer/toolPatchQueue.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: SHARED_RUNTIME_EXTERNALS,
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/conversationPush.ts')],
    outfile: path.join(rootDir, 'dist/renderer/conversationPush.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: SHARED_RUNTIME_EXTERNALS,
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/settingsController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/settingsController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: SHARED_RUNTIME_EXTERNALS,
    sourcemap: true,
  });
  // 消息窗口与 Profile 刷新是热路径纯逻辑，独立产物供行为级单测直接导入（不依赖 DOM）。
  // 提示词导航轨的滚动换算与缓存判定同为纯逻辑，一并独立产物，供 host 侧单测覆盖。
  // transcriptRows 是网关行 → 视图模型的唯一翻译点，同理由行为测试直接导入。
  // 【规则】一律带 SHARED_RUNTIME_EXTERNALS，理由见该常量上方的两段说明。
  for (const moduleName of ['messageWindow', 'profileRefresh', 'promptNavigator', 'coldStartFocus', 'providerAdminController', 'providerAdminRest', 'providerCatalog', 'gatewayConnection', 'queueControl', 'slashVisibility', 'botManagementController']) {
    await esbuild.build({
      entryPoints: [path.join(rootDir, `src/renderer/${moduleName}.ts`)],
      outfile: path.join(rootDir, `dist/renderer/${moduleName}.mjs`),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      external: SHARED_RUNTIME_EXTERNALS,
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

  // transcriptRows 单独编译：它以 external 保留 @hermes-flux/ui 与 core 的裸说明符，
  // 否则 React 的 CJS 依赖会被塞进 ESM 产物，Node 直接 import 时炸 "Dynamic require of util"。
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/persistence/persistedJson.ts')],
    outfile: path.join(rootDir, 'dist/renderer/persistence/persistedJson.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
  });

  // Bot 主工位活动持久化同样从 index.ts 整簇抽出；它依赖 core 的纯函数，
  // 必须声明 external，否则会把 core 的实现打进产物导致两份状态。
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/persistence/botActivityStore.ts')],
    outfile: path.join(rootDir, 'dist/renderer/persistence/botActivityStore.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 会话草稿持久化：纯本地逻辑，无外部依赖，直接编译。
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/persistence/sessionDrafts.ts')],
    outfile: path.join(rootDir, 'dist/renderer/persistence/sessionDrafts.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
  });

  // 输入补全领域从 index.ts 整簇抽出后，同样需要独立产物供行为测试直接导入。
  // 【约束与规则 (Rules)】它依赖 @hermes-flux/ui 与 core，必须单独 build 并声明 external，
  //   塞进上面那组会把 React 的 CJS 依赖打进 ESM，Node 直接 import 会炸。
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/completion/inputCompletion.ts')],
    outfile: path.join(rootDir, 'dist/renderer/completion/inputCompletion.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/ui', '@hermes-flux/core'],
    sourcemap: true,
  });

  // 客户端缓存桥接领域：从 index.ts 整簇抽出，依赖 @hermes-flux/ui 与 core
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/cache/desktopCacheBridge.ts')],
    outfile: path.join(rootDir, 'dist/renderer/cache/desktopCacheBridge.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // Agent 在场与语气状态机领域：从 index.ts 整簇抽出，依赖 @hermes-flux/ui 与 core
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/presence/agentPresenceManager.ts')],
    outfile: path.join(rootDir, 'dist/renderer/presence/agentPresenceManager.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 提示词导航状态机领域：从 index.ts 整簇抽出，依赖 @hermes-flux/ui 与 core
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/navigation/promptNavigatorManager.ts')],
    outfile: path.join(rootDir, 'dist/renderer/navigation/promptNavigatorManager.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 思考等级级联定位领域：从 index.ts 抽出，纯几何与抑制状态机
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/cascade/modelCascadeManager.ts')],
    outfile: path.join(rootDir, 'dist/renderer/cascade/modelCascadeManager.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 会话流视口滚动与锚定领域：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/viewport/streamViewportManager.ts')],
    outfile: path.join(rootDir, 'dist/renderer/viewport/streamViewportManager.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 提交后驱动观察器：从 renderCoordinator.ts 抽出，使挂载/重建/合并/释放契约可脱宿主单测
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/viewport/postCommitPinObservers.ts')],
    outfile: path.join(rootDir, 'dist/renderer/viewport/postCommitPinObservers.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 桌面壳视口装配：把 StreamViewportHost 的真实依赖收敛为可单测入口
  //
  // 【设计意图 (Why)】StreamViewportManager 自身已有独立产物；这里若再内联一份，
  //   同一份源码会以两个产物同时进入覆盖率统计，分支覆盖被重复累加（实测：bundle 侧
  //   未执行的分支会把已测分支压成"未全覆盖"，门禁对同一行反复报红）。
  // 【约束与规则 (Rules)】只外部化管理器本体到 ./streamViewportManager.mjs；
  //   其余依赖都是 type-only，不产生运行时 import，禁止顺手外部化运行时代码。
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/viewport/desktopStreamViewport.ts')],
    outfile: path.join(rootDir, 'dist/renderer/viewport/desktopStreamViewport.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
    plugins: [{
      name: 'external-stream-viewport-manager',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^\.\/streamViewportManager\.js$/ }, () => ({
          path: './streamViewportManager.mjs',
          external: true,
        }));
      },
    }],
  });

  // 左轨实体装饰与快照管理领域：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/leftrail/leftRailSnapshotManager.ts')],
    outfile: path.join(rootDir, 'dist/renderer/leftrail/leftRailSnapshotManager.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 全局应用状态模型领域：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/state/appState.ts')],
    outfile: path.join(rootDir, 'dist/renderer/state/appState.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 检查舱动效与下载控制器：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/inspector/inspectorController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/inspector/inspectorController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 左轨交互控制器：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/events/leftRailController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/events/leftRailController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 在场控制器：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/events/presenceController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/events/presenceController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 模态弹窗与右键菜单控制器：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/events/modalInteractionController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/events/modalInteractionController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 输入舱交互控制器：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/events/inputDockController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/events/inputDockController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 会话生命周期与设置切换服务：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/services/sessionOperationService.ts')],
    outfile: path.join(rootDir, 'dist/renderer/services/sessionOperationService.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 消息加载、历史分页漫游与副标题同步服务：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/services/messageLoadingService.ts')],
    outfile: path.join(rootDir, 'dist/renderer/services/messageLoadingService.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 回合执行与队列控制服务：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/services/turnExecutionService.ts')],
    outfile: path.join(rootDir, 'dist/renderer/services/turnExecutionService.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 网关连接生命周期与 WebSocket 下行事件分发服务：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/gateway/gatewayEventDispatcher.ts')],
    outfile: path.join(rootDir, 'dist/renderer/gateway/gatewayEventDispatcher.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 对话流虚拟窗口管理服务：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/messageWindowManager.ts')],
    outfile: path.join(rootDir, 'dist/renderer/messageWindowManager.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 渲染装配与协调管线服务：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/renderCoordinator.ts')],
    outfile: path.join(rootDir, 'dist/renderer/renderCoordinator.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // 模型下拉与全局热键控制器：从 index.ts 抽出
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/dropdownKeybindController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/dropdownKeybindController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });

  // Batch 6 终极收官服务：项目树、群聊研讨室、Profile 管理与设置中心数据服务
  for (const serviceName of ['projectOperationService', 'groupOperationService', 'profileManagementService', 'settingsDataService']) {
    await esbuild.build({
      entryPoints: [path.join(rootDir, `src/renderer/services/${serviceName}.ts`)],
      outfile: path.join(rootDir, `dist/renderer/services/${serviceName}.mjs`),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      external: ['@hermes-flux/core', '@hermes-flux/ui'],
      sourcemap: true,
    });
  }
  // Batch 7 终极决战服务与控制器：文件查看器、顶栏状态机与启动自举
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/services/fileViewerService.ts')],
    outfile: path.join(rootDir, 'dist/renderer/services/fileViewerService.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/titlebarController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/titlebarController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/bootstrap/appBootstrap.ts')],
    outfile: path.join(rootDir, 'dist/renderer/bootstrap/appBootstrap.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/events/conversationStreamController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/events/conversationStreamController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/events/onboardingController.ts')],
    outfile: path.join(rootDir, 'dist/renderer/events/onboardingController.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/stream/tokenStreamWriter.ts')],
    outfile: path.join(rootDir, 'dist/renderer/stream/tokenStreamWriter.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/renderer/stream/streamDomOwnership.ts')],
    outfile: path.join(rootDir, 'dist/renderer/stream/streamDomOwnership.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    external: ['@hermes-flux/core', '@hermes-flux/ui'],
    sourcemap: true,
  });
  console.log('  ✔ Batch 7 modules compiled (fileViewerService, titlebarController, appBootstrap, conversationStreamController, onboardingController, tokenStreamWriter, streamDomOwnership)');
  console.log('  ✔ Batch 6 services compiled (projectOperationService, groupOperationService, profileManagementService, settingsDataService)');
  console.log('  ✔ Batch 5 modules compiled (messageWindowManager, renderCoordinator, dropdownKeybindController)');
  console.log('  ✔ Transcript rows + slash catalog + desktop cache bridge + agent presence + prompt nav + cascade + viewport + leftrail + state + inspector + modal + inputDock + sessionOperation + messageLoading + turnExecution + gatewayEventDispatcher modules compiled');

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
  const workspaceRoot = path.resolve(rootDir, '..', '..');
  for (const { packageName, filePrefix, weights } of fontManifest.sources) {
    const localFilesDir = path.join(rootDir, 'node_modules', packageName, 'files');
    const hoistedFilesDir = path.join(workspaceRoot, 'node_modules', packageName, 'files');
    const filesDir = fs.existsSync(localFilesDir) ? localFilesDir : hoistedFilesDir;
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
