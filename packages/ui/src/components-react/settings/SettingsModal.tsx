import * as React from 'react';
import { Blocks, Bot, ChevronDown, Info, KeyRound, Palette, Plug, RefreshCw, Search, X } from 'lucide-react';
import { t } from '../../i18n/index.js';
import type { I18nKey } from '../../i18n/index.js';
import { SKINS, SKIN_ALIASES, type SkinId } from '../../tokens/skins.js';
import { getUiFontSelectOptions, MONO_FONT_OPTIONS } from '../../tokens/fonts.js';
import { ACTIVITY_INDICATOR_VARIANTS, type ActivityIndicatorVariant } from '../../tokens/activityIndicator.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import { Badge } from '../primitives/Badge.js';
import { ActivityIndicator } from '../primitives/ActivityIndicator.js';
import { SegmentedControl } from './SegmentedControl.js';
import { SettingField, SettingInset, SettingRow, SettingSection, SettingTwoColumn } from './SettingRow.js';
import { SettingsSectionHeading } from './SettingsSectionHeading.js';
import { LoadBoundary } from './LoadBoundary.js';
import { ProvidersAdminPanel } from './ProvidersAdminPanel.js';
import { BotManagerView } from './BotManagerView.js';
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
const THEME_ORDER = ['obsidian-gold', 'ayu-dark', 'jade-white', 'warm-paper', 'ayu-light'] as const;

const THEME_LABEL_KEY: Record<(typeof THEME_ORDER)[number], I18nKey> = {
  'obsidian-gold': 'common.theme.obsidianLabel',
  'ayu-dark': 'common.theme.ayuDarkLabel',
  'jade-white': 'common.theme.jadeWhiteLabel',
  'warm-paper': 'common.theme.warmPaperLabel',
  'ayu-light': 'common.theme.ayuLightLabel',
};

/**
 * 活动指示器变体的文案真值（顺序由 tokens/activityIndicator 的 ACTIVITY_INDICATOR_VARIANTS 决定）。
 * 【规则】一张表同时覆盖名称与描述，缺任何一项都会渲染出键字面量；
 *   两张并列的表一旦少改一张，画面上就会出现「名称正确、描述是 key」的不对称缺陷。
 */
const ACTIVITY_VARIANT_TEXT: Record<ActivityIndicatorVariant, { label: I18nKey; hint: I18nKey }> = {
  cloud: { label: 'settings.activityCloud', hint: 'settings.activityCloudHint' },
  gyro: { label: 'settings.activityGyro', hint: 'settings.activityGyroHint' },
  orbit: { label: 'settings.activityOrbit', hint: 'settings.activityOrbitHint' },
  synapse: { label: 'settings.activitySynapse', hint: 'settings.activitySynapseHint' },
  spring: { label: 'settings.activitySpring', hint: 'settings.activitySpringHint' },
  matrix: { label: 'settings.activityMatrix', hint: 'settings.activityMatrixHint' },
};

function StatusDot({ tone }: { tone: 'success' | 'warning' | 'destructive' | 'muted' }): React.ReactElement {
  const color =
    tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : tone === 'destructive' ? 'bg-destructive' : 'bg-muted-foreground';
  return <span className={`size-2 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
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
      <SettingSection>
        <SettingsSectionHeading title={t('settings.themeTitle')} hint={t('settings.themeHint')} />
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
                className={`flex items-center gap-3 rounded-panel border px-3 py-3 text-left transition-colors ${
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
                  <span className="text-caption text-muted-foreground">
                    {skin.variant === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingSection>

      <SettingSection>
        <SettingsSectionHeading title={t('settings.activityTitle')} hint={t('settings.activityHint')} />
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('settings.activityTitle')}>
          {ACTIVITY_INDICATOR_VARIANTS.map((variant) => {
            const active = snapshot.activityVariant === variant;
            return (
              <button
                key={variant}
                type="button"
                role="radio"
                aria-checked={active}
                data-activity-variant={variant}
                onClick={() => actions.onActivityVariantChange(variant)}
                className={`flex items-center gap-3 rounded-panel border px-3 py-3 text-left transition-colors ${
                  active ? 'border-primary bg-primary-subtle' : 'border-border-subtle bg-transparent hover:bg-card-hover'
                }`}
              >
                {/* 预览即真实组件：卡片里的动效就是左轨运行态，用户不必先选中再回左轨确认。 */}
                <span className="activity-variant-preview" aria-hidden="true" data-activity-preview={variant}>
                  <ActivityIndicator state="running" placement="inline" entityKind="session" variant={variant} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body text-foreground">{t(ACTIVITY_VARIANT_TEXT[variant].label)}</span>
                  <span className="truncate text-caption text-muted-foreground">{t(ACTIVITY_VARIANT_TEXT[variant].hint)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingSection>

      <SettingSection>
        <SettingsSectionHeading title={t('settings.typographyTitle')} hint={t('settings.typographyHint')} />
        <SettingInset>
          <SettingRow label={t('settings.uiFont')} htmlFor="settings-ui-font">
            <div className="relative inline-flex items-center">
              <select
                id="settings-ui-font"
                value={snapshot.fontPrefs.uiFont}
                onChange={(event) => actions.onFontPrefsChange({ ...snapshot.fontPrefs, uiFont: event.target.value as typeof snapshot.fontPrefs.uiFont })}
                className="h-8 min-w-44 appearance-none rounded-card border border-border bg-input pl-3 pr-8 text-body text-foreground transition-colors focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {getUiFontSelectOptions().map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2 text-muted-foreground" aria-hidden="true" />
            </div>
          </SettingRow>
          <SettingRow label={t('settings.codeFont')} htmlFor="settings-mono-font">
            <div className="relative inline-flex items-center">
              <select
                id="settings-mono-font"
                value={snapshot.fontPrefs.monoFont}
                onChange={(event) => actions.onFontPrefsChange({ ...snapshot.fontPrefs, monoFont: event.target.value as typeof snapshot.fontPrefs.monoFont })}
                className="h-8 min-w-44 appearance-none rounded-card border border-border bg-input pl-3 pr-8 text-body text-foreground transition-colors focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {MONO_FONT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2 text-muted-foreground" aria-hidden="true" />
            </div>
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
        </SettingInset>
      </SettingSection>

      <SettingSection>
        <SettingsSectionHeading title={t('settings.presenceTitle')} hint={t('settings.presenceHint')} />
        <SettingInset>
          <SettingRow label={t('settings.presenceLayout')}>
            <SegmentedControl
              ariaLabel={t('settings.presenceLayout')}
              value={snapshot.presenceLayout}
              onChange={(layout) => actions.onPresenceLayoutChange(layout)}
              options={[
                { value: 'stage', label: t('settings.presenceLayoutStage') },
                { value: 'dock', label: t('settings.presenceLayoutDock') },
              ]}
            />
          </SettingRow>
        </SettingInset>
      </SettingSection>

      <SettingSection>
        <SettingsSectionHeading title={t('settings.languageTitle')} hint={t('settings.languageHint')} />
        <SettingInset>
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
        </SettingInset>
      </SettingSection>
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

function ExtensionsPanel({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <SettingSection>
        <SettingsSectionHeading
          title={t('settings.mcpTitle')}
          action={
            <Button variant="outline" size="sm" type="button" disabled={snapshot.busy} onClick={actions.onRefreshExtensions}>
              <RefreshCw size={12} />
              {t('settings.refresh')}
            </Button>
          }
        />
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
      </SettingSection>

      <SettingSection>
        <SettingsSectionHeading
          title={t('settings.skillsTitle')}
          action={
            <Button variant="outline" size="sm" type="button" disabled={snapshot.busy} onClick={actions.onReloadSkills}>
              <RefreshCw size={12} />
              {t('settings.skillsReload')}
            </Button>
          }
        />
        <LoadBoundary state={snapshot.skills} onRetry={actions.onRefreshExtensions} emptyLabel={t('settings.skillsEmpty')}>
          {(rows) => (
            <div className="flex flex-wrap gap-2">
              {rows.map((row) => (
                <Badge key={`${row.category}:${row.name}`} variant="secondary">
                  {row.name}
                </Badge>
              ))}
            </div>
          )}
        </LoadBoundary>
      </SettingSection>
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

      <SettingInset className="gap-3 py-4">
        <SettingField label={t('settings.gatewayUrl')} htmlFor="settings-gateway-url">
          <Input
            id="settings-gateway-url"
            value={draft.url}
            placeholder={t('settings.gatewayUrlPlaceholder')}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            className="font-code"
          />
        </SettingField>
        <SettingTwoColumn>
          <SettingField label={t('settings.gatewayUsername')} htmlFor="settings-gateway-username">
            <Input
              id="settings-gateway-username"
              value={draft.username}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
              className="font-code"
            />
          </SettingField>
          <SettingField label={t('settings.gatewayPassword')} htmlFor="settings-gateway-password">
            <Input
              id="settings-gateway-password"
              type="password"
              value={draft.password}
              autoComplete="new-password"
              placeholder={snapshot.gateway.hasStoredPassword ? t('settings.gatewayPasswordSaved') : undefined}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              className="font-code"
            />
          </SettingField>
        </SettingTwoColumn>
        <SettingField label={t('settings.gatewayProfile')} htmlFor="settings-gateway-profile">
          <Input
            id="settings-gateway-profile"
            value={draft.profileName}
            onChange={(event) => setDraft({ ...draft, profileName: event.target.value })}
            className="font-code"
          />
        </SettingField>
      </SettingInset>

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
      <div className="flex flex-col gap-1">
        <span className="text-title text-foreground">Hermes Flux</span>
        <span className="font-code text-caption text-muted-foreground">
          {t('settings.aboutVersion', { version: snapshot.appVersion || t('settings.aboutVersionUnknown') })}
        </span>
      </div>
      <div className="flex flex-col gap-2 text-body text-secondary-foreground">
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
      return <BotManagerView snapshot={snapshot} actions={actions} />;
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
      className="flux-settings fixed inset-0 z-50 flex items-center justify-center bg-backdrop/80 p-6"
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
        className="flex overflow-hidden rounded-window border border-border bg-popover text-foreground shadow-window"
        style={{ height: 'min(680px, calc(100vh - 96px))', width: '900px', maxWidth: '94vw' }}
      >
        <aside className="flex w-53 shrink-0 flex-col border-r border-border-subtle bg-sidebar">
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

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3" aria-label={t('settings.title')}>
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
            <p className="mt-1 text-caption text-muted-foreground">{t(active.descKey)}</p>
          </header>
          <div className={snapshot.section === 'agents' ? 'flex-1 min-h-0' : 'flex-1 overflow-y-auto px-6 py-4'}>
            {renderPanel(snapshot.section, snapshot, actions)}
          </div>
        </section>
      </div>
    </div>
  );
}
