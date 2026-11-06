/**
 * Hermes Flux 动效运行时 Token 探测与解析器
 *
 * 设计意图 (Why):
 *   杜绝在 TypeScript 代码中硬编码固定的毫秒与缓动数值，
 *   使动效参数由 CSS Variables 与皮肤体系拥有单一统治权（Single Source of Truth），
 *   实现换肤时动效节奏的一致联动。
 * 防范的历史坑 (Pitfall):
 *   在 Node.js 单元测试中调用 window.getComputedStyle 或 window.matchMedia 会抛出
 *   TypeError: window.matchMedia is not a function 导致构建流水线熔断。
 * 约束与规则 (Rules):
 *   1. 必须提供确定性的静态兜底常量（STATIC_FALLBACK_TOKENS），环境缺失时平滑降级；
 *   2. 遵守审美宪法 I6：入场 120ms，退场 200ms，纯阻尼无过冲；
 *   3. 严禁使用类型逃逸（any）。
 */

export interface MotionDurationContract {
  readonly durationEnter: number;
  readonly durationExit: number;
  readonly fallbackBuffer: number;
}

export const STATIC_FALLBACK_TOKENS: MotionDurationContract = {
  durationEnter: 120,
  durationExit: 200,
  fallbackBuffer: 50,
};

function parseDurationMs(raw: string, fallback: number): number {
  const trimmed = (raw || '').trim().toLowerCase();
  if (!trimmed) return fallback;
  if (trimmed.endsWith('ms')) {
    const val = parseFloat(trimmed);
    return Number.isFinite(val) && val >= 0 ? val : fallback;
  }
  if (trimmed.endsWith('s')) {
    const val = parseFloat(trimmed);
    return Number.isFinite(val) && val >= 0 ? val * 1000 : fallback;
  }
  const numeric = parseFloat(trimmed);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

/**
 * 动态探测当前宿主节点的动效 Token 参数。
 */
export function resolveMotionTokens(targetElement?: Element | null): MotionDurationContract {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return STATIC_FALLBACK_TOKENS;
  }

  const target = targetElement || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) {
    return STATIC_FALLBACK_TOKENS;
  }

  try {
    const style = window.getComputedStyle(target);
    const enterRaw = style.getPropertyValue('--duration-enter');
    const exitRaw = style.getPropertyValue('--duration-exit');

    return {
      durationEnter: parseDurationMs(enterRaw, STATIC_FALLBACK_TOKENS.durationEnter),
      durationExit: parseDurationMs(exitRaw, STATIC_FALLBACK_TOKENS.durationExit),
      fallbackBuffer: STATIC_FALLBACK_TOKENS.fallbackBuffer,
    };
  // gate-degrade: getComputedStyle 在 jsdom 或受限沙箱抛出异常时平滑降级至静态宪法 Token
  } catch {
    return STATIC_FALLBACK_TOKENS;
  }
}

/**
 * 检测宿主系统是否开启了"减少动效"无障碍偏好。
 */
export function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // gate-degrade: matchMedia 在非标准 Web 环境或 Node 跑测试时安全降级为 false
  } catch {
    return false;
  }
}
