import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mobileRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(mobileRoot, '../..');
const rendererDist = path.join(repoRoot, 'packages/desktop/dist/renderer');
const mobileDist = path.join(mobileRoot, 'dist');
const bridgeSrc = path.join(mobileRoot, 'src/capacitor-bridge.ts');

console.log('[Hermes Flux Mobile Assets Preparer]');
console.log(`  Source: ${rendererDist}`);
console.log(`  Target: ${mobileDist}`);

if (!fs.existsSync(rendererDist)) {
  console.error('Error: packages/desktop/dist/renderer does not exist! Run npm run build first.');
  process.exit(1);
}

// 1. Clean & recreate mobile dist
fs.rmSync(mobileDist, { recursive: true, force: true });
fs.mkdirSync(mobileDist, { recursive: true });

// 2. Copy desktop renderer bundle
fs.cpSync(rendererDist, mobileDist, { recursive: true });
console.log('  ✔ Desktop renderer assets mirrored.');

// 3. Compile capacitor-bridge.ts with esbuild (IIFE bundle, inline execution)
console.log('  Compiling mobile platform bridge...');
const bridgeOut = path.join(mobileDist, 'capacitor-bridge.js');

await build({
  entryPoints: [bridgeSrc],
  bundle: true,
  format: 'iife',
  outfile: bridgeOut,
  platform: 'browser',
  target: 'es2022',
  minify: false,
  sourcemap: true,
  // 外部依赖全部由 Capacitor 插件 node_modules 接入内联
  nodePaths: [path.join(mobileRoot, 'node_modules'), path.join(repoRoot, 'node_modules')],
});
console.log('  ✔ capacitor-bridge.js compiled successfully.');

// 4. Inject capacitor-bridge.js into index.html before existing index.js
const htmlPath = path.join(mobileDist, 'index.html');
if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('capacitor-bridge.js')) {
    html = html.replace(
      /<head>/i,
      `<head>\n    <!-- Mobile Platform Bridge Injected -->\n    <script src="capacitor-bridge.js"></script>`
    );
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('  ✔ capacitor-bridge.js injected into index.html.');
  }
}

// 5. Append mobile-specific responsive & touch styles into styles.css
const cssPath = path.join(mobileDist, 'styles.css');
if (fs.existsSync(cssPath)) {
  const mobileCss = `
/* ==========================================================================
   Hermes Flux Mobile Specific Geometry & Safe-Area Adjustments
   ========================================================================== */
:root {
  --keyboard-height: 0px;
}

@media (max-width: 768px) {
  /* 1. 彻底剥离桌面窗口控制按键 (Mac 红绿灯与 Windows 窗口控制) */
  .win-cap-btn,
  .mac-traffic-lights,
  .flux-titlebar-controls,
  .titlebar-controls,
  .window-controls,
  #btn-win-min,
  #btn-win-max,
  #btn-win-close {
    display: none !important;
  }

  /* 2. 沉浸式标题栏安全区避让 (灵动岛与刘海屏) */
  .flux-titlebar,
  header.titlebar,
  #flux-titlebar {
    padding-top: env(safe-area-inset-top, 0px) !important;
    height: calc(42px + env(safe-area-inset-top, 0px)) !important;
  }

  /* 3. 底部悬浮输入舱软键盘避让与底部指示条避让 */
  .input-dock-container,
  .composer-dock,
  #flux-input-dock {
    bottom: calc(var(--keyboard-height, 0px) + env(safe-area-inset-bottom, 8px) + 8px) !important;
    transition: bottom 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* 4. 触控热区保障 (所有图标与操作按钮不得小于 44px) */
  button,
  .btn,
  .clickable-icon {
    min-height: 44px;
    min-width: 44px;
  }

  /* 5. 对话流宽度防止挤压，全屏通栏 */
  #conversation-stream,
  .conversation-stream,
  .middle-pod {
    width: 100vw !important;
    max-width: 100vw !important;
    padding-bottom: calc(180px + var(--keyboard-height, 0px)) !important;
  }
}
`;
  fs.appendFileSync(cssPath, mobileCss, 'utf8');
  console.log('  ✔ Mobile responsive & safe-area styles appended.');
}

console.log('✔ Mobile assets prepared and reinforced successfully.');
