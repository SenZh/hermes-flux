/**
 * 入职向导与快速设置控制器纯单测 (Onboarding Controller Unit Test)
 * (packages/desktop/__tests__/unit/onboardingController.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnboardingController } from '../../dist/renderer/events/onboardingController.mjs';

function createMockDeps(overrides = {}) {
  let renderCount = 0;
  let connectCount = 0;
  const approvals = [];

  const state = {
    gatewayUrl: '',
    username: '',
    password: '',
    profileName: '',
    testStatus: null,
    ...(overrides.state || {}),
  };

  const deps = {
    getState: () => state,
    render: () => {
      renderCount += 1;
    },
    connect: () => {
      connectCount += 1;
    },
    testConnection: async (url, user, pass) => ({ ok: true, latency: 15 }),
    switchApproval: async (mode) => {
      approvals.push(mode);
    },
    getDesktopApi: () => undefined,
    t: (key) => key,
  };

  return {
    deps,
    state,
    getRenderCount: () => renderCount,
    getConnectCount: () => connectCount,
    approvals,
  };
}

test('OnboardingController: 工厂函数实例化', () => {
  const { deps } = createMockDeps();
  const controller = createOnboardingController(deps);
  assert.ok(typeof controller.bindDomEvents === 'function');
});
