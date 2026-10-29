/**
 * Hermes Flux Desktop Fast esbuild Pipeline
 */

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
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

  // 4. Copy static assets
  fs.copyFileSync(
    path.join(rootDir, 'src/renderer/index.html'),
    path.join(rootDir, 'dist/renderer/index.html')
  );
  fs.copyFileSync(
    path.join(rootDir, 'src/renderer/styles.css'),
    path.join(rootDir, 'dist/renderer/styles.css')
  );

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
