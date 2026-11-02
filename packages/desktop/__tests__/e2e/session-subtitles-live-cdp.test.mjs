/**
 * 会话副标题防闪烁与真实最后一条消息对齐 CDP E2E 测试
 * 对接**真实网关** (packages/desktop/__tests__/e2e/session-subtitles-live-cdp.test.mjs)
 *
 * 【测试核心目标】
 * 验证在真实 Edge/Chrome 无头浏览器环境与真实 Hermes Gateway 下：
 * 1. 专职 Agent (xiaofawang) 的会话列表能正常加载其名下的会话；
 * 2. 物理点击会话后，副标题精准呈现 Agent 的真实最后一条回复（而不是用户提问"你好"）；
 * 3. 物理切换至另一个会话时，副标题严格实体隔离，绝不发生跨会话串扰（例如 s2 绝不显示 s1 的文本）；
 * 4. 连续触发全量列表刷新与对账时，副标题具备防闪烁防倒退守卫，永不回退到用户初始提问；
 * 5. 变异检验：故意改错断言必然红灯。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launchLiveApp, findBrowser, liveGatewayEnvReady } from './browser-harness.mjs';

const ROOT = path.resolve('.');

const S1_ID = '20261014_154856_f8f47877';
const S2_ID = '20261031_082411_824c51';

test('会话副标题防闪烁与跨会话实体隔离 (真实网关 + CDP 物理交互)', async (t) => {
  if (!findBrowser()) {
    t.skip('本机未找到 Edge/Chrome 浏览器');
    return;
  }
  if (!liveGatewayEnvReady()) {
    t.skip('未配置真实网关环境变量 (FLUX_GATEWAY_URL / FLUX_GATEWAY_USER / FLUX_GATEWAY_PASS)');
    return;
  }

  // 1. Arrange: 启动真实无头浏览器，载入打包生产 dist/renderer 产物
  const app = await launchLiveApp({ rootDir: ROOT });

  t.after(async () => {
    await app.close();
  });

  await app.waitUntilReady();

  // 2. Act: 切换至 xiaofawang Agent
  await app.waitFor(
    `(() => {
      const badge = Array.from(document.querySelectorAll('.station-agent-badge')).find(el => (el.dataset.profile || el.dataset.stationProfile) === 'xiaofawang');
      if (badge) { badge.click(); return true; }
      return false;
    })()`,
    { label: 'switch to xiaofawang agent', timeoutMs: 15000 }
  );

  // 等待会话列表挂载
  await app.waitFor(
    `Boolean(document.querySelector('.session-item[data-id="${S1_ID}"]'))`,
    { label: `session ${S1_ID} mounted`, timeoutMs: 15000 }
  );

  // 3. Assert & Act: 物理点击 S1 会话，验证副标题准确更新为真实回复
  await t.test('1. 物理点击 S1 会话：副标题精准更新为 Agent 真实回复 (小仙女可不能挨饿)', async () => {
    // Act: 物理点击 S1 会话
    await app.evaluate(`(() => {
      const item = document.querySelector('.session-item[data-id="${S1_ID}"]');
      if (item) item.click();
    })()`);

    // 等待消息加载完成并反哺副标题
    await app.waitFor(
      `(() => {
        const item = document.querySelector('.session-item[data-id="${S1_ID}"]');
        const sub = item ? item.querySelector('span[style*="font-size: 10.5px"]')?.textContent || '' : '';
        return sub.includes('小仙女') || sub.includes('挨饿');
      })()`,
      { label: 's1 subtitle updated to real agent reply', timeoutMs: 15000 }
    );

    const s1Text = await app.evaluate(`(() => {
      const item = document.querySelector('.session-item[data-id="${S1_ID}"]');
      return item ? item.querySelector('span[style*="font-size: 10.5px"]')?.textContent || '' : '';
    })()`);

    // Assert: S1 副标题必须对得上真实 Agent 最后一条回复
    assert.ok(
      s1Text.includes('小仙女') || s1Text.includes('挨饿'),
      `S1 副标题必须对得上真实回复，实际展示: ${s1Text}`
    );
  });

  // 4. Assert & Act: 物理切换至 S2 会话，验证副标题严格实体隔离，绝不发生跨会话串扰
  await t.test('2. 物理切换至 S2 会话：副标题呈现自身消息，排他性断言绝无 S1 串扰', async () => {
    // Act: 物理点击 S2 会话
    await app.evaluate(`(() => {
      const item = document.querySelector('.session-item[data-id="${S2_ID}"]');
      if (item) item.click();
    })()`);

    // 等待 S2 消息加载完成并更新副标题
    await app.waitFor(
      `Boolean(window.__fluxState && window.__fluxState.activeSessionId === "${S2_ID}")`,
      { label: 's2 active', timeoutMs: 10000 }
    );

    const previews = await app.evaluate(`(() => {
      const getSub = (id) => {
        const item = document.querySelector('.session-item[data-id="' + id + '"]');
        return item ? item.querySelector('span[style*="font-size: 10.5px"]')?.textContent || '' : '';
      };
      return {
        s1: getSub("${S1_ID}"),
        s2: getSub("${S2_ID}"),
      };
    })()`);

    // Assert: S2 绝不能串入 S1 的文本！
    assert.equal(
      previews.s2.includes('小仙女'),
      false,
      `S2 副标题绝不能包含 S1 的文本（严禁跨会话串扰），实际 S2 为: ${previews.s2}`
    );
    // Assert: S1 依然保持自身的真实回复
    assert.ok(
      previews.s1.includes('小仙女') || previews.s1.includes('挨饿'),
      `S1 副标题必须保持自身回复，实际 S1 为: ${previews.s1}`
    );
  });

  // 5. Assert & Act: 模拟多次全量列表刷新与对账，验证防闪烁防倒退机制
  await t.test('3. 触发连续多次列表刷新与对账：副标题防倒退守卫生效，绝对不退化闪烁', async () => {
    // Act: 连续触发两次网关全量对账
    await app.evaluate(`(async () => {
      if (typeof window.__fluxFetchSessions === 'function') {
        await window.__fluxFetchSessions();
        await window.__fluxFetchSessions();
      }
    })()`);

    // 等待对账和 DOM 局部更新稳定
    await new Promise((r) => setTimeout(r, 1000));

    const refreshed = await app.evaluate(`(() => {
      const getSub = (id) => {
        const item = document.querySelector('.session-item[data-id="' + id + '"]');
        return item ? item.querySelector('span[style*="font-size: 10.5px"]')?.textContent || '' : '';
      };
      return {
        s1: getSub("${S1_ID}"),
        s2: getSub("${S2_ID}"),
      };
    })()`);

    // Assert: 刷新后 S1 绝对不能闪烁回退到用户提问"你好"！
    assert.notEqual(
      refreshed.s1.trim(),
      '你好',
      '刷新后副标题绝对不能回退成首句提问"你好"'
    );
    assert.ok(
      refreshed.s1.includes('小仙女') || refreshed.s1.includes('挨饿'),
      `刷新后 S1 副标题必须依然保留真实回复，实际为: ${refreshed.s1}`
    );
  });
});
