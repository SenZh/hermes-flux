/**
 * Hermes Flux D17 顶栏状态与窗口按键控制器 (Titlebar Controller)
 *
 * 【设计意图 (Why)】
 * 统一管理工作台顶部标题栏的快照派生（TitlebarSnapshot）、窗口最小化、最大化、关闭
 * 与主题切换交互，以及宿主操作系统平台（Windows / macOS / Linux / Web）与全屏最大化状态机。
 * 将散落在 index.ts 中的窗口生命周期事件和标题解析逻辑解耦，
 * 提供纯净的单向依赖注入接口，确保顶栏状态机可被脱离 DOM 的单元测试覆盖。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. 标题与头像解析必须根据当前 activeFocus（Bot 主工位 / 群聊研讨室 / 会话）做领域分流，防范标题跳动；
 * 2. 窗口最大化在某些平台上异步返回 boolean，在其它平台上可能需二次查询 isMaximized() 确认，需双重兜底；
 * 3. 主题切换必须同步写入 localStorage（双 key 兼容 hermes_flux_theme 与 hermes_aura_theme），避免二次启动回退；
 * 4. 移动端/小屏与 Web 姿态下平台推导应避免误将移动浏览器当作 Windows 桌面。
 *
 * 【约束与规则 (Rules)】
 * - 严格单向依赖，禁止反向 import index.ts；
 * - 0 as any，保持全栈严格类型推导；
 * - 遵循三要素中文注释规范。
 */

import {
  resolveTitlebarTitle,
  resolveTitlebarAvatar,
} from '@hermes-flux/core';
import {
  getTitlebarSnapshot as createTitlebarSnapshot,
  getToggleTheme,
  type TitlebarSnapshot,
  type I18nKey,
} from '@hermes-flux/ui';
import type { AppState } from './state/appState.js';
import type { HermesDesktopBridge } from '../preload/index.js';

export interface TitlebarControllerDeps {
  getState: () => AppState;
  render: () => void;
  getDesktopApi: () => HermesDesktopBridge | undefined;
  t: (key: I18nKey) => string;
}

export interface TitlebarController {
  getTitlebarSnapshot(): TitlebarSnapshot;
  onMinimizeWindow(): void;
  onMaximizeWindow(): Promise<void>;
  onCloseWindow(): void;
  onToggleTheme(): void;
  syncSystemWindow(): Promise<void>;
  detectInitialPlatform(): 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
}

export function detectInitialPlatform(desktopApi?: HermesDesktopBridge): 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web' {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent.toLowerCase();
    if (/android/.test(ua)) return 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (!desktopApi && typeof window !== 'undefined' && window.innerWidth <= 768) {
      return /macintosh|mac os x/.test(ua) ? 'ios' : 'android';
    }
    if (/macintosh|mac os x/.test(ua)) return 'macos';
    if (/linux/.test(ua)) return 'linux';
    if (/windows/.test(ua)) return 'windows';
  }
  return desktopApi ? 'windows' : 'web';
}

export function createTitlebarController(deps: TitlebarControllerDeps): TitlebarController {
  const { getState, render, getDesktopApi, t } = deps;

  function getTitlebarSnapshot(): TitlebarSnapshot {
    const state = getState();
    return createTitlebarSnapshot({
      platform: state.platform,
      title: resolveTitlebarTitle({
        activeFocus: state.activeFocus,
        profiles: state.profiles,
        groupRooms: state.groupRooms,
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        defaultTitle: t('titlebar.defaultTitle'),
        notConnectedTitle: t('titlebar.notConnected'),
        defaultRoomName: t('group.defaultRoomName'),
        isConnected: state.gatewayConnected,
        profileName: state.profileName,
      }),
      isMaximized: state.isMaximized,
      gatewayConnected: state.gatewayConnected,
      latencyMs: state.gatewayLatencyMs,
      activeAvatar: resolveTitlebarAvatar({
        activeFocus: state.activeFocus,
        profiles: state.profiles,
        groupRooms: state.groupRooms,
        profileName: state.profileName,
        activeSessionId: state.activeSessionId,
        sessions: state.sessions,
      }),
    });
  }

  function onMinimizeWindow(): void {
    const desktopApi = getDesktopApi();
    desktopApi?.minimize();
  }

  async function onMaximizeWindow(): Promise<void> {
    const desktopApi = getDesktopApi();
    if (!desktopApi) return;
    const result = await desktopApi.maximize();
    const state = getState();
    state.isMaximized = typeof result === 'boolean' ? result : await desktopApi.isMaximized();
    render();
  }

  function onCloseWindow(): void {
    const desktopApi = getDesktopApi();
    desktopApi?.close();
  }

  function onToggleTheme(): void {
    const state = getState();
    state.theme = getToggleTheme(state.theme);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('hermes_flux_theme', state.theme);
      localStorage.setItem('hermes_aura_theme', state.theme);
    }
    render();
  }

  async function syncSystemWindow(): Promise<void> {
    const desktopApi = getDesktopApi();
    if (!desktopApi) return;
    try {
      const sys = await desktopApi.getSystemInfo();
      const state = getState();
      state.platform = sys.platform || 'windows';
      state.appVersion = typeof sys.appVersion === 'string' ? sys.appVersion : undefined;
      state.isMaximized = await desktopApi.isMaximized();

      desktopApi.onWindowStateChange((ws) => {
        state.isMaximized = ws.isMaximized;
        render();
      });
    } catch (e) {
      console.warn('[Desktop PAL] Sync note:', e);
    }
  }

  return {
    getTitlebarSnapshot,
    onMinimizeWindow,
    onMaximizeWindow,
    onCloseWindow,
    onToggleTheme,
    syncSystemWindow,
    detectInitialPlatform: () => detectInitialPlatform(getDesktopApi()),
  };
}
