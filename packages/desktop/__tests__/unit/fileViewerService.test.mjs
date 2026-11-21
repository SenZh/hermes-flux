/**
 * 多标签文件查看器与工件工具栏服务纯单测 (File Viewer Service Unit Test)
 * (packages/desktop/__tests__/unit/fileViewerService.test.mjs)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileViewerService } from '../../dist/renderer/services/fileViewerService.mjs';

function createMockDeps(overrides = {}) {
  let renderCount = 0;
  const copiedTexts = [];
  const externalOpened = [];

  const state = {
    inspectorCollapsed: true,
    inspectorFullscreen: false,
    activeInspectorTab: 'files',
    activeFilePath: '',
    fileViewMode: 'raw',
    fileShowLineNumbers: false,
    fileSearchOpen: false,
    fileSearchQuery: '',
    openFiles: [],
    artifacts: [],
    gatewayUrl: 'http://127.0.0.1:8080',
    messages: [],
    ...(overrides.state || {}),
  };

  const desktopApi = overrides.desktopApi ?? {
    openExternal: async (filePath, content) => {
      externalOpened.push({ filePath, content });
    },
    saveFile: async (payload) => {
      return { success: true };
    },
  };

  const gatewayClient = 'gatewayClient' in overrides ? overrides.gatewayClient : {
    call: async () => ({}),
  };

  const deps = {
    getState: () => state,
    render: () => {
      renderCount += 1;
    },
    getDesktopApi: () => desktopApi,
    getGatewayClient: () => gatewayClient,
    safeCopyText: async (text) => {
      copiedTexts.push(text);
      return true;
    },
    t: (key) => key,
  };

  return {
    deps,
    state,
    desktopApi,
    getRenderCount: () => renderCount,
    copiedTexts,
    externalOpened,
  };
}

test('FileViewerService: handleOpenFilePreview 展开检查舱并挂载 HTML 原型为 rendered 视图', async () => {
  const { deps, state, getRenderCount } = createMockDeps();
  const service = createFileViewerService(deps);

  await service.handleOpenFilePreview('src/mock-design.html');

  assert.equal(state.inspectorCollapsed, false);
  assert.equal(state.activeInspectorTab, 'preview');
  assert.equal(state.activeFilePath, 'src/mock-design.html');
  assert.equal(state.fileViewMode, 'rendered');
  assert.equal(state.openFiles.length, 1);
  assert.equal(state.openFiles[0].path, 'src/mock-design.html');
  assert.equal(state.artifacts.length, 1);
  assert.equal(state.artifacts[0].name, 'src/mock-design.html');
  assert.ok(getRenderCount() >= 1);
});

test('FileViewerService: switchFileTab 切换活动文件标签', () => {
  const { deps, state, getRenderCount } = createMockDeps({
    state: {
      openFiles: [
        { path: 'a.ts', content: 'const a = 1;' },
        { path: 'b.ts', content: 'const b = 2;' },
      ],
      activeFilePath: 'a.ts',
    },
  });
  const service = createFileViewerService(deps);

  service.switchFileTab('b.ts');
  assert.equal(state.activeFilePath, 'b.ts');
  assert.equal(getRenderCount(), 1);
});

test('FileViewerService: closeFileTab 平滑迁移焦点，全部关闭后自动折叠检查舱', () => {
  const { deps, state, getRenderCount } = createMockDeps({
    state: {
      inspectorCollapsed: false,
      openFiles: [
        { path: 'a.ts', content: 'a' },
        { path: 'b.ts', content: 'b' },
      ],
      artifacts: [
        { name: 'a.ts', id: 'art-1', type: 'FILE', size: '' },
        { name: 'b.ts', id: 'art-2', type: 'FILE', size: '' },
      ],
      activeFilePath: 'a.ts',
    },
  });
  const service = createFileViewerService(deps);

  // 关闭 a.ts，焦点平移到 b.ts
  service.closeFileTab('a.ts');
  assert.equal(state.openFiles.length, 1);
  assert.equal(state.artifacts.length, 1);
  assert.equal(state.activeFilePath, 'b.ts');
  assert.equal(state.inspectorCollapsed, false);

  // 关闭 b.ts，全部清空，自动折叠检查舱
  service.closeFileTab('b.ts');
  assert.equal(state.openFiles.length, 0);
  assert.equal(state.artifacts.length, 0);
  assert.equal(state.activeFilePath, '');
  assert.equal(state.inspectorCollapsed, true);
  assert.equal(getRenderCount(), 2);
});

test('FileViewerService: toggleViewMode / toggleLineNumbers 模式切换', () => {
  const { deps, state } = createMockDeps({
    state: { fileViewMode: 'rendered', fileShowLineNumbers: false },
  });
  const service = createFileViewerService(deps);

  service.toggleViewMode();
  assert.equal(state.fileViewMode, 'raw');

  service.toggleLineNumbers();
  assert.equal(state.fileShowLineNumbers, true);
});

test('FileViewerService: 检索状态机 (toggle / close / setQuery)', () => {
  const { deps, state } = createMockDeps({
    state: { fileSearchOpen: false, fileSearchQuery: '' },
  });
  const service = createFileViewerService(deps);

  service.toggleFileSearch();
  assert.equal(state.fileSearchOpen, true);

  service.setFileSearchQuery('keyword');
  assert.equal(state.fileSearchQuery, 'keyword');

  service.closeFileSearch();
  assert.equal(state.fileSearchOpen, false);
  assert.equal(state.fileSearchQuery, '');
});

test('FileViewerService: copyFileContent / copyFilePath 复制活动文件', async () => {
  const { deps, copiedTexts } = createMockDeps({
    state: {
      openFiles: [{ path: 'test.txt', content: 'Hello Content' }],
      activeFilePath: 'test.txt',
    },
  });
  const service = createFileViewerService(deps);

  await service.copyFileContent();
  assert.deepEqual(copiedTexts, ['Hello Content']);

  await service.copyFilePath();
  assert.deepEqual(copiedTexts, ['Hello Content', 'test.txt']);
});

test('FileViewerService: closeInspector / toggleInspectorFullscreen / switchInspectorTab 控制检查舱尺寸与页签', () => {
  const { deps, state } = createMockDeps({
    state: {
      inspectorCollapsed: false,
      inspectorFullscreen: false,
      activeInspectorTab: 'files',
    },
  });
  const service = createFileViewerService(deps);

  service.toggleInspectorFullscreen();
  assert.equal(state.inspectorFullscreen, true);

  service.closeInspector();
  assert.equal(state.inspectorCollapsed, true);
  assert.equal(state.inspectorFullscreen, false);

  service.switchInspectorTab('artifacts');
  assert.equal(state.activeInspectorTab, 'artifacts');
});

test('FileViewerService: 文件树加载、懒加载子目录、过滤、面板折叠及并发代数防串台', async () => {
  const treeCalls = [];
  const subDirEntries = [{ name: 'leaf.ts', path: '/ws/sub/leaf.ts', isDirectory: false }];
  let resolveRootFirst;
  let rootCallCount = 0;

  const { deps, state } = createMockDeps({
    state: {
      activeSessionId: 's1',
      profileName: 'default',
      sessions: [
        {
          id: 's1',
          cwd: '/ws',
          toolCalls: [],
        },
      ],
      projects: [],
      messages: [
        {
          toolCalls: [
            { name: 'read_file', args: { path: '/ws/fallback.md' }, output: 'ok' },
            { name: 'write_file', args: JSON.stringify({ path: '/ws/alt.md' }) },
          ],
        },
      ],
      fileTreeState: { status: 'idle' },
      fileTreeExpandedPaths: [],
      fileTreeFilterQuery: '',
      fileTreeCollapsed: false,
      fileTreeLoadedCwd: '',
      openFiles: [{ path: '/ws/sub/leaf.ts', content: 'export {};' }],
      activeFilePath: '/ws/sub/leaf.ts',
    },
    desktopApi: {
      listDirectory: async (dirPath) => {
        treeCalls.push(dirPath ?? '');
        if (!dirPath || dirPath === '/ws') {
          rootCallCount += 1;
          if (rootCallCount === 1) {
            return new Promise((r) => { resolveRootFirst = r; });
          }
          return [
            { name: 'sub', path: '/ws/sub', isDirectory: true },
            { name: 'errDir', path: '/ws/errDir', isDirectory: true },
            { name: 'README.md', path: '/ws/README.md', isDirectory: false },
          ];
        }
        if (dirPath === '/ws/sub') return subDirEntries;
        throw new Error('dir failed');
      },
    },
    gatewayClient: {
      call: async () => ({ items: [{ text: '/ws/rpc.ts' }] }),
    },
  });

  const service = createFileViewerService(deps);

  // 1. 并发代数防串台：第一次慢响应到达时必须被丢弃
  const slowLoad = service.loadFileTree();
  assert.equal(state.fileTreeState.status, 'loading');
  // 重复非强刷同 CWD 在 loading 中跳过
  await service.loadFileTree();
  const fastLoad = service.loadFileTree(true);
  await fastLoad;
  resolveRootFirst([{ name: 'stale.ts', path: '/ws/stale.ts', isDirectory: false }]);
  await slowLoad;

  assert.equal(state.fileTreeState.status, 'ready');
  assert.equal(state.fileTreeState.nodes.some((n) => n.name === 'stale.ts'), false, '迟到响应不得覆盖新世代树');
  assert.ok(state.fileTreeExpandedPaths.includes('/ws/sub'), '激活文件的祖先目录必须自动展开');

  // 非强刷同 CWD ready 态跳过
  const prevCount = treeCalls.length;
  await service.loadFileTree();
  assert.equal(treeCalls.length, prevCount);

  // 2. 折叠与懒加载子目录
  await service.toggleDirectory('/ws/sub'); // 已因祖先自动展开，先收起
  assert.equal(state.fileTreeExpandedPaths.includes('/ws/sub'), false);
  await service.toggleDirectory('/ws/sub'); // 重新展开并懒加载 sub
  assert.equal(state.fileTreeExpandedPaths.includes('/ws/sub'), true);
  const subNode = state.fileTreeState.nodes.find((n) => n.name === 'sub');
  assert.equal(subNode?.childrenLoaded, true);
  assert.equal(subNode?.children?.[0].name, 'leaf.ts');

  // 2b. 子目录全失败时记录显式告警并收敛 childrenLoaded
  const savedWarn = console.warn;
  console.warn = () => {};
  const srvNoProxy = createFileViewerService({
    ...deps,
    getDesktopApi: () => ({ listDirectory: async () => { throw new Error('errDir blocked'); } }),
    getGatewayClient: () => null,
  });
  state.fileTreeState = {
    status: 'ready',
    rootPath: '/ws',
    source: 'local_fs',
    nodes: [{ name: 'errDir', path: '/ws/errDir', isDirectory: true, childrenLoaded: false }],
  };
  await srvNoProxy.toggleDirectory('/ws/errDir');
  assert.equal(state.fileTreeState.nodes[0].childrenLoaded, true);
  console.warn = savedWarn;

  // 3. 过滤与面板折叠切换
  service.setFileTreeFilter('leaf');
  assert.equal(state.fileTreeFilterQuery, 'leaf');

  service.toggleFileTreePane();
  assert.equal(state.fileTreeCollapsed, true);
  service.toggleFileTreePane();
  assert.equal(state.fileTreeCollapsed, false);

  // 4. 右侧常驻竖栏 toggleInspectorRailTab 切换
  state.inspectorCollapsed = true;
  service.toggleInspectorRailTab('preview');
  assert.equal(state.inspectorCollapsed, false);
  service.toggleInspectorRailTab('preview');
  assert.equal(state.inspectorCollapsed, true);
  state.inspectorCollapsed = false;
  state.activeInspectorTab = 'git';
  service.toggleInspectorRailTab('preview');
  assert.equal(state.activeInspectorTab, 'preview');

  // 5. 文件树就绪且未折叠时关闭最后一个文件 Tab，保持工具窗常开以便点选下一文件
  state.openFiles = [{ path: '/ws/sub/leaf.ts', content: '' }];
  state.artifacts = [];
  state.fileTreeCollapsed = false;
  service.closeFileTab('/ws/sub/leaf.ts');
  assert.equal(state.inspectorCollapsed, false, '文件树就绪且展开时关完标签页不得折叠工具窗');
});

test('FileViewerService: 根目录报错置 error 状态，以及 RPC complete.path 通道正常接通', async () => {
  const savedWarn = console.warn;
  console.warn = () => {};
  try {
    const rpcDeps = createMockDeps({
      state: {
        sessions: [{ id: 's1', cwd: '/ws' }],
        activeSessionId: 's1',
      },
      desktopApi: {},
      gatewayClient: {
        call: async () => ({ items: [{ text: '/ws/only-rpc.ts' }] }),
      },
    });
    const rpcService = createFileViewerService(rpcDeps.deps);
    await rpcService.loadFileTree(true);
    assert.equal(rpcDeps.state.fileTreeState.status, 'ready');
    assert.equal(rpcDeps.state.fileTreeState.source, 'gateway_rpc');

    const errDeps = createMockDeps({
      desktopApi: { listDirectory: async () => { throw new Error('disk io error'); } },
      gatewayClient: null,
    });
    const errService = createFileViewerService(errDeps.deps);
    await errService.loadFileTree(true);
    assert.equal(errDeps.state.fileTreeState.status, 'error');
    assert.equal(errDeps.state.fileTreeState.message, 'disk io error');
  } finally {
    console.warn = savedWarn;
  }
});

test('FileViewerService: bindEvents DOM 控件绑定覆盖文件树过滤/刷新/目录点击/文件打开与右竖栏', async () => {
  const savedDoc = globalThis.document;
  const elements = new Map();
  const makeEl = (id, dataset = {}) => ({
    id,
    dataset,
    value: '',
    style: {},
    selectionStart: 0,
    selectionEnd: 0,
    focus() {},
    onclick: null,
    oninput: null,
    closest: () => null,
  });

  const treeFilterEl = makeEl('inspector-tree-filter-input');
  treeFilterEl.value = 'app';
  const dirEl = makeEl('dir-row', { treeDir: '/ws/src' });
  const fileEl = makeEl('file-row', { treeFile: '/ws/README.md' });
  const railBtnEl = makeEl('rail-btn', { tab: 'preview' });
  const refreshBtn = makeEl('btn-file-tree-refresh');
  const retryBtn = makeEl('btn-file-tree-retry');
  const collapseBtn = makeEl('btn-file-tree-toggle');
  const expandBtn = makeEl('btn-file-tree-expand');
  const closeSearchBtn = makeEl('btn-close-search');

  for (const el of [treeFilterEl, refreshBtn, retryBtn, collapseBtn, expandBtn, closeSearchBtn]) {
    elements.set(el.id, el);
  }

  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: (sel) => {
      if (sel === '[data-tree-dir]') return [dirEl];
      if (sel === '[data-tree-file]') return [fileEl];
      if (sel === '.vertical-tab-item') return [railBtnEl];
      return [];
    },
  };

  try {
    const { deps, state } = createMockDeps({
      state: {
        inspectorCollapsed: false,
        fileTreeState: { status: 'idle' },
        sessions: [{ id: 's1', cwd: '/ws' }],
        activeSessionId: 's1',
      },
      desktopApi: {
        listDirectory: async () => [{ name: 'README.md', path: '/ws/README.md', isDirectory: false }],
        readFile: async () => '# Readme',
      },
    });
    const service = createFileViewerService(deps);
    service.bindEvents();

    // 等 bindEvents 触发的初始自动加载落定
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(state.fileTreeState.status, 'ready');

    treeFilterEl.oninput();
    assert.equal(state.fileTreeFilterQuery, 'app');

    collapseBtn.onclick();
    assert.equal(state.fileTreeCollapsed, true);
    expandBtn.onclick();
    assert.equal(state.fileTreeCollapsed, false);

    refreshBtn.onclick();
    retryBtn.onclick();
    closeSearchBtn.onclick();
    await dirEl.onclick();
    await fileEl.onclick();
    assert.equal(state.activeFilePath, '/ws/README.md');

    railBtnEl.onclick();
    assert.equal(state.inspectorCollapsed, true);
  } finally {
    globalThis.document = savedDoc;
  }
});

test('FileViewerService: 补齐目录查找/回退/加载竞态/RPC/下载与 bindEvents 全边缘分支', async () => {
  const savedWarn = console.warn;
  console.warn = () => {};
  try {
    // 1. 深度嵌套目录查找、RPC completePath（loadFileTree + toggleDirectory）及过期树守护
    let rpcDirCalls = 0;
    let resolveSubRpc;
    const { deps: d1, state: s1 } = createMockDeps({
      state: {
        sessions: [{ id: 's1', cwd: '/ws' }],
        activeSessionId: 's1',
        profileName: 'p1',
        messages: [
          { toolCalls: undefined },
          { toolCalls: [{ name: 'read_file', args: undefined, output: { raw: true } }] },
        ],
        openFiles: [{ path: 'http://127.0.0.1/remote.txt', content: `${'inspector.remoteNotice'}\nline` }],
        activeFilePath: 'http://127.0.0.1/remote.txt',
      },
      desktopApi: {
        saveFile: async () => ({ success: true }),
      },
      gatewayClient: {
        call: async (_method, _params) => {
          rpcDirCalls += 1;
          if (rpcDirCalls === 1) return { items: [{ text: '/ws/sub/deep/leaf.ts' }] };
          if (rpcDirCalls === 2) {
            return new Promise((r) => { resolveSubRpc = r; });
          }
          return null;
        },
      },
    });
    // 第一轮保留 messages（含 toolCalls: undefined 及无 args/非字符串 output）测试 collectSessionFallbackPaths
    // 同时保持 fileTreeExpandedPaths = undefined、activeFilePath = '/ws/sub/leaf.ts' 触发祖先自动展开
    s1.fileTreeExpandedPaths = undefined;
    s1.fileTreeLoadedCwd = undefined;
    s1.fileTreeState = undefined;
    s1.activeFilePath = '/ws/sub/leaf.ts';
    delete d1.getDesktopApi().listDirectory;

    const srv1 = createFileViewerService(d1);
    await srv1.loadFileTree(); // RPC Tier 3 hit

    // 第二轮测 messages=undefined、openFiles=undefined、desktopApi=undefined、rpc返回null、targetCwd='' & res.rootPath=''
    const savedRpcDeps = createMockDeps({
      state: {
        sessions: [],
        activeSessionId: '',
        profileName: '',
        gatewayUrl: '',
        messages: undefined,
        openFiles: undefined,
        fileTreeLoadedCwd: undefined,
        fileTreeState: undefined,
      },
      gatewayClient: {
        call: async () => null,
      },
    });
    savedRpcDeps.deps.getDesktopApi = () => undefined;
    const srvEmptyRpc = createFileViewerService(savedRpcDeps.deps);
    await srvEmptyRpc.loadFileTree(); // completePath 返回 null -> 全链失败 -> error
    // ready 且 fileTreeLoadedCwd=undefined 与 targetCwd='' 对齐时不重刷
    savedRpcDeps.state.fileTreeState = { status: 'ready', rootPath: '', nodes: [], source: 'local_fs' };
    savedRpcDeps.state.fileTreeLoadedCwd = undefined;
    await srvEmptyRpc.loadFileTree(false);
    // fileTreeState=loading 且 fileTreeLoadedCwd=undefined 时再次 non-force 加载直接跳过
    savedRpcDeps.state.fileTreeState = { status: 'loading' };
    savedRpcDeps.state.fileTreeLoadedCwd = undefined;
    await srvEmptyRpc.loadFileTree(false);
    // desktopApi=undefined + res.rootPath='' + targetCwd='' 分支
    const srvRootEmpty = createFileViewerService({
      ...savedRpcDeps.deps,
      getDesktopApi: () => ({ listDirectory: async () => [] }),
    });
    await srvRootEmpty.loadFileTree(true);
    assert.equal(savedRpcDeps.state.fileTreeLoadedCwd, '');

    // 嵌套目录查找与空路径防护
    await srv1.toggleDirectory('');
    s1.fileTreeState = { status: 'loading' };
    await srv1.toggleDirectory('/ws/sub');
    s1.fileTreeState = {
      status: 'ready',
      rootPath: '/ws',
      source: 'local_fs',
      nodes: [
        {
          name: 'sub',
          path: '/ws/sub',
          isDirectory: true,
          childrenLoaded: true,
          children: [
            { name: 'deep', path: '/ws/sub/deep', isDirectory: true, childrenLoaded: false },
            { name: 'deep2', path: '/ws/sub/deep2', isDirectory: true, childrenLoaded: false },
          ],
        },
        { name: 'file.ts', path: '/ws/file.ts', isDirectory: false },
      ],
    };
    await srv1.toggleDirectory('/ws/missing');
    await srv1.toggleDirectory('/ws/file.ts');
    await srv1.toggleDirectory('/ws/sub'); // childrenLoaded === true -> skip async load

    // 子目录 RPC 异步返回前被新的 loadFileTree 作废
    const pendingDeep = srv1.toggleDirectory('/ws/sub/deep');
    s1.activeSessionId = '';
    s1.profileName = '';
    await srv1.loadFileTree(true);
    resolveSubRpc({ items: [{ text: '/ws/sub/deep/late.ts' }] });
    await pendingDeep;

    // toggleDirectory 测 desktopApi=undefined 与 completion=null（activeSessionId/profileName='')
    s1.fileTreeState = {
      status: 'ready',
      rootPath: '/ws',
      source: 'local_fs',
      nodes: [{ name: 'deep2', path: '/ws/sub/deep2', isDirectory: true, childrenLoaded: false }],
    };
    const srvNoBridgeRpc = createFileViewerService({
      ...d1,
      getDesktopApi: () => undefined,
    });
    await srvNoBridgeRpc.toggleDirectory('/ws/sub/deep2');

    // 另一个 toggleDirectory 返回时 latestTree 变为 error（非 ready）
    let resolveSub2;
    const { deps: d2, state: s2 } = createMockDeps({
      state: {
        sessions: [{ id: 's2', cwd: '/ws2' }],
        activeSessionId: 's2',
        fileTreeState: {
          status: 'ready',
          rootPath: '/ws2',
          source: 'local_fs',
          nodes: [{ name: 'dir', path: '/ws2/dir', isDirectory: true, childrenLoaded: false }],
        },
      },
      desktopApi: {
        listDirectory: async () => new Promise((r) => { resolveSub2 = r; }),
      },
      gatewayClient: null,
    });
    const srv2 = createFileViewerService(d2);
    const wait2 = srv2.toggleDirectory('/ws2/dir');
    s2.fileTreeState = { status: 'error', message: 'reset' };
    resolveSub2([{ name: 'x.ts', path: '/ws2/dir/x.ts', isDirectory: false }]);
    await wait2;

    // downloadFile remoteNotice + gatewayUrl 有值/空值 两分支
    s1.openFiles = [{ path: 'remote/log.txt', content: 'inspector.remoteNotice body' }];
    s1.activeFilePath = 'remote/log.txt';
    await srv1.downloadFile();
    s1.gatewayUrl = '';
    await srv1.downloadFile();

    // downloadFile remoteNotice + http 与普通分支也保持覆盖
    s1.openFiles = [{ path: 'https://example.com/a.txt', content: 'hello' }];
    s1.activeFilePath = 'https://example.com/a.txt';
    await srv1.downloadFile();
  } finally {
    console.warn = savedWarn;
  }

  // 2. bindEvents 在 fileTreeState=loading/ready/undefined 与收起态下的自动加载判断分支
  const savedDoc = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  try {
    const { deps: dReady, state: sReady } = createMockDeps({
      state: {
        inspectorCollapsed: false,
        sessions: [{ id: 's1', cwd: '/ws' }],
        activeSessionId: 's1',
        fileTreeLoadedCwd: undefined,
        fileTreeState: undefined,
      },
      desktopApi: { listDirectory: async () => [] },
    });
    const srvReady = createFileViewerService(dReady);
    srvReady.bindEvents();
    sReady.fileTreeState = { status: 'loading' };
    sReady.fileTreeLoadedCwd = '/ws';
    srvReady.bindEvents();
  } finally {
    globalThis.document = savedDoc;
  }
});

test('FileViewerService: 目录点击展开、远程二进制/超大文件下载卡片与 #btn-preview-download-file 交互', async () => {
  const savedDoc = globalThis.document;
  const saveCalls = [];
  const copied = [];
  const elements = new Map();
  const createdLinks = [];
  const btnPreviewDl = { onclick: null, style: {} };
  elements.set('btn-preview-download-file', btnPreviewDl);

  globalThis.document = {
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: () => [],
    createElement: (tag) => {
      const node = { tag, href: '', download: '', clicked: false, click() { this.clicked = true; } };
      createdLinks.push(node);
      return node;
    },
    body: {
      appendChild() {},
      removeChild() {},
    },
  };

  try {
    const { deps, state } = createMockDeps({
      state: {
        inspectorCollapsed: true,
        gatewayUrl: 'wss://remote.example.com:9119',
        profileName: 'coder',
        activeSessionId: 'sess-9',
        fileTreeState: {
          status: 'ready',
          rootPath: '/opt/data/workspace',
          source: 'gateway_api',
          nodes: [
            { name: 'memory', path: '/opt/data/workspace/memory', isDirectory: true, childrenLoaded: true, children: [] },
            { name: 'installer.exe', path: '/opt/data/workspace/installer.exe', isDirectory: false, size: 2048000 },
            { name: 'huge.log', path: '/opt/data/workspace/huge.log', isDirectory: false, size: 4 * 1024 * 1024 },
          ],
        },
        fileTreeExpandedPaths: [],
        fileTreeCollapsed: true,
        openFiles: [],
        artifacts: [],
      },
      desktopApi: {
        saveFile: async (opts) => {
          saveCalls.push(opts);
          return { success: true };
        },
        httpProxy: async ({ path: ep }) => {
          if (ep.startsWith('/api/files?path=%2Fopt%2Fdata%2Fworkspace%2FunknownDir')) {
            return { path: '/opt/data/workspace/unknownDir', entries: [] };
          }
          throw new Error('404');
        },
      },
    });
    deps.safeCopyText = async (txt) => {
      copied.push(txt);
      return true;
    };

    const service = createFileViewerService(deps);

    // 1. 点击已知目录名（从消息链接触发）-> 自动展开目录而非误建文件页签；重复触发已展开目录分支亦保持安全
    await service.handleOpenFilePreview('/opt/data/workspace/memory');
    assert.equal(state.inspectorCollapsed, false);
    assert.equal(state.fileTreeCollapsed, false);
    assert.ok(state.fileTreeExpandedPaths.includes('/opt/data/workspace/memory'));
    assert.equal(state.openFiles.length, 0);
    await service.handleOpenFilePreview('/opt/data/workspace/memory');

    // 2. 点击未知目录路径且网关 /api/files 返回 entries -> 自动转回目录展开；且当文件树尚在 idle 且 expanded 为 undefined 时亦不崩溃
    state.fileTreeState = { status: 'idle' };
    state.fileTreeExpandedPaths = undefined;
    await service.handleOpenFilePreview('/opt/data/workspace/unknownDir');
    assert.equal(state.openFiles.length, 0);
    state.fileTreeState = {
      status: 'ready',
      rootPath: '/opt/data/workspace',
      source: 'gateway_api',
      nodes: [
        { name: 'memory', path: '/opt/data/workspace/memory', isDirectory: true, childrenLoaded: true, children: [] },
        { name: 'installer.exe', path: '/opt/data/workspace/installer.exe', isDirectory: false, size: 2048000 },
        { name: 'huge.log', path: '/opt/data/workspace/huge.log', isDirectory: false, size: 4 * 1024 * 1024 },
      ],
    };
    state.fileTreeExpandedPaths = undefined;
    await service.handleOpenFilePreview('/opt/data/workspace/unknownDir');

    // 3. 打开已知 .exe 二进制文件 -> 前置阻断，带 byteSize 与 isBinary 挂载
    await service.handleOpenFilePreview('/opt/data/workspace/installer.exe');
    assert.equal(state.openFiles.length, 1);
    assert.equal(state.openFiles[0].isBinary, true);
    assert.equal(state.openFiles[0].byteSize, 2048000);

    // copyFileContent 对二进制文件保护：不以空串污染剪贴板
    await service.copyFileContent();
    assert.equal(copied.length, 0);

    // 二次打开同路径刷新现有标签页分支
    await service.handleOpenFilePreview('/opt/data/workspace/installer.exe');
    assert.equal(state.openFiles.length, 1);

    // 打开超大文件 -> isTooLarge 标记
    await service.handleOpenFilePreview('/opt/data/workspace/huge.log');
    assert.equal(state.openFiles[1].isTooLarge, true);

    // bindEvents 绑定卡片内 #btn-preview-download-file 并透传 remoteUrl（远端文件不得下传 sourcePath 防本地重名劫持）
    service.bindEvents();
    assert.ok(typeof btnPreviewDl.onclick === 'function');
    btnPreviewDl.onclick();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(saveCalls.length, 1);
    assert.equal(
      saveCalls[0].remoteUrl,
      'https://remote.example.com:9119/api/fs/download?path=%2Fopt%2Fdata%2Fworkspace%2Fhuge.log&profile=coder&session_id=sess-9',
    );
    assert.equal(saveCalls[0].sourcePath, undefined);

    // 远端 gateway_api 已读文本（如与本地同名的 package.json）下载时不得带 sourcePath，否则会静默保存本地工作区同名文件
    state.openFiles.push({
      path: 'package.json',
      content: '{"remoteName":"from-gateway"}',
      source: 'gateway_api',
    });
    state.activeFilePath = 'package.json';
    await service.downloadFile();
    assert.equal(saveCalls.length, 2);
    assert.equal(saveCalls[1].sourcePath, undefined);
    assert.equal(saveCalls[1].content, '{"remoteName":"from-gateway"}');

    // desktopApi.saveFile 显式返回失败（非 canceled）或异常兜底、以及无 saveFile 时的 0 字节防呆拦截
    const failDesktopDeps = createMockDeps({
      state: {
        gatewayUrl: '',
        openFiles: [{ path: '/ws/empty.exe', content: '', isBinary: true, source: 'local_fs' }],
        activeFilePath: '/ws/empty.exe',
      },
      desktopApi: {
        saveFile: async () => ({ success: false, error: '无法读取本地源文件' }),
      },
    });
    await createFileViewerService(failDesktopDeps.deps).downloadFile();
    assert.equal(createdLinks.length, 0, 'saveFile 显式失败时不得回落触发浏览器 0 字节 Blob 下载');

    const throwDesktopDeps = createMockDeps({
      state: {
        gatewayUrl: '',
        openFiles: [{ path: '/ws/plain.txt', content: 'fallback body', source: 'local_fs' }],
        activeFilePath: '/ws/plain.txt',
      },
      desktopApi: {
        saveFile: async () => {
          throw new Error('ipc down');
        },
      },
    });
    await createFileViewerService(throwDesktopDeps.deps).downloadFile();
    assert.equal(createdLinks.length, 1);
    assert.equal(createdLinks[0].download, 'plain.txt');
    createdLinks.length = 0;

    // 无 saveFile 时浏览器 fallback 使用 remoteUrl 与 isDataUrl 下载，并对空内容二进制/超大文件阻断 0 字节 Blob
    const browserDeps = createMockDeps({
      state: {
        gatewayUrl: 'http://127.0.0.1:9119',
        openFiles: [{ path: '/opt/data/workspace/installer.exe', content: '', isBinary: true, byteSize: 4096 }],
        activeFilePath: '/opt/data/workspace/installer.exe',
      },
      desktopApi: {},
    });
    const browserSrv = createFileViewerService(browserDeps.deps);
    await browserSrv.downloadFile();
    assert.equal(createdLinks.length, 1);
    assert.equal(createdLinks[0].download, 'installer.exe');
    assert.match(createdLinks[0].href, /\/api\/fs\/download\?path=/);

    browserDeps.state.openFiles = [{ path: 'chart.png', content: 'data:image/png;base64,AAAA' }];
    browserDeps.state.activeFilePath = 'chart.png';
    await browserSrv.downloadFile();
    assert.equal(createdLinks[1].href, 'data:image/png;base64,AAAA');

    browserDeps.state.gatewayUrl = '';
    browserDeps.state.openFiles = [
      { path: '/ws/offline.exe', content: '', isBinary: true, source: 'local_fs' },
      { path: '/ws/offline.log', content: '', isTooLarge: true, source: 'local_fs' },
    ];
    browserDeps.state.activeFilePath = '/ws/offline.exe';
    await browserSrv.downloadFile();
    browserDeps.state.activeFilePath = '/ws/offline.log';
    await browserSrv.downloadFile();
    assert.equal(createdLinks.length, 2, '空内容二进制/超大文件在无 remoteUrl 时不得产出 0 字节 Blob 下载');

    // 防无限重入死循环回归：activeCwd 为空而服务端返回非空 rootPath（如 /opt/data）时，bindEvents 不得反复重拉 loadFileTree
    let rootFetchCount = 0;
    const loopGuardDeps = createMockDeps({
      state: {
        inspectorCollapsed: false,
        gatewayUrl: 'https://remote.example.com:9119',
        sessions: [],
        projects: [],
        fileTreeState: { status: 'idle' },
        fileTreeLoadedCwd: '',
      },
      desktopApi: {
        httpProxy: async ({ path: ep }) => {
          if (ep === '/api/files') {
            rootFetchCount += 1;
            return { path: '/opt/data', entries: [{ name: 'workspace', path: '/opt/data/workspace', is_directory: true }] };
          }
          return null;
        },
      },
    });
    const loopGuardSrv = createFileViewerService(loopGuardDeps.deps);
    loopGuardDeps.deps.render = () => loopGuardSrv.bindEvents();
    loopGuardSrv.bindEvents();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(rootFetchCount, 1, '空 CWD 解析出非空服务端 rootPath 后，bindEvents 绝不得触发第二轮死循环加载');
    assert.equal(loopGuardDeps.state.fileTreeState.rootPath, '/opt/data');
    assert.equal(loopGuardDeps.state.fileTreeLoadedCwd, '');

    // 本地工作区命中 local_fs 的 .exe 即使连着远端网关也不得生成 remoteUrl，必须仅走 sourcePath 直拷
    const localSaveCalls = [];
    const localBinDeps = createMockDeps({
      state: {
        gatewayConnected: true,
        gatewayUrl: 'https://remote.example.com:9119',
        fileTreeState: {
          status: 'ready',
          source: 'local_fs',
          rootPath: '/ws',
          nodes: [{ name: 'local-app.exe', path: '/ws/local-app.exe', isDirectory: false, depth: 0, size: 1024 }],
        },
      },
      desktopApi: {
        saveFile: async (opts) => {
          localSaveCalls.push(opts);
          return { success: true };
        },
      },
    });
    const localBinSrv = createFileViewerService(localBinDeps.deps);
    await localBinSrv.handleOpenFilePreview('/ws/local-app.exe');
    assert.equal(localBinDeps.state.openFiles[0].source, 'local_fs');
    await localBinSrv.downloadFile();
    assert.equal(localSaveCalls.length, 1);
    assert.equal(localSaveCalls[0].sourcePath, '/ws/local-app.exe');
    assert.equal(localSaveCalls[0].remoteUrl, undefined, 'local_fs 文件下载不得附带 remoteUrl');

    // 未在树节点的 .exe：离线状态 (!gatewayConnected) 归入 local_fs，在线状态回落 fallback
    localBinDeps.state.gatewayConnected = false;
    await localBinSrv.handleOpenFilePreview('/ws/sub/offline.exe');
    assert.equal(localBinDeps.state.openFiles.at(-1).source, 'local_fs');

    localBinDeps.state.gatewayConnected = true;
    await localBinSrv.handleOpenFilePreview('/ws/sub/online-unindexed.exe');
    assert.equal(localBinDeps.state.openFiles.at(-1).source, 'fallback');

    localBinDeps.state.fileTreeState = { status: 'ready', source: 'gateway_api', rootPath: '/opt', nodes: [] };
    await localBinSrv.handleOpenFilePreview('/opt/remote.exe');
    assert.equal(localBinDeps.state.openFiles.at(-1).source, 'fallback');

    localBinDeps.state.fileTreeState = undefined;
    await localBinSrv.handleOpenFilePreview('/opt/no-tree.exe');
    assert.equal(localBinDeps.state.openFiles.at(-1).source, 'fallback');
  } finally {
    globalThis.document = savedDoc;
  }
});
