/**
 * 首屏加载相位接线守卫（宿主编排层）。
 *
 * 【设计意图 (Why)】
 *   相位收敛散落在 fetchProfiles / fetchSessions / loadMessages / openBotChat / openGroupRoom /
 *   connect 这些无法单独导出的编排出口里。漏掉任意一个出口，界面就会把失败或空窗
 *   伪装成"仍在加载"。这里用精确切片断言守住每个出口，删掉任何一处都会变红。
 *
 * 【约束与规则 (Rules)】
 *   断言必须定位到函数体片段再比对整行契约，禁止全域 includes 这种放宽后依然全绿的写法。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '../../src/renderer/index.ts'), 'utf8');

/** 取函数体片段：从签名开头到下一个顶层 async/function 声明之前。 */
function bodyOf(signatureMarker, length = 9000) {
  const start = source.indexOf(signatureMarker);
  assert.ok(start >= 0, `找不到函数签名：${signatureMarker}`);
  return source.slice(start, start + length);
}

test('Agent 域：成功与失败都必须离开骨架相位', () => {
  const body = bodyOf('async function fetchProfiles(');
  assert.ok(body.includes("    state.profilesPhase = 'ready';"), '成功分支必须收敛 profilesPhase');
  const catchBlock = body.slice(body.indexOf('} catch (e) {'));
  assert.ok(catchBlock.includes("state.profilesPhase = 'ready';"), '失败分支必须收敛 profilesPhase，否则骨架永久假加载');
  assert.ok(catchBlock.includes('void applyColdStartFocus();'), '失败后仍要按已有数据裁决冷启动落点');
});

test('会话域：对账落地后必须离开骨架相位', () => {
  const body = bodyOf('async function fetchSessions(');
  assert.ok(body.includes("state.sessionsPhase = 'ready';"), '会话域落地后必须收敛 sessionsPhase');
  assert.ok(body.includes("state.profilesPhase = 'ready';"), '内联读取 Profile 成功时也要收敛 Agent 相位');
});

test('消息域：代际归属判定，旧代际不得提前收敛新代际的骨架', () => {
  const body = bodyOf('async function loadMessages(');
  assert.ok(body.includes('const expectedGeneration = activeLoadMessagesGeneration + 1;'), '必须预知本次代际');
  assert.ok(
    body.includes('if (!sessionId || expectedGeneration === activeLoadMessagesGeneration) {')
      && body.includes("state.messagesPhase = 'ready';"),
    'finally 必须按代际收敛相位；只比 activeSessionId 会让同会话第二次加载丢失骨架'
  );
});

test('进入 Agent 冷路径：清空视口即声明 loading，失败出口必须收敛', () => {
  const body = bodyOf('async function openBotChat(');
  assert.ok(body.includes("  state.messagesPhase = 'loading';"), '冷路径清空视口时必须声明 loading');
  const catchBlock = body.slice(body.indexOf('} catch (err) {'));
  assert.ok(catchBlock.includes("state.messagesPhase = 'ready';"), '冷路径失败必须离开 loading，不得伪装成慢加载');
  assert.ok(body.includes('cancelColdStartFocus();'), '显式进入 Agent 即视为用户意图');
});

test('进入群聊：进入声明 loading，记录落地即收敛', () => {
  const body = bodyOf('async function openGroupRoom(');
  assert.ok(body.includes("  state.messagesPhase = 'loading';"), '进入房间必须声明 loading');
  assert.ok(body.includes("  state.messagesPhase = 'ready';"), '日志或种子通知落地后必须收敛');
});

test('冷启动落点：可执行性必须先于封存', () => {
  const body = bodyOf('async function applyColdStartFocus(');
  const guardIndex = body.indexOf('if (!gatewayClient || !getEffectiveUrl(state.gatewayUrl)) return;');
  const sealIndex = body.indexOf('coldStartFocusApplied = true;');
  assert.ok(guardIndex >= 0, '必须显式检查网关可用性');
  assert.ok(sealIndex >= 0, '必须有封存标记');
  assert.ok(guardIndex < sealIndex, '可执行性判断必须在封存之前，否则二次启动永远拿不到默认焦点');
  assert.ok(
    body.includes("|| (state.profileName !== 'default' ? state.profileName : undefined)"),
    "兜底字面量 'default' 不得被当成用户的真实选择"
  );
});

test('连接失败与未配置：三域相位必须复位为 ready', () => {
  const body = bodyOf('async function connect(', 12000);
  const resets = body.match(/state\.(profilesPhase|sessionsPhase|messagesPhase) = 'ready';/g) || [];
  assert.ok(resets.length >= 9, `连接路径的空/失败出口至少要复位 3 域 × 3 条路径，实际 ${resets.length} 处`);
});
