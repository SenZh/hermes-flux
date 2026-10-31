/**
 * Hermes Gateway JSON-RPC 2.0 WebSocket Client
 */

import { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, NormalizedSession, ModelDetail, AgentProfile } from './types.js';
import { WebSocketFsm, FsmState } from './fsm.js';
import { normalizeSessionsResult, extractAvailableModels, extractModelDetails } from '../models/types.js';

export interface RpcClientOptions {
  url: string;
  /** 候选连接地址池，直连失败或重连时支持按优先级自动轮转（如 [LAN直连, Relay中继]） */
  candidateUrls?: string[];
  timeoutMs?: number;
  autoConnect?: boolean;
  /** 是否启用周期性心跳探测看门狗（默认开启） */
  enableHeartbeat?: boolean;
  /** 心跳探测周期（毫秒，默认 15000ms） */
  heartbeatIntervalMs?: number;
  /** 心跳超时判定阈值（毫秒，默认 5000ms） */
  heartbeatTimeoutMs?: number;
  /** 是否监听移动端/浏览器前后台可见性与网络状态实现即刻唤醒自愈（默认开启） */
  enableLifecycleWake?: boolean;
}

export interface RestFallbackOptions {
  method?: string;
  params?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

export type RestFallbackHandler = (path: string, options?: RestFallbackOptions) => Promise<unknown>;

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
  private candidateUrls: string[] = [];
  private currentCandidateIndex = 0;
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

  // 心跳看门狗状态
  private enableHeartbeat: boolean;
  private heartbeatIntervalMs: number;
  private heartbeatTimeoutMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // 移动端/跨端前后台生命周期唤醒
  private enableLifecycleWake: boolean;
  private visibilityListener: (() => void) | null = null;
  private onlineListener: (() => void) | null = null;

  constructor(options: RpcClientOptions) {
    this.url = options.url;
    this.candidateUrls = options.candidateUrls && options.candidateUrls.length > 0
      ? [...options.candidateUrls]
      : [options.url];
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.enableHeartbeat = options.enableHeartbeat ?? true;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 5000;
    this.enableLifecycleWake = options.enableLifecycleWake ?? true;

    this.fsm = new WebSocketFsm({
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      heartbeatTimeoutMs: this.heartbeatTimeoutMs,
    });

    this.setupLifecycleListeners();

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

  public getActiveUrl(): string {
    return this.url;
  }

  public getCandidateUrls(): string[] {
    return [...this.candidateUrls];
  }

  /**
   * 设计意图 (Why):
   *   在移动端或弱网环境下，长连接容易因网络抖动发生直连超时，
   *   通过在重连阶段轮换候选地址（如 [LAN直连, Relay中继]），提供多级网络冗余兜底。
   *
   * 防范的历史坑 (Pitfall):
   *   若单一死守失效的 LAN IP（如离开了工位 Wi-Fi），重连只会死循环超时直至用户手动重启。
   *
   * 约束与规则 (Rules):
   *   - 仅在配置了多于 1 个候选地址时进行循环轮转；
   *   - 轮换后立即更新 this.url 为当前候选。
   */
  public rotateCandidate(): string {
    if (this.candidateUrls.length <= 1) return this.url;
    this.currentCandidateIndex = (this.currentCandidateIndex + 1) % this.candidateUrls.length;
    this.url = this.candidateUrls[this.currentCandidateIndex];
    return this.url;
  }

  /**
   * 设计意图 (Why):
   *   注册移动端/Web 浏览器生命周期事件监听（visibilitychange 和 online）。
   *   当 App 从后台切到前台或网络断开恢复时，触发毫秒级即刻唤醒重连。
   *
   * 防范的历史坑 (Pitfall):
   *   移动操作系统（iOS/Android）在 App 切后台或锁屏时会强行冻结或掐断 WebSocket 连接。
   *   若依赖原生 Exponential Backoff，用户重新打开 App 经常需要干等 10~30 秒才能恢复连接。
   *
   * 约束与规则 (Rules):
   *   - 兼容非 DOM/Node.js 运行环境（安全校验 typeof document !== 'undefined'）；
   *   - 必须保存 listener 引用以便在 disconnect() 时彻底解绑，防止内存泄漏。
   */
  private setupLifecycleListeners(): void {
    if (!this.enableLifecycleWake) return;

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.visibilityListener = () => {
        if (document.visibilityState === 'visible') {
          this.wakeImmediately('visibilitychange:visible');
        }
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.onlineListener = () => {
        this.wakeImmediately('network:online');
      };
      window.addEventListener('online', this.onlineListener);
    }
  }

  private teardownLifecycleListeners(): void {
    if (this.visibilityListener && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
    if (this.onlineListener && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this.onlineListener);
      this.onlineListener = null;
    }
  }

  /**
   * 设计意图 (Why):
   *   前台唤醒或网络恢复触发时，主动打破指数退避休眠，以 0ms 延迟立即发起重连。
   *
   * 防范的历史坑 (Pitfall):
   *   若正在连接或已经处于握手态，盲目重连会导致重复创建 WebSocket 形成脑裂；
   *   若不重置退避计数器（resetAttempts），后续正常断线依然会被污染残留的高延迟。
   *
   * 约束与规则 (Rules):
   *   - 已处于 CONNECTED 或 HANDSHAKING 时无操作直接返回；
   *   - 必须清理已调度的 reconnectTimer 定时器；
   *   - 必须调用 fsm.resetAttempts() 清空退避累积。
   */
  public wakeImmediately(reason = 'manual'): void {
    if (this.intentionalClose) return;
    const current = this.fsm.getState();
    if (current === 'CONNECTED' || current === 'HANDSHAKING') {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.fsm.resetAttempts();
    this.connect();
  }

  /**
   * 设计意图 (Why):
   *   在长连接成功建立后启动周期性应用层心跳看门狗（system.ping）。
   *
   * 防范的历史坑 (Pitfall):
   *   移动网络与 NAT 路由存在短生存期的半开连接陷阱（客户端认为连接正常但网关已死）。
   *   若无周期性心跳应答超时检测，客户端将永久挂在假在线状态无法感知断网。
   *
   * 约束与规则 (Rules):
   *   - 仅在 CONNECTED 状态下运行；
   *   - 发起 ping 后必须设置超时看门狗，超时未应答直接主动 close() 销毁死连接触发重连自愈；
   *   - 收到任何合法响应必须立即清理本次超时看门狗。
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (!this.enableHeartbeat) return;

    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.fsm.getState() !== 'CONNECTED') {
        return;
      }

      this.heartbeatTimeoutHandle = setTimeout(() => {
        console.warn('[HermesGatewayClient] Heartbeat watchdog timeout, terminating half-open connection');
        if (this.ws) {
          try {
            this.ws.close();
          } catch {}
        }
      }, this.heartbeatTimeoutMs);

      this.call('system.ping', { timestamp: Date.now() })
        .catch(() => {})
        .finally(() => {
          if (this.heartbeatTimeoutHandle) {
            clearTimeout(this.heartbeatTimeoutHandle);
            this.heartbeatTimeoutHandle = null;
          }
        });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutHandle) {
      clearTimeout(this.heartbeatTimeoutHandle);
      this.heartbeatTimeoutHandle = null;
    }
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
            this.startHeartbeat();
          })
          .catch(() => {
            // Even if ping is not directly supported, connection opened
            this.fsm.transitionTo('CONNECTED');
            this.startHeartbeat();
          });
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (err) => {
        console.warn('[HermesGatewayClient] WebSocket error:', err);
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.ws = null;
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        } else {
          this.fsm.transitionTo('DISCONNECTED');
        }
      };
    } catch (err) {
      console.error('[HermesGatewayClient] Failed to instantiate WebSocket:', err);
      this.stopHeartbeat();
      this.scheduleReconnect();
    }
  }

  private clearPendingRequests(reason = 'Connection closed'): void {
    for (const [, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  public disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    this.teardownLifecycleListeners();
    this.clearPendingRequests('Client disconnected');
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
    this.stopHeartbeat();
    this.fsm.transitionTo('RECONNECTING');

    // 轮换至下一个候选地址（若配置了多候选）
    if (this.candidateUrls.length > 1) {
      this.rotateCandidate();
    }

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

      const resObj = res && typeof res === 'object' ? (res as Record<string, unknown>) : null;
      const messages = Array.isArray(resObj?.messages) ? resObj.messages : [];
      return {
        messages,
        pagination: resObj?.pagination,
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
        const res = await this.call<Record<string, unknown>>('model.options', { profile });
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
        const restObj = restResult && typeof restResult === 'object' ? (restResult as Record<string, unknown>) : null;
        if (models.length > 0) {
          return {
            models,
            details,
            currentModel: typeof restObj?.model === 'string' ? restObj.model : '',
            currentProvider: typeof restObj?.provider === 'string' ? restObj.provider : '',
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
      const res = await this.call<Record<string, unknown> | unknown[]>('profiles.list', {});
      const list = Array.isArray(res)
        ? res
        : Array.isArray((res as Record<string, unknown>)?.profiles)
          ? ((res as Record<string, unknown>).profiles as unknown[])
          : [];
      return list.map((item: unknown) => {
        const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          name: String(obj.name || obj.id || 'default'),
          displayName: String(obj.display_name || obj.title || obj.name || '默认 Agent'),
          description: typeof obj.description === 'string' ? obj.description : '',
          avatar: typeof obj.avatar === 'string' ? obj.avatar : '',
          model: typeof obj.model === 'string' ? obj.model : '',
          isDefault: Boolean(obj.is_default || obj.name === 'default'),
        };
      });
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
