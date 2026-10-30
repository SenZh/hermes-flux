---
description: 委派代码极简专员（消除多层嵌套、冗余胶水与过度抽象，保真行为）
subagent: true
agent: flux-simplifier
---

对本次改动的代码执行极简主义去芜存菁，范围：$ARGUMENTS

若未指定范围，则针对当前工作区改动文件。

执行原则（深度吸收 OpenChamber simplifier 铁律）：
1. 消除过度包装的 helper 和假抽象；
2. 用 Early Return 消除深度缩进（严禁超 3 层）；
3. 展开晦涩的嵌套三元表达式；
4. 删除复述语法的废话注释，提炼阐明暗坑的高密度微距注释；
5. 100% 保持确定性可观测行为与测试断言不变！

重构完成后亲自运行 `npm run verify`，全绿后汇报简化点。
