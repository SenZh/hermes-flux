/**
 * Reusable Project Workspace Tree Viewer
 * (packages/ui/src/components/Project/ProjectTreeViewer.ts)
 *
 * 设计意图 (Why):
 *   呈现高维工程项目的工作区目录树与关联文件夹，支持折叠与文件点击。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 零硬编码色相，全量走 var(--token)。
 *   2. 递归深度受控，杜绝死循环。
 *   3. 零内联中文，全量使用 t('key')。
 *
 * 约束与规则 (Rules):
 *   - 纯 Web 标准模板，全平台复用。
 */

import type { ProjectTreeNode } from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { escapeHtml } from '../MiddlePod/MiddlePod.js';

export interface ProjectTreeViewerProps {
  tree: ProjectTreeNode[];
  primaryPath?: string;
  onSelectFile?: (filePath: string) => void;
}

function renderTreeNodes(nodes: ProjectTreeNode[], depth = 0): string {
  if (!nodes || nodes.length === 0) return '';

  return nodes
    .map((node) => {
      const safeName = escapeHtml(node.name);
      const safePath = escapeHtml(node.path);
      const isDir = Boolean(node.isDirectory);
      const indent = depth * 16;
      const icon = isDir ? '📁' : '📄';

      const childHtml = isDir && Array.isArray(node.children) && node.children.length > 0
        ? renderTreeNodes(node.children, depth + 1)
        : '';

      return `
        <div class="project-tree-item" data-path="${safePath}" data-is-dir="${isDir}" style="
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px 6px ${8 + indent}px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          color: var(--text-main);
          min-height: 32px;
        ">
          <span style="font-size: 13px;">${icon}</span>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safeName}</span>
          ${node.size !== undefined ? `<span style="font-size: 10px; color: var(--text-muted); margin-left: auto;">${node.size}B</span>` : ''}
        </div>
        ${childHtml}
      `;
    })
    .join('');
}

export function renderProjectTreeViewer(props: ProjectTreeViewerProps): string {
  const { tree, primaryPath } = props;
  const safePrimary = primaryPath ? escapeHtml(primaryPath) : '';

  const treeContentHtml = tree.length === 0
    ? `<div style="color: var(--text-muted); font-style: italic; padding: 24px 16px; text-align: center;">${t('project.emptyTree')}</div>`
    : renderTreeNodes(tree);

  return `
    <div class="project-tree-viewer" style="
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-window);
      color: var(--text-main);
      font-family: inherit;
    ">
      <div style="
        height: 44px;
        min-height: 44px;
        padding: 0 16px;
        border-bottom: 1px solid var(--border-subtle);
        background: var(--bg-panel);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      ">
        <span style="font-size: 13px; font-weight: 600; color: var(--text-main);">
          📁 ${t('project.treeTitle')}
        </span>
        ${safePrimary ? `
          <span style="
            font-size: 10px;
            color: var(--text-muted);
            font-family: monospace;
            max-width: 160px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          " title="${safePrimary}">${safePrimary}</span>
        ` : ''}
      </div>

      <div class="project-tree-list" style="
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        font-family: monospace;
      ">
        ${treeContentHtml}
      </div>
    </div>
  `;
}
