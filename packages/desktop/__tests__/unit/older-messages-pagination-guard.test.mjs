import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * 历史分页与会话 Profile 透传接线守卫 (Gate 2 补强)
 *
 * 【设计意图 (Why)】
 *   防止专职 Agent 向上滚动漏传 profile 报 404、防止数据合并复发吞噬、
 *   防止群聊 roomId 穿透打单会话 REST 接口。
 *
 * 【约束与规则 (Rules)】
 *   断言精确到调用语法特征，禁止放宽，任何漏传或退化必须使测试变红。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(
  path.resolve(__dirname, '../../src/renderer/index.ts'),
  'utf8'
);

test('历史翻页与 Profile 透传接线守卫', async (t) => {
  const countMatches = (re) => (rendererSource.match(re) || []).length;

  await t.test('1. loadOlderMessages 必须严格透传 profile 参数，严禁裸调', () => {
    // 匹配 loadOlderMessages 内部的 fetchSessionMessages 调用是否携带 profile
    const hasProfileParam = /fetchSessionMessages\(\s*(?:sessionId|targetId),\s*\{[^}]*profile:\s*resolvedProfile[^}]*\}\s*\)/s.test(rendererSource);
    assert.equal(hasProfileParam, true, 'loadOlderMessages 内部的 fetchSessionMessages 必须显式携带 profile: resolvedProfile');
  });

  await t.test('2. loadOlderMessages 必须使用 planOlderBatchPrependMerge 纯函数合并历史，严禁暴力头插', () => {
    const hasPrependMerge = rendererSource.includes('state.messages = planOlderBatchPrependMerge(batch, state.messages);');
    assert.equal(hasPrependMerge, true, '必须使用 planOlderBatchPrependMerge 处理历史批次，严禁裸 [...batch, ...state.messages]');
    const rawPrepend = rendererSource.includes('state.messages = [...batch, ...state.messages];');
    assert.equal(rawPrepend, false, '严禁保留裸 [...batch, ...state.messages] 暴力头插');
  });

  await t.test('3. loadOlderMessages 必须严格包含群聊研讨室领域拦截守卫', () => {
    const hasGroupGuard = rendererSource.includes("state.activeFocus.type === 'group'");
    assert.equal(hasGroupGuard, true, '必须在滚动与翻页入口具备群聊领域守卫');
    const loadOlderRoomGuard = /loadOlderMessages[\s\S]*?hostedRoomIds\.has\(sessionId\)/.test(rendererSource);
    assert.equal(loadOlderRoomGuard, true, 'loadOlderMessages 内部必须拦截房间实体');
  });

  await t.test('4. 滚动监听器必须支持下行手势即刻释放冷却锁', () => {
    const hasReleaseOnDown = rendererSource.includes('streamScrollCooldown = false;') && rendererSource.includes('streamEl.scrollTop > lastStreamScrollTop + 4');
    assert.equal(hasReleaseOnDown, true, '必须包含对下行手势的即刻释放检测');
  });

  await t.test('5. 翻页必须显式请求 include_compacted，否则压缩归档的原始历史永远拉不出来', () => {
    const callSites = rendererSource.match(/fetchSessionMessages\(/g) || [];
    assert.ok(callSites.length >= 2, '首屏与翻页两处都必须走 fetchSessionMessages');
    const includeCompactedCount = (rendererSource.match(/includeCompacted:\s*true/g) || []).length;
    assert.ok(
      includeCompactedCount >= 2,
      '首屏 loadMessages 与 loadOlderMessages 都必须传 includeCompacted: true，保证分页口径一致'
    );
    const clientSource = readFileSync(
      path.resolve(__dirname, '../../../core/src/rpc/client.ts'),
      'utf8'
    );
    assert.ok(
      clientSource.includes('include_compacted'),
      'core 客户端必须把 includeCompacted 映射为网关参数 include_compacted'
    );
  });

  await t.test('6. 加载态必须在同步路径收敛，禁止只靠 rAF 关闭（后台标签页会被节流）', () => {
    const tail = rendererSource.slice(rendererSource.indexOf('async function loadOlderMessages'));
    const syncReset = /state\.isLoadingOlder = false;\s*\r?\n\s*render\(\);/.test(tail);
    assert.ok(syncReset, '成功路径必须先同步置 false 再 render，不能把收敛放进 requestAnimationFrame');
    assert.ok(tail.includes('olderLoadingStartedAt'), '必须有陈旧加载锁熔断时间戳');
  });
});
