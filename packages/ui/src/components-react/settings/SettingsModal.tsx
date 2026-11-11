import * as React from 'react';
import { Blocks, Bot, Info, KeyRound, Palette, Plug, RefreshCw, Search, X } from 'lucide-react';
import { t } from '../../i18n/index.js';
import type { I18nKey } from '../../i18n/index.js';
import { SKINS, SKIN_ALIASES, type SkinId } from '../../tokens/skins.js';
import { getUiFontSelectOptions, MONO_FONT_OPTIONS } from '../../tokens/fonts.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import { Badge } from '../primitives/Badge.js';
import { SegmentedControl } from './SegmentedControl.js';
import { LoadBoundary } from './LoadBoundary.js';
import { ProvidersAdminPanel } from './ProvidersAdminPanel.js';
import {
  SETTINGS_SECTIONS,
  filterSettingsSections,
  type GatewayDraft,
  type SettingsActions,
  type SettingsActionResult,
  type SettingsIconName,
  type SettingsLoadable,
  type SettingsSectionDef,
  type SettingsSectionId,
  type SettingsSnapshot,
} from './settingsModel.js';

const ICONS: Record<SettingsIconName, React.ComponentType<{ size?: number; className?: string }>> = {
  palette: Palette,
  key: KeyRound,
  bot: Bot,
  blocks: Blocks,
  plug: Plug,
  info: Info,
};

/** 主题卡片顺序：与 SKINS 真值表一致，别名皮肤不单独成卡。 */
const THEME_ORDER = ['obsidian-gold', 'jade-white', 'warm-paper', 'ayu-light', 'cyber-matrix'] as const;

const THEME_LABEL_KEY: Record<(typeof THEME_ORDER)[number], I18nKey> = {
  'obsidian-gold': 'common.theme.obsidianLabel',
  'jade-white': 'common.theme.jadeWhiteLabel',
  'warm-paper': 'common.theme.warmPaperLabel',
  'ayu-light': 'common.theme.ayuLightLabel',
  'cyber-matrix': 'common.theme.cyberMatrixLabel',
};

/**
 * 设置行的唯一实现。
 * 【设计意图】所有设置项共用同一行骨架（左标签右控件），避免每个面板各写一套间距与字阶。
 * 【规则】label 必填；hint 用于解释"为什么需要它"，不是重复 label。
 */
function SettingRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border-subtle py-3 last:border-b-0">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-body text-foreground">
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function StatusDot({ tone }: { tone: 'success' | 'warning' | 'destructive' | 'muted' }): React.ReactElement {
  const color =
    tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : tone === 'destructive' ? 'bg-destructive' : 'bg-muted-foreground';
  return <span className={`size-1.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
}

function AppearancePanel({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement {
  const activeTheme = SKIN_ALIASES[snapshot.theme] ?? snapshot.theme;
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="mb-1 text-section font-medium text-foreground">{t('settings.themeTitle')}</h3>
        <p className="mb-3 text-caption text-muted-foreground">{t('settings.themeHint')}</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('settings.themeTitle')}>
          {THEME_ORDER.map((id) => {
            const skin = SKINS[id];
            if (!skin) return null;
            const active = activeTheme === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                data-theme-option={id}
                onClick={() => actions.onThemeChange(id)}
                className={`flex items-center gap-3 rounded-panel border px-3 py-2.5 text-left transition-colors ${
                  active ? 'border-primary bg-primary-subtle' : 'border-border-subtle bg-transparent hover:bg-card-hover'
                }`}
              >
                <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
                  <span className="size-4 rounded-inner border border-border" style={{ background: skin.slots['--background'] }} />
                  <span className="size-4 rounded-inner border border-border" style={{ background: skin.slots['--foreground'] }} />
                  <span className="size-4 rounded-inner border border-border" style={{ background: skin.slots['--primary'] }} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body text-foreground">{t(THEME_LABEL_KEY[id])}</span>
                  <span className="text-micro text-muted-foreground">
                    {skin.variant === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-section font-medium text-foreground">{t('settings.typographyTitle')}</h3>
        <p className="mb-2 text-caption text-muted-foreground">{t('settings.typographyHint')}</p>
        <SettingRow label={t('settings.uiFont')} htmlFor="settings-ui-font">
          <select
            id="settings-ui-font"
            value={snapshot.fontPrefs.uiFont}
            onChange={(event) => actions.onFontPrefsChange({ ...snapshot.fontPrefs, uiFont: event.target.value as typeof snapshot.fontPrefs.uiFont })}
            className="h-8 min-w-40 rounded-inner border border-border bg-input px-2 text-body text-foreground"
          >
            {getUiFontSelectOptions().map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('settings.codeFont')} htmlFor="settings-mono-font">
          <select
            id="settings-mono-font"
            value={snapshot.fontPrefs.monoFont}
            onChange={(event) => actions.onFontPrefsChange({ ...snapshot.fontPrefs, monoFont: event.target.value as typeof snapshot.fontPrefs.monoFont })}
            className="h-8 min-w-40 rounded-inner border border-border bg-input px-2 text-body text-foreground"
          >
            {MONO_FONT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('settings.textSize')}>
          <SegmentedControl
            ariaLabel={t('settings.textSize')}
            value={snapshot.fontPrefs.sizeScale}
            onChange={(sizeScale) => actions.onFontPrefsChange({ ...snapshot.fontPrefs, sizeScale })}
            options={[
              { value: 'small', label: t('settings.sizeSmall') },
              { value: 'medium', label: t('settings.sizeMedium') },
              { value: 'large', label: t('settings.sizeLarge') },
            ]}
          />
        </SettingRow>
      </section>

      <section>
        <h3 className="mb-1 text-section font-medium text-foreground">{t('settings.languageTitle')}</h3>
        <p className="mb-2 text-caption text-muted-foreground">{t('settings.languageHint')}</p>
        <SettingRow label={t('settings.languageLabel')}>
          <SegmentedControl
            ariaLabel={t('settings.languageLabel')}
            value={snapshot.locale}
            onChange={(locale) => actions.onLocaleChange(locale)}
            options={[
              { value: 'zh', label: t('settings.languageZh') },
              { value: 'en', label: t('settings.languageEn') },
            ]}
          />
        </SettingRow>
      </section>
    </div>
  );
}

/**
 * 提供商域（唯一入口）。
 * 【设计意图】这个面板只做一件事：把统一提供商表画出来。
 *   历史上这里叠了两块同源列表（一块来自 model.options 的原始 54 行，一块来自端点 REST），
 *   同一件事说两遍、口径还不一致。现在只有 ProvidersAdminPanel 一处。
 */
function ProvidersPanel({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement {
  return <ProvidersAdminPanel snapshot={snapshot} actions={actions} />;
}

function AgentsPanel({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption text-muted-foreground">{t('settings.agentsHint')}</p>
        <Button variant="outline" size="sm" type="button" disabled={snapshot.busy} onClick={actions.onRefreshProfiles}>
          <RefreshCw size={12} />
          {t('settings.refresh')}
        </Button>
      </div>
      <LoadBoundary state={snapshot.profiles} onRetry={actions.onRefreshProfiles} emptyLabel={t('settings.agentsEmpty')}>
        {(rows) => (
          <div className="flex flex-col">
            {rows.map((row) => (
              <div
                key={row.name}
                className="flex items-center justify-between gap-4 border-b border-border-subtle py-3 last:border-b-0"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-body text-foreground">{row.displayName}</span>
                    {row.isDefault ? <Badge variant="outline">{t('settings.agentDefault')}</Badge> : null}
                  </span>
                  <span className="truncate text-caption text-muted-foreground">
                    {row.model ? row.model : t('settings.agentNoModel')}
                  </span>
                </div>
                <Button variant="outline" size="sm" type="button" onClick={() => actions.onOpenAgent(row.name)}>
                  {t('settings.agentOpen')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </LoadBoundary>
    </div>
  );
}

function ExtensionsPanel({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-section font-medium text-foreground">{t('settings.mcpTitle')}</h3>
          <Button variant="outline" size="sm" type="button" disabled={snapshot.busy} onClick={actions.onRefreshExtensions}>
            <RefreshCw size={12} />
            {t('settings.refresh')}
          </Button>
        </div>
        <LoadBoundary state={snapshot.mcp} onRetry={actions.onRefreshExtensions} emptyLabel={t('settings.mcpEmpty')}>
          {(rows) => (
            <div className="flex flex-col">
              {rows.map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between gap-4 border-b border-border-subtle py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusDot tone={row.disabled ? 'muted' : row.connected ? 'success' : 'warning'} />
                    <span className="truncate text-body text-foreground">{row.name}</span>
                    <span className="font-code text-micro text-muted-foreground">{row.transport}</span>
                  </div>
                  <span className="shrink-0 font-code text-caption text-muted-foreground">
                    {t('settings.mcpToolCount', { count: row.toolCount })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </LoadBoundary>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-section font-medium text-foreground">{t('settings.skillsTitle')}</h3>
          <Button variant="outline" size="sm" type="button" disabled={snapshot.busy} onClick={actions.onReloadSkills}>
            <RefreshCw size={12} />
            {t('settings.skillsReload')}
          </Button>
        </div>
        <LoadBoundary state={snapshot.skills} onRetry={actions.onRefreshExtensions} emptyLabel={t('settings.skillsEmpty')}>
          {(rows) => (
            <div className="flex flex-wrap gap-1.5">
              {rows.map((row) => (
                <Badge key={`${row.category}:${row.name}`} variant="secondary">
                  {row.name}
                </Badge>
              ))}
            </div>
          )}
        </LoadBoundary>
      </section>
    </div>
  );
}

function ConnectionPanel({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement {
  const [draft, setDraft] = React.useState<GatewayDraft>({
    url: snapshot.gateway.url,
    username: snapshot.gateway.username,
    // 已保存的密码不回填到表单，也不进入快照 JSON：留空即沿用旧密码。
    password: '',
    profileName: snapshot.gateway.profileName,
  });

  React.useEffect(() => {
    if (!snapshot.isOpen) return;
    setDraft({
      url: snapshot.gateway.url,
      username: snapshot.gateway.username,
      password: '',
      profileName: snapshot.gateway.profileName,
    });
  }, [snapshot.isOpen]);

  const status = snapshot.gateway.status;
  const statusLabel =
    status === 'connected' ? t('settings.gatewayConnected') : status === 'connecting' ? t('settings.gatewayConnecting') : t('settings.gatewayDisconnected');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 rounded-panel border border-border-subtle bg-panel px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot tone={status === 'connected' ? 'success' : status === 'connecting' ? 'warning' : 'destructive'} />
          <span className="text-body text-foreground">{statusLabel}</span>
          {status === 'connected' ? (
            <span className="font-code text-caption text-muted-foreground">{snapshot.gateway.latencyMs}ms</span>
          ) : null}
        </div>
        {status === 'connected' ? (
          <Button variant="outline" size="sm" type="button" onClick={actions.onDisconnectGateway}>
            {t('settings.disconnect')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="settings-gateway-url" className="text-caption text-secondary-foreground">
            {t('settings.gatewayUrl')}
          </label>
          <Input
            id="settings-gateway-url"
            value={draft.url}
            placeholder={t('settings.gatewayUrlPlaceholder')}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            className="font-code"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="settings-gateway-username" className="text-caption text-secondary-foreground">
              {t('settings.gatewayUsername')}
            </label>
            <Input
              id="settings-gateway-username"
              value={draft.username}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
              className="font-code"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="settings-gateway-password" className="text-caption text-secondary-foreground">
              {t('settings.gatewayPassword')}
            </label>
            <Input
              id="settings-gateway-password"
              type="password"
              value={draft.password}
              autoComplete="new-password"
              placeholder={snapshot.gateway.hasStoredPassword ? t('settings.gatewayPasswordSaved') : undefined}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              className="font-code"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="settings-gateway-profile" className="text-caption text-secondary-foreground">
            {t('settings.gatewayProfile')}
          </label>
          <Input
            id="settings-gateway-profile"
            value={draft.profileName}
            onChange={(event) => setDraft({ ...draft, profileName: event.target.value })}
            className="font-code"
          />
        </div>
      </div>

      {snapshot.gateway.test ? (
        <p className={`text-caption ${snapshot.gateway.test.ok ? 'text-success' : 'text-destructive'}`}>
          {snapshot.gateway.test.message || (snapshot.gateway.test.ok ? t('settings.testOk') : t('settings.testFailed'))}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" type="button" disabled={snapshot.busy} onClick={() => actions.onTestGateway(draft)}>
          {t('settings.testConnection')}
        </Button>
        <Button type="button" disabled={snapshot.busy} onClick={() => actions.onConnectGateway(draft)}>
          {t('settings.saveAndConnect')}
        </Button>
      </div>
    </div>
  );
}

function AboutPanel({ snapshot }: { snapshot: SettingsSnapshot }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-title text-foreground">Hermes Flux</span>
        <span className="font-code text-caption text-muted-foreground">
          {t('settings.aboutVersion', { version: snapshot.appVersion || t('settings.aboutVersionUnknown') })}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 text-body text-secondary-foreground">
        <span>{t('settings.aboutPlatform', { platform: snapshot.platform })}</span>
        <span>{t('settings.aboutProtocol')}</span>
      </div>
    </div>
  );
}

function renderPanel(
  section: SettingsSectionId,
  snapshot: SettingsSnapshot,
  actions: SettingsActions,
): React.ReactElement {
  switch (section) {
    case 'appearance':
      return <AppearancePanel snapshot={snapshot} actions={actions} />;
    case 'providers':
      return <ProvidersPanel snapshot={snapshot} actions={actions} />;
    case 'agents':
      return <AgentsPanel snapshot={snapshot} actions={actions} />;
    case 'extensions':
      return <ExtensionsPanel snapshot={snapshot} actions={actions} />;
    case 'connection':
      return <ConnectionPanel snapshot={snapshot} actions={actions} />;
    case 'about':
      return <AboutPanel snapshot={snapshot} />;
    default:
      return <AppearancePanel snapshot={snapshot} actions={actions} />;
  }
}

/**
 * 设置中心（React 岛）。
 *
 * 【设计意图 (Why)】设置页是唯一需要"左侧导航 + 右侧表单"双栏结构的高密度界面；
 *   它必须和左轨、顶栏共享同一套 Token、图标语言与字阶，否则一进设置就像换了个产品。
 *
 * 【防范的历史坑 (Pitfall)】旧实现每帧 outerHTML 重建整个弹窗，输入框靠 render() 前后
 *   抢救焦点；且导航分组名是竞品的（OPENCHAMBER / OPENCODE），提供商卡片是
 *   硬编码的 7 个假名字。本实现把"有哪些域"收敛到 settingsModel 的注册表，
 *   把"有什么数据"交给壳层快照，组件自身不取数、不猜数。
 *
 * 【约束与规则 (Rules)】
 *   1. 关闭时返回 null，不保留任何 DOM（不空耗合成器）；
 *   2. 主题/字体/语言切换立即生效并落盘，不依赖"保存"按钮；
 *   3. 连接表单的草稿只存在于本组件，避免每次 app 重渲染打断输入；
 *   4. 所有文案走 t()，所有颜色走语义 Token，禁止 emoji 图标。
 */
export function SettingsModal({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement | null {
  const [query, setQuery] = React.useState('');
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!snapshot.isOpen) setQuery('');
  }, [snapshot.isOpen]);

  // 打开时把焦点移入弹窗，关闭后归还给触发元素（键盘用户不会掉回页面顶部）。
  React.useEffect(() => {
    if (!snapshot.isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => { previous?.focus?.(); };
  }, [snapshot.isOpen]);

  React.useEffect(() => {
    if (!snapshot.isOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // 中文/日文输入法用 Esc 取消候选词时不得连带关闭设置弹窗。
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') actions.onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [snapshot.isOpen, actions]);

  if (!snapshot.isOpen) return null;

  const visible = filterSettingsSections(SETTINGS_SECTIONS, query, (key) => t(key));
  const active = SETTINGS_SECTIONS.find((section) => section.id === snapshot.section) ?? SETTINGS_SECTIONS[0];

  return (
    <div
      className="flux-settings fixed inset-0 z-[1000] flex items-center justify-center bg-backdrop/80 p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) actions.onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        data-testid="settings-dialog"
        ref={dialogRef}
        tabIndex={-1}
        className="flex h-[min(680px,calc(100vh-96px))] w-[900px] max-w-[94vw] overflow-hidden rounded-window border border-border bg-popover text-foreground shadow-[var(--shadow-window)]"
      >
        <aside className="flex w-[212px] shrink-0 flex-col border-r border-border-subtle bg-sidebar">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <h2 id="settings-dialog-title" className="text-title text-foreground">
              {t('settings.title')}
            </h2>
            <button
              type="button"
              aria-label={t('settings.close')}
              title={t('settings.close')}
              onClick={actions.onClose}
              className="flex size-7 items-center justify-center rounded-inner text-muted-foreground hover:bg-card-hover hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>

          <div className="px-3 pb-2">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('settings.searchPlaceholder')}
                aria-label={t('settings.searchPlaceholder')}
                className="h-8 pl-7 text-caption"
              />
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3" aria-label={t('settings.title')}>
            {visible.map((section) => {
              const Icon = ICONS[section.icon];
              const selected = section.id === snapshot.section;
              return (
                <button
                  key={section.id}
                  type="button"
                  data-settings-section={section.id}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => actions.onSelectSection(section.id)}
                  className={`flex h-8 items-center gap-2 rounded-card px-2 text-left text-body transition-colors ${
                    selected ? 'bg-card-active text-foreground' : 'text-secondary-foreground hover:bg-card-hover hover:text-foreground'
                  }`}
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="truncate">{t(section.titleKey)}</span>
                </button>
              );
            })}
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-caption text-muted-foreground">{t('settings.searchEmpty')}</p>
            ) : null}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-border-subtle px-6 pb-3 pt-4">
            <h3 className="text-title text-foreground">{t(active.titleKey)}</h3>
            <p className="mt-0.5 text-caption text-muted-foreground">{t(active.descKey)}</p>
          </header>
          <div className="flex-1 overflow-y-auto px-6 py-4">{renderPanel(snapshot.section, snapshot, actions)}</div>
        </section>
      </div>
    </div>
  );
}
