/**
 * Session Handoff & BTW Isolated Capsule Service
 * (packages/core/src/session/handoffService.ts)
 *
 * 设计意图 (Why):
 *   当主会话探讨需要引入外部专职 Bot 时，存在截然不同的两种场景：
 *   1. 轻量外援（BTW 模式）：只是顺嘴向外部专家问一句话，不改变主线，
 *      通过官方 prompt.btw 获得只读胶囊，严格禁止污染主会话 Context Window。
 *   2. 全权接力（Handoff 模式）：需求明确后，将整个议题全权移交给专职 Bot 深入跟进，
 *      通过 session.branch_whole 无损整条派生新会话，建立父子血缘关系，原单聊原样留存。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 串味与权限越权：严禁在当前会话直接硬切 profile；接力必须派生新会话（New Session ID），
 *      新会话绑定 target_profile 的独立沙箱。
 *   2. BTW 污染 Context：BTW 的返回结果绝不能 push 进 message.delta，只作为独立 Card 呈现。
 *   3. 孤儿子会话：Handoff 产生的新会话必须强制记录 parent_session_id 与 lineage。
 *
 * 约束与规则 (Rules):
 *   - 纯 TypeScript 实现，零宿主 API 或 DOM 依赖。
 *   - 显式失败（Failure Is Not Empty）：网络异常必须显式抛出。
 */

import type {
  PromptBtwParams,
  PromptBtwResult,
  SessionBranchWholeParams,
  SessionBranchResult,
  SessionMetadataContract,
  IRpcCaller,
} from '../rpc/types.js';
import { createChildSessionMetadata } from './agentRouter.js';

export interface HandoffResult {
  newSessionId: string;
  parentSessionId: string;
  targetProfile: string;
  metadata: SessionMetadataContract;
  handoffNotice: string;
}

export class HandoffService {
  /**
   * 发送旁路轻量插话 (prompt.btw)
   *
   * 核心约束：
   *   该调用的应答仅作为外援胶囊独立渲染，严禁写入当前会话的上下文窗口！
   */
  public async sendBtw(
    sessionId: string,
    text: string,
    targetProfile: string,
    bridge: IRpcCaller
  ): Promise<PromptBtwResult> {
    if (!sessionId || !text) {
      throw new Error('Session ID and text are mandatory for sendBtw');
    }

    const res = await bridge.request<PromptBtwResult, PromptBtwParams>('prompt.btw', {
      session_id: sessionId,
      text,
      target_profile: targetProfile || 'default',
    });

    if (!res || typeof res.response !== 'string') {
      throw new Error('网关返回了非法的 prompt.btw 响应数据');
    }

    return res;
  }

  /**
   * 全权接力移交 (Handoff via session.branch_whole)
   *
   * 核心时序：
   *   1. 调用 session.branch_whole 整条分叉当前会话；
   *   2. 绑定目标 Bot Profile，建立父子血缘强契约元数据；
   *   3. 产出接力转交系统备忘录，原单聊完好归档留存。
   */
  public async handoffSession(
    sessionId: string,
    targetProfile: string,
    bridge: IRpcCaller,
    title?: string
  ): Promise<HandoffResult> {
    if (!sessionId || !targetProfile) {
      throw new Error('Session ID and target profile are mandatory for handoffSession');
    }

    // 官方 session.branch_whole 参数签名为 { session_id, name }
    const res = await bridge.request<SessionBranchResult, SessionBranchWholeParams>(
      'session.branch_whole',
      {
        session_id: sessionId,
        name: title || `接力移交至 @${targetProfile}`,
      }
    );

    const newSessionId = res.session_id;
    if (!newSessionId) {
      throw new Error('session.branch_whole 未返回合法的 new session_id');
    }

    // 建立父子血缘元数据
    const metadata = createChildSessionMetadata(sessionId, targetProfile, 'user');

    const handoffNotice = `已将当前会话全权接力移交至专职专家 [@${targetProfile}]。新派生工位 ID: ${newSessionId}`;

    return {
      newSessionId,
      parentSessionId: sessionId,
      targetProfile,
      metadata,
      handoffNotice,
    };
  }
}
