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

  await t.test('7. 跨 Bot 会话隔离与头像回退优先级：不得借用上一 Bot 会话头像，优先走 resolveAgentAvatar', () => {
    // 场景 A: 切到暂无头像的 bot-beta，activeSessionId 仍指向 bot-alpha 的会话
    const mgrA = new AgentPresenceManager(createMockHost({
      activeFocus: { type: 'bot', botName: 'bot-beta' },
      activeSessionId: 'ses-1',
      profiles: [
        { name: 'bot-alpha', displayName: '阿尔法', avatar: 'alpha.png' },
        { name: 'bot-beta', displayName: '贝塔' },
      ],
      sessions: [
        { id: 'ses-1', botName: 'bot-alpha', botDisplayName: '阿尔法', botAvatar: 'alpha.png' },
      ],
      resolveAgentAvatar: () => undefined,
    }));
    const idA = mgrA.resolvePresenceSoloIdentity();
    assert.equal(idA.name, 'bot-beta');
    assert.equal(idA.displayName, '贝塔');
    assert.equal(idA.avatar, undefined, '专职 Bot B 绝不得泄漏 Bot A 会话的 botAvatar');

    // 场景 B: 未知 Bot（不在 profiles），且旧会话缺少 botName 但带陈旧 botAvatar / botDisplayName
    const mgrB = new AgentPresenceManager(createMockHost({
      activeFocus: { type: 'bot', botName: 'bot-gamma' },
      activeSessionId: 'ses-legacy',
      profiles: [{ name: 'bot-alpha', avatar: 'alpha.png' }],
      sessions: [{ id: 'ses-legacy', botDisplayName: '旧名字', botAvatar: 'stale.png' }],
      resolveAgentAvatar: () => undefined,
    }));
    const idB = mgrB.resolvePresenceSoloIdentity();
    assert.equal(idB.name, 'bot-gamma');
    assert.equal(idB.displayName, undefined);
    assert.equal(idB.avatar, undefined, '非同名会话的陈旧元信息不得泄漏到新 Bot');

    // 场景 C: bot-beta 的 profile.avatar 为空，但 resolveAgentAvatar(name) 命中，必须压过旧会话头像
    const mgrC = new AgentPresenceManager(createMockHost({
      activeFocus: { type: 'bot', botName: 'bot-beta' },
      activeSessionId: 'ses-1',
      profiles: [{ name: 'bot-beta', displayName: '贝塔' }],
      sessions: [{ id: 'ses-1', botName: 'bot-alpha', botAvatar: 'alpha.png' }],
      resolveAgentAvatar: (key) => (key === 'bot-beta' ? 'cache-beta.png' : undefined),
    }));
    assert.equal(mgrC.resolvePresenceSoloIdentity().avatar, 'cache-beta.png');

    // 场景 D: 通过 displayName 命中 resolveAgentAvatar
    const mgrD = new AgentPresenceManager(createMockHost({
      activeFocus: { type: 'bot', botName: 'bot-beta' },
      activeSessionId: 'ses-1',
      profiles: [{ name: 'bot-beta', displayName: '贝塔' }],
      sessions: [{ id: 'ses-1', botName: 'bot-alpha', botAvatar: 'alpha.png' }],
      resolveAgentAvatar: (key) => (key === '贝塔' ? 'display-beta.png' : ''),
    }));
    assert.equal(mgrD.resolvePresenceSoloIdentity().avatar, 'display-beta.png');

    // 场景 E: 同 Bot 的主工位会话回退（profile 与 resolveAgentAvatar 均无头像，但同名会话有 botAvatar）
    const mgrE = new AgentPresenceManager(createMockHost({
      activeFocus: { type: 'bot', botName: 'bot-beta' },
      activeSessionId: 'ses-beta',
      profiles: [{ name: 'bot-beta' }],
      sessions: [{ id: 'ses-beta', botName: 'bot-beta', botDisplayName: '贝塔会话', botAvatar: 'sess-beta.png' }],
      resolveAgentAvatar: () => undefined,
    }));
    const idE = mgrE.resolvePresenceSoloIdentity();
    assert.equal(idE.displayName, '贝塔会话');
    assert.equal(idE.avatar, 'sess-beta.png');

    // 场景 F: 普通会话（type: 'session'）允许从会话回退，且按 displayName 匹配 profile（含前序无 displayName 档案）
    const mgrF = new AgentPresenceManager(createMockHost({
      activeFocus: { type: 'session' },
      activeSessionId: 'ses-2',
      profiles: [
        { name: 'no-display-bot' },
        { name: 'bot-delta', displayName: '德尔塔', avatar: 'delta.png' },
      ],
      sessions: [{ id: 'ses-2', botName: 'bot-only-sess', botDisplayName: '仅会话名', botAvatar: 'sess-only.png' }],
      resolveAgentAvatar: () => undefined,
    }));
    const idF = mgrF.resolvePresenceSoloIdentity();
    assert.equal(idF.name, 'bot-only-sess');
    assert.equal(idF.displayName, '仅会话名');
    assert.equal(idF.avatar, 'sess-only.png');

    const mgrG = new AgentPresenceManager(createMockHost({
      activeFocus: { type: 'bot', botName: '德尔塔' },
      activeSessionId: 'ses-none',
      profiles: [
        { name: 'no-display-bot' },
        { name: 'bot-other', displayName: '其他' },
        { name: 'bot-delta', displayName: '德尔塔', avatar: 'delta.png' },
      ],
      sessions: [],
      resolveAgentAvatar: () => undefined,
    }));
    assert.equal(mgrG.resolvePresenceSoloIdentity().avatar, 'delta.png');
  });

  await t.test('8. 群聊指纹敏感性：成员延迟头像到达或说话者变更必须改变指纹', () => {
    const baseGroup = {
      presence: { kind: 'idle' },
      identity: {
        kind: 'group',
        members: ['bot-alpha', '贝塔', 'unknown-bot'],
        speaker: null,
        profiles: [
          { name: 'bot-alpha', avatar: 'alpha.png' },
          { name: 'bot-beta', displayName: '贝塔' },
        ],
      },
      locale: 'zh',
      layout: 'stage',
    };
    const fpBefore = agentPresenceFingerprint(baseGroup);

    const withLateAvatar = {
      ...baseGroup,
      identity: {
        ...baseGroup.identity,
        speaker: 'bot-alpha',
        profiles: [
          { name: 'bot-alpha', displayName: '阿尔法', avatar: 'alpha.png' },
          { name: 'bot-beta', displayName: '贝塔', avatar: 'beta-late.png' },
        ],
      },
    };
    const fpAfter = agentPresenceFingerprint(withLateAvatar);
    assert.notEqual(fpBefore, fpAfter, '群聊成员头像异步到达后指纹必须变化，否则群拼排不刷新');

    // 仅头像从 undefined 变为有值（speaker 与长度不变）也必须改变指纹
    const sameSpeakerWithAvatar = {
      ...baseGroup,
      identity: {
        ...baseGroup.identity,
        profiles: [
          { name: 'bot-alpha', avatar: 'alpha.png' },
          { name: 'bot-beta', displayName: '贝塔', avatar: 'beta-only.png' },
        ],
      },
    };
    assert.notEqual(fpBefore, agentPresenceFingerprint(sameSpeakerWithAvatar));

    // 仅成员 displayName 变更（speaker 与 avatar 均不变）也必须改变指纹
    const onlyDisplayNameChanged = {
      ...sameSpeakerWithAvatar,
      identity: {
        ...sameSpeakerWithAvatar.identity,
        profiles: [
          { name: 'bot-alpha', displayName: '新阿尔法', avatar: 'alpha.png' },
          { name: 'bot-beta', displayName: '贝塔', avatar: 'beta-only.png' },
        ],
      },
    };
    assert.notEqual(
      agentPresenceFingerprint(sameSpeakerWithAvatar),
      agentPresenceFingerprint(onlyDisplayNameChanged),
      '仅成员 displayName 变更时群聊指纹也必须变化',
    );
  });
});
