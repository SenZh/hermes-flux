/**
 * 模型思考等级二级级联管理器（Model Cascade Manager）
 *
 * 【设计意图 (Why)】
 *   将二级思考等级单例面板的绝对定位、水平翻转（右/左/内缩三档）、
 *   视口垂直夹取（防短视口溢出）、选择后抑制窗口与延迟收起调度从 `renderer/index.ts` 抽离。
 *   使几何运算与抑制状态机能够脱离浏览器执行可证伪的单测。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 必须在 display='block' 之后读取 getBoundingClientRect，否则尺寸为 0 导致定位全部算错；
 *   2. 必须做垂直夹取 Math.min(Math.max(...))，避免短视口下末尾等级（如 max/high）点不到；
 *   3. 刚选完等级时按住 600ms 抑制窗口，防止 Chromium 重绘后补发 mouseenter 重新弹起面板；
 *   4. 离开时必须保留 160ms 穿越间隙，允许鼠标斜切移动到面板上而不丢失。
 *
 * 【约束与规则 (Rules)】
 *   1. 几何算法保持纯函数输入输出，禁止在算法内部访问全局 window；
 *   2. 抑制状态机与定时器调度严格防御，支持依赖注入。
 */

export const CASCADE_VIEWPORT_PADDING_PX = 8;

export interface RectLike {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

export interface CascadeLayoutInput {
  readonly rowRect: RectLike;
  readonly dropdownRect: RectLike;
  readonly cascadeRect: RectLike;
  readonly windowInnerWidth: number;
  readonly windowInnerHeight: number;
  readonly dropdownClientTop: number;
}

export interface CascadeLayoutResult {
  readonly mode: 'default' | 'flip' | 'inset';
  readonly clampedTop: number;
  readonly relativeTopPx: number;
  readonly useInset: boolean;
}

/**
 * 纯数学几何计算：计算级联面板的停靠模式与最终 top 偏移。
 */
export function computeCascadeLayout(input: CascadeLayoutInput): CascadeLayoutResult {
  const { rowRect, dropdownRect, cascadeRect, windowInnerWidth, windowInnerHeight, dropdownClientTop } = input;
  const cascadeWidth = cascadeRect.width || 148;
  const cascadeHeight = cascadeRect.height || 0;

  // 1. 水平三档判定
  const spaceRight = windowInnerWidth - dropdownRect.right;
  const spaceLeft = dropdownRect.left;
  let mode: 'default' | 'flip' | 'inset' = 'default';
  let useInset = false;

  if (spaceRight >= cascadeWidth + 12) {
    mode = 'default';
  } else if (spaceLeft >= cascadeWidth + 12) {
    mode = 'flip';
  } else {
    mode = 'inset';
    useInset = true;
  }

  // 2. 垂直夹取：常规右/左外侧顶部对齐该行，内缩态避开行文字
  const viewportBottom = windowInnerHeight - CASCADE_VIEWPORT_PADDING_PX;
  let desiredTop = rowRect.top;
  if (useInset) {
    const belowTop = rowRect.bottom + 4;
    const aboveTop = rowRect.top - cascadeHeight - 4;
    desiredTop = belowTop + cascadeHeight <= viewportBottom ? belowTop : Math.max(CASCADE_VIEWPORT_PADDING_PX, aboveTop);
  }

  const maxTop = Math.max(CASCADE_VIEWPORT_PADDING_PX, viewportBottom - cascadeHeight);
  const clampedTop = Math.min(Math.max(desiredTop, CASCADE_VIEWPORT_PADDING_PX), maxTop);
  const relativeTopPx = Math.round(clampedTop - dropdownRect.top - dropdownClientTop);

  return {
    mode,
    clampedTop,
    relativeTopPx,
    useInset,
  };
}

export interface ModelCascadeHost {
  readonly getCascadeElement: () => HTMLElement | null;
  readonly getDropdownElement: () => HTMLElement | null;
  readonly onModelChange?: (model: string | undefined) => void;
  readonly getWindowDimensions?: () => { width: number; height: number };
  readonly setTimeout?: (cb: () => void, ms: number) => number;
  readonly clearTimeout?: (id: number) => void;
  readonly now?: () => number;
}

export class ModelCascadeManager {
  private hideTimer: number | null = null;
  private suppressModel: string | null = null;
  private suppressUntil = 0;
  private currentModel: string | undefined = undefined;

  constructor(private readonly host: ModelCascadeHost) {}

  public getCurrentModel(): string | undefined {
    return this.currentModel;
  }

  public shouldSuppress(rowModel: string | null): boolean {
    const now = this.host.now ? this.host.now() : Date.now();
    return now < this.suppressUntil && (this.suppressModel === null || rowModel === this.suppressModel);
  }

  public armSuppression(model: string | null, durationMs: number): void {
    const now = this.host.now ? this.host.now() : Date.now();
    this.suppressModel = model;
    this.suppressUntil = now + durationMs;
  }

  public cancelHide(): void {
    if (this.hideTimer !== null) {
      if (this.host.clearTimeout) {
        this.host.clearTimeout(this.hideTimer);
      } else if (typeof window !== 'undefined') {
        window.clearTimeout(this.hideTimer);
      } else {
        clearTimeout(this.hideTimer);
      }
      this.hideTimer = null;
    }
  }

  public scheduleHide(delayMs = 160): void {
    this.cancelHide();
    const setFn = this.host.setTimeout
      ? this.host.setTimeout
      : typeof window !== 'undefined'
        ? window.setTimeout.bind(window)
        : setTimeout;
    this.hideTimer = setFn(() => {
      this.hideTimer = null;
      this.hide();
    }, delayMs);
  }

  public hide(): void {
    this.cancelHide();
    const cascade = this.host.getCascadeElement();
    if (cascade) cascade.style.display = 'none';
    this.currentModel = undefined;
    this.host.onModelChange?.(undefined);
  }

  public show(row: HTMLElement): void {
    const cascade = this.host.getCascadeElement();
    const dropdown = this.host.getDropdownElement();
    if (!cascade || !dropdown) return;

    const rowModel = row.getAttribute('data-model');
    if (this.shouldSuppress(rowModel)) return;
    this.cancelHide();

    this.currentModel = rowModel || undefined;
    this.host.onModelChange?.(this.currentModel);

    cascade.style.display = 'block';
    cascade.classList.remove('model-cascade--flip', 'model-cascade--inset');

    const rowRect = row.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    const cascadeRect = cascade.getBoundingClientRect();
    const dims = this.host.getWindowDimensions
      ? this.host.getWindowDimensions()
      : { width: window.innerWidth, height: window.innerHeight };

    const layout = computeCascadeLayout({
      rowRect,
      dropdownRect,
      cascadeRect,
      windowInnerWidth: dims.width,
      windowInnerHeight: dims.height,
      dropdownClientTop: dropdown.clientTop || 0,
    });

    if (layout.mode === 'flip') {
      cascade.classList.add('model-cascade--flip');
    } else if (layout.mode === 'inset') {
      cascade.classList.add('model-cascade--inset');
    }

    cascade.style.top = `${layout.relativeTopPx}px`;
  }
}
