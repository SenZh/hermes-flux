/**
 * Hermes Aura Desktop Preload Script
 * Securely exposes the Platform Abstraction Layer (PAL) bridge into the renderer window.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface SystemInfo {
  platform: 'windows' | 'macos' | 'linux';
  arch: string;
  osVersion: string;
  appVersion: string;
  isDesktop: boolean;
  isMobile: boolean;
  isWeb: boolean;
}

export interface GatewayAuthResult {
  ok: boolean;
  message: string;
  latency: number;
  ticket?: string;
  version?: string;
}

export interface HermesDesktopBridge {
  getSystemInfo: () => Promise<SystemInfo>;
  minimize: () => Promise<void>;
  maximize: () => Promise<boolean>;
  unmaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onWindowStateChange: (callback: (state: { isMaximized: boolean }) => void) => () => void;
  getDefaultGatewayConfig: () => Promise<{ url: string; key: string; profile: string }>;
  authenticateGateway: (options: {
    url: string;
    username?: string;
    password?: string;
  }) => Promise<GatewayAuthResult>;
  httpProxy: (options: {
    baseUrl: string;
    path: string;
    method?: string;
    token?: string;
    ticket?: string;
    body?: any;
    params?: any;
  }) => Promise<any>;
  openExternal: (url: string) => Promise<void>;
  openFileDialog: () => Promise<string[] | null>;
}

const bridge: HermesDesktopBridge = {
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowStateChange: (callback) => {
    const handler = (_event: unknown, state: { isMaximized: boolean }) => callback(state);
    ipcRenderer.on('window:state-changed', handler);
    return () => {
      ipcRenderer.removeListener('window:state-changed', handler);
    };
  },
  getDefaultGatewayConfig: () => ipcRenderer.invoke('gateway:get-default-config'),
  authenticateGateway: (options) => ipcRenderer.invoke('gateway:authenticate', options),
  httpProxy: (options) => ipcRenderer.invoke('gateway:http-proxy', options),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
};

contextBridge.exposeInMainWorld('hermesDesktop', bridge);
