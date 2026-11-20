/**
 * Hermes Flux 全局极客美学 Tooltip 控制器与微组件测试套件
 *
 * 【设计意图 (Why)】
 * 验证自定义极客 Tooltip 控制器（物理阻断 Chromium 原生黑块墨渍、视口边界夹取碰撞避让、
 * 延迟与快速连击调度）以及 React `<Tooltip>` 声明式微组件的属性契约，
 * 保证零假冒交付与变异杀伤力。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  calculateTooltipPosition,
  mountGlobalTooltip,
  unmountGlobalTooltip,
  hideTooltip,
} from '../dist/lib/globalTooltip.js';
import { Tooltip } from '../dist/components-react/primitives/Tooltip.js';

test('calculateTooltipPosition: 基础几何与居中定位', () => {
  const targetRect = {
    left: 100,
    top: 200,
    width: 32,
    height: 32,
    right: 132,
    bottom: 232,
  };
  const tooltipW = 80;
  const tooltipH = 24;

  // 默认 top: 水平居中 (100 + (32 - 80) / 2 = 76), 垂直间距 6px (200 - 24 - 6 = 170)
  const posTop = calculateTooltipPosition(targetRect, tooltipW, tooltipH, 'top', 1000, 800);
  assert.equal(posTop.x, 76, '水平居中计算准确');
  assert.equal(posTop.y, 170, '上方间距 6px 计算准确');
  assert.equal(posTop.placement, 'top');

  // bottom: (232 + 6 = 238)
  const posBottom = calculateTooltipPosition(targetRect, tooltipW, tooltipH, 'bottom', 1000, 800);
  assert.equal(posBottom.x, 76);
  assert.equal(posBottom.y, 238);
  assert.equal(posBottom.placement, 'bottom');

  // right: (132 + 6 = 138), 垂直居中 (200 + (32 - 24) / 2 = 204)
  const posRight = calculateTooltipPosition(targetRect, tooltipW, tooltipH, 'right', 1000, 800);
  assert.equal(posRight.x, 138);
  assert.equal(posRight.y, 204);
  assert.equal(posRight.placement, 'right');

  // left: (100 - 80 - 6 = 14)
  const posLeft = calculateTooltipPosition(targetRect, tooltipW, tooltipH, 'left', 1000, 800);
  assert.equal(posLeft.x, 14);
  assert.equal(posLeft.y, 204);
  assert.equal(posLeft.placement, 'left');
});

test('calculateTooltipPosition: 视口边界碰撞与自动翻转', () => {
  const tooltipW = 100;
  const tooltipH = 30;

  // 1. 顶部贴边无法容纳上方气泡时，自动翻转到下方
  const nearTopTarget = {
    left: 200,
    top: 10,
    width: 40,
    height: 40,
    right: 240,
    bottom: 50,
  };
  const flippedBottom = calculateTooltipPosition(nearTopTarget, tooltipW, tooltipH, 'top', 1000, 800);
  assert.equal(flippedBottom.placement, 'bottom', '顶部空间不足时自动翻转到下方');
  assert.equal(flippedBottom.y, 56);

  // 2. 底部贴边无法容纳下方气泡时，自动翻转到上方
  const nearBottomTarget = {
    left: 200,
    top: 770,
    width: 40,
    height: 40,
    right: 240,
    bottom: 810,
  };
  const flippedTop = calculateTooltipPosition(nearBottomTarget, tooltipW, tooltipH, 'bottom', 1000, 800);
  assert.equal(flippedTop.placement, 'top', '底部空间不足时自动翻转到上方');
  assert.equal(flippedTop.y, 734);

  // 3. 左侧屏幕边缘夹取 (Clamp >= 8px)
  const leftEdgeTarget = {
    left: 2,
    top: 300,
    width: 20,
    height: 20,
    right: 22,
    bottom: 320,
  };
  const clampLeft = calculateTooltipPosition(leftEdgeTarget, tooltipW, tooltipH, 'top', 1000, 800);
  assert.equal(clampLeft.x, 8, '左侧贴边被夹取至安全距离 8px');

  // 4. 右侧屏幕边缘夹取 (Clamp <= viewportW - tooltipW - 8px)
  const rightEdgeTarget = {
    left: 990,
    top: 300,
    width: 20,
    height: 20,
    right: 1010,
    bottom: 320,
  };
  const clampRight = calculateTooltipPosition(rightEdgeTarget, tooltipW, tooltipH, 'top', 1000, 800);
  assert.equal(clampRight.x, 1000 - 100 - 8, '右侧贴边被夹取至安全边界');
});

test('React Tooltip 组件: 属性注入与无侵入渲染', () => {
  // 1. 基础注入 data-tooltip 与 data-tooltip-placement
  const markup = renderToStaticMarkup(
    React.createElement(
      Tooltip,
      { content: '新建会话', placement: 'bottom' },
      React.createElement('button', { type: 'button', className: 'btn-plus' }, '+'),
    ),
  );
  assert.ok(markup.includes('data-tooltip="新建会话"'), '必须注入 data-tooltip 属性');
  assert.ok(markup.includes('data-tooltip-placement="bottom"'), '必须注入指定的 placement');
  assert.ok(markup.includes('aria-label="新建会话"'), '必须同步注入可访问性 aria-label');
  assert.ok(!markup.includes('title='), '严禁直接渲染原生 title 属性，防原生黑框墨渍');

  // 2. disabled 态下不注入
  const disabledMarkup = renderToStaticMarkup(
    React.createElement(
      Tooltip,
      { content: '新建会话', disabled: true },
      React.createElement('button', { type: 'button' }, '+'),
    ),
  );
  assert.ok(!disabledMarkup.includes('data-tooltip='), 'disabled 时不得注入 data-tooltip');

  // 3. 保留子元素原有属性
  const preservedMarkup = renderToStaticMarkup(
    React.createElement(
      Tooltip,
      { content: '设置' },
      React.createElement('button', { type: 'button', id: 'btn-test', 'aria-label': '原有标签' }, '⚙'),
    ),
  );
  assert.ok(preservedMarkup.includes('id="btn-test"'));
  assert.ok(preservedMarkup.includes('aria-label="原有标签"'), '子元素原有的 aria-label 必须保留');
});

test('全局 Tooltip 代理: 模拟 DOM 下的原生 title 拦截与剥离契约', () => {
  // 构造轻量 DOM 树与事件系统
  const listeners = new Map();
  const bodyChildren = [];

  const fakeBody = {
    contains(node) {
      return bodyChildren.includes(node);
    },
    appendChild(node) {
      bodyChildren.push(node);
      node.parentNode = fakeBody;
      return node;
    },
    removeChild(node) {
      const idx = bodyChildren.indexOf(node);
      if (idx >= 0) bodyChildren.splice(idx, 1);
      node.parentNode = null;
      return node;
    },
  };

  const fakeDocument = {
    body: fakeBody,
    getElementById(id) {
      return bodyChildren.find((n) => n.id === id) || null;
    },
    createElement(tag) {
      const attrs = new Map();
      const el = {
        tagName: tag.toUpperCase(),
        style: {},
        dataset: {},
        parentNode: null,
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.get(k) || null; },
        hasAttribute(k) { return attrs.has(k); },
        removeAttribute(k) { attrs.delete(k); },
        getBoundingClientRect() { return { left: 50, top: 50, width: 60, height: 20, right: 110, bottom: 70 }; },
      };
      return el;
    },
    addEventListener(name, handler, opts) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
    removeEventListener(name, handler) {
      const list = listeners.get(name);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    },
  };

  const savedDoc = globalThis.document;
  const savedWin = globalThis.window;
  const savedElement = globalThis.Element;

  try {
    globalThis.document = fakeDocument;
    globalThis.window = {
      innerWidth: 1200,
      innerHeight: 800,
      clearTimeout: clearTimeout,
      setTimeout: setTimeout,
      addEventListener() {},
      removeEventListener() {},
    };
    class FakeElement {}
    globalThis.Element = FakeElement;

    // 挂载全局监听
    const cleanup = mountGlobalTooltip({ showDelayMs: 0, warmShowDelayMs: 0 });
    assert.equal(typeof cleanup, 'function');

    // 再次调用 mount 应幂等返回同一清理句柄
    const cleanup2 = mountGlobalTooltip();
    assert.equal(cleanup2, cleanup, '幂等挂载单例');

    // 构造测试目标元素
    const targetAttrs = new Map([['title', '新建会话']]);
    const targetEl = Object.assign(new FakeElement(), {
      dataset: {},
      setAttribute(k, v) { targetAttrs.set(k, String(v)); },
      getAttribute(k) { return targetAttrs.get(k) || null; },
      hasAttribute(k) { return targetAttrs.has(k); },
      removeAttribute(k) { targetAttrs.delete(k); },
      closest(sel) {
        if (sel.includes('[title]') || sel.includes('[data-tooltip]')) return targetEl;
        return null;
      },
      contains() { return false; },
      getBoundingClientRect() {
        return { left: 100, top: 100, width: 24, height: 24, right: 124, bottom: 124 };
      },
    });

    // 模拟 pointerover 触发
    const pointeroverHandlers = listeners.get('pointerover') || [];
    assert.ok(pointeroverHandlers.length > 0, '必须注册 pointerover 捕获监听');

    pointeroverHandlers[0]({ pointerType: 'mouse', target: targetEl });

    // 断言 1: 原生 title 已被清空/剥离（阻断 Chromium 默认黑块）
    assert.equal(targetEl.hasAttribute('title'), false, 'hover 期间必须物理剥离原生 title');
    assert.equal(targetEl.dataset.fluxTooltip, '新建会话', '文案被安全转存到 dataset.fluxTooltip');
    assert.equal(targetEl.getAttribute('aria-label'), '新建会话', '保障 A11y 屏幕阅读器可读');

    // 模拟 pointerout 移开
    const pointeroutHandlers = listeners.get('pointerout') || [];
    assert.ok(pointeroutHandlers.length > 0, '必须注册 pointerout 捕获监听');
    pointeroutHandlers[0]({ relatedTarget: null });

    // 断言 2: 移开后必须恢复 title，确保测试断言完全透明
    assert.equal(targetEl.getAttribute('title'), '新建会话', '移开后必须无损恢复原生 title 属性');

    // 清理卸载
    unmountGlobalTooltip();
    assert.equal(bodyChildren.length, 0, '卸载时必须清除全局单例 DOM 节点');
  } finally {
    globalThis.document = savedDoc;
    globalThis.window = savedWin;
    globalThis.Element = savedElement;
  }
});
