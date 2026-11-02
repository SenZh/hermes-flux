import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMessage,
  renderContextGauge,
  renderTokenMetrics,
} from '../../dist/components/MiddlePod/MiddlePod.js';

test('Interactive Stage UI Components - 对话区交互操作栏、Token仪表与水位计', async (t) => {
  await t.test('1. 用户消息行：普通会话下渲染常驻时间戳、复制、回滚与Fork按钮', () => {
    const html = renderMessage({
      id: 'msg-u1',
      rowId: 101,
      role: 'user',
      content: '请帮我实现消息排队',
      timestamp: '14:28:05',
      isGroupRoom: false,
      isBotRoom: false,
    });

    assert.ok(html.includes('14:28:05'), '必须渲染时间戳');
    assert.ok(html.includes('data-action="copy-msg"'), '必须渲染复制按钮');
    assert.ok(html.includes('data-action="rollback-msg"'), '普通会话必须渲染回滚按钮');
    assert.ok(html.includes('data-action="fork-msg"'), '普通会话必须渲染Fork按钮');
    assert.ok(html.includes('data-row-id="101"'), '回滚按钮必须带上目标 row_id');
    // 纯图标与 hover 提示物理断言：禁止包含 span 文字，必须具备 title 与 aria-label
    assert.ok(!html.includes('<span>复制</span>') && !html.includes('<span>Copy</span>'), '用户行复制按钮严禁内联文本标签');
    assert.ok(!html.includes('<span>回滚</span>') && !html.includes('<span>Rollback</span>'), '用户行回滚按钮严禁内联文本标签');
    assert.ok(!html.includes('<span>Fork 分支</span>') && !html.includes('<span>Fork Branch</span>'), '用户行Fork按钮严禁内联文本标签');
    assert.ok(html.includes('title='), '用户行按钮必须具备 title 悬浮说明');
    assert.ok(html.includes('aria-label='), '用户行按钮必须具备 aria-label 无障碍说明');
  });

  await t.test('2. 场景边界隔离：Bot 会话与群聊房间绝对禁止渲染回滚和Fork', () => {
    // Bot 工位
    const botHtml = renderMessage({
      id: 'msg-u2',
      rowId: 102,
      role: 'user',
      content: 'Bot 提问',
      timestamp: '14:30:00',
      isBotRoom: true,
    });
    assert.ok(!botHtml.includes('data-action="rollback-msg"'), 'Bot工位禁止渲染回滚');
    assert.ok(!botHtml.includes('data-action="fork-msg"'), 'Bot工位禁止渲染Fork');
    assert.ok(botHtml.includes('data-action="copy-msg"'), '复制功能依然保留');

    // 群聊房间
    const groupHtml = renderMessage({
      id: 'msg-u3',
      rowId: 103,
      role: 'user',
      content: '群聊提问',
      timestamp: '14:31:00',
      isGroupRoom: true,
    });
    assert.ok(!groupHtml.includes('data-action="rollback-msg"'), '群聊禁止渲染回滚');
    assert.ok(!groupHtml.includes('data-action="fork-msg"'), '群聊禁止渲染Fork');
  });

  await t.test('3. AI 助手行：普通会话下支持 Fork、重新生成与复制，群聊强显身份头像与阶梯式Token性能仪表', () => {
    // 3.1 普通会话助手行：渲染 Fork 与重新生成
    const ordinaryHtml = renderMessage({
      id: 'msg-a0',
      role: 'assistant',
      content: '普通会话下的回复',
      model: 'deepseek-chat',
      isGroupRoom: false,
      isBotRoom: false,
    });
    assert.ok(ordinaryHtml.includes('data-action="fork-msg"'), '普通会话助手行必须渲染 Fork 按钮');
    assert.ok(ordinaryHtml.includes('data-action="regenerate-msg"'), '普通会话助手行必须渲染重新生成按钮');
    assert.ok(ordinaryHtml.includes('data-action="copy-msg"'), '普通会话助手行必须渲染复制按钮');
    // 助手行纯图标化物理断言：禁止包含 span 文字，必须具备 title 与 aria-label 说明
    assert.ok(!ordinaryHtml.includes('<span>Fork 分支</span>') && !ordinaryHtml.includes('<span>Fork Branch</span>'), '助手行Fork按钮严禁内联文本标签');
    assert.ok(!ordinaryHtml.includes('<span>重新生成</span>') && !ordinaryHtml.includes('<span>Regenerate</span>'), '助手行重新生成按钮严禁内联文本标签');
    assert.ok(!ordinaryHtml.includes('<span>复制</span>') && !ordinaryHtml.includes('<span>Copy</span>'), '助手行复制按钮严禁内联文本标签');
    assert.ok(ordinaryHtml.includes('title='), '助手行按钮必须具备 title 悬浮说明');
    assert.ok(ordinaryHtml.includes('aria-label='), '助手行按钮必须具备 aria-label 无障碍说明');

    // 3.1.1 核心边界断言：非回合末尾（isLastInTurn: false，如中间步骤/工具调用）坚决隐藏底部操作栏与时间戳
    const stepHtml = renderMessage(
      {
        id: 'msg-step-1',
        role: 'assistant',
        content: '这是思考过程或工具调用中间步骤',
        timestamp: '14:32:00',
        isGroupRoom: false,
      },
      'HERMES AGENT',
      { isFirstInTurn: true, isLastInTurn: false, isStreaming: false }
    );
    assert.ok(!stepHtml.includes('assistant-footer-bar'), '中间步骤绝不能渲染底部操作栏');
    assert.ok(!stepHtml.includes('data-action="copy-msg"'), '中间步骤禁止渲染复制按钮');
    assert.ok(!stepHtml.includes('data-action="fork-msg"'), '中间步骤禁止渲染Fork按钮');
    assert.ok(!stepHtml.includes('data-action="regenerate-msg"'), '中间步骤禁止渲染重新生成按钮');
    assert.ok(!stepHtml.includes('time-tag'), '中间步骤禁止渲染完成时间戳');

    // 3.1.2 核心边界断言：流式生成进行中（isStreaming: true），末尾行也坚决隐藏底部操作栏与完成时间戳
    const streamingHtml = renderMessage(
      {
        id: 'msg-stream-active',
        role: 'assistant',
        content: '正在生成最终回答的 token 流...',
        timestamp: '14:33:00',
        isGroupRoom: false,
      },
      'HERMES AGENT',
      { isFirstInTurn: true, isLastInTurn: true, isStreaming: true }
    );
    assert.ok(!streamingHtml.includes('assistant-footer-bar'), '流式生成过程中禁止渲染底部操作栏');
    assert.ok(!streamingHtml.includes('data-action="copy-msg"'), '流式生成中禁止渲染复制按钮');
    assert.ok(!streamingHtml.includes('time-tag'), '流式生成中禁止渲染完成时间戳');

    // 3.1.3 核心正向断言：仅当最终生成完成（isLastInTurn: true && isStreaming: false）时，才完整渲染操作栏与时间戳
    const completedHtml = renderMessage(
      {
        id: 'msg-completed',
        role: 'assistant',
        content: '这是最终完成的回答内容',
        model: 'deepseek-chat',
        timestamp: '14:34:00',
        durationMs: 3200,
        isGroupRoom: false,
      },
      'HERMES AGENT',
      { isFirstInTurn: true, isLastInTurn: true, isStreaming: false }
    );
    assert.ok(completedHtml.includes('assistant-footer-bar'), '最终生成完成必须渲染操作栏');
    assert.ok(completedHtml.includes('data-action="copy-msg"'), '最终生成完成必须包含复制');
    assert.ok(completedHtml.includes('data-action="fork-msg"'), '最终生成完成必须包含Fork');
    assert.ok(completedHtml.includes('data-action="regenerate-msg"'), '最终生成完成必须包含重新生成');
    assert.ok(completedHtml.includes('time-tag'), '最终生成完成必须展示完成时间');
    assert.ok(completedHtml.includes('14:34:00'), '最终生成完成必须展示精确时间');

    // 3.2 群聊助手行：禁止 Fork/重新生成，但强显 Agent 昵称
    const html = renderMessage({
      id: 'msg-a1',
      role: 'assistant',
      content: '这是专家的建议方案',
      sender: '架构师王工',
      model: 'claude-3-7-sonnet',
      timestamp: '14:35:10',
      durationMs: 2500,
      tokenMetrics: {
        total: 1420,
        input: 600,
        output: 820,
        tps: 68.5,
        cacheHitPct: 82,
        cacheRead: 492,
      },
      isGroupRoom: true,
    });

    // 群聊身份强显
    assert.ok(html.includes('架构师王工'), '群聊必须强显出话 Agent 昵称');
    assert.ok(html.includes('claude-3-7-sonnet'), '必须展示模型名');
    assert.ok(html.includes('2.5s'), '必须展示生成耗时');

    // 阶梯式 Token 性能仪表
    assert.ok(html.includes('1,420 tokens'), '第一层常驻药丸必须展示格式化总 Token 数');
    assert.ok(html.includes('68.5 tps'), '第二层 Popover 必须包含实时 TPS');
    assert.ok(html.includes('600 / 820'), '第二层 Popover 必须包含输入/输出 Token');
    assert.ok(html.includes('82%'), '第二层 Popover 必须包含缓存命中率');
  });

  await t.test('4. 上下文水位监控计 (renderContextGauge)：色阶梯度与极限边界', () => {
    // 正常状态 (<70%) => 暗银灰
    const normalHtml = renderContextGauge({ used: 42000, max: 128000, percent: 33 });
    assert.ok(normalHtml.includes('42k / 128k'), '格式化展示 Token 上下文');
    assert.ok(normalHtml.includes('(33%)'), '显示百分比');
    assert.ok(normalHtml.includes('var(--text-muted)'), '<70% 使用暗银灰');

    // 预警状态 (70%-90%) => 琥珀暖金
    const warningHtml = renderContextGauge({ used: 100000, max: 128000, percent: 78 });
    assert.ok(warningHtml.includes('var(--accent'), '70%-90% 使用琥珀暖金预警');

    // 警戒高危 (>90%) => 高对比度卡片背景高亮
    const dangerHtml = renderContextGauge({ used: 120000, max: 128000, percent: 94 });
    assert.ok(dangerHtml.includes('var(--bg-card-active)'), '>90% 使用高亮背景');

    // 边界值：空或无效值不渲染任何 HTML
    assert.equal(renderContextGauge(undefined), '');
    assert.equal(renderContextGauge({ used: 0, max: 0, percent: 0 }), '');
  });
});
