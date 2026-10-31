import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mobileRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(mobileRoot, '../..');

console.log('[Hermes Flux Mobile Android Builder]');

// 1. Sync web assets
console.log('  1. Preparing mobile web assets...');
execSync(`node "${path.join(mobileRoot, 'scripts/prepare-assets.mjs')}"`, { stdio: 'inherit' });

// 2. Sync Capacitor
console.log('  2. Syncing Capacitor assets & plugins to Android native project...');
const capExe = path.join(mobileRoot, 'node_modules/.bin/cap.exe');
const capCmd = path.join(mobileRoot, 'node_modules/.bin/cap.cmd');
const capBin = fs.existsSync(capExe) ? capExe : fs.existsSync(capCmd) ? capCmd : 'npx cap';
execSync(`"${capBin}" sync android`, { cwd: mobileRoot, stdio: 'inherit' });

// 3. Assemble Debug APK with Gradle
console.log('  3. Assembling Android APK with Gradle...');
const androidDir = path.join(mobileRoot, 'android');
const gradlewCmd = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';

const env = { ...process.env };
if (!env.ANDROID_HOME && process.env.LOCALAPPDATA) {
  env.ANDROID_HOME = path.join(process.env.LOCALAPPDATA, 'Android/Sdk');
}
if (!env.ANDROID_SDK_ROOT && env.ANDROID_HOME) {
  env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
}

execSync(`${gradlewCmd} assembleDebug`, { cwd: androidDir, stdio: 'inherit', env });

// 4. Copy artifact to packages/mobile/release
const generatedApk = path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
const releaseDir = path.join(mobileRoot, 'release');
const finalApk = path.join(releaseDir, 'Hermes-Flux-0.1.0-debug.apk');

fs.mkdirSync(releaseDir, { recursive: true });
fs.copyFileSync(generatedApk, finalApk);

const sizeMb = (fs.statSync(finalApk).size / 1024 / 1024).toFixed(2);
console.log(`\n======================================================`);
console.log(`✔ Hermes Flux Mobile Android APK build ready!`);
console.log(`  Artifact: ${finalApk} (${sizeMb} MB)`);
console.log(`======================================================\n`);
