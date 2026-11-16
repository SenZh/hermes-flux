/**
 * 虚拟滚动与滑窗状态机变异测试杀伤力验证脚本 (Mutation Testing Verifier)
 * 验证对本次改动的 4 个核心逻辑点注入变异体时，对应测试能否 100% 敏锐捕获（Killed）
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();

const TARGETS = [
  {
    name: 'M1: 破坏 planMessageWindow 尾部自愈 (还原为未自愈旧逻辑)',
    file: 'packages/desktop/src/renderer/messageWindow.ts',
    original: 'if (input.followBottom && (!input.userExpanded || input.start >= tail)) {',
    mutant: 'if (input.followBottom && !input.userExpanded) {',
    testCmd: 'node --test packages/desktop/__tests__/unit/agent-switch-window.test.mjs',
  },
  {
    name: 'M2: 破坏向下滑窗物理底沿判定 (误回退为全量 scrollHeight 判定)',
    file: 'packages/desktop/src/renderer/events/conversationStreamController.ts',
    original: 'const isNearWindowBottomEdge = distanceToWindowEnd < viewportPrefetch\n          && distanceToWindowEnd >= -streamEl.clientHeight * 0.5;',
    mutant: 'const isNearWindowBottomEdge = (streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight) < viewportPrefetch;',
    testCmd: 'node --test packages/desktop/__tests__/unit/conversationStreamController.test.mjs',
  },
  {
    name: 'M3: 破坏直接拖拽滚动条寻址解耦 (误恢复非法阻断踢回底部)',
    file: 'packages/desktop/src/renderer/events/conversationStreamController.ts',
    original: 'const targetIndex = Math.floor(streamEl.scrollTop / Math.max(1, avgRowHeight));\n            if (relocateMessageWindowToIndex(targetIndex)) {',
    mutant: 'if (!getReaderScrolledSessionId()) { scrollStreamToBottom("blocked"); return; }\n            const targetIndex = Math.floor(streamEl.scrollTop / Math.max(1, avgRowHeight));\n            if (relocateMessageWindowToIndex(targetIndex)) {',
    testCmd: 'node --test packages/desktop/__tests__/unit/conversationStreamController.test.mjs',
  },
  {
    name: 'M4: 破坏发送新 Prompt 时的扩展状态主动重置',
    file: 'packages/desktop/src/renderer/services/turnExecutionService.ts',
    original: 'deps.setMessageWindowUserExpanded?.(false);\n    deps.ensureMessageWindow?.(state.messages.length);',
    mutant: '// mutant: omitted reset\n    // deps.setMessageWindowUserExpanded?.(false);',
    testCmd: 'node --test packages/desktop/__tests__/unit/turnExecutionService.test.mjs',
  },
];

console.log('[Mutation Test] 开始执行变异体杀伤力校验...\n');

let allKilled = true;

for (let i = 0; i < TARGETS.length; i++) {
  const target = TARGETS[i];
  const filePath = path.join(ROOT, target.file);
  const rawContent = fs.readFileSync(filePath, 'utf8');
  const content = rawContent.replace(/\r\n/g, '\n');
  const targetOriginal = target.original.replace(/\r\n/g, '\n');

  if (!content.includes(targetOriginal)) {
    console.error(`❌ [${target.name}] 未找到原代码锚点，无法变异！`);
    allKilled = false;
    continue;
  }

  // 1. 注入变异
  const mutatedContent = content.replace(targetOriginal, target.mutant.replace(/\r\n/g, '\n'));
  fs.writeFileSync(filePath, mutatedContent, 'utf8');

  try {
    // 重新编译
    execSync('npm run build:desktop', { cwd: ROOT, stdio: 'pipe' });
    // 运行测试：预期测试应当失败 (Exit != 0)
    let killed = false;
    try {
      execSync(target.testCmd, { cwd: ROOT, stdio: 'pipe' });
    } catch {
      killed = true; // 测试失败 = 变异体被成功击杀
    }

    if (killed) {
      console.log(`✔ [KILLED] ${target.name} -> 测试成功红灯拦截，证实断言真实有效！`);
    } else {
      console.error(`❌ [SURVIVED] ${target.name} -> 变异后测试居然通过，测试为假测试！`);
      allKilled = false;
    }
  } finally {
    // 恢复源码
    fs.writeFileSync(filePath, rawContent, 'utf8');
    execSync('npm run build:desktop', { cwd: ROOT, stdio: 'pipe' });
  }
}

if (allKilled) {
  console.log('\n🎉 所有 4 个核心变异体全部被 100% 击杀 (Mutation Score: 100%)，测试具备极高实证杀伤力！');
  process.exit(0);
} else {
  console.error('\n❌ 存在逃逸变异体，测试杀伤力不达标！');
  process.exit(1);
}
