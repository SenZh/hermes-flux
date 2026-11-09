/**
 * 主进程窗口控制纯决策层：三向姿态裁定与标题栏图标语义。
 *
 * 断言口径：直接对纯函数做全姿态真值表断言，不启动 Electron。
 * 守护的不变量：
 *   1) 全屏优先级最高，任何"全屏 + 最大化"叠加都必须只退出全屏，不得触发 unmaximize；
 *   2) 三态决策必须覆盖且互斥，不存在"无所作为"的第四态；
 *   3) 标题栏"还原"图标在全屏与最大化两种姿态下都必须为真。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindowToggle, resolveTitlebarMaximized } from '../../src/main/windowControl.ts';

const POSES = [
  { isFullScreen: false, isMaximized: false, expected: 'maximize', label: '普通窗口' },
  { isFullScreen: false, isMaximized: true, expected: 'unmaximize', label: '最大化窗口' },
  { isFullScreen: true, isMaximized: false, expected: 'exit-full-screen', label: '全屏窗口' },
  { isFullScreen: true, isMaximized: true, expected: 'exit-full-screen', label: '全屏且最大化叠加' },
];

test('resolveWindowToggle 四象限真值表：全屏优先且三态互斥', async (t) => {
  for (const pose of POSES) {
    await t.test(`${pose.label} → ${pose.expected}`, () => {
      const decision = resolveWindowToggle({
        isFullScreen: pose.isFullScreen,
        isMaximized: pose.isMaximized,
      });
      assert.equal(decision, pose.expected);
    });
  }
});

test('resolveWindowToggle 变异杀伤力：全屏判定不可被最大化判定吞掉', () => {
  // 若实现被改成「先判 isMaximized」，该用例必红——这正是历史缺陷的形态。
  const overlapped = resolveWindowToggle({ isFullScreen: true, isMaximized: true });
  assert.equal(overlapped, 'exit-full-screen');
  assert.notEqual(overlapped, 'unmaximize');

  // 仅在最大化时不得退化为退出全屏。
  assert.equal(resolveWindowToggle({ isFullScreen: false, isMaximized: true }), 'unmaximize');
});

test('resolveTitlebarMaximized：全屏与最大化共享"还原"图标语义', async (t) => {
  const cases = [
    { pose: { isFullScreen: false, isMaximized: false }, expected: false, label: '普通窗口' },
    { pose: { isFullScreen: false, isMaximized: true }, expected: true, label: '最大化窗口' },
    { pose: { isFullScreen: true, isMaximized: false }, expected: true, label: '全屏窗口' },
    { pose: { isFullScreen: true, isMaximized: true }, expected: true, label: '全屏且最大化叠加' },
  ];
  for (const item of cases) {
    await t.test(`${item.label} → ${String(item.expected)}`, () => {
      assert.equal(resolveTitlebarMaximized(item.pose), item.expected);
    });
  }
});

test('resolveTitlebarMaximized 变异杀伤力：丢掉全屏项即被抓住', () => {
  // 若实现被简化回 "return state.isMaximized"，全屏分支必红。
  assert.equal(resolveTitlebarMaximized({ isFullScreen: true, isMaximized: false }), true);
});

test('退出全屏时序：从最大化态进全屏再退出必须继续呈现"还原"', () => {
  // 真实时序：最大化 → 进入全屏（isFullScreen=true）→ 退出全屏。
  // 退出瞬间 isFullScreen 已为 false，只剩 isMaximized=true，
  // 若快照被硬编码成 false，图标会退回"最大化"而窗口实际仍是最大化（镜像重现历史缺陷）。
  const afterLeaveFromMaximized = resolveTitlebarMaximized({ isFullScreen: false, isMaximized: true });
  assert.equal(afterLeaveFromMaximized, true, '最大化态退出全屏必须保持"还原"图标');

  const afterLeaveFromNormal = resolveTitlebarMaximized({ isFullScreen: false, isMaximized: false });
  assert.equal(afterLeaveFromNormal, false, '普通态退出全屏必须回到"最大化"图标');

  // 进入全屏本身无论此前是否最大化都必须是"还原"。
  assert.equal(resolveTitlebarMaximized({ isFullScreen: true, isMaximized: false }), true);
});
