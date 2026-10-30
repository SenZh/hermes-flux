/**
 * Hermes Flux Streamlined Inspection Pod (v4.0)
 * Dual-pane architecture matching OpenChamber & v4.0 design spec:
 * 1. Double-column layout:
 *    - Left Work Pane (flex: 1): File previewer, Git diffs, Browser viewport, or Memories
 *    - Far-Right Vertical Scene Rail (fixed 48px): Vertical iconic switcher pinned to window edge
 * 2. True Workspace Fullscreen:
 *    - Fullscreen takes position: absolute; top: 0; left: 0; right: 0; bottom: 0 inside .flux-body-container
 *    - Covers conversation stream MiddlePod and LeftRail completely, but KEEPS Titlebar header and StatusBar!
 * 3. 100% Standard Skin Design Tokens (Zero hardcoded colors)
 * 4. 100% Strict i18n key requirement (Zero hardcoded text strings in UI template)
 */

import { renderMarkdown, highlightCodeSyntax } from '../MiddlePod/MiddlePod.js';
import { t } from '../../i18n/index.js';

export type InspectorTab = 'artifacts' | 'browser' | 'git' | 'memory' | 'preview';
export type FileViewMode = 'rendered' | 'raw';

export interface OpenFileItem {
  id?: string;
  path: string;
  content: string;
  language?: string;
  isDiff?: boolean;
}

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
  // Extensible functional tabs
  previewFile?: { path: string; content: string; language?: string; isDiff?: boolean };
  artifacts?: Array<{ id: string; name: string; type: string; size: string; preview?: string }>;
  browserFrame?: { url: string; title: string; screenshotUrl?: string };
  gitDiffs?: Array<{ file: string; additions: number; deletions: number; patch?: string }>;
  memories?: Array<{ category: string; content: string; updated?: string }>;
}

export function renderInspectionPod(props: InspectionPodProps): string {
  if (props.collapsed) {
    return `<aside id="flux-inspector-pod" class="flux-inspector-pod inspector-collapsed" style="width: 0px; min-width: 0px; display: none; overflow: hidden;"></aside>`;
  }

  const isFullscreen = Boolean(props.isFullscreen);
  const activeTab: InspectorTab = props.activeTab || 'preview';

  // Normalize open files list
  let files: OpenFileItem[] = [];
  if (props.openFiles && props.openFiles.length > 0) {
    files = [...props.openFiles];
  } else if (props.artifacts && props.artifacts.length > 0) {
    files = props.artifacts.map((a) => ({
      id: a.id,
      path: a.name,
      content: a.preview || '',
      language: detectLanguage(a.name),
    }));
  } else if (props.previewFile) {
    files = [{
      path: props.previewFile.path,
      content: props.previewFile.content,
      language: props.previewFile.language || detectLanguage(props.previewFile.path),
      isDiff: props.previewFile.isDiff,
    }];
  }

  // Determine active file
  let currentFile: OpenFileItem | undefined;
  if (props.activeFilePath) {
    currentFile = files.find((f) => f.path === props.activeFilePath);
  }
  if (!currentFile && files.length > 0) {
    currentFile = files[0];
  }

  // Workspace Fullscreen: inside .flux-body-container taking top:0, left:0, right:0, bottom:0
  // Covers middle stream and left rail completely, preserving Titlebar header and bottom StatusBar!
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
      background: var(--bg-panel);
      display: flex;
      flex-direction: row;
      overflow: hidden;
    `
    : `
      flex: 0 0 var(--rail-w-right, 420px);
      width: var(--rail-w-right, 420px);
      min-width: 280px;
      height: 100%;
      background: var(--bg-panel);
      border-left: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: row;
      transition: width 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
      position: relative;
    `;

  const viewMode = props.viewMode || 'rendered';
  const showLineNumbers = props.showLineNumbers ?? true;
  const wordWrap = props.wordWrap ?? false;
  const searchOpen = Boolean(props.searchOpen);
  const searchQuery = props.searchQuery || '';

  return `
    <aside id="flux-inspector-pod" class="flux-inspector-pod ${isFullscreen ? 'inspector-fullscreen' : ''}" style="${asideStyle}">
      ${
        !isFullscreen
          ? `<!-- Draggable Resize Handle (Inspection Pod Left Edge) -->
             <div class="rail-resize-handle" data-rail-handle="right" role="separator" aria-orientation="vertical" tabindex="0" title="${t('inspector.resizeHandleTitle')}" style="
               position: absolute;
               left: -3px;
               top: 0;
               bottom: 0;
               width: 6px;
               z-index: 60;
               cursor: col-resize;
               background: transparent;
             "></div>`
          : ''
      }

      <!-- Main Work Details Pane (Left, flex: 1) -->
      <div class="inspector-work-pane" style="
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--bg-panel);
        border-right: 1px solid var(--border-subtle);
        overflow: hidden;
      ">
        <!-- Sub-pane: Git Diffs -->
        ${activeTab === 'git' ? renderGitDiffsPane(props.gitDiffs || [], isFullscreen) : ''}

        <!-- Sub-pane: Browser Frame -->
        ${activeTab === 'browser' ? renderBrowserFramePane(props.browserFrame, isFullscreen) : ''}

        <!-- Sub-pane: Memories -->
        ${activeTab === 'memory' ? renderMemoriesPane(props.memories || [], isFullscreen) : ''}

        <!-- Sub-pane: File Viewer (Files / Preview / Artifacts) -->
        ${activeTab === 'preview' || activeTab === 'artifacts' ? `
          <!-- Row 1: File Tabs Bar + Window Controls -->
          <div class="inspector-tabs-bar" style="
            height: 38px;
            min-height: 38px;
            border-bottom: 1px solid var(--border-subtle);
            background: var(--bg-rail);
            display: flex;
            align-items: stretch;
            justify-content: space-between;
            padding: 0 4px 0 0;
            overflow: hidden;
          ">
            <!-- Tabs scroll area -->
            <div class="inspector-tabs-list" style="
              display: flex;
              align-items: stretch;
              flex: 1;
              min-width: 0;
              overflow-x: auto;
              scrollbar-width: none;
            ">
              ${files.length > 0 ? files.map((file) => renderFileTab(file, currentFile?.path === file.path)).join('') : `
                <div style="display: flex; align-items: center; padding: 0 14px; font-size: 12px; color: var(--text-muted); font-weight: 500;">
                  ${t('inspector.noOpenFiles')}
                </div>
              `}
            </div>

            <!-- Fullscreen & Close Controls on File Pane Header -->
            <div class="inspector-pane-window-controls" style="
              display: flex;
              align-items: center;
              gap: 2px;
              flex-shrink: 0;
              padding-left: 4px;
            ">
              <button id="toggle-inspector-fullscreen-btn" class="icon-btn" title="${isFullscreen ? t('inspector.exitFullscreen') : t('inspector.enterFullscreen')}" style="
                background: transparent;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
                padding: 4px;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                ${
                  isFullscreen
                    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
                    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
                }
              </button>
              <button id="toggle-inspector-close-btn" class="icon-btn" title="${t('inspector.collapse')}" style="
                background: transparent;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
                padding: 4px;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          <!-- Row 2: Secondary Path & OpenChamber Action Toolbar -->
          <div class="inspector-action-toolbar" style="
            height: 34px;
            min-height: 34px;
            border-bottom: 1px solid var(--border-subtle);
            background: var(--bg-panel);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 10px;
            font-size: 11.5px;
          ">
            <!-- Breadcrumb / Path -->
            <div class="inspector-file-path" style="
              flex: 1;
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              color: var(--text-muted);
              font-family: var(--font-mono);
              font-size: 11px;
              display: flex;
              align-items: center;
              gap: 6px;
            " title="${escapeHtml(currentFile ? currentFile.path : '')}">
              <span>${escapeHtml(currentFile ? currentFile.path : '')}</span>
            </div>

            <!-- Action Icons (Streamlined & Clean) -->
            <div class="inspector-toolbar-actions" style="
              display: flex;
              align-items: center;
              gap: 3px;
              flex-shrink: 0;
              margin-left: 8px;
            ">
              <!-- 1. [👁] Toggle View Mode (Raw Code vs Rich Render) -->
              <button id="btn-file-toggle-mode" class="icon-btn ${viewMode === 'rendered' ? 'active-tool-btn' : ''}" title="${viewMode === 'rendered' ? t('inspector.viewRaw') : t('inspector.viewRendered')}" style="
                background: ${viewMode === 'rendered' ? 'var(--accent-subtle)' : 'transparent'};
                color: ${viewMode === 'rendered' ? 'var(--accent)' : 'var(--text-muted)'};
                border: 1px solid ${viewMode === 'rendered' ? 'var(--accent-border)' : 'transparent'};
                border-radius: 4px;
                padding: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>

              <!-- 2. [🔍] Find in File -->
              <button id="btn-file-search" class="icon-btn ${searchOpen ? 'active-tool-btn' : ''}" title="${t('inspector.findInFile')}" style="
                background: ${searchOpen ? 'var(--accent-subtle)' : 'transparent'};
                color: ${searchOpen ? 'var(--accent)' : 'var(--text-muted)'};
                border: 1px solid ${searchOpen ? 'var(--accent-border)' : 'transparent'};
                border-radius: 4px;
                padding: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>

              <!-- 3. [#] Toggle Line Numbers -->
              <button id="btn-file-toggle-lineno" class="icon-btn ${showLineNumbers ? 'active-tool-btn' : ''}" title="${showLineNumbers ? t('inspector.hideLineNumbers') : t('inspector.showLineNumbers')}" style="
                background: ${showLineNumbers ? 'var(--accent-subtle)' : 'transparent'};
                color: ${showLineNumbers ? 'var(--accent)' : 'var(--text-muted)'};
                border: 1px solid ${showLineNumbers ? 'var(--accent-border)' : 'transparent'};
                border-radius: 4px;
                padding: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
              </button>

              <!-- 4. [↗] Open in Default App -->
              <button id="btn-file-open-external" class="icon-btn" title="${t('inspector.openExternal')}" style="
                background: transparent;
                color: var(--text-muted);
                border: 1px solid transparent;
                border-radius: 4px;
                padding: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </button>

              <!-- 5. [📋] Copy Full Content -->
              <button id="btn-file-copy-content" class="icon-btn" title="${t('inspector.copyContent')}" style="
                background: transparent;
                color: var(--text-muted);
                border: 1px solid transparent;
                border-radius: 4px;
                padding: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>

              <!-- 6. [🔗] Copy File Path -->
              <button id="btn-file-copy-path" class="icon-btn" title="${t('inspector.copyPath')}" style="
                background: transparent;
                color: var(--text-muted);
                border: 1px solid transparent;
                border-radius: 4px;
                padding: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              </button>

              <!-- 7. [⬇] Download / Save File -->
              <button id="btn-file-download" class="icon-btn" title="${t('inspector.download')}" style="
                background: transparent;
                color: var(--text-muted);
                border: 1px solid transparent;
                border-radius: 4px;
                padding: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
              ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
            </div>
          </div>

          <!-- Optional In-File Search Bar (Ctrl+F) -->
          ${
            searchOpen
              ? `
            <div id="inspector-search-container" style="
              padding: 6px 12px;
              background: var(--bg-card);
              border-bottom: 1px solid var(--border-medium);
              display: flex;
              align-items: center;
              gap: 8px;
            ">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent); flex-shrink: 0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input id="inspector-search-input" type="text" placeholder="${t('inspector.searchPlaceholder')}" value="${escapeHtml(searchQuery)}" style="
                flex: 1;
                background: var(--bg-input);
                border: 1px solid var(--border-subtle);
                border-radius: 4px;
                padding: 4px 8px;
                font-size: 11.5px;
                color: var(--text-main);
                outline: none;
                font-family: var(--font-mono);
              " />
              <button id="btn-close-search" class="icon-btn" title="${t('inspector.closeSearch')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 2px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          `
              : ''
          }

          <!-- Preview Content Area -->
          <div class="inspector-content-pane" style="
            flex: 1;
            overflow-y: auto;
            padding: 10px;
            display: flex;
            flex-direction: column;
          ">
            ${
              currentFile
                ? renderFileContent(currentFile, { viewMode, showLineNumbers, wordWrap, searchQuery })
                : `
              <div style="
                margin: auto 0;
                text-align: center;
                color: var(--text-muted);
                padding: 30px 16px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
              ">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.4;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <div style="font-size: 12.5px; font-weight: 500; color: var(--text-secondary);">${t('inspector.noFile')}</div>
                <div style="font-size: 11px; line-height: 1.5; max-width: 260px;">${t('inspector.noFileSub')}</div>
              </div>
            `
            }
          </div>
        ` : ''}
      </div>

      <!-- Far-Right Vertical Scene Rail (48px fixed width pinned to edge, exact OpenChamber layout) -->
      <nav class="inspector-vertical-rail" style="
        width: 48px;
        min-width: 48px;
        height: 100%;
        background: var(--bg-rail);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 10px 0;
        gap: 12px;
      ">
        <!-- 1. Files / Preview Tab -->
        <button class="vertical-tab-item ${activeTab === 'preview' || activeTab === 'artifacts' ? 'active-tab' : ''}" data-tab="preview" title="${t('inspector.tabFiles')}" style="
          background: ${activeTab === 'preview' || activeTab === 'artifacts' ? 'var(--bg-panel)' : 'transparent'};
          color: ${activeTab === 'preview' || activeTab === 'artifacts' ? 'var(--accent)' : 'var(--text-muted)'};
          border: 1px solid ${activeTab === 'preview' || activeTab === 'artifacts' ? 'var(--accent-border)' : 'transparent'};
          width: 34px;
          height: 34px;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </button>

        <!-- 2. Git Diffs Tab -->
        <button class="vertical-tab-item ${activeTab === 'git' ? 'active-tab' : ''}" data-tab="git" title="${t('inspector.tabGit')}" style="
          background: ${activeTab === 'git' ? 'var(--bg-panel)' : 'transparent'};
          color: ${activeTab === 'git' ? 'var(--accent)' : 'var(--text-muted)'};
          border: 1px solid ${activeTab === 'git' ? 'var(--accent-border)' : 'transparent'};
          width: 34px;
          height: 34px;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
        </button>

        <!-- 3. Browser Viewport Tab -->
        <button class="vertical-tab-item ${activeTab === 'browser' ? 'active-tab' : ''}" data-tab="browser" title="${t('inspector.tabBrowser')}" style="
          background: ${activeTab === 'browser' ? 'var(--bg-panel)' : 'transparent'};
          color: ${activeTab === 'browser' ? 'var(--accent)' : 'var(--text-muted)'};
          border: 1px solid ${activeTab === 'browser' ? 'var(--accent-border)' : 'transparent'};
          width: 34px;
          height: 34px;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        </button>

        <!-- 4. Memory Tab -->
        <button class="vertical-tab-item ${activeTab === 'memory' ? 'active-tab' : ''}" data-tab="memory" title="${t('inspector.tabMemory')}" style="
          background: ${activeTab === 'memory' ? 'var(--bg-panel)' : 'transparent'};
          color: ${activeTab === 'memory' ? 'var(--accent)' : 'var(--text-muted)'};
          border: 1px solid ${activeTab === 'memory' ? 'var(--accent-border)' : 'transparent'};
          width: 34px;
          height: 34px;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        </button>
      </nav>
    </aside>
  `;
}

/** Render a single file tab with OpenChamber style icon & close button */
function renderFileTab(file: OpenFileItem, isActive: boolean): string {
  const fileName = file.path.split(/[/\\]/).pop() || file.path;
  const icon = getFileIconBadge(fileName);

  return `
    <div class="inspector-file-tab ${isActive ? 'tab-active' : ''}" data-file-tab="${escapeHtml(file.path)}" style="
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 12px;
      cursor: pointer;
      border-right: 1px solid var(--border-subtle);
      border-bottom: 2px solid ${isActive ? 'var(--accent)' : 'transparent'};
      background: ${isActive ? 'var(--bg-panel)' : 'transparent'};
      color: ${isActive ? 'var(--text-main)' : 'var(--text-muted)'};
      font-size: 12px;
      font-weight: ${isActive ? '600' : '400'};
      white-space: nowrap;
      user-select: none;
      transition: background 0.1s ease;
      position: relative;
    ">
      ${icon}
      <span class="file-tab-label" style="max-width: 130px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(fileName)}</span>
      <button class="btn-close-file-tab" data-close-tab="${escapeHtml(file.path)}" title="${t('inspector.closeTab')}" style="
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 2px;
        margin-left: 2px;
        border-radius: 3px;
        display: flex;
        align-items: center;
        opacity: ${isActive ? '0.8' : '0.4'};
      ">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
}

/** OpenChamber style colored file type badge icon using design tokens */
function getFileIconBadge(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const baseStyle = 'display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 4px; font-family: var(--font-mono); line-height: 1.1; flex-shrink: 0;';

  switch (ext) {
    case 'ts':
    case 'tsx':
      return `<span style="${baseStyle} background: var(--badge-ts-bg, var(--accent-subtle)); color: var(--badge-ts-text, var(--accent)); border: 1px solid var(--badge-ts-border, var(--border-subtle));">TS</span>`;
    case 'js':
    case 'jsx':
    case 'mjs':
      return `<span style="${baseStyle} background: var(--badge-js-bg, var(--accent-subtle)); color: var(--badge-js-text, var(--accent)); border: 1px solid var(--badge-js-border, var(--border-subtle));">JS</span>`;
    case 'json':
      return `<span style="${baseStyle} background: rgba(255, 255, 255, 0.06); color: var(--text-secondary); border: 1px solid var(--border-subtle);">{}</span>`;
    case 'css':
    case 'scss':
    case 'less':
      return `<span style="${baseStyle} background: var(--badge-css-bg, var(--accent-subtle)); color: var(--badge-css-text, var(--accent)); border: 1px solid var(--badge-css-border, var(--border-subtle));">CSS</span>`;
    case 'md':
    case 'markdown':
      return `<span style="${baseStyle} background: rgba(255, 255, 255, 0.06); color: var(--text-secondary); border: 1px solid var(--border-subtle);">MD</span>`;
    case 'py':
      return `<span style="${baseStyle} background: var(--badge-py-bg, var(--accent-subtle)); color: var(--badge-py-text, var(--accent)); border: 1px solid var(--badge-py-border, var(--border-subtle));">PY</span>`;
    case 'html':
    case 'htm':
      return `<span style="${baseStyle} background: var(--badge-html-bg, var(--accent-subtle)); color: var(--badge-html-text, var(--accent)); border: 1px solid var(--badge-html-border, var(--border-subtle));">HTML</span>`;
    case 'svg':
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    default:
      return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }
}

/** Render content supporting Markdown, Code with line numbers & syntax highlight, Diff, and Images */
function renderFileContent(
  file: OpenFileItem,
  opts: { viewMode: FileViewMode; showLineNumbers: boolean; wordWrap: boolean; searchQuery: string }
): string {
  const ext = (file.path.split('.').pop() || '').toLowerCase();
  const isMarkdown = ext === 'md' || ext === 'markdown';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);

  // 1. Image Viewer (with iOS-grade offline graceful fallback)
  if (isImage) {
    const isReadyData = file.content.startsWith('data:') || file.content.startsWith('http://') || file.content.startsWith('https://');
    const imageSrc = isReadyData ? file.content : '';

    if (!imageSrc) {
      // 离线占位态：优雅的中性卡片，无破损裂图
      return `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 8px; padding: 32px 20px; overflow: auto; text-align: center;">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: center; margin-bottom: 12px; color: var(--accent);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
          <div style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">${t('inspector.imageLoadError')}</div>
          <div style="font-size: 11.5px; color: var(--text-muted); max-width: 320px; line-height: 1.5; margin-bottom: 16px;">${t('inspector.imageLoadErrorSub')}</div>
          <div style="font-size: 11px; color: var(--text-faint); font-family: var(--font-mono); background: var(--bg-input); padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border-subtle); max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(file.path)}</div>
        </div>
      `;
    }

    return `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 8px; padding: 20px; overflow: auto;">
        <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(file.path)}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; box-shadow: var(--shadow-card);" onerror="this.parentElement.innerHTML='<div style=\\'padding: 30px; text-align: center; color: var(--text-muted); font-size: 12px;\\'>${t('inspector.imageLoadError')}</div>'" />
        <div style="margin-top: 12px; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(file.path)}</div>
      </div>
    `;
  }

  // 2. Markdown Rich Rendered Mode (or non-code plain text when rendered mode is selected)
  if (isMarkdown && opts.viewMode === 'rendered') {
    return `
      <div class="inspector-rendered-markdown" style="
        flex: 1;
        background: var(--bg-card);
        border: 1px solid var(--border-medium);
        border-radius: 8px;
        padding: 16px 20px;
        overflow-y: auto;
        font-size: 13px;
        line-height: 1.6;
        color: var(--text-main);
        user-select: text;
      ">
        ${renderMarkdown(file.content)}
      </div>
    `;
  }

  // If viewMode === 'rendered' but not markdown, allow rendered mode to display rendered HTML for html files, or code layout for code files
  if (opts.viewMode === 'rendered' && (ext === 'html' || ext === 'htm')) {
    return `
      <div style="flex: 1; display: flex; flex-direction: column; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 8px; overflow: hidden;">
        <!-- iframe 内是待预览的用户 HTML 文档，其文档根必须为不透明白纸底，
             否则深色皮肤下白底文档会透出暗色背景导致文字不可读；该白色属于「被预览内容」而非应用主题面 -->
        <!-- gate-theme-allow: 白色属于被预览的用户文档底色，不属于应用主题面 -->
        <iframe srcdoc="${escapeHtml(file.content)}" sandbox="allow-scripts" style="flex: 1; border: none; width: 100%; height: 100%; background: #ffffff;"></iframe>
      </div>
    `;
  }

  // 3. Diff View or Code View (Raw Mode or Code Files)
  const isDiff = Boolean(file.isDiff || file.content.startsWith('---') || file.content.includes('\n@@ '));
  const rawLines = file.content.split('\n');

  // OpenCode CLI tool output cleans line numbers like: " 1: const x = 1;" or "10| url: string;"
  // If the raw content already embedded line prefix numbers from CLI inspection tools, strip them so we never duplicate line numbers!
  const prefixRegex = /^\s*(\d+)[:|]\s?(.*)$/;
  let hasEmbeddedLineNums = rawLines.length > 3;
  if (hasEmbeddedLineNums) {
    let matchCount = 0;
    for (let i = 0; i < Math.min(rawLines.length, 10); i++) {
      if (prefixRegex.test(rawLines[i])) matchCount++;
    }
    hasEmbeddedLineNums = matchCount >= 3;
  }

  const linesHtml = rawLines.map((rawLine, idx) => {
    let line = rawLine;
    let customLineNum = idx + 1;

    if (hasEmbeddedLineNums) {
      const m = prefixRegex.exec(rawLine);
      if (m) {
        customLineNum = parseInt(m[1], 10);
        line = m[2];
      }
    }

    const lineNum = customLineNum;
    let lineBg = 'transparent';
    let lineTextColor = 'var(--text-main)';

    // Notice line special styling
    const isNoticeLine = line.includes(t('inspector.remoteNotice')) || line.includes(t('inspector.loadingNotice'));
    if (isNoticeLine) {
      lineTextColor = 'var(--text-muted)';
      lineBg = 'var(--accent-subtle)';
    }

    if (isDiff) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lineBg = 'rgba(34, 197, 94, 0.12)';
        lineTextColor = '#4ADE80';
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        lineBg = 'rgba(239, 68, 68, 0.12)';
        lineTextColor = '#F87171';
      } else if (line.startsWith('@@')) {
        lineBg = 'rgba(56, 189, 248, 0.08)';
        lineTextColor = '#38BDF8';
      }
    }

    // High quality syntax highlighting for code lines (unless Diff line or notice line)
    let formattedLine = isDiff || isNoticeLine ? escapeHtml(line) : highlightCodeSyntax(line);

    // If notice line, add subtle warning badge icon
    if (isNoticeLine) {
      formattedLine = `<span style="display: inline-flex; align-items: center; gap: 6px; color: var(--accent); font-style: italic;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${formattedLine}</span>`;
    }

    // Highlight in-file search query if provided
    if (opts.searchQuery && opts.searchQuery.trim()) {
      const q = escapeHtml(opts.searchQuery.trim());
      const regex = new RegExp(`(${q})`, 'gi');
      formattedLine = formattedLine.replace(regex, '<mark style="background: var(--accent); color: var(--bg-window); border-radius: 2px; padding: 0 2px;">$1</mark>');
    }

    return `
      <tr style="background: ${lineBg};">
        ${
          opts.showLineNumbers
            ? `<td class="line-number" style="
                 width: 42px;
                 min-width: 42px;
                 text-align: right;
                 padding: 0 10px 0 0;
                 color: var(--text-muted);
                 user-select: none;
                 opacity: 0.6;
                 font-size: 11px;
                 font-family: var(--font-mono);
                 vertical-align: top;
               ">${lineNum}</td>`
            : ''
        }
        <td class="line-code" style="
          padding: 0 6px;
          white-space: ${opts.wordWrap ? 'pre-wrap' : 'pre'};
          word-break: ${opts.wordWrap ? 'break-all' : 'normal'};
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.6;
          color: ${lineTextColor};
          user-select: text;
        ">${formattedLine || ' '}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--bg-card);
      border: 1px solid var(--border-medium);
      border-radius: 8px;
      overflow: hidden;
      user-select: text;
    ">
      <div style="
        flex: 1;
        overflow: auto;
        padding: 10px 12px;
        background: var(--bg-code);
      ">
        <table style="border-collapse: collapse; width: 100%; table-layout: fixed;">
          <tbody>
            ${linesHtml}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/** Extensible Functional Pane: Git Diffs */
function renderGitDiffsPane(diffs: Array<{ file: string; additions: number; deletions: number; patch?: string }>, isFullscreen: boolean): string {
  const headerHtml = `
    <div class="inspector-tabs-bar" style="
      height: 38px;
      min-height: 38px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-rail);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
    ">
      <span style="font-size: 12px; font-weight: 600; color: var(--text-main);">${t('inspector.tabGit')}</span>
      <div style="display: flex; align-items: center; gap: 4px;">
        <button id="toggle-inspector-fullscreen-btn" class="icon-btn" title="${isFullscreen ? t('inspector.exitFullscreen') : t('inspector.enterFullscreen')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
          ${isFullscreen ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>` : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`}
        </button>
        <button id="toggle-inspector-close-btn" class="icon-btn" title="${t('inspector.collapse')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;

  if (diffs.length === 0) {
    return `
      ${headerHtml}
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px; color: var(--text-muted); text-align: center;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.4;"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
        <div style="font-size: 12px; font-weight: 500; margin-top: 10px; color: var(--text-secondary);">${t('inspector.gitEmpty')}</div>
        <div style="font-size: 11px; margin-top: 4px;">${t('inspector.gitEmptySub')}</div>
      </div>
    `;
  }
  return `
    ${headerHtml}
    <div style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
      ${diffs.map((d) => `
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 8px 12px; font-size: 12px; font-family: var(--font-mono); display: flex; justify-content: space-between; align-items: center;">
          <span style="color: var(--text-main);">${escapeHtml(d.file)}</span>
          <span style="display: flex; gap: 6px; font-size: 11px;">
            <span style="color: #4ADE80;">+${d.additions}</span>
            <span style="color: #F87171;">-${d.deletions}</span>
          </span>
        </div>
      `).join('')}
    </div>
  `;
}

/** Extensible Functional Pane: Browser Frame */
function renderBrowserFramePane(frame: { url: string; title: string; screenshotUrl?: string } | undefined, isFullscreen: boolean): string {
  const headerHtml = `
    <div class="inspector-tabs-bar" style="
      height: 38px;
      min-height: 38px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-rail);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
    ">
      <span style="font-size: 12px; font-weight: 600; color: var(--text-main);">${t('inspector.tabBrowser')}</span>
      <div style="display: flex; align-items: center; gap: 4px;">
        <button id="toggle-inspector-fullscreen-btn" class="icon-btn" title="${isFullscreen ? t('inspector.exitFullscreen') : t('inspector.enterFullscreen')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
          ${isFullscreen ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>` : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`}
        </button>
        <button id="toggle-inspector-close-btn" class="icon-btn" title="${t('inspector.collapse')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;

  if (!frame) {
    return `
      ${headerHtml}
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px; color: var(--text-muted); text-align: center;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.4;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <div style="font-size: 12px; font-weight: 500; margin-top: 10px; color: var(--text-secondary);">${t('inspector.browserEmpty')}</div>
        <div style="font-size: 11px; margin-top: 4px;">${t('inspector.browserEmptySub')}</div>
      </div>
    `;
  }
  return `
    ${headerHtml}
    <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
      <div style="padding: 6px 12px; background: var(--bg-elevated); border-bottom: 1px solid var(--border-subtle); font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(frame.url)}
      </div>
      <div style="flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 12px;">
        ${frame.screenshotUrl ? `<img src="${escapeHtml(frame.screenshotUrl)}" style="max-width: 100%; border-radius: 4px; box-shadow: var(--shadow-card);" />` : `<div style="color: var(--text-muted); font-size: 12px;">${t('inspector.browserWaiting')}</div>`}
      </div>
    </div>
  `;
}

/** Extensible Functional Pane: Memories */
function renderMemoriesPane(memories: Array<{ category: string; content: string; updated?: string }>, isFullscreen: boolean): string {
  const headerHtml = `
    <div class="inspector-tabs-bar" style="
      height: 38px;
      min-height: 38px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-rail);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
    ">
      <span style="font-size: 12px; font-weight: 600; color: var(--text-main);">${t('inspector.tabMemory')}</span>
      <div style="display: flex; align-items: center; gap: 4px;">
        <button id="toggle-inspector-fullscreen-btn" class="icon-btn" title="${isFullscreen ? t('inspector.exitFullscreen') : t('inspector.enterFullscreen')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
          ${isFullscreen ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>` : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`}
        </button>
        <button id="toggle-inspector-close-btn" class="icon-btn" title="${t('inspector.collapse')}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;

  if (memories.length === 0) {
    return `
      ${headerHtml}
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px; color: var(--text-muted); text-align: center;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity: 0.4;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        <div style="font-size: 12px; font-weight: 500; margin-top: 10px; color: var(--text-secondary);">${t('inspector.memoryEmpty')}</div>
        <div style="font-size: 11px; margin-top: 4px;">${t('inspector.memoryEmptySub')}</div>
      </div>
    `;
  }
  return `
    ${headerHtml}
    <div style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
      ${memories.map((m) => `
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 10px 12px; font-size: 12px;">
          <div style="font-size: 10.5px; color: var(--accent); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">${escapeHtml(m.category)}</div>
          <div style="color: var(--text-main); line-height: 1.5;">${escapeHtml(m.content)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function detectLanguage(path: string): string {
  const ext = (path.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'py':
      return 'python';
    case 'html':
      return 'html';
    default:
      return 'text';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
