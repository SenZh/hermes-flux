/**
 * 消息高度估算器的形式化不变量（Adaptive Median Estimator）
 *
 * 【守护什么】对任意高度序列（含负数、0、超出上下限的离群值），
 *   中位数恒落在 `[minHeightPx, max(minHeightPx, maxHeightPx)]`，
 *   窗口样本数恒不超过容量，空样本恒返回默认高度。
 *
 * 【为什么必须属性测试】这个值会直接注入 `contain-intrinsic-size`。
 *   一旦离群值把基准行高拉偏，长会话滚动条滑块会在每条消息滑入时缩放，
 *   用户感到的是"滚动条在抖"。示例式单测很难覆盖连续值域里的夹取边界。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { AdaptiveMedianEstimator } from '../../dist/viewport/adaptiveMedianEstimator.js';

const HEIGHT = fc.double({ min: -5000, max: 50000, noNaN: true });

test('INV-VIEW-02：中位数要么是默认高度，要么恒落在夹取区间内，且窗口容量不越界', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 5, max: 40 }),
      fc.integer({ min: 10, max: 200 }),
      fc.integer({ min: 10, max: 800 }),
      fc.array(HEIGHT, { minLength: 1, maxLength: 300 }),
      (windowSize, minHeightPx, maxHeightPx, samples) => {
        const estimator = new AdaptiveMedianEstimator({ windowSize, minHeightPx, maxHeightPx });
        const upper = Math.max(minHeightPx, maxHeightPx);

        for (const sample of samples) {
          estimator.addSample(sample);
          assert.ok(estimator.sampleCount <= windowSize, '滑动窗口容量必须硬上限，禁止无界累积');
          const median = estimator.getMedian();
          if (estimator.sampleCount === 0) {
            // 无有效样本时只能回落到默认高度，此时不与夹取区间比较：
            // defaultHeightPx 与 min/max 是两组独立配置，默认可低于最小行高。
            assert.equal(median, 140, '无样本时必须回落到默认高度 140px');
            continue;
          }
          assert.ok(
            median >= minHeightPx && median <= upper,
            `中位数 ${median} 越出夹取区间 [${minHeightPx}, ${upper}]`,
          );
        }
      },
    ),
    { numRuns: 300 },
  );
});

test('INV-VIEW-02b：非法样本一律被拒绝，空样本恒回落到默认高度', () => {
  fc.assert(
    fc.property(
      fc.array(fc.oneof(fc.constant(0), fc.constant(-1), fc.constant(Number.NaN), fc.constant(Number.POSITIVE_INFINITY)), {
        minLength: 1,
        maxLength: 50,
      }),
      fc.double({ min: 30, max: 400, noNaN: true }),
      (invalidSamples, defaultHeightPx) => {
        const estimator = new AdaptiveMedianEstimator({ defaultHeightPx });
        for (const sample of invalidSamples) estimator.addSample(sample);
        assert.equal(estimator.sampleCount, 0, '0 / 负数 / NaN / Infinity 都不得进入样本');
        assert.equal(estimator.getMedian(), defaultHeightPx, '空样本必须回落到默认高度');

        estimator.addSample(120);
        estimator.reset();
        assert.equal(estimator.sampleCount, 0);
        assert.equal(estimator.getMedian(), defaultHeightPx, 'reset 后必须再次回落默认高度');
      },
    ),
    { numRuns: 150 },
  );
});
