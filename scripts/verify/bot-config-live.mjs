/**
 * BOT 配置写入闭环的真实网关验证（只作用于探针 Bot，结束必恢复）。
 *
 * 【设计意图 (Why)】
 *   契约 fixture 与 UI 单测合起来仍有一处空白：**我们生成的参数喂给真网关后，
 *   是否真的写入、是否真的能读回**。第二期的五个段（描述 / SOUL / 模型 /
 *   Skill / 工具集）与头像资产都要在这条链路上验证一次，否则"保存成功"只是
 *   本地投影的自证。
 *
 * 【约束与规则 (Rules)】
 *   - 只对 HERMES_PROBE_TARGET（默认 flux-probe-bot）操作；结束恢复原值并清除头像；
 *   - 复用的是生产代码：ProfileService.describeBot / configureBot / setAsset 与
 *     core 的 buildBotConfigureParams / evaluateBotConfigureOutcome，
 *     不在脚本里重写一份 RPC 参数；
 *   - 任一段未按预期写入即非零退出（Failure Is Not Empty）；
 *   - 未配置 HERMES_GATEWAY_URL 时退出码 0 跳过。
 */
import http from 'node:http';
import {
  ProfileService,
  buildBotConfigureParams,
  draftFromDetail,
  evaluateBotConfigureOutcome,
} from '../../packages/core/dist/index.js';
import { normalizeAgentProfile } from '../../packages/core/dist/rpc/profileNormalize.js';

const BASE_URL = (process.env.HERMES_GATEWAY_URL || '').replace(/\/+$/, '');
const USER = process.env.HERMES_GATEWAY_USER || '';
const PASSWORD = process.env.HERMES_GATEWAY_PASSWORD || '';
const TARGET = process.env.HERMES_PROBE_TARGET || 'flux-probe-bot';

if (!BASE_URL) {
  console.log('[bot-config-live] HERMES_GATEWAY_URL 未设置，跳过真实写入验证（这是允许的）。');
  process.exit(0);
}

function request(pathname, { method = 'GET', body, headers = {} } = {}) {
  const url = new URL(pathname, BASE_URL);
  const payload = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          const cookieHeader = (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
          resolve({ status: res.statusCode, cookieHeader, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 建立 JSON-RPC bridge：既实现 IRpcCaller，也让脚本能直接跑清理用的裸 RPC。 */
async function openBridge() {
  const statusRes = await request('/api/status');
  let status = {};
  try {
    status = JSON.parse(statusRes.text);
  } catch {
    /* 非 JSON 状态响应按免密网关处理 */
  }

  let cookieHeader = '';
  let loopbackToken = '';
  if (status.auth_required) {
    if (!USER || !PASSWORD) throw new Error('网关要求认证，但未设置 HERMES_GATEWAY_USER / HERMES_GATEWAY_PASSWORD');
    const login = await request('/auth/password-login', {
      method: 'POST',
      body: { provider: 'basic', username: USER, password: PASSWORD },
    });
    if (login.status !== 200) throw new Error(`登录失败 HTTP ${login.status}`);
    cookieHeader = login.cookieHeader;
  } else {
    const home = await request('/');
    const match = /__HERMES_SESSION_TOKEN__\s*=\s*["']([^"']+)["']/.exec(home.text || '');
    loopbackToken = match ? match[1] : '';
  }

  const ticketRes = await request('/api/auth/ws-ticket', { method: 'POST', headers: { Cookie: cookieHeader } });
  let ticket = '';
  try {
    ticket = JSON.parse(ticketRes.text).ticket || '';
  } catch {
    /* ignore */
  }

  const wsUrl = new URL('/api/ws', BASE_URL);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  if (ticket) wsUrl.searchParams.set('ticket', ticket);
  else if (loopbackToken) wsUrl.searchParams.set('token', loopbackToken);

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

  return { ws, call, bridge: { request: call }, version: status.version || 'unknown' };
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const { ws, call, bridge, version } = await openBridge();
const profileService = new ProfileService();
const results = [];

try {
  /* ---------- 0. 基线：读回权威详情，作为恢复依据 ---------- */
  const list = await call('profiles.list', {});
  const rows = (Array.isArray(list?.profiles) ? list.profiles : []).map((row) => normalizeAgentProfile(row));
  const row = rows.find((item) => item.name === TARGET);
  assert(row, `目标 BOT 不存在：${TARGET}`);

  const hint = {
    displayName: row.displayName,
    avatar: row.avatar || undefined,
    isDefault: row.isDefault,
  };
  const before = await profileService.describeBot(TARGET, bridge, hint);
  console.log('[baseline]', JSON.stringify({
    gateway: version,
    id: before.id,
    model: before.model,
    provider: before.provider,
    soulBytes: new TextEncoder().encode(before.soul).length,
    skills: before.skills.rows.length,
    disabledSkills: before.skills.rows.filter((r) => !r.enabled).map((r) => r.id),
    toolsets: before.toolsets.rows.length,
    mcpServers: before.mcpServers.rows.length,
  }));

  /* ---------- 1. 第二期五段一次性写入（走生产 buildBotConfigureParams） ---------- */
  const base = draftFromDetail(before);
  const marker = Date.now().toString(36);
  const targetModel = before.model || '';
  const firstToolset = before.toolsets.rows[0]?.id;
  // `hermes-agent` 是内置技能，网关拒绝禁用（实测 applied.skills=true 但读回仍启用），
  // 闭环验证必须挑一个真实可禁用的用户技能。
  const firstSkill = before.skills.rows.find((r) => r.enabled && r.id !== 'hermes-agent')?.id;

  const draft = {
    ...base,
    description: `flux 第二期闭环验证 ${marker}`,
    soul: `# 闭环验证\n\n- SOUL 写入标记：${marker}\n- 该文本应在保存后原样读回。\n`,
    // 模型保持不变：切换会真的改掉该 BOT 的执行模型，验证"未改动就不提交"更安全。
    // 能力清单只动一项，随后整包恢复。
    disabledSkills: firstSkill ? [...new Set([...base.disabledSkills, firstSkill])] : [...base.disabledSkills],
    enabledToolsets: firstToolset
      ? base.enabledToolsets.filter((id) => id !== firstToolset)
      : [...base.enabledToolsets],
  };

  const params = buildBotConfigureParams(before, draft, row.uiMeta);
  assert(params, '草稿与权威快照无差异，闭环验证无意义');
  const outcome = evaluateBotConfigureOutcome(params, await profileService.configureBot(params, bridge));
  assert(outcome.ok, `configure 判定失败：${JSON.stringify(outcome)}`);
  results.push({ segment: 'configure', requested: Object.keys(params).filter((k) => k !== 'name') });

  /* ---------- 2. 头像资产：上传 → 读回 → 清除 ---------- */
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const uploaded = await profileService.setAsset(TARGET, 'avatar', png, bridge, { clear: false });
  assert(uploaded, '头像上传失败');
  const fetched = await profileService.getAsset(TARGET, 'avatar', bridge);
  assert(typeof fetched === 'string' && fetched.startsWith('data:image/png'), '头像上传后读不回 PNG 资产');
  const cleared = await profileService.setAsset(TARGET, 'avatar', '', bridge, { clear: true });
  assert(cleared, '头像清除失败');
  const clearedFetched = await profileService.getAsset(TARGET, 'avatar', bridge);
  assert(clearedFetched === null, '头像清除后仍能读到资产，clear 语义未生效');
  results.push({ segment: 'asset', upload: true, readBack: true, clear: true });

  /* ---------- 3. 回读：五段必须与草稿一致 ---------- */
  const after = await profileService.describeBot(TARGET, bridge, hint);
  assert(after.description === draft.description, `描述未写入：${JSON.stringify(after.description)}`);
  assert(after.soul === draft.soul, 'SOUL 未原样写入');

  const disabledAfter = after.skills.rows.filter((r) => !r.enabled).map((r) => r.id).sort();
  if (firstSkill) {
    assert(
      disabledAfter.includes(firstSkill),
      `Skill 未写入：期望 ${firstSkill} 被禁用，实际 ${JSON.stringify(disabledAfter)}`,
    );
  }
  const enabledToolsetsAfter = after.toolsets.rows.filter((r) => r.enabled).map((r) => r.id);
  if (firstToolset) {
    assert(
      !enabledToolsetsAfter.includes(firstToolset),
      `工具集未写入：期望 ${firstToolset} 被关闭`,
    );
  }
  assert(after.model === targetModel, `模型被意外改动：${after.model}`);
  results.push({
    segment: 'readback',
    description: true,
    soul: true,
    skills: Boolean(firstSkill),
    toolsets: Boolean(firstToolset),
    modelUntouched: true,
  });

  // 读回后重新派生草稿不应再产生任何差异（否则本地投影与网关真值不一致）。
  assert(
    buildBotConfigureParams(after, draftFromDetail(after), row.uiMeta) === null,
    '回读后仍与自身存在差异，本地投影与网关真值不一致',
  );
  results.push({ segment: 'self-consistent' });

  /* ---------- 4. 恢复：把描述 / SOUL / 能力清单写回基线 ---------- */
  const restoreDraft = draftFromDetail(before);
  const restoreParams = buildBotConfigureParams(after, restoreDraft, row.uiMeta);
  if (restoreParams) {
    const restoreOutcome = evaluateBotConfigureOutcome(restoreParams, await profileService.configureBot(restoreParams, bridge));
    assert(restoreOutcome.ok, `恢复失败：${JSON.stringify(restoreOutcome)}`);
  }
  const restored = await profileService.describeBot(TARGET, bridge, hint);
  assert(restored.description === before.description, '描述未恢复');
  assert(restored.soul === before.soul, 'SOUL 未恢复');
  results.push({ segment: 'restore', description: true, soul: true });

  console.log(JSON.stringify({ gateway: version, profile: TARGET, results }, null, 2));
} catch (error) {
  console.error('[bot-config-live] 失败：', error.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
