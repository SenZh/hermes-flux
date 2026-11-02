import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLeftRail } from '../../../../packages/ui/dist/index.js';

/**
 * 双轨架构、Agent微轨常驻、三态指示与抽屉第一行联动测试
 * (Station Rail Dual Architecture Invariants)
 */
test('Station Rail Dual Architecture & State Invariants', async (t) => {
  const baseProfiles = [
    {
      name: 'default',
      displayName: 'Default 助理',
      isDefault: true,
      activityState: 'read',
      lastMessage: '主中枢已就绪',
      lastTime: '10:00',
    },
    {
      name: 'arch-wang',
      displayName: '架构老王',
      activityState: 'running',
      lastMessage: '已完成 SQLite WAL 锁模型复查',
      lastTime: '10:42',
      avatar: 'data:image/png;base64,mock-avatar',
    },
    {
      name: 'fe-zhang',
      displayName: '前端小张',
      activityState: 'unread',
      lastMessage: '页面组件已完成重构',
      lastTime: '09:30',
    },
    {
      name: 'qa-li',
      displayName: '测试小李',
      activityState: 'read',
      lastMessage: '全量门禁回归测试已跑通',
      lastTime: '08:15',
    },
  ];

  await t.test('1. 物理微轨常驻与独立平滑滚动容器 - 支持无限 Agent 列表自由滑动', () => {
    // 1. Arrange & Act
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 12,
      profiles: baseProfiles,
      sessions: [],
    });

    // 3. Assert
    assert.ok(html.includes('id="flux-station-rail"'), '必须包含 52px 物理微轨容器');
    assert.ok(html.includes('class="station-agents-scroll"'), '微轨必须具备独立的垂直平滑滚动容器');
    assert.ok(html.includes('overflow-y: auto'), '微轨滚动容器必须配置 overflow-y: auto 支持滚轮上下滑动');
    assert.ok(html.includes('scrollbar-width: none'), '微轨必须隐藏原生粗糙滚动条保持美观');

    // 检查所有专职 Agent 是否全部作为独立徽章挂载在微轨中
    assert.ok(html.includes('data-station-profile="arch-wang"'), '架构老王必须挂载在微轨中');
    assert.ok(html.includes('data-station-profile="fe-zhang"'), '前端小张必须挂载在微轨中');
    assert.ok(html.includes('data-station-profile="qa-li"'), '测试小李必须挂载在微轨中');
  });

  await t.test('2. 三态指示器在微轨与抽屉中的精准映射 (running 呼吸脉冲 / unread 绿点 / read 纯净)', () => {
    // 1. Arrange & Act
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      profileName: 'arch-wang',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      profiles: baseProfiles,
      sessions: [],
    });

    // 2. 截取架构老王在微轨上的徽章 HTML
    const wangIndex = html.indexOf('data-station-profile="arch-wang"');
    assert.ok(wangIndex !== -1, '老王微轨徽章必须存在');
    const wangBadge = html.slice(wangIndex, wangIndex + 1500);

    // Assert: 老王处于 running，必须含有 activity-pulse-indicator，绝不含 unread
    assert.ok(wangBadge.includes('activity-pulse-indicator'), '正在执行中的 Agent 徽章必须包含呼吸脉冲光环');
    assert.ok(!wangBadge.includes('activity-unread-badge'), '执行中严禁展示未读绿点');

    // 3. 截取前端小张在微轨上的徽章 HTML
    const zhangIndex = html.indexOf('data-station-profile="fe-zhang"');
    assert.ok(zhangIndex !== -1, '小张微轨徽章必须存在');
    const zhangBadge = html.slice(zhangIndex, zhangIndex + 1500);

    // Assert: 小张处于 unread，必须含有 activity-unread-badge，绝不含 running
    assert.ok(zhangBadge.includes('activity-unread-badge'), '已完成未读的 Agent 徽章必须包含翡翠小绿点');
    assert.ok(!zhangBadge.includes('activity-pulse-indicator'), '未读态严禁展示呼吸脉冲');

    // 4. 截取测试小李在微轨上的徽章 HTML
    const liIndex = html.indexOf('data-station-profile="qa-li"');
    assert.ok(liIndex !== -1, '小李微轨徽章必须存在');
    const liBadge = html.slice(liIndex, liIndex + 1500);

    // Assert: 小李处于 read，必须无任何指示器
    assert.ok(!liBadge.includes('activity-pulse-indicator'), '已读 Agent 徽章严禁包含脉冲');
    assert.ok(!liBadge.includes('activity-unread-badge'), '已读 Agent 徽章严禁包含绿点');
  });

  await t.test('3. 抽屉第一行核心卡片 - 展示当前 Agent 头像、名称、最新消息摘要与最后活跃时间', () => {
    // 1. Arrange: 当前激活焦点为架构老王
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      activeFocus: { type: 'bot', botName: 'arch-wang' },
      profileName: 'arch-wang',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      profiles: baseProfiles,
      sessions: [
        {
          id: 'sess-wang-1',
          title: '老王的旁聊分支',
          botName: 'arch-wang',
          timestamp: 9500,
          preview: '局部重排优化中',
        },
      ],
    });

    // 2. Act: 提取抽屉第一行大卡片
    const primaryIndex = html.indexOf('rail-primary-agent-card');
    assert.ok(primaryIndex !== -1, '抽屉第一行必须渲染核心工位大卡片');
    const primaryCard = html.slice(primaryIndex, primaryIndex + 3000);

    // 3. Assert: 验证名称、摘要、时间完整性
    assert.ok(primaryCard.includes('架构老王'), '第一行卡片必须包含当前 Agent 显示名称');
    assert.ok(primaryCard.includes('已完成 SQLite WAL 锁模型复查'), '第一行卡片必须包含最新消息摘要');
    assert.ok(primaryCard.includes('10:42'), '第一行卡片必须包含最后活跃时间');
    assert.ok(primaryCard.includes('activity-pulse-indicator'), '第一行卡片必须呈现该 Agent 正在运行的呼吸指示器');
  });

  await t.test('4. 生产 HTML 属性契约与折叠不变量断言 - 微轨 52px 永远常驻，且点击契约完全闭环', () => {
    // 1. Arrange & Act: 生成折叠态下的左轨 HTML
    const collapsedHtml = renderLeftRail({
      collapsed: true,
      activeSessionId: '',
      activeFocus: { type: 'bot', botName: 'default' },
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      profiles: baseProfiles,
      sessions: [],
    });

    // 2. Assert: 验证折叠态下的物理结构（微轨 52px 必须存在并可见，抽屉必须收起）
    assert.ok(collapsedHtml.includes('id="flux-station-rail"'), '折叠态下 52px 物理微轨绝对禁止被移除');
    assert.ok(collapsedHtml.includes('width: 52px'), '折叠态下左轨总宽度必须精准收敛为 52px 微轨宽度');
    assert.ok(collapsedHtml.includes('data-station-profile="arch-wang"'), '折叠态下老王微轨头像必须依然可点击');
    assert.ok(collapsedHtml.includes('class="flux-context-drawer"'), '抽屉容器必须存在');
    assert.match(collapsedHtml, /display:\s*none/, '抽屉在折叠态下必须被隐藏');

    // 3. 验证微轨头像与抽屉第一行大卡片的事件绑定契约 (data-profile 与 data-station-profile)
    const normalHtml = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      activeFocus: { type: 'bot', botName: 'arch-wang' },
      profileName: 'arch-wang',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      profiles: baseProfiles,
      sessions: [],
    });

    assert.ok(
      normalHtml.includes('data-station-profile="arch-wang"'),
      '微轨头像必须包含 data-station-profile="arch-wang"，保证微轨点击直达'
    );
    assert.ok(
      normalHtml.includes('rail-primary-agent-card active'),
      '抽屉第一行大卡片必须处于激活态'
    );
    assert.ok(
      normalHtml.includes('data-primary-bot="arch-wang"'),
      '抽屉第一行大卡片必须包含 data-primary-bot="arch-wang"，保证与微轨点击 100% 行为等价'
    );
  });

  await t.test('5. 网关真实自定义头像渲染断言 - 优先渲染 img 标签，无自定义时才安全回退', () => {
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      activeFocus: { type: 'bot', botName: 'arch-wang' },
      profileName: 'arch-wang',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      profiles: baseProfiles,
      sessions: [],
    });

    // 架构老王配置了自定义头像 base64
    assert.ok(
      html.includes('src="data:image/png;base64,mock-avatar"'),
      '带有自定义头像资产的 Agent 必须 100% 渲染真实 <img> 标签'
    );

    // 5. 打印小张徽章检查内容并精准断言
    const zhangIndex = html.indexOf('data-station-profile="fe-zhang"');
    assert.ok(zhangIndex !== -1, '小张徽章必须存在');
    const zhangBadge = html.slice(zhangIndex, zhangIndex + 1200);
    assert.ok(!zhangBadge.slice(0, zhangBadge.indexOf('</div>')).includes('<img'), '未配置自定义头像的 Agent 徽章严禁渲染 <img>');
    assert.ok(zhangBadge.includes('<svg') || zhangBadge.includes('viewBox'), '未配置自定义头像的 Agent 徽章必须安全回退至几何图腾 SVG');
  });

  await t.test('6. 抽屉会话与群聊严格上下文隔离 - 绝对不展示其他 Agent 的会话 (含老王视角与 Default 视角双向断言)', () => {
    const mixedSessions = [
      { id: 's-default', title: 'Default 的主任务', botName: 'default', timestamp: 1000 },
      { id: 's-wang-1', title: '老王专属架构评审', botName: 'arch-wang', timestamp: 3000 },
      { id: 's-wang-2', title: '老王专属数据库调优', botName: 'arch-wang', timestamp: 4000 },
      { id: 's-zhang-1', title: '小张的前端改动', botName: 'fe-zhang', timestamp: 5000 },
    ];

    const mixedGroups = [
      { roomId: 'g-wang', name: '老王架构专班', members: ['arch-wang'], updatedAt: 8000 },
      { roomId: 'g-zhang', name: '前端攻坚群', members: ['fe-zhang'], updatedAt: 9000 },
    ];

    // 1. 当用户聚焦在架构老王 arch-wang 时：
    const htmlWang = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      activeFocus: { type: 'bot', botName: 'arch-wang' },
      profileName: 'arch-wang',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      profiles: baseProfiles,
      sessions: mixedSessions,
      groups: mixedGroups,
    });

    // 抽屉内必须只包含老王相关的会话，小张的会话必须严格被排除！
    assert.ok(htmlWang.includes('老王专属架构评审'), '老王的会话必须展示在抽屉中');
    assert.ok(htmlWang.includes('老王专属数据库调优'), '老王的会话必须展示在抽屉中');
    assert.ok(!htmlWang.includes('小张的前端改动'), '【核心硬隔离】：小张的会话绝对禁止出现在老王的抽屉中！');
    assert.ok(!htmlWang.includes('Default 的主任务'), '【核心硬隔离】：Default 的会话绝对禁止出现在老王的抽屉中！');

    // 群聊同样严格隔离
    assert.ok(htmlWang.includes('老王架构专班'), '老王参与的群聊必须展示');
    assert.ok(!htmlWang.includes('前端攻坚群'), '【核心硬隔离】：老王未参与的前端群聊绝对禁止出现！');

    // 2. 当用户聚焦在 Default 主中枢时：
    const htmlDefault = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      activeFocus: { type: 'bot', botName: 'default' },
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      profiles: baseProfiles,
      sessions: mixedSessions,
      groups: mixedGroups,
    });

    // 抽屉内只展示 Default 任务，老王和小张的专职工位专属会话必须被严格排除！
    assert.ok(htmlDefault.includes('Default 的主任务'), 'Default 的主任务必须展示在 Default 抽屉中');
    assert.ok(!htmlDefault.includes('老王专属架构评审'), '【核心硬隔离】：老王的专属会话绝对禁止出现在 Default 抽屉中！');
    assert.ok(!htmlDefault.includes('小张的前端改动'), '【核心硬隔离】：小张的专属会话绝对禁止出现在 Default 抽屉中！');
  });
});
