/**
 * 双轨架构、Agent 微轨常驻、三态独立性与抽屉第一行联动（React 实现）。
 *
 * 断言口径从"模板字符串 substring"升级为"真实渲染结果"，但守护的不变量不变：
 * 微轨永不消失、三态严格互斥且按域隔离、主工位卡只吃 Bot 快照、点击契约完整。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLeftRailHtml } from '../../../../packages/ui/dist/index.js';
import { assertCollapsedRailGeometry } from '../../../../packages/ui/__tests__/helpers/rail-geometry.mjs';
const NOW = new Date(2026, 10, 3, 15, 30).getTime();

function renderRail(props = {}) {
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

function between(markup, startMarker, endMarker) {
  const start = markup.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? markup.indexOf(endMarker, start + startMarker.length) : markup.length;
  return markup.slice(start, end === -1 ? markup.length : end);
}

test('Station Rail Dual Architecture & State Invariants (React)', async (t) => {
  const baseProfiles = [
    { name: 'default', displayName: 'Default 助理', isDefault: true, activityState: 'read', lastMessage: '主中枢已就绪', lastTime: '10:00' },
    { name: 'arch-wang', displayName: '架构老王', activityState: 'running', lastMessage: '已完成 SQLite WAL 锁模型复查', lastTime: '10:42', avatar: 'data:image/png;base64,mock-avatar' },
    { name: 'fe-zhang', displayName: '前端小张', activityState: 'unread', lastMessage: '页面组件已完成重构', lastTime: '09:30' },
    { name: 'qa-li', displayName: '测试小李', activityState: 'read', lastMessage: '全量门禁回归测试已跑通', lastTime: '08:15' },
  ];

  await t.test('1. 物理微轨常驻与独立平滑滚动容器 - 支持无限 Agent 列表自由滑动', () => {
    const html = renderRail({ profiles: baseProfiles });

    assert.ok(html.includes('id="flux-station-rail"'), '必须包含 52px 物理微轨容器');
    assert.ok(html.includes('station-agents-scroll'), '微轨必须具备独立的垂直平滑滚动容器');
    assert.ok(html.includes('overflow-y-auto'), '微轨滚动容器必须配置 overflow-y: auto');
    assert.ok(html.includes('scrollbar-width:none'), '微轨必须隐藏原生粗糙滚动条');

    assert.ok(html.includes('data-station-profile="arch-wang"'));
    assert.ok(html.includes('data-station-profile="fe-zhang"'));
    assert.ok(html.includes('data-station-profile="qa-li"'));
  });

  await t.test('2. 三态指示器在微轨中的精准映射（running 脉冲 / unread 绿点 / read 纯净）', () => {
    const html = renderRail({ profiles: baseProfiles, profileName: 'arch-wang', activeFocus: { type: 'bot', botName: 'arch-wang' } });

    const wang = between(html, 'data-station-profile="arch-wang"', 'data-station-profile="fe-zhang"');
    assert.ok(wang.includes('activity-pulse-indicator'), '执行中 Agent 必须含脉冲');
    assert.equal(wang.includes('activity-unread-badge'), false, '执行中严禁展示未读绿点');

    const zhang = between(html, 'data-station-profile="fe-zhang"', 'data-station-profile="qa-li"');
    assert.ok(zhang.includes('activity-unread-badge'), '未读 Agent 必须含绿点');
    assert.equal(zhang.includes('activity-pulse-indicator'), false, '未读态严禁展示脉冲');

    const li = between(html, 'data-station-profile="qa-li"', 'rail-station-groups-btn');
    assert.equal(li.includes('activity-pulse-indicator'), false, '已读 Agent 严禁脉冲');
    assert.equal(li.includes('activity-unread-badge'), false, '已读 Agent 严禁绿点');
  });

  await t.test('3. 抽屉第一行主工位卡 - 展示当前 Agent 头像、名称、摘要与最后活跃时间', () => {
    const html = renderRail({
      activeFocus: { type: 'bot', botName: 'arch-wang' },
      profileName: 'arch-wang',
      profiles: baseProfiles,
      sessions: [{ id: 'sess-wang-1', title: '老王的旁聊分支', botName: 'arch-wang', timestamp: 9500, preview: '局部重排优化中' }],
    });

    const card = between(html, 'rail-primary-agent-card', 'rail-groups-accordion-trigger');
    assert.ok(card.length > 0, '抽屉第一行必须渲染核心工位大卡片');
    assert.ok(card.includes('架构老王'), '必须包含当前 Agent 显示名称');
    assert.ok(card.includes('已完成 SQLite WAL 锁模型复查'), '必须包含最新消息摘要');
    assert.ok(card.includes('<time'), '必须包含最后活跃时间元素');
    assert.ok(card.includes('activity-pulse-indicator'), '必须呈现该 Agent 正在运行的指示器');
  });

  await t.test('4. 折叠不变量 - 微轨 52px 永远常驻，折叠后无抽屉残留', () => {
    const collapsed = renderRail({ collapsed: true, profiles: baseProfiles, profileName: 'default' });

    assert.ok(collapsed.includes('id="flux-station-rail"'), '折叠态下 52px 物理微轨绝对禁止被移除');
    assertCollapsedRailGeometry(collapsed);
    assert.ok(collapsed.includes('data-station-profile="arch-wang"'), '折叠态下微轨头像必须依然可点击');
    assert.equal(collapsed.includes('flux-context-drawer'), false, '折叠态抽屉必须整体不渲染');

    const normal = renderRail({ profiles: baseProfiles, profileName: 'arch-wang', activeFocus: { type: 'bot', botName: 'arch-wang' } });
    assert.ok(normal.includes('data-station-profile="arch-wang"'), '微轨点击契约必须保留');
    assert.ok(normal.includes('rail-primary-agent-card'), '主工位卡必须存在');
    assert.ok(/rail-primary-agent-card[^"]*\bactive\b/.test(normal), '当前 Agent 的主工位卡必须处于激活态');
    assert.ok(normal.includes('data-primary-bot="arch-wang"'), '主工位卡必须带与微轨等价的点击契约');
  });

  await t.test('5. 网关真实头像优先渲染 img，无资产时安全回退 SVG', () => {
    const html = renderRail({ activeFocus: { type: 'bot', botName: 'arch-wang' }, profileName: 'arch-wang', profiles: baseProfiles });
    assert.ok(html.includes('src="data:image/png;base64,mock-avatar"'), '有自定义头像必须渲染真实 img');

    const zhang = between(html, 'data-station-profile="fe-zhang"', 'data-station-profile="qa-li"');
    assert.equal(zhang.includes('<img'), false, '无自定义头像严禁渲染 img');
    assert.ok(zhang.includes('<svg'), '无自定义头像必须回退几何图腾');
  });

  await t.test('6. 抽屉会话与群聊严格上下文隔离（老王视角与 Default 视角双向）', () => {
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

    const wangHtml = renderRail({ activeFocus: { type: 'bot', botName: 'arch-wang' }, profileName: 'arch-wang', profiles: baseProfiles, sessions: mixedSessions, groups: mixedGroups });
    assert.ok(wangHtml.includes('老王专属架构评审'));
    assert.ok(wangHtml.includes('老王专属数据库调优'));
    assert.equal(wangHtml.includes('小张的前端改动'), false, '小张的会话绝对禁止出现在老王抽屉');
    assert.equal(wangHtml.includes('Default 的主任务'), false, 'Default 的会话绝对禁止出现在老王抽屉');
    assert.ok(wangHtml.includes('老王架构专班'));
    assert.equal(wangHtml.includes('前端攻坚群'), false, '老王未参与的群绝对禁止出现');

    const defaultHtml = renderRail({ activeFocus: { type: 'bot', botName: 'default' }, profileName: 'default', profiles: baseProfiles, sessions: mixedSessions, groups: mixedGroups });
    assert.ok(defaultHtml.includes('Default 的主任务'));
    assert.equal(defaultHtml.includes('老王专属架构评审'), false);
    assert.equal(defaultHtml.includes('小张的前端改动'), false);
  });

  await t.test('7. 变异检验：三态渲染若串域必然被检出', () => {
    const html = renderRail({
      profiles: [{ name: 'only-read', displayName: '纯已读', activityState: 'read', timestamp: NOW }],
      activeFocus: { type: 'bot', botName: 'only-read' },
      profileName: 'only-read',
    });
    const station = between(html, 'data-station-profile="only-read"', 'rail-station-groups-btn');
    assert.equal(station.includes('activity-pulse-indicator'), false);
    assert.equal(station.includes('activity-unread-badge'), false);
  });
});
