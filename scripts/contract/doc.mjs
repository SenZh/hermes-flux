#!/usr/bin/env node
/**
 * 网关接口文档生成器（Gateway API Docs Generator）
 *
 * 设计意图 (Why):
 *   接口文档如果是手写的，就必然与契约漂移——这正是本次踩坑的根因之一。
 *   因此文档必须由「契约快照 + 探针结果 + 源码调用点」三者自动生成，
 *   人只读生成物，不维护生成物。
 *
 * 结构约定：
 *   docs/gateway/README.md   —— 索引（模块一览 + 全局规则）
 *   docs/gateway/<module>.md —— 一个模块一个小文档
 *
 * 防范的历史坑 (Pitfall):
 *   把 257 个方法塞进一个巨型文档，没人会读，最终被忽略。
 *   因此按模块拆分，索引只做导航。
 *
 * 用法：
 *   node scripts/contract/doc.mjs          # 生成文档
 *   node scripts/contract/doc.mjs --check  # 只校验文档是否与数据一致（CI 用）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

const TABLE_PATH = path.join(REPO_ROOT, 'packages/core/src/rpc/contracts/contractTable.generated.ts');
const FIXTURE_INDEX = path.join(REPO_ROOT, 'packages/core/__tests__/fixtures/gateway/index.json');
const EVENT_REDUCER = path.join(REPO_ROOT, 'packages/core/src/session/eventReducer.ts');
const OUT_DIR = path.join(REPO_ROOT, 'docs/gateway');

const CHECK_ONLY = process.argv.includes('--check');
const SCAN_DIRS = ['packages/core/src', 'packages/ui/src', 'packages/desktop/src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__', 'contracts']);

/* ---------------- 数据采集 ---------------- */

function parseContractTable() {
  const text = fs.readFileSync(TABLE_PATH, 'utf8');
  const methods = {};
  const mRe =
    /'([\w.]+)':\s*\{\s*paramsType:\s*'([^']+)',\s*resultType:\s*'([^']+)',\s*params:\s*(\[[^\]]*\]),\s*result:\s*(\[[^\]]*\])\s*\}/g;
  let m;
  while ((m = mRe.exec(text)) !== null) {
    methods[m[1]] = {
      paramsType: m[2],
      resultType: m[3],
      params: JSON.parse(m[4]),
      result: JSON.parse(m[5]),
    };
  }

  const events = {};
  const eRe = /'([\w.]+)':\s*\{\s*payloadType:\s*'([^']+)',\s*payload:\s*(\[[^\]]*\])\s*\}/g;
  let e;
  while ((e = eRe.exec(text)) !== null) {
    events[e[1]] = { payloadType: e[2], payload: JSON.parse(e[3]) };
  }

  const src = /sha256:\s*'([0-9a-f]{64})'/.exec(text);
  const syncedAt = /syncedAt:\s*'([^']+)'/.exec(text);
  return { methods, events, sha: src ? src[1] : '', syncedAt: syncedAt ? syncedAt[1] : '' };
}

function collectCallSites() {
  const sites = new Map();
  const walk = (dir) => {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.relative(REPO_ROOT, p).split(path.sep).join('/'));
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = fs.readFileSync(p, 'utf8');
      const re = /(?:\.request|\.call)\s*(?:<[^()]*>)?\s*\(\s*(['"])([\w.]+)\1/g;
      let m;
      while ((m = re.exec(source)) !== null) {
        const line = source.slice(0, m.index).split('\n').length;
        const rel = path.relative(REPO_ROOT, p).split(path.sep).join('/');
        if (!sites.has(m[2])) sites.set(m[2], []);
        sites.get(m[2]).push(`${rel}:${line}`);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(dir);
  return sites;
}

function loadProbeIndex() {
  if (!fs.existsSync(FIXTURE_INDEX)) return null;
  try {
    return JSON.parse(fs.readFileSync(FIXTURE_INDEX, 'utf8'));
  } catch {
    return null;
  }
}

/** 解析 eventReducer 里实际消费的事件名 */
function collectConsumedEvents() {
  const text = fs.readFileSync(EVENT_REDUCER, 'utf8');
  const names = new Set();
  for (const m of text.matchAll(/case '([\w.]+)':/g)) names.add(m[1]);
  for (const m of text.matchAll(/type === '([\w.]+)'/g)) names.add(m[1]);
  return names;
}

/* ---------------- 渲染 ---------------- */

const MODULE_TITLES = {
  system: '系统与能力探测',
  profiles: 'Bot 档案与资产',
  sessions: '会话生命周期',
  groups: '多 Agent 群聊',
  projects: '工程与工作区',
  rollback: '代码时光机',
  subagent: '子代理委派',
  prompt: '对话提交与旁路',
  events: '下行事件流',
};

const MODULE_ORDER = ['system', 'profiles', 'sessions', 'groups', 'projects', 'rollback', 'subagent', 'prompt', 'events'];

function moduleOf(method, probeModules) {
  if (probeModules.has(method)) return probeModules.get(method);
  const prefix = method.split('.')[0];
  return ['system', 'profiles', 'sessions', 'groups', 'projects', 'rollback', 'subagent', 'prompt'].includes(prefix)
    ? prefix
    : 'system';
}

function code(value) {
  return value ? `\`${value}\`` : '—';
}

function fields(list) {
  return list && list.length > 0 ? list.map((f) => `\`${f}\``).join(' ') : '—';
}

function renderModule(mod, methods, ctx) {
  const lines = [];
  lines.push(`# ${MODULE_TITLES[mod] || mod}`);
  lines.push('');
  lines.push(`> 本文件由 \`npm run contract:doc\` 从网关契约、探针结果与源码调用点自动生成，请勿手工编辑。`);
  lines.push(`> 契约快照：${ctx.sha.slice(0, 12)}… · 同步于 ${ctx.syncedAt}`);
  lines.push('');

  if (mod === 'events') {
    lines.push('网关通过 JSON-RPC 通知 `event` 帧向下推送，payload 形状由 `BackendGatewayEventMap` 定义。');
    lines.push('');
    lines.push('| 事件 | payload 类型 | 字段 | 本仓库消费 |');
    lines.push('| --- | --- | --- | --- |');
    for (const [name, spec] of Object.entries(ctx.events).sort((a, b) => a[0].localeCompare(b[0]))) {
      const consumed = ctx.consumedEvents.has(name) ? '✅' : '';
      lines.push(`| \`${name}\` | ${code(spec.payloadType)} | ${fields(spec.payload)} | ${consumed} |`);
    }
    lines.push('');
    lines.push('## 规则');
    lines.push('');
    lines.push('- 消费任何事件前，payload 字段必须落在上表白名单内；');
    lines.push('- 出现白名单之外的字段时，`eventReducer` 会记录 `event payload has fields outside the gateway contract` 告警，不中断事件流；');
    lines.push('- 未登记的事件名只记 debug，说明网关新增了事件或该事件不属于本端。');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  const entries = Object.entries(methods).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    lines.push('本模块当前没有调用点。');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| 方法 | 入参（契约） | 出参（契约） | 调用点 | 真实探针 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const [name, spec] of entries) {
    const sites = ctx.sites.get(name) || [];
    const siteText = sites.length > 0 ? sites.map((s) => `\`${s}\``).join('<br>') : '—';
    const probe = ctx.probe.get(name);
    let probeText = '未覆盖';
    if (probe?.covered) probeText = `✅ ${probe.gatewayVersion}`;
    else if (probe?.skipped) probeText = `跳过：${probe.reason}`;
    lines.push(`| \`${name}\` | ${fields(spec.params)} | ${fields(spec.result)} | ${siteText} | ${probeText} |`);
  }
  lines.push('');

  // 每个方法一段细节：参数类型名 + 调用点 + 探针备注
  lines.push('## 明细');
  lines.push('');
  for (const [name, spec] of entries) {
    lines.push(`### \`${name}\``);
    lines.push('');
    lines.push(`- 参数类型：${code(spec.paramsType)}`);
    lines.push(`- 结果类型：${code(spec.resultType)}`);
    const probe = ctx.probe.get(name);
    if (probe?.covered) {
      lines.push(`- 真实探针：已通过（网关 ${probe.gatewayVersion}，录制于 ${probe.recordedAt}）`);
      if (probe.expectedGuard) {
        lines.push(`- 本次探针走的是守卫分支：错误码 \`${probe.expectedGuard}\`（属于正确行为，不是失败）`);
      }
      if (probe.note) lines.push(`- 备注：${probe.note}`);
    } else if (probe?.skipped) {
      lines.push(`- 真实探针：跳过 —— ${probe.reason}`);
    } else {
      lines.push('- 真实探针：**未覆盖**（请补探针用例）');
    }
    const sites = ctx.sites.get(name) || [];
    if (sites.length > 0) {
      lines.push(`- 调用点：`);
      for (const s of sites) lines.push(`  - \`${s}\``);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function renderIndex(ctx) {
  const lines = [];
  lines.push('# 网关接口索引');
  lines.push('');
  lines.push('> 本目录由 `npm run contract:doc` 自动生成。索引只做导航，细节在模块文档里。');
  lines.push('');
  lines.push('## 数据来源');
  lines.push('');
  lines.push('| 项目 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| 契约来源 | \`apps/shared/src/gateway-contract.generated.ts\`（网关 Pydantic 模型自动生成） |`);
  lines.push(`| 契约指纹 | \`${ctx.sha.slice(0, 16)}…\` |`);
  lines.push(`| 同步时间 | ${ctx.syncedAt} |`);
  lines.push(`| 契约内方法总数 | ${Object.keys(ctx.methods).length}（本仓库实际使用 ${ctx.usedCount} 个，本文档只覆盖用到的） |`);
  lines.push(`| 契约内事件总数 | ${Object.keys(ctx.events).length} |`);
  lines.push(`| 探针网关版本 | ${ctx.gatewayVersion || '未录制'} |`);
  lines.push(`| 探针录制时间 | ${ctx.recordedAt || '未录制'} |`);
  lines.push('');

  lines.push('## 模块');
  lines.push('');
  lines.push('| 模块 | 方法数 | 已探针 | 文档 |');
  lines.push('| --- | --- | --- | --- |');
  for (const mod of MODULE_ORDER) {
    if (mod === 'events') {
      lines.push(`| ${MODULE_TITLES[mod]} | ${Object.keys(ctx.events).length} 个事件 | — | [events.md](./events.md) |`);
      continue;
    }
    const list = Object.entries(ctx.usedMethods).filter(([name]) => moduleOf(name, ctx.probeModules) === mod);
    if (list.length === 0) continue;
    const covered = list.filter(([name]) => ctx.probe.get(name)?.covered).length;
    lines.push(`| ${MODULE_TITLES[mod]} | ${list.length} | ${covered} | [${mod}.md](./${mod}.md) |`);
  }
  lines.push('');

  lines.push('## 使用规则');
  lines.push('');
  lines.push('1. **新增或修改任何 RPC 调用**，先在对应模块文档里确认方法名与字段，再写代码；');
  lines.push('2. 方法名必须存在于契约中，字段必须落在白名单内，否则 `npm run contract:verify` 直接失败；');
  lines.push('3. 新增调用点必须补探针用例，`npm run contract:coverage` 会检查"每个方法都有真实响应证据"；');
  lines.push('4. 网关升级后执行 `npm run contract:sync` 刷新契约，再执行 `npm run probe:gateway` 刷新真实响应；');
  lines.push('5. 本目录所有文件都是生成物，CI 会校验"重新生成后无 diff"，手改会被打回。');
  lines.push('');

  lines.push('## 相关命令');
  lines.push('');
  lines.push('| 命令 | 作用 |');
  lines.push('| --- | --- |');
  lines.push('| `npm run contract:sync` | 从网关仓库同步契约快照与字段白名单 |');
  lines.push('| `npm run contract:verify` | 静态校验所有调用点的方法名与字段 |');
  lines.push('| `npm run probe:gateway` | 连真实网关逐个方法取证，录制 fixture |');
  lines.push('| `npm run contract:coverage` | 校验每个调用点都有真实响应证据 |');
  lines.push('| `npm run contract:doc` | 重新生成本目录文档 |');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

/* ---------------- 主流程 ---------------- */

function buildContext() {
  const { methods, events, sha, syncedAt } = parseContractTable();

  // 网关有一批轻量方法（如 ping）不进入生成契约，但确实存在。
  // 它们必须同样被文档化，否则"文档里没有 = 不能用"的误判会逼人去猜。
  const extraPath = path.join(REPO_ROOT, 'packages/core/src/rpc/contracts/extraMethods.ts');
  if (fs.existsSync(extraPath)) {
    const text = fs.readFileSync(extraPath, 'utf8');
    const re = /^ {2}([A-Za-z_$][\w$]*):\s*\{\s*params:\s*\[([^\]]*)\]/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
      const params = m[2]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      methods[m[1]] = {
        paramsType: '(网关额外方法)',
        resultType: '(未纳入生成契约)',
        params,
        result: [],
        extra: true,
      };
    }
  }

  const sites = collectCallSites();
  const index = loadProbeIndex();
  const consumedEvents = collectConsumedEvents();

  const probe = new Map();
  const probeModules = new Map();
  if (index) {
    for (const c of index.cases || []) {
      // 负向探针共用方法名，不能覆盖该方法的模块归属
      if (c.module === 'negative') continue;
      if (c.ok) {
        probe.set(c.method, {
          covered: true,
          gatewayVersion: index.gatewayVersion,
          recordedAt: index.recordedAt,
          expectedGuard: c.expectedGuard,
          note: c.note,
        });
        probeModules.set(c.method, c.module);
      } else if (c.skipped) {
        probe.set(c.method, { covered: false, skipped: true, reason: c.reason });
        probeModules.set(c.method, c.module);
      }
    }
  }

  return {
    methods,
    events,
    sha,
    syncedAt,
    sites,
    probe,
    probeModules,
    consumedEvents,
    gatewayVersion: index?.gatewayVersion,
    recordedAt: index?.recordedAt,
  };
}

function main() {
  const ctx = buildContext();
  // 只文档化"本仓库实际调用的方法"，契约里其余 200+ 个方法不在本文档范围内
  const usedMethods = Object.fromEntries(
    Object.entries(ctx.methods).filter(([name]) => ctx.sites.has(name))
  );
  const usedCount = Object.keys(usedMethods).length;
  if (process.argv.includes('--debug')) {
    console.log('[contract:doc] usedMethods:', Object.keys(usedMethods).join(', '));
    for (const [name] of Object.entries(usedMethods)) {
      console.log(`  ${name} -> ${moduleOf(name, ctx.probeModules)}`);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const outputs = new Map();
  outputs.set(path.join(OUT_DIR, 'README.md'), renderIndex({ ...ctx, usedMethods, usedCount }));

  for (const mod of MODULE_ORDER) {
    if (mod === 'events') {
      outputs.set(path.join(OUT_DIR, 'events.md'), renderModule('events', {}, ctx));
      continue;
    }
    const subset = Object.fromEntries(
      Object.entries(usedMethods).filter(([name]) => moduleOf(name, ctx.probeModules) === mod)
    );
    if (Object.keys(subset).length === 0) continue;
    outputs.set(path.join(OUT_DIR, `${mod}.md`), renderModule(mod, subset, ctx));
  }

  if (CHECK_ONLY) {
    const stale = [];
    const normalize = (t) => (t ? t.replace(/\r\n/g, '\n') : t);
    for (const [file, content] of outputs) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (normalize(current) !== normalize(content)) stale.push(path.relative(REPO_ROOT, file));
    }
    if (stale.length > 0) {
      console.error('[contract:doc] 文档与数据不一致，请重新运行 npm run contract:doc：');
      for (const f of stale) console.error(`  ✗ ${f}`);
      process.exit(1);
    }
    console.log(`[contract:doc] 通过：${outputs.size} 个文档与契约/探针数据一致`);
    return;
  }

  for (const [file, content] of outputs) {
    fs.writeFileSync(file, content, 'utf8');
  }
  console.log(`[contract:doc] 已生成 ${outputs.size} 个文档到 docs/gateway/`);
  console.log(`[contract:doc] 索引：docs/gateway/README.md`);
}

main();
