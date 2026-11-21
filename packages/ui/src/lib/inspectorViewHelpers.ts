/**
 * 右侧「文件树浏览 + 文件预览」一体工具窗纯视图辅助渲染器 (packages/ui/src/lib/inspectorViewHelpers.ts)
 *
 * 【设计意图 (Why)】
 *   依据 Pitfall P-025 与 `ui/no-new-template-export` 规则，将 InspectionPod 的子视图拼装
 *   （工作区文件树面板、多标签文件栏、源码/Markdown/HTML/Diff/图片内容渲染）抽离到 `lib/`，
 *   保持 `InspectionPod.ts` 远低于 979 行上限，同时严格共用 Design Tokens 与 i18n 字典。
 *
 * 【约束与规则 (Rules)】
 *   1. 全量消费 `--fs-*` 字号、`--radius-*` 圆角与颜色语义 Token，零硬编码色相与中文文案；
 *   2. 复用 `renderFileTypeIcon` Material 文件图标体系，禁止另起炉灶手绘扩展名色块；
 *   3. 保持 `.line-number` 不可选中（`user-select: none`）与 `.line-code` 可复制选中（`user-select: text`）。
 */

import {
  filterFileTree,
  formatFileSize,
  normalizeWorkspacePath,
  type FileTreeLoadState,
  type FileTreeNode,
} from '@hermes-flux/core';
import { renderMarkdown, highlightCodeSyntax } from '../components/MiddlePod/MiddlePod.js';
import { renderFileTypeIcon } from './fileTypeIcons.js';
import { t } from '../i18n/index.js';

export type InspectorTab = 'artifacts' | 'browser' | 'git' | 'memory' | 'preview';
export type FileViewMode = 'rendered' | 'raw';

export interface OpenFileItem {
  id?: string;
  path: string;
  content: string;
  language?: string;
  isDiff?: boolean;
  isBinary?: boolean;
  isTooLarge?: boolean;
  byteSize?: number;
  source?: 'session_tool' | 'local_fs' | 'remote_http' | 'gateway_api' | 'fallback';
}

export function escapeInspectorHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function detectFileLanguage(path: string): string {
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
    case 'htm':
      return 'html';
    default:
      return 'text';
  }
}

export function renderFileTab(file: OpenFileItem, isActive: boolean): string {
  const fileName = file.path.split(/[/\\]/).pop() || file.path;
  const icon = renderFileTypeIcon(file.path, 'inspector-tab-file-icon');

  return `
    <div class="inspector-file-tab ${isActive ? 'tab-active' : ''}" data-file-tab="${escapeInspectorHtml(file.path)}" title="${escapeInspectorHtml(file.path)}">
      ${icon}
      <span class="file-tab-label">${escapeInspectorHtml(fileName)}</span>
      <button type="button" class="btn-close-file-tab" data-close-tab="${escapeInspectorHtml(file.path)}" title="${t('inspector.closeTab')}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
}

export function renderInspectorFileContent(
  file: OpenFileItem,
  opts: { viewMode: FileViewMode; showLineNumbers: boolean; wordWrap: boolean; searchQuery: string },
): string {
  if (file.isBinary || file.isTooLarge) {
    const fileName = file.path.split(/[/\\]/).pop() || file.path;
    const dotIdx = fileName.lastIndexOf('.');
    const extLabel = dotIdx > 0 ? fileName.slice(dotIdx + 1).toUpperCase() : '';
    const sizeText = formatFileSize(file.byteSize);
    const kindBadge = file.isBinary ? t('inspector.binaryBadge') : t('inspector.largeFileBadge');
    const title = file.isBinary ? t('inspector.binaryFileTitle') : t('inspector.largeFileTitle');
    const sub = file.isBinary ? t('inspector.binaryFileSub') : t('inspector.largeFileSub');
    const fileIcon = renderFileTypeIcon(file.path, 'inspector-nonpreview-icon');

    return `
      <div class="inspector-nonpreview-card">
        <div class="inspector-nonpreview-icon-wrap">
          ${fileIcon}
        </div>
        <div class="inspector-nonpreview-filename" title="${escapeInspectorHtml(file.path)}">${escapeInspectorHtml(fileName)}</div>
        <div class="inspector-nonpreview-badges">
          <span class="inspector-nonpreview-badge">${escapeInspectorHtml(kindBadge)}</span>
          ${extLabel ? `<span class="inspector-nonpreview-badge">${escapeInspectorHtml(extLabel)}</span>` : ''}
          ${sizeText ? `<span class="inspector-nonpreview-badge">${escapeInspectorHtml(sizeText)}</span>` : ''}
        </div>
        <div class="inspector-nonpreview-title">${escapeInspectorHtml(title)}</div>
        <div class="inspector-nonpreview-sub">${escapeInspectorHtml(sub)}</div>
        <button type="button" id="btn-preview-download-file" class="inspector-download-cta-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>${escapeInspectorHtml(t('inspector.downloadFileBtn'))}</span>
        </button>
      </div>
    `;
  }

  const ext = (file.path.split('.').pop() || '').toLowerCase();
  const isMarkdown = ext === 'md' || ext === 'markdown';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);

  if (isImage) {
    const isReadyData =
      file.content.startsWith('data:') ||
      file.content.startsWith('http://') ||
      file.content.startsWith('https://');
    const imageSrc = isReadyData ? file.content : '';

    if (!imageSrc) {
      return `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-panel); padding: 32px 20px; overflow: auto; text-align: center;">
          <div style="width: 44px; height: 44px; border-radius: var(--radius-panel); background: var(--primary-subtle); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: center; margin-bottom: 12px; color: var(--primary);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
          <div style="font-size: var(--fs-body); font-weight: 600; color: var(--foreground); margin-bottom: 6px;">${t('inspector.imageLoadError')}</div>
          <div style="font-size: var(--fs-aux); color: var(--muted-foreground); max-width: 320px; line-height: 1.5; margin-bottom: 16px;">${t('inspector.imageLoadErrorSub')}</div>
          <div style="font-size: var(--fs-caption); color: var(--muted-foreground); font-family: var(--font-mono); background: var(--input); padding: 4px 10px; border-radius: var(--radius-inner); border: 1px solid var(--border-subtle); max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeInspectorHtml(file.path)}</div>
        </div>
      `;
    }

    return `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-panel); padding: 20px; overflow: auto;">
        <img src="${escapeInspectorHtml(imageSrc)}" alt="${escapeInspectorHtml(file.path)}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: var(--radius-inner);" onerror="this.parentElement.innerHTML='<div style=\\'padding: 30px; text-align: center; color: var(--muted-foreground); font-size: var(--fs-aux);\\'>${t('inspector.imageLoadError')}</div>'" />
        <div style="margin-top: 12px; font-size: var(--fs-caption); color: var(--muted-foreground); font-family: var(--font-mono);">${escapeInspectorHtml(file.path)}</div>
      </div>
    `;
  }

  if (isMarkdown && opts.viewMode === 'rendered') {
    return `
      <div class="inspector-rendered-markdown" style="
        flex: 1;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius-panel);
        padding: 16px 20px;
        overflow-y: auto;
        font-size: var(--fs-body);
        line-height: 1.6;
        color: var(--foreground);
        user-select: text;
      ">
        ${renderMarkdown(file.content)}
      </div>
    `;
  }

  if (opts.viewMode === 'rendered' && (ext === 'html' || ext === 'htm')) {
    return `
      <div style="flex: 1; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-panel); overflow: hidden;">
        <!-- iframe 内是待预览的用户 HTML 文档，其文档根必须为不透明白纸底 -->
        <!-- gate-theme-allow: 白色属于被预览的用户文档底色，不属于应用主题面 -->
        <iframe srcdoc="${escapeInspectorHtml(file.content)}" sandbox="allow-scripts" style="flex: 1; border: none; width: 100%; height: 100%; background: #ffffff;"></iframe>
      </div>
    `;
  }

  const isDiff = Boolean(file.isDiff || file.content.startsWith('---') || file.content.includes('\n@@ '));
  const rawLines = file.content.split('\n');
  const prefixRegex = /^\s*(\d+)[:|]\s?(.*)$/;
  let hasEmbeddedLineNums = rawLines.length > 3;
  if (hasEmbeddedLineNums) {
    let matchCount = 0;
    for (let i = 0; i < Math.min(rawLines.length, 10); i++) {
      if (prefixRegex.test(rawLines[i])) matchCount++;
    }
    hasEmbeddedLineNums = matchCount >= 3;
  }

  const escapedQuery = opts.searchQuery.trim()
    ? escapeInspectorHtml(opts.searchQuery.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '';

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
    let lineTextColor = 'var(--foreground)';

    const isNoticeLine =
      line.includes(t('inspector.remoteNotice')) || line.includes(t('inspector.loadingNotice'));
    if (isNoticeLine) {
      lineTextColor = 'var(--muted-foreground)';
      lineBg = 'var(--primary-subtle)';
    }

    if (isDiff) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lineBg = 'color-mix(in srgb, var(--success) 12%, transparent)';
        lineTextColor = 'var(--success)';
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        lineBg = 'color-mix(in srgb, var(--destructive) 12%, transparent)';
        lineTextColor = 'var(--destructive)';
      } else if (line.startsWith('@@')) {
        lineBg = 'var(--accent-subtle)';
        lineTextColor = 'var(--accent)';
      }
    }

    let formattedLine = isDiff || isNoticeLine ? escapeInspectorHtml(line) : highlightCodeSyntax(line);

    if (isNoticeLine) {
      formattedLine = `<span style="display: inline-flex; align-items: center; gap: 6px; color: var(--primary); font-style: italic;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${formattedLine}</span>`;
    }

    if (escapedQuery) {
      const regex = new RegExp(`(${escapedQuery})`, 'gi');
      formattedLine = formattedLine.replace(
        regex,
        '<mark style="background: var(--primary); color: var(--primary-foreground); border-radius: var(--radius-inner); padding: 0 2px;">$1</mark>',
      );
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
                 color: var(--muted-foreground);
                 user-select: none;
                 opacity: 0.6;
                 font-size: var(--fs-caption);
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
          font-size: var(--fs-aux);
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
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-panel);
      overflow: hidden;
      user-select: text;
    ">
      <div style="
        flex: 1;
        overflow: auto;
        padding: 10px 12px;
        background: var(--code);
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

export interface FileTreePaneRenderOptions {
  fileTreeState: FileTreeLoadState;
  expandedPaths: readonly string[];
  activeFilePath: string;
  filterQuery: string;
  workspaceRootName?: string;
}

function renderTreeNodesRecursive(
  nodes: readonly FileTreeNode[],
  depth: number,
  expandedSet: ReadonlySet<string>,
  activePath: string,
  forceExpandAll: boolean,
): string {
  return nodes
    .map((node) => {
      const normPath = normalizeWorkspacePath(node.path);
      if (node.isDirectory) {
        const isExpanded = forceExpandAll || expandedSet.has(normPath);
        const padLeft = 8 + depth * 12;
        const chevron = isExpanded
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><polyline points="6 9 12 15 18 9"/></svg>`
          : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><polyline points="9 18 15 12 9 6"/></svg>`;
        const folderIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; opacity: 0.75;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
        const childrenHtml =
          isExpanded && node.children && node.children.length > 0
            ? renderTreeNodesRecursive(node.children, depth + 1, expandedSet, activePath, forceExpandAll)
            : '';
        return `
          <button type="button" class="inspector-tree-row inspector-tree-dir ${isExpanded ? 'expanded' : ''}" data-tree-dir="${escapeInspectorHtml(normPath)}" title="${escapeInspectorHtml(normPath)}" aria-expanded="${isExpanded ? 'true' : 'false'}" style="padding-left: ${padLeft}px;">
            <span class="inspector-tree-chevron">${chevron}</span>
            ${folderIcon}
            <span class="inspector-tree-label">${escapeInspectorHtml(node.name)}</span>
          </button>
          ${childrenHtml}
        `;
      }

      const isActive = Boolean(activePath) && activePath === normPath;
      const padLeft = 20 + depth * 12;
      const icon = renderFileTypeIcon(node.path, 'inspector-tree-file-icon');
      return `
        <button type="button" class="inspector-tree-row inspector-tree-file ${isActive ? 'active' : ''}" data-tree-file="${escapeInspectorHtml(normPath)}" title="${escapeInspectorHtml(normPath)}" style="padding-left: ${padLeft}px;">
          ${icon}
          <span class="inspector-tree-label">${escapeInspectorHtml(node.name)}</span>
        </button>
      `;
    })
    .join('');
}

/**
 * 渲染同窗左侧「工作区文件树浏览器」分栏。
 */
export function renderInspectorFileTreePane(opts: FileTreePaneRenderOptions): string {
  const expandedSet = new Set(opts.expandedPaths.map((p) => normalizeWorkspacePath(p)));
  const normActive = normalizeWorkspacePath(opts.activeFilePath);
  const query = opts.filterQuery || '';
  const hasFilter = query.trim().length > 0;
  const headerTitle = opts.workspaceRootName || t('inspector.fileTreeTitle');

  let listBodyHtml = '';
  if (opts.fileTreeState.status === 'loading' || opts.fileTreeState.status === 'idle') {
    listBodyHtml = `<div class="inspector-tree-status">${t('inspector.fileTreeLoading')}</div>`;
  } else if (opts.fileTreeState.status === 'error') {
    listBodyHtml = `
      <div class="inspector-tree-status inspector-tree-error">
        <div>${t('inspector.fileTreeError')}</div>
        <div class="inspector-tree-error-detail">${escapeInspectorHtml(opts.fileTreeState.message)}</div>
        <button type="button" id="btn-file-tree-retry" class="inspector-tree-retry-btn">${t('inspector.fileTreeRetry')}</button>
      </div>
    `;
  } else if (opts.fileTreeState.nodes.length === 0) {
    listBodyHtml = `<div class="inspector-tree-status">${t('inspector.fileTreeEmpty')}</div>`;
  } else {
    const visibleNodes = filterFileTree(opts.fileTreeState.nodes, query);
    if (visibleNodes.length === 0) {
      listBodyHtml = `<div class="inspector-tree-status">${t('inspector.fileTreeNoMatch')}</div>`;
    } else {
      listBodyHtml = renderTreeNodesRecursive(visibleNodes, 0, expandedSet, normActive, hasFilter);
    }
  }

  return `
    <div class="inspector-file-tree-pane">
      <div class="inspector-tree-header">
        <div class="inspector-tree-title" title="${escapeInspectorHtml(headerTitle)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; opacity: 0.75;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span class="inspector-tree-title-text">${escapeInspectorHtml(headerTitle)}</span>
        </div>
        <div class="inspector-tree-actions">
          <button type="button" id="btn-file-tree-refresh" class="icon-btn" title="${t('inspector.fileTreeRefresh')}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button type="button" id="btn-file-tree-toggle" class="icon-btn" title="${t('inspector.fileTreeCollapse')}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          </button>
        </div>
      </div>

      <div class="inspector-tree-search-wrap">
        <div class="inspector-tree-search-box">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="inspector-tree-search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="inspector-tree-filter-input" class="inspector-tree-filter-input" type="text" placeholder="${t('inspector.fileTreeFilterPlaceholder')}" value="${escapeInspectorHtml(query)}" autocomplete="off" spellcheck="false" />
        </div>
      </div>

      <div class="inspector-tree-list" role="tree" aria-label="${t('inspector.fileTreeTitle')}">
        ${listBodyHtml}
      </div>
    </div>
  `;
}
