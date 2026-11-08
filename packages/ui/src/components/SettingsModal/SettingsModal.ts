/**
 * Hermes Flux Settings Modal Component (v4.0 Professional Edition)
 * Inspired by OpenChamber / OpenCode Master Settings Design.
 * 
 * Features:
 * - Left directory navigation tree with grouped categories & search
 * - Right dynamic settings pane with breadcrumb, workspace selector & close button
 * - Model Providers card grid (1:1 aligned with reference UI)
 * - Multi-Gateway connection profiles & live latency status
 * - Appearance (Theme, Sans/Mono typography tokens, scale factor)
 * - General preferences & headless extensibility
 */

import { t } from '../../i18n/index.js';
import { getUiFontSelectOptions, MONO_FONT_OPTIONS } from '../../tokens/fonts.js';
import type { FontPreferences } from '../../tokens/fontPreferences.js';
import type { GatewayConnectionProfile } from '@hermes-flux/core';

export type SettingsTab =
  | 'general'
  | 'appearance'
  | 'chat'
  | 'notifications'
  | 'sessions'
  | 'routing'
  | 'keybindings'
  | 'voice'
  | 'integrations'
  | 'extensions'
  | 'usage'
  | 'about'
  | 'projects'
  | 'gateways'
  | 'gateway' // Backward-compatible alias for gateways
  | 'tunnels'
  | 'git'
  | 'providers'
  | 'websearch'
  | 'agents'
  | 'behavior';

export interface SettingsModalProps {
  isOpen: boolean;
  activeTab: SettingsTab;
  gatewayUrl: string;
  username?: string;
  password?: string;
  profileName: string;
  theme: 'obsidian-gold' | 'suet-jade' | 'jade-white' | 'warm-paper' | 'ayu-light' | 'cyber-matrix';
  lang: 'zh' | 'en';
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  latencyMs: number;
  testStatus?: { ok?: boolean; message?: string; latency?: number };
  fontPrefs?: FontPreferences;
  gateways?: GatewayConnectionProfile[];
  activeGatewayId?: string;
  searchQuery?: string;
  autoConnectOnStartup?: boolean;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderSettingsModal(props: SettingsModalProps): string {
  if (!props.isOpen) {
    return `<div id="flux-settings-modal-root" style="display: none;"></div>`;
  }

  const effectiveTab = props.activeTab === 'gateway' ? 'gateways' : props.activeTab;

  return `
    <div id="flux-settings-modal-root" class="settings-modal-backdrop" style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.68);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      animation: fluxModalFadeIn 140ms ease-out;
    ">
      <div class="settings-modal-dialog" style="
        width: 1080px;
        max-width: 94vw;
        height: 760px;
        max-height: 90vh;
        background: var(--bg-card);
        border: 1px solid var(--border-medium);
        border-radius: 16px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35), 0 0 1px rgba(255, 255, 255, 0.1);
        display: flex;
        overflow: hidden;
      ">
        <!-- Left Directory Sidebar -->
        <div class="settings-modal-sidebar" style="
          width: 240px;
          min-width: 240px;
          background: var(--bg-rail);
          border-right: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          padding: 16px 10px;
          gap: 12px;
          overflow-y: auto;
        ">
          <!-- Search Box -->
          <div style="position: relative; margin-bottom: 4px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="
              position: absolute;
              left: 10px;
              top: 50%;
              transform: translateY(-50%);
              color: var(--text-muted);
            ">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" id="settings-menu-search" placeholder="${escapeHtml(t('settings.searchPlaceholder'))}" style="
              width: 100%;
              height: 32px;
              background: var(--bg-panel);
              border: 1px solid var(--border-subtle);
              border-radius: 8px;
              padding: 0 10px 0 32px;
              font-size: var(--fs-body);
              color: var(--text-main);
              outline: none;
              box-sizing: border-box;
            " />
          </div>

          <!-- Nav Tree Groups -->
          <div class="settings-nav-tree" style="display: flex; flex-direction: column; gap: 16px;">
            <!-- Group 1: OPENCHAMBER -->
            <div class="settings-nav-group">
              <div style="font-size: var(--fs-micro); font-weight: 700; color: var(--text-muted); padding: 4px 10px; letter-spacing: 0.5px;">${escapeHtml(t('settings.groupOpenchamber'))}</div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                ${renderNavItem('general', '⚙', t('settings.navGeneral'), effectiveTab)}
                ${renderNavItem('appearance', '🎨', t('settings.navAppearance'), effectiveTab)}
                ${renderNavItem('chat', '💬', t('settings.navChat'), effectiveTab)}
                ${renderNavItem('notifications', '🔔', t('settings.navNotifications'), effectiveTab)}
                ${renderNavItem('sessions', '🕒', t('settings.navSessions'), effectiveTab)}
                ${renderNavItem('routing', '🔀', t('settings.navRouting'), effectiveTab)}
                ${renderNavItem('keybindings', '⌨', t('settings.navKeybindings'), effectiveTab)}
                ${renderNavItem('voice', '🎙', t('settings.navVoice'), effectiveTab)}
                ${renderNavItem('integrations', '🔌', t('settings.navIntegrations'), effectiveTab)}
                ${renderNavItem('extensions', '📦', t('settings.navExtensions'), effectiveTab)}
                ${renderNavItem('usage', '📊', t('settings.navUsage'), effectiveTab)}
                ${renderNavItem('about', 'ℹ', t('settings.navAbout'), effectiveTab)}
              </div>
            </div>

            <!-- Group 2: 工作区 -->
            <div class="settings-nav-group">
              <div style="font-size: var(--fs-micro); font-weight: 700; color: var(--text-muted); padding: 4px 10px; letter-spacing: 0.5px;">${escapeHtml(t('settings.groupWorkspace'))}</div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                ${renderNavItem('projects', '📁', t('settings.navProjects'), effectiveTab)}
                ${renderNavItem('gateways', '🖥', t('settings.navGateways'), effectiveTab)}
                ${renderNavItem('tunnels', '🏠', t('settings.navTunnels'), effectiveTab, t('settings.navTunnelsBadge'))}
                ${renderNavItem('git', '🔀', t('settings.navGit'), effectiveTab)}
              </div>
            </div>

            <!-- Group 3: OPENCODE -->
            <div class="settings-nav-group">
              <div style="font-size: var(--fs-micro); font-weight: 700; color: var(--text-muted); padding: 4px 10px; letter-spacing: 0.5px;">${escapeHtml(t('settings.groupOpencode'))}</div>
              <div style="display: flex; flex-direction: column; gap: 2px;">
                ${renderNavItem('providers', '☁', t('settings.navProviders'), effectiveTab)}
                ${renderNavItem('websearch', '🌐', t('settings.navWebsearch'), effectiveTab)}
                ${renderNavItem('agents', '👤', t('settings.navAgents'), effectiveTab)}
                ${renderNavItem('behavior', '⚙', t('settings.navBehavior'), effectiveTab)}
              </div>
            </div>
          </div>
        </div>

        <!-- Right Content Area -->
        <div class="settings-modal-content-area" style="
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-card);
          overflow: hidden;
        ">
          <!-- Top Header Bar -->
          <div style="
            height: 52px;
            padding: 0 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--border-subtle);
          ">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: var(--fs-body); font-weight: 600; color: var(--text-muted);">${getTabBreadcrumb(effectiveTab)}</span>
            </div>

            <div style="display: flex; align-items: center; gap: 12px;">
              <!-- Workspace Selector Chip -->
              <div style="
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                border-radius: 8px;
                border: 1px solid var(--border-medium);
                background: var(--bg-panel);
                font-size: var(--fs-body);
                color: var(--text-secondary);
                cursor: pointer;
              ">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span style="font-family: var(--font-mono); font-size: var(--fs-caption);">hermes-aura</span>
                <span style="font-size: var(--fs-micro); color: var(--text-muted);">▾</span>
              </div>

              <!-- Close Button -->
              <button id="btn-close-settings" title="${escapeHtml(t('settings.closeTooltip'))}" style="
                background: transparent;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 8px;
                transition: background 120ms ease, color 120ms ease;
              " onmouseover="this.style.background='var(--bg-panel)'; this.style.color='var(--text-main)';" onmouseout="this.style.background='transparent'; this.style.color='var(--text-muted)';">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          <!-- Dynamic Tab Pane Content Body -->
          <div style="flex: 1; overflow-y: auto; padding: 28px 32px;">
            ${renderTabContent(effectiveTab, props)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderNavItem(
  tab: SettingsTab,
  icon: string,
  label: string,
  activeTab: string,
  badge?: string
): string {
  const isActive = activeTab === tab;
  return `
    <button class="settings-tab-btn ${isActive ? 'active' : ''}" data-tab="${tab}" style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      height: 34px;
      padding: 0 10px;
      border-radius: 8px;
      border: none;
      background: ${isActive ? 'var(--bg-card)' : 'transparent'};
      color: ${isActive ? 'var(--text-main)' : 'var(--text-secondary)'};
      font-weight: ${isActive ? '600' : '400'};
      font-size: var(--fs-body);
      cursor: pointer;
      text-align: left;
      transition: background 100ms ease, color 100ms ease;
      box-shadow: ${isActive ? '0 1px 3px rgba(0,0,0,0.06)' : 'none'};
    ">
      <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <span style="font-size: var(--fs-body); opacity: 0.85;">${icon}</span>
        <span>${escapeHtml(label)}</span>
      </div>
      ${
        badge
          ? `<span style="font-size: var(--fs-micro); padding: 2px 5px; border-radius: 4px; background: var(--accent-subtle); color: var(--warning); font-weight: 600;">${escapeHtml(badge)}</span>`
          : ''
      }
    </button>
  `;
}

function getTabBreadcrumb(tab: string): string {
  const map: Record<string, string> = {
    general: t('settings.navGeneral'),
    appearance: t('settings.navAppearance'),
    chat: t('settings.navChat'),
    notifications: t('settings.navNotifications'),
    sessions: t('settings.navSessions'),
    routing: t('settings.navRouting'),
    keybindings: t('settings.navKeybindings'),
    voice: t('settings.navVoice'),
    integrations: t('settings.navIntegrations'),
    extensions: t('settings.navExtensions'),
    usage: t('settings.navUsage'),
    about: t('settings.navAbout'),
    projects: t('settings.navProjects'),
    gateways: t('settings.navGateways'),
    tunnels: t('settings.navTunnels'),
    git: t('settings.navGit'),
    providers: t('settings.navProviders'),
    websearch: t('settings.navWebsearch'),
    agents: t('settings.navAgents'),
    behavior: t('settings.navBehavior'),
  };
  return map[tab] || t('titlebar.settings');
}

function renderTabContent(tab: string, props: SettingsModalProps): string {
  switch (tab) {
    case 'providers':
      return renderProvidersTab(props);

    case 'gateways':
    case 'gateway':
      return renderGatewaysTab(props);

    case 'appearance':
      return renderAppearanceTab(props);

    case 'general':
      return renderGeneralTab(props);

    case 'about':
      return renderAboutTab(props);

    default:
      return renderGenericPlaceholderTab(tab);
  }
}

/**
 * 1:1 Aligned with User Reference Screenshot
 */
function renderProvidersTab(props: SettingsModalProps): string {
  return `
    <div style="display: flex; flex-direction: column; gap: 24px;">
      <!-- Title & Subtitle -->
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <h2 style="font-size: var(--fs-hero); font-weight: 700; color: var(--text-main); margin: 0;">${escapeHtml(t('settings.providersTitle'))}</h2>
        <p style="font-size: var(--fs-body); color: var(--text-secondary); margin: 0;">
          ${escapeHtml(t('settings.providersSub'))}
        </p>
      </div>

      <!-- Search Input -->
      <div style="position: relative; max-width: 480px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
        ">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" placeholder="${escapeHtml(t('settings.searchProviders'))}" style="
          width: 100%;
          height: 36px;
          background: var(--bg-panel);
          border: 1px solid var(--border-medium);
          border-radius: 8px;
          padding: 0 12px 0 36px;
          font-size: var(--fs-body);
          color: var(--text-main);
          outline: none;
          box-sizing: border-box;
        " />
      </div>

      <!-- Active Provider Cards Grid (2x3) -->
      <div style="
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 16px;
      ">
        <!-- Card 1: Add Provider Action Card -->
        <div class="provider-action-card" style="
          border: 1px dashed var(--border-medium);
          background: rgba(0, 0, 0, 0.02);
          border-radius: 12px;
          min-height: 120px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: border-color 140ms ease, background 140ms ease;
        " onmouseover="this.style.borderColor='var(--accent)'; this.style.background='var(--accent-subtle)';" onmouseout="this.style.borderColor='var(--border-medium)'; this.style.background='rgba(0,0,0,0.02)';">
          <div style="
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: var(--bg-panel);
            border: 1px solid var(--border-subtle);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: var(--fs-title);
            color: var(--text-main);
          ">+</div>
          <span style="font-size: var(--fs-body); font-weight: 600; color: var(--text-main);">${escapeHtml(t('settings.connectProvider'))}</span>
          <span style="font-size: var(--fs-caption); color: var(--text-muted);">${escapeHtml(t('settings.connectProviderSub'))}</span>
        </div>

        <!-- Card 2: 分类提供方 (jev) -->
        ${renderProviderCard(t('settings.providerJevTitle'), 'jev', t('settings.providerJevDesc'), t('settings.readyBadge'), 'var(--accent)', 'var(--accent-subtle)', undefined, '⬡')}

        <!-- Card 3: agnes-ai -->
        ${renderProviderCard('agnes-ai', undefined, undefined, t('settings.notLoggedInBadge'), 'var(--text-muted)', 'var(--bg-panel)', 1, '✦')}

        <!-- Card 4: CPA -->
        ${renderProviderCard('CPA', undefined, undefined, t('settings.connectedBadge'), 'var(--accent)', 'var(--accent-subtle)', 9, '✦')}

        <!-- Card 5: FN -->
        ${renderProviderCard('FN', undefined, undefined, t('settings.connectedBadge'), 'var(--accent)', 'var(--accent-subtle)', 6, '✦')}

        <!-- Card 6: magpie -->
        ${renderProviderCard('magpie', undefined, undefined, t('settings.connectedBadge'), 'var(--accent)', 'var(--accent-subtle)', 1, '✦')}

        <!-- Card 7: OpenCode -->
        ${renderProviderCard('OpenCode', undefined, undefined, t('settings.connectedBadge'), 'var(--accent)', 'var(--accent-subtle)', 11, '🗲')}
      </div>

      <!-- Disabled Providers List -->
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: var(--fs-body); font-weight: 600; color: var(--text-main);">${escapeHtml(t('settings.disabledProvidersTitle'))}</span>
          <span style="font-size: var(--fs-caption); color: var(--text-muted); cursor: pointer;" title="${escapeHtml(t('settings.disabledProvidersTooltip'))}">ⓘ</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${renderDisabledProviderRow('deepseek', '🦿')}
          ${renderDisabledProviderRow('ipraft', '✧')}
          ${renderDisabledProviderRow('vpi', '☁')}
        </div>
      </div>
    </div>
  `;
}

function renderProviderCard(
  title: string,
  subtitle?: string,
  desc?: string,
  statusBadge?: string,
  badgeColor?: string,
  badgeBg?: string,
  modelCount?: number,
  iconChar: string = '✦'
): string {
  return `
    <div class="provider-entity-card" style="
      border: 1px solid var(--border-medium);
      background: var(--bg-panel);
      border-radius: 12px;
      padding: 16px;
      min-height: 120px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,0.03);
      transition: border-color 140ms ease, box-shadow 140ms ease;
    " onmouseover="this.style.borderColor='var(--accent)';" onmouseout="this.style.borderColor='var(--border-medium)';">
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="
            width: 28px;
            height: 28px;
            border-radius: 6px;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: var(--fs-body);
            color: var(--text-main);
          ">${iconChar}</div>
          <div style="display: flex; flex-direction: column;">
            <span style="font-size: var(--fs-body); font-weight: 600; color: var(--text-main);">${escapeHtml(title)}</span>
            ${subtitle ? `<span style="font-size: var(--fs-caption); color: var(--text-muted);">${escapeHtml(subtitle)}</span>` : ''}
          </div>
        </div>

        ${
          statusBadge
            ? `<span style="
                font-size: var(--fs-micro);
                font-weight: 600;
                padding: 3px 7px;
                border-radius: 6px;
                color: ${badgeColor || 'var(--accent)'};
                background: ${badgeBg || 'var(--accent-subtle)'};
              ">${escapeHtml(statusBadge)}</span>`
            : ''
        }
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; font-size: var(--fs-caption); color: var(--text-muted);">
        <span>${desc ? escapeHtml(desc) : ''}</span>
        ${
          typeof modelCount === 'number'
            ? `<div style="display: flex; align-items: center; gap: 4px; font-family: var(--font-mono);">
                <span>⬡</span>
                <span>${modelCount}</span>
              </div>`
            : ''
        }
      </div>
    </div>
  `;
}

function renderDisabledProviderRow(name: string, icon: string): string {
  return `
    <div style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-panel);
    ">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: var(--fs-body); color: var(--text-muted);">${icon}</span>
        <span style="font-size: var(--fs-body); font-weight: 500; color: var(--text-secondary); font-family: var(--font-mono);">${escapeHtml(name)}</span>
      </div>
      <button style="
        padding: 4px 12px;
        border-radius: 6px;
        border: 1px solid var(--border-medium);
        background: var(--bg-card);
        color: var(--text-main);
        font-size: var(--fs-caption);
        font-weight: 500;
        cursor: pointer;
      ">${escapeHtml(t('settings.enableBtn'))}</button>
    </div>
  `;
}

/**
 * Gateways & Remote Instances Tab
 */
function renderGatewaysTab(props: SettingsModalProps): string {
  const isConnected = props.connectionStatus === 'connected';
  const isConnecting = props.connectionStatus === 'connecting';

  return `
    <div style="display: flex; flex-direction: column; gap: 24px;">
      <!-- Title & Subtitle -->
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <h2 style="font-size: var(--fs-hero); font-weight: 700; color: var(--text-main); margin: 0;">${escapeHtml(t('settings.gatewaysTitle'))}</h2>
        <p style="font-size: var(--fs-body); color: var(--text-secondary); margin: 0;">
          ${escapeHtml(t('settings.gatewaysSub'))}
        </p>
      </div>

      <!-- Live Connection Status Banner -->
      <div style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--bg-panel);
        border: 1px solid var(--border-medium);
        border-radius: 10px;
        padding: 12px 18px;
      ">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="
            width: 9px;
            height: 9px;
            border-radius: 50%;
            background: ${isConnected ? 'var(--success)' : isConnecting ? 'var(--warning)' : 'var(--destructive)'};
            box-shadow: 0 0 8px ${isConnected ? 'var(--success)' : isConnecting ? 'var(--warning)' : 'var(--destructive)'};
          "></span>
          <div style="display: flex; flex-direction: column;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: var(--fs-body); font-weight: 600; color: var(--text-main);">
                ${isConnected ? escapeHtml(t('settings.gatewayOnline')) : isConnecting ? escapeHtml(t('settings.gatewayConnecting')) : escapeHtml(t('settings.gatewayOffline'))}
              </span>
              ${isConnected ? `<span style="font-size: var(--fs-caption); padding: 2px 6px; border-radius: 4px; background: var(--accent-subtle); color: var(--success); font-family: var(--font-mono); font-weight: 600;">${props.latencyMs}ms</span>` : ''}
            </div>
            <span style="font-size: var(--fs-caption); color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">
              ${escapeHtml(props.gatewayUrl || '')}
            </span>
          </div>
        </div>

        <div>
          ${
            isConnected
              ? `<button id="btn-disconnect-gateway" style="
                  padding: 6px 14px;
                  font-size: var(--fs-caption);
                  font-weight: 600;
                  border-radius: 6px;
                  border: 1px solid var(--border-medium);
                  background: var(--bg-card);
                  color: var(--destructive);
                  cursor: pointer;
                ">${escapeHtml(t('settings.disconnectBtn'))}</button>`
              : ''
          }
        </div>
      </div>

      <!-- Gateway Nodes Grid -->
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: var(--fs-body); font-weight: 600; color: var(--text-main);">${escapeHtml(t('settings.savedNodes'))}</span>
          <span style="font-size: var(--fs-caption); color: var(--text-muted);">${escapeHtml(t('settings.savedNodesSub'))}</span>
        </div>

        <div style="
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
        ">
          <!-- Active Node Card -->
          <div style="
            border: 1.5px solid var(--accent);
            background: var(--bg-panel);
            border-radius: 10px;
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            box-shadow: 0 0 12px var(--accent-glow);
          ">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: var(--fs-body); font-weight: 600; color: var(--text-main);">${escapeHtml(t('settings.primaryNodeTitle'))}</span>
              <span style="font-size: var(--fs-micro); font-weight: 600; padding: 2px 6px; border-radius: 4px; background: var(--accent); color: var(--theme-thumb-color, var(--primary-foreground));">${escapeHtml(t('settings.activeNodeBadge'))}</span>
            </div>
            <span style="font-size: var(--fs-caption); color: var(--text-muted); font-family: var(--font-mono); word-break: break-all;">${escapeHtml(props.gatewayUrl || '')}</span>
            <div style="display: flex; align-items: center; justify-content: space-between; font-size: var(--fs-caption); color: var(--text-secondary); margin-top: 4px;">
              <span>Profile: <strong style="font-family: var(--font-mono);">${escapeHtml(props.profileName || 'default')}</strong></span>
              <span style="color: var(--success); font-weight: 600;">● ${isConnected ? escapeHtml(t('settings.nodeStatusLive')) : escapeHtml(t('settings.nodeStatusStandby'))}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Edit/Connect Form Area -->
      <div style="
        border: 1px solid var(--border-medium);
        background: var(--bg-panel);
        border-radius: 12px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      ">
        <span style="font-size: var(--fs-body); font-weight: 600; color: var(--text-main);">${escapeHtml(t('settings.connectionParamsTitle'))}</span>

        <!-- URL Input -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <label style="font-size: var(--fs-caption); font-weight: 600; color: var(--text-secondary);">${escapeHtml(t('settings.gatewayUrlLabel'))}</label>
            <span style="font-size: var(--fs-micro); color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(t('settings.gatewayUrlHint'))}</span>
          </div>
          <input type="text" id="settings-gateway-url" value="${escapeHtml(props.gatewayUrl || '')}" placeholder="${escapeHtml(t('settings.gatewayUrlPlaceholder'))}" style="
            width: 100%;
            height: 38px;
            background: var(--bg-card);
            border: 1px solid var(--border-medium);
            border-radius: 8px;
            padding: 0 12px;
            font-size: var(--fs-body);
            font-family: var(--font-mono);
            color: var(--text-main);
            outline: none;
            box-sizing: border-box;
          " />
        </div>

        <!-- Auth Username & Password -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: var(--fs-caption); font-weight: 600; color: var(--text-secondary);">${escapeHtml(t('settings.usernameLabel'))}</label>
            <input type="text" id="settings-username" value="${escapeHtml(props.username || '')}" placeholder="${escapeHtml(t('settings.usernamePlaceholder'))}" style="
              width: 100%;
              height: 38px;
              background: var(--bg-card);
              border: 1px solid var(--border-medium);
              border-radius: 8px;
              padding: 0 12px;
              font-size: var(--fs-body);
              font-family: var(--font-mono);
              color: var(--text-main);
              outline: none;
              box-sizing: border-box;
            " />
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: var(--fs-caption); font-weight: 600; color: var(--text-secondary);">${escapeHtml(t('settings.passwordLabel'))}</label>
            <input type="password" id="settings-password" value="${escapeHtml(props.password || '')}" placeholder="${escapeHtml(t('settings.passwordPlaceholder'))}" style="
              width: 100%;
              height: 38px;
              background: var(--bg-card);
              border: 1px solid var(--border-medium);
              border-radius: 8px;
              padding: 0 12px;
              font-size: var(--fs-body);
              font-family: var(--font-mono);
              color: var(--text-main);
              outline: none;
              box-sizing: border-box;
            " />
          </div>
        </div>

        <!-- Profile Name -->
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: var(--fs-caption); font-weight: 600; color: var(--text-secondary);">${escapeHtml(t('settings.profileLabel'))}</label>
          <input type="text" id="settings-profile-name" value="${escapeHtml(props.profileName || 'default')}" placeholder="default" style="
            width: 100%;
            height: 38px;
            background: var(--bg-card);
            border: 1px solid var(--border-medium);
            border-radius: 8px;
            padding: 0 12px;
            font-size: var(--fs-body);
            font-family: var(--font-mono);
            color: var(--text-main);
            outline: none;
            box-sizing: border-box;
          " />
        </div>

        <!-- Test Feedback Banner -->
        <div id="settings-test-feedback" style="
          display: ${props.testStatus ? 'flex' : 'none'};
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-radius: 8px;
          background: ${props.testStatus?.ok ? 'var(--accent-subtle)' : 'var(--bg-panel)'};
          border: 1px solid ${props.testStatus?.ok ? 'var(--accent)' : 'var(--border-medium)'};
          color: ${props.testStatus?.ok ? 'var(--success)' : 'var(--destructive)'};
          font-size: var(--fs-caption);
        ">
          <span>${props.testStatus?.ok ? '✓' : '✕'}</span>
          <span>${escapeHtml(props.testStatus?.message || '')}</span>
        </div>

        <!-- Action Buttons -->
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 6px;">
          <button id="btn-settings-test-connection" style="
            height: 38px;
            padding: 0 18px;
            border-radius: 8px;
            background: var(--bg-card);
            border: 1px solid var(--border-medium);
            color: var(--text-main);
            font-size: var(--fs-caption);
            font-weight: 500;
            cursor: pointer;
            transition: background 120ms ease;
          ">${escapeHtml(t('settings.testBtn'))}</button>

          <button id="btn-settings-save-connect" style="
            height: 38px;
            padding: 0 24px;
            border-radius: 8px;
            background: var(--accent);
            border: none;
            color: var(--theme-thumb-color, var(--primary-foreground));
            font-size: var(--fs-caption);
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 2px 8px var(--accent-glow);
            transition: opacity 120ms ease;
          ">${escapeHtml(t('settings.saveConnectBtn'))}</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Appearance Tab
 */
function renderAppearanceTab(props: SettingsModalProps): string {
  return `
    <div style="display: flex; flex-direction: column; gap: 24px;">
      <!-- Title & Subtitle -->
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <h2 style="font-size: var(--fs-hero); font-weight: 700; color: var(--text-main); margin: 0;">${escapeHtml(t('settings.appearanceTitle'))}</h2>
        <p style="font-size: var(--fs-body); color: var(--text-secondary); margin: 0;">
          ${escapeHtml(t('settings.appearanceSub'))}
        </p>
      </div>

      <!-- Theme Selection Grid -->
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <label style="font-size: var(--fs-caption); font-weight: 600; color: var(--text-secondary);">${escapeHtml(t('settings.colorThemeLabel'))}</label>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px;">
          ${renderThemeBtn('obsidian-gold', 'theme-preview-card-dark', t('common.theme.obsidianLabel'), t('settings.themeObsidianSub'), props.theme === 'obsidian-gold')}
          ${renderThemeBtn('jade-white', 'theme-preview-card-light', t('common.theme.jadeWhiteLabel'), t('settings.themeLightSub'), props.theme === 'jade-white' || props.theme === 'suet-jade')}
          ${renderThemeBtn('ayu-light', 'theme-preview-card-ayu', t('common.theme.ayuLightLabel'), t('settings.themeAyuSub'), props.theme === 'ayu-light' || props.theme === 'warm-paper')}
          ${renderThemeBtn('cyber-matrix', 'theme-preview-card-cyber', t('common.theme.cyberMatrixLabel'), t('settings.themeCyberSub'), props.theme === 'cyber-matrix')}
        </div>
      </div>

      <!-- Typography Settings -->
      <div style="display: flex; flex-direction: column; gap: 14px; border-top: 1px solid var(--border-subtle); padding-top: 20px;">
        <label style="font-size: var(--fs-caption); font-weight: 600; color: var(--text-secondary);">${escapeHtml(t('settings.fontSection'))}</label>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: var(--fs-caption); color: var(--text-secondary);">${escapeHtml(t('settings.uiFont'))}</label>
            <select class="settings-font-select" data-font-kind="ui" style="
              height: 38px;
              padding: 0 10px;
              border-radius: 8px;
              border: 1px solid var(--border-medium);
              background: var(--bg-panel);
              color: var(--text-main);
              font-size: var(--fs-body);
              outline: none;
            ">
              ${getUiFontSelectOptions().map((o) => `<option value="${o.id}" ${o.id === props.fontPrefs?.uiFont ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: var(--fs-caption); color: var(--text-secondary);">${escapeHtml(t('settings.codeFont'))}</label>
            <select class="settings-font-select" data-font-kind="mono" style="
              height: 38px;
              padding: 0 10px;
              border-radius: 8px;
              border: 1px solid var(--border-medium);
              background: var(--bg-panel);
              color: var(--text-main);
              font-size: var(--fs-body);
              outline: none;
            ">
              ${MONO_FONT_OPTIONS.map((o) => `<option value="${o.id}" ${o.id === props.fontPrefs?.monoFont ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          <label style="font-size: var(--fs-caption); color: var(--text-secondary);">${escapeHtml(t('settings.textSize'))}</label>
          <div class="settings-font-scale" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 400px;">
            ${(['small', 'medium', 'large'] as const).map((scale) => {
              const active = props.fontPrefs?.sizeScale === scale;
              const label = t(scale === 'small' ? 'settings.sizeSmall' : scale === 'large' ? 'settings.sizeLarge' : 'settings.sizeMedium');
              return `<button class="settings-font-scale-btn ${active ? 'active' : ''}" data-scale="${scale}" style="
                height: 36px;
                border-radius: 8px;
                border: 1px solid ${active ? 'var(--accent)' : 'var(--border-medium)'};
                background: ${active ? 'var(--accent-subtle)' : 'var(--bg-panel)'};
                color: ${active ? 'var(--accent)' : 'var(--text-main)'};
                font-size: var(--fs-caption);
                font-weight: ${active ? '600' : '400'};
                cursor: pointer;
              ">${escapeHtml(label)}</button>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderThemeBtn(
  themeId: string,
  variantClass: string,
  title: string,
  sub: string,
  active: boolean
): string {
  return `
    <button class="settings-theme-btn ${variantClass} ${active ? 'active' : ''}" data-theme="${themeId}" style="
      height: 72px;
      padding: 12px;
      border-radius: 10px;
      border: 1.5px solid ${active ? 'var(--accent)' : 'var(--border-medium)'};
      background: var(--bg-panel);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 4px;
      box-shadow: ${active ? '0 0 10px var(--accent-glow)' : 'none'};
      transition: border-color 120ms ease;
    ">
      <span class="theme-preview-title" style="font-size: var(--fs-body); font-weight: 600; color: var(--text-main);">${escapeHtml(title)}</span>
      <span class="theme-preview-sub" style="font-size: var(--fs-caption); color: var(--text-muted);">${escapeHtml(sub)}</span>
    </button>
  `;
}

/**
 * General Tab
 */
function renderGeneralTab(props: SettingsModalProps): string {
  return `
    <div style="display: flex; flex-direction: column; gap: 24px;">
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <h2 style="font-size: var(--fs-hero); font-weight: 700; color: var(--text-main); margin: 0;">${escapeHtml(t('settings.generalTitle'))}</h2>
        <p style="font-size: var(--fs-body); color: var(--text-secondary); margin: 0;">
          ${escapeHtml(t('settings.generalSub'))}
        </p>
      </div>

      <!-- Language Buttons -->
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <label style="font-size: var(--fs-caption); font-weight: 600; color: var(--text-secondary);">${escapeHtml(t('settings.langLabel'))}</label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 360px;">
          <button class="settings-lang-btn ${props.lang === 'zh' ? 'active' : ''}" data-lang="zh" style="
            height: 42px;
            border-radius: 8px;
            border: 1px solid ${props.lang === 'zh' ? 'var(--accent)' : 'var(--border-medium)'};
            background: ${props.lang === 'zh' ? 'var(--accent-subtle)' : 'var(--bg-panel)'};
            color: ${props.lang === 'zh' ? 'var(--accent)' : 'var(--text-main)'};
            font-weight: 600;
            font-size: var(--fs-body);
            cursor: pointer;
          ">${escapeHtml(t('settings.langZh'))}</button>
          <button class="settings-lang-btn ${props.lang !== 'zh' ? 'active' : ''}" data-lang="en" style="
            height: 42px;
            border-radius: 8px;
            border: 1px solid ${props.lang !== 'zh' ? 'var(--accent)' : 'var(--border-medium)'};
            background: ${props.lang !== 'zh' ? 'var(--accent-subtle)' : 'var(--bg-panel)'};
            color: ${props.lang !== 'zh' ? 'var(--accent)' : 'var(--text-main)'};
            font-weight: 600;
            font-size: var(--fs-body);
            cursor: pointer;
          ">${escapeHtml(t('settings.langEn'))}</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * About Tab
 */
function renderAboutTab(props: SettingsModalProps): string {
  return `
    <div style="display: flex; flex-direction: column; gap: 20px; max-width: 560px;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="
          width: 52px;
          height: 52px;
          border-radius: 12px;
          background: var(--accent);
          color: var(--theme-thumb-color, var(--primary-foreground));
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: var(--fs-hero);
          font-weight: 800;
        ">A</div>
        <div style="display: flex; flex-direction: column;">
          <h2 style="font-size: var(--fs-title); font-weight: 700; color: var(--text-main); margin: 0;">Hermes Flux Desktop</h2>
          <span style="font-size: var(--fs-caption); color: var(--text-muted); font-family: var(--font-mono);">v0.1.0-production · Built with @hermes-flux/core & @hermes-flux/ui</span>
        </div>
      </div>

      <p style="font-size: var(--fs-body); color: var(--text-secondary); line-height: 1.6; margin: 0;">
        ${escapeHtml(t('settings.aboutSub'))}
      </p>

      <div style="font-size: var(--fs-caption); color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 14px;">
        © 2026 Nous Research &amp; Hermes Flux Team. Open Source &amp; Universal.
      </div>
    </div>
  `;
}

/**
 * Generic Placeholder for upcoming modules
 */
function renderGenericPlaceholderTab(tab: string): string {
  return `
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <h2 style="font-size: var(--fs-hero); font-weight: 700; color: var(--text-main); margin: 0;">${escapeHtml(getTabBreadcrumb(tab))}</h2>
      <div style="
        border: 1px dashed var(--border-medium);
        background: var(--bg-panel);
        border-radius: 12px;
        padding: 40px 20px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      ">
        <span style="font-size: var(--fs-title);">⚙</span>
        <span style="font-size: var(--fs-body); font-weight: 600; color: var(--text-main);">${escapeHtml(t('settings.moduleWipTitle'))}</span>
        <span style="font-size: var(--fs-caption); color: var(--text-muted); max-width: 360px;">
          ${escapeHtml(t('settings.moduleWipDesc'))}
        </span>
      </div>
    </div>
  `;
}
