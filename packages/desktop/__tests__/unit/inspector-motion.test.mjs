import test from 'node:test';
import assert from 'node:assert/strict';
import { attachMotionController } from '../../../../packages/ui/dist/motion/controller.js';

test('InspectionPod 动效控制器集成测试：展开入场、退场保活与 onExited 安全收敛', async (t) => {
  await t.test('1. 展开进入生命周期：正确进入 entering 并流转为 entered', async () => {
    const classList = new Set(['inspector-collapsed']);
    const style = { display: 'none', width: '0px' };
    const attributes = new Map();
    const listeners = new Map();

    const mockInspectEl = {
      classList: {
        add: (cls) => classList.add(cls),
        remove: (cls) => classList.delete(cls),
        contains: (cls) => classList.has(cls),
      },
      style,
      getAttribute: (k) => attributes.get(k) || null,
      setAttribute: (k, v) => attributes.set(k, String(v)),
      removeAttribute: (k) => attributes.delete(k),
      addEventListener: (evt, fn) => {
        if (!listeners.has(evt)) listeners.set(evt, []);
        listeners.get(evt).push(fn);
      },
      removeEventListener: (evt, fn) => {
        const list = listeners.get(evt) || [];
        listeners.set(evt, list.filter((l) => l !== fn));
      },
      dispatchEvent: (ev) => {
        const list = listeners.get(ev.type) || [];
        for (const fn of list) fn(ev);
      },
    };

    let exitedCalled = false;
    let enteredCalled = false;

    const controller = attachMotionController(mockInspectEl, {
      triggerProperty: 'width',
      onEntered: () => { enteredCalled = true; },
      onExited: () => {
        mockInspectEl.style.display = 'none';
        mockInspectEl.classList.add('inspector-collapsed');
        exitedCalled = true;
      },
    });

    // 展开流程：首帧 display: flex，移除折叠类，触发 enter
    mockInspectEl.style.display = 'flex';
    mockInspectEl.classList.remove('inspector-collapsed');
    await controller.enter();

    assert.equal(controller.status, 'entering');
    assert.equal(attributes.get('data-motion-state'), 'entering');
    assert.equal(attributes.has('inert'), false);

    // 完成过渡
    mockInspectEl.dispatchEvent({
      type: 'transitionend',
      target: mockInspectEl,
      currentTarget: mockInspectEl,
      propertyName: 'width',
    });

    assert.equal(controller.status, 'entered');
    assert.equal(enteredCalled, true);
    assert.equal(exitedCalled, false);

    // 2. 退场收敛生命周期：必须触发 onExited 并设置 display: none 与 inspector-collapsed
    await controller.exit();
    assert.equal(controller.status, 'exiting');
    assert.equal(attributes.get('data-motion-state'), 'exiting');
    assert.equal(attributes.has('inert'), true, '退场时必须注入 inert 阻断焦点');

    // 触发退场完成
    mockInspectEl.dispatchEvent({
      type: 'transitionend',
      target: mockInspectEl,
      currentTarget: mockInspectEl,
      propertyName: 'width',
    });

    assert.equal(controller.status, 'exited');
    assert.equal(exitedCalled, true, '退场必须确定性调用 onExited 回调');
    assert.equal(mockInspectEl.style.display, 'none', '退场终态必须将 display 置为 none');
    assert.equal(mockInspectEl.classList.contains('inspector-collapsed'), true, '退场终态必须保持 inspector-collapsed 类');

    controller.detach();
  });

  await t.test('3. 实例替换防泄漏测试：detach 彻底清理监听器与定时器', async () => {
    const listeners = new Map();
    const mockEl = {
      getAttribute: () => null,
      setAttribute: () => {},
      removeAttribute: () => {},
      addEventListener: (evt, fn) => {
        if (!listeners.has(evt)) listeners.set(evt, []);
        listeners.get(evt).push(fn);
      },
      removeEventListener: (evt, fn) => {
        const list = listeners.get(evt) || [];
        listeners.set(evt, list.filter((l) => l !== fn));
      },
    };

    const c1 = attachMotionController(mockEl, { triggerProperty: 'width' });
    assert.equal((listeners.get('transitionend') || []).length, 1);

    c1.detach();
    assert.equal((listeners.get('transitionend') || []).length, 0, 'detach 后必须完全卸载事件监听器');
  });
});
