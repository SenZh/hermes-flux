/**
 * 提供商管理 REST 适配器（自定义端点 / 订阅账号）。
 *
 * 【设计意图 (Why)】
 *   自定义端点的增删改查与订阅登录态只存在于网关 REST，不在 JSON-RPC 契约里。
 *   把 URL 拼接、profile 作用域、错误归一收在一个文件里，控制器与视图都不再碰路径字符串。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 主进程 httpProxy 过去遇到非 2xx 只抛 `HTTP 400`，网关返回的 `detail`
 *      （"base_url must include scheme and host"、"The endpoint rejected the API key."）
 *      全部丢失，用户只能看到状态码。本模块负责把 detail 还原成可读消息。
 *   2. 自定义端点 id 在 URL 里必须 encode，`Local 8000` 这类带空格的 id 不编码会 404。
 *   3. 忘传 `profile` 会写到网关进程的默认 profile，用户以为在配这个 Bot，实际改了 default。
 *
 * 【约束与规则 (Rules)】
 *   1. 本模块零 React、零 DOM，只依赖注入的 proxy 与 baseUrl/ticket 读取器；
 *   2. 每个方法必须显式带 `profile`，禁止依赖宿主默认值；
 *   3. 错误一律抛 `ProviderAdminError`，由控制器转成行级文案，不吞。
 */

import {
  normalizeCustomEndpoints,
  normalizeOauthProviders,
  normalizeProbe,
  type CustomEndpointPayload,
  type CustomEndpointRow,
  type EndpointProbe,
  type OauthProviderRow,
} from '@hermes-flux/core';

export interface ProviderAdminProxyOptions {
  baseUrl: string;
  path: string;
  method?: string;
  ticket?: string;
  params?: Record<string, string | number | boolean>;
  body?: unknown;
}

export interface ProviderAdminRestDeps {
  baseUrl(): string;
  ticket(): string;
  proxy(options: ProviderAdminProxyOptions): Promise<unknown>;
}

export class ProviderAdminError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail || `HTTP ${status}`);
    this.name = 'ProviderAdminError';
    this.status = status;
    this.detail = detail;
  }
}

/** 把主进程抛出的 `HTTP 400: detail` 还原成结构化错误。 */
export function describeProviderAdminError(error: unknown): { status: number; message: string } {
  if (error instanceof ProviderAdminError) return { status: error.status, message: error.detail };
  const text = error instanceof Error ? error.message : String(error);
  // Electron 会把 IPC 拒绝包成 `Error invoking remote method '...': Error: HTTP 400: detail`，
  // 因此不能锚定行首，必须在任意位置找到 `HTTP <code>`。
  const match = /\bHTTP\s+(\d{3})\b[:\s]*([\s\S]*)$/.exec(text.trim());
  if (match) return { status: Number(match[1]), message: match[2].trim() };
  return { status: 0, message: text };
}

export interface ProviderAdminRest {
  listEndpoints(profile: string): Promise<CustomEndpointRow[]>;
  saveEndpoint(profile: string, payload: CustomEndpointPayload): Promise<{ endpoints: CustomEndpointRow[]; id: string }>;
  probeEndpoint(payload: CustomEndpointPayload): Promise<EndpointProbe>;
  activateEndpoint(profile: string, id: string): Promise<{ provider: string; model: string }>;
  /** 通用主模型切换：订阅与自定义端点共用，必须点名一个具体模型。 */
  setMainModel(profile: string, assignment: MainModelAssignment): Promise<MainModelResult>;
  /** 读取某一 profile 的单个环境变量明文，仅用于把已有密钥复制到另一个成员。 */
  revealEnv(profile: string, key: string): Promise<string>;
  deleteEndpoint(profile: string, id: string): Promise<CustomEndpointRow[]>;
  listOauthProviders(profile: string): Promise<OauthProviderRow[]>;
  startOauthLogin(profile: string, id: string): Promise<OauthLoginSession>;
  pollOauthLogin(profile: string, id: string, sessionId: string): Promise<OauthLoginPoll>;
  cancelOauthLogin(profile: string, sessionId: string): Promise<void>;
  disconnectOauth(profile: string, id: string): Promise<void>;
}

/** `POST /api/model/set` 的主模型赋值。`base_url` 只对自定义端点需要。 */
export interface MainModelAssignment {
  provider: string;
  model: string;
  baseUrl?: string;
  /** 网关对高价模型要求二次确认；第一轮不传，拿到警告后由用户确认再传 true。 */
  confirmExpensive?: boolean;
}

/** 主模型切换结果。`confirmRequired` 时**没有落盘**，必须让用户确认后重发。 */
export interface MainModelResult {
  provider: string;
  model: string;
  confirmRequired: boolean;
  confirmMessage?: string;
}

/** 从网关响应里安全取字符串字段，不做裸断言。 */
function readStringField(payload: unknown, key: string): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export function createProviderAdminRest(deps: ProviderAdminRestDeps): ProviderAdminRest {
  async function call(path: string, options: { method?: string; params?: Record<string, string | number | boolean>; body?: unknown } = {}): Promise<unknown> {
    try {
      return await deps.proxy({
        baseUrl: deps.baseUrl(),
        path,
        method: options.method ?? 'GET',
        ticket: deps.ticket(),
        params: options.params,
        body: options.body,
      });
    } catch (error) {
      const { status, message } = describeProviderAdminError(error);
      throw new ProviderAdminError(status, message);
    }
  }

  return {
    async listEndpoints(profile: string): Promise<CustomEndpointRow[]> {
      const payload = await call('/api/providers/custom-endpoints', { params: { profile } });
      return normalizeCustomEndpoints(payload);
    },

    async saveEndpoint(profile: string, payload: CustomEndpointPayload): Promise<{ endpoints: CustomEndpointRow[]; id: string }> {
      const response = await call('/api/providers/custom-endpoints', { method: 'POST', params: { profile }, body: payload });
      return {
        endpoints: normalizeCustomEndpoints(response),
        id: readStringField(response, 'id') || payload.id,
      };
    },

    async probeEndpoint(payload: CustomEndpointPayload): Promise<EndpointProbe> {
      // 探测不落盘，因此不带 profile：它只探用户正在编辑的这个地址。
      const response = await call('/api/providers/custom-endpoints/validate', { method: 'POST', body: payload });
      return normalizeProbe(response);
    },

    async activateEndpoint(profile: string, id: string): Promise<{ provider: string; model: string }> {
      const response = await call(`/api/providers/custom-endpoints/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
        params: { profile },
      });
      return {
        provider: readStringField(response, 'provider') || id,
        model: readStringField(response, 'model'),
      };
    },

    /**
     * 通用主模型切换。
     * 【为什么不用 activate 端点接口】`custom-endpoints/{id}/activate` 只认自定义端点，
     *   订阅（xai-oauth / nous 等）走它必然 404，于是"设为默认"对订阅永远无效。
     *   `/api/model/set` 是网关唯一通用的主模型入口，订阅与端点都走它。
     * 【约束】`provider` 必须是网关内部的 provider id（自定义端点即端点 id），
     *   `model` 必填——网关对空模型直接 400。
     * 【防范的历史坑】高价模型网关会回 `confirm_required` 且**不落盘**；
     *   当成成功处理会让用户以为切了，实际主模型没变。
     */
    async setMainModel(profile: string, assignment: MainModelAssignment): Promise<MainModelResult> {
      const response = await call('/api/model/set', {
        method: 'POST',
        params: { profile },
        body: {
          scope: 'main',
          provider: assignment.provider,
          model: assignment.model,
          ...(assignment.baseUrl ? { base_url: assignment.baseUrl } : {}),
          ...(assignment.confirmExpensive ? { confirm_expensive_model: true } : {}),
        },
      });
      const confirmRequired = readBooleanField(response, 'confirm_required');
      return {
        provider: readStringField(response, 'provider') || assignment.provider,
        model: readStringField(response, 'model') || assignment.model,
        confirmRequired,
        confirmMessage: readStringField(response, 'confirm_message') || undefined,
      };
    },

    async deleteEndpoint(profile: string, id: string): Promise<CustomEndpointRow[]> {
      const response = await call(`/api/providers/custom-endpoints/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        params: { profile },
      });
      return normalizeCustomEndpoints(response);
    },

    /**
     * 读取某个 profile 的单个环境变量明文。
     *
     * 【设计意图 (Why)】
     *   取消一个 Agent 的绑定会连同它的 `.env` 密钥一起删掉；再勾回来时定义还能从
     *   端点行还原，密钥却已不在该 profile 上。逐个成员重新输入纯属重复劳动。
     *   网关给自定义端点写入的是 `key_env`（GET 以 `${VAR}` 预览），只要另一个成员
     *   还持有同一条端点，就能按同一个变量名把明文读出来再写回目标成员。
     *
     * 【约束与规则 (Rules)】
     *   1. 明文只在内存里中转，绝不落盘、绝不进日志、绝不回显；
     *   2. 调用方必须显式给出源 profile，禁止把"当前 profile"当默认值猜；
     *   3. 网关对不存在或不可读的变量回 404，由上层降级为"让用户手填"。
     */
    async revealEnv(profile: string, key: string): Promise<string> {
      const response = await call('/api/env/reveal', {
        method: 'POST',
        body: { key, profile },
      });
      return readStringField(response, 'value');
    },

    async listOauthProviders(profile: string): Promise<OauthProviderRow[]> {
      const payload = await call('/api/providers/oauth', { params: { profile } });
      return normalizeOauthProviders(payload);
    },

    /**
     * 发起订阅登录（设备码）。
     * 【约束】必须带 `profile`：登录态是按 profile 分开落的（实测 default 读
     *   /opt/data/auth.json，其余读 /opt/data/profiles/<name>/auth.json），
     *   漏传会把令牌签进网关进程的默认 profile。
     */
    async startOauthLogin(profile: string, id: string): Promise<OauthLoginSession> {
      const response = await call(`/api/providers/oauth/${encodeURIComponent(id)}/start`, {
        method: 'POST',
        params: { profile },
      });
      return normalizeOauthLoginSession(response);
    },

    /** 轮询一次登录会话。不做长轮询：界面自己按间隔来，避免占住一条挂起请求。 */
    async pollOauthLogin(profile: string, id: string, sessionId: string): Promise<OauthLoginPoll> {
      const response = await call(
        `/api/providers/oauth/${encodeURIComponent(id)}/poll/${encodeURIComponent(sessionId)}`,
        { params: { profile } },
      );
      return normalizeOauthLoginPoll(response);
    },

    /** 取消登录会话。幂等：会话已过期时网关回 404，这里视为已取消。 */
    async cancelOauthLogin(profile: string, sessionId: string): Promise<void> {
      try {
        await call(`/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          params: { profile },
        });
      } catch (error) {
        const { status } = describeProviderAdminError(error);
        // 404 = 会话已过期或已被回收，目标状态（没有活跃会话）已经成立。
        if (status !== 404) throw error;
      }
    },

    /** 断开订阅。网关对不可自动断开的提供商回 400 并带手动做法，原样透出。 */
    async disconnectOauth(profile: string, id: string): Promise<void> {
      await call(`/api/providers/oauth/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        params: { profile },
      });
    },
  };
}

/** 设备码登录会话的展示字段。`external` 类 flow 拿不到会话，只有命令行。 */
export interface OauthLoginSession {
  sessionId: string;
  flow: string;
  userCode?: string;
  verificationUrl?: string;
  expiresIn?: number;
  pollInterval?: number;
  /** external flow 未启动会话时，网关给的手动命令。 */
  cliCommand?: string;
  /** 网关直接拒绝时的原因（未知 provider / external flow）。 */
  message?: string;
  ok: boolean;
}

/**
 * 登录会话轮询结果。
 * 【规则】`pending` 不是失败；`approved` 才是成功；其余一律带原因。
 */
export interface OauthLoginPoll {
  status: 'pending' | 'approved' | 'failed' | 'cancelled';
  message?: string;
  accountEmail?: string;
  model?: string;
}

function normalizeOauthLoginSession(payload: unknown): OauthLoginSession {
  const sessionId = readStringField(payload, 'session_id');
  const userCode = readStringField(payload, 'user_code');
  const verificationUrl = readStringField(payload, 'verification_url');
  const flow = readStringField(payload, 'flow');
  const expiresIn = readNumberField(payload, 'expires_in');
  const pollInterval = readNumberField(payload, 'poll_interval');
  if (!sessionId) {
    // 没有 session_id 说明网关没有真的开一条登录会话（例如 external flow），
    // 这不是成功，必须如实标成失败并把原因带出去。
    return {
      sessionId: '',
      flow,
      cliCommand: readStringField(payload, 'cli_command') || undefined,
      message: readStringField(payload, 'detail') || '',
      ok: false,
    };
  }
  return {
    sessionId,
    flow: flow || 'device_code',
    userCode: userCode || undefined,
    verificationUrl: verificationUrl || undefined,
    expiresIn: expiresIn ?? undefined,
    pollInterval: pollInterval ?? undefined,
    ok: true,
  };
}

function normalizeOauthLoginPoll(payload: unknown): OauthLoginPoll {
  const raw = readStringField(payload, 'status');
  const status =
    raw === 'approved' || raw === 'failed' || raw === 'cancelled' ? raw : 'pending';
  return {
    status,
    message: readStringField(payload, 'error_message') || undefined,
    accountEmail: readStringField(payload, 'account_email') || undefined,
    model: readStringField(payload, 'model') || undefined,
  };
}

function readNumberField(payload: unknown, key: string): number | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBooleanField(payload: unknown, key: string): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return (payload as Record<string, unknown>)[key] === true;
}
