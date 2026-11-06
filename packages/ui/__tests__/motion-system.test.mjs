import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMotionTokens, isReducedMotionPreferred, STATIC_FALLBACK_TOKENS } from '../dist/motion/motion-tokens.js';
import { attachMotionController } from '../dist/motion/controller.js';

test('resolveMotionTokens：Node.js 无 DOM 环境安全降级到静态宪法 Token', () => {
  const tokens = resolveMotionTokens(null);
  assert.equal(tokens.durationEnter, STATIC_FALLBACK_TOKENS.durationEnter);
  assert.equal(tokens.durationExit, STATIC_FALLBACK_TOKENS.durationExit);
  assert.equal(tokens.fallbackBuffer, STATIC_FALLBACK_TOKENS.fallbackBuffer);

  // 防崩断言
  assert.equal(isReducedMotionPreferred(), false);
});

test('attachMotionController：靶心冒泡隔离变异杀伤力断言', async () => {
  // 模拟极简 DOM 宿主与事件系统
  const listeners = new Map();
  const attributes = new Map();

  const hostElement = {
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    setAttribute(name, val) {
      attributes.set(name, String(val));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {
      const list = listeners.get(event) || [];
      listeners.set(event, list.filter((l) => l !== fn));
    },
    dispatchEvent(ev) {
      const list = listeners.get(ev.type) || [];
      for (const fn of list) fn(ev);
    },
  };

  const childElement = { ...hostElement };

  let exitedCalled = false;
  const controller = attachMotionController(hostElement, {
    triggerProperty: 'opacity',
    onExited: () => {
      exitedCalled = true;
    },
  });

  // 1. 唤起进入 entering
  await controller.enter();
  assert.equal(controller.status, 'entering');
  assert.equal(attributes.get('data-motion-state'), 'entering');
  assert.equal(attributes.has('inert'), false);

  // 模拟宿主自身完成入场
  hostElement.dispatchEvent({
    type: 'transitionend',
    target: hostElement,
    currentTarget: hostElement,
    propertyName: 'opacity',
  });
  assert.equal(controller.status, 'entered');

  // 2. 触发退场
  await controller.exit();
  assert.equal(controller.status, 'exiting');
  assert.equal(attributes.get('data-motion-state'), 'exiting');
  assert.equal(attributes.has('inert'), true, 'exiting 瞬间必须注入 inert 阻断幽灵焦点');
  assert.equal(attributes.get('aria-hidden'), 'true');

  // 3. 关键变异杀伤力断言：子节点派发冒泡的 transitionend
  hostElement.dispatchEvent({
    type: 'transitionend',
    target: childElement, // 触发源为子节点！
    currentTarget: hostElement,
    propertyName: 'opacity',
  });

  assert.equal(controller.status, 'exiting', '子节点冒泡事件必须被靶心断言拦截，外层状态严禁提前流转为 exited');
  assert.equal(exitedCalled, false);

  // 4. 宿主本身触发真正的 transitionend
  hostElement.dispatchEvent({
    type: 'transitionend',
    target: hostElement,
    currentTarget: hostElement,
    propertyName: 'opacity',
  });

  assert.equal(controller.status, 'exited');
  assert.equal(exitedCalled, true);

  controller.detach();
});
