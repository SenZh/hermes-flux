import * as React from 'react';
import { Camera, ChevronLeft, ChevronRight } from 'lucide-react';
import type { BotDraftState } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { renderBotAvatar } from '../../utils/botAvatar.js';
import { Badge } from '../primitives/Badge.js';
import type { BotRosterEntry } from './settingsModel.js';

/**
 * BOT 头像滑动选择器（一行 5 个，固定槽位池）。
 *
 * 【设计意图 (Why)】
 *   BOT 数量会随用户长期使用增长，选择器必须像物理转盘一样连续位移，而不是
 *   "点一下换一屏"。固定 5 个 DOM 槽位 + 纯 GPU transform，让 1000 个 BOT 与
 *   5 个 BOT 的渲染成本完全相同；rAF 在稳态时注销，静止时 CPU 占用为 0。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 早期按数量重建槽位，拖动时 React 每帧重建节点，头像闪烁且焦点丢失；
 *   2. 用 width/height 做近大远小会触发每帧 Reflow，长列表下整页掉帧；
 *   3. 透明度公式未设下限时最外侧降到 0.048，用户把"一行 5 个"读成"一行 3 个"；
 *   4. 拖拽在窗口外松手时 pointerup 丢失，dragging 永久为真，吸附彻底失效；
 *   5. 小样本数据直接取模会渲染出重复 BOT（N=2 时出现同一头像两次）。
 *
 * 【约束与规则 (Rules)】
 *   1. 槽位固定 5 个，禁止按 roster 长度增删 DOM；
 *   2. 每帧只允许直接改 ref DOM 的 transform / opacity / zIndex，禁止每帧 setState；
 *      React 状态只记录"当前中心索引"，用于切换槽位内容；
 *   3. N ≥ 5 才启用环形取模；N < 5 按实际数量平铺并把 target 夹在 [0, N-1]；
 *   4. 松手/静止吸附完成后才回调 onSettle，滑动过程零 RPC；
 *   5. 文案全部走 t()，颜色只用语义 Token，不画准星、椭圆框等装饰辅助线。
 */

const SLOT_COUNT = 5;
const CENTER_SLOT = 2;
const SLOT_WIDTH = 76;
const SLOT_HEIGHT = 112;
const AVATAR_INNER_SIZE = 72;
/** 视口高度与原型严格一致：148px。 */
const VIEWPORT_HEIGHT = 148;
/** iOS HIG 触控下限：左右翻页按钮 44×44。 */
const NAV_BUTTON_SIZE = 44;
const MIN_STEP = 56;
const LERP_RATE = 0.18;
const SETTLE_EPSILON = 0.001;
const DRAG_CLICK_SLOP = 4;
const WHEEL_THRESHOLD = 12;
const WHEEL_LOCK_MS = 130;

const mod = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;

/** 把连续位移收敛为合法中心索引（N < 5 时夹紧，N ≥ 5 时环形）。 */
function normalizeCenter(value: number, length: number): number {
  if (length <= 0) return 0;
  const rounded = Math.round(value);
  return length >= SLOT_COUNT ? mod(rounded, length) : Math.max(0, Math.min(length - 1, rounded));
}

/** 草稿头像优先：replace 用新图，clear 墓碑语义视为无头像，unchanged 回落到花名册资产。 */
function resolveAvatar(row: BotRosterEntry, draft: BotDraftState | undefined): string | undefined {
  if (!draft) return row.avatar;
  if (draft.avatar.kind === 'replace') return draft.avatar.dataUrl;
  if (draft.avatar.kind === 'clear') return undefined;
  return row.avatar;
}

export interface BotHeroCarouselProps {
  /** 花名册（快照派生，只读）。 */
  roster: readonly BotRosterEntry[];
  /** 当前中心的 BOT（壳层状态机权威值）。 */
  activeBotId: string;
  /** 当前中心 BOT 的草稿：只用于中心头像预览与标题回显，整表草稿不进快照。 */
  activeDraft?: BotDraftState;
  /** 保存中锁定轮播，防止在提交途中切换 BOT。 */
  locked?: boolean;
  /** 静止吸附后通知壳层取详情（壳层负责 160ms 防抖与令牌收敛）。 */
  onSettle: (botId: string) => void;
  /** 点击中心头像的编辑遮罩：请求宿主打开文件选择器。 */
  onRequestAvatarUpload: (botId: string) => void;
}

export function BotHeroCarousel({
  roster,
  activeBotId,
  activeDraft,
  locked = false,
  onSettle,
  onRequestAvatarUpload,
}: BotHeroCarouselProps): React.ReactElement {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const slotRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  const rosterRef = React.useRef<readonly BotRosterEntry[]>(roster);
  rosterRef.current = roster;
  const lockedRef = React.useRef(locked);
  lockedRef.current = locked;
  const onSettleRef = React.useRef(onSettle);
  onSettleRef.current = onSettle;
  const onRequestAvatarRef = React.useRef(onRequestAvatarUpload);
  onRequestAvatarRef.current = onRequestAvatarUpload;

  const initialCenter = Math.max(0, roster.findIndex((row) => row.id === activeBotId));
  const [center, setCenter] = React.useState(initialCenter);
  const centerRef = React.useRef(initialCenter);
  const offsetRef = React.useRef(initialCenter);
  const targetRef = React.useRef(initialCenter);
  const stepRef = React.useRef(SLOT_WIDTH);
  const rafRef = React.useRef<number | null>(null);

  const draggingRef = React.useRef(false);
  const pressedSlotRef = React.useRef<number | null>(null);
  const dragStartXRef = React.useRef(0);
  const dragStartOffsetRef = React.useRef(0);
  const suppressClickRef = React.useRef(false);
  const movedRef = React.useRef(false);

  const wheelAccRef = React.useRef(0);
  const wheelLockRef = React.useRef(false);
  const wheelTimerRef = React.useRef<number | null>(null);
  const lastLengthRef = React.useRef(-1);

  /** 读取指定目标位置对应的 BOT；越界返回 undefined，绝不伪造数据。 */
  const botIdAt = React.useCallback((value: number): string | undefined => {
    const list = rosterRef.current;
    if (list.length === 0) return undefined;
    return list[normalizeCenter(value, list.length)]?.id;
  }, []);

  /**
   * 把当前 offset 写到 5 个固定槽位。
   * 【规则】每帧只写 transform / opacity；仅当中心索引或花名册数量变化时才同步
   *   可见性与键盘可达性，并在中心变化时 setState（内容切换交给 React）。
   */
  const applyFrame = React.useCallback((): void => {
    // 步进只在 ResizeObserver / 首次布局时测量，rAF 每帧不读布局，避免强制同步重排。
    const step = stepRef.current;
    const length = rosterRef.current.length;
    const nextCenter = normalizeCenter(offsetRef.current, length);
    // 连续位移：位置、缩放、透明度都用"槽位索引 - 连续 offset"的真实距离，
    // 而不是整数 rel。否则拖动时头像只在跨界瞬间跳格，读起来像翻页而不是转盘。
    const rounded = Math.round(offsetRef.current);
    const fractional = offsetRef.current - rounded;
    // 只有中心或数量变化时才需要改可见性与键盘可达性；其余帧严格只写 transform / opacity。
    const syncInteractivity = nextCenter !== centerRef.current || length !== lastLengthRef.current;
    lastLengthRef.current = length;

    for (let index = 0; index < SLOT_COUNT; index += 1) {
      const node = slotRefs.current[index];
      if (!node) continue;
      const rel = index - CENTER_SLOT;
      const distance = rel - fractional;
      const absoluteDistance = Math.abs(distance);
      const scale = Math.max(0.5, 1 - absoluteDistance * 0.24);
      const opacity = Math.max(0.55, 1 - absoluteDistance * 0.22);
      const rawIndex = nextCenter + rel;
      const visible = length > 0 && (length >= SLOT_COUNT || (rawIndex >= 0 && rawIndex < length));

      node.style.transform = `translate3d(${distance * step}px, 0, 0) scale(${scale})`;
      node.style.opacity = visible ? String(opacity) : '0';
      if (syncInteractivity) {
        node.style.pointerEvents = visible ? 'auto' : 'none';
        node.tabIndex = visible && rel === 0 ? 0 : -1;
        if (visible) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', 'true');
      }
    }

    if (nextCenter !== centerRef.current) {
      centerRef.current = nextCenter;
      setCenter(nextCenter);
    }
  }, []);

  /** 启动/唤醒 rAF；已运行时保持同一循环，避免叠加多个 rAF。 */
  const startLoop = React.useCallback((): void => {
    if (rafRef.current !== null) return;
    // 只在真正位移期间提示合成器提升图层；静止后必须撤回，
    // 否则 5 个槽位常驻 5 个合成层，静置时白占 GPU 内存。
    for (const node of slotRefs.current) {
      if (node) node.style.willChange = 'transform, opacity';
    }
    rafRef.current = requestAnimationFrame(function tick(): void {
      if (!draggingRef.current) {
        const diff = targetRef.current - offsetRef.current;
        if (Math.abs(diff) < SETTLE_EPSILON) {
          offsetRef.current = targetRef.current;
          applyFrame();
          // 稳态：撤回 will-change，让浏览器回收合成层。
          for (const node of slotRefs.current) {
            if (node) node.style.willChange = 'auto';
          }
          rafRef.current = null;
          // 只有真正发生过位移才上报，纯点击中心不产生无意义的详情请求。
          if (movedRef.current) {
            movedRef.current = false;
            const settledId = botIdAt(targetRef.current);
            if (settledId) onSettleRef.current(settledId);
          }
          return;
        }
        offsetRef.current += diff * LERP_RATE;
        movedRef.current = true;
      }
      applyFrame();
      rafRef.current = requestAnimationFrame(tick);
    });
  }, [applyFrame, botIdAt]);

  /** 按槽位相对位移翻页；N < 5 时夹紧，N = 1 时禁用。 */
  const stepBy = React.useCallback(
    (delta: number): void => {
      if (lockedRef.current) return;
      const length = rosterRef.current.length;
      if (length <= 1) return;
      const next = Math.round(targetRef.current) + delta;
      targetRef.current = length >= SLOT_COUNT ? next : Math.max(0, Math.min(length - 1, next));
      movedRef.current = true;
      startLoop();
    },
    [startLoop],
  );

  const endDrag = React.useCallback((): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const length = rosterRef.current.length;
    const rounded = length >= SLOT_COUNT ? Math.round(targetRef.current) : Math.max(0, Math.min(Math.max(length - 1, 0), Math.round(targetRef.current)));
    targetRef.current = rounded;
    const needsSnap = Math.abs(offsetRef.current - rounded) > SETTLE_EPSILON;
    if (needsSnap) movedRef.current = true;
    if (needsSnap || movedRef.current) startLoop();
  }, [startLoop]);

  // 首次布局与尺寸变化后写一遍变换；先测量步进，避免首帧按 76px 落位后跳一下。
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      const width = viewport.clientWidth;
      stepRef.current = width > 0 ? Math.max(MIN_STEP, Math.min(width / 5, width / 4 - 68)) : MIN_STEP;
    }
    applyFrame();
  }, [applyFrame, roster.length]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const sync = (): void => {
      const width = viewport.clientWidth;
      stepRef.current = width > 0 ? Math.max(MIN_STEP, Math.min(width / 5, width / 4 - 68)) : MIN_STEP;
      applyFrame();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    observer?.observe(viewport);
    window.addEventListener('resize', sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [applyFrame]);

  // 滚轮必须用原生非 passive 监听：React 的 onWheel 在根节点上是 passive，preventDefault 会失效。
  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (lockedRef.current) return;
      if (rosterRef.current.length <= 1) return;
      // deltaMode 归一化：1 = 行，2 = 页，0 = 像素。
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const dominant = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      wheelAccRef.current += dominant * unit;
      if (wheelLockRef.current) return;
      if (Math.abs(wheelAccRef.current) < WHEEL_THRESHOLD) return;

      const direction = wheelAccRef.current > 0 ? 1 : -1;
      // 消费后立即清零，避免残余符号在解锁瞬间把轮播推向反方向。
      wheelAccRef.current = 0;
      stepBy(direction);

      wheelLockRef.current = true;
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(() => {
        wheelLockRef.current = false;
        wheelAccRef.current = 0;
        wheelTimerRef.current = null;
      }, WHEEL_LOCK_MS);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [stepBy]);

  // pointercancel 或窗口失焦时统一复位拖拽，否则吸附会永久停摆。
  React.useEffect(() => {
    const onWindowBlur = (): void => {
      pressedSlotRef.current = null;
      endDrag();
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, [endDrag]);

  React.useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    },
    [],
  );

  // 外部 activeBotId 变化（保存后壳层回推、恢复默认等）时平滑对齐到目标。
  const lastActivePropRef = React.useRef(activeBotId);
  React.useEffect(() => {
    if (lastActivePropRef.current === activeBotId) return;
    lastActivePropRef.current = activeBotId;
    const list = rosterRef.current;
    const targetIndex = list.findIndex((row) => row.id === activeBotId);
    if (targetIndex < 0 || draggingRef.current) return;
    const length = list.length;
    const currentRounded = Math.round(targetRef.current);
    let next = targetIndex;
    if (length >= SLOT_COUNT) {
      const base = mod(currentRounded, length);
      let delta = mod(targetIndex - base, length);
      // 走环形最短路径，避免从最后一个 BOT 回到第一个时倒着转一整圈。
      if (delta > length / 2) delta -= length;
      next = currentRounded + delta;
    }
    if (next === currentRounded) return;
    targetRef.current = next;
    movedRef.current = true;
    startLoop();
  }, [activeBotId, startLoop]);

  // roster 缩到 4 个以下时把目标夹回合法范围，防止平铺态下 target 越界。
  React.useEffect(() => {
    const length = roster.length;
    if (length === 0 || length >= SLOT_COUNT) return;
    const rounded = normalizeCenter(targetRef.current, length);
    if (Math.round(targetRef.current) === rounded && Math.abs(offsetRef.current - rounded) < SETTLE_EPSILON) return;
    targetRef.current = rounded;
    offsetRef.current = rounded;
    movedRef.current = false;
    applyFrame();
  }, [roster.length, applyFrame]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (lockedRef.current || event.button !== 0) return;
    if (rosterRef.current.length <= 1) return;
    // 记录按下时命中的槽位：pointer capture 会把 pointerup 重定向到视口，
    // 因此点击动作必须在 pointerup 里按这个记录判定，不能依赖槽位的 click。
    const origin = event.target instanceof Element ? event.target.closest('[data-bot-slot]') : null;
    const pressedRel = origin?.getAttribute('data-bot-slot');
    pressedSlotRef.current = pressedRel === null || pressedRel === undefined ? null : Number(pressedRel);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    draggingRef.current = true;
    dragStartXRef.current = event.clientX;
    dragStartOffsetRef.current = offsetRef.current;
    suppressClickRef.current = false;
    movedRef.current = false;
    // 接管瞬间 target 跟随 offset，消除"按住就跳半格"的突跳。
    targetRef.current = offsetRef.current;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    const deltaX = event.clientX - dragStartXRef.current;
    if (Math.abs(deltaX) > DRAG_CLICK_SLOP) suppressClickRef.current = true;
    const step = stepRef.current || SLOT_WIDTH;
    const nextOffset = dragStartOffsetRef.current - deltaX / step;
    const length = rosterRef.current.length;
    // N<5 时端头不允许拖出范围；>=5 时环绕由 normalizeCenter 处理，offset 保持连续。
    offsetRef.current = length >= SLOT_COUNT
      ? nextOffset
      : Math.max(0, Math.min(Math.max(length - 1, 0), nextOffset));
    targetRef.current = offsetRef.current;
    if (Math.abs(offsetRef.current - dragStartOffsetRef.current) > 0.05) movedRef.current = true;
    applyFrame();
  };

  const handlePointerUp = (): void => {
    const pressedRel = pressedSlotRef.current;
    const suppressClick = suppressClickRef.current;
    const wasTap = Math.abs(offsetRef.current - dragStartOffsetRef.current) < 0.02;
    pressedSlotRef.current = null;
    suppressClickRef.current = false;
    endDrag();
    // 未发生拖拽才视为点击：先由 rAF 平滑吸附，settle 在动画终止时统一上报。
    if (!suppressClick && wasTap && pressedRel !== null && !lockedRef.current && pressedRel !== 0) {
      stepBy(pressedRel);
    }
  };

  const handlePointerCancel = (): void => {
    pressedSlotRef.current = null;
    suppressClickRef.current = false;
    endDrag();
  };

  const handleSlotKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, rel: number, botId: string): void => {
    if (lockedRef.current) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepBy(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepBy(1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (rel === 0) onRequestAvatarRef.current(botId);
      else stepBy(rel);
    }
  };

  const wrap = roster.length >= SLOT_COUNT;
  const slots = React.useMemo(() => {
    const length = roster.length;
    const centerIndex = normalizeCenter(center, length);
    return Array.from({ length: SLOT_COUNT }, (_, index) => {
      const rel = index - CENTER_SLOT;
      const rawIndex = centerIndex + rel;
      const visible = length > 0 && (wrap || (rawIndex >= 0 && rawIndex < length));
      const bot = visible ? roster[wrap ? mod(rawIndex, length) : rawIndex] : undefined;
      return { rel, bot, isCenter: rel === 0 };
    });
  }, [center, roster, wrap]);

  const canPrev = roster.length > 1 && (wrap || center > 0);
  const canNext = roster.length > 1 && (wrap || center < roster.length - 1);

  return (
    <div
      ref={viewportRef}
      role="tablist"
      aria-label={t('bot.selectBot')}
      data-bot-carousel="true"
      className="relative w-full shrink-0 cursor-grab touch-pan-y select-none overflow-hidden border-b border-border-subtle bg-card active:cursor-grabbing"
      style={{ height: VIEWPORT_HEIGHT }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {slots.map(({ rel, bot, isCenter }) => {
          const draft = bot && bot.id === activeBotId ? activeDraft : undefined;
          const displayName = draft?.displayName ?? bot?.displayName ?? '';
          const avatar = bot ? resolveAvatar(bot, draft) : undefined;
          const isDefault = draft?.isDefault ?? bot?.isDefault ?? false;
          const hasDraft = Boolean(bot?.hasDraft);
          const avatarHtml = bot ? renderBotAvatar(bot.id, displayName, avatar, AVATAR_INNER_SIZE, 'circle') : '';

          return (
            <div
              key={rel}
              ref={(node) => {
                slotRefs.current[rel + CENTER_SLOT] = node;
              }}
              role="tab"
              aria-selected={isCenter}
              tabIndex={isCenter ? 0 : -1}
              data-bot-slot={rel}
              data-bot-id={bot?.id ?? ''}
              className={`group absolute flex flex-col items-center outline-none ${
                bot ? 'cursor-pointer' : 'pointer-events-none'
              }`}
              style={{
                width: SLOT_WIDTH,
                height: SLOT_HEIGHT,
                // 槽位盒在舞台正中；缩放原点锁在头像圆心，近大远小时头像始终排成一行。
                left: '50%',
                top: '50%',
                marginLeft: -SLOT_WIDTH / 2,
                marginTop: -SLOT_HEIGHT / 2,
                transformOrigin: 'center 38px',
                // 首帧（SSR / hydration 前）按基准步进先排开，避免 5 个槽位叠在中心；
                // useLayoutEffect 测得真实视口宽度后会用精确 STEP 覆盖。
                transform: `translate3d(${rel * SLOT_WIDTH}px, 0, 0) scale(${Math.max(0.5, 1 - Math.abs(rel) * 0.24)})`,
                opacity: bot ? Math.max(0.55, 1 - Math.abs(rel) * 0.22) : 0,
                zIndex: Math.round(10 - Math.abs(rel) * 3),
                // will-change 由 startLoop 在位移期间动态置位、稳态撤回（见 startLoop 注释）。
              }}
              onKeyDown={(event) => {
                if (bot) handleSlotKeyDown(event, rel, bot.id);
              }}
            >
              {bot ? (
                <>
                  <span
                    className={`relative overflow-hidden rounded-full bg-panel ring-offset-0 ${
                      isCenter ? 'ring-2 ring-primary' : 'ring-1 ring-border-strong'
                    }`}
                    style={{ width: SLOT_WIDTH, height: SLOT_WIDTH }}
                  >
                    {/* 头像唯一实现：与左轨共用 renderBotAvatar，禁止在这里另造首字母兜底。 */}
                    <span
                      className="flex size-full items-center justify-center"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: avatarHtml }}
                    />

                    {isCenter ? (
                      <>
                        {/* 悬停编辑遮罩：点击调起文件选择；键盘 Enter 由槽位本身处理。 */}
                        <span
                          aria-hidden="true"
                          title={t('bot.avatarUpload')}
                          onPointerDown={(event) => event.stopPropagation()}
                          onPointerUp={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            event.preventDefault();
                            if (!lockedRef.current) onRequestAvatarRef.current(bot.id);
                          }}
                          className="absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-full bg-backdrop/70 text-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                        >
                          <Camera aria-hidden="true" className="size-4" />
                          <span className="text-micro">{t('bot.avatarUpload')}</span>
                        </span>

                        {hasDraft ? (
                          <span
                            aria-hidden="true"
                            title={t('bot.unsavedDot')}
                            className="absolute bottom-0 right-0 z-20 size-2 rounded-full bg-warning ring-2 ring-card"
                          />
                        ) : null}
                      </>
                    ) : null}

                    {isDefault ? (
                      <Badge className="absolute bottom-0 left-1/2 z-10 -translate-x-1/2 border-card bg-primary px-1 py-0 text-micro leading-none text-primary-foreground">
                        {t('bot.defaultBadge')}
                      </Badge>
                    ) : null}
                  </span>

                  <span
                    className={`mt-2 max-w-24 truncate text-aux ${
                      isCenter ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'
                    }`}
                  >
                    {displayName}
                  </span>
                  {/* 极小字号会被 scale 再压到不可辨（10px×0.52≈5px），只在中心槽位显示 ID。 */}
                  {isCenter ? (
                    <span className="max-w-24 truncate font-code text-micro text-secondary-foreground">{bot.id}</span>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        aria-label={t('bot.prevBot')}
        title={t('bot.prevBot')}
        disabled={locked || !canPrev}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={() => stepBy(-1)}
        className="absolute left-1 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        style={{ width: NAV_BUTTON_SIZE, height: NAV_BUTTON_SIZE }}
      >
        <span className="flex size-7 items-center justify-center rounded-full border border-border-strong bg-card">
          <ChevronLeft aria-hidden="true" className="size-4" />
        </span>
      </button>

      <button
        type="button"
        aria-label={t('bot.nextBot')}
        title={t('bot.nextBot')}
        disabled={locked || !canNext}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={() => stepBy(1)}
        className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        style={{ width: NAV_BUTTON_SIZE, height: NAV_BUTTON_SIZE }}
      >
        <span className="flex size-7 items-center justify-center rounded-full border border-border-strong bg-card">
          <ChevronRight aria-hidden="true" className="size-4" />
        </span>
      </button>
    </div>
  );
}
