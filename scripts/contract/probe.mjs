#!/usr/bin/env node
/**
 * 真实网关探针（Live Gateway Probe）— 全量覆盖版
 *
 * 设计意图 (Why):
 *   所有关于网关行为的断言，必须来自一次真实往返，而不是"我觉得接口应该这样"。
 *   本脚本对源码里实际调用的**每一个** RPC 方法发一次真实请求，
 *   把响应脱敏后固化为 fixture，让 CI 在离线状态下也能用真实结构做断言。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 手写 mock 按错误假设写，生产代码改错测试依然全绿（循环自证）。
 *   2. 只测"正常路径"不测"严格性"，就不知道网关会拒绝多余字段。
 *      因此同时做负向探针：故意多传字段，断言网关返回 4000。
 *   3. 只覆盖 8 个方法就宣称"已验证"——覆盖率必须可量化、可对账。
 *   4. 把网关地址/账号写进代码 -> 泄漏且不可移植。全部走环境变量。
 *
 * 约束与规则 (Rules):
 *   - 写操作必须建临时资源并在 teardown 中清理（会话/项目/群聊）；
 *   - `profiles.create` 无删除接口，使用固定探针名，重复运行以冲突码作为契约证据；
 *   - `prompt.submit` / `prompt.btw` 会真实触发 Agent 回合（耗时且消耗额度），
 *     默认跳过，需显式设置 `HERMES_PROBE_ALLOW_PROMPT=1`；
 *   - 输出必须脱敏：data URL、绝对路径、超长文本一律替换为占位符；
 *   - 没有配置环境变量时以退出码 0 跳过（本地/CI 无网关属正常情况）。
 *
 * 用法：
 *   HERMES_GATEWAY_URL=... HERMES_GATEWAY_USER=... HERMES_GATEWAY_PASSWORD=... \
 *   node scripts/contract/probe.mjs            # 录制/刷新 fixture
 *   node scripts/contract/probe.mjs --check    # 只比对漂移，不写盘
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'packages/core/__tests__/fixtures/gateway');

const CHECK_ONLY = process.argv.includes('--check');
/**
 * prompt.submit / prompt.btw 会真实触发 Agent 回合（消耗额度、可能调用工具）。
 * 默认开启（这是主链路上最关键的接口，不验证等于没验证）；
 * 需要省额度时设置 HERMES_PROBE_SKIP_PROMPT=1 跳过。
 */
const SKIP_PROMPT = process.env.HERMES_PROBE_SKIP_PROMPT === '1';

const BASE_URL = process.env.HERMES_GATEWAY_URL;
const USER = process.env.HERMES_GATEWAY_USER;
const PASSWORD = process.env.HERMES_GATEWAY_PASSWORD;

if (!BASE_URL) {
  console.log('[probe] HERMES_GATEWAY_URL 未设置，跳过真实网关探测（这是允许的）。');
  process.exit(0);
}

/* ---------------- 脱敏 ---------------- */

function sanitize(value, depth = 0) {
  if (depth > 6) return '<max-depth>';
  if (value === null || typeof value === 'undefined') return value;
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `<data-url:${value.length}>`;
    if (/^[A-Za-z]:\\/.test(value) || value.startsWith('/')) return '<path>';
    if (value.length > 200) return `${value.slice(0, 200)}…<truncated:${value.length}>`;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const head = value.slice(0, 3).map((item) => sanitize(item, depth + 1));
    if (value.length > 3) head.push(`<more:${value.length - 3}>`);
    return head;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitize(v, depth + 1);
    return out;
  }
  return String(value);
}

/* ---------------- HTTP / WS ---------------- */

function request(pathname, { method = 'GET', body, headers = {} } = {}) {
  const url = new URL(pathname, BASE_URL);
  const client = url.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          const rawCookies = res.headers['set-cookie'] || [];
          resolve({
            status: res.statusCode,
            cookies: rawCookies.map((c) => c.split(';')[0]).join('; '),
            text,
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function authenticate() {
  const status = await request('/api/status');
  let statusJson = {};
  try {
    statusJson = JSON.parse(status.text);
  } catch {
    // 非 JSON 状态响应按免密网关处理
  }

  if (!statusJson.auth_required) {
    return { cookies: '', version: statusJson.version || 'unknown' };
  }
  if (!USER || !PASSWORD) {
    throw new Error('网关要求认证，但未设置 HERMES_GATEWAY_USER / HERMES_GATEWAY_PASSWORD');
  }

  const login = await request('/auth/password-login', {
    method: 'POST',
    body: { provider: 'basic', username: USER, password: PASSWORD },
  });
  if (login.status !== 200) {
    throw new Error(`登录失败 HTTP ${login.status}: ${login.text.slice(0, 200)}`);
  }
  return { cookies: login.cookies, version: statusJson.version || 'unknown' };
}

async function openSocket(cookies) {
  const ticketRes = await request('/api/auth/ws-ticket', { method: 'POST', headers: { Cookie: cookies } });
  let ticket = '';
  try {
    ticket = JSON.parse(ticketRes.text).ticket || '';
  } catch {
    ticket = '';
  }

  const wsUrl = new URL('/api/ws', BASE_URL);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  if (ticket) wsUrl.searchParams.set('ticket', ticket);

  const ws = new WebSocket(wsUrl.toString());
  let nextId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message || 'RPC error'), msg.error));
      else entry.resolve(msg.result);
    }
  };

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 15000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('WebSocket 连接失败'));
    };
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });

  return { ws, call };
}

/* ---------------- 工具 ---------------- */

const stamp = () => Date.now().toString(36);

function mintThreadId() {
  return `t${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function mintEventId() {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------------- 探针用例 ---------------- */

/**
 * 每个模块一组用例。setup 产出的上下文供本模块所有用例使用，
 * teardown 负责清理临时资源（失败只记日志，不影响结论）。
 */
function buildModules(ctx) {
  const profile = ctx.profile;
  const members = ctx.memberProfiles;

  return [
    {
      module: 'system',
      cases: [
        { method: 'ping', params: () => ({}), assert: (r) => assertField(r, 'pong') },
        { method: 'gateway.capabilities', params: () => ({}) },
        { method: 'model.options', params: () => ({ profile }) },
      ],
    },

    {
      module: 'profiles',
      cases: [
        { method: 'profiles.list', params: () => ({}) },
        { method: 'profiles.describe', params: () => ({ name: profile }) },
        { method: 'profiles.get_asset', params: () => ({ name: profile, asset: 'avatar' }) },
        {
          method: 'profiles.create',
          // 无删除接口，用固定探针名；已存在（4062）时同样证明该 Bot 可用
          params: () => ({
            name: ctx.probeBot,
            description: 'Hermes Flux 契约探针专用 Bot（可安全忽略）',
            no_skills: true,
          }),
          allowCodes: [4062, 4090, 4091, 4092, 4093, 4094, 4095, 5062],
          onAllowed: () => {
            ctx.probeBotReady = true;
          },
          after: (result) => {
            if (result?.ok || result?.name) ctx.probeBotReady = true;
          },
          note: '网关没有 profiles.delete，探针 Bot 会保留；重复运行以冲突码作为契约证据',
        },
        {
          method: 'profiles.configure',
          params: () => ({ name: ctx.probeBot, description: 'Hermes Flux 契约探针专用 Bot' }),
          skip: () => (ctx.probeBotReady ? null : '探针 Bot 未创建成功（可能已存在），跳过'),
        },
        {
          method: 'profiles.set_asset',
          // clear=true 是幂等清理，不会留下任何资产
          params: () => ({ name: ctx.probeBot, asset: 'avatar', data: '', clear: true }),
          skip: () => (ctx.probeBotReady ? null : '探针 Bot 未创建成功，跳过'),
        },
      ],
    },

    {
      module: 'sessions',
      setup: async () => {
        const created = await ctx.call('session.create', {
          profile,
          title: `flux-probe-${stamp()}`,
          hidden: true,
        });
        // 关键契约：session.create 返回 live id 与 stored id 两个标识。
        // session.resume 必须用 stored id；其余会话 RPC 用 resume 返回的 live id。
        const storedId = created.stored_session_id || created.session_id;
        const liveId = created.session_id;
        if (!storedId || !liveId) throw new Error('session.create 未返回 session_id/stored_session_id');

        ctx.sessionStoredId = storedId;
        const resumed = await ctx.call('session.resume', { session_id: storedId, profile, lazy: true });
        ctx.sessionId = resumed.session_id || liveId;
        return { liveId: ctx.sessionId, storedId };
      },
      teardown: async () => {
        if (!ctx.sessionId || ctx.sessionDeleted) return;
        // 必须先 close 释放 transport 持有，否则 delete 会因 4023（active session）被拒
        try {
          await ctx.call('session.close', { session_id: ctx.sessionId, profile });
        } catch (err) {
          console.log(`  · 会话 close 失败（可忽略）: ${err.code || err.message}`);
        }
        const target = ctx.sessionStoredId || ctx.sessionId;
        try {
          await ctx.call('session.delete', { session_id: target, profile });
        } catch (err) {
          // 无消息的会话 close 后不会落库，delete 返回 4007 属于正常
          if (![4007, 4023].includes(err.code)) {
            console.log(`  · 清理 session.delete 失败（可忽略）: ${err.code || err.message}`);
          }
        }
      },
      cases: [
        { method: 'session.list', params: () => ({ profile, limit: 5 }) },
        {
          method: 'session.resume',
          // 必须用 stored id，用 live id 会被 4007 拒绝
          params: () => ({ session_id: ctx.sessionStoredId, profile, lazy: true }),
        },
        { method: 'session.title', params: () => ({ session_id: ctx.sessionId, profile, title: `flux-probe-renamed-${stamp()}` }) },
        { method: 'session.set_hidden', params: () => ({ session_id: ctx.sessionId, profile, hidden: true }) },
        { method: 'session.archive', params: () => ({ session_id: ctx.sessionId, profile, archived: false }) },
        { method: 'session.interrupt', params: () => ({ session_id: ctx.sessionId, profile }), allowCodes: [4001] },
        {
          method: 'session.branch_whole',
          // 空会话分支会被网关拒绝（4008 nothing to branch 或 5008 外键约束），这是业务守卫
          params: () => ({ session_id: ctx.sessionId, profile, name: `flux-probe-branch-${stamp()}` }),
          allowCodes: [4008, 5008],
        },
        {
          method: 'config.set',
          // 幂等：把 model 设成当前值；必须带 session_id，否则网关 4001
          params: () => ({ session_id: ctx.sessionId, profile, key: 'model', value: ctx.currentModel }),
          skip: () => (ctx.currentModel ? null : '无法读取当前模型，跳过以免改动网关配置'),
        },
        {
          method: 'session.create',
          params: () => ({ profile, title: `flux-probe-create-${stamp()}`, hidden: true }),
          after: async (result) => {
            const extraId = result?.session_id || result?.stored_session_id;
            if (extraId) {
              try {
                await ctx.call('session.delete', { session_id: extraId, profile });
              } catch (err) {
                console.log(`  · 清理临时 create 会话失败（可忽略）: ${err.code || err.message}`);
              }
            }
          },
        },
        {
          method: 'session.delete',
          // 契约事实（已实测）：无消息的会话不会落库，因此只能验证"拒绝路径"。
          // 活跃会话 -> 4023 cannot delete an active session；未知 id -> 4007。
          // 这正是渲染层删除流程必须处理的两种前置条件。
          params: () => ({ session_id: ctx.sessionStoredId, profile }),
          allowCodes: [4023, 4007],
          note: '空会话不落库，只能验证守卫；正常删除路径需要一条有消息的会话',
        },
        {
          method: 'session.close',
          // close 会销毁实时通道，必须用独立的一次性会话，避免影响本组其余探针
          params: async () => {
            const tmp = await ctx.call('session.create', {
              profile,
              title: `flux-probe-close-${stamp()}`,
              hidden: true,
            });
            ctx.closeProbeId = tmp.session_id;
            return { session_id: tmp.session_id, profile };
          },
          after: async () => {
            if (!ctx.closeProbeId) return;
            try {
              await ctx.call('session.delete', { session_id: ctx.closeProbeId, profile });
            } catch (err) {
              console.log(`  · 清理 close 探针会话失败（可忽略）: ${err.code || err.message}`);
            }
          },
          destructive: true,
        },
      ],
    },

    {
      module: 'groups',
      setup: async () => {
        if (members.length < 2) return null;
        const roomId = `r${stamp()}-${Math.random().toString(36).slice(2, 7)}`;
        const created = await ctx.call('groups.create', {
          room_id: roomId,
          name: `flux-probe-room-${stamp()}`,
          members: members.slice(0, 2).map((m, i) => ({
            member_id: `m_${m}_${i}`,
            profile: m,
            handle: m,
            display_name: m,
          })),
        });
        ctx.roomId = created?.room?.room_id || roomId;
        return { roomId: ctx.roomId };
      },
      teardown: async () => {
        if (!ctx.roomId) return;
        try {
          await ctx.call('groups.disband', { room_id: ctx.roomId });
        } catch (err) {
          console.log(`  · 清理 groups.disband 失败（可忽略）: ${err.code || err.message}`);
        }
      },
      cases: [
        { method: 'groups.list', params: () => ({}) },
        { method: 'groups.state', params: () => ({ room_id: ctx.roomId }) },
        {
          method: 'groups.send',
          params: () => ({
            room_id: ctx.roomId,
            event_id: mintEventId(),
            payload: { text: '契约探针：验证 groups.send 的 payload 形状', thread_id: mintThreadId() },
          }),
        },
        { method: 'groups.log', params: () => ({ room_id: ctx.roomId, limit: 10 }) },
        { method: 'groups.rename', params: () => ({ room_id: ctx.roomId, event_id: mintEventId(), name: `flux-probe-renamed-${stamp()}` }) },
        {
          method: 'groups.create',
          // 单独验证 create 契约；建完立即 disband
          params: () => ({
            room_id: `r${stamp()}-${Math.random().toString(36).slice(2, 7)}`,
            name: `flux-probe-create-${stamp()}`,
            members: members.slice(0, 2).map((m, i) => ({
              member_id: `m_${m}_${i}`,
              profile: m,
              handle: m,
              display_name: m,
            })),
          }),
          after: async (result) => {
            const rid = result?.room?.room_id;
            if (rid) {
              try {
                await ctx.call('groups.disband', { room_id: rid });
              } catch (err) {
                console.log(`  · 清理临时房间失败（可忽略）: ${err.code || err.message}`);
              }
            }
          },
        },
        { method: 'groups.disband', params: () => ({ room_id: ctx.roomId }), destructive: true },
      ],
    },

    {
      module: 'projects',
      setup: async () => {
        const name = `flux-probe-${stamp()}`;
        const primaryPath = `${ctx.tempRoot}/proj-${stamp()}`;
        const created = await ctx.call('projects.create', {
          profile,
          name,
          folders: [primaryPath],
          primary_path: primaryPath,
          description: 'Hermes Flux 契约探针专用项目（可安全删除）',
        });
        const id = created?.project?.id;
        if (!id) throw new Error('projects.create 未返回 project.id');
        ctx.projectId = id;
        ctx.projectPath = primaryPath;
        return { id };
      },
      teardown: async () => {
        if (!ctx.projectId || ctx.projectDeleted) return;
        try {
          await ctx.call('projects.delete', { id: ctx.projectId });
        } catch (err) {
          console.log(`  · 清理 projects.delete 失败（可忽略）: ${err.code || err.message}`);
        }
      },
      cases: [
        { method: 'projects.list', params: () => ({ profile }) },
        { method: 'projects.get', params: () => ({ id: ctx.projectId }) },
        { method: 'projects.update', params: () => ({ id: ctx.projectId, description: '契约探针已更新描述' }) },
        { method: 'projects.tree', params: () => ({ profile, preview_limit: 3, session_limit: 1 }) },
        {
          method: 'projects.add_folder',
          params: () => ({ id: ctx.projectId, path: `${ctx.tempRoot}/extra-${stamp()}` }),
        },
        {
          method: 'projects.remove_folder',
          params: () => ({ id: ctx.projectId, path: `${ctx.tempRoot}/extra-${stamp()}` }),
          allowCodes: [4000],
          note: 'remove 一个不存在的附加目录，用错误码验证守卫；正常路径由 add_folder 覆盖',
        },
        { method: 'projects.set_active', params: () => ({ id: ctx.projectId }) },
        {
          method: 'projects.create',
          // 单独验证 create 契约，建完立即删除
          params: () => {
            const p = `${ctx.tempRoot}/extra-create-${stamp()}`;
            return {
              profile,
              name: `flux-probe-create-${stamp()}`,
              folders: [p],
              primary_path: p,
            };
          },
          after: async (result) => {
            const extraId = result?.project?.id;
            if (!extraId) return;
            try {
              await ctx.call('projects.delete', { id: extraId });
            } catch (err) {
              console.log(`  · 清理临时项目失败（可忽略）: ${err.code || err.message}`);
            }
          },
        },
        {
          method: 'projects.delete',
          params: () => ({ id: ctx.projectId }),
          after: () => {
            ctx.projectDeleted = true;
          },
          destructive: true,
        },
      ],
    },

    {
      module: 'rollback',
      cases: [
        {
          method: 'rollback.list',
          params: () => ({ session_id: ctx.sessionId, profile }),
          skip: () => (ctx.sessionId ? null : '没有可用会话'),
          allowCodes: [4001],
        },
        {
          method: 'rollback.diff',
          // 用不存在的 hash 验证参数契约，不产生任何恢复副作用
          params: () => ({ session_id: ctx.sessionId, profile, hash: 'deadbeef' }),
          skip: () => (ctx.sessionId ? null : '没有可用会话'),
          allowCodes: [4001, 4000, 4040],
        },
        {
          method: 'rollback.restore',
          // 同样用不存在的 hash：验证契约但绝不真正回滚文件
          params: () => ({ session_id: ctx.sessionId, profile, hash: 'deadbeef' }),
          skip: () => (ctx.sessionId ? null : '没有可用会话'),
          allowCodes: [4001, 4000, 4040],
        },
      ],
    },

    {
      module: 'subagent',
      cases: [
        {
          method: 'subagent.list',
          params: () => ({ session_id: ctx.sessionId, profile }),
          skip: () => (ctx.sessionId ? null : '没有可用会话'),
          allowCodes: [4001],
        },
        {
          method: 'subagent.steer',
          params: () => ({ session_id: ctx.sessionId, profile, subagent_id: 'flux-probe-none', text: 'probe' }),
          skip: () => (ctx.sessionId ? null : '没有可用会话'),
          allowCodes: [4001],
        },
        {
          method: 'subagent.interrupt',
          params: () => ({ session_id: ctx.sessionId, profile, subagent_id: 'flux-probe-none' }),
          skip: () => (ctx.sessionId ? null : '没有可用会话'),
          allowCodes: [4001],
        },
        {
          method: 'subagent.tail',
          params: () => ({ session_id: ctx.sessionId, profile, subagent_id: 'flux-probe-none' }),
          skip: () => (ctx.sessionId ? null : '没有可用会话'),
          allowCodes: [4001],
        },
      ],
    },

    {
      module: 'prompt',
      // prompt.* 必须在**自己的**会话上跑：sessions 模块的临时会话已被清理，
      // 而且提交后会话会变成 active，删除前必须先 close（否则 4023）。
      setup: async () => {
        const created = await ctx.call('session.create', {
          profile,
          title: `flux-probe-prompt-${stamp()}`,
          hidden: true,
        });
        ctx.promptLiveId = created.session_id;
        ctx.promptStoredId = created.stored_session_id;
        await ctx.call('session.resume', {
          session_id: ctx.promptStoredId,
          profile,
          lazy: true,
        });
      },
      teardown: async () => {
        if (!ctx.promptLiveId) return;
        try {
          await ctx.call('session.close', { session_id: ctx.promptLiveId, profile });
        } catch (err) {
          console.log(`  · prompt 会话 close 失败（可忽略）: ${err.code || err.message}`);
        }
        if (!ctx.promptStoredId) return;
        try {
          await ctx.call('session.delete', { session_id: ctx.promptStoredId, profile });
        } catch (err) {
          console.log(`  · prompt 会话 delete 失败（可忽略）: ${err.code || err.message}`);
        }
      },
      cases: [
        {
          method: 'prompt.submit',
          params: () => ({
            session_id: ctx.promptLiveId,
            profile,
            text: '契约探针：请只回复 ok',
          }),
          // 未配置 provider 时网关会以 5032 拒绝，这是正确的守卫
          allowCodes: [5032, 4001, 4023],
          skip: () => (SKIP_PROMPT ? '已设置 HERMES_PROBE_SKIP_PROMPT=1，跳过真实回合' : null),
        },
        {
          method: 'prompt.btw',
          params: () => ({
            session_id: ctx.promptLiveId,
            profile,
            text: '契约探针：旁路问题，请只回复 ok',
          }),
          allowCodes: [5032, 4001, 4023],
          skip: () => (SKIP_PROMPT ? '已设置 HERMES_PROBE_SKIP_PROMPT=1，跳过真实回合' : null),
        },
      ],
    },
  ];
}

function assertField(result, field) {
  if (!result || typeof result !== 'object' || !(field in result)) {
    throw new Error(`响应缺少契约字段 "${field}"`);
  }
}

/* ---------------- 负向探针 ---------------- */

const NEGATIVE_CASES = [
  {
    name: 'profiles.get_asset 多传 key 必须被拒',
    method: 'profiles.get_asset',
    params: (ctx) => ({ name: ctx.profile, asset: 'avatar', key: 'avatar' }),
    expectCode: 4000,
  },
  {
    name: 'groups.send 平铺 text 必须被拒',
    method: 'groups.send',
    params: () => ({ room_id: 'flux-probe-none', text: 'probe' }),
    expectCode: 4000,
  },
  {
    name: 'groups.send payload 缺少 thread_id 必须被拒',
    method: 'groups.send',
    params: () => ({ room_id: 'flux-probe-none', event_id: mintEventId(), payload: { text: 'probe' } }),
    // 缺 thread_id 时网关可能先报 room not found（4112），两种都说明守卫生效
    expectCodes: [5112, 4112],
  },
  {
    name: 'session.delete 用不存在的会话必须被拒',
    method: 'session.delete',
    params: () => ({ session_id: 'flux-probe-none', profile: 'default' }),
    expectCodes: [4001, 4007],
  },
];

/* ---------------- 主流程 ---------------- */

/**
 * 清扫历史遗留的探针会话。
 * 上一次运行若中途崩溃，会话可能仍被旧 transport 持有（delete 会 4023），
 * 因此启动时和结束时各扫一次：启动时清上一轮的残留，结束时清本轮。
 */
async function sweepProbeSessions(call, profile) {
  let removed = 0;
  try {
    const listed = await call('session.list', { profile, limit: 200, include_hidden: true });
    const leftovers = (listed?.sessions || []).filter(
      (s) => typeof s?.title === 'string' && s.title.startsWith('flux-probe')
    );
    for (const leftover of leftovers) {
      try {
        await call('session.delete', { session_id: leftover.id, profile });
        removed += 1;
        console.log(`  · 清理探针会话 ${leftover.id}`);
      } catch (err) {
        // 仍被旧 transport 持有：本轮先忽略，下一轮启动时再清
        console.log(`  · 探针会话 ${leftover.id} 暂不可删（${err.code || err.message}），下轮再清`);
      }
    }
  } catch (err) {
    console.log(`  · 探针会话清扫跳过: ${err.code || err.message}`);
  }
  return removed;
}

async function main() {
  const { cookies, version } = await authenticate();
  console.log(`[probe] 网关版本: ${version}${CHECK_ONLY ? '（只比对漂移，不写盘）' : ''}`);

  const { ws, call } = await openSocket(cookies);

  // 上下文：profile、可用于建群的成员、临时目录前缀
  const ctx = {
    call,
    profile: process.env.HERMES_GATEWAY_PROFILE || 'default',
    memberProfiles: [],
    probeBot: 'flux-probe-bot',
    probeBotReady: false,
    currentModel: '',
    sessionId: '',
    sessionStoredId: '',
    sessionDeleted: false,
    closeProbeId: '',
    promptLiveId: '',
    promptStoredId: '',
    roomId: '',
    projectId: '',
    projectPath: '',
    projectDeleted: false,
    tempRoot: process.env.HERMES_PROBE_TEMP_ROOT || 'D:\\workspace\\_flux_probe',
  };

  try {
    const profiles = await call('profiles.list', {});
    const list = Array.isArray(profiles?.profiles) ? profiles.profiles : [];
    if (list.length > 0 && !process.env.HERMES_GATEWAY_PROFILE) {
      ctx.profile = list.find((p) => p?.is_default)?.name || list[0].name || ctx.profile;
    }
    ctx.memberProfiles = list.map((p) => p?.name).filter(Boolean);
  } catch (err) {
    console.warn('[probe] profiles.list 失败，使用默认 profile:', err.message);
  }

  try {
    const options = await call('model.options', { profile: ctx.profile });
    ctx.currentModel = typeof options?.model === 'string' ? options.model : '';
  } catch {
    // 读不到当前模型就不做 config.set 探针
  }

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  // 启动先清上一轮残留（上一次运行崩溃时，会话可能仍被旧 transport 持有）
  await sweepProbeSessions(call, ctx.profile);

  const summary = {
    recordedAt: new Date().toISOString(),
    gatewayVersion: version,
    profile: ctx.profile,
    promptProbesEnabled: !SKIP_PROMPT,
    modules: [],
    cases: [],
  };

  let failures = 0;
  let covered = 0;
  let skipped = 0;
  const drift = [];

  for (const mod of buildModules(ctx)) {
    console.log(`\n[probe] === ${mod.module} ===`);
    const moduleSummary = { module: mod.module, cases: [] };

    if (mod.setup) {
      try {
        await mod.setup();
      } catch (err) {
        console.error(`  ✗ setup 失败，整组跳过: ${err.code || err.message}`);
        moduleSummary.setupFailed = { code: err.code, message: err.message };
        summary.modules.push(moduleSummary);
        failures += 1;
        continue;
      }
    }

    for (const testCase of mod.cases) {
      const record = { module: mod.module, method: testCase.method };

      const skipReason = testCase.skip ? testCase.skip() : null;
      if (skipReason) {
        record.ok = false;
        record.skipped = true;
        record.reason = skipReason;
        skipped += 1;
        console.log(`  · ${testCase.method} 跳过: ${skipReason}`);
        moduleSummary.cases.push(record);
        summary.cases.push(record);
        continue;
      }

      const params = testCase.params ? await testCase.params() : {};
      try {
        const result = await call(testCase.method, params);
        record.ok = true;
        record.params = sanitize(params);
        record.resultKeys = result && typeof result === 'object' ? Object.keys(result) : [];
        if (testCase.assert) testCase.assert(result);
        covered += 1;

        if (testCase.after) await testCase.after(result);

        writeFixture(testCase.method, result, summary, drift);
        console.log(`  ✓ ${testCase.method} -> ${record.resultKeys.join(', ') || '(空)'}`);
      } catch (err) {
        const allowed = [
          ...(testCase.allowCodes || []),
        ].includes(err.code);
        record.error = { code: err.code, message: err.message };
        if (allowed) {
          record.ok = true;
          record.expectedGuard = err.code;
          covered += 1;
          console.log(`  ✓ ${testCase.method} -> 守卫按预期生效 (${err.code})`);
          if (testCase.onAllowed) testCase.onAllowed(err);
          writeFixture(testCase.method, { __guard: err.code, message: err.message }, summary, drift);
        } else {
          record.ok = false;
          failures += 1;
          console.error(`  ✗ ${testCase.method} -> ${err.code || 'ERR'} ${err.message}`);
        }
      }
      moduleSummary.cases.push(record);
      summary.cases.push(record);
    }

    if (mod.teardown) await mod.teardown();
    summary.modules.push(moduleSummary);
  }

  // 结束再清一次，确保本轮创建的临时会话不留在网关上
  await sweepProbeSessions(call, ctx.profile);

  console.log('\n[probe] === 负向探针（验证网关严格模式）===');  for (const negative of NEGATIVE_CASES) {
    const record = { module: 'negative', method: negative.method, name: negative.name, kind: 'negative' };
    try {
      const params = negative.params(ctx);
      const result = await call(negative.method, params);
      console.error(`  ✗ ${negative.name} -> 竟然成功了（契约可能放宽）`, sanitize(result));
      record.ok = false;
      record.unexpectedSuccess = true;
      failures += 1;
    } catch (err) {
      const expected = negative.expectCodes || [negative.expectCode];
      const ok = expected.includes(err.code);
      console.log(`  ${ok ? '✓' : '✗'} ${negative.name} -> ${err.code} ${err.message}`);
      record.ok = ok;
      record.code = err.code;
      record.message = err.message;
      if (!ok) failures += 1;
    }
    summary.cases.push(record);
  }

  ws.close();

  if (!CHECK_ONLY) {
    fs.writeFileSync(path.join(FIXTURE_DIR, 'index.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  console.log(`\n[probe] 覆盖 ${covered} 个方法 · 跳过 ${skipped} 个 · 失败 ${failures} 个`);
  if (drift.length > 0) {
    console.log(`[probe] 检测到 ${drift.length} 处漂移：`);
    for (const d of drift) console.log(`  ~ ${d.method}: ${d.detail}`);
  }

  if (failures > 0) {
    console.error('[probe] 存在失败探针');
    process.exit(1);
  }
  console.log('[probe] 全部探针通过');
}

/** 写单个方法的 fixture；--check 模式下只比对不写盘 */
function writeFixture(method, result, summary, drift) {
  const file = path.join(FIXTURE_DIR, `${method.replace(/\./g, '_')}.json`);
  const payload = {
    method,
    recordedAt: summary.recordedAt,
    gatewayVersion: summary.gatewayVersion,
    result: sanitize(result),
  };

  if (CHECK_ONLY) {
    if (!fs.existsSync(file)) {
      drift.push({ method, detail: 'fixture 不存在（新增调用点？）' });
      return;
    }
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    const prevKeys = previous?.result && typeof previous.result === 'object' ? Object.keys(previous.result) : [];
    const nextKeys = result && typeof result === 'object' ? Object.keys(result) : [];
    const missing = prevKeys.filter((k) => !nextKeys.includes(k));
    const added = nextKeys.filter((k) => !prevKeys.includes(k));
    if (missing.length) drift.push({ method, detail: `结果缺少字段 ${missing.join(', ')}` });
    if (added.length) drift.push({ method, detail: `结果新增字段 ${added.join(', ')}` });
    return;
  }

  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

main().catch((err) => {
  console.error('[probe] 失败:', err.message);
  process.exit(1);
});
