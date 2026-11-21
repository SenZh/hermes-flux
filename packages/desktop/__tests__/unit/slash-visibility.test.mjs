import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIVERSAL_DESKTOP_EXCLUDED,
  BOT_SESSION_EXCLUDED,
  GROUP_ROOM_EXCLUDED,
  DESKTOP_EXCLUDED_COMMANDS,
  getEffectiveExcludedCommands,
  buildAliasSet,
  filterDesktopCommands,
  isDesktopVisible,
  normalizeCommandName,
  resolveCommandAlias,
} from '../../dist/renderer/slashVisibility.mjs';

test('斜杠可见性：三层黑名单分层与并集模型', async (t) => {
  await t.test('terminal 与 hidden 在桌面端不展示', () => {
    assert.equal(isDesktopVisible('terminal'), false);
    assert.equal(isDesktopVisible('hidden'), false);
  });

  await t.test('桌面端通用黑名单（Tier 1）包含终端专属控制命令与 GUI 冗余/失效命令', () => {
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED instanceof Set);
    assert.equal(DESKTOP_EXCLUDED_COMMANDS, UNIVERSAL_DESKTOP_EXCLUDED, '别名引用保持一致');

    // 1. 终端 TUI 控制
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('mouse'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('density'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('logs'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('palette'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('skin'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('battery'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('timestamps'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('statusbar'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('quit'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('exit'));

    // 2. 桌面端已有专门控件/按钮承载的冗余命令（GUI 已具备，无需手敲命令）
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('new'), '桌面端侧栏与顶栏已有新建会话按钮');
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('reset'), '重置会话已有新建旁聊机制');
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('undo'), '撤回消息已有卡片操作栏与挂起确认条');
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('rollback'), '回滚已有可视化确认');
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('fork'), '分叉会话已有消息卡片 fork-msg');
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('branch'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('help'), '/help 输出 1.3 万字符终端文本塞进 5s dockNotice 截断溢出，桌面端无意义');
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('status'), '/status 已有顶栏网络态与 ContextGauge 仪表盘');
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('steer'), '运行态按 Enter 自动入队，托盘卡片原生支持插话纠偏');
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('queue'), '运行态自动排队，无需手敲 /q');
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('q'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('s'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('model'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('yolo'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('approvals'));
    assert.ok(UNIVERSAL_DESKTOP_EXCLUDED.has('reasoning'));

    // 3. 通用黑名单严禁误伤普通会话下的合法工作流命令
    assert.ok(!UNIVERSAL_DESKTOP_EXCLUDED.has('compress'));
    assert.ok(!UNIVERSAL_DESKTOP_EXCLUDED.has('compact'));
    assert.ok(!UNIVERSAL_DESKTOP_EXCLUDED.has('btw'));
    assert.ok(!UNIVERSAL_DESKTOP_EXCLUDED.has('plan'));
    assert.ok(!UNIVERSAL_DESKTOP_EXCLUDED.has('goal'));
    assert.ok(!UNIVERSAL_DESKTOP_EXCLUDED.has('review'));
  });

  await t.test('Bot 专属黑名单（Tier 2）保护终身主工位', () => {
    assert.ok(BOT_SESSION_EXCLUDED.has('handoff'));
    assert.ok(BOT_SESSION_EXCLUDED.has('archive'));
    assert.ok(BOT_SESSION_EXCLUDED.has('delete'));
  });

  await t.test('群聊专属黑名单（Tier 3）屏蔽单会话生命周期与控制指令', () => {
    assert.ok(GROUP_ROOM_EXCLUDED.has('compress'));
    assert.ok(GROUP_ROOM_EXCLUDED.has('compact'));
    assert.ok(GROUP_ROOM_EXCLUDED.has('btw'));
    assert.ok(GROUP_ROOM_EXCLUDED.has('retry'));
    assert.ok(GROUP_ROOM_EXCLUDED.has('plan'));
    assert.ok(GROUP_ROOM_EXCLUDED.has('goal'));
    assert.ok(GROUP_ROOM_EXCLUDED.has('review'));
    assert.ok(GROUP_ROOM_EXCLUDED.has('refine'));
    assert.ok(GROUP_ROOM_EXCLUDED.has('moa'));
    assert.ok(GROUP_ROOM_EXCLUDED.has('subgoal'));
  });

  await t.test('getEffectiveExcludedCommands：三层黑名单并集正确计算', () => {
    // 1. 普通会话（scratchpad）：仅 Universal 生效
    const scratchpadSet = getEffectiveExcludedCommands({ sessionKind: 'scratchpad' });
    assert.ok(scratchpadSet.has('mouse'));
    assert.ok(scratchpadSet.has('new'));
    assert.ok(!scratchpadSet.has('compress'));
    assert.ok(!scratchpadSet.has('plan'));
    assert.ok(!scratchpadSet.has('handoff'));

    // 2. Bot 终身主工位：Universal ∪ BOT_SESSION_EXCLUDED
    const botSet = getEffectiveExcludedCommands({ sessionKind: 'bot_forever_chat' });
    assert.ok(botSet.has('new'));
    assert.ok(botSet.has('handoff'), 'Bot 主工位不可交接');
    assert.ok(botSet.has('archive'), 'Bot 主工位不可归档');
    assert.ok(!botSet.has('compress'), 'Bot 主工位允许压缩上下文');

    // 3. 多 Agent 群聊：Universal ∪ GROUP_ROOM_EXCLUDED
    const groupSet = getEffectiveExcludedCommands({ sessionKind: 'group_room' });
    assert.ok(groupSet.has('new'));
    assert.ok(groupSet.has('compress'), '群聊不可执行单会话压缩');
    assert.ok(groupSet.has('plan'), '群聊不可执行单人规划');
    assert.ok(groupSet.has('btw'), '群聊不可执行旁路外援');
  });

  await t.test('filterDesktopCommands：在群聊模式下彻底过滤所有单会话 Skills', () => {
    const items = [
      { name: '/compress' },
      { name: '/plan' },
      { name: '/human-writing', isSkill: true },
      { name: '/code-review', isSkill: true },
    ];
    const marks = new Map();
    const aliases = new Set();

    // 在普通会话下：compress、plan 与技能均展示
    const normalOut = filterDesktopCommands({
      items,
      desktopMarks: marks,
      aliases,
      sessionKind: 'scratchpad',
    });
    assert.deepEqual(normalOut.map((i) => i.name), [
      '/compress',
      '/plan',
      '/human-writing',
      '/code-review',
    ]);

    // 在群聊模式下：compress、plan（群聊黑名单）及全部技能均被彻底过滤
    const groupOut = filterDesktopCommands({
      items,
      desktopMarks: marks,
      aliases,
      sessionKind: 'group_room',
    });
    assert.deepEqual(groupOut, [], '群聊模式下所有单会话指令与技能全部被过滤');
  });

  await t.test('别名集合剔除主名自身，并归一前导斜杠与尾随空格', () => {
    const aliases = buildAliasSet({
      '/reset': '/new',
      '/compact': '/compress',
      '/s ': '/steer',
      '/new': '/new',
    });
    assert.ok(aliases.has('reset'));
    assert.ok(aliases.has('compact'));
    assert.ok(aliases.has('s'), '带尾随空格的别名必须归一后仍能折叠');
    assert.ok(!aliases.has('new'), '主命令自身不是别名');
  });

  await t.test('resolveCommandAlias：本地别名归一与参数保留', () => {
    // 1. 无 canon 时 /compact 强兜底映射到 /compress，防范网关 NoneType 崩溃
    assert.equal(resolveCommandAlias('/compact'), '/compress');
    assert.equal(resolveCommandAlias('/compact here 3'), '/compress here 3');
    assert.equal(resolveCommandAlias('/compact --preview'), '/compress --preview');

    // 2. 结合 canon 映射表归一
    const canon = {
      '/reset': '/new',
      '/s ': '/steer',
      '/compact': '/compress',
    };
    assert.equal(resolveCommandAlias('/reset', canon), '/new');
    assert.equal(resolveCommandAlias('/reset next', canon), '/new next');
    assert.equal(resolveCommandAlias('/s check this', canon), '/steer check this');

    // 3. 非别名命令保留原文
    assert.equal(resolveCommandAlias('/goal optimize performance', canon), '/goal optimize performance');
    assert.equal(resolveCommandAlias('/compress here 5', canon), '/compress here 5');

    // 4. 普通非斜杠文本原样返回
    assert.equal(resolveCommandAlias('hello world', canon), 'hello world');
  });
});
