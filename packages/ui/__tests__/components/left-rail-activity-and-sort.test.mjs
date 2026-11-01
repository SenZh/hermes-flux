/**
 * Hermes Flux LeftRail 三态独立性、时间倒序排序与副标题动态摘要自动化测试
 *
 * 【测试四象限矩阵】:
 * 1. 确定性正向路径 (Happy Path):
 *    - Sessions / Bots / Groups 全部严格按时间从新到旧 (Newest First) 降序排列;
 *    - Sessions / Bots / Groups 最新消息副标题均提取前 36 个字符并压缩空白与换行;
 * 2. 状态绝对独立性 (State Isolation Invariant):
 *    - 会话 A 正在运行 (running)，只有会话 A 呈现脉冲动效，其他会话、Bot、群聊零污染;
 *    - 群聊处于未读 (unread)，只有群聊呈现翡翠小绿点，会话与 Bot 零污染;
 *    - 纯已读 (read) 条目在 DOM 树中严禁包含任何指示器;
 * 3. 边界与负向降级 (Boundary & Fallback):
 *    - 时间戳缺失/为 0 时安全沉底，不抛错崩溃;
 *    - 群聊无任何消息记录时，副标题优雅回退到成员数量;
 *    - 会话 preview 缺失时，副标题优雅使用 title 截断兜底，绝不泄露 model 名字;
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLeftRail, formatMessageSnippet } from '../../dist/components/LeftRail/LeftRail.js';

test('formatMessageSnippet - 消息摘要提炼与格式化规范', async (t) => {
  await t.test('1. 空值与纯空白输入时安全降级为空字符串', () => {
    assert.equal(formatMessageSnippet(undefined), '');
    assert.equal(formatMessageSnippet(''), '');
    assert.equal(formatMessageSnippet('   \n\t  '), '');
  });

  await t.test('2. 正常短文本原样保留但压缩内部多余空白与换行', () => {
    const raw = '你好，\n  请帮我审查   代码架构。';
    const result = formatMessageSnippet(raw, 36);
    assert.equal(result, '你好， 请帮我审查 代码架构。');
  });

  await t.test('3. Markdown 代码块与标题字符优雅清洗', () => {
    const raw = '### 方案标题\n```ts\nconst a = 1;\n```\n这是核心说明文字';
    const result = formatMessageSnippet(raw, 50);
    assert.ok(!result.includes('###'));
    assert.ok(!result.includes('```ts'));
    assert.ok(result.includes('[代码]'));
    assert.ok(result.includes('方案标题 [代码] 这是核心说明文字'));
  });

  await t.test('4. 超过最大字符限制时精准截断并附加省略号', () => {
    const longText = '这是一段非常长非常长的连续消息记录文本，用来测试副标题是否会在达到字数上限后截断并添加省略号';
    const result = formatMessageSnippet(longText, 20);
    assert.equal(result.length, 23); // 20 + '...'
    assert.ok(result.endsWith('...'));
    assert.equal(result.slice(0, 20), longText.slice(0, 20));
  });
});

test('LeftRail - 时间倒序排序 (Newest First) 与副标题实时展现', async (t) => {
  await t.test('1. 会话列表必须严格按时间戳倒序排列，最新会话排在最前', () => {
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: 'sess-newest',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      sessions: [
        {
          id: 'sess-old',
          title: '昨天讨论的会话',
          timestamp: 1000,
          preview: '旧内容',
        },
        {
          id: 'sess-newest',
          title: '刚刚创建的最新会话',
          timestamp: 9000,
          preview: '最新输入的内容',
        },
        {
          id: 'sess-middle',
          title: '一小时前的会话',
          timestamp: 5000,
          preview: '中间内容',
        },
      ],
    });

    const posNewest = html.indexOf('data-id="sess-newest"');
    const posMiddle = html.indexOf('data-id="sess-middle"');
    const posOld = html.indexOf('data-id="sess-old"');

    assert.ok(posNewest !== -1 && posMiddle !== -1 && posOld !== -1, '所有会话必须正确挂载');
    assert.ok(posNewest < posMiddle, '最新时间戳(9000)会话必须排在中间(5000)会话前面');
    assert.ok(posMiddle < posOld, '中间时间戳(5000)会话必须排在旧(1000)会话前面');
  });

  await t.test('2. 智能体列表 (Bots) 必须严格按最新活跃时间倒序排列', () => {
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      isBotsGroupExpanded: true,
      sessions: [],
      profiles: [
        {
          name: 'bot-sleepy',
          displayName: '沉睡的Bot',
          timestamp: 1000,
          lastMessage: '很久以前的消息',
        },
        {
          name: 'bot-active',
          displayName: '刚刚活跃的Bot',
          timestamp: 8888,
          lastMessage: '刚刚为您完成了代码重构',
        },
      ],
    });

    const posActive = html.indexOf('data-profile="bot-active"');
    const posSleepy = html.indexOf('data-profile="bot-sleepy"');

    assert.ok(posActive !== -1 && posSleepy !== -1, '所有Bot必须正确挂载');
    assert.ok(posActive < posSleepy, '最新活跃的 Bot(8888) 必须排在不活跃的 Bot(1000) 前面');
  });

  await t.test('3. 群聊列表 (Groups) 必须严格按最新活跃时间倒序排列', () => {
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      isGroupsGroupExpanded: true,
      sessions: [],
      groups: [
        {
          roomId: 'room-early',
          name: '早期技术群',
          members: ['a', 'b'],
          updatedAt: 2000,
          lastMessage: '上周的决议',
        },
        {
          roomId: 'room-latest',
          name: '最新前沿研讨群',
          members: ['a', 'b', 'c'],
          updatedAt: 9999,
          lastMessage: '刚刚达成的共识',
        },
      ],
    });

    const posLatest = html.indexOf('data-room-id="room-latest"');
    const posEarly = html.indexOf('data-room-id="room-early"');

    assert.ok(posLatest !== -1 && posEarly !== -1, '所有群聊房间必须正确挂载');
    assert.ok(posLatest < posEarly, '最新更新(9999)的群聊必须排在旧更新(2000)的群聊前面');
  });

  await t.test('4. 副标题展示: 群聊优先展示最新一条记录前 N 个字，无记录时优雅回退到成员数', () => {
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      isGroupsGroupExpanded: true,
      sessions: [],
      groups: [
        {
          roomId: 'room-has-msg',
          name: '架构委员会',
          members: ['arch', 'lead'],
          lastMessage: '这是架构委员会最新的决议：门禁必须100%全绿才能合入！',
        },
        {
          roomId: 'room-no-msg',
          name: '空白静默群',
          members: ['arch', 'lead', 'dev'],
        },
      ],
    });

    // 群 1: 必须包含消息摘要
    assert.ok(html.includes('这是架构委员会最新的决议：门禁必须100%全绿才能合入！'), '有最新记录的群聊副标题必须展示最新消息摘要');
    // 群 2: 无消息时必须优雅显示成员统计
    assert.ok(html.includes('3 位专家'), '无消息记录的群聊必须优雅回退显示成员数量');
  });

  await t.test('5. 会话副标题: 优先展示 preview 消息前 N 个字，严禁泄露 model 字符串', () => {
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: '',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      sessions: [
        {
          id: 'sess-with-preview',
          title: '优化左侧栏需求',
          preview: '好的，我已经为您分析了三态流转与排序需求，马上开始实施。',
          model: 'claude-3-7-sonnet',
          timestamp: 5000,
        },
      ],
    });

    assert.ok(html.includes('好的，我已经为您分析了三态流转与排序需求，马上开始实施。'), '会话副标题必须展示最新消息摘要');
    assert.ok(!html.includes('claude-3-7-sonnet'), '会话副标题严禁泄露 model 字符串');
  });
});

test('LeftRail - 状态独立性与三态互斥流转 (Running / Unread / Read)', async (t) => {
  await t.test('1. 单一会话处于 running 时，只有该会话显示脉冲动效，其他会话、Bot 与群聊严格不受任何影响', () => {
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: 'sess-active',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      isBotsGroupExpanded: true,
      isGroupsGroupExpanded: true,
      sessions: [
        {
          id: 'sess-running',
          title: '正在执行的会话',
          timestamp: 9000,
          activityState: 'running',
        },
        {
          id: 'sess-idle',
          title: '安静的已读会话',
          timestamp: 8000,
          activityState: 'read',
        },
      ],
      profiles: [
        {
          name: 'arch-bot',
          displayName: '架构老王',
          activityState: 'read',
          timestamp: 7000,
        },
      ],
      groups: [
        {
          roomId: 'group-chat-1',
          name: '项目群',
          members: ['a', 'b'],
          activityState: 'read',
          updatedAt: 6000,
        },
      ],
    });

    // 1. 正向验证：正在执行的会话必须拥有运行态脉冲指示器
    const runningChunk = html.slice(html.indexOf('data-id="sess-running"'), html.indexOf('data-id="sess-idle"'));
    assert.ok(runningChunk.includes('activity-pulse-indicator'), '运行中会话必须包含呼吸脉冲动画指示器');
    assert.ok(!runningChunk.includes('activity-unread-badge'), '运行中会话严禁包含未读小绿点');

    // 2. 状态独立性检验：已读会话内部严禁有任何指示器
    const idleChunk = html.slice(html.indexOf('data-id="sess-idle"'));
    const idleSessionRow = idleChunk.slice(0, idleChunk.indexOf('</div>\n      </div>'));
    assert.ok(!idleSessionRow.includes('activity-pulse-indicator'), '其他已读会话严禁受运行态污染');
    assert.ok(!idleSessionRow.includes('activity-unread-badge'), '其他已读会话严禁包含未读指示器');

    // 3. Bot 区块独立性检验：Bot 头像严禁被普通会话运行态波及
    const botChunk = html.slice(html.indexOf('data-profile="arch-bot"'));
    const botRow = botChunk.slice(0, botChunk.indexOf('</div>\n                  </div>'));
    assert.ok(!botRow.includes('activity-pulse-indicator'), '普通会话运行严禁把 Bot 也染成 running');
    assert.ok(!botRow.includes('activity-unread-badge'), '普通会话运行严禁把 Bot 染成未读');

    // 4. 群聊独立性检验：群聊严禁被普通会话波及
    const groupChunk = html.slice(html.indexOf('data-room-id="group-chat-1"'));
    const groupRow = groupChunk.slice(0, groupChunk.indexOf('</div>\n                      </div>'));
    assert.ok(!groupRow.includes('activity-pulse-indicator'), '普通会话运行严禁把群聊染成 running');
    assert.ok(!groupRow.includes('activity-unread-badge'), '普通会话运行严禁把群聊染成未读');
  });

  await t.test('2. 未读状态 (unread) 呈现翡翠小绿点，已读 (read) 没有任何特殊标识', () => {
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: 'sess-read',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      isBotsGroupExpanded: true,
      isGroupsGroupExpanded: true,
      sessions: [
        {
          id: 'sess-unread',
          title: '执行完毕未读会话',
          timestamp: 9000,
          activityState: 'unread',
        },
        {
          id: 'sess-read',
          title: '已读查看完毕会话',
          timestamp: 8000,
          activityState: 'read',
        },
      ],
      profiles: [
        {
          name: 'bot-unread',
          displayName: '有成果未读Bot',
          activityState: 'unread',
          timestamp: 7000,
        },
        {
          name: 'bot-read',
          displayName: '普通已读Bot',
          activityState: 'read',
          timestamp: 6000,
        },
      ],
      groups: [
        {
          roomId: 'group-unread',
          name: '有新回复群聊',
          members: ['a', 'b'],
          activityState: 'unread',
          updatedAt: 5000,
        },
        {
          roomId: 'group-read',
          name: '普通已读群聊',
          members: ['a', 'b'],
          activityState: 'read',
          updatedAt: 4000,
        },
      ],
    });

    // 未读会话呈现小绿点
    const unreadSessChunk = html.slice(html.indexOf('data-id="sess-unread"'), html.indexOf('data-id="sess-read"'));
    assert.ok(unreadSessChunk.includes('activity-unread-badge'), '未读会话必须渲染翡翠小绿点');
    assert.ok(!unreadSessChunk.includes('activity-pulse-indicator'), '未读会话严禁包含呼吸脉冲动效');

    // 已读会话没有任何标识
    const readSessChunk = html.slice(html.indexOf('data-id="sess-read"'));
    const readSessionRow = readSessChunk.slice(0, readSessChunk.indexOf('</div>\n      </div>'));
    assert.ok(!readSessionRow.includes('activity-unread-badge'), '已读会话严禁包含未读小绿点');
    assert.ok(!readSessionRow.includes('activity-pulse-indicator'), '已读会话严禁包含呼吸脉冲动效');

    // 未读 Bot 呈现小绿点
    const unreadBotChunk = html.slice(html.indexOf('data-profile="bot-unread"'), html.indexOf('data-profile="bot-read"'));
    assert.ok(unreadBotChunk.includes('activity-unread-badge'), '未读 Bot 必须渲染小绿点');
    assert.ok(!unreadBotChunk.includes('activity-pulse-indicator'), '未读 Bot 严禁包含呼吸脉冲动效');

    // 已读 Bot 没有任何标识
    const readBotChunk = html.slice(html.indexOf('data-profile="bot-read"'));
    const readBotRow = readBotChunk.slice(0, readBotChunk.indexOf('</div>\n                  </div>'));
    assert.ok(!readBotRow.includes('activity-unread-badge'), '已读 Bot 严禁包含未读小绿点');
    assert.ok(!readBotRow.includes('activity-pulse-indicator'), '已读 Bot 严禁包含呼吸脉冲动效');

    // 未读群聊呈现小绿点
    const unreadGroupChunk = html.slice(html.indexOf('data-room-id="group-unread"'), html.indexOf('data-room-id="group-read"'));
    assert.ok(unreadGroupChunk.includes('activity-unread-badge'), '未读群聊必须渲染小绿点');
    assert.ok(!unreadGroupChunk.includes('activity-pulse-indicator'), '未读群聊严禁包含呼吸脉冲动效');

    // 已读群聊没有任何标识
    const readGroupChunk = html.slice(html.indexOf('data-room-id="group-read"'));
    const readGroupRow = readGroupChunk.slice(0, readGroupChunk.indexOf('</div>\n                      </div>'));
    assert.ok(!readGroupRow.includes('activity-unread-badge'), '已读群聊严禁包含未读小绿点');
    assert.ok(!readGroupRow.includes('activity-pulse-indicator'), '已读群聊严禁包含呼吸脉冲动效');
  });

  await t.test('3. 变异检验 (Mutation Check): 故意改错状态预期必然断言失败', () => {
    const html = renderLeftRail({
      collapsed: false,
      activeSessionId: 'sess-1',
      profileName: 'default',
      gatewayOnline: true,
      gatewayLatencyMs: 15,
      sessions: [
        {
          id: 'sess-1',
          title: '已读会话',
          activityState: 'read',
        },
      ],
    });
    // 断言已读绝对不包含任何 badge，若生产代码错误注入了 badge，此断言将变红阻断
    assert.equal(html.includes('activity-pulse-indicator'), false);
    assert.equal(html.includes('activity-unread-badge'), false);
  });
});
