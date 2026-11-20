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
  codeCopy: {
    title: '代码块复制委托 (Markdown Code Block Copy)',
    mutate: ['packages/ui/src/lib/codeCopy.ts'],
    testFiles: ['packages/ui/__tests__/code-copy.test.mjs'],
    buildCommand: 'npm run build:ui',
    minScore: 80,
  },
  streamWriter: {
    title: '流式 Token 写入与贴底跟随 (Token Stream Writer)',
    mutate: ['packages/desktop/src/renderer/stream/tokenStreamWriter.ts'],
    testFiles: ['packages/desktop/__tests__/unit/tokenStreamWriter.test.mjs'],
    buildCommand: 'node scripts/gates/build-desktop-unit.mjs src/renderer/stream/tokenStreamWriter.ts',
    // 实测 185 mutant / 157 killed / 23 survived / 5 noCov = 84.86%（2026-11-18）
    minScore: 80,
  },
  streamViewport: {
    title: '流视口占位高度去重与中性补偿 (Stream Viewport Intrinsic)',
    // 分段必须覆盖本次逻辑的全部输入与输出契约：
    // 190-215 上限常量、455-540 淘汰与采样去重、570-760 变量写入/中性补偿/锚点采集
    mutate: [
      'packages/desktop/src/renderer/viewport/streamViewportManager.ts:190-215',
      'packages/desktop/src/renderer/viewport/streamViewportManager.ts:455-540',
      'packages/desktop/src/renderer/viewport/streamViewportManager.ts:570-760',
    ],
    testFiles: ['packages/desktop/__tests__/unit/stream-viewport-manager.test.mjs'],
    buildCommand:
      'node scripts/gates/build-desktop-unit.mjs src/renderer/viewport/streamViewportManager.ts',
    // 实测 249 mutant / 217 killed / 25 survived / 7 noCov = 87.15%（2026-11-18，含 FIFO 淘汰与补偿输入契约）
    minScore: 85,
  },
  renderCoordinatorPin: {
    title: '渲染协调提交后单在途贴底锚定 (Render Coordinator Pin)',
    mutate: [
      'packages/desktop/src/renderer/renderCoordinator.ts:245-308',
      'packages/desktop/src/renderer/renderCoordinator.ts:702-720',
      'packages/desktop/src/renderer/renderCoordinator.ts:805-820',
      'packages/desktop/src/renderer/renderCoordinator.ts:1005-1062',
    ],
    testFiles: ['packages/desktop/__tests__/unit/render-coordinator.test.mjs'],
    buildCommand:
      'node scripts/gates/build-desktop-unit.mjs src/renderer/renderCoordinator.ts src/renderer/viewport/postCommitPinObservers.ts',
    // 实测 180 mutant / 151 killed / 3 timeout / 26 survived / 0 noCov = 85.56%（2026-11-18）
    minScore: 80,
  },
  turnSettlement: {
    title: '流式回合收口与中断超时保底 (Turn Settlement)',
    mutate: [
      'packages/desktop/src/renderer/gateway/gatewayEventDispatcher.ts:322-448',
      'packages/desktop/src/renderer/services/turnExecutionService.ts:201-238',
      'packages/desktop/src/renderer/services/turnExecutionService.ts:297-317',
      'packages/desktop/src/renderer/services/turnExecutionService.ts:442-540',
    ],
    testFiles: [
      'packages/desktop/__tests__/unit/gatewayEventDispatcher.test.mjs',
      'packages/desktop/__tests__/unit/turnExecutionService.test.mjs',
    ],
    buildCommand:
      'node scripts/gates/build-desktop-unit.mjs src/renderer/gateway/gatewayEventDispatcher.ts src/renderer/services/turnExecutionService.ts',
    // 实测 361 mutant / 304 killed / 57 survived / 0 noCov = 84.21%（2026-11-18）
    minScore: 80,
  },
  sessionSelectToolPatch: {
    title: '会话切回流式工具补刷 (Session Select Tool Patch)',
    mutate: ['packages/desktop/src/renderer/services/sessionOperationService.ts:539-550'],
    testFiles: ['packages/desktop/__tests__/unit/sessionOperationService.test.mjs'],
    buildCommand:
      'node scripts/gates/build-desktop-unit.mjs src/renderer/services/sessionOperationService.ts',
    // 实测 20 mutant / 16 killed / 4 survived / 0 noCov = 80.00%（2026-11-18）
    minScore: 70,
  },
  toolSection: {
    title: '工具区块流式/收口原子交接 (ToolSection Key Swap)',
    mutate: ['packages/ui/src/components-react/conversation/ToolCapsule.tsx:373-382'],
    testFiles: ['packages/ui/__tests__/streaming-anchor-contract.test.mjs'],
    buildCommand: 'npm run build:ui',
    // 实测 7 mutant / 6 killed / 0 survived / 1 noCov = 85.71%（覆盖分 100%）（2026-11-18）
    minScore: 70,
  },
  avatarSize: {
    title: '头像尺寸白名单与回退 (Avatar Size Resolver)',
    // 纯函数：数字/字符串双形态 + 白名单 + 回退值，全部可被单测直接命中。
    // 门槛 98：50/51 = 98.04% 通过，49/51 = 96.08% 会被拦下 —— 只给唯一那个
    // 等价变异体留余量（`typeof size === 'number'` → true 时，后续 Number.isFinite
    // 天然不 coercion 字符串，行为完全一致，不可杀，已人工核对）。
    mutate: ['packages/ui/src/utils/avatarSize.ts'],
    testFiles: ['packages/ui/__tests__/avatar-size.test.mjs'],
    buildCommand: 'npm run build:ui',
    minScore: 98,
  },
};
