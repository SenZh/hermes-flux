/**
 * Hermes Flux Streamlined File Previewer Pod (v4.0)
 * Width: 380px, collapsible to 0px (Shortcut: Cmd/Ctrl+\)
 * Clean single-purpose workspace file previewer for inspected artifacts, diffs and code.
 */

export type InspectorTab = 'artifacts' | 'browser' | 'git' | 'memory' | 'preview';

export interface InspectionPodProps {
  collapsed: boolean;
  activeTab?: InspectorTab;
  gatewayConnected: boolean;
  isFullscreen?: boolean;
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
  const currentFile = props.previewFile || (props.artifacts && props.artifacts.length > 0 ? {
    path: props.artifacts[0].name,
    content: props.artifacts[0].preview || '',
    language: 'markdown',
  } : undefined);

  // If fullscreen, pop out as an absolute overlay taking 100% width and height; otherwise flex resizable rail
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
      <!-- File Preview Header -->
      <div class="inspector-pane-header" style="
        height: 42px;
        min-height: 42px;
        border-bottom: 1px solid var(--border-subtle);
        padding: 0 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--bg-surface-1);
      ">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; flex: 1;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span style="font-size: 12px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(currentFile ? currentFile.path : '')}">
            ${escapeHtml(currentFile ? currentFile.path : '文件预览')}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <button id="toggle-inspector-fullscreen-btn" class="icon-btn" title="${isFullscreen ? '退出全屏预览' : '全屏预览文件'}" style="
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
            align-items: center;
          ">
            ${
              isFullscreen
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
            }
          </button>
          <button id="toggle-inspector-close-btn" class="icon-btn" title="折叠右侧栏 (Ctrl+\\)" style="
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            display: flex;
            align-items: center;
          ">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <!-- Preview Content Area -->
      <div class="inspector-content-pane" style="
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
      ">
        ${
          currentFile
            ? `
          <div style="
            flex: 1;
            display: flex;
            flex-direction: column;
            background: var(--bg-card);
            border: 1px solid var(--border-medium);
            border-radius: 8px;
            overflow: hidden;
          ">
            <div style="padding: 6px 12px; background: var(--bg-elevated); border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">${escapeHtml(currentFile.path)}</span>
              <button class="icon-btn" onclick="navigator.clipboard.writeText(this.closest('div').parentElement.querySelector('code').innerText)" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 10.5px;">复制</button>
            </div>
            <pre style="
              margin: 0;
              padding: 14px;
              overflow: auto;
              font-family: var(--font-mono);
              font-size: 12px;
              line-height: 1.6;
              color: var(--text-main);
              flex: 1;
            "><code>${escapeHtml(currentFile.content || '(空文件)')}</code></pre>
          </div>
        `
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
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.4;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <div style="font-size: 12px; font-weight: 500; color: var(--text-secondary);">暂无正在预览的文件</div>
            <div style="font-size: 11px; line-height: 1.5; max-width: 260px;">点击对话流中的文件路径或工具执行结果，即可在此处实时查看文件代码与改动</div>
          </div>
        `
        }
      </div>
    </aside>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
