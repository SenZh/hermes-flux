/**
 * Hermes Aura Settings Modal Component (v3.5)
 * Houses:
 * - Gateway connection config (URL, Auth, Profile, Test Connection, Reconnect, Disconnect)
 * - Appearance (Obsidian Gold / Suet Jade White themes)
 * - Language (Chinese / English)
 * - About Hermes Aura
 */

export interface SettingsModalProps {
  isOpen: boolean;
  activeTab: 'gateway' | 'appearance' | 'about';
  gatewayUrl: string;
  username?: string;
  password?: string;
  profileName: string;
  theme: 'obsidian-gold' | 'suet-jade' | 'jade-white';
  lang: 'zh' | 'en';
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  latencyMs: number;
  testStatus?: { ok?: boolean; message?: string; latency?: number };
}

export function renderSettingsModal(props: SettingsModalProps): string {
  if (!props.isOpen) {
    return `<div id="aura-settings-modal-root" style="display: none;"></div>`;
  }

  const isZh = props.lang === 'zh';

  return `
    <div id="aura-settings-modal-root" class="settings-modal-backdrop" style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
    ">
      <div class="settings-modal-dialog" style="
        width: 580px;
        max-width: 90vw;
        max-height: 85vh;
        background: var(--bg-card);
        border: 1px solid var(--border-medium);
        border-radius: 14px;
        box-shadow: var(--shadow-window);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      ">
        <!-- Modal Header -->
        <div style="
          height: 48px;
          min-height: 48px;
          border-bottom: 1px solid var(--border-subtle);
          padding: 0 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-rail);
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span style="font-size: 13.5px; font-weight: 600; color: var(--text-main);">${isZh ? '工作台配置与设置中心' : 'Settings & Configuration'}</span>
          </div>
          <button id="btn-close-settings" title="${isZh ? '关闭' : 'Close'}" style="
            background: transparent;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- Modal Nav Tabs -->
        <div style="
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 18px 0;
          background: var(--bg-rail);
          border-bottom: 1px solid var(--border-subtle);
        ">
          <button class="settings-tab-btn ${props.activeTab === 'gateway' ? 'active' : ''}" data-tab="gateway" style="
            padding: 8px 14px;
            font-size: 12px;
            font-weight: 600;
            border: none;
            background: transparent;
            color: ${props.activeTab === 'gateway' ? 'var(--accent)' : 'var(--text-secondary)'};
            border-bottom: 2px solid ${props.activeTab === 'gateway' ? 'var(--accent)' : 'transparent'};
            cursor: pointer;
          ">${isZh ? '网关连接' : 'Gateway'}</button>

          <button class="settings-tab-btn ${props.activeTab === 'appearance' ? 'active' : ''}" data-tab="appearance" style="
            padding: 8px 14px;
            font-size: 12px;
            font-weight: 600;
            border: none;
            background: transparent;
            color: ${props.activeTab === 'appearance' ? 'var(--accent)' : 'var(--text-secondary)'};
            border-bottom: 2px solid ${props.activeTab === 'appearance' ? 'var(--accent)' : 'transparent'};
            cursor: pointer;
          ">${isZh ? '外观与语言' : 'Appearance & Language'}</button>

          <button class="settings-tab-btn ${props.activeTab === 'about' ? 'active' : ''}" data-tab="about" style="
            padding: 8px 14px;
            font-size: 12px;
            font-weight: 600;
            border: none;
            background: transparent;
            color: ${props.activeTab === 'about' ? 'var(--accent)' : 'var(--text-secondary)'};
            border-bottom: 2px solid ${props.activeTab === 'about' ? 'var(--accent)' : 'transparent'};
            cursor: pointer;
          ">${isZh ? '关于' : 'About'}</button>
        </div>

        <!-- Modal Body Content -->
        <div style="flex: 1; overflow-y: auto; padding: 20px 24px;">
          ${renderTabPane(props)}
        </div>
      </div>
    </div>
  `;
}

function renderTabPane(props: SettingsModalProps): string {
  const isZh = props.lang === 'zh';

  switch (props.activeTab) {
    case 'gateway': {
      return `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <!-- Status Banner -->
          <div style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--bg-panel);
            border: 1px solid var(--border-medium);
            border-radius: 8px;
            padding: 10px 14px;
          ">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: ${props.connectionStatus === 'connected' ? '#10B981' : props.connectionStatus === 'connecting' ? '#F59E0B' : '#EF4444'};
              "></span>
              <span style="font-size: 12px; font-weight: 600; color: var(--text-main);">
                ${props.connectionStatus === 'connected' ? (isZh ? '网关已连接' : 'Connected') : props.connectionStatus === 'connecting' ? (isZh ? '正在连接...' : 'Connecting...') : (isZh ? '网关未连接' : 'Disconnected')}
              </span>
              ${props.connectionStatus === 'connected' ? `<span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${props.latencyMs}ms</span>` : ''}
            </div>
            
            ${
              props.connectionStatus === 'connected'
                ? `<button id="btn-disconnect-gateway" style="padding: 4px 10px; font-size: 11px; border-radius: 5px; border: 1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.1); color: #EF4444; cursor: pointer;">${isZh ? '断开连接' : 'Disconnect'}</button>`
                : ''
            }
          </div>

          <!-- URL Input -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">${isZh ? '网关地址 (Dashboard / API)' : 'Gateway URL'}</label>
              <span style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono);">推荐 Dashboard 端口 9119 或公网反代</span>
            </div>
            <input type="text" id="settings-gateway-url" value="${escapeHtml(props.gatewayUrl || 'http://127.0.0.1:9119')}" placeholder="http://127.0.0.1:9119 或 https://..." style="
              width: 100%;
              height: 36px;
              background: var(--bg-panel);
              border: 1px solid var(--border-medium);
              border-radius: 8px;
              padding: 0 12px;
              font-size: 12px;
              font-family: var(--font-mono);
              color: var(--text-main);
              outline: none;
              box-sizing: border-box;
            " />
          </div>

          <!-- Gateway Auth Fields (Username & Password) -->
          <div id="section-dashboard-auth" style="display: flex; flex-direction: column; gap: 10px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">${isZh ? '用户名 (Basic Auth)' : 'Username'}</label>
                <input type="text" id="settings-username" value="${escapeHtml(props.username || '')}" placeholder="免密网关可留空" style="
                  width: 100%;
                  height: 36px;
                  background: var(--bg-panel);
                  border: 1px solid var(--border-medium);
                  border-radius: 8px;
                  padding: 0 12px;
                  font-size: 12px;
                  font-family: var(--font-mono);
                  color: var(--text-main);
                  outline: none;
                  box-sizing: border-box;
                " />
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">${isZh ? '密码 (Password)' : 'Password'}</label>
                <input type="password" id="settings-password" value="${escapeHtml(props.password || '')}" placeholder="免密网关可留空" style="
                  width: 100%;
                  height: 36px;
                  background: var(--bg-panel);
                  border: 1px solid var(--border-medium);
                  border-radius: 8px;
                  padding: 0 12px;
                  font-size: 12px;
                  font-family: var(--font-mono);
                  color: var(--text-main);
                  outline: none;
                  box-sizing: border-box;
                " />
              </div>
            </div>
          </div>

          <!-- Profile -->
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary);">${isZh ? 'Profile 配置名称' : 'Profile Name'}</label>
            <input type="text" id="settings-profile-name" value="${escapeHtml(props.profileName || 'default')}" style="
              width: 100%;
              height: 36px;
              background: var(--bg-panel);
              border: 1px solid var(--border-medium);
              border-radius: 8px;
              padding: 0 12px;
              font-size: 12px;
              font-family: var(--font-mono);
              color: var(--text-main);
              outline: none;
              box-sizing: border-box;
            " />
          </div>

          <!-- Feedback message -->
          <div id="settings-test-feedback" style="
            display: ${props.testStatus ? 'flex' : 'none'};
            align-items: center;
            gap: 8px;
            padding: 10px 14px;
            border-radius: 8px;
            background: ${props.testStatus?.ok ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)'};
            border: 1px solid ${props.testStatus?.ok ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'};
            color: ${props.testStatus?.ok ? '#10B981' : '#EF4444'};
            font-size: 12px;
          ">
            <span>${props.testStatus?.ok ? '✓' : '✕'}</span>
            <span>${escapeHtml(props.testStatus?.message || '')}</span>
          </div>

          <!-- Actions -->
          <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px;">
            <button id="btn-settings-test-connection" style="
              height: 36px;
              padding: 0 16px;
              border-radius: 8px;
              background: var(--bg-panel);
              border: 1px solid var(--border-medium);
              color: var(--text-main);
              font-size: 12px;
              font-weight: 500;
              cursor: pointer;
            ">${isZh ? '连通性测试' : 'Test Connection'}</button>

            <button id="btn-settings-save-connect" style="
              height: 36px;
              padding: 0 20px;
              border-radius: 8px;
              background: var(--accent);
              border: none;
              color: var(--theme-thumb-color, #090A0F);
              font-size: 12px;
              font-weight: 700;
              cursor: pointer;
              box-shadow: 0 1px 6px var(--accent-glow);
            ">${isZh ? '保存并连接' : 'Save & Connect'}</button>
          </div>
        </div>
      `;
    }

    case 'appearance': {
      const isObsidian = props.theme === 'obsidian-gold';
      return `
        <div style="display: flex; flex-direction: column; gap: 20px;">
          <!-- Language Selection -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">${isZh ? '界面语言 (Language)' : 'Interface Language'}</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <button class="settings-lang-btn ${isZh ? 'active' : ''}" data-lang="zh" style="
                height: 42px;
                border-radius: 8px;
                border: 1px solid ${isZh ? 'var(--accent)' : 'var(--border-medium)'};
                background: ${isZh ? 'var(--accent-subtle)' : 'var(--bg-panel)'};
                color: ${isZh ? 'var(--accent)' : 'var(--text-main)'};
                font-weight: 600;
                font-size: 13px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
              ">
                <span>🇨🇳 简体中文</span>
              </button>
              <button class="settings-lang-btn ${!isZh ? 'active' : ''}" data-lang="en" style="
                height: 42px;
                border-radius: 8px;
                border: 1px solid ${!isZh ? 'var(--accent)' : 'var(--border-medium)'};
                background: ${!isZh ? 'var(--accent-subtle)' : 'var(--bg-panel)'};
                color: ${!isZh ? 'var(--accent)' : 'var(--text-main)'};
                font-weight: 600;
                font-size: 13px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
              ">
                <span>🇺🇸 English</span>
              </button>
            </div>
          </div>

          <!-- Theme Selection -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary);">${isZh ? '外观主题 (Color Theme)' : 'Appearance Theme'}</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <button class="settings-theme-btn ${isObsidian ? 'active' : ''}" data-theme="obsidian-gold" style="
                height: 64px;
                border-radius: 8px;
                border: 1px solid ${isObsidian ? 'var(--accent)' : 'var(--border-medium)'};
                background: #090A0F;
                color: #F8FAFC;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 4px;
                box-shadow: ${isObsidian ? '0 0 10px rgba(245, 158, 11, 0.25)' : 'none'};
              ">
                <span style="font-size: 13px; font-weight: 600; color: #F59E0B;">☾ 黑曜琥珀 (深色)</span>
                <span style="font-size: 10px; color: #94A3B8;">Obsidian Gold · 纯粹玄黑高奢</span>
              </button>

              <button class="settings-theme-btn ${!isObsidian ? 'active' : ''}" data-theme="suet-jade" style="
                height: 64px;
                border-radius: 8px;
                border: 1px solid ${!isObsidian ? 'var(--accent)' : 'var(--border-medium)'};
                background: #F4F6F9;
                color: #0F172A;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 4px;
                box-shadow: ${!isObsidian ? '0 0 10px rgba(13, 122, 94, 0.20)' : 'none'};
              ">
                <span style="font-size: 13px; font-weight: 600; color: #0D7A5E;">☼ 羊脂白玉 (浅色)</span>
                <span style="font-size: 10px; color: #64748B;">Suet Jade · 凝碧温润纸感</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    case 'about': {
      return `
        <div style="display: flex; flex-direction: column; gap: 14px; text-align: center; align-items: center; padding: 10px 0;">
          <div style="
            width: 48px;
            height: 48px;
            border-radius: 12px;
            background: var(--accent);
            color: var(--theme-thumb-color, #090A0F);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            font-weight: 800;
          ">
            A
          </div>
          <div>
            <h3 style="font-size: 15px; font-weight: 700; color: var(--text-main); margin: 0;">Hermes Aura Desktop</h3>
            <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">v0.1.0 (Production Release)</span>
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); line-height: 1.6; max-width: 400px; margin: 0;">
            ${
              isZh
                ? '极客美学与真实物理质感的 Hermes Agent 桌面工作台。支持 JSON-RPC 2.0 / REST SSE 双网关接入与本地跨平台交互。'
                : 'The elegant universal workspace for Hermes Agent with authentic physics and zero-illusion production engineering.'
            }
          </p>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 10px;">
            Crafted by Nous Research &amp; Hermes Aura Team
          </div>
        </div>
      `;
    }
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
