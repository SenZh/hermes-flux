# requirements — 前端设计系统 + shadcn/ui 迁移 + 双壳拓扑

日期：2026-11-03　状态：Phase 1 进行中　关联：docs/changes/2026-11-03_design-system-shadcn-migration/

## 用户原始需求（会话全文摘录）

1. "我们当前应该是使用一套很流行的开源前端UI组件库吧" → 经取证纠正：未使用，React/Radix 为脚手架残留。
2. "用 shadcn/ui 组件可以吗，能带来什么好处？" → 已答复，用户回复"没问题"确认迁移方向。
3. "我对当前的前端不满意，丑，配色、按钮、效果都不太好。"
4. "desktop 和 mobile 用不同的前端壳，底层查询操作数据的逻辑是共用、抽象的。"
5. "我们现在做皮肤，整个UI套件，要没有做成设计系统……不需要太多颜色，定义好设计系统和皮肤系统。默认色、默认字体（字体、大小、颜色等），比如左边栏背景色、字体、大标题样式、小标题样式、对话框样式等等，这样改皮肤或新建皮肤非常方便。后续有新组件就增加新组件的皮肤定义。你是否认同，这是不是最佳实践。"
6. "现在怎么做？开始架构设计？" → 本变更单。

## 实现目标（可量化、可证伪）

| # | 目标 | 完成判据 |
|---|---|---|
| G1 | 设计系统落地：语义 Token 分两层（节奏层全局恒定 + 皮肤层值表）。皮肤槽位 ≤32 个，每皮肤一张值表 | TS `SkinDefinition` 全必填编译判据成立；新皮肤 = 1 个文件 ≈30 值；门禁可证 |
| G2 | 换肤成本：新增/修改皮肤不触碰任何组件文件；新增组件默认零皮肤改动，仅消费既有槽位 | 门禁探针 + 一条 fast-check/单测断言"每个皮肤实现全部槽位" |
| G3 | shadcn/ui 技术栈接通：React 19 + Tailwind v4 + cva 在现有 esbuild 管线构建成功 | ✅ 已由 PoC 证（poc-chain：esbuild.exe bundle 250.7KB/168ms、tailwind CLI 10.7KB/43ms、tsc strict 0 错、.bg-primary utility 与 data-theme 换肤进产物） |
| G4 | 双壳拓扑：desktop 与 mobile 各自独立壳；core 为数据查询/操作唯一底座，REST 经 PAL（httpProxy 契约 :68-76 已存在，restFallbackHandler 注入点 client.ts:129 已存在） | mobile 构建不再 cpSync desktop 产物；renderer 内 0 裸 fetch、0 业务编排（deleteSession/ensureLiveSessionId 等下沉），gates 探针覆盖 |
| G5 | 并发债随迁移清偿：R-01/R-02/R-08 等 P0（docs 外部产物 arena-concurrency/synthesized.md）在对应组件迁移波内修复并附形式化定理增量 | npm run verify:formal 含 FSM/合流/代际守卫新定理；AGENTS.md 判定树合规 |
| G6 | 视觉基线：原子控件（Button/Input/Dialog/Menu/Badge）统一形态；字号收敛 8 档整数阶梯，消灭 9.5px/10.5px 半像素散值；硬编码色基线只减不增至 0 | 门禁数字 + CDP 截图基线（verify-hermes-flux） |

## 非目标（本期不做）

- packages/web 独立壳新建（只订正文档漂移，除非用户改变范围决策）。
- Python 网关侧改动。
- 布局结构重设计（三舱几何维持 ultimate-tri-rail 规范，仅表现层换肤与组件基座迁移）。
