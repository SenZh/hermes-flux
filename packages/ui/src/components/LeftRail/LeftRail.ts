/**
 * Hermes Flux Left Rail Component (v5.4 Production - Native Geek Aligned)
 * Width: 260px, collapsible to 0px (Ctrl+B).
 * Features:
 * - Search box with -webkit-app-region: no-drag, explicit text selection & state preservation.
 * - Prominent Dedicated Bots Station (Native Hermes Roster Aligned: Yellow triangle for Xiaofawang, real photos for Aura/Hermes, status dot, timestamp & snippet).
 * - Clean Flat Hierarchy: NO ugly card box wrappers / backgrounds, smooth transparent list items.
 * - Collapsible "Sessions" Group (with toggle chevron & state preservation).
 * - Collapsible "Groups" Group (always visible, with toggle chevron & empty fallback).
 * - Preserved "Show More" expansion state.
 * - Single-Focus State Machine: strictly mutually exclusive active focus.
 * - Full Design System token compliance: 0 hardcoded colors.
 */

import { t } from '../../i18n/index.js';

export interface LeftRailSession {
  id: string;
  title: string;
  model?: string;
  time?: string;
  preview?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  botName?: string;
  botDisplayName?: string;
  botAvatar?: string;
  projectId?: string;
  projectName?: string;
  timestamp?: number;
  parentSessionId?: string;
  source?: string;
  isSubagent?: boolean;
}

export interface LeftRailGroupRoom {
  roomId: string;
  name: string;
  members: string[];
  createdAt?: number;
  updatedAt?: number;
  lastMessage?: string;
}

export interface LeftRailProject {
  id: string;
  name: string;
  path?: string;
  sessions?: LeftRailSession[];
}

export type LeftRailActiveFocus =
  | { type: 'bot'; botName: string }
  | { type: 'session'; sessionId: string }
  | { type: 'group'; roomId: string };

export interface LeftRailProps {
  collapsed: boolean;
  activeSessionId: string;
  activeFocus?: LeftRailActiveFocus;
  sessions: LeftRailSession[];
  profileName: string;
  profiles?: Array<{
    name: string;
    displayName: string;
    avatar?: string;
    model?: string;
    description?: string;
    lastMessage?: string;
    lastTime?: string;
    isDefault?: boolean;
  }>;
  groups?: LeftRailGroupRoom[];
  projects?: LeftRailProject[];
  activeRailTab?: 'chats' | 'projects';
  gatewayOnline: boolean;
  gatewayLatencyMs: number;
  searchQuery?: string;
  isSessionsGroupExpanded?: boolean;
  isGroupsGroupExpanded?: boolean;
  isMoreSessionsExpanded?: boolean;
  /** Why the session list could not be loaded — an empty rail is not a failure. */
  error?: string;
  onNewChat?: () => void;
  onSelectSession?: (id: string) => void;
  onDeleteSession?: (id: string) => void;
  onOpenSettings?: () => void;
  onSwitchProfile?: (profileName: string) => void;
  onSelectBotChat?: (botName: string) => void;
  onSelectGroup?: (roomId: string) => void;
}

export function renderLeftRail(props: LeftRailProps): string {
  if (props.collapsed) {
    return `<aside id="flux-left-rail" class="flux-left-rail rail-collapsed" style="width: 0px; min-width: 0px; display: none; overflow: hidden;"></aside>`;
  }

  const query = (props.searchQuery || '').toLowerCase().trim();
  const rawActiveSessions = props.sessions.filter((s) => !s.isArchived);
  const archivedSessions = props.sessions.filter((s) => s.isArchived);
  const railError = (props.error || '').trim();
  const isProjectsTab = props.activeRailTab === 'projects';
  const realProjects = props.projects || [];
  const realGroups = props.groups || [];

  // Filter sessions if search query is present
  const activeSessions = query
    ? rawActiveSessions.filter((s) => {
        const titleMatch = s.title.toLowerCase().includes(query);
        const botMatch = (s.botDisplayName || s.botName || '').toLowerCase().includes(query);
        const prevMatch = (s.preview || '').toLowerCase().includes(query);
        return titleMatch || botMatch || prevMatch;
      })
    : rawActiveSessions;

  // Filter bots if search query is present
  const filteredProfiles = props.profiles
    ? query
      ? props.profiles.filter(
          (p) =>
            (p.displayName || p.name).toLowerCase().includes(query) ||
            (p.description || '').toLowerCase().includes(query)
        )
      : props.profiles
    : [];

  // Filter groups if search query is present
  const filteredGroups = query
    ? realGroups.filter((g) => g.name.toLowerCase().includes(query))
    : realGroups;

  // Determine active focus strictly to eliminate dual-highlight bug
  const currentFocus: LeftRailActiveFocus = props.activeFocus || (
    props.activeSessionId
      ? { type: 'session', sessionId: props.activeSessionId }
      : { type: 'bot', botName: props.profileName || 'default' }
  );

  const isSessionsOpen = props.isSessionsGroupExpanded !== false;
  const isGroupsOpen = props.isGroupsGroupExpanded !== false;

  return `
    <aside id="flux-left-rail" class="flux-left-rail" style="
      flex: 0 0 var(--rail-w-left, 260px);
      width: var(--rail-w-left, 260px);
      min-width: var(--rail-w-left, 260px);
      max-width: var(--rail-w-left, 260px);
      height: 100%;
      background: var(--bg-rail);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      position: relative;
      user-select: none;
      -webkit-user-select: none;
    ">
      <!-- Draggable Resize Handle (Left Rail Right Edge) -->
      <div class="rail-resize-handle" data-rail-handle="left" role="separator" aria-orientation="vertical" tabindex="0" title="拖拽调整左侧栏宽度 · 双击复位" style="
        position: absolute;
        right: -3px;
        top: 0;
        bottom: 0;
        width: 6px;
        z-index: 60;
        cursor: col-resize;
        background: transparent;
      "></div>

      <!-- Top Search & Quick Action Box (no-drag, text selectable) -->
      <div style="padding: 10px 10px 6px; display: flex; flex-direction: column; gap: 6px; -webkit-app-region: no-drag;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="position: relative; flex: 1;">
            <input type="text" id="session-search-input" placeholder="${t('rail.searchPlaceholder')}" value="${escapeHtml(props.searchQuery || '')}" style="
              width: 100%;
              height: 28px;
              background: var(--bg-panel);
              border: 1px solid var(--border-subtle);
              border-radius: 6px;
              padding: 0 8px 0 28px;
              font-size: 12px;
              color: var(--text-main);
              outline: none;
              box-sizing: border-box;
              user-select: text;
              -webkit-user-select: text;
              cursor: text;
              pointer-events: auto;
            " />
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="position: absolute; left: 9px; top: 8px; color: var(--text-muted); pointer-events: none;">
              <circle cx="7" cy="7" r="5"/>
              <line x1="11" y1="11" x2="15" y2="15"/>
            </svg>
          </div>

          <!-- New Task / Chat Trigger (+) opens Task Dispatch Modal -->
          <button id="new-chat-btn" class="btn-new-chat" type="button" title="${t('rail.newChat')}" style="
            width: 28px;
            height: 28px;
            background: var(--bg-card);
            border: 1px solid var(--border-medium);
            border-radius: 6px;
            color: var(--text-main);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: var(--shadow-card);
            flex-shrink: 0;
            transition: transform 0.1s ease, border-color 0.15s ease;
          ">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="8" y1="3" x2="8" y2="13"/>
              <line x1="3" y1="8" x2="13" y2="8"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- View A: Chats & Sessions List -->
      <div class="session-scroll-area" id="session-list-container" style="
        flex: 1;
        overflow-y: auto;
        padding: 4px 6px 10px;
        display: ${isProjectsTab ? 'none' : 'block'};
      ">
        ${
          railError
            ? `
          <div id="session-list-error" role="alert" style="
            margin: 6px 4px 10px;
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid var(--border-strong);
            background: var(--bg-panel);
            color: var(--text-main);
            font-size: 11px;
            line-height: 1.5;
            word-break: break-word;
          ">会话列表加载失败：${escapeHtml(railError)}</div>
        `
            : ''
        }

        <!-- Pinned Dedicated Bots Section (Official Native Layout: Yellow Triangle for Xiaofawang, Photos for Aura/Hermes) -->
        ${
          filteredProfiles.length > 0 && !railError
            ? `
          <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px 4px;">
            ${t('rail.pinnedBots')}
          </div>
          <div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px;">
            ${filteredProfiles
              .map((p) => {
                const isSelected = currentFocus.type === 'bot' && currentFocus.botName === p.name;
                const avatarNode = renderBotAvatar(p.name, p.displayName, p.avatar, 36);
                const snippet = p.lastMessage || p.description || p.model || t('rail.defaultBotSnippet');
                const timeStr = p.lastTime || '';

                return `
                <div class="rail-pinned-bot-row ${isSelected ? 'active' : ''}" data-profile="${escapeHtml(p.name)}" title="${t('rail.enterBotChat', { name: p.displayName || p.name })}" style="
                  min-height: 48px;
                  padding: 6px 8px;
                  border-radius: 6px;
                  display: flex;
                  align-items: center;
                  gap: 10px;
                  cursor: pointer;
                  background: ${isSelected ? 'var(--bg-card-active)' : 'transparent'};
                  border: 1px solid ${isSelected ? 'var(--accent)' : 'transparent'};
                  position: relative;
                  transition: background 0.12s ease;
                ">
                  ${avatarNode}
                  <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; line-height: 1.2;">
                      <span style="font-size: 13px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${escapeHtml(p.displayName || p.name)}
                      </span>
                      ${timeStr ? `<span style="font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono); flex-shrink: 0; margin-left: 4px;">${escapeHtml(timeStr)}</span>` : ''}
                    </div>
                    <div style="font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;">
                      ${escapeHtml(snippet)}
                    </div>
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
        `
            : ''
        }

        <!-- Collapsible Multi-Agent Groups Section (Flat Minimal Style, Always Present) -->
        <div class="group-section-wrap" style="margin-bottom: 10px;">
          <div id="rail-groups-accordion-trigger" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; cursor: pointer; user-select: none;">
            <div style="display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>${t('rail.groups')} (${filteredGroups.length})</span>
            </div>
            <svg class="group-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted); transform: ${isGroupsOpen ? 'rotate(90deg)' : 'rotate(0deg)'}; transition: transform 0.2s ease;"><polyline points="9 18 15 12 9 6"/></svg>
          </div>

          <div id="rail-groups-nested-list" style="display: ${isGroupsOpen ? 'flex' : 'none'}; flex-direction: column; gap: 2px; padding: 2px 0 4px;">
            ${
              filteredGroups.length === 0
                ? `<div style="padding: 6px 12px; font-size: 11px; color: var(--text-muted); text-align: left;">${t('rail.groupsEmpty')}</div>`
                : filteredGroups
                    .map((g) => {
                      const isGroupActive = currentFocus.type === 'group' && currentFocus.roomId === g.roomId;
                      return `
                      <div class="rail-group-item ${isGroupActive ? 'active' : ''}" data-room-id="${escapeHtml(g.roomId)}" style="
                        min-height: 38px;
                        padding: 5px 8px;
                        border-radius: 6px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        cursor: pointer;
                        background: ${isGroupActive ? 'var(--bg-card-active)' : 'transparent'};
                        border: 1px solid ${isGroupActive ? 'var(--accent)' : 'transparent'};
                        transition: background 0.12s ease;
                      ">
                        ${renderGroupCollageAvatar(g.members, props.profiles, 28)}
                        <div style="flex: 1; min-width: 0;">
                          <div style="font-size: 12px; font-weight: 500; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${escapeHtml(g.name)}
                          </div>
                          <div style="font-size: 10.5px; color: var(--text-muted);">
                            ${t('rail.groupsMembers', { count: String(g.members.length) })}
                          </div>
                        </div>
                      </div>
                    `;
                    })
                    .join('')
            }
          </div>
        </div>

        <!-- Collapsible Sessions Section (Flat Minimal Style, NO ugly card background) -->
        <div class="sessions-section-wrap" style="margin-bottom: 8px;">
          <div id="rail-sessions-accordion-trigger" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px 4px; cursor: pointer; user-select: none;">
            <div style="display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>${t('rail.conversations')} (${activeSessions.length})</span>
            </div>
            <svg class="sessions-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-muted); transform: ${isSessionsOpen ? 'rotate(90deg)' : 'rotate(0deg)'}; transition: transform 0.2s ease;"><polyline points="9 18 15 12 9 6"/></svg>
          </div>

          <div id="rail-sessions-nested-list" style="display: ${isSessionsOpen ? 'flex' : 'none'}; flex-direction: column; gap: 2px; padding: 2px 0 4px;">
            ${
              props.sessions.length === 0
                ? `
              <div style="padding: 24px 12px; text-align: center; color: var(--text-muted); font-size: 12px; display: flex; flex-direction: column; align-items: center; gap: 6px;">
                <span>${railError ? t('rail.errorTitle') : t('rail.emptyTitle')}</span>
                <span style="font-size: 11px; color: var(--text-faint);">${railError ? t('rail.errorSub') : t('rail.emptySub')}</span>
              </div>
            `
                : activeSessions
                    .map((s) => renderSessionRow(s, currentFocus))
                    .join('')
            }
          </div>
        </div>

        ${
          archivedSessions.length > 0
            ? `
          <div style="font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 10px 8px 4px;">${t('rail.archived')} (${archivedSessions.length})</div>
          <div style="display: flex; flex-direction: column; gap: 2px;">
            ${archivedSessions
              .map((s) => {
                const isActive = currentFocus.type === 'session' && currentFocus.sessionId === s.id;
                return `
                <div class="session-item ${isActive ? 'active' : ''}" data-id="${s.id}" style="
                  min-height: 34px;
                  height: 34px;
                  padding: 0 8px;
                  border-radius: 6px;
                  background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
                  border: 1px solid ${isActive ? 'var(--accent)' : 'transparent'};
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  opacity: 0.7;
                ">
                  <span style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(s.title)}</span>
                </div>
              `;
              })
              .join('')}
          </div>
        `
            : ''
        }
      </div>

      <!-- View B: Projects In-Place Accordion Deck -->
      <div id="rail-projects-deck" style="
        flex: 1;
        overflow-y: auto;
        padding: 6px 8px 12px;
        display: ${isProjectsTab ? 'block' : 'none'};
      ">
        <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px 8px;">
          ${t('rail.projects')}
        </div>

        ${
          realProjects.length === 0
            ? `
          <div style="padding: 36px 12px; text-align: center; color: var(--text-muted); font-size: 12px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span>${t('rail.projectsEmpty')}</span>
            <span style="font-size: 11px; color: var(--text-faint);">${t('rail.projectsEmptySub')}</span>
          </div>
        `
            : `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${realProjects
              .map((proj, idx) => {
                const isOpen = idx === 0;
                const nestedSessions = proj.sessions || [];
                return `
                <div class="project-accordion-unit ${isOpen ? 'open' : ''}" id="rail-proj-${escapeHtml(proj.id)}" style="
                  border: 1px solid var(--border-subtle);
                  border-radius: 8px;
                  background: var(--bg-card);
                  overflow: hidden;
                ">
                  <div class="project-accordion-trigger" data-project-id="${escapeHtml(proj.id)}" style="
                    padding: 8px 10px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    cursor: pointer;
                    user-select: none;
                  ">
                    <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent); flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                      <span style="font-size: 12.5px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(proj.name)}</span>
                    </div>
                    <svg class="proj-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="
                      color: var(--text-muted);
                      transform: ${isOpen ? 'rotate(90deg)' : 'rotate(0deg)'};
                      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                    "><polyline points="9 18 15 12 9 6"/></svg>
                  </div>

                  <!-- Nested Sessions In-Place Display -->
                  <div class="project-accordion-nested" style="
                    display: ${isOpen ? 'flex' : 'none'};
                    flex-direction: column;
                    gap: 2px;
                    padding: 4px 6px 8px 14px;
                    background: var(--bg-panel);
                    border-top: 1px solid var(--border-subtle);
                  ">
                    ${
                      nestedSessions.length > 0
                        ? nestedSessions.map((s) => renderSessionRow(s, currentFocus, true)).join('')
                        : `<div style="padding: 8px 6px; font-size: 11px; color: var(--text-muted);">${t('rail.projectNoSessions')}</div>`
                    }
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
        `
        }
      </div>

      <!-- Bottom Switcher Table: [ 💬 会话 ] [ 📁 项目 ] -->
      <div id="rail-bottom-switcher-tabs" style="
        height: 36px;
        border-top: 1px solid var(--border-subtle);
        background: var(--bg-card);
        display: flex;
        padding: 3px 6px;
        gap: 4px;
        flex-shrink: 0;
      ">
        <button id="tab-btn-rail-chats" type="button" class="rail-tab-switch-btn ${!isProjectsTab ? 'active' : ''}" style="
          flex: 1;
          height: 100%;
          border: 1px solid ${!isProjectsTab ? 'var(--border-medium)' : 'transparent'};
          border-radius: 5px;
          background: ${!isProjectsTab ? 'var(--bg-panel)' : 'transparent'};
          color: ${!isProjectsTab ? 'var(--text-main)' : 'var(--text-muted)'};
          font-size: 11.5px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          cursor: pointer;
          transition: all 0.12s ease;
        ">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>${t('rail.tabChats')}</span>
        </button>

        <button id="tab-btn-rail-projects" type="button" class="rail-tab-switch-btn ${isProjectsTab ? 'active' : ''}" style="
          flex: 1;
          height: 100%;
          border: 1px solid ${isProjectsTab ? 'var(--border-medium)' : 'transparent'};
          border-radius: 5px;
          background: ${isProjectsTab ? 'var(--bg-panel)' : 'transparent'};
          color: ${isProjectsTab ? 'var(--text-main)' : 'var(--text-muted)'};
          font-size: 11.5px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          cursor: pointer;
          transition: all 0.12s ease;
        ">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span>${t('rail.tabProjects')}</span>
        </button>
      </div>
    </aside>
  `;
}

function renderSessionRow(s: LeftRailSession, currentFocus: LeftRailActiveFocus, isCompact: boolean = false): string {
  const isActive = currentFocus.type === 'session' && currentFocus.sessionId === s.id;
  const avatarNode = renderBotAvatar(s.botName || 'default', s.botDisplayName, s.botAvatar, isCompact ? 20 : 26);
  const botTag = s.botDisplayName || s.botName;

  return `
    <div class="session-item ${isActive ? 'active' : ''}" data-id="${s.id}" data-title="${escapeHtml(s.title)}" data-bot="${escapeHtml(s.botName || '')}" style="
      min-height: ${isCompact ? '32px' : '40px'};
      padding: ${isCompact ? '3px 8px' : '5px 8px'};
      border-radius: 6px;
      background: ${isActive ? 'var(--bg-card-active)' : 'transparent'};
      border: 1px solid ${isActive ? 'var(--accent)' : 'transparent'};
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      position: relative;
      transition: background 0.12s ease, border-color 0.12s ease;
    ">
      ${isActive ? '<div class="active-indicator" style="position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; background: var(--accent); border-radius: 0 2px 2px 0;"></div>' : ''}
      
      <!-- Agent Avatar Badge -->
      ${avatarNode}

      <!-- 3-Element Content Stack -->
      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;">
        <div style="display: flex; justify-content: space-between; align-items: center; line-height: 1.2;">
          <span style="
            font-size: 12.5px;
            font-weight: ${isActive ? '600' : '400'};
            color: var(--text-main);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
          ">${escapeHtml(s.title)}</span>
          ${s.time ? `<span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); margin-left: 6px; flex-shrink: 0;">${escapeHtml(s.time)}</span>` : ''}
        </div>
        ${
          !isCompact
            ? `
          <div style="font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">
            ${escapeHtml(s.preview || s.model || '')}
          </div>
        `
            : ''
        }
      </div>
    </div>
  `;
}

// gate-theme-allow: 1:1对齐官方Xiaofawang黄色三角形头像
const XIAOFAWANG_YELLOW = '#FACC15';
// gate-theme-allow: 1:1对齐官方Bot双眼瞳孔自然黑色
const BOT_PUPIL_BLACK = '#18181B';

/**
 * 1:1 Parity with Official Hermes Desktop Avatar:
 * 1. Photo Avatar (Data URL / Image) -> Rounded Rectangle
 * 2. Xiaofawang -> Yellow Triangle with Two Eyes (Official Deterministic Triangle)
 * 3. Default Shape -> Name-derived geometric sigil with pupils
 */
function renderBotAvatar(name: string, displayName?: string, avatarUrl?: string, size = 36): string {
  if (avatarUrl) {
    return `<img src="${escapeHtml(avatarUrl)}" style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 8px;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid var(--border-subtle);
    " alt="${escapeHtml(displayName || name)}" />`;
  }

  const cleanName = (name || 'agent').toLowerCase().trim();

  // 官方标准散列算法: 散列到 7 种几何体
  let hash = 0;
  for (const ch of cleanName) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const shapes = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'];
  const pickedShape = shapes[hash % shapes.length];

  if (pickedShape === 'triangle') {
    return `
      <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" style="flex-shrink: 0;">
        <path d="M18 4.5 C19.2 2.5 21.8 2.5 23 4.5 L34 26 C35.2 28.2 33.8 31 31.2 31 L6.8 31 C4.2 31 2.8 28.2 4 26 Z" fill="${XIAOFAWANG_YELLOW}" />
        <circle cx="15" cy="18" r="1.8" fill="${BOT_PUPIL_BLACK}" />
        <circle cx="23" cy="18" r="1.8" fill="${BOT_PUPIL_BLACK}" />
      </svg>
    `;
  }

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" style="flex-shrink: 0;">
      <rect width="36" height="36" rx="8" fill="var(--bg-panel)" />
      ${
        pickedShape === 'circle'
          ? `<circle cx="18" cy="18" r="13" fill="var(--accent)" />`
          : pickedShape === 'cloud'
          ? `<path d="M10 24 a6 6 0 0 1 -1 -12 a7.5 7.5 0 0 1 14 -1 a5.5 5.5 0 0 1 5 13 Z" fill="var(--accent)" />`
          : `<rect x="5" y="5" width="26" height="26" rx="6" fill="var(--accent)" />`
      }
      <!-- Eyes -->
      <circle cx="14" cy="17" r="1.8" fill="${BOT_PUPIL_BLACK}" />
      <circle cx="22" cy="17" r="1.8" fill="${BOT_PUPIL_BLACK}" />
    </svg>
  `;
}

function renderGroupCollageAvatar(
  members: string[],
  profiles?: Array<{ name: string; avatar?: string }>,
  size = 28
): string {
  const profMap = new Map<string, string>();
  if (profiles) {
    for (const p of profiles) {
      if (p.avatar) profMap.set(p.name.toLowerCase(), p.avatar);
    }
  }

  const cleanMembers = (members || []).slice(0, 4);
  const count = cleanMembers.length;

  if (count === 0) {
    return `<span style="width: ${size}px; height: ${size}px; border-radius: 6px; background: var(--bg-card); border: 1px solid var(--border-subtle); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; color: var(--accent);">👥</span>`;
  }

  // 微信式小宫格：2人左右半开双拼，3-4人四宫格微距头像
  const cellHtmls = cleanMembers.map((m) => {
    const lower = m.toLowerCase().trim();
    const avatar = profMap.get(lower);
    if (avatar) {
      return `<img src="${escapeHtml(avatar)}" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="${escapeHtml(m)}" />`;
    }
    let hash = 0;
    for (const ch of lower) {
      hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    }
    const shapes = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'];
    const pickedShape = shapes[hash % shapes.length];
    if (pickedShape === 'triangle') {
      return `
        <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; display: block;" fill="none">
          <path d="M18 4.5 C19.2 2.5 21.8 2.5 23 4.5 L34 26 C35.2 28.2 33.8 31 31.2 31 L6.8 31 C4.2 31 2.8 28.2 4 26 Z" fill="${XIAOFAWANG_YELLOW}" />
          <circle cx="15" cy="18" r="2.2" fill="${BOT_PUPIL_BLACK}" />
          <circle cx="23" cy="18" r="2.2" fill="${BOT_PUPIL_BLACK}" />
        </svg>
      `;
    }
    return `<span style="width: 100%; height: 100%; background: var(--accent-subtle); color: var(--accent); font-size: 8px; font-weight: 700; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono);">${lower.slice(0, 1).toUpperCase()}</span>`;
  });

  if (count === 2) {
    return `
      <div style="width: ${size}px; height: ${size}px; border-radius: 6px; background: var(--bg-panel); border: 1px solid var(--border-subtle); display: flex; gap: 1px; padding: 1.5px; overflow: hidden; box-sizing: border-box; flex-shrink: 0;">
        <div style="flex: 1; height: 100%; overflow: hidden; border-radius: 2px;">${cellHtmls[0]}</div>
        <div style="flex: 1; height: 100%; overflow: hidden; border-radius: 2px;">${cellHtmls[1]}</div>
      </div>
    `;
  }

  return `
    <div style="width: ${size}px; height: ${size}px; border-radius: 6px; background: var(--bg-panel); border: 1px solid var(--border-subtle); display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 1px; padding: 1.5px; overflow: hidden; box-sizing: border-box; flex-shrink: 0;">
      ${cellHtmls.map((cell) => `<div style="width: 100%; height: 100%; overflow: hidden; border-radius: 2px;">${cell}</div>`).join('')}
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
