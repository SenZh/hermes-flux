/**
 * 多房间并发群聊日志轮询管理器 (packages/core/src/group/groupLogPollerManager.ts)
 *
 * 【设计意图 (Why)】
 *   多 Agent 群聊发送消息后需要持续轮询 `groups.log` 等待成员回复。
 *   将轮询生命周期下沉到纯 TypeScript 管理器，按 `roomId` 物理隔离并发房间，
 *   并通过可注入调度器与基线快照比较，消除视图层单槽位定时器相互踩踏与误判完成的问题。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 全局单定时器缺陷：用户先在群 A 发言、切去群 B 发言，新定时器直接覆盖旧定时器，
 *      导致群 A 永久停在 `running`。本管理器按 `roomId` 独立维护任务，互不取消。
 *   2. 虚假完成（lastCount = -1 退化）：仅对比消息总数增加就把刚落盘的 `user` 消息
 *      当成助手回复并过早结束转圈。必须严格基于 `captureGroupLogBaseline` 与
 *      `hasNewAssistantReply` 识别新增非用户发言。
 *   3. 在途请求乱序覆盖：同房间快速重发时，前一轮未决的 `fetchLogs` 迟滞返回会覆盖新状态，
 *      必须由每房间单调递增 `generation` 执行 CAS 守卫。
 *
 * 【约束与规则 (Rules)】
 *   - 纯 TypeScript 实现，零 DOM / 零 `window` 依赖；
 *   - `fetchLogs` 抛错不得静默吞为完成，计入空转次数直至达到阈值显式触发 `onFailed`；
 *   - 聚焦态首个助手回复立即调用一次 `onCompleted(roomId, true)` 解除 `running`，
 *     随后最多连续观察 2 轮无新增即退出，期间绝不重复触发 `onCompleted` 或补发 `onFailed`。
 */

export interface GroupLogPollEntry {
  messageId?: string;
  seq?: number;
  actorKind?: string;
  senderProfile?: string;
}

export interface GroupLogBaseline {
  knownCount: number;
  lastSeq: number;
  lastAssistantMessageId: string | null;
}

export interface GroupLogPollScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface GroupLogPollerOptions<TEntry extends GroupLogPollEntry = GroupLogPollEntry> {
  fetchLogs: (roomId: string) => Promise<readonly TEntry[]>;
  isFocused: (roomId: string) => boolean;
  onSyncLogs: (roomId: string, logs: readonly TEntry[]) => void;
  onCompleted: (roomId: string, isFocused: boolean) => void;
  onFailed: (roomId: string) => void;
  scheduler?: GroupLogPollScheduler;
  maxRounds?: number;
  maxStagnantRounds?: number;
  intervalMs?: number;
  backoffIntervalMs?: number;
}

interface RoomPollSnapshot {
  count: number;
  lastSeq: number;
  tailId: string | null;
}

interface RoomPollTask {
  roomId: string;
  generation: number;
  baseline: GroupLogBaseline;
  round: number;
  stagnantCount: number;
  prevSnapshot: RoomPollSnapshot | null;
  settledFocusedCompletion: boolean;
  focusedIdleRoundsAfterReply: number;
  timerHandle: unknown | null;
  cancelled: boolean;
}

function isNonUserEntry(entry: GroupLogPollEntry): boolean {
  return entry.actorKind !== 'user' && entry.senderProfile !== 'user';
}

function resolveMaxSeq(logs: readonly GroupLogPollEntry[]): number {
  let maxSeq = 0;
  let found = false;
  for (const entry of logs) {
    if (typeof entry.seq === 'number' && Number.isFinite(entry.seq)) {
      if (!found || entry.seq > maxSeq) {
        maxSeq = entry.seq;
        found = true;
      }
    }
  }
  return found ? maxSeq : 0;
}

function resolveLastNonUserMessageId(logs: readonly GroupLogPollEntry[]): string | null {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i];
    if (isNonUserEntry(entry)) {
      return entry.messageId || null;
    }
  }
  return null;
}

/**
 * 采集发送前的群聊日志基线，用于后续精确判别是否出现新的非用户回复。
 */
export function captureGroupLogBaseline(logs: readonly GroupLogPollEntry[]): GroupLogBaseline {
  return {
    knownCount: logs.length,
    lastSeq: resolveMaxSeq(logs),
    lastAssistantMessageId: resolveLastNonUserMessageId(logs),
  };
}

/**
 * 判断日志流相较基线是否已经出现新的非用户回复。
 * 严格排除仅新增 user 消息导致的计数/序号上升。
 */
export function hasNewAssistantReply(
  logs: readonly GroupLogPollEntry[],
  baseline: GroupLogBaseline
): boolean {
  const startIdx = baseline.knownCount > 0 ? baseline.knownCount : 0;
  const tailSlice = logs.slice(startIdx);
  if (tailSlice.some(isNonUserEntry)) {
    return true;
  }

  for (const entry of logs) {
    if (
      isNonUserEntry(entry) &&
      typeof entry.seq === 'number' &&
      Number.isFinite(entry.seq) &&
      entry.seq > baseline.lastSeq
    ) {
      return true;
    }
  }

  const lastAssistantId = resolveLastNonUserMessageId(logs);
  if (lastAssistantId && lastAssistantId !== baseline.lastAssistantMessageId) {
    return true;
  }

  return false;
}

const DEFAULT_SCHEDULER: GroupLogPollScheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class GroupLogPollerManager<TEntry extends GroupLogPollEntry = GroupLogPollEntry> {
  private readonly options: GroupLogPollerOptions<TEntry>;
  private readonly scheduler: GroupLogPollScheduler;
  private readonly maxRounds: number;
  private readonly maxStagnantRounds: number;
  private readonly intervalMs: number;
  private readonly backoffIntervalMs: number;
  private readonly tasks = new Map<string, RoomPollTask>();
  private readonly roomGenerations = new Map<string, number>();

  constructor(options: GroupLogPollerOptions<TEntry>) {
    this.options = options;
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.maxRounds =
      typeof options.maxRounds === 'number' && Number.isFinite(options.maxRounds) && options.maxRounds >= 1
        ? Math.floor(options.maxRounds)
        : 30;
    this.maxStagnantRounds =
      typeof options.maxStagnantRounds === 'number' &&
      Number.isFinite(options.maxStagnantRounds) &&
      options.maxStagnantRounds >= 1
        ? Math.floor(options.maxStagnantRounds)
        : 20;
    this.intervalMs =
      typeof options.intervalMs === 'number' && Number.isFinite(options.intervalMs) && options.intervalMs >= 0
        ? options.intervalMs
        : 1200;
    this.backoffIntervalMs =
      typeof options.backoffIntervalMs === 'number' &&
      Number.isFinite(options.backoffIntervalMs) &&
      options.backoffIntervalMs >= 0
        ? options.backoffIntervalMs
        : 2000;
  }

  public startAwaitReply(roomId: string, baseline: GroupLogBaseline): void {
    if (!roomId) return;
    this.stop(roomId);

    const generation = (this.roomGenerations.get(roomId) ?? 0) + 1;
    this.roomGenerations.set(roomId, generation);

    const task: RoomPollTask = {
      roomId,
      generation,
      baseline: {
        knownCount: baseline.knownCount,
        lastSeq: baseline.lastSeq,
        lastAssistantMessageId: baseline.lastAssistantMessageId,
      },
      round: 0,
      stagnantCount: 0,
      prevSnapshot: null,
      settledFocusedCompletion: false,
      focusedIdleRoundsAfterReply: 0,
      timerHandle: null,
      cancelled: false,
    };

    this.tasks.set(roomId, task);
    this.scheduleNext(task, this.intervalMs);
  }

  public stop(roomId: string): void {
    if (!roomId) return;
    const task = this.tasks.get(roomId);
    if (!task) return;
    this.cleanupTask(task);
  }

  public stopAll(): void {
    for (const roomId of [...this.tasks.keys()]) {
      this.stop(roomId);
    }
  }

  public isPolling(roomId: string): boolean {
    if (!roomId) return false;
    const task = this.tasks.get(roomId);
    return Boolean(task && !task.cancelled);
  }

  private isCurrentTask(task: RoomPollTask): boolean {
    if (task.cancelled) return false;
    const active = this.tasks.get(task.roomId);
    return active === task && this.roomGenerations.get(task.roomId) === task.generation;
  }

  private cleanupTask(task: RoomPollTask): void {
    task.cancelled = true;
    if (task.timerHandle !== null) {
      this.scheduler.clearTimeout(task.timerHandle);
      task.timerHandle = null;
    }
    if (this.tasks.get(task.roomId) === task) {
      this.tasks.delete(task.roomId);
    }
  }

  private scheduleNext(task: RoomPollTask, delayMs: number): void {
    if (!this.isCurrentTask(task)) return;
    if (task.timerHandle !== null) {
      this.scheduler.clearTimeout(task.timerHandle);
      task.timerHandle = null;
    }
    task.timerHandle = this.scheduler.setTimeout(() => {
      task.timerHandle = null;
      if (!this.isCurrentTask(task)) return;
      void this.executeRound(task);
    }, delayMs);
  }

  private updateRoundProgress(task: RoomPollTask, logs: readonly TEntry[]): boolean {
    const count = logs.length;
    const lastSeq = resolveMaxSeq(logs);
    const tailId = count > 0 ? (logs[count - 1]?.messageId ?? null) : null;

    let progressed: boolean;
    if (task.prevSnapshot === null) {
      const lastNonUserId = resolveLastNonUserMessageId(logs);
      progressed =
        count !== task.baseline.knownCount ||
        lastSeq !== task.baseline.lastSeq ||
        lastNonUserId !== task.baseline.lastAssistantMessageId;
    } else {
      progressed =
        count !== task.prevSnapshot.count ||
        lastSeq !== task.prevSnapshot.lastSeq ||
        tailId !== task.prevSnapshot.tailId;
    }

    task.prevSnapshot = { count, lastSeq, tailId };
    if (progressed) {
      task.stagnantCount = 0;
    } else {
      task.stagnantCount += 1;
    }
    return progressed;
  }

  private shouldFailNow(task: RoomPollTask): boolean {
    return task.stagnantCount >= this.maxStagnantRounds || task.round >= this.maxRounds;
  }

  private async executeRound(task: RoomPollTask): Promise<void> {
    if (!this.isCurrentTask(task)) return;
    task.round += 1;

    let logs: readonly TEntry[];
    try {
      logs = await this.options.fetchLogs(task.roomId);
    } catch (err) {
      if (!this.isCurrentTask(task)) return;
      void err;
      if (task.settledFocusedCompletion) {
        task.focusedIdleRoundsAfterReply += 1;
        if (task.focusedIdleRoundsAfterReply >= 2 || task.round >= this.maxRounds) {
          this.cleanupTask(task);
          return;
        }
        this.scheduleNext(task, this.intervalMs);
        return;
      }

      task.stagnantCount += 1;
      if (this.shouldFailNow(task)) {
        this.cleanupTask(task);
        this.options.onFailed(task.roomId);
        return;
      }
      const nextDelay = task.stagnantCount > 2 ? this.backoffIntervalMs : this.intervalMs;
      this.scheduleNext(task, nextDelay);
      return;
    }

    if (!this.isCurrentTask(task)) return;
    this.options.onSyncLogs(task.roomId, logs);
    if (!this.isCurrentTask(task)) return;

    const progressed = this.updateRoundProgress(task, logs);
    const replied = hasNewAssistantReply(logs, task.baseline);
    const focused = this.options.isFocused(task.roomId);

    if (replied) {
      if (!task.settledFocusedCompletion) {
        if (!focused) {
          this.cleanupTask(task);
          this.options.onCompleted(task.roomId, false);
          return;
        }
        task.settledFocusedCompletion = true;
        task.focusedIdleRoundsAfterReply = 0;
        this.options.onCompleted(task.roomId, true);
        if (!this.isCurrentTask(task)) return;
        if (task.round >= this.maxRounds) {
          this.cleanupTask(task);
          return;
        }
        this.scheduleNext(task, this.intervalMs);
        return;
      }

      if (progressed) {
        task.focusedIdleRoundsAfterReply = 0;
      } else {
        task.focusedIdleRoundsAfterReply += 1;
      }

      if (task.focusedIdleRoundsAfterReply >= 2 || task.round >= this.maxRounds) {
        this.cleanupTask(task);
        return;
      }
      this.scheduleNext(task, this.intervalMs);
      return;
    }

    if (this.shouldFailNow(task)) {
      this.cleanupTask(task);
      this.options.onFailed(task.roomId);
      return;
    }

    const nextDelay = task.stagnantCount > 2 ? this.backoffIntervalMs : this.intervalMs;
    this.scheduleNext(task, nextDelay);
  }
}
