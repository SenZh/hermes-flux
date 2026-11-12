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
  CompleteSlashParams,
  CompleteSlashResult,
  CompletePathParams,
  CompletionItemsResult,
  SlashExecParams,
  SlashExecResult,
  SessionUsageResult,
  AdmissionStatus,
  CanonicalSteerQueuedParams,
  PromptCancelParams,
} from '../rpc/contracts/gateway-contract.generated.js';
import type { IRpcCaller } from '../rpc/types.js';
import { isClientTempId, isDurableRowId } from './truncatePlan.js';

export interface TruncateSubmitOptions {
  sessionId: string;
  text: string;
  /** 网关持久行地址（首选锚点） */
  rowId?: number;
  /** 服务端签发字符串锚点（窄回退；本地临时主键会被拒绝） */
  messageId?: string;
  confirmEmpty?: boolean;
  profile?: string;
}

export interface ForkBranchOptions {
  sessionId: string;
  count: number;
  name?: string;
  profile?: string;
  /** 重试幂等键：同一次用户点击的自动重试不得派生两个会话 */
  idempotencyKey?: string;
}

export class InteractiveService {
  /**
   * 历史节点截断并重新生成 (Truncate & Regenerate)
   *
   * 【防范的历史坑 (Pitfall)】
   * 双锚点同发或把前端临时 id（usr-*）当 message_id 透传，网关必回 4018；
   * 契约要求 “explicit consent plus ONE durable target”，本方法是 wire 载荷唯一构造点。
   *
   * 【约束与规则 (Rules)】
   * rowId 与 messageId 严格互斥；二者皆无或非法一律抛错拒绝，绝不静默降级。
   */
  public async truncateAndSubmit(
    bridge: IRpcCaller,
    options: TruncateSubmitOptions
  ): Promise<PromptSubmitResult> {
    if (!options.sessionId) {
      throw new Error('Session ID is mandatory for truncateAndSubmit');
    }

    const params: PromptSubmitParams = {
      session_id: options.sessionId,
      text: options.text,
      confirm_truncate: true,
      profile: options.profile ?? null,
    };

    if (isDurableRowId(options.rowId)) {
      params.truncate_before_row_id = options.rowId;
    } else if (typeof options.messageId === 'string' && options.messageId.length > 0 && !isClientTempId(options.messageId)) {
      // 服务端签发字符串锚点窄通道；usr-/ast- 等本地主键被 isClientTempId 坚决拒绝
      params.truncate_before_message_id = options.messageId;
    } else {
      throw new Error('truncate requires one durable target (rowId or server-issued messageId); client temp ids are forbidden');
    }

    if (options.confirmEmpty) {
      params.confirm_empty_truncate = true;
    }

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
      idempotency_key: options.idempotencyKey ?? null,
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
   * 斜杠命令实时补全（complete.slash）。
   * 【设计意图 (Why)】commands.catalog 的 skills 无描述且不绑定项目技能，
   * 补全必须以 complete.slash 为权威（携带 replace_from 供精确替换光标 token）。
   */
  public async getSlashCompletions(
    bridge: IRpcCaller,
    text: string,
    sessionId?: string,
    profile?: string
  ): Promise<CompleteSlashResult> {
    const params: CompleteSlashParams = {
      text,
      session_id: sessionId ?? null,
      profile: profile ?? null,
    };
    return bridge.request<CompleteSlashResult, CompleteSlashParams>('complete.slash', params);
  }

  /**
   * 文件路径补全（complete.path）。projects.tree 只返回项目/仓库/会话节点、不含文件，
   * 文件检索唯一通道是 complete.path。
   */
  public async getPathCompletions(
    bridge: IRpcCaller,
    word: string,
    cwd?: string,
    sessionId?: string,
    profile?: string
  ): Promise<CompletionItemsResult> {
    const params: CompletePathParams = {
      word,
      cwd: cwd ?? null,
      session_id: sessionId ?? null,
      profile: profile ?? null,
    };
    return bridge.request<CompletionItemsResult, CompletePathParams>('complete.path', params);
  }

  /**
   * 执行斜杠命令（slash.exec）。按 DispatchType 分派，不臆造语义：
   * exec/plugin→output，alias→target，send/prefill/skill→message（UI 展示 display，绝不展示 message 原文）。
   */
  public async execSlash(
    bridge: IRpcCaller,
    sessionId: string,
    command: string,
    profile?: string
  ): Promise<SlashExecResult> {
    if (!sessionId) {
      throw new Error('Session ID is mandatory for execSlash');
    }
    if (!command) {
      throw new Error('Command is mandatory for execSlash');
    }
    const params: SlashExecParams = {
      session_id: sessionId,
      command,
      profile: profile ?? null,
    };
    return bridge.request<SlashExecResult, SlashExecParams>('slash.exec', params);
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

  /**
   * 取消一条排队中的提示词 (Canonical Queue Cancel)
   *
   * 【设计意图 (Why)】
   *   Canonical 网关把排队项当作独立准入（`admission_id`），取消必须按准入撤销，
   *   而不是按会话或文本匹配——否则并发排队时会撤错条目。
   *
   * 【约束与规则 (Rules)】
   *   两个参数缺一即拒绝，绝不发出半截请求；返回准入状态供 UI 显式呈现。
   */
  public async cancelQueued(
    bridge: IRpcCaller,
    sessionId: string,
    admissionId: string
  ): Promise<AdmissionStatus> {
    if (!sessionId || !admissionId) {
      throw new Error('Session ID and admission ID are mandatory for cancelQueued');
    }
    const params: PromptCancelParams = { session_id: sessionId, admission_id: admissionId };
    return bridge.request<AdmissionStatus, PromptCancelParams>('prompt.cancel', params);
  }

  /**
   * 立即执行排队项 (Canonical Queue Steer)
   *
   * 【设计意图 (Why)】
   *   用户点「立即发送」时，期望它插到当前回合前面跑，而不是等当前回合自然结束。
   *   网关为此提供 `prompt.steer_queued`，按准入插入执行。
   *
   * 【约束与规则 (Rules)】只接受准入 id，不接受文本；改文本走「取消 + 放回输入舱」。
   */
  public async steerQueued(
    bridge: IRpcCaller,
    sessionId: string,
    admissionId: string,
    profile?: string
  ): Promise<AdmissionStatus> {
    if (!sessionId || !admissionId) {
      throw new Error('Session ID and admission ID are mandatory for steerQueued');
    }
    const params: CanonicalSteerQueuedParams = {
      session_id: sessionId,
      admission_id: admissionId,
      profile: profile ?? null,
    };
    return bridge.request<AdmissionStatus, CanonicalSteerQueuedParams>('prompt.steer_queued', params);
  }
}

export const interactiveService = new InteractiveService();
