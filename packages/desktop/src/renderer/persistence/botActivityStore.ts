/**
 * Bot 主工位最新交互的持久化。
 *
 * 【设计意图 (Why)】
 *   专职 Bot 的主工位（Forever Chat）状态与普通旁聊会话严格正交。
 *   这里持久化各 Bot 主工位的最后真实对话文本与时间戳，杜绝冷启动与页面刷新时
 *   因网络异步延迟而闪现旧时间戳、或被普通会话池串扰。
 *
 * 【从 index.ts 抽出的理由】
 *   该领域只依赖一个注入点（profile 列表的读写）与一个纯格式化函数，
 *   没有与宿主共享的可变状态，因此可以整簇搬走并独立测试。
 *   抽出前它藏在 12000 行的入口文件里，从未被任何测试直接执行。
 *
 * 【防范的历史坑 (Pitfall)】
 *   历史上该 Map 仅为纯内存 Map，刷新页面后丢失，导致冷启动探查阶段回退到
 *   普通会话池，把无关旁聊的时间和副标题覆盖到专职 Bot 卡片上。
 *
 * 【约束与规则 (Rules)】
 *   1. 读写全部经由 `updateLatestActivity` 收敛，严禁在业务各处私自修改 Map。
 *   2. 存储损坏或不可用时必须平滑回退，不得中断启动（Failure Is Not Empty 的反面：
 *      可选加速失败不该阻断主流程，但必须可见）。
 *   3. 时间戳必须经 core 的纯函数归一化，不在此处做任何时间解析。
 */

import { applyBotActivity } from '@hermes-flux/core';
import type { AgentProfile, BotActivityRecord } from '@hermes-flux/core';

export const BOT_ACTIVITY_PERSISTENCE_KEY = 'hermes_flux_bot_activity';

interface PersistedBotActivityRecord {
  lastMessage?: string;
  timestamp?: number;
}

/** 宿主任���：本领域只需要读写 Agent 档案列表 */
export interface BotActivityHost {
  /** 读取当前 profile 列表（不可变快照） */
  profiles(): readonly AgentProfile[];
  /** 回写更新后的 profile 列表 */
  setProfiles(next: AgentProfile[]): void;
  /** 时间格式化（由宿主注入，保持与列表其它位置同一口径） */
  formatTime(timestamp: number): string;
  /** 持久化落盘失败的观测通道（不得静默） */
  onPersistError?(error: unknown): void;
}

export interface BotActivityStore {
  /** 从存储恢复（启动时调用一次） */
  restore(): void;
  /** 原子更新指定 Bot 的最新交互状态并落盘 */
  updateLatestActivity(botName: string, text: string, rawTimestamp: number | string): void;
  /** 只读快照（供测试与诊断） */
  snapshot(): ReadonlyMap<string, BotActivityRecord>;
  /**
   * 把内部映射表借给 core 的纯函数使用，并在之后落盘。
   *
   * 【设计意图 (Why)】`syncBotProfiles` 与 `syncActiveSessionToBot` 的契约要求
   *   直接拿到这张 Map（它们要写入归一化后的时间戳）。若这里返回副本，
   *   core 写进副本的内容不会回到 store，两份状态立刻分裂；
   *   而让宿主自己 new 一份 Map 又会彻底丢掉持久化。
   *
   * 【约束与规则 (Rules)】只允许「同一次同步中先借用、再落盘」这一个用法：
   *   借用方不得跨调用持有该引用，否则它就变成了绕过 updateLatestActivity 的后门。
   */
  withActivityMap<T>(fn: (map: Map<string, BotActivityRecord>) => T): T;
  /** 落盘（供借用 Map 之后调用） */
  persist(): void;
}

export function createBotActivityStore(host: BotActivityHost): BotActivityStore {
  const activityMap = new Map<string, BotActivityRecord>();

  function restore(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BOT_ACTIVITY_PERSISTENCE_KEY) : null;
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!v || typeof v !== 'object' || !('timestamp' in v)) continue;
        const rec = v as PersistedBotActivityRecord;
        if (typeof rec.timestamp !== 'number') continue;
        activityMap.set(k, {
          lastMessage: String(rec.lastMessage || ''),
          timestamp: rec.timestamp,
        });
      }
    } catch (err) {
      // gate-degrade: 本地存储损坏或不可用时不中断启动，平滑回退到网络状态
      host.onPersistError?.(err);
    }
  }

  function persist(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const obj: Record<string, PersistedBotActivityRecord> = {};
      for (const [k, v] of activityMap.entries()) obj[k] = v;
      localStorage.setItem(BOT_ACTIVITY_PERSISTENCE_KEY, JSON.stringify(obj));
    } catch (err) {
      // gate-degrade: 存储配额超限或无写权限时静默降级，不阻断主线程
      host.onPersistError?.(err);
    }
  }

  /**
   * 原子性更新指定 Bot 的主工位最新交互状态。
   *
   * 【规则】归一化与排序全部委托给 core 的 `applyBotActivity`：
   *   时间戳畸变、序号单调性这些性质已有形式化不变量守护（见 invariants.json），
   *   在渲染层重新实现一份只会让两套口径漂移。
   */
  function updateLatestActivity(botName: string, text: string, rawTimestamp: number | string): void {
    const res = applyBotActivity({
      profiles: [...host.profiles()],
      activityMap,
      botName,
      text,
      timestamp: rawTimestamp,
      formatTime: host.formatTime,
    });
    host.setProfiles(res.profiles);
    persist();
  }

  return {
    restore,
    updateLatestActivity,
    snapshot: () => activityMap,
    withActivityMap: (fn) => fn(activityMap),
    persist,
  };
}
