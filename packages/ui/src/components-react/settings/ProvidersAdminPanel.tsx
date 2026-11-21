import * as React from 'react';
import {
  beginAttachFlow,
  isAttachFlowBusy,
  normalizeEndpointId,
  planBindingToggle,
  reconcileAttachFlow,
  reduceAttachFlow,
  routeAttachFailure,
  shouldClearAttachFlow,
  shouldShowAttachStrip,
  type CustomEndpointRow,
  type ProviderAttachFlow,
  type ProviderView,
} from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { presentModel } from '../../lib/modelPresentation.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import { Surface } from '../primitives/Surface.js';
import { AddProviderDialog } from './AddProviderDialog.js';
import { BotAvatarGrid, BotAvatarToggle, type BotAvatarState } from './BotAvatarToggle.js';
import { InlineStrip } from './InlineStrip.js';
import { LoadBoundary } from './LoadBoundary.js';
import { ModelPickerDialog } from './ModelPicker.js';
import {
  pickProviderViewsState,
  planAttachSettlement,
  shouldNotifyAttachDone,
} from './providerAttachOrchestration.js';
import { resolveEditProfiles } from './providerDialogLogic.js';
import { SettingsSectionHeading } from './SettingsSectionHeading.js';
import { SwitchDefaultProviderDialog } from './SwitchDefaultProviderDialog.js';
import type {
  SettingsActions,
  SettingsBotRow,
  SettingsSnapshot,
  ToggleProviderAgentResult,
} from './settingsModel.js';

/* -------------------------------------------------------------------------- */
/* 行级状态：可用性圆点 + Agent 开启/关闭区                                     */
/* -------------------------------------------------------------------------- */

/**
 * 可用性圆点。
 * 【规则】只有四种，颜色与语义一一对应，不引入第五种。
 * 【无障碍】颜色不能是唯一载体：圆点必须带可读的 aria-label 与 title，
 *   否则色弱用户与触屏用户拿不到"可用 / 未配置 / 读取失败"的差别。
 */
function AvailabilityDot({ availability }: { availability: ProviderView['availability'] }): React.ReactElement {
  const tone =
    availability === 'active'
      ? 'bg-success'
      : availability === 'ready'
        ? 'bg-success/70'
        : availability === 'error'
          ? 'bg-destructive'
          : 'bg-faint';
  const label =
    availability === 'active'
      ? t('settings.providerAvailabilityActive')
      : availability === 'ready'
        ? t('settings.providerAvailabilityReady')
        : availability === 'error'
          ? t('settings.providerAvailabilityError')
          : t('settings.providerAvailabilityNotConfigured');
  return (
    <span
      className={`mt-1 size-2 shrink-0 rounded-full ${tone}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

/**
 * BOT 头像点选分发纯函数。
 *
 * 【设计意图 (Why)】
 *   点击 `active`（当前默认）BOT 不能直接发关闭请求，必须路由到就地切换默认窗口（`onRequestSwitchDefault`）；
 *   点击未开启自定义端点须先经 `planBindingToggle` 走直通复用或补密钥流。抽成纯函数便于单测直接锁定。
 */
export function dispatchAgentBindingToggle(
  view: ProviderView,
  agent: ProviderView['agents'][number],
  nextChecked: boolean,
  handlers: {
    onRequestSwitchDefault?: (agent: ProviderView['agents'][number]) => void;
    onDirectAttach: (profile: string) => void;
    onRunToggle: (profile: string, checked: boolean) => void;
  },
): void {
  if (!nextChecked) {
    if (agent.state === 'active' && handlers.onRequestSwitchDefault) {
      handlers.onRequestSwitchDefault(agent);
      return;
    }
    handlers.onRunToggle(agent.profile, false);
    return;
  }
  const plan = planBindingToggle(view, agent.profile, true);
  if (plan.kind === 'attach') {
    handlers.onDirectAttach(agent.profile);
    return;
  }
  handlers.onRunToggle(agent.profile, true);
}

/**
 * Agent 开启/关闭网格：56px 大头像 + 名称，固定 112px 轨道，列数由容器可用宽度自动决定。
 *
 * 【设计意图 (Why)】
 *   provider 的一行就是「一个提供商 + 它在哪些 BOT 上开启」。
 *   头像格子只表达一件事：该 BOT 是否已开启这个提供商（关闭 / 开启，绝不掺杂「设为默认」语义）。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 过去把「绿环 = 默认模型」和「勾选 = 已启用」揉进同一个头像格子，还弹「仅启用 / 启用并设为默认」选择条，
 *      用户只想给某个 BOT 开启提供商时平白多出一次弹窗决策，还会不小心覆盖默认模型；
 *   2. 正在被某个 BOT 当默认模型使用的提供商，如果悄悄让 HTML `disabled` 锁死按钮，用户点上去毫无反应，
 *      不知道为什么关不掉；保持可点并弹出就地切换默认窗口（SwitchDefaultProviderDialog）才符合可发现性；
 *   3. 网格曾经放在标题与动作按钮之间导致不同行排出不同列数，网格必须独占整行。
 *
 * 【约束与规则 (Rules)】
 *   1. 头像状态仅表达普通与读取失败（虚线红边 + 右上红点），当前默认由名字下方克制「默认」微标表达，绝不绘制默认绿环且不遮挡头像；
 *   2. 点击未开启的自定义端点直接走 `onDirectAttach`，仅当网关返回 `needsKey` 时才行内展开补密钥条；
 *   3. 点击 `active` 头像优先通过 `onRequestSwitchDefault` 弹出就地切换默认窗口（未传该回调时才降级交由动作层给出 `blocked-active` 提示）；
 *   4. `error` 格子与订阅行维持只读；
 *   5. 补密钥条从无到有展开时自动聚焦，提交中 `busy` 永不禁用本地「收起/取消」出口。
 */
export function AgentBindingGrid({
  view,
  bots,
  busy,
  attachFlow,
  onToggle,
  onRequestSwitchDefault,
  onDirectAttach,
  onRetryAttachKey,
  onEditAttachKey,
  onCancelAttach,
}: {
  view: ProviderView;
  bots: readonly SettingsBotRow[];
  busy: boolean;
  attachFlow: ProviderAttachFlow | null;
  onToggle: (profile: string, nextChecked: boolean, apiKey?: string) => Promise<ToggleProviderAgentResult>;
  onRequestSwitchDefault?: (agent: ProviderView['agents'][number]) => void;
  onDirectAttach: (profile: string) => void;
  onRetryAttachKey: () => void;
  onEditAttachKey: (draftKey: string) => void;
  onCancelAttach: () => void;
}): React.ReactElement {
  const [pendingProfile, setPendingProfile] = React.useState('');
  const [error, setError] = React.useState('');

  const run = async (profile: string, nextChecked: boolean, apiKey?: string): Promise<void> => {
    setPendingProfile(profile);
    setError('');
    const result = await onToggle(profile, nextChecked, apiKey);
    setPendingProfile('');
    if (!result.ok) {
      setError(result.message || '');
    }
  };

  const change = (agent: ProviderView['agents'][number], nextChecked: boolean): void => {
    setError('');
    dispatchAgentBindingToggle(view, agent, nextChecked, {
      onRequestSwitchDefault,
      onDirectAttach,
      onRunToggle: (profile, checked) => {
        void run(profile, checked);
      },
    });
  };

  const attachBusy = attachFlow ? isAttachFlowBusy(attachFlow) : false;
  const showStrip = shouldShowAttachStrip(attachFlow);
  const targetBotName = attachFlow
    ? bots.find((bot) => bot.profile === attachFlow.profile)?.displayName
      || view.agents.find((agent) => agent.profile === attachFlow.profile)?.displayName
      || attachFlow.profile
    : '';
  const stripId = `attach-strip-${view.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const stripTitleId = `${stripId}-title`;

  /**
   * 【规则】补密钥条是头像点击缺密钥的直接结果，首次展开时接管焦点并宣告原因；
   *   提交中或失败重绘不得抢走用户输入焦点。
   */
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const hadStrip = React.useRef(false);
  React.useEffect(() => {
    if (showStrip && !hadStrip.current) {
      stripRef.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus();
    }
    hadStrip.current = showStrip;
  }, [showStrip]);

  const keyForm = showStrip && attachFlow
    ? {
        draftKey: attachFlow.draftKey ?? '',
        error: attachFlow.phase === 'needs-key' ? attachFlow.error : undefined,
      }
    : null;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
      <BotAvatarGrid>
        {view.agents.map((agent) => {
          const bot = bots.find((item) => item.profile === agent.profile);
          const checked = agent.state === 'active' || agent.state === 'ready';
          // 订阅是账号级来源：登录一次默认对所有 BOT 生效，没有按 BOT 可写的绑定，因此只读。
          const subscription = view.kind === 'subscription';
          const isAttachTargetBusy = attachBusy && attachFlow?.profile === agent.profile;
          const isAttachTarget = showStrip && attachFlow?.profile === agent.profile;
          const disabled =
            busy
            || agent.state === 'error'
            || subscription
            || pendingProfile === agent.profile
            || isAttachTargetBusy;
          const statusText =
            agent.state === 'active'
              ? t('settings.providerBindingDefault')
              : agent.state === 'error'
                ? agent.detail || t('settings.providerToggleBlockedError', { profile: agent.displayName })
                : subscription
                  ? t('settings.providerBindingSubscriptionAll')
                  : isAttachTarget
                    ? t('settings.providerToggleNeedsKey', { profile: agent.displayName })
                    : '';
          // 订阅账号不可按 BOT 开关：不画可点勾选角标以免误导可点，仅在作为当前默认时显示「默认」微标。
          const badge = agent.state === 'active' ? 'default' : !subscription && checked ? 'checked' : 'none';
          const dimmed = busy || pendingProfile === agent.profile || isAttachTargetBusy;
          const avatarState: BotAvatarState = agent.state === 'error'
            ? {
                kind: 'failed',
                reason: agent.detail || t('settings.providerToggleBlockedError', { profile: agent.displayName }),
              }
            : { kind: 'plain' };
          return (
            <div
              key={agent.profile}
              data-agent-state={agent.state}
              className={isAttachTarget && !attachBusy ? 'rounded-card ring-1 ring-border-strong' : undefined}
            >
              <BotAvatarToggle
                profile={agent.profile}
                displayName={agent.displayName}
                avatar={bot?.avatar}
                checked={checked}
                badge={badge}
                disabled={disabled}
                state={avatarState}
                dimmed={dimmed}
                statusText={statusText ? `${view.name} · ${statusText}` : view.name}
                expandable={isAttachTarget && attachFlow ? { controls: stripId } : undefined}
                onToggle={() => change(agent, !checked)}
              />
            </div>
          );
        })}
      </BotAvatarGrid>

      {view.agents
        .filter((agent) => agent.state === 'error')
        .map((agent) => (
          <p key={agent.profile} className="text-caption text-destructive" role="alert">
            {agent.displayName} · {agent.detail || t('settings.providerToggleBlockedError', { profile: agent.displayName })}
          </p>
        ))}

      {showStrip && attachFlow && keyForm ? (
        <div ref={stripRef} data-attach-phase={attachFlow.phase} data-attach-profile={attachFlow.profile}>
          <InlineStrip
            id={stripId}
            titleId={stripTitleId}
            busy={attachBusy}
            title={t('settings.providerAttachNeedsKey', { provider: view.name, bot: targetBotName })}
            hint={
              attachFlow.phase === 'submitting'
                ? t('settings.providerAttachSubmitting')
                : t('settings.providerAttachNeedsKeyHint')
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="password"
                autoComplete="off"
                aria-label={t('settings.customEndpointKey')}
                value={keyForm.draftKey}
                disabled={attachBusy}
                onChange={(event) => onEditAttachKey(event.target.value)}
                size="xs"
                className="w-56 font-code"
              />
              <Button
                size="xs"
                type="button"
                disabled={!keyForm.draftKey.trim() || busy || attachBusy}
                onClick={onRetryAttachKey}
              >
                {t('settings.providerAttachSaveAndEnable')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                type="button"
                onClick={onCancelAttach}
              >
                {/* 提交中只作废本地令牌，网关写入照常完成，因此文案是「收起」而非「取消」。 */}
                {attachBusy ? t('settings.providerAttachDismiss') : t('settings.cancel')}
              </Button>
            </div>
            {keyForm.error ? (
              <p className="text-caption text-destructive" role="alert">
                {keyForm.error}
              </p>
            ) : null}
          </InlineStrip>
        </div>
      ) : null}

      {error ? (
        <p className="text-caption text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 提供商行（订阅与自定义共用同一形态）。
 *
 * 【设计意图】两类来源的差异只有三处：类型标签、副标题的内容、右侧动作。
 *   行骨架、圆点、Agent 勾选区完全一致，因此必须是同一个组件。
 */
function ProviderRow({
  view,
  busy,
  pending,
  error,
  bots,
  attachFlow,
  onToggleAgent,
  onRequestSwitchDefault,
  onDirectAttach,
  onRetryAttachKey,
  onEditAttachKey,
  onCancelAttach,
  onEdit,
  onDelete,
  onLogout,
}: {
  view: ProviderView;
  busy: boolean;
  pending: boolean;
  error: string;
  bots: readonly SettingsBotRow[];
  attachFlow: ProviderAttachFlow | null;
  onToggleAgent: (profile: string, nextChecked: boolean, apiKey?: string) => Promise<ToggleProviderAgentResult>;
  onRequestSwitchDefault: (agent: ProviderView['agents'][number]) => void;
  onDirectAttach: (profile: string) => void;
  onRetryAttachKey: () => void;
  onEditAttachKey: (draftKey: string) => void;
  onCancelAttach: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLogout: () => void;
}): React.ReactElement {
  const isSubscription = view.kind === 'subscription';
  const detail = describeDetail(view);
  const [modelsOpen, setModelsOpen] = React.useState(false);
  const hasActive = view.agents.some((agent) => agent.state === 'active');
  const modelLabel =
    view.models.length > 0
      ? t('settings.providerModels', { count: view.models.length })
      : isSubscription
        ? ''
        : t('settings.providerNoModels');
  const enabledCount = view.agents.filter((agent) => agent.state === 'active' || agent.state === 'ready').length;
  const scopeLabel = isSubscription
    ? t('settings.providerBindingScopeAll')
    : view.agents.length > 0
      ? t('settings.providerBindingScopeCount', { enabled: enabledCount, total: view.agents.length })
      : '';

  return (
    <Surface level="raised" padding="normal" elevated className="flex flex-col" data-provider-key={view.key}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <AvailabilityDot availability={view.availability} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 truncate text-body text-foreground">{view.name}</span>
              <span className="shrink-0 rounded-inner border border-border px-1 text-micro text-muted-foreground">
                {isSubscription ? t('settings.providerKindSubscription') : t('settings.providerKindCustom')}
              </span>
              {modelLabel ? (
                <span className="shrink-0 whitespace-nowrap text-caption text-muted-foreground">{modelLabel}</span>
              ) : null}
              {modelLabel && scopeLabel ? (
                <span aria-hidden="true" className="text-caption text-muted-foreground">·</span>
              ) : null}
              {scopeLabel ? (
                <span
                  className="shrink-0 whitespace-nowrap text-caption text-muted-foreground"
                  title={isSubscription ? t('settings.providerBindingHintAll') : t('settings.providerBindingHint')}
                >
                  {scopeLabel}
                </span>
              ) : null}
            </div>
            {detail ? (
              <div className="mt-1 min-w-0 truncate text-caption text-muted-foreground">{detail}</div>
            ) : null}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-haspopup="dialog"
            disabled={busy || pending || view.models.length === 0}
            title={view.models.length === 0 ? t('settings.providerNoModels') : undefined}
            onClick={() => setModelsOpen(true)}
          >
            {t('settings.providerModelsExpand')}
          </Button>
          {isSubscription ? (
            <Button variant="ghost" size="sm" type="button" className="text-destructive hover:text-destructive" disabled={busy || pending} onClick={onLogout}>
              {t('settings.providerLogout')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" type="button" disabled={busy || pending} onClick={onEdit}>
                {t('settings.providerEdit')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className="text-destructive hover:text-destructive"
                disabled={busy || pending || hasActive}
                title={hasActive ? t('settings.providerDeleteBlockedShort') : undefined}
                onClick={onDelete}
              >
                {t('settings.providerDelete')}
              </Button>
            </>
          )}
        </div>
      </div>

      <AgentBindingGrid
        view={view}
        bots={bots}
        busy={busy || pending}
        attachFlow={attachFlow}
        onToggle={onToggleAgent}
        onRequestSwitchDefault={onRequestSwitchDefault}
        onDirectAttach={onDirectAttach}
        onRetryAttachKey={onRetryAttachKey}
        onEditAttachKey={onEditAttachKey}
        onCancelAttach={onCancelAttach}
      />

      {view.manualHint ? (
        <p className="mt-1 text-caption text-muted-foreground">{view.manualHint}</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-caption text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <ModelPickerDialog
        open={modelsOpen}
        onClose={() => setModelsOpen(false)}
        title={view.name}
        subtitle={t('settings.providerModelsReadonlyHint', { count: view.models.length })}
        providerName={view.name}
        models={view.models}
      />
    </Surface>
  );
}

/**
 * 副标题的取值。
 * 【设计意图】订阅的 `detail` 里塞的是内部标记（deviceCode / externalCli），
 *   地址类与配置文件路径也不再进入列表；自定义端点的 `detail` 恒为 `base_url`，整段隐藏。
 */
export function describeDetail(view: ProviderView): string {
  if (view.kind === 'custom') return '';
  if (view.detail === 'deviceCode') return '';
  if (view.detail === 'externalCli') return '';
  return view.detail
    .split(' · ')
    .map((part) => part.trim())
    .filter((part) => part && !isEndpointLocation(part))
    .join(' · ');
}

/** 像 URL 或文件路径的片段：列表行不承担"配置在哪"的展示职责。 */
function isEndpointLocation(text: string): boolean {
  return /^(https?|wss?|ftp|file):/i.test(text)
    || text.startsWith('/')
    || text.startsWith('~/')
    || text.startsWith('.\\')
    || text.startsWith('./')
    || text.startsWith('..\\')
    || text.startsWith('../')
    || text.startsWith('\\\\')
    || /^[A-Za-z]:[\\/]/.test(text);
}

type RowActionOutcome = { ok: boolean; message?: string };

interface RowActionState {
  id: string;
  pending: boolean;
  error: string;
}

function useRowAction(): [RowActionState, (id: string, task: () => Promise<RowActionOutcome>) => void] {
  const [state, setState] = React.useState<RowActionState>({ id: '', pending: false, error: '' });
  const run = (id: string, task: () => Promise<RowActionOutcome>): void => {
    setState({ id, pending: true, error: '' });
    void task().then((result) => {
      setState({ id, pending: false, error: result.ok ? '' : result.message || '' });
    });
  };
  return [state, run];
}

export function ProvidersAdminPanel({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<{ row: CustomEndpointRow; profiles: string[] } | null>(null);
  const [switchTarget, setSwitchTarget] = React.useState<{
    view: ProviderView;
    profile: string;
    displayName: string;
    currentModel?: string;
  } | null>(null);
  const [attachFlow, setAttachFlow] = React.useState<ProviderAttachFlow | null>(null);
  const attachToken = React.useRef(0);
  const attachLiveToken = React.useRef(0);
  const attachFlowRef = React.useRef<ProviderAttachFlow | null>(null);
  attachFlowRef.current = attachFlow;
  const [attachRowErrors, setAttachRowErrors] = React.useState<Record<string, string>>({});
  const [deleteState, runDelete] = useRowAction();
  const [logoutState, runLogout] = useRowAction();

  // 宿主漏字段时不能让整棵设置树崩掉：设置页是全屏对话框，崩了等于什么都点不了。
  const bots = snapshot.bots ?? [];
  const failures = snapshot.providerFailures ?? [];

  const lastViewsRef = React.useRef<readonly ProviderView[] | undefined>(undefined);
  const picked = pickProviderViewsState(snapshot.providerViews, lastViewsRef.current);
  lastViewsRef.current = picked.lastReady;
  const providerViewsState = picked.state;
  const views = providerViewsState.status === 'ready' ? providerViewsState.data : undefined;
  const viewsRef = React.useRef<readonly ProviderView[] | undefined>(views);
  viewsRef.current = views;
  const activeFlow = reconcileAttachFlow(attachFlow, views);

  const clearRowError = React.useCallback((providerKey: string): void => {
    setAttachRowErrors((prev) => {
      if (!prev[providerKey]) return prev;
      const next = { ...prev };
      delete next[providerKey];
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (shouldClearAttachFlow(attachFlow, views)) {
      const preserved = attachFlow?.phase === 'needs-key' ? attachFlow.error : undefined;
      if (preserved && attachFlow) {
        setAttachRowErrors((prev) => ({ ...prev, [attachFlow.providerKey]: preserved }));
      }
      attachFlowRef.current = null;
      setAttachFlow(null);
    }
  }, [attachFlow, views]);

  const dispatchAttachToggle = (
    target: { providerKey: string; providerId: string; profile: string; providerName: string; botName: string },
    token: number,
    apiKey?: string,
  ): void => {
    const settle = (result: { ok: boolean; needsKey?: boolean; message?: string }, failureMessage: string): void => {
      const current = attachFlowRef.current;
      const surface = routeAttachFailure(current, {
        providerKey: target.providerKey,
        profile: target.profile,
        token,
      });
      const plan = planAttachSettlement(result, surface, failureMessage);
      if (plan.kind === 'settle-strip') {
        const nextFlow = current
          ? reduceAttachFlow(current, { type: 'settle', token, outcome: plan.outcome })
          : null;
        if (
          plan.outcome.ok === false
          && nextFlow
          && shouldClearAttachFlow(nextFlow, viewsRef.current)
        ) {
          // 例如网关在 reload 后意外将目标变为 active（default-changed），补密钥条会立刻收起，必须转成行级可见错误。
          attachFlowRef.current = null;
          setAttachFlow(null);
          setAttachRowErrors((prev) => ({ ...prev, [target.providerKey]: failureMessage }));
          return;
        }
        attachFlowRef.current = nextFlow;
        setAttachFlow(nextFlow);
        return;
      }
      if (surface.kind === 'direct') {
        const nextFlow = current
          ? reduceAttachFlow(current, { type: 'settle', token, outcome: { ok: false } })
          : null;
        attachFlowRef.current = nextFlow;
        setAttachFlow(nextFlow);
      }
      setAttachRowErrors((prev) => ({ ...prev, [plan.providerKey]: plan.message }));
    };

    void actions
      .onToggleProviderAgent(target.providerId, target.profile, true, apiKey)
      .then((result) => {
        settle(result, result.message || t('settings.providerToggleFailed'));
        if (shouldNotifyAttachDone(result, attachLiveToken.current, token)) {
          actions.onNotify(
            t('settings.providerAttachEnableDone', { provider: target.providerName, bot: target.botName }),
          );
        }
      })
      .catch((error: unknown) => {
        settle(
          { ok: false },
          error instanceof Error ? error.message : t('settings.providerToggleFailed'),
        );
      });
  };

  const startDirectAttach = (view: ProviderView, profile: string): void => {
    const token = ++attachToken.current;
    attachLiveToken.current = token;
    clearRowError(view.key);
    const nextFlow = beginAttachFlow({ providerKey: view.key, providerId: view.id, profile }, token);
    attachFlowRef.current = nextFlow;
    setAttachFlow(nextFlow);
    const botName = bots.find((bot) => bot.profile === profile)?.displayName || profile;
    dispatchAttachToggle(
      { providerKey: view.key, providerId: view.id, profile, providerName: view.name, botName },
      token,
    );
  };

  const retryAttachWithKey = (): void => {
    const current = attachFlowRef.current;
    if (!current || isAttachFlowBusy(current) || current.phase !== 'needs-key') return;
    const targetView = viewsRef.current?.find((item) => item.key === current.providerKey);
    const providerName = targetView?.name || current.providerId;
    const botName = bots.find((bot) => bot.profile === current.profile)?.displayName || current.profile;
    const token = ++attachToken.current;
    attachLiveToken.current = token;
    clearRowError(current.providerKey);
    const nextFlow = reduceAttachFlow(current, { type: 'submit', token });
    attachFlowRef.current = nextFlow;
    setAttachFlow(nextFlow);
    dispatchAttachToggle(
      {
        providerKey: current.providerKey,
        providerId: current.providerId,
        profile: current.profile,
        providerName,
        botName,
      },
      token,
      current.draftKey,
    );
  };

  /** 取消 / 收起：作废在途令牌，迟滞响应不得再弹提示。 */
  const cancelAttach = (): void => {
    attachLiveToken.current = 0;
    const current = attachFlowRef.current;
    const nextFlow = current ? reduceAttachFlow(current, { type: 'cancel' }) : null;
    attachFlowRef.current = nextFlow;
    setAttachFlow(nextFlow);
  };

  const defaultProfile = snapshot.scopedProfile || snapshot.gateway.profileName || bots[0]?.profile || 'default';

  const openAdd = (): void => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (view: ProviderView): void => {
    const row = snapshot.customEndpoints.status === 'ready'
      ? snapshot.customEndpoints.data.find(
          (item) => normalizeEndpointId(item.id) === normalizeEndpointId(view.id),
        )
      : undefined;
    if (!row) {
      actions.onNotify(t('settings.providerEditUnavailable'));
      return;
    }
    const enabledProfiles = resolveEditProfiles(view, snapshot.endpointProfiles);
    setEditing({ row, profiles: enabledProfiles });
    setDialogOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <SettingsSectionHeading
          title={t('settings.providersTitle')}
          action={
            <Button size="sm" type="button" onClick={openAdd}>
              {t('settings.providerAdd')}
            </Button>
          }
        />

        {failures.length > 0 ? (
          <div className="mb-2 flex flex-col gap-1 rounded-panel border border-border-subtle bg-panel px-3 py-2">
            {failures.map((failure) => (
              <p key={failure.profile} className="text-caption text-destructive" role="alert">
                {failure.displayName} · {failure.message}
              </p>
            ))}
          </div>
        ) : null}

        <LoadBoundary
          state={providerViewsState}
          onRetry={actions.onReloadProviders}
          emptyLabel={t('settings.providersEmpty')}
        >
          {(rows) => (
            <div className="flex flex-col gap-2">
              {rows.map((view) => {
                const rowAttachFlow = activeFlow?.providerKey === view.key ? activeFlow : null;
                const pending =
                  (deleteState.pending && deleteState.id === view.id) ||
                  (logoutState.pending && logoutState.id === view.id) ||
                  (rowAttachFlow ? isAttachFlowBusy(rowAttachFlow) : false);
                const error =
                  deleteState.id === view.id
                    ? deleteState.error
                    : logoutState.id === view.id
                      ? logoutState.error
                      : attachRowErrors[view.key] || '';
                return (
                  <ProviderRow
                    key={view.key}
                    view={view}
                    busy={snapshot.providerAdminBusy}
                    pending={pending}
                    error={error}
                    bots={bots}
                    attachFlow={rowAttachFlow}
                    onToggleAgent={(profile, nextChecked, apiKey) => {
                      clearRowError(view.key);
                      return actions.onToggleProviderAgent(view.id, profile, nextChecked, apiKey);
                    }}
                    onRequestSwitchDefault={(agent) => {
                      const botDisplayName =
                        bots.find((bot) => bot.profile === agent.profile)?.displayName
                        || agent.displayName
                        || agent.profile;
                      clearRowError(view.key);
                      setSwitchTarget({
                        view,
                        profile: agent.profile,
                        displayName: botDisplayName,
                        currentModel: agent.detail,
                      });
                    }}
                    onDirectAttach={(profile) => startDirectAttach(view, profile)}
                    onRetryAttachKey={retryAttachWithKey}
                    onEditAttachKey={(draftKey) => {
                      const current = attachFlowRef.current;
                      const nextFlow = current ? reduceAttachFlow(current, { type: 'edit-key', draftKey }) : null;
                      attachFlowRef.current = nextFlow;
                      setAttachFlow(nextFlow);
                    }}
                    onCancelAttach={cancelAttach}
                    onEdit={() => openEdit(view)}
                    onDelete={() => runDelete(view.id, () => actions.onDeleteEndpoint(view.id))}
                    onLogout={() => runLogout(view.id, () => actions.onLogoutProvider(view.id))}
                  />
                );
              })}
            </div>
          )}
        </LoadBoundary>
      </section>

      <AddProviderDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        bots={bots}
        defaultProfile={defaultProfile}
        snapshot={snapshot}
        actions={actions}
        editing={editing?.row ?? null}
        editingProfiles={editing?.profiles}
      />

      <SwitchDefaultProviderDialog
        open={Boolean(switchTarget)}
        onClose={() => setSwitchTarget(null)}
        botProfile={switchTarget?.profile ?? ''}
        botDisplayName={switchTarget?.displayName ?? ''}
        currentModel={switchTarget?.currentModel}
        providerView={switchTarget?.view ?? null}
        allViews={views ?? []}
        busy={snapshot.providerAdminBusy}
        onConfirm={async ({ newProviderId, newModel, confirmExpensive }) => {
          if (!switchTarget) return { ok: false };
          const outcome = await actions.onSwitchDefaultAndDisableProvider({
            profile: switchTarget.profile,
            disableProviderId: switchTarget.view.id,
            newProviderId,
            newModel,
            confirmExpensive,
          });
          if (outcome.ok) {
            const targetProviderName = (views ?? []).find(
              (item) => normalizeEndpointId(item.id) === normalizeEndpointId(newProviderId),
            )?.name ?? newProviderId;
            actions.onNotify(
              t('settings.providerSwitchDone', {
                bot: switchTarget.displayName,
                model: presentModel(newModel, targetProviderName).name,
                provider: switchTarget.view.name,
              }),
            );
          }
          return outcome;
        }}
      />
    </div>
  );
}
