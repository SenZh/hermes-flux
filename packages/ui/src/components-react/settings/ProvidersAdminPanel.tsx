import * as React from 'react';
import { Bot as BotIcon, Check } from 'lucide-react';
import {
  deriveEndpointId,
  draftFromEndpoint,
  emptyEndpointDraft,
  truncateProfileLabel,
  normalizeEndpointId,
  type CustomEndpointDraft,
  type CustomEndpointRow,
  type EndpointProbe,
  type OauthProviderRow,
  type ProviderView,
} from '@hermes-flux/core';
import { t } from '../../i18n/index.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import { FanOutMemberList } from './FanOutMemberList.js';
import { LoadBoundary } from './LoadBoundary.js';
import { ModelPickerDialog, ModelPickerField } from './ModelPicker.js';
import { SegmentedControl } from './SegmentedControl.js';
import { SettingField } from './SettingRow.js';
import { SettingsSectionHeading } from './SettingsSectionHeading.js';
import type { SettingsActions, SettingsBotRow, SettingsSnapshot } from './settingsModel.js';

const EMPTY_FORM: CustomEndpointDraft = emptyEndpointDraft();

/* -------------------------------------------------------------------------- */
/* 行级状态：可用性圆点 + Agent 勾选区                                          */
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
 * Agent 成员网格：44px 头像 + 名称，固定 64px 轨道，列数由容器可用宽度自动决定。
 *
 * 【设计意图 (Why)】
 *   provider 的一行就是“一个 id + 一组 Agent 成员”。成员选择必须像一张名单：
 *   头像和名称先被认出来，选中与当前模型都长在头像上。
 *   不再给每个成员套一层正方形卡片：卡片边框会吃掉宽度，头像只能做到 24px，
 *   用户还得先辨认"这是勾选框还是卡片"。现在头像直接放大到 44px，勾选压在其右下角，
 *   当前模型用 success 环表达，视觉信息密度更高。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 上一版用首字母头像 + “N/5 生效”，分母是什么从没交代过。
 *   2. 正方形卡片边框 + 24px 头像，用户反馈"头像太小、外面那圈方框多余"。
 *   3. 网格曾经放在标题与动作按钮之间，动作按钮占用宽度不同，同一份名单会在
 *      自定义端点行排出 4 列、订阅行排出 5 列；网格现在必须横跨整行，列数才稳定。
 *   4. 正在使用的 Agent 被取消勾选，会让它的主模型指向不存在的 provider。
 *
 * 【约束与规则 (Rules)】
 *   1. `active` 的格子锁定：取消必须先切模型（用户已确认的策略）；
 *   2. `error` 的格子锁定并显示原始原因，绝不渲染成“未配置”；
 *   3. 自定义端点勾选未配置的 Agent 时，先尝试复用其它成员的密钥，失败才就地补密钥；
 *      勾选同时把它设为该 Agent 的默认模型（绿环），否则用户点完看不出任何变化；
 *   4. 订阅没有可写的绑定记录，格子只读；
 *   5. 名称最多 10 个显示单位（完整 5 汉字 / 10 半角）；截断态为 9 单位内容 + `…`（汉字通常落 4 字），完整名称留在 title 与 aria-label；
 *   6. 名称字号消费 `--ui-text-caption`（11px × 用户字号档位），不写死 px；
 *   7. 无头像一律 `BotIcon` 兜底，严禁退回首字母；
 *   8. 成员增多时只换行，不横向滚动、不压缩头像。
 */
function AgentBindingGrid({
  view,
  bots,
  busy,
  onToggle,
}: {
  view: ProviderView;
  bots: readonly SettingsBotRow[];
  busy: boolean;
  onToggle: (profile: string, nextChecked: boolean, apiKey?: string) => Promise<{ ok: boolean; message?: string; needsKey?: boolean }>;
}): React.ReactElement {
  const [keyFor, setKeyFor] = React.useState('');
  const [keyValue, setKeyValue] = React.useState('');
  const [pendingProfile, setPendingProfile] = React.useState('');
  const [error, setError] = React.useState('');

  const run = async (profile: string, nextChecked: boolean, apiKey?: string): Promise<void> => {
    setPendingProfile(profile);
    setError('');
    const result = await onToggle(profile, nextChecked, apiKey);
    setPendingProfile('');
    if (!result.ok) {
      setError(result.message || '');
      return;
    }
    setKeyFor('');
    setKeyValue('');
  };

  /**
   * 勾选未配置的自定义端点。
   *
   * 【设计意图 (Why)】壳层会先尝试从其它成员复制密钥；只有确实没有可复用来源时
   *   （`needsKey`）才把输入框打开。过去一勾选就要求重输密钥，用户刚取消再勾回来
   *   也要重打一遍，属明显多余。
   */
  const attach = async (profile: string): Promise<void> => {
    setPendingProfile(profile);
    setError('');
    const result = await onToggle(profile, true);
    setPendingProfile('');
    if (result.ok) {
      setKeyFor('');
      setKeyValue('');
      return;
    }
    if (result.needsKey) {
      setKeyFor(profile);
      setKeyValue('');
      return;
    }
    setError(result.message || '');
  };

  const change = (agent: ProviderView['agents'][number], nextChecked: boolean): void => {
    if (!nextChecked) {
      void run(agent.profile, false);
      return;
    }
    if (view.kind === 'custom') {
      void attach(agent.profile);
      return;
    }
    void run(agent.profile, true);
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <span
        className="text-aux text-muted-foreground"
        title={
          view.kind === 'subscription'
            ? t('settings.providerBindingHintAll')
            : t('settings.providerBindingHint')
        }
      >
        {view.kind === 'subscription'
          ? t('settings.providerBindingTitleAll')
          : t('settings.providerBindingTitleEditable')}
      </span>
      <div className="agent-grid">
        {view.agents.map((agent) => {
          const bot = bots.find((item) => item.profile === agent.profile);
          const checked = agent.state === 'active' || agent.state === 'ready';
          const locked = agent.state === 'active' || agent.state === 'error';
          // 订阅是账号级来源：登录一次默认对所有 Agent 生效，没有按 Agent 可写的绑定，因此只读。
          const subscription = view.kind === 'subscription';
          const disabled = busy || locked || subscription || pendingProfile === agent.profile;
          const statusText =
            agent.state === 'active'
              ? t('settings.providerBindingActive')
              : agent.state === 'error'
                ? agent.detail || t('settings.providerToggleBlockedError', { profile: agent.displayName })
                : subscription
                  ? t('settings.providerBindingSubscriptionAll')
                  : '';
          const dimmed = busy || pendingProfile === agent.profile;
          const label = statusText
            ? `${agent.displayName} · ${view.name} · ${statusText}`
            : `${agent.displayName} · ${view.name}`;
          return (
            <label
              key={agent.profile}
              title={label}
              data-agent-profile={agent.profile}
              data-agent-state={agent.state}
              className={[
                'group flex w-16 flex-col items-center gap-1 rounded-card py-1',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground/70',
                disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                dimmed ? 'opacity-60' : '',
              ].join(' ')}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                disabled={disabled}
                aria-label={label}
                onChange={(event) => change(agent, event.target.checked)}
              />
              {/* 头像本身就是勾选面：不再外包一层正方形卡片，把有限宽度让给头像和名字。
                  当前模型用 success 环表达，勾选用压在头像右下角的对号表达。 */}
              <span className="relative">
                <span
                  className={[
                    'flex size-11 items-center justify-center overflow-hidden rounded-full bg-card-active',
                    agent.state === 'active' ? 'ring-2 ring-success ring-offset-2 ring-offset-popover' : '',
                    agent.state === 'error' ? 'border-2 border-dashed border-destructive/60' : '',
                    checked || agent.state === 'error' ? '' : 'opacity-55',
                  ].join(' ')}
                >
                  {bot?.avatar ? (
                    <img src={bot.avatar} alt="" className="size-11 object-cover" />
                  ) : (
                    <BotIcon aria-hidden="true" className="size-6 text-muted-foreground" />
                  )}
                </span>
                {checked ? (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-popover"
                  >
                    <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />
                  </span>
                ) : null}
                {agent.state === 'error' ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 size-2 rounded-full bg-destructive ring-2 ring-popover"
                  />
                ) : null}
              </span>
              <span
                className={`w-full truncate text-center font-ui leading-tight ${
                  agent.state === 'active' ? 'font-semibold text-foreground' : 'font-medium text-secondary-foreground'
                }`}
                style={{ fontSize: 'var(--ui-text-caption, var(--fs-caption))' }}
              >
                {truncateProfileLabel(agent.displayName)}
              </span>
            </label>
          );
        })}
      </div>

      {view.agents
        .filter((agent) => agent.state === 'error')
        .map((agent) => (
          <p key={agent.profile} className="text-caption text-destructive" role="alert">
            {agent.displayName} · {agent.detail || t('settings.providerToggleBlockedError', { profile: agent.displayName })}
          </p>
        ))}

      {keyFor ? (
        <div className="flex flex-wrap items-center gap-2 rounded-panel border border-border-subtle bg-panel px-2 py-2">
          <span className="text-caption text-muted-foreground">
            {t('settings.providerBindingNeedsKey', {
              profile: view.agents.find((agent) => agent.profile === keyFor)?.displayName || keyFor,
            })}
          </span>
          <Input
            type="password"
            autoComplete="off"
            value={keyValue}
            onChange={(event) => setKeyValue(event.target.value)}
            className="h-7 w-56 font-code text-caption"
          />
          <Button
            size="sm"
            type="button"
            disabled={!keyValue.trim() || busy}
            onClick={() => { void run(keyFor, true, keyValue); }}
          >
            {t('settings.customEndpointSave')}
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={() => { setKeyFor(''); setKeyValue(''); }}>
            {t('settings.cancel')}
          </Button>
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
 *   行骨架、圆点、Agent 勾选区完全一致，因此必须是同一个组件，
 *   否则会像上一版那样漂出两套间距。
 */
function ProviderRow({
  view,
  busy,
  pending,
  error,
  bots,
  scopedProfile,
  currentAgentName,
  onToggleAgent,
  onActivateModel,
  onEdit,
  onDelete,
  onLogout,
}: {
  view: ProviderView;
  busy: boolean;
  pending: boolean;
  error: string;
  bots: readonly SettingsBotRow[];
  /** 当前作用域的 Agent：模型列表的"当前模型"标记必须按它定位，不能取任意一个 active。 */
  scopedProfile: string;
  /** 「设为当前模型」作用到哪一个 Agent——必须写在按钮上，不能靠隐式作用域。 */
  currentAgentName: string;
  onToggleAgent: (profile: string, nextChecked: boolean, apiKey?: string) => Promise<{ ok: boolean; message?: string; needsKey?: boolean }>;
  /**
   * 在弹框里点一个模型后落到网关。
   * 【规则】高价模型第一次调用只返回 `confirmRequired`，弹框不关；
   *   用户点「仍然设置」后带 `confirmExpensive` 重发。
   */
  onActivateModel: (model: string, confirmExpensive: boolean) => Promise<{
    ok: boolean;
    confirmRequired?: boolean;
    message?: string;
  }>;
  onEdit: () => void;
  onDelete: () => void;
  onLogout: () => void;
}): React.ReactElement {
  const isSubscription = view.kind === 'subscription';
  const detail = describeDetail(view);
  const [modelsOpen, setModelsOpen] = React.useState(false);
  const activeAgent = view.agents.find(
    (agent) => agent.profile === scopedProfile && agent.state === 'active',
  );
  const hasActive = view.agents.some((agent) => agent.state === 'active');
  const modelLabel =
    view.models.length > 0
      ? t('settings.providerModels', { count: view.models.length })
      : isSubscription
        ? ''
        : t('settings.providerNoModels');

  return (
    <div
      className="border-b border-border-subtle py-3 last:border-b-0"
      data-provider-key={view.key}
    >
      {/* 标题与动作单独占一条；成员网格必须横跨整行，否则动作按钮越多，网格越窄，
          同一份名单会在两行里排出不同的列数（用户实测 4 列 / 5 列不一致）。 */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <AvailabilityDot availability={view.availability} />
          <div className="min-w-0 flex-1">
            {/* 【规则】名称、类型与模型数量必须在同一排：模型数是选型的一等信息，
                单独占一行会把行的视觉重心拆成两层。端点地址/配置文件路径不再展示。 */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 truncate text-body text-foreground">{view.name}</span>
              <span className="shrink-0 rounded-inner border border-border px-1 text-micro text-muted-foreground">
                {isSubscription ? t('settings.providerKindSubscription') : t('settings.providerKindCustom')}
              </span>
              {modelLabel ? (
                <span className="shrink-0 whitespace-nowrap text-caption text-muted-foreground">{modelLabel}</span>
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
            <Button variant="ghost" size="sm" type="button" disabled={busy || pending} onClick={onLogout}>
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
        onToggle={onToggleAgent}
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
        title={t('settings.providerModelsDialogTitle')}
        subtitle={t('settings.providerSetCurrentModelFor', { bot: currentAgentName })}
        providerName={view.name}
        models={view.models}
        currentModel={activeAgent?.detail}
        busy={busy || pending}
        onPick={onActivateModel}
      />
    </div>
  );
}

/**
 * 副标题的取值。
 * 【设计意图】订阅的 `detail` 里塞的是内部标记（deviceCode / externalCli），
 *   直接展示等于把实现细节丢给用户。地址类与配置文件路径也不再进入列表：
 *   用户要判断的是"这套来源能不能用"，不是它的物理位置（设置项里都查得到）。
 * 【规则】自定义端点的 `detail` 恒为 `base_url`，整段隐藏；订阅只保留套餐等人类可读片段。
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

/* -------------------------------------------------------------------------- */
/* 端点表单（编辑与新增共用）                                                   */
/* -------------------------------------------------------------------------- */

interface FormState {
  draft: CustomEndpointDraft;
  fanOut: string[];
  probe?: EndpointProbe;
  probePending: boolean;
  savePending: boolean;
  error: string;
  warning: string;
  notice: string;
}

type FormAction =
  | { type: 'edit'; row: CustomEndpointRow }
  | { type: 'reset' }
  | { type: 'field'; patch: Partial<CustomEndpointDraft> }
  | { type: 'toggleFanOut'; profile: string }
  | { type: 'probeStart' }
  | { type: 'probeResult'; probe: EndpointProbe }
  | { type: 'saveStart' }
  | { type: 'saveResult'; ok: boolean; message?: string; warning?: string; notice?: string };

const FORM_INITIAL: FormState = {
  draft: EMPTY_FORM,
  fanOut: [],
  probePending: false,
  savePending: false,
  error: '',
  warning: '',
  notice: '',
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'edit':
      return { ...FORM_INITIAL, draft: draftFromEndpoint(action.row) };
    case 'reset':
      return FORM_INITIAL;
    case 'field':
      return { ...state, draft: { ...state.draft, ...action.patch }, error: '', warning: '', notice: '' };
    case 'toggleFanOut': {
      const next = state.fanOut.includes(action.profile)
        ? state.fanOut.filter((item) => item !== action.profile)
        : [...state.fanOut, action.profile];
      return { ...state, fanOut: next };
    }
    case 'probeStart':
      return { ...state, probePending: true, error: '', warning: '', notice: '', probe: undefined };
    case 'probeResult':
      return { ...state, probePending: false, probe: action.probe };
    case 'saveStart':
      return { ...state, savePending: true, error: '', warning: '', notice: '' };
    case 'saveResult':
      return {
        ...state,
        savePending: false,
        error: action.ok ? '' : action.message || '',
        warning: action.ok ? action.warning || '' : '',
        notice: action.ok ? action.notice || '' : '',
      };
    default:
      return state;
  }
}

/**
 * 探测结果。
 *
 * 【设计意图 (Why)】
 *   "端点可达，但未通过校验 · The endpoint rejected the API key." 是三种不同故障被压成一句：
 *   前半句说没事，后半句说密钥错了，还混着英文原文。用户看完不知道要改什么。
 *   这里拆成"结论 + 原始信息"两层：结论必须中文化且可行动，原文只作为次要行保留。
 *
 * 【防范的历史坑】网关的 detail 是英文，直接拼进中文句子会变成两截话。
 * 【待确认】网关 validate 是否给出可区分认证失败的字段；当前按原文关键词归类，属脆弱实现。
 */
function ProbeLine({ probe }: { probe: EndpointProbe }): React.ReactElement {
  if (probe.kind === 'ok') {
    return (
      <p className="text-caption text-success" role="status">
        {t('settings.providerTestOk', { count: probe.modelCount })}
      </p>
    );
  }
  const authFailed =
    probe.kind === 'warning' && /api key|unauthor|\b401\b|reject/i.test(probe.message || '');
  const headline =
    probe.kind === 'unreachable'
      ? t('settings.providerTestUnreachable')
      : authFailed
        ? t('settings.providerTestAuthFailed')
        : t('settings.customEndpointProbeWarning');
  const tone = probe.kind === 'unreachable' || authFailed ? 'text-destructive' : 'text-warning';
  return (
    <div className={tone} role="alert">
      <p className="text-caption">{headline}</p>
      {probe.message ? (
        <p className="mt-1 text-micro opacity-80">
          {t('settings.providerTestDetails')}：{probe.message}
        </p>
      ) : null}
    </div>
  );
}

function EndpointForm({
  state,
  dispatch,
  bots,
  scopedProfile,
  busy,
  actions,
  onSaved,
  showFanOut,
}: {
  state: FormState;
  dispatch: React.Dispatch<FormAction>;
  bots: ReadonlyArray<{ profile: string; displayName: string }>;
  scopedProfile: string;
  busy: boolean;
  actions: SettingsActions;
  /** 全部写入成功后的收尾：提示由壳层弹出，弹窗负责关闭。 */
  onSaved: () => void;
  /**
   * 是否渲染「保存时配置到」。
   * 【规则】只在新建时渲染：成员关系是外层「生效于」网格的职责，
   *   编辑弹窗只改定义，避免两个入口各自保存、状态不同步。
   */
  showFanOut: boolean;
}): React.ReactElement {
  const { draft } = state;
  const derivedId = draft.id || deriveEndpointId(draft.name);
  const otherBots = bots.filter((bot) => bot.profile !== scopedProfile);
  const hasStoredKey = draft.id.length > 0;
  // 新建必须带明文密钥；编辑留空表示保留原密钥。
  const keyMissing = showFanOut && draft.apiKey.kind !== 'set';

  const probe = async (): Promise<void> => {
    dispatch({ type: 'probeStart' });
    const result = await actions.onProbeEndpoint(draft);
    dispatch({ type: 'probeResult', probe: result });
    if (result.kind === 'ok' && result.resolvedBaseUrl && result.resolvedBaseUrl !== draft.baseUrl.trim()) {
      // 网关探测会自动补 /v1，保存时必须用真正 served /models 的那个地址，否则之后每次请求都 404。
      dispatch({ type: 'field', patch: { baseUrl: result.resolvedBaseUrl } });
    }
    if (result.kind === 'ok' && !draft.model && result.models[0]) {
      dispatch({ type: 'field', patch: { model: result.models[0], models: result.models } });
    } else if (result.kind === 'ok') {
      dispatch({ type: 'field', patch: { models: result.models } });
    }
  };

  const save = async (): Promise<void> => {
    dispatch({ type: 'saveStart' });
    const outcome = await actions.onSaveEndpoint(draft, { fanOutTo: state.fanOut, makeDefault: true });
    if (!outcome.ok) {
      dispatch({ type: 'saveResult', ok: false, message: outcome.message });
      return;
    }
    const failed = (outcome.fanOut || []).filter((item) => !item.ok);
    if (failed.length > 0) {
      // 扇出部分失败时保留弹窗，让用户看到具体是哪个 Agent 没写进去。
      dispatch({
        type: 'saveResult',
        ok: true,
        warning: `${t('settings.customEndpointFanOutPartial')} · ${failed.map((item) => item.displayName).join('、')}`,
      });
      return;
    }
    // 全部成功：提示留在列表页，弹窗关掉。不能让用户用「关闭」去关一个已经成功的操作。
    actions.onNotify(t('settings.customEndpointSaved'));
    onSaved();
  };

  const disabled = busy || state.savePending;

  return (
    <div className="flex flex-col gap-4">
      <SettingField label={t('settings.customEndpointName')}>
        <Input
          value={draft.name}
          onChange={(event) => dispatch({ type: 'field', patch: { name: event.target.value } })}
          className="h-8 text-body"
        />
      </SettingField>
      <SettingField label={t('settings.customEndpointUrl')}>
        <Input
          value={draft.baseUrl}
          placeholder="https://llm.internal/v1"
          onChange={(event) => dispatch({ type: 'field', patch: { baseUrl: event.target.value } })}
          className="h-8 font-code text-caption"
        />
      </SettingField>
      <SettingField label={t('settings.customEndpointKey')}>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            autoComplete="off"
            value={draft.apiKey.kind === 'set' ? draft.apiKey.value : ''}
            placeholder={
              keyMissing
                ? t('settings.customEndpointKeyRequired')
                : draft.apiKey.kind === 'clear'
                  ? t('settings.customEndpointKeyClearPending')
                  : hasStoredKey
                    ? t('settings.customEndpointKeyKeep')
                    : ''
            }
            onChange={(event) =>
              dispatch({
                type: 'field',
                patch: { apiKey: event.target.value ? { kind: 'set', value: event.target.value } : { kind: 'keep' } },
              })
            }
            className="h-8 font-code"
          />
          {hasStoredKey && draft.apiKey.kind !== 'clear' ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="shrink-0 whitespace-nowrap"
              onClick={() => dispatch({ type: 'field', patch: { apiKey: { kind: 'clear' } } })}
            >
              {t('settings.customEndpointKeyClear')}
            </Button>
          ) : null}
        </div>
      </SettingField>
      <SettingField label={t('settings.customEndpointId')}>
        <Input
          value={draft.id}
          readOnly={!showFanOut}
          aria-readonly={!showFanOut}
          title={!showFanOut ? t('settings.customEndpointIdLocked') : undefined}
          placeholder={derivedId || 'internal-gateway'}
          onChange={(event) => dispatch({ type: 'field', patch: { id: event.target.value } })}
          className={`h-8 font-code text-caption ${!showFanOut ? 'cursor-not-allowed text-muted-foreground' : ''}`}
        />
        {!showFanOut ? (
          <p className="text-micro text-muted-foreground">{t('settings.customEndpointIdLocked')}</p>
        ) : null}
      </SettingField>
      <SettingField label={t('settings.customEndpointModel')}>
        <ModelPickerField
          value={draft.model}
          models={draft.models ?? []}
          providerName={draft.name || draft.id}
          placeholder="gpt-5.4"
          ariaLabel={t('settings.customEndpointModel')}
          onChange={(model) => dispatch({ type: 'field', patch: { model } })}
        />
      </SettingField>
      {draft.models && draft.models.length > 0 ? (
        <p className="text-micro text-muted-foreground">
          {t('settings.providerModels', { count: draft.models.length })}
        </p>
      ) : null}

      {showFanOut && otherBots.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-aux text-muted-foreground">{t('settings.customEndpointApplyTo')}</span>
          <FanOutMemberList
            bots={otherBots}
            selected={state.fanOut}
            onToggle={(profile) => dispatch({ type: 'toggleFanOut', profile })}
          />
          <p className="text-micro text-muted-foreground">{t('settings.customEndpointApplyToHint')}</p>
        </div>
      ) : null}

      {!showFanOut ? (
        <p className="text-micro text-muted-foreground">{t('settings.customEndpointMembersHint')}</p>
      ) : null}

      {state.probe ? <ProbeLine probe={state.probe} /> : null}
      {state.error ? (
        <p className="text-caption text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.warning ? (
        <p className="text-caption text-warning" role="status">
          {state.warning}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-caption text-success" role="status">
          {state.notice}
        </p>
      ) : null}

      <div className="mt-1 flex items-center gap-2">
        <Button variant="outline" size="sm" type="button" disabled={disabled || !draft.baseUrl.trim()} onClick={() => { void probe(); }}>
          {t('settings.customEndpointTest')}
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={disabled || keyMissing || !draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()}
          onClick={() => { void save(); }}
        >
          {t('settings.customEndpointSave')}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 登录会话（设备码）                                                           */
/* -------------------------------------------------------------------------- */

interface LoginState {
  providerId: string;
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  status: 'pending' | 'approved' | 'failed' | 'cancelled';
  message: string;
  pending: boolean;
}

/**
 * 一次设备码登录的可见状态。
 * 【规则】只有 `approved` 是成功；`pending` 必须持续显示验证码与地址，让用户知道去哪完成。
 */
function LoginPanel({
  state,
  onCancel,
  onCopy,
}: {
  state: LoginState;
  onCancel: () => void;
  onCopy: (text: string) => void;
}): React.ReactElement {
  if (state.status === 'approved') {
    return (
      <p className="text-caption text-success" role="status">
        {t('settings.loginApproved')}
      </p>
    );
  }
  if (state.status === 'failed' || state.status === 'cancelled') {
    return (
      <p className="text-caption text-destructive" role="alert">
        {state.status === 'cancelled' ? t('settings.loginCancelled') : t('settings.loginFailed')}
        {state.message ? ` · ${state.message}` : ''}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-panel border border-border-subtle bg-panel p-3">
      <p className="text-caption text-muted-foreground">{t('settings.loginCode')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-inner bg-input px-2 py-1 font-code text-body text-foreground">{state.userCode}</code>
        <Button variant="ghost" size="sm" type="button" onClick={() => onCopy(state.userCode)}>
          {t('settings.loginCopyCommand')}
        </Button>
      </div>
      {state.verificationUrl ? (
        <a
          className="truncate font-code text-caption text-secondary-foreground underline decoration-border-strong underline-offset-2"
          href={state.verificationUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          {state.verificationUrl}
        </a>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="text-caption text-muted-foreground">{t('settings.loginPending')}</span>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          {t('settings.cancel')}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 添加提供商：按钮 + 弹框                                                      */
/* -------------------------------------------------------------------------- */

type AddTab = 'subscription' | 'custom';

/**
 * 添加提供商的弹框。
 *
 * 【设计意图 (Why)】
 *   添加是一个低频、需要专注的动作，常驻表单会一直占着列表下方，
 *   让人误以为它是列表的一部分。弹框里用两个页签区分订阅与自定义。
 *
 * 【约束与规则 (Rules)】
 *   1. 订阅页签只列"还没登录"的订阅；已登录的已经在主列表里，不重复出现；
 *   2. external flow 给命令行而不是伪造一个登录按钮；
 *   3. 关闭弹框必须取消进行中的登录会话，避免网关留下悬挂会话。
 */
function AddProviderDialog({
  open,
  onClose,
  bots,
  scopedProfile,
  snapshot,
  actions,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  bots: ReadonlyArray<{ profile: string; displayName: string }>;
  scopedProfile: string;
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
  editing: CustomEndpointRow | null;
}): React.ReactElement | null {
  const [tab, setTab] = React.useState<AddTab>('subscription');
  const [login, setLogin] = React.useState<LoginState | null>(null);
  const [form, dispatch] = React.useReducer(formReducer, FORM_INITIAL);

  React.useEffect(() => {
    if (!open) {
      setLogin(null);
      setTab('subscription');
      return;
    }
    if (editing) {
      setTab('custom');
      dispatch({ type: 'edit', row: editing });
    }
  }, [open, editing]);

  // 关闭时取消进行中的会话：不然网关会保留一个 pending 会话直到超时。
  const closeWithCleanup = (): void => {
    if (login && login.status === 'pending' && login.sessionId) {
      void actions.onCancelLogin(login.sessionId);
    }
    setLogin(null);
    dispatch({ type: 'reset' });
    onClose();
  };

  if (!open) return null;

  const startLogin = async (providerId: string): Promise<void> => {
    const result = await actions.onStartLogin(providerId);
    if (!result.ok || !result.sessionId) {
      setLogin({
        providerId,
        sessionId: '',
        userCode: '',
        verificationUrl: '',
        status: 'failed',
        message: result.message || '',
        pending: false,
      });
      return;
    }
    setLogin({
      providerId,
      sessionId: result.sessionId,
      userCode: result.userCode || '',
      verificationUrl: result.verificationUrl || '',
      status: 'pending',
      message: '',
      pending: false,
    });
    const poll = async (): Promise<void> => {
      const next = await actions.onPollLogin(providerId, result.sessionId!);
      setLogin((current) => (current && current.sessionId === result.sessionId
        ? { ...current, status: next.status, message: next.message || '' }
        : current));
      if (next.status === 'pending') {
        // 3 秒一次，与网关的 poll_interval 常见值一致；会话过期由网关自己回 failed。
        window.setTimeout(() => { void poll(); }, 3000);
      } else if (next.status === 'approved') {
        actions.onReloadProviders();
      }
    };
    void poll();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop/40 p-4"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={(event) => {
        // 宿主的设置中心在 window 上监听 Escape；不拦住的话一次 Esc 会把整个设置页关掉，已填表单全丢。
        if (event.key === 'Escape') {
          event.stopPropagation();
          closeWithCleanup();
        }
      }}
      aria-label={editing ? t('settings.editTitle') : t('settings.addTitle')}
    >
      {/* gate-theme-allow: 弹窗高度必须相对视口有界；h-dock 在主题里未定义，沿用宿主 SettingsModal 的 min() 写法 */}
      <div className="flex max-h-[min(680px,calc(100vh-96px))] w-full max-w-2xl flex-col overflow-hidden rounded-window border border-border bg-popover shadow-window">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <h3 className="text-section font-medium text-foreground">
            {editing ? t('settings.editTitle') : t('settings.addTitle')}
          </h3>
          <Button variant="ghost" size="sm" type="button" onClick={closeWithCleanup}>
            {t('settings.close')}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* 编辑态锁定在自定义端点表单：这时没有"选类型"这回事，页签只会让人以为能改类型。 */}
          {editing ? null : (
            <SegmentedControl
              ariaLabel={t('settings.addTitle')}
              value={tab}
              onChange={(next) => {
                setTab(next);
                if (next === 'custom' && !login) dispatch({ type: 'reset' });
              }}
              options={[
                { value: 'subscription', label: t('settings.addTabSubscription') },
                { value: 'custom', label: t('settings.addTabCustom') },
              ]}
            />
          )}

          {tab === 'subscription' ? (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-caption text-muted-foreground">{t('settings.addSubscriptionHint')}</p>
              {login ? (
                <LoginPanel
                  state={login}
                  onCancel={() => {
                    if (login.sessionId) void actions.onCancelLogin(login.sessionId);
                    setLogin(null);
                  }}
                  onCopy={(text) => { void actions.onCopy(text); }}
                />
              ) : null}
              <LoadBoundary
                state={snapshot.subscriptionCatalog}
                onRetry={actions.onReloadProviders}
                emptyLabel={t('settings.addSubscriptionEmpty')}
              >
                {(rows) => {
                  const available = rows.filter((row) => !row.loggedIn);
                  if (available.length === 0) {
                    return <p className="py-4 text-body text-muted-foreground">{t('settings.addSubscriptionEmpty')}</p>;
                  }
                  return (
                    <div className="flex flex-col">
                      {available.map((row) => (
                        <div
                          key={row.id}
                          className="flex items-center justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0"
                          data-subscription-id={row.id}
                        >
                          <div className="min-w-0">
                            <span className="truncate text-body text-foreground">{row.name}</span>
                            {row.flow === 'external' && row.cliCommand ? (
                              <p className="mt-1 truncate font-code text-caption text-muted-foreground">{row.cliCommand}</p>
                            ) : null}
                          </div>
                          {row.flow === 'external' ? (
                            <div className="flex shrink-0 items-center gap-1">
                              <span className="text-caption text-muted-foreground">{t('settings.loginManual')}</span>
                              {row.cliCommand ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  type="button"
                                  onClick={() => { void actions.onCopy(row.cliCommand!); }}
                                >
                                  {t('settings.loginCopyCommand')}
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              disabled={Boolean(login) || snapshot.providerAdminBusy}
                              onClick={() => { void startLogin(row.id); }}
                            >
                              {t('settings.providerLogin')}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                }}
              </LoadBoundary>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-caption text-muted-foreground">{t('settings.addCustomHint')}</p>
              <EndpointForm
                state={form}
                dispatch={dispatch}
                bots={bots}
                scopedProfile={scopedProfile}
                busy={snapshot.providerAdminBusy}
                actions={actions}
                onSaved={closeWithCleanup}
                showFanOut={!editing}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 主面板                                                                       */
/* -------------------------------------------------------------------------- */

interface RowActionState {
  id: string;
  pending: boolean;
  error: string;
}

/**
 * 行级操作反馈。
 * 【防范的历史坑】早期 `void actions.onActivateEndpoint(...)` 直接丢弃返回值，
 *   失败时界面一片安静，用户以为没点上，而保存却有完整回路（双标）。
 */
type RowActionOutcome = { ok: boolean; message?: string };

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

/**
 * 高价模型的确认。
 *
 * 【设计意图 (Why)】
 *   主模型槽位只能放一个模型，所以"设为当前模型"必须点名具体模型。
 *   网关对高价模型会要求二次确认且**不落盘**；这一步现在由 `ModelPickerDialog`
 *   在同一个弹框内完成，不再叠第二层弹窗。
 */

export function ProvidersAdminPanel({
  snapshot,
  actions,
}: {
  snapshot: SettingsSnapshot;
  actions: SettingsActions;
}): React.ReactElement {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CustomEndpointRow | null>(null);
  const [query, setQuery] = React.useState('');
  const [modelPendingId, setModelPendingId] = React.useState('');
  const [deleteState, runDelete] = useRowAction();
  const [logoutState, runLogout] = useRowAction();

  /**
   * 在弹框里点一个模型。
   * 【规则】网关回 `confirmRequired` 时**不落盘**，原样把结果交给弹框，
   *   由用户点「仍然设置」后带 `confirmExpensive` 重发；成功后弹框自行关闭。
   */
  const activateModel = async (
    view: ProviderView,
    model: string,
    confirmExpensive: boolean,
  ): Promise<{ ok: boolean; confirmRequired?: boolean; message?: string }> => {
    setModelPendingId(view.id);
    const result = await actions.onActivateProvider(view.id, model, confirmExpensive);
    setModelPendingId('');
    return result;
  };

  // 宿主漏字段时不能让整棵设置树崩掉：设置页是全屏对话框，崩了等于什么都点不了。
  const bots = snapshot.bots ?? [];
  const failures = snapshot.providerFailures ?? [];
  const scoped = snapshot.scopedProfile || snapshot.gateway.profileName || 'default';
  const scopedDisplayName = bots.find((bot) => bot.profile === scoped)?.displayName || scoped;
  const needle = query.trim().toLowerCase();

  const openAdd = (): void => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (view: ProviderView): void => {
    // 归一化比对：视图里的 id 已去掉 `custom:` 前缀，原始端点行可能还带着它。
    const row = snapshot.customEndpoints.status === 'ready'
      ? snapshot.customEndpoints.data.find(
          (item) => normalizeEndpointId(item.id) === normalizeEndpointId(view.id),
        )
      : undefined;
    if (!row) {
      // 静默无反应正是上一版的缺陷：用户点了"编辑"以为坏了。这里必须给出原因。
      actions.onNotify(t('settings.providerEditUnavailable'));
      return;
    }
    setEditing(row);
    setDialogOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="flex items-center justify-between gap-3">
          <SettingsSectionHeading title={t('settings.providersTitle')} hint={t('settings.providersHint')} />
          <div className="flex shrink-0 items-center gap-2 pb-2">
            <Button size="sm" type="button" onClick={openAdd}>
              {t('settings.providerAdd')}
            </Button>
          </div>
        </div>

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('settings.providersSearch')}
          aria-label={t('settings.providersSearch')}
          className="mb-2 h-8 text-caption"
        />

        <p className="mb-2 text-caption text-secondary-foreground">{t('settings.providerBindingLegend')}</p>

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
          state={snapshot.providerViews}
          onRetry={actions.onReloadProviders}
          emptyLabel={t('settings.providersEmpty')}
        >
          {(views) => {
            const visible = needle
              ? views.filter((view) => `${view.name} ${view.id} ${view.detail}`.toLowerCase().includes(needle))
              : views;
            if (visible.length === 0) {
              return <p className="py-6 text-body text-muted-foreground">{t('settings.providersNoMatch')}</p>;
            }
            return (
              <div className="flex flex-col">
                {visible.map((view) => {
                  const pending =
                    modelPendingId === view.id ||
                    (deleteState.pending && deleteState.id === view.id) ||
                    (logoutState.pending && logoutState.id === view.id);
                  const error =
                    deleteState.id === view.id
                      ? deleteState.error
                      : logoutState.id === view.id
                        ? logoutState.error
                        : '';
                  return (
                    <ProviderRow
                      key={view.key}
                      view={view}
                      busy={snapshot.providerAdminBusy}
                      pending={pending}
                      error={error}
                      bots={bots}
                      scopedProfile={scoped}
                      currentAgentName={scopedDisplayName}
                      onToggleAgent={(profile, nextChecked, apiKey) =>
                        actions.onToggleProviderAgent(view.id, profile, nextChecked, apiKey)}
                      onActivateModel={(model, confirmExpensive) =>
                        activateModel(view, model, confirmExpensive)}
                      onEdit={() => openEdit(view)}
                      onDelete={() => runDelete(view.id, () => actions.onDeleteEndpoint(view.id))}
                      onLogout={() => runLogout(view.id, () => actions.onLogoutProvider(view.id))}
                    />
                  );
                })}
                <p className="pt-2 text-caption text-muted-foreground">{t('settings.providerAddHint')}</p>
              </div>
            );
          }}
        </LoadBoundary>
      </section>

      <AddProviderDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        bots={bots}
        scopedProfile={scoped}
        snapshot={snapshot}
        actions={actions}
        editing={editing}
      />
    </div>
  );
}
