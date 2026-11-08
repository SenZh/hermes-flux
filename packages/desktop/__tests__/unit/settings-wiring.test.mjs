/**
 * 设置中心接线守卫（静态探针 + 契约口径）。
 *
 * 【为什么需要】设置页最容易退化的方式不是渲染错，而是"接线断了但界面还在"：
 *   旧实现有 20 个导航项、13 个点进去只有占位；语言按钮从未绑定事件；
 *   提供商卡片是 7 个硬编码字符串。这些都不是类型错误，必须用静态断言钉住。
 *
 * 【与行为测试的分工】
 *   本文件只守"结构不许回退"（宿主、契约方法、敏感字段）；
 *   `settings-controller.test.mjs` 负责失败态、并发、幂等这些行为语义。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RENDERER = path.resolve(import.meta.dirname, '../../src/renderer/index.ts');
const CONTROLLER = path.resolve(import.meta.dirname, '../../src/renderer/settingsController.ts');
const SETTINGS_UI = path.resolve(import.meta.dirname, '../../../ui/src/components-react/settings/SettingsModal.tsx');
const UI_INDEX = path.resolve(import.meta.dirname, '../../../ui/src/index.ts');
const source = fs.readFileSync(RENDERER, 'utf8');
const controller = fs.readFileSync(CONTROLLER, 'utf8');
const settingsUi = fs.readFileSync(SETTINGS_UI, 'utf8');

test('设置页必须由 React 岛接管，禁止再走字符串模板', () => {
  assert.equal(source.includes('renderSettingsModal'), false, '旧字符串模板渲染函数必须彻底移除');
  assert.equal(source.includes('settingsTab'), false, '旧 settingsTab 状态必须收敛为 settingsSection');
  assert.ok(source.includes('mountSettingsModal'), '必须挂载 React 设置岛');
  assert.ok(source.includes('id="react-settings-host"'), '骨架里必须存在设置岛宿主');
  assert.ok(source.includes('syncReactSettings()'), '每帧必须把最新快照推给设置岛');
});

test('设置岛宿主不得被任何 innerHTML/outerHTML 覆写（否则输入焦点与滚动会被重建）', () => {
  const lines = source.split('\n');
  const offenders = lines.filter(
    (line) =>
      (line.includes('react-settings-host') && (line.includes('innerHTML') || line.includes('outerHTML'))) ||
      /getElementById\('react-settings-host'\)[\s\S]{0,40}outerHTML/.test(line),
  );
  assert.deepEqual(offenders, []);
  assert.equal(source.includes('flux-settings-modal-root'), false, '旧弹窗根节点不得复活');
});

test('语言切换必须真正落到 i18n 单例，而不是只改高亮', () => {
  assert.ok(source.includes('syncLocale()'), '启动与切换都必须同步 i18n locale');
  assert.ok(/onLocaleChange:[\s\S]{0,400}setLocale|onLocaleChange:[\s\S]{0,400}syncLocale/.test(source), '语言动作必须写回 i18n');
  assert.ok(source.includes(".setItem('hermes_flux_lang'"), '语言偏好必须持久化');
});

test('设置页的网关调用必须是真实契约方法，且参数在契约白名单内', () => {
  const contract = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../../core/src/rpc/contracts/contractTable.generated.ts'),
    'utf8',
  );
  const required = [
    'model.options',
    'model.save_key',
    'model.disconnect',
    'profiles.list',
    'mcp.servers.status',
    'skills.manage',
    'skills.reload',
    'reload.env',
  ];
  for (const method of required) {
    assert.ok(controller.includes(`'${method}'`), `设置编排必须调用真实契约方法 ${method}`);
    assert.ok(contract.includes(`'${method}':`), `契约表里必须存在 ${method}`);
  }
  assert.ok(controller.includes('include_unconfigured: true'), '设置页必须能看到未配置的提供商');
  assert.ok(controller.includes("action: 'list'"), 'skills.manage 必须显式声明 action= list');
});

test('设置快照不得包含明文密码（指纹缓存与 DevTools 都会把它带出去）', () => {
  const snapshotBlock = source.slice(
    source.indexOf('function getSettingsSnapshot'),
    source.indexOf('/** 按当前 section 懒加载对应数据'),
  );
  assert.ok(snapshotBlock.length > 0);
  assert.equal(/password:\s*state\.password/.test(snapshotBlock), false, '快照禁止直出明文密码');
  assert.ok(snapshotBlock.includes('hasStoredPassword: Boolean(state.password)'), '只允许暴露"是否已保存"');
});

test('断开提供商必须经过二次确认，不得直接调用 model.disconnect', () => {
  const actionBlock = source.slice(
    source.indexOf('onDisconnectProvider:'),
    source.indexOf('onRefreshProfiles:'),
  );
  assert.ok(actionBlock.includes('confirmModal'), '断开前必须弹二次确认');
  assert.ok(actionBlock.includes('cancelled: true'), '取消时必须显式返回 cancelled，而不是伪装成功');
  assert.ok(actionBlock.includes('controller.disconnectProvider(slug)'), '确认后才允许调用控制器');
});

test('Esc 关闭必须让位给输入法组合态', () => {
  assert.ok(settingsUi.includes('event.isComposing'), '中文输入法取消候选词时不得关闭设置弹窗');
});

test('设置页禁止再出现任何竞品/占位文案与硬编码提供商', () => {
  for (const banned of ['OPENCHAMBER', 'jev', 'agnes-ai', 'magpie', 'ipraft', 'vpi', 'tunnels']) {
    assert.equal(source.includes(banned), false, `renderer 不得残留 ${banned}`);
  }
  const i18n = fs.readFileSync(path.resolve(import.meta.dirname, '../../../ui/src/i18n/index.ts'), 'utf8');
  for (const banned of ['OPENCHAMBER', 'groupOpencode', 'providerJev', 'navTunnels', 'moduleWip']) {
    assert.equal(i18n.includes(banned), false, `i18n 字典不得残留 ${banned}`);
  }
});

test('ui barrel 必须导出设置岛入口，且旧模板文件已删除', () => {
  const index = fs.readFileSync(UI_INDEX, 'utf8');
  assert.ok(index.includes("export * from './components-react/settings/index.js';"));
  assert.equal(index.includes('components/SettingsModal/SettingsModal.js'), false);
  assert.equal(
    fs.existsSync(path.resolve(import.meta.dirname, '../../../ui/src/components/SettingsModal/SettingsModal.ts')),
    false,
    '旧字符串模板设置页必须删除，避免两套真值并存',
  );
});
