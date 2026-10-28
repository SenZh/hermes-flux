/**
 * Hermes Aura Floating Input Dock (v3.5)
 * Strict Golden Width Constraint:
 * - max-width: 740px; margin: 0 auto;
 * Embedded micro-control strip:
 * - Real model picker
 * - Reasoning depth segmented control
 * - Tool approval mode control
 * - Attachment & Send action button
 */

export interface InputDockProps {
  selectedModel: string;
  models?: string[];
  reasoningLevel: 'off' | 'low' | 'medium' | 'high';
  approvalMode: 'auto' | 'ask' | 'sandbox';
  isStreaming: boolean;
  disabled?: boolean;
}

export function renderInputDock(props: InputDockProps): string {
  return `
    <div class="input-dock-container" style="
      position: absolute;
      bottom: 18px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      padding: 0 20px;
      pointer-events: none;
      z-index: 40;
    ">
      <div class="input-card-box composer-dock" style="
        pointer-events: auto;
        width: calc(100% - 40px);
        max-width: 740px;
        margin: 0 auto;
        background: var(--bg-backdrop);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid var(--border-medium);
        box-shadow: var(--shadow-dock);
        border-radius: 14px;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
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
        "></textarea>

        <!-- Embedded Micro-Control Strip (Height: 26px) -->
        <div class="input-control-strip" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 26px;
          padding-top: 4px;
          border-top: 1px solid var(--border-subtle);
        ">
          <!-- Left Control Pills -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <!-- 1. Model Selector Pill -->
            <div class="pill-dropdown-wrapper" style="position: relative;">
              <button id="dock-model-selector-btn" class="micro-pill" title="切换推理模型" style="
                height: 24px;
                padding: 0 8px;
                border-radius: 6px;
                background: var(--bg-elevated);
                border: 1px solid var(--border-subtle);
                color: var(--text-main);
                font-size: 11px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 5px;
                cursor: pointer;
              ">
                <span style="color: var(--accent);">⚡</span>
                <span id="current-model-label">${escapeHtml(props.selectedModel || 'Default Model')}</span>
                <span style="font-size: 8px; color: var(--text-muted);">▾</span>
              </button>

              <div id="dock-model-dropdown" class="model-dropdown-menu" style="
                display: none;
                position: absolute;
                bottom: 30px;
                left: 0;
                background: var(--bg-card);
                border: 1px solid var(--border-strong);
                border-radius: 8px;
                box-shadow: var(--shadow-window);
                padding: 6px;
                max-height: 280px;
                overflow-y: auto;
                min-width: 200px;
                z-index: 200;
              ">
                <div style="font-size: 10.5px; font-weight: 600; color: var(--text-muted); padding: 4px 8px 6px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
                  <span>可用模型列表</span>
                  <span id="btn-refresh-models" style="color: var(--accent); cursor: pointer;" title="重新从网关拉取">刷新 ↻</span>
                </div>
                ${
                  props.models && props.models.length > 0
                    ? props.models
                        .map(
                          (m) => `
                      <div class="model-option ${m === props.selectedModel ? 'selected' : ''}" data-model="${escapeHtml(m)}" style="
                        padding: 6px 10px;
                        font-size: 11.5px;
                        border-radius: 5px;
                        color: ${m === props.selectedModel ? 'var(--accent)' : 'var(--text-main)'};
                        background: ${m === props.selectedModel ? 'var(--bg-card-hover)' : 'transparent'};
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                      ">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(m)}</span>
                        ${m === props.selectedModel ? '<span style="font-size: 11px;">✓</span>' : ''}
                      </div>
                    `
                        )
                        .join('')
                    : `
                    <div style="padding: 12px 8px; font-size: 11px; color: var(--text-muted); text-align: center;">
                      <div>暂无模型或网关未返回</div>
                      <div style="margin-top: 4px; font-size: 10px; color: var(--text-faint);">连接网关后自动同步</div>
                    </div>
                  `
                }
              </div>
            </div>

            <!-- 2. Reasoning Level Segmented Pill -->
            <div class="micro-segmented-pill" style="
              height: 24px;
              padding: 1px 2px;
              border-radius: 6px;
              background: var(--bg-card);
              border: 1px solid var(--border-subtle);
              display: flex;
              align-items: center;
              gap: 1px;
            ">
              <span style="font-size: 10px; color: var(--text-muted); padding: 0 4px; font-weight: 500;">🧠 思考</span>
              ${['off', 'low', 'medium', 'high']
                .map((lvl) => {
                  const isActive = props.reasoningLevel === lvl;
                  const labels: Record<string, string> = { off: '关', low: '低', medium: '中', high: '高' };
                  return `
                  <button class="seg-btn ${isActive ? 'active' : ''}" data-level="${lvl}" style="
                    height: 20px;
                    padding: 0 6px;
                    border: none;
                    border-radius: 4px;
                    background: ${isActive ? 'var(--accent)' : 'transparent'};
                    color: ${isActive ? '#000000' : 'var(--text-secondary)'};
                    font-size: 10.5px;
                    font-weight: ${isActive ? '700' : '500'};
                    cursor: pointer;
                  ">${labels[lvl]}</button>
                `;
                })
                .join('')}
            </div>

            <!-- 3. Approval Mode Segmented Pill -->
            <div class="micro-segmented-pill" style="
              height: 24px;
              padding: 1px 2px;
              border-radius: 6px;
              background: var(--bg-card);
              border: 1px solid var(--border-subtle);
              display: flex;
              align-items: center;
              gap: 1px;
            ">
              <span style="font-size: 10px; color: var(--text-muted); padding: 0 4px; font-weight: 500;">🛡️ 审批</span>
              ${['auto', 'ask', 'sandbox']
                .map((mode) => {
                  const isActive = props.approvalMode === mode;
                  const labels: Record<string, string> = { auto: '自动', ask: '询问', sandbox: '沙箱' };
                  return `
                  <button class="approval-btn ${isActive ? 'active' : ''}" data-mode="${mode}" style="
                    height: 20px;
                    padding: 0 6px;
                    border: none;
                    border-radius: 4px;
                    background: ${isActive ? 'var(--accent-subtle)' : 'transparent'};
                    color: ${isActive ? 'var(--accent)' : 'var(--text-secondary)'};
                    border: ${isActive ? '1px solid var(--accent-border)' : '1px solid transparent'};
                    font-size: 10.5px;
                    font-weight: ${isActive ? '700' : '500'};
                    cursor: pointer;
                  ">${labels[mode]}</button>
                `;
                })
                .join('')}
            </div>
          </div>

          <!-- Right Send High-Light Button -->
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="dock-attach-file-btn" title="上传附件或图片 (Cmd+U)" style="
              width: 24px;
              height: 24px;
              border-radius: 6px;
              border: 1px solid var(--border-subtle);
              background: transparent;
              color: var(--text-muted);
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
            ">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M14 8.5l-6 6a4 4 0 01-5.6-5.6l6-6a2.8 2.8 0 014 4l-6 6a1.4 1.4 0 01-2-2l5-5"/>
              </svg>
            </button>

            <button id="dock-send-btn" class="send-action-btn" style="
              height: 24px;
              padding: 0 12px;
              border-radius: 6px;
              background: var(--accent);
              border: none;
              color: var(--theme-thumb-color, #090A0F);
              font-size: 11px;
              font-weight: 700;
              display: flex;
              align-items: center;
              gap: 4px;
              cursor: pointer;
              box-shadow: 0 1px 4px var(--accent-glow);
              transition: transform 0.1s ease, filter 0.1s ease;
            ">
              <span>${props.isStreaming ? '■ 停止' : '发送 ⇡'}</span>
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
