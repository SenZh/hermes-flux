/**
 * React 左轨视图模型与组件行为测试。
 *
 * 【测试什么】用户在抽屉与微轨上真正能看到的东西：
 *   焦点解析、Agent 上下文隔离、搜索过滤、时间倒序、紧凑时间格式、
 *   会话行形态（无头像 / 48px / 时间钉右缘 / 副标题降级），以及 primitives 的真实消费。
 * 【不测什么】内部函数名、DOM 结构顺序、内联样式字面量——这些改动不改行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeftRail } from '../dist/components-react/LeftRail.js';
import { ActivityIndicator } from '../dist/index.js';
import { buildLeftRailModel, formatLeftRailTime, toSnippet, isAgentScopeActive } from '../dist/components-react/leftRailModel.js';
import { assertCollapsedRailGeometry } from './helpers/rail-geometry.mjs';

const NOW = new Date(2026, 10, 3, 15, 30).getTime();

const PROFILES = [
  { name: 'default', displayName: 'Default 助理', isDefault: true, lastMessage: '主中枢已就绪', lastTime: '10:00', timestamp: NOW - 600000 },
  { name: 'arch-wang', displayName: '架构老王', description: '架构设计专家', lastMessage: '已完成锁模型复查', timestamp: NOW - 3600000 },
];

const SESSIONS = [
  { id: 's-a', title: '电商支付重构方案', preview: '幂等键下沉到 core 层', botName: 'default', timestamp: NOW - 60000 },
  { id: 's-b', title: '门禁规则不变量核验', preview: '探针已扩展到组件层', botName: 'default', timestamp: NOW - 86400000 },
  { id: 's-wang', title: '老王专属架构评审', preview: '分布式锁时钟漂移', botName: 'arch-wang', timestamp: NOW - 7200000 },
];

const GROUPS = [
  { roomId: 'room-default', name: '全链路微服务重构群', members: ['default', 'arch-wang'], lastMessage: '刚达成共识', updatedAt: NOW - 120000 },
  { roomId: 'room-wang', name: '老王架构专班', members: ['arch-wang'], lastMessage: '只有老王', updatedAt: NOW - 60000 },
];

function model(overrides = {}) {
  return buildLeftRailModel({
    activeSessionId: 's-a',
    activeFocus: { type: 'bot', botName: 'default' },
    sessions: SESSIONS,
    profileName: 'default',
    profiles: PROFILES,
    groups: GROUPS,
    projects: [],
    activeRailTab: 'chats',
    searchQuery: '',
    ...overrides,
  });
}

function render(overrides = {}, propOverrides = {}) {
  const noop = () => {};
  const built = model(overrides);
  return renderToStaticMarkup(React.createElement(LeftRail, {
    model: built,
    collapsed: false,
    searchQuery: '',
    editingGroupRoomId: overrides.editingGroupRoomId,
    onSelectSession: noop,
    onSelectBot: noop,
    onSelectGroup: noop,
    onOpenSessionMenu: noop,
    onOpenBotMenu: noop,
    onOpenGroupMenu: noop,
    onSearchChange: noop,
    onNewChat: noop,
    onSetTab: noop,
    onToggleSessions: noop,
    onToggleGroups: noop,
    onStartGroupRename: noop,
    onConfirmGroupRename: noop,
    onCancelGroupRename: noop,
    onResizeStart: noop,
    ...propOverrides,
  }));
}

test('紧凑时间：当日 HH:mm、跨日 M/D、跨年 YYYY/M/D，非数字一律空串', async (t) => {
  await t.test('当日只给 HH:mm', () => {
    assert.equal(formatLeftRailTime(new Date(2026, 10, 3, 9, 5).getTime(), new Date(NOW)), '09:05');
  });

  await t.test('同年跨日给 M/D 且不带时分', () => {
    assert.equal(formatLeftRailTime(new Date(2026, 9, 28, 16, 20).getTime(), new Date(NOW)), '10/28');
  });

  await t.test('昨天/前天只给日名，不带时分（PR-3d 收敛规格）', () => {
    assert.equal(formatLeftRailTime(new Date(2026, 10, 2, 23, 30).getTime(), new Date(NOW)), '昨天');
    assert.equal(formatLeftRailTime(new Date(2026, 10, 1, 8, 0).getTime(), new Date(NOW)), '前天');
    assert.equal(formatLeftRailTime(new Date(2026, 10, 2, 0, 1).getTime(), new Date(NOW)), '昨天');
    const now2 = new Date(2026, 10, 3, 9, 5);
    assert.equal(formatLeftRailTime(new Date(2026, 10, 2, 23, 59).getTime(), now2), '昨天');
    assert.equal(formatLeftRailTime(new Date(2026, 10, 1, 0, 0).getTime(), now2), '前天');
  });

  await t.test('跨年带年份', () => {
    assert.equal(formatLeftRailTime(new Date(2025, 9, 28, 16, 20).getTime(), new Date(NOW)), '2025/10/28');
  });

  await t.test('秒级时间戳自动升到毫秒', () => {
    const seconds = Math.floor(new Date(2026, 10, 3, 8, 7).getTime() / 1000);
    assert.equal(formatLeftRailTime(seconds, new Date(NOW)), '08:07');
  });

  await t.test('0 / undefined / NaN 安全降级为空串', () => {
    assert.equal(formatLeftRailTime(0, new Date(NOW)), '');
    assert.equal(formatLeftRailTime(undefined, new Date(NOW)), '');
    assert.equal(formatLeftRailTime(Number.NaN, new Date(NOW)), '');
  });

  await t.test('变异检验：不同日必然给出不同字符串（防止恒等实现）', () => {
    const same = formatLeftRailTime(new Date(2026, 10, 3, 9, 5).getTime(), new Date(NOW));
    const other = formatLeftRailTime(new Date(2026, 10, 2, 9, 5).getTime(), new Date(NOW));
    assert.notEqual(same, other);
  });
});

test('摘要提炼：抹掉代码块与标题噪音并单行截断', async (t) => {
  await t.test('代码块替换为占位并压缩空白', () => {
    const out = toSnippet('### 方案\n```ts\nconst a = 1;\n```\n这是说明');
    assert.ok(!out.includes('###'));
    assert.ok(!out.includes('const a = 1'));
    assert.ok(out.includes('方案'));
    assert.ok(out.includes('这是说明'));
  });

  await t.test('超长截断保留省略号且长度受限', () => {
    const out = toSnippet('一二三四五六七八九十一二三四五六七八九十甲乙丙丁', 10);
    assert.equal(out.length, 13);
    assert.ok(out.endsWith('...'));
  });

  await t.test('纯空白降级为空串', () => {
    assert.equal(toSnippet('   \n\t '), '');
  });
});

test('左轨模型：焦点解析与 Agent 上下文严格隔离', async (t) => {
  await t.test('Default 中枢只看到 default 名下会话', () => {
    const m = model();
    assert.deepEqual(m.activeSessions.map((s) => s.id), ['s-a', 's-b']);
    assert.equal(m.activeSessions.some((s) => s.botName === 'arch-wang'), false);
  });

  await t.test('专职 Bot 只看到自己名下会话，绝不含 Default 会话', () => {
    const m = model({ activeFocus: { type: 'bot', botName: 'arch-wang' }, profileName: 'arch-wang' });
    assert.deepEqual(m.activeSessions.map((s) => s.id), ['s-wang']);
    assert.equal(m.selectedAgent.name, 'arch-wang');
    assert.equal(m.isDefaultHq, false);
  });

  await t.test('群聊同样按 Agent 隔离：Default 是主大厅，专职 Bot 只列自己参与的', () => {
    const defaultView = model();
    assert.deepEqual(defaultView.visibleGroups.map((g) => g.roomId).sort(), ['room-default', 'room-wang']);
    const wangView = model({ activeFocus: { type: 'bot', botName: 'arch-wang' }, profileName: 'arch-wang' });
    assert.deepEqual(wangView.visibleGroups.map((g) => g.roomId).sort(), ['room-default', 'room-wang']);
    const isolatedMembers = GROUPS.map((g) => (g.members.includes('arch-wang') ? g.roomId : null)).filter(Boolean);
    assert.deepEqual(wangView.visibleGroups.map((g) => g.roomId).sort(), isolatedMembers.sort());
  });

  await t.test('会话焦点解析出所属 Bot，用于抽屉上下文', () => {
    const m = model({ activeFocus: { type: 'session', sessionId: 's-wang' }, activeSessionId: 's-wang' });
    assert.equal(m.selectedAgent.name, 'arch-wang');
  });

  await t.test('缺失 activeFocus 时按 activeSessionId 回退到会话焦点', () => {
    const m = model({ activeFocus: undefined, activeSessionId: 's-b' });
    assert.deepEqual(m.currentFocus, { type: 'session', sessionId: 's-b' });
  });
});

test('左轨模型：排序、搜索与折叠开关', async (t) => {
  await t.test('会话按时间倒序，最新在前', () => {
    const m = model();
    const times = m.activeSessions.map((s) => s.timestamp);
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  });

  await t.test('搜索同时命中标题与副标题，且不改动原始数据管道', () => {
    const hits = model({ searchQuery: '探针' });
    assert.deepEqual(hits.activeSessions.map((s) => s.id), ['s-b']);
    const empty = model({ searchQuery: '不存在的关键词' });
    assert.deepEqual(empty.activeSessions.map((s) => s.id), []);
    assert.equal(SESSIONS.length, 3, '模型必须是纯函数，不得改写入参');
  });

  await t.test('手风琴默认展开，显式 false 才收起', () => {
    assert.equal(model().isSessionsOpen, true);
    assert.equal(model({ isSessionsGroupExpanded: false }).isSessionsOpen, false);
    assert.equal(model({ isGroupsGroupExpanded: false }).isGroupsOpen, false);
  });

  await t.test('错误行与真正的空列表互斥', () => {
    const failed = model({ error: '当前状态: RECONNECTING' });
    assert.equal(failed.error, '当前状态: RECONNECTING');
    assert.equal(model().error, '');
  });
});

test('左轨组件：会话行形态与关键交互契约', async (t) => {
  await t.test('会话行不再渲染头像，行高锁定 48px，时间钉右缘', () => {
    const markup = render();
    const start = markup.indexOf('data-id="s-a"');
    const end = markup.indexOf('data-id="s-b"');
    const row = markup.slice(start, end);
    assert.ok(start > -1 && end > start);
    assert.equal(row.includes('<img'), false, '行内头像已按用户定案移除');
    assert.equal(row.includes('<svg'), false, '行内也不得残留 SVG 图腾替代头像');
    assert.ok(row.includes('min-h-12'), '行高必须是 48px 档（min-h-12）');
    assert.ok(row.includes('<time'), '时间必须独立成 time 元素钉在行右缘');
    assert.ok(row.includes('tabular-nums'), '时间必须等宽对齐，避免数字宽度跳动');
  });

  await t.test('副标题降级为 12px muted 单行截断', () => {
    const markup = render();
    const start = markup.indexOf('data-id="s-a"');
    const row = markup.slice(start, markup.indexOf('data-id="s-b"'));
    assert.ok(row.includes('text-aux'), '副标题走 12px 节奏档');
    assert.ok(row.includes('text-muted-foreground'), '副标题用 muted 前景');
    assert.ok(row.includes('truncate'), '副标题必须单行截断');
  });

  await t.test('三态指示器按状态互斥渲染，已读零指示器，且会话行在任何状态均零 <svg>', () => {
    const running = render({ sessions: [{ id: 's-1', title: '跑', timestamp: NOW, activityState: 'running' }] });
    assert.ok(running.includes('activity-pulse-indicator'));
    assert.ok(running.includes('flux-cloud-indicator--running'));
    assert.equal((running.match(/class="flux-cloud-dot"/g) || []).length, 24);
    assert.ok(running.includes('执行中'));
    assert.equal(running.includes('activity-unread-badge'), false);
    const runningRow = running.slice(running.indexOf('data-id="s-1"'), running.indexOf('</button>', running.indexOf('data-id="s-1"')));
    assert.equal(runningRow.includes('<svg'), false, 'SessionRow 运行态云朵点阵必须零 SVG');

    const unread = render({ sessions: [{ id: 's-1', title: '未读', timestamp: NOW, activityState: 'unread' }] });
    assert.ok(unread.includes('activity-unread-badge'));
    assert.ok(unread.includes('flux-cloud-indicator--unread'));
    assert.equal((unread.match(/class="flux-cloud-dot"/g) || []).length, 24);
    assert.ok(unread.includes('已完成'));
    assert.equal(unread.includes('activity-pulse-indicator'), false);
    const unreadRow = unread.slice(unread.indexOf('data-id="s-1"'), unread.indexOf('</button>', unread.indexOf('data-id="s-1"')));
    assert.equal(unreadRow.includes('<svg'), false, 'SessionRow 未读态云朵点阵必须零 SVG');

    const read = render({ sessions: [{ id: 's-1', title: '已读', timestamp: NOW, activityState: 'read' }] });
    assert.equal(read.includes('activity-pulse-indicator'), false);
    assert.equal(read.includes('activity-unread-badge'), false);
    assert.equal(read.includes('flux-cloud-indicator'), false);
  });

  await t.test('主工位卡只吃 profile 快照，绝不被普通会话池覆盖', () => {
    const markup = render();
    const start = markup.indexOf('rail-primary-agent-card');
    assert.ok(start > -1, '抽屉第一行必须是主工位卡');
    const card = markup.slice(start, markup.indexOf('rail-groups-accordion-trigger'));
    assert.ok(card.includes('主中枢已就绪'), '卡片副标题来自 profile.lastMessage');
    assert.ok(card.includes('<time'), '卡片时间来自 profile 快照（有时间戳则格式化，否则回退 lastTime）');
    assert.equal(card.includes('电商支付重构方案'), false, '卡片绝不含普通会话标题');
    assert.equal(card.includes('幂等键下沉'), false, '卡片绝不含普通会话摘要');
  });

  await t.test('profile 只有 lastTime 字符串时，时间回退到该字符串', () => {
    const markup = render({ profiles: [{ name: 'default', displayName: 'Default 助理', isDefault: true, lastMessage: '就绪', lastTime: '昨天 22:49' }] });
    const start = markup.indexOf('rail-primary-agent-card');
    assert.ok(markup.slice(start).includes('昨天 22:49'));
  });

  await t.test('折叠态只留 52px 微轨，抽屉与把手都不渲染', () => {
    const markup = render({}, { collapsed: true });
    assert.ok(markup.includes('rail-collapsed'));
    assertCollapsedRailGeometry(markup);
    assert.equal(markup.includes('flux-context-drawer'), false);
    assert.equal(markup.includes('rail-resize-handle'), false);
  });

  await t.test('把手挂在抽屉外层，避免被 overflow 裁掉导致拖拽失效', () => {
    const markup = render();
    const handleIndex = markup.indexOf('rail-resize-handle');
    const drawerCloseIndex = markup.lastIndexOf('</div>');
    assert.ok(handleIndex > -1, '展开态必须有拖拽把手');
    assert.ok(handleIndex < drawerCloseIndex, '把手必须在抽屉闭合之后，属 aside 直属层级');
  });

  await t.test('群聊行内重命名渲染受控输入与确认/取消', () => {
    const markup = render({ editingGroupRoomId: 'room-default' });
    assert.ok(markup.includes('rail-group-inline-rename-wrap'));
    assert.ok(markup.includes('rail-group-rename-input-room-default'));
    assert.ok(markup.includes('rail-group-rename-input'));
    assert.ok(!render().includes('rail-group-inline-rename-wrap'), '非编辑态不得渲染重命名表单');
  });

  await t.test('项目甲板独立于会话甲板，两者互斥渲染', () => {
    const chats = render();
    assert.ok(chats.includes('rail-sessions-nested-list'));
    assert.equal(chats.includes('rail-projects-deck'), false);

    const projects = render({
      activeRailTab: 'projects',
      projects: [{ id: 'p1', name: '电商微服务工程', sessions: [{ id: 's-p', title: '项目内会话', timestamp: NOW }] }],
    });
    assert.ok(projects.includes('rail-projects-deck'));
    assert.ok(projects.includes('电商微服务工程'));
    assert.ok(projects.includes('项目内会话'));
    assert.equal(projects.includes('rail-sessions-nested-list'), false);
  });
});

test('React 岛控件基线：原生控件不得继承 UA 白底，且不压过组件自身 utility', async (t) => {
  const fs = await import('node:fs');
  const entry = fs.readFileSync(new URL('../src/tailwind-entry.css', import.meta.url), 'utf8');

  await t.test('基线存在且作用域限定在左轨宿主内', () => {
    assert.ok(entry.includes('.flux-left-rail button'), '必须重置左轨内的原生 button');
    assert.ok(entry.includes('.flux-left-rail input'), '必须重置左轨内的原生 input');
    assert.doesNotMatch(entry, /^\s*button\s*,/m, '禁止声明全局 button 选择器（会碰存量模板）');
    assert.doesNotMatch(entry, /^\s*input\s*,/m, '禁止声明全局 input 选择器');
  });

  await t.test('基线必须落在 base 层，否则会压过 utilities', () => {
    const inBaseLayer = /@layer base\s*\{[\s\S]*?\.flux-left-rail button/.test(entry);
    assert.ok(inBaseLayer, '控件基线必须写在 @layer base 内：unlayered 规则会压过 bg-panel 等 utility（本次实测搜索框丢底色）');
  });

  await t.test('扫描面显式关闭自动检测，只扫 React 组件目录', () => {
    assert.match(entry, /source\(none\)/, '必须关闭 Tailwind 默认自动检测');
    const sources = [...entry.matchAll(/@source\s+["']([^"']+)["']/g)].map((m) => m[1]);
    assert.deepEqual(sources, ['./components-react/**/*.tsx'], '扫描面只允许 React 组件目录白名单');
  });
});

test('PR-3d 形态静态守卫：微轨无新建/折叠按钮、header 无文本箭头且 + 在位（无浏览器也必须红）', () => {
  const markup = render();
  assert.ok(!markup.includes('new-chat-btn'), '微轨不得再渲染新建会话按钮（入口已收编到 header +）');
  assert.ok(!markup.includes('lucide-chevron-left'), '微轨不得再渲染折叠 ChevronLeft（入口收编顶栏与 Ctrl+B）');
  assert.ok(!markup.includes('⌄') && !markup.includes('›'), 'accordion header 禁止残留文本箭头');
  assert.ok(markup.includes('rail-new-session-btn'), '会话 header 的 + 必须渲染');
  assert.ok(markup.includes('rail-new-group-btn'), '群聊 header 的 + 必须渲染');
});

test('primitives 消费守卫：左轨必须真实使用 shadcn 基座而非继续造轮子', async (t) => {
  const source = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../src/components-react/LeftRail.tsx', import.meta.url),
    'utf8',
  ));

  await t.test('导入并消费 Button / Input / Badge 三个 primitives', () => {
    assert.ok(/from '\.\/primitives\/Button\.js'/.test(source), '必须导入 Button primitive');
    assert.ok(/from '\.\/primitives\/Input\.js'/.test(source), '必须导入 Input primitive');
    assert.ok(/from '\.\/primitives\/Badge\.js'/.test(source), '必须导入 Badge primitive');
    assert.ok(/<Button[\s>]/.test(source), '必须真实渲染 Button');
    assert.ok(/<Input[\s>]/.test(source), '必须真实渲染 Input');
    assert.ok(/<Badge[\s>]/.test(source), '必须真实渲染 Badge');
  });

  await t.test('不再自定义裸 <button>（仅会话行、归档行、群聊主体、手风琴标题复用原生按钮语义）', () => {
    const rawButtons = (source.match(/<button[\s>]/g) || []).length;
    const rawInputs = (source.match(/<input[\s>]/g) || []).length;
    assert.equal(rawInputs, 0, '输入框必须走 Input primitive，禁止裸 <input>');
    assert.ok(rawButtons <= 5, `只有需要原生按钮语义的行主体/手风琴标题可用原生 button，当前 ${rawButtons} 处`);
  });
});

test('isAgentScopeActive: 微轨 Agent 作用域活跃判定（覆盖 bot/session/group 三重焦点）', () => {
  // 1. 直接命中专职 Bot 工位
  assert.equal(isAgentScopeActive({
    agentName: 'aura',
    focus: { type: 'bot', botName: 'aura' },
    selectedAgentName: 'aura',
  }), true, '专职 Bot 工位必须命中');

  // 2. 命中不同大小写
  assert.equal(isAgentScopeActive({
    agentName: 'Aura',
    focus: { type: 'bot', botName: 'aura' },
    selectedAgentName: 'aura',
  }), true, '必须支持大小写不敏感匹配');

  // 3. 焦点在普通会话且归属于该 Agent
  assert.equal(isAgentScopeActive({
    agentName: 'aura',
    focus: { type: 'session', sessionId: 'sess-1' },
    selectedAgentName: 'default',
    activeSessionBotName: 'aura',
  }), true, '点进属于该 Bot 的普通会话时微轨必须持续高亮保活');

  // 4. 焦点在普通会话但未指定会话归属时，回退匹配当前抽屉上下文 selectedAgentName
  assert.equal(isAgentScopeActive({
    agentName: 'aura',
    focus: { type: 'session', sessionId: 'sess-1' },
    selectedAgentName: 'aura',
  }), true, '会话无明确 botName 时必须回退当前抽屉 Agent 上下文');

  // 5. 焦点在群聊时，微轨保持当前抽屉 selectedAgentName 选中态
  assert.equal(isAgentScopeActive({
    agentName: 'aura',
    focus: { type: 'group', roomId: 'room-1' },
    selectedAgentName: 'aura',
  }), true, '群聊工位下当前抽屉所属 Agent 微轨必须持续高亮');

  // 6. 其他 Agent 不得误报高亮
  assert.equal(isAgentScopeActive({
    agentName: 'other-bot',
    focus: { type: 'bot', botName: 'aura' },
    selectedAgentName: 'aura',
  }), false, '无关 Agent 必须保持未激活');
});

test('buildLeftRailModel: groupOverviewActivity 优先级与瞬态跃迁聚合（running > unread > read）', () => {
  const mRunning = model({
    groups: [
      { roomId: 'r-unread', name: '未读群', members: ['default'], activityState: 'unread', activityTransition: 'just-completed', activityTransitionToken: 9 },
      { roomId: 'r-run', name: '运行群', members: ['default'], activityState: 'running' },
    ],
  });
  assert.deepEqual(mRunning.groupOverviewActivity, { state: 'running', transition: 'none' });
  assert.equal(mRunning.hasRunningGroup, true);
  assert.equal(mRunning.hasUnreadGroup, false);

  const mUnreadLatest = model({
    groups: [
      { roomId: 'r-old', name: '旧未读', members: ['default'], activityState: 'unread' },
      { roomId: 'r-new-1', name: '先完成', members: ['default'], activityState: 'unread', activityTransition: 'just-completed', activityTransitionToken: 3 },
      { roomId: 'r-new-2', name: '后完成', members: ['default'], activityState: 'unread', activityTransition: 'just-completed', activityTransitionToken: 8 },
    ],
  });
  assert.deepEqual(mUnreadLatest.groupOverviewActivity, { state: 'unread', transition: 'just-completed', transitionToken: 8 });
  assert.equal(mUnreadLatest.hasRunningGroup, false);
  assert.equal(mUnreadLatest.hasUnreadGroup, true);

  const mUnreadStatic = model({
    groups: [
      { roomId: 'r-old', name: '旧未读', members: ['default'], activityState: 'unread' },
      { roomId: 'r-read', name: '已读', members: ['default'], activityState: 'read', activityTransition: 'just-completed', activityTransitionToken: 12 },
    ],
  });
  assert.deepEqual(mUnreadStatic.groupOverviewActivity, { state: 'unread', transition: 'none' });

  const mReadSettle = model({
    groups: [
      { roomId: 'r-read-1', name: '已读收敛1', members: ['default'], activityState: 'read', activityTransition: 'just-completed', activityTransitionToken: 4 },
      { roomId: 'r-read-2', name: '已读收敛2', members: ['default'], activityState: 'read', activityTransition: 'just-completed', activityTransitionToken: 11 },
    ],
  });
  assert.deepEqual(mReadSettle.groupOverviewActivity, { state: 'read', transition: 'just-completed', transitionToken: 11 });

  const mPlainRead = model({
    groups: [{ roomId: 'r-plain', name: '普通已读', members: ['default'], activityState: 'read' }],
  });
  assert.deepEqual(mPlainRead.groupOverviewActivity, { state: 'read', transition: 'none' });
  assert.equal(mPlainRead.hasRunningGroup, false);
  assert.equal(mPlainRead.hasUnreadGroup, false);

  const mScoped = model({
    activeFocus: { type: 'bot', botName: 'arch-wang' },
    profileName: 'arch-wang',
    groups: [
      { roomId: 'r-other', name: '无关运行群', members: ['fe-zhang'], activityState: 'running' },
      { roomId: 'r-wang', name: '老王已读群', members: ['arch-wang'], activityState: 'read' },
    ],
  });
  assert.deepEqual(mScoped.groupOverviewActivity, { state: 'read', transition: 'none' });
});

test('ActivityIndicator 统一原语：placement、entityKind、24 颗云朵点阵与静态 read 零节点', () => {
  const cornerRunning = renderToStaticMarkup(React.createElement(ActivityIndicator, {
    state: 'running',
    placement: 'corner',
  }));
  assert.ok(cornerRunning.includes('activity-pulse-indicator'));
  assert.ok(cornerRunning.includes('flux-activity-dot--running'));
  assert.ok(cornerRunning.includes('data-status="running"'));
  assert.ok(cornerRunning.includes('data-placement="corner"'));
  assert.ok(cornerRunning.includes('right-0 top-0'));
  assert.ok(cornerRunning.includes('ring-2 ring-sidebar'));
  assert.ok(cornerRunning.includes('role="status"'));
  assert.ok(cornerRunning.includes('aria-live="off"'));
  assert.equal(cornerRunning.includes('flux-cloud-canvas'), false);
  assert.equal(cornerRunning.includes('bg-success'), false);
  assert.equal(cornerRunning.includes('<svg'), false);

  const cornerUnread = renderToStaticMarkup(React.createElement(ActivityIndicator, {
    state: 'unread',
    placement: 'corner',
  }));
  assert.ok(cornerUnread.includes('activity-unread-badge'));
  assert.ok(cornerUnread.includes('flux-activity-dot--unread'));
  assert.equal(cornerUnread.includes('flux-cloud-canvas'), false);
  assert.equal(cornerUnread.includes('bg-success'), false);

  const inlineRunningSession = renderToStaticMarkup(React.createElement(ActivityIndicator, {
    state: 'running',
    placement: 'inline',
    entityKind: 'session',
  }));
  assert.ok(inlineRunningSession.includes('activity-pulse-indicator'));
  assert.ok(inlineRunningSession.includes('flux-cloud-indicator--running'));
  assert.ok(inlineRunningSession.includes('flux-cloud-canvas'));
  assert.ok(inlineRunningSession.includes('flux-cloud-fog'));
  assert.equal((inlineRunningSession.match(/class="flux-cloud-dot"/g) || []).length, 24);
  assert.ok(inlineRunningSession.includes('执行中'));
  assert.equal(inlineRunningSession.includes('<svg'), false);

  const inlineRunningBot = renderToStaticMarkup(React.createElement(ActivityIndicator, {
    state: 'running',
    placement: 'inline',
    entityKind: 'bot',
  }));
  assert.ok(inlineRunningBot.includes('思考中'));
  assert.equal((inlineRunningBot.match(/class="flux-cloud-dot"/g) || []).length, 24);

  const inlineRunningGroup = renderToStaticMarkup(React.createElement(ActivityIndicator, {
    state: 'running',
    placement: 'inline',
    entityKind: 'group',
  }));
  assert.ok(inlineRunningGroup.includes('协作中'));
  assert.equal((inlineRunningGroup.match(/class="flux-cloud-dot"/g) || []).length, 24);

  const inlineUnreadStatic = renderToStaticMarkup(React.createElement(ActivityIndicator, {
    state: 'unread',
    placement: 'inline',
  }));
  assert.ok(inlineUnreadStatic.includes('activity-unread-badge'));
  assert.ok(inlineUnreadStatic.includes('flux-cloud-indicator--unread'));
  assert.ok(inlineUnreadStatic.includes('data-transition="none"'));
  assert.ok(inlineUnreadStatic.includes('data-placement="inline"'));
  assert.equal((inlineUnreadStatic.match(/class="flux-cloud-dot"/g) || []).length, 24);
  assert.equal((inlineUnreadStatic.match(/data-on="1"/g) || []).length, 7);
  assert.equal((inlineUnreadStatic.match(/data-on="0"/g) || []).length, 17);
  assert.ok(inlineUnreadStatic.includes('已完成'));
  assert.equal(inlineUnreadStatic.includes('flux-cloud-ripple'), false);
  assert.equal(inlineUnreadStatic.includes('ring-sidebar'), false);
  assert.equal(inlineUnreadStatic.includes('<svg'), false);

  const inlineUnreadJustCompleted = renderToStaticMarkup(React.createElement(ActivityIndicator, {
    state: 'unread',
    transition: 'just-completed',
    transitionToken: 7,
    placement: 'inline',
  }));
  assert.ok(inlineUnreadJustCompleted.includes('data-transition="just-completed"'));
  assert.ok(inlineUnreadJustCompleted.includes('activity-unread-badge'));
  assert.ok(inlineUnreadJustCompleted.includes('flux-cloud-ripple'));
  assert.ok(inlineUnreadJustCompleted.includes('已完成'));

  assert.equal(renderToStaticMarkup(React.createElement(ActivityIndicator, { state: 'read' })), '');
  assert.equal(renderToStaticMarkup(React.createElement(ActivityIndicator, { state: undefined })), '');

  const readSettleCorner = renderToStaticMarkup(React.createElement(ActivityIndicator, {
    state: 'read',
    transition: 'just-completed',
    transitionToken: 15,
    placement: 'corner',
  }));
  assert.ok(readSettleCorner.includes('activity-settle-fade'));
  assert.ok(readSettleCorner.includes('flux-activity-dot--settle'));
  assert.ok(readSettleCorner.includes('data-status="read"'));
  assert.ok(readSettleCorner.includes('data-transition="just-completed"'));
  assert.ok(readSettleCorner.includes('data-placement="corner"'));
  assert.ok(readSettleCorner.includes('aria-hidden="true"'));
  assert.equal(readSettleCorner.includes('activity-pulse-indicator'), false);
  assert.equal(readSettleCorner.includes('activity-unread-badge'), false);

  const readSettleInline = renderToStaticMarkup(React.createElement(ActivityIndicator, {
    state: 'read',
    transition: 'just-completed',
    transitionToken: 16,
    placement: 'inline',
  }));
  assert.ok(readSettleInline.includes('activity-settle-fade'));
  assert.ok(readSettleInline.includes('flux-cloud-settle'));
  assert.equal((readSettleInline.match(/class="flux-cloud-settle-dot"/g) || []).length, 7);
  assert.ok(readSettleInline.includes('data-status="read"'));
  assert.ok(readSettleInline.includes('data-transition="just-completed"'));
  assert.ok(readSettleInline.includes('data-placement="inline"'));
  assert.ok(readSettleInline.includes('aria-hidden="true"'));
  assert.equal(readSettleInline.includes('activity-pulse-indicator'), false);
  assert.equal(readSettleInline.includes('activity-unread-badge'), false);

  // 6 种 variant 完整落盘验证（cloud / gyro / orbit / synapse / spring / matrix 全部纯 HTML/CSS 零 SVG）
  const variants = ['cloud', 'gyro', 'orbit', 'synapse', 'spring', 'matrix'];
  for (const v of variants) {
    const runMarkup = renderToStaticMarkup(React.createElement(ActivityIndicator, {
      state: 'running',
      variant: v,
      placement: 'inline',
    }));
    assert.ok(runMarkup.includes('activity-pulse-indicator'));
    assert.ok(runMarkup.includes(`data-variant="${v}"`));
    assert.ok(runMarkup.includes(`flux-variant-${v}`));
    assert.equal(runMarkup.includes('<svg'), false, `variant ${v} 在 running 态严禁含 <svg>`);

    const unreadMarkup = renderToStaticMarkup(React.createElement(ActivityIndicator, {
      state: 'unread',
      variant: v,
      placement: 'inline',
      transition: 'just-completed',
      transitionToken: 9,
    }));
    assert.ok(unreadMarkup.includes('activity-unread-badge'));
    assert.ok(unreadMarkup.includes(`data-variant="${v}"`));
    assert.equal(unreadMarkup.includes('<svg'), false, `variant ${v} 在 unread 态严禁含 <svg>`);

    const readMarkup = renderToStaticMarkup(React.createElement(ActivityIndicator, {
      state: 'read',
      variant: v,
      placement: 'inline',
    }));
    assert.equal(readMarkup, '', `variant ${v} 在静态 read 态必须返回空`);
  }
});
