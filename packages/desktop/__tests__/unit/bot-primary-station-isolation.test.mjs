import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBotActivity,
  syncBotProfiles,
  syncActiveSessionToBot,
  resolveTitlebarTitle,
  resolveTitlebarAvatar,
  normalizeTimestamp,
  extractMessagePreview,
} from '../../../../packages/core/dist/index.js';
import { renderLeftRailHtml, renderTitlebar } from '../../../../packages/ui/dist/index.js';

/** 左轨静态渲染入口（React 实现），语义与旧 renderLeftRail(props) 一一对应。 */
function renderLeftRail(props = {}) {
  return renderLeftRailHtml({
    activeSessionId: props.activeSessionId || '',
    activeFocus: props.activeFocus,
    sessions: props.sessions || [],
    profileName: props.profileName || 'default',
    profiles: props.profiles || [],
    groups: props.groups || [],
    projects: props.projects || [],
    activeRailTab: props.activeRailTab || 'chats',
    searchQuery: props.searchQuery || '',
    error: props.error,
    collapsed: Boolean(props.collapsed),
    editingGroupRoomId: props.editingGroupRoomId,
  });
}

/**
 * 专职 Bot 主工位（Forever Chat）与普通会话池物理隔离及时间对齐单元测试
 * (Bot Primary Station & Session Pool Isolation Invariants)
 *
 * 【测试核心目标】
 * 真实 import 并测试 @hermes-flux/core 生产业务逻辑，坚决杜绝假测试与循环自证：
 * 1. 验证 syncBotProfiles 彻底杜绝普通会话池（state.sessions）越界覆盖专职 Bot 卡片；
 * 2. 验证 syncActiveSessionToBot 与 applyBotActivity 在会话加载与交互时的原子反哺；
 * 3. 验证纯思考链（thought）与别名（displayName）边界完整覆盖；
 * 4. 验证 resolveTitlebarTitle 在专职工位下的标题决策正确性；
 * 5. 变异检验断言：生产逻辑若发生任何偏离，测试必须 100% 变红报警。
 */
test('Bot Primary Station & Session Isolation Invariants', async (t) => {
  const formatTimeMock = (ts) => {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `昨天 ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  await t.test('1. 生产 syncBotProfiles 物理领域隔离断言：严禁普通会话池污染专职 Bot 卡片', () => {
    // 1. Arrange: 模拟线上真实割裂场景
    // aura 专职主工位真实最后一条消息是 22:49 发送的自动化验证消息
    const baseProfile = {
      name: 'aura',
      displayName: 'aura-bot',
      avatar: 'data:image/png;base64,mock',
      lastMessage: '',
      lastTime: '',
      timestamp: 0,
    };

    const activityMap = new Map();
    const foreverChatCache = new Map([['aura', 'forever-chat-aura']]);
    const sessionMessagesCache = new Map([
      [
        'forever-chat-aura',
        [
          {
            content: '已收到 Flux E2E 第 2 轮自动化验证消息。',
            rawTimestamp: 1730472540000, // 22:49
          },
        ],
      ],
    ]);

    // 2. Act: 执行生产真实函数 syncBotProfiles
    const syncedProfiles = syncBotProfiles({
      profiles: [baseProfile],
      activityMap,
      foreverChatCache,
      sessionMessagesCache,
      formatTime: formatTimeMock,
    });

    // 3. Assert: 验证输出状态
    assert.equal(syncedProfiles.length, 1);
    const aura = syncedProfiles[0];
    assert.equal(aura.name, 'aura');
    assert.equal(aura.lastMessage, '已收到 Flux E2E 第 2 轮自动化验证消息。');
    assert.equal(aura.timestamp, 1730472540000);
    assert.equal(aura.lastTime, '昨天 22:49');

    // 变异反向排他断言：未被污染时绝对不包含普通会话信息
    assert.equal(aura.lastTime.includes('23:54'), false, '专职 Bot 时间绝对不能包含普通会话的 23:54');
    assert.equal(aura.lastMessage.includes('奥特曼反差猫'), false, '专职 Bot 副标题绝对不能包含普通会话内容');
  });

  await t.test('2. 生产 syncActiveSessionToBot 会话反哺管道：精准识别所属 Bot 并反向同步，普通会话严格隔离', () => {
    // 1. Arrange
    const profiles = [
      {
        name: 'aura',
        displayName: 'Aura Assistant',
        lastMessage: '旧消息',
        timestamp: 1000,
      },
    ];
    const activityMap = new Map();
    const foreverChatCache = new Map([['aura', 'forever-chat-aura']]);

    // 2. Act (正向): 加载专职 Bot 主工位历史消息
    const botMessages = [
      { content: '你好，我是 aura 主工位' },
      { content: '已收到 Flux E2E 第 2 轮自动化验证消息。', rawTimestamp: 1730472540000 },
    ];
    const botResult = syncActiveSessionToBot({
      sessionId: 'forever-chat-aura',
      messages: botMessages,
      foreverChatCache,
      profiles,
      activityMap,
      formatTime: formatTimeMock,
    });

    // 3. Assert (正向)
    assert.ok(botResult !== null, '主工位会话加载后必须命中反哺管道');
    assert.equal(botResult.matchedBotName, 'aura');
    assert.equal(botResult.updatedText, '已收到 Flux E2E 第 2 轮自动化验证消息。');
    assert.equal(botResult.updatedTimestamp, 1730472540000);
    assert.equal(activityMap.get('aura')?.lastMessage, '已收到 Flux E2E 第 2 轮自动化验证消息。');
    assert.equal(activityMap.get('aura')?.timestamp, 1730472540000);

    // 4. Act & Assert (负向隔离): 加载普通会话历史，绝不污染 Bot
    const regularMessages = [
      { content: '短剧方案，主角奥特曼，反差猫，想想几个...', rawTimestamp: 1730476440000 },
    ];
    const regularResult = syncActiveSessionToBot({
      sessionId: 'regular-sess-ultraman',
      messages: regularMessages,
      foreverChatCache,
      profiles,
      activityMap,
      formatTime: formatTimeMock,
    });
    assert.equal(regularResult, null, '普通会话绝不能匹配到专职 Bot，必须返回 null 阻断反哺');
    assert.equal(activityMap.get('aura')?.timestamp, 1730472540000, 'Bot 活动记录不得被普通会话修改');
  });

  await t.test('3. 生产 applyBotActivity 原子更新管道：别名 displayName 匹配、纯思考链 thought 提取与时间倒序', () => {
    // 1. Arrange: 包含 displayName 且最后一条消息仅包含 thought 的场景
    const profiles = [
      {
        name: 'xiaofawang',
        displayName: '小法王',
        lastMessage: '初始法务文书已就绪',
        timestamp: 1000,
      },
      {
        name: 'aura',
        displayName: 'Aura',
        lastMessage: 'Aura 待命',
        timestamp: 2000,
      },
    ];
    const activityMap = new Map();

    // 验证 extractMessagePreview 对纯思考链（thought）的健壮提取
    const thoughtOnlyMsg = {
      content: '',
      thought: '正在进行刑法第 234 条法理分析与罪责适用推演...',
    };
    const extractedText = extractMessagePreview(thoughtOnlyMsg);
    assert.equal(
      extractedText,
      '正在进行刑法第 234 条法理分析与罪责适用推演...',
      '当 content 为空时，必须提取 thought 作为副标题'
    );

    // 2. Act: 使用 displayName '小法王' 触发更新，时间戳传入秒级数字（测试 normalizeTimestamp 自动换算）
    const updateTimeSec = 1730478000; // 秒级
    const result = applyBotActivity({
      profiles,
      activityMap,
      botName: '小法王',
      text: extractedText,
      timestamp: updateTimeSec,
      formatTime: formatTimeMock,
    });

    // 3. Assert
    assert.ok(result.updatedProfile, '必须通过 displayName 成功匹配 Profile');
    assert.equal(result.updatedProfile.name, 'xiaofawang');
    assert.equal(result.updatedProfile.lastMessage, '正在进行刑法第 234 条法理分析与罪责适用推演...');
    assert.equal(result.updatedProfile.timestamp, updateTimeSec * 1000, '秒级时间戳必须被 normalizeTimestamp 自动转为毫秒');

    // 验证 profiles 重新按 timestamp 倒序排序：最新活跃的 xiaofawang 必须排在首位
    assert.equal(result.profiles[0].name, 'xiaofawang', '最新活跃的 Bot 必须排在列表第 1 位');
    assert.equal(result.profiles[1].name, 'aura');
  });

  await t.test('4. 生产 resolveTitlebarTitle 顶栏标题决策断言：专职工位强契约，杜绝占位语脱节', () => {
    const profiles = [{ name: 'aura', displayName: 'Aura' }];
    const groupRooms = [{ roomId: 'room-1', name: '全栈研讨室' }];
    const sessions = [{ id: 'sess-1', title: '普通调研会话' }];

    // 1. Bot 工位
    const botTitle = resolveTitlebarTitle({
      activeFocus: { type: 'bot', botName: 'aura' },
      profiles,
      groupRooms,
      sessions,
      defaultTitle: 'Hermes Flux — 请选择或新建会话',
      notConnectedTitle: '未连接网关',
      defaultRoomName: '多智能体研讨室',
      isConnected: true,
    });
    assert.equal(botTitle, 'Aura', '处于 Bot 工位时标题必须呈现纯净名称，不得夹带 🤖 与 (Forever Chat) 冗余（PR-3e）');

    // 2. 群聊工位
    const groupTitle = resolveTitlebarTitle({
      activeFocus: { type: 'group', roomId: 'room-1' },
      profiles,
      groupRooms,
      sessions,
      defaultTitle: 'Hermes Flux — 请选择或新建会话',
      notConnectedTitle: '未连接网关',
      defaultRoomName: '多智能体研讨室',
      isConnected: true,
    });
    assert.equal(groupTitle, '👥 全栈研讨室', '处于群聊工位时必须展示群聊名称');

    // 3. 普通会话工位
    const sessionTitle = resolveTitlebarTitle({
      activeFocus: { type: 'session', sessionId: 'sess-1' },
      profiles,
      groupRooms,
      sessions,
      activeSessionId: 'sess-1',
      defaultTitle: 'Hermes Flux — 请选择或新建会话',
      notConnectedTitle: '未连接网关',
      defaultRoomName: '多智能体研讨室',
      isConnected: true,
    });
    assert.equal(sessionTitle, '普通调研会话', '处于普通会话时必须展示会话标题');

    // 4. 未连接网关回退
    const disconnectedTitle = resolveTitlebarTitle({
      activeFocus: undefined,
      profiles,
      defaultTitle: 'Hermes Flux — 请选择或新建会话',
      notConnectedTitle: '未连接网关',
      defaultRoomName: '多智能体研讨室',
      isConnected: false,
    });
    assert.equal(disconnectedTitle, '未连接网关');

    // 5. 专职工位真实头像解析断言（PR-3e）
    const botAvatar = resolveTitlebarAvatar({
      activeFocus: { type: 'bot', botName: 'aura' },
      profiles: [{ name: 'aura', displayName: 'Aura', avatar: 'data:image/png;base64,real' }],
    });
    assert.deepEqual(botAvatar, { avatar: 'data:image/png;base64,real', name: 'Aura' }, '专职工位必须精准解析真实头像');

    const noAvatar = resolveTitlebarAvatar({
      activeFocus: { type: 'session', sessionId: 'sess-1' },
      profiles: [{ name: 'aura', displayName: 'Aura' }],
      sessions: [{ id: 'sess-1', title: '普通调研会话' }],
    });
    assert.equal(noAvatar, undefined, '非 Bot 专属会话安全降级为 undefined');
  });

  await t.test('5. 真实渲染消费端闭环验证：renderLeftRail 消费 syncBotProfiles 产物', () => {
    // 1. Arrange: 将 syncBotProfiles 产物送入 renderLeftRail 进行真实 DOM 字符串装配
    const profiles = syncBotProfiles({
      profiles: [
        {
          name: 'aura',
          displayName: 'aura',
          avatar: 'data:image/png;base64,mock',
          description: '专业助手',
        },
      ],
      activityMap: new Map([
        [
          'aura',
          {
            lastMessage: '已收到 Flux E2E 第 2 轮自动化验证消息。',
            timestamp: 1730472540000,
          },
        ],
      ]),
      foreverChatCache: new Map(),
      sessionMessagesCache: new Map(),
      formatTime: formatTimeMock,
    });

    const regularSessions = [
      {
        id: 'sess-ultraman',
        title: '奥特曼反差猫短剧方案',
        botName: 'aura',
        preview: '短剧方案，主角奥特曼，反差猫，想想几个...',
        time: '昨天 23:54',
        timestamp: 1730476440000,
      },
    ];

    // 2. Act
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: 'forever-chat-aura',
      activeFocus: { type: 'bot', botName: 'aura' },
      profileName: 'aura',
      profiles,
      sessions: regularSessions,
      gatewayOnline: true,
      gatewayLatencyMs: 12,
    });

    // 3. Assert：主工位卡区间以抽屉内下一个区块（群聊或会话手风琴）为界
    const cardStartIndex = html.indexOf('rail-primary-agent-card');
    assert.ok(cardStartIndex > -1, '必须渲染主工位卡');
    const boundaries = ['rail-groups-accordion-trigger', 'rail-sessions-accordion-trigger']
      .map((marker) => html.indexOf(marker, cardStartIndex))
      .filter((index) => index > -1);
    const cardEndIndex = boundaries.length > 0 ? Math.min(...boundaries) : html.length;
    const cardHtml = html.slice(cardStartIndex, cardEndIndex);

    assert.ok(cardHtml.includes('已收到 Flux E2E 第 2 轮自动化验证消息。'), '主卡片副标题必须匹配生产同步产物');
    assert.ok(cardHtml.includes('昨天 22:49'), '主卡片时间必须匹配生产同步产物「昨天 22:49」');
    // 主工位卡的时间只来自 profile 快照；普通会话的 23:54 若出现在卡片区间即为污染
    const cardTime = /<time[^>]*>([^<]*)<\/time>/.exec(cardHtml);
    assert.ok(cardTime, '主卡片必须渲染时间元素');
    assert.equal(cardTime[1].includes('23:54'), false, '主卡片时间绝对未被普通会话池覆盖');
    assert.equal(cardHtml.includes('奥特曼反差猫'), false, '主卡片绝对未包含普通会话标题');
  });
});
