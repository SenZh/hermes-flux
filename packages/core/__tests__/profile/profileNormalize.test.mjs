import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentProfile } from '../../dist/rpc/profileNormalize.js';

test('normalizeAgentProfile - ID与显示名称解耦及别名归一化测试', async (t) => {
  await t.test('1. name 为 default 且未提供别名/显示名时，默认显示名称归一为 Hermes', () => {
    const profile = normalizeAgentProfile({
      name: 'default',
    });
    assert.equal(profile.name, 'default');
    assert.equal(profile.displayName, 'Hermes');
    assert.equal(profile.isDefault, true);
  });

  await t.test('2. 传入 ui_meta hermes-bots title 时，能够正确识别官方 Desktop 保存的自定义名 (如大总管)', () => {
    const profile = normalizeAgentProfile({
      name: 'default',
      display_name: '',
      ui_meta: {
        'hermes-bots': {
          title: '大总管',
        },
      },
    });
    assert.equal(profile.name, 'default');
    assert.equal(profile.displayName, '大总管');
  });

  await t.test('3. 传入 ui_meta hermes-bots alias 时，能够兼容兜底识别', () => {
    const profile = normalizeAgentProfile({
      name: 'default',
      display_name: '',
      ui_meta: {
        'hermes-bots': {
          alias: '大总管',
        },
      },
    });
    assert.equal(profile.name, 'default');
    assert.equal(profile.displayName, '大总管');
  });

  await t.test('3. 传入 alias 别名时，优先使用 alias 作为 displayName', () => {
    const profile = normalizeAgentProfile({
      name: 'default',
      alias: '我的专属智能体',
    });
    assert.equal(profile.name, 'default');
    assert.equal(profile.displayName, '我的专属智能体');
  });

  await t.test('4. 自定义智能体未提供 displayName 时，使用其自身 name 兜底', () => {
    const profile = normalizeAgentProfile({
      name: 'arch-wang',
    });
    assert.equal(profile.name, 'arch-wang');
    assert.equal(profile.displayName, 'arch-wang');
    assert.equal(profile.isDefault, false);
  });

  await t.test('5. 传入 display_name 时，优先使用 display_name', () => {
    const profile = normalizeAgentProfile({
      name: 'arch-wang',
      display_name: '架构王 (老王)',
      alias: '老王',
    });
    assert.equal(profile.displayName, '架构王 (老王)');
  });

  await t.test('6. 边界值：空对象或 null 输入时安全降级', () => {
    const p1 = normalizeAgentProfile(null);
    assert.equal(p1.name, 'default');
    assert.equal(p1.displayName, 'Hermes');

    const p2 = normalizeAgentProfile({});
    assert.equal(p2.name, 'default');
    assert.equal(p2.displayName, 'Hermes');
  });

  /**
   * `isDefault` 的三条分支必须逐条锁定：
   *   BOT 面板的「设为默认」写的是 `ui_meta['hermes-bots'].is_default`，
   *   归一化读不回同一个键，就会出现"保存成功但徽章永远不出现"的写读口径分裂。
   */
  await t.test('7. isDefault：ui_meta 显式 true 时置默认（写读同一键）', () => {
    const profile = normalizeAgentProfile({
      name: 'arch-wang',
      is_default: false,
      ui_meta: { 'hermes-bots': { is_default: true } },
    });
    assert.equal(profile.isDefault, true, '保存到 ui_meta 的默认标记必须能读回');
  });

  await t.test('8. isDefault：内置 default 可用显式 false 取消隐含默认（唯一性可转移）', () => {
    const profile = normalizeAgentProfile({
      name: 'default',
      ui_meta: { 'hermes-bots': { is_default: false } },
    });
    assert.equal(profile.isDefault, false, '显式 false 必须能取消内置 default 的隐含默认');
  });

  await t.test('9. isDefault：内置 default 缺少该键时仍保持默认', () => {
    const profile = normalizeAgentProfile({ name: 'default', ui_meta: { 'hermes-bots': {} } });
    assert.equal(profile.isDefault, true, '没有显式 false 时内置 default 必须仍是默认');

    const noMeta = normalizeAgentProfile({ name: 'default' });
    assert.equal(noMeta.isDefault, true);
  });
});
