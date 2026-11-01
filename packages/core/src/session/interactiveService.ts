/**
 * Interactive Conversation Stage Domain Service (packages/core/src/session/interactiveService.ts)
 *
 * 【设计意图 (Why)】
 * 1. 统一管理中间核心交互区（Main Chat Stage）针对 Hermes Gateway 的核心会话控制能力：
 *    - 历史第 N 轮截断并重新生成（基于 prompt.submit 的 confirm_truncate 与 truncate_before_row_id）；
 *    - 最近一轮的单步撤销（session.undo）；
 *    - 基于消息节点派生独立分支会话（session.branch）；
 *    - 运行时轻量纠偏插话（session.correction）；
 *    - 紧急打断刹车（session.interrupt）；
 *    - 斜杠命令与技能目录聚合检索（commands.catalog）；
 *    - 会话用量与上下文水位监控（session.usage）。
 *
 * 【防范的历史坑 (Pitfall)】
 * - 历史截断严禁错调 session.undo！session.undo 是栈式撤回最近一步，无法截断历史中间节点；
 * - 严格对齐 Generated Contract 字段，严禁传未声明的冗余字段（严防 Pydantic code 4000: Extra inputs）；
 * - 网络失败严禁伪装为空数据（Failure Is Not Empty 铁律）。
 *
 * 【约束与规则 (Rules)】
 * - 纯 TypeScript 无界服务，依赖 IRpcCaller 抽象接口；
 * - 零 DOM / 零 UI 依赖，全平台通用。
 */

import type {
  PromptSubmitParams,
  PromptSubmitResult,
  SessionUndoParams,
  SessionUndoResult,
  SessionBranchParams,
  SessionBranchResult,
  SessionCorrectionParams,
  SessionCorrectionResult,
  SessionInterruptParams,
  SessionInterruptResult,
  CommandsCatalogParams,
  CommandsCatalogResult,
  SessionUsageResult,
} from '../rpc/contracts/gateway-contract.generated.js';
import type { IRpcCaller } from '../rpc/types.js';

export interface TruncateSubmitOptions {
  sessionId: string;
  text: string;
  truncateBeforeRowId?: number;
  truncateBeforeMessageId?: string;
  profile?: string;
}

export interface ForkBranchOptions {
  sessionId: string;
  count: number;
  name?: string;
  profile?: string;
}

export class InteractiveService {
  /**
   * 历史节点截断并重新生成 (Truncate & Regenerate)
   */
  public async truncateAndSubmit(
    bridge: IRpcCaller,
    options: TruncateSubmitOptions
  ): Promise<PromptSubmitResult> {
    if (!options.sessionId) {
      throw new Error('Session ID is mandatory for truncateAndSubmit');
    }
    if (!options.truncateBeforeRowId && !options.truncateBeforeMessageId) {
      throw new Error('truncateBeforeRowId or truncateBeforeMessageId is mandatory for truncation');
    }

    const params: PromptSubmitParams = {
      session_id: options.sessionId,
      text: options.text,
      confirm_truncate: true,
      truncate_before_row_id: options.truncateBeforeRowId ?? null,
      truncate_before_message_id: options.truncateBeforeMessageId ?? null,
      profile: options.profile ?? null,
    };

    return bridge.request<PromptSubmitResult, PromptSubmitParams>('prompt.submit', params);
  }

  /**
   * 单步撤销最近一轮对话 (Stack Undo)
   */
  public async undoLastTurn(
    bridge: IRpcCaller,
    sessionId: string,
    profile?: string
  ): Promise<SessionUndoResult> {
    if (!sessionId) {
      throw new Error('Session ID is mandatory for undoLastTurn');
    }
    const params: SessionUndoParams = {
      session_id: sessionId,
      intent: 'undo',
      profile: profile ?? null,
    };
    return bridge.request<SessionUndoResult, SessionUndoParams>('session.undo', params);
  }

  /**
   * 基于当前消息节点分叉派生全新独立会话 (Fork Branch)
   */
  public async forkSession(
    bridge: IRpcCaller,
    options: ForkBranchOptions
  ): Promise<SessionBranchResult> {
    if (!options.sessionId) {
      throw new Error('Session ID is mandatory for forkSession');
    }
    if (typeof options.count !== 'number' || options.count < 0) {
      throw new Error('Valid message count is mandatory for forkSession');
    }

    const params: SessionBranchParams = {
      session_id: options.sessionId,
      count: options.count,
      name: options.name ?? null,
      profile: options.profile ?? null,
    };

    return bridge.request<SessionBranchResult, SessionBranchParams>('session.branch', params);
  }

  /**
   * 运行时轻量纠偏 (In-Flight Steering)
   */
  public async steerSession(
    bridge: IRpcCaller,
    sessionId: string,
    text: string,
    profile?: string
  ): Promise<SessionCorrectionResult> {
    if (!sessionId || !text) {
      throw new Error('Session ID and text are mandatory for steerSession');
    }

    const params: SessionCorrectionParams = {
      session_id: sessionId,
      text,
      profile: profile ?? null,
    };

    return bridge.request<SessionCorrectionResult, SessionCorrectionParams>('session.steer', params);
  }

  /**
   * 紧急打断当前 Agent 任务 (Interrupt)
   */
  public async interruptSession(
    bridge: IRpcCaller,
    sessionId: string,
    profile?: string
  ): Promise<SessionInterruptResult> {
    if (!sessionId) {
      throw new Error('Session ID is mandatory for interruptSession');
    }

    const params: SessionInterruptParams = {
      session_id: sessionId,
      profile: profile ?? null,
    };

    return bridge.request<SessionInterruptResult, SessionInterruptParams>('session.interrupt', params);
  }

  /**
   * 拉取斜杠命令与技能目录 (Commands & Skills Catalog)
   */
  public async getCommandsCatalog(
    bridge: IRpcCaller,
    sessionId?: string,
    profile?: string
  ): Promise<CommandsCatalogResult> {
    const params: CommandsCatalogParams = {
      session_id: sessionId ?? null,
      profile: profile ?? null,
    };

    return bridge.request<CommandsCatalogResult, CommandsCatalogParams>('commands.catalog', params);
  }

  /**
   * 获取会话 Token 用量与上下文水位指标 (Usage & Context Gauge)
   */
  public async getSessionUsage(
    bridge: IRpcCaller,
    sessionId: string,
    profile?: string
  ): Promise<SessionUsageResult> {
    if (!sessionId) {
      throw new Error('Session ID is mandatory for getSessionUsage');
    }
    return bridge.request<SessionUsageResult, { session_id: string; profile?: string | null }>(
      'session.usage',
      { session_id: sessionId, profile: profile ?? null }
    );
  }
}

export const interactiveService = new InteractiveService();
