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
  /**
   * 宿主提供的 WebSocket 地址重写钩子。
   * 浏览器直跑或测试宿主用它将跨源 WS 地址转为同源代理，规避跨源 Origin 被拒。
   */
  proxyWebSocketUrl?: (wsUrl: string) => string;
  openFileDialog: () => Promise<string[] | null>;
  readFile: (path: string) => Promise<string | null>;
  saveFile: (options: { fileName: string; content: string; isBase64?: boolean }) => Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }>;
  clipboardWrite: (text: string) => Promise<boolean>;
  clipboardRead: () => Promise<string>;
  /**
   * 把渲染进程日志转发给主进程落盘。
   *
   * 设计意图 (Why):
   *   渲染层无法直接写文件；现场排障需要一份统一日志，
   *   因此用单向 IPC 把结构化记录交给主进程的落盘队列。
   *
   * 约束 (Rules):
   *   单向 send，不返回 Promise，避免每条日志一次往返开销。
   */
  appendLog: (record: {
    ts: number;
    iso: string;
    level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
    scope: string;
    message: string;
    data?: unknown;
  }) => void;
  /** 日志目录绝对路径，用于「打开日志目录」入口 */
  getLogDir: () => Promise<string | null>;
  /** 物理激活宿主原生窗口，规避失焦与光标抑制 */
  activateWindow: () => Promise<void>;
}

const bridge: HermesDesktopBridge = {
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  activateWindow: () => ipcRenderer.invoke('window:activate'),
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
  saveFile: (options) => ipcRenderer.invoke('fs:save-file', options),
  clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard:write-text', text),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read-text'),
  appendLog: (record) => {
    try {
      ipcRenderer.send('log:append', record);
    // gate-degrade: IPC 通道不可用时日志转发降级为静默，不能影响渲染层业务
    } catch {
      // 日志通道不可用时静默降级，绝不影响渲染层业务
    }
  },
  getLogDir: () => ipcRenderer.invoke('log:get-dir'),
};

contextBridge.exposeInMainWorld('hermesDesktop', bridge);
