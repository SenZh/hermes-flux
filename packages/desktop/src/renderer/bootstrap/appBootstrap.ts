/**
 * Hermes Flux D18 启动自举与模块组装中心 (App Bootstrap)
 *
 * 【设计意图 (Why)】
 * 统管客户端渲染层的冷启动初始化流水线、全局事件监听器装配（Focus、Visibility、Resize）、
 * 视口布局位移诊断（Layout Shift Diagnostics）、静态资源与字体预热、
 * 双轨拖拽几何夹取持久化状态机、以及脱网本地调试演示模式（Conversation Demo Mode）。
 * 彻底终结 index.ts 底部数百行杂乱初始化的历史包袱，提供清晰的生命周期闭环。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. 左右轨宽度恢复必须经由 clampRail 夹取校验，防止用户历史残留越界宽度存档导致布局挤扁；
 * 2. 窗口切换 focus 监听必须带 5 秒冷却防抖，避免桌面端频繁切换前后台时密集无意义地冲击网关 RPC；
 * 3. Electron 预创建窗口可能在后台冷启动，必须显式同步一次 visibilityState 至 dataset.appHidden；
 * 4. 演示模式必须带上真实的模型目录指纹结构，避免无网络时模型选择器折叠卡死。
 *
 * 【约束与规则 (Rules)】
 * - 严格单向依赖，禁止反向 import index.ts；
 * - 0 as any，保持全栈严格类型推导；
 * - 遵循三要素中文注释规范。
 */

import {
  normalizeModelCatalog,
  modelCatalogFingerprint,
  type HermesGatewayClient,
  type ModelDetail,
} from '@hermes-flux/core';
import {
  mountFileTypeSprite,
  warmUpHighlighting,
  applyFontPreferences,
  setLocale,
  type FontPreferences,
} from '@hermes-flux/ui';
import type { AppState } from '../state/appState.js';
import type { HermesDesktopBridge } from '../../preload/index.js';

export const LEFT_RAIL_WIDTH = { min: 264, max: 480, defaultValue: 264 } as const;

export function clampLeftRailWidth(raw: string | null): number {
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  if (!Number.isFinite(parsed)) return LEFT_RAIL_WIDTH.defaultValue;
  return Math.round(Math.max(LEFT_RAIL_WIDTH.min, Math.min(LEFT_RAIL_WIDTH.max, parsed)));
}

export function clampRail(raw: string | null, minW: number, maxW: number, fallback: number): number {
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.max(minW, Math.min(maxW, parsed)));
}

export function restoreRailWidths(): { left: number; right: number } {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof localStorage === 'undefined') {
    return { left: LEFT_RAIL_WIDTH.defaultValue, right: 420 };
  }
  const railMaxW = Math.round(window.innerWidth * 0.85);
  const restoredLeft = clampLeftRailWidth(localStorage.getItem('hermes_flux_rail_w_left') || localStorage.getItem('hermes_aura_rail_w_left'));
  document.documentElement.style.setProperty('--rail-w-left', `${restoredLeft}px`);
  localStorage.setItem('hermes_flux_rail_w_left', String(restoredLeft));

  const rawRight = localStorage.getItem('hermes_flux_rail_w_right') || localStorage.getItem('hermes_aura_rail_w_right');
  const restoredRight = clampRail(rawRight, 260, railMaxW, 420);
  document.documentElement.style.setProperty('--rail-w-right', `${restoredRight}px`);
  localStorage.setItem('hermes_flux_rail_w_right', String(restoredRight));

  return { left: restoredLeft, right: restoredRight };
}

export function resetLeftRailWidth(): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--rail-w-left', `${LEFT_RAIL_WIDTH.defaultValue}px`);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('hermes_flux_rail_w_left', String(LEFT_RAIL_WIDTH.defaultValue));
    }
  }
}

export function beginLeftRailResize(event: React.PointerEvent<HTMLDivElement>): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const startX = event.clientX;
  const cssVar = '--rail-w-left';
  const startWidth = clampLeftRailWidth(
    getComputedStyle(document.documentElement).getPropertyValue(cssVar) || String(LEFT_RAIL_WIDTH.defaultValue),
  );
  try {
    handle.setPointerCapture(event.pointerId);
  // gate-degrade: PointerCapture 在部分无头或断开指针时可安全忽略
  } catch {}

  document.documentElement.setAttribute('data-rail-resizing', 'left');
  let currentW = startWidth;
  let rafId = 0;

  const onPointerMove = (moveEv: PointerEvent) => {
    currentW = clampLeftRailWidth(String(startWidth + (moveEv.clientX - startX)));
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        document.documentElement.style.setProperty(cssVar, `${currentW}px`);
        rafId = 0;
      });
    }
  };

  const onPointerUp = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    try {
      handle.releasePointerCapture(event.pointerId);
    // gate-degrade: 指针可能已被回收
    } catch {}
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    const settled = clampLeftRailWidth(String(currentW));
    document.documentElement.style.setProperty(cssVar, `${settled}px`);
    localStorage.setItem('hermes_flux_rail_w_left', String(settled));
    requestAnimationFrame(() => document.documentElement.removeAttribute('data-rail-resizing'));
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

export function bindRailResizeEvents(): void {
  if (typeof document === 'undefined') return;

  document.querySelectorAll<HTMLElement>('.rail-resize-handle').forEach((handle) => {
    if (handle.dataset.railHandle === 'left') {
      handle.ondblclick = (e) => {
        e.stopPropagation();
        resetLeftRailWidth();
      };
      return;
    }
    const cssVar = '--rail-w-right';
    const minW = 260;
    const maxW = Math.round(window.innerWidth * 0.85);
    const defaultW = 420;
    const storageKey = 'hermes_flux_rail_w_right';

    handle.ondblclick = (e) => {
      e.stopPropagation();
      document.documentElement.style.setProperty(cssVar, `${defaultW}px`);
      localStorage.setItem(storageKey, String(defaultW));
    };

    handle.onpointerdown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();

      try {
        handle.setPointerCapture(ev.pointerId);
      // gate-degrade: PointerCapture 容错处理
      } catch {}

      const startX = ev.clientX;
      const startWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || defaultW;
      document.documentElement.setAttribute('data-rail-resizing', 'right');

      let currentW = startWidth;
      let rafId = 0;

      const onPointerMove = (moveEv: PointerEvent) => {
        const delta = (moveEv.clientX - startX) * -1;
        currentW = Math.max(minW, Math.min(maxW, startWidth + delta));
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            document.documentElement.style.setProperty(cssVar, `${currentW}px`);
            rafId = 0;
          });
        }
      };

      const onPointerUp = (upEv: PointerEvent) => {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        try {
          handle.releasePointerCapture(upEv.pointerId);
        // gate-degrade: 释放失败不影响
        } catch {}
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        document.documentElement.style.setProperty(cssVar, `${Math.round(currentW)}px`);
        localStorage.setItem(storageKey, String(Math.round(currentW)));
        requestAnimationFrame(() => document.documentElement.removeAttribute('data-rail-resizing'));
      };

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };
  });
}

export function isConversationDemoMode(): boolean {
  if (typeof location === 'undefined') return false;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  return new URLSearchParams(location.search).get('demo') === 'conversation';
}

export function injectConversationDemo(state: AppState): void {
  state.gatewayConnected = true;
  state.gatewayConnecting = false;
  state.profileName = 'default';
  const demoEntries = normalizeModelCatalog({
    providers: [
      {
        slug: 'cpa',
        name: 'cpa',
        models: ['anthropic/claude-opus-5', 'gemini-3.8-flash', 'deepseek-v4.1-flash', 'qwen3-max'],
      },
      { slug: 'nous', name: 'Nous Portal', models: ['zai/glm-5.2', 'kimi-k2', 'openrouter/sonoma-sky'] },
      { slug: 'xai-oauth', name: 'xAI Grok OAuth', models: ['grok-4.20'] },
    ],
  });
  state.modelCatalog = demoEntries;
  state.availableModels = demoEntries.map((entry) => entry.id);
  state.modelDetails = demoEntries.map<ModelDetail>((entry) => ({
    id: entry.id,
    provider: entry.providerSlug,
    name: entry.displayName,
    displayName: entry.displayName,
  }));
  state.modelCatalogHash = modelCatalogFingerprint(demoEntries);
  state.currentProvider = 'cpa';
  state.selectedModel = 'gemini-3.8-flash';
  state.activeFocus = { type: 'session', sessionId: 'demo-session' };
  state.hasOlderMessages = true;
  state.messages = [
    { id: 'demo-u1', role: 'user', content: 'Review the new conversation layout, spacing and bubble width.', timestamp: '10:24' },
    {
      id: 'demo-a1',
      role: 'assistant',
      content:
        'The structure is now Stage → Stream → Turn → Message.\n\n- User bubble right-aligned, max 80% / 820px\n- Assistant full width\n- Turn gap independent from message gap\n\nTool capsules and card containers mount into Turn next.',
      thought: 'Check container hierarchy first, then padding and width.',
      thoughtDurationMs: 1800,
      model: 'deepseek-v4.1-flash',
      durationMs: 2400,
      timestamp: '10:25',
      sender: 'Default',
      toolCalls: [
        { id: 'demo-t1', name: 'shell', status: 'completed', args: 'npm test', output: '664 passing', durationMs: 1200 },
        { id: 'demo-t2', name: 'read_file', status: 'completed', args: 'packages/ui/src/styles/conversation.css', durationMs: 80 },
        { id: 'demo-t3', name: 'grep', status: 'failed', args: 'ghost-token', output: 'no matches', durationMs: 40 },
      ],
    },
    { id: 'demo-a2', role: 'assistant', content: 'Streaming writes through ref, so the tree does not re-render.', timestamp: '10:25', sender: 'Default' },
    { id: 'demo-u2', role: 'user', content: 'Second user message for alignment and spacing.', timestamp: '10:26' },
    {
      id: 'demo-a3',
      role: 'assistant',
      content: 'Final assistant message, used to check the turn footer position.',
      model: 'deepseek-v4.1-flash',
      durationMs: 1200,
      timestamp: '10:27',
      sender: 'Default',
    },
  ];
}

export function installLayoutShiftDiagnostics(logCallback?: (info: Record<string, unknown>) => void): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
        const value = entry.value ?? 0;
        if (value < 0.0005 || entry.hadRecentInput) continue;
        const stream = typeof document !== 'undefined' ? document.getElementById('conversation-stream') : null;
        logCallback?.({
          value: Math.round(value * 1000) / 1000,
          scrollTop: stream ? Math.round(stream.scrollTop) : null,
          scrollHeight: stream ? stream.scrollHeight : null,
        });
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });
  // gate-degrade: Chromium 专有性能观测，缺失时静默降级
  } catch {}
}

export interface AppBootstrapDeps {
  getState: () => AppState;
  render: () => void;
  getDesktopApi: () => HermesDesktopBridge | undefined;
  getGatewayClient: () => HermesGatewayClient | null;
  connect: () => void;
  restoreCacheToState: () => Promise<void>;
  refreshProfilesFromServer: () => Promise<void>;
  syncSystemWindow: () => Promise<void>;
  fontPreferences: FontPreferences;
  logBoot: (info: Record<string, unknown>) => void;
  logLayoutShift?: (info: Record<string, unknown>) => void;
}

export interface AppBootstrap {
  init(): Promise<void>;
  setupGlobalEventListeners(): () => void;
  restoreRailWidths(): { left: number; right: number };
  bindRailResizeEvents(): void;
  beginLeftRailResize(event: React.PointerEvent<HTMLDivElement>): void;
  resetLeftRailWidth(): void;
  isConversationDemoMode(): boolean;
  injectConversationDemo(): void;
}

export function createAppBootstrap(deps: AppBootstrapDeps): AppBootstrap {
  const {
    getState,
    render,
    getDesktopApi,
    getGatewayClient,
    connect,
    restoreCacheToState,
    refreshProfilesFromServer,
    syncSystemWindow,
    fontPreferences,
    logBoot,
    logLayoutShift,
  } = deps;

  function setupGlobalEventListeners(): () => void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => {};
    }

    let lastFocusRefreshAt = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAt < 5000) return;
      lastFocusRefreshAt = now;
      const state = getState();
      const gatewayClient = getGatewayClient();
      if (gatewayClient && !state.isStreaming) {
        void refreshProfilesFromServer();
      }
    };
    window.addEventListener('focus', onFocus);

    const syncPageHiddenAttr = (): void => {
      if (document.visibilityState === 'hidden') {
        document.documentElement.dataset.pageHidden = 'true';
      } else {
        delete document.documentElement.dataset.pageHidden;
      }
    };
    syncPageHiddenAttr();

    const onVisibilityChange = () => {
      document.documentElement.dataset.appHidden = String(document.visibilityState === 'hidden');
      syncPageHiddenAttr();
      if (document.visibilityState === 'visible') void refreshProfilesFromServer();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }

  async function init(): Promise<void> {
    const state = getState();
    const desktopApi = getDesktopApi();

    logBoot({
      theme: state.theme,
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      electron: typeof navigator !== 'undefined' ? navigator.userAgent.includes('Electron') : false,
    });

    installLayoutShiftDiagnostics(logLayoutShift);

    if (typeof document !== 'undefined') {
      mountFileTypeSprite();
      applyFontPreferences(fontPreferences);
      setLocale(state.lang === 'en' ? 'en-US' : 'zh-CN');
      warmUpHighlighting();
      document.documentElement.dataset.appHidden = String(document.visibilityState === 'hidden');
    }

    if (isConversationDemoMode()) {
      injectConversationDemo(state);
      render();
      return;
    }

    restoreRailWidths();

    if (desktopApi) {
      await syncSystemWindow();
      if (desktopApi?.getDefaultGatewayConfig) {
        try {
          const def = await desktopApi.getDefaultGatewayConfig();
          if (def) {
            const savedUrl = typeof localStorage !== 'undefined'
              ? (localStorage.getItem('hermes_flux_gateway_url') || localStorage.getItem('hermes_aura_gateway_url'))
              : null;
            if (def.url && !savedUrl) state.gatewayUrl = def.url;
            const savedProfile = typeof localStorage !== 'undefined'
              ? (localStorage.getItem('hermes_flux_profile') || localStorage.getItem('hermes_aura_profile'))
              : null;
            if (def.profile && !savedProfile) state.profileName = def.profile;
          }
        } catch (e) {
          console.warn('[Desktop PAL] Default config sync note:', e);
        }
      }
    }

    void restoreCacheToState();
    connect();

    setupGlobalEventListeners();
  }

  return {
    init,
    setupGlobalEventListeners,
    restoreRailWidths,
    bindRailResizeEvents,
    beginLeftRailResize,
    resetLeftRailWidth,
    isConversationDemoMode,
    injectConversationDemo: () => injectConversationDemo(getState()),
  };
}
