import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInspectionPod } from '../dist/components/InspectionPod/InspectionPod.js';
import { renderStatusBar } from '../dist/components/StatusBar/StatusBar.js';
import { renderSettingsModal } from '../dist/components/SettingsModal/SettingsModal.js';

test('UI Components Layout & Engineering Guardrails', async (t) => {
  await t.test('InspectionPod vertical rail must dock to the far right', () => {
    const html = renderInspectionPod({
      collapsed: false,
      activeTab: 'artifacts',
      gatewayConnected: true,
      artifacts: [{ id: '1', name: 'report.pdf', type: 'PDF', size: '12KB' }],
    });

    // 1. Verify child elements order: Left content pane first, vertical rail last
    const detailIdx = html.indexOf('inspector-detail-area');
    const railIdx = html.indexOf('inspector-vertical-rail');
    assert.ok(detailIdx !== -1, 'Must contain inspector-detail-area');
    assert.ok(railIdx !== -1, 'Must contain inspector-vertical-rail');
    assert.ok(
      detailIdx < railIdx,
      'inspector-detail-area MUST be on the left of inspector-vertical-rail'
    );

    // 2. Indicator border-radius for right docking
    assert.ok(
      html.includes('border-radius: 3px 0 0 3px'),
      'Tab active indicator must be right-anchored (border-radius: 3px 0 0 3px)'
    );

    // 3. Physically no inline close button
    assert.ok(
      !html.includes('id="btnInspectorCloseInline"') && !html.includes('class="btnInspectorCloseInline"'),
      'Must NOT contain btnInspectorCloseInline button element'
    );
  });

  await t.test('StatusBar must be extremely clean without HTTP2 or fake session ID', () => {
    const html = renderStatusBar({
      connectionStatus: 'connected',
      latencyMs: 18,
    });

    assert.ok(!html.includes('HTTP2'), 'Must NOT contain HTTP2');
    assert.ok(!html.includes('HTTP/2'), 'Must NOT contain HTTP/2');
    assert.ok(!html.includes('HTTP/3'), 'Must NOT contain HTTP/3');
    assert.ok(!html.includes('#AURA-LIVE'), 'Must NOT contain fake session ID');
    assert.ok(!html.includes('status-group-right'), 'Must NOT contain status-group-right');
    assert.ok(html.includes('18ms'), 'Must show real latencyMs');
  });

  await t.test('MiddlePod Onboarding must provide Username & Password fields for Dashboard', async () => {
    const { renderMiddlePod } = await import('../dist/components/MiddlePod/MiddlePod.js');
    const html = renderMiddlePod({
      gatewayConnected: false,
      gatewayUrl: 'https://fn-ai.codepower.cloud:1519',
      gatewayType: 'dashboard',
      username: '',
      password: '',
      messages: [],
    });

    assert.ok(html.includes('id="onboarding-username"'), 'Onboarding must have username input');
    assert.ok(html.includes('id="onboarding-password"'), 'Onboarding must have password input');
    assert.ok(html.includes('id="btn-test-connection"'), 'Onboarding must have test button');
  });
});
