import * as React from 'react';
import { Blocks, Bot, Info, KeyRound, Palette, Plug, RefreshCw, Search, X } from 'lucide-react';
import { t } from '../../i18n/index.js';
import type { I18nKey } from '../../i18n/index.js';
import { SKINS, SKIN_ALIASES, type SkinId } from '../../tokens/skins.js';
import { getUiFontSelectOptions, MONO_FONT_OPTIONS } from '../../tokens/fonts.js';
import { ACTIVITY_INDICATOR_VARIANTS, type ActivityIndicatorVariant } from '../../tokens/activityIndicator.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Select } from '../primitives/Select.js';
import { Surface } from '../primitives/Surface.js';
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
  SETTINGS_SEARCH_ENTRIES,
  filterSettingsEntries,
  filterSettingsSections,
  isGatewayTestStale,
  type GatewayDraft,
  type SettingsSearchEntry,
  type SettingsActions,
  type SettingsActionResult,
  type SettingsIconName,
  type SettingsLoadable,
  type SettingsSectionDef,
  type SettingsSectionId,
  type SettingsSnapshot,
} from './settingsModel.js';
import { createJumpScheduler, type JumpScheduler } from './jumpScheduler.js';

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

/*
 * 右侧面板宽度策略：自适应填满可用宽度。
 *
 * 【设计决策（用户裁决 2026-11-19）】此前用居中限宽容器（阅读宽度上限）控制表单宽度，
 *   在 1440px 弹窗下内容只有 768px、左右各留 200px 空白，用户明确要求「配置页面
 *   自动适应大小」。限宽已移除，内容区由弹窗宽度与左栏宽度自然决定：
 *   弹窗变宽 → 内容变宽；窗口收窄 → 内容跟随收缩（父级 flex-1 + overflow-y-auto 兜底）。
 *
 * 【约束与规则 (Rules)】
 *   1. 禁止再给内容区加宽度上限或居中：那会把"自适应"重新变成"居中留白"；
 *   2. 二级弹窗（添加提供商 / 查看模型）的 `max-w-2xl/lg` 是浮层自身尺寸，不受此约束；
 *   3. 表单可读性由 SettingRow 的 `gap-6` 与分组容器控制，不再靠整列限宽。
 */

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
  'abyss-whale': { label: 'settings.activityAbyssWhale', hint: 'settings.activityAbyssWhaleHint' },
  'prolate-lattice': { label: 'settings.activityProlateLattice', hint: 'settings.activityProlateLatticeHint' },
  'infinity-knot': { label: 'settings.activityInfinityKnot', hint: 'settings.activityInfinityKnotHint' },
  'surf-ribbon': { label: 'settings.activitySurfRibbon', hint: 'settings.activitySurfRibbonHint' },
  'twin-vortex': { label: 'settings.activityTwinVortex', hint: 'settings.activityTwinVortexHint' },
  'kinetic-helix': { label: 'settings.activityKineticHelix', hint: 'settings.activityKineticHelixHint' },
  'whale-compact': { label: 'settings.activityWhaleCompact', hint: 'settings.activityWhaleCompactHint' },
  'torus-mesh': { label: 'settings.activityTorusMesh', hint: 'settings.activityTorusMeshHint' },
  'wave-net': { label: 'settings.activityWaveNet', hint: 'settings.activityWaveNetHint' },
  'sphere-mesh': { label: 'settings.activitySphereMesh', hint: 'settings.activitySphereMeshHint' },
  'mobius-band': { label: 'settings.activityMobiusBand', hint: 'settings.activityMobiusBandHint' },
  'dipole-vortex': { label: 'settings.activityDipoleVortex', hint: 'settings.activityDipoleVortexHint' },
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
      <SettingSection anchorId="theme">
        <SettingsSectionHeading title={t('settings.themeTitle')} hint={t('settings.themeHint')} />
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3" role="radiogroup" aria-label={t('settings.themeTitle')}>
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
                className={`specular-top shadow-card flex items-center gap-3 rounded-panel border px-3 py-3 text-left transition-colors ${
                  active ? 'border-primary bg-primary-subtle' : 'border-border-subtle surface-raised hover:bg-card-hover'
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

      <SettingSection anchorId="activity">
        <SettingsSectionHeading title={t('settings.activityTitle')} hint={t('settings.activityHint')} />
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3" role="radiogroup" aria-label={t('settings.activityTitle')}>
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
                className={`specular-top shadow-card flex items-center gap-3 rounded-panel border px-3 py-3 text-left transition-colors ${
                  active ? 'border-primary bg-primary-subtle' : 'border-border-subtle surface-raised hover:bg-card-hover'
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
          <SettingRow label={t('settings.uiFont')} anchorId="ui-font">
            <Select
              id="settings-ui-font"
              size="sm"
              className="min-w-44"
              ariaLabel={t('settings.uiFont')}
              value={snapshot.fontPrefs.uiFont}
              groups={[{ label: '', options: getUiFontSelectOptions().map((option) => ({ value: option.id, label: option.label })) }]}
              onChange={(uiFont) => actions.onFontPrefsChange({ ...snapshot.fontPrefs, uiFont: uiFont as typeof snapshot.fontPrefs.uiFont })}
            />
          </SettingRow>
          <SettingRow label={t('settings.codeFont')} anchorId="code-font">
            <Select
              id="settings-mono-font"
              size="sm"
              className="min-w-44"
              ariaLabel={t('settings.codeFont')}
              value={snapshot.fontPrefs.monoFont}
              groups={[{ label: '', options: MONO_FONT_OPTIONS.map((option) => ({ value: option.id, label: option.label })) }]}
              onChange={(monoFont) => actions.onFontPrefsChange({ ...snapshot.fontPrefs, monoFont: monoFont as typeof snapshot.fontPrefs.monoFont })}
            />
          </SettingRow>
          <SettingRow label={t('settings.textSize')} anchorId="font-size">
            <SegmentedControl
              ariaLabel={t('settings.textSize')}
              value={snapshot.fontPrefs.sizeScale}
              onChange={(sizeScale) => actions.onFontPrefsChange({ ...snapshot.fontPrefs, sizeScale })}
              options={[
                { value: 'small', label: t('settings.sizeSmall') },
                { value: 'medium', label: t('settings.sizeMedium') },
                { value: 'large', label: t('settings.sizeLarge') },
              ]} /></SettingRow><SettingRow label={t('settings.conversationWidth')} anchorId="conversation-width"><SegmentedControl ariaLabel={t('settings.conversationWidth')} value={snapshot.conversationWidth} onChange={actions.onConversationWidthChange} options={[
                { value: 'narrow', label: t('settings.conversationWidthNarrow') },
                { value: 'wide', label: t('settings.conversationWidthWide') },
                { value: 'full', label: t('settings.conversationWidthFull') },
              ]}
            />
          </SettingRow>
        </SettingInset>
      </SettingSection>

      <SettingSection>
        <SettingsSectionHeading title={t('settings.presenceTitle')} hint={t('settings.presenceHint')} />
        <SettingInset>
          <SettingRow label={t('settings.presenceLayout')} anchorId="presence-layout">
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
          <SettingRow label={t('settings.languageLabel')} anchorId="language">
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
  return (
    <div data-settings-anchor="providers-list" className="flex flex-col">
      <ProvidersAdminPanel snapshot={snapshot} actions={actions} />
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
      <SettingSection anchorId="ext-mcp">
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
            // 简单列表回归 inset group：外框 + 内分隔线，不依赖底色差，也不把 8 行做成 8 张卡。
            <Surface level="panel" padding="none" className="flex flex-col overflow-hidden">
              {rows.map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between gap-4 border-b border-border-subtle px-3 py-2 last:border-b-0"
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
            </Surface>
          )}
        </LoadBoundary>
      </SettingSection>

      <SettingSection anchorId="ext-skills">
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
          {(rows) => {
            // 按 category 分组：混排成一堆徽标时，用户无法区分内建 / 全局 / 工作区来源。
            const groups = new Map<string, Array<{ name: string; category: string }>>();
            for (const row of rows) {
              const key = row.category || 'other';
              const list = groups.get(key);
              if (list) list.push(row);
              else groups.set(key, [row]);
            }
            return (
              <div className="flex flex-col gap-3">
                {Array.from(groups.entries()).map(([category, list]) => (
                  <div key={category} className="flex flex-col gap-2" data-skill-group={category}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-aux font-medium text-secondary-foreground">{category}</span>
                      <span className="font-code text-micro text-muted-foreground">{list.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {list.map((row) => (
                        <Badge key={`${category}:${row.name}`} variant="secondary">
                          {row.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          }}
        </LoadBoundary>
      </SettingSection>
    </div>
  );
}

/**
 * 连接表单在弹窗层的受控绑定。
 * 草稿与测试指纹必须同属一个生命周期，否则切 Tab 后旧结论会被挂到新草稿上。
 */
interface GatewayFormBinding {
  draft: GatewayDraft;
  onDraftChange: (draft: GatewayDraft) => void;
  testedDraft: GatewayDraft | null;
  onTested: (draft: GatewayDraft) => void;
}

function ConnectionPanel({
  snapshot,
  actions,
  gateway,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
  gateway: GatewayFormBinding;
}): React.ReactElement {
  /**
   * 本地点测指纹：草稿一旦变动，旧的「连通性正常/失败」必须立即失效。
   *
   * 【为什么不在壳层清空】testStatus 由壳层持有，组件无权回写；在显示条件上做一致性比较，
   *   既不改动快照结构，也不会把上一次的结果误挂到新地址/新账号上。
   * 【规则】只有本组件发起过测试才参与比较；外部（连接流程）产生的 test 状态照常显示。
   */
  const { draft, onDraftChange: setDraft, testedDraft } = gateway;
  const testStale = isGatewayTestStale(testedDraft, draft);

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
        <SettingField label={t('settings.gatewayUrl')} htmlFor="settings-gateway-url" anchorId="gateway-url">
          <Input
            id="settings-gateway-url"
            value={draft.url}
            placeholder={t('settings.gatewayUrlPlaceholder')}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            className="font-code"
          />
        </SettingField>
        <SettingTwoColumn>
          <SettingField label={t('settings.gatewayUsername')} htmlFor="settings-gateway-username" anchorId="gateway-username">
            <Input
              id="settings-gateway-username"
              value={draft.username}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
              className="font-code"
            />
          </SettingField>
          <SettingField label={t('settings.gatewayPassword')} htmlFor="settings-gateway-password" anchorId="gateway-password">
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
        <SettingField label={t('settings.gatewayProfile')} htmlFor="settings-gateway-profile" anchorId="gateway-profile">
          <Input
            id="settings-gateway-profile"
            value={draft.profileName}
            onChange={(event) => setDraft({ ...draft, profileName: event.target.value })}
            className="font-code"
          />
        </SettingField>
      </SettingInset>

      {snapshot.gateway.test && !testStale ? (
        <p className={`text-caption ${snapshot.gateway.test.ok ? 'text-success' : 'text-destructive'}`}>
          {snapshot.gateway.test.message || (snapshot.gateway.test.ok ? t('settings.testOk') : t('settings.testFailed'))}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          type="button"
          disabled={snapshot.busy}
          onClick={() => {
            gateway.onTested(draft);
            actions.onTestGateway(draft);
          }}
        >
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
      <Surface level="raised" padding="loose" elevated className="flex flex-col gap-3" data-settings-anchor="about-version">
        <div className="flex flex-col gap-1">
          <span className="text-title text-foreground">Hermes Flux</span>
          <span className="font-code text-caption text-muted-foreground">
            {t('settings.aboutVersion', { version: snapshot.appVersion || t('settings.aboutVersionUnknown') })}
          </span>
        </div>
        <div className="flex flex-col gap-2 text-body text-secondary-foreground">
          <span data-settings-anchor="about-platform">{t('settings.aboutPlatform', { platform: snapshot.platform })}</span>
          <span data-settings-anchor="about-protocol">{t('settings.aboutProtocol')}</span>
        </div>
      </Surface>
    </div>
  );
}

function renderPanel(
  section: SettingsSectionId,
  snapshot: SettingsSnapshot,
  actions: SettingsActions,
  gateway: GatewayFormBinding,
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
      return <ConnectionPanel snapshot={snapshot} actions={actions} gateway={gateway} />;
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

  /**
   * 连接表单草稿提升到弹窗层。
   *
   * 【为什么必须提升】ConnectionPanel 在切换左侧导航时会被卸载，局部 useState 随之销毁，
   *   用户填了一半的 URL / 用户名一切 Tab 就静默蒸发。提升到常驻的 SettingsModal 后，
   *   只有真正关闭弹窗才会重新对齐权威快照。
   */
  const [gatewayDraft, setGatewayDraft] = React.useState<GatewayDraft>(() => ({
    url: snapshot.gateway.url,
    username: snapshot.gateway.username,
    // 已保存的密码不回填到表单，也不进入快照 JSON：留空即沿用旧密码。
    password: '',
    profileName: snapshot.gateway.profileName,
  }));

  /**
   * 上次点「测试连接」时的草稿指纹。
   *
   * 【为什么与草稿一起提升】ConnectionPanel 切走即卸载；若指纹留在面板内，
   *   切回时归零，旧 URL 的「连通性正常」会被挂到新草稿上（假绿）。
   */
  const [testedGatewayDraft, setTestedGatewayDraft] = React.useState<GatewayDraft | null>(null);

  /** 检索跳转的定时器调度器：关闭与卸载都必须 dispose（见 jumpScheduler 规则）。 */
  const jumpSchedulerRef = React.useRef<JumpScheduler | null>(null);
  if (!jumpSchedulerRef.current) {
    jumpSchedulerRef.current = createJumpScheduler({
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    });
  }
  React.useEffect(
    () => () => {
      jumpSchedulerRef.current?.dispose();
    },
    [],
  );
  // 关闭弹窗时组件仍挂载（return null 不触发卸载），必须显式清理在途定时器。
  React.useEffect(() => {
    if (!snapshot.isOpen) jumpSchedulerRef.current?.dispose();
  }, [snapshot.isOpen]);

  React.useEffect(() => {
    if (!snapshot.isOpen) return;
    setGatewayDraft({
      url: snapshot.gateway.url,
      username: snapshot.gateway.username,
      // 已保存的密码不回填到表单，也不进入快照 JSON：留空即沿用旧密码。
      password: '',
      profileName: snapshot.gateway.profileName,
    });
    setTestedGatewayDraft(null);
  }, [snapshot.isOpen]);

  React.useEffect(() => {
    if (!snapshot.isOpen) setQuery('');
  }, [snapshot.isOpen]);

  // 焦点进入、Esc 分层关闭、关闭后焦点归还全部由 primitives/Dialog 的 FocusScope 与
  // DismissableLayer 承担：手写 window 监听曾是二级弹窗 Esc 穿透的根因（见 Dialog.tsx 规则 4）。

  if (!snapshot.isOpen) return null;

  const visible = filterSettingsSections(SETTINGS_SECTIONS, query, (key) => t(key));
  const entryHits = filterSettingsEntries(SETTINGS_SEARCH_ENTRIES, query, (key) => t(key));
  const active = SETTINGS_SECTIONS.find((section) => section.id === snapshot.section) ?? SETTINGS_SECTIONS[0];

  /**
   * 跳到某个设置项：切分区 → 等面板挂载 → 滚动定位 + 一次性高亮。
   *
   * 【为什么重试】切分区后目标面板可能还在加载（BOT 详情、提供商表），
   *   锚点要等数据就绪才出现；单次 rAF 会在慢面板上直接落空。
   * 【规则】高亮只做视觉提示（只加 outline，不覆盖 box-shadow），1.6s 后移除。
   * 【规则】所有定时器必须经 jumpScheduler 登记：关闭弹窗与组件卸载都会 dispose，
   *   否则会对已脱离文档的节点操作 classList 并留下悬挂定时器。
   */
  const jumpToEntry = (entry: SettingsSearchEntry): void => {
    if (snapshot.section !== entry.sectionId) actions.onSelectSection(entry.sectionId);
    setQuery('');
    const scheduler = jumpSchedulerRef.current;
    if (!scheduler) return;
    // 清掉上一轮：连点两个检索结果时，旧的重试与高亮必须作废，只保留最后一次跳转。
    scheduler.dispose();
    const schedule = scheduler.schedule;
    const scrollToAnchor = (attempts: number): void => {
      const node = document.querySelector<HTMLElement>(`[data-settings-anchor="${entry.id}"]`);
      if (!node) {
        if (attempts > 0) schedule(() => scrollToAnchor(attempts - 1), 60);
        return;
      }
      node.scrollIntoView({ block: 'center' });
      // 用 outline 而不是 ring：ring 走 box-shadow，会整体替换 Surface 的 shadow-card，
      // 高亮 1.6s 内卡片阴影闪失。outline 不参与 box-shadow 合成，且自动跟随圆角。
      node.classList.add('outline-2', 'outline-primary', 'outline-offset-2');
      schedule(() => node.classList.remove('outline-2', 'outline-primary', 'outline-offset-2'), 1600);
    };
    schedule(() => scrollToAnchor(6), 60);
  };

  const gatewayForm: GatewayFormBinding = {
    draft: gatewayDraft,
    onDraftChange: setGatewayDraft,
    testedDraft: testedGatewayDraft,
    onTested: setTestedGatewayDraft,
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) actions.onClose();
      }}
    >
      <DialogContent
        portal={false}
        ref={dialogRef}
        data-testid="settings-dialog"
        onEscapeKeyDown={(event) => {
          // 中文/日文输入法用 Esc 取消候选词时不得连带关闭设置弹窗。
          if (event.isComposing || event.keyCode === 229) event.preventDefault();
        }}
        className="flux-settings flex max-w-none gap-0 overflow-hidden rounded-window border-border bg-popover p-0"
        style={{
          width: 'clamp(900px, 88vw, 1440px)',
          maxWidth: 'calc(100vw - 48px)',
          height: 'clamp(620px, 86vh, 960px)',
          maxHeight: 'calc(100vh - 48px)',
        }}
      >
        <aside className="flex w-56 shrink-0 flex-col border-r border-border-subtle bg-sidebar">
          <div className="px-4 pb-3 pt-4">
            <DialogTitle id="settings-dialog-title" className="text-title text-foreground">
              {t('settings.title')}
            </DialogTitle>
          </div>

          <div className="px-3 pb-3">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              {/* 字号走 Input 的 size 档（sm = 32px + text-body），不再用 className 压成 caption。 */}
              <Input
                size="sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('settings.searchPlaceholder')}
                aria-label={t('settings.searchPlaceholder')}
                className="pl-7"
              />
            </div>
          </div>

          {/* 导航行高 36px、行间 8px、左右 12px：全部落在 4px 网格上，且字号只走 text-body 一档。 */}
          <nav className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-4" aria-label={t('settings.title')}>
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
                  className={`flex h-9 items-center gap-2 rounded-card px-3 text-left text-body transition-colors ${
                    selected ? 'bg-card-active text-foreground' : 'text-secondary-foreground hover:bg-card-hover hover:text-foreground'
                  }`}
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="truncate">{t(section.titleKey)}</span>
                </button>
              );
            })}
            {visible.length === 0 ? (
              <p className="px-3 py-3 text-caption text-muted-foreground">{t('settings.searchEmpty')}</p>
            ) : null}

            {/* 真实设置项命中：只按一级分类过滤时，「字号 / 密码 / 版本 / SOUL」全部搜不到。 */}
            {query.trim() ? (
              <div className="mt-2 flex flex-col gap-1 border-t border-border-subtle pt-2" data-settings-results="true" aria-label={t('settings.searchPlaceholder')}>
                {entryHits.length === 0 ? (
                  <p className="px-1 py-1 text-caption text-muted-foreground">{t('settings.searchEmpty')}</p>
                ) : (
                  entryHits.map((entry) => {
                    const section = SETTINGS_SECTIONS.find((item) => item.id === entry.sectionId);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        data-settings-entry={entry.id}
                        onClick={() => jumpToEntry(entry)}
                        className="flex h-8 items-center justify-between gap-2 rounded-card px-2 text-left text-body text-secondary-foreground transition-colors hover:bg-card-hover hover:text-foreground"
                      >
                        <span className="truncate">{t(entry.labelKey)}</span>
                        {section ? (
                          <span className="shrink-0 text-micro text-muted-foreground">{t(section.titleKey)}</span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 pb-3 pt-4">
            <div className="min-w-0">
              <h3 className="text-title text-foreground">{t(active.titleKey)}</h3>
              <DialogDescription className="mt-1 text-caption text-muted-foreground">{t(active.descKey)}</DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              aria-label={t('settings.close')}
              title={t('settings.close')}
              onClick={actions.onClose}
              className="shrink-0"
            >
              <X size={14} aria-hidden="true" />
            </Button>
          </header>
          <div className={snapshot.section === 'agents' ? 'flex-1 min-h-0' : 'flex-1 overflow-y-auto px-6 py-4'}>
            {renderPanel(snapshot.section, snapshot, actions, gatewayForm)}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
