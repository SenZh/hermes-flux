/**
 * Agent 在场生命周期与挂载控制器 (PresenceController)
 *
 * 【设计意图 (Why)】
 *   将 Agent 在场指示器的宿主探测、React 挂载句柄生命周期管理、
 *   快照指纹去重、回合计时与节拍器控制从 index.ts 中抽离，
 *   使桌面端主工位与在场指示器的交互逻辑独立可测、自闭环。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 必须使用 ensureAgentPresenceHost 的返回值，避免模板空宿主覆盖真值；
 *   2. 网关断连或 host 销毁时必须主动卸载并停止节拍器，杜绝每秒空转；
 *   3. 构造快照与推送指纹共用同一份 pendingSnapshot，规避跨语气档时指纹与内容不一致；
 *   4. Batch 7 抽离曾在本控制器内复制出 `pendingPresenceSnapshot` 与 `lastAgentPresenceFingerprint` 影子字段：
 *      `syncAgentPresence()` 只更新 manager 侧快照，而 `getSnapshot()` 优先返回控制器侧过期快照，
 *      导致切 Bot 时只要宿主节点未被重建（dock 未重绘或处于 stage 布局），在场指示器头像就会永久停留在旧 Bot。
 *
 * 【约束与规则 (Rules)】
 *   - `AgentPresenceManager` 是 `pendingPresenceSnapshot` 与 `lastAgentPresenceFingerprint` 的唯一真值源，
 *     本控制器严禁持有或缓存影子快照字段；
 *   - 0 TS 报错，严禁 as any；
 *   - 单向依赖注入，不反向 import index.ts。
 */

import type {
  AgentPresenceSnapshot,
  ConversationMount,
} from '@hermes-flux/ui';
import type { AgentPresence } from '@hermes-flux/core';
import { AgentPresenceManager, agentPresenceFingerprint } from '../presence/agentPresenceManager.js';
import type { AppState } from '../state/appState.js';

export interface PresenceControllerDeps {
  getState: () => AppState;
  resolveAgentAvatar: (name: string) => string;
  isGroupConversationActive: () => boolean;
  isStreamingActiveForCurrentSession: () => boolean;
  activeRunningGroupRoomIds: ReadonlySet<string>;
  mountAgentPresence: (
    host: HTMLElement,
    getSnapshot: () => AgentPresenceSnapshot,
  ) => ConversationMount;
  ensureAgentPresenceHost: (layout: 'stage' | 'dock') => HTMLElement | null;
}

export class PresenceController {
  private readonly deps: PresenceControllerDeps;
  private readonly manager: AgentPresenceManager;

  private updateReactAgentPresence: (() => void) | null = null;
  private presenceMountHandle: ConversationMount | null = null;
  private agentPresenceHost: HTMLElement | null = null;

  constructor(deps: PresenceControllerDeps) {
    this.deps = deps;
    this.manager = new AgentPresenceManager({
      get activeFocus() { return deps.getState().activeFocus; },
      get activeSessionId() { return deps.getState().activeSessionId; },
      get activeRunningGroupRoomIds() { return deps.activeRunningGroupRoomIds; },
      isStreamingActiveForCurrentSession: () => deps.isStreamingActiveForCurrentSession(),
      get messages() { return deps.getState().messages; },
      get sideAgentCapsules() { return deps.getState().sideAgentCapsules; },
      get presenceTerminal() { return deps.getState().presenceTerminal; },
      get turnStartedAt() { return deps.getState().turnStartedAt; },
      get profiles() { return deps.getState().profiles; },
      get sessions() { return deps.getState().sessions; },
      get groupRooms() { return deps.getState().groupRooms; },
      get profileName() { return deps.getState().profileName; },
      get lang() { return deps.getState().lang; },
      get presenceLayout() { return deps.getState().presenceLayout; },
      get activeGroupSpeaker() { return deps.getState().activeGroupSpeaker; },
      resolveAgentAvatar: (name) => deps.resolveAgentAvatar(name),
      isGroupConversationActive: () => deps.isGroupConversationActive(),
      onUpdateReact: () => { this.updateReactAgentPresence?.(); },
    });
  }

  getAgentPresenceHost(): HTMLElement | null {
    return this.agentPresenceHost;
  }

  resetPresenceHost(): void {
    this.presenceMountHandle?.unmount();
    this.presenceMountHandle = null;
    this.updateReactAgentPresence = null;
    this.agentPresenceHost = null;
    this.manager.pendingPresenceSnapshot = null;
    this.manager.lastAgentPresenceFingerprint = '';
    this.manager.ensurePresenceTicker('idle');
  }

  getSnapshot(): AgentPresenceSnapshot {
    return this.manager.getAgentPresenceSnapshot();
  }

  ensureGroupTurnClock(groupRoomId: string | null, isRunning: boolean): void {
    this.manager.ensureGroupTurnClock(groupRoomId, isRunning);
  }

  ensurePresenceTicker(kind: AgentPresence['kind']): void {
    this.manager.ensurePresenceTicker(kind);
  }

  syncAgentPresenceHost(): void {
    const state = this.deps.getState();
    const presenceHost = this.deps.ensureAgentPresenceHost(state.presenceLayout);
    if (presenceHost && presenceHost === this.agentPresenceHost && presenceHost.isConnected) return;

    this.presenceMountHandle?.unmount();
    this.presenceMountHandle = null;
    this.updateReactAgentPresence = null;
    this.agentPresenceHost = presenceHost;
    this.manager.pendingPresenceSnapshot = null;
    this.manager.lastAgentPresenceFingerprint = '';

    if (presenceHost) {
      const initialDomain = this.manager.resolvePresenceDomain();
      this.manager.ensureGroupTurnClock(initialDomain.groupRoomId, initialDomain.isRunning);
      const initialSnapshot = this.manager.buildAgentPresenceSnapshot();
      this.manager.pendingPresenceSnapshot = initialSnapshot;
      this.manager.lastAgentPresenceFingerprint = agentPresenceFingerprint(initialSnapshot);
      this.presenceMountHandle = this.deps.mountAgentPresence(presenceHost, () => this.getSnapshot());
      this.updateReactAgentPresence = this.presenceMountHandle.update;
      this.manager.ensurePresenceTicker(initialSnapshot.presence.kind);
    } else {
      this.manager.ensurePresenceTicker('idle');
    }
  }

  syncAgentPresence(): void {
    if (!this.updateReactAgentPresence) return;
    if (!this.agentPresenceHost?.isConnected) {
      this.syncAgentPresenceHost();
      if (!this.updateReactAgentPresence) return;
    }
    this.manager.syncAgentPresence();
  }
}

export function createPresenceController(deps: PresenceControllerDeps): PresenceController {
  return new PresenceController(deps);
}
