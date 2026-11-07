/**
 * 确定性合成会话生成器（长期共享）
 *
 * 设计意图 (Why)：
 *   性能门禁有两个口径——Node 侧 SSR 字符串生成、浏览器侧真实挂载。
 *   两者必须跑同一份数据，否则「SSR 达标但用户仍卡」这类偏差无法被发现。
 *   数据生成器抽成纯函数模块，Node 与浏览器 bundle 都能直接 import。
 *
 * 防范的历史坑 (Pitfall)：
 *   生成器原先寄生在 perf-benchmark.mjs 顶层，该文件同时包含 node:module / react 动态加载，
 *   浏览器打包时会把整条 Node 依赖链拽进去而失败。
 *
 * 约束与规则 (Rules)：
 *   1. 本文件禁止引入任何 node: 前缀模块或副作用；
 *   2. 固定种子式构造，每次运行输出完全一致；
 *   3. 分布覆盖真实工业场景：短文本 / 复杂 Markdown / 代码块 / 思考链 / 工具链。
 *
 * 生成 5000 条真实分布消息：
 * - 40% 普通交互短文本
 * - 25% 复杂 Markdown（列表、粗体、GFM 表格、块引用）
 * - 15% 多语言代码块（Python、TS、Shell）
 * - 10% 深度折叠思考链（Thought Chain，数百字推理过程）
 * - 10% 工具调用链（Shell 命令、读写文件、多工具聚合）
 */
export function generateSynthetic5000Messages() {
  const messages = [];
  const roles = ['user', 'assistant'];

  for (let i = 1; i <= 5000; i++) {
    const role = roles[i % 2];
    const category = i % 10;
    let content = '';
    let thought = '';
    let toolCalls = undefined;

    if (category < 4) {
      // 40% 普通对话
      content = `这是第 ${i} 轮交互指令：请核对网关长连接握手状态并给出诊断报告。`;
    } else if (category < 6.5) {
      // 25% 复杂 Markdown 与表格
      content = `### 节点 ${i} 巡检报告\n\n| 指标 | 读数 | 状态 |\n|---|---|---|\n| RTT | ${10 + (i % 20)}ms | 正常 |\n| QPS | ${100 + i} | 高峰 |\n\n- [x] 链路心跳正常\n- [ ] 存量日志未刷盘\n\n> 核心断言：长会话渲染必须遵守窗口化约束。`;
    } else if (category < 8) {
      // 15% 代码块
      content = `优化后的聚合函数如下：\n\`\`\`ts\nexport function aggregateBatch${i}(items: number[]): number {\n  // 高性能紧凑循环，避免中间数组分配\n  let sum = 0;\n  for (let k = 0; k < items.length; k++) sum += items[k];\n  return sum;\n}\n\`\`\``;
    } else if (category === 8) {
      // 10% 深度思考链
      thought = `正在对第 ${i} 步推理链路进行拓扑展开：首先验证边界不变量，排除空指针与竞态条件；接着检查 DOM 节点预算；确认安全后推入输出管道。耗时预估 120ms。`;
      content = `已完成深度推理，方案已收敛至最优路径。`;
    } else {
      // 10% 工具调用
      toolCalls = [
        {
          id: `tc-${i}-1`,
          name: 'shell',
          status: 'completed',
          args: JSON.stringify({ command: `git log --oneline -n ${i % 5}` }),
          output: `commit a${i} feat: performance hardening`,
        },
        {
          id: `tc-${i}-2`,
          name: 'read_file',
          status: 'completed',
          args: JSON.stringify({ path: `packages/core/src/file_${i}.ts` }),
          output: `export const version = ${i};`,
        },
      ];
      content = `已执行 2 项前置工具查询并提取有效事实。`;
    }

    messages.push({
      id: `msg-${i}`,
      role,
      content,
      thought: thought || undefined,
      thoughtDurationMs: thought ? 180 : undefined,
      timestamp: `14:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
      toolCalls,
    });
  }

  return messages;
}
