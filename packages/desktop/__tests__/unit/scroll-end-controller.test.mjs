/**
 * 「回到底部」宿主控制器单测（最小 DOM 桩）。
 *
 * 【断言与杀伤力】
 *   1. dock 形态下 actionbar 装配、presence host 迁移、按钮挂载；
 *   2. 48 / 49 边界写对 data-at-bottom 与 aria-hidden / tabindex；
 *   3. 点击启动平滑会话，连续两帧 <= 2px 才收敛；
 *   4. 用户打断写 instant，切会话 / 断连绝不写 instant；
 *   5. 切会话隐藏会带 data-motion-suppressed，且 300ms 后自动清除。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const rafQueue = [];
const timeoutQueue = [];
const scrollCalls = [];

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.isConnected = false;
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this.scrollHeight = 600;
    this.clientHeight = 600;
    this.scrollTop = 0;
  }
  get id() {
    return this.attrs.id ?? '';
  }
  set id(value) {
    this.setAttribute('id', value);
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get classList() {
    const self = this;
    return {
      contains: (name) => self.className.split(/\s+/).filter(Boolean).includes(name),
      add: (name) => {
        if (!self.className.split(/\s+/).includes(name)) self.className = `${self.className} ${name}`.trim();
      },
      remove: (name) => {
        self.className = self.className.split(/\s+/).filter((item) => item && item !== name).join(' ');
      },
    };
  }
  appendChild(child) {
    return this.insertBefore(child, null);
  }
  insertBefore(child, reference) {
    if (child.parentElement) child.parentElement.removeChild(child);
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    child.parentElement = this;
    child.isConnected = this.isConnected;
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
    child.isConnected = false;
  }
  remove() {
    this.parentElement?.removeChild(this);
  }
  querySelector(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const id = selector.startsWith('#') ? selector.slice(1) : null;
    for (const child of this.children) {
      if (className && child.classList.contains(className)) return child;
      if (id && child.attrs.id === id) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  closest(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    let node = this;
    while (node) {
      if (className && node.classList.contains(className)) return node;
      node = node.parentElement;
    }
    return null;
  }
  setAttribute(key, value) {
    this.attrs[key] = String(value);
    if (key === 'id') registry.set(String(value), this);
  }
  getAttribute(key) {
    return this.attrs[key] ?? null;
  }
  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(type, handler) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== handler);
  }
  scrollTo(options) {
    scrollCalls.push(options);
    if (typeof options?.top === 'number') this.scrollTop = options.top;
  }
}

const registry = new Map();

globalThis.HTMLElement = FakeElement;
globalThis.requestAnimationFrame = (callback) => {
  rafQueue.push(callback);
  return rafQueue.length;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.document = {
  activeElement: null,
  createElement: (tag) => new FakeElement(tag),
  getElementById: (id) => registry.get(id) ?? null,
  querySelector: (selector) => {
    if (selector === '.input-dock-container') return dock;
    if (selector === '#conversation-stream') return stream;
    return null;
  },
};
globalThis.window = {
  setTimeout: (callback, ms) => {
    timeoutQueue.push({ callback, ms });
    return timeoutQueue.length;
  },
  clearTimeout: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};

const dock = new FakeElement('div');
dock.className = 'input-dock-container';
dock.isConnected = true;
const stream = new FakeElement('div');
stream.className = 'conv-stream';
stream.isConnected = true;

const presenceHost = new FakeElement('div');
presenceHost.setAttribute('id', 'react-conv-presence-host');
presenceHost.className = 'presence-host--dock';
dock.appendChild(presenceHost);

const { createScrollEndController } = await import('../../dist/renderer/scrollEndController.mjs');

function makeController(overrides = {}) {
  let nowMs = 0;
  return createScrollEndController({
    isGatewayConnected: () => true,
    getPresenceLayout: () => 'dock',
    getLang: () => 'zh-CN',
    t: (key) => (key === 'conversation.scrollToEnd' ? '回到底部' : '滚动到会话末尾'),
    getStreamElement: () => stream,
    getDockElement: () => dock,
    isSessionEnterPending: () => false,
    isInitialBottomSettling: () => false,
    scrollStreamToEndSmooth: () => true,
    scrollStreamToBottomFallback: () => {},
    mountButton: (host, getSnapshot) => {
      const snapshot = getSnapshot();
      const button = document.createElement('button');
      button.className = 'scroll-end';
      button.setAttribute('aria-label', snapshot.ariaLabel);
      button.addEventListener('click', snapshot.onClick);
      host.appendChild(button);
      return { update: () => {}, unmount: () => button.remove() };
    },
    now: () => nowMs,
    requestAnimationFrame: (callback) => {
      rafQueue.push(callback);
      return rafQueue.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (callback, ms) => {
      timeoutQueue.push({ callback, ms });
      return timeoutQueue.length;
    },
    clearTimeout: () => {},
    ...overrides,
  });
}

function flushRaf(limit = 4) {
  for (let i = 0; i < limit; i += 1) {
    const callback = rafQueue.shift();
    if (!callback) return;
    callback();
  }
}

test('scrollEndController: 装配、显隐与无障碍', async (t) => {
  await t.test('1. dock 装配：actionbar 创建，presence host 迁入 inner，按钮挂载', () => {
    const controller = makeController();
    controller.syncHost();

    const actionbar = dock.querySelector('.dock-actionbar');
    assert.ok(actionbar, '必须创建 .dock-actionbar');
    assert.equal(actionbar.dataset.presenceLayout, 'dock');
    const inner = dock.querySelector('.dock-actionbar__inner');
    assert.ok(inner, '必须创建 inner');
    assert.ok(inner.children.includes(presenceHost), 'presence host 必须迁入 inner');
    assert.ok(inner.querySelector('#react-scroll-end-host'), '必须创建按钮宿主');
    assert.ok(actionbar.querySelector('.scroll-end'), '必须挂载按钮');
    controller.dispose();
  });

  await t.test('2. 49px 显示、48px 隐藏，并写 aria / tabindex', () => {
    const controller = makeController();
    controller.syncHost();
    const actionbar = dock.querySelector('.dock-actionbar');
    const button = actionbar.querySelector('.scroll-end');

    stream.scrollHeight = 600;
    stream.clientHeight = 600;
    stream.scrollTop = -49;
    controller.syncVisibility();
    assert.equal(actionbar.dataset.atBottom, 'false');
    assert.equal(button.getAttribute('aria-hidden'), 'false');
    assert.equal(button.getAttribute('tabindex'), '0');

    stream.scrollTop = -48;
    controller.syncVisibility();
    assert.equal(actionbar.dataset.atBottom, 'true');
    assert.equal(button.getAttribute('aria-hidden'), 'true');
    assert.equal(button.getAttribute('tabindex'), '-1');
    controller.dispose();
  });
});

test('scrollEndController: 平滑会话', async (t) => {
  await t.test('1. 点击启动，连续两帧 <= 2px 收敛', () => {
    rafQueue.length = 0;
    const controller = makeController();
    controller.syncHost();
    stream.scrollHeight = 2600;
    stream.clientHeight = 600;
    stream.scrollTop = 0;

    controller.scrollToEnd();
    assert.equal(controller.isSmoothScrollActive(), true, '点击后必须进入 running');

    stream.scrollTop = 2000;
    flushRaf(1);
    assert.equal(controller.isSmoothScrollActive(), true, '第一帧 <= 2px 仍需等待');

    stream.scrollTop = 2000;
    flushRaf(1);
    assert.equal(controller.isSmoothScrollActive(), false, '连续两帧 <= 2px 才收敛');
    controller.dispose();
  });

  await t.test('2. 用户打断写 instant；切会话不写', () => {
    scrollCalls.length = 0;
    const controller = makeController();
    controller.syncHost();
    stream.scrollHeight = 2600;
    stream.clientHeight = 600;
    stream.scrollTop = 0;
    controller.scrollToEnd();

    controller.cancelSmoothScroll({ stopNativeSmooth: true });
    assert.ok(scrollCalls.some((call) => call.behavior === 'instant'), '用户打断必须写 instant');

    scrollCalls.length = 0;
    stream.scrollTop = 0;
    controller.scrollToEnd();
    controller.cancelSmoothScroll({ stopNativeSmooth: false, hideImmediately: true });
    assert.equal(
      scrollCalls.some((call) => call.behavior === 'instant'),
      false,
      '切会话不得写 instant',
    );
    const actionbar = dock.querySelector('.dock-actionbar');
    assert.equal(actionbar.dataset.atBottom, 'true', '切会话必须立即隐藏');
    assert.equal(actionbar.dataset.motionSuppressed, 'true', '切会话首帧必须抑制过渡');
    controller.dispose();
  });

  await t.test('3. 300ms 兜底清除 motion-suppressed', () => {
    const controller = makeController();
    controller.syncHost();
    const actionbar = dock.querySelector('.dock-actionbar');
    controller.cancelSmoothScroll({ stopNativeSmooth: false, hideImmediately: true });
    assert.equal(actionbar.dataset.motionSuppressed, 'true', '切会话首帧必须抑制过渡');

    const target = timeoutQueue.filter((item) => item.ms === 300).at(-1);
    assert.ok(target, '必须注册 300ms 清理定时器');
    target.callback();
    assert.equal(actionbar.dataset.motionSuppressed, undefined, '300ms 后必须清除抑制标记');
    controller.dispose();
  });
});

test('scrollEndController: 重建自愈、断连与失败回退', async (t) => {
  await t.test('1. dock outerHTML 重建后按钮必须重新挂载', () => {
    stream.listeners = {};
    const controller = makeController();
    controller.syncHost();
    const oldActionbar = dock.querySelector('.dock-actionbar');
    assert.ok(oldActionbar, '首次挂载必须存在 actionbar');

    oldActionbar.remove();
    controller.syncHost();
    const rebuilt = dock.querySelector('.dock-actionbar');
    assert.ok(rebuilt, '重建后必须创建新的 actionbar');
    const rebuiltHost = rebuilt.querySelector('#react-scroll-end-host');
    assert.ok(rebuiltHost, '重建后必须存在按钮宿主');
    assert.ok(rebuiltHost.children.length > 0, '重建后宿主必须有按钮节点（P0-1 回归）');
    controller.dispose();
  });

  await t.test('2. 断连必须取消平滑会话并移除 actionbar', () => {
    stream.listeners = {};
    let connected = true;
    const controller = makeController({ isGatewayConnected: () => connected });
    controller.syncHost();
    stream.scrollHeight = 2600;
    stream.clientHeight = 600;
    stream.scrollTop = 0;
    controller.scrollToEnd();
    assert.equal(controller.isSmoothScrollActive(), true);

    controller.cancelSmoothScroll({ stopNativeSmooth: false, reason: 'disconnect' });
    assert.equal(controller.isSmoothScrollActive(), false, '断连必须清平滑会话');

    connected = false;
    controller.syncHost();
    assert.equal(dock.querySelector('.dock-actionbar'), null, '断连必须移除 actionbar');
    controller.dispose();
  });

  await t.test('3. scrollStreamToEndSmooth 返回 false 时必须回 idle 并隐藏', () => {
    const controller = makeController({ scrollStreamToEndSmooth: () => false });
    controller.syncHost();
    stream.scrollHeight = 2600;
    stream.clientHeight = 600;
    stream.scrollTop = 0;
    controller.scrollToEnd();
    assert.equal(controller.isSmoothScrollActive(), false, '启动失败必须回 idle');
    assert.equal(dock.querySelector('.dock-actionbar').dataset.atBottom, 'true', '启动失败必须隐藏按钮');
    controller.dispose();
  });

  await t.test('4. scrollend 落在 2~48px 必须调用即时补齐', () => {
    const fallbacks = [];
    const controller = makeController({ scrollStreamToBottomFallback: (reason) => fallbacks.push(reason) });
    controller.syncHost();
    stream.scrollHeight = 2600;
    stream.clientHeight = 600;
    stream.scrollTop = 0;
    controller.scrollToEnd();
    stream.scrollTop = 1970;

    const streamEl = stream;
    for (const handler of streamEl.listeners.scrollend ?? []) handler();
    assert.deepEqual(fallbacks, ['scroll-to-end-converge']);
    assert.equal(controller.isSmoothScrollActive(), false);
    controller.dispose();
  });

  await t.test('5. stream 替换后旧监听必须回收', () => {
    stream.listeners = {};
    const controller = makeController();
    controller.syncHost();
    const firstStream = stream;
    const firstWheelCount = (firstStream.listeners.wheel ?? []).length;
    assert.ok(firstWheelCount > 0, '首次绑定必须有 wheel 监听');

    const nextStream = new FakeElement('div');
    nextStream.className = 'conv-stream';
    nextStream.isConnected = true;
    controller.bindStreamListeners(nextStream);
    assert.equal((firstStream.listeners.wheel ?? []).length, 0, '旧流监听必须解绑');
    assert.ok((nextStream.listeners.wheel ?? []).length > 0, '新流必须绑定监听');
    controller.dispose();
  });
});
