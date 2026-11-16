/**
 * 模型思考等级二级级联定位领域单测（Model Cascade Manager Test）
 *
 * 【断言与杀伤力】
 *   1. 几何定位：右侧充足为 default、右狭窄左充足为 flip、双侧均狭窄切 inset；
 *   2. 垂直边界夹取：底部超界 clamp 到 viewportBottom - height，顶部不低于 8px；
 *   3. 抑制窗口状态机：选完等级后在 TTL 内抑制重复弹出，过期后自动恢复；
 *   4. 抑制模型精准度：null 对所有模型生效，特定 model 仅对该模型生效；
 *   5. 延迟隐藏调度：离开行后调度 160ms 延迟，再次进入或取消隐藏可打断收起。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCascadeLayout,
  ModelCascadeManager,
  CASCADE_VIEWPORT_PADDING_PX,
} from '../../dist/renderer/cascade/modelCascadeManager.mjs';

test('Model Cascade 几何定位与状态机单测', async (t) => {
  await t.test('1. 几何三档判定：右侧充足为 default，左侧充足为 flip，双侧不足为 inset', () => {
    // 1.1 右侧充足 (spaceRight >= 160)
    const rightLayout = computeCascadeLayout({
      rowRect: { top: 100, bottom: 130, left: 200, right: 350, width: 150, height: 30 },
      dropdownRect: { top: 50, bottom: 500, left: 150, right: 350, width: 200, height: 450 },
      cascadeRect: { top: 0, bottom: 0, left: 0, right: 0, width: 148, height: 180 },
      windowInnerWidth: 1000, // spaceRight = 650 >= 160
      windowInnerHeight: 800,
      dropdownClientTop: 1,
    });
    assert.equal(rightLayout.mode, 'default');
    assert.equal(rightLayout.useInset, false);

    // 1.2 右侧不足但左侧充足
    const flipLayout = computeCascadeLayout({
      rowRect: { top: 100, bottom: 130, left: 600, right: 780, width: 180, height: 30 },
      dropdownRect: { top: 50, bottom: 500, left: 550, right: 780, width: 230, height: 450 },
      cascadeRect: { top: 0, bottom: 0, left: 0, right: 0, width: 148, height: 180 },
      windowInnerWidth: 800, // spaceRight = 20 < 160; spaceLeft = 550 >= 160
      windowInnerHeight: 800,
      dropdownClientTop: 1,
    });
    assert.equal(flipLayout.mode, 'flip');
    assert.equal(flipLayout.useInset, false);

    // 1.3 双侧均不足 (窄屏内缩)
    const insetLayout = computeCascadeLayout({
      rowRect: { top: 100, bottom: 130, left: 50, right: 280, width: 230, height: 30 },
      dropdownRect: { top: 50, bottom: 500, left: 50, right: 280, width: 230, height: 450 },
      cascadeRect: { top: 0, bottom: 0, left: 0, right: 0, width: 148, height: 180 },
      windowInnerWidth: 320, // spaceRight = 40; spaceLeft = 50
      windowInnerHeight: 600,
      dropdownClientTop: 1,
    });
    assert.equal(insetLayout.mode, 'inset');
    assert.equal(insetLayout.useInset, true);
  });

  await t.test('2. 垂直边界夹取：底部超限 clamp 到 viewportBottom - height，顶部不低于 8px', () => {
    // 接近视口底部的行 (top: 750, 视口高 800)
    const bottomClamped = computeCascadeLayout({
      rowRect: { top: 750, bottom: 780, left: 100, right: 300, width: 200, height: 30 },
      dropdownRect: { top: 200, bottom: 790, left: 100, right: 300, width: 200, height: 590 },
      cascadeRect: { top: 0, bottom: 0, left: 0, right: 0, width: 148, height: 200 },
      windowInnerWidth: 1000,
      windowInnerHeight: 800,
      dropdownClientTop: 1,
    });
    // viewportBottom = 800 - 8 = 792; maxTop = 792 - 200 = 592
    assert.equal(bottomClamped.clampedTop, 592, '底部必须 clamp 到 592px');
    assert.equal(bottomClamped.relativeTopPx, 592 - 200 - 1);

    // 超出顶部的负坐标行 (top: -50)
    const topClamped = computeCascadeLayout({
      rowRect: { top: -50, bottom: -20, left: 100, right: 300, width: 200, height: 30 },
      dropdownRect: { top: -100, bottom: 300, left: 100, right: 300, width: 200, height: 400 },
      cascadeRect: { top: 0, bottom: 0, left: 0, right: 0, width: 148, height: 150 },
      windowInnerWidth: 1000,
      windowInnerHeight: 800,
      dropdownClientTop: 0,
    });
    assert.equal(topClamped.clampedTop, CASCADE_VIEWPORT_PADDING_PX, '顶部不低于 8px 留白');
  });

  await t.test('3. 抑制窗口状态机：选完等级后在 TTL 内抑制重复弹出', () => {
    let now = 1000;
    const manager = new ModelCascadeManager({
      getCascadeElement: () => null,
      getDropdownElement: () => null,
      now: () => now,
    });

    // 针对特定模型抑制 400ms
    manager.armSuppression('claude-3-5', 400);
    assert.equal(manager.shouldSuppress('claude-3-5'), true, 'TTL 内同一模型必须被抑制');
    assert.equal(manager.shouldSuppress('gpt-4o'), false, '未抑制的模型不受影响');

    // 时间推进到 1401ms
    now = 1401;
    assert.equal(manager.shouldSuppress('claude-3-5'), false, 'TTL 过期后必须解除抑制');

    // 针对全局模型抑制 (model = null) 600ms
    manager.armSuppression(null, 600);
    assert.equal(manager.shouldSuppress('any-model'), true, '全局抑制对任何模型均生效');
    now = 2001;
    assert.equal(manager.shouldSuppress('any-model'), false);
  });

  await t.test('4. 延迟隐藏调度：离开行后调度 160ms 延迟，再次进入或取消隐藏可打断收起', () => {
    let currentTimer = null;
    let scheduledDelay = 0;
    let hideCount = 0;

    const fakeCascade = { style: { display: 'block' } };
    const manager = new ModelCascadeManager({
      getCascadeElement: () => fakeCascade,
      getDropdownElement: () => null,
      setTimeout: (cb, ms) => {
        scheduledDelay = ms;
        currentTimer = 42;
        return 42;
      },
      clearTimeout: (id) => {
        assert.equal(id, 42);
        currentTimer = null;
      },
      onModelChange: () => {},
    });

    manager.scheduleHide(160);
    assert.equal(scheduledDelay, 160);
    assert.equal(currentTimer, 42);

    // 取消收起
    manager.cancelHide();
    assert.equal(currentTimer, null, '定时器已被取消');

    // 触发 hide
    manager.hide();
    assert.equal(fakeCascade.style.display, 'none');
    assert.equal(manager.getCurrentModel(), undefined);
  });
});
