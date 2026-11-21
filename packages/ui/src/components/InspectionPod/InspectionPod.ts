/**
 * Hermes Flux Streamlined Inspection Pod (v5.0)
 *
 * 【设计意图 (Why)】
 *   1. 右侧常驻无边框融合竖栏 (`#flux-inspector-rail.inspector-vertical-rail`)：
 *      哪怕工具窗收起也常驻右侧，背景与右主画布同色且零边框，与顶栏、对话区融为一体；
 *   2. 悬浮四边框一体工具窗 (`#flux-inspector-pod` 内嵌 `.inspector-floating-window`)：
 *      点击「文件」后贴于右侧竖栏左侧展开为完整四边框圆角悬浮窗，内分左右两栏——
 *      左侧工作区文件树浏览器 + 右侧多标签文件预览器；
 *   3. 100% 遵循 Design Tokens、i18n 键约束、把手单一真值契约与 979 行上限拆分（ helpers 归 `lib/inspectorViewHelpers.ts`）。
 */

import type { FileTreeLoadState } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import {
  detectFileLanguage,
  escapeInspectorHtml,
  renderFileTab,
  renderInspectorFileContent,
  renderInspectorFileTreePane,
  type FileViewMode,
  type InspectorTab,
  type OpenFileItem,
} from '../../lib/inspectorViewHelpers.js';

export type { InspectorTab, FileViewMode, OpenFileItem };

export interface InspectionPodProps {
  collapsed: boolean;
  activeTab?: InspectorTab;
  gatewayConnected: boolean;
  isFullscreen?: boolean;
  // Multi-tab file management
  openFiles?: OpenFileItem[];
  activeFilePath?: string;
  // Preview view options
  viewMode?: FileViewMode;
  showLineNumbers?: boolean;
  wordWrap?: boolean;
  searchOpen?: boolean;
  searchQuery?: string;
  // Unified workspace file tree state
  fileTreeState?: FileTreeLoadState;
  fileTreeExpandedPaths?: readonly string[];
  fileTreeFilterQuery?: string;
  fileTreeCollapsed?: boolean;
  workspaceRootName?: string;
  // Extensible functional tabs (kept for backward prop compatibility; future features added one by one)
  previewFile?: { path: string; content: string; language?: string; isDiff?: boolean };
  artifacts?: Array<{ id: string; name: string; type: string; size: string; preview?: string }>;
  browserFrame?: { url: string; title: string; screenshotUrl?: string };
  gitDiffs?: Array<{ file: string; additions: number; deletions: number; patch?: string }>;
  memories?: Array<{ category: string; content: string; updated?: string }>;
}

function renderVerticalRail(activeTab: InspectorTab, collapsed: boolean): string {
  const isFilesActive = !collapsed && (activeTab === 'preview' || activeTab === 'artifacts');
  return `
    <nav id="flux-inspector-rail" class="inspector-vertical-rail" aria-label="${t('inspector.filesRailTitle')}">
      <button type="button" class="vertical-tab-item ${isFilesActive ? 'active-tab' : ''}" data-tab="preview" title="${t('inspector.filesRailTitle')}" aria-pressed="${isFilesActive ? 'true' : 'false'}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </button>
    </nav>
  `;
}

export function renderInspectionPod(props: InspectionPodProps): string {
  const activeTab: InspectorTab = props.activeTab || 'preview';
  const railHtml = renderVerticalRail(activeTab, props.collapsed);

  if (props.collapsed) {
    return `
      <div id="flux-inspector-shell" class="flux-inspector-shell">
        <aside id="flux-inspector-pod" class="flux-inspector-pod inspector-collapsed" style="width: 0px; min-width: 0px; display: none; overflow: hidden;"></aside>
        ${railHtml}
      </div>
    `;
  }

  const isFullscreen = Boolean(props.isFullscreen);

  let files: OpenFileItem[] = [];
  if (props.openFiles && props.openFiles.length > 0) {
    files = [...props.openFiles];
  } else if (props.artifacts && props.artifacts.length > 0) {
    files = props.artifacts.map((a) => ({
      id: a.id,
      path: a.name,
      content: a.preview || '',
      language: detectFileLanguage(a.name),
    }));
  } else if (props.previewFile) {
    files = [{
      path: props.previewFile.path,
      content: props.previewFile.content,
      language: props.previewFile.language || detectFileLanguage(props.previewFile.path),
      isDiff: props.previewFile.isDiff,
    }];
  }

  let currentFile: OpenFileItem | undefined;
  if (props.activeFilePath) {
    currentFile = files.find((f) => f.path === props.activeFilePath);
  }
  if (!currentFile && files.length > 0) {
    currentFile = files[0];
  }

  const asideStyle = isFullscreen
    ? `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      z-index: 50;
      display: flex;
      flex-direction: row;
      overflow: hidden;
    `
    : `
      flex: 0 0 var(--rail-w-right, 420px);
      width: var(--rail-w-right, 420px);
      min-width: 380px;
      height: 100%;
      display: flex;
      flex-direction: row;
      overflow: hidden;
      position: relative;
    `;

  const viewMode = props.viewMode || 'rendered';
  const showLineNumbers = props.showLineNumbers ?? true;
  const wordWrap = props.wordWrap ?? false;
  const searchOpen = Boolean(props.searchOpen);
  const searchQuery = props.searchQuery || '';
  const treeCollapsed = Boolean(props.fileTreeCollapsed);
  const fileTreeState: FileTreeLoadState = props.fileTreeState ?? { status: 'idle' };
  const isNonPreview = Boolean(currentFile?.isBinary || currentFile?.isTooLarge);
  const textToolDisabledAttr = isNonPreview ? 'disabled' : '';

  const resizeHandleHtml = !isFullscreen
    ? `<!-- Draggable Resize Handle (Inspection Pod Left Edge) -->
             <div class="rail-resize-handle" data-rail-handle="right" role="separator" aria-orientation="vertical" tabindex="0" title="${t('inspector.resizeHandleTitle')}" style="
               position: absolute;
               left: 0;
               top: 0;
               bottom: 0;
               z-index: 60;
               cursor: col-resize;
             "></div>`
    : '';

  const treePaneHtml = !treeCollapsed
    ? renderInspectorFileTreePane({
        fileTreeState,
        expandedPaths: props.fileTreeExpandedPaths ?? [],
        activeFilePath: currentFile?.path || props.activeFilePath || '',
        filterQuery: props.fileTreeFilterQuery || '',
        workspaceRootName: props.workspaceRootName,
      })
    : '';

  const expandTreeBtnHtml = treeCollapsed
    ? `<button type="button" id="btn-file-tree-expand" class="icon-btn" title="${t('inspector.fileTreeExpand')}" style="margin-left: 4px;">
         <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
       </button>`
    : '';

  return `
    <div id="flux-inspector-shell" class="flux-inspector-shell ${isFullscreen ? 'inspector-shell-fullscreen' : ''}">
      <aside id="flux-inspector-pod" class="flux-inspector-pod ${isFullscreen ? 'inspector-fullscreen' : ''}" style="${asideStyle}">
        ${resizeHandleHtml}

        <div class="inspector-floating-window">
          ${treePaneHtml}

          <div class="inspector-work-pane">
            <!-- Row 1: File Tabs Bar + Window Controls -->
            <div class="inspector-tabs-bar">
              ${expandTreeBtnHtml}
              <div class="inspector-tabs-list">
                ${
                  files.length > 0
                    ? files.map((file) => renderFileTab(file, currentFile?.path === file.path)).join('')
                    : `<div class="inspector-empty-tab-hint">${t('inspector.noOpenFiles')}</div>`
                }
              </div>

              <div class="inspector-pane-window-controls">
                <button type="button" id="toggle-inspector-fullscreen-btn" class="icon-btn" title="${isFullscreen ? t('inspector.exitFullscreen') : t('inspector.enterFullscreen')}">
                  ${
                    isFullscreen
                      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
                      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
                  }
                </button>
                <button type="button" id="toggle-inspector-close-btn" class="icon-btn" title="${t('inspector.collapse')}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>

            <!-- Row 2: Secondary Path & File Action Toolbar -->
            <div class="inspector-action-toolbar">
              <div class="inspector-file-path" title="${escapeInspectorHtml(currentFile ? currentFile.path : '')}">
                <span>${escapeInspectorHtml(currentFile ? currentFile.path : '')}</span>
              </div>

              <div class="inspector-toolbar-actions">
                <button type="button" id="btn-file-toggle-mode" class="icon-btn ${viewMode === 'rendered' && !isNonPreview ? 'active-tool-btn' : ''}" title="${viewMode === 'rendered' ? t('inspector.viewRaw') : t('inspector.viewRendered')}" ${textToolDisabledAttr}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button type="button" id="btn-file-search" class="icon-btn ${searchOpen && !isNonPreview ? 'active-tool-btn' : ''}" title="${t('inspector.findInFile')}" ${textToolDisabledAttr}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                <button type="button" id="btn-file-toggle-lineno" class="icon-btn ${showLineNumbers && !isNonPreview ? 'active-tool-btn' : ''}" title="${showLineNumbers ? t('inspector.hideLineNumbers') : t('inspector.showLineNumbers')}" ${textToolDisabledAttr}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
                </button>
                <button type="button" id="btn-file-open-external" class="icon-btn" title="${t('inspector.openExternal')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </button>
                <button type="button" id="btn-file-copy-content" class="icon-btn" title="${t('inspector.copyContent')}" ${textToolDisabledAttr}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
                <button type="button" id="btn-file-copy-path" class="icon-btn" title="${t('inspector.copyPath')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                </button>
                <button type="button" id="btn-file-download" class="icon-btn" title="${t('inspector.download')}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
              </div>
            </div>

            ${
              searchOpen && !isNonPreview
                ? `<div id="inspector-search-container" class="inspector-search-bar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--primary); flex-shrink: 0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input id="inspector-search-input" class="inspector-search-input" type="text" placeholder="${t('inspector.searchPlaceholder')}" value="${escapeInspectorHtml(searchQuery)}" />
                    <button type="button" id="btn-close-search" class="icon-btn" title="${t('inspector.closeSearch')}">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>`
                : ''
            }

            <div class="inspector-content-pane">
              ${
                currentFile
                  ? renderInspectorFileContent(currentFile, { viewMode, showLineNumbers, wordWrap, searchQuery })
                  : `<div class="inspector-empty-preview">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.4;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <div class="inspector-empty-preview-title">${t('inspector.noFile')}</div>
                      <div class="inspector-empty-preview-sub">${t('inspector.selectFilePrompt')}</div>
                    </div>`
              }
            </div>
          </div>
        </div>
      </aside>
      ${railHtml}
    </div>
  `;
}
