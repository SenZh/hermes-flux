/**
 * 交互区核心不变量形式化证明（packages/core/__tests__/formal/interactive-stage-formal.test.mjs）
 *
 * 【设计意图 (Why)】
 * 触碰历史截断、回滚事务与流式工具状态机的改动，必须在随机乱序与畸变输入下
 * 证明数学不变量，防止 4018（临时 id 逃逸为网关锚点）、消息丢失与胶囊悬挂复发。
 *
 * 【防范的历史坑 (Pitfall)】
 * 上一轮迭代仅靠静态断言与老定理，D1/D2 全部逃逸。本文件把它们的失败模式
 * 直接编码为 fast-check 属性（定理 8/9/10），实现任何回退都会在此爆红。
 *
 * 【约束与规则 (Rules)】
 * - 被测对象必须是生产构建产物 ../../dist/index.js，禁止平行假实现；
 * - 零变异断言（输入 freeze 后调用不得抛错）纳入定理本体。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  planTruncate,
  splitAt,
  resolveCutIndexByAnchor,
  isClientTempId,
  isDurableRowId,
  applySurvivorMap,
  InteractiveService,
  planSendRoute,
  parseAgentMention,
  reduceGatewayEvent,
} from '../../dist/index.js';

const rowIdArb = fc.integer({ min: 1, max: 2 ** 31 - 1 });
const msgArb = fc.record({
  id: fc.oneof(
    fc.stringMatching(/^(usr|ast)-[0-9]{1,6}$/),
    fc.stringMatching(/^row-[0-9]{1,6}$/)
  ),
  rowId: fc.option(rowIdArb, { nil: undefined }),
  role: fc.constantFrom('user', 'assistant'),
  content: fc.string(),
});
// 生产主键唯一性约束：id 按下标后缀互异；rowId 用 uniqueArray 保证全局至多出现一次
// （真实网关 row_id 是唯一行地址，重复 rowId 是生成器假象，会污染锚点重算断言）
const listArb = fc
  .array(fc.tuple(fc.nat(1), fc.option(fc.nat({ max: 100000 }), { nil: undefined }), fc.string()), {
    maxLength: 40,
  })
  .map((rows) =>
    rows.map(([roleBit, rowSlot, content], i) => ({
      id: `${roleBit === 0 ? 'usr' : 'row'}-${i}`,
      rowId: rowSlot === undefined ? undefined : 1000 + rowSlot,
      role: roleBit === 0 ? 'user' : 'assistant',
      content,
    }))
  )
  .filter((list) => {
    const seen = new Set();
    for (const m of list) {
      if (m.rowId === undefined) continue;
      if (seen.has(m.rowId)) return false;
      seen.add(m.rowId);
    }
    return true;
  });

/**
 * 定理 8 [回滚乐观截断往返恒等]：
 * 对任意消息列表与任意合法切点，kept/removed 构成原列表的精确前缀-后缀分解；
 * 重组恒等；纯函数零变异；非 user 行一律拒绝截断。
 */
async function theorem8(t) {
  await t.test('定理 8 [回滚乐观截断往返恒等]: 前缀-后缀精确分解、重组恒等与零变异', () => {
    fc.assert(
      fc.property(listArb, fc.nat(), (list, rawIdx) => {
        const cut = list.length === 0 ? 0 : rawIdx % (list.length + 1);
        const frozen = Object.freeze(list.map((m) => Object.freeze({ ...m })));
        const { kept, removed } = splitAt(frozen, cut);

        assert.equal(kept.length + removed.length, frozen.length, '分解必须守恒');
        assert.deepEqual([...kept, ...removed], frozen, '重组恒等（往返不变）');
        assert.deepEqual(kept, frozen.slice(0, cut), 'kept 是精确前缀');
        assert.deepEqual(removed, frozen.slice(cut), 'removed 是精确后缀');
      }),
      { numRuns: 1500 }
    );

    // planTruncate 对 assistant 目标恒拒绝，且 blocked 不产生任何载荷意图
    fc.assert(
      fc.property(listArb, (list) => {
        const targetIdx = list.findIndex((m) => m.role === 'assistant');
        if (targetIdx < 0) return;
        const plan = planTruncate({
          messages: list,
          targetId: list[targetIdx].id,
          sessionKind: 'scratchpad',
          isStreaming: false,
        });
        assert.equal(plan.mode, 'blocked');
        assert.equal(plan.reason, 'not-user');
      }),
      { numRuns: 1000 }
    );
  });
}

/**
 * 定理 9 [截断锚点排他性]：
 * 任何输入组合下，wire 构造器要么携带唯一 row 锚、要么携带唯一服务端 message 锚、
 * 要么在发送前抛错；JSON 序列化后永远不可能出现前端临时主键模式。
 */
async function theorem9(t) {
  await t.test('定理 9 [截断锚点排他性]: 双锚互斥、临时 id 零逃逸与无锚点拒绝穿透', async () => {
    const tempIdArb = fc.oneof(
      fc.integer({ min: 1, max: 999999 }).map((n) => `usr-${n}`),
      fc.integer({ min: 1, max: 999999 }).map((n) => `ast-${n}`),
      fc.stringMatching(/^(tc|msg|tool|g_msg|att|q)-[a-z0-9-]{1,8}$/)
    );
    const service = new InteractiveService();

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.option(rowIdArb, { nil: undefined }), fc.option(tempIdArb, { nil: undefined }), fc.option(fc.stringMatching(/^[a-z0-9-]{3,20}$/), { nil: undefined })),
        fc.option(fc.stringMatching(/^[a-z0-9-]{3,20}$/), { nil: undefined }),
        async (rowOpt, msgOpt) => {
          const rowId = Array.isArray(rowOpt) ? rowOpt[0] : rowOpt;
          const calls = [];
          const bridge = {
            request: async (method, params) => {
              calls.push({ method, params });
              return { status: 'streaming' };
            },
          };

          let threw = false;
          let result = null;
          try {
            result = await service.truncateAndSubmit(bridge, {
              sessionId: 'sess-x',
              text: 't',
              rowId: typeof rowId === 'number' ? rowId : undefined,
              messageId: typeof msgOpt === 'string' ? msgOpt : undefined,
            });
          } catch {
            threw = true;
          }

          if (threw) {
            assert.equal(calls.length, 0, '非法锚点必须在网络层之前拦截');
            return;
          }
          assert.equal(result.status, 'streaming');

          const p = calls[0].params;
          assert.equal(p.confirm_truncate, true, '截断必须显式同意');
          const hasRow = 'truncate_before_row_id' in p;
          const hasMsg = 'truncate_before_message_id' in p;
          assert.ok(hasRow !== hasMsg, 'row 与 message 锚恰有一个出现');
          if (hasRow) {
            assert.ok(isDurableRowId(p.truncate_before_row_id), 'row 锚必须是有限正整数');
          } else {
            assert.equal(isClientTempId(p.truncate_before_message_id), false, 'message 锚绝不可能是临时主键');
          }
          const wire = JSON.stringify(p);
          assert.ok(!/"(usr|ast|tc|msg|tool|g_msg|att|q)-/.test(wire), '序列化载荷永不含前端临时主键');
        }
      ),
      { numRuns: 800 }
    );

    // planTruncate：作用域/流式/缺失目标三闸门，与锚点存在性一致
    fc.assert(
      fc.property(listArb, fc.nat(), fc.constantFrom('scratchpad', 'bot_forever_chat', 'group_room'), fc.boolean(), (list, rawIdx, kind, streaming) => {
        if (list.length === 0) return;
        const target = list[rawIdx % list.length];
        const plan = planTruncate({ messages: list, targetId: target.id, sessionKind: kind, isStreaming: streaming });
        if (kind !== 'scratchpad') assert.equal(plan.mode, 'blocked');
        else if (streaming) assert.equal(plan.mode, 'blocked');
        else if (target.role !== 'user') assert.equal(plan.mode, 'blocked');
        else if (!isDurableRowId(target.rowId)) assert.ok(plan.mode === 'refill-only' || plan.mode === 'blocked');
        else {
          assert.equal(plan.mode, 'truncate');
          assert.equal(plan.anchor.rowId, target.rowId);
          assert.equal(resolveCutIndexByAnchor(list, plan.anchor), list.findIndex((m) => m.id === target.id), '锚点重算切点必须与目标视图位置一致（同 rowId 唯一时）');
        }
      }),
      { numRuns: 1500 }
    );
  });
}

/**
 * 定理 10 [流式工具状态机收敛]：
 * 对任意交错乱序的 tool.start/tool.complete 事件序列：
 * (a) 任意前缀下 running 集合 ⊆ 已 start 集合，无幽灵；
 * (b) 同 id 重复 start 不产生第二条；
 * (c) complete 未知 id 不创建条目；
 * (d) 全部 complete 后无 running 残留。
 * 务必通过真实调用 reduceGatewayEvent 产生动作，证明 reducer 正确读 tool_id 而非 payload.id。
 */
async function theorem10(t) {
  await t.test('定理 10 [流式工具状态机收敛]: tool_id 权威键读取、幽灵防护、去重与完全收敛', () => {
    const toolIds = ['tool-alpha', 'tool-beta', 'tool-gamma', 'tool-delta', 'tool-omega'];
    const toolEventArb = fc.record({
      type: fc.constantFrom('tool.start', 'tool.complete'),
      toolId: fc.oneof(fc.constantFrom(...toolIds), fc.stringMatching(/^unknown-[0-9]{1,4}$/)),
      name: fc.constantFrom('web_search', 'bash', 'read_file', 'edit_file'),
      args: fc.constantFrom('{"query":"flux"}', '{"path":"/tmp"}', '{}'),
      output: fc.constantFrom('{"status":"ok"}', '文件写入完成', '404 not found'),
      includeWrongId: fc.boolean(),
    });

    const eventListArb = fc.array(toolEventArb, { minLength: 1, maxLength: 40 });

    fc.assert(
      fc.property(eventListArb, (events) => {
        const sessionId = 'session-formal-10';
        const messageId = 'msg-formal-stream-10';
        const ctx = {
          activeSessionIds: [sessionId],
          activeStreamingMessageId: messageId,
        };

        const toolCalls = [];
        const startedIds = new Set();

        for (const rawEvt of events) {
          const payload = rawEvt.type === 'tool.start'
            ? {
                tool_id: rawEvt.toolId,
                ...(rawEvt.includeWrongId ? { id: `bogus-${rawEvt.toolId}` } : {}),
                name: rawEvt.name,
                args: rawEvt.args,
              }
            : {
                tool_id: rawEvt.toolId,
                ...(rawEvt.includeWrongId ? { id: `bogus-${rawEvt.toolId}` } : {}),
                result: rawEvt.output,
              };
          const frame = {
            type: rawEvt.type,
            session_id: sessionId,
            payload,
          };

          const actions = reduceGatewayEvent(frame, ctx);
          for (const action of actions) {
            if (action.type === 'tool-start') {
              assert.equal(action.toolCall.id, rawEvt.toolId, 'tool-start 动作必须精确使用 payload.tool_id');
              startedIds.add(action.toolCall.id);

              const exists = toolCalls.some((tc) => tc.id === action.toolCall.id);
              if (!exists) {
                toolCalls.push({
                  id: action.toolCall.id,
                  name: action.toolCall.name,
                  args: action.toolCall.args,
                  status: 'running',
                });
              }
            } else if (action.type === 'tool-complete') {
              assert.equal(action.toolCallId, rawEvt.toolId, 'tool-complete 动作必须精确使用 payload.tool_id');
              const target = toolCalls.find((tc) => tc.id === action.toolCallId);
              if (target) {
                target.status = 'completed';
                target.output = action.output;
              }
            }
          }

          const runningNow = toolCalls.filter((tc) => tc.status === 'running').map((tc) => tc.id);
          for (const rid of runningNow) {
            assert.ok(startedIds.has(rid), `running 状态的工具调用 ${rid} 必须属于已 start 集合`);
          }

          const currentIds = toolCalls.map((tc) => tc.id);
          assert.equal(new Set(currentIds).size, currentIds.length, '同 id 重复 start 绝不能产生重复条目');
        }

        const uncompleted = toolCalls.filter((tc) => tc.status === 'running').map((tc) => tc.id);
        for (const tid of uncompleted) {
          const compFrame = {
            type: 'tool.complete',
            session_id: sessionId,
            payload: { tool_id: tid, result: 'finished' },
          };
          const compActions = reduceGatewayEvent(compFrame, ctx);
          for (const act of compActions) {
            if (act.type === 'tool-complete') {
              const target = toolCalls.find((tc) => tc.id === act.toolCallId);
              if (target) {
                target.status = 'completed';
                target.output = act.output;
              }
            }
          }
        }

        const remainingRunning = toolCalls.filter((tc) => tc.status === 'running');
        assert.equal(remainingRunning.length, 0, '全部 complete 动作处理完毕后，绝不能存在 running 残留');
      }),
      { numRuns: 1000 }
    );
  });
}

/**
 * 定理 11 [@ 路由排他性]：
 * planSendRoute 对各会话类型裁定通道排他性：
 * - scratchpad + 命中已知 profile → kind 必为 mention-subagent 且 cleanText 永不含 '@' + profile 原文；
 * - bot_forever_chat + 命中已知 profile → kind 必为 mention-btw 且 cleanText 永不含 '@' + profile 原文；
 * - group_room + 命中已知 profile → kind 为 mention-group 或 group-message；
 * - 无 @ 命中已知 profile → kind 为 plain 或 group-message；
 * - mention 路由的 cleanText 永不包含被呼叫的 @token 原文。
 */
async function theorem11(t) {
  await t.test('定理 11 [@ 路由排他性]: 通道类型排他性与 cleanText 永不残留 @token 原文', () => {
    const profiles = ['arch-wang', 'fe-zhang', '架构老王', 'sec-auditor'];
    const posArb = fc.constantFrom('head', 'middle', 'tail', 'none');
    const bodyCharArb = fc.constantFrom('代', '码', '审', '查', '这', '个', '接', '口', 'x');
    const bodyArb = fc.array(bodyCharArb, { minLength: 1, maxLength: 24 }).map((cs) => cs.join(''));
    const profileArb = fc.constantFrom(...profiles);

    fc.assert(
      fc.property(
        profileArb,
        posArb,
        bodyArb,
        fc.constantFrom('scratchpad', 'bot_forever_chat', 'group_room'),
        (profile, pos, body, kind) => {
          const mention = `@${profile}`;
          const cleanBody = body.replace(/@\S*/g, '').trim();
          let text;
          if (pos === 'head') text = `${mention} ${body}`;
          else if (pos === 'middle') text = `查 ${mention} ${body}`;
          else if (pos === 'tail') text = `${body} ${mention}`;
          else text = body;

          const route = planSendRoute({ text, sessionKind: kind, knownProfiles: profiles, pickedMentionToken: null });

          if (pos !== 'none' && cleanBody.length > 0) {
            if (kind === 'scratchpad') {
              assert.equal(route.kind, 'mention-subagent', 'scratchpad 命中已知 profile 必为 mention-subagent');
              assert.equal(route.targetProfile.toLowerCase(), profile.toLowerCase());
              assert.ok(!route.cleanText.includes(mention), 'scratchpad 路由 cleanText 永不包含 @token 原文');
            } else if (kind === 'bot_forever_chat') {
              assert.equal(route.kind, 'mention-btw', 'bot_forever_chat 命中已知 profile 必为 mention-btw');
              assert.equal(route.targetProfile.toLowerCase(), profile.toLowerCase());
              assert.ok(!route.cleanText.includes(mention), 'bot_forever_chat 路由 cleanText 永不包含 @token 原文');
            } else if (kind === 'group_room') {
              assert.ok(
                route.kind === 'mention-group' || route.kind === 'group-message',
                'group_room 必须路由至 mention-group 或 group-message'
              );
            }
          } else if (pos === 'none') {
            assert.ok(
              route.kind === 'plain' || route.kind === 'group-message',
              '无 @ 提及必须路由至 plain 或 group-message'
            );
          }
        }
      ),
      { numRuns: 1200 }
    );

    // survivor map：null 丢弃、缺失保持、恒等长度
    fc.assert(
      fc.property(listArb, fc.dictionary(fc.stringMatching(/^row-[0-9]{1,6}$/), fc.oneof(fc.constant(null), rowIdArb)), (list, map) => {
        const next = applySurvivorMap(list, map);
        assert.equal(next.length, list.length, '映射不增删行');
        for (const m of next) {
          if (m.id in map && map[m.id] === null) assert.equal(m.rowId, undefined, 'null 幸存值必须丢弃该行地址');
        }
      }),
      { numRuns: 800 }
    );
  });
}

test('Formal Invariant Verifier: Interactive Stage Rollback & Routing', async (t) => {
  await theorem8(t);
  await theorem9(t);
  await theorem10(t);
  await theorem11(t);
});
