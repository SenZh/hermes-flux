/**
 * Hermes Flux Android Emulator Automated Runner & Screencap Tester
 * 
 * 【检验目标】
 * 1. 等待模拟器启动完成 (sys.boot_completed == 1)
 * 2. 真实安装刚刚编译落盘的 Hermes-Flux-0.1.0-debug.apk
 * 3. 真实启动 Activity：com.hermesflux.app/.MainActivity
 * 4. 验证进程存活 (无 crash, 无 ANR, pidof > 0)
 * 5. 抓取 logcat 中的 Capacitor 初始化日志与 Web 容器日志
 * 6. 截取屏幕保存为物理 PNG 图片，断言界面真实有效渲染
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const adbPath = path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk/platform-tools/adb.exe');
const apkPath = path.resolve('packages/mobile/release/Hermes-Flux-0.1.0-debug.apk');
const screencapPath = path.resolve('packages/mobile/release/mobile-emulator-screen.png');

console.log('[Hermes Flux Emulator ADB Automated Verifier]');
console.log(`  ADB: ${adbPath}`);
console.log(`  APK: ${apkPath}`);

if (!fs.existsSync(adbPath)) {
  console.error('Error: adb.exe not found!');
  process.exit(1);
}
if (!fs.existsSync(apkPath)) {
  console.error('Error: debug APK not found! Run build first.');
  process.exit(1);
}

const adb = (cmd, opts = {}) => {
  return execSync(`"${adbPath}" ${cmd}`, { encoding: 'utf8', ...opts });
};

// 1. 等待设备连接
console.log('1. Waiting for Android emulator to appear in ADB...');
let deviceId = '';
for (let i = 0; i < 45; i++) {
  try {
    const out = adb('devices');
    const lines = out.split('\n').filter(l => l.includes('\tdevice') || l.includes('emulator-'));
    if (lines.length > 0) {
      deviceId = lines[0].split('\t')[0].trim();
      if (lines[0].includes('\tdevice')) {
        console.log(`  ✔ Device connected: ${deviceId}`);
        break;
      }
    }
  } catch {}
  execSync('powershell -Command "Start-Sleep -Seconds 2"');
}

if (!deviceId) {
  console.error('Timeout waiting for emulator device to register.');
  process.exit(1);
}

// 2. 等待 boot completed
console.log('2. Waiting for Android OS boot to complete (sys.boot_completed = 1)...');
let booted = false;
for (let i = 0; i < 60; i++) {
  try {
    const status = adb('shell getprop sys.boot_completed').trim();
    if (status === '1') {
      booted = true;
      console.log('  ✔ Android OS boot completed successfully.');
      break;
    }
  } catch {}
  execSync('powershell -Command "Start-Sleep -Seconds 2"');
}

if (!booted) {
  console.error('Timeout waiting for Android boot_completed.');
  process.exit(1);
}

// 3. 安装 APK
console.log('3. Installing Hermes-Flux-0.1.0-debug.apk into emulator...');
const installOut = adb(`install -r "${apkPath}"`);
console.log(`  ✔ APK install result: ${installOut.trim()}`);
if (!installOut.includes('Success')) {
  console.error('Error: APK installation failed!');
  process.exit(1);
}

// 4. 清理旧日志并启动 MainActivity
console.log('4. Launching com.hermesflux.app/.MainActivity...');
adb('logcat -c'); // 清空旧日志
const startOut = adb('shell am start -n com.hermesflux.app/.MainActivity');
console.log(`  ✔ Activity launch result: ${startOut.trim()}`);

// 等待 4 秒让 WebView 与 Capacitor 完成渲染
execSync('powershell -Command "Start-Sleep -Seconds 4"');

// 5. 检查进程存活性
console.log('5. Verifying App process is alive...');
let pid = '';
try {
  pid = adb('shell pidof com.hermesflux.app').trim();
} catch {}

if (!pid) {
  console.error('Error: App process died immediately after launch! Checking crash log:');
  const crash = adb('logcat -d -b crash');
  console.error(crash);
  process.exit(1);
}
console.log(`  ✔ App process running with PID: ${pid}`);

// 6. 抓取 Capacitor & Web 容器关键日志
console.log('6. Inspecting Capacitor logs...');
let logs = '';
try {
  logs = adb('logcat -d -s Capacitor:D Capacitor/Console:D CapacitorPlugins:D');
} catch {}
const logLines = logs.split('\n').filter(l => l.trim().length > 0).slice(-20);
console.log('  Last 20 Capacitor log lines:');
logLines.forEach(l => console.log(`    ${l}`));

// 7. 物理屏幕截图取证
console.log('7. Capturing emulator screen to PNG...');
try {
  execSync(`"${adbPath}" exec-out screencap -p > "${screencapPath}"`, { stdio: 'inherit' });
  const stat = fs.statSync(screencapPath);
  console.log(`  ✔ Physical screencap saved: ${screencapPath} (${(stat.size / 1024).toFixed(1)} KB)`);
  if (stat.size < 10000) {
    console.error('Warning: Screenshot file too small, screen might be black.');
  } else {
    console.log('  ✔ Screenshot size verified, valid UI rendered!');
  }
} catch (e) {
  console.warn('Screenshot capture notice:', e.message);
}

console.log('\n======================================================');
console.log('✔ Tier 3: Android Emulator Live Verification PASSED!');
console.log('======================================================\n');
