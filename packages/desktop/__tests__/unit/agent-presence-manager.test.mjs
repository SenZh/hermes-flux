import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AgentPresenceManager,
  agentPresenceFingerprint,
} from '../../dist/renderer/presence/agentPresenceManager.mjs';

function createMockHost(overrides = {}) {
  const host = {
    activeFocus: { type: 'session' },
    activeSessionId: 'ses-1',
    activeRunningGroupRoomIds: new Set(),
    isStreamingActiveForCurrentSession: () => false,
    messages: [],
    sideAgentCapsules: [],
    presenceTerminal: null,
    turnStartedAt: undefined,
    profiles: [
      { name: 'bot-alpha', displayName: '阿尔法', avatar: 'alpha.png' },
      { name: 'bot-beta', displayName: '贝塔', avatar: 'beta.png' },
    ],
    sessions: [
      { id: 'ses-1', botName: 'bot-alpha', botDisplayName: '阿尔法', botAvatar: 'alpha.png' },
    ],
    groupRooms: [
      { roomId: 'room-1', name: '讨论组', members: ['bot-alpha', 'bot-beta'] },
    ],
    profileName: 'default',
    lang: 'zh',
    presenceLayout: 'stage',
    activeGroupSpeaker: null,
    resolveAgentAvatar: () => undefined,
    isGroupConversationActive: () => false,
    onUpdateReact: () => {},
    ...overrides,
  };
  return host;
}

test('AgentPresenceManager 领域状态机行为单测套件', async (t) => {
  await t.test('1. 单聊身份解析：优先专职工位、其次会话绑定、兜底 profileName', () => {
    // 场景 A: 会话绑定
    const hostA = createMockHost();
    const mgrA = new AgentPresenceManager(hostA);
    const idA = mgrA.resolvePresenceSoloIdentity();
    assert.equal(idA.name, 'bot-alpha');
    assert.equal(idA.displayName, '阿尔法');

    // 场景 B: 专职工位
    const hostB = createMockHost({
      activeFocus: { type: 'bot', botName: 'bot-beta' },
    });
    const mgrB = new AgentPresenceManager(hostB);
    const idB = mgrB.resolvePresenceSoloIdentity();
    assert.equal(idB.name, 'bot-beta');
    assert.equal(idB.displayName, '贝塔');
  });

  await t.test('2. 群聊说话者裁决铁律：非运行时 speaker 必须为 null，运行时才非 null', () => {
    const host = createMockHost({
      activeFocus: { type: 'group', roomId: 'room-1' },
      isGroupConversationActive: () => true,
      activeGroupSpeaker: 'bot-beta',
      activeRunningGroupRoomIds: new Set(), // 没在跑
    });
    const mgr = new AgentPresenceManager(host);

    // 未在运行时：speaker 强制为 null
    const snapIdle = mgr.buildAgentPresenceSnapshot();
    assert.equal(snapIdle.identity.kind, 'group');
    assert.equal(snapIdle.identity.speaker, null, '未运行时禁止高亮上一位发言者');

    // 运行态：speaker 真实高亮
    host.activeRunningGroupRoomIds.add('room-1');
    const snapRunning = mgr.buildAgentPresenceSnapshot();
    assert.equal(snapRunning.identity.speaker, 'bot-beta');
  });

  await t.test('3. 会话时长隔离：单聊 turnStartedAt 必须与 turnStartedSessionId 匹配才生效', () => {
    const host = createMockHost({
      activeSessionId: 'ses-1',
      turnStartedAt: Date.now() - 5000,
      isStreamingActiveForCurrentSession: () => true,
      messages: [
        { id: 'm1', role: 'assistant', thought: '思考中' },
      ],
    });
    const mgr = new AgentPresenceManager(host);

    // 场景 A: 会话不匹配（如切到后台会话），turnStartedAt 未注入，sinceMs 回落为 0
    mgr.setTurnStartedSessionId('ses-other');
    const snapMismatched = mgr.buildAgentPresenceSnapshot();
    assert.equal(snapMismatched.presence.sinceMs, 0, '未匹配会话不得借用时长，sinceMs 回落为 0');

    // 场景 B: 会话匹配，正确计算经过时长
    mgr.setTurnStartedSessionId('ses-1');
    const snapMatched = mgr.buildAgentPresenceSnapshot();
    assert.ok(snapMatched.presence.sinceMs >= 5000, '匹配会话正常计算 sinceMs');
  });

  await t.test('4. 指纹去重契约：不得包含 sinceMs 与正文，必须包含 tone 与 kind', () => {
    const snapshotA = {
      presence: { kind: 'thinking', sinceMs: 100 },
      identity: { kind: 'solo', name: 'bot-alpha' },
      locale: 'zh',
      layout: 'stage',
    };
    const snapshotB = {
      presence: { kind: 'thinking', sinceMs: 200 }, // 同属 fresh 档位的微小毫秒变化
      identity: { kind: 'solo', name: 'bot-alpha' },
      locale: 'zh',
      layout: 'stage',
    };

    const fpA = agentPresenceFingerprint(snapshotA);
    const fpB = agentPresenceFingerprint(snapshotB);
    assert.equal(fpA, fpB, '由于 sinceMs 毫秒级微变，同语气档内指纹不得包含 sinceMs 以保持去重');

    // 跨语气档变化时（例如超过 8s 进入 medium 档），指纹必须变化以驱动 React 协调
    const snapshotCrossTone = {
      ...snapshotA,
      presence: { kind: 'thinking', sinceMs: 12000 },
    };
    const fpCross = agentPresenceFingerprint(snapshotCrossTone);
    assert.notEqual(fpA, fpCross, '跨语气档时必须改变指纹以触发 React 更新');

    // 状态变化时指纹必须变
    const snapshotC = {
      ...snapshotA,
      presence: { kind: 'writing', content: '新输出' },
    };
    const fpC = agentPresenceFingerprint(snapshotC);
    assert.notEqual(fpA, fpC, '状态变化必须改变指纹以触发 React 更新');
  });

  await t.test('5. 节拍器生命周期：非 idle 时启动，进入 idle / 终态时立即停止', () => {
    const host = createMockHost();
    const mgr = new AgentPresenceManager(host);

    mgr.ensurePresenceTicker('thinking');
    assert.ok(mgr.presenceTickerTimer !== null, '非 idle 必须启动节拍器');

    mgr.ensurePresenceTicker('idle');
    assert.equal(mgr.presenceTickerTimer, null, '进入 idle 必须立刻释放定时器');
  });

  await t.test('6. syncAgentPresence 指纹防抖：指纹相同不触碰 React 协调', () => {
    let reactRenderCount = 0;
    const host = createMockHost({
      onUpdateReact: () => {
        reactRenderCount += 1;
      },
    });
    const mgr = new AgentPresenceManager(host);

    mgr.syncAgentPresence();
    assert.equal(reactRenderCount, 1, '首次同步必须触发渲染');

    // 再次无变化同步
    mgr.syncAgentPresence();
    assert.equal(reactRenderCount, 1, '指纹相同不得重复触发 React 渲染');
    mgr.dispose();
  });
});
