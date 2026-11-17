/**
 * 变异测试领域注册表（Mutation Domains Registry）
 *
 * 【设计意图 (Why)】
 *   全量 Core 包含 15,000+ 变异体，直接全量运行耗时过长。
 *   按业务领域（Domain）划分为可独立执行、独立度量的变异单元，
 *   使老存量代码能够分阶段、分批次推进变异消减，每个领域运行时间控制在 10~60 秒内。
 */

export const MUTATION_DOMAINS = {
  cache: {
    title: '缓存合并状态机 (Cache Merge FSM)',
    mutate: ['packages/core/src/cache/cacheMerge.ts'],
    testFiles: [
      'packages/core/__tests__/cache/cache-merge.test.mjs',
      'packages/core/__tests__/cache/cache-edge-cases.test.mjs',
      'packages/core/__tests__/cache/cache-display-order.test.mjs',
      'packages/core/__tests__/formal/cache-fence-formal.test.mjs',
    ],
    buildCommand: 'npm run build:core',
    minScore: 70,
  },
  coalesce: {
    title: 'Token 流式合流引擎 (Token Coalescing Engine)',
    mutate: ['packages/core/src/coalesce/tokenCoalescer.ts'],
    testFiles: ['packages/core/__tests__/coalesce/tokenCoalescer.test.mjs'],
    buildCommand: 'npm run build:core',
    // 经补齐 RAF/定时器节拍步进后实测得分 76.47%（0 NoCoverage），门禁硬锁 ≥70%
    minScore: 70,
    targetScore: 70,
  },
  session: {
    title: '会话生命周期与截断合并 (Session Merge & Truncate Plan)',
    mutate: [
      'packages/core/src/session/sessionMerge.ts',
      'packages/core/src/session/truncatePlan.ts',
    ],
    testFiles: [
      'packages/core/__tests__/session/session-merge.test.mjs',
      'packages/core/__tests__/session/session-truncate-plan.test.mjs',
      'packages/core/__tests__/formal/session-lifecycle-formal.test.mjs',
    ],
    buildCommand: 'npm run build:core',
    minScore: 65,
  },
  rpc: {
    title: '网关连接 5 态状态机 (Gateway Connection FSM)',
    mutate: ['packages/core/src/rpc/fsm.ts'],
    testFiles: [
      'packages/core/__tests__/rpc/ws-fsm.test.mjs',
      'packages/core/__tests__/formal/ws-fsm-formal.test.mjs',
    ],
    buildCommand: 'npm run build:core',
    minScore: 70,
  },
  viewport: {
    title: '会话视口记忆与基准行高 (Session Viewport Memory & Median)',
    mutate: [
      'packages/core/src/viewport/sessionScrollMemory.ts',
      'packages/core/src/viewport/adaptiveMedianEstimator.ts',
    ],
    testFiles: [
      'packages/core/__tests__/viewport/sessionScrollMemory.test.mjs',
      'packages/core/__tests__/viewport/adaptiveMedianEstimator.test.mjs',
      'packages/core/__tests__/formal/session-scroll-memory-formal.test.mjs',
      'packages/core/__tests__/formal/viewport-estimator-formal.test.mjs',
    ],
    buildCommand: 'npm run build:core',
    // 实测 126 mutant / 123 killed / 3 survived = 97.62%（2026-11-17，本机）。
    // 剩余 3 个经人工核对：maxEntries 恒 ≥1 使 `if (oldestKey)` 为等价守卫；
    // 另两处为三元方向性等价变异，不改变可观测行为。
    minScore: 90,
  },
};
