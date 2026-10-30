/**
 * Platform Abstraction Layer (PAL) - Platform Bridge Interface
 * Unified contract for Desktop (Electron/Tauri), Mobile (Expo/Capacitor), and Web.
 */

export type PlatformType = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';

export interface SystemInfo {
  platform: PlatformType;
  arch: string;
  osVersion: string;
  appVersion: string;
  isDesktop: boolean;
  isMobile: boolean;
  isWeb: boolean;
}

export interface WindowControlState {
  isMaximized: boolean;
  isMinimized?: boolean;
  isFullScreen?: boolean;
  isFocused?: boolean;
}

export interface GatewayAuthResult {
  ok: boolean;
  message: string;
  latency: number;
  ticket?: string;
  version?: string;
}

export interface GatewayProcessStatus {
  running: boolean;
  pid?: number;
  port: number;
  url: string;
  latencyMs?: number;
  uptimeSeconds?: number;
  version?: string;
  lastHeartbeat?: number;
}

export interface IPlatformBridge {
  getSystemInfo(): Promise<SystemInfo>;
  
  // Window management (Desktop & Modal hosts)
  minimize(): Promise<void>;
  maximize(): Promise<boolean | void>;
  unmaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onWindowStateChange(callback: (state: WindowControlState) => void): () => void;
  
  // Gateway & Proxy operations
  getDefaultGatewayConfig?(): Promise<{ url: string; key: string; profile: string }>;
  authenticateGateway?(options: {
    url: string;
    username?: string;
    password?: string;
  }): Promise<GatewayAuthResult>;
  httpProxy?(options: {
    baseUrl: string;
    path: string;
    method?: string;
    token?: string;
    ticket?: string;
    body?: unknown;
    params?: unknown;
  }): Promise<unknown>;

  // Native Shell & Dialogs
  openExternal(url: string, content?: string): Promise<void>;
  openFileDialog?(): Promise<string[] | null>;
  readFile?(filePath: string): Promise<string | null>;
  showSaveDialog?(options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  showOpenDialog?(options: { title?: string; properties?: string[]; filters?: { name: string; extensions: string[] }[] }): Promise<string[] | null>;
}
