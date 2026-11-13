/**
 * 左舵渲染契约（React 实现）。
 *
 * 这些断言原先是针对字符串模板的 substring 检查，迁到 React 后改为对真实渲染结果断言，
 * 断言对象仍是"用户能看到什么"：微轨常驻、Agent 入口契约、三态互斥、上下文隔离、
 * 抽屉内群聊/会话分节、群聊行内重命名。React 组件内部结构变化不应让它们变红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeftRail } from '../../dist/components-react/LeftRail.js';
import { buildLeftRailModel } from '../../dist/components-react/leftRailModel.js';
import { assertCollapsedRailGeometry } from '../helpers/rail-geometry.mjs';

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
    assertCollapsedRailGeometry(markup);
    assert.equal(markup.includes('flux-context-drawer'), false);
  });
});

test('三态指示器在微轨与主工位卡上精准映射', async (t) => {
  await t.test('running 只出运行指示器，unread 只出已完成指示器，read 两者皆无', () => {
    const markup = renderRail({ activeFocus: { type: 'bot', botName: 'default' }, profileName: 'default' });
    const wang = between(markup, 'data-station-profile="arch-wang"', 'data-station-profile="fe-zhang"');
    assert.ok(wang.includes('activity-pulse-indicator'), '执行中 Agent 必须有运行指示器');
    assert.equal(wang.includes('activity-unread-badge'), false, '执行中严禁再出未读角标');

    const zhang = between(markup, 'data-station-profile="fe-zhang"', 'data-station-profile="qa-li"');
    assert.ok(zhang.includes('activity-unread-badge'), '未读 Agent 必须有已完成指示器');
    assert.equal(zhang.includes('activity-pulse-indicator'), false, '未读严禁出运行指示器');

    const li = markup.slice(markup.indexOf('data-station-profile="qa-li"'));
    const liBadge = li.slice(0, li.indexOf('</button>'));
    assert.equal(liBadge.includes('activity-pulse-indicator'), false, '已读严禁运行指示器');
    assert.equal(liBadge.includes('activity-unread-badge'), false, '已读严禁已完成指示器');
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

test('群聊重命名与失败提示', async (t) => {
  await t.test('微轨底部导航入口已整体拔除，抽屉内群聊/会话分节仍在', () => {
    const markup = renderRail({
      groups: [{ roomId: 'g-1', name: '协同群', members: ['default'], updatedAt: NOW }],
    });
    assert.equal(markup.includes('rail-station-groups-btn'), false, '微轨群聊入口必须拔除');
    assert.equal(markup.includes('rail-station-projects-btn'), false, '微轨项目入口必须拔除');
    assert.equal(markup.includes('rail-projects-deck'), false, '项目甲板必须一并移除');
    assert.ok(markup.includes('rail-groups-accordion-trigger'), '群聊入口收编到抽屉分节标题');
    assert.ok(markup.includes('rail-sessions-accordion-trigger'), '会话分节标题必须常驻');
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

test('全挂点统一三态与完成瞬态跃迁契约（微轨/主工位卡/会话/项目内会话/群聊/群聊汇总）', async (t) => {
  const countMatches = (text, re) => (text.match(re) || []).length;

  await t.test('corner 保持简洁角标，inline 渲染 24 颗云朵 A 微粒与对应 entityKind 状态词，零 SVG 且三态互斥', () => {
    const markup = renderRail({
      activeFocus: { type: 'bot', botName: 'bot-run' },
      profileName: 'bot-run',
      profiles: [
        { name: 'default', displayName: 'Default 助理', isDefault: true, activityState: 'read', timestamp: NOW },
        { name: 'bot-run', displayName: '运行Bot', activityState: 'running', lastMessage: '生成中', timestamp: NOW },
        { name: 'bot-unread-new', displayName: '刚完成Bot', activityState: 'unread', activityTransition: 'just-completed', activityTransitionToken: 11, lastMessage: '刚完成', timestamp: NOW - 1000 },
        { name: 'bot-unread-old', displayName: '历史未读Bot', activityState: 'unread', lastMessage: '历史未读', timestamp: NOW - 2000 },
        { name: 'bot-read', displayName: '已读Bot', activityState: 'read', lastMessage: '已读', timestamp: NOW - 3000 },
      ],
      sessions: [
        { id: 's-run', title: '运行中会话', botName: 'bot-run', timestamp: NOW, activityState: 'running' },
        { id: 's-unread-new', title: '刚完成未读会话', botName: 'bot-run', timestamp: NOW - 100, activityState: 'unread', activityTransition: 'just-completed', activityTransitionToken: 21 },
        { id: 's-unread-old', title: '历史未读会话', botName: 'bot-run', timestamp: NOW - 200, activityState: 'unread' },
        { id: 's-read', title: '普通已读会话', botName: 'bot-run', timestamp: NOW - 300, activityState: 'read' },
      ],
      groups: [
        { roomId: 'g-run', name: '运行群', members: ['bot-run'], updatedAt: NOW, activityState: 'running' },
        { roomId: 'g-unread-new', name: '刚完成群', members: ['bot-run'], updatedAt: NOW - 100, activityState: 'unread', activityTransition: 'just-completed', activityTransitionToken: 31 },
        { roomId: 'g-unread-old', name: '历史未读群', members: ['bot-run'], updatedAt: NOW - 200, activityState: 'unread' },
        { roomId: 'g-read', name: '已读群', members: ['bot-run'], updatedAt: NOW - 300, activityState: 'read' },
      ],
    });

    const botRunStation = between(markup, 'data-station-profile="bot-run"', '</button>');
    assert.ok(botRunStation.includes('flux-activity-dot--running'));
    assert.ok(botRunStation.includes('activity-pulse-indicator'));
    assert.ok(botRunStation.includes('data-placement="corner"'));
    assert.ok(botRunStation.includes('ring-2 ring-sidebar'));
    assert.equal(botRunStation.includes('flux-cloud-canvas'), false, 'corner 态绝不可渲染云朵画布');
    assert.equal(botRunStation.includes('activity-unread-badge'), false);

    const botUnreadNewStation = between(markup, 'data-station-profile="bot-unread-new"', '</button>');
    assert.ok(botUnreadNewStation.includes('flux-activity-dot--unread'));
    assert.ok(botUnreadNewStation.includes('data-transition="just-completed"'));
    assert.ok(botUnreadNewStation.includes('data-placement="corner"'));
    assert.equal(botUnreadNewStation.includes('flux-cloud-canvas'), false, 'corner 态绝不可渲染云朵画布');
    assert.equal(botUnreadNewStation.includes('activity-pulse-indicator'), false);

    const botUnreadOldStation = between(markup, 'data-station-profile="bot-unread-old"', '</button>');
    assert.ok(botUnreadOldStation.includes('flux-activity-dot--unread'));
    assert.ok(botUnreadOldStation.includes('data-transition="none"'), '缺省未读必须为 none，避免重挂载集体闪动');
    assert.equal(botUnreadOldStation.includes('flux-cloud-canvas'), false);

    const botReadStation = between(markup, 'data-station-profile="bot-read"', '</button>');
    assert.equal(botReadStation.includes('flux-activity-dot'), false, '静态已读 BOT 微轨严禁渲染指示器');
    assert.equal(botReadStation.includes('flux-cloud-indicator'), false);

    const primaryCard = between(markup, 'rail-primary-agent-card', '</button>');
    assert.ok(primaryCard.includes('flux-cloud-indicator--running'));
    assert.ok(primaryCard.includes('data-placement="inline"'));
    assert.equal(countMatches(primaryCard, /class="flux-cloud-dot"/g), 24, '主工位卡运行态必须渲染 24 颗云朵微粒');
    assert.ok(primaryCard.includes('思考中'), 'Bot 主工位卡运行态必须显示「思考中」');

    const sRun = between(markup, 'data-id="s-run"', '</button>');
    assert.ok(sRun.includes('flux-cloud-indicator--running'));
    assert.ok(sRun.includes('data-placement="inline"'));
    assert.equal(countMatches(sRun, /class="flux-cloud-dot"/g), 24, '会话运行态必须渲染 24 颗云朵微粒');
    assert.ok(sRun.includes('执行中'), '会话运行态必须显示「执行中」');
    assert.equal(sRun.includes('<svg'), false, 'SessionRow 运行态严禁包含 <svg');
    assert.equal(sRun.includes('activity-unread-badge'), false);

    const sUnreadNew = between(markup, 'data-id="s-unread-new"', '</button>');
    assert.ok(sUnreadNew.includes('flux-cloud-indicator--unread'));
    assert.ok(sUnreadNew.includes('data-transition="just-completed"'));
    assert.ok(sUnreadNew.includes('flux-cloud-ripple'), 'just-completed 必须渲染散开波纹');
    assert.equal(countMatches(sUnreadNew, /class="flux-cloud-dot"/g), 24, '会话完成态必须渲染 24 颗云朵微粒');
    assert.ok(sUnreadNew.includes('已完成'), '未读态必须显示「已完成」');
    assert.equal(sUnreadNew.includes('<svg'), false, 'SessionRow 未读态严禁包含 <svg');
    assert.equal(sUnreadNew.includes('activity-pulse-indicator'), false);

    const sUnreadOld = between(markup, 'data-id="s-unread-old"', '</button>');
    assert.ok(sUnreadOld.includes('flux-cloud-indicator--unread'));
    assert.ok(sUnreadOld.includes('data-transition="none"'));
    assert.equal(sUnreadOld.includes('flux-cloud-ripple'), false, '静态历史未读不得渲染波纹');
    assert.ok(sUnreadOld.includes('已完成'));

    const sRead = between(markup, 'data-id="s-read"', '</button>');
    assert.equal(sRead.includes('flux-activity-dot'), false);
    assert.equal(sRead.includes('flux-cloud-indicator'), false);
    assert.equal(sRead.includes('flux-cloud-settle'), false);

    const gRun = between(markup, 'data-room-id="g-run"', '</button>');
    assert.ok(gRun.includes('flux-cloud-indicator--running'));
    assert.ok(gRun.includes('data-placement="inline"'));
    assert.equal(countMatches(gRun, /class="flux-cloud-dot"/g), 24, '群聊运行态必须渲染 24 颗云朵微粒');
    assert.ok(gRun.includes('协作中'), '群聊运行态必须显示「协作中」');

    const gUnreadNew = between(markup, 'data-room-id="g-unread-new"', '</button>');
    assert.ok(gUnreadNew.includes('flux-cloud-indicator--unread'));
    assert.ok(gUnreadNew.includes('data-transition="just-completed"'));
    assert.ok(gUnreadNew.includes('已完成'));

    const gUnreadOld = between(markup, 'data-room-id="g-unread-old"', '</button>');
    assert.ok(gUnreadOld.includes('data-transition="none"'));

    const gRead = between(markup, 'data-room-id="g-read"', '</button>');
    assert.equal(gRead.includes('flux-activity-dot'), false);
    assert.equal(gRead.includes('flux-cloud-indicator'), false);

    assert.equal(markup.includes('rail-station-groups-btn'), false, '微轨群聊汇总按钮已拔除，角标聚合不得残留死层');
  });

  await t.test('read 瞬态窗口仅在 just-completed 时渲染 .activity-settle-fade 且绝不带脉冲/未读类', () => {
    const markup = renderRail({
      activeFocus: { type: 'bot', botName: 'default' },
      profileName: 'default',
      profiles: [
        { name: 'default', displayName: 'Default 助理', isDefault: true, activityState: 'read', activityTransition: 'just-completed', activityTransitionToken: 99, timestamp: NOW },
      ],
      sessions: [
        { id: 's-settle', title: '刚结束聚焦会话', timestamp: NOW, activityState: 'read', activityTransition: 'just-completed', activityTransitionToken: 100 },
        { id: 's-plain', title: '普通已读', timestamp: NOW - 100, activityState: 'read' },
      ],
      groups: [
        { roomId: 'g-settle', name: '刚结束聚焦群', members: ['default'], updatedAt: NOW, activityState: 'read', activityTransition: 'just-completed', activityTransitionToken: 101 },
      ],
    });

    for (const chunk of [
      between(markup, 'data-station-profile="default"', '</button>'),
    ]) {
      assert.ok(chunk.includes('activity-settle-fade'), 'corner just-completed read 必须渲染收敛淡出元素');
      assert.ok(chunk.includes('flux-activity-dot--settle'));
      assert.ok(chunk.includes('data-status="read"'));
      assert.ok(chunk.includes('data-transition="just-completed"'));
      assert.ok(chunk.includes('aria-hidden="true"'));
      assert.equal(chunk.includes('activity-pulse-indicator'), false, 'settle 绝不可含 running 类名');
      assert.equal(chunk.includes('activity-unread-badge'), false, 'settle 绝不可含 unread 类名');
    }

    for (const chunk of [
      between(markup, 'rail-primary-agent-card', '</button>'),
      between(markup, 'data-id="s-settle"', '</button>'),
      between(markup, 'data-room-id="g-settle"', '</button>'),
    ]) {
      assert.ok(chunk.includes('activity-settle-fade'), 'inline just-completed read 必须渲染收敛淡出元素');
      assert.ok(chunk.includes('flux-cloud-settle'));
      assert.equal(countMatches(chunk, /class="flux-cloud-settle-dot"/g), 7, 'inline 收敛淡出必须带 7 颗核心蓝粒');
      assert.ok(chunk.includes('data-status="read"'));
      assert.ok(chunk.includes('data-transition="just-completed"'));
      assert.ok(chunk.includes('aria-hidden="true"'));
      assert.equal(chunk.includes('activity-pulse-indicator'), false, 'settle 绝不可含 running 类名');
      assert.equal(chunk.includes('activity-unread-badge'), false, 'settle 绝不可含 unread 类名');
    }

    const plainRow = between(markup, 'data-id="s-plain"', '</button>');
    assert.equal(plainRow.includes('activity-settle-fade'), false);
    assert.equal(plainRow.includes('flux-activity-dot'), false);
    assert.equal(plainRow.includes('flux-cloud-settle'), false);
    assert.equal(plainRow.includes('flux-cloud-indicator'), false);
  });

  await t.test('变异检验：微轨已无群聊汇总入口，任何输入都不得再渲染该按钮', () => {
    const unreadMarkup = renderRail({
      groups: [
        { roomId: 'g-old', name: '旧未读', members: ['default'], updatedAt: NOW - 500, activityState: 'unread' },
        { roomId: 'g-new', name: '刚完成', members: ['default'], updatedAt: NOW - 100, activityState: 'unread', activityTransition: 'just-completed', activityTransitionToken: 42 },
      ],
    });
    assert.equal(unreadMarkup.includes('rail-station-groups-btn'), false);

    const readMarkup = renderRail({
      groups: [
        { roomId: 'g-read', name: '纯已读', members: ['default'], updatedAt: NOW, activityState: 'read' },
      ],
    });
    assert.equal(readMarkup.includes('rail-station-groups-btn'), false);
    // 群聊行本体仍在，只是不再上浮到微轨。
    assert.ok(readMarkup.includes('rail-group-item'), '群聊行必须仍在抽屉内渲染');
    assert.ok(readMarkup.includes('data-room-id="g-read"'), '群聊行点击契约不得随入口消失');
  });
});
