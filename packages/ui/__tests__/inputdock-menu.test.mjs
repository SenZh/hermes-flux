import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInputDock } from '../dist/components/InputDock/InputDock.js';
import { renderLeftRail } from '../dist/components/LeftRail/LeftRail.js';

function dockHtml(overrides = {}) {
  return renderInputDock({
    selectedModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'claude-opus-4-6'],
    reasoningLevel: 'high',
    approvalMode: 'auto',
    isStreaming: false,
    ...overrides,
  });
}

/** Extracts one element's opening tag so its inline style can be inspected. */
function openingTag(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start === -1) return '';
  const end = html.indexOf('>', start);
  return html.slice(start, end);
}

test('InputDock - model menu visibility is driven by application state', async (t) => {
  await t.test('an open menu renders display: block', () => {
    // 1. Arrange & 2. Act
    const html = dockHtml({ modelMenuOpen: true });

    // 3. Assert: the shell re-renders the whole tree, so the open state must survive
    // a render pass instead of being toggled on the DOM node.
    assert.match(
      openingTag(html, 'dock-model-dropdown'),
      /display:\s*block/,
      'modelMenuOpen=true must render the menu expanded'
    );
  });

  await t.test('a closed menu renders display: none', () => {
    // 1. Arrange & 2. Act
    const html = dockHtml({ modelMenuOpen: false });

    // 3. Assert
    assert.match(
      openingTag(html, 'dock-model-dropdown'),
      /display:\s*none/,
      'modelMenuOpen=false must render the menu collapsed'
    );
  });

  await t.test('omitting the flag keeps the menu closed (backwards compatible default)', () => {
    // 1. Arrange & 2. Act
    const html = dockHtml();

    // 3. Assert
    assert.match(openingTag(html, 'dock-model-dropdown'), /display:\s*none/);
  });

  await t.test('every model in the list is clickable and carries its id', () => {
    // 1. Arrange
    const html = dockHtml({ modelMenuOpen: true });

    // 2. Act
    const optionCount = (html.match(/class="model-option/g) || []).length;

    // 3. Assert
    assert.equal(optionCount, 2, 'Both models must be rendered as options');
    assert.ok(html.includes('data-model="gemini-3.8-flash"'), 'Option must expose the model id');
    assert.ok(html.includes('data-model="claude-opus-4-6"'), 'Option must expose the model id');
  });
});

test('InputDock - failures are never silent', async (t) => {
  await t.test('a notice renders as a visible alert line', () => {
    // 1. Arrange
    const message = '切换模型失败: [5001] 该模型由多个 provider 声明';

    // 2. Act
    const html = dockHtml({ notice: message });

    // 3. Assert
    assert.ok(html.includes('id="dock-notice"'), 'Notice must be rendered inside the dock');
    assert.ok(html.includes('该模型由多个 provider 声明'), 'The gateway reason must reach the user');
    assert.ok(html.includes('role="status"'), 'Notice must be announced to assistive tech');
  });

  await t.test('no notice means no empty alert shell', () => {
    // 1. Arrange & 2. Act
    const html = dockHtml({ notice: '' });

    // 3. Assert
    assert.ok(!html.includes('id="dock-notice"'), 'An empty notice must not render a box');
  });

  await t.test('notice text is HTML-escaped', () => {
    // 1. Arrange & 2. Act
    const html = dockHtml({ notice: '<img src=x onerror=alert(1)>' });

    // 3. Assert
    assert.ok(!html.includes('<img src=x'), 'Notice must be escaped');
    assert.ok(html.includes('&lt;img src=x'), 'Escaped notice must still be readable');
  });
});

test('LeftRail - an empty rail is not the same as a failed rail', async (t) => {
  const base = {
    collapsed: false,
    activeSessionId: '',
    profileName: 'default',
    gatewayOnline: true,
    gatewayLatencyMs: 12,
  };

  await t.test('a load failure renders its reason', () => {
    // 1. Arrange
    const props = { ...base, sessions: [], error: 'WebSocket 未连接 (当前状态: RECONNECTING)' };

    // 2. Act
    const html = renderLeftRail(props);

    // 3. Assert
    assert.ok(html.includes('id="session-list-error"'), 'Rail must surface the failure');
    assert.ok(html.includes('当前状态: RECONNECTING'), 'The concrete reason must be visible');
    assert.ok(!html.includes('暂无历史会话'), 'A failure must not be presented as "no sessions"');
  });

  await t.test('a genuinely empty list still shows the empty state', () => {
    // 1. Arrange
    const props = { ...base, sessions: [], error: '' };

    // 2. Act
    const html = renderLeftRail(props);

    // 3. Assert
    assert.ok(!html.includes('id="session-list-error"'), 'No error block without a failure');
    assert.ok(html.includes('暂无历史会话'), 'Empty state stays informative');
  });

  await t.test('sessions render newest-first as given, with the active one marked', () => {
    // 1. Arrange
    const props = {
      ...base,
      activeSessionId: 's-new',
      sessions: [
        { id: 's-new', title: '新任务', model: '', time: '10:31' },
        { id: 's-old', title: '旧会话', model: '', time: '09:02' },
      ],
    };

    // 2. Act
    const html = renderLeftRail(props);

    // 3. Assert
    assert.ok(html.indexOf('data-id="s-new"') < html.indexOf('data-id="s-old"'), 'Newest session must lead');
    assert.ok(html.includes('class="session-item active" data-id="s-new"'), 'Active session must be highlighted');
    assert.ok(html.includes('近期任务 (2)'), 'Header must count the real sessions');
  });
});
