/**
 * Hermes Flux D16 工作区文件树浏览与多标签文件查看器服务 (File Viewer Service)
 *
 * 【设计意图 (Why)】
 * 统一管理右侧「文件树浏览 + 文件预览」一体化工具窗状态机与交互事件：
 *   1. 工作区文件树四级级联加载 (`local_fs -> gateway_api -> gateway_rpc -> session_cache`) 与按层懒加载；
 *   2. 同窗多标签文件查看、Raw/Rendered 视图切换、行号、搜索、外部打开、复制与下载；
 *   3. 常驻右侧融合竖栏点击展开/收起工具窗双向联动，100% 单向依赖注入。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. HTML 原型文档预览必须默认启用 rendered 视图，避免所见即所得变成 HTML 源码展示；
 * 2. 关闭最后一张打开标签页时：若左侧文件树尚未就绪或已折叠，自动收起检查舱（兼容历史行为）；
 *    若左侧文件树已加载且正在浏览，保留工具窗让用户继续点选其他文件；
 * 3. 会话/工程快速切换导致目录异步加载乱序返回时，必须用代数令牌 (`treeLoadGeneration`) 丢弃旧响应。
 *
 * 【约束与规则 (Rules)】
 * - 纯单向依赖，严禁反向 import index.ts；
 * - 0 as any，所有状态变更只写 AppState，严格保持单向数据流。
 */

import {
  InteractiveService,
  buildGatewayDownloadUrl,
  collectAncestorDirectoryPaths,
  mergeDirectoryChildren,
  normalizeWorkspacePath,
  resolveFileContent,
  resolveWorkspaceDirectory,
  type FileTreeNode,
  type HermesGatewayClient,
  type IRpcCaller,
} from '@hermes-flux/core';
import { collectTouchedFiles, type InspectorTab, type I18nKey } from '@hermes-flux/ui';
import { resolveActiveWorkspaceCwd, type AppState } from '../state/appState.js';
import type { HermesDesktopBridge } from '../../preload/index.js';

export interface FileViewerServiceDeps {
  getState: () => AppState;
  render: () => void;
  getDesktopApi: () => HermesDesktopBridge | undefined;
  getGatewayClient: () => HermesGatewayClient | null;
  safeCopyText: (text: string) => Promise<boolean>;
  t: (key: I18nKey) => string;
}

export interface FileViewerService {
  handleOpenFilePreview(filePath: string, previewUrl?: string): Promise<void>;
  switchFileTab(targetPath: string): void;
  closeFileTab(targetPath: string): void;
  toggleViewMode(): void;
  toggleFileSearch(): void;
  closeFileSearch(): void;
  setFileSearchQuery(query: string): void;
  toggleLineNumbers(): void;
  openFileExternal(): void;
  copyFileContent(): Promise<void>;
  copyFilePath(): Promise<void>;
  downloadFile(): Promise<void>;
  closeInspector(): void;
  toggleInspectorFullscreen(): void;
  switchInspectorTab(tab: InspectorTab): void;
  toggleInspectorRailTab(tab: InspectorTab): void;
  loadFileTree(force?: boolean): Promise<void>;
  toggleDirectory(dirPath: string): Promise<void>;
  setFileTreeFilter(query: string): void;
  toggleFileTreePane(): void;
  bindEvents(): void;
}

const interactiveService = new InteractiveService();

function findTreeNodeByPath(nodes: readonly FileTreeNode[], targetDir: string): FileTreeNode | undefined {
  const norm = normalizeWorkspacePath(targetDir);
  for (const node of nodes) {
    if (normalizeWorkspacePath(node.path) === norm) return node;
    if (node.children) {
      const hit = findTreeNodeByPath(node.children, norm);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function createFileViewerService(deps: FileViewerServiceDeps): FileViewerService {
  const { getState, render, getDesktopApi, getGatewayClient, safeCopyText, t } = deps;
  let treeLoadGeneration = 0;

  function createRpcAdapter(client: HermesGatewayClient | null): IRpcCaller | null {
    if (!client) return null;
    return {
      request: <TResult = unknown, TParams = unknown>(
        method: string,
        params?: TParams,
        timeoutMs?: number,
      ): Promise<TResult> => client.call<TResult>(method, params, timeoutMs),
    };
  }

  function collectSessionFallbackPaths(state: AppState): string[] {
    const toolSources = (state.messages ?? []).flatMap((m) =>
      (m.toolCalls ?? []).map((tc) => ({
        name: tc.name,
        args: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}),
        output: typeof tc.output === 'string' ? tc.output : undefined,
      })),
    );
    const touched = collectTouchedFiles(toolSources);
    const opened = (state.openFiles ?? []).map((f) => f.path);
    return Array.from(new Set([...opened, ...touched]));
  }

  function expandAncestorsIfPresent(state: AppState, filePath: string, rootPath: string): void {
    const ancestors = collectAncestorDirectoryPaths(filePath, rootPath);
    if (ancestors.length === 0) return;
    const expanded = new Set((state.fileTreeExpandedPaths ?? []).map((p) => normalizeWorkspacePath(p)));
    for (const dir of ancestors) {
      expanded.add(dir);
    }
    state.fileTreeExpandedPaths = Array.from(expanded);
  }

  async function loadFileTree(force = false): Promise<void> {
    const state = getState();
    const targetCwd = resolveActiveWorkspaceCwd(state);
    const currentTree = state.fileTreeState ?? { status: 'idle' };

    if (!force && currentTree.status === 'ready' && (state.fileTreeLoadedCwd ?? '') === targetCwd) {
      return;
    }
    if (!force && currentTree.status === 'loading' && (state.fileTreeLoadedCwd ?? '') === targetCwd) {
      return;
    }

    const expectedGen = ++treeLoadGeneration;
    state.fileTreeLoadedCwd = targetCwd;
    state.fileTreeState = { status: 'loading' };
    render();

    const desktopApi = getDesktopApi();
    const rpc = createRpcAdapter(getGatewayClient());

    const res = await resolveWorkspaceDirectory(targetCwd, {
      platformBridge: desktopApi ?? null,
      gatewayUrl: state.gatewayUrl,
      profile: state.profileName || undefined,
      completePath: rpc
        ? async (dir) => {
            const completion = await interactiveService.getPathCompletions(
              rpc,
              '',
              dir,
              state.activeSessionId || undefined,
              state.profileName || undefined,
            );
            return (completion?.items ?? []).map((it) => it.text).filter(Boolean);
          }
        : undefined,
      fallbackPaths: collectSessionFallbackPaths(state),
      rootPathForFallback: targetCwd,
    });

    if (expectedGen !== treeLoadGeneration) return;

    if ('error' in res) {
      state.fileTreeState = { status: 'error', message: res.error };
    } else {
      state.fileTreeLoadedCwd = targetCwd;
      state.fileTreeState = {
        status: 'ready',
        rootPath: res.rootPath,
        nodes: res.nodes,
        source: res.source,
      };
      if (state.activeFilePath) {
        expandAncestorsIfPresent(state, state.activeFilePath, res.rootPath);
      }
    }
    render();
  }

  async function toggleDirectory(dirPath: string): Promise<void> {
    const state = getState();
    const normDir = normalizeWorkspacePath(dirPath);
    if (!normDir) return;

    const currentExpanded = state.fileTreeExpandedPaths ?? [];
    const idx = currentExpanded.indexOf(normDir);
    if (idx >= 0) {
      state.fileTreeExpandedPaths = currentExpanded.filter((p) => p !== normDir);
      render();
      return;
    }

    state.fileTreeExpandedPaths = [...currentExpanded, normDir];
    render();

    const treeState = state.fileTreeState;
    if (!treeState || treeState.status !== 'ready') return;
    const node = findTreeNodeByPath(treeState.nodes, normDir);
    if (!node || !node.isDirectory || node.childrenLoaded) return;

    const expectedGen = treeLoadGeneration;
    const desktopApi = getDesktopApi();
    const rpc = createRpcAdapter(getGatewayClient());

    const subRes = await resolveWorkspaceDirectory(normDir, {
      platformBridge: desktopApi ?? null,
      gatewayUrl: state.gatewayUrl,
      profile: state.profileName || undefined,
      completePath: rpc
        ? async (dir) => {
            const completion = await interactiveService.getPathCompletions(
              rpc,
              '',
              dir,
              state.activeSessionId || undefined,
              state.profileName || undefined,
            );
            return (completion?.items ?? []).map((it) => it.text).filter(Boolean);
          }
        : undefined,
    });

    if (expectedGen !== treeLoadGeneration) return;
    const latestTree = getState().fileTreeState;
    if (!latestTree || latestTree.status !== 'ready') return;

    if ('error' in subRes) {
      console.warn('[fileViewerService] load subdirectory failed:', normDir, subRes.error);
      getState().fileTreeState = {
        ...latestTree,
        nodes: mergeDirectoryChildren(latestTree.nodes, normDir, []),
      };
      render();
      return;
    }

    getState().fileTreeState = {
      ...latestTree,
      nodes: mergeDirectoryChildren(latestTree.nodes, normDir, subRes.nodes),
    };
    render();
  }

  function setFileTreeFilter(query: string): void {
    const state = getState();
    state.fileTreeFilterQuery = query;
    render();
    if (typeof document !== 'undefined') {
      const freshInput = document.getElementById('inspector-tree-filter-input') as HTMLInputElement | null;
      if (freshInput) {
        freshInput.focus();
        freshInput.selectionStart = freshInput.selectionEnd = freshInput.value.length;
      }
    }
  }

  function toggleFileTreePane(): void {
    const state = getState();
    state.fileTreeCollapsed = !state.fileTreeCollapsed;
    render();
  }

  function toggleInspectorRailTab(tab: InspectorTab): void {
    const state = getState();
    const isSameTab =
      state.activeInspectorTab === tab ||
      (tab === 'preview' && state.activeInspectorTab === 'artifacts');
    if (state.inspectorCollapsed) {
      state.inspectorCollapsed = false;
      state.activeInspectorTab = tab;
      render();
      void loadFileTree();
      return;
    }
    if (isSameTab) {
      closeInspector();
      return;
    }
    state.activeInspectorTab = tab;
    render();
  }

  function revealDirectoryFromPreview(dirPath: string): void {
    const state = getState();
    state.inspectorCollapsed = false;
    state.activeInspectorTab = 'preview';
    state.fileTreeCollapsed = false;
    const norm = normalizeWorkspacePath(dirPath);
    if (state.fileTreeState?.status === 'ready') {
      expandAncestorsIfPresent(state, norm, state.fileTreeState.rootPath);
      if (!(state.fileTreeExpandedPaths ?? []).includes(norm)) {
        void toggleDirectory(norm);
        return;
      }
    }
    render();
  }

  async function handleOpenFilePreview(filePath: string, previewUrl?: string): Promise<void> {
    const target = (filePath || previewUrl || '').trim();
    if (!target) return;

    const state = getState();
    const desktopApi = getDesktopApi();
    const gatewayClient = getGatewayClient();

    const isHttp = target.startsWith('http://') || target.startsWith('https://');
    const ext = (target.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
    const isHtml = ext === 'html' || ext === 'htm';

    // 0. 若目标在已加载文件树中证实为目录，转为展开目录而不误当文件打开
    const knownNode =
      state.fileTreeState?.status === 'ready'
        ? findTreeNodeByPath(state.fileTreeState.nodes, target)
        : undefined;
    if (knownNode?.isDirectory) {
      revealDirectoryFromPreview(target);
      return;
    }

    // 1. 自动展开右侧 Inspection Pod 并同步设置激活文件，确认为目录时自动回滚并切换目录展开
    const prevActiveFilePath = state.activeFilePath;
    state.inspectorCollapsed = false;
    state.activeInspectorTab = 'preview';
    state.activeFilePath = target;

    // 2. 统一调用底层通用文件解析服务组件 (resolveFileContent，带二进制与超大文件前置守卫)
    const resolved = await resolveFileContent(target, {
      platformBridge: desktopApi,
      gatewayClient,
      gatewayUrl: state.gatewayUrl,
      profile: state.profileName || undefined,
      sessionId: state.activeSessionId || undefined,
      knownSize: knownNode?.size,
      messages: state.messages,
      fallbackNotice: `// ${target}\n\n${t('inspector.remoteNotice')}`,
    });

    if (resolved.isDirectory) {
      state.activeFilePath = prevActiveFilePath;
      revealDirectoryFromPreview(target);
      return;
    }

    // HTML 单文件原型默认开启富渲染模式（仅非二进制/超大截断态）
    if (isHtml && !resolved.isBinary && !resolved.isTooLarge) {
      state.fileViewMode = 'rendered';
    }

    const treeSource =
      state.fileTreeState?.status === 'ready' ? state.fileTreeState.source : undefined;
    const isLocalTreeHit =
      resolved.source === 'local_fs' ||
      (resolved.source === 'fallback' &&
        treeSource === 'local_fs' &&
        (Boolean(knownNode) || !state.gatewayConnected));
    const effectiveSource = isLocalTreeHit ? ('local_fs' as const) : resolved.source;

    // 3. 挂载到 state.openFiles
    let existingOpenFile = state.openFiles.find((f) => f.path === target);
    if (!existingOpenFile) {
      existingOpenFile = {
        id: `file-${Date.now()}`,
        path: target,
        content: resolved.content,
        isBinary: resolved.isBinary,
        isTooLarge: resolved.isTooLarge,
        byteSize: resolved.byteSize,
        source: effectiveSource,
      };
      state.openFiles.push(existingOpenFile);
    } else {
      existingOpenFile.content = resolved.content;
      existingOpenFile.isBinary = resolved.isBinary;
      existingOpenFile.isTooLarge = resolved.isTooLarge;
      existingOpenFile.byteSize = resolved.byteSize;
      existingOpenFile.source = effectiveSource;
    }

    // 4. 挂载到 state.artifacts
    let existing = state.artifacts.find((a) => a.name === target);
    if (!existing) {
      existing = {
        id: `art-${Date.now()}`,
        name: target,
        type: isHttp ? 'LINK' : 'FILE',
        size: '',
        preview: resolved.content,
      };
      state.artifacts.unshift(existing);
    } else {
      existing.preview = resolved.content;
      state.artifacts = [existing, ...state.artifacts.filter((a) => a.name !== target)];
    }

    if (state.fileTreeState?.status === 'ready') {
      expandAncestorsIfPresent(state, target, state.fileTreeState.rootPath);
    }

    render();
  }

  function switchFileTab(targetPath: string): void {
    const state = getState();
    if (targetPath && targetPath !== state.activeFilePath) {
      state.activeFilePath = targetPath;
      render();
    }
  }

  function closeFileTab(targetPath: string): void {
    const state = getState();
    if (!targetPath) return;

    const idx = state.openFiles.findIndex((f) => f.path === targetPath);
    if (idx !== -1) {
      state.openFiles.splice(idx, 1);
      // 同时从 artifacts 中剔除同名项
      state.artifacts = state.artifacts.filter((a) => a.name !== targetPath);
      if (state.activeFilePath === targetPath) {
        state.activeFilePath = state.openFiles[0]?.path || '';
      }
      const keepTreeOpen =
        state.fileTreeState?.status === 'ready' && !state.fileTreeCollapsed;
      if (state.openFiles.length === 0 && !keepTreeOpen) {
        state.inspectorCollapsed = true;
        state.inspectorFullscreen = false;
      }
      render();
    }
  }

  function toggleViewMode(): void {
    const state = getState();
    state.fileViewMode = state.fileViewMode === 'rendered' ? 'raw' : 'rendered';
    render();
  }

  function toggleFileSearch(): void {
    const state = getState();
    state.fileSearchOpen = !state.fileSearchOpen;
    if (!state.fileSearchOpen) {
      state.fileSearchQuery = '';
    }
    render();
    if (state.fileSearchOpen && typeof document !== 'undefined') {
      setTimeout(() => {
        document.getElementById('inspector-search-input')?.focus();
      }, 50);
    }
  }

  function closeFileSearch(): void {
    const state = getState();
    state.fileSearchOpen = false;
    state.fileSearchQuery = '';
    render();
  }

  function setFileSearchQuery(query: string): void {
    const state = getState();
    state.fileSearchQuery = query;
    render();
    if (typeof document !== 'undefined') {
      const freshInput = document.getElementById('inspector-search-input') as HTMLInputElement | null;
      if (freshInput) {
        freshInput.focus();
        freshInput.selectionStart = freshInput.selectionEnd = freshInput.value.length;
      }
    }
  }

  function toggleLineNumbers(): void {
    const state = getState();
    state.fileShowLineNumbers = !state.fileShowLineNumbers;
    render();
  }

  function openFileExternal(): void {
    const state = getState();
    const desktopApi = getDesktopApi();
    const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
    if (activeFile) {
      if (desktopApi?.openExternal) {
        void desktopApi.openExternal(activeFile.path, activeFile.content);
        if (typeof document !== 'undefined') {
          const btnOpenExternal = document.getElementById('btn-file-open-external');
          if (btnOpenExternal) {
            btnOpenExternal.style.color = 'var(--accent)';
            setTimeout(() => {
              btnOpenExternal.style.color = '';
            }, 1000);
          }
        }
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(activeFile.path);
      }
    }
  }

  async function copyFileContent(): Promise<void> {
    const state = getState();
    const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
    if (activeFile && !activeFile.isBinary && !activeFile.isTooLarge) {
      await safeCopyText(activeFile.content);
      if (typeof document !== 'undefined') {
        const btnCopyContent = document.getElementById('btn-file-copy-content');
        if (btnCopyContent) {
          btnCopyContent.style.color = 'var(--accent)';
          setTimeout(() => {
            btnCopyContent.style.color = '';
          }, 1200);
        }
      }
    }
  }

  async function copyFilePath(): Promise<void> {
    const state = getState();
    const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
    if (activeFile) {
      await safeCopyText(activeFile.path);
      if (typeof document !== 'undefined') {
        const btnCopyPath = document.getElementById('btn-file-copy-path');
        if (btnCopyPath) {
          btnCopyPath.style.color = 'var(--accent)';
          setTimeout(() => {
            btnCopyPath.style.color = '';
          }, 1200);
        }
      }
    }
  }

  async function downloadFile(): Promise<void> {
    const state = getState();
    const desktopApi = getDesktopApi();
    const activeFile = state.openFiles.find((f) => f.path === state.activeFilePath) || state.openFiles[0];
    if (!activeFile) return;

    const rawFileName = activeFile.path.split(/[/\\]/).pop() || 'download.txt';
    const isDataUrl = activeFile.content.startsWith('data:');
    const isHttp = activeFile.path.startsWith('http://') || activeFile.path.startsWith('https://');
    const isLocalFile = activeFile.source === 'local_fs';
    const isRemoteOrUnloaded =
      !isLocalFile &&
      Boolean(
        activeFile.isBinary ||
          activeFile.isTooLarge ||
          activeFile.content.includes(t('inspector.remoteNotice')),
      );
    const remoteUrl = isHttp
      ? activeFile.path
      : isRemoteOrUnloaded && state.gatewayUrl
        ? buildGatewayDownloadUrl(
            state.gatewayUrl,
            activeFile.path,
            state.profileName || undefined,
            state.activeSessionId || undefined,
          )
        : '';

    const localSourcePath = isLocalFile && !isHttp && !remoteUrl ? activeFile.path : undefined;

    if (desktopApi?.saveFile) {
      try {
        const res = await desktopApi.saveFile({
          fileName: rawFileName,
          content: remoteUrl || activeFile.content,
          isBase64: isDataUrl,
          sourcePath: localSourcePath,
          remoteUrl: remoteUrl || undefined,
        });
        if (res.success) {
          if (typeof document !== 'undefined') {
            const btnDownload = document.getElementById('btn-file-download');
            if (btnDownload) {
              btnDownload.style.color = 'var(--accent)';
              setTimeout(() => {
                btnDownload.style.color = '';
              }, 1200);
            }
          }
          return;
        }
        return;
      } catch (e) {
        console.warn('[Desktop Save] Native save dialog failed, fallback to blob:', e);
      }
    }

    if (typeof document !== 'undefined') {
      if (isDataUrl || remoteUrl) {
        const a = document.createElement('a');
        a.href = remoteUrl || activeFile.content;
        a.download = rawFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        if (!activeFile.content && (activeFile.isBinary || activeFile.isTooLarge)) {
          return;
        }
        const ext = (rawFileName.split('.').pop() || '').toLowerCase();
        let mime = 'text/plain;charset=utf-8';
        if (ext === 'html' || ext === 'htm') mime = 'text/html;charset=utf-8';
        else if (ext === 'json') mime = 'application/json;charset=utf-8';
        else if (ext === 'md' || ext === 'markdown') mime = 'text/markdown;charset=utf-8';

        const blob = new Blob([activeFile.content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = rawFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      const btnDownload = document.getElementById('btn-file-download');
      if (btnDownload) {
        btnDownload.style.color = 'var(--accent)';
        setTimeout(() => {
          btnDownload.style.color = '';
        }, 1200);
      }
    }
  }

  function closeInspector(): void {
    const state = getState();
    state.inspectorCollapsed = true;
    state.inspectorFullscreen = false;
    render();
  }

  function toggleInspectorFullscreen(): void {
    const state = getState();
    state.inspectorFullscreen = !state.inspectorFullscreen;
    render();
  }

  function switchInspectorTab(tab: InspectorTab): void {
    const state = getState();
    if (tab) {
      state.activeInspectorTab = tab;
      render();
    }
  }

  function bindEvents(): void {
    if (typeof document === 'undefined') return;

    // 任一入口（顶栏开关 / Ctrl+\ / 链接点击）打开检查舱时自动按需懒加载工作区文件树
    const state = getState();
    const activeCwd = resolveActiveWorkspaceCwd(state);
    const treePhase = state.fileTreeState?.status ?? 'idle';
    if (
      !state.inspectorCollapsed &&
      treePhase !== 'loading' &&
      (treePhase === 'idle' || (state.fileTreeLoadedCwd ?? '') !== activeCwd)
    ) {
      void loadFileTree();
    }

    const toggleInspectorClose = document.getElementById('toggle-inspector-close-btn');
    const toggleInspectorFullscreenBtn = document.getElementById('toggle-inspector-fullscreen-btn');
    if (toggleInspectorClose) {
      toggleInspectorClose.onclick = () => closeInspector();
    }
    if (toggleInspectorFullscreenBtn) {
      toggleInspectorFullscreenBtn.onclick = () => toggleInspectorFullscreen();
    }

    // File Tree Explorer controls
    const btnRefreshTree = document.getElementById('btn-file-tree-refresh');
    if (btnRefreshTree) {
      btnRefreshTree.onclick = () => { void loadFileTree(true); };
    }
    const btnRetryTree = document.getElementById('btn-file-tree-retry');
    if (btnRetryTree) {
      btnRetryTree.onclick = () => { void loadFileTree(true); };
    }
    const btnCollapseTree = document.getElementById('btn-file-tree-toggle');
    if (btnCollapseTree) {
      btnCollapseTree.onclick = () => toggleFileTreePane();
    }
    const btnExpandTree = document.getElementById('btn-file-tree-expand');
    if (btnExpandTree) {
      btnExpandTree.onclick = () => toggleFileTreePane();
    }
    const treeFilterInput = document.getElementById('inspector-tree-filter-input') as HTMLInputElement | null;
    if (treeFilterInput) {
      treeFilterInput.oninput = () => setFileTreeFilter(treeFilterInput.value);
    }

    document.querySelectorAll<HTMLElement>('[data-tree-dir]').forEach((dirEl) => {
      dirEl.onclick = () => {
        const dirPath = dirEl.dataset.treeDir;
        if (dirPath) void toggleDirectory(dirPath);
      };
    });

    document.querySelectorAll<HTMLElement>('[data-tree-file]').forEach((fileEl) => {
      fileEl.onclick = () => {
        const filePath = fileEl.dataset.treeFile;
        if (filePath) void handleOpenFilePreview(filePath);
      };
    });

    // File Tab Switch & Close
    document.querySelectorAll<HTMLElement>('.inspector-file-tab').forEach((tabEl) => {
      tabEl.onclick = (e) => {
        if ((e.target as HTMLElement).closest('.btn-close-file-tab')) return;
        const targetPath = tabEl.dataset.fileTab;
        if (targetPath) switchFileTab(targetPath);
      };
    });

    document.querySelectorAll<HTMLElement>('.btn-close-file-tab').forEach((btnEl) => {
      btnEl.onclick = (e) => {
        e.stopPropagation();
        const targetPath = btnEl.dataset.closeTab;
        if (targetPath) closeFileTab(targetPath);
      };
    });

    const btnToggleMode = document.getElementById('btn-file-toggle-mode');
    if (btnToggleMode) {
      btnToggleMode.onclick = () => toggleViewMode();
    }

    const btnSearch = document.getElementById('btn-file-search');
    if (btnSearch) {
      btnSearch.onclick = () => toggleFileSearch();
    }

    const btnCloseSearch = document.getElementById('btn-close-search');
    if (btnCloseSearch) {
      btnCloseSearch.onclick = () => closeFileSearch();
    }

    const inspectorSearchInput = document.getElementById('inspector-search-input') as HTMLInputElement | null;
    if (inspectorSearchInput) {
      inspectorSearchInput.oninput = () => setFileSearchQuery(inspectorSearchInput.value);
    }

    const btnToggleLineNo = document.getElementById('btn-file-toggle-lineno');
    if (btnToggleLineNo) {
      btnToggleLineNo.onclick = () => toggleLineNumbers();
    }

    const btnOpenExternal = document.getElementById('btn-file-open-external');
    if (btnOpenExternal) {
      btnOpenExternal.onclick = () => openFileExternal();
    }

    const btnCopyContent = document.getElementById('btn-file-copy-content');
    if (btnCopyContent) {
      btnCopyContent.onclick = () => copyFileContent();
    }

    const btnCopyPath = document.getElementById('btn-file-copy-path');
    if (btnCopyPath) {
      btnCopyPath.onclick = () => copyFilePath();
    }

    const btnDownload = document.getElementById('btn-file-download');
    if (btnDownload) {
      btnDownload.onclick = () => downloadFile();
    }

    const btnPreviewDownload = document.getElementById('btn-preview-download-file');
    if (btnPreviewDownload) {
      btnPreviewDownload.onclick = () => { void downloadFile(); };
    }

    // 常驻右侧融合竖栏入口：点击展开/收起悬浮工具窗
    document.querySelectorAll<HTMLElement>('.vertical-tab-item').forEach((tab) => {
      tab.onclick = () => {
        const key = tab.dataset.tab as InspectorTab;
        if (key) toggleInspectorRailTab(key);
      };
    });
  }

  return {
    handleOpenFilePreview,
    switchFileTab,
    closeFileTab,
    toggleViewMode,
    toggleFileSearch,
    closeFileSearch,
    setFileSearchQuery,
    toggleLineNumbers,
    openFileExternal,
    copyFileContent,
    copyFilePath,
    downloadFile,
    closeInspector,
    toggleInspectorFullscreen,
    switchInspectorTab,
    toggleInspectorRailTab,
    loadFileTree,
    toggleDirectory,
    setFileTreeFilter,
    toggleFileTreePane,
    bindEvents,
  };
}
