---
description: 委派样式门禁审查（换肤 / i18n / 渲染性能）
subagent: true
agent: flux-style-reviewer
---

对本次改动执行样式门禁审查，范围：$ARGUMENTS

若未指定范围，则审查当前工作区全部未提交改动。

执行步骤：

1. `node scripts/gates/run.mjs --changed --json`
2. `git diff HEAD`（如指定了范围则只读对应文件）

严格按下述五个维度逐条核验并给出结论：换肤完整性、i18n 零硬编码、渲染性能红线、
布局规范一致性、门禁误报甄别。

输出必须使用 `flux-style-reviewer` 规定的裁决格式，给出明确的 `PASS` / `FAIL`。
