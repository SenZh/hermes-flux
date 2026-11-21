/**
 * 斜杠命令分派器单元测试（Slash Command Runner Unit Test）
 *
 * 【断言】
 *   1. 桌面端通用排除命令（如 /mouse, /new, /help, /status）在分派时被直接拦截，
 *      触发 dock.cmdExcludedOnDesktop 提示，绝不向网络层发起 execSlash；
 *   2. 群聊模式下专有拦截单会话指令（如 /compress, /plan），触发 dock.cmdNotSupportedInGroup；
 *   3. Bot 终身主工位模式下专有拦截生命周期破坏指令（如 /handoff, /delete），触发 dock.cmdNotSupportedInBot；
 *   4. /compact 别名能够被自动归一为 /compress 并向 interactiveService 发起调用，且超时覆盖为 120 秒；
 *   5. 普通会话下的核心可用命令（如 /plan）正常放行并调用 execSlash；
 *   6. 无有效 liveSessionId 时安全中断并给出提示。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { dispatchSlashCommand } from '../../dist/renderer/events/slashCommandRunner.mjs';

function createMockDeps(overrides = {}) {
  const notices = [];
  const execCalls = [];
  let rendered = 0;

  const interactive = {
    async execSlash(rpc, liveId, command, profileName, timeoutOverride) {
      execCalls.push({ rpc, liveId, command, profileName, timeoutOverride });
      return { type: 'exec', output: 'ok' };
    },
  };

  const deps = {
    ensureLiveSessionId: async () => 'sess-live-123',
    getRpcCaller: () => ({ request: async () => ({}) }),
    interactiveService: interactive,
    getSlashCanon: () => ({ '/compact': '/compress' }),
    getProfileName: () => 'default',
    getActiveSessionId: () => 'sess-live-123',
    getSessionKind: () => 'scratchpad',
    setTimedDockNotice: (msg, duration) => {
      notices.push({ msg, duration });
    },
    requestRender: () => {
      rendered++;
    },
    sendMessage: async () => {},
    reloadSessionMessages: async () => {},
    describeRpcError: (err) => String(err?.message || err),
    t: (key, params) => {
      if (params?.cmd) return `[${key}:${params.cmd}]`;
      return `[${key}]`;
    },
    ...overrides,
  };

  return { deps, notices, execCalls, getRenderCount: () => rendered };
}

test('slashCommandRunner：桌面端通用排除命令拦截', async () => {
  const { deps, notices, execCalls, getRenderCount } = createMockDeps();

  // 1. 测试 /mouse（纯终端 TUI 命令）
  await dispatchSlashCommand('/mouse', deps);
  assert.equal(execCalls.length, 0, '排除命令 /mouse 绝不调用 execSlash');
  assert.equal(notices[0].msg, '[dock.cmdExcludedOnDesktop:/mouse]');
  assert.equal(notices[0].duration, 4000);
  assert.ok(getRenderCount() >= 1, '必须触发视图渲染');

  // 2. 测试 /new（GUI 已有新建会话按钮，手敲多余）
  await dispatchSlashCommand('/new', deps);
  assert.equal(execCalls.length, 0, '排除命令 /new 绝不调用 execSlash');
  assert.equal(notices[1].msg, '[dock.cmdExcludedOnDesktop:/new]');

  // 3. 测试 /help 与 /status（在桌面端失效或冗余）
  await dispatchSlashCommand('/help', deps);
  assert.equal(execCalls.length, 0, '排除命令 /help 绝不调用 execSlash');
  assert.equal(notices[2].msg, '[dock.cmdExcludedOnDesktop:/help]');

  await dispatchSlashCommand('/status', deps);
  assert.equal(execCalls.length, 0, '排除命令 /status 绝不调用 execSlash');
  assert.equal(notices[3].msg, '[dock.cmdExcludedOnDesktop:/status]');
});

test('slashCommandRunner：群聊模式与 Bot 工位模式专属拦截', async () => {
  // 1. 群聊模式下执行单会话指令 /compress 与 /plan
  const groupSession = createMockDeps({
    getSessionKind: () => 'group_room',
  });
  await dispatchSlashCommand('/compress', groupSession.deps);
  assert.equal(groupSession.execCalls.length, 0);
  assert.equal(groupSession.notices[0].msg, '[dock.cmdNotSupportedInGroup]');

  await dispatchSlashCommand('/plan 重构服务', groupSession.deps);
  assert.equal(groupSession.execCalls.length, 0);
  assert.equal(groupSession.notices[1].msg, '[dock.cmdNotSupportedInGroup]');

  // 2. Bot 终身主工位模式下执行交接与删除
  const botSession = createMockDeps({
    getSessionKind: () => 'bot_forever_chat',
  });
  await dispatchSlashCommand('/handoff', botSession.deps);
  assert.equal(botSession.execCalls.length, 0);
  assert.equal(botSession.notices[0].msg, '[dock.cmdNotSupportedInBot]');

  await dispatchSlashCommand('/delete', botSession.deps);
  assert.equal(botSession.execCalls.length, 0);
  assert.equal(botSession.notices[1].msg, '[dock.cmdNotSupportedInBot]');
});

test('slashCommandRunner：/compact 别名归一为 /compress 与 120s 超时', async () => {
  const { deps, notices, execCalls } = createMockDeps({
    getSessionKind: () => 'scratchpad',
  });

  await dispatchSlashCommand('/compact', deps);
  assert.equal(execCalls.length, 1, '普通会话下必须调用 execSlash');
  assert.equal(execCalls[0].command, '/compress', '必须归一为 /compress');
  assert.equal(execCalls[0].timeoutOverride, 120000, '必须配置 120 秒超时');
  assert.ok(notices.some((n) => n.msg.includes('compressExecuting')), '必须提供执行中反馈');
});

test('slashCommandRunner：普通会话核心可用命令放行', async () => {
  const { deps, execCalls } = createMockDeps({
    getSessionKind: () => 'scratchpad',
  });

  await dispatchSlashCommand('/plan 重构服务', deps);
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0].command, '/plan 重构服务');

  await dispatchSlashCommand('/goal 达成目标', deps);
  assert.equal(execCalls.length, 2);
  assert.equal(execCalls[1].command, '/goal 达成目标');
});

test('slashCommandRunner：无活跃会话时优雅拦截', async () => {
  const { deps, notices, execCalls } = createMockDeps({
    ensureLiveSessionId: async () => null,
  });

  await dispatchSlashCommand('/compress', deps);
  assert.equal(execCalls.length, 0, '无会话时不发起调用');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].msg, '[chat.forkNoLive]');
});
