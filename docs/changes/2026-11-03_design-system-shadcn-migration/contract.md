# contract — 产出契约

| 场景 | 完成标准（可证伪） | 验证方式 |
|---|---|---|
| 主路径·皮肤体系 | 新增皮肤=仅新建 1 个含全 `SLOT_IDS` 43 槽值对象（对账单测）；缺槽编译失败；改皮肤零组件文件变更；styles.css 手写 `[data-theme]` 纯声明块已由生成链替代并由守卫断言区外零残留（双审返工闭环）；:679-928 皮肤专属组件规则的逐条裁决**移交 PR-1b**（判据改线：本 PR 仅交付规则选择器清单与处置输入） | 单测 7 用例 + 现场演示：新造第 6 套皮肤走全流程（typecheck/gates/换肤断言） |
| 主路径·默认皮肤 | 冷启动与设置页默认 = obsidian-gold；`--font-sans` 实际生效族含 "Inter Variable"（computed style 断言） | CDP 读 computedStyle |
| 主路径·组件基座 | Button/Input/Dialog/Menu/Badge/Switch 六原子控件全走 cva variant，桌面与移动同一实现分 variant | grep 消费点 + CDP 物理交互 |
| 主路径·双壳 | `packages/mobile` 构建链 0 引用 `packages/desktop/dist`（prepare-assets.mjs cpSync 删除）；两端数据操作均触 core | grep + mobile 独立构建产物启动 CDP |
| 主路径·下沉 | desktop renderer/index.ts ≤1,500 行（**波③末验收**，波②单独不可验）；裸 `fetch(` 0 命中（:940/:955/:967 auth 三处经 S5b 归位 PAL）；"4023/4001"字符串判断 0 命中（按扫描器"去注释源码"口径，改 RpcErrorCode） | grep 行数断言（去注释口径） |
| 边界·换肤瞬间 | 流式回合中切皮肤：消息节点**引用同一性不变**（切肤只触 var 值，不重建元素）+ 丢帧计数 ≤1；探针有效性以故意 60px 扰动做正对照（纪律 §5-5） | CDP 节点引用断言 + 扰动正对照 lane |
| 边界·字体降级 | Inter 加载失败路径（file 缺失）→ CJK 系统栈渲染不破版 | CDP 阻断资源 lane |
| 边界·旧新共存 | 共存窗口期内未迁移舱功能全可用（模板域与 React 域互不覆写） | 每波 Regression lane |
| 相邻影响 | core 全部既有单测/formal 11 定理 + 新增定理全绿；gates 存量违规指纹只减不增；ui barrel 僵尸导出清零（7 个逐个附消费证据） | npm run verify + 基线 diff |
| 兼容性·i18n | lang 切换对 t() 生效（修复恒 zh-CN 缺陷）；en 皮肤下面板无溢出截断 | 单测 + CDP en lane |
| 相邻影响·退役时点 | themeRegistry 的 `BUILTIN_SKINS`/`generateSkinCssVariables`/`applySkinToDom`/`SkinDefinition` 于 **PR-1c 删除**（含 barrel 导出与消费测试迁移到 skins.ts）；PR-1a~1c 期间四表并存状态已在代码头注释声明，禁止新增对旧 registry 的 import | PR-1c diff 断言 0 引用 + typecheck |
