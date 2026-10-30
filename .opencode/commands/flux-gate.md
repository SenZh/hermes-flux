---
description: 全量门禁自检（换肤 / i18n / 架构 / 性能 + 类型 + 单测）
agent: flux-build
---

执行 Hermes Flux 完整交付前门禁自检，逐项给出客观结果。

按顺序执行下列命令，**每一项都必须真实执行，不得跳过、不得推断结果**：

1. `node scripts/gates/run.mjs` — 静态门禁（新增违规必须为 0）
2. `npm run typecheck` — 全栈严格类型
3. `npm test` — 单元测试全绿

然后在回复中输出下表（用真实输出填充，失败项必须贴出关键报错原文）：

| 门禁 | 命令 | 结果 | 说明 |
|---|---|---|---|
| Gate 0/4 静态门禁 | `node scripts/gates/run.mjs` | | |
| Gate 1 严格类型 | `npm run typecheck` | | |
| Gate 2 单元测试 | `npm test` | | |

若任一项失败，**不要尝试自动修复**，直接列出：
- 失败项与根因判断；
- 修复所需的最小改动范围；
- 是否需要委派 `flux-gate-fixer`。

额外检查（不执行命令，但必须回答）：

- [ ] 本次改动是否触及样式面？如果是，是否已委派 `flux-style-reviewer`？
- [ ] 本次改动是否触及代码面？如果是，是否已委派 `flux-code-reviewer`？
- [ ] 是否修改了 `scripts/gates/.baseline.json`？（扩张 = 违规）
- [ ] 是否新增了 `gate-*-allow` 豁免注释？理由是否成立？
- [ ] 是否有截图/录屏/trace 被误加入暂存区？

$ARGUMENTS
