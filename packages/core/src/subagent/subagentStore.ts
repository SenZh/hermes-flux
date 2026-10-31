/**
 * Subagent Delegation State Controller & Stream Runtime
 * (packages/core/src/subagent/subagentStore.ts)
 *
 * 设计意图 (Why):
 *   为了让全平台（Desktop / Mobile / Web）能够以 100% 相同的数据流驱动：
 *   1. 主会话消息流中展示正在执行的「子代理委派卡片」；
 *   2. 用户点击后穿透打开「独立执行对话框/终端」并实时渲染 tail 流；
 *   3. 用户能够对运行中的子代理发送 steer 干预指令或 interrupt 中断指令。
 *   必须将该纯业务状态流沉淀在 packages/core，零 DOM / React / Electron 耦合。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 丢失实体句柄：严禁把 subagent 降级为单次普通 tool，必须保留 subagentId 实体生命周期。
 *   2. 穿透流内存泄漏：为每个活跃子代理独立维护定长 RingBuffer，防止日志无限膨胀导致 OOM。
 *   3. 竞态重入：点击 interrupt 时采用乐观锁防止高频重复点击，并自动置灰。
 *
 * 约束与规则 (Rules):
 *   - 纯 TypeScript，零外部或宿主 DOM 依赖。
 *   - 通过 subscribe 监听器向表现层广播状态变化。
 */

import type {
  SubagentTaskState,
  SubagentLogEntry,
  SubagentStatus,
  SubagentSpawnParams,
  SubagentSpawnResult,
  SubagentSteerParams,
  SubagentSteerResult,
  SubagentInterruptParams,
  SubagentInterruptResult,
  SubagentListResult,
  SubagentTailResult,
} from '../rpc/types.js';
import { RingBuffer } from './ringBuffer.js';

export interface ISubagentRpcBridge {
  request<TResult = unknown, TParams = unknown>(method: string, params?: TParams): Promise<TResult>;
}

export type SubagentStateListener = (tasks: ReadonlyMap<string, SubagentTaskState>) => void;
export type SubagentTailListener = (entry: SubagentLogEntry) => void;

export class SubagentStore {
  /**
   * 活跃任务索引映射：subagentId -> SubagentTaskState
   */
  private tasks = new Map<string, SubagentTaskState>();

  /**
   * 日志流环形缓冲区映射：subagentId -> RingBuffer<SubagentLogEntry>
   */
  private tailBuffers = new Map<string, RingBuffer<SubagentLogEntry>>();

  /**
   * 全局状态监听器（驱动卡片与列表）
   */
  private listeners = new Set<SubagentStateListener>();

  /**
   * 正在穿透查看中的子代理流监听器：subagentId -> Set<SubagentTailListener>
   */
  private tailListeners = new Map<string, Set<SubagentTailListener>>();

  /**
   * 正在穿透查看中的活跃 subagentId
   */
  private activeTailSubagentId: string | null = null;

  constructor(private readonly maxLogCapacity = 1000) {}

  /**
   * 订阅子代理任务状态变化
   */
  public subscribe(listener: SubagentStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 订阅指定子代理的穿透日志流
   */
  public subscribeTail(subagentId: string, listener: SubagentTailListener): () => void {
    let set = this.tailListeners.get(subagentId);
    if (!set) {
      set = new Set();
      this.tailListeners.set(subagentId, set);
    }
    set.add(listener);

    return () => {
      const currentSet = this.tailListeners.get(subagentId);
      if (currentSet) {
        currentSet.delete(listener);
        if (currentSet.size === 0) {
          this.tailListeners.delete(subagentId);
        }
      }
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.tasks);
    }
  }

  /**
   * 获取指定会话下的所有子代理任务列表（按开始时间倒序）
   */
  public getTasksBySession(sessionId: string): SubagentTaskState[] {
    const list: SubagentTaskState[] = [];
    for (const task of this.tasks.values()) {
      if (task.parentSessionId === sessionId) {
        list.push({ ...task });
      }
    }
    return list.sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * 获取单个子代理任务详情
   */
  public getTask(subagentId: string): SubagentTaskState | undefined {
    const task = this.tasks.get(subagentId);
    return task ? { ...task } : undefined;
  }

  /**
   * 获取指定子代理当前已缓存的所有日志（严格时间先后顺序）
   */
  public getLogs(subagentId: string): SubagentLogEntry[] {
    const buffer = this.tailBuffers.get(subagentId);
    return buffer ? buffer.toArray() : [];
  }

  /**
   * 设置当前选中的穿透查看目标
   */
  public setActiveTailTarget(subagentId: string | null): void {
    this.activeTailSubagentId = subagentId;
  }

  public getActiveTailTarget(): string | null {
    return this.activeTailSubagentId;
  }

  /**
   * 写入或更新子代理状态（支持网关推送与 RPC 增量触发）
   */
  public upsertTask(taskPatch: Partial<SubagentTaskState> & { subagentId: string }): SubagentTaskState {
    const now = Date.now();
    const existing = this.tasks.get(taskPatch.subagentId);

    const updated: SubagentTaskState = {
      subagentId: taskPatch.subagentId,
      parentSessionId: taskPatch.parentSessionId || existing?.parentSessionId || '',
      targetProfile: taskPatch.targetProfile || existing?.targetProfile || 'default',
      taskTitle: taskPatch.taskTitle || existing?.taskTitle || '子任务执行',
      status: taskPatch.status || existing?.status || 'requested',
      progressPercent: taskPatch.progressPercent !== undefined ? taskPatch.progressPercent : existing?.progressPercent || 0,
      currentActionText: taskPatch.currentActionText || existing?.currentActionText || '',
      startedAt: existing?.startedAt || taskPatch.startedAt || now,
      updatedAt: now,
      completedAt: taskPatch.completedAt || existing?.completedAt,
      resultSummary: taskPatch.resultSummary !== undefined ? taskPatch.resultSummary : existing?.resultSummary,
      error: taskPatch.error !== undefined ? taskPatch.error : existing?.error,
    };

    this.tasks.set(taskPatch.subagentId, updated);
    this.notify();
    return updated;
  }

  /**
   * 向指定子代理追加一条日志（写入 RingBuffer 并广播给活跃 tail 监听器）
   */
  public appendLog(subagentId: string, entry: SubagentLogEntry): void {
    let buffer = this.tailBuffers.get(subagentId);
    if (!buffer) {
      buffer = new RingBuffer<SubagentLogEntry>(this.maxLogCapacity);
      this.tailBuffers.set(subagentId, buffer);
    }
    buffer.push(entry);

    // 广播给穿透日志视图监听器
    const listeners = this.tailListeners.get(subagentId);
    if (listeners) {
      for (const listener of listeners) {
        listener(entry);
      }
    }
  }

  /**
   * 派生并启动一个新子代理 (subagent.spawn)
   */
  public async spawnSubagent(
    params: SubagentSpawnParams,
    bridge: ISubagentRpcBridge
  ): Promise<SubagentTaskState> {
    const now = Date.now();
    // 先在本地建立 requested 占位，保证 UI 秒开无等待反馈
    const tempId = `sub-${now}-${Math.random().toString(36).slice(2, 7)}`;
    this.upsertTask({
      subagentId: tempId,
      parentSessionId: params.parent_session_id,
      targetProfile: params.target_profile,
      taskTitle: params.task_title,
      status: 'requested',
      progressPercent: 5,
      currentActionText: '正在唤起子代理沙箱...',
      startedAt: now,
    });

    try {
      const res = await bridge.request<SubagentSpawnResult, SubagentSpawnParams>('subagent.spawn', params);
      const realId = res.subagent_id || tempId;

      if (realId !== tempId) {
        this.tasks.delete(tempId);
      }

      return this.upsertTask({
        subagentId: realId,
        parentSessionId: params.parent_session_id,
        targetProfile: params.target_profile,
        taskTitle: params.task_title,
        status: res.status || 'running',
        progressPercent: 10,
        currentActionText: '子代理沙箱已挂载，开始执行...',
        startedAt: now,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.upsertTask({
        subagentId: tempId,
        status: 'failed',
        error: errMsg,
        currentActionText: `唤起失败: ${errMsg}`,
      });
      throw err;
    }
  }

  /**
   * 向运行中的子代理发送干预纠偏指令 (subagent.steer)
   */
  public async steerSubagent(
    subagentId: string,
    instruction: string,
    bridge: ISubagentRpcBridge
  ): Promise<boolean> {
    const task = this.tasks.get(subagentId);
    if (!task) {
      throw new Error(`Subagent task not found: ${subagentId}`);
    }

    // 在本地日志流追加一条干预标记
    this.appendLog(subagentId, {
      seq: Date.now(),
      timestamp: Date.now(),
      kind: 'status_change',
      text: `[用户实时干预指令]: ${instruction}`,
    });

    const res = await bridge.request<SubagentSteerResult, SubagentSteerParams>('subagent.steer', {
      subagent_id: subagentId,
      session_id: task.parentSessionId,
      instruction,
      text: instruction,
    });

    const isAccepted = Boolean(res.accepted || res.status === 'queued');
    if (isAccepted) {
      this.upsertTask({
        subagentId,
        currentActionText: `已下发干预指令: ${instruction.slice(0, 30)}...`,
      });
    }

    return isAccepted;
  }

  /**
   * 中断终止正在执行的子代理 (subagent.interrupt)
   */
  public async interruptSubagent(
    subagentId: string,
    bridge: ISubagentRpcBridge
  ): Promise<boolean> {
    const task = this.tasks.get(subagentId);
    if (!task) return false;

    // 乐观锁：立即将界面状态置为 interrupted，防止用户重复狂点
    this.upsertTask({
      subagentId,
      status: 'interrupted',
      currentActionText: '用户已终止任务',
      completedAt: Date.now(),
    });

    try {
      const res = await bridge.request<SubagentInterruptResult, SubagentInterruptParams>('subagent.interrupt', {
        subagent_id: subagentId,
        session_id: task.parentSessionId,
      });
      return Boolean(res.interrupted || res.found);
    } catch (err) {
      // 记录错误但保持终止标记
      const errMsg = err instanceof Error ? err.message : String(err);
      this.appendLog(subagentId, {
        seq: Date.now(),
        timestamp: Date.now(),
        kind: 'stderr',
        text: `终止指令发送失败: ${errMsg}`,
      });
      return false;
    }
  }

  /**
   * 从网关拉取并同步指定会话的子代理列表（断线重连、冷启动恢复）
   */
  public async syncSessionSubagents(sessionId: string, bridge: ISubagentRpcBridge): Promise<void> {
    if (!sessionId) return;
    try {
      const res = await bridge.request<SubagentListResult>('subagent.list', { session_id: sessionId });
      if (res && Array.isArray(res.subagents)) {
        for (const item of res.subagents) {
          this.upsertTask({
            subagentId: item.subagent_id,
            parentSessionId: item.parent_session_id || sessionId,
            targetProfile: item.profile || 'default',
            taskTitle: item.title || '子任务',
            status: item.status,
            progressPercent: item.progress || 0,
            currentActionText: item.current_action || '',
            startedAt: item.started_at || Date.now(),
            updatedAt: item.updated_at || Date.now(),
          });
        }
      }
    } catch {
      // 保持静默，不破坏离线状态
    }
  }

  /**
   * 穿透加载子代理的历史日志 (subagent.tail)
   * 适配官方 Gateway 返回结构：text / available 与 entries 数组
   */
  public async loadSubagentTail(subagentId: string, bridge: ISubagentRpcBridge, limit = 100): Promise<SubagentLogEntry[]> {
    const task = this.tasks.get(subagentId);
    try {
      const res = await bridge.request<SubagentTailResult>('subagent.tail', {
        subagent_id: subagentId,
        session_id: task?.parentSessionId,
        limit,
      });
      if (res && Array.isArray(res.entries)) {
        for (const entry of res.entries) {
          this.appendLog(subagentId, entry);
        }
      } else if (res && typeof res.text === 'string' && res.text) {
        this.appendLog(subagentId, {
          seq: Date.now(),
          timestamp: Date.now(),
          kind: 'stdout',
          text: res.text,
        });
      }
    } catch {
      // 降级为本地已有的日志缓存
    }
    return this.getLogs(subagentId);
  }

  /**
   * 清理已完成或已废弃的子代理缓存
   */
  public clearSession(sessionId: string): void {
    const idsToDelete: string[] = [];
    for (const [id, task] of this.tasks.entries()) {
      if (task.parentSessionId === sessionId) {
        idsToDelete.push(id);
      }
    }
    for (const id of idsToDelete) {
      this.tasks.delete(id);
      this.tailBuffers.delete(id);
      this.tailListeners.delete(id);
    }
    if (idsToDelete.length > 0) {
      this.notify();
    }
  }
}
