/**
 * 设置中心 · 真实网关端到端验收（真实 Blink + 真实打包产物 + 真实 Hermes 网关）。
 *
 * 【设计意图 (Why)】
 *   离线 CDP 只能证明"没连网关时的失败态"。设置页最容易骗人的地方恰恰在联网时：
 *   提供商卡片是不是真实 `model.options` 返回的、技能/MCP 是不是真实运行态、
 *   搜索与排序在 50+ 条真实数据下是否可用。这些必须对着真实网关点出来。
 *
 * 【防范的历史坑 (Pitfall)】
 *   旧设置页把 7 个提供商写死在模板里（jev / agnes-ai / CPA / FN / magpie），
 *   即使网关返回完全不同的列表，界面也照样"好看"。本测试直接断言
 *   页面上的 provider slug 集合与网关 RPC 返回的 slug 集合一致。
 *
 * 【约束与规则 (Rules)】
 *   - 只在 FLUX_GATEWAY_URL / FLUX_GATEWAY_USER / FLUX_GATEWAY_PASS 齐备时运行，否则显式 skip；
 *   - 凭据只从环境变量读取，绝不写入日志或截图；
 *   - 只读操作：打开设置、切换页签、输入检索、截图；不保存密钥、不断开提供商。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchLiveApp, findBrowser, liveGatewayEnvReady } from './browser-harness.mjs';
import { login, openRpc, fetchTicket, liveGatewayBase } from './live-gateway-client.mjs';

test('settings-center-live: 真实网关下的提供商、技能与检索（出图）', async (t) => {
  const noop = t.skip ? t.skip.bind(t) : () => {};
  if (!findBrowser()) return noop('未找到 Edge/Chrome');
  if (!liveGatewayEnvReady()) return noop('未配置 FLUX_GATEWAY_URL/USER/PASS');

  const rootDir = path.resolve('.');
  if (!fs.existsSync(path.join(rootDir, 'packages/desktop/dist/renderer/index.js'))) {
    return noop('renderer 产物缺失，先 npm run build');
  }

  // 先直接取一份网关真实响应，作为 DOM 的对照基准（避免"页面自己说自己对"）。
  const { cookie } = await login();
  const ticket = await fetchTicket(cookie);
  const rpc = openRpc(cookie, ticket);
  await rpc.ready;
  let expectedProviders = [];
  let expectedSkills = 0;
  try {
    const options = await rpc.call('model.options', { profile: 'default', include_unconfigured: true });
    expectedProviders = (Array.isArray(options?.providers) ? options.providers : [])
      .map((row) => String(row?.slug || '').trim())
      .filter(Boolean);
    const skills = await rpc.call('skills.manage', { profile: 'default', action: 'list' });
    for (const names of Object.values(skills?.skills || {})) {
      if (Array.isArray(names)) expectedSkills += names.filter((name) => typeof name === 'string' && name.trim()).length;
    }
  } finally {
    rpc.close();
  }
  assert.ok(expectedProviders.length >= 5, `真实网关返回的 provider 太少（${expectedProviders.length}），无法形成有效对照`);

  const app = await launchLiveApp({ rootDir });
  t.after(async () => { await app.close(); });

  await app.waitUntilReady();

  await app.waitFor('Boolean(document.getElementById("btn-open-settings"))', { label: '顶栏设置入口' });
  await app.evaluate('document.getElementById("btn-open-settings").click()');
  await app.waitFor('Boolean(document.querySelector("[data-testid=settings-dialog]"))', { label: '设置弹窗' });

  // 提供商页：必须出现真实数据，且 slug 集合与网关响应一致。
  await app.evaluate('document.querySelector("[data-settings-section=providers]").click()');
  await app.waitFor('document.querySelectorAll("[data-provider-slug]").length > 0', {
    label: '真实提供商行',
    timeoutMs: 20000,
  });

  const renderedSlugs = await app.evaluate(
    'Array.from(document.querySelectorAll("[data-provider-slug]")).map((node) => node.getAttribute("data-provider-slug"))',
  );
  assert.equal(
    renderedSlugs.length,
    expectedProviders.length,
    `设置页渲染 ${renderedSlugs.length} 个 provider，网关返回 ${expectedProviders.length} 个`,
  );
  assert.deepEqual([...renderedSlugs].sort(), [...expectedProviders].sort(), '设置页 provider 集合必须与网关 model.options 完全一致');
  for (const fake of ['jev', 'agnes-ai', 'CPA', 'magpie', 'ipraft', 'vpi']) {
    assert.equal(renderedSlugs.includes(fake), false, `不得出现硬编码假提供商 ${fake}`);
  }

  // 当前使用的 provider 必须置顶（若网关明确给出 provider）。
  const currentSlug = await app.evaluate('String(window.__fluxState.currentProvider || "").trim()');
  if (currentSlug) {
    assert.equal(renderedSlugs[0], currentSlug, '当前使用的 provider 必须排在第一行');
  }

  // 搜索：输入真实 slug 片段后，所有可见行都必须命中。
  const needle = expectedProviders[0].slice(0, Math.min(4, expectedProviders[0].length));
  await app.evaluate(`(() => {
    const input = Array.from(document.querySelectorAll('input')).find((node) => node.getAttribute('aria-label')?.includes('搜索提供商'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(needle)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await app.waitFor(
    `Array.from(document.querySelectorAll('[data-provider-slug]')).every((node) => node.getAttribute('data-provider-slug').includes(${JSON.stringify(needle)}) || node.textContent.includes(${JSON.stringify(needle)}))`,
    { label: '提供商检索过滤' },
  );
  const filteredCount = await app.evaluate('document.querySelectorAll("[data-provider-slug]").length');
  assert.ok(filteredCount >= 1 && filteredCount <= expectedProviders.length, `检索结果数量异常：${filteredCount}`);

  // 清空检索
  await app.evaluate(`(() => {
    const input = Array.from(document.querySelectorAll('input')).find((node) => node.getAttribute('aria-label')?.includes('搜索提供商'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);

  // 扩展页：技能清单必须来自真实 skills.manage。
  await app.evaluate('document.querySelector("[data-settings-section=extensions]").click()');
  await app.waitFor('document.querySelectorAll("[data-settings-section=extensions][aria-current=page]").length === 1', {
    label: '扩展页激活',
  });
  await app.waitFor(
    'document.body.textContent.includes("技能") && !document.body.textContent.includes("正在加载…")',
    { label: '技能数据落位', timeoutMs: 20000 },
  );
  const skillsPanelText = await app.evaluate('document.querySelector("[data-testid=settings-dialog] section").textContent');
  assert.ok(skillsPanelText.length > 0);
  if (expectedSkills > 0) {
    const skillBadges = await app.evaluate(
      'Array.from(document.querySelectorAll("[data-testid=settings-dialog] section span")).filter((node) => node.className.includes("rounded-full")).length',
    );
    assert.ok(skillBadges > 0, `网关返回 ${expectedSkills} 个技能，但扩展页没有渲染任何技能徽标`);
  }

  // 数字员工页：真实 profiles.list。
  await app.evaluate('document.querySelector("[data-settings-section=agents]").click()');
  await app.waitFor('Boolean(document.querySelector("[data-settings-section=agents][aria-current=page]"))', { label: '数字员工页激活' });
  await app.waitFor('document.body.textContent.includes("打开") || document.body.textContent.includes("Open")', {
    label: '员工行渲染',
    timeoutMs: 20000,
  });

  // 截图留证（先等两帧，避免拍到上一帧）
  const settle = async () => {
    await app.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise((resolve) => setTimeout(resolve, 150));
  };
  const shotDir = path.resolve(rootDir, 'artifacts/verification');
  fs.mkdirSync(shotDir, { recursive: true });

  await app.evaluate('document.querySelector("[data-settings-section=providers]").click()');
  await app.waitFor('Boolean(document.querySelector("[data-settings-section=providers][aria-current=page]"))', { label: '回到提供商页' });
  await settle();
  const shot = await app.cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(shotDir, 'settings-center-live-providers.png'), Buffer.from(shot.data, 'base64'));

  await app.evaluate('document.querySelector("[data-settings-section=extensions]").click()');
  await settle();
  const shot2 = await app.cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(shotDir, 'settings-center-live-extensions.png'), Buffer.from(shot2.data, 'base64'));

  assert.deepEqual(app.pageErrors, [], `页面不得有未捕获异常：${app.pageErrors.join(' | ')}`);
  assert.equal(liveGatewayBase().startsWith('http'), true);
});
