import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInspectionPod } from '../dist/components/InspectionPod/InspectionPod.js';
import { renderStatusBar } from '../dist/components/StatusBar/StatusBar.js';
import { renderSettingsModal } from '../dist/components/SettingsModal/SettingsModal.js';

test('UI Components Layout & Engineering Guardrails', async (t) => {
  await t.test('InspectionPod streamlined file previewer', () => {
    const html = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      previewFile: { path: 'src/main.ts', content: 'console.log("hello");' },
    });

    assert.ok(html.includes('src/main.ts'), 'Must display preview file path');
    assert.ok(html.includes('console.log') && html.includes('hello'), 'Must display preview file content with syntax highlight');
    assert.ok(html.includes('id="toggle-inspector-close-btn"'), 'Must have close/collapse button');
    // OpenChamber tabs & toolbar buttons assertions
    assert.ok(html.includes('inspector-tabs-bar'), 'Must render tabs bar');
    assert.ok(html.includes('inspector-action-toolbar'), 'Must render OpenChamber secondary action toolbar');
    assert.ok(html.includes('btn-file-toggle-mode'), 'Must have Raw/Render view mode toggle button');
    assert.ok(html.includes('btn-file-search'), 'Must have in-file search button');
    assert.ok(html.includes('btn-file-toggle-lineno'), 'Must have line number toggle button');
    assert.ok(html.includes('btn-file-open-external'), 'Must have open external button');
    assert.ok(html.includes('btn-file-copy-content'), 'Must have copy content button');
    assert.ok(html.includes('btn-file-copy-path'), 'Must have copy path button');
    assert.ok(html.includes('btn-file-download'), 'Must have download button');
  });

  await t.test('InspectionPod multi-tab and rich markdown rendering', () => {
    const html = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      openFiles: [
        { path: 'MiddlePod.ts', content: 'export const a = 1;' },
        { path: 'package.json', content: '{"name": "test"}' },
        { path: 'SKILL.md', content: '# Welcome to Skill\n\n- [x] Item 1' },
      ],
      activeFilePath: 'SKILL.md',
      viewMode: 'rendered',
    });

    assert.ok(html.includes('MiddlePod.ts'), 'Must list first tab');
    assert.ok(html.includes('package.json'), 'Must list second tab');
    assert.ok(html.includes('SKILL.md'), 'Must list third tab');
    assert.ok(html.includes('Welcome to Skill'), 'Must render markdown content');
    assert.ok(html.includes('inspector-rendered-markdown'), 'Must use markdown container when rendered mode');
  });

  await t.test('InspectionPod True Fullscreen must cover 100vw and 100vh completely without stream leak', () => {
    const htmlFullscreen = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      isFullscreen: true,
      openFiles: [{ path: 'test.ts', content: 'const x = 1;' }],
      activeFilePath: 'test.ts',
    });

    // Invariant: True Fullscreen must be fixed at top: 0, left: 0, bottom: 0, z-index >= 1000
    assert.ok(htmlFullscreen.includes('position: fixed'), 'Must use position: fixed for true fullscreen');
    assert.ok(htmlFullscreen.includes('top: 0'), 'Must align top: 0');
    assert.ok(htmlFullscreen.includes('z-index: 1000'), 'Must have top z-index: 1000 to cover titlebar & stream');
    assert.ok(htmlFullscreen.includes('inspector-fullscreen'), 'Must apply inspector-fullscreen class');

    const htmlNormal = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      isFullscreen: false,
      openFiles: [{ path: 'test.ts', content: 'const x = 1;' }],
      activeFilePath: 'test.ts',
    });
    // Invariant: Normal right rail must be bounded width, not taking fullscreen
    assert.ok(htmlNormal.includes('flex: 0 0 var(--rail-w-right, 420px)'), 'Default right rail must have bounded width');
    assert.ok(!htmlNormal.includes('position: fixed'), 'Normal mode must never be fixed overlay');
  });

  await t.test('InspectionPod auto-cleans CLI line prefix without duplicate line numbers', () => {
    const rawCliOutput = `
 10:   url: string;
 11:   timeoutMs?: number;
 12:   autoConnect?: boolean;
 13: };
    `.trim();

    const html = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      openFiles: [{ path: 'test.ts', content: rawCliOutput }],
      activeFilePath: 'test.ts',
      showLineNumbers: true,
    });

    // Code line should not still contain " 10: " or "10| " in the code cell, it should be mapped to the line-number gutter
    assert.ok(html.includes('<td class="line-number"'), 'Must render line number cell');
    assert.ok(!html.includes('10:&nbsp;url') && !html.includes('10: url'), 'Code cell must not duplicate embedded line number prefix');
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

  await t.test('StatusBar must not print a brand wordmark on the left', () => {
    const html = renderStatusBar({ connectionStatus: 'connected', latencyMs: 12 });

    assert.ok(!/HERMES\s+AURA/i.test(html), 'Left corner must not carry the legacy wordmark');
    assert.ok(html.includes('已连接'), 'Left corner shows the real connection state instead');
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
          content: 'Hello, **Flux**!\n```ts\nconst a = 1;\n```',
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

  await t.test('InputDock must be mounted strictly inside the middle pod conversation area', async () => {
    const { renderMiddlePod } = await import('../dist/components/MiddlePod/MiddlePod.js');
    const html = renderMiddlePod({
      gatewayConnected: true,
      messages: [],
      dockHtml: '<div class="input-dock-container" data-probe="dock"></div>',
    });
    const mainOpen = html.indexOf('class="flux-middle-pod');
    const dockAt = html.indexOf('data-probe="dock"');
    const mainClose = html.lastIndexOf('</main>');
    assert.ok(
      mainOpen >= 0 && mainOpen < dockAt && dockAt < mainClose,
      `InputDock must be physically mounted inside <main class="flux-middle-pod"> to ensure absolute centering`
    );
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

    assert.ok(html.includes('thinking-row'), 'Must include reasoning row');
    assert.ok(html.includes('推理'), 'Must render reasoning title');
    assert.ok(html.includes('tool-row'), 'Must render tool rows');
    assert.ok(html.includes('Shell Command'), 'Must render Shell Command title for shell tool');
    assert.ok(html.includes('<table'), 'Must render GFM HTML table');
    assert.ok(html.includes('Core'), 'Table must contain cell data');
  });

  await t.test('MiddlePod must aggregate multiple read-only tools', async () => {
    const { renderMiddlePod } = await import('../dist/components/MiddlePod/MiddlePod.js');
    const html = renderMiddlePod({
      gatewayConnected: true,
      messages: [
        {
          id: 'ast-103',
          role: 'assistant',
          content: 'Files inspected and modified.',
          timestamp: '12:03',
          toolCalls: [
            {
              id: 'tool-r1',
              name: 'read_file',
              status: 'completed',
              args: '{"path":"src/app.ts"}',
              output: 'const x = 1;',
            },
            {
              id: 'tool-r2',
              name: 'grep',
              status: 'completed',
              args: '{"pattern":"import"}',
              output: 'matches found',
            },
            {
              id: 'tool-e1',
              name: 'edit',
              status: 'completed',
              args: '{"path":"src/app.ts"}',
              output: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1,2 @@\n+const y = 2;',
            },
          ],
        },
      ],
    });

    assert.ok(html.includes('检索与阅读'), 'Must group consecutive read-only tools into an aggregated capsule');
    assert.ok(html.includes('app.ts'), 'Must display target file in tool capsule');
  });

  await t.test('MiddlePod tool categorization must never misclassify write tools or single read tools', async () => {
    const { renderMiddlePod } = await import('../dist/components/MiddlePod/MiddlePod.js');
    const html = renderMiddlePod({
      gatewayConnected: true,
      messages: [
        {
          id: 'ast-104',
          role: 'assistant',
          content: 'File written successfully',
          timestamp: '12:04',
          toolCalls: [
            {
              id: 'tool-w1',
              name: 'write_file',
              status: 'completed',
              args: '{"path":"dist/bundle.js","content":"console.log(1);"}'
            },
            {
              id: 'tool-r-single',
              name: 'read_file',
              status: 'completed',
              args: '{"path":"README.md"}'
            }
          ],
        },
      ],
    });

    assert.ok(html.includes('Write File'), 'write_file must be accurately classified as Write File');
    assert.ok(!html.includes('检索与阅读'), 'Single read-only tool followed by write must not trigger multi-item group');
    assert.ok(html.includes('Read File'), 'Single read_file must render as individual Read File capsule');
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

    // 4. TSV table and H4 headings (user reported scenario)
    const tsvContent = '二、 横向对比\n维度\tHermes Agent\tDeepSeek\n**核心定位**\t全能自治\t基准评测\n\n#### 1. 它适不适合？';
    const renderedTsv = renderMarkdown(tsvContent);
    assert.ok(renderedTsv.includes('<table'), 'TSV table must render as table');
    assert.ok(renderedTsv.includes('全能自治'), 'Cell text in TSV must be present');
    assert.ok(renderedTsv.includes('<h4'), 'H4 header must be compiled to h4 tag');
    assert.ok(renderedTsv.includes('它适不适合？'), 'H4 header text must be compiled');
  });
});

