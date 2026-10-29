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
      gatewayUrl: 'http://127.0.0.1:9119',
      gatewayType: 'dashboard',
      username: '',
      password: '',
      messages: [],
    });

    assert.ok(html.includes('id="onboarding-username"'), 'Onboarding must have username input');
    assert.ok(html.includes('id="onboarding-password"'), 'Onboarding must have password input');
    assert.ok(html.includes('id="btn-test-connection"'), 'Onboarding must have test button');
  });

  await t.test('InputDock must strictly conform to 740px golden width constraint', async () => {
    const { renderInputDock } = await import('../dist/components/InputDock/InputDock.js');
    const html = renderInputDock({
      selectedModel: 'deepseek-v4.1',
      models: ['deepseek-v4.1', 'claude-3-7'],
      reasoningLevel: 'high',
      approvalMode: 'auto',
      isStreaming: false,
    });

    assert.ok(html.includes('max-width: 740px'), 'InputDock must have max-width: 740px constraint');
    assert.ok(html.includes('id="dock-prompt-input"'), 'InputDock must have prompt input textarea');
    assert.ok(html.includes('id="dock-model-selector-btn"'), 'InputDock must have model selector button');
    assert.ok(html.includes('id="dock-send-btn"'), 'InputDock must have send action button');
  });

  await t.test('MiddlePod must span 100% full-bleed and provide incremental DOM hooks', async () => {
    const { renderMiddlePod } = await import('../dist/components/MiddlePod/MiddlePod.js');
    const html = renderMiddlePod({
      gatewayConnected: true,
      messages: [
        {
          id: 'ast-100',
          role: 'assistant',
          content: 'Hello, **Aura**!\n```ts\nconst a = 1;\n```',
          thought: 'Analyzing code...',
          timestamp: '12:00',
        },
      ],
    });

    assert.ok(html.includes('content-fluid-canvas'), 'MiddlePod must contain content-fluid-canvas');
    assert.ok(html.includes('width: 100%'), 'MiddlePod canvas must span 100% width');
    assert.ok(html.includes('id="msg-content-ast-100"'), 'Must have incremental content anchor');
    assert.ok(html.includes('id="msg-thought-ast-100"'), 'Must have incremental thought anchor');
    assert.ok(html.includes('code-block-wrapper'), 'Must render Markdown code blocks with wrapper');
  });

  await t.test('MiddlePod must render reasoning chain, tool capsules, GFM tables and task lists', async () => {
    const { renderMiddlePod } = await import('../dist/components/MiddlePod/MiddlePod.js');
    const html = renderMiddlePod({
      gatewayConnected: true,
      messages: [
        {
          id: 'ast-101',
          role: 'assistant',
          content: 'Here is table:\n| Name | Status |\n|---|---|\n| Core | Active |\n- [x] Done\n- [ ] Todo',
          thought: 'Deep reasoning in progress...',
          thoughtDurationMs: 450,
          timestamp: '12:01',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'shell',
              status: 'completed',
              args: '{"command":"npm test"}',
              output: 'Tests passed',
            },
            {
              id: 'tool-2',
              name: 'read_file',
              status: 'running',
              args: '{"path":"src/index.ts"}',
            },
          ],
        },
      ],
    });

    assert.ok(html.includes('🧠'), 'Must include reasoning brain icon');
    assert.ok(html.includes('深度推理链'), 'Must render reasoning title');
    assert.ok(html.includes('450ms'), 'Must render reasoning duration badge');
    assert.ok(html.includes('tool-capsule'), 'Must render tool capsules');
    assert.ok(html.includes('💻'), 'Must render shell icon for shell tool');
    assert.ok(html.includes('✓ DONE'), 'Must render completed badge');
    assert.ok(html.includes('● RUNNING'), 'Must render running badge');
    assert.ok(html.includes('<table'), 'Must render GFM HTML table');
    assert.ok(html.includes('Core'), 'Table must contain cell data');
  });

  await t.test('MiddlePod and renderMarkdown must handle edge cases without crash or corruption', async () => {
    const { renderMiddlePod, renderMarkdown } = await import('../dist/components/MiddlePod/MiddlePod.js');

    // 1. Tool args with nested object must not crash with TypeError
    const htmlWithNestedArgs = renderMiddlePod({
      gatewayConnected: true,
      messages: [
        {
          id: 'ast-102',
          role: 'assistant',
          content: 'test',
          timestamp: '12:02',
          toolCalls: [
            {
              id: 't-nested',
              name: 'shell',
              status: 'completed',
              args: JSON.stringify({ command: { complex: 'nested' } }),
            },
          ],
        },
      ],
    });
    assert.ok(htmlWithNestedArgs.includes('tool-capsule'), 'Nested object args must render safely');

    // 2. Code block with empty lines and special $& pattern
    const codeWithEmptyLinesAndSpecial = '```js\nconst x = "$&";\n\nconst y = 2;\n```';
    const renderedCode = renderMarkdown(codeWithEmptyLinesAndSpecial);
    assert.ok(!renderedCode.includes('</div><div'), 'Code block must not be severed by paragraph splits');
    assert.ok(renderedCode.includes('$&'), 'Special replacement token $& must be preserved faithfully');

    // 3. GFM table without trailing newline must keep all rows
    const tableNoTrailingNewline = '| Col1 | Col2 |\n|---|---|\n| ValA | ValB |';
    const renderedTable = renderMarkdown(tableNoTrailingNewline);
    assert.ok(renderedTable.includes('<table'), 'Table must be recognized even without trailing newline');
    assert.ok(renderedTable.includes('ValA'), 'Cell data ValA must be present');
    assert.ok(renderedTable.includes('ValB'), 'Cell data ValB must be present');
    assert.ok(!renderedTable.includes('<table<br/>'), 'Table must not be contaminated by foster-parented <br/>');
  });
});

