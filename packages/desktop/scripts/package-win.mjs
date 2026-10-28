/**
 * Hermes Aura Desktop Windows Packaging Automation Script
 * Packages Windows portable .exe, green zip, or unpacked dir directly on Linux/Win/Mac.
 */

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Set mirrors for fast binary downloads
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';

const args = process.argv.slice(2);
const isDirOnly = args.includes('--dir');
const isNsis = args.includes('--nsis');

console.log('[Hermes Aura Windows Packager]');
console.log(`  Target Platform: Windows x64`);
console.log(`  Electron Mirror: ${process.env.ELECTRON_MIRROR}`);
console.log(`  Target Dir: ${rootDir}/release/win-unpacked`);

// 1. Run build first
const buildProcess = spawn('node', ['scripts/build.mjs'], {
  cwd: rootDir,
  stdio: 'inherit',
});

buildProcess.on('close', (code) => {
  if (code !== 0) {
    console.error(`Build failed with code ${code}`);
    process.exit(code);
  }

  console.log('[Hermes Aura Windows Packager] Invoking electron-builder for win-x64...');

  const builderArgs = ['electron-builder', '--win', '--x64'];
  if (isDirOnly || !isNsis) {
    builderArgs.push('--dir');
  }

  const builder = spawn('npx', builderArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });

  builder.on('close', (builderCode) => {
    if (builderCode !== 0) {
      console.error(`electron-builder exited with code ${builderCode}`);
      process.exit(builderCode);
    }

    // 2. Generate portable zip archive from win-unpacked if not dir-only
    if (!isDirOnly) {
      console.log('\n[Hermes Aura Windows Packager] Compressing win-unpacked into portable green package...');
      const unpackedDir = path.join(rootDir, 'release/win-unpacked');
      const zipOutput = path.join(rootDir, 'release/Hermes-Aura-0.1.0-win-x64-portable.zip');
      const zipScript = path.join(rootDir, 'scripts/make-zip.py');

      try {
        execSync(`python3 "${zipScript}" "${unpackedDir}" "${zipOutput}"`, { stdio: 'inherit' });
      } catch (err) {
        console.warn('Zip creation failed:', err);
      }
    }

    console.log('\n======================================================');
    console.log('✔ Hermes Aura Desktop Windows delivery build ready!');
    console.log('  1. Unpacked Binary: packages/desktop/release/win-unpacked/Hermes Aura.exe');
    console.log('  2. Portable Green Zip: packages/desktop/release/Hermes-Aura-0.1.0-win-x64-portable.zip');
    console.log('======================================================\n');
  });
});
