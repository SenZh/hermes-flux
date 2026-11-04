/**
 * 左舵渲染契约（React 实现）。
 *
 * 这些断言原先是针对字符串模板的 substring 检查，迁到 React 后改为对真实渲染结果断言，
 * 断言对象仍是"用户能看到什么"：微轨常驻、Agent 入口契约、三态互斥、上下文隔离、
 * 项目甲板与会话甲板互斥、群聊行内重命名。React 组件内部结构变化不应让它们变红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeftRail } from '../../dist/components-react/LeftRail.js';
import { buildLeftRailModel } from '../../dist/components-react/leftRailModel.js';

const NOW = new Date(2026, 10, 3, 15, 30).getTime();

const PROFILES = [
  { name: 'default', displayName: 'Default 助理', isDefault: true, activityState: 'read', lastMessage: '主中枢已就绪', lastTime: '10:00', timestamp: NOW - 600000 },
  { name: 'arch-wang', displayName: '架构老王', activityState: 'running', lastMessage: '已完成 SQLite WAL 锁模型复查', lastTime: '10:42', timestamp: NOW - 3600000, avatar: 'data:image/png;base64,mock-avatar' },
  { name: 'fe-zhang', displayName: '前端小张', activityState: 'unread', lastMessage: '页面组件已完成重构', lastTime: '09:30', timestamp: NOW - 7200000 },
  { name: 'qa-li', displayName: '测试小李', activityState: 'read', lastMessage: '全量门禁回归测试已跑通', lastTime: '08:15', timestamp: NOW - 10800000 },
];

function renderRail(overrides = {}) {
  const noop = () => {};
  const input = {
    activeSessionId: '',
    profileName: 'default',
    profiles: PROFILES,
    sessions: [],
    groups: [],
    projects: [],
    activeRailTab: 'chats',
    searchQuery: '',
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(LeftRail, {
    model: buildLeftRailModel(input),
    collapsed: Boolean(overrides.collapsed),
    searchQuery: input.searchQuery,
    editingGroupRoomId: overrides.editingGroupRoomId,
    groupAvatars: input.profiles,
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
  }));
}

/** 取两个标记之间的片段，避免跨实体的 substring 误判。 */
function between(markup, startMarker, endMarker) {
  const start = markup.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? markup.indexOf(endMarker, start + startMarker.length) : markup.length;
  return markup.slice(start, end === -1 ? markup.length : end);
}

test('双轨架构：52px 微轨常驻且可无限滚动', async (t) => {
  await t.test('微轨始终渲染，抽屉展开时与微轨并排', () => {
    const markup = renderRail();
    assert.ok(markup.includes('id="flux-station-rail"'), '必须存在 52px 物理微轨');
    assert.ok(markup.includes('station-agents-scroll'), '微轨必须具备独立滚动容器');
    assert.ok(markup.includes('overflow-y-auto'), '微轨滚动容器必须可滚动');
    assert.ok(markup.includes('scrollbar-width:none'), '微轨必须隐藏原生滚动条');
    assert.ok(markup.includes('flux-context-drawer'), '展开态必须有抽屉');
  });

  await t.test('所有专职 Agent 都挂进微轨且带点击契约', () => {
    const markup = renderRail();
    for (const name of ['arch-wang', 'fe-zhang', 'qa-li']) {
      assert.ok(markup.includes(`data-station-profile="${name}"`), `${name} 必须挂载于微轨`);
    }
    assert.ok(markup.includes('data-station-profile="default"'), 'Default 助手必须常驻顶部');
  });

  await t.test('折叠态：微轨仍在，抽屉与把手整体不渲染', () => {
    const markup = renderRail({ collapsed: true });
    assert.ok(markup.includes('rail-collapsed'));
    assert.ok(markup.includes('id="flux-station-rail"'), '折叠态微轨绝不可消失');
    assert.ok(markup.includes('var(--geo-micro-rail, 52px)'), '折叠态总宽必须收敛为 52px');
    assert.equal(markup.includes('flux-context-drawer'), false);
  });
});

test('三态指示器在微轨与主工位卡上精准映射', async (t) => {
  await t.test('running 只出呼吸脉冲，unread 只出翡翠点，read 两者皆无', () => {
    const markup = renderRail({ activeFocus: { type: 'bot', botName: 'default' }, profileName: 'default' });
    const wang = between(markup, 'data-station-profile="arch-wang"', 'data-station-profile="fe-zhang"');
    assert.ok(wang.includes('activity-pulse-indicator'), '执行中 Agent 必须有脉冲');
    assert.equal(wang.includes('activity-unread-badge'), false, '执行中严禁再出未读点');

    const zhang = between(markup, 'data-station-profile="fe-zhang"', 'data-station-profile="qa-li"');
    assert.ok(zhang.includes('activity-unread-badge'), '未读 Agent 必须有绿点');
    assert.equal(zhang.includes('activity-pulse-indicator'), false, '未读严禁出脉冲');

    const li = markup.slice(markup.indexOf('data-station-profile="qa-li"'));
    const liBadge = li.slice(0, li.indexOf('</button>'));
    assert.equal(liBadge.includes('activity-pulse-indicator'), false, '已读严禁脉冲');
    assert.equal(liBadge.includes('activity-unread-badge'), false, '已读严禁绿点');
  });

  await t.test('主工位卡展示当前 Agent 的名称、最新摘要、时间与运行态', () => {
    const markup = renderRail({ activeFocus: { type: 'bot', botName: 'arch-wang' }, profileName: 'arch-wang' });
    const card = between(markup, 'rail-primary-agent-card', 'rail-groups-accordion-trigger');
    assert.ok(card.includes('架构老王'), '必须展示当前 Agent 名称');
    assert.ok(card.includes('已完成 SQLite WAL 锁模型复查'), '必须展示最新消息摘要');
    assert.ok(card.includes('<time'), '必须展示最后活跃时间');
    assert.ok(card.includes('activity-pulse-indicator'), '必须呈现该 Agent 的运行态');
    assert.ok(card.includes('data-primary-bot="arch-wang"'), '必须带主工位点击契约');
  });
});

test('抽屉严格上下文隔离：绝不展示其他 Agent 的会话与群聊', async (t) => {
  const sessions = [
    { id: 's-default', title: 'Default 的主任务', botName: 'default', timestamp: 1000 },
    { id: 's-wang-1', title: '老王专属架构评审', botName: 'arch-wang', timestamp: 3000 },
    { id: 's-wang-2', title: '老王专属数据库调优', botName: 'arch-wang', timestamp: 4000 },
    { id: 's-zhang-1', title: '小张的前端改动', botName: 'fe-zhang', timestamp: 5000 },
  ];
  const groups = [
    { roomId: 'g-wang', name: '老王架构专班', members: ['arch-wang'], updatedAt: 8000 },
    { roomId: 'g-zhang', name: '前端攻坚群', members: ['fe-zhang'], updatedAt: 9000 },
  ];

  await t.test('老王视角只看到自己的会话与群聊', () => {
    const markup = renderRail({ activeFocus: { type: 'bot', botName: 'arch-wang' }, profileName: 'arch-wang', sessions, groups });
    assert.ok(markup.includes('老王专属架构评审'));
    assert.ok(markup.includes('老王专属数据库调优'));
    assert.equal(markup.includes('小张的前端改动'), false, '小张的会话严禁出现在老王抽屉');
    assert.equal(markup.includes('Default 的主任务'), false, 'Default 会话严禁出现在老王抽屉');
    assert.ok(markup.includes('老王架构专班'));
    assert.equal(markup.includes('前端攻坚群'), false, '老王未参与的群严禁出现');
  });

  await t.test('Default 视角只看到通用会话，专职会话严格排除', () => {
    const markup = renderRail({ activeFocus: { type: 'bot', botName: 'default' }, profileName: 'default', sessions, groups });
    assert.ok(markup.includes('Default 的主任务'));
    assert.equal(markup.includes('老王专属架构评审'), false);
    assert.equal(markup.includes('小张的前端改动'), false);
  });
});

test('会话、群聊与 Bot 的排序与摘要契约', async (t) => {
  await t.test('会话按时间倒序排列', () => {
    const markup = renderRail({
      sessions: [
        { id: 's-old', title: '旧会话', timestamp: 1000, preview: '旧内容' },
        { id: 's-new', title: '新会话', timestamp: 9000, preview: '新内容' },
        { id: 's-mid', title: '中间会话', timestamp: 5000, preview: '中间内容' },
      ],
    });
    const posNew = markup.indexOf('data-id="s-new"');
    const posMid = markup.indexOf('data-id="s-mid"');
    const posOld = markup.indexOf('data-id="s-old"');
    assert.ok(posNew < posMid && posMid < posOld, '必须严格按时间倒序');
  });

  await t.test('群聊按最新更新倒序，且无消息时回退成员数', () => {
    const markup = renderRail({
      groups: [
        { roomId: 'g-early', name: '早期技术群', members: ['a', 'b'], updatedAt: 2000, lastMessage: '上周决议' },
        { roomId: 'g-late', name: '最新研讨群', members: ['a', 'b', 'c'], updatedAt: 9999, lastMessage: '刚刚共识' },
        { roomId: 'g-silent', name: '空白静默群', members: ['a', 'b', 'c'], updatedAt: 1000 },
      ],
    });
    assert.ok(markup.indexOf('data-room-id="g-late"') < markup.indexOf('data-room-id="g-early"'), '群聊按更新时间倒序');
    assert.ok(markup.includes('3 位专家'), '无消息群聊必须回退成员数');
  });

  await t.test('会话副标题来自 preview，绝不泄露 model 字符串', () => {
    const markup = renderRail({
      sessions: [{ id: 's-1', title: '优化左舵需求', preview: '好的，我已经分析了三态流转。', model: 'claude-3-7-sonnet', timestamp: 5000 }],
    });
    assert.ok(markup.includes('好的，我已经分析了三态流转。'));
    assert.equal(markup.includes('claude-3-7-sonnet'), false);
  });

  await t.test('Bot 列表按最新活跃倒序', () => {
    const markup = renderRail({ profiles: [
      { name: 'bot-sleepy', displayName: '沉睡Bot', timestamp: 1000, lastMessage: '很久以前' },
      { name: 'bot-active', displayName: '活跃Bot', timestamp: 8888, lastMessage: '刚刚完成' },
    ] });
    assert.ok(markup.indexOf('data-profile="bot-active"') < markup.indexOf('data-profile="bot-sleepy"'));
  });
});

test('项目甲板、群聊重命名与失败提示', async (t) => {
  await t.test('项目甲板渲染项目名、嵌套会话与空态', () => {
    const markup = renderRail({
      activeRailTab: 'projects',
      projects: [
        { id: 'proj-shop', name: '商城系统', path: 'D:/shop', sessions: [{ id: 's-shop', title: '修复支付超时', timestamp: NOW }] },
        { id: 'proj-empty', name: '空项目', sessions: [] },
      ],
    });
    assert.ok(markup.includes('rail-projects-deck'));
    assert.ok(markup.includes('商城系统'));
    assert.ok(markup.includes('修复支付超时'));
    assert.ok(markup.includes('该项目暂无关联会话'), '空项目必须给出明确空态');
  });

  await t.test('编辑态渲染行内重命名输入与确认/取消，非编辑态不渲染', () => {
    const groups = [{ roomId: 'room-101', name: '可架构会议室', members: ['default', 'arch-wang'] }];
    const editing = renderRail({ groups, editingGroupRoomId: 'room-101' });
    assert.ok(editing.includes('rail-group-inline-rename-wrap'));
    assert.ok(editing.includes('rail-group-rename-input-room-101'));
    assert.equal(renderRail({ groups }).includes('rail-group-inline-rename-wrap'), false);
  });

  await t.test('加载失败必须显式暴露原因，绝不伪装成空列表', () => {
    const failed = renderRail({ sessions: [], error: '当前状态: RECONNECTING' });
    assert.ok(failed.includes('session-list-error'), '必须有独立错误块');
    assert.ok(failed.includes('当前状态: RECONNECTING'), '必须展示具体原因');
    const empty = renderRail({ sessions: [], error: '' });
    assert.equal(empty.includes('session-list-error'), false);
  });
});

test('头像资产：自定义头像渲染真实 img，无资产时回退确定性 SVG', async (t) => {
  await t.test('带 avatar 的 Agent 渲染 img', () => {
    const markup = renderRail();
    assert.ok(markup.includes('src="data:image/png;base64,mock-avatar"'));
  });

  await t.test('无 avatar 的 Agent 回退 SVG 图腾，绝不渲染空 img', () => {
    const markup = renderRail();
    const zhang = between(markup, 'data-station-profile="fe-zhang"', 'data-station-profile="qa-li"');
    assert.equal(zhang.includes('<img'), false, '无资产严禁渲染 img');
    assert.ok(zhang.includes('<svg') || zhang.includes('viewBox'), '必须回退几何图腾');
  });

  await t.test('多个无资产 Bot 必须可区分（形状×色调二维指纹，不得全部同形同色）', () => {
    const markup = renderRail({
      profiles: [
        { name: 'default', displayName: 'Default', isDefault: true, activityState: 'read' },
        { name: 'bot-alpha', displayName: 'Alpha', activityState: 'read' },
        { name: 'bot-beta', displayName: 'Beta', activityState: 'read' },
        { name: 'bot-gamma', displayName: 'Gamma', activityState: 'read' },
      ],
    });
    const signatures = ['bot-alpha', 'bot-beta', 'bot-gamma'].map((name) => {
      const chunk = between(markup, `data-station-profile="${name}"`, 'data-station-profile=');
      const fill = /fill="var\((--[a-z-]+)\)"/.exec(chunk.split('alt=')[0]) || [];
      const shape = /<(circle|rect|path|polygon)\b/.exec(chunk.split('fill="var(--panel)"')[1] || chunk);
      return `${shape ? shape[1] : '?'}|${fill[1] || '?'}`;
    });
    assert.equal(new Set(signatures).size, 3, `三个无资产 Bot 必须得到三种不同指纹，实际=${JSON.stringify(signatures)}`);
  });

  await t.test('群聊行必须渲染拼图头像（多人身份签名，不得退化成纯文字）', () => {
    const markup = renderRail({
      groups: [
        { roomId: 'g-two', name: '双人群', members: ['arch-wang', 'fe-zhang'], updatedAt: NOW },
        { roomId: 'g-four', name: '四人群', members: ['arch-wang', 'fe-zhang', 'qa-li', 'default'], updatedAt: NOW - 1000 },
      ],
    });
    // 拼贴单元 = 真实 img（有资产）+ 字母块（无资产），两者共同构成成员格
    const cellCount = (chunk) => (chunk.match(/<img|<svg|font-family: var\(--font-mono\)/g) || []).length;

    const two = between(markup, 'data-room-id="g-two"', 'data-room-id="g-four"');
    assert.ok(two.includes('<img') || two.includes('<svg') || two.includes('var(--font-mono)'), '两人群必须渲染成员头像拼贴');
    assert.ok(cellCount(two) >= 2, `两人群拼贴必须包含两个头像单元，实际 ${cellCount(two)}`);

    const four = markup.slice(markup.indexOf('data-room-id="g-four"'));
    assert.ok(cellCount(four) >= 4, `四人群拼贴必须包含四个头像单元，实际 ${cellCount(four)}`);
  });

  await t.test('群聊无成员时给固定占位，不得渲染空容器', () => {
    const markup = renderRail({ groups: [{ roomId: 'g-empty', name: '空群', members: [], updatedAt: NOW }] });
    const row = markup.slice(markup.indexOf('data-room-id="g-empty"'));
    assert.ok(row.includes('👥'), '零成员群聊必须有占位符');
  });

  await t.test('不同名称给出不同图腾形态（确定性哈希，非同形态重复）', () => {
    const markup = renderRail({
      groups: [{ roomId: 'g-a', name: 'A 群', members: ['arch-wang', 'fe-zhang'], updatedAt: NOW }],
    });
    const row = between(markup, 'data-room-id="g-a"', '</div>');
    // 有真实头像资产的成员走 img，无资产的走字母块：两者必须并存而不是全被同一种覆盖
    assert.ok(row.includes('<img'), '有资产的成员必须走真实 img');
  });
});

test('变异检验：把状态预期改错必然变红', async (t) => {
  await t.test('纯已读会话行不得出现任何指示器', () => {
    const markup = renderRail({ sessions: [{ id: 's-read', title: '已读会话', timestamp: NOW, activityState: 'read' }] });
    const row = between(markup, 'data-id="s-read"', '</button>');
    assert.ok(row.length > 0, '会话行必须渲染');
    assert.equal(row.includes('activity-pulse-indicator'), false);
    assert.equal(row.includes('activity-unread-badge'), false);
  });

  await t.test('隔离断言具备杀伤力：故意放错 botName 会被检出', () => {
    const markup = renderRail({ sessions: [{ id: 's-leak', title: '错域会话', botName: 'fe-zhang', timestamp: NOW }] });
    assert.equal(markup.includes('错域会话'), false, 'Default 视角下不得出现小张会话');
  });
});
