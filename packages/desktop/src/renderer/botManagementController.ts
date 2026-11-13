/**
 * BOT 配置中枢的壳层编排控制器（纯逻辑，零 DOM / 零 React）。
 *
 * 【设计意图 (Why)】
 *   BOT 面板需要同时处理"花名册装载、详情防抖取数、跨挂载草稿、原子保存、失败横幅"。
 *   这些分支如果写进 11k 行的 renderer，就只能靠 grep 方法名做"测试"，并发交错与
 *   失败保留语义完全无法验证。把编排收敛到可注入依赖的控制器，测试可以真实驱动
 *   定时器、乱序响应与 RPC 失败。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 选择器滑动时每次停靠都直接打 `profiles.describe`，快速滑动会产生 RPC 风暴；
 *      同时迟到的旧响应会把新选中 BOT 的详情覆盖掉（后发先至）。
 *   2. 保存失败时旧实现会关闭弹窗并清空表单，用户输入全丢；本控制器只写失败横幅，
 *      草稿池与权威详情一律保留。
 *   3. 保存成功后若不先本地投影详情、且不删草稿，会立刻出现"保存了但脏点还在"。
 *
 * 【约束与规则 (Rules)】
 *   - 零 DOM、零 React、零全局状态；所有状态读写与副作用经 `deps` 注入；
 *   - 花名册与详情各自持有自增令牌，只有最后发起的请求可以写回状态；
 *   - 详情取数必须经过 160ms 静止防抖（`immediate` 只用于用户显式打开某个 BOT）；
 *   - 失败绝不清理草稿；保存期间拒绝选择切换，防止详情回填覆盖保存中的权威快照。
 */

import {
  applyDraftToDetail,
  buildBotConfigureParams,
  draftFromDetail,
  evaluateBotConfigureOutcome,
  isBotDraftDirty,
  mergeMcpStatus,
  mergeSkillInventory,
  type BotConfigureSegment,
  type BotDetailData,
  type BotDraftState,
  type BotManagementStatus,
  type ProfilesConfigureParams,
  type ProfilesConfigureResult,
} from '@hermes-flux/core';
import type { SettingsActionResult } from '@hermes-flux/ui';
import type { SettingsLoadable, SettingsProfileRow } from './settingsController.js';

/** BOT 面板一次渲染所需的全部壳层状态（可 JSON 序列化）。 */
export interface BotManagementSnapshotData {
  status: BotManagementStatus;
  activeBotId: string;
  activeDetail?: BotDetailData;
  drafts: Record<string, BotDraftState>;
  errorBanner?: string;
  /**
   * 网关要求二次确认的待办。
   * 【规则】只放网关原文，不把确认动作塞进快照；真正重发由壳层闭包完成。
   */
  confirmPending?: { message: string };
  isBusy: boolean;
}

/**
 * 控制器消费的文案键。
 * 【规则】失败与成功提示必须走 i18n，禁止在控制器里写自然语言字面量。
 */
export type BotManagementI18nKey =
  | 'settings.notConnected'
  | 'settings.malformedResponse'
  | 'bot.saved'
  | 'bot.saveFailed'
  | 'bot.savePartial'
  | 'bot.confirmRequired'
  | 'bot.segment.description'
  | 'bot.segment.soul'
  | 'bot.segment.model'
  | 'bot.segment.skills'
  | 'bot.segment.toolsets'
  | 'bot.segment.mcp_servers'
  | 'bot.segment.ui_meta';

export interface BotManagementControllerDeps {
  isConnected(): boolean;
  /** 复用设置中心的 `loadProfiles`：花名册只有一条数据通路。 */
  loadProfiles(): Promise<void>;
  getProfiles(): SettingsLoadable<SettingsProfileRow[]>;
  getState(): BotManagementSnapshotData;
  setState(patch: Partial<BotManagementSnapshotData>): void;
  describeBot(
    botId: string,
    hint: { displayName: string; avatar?: string; isDefault: boolean },
  ): Promise<BotDetailData>;
  /** 全局技能目录（仅用于 describe 未返回技能清单时补全展示，不得推导 disabled_skills）。 */
  fetchSkillInventory(botId: string): Promise<string[] | null>;
  /** MCP 探活；失败必须返回 null（界面显示"状态未知"），禁止画成红灯。 */
  fetchMcpStatus(
    botId: string,
  ): Promise<Array<{ name: string; connected: boolean; transport?: string; toolCount?: number }> | null>;
  configureBot(params: ProfilesConfigureParams): Promise<ProfilesConfigureResult>;
  setAsset(botId: string, dataUrl: string, clear: boolean): Promise<boolean>;
  render(): void;
  translate(key: BotManagementI18nKey): string;
  describeError(error: unknown): string;
  notify(message: string): void;
  /** 保存成功后让左轨/花名册等其它投影同步刷新。 */
  onProfilesChanged(): void;
  /** 头像写入/清除成功后同步本地头像缓存与花名册投影；不传 dataUrl 表示清除。 */
  onAvatarChanged(botId: string, dataUrl: string | undefined): void;
  /** 测试注入定时器；生产实现用 setTimeout + clearTimeout。 */
  schedule(fn: () => void, ms: number): () => void;
}

export interface BotManagementController {
  /** 进入 BOT 面板时调用；未初始化才拉花名册，已有详情不重复取数。 */
  ensureLoaded(force?: boolean): void;
  loadRoster(force?: boolean): Promise<void>;
  selectBot(botId: string, options?: { immediate?: boolean }): void;
  updateDraft(botId: string, patch: Partial<BotDraftState>): void;
  resetDraft(botId: string): void;
  /** 保存草稿；`confirmExpensive` 只由确认横幅上的"仍然保存"传入。 */
  saveBot(botId: string, options?: { confirmExpensive?: boolean }): Promise<SettingsActionResult>;
  dismissError(): void;
  /** 关闭二次确认横幅（"暂不保存"）；草稿保留。 */
  dismissConfirm(): void;
}

/** 详情静止防抖窗口：需求 §4.1 / 设计 §4.3 的 160ms。 */
const DETAIL_DEBOUNCE_MS = 160;

export function createBotManagementController(
  deps: BotManagementControllerDeps,
): BotManagementController {
  /** 花名册装载令牌：只有最后发起的 list 可以写回。 */
  let rosterToken = 0;
  /** 详情装载令牌：每次选择自增，迟到响应按 token 丢弃。 */
  let detailToken = 0;
  /** 当前挂起的防抖取消器；选择变化或重新装载时必须取消，避免旧目标复活。 */
  let cancelScheduledDetail: (() => void) | null = null;

  const clearScheduledDetail = (): void => {
    if (!cancelScheduledDetail) return;
    cancelScheduledDetail();
    cancelScheduledDetail = null;
  };

  /** 从当前花名册推导详情提示；读不到时用 ID 自身兜底，绝不伪造头像/默认标记。 */
  function resolveIdentityHint(botId: string): {
    displayName: string;
    avatar?: string;
    isDefault: boolean;
  } {
    const profiles = deps.getProfiles();
    const row = profiles.status === 'ready'
      ? profiles.data.find((item) => item.name === botId)
      : undefined;
    if (row) {
      return {
        displayName: row.displayName || row.name,
        avatar: row.avatar,
        isDefault: row.isDefault === true,
      };
    }
    const detail = deps.getState().activeDetail;
    if (detail && detail.id === botId) {
      return {
        displayName: detail.displayName || detail.id,
        avatar: detail.avatar,
        isDefault: detail.isDefault,
      };
    }
    return { displayName: botId, isDefault: false };
  }

  /**
   * 装载花名册。
   * 【规则】未连接 / 读取失败 / 空清单各自落到显式状态，绝不把失败伪装成空花名册。
   */
  async function loadRoster(_force = false): Promise<void> {
    // 保存中拒绝重载：此时 activeDetail 是正在提交的权威快照，列表回填会动摇保存语义。
    if (deps.getState().status.status === 'saving') return;
    const token = ++rosterToken;
    // 花名册一旦重载，旧目标的在途详情请求全部作废，防止旧详情落到新选择上。
    detailToken += 1;
    clearScheduledDetail();

    if (!deps.isConnected()) {
      deps.setState({
        status: { status: 'list_error', message: deps.translate('settings.notConnected') },
        isBusy: false,
      });
      deps.render();
      return;
    }

    deps.setState({ status: { status: 'fetching_list' }, isBusy: false, errorBanner: undefined, confirmPending: undefined });
    deps.render();

    try {
      await deps.loadProfiles();
    } catch (error) {
      if (token !== rosterToken) return;
      deps.setState({
        status: { status: 'list_error', message: deps.describeError(error) },
        isBusy: false,
      });
      deps.render();
      return;
    }
    if (token !== rosterToken) return;

    const profiles = deps.getProfiles();
    if (profiles.status === 'error') {
      deps.setState({
        status: { status: 'list_error', message: profiles.message },
        isBusy: false,
      });
      deps.render();
      return;
    }
    if (profiles.status !== 'ready') {
      // loadProfiles 正常会收敛到 ready/error；仍非 ready 说明编排被中断或响应畸形。
      // 显式失败，避免界面永久停在 fetching_list 的假加载。
      deps.setState({
        status: { status: 'list_error', message: deps.translate('settings.malformedResponse') },
        isBusy: false,
      });
      deps.render();
      return;
    }

    if (profiles.data.length === 0) {
      deps.setState({
        status: { status: 'empty_list' },
        activeBotId: '',
        activeDetail: undefined,
        isBusy: false,
      });
      deps.render();
      return;
    }

    const current = deps.getState();
    const activeBotId = profiles.data.some((row) => row.name === current.activeBotId)
      ? current.activeBotId
      : profiles.data[0].name;
    // 同一 BOT 的详情在列表刷新期间保持可见，避免保存成功后表单瞬间闪空；
    // 选中项已变化时旧详情必须丢弃，否则会把上一个 BOT 的配置画在新 BOT 名下。
    const keptDetail = current.activeDetail && current.activeDetail.id === activeBotId
      ? current.activeDetail
      : undefined;
    deps.setState({
      status: { status: 'idle', activeBotId },
      activeBotId,
      activeDetail: keptDetail,
      isBusy: false,
    });
    deps.render();

    // 默认选中：走统一的 selectBot，由它负责 loading_detail 与 160ms 防抖。
    selectBot(activeBotId);
  }

  /**
   * 详情到齐后的能力补全：
   *   - MCP 探活失败（null）保留 `online: undefined`，界面显示"状态未知"，绝不画红灯；
   *   - 技能清单非权威时才用全局目录补全展示项；`skills.manage` 永远不推导 disabled_skills。
   *
   * 【规则】补全只写当前 activeDetail；令牌失效或用户已切走时丢弃迟到结果。
   */
  async function enrichCapabilities(botId: string, detail: BotDetailData, token: number): Promise<void> {
    const [skillsResult, mcpResult] = await Promise.allSettled([
      detail.skills.authoritative ? Promise.resolve(null) : deps.fetchSkillInventory(botId),
      deps.fetchMcpStatus(botId),
    ]);
    if (token !== detailToken) return;
    const current = deps.getState();
    if (current.status.status !== 'idle' || current.activeDetail?.id !== botId) return;

    let next = current.activeDetail;
    if (skillsResult.status === 'fulfilled' && skillsResult.value && skillsResult.value.length > 0) {
      next = { ...next, skills: mergeSkillInventory(next.skills, skillsResult.value) };
    }
    if (mcpResult.status === 'fulfilled' && mcpResult.value) {
      next = { ...next, mcpServers: mergeMcpStatus(next.mcpServers, mcpResult.value) };
    }
    if (next !== current.activeDetail) {
      deps.setState({ activeDetail: next });
      deps.render();
    }
  }

  /**
   * 选择 BOT 并取详情。
   * 【规则】立即进入 loading_detail（UI 不锁死），真正 RPC 延迟 160ms 发出；
   *   每次调用自增令牌，迟到的旧响应直接丢弃。
   */
  function selectBot(botId: string, options: { immediate?: boolean } = {}): void {
    if (!botId) return;
    const current = deps.getState();
    // 保存中禁止切换：详情回填会替换 activeDetail，导致保存提交的是另一个快照。
    if (current.status.status === 'saving') return;

    clearScheduledDetail();
    const token = ++detailToken;
    const keptDetail = current.activeDetail && current.activeDetail.id === botId
      ? current.activeDetail
      : undefined;
    deps.setState({
      status: { status: 'loading_detail', activeBotId: botId },
      activeBotId: botId,
      activeDetail: keptDetail,
      errorBanner: undefined,
      confirmPending: undefined,
    });
    deps.render();

    const run = async (): Promise<void> => {
      if (token !== detailToken) return;
      try {
        const detail = await deps.describeBot(botId, resolveIdentityHint(botId));
        if (token !== detailToken) return;
        // 保存过程中不允许任何详情回填覆盖权威快照；保存结束会自行恢复状态。
        if (deps.getState().status.status === 'saving') return;
        deps.setState({
          status: { status: 'idle', activeBotId: botId },
          activeBotId: botId,
          activeDetail: detail,
          errorBanner: undefined,
        });
        deps.render();
        void enrichCapabilities(botId, detail, token);
      } catch (error) {
        if (token !== detailToken) return;
        if (deps.getState().status.status === 'saving') return;
        deps.setState({
          status: {
            status: 'detail_error',
            activeBotId: botId,
            message: deps.describeError(error),
          },
          activeBotId: botId,
        });
        deps.render();
      }
    };

    if (options.immediate) {
      void run();
      return;
    }
    cancelScheduledDetail = deps.schedule(() => {
      cancelScheduledDetail = null;
      void run();
    }, DETAIL_DEBOUNCE_MS);
  }

  /**
   * 写入草稿补丁。
   * 【规则】以 activeDetail 为唯一权威基线；补丁合并后若与基线等价，删除草稿键，
   *   避免"改回原值仍亮脏点"。没有 activeDetail 时忽略（详情未到，无法判断脏净）。
   */
  function updateDraft(botId: string, patch: Partial<BotDraftState>): void {
    const snapshot = deps.getState();
    const detail = snapshot.activeDetail;
    if (!detail || detail.id !== botId) return;

    const base = snapshot.drafts[botId] ?? draftFromDetail(detail);
    // 显式逐字段合并：`Partial` 里值为 undefined 的键不得覆盖已有草稿。
    const next: BotDraftState = {
      displayName: patch.displayName ?? base.displayName,
      description: patch.description ?? base.description,
      model: patch.model ?? base.model,
      provider: patch.provider ?? base.provider,
      isDefault: patch.isDefault ?? base.isDefault,
      soul: patch.soul ?? base.soul,
      avatar: patch.avatar ? { ...patch.avatar } : base.avatar,
      // 数组必须复制：草稿池与调用方共享同一个数组引用会被后续原地修改污染。
      disabledSkills: patch.disabledSkills ? [...patch.disabledSkills] : [...base.disabledSkills],
      enabledToolsets: patch.enabledToolsets ? [...patch.enabledToolsets] : [...base.enabledToolsets],
      enabledMcpServers: patch.enabledMcpServers ? [...patch.enabledMcpServers] : [...base.enabledMcpServers],
    };

    const drafts = { ...snapshot.drafts };
    if (isBotDraftDirty(detail, next)) drafts[botId] = next;
    else delete drafts[botId];
    deps.setState({ drafts, confirmPending: undefined });
    deps.render();
  }

  /** 清空单个 BOT 的草稿；表单由 UI 重新从 activeDetail 派生。 */
  function resetDraft(botId: string): void {
    const snapshot = deps.getState();
    if (!(botId in snapshot.drafts) && !snapshot.confirmPending) return;
    const drafts = { ...snapshot.drafts };
    delete drafts[botId];
    deps.setState({ drafts, confirmPending: undefined });
    deps.render();
  }

  /**
   * 原子保存当前草稿。
   * 【规则】
   *   - 无草稿 = 没有待提交修改，直接成功且不发任何 RPC；
   *   - `profiles.configure` 与 `profiles.set_asset` 任一失败都返回失败、保留草稿并挂横幅；
   *   - 成功后本地投影详情并删草稿，再异步刷新花名册（不阻塞保存结果）。
   */
  async function saveBot(
    botId: string,
    options: { confirmExpensive?: boolean } = {},
  ): Promise<SettingsActionResult> {
    const snapshot = deps.getState();
    const draft = snapshot.drafts[botId];
    // 无草稿不是错误：用户可以点保存，但没有任何字段需要写回。
    if (!draft) return { ok: true };
    // 防重入：上一次提交尚未结束时，第二次点击必须被拒绝，且不能发出第二个 RPC。
    if (snapshot.status.status === 'saving') return { ok: false, message: '' };

    const detail = snapshot.activeDetail;
    if (!detail || detail.id !== botId) {
      // 没有权威快照就无法生成差异参数；显式失败，绝不猜着全量覆盖。
      return { ok: false, message: deps.translate('settings.malformedResponse') };
    }

    const profiles = deps.getProfiles();
    const rosterRow = profiles.status === 'ready'
      ? profiles.data.find((row) => row.name === botId)
      : undefined;

    deps.setState({
      status: { status: 'saving', activeBotId: botId },
      activeBotId: botId,
      isBusy: true,
      errorBanner: undefined,
      confirmPending: undefined,
    });
    deps.render();

    /** 失败收尾：恢复 idle（本步无 editing 分支）、挂横幅、草稿原样保留。 */
    const fail = (message: string): SettingsActionResult => {
      deps.setState({
        status: { status: 'idle', activeBotId: botId },
        activeBotId: botId,
        isBusy: false,
        errorBanner: message,
        confirmPending: undefined,
      });
      deps.render();
      return { ok: false, message };
    };

    /** 等待用户确认：网关一个字段都没写，草稿必须原样保留。 */
    const awaitConfirm = (message: string): SettingsActionResult => {
      const text = message || deps.translate('bot.confirmRequired');
      deps.setState({
        status: { status: 'idle', activeBotId: botId },
        activeBotId: botId,
        isBusy: false,
        errorBanner: undefined,
        confirmPending: { message: text },
      });
      deps.render();
      return { ok: false, message: text };
    };

    const segmentLabel = (segment: BotConfigureSegment): string =>
      deps.translate(`bot.segment.${segment}` as BotManagementI18nKey);

    const partialMessage = (segments: readonly BotConfigureSegment[]): string =>
      deps.translate('bot.savePartial').replace('{segments}', segments.map(segmentLabel).join('、'));

    try {
      const params = buildBotConfigureParams(detail, draft, rosterRow?.uiMeta, {
        confirmExpensive: options.confirmExpensive === true,
      });
      if (params) {
        const result = await deps.configureBot(params);
        const outcome = evaluateBotConfigureOutcome(params, result);
        if (!outcome.ok) {
          if (outcome.kind === 'confirm') return awaitConfirm(outcome.message);
          if (outcome.kind === 'partial') return fail(partialMessage(outcome.missing));
          return fail(outcome.message || deps.translate('bot.saveFailed'));
        }
      }

      // 头像写入放在配置写成功之后：配置失败时绝不留下"只换了头像"的半提交状态。
      if (draft.avatar.kind === 'replace') {
        const ok = await deps.setAsset(botId, draft.avatar.dataUrl, false);
        if (!ok) return fail(deps.translate('bot.saveFailed'));
        deps.onAvatarChanged?.(botId, draft.avatar.dataUrl);
      } else if (draft.avatar.kind === 'clear') {
        const ok = await deps.setAsset(botId, '', true);
        if (!ok) return fail(deps.translate('bot.saveFailed'));
        deps.onAvatarChanged?.(botId, undefined);
      }
    } catch (error) {
      return fail(deps.describeError(error));
    }

    // 成功：先本地投影，保证"保存后不必等远程回读就不脏"。
    const nextDetail = applyDraftToDetail(detail, draft);
    const nextDrafts = { ...deps.getState().drafts };
    delete nextDrafts[botId];
    // 保存成功即作废在途的能力补全：否则迟到的探活/目录结果会合并进刚投影的新快照，
    // 用旧探活数据覆盖保存后的真值（且此时 status 已回到 idle，原护栏拦不住）。
    detailToken += 1;
    deps.setState({
      status: { status: 'idle', activeBotId: botId },
      activeBotId: botId,
      activeDetail: nextDetail,
      drafts: nextDrafts,
      isBusy: false,
      errorBanner: undefined,
      confirmPending: undefined,
    });
    deps.render();

    deps.notify(deps.translate('bot.saved'));
    deps.onProfilesChanged();
    // 后台刷新花名册与详情：保持 activeBotId，不阻塞保存结果返回。
    void loadRoster(true);
    return { ok: true };
  }

  /** 关闭失败横幅；不触碰草稿与详情。 */
  function dismissError(): void {
    if (!deps.getState().errorBanner) return;
    deps.setState({ errorBanner: undefined });
    deps.render();
  }

  /** 关闭二次确认横幅（"暂不保存"）：草稿与详情原样保留，可以稍后再存。 */
  function dismissConfirm(): void {
    if (!deps.getState().confirmPending) return;
    deps.setState({ confirmPending: undefined });
    deps.render();
  }

  /**
   * 进入面板的幂等入口。
   * 【规则】只有未初始化才拉列表；已有 idle + 详情不重复取数；
   *   列表正在装载或已失败时交给显式重试（onRetryBotList），不在渲染循环里自动重打。
   */
  function ensureLoaded(force = false): void {
    const snapshot = deps.getState();
    const status = snapshot.status.status;
    if (status === 'saving') return;
    if (force) {
      void loadRoster(true);
      return;
    }
    if (status === 'uninitialized') {
      void loadRoster(false);
      return;
    }
    if (status === 'idle' && snapshot.activeDetail) return;
    // 列表已就绪但详情缺失（例如上一次详情失败后被重置）：补一次显式取数。
    if (status === 'idle' && snapshot.activeBotId) {
      selectBot(snapshot.activeBotId, { immediate: true });
    }
  }

  return {
    ensureLoaded,
    loadRoster,
    selectBot,
    updateDraft,
    resetDraft,
    saveBot,
    dismissError,
    dismissConfirm,
  };
}
