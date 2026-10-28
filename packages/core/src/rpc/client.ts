/**
 * Hermes Gateway JSON-RPC 2.0 WebSocket Client
 */

import { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from './types.js';
import { WebSocketFsm, FsmState } from './fsm.js';

export interface RpcClientOptions {
  url: string;
  timeoutMs?: number;
  autoConnect?: boolean;
}

export class HermesGatewayClient {
  private url: string;
  private timeoutMs: number;
  private ws: WebSocket | null = null;
  private nextId = 1;
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
