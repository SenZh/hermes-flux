/**
 * Hermes Flux Desktop Preload Script
 * Securely exposes the Platform Abstraction Layer (PAL) bridge into the renderer window.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IPlatformBridge, SystemInfo, GatewayAuthResult, WindowControlState } from '@hermes-flux/core';

export type { SystemInfo, GatewayAuthResult };

export interface HermesDesktopBridge extends IPlatformBridge {
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
  openFileDialog: () => Promise<string[] | null>;
  readFile: (path: string) => Promise<string | null>;
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
  openExternal: (url: string, content?: string) => ipcRenderer.invoke('shell:open-external', url, content),
  openFileDialog: () => ipcRenderer.invoke('dialog:open-file'),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:read-file', filePath),
};

contextBridge.exposeInMainWorld('hermesDesktop', bridge);
