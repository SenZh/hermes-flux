import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * 接线级源码守卫（Gate 2 补强）
 *
 * 【设计意图 (Why)】
 * rollbackTransaction 的纯函数已具变异杀伤力，但"生产代码是否真的调用了它们"无法靠纯函数单测证明——
 * 删掉 index.ts 里的一行调用，469 项测试仍全绿，属假安全。本守卫对源码做结构性断言，
 * 让"消费/解除接线被摘除"这一具体回归路径必然变红。
 *
 * 【防范的历史坑 (Pitfall)】
 * 上一轮真实缺陷：sessionHistoryTrust 只写不读（死守卫）、deleteSession 4007 分支漏调 armed 解除。
 * 二者都是"逻辑对但没接线"，纯函数测试永远抓不到。
 *
 * 【约束与规则 (Rules)】
 * 只读源码文本、不执行；断言精确到调用点数量，禁止放宽为"包含即可"。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionOpPath = path.resolve(__dirname, '../../src/renderer/services/sessionOperationService.ts');
const messageLoadPath = path.resolve(__dirname, '../../src/renderer/services/messageLoadingService.ts');
const rendererSource = [
  readFileSync(path.resolve(__dirname, '../../src/renderer/index.ts'), 'utf8'),
  existsSync(sessionOpPath) ? readFileSync(sessionOpPath, 'utf8') : '',
  existsSync(messageLoadPath) ? readFileSync(messageLoadPath, 'utf8') : '',
].join('\n');

test('交互区接线源码守卫（server-priority 消费 / armed 解除 / 单点构造）', async (t) => {
  const countMatches = (re) => (rendererSource.match(re) || []).length;

  await t.test('1. server-priority 必须经 takeServerPriority 三处消费（REST/WS回退/空权威），禁止裸 map 判断', () => {
    const consumes = countMatches(/takeServerPriority\(sessionHistoryTrust/g);
    assert.equal(consumes, 3, `server-priority 消费点应为 3（REST/WS/空权威），实得 ${consumes}`);
    const nakedRead = countMatches(/sessionHistoryTrust\.get\([^)]*\)\s*===\s*['"]server-priority['"]/);
    assert.equal(nakedRead, 0, '禁止绕过 takeServerPriority 的裸 map 读取（会破坏一次性消费语义）');
  });

  await t.test('2. deleteSession 两处切会话分支都必须调用 handleArmedOnDelete', () => {
    const guards = countMatches(/handleArmedOnDelete\(id\)/g);
    assert.ok(guards >= 2, `deleteSession 主路径与 4007 清理分支都要解除 armed，实得 ${guards} 处`);
  });

  await t.test('3. 离开会话的全部入口都必须经 disarmRollbackOnLeave 解除 armed', () => {
    // selectSession / createNewSession / openGroupRoom / openBotChat + handleArmedOnDelete 内部
    const disarms = countMatches(/disarmRollbackOnLeave\(/g);
    assert.ok(disarms >= 4, `切会话入口解除 armed 至少 4 处，实得 ${disarms}`);
  });

  await t.test('4. renderer 严禁手拼截断 wire 字段（唯一构造点在 core InteractiveService）', () => {
    const nakedTruncate = countMatches(/['"]?truncate_before_(row_id|message_id)['"]?\s*:/g);
    assert.equal(nakedTruncate, 0, 'render 层不得出现 truncate_before_* 字面量，必须走 core truncateAndSubmit');
  });

  await t.test('5. renderer 严禁直接调 session.branch（必须走 core forkSession）', () => {
    const nakedBranch = countMatches(/['"]session\.branch['"]/g);
    assert.equal(nakedBranch, 0, 'session.branch 只能由 core InteractiveService 单点发起');
  });

  await t.test('6. disconnect 必须清空挂起回滚', () => {
    assert.ok(
      /state\.rollbackArmed = null;/.test(rendererSource),
      '断线必须丢弃挂起回滚，防重连后横幅跨会话泄漏'
    );
  });

  await t.test('7. input-dock-container 必须包含 rollback-cancel 事件分发，杜绝横幅移位后取消失效', () => {
    const dockCancelBound = countMatches(/dockContainer\.addEventListener\(\s*['"]click['"][\s\S]*?rollback-cancel/);
    assert.ok(dockCancelBound >= 1, 'input-dock-container 必须建立 rollback-cancel 事件委托');
  });

  await t.test('8. 重置流式态必须成对清空 token 合并器与工具补丁队列', () => {
    assert.ok(
      /tokenCoalescer\.clear\(\);\s*toolPatchQueue\.clear\(\);/.test(rendererSource),
      'resetActiveStreamingState 必须同时清空两者，否则残留补丁会在收口后覆写 React 子树'
    );
  });

  await t.test('9. 流式收口依赖必须真实委托到补丁队列与计时器，禁止传空实现', () => {
    const clearers = countMatches(/clearToolPatchQueue:\s*\(\)\s*=>\s*toolPatchQueue\.clear\(\)/g);
    assert.ok(clearers >= 2, `补丁队列清理必须至少装配到 2 处收口依赖（实得 ${clearers}）`);
    const stoppers = countMatches(/stopRunningToolTimers:\s*\(\)\s*=>\s*stopRunningToolTimers\(\)/g);
    assert.ok(stoppers >= 2, `工具计时器停止必须至少装配到 2 处收口依赖（实得 ${stoppers}）`);
    const nearBottom = countMatches(/isStreamNearBottom:\s*\([^)]*\)\s*=>\s*isStreamNearBottom\(/g);
    assert.ok(nearBottom >= 3, `贴底判定必须至少装配到 3 处依赖（实得 ${nearBottom}）`);
  });
});
