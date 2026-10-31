import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderWorkerDelegationCard,
  renderSubagentTerminalView,
  THEME_OBSIDIAN_GOLD,
} from '../../dist/index.js';

// 从官方皮肤中提取所有合法的 CSS 变量名
const validCssTokens = new Set([
  '--bg-window',
  '--bg-rail',
  '--bg-panel',
  '--bg-card',
  '--bg-card-hover',
  '--bg-card-active',
  '--bg-elevated',
  '--bg-input',
  '--bg-code',
  '--bg-backdrop',
  '--accent',
  '--accent-hover',
  '--accent-dim',
  '--accent-glow',
  '--accent-subtle',
  '--accent-border',
  '--accent-text',
  '--text-main',
  '--text-secondary',
  '--text-muted',
  '--text-faint',
  '--border-subtle',
  '--border-medium',
  '--border-strong',
  '--specular-line',
  '--shadow-window',
  '--shadow-card',
  '--shadow-dock',
  '--jade-pulse',
  '--jade-glow',
]);

function assertAllVarsAreValid(html, componentName) {
  const varMatches = [...html.matchAll(/var\((--[a-zA-Z0-9-]+)[^)]*\)/g)];
  for (const match of varMatches) {
    const token = match[1];
    assert.ok(
      validCssTokens.has(token),
      `[${componentName}] 发现了未在主题系统注册的幽灵 CSS 变量: ${token}`
    );
  }
}

test('Subagent UI Components - WorkerDelegationCard & SubagentTerminalView', async (t) => {
  await t.test('1. WorkerDelegationCard：正常渲染任务卡片、状态绑定与 Token 真实性', () => {
    const cardHtml = renderWorkerDelegationCard({
      subagentId: 'sub-test-1',
      parentSessionId: 'sess-1',
      targetProfile: 'arch-wang',
      taskTitle: '推演并发死锁风险',
      status: 'running',
      progressPercent: 65,
      currentActionText: '正在执行死锁拓扑分析',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    assert.ok(cardHtml.includes('data-subagent-id="sub-test-1"'));
    assert.ok(cardHtml.includes('推演并发死锁风险'));
    assert.ok(cardHtml.includes('@arch-wang'));
    assert.ok(cardHtml.includes('65%'));
    assert.ok(cardHtml.includes('subagent-btn-interrupt'));
    assert.ok(cardHtml.includes('subagent-btn-inspect'));

    // 触控热区断言：按钮必须具有 min-height: 44px
    assert.ok(cardHtml.includes('min-height: 44px;'), '按钮触控热区必须满足 >= 44pt/48dp');

    // 零硬编码色相断言
    const coloredHexMatch = cardHtml.match(/#[0-9a-fA-F]{3,8}/g);
    assert.equal(coloredHexMatch, null, '卡片严禁包含硬编码十六进制色值');

    // Token 真实性检验：杜绝幽灵变量
    assertAllVarsAreValid(cardHtml, 'WorkerDelegationCard');
  });

  await t.test('2. WorkerDelegationCard：终态下隐藏中断按钮并展示对应状态指示', () => {
    const completedHtml = renderWorkerDelegationCard({
      subagentId: 'sub-done-1',
      parentSessionId: 'sess-1',
      targetProfile: 'fe-zhang',
      taskTitle: '优化首屏',
      status: 'completed',
      progressPercent: 100,
      currentActionText: '优化完毕',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    assert.ok(!completedHtml.includes('subagent-btn-interrupt'), '已完成状态下严禁渲染中断按钮');

    const failedHtml = renderWorkerDelegationCard({
      subagentId: 'sub-fail-1',
      parentSessionId: 'sess-1',
      targetProfile: 'fe-zhang',
      taskTitle: '构建失败',
      status: 'failed',
      progressPercent: 50,
      error: 'V8 Out of Memory',
      currentActionText: '异常终止',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    assert.ok(failedHtml.includes('V8 Out of Memory'));
    assertAllVarsAreValid(failedHtml, 'WorkerDelegationCard:failed');
  });

  await t.test('3. SubagentTerminalView：日志流渲染、移动端安全区与 Token 真实性', () => {
    const termHtml = renderSubagentTerminalView({
      task: {
        subagentId: 'sub-stream-42',
        parentSessionId: 'sess-1',
        targetProfile: 'arch-wang',
        taskTitle: '实时构建控制台',
        status: 'running',
        progressPercent: 80,
        currentActionText: '编译中',
        startedAt: Date.now(),
        updatedAt: Date.now(),
      },
      logs: [
        { seq: 1, timestamp: 100, kind: 'thought', text: '规划依赖顺序' },
        { seq: 2, timestamp: 200, kind: 'tool_call', text: 'exec("npm run build")' },
        { seq: 3, timestamp: 300, kind: 'tool_result', text: 'built in 420ms' },
        { seq: 4, timestamp: 400, kind: 'stdout', text: '0 errors, 0 warnings' },
        { seq: 5, timestamp: 500, kind: 'stderr', text: 'warning: chunk size large' },
      ],
      isMobileSheet: true,
    });

    assert.ok(termHtml.includes('[THOUGHT]'));
    assert.ok(termHtml.includes('规划依赖顺序'));
    assert.ok(termHtml.includes('[TOOL]'));
    assert.ok(termHtml.includes('[RESULT]'));
    assert.ok(termHtml.includes('[STDOUT]'));
    assert.ok(termHtml.includes('[STDERR]'));
    assert.ok(termHtml.includes('subagent-steer-input'));
    assert.ok(termHtml.includes('subagent-btn-steer'));
    assert.ok(termHtml.includes('subagent-btn-close-sheet'), '移动端 Sheet 模式必须渲染关闭按钮');

    // 移动端安全区断言
    assert.ok(termHtml.includes('env(safe-area-inset-bottom)'), '底部干预舱必须声明 safe-area-inset-bottom 避让 Home Bar');

    // 触控热区断言
    assert.ok(termHtml.includes('min-height: 44px;'), '输入框与干预按钮必须满足 >= 44pt/48dp');

    // 零硬编码色相
    const coloredHexMatch = termHtml.match(/#[0-9a-fA-F]{3,8}/g);
    assert.equal(coloredHexMatch, null, '终端视图严禁包含硬编码十六进制色值');

    // Token 真实性检验
    assertAllVarsAreValid(termHtml, 'SubagentTerminalView');
  });
});
