import {
  draftFromEndpoint,
  emptyEndpointDraft,
  normalizeEndpointId,
  type CustomEndpointDraft,
  type CustomEndpointRow,
  type EndpointProbe,
  type ProviderView,
} from '@hermes-flux/core';
import type { LoginState } from './LoginPanel.js';
import type { SettingsActions, SettingsBotRow } from './settingsModel.js';

/**
 * 提供商弹窗（添加 / 编辑 / OAuth 轮询）的状态归约与副作用调度纯模块。
 *
 * 【设计意图 (Why)】
 *   表单状态归约、编辑成员收敛、`makeDefault: false` 写入参数构造与 OAuth 轮询定时器
 *   如果全写在 React 组件闭包里，在无 DOM 的 Node 测试环境下无法独立验证定时器释放、
 *   迟滞 `startLogin` 自动撤回与编辑成员保真规则。抽成纯 TypeScript 模块后，
 *   所有状态迁移与生命周期规则均可直接单测并阻断回归。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. OAuth 设备码登录用匿名 `window.setTimeout` 轮询，取消、外部关闭或组件卸载时不停表，
 *      导致后台每 3 秒继续打网关，旧会话通过时还会误触发 `onReloadProviders()`；
 *   2. 编辑模式下 `editing` 若忽略 `endpointProfiles`，可能漏掉 model.options 读取失败但
 *      实际已配置该端点的 BOT，或在空列表时退回 `scopedProfileName()` 误写到无关 BOT；
 *   3. 新建自定义端点用户手填 ID 时若用 `draft.id.length > 0` 判定“已有保存密钥”，
 *      会把全新未保存端点误判为“已保存密钥”。
 *
 * 【约束与规则 (Rules)】
 *   1. 零 DOM、零 React；所有定时器通过注入的 `setTimeout`/`clearTimeout` 调度；
 *   2. 新增与编辑保存的 `makeDefault` 恒为 `false`，绝不改动任何 BOT 的当前默认模型；
 *   3. `dispose()` 后任何未决的 `onStartLogin`/`onPollLogin` 返回一律作废，其中刚创建的
 *      `sessionId` 必须主动调用 `onCancelLogin` 清理。
 */

const EMPTY_FORM: CustomEndpointDraft = emptyEndpointDraft();

export interface ProviderFormState {
  draft: CustomEndpointDraft;
  selectedProfiles: string[];
  probe?: EndpointProbe;
  probePending: boolean;
  savePending: boolean;
  error: string;
  warning: string;
  notice: string;
}

export type ProviderFormAction =
  | { type: 'initAdd'; initialProfiles: string[] }
  | { type: 'edit'; row: CustomEndpointRow; enabledProfiles: string[] }
  | { type: 'field'; patch: Partial<CustomEndpointDraft> }
  | { type: 'toggleProfile'; profile: string }
  | { type: 'probeStart' }
  | { type: 'probeResult'; probe: EndpointProbe }
  | { type: 'saveStart' }
  | { type: 'saveResult'; ok: boolean; message?: string; warning?: string; notice?: string };

export const FORM_INITIAL: ProviderFormState = {
  draft: EMPTY_FORM,
  selectedProfiles: [],
  probePending: false,
  savePending: false,
  error: '',
  warning: '',
  notice: '',
};

/** 决定新建端点的初始开启 BOT：优先沿用当前上下文默认 BOT，其次退到花名册首位。 */
export function defaultSelectedProfiles(bots: readonly SettingsBotRow[], defaultProfile: string): string[] {
  if (bots.length === 0) return [];
  if (defaultProfile && bots.some((bot) => bot.profile === defaultProfile)) {
    return [defaultProfile];
  }
  const first = bots[0];
  return first ? [first.profile] : [];
}

/** 构造表单首帧初始状态，保证 SSR 首帧即与 `editing` / `defaultProfile` 一致。 */
export function initialFormState(
  editing: CustomEndpointRow | null,
  editingProfiles: readonly string[] | undefined,
  bots: readonly SettingsBotRow[],
  defaultProfile: string,
): ProviderFormState {
  if (editing) {
    return {
      ...FORM_INITIAL,
      draft: draftFromEndpoint(editing),
      selectedProfiles: [...(editingProfiles ?? [])],
    };
  }
  return {
    ...FORM_INITIAL,
    selectedProfiles: defaultSelectedProfiles(bots, defaultProfile),
  };
}

export function formReducer(state: ProviderFormState, action: ProviderFormAction): ProviderFormState {
  switch (action.type) {
    case 'initAdd':
      return { ...FORM_INITIAL, selectedProfiles: action.initialProfiles };
    case 'edit':
      return {
        ...FORM_INITIAL,
        draft: draftFromEndpoint(action.row),
        selectedProfiles: action.enabledProfiles,
      };
    case 'field':
      return { ...state, draft: { ...state.draft, ...action.patch }, error: '', warning: '', notice: '' };
    case 'toggleProfile': {
      const next = state.selectedProfiles.includes(action.profile)
        ? state.selectedProfiles.filter((item) => item !== action.profile)
        : [...state.selectedProfiles, action.profile];
      return { ...state, selectedProfiles: next, error: '', warning: '', notice: '' };
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

/** 是否已存有端点密钥：只看服务端行是否标记 `hasApiKey`，禁止拿 `draft.id` 非空充数。 */
export function hasStoredEndpointKey(editing: Pick<CustomEndpointRow, 'hasApiKey'> | null): boolean {
  return Boolean(editing?.hasApiKey);
}

/**
 * 推导编辑态需要同步写回的目标 BOT 集合。
 *
 * 【规则】先取网关端点索引 `endpointProfiles`（含 model.options 读取失败的成员），
 *   再并入视图 `active` / `ready` 成员（兼容未传 `endpointProfiles` 的测试快照），去重保序。
 */
export function resolveEditProfiles(
  view: Pick<ProviderView, 'id' | 'agents'>,
  endpointProfiles?: Readonly<Record<string, readonly string[]>>,
): string[] {
  const configured = endpointProfiles?.[normalizeEndpointId(view.id)] ?? [];
  const visible = view.agents
    .filter((agent) => agent.state === 'active' || agent.state === 'ready')
    .map((agent) => agent.profile);
  return [...new Set([...configured, ...visible].filter(Boolean))];
}

/** 构造 `onSaveEndpoint` 写入参数：新建与编辑均强制 `makeDefault: false`。 */
export function buildSaveEndpointOptions(
  isEditing: boolean,
  selectedProfiles: readonly string[],
  editingProfiles: readonly string[] | undefined,
): { fanOutTo: readonly string[]; targetProfiles?: readonly string[]; makeDefault: false } {
  const raw = isEditing ? (editingProfiles ?? []) : selectedProfiles;
  const targets = [...new Set(raw.filter(Boolean))];
  return {
    ...(targets.length > 0 ? { targetProfiles: targets } : {}),
    fanOutTo: targets.slice(1),
    makeDefault: false,
  };
}

/** 根据探测结果推算草稿补丁（规范化 baseUrl 与自动填充默认模型/目录）。 */
export function applyProbeResultToDraft(
  draft: CustomEndpointDraft,
  result: EndpointProbe,
): Partial<CustomEndpointDraft> | null {
  if (result.kind !== 'ok') return null;
  const patch: Partial<CustomEndpointDraft> = { models: result.models };
  if (result.resolvedBaseUrl && result.resolvedBaseUrl !== draft.baseUrl.trim()) {
    patch.baseUrl = result.resolvedBaseUrl;
  }
  if (!draft.model && result.models[0]) {
    patch.model = result.models[0];
  }
  return patch;
}

/** 格式化跨 BOT 写入部分失败的告警，使用跨语言安全分隔符避免英文界面泄漏中文顿号。 */
export function formatFanOutWarning(heading: string, failedDisplayNames: readonly string[]): string {
  return `${heading} · ${failedDisplayNames.join(', ')}`;
}

export interface OAuthLoginCoordinatorDeps<TTimer = ReturnType<typeof setTimeout>> {
  setTimeout: (fn: () => void, ms: number) => TTimer;
  clearTimeout: (handle: TTimer) => void;
  pollIntervalMs?: number;
  onStartLogin: SettingsActions['onStartLogin'];
  onPollLogin: SettingsActions['onPollLogin'];
  onCancelLogin: SettingsActions['onCancelLogin'];
  onReloadProviders: () => void;
  onStateChange: (state: LoginState | null) => void;
}

export interface OAuthLoginCoordinator {
  start(providerId: string): Promise<void>;
  dispose(): void;
}

/**
 * OAuth 设备码轮询协调器（带代次令牌与定时器清理）。
 *
 * 【约束】每次开启新会话或调用 `dispose()` 都递增 `epoch` 并清掉挂起定时器；
 *   任何迟滞返回的 `onStartLogin` / `onPollLogin` 若发现 `epoch` 已变更，
 *   前者主动撤销刚拿到的远端会话，后者静默丢弃并不再续订轮询。
 */
export function createOAuthLoginCoordinator<TTimer = ReturnType<typeof setTimeout>>(
  deps: OAuthLoginCoordinatorDeps<TTimer>,
): OAuthLoginCoordinator {
  const intervalMs = deps.pollIntervalMs ?? 3000;
  let epoch = 0;
  let pendingSessionId = '';
  let timer: TTimer | null = null;
  let activeState: LoginState | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      deps.clearTimeout(timer);
      timer = null;
    }
  };

  const emit = (next: LoginState | null): void => {
    activeState = next;
    deps.onStateChange(next);
  };

  const dispose = (): void => {
    epoch += 1;
    clearTimer();
    const sid = pendingSessionId;
    pendingSessionId = '';
    if (sid) void deps.onCancelLogin(sid);
    if (activeState !== null) emit(null);
  };

  const poll = async (providerId: string, sid: string, runEpoch: number): Promise<void> => {
    if (runEpoch !== epoch) return;
    let next: Awaited<ReturnType<SettingsActions['onPollLogin']>>;
    try {
      next = await deps.onPollLogin(providerId, sid);
    } catch (error: unknown) {
      if (runEpoch !== epoch) return;
      if (pendingSessionId === sid) pendingSessionId = '';
      if (activeState && activeState.sessionId === sid) {
        emit({
          ...activeState,
          status: 'failed',
          message: error instanceof Error ? error.message : '',
        });
      }
      return;
    }
    if (runEpoch !== epoch) return;
    if (next.status !== 'pending' && pendingSessionId === sid) {
      pendingSessionId = '';
    }
    if (activeState && activeState.sessionId === sid) {
      emit({
        ...activeState,
        status: next.status,
        message: next.message || '',
      });
    }
    if (next.status === 'pending') {
      clearTimer();
      timer = deps.setTimeout(() => {
        timer = null;
        void poll(providerId, sid, runEpoch);
      }, intervalMs);
    } else if (next.status === 'approved') {
      deps.onReloadProviders();
    }
  };

  const start = async (providerId: string): Promise<void> => {
    dispose();
    const runEpoch = epoch;
    let result: Awaited<ReturnType<SettingsActions['onStartLogin']>>;
    try {
      result = await deps.onStartLogin(providerId);
    } catch (error: unknown) {
      if (runEpoch !== epoch) return;
      emit({
        providerId,
        sessionId: '',
        userCode: '',
        verificationUrl: '',
        status: 'failed',
        message: error instanceof Error ? error.message : '',
        pending: false,
      });
      return;
    }

    if (runEpoch !== epoch) {
      if (result.ok && result.sessionId) void deps.onCancelLogin(result.sessionId);
      return;
    }

    if (!result.ok || !result.sessionId) {
      emit({
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

    const sid = result.sessionId;
    pendingSessionId = sid;
    emit({
      providerId,
      sessionId: sid,
      userCode: result.userCode || '',
      verificationUrl: result.verificationUrl || '',
      status: 'pending',
      message: '',
      pending: false,
    });
    void poll(providerId, sid, runEpoch);
  };

  return { start, dispose };
}
