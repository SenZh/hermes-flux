/**
 * 消息高度自适应中位数估算器 (Adaptive Median Estimator)
 *
 * 【设计意图 (Why)】
 *   用于平抑富文本异构消息在未渲染时的尺寸偏差。通过统计真实已渲染消息的滑动中位数，
 *   动态为 CSS content-visibility 的 contain-intrinsic-size 提供高拟合度的基准行高，
 *   消除未见消息滑入视口时滚动条滑块（Thumb）的剧烈缩放与抖动。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 使用平均数容易被单条 4,000px 的超大代码块或极矮单行确认语句严重拉偏，导致常规消息预估严重失真；
 *   2. 采用中位数（Median）具备极强的离群值抗扰性；
 *   3. 维持固定容量滑动窗口（默认 50 个样本），避免内存累积。
 *
 * 【约束与规则 (Rules)】
 *   - 纯算法逻辑，零 DOM 依赖；
 *   - 严格类型安全，边界健全（空采样时安全回退到默认高度）。
 */

export type AdaptiveMedianOptions = {
  windowSize?: number;
  defaultHeightPx?: number;
  minHeightPx?: number;
  maxHeightPx?: number;
}

export class AdaptiveMedianEstimator {
  private readonly windowSize: number;
  private readonly defaultHeightPx: number;
  private readonly minHeightPx: number;
  private readonly maxHeightPx: number;
  private readonly samples: number[] = [];

  public constructor(options: AdaptiveMedianOptions = {}) {
    this.windowSize = Math.max(5, options.windowSize ?? 50);
    this.defaultHeightPx = Math.max(30, options.defaultHeightPx ?? 140);
    this.minHeightPx = Math.max(10, options.minHeightPx ?? 32);
    this.maxHeightPx = Math.max(this.minHeightPx, options.maxHeightPx ?? 4000);
  }

  /**
   * 记录一次真实消息高度测量值。
   */
  public addSample(height: number): void {
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return;

    // 钳制在有效范围内，避免极端离群值破坏样本
    const clamped = Math.max(this.minHeightPx, Math.min(this.maxHeightPx, Math.round(height)));
    this.samples.push(clamped);

    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }
  }

  /**
   * 获取当前滑动窗口的高度中位数。
   */
  public getMedian(): number {
    if (this.samples.length === 0) {
      return this.defaultHeightPx;
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }
    return sorted[mid];
  }

  /**
   * 重置样本池。
   */
  public reset(): void {
    this.samples.length = 0;
  }

  /**
   * 当前样本数量。
   */
  public get sampleCount(): number {
    return this.samples.length;
  }
}
