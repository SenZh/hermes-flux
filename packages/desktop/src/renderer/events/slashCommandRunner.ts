/**
 * 斜杠命令分派与执行器 (Slash Command Runner · D6)
 *
 * 【设计意图 (Why)】
 *   将输入舱中的斜杠指令解析、别名归一（resolveCommandAlias）、
 *   执行中常驻反馈、成功/失败提示以及会话消息刷新逻辑从 inputDockController 中独立拆分，
 *   使单文件严格维持在 1500 行上限以内，并提供清晰的命令执行生命周期。
 *
 * 【防范的历史坑 (Pitfall)】
 *   1. /compact 是网关已知 Python 崩溃点，必须经 resolveCommandAlias 归一为 /compress；
 *   2. 执行中必须第一时间给出进度反馈，不能在 await 期间让用户感知到死寂；
 *   3. 错误捕获严禁硬编码前缀为 '网关未连接'，必须区分真实 RPC 报错并触发视图更新；
 *   4. /compress 执行成功后必须重拉会话消息以更新交接压缩微胶囊。
 *
 * 【约束与规则 (Rules)】
 *   - 0 TS 报错，严禁 as any；
 *   - 所有文案走 t() 字典。
 */

import type { I18nKey } from '@hermes-flux/ui';
import type { IRpcCaller, InteractiveService } from '@hermes-flux/core';
import {
  resolveCommandAlias,
  normalizeCommandName,
  UNIVERSAL_DESKTOP_EXCLUDED,
  BOT_SESSION_EXCLUDED,
  GROUP_ROOM_EXCLUDED,
  getEffectiveExcludedCommands,
} from '../slashVisibility.js';

export interface SlashCommandRunnerDeps {
  readonly ensureLiveSessionId?: () => Promise<string | null>;
  readonly getRpcCaller?: () => IRpcCaller;
  readonly interactiveService?: InteractiveService;
  readonly getSlashCanon?: () => Record<string, string> | undefined;
  readonly getProfileName?: () => string | undefined;
  readonly getActiveSessionId?: () => string | undefined;
  readonly getSessionKind?: () => string | undefined;
  readonly setTimedDockNotice?: (msg: string, durationMs?: number) => void;
  readonly requestRender: () => void;
  readonly sendMessage?: (text: string) => Promise<void>;
  readonly reloadSessionMessages?: (sessionId: string) => Promise<void>;
  readonly describeRpcError?: (err: unknown) => string;
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string;
}

export async function dispatchSlashCommand(
  rawCommand: string,
  deps: SlashCommandRunnerDeps,
): Promise<void> {
  const liveId = deps.ensureLiveSessionId ? await deps.ensureLiveSessionId() : null;
  if (!liveId) {
    if (deps.setTimedDockNotice) {
      deps.setTimedDockNotice(deps.t('chat.forkNoLive'));
    }
    deps.requestRender();
    return;
  }

  const interactive = deps.interactiveService;
  const rpc = deps.getRpcCaller ? deps.getRpcCaller() : null;
  if (!interactive || !rpc) return;

  // 1. 本地别名归一：防范网关服务端别名派发崩溃（如 /compact -> /compress）
  const command = resolveCommandAlias(rawCommand, deps.getSlashCanon ? deps.getSlashCanon() : undefined);
  const mainCmd = command.trim().split(/\s+/)[0] || '';
  const bareCmd = normalizeCommandName(mainCmd).toLowerCase();

  const sessionKind = deps.getSessionKind ? deps.getSessionKind() : undefined;
  const isGroup = sessionKind === 'group_room' || sessionKind === 'group';
  const isBot = sessionKind === 'bot_forever_chat' || sessionKind === 'bot';

  // 1.1 三层黑名单拦截：先命中模式专属原因提示，再命中通用桌面黑名单
  if (isGroup && GROUP_ROOM_EXCLUDED.has(bareCmd)) {
    if (deps.setTimedDockNotice) {
      deps.setTimedDockNotice(deps.t('dock.cmdNotSupportedInGroup'), 4000);
    }
    deps.requestRender();
    return;
  }

  if (isBot && BOT_SESSION_EXCLUDED.has(bareCmd)) {
    if (deps.setTimedDockNotice) {
      deps.setTimedDockNotice(deps.t('dock.cmdNotSupportedInBot'), 4000);
    }
    deps.requestRender();
    return;
  }

  const effectiveExcluded = getEffectiveExcludedCommands({ sessionKind });
  if (effectiveExcluded.has(bareCmd)) {
    if (deps.setTimedDockNotice) {
      deps.setTimedDockNotice(deps.t('dock.cmdExcludedOnDesktop', { cmd: mainCmd }), 4000);
    }
    deps.requestRender();
    return;
  }

  // 2. 及时提供执行中反馈（持续常驻，直至返回或出错被覆盖），消除用户“发出去毫无反应”的困惑
  if (deps.setTimedDockNotice) {
    if (mainCmd === '/compress') {
      deps.setTimedDockNotice(deps.t('dock.compressExecuting'), 0);
    } else {
      deps.setTimedDockNotice(deps.t('dock.cmdExecuting', { cmd: mainCmd }), 0);
    }
  }
  deps.requestRender();

  try {
    const timeoutOverride = mainCmd === '/compress' ? 120_000 : undefined;
    const res = await interactive.execSlash(
      rpc,
      liveId,
      command,
      deps.getProfileName ? deps.getProfileName() : undefined,
      timeoutOverride,
    );
    const type = res.type || 'exec';
    if (type === 'prefill') {
      if (typeof document !== 'undefined') {
        const el = document.getElementById('dock-prompt-input') as HTMLTextAreaElement | null;
        if (el) el.value = res.target || res.message || '';
      }
      if (deps.setTimedDockNotice) {
        deps.setTimedDockNotice(res.display || res.notice || '', 4000);
      }
      deps.requestRender();
      return;
    }
    if (type === 'send' || type === 'skill') {
      if (deps.setTimedDockNotice) {
        deps.setTimedDockNotice('', 0);
      }
      const text = res.message || res.output;
      if (text && deps.sendMessage) {
        await deps.sendMessage(text);
      }
      return;
    }
    if (type === 'alias') {
      if (res.target) await dispatchSlashCommand(res.target, deps);
      return;
    }

    // 3. 结果反馈：针对 /compress 等无输出成功指令给予明确的完成提示
    let out = res.output || res.warning || '';
    if (!out || out.trim() === '(no output)') {
      if (mainCmd === '/compress') {
        out = deps.t('dock.compressCompleted');
      } else {
        out = res.display || deps.t('dock.cmdExecuted', { cmd: mainCmd });
      }
    }

    if (deps.setTimedDockNotice) {
      deps.setTimedDockNotice(out, 5000);
    }

    // 4. 若为会话上下文压缩指令，完成后自动重拉会话消息，刷新前端交接胶囊
    if (mainCmd === '/compress' && !command.includes('--preview') && !command.includes('--dry-run')) {
      const storedId = deps.getActiveSessionId ? deps.getActiveSessionId() : undefined;
      if (storedId && deps.reloadSessionMessages) {
        void deps.reloadSessionMessages(storedId);
      }
    }

    deps.requestRender();
  } catch (err) {
    const errMsg = deps.describeRpcError ? deps.describeRpcError(err) : String(err);
    if (deps.setTimedDockNotice) {
      deps.setTimedDockNotice(deps.t('dock.cmdFailed', { cmd: mainCmd, error: errMsg }), 6000);
    }
    deps.requestRender();
  }
}
