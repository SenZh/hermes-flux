/**
 * Hermes Flux 设置中心业务装配与数据服务（Settings Data Service）
 *
 * 【设计意图 (Why)】
 *   将设置中心数据装载（统一提供商表、自定义端点、订阅账号）、Bot 花名册与管理快照派生、
 *   全量设置快照构造、设置中心交互动作表（SettingsActions，涵盖端点 CRUD、提供商探针/启用/退出/多 Agent 绑定开关）、
 *   网关连接测试与配置提交、以及 React 设置弹窗的挂载与指纹防抖刷新彻底从 index.ts 中解耦。
 *   使复杂的设置中心领域逻辑与 UI 调度脱离宿主 DOM，具备高内聚性、可单测性与单向依赖纯度。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 订阅与 Auth 共享 Profile 语义：订阅是账号级来源，登录态落在共享 auth，
 *      由 share_auth 回落到首个 profile；登录、轮询、退出都必须作用于 subscriptionProfileName，
 *      否则会把令牌签进一个不参与共享的 profile，导致其他 Agent 无法使用；
 *   2. 统一提供商表原始行落盘：端点与订阅的原始行必须落进快照，供编辑表单读取 base_url / has_api_key；
 *      若用归并后的视图反推，将导致编辑弹窗无法打开或选项缺失；
 *   3. 勾选 / 取消勾选某 Agent 绑定：判定全部交给 core 的 planBindingToggle，
 *      正在使用的 Agent 不允许取消（必须先改模型），自定义端点新增必须补密钥，判定严格遵守 classifyAttachWrite；
 *   4. 端点整体删除：作用范围取 view.agents 里 active/ready 的 Agent（配置集合），
 *      配置集合不完整时严禁执行删除，防止漏删却误报成功；
 *   5. 设置快照指纹防抖：关闭态零成本早退；开启态比对 JSON 字符串指纹，
 *      避免在流式输出期间每帧序列化与重渲染整棵 50+ provider 的设置树。
 *
 * 【约束与规则 (Rules)】
 *   1. 单向依赖：严禁反向 import index.js，所有外部状态读写与 UI 渲染通过 SettingsDataDeps 注入；
 *   2. 严格类型约束：0 TS 报错，严禁使用 `as any`；
 *   3. 零文本写死：通知、错误与占位提示统一走 deps.t 国际化输出。
 */

import type { AppState } from '../state/appState.js';
import type { HermesDesktopBridge } from '../../preload/index.js';
import {
  type HermesGatewayClient,
  type ProfilesConfigureParams,
  ProfileService,
  formatModelDisplayName,
  projectBotRoster,
  normalizeEndpointId,
  planBindingToggle,
  planProviderRemoval,
  draftForBindingAttach,
  classifyAttachWrite,
} from '@hermes-flux/core';
import {
  mountSettingsModal,
  type SettingsSectionId,
  type SettingsSnapshot,
  type SettingsActions,
  type BotExitTarget,
  type GatewayDraft,
  type ToggleProviderAgentResult,
  type I18nKey,
  type FontPreferences,
  type ActivityIndicatorVariant,
  type SkinId,
  applyConversationWidthMode,
  resolveConversationWidthMode,
  saveConversationWidthMode,
  safeSetItem,
  setLocale,
  messageKeyForVerdict,
} from '@hermes-flux/ui';
import type { StorageWriteFailure } from '@hermes-flux/ui';
import { createProviderAdminRest } from '../providerAdminRest.js';
import { createProviderAdminController, planDeleteTarget } from '../providerAdminController.js';
import { createSettingsController, resolveGatewayPassword } from '../settingsController.js';
import { createBotManagementController } from '../botManagementController.js';
import { loadProviderCatalog } from '../providerCatalog.js';

export interface GatewayConnectionTestResult {
  ok: boolean;
  message?: string;
  latency?: number;
  ticket?: string;
}

export interface SettingsDataDeps {
  readonly getState: () => AppState;
  readonly getGatewayClient: () => HermesGatewayClient | null;
  readonly getDesktopApi?: () => HermesDesktopBridge | undefined;
  readonly getCurrentTicket: () => string | null;
  readonly getEffectiveUrl: (url: string) => string;
  readonly render: () => void;
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string;
  readonly describeRpcError: (error: unknown) => string;
  readonly showToast: (message: string, durationMs?: number) => void;
  readonly bootLog: { warn(message: string, meta?: Record<string, unknown>): void };
  readonly fetchModelOptions: (options?: { clearNotice?: boolean }) => Promise<void>;
  readonly fetchProfiles: (options?: { refresh?: boolean }) => Promise<void>;
  readonly testConnection: (url: string, user: string, pass: string) => Promise<GatewayConnectionTestResult>;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
  readonly getFontPreferences: () => FontPreferences;
  readonly setFontPreferences: (prefs: FontPreferences) => void;
  readonly applyFontPreferences: (prefs: FontPreferences) => void;
  readonly getActivityIndicatorVariant: () => ActivityIndicatorVariant;
  readonly setActivityIndicatorVariant: (variant: ActivityIndicatorVariant) => void;
  readonly saveActivityIndicatorVariant: (variant: ActivityIndicatorVariant) => void;
  readonly resolveActivityIndicatorVariant: (variant: string) => ActivityIndicatorVariant;
  readonly resolveSkinId: (theme: string) => SkinId;
  readonly writePresenceLayout: (layout: string) => void;
  readonly onPresenceLayoutChanged: () => void;
  readonly profileAvatarCache: Map<string, string>;
  readonly persistAvatarCache: () => void;
}

export interface SettingsDataService {
  scopedProfileName(): string;
  subscriptionProfileName(): string;
  botRoster(): Array<{ profile: string; displayName: string; avatar?: string }>;
  reloadProviderCatalog(): Promise<void>;
  openBotSettings(botId: string): void;
  getBotManagementSnapshot(): SettingsSnapshot['botManagement'];
  getSettingsSnapshot(): SettingsSnapshot;
  ensureSettingsSectionData(section: SettingsSectionId, force?: boolean): void;
  createSettingsActions(): SettingsActions;
  /** 关闭设置中心的唯一出口（含脏稿拦截）；全局快捷键与标题栏都必须走这里。 */
  requestSettingsExit(target?: BotExitTarget): void;
  syncReactSettings(): void;
  getSettingsController(): ReturnType<typeof createSettingsController>;
  getProviderAdminController(): ReturnType<typeof createProviderAdminController>;
  getBotManagementController(): ReturnType<typeof createBotManagementController>;
}

export function createSettingsDataService(deps: SettingsDataDeps): SettingsDataService {
  const profileService = new ProfileService();

  let updateReactSettings: (() => void) | null = null;
  let lastSettingsSnapshotJson = '';
  let settingsController: ReturnType<typeof createSettingsController> | null = null;
  let providerAdminController: ReturnType<typeof createProviderAdminController> | null = null;
  let botManagementController: ReturnType<typeof createBotManagementController> | null = null;

  /**
   * 宿主级脏检查与待执行离场目标。
   *
   * 【设计意图】草稿池由控制器持有，但"离场前是否确认"属于宿主导航职责：
   *   由 BOT 面板注册一个只读探针，切导航 / 关弹窗 / Esc 统一走 requestSettingsExit，
   *   命中脏稿时把目标挂起，等用户在确认框里选「保留 / 放弃 / 取消」。
   * 【规则】目标只允许一个（后一次离场请求覆盖前一次），确认后必须立即清空，
   *   否则下一次打开设置会凭空弹出上一轮的确认框。
   */
  let botDirtyGuard: (() => boolean) | null = null;
  let pendingBotExit: BotExitTarget | null = null;

  type BindingFlightResult = ToggleProviderAgentResult & {
    confirmRequired?: boolean;
    step?: 'switch' | 'disable';
  };

  let providerCatalogGen = 0;
  let providerCatalogInFlight = false;

  const inFlightProviderBindings = new Map<
    string,
    { signature: string; promise: Promise<BindingFlightResult> }
  >();

  function scopedProfileName(): string {
    const state = deps.getState();
    return state.settingsScopedProfile || state.profileName || 'default';
  }

  function botRoster(): Array<{ profile: string; displayName: string; avatar?: string }> {
    const state = deps.getState();
    if (state.profiles.length === 0) {
      const name = state.profileName || 'default';
      return [{ profile: name, displayName: name }];
    }
    return state.profiles.map((profile) => ({
      profile: profile.name,
      displayName: profile.displayName || profile.name,
      avatar: profile.avatar,
    }));
  }

  function subscriptionProfileName(): string {
    const state = deps.getState();
    return botRoster()[0]?.profile || state.profileName || 'default';
  }

  function syncLocale(): void {
    const state = deps.getState();
    setLocale(state.lang === 'en' ? 'en-US' : 'zh-CN');
  }

  function getProviderAdminController(): ReturnType<typeof createProviderAdminController> {
    if (providerAdminController) return providerAdminController;
    const desktopApi = deps.getDesktopApi?.();
    const rest = createProviderAdminRest({
      baseUrl: () => deps.getEffectiveUrl(deps.getState().gatewayUrl),
      ticket: () => deps.getCurrentTicket() ?? '',
      proxy: (options) => {
        if (!desktopApi?.httpProxy) throw new Error('Desktop REST proxy is unavailable');
        return desktopApi.httpProxy(options);
      },
    });
    providerAdminController = createProviderAdminController({
      rest,
      render: () => deps.render(),
      describeError: (error) => deps.describeRpcError(error),
      getEndpoints: () => deps.getState().settingsCustomEndpoints,
      setEndpoints: (value) => { deps.getState().settingsCustomEndpoints = value; },
      getOauth: () => deps.getState().settingsSubscriptionCatalog,
      setOauth: (value) => { deps.getState().settingsSubscriptionCatalog = value; },
      setBusy: (busy) => { deps.getState().settingsProviderAdminBusy = busy; },
      notify: (message) => deps.showToast(message),
      warn: (message, meta) => deps.bootLog.warn(message, typeof meta === 'object' && meta ? meta as Record<string, unknown> : undefined),
      onCatalogChanged: () => { void deps.fetchModelOptions({ clearNotice: false }); },
    });
    return providerAdminController;
  }

  /**
   * 刷新模型与提供商聚合视图（Stale-While-Revalidate + 代际竞态防护）。
   *
   * 【设计意图 (Why)】
   *   从 BOT 配置页修改默认模型或增删提供商后切回设置页，必须拉回最新 `providerViews`，
   *   同时在已有 `ready` 快照时避免重绘加载骨架，防止切换默认模型或列表跳闪。
   *
   * 【防范的历史坑 (Pitfall)】
   *   1. 若同步触发 `deps.render()` 位于 `try` 块外部，一旦渲染异常就会把 `providerCatalogInFlight`
   *      永久锁死在 `true`，导致后续所有切页自动刷新全部失效；
   *   2. 乱序慢响应曾在后发先至之后回写，用过时 `active` 状态覆盖最新目录。
   *
   * 【约束与规则 (Rules)】
   *   1. 递增 `providerCatalogGen` 并把所有写状态与首次渲染收进同一 `try/finally`，确保在途标记必清；
   *   2. `try` 与 `catch` 回写前必须校验 `gen === providerCatalogGen`，丢弃任何迟到的旧响应。
   */
  async function reloadProviderCatalog(): Promise<void> {
    const state = deps.getState();
    const agents = botRoster();
    const gen = ++providerCatalogGen;
    providerCatalogInFlight = true;
    try {
      // 已有就绪数据时做静默后台刷新，避免切页或保存 BOT 后闪烁空骨架或瞬时清空 BOT 面板模型目录。
      if (state.settingsProviderViews.status !== 'ready') {
        state.settingsProviderViews = { status: 'loading' };
        deps.render();
      }
      const desktopApi = deps.getDesktopApi?.();
      const rest = createProviderAdminRest({
        baseUrl: () => deps.getEffectiveUrl(state.gatewayUrl),
        ticket: () => deps.getCurrentTicket() ?? '',
        proxy: (options) => {
          if (!desktopApi?.httpProxy) throw new Error('Desktop REST proxy is unavailable');
          return desktopApi.httpProxy(options);
        },
      });
      const gatewayClient = deps.getGatewayClient();
      const result = await loadProviderCatalog({
        agents,
        rest,
        rpc: {
          call: <T,>(method: string, params?: Record<string, unknown>) => {
            if (!gatewayClient) return Promise.reject(new Error(deps.t('settings.notConnected'))) as Promise<T>;
            return gatewayClient.call<T>(method, params);
          },
        },
        describeError: (error) => deps.describeRpcError(error),
      });
      if (gen !== providerCatalogGen) return;
      state.settingsProviderViews = { status: 'ready', data: result.views };
      state.settingsProviderFailures = result.failed;
      state.settingsCustomEndpoints = { status: 'ready', data: result.endpoints.map((entry) => entry.row) };
      state.settingsEndpointProfiles = Object.fromEntries(
        result.endpoints.map((entry) => [normalizeEndpointId(entry.row.id), [...entry.profiles]]),
      );
      state.settingsEndpointFailures = result.endpointFailures;
      state.settingsSubscriptionCatalog = result.subscriptionsOk
        ? { status: 'ready', data: result.subscriptions }
        : { status: 'error', message: result.subscriptionsError || deps.t('settings.loadFailed') };
    } catch (error) {
      if (gen !== providerCatalogGen) return;
      state.settingsProviderViews = { status: 'error', message: deps.describeRpcError(error) };
      state.settingsProviderFailures = [];
      state.settingsCustomEndpoints = { status: 'error', message: deps.describeRpcError(error) };
      state.settingsEndpointProfiles = {};
      state.settingsEndpointFailures = [];
      state.settingsSubscriptionCatalog = { status: 'error', message: deps.describeRpcError(error) };
    } finally {
      if (gen === providerCatalogGen) providerCatalogInFlight = false;
    }
    deps.render();
  }

  function getSettingsController(): ReturnType<typeof createSettingsController> {
    if (settingsController) return settingsController;
    const state = deps.getState();
    settingsController = createSettingsController({
      isConnected: () => Boolean(deps.getGatewayClient()) && state.gatewayConnected,
      profileName: () => state.profileName || 'default',
      call: <T,>(method: string, params?: Record<string, unknown>) => {
        const client = deps.getGatewayClient();
        if (!client) return Promise.reject(new Error(deps.t('settings.loadFailed'))) as Promise<T>;
        return client.call<T>(method, params);
      },
      render: () => deps.render(),
      translate: (key) => deps.t(key),
      describeError: (error) => deps.describeRpcError(error),
      getProfiles: () => state.settingsProfiles,
      setProfiles: (value) => { state.settingsProfiles = value; },
      getMcp: () => state.settingsMcp,
      setMcp: (value) => { state.settingsMcp = value; },
      getSkills: () => state.settingsSkills,
      setSkills: (value) => { state.settingsSkills = value; },
      setBusy: (busy) => { state.settingsBusy = busy; },
      onCatalogChanged: () => { void deps.fetchModelOptions({ clearNotice: false }); },
      notify: (message) => deps.showToast(message),
      warn: (message, meta) => deps.bootLog.warn(message, typeof meta === 'object' && meta ? meta as Record<string, unknown> : undefined),
    });
    return settingsController;
  }

  function getBotManagementController(): ReturnType<typeof createBotManagementController> {
    if (botManagementController) return botManagementController;
    const state = deps.getState();

    botManagementController = createBotManagementController({
      isConnected: () => Boolean(deps.getGatewayClient()) && state.gatewayConnected,
      loadProfiles: () => getSettingsController().loadProfiles(),
      getProfiles: () => state.settingsProfiles,
      getState: () => ({
        status: state.botManagementStatus,
        activeBotId: state.botManagementActiveBotId,
        activeDetail: state.botManagementDetail,
        drafts: state.botDrafts,
        errorBanner: state.botManagementError,
        confirmPending: state.botManagementConfirm,
        isBusy: state.botManagementBusy,
      }),
      setState: (patch) => {
        if (patch.status !== undefined) state.botManagementStatus = patch.status;
        if (patch.activeBotId !== undefined) state.botManagementActiveBotId = patch.activeBotId;
        if ('activeDetail' in patch) state.botManagementDetail = patch.activeDetail;
        if (patch.drafts !== undefined) state.botDrafts = patch.drafts;
        if ('errorBanner' in patch) state.botManagementError = patch.errorBanner;
        if ('confirmPending' in patch) state.botManagementConfirm = patch.confirmPending;
        if (patch.isBusy !== undefined) state.botManagementBusy = patch.isBusy;
      },
      describeBot: (botId, hint) => {
        const client = deps.getGatewayClient();
        if (!client) return Promise.reject(new Error(deps.t('settings.notConnected')));
        return profileService.describeBot(botId, client, hint);
      },
      fetchSkillInventory: async (botId) => {
        const client = deps.getGatewayClient();
        if (!client) return null;
        try {
          const result = await client.request<{ skills?: Record<string, string[]> | null }>(
            'skills.manage',
            { profile: botId, action: 'list' },
          );
          const groups = result?.skills;
          if (!groups || typeof groups !== 'object') return null;
          const names: string[] = [];
          for (const value of Object.values(groups)) {
            if (!Array.isArray(value)) continue;
            for (const name of value) if (typeof name === 'string' && name) names.push(name);
          }
          return names;
        // gate-degrade: 技能目录读取失败只影响非权威清单的补全展示，界面会显示"清单读取不完整"；不阻塞 BOT 详情，也不伪装成空目录。
        } catch {
          return null;
        }
      },
      fetchMcpStatus: async (botId) => {
        const client = deps.getGatewayClient();
        if (!client) return null;
        try {
          const result = await client.request<{
            servers?: Array<{ name?: string; connected?: boolean; transport?: string; tools?: number }>;
          }>('mcp.servers.status', { profile: botId });
          if (!Array.isArray(result?.servers)) return null;
          return result.servers
            .filter((row) => typeof row?.name === 'string' && row.name)
            .map((row) => ({
              name: row.name as string,
              connected: row.connected === true,
              transport: typeof row.transport === 'string' ? row.transport : undefined,
              toolCount: typeof row.tools === 'number' ? row.tools : undefined,
            }));
        // gate-degrade: 探活失败等价于"状态未知"（online 保持 undefined），界面不得画红灯；已有清单照常展示。
        } catch {
          return null;
        }
      },
      configureBot: (params: ProfilesConfigureParams) => {
        const client = deps.getGatewayClient();
        if (!client) return Promise.reject(new Error(deps.t('settings.notConnected')));
        return profileService.configureBot(params, client);
      },
      setAsset: (botId, dataUrl, clear) => {
        const client = deps.getGatewayClient();
        if (!client) return Promise.reject(new Error(deps.t('settings.notConnected')));
        return profileService.setAsset(botId, 'avatar', dataUrl, client, { clear });
      },
      render: () => deps.render(),
      translate: (key) => deps.t(key),
      describeError: (error) => deps.describeRpcError(error),
      notify: (message) => deps.showToast(message),
      onProfilesChanged: () => {
        void deps.fetchProfiles();
        void reloadProviderCatalog();
      },
      onAvatarChanged: (botId, dataUrl) => {
        const key = botId.toLowerCase();
        if (dataUrl) deps.profileAvatarCache.set(key, dataUrl);
        else deps.profileAvatarCache.delete(key);
        const profile = state.profiles.find((item) => item.name === botId);
        if (profile) {
          profile.avatar = dataUrl;
          profile.hasAvatar = Boolean(dataUrl);
          if (profile.displayName) {
            const named = profile.displayName.toLowerCase();
            if (dataUrl) deps.profileAvatarCache.set(named, dataUrl);
            else deps.profileAvatarCache.delete(named);
          }
        }
        if (state.settingsProfiles.status === 'ready') {
          state.settingsProfiles = {
            status: 'ready',
            data: state.settingsProfiles.data.map((row) =>
              row.name === botId ? { ...row, avatar: dataUrl, hasAvatar: Boolean(dataUrl) } : row,
            ),
          };
        }
        for (const session of state.sessions) {
          if (session.botName === botId) session.botAvatar = dataUrl;
        }
        deps.persistAvatarCache();
      },
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
    });
    return botManagementController;
  }

  /**
   * 离场请求的唯一入口：切导航、关闭弹窗、Esc 全部经过这里。
   *
   * 【规则】
   *   1. 只有当前停在 agents 域时才询问脏稿——离开其它域不可能丢 BOT 草稿；
   *   2. 命中脏稿时只挂起目标、不改任何导航状态，等确认框裁决；
   *   3. 用户取消必须清空挂起目标，否则下一次请求会复用过期目标。
   */
  function requestSettingsExit(target: BotExitTarget = { kind: 'close' }): void {
    const state = deps.getState();
    if (state.settingsSection === 'agents' && hasUnsavedBotDrafts()) {
      pendingBotExit = target;
      deps.render();
      return;
    }
    performSettingsExit(target);
  }

  /**
   * 是否存在未保存的 BOT 草稿（跨全池，不只看当前选中的那个）。
   *
   * 【为什么必须看全池】草稿池是 `Record<botId, BotDraftState>`，切换 BOT 不会清理上一个；
   *   只看 active bot 会出现「改 A → 切到 B → 关设置」完全无提示，A 的修改被悄悄留在本地。
   * 【规则】面板注册的守卫作为补充信号（表单本地未落池的改动），任一为真即视为脏。
   */
  function hasUnsavedBotDrafts(): boolean {
    const state = deps.getState();
    return botDirtyGuard?.() === true || Object.keys(state.botDrafts).length > 0;
  }

  function performSettingsExit(target: BotExitTarget): void {
    const state = deps.getState();
    pendingBotExit = null;
    if (target.kind === 'close') {
      state.isSettingsOpen = false;
    } else {
      state.settingsSection = target.section;
      ensureSettingsSectionData(target.section);
    }
    deps.render();
  }

  function openBotSettings(botId: string): void {
    const state = deps.getState();
    // 显式打开某个 BOT 是一次新的入场：上一轮挂起的离场目标不得残留。
    pendingBotExit = null;
    state.isSettingsOpen = true;
    state.settingsSection = 'agents';
    state.botManagementActiveBotId = botId;
    const status = state.botManagementStatus.status;
    ensureSettingsSectionData('agents');
    if (status !== 'uninitialized' && status !== 'fetching_list') {
      getBotManagementController().selectBot(botId, { immediate: true });
    }
    deps.render();
  }

  function getBotManagementSnapshot(): SettingsSnapshot['botManagement'] {
    const state = deps.getState();
    const roster: SettingsSnapshot['botManagement']['roster'] =
      state.settingsProfiles.status === 'ready'
        ? projectBotRoster(
            state.settingsProfiles.data.map((row) => ({
              name: row.name,
              displayName: row.displayName,
              model: row.model || state.profiles.find((item) => item.name === row.name)?.model || '',
              avatar: row.avatar || state.profiles.find((item) => item.name === row.name)?.avatar || undefined,
              isDefault: row.isDefault,
            })),
            state.botDrafts,
          )
        : [];

    const availableModels: SettingsSnapshot['botManagement']['availableModels'] = [];
    const seenModels = new Set<string>();
    if (state.settingsProviderViews.status === 'ready') {
      for (const view of state.settingsProviderViews.data) {
        if (view.availability !== 'active' && view.availability !== 'ready') continue;
        for (const modelId of view.models) {
          const key = `${view.id}\u0000${modelId}`;
          if (seenModels.has(key)) continue;
          seenModels.add(key);
          availableModels.push({
            id: modelId,
            name: formatModelDisplayName(modelId, view.name),
            provider: view.id,
            providerName: view.name,
          });
        }
      }
    }

    return {
      status: state.botManagementStatus,
      roster,
      activeBotId: state.botManagementActiveBotId,
      activeDetail: state.botManagementDetail,
      availableModels,
      activeDraft: state.botManagementActiveBotId
        ? state.botDrafts[state.botManagementActiveBotId]
        : undefined,
      wizard: {
        open: false,
        draft: {
          mode: 'blank',
          name: '',
          displayName: '',
          description: '',
          model: '',
          provider: '',
          cloneFrom: '',
          cloneChannels: false,
          mirrorCredentials: false,
        },
        busy: false,
      },
      exitPrompt: pendingBotExit ? { target: pendingBotExit } : null,
      errorBanner: state.botManagementError,
      confirmPending: state.botManagementConfirm,
      highlightBotId: undefined,
      isBusy: state.botManagementBusy,
    };
  }

  function getSettingsSnapshot(): SettingsSnapshot {
    const state = deps.getState();
    // 兜底：任何路径把设置页关掉（含未来新增的入口）后，挂起的离场目标都必须失效，
    // 否则下一次打开会凭空弹出上一轮的确认框。
    if (!state.isSettingsOpen) pendingBotExit = null;
    return {
      isOpen: state.isSettingsOpen,
      section: state.settingsSection,
      theme: state.theme,
      locale: state.lang === 'en' ? 'en' : 'zh',
      fontPrefs: deps.getFontPreferences(),
      activityVariant: deps.getActivityIndicatorVariant(),
      conversationWidth: state.conversationWidth,
      profiles: state.settingsProfiles,
      bots: botRoster(),
      botManagement: getBotManagementSnapshot(),
      scopedProfile: scopedProfileName(),
      providerViews: state.settingsProviderViews,
      providerFailures: state.settingsProviderFailures,
      subscriptionCatalog: state.settingsSubscriptionCatalog,
      customEndpoints: state.settingsCustomEndpoints,
      endpointProfiles: state.settingsEndpointProfiles,
      endpointFailures: state.settingsEndpointFailures,
      providerAdminBusy: state.settingsProviderAdminBusy,
      mcp: state.settingsMcp,
      skills: state.settingsSkills,
      gateway: {
        url: state.gatewayUrl,
        username: state.username,
        hasStoredPassword: Boolean(state.password),
        profileName: state.profileName,
        status: state.gatewayConnected ? 'connected' : state.gatewayConnecting ? 'connecting' : 'disconnected',
        latencyMs: state.gatewayLatencyMs,
        test: state.testStatus,
      },
      appVersion: state.appVersion,
      platform: state.platform,
      busy: state.settingsBusy,
      presenceLayout: state.presenceLayout,
    };
  }

  /**
   * 按需加载设置分区数据，并在切入提供商页时触发后台静默对齐。
   *
   * 【设计意图 (Why)】
   *   即使用户先去 `BOT 配置` 改过默认模型（使 `settingsProviderViews.status` 已为 `ready`），
   *   切回 `providers` 页也必须再向网关校准一次，消除旧状态残留导致的"切了默认还关不掉"。
   *
   * 【防范的历史坑 (Pitfall)】
   *   曾因 `status === 'ready'` 就跳过刷新，造成页面持续展示改模型前的过时 `active` 状态；
   *   若不检查 `!providerCatalogInFlight`，连续重绘会放大出重复目录请求。
   *
   * 【约束与规则 (Rules)】
   *   1. `agents` 域仅在 `force` 或 `idle` 时预拉提供商目录，避免阻塞 BOT 配置页；
   *   2. `providers` 域只要 `!providerCatalogInFlight && status !== 'loading'` 均静默校准。
   */
  function ensureSettingsSectionData(section: SettingsSectionId, force = false): void {
    const state = deps.getState();
    if (section === 'agents') {
      getBotManagementController().ensureLoaded(force);
      if (force || state.settingsProviderViews.status === 'idle') {
        void reloadProviderCatalog();
      }
      return;
    }
    getSettingsController().ensureSection(section, force);
    if (section !== 'providers') return;
    if (state.profiles.length === 0) void getSettingsController().loadProfiles();
    if (force || (!providerCatalogInFlight && state.settingsProviderViews.status !== 'loading')) {
      void reloadProviderCatalog();
    }
  }

  /**
   * 落盘失败的可观测策略（P-032）。
   *
   * 【设计意图】隐私模式/禁用站点数据下 `setItem` 抛 `SecurityError`，配额满抛
   *   `QuotaExceededError`。写入点位于 `deps.render()` 之前，异常冒泡会跳过整次刷新，
   *   用户可见后果是「点了没反应」。此处统一降级并记录，保证 render 必定执行。
   *
   * 【约束与规则】
   *   1. `unavailable` 表示非浏览器环境（单测 / SSR），不属降级，静默；
   *   2. 网关草稿是用户主动输入并点击保存的配置，任何非 unavailable 失败都必须提示一次；
   *   3. 主题 / 语言 / 最近模型有即时视觉反馈，且重启才回退一次，弹窗遮挡收益为负 → 只记日志。
   */
  const reportStorageFailure = (scope: 'gateway' | 'theme' | 'locale', failure: StorageWriteFailure): void => {
    if (failure.ok || failure.reason === 'unavailable') return;
    deps.bootLog.warn('settings persist failed', {
      scope,
      reason: failure.reason,
      error: String(failure.error),
    });
    if (scope === 'gateway') {
      deps.showToast(deps.t('settings.gatewayDraftPersistFailed'), 5000);
    }
  };

  /**
   * 网关草稿落盘（P-032）：8 个 key 聚合上报，避免重复 toast 与重复日志。
   * `SecurityError` 不可恢复，首个失败即短路，避免无意义的后续重复尝试。
   */
  const writeGatewayDraft = (state: AppState): void => {
    const entries: ReadonlyArray<readonly [string, string]> = [
      ['hermes_flux_gateway_url', state.gatewayUrl],
      ['hermes_aura_gateway_url', state.gatewayUrl],
      ['hermes_flux_username', state.username],
      ['hermes_aura_username', state.username],
      ['hermes_flux_password', state.password],
      ['hermes_aura_password', state.password],
      ['hermes_flux_profile', state.profileName],
      ['hermes_aura_profile', state.profileName],
    ];
    let failure: StorageWriteFailure = { ok: true };
    for (const [key, value] of entries) {
      const result = safeSetItem(key, value);
      if (result.ok) continue;
      if (failure.ok) failure = result;
      if (result.reason === 'security') break;
    }
    reportStorageFailure('gateway', failure);
  };

  function applyGatewayDraft(draft: GatewayDraft): void {
    const state = deps.getState();
    state.gatewayUrl = draft.url.trim();
    state.username = draft.username;
    state.password = resolveGatewayPassword(draft.password, state.password);
    state.profileName = draft.profileName.trim() || 'default';
    // 内存态已更新：落盘失败不得中断后续 runBusy / connect（P-032）。
    writeGatewayDraft(state);
  }

  function createSettingsActions(): SettingsActions {
    const state = deps.getState();
    return {
      onClose: () => {
        requestSettingsExit({ kind: 'close' });
      },
      onSelectSection: (section) => {
        // 点当前项不构成离场，不做脏检查，避免误弹确认框。
        if (deps.getState().settingsSection === section) return;
        requestSettingsExit({ kind: 'section', section });
      },
      onThemeChange: (theme) => {
        state.theme = deps.resolveSkinId(theme);
        // 主题已在内存生效：写盘失败只影响下次启动的记忆，必须继续 render（P-032）。
        const primary = safeSetItem('hermes_flux_theme', state.theme);
        const legacy = safeSetItem('hermes_aura_theme', state.theme);
        reportStorageFailure('theme', primary.ok ? legacy : primary);
        deps.render();
      },
      onPresenceLayoutChange: (layout) => {
        state.presenceLayout = layout === 'dock' ? 'dock' : 'stage';
        deps.writePresenceLayout(state.presenceLayout);
        deps.onPresenceLayoutChanged();
        deps.render();
      },
      onLocaleChange: (locale) => {
        state.lang = locale === 'en' ? 'en' : 'zh';
        // 语言已在内存生效：写盘失败只影响下次启动的记忆，必须继续 syncLocale + render（P-032）。
        reportStorageFailure('locale', safeSetItem('hermes_flux_lang', state.lang));
        syncLocale();
        deps.render();
      },
      onFontPrefsChange: (prefs) => {
        deps.setFontPreferences(prefs);
        deps.applyFontPreferences(prefs);
        deps.render();
      },
      onActivityVariantChange: (variant) => {
        const activityIndicatorVariant = deps.resolveActivityIndicatorVariant(variant);
        deps.saveActivityIndicatorVariant(activityIndicatorVariant);
        deps.setActivityIndicatorVariant(activityIndicatorVariant);
        deps.render();
      },
      onConversationWidthChange: (width) => {
        const nextWidth = resolveConversationWidthMode(width);
        state.conversationWidth = nextWidth;
        saveConversationWidthMode(nextWidth);
        applyConversationWidthMode(nextWidth);
        deps.render();
      },
      onRefreshProfiles: () => { void getBotManagementController().loadRoster(true); },
      onScopeProfileChange: (profile) => {
        state.settingsScopedProfile = profile;
        deps.render();
      },
      onReloadProviders: () => {
        void reloadProviderCatalog();
      },
      onProbeEndpoint: (draft) => getProviderAdminController().probe(draft),
      onSaveEndpoint: async (draft, options) => {
        const targets = options.targetProfiles?.filter(Boolean) ?? [];
        const primary = targets[0] ?? scopedProfileName();
        const fanOutTo = targets.length > 0 ? targets.slice(1) : options.fanOutTo;
        const outcome = await getProviderAdminController().save(primary, draft, {
          fanOutTo,
          makeDefault: options.makeDefault,
          profileDisplayNames: Object.fromEntries(botRoster().map((bot) => [bot.profile, bot.displayName])),
        });
        if (outcome.currentOk === false) return { ok: false, message: outcome.current.message || deps.t('settings.saveFailed') };
        void reloadProviderCatalog();
        return { ok: true, fanOut: [outcome.current, ...outcome.fanOut] };
      },
      onActivateProvider: async (providerId, model, confirmExpensive) => {
        const controller = getProviderAdminController();
        const profile = scopedProfileName();
        const view = state.settingsProviderViews.status === 'ready'
          ? state.settingsProviderViews.data.find((item) => item.id === providerId)
          : undefined;
        const result = await controller.useMainModel(profile, {
          provider: providerId,
          model,
          baseUrl: view?.kind === 'custom' ? view.detail : undefined,
          confirmExpensive,
        });
        if (result.ok) {
          deps.showToast(deps.t('settings.providerUsed', { name: view?.name || providerId }));
          void reloadProviderCatalog();
        }
        return result;
      },
      onLogoutProvider: (providerId) =>
        new Promise((resolve) => {
          const controller = getProviderAdminController();
          const profileAtOpen = subscriptionProfileName();
          const target = planDeleteTarget(
            profileAtOpen,
            botRoster().find((bot) => bot.profile === profileAtOpen)?.displayName ?? profileAtOpen,
          );
          const view = state.settingsProviderViews.status === 'ready'
            ? state.settingsProviderViews.data.find((item) => item.id === providerId)
            : undefined;
          if (view?.manualHint) {
            state.confirmModal = {
              title: deps.t('settings.logoutConfirmTitle'),
              message: deps.t('settings.logoutManual', { command: view.manualHint }),
              confirmLabel: deps.t('settings.close'),
              cancelLabel: deps.t('settings.cancel'),
              isDanger: false,
              onConfirm: async () => resolve({ ok: false, cancelled: true }),
              onCancel: () => resolve({ ok: false, cancelled: true }),
            };
            deps.render();
            return;
          }
          state.confirmModal = {
            title: deps.t('settings.logoutConfirmTitle'),
            message: deps.t('settings.logoutConfirmMessage', { bot: target.displayName, name: view?.name || providerId }),
            confirmLabel: deps.t('settings.providerLogout'),
            cancelLabel: deps.t('settings.cancel'),
            isDanger: true,
            onConfirm: async () => {
              const result = await controller.logoutOauth(target.profile, providerId);
              if (result.ok) {
                deps.showToast(deps.t('settings.logoutDone', { name: view?.name || providerId }));
                void reloadProviderCatalog();
              }
              resolve(result);
            },
            onCancel: () => resolve({ ok: false, cancelled: true }),
          };
          deps.render();
        }),
      onStartLogin: (providerId) => getProviderAdminController().startLogin(subscriptionProfileName(), providerId),
      onPollLogin: (providerId, sessionId) =>
        getProviderAdminController().pollLogin(subscriptionProfileName(), providerId, sessionId),
      onCancelLogin: (sessionId) => getProviderAdminController().cancelLogin(subscriptionProfileName(), sessionId),
      onCopy: async (text) => {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            return true;
          }
          return false;
        } catch (error) {
          deps.bootLog.warn('clipboard write failed', { error: deps.describeRpcError(error) });
          return false;
        }
      },
      onDeleteEndpoint: (id) =>
        new Promise((resolve) => {
          const controller = getProviderAdminController();
          const targetId = normalizeEndpointId(id);
          const view = state.settingsProviderViews.status === 'ready'
            ? state.settingsProviderViews.data.find((item) => normalizeEndpointId(item.id) === targetId)
            : undefined;
          if (!view) {
            deps.showToast(deps.t('settings.providerDeleteUnknown'));
            resolve({ ok: false, message: deps.t('settings.providerDeleteUnknown') });
            return;
          }

          if (state.settingsEndpointFailures.length > 0) {
            const names = state.settingsEndpointFailures.map((item) => item.displayName).join('、');
            deps.showToast(deps.t('settings.providerDeleteScopeIncomplete', { agents: names }));
            resolve({ ok: false, message: deps.t('settings.providerDeleteScopeIncomplete', { agents: names }) });
            return;
          }

          const plan = planProviderRemoval(view, state.settingsEndpointProfiles[targetId] ?? []);

          if (plan.kind === 'blocked-in-use') {
            const names = plan.agents
              .map((agent) => (agent.model ? `${agent.displayName}（${agent.model}）` : agent.displayName))
              .join('、');
            state.confirmModal = {
              title: deps.t('settings.providerDeleteBlockedTitle'),
              message: deps.t('settings.providerDeleteBlocked', { name: view.name, agents: names }),
              confirmLabel: deps.t('settings.close'),
              cancelLabel: deps.t('settings.cancel'),
              isDanger: false,
              onConfirm: async () => resolve({ ok: false, message: deps.t('settings.providerDeleteBlockedShort') }),
              onCancel: () => resolve({ ok: false, cancelled: true }),
            };
            deps.render();
            return;
          }

          if (plan.kind === 'empty') {
            deps.showToast(deps.t('settings.providerDeleteInconsistent'));
            resolve({ ok: false, message: deps.t('settings.providerDeleteInconsistent') });
            return;
          }

          const names = plan.profiles.map(
            (profile) => botRoster().find((bot) => bot.profile === profile)?.displayName || profile,
          );
          state.confirmModal = {
            title: deps.t('settings.providerDelete'),
            message: deps.t('settings.providerDeleteConfirm', { name: view.name, agents: names.join('、') }),
            confirmLabel: deps.t('settings.providerDelete'),
            cancelLabel: deps.t('settings.cancel'),
            isDanger: true,
            onConfirm: async () => {
              const result = await controller.remove(plan.profiles, view.id);
              if (result.ok) {
                deps.showToast(deps.t('settings.providerDeleted', { name: view.name }));
                void reloadProviderCatalog();
                resolve(result);
                return;
              }
              const detail = result.failed
                .map((item) => `${item.displayName}：${item.message || ''}`)
                .join('；');
              const message = result.failed.length > 0
                ? deps.t('settings.providerDeletePartial', { detail })
                : result.message || deps.t('settings.providerToggleFailed');
              void reloadProviderCatalog();
              resolve({ ok: false, message });
            },
            onCancel: () => resolve({ ok: false, cancelled: true }),
          };
          deps.render();
        }),
      onToggleProviderAgent: async (providerId, profile, nextChecked, apiKey) => {
        const controller = getProviderAdminController();
        const targetId = normalizeEndpointId(providerId);
        const view = state.settingsProviderViews.status === 'ready'
          ? state.settingsProviderViews.data.find((item) => normalizeEndpointId(item.id) === targetId)
          : undefined;
        if (!view) return { ok: false, message: deps.t('settings.providerDeleteUnknown') };

        const botDisplayName = botRoster().find((item) => item.profile === profile)?.displayName || profile;
        const plan = planBindingToggle(view, profile, nextChecked);
        switch (plan.kind) {
          case 'noop':
            return { ok: true };
          case 'unknown-profile':
            return { ok: false, message: deps.t('settings.providerToggleUnknownProfile', { profile: botDisplayName }) };
          case 'blocked-active':
            return { ok: false, message: deps.t('settings.providerToggleBlockedActive', { profile: botDisplayName }) };
          case 'blocked-error':
            return {
              ok: false,
              message: plan.message || deps.t('settings.providerToggleBlockedError', { profile: botDisplayName }),
            };
          case 'login-required':
            return { ok: false, message: deps.t('settings.providerToggleLoginRequired', { profile: botDisplayName }) };
          default:
            break;
        }

        const flightKey = `${targetId}\u0000${profile}`;
        const signature = plan.kind;
        const existing = inFlightProviderBindings.get(flightKey);
        if (existing) {
          if (existing.signature === signature) return existing.promise;
          return { ok: false, message: deps.t('settings.providerAttachBusy') };
        }

        const promise = (async (): Promise<ToggleProviderAgentResult> => {
          switch (plan.kind) {
            case 'detach': {
              const result = await controller.remove([profile], view.id);
              if (result.ok) {
                await reloadProviderCatalog();
                return { ok: true };
              }
              return { ok: false, message: result.message || deps.t('settings.providerToggleFailed') };
            }
            case 'attach': {
              const row = state.settingsCustomEndpoints.status === 'ready'
                ? state.settingsCustomEndpoints.data.find(
                    (item) => normalizeEndpointId(item.id) === targetId,
                  )
                : undefined;
              if (!row) return { ok: false, message: deps.t('settings.providerEditUnavailable') };
              let key = (apiKey ?? '').trim();
              if (!key) {
                const sources = (state.settingsEndpointProfiles[targetId] ?? [])
                  .filter((source) => source !== profile);
                const copied = await controller.resolveEndpointKey(view.id, sources);
                if (!copied.ok) {
                  if (copied.reason === 'no-readable-key') {
                    return {
                      ok: false,
                      needsKey: true,
                      message: deps.t('settings.providerToggleNeedsKey', { profile: botDisplayName }),
                    };
                  }
                  return { ok: false, message: copied.message || deps.t('settings.providerToggleFailed') };
                }
                key = copied.key;
              }
              const draft = draftForBindingAttach(row, view.models, key);
              const outcome = await controller.save(profile, draft, { fanOutTo: [], makeDefault: plan.makeDefault });
              const verdict = classifyAttachWrite(plan, outcome);
              if (verdict.kind === 'failed') {
                return { ok: false, message: outcome.current.message || deps.t('settings.providerToggleFailed') };
              }
              const verdictKey = messageKeyForVerdict(verdict);
              if (verdictKey) {
                await reloadProviderCatalog();
                return { ok: false, message: deps.t(verdictKey) };
              }
              await reloadProviderCatalog();
              return { ok: true };
            }
            case 'logout-subscription': {
              const result = await controller.logoutOauth(profile, view.id);
              if (result.ok) {
                await reloadProviderCatalog();
                return { ok: true };
              }
              return { ok: false, message: result.message || deps.t('settings.providerToggleFailed') };
            }
            default:
              return { ok: false, message: deps.t('settings.providerToggleFailed') };
          }
        })();

        const entry = { signature, promise };
        inFlightProviderBindings.set(flightKey, entry);
        try {
          return await promise;
        } finally {
          if (inFlightProviderBindings.get(flightKey) === entry) {
            inFlightProviderBindings.delete(flightKey);
          }
        }
      },
      onNotify: (message) => deps.showToast(message),
      /**
       * 就地先为 BOT 改选新默认提供方/模型，成功后再关闭原自定义端点（INV-SWITCH-01）。
       *
       * 【设计意图 (Why)】
       *   禁止直接对“当前默认提供方”执行关闭/移除；弹窗选定替补模型后必须在同一在途锁下严格串行完成两步。
       *
       * 【防范的历史坑 (Pitfall)】
       *   1. 第一步切换默认若因高价确认或网络拒绝未落盘，一旦并发或继续执行 DELETE，会让 BOT 断供且无可回滚；
       *   2. 服务层若依赖 UI 禁用而不校验 `disableView.kind !== 'custom'`，直接调用可能对订阅项误发 DELETE。
       *
       * 【约束与规则 (Rules)】
       *   1. 与 `inFlightProviderBindings` 共享互斥键，同签名并发复用、异方向返回 busy；
       *   2. 严格先调 `controller.useMainModel`，仅当 `switchResult.ok` 且非 `confirmRequired` 才调 `controller.remove`；
       *   3. 仅允许关闭 `kind === 'custom'` 端点；第一步成功而第二步失败时无条件刷新目录反映最新默认模型。
       */
      onSwitchDefaultAndDisableProvider: async ({
        profile,
        disableProviderId,
        newProviderId,
        newModel,
        confirmExpensive,
      }) => {
        const controller = getProviderAdminController();
        const disableTargetId = normalizeEndpointId(disableProviderId);
        const newTargetId = normalizeEndpointId(newProviderId);
        const views = state.settingsProviderViews.status === 'ready' ? state.settingsProviderViews.data : [];
        const disableView = views.find((item) => normalizeEndpointId(item.id) === disableTargetId);
        const newView = views.find((item) => normalizeEndpointId(item.id) === newTargetId);
        if (!disableView || !newView) {
          return { ok: false, step: 'switch', message: deps.t('settings.providerDeleteUnknown') };
        }
        if (disableView.kind !== 'custom') {
          return { ok: false, step: 'disable', message: deps.t('settings.providerToggleFailed') };
        }
        const model = newModel.trim();
        if (!model || disableTargetId === newTargetId) {
          return { ok: false, step: 'switch', message: deps.t('settings.providerToggleFailed') };
        }

        const flightKey = `${disableTargetId}\u0000${profile}`;
        const signature = `switch-disable:${newTargetId}:${model}:${Boolean(confirmExpensive)}`;
        const existing = inFlightProviderBindings.get(flightKey);
        if (existing) {
          if (existing.signature === signature) return existing.promise;
          return { ok: false, step: 'switch', message: deps.t('settings.providerAttachBusy') };
        }

        const promise = (async (): Promise<BindingFlightResult> => {
          // 1. 先切换目标 BOT 的默认提供方与模型；失败或要求高价确认时立即中止，绝不提前关闭原提供商。
          const switchResult = await controller.useMainModel(profile, {
            provider: newView.id,
            model,
            baseUrl: newView.kind === 'custom' && newView.detail ? newView.detail : undefined,
            confirmExpensive,
          });
          if (switchResult.confirmRequired) {
            return {
              ok: false,
              confirmRequired: true,
              step: 'switch',
              message: switchResult.confirmMessage || switchResult.message || deps.t('settings.providerExpensiveWarning'),
            };
          }
          if (!switchResult.ok) {
            return {
              ok: false,
              step: 'switch',
              message: switchResult.message || deps.t('settings.providerToggleFailed'),
            };
          }

          // 2. 第一步落盘后再关闭原提供商，并无条件重拉目录使主模型变更即时反映到 UI 与 BOT 配置。
          const removeResult = await controller.remove([profile], disableView.id);
          await reloadProviderCatalog();
          void deps.fetchProfiles();
          if (!removeResult.ok) {
            return {
              ok: false,
              step: 'disable',
              message: deps.t('settings.providerSwitchDoneDisableFailed', {
                detail: removeResult.message || deps.t('settings.providerToggleFailed'),
              }),
            };
          }
          return { ok: true };
        })();

        const entry = { signature, promise };
        inFlightProviderBindings.set(flightKey, entry);
        try {
          return await promise;
        } finally {
          if (inFlightProviderBindings.get(flightKey) === entry) {
            inFlightProviderBindings.delete(flightKey);
          }
        }
      },

      onBotDraftChange: (botId, patch) => getBotManagementController().updateDraft(botId, patch),
      onSelectBotSettle: (botId) => getBotManagementController().selectBot(botId),
      onSaveBotConfig: (botId, options) => getBotManagementController().saveBot(botId, options),
      onResetBotDraft: (botId) => getBotManagementController().resetDraft(botId),
      onOpenBotWizard: () => {},
      onCloseBotWizard: () => {},
      onBotWizardDraftChange: () => {},
      onSubmitCreateBot: async () => ({ ok: false, message: deps.t('bot.createFailed') }),
      onRetryBotList: () => { void getBotManagementController().loadRoster(true); },
      onDismissBotError: () => getBotManagementController().dismissError(),
      onDismissBotConfirm: () => getBotManagementController().dismissConfirm(),
      onConfirmBotExit: (choice) => {
        const target = pendingBotExit;
        if (!target) return;
        if (choice === 'discard') {
          // 放弃修改必须清空整个草稿池：只清 active bot 会把其它 BOT 的未保存修改留在本地，
          // 而用户刚刚确认的是"放弃这些编辑"。
          const ids = Object.keys(deps.getState().botDrafts);
          if (ids.length > 0) {
            const controller = getBotManagementController();
            for (const id of ids) controller.resetDraft(id);
          }
        }
        performSettingsExit(target);
      },
      onCancelBotExit: () => {
        pendingBotExit = null;
        deps.render();
      },
      onRegisterBotDirtyGuard: (guard) => {
        botDirtyGuard = guard;
      },
      onOpenAgent: (name) => {
        openBotSettings(name);
      },
      onRefreshExtensions: () => { void getSettingsController().loadExtensions(); },
      onReloadSkills: () => getSettingsController().reloadSkills(),
      onTestGateway: (draft) => {
        applyGatewayDraft(draft);
        void getSettingsController().runBusy(async () => {
          state.testStatus = await deps.testConnection(state.gatewayUrl, state.username, state.password);
        });
      },
      onConnectGateway: (draft) => {
        applyGatewayDraft(draft);
        if (!state.gatewayUrl) {
          state.testStatus = { ok: false, message: deps.t('gateway.urlRequired'), latency: 0 };
          deps.render();
          return;
        }
        void deps.connect();
      },
      onDisconnectGateway: () => { deps.disconnect(); },
    };
  }

  function syncReactSettings(): void {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('react-settings-host');
    if (!host) return;
    const state = deps.getState();
    if (!updateReactSettings) {
      updateReactSettings = mountSettingsModal(host, getSettingsSnapshot, createSettingsActions());
      lastSettingsSnapshotJson = '';
    }
    if (!state.isSettingsOpen) {
      if (lastSettingsSnapshotJson === '') return;
      lastSettingsSnapshotJson = '';
      updateReactSettings();
      return;
    }
    const snapshot = getSettingsSnapshot();
    const json = JSON.stringify(snapshot);
    if (json === lastSettingsSnapshotJson) return;
    lastSettingsSnapshotJson = json;
    updateReactSettings();
  }

  return {
    scopedProfileName,
    subscriptionProfileName,
    botRoster,
    reloadProviderCatalog,
    openBotSettings,
    getBotManagementSnapshot,
    getSettingsSnapshot,
    ensureSettingsSectionData,
    createSettingsActions,
    requestSettingsExit,
    syncReactSettings,
    getSettingsController,
    getProviderAdminController,
    getBotManagementController,
  };
}
