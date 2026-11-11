/**
 * 提供商管理编排（自定义端点 / 订阅账号 / 跨 Bot 对账）。
 *
 * 【设计意图 (Why)】
 *   端点配置是 profile 级资源：每个 Bot 有自己的 config.yaml 与 .env。用户的心智却是
 *   "我配了一个端点，想给几个 Bot 用"，所以编排层必须同时支持"只存当前 Bot"与
 *   "保存时扇出到勾选的 Bot"两条路径，并且对后者如实报告每个 Bot 的成败。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 网关的 GET 不回明文密钥，所以带密钥的分发只能在用户手里有明文的那一刻做，
 *      即保存流程内。事后追加到别的 Bot 只能复制定义，密钥要重输。
 *   2. `make_default` 若跟着扇出，一次保存会把所有 Bot 的主模型改成这个端点。
 *      跨 Bot 一律 false。
 *   3. 扇出不是事务。某个 Bot 失败时若静默跳过，用户会以为全部成功；
 *      若自动回滚，又会在故障中叠加写操作。正确做法是逐个执行、逐个报告、可重试。
 *
 * 【约束与规则 (Rules)】
 *   1. 零 DOM、零 React；所有副作用经 deps 注入，便于落盘测试；
 *   2. 每个异步装载带自增令牌，只有最后一次可以写回状态；
 *   3. 失败保留草稿：控制器只返回结果，不替组件清空用户输入。
 */

import {
  deriveEndpointId,
  draftFromEndpoint,
  emptyEndpointDraft,
  normalizeBaseUrl,
  normalizeEndpointId,
  toEndpointPayload,
  validateDraft,
  type CustomEndpointDraft,
  type CustomEndpointPayload,
  type CustomEndpointRow,
  type EndpointProbe,
  type OauthProviderRow,
} from '@hermes-flux/core';
import type { SettingsLoadable } from './settingsController.js';
import type { ProviderAdminRest } from './providerAdminRest.js';
import { describeProviderAdminError } from './providerAdminRest.js';

/** 一个扇出目标的执行结果。 */
export interface FanOutResult {
  profile: string;
  displayName: string;
  ok: boolean;
  message?: string;
}

export interface SaveEndpointOptions {
  /** 目标 Bot 的 profile 名（不含当前 Bot）。 */
  fanOutTo: readonly string[];
  /** 只在当前 Bot 设为默认主模型；扇出目标恒为 false。 */
  makeDefault: boolean;
  /** 已知名称，用于结果回显；缺省回落到 profile 名。 */
  profileDisplayNames?: Readonly<Record<string, string>>;
}

export interface SaveEndpointOutcome {
  /** 当前 Bot 是否写入成功。 */
  currentOk: boolean;
  /** 整次操作的结局：`success` 全成功，`partial` 当前 Bot 成功但扇出有失败，`failed` 当前 Bot 未写入。 */
  overall: 'success' | 'partial' | 'failed';
  id: string;
  /** 当前 Bot 的保存结果。 */
  current: FanOutResult;
  fanOut: FanOutResult[];
  message?: string;
}

/**
 * 从其它成员复制密钥的结果。
 *
 * 【为什么要判别式】"没有可读密钥"与"读取故障"必须分开：
 *   前者应该让用户就地补一次，后者必须把网关原文透出来。
 *   把两者都折成 `needsKey` 会让 500/超时伪装成"请重输密钥"，用户永远看不到真实故障。
 */
export type EndpointKeyResolution =
  | { ok: true; key: string; source: string }
  | { ok: false; reason: 'no-readable-key'; message?: string }
  | { ok: false; reason: 'transport'; message: string };

export interface ProviderAdminControllerDeps {
  rest: ProviderAdminRest;
  render(): void;
  describeError(error: unknown): string;
  getEndpoints(): SettingsLoadable<CustomEndpointRow[]>;
  setEndpoints(value: SettingsLoadable<CustomEndpointRow[]>): void;
  getOauth(): SettingsLoadable<OauthProviderRow[]>;
  setOauth(value: SettingsLoadable<OauthProviderRow[]>): void;
  setBusy(busy: boolean): void;
  notify(message: string): void;
  warn(message: string, meta?: unknown): void;
  /** 当前 Bot 的主模型变化后让输入舱模型目录重新对齐。 */
  onCatalogChanged(): void;
}

export interface ProviderAdminController {
  load(profile: string): Promise<void>;
  probe(draft: CustomEndpointDraft): Promise<EndpointProbe>;
  save(profile: string, draft: CustomEndpointDraft, options: SaveEndpointOptions): Promise<SaveEndpointOutcome>;
  /**
   * 从其它成员复制一条端点的 API Key。
   * 【规则】只在源成员存在、GET 给出 `${ENV_VAR}` 预览且 reveal 返回非空值时成功；
   *   否则返回失败原因，由界面降级为"就地补密钥"。
   */
  resolveEndpointKey(
    id: string,
    sourceProfiles: readonly string[],
  ): Promise<EndpointKeyResolution>;
  /**
   * 把某个 Agent 的主模型切到指定提供商。
   * 【规则】必须点名模型：订阅与自定义端点都走 `/api/model/set`，
   *   这样订阅也能切换（旧的 activate 端点接口只认自定义端点）。
   * 【规则】高价模型网关会要求二次确认且不落盘，这里原样透出 `confirmRequired`，
   *   由界面让用户确认后带 `confirmExpensive` 重发。
   */
  useMainModel(
    profile: string,
    assignment: { provider: string; model: string; baseUrl?: string; confirmExpensive?: boolean },
  ): Promise<{ ok: boolean; message?: string; confirmRequired?: boolean; confirmMessage?: string }>;
  /** 删除端点。`profiles` 给出全部要删的 Agent，逐个执行并如实回报。 */
  remove(profiles: readonly string[], id: string): Promise<{ ok: boolean; message?: string; failed: FanOutResult[] }>;
  loadOauth(profile: string): Promise<void>;
  startLogin(
    profile: string,
    id: string,
  ): Promise<{ ok: boolean; sessionId?: string; userCode?: string; verificationUrl?: string; message?: string }>;
  pollLogin(
    profile: string,
    id: string,
    sessionId: string,
  ): Promise<{ status: 'pending' | 'approved' | 'failed' | 'cancelled'; message?: string }>;
  cancelLogin(profile: string, sessionId: string): Promise<void>;
  logoutOauth(profile: string, id: string): Promise<{ ok: boolean; message?: string }>;
}

interface VersionedLoad {
  token: number;
}

export function createProviderAdminController(deps: ProviderAdminControllerDeps): ProviderAdminController {
  const endpointLoad: VersionedLoad = { token: 0 };
  const oauthLoad: VersionedLoad = { token: 0 };
  let busyDepth = 0;

  async function runBusy<T>(task: () => Promise<T>): Promise<T> {
    busyDepth += 1;
    deps.setBusy(true);
    deps.render();
    try {
      return await task();
    } finally {
      busyDepth = Math.max(0, busyDepth - 1);
      deps.setBusy(busyDepth > 0);
      deps.render();
    }
  }

  async function loadEndpoints(profile: string): Promise<void> {
    const token = ++endpointLoad.token;
    deps.setEndpoints({ status: 'loading' });
    deps.render();
    try {
      const rows = await deps.rest.listEndpoints(profile);
      if (token !== endpointLoad.token) return;
      deps.setEndpoints({ status: 'ready', data: rows });
    } catch (error) {
      if (token !== endpointLoad.token) return;
      deps.setEndpoints({ status: 'error', message: deps.describeError(error) });
    }
    deps.render();
  }

  async function loadOauth(profile: string): Promise<void> {
    const token = ++oauthLoad.token;
    deps.setOauth({ status: 'loading' });
    deps.render();
    try {
      const rows = await deps.rest.listOauthProviders(profile);
      if (token !== oauthLoad.token) return;
      deps.setOauth({ status: 'ready', data: rows });
    } catch (error) {
      if (token !== oauthLoad.token) return;
      deps.setOauth({ status: 'error', message: deps.describeError(error) });
    }
    deps.render();
  }

  async function load(profile: string): Promise<void> {
    await Promise.all([loadEndpoints(profile), loadOauth(profile)]);
  }

  /**
   * 探测端点，不落盘。
   * 【规则】REST 抛错必须收敛成 `warning` 结果：视图侧只认 `EndpointProbe` 三态，
   *   让异常穿透会留下永久 `probePending`，按钮从此不可点。
   */
  async function probe(draft: CustomEndpointDraft): Promise<EndpointProbe> {
    const payload = toEndpointPayload(draft, { id: draft.id || deriveEndpointId(draft.name), makeDefault: false });
    try {
      return await deps.rest.probeEndpoint(payload);
    } catch (error) {
      return { kind: 'warning', message: describeProviderAdminError(error).message };
    }
  }

  /**
   * 保存端点，并按需扇出到其他 Bot。
   * 【规则】当前 Bot 先写；成功后才动其他 Bot，避免把用户的草稿扩散到一堆失败的目标上。
   */
  async function save(profile: string, draft: CustomEndpointDraft, options: SaveEndpointOptions): Promise<SaveEndpointOutcome> {
    const errors = validateDraft(draft);
    // 新建端点必须有明文密钥：GET 不回密钥，先建一个空密钥条目等于制造一条发不出请求的配置。
    // 编辑时留空（keep）合法，表示保留各成员原密钥。
    if (!draft.id.trim() && draft.apiKey.kind !== 'set') errors.push('apiKey');
    if (errors.length > 0) {
      return {
        currentOk: false,
        overall: 'failed',
        id: draft.id,
        current: { profile, displayName: profile, ok: false, message: errors.join(', ') },
        fanOut: [],
      };
    }

    return runBusy(async () => {
      const endpointId = draft.id || deriveEndpointId(draft.name);
      const display = (name: string): string => options.profileDisplayNames?.[name] || name;

      let savedId = endpointId;
      let savedRow: CustomEndpointRow | undefined;
      try {
        const saved = await deps.rest.saveEndpoint(
          profile,
          toEndpointPayload({ ...draft, id: endpointId }, { id: endpointId, makeDefault: options.makeDefault }),
        );
        savedId = saved.id || endpointId;
        savedRow = saved.endpoints.find((row) => row.id === savedId);
      } catch (error) {
        return {
          currentOk: false,
          overall: 'failed',
          id: endpointId,
          current: { profile, displayName: display(profile), ok: false, message: deps.describeError(error) },
          fanOut: [],
        };
      }

      // 扇出体：沿用刚保存的结构，但不改任何目标 Bot 的主模型。
      const fanOutPayload: CustomEndpointPayload = toEndpointPayload(
        { ...draft, id: savedId },
        { id: savedId, makeDefault: false },
      );
      const results: FanOutResult[] = [];
      for (const target of options.fanOutTo) {
        if (target === profile) continue;
        try {
          await deps.rest.saveEndpoint(target, fanOutPayload);
          results.push({ profile: target, displayName: display(target), ok: true });
        } catch (error) {
          results.push({ profile: target, displayName: display(target), ok: false, message: deps.describeError(error) });
          // 逐个执行、失败即停：继续写只会扩大不一致面，用户需要先看清原因。
          break;
        }
      }

      await loadEndpoints(profile);
      if (options.makeDefault || savedRow?.isCurrent) deps.onCatalogChanged();

      const failed = results.find((item) => !item.ok);
      if (failed) deps.warn('providerAdmin.fanOut.stopped', { profile: failed.profile, message: failed.message });

      return {
        currentOk: true,
        overall: failed ? 'partial' : 'success',
        id: savedId,
        current: { profile, displayName: display(profile), ok: true },
        fanOut: results,
      };
    });
  }

  /**
   * 从其它成员复制一条端点的 API Key。
   *
   * 【设计意图 (Why)】
   *   用户取消某个 Agent 的绑定后再勾回来，不该被要求重新输入同一把密钥。
   *   同一条端点通常还留在别的成员上，网关的 GET 会给出 `key_env` 的 `${VAR}` 预览，
   *   `/api/env/reveal` 可以按这个变量名把明文读出来，再随保存写进目标成员。
   *   这比"客户端自己保存明文"安全，也比"让用户重输"省事。
   *
   * 【防范的历史坑 (Pitfall)】
   *   1. 旧版把所有非明文预览（脱敏串）都当成可复制的密钥，结果把一串掩码写进 `.env`，
   *      端点看起来配好了，实际每次请求都 401。只接受严格的 `${ENV_VAR}` 形态。
   *   2. reveal 会让明文短暂进入内存；这里绝不打日志、绝不回显、绝不写本地存储。
   *   3. 源 profile 的顺序就是成员的配置顺序；第一个可读的胜出，失败继续找下一个，
   *      不能因为某个成员缺密钥就整体放弃。
   */
  async function resolveEndpointKey(
    id: string,
    sourceProfiles: readonly string[],
  ): Promise<EndpointKeyResolution> {
    const targetId = normalizeEndpointId(id);
    const sources = [...new Set(sourceProfiles.map((profile) => profile.trim()).filter(Boolean))];
    let lastMessage = 'noSource';
    for (const source of sources) {
      let rows: CustomEndpointRow[];
      try {
        rows = await deps.rest.listEndpoints(source);
      } catch (error) {
        // 成员清单都读不到，不能继续猜；这是读取故障，不是"没有可读密钥"。
        return { ok: false, reason: 'transport', message: deps.describeError(error) };
      }
      const row = rows.find((item) => normalizeEndpointId(item.id) === targetId);
      if (!row || !row.hasApiKey) {
        lastMessage = 'keyMissing';
        continue;
      }
      // GET 对 `key_env` 返回 `${VAR}`；脱敏预览（`sk-…abcd`）无法反推，不能当密钥。
      const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(row.apiKeyPreview || '');
      if (!match) {
        lastMessage = 'unreadable';
        continue;
      }
      try {
        const value = (await deps.rest.revealEnv(source, match[1])).trim();
        if (value) return { ok: true, key: value, source };
        lastMessage = 'empty';
      } catch (error) {
        const { status, message } = describeProviderAdminError(error);
        // 404 = 变量不在该 profile 的 .env 里。这不是故障，用户手填即可解决。
        if (status !== 404) {
          return { ok: false, reason: 'transport', message: message || deps.describeError(error) };
        }
        lastMessage = 'keyMissing';
      }
    }
    return { ok: false, reason: 'no-readable-key', message: lastMessage };
  }

  async function useMainModel(
    profile: string,
    assignment: { provider: string; model: string; baseUrl?: string; confirmExpensive?: boolean },
  ): Promise<{ ok: boolean; message?: string; confirmRequired?: boolean; confirmMessage?: string }> {
    if (!assignment.model.trim()) {
      // 没有模型列表的提供商不能切换：网关对空模型回 400，与其让用户看到一句
      // 看不懂的报错，不如在这里说清楚"这个提供商没有可用模型"。
      return { ok: false, message: 'noModels' };
    }
    return runBusy(async () => {
      try {
        const result = await deps.rest.setMainModel(profile, assignment);
        if (result.confirmRequired) {
          // 网关明确说"没落盘，请确认"。绝不能当成功返回。
          return {
            ok: false,
            confirmRequired: true,
            confirmMessage: result.confirmMessage,
            message: result.confirmMessage,
          };
        }
        deps.onCatalogChanged();
        return { ok: true, message: `${result.provider} · ${result.model}` };
      } catch (error) {
        return { ok: false, message: deps.describeError(error) };
      }
    });
  }

  /**
   * 删除端点：对每个真的有它的 Agent 各删一次。
   * 【设计意图】用户看到的是**一行**提供商，删除就该是**整体删除**。
   *   只删当前作用域那一个，列表里这行还在（别的 Agent 还配着），用户会认为按钮没生效。
   * 【规则】逐个执行、全部尝试，最后汇总失败项；不做事务、不自动回滚。
   */
  async function remove(
    profiles: readonly string[],
    id: string,
  ): Promise<{ ok: boolean; message?: string; failed: FanOutResult[] }> {
    const targets = [...new Set(profiles.filter(Boolean))];
    if (targets.length === 0) return { ok: false, message: 'noTargets', failed: [] };
    return runBusy(async () => {
      const failed: FanOutResult[] = [];
      for (const profile of targets) {
        try {
          await deps.rest.deleteEndpoint(profile, id);
        } catch (error) {
          failed.push({ profile, displayName: profile, ok: false, message: deps.describeError(error) });
        }
      }
      deps.onCatalogChanged();
      if (failed.length === 0) return { ok: true, failed: [] };
      const first = failed[0];
      // 部分失败不等于成功：调用方据此决定是否提示"已删除"。
      // 之前写成 `failed.length < targets.length`，于是 1 成 1 败也会报成功，
      // 用户看到"已删除"但行还在，且失败名单被丢掉。
      return {
        ok: false,
        message: `${first.displayName}: ${first.message}`,
        failed,
      };
    });
  }

  /**
   * 发起订阅登录。
   * 【规则】必须在用户点击的那一刻就把 profile 定下来：登录态是按 profile 分开落的，
   *   会话一旦以错的 profile 启动，令牌会被签进另一个 Bot。
   */
  async function startLogin(
    profile: string,
    id: string,
  ): Promise<{ ok: boolean; sessionId?: string; userCode?: string; verificationUrl?: string; message?: string }> {
    try {
      const session = await deps.rest.startOauthLogin(profile, id);
      if (!session.ok) return { ok: false, message: session.message || session.cliCommand || '' };
      return {
        ok: true,
        sessionId: session.sessionId,
        userCode: session.userCode,
        verificationUrl: session.verificationUrl,
      };
    } catch (error) {
      return { ok: false, message: deps.describeError(error) };
    }
  }

  async function pollLogin(
    profile: string,
    id: string,
    sessionId: string,
  ): Promise<{ status: 'pending' | 'approved' | 'failed' | 'cancelled'; message?: string }> {
    try {
      const poll = await deps.rest.pollOauthLogin(profile, id, sessionId);
      return { status: poll.status, message: poll.message };
    } catch (error) {
      // 轮询失败不等于登录失败：网络抖动时下一轮会再问一次。
      // 但也不能静默——把原因带给界面，由它决定是否继续等。
      return { status: 'pending', message: deps.describeError(error) };
    }
  }

  async function cancelLogin(profile: string, sessionId: string): Promise<void> {
    try {
      await deps.rest.cancelOauthLogin(profile, sessionId);
    } catch (error) {
      deps.warn('providerAdmin.oauth.cancelFailed', { message: deps.describeError(error) });
    }
  }

  /** 退出订阅登录。断开失败必须如实报告，不做"看起来成功了"的乐观更新。 */
  async function logoutOauth(profile: string, id: string): Promise<{ ok: boolean; message?: string }> {
    return runBusy(async () => {
      try {
        await deps.rest.disconnectOauth(profile, id);
        deps.onCatalogChanged();
        await loadOauth(profile);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: deps.describeError(error) };
      }
    });
  }

  return {
    load,
    probe,
    save,
    resolveEndpointKey,
    useMainModel,
    remove,
    loadOauth,
    startLogin,
    pollLogin,
    cancelLogin,
    logoutOauth,
  };
}

/**
 * 删除动作的作用域解析。
 *
 * 【设计意图 (Why)】
 *   删除是有破坏性的写操作，目标 Bot 必须在**用户点下删除按钮的那一刻**锁定。
 *   早期实现把 `scopedProfileName()` 放在二次确认弹窗的回调里求值：用户确认期间
 *   在头像条上切了 Bot，就会删掉另一个 Bot 的端点（真实竞态，不是理论风险）。
 *
 * 【约束与规则 (Rules)】
 *   1. 纯函数，便于落盘测试；调用方只在打开弹窗的瞬间调一次；
 *   2. 返回的 profile 就是最终执行删除的 profile，弹窗文案也必须用它，
 *      保证"用户看到的 Bot"与"实际被删的 Bot"是同一个。
 */
export function planDeleteTarget(
  profileAtOpen: string,
  displayNameAtOpen: string,
): { profile: string; displayName: string } {
  return { profile: profileAtOpen, displayName: displayNameAtOpen || profileAtOpen };
}

/** 视图侧的唯一草稿工厂：从行还原，密钥恒为"保留"。 */
export function endpointDraftFromRow(row: CustomEndpointRow): CustomEndpointDraft {
  return draftFromEndpoint(row);
}

/** 新建端点的空白草稿（core 定义，这里 re-export 保持 host 侧导入稳定）。 */
export { emptyEndpointDraft };

/** 供 UI 判断是否需要提示端点地址规整。 */
export function endpointBaseUrlDiffers(draftUrl: string, resolved?: string): boolean {
  if (!resolved) return false;
  return normalizeBaseUrl(resolved) !== normalizeBaseUrl(draftUrl);
}
