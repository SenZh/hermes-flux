/**
 * Agent 在场状态投影（packages/core/src/agent/agentPresence.ts）
 *
 * 【设计意图 (Why)】
 *   对话区顶部需要一个「Agent 现在在干什么」的拟人化指示器。它消费的全部是宿主已有的
 *   事实（是否流式、末条消息的思考/正文/工具、未收敛的子代理、错误、中断），
 *   但宿主渲染层历史上把这段投影写成了散落的 if/else + 英文机器串（thinking /
 *   writing response / reading a file），既无法单测，也无法在两端复用。
 *
 *   本模块把「事实 → 在场状态」收敛为一个纯函数，让表现层只负责把状态画出来。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 优先级错位：错误与中断是终态，若被在途的工具痕迹盖住，用户会看到一个已经死掉的
 *      回合继续显示「正在执行工具」；
 *   2. 双真值面：宿主曾同时用 `updateActivityPill`（模板注入）与 `InputDock.activityStatus`
 *      （组件渲染）两处投影同一状态，任一处漏更新就出现两套文案；
 *   3. 时长不分层：状态文案永远同一句，卡住 60 秒与刚开始 1 秒看起来完全一样。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯逻辑，零 DOM / 零 React / 零网络 / 零 i18n：本模块只产出**状态与结构化字段**，
 *      文案一律由表现层用 `t()` 拼装；
 *   2. 判别联合表达互斥状态，禁止用多个布尔字段拼凑；
 *   3. 未知输入一律降级为 idle，绝不猜测身份或伪造进度。
 */

import { classifyToolName } from './toolTaxonomy.js';

/** 在场状态种类（互斥） */
export type AgentPresenceKind =
  | 'idle'
  | 'thinking'
  | 'tool'
  | 'writing'
  | 'delegating'
  | 'failed'
  | 'interrupted';

/**
 * 工具类别：决定文案动词、图标与「是否写操作」。
 *
 * 【约束与规则】判定唯一真值在 `./toolTaxonomy.ts` 的 `classifyToolName`，
 *   与工具轨迹胶囊共用同一套关键字表。本类型只表达在场指示器需要的粒度：
 *   `write` 合并进 `edit`、`skill` 归入 `other`。表现层禁止再写第二套判定。
 */
export type PresenceToolKind =
  | 'read'
  | 'command'
  | 'edit'
  | 'search'
  | 'agent'
  | 'browser'
  | 'other';

/** 在场状态：判别联合，非法状态不可表达 */
export type AgentPresence =
  | { kind: 'idle' }
  | { kind: 'thinking'; sinceMs: number }
  | {
      kind: 'tool';
      tool: PresenceToolKind;
      /** 工具目标原文（未截断）；表现层负责按宽度裁剪 */
      target: string;
      runningCount: number;
      sinceMs: number;
    }
  | { kind: 'writing'; sinceMs: number }
  | { kind: 'delegating'; profile: string; count: number }
  | { kind: 'failed'; message: string }
  | { kind: 'interrupted' };

/** 推导输入：宿主只喂原始事实，不做任何判断 */
export interface AgentPresenceInput {
  /** 当前会话是否处于流式回合中 */
  isStreaming: boolean;
  /**
   * 流式末条消息；null 表示没有在途回合。
   *
   * 【约束与规则】只读必需字段，不消费正文内容本身——正文长度不构成状态判据。
   */
  message: {
    thought?: string;
    content?: string;
    toolCalls?: ReadonlyArray<{
      name: string;
      status: 'running' | 'completed' | 'failed';
      args: string;
    }>;
  } | null;
  /** 尚未收敛的子代理数量；> 0 时压过工具态 */
  activeSubagents?: number;
  /** 子代理归属的 Agent profile 名 */
  subagentProfile?: string;
  /** 回合失败原因；非空即为终态 */
  lastError?: string;
  /** 回合被用户或看门狗终止 */
  interrupted?: boolean;
  /** 回合开始的本地毫秒时间戳；缺失时 sinceMs 记 0 */
  turnStartedAt?: number;
  /** 当前本地毫秒时间戳 */
  now: number;
}

/**
 * 工具名 → 在场指示器类别。
 *
 * 【约束与规则 (Rules)】判定本身**不在本文件**：统一走 `classifyToolName`
 *   （`./toolTaxonomy.ts`），与工具轨迹胶囊共用同一套关键字表。本函数只做
 *   `ToolTaxonomyKind → PresenceToolKind` 的语义收敛：
 *   `write` 与 `edit` 在「正在做什么」层面都是改文件，合并为 `edit`；
 *   `skill` 在在场指示器上没有独立动词，归入 `other`（显示为「正在执行」）。
 *   这里若再写一套 `includes` 链，就会立刻退回双标时代。
 */
export function classifyPresenceTool(name: string): PresenceToolKind {
  const { kind } = classifyToolName(name);
  if (kind === 'write') return 'edit';
  if (kind === 'skill') return 'other';
  return kind;
}


/** 从工具参数里取最可读的目标：优先已知的路径/命令字段，其次首个非空值 */
function extractTarget(args: string): string {
  const raw = (args || '').trim();
  if (!raw) return '';
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        const preferred = [
          record.command,
          record.cmd,
          record.path,
          record.file,
          record.filePath,
          record.file_path,
          record.query,
          record.pattern,
          record.url,
        ];
        for (const candidate of preferred) {
          if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        }
        for (const value of Object.values(record)) {
          if (typeof value === 'string' && value.trim()) return value.trim();
        }
      }
    // gate-degrade: 工具参数非合法 JSON 时按纯文本处理，不得因此丢失状态
    } catch {
      return raw;
    }
  }
  return raw;
}

/** 时长分层档位：表现层据此选择语气，不在本模块内产生任何文案 */
export type PresenceTone = 'fresh' | 'patient' | 'long';

/** 分层阈值（毫秒）：8s 内是正常节奏，30s 后属于「明显偏慢」 */
const TONE_PATIENT_MS = 8_000;
const TONE_LONG_MS = 30_000;

/**
 * 按状态持续时长给出语气档位。
 *
 * 【设计意图 (Why)】状态文案不能永远同一句。卡住 60 秒与刚开始 1 秒看起来一样，
 *   等于放弃了「是否卡住」这个最重要的判据。分层把时长变成可读信号。
 *
 * 【约束与规则】终态（failed / interrupted / idle）与 delegating 不参与分层，
 *   一律返回 'fresh'——它们本身已经表达了终局语义，再叠时长会自相矛盾。
 */
export function presenceTone(presence: AgentPresence): PresenceTone {
  const since =
    presence.kind === 'thinking' || presence.kind === 'tool' || presence.kind === 'writing'
      ? presence.sinceMs
      : 0;
  if (since >= TONE_LONG_MS) return 'long';
  if (since >= TONE_PATIENT_MS) return 'patient';
  return 'fresh';
}

/**
 * 事实 → 在场状态。
 *
 * 【优先级 (Rules)】failed → interrupted → delegating → tool → writing → thinking → idle。
 *   自上而下短路，顺序即语义：
 *   - failed / interrupted 是终态，必须压过任何在途痕迹；
 *   - delegating 比 tool 更「有主体」（活是派出去干的）；
 *   - tool 比 writing 更具体（正文流式时也可能同时在跑工具）；
 *   - writing 比 thinking 更靠后（正文已经产出说明思考阶段已过）。
 */
export function deriveAgentPresence(input: AgentPresenceInput): AgentPresence {
  const sinceMs =
    typeof input.turnStartedAt === 'number' && input.turnStartedAt > 0
      ? Math.max(0, input.now - input.turnStartedAt)
      : 0;

  const error = (input.lastError || '').trim();
  if (error) return { kind: 'failed', message: error };
  if (input.interrupted) return { kind: 'interrupted' };

  const subagentCount = Math.max(0, Math.floor(input.activeSubagents ?? 0));
  if (subagentCount > 0) {
    return {
      kind: 'delegating',
      profile: (input.subagentProfile || '').trim(),
      count: subagentCount,
    };
  }

  if (!input.isStreaming || !input.message) return { kind: 'idle' };

  const toolCalls = input.message.toolCalls ?? [];
  const running = toolCalls.filter((call) => call.status === 'running');
  if (running.length > 0) {
    const primary = running[0];
    return {
      kind: 'tool',
      tool: classifyPresenceTool(primary.name),
      target: extractTarget(primary.args),
      runningCount: running.length,
      sinceMs,
    };
  }

  if ((input.message.content || '').trim()) return { kind: 'writing', sinceMs };
  if ((input.message.thought || '').trim()) return { kind: 'thinking', sinceMs };
  return { kind: 'thinking', sinceMs };
}

/** 眨眼间隔下界（毫秒） */
export const BLINK_MIN_INTERVAL_MS = 2_800;
/** 眨眼间隔上界（毫秒），与下界共同构成 2.6s 的抖动窗口 */
export const BLINK_MAX_INTERVAL_MS = 5_400;

/** FNV-1a 32 位：确定性、无依赖、跨端一致 */
function fnv1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 下一次眨眼的间隔（毫秒）。
 *
 * 【设计意图 (Why)】等距眨眼读起来像节拍器，反而更像机器；人眼天然是非等距的。
 *   用 seed 派生出落在 [2800, 5400) 的确定性抖动，同一 seed 恒等（可测、可复现），
 *   不同 seed 分布均匀。
 *
 * 【约束与规则】纯函数，不读时钟、不读随机数；seed 由调用方按回合或会话 id 给出。
 */
export function nextBlinkDelayMs(seed: string | number): number {
  const span = BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS;
  const hash = fnv1a(String(seed));
  return BLINK_MIN_INTERVAL_MS + (hash % span);
}

/** 空闲轮播文案条数：对应 i18n 键 `presence.idle.0` … `presence.idle.{N-1}` */
export const IDLE_QUIP_COUNT = 8;
/** 空闲文案切换间隔（毫秒）：慢到不抢注意力，又能让人看到「它还活着」 */
export const IDLE_QUIP_INTERVAL_MS = 9_000;

/**
 * 与 `IDLE_QUIP_COUNT` 互质的候选步长（1…COUNT-1）。
 *
 * 【为什么提到模块级 (Rules)】`pickIdleQuipIndex` 每次渲染都会调用一次；
 *   在函数内每次新建数组并循环求 GCD 是纯浪费。常量表在模块初始化时算一次即可。
 */
const IDLE_COPRIME_STEPS: readonly number[] = (() => {
  const steps: number[] = [];
  for (let candidate = 1; candidate < IDLE_QUIP_COUNT; candidate += 1) {
    if (greatestCommonDivisor(candidate, IDLE_QUIP_COUNT) === 1) steps.push(candidate);
  }
  return steps.length > 0 ? steps : [1];
})();

/** 欧几里得算法：判互质 */
function greatestCommonDivisor(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const rest = x % y;
    x = y;
    y = rest;
  }
  return x;
}

/**
 * 空闲轮播文案的下标。
 *
 * 【设计意图 (Why)】空闲态没有真实状态可播报，但一个完全静止的头像读起来像「进程挂了」。
 *   给一组俏皮短句轮播，让在场感延续，同时明确告诉用户「它闲着，等你派活」。
 *
 * 【防范的历史坑 (Pitfall)】禁止用 `Math.random()`：同一身份每次重渲染都会跳文案，
 *   而且测试无法复现。这里用身份 seed 派生出**起点**与**步长**，同一身份序列恒定，
 *   不同身份序列不同（避免所有会话都在读同一句话）。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数：不读时钟、不读随机数；
 *   2. 返回值恒落在 `[0, IDLE_QUIP_COUNT)`；
 *   3. 步长必须与条数互质，保证 COUNT 次内遍历全部文案（不重复、不遗漏）。
 */
export function pickIdleQuipIndex(seed: string, tick: number): number {
  const start = fnv1a(`${seed}:start`) % IDLE_QUIP_COUNT;
  const step = IDLE_COPRIME_STEPS[fnv1a(`${seed}:step`) % IDLE_COPRIME_STEPS.length];
  const safeTick = Number.isFinite(tick) && tick > 0 ? Math.floor(tick) : 0;
  return (start + safeTick * step) % IDLE_QUIP_COUNT;
}
