#!/usr/bin/env node
/**
 * 网关契约同步器（Gateway Contract Sync）
 *
 * 设计意图 (Why):
 *   我们对 RPC 的入参/出参认识，必须锚定网关自动生成的权威契约，
 *   而不是手写推断。网关仓库里 `apps/shared/src/gateway-contract.generated.ts`
 *   由 Python Pydantic 模型自动生成，是唯一权威源。
 *   本脚本把它复制进本仓库，并派生出「方法 -> 允许字段」的运行时校验表。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 手写 `types.ts` 与网关契约漂移，导致多传一个 `key` 字段就被 4000 拒绝，
 *      而客户端毫无察觉（本次"头像一直是老的"根因）。
 *   2. 靠方法名拼类型名（profiles.get_asset -> ProfilesGetAssetParams）在
 *      命名不规则时会静默失配；必须直接读网关的 RpcMethods 注册表。
 *   3. 把网关地址/账号写进脚本 -> 泄漏且不可移植。路径与凭证一律走环境变量。
 *
 * 约束与规则 (Rules):
 *   - 必须设置 `HERMES_GATEWAY_REPO` 指向网关仓库根目录；
 *   - 输出为纯生成物，任何手工修改都会被 `verify` 的指纹比对打回；
 *   - 不发起任何网络请求，纯文件系统读取。
 *
 * 用法：
 *   HERMES_GATEWAY_REPO=D:\path\to\hermes-agent node scripts/contract/sync.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

const CONTRACT_REL = 'apps/shared/src/gateway-contract.generated.ts';
const OUT_DIR = path.join(REPO_ROOT, 'packages/core/src/rpc/contracts');
const OUT_CONTRACT = path.join(OUT_DIR, 'gateway-contract.generated.ts');
const OUT_TABLE = path.join(OUT_DIR, 'contractTable.generated.ts');

function fail(message) {
  console.error(`[contract:sync] ${message}`);
  process.exit(1);
}

const gatewayRepo = process.env.HERMES_GATEWAY_REPO;
if (!gatewayRepo) {
  fail(
    '缺少环境变量 HERMES_GATEWAY_REPO。\n' +
      '  例：HERMES_GATEWAY_REPO=D:\\\\path\\\\to\\\\hermes-agent node scripts/contract/sync.mjs\n' +
      '  该变量只用于定位网关仓库，不含任何地址或凭证。'
  );
}

const contractPath = path.join(gatewayRepo, CONTRACT_REL);
if (!fs.existsSync(contractPath)) {
  fail(`找不到网关契约文件：${contractPath}`);
}

const source = fs.readFileSync(contractPath, 'utf8');
// 跨平台规范化：统一按 LF 计算哈希，规避 Windows Git autocrlf 导致的假漂移
const sha256 = crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

/**
 * 解析所有 `export interface X { ... }` 的顶层字段名。
 * 只认 2 空格缩进的字段行，避免把嵌套对象的字段也算进父接口。
 */
function parseInterfaces(text) {
  const map = new Map();
  const re = /^export interface (\w+)(?: extends [^{]+)? \{$/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    const name = match[1];
    const bodyStart = re.lastIndex;
    // 从接口体起点找列 0 的闭合大括号
    const closeIdx = text.indexOf('\n}', bodyStart);
    if (closeIdx < 0) continue;
    const body = text.slice(bodyStart, closeIdx);
    const fields = [];
    for (const line of body.split('\n')) {
      const fieldMatch = /^ {2}(\w+)\??:/.exec(line);
      if (fieldMatch) fields.push(fieldMatch[1]);
    }
    map.set(name, fields);
  }
  return map;
}

/**
 * 解析网关的方法注册表：'method' -> { params: X; result: Y }
 *
 * 【设计意图 (Why)】
 *   网关把方法分成两张注册表：`RpcMethods`（经典通道）与 `CanonicalRpcMethods`
 *   （hermes-gateway-v1 会话权威独有）。只解析前者会漏掉 `prompt.cancel` /
 *   `prompt.steer_queued` 这类只有新协议才提供的方法，契约校验随即把合法调用判成"不存在"。
 *
 * 【防范的历史坑 (Pitfall)】
 *   第一版按"先到先得"合并，并假设经典表字段更宽。实测 25 个同名方法里有 11 个经典表更窄
 *   （`prompt.submit` 缺 `attachments`/`model_override` 等 9 个字段，`session.create` 缺 20 个），
 *   而客户端守卫拿这张表做白名单硬拦截 —— 结果是把 canonical 合法字段在本地直接拒掉，
 *   网关根本收不到请求。
 *
 * 【约束与规则 (Rules)】
 *   同名方法取**参数并集**：白名单只回答"这个字段允不允许出现"，
 *   两张表任一声明过就必须放行。结果类型保留先解析到的那个（返回结构由网关决定，不做并集）。
 */
function parseMethodRegistry(text) {
  const methods = new Map();

  const collect = (interfaceName) => {
    const start = text.indexOf(`export interface ${interfaceName} {`);
    if (start < 0) return;
    const bodyStart = text.indexOf('{', start) + 1;
    const closeIdx = text.indexOf('\n}', bodyStart);
    const body = text.slice(bodyStart, closeIdx);

    const re = /'([\w.]+)':\s*\{\s*params:\s*(\w+);\s*result:\s*(\w+)\s*\}/g;
    let match;
    while ((match = re.exec(body)) !== null) {
      const existing = methods.get(match[1]);
      methods.set(match[1], {
        paramsType: existing?.paramsType ?? match[2],
        resultType: existing?.resultType ?? match[3],
        /** 同名方法要合并的第二张参数类型；生成表格时取并集 */
        paramsTypes: [...(existing?.paramsTypes ?? []), match[2]],
      });
    }
  };

  collect('RpcMethods');
  collect('CanonicalRpcMethods');

  if (methods.size === 0) fail('网关契约里找不到 RpcMethods / CanonicalRpcMethods 注册表');
  return methods;
}

/** 解析网关的下行事件注册表：'event.name' -> PayloadType */
function parseEventRegistry(text) {
  const start = text.indexOf('export interface BackendGatewayEventMap {');
  if (start < 0) return new Map();
  const bodyStart = text.indexOf('{', start) + 1;
  const closeIdx = text.indexOf('\n}', bodyStart);
  const body = text.slice(bodyStart, closeIdx);

  const events = new Map();
  // 形如：  'message.delta': MessageDeltaPayload
  const re = /^ {2}'([\w.]+)':\s*(\w+)\s*$/gm;
  let match;
  while ((match = re.exec(body)) !== null) {
    events.set(match[1], match[2]);
  }
  return events;
}

const interfaces = parseInterfaces(source);
const methods = parseMethodRegistry(source);
const events = parseEventRegistry(source);

if (methods.size === 0) fail('RpcMethods 注册表解析结果为空，契约文件格式可能已变更');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_CONTRACT, source, 'utf8');

const tableEntries = [];
for (const [method, types] of [...methods.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  // 【规则】同名方法的参数取并集：白名单只回答"这个字段允不允许出现"，
  //   两张注册表任一声明过就必须放行，否则 canonical 的宽参数会在本地被误拒。
  const paramFields = new Set();
  for (const paramsType of types.paramsTypes) {
    for (const field of interfaces.get(paramsType) ?? []) paramFields.add(field);
  }
  const params = [...paramFields];
  const result = interfaces.get(types.resultType) ?? [];
  tableEntries.push(
    `  '${method}': { paramsType: '${types.paramsType}', resultType: '${types.resultType}', ` +
      `params: ${JSON.stringify(params)}, result: ${JSON.stringify(result)} },`
  );
}

const eventEntries = [];
for (const [name, payloadType] of [...events.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const fields = interfaces.get(payloadType) ?? [];
  eventEntries.push(`  '${name}': { payloadType: '${payloadType}', payload: ${JSON.stringify(fields)} },`);
}

const header = `// GENERATED by scripts/contract/sync.mjs — DO NOT EDIT.
// Source: ${CONTRACT_REL}
// Source sha256: ${sha256}
// Synced at: ${new Date().toISOString()}
//
// 设计意图 (Why):
//   运行时请求守卫据此在发送前校验字段白名单，未知字段立刻在本地报错，
//   而不是等网关返回 4000 Extra inputs are not permitted。
//
// 防范的历史坑 (Pitfall):
//   手工维护这张表会与网关漂移；必须由 sync 脚本从权威契约生成。
//
// 约束与规则 (Rules):
//   任何手工修改都会被 npm run contract:verify 的指纹比对打回。
/* eslint-disable */

export interface ContractMethod {
  paramsType: string;
  resultType: string;
  /** 允许出现在 params 顶层的字段名 */
  params: readonly string[];
  /** 结果顶层字段名（用于结构断言） */
  result: readonly string[];
}

export interface ContractEvent {
  payloadType: string;
  /** payload 顶层字段名；消费方不得访问白名单之外的字段 */
  payload: readonly string[];
}

export const CONTRACT_SOURCE = {
  file: '${CONTRACT_REL}',
  sha256: '${sha256}',
  syncedAt: '${new Date().toISOString()}',
  methodCount: ${methods.size},
  eventCount: ${events.size},
} as const;

export const CONTRACT_METHODS: Record<string, ContractMethod> = {
`;

fs.writeFileSync(OUT_TABLE, `${header}${tableEntries.join('\n')}\n};\n\n/** 网关下行事件契约（event 帧的 payload 形状） */\nexport const CONTRACT_EVENTS: Record<string, ContractEvent> = {\n${eventEntries.join('\n')}\n};\n`, 'utf8');

/* ---------------- 编译期一致性断言 ---------------- */

/**
 * 生成 conformance.ts：用类型断言强制「我们手写的 Params/Result 不得包含契约外字段」。
 *
 * 设计意图 (Why):
 *   运行时守卫只能在真的发出请求时拦截；静态 verify 只能看字面量参数。
 *   类型断言把第三道防线放到**编译期**：哪怕参数是变量拼出来的，
 *   只要类型里多了一个契约没有的字段，tsc 就直接失败。
 *
 * 防范的历史坑 (Pitfall):
 *   `profiles.get_asset` 的 `key` 字段就是"类型里写了、网关不认"的典型，
 *   靠人工 review 抓不住，靠类型断言可以。
 */
const OUR_TYPES_REL = 'packages/core/src/rpc/types.ts';
const ourTypesPath = path.join(REPO_ROOT, OUR_TYPES_REL);
const ourTypeNames = fs.existsSync(ourTypesPath)
  ? [...fs.readFileSync(ourTypesPath, 'utf8').matchAll(/^export interface (\w+)/gm)].map((m) => m[1])
  : [];

/**
 * 只对 `*Params`（我们**发出去**的类型）做严格断言。
 *
 * 为什么排除 Result：
 *   结果类型里有若干刻意的兼容别名（如 `asset_base64` / `entries` / `groups`），
 *   它们只被本地读取、不会发给网关，做严格断言会把兼容层全部判红。
 *   结果形状的真实性由 fixture 测试守护（packages/core/__tests__/contract）。
 */
const comparable = ourTypeNames
  .filter((name) => name.endsWith('Params') && interfaces.has(name))
  .sort();
const conformanceLines = comparable.map(
  (name) => `export const _${name}: NoExtraKeys<Ours.${name}, Gen.${name}> = true;`
);

const conformance = `// GENERATED by scripts/contract/sync.mjs — DO NOT EDIT.
//
// 编译期契约一致性断言：
//   如果 Ours.<Type> 比 Gen.<Type> 多出任何字段，下面这一行就无法赋值为 true，
//   tsc 会直接报错并指出多余的字段名。
//
// 设计意图 (Why):
//   运行时守卫只在真正发请求时生效；静态 verify 只能看字面量参数。
//   这里补上编译期这一层，覆盖"参数由变量拼装"的情况。
//
// 防范的历史坑 (Pitfall):
//   profiles.get_asset 的 key 字段属于"类型里写了、网关不认"，
//   人工 review 抓不住，类型断言可以。
/* eslint-disable */

import type * as Gen from './gateway-contract.generated.js';
import type * as Ours from '../types.js';

type ExtraKeys<A, B> = Exclude<keyof A, keyof B>;
/** 有额外字段时返回一个带字段名的对象类型，使 \`= true\` 赋值失败并暴露字段名 */
type NoExtraKeys<A, B> = ExtraKeys<A, B> extends never ? true : { __extra_keys: ExtraKeys<A, B> };

${conformanceLines.join('\n')}
`;

fs.writeFileSync(path.join(OUT_DIR, 'conformance.ts'), conformance, 'utf8');
console.log(`[contract:sync] 编译期一致性断言 ${comparable.length} 条 -> packages/core/src/rpc/contracts/conformance.ts`);

console.log(`[contract:sync] 已同步 ${methods.size} 个方法、${events.size} 个事件`);
console.log(`[contract:sync] 契约文件 -> ${path.relative(REPO_ROOT, OUT_CONTRACT)}`);
console.log(`[contract:sync] 校验表   -> ${path.relative(REPO_ROOT, OUT_TABLE)}`);
console.log(`[contract:sync] sha256   = ${sha256}`);
