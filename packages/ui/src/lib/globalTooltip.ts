/**
 * Hermes Flux 全局极客美学 Tooltip 控制器 (Global Geek Aesthetic Tooltip Controller)
 *
 * 【设计意图 (Why)】
 * 原生浏览器 Chromium 的 `title` 属性会在鼠标停留时弹出固定的系统黑底方形气泡。
 * 在浅色模式下宛如墨渍，在深色模式下边缘生硬、字体与应用分裂，严重破坏极客美学与空间秩序。
 * 本控制器采用全局委托 + 单例悬浮层范式：
 * 1. 自动接管全站 `[data-tooltip]` 及带有 `title` 属性的控件；
 * 2. 在 hover 期间临时将原生 `title` 属性换入 `data-flux-tooltip` 并清空，彻底物理阻断 Chromium 原生丑陋黑框；
 * 3. 在 body 顶层展示符合设计规范 1.0 的轻量微胶囊（6px 圆角、4px/8px 内边距、1px 发丝边框、微物理动效）；
 * 4. 具备视口碰撞检测与上下/左右自动翻转避让能力。
 *
 * 【防范历史坑 (Pitfall)】
 * 1. 内存泄漏与多次挂载：必须幂等，全局单例挂载，多次调用 mount 仅保留一个有效监听；
 * 2. 局部容器 overflow 裁剪：气泡必须挂载在 document.body 根下 fixed 定位，严禁挂在侧边栏或滚动容器内；
 * 3. 测试断言破坏：离开元素时必须将 title 属性恢复，保障 SSR 与测试断言（如 querySelector('[title]')）完全透明；
 * 4. 快速移动闪烁：设置 250ms 优雅延迟，快速划过不闪烁；如果用户连续探索多个图标，激活 60ms 连击快速响应。
 *
 * 【约束规则 (Rules)】
 * 1. 纯 UI 表现层逻辑，零 Node/Electron/Core 依赖；
 * 2. pointer-events: none，气泡绝不阻碍任何下层鼠标点击与选区；
 * 3. 任何滚动、点击、ESC 键瞬间淡出隐藏。
 */

export interface GlobalTooltipOptions {
  /** 首次展示延迟毫秒数，默认 250ms */
  showDelayMs?: number;
  /** 连续探索时快速展示延迟毫秒数，默认 60ms */
  warmShowDelayMs?: number;
  /** 隐藏动画延迟毫秒数，默认 100ms */
  hideDelayMs?: number;
}

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

const DEFAULT_OPTIONS: Required<GlobalTooltipOptions> = {
  showDelayMs: 250,
  warmShowDelayMs: 60,
  hideDelayMs: 100,
};

let tooltipElement: HTMLDivElement | null = null;
let currentTarget: HTMLElement | null = null;
let showTimer = 0;
let hideTimer = 0;
let lastClosedTime = 0;
let isMounted = false;
let cleanupHandlers: (() => void) | null = null;

/** 获取或创建全局单例 Tooltip DOM 节点 */
function getOrCreateTooltipElement(): HTMLDivElement {
  if (tooltipElement && document.body.contains(tooltipElement)) {
    return tooltipElement;
  }
  const existing = document.getElementById('flux-global-tooltip');
  if (existing instanceof HTMLDivElement) {
    tooltipElement = existing;
    return tooltipElement;
  }
  const el = document.createElement('div');
  el.id = 'flux-global-tooltip';
  el.className = 'flux-global-tooltip';
  el.setAttribute('role', 'tooltip');
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  tooltipElement = el;
  return el;
}

/** 查找最近的具有 Tooltip 文案的有效元素 */
function findTooltipTarget(node: EventTarget | null): HTMLElement | null {
  if (!node || !(node instanceof Element)) return null;
  const target = node.closest<HTMLElement>('[data-tooltip], [title], [data-flux-tooltip]');
  if (!target) return null;
  if (target.getAttribute('data-tooltip-ignore') === 'true') return null;
  return target;
}

/** 获取元素的有效提示文本 */
function extractTooltipText(target: HTMLElement): string {
  const dataTooltip = target.getAttribute('data-tooltip');
  if (dataTooltip && dataTooltip.trim()) return dataTooltip.trim();

  const fluxTooltip = target.dataset.fluxTooltip;
  if (fluxTooltip && fluxTooltip.trim()) return fluxTooltip.trim();

  const titleAttr = target.getAttribute('title');
  if (titleAttr && titleAttr.trim()) return titleAttr.trim();

  return '';
}

/**
 * 临时移除非空 title 属性，彻底阻止原生浏览器弹出黑框
 */
function stripNativeTitle(target: HTMLElement): void {
  const rawTitle = target.getAttribute('title');
  if (rawTitle && rawTitle.trim()) {
    target.dataset.fluxTooltip = rawTitle.trim();
    target.removeAttribute('title');
    if (!target.getAttribute('aria-label')) {
      target.setAttribute('aria-label', rawTitle.trim());
    }
  }
}

/**
 * 恢复原生的 title 属性，确保 DOM 完整性与测试断言一致
 */
function restoreNativeTitle(target: HTMLElement): void {
  if (target.dataset.fluxTooltip && !target.hasAttribute('title')) {
    target.setAttribute('title', target.dataset.fluxTooltip);
  }
}

/**
 * 精确计算气泡视口坐标与自适应避让
 */
export function calculateTooltipPosition(
  targetRect: DOMRect,
  tooltipW: number,
  tooltipH: number,
  preferredPlacement: TooltipPlacement = 'top',
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): { x: number; y: number; placement: TooltipPlacement } {
  const GAP = 6;
  const VIEWPORT_PADDING_X = 8;
  const VIEWPORT_PADDING_Y = 6;

  let placement = preferredPlacement;

  // 垂直方向空间探测与翻转
  if (placement === 'top') {
    if (targetRect.top - tooltipH - GAP < VIEWPORT_PADDING_Y) {
      placement = 'bottom';
    }
  } else if (placement === 'bottom') {
    if (targetRect.bottom + tooltipH + GAP > viewportHeight - VIEWPORT_PADDING_Y) {
      placement = 'top';
    }
  }

  let x = 0;
  let y = 0;

  if (placement === 'top') {
    x = targetRect.left + (targetRect.width - tooltipW) / 2;
    y = targetRect.top - tooltipH - GAP;
  } else if (placement === 'bottom') {
    x = targetRect.left + (targetRect.width - tooltipW) / 2;
    y = targetRect.bottom + GAP;
  } else if (placement === 'right') {
    x = targetRect.right + GAP;
    y = targetRect.top + (targetRect.height - tooltipH) / 2;
  } else {
    // left
    x = targetRect.left - tooltipW - GAP;
    y = targetRect.top + (targetRect.height - tooltipH) / 2;
  }

  // 视口边界碰撞夹取 (Clamp)
  const clampedX = Math.max(VIEWPORT_PADDING_X, Math.min(viewportWidth - tooltipW - VIEWPORT_PADDING_X, x));
  const clampedY = Math.max(VIEWPORT_PADDING_Y, Math.min(viewportHeight - tooltipH - VIEWPORT_PADDING_Y, y));

  return {
    x: Math.round(clampedX),
    y: Math.round(clampedY),
    placement,
  };
}

/** 隐藏 Tooltip 气泡 */
export function hideTooltip(immediate = false): void {
  window.clearTimeout(showTimer);
  showTimer = 0;

  if (currentTarget) {
    restoreNativeTitle(currentTarget);
    currentTarget = null;
  }

  if (!tooltipElement) return;

  if (immediate) {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
    tooltipElement.removeAttribute('data-state');
    tooltipElement.setAttribute('aria-hidden', 'true');
    tooltipElement.style.display = 'none';
    lastClosedTime = Date.now();
  } else {
    tooltipElement.removeAttribute('data-state');
    tooltipElement.setAttribute('aria-hidden', 'true');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (tooltipElement && !tooltipElement.hasAttribute('data-state')) {
        tooltipElement.style.display = 'none';
        lastClosedTime = Date.now();
      }
    }, 100);
  }
}

/** 展示 Tooltip 气泡 */
function showTooltipForTarget(target: HTMLElement): void {
  const text = extractTooltipText(target);
  if (!text) {
    hideTooltip(true);
    return;
  }

  const el = getOrCreateTooltipElement();
  el.textContent = text;
  el.style.display = 'block';
  el.removeAttribute('data-state');

  // 获取真实渲染盒尺寸
  const tooltipRect = el.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // 读取显式指定的 placement
  const explicitPlacement = (target.getAttribute('data-tooltip-placement') || 'top') as TooltipPlacement;
  const { x, y, placement } = calculateTooltipPosition(targetRect, tooltipRect.width, tooltipRect.height, explicitPlacement);

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.setAttribute('data-placement', placement);
  el.setAttribute('aria-hidden', 'false');

  // 触发微物理进场动效
  requestAnimationFrame(() => {
    if (currentTarget === target) {
      el.setAttribute('data-state', 'visible');
    }
  });
}

/**
 * 挂载全局 Tooltip 代理监听器
 */
export function mountGlobalTooltip(options: GlobalTooltipOptions = {}): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  if (isMounted && cleanupHandlers) {
    return cleanupHandlers;
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };

  const handlePointerOver = (event: PointerEvent) => {
    // 忽略触控笔或手指的假性 hover
    if (event.pointerType === 'touch') return;

    const target = findTooltipTarget(event.target);
    if (!target) {
      hideTooltip();
      return;
    }

    if (target === currentTarget) return;

    // 如果切换了目标，先收尾前一个
    if (currentTarget) {
      restoreNativeTitle(currentTarget);
    }

    currentTarget = target;
    // 物理剥离原生 title，阻断 Chromium 默认黑块弹窗
    stripNativeTitle(target);

    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);

    // 连续探索优化：300ms 内刚关闭过，则快速唤醒
    const isWarm = Date.now() - lastClosedTime < 300;
    const delay = isWarm ? opts.warmShowDelayMs : opts.showDelayMs;

    showTimer = window.setTimeout(() => {
      if (currentTarget === target) {
        showTooltipForTarget(target);
      }
    }, delay);
  };

  const handlePointerOut = (event: PointerEvent) => {
    if (currentTarget && !currentTarget.contains(event.relatedTarget as Node | null)) {
      hideTooltip();
    }
  };

  const handleImmediateDismiss = () => {
    hideTooltip(true);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      hideTooltip(true);
    }
  };

  document.addEventListener('pointerover', handlePointerOver, { capture: true, passive: true });
  document.addEventListener('pointerout', handlePointerOut, { capture: true, passive: true });
  document.addEventListener('pointerdown', handleImmediateDismiss, { capture: true, passive: true });
  window.addEventListener('wheel', handleImmediateDismiss, { capture: true, passive: true });
  window.addEventListener('scroll', handleImmediateDismiss, { capture: true, passive: true });
  window.addEventListener('keydown', handleKeyDown, { capture: true, passive: true });

  isMounted = true;

  cleanupHandlers = () => {
    document.removeEventListener('pointerover', handlePointerOver, { capture: true });
    document.removeEventListener('pointerout', handlePointerOut, { capture: true });
    document.removeEventListener('pointerdown', handleImmediateDismiss, { capture: true });
    window.removeEventListener('wheel', handleImmediateDismiss, { capture: true });
    window.removeEventListener('scroll', handleImmediateDismiss, { capture: true });
    window.removeEventListener('keydown', handleKeyDown, { capture: true });

    hideTooltip(true);
    if (tooltipElement && tooltipElement.parentNode) {
      tooltipElement.parentNode.removeChild(tooltipElement);
    }
    tooltipElement = null;
    currentTarget = null;
    isMounted = false;
    cleanupHandlers = null;
  };

  return cleanupHandlers;
}

/**
 * 卸载全局 Tooltip 代理监听器
 */
export function unmountGlobalTooltip(): void {
  if (cleanupHandlers) {
    cleanupHandlers();
  }
}
