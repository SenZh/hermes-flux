/**
 * 设置中心业务编排（可注入依赖的纯控制器）。
 *
 * 【设计意图 (Why)】
 *   设置页的"界面"与"取数编排"必须分开：页面只消费快照，编排只负责
 *   "什么时候打网关、失败落到哪个状态、并发时谁说了算"。
 *   把编排放在这里而不是直接写进 renderer，是为了能对失败态、并发交错、
 *   幂等刷新做真实的落盘行为测试——这些分支用 grep 源码是测不出来的。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. 旧实现把 `loadProviders / saveKey / reloadSkills` 全写在 5000 行 renderer 里，
 *      唯一"测试"是断言源码里出现过方法名字符串，改错逻辑也不会变红。
 *   2. 保存密钥失败时曾把整张提供商表替换成错误页，用户刚输入的草稿随组件一起丢失。
 *   3. `settingsBusy` 是单个布尔，两个 provider 并发保存时先完成的那个会把忙态清零，
 *      后一个请求的进度条与禁用态就此失效。
 *
 * 【约束与规则 (Rules)】
 *   - 本模块零 DOM、零 React、零全局状态；所有状态读写与副作用经 `deps` 注入；
 *   - 每次异步装载带自增令牌，只有最后发起的请求可以写回状态（后发先至以最后一次为准）；
 *   - 保存/断开失败只返回结果给行级 UI，绝不把整表替换成错误态；
 *   - `reload.env` 失败不影响已落盘的密钥，但必须显式记录，禁止静默。
 */

import {
  buildProviderDirectory,
  buildMcpServerRows,
  buildSkillRows,
  normalizeAgentProfile,
  type McpServerRow,
  type ProviderDirectoryRow,
  type SkillRow,
} from '@hermes-flux/core';

/** 四态可加载值：显式区分"还没请求""加载中""有数据""失败"。 */
export type SettingsLoadable<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

export interface SettingsProfileRow {
  name: string;
  displayName: string;
  model?: string;
  description?: string;
  isDefault?: boolean;
}

export type SettingsSectionId = 'appearance' | 'providers' | 'agents' | 'extensions' | 'connection' | 'about';

export interface SettingsOperationResult {
  ok: boolean;
  message?: string;
  /** 用户主动取消（例如断开确认框点了取消）不是错误。 */
  cancelled?: boolean;
}

/** 控制器只消费这几个字典键；用字面量联合避免把 i18n key 退化成 string。 */
export type SettingsI18nKey =
  | 'settings.loadFailed'
  | 'settings.notConnected'
  | 'settings.malformedResponse'
  | 'settings.skillsReloaded';

/** 编排需要的最小外部能力集合；renderer 用真实实现，测试用假实现。 */
export interface SettingsControllerDeps {
  isConnected(): boolean;
  profileName(): string;
  currentProvider(): string;
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  render(): void;
  translate(key: SettingsI18nKey): string;
  describeError(error: unknown): string;

  getProviders(): SettingsLoadable<ProviderDirectoryRow[]>;
  setProviders(value: SettingsLoadable<ProviderDirectoryRow[]>): void;
  getProfiles(): SettingsLoadable<SettingsProfileRow[]>;
  setProfiles(value: SettingsLoadable<SettingsProfileRow[]>): void;
  getMcp(): SettingsLoadable<McpServerRow[]>;
  setMcp(value: SettingsLoadable<McpServerRow[]>): void;
  getSkills(): SettingsLoadable<SkillRow[]>;
  setSkills(value: SettingsLoadable<SkillRow[]>): void;

  /** 忙态：壳层只负责把布尔映射到界面，计数由控制器统一维护。 */
  setBusy(busy: boolean): void;
  /** 密钥变更后让输入舱模型目录重新对齐网关真实状态。 */
  onCatalogChanged(): void;
  /** 用户可见的成功提示（toast）。 */
  notify(message: string): void;
  /** 可观测的降级记录（例如 reload.env 失败）。 */
  warn(message: string, meta?: unknown): void;
}

/** 表单留空 = 沿用已保存的密码；非空则覆盖。 */
export function resolveGatewayPassword(draftPassword: string, previousPassword: string): string {
  return draftPassword.trim() ? draftPassword : previousPassword;
}

export interface SettingsController {
  loadProviders(): Promise<void>;
  loadProfiles(): Promise<void>;
  loadExtensions(): Promise<void>;
  ensureSection(section: SettingsSectionId, force?: boolean): void;
  saveProviderKey(slug: string, apiKey: string): Promise<SettingsOperationResult>;
  disconnectProvider(slug: string): Promise<SettingsOperationResult>;
  reloadSkills(): Promise<SettingsOperationResult>;
  /** 让设置页内其它异步操作（如连通性测试）共享同一份忙态计数。 */
  runBusy<T>(task: () => Promise<T>): Promise<T>;
}

interface VersionedLoad {
  token: number;
}

/**
 * 构造设置编排控制器。
 * 同一 deps 生命周期内只构造一次；每次 load 的自增令牌保存在闭包里。
 */
export function createSettingsController(deps: SettingsControllerDeps): SettingsController {
  const providerLoad: VersionedLoad = { token: 0 };
  const profileLoad: VersionedLoad = { token: 0 };
  const extensionLoad: VersionedLoad = { token: 0 };
  let busyDepth = 0;

  const beginBusy = (): void => {
    busyDepth += 1;
    deps.setBusy(true);
  };
  const endBusy = (): void => {
    busyDepth = Math.max(0, busyDepth - 1);
    deps.setBusy(busyDepth > 0);
  };

  /**
   * 统一忙态执行器：设置页内所有"会让控件禁用"的异步操作必须走这里。
   * renderer 的连通性测试也复用它，禁止再直接写 settingsBusy（双真值会互相清零）。
   */
  async function runBusy<T>(task: () => Promise<T>): Promise<T> {
    beginBusy();
    try {
      deps.render();
      return await task();
    } finally {
      endBusy();
      deps.render();
    }
  }

  const disconnectedMessage = (): string => deps.translate('settings.notConnected');

  async function loadProviders(): Promise<void> {
    const token = ++providerLoad.token;
    if (!deps.isConnected()) {
      deps.setProviders({ status: 'error', message: disconnectedMessage() });
      deps.render();
      return;
    }
    deps.setProviders({ status: 'loading' });
    deps.render();
    try {
      const payload = await deps.call('model.options', {
        profile: deps.profileName() || 'default',
        include_unconfigured: true,
      });
      if (token !== providerLoad.token) return;
      // 协议成功但形状不符 ≠ 没有提供商：必须显式失败，不得伪装成空列表。
      const providers = payload && typeof payload === 'object' ? (payload as { providers?: unknown }).providers : undefined;
      if (!Array.isArray(providers)) throw new Error(deps.translate('settings.malformedResponse'));
      deps.setProviders({ status: 'ready', data: buildProviderDirectory(payload, deps.currentProvider()) });
    } catch (error) {
      if (token !== providerLoad.token) return;
      deps.setProviders({ status: 'error', message: deps.describeError(error) });
    }
    deps.render();
  }

  async function loadProfiles(): Promise<void> {
    const token = ++profileLoad.token;
    if (!deps.isConnected()) {
      deps.setProfiles({ status: 'error', message: disconnectedMessage() });
      deps.render();
      return;
    }
    deps.setProfiles({ status: 'loading' });
    deps.render();
    try {
      const result = await deps.call<{ profiles?: unknown[] }>('profiles.list', {});
      if (token !== profileLoad.token) return;
      // 形状不符必须显式失败：把 null 当成"没有员工"会让用户以为花名册被清空。
      if (!result || typeof result !== 'object' || !Array.isArray(result.profiles)) {
        throw new Error(deps.translate('settings.malformedResponse'));
      }
      const rows = result.profiles
        // 数组元素畸变（null / 数字 / 嵌套数组）不得被归一化成"默认员工"。
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
        .map(normalizeAgentProfile);
      deps.setProfiles({
        status: 'ready',
        data: rows.map((profile) => ({
          name: profile.name,
          displayName: profile.displayName || profile.name,
          model: profile.model || undefined,
          description: profile.description || undefined,
          isDefault: profile.isDefault === true,
        })),
      });
    } catch (error) {
      if (token !== profileLoad.token) return;
      deps.setProfiles({ status: 'error', message: deps.describeError(error) });
    }
    deps.render();
  }

  async function loadExtensions(): Promise<void> {
    const token = ++extensionLoad.token;
    if (!deps.isConnected()) {
      const failed = { status: 'error' as const, message: disconnectedMessage() };
      deps.setMcp(failed);
      deps.setSkills(failed);
      deps.render();
      return;
    }
    deps.setMcp({ status: 'loading' });
    deps.setSkills({ status: 'loading' });
    deps.render();

    const profile = deps.profileName() || 'default';
    const [mcp, skills] = await Promise.allSettled([
      deps.call('mcp.servers.status', { profile }),
      deps.call('skills.manage', { profile, action: 'list' }),
    ]);
    if (token !== extensionLoad.token) return;

    // 协议成功但形状不符必须显式失败：把畸形响应伪装成空列表，用户会以为
    // "确实没有 MCP / 技能"，而不是"网关出问题了"（Failure Is Not Empty）。
    deps.setMcp(toMcpState(mcp));
    deps.setSkills(toSkillsState(skills));
    deps.render();
  }

  /** MCP 响应形状守卫：`servers` 必须是数组。 */
  function toMcpState(result: PromiseSettledResult<unknown>): SettingsLoadable<McpServerRow[]> {
    if (result.status === 'rejected') return { status: 'error', message: deps.describeError(result.reason) };
    const servers = result.value && typeof result.value === 'object'
      ? (result.value as { servers?: unknown }).servers
      : undefined;
    if (!Array.isArray(servers)) return { status: 'error', message: deps.translate('settings.malformedResponse') };
    return { status: 'ready', data: buildMcpServerRows(result.value) };
  }

  /** 技能响应形状守卫：`skills` 必须是对象，或退化为 `items` 数组（browse 形状）。 */
  function toSkillsState(result: PromiseSettledResult<unknown>): SettingsLoadable<SkillRow[]> {
    if (result.status === 'rejected') return { status: 'error', message: deps.describeError(result.reason) };
    const root = result.value && typeof result.value === 'object' ? (result.value as { skills?: unknown; items?: unknown }) : null;
    const hasMap = Boolean(root && root.skills && typeof root.skills === 'object' && !Array.isArray(root.skills));
    const hasItems = Boolean(root && Array.isArray(root.items));
    if (!hasMap && !hasItems) return { status: 'error', message: deps.translate('settings.malformedResponse') };
    return { status: 'ready', data: buildSkillRows(result.value) };
  }

  function ensureSection(section: SettingsSectionId, force = false): void {
    if (section === 'providers' && (force || deps.getProviders().status === 'idle')) void loadProviders();
    if (section === 'agents' && (force || deps.getProfiles().status === 'idle')) void loadProfiles();
    // 扩展域有两个独立数据源；只要有一个不是 ready（含单边 error），就允许重试。
    if (
      section === 'extensions' &&
      (force || deps.getMcp().status !== 'ready' || deps.getSkills().status !== 'ready')
    ) {
      void loadExtensions();
    }
  }

  async function saveProviderKey(slug: string, apiKey: string): Promise<SettingsOperationResult> {
    if (!deps.isConnected()) return { ok: false, message: disconnectedMessage() };
    return runBusy(async () => {
      try {
        await deps.call('model.save_key', { slug, api_key: apiKey });
        try {
          await deps.call('reload.env', {});
        // gate-degrade: 环境热重载失败不影响已落盘的密钥，下一轮刷新会读到新凭据
        } catch (error) {
          deps.warn('reload.env failed after model.save_key', { error: deps.describeError(error) });
        }
        await loadProviders();
        deps.onCatalogChanged();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: deps.describeError(error) };
      }
    });
  }

  async function disconnectProvider(slug: string): Promise<SettingsOperationResult> {
    if (!deps.isConnected()) return { ok: false, message: disconnectedMessage() };
    return runBusy(async () => {
      try {
        await deps.call('model.disconnect', { slug });
        await loadProviders();
        deps.onCatalogChanged();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: deps.describeError(error) };
      }
    });
  }

  async function reloadSkills(): Promise<SettingsOperationResult> {
    if (!deps.isConnected()) return { ok: false, message: disconnectedMessage() };
    return runBusy(async () => {
      try {
        await deps.call('skills.reload', { profile: deps.profileName() || 'default' });
        await loadExtensions();
        deps.notify(deps.translate('settings.skillsReloaded'));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: deps.describeError(error) };
      }
    });
  }

  return { loadProviders, loadProfiles, loadExtensions, ensureSection, saveProviderKey, disconnectProvider, reloadSkills, runBusy };
}
