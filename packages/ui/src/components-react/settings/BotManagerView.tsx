import * as React from 'react';
import {
  Bot as BotIcon,
  Camera,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileCode2,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  draftFromDetail,
  isBotDraftDirty,
  type BotCapabilityList,
  type BotDraftState,
  type McpTestResultView,
} from '@hermes-flux/core';
import { t, type I18nKey } from '../../i18n/index.js';
import { presentModel } from '../../lib/modelPresentation.js';
import { renderBotAvatar } from '../../utils/botAvatar.js';
import { AvatarProcessingError, cropAvatarToDataUrl } from '../../utils/cropAvatar.js';
import { Badge } from '../primitives/Badge.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../primitives/Menu.js';
import { Skeleton } from '../primitives/Skeleton.js';
import { Surface } from '../primitives/Surface.js';
import { Switch } from '../primitives/Switch.js';
import { Textarea } from '../primitives/Textarea.js';
import { Tooltip } from '../primitives/Tooltip.js';
import { CapabilitySection } from './BotCapabilityList.js';
import { BotHeroCarousel } from './BotHeroCarousel.js';
import {
  canResetBotAvatar,
  computeSoulByteLength,
  computeSoulLineCount,
  countEnabledCapabilities,
  filterCapabilities,
  insertTextAtSelection,
  isSoulOverLimit,
  resolveAnchorNavigation,
  resolveBotAvatar,
  resolveBotDisplayTitle,
  SOUL_SOFT_LIMIT_BYTES,
  toggleCapabilityId,
  type BotCapFilterMode,
  type BotDetailTab,
} from './botPanelLogic.js';
import { McpAddDialog } from './McpAddDialog.js';
import { McpRemoveConfirmDialog } from './McpRemoveConfirmDialog.js';
import { GroupedModelSelect } from './ModelPicker.js';
import { SettingField, SettingTwoColumn } from './SettingRow.js';
import { SkillDetailDialog } from './SkillDetailDialog.js';
import { SkillInstallDialog } from './SkillInstallDialog.js';
import type { SettingsActions, SettingsSnapshot } from './settingsModel.js';

const IDENTITY_AVATAR_SIZE = '100%';
const MIN_SOUL_GUTTER_LINES = 14;
const DETAIL_TABS: readonly BotDetailTab[] = ['basic', 'soul', 'toolsets', 'skills', 'mcp'];
const TAB_LABEL_KEYS: Record<BotDetailTab, I18nKey> = {
  basic: 'bot.tabBasic',
  soul: 'bot.tabSoul',
  toolsets: 'bot.tabToolsets',
  skills: 'bot.tabSkills',
  mcp: 'bot.tabMcp',
};

/**
 * BOT 配置中枢（方案 1：可展开头像微轨 + 专注分段台 + Studio SOUL 编辑器 + 200+ 能力控制台）。
 *
 * 【设计意图 (Why)】
 *   设置弹窗左栏已存在导航，因此 BOT 主舞台以左侧 56px 纯头像微轨起步，右侧构建零滚屏
 *   三段式专注工作台（身份与模型 / 角色设定 SOUL.md / 能力矩阵）：
 *   1. 去框化紧凑身份头直接在头部完成头像悬停更换、ID 一键复制与默认切换；
 *   2. Studio `SOUL.md` 编辑器提供全高代码块、同步行号槽、幽灵快捷变量与 Radix 模板菜单；
 *   3. 面向数百项工具/技能的能力控制台自带关键词搜索、GPU 滑块分类与全部/启用/未启用筛
 *      选，并在 MCP 与技能分页直通官方预设/自定义 MCP 新增、连通探活、移除与技能市场安装；
 *   4. 底部仅在有未保存草稿时浮起轻量胶囊保存条，平常不占位、按钮无微加载器抖动。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 切分 Tab 时卸载 DOM 会破坏设置检索锚点与全量能力 SSR 断言；所有 Tab 与分类均保持
 *      挂载、非激活态以 `hidden` 收起，跳转检索时同步自动切换 Tab 与分类；
 *   2. 保存期间若不锁定微轨与操作按钮，连击会并发交错覆盖；
 *   3. 能力清单 `authoritative === false` 时只读展示，禁止把读取缺口写回网关清空配置；
 *   4. 离线模型、MCP 未知态与列表/详情失败态全部显式表达（Failure Is Not Empty）。
 *
 * 【约束与规则 (Rules)】
 *   1. 零 DOM 状态篡改、零裸色字面量、零系统原生 select、零任意值与小数网格类名；
 *   2. MCP 删除必须经 Dialog 二次确认且使用 `portal={false}` + `max-h-modal-sm`；
 *   3. 所有文案走 `t()`，关键动作结果以显式 toast / alert 反馈。
 */
export function BotManagerView({
  snapshot,
  actions,
  focusAnchor,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
  /** 设置项检索跳转传入的聚焦请求；变更时自动切换到所属 Tab 与能力分类。 */
  focusAnchor?: { anchorId: string; seq: number } | null;
}): React.ReactElement {
  const view = snapshot.botManagement;
  const status = view.status;
  const activeId = view.activeBotId;
  const activeDetail = view.activeDetail;

  const draft: BotDraftState | null =
    view.activeDraft ?? (activeDetail ? draftFromDetail(activeDetail) : null);

  const dirty = Boolean(activeDetail && draft && isBotDraftDirty(activeDetail, draft));
  const saving = status.status === 'saving';
  const [submitting, setSubmitting] = React.useState(false);
  const locked = saving || submitting || view.isBusy;
  const [copying, setCopying] = React.useState(false);
  const [copyDone, setCopyDone] = React.useState(false);

  const [activeTab, setActiveTab] = React.useState<BotDetailTab>('basic');
  const [capFilter, setCapFilter] = React.useState<BotCapFilterMode>('all');
  const [capQuery, setCapQuery] = React.useState('');

  const selectTab = (nextTab: BotDetailTab): void => {
    setActiveTab(nextTab);
    setCapFilter('all');
    setCapQuery('');
  };

  const [mcpAddOpen, setMcpAddOpen] = React.useState(false);
  const [skillHubOpen, setSkillHubOpen] = React.useState(false);
  const [inspectingSkill, setInspectingSkill] = React.useState<{
    name: string;
    description?: string;
  } | null>(null);
  const [testingMcpId, setTestingMcpId] = React.useState<string | null>(null);
  const [mcpProbeOverrides, setMcpProbeOverrides] = React.useState<Record<string, McpTestResultView>>({});
  const [confirmRemoveMcp, setConfirmRemoveMcp] = React.useState<string | null>(null);
  const [removingMcp, setRemovingMcp] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadTargetRef = React.useRef<string | null>(null);
  const soulRef = React.useRef<HTMLTextAreaElement>(null);
  const soulGutterRef = React.useRef<HTMLDivElement>(null);
  const probeEpochRef = React.useRef(0);

  const tabBarRef = React.useRef<HTMLDivElement>(null);
  const tabBtnRefs = React.useRef<Map<BotDetailTab, HTMLButtonElement>>(new Map());
  const [tabLine, setTabLine] = React.useState<{ left: number; width: number } | null>(null);

  // 切换 BOT 时递增探活纪元并清除上一个 BOT 的行内探活临时覆盖与弹窗状态，防止慢响应串台。
  React.useEffect(() => {
    probeEpochRef.current += 1;
    setMcpProbeOverrides({});
    setTestingMcpId(null);
    setConfirmRemoveMcp(null);
    setMcpAddOpen(false);
    setSkillHubOpen(false);
    setInspectingSkill(null);
  }, [activeId]);

  // 设置检索命中 `bot-*` 锚点时，自动切换到对应扁平菜单。
  React.useEffect(() => {
    if (!focusAnchor) return;
    const target = resolveAnchorNavigation(focusAnchor.anchorId);
    setActiveTab(target.tab);
    setCapFilter('all');
    setCapQuery('');
  }, [focusAnchor]);

  const bootstrapRequestedRef = React.useRef(false);
  React.useEffect(() => {
    if (bootstrapRequestedRef.current) return;
    if (status.status !== 'idle' || activeDetail || !activeId) return;
    bootstrapRequestedRef.current = true;
    actions.onSelectBotSettle(activeId);
  }, [status.status, activeDetail, activeId, actions]);

  React.useEffect(() => {
    actions.onRegisterBotDirtyGuard(() => dirty);
    return () => actions.onRegisterBotDirtyGuard(null);
  }, [actions, dirty]);

  const measureTabLine = React.useCallback((): void => {
    const activeBtn = tabBtnRefs.current.get(activeTab);
    if (!activeBtn || activeBtn.offsetWidth <= 0) {
      setTabLine(null);
      return;
    }
    const next = { left: activeBtn.offsetLeft, width: activeBtn.offsetWidth };
    setTabLine((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
  }, [activeTab]);

  React.useLayoutEffect(() => {
    measureTabLine();
    const bar = tabBarRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureTabLine);
    observer.observe(bar);
    for (const el of tabBtnRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [measureTabLine, activeDetail?.id]);

  const patchDraft = (patch: Partial<BotDraftState>): void => {
    if (!activeId || locked) return;
    actions.onBotDraftChange(activeId, patch);
  };

  const handleCopyId = async (): Promise<void> => {
    if (!activeId) return;
    setCopying(true);
    try {
      const copied = await actions.onCopy(activeId);
      if (copied) {
        setCopyDone(true);
        actions.onNotify(t('bot.copied'));
        window.setTimeout(() => setCopyDone(false), 1600);
      }
    } finally {
      setCopying(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const targetBotId = uploadTargetRef.current ?? activeId;
    uploadTargetRef.current = null;
    if (!targetBotId) return;

    try {
      const dataUrl = await cropAvatarToDataUrl(file);
      actions.onBotDraftChange(targetBotId, { avatar: { kind: 'replace', dataUrl } });
    } catch (error) {
      const code = error instanceof AvatarProcessingError ? error.code : null;
      const key: I18nKey =
        code === 'too-large'
          ? 'bot.avatarTooLarge'
          : code === 'invalid-type'
            ? 'bot.avatarInvalidType'
            : 'bot.avatarCropFailed';
      actions.onNotify(t(key));
    }
  };

  const handleRequestAvatarUpload = (botId: string): void => {
    if (locked || !botId) return;
    uploadTargetRef.current = botId;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleResetAvatar = (): void => {
    if (!activeId || locked) return;
    actions.onBotDraftChange(activeId, { avatar: { kind: 'clear' } });
  };

  const handleSave = async (options?: { confirmExpensive?: boolean }): Promise<void> => {
    if (!activeDetail || !draft || !dirty || locked) return;
    setSubmitting(true);
    try {
      await actions.onSaveBotConfig(activeId, options);
    } catch {
      actions.onNotify(t('bot.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestMcp = async (name: string): Promise<void> => {
    if (!activeId || !actions.onTestMcpServer || testingMcpId) return;
    const epoch = probeEpochRef.current;
    setTestingMcpId(name);
    actions.onNotify(t('bot.mcpTesting', { name }));
    try {
      const result = await actions.onTestMcpServer(activeId, name);
      if (epoch !== probeEpochRef.current) return;
      setMcpProbeOverrides((prev) => ({ ...prev, [name]: result }));
      if (result.oauthNeeded) {
        actions.onNotify(t('bot.mcpTestOauthNeeded', { name }));
      } else if (result.ok) {
        actions.onNotify(t('bot.mcpTestOk', { name, count: result.tools.length }));
      } else {
        actions.onNotify(t('bot.mcpTestFailed', { name, message: result.error || t('settings.loadFailed') }));
      }
    } catch (error) {
      if (epoch !== probeEpochRef.current) return;
      actions.onNotify(
        t('bot.mcpTestFailed', { name, message: error instanceof Error ? error.message : String(error) }),
      );
    } finally {
      if (epoch === probeEpochRef.current) {
        setTestingMcpId(null);
      }
    }
  };

  const handleConfirmRemoveMcp = async (): Promise<void> => {
    if (!activeId || !confirmRemoveMcp || !actions.onRemoveMcpServer || removingMcp) return;
    const targetName = confirmRemoveMcp;
    setRemovingMcp(true);
    try {
      const result = await actions.onRemoveMcpServer(activeId, targetName);
      if (result.ok) {
        probeEpochRef.current += 1;
        setTestingMcpId((prev) => (prev === targetName ? null : prev));
        setMcpProbeOverrides((prev) => {
          if (!(targetName in prev)) return prev;
          const next = { ...prev };
          delete next[targetName];
          return next;
        });
        actions.onNotify(t('bot.mcpRemoved', { name: targetName }));
        setConfirmRemoveMcp(null);
      } else {
        actions.onNotify(t('bot.mcpRemoveFailed', { message: result.message || t('settings.loadFailed') }));
      }
    } catch (error) {
      actions.onNotify(
        t('bot.mcpRemoveFailed', { message: error instanceof Error ? error.message : String(error) }),
      );
    } finally {
      setRemovingMcp(false);
    }
  };

  const activeRosterAvatar = view.roster.find((item) => item.id === activeId)?.avatar;
  const effectiveAvatar = resolveBotAvatar(activeDetail?.avatar || activeRosterAvatar, draft ?? undefined);
  const canResetAvatar = canResetBotAvatar({
    activeId,
    hasDetail: Boolean(activeDetail),
    draft,
    effectiveAvatar,
    locked,
    status: status.status,
  });

  const isEmptyRoster =
    status.status === 'empty_list' ||
    (view.roster.length === 0 &&
      status.status !== 'fetching_list' &&
      status.status !== 'uninitialized' &&
      status.status !== 'list_error');

  const showRoster =
    !isEmptyRoster &&
    view.roster.length > 0 &&
    status.status !== 'fetching_list' &&
    status.status !== 'list_error' &&
    status.status !== 'uninitialized';

  const showForm =
    Boolean(activeDetail && draft) && status.status !== 'detail_error' && status.status !== 'loading_detail';
  const showDetailError = showRoster && status.status === 'detail_error';
  const showDetailLoading = showRoster && !showForm && !showDetailError;
  const showSaving = saving || submitting;

  const errorBanner = view.errorBanner;
  const confirmPending = view.confirmPending;

  const modelGroups = React.useMemo(() => {
    const groups = new Map<string, { id: string; name: string; models: Array<{ id: string; name: string }> }>();
    for (const option of view.availableModels) {
      const existing = groups.get(option.provider);
      if (existing) {
        existing.models.push({ id: option.id, name: option.name });
        continue;
      }
      groups.set(option.provider, {
        id: option.provider,
        name: option.providerName || option.provider,
        models: [{ id: option.id, name: option.name }],
      });
    }
    return Array.from(groups.values());
  }, [view.availableModels]);

  const currentModelOffline = Boolean(
    draft?.model && !view.availableModels.some((option) => option.id === draft.model),
  );

  const soulText = draft?.soul ?? '';
  const soulBytes = React.useMemo(() => computeSoulByteLength(soulText), [soulText]);
  const soulLines = React.useMemo(() => computeSoulLineCount(soulText), [soulText]);
  const soulOverLimit = isSoulOverLimit(soulBytes);
  const soulRatioPercent = Math.min(100, Math.max(soulBytes > 0 ? 4 : 0, Math.round((soulBytes / SOUL_SOFT_LIMIT_BYTES) * 100)));

  const insertSoulText = (text: string): void => {
    if (!draft || locked) return;
    const node = soulRef.current;
    const nextEdit = insertTextAtSelection(draft.soul, text, node?.selectionStart, node?.selectionEnd);
    patchDraft({ soul: nextEdit.value });
    window.requestAnimationFrame(() => {
      const next = soulRef.current;
      if (!next) return;
      next.focus();
      next.setSelectionRange(nextEdit.caret, nextEdit.caret);
    });
  };

  const identityTitle = resolveBotDisplayTitle(activeDetail?.displayName ?? '', activeId, draft ?? undefined);
  const identityAvatarHtml = activeDetail
    ? renderBotAvatar(activeId, identityTitle, effectiveAvatar, IDENTITY_AVATAR_SIZE, 'circle')
    : '';
  const modelDisplay = draft?.model ? presentModel(draft.model).name : t('bot.modelUnbound');

  // 计算能力分组激活 ID 集合与统计值。
  const enabledSkillIds = React.useMemo(
    () =>
      activeDetail && draft
        ? activeDetail.skills.rows.filter((row) => !draft.disabledSkills.includes(row.id)).map((row) => row.id)
        : [],
    [activeDetail, draft],
  );
  const enabledToolsetsCount = activeDetail && draft
    ? countEnabledCapabilities(activeDetail.toolsets, draft.enabledToolsets)
    : 0;
  const enabledSkillsCount = activeDetail
    ? countEnabledCapabilities(activeDetail.skills, enabledSkillIds)
    : 0;
  const enabledMcpCount = activeDetail && draft
    ? countEnabledCapabilities(activeDetail.mcpServers, draft.enabledMcpServers)
    : 0;

  const filteredToolsets = React.useMemo(
    () =>
      activeDetail && draft
        ? filterCapabilities(activeDetail.toolsets.rows, draft.enabledToolsets, capFilter, capQuery)
        : [],
    [activeDetail, draft, capFilter, capQuery],
  );
  const filteredSkills = React.useMemo(
    () =>
      activeDetail
        ? filterCapabilities(activeDetail.skills.rows, enabledSkillIds, capFilter, capQuery)
        : [],
    [activeDetail, enabledSkillIds, capFilter, capQuery],
  );
  const filteredMcp = React.useMemo(
    () =>
      activeDetail && draft
        ? filterCapabilities(activeDetail.mcpServers.rows, draft.enabledMcpServers, capFilter, capQuery)
        : [],
    [activeDetail, draft, capFilter, capQuery],
  );

  const installedMcpNames = React.useMemo(
    () => new Set(activeDetail?.mcpServers.rows.map((row) => row.id) ?? []),
    [activeDetail?.mcpServers.rows],
  );
  const installedSkillNames = React.useMemo(
    () => new Set(activeDetail?.skills.rows.map((row) => row.id) ?? []),
    [activeDetail?.skills.rows],
  );

  const mergeMcpProbeRow = (id: string) => {
    const base = activeDetail?.mcpServers.rows.find((item) => item.id === id);
    const probe = mcpProbeOverrides[id];
    if (!base) return undefined;
    if (!probe) return base;
    return {
      ...base,
      online: probe.ok ? true : base.online,
      toolCount: probe.ok ? probe.tools.length : base.toolCount,
    };
  };

  const renderCapToolbar = (
    tab: 'toolsets' | 'skills' | 'mcp',
    totalCount: number,
    enabledCount: number,
    rightAction: React.ReactNode,
  ): React.ReactElement => (
    <div className="flex shrink-0 flex-col gap-3 border-b border-border-subtle pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-44 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            size="sm"
            value={capQuery}
            data-bot-cap-search={tab}
            aria-label={t('bot.capSearchPlaceholder')}
            placeholder={t('bot.capSearchPlaceholder')}
            onChange={(event) => setCapQuery(event.target.value)}
            className="pl-8"
          />
        </div>
        {rightAction}
      </div>

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t(TAB_LABEL_KEYS[tab])}>
        {(
          [
            ['all', t('bot.capFilterAll', { count: totalCount })],
            ['enabled', t('bot.capFilterEnabled', { count: enabledCount })],
            ['disabled', t('bot.capFilterDisabled', { count: Math.max(0, totalCount - enabledCount) })],
          ] as const
        ).map(([mode, label]) => {
          const selected = capFilter === mode;
          return (
            <button
              key={mode}
              type="button"
              data-bot-cap-filter={mode}
              aria-pressed={selected}
              onClick={() => setCapFilter(mode)}
              className={`inline-flex h-7 items-center rounded-full border px-3 text-caption transition-colors ${
                selected
                  ? 'border-primary-border bg-primary-subtle font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-card-hover hover:text-foreground'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div data-bot-manager="true" className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      {status.status === 'uninitialized' || status.status === 'fetching_list' ? (
        <div className="flex flex-1 overflow-hidden" aria-busy="true">
          <div
            className="flex shrink-0 flex-col gap-2 border-r border-border-subtle bg-panel p-3"
            style={{ width: 204 }}
          >
            <Skeleton className="h-7 w-full rounded-card" />
            <Skeleton className="h-9 w-full rounded-card" />
            <Skeleton className="h-9 w-full rounded-card" />
            <Skeleton className="h-9 w-full rounded-card" />
          </div>
          <div className="flex flex-1 flex-col gap-4 px-6 py-5">
            <Skeleton className="h-14 w-full rounded-card" />
            <Skeleton className="h-64 w-full rounded-card" />
          </div>
        </div>
      ) : null}

      {status.status === 'list_error' ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-12 text-center"
          role="alert"
        >
          <p className="text-body font-semibold text-foreground">{t('bot.loadFailedTitle')}</p>
          <p className="max-w-96 break-words text-caption text-muted-foreground">{status.message}</p>
          <Button type="button" variant="outline" size="sm" onClick={actions.onRetryBotList}>
            {t('bot.retry')}
          </Button>
        </div>
      ) : null}

      {isEmptyRoster ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-12 text-center">
          <BotIcon aria-hidden="true" className="size-7 text-muted-foreground" />
          <p className="text-body font-semibold text-foreground">{t('bot.emptyRoster')}</p>
          <p className="max-w-96 text-caption text-muted-foreground">{t('bot.emptyRosterHint')}</p>
          <Button type="button" disabled>
            {t('bot.createFirst')}
          </Button>
        </div>
      ) : null}

      {showRoster ? (
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          <BotHeroCarousel
            roster={view.roster}
            activeBotId={activeId}
            activeDraft={view.activeDraft}
            locked={locked}
            onSettle={actions.onSelectBotSettle}
            onRequestAvatarUpload={handleRequestAvatarUpload}
          />

          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            {errorBanner && !confirmPending ? (
              <div
                role="alert"
                className="mx-6 mt-3 flex shrink-0 items-start justify-between gap-3 rounded-card border border-destructive bg-panel px-3 py-2"
              >
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-caption text-destructive">
                  {errorBanner}
                </p>
                <Tooltip content={t('bot.errorBannerDismiss')} placement="left">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    aria-label={t('bot.errorBannerDismiss')}
                    onClick={actions.onDismissBotError}
                    className="shrink-0"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </Button>
                </Tooltip>
              </div>
            ) : null}

            {confirmPending ? (
              <div
                role="status"
                aria-live="polite"
                data-bot-confirm="true"
                className="mx-6 mt-3 flex shrink-0 flex-col gap-2 rounded-card border border-warning bg-panel px-3 py-2"
              >
                <p className="whitespace-pre-wrap break-words text-caption text-warning">
                  {confirmPending.message || t('bot.confirmRequired')}
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={locked}
                    onClick={actions.onDismissBotConfirm}
                  >
                    {t('bot.confirmDismiss')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={locked}
                    onClick={() => {
                      void handleSave({ confirmExpensive: true });
                    }}
                  >
                    {t('bot.confirmSave')}
                  </Button>
                </div>
              </div>
            ) : null}

            {showDetailError && status.status === 'detail_error' ? (
              <div
                className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-12 text-center"
                role="alert"
              >
                <p className="text-body font-semibold text-foreground">{t('bot.loadFailed')}</p>
                <p className="max-w-96 break-words text-caption text-muted-foreground">{status.message}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!activeId}
                  onClick={() => actions.onSelectBotSettle(activeId)}
                >
                  {t('bot.retry')}
                </Button>
              </div>
            ) : null}

            {showDetailLoading ? (
              <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5" aria-busy="true">
                <div className="flex items-center gap-4">
                  <Skeleton className="size-12 shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-56" />
                  </div>
                </div>
                <SettingTwoColumn>
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </SettingTwoColumn>
                <Skeleton className="h-32 w-full rounded-card" />
              </div>
            ) : null}

            {showForm && draft && activeDetail ? (
              <>
                {/* 顶部去框化紧凑身份头：头像悬停点换图，仅存在可重置头像时展示轻量化重置图标 */}
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-6 pb-3 pt-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Tooltip content={t('bot.avatarUpload')} placement="bottom">
                      <button
                        type="button"
                        disabled={locked || !activeId}
                        aria-label={t('bot.avatarUpload')}
                        onClick={() => handleRequestAvatarUpload(activeId)}
                        style={{ width: 48, height: 48 }}
                        className="group relative flex shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span
                          aria-hidden="true"
                          data-bot-avatar="true"
                          style={{ width: 48, height: 48 }}
                          className="flex shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full"
                          // eslint-disable-next-line react/no-danger
                          dangerouslySetInnerHTML={{ __html: identityAvatarHtml }}
                        />
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 flex items-center justify-center rounded-full bg-popover/90 text-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                        >
                          <Camera aria-hidden="true" className="size-4" />
                        </span>
                      </button>
                    </Tooltip>

                    {canResetAvatar ? (
                      <Tooltip content={t('bot.avatarReset')} placement="bottom">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={locked}
                          aria-label={t('bot.avatarReset')}
                          onClick={handleResetAvatar}
                          className="shrink-0 text-muted-foreground"
                        >
                          <RotateCcw aria-hidden="true" className="size-3" />
                        </Button>
                      </Tooltip>
                    ) : null}

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <h4 className="truncate text-title font-semibold text-foreground">{identityTitle}</h4>
                        {draft.isDefault ? (
                          <Badge variant="default" className="shrink-0 px-2 py-0 text-micro">
                            {t('bot.defaultBadge')}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2" data-settings-anchor="bot-id">
                        <code
                          id="bot-id"
                          aria-readonly="true"
                          className="rounded-inner bg-panel px-2 py-0 font-code text-caption text-secondary-foreground"
                        >
                          {activeId}
                        </code>
                        <Tooltip content={copyDone ? t('bot.copied') : t('bot.copyId')} placement="bottom">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={copying || !activeId}
                            aria-label={copyDone ? t('bot.copied') : t('bot.copyId')}
                            onClick={() => {
                              void handleCopyId();
                            }}
                          >
                            {copyDone ? (
                              <Check aria-hidden="true" className="size-3 text-success" />
                            ) : (
                              <Copy aria-hidden="true" className="size-3" />
                            )}
                          </Button>
                        </Tooltip>
                        <span aria-hidden="true" className="text-faint">·</span>
                        <span className="truncate text-caption text-muted-foreground">{modelDisplay}</span>
                      </div>
                    </div>
                  </div>

                  <Tooltip content={t('bot.setDefaultHint')} placement="bottom">
                    <div className="flex shrink-0 items-center gap-2" data-settings-anchor="bot-default">
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => patchDraft({ isDefault: !draft.isDefault })}
                        className={`text-aux transition-colors ${
                          locked ? 'cursor-not-allowed text-muted-foreground opacity-60' : 'cursor-pointer text-secondary-foreground hover:text-foreground'
                        }`}
                      >
                        {t('bot.setDefault')}
                      </button>
                      <Switch
                        id="bot-set-default"
                        checked={draft.isDefault}
                        disabled={locked}
                        aria-label={t('bot.setDefault')}
                        onCheckedChange={(next) => patchDraft({ isDefault: next })}
                      />
                    </div>
                  </Tooltip>
                </header>

                {/* 扁平一级菜单栏：基本信息 / 角色设定 / 工具 / 技能 / MCP（零数字徽标 + GPU 底线滑块） */}
                <div
                  ref={tabBarRef}
                  role="tablist"
                  aria-label={t('settings.sectionAgents')}
                  onKeyDown={(event) => {
                    const currentIdx = DETAIL_TABS.indexOf(activeTab);
                    let nextTab: BotDetailTab | undefined;
                    if (event.key === 'ArrowRight') nextTab = DETAIL_TABS[(currentIdx + 1) % DETAIL_TABS.length];
                    else if (event.key === 'ArrowLeft') nextTab = DETAIL_TABS[(currentIdx - 1 + DETAIL_TABS.length) % DETAIL_TABS.length];
                    else if (event.key === 'Home') nextTab = DETAIL_TABS[0];
                    else if (event.key === 'End') nextTab = DETAIL_TABS[DETAIL_TABS.length - 1];
                    if (!nextTab) return;
                    event.preventDefault();
                    selectTab(nextTab);
                    window.requestAnimationFrame(() => tabBtnRefs.current.get(nextTab)?.focus());
                  }}
                  className="relative flex shrink-0 items-center gap-5 border-b border-border-subtle px-6"
                >
                  {tabLine ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-0 left-0 rounded-full bg-primary transition-transform duration-200 ease-out"
                      style={{
                        height: 2,
                        width: tabLine.width,
                        transform: `translate3d(${tabLine.left}px, 0, 0)`,
                      }}
                    />
                  ) : null}

                  {DETAIL_TABS.map((tab) => {
                    const active = activeTab === tab;
                    return (
                      <button
                        key={tab}
                        ref={(el) => {
                          if (el) tabBtnRefs.current.set(tab, el);
                          else tabBtnRefs.current.delete(tab);
                        }}
                        type="button"
                        role="tab"
                        tabIndex={active ? 0 : -1}
                        aria-selected={active}
                        data-bot-tab={tab}
                        onClick={() => selectTab(tab)}
                        className={`relative flex items-center py-2 text-aux transition-colors ${
                          active
                            ? 'font-semibold text-foreground'
                            : 'font-medium text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <span>{t(TAB_LABEL_KEYS[tab])}</span>
                        {!tabLine && active ? (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-0 bottom-0 rounded-full bg-primary"
                            style={{ height: 2 }}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {/* 右侧工作台正文：三页保持挂载（非激活 hidden），保证锚点检索与 SSR 全覆盖 */}
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                  {/* Tab 1：身份与模型 */}
                  <div
                    role="tabpanel"
                    data-bot-tabpanel="basic"
                    className={
                      activeTab === 'basic'
                        ? 'animate-panel-enter scrollbar-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-20 pt-5'
                        : 'hidden'
                    }
                  >
                    <SettingTwoColumn>
                      <SettingField label={t('bot.nameLabel')} htmlFor="bot-display-name" anchorId="bot-name">
                        <Input
                          id="bot-display-name"
                          value={draft.displayName}
                          placeholder={t('bot.namePlaceholder')}
                          disabled={locked}
                          onChange={(event) => patchDraft({ displayName: event.target.value })}
                        />
                      </SettingField>

                      <SettingField label={t('bot.modelBinding')} anchorId="bot-model">
                        <GroupedModelSelect
                          id="bot-model"
                          value={draft.model}
                          provider={draft.provider}
                          groups={modelGroups}
                          currentModelOffline={currentModelOffline}
                          disabled={locked || modelGroups.length === 0}
                          ariaLabel={t('bot.modelBinding')}
                          labels={{
                            unbound: t('bot.modelUnbound'),
                            offline: t('bot.modelOffline', { model: draft.model }),
                            catalogUnavailable: t('bot.modelCatalogUnavailable'),
                            searchPlaceholder: t('bot.modelSearchPlaceholder'),
                            emptySearch: t('bot.modelEmptySearch'),
                          }}
                          onChange={(model, provider) => patchDraft({ model, provider })}
                        />
                        {modelGroups.length === 0 ? (
                          <p className="text-caption text-muted-foreground">{t('bot.modelCatalogHint')}</p>
                        ) : null}
                      </SettingField>
                    </SettingTwoColumn>

                    <SettingField label={t('bot.descLabel')} htmlFor="bot-description" anchorId="bot-desc">
                      <Textarea
                        id="bot-description"
                        rows={4}
                        value={draft.description}
                        placeholder={t('bot.descPlaceholder')}
                        disabled={locked}
                        onChange={(event) => patchDraft({ description: event.target.value })}
                      />
                    </SettingField>

                    <Surface level="panel" padding="normal" className="shrink-0" data-settings-anchor="bot-memory">
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-8 shrink-0 items-center justify-center rounded-card border border-border-subtle bg-card text-muted-foreground"
                        >
                          <Lock aria-hidden="true" className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-section font-semibold text-foreground">{t('bot.memoryTitle')}</span>
                            <Badge variant="secondary">{t('bot.memoryLocked')}</Badge>
                          </div>
                          <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
                            {t('bot.memoryNotice')}
                          </p>
                        </div>
                      </div>
                    </Surface>
                  </div>

                  {/* Tab 2：Studio 级 SOUL.md 编辑器 */}
                  <div
                    role="tabpanel"
                    data-bot-tabpanel="soul"
                    data-settings-anchor="bot-soul"
                    className={
                      activeTab === 'soul'
                        ? `animate-panel-enter flex min-h-0 flex-1 flex-col px-6 pt-4 ${
                            dirty || showSaving ? 'pb-20' : 'pb-5'
                          }`
                        : 'hidden'
                    }
                  >
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-code focus-within:border-border-strong">
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-panel px-3 py-2">
                        <div className="flex items-center gap-2">
                          <FileCode2 aria-hidden="true" className="size-4 text-primary" />
                          <span className="font-code text-caption font-semibold text-foreground">SOUL.md</span>
                          {soulOverLimit ? (
                            <span role="alert" className="text-micro text-destructive">
                              {t('bot.soulLengthWarn')}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={locked}
                            onClick={() => insertSoulText('{{user_name}}')}
                          >
                            {t('bot.soulVarUserShort')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={locked}
                            onClick={() => insertSoulText('{{workspace_root}}')}
                          >
                            {t('bot.soulVarWorkspaceShort')}
                          </Button>
                          <Menu>
                            <MenuTrigger asChild>
                              <Button type="button" variant="ghost" size="xs" disabled={locked}>
                                <span>{t('bot.soulTemplates')}</span>
                                <ChevronDown aria-hidden="true" className="size-3" />
                              </Button>
                            </MenuTrigger>
                            <MenuContent align="end" className="z-menu">
                              <MenuItem onSelect={() => insertSoulText(t('bot.soulTemplateArchitectBody'))}>
                                {t('bot.soulTemplateArchitect')}
                              </MenuItem>
                              <MenuItem onSelect={() => insertSoulText(t('bot.soulTemplateReviewerBody'))}>
                                {t('bot.soulTemplateReviewer')}
                              </MenuItem>
                            </MenuContent>
                          </Menu>
                        </div>
                      </div>

                      <div className="flex min-h-0 flex-1 overflow-hidden">
                        <div
                          ref={soulGutterRef}
                          aria-hidden="true"
                          className="w-10 shrink-0 select-none overflow-hidden border-r border-border-subtle py-3 pr-2 text-right font-code text-aux leading-relaxed text-faint"
                        >
                          {Array.from(
                            { length: Math.max(MIN_SOUL_GUTTER_LINES, soulLines) },
                            (_, idx) => (
                              <div key={idx}>{idx + 1}</div>
                            ),
                          )}
                        </div>
                        <Textarea
                          id="bot-soul"
                          ref={soulRef}
                          aria-label={t('bot.soulEditorLabel')}
                          value={draft.soul}
                          disabled={locked}
                          spellCheck={false}
                          onScroll={(event) => {
                            if (soulGutterRef.current) {
                              soulGutterRef.current.scrollTop = event.currentTarget.scrollTop;
                            }
                          }}
                          onChange={(event) => patchDraft({ soul: event.target.value })}
                          className="scrollbar-thin min-h-0 flex-1 resize-none rounded-none border-0 bg-code px-4 py-3 font-code text-aux leading-relaxed focus-visible:ring-0"
                        />
                      </div>

                      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle bg-panel px-3 py-2 font-code text-caption text-muted-foreground">
                        <span>{t('bot.soulLines', { count: soulLines })}</span>
                        <span className="flex items-center gap-2">
                          <span className={soulOverLimit ? 'text-destructive' : 'text-muted-foreground'}>
                            {t('bot.soulCount', { bytes: soulBytes })}
                          </span>
                          <span className="h-1 w-16 overflow-hidden rounded-full bg-card-active" aria-hidden="true">
                            <span
                              className={`block h-full rounded-full transition-all duration-200 ${
                                soulOverLimit ? 'bg-destructive' : 'bg-primary'
                              }`}
                              style={{ width: `${soulRatioPercent}%` }}
                            />
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Tab 3：工具（直出一级菜单） */}
                  <div
                    role="tabpanel"
                    data-bot-tabpanel="toolsets"
                    className={
                      activeTab === 'toolsets'
                        ? 'animate-panel-enter flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-4'
                        : 'hidden'
                    }
                  >
                    {renderCapToolbar(
                      'toolsets',
                      activeDetail.toolsets.rows.length,
                      enabledToolsetsCount,
                      <span className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
                        <Wrench aria-hidden="true" className="size-3" />
                        <span>{t('bot.toolsetsBuiltinHint')}</span>
                      </span>,
                    )}
                    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-20 pt-3">
                      <div data-bot-section="toolsets" data-settings-anchor="bot-toolsets">
                        <CapabilitySection
                          sectionId="toolsets"
                          list={activeDetail.toolsets}
                          visibleRows={filteredToolsets}
                          enabledIds={draft.enabledToolsets}
                          locked={locked}
                          toggleKey="bot.toolsetToggleLabel"
                          renderDetail={(id) => {
                            const row = activeDetail.toolsets.rows.find((item) => item.id === id);
                            if (!row) return undefined;
                            const parts: string[] = [];
                            if (row.description) parts.push(row.description);
                            if (typeof row.toolCount === 'number') parts.push(t('bot.toolsCount', { count: row.toolCount }));
                            return parts.length > 0 ? parts.join(' · ') : undefined;
                          }}
                          onToggle={(id, next) =>
                            patchDraft({
                              enabledToolsets: toggleCapabilityId(activeDetail.toolsets, draft.enabledToolsets, id, next),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {/* Tab 4：技能（直出一级菜单 + 安装技能入口） */}
                  <div
                    role="tabpanel"
                    data-bot-tabpanel="skills"
                    className={
                      activeTab === 'skills'
                        ? 'animate-panel-enter flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-4'
                        : 'hidden'
                    }
                  >
                    {renderCapToolbar(
                      'skills',
                      activeDetail.skills.rows.length,
                      enabledSkillsCount,
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        data-bot-install-skill="true"
                        disabled={locked || !actions.onInstallSkill}
                        onClick={() => setSkillHubOpen(true)}
                        className="shrink-0"
                      >
                        <Download aria-hidden="true" className="size-3" />
                        <span>{t('bot.skillInstallBtn')}</span>
                      </Button>,
                    )}
                    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-20 pt-3">
                      <div data-bot-section="skills" data-settings-anchor="bot-skills">
                        <CapabilitySection
                          sectionId="skills"
                          list={activeDetail.skills}
                          visibleRows={filteredSkills}
                          enabledIds={enabledSkillIds}
                          locked={locked}
                          toggleKey="bot.skillsToggleLabel"
                          renderDetail={(id) => {
                            const row = activeDetail.skills.rows.find((item) => item.id === id);
                            return row?.description?.trim() || undefined;
                          }}
                          onInspect={
                            actions.onInspectSkill
                              ? (id) => {
                                  const row = activeDetail.skills.rows.find((item) => item.id === id);
                                  setInspectingSkill({ name: id, description: row?.description });
                                }
                              : undefined
                          }
                          inspectLabelKey="bot.skillInspectLabel"
                          onToggle={(id, next) => {
                            const disabled = new Set(draft.disabledSkills);
                            if (next) disabled.delete(id);
                            else disabled.add(id);
                            patchDraft({ disabledSkills: Array.from(disabled) });
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Tab 5：MCP（直出一级菜单 + 新增/测试/删除） */}
                  <div
                    role="tabpanel"
                    data-bot-tabpanel="mcp"
                    className={
                      activeTab === 'mcp'
                        ? 'animate-panel-enter flex min-h-0 flex-1 flex-col overflow-hidden px-6 pt-4'
                        : 'hidden'
                    }
                  >
                    {renderCapToolbar(
                      'mcp',
                      activeDetail.mcpServers.rows.length,
                      enabledMcpCount,
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        data-bot-add-mcp="true"
                        disabled={locked || !actions.onAddMcpServer}
                        onClick={() => setMcpAddOpen(true)}
                        className="shrink-0"
                      >
                        <Plus aria-hidden="true" className="size-3" />
                        <span>{t('bot.mcpAddBtn')}</span>
                      </Button>,
                    )}
                    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-20 pt-3">
                      <div data-bot-section="mcp" data-settings-anchor="bot-mcp">
                        <CapabilitySection
                          sectionId="mcp"
                          list={activeDetail.mcpServers}
                          visibleRows={filteredMcp}
                          enabledIds={draft.enabledMcpServers}
                          locked={locked}
                          toggleKey="bot.mcpToggleLabel"
                          renderDetail={(id) => {
                            const row = mergeMcpProbeRow(id);
                            if (!row) return undefined;
                            const parts: string[] = [];
                            if (row.transport) parts.push(row.transport);
                            if (typeof row.toolCount === 'number') parts.push(t('bot.mcpToolCount', { count: row.toolCount }));
                            return parts.length > 0 ? parts.join(' · ') : undefined;
                          }}
                          statusOf={(id) => {
                            const row = mergeMcpProbeRow(id);
                            if (!row || row.online === undefined) {
                              return { text: t('bot.mcpUnknown'), tone: 'muted' };
                            }
                            return row.online
                              ? { text: t('bot.mcpOnline'), tone: 'success' }
                              : { text: t('bot.mcpOffline'), tone: 'muted' };
                          }}
                          renderRowActions={(id) => (
                            <div className="flex items-center gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                              {actions.onTestMcpServer ? (
                                <Tooltip content={t('bot.mcpTestBtn')} placement="top">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    data-mcp-test={id}
                                    disabled={locked || testingMcpId === id}
                                    aria-label={t('bot.mcpTestBtn')}
                                    onClick={() => {
                                      void handleTestMcp(id);
                                    }}
                                  >
                                    <Zap aria-hidden="true" className="size-3" />
                                  </Button>
                                </Tooltip>
                              ) : null}
                              {actions.onRemoveMcpServer ? (
                                <Tooltip content={t('bot.mcpRemoveBtn')} placement="top">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    data-mcp-remove={id}
                                    disabled={locked || removingMcp || testingMcpId === id}
                                    aria-label={t('bot.mcpRemoveBtn')}
                                    onClick={() => setConfirmRemoveMcp(id)}
                                  >
                                    <Trash2 aria-hidden="true" className="size-3" />
                                  </Button>
                                </Tooltip>
                              ) : null}
                            </div>
                          )}
                          onToggle={(id, next) =>
                            patchDraft({
                              enabledMcpServers: toggleCapabilityId(activeDetail.mcpServers, draft.enabledMcpServers, id, next),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 底部悬浮胶囊保存条：仅存在草稿或保存中浮起，干净态平滑收起且按钮禁用 */}
                <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-6">
                  <div
                    role="status"
                    data-bot-save-dock="true"
                    className={`shadow-dock flex items-center gap-3 rounded-full border border-border-strong bg-popover px-4 py-2 transition-all duration-200 ease-out ${
                      dirty || showSaving
                        ? 'pointer-events-auto translate-y-0 opacity-100'
                        : 'pointer-events-none translate-y-2 opacity-0'
                    }`}
                  >
                    {dirty || showSaving ? (
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />
                        <span className="truncate text-aux text-foreground">{t('bot.draftNotice')}</span>
                      </div>
                    ) : null}
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={!dirty || locked}
                        tabIndex={dirty || showSaving ? undefined : -1}
                        onClick={() => actions.onResetBotDraft(activeId)}
                      >
                        {t('bot.resetBtn')}
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        disabled={!dirty || locked}
                        tabIndex={dirty || showSaving ? undefined : -1}
                        onClick={() => {
                          void handleSave();
                        }}
                      >
                        {showSaving ? t('bot.saving') : t('bot.saveBtn')}
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />

      <McpAddDialog
        open={mcpAddOpen}
        targetProfile={activeId}
        targetLabel={identityTitle || activeId}
        installedNames={installedMcpNames}
        onClose={() => setMcpAddOpen(false)}
        onFetchCatalog={actions.onFetchMcpCatalog}
        onAddServer={actions.onAddMcpServer}
        onNotify={actions.onNotify}
      />

      <SkillInstallDialog
        open={skillHubOpen}
        targetProfile={activeId}
        installedNames={installedSkillNames}
        onClose={() => setSkillHubOpen(false)}
        onSearchSkills={actions.onSearchSkillsHub}
        onInstallSkill={actions.onInstallSkill}
        onNotify={actions.onNotify}
      />

      <SkillDetailDialog
        skillName={inspectingSkill?.name ?? null}
        targetProfile={activeId}
        fallbackDescription={inspectingSkill?.description}
        onClose={() => setInspectingSkill(null)}
        onInspectSkill={actions.onInspectSkill}
        onCopy={actions.onCopy}
        onNotify={actions.onNotify}
      />

      <McpRemoveConfirmDialog
        serverName={confirmRemoveMcp}
        busy={removingMcp}
        onCancel={() => setConfirmRemoveMcp(null)}
        onConfirm={() => {
          void handleConfirmRemoveMcp();
        }}
      />

      {view.exitPrompt ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) actions.onCancelBotExit();
          }}
        >
          <DialogContent portal={false} className="flex w-full max-w-md flex-col gap-0 overflow-hidden rounded-window p-0">
            <div className="border-b border-border-subtle px-4 py-3">
              <DialogTitle className="text-section font-medium text-foreground">
                {t('bot.discardConfirmTitle')}
              </DialogTitle>
            </div>
            <div className="px-4 py-3">
              <DialogDescription className="text-caption leading-relaxed text-muted-foreground">
                {t('bot.discardConfirmBody')}
              </DialogDescription>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
              <Button variant="ghost" size="sm" type="button" onClick={actions.onCancelBotExit}>
                {t('settings.cancel')}
              </Button>
              <Button variant="outline" size="sm" type="button" onClick={() => actions.onConfirmBotExit('keep')}>
                {t('bot.keepDraftBtn')}
              </Button>
              <Button variant="destructive" size="sm" type="button" onClick={() => actions.onConfirmBotExit('discard')}>
                {t('bot.discardBtn')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
