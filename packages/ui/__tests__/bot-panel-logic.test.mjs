/**
 * BOT 配置面板纯逻辑四象限单元测试与变异杀伤力守卫。
 *
 * 【设计意图 (Why)】
 *   静态 SSR 测试只走首帧渲染，`BotHeroCarousel` 与 `BotManagerView` 的事件、边界与
 *   墓碑分支必须由纯函数层承载并逐一验证，确保每一处分支改动都能被精确杀死。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERFLOW_THRESHOLD_PX,
  SOUL_SOFT_LIMIT_BYTES,
  canResetBotAvatar,
  computeHorizontalOverflow,
  computeSoulByteLength,
  computeSoulLineCount,
  computeTrackScrollStep,
  computeWheelScrollDelta,
  countEnabledCapabilities,
  filterBotRoster,
  filterCapabilities,
  insertTextAtSelection,
  isSoulOverLimit,
  resolveAnchorNavigation,
  resolveBotAvatar,
  resolveBotCardSubtitle,
  resolveBotDisplayTitle,
  resolveCarouselKeyTarget,
  resolveFocusableBotId,
  toggleCapabilityId,
} from '../dist/components-react/settings/botPanelLogic.js';

const baseDraft = (avatar) => ({
  displayName: '首席架构',
  description: '',
  model: 'anthropic/claude-opus-4.8',
  provider: 'anthropic',
  isDefault: false,
  soul: '',
  avatar,
  disabledSkills: [],
  enabledToolsets: [],
  enabledMcpServers: [],
});

test('resolveBotAvatar：缺省/unchanged 回落花名册，replace 覆盖，clear 墓碑抹除', () => {
  assert.equal(resolveBotAvatar('data:roster', undefined), 'data:roster');
  assert.equal(resolveBotAvatar('data:roster', baseDraft({ kind: 'unchanged' })), 'data:roster');
  assert.equal(resolveBotAvatar('data:roster', baseDraft({ kind: 'replace', dataUrl: 'data:new' })), 'data:new');
  // 墓碑语义：clear 时即使花名册仍有旧图也必须返回 undefined，不得从花名册复活。
  assert.equal(resolveBotAvatar('data:roster', baseDraft({ kind: 'clear' })), undefined);
});

test('resolveBotDisplayTitle & resolveBotCardSubtitle：草稿优先，空值回退 BOT ID', () => {
  assert.equal(resolveBotDisplayTitle('架构老王', 'arch', undefined), '架构老王');
  assert.equal(resolveBotDisplayTitle('', 'arch', undefined), 'arch');
  assert.equal(resolveBotDisplayTitle('架构老王', 'arch', baseDraft({ kind: 'unchanged' })), '首席架构');
  assert.equal(
    resolveBotDisplayTitle('架构老王', 'arch', { ...baseDraft({ kind: 'unchanged' }), displayName: '   ' }),
    'arch',
    '草稿清空显示名时应回退 ID，避免卡片出现空白标题',
  );

  const fmt = (id) => (id === 'anthropic/claude-opus-4.8' ? 'Opus 4.8' : '');
  assert.equal(resolveBotCardSubtitle('anthropic/claude-opus-4.8', 'arch', undefined, fmt), 'Opus 4.8');
  assert.equal(resolveBotCardSubtitle('', 'arch', undefined, fmt), 'arch');
  assert.equal(
    resolveBotCardSubtitle('anthropic/claude-opus-4.8', 'arch', { ...baseDraft({ kind: 'unchanged' }), model: '' }, fmt),
    'arch',
    '草稿清空模型绑定后应回退展示 ID',
  );
  assert.equal(resolveBotCardSubtitle('custom/x', 'arch', undefined, fmt), 'custom/x', '格式化返回空串时保留原始模型名');
});

test('resolveFocusableBotId：命中返回自身，未命中回退第一项，空表返回空串', () => {
  assert.equal(resolveFocusableBotId([], 'arch'), '');
  assert.equal(resolveFocusableBotId([{ id: 'default' }, { id: 'arch' }], 'arch'), 'arch');
  assert.equal(
    resolveFocusableBotId([{ id: 'default' }, { id: 'arch' }], 'ghost'),
    'default',
    'activeBotId 暂不在花名册时必须落回首项，禁止全部 tabIndex=-1',
  );
});

test('resolveCarouselKeyTarget：支持 ArrowLeft/ArrowRight 首尾回绕及 Home/End', () => {
  assert.equal(resolveCarouselKeyTarget('ArrowRight', 0, 1), -1, '单成员时禁止无意义导航');
  assert.equal(resolveCarouselKeyTarget('ArrowLeft', -1, 3), -1);
  assert.equal(resolveCarouselKeyTarget('ArrowLeft', 0, 4), 3, '首项左移应回绕到末项');
  assert.equal(resolveCarouselKeyTarget('ArrowRight', 3, 4), 0, '末项右移应回绕到首项');
  assert.equal(resolveCarouselKeyTarget('Home', 2, 4), 0);
  assert.equal(resolveCarouselKeyTarget('End', 1, 4), 3);
  assert.equal(resolveCarouselKeyTarget('Enter', 1, 4), -1, '无关按键不得触发切换');
});

test('computeHorizontalOverflow & computeWheelScrollDelta & computeTrackScrollStep：溢出阈值与滚轮归一化', () => {
  assert.equal(OVERFLOW_THRESHOLD_PX, 2);
  assert.deepEqual(computeHorizontalOverflow(0, 500, 500), { left: false, right: false });
  assert.deepEqual(computeHorizontalOverflow(0, 500, 502), { left: false, right: false }, '刚好等于 2px 容差不得误亮箭头');
  assert.deepEqual(computeHorizontalOverflow(0, 500, 520), { left: false, right: true });
  assert.deepEqual(computeHorizontalOverflow(10, 500, 520), { left: true, right: true });
  assert.deepEqual(computeHorizontalOverflow(19, 500, 520), { left: true, right: false });

  assert.equal(computeWheelScrollDelta(0, 40, 0), 40, 'pixel 模式直接使用 deltaY');
  assert.equal(computeWheelScrollDelta(-50, 20, 0), -50, '横向绝对值更大时优先取 deltaX');
  assert.equal(computeWheelScrollDelta(0, 3, 1), 48, 'line 模式按 16px 换算');
  assert.equal(computeWheelScrollDelta(0, 2, 2), 200, 'page 模式按 100px 换算');

  assert.equal(computeTrackScrollStep(0), 200);
  assert.equal(computeTrackScrollStep(280), 200, '窄容器不低于 200px 步进');
  assert.equal(computeTrackScrollStep(1000), 600, '宽容器按 60% 推进');
});

test('SOUL 字节长度与 64KB 软上限及光标插入边界夹紧', () => {
  assert.equal(SOUL_SOFT_LIMIT_BYTES, 65536);
  assert.equal(computeSoulByteLength('中'), 3, '中文必须按 UTF-8 实算 3 字节');
  assert.equal(isSoulOverLimit(65536), false, '恰好等于 64KB 不超限');
  assert.equal(isSoulOverLimit(65537), true, '64KB + 1 字节触发超限');

  assert.deepEqual(insertTextAtSelection('abcd', 'X', 1, 3), { value: 'aXd', caret: 2 }, '替换选区并定位光标到插入末尾');
  assert.deepEqual(insertTextAtSelection('abcd', 'X', null, null), { value: 'abcdX', caret: 5 }, '缺省光标追加到末尾');
  assert.deepEqual(insertTextAtSelection('abcd', 'X', -10, 999), { value: 'X', caret: 1 }, '越界光标夹紧到合法范围');
  assert.deepEqual(insertTextAtSelection('abcd', 'X', 3, 1), { value: 'abcXd', caret: 4 }, '逆序选区夹紧为折叠光标');
});

test('toggleCapabilityId & countEnabledCapabilities & canResetBotAvatar：非权威守卫与统计交集', () => {
  const authList = {
    authoritative: true,
    rows: [
      { id: 'web', label: 'Web', enabled: true },
      { id: 'browser', label: 'Browser', enabled: false },
    ],
  };
  const readonlyList = { ...authList, authoritative: false };

  assert.deepEqual(toggleCapabilityId(readonlyList, ['web'], 'browser', true), ['web'], '非权威清单严禁改写');
  assert.deepEqual(toggleCapabilityId(authList, ['web'], 'browser', true), ['web', 'browser']);
  assert.deepEqual(toggleCapabilityId(authList, ['web', 'browser'], 'web', false), ['browser']);
  assert.equal(countEnabledCapabilities(authList, ['web', 'stale-removed-tool']), 1, '陈旧 ID 不得计入启用总数');

  const valid = {
    activeId: 'arch',
    hasDetail: true,
    draft: baseDraft({ kind: 'unchanged' }),
    effectiveAvatar: 'data:img',
    locked: false,
    status: 'idle',
  };
  assert.equal(canResetBotAvatar(valid), true);
  assert.equal(canResetBotAvatar({ ...valid, locked: true }), false);
  assert.equal(canResetBotAvatar({ ...valid, effectiveAvatar: undefined }), false);
  assert.equal(canResetBotAvatar({ ...valid, draft: baseDraft({ kind: 'clear' }) }), false);
  assert.equal(canResetBotAvatar({ ...valid, status: 'detail_error' }), false);
  assert.equal(canResetBotAvatar({ ...valid, status: 'loading_detail' }), false);
  assert.equal(canResetBotAvatar({ ...valid, hasDetail: false }), false);
});

test('方案 1 垂直微轨、名单过滤、200+ 能力过滤、SOUL 行数与锚点联动', () => {
  // 垂直微轨支持 ArrowUp / ArrowDown 循环导航，语义对齐左右切换
  assert.equal(resolveCarouselKeyTarget('ArrowDown', 0, 3), 1);
  assert.equal(resolveCarouselKeyTarget('ArrowDown', 2, 3), 0);
  assert.equal(resolveCarouselKeyTarget('ArrowUp', 0, 3), 2);
  assert.equal(resolveCarouselKeyTarget('ArrowUp', 2, 3), 1);
  assert.equal(resolveCarouselKeyTarget('ArrowDown', 0, 1), -1);

  const roster = [
    { id: 'default', displayName: 'Hermes', model: 'anthropic/claude-sonnet-5', isDefault: true, hasDraft: false },
    { id: 'arch', displayName: '架构老王', model: 'anthropic/claude-opus-4.8', isDefault: false, hasDraft: true },
    { id: 'qa', displayName: '测试哨兵', model: 'openai/gpt-5.6', isDefault: false, hasDraft: false },
  ];
  assert.equal(filterBotRoster(roster, '').length, 3);
  assert.deepEqual(filterBotRoster(roster, '  老王 '), [roster[1]]);
  assert.deepEqual(filterBotRoster(roster, 'hermes').map((r) => r.id), ['default']);
  assert.deepEqual(filterBotRoster(roster, 'qa').map((r) => r.id), ['qa']);
  assert.deepEqual(filterBotRoster(roster, 'nonexistent'), []);

  const bigRows = Array.from({ length: 240 }, (_, i) => ({
    id: `skill-${i}`,
    label: i === 188 ? 'React Compiler Inspector' : `Skill Item ${i}`,
    description: i === 42 ? 'Runs security audit checks' : `desc ${i}`,
    enabled: i % 2 === 0,
  }));
  const enabledIds = bigRows.filter((_, i) => i % 2 === 0).map((row) => row.id);
  assert.equal(filterCapabilities(bigRows, enabledIds, 'all', '').length, 240);
  assert.equal(filterCapabilities(bigRows, enabledIds, 'enabled', '').length, 120);
  assert.equal(filterCapabilities(bigRows, enabledIds, 'disabled', '').length, 120);
  assert.deepEqual(
    filterCapabilities(bigRows, enabledIds, 'enabled', 'compiler').map((r) => r.id),
    ['skill-188'],
  );
  assert.deepEqual(
    filterCapabilities(bigRows, enabledIds, 'all', 'security audit').map((r) => r.id),
    ['skill-42'],
  );
  assert.deepEqual(filterCapabilities(bigRows, enabledIds, 'disabled', 'skill-188'), []);

  assert.equal(computeSoulLineCount(''), 1);
  assert.equal(computeSoulLineCount('line1'), 1);
  assert.equal(computeSoulLineCount('line1\nline2\n'), 3);

  assert.deepEqual(resolveAnchorNavigation('bot-id'), { tab: 'basic' });
  assert.deepEqual(resolveAnchorNavigation('bot-name'), { tab: 'basic' });
  assert.deepEqual(resolveAnchorNavigation('bot-model'), { tab: 'basic' });
  assert.deepEqual(resolveAnchorNavigation('bot-desc'), { tab: 'basic' });
  assert.deepEqual(resolveAnchorNavigation('bot-default'), { tab: 'basic' });
  assert.deepEqual(resolveAnchorNavigation('bot-memory'), { tab: 'basic' });
  assert.deepEqual(resolveAnchorNavigation('bot-soul'), { tab: 'soul' });
  assert.deepEqual(resolveAnchorNavigation('bot-toolsets'), { tab: 'toolsets' });
  assert.deepEqual(resolveAnchorNavigation('bot-skills'), { tab: 'skills' });
  assert.deepEqual(resolveAnchorNavigation('bot-mcp'), { tab: 'mcp' });
  assert.deepEqual(resolveAnchorNavigation('unknown-anchor'), { tab: 'basic' });
});
