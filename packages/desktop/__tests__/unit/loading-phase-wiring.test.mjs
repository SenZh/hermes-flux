/**
 * 首屏加载相位接线守卫（宿主编排层）。
 *
 * 【设计意图 (Why)】
 *   相位收敛散落在 fetchProfiles / fetchSessions / loadMessages / openBotChat / openGroupRoom /
 *   connect / disconnect 这些无法单独导出的编排出口里。漏掉任意一个出口，界面就会把失败或空窗
 *   伪装成"仍在加载"。这里用精确切片断言守住每个出口，删掉任何一处都会变红。
 *
 * 【约束与规则 (Rules)】
 *   1. 切片必须按真实函数边界，禁止定长字符窗口——后者会吞进后面函数的同名赋值，
 *      本文件早期版本因此在删除 openGroupRoom 两行相位后仍然全绿（假绿）。
 *   2. 断言要落到具体出口的计数，禁止"只要函数里出现过一次就通过"。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(__dirname, '../../src/renderer/index.ts'), 'utf8');

/** 取函数体片段：从签名起到下一个顶层声明之前。 */
function bodyOf(signatureMarker) {
  const start = source.indexOf(signatureMarker);
  assert.ok(start >= 0, `找不到函数签名：${signatureMarker}`);
  const rest = source.slice(start + signatureMarker.length);
  const boundary = rest.search(/\n(?:export )?(?:async function |function |const |let |interface |type )/);
  return boundary < 0 ? rest : rest.slice(0, boundary);
}

function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('Agent 域：成功与失败都必须离开骨架相位', () => {
  const body = bodyOf('async function fetchProfiles(');
  assert.equal(countOf(body, "state.profilesPhase = 'ready';"), 2, '成功与失败两个出口都要收敛 profilesPhase');
  const catchBlock = body.slice(body.indexOf('} catch (e) {'));
  assert.ok(catchBlock.includes('void applyColdStartFocus();'), '失败后仍要按已有数据裁决冷启动落点');
});

test('会话域：对账落地后必须离开骨架相位', () => {
  const body = bodyOf('async function fetchSessions(');
  assert.equal(countOf(body, "state.sessionsPhase = 'ready';"), 1, '会话域落地后必须收敛 sessionsPhase');
  assert.equal(countOf(body, "state.profilesPhase = 'ready';"), 1, '内联读取 Profile 成功时也要收敛 Agent 相位');
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

test('进入 Agent 冷路径：清空视口即声明 loading，失败的两个出口都必须收敛', () => {
  const body = bodyOf('async function openBotChat(');
  assert.equal(countOf(body, "state.messagesPhase = 'loading';"), 1, '冷路径清空视口时必须声明 loading');
  const catchBlock = body.slice(body.indexOf('} catch (err) {'));
  assert.equal(
    countOf(catchBlock, "state.messagesPhase = 'ready';"),
    2,
    'catch 内「无缓存直达 render」与「焦点非三类」两个出口都必须收敛，缺一即把失败伪装成慢加载'
  );
  assert.ok(body.includes('cancelColdStartFocus();'), '显式进入 Agent 即视为用户意图');
});

test('进入群聊：进入声明 loading，记录落地即收敛（各自恰好一次）', () => {
  const body = bodyOf('async function openGroupRoom(');
  assert.equal(countOf(body, "state.messagesPhase = 'loading';"), 1, '进入房间必须声明 loading');
  assert.equal(countOf(body, "state.messagesPhase = 'ready';"), 1, '日志或种子通知落地后必须收敛');
  assert.ok(body.includes('if (guarded.status === \'discarded\') return;'), '早退由新宿主接管相位，此处不得再写');
});

test('冷启动落点：三域可执行性必须先于封存，且兜底字面量不得当作用户选择', () => {
  const body = bodyOf('async function applyColdStartFocus(');
  const guardIndex = body.indexOf('if (!gatewayClient || !getEffectiveUrl(state.gatewayUrl) || !state.gatewayConnected) return;');
  const sealIndex = body.indexOf('coldStartFocusApplied = true;');
  assert.ok(guardIndex >= 0, '必须同时检查客户端对象、网关地址与传输连接态');
  assert.ok(sealIndex >= 0, '必须有封存标记');
  assert.ok(guardIndex < sealIndex, '可执行性判断必须在封存之前，否则提前封存会让默认焦点永久失效');
  assert.ok(
    body.includes("|| (state.profileName !== 'default' ? state.profileName : undefined)"),
    "兜底字面量 'default' 不得被当成用户的真实选择"
  );
});

test('连接失败与未配置：三域相位必须复位为 ready', () => {
  const body = bodyOf('async function connect(');
  const resets = body.match(/state\.(profilesPhase|sessionsPhase|messagesPhase) = 'ready';/g) || [];
  assert.ok(resets.length >= 9, `连接路径的空/失败出口至少要复位 3 域 × 3 条路径，实际 ${resets.length} 处`);
});

test('断线：不得把断线表现成仍在加载', () => {
  const body = bodyOf('function disconnect(');
  assert.ok(body.includes("state.messagesPhase = 'ready';"), '断线时立刻离开 loading');
});
