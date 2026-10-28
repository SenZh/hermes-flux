/**
 * Platform Abstraction Layer (PAL) - Network & WebSocket Transport Interface
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface INetworkTransport {
  connect(url: string, protocols?: string[]): Promise<void>;
  disconnect(code?: number, reason?: string): void;
  send(data: string | ArrayBuffer): boolean;
  onMessage(handler: (data: string | ArrayBuffer) => void): () => void;
  onStateChange(handler: (state: ConnectionState, detail?: string) => void): () => void;
  getState(): ConnectionState;
}
