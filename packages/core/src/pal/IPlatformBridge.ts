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
  isMinimized: boolean;
  isFullScreen: boolean;
  isFocused: boolean;
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
  
  // Window management
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onWindowStateChange(callback: (state: WindowControlState) => void): () => void;
  
  // Theme & Material
  setWindowMaterial?(material: 'mica' | 'acrylic' | 'tabbed' | 'none'): Promise<boolean>;
  setTheme(theme: 'obsidian-gold' | 'jade-white' | 'system'): Promise<void>;
  
  // Native Shell & Dialogs
  openExternal(url: string, content?: string): Promise<void>;
  showSaveDialog?(options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  showOpenDialog?(options: { title?: string; properties?: string[]; filters?: { name: string; extensions: string[] }[] }): Promise<string[] | null>;
}
