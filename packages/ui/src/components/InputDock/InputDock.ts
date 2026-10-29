/**
 * Hermes Flux Floating Input Dock (v4.5 Refined)
 * Strict Golden Width Constraint:
 * - max-width: 740px; margin: 0 auto;
 * Embedded micro-control strip:
 * - Real model selector with smooth dropdown
 * - Reasoning depth: compact pill toggle (循环切换: 关/低/中/高)
 * - Approval mode: compact pill toggle (循环切换: 自动/询问/沙箱)
 * - Attachment & high-gloss Send action button with active feedback
 */

export interface InputDockProps {
  selectedModel: string;
  models?: string[];
  modelDetails?: Array<{ id: string; provider: string; name: string; displayName: string; contextLength?: number }>;
  favoriteModels?: string[];
  recentModels?: string[];
  modelSearchQuery?: string;
  reasoningLevel: 'default' | 'none' | 'low' | 'high' | 'max' | 'off' | 'medium';
  approvalMode: 'auto' | 'ask' | 'sandbox';
  isStreaming: boolean;
  disabled?: boolean;
  modelMenuOpen?: boolean;
  notice?: string;
}

export function renderInputDock(props: InputDockProps): string {
  const isStreaming = Boolean(props.isStreaming);
  const modelMenuOpen = Boolean(props.modelMenuOpen);
  const notice = (props.notice || '').trim();

  const reasoningLabels: Record<string, string> = {
    default: '默认',
    none: 'None',
    off: 'None',
    low: 'Low',
    medium: 'High',
    high: 'High',
    max: 'Max',
  };

  const approvalLabels: Record<string, string> = {
    auto: '自动',
    ask: '询问',
    sandbox: '沙箱',
  };

  return `
    <div class="input-dock-container" style="
      position: absolute;
      bottom: 20px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      padding: 0 24px;
      pointer-events: none;
      z-index: 40;
    ">
      <div class="input-card-box composer-dock" style="
        pointer-events: auto;
        width: 100%;
        max-width: 740px; /* 黄金限宽 740px 约束 */
        margin: 0 auto;
        background: var(--bg-backdrop);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid var(--border-medium);
        box-shadow: var(--shadow-dock), var(--specular-line);
        border-radius: 14px;
        padding: 12px 16px 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      ">
        <!-- Textarea Field -->
        <textarea id="dock-prompt-input" rows="2" placeholder="${props.disabled ? '请先连接网关...' : '给 Hermes 下达任务... (Enter 发送, Shift+Enter 换行)'}" ${props.disabled ? 'disabled' : ''} style="
          width: 100%;
          border: none;
          background: transparent;
          color: var(--text-main);
          font-family: inherit;
          font-size: 13.5px;
          line-height: 1.5;
          resize: none;
          outline: none;
          box-sizing: border-box;
          max-height: 180px;
        "></textarea>

        ${
          notice
            ? `<div id="dock-notice" role="status" style="
          display: flex;
          align-items: flex-start;
          gap: 6px;
          font-size: 11px;
          line-height: 1.45;
          color: #F87171;
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.28);
          border-radius: 6px;
          padding: 6px 8px;
          word-break: break-word;
        "><span>⚠</span><span>${escapeHtml(notice)}</span></div>`
            : ''
        }

        <!-- Embedded Micro-Control Strip (Height: 28px) -->
        <div class="input-control-strip" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 28px;
          padding-top: 6px;
          border-top: 1px solid var(--border-subtle);
        ">
          <!-- Left Control Pills -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <!-- 1. Model Selector Pill -->
            <div class="pill-dropdown-wrapper" style="position: relative;">
              <button id="dock-model-selector-btn" class="micro-pill" title="点击切换模型" style="
                height: 24px;
                padding: 0 9px;
                border-radius: 6px;
                background: var(--bg-card);
                border: 1px solid var(--border-subtle);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 5px;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
              ">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/></svg>
                <span id="current-model-label">${escapeHtml(props.selectedModel || '选择模型')}</span>
                <span style="font-size: 8px; color: var(--text-muted); margin-left: 1px;">▾</span>
              </button>

              <div id="dock-model-dropdown" class="model-dropdown-menu" style="
                display: ${modelMenuOpen ? 'block' : 'none'};
                position: absolute;
                bottom: 34px;
                left: 0;
                width: 310px;
                background: var(--bg-card);
                border: 1px solid var(--border-strong);
                border-radius: 12px;
                box-shadow: var(--shadow-window), 0 0 0 1px var(--border-subtle);
                overflow: hidden;
                z-index: 200;
                user-select: none;
              ">
                <!-- Top Action & Search Bar -->
                <div style="padding: 10px 10px 6px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface-1);">
                  <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span id="btn-add-provider" style="font-size: 11.5px; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; gap: 4px;">
                      <span style="font-size: 13px;">+</span> 添加新提供商
                    </span>
                    <span id="btn-refresh-models" style="font-size: 11px; color: var(--text-muted); cursor: pointer;" title="刷新列表">刷新 ↻</span>
                  </div>
                  <div style="position: relative; display: flex; align-items: center;">
                    <span style="position: absolute; left: 8px; color: var(--text-muted); font-size: 11.5px;">🔍</span>
                    <input id="dock-model-search-input" type="text" placeholder="搜索模型" value="${escapeHtml(props.modelSearchQuery || '')}" style="
                      width: 100%;
                      height: 28px;
                      padding: 0 10px 0 26px;
                      border-radius: 6px;
                      border: 1px solid var(--border-medium);
                      background: var(--bg-panel);
                      color: var(--text-main);
                      font-size: 12px;
                      outline: none;
                      box-sizing: border-box;
                    " />
                  </div>
                </div>

                <!-- Scrollable Model Tree List (Dynamically updated on search) -->
                <div id="model-picker-scroll-list" style="max-height: 320px; overflow-y: auto; padding: 6px 0;">
                  ${renderModelPickerTree(props)}
                </div>

                <!-- Bottom Navigation Hint -->
                <div style="
                  padding: 6px 12px;
                  border-top: 1px solid var(--border-subtle);
                  background: var(--bg-surface-1);
                  font-size: 10.5px;
                  color: var(--text-muted);
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                ">
                  <span>↑↓ 选择模型</span>
                  <span>Esc 关闭</span>
                </div>
              </div>
            </div>

            <!-- 2. Reasoning Dropdown Pill (对标 OpenChamber 思考下拉菜单) -->
            <div class="pill-dropdown-wrapper" style="position: relative;">
              <button id="dock-reasoning-toggle-btn" class="micro-pill" title="选择思考深度" style="
                height: 24px;
                padding: 0 8px;
                border-radius: 6px;
                background: var(--bg-card);
                border: 1px solid var(--border-subtle);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 5px;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
              ">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span id="current-reasoning-label" style="color: var(--text-main); font-weight: 500;">${reasoningLabels[props.reasoningLevel] || '默认'}</span>
                <span style="font-size: 8px; color: var(--text-muted);">▾</span>
              </button>

              <div id="dock-reasoning-dropdown" class="reasoning-dropdown-menu" style="
                display: none;
                position: absolute;
                bottom: 32px;
                left: 0;
                min-width: 140px;
                background: var(--bg-card);
                border: 1px solid var(--border-medium);
                border-radius: 10px;
                box-shadow: var(--shadow-window);
                padding: 6px;
                max-height: 240px;
                overflow-y: auto;
                z-index: 210;
                user-select: none;
              ">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-main); padding: 4px 8px 6px; border-bottom: 1px solid var(--border-subtle);">思考</div>
                ${['default', 'none', 'low', 'high', 'max']
                  .map((lvl) => {
                    const isSelected = props.reasoningLevel === lvl || (lvl === 'default' && (!props.reasoningLevel || props.reasoningLevel === 'high')) || (lvl === 'none' && props.reasoningLevel === 'off');
                    return `
                  <div class="reasoning-option" data-level="${lvl}" style="padding: 6px 8px; font-size: 12px; cursor: pointer; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; color: ${isSelected ? '#38BDF8' : 'var(--text-main)'}; background: ${isSelected ? 'rgba(56, 189, 248, 0.08)' : 'transparent'};">
                    <span>${reasoningLabels[lvl] || lvl}</span>
                    ${isSelected ? '<span style="color: #38BDF8; font-weight: 700;">✓</span>' : ''}
                  </div>
                `;
                  })
                  .join('')}
              </div>
            </div>

            <!-- 3. Approval Mode Dropdown Pill (对标安全人像盾牌图标与下拉浮层) -->
            <div class="pill-dropdown-wrapper" style="position: relative;">
              <button id="dock-approval-toggle-btn" class="micro-pill" title="审批策略 (点击切换)" style="
                height: 24px;
                padding: 0 8px;
                border-radius: 6px;
                background: var(--bg-card);
                border: 1px solid var(--border-subtle);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 5px;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
              ">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); flex-shrink: 0;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 16a3.5 3.5 0 0 1 7 0"/></svg>
                <span id="current-approval-label" style="color: var(--text-main); font-weight: 500;">${approvalLabels[props.approvalMode] || '自动'}</span>
                <span style="font-size: 8px; color: var(--text-muted);">▾</span>
              </button>

              <div id="dock-approval-dropdown" class="approval-dropdown-menu" style="
                display: none;
                position: absolute;
                bottom: 32px;
                left: 0;
                min-width: 140px;
                background: var(--bg-card);
                border: 1px solid var(--border-medium);
                border-radius: 10px;
                box-shadow: var(--shadow-window);
                padding: 6px;
                max-height: 200px;
                overflow-y: auto;
                z-index: 210;
                user-select: none;
              ">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-main); padding: 4px 8px 6px; border-bottom: 1px solid var(--border-subtle);">权限审批</div>
                ${['auto', 'ask', 'sandbox']
                  .map((mode) => {
                    const isSelected = props.approvalMode === mode;
                    return `
                  <div class="approval-option" data-mode="${mode}" style="padding: 6px 8px; font-size: 12px; cursor: pointer; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; color: ${isSelected ? '#38BDF8' : 'var(--text-main)'}; background: ${isSelected ? 'rgba(56, 189, 248, 0.08)' : 'transparent'};">
                    <span>${approvalLabels[mode] || mode}</span>
                    ${isSelected ? '<span style="color: #38BDF8; font-weight: 700;">✓</span>' : ''}
                  </div>
                `;
                  })
                  .join('')}
              </div>
            </div>
          </div>

          <!-- Right Action Buttons -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <!-- File Attach -->
            <button id="dock-attach-file-btn" class="icon-btn" title="附加文件" style="
              background: transparent;
              border: none;
              color: var(--text-muted);
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 4px;
              border-radius: 4px;
              transition: color 0.15s ease;
            ">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>

            <!-- Send Action Button: Refined Clean Ice-Blue Pill -->
            <button id="dock-send-btn" class="send-action-btn" title="${isStreaming ? '中断本轮生成' : '发送 (Enter)'}" ${props.disabled ? 'disabled' : ''} style="
              height: 24px;
              width: 28px;
              border-radius: 6px;
              background: ${isStreaming ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.12)'};
              border: 1px solid ${isStreaming ? '#EF4444' : 'rgba(56, 189, 248, 0.35)'};
              color: ${isStreaming ? '#EF4444' : '#38BDF8'};
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: ${props.disabled ? 'not-allowed' : 'pointer'};
              box-shadow: 0 0 8px ${isStreaming ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.15)'};
              transition: all 0.15s ease;
            ">
              ${
                isStreaming
                  ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`
                  : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`
              }
            </button>
          </div>
        </div>
      </div>
    </div>
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

function formatContextLength(tokens?: number): string {
  if (!tokens || typeof tokens !== 'number') return '';
  if (tokens >= 10000) {
    const wan = (tokens / 10000).toFixed(1).replace(/\.0$/, '');
    return `${wan}万`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}k`;
  }
  return String(tokens);
}

export function renderModelPickerTree(props: InputDockProps): string {
  const query = (props.modelSearchQuery || '').trim().toLowerCase();
  let allDetails = props.modelDetails && props.modelDetails.length > 0 ? props.modelDetails : [];
  if (allDetails.length === 0 && props.models && props.models.length > 0) {
    allDetails = props.models.map((m) => ({
      id: m,
      provider: 'DEFAULT',
      name: m,
      displayName: m,
    }));
  }
  const favorites = new Set(props.favoriteModels || []);
  const recents = props.recentModels || [];

  // Filter models by search query
  const filtered = allDetails.filter((d) => {
    if (!query) return true;
    return (
      d.id.toLowerCase().includes(query) ||
      d.name.toLowerCase().includes(query) ||
      d.provider.toLowerCase().includes(query)
    );
  });

  // Group by provider
  const providerGroups: Record<string, typeof allDetails> = {};
  for (const d of filtered) {
    const p = d.provider || 'OTHER';
    if (!providerGroups[p]) providerGroups[p] = [];
    providerGroups[p].push(d);
  }

  // Favorite items
  const favoriteItems = allDetails.filter((d) => favorites.has(d.id));

  // Recent items
  const recentItems = recents
    .map((rId) => allDetails.find((d) => d.id === rId))
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  return `
    <!-- 1. Favorites Section -->
    ${
      !query && favoriteItems.length > 0
        ? `
      <div class="model-picker-section" style="margin-bottom: 6px;">
        <div style="padding: 4px 12px; font-size: 11px; font-weight: 700; color: #38BDF8; display: flex; align-items: center; gap: 6px;">
          <span>★</span>
          <span>收藏</span>
        </div>
        ${favoriteItems.map((item) => renderModelItemRow(item, props.selectedModel, true)).join('')}
      </div>
    `
        : ''
    }

    <!-- 2. Recents Section -->
    ${
      !query && recentItems.length > 0
        ? `
      <div class="model-picker-section" style="margin-bottom: 6px;">
        <div style="padding: 4px 12px; font-size: 11px; font-weight: 700; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
          <span>🕒</span>
          <span>最近</span>
        </div>
        ${recentItems.map((item) => renderModelItemRow(item, props.selectedModel, favorites.has(item.id))).join('')}
      </div>
    `
        : ''
    }

    <!-- 3. Provider Grouped Sections -->
    ${
      Object.keys(providerGroups).length > 0
        ? Object.entries(providerGroups)
            .map(([providerName, models]) => {
              const upperName = providerName.toUpperCase();
              let icon = '⬡';
              if (upperName.includes('OPENCODE')) icon = '📱';
              else if (upperName.includes('CURSOR')) icon = '⬡';
              else if (upperName.includes('ANTHROPIC') || upperName.includes('CLAUDE')) icon = '🧠';
              else if (upperName.includes('OPENAI')) icon = '⚡';
              else if (upperName.includes('DEEPSEEK')) icon = '🐋';

              return `
            <div class="model-provider-group" style="margin-bottom: 6px;">
              <div style="
                padding: 5px 12px;
                font-size: 11px;
                font-weight: 700;
                color: var(--text-muted);
                letter-spacing: 0.04em;
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: var(--bg-surface-1);
              ">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="opacity: 0.5;">::</span>
                  <span>${icon}</span>
                  <span>${escapeHtml(upperName)}</span>
                </div>
                <span style="font-size: 10px; opacity: 0.6;">▾</span>
              </div>
              ${models.map((item) => renderModelItemRow(item, props.selectedModel, favorites.has(item.id))).join('')}
            </div>
          `;
            })
            .join('')
        : '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px;">未找到匹配的模型</div>'
    }
  `;
}

export function renderModelPickerMenu(props: InputDockProps): string {
  return renderModelPickerTree(props);
}

function renderModelItemRow(
  item: { id: string; provider: string; name: string; contextLength?: number },
  selectedModel: string,
  isFav: boolean
): string {
  const isSelected = item.id === selectedModel;
  const contextBadge = item.contextLength ? formatContextLength(item.contextLength) : '';

  return `
    <div class="model-option ${isSelected ? 'active' : ''}" data-model="${escapeHtml(item.id)}" data-provider="${escapeHtml(item.provider)}" style="
      padding: 6px 12px;
      font-size: 12px;
      color: ${isSelected ? '#38BDF8' : 'var(--text-main)'};
      background: ${isSelected ? 'rgba(56, 189, 248, 0.12)' : 'transparent'};
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.1s ease;
    " onmouseenter="if (!this.classList.contains('active')) this.style.background='var(--bg-hover)'" onmouseleave="if (!this.classList.contains('active')) this.style.background='transparent'">
      <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <span class="btn-toggle-favorite" data-model="${escapeHtml(item.id)}" style="
          color: ${isFav ? '#38BDF8' : 'var(--text-faint)'};
          font-size: 12px;
          cursor: pointer;
          flex-shrink: 0;
        ">${isFav ? '★' : '☆'}</span>
        <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; color: inherit;">${escapeHtml(item.name || item.id)}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        ${
          contextBadge
            ? `<span style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">${contextBadge}</span>`
            : ''
        }
        ${isSelected ? '<span style="font-size: 11px; color: #38BDF8; font-weight: 700;">✓</span>' : ''}
      </div>
    </div>
  `;
}
