/**
 * 提示词导航轨（Prompt Navigator Rail）
 *
 * 【设计意图 (Why)】
 *   长会话（实测 7745 条消息 / 约 3870 次提问）里，滚动条无法表达"回到第 2000 次提问"。
 *   轨道把每一次用户输入折叠成一根横杠：悬停出预览、点击直达该轮对话。
 *   本组件只消费宿主推来的快照，不读滚动容器、不算行高、不碰消息表。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 轨道若挂进 `#conversation-stream`，宿主整块替换画布时会把它一起销毁；
 *   2. 面板用 React `onWheel` 时 React 17+ 在根容器上以 passive 注册，`preventDefault` 无效，
 *      滚面板会同时把正文滚走；
 *   3. 只渲染 30 根 tick 而不提供窗口外通路时，3870 次提问只能点到当前项周围 15 条；
 *   4. 键盘移动高亮前不先 `ensureWindowContains`，高亮会落到未渲染的 tick 上，
 *      `aria-activedescendant` 指向不存在节点，按键表现为"没反应"。
 *
 * 【约束与规则 (Rules)】
 *   1. 文案 100% 走 `t()`，本文件禁止中文字面量；
 *   2. 颜色、字号、圆角全部走语义 Token，禁止裸色值与内联字号；
 *   3. tick DOM 上限为 `capacity`（默认 30），面板也只挂可见行附近；
 *   4. 面板是 gutter 的子节点：`mousemove` / `click` 必须 `stopPropagation`，
 *      `wheel` 必须走原生非被动监听；
 *   5. 只观察稳定祖先 `.flux-middle-pod`，画布 `.conv-canvas` 每次回调内重查。
 */

import * as React from 'react';
import { t } from '../../i18n/index.js';
import {
  RAIL_TICK_PITCH_PX,
  RAIL_VISIBLE_TICKS,
  planTickWindow,
  tickWidth,
  type PromptEntry,
  type PromptNavigatorActions,
  type PromptNavigatorSnapshot,
} from '../../lib/promptNavigator.js';

/** 面板可见行数：8 行 × 54px，与设计文档第 9 节一致。 */
const PANEL_VISIBLE_ROWS = 8;
/** 面板行高（px），滚轮一次正好滚一行。 */
const PANEL_ROW_PX = 40;
/** 面板滚动时额外挂载的上下文行数，避免滑行瞬间露出空白。 */
const PANEL_OVERSCAN_ROWS = 2;
/** 边缘轮播步进间隔。 */
const CAROUSEL_INTERVAL_MS = 80;
/** 上下热区高度。 */
const CAROUSEL_EDGE_PX = 18;
/** 指针离开后延迟收起面板，留出横移进面板的时间。 */
const PANEL_COLLAPSE_DELAY_MS = 160;
/** 常规命中带宽度。 */
const GUTTER_WIDE_PX = 28;
/** 消息列压到 gutter 底下时的收窄宽度。 */
const GUTTER_NARROW_PX = 12;
/** 触发收窄的间距阈值：画布右缘与 pod 右缘小于该值即视为窄列。 */
const NARROW_GAP_PX = 40;

export interface PromptNavigatorRailProps {
  snapshot: PromptNavigatorSnapshot;
  actions: PromptNavigatorActions;
  capacity?: number;
}

/** 容量归一：非正数或非有限一律回落到 `RAIL_VISIBLE_TICKS`。 */
function normalizeCapacity(capacity: number | undefined): number {
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) {
    return RAIL_VISIBLE_TICKS;
  }
  return Math.max(1, Math.floor(capacity));
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 把目标索引滚进窗口：落在窗口外时平移起点，已在窗口内则保持原样。
 *
 * 【约束与规则 (Rules)】结果起点恒夹在 `[0, total - capacity]`，末端不得越界。
 */
function ensureWindowStartFor(
  target: number,
  baseStart: number,
  total: number,
  capacity: number
): number {
  const maxStart = Math.max(0, total - capacity);
  const base = clamp(baseStart, 0, maxStart);
  if (target < base) return clamp(target, 0, maxStart);
  if (target >= base + capacity) return clamp(target - capacity + 1, 0, maxStart);
  return base;
}

/**
 * 面板高亮行保留上下 2 行上下文，只有贴近边缘才滑动。
 *
 * 【防范的历史坑 (Pitfall)】面板若跟随高亮逐行滚动，读者永远只能看到当前行与下方 7 行，
 *   无法形成"上下文感"；只有贴边才滑动才与参考实现一致。
 */
function ensurePanelOffset(target: number, offset: number, total: number): number {
  const maxOffset = Math.max(0, total - PANEL_VISIBLE_ROWS);
  const base = clamp(offset, 0, maxOffset);
  if (target - base < 2) return clamp(target - 2, 0, maxOffset);
  if (target - base > PANEL_VISIBLE_ROWS - 3) {
    return clamp(target - PANEL_VISIBLE_ROWS + 3, 0, maxOffset);
  }
  return base;
}

export function PromptNavigatorRail({
  snapshot,
  actions,
  capacity,
}: PromptNavigatorRailProps): React.ReactElement | null {
  const prompts = snapshot.prompts;
  const total = prompts.length;
  const cap = normalizeCapacity(capacity);

  const [highlightedIndex, setHighlightedIndex] = React.useState<number | null>(null);
  const [windowStart, setWindowStart] = React.useState(0);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [panelOffset, setPanelOffset] = React.useState(0);
  const [narrow, setNarrow] = React.useState(false);

  const gutterRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = React.useRef<number | null>(null);
  const carouselTimerRef = React.useRef<number | null>(null);
  const carouselDirRef = React.useRef<-1 | 1>(-1);
  const prevPromptsRef = React.useRef<readonly PromptEntry[] | null>(null);
  const measureRef = React.useRef<(() => void) | null>(null);

  const activeIndex = total === 0 ? -1 : clamp(snapshot.activeIndex, 0, total - 1);
  const autoStart = planTickWindow(total, activeIndex, cap).start;
  const rawStart = highlightedIndex === null ? autoStart : windowStart;
  const start = clamp(rawStart, 0, Math.max(0, total - cap));
  const end = Math.min(total, start + cap);
  const hasMoreAbove = start > 0;
  const hasMoreBelow = end < total;

  const stopCarousel = React.useCallback((): void => {
    if (carouselTimerRef.current !== null) {
      window.clearInterval(carouselTimerRef.current);
      carouselTimerRef.current = null;
    }
  }, []);

  const cancelCollapse = React.useCallback((): void => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const scheduleCollapse = React.useCallback((): void => {
    cancelCollapse();
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      setPanelOpen(false);
      setHighlightedIndex(null);
    }, PANEL_COLLAPSE_DELAY_MS);
  }, [cancelCollapse]);

  /** 移动高亮：先把目标滚进窗口，再改写高亮，杜绝指向未挂载节点。 */
  const moveHighlight = React.useCallback(
    (next: number): void => {
      if (total === 0) return;
      const target = clamp(next, 0, total - 1);
      const base = highlightedIndex === null ? autoStart : windowStart;
      setWindowStart(ensureWindowStartFor(target, base, total, cap));
      setHighlightedIndex(target);
      setPanelOffset((offset) => ensurePanelOffset(target, offset, total));
      setPanelOpen(true);
    },
    [total, highlightedIndex, autoStart, windowStart, cap]
  );

  // 轮播定时器里的回调必须读到最新一轮渲染的闭包，否则会按过期的 total / hasMore 步进。
  const latestRef = React.useRef({
    total,
    hasMoreAbove,
    hasMoreBelow,
    activeIndex,
    highlightedIndex,
    moveHighlight,
  });
  latestRef.current = { total, hasMoreAbove, hasMoreBelow, activeIndex, highlightedIndex, moveHighlight };

  const startCarousel = React.useCallback(
    (direction: -1 | 1): void => {
      const current = latestRef.current;
      if (current.total === 0) return;
      if (direction === -1 && !current.hasMoreAbove) return;
      if (direction === 1 && !current.hasMoreBelow) return;
      carouselDirRef.current = direction;
      if (carouselTimerRef.current !== null) return;
      carouselTimerRef.current = window.setInterval(() => {
        const state = latestRef.current;
        const dir = carouselDirRef.current;
        // 窗口已经顶到首尾时立刻停：continue 下去只会把高亮卡在边界上空转。
        if (dir === -1 && !state.hasMoreAbove) {
          stopCarousel();
          return;
        }
        if (dir === 1 && !state.hasMoreBelow) {
          stopCarousel();
          return;
        }
        const anchor = state.highlightedIndex === null ? state.activeIndex : state.highlightedIndex;
        if (anchor < 0) {
          stopCarousel();
          return;
        }
        state.moveHighlight(anchor + dir);
      }, CAROUSEL_INTERVAL_MS);
    },
    [stopCarousel]
  );

  // 卸载时清理两个定时器，避免宿主销毁轨道后仍在后台步进。
  React.useEffect(
    () => () => {
      stopCarousel();
      cancelCollapse();
    },
    [stopCarousel, cancelCollapse]
  );

  /**
   * 消息表引用变化时的窗口平移。
   *
   * 【设计意图 (Why)】前置翻页会把历史插到数组头，全部下标整体后移；
   *   若不补偿，读者停在顶部时轨道窗口会瞬间跳到末尾且不会自愈。
   * 【约束与规则 (Rules)】尾部追加不动；头部插入按增量平移；整表换源（切会话）清空浏览态。
   */
  React.useEffect(() => {
    const previous = prevPromptsRef.current;
    prevPromptsRef.current = prompts;
    if (!previous || previous === prompts) return;
    const previousFirst = previous[0]?.id;
    const previousLast = previous[previous.length - 1]?.id;
    const nextFirst = prompts[0]?.id;
    const nextLast = prompts[prompts.length - 1]?.id;
    if (previous.length === 0 || prompts.length === 0) {
      setHighlightedIndex(null);
      setWindowStart(0);
      return;
    }
    if (previousFirst !== nextFirst && previousLast === nextLast) {
      const delta = prompts.length - previous.length;
      if (delta === 0) return;
      setWindowStart((value) => clamp(value + delta, 0, Math.max(0, prompts.length - cap)));
      setHighlightedIndex((value) => (value === null ? null : clamp(value + delta, 0, prompts.length - 1)));
      return;
    }
    if (previousFirst !== nextFirst) {
      setHighlightedIndex(null);
      setPanelOpen(false);
      setPanelOffset(0);
    }
  }, [prompts, cap]);

  /**
   * 命中带宽度自适应：只观察稳定祖先 `.flux-middle-pod`。
   *
   * 【防范的历史坑 (Pitfall)】画布 `.conv-canvas` 会被宿主整节点替换，
   *   绑在旧节点上的观察器会永久失效；因此每次回调内部重新查询。
   */
  React.useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const pod = document.querySelector<HTMLElement>('.flux-middle-pod');
    if (!pod) return undefined;
    const measure = (): void => {
      const canvas = pod.querySelector<HTMLElement>('.conv-canvas');
      if (!canvas) return;
      const podRect = pod.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      if (canvasRect.width <= 0) return;
      const gap = podRect.right - canvasRect.right;
      setNarrow(gap >= 0 && gap < NARROW_GAP_PX);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(pod);
    measureRef.current = measure;
    measure();
    return () => {
      measureRef.current = null;
      observer.disconnect();
    };
  }, []);

  /**
   * 首屏挂载时画布可能尚未出现（骨架态 / 消息列表还没提交），
   * 而 pod 尺寸不变时 ResizeObserver 不会再回调；因此每次条目总量变化补测一次命中带宽度。
   */
  React.useEffect(() => {
    measureRef.current?.();
  }, [total]);

  /**
   * 面板滚轮：必须用原生非被动监听。
   *
   * 【防范的历史坑 (Pitfall)】React 17 起在根容器上以 passive 方式注册 wheel，
   *   `preventDefault` 无效，滚面板会同时把正文滚走。
   */
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !panelOpen) return undefined;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (total === 0) return;
      if (event.deltaY === 0) return;
      const step = event.deltaY > 0 ? 1 : -1;
      setPanelOffset((offset) =>
        clamp(offset + step, 0, Math.max(0, total - PANEL_VISIBLE_ROWS))
      );
    };
    panel.addEventListener('wheel', handleWheel, { passive: false });
    return () => panel.removeEventListener('wheel', handleWheel);
  }, [panelOpen, total]);

  /** 指针纵向位置 → tick 业务下标；落在窗口外的槽位返回 null。 */
  const pointerIndexAt = React.useCallback(
    (clientY: number): number | null => {
      const gutter = gutterRef.current;
      if (!gutter || total === 0) return null;
      const rect = gutter.getBoundingClientRect();
      if (rect.height <= 0) return null;
      const slot = Math.floor((clientY - rect.top) / RAIL_TICK_PITCH_PX);
      if (slot < 0 || slot >= end - start) return null;
      return start + slot;
    },
    [total, start, end]
  );

  const handleGutterPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gutter = gutterRef.current;
    if (!gutter || total === 0) return;
    /**
     * 面板是 gutter 的子节点，但物理上位于 gutter 左侧。
     * pointermove 与 mousemove 是两套事件，只拦 mousemove 拦不住这里；
     * 必须在入口处判掉「指针在面板内」的情形，否则悬停面板行会反向改写轨道高亮。
     */
    if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) return;
    const rect = gutter.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    const index = pointerIndexAt(event.clientY);
    if (index !== null) {
      cancelCollapse();
      setPanelOpen(true);
      if (index !== highlightedIndex) {
        setHighlightedIndex(index);
        setWindowStart(ensureWindowStartFor(index, start, total, cap));
        setPanelOffset((offset) => ensurePanelOffset(index, offset, total));
      }
    }
    if (offsetY <= CAROUSEL_EDGE_PX) {
      startCarousel(-1);
    } else if (offsetY >= rect.height - CAROUSEL_EDGE_PX) {
      startCarousel(1);
    } else {
      stopCarousel();
    }
  };

  const handleGutterPointerLeave = (): void => {
    stopCarousel();
    scheduleCollapse();
  };

  const handleGutterClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const index = pointerIndexAt(event.clientY);
    if (index === null) return;
    const entry = prompts[index];
    if (!entry) return;
    actions.onSelect(entry.id);
    setPanelOpen(false);
  };

  const handleGutterKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (total === 0) return;
    const anchor = highlightedIndex === null ? activeIndex : highlightedIndex;
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        moveHighlight(anchor - 1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveHighlight(anchor + 1);
        return;
      case 'Home':
        event.preventDefault();
        moveHighlight(0);
        return;
      case 'End':
        event.preventDefault();
        moveHighlight(total - 1);
        return;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const target = anchor >= 0 ? anchor : 0;
        const entry = prompts[target];
        if (entry) {
          actions.onSelect(entry.id);
          setPanelOpen(false);
        }
        return;
      }
      case 'Escape':
        event.preventDefault();
        stopCarousel();
        setPanelOpen(false);
        setHighlightedIndex(null);
        return;
      default:
        return;
    }
  };

  const handlePanelEnter = (): void => {
    cancelCollapse();
    stopCarousel();
  };

  const handlePanelMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    // 面板是 gutter 的子节点：指针换算边界必须在这里截断。
    event.stopPropagation();
  };

  const handlePanelClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  if (total < 2) return null;

  const tickId = (index: number): string => `conv-prompt-tick-${index}`;
  const emptyPreview = t('conversation.promptNavigator.emptyPreview');
  const previewOf = (entry: PromptEntry | undefined): string =>
    entry && entry.preview ? entry.preview : emptyPreview;

  const ticks: React.ReactElement[] = [];
  const hasHighlight = highlightedIndex !== null;
  for (let i = start; i < end; i += 1) {
    const entry = prompts[i];
    if (!entry) continue;
    const isActive = i === activeIndex;
    const isHighlighted = i === highlightedIndex;
    const distance = hasHighlight ? Math.abs(i - (highlightedIndex ?? 0)) : 0;
    const label = isActive
      ? `${t('conversation.promptNavigator.currentPrompt')}: ${previewOf(entry)}`
      : previewOf(entry);
    ticks.push(
      <div
        key={`${entry.index}:${entry.id}`}
        id={tickId(i)}
        className={`conv-prompt-rail__tick${isActive ? ' is-active' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
        role="option"
        aria-selected={isHighlighted}
        aria-current={isActive ? 'true' : undefined}
        aria-label={label}
        style={{
          top: `${i * RAIL_TICK_PITCH_PX}px`,
          width: `${tickWidth(distance, isActive, isHighlighted, hasHighlight)}px`,
        }}
      >
        <span className="conv-prompt-rail__tick-bar" aria-hidden="true" />
      </div>
    );
  }

  // 面板只挂可见行 ± overscan，避免 3870 个按钮同时进 DOM。
  const panelRows: React.ReactElement[] = [];
  if (panelOpen) {
    const visibleEnd = Math.min(total, panelOffset + PANEL_VISIBLE_ROWS + PANEL_OVERSCAN_ROWS);
    for (let i = panelOffset; i < visibleEnd; i += 1) {
      const entry = prompts[i];
      if (!entry) continue;
      const isActive = i === activeIndex;
      const isHighlighted = i === highlightedIndex;
      panelRows.push(
        <button
          key={entry.id}
          type="button"
          className={`conv-prompt-rail__panel-row${isActive ? ' is-active' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
          style={{ top: `${i * PANEL_ROW_PX}px` }}
          aria-current={isActive ? 'true' : undefined}
          onMouseEnter={() => {
            stopCarousel();
            setHighlightedIndex(i);
          }}
          onClick={(event) => {
            event.stopPropagation();
            actions.onSelect(entry.id);
            setPanelOpen(false);
          }}
        >
          <span className="conv-prompt-rail__panel-index" aria-hidden="true">{i + 1}</span>
          <span className="conv-prompt-rail__panel-text">{previewOf(entry)}</span>
        </button>
      );
    }
  }

  const gutterWidth = narrow ? GUTTER_NARROW_PX : GUTTER_WIDE_PX;
  const visibleCount = Math.max(0, end - start);

  return (
    <nav className="conv-prompt-rail" aria-label={t('conversation.promptNavigator.aria')}>
      <div
        ref={gutterRef}
        className="conv-prompt-rail__gutter"
        style={{
          width: `${gutterWidth}px`,
          height: `${visibleCount * RAIL_TICK_PITCH_PX}px`,
        }}
        role="listbox"
        tabIndex={0}
        aria-label={t('conversation.promptNavigator.aria')}
        aria-activedescendant={highlightedIndex === null ? undefined : tickId(highlightedIndex)}
        onPointerMove={handleGutterPointerMove}
        onPointerLeave={handleGutterPointerLeave}
        onClick={handleGutterClick}
        onKeyDown={handleGutterKeyDown}
      >
        <div
          key={prompts[0]?.id ?? ''}
          className="conv-prompt-rail__tape"
          style={{ transform: `translateY(-${start * RAIL_TICK_PITCH_PX}px)` }}
        >
          {ticks}
        </div>
        {panelOpen ? (
          <div
            ref={panelRef}
            className="conv-prompt-rail__panel"
            role="presentation"
            onMouseEnter={handlePanelEnter}
            onMouseLeave={scheduleCollapse}
            onMouseMove={handlePanelMove}
            onClick={handlePanelClick}
          >
            <div className="conv-prompt-rail__panel-viewport">
              {panelOffset > 0 ? <div className="conv-prompt-rail__panel-mask is-top" aria-hidden="true" /> : null}
              <div
                className="conv-prompt-rail__panel-track"
                style={{ transform: `translateY(-${panelOffset * PANEL_ROW_PX}px)` }}
              >
                {panelRows}
              </div>
              {panelOffset + PANEL_VISIBLE_ROWS < total ? (
                <div className="conv-prompt-rail__panel-mask is-bottom" aria-hidden="true" />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
