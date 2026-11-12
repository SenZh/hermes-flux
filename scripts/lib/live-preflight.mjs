/**
 * 浏览器直跑服务启动自检（Live Preflight）
 *
 * 【设计意图 (Why)】
 *   本仓以多 worktree 并行开发，每个 worktree 各自跑过 npm run build，
 *   因此 packages/desktop/dist/renderer/ 在每个 worktree 下都存在一份独立产物。
 *   start-browser-live.mjs 只做静态文件伺服、不校验被服务字节的归属，端口又是先到先得，
 *   于是任何一次残留进程都会让开发者看到【另一个分支的界面】，且该界面完全正常
 *   （HTTP 200、控制台无报错），极易被误判成「功能没合并 / 改了没生效」。
 *
 * 【防范的历史坑 (Pitfall)】
 *   实测事故：9120 被 D:\ws\hermes-aura-input-model-redesign 的残留进程占住，
 *   它服务的 conversation.css 为 87909B（不含提示词导航器加载动画），
 *   而本仓 dev/v0.1 的产物为 74203B（含该动画）。据此误判「提示词导航器优化没生效」。
 *
 * 【约束与规则 (Rules)】
 *   1. 归属判定依据只能是【被服务的字节指纹】，不能是进程名、端口监听状态或 HTTP 200；
 *   2. 端口被占用时必须显式失败并打印占用者 PID / 仓库 / 产物指纹，禁止静默沿用；
 *   3. 占用者产物与本仓一致时同样不重复启动（避免双实例抢端口），但给出可复用的明确结论；
 *   4. 失败退出码区分：1=占用者产物不同，2=占用者产物相同，3=本仓 dist 缺失；
 *   5. 全部探测仅走回环地址，不引入任何第三方依赖。
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/**
 * 指纹取样文件。
 * 【约束与规则 (Rules)】必须覆盖「渲染逻辑」与「对话视觉」两类产物：
 *   只看 index.js 会漏掉纯样式类改动，只看 css 会漏掉纯逻辑类改动。
 */
export const FINGERPRINT_FILES = [
  'packages/desktop/dist/renderer/conversation.css',
  'packages/desktop/dist/renderer/index.js',
];

/** 计算单个文件的 sha256。 */
export function hashFileSync(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 把若干「相对路径:哈希」按路径排序后合成一个总指纹，保证两侧计算口径完全一致。 */
function combineFingerprint(entries) {
  const parts = Object.keys(entries)
    .filter((rel) => entries[rel] && typeof entries[rel].hash === 'string')
    .sort()
    .map((rel) => `${rel}:${entries[rel].hash}`);
  if (parts.length === 0) return '';
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * 采集某个仓库根目录下的产物指纹。
 * 【约束与规则 (Rules)】缺失文件必须显式进 missing 列表，禁止用空哈希冒充「一致」。
 */
export function collectArtifactFingerprint(rootDir, files = FINGERPRINT_FILES) {
  const entries = {};
  const missing = [];
  for (const rel of files) {
    const abs = path.join(rootDir, rel);
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) {
        missing.push(rel);
        continue;
      }
      entries[rel] = { size: st.size, hash: hashFileSync(abs) };
    } catch {
      missing.push(rel);
    }
  }
  return { root: rootDir, files: entries, missing, combined: combineFingerprint(entries) };
}

/** 回环端口是否已被监听。用于区分「端口空闲」与「端口被占用」。 */
export function probePortOpen(port, host = '127.0.0.1', timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * 反查监听某端口的进程 PID。
 * 【约束与规则 (Rules)】仅用于给人类看的诊断信息；拿不到就返回 null，绝不因此改变启动结论。
 */
export function findListeningPid(port, platform = process.platform) {
  try {
    if (platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
      const match = out.match(new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'm'));
      return match ? Number(match[1]) : null;
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out.trim().split(/\s+/)[0];
    return first ? Number(first) : null;
  } catch {
    return null;
  }
}

/**
 * 读取占用者的自我声明（新版脚本会暴露 /__live/identity）。
 * 【约束与规则 (Rules)】旧版占用者没有该端点，必须静默降级到字节指纹比对，不得报错中断。
 */
async function readOccupantIdentity(baseUrl, fetchImpl) {
  try {
    const res = await fetchImpl(`${baseUrl}/__live/identity`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/**
 * 拉取占用者实际吐出的产物字节并算指纹。
 * 【设计意图 (Why)】这是唯一能穿透「进程名骗人」的证据：直接问对方要字节。
 */
async function readServedFingerprint(baseUrl, relFiles, fetchImpl) {
  const entries = {};
  for (const rel of relFiles) {
    try {
      const res = await fetchImpl(`${baseUrl}/${rel}`);
      if (!res.ok) {
        entries[rel] = { status: res.status };
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      entries[rel] = {
        size: buf.length,
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
      };
    } catch (err) {
      entries[rel] = { error: String(err) };
    }
  }
  return { files: entries, combined: combineFingerprint(entries) };
}

/**
 * 诊断端口占用者：它是不是本仓、产物是否与本仓一致。
 *
 * 【约束与规则 (Rules)】sameBytes 必须逐个文件全部命中才算 true；
 *   任一侧缺文件或状态非 200 一律视为「不一致」，宁可误报也不给出错误的安心结论。
 */
export async function describePortOccupant({ port, local, fetchImpl = fetch } = {}) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const occupied = await probePortOpen(port);
  if (!occupied) {
    return { occupied: false, baseUrl, pid: null, identity: null, served: null, sameBytes: false };
  }

  const relFiles = Object.keys(local?.files ?? {}).length > 0
    ? Object.keys(local.files)
    : FINGERPRINT_FILES;

  const [identity, served] = await Promise.all([
    readOccupantIdentity(baseUrl, fetchImpl),
    readServedFingerprint(baseUrl, relFiles, fetchImpl),
  ]);

  const sameBytes = relFiles.length > 0 && relFiles.every((rel) => {
    const mine = local?.files?.[rel];
    const theirs = served.files?.[rel];
    return Boolean(mine && theirs && theirs.hash && mine.hash === theirs.hash);
  });

  return {
    occupied: true,
    baseUrl,
    pid: findListeningPid(port),
    identity,
    served,
    sameBytes,
  };
}

const SOURCE_EXT = new Set(['.ts', '.tsx', '.css']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'icons', '.git', 'build', '__tests__']);

function walkNewestMtime(dir, state, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkNewestMtime(abs, state, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const st = fs.statSync(abs);
      if (st.mtimeMs > state.mtimeMs) {
        state.mtimeMs = st.mtimeMs;
        state.file = abs;
      }
    } catch {
      /* 单个文件读取失败不影响整体判定 */
    }
  }
}

/**
 * 粗粒度检查产物是否落后于源码。
 * 【设计意图 (Why)】直接 node scripts/start-browser-live.mjs 会跳过 npm run build，
 *   此时服务的是上一次构建的旧字节，表现同样酷似「改了没生效」。
 * 【约束与规则 (Rules)】只做告警不做阻断：增量构建可能合法地保留部分旧产物时间戳。
 */
export function assessDistFreshness(rootDir, distFiles = FINGERPRINT_FILES) {
  const newest = { mtimeMs: 0, file: '' };
  for (const pkg of ['core', 'ui', 'desktop']) {
    walkNewestMtime(path.join(rootDir, 'packages', pkg, 'src'), newest);
  }

  let oldestDist = { mtimeMs: Number.POSITIVE_INFINITY, file: '' };
  for (const rel of distFiles) {
    try {
      const st = fs.statSync(path.join(rootDir, rel));
      if (st.mtimeMs < oldestDist.mtimeMs) oldestDist = { mtimeMs: st.mtimeMs, file: rel };
    } catch {
      /* 缺失由 collectArtifactFingerprint 负责报告 */
    }
  }

  if (newest.mtimeMs === 0 || !Number.isFinite(oldestDist.mtimeMs)) {
    return { stale: false, newest, oldestDist };
  }
  return { stale: newest.mtimeMs > oldestDist.mtimeMs, newest, oldestDist };
}

/** 读取当前分支名，仅用于横幅展示。 */
export function readGitBranch(rootDir) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function describeFiles(label, files) {
  const lines = [];
  for (const rel of Object.keys(files)) {
    const item = files[rel];
    const name = path.basename(rel);
    if (typeof item.size === 'number' && typeof item.hash === 'string') {
      lines.push(`    ${name.padEnd(20)} ${String(item.size).padStart(9)}B  ${item.hash.slice(0, 12)}…`);
    } else if (typeof item.status === 'number') {
      lines.push(`    ${name.padEnd(20)} HTTP ${item.status}（占用者未提供该文件）`);
    } else {
      lines.push(`    ${name.padEnd(20)} 读取失败：${item.error ?? '未知原因'}`);
    }
  }
  return lines.length > 0 ? lines : [`    （${label} 无可比对文件）`];
}

/**
 * 生成端口被占用时的人类可读报告。
 * 【约束与规则 (Rules)】必须同时给出「占用者是谁」「两边字节差在哪」「怎么处理」三件事。
 */
export function formatOccupiedReport({ port, local, occupant }) {
  const lines = [];
  lines.push('');
  lines.push(`✖ 端口 ${port} 已被占用，拒绝启动。`);
  lines.push('');
  lines.push(`  占用进程 PID : ${occupant.pid ?? '未知（netstat/lsof 未取到）'}`);
  if (occupant.identity?.root) {
    lines.push(`  占用者仓库    : ${occupant.identity.root}`);
  } else {
    lines.push('  占用者仓库    : 未知（该进程是旧版脚本，未暴露 /__live/identity）');
  }
  if (occupant.identity?.branch) {
    lines.push(`  占用者分支    : ${occupant.identity.branch}`);
  }
  lines.push(`  本仓仓库      : ${local.root}`);
  lines.push('');
  lines.push('  占用者实际服务的字节：');
  lines.push(...describeFiles('占用者', occupant.served?.files ?? {}));
  lines.push('  本仓 dist 的字节：');
  lines.push(...describeFiles('本仓', local.files));
  lines.push('');

  if (occupant.sameBytes) {
    lines.push('  结论：占用者产物与本仓【完全一致】，说明同一个仓库的实例已在运行。');
    lines.push('        直接使用该实例即可，无需重复启动（重复启动会争抢端口）。');
  } else {
    lines.push('  结论：占用者产物与本仓【不一致】——浏览器里看到的不是本仓代码。');
    lines.push('        这正是「改了没生效 / 功能没合并」的典型假象来源。');
  }
  lines.push('');
  lines.push('  处理方式：');
  if (occupant.pid) {
    lines.push(`    结束占用进程   ${process.platform === 'win32' ? `Stop-Process -Id ${occupant.pid} -Force` : `kill ${occupant.pid}`}`);
  } else {
    lines.push('    结束占用进程   先按端口反查 PID（Windows: netstat -ano | findstr :PORT）');
  }
  lines.push(`    或改用其它端口 PORT=${port + 1} node scripts/start-browser-live.mjs`);
  lines.push('');
  return lines.join('\n');
}

/** 生成产物落后于源码时的告警文案。 */
export function formatStaleReport(freshness) {
  const lines = [];
  lines.push('');
  lines.push('⚠ 产物可能落后于源码，浏览器里看到的未必是最新代码。');
  lines.push(`    最新源码：${freshness.newest.file}`);
  lines.push(`    最旧产物：${freshness.oldestDist.file}`);
  lines.push('    建议先执行：npm run build（或直接用 npm run start:browser）');
  lines.push('');
  return lines.join('\n');
}
