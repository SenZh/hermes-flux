import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInspectionPod } from '../dist/components/InspectionPod/InspectionPod.js';
import { renderStatusBar } from '../dist/components/StatusBar/StatusBar.js';
import { renderSettingsModal } from '../dist/components/SettingsModal/SettingsModal.js';
import { renderMessages } from './helpers/renderMessages.mjs';

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

  await t.test('InspectionPod True Fullscreen must cover conversation body completely while preserving Titlebar', () => {
    const htmlFullscreen = renderInspectionPod({
      collapsed: false,
      gatewayConnected: true,
      isFullscreen: true,
      openFiles: [{ path: 'test.ts', content: 'const x = 1;' }],
      activeFilePath: 'test.ts',
    });

    // Invariant: Fullscreen inside flux-body-container must be absolute top:0 left:0 right:0 bottom:0 width:100% height:100%
    assert.ok(htmlFullscreen.includes('position: absolute'), 'Must use position: absolute for body container fullscreen');
    assert.ok(htmlFullscreen.includes('top: 0'), 'Must align top: 0');
    assert.ok(htmlFullscreen.includes('width: 100%'), 'Must span 100% width');
    assert.ok(htmlFullscreen.includes('height: 100%'), 'Must span 100% height');
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
    assert.ok(htmlNormal.includes('class="flux-inspector-pod "'), 'Normal mode must not have inspector-fullscreen class');
    // Invariant: Far-right vertical scene rail must be present
    assert.ok(htmlNormal.includes('inspector-vertical-rail'), 'Must have far-right vertical scene rail');
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
    
    // Invariant: Code cells must allow text selection for mouse copying, while line-numbers remain unselectable
    assert.ok(html.includes('class="line-code" style="') && html.includes('user-select: text;'), 'Code cells must allow text selection for copy');
    assert.ok(html.includes('class="line-number" style="') && html.includes('user-select: none;'), 'Line numbers must be unselectable so line numbers are not copied into clipboard');
    assert.ok(!html.includes('id="flux-inspector-pod" class="flux-inspector-pod " style="\n      flex: 0 0 var(--rail-w-right, 420px);\n      width: var(--rail-w-right, 420px);\n      min-width: 280px;\n      height: 100%;\n      background: var(--bg-panel);\n      border-left: 1px solid var(--border-subtle);\n      display: flex;\n      flex-direction: row;\n      user-select: none;'), 'InspectionPod container must NOT lock out user selection');
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

  await t.test('Canvas must be full-bleed and messages must expose incremental DOM hooks', async () => {
    const { renderMiddlePod } = await import('../dist/components/MiddlePod/MiddlePod.js');
    const canvasHtml = renderMiddlePod({ gatewayConnected: true, messages: [] });
    assert.ok(canvasHtml.includes('content-fluid-canvas'), 'MiddlePod must contain content-fluid-canvas');
    assert.ok(canvasHtml.includes('conv-canvas'), 'Canvas must carry conv-canvas structural class');
    assert.ok(canvasHtml.includes('data-conv-layer="canvas"'), 'Canvas must expose data-conv-layer for geometry assertions');

    const html = renderMessages([
      { id: 'ast-100', role: 'assistant', content: 'Hello, **Flux**!', thought: 'Analyzing code...', timestamp: '12:00' },
    ]);
    assert.ok(html.includes('id="msg-content-ast-100"'), 'Must have incremental content anchor');
    assert.ok(html.includes('id="msg-thought-ast-100"'), 'Must have incremental thought anchor');
  });

  await t.test('Markdown code blocks must render md-codeblock wrapper with language label', async () => {
    const { renderMarkdown } = await import('../dist/components/MiddlePod/MiddlePod.js');
    const html = renderMarkdown('```ts\nconst a = 1;\n```');
    assert.ok(html.includes('md-codeblock'), 'Must render Markdown code blocks with md-codeblock wrapper');
    assert.ok(html.includes('md-codeblock__lang">ts<'), 'Code block must carry its language label');
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

  await t.test('Conversation must render reasoning chain, tool capsules and GFM tables', async () => {
    const html = renderMessages([
      {
        id: 'ast-101',
        role: 'assistant',
        content: 'Here is table:\n| Name | Status |\n|---|---|\n| Core | Active |',
        thought: 'Deep reasoning in progress...',
        thoughtDurationMs: 450,
        timestamp: '12:01',
        toolCalls: [
          { id: 'tool-1', name: 'shell', status: 'completed', args: '{"command":"npm test"}', output: 'Tests passed' },
          { id: 'tool-2', name: 'read_file', status: 'running', args: '{"path":"src/index.ts"}' },
        ],
      },
    ]);

    assert.ok(html.includes('data-kind="thought"'), 'Must include reasoning row');
    assert.ok(html.includes('思考'), 'Must render reasoning title');
    assert.ok(html.includes('conv-row'), 'Must render tool rows');
    assert.ok(html.includes('Shell Command'), 'Must render Shell Command title for shell tool');
    assert.ok(html.includes('<table'), 'Must render GFM HTML table');
    assert.ok(html.includes('Core'), 'Table must contain cell data');
  });

  await t.test('Conversation must aggregate multiple read-only tools', async () => {
    const html = renderMessages([
      {
        id: 'ast-103',
        role: 'assistant',
        content: 'Files inspected and modified.',
        timestamp: '12:03',
        toolCalls: [
          { id: 'tool-r1', name: 'read_file', status: 'completed', args: '{"path":"src/app.ts"}', output: 'const x = 1;' },
          { id: 'tool-r2', name: 'read_file', status: 'completed', args: '{"path":"src/config.ts"}', output: 'export const cfg = {};' },
          { id: 'tool-e1', name: 'edit', status: 'completed', args: '{"path":"src/app.ts"}', output: '--- a\n+++ b\n@@ -1 +1,2 @@\n+const y = 2;' },
        ],
      },
    ]);

    assert.ok(html.includes('Read 2 files'), 'Must group consecutive read-only tools into an aggregated capsule');
    assert.ok(html.includes('app.ts'), 'Must display target file in tool capsule');
  });

  await t.test('Search Files must NOT be treated as readable file preview tool', async () => {
    const html = renderMessages([
      {
        id: 'ast-grep-test',
        role: 'assistant',
        content: 'Searching codebase for pattern',
        timestamp: '12:05',
        toolCalls: [
          {
            id: 'tool-grep-1',
            name: 'grep',
            status: 'completed',
            args: '{"pattern":"StatusBar","include":"*.ts"}',
            output: 'src/components/StatusBar.ts:10: export class StatusBar',
          },
        ],
      },
    ]);

    assert.ok(html.includes('Search Files'), 'Must be titled Search Files');
    assert.ok(!html.includes('data-preview-file="StatusBar"'), 'Search pattern must NOT become a preview file link');
    assert.ok(!html.includes('data-preview-file="*.ts"'), 'Search include must NOT become a preview file link');
    assert.ok(html.includes('StatusBar.ts:10'), 'Search output lines must be present in output container');
  });

  await t.test('Tool categorization must never misclassify write tools or single read tools', async () => {
    const html = renderMessages([
      {
        id: 'ast-104',
        role: 'assistant',
        content: 'File written successfully',
        timestamp: '12:04',
        toolCalls: [
          { id: 'tool-w1', name: 'write_file', status: 'completed', args: '{"path":"dist/bundle.js","content":"console.log(1);"}' },
          { id: 'tool-r-single', name: 'read_file', status: 'completed', args: '{"path":"README.md"}' },
        ],
      },
    ]);

    assert.ok(html.includes('Write File'), 'write_file must be accurately classified as Write File');
    assert.ok(!html.includes('Read 2 files'), 'Single read-only tool followed by write must not trigger multi-item group');
    assert.ok(html.includes('Read File'), 'Single read_file must render as individual Read File capsule');
  });

  await t.test('MiddlePod and renderMarkdown must handle edge cases without crash or corruption', async () => {
    const { renderMiddlePod, renderMarkdown } = await import('../dist/components/MiddlePod/MiddlePod.js');

    // 1. Tool args with nested object must not crash with TypeError
    const htmlWithNestedArgs = renderMessages([
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
    ]);
    assert.ok(htmlWithNestedArgs.includes('conv-row'), 'Nested object args must render safely');

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

    // 5. Giant plain log output (>25KB or logcat format) must bypass expensive regex syntax highlighting
    const giantLogText = '```logcat\n' + '10-30 16:00:01.123 1234 5678 D AndroidRuntime: Shutting down VM\n'.repeat(500) + '```';
    const startTime = performance.now();
    const renderedLog = renderMarkdown(giantLogText);
    const durationMs = performance.now() - startTime;
    assert.ok(durationMs < 50, `Giant log parsing must complete rapidly without regex backtracking, took ${durationMs}ms`);
    assert.ok(renderedLog.includes('AndroidRuntime'), 'Logcat content must be accurately preserved');
  });

  await t.test('renderMarkdown must turn file paths and HTTP links into interactive inspection capsules', async () => {
    const { renderMarkdown, isLikelyFilePath, isLikelyHttpUrl } = await import('../dist/components/MiddlePod/MiddlePod.js');

    // 1. Precise predicate verification
    assert.equal(isLikelyFilePath('/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-workspace.html'), true, 'Unix path with html extension must be a file path');
    assert.equal(isLikelyFilePath('/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-preview-chat-v2.png'), true, 'Unix path with png extension must be a file path');
    assert.equal(isLikelyFilePath('C:\\Users\\workspace\\project\\index.ts'), true, 'Windows path must be a file path');
    assert.equal(isLikelyFilePath('./src/components/Header.tsx'), true, 'Relative path must be a file path');
    assert.equal(isLikelyFilePath('const totalCount = 42;'), false, 'Plain JS statement must NOT be a file path');
    assert.equal(isLikelyFilePath('-rf'), false, 'Command flags must NOT be a file path');

    assert.equal(isLikelyHttpUrl('https://example.com/api/test.png'), true, 'HTTPS url must be recognized');
    assert.equal(isLikelyHttpUrl('http://127.0.0.1:9119'), true, 'HTTP url must be recognized');
    assert.equal(isLikelyHttpUrl('not a url'), false, 'Non-url must not be recognized');

    // 2. User exact screenshot scenario verification
    const userMessageSample = `
针对这套设计，已为您生成了高保真原型与渲染截图：
- 源码文件: \`/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-workspace.html\`
- 渲染截图 (群聊协同态): \`/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-preview-chat-v2.png\`
- 渲染截图 (看板交付态): \`/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-preview-kanban.png\`
`;
    const rendered = renderMarkdown(userMessageSample);

    assert.ok(rendered.includes('class="tool-file-link content-interactive-link"'), 'File path inline code must be augmented with interactive classes');
    assert.ok(rendered.includes('data-preview-file="/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-workspace.html"'), 'HTML prototype path must be bound to data-preview-file');
    assert.ok(rendered.includes('data-preview-file="/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-preview-chat-v2.png"'), 'PNG preview path must be bound to data-preview-file');
    assert.ok(rendered.includes('cursor: pointer'), 'Interactive file capsule must have pointer cursor');
    assert.ok(rendered.includes('title='), 'Interactive file capsule must have descriptive title for accessibility');

    // 3. Markdown standard link verification
    const mdLinkSample = '查看 [高保真原型文件](/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-workspace.html) 与 [在线文档](https://example.com/docs)';
    const renderedMdLink = renderMarkdown(mdLinkSample);
    assert.ok(renderedMdLink.includes('data-preview-file="/opt/data/projects/hermes-flux/docs/prototypes/desktop-v4-workspace.html"'), 'Markdown file link must have data-preview-file');
    assert.ok(renderedMdLink.includes('data-preview-url="https://example.com/docs"'), 'Markdown http link must have data-preview-url');

    // 4. Negative mutation check: plain variable names and simple code must NOT be turned into tool-file-link
    const plainCode = '变量名是 `userProfileState`，方法是 `calculateTax()`';
    const renderedPlain = renderMarkdown(plainCode);
    assert.ok(!renderedPlain.includes('data-preview-file="userProfileState"'), 'Plain variable must not have data-preview-file');
    assert.ok(!renderedPlain.includes('tool-file-link'), 'Plain variable code must not have tool-file-link class');
  });

  await t.test('renderSettingsModal appearance tab renders correctly without comment leaks', () => {
    const htmlOpen = renderSettingsModal({
      isOpen: true,
      activeTab: 'appearance',
      gatewayUrl: 'ws://127.0.0.1:9119',
      profileName: 'default',
      theme: 'jade-white',
      lang: 'zh',
      connectionStatus: 'connected',
      latencyMs: 12,
    });

    assert.ok(htmlOpen.includes('data-theme="obsidian-gold"'), 'Must render obsidian-gold button');
    assert.ok(htmlOpen.includes('data-theme="ayu-light"'), 'Must render ayu-light button');
    assert.ok(htmlOpen.includes('data-theme="jade-white"'), 'Must render jade-white button');
    assert.ok(htmlOpen.includes('data-theme="cyber-matrix"'), 'Must render cyber-matrix button');
    assert.ok(htmlOpen.includes('theme-preview-card-dark'), 'Must use theme-preview-card-dark class');
    assert.ok(htmlOpen.includes('theme-preview-card-ayu'), 'Must use theme-preview-card-ayu class');
    assert.ok(htmlOpen.includes('theme-preview-card-light'), 'Must use theme-preview-card-light class');
    assert.ok(htmlOpen.includes('theme-preview-card-cyber'), 'Must use theme-preview-card-cyber class');
    assert.ok(htmlOpen.includes('theme-preview-title'), 'Must use theme-preview-title class');
    assert.ok(htmlOpen.includes('theme-preview-sub'), 'Must use theme-preview-sub class');
    // Invariant: No gate comments must ever leak into the rendered HTML output
    assert.ok(!htmlOpen.includes('gate-theme-allow'), 'HTML output must NOT contain gate-theme-allow comment text');
    assert.ok(!htmlOpen.includes('/*'), 'HTML output must NOT contain raw CSS comment markers');

    const htmlClosed = renderSettingsModal({
      isOpen: false,
      activeTab: 'appearance',
      gatewayUrl: 'ws://127.0.0.1:9119',
      profileName: 'default',
      theme: 'jade-white',
      lang: 'zh',
      connectionStatus: 'connected',
      latencyMs: 12,
    });
    assert.ok(htmlClosed.includes('display: none'), 'Closed modal must render hidden shell');
  });

  await t.test('renderSettingsModal active theme selection must be mutually exclusive and accurate', () => {
    // 1. ayu-light active
    const htmlAyu = renderSettingsModal({
      isOpen: true,
      activeTab: 'appearance',
      gatewayUrl: 'ws://127.0.0.1:9119',
      profileName: 'default',
      theme: 'ayu-light',
      lang: 'zh',
      connectionStatus: 'connected',
      latencyMs: 12,
    });
    assert.ok(htmlAyu.includes('theme-preview-card-ayu active'), 'ayu-light must be marked active');
    assert.ok(!htmlAyu.includes('theme-preview-card-dark active'), 'obsidian-gold must NOT be active when ayu-light is selected');
    assert.ok(!htmlAyu.includes('theme-preview-card-light active'), 'jade-white must NOT be active when ayu-light is selected');
    assert.ok(!htmlAyu.includes('theme-preview-card-cyber active'), 'cyber-matrix must NOT be active when ayu-light is selected');

    // 2. obsidian-gold active
    const htmlDark = renderSettingsModal({
      isOpen: true,
      activeTab: 'appearance',
      gatewayUrl: 'ws://127.0.0.1:9119',
      profileName: 'default',
      theme: 'obsidian-gold',
      lang: 'zh',
      connectionStatus: 'connected',
      latencyMs: 12,
    });
    assert.ok(htmlDark.includes('theme-preview-card-dark active'), 'obsidian-gold must be marked active');
    assert.ok(!htmlDark.includes('theme-preview-card-ayu active'), 'ayu-light must NOT be active');

    // 3. cyber-matrix active
    const htmlCyber = renderSettingsModal({
      isOpen: true,
      activeTab: 'appearance',
      gatewayUrl: 'ws://127.0.0.1:9119',
      profileName: 'default',
      theme: 'cyber-matrix',
      lang: 'zh',
      connectionStatus: 'connected',
      latencyMs: 12,
    });
    assert.ok(htmlCyber.includes('theme-preview-card-cyber active'), 'cyber-matrix must be marked active');
    assert.ok(!htmlCyber.includes('theme-preview-card-ayu active'), 'ayu-light must NOT be active');
  });

  await t.test('highlightCodeSyntax must accurately highlight JSX tags, attributes, and block comments', async () => {
    const { highlightCodeSyntax } = await import('../dist/components/MiddlePod/MiddlePod.js');

    const sample = '<article className="flex flex-col gap-4">\n  <header ...>{header}</header>\n  {children} {/* body + comments */}\n</article>';
    const highlighted = highlightCodeSyntax(sample);

    // 1. Tags
    assert.ok(highlighted.includes('--hl-keyword'), 'JSX tags like <article and <header must be highlighted with var(--hl-keyword)');
    assert.ok(highlighted.includes('&lt;article'), 'Tags must be properly escaped');
    assert.ok(highlighted.includes('&lt;/article'), 'Closing tags must be properly escaped');

    // 2. Attributes
    assert.ok(highlighted.includes('className'), 'Attributes must be present');
    assert.ok(highlighted.includes('--hl-number'), 'JSX attribute names must be highlighted with attribute token');

    // 3. Strings
    assert.ok(highlighted.includes('--hl-string'), 'String literals must be highlighted with var(--hl-string)');
    assert.ok(highlighted.includes('&quot;flex flex-col gap-4&quot;'), 'String literals must be HTML escaped');

    // 4. JSX Comments
    assert.ok(highlighted.includes('--hl-comment'), 'JSX block comments {/* ... */} must be highlighted with var(--hl-comment)');
    assert.ok(highlighted.includes('font-style: italic'), 'Comments must have italic styling');
  });

  await t.test('Ayu Light CSS styles must strictly enforce neutral dock border and sunken surface layers', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    const stylesPath = path.resolve(__dirname, '../../desktop/src/renderer/styles.css');
    assert.ok(fs.existsSync(stylesPath), 'styles.css must physically exist');
    const cssContent = fs.readFileSync(stylesPath, 'utf8');

    // 1. Invariant: Conversation stream in ayu-light must use var(--bg-window) rather than pure white
    assert.ok(
      cssContent.includes('[data-theme="ayu-light"] #conversation-stream'),
      'Must define ayu-light conversation-stream selector'
    );
    assert.ok(
      cssContent.includes('background: var(--bg-window) !important'),
      'Conversation stream must use var(--bg-window) instead of hardcoded white'
    );

    // 2. Invariant: Left rail in ayu-light must use var(--bg-rail)
    assert.ok(
      cssContent.includes('[data-theme="ayu-light"] #flux-left-rail'),
      'Must define ayu-left-rail selector'
    );

    // 3. Invariant: Composer dock in ayu-light MUST NOT use accent border
    const dockMatch = cssContent.match(/\[data-theme="ayu-light"\]\s+\.composer-dock\s*\{([\s\S]*?)\}/);
    assert.ok(dockMatch, 'Must define [data-theme="ayu-light"] .composer-dock');
    const dockBlock = dockMatch[1];
    assert.ok(dockBlock.includes('var(--border-medium)'), 'Composer dock must use var(--border-medium)');
    assert.ok(!dockBlock.includes('var(--accent)'), 'Composer dock container must NOT use accent border');

    // 4. Invariant: Composer dock focus-within in ayu-light MUST NOT use accent border
    const focusMatch = cssContent.match(/\[data-theme="ayu-light"\]\s+\.composer-dock:focus-within\s*\{([\s\S]*?)\}/);
    assert.ok(focusMatch, 'Must define [data-theme="ayu-light"] .composer-dock:focus-within');
    const focusBlock = focusMatch[1];
    assert.ok(focusBlock.includes('border-color: var(--border-strong)'), 'Composer dock focus must use var(--border-strong)');
    assert.ok(!focusBlock.includes('var(--accent-border)'), 'Composer dock focus must NOT use accent-border');
    assert.ok(!focusBlock.includes('var(--accent)'), 'Composer dock focus must NOT use accent');
  });

  await t.test('User bubble must consume --chat-user-message-bg token', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const testDir = dirname(fileURLToPath(import.meta.url));
    const convCss = readFileSync(join(testDir, '../src/styles/conversation.css'), 'utf8');
    assert.ok(
      /\.conv-message__bubble[\s\S]*?var\(--chat-user-message-bg/.test(convCss),
      'User bubble must support chat-user-message-bg token in CSS'
    );
  });

  await t.test('getToggleTheme must deterministically transition between dark and primary light theme', async () => {
    const { getToggleTheme } = await import('../dist/tokens/skins.js');

    // All light themes must transition to obsidian-gold
    assert.equal(getToggleTheme('ayu-light'), 'obsidian-gold');
    assert.equal(getToggleTheme('warm-paper'), 'obsidian-gold');
    assert.equal(getToggleTheme('jade-white'), 'obsidian-gold');
    assert.equal(getToggleTheme('suet-jade'), 'obsidian-gold');

    // Dark themes must transition to ayu-light
    assert.equal(getToggleTheme('obsidian-gold'), 'ayu-light');
    assert.equal(getToggleTheme('cyber-matrix'), 'ayu-light');
  });

  await t.test('Gate 4e: long session performance benchmark (5000 synthetic messages)', async () => {
    // 【设计意图 (Why)】基准必须在 production React 下测量，而本测试进程里 React 已被
    //   其它用例以 dev 构建加载，无法再切换。改为独立子进程运行，保证测的是发布构建。
    const { spawnSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const testDir = dirname(fileURLToPath(import.meta.url));
    const script = join(testDir, '../../../scripts/gates/perf-benchmark.mjs');
    const run = spawnSync(process.execPath, [script], {
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
    });
    assert.equal(
      run.status,
      0,
      `5000 messages performance budget benchmark must pass completely\n${run.stdout || ''}\n${run.stderr || ''}`
    );
  });
});

