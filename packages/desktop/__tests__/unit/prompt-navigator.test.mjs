/**
 * 提示词导航轨宿主侧纯逻辑单测（覆盖设计文档 TC-017 ~ TC-019、TC-021 ~ TC-023）。
 *
 * 断言口径：
 *   1. 缓存判定必须同时覆盖「命中」与「失效」两侧，否则无法证明真的在比较；
 *   2. 滚动换算给出可手算的具体数值，禁止只断言「大于 0」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  promptMessageIndexAtScrollTop,
  topmostRectTop,
  shouldRebuildPromptIndex,
  shiftWindowStartForPrepend,
  buildHostPromptNavigatorSnapshot,
  isHostPromptNavigatorMetaSame,
} from '../../dist/renderer/promptNavigator.mjs';

test('TC-017 流式追加助手消息不重建 prompt 表', () => {
  const messages = [
    { id: 'u1', role: 'user', content: '提问' },
    { id: 'a1', role: 'assistant', content: '' },
  ];
  // 流式 token 是原地改写最后一个消息对象，数组引用不变
  const messagesRef = messages;
  messagesRef[1].content = '逐渐变长的回答……';

  assert.equal(
    shouldRebuildPromptIndex({
      sessionId: 's1',
      currentSessionId: 's1',
      cachedMessagesRef: messagesRef,
      messagesRef,
    }),
    false
  );

  // 反向证据：换一个新数组（即使内容完全相同）就必须重建
  assert.equal(
    shouldRebuildPromptIndex({
      sessionId: 's1',
      currentSessionId: 's1',
      cachedMessagesRef: messagesRef,
      messagesRef: messages.slice(),
    }),
    true
  );
});

test('TC-018 等长替换消息数组时重建 prompt 表', () => {
  const before = [
    { id: 'u1', role: 'user', content: 'a' },
    { id: 'a1', role: 'assistant', content: 'b' },
    { id: 'u2', role: 'user', content: 'c' },
  ];
  const after = [
    { id: 'u1', role: 'user', content: 'a' },
    { id: 'a1', role: 'assistant', content: 'b-rolled-back' },
    { id: 'u2', role: 'user', content: 'c-rolled-back' },
  ];
  assert.equal(before.length, after.length, '前置条件：长度相同');
  assert.equal(
    shouldRebuildPromptIndex({
      sessionId: 's1',
      currentSessionId: 's1',
      cachedMessagesRef: before,
      messagesRef: after,
    }),
    true
  );

  // 从未建表也必须重建
  assert.equal(
    shouldRebuildPromptIndex({
      sessionId: 's1',
      currentSessionId: 's1',
      cachedMessagesRef: null,
      messagesRef: before,
    }),
    true
  );
});

test('TC-019 切会话后当前项回到末条', async () => {
  const ref = [{ id: 'u1', role: 'user', content: 'a' }];
  // 会话变化：必须重建（即便数组引用未变）
  assert.equal(
    shouldRebuildPromptIndex({
      sessionId: 's1',
      currentSessionId: 's2',
      cachedMessagesRef: ref,
      messagesRef: ref,
    }),
    true
  );

  // 「切会话取末条」在宿主里的落地方式：末条 = entries.length - 1；
  // 用真实模型验证这个下标确实落在最后一次提问上。
  const { resolveActivePromptIndex } = await import('../../../ui/dist/lib/promptNavigator.js');
  const entries = [
    { id: 'u1', index: 0, preview: 'a' },
    { id: 'u2', index: 4, preview: 'b' },
    { id: 'u3', index: 9, preview: 'c' },
  ];
  const messageIndex = 9; // 末条用户消息自身
  assert.equal(resolveActivePromptIndex(entries, messageIndex), entries.length - 1);
});

test('TC-021 同一会话与同一数组引用连续判定 1000 次都返回不重建', () => {
  const messagesRef = [{ id: 'u1', role: 'user', content: 'a' }];
  let rebuilt = 0;
  for (let i = 0; i < 1000; i += 1) {
    if (
      shouldRebuildPromptIndex({
        sessionId: 's1',
        currentSessionId: 's1',
        cachedMessagesRef: messagesRef,
        messagesRef,
      })
    ) {
      rebuilt += 1;
    }
  }
  assert.equal(rebuilt, 0);
});

test('TC-022 同一条消息多个矩形时取最上', () => {
  // 行本体 top=120，页脚按钮 top=486：必须取消行本体
  assert.equal(
    topmostRectTop([
      { top: 486, height: 18 },
      { top: 120, height: 320 },
      { top: 402, height: 18 },
    ]),
    120
  );
  assert.equal(topmostRectTop([]), null);
  assert.equal(topmostRectTop([{ top: Number.NaN, height: 10 }]), null);
  // 隐藏节点高度为 0，必须被忽略，否则跳转会把 scrollTop 校正到视口顶部
  assert.equal(
    topmostRectTop([
      { top: 0, height: 0 },
      { top: 120, height: 320 },
    ]),
    120
  );
  assert.equal(topmostRectTop([{ top: 0, height: 0 }]), null);
  // 单个元素时返回自身
  assert.equal(topmostRectTop([{ top: 33.5, height: 10 }]), 33.5);
});

test('TC-023 非虚拟化的 120 条会话里滚动换算正确', () => {
  const base = {
    rowHeight: 96,
    paddingTop: 24,
    readLinePx: 100,
    total: 120,
  };
  // floor((0 - 24 + 100) / 96) = 0
  assert.equal(promptMessageIndexAtScrollTop({ ...base, scrollTop: 0 }), 0);
  // floor((1000 - 24 + 100) / 96) = floor(11.2) = 11
  assert.equal(promptMessageIndexAtScrollTop({ ...base, scrollTop: 1000 }), 11);
  // floor((11040 - 24 + 100) / 96) = floor(115.79) = 115
  assert.equal(promptMessageIndexAtScrollTop({ ...base, scrollTop: 11040 }), 115);
  // 超出内容高度的滚动位置 clamp 到最后一条
  assert.equal(promptMessageIndexAtScrollTop({ ...base, scrollTop: 999999 }), 119);
  // 行高非法时回落 96；total 为 0 时返回 0
  assert.equal(promptMessageIndexAtScrollTop({ ...base, scrollTop: 1000, rowHeight: 0 }), 11);
  assert.equal(promptMessageIndexAtScrollTop({ ...base, scrollTop: 1000, total: 0 }), 0);
  // padding 大于 scrollTop 时不得出现负下标
  assert.equal(promptMessageIndexAtScrollTop({ ...base, scrollTop: 0, paddingTop: 400 }), 0);
});

test('TC-024 头部前置插页时同幅后移挂载窗口起点，保住原视口消息', () => {
  // 中段视口（start=80）头部新增 40 条后，总长 240、容量 120：start 后移到 120
  assert.equal(shiftWindowStartForPrepend(80, 40, 240, 120), 120);
  // 短会话从 0 开始，新增 100 条变 140 条：后移到 maxStart = 20，原末尾消息仍在 [20, 140) 内
  assert.equal(shiftWindowStartForPrepend(0, 100, 140, 120), 20);
  // 越过上界时 clamp 到 total - capacity
  assert.equal(shiftWindowStartForPrepend(100, 50, 150, 120), 30);
  // 总数不超过容量时恒为 0
  assert.equal(shiftWindowStartForPrepend(0, 20, 80, 120), 0);
  // 非法/负数安全兜底
  assert.equal(shiftWindowStartForPrepend(-5, Number.NaN, 200, 120), 0);
  assert.equal(shiftWindowStartForPrepend(10, 5, 0, 120), 0);
});

test('TC-025 宿主快照构造与元信息判等：群聊研讨室严格隔离 hasOlder', () => {
  const entries = [{ id: 'u1', index: 0, preview: 'a' }];
  const sessionSnap = buildHostPromptNavigatorSnapshot(entries, 0, {
    locale: 'zh-CN',
    hasOlderMessages: true,
    isLoadingOlder: false,
    isGroupRoom: false,
  });
  assert.deepEqual(sessionSnap, {
    prompts: entries,
    activeIndex: 0,
    locale: 'zh-CN',
    hasOlder: true,
    isLoadingOlder: false,
  });

  // 群聊研讨室即便 hasOlderMessages=true 也必须抑制 hasOlder=false，遵守三态物理隔离
  const groupSnap = buildHostPromptNavigatorSnapshot(entries, 0, {
    locale: 'zh-CN',
    hasOlderMessages: true,
    isLoadingOlder: false,
    isGroupRoom: true,
  });
  assert.equal(groupSnap.hasOlder, false);

  // 元信息判等：一致时返回 true，任一元信息变化必须返回 false
  assert.equal(
    isHostPromptNavigatorMetaSame(sessionSnap, {
      locale: 'zh-CN',
      hasOlderMessages: true,
      isLoadingOlder: false,
      isGroupRoom: false,
    }),
    true
  );
  assert.equal(
    isHostPromptNavigatorMetaSame(sessionSnap, {
      locale: 'zh-CN',
      hasOlderMessages: true,
      isLoadingOlder: true,
      isGroupRoom: false,
    }),
    false
  );
  assert.equal(
    isHostPromptNavigatorMetaSame(sessionSnap, {
      locale: 'zh-CN',
      hasOlderMessages: false,
      isLoadingOlder: false,
      isGroupRoom: false,
    }),
    false
  );
  assert.equal(
    isHostPromptNavigatorMetaSame(sessionSnap, {
      locale: 'zh-CN',
      hasOlderMessages: true,
      isLoadingOlder: false,
      isGroupRoom: true,
    }),
    false
  );
  assert.equal(
    isHostPromptNavigatorMetaSame(sessionSnap, {
      locale: 'en-US',
      hasOlderMessages: true,
      isLoadingOlder: false,
      isGroupRoom: false,
    }),
    false
  );
  assert.equal(
    isHostPromptNavigatorMetaSame(null, {
      locale: 'zh-CN',
      hasOlderMessages: true,
      isLoadingOlder: false,
      isGroupRoom: false,
    }),
    false
  );
});
