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
  // 提供商统一表把每个 Agent 的 model.options 交给 providerCatalog 并发拉取，
  // 因此契约校验必须同时覆盖 controller 与 providerCatalog 两个真实调用点。
  const catalog = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../src/renderer/providerCatalog.ts'),
    'utf8',
  );
  const required = ['model.options', 'profiles.list', 'mcp.servers.status', 'skills.manage', 'skills.reload'];
  for (const method of required) {
    assert.ok(controller.includes(`'${method}'`) || catalog.includes(`'${method}'`), `设置编排必须调用真实契约方法 ${method}`);
    assert.ok(contract.includes(`'${method}':`), `契约表里必须存在 ${method}`);
  }
  assert.ok(catalog.includes('explicit_only: true'), '提供商统一表必须用 explicit_only 口径，掺进未配置的骨架行就判不出谁真的配了');
  assert.ok(controller.includes("action: 'list'"), 'skills.manage 必须显式声明 action= list');
});

test('设置快照不得包含明文密码（指纹缓存与 DevTools 都会把它带出去）', () => {
  const snapshotBlock = source.slice(
    source.indexOf('function getSettingsSnapshot'),
    source.indexOf('function ensureSettingsSectionData'),
  );
  assert.ok(snapshotBlock.length > 0);
  assert.equal(/password:\s*state\.password/.test(snapshotBlock), false, '快照禁止直出明文密码');
  assert.ok(snapshotBlock.includes('hasStoredPassword: Boolean(state.password)'), '只允许暴露"是否已保存"');
});

test('破坏性写操作必须经过二次确认，且删除范围在点击瞬间就确定', () => {
  const start = source.indexOf('onDeleteEndpoint:');
  assert.ok(start !== -1, '必须存在 onDeleteEndpoint 动作');
  // 按下一个动作名切分，不用固定字符数：窗口随代码增长会静默失焦。
  const next = source.indexOf('onToggleProviderAgent:', start);
  assert.ok(next > start, 'onToggleProviderAgent 必须紧跟其后，切片边界才可信');
  const block = source.slice(start, next);

  assert.ok(block.includes('confirmModal'), '删除端点前必须弹二次确认');
  assert.ok(block.includes('cancelled: true'), '取消时必须显式返回 cancelled，而不是伪装成功');
  assert.ok(
    block.includes('planProviderRemoval('),
    '删除范围必须由 planProviderRemoval 判定：作用域是配置集合，不是在用集合',
  );
  assert.ok(
    block.includes('settingsEndpointProfiles['),
    '删除必须按配置集合收敛：只删在用集合会漏掉未生效的端点，出现"能看见却删不掉"',
  );
  assert.equal(
    block.includes('profilesWithProvider('),
    false,
    '不得再用在用集合决定删除范围（上一版的 bug 形态）',
  );
  assert.ok(
    block.includes('settingsEndpointFailures.length > 0'),
    '端点清单读取失败时必须拒删：作用域不完整会漏删却报成功',
  );
  assert.ok(
    block.includes('providerDeletePartial'),
    '部分失败必须把失败名单回显给用户，不能只 toast「已删除」',
  );
  assert.ok(
    block.includes('result.failed'),
    '控制器返回的 failed 必须被消费，不能丢弃',
  );

  const logoutStart = source.indexOf('onLogoutProvider:');
  assert.ok(logoutStart !== -1, '必须存在 onLogoutProvider 动作');
  const logoutBlock = source.slice(logoutStart, logoutStart + 2400);
  assert.ok(logoutBlock.includes('confirmModal'), '退出订阅前必须弹二次确认');
  assert.ok(
    logoutBlock.includes('planDeleteTarget'),
    '退出订阅只作用于当前 Agent，必须在点击瞬间锁定它',
  );
});

test('订阅取消勾选必须走断开登录，不能去删端点', () => {
  const start = source.indexOf('onToggleProviderAgent:');
  assert.ok(start !== -1, '必须存在 onToggleProviderAgent 动作');
  const block = source.slice(start, source.indexOf('onNotify:', start));
  assert.ok(
    block.includes("case 'logout-subscription'"),
    '订阅没有端点记录，取消绑定只能走 OAuth 登出',
  );
  const logoutCase = block.slice(block.indexOf("case 'logout-subscription'"));
  assert.ok(
    logoutCase.slice(0, 400).includes('controller.logoutOauth('),
    '该分支必须调用 logoutOauth',
  );
  assert.equal(
    logoutCase.slice(0, 400).includes('controller.remove('),
    false,
    '绝不能退回去删 custom-endpoints：订阅不在端点清单里，必然 404',
  );
});

test('勾选未配置的自定义端点：先从其它成员复制密钥，复制失败才要求手填', () => {
  const start = source.indexOf("case 'attach':");
  assert.ok(start !== -1, '必须存在 attach 分支');
  const block = source.slice(start, source.indexOf("case 'logout-subscription':", start));
  const copyAt = block.indexOf('controller.resolveEndpointKey(');
  const needsKeyAt = block.indexOf('needsKey: true');
  assert.ok(copyAt !== -1, '勾回已取消的成员时必须先尝试复用其它成员的密钥');
  assert.ok(needsKeyAt > copyAt, '只有复制失败才返回 needsKey，不能让首次勾选无条件弹密钥输入');
  assert.ok(
    block.includes('settingsEndpointProfiles[targetId]'),
    '复制来源必须是配置集合：按 model.options 的在用集合会漏掉未生效成员',
  );
  assert.ok(block.includes('draftFromEndpoint(row)'), '端点定义仍从原始行还原，不能只复制密钥');
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
