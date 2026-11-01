#!/usr/bin/env node
/**
 * 网关契约校验器（Gateway Contract Verify）
 *
 * 设计意图 (Why):
 *   把"我们以为网关长什么样"与"网关实际长什么样"的差异，提前到编译/提交阶段暴露。
 *   校验三件事：
 *     1. 生成物指纹未被手改（防止有人绕过 sync 直接改校验表）；
 *     2. 源码里出现的每个 RPC 方法名都在网关契约注册表中；
 *     3. 源码中带字面量参数的调用，其字段全部落在契约允许的 params 白名单内。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 方法名拼错（如 session.list_all）在运行时才变成 -32601，且被 catch 吞掉。
 *   2. 参数多写一个字段（如 profiles.get_asset 的 key）被 4000 拒绝，
 *      而错误被降级成空数据，界面只表现为"没数据"。
 *   3. 只校验方法名不校验字段 -> 本次四个坑里有三个仍会漏网。
 *
 * 约束与规则 (Rules):
 *   - 纯静态分析，不联网、不需要网关在线；
 *   - 无法静态确定参数形状的调用（变量传参）只校验方法名，不误报；
 *   - 发现违规以非零码退出，可直接接入 CI 与 pre-commit。
 *
 * 用法：
 *   node scripts/contract/verify.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

const TABLE_PATH = path.join(REPO_ROOT, 'packages/core/src/rpc/contracts/contractTable.generated.ts');
const CONTRACT_PATH = path.join(REPO_ROOT, 'packages/core/src/rpc/contracts/gateway-contract.generated.ts');
const CONTRACT_REL = 'apps/shared/src/gateway-contract.generated.ts';

const SCAN_DIRS = ['packages/core/src', 'packages/ui/src', 'packages/desktop/src'];
const EXTS = ['.ts', '.tsx'];

const errors = [];
const warnings = [];

function readTable() {
  if (!fs.existsSync(TABLE_PATH)) {
    errors.push(`缺少契约校验表：${path.relative(REPO_ROOT, TABLE_PATH)}。请先运行 npm run contract:sync`);
    return null;
  }
  const text = fs.readFileSync(TABLE_PATH, 'utf8');
  const methods = {};
  const re = /'([\w.]+)':\s*\{\s*paramsType:\s*'([^']+)',\s*resultType:\s*'([^']+)',\s*params:\s*(\[[^\]]*\]),\s*result:\s*(\[[^\]]*\])\s*\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    methods[m[1]] = {
      paramsType: m[2],
      resultType: m[3],
      params: JSON.parse(m[4]),
      result: JSON.parse(m[5]),
    };
  }
  const shaMatch = /sha256:\s*'([0-9a-f]{64})'/.exec(text);
  return { methods, recordedSha: shaMatch ? shaMatch[1] : null };
}

function verifyFingerprint(recordedSha) {
  if (!fs.existsSync(CONTRACT_PATH)) {
    errors.push(`缺少契约快照：${path.relative(REPO_ROOT, CONTRACT_PATH)}`);
    return;
  }
  // 跨平台规范化：统一按 LF 计算哈希，规避 Windows Git autocrlf 导致的假漂移
  const normalized = fs.readFileSync(CONTRACT_PATH, 'utf8').replace(/\r\n/g, '\n');
  const actual = crypto
    .createHash('sha256')
    .update(normalized, 'utf8')
    .digest('hex');
  if (recordedSha && actual !== recordedSha) {
    errors.push(
      `契约快照被手工修改（记录 ${recordedSha.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）。` +
        `请重新执行 npm run contract:sync，禁止手改生成物。`
    );
  }
}

function listFiles(dir) {
  const abs = path.join(REPO_ROOT, dir);
  const out = [];
  if (!fs.existsSync(abs)) return out;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', '__tests__', 'contracts'].includes(entry.name)) continue;
        walk(p);
        continue;
      }
      if (EXTS.some((e) => entry.name.endsWith(e))) out.push(p);
    }
  };
  walk(abs);
  return out;
}

/** 从调用点抽取字面量参数对象的顶层键名 */
function extractLiteralKeys(source, startIndex) {
  // 从调用括号处向后找第一个 `{`
  let i = startIndex;
  while (i < source.length && source[i] !== '{' && source[i] !== ')') i += 1;
  if (i >= source.length || source[i] !== '{') return null;

  let depth = 0;
  let end = i;
  for (; end < source.length; end += 1) {
    const c = source[end];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = source.slice(i + 1, end);

  const keys = [];
  let localDepth = 0;
  let token = '';
  let inString = null;
  for (let k = 0; k < body.length; k += 1) {
    const c = body[k];
    if (inString) {
      if (c === inString && body[k - 1] !== '\\') inString = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      inString = c;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') localDepth += 1;
    if (c === '}' || c === ']' || c === ')') localDepth -= 1;
    if (localDepth === 0 && (c === ',' || c === '\n')) {
      const m = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*:/.exec(token);
      if (m) keys.push(m[1]);
      const shorthand = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(token);
      if (shorthand) keys.push(shorthand[1]);
      token = '';
      continue;
    }
    if (localDepth === 0) token += c;
  }
  const last = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)\s*:/.exec(token);
  if (last) keys.push(last[1]);

  return { keys, hasSpread: body.includes('...') };
}

function readExtraMethods() {
  const extraPath = path.join(REPO_ROOT, 'packages/core/src/rpc/contracts/extraMethods.ts');
  const out = {};
  if (!fs.existsSync(extraPath)) return out;
  const text = fs.readFileSync(extraPath, 'utf8');
  const re = /^ {2}([A-Za-z_$][\w$]*):\s*\{\s*params:\s*\[([^\]]*)\]/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const params = m[2]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    out[m[1]] = { params };
  }
  return out;
}

const table = readTable();
if (table) {
  verifyFingerprint(table.recordedSha);
  const extraMethods = readExtraMethods();
  const allMethods = { ...table.methods, ...extraMethods };

  const CALL_RE = /(?:\.request|\.call)\s*(?:<[^()]*>)?\s*\(\s*(['"])([\w.]+)\1/g;
  let callCount = 0;

  for (const dir of SCAN_DIRS) {
    for (const file of listFiles(dir)) {
      const source = fs.readFileSync(file, 'utf8');
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      let m;
      const re = new RegExp(CALL_RE.source, CALL_RE.flags);
      while ((m = re.exec(source)) !== null) {
        const method = m[2];
        callCount += 1;
        const spec = allMethods[method];
        if (!spec) {
          errors.push(`${rel}:${lineOf(source, m.index)} 调用了契约中不存在的方法 "${method}"`);
          continue;
        }
        const literal = extractLiteralKeys(source, re.lastIndex);
        if (!literal) continue;
        if (literal.hasSpread) continue; // 展开运算符无法静态判定
        const allowed = new Set(spec.params);
        for (const key of literal.keys) {
          if (!allowed.has(key)) {
            errors.push(
              `${rel}:${lineOf(source, m.index)} "${method}" 传了契约未声明的字段 "${key}" ` +
                `（允许：${spec.params.join(', ') || '无'}）`
            );
          }
        }
      }
    }
  }

  console.log(`[contract:verify] 扫描调用点 ${callCount} 处，契约方法 ${Object.keys(table.methods).length} 个`);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

if (warnings.length > 0) {
  for (const w of warnings) console.warn(`  ! ${w}`);
}

if (errors.length > 0) {
  console.error(`\n[contract:verify] 发现 ${errors.length} 处契约违规：`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\n修复方式：按网关契约改正字段名，或执行 npm run contract:sync 更新契约快照。');
  process.exit(1);
}

console.log('[contract:verify] 通过：所有 RPC 调用与网关契约一致');
