/**
 * Hermes Aura Adaptive Inspection Pod (v3.5)
 * Width: 390px, collapsible to 0px (Shortcut: Cmd/Ctrl+\)
 * OpenChamber Vertical Tab Rail Architecture:
 * - Left vertical rail (72px) with vertical tab icons & labels: [成果物] [浏览器] [Git变更] [认知记忆]
 * - Right content pane displaying corresponding view.
 * - Real Empty State when empty or disconnected — strictly NO fake mock data.
 * - Physically removed btnInspectorCloseInline.
 */

export type InspectorTab = 'artifacts' | 'browser' | 'git' | 'memory';

export interface InspectionPodProps {
  collapsed: boolean;
  activeTab: InspectorTab;
  gatewayConnected: boolean;
  artifacts?: Array<{ id: string; name: string; type: string; size: string; preview?: string }>;
  browserFrame?: { url: string; title: string; screenshotUrl?: string };
  gitDiffs?: Array<{ file: string; additions: number; deletions: number; patch?: string }>;
  memories?: Array<{ category: string; content: string; updated?: string }>;
}

export function renderInspectionPod(props: InspectionPodProps): string {
  if (props.collapsed) {
    return `<aside id="aura-inspector-pod" class="inspector-collapsed" style="width: 0px; min-width: 0px; display: none; overflow: hidden;"></aside>`;
  }

  const tabs: { key: InspectorTab; label: string; iconSvg: string }[] = [
    {
      key: 'artifacts',
      label: '成果物',
      iconSvg: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    },
    {
      key: 'browser',
      label: '浏览器',
      iconSvg: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    },
    {
      key: 'git',
      label: 'Git变更',
      iconSvg: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    },
    {
      key: 'memory',
      label: '认知记忆',
      iconSvg: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
    },
  ];

  const scenarioMeta: Record<InspectorTab, { tag: string; sub: string }> = {
    artifacts: { tag: '成果物审阅', sub: 'Artifacts & Outputs' },
    browser: { tag: '远程浏览器', sub: 'CDP Automation View' },
    git: { tag: '工作区变更', sub: 'Git Workspace Diffs' },
    memory: { tag: '认知与事实', sub: 'Cognitive Memory & Facts' },
  };

  const meta = scenarioMeta[props.activeTab] || scenarioMeta.artifacts;

  return `
    <aside id="aura-inspector-pod" class="aura-inspector-pod" style="
      width: 410px;
      min-width: 410px;
      max-width: 410px;
      height: 100%;
      background: var(--bg-panel);
      border-left: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: row;
      user-select: none;
      transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
    ">
      <!-- 1. Left Inspector Detail Area (Flex: 1, 348px) -->
      <div class="inspector-detail-area" style="
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--bg-panel);
        border-right: 1px solid var(--border-subtle);
      ">
        <!-- Clean Pane Header (No btnInspectorCloseInline) -->
        <div class="inspector-pane-header" style="
          height: 42px;
          min-height: 42px;
          border-bottom: 1px solid var(--border-subtle);
          padding: 0 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-rail);
        ">
          <div style="display: flex; align-items: baseline; gap: 8px; min-width: 0;">
            <span style="font-size: 12.5px; font-weight: 600; color: var(--text-main);">${meta.tag}</span>
            <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${meta.sub}</span>
          </div>
        </div>

        <!-- Inspector Content Pane -->
        <div class="inspector-content-pane" style="
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
        ">
          ${renderTabContent(props)}
        </div>
      </div>

      <!-- 2. Right: Vertical Tab Rail (62px, docked to the FAR RIGHT edge) -->
      <nav class="inspector-vertical-rail" style="
        width: 62px;
        min-width: 62px;
        max-width: 62px;
        height: 100%;
        background: var(--bg-rail);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px 0;
        gap: 6px;
        z-index: 2;
      ">
        ${tabs
          .map((t) => {
            const isActive = props.activeTab === t.key;
            return `
            <button class="vertical-tab-item ${isActive ? 'active' : ''}" data-tab="${t.key}" title="${t.label}" style="
              width: 54px;
              height: 52px;
              border: none;
              border-radius: 8px;
              background: ${isActive ? 'var(--bg-card-hover)' : 'transparent'};
              color: ${isActive ? 'var(--accent)' : 'var(--text-secondary)'};
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 4px;
              cursor: pointer;
              position: relative;
              transition: all 0.15s ease;
            ">
              ${
                isActive
                  ? `<div class="vertical-tab-indicator" style="position: absolute; right: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 3px 0 0 3px; background: var(--accent);"></div>`
                  : ''
              }
              <div style="display: flex; align-items: center; justify-content: center;">
                ${t.iconSvg}
              </div>
              <span style="font-size: 10.5px; font-weight: ${isActive ? '600' : '400'}; white-space: nowrap;">${t.label}</span>
            </button>
          `;
          })
          .join('')}
      </nav>
    </aside>
  `;
}

function renderTabContent(props: InspectionPodProps): string {
  switch (props.activeTab) {
    case 'artifacts': {
      if (!props.artifacts || props.artifacts.length === 0) {
        return renderEmptyState(
          `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
          '暂无生成产物',
          'Agent 执行过程中产出的代码脚本、文档、数据报表将在此处自动沉淀并支持一键导出。'
        );
      }
      return `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">成果物 (${props.artifacts.length})</span>
          </div>
          ${props.artifacts
            .map(
              (art) => `
            <div style="background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-size: 12.5px; font-weight: 600; color: var(--text-main);">${escapeHtml(art.name)}</span>
                <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(art.type)} · ${escapeHtml(art.size)}</span>
              </div>
              ${art.preview ? `<p style="font-size: 11.5px; color: var(--text-secondary); margin: 0;">${escapeHtml(art.preview)}</p>` : ''}
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }

    case 'browser': {
      if (!props.browserFrame) {
        return renderEmptyState(
          `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
          '远程浏览器未启动',
          '当 Agent 运行网页导航、DOM 交互或视觉分析任务时，CDP 远程视口将在此实时投射并支持协同接管。'
        );
      }
      return `
        <div style="display: flex; flex-direction: column; gap: 10px; height: 100%;">
          <div style="display: flex; align-items: center; gap: 6px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 6px; padding: 6px 10px;">
            <span style="font-size: 10px; color: var(--accent); font-family: var(--font-mono);">URL:</span>
            <span style="font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(props.browserFrame.url)}</span>
          </div>
          <div style="flex: 1; min-height: 200px; background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            ${
              props.browserFrame.screenshotUrl
                ? `<img src="${props.browserFrame.screenshotUrl}" alt="Browser Viewport" style="max-width: 100%; max-height: 100%; border-radius: 6px;" />`
                : `<span style="font-size: 12px; color: var(--text-muted);">视口活动中 (${escapeHtml(props.browserFrame.title)})</span>`
            }
          </div>
        </div>
      `;
    }

    case 'git': {
      if (!props.gitDiffs || props.gitDiffs.length === 0) {
        return renderEmptyState(
          `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
          '工作区无变更',
          '当前工作区代码与仓库状态一致。当 Agent 编辑、重构或生成文件时，精确行级 Diff 将在此呈现审阅。'
        );
      }
      return `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">变更文件 (${props.gitDiffs.length})</span>
          </div>
          ${props.gitDiffs
            .map(
              (diff) => `
            <div style="background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 8px; padding: 10px 12px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 12px; font-weight: 600; color: var(--text-main);">${escapeHtml(diff.file)}</span>
                <div style="display: flex; gap: 6px; font-family: var(--font-mono); font-size: 10px;">
                  <span style="color: #4ADE80;">+${diff.additions}</span>
                  <span style="color: #F87171;">-${diff.deletions}</span>
                </div>
              </div>
              ${diff.patch ? `<pre style="font-family: var(--font-mono); font-size: 10.5px; background: var(--bg-code); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 0;">${escapeHtml(diff.patch)}</pre>` : ''}
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }

    case 'memory': {
      if (!props.memories || props.memories.length === 0) {
        return renderEmptyState(
          `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
          '认知记忆库就绪',
          '用户偏好、项目背景事实与长时认知图谱已接入。Agent 将在交互过程中自动检索并动态沉淀关键记忆。'
        );
      }
      return `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">长效记忆 (${props.memories.length})</span>
          </div>
          ${props.memories
            .map(
              (mem) => `
            <div style="background: var(--bg-card); border: 1px solid var(--border-medium); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;">
              <span style="font-size: 10px; font-weight: 600; color: var(--accent); text-transform: uppercase;">${escapeHtml(mem.category)}</span>
              <p style="font-size: 11.5px; color: var(--text-secondary); margin: 0; line-height: 1.5;">${escapeHtml(mem.content)}</p>
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }
  }
}

function renderEmptyState(iconSvg: string, title: string, description: string): string {
  return `
    <div style="
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 32px 16px;
      color: var(--text-muted);
    ">
      <div style="
        width: 56px;
        height: 56px;
        border-radius: 12px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        margin-bottom: 14px;
      ">
        ${iconSvg}
      </div>
      <span style="font-size: 13px; font-weight: 600; color: var(--text-main); margin-bottom: 6px;">${escapeHtml(title)}</span>
      <p style="font-size: 11.5px; color: var(--text-secondary); line-height: 1.6; margin: 0; max-width: 250px;">${escapeHtml(description)}</p>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
