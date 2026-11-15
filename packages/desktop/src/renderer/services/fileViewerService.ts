/**
 * Hermes Flux D16 多标签文件查看器与工件工具栏服务 (File Viewer Service)
 *
 * 【设计意图 (Why)】
 * 统一管理右侧 Inspection Pod 的多标签文件查看、模式切换（Raw / Rendered）、
 * 行号开关、文件内容检索、外部编辑器打开、剪贴板静默复制与原生文件下载另存为。
 * 将原散落在 index.ts 中的文件打开状态机、标签增删以及 DOM 事件绑定完整剥离，
 * 实现 100% 单向依赖注入，使文件预览与工件交互具备轻量纯 Node 行为级可测试性。
 *
 * 【防范的历史坑 (Pitfall)】
 * 1. HTML 原型文档预览必须默认启用 rendered 视图，避免所见即所得变成 HTML 源码展示；
 * 2. 关闭当前处于 active 的文件标签时，必须平滑迁移至第一张存活标签，全部关闭后需自动折叠检查舱；
 * 3. 搜索框连续键入时，render 重新渲染会导致焦点跳动与选区丢失，需在触发重绘后重新对齐光标选区；
 * 4. 原生 SaveDialog 必须支持远程 HTTP 路径直落与 Data URL 二进制反解，避免下载空白文件。
 *
 * 【约束与规则 (Rules)】
 * - 纯单向依赖，严禁反向 import index.ts；
 * - 0 as any，所有状态变更只写 AppState，严格保持单向数据流；
 * - 遵循三要素中文注释规范。
 */

import {
  resolveFileContent,
  type HermesGatewayClient,
} from '@hermes-flux/core';
import type { InspectorTab, I18nKey } from '@hermes-flux/ui';
import type { AppState } from '../state/appState.js';
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
  bindEvents(): void;
}

export function createFileViewerService(deps: FileViewerServiceDeps): FileViewerService {
  const { getState, render, getDesktopApi, getGatewayClient, safeCopyText, t } = deps;

  async function handleOpenFilePreview(filePath: string, previewUrl?: string): Promise<void> {
    const target = (filePath || previewUrl || '').trim();
    if (!target) return;

    const state = getState();
    const desktopApi = getDesktopApi();
    const gatewayClient = getGatewayClient();

    const isHttp = target.startsWith('http://') || target.startsWith('https://');
    const ext = (target.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
    const isHtml = ext === 'html' || ext === 'htm';

    // 1. 自动展开右侧 Inspection Pod
    state.inspectorCollapsed = false;
    state.activeInspectorTab = 'preview';
    state.activeFilePath = target;

    // HTML 单文件原型默认开启富渲染模式，所见即所得
    if (isHtml) {
      state.fileViewMode = 'rendered';
    }

    // 2. 统一调用底层通用文件解析服务组件 (resolveFileContent)
    const initialResolved = await resolveFileContent(target, {
      platformBridge: desktopApi,
      gatewayClient,
      gatewayUrl: state.gatewayUrl,
      messages: state.messages,
      fallbackNotice: `// ${target}\n\n${t('inspector.loadingNotice')}`,
    });

    // 3. 挂载到 state.openFiles
    let existingOpenFile = state.openFiles.find((f) => f.path === target);
    if (!existingOpenFile) {
      existingOpenFile = {
        id: `file-${Date.now()}`,
        path: target,
        content: initialResolved.content,
      };
      state.openFiles.push(existingOpenFile);
    } else {
      existingOpenFile.content = initialResolved.content;
    }

    // 4. 挂载到 state.artifacts
    let existing = state.artifacts.find((a) => a.name === target);
    if (!existing) {
      existing = {
        id: `art-${Date.now()}`,
        name: target,
        type: isHttp ? 'LINK' : 'FILE',
        size: '',
        preview: initialResolved.content,
      };
      state.artifacts.unshift(existing);
    } else {
      existing.preview = initialResolved.content;
      state.artifacts = [existing, ...state.artifacts.filter((a) => a.name !== target)];
    }

    render();

    // 5. 若首次未从缓存或本地读取到，进行异步最终获取并刷新
    if (initialResolved.source === 'fallback') {
      const finalResolved = await resolveFileContent(target, {
        platformBridge: desktopApi,
        gatewayClient,
        gatewayUrl: state.gatewayUrl,
        messages: state.messages,
        fallbackNotice: `// ${target}\n\n${t('inspector.remoteNotice')}`,
      });

      if (existing) existing.preview = finalResolved.content;
      if (existingOpenFile) existingOpenFile.content = finalResolved.content;
      render();
    }
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
      if (state.openFiles.length === 0) {
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
    if (activeFile) {
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

    // 1. 优先调用桌面端原生 SaveDialog 另存为
    if (desktopApi?.saveFile) {
      try {
        const downloadPayload = isHttp
          ? activeFile.path
          : activeFile.content.includes(t('inspector.remoteNotice')) && state.gatewayUrl
          ? `${state.gatewayUrl}/api/files/download?path=${encodeURIComponent(activeFile.path)}`
          : activeFile.content;

        const res = await desktopApi.saveFile({
          fileName: rawFileName,
          content: downloadPayload,
          isBase64: isDataUrl,
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
        if (res.canceled) return;
      } catch (e) {
        console.warn('[Desktop Save] Native save dialog failed, fallback to blob:', e);
      }
    }

    // 2. Web 浏览器或降级：Blob / Data URL 模拟下载
    if (typeof document !== 'undefined') {
      if (isDataUrl) {
        const a = document.createElement('a');
        a.href = activeFile.content;
        a.download = rawFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
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

    const toggleInspectorClose = document.getElementById('toggle-inspector-close-btn');
    const toggleInspectorFullscreenBtn = document.getElementById('toggle-inspector-fullscreen-btn');
    if (toggleInspectorClose) {
      toggleInspectorClose.onclick = () => closeInspector();
    }
    if (toggleInspectorFullscreenBtn) {
      toggleInspectorFullscreenBtn.onclick = () => toggleInspectorFullscreen();
    }

    // 1. File Tab Switch
    document.querySelectorAll<HTMLElement>('.inspector-file-tab').forEach((tabEl) => {
      tabEl.onclick = (e) => {
        if ((e.target as HTMLElement).closest('.btn-close-file-tab')) return;
        const targetPath = tabEl.dataset.fileTab;
        if (targetPath) switchFileTab(targetPath);
      };
    });

    // 2. File Tab Close
    document.querySelectorAll<HTMLElement>('.btn-close-file-tab').forEach((btnEl) => {
      btnEl.onclick = (e) => {
        e.stopPropagation();
        const targetPath = btnEl.dataset.closeTab;
        if (targetPath) closeFileTab(targetPath);
      };
    });

    // 3. Toolbar: View Mode Toggle
    const btnToggleMode = document.getElementById('btn-file-toggle-mode');
    if (btnToggleMode) {
      btnToggleMode.onclick = () => toggleViewMode();
    }

    // 4. Toolbar: Search Toggle
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

    // 5. Toolbar: Line Numbers Toggle
    const btnToggleLineNo = document.getElementById('btn-file-toggle-lineno');
    if (btnToggleLineNo) {
      btnToggleLineNo.onclick = () => toggleLineNumbers();
    }

    // 6. Toolbar: Open External
    const btnOpenExternal = document.getElementById('btn-file-open-external');
    if (btnOpenExternal) {
      btnOpenExternal.onclick = () => openFileExternal();
    }

    // 7. Toolbar: Copy Full Content
    const btnCopyContent = document.getElementById('btn-file-copy-content');
    if (btnCopyContent) {
      btnCopyContent.onclick = () => copyFileContent();
    }

    // 8. Toolbar: Copy Path
    const btnCopyPath = document.getElementById('btn-file-copy-path');
    if (btnCopyPath) {
      btnCopyPath.onclick = () => copyFilePath();
    }

    // 9. Toolbar: Download / Save File
    const btnDownload = document.getElementById('btn-file-download');
    if (btnDownload) {
      btnDownload.onclick = () => downloadFile();
    }

    // 10. Vertical Tab Item Switch
    document.querySelectorAll('.vertical-tab-item').forEach((tab) => {
      (tab as HTMLElement).onclick = () => {
        const key = (tab as HTMLElement).dataset.tab as InspectorTab;
        if (key) switchInspectorTab(key);
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
    bindEvents,
  };
}
