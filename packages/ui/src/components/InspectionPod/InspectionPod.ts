/**
 * Hermes Flux Streamlined File Previewer Pod (v4.0)
 * Width: 420px (resizable), collapsible to 0px (Shortcut: Cmd/Ctrl+\)
 * Multi-tab file viewer with rich rendering (Markdown/Code/Diff), syntax highlighting,
 * and high-density productivity toolbar matching OpenChamber aesthetics.
 */

import { renderMarkdown } from '../MiddlePod/MiddlePod.js';

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
  // Legacy single file fallback
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

  const asideStyle = isFullscreen
    ? `
      position: absolute;
      top: 42px;
      left: 0;
      right: 0;
      bottom: 22px;
      z-index: 50;
      background: var(--bg-panel);
      display: flex;
      flex-direction: column;
      user-select: none;
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
      flex-direction: column;
      user-select: none;
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
             <div class="rail-resize-handle" data-rail-handle="right" role="separator" aria-orientation="vertical" tabindex="0" title="拖拽调整右侧栏宽度 · 双击复位" style="
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

      <!-- Row 1: File Tabs Bar + Window Controls -->
      <div class="inspector-tabs-bar" style="
        height: 38px;
        min-height: 38px;
        border-bottom: 1px solid var(--border-subtle);
        background: var(--bg-surface-0, #090A0F);
        display: flex;
        align-items: stretch;
        justify-content: space-between;
        padding: 0 8px 0 0;
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
              暂无打开的文件
            </div>
          `}
        </div>

        <!-- Window & Layout Controls -->
        <div class="inspector-window-controls" style="
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
          padding-left: 6px;
          border-left: 1px solid var(--border-subtle);
        ">
          <button id="toggle-inspector-fullscreen-btn" class="icon-btn" title="${isFullscreen ? '退出全屏预览 (Esc)' : '全屏预览文件'}" style="
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 5px;
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
          <button id="toggle-inspector-close-btn" class="icon-btn" title="折叠右侧栏 (Ctrl+\\)" style="
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 5px;
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
        background: var(--bg-surface-1, #111318);
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

        <!-- 10 Action Icons in OpenChamber Style -->
        <div class="inspector-toolbar-actions" style="
          display: flex;
          align-items: center;
          gap: 3px;
          flex-shrink: 0;
          margin-left: 8px;
        ">
          <!-- 1. [👁] Toggle View Mode (Raw Code vs Rich Render) -->
          <button id="btn-file-toggle-mode" class="icon-btn ${viewMode === 'rendered' ? 'active-tool-btn' : ''}" title="${viewMode === 'rendered' ? '切换为纯文本源码 (Raw)' : '切换为富渲染视图 (Rendered)'}" style="
            background: ${viewMode === 'rendered' ? 'var(--accent-subtle, rgba(245,158,11,0.15))' : 'transparent'};
            color: ${viewMode === 'rendered' ? 'var(--accent, #F59E0B)' : 'var(--text-muted)'};
            border: 1px solid ${viewMode === 'rendered' ? 'var(--accent-border, rgba(245,158,11,0.35))' : 'transparent'};
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
          <button id="btn-file-search" class="icon-btn ${searchOpen ? 'active-tool-btn' : ''}" title="文件内查找 (Ctrl+F)" style="
            background: ${searchOpen ? 'var(--accent-subtle, rgba(245,158,11,0.15))' : 'transparent'};
            color: ${searchOpen ? 'var(--accent, #F59E0B)' : 'var(--text-muted)'};
            border: 1px solid ${searchOpen ? 'var(--accent-border, rgba(245,158,11,0.35))' : 'transparent'};
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
          <button id="btn-file-toggle-lineno" class="icon-btn ${showLineNumbers ? 'active-tool-btn' : ''}" title="${showLineNumbers ? '隐藏行号' : '显示行号'}" style="
            background: ${showLineNumbers ? 'var(--accent-subtle, rgba(245,158,11,0.12))' : 'transparent'};
            color: ${showLineNumbers ? 'var(--accent, #F59E0B)' : 'var(--text-muted)'};
            border: 1px solid ${showLineNumbers ? 'var(--accent-border, rgba(245,158,11,0.3))' : 'transparent'};
            border-radius: 4px;
            padding: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
          </button>

          <!-- 4. [{}] Format / Prettify Code -->
          <button id="btn-file-prettify" class="icon-btn" title="美化/格式化代码 (Format JSON/Code)" style="
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7c0-1.5 1-2 2-2h1c1 0 1.5-.5 1.5-1.5S8 2 7 2H6C3.8 2 2 3.8 2 6v2c0 1.5-.5 2-1.5 2h-.5v2h.5c1 0 1.5.5 1.5 2v2c0 2.2 1.8 4 4 4h1c1 0 1.5-.5 1.5-1.5S8 21 7 21H6c-1 0-2-.5-2-2v-1"/><path d="M20 7c0-1.5-1-2-2-2h-1c-1 0-1.5-.5-1.5-1.5S16 2 17 2h1c2.2 0 4 3.8 4 6v2c0 1.5.5 2 1.5 2h.5v2h-.5c-1 0-1.5.5-1.5 2v2c0 2.2-1.8 4-4 4h-1c-1 0-1.5-.5-1.5-1.5S16 21 17 21h1c1 0 2-.5 2-2v-1"/></svg>
          </button>

          <!-- 5. [↩] Toggle Word Wrap -->
          <button id="btn-file-toggle-wrap" class="icon-btn ${wordWrap ? 'active-tool-btn' : ''}" title="${wordWrap ? '禁用自动换行' : '开启自动换行'}" style="
            background: ${wordWrap ? 'var(--accent-subtle, rgba(245,158,11,0.12))' : 'transparent'};
            color: ${wordWrap ? 'var(--accent, #F59E0B)' : 'var(--text-muted)'};
            border: 1px solid ${wordWrap ? 'var(--accent-border, rgba(245,158,11,0.3))' : 'transparent'};
            border-radius: 4px;
            padding: 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>
          </button>

          <!-- 6. [💬] Quote to Chat / Ask Agent -->
          <button id="btn-file-quote-chat" class="icon-btn" title="在对话中引用此文件向 Agent 提问" style="
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>

          <!-- 7. [↗] Open Externally in Editor -->
          <button id="btn-file-open-external" class="icon-btn" title="在本地默认外部编辑器打开" style="
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

          <!-- 8. [📋] Copy Full Content -->
          <button id="btn-file-copy-content" class="icon-btn" title="复制文件全部内容" style="
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

          <!-- 9. [🔗] Copy File Path -->
          <button id="btn-file-copy-path" class="icon-btn" title="复制文件路径" style="
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

          <!-- 10. [⬇] Download / Save File -->
          <button id="btn-file-download" class="icon-btn" title="保存/另存为本地文件" style="
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
          background: var(--bg-card, #151720);
          border-bottom: 1px solid var(--border-medium);
          display: flex;
          align-items: center;
          gap: 8px;
        ">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent); flex-shrink: 0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="inspector-search-input" type="text" placeholder="在当前文件中搜索..." value="${escapeHtml(searchQuery)}" style="
            flex: 1;
            background: var(--bg-input, #12141A);
            border: 1px solid var(--border-subtle);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 11.5px;
            color: var(--text-main);
            outline: none;
            font-family: var(--font-mono);
          " />
          <button id="btn-close-search" class="icon-btn" title="关闭搜索" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 2px;">
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
            <div style="font-size: 12.5px; font-weight: 500; color: var(--text-secondary);">暂无正在预览的文件</div>
            <div style="font-size: 11px; line-height: 1.5; max-width: 260px;">点击对话流中的文件路径或工具执行结果，即可在此处实时查看文件代码、Markdown 渲染与改动</div>
          </div>
        `
        }
      </div>
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
      border-bottom: 2px solid ${isActive ? 'var(--accent, #00E5FF)' : 'transparent'};
      background: ${isActive ? 'var(--bg-panel, #111318)' : 'transparent'};
      color: ${isActive ? 'var(--text-main, #F8FAFC)' : 'var(--text-muted)'};
      font-size: 12px;
      font-weight: ${isActive ? '600' : '400'};
      white-space: nowrap;
      user-select: none;
      transition: background 0.1s ease;
      position: relative;
    ">
      ${icon}
      <span class="file-tab-label" style="max-width: 130px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(fileName)}</span>
      <button class="btn-close-file-tab" data-close-tab="${escapeHtml(file.path)}" title="关闭标签页" style="
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

/** OpenChamber style colored file type badge icon */
function getFileIconBadge(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  switch (ext) {
    case 'ts':
    case 'tsx':
      return `<span style="background: #3178C6; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 3px; border-radius: 3px; font-family: var(--font-mono); line-height: 1;">TS</span>`;
    case 'js':
    case 'jsx':
    case 'mjs':
      return `<span style="background: #F7DF1E; color: #000; font-size: 9px; font-weight: 700; padding: 1px 3px; border-radius: 3px; font-family: var(--font-mono); line-height: 1;">JS</span>`;
    case 'json':
      return `<span style="color: #F59E0B; font-size: 11px; font-weight: 700; font-family: var(--font-mono); line-height: 1;">{}</span>`;
    case 'css':
    case 'scss':
    case 'less':
      return `<span style="background: #7C3AED; color: #fff; font-size: 8.5px; font-weight: 700; padding: 1px 3px; border-radius: 3px; font-family: var(--font-mono); line-height: 1;">CSS</span>`;
    case 'md':
    case 'markdown':
      return `<span style="color: #38BDF8; font-size: 10px; font-weight: 700; font-family: var(--font-mono); line-height: 1; display: inline-flex; align-items: center; gap: 1px;">M<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></span>`;
    case 'py':
      return `<span style="background: #3776AB; color: #FFD43B; font-size: 9px; font-weight: 700; padding: 1px 3px; border-radius: 3px; font-family: var(--font-mono); line-height: 1;">PY</span>`;
    case 'html':
    case 'htm':
      return `<span style="background: #E34F26; color: #fff; font-size: 8.5px; font-weight: 700; padding: 1px 3px; border-radius: 3px; font-family: var(--font-mono); line-height: 1;">HTML</span>`;
    case 'svg':
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#A855F7" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
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

  // 1. Image Viewer
  if (isImage) {
    return `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 8px; padding: 20px; overflow: auto;">
        <img src="${escapeHtml(file.content.startsWith('data:') || file.content.startsWith('http') ? file.content : file.path)}" alt="${escapeHtml(file.path)}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; box-shadow: var(--shadow-card);" />
        <div style="margin-top: 12px; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(file.path)}</div>
      </div>
    `;
  }

  // 2. Markdown Rich Rendered Mode
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
      ">
        ${renderMarkdown(file.content)}
      </div>
    `;
  }

  // 3. Diff View or Code View (Raw Mode or Code Files)
  const isDiff = Boolean(file.isDiff || file.content.startsWith('---') || file.content.includes('\n@@ '));
  const rawLines = file.content.split('\n');

  const linesHtml = rawLines.map((line, idx) => {
    const lineNum = idx + 1;
    let lineBg = 'transparent';
    let lineTextColor = 'var(--text-main)';

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

    let formattedLine = escapeHtml(line);
    // Highlight in-file search query if provided
    if (opts.searchQuery && opts.searchQuery.trim()) {
      const q = escapeHtml(opts.searchQuery.trim());
      const regex = new RegExp(`(${q})`, 'gi');
      formattedLine = formattedLine.replace(regex, '<mark style="background: #F59E0B; color: #000; border-radius: 2px; padding: 0 2px;">$1</mark>');
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
                 opacity: 0.5;
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
    ">
      <div style="
        flex: 1;
        overflow: auto;
        padding: 10px 12px;
        background: var(--bg-code, #0A0B10);
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
