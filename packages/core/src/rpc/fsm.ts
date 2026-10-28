/**
 * 5-State WebSocket Finite State Machine (FSM)
 * Controls reconnection, backoff with full jitter, and heartbeat watchdog.
 */

export type FsmState = 'DISCONNECTED' | 'CONNECTING' | 'HANDSHAKING' | 'CONNECTED' | 'RECONNECTING';

export interface FsmConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxReconnectAttempts: number;
}

export const DEFAULT_FSM_CONFIG: FsmConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 1.5,
  heartbeatIntervalMs: 15000,
  heartbeatTimeoutMs: 5000,
  maxReconnectAttempts: Infinity,
};

export class WebSocketFsm {
  private state: FsmState = 'DISCONNECTED';
  private attemptCount = 0;
  private config: FsmConfig;
  private listeners: Set<(state: FsmState, prev: FsmState) => void> = new Set();

  constructor(config: Partial<FsmConfig> = {}) {
    this.config = { ...DEFAULT_FSM_CONFIG, ...config };
  }

  public getState(): FsmState {
    return this.state;
  }

  public transitionTo(next: FsmState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;

    if (next === 'CONNECTED') {
      this.attemptCount = 0;
    }

    this.listeners.forEach((fn) => fn(next, prev));
  }

  /**
   * Computes exponential backoff with full jitter:
   * t = Uniform(0, min(maxDelay, initialDelay * (factor ^ attempt)))
   */
  public getNextBackoffMs(): number {
    const rawDelay = this.config.initialDelayMs * Math.pow(this.config.backoffFactor, this.attemptCount);
    const capped = Math.min(this.config.maxDelayMs, rawDelay);
    this.attemptCount++;
    return Math.floor(Math.random() * capped);
  }

  public resetAttempts(): void {
    this.attemptCount = 0;
  }

  public onStateChange(listener: (state: FsmState, prev: FsmState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
