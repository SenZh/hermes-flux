/**
 * Hermes Gateway JSON-RPC 2.0 WebSocket Client
 */

import { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, NormalizedSession, ModelDetail, AgentProfile } from './types.js';
import { WebSocketFsm, FsmState } from './fsm.js';
import { normalizeSessionsResult, extractAvailableModels, extractModelDetails } from '../models/types.js';

export interface RpcClientOptions {
  url: string;
  timeoutMs?: number;
  autoConnect?: boolean;
}

export type RestFallbackHandler = (path: string, options?: any) => Promise<any>;

/** Result of a session listing attempt, including why it failed when it did. */
export interface SessionListOutcome {
  sessions: NormalizedSession[];
  ok: boolean;
  error?: string;
}

/** Models plus the provider that owns the currently active one. */
export interface ModelCatalog {
  models: string[];
  details: ModelDetail[];
  currentModel: string;
  currentProvider: string;
  ok: boolean;
  error?: string;
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; code?: unknown; data?: unknown };
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message;
    }
    if (typeof candidate.code !== 'undefined') {
      return `RPC 错误 ${String(candidate.code)}`;
    }
  }
  return typeof error === 'string' ? error : '未知错误';
}

export class HermesGatewayClient {
  private url: string;
  private timeoutMs: number;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private restFallbackHandler: RestFallbackHandler | null = null;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (result: unknown) => void;
      reject: (error: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private fsm: WebSocketFsm;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(options: RpcClientOptions) {
    this.url = options.url;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fsm = new WebSocketFsm();

    if (options.autoConnect) {
      this.connect();
    }
  }

  public setRestFallbackHandler(handler: RestFallbackHandler | null): void {
    this.restFallbackHandler = handler;
  }

  public getRawWebSocket(): WebSocket | null {
    return this.ws;
  }


  public getFsm(): WebSocketFsm {
    return this.fsm;
  }

  public getState(): FsmState {
    return this.fsm.getState();
  }

  public connect(): void {
    if (typeof WebSocket === 'undefined') {
      console.warn('[HermesGatewayClient] WebSocket runtime is unavailable');
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;
    this.fsm.transitionTo('CONNECTING');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.fsm.transitionTo('HANDSHAKING');
        // Perform fast handshake ping
        this.call('system.ping', { timestamp: Date.now() })
          .then(() => {
            this.fsm.transitionTo('CONNECTED');
          })
          .catch(() => {
            // Even if ping is not directly supported, connection opened
            this.fsm.transitionTo('CONNECTED');
          });
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (err) => {
        console.warn('[HermesGatewayClient] WebSocket error:', err);
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        } else {
          this.fsm.transitionTo('DISCONNECTED');
        }
      };
    } catch (err) {
      console.error('[HermesGatewayClient] Failed to instantiate WebSocket:', err);
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.fsm.transitionTo('DISCONNECTED');
  }

  private scheduleReconnect(): void {
    this.fsm.transitionTo('RECONNECTING');
    const delay = this.fsm.getNextBackoffMs();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  public call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error(`WebSocket is not connected (current state: ${this.fsm.getState()})`));
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC request '${method}' with id ${id} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      this.ws.send(JSON.stringify(request));
    });
  }

  public onNotification<T = unknown>(method: string, handler: (params: T) => void): () => void {
    if (!this.notificationHandlers.has(method)) {
      this.notificationHandlers.set(method, new Set());
    }
    const handlers = this.notificationHandlers.get(method)!;
    handlers.add(handler as (params: unknown) => void);

    return () => {
      handlers.delete(handler as (params: unknown) => void);
    };
  }

  /**
   * Resilient dual-channel session listing that keeps the failure reason.
   *
   * "No sessions" and "the gateway refused to list them" are different facts; the
   * rail must be able to tell them apart instead of rendering an empty list for
   * both.
   */
  public async listSessions(profile = 'default', limit = 50): Promise<SessionListOutcome> {
    let lastError: string | undefined;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const wsResult = await this.call<unknown>('session.list', { profile, limit });
        const sessions = normalizeSessionsResult(wsResult);
        // An empty list is a legitimate answer when the gateway replied at all.
        if (sessions.length > 0 || !this.restFallbackHandler) {
          return { sessions, ok: true };
        }
      } catch (wsErr) {
        lastError = describeError(wsErr);
        console.warn('[HermesGatewayClient] WS session.list failed, trying REST fallback:', lastError);
      }
    } else {
      lastError = `WebSocket 未连接 (当前状态: ${this.fsm.getState()})`;
    }

    if (this.restFallbackHandler) {
      try {
        const restResult = await this.restFallbackHandler('/api/sessions', {
          method: 'GET',
          params: { profile, limit },
        });
        return { sessions: normalizeSessionsResult(restResult), ok: true };
      } catch (restErr) {
        lastError = describeError(restErr);
        console.warn('[HermesGatewayClient] REST session fallback also failed:', lastError);
      }
    }

    return { sessions: [], ok: false, error: lastError ?? '网关未返回会话列表' };
  }

  /**
   * Session listing without diagnostics. Prefer `listSessions` when the caller
   * needs to distinguish an empty result from a failed one.
   */
  public async listSessionsSafe(profile = 'default', limit = 50): Promise<NormalizedSession[]> {
    const outcome = await this.listSessions(profile, limit);
    return outcome.sessions;
  }

  /**
   * Resilient session messages pagination via official high-speed REST channel.
   * 
   * 【设计意图 (Why)】
   * 遵循 Hermes Agent 官方协议矩阵（docs/architecture/gateway-api-and-features-matrix.md）。
   * 网关 session.resume 在超大会话下无分页且耗时高达 6~7 秒，官方专门开放了高速 REST 消息游标/分页接口。
   * 
   * 【防范的历史坑 (Pitfall)】
   * 1. 严禁上层业务直接用浏览器裸 fetch 跨层调用（file:// 协议会剥离 Cookie 导致 401）；
   * 2. 严禁传 order='newest' 或 order='desc'（网关 Pydantic 校验严格，非法值直接返回 400）；
   * 3. 必须通过 restFallbackHandler 转接宿主代理通道，统一注入鉴权凭证。
   * 
   * 【规则 (Rules)】
   * order 只能取 'latest' 或 'oldest'；首屏必须限制在 50 条以内实现 30ms 极速加载。
   */
  public async fetchSessionMessages(
    sessionId: string,
    options: { limit?: number; offset?: number; order?: 'latest' | 'oldest' } = {}
  ): Promise<{ messages: any[]; pagination?: any; ok: boolean; error?: string }> {
    if (!this.restFallbackHandler) {
      return { messages: [], ok: false, error: '未注入 REST 通信代理处理器' };
    }

    try {
      const res = await this.restFallbackHandler(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: 'GET',
          params: {
            limit: options.limit ?? 50,
            offset: options.offset ?? 0,
            order: options.order ?? 'latest',
          },
        }
      );

      const messages = Array.isArray(res?.messages) ? res.messages : [];
      return {
        messages,
        pagination: res?.pagination,
        ok: true,
      };
    } catch (err) {
      const errorMsg = describeError(err);
      return { messages: [], ok: false, error: errorMsg };
    }
  }

  /**
   * Resilient model catalog extraction.
   *
   * `model.options` answers `{ model, provider, providers: [{ slug, models }] }`.
   * Both the flattened model list and the provider that owns the active model are
   * kept, because `config.set` rejects a model id that several providers declare.
   */
  public async getModelCatalog(profile = 'default', fallbackModels: string[] = []): Promise<ModelCatalog> {
    let lastError: string | undefined;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const res = await this.call<any>('model.options', { profile });
        const models = extractAvailableModels(res, []);
        const details = extractModelDetails(res);
        if (models.length > 0) {
          return {
            models,
            details,
            currentModel: typeof res?.model === 'string' ? res.model : '',
            currentProvider: typeof res?.provider === 'string' ? res.provider : '',
            ok: true,
          };
        }
        lastError = '网关返回的模型列表为空';
      } catch (wsErr) {
        lastError = describeError(wsErr);
        console.warn('[HermesGatewayClient] WS model.options failed, trying REST fallback:', lastError);
      }
    } else {
      lastError = `WebSocket 未连接 (当前状态: ${this.fsm.getState()})`;
    }

    if (this.restFallbackHandler) {
      try {
        const restResult = await this.restFallbackHandler('/api/models', {
          method: 'GET',
          params: { profile },
        });
        const models = extractAvailableModels(restResult, []);
        const details = extractModelDetails(restResult);
        if (models.length > 0) {
          return {
            models,
            details,
            currentModel: typeof restResult?.model === 'string' ? restResult.model : '',
            currentProvider: typeof restResult?.provider === 'string' ? restResult.provider : '',
            ok: true,
          };
        }
        lastError = 'REST 模型接口返回为空';
      } catch (restErr) {
        lastError = describeError(restErr);
        console.warn('[HermesGatewayClient] REST model fallback also failed:', lastError);
      }
    }

    return {
      models: extractAvailableModels(null, fallbackModels),
      details: [],
      currentModel: '',
      currentProvider: '',
      ok: false,
      error: lastError ?? '网关未返回模型列表',
    };
  }

  /**
   * Model list without diagnostics. Prefer `getModelCatalog` when the caller needs
   * the active provider or the failure reason.
   */
  public async getModelOptionsSafe(profile = 'default', fallbackModels: string[] = []): Promise<string[]> {
    const catalog = await this.getModelCatalog(profile, fallbackModels);
    return catalog.models;
  }

  /**
   * Fetches agent profiles configured on the gateway.
   */
  public async listProfiles(): Promise<AgentProfile[]> {
    try {
      const res = await this.call<any>('profiles.list', {});
      const list = Array.isArray(res) ? res : Array.isArray(res?.profiles) ? res.profiles : [];
      return list.map((item: any) => ({
        name: String(item.name || item.id || 'default'),
        displayName: String(item.display_name || item.title || item.name || '默认 Agent'),
        description: typeof item.description === 'string' ? item.description : '',
        avatar: typeof item.avatar === 'string' ? item.avatar : '',
        model: typeof item.model === 'string' ? item.model : '',
        isDefault: Boolean(item.is_default || item.name === 'default'),
      }));
    } catch (e) {
      console.warn('[HermesGatewayClient] profiles.list failed, returning default profile:', e);
      return [
        { name: 'default', displayName: '通用助手 (Default)', description: '默认通用智能体', isDefault: true },
      ];
    }
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    try {
      const data = JSON.parse(raw);
      if (typeof data.id !== 'undefined' && this.pendingRequests.has(data.id)) {
        // RPC Response
        const pending = this.pendingRequests.get(data.id)!;
        this.pendingRequests.delete(data.id);
        clearTimeout(pending.timer);

        if (data.error) {
          pending.reject(data.error);
        } else {
          pending.resolve(data.result);
        }
      } else if (data.method) {
        // RPC Notification or Server Event
        const handlers = this.notificationHandlers.get(data.method);
        if (handlers) {
          handlers.forEach((fn) => fn(data.params));
        }
      }
    } catch (e) {
      console.warn('[HermesGatewayClient] JSON parse error on message:', e);
    }
  }
}
