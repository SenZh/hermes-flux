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

  const gatewayClient = overrides.gatewayClient ?? {
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
