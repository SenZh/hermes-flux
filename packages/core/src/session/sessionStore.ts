/**
 * Universal Session Controller & State Store
 *
 * 设计意图 (Why):
 *   为了实现一套代码支持全平台（Desktop / Mobile / Web），
 *   必须将原先死锁在 packages/desktop/src/renderer/index.ts 内部的
 *   会话状态管理、分页队列、网关重连与事件编排逻辑抽离为纯粹的无宿主状态机。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 平台耦合：严禁依赖 window、document 或 Node 原生模块。
 *   2. 异步时钟与内存泄露：切换会话时必须清理旧监听，支持状态单向派发。
 *   3. 失败隐蔽：网络断开与接口异常必须显式进入错误状态，禁止伪装为空列表。
 *
 * 约束与规则 (Rules):
 *   - 纯 TypeScript 实现，零宿主 API 依赖。
 *   - 所有状态变更通过 subscribe 回调广播给宿主视图层。
 */

import type { NormalizedSession, AgentProfile, ModelDetail } from '../rpc/types.js';

export interface UniversalAppState {
  platform: 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'web';
  theme: 'obsidian-gold' | 'suet-jade' | 'jade-white';
  lang: 'zh' | 'en';
  isMaximized: boolean;
  leftRailCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeSessionId: string;
  activeLiveSessionId: string;
  selectedModel: string;
  availableModels: string[];
  modelDetails: ModelDetail[];
  currentProvider: string;
  profiles: AgentProfile[];
  profileName: string;
  dockNotice: string;
  sessionListError: string;
  pendingSessionIds: string[];
  reasoningLevel: 'default' | 'none' | 'low' | 'high' | 'max' | 'off' | 'medium';
  approvalMode: 'auto' | 'ask' | 'sandbox';
  isStreaming: boolean;
  gatewayConnected: boolean;
  gatewayConnecting: boolean;
  gatewayLatencyMs: number;
  gatewayUrl: string;
  sessions: NormalizedSession[];
  hasOlderMessages: boolean;
}

export type StateListener = (state: Readonly<UniversalAppState>) => void;

export class SessionStore {
  private state: UniversalAppState;
  private listeners = new Set<StateListener>();

  constructor(initialState?: Partial<UniversalAppState>) {
    this.state = {
      platform: 'web',
      theme: 'obsidian-gold',
      lang: 'zh',
      isMaximized: false,
      leftRailCollapsed: false,
      inspectorCollapsed: false,
      activeSessionId: '',
      activeLiveSessionId: '',
      selectedModel: 'hermes-3-llama-3.1-8b',
      availableModels: [],
      modelDetails: [],
      currentProvider: 'default',
      profiles: [],
      profileName: 'default',
      dockNotice: '',
      sessionListError: '',
      pendingSessionIds: [],
      reasoningLevel: 'default',
      approvalMode: 'auto',
      isStreaming: false,
      gatewayConnected: false,
      gatewayConnecting: false,
      gatewayLatencyMs: 0,
      gatewayUrl: 'ws://127.0.0.1:8642',
      sessions: [],
      hasOlderMessages: false,
      ...initialState,
    };
  }

  public getState(): Readonly<UniversalAppState> {
    return this.state;
  }

  public setState(patch: Partial<UniversalAppState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public setActiveSession(sessionId: string, liveId?: string): void {
    this.setState({
      activeSessionId: sessionId,
      activeLiveSessionId: liveId ?? sessionId,
      dockNotice: '',
    });
  }

  public setGatewayStatus(connected: boolean, connecting = false, latency = 0): void {
    this.setState({
      gatewayConnected: connected,
      gatewayConnecting: connecting,
      gatewayLatencyMs: latency,
    });
  }
}
