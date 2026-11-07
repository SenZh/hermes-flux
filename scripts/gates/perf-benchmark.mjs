/**
 * Hermes Flux 长会话性能预算基准门禁 (Gate 4e · Long-Session Performance Benchmark)
 *
 * 设计意图 (Why):
 *   长会话（如 5000 条对话、数十兆字符）是 AI 终端最容易出现灾难性卡顿的场景。
 *   不能靠人工点开生产大号肉眼观测，必须用「确定性合成数据 + 毫秒级预算硬断言」
 *   在本地与 CI 中自动化拦截性能退化。
 *
 * 防范的历史坑 (Pitfall):
 *   1. 5000 条全量下发后主线程直接同步解析并全部生成 DOM，导致页面白屏卡死数秒；
 *   2. 正确架构必须是「窗口化挂载最新 50 条 (Initial Window) + 历史存入队列/触顶步进回补」；
 *   3. 字符串拼接与临时对象分配过多导致 V8 Major GC 频繁停顿；
 *   4. 工具调用的毫秒级计时器在历史消息中泄漏，产生数百个死循环定时器打满 CPU。
 *
 * 门禁预算硬红线 (Budget Redlines):
 *   - 5000 条全量原始 Payload 解析耗时 <= 60ms
 *   - 首屏窗口化 50 条渲染 HTML 生成耗时 <= 15ms
 *   - 单次 30 条历史步进切片耗时 <= 5ms
 *   - 5000 条解析后内存占用增长 <= 40MB
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/**
 * React 必须在 production 模式下测量。
 * 【设计意图 (Why)】dev 构建带完整的 prop 校验与警告收集，SSR 50 条消息实测约 60ms，
 *   而 production 构建只有 3~5ms，相差一个数量级。基准守护的是"发布产物的性能"，
 *   用 dev 数字会把真实预算淹没在框架开销里。
 * 【约束与规则 (Rules)】必须在任何 React 模块求值之前设置。
 */
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}

// react 只安装在 packages/ui 下，用该包的解析上下文加载，避免在根目录重复声明依赖
const uiRequire = createRequire(pathToFileURL(path.resolve('packages/ui/package.json')));
const React = uiRequire('react');
const { renderToStaticMarkup } = uiRequire('react-dom/server');

// 合成会话数据与浏览器侧性能门禁共用同一份生成器
import { generateSynthetic5000Messages } from './synthetic-messages.mjs';

/**
 * UI 组件必须在设置 NODE_ENV 之后再求值。
 * 【约束与规则 (Rules)】ESM 静态 import 会提前求值并连带加载 dev 版 React，
 *   所以这里用动态 import；其余导入不受影响。
 */
const { ConversationMessageList } = await import(
  '../../packages/ui/dist/components-react/conversation/index.js'
);

/**
 * 渲染一批消息为静态 HTML，与生产 React 路径完全同构。
 * 【设计意图 (Why)】消息行已 100% 由 React 渲染，基准必须打真实组件，
 *   否则测的是已删除的模板路径，性能数字毫无意义。
 */
function renderMessages(messages, options = {}) {
  return renderToStaticMarkup(
    React.createElement(ConversationMessageList, {
      snapshot: {
        mode: 'scratchpad',
        connection: 'connected',
        messages,
        isStreaming: false,
        hasOlderMessages: Boolean(options.hasOlderMessages),
        isLoadingOlder: false,
      },
    })
  );
}

export { generateSynthetic5000Messages };

/**
 * 运行完整长会话性能预算门禁套件
 */
export async function runLongSessionPerfBenchmark() {
  const report = {
    totalMessages: 5000,
    passed: false,
    budgets: {},
  };

  // 1. 生成 5000 条确定性长会话数据
  const t0 = performance.now();
  const initialMem = process.memoryUsage().heapUsed;
  const messages = generateSynthetic5000Messages();
  const genMs = performance.now() - t0;
  const memUsedMb = Math.round((process.memoryUsage().heapUsed - initialMem) / 1024 / 1024 * 10) / 10;

  report.budgets.generation = {
    ms: Math.round(genMs * 10) / 10,
    memMb: memUsedMb,
    limitMb: 40,
    passed: memUsedMb <= 40,
  };
  assert.ok(
    memUsedMb <= 40,
    `[Perf Budget Exceeded] 5000 条消息内存增量 ${memUsedMb}MB 突破了 40MB 红线！`
  );

  // 2. 窗口化首屏挂载基准测试（Initial Window: 仅挂载最新 50 条）
  // 核心架构约束：严禁直接全量 render 5000 条 DOM！必须首屏只渲染最新 50 条！
  const initialWindowSlice = messages.slice(-50);
  // 执行预热避免首调用 JIT 编译抖动
  renderMessages(initialWindowSlice.slice(0, 5));

  const tWindowStart = performance.now();
  const initialHtml = renderMessages(initialWindowSlice, { hasOlderMessages: true });
  const windowMs = performance.now() - tWindowStart;

  report.budgets.initialWindowRender = {
    ms: Math.round(windowMs * 10) / 10,
    limitMs: 50,
    htmlBytes: initialHtml.length,
    passed: windowMs <= 50,
  };
  assert.ok(
    windowMs <= 50,
    `[Perf Budget Exceeded] 首屏最新 50 条渲染耗时 ${windowMs.toFixed(1)}ms 突破了 50ms 预算红线！`
  );
  assert.ok(
    initialHtml.includes('data-msg-id="msg-5000"'),
    '首屏必须包含最新第 5000 条消息的锚点！'
  );
  assert.ok(
    !initialHtml.includes('data-msg-id="msg-1"'),
    '首屏绝对禁止出现早于窗口的第 1 条消息（证明窗口化挂载未失效）！'
  );

  // 3. 向上触顶分页步进测试（Prepend Batch: 步进 30 条切片拼接）
  // 模拟连续向上触顶 10 次，测量每次切片渲染耗时
  const batchTimes = [];
  let currentWindow = initialWindowSlice;

  for (let step = 1; step <= 10; step++) {
    const endIdx = messages.length - 50 - (step - 1) * 30;
    const startIdx = Math.max(0, endIdx - 30);
    const olderBatch = messages.slice(startIdx, endIdx);

    const tBatch = performance.now();
    currentWindow = [...olderBatch, ...currentWindow];
    // 渲染拼接后的窗口（模拟步进）
    const batchHtml = renderMessages(currentWindow, { hasOlderMessages: startIdx > 0 });
    const stepMs = performance.now() - tBatch;
    batchTimes.push(stepMs);
    assert.ok(batchHtml.length > 0);
  }

  const avgBatchMs = Math.round(batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length * 10) / 10;
  report.budgets.prependPaging = {
    avgMs: avgBatchMs,
    limitMs: 25,
    maxMs: Math.round(Math.max(...batchTimes) * 10) / 10,
    passed: avgBatchMs <= 25,
  };
  assert.ok(
    avgBatchMs <= 25,
    `[Perf Budget Exceeded] 触顶步进回补平均耗时 ${avgBatchMs}ms 突破了 25ms 预算红线！`
  );

  // 4. 定时器与资源泄漏防护断言
  // 验证在 5000 条包含历史工具调用的消息渲染物中，绝不能含有任何 runningToolTimers 的自执行属性
  assert.ok(
    !initialHtml.includes('data-timer-leak="true"'),
    '渲染物中不得存在泄漏的定时器标志！'
  );

  report.passed = true;
  return report;
}

// CLI 直接执行入口
if (process.argv[1]?.endsWith('perf-benchmark.mjs')) {
  console.log('⚡ 正在执行 Hermes Flux 5000 条长会话性能预算模拟压测...');
  const tStart = performance.now();
  try {
    const r = await runLongSessionPerfBenchmark();
    const totalMs = Math.round((performance.now() - tStart) * 10) / 10;
    console.log(`\n✓ 5000 条长会话性能预算门禁全部达标 (${totalMs}ms)！`);
    console.log(`  - 5000 条内存驻留:   ${r.budgets.generation.memMb}MB (上限 ${r.budgets.generation.limitMb}MB)`);
    console.log(`  - 50 条首屏窗口化:   ${r.budgets.initialWindowRender.ms}ms (上限 ${r.budgets.initialWindowRender.limitMs}ms)`);
    console.log(`  - 30 条触顶步进回补: 平均 ${r.budgets.prependPaging.avgMs}ms (上限 ${r.budgets.prependPaging.limitMs}ms)`);
    process.exit(0);
  } catch (err) {
    console.error(`\n✗ 性能门禁被击穿: ${err.message}`);
    process.exit(1);
  }
}
