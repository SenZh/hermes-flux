/**
 * 消息自适应中位数估算器 (AdaptiveMedianEstimator) 单元测试
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveMedianEstimator } from '../../dist/viewport/adaptiveMedianEstimator.js';

test('AdaptiveMedianEstimator Unit Tests', async (t) => {
  await t.test('1. 空采样回退到默认高度', () => {
    const estimator = new AdaptiveMedianEstimator({ defaultHeightPx: 140 });
    assert.equal(estimator.getMedian(), 140);
  });

  await t.test('2. 奇数与偶数样本的中位数计算正确性', () => {
    const estimator = new AdaptiveMedianEstimator();
    // 奇数样本：100, 150, 200 => 中位数 150
    estimator.addSample(100);
    estimator.addSample(200);
    estimator.addSample(150);
    assert.equal(estimator.getMedian(), 150);

    // 偶数样本：加入 300 => 100, 150, 200, 300 => (150 + 200) / 2 = 175
    estimator.addSample(300);
    assert.equal(estimator.getMedian(), 175);
  });

  await t.test('3. 对极端离群值（大代码块或极小高度）的抗扰性与非法输入防御', () => {
    const estimator = new AdaptiveMedianEstimator({
      minHeightPx: 30,
      maxHeightPx: 3000,
    });

    // 非法输入安全防御（非 number、NaN、负数、零）
    estimator.addSample(null);
    estimator.addSample(undefined);
    estimator.addSample('100');
    estimator.addSample(Number.NaN);
    estimator.addSample(-50);
    estimator.addSample(0);
    assert.equal(estimator.sampleCount, 0);

    estimator.addSample(120);
    estimator.addSample(130);
    estimator.addSample(140);
    // 注入极端离群值：单条 10,000px 的巨型文件输出
    estimator.addSample(10000);
    // 注入极端离群值：单条 5px 的空行
    estimator.addSample(5);

    // 排序后样本为：[30 (clamped), 120, 130, 140, 3000 (clamped)] => 中位数为 130！
    assert.equal(estimator.getMedian(), 130, '中位数必须完全免疫极端两极离群值干扰');

    // 测试 reset
    estimator.reset();
    assert.equal(estimator.sampleCount, 0);
    assert.equal(estimator.getMedian(), 140);
  });

  await t.test('4. 滑动窗口容量上限维护', () => {
    const estimator = new AdaptiveMedianEstimator({ windowSize: 5 });
    for (let i = 1; i <= 10; i++) {
      estimator.addSample(i * 10);
    }
    assert.equal(estimator.sampleCount, 5);
  });

  await t.test('5. 构造函数参数全路径与越界截断覆盖', () => {    // 覆盖默认参数
    const defEstimator = new AdaptiveMedianEstimator();
    assert.equal(defEstimator.getMedian(), 140);

    // 覆盖显式指定合法参数
    const explicitEstimator = new AdaptiveMedianEstimator({
      windowSize: 20,
      defaultHeightPx: 120,
      minHeightPx: 40,
      maxHeightPx: 2000,
    });
    assert.equal(explicitEstimator.getMedian(), 120);

    // 覆盖 Math.max 越界截断：过小的默认高度与倒挂的上下限都必须被夹到构造下限，
    // 而不是回落到 140——140 是"未传参"的默认值，传了非法值不能伪装成默认值。
    const clampedEstimator = new AdaptiveMedianEstimator({
      windowSize: 2,
      defaultHeightPx: 10,
      minHeightPx: 5,
      maxHeightPx: 1,
    });
    assert.equal(clampedEstimator.getMedian(), 30, '默认高度与窗口容量一样按显式下限夹取');

    // 倒挂的上下限：maxHeightPx 必须被抬到 minHeightPx，避免样本区间为空
    clampedEstimator.addSample(1000);
    assert.equal(clampedEstimator.getMedian(), 10, '样本必须落在 [minHeightPx, maxHeightPx] 内，倒挂时以 min 为准');
  });

  await t.test('6. 显式 windowSize 必须被尊重，容量不得被下限覆盖', () => {
    const estimator = new AdaptiveMedianEstimator({ windowSize: 20 });
    for (let i = 1; i <= 15; i += 1) {
      estimator.addSample(i * 10);
    }
    assert.equal(estimator.sampleCount, 15, '容量 20 时必须保留全部 15 条样本，不得被夹到下限 5');
    assert.equal(estimator.getMedian(), 80, '15 条样本的中位数必须是第 8 条');
  });
});
