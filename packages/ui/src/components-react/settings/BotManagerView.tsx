import * as React from 'react';
import { Bot as BotIcon, ChevronDown, Copy, X } from 'lucide-react';
import {
  draftFromDetail,
  isBotDraftDirty,
  type BotCapabilityList,
  type BotDraftState,
} from '@hermes-flux/core';
import { t, type I18nKey } from '../../i18n/index.js';
import { AvatarProcessingError, cropAvatarToDataUrl } from '../../utils/cropAvatar.js';
import { ActivityIndicator } from '../primitives/ActivityIndicator.js';
import { Button } from '../primitives/Button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Select, type SelectGroup } from '../primitives/Select.js';
import { Skeleton } from '../primitives/Skeleton.js';
import { Switch } from '../primitives/Switch.js';
import { Textarea } from '../primitives/Textarea.js';
import { BotHeroCarousel } from './BotHeroCarousel.js';
import { CapabilitySection } from './BotCapabilityList.js';
import { ModelOptionRow, ModelVendorIcon } from './ModelPicker.js';
import { SettingField, SettingInset, SettingRow, SettingTwoColumn } from './SettingRow.js';
import { buildModelSelectGroups } from './settingsModel.js';
import type { SettingsActions, SettingsSnapshot } from './settingsModel.js';

/** SOUL.md 软上限：64KB（UTF-8 字节）。超出只警告，不阻断保存。 */
const SOUL_SOFT_LIMIT_BYTES = 64 * 1024;

/**
 * 折叠区（CSS Grid 0fr -> 1fr）。
 *
 * 【设计意图】需求 §7.2 明确要求折叠不测量高度、不用 max-height 猜测：
 *   内容高度由浏览器自然决定，只用 grid-template-rows 过渡。
 *
 * 【动效时序】遵循审美宪法 I6 的进退场非对称：展开 120ms（快速响应意图），
 *   收起 200ms（让用户看清内容消失的方向）。方向反了会让"打开"显得迟钝、"关闭"像被掐断。
 *
 * 【规则】内容始终挂载（SSR 与测试可断言），收起时由外层 overflow-hidden 裁剪，
 *   并设置 `visibility` 以移出 Tab 序列，避免键盘焦点落进不可见控件。
 */
function BotSection({
  id,
  title,
  hint,
  anchorId,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  /** 检索跳转锚点；与设置项索引的 id 逐字一致。 */
  anchorId?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="shrink-0 border-t border-border-subtle" data-bot-section={id} data-settings-anchor={anchorId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`bot-section-${id}`}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left transition-colors hover:bg-card-hover"
      >
        <span className="min-w-0">
          <span className="block text-section font-semibold text-foreground">{title}</span>
          {hint ? <span className="mt-1 block text-caption text-muted-foreground">{hint}</span> : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      <div
        id={`bot-section-${id}`}
        role="region"
        aria-label={title}
        className="grid"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
          transitionProperty: 'grid-template-rows',
          transitionDuration: open ? '120ms' : '200ms',
          transitionTimingFunction: open ? 'ease-out' : 'ease-in',
        }}
      >
        <div className="min-h-0 overflow-hidden" style={{ visibility: open ? 'visible' : 'hidden' }}>
          <div className="px-6 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * BOT 配置中枢（第二步：模型绑定 + SOUL.md + 能力矩阵 + 长期记忆）。
 *
 * 【设计意图 (Why)】
 *   旧设置页的"专职员工"是只读列表，点编辑会弹出一个与设计系统脱节的 HTML 浮层，
 *   用户要在两个界面之间对齐同一个 BOT。这里把选择、编辑、草稿、保存收进同一块
 *   设置分区：顶部滑动选择器负责"换人"，下方单列表单负责"改人"，底部操作栏负责
 *   "落盘或回滚"。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 失败时先清空表单再显示错误，用户辛苦写的描述直接蒸发（F-19）；
 *   2. 保存期间不禁用输入，连击会把第二次请求覆盖掉第一次的结果（F-20）；
 *   3. 组件内自持草稿，设置弹窗一关、React 树卸载，未保存内容全部消失（F-18）；
 *   4. 头像上传只校验扩展名，改后缀的文本文件到解码阶段才炸；
 *   5. 空态按钮做成可点击但没有向导承接，用户点了以为坏了（禁止假可用）；
 *   6. 能力清单缺字段时把"读取缺口"当"全部关闭"写回，清空用户真实配置；
 *   7. MCP 探活失败画成红灯，用户以为服务挂了（失败必须是"状态未知"）；
 *   8. 模型下拉只认当前目录，当前模型离线时静默清空，保存即把绑定改掉。
 *
 * 【约束与规则 (Rules)】
 *   1. 本组件不取数、不持久化，所有读值来自 SettingsSnapshot，所有写动作走 SettingsActions；
 *   2. 草稿优先：snapshot.botManagement.activeDraft 缺省时才用 activeDetail 生成初始草稿；
 *   3. 保存/重置只作用于当前 activeBotId，绝不跨 BOT 批量提交；
 *   4. 能力清单 `authoritative === false` 时只展示，开关禁用；
 *   5. 文案全部走 t()，颜色只用语义 Token，字号只用 7 档语义字阶。
 */
export function BotManagerView({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement {
  const view = snapshot.botManagement;
  const status = view.status;
  const activeId = view.activeBotId;
  const activeDetail = view.activeDetail;

  /**
   * 草稿解析：快照只给当前 BOT 的草稿；缺省时由权威详情生成同构初始草稿。
   * 【规则】不把兜底草稿写回壳层；只有用户真正修改时才通过 onBotDraftChange 落池。
   */
  const draft: BotDraftState | null =
    view.activeDraft ?? (activeDetail ? draftFromDetail(activeDetail) : null);

  const dirty = Boolean(activeDetail && draft && isBotDraftDirty(activeDetail, draft));
  const saving = status.status === 'saving';
  const [submitting, setSubmitting] = React.useState(false);
  const locked = saving || submitting || view.isBusy;
  const [copying, setCopying] = React.useState(false);
  const [copyDone, setCopyDone] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadTargetRef = React.useRef<string | null>(null);
  const soulRef = React.useRef<HTMLTextAreaElement>(null);

  /**
   * 首次进入且状态为 idle、还没有详情时，主动向壳层要一次 describe。
   * 【规则】只请求一次；后续切换 BOT 由选择器吸附后的 onSettle 触发，避免重复 RPC 风暴。
   */
  const bootstrapRequestedRef = React.useRef(false);
  React.useEffect(() => {
    if (bootstrapRequestedRef.current) return;
    if (status.status !== 'idle' || activeDetail || !activeId) return;
    bootstrapRequestedRef.current = true;
    actions.onSelectBotSettle(activeId);
  }, [status.status, activeDetail, activeId, actions]);

  /**
   * 宿主级脏检查：切导航 / 关弹窗 / Esc 前由壳层调用。
   *
   * 【设计意图】草稿池跨挂载存活，但"有未保存修改"必须让用户在离场前看见，
   *   否则关掉设置页后用户以为已保存，实际草稿留在本地且不再有提示。
   * 【规则】dirty 每次变化都重新注册，闭包必须捕获最新值；
   *   卸载时注销，避免离开 agents 页后仍拦截其它域的退出。
   */
  React.useEffect(() => {
    actions.onRegisterBotDirtyGuard(() => dirty);
    return () => actions.onRegisterBotDirtyGuard(null);
  }, [actions, dirty]);

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

  /**
   * 头像文件选择后的唯一处理路径：客户端裁剪 → 写入草稿 → 等保存。
   * 【规则】绝不直接调用 set_asset；草稿里的 replace 只有在保存时才会上传。
   */
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // 允许用户连续选择同一个文件；不重置 value 时 change 不会再触发。
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
      // 壳层通常会把 RPC 失败转成 errorBanner；这里额外给一次轻量提示，绝不静默吞掉异常。
      actions.onNotify(t('bot.saveFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const avatarDraft = draft?.avatar;
  const effectiveAvatar = !draft
    ? activeDetail?.avatar
    : avatarDraft?.kind === 'replace'
      ? avatarDraft.dataUrl
      : avatarDraft?.kind === 'clear'
        ? undefined
        : activeDetail?.avatar;
  const canResetAvatar =
    Boolean(activeId && activeDetail && draft && effectiveAvatar) &&
    avatarDraft?.kind !== 'clear' &&
    !locked &&
    status.status !== 'detail_error' &&
    status.status !== 'loading_detail';

  /**
   * 空花名册兜底：状态机给出 empty_list，或列表已结束但 roster 为空。
   * 【规则】加载中/加载失败不得被误画成空态；其余场景宁可显示"创建首个 BOT"也不能留白。
   */
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

  /** 按 Provider 分组的模型目录（下拉的唯一数据源来自 providerViews 归并）。 */
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

  const soulBytes = React.useMemo(
    () => new TextEncoder().encode(draft?.soul ?? '').length,
    [draft?.soul],
  );
  const soulOverLimit = soulBytes > SOUL_SOFT_LIMIT_BYTES;

  /** 模型 ID → 厂商展示名（下拉与触发器的图标判定同源）。 */
  const providerNameOf = (modelId: string): string =>
    view.availableModels.find((option) => option.id === modelId)?.providerName ?? '';

  /**
   * 模型下拉的分组数据（纯函数构造，便于单测离线置顶与占位禁用）。
   * 【规则】离线项 / 未绑定 / 目录不可用只是不可选的占位，绝不允许通过它们改写 provider。
   */
  const modelSelectGroups = React.useMemo<SelectGroup[]>(
    () =>
      buildModelSelectGroups({
        groups: modelGroups,
        currentModel: draft?.model ?? '',
        currentModelOffline,
        labels: {
          offline: t('bot.modelOffline', { model: draft?.model ?? '' }),
          unbound: t('bot.modelUnbound'),
          catalogUnavailable: t('bot.modelCatalogUnavailable'),
        },
      }),
    [draft?.model, currentModelOffline, modelGroups],
  );

  /** 在光标处插入变量/模板；不做整段替换，避免毁掉用户已经写好的内容。 */
  const insertSoulText = (text: string): void => {
    if (!draft || locked) return;
    const node = soulRef.current;
    const value = draft.soul;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    patchDraft({ soul: value.slice(0, start) + text + value.slice(end) });
    const caret = start + text.length;
    window.requestAnimationFrame(() => {
      const next = soulRef.current;
      if (!next) return;
      next.focus();
      next.setSelectionRange(caret, caret);
    });
  };

  const toggleFromList = (
    list: BotCapabilityList,
    current: readonly string[],
    id: string,
    next: boolean,
  ): string[] => {
    if (!list.authoritative) return [...current];
    const set = new Set(current);
    if (next) set.add(id);
    else set.delete(id);
    return Array.from(set);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {showRoster ? (
        <>
          <BotHeroCarousel
            roster={view.roster}
            activeBotId={activeId}
            activeDraft={view.activeDraft}
            locked={locked}
            onSettle={actions.onSelectBotSettle}
            onRequestAvatarUpload={handleRequestAvatarUpload}
          />

          <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border-subtle bg-panel px-6 py-2">
            {/* 头像两个动作必须同时可见：更换此前只藏在 Hero 的 hover 遮罩里（鼠标用户才能发现），
                恢复默认又独占一行；现在两者并列常驻，Hero 遮罩保留为快捷入口。 */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={locked || !activeId}
              title={t('bot.avatarUpload')}
              onClick={() => handleRequestAvatarUpload(activeId)}
            >
              {t('bot.avatarUpload')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canResetAvatar || locked}
              title={t('bot.avatarReset')}
              onClick={handleResetAvatar}
            >
              {t('bot.avatarReset')}
            </Button>
          </div>
        </>
      ) : null}

      {errorBanner && !confirmPending ? (
        <div
          role="alert"
          className="mx-6 mt-3 flex shrink-0 items-start justify-between gap-3 rounded-card border border-destructive bg-panel px-3 py-2"
        >
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-caption text-destructive">{errorBanner}</p>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label={t('bot.errorBannerDismiss')}
            title={t('bot.errorBannerDismiss')}
            onClick={actions.onDismissBotError}
            className="shrink-0"
          >
            <X aria-hidden="true" className="size-3" />
          </Button>
        </div>
      ) : null}

      {/* 确认横幅与错误横幅互斥（确认优先）：两者同时出现会让读屏连续两次打断式播报，用户分不清哪个是错误。
          控制器侧已保证二者不会同时置位；这里的互斥是防御，避免未来接线把两条横幅一起画出来。 */}
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

      {status.status === 'uninitialized' || status.status === 'fetching_list' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12" aria-busy="true">
          <div className="flex items-end justify-center gap-4">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="size-12 rounded-full" />
            <Skeleton className="size-16 rounded-full" />
            <Skeleton className="size-12 rounded-full" />
            <Skeleton className="size-10 rounded-full" />
          </div>
          <Skeleton className="h-4 w-48" />
        </div>
      ) : null}

      {status.status === 'list_error' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-12 text-center" role="alert">
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
          {/* 向导属于后续阶段：壳层尚未提供承接弹窗，按钮保持 disabled，禁止假可用。 */}
          <Button type="button" disabled title={t('bot.emptyRosterHint')}>
            {t('bot.createFirst')}
          </Button>
        </div>
      ) : null}

      {showDetailError && status.status === 'detail_error' ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-12 text-center" role="alert">
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
        <div className="flex flex-1 flex-col gap-4 px-6 py-4" aria-busy="true">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      ) : null}

      {showForm && draft && activeDetail ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col gap-4 px-6 py-4">
            <SettingTwoColumn>
              <SettingField label={t('bot.idLabel')} htmlFor="bot-id" anchorId="bot-id">
                <div className="flex items-center gap-2">
                  <Input id="bot-id" value={activeId} readOnly className="font-code" aria-readonly="true" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={copying || !activeId}
                    title={t('bot.copyId')}
                    onClick={() => {
                      void handleCopyId();
                    }}
                  >
                    <Copy aria-hidden="true" className="size-3" />
                    {copyDone ? t('bot.copied') : t('bot.copyId')}
                  </Button>
                </div>
              </SettingField>
              <SettingField label={t('bot.nameLabel')} htmlFor="bot-display-name" anchorId="bot-name">
                <Input
                  id="bot-display-name"
                  value={draft.displayName}
                  placeholder={t('bot.namePlaceholder')}
                  disabled={locked}
                  onChange={(event) => patchDraft({ displayName: event.target.value })}
                />
              </SettingField>
            </SettingTwoColumn>

            <SettingField label={t('bot.modelBinding')} anchorId="bot-model">
              {/* 模型下拉走 Select 原语：深色皮肤下不再弹系统白色列表，且能承载厂商图标与分组标题。 */}
              <Select
                id="bot-model"
                value={draft.model}
                ariaLabel={t('bot.modelBinding')}
                disabled={locked || modelGroups.length === 0}
                groups={modelSelectGroups}
                onChange={(model) => {
                  const option = view.availableModels.find((item) => item.id === model);
                  // 离线项/未绑定项只是占位：选不中目录里的真实项时不得改写 provider。
                  if (!option) return;
                  patchDraft({ model, provider: option.provider });
                }}
                renderOption={(option) => (
                  <ModelOptionRow
                    modelId={option.value}
                    providerName={providerNameOf(option.value)}
                    selected={option.value === draft.model}
                  />
                )}
                renderValue={(value, current) => {
                  if (!value) {
                    return <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">{t('bot.modelUnbound')}</span>;
                  }
                  return (
                    <>
                      <ModelVendorIcon modelId={value} providerName={providerNameOf(value)} />
                      <span className="min-w-0 flex-1 truncate text-body text-foreground">{current?.label ?? value}</span>
                    </>
                  );
                }}
              />
              {modelGroups.length === 0 ? (
                <p className="text-caption text-muted-foreground">{t('bot.modelCatalogHint')}</p>
              ) : null}
            </SettingField>

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

            {/* i18n 早已定义这两条文案，但表单从未渲染：用户无法在这里改变工作区默认 BOT。
                用 SettingInset 承载，保持与上方字段同一条 16px 节奏（SettingRow 自带 py-3）。 */}
            <SettingInset>
              <SettingRow
                label={t('bot.setDefault')}
                hint={t('bot.setDefaultHint')}
                anchorId="bot-default"
                onLabelActivate={() => patchDraft({ isDefault: !draft.isDefault })}
              >
                <Switch
                  id="bot-set-default"
                  checked={draft.isDefault}
                  disabled={locked}
                  aria-label={t('bot.setDefault')}
                  onCheckedChange={(next) => patchDraft({ isDefault: next })}
                />
              </SettingRow>
            </SettingInset>
          </div>

          <BotSection id="soul" anchorId="bot-soul" title={t('bot.soulTitle')} hint={t('bot.soulHint')}>
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => insertSoulText('{{user_name}}')}>
                {t('bot.soulInsertUserName')}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => insertSoulText('{{workspace_root}}')}>
                {t('bot.soulInsertWorkspace')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={() => insertSoulText(t('bot.soulTemplateArchitectBody'))}
              >
                {t('bot.soulTemplateArchitect')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={() => insertSoulText(t('bot.soulTemplateReviewerBody'))}
              >
                {t('bot.soulTemplateReviewer')}
              </Button>
            </div>
            <Textarea
              id="bot-soul"
              ref={soulRef}
              aria-label={t('bot.soulEditorLabel')}
              rows={12}
              value={draft.soul}
              disabled={locked}
              spellCheck={false}
              onChange={(event) => patchDraft({ soul: event.target.value })}
              className="min-h-32 resize-y font-code"
              style={{ backgroundColor: 'var(--code)' }}
            />
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className={`text-micro ${soulOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                {t('bot.soulCount', { bytes: soulBytes })}
              </span>
              {soulOverLimit ? (
                <span role="alert" className="text-micro text-destructive">
                  {t('bot.soulLengthWarn')}
                </span>
              ) : null}
            </div>
          </BotSection>

          <BotSection id="toolsets" anchorId="bot-toolsets" title={t('bot.toolsetsTitle')} hint={t('bot.toolsetsHint')}>
            <CapabilitySection
              list={activeDetail.toolsets}
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
                  enabledToolsets: toggleFromList(activeDetail.toolsets, draft.enabledToolsets, id, next),
                })
              }
            />
          </BotSection>

          <BotSection id="skills" anchorId="bot-skills" title={t('bot.skillsTitle')} hint={t('bot.skillsHint')}>
            <CapabilitySection
              list={activeDetail.skills}
              // 草稿存"已关闭"集合；展示时折算成"启用集合"交给通用行组件。
              enabledIds={activeDetail.skills.rows
                .filter((row) => !draft.disabledSkills.includes(row.id))
                .map((row) => row.id)}
              locked={locked}
              toggleKey="bot.skillsToggleLabel"
              onToggle={(id, next) => {
                const disabled = new Set(draft.disabledSkills);
                if (next) disabled.delete(id);
                else disabled.add(id);
                patchDraft({ disabledSkills: Array.from(disabled) });
              }}
            />
          </BotSection>

          <BotSection id="mcp" anchorId="bot-mcp" title={t('bot.mcpTitle')} hint={t('bot.mcpHint')}>
            <CapabilitySection
              list={activeDetail.mcpServers}
              enabledIds={draft.enabledMcpServers}
              locked={locked}
              toggleKey="bot.mcpToggleLabel"
              renderDetail={(id) => {
                const row = activeDetail.mcpServers.rows.find((item) => item.id === id);
                if (!row) return undefined;
                const parts: string[] = [];
                if (row.transport) parts.push(row.transport);
                if (typeof row.toolCount === 'number') parts.push(t('bot.mcpToolCount', { count: row.toolCount }));
                return parts.length > 0 ? parts.join(' · ') : undefined;
              }}
              statusOf={(id) => {
                const row = activeDetail.mcpServers.rows.find((item) => item.id === id);
                if (!row || row.online === undefined) {
                  return { text: t('bot.mcpUnknown'), tone: 'muted' };
                }
                return row.online
                  ? { text: t('bot.mcpOnline'), tone: 'success' }
                  : { text: t('bot.mcpOffline'), tone: 'muted' };
              }}
              onToggle={(id, next) =>
                patchDraft({
                  enabledMcpServers: toggleFromList(activeDetail.mcpServers, draft.enabledMcpServers, id, next),
                })
              }
            />
          </BotSection>

          <BotSection id="memory" anchorId="bot-memory" title={t('bot.memoryTitle')}>
            {/* 长期记忆只能由该 BOT 的终身主工位写入；配置中枢不提供跨上下文编辑入口。 */}
            <p className="rounded-card border border-border-subtle bg-panel px-3 py-2 text-caption leading-relaxed text-muted-foreground">
              {t('bot.memoryNotice')}
            </p>
          </BotSection>
        </div>
      ) : null}

      {showForm ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-panel px-6 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || locked}
            onClick={() => actions.onResetBotDraft(activeId)}
          >
            {t('bot.resetBtn')}
          </Button>
          <Button
            type="button"
            disabled={!dirty || locked}
            onClick={() => {
              void handleSave();
            }}
          >
            {showSaving ? (
              <>
                <ActivityIndicator state="running" placement="inline" entityKind="bot" className="size-3" />
                {t('bot.saving')}
              </>
            ) : (
              t('bot.saveBtn')
            )}
          </Button>
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

      {/*
        离场确认：壳层在切导航 / 关弹窗 / Esc 前调用已注册的脏检查，命中后把待执行目标
        写进 exitPrompt，由这里渲染。三条出路互斥且都有明确后果：
        取消（留在当前）、保留草稿并离开、放弃修改并离开。
      */}
      {view.exitPrompt ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) actions.onCancelBotExit();
          }}
        >
          <DialogContent portal={false} className="flex w-full max-w-md flex-col gap-0 overflow-hidden rounded-window p-0">
            <div className="border-b border-border-subtle px-4 py-3">
              <DialogTitle className="text-section font-medium text-foreground">{t('bot.discardConfirmTitle')}</DialogTitle>
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
