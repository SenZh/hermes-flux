---
description: 委派代码门禁审查（架构 / 类型 / 状态 / 测试有效性）
subagent: true
agent: flux-code-reviewer
---

对本次改动执行代码门禁审查，范围：$ARGUMENTS

若未指定范围，则审查当前工作区全部未提交改动。

执行步骤：

1. `node scripts/gates/run.mjs --changed --json`
2. `git diff HEAD`
3. `npm run typecheck`（必须自己执行，不得采信转述）

必须完成**变异检验**：针对本次新增或修改的每个测试，回答「如果把生产代码改错，
这个测试会变红吗」。任何答案为「不会」的测试判定为假测试，直接 FAIL。

输出必须使用 `flux-code-reviewer` 规定的裁决格式，给出明确的 `PASS` / `FAIL`。
