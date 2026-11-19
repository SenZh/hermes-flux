import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AgentPresence } from '@hermes-flux/ui';
import { createPresenceController } from '../../dist/renderer/events/presenceController.mjs';

const uiRequire = createRequire(new URL('../../../ui/package.json', import.meta.url));
const React = uiRequire('react');
const { renderToStaticMarkup } = uiRequire('react-dom/server');

function renderPresenceHtml(snapshot) {
  return renderToStaticMarkup(React.createElement(AgentPresence, { snapshot }));
}

function createHarness(overrides = {}) {
  const state = {
    activeFocus: { type: 'bot', botName: 'bot-a' },
    activeSessionId: 'sess-a',
    messages: [],
    sideAgentCapsules: [],
    presenceTerminal: null,
    turnStartedAt: undefined,
    profiles: [
      { name: 'bot-a', displayName: 'Bot A', avatar: 'data:image/png;base64,bot-a' },
      { name: 'bot-b', displayName: 'Bot B', avatar: 'data:image/png;base64,bot-b' },
    ],
    sessions: [
      { id: 'sess-a', botName: 'bot-a', botDisplayName: 'Bot A', botAvatar: 'data:image/png;base64,bot-a' },
    ],
    groupRooms: [
      { roomId: 'room-1', name: '讨论组', members: ['bot-a', 'bot-b'] },
    ],
    profileName: 'bot-a',
    lang: 'zh-CN',
    presenceLayout: 'dock',
    activeGroupSpeaker: null,
    ...(overrides.initialState || {}),
  };

  const renderedSnapshots = [];
  const activeRunningGroupRoomIds = overrides.activeRunningGroupRoomIds ?? new Set();
  let isGroupActive = overrides.isGroupActive ?? false;
  let isStreaming = overrides.isStreaming ?? false;
  let mountCount = 0;
  let unmountCount = 0;
  let currentHost = overrides.initialHost ?? { id: 'host-1', isConnected: true };

  const deps = {
    getState: () => state,
    resolveAgentAvatar: overrides.resolveAgentAvatar ?? ((name) => (name ? '' : '')),
    isGroupConversationActive: () => isGroupActive,
    isStreamingActiveForCurrentSession: () => isStreaming,
    activeRunningGroupRoomIds,
    mountAgentPresence: (_host, getSnapshot) => {
      mountCount += 1;
      const render = () => {
        renderedSnapshots.push(getSnapshot());
      };
      render();
      return {
        update: render,
        unmount: () => {
          unmountCount += 1;
        },
      };
    },
    ensureAgentPresenceHost: () => currentHost,
  };

  return {
    state,
    deps,
    renderedSnapshots,
    activeRunningGroupRoomIds,
    setGroupActive: (val) => { isGroupActive = val; },
    setStreaming: (val) => { isStreaming = val; },
    setHost: (host) => { currentHost = host; },
    getMountCount: () => mountCount,
    getUnmountCount: () => unmountCount,
  };
}

test('PresenceController: 宿主的挂载、切 Bot 头像更新、重建与生命周期收口', async (t) => {
  await t.test('1. 切 Bot 且未重建宿主时（dock 未重绘或 stage 布局），在场头像必须切到新 Bot', () => {
    for (const layout of ['dock', 'stage']) {
      const h = createHarness({ initialState: { presenceLayout: layout } });
      const controller = createPresenceController(h.deps);
      try {
        controller.syncAgentPresenceHost();
        assert.equal(h.getMountCount(), 1);
        assert.equal(h.renderedSnapshots.length, 1);
        assert.equal(h.renderedSnapshots[0].identity.kind, 'solo');
        assert.equal(h.renderedSnapshots[0].identity.name, 'bot-a');
        assert.equal(h.renderedSnapshots[0].identity.avatar, 'data:image/png;base64,bot-a');

        const htmlA = renderPresenceHtml(h.renderedSnapshots[0]);
        assert.match(htmlA, /src="data:image\/png;base64,bot-a"/);
        assert.match(htmlA, /alt="Bot A"/);

        // 指纹未变时不得重复触发 React 更新
        controller.syncAgentPresence();
        assert.equal(h.renderedSnapshots.length, 1, `${layout} 布局下相同状态不得重复渲染`);

        // 切到 Bot B，宿主节点仍存活且同一引用（模拟模型未变未重建 dock 或处于 stage 布局）
        h.state.activeFocus = { type: 'bot', botName: 'bot-b' };
        h.state.profileName = 'bot-b';
        controller.syncAgentPresenceHost();
        assert.equal(h.getMountCount(), 1, '存活宿主复用，不触发重挂载');

        controller.syncAgentPresence();
        assert.equal(h.renderedSnapshots.length, 2, `${layout} 布局下切 Bot 必须推动新快照`);

        const latest = h.renderedSnapshots[1];
        assert.equal(latest.identity.kind, 'solo');
        assert.equal(latest.identity.name, 'bot-b');
        assert.equal(latest.identity.avatar, 'data:image/png;base64,bot-b');
        assert.equal(controller.getSnapshot().identity.name, 'bot-b');
        assert.equal(controller.getSnapshot().identity.avatar, 'data:image/png;base64,bot-b');

        const htmlB = renderPresenceHtml(latest);
        assert.match(htmlB, /src="data:image\/png;base64,bot-b"/);
        assert.doesNotMatch(htmlB, /bot-a/, '切到 Bot B 后渲染产物不得残留 Bot A 头像');
      } finally {
        controller.resetPresenceHost();
      }
    }
  });

  await t.test('2. 连续切换 Bot A -> 无头像 Bot B -> 迟到头像回填 -> 群聊 -> Bot A', () => {
    let avatarCache = {};
    const h = createHarness({
      resolveAgentAvatar: (name) => (name ? avatarCache[name] || '' : ''),
      initialState: {
        profiles: [
          { name: 'bot-a', avatar: 'data:image/png;base64,bot-a' },
          { name: 'bot-b', displayName: 'Bot B' },
        ],
        sessions: [
          { id: 'sess-a', botName: 'bot-a', botDisplayName: 'Bot A', botAvatar: 'data:image/png;base64,bot-a' },
          { id: 'sess-b', botName: 'bot-b', botDisplayName: 'Session Bot B', botAvatar: 'data:image/png;base64,sess-b' },
          { id: 'sess-only', botName: 'bot-only', botDisplayName: 'Only Session', botAvatar: 'data:image/png;base64,only-sess' },
        ],
        groupRooms: [
          { roomId: 'room-1', name: '讨论组', members: ['bot-a', 'Bot B', 'unknown-member'] },
        ],
      },
    });
    const controller = createPresenceController(h.deps);
    try {
      controller.syncAgentPresenceHost();
      assert.equal(h.renderedSnapshots.at(-1).identity.avatar, 'data:image/png;base64,bot-a');

      // 切到暂无头像资产的 Bot B（activeSessionId 仍指向 Bot A 会话，不得串用 Bot A 头像）
      h.state.activeFocus = { type: 'bot', botName: 'bot-b' };
      h.state.profileName = 'bot-b';
      controller.syncAgentPresence();
      const snapBNoAvatar = h.renderedSnapshots.at(-1);
      assert.equal(snapBNoAvatar.identity.name, 'bot-b');
      assert.equal(snapBNoAvatar.identity.avatar, undefined);
      const htmlBNoAvatar = renderPresenceHtml(snapBNoAvatar);
      assert.doesNotMatch(htmlBNoAvatar, /<img/, '无头像 Bot B 必须回退 SVG 图腾而非残留 Bot A 图片');
      assert.match(htmlBNoAvatar, /<svg\b/);

      // 通过 displayName 命中 resolveAgentAvatar 缓存
      avatarCache = { 'Bot B': 'data:image/png;base64,cache-display-b' };
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.at(-1).identity.avatar, 'data:image/png;base64,cache-display-b');

      // 缓存为空且 activeSessionId 切到同名 sess-b 时，回退同名会话头像
      avatarCache = {};
      h.state.activeSessionId = 'sess-b';
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.at(-1).identity.avatar, 'data:image/png;base64,sess-b');

      // 通过 name 命中 resolveAgentAvatar 缓存
      avatarCache = { 'bot-b': 'data:image/png;base64,cache-name-b' };
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.at(-1).identity.avatar, 'data:image/png;base64,cache-name-b');

      // Bot B 头像异步拉取到达
      avatarCache = {};
      h.state.profiles[1].avatar = 'data:image/png;base64,bot-b-late';
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.at(-1).identity.avatar, 'data:image/png;base64,bot-b-late');
      assert.match(renderPresenceHtml(h.renderedSnapshots.at(-1)), /src="data:image\/png;base64,bot-b-late"/);

      // 切入群聊（含无 displayName 成员、按 displayName 匹配成员、未知成员、speaker=null 与运行态 speaker）
      h.setGroupActive(true);
      h.state.activeFocus = { type: 'group', roomId: 'room-1' };
      h.state.profiles[1].avatar = undefined;
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.at(-1).identity.kind, 'group');
      assert.equal(h.renderedSnapshots.at(-1).identity.speaker, null);

      h.activeRunningGroupRoomIds.add('room-1');
      h.state.activeGroupSpeaker = 'bot-a';
      controller.syncAgentPresence();
      const groupSnap1 = h.renderedSnapshots.at(-1);
      assert.equal(groupSnap1.identity.speaker, 'bot-a');
      const countBeforeLateGroupAvatar = h.renderedSnapshots.length;

      // 群成员延迟头像更新必须穿透指纹去重并更新群头像拼排
      h.state.profiles[1].avatar = 'data:image/png;base64,bot-b-group';
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.length, countBeforeLateGroupAvatar + 1);
      assert.match(renderPresenceHtml(h.renderedSnapshots.at(-1)), /src="data:image\/png;base64,bot-b-group"/);

      // 切入普通会话（无对应 profile，从会话元数据取 displayName 与 avatar），再切按 displayName 匹配的 Bot
      h.setGroupActive(false);
      h.activeRunningGroupRoomIds.clear();
      h.state.activeFocus = { type: 'session', sessionId: 'sess-only' };
      h.state.activeSessionId = 'sess-only';
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.at(-1).identity.name, 'bot-only');
      assert.equal(h.renderedSnapshots.at(-1).identity.displayName, 'Only Session');
      assert.equal(h.renderedSnapshots.at(-1).identity.avatar, 'data:image/png;base64,only-sess');

      // 未知 Bot 且无缓存/无会话匹配
      h.state.activeFocus = { type: 'bot', botName: 'ghost-bot' };
      h.state.activeSessionId = 'sess-none';
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.at(-1).identity.name, 'ghost-bot');
      assert.equal(h.renderedSnapshots.at(-1).identity.displayName, undefined);
      assert.equal(h.renderedSnapshots.at(-1).identity.avatar, undefined);

      // 按 displayName 匹配 Bot 并切回 Bot A，再连续重复同步一次验证去重
      h.state.activeFocus = { type: 'bot', botName: 'Bot B' };
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.at(-1).identity.avatar, 'data:image/png;base64,bot-b-group');

      h.state.activeFocus = { type: 'bot', botName: 'bot-a' };
      h.state.profileName = 'bot-a';
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.at(-1).identity.name, 'bot-a');
      const countAtBackToA = h.renderedSnapshots.length;
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.length, countAtBackToA, '切回后重复同步不得产生冗余重绘');
    } finally {
      controller.resetPresenceHost();
    }
  });

  await t.test('3. 宿主节点被 dock outerHTML 替换后，syncAgentPresence 就地重挂并按新 Bot 去重', () => {
    const host1 = { id: 'host-1', isConnected: true };
    const host2 = { id: 'host-2', isConnected: true };
    const h = createHarness({ initialHost: host1 });
    const controller = createPresenceController(h.deps);
    try {
      controller.syncAgentPresenceHost();
      assert.equal(controller.getAgentPresenceHost(), host1);
      assert.equal(h.getMountCount(), 1);
      assert.equal(h.renderedSnapshots.length, 1);

      // 模拟输入舱重建销毁 host1，同时切到 Bot B
      host1.isConnected = false;
      h.setHost(host2);
      h.state.activeFocus = { type: 'bot', botName: 'bot-b' };
      h.state.profileName = 'bot-b';
      controller.syncAgentPresence();

      assert.equal(h.getUnmountCount(), 1);
      assert.equal(h.getMountCount(), 2);
      assert.equal(controller.getAgentPresenceHost(), host2);
      assert.equal(h.renderedSnapshots.length, 2, '重挂首帧后 manager 指纹已对齐，不得立刻二次重绘');
      assert.equal(h.renderedSnapshots[1].identity.name, 'bot-b');
      assert.equal(h.renderedSnapshots[1].identity.avatar, 'data:image/png;base64,bot-b');
    } finally {
      controller.resetPresenceHost();
    }
  });

  await t.test('4. 断连空宿主与 resetPresenceHost 生命周期：必须卸载、停节拍器并可幂等重挂', () => {
    const origSetInterval = globalThis.setInterval;
    const origClearInterval = globalThis.clearInterval;
    let nextTimerId = 100;
    const activeIntervals = new Map();
    let setIntervalCalls = 0;
    let clearIntervalCalls = 0;

    globalThis.setInterval = (fn, ms) => {
      setIntervalCalls += 1;
      const id = ++nextTimerId;
      activeIntervals.set(id, { fn, ms });
      return id;
    };
    globalThis.clearInterval = (id) => {
      clearIntervalCalls += 1;
      activeIntervals.delete(id);
    };

    const host1 = { id: 'host-1', isConnected: true };
    const host2 = { id: 'host-2', isConnected: true };
    const h = createHarness({
      initialHost: host1,
      isStreaming: true,
      initialState: {
        messages: [{ id: 'm1', role: 'assistant', content: '', thought: '思考中' }],
      },
    });
    const controller = createPresenceController(h.deps);
    try {
      // 未挂载前调用 syncAgentPresence 必须安全早退
      controller.syncAgentPresence();
      assert.equal(h.renderedSnapshots.length, 0);
      assert.equal(setIntervalCalls, 0);

      // 挂载思考态：syncAgentPresenceHost 必须立即启动 1000ms 节拍器
      controller.syncAgentPresenceHost();
      assert.equal(h.renderedSnapshots.at(-1).presence.kind, 'thinking');
      assert.equal(setIntervalCalls, 1, '挂载非 idle 状态必须自动启动节拍器');
      assert.equal(activeIntervals.size, 1);
      const [firstTimer] = activeIntervals.values();
      assert.equal(firstTimer.ms, 1000);

      // 节拍器回调必须真正推进快照更新
      h.state.messages[0].content = '开始输出正文';
      firstTimer.fn();
      assert.equal(h.renderedSnapshots.at(-1).presence.kind, 'writing');

      // 断连：host 脱离且 ensureAgentPresenceHost 返回 null，syncAgentPresence 必须卸载并停表
      host1.isConnected = false;
      h.setHost(null);
      controller.syncAgentPresence();
      assert.equal(h.getUnmountCount(), 1);
      assert.equal(controller.getAgentPresenceHost(), null);
      assert.equal(clearIntervalCalls, 1, '断连空宿主必须清理节拍器');
      assert.equal(activeIntervals.size, 0);

      // 再次挂载非 idle 后，直接调用 syncAgentPresenceHost(null) 也必须清理节拍器
      h.setHost(host2);
      h.state.messages[0].content = '';
      controller.syncAgentPresenceHost();
      assert.equal(setIntervalCalls, 2);
      assert.equal(activeIntervals.size, 1);
      h.setHost(null);
      controller.syncAgentPresenceHost();
      assert.equal(h.getUnmountCount(), 2);
      assert.equal(controller.getAgentPresenceHost(), null);
      assert.equal(clearIntervalCalls, 2, 'syncAgentPresenceHost 进入无宿主分支必须停表');
      assert.equal(activeIntervals.size, 0);

      // 重连挂载 host2 后调用 resetPresenceHost：验证卸载、停表、置空挂载体与清理待渲染快照
      h.setHost(host2);
      controller.syncAgentPresenceHost();
      assert.equal(h.getMountCount(), 3);
      assert.equal(setIntervalCalls, 3);
      assert.equal(activeIntervals.size, 1);
      const countBeforeReset = h.renderedSnapshots.length;

      controller.resetPresenceHost();
      assert.equal(h.getUnmountCount(), 3);
      assert.equal(controller.getAgentPresenceHost(), null);
      assert.equal(clearIntervalCalls, 3, 'resetPresenceHost 必须清理节拍器');
      assert.equal(activeIntervals.size, 0);

      // reset 后即使宿主仍连接且更换 Bot，未重新 mount 前调用 syncAgentPresence 不得重挂或渲染
      h.setStreaming(false);
      h.state.messages = [];
      h.state.activeFocus = { type: 'bot', botName: 'bot-b' };
      h.state.profileName = 'bot-b';
      controller.syncAgentPresence();
      assert.equal(h.getMountCount(), 3, 'resetPresenceHost 置空 updateReactAgentPresence 后不得自动重挂');
      assert.equal(h.renderedSnapshots.length, countBeforeReset, 'reset 后未重挂不得触发渲染');

      // reset 后 manager.pendingPresenceSnapshot 已清空，getSnapshot() 立即反映新 Bot 而非旧缓存
      assert.equal(controller.getSnapshot().identity.name, 'bot-b', 'reset 后 getSnapshot 必须返回新 Bot');

      // 重复 reset 幂等不报错，且不重复计数卸载
      controller.resetPresenceHost();
      assert.equal(h.getUnmountCount(), 3);

      // 透传辅助方法验证与再次重挂
      controller.ensureGroupTurnClock('room-1', true);
      controller.ensurePresenceTicker('thinking');
      assert.equal(activeIntervals.size, 1);
      controller.ensurePresenceTicker('idle');
      assert.equal(activeIntervals.size, 0);

      controller.syncAgentPresenceHost();
      assert.equal(h.getMountCount(), 4);
      assert.equal(h.renderedSnapshots.at(-1).identity.name, 'bot-b');
    } finally {
      controller.resetPresenceHost();
      globalThis.setInterval = origSetInterval;
      globalThis.clearInterval = origClearInterval;
    }
  });
});

