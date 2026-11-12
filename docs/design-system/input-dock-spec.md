# 输入舱与模型选择器规范 (Input Dock Spec)

> 适用版本：Canonical Gateway 契约（261 方法 / 74 事件）。
> 实现位置：`packages/ui/src/components/InputDock/InputDock.ts`、`packages/ui/src/styles/conversation.css`、`packages/desktop/src/renderer/index.ts`。
> 本规范是输入舱几何、状态机与配色语义的单一真值。改动任一条目必须先改本文件。

---

## 一、目标与边界

输入舱承担三件事：写草稿、选模型与思考等级、发出或中止回合。除此之外不放任何常驻控件。

明确不做：

1. 底栏不放 `/` 与 `@` 按钮。两者通过占位文案提示，输入时自然触发补全。
2. 不放「已达上限 220px」文案，也不放「收起」按钮。触顶后只转内部滚动。
3. 不引入 `busy_input_mode` 三态开关。主按钮由回合相位直接决定。

---

## 二、几何

| 项 | 值 | 说明 |
|---|---|---|
| 外壳限宽 | `740px` | `--geo-input-dock`，居中 |
| 外壳圆角 | `var(--radius-window)` = 12px | 与对话区代码块同源 |
| 外壳描边 | `1px solid var(--border)` | 唯一一条语义发丝线 |
| 外壳投影 | `none` | 输入面靠内陷层次，不靠阴影浮起 |
| 输入区高度 | `44px → 220px` | 单行 22px 行高 + 上下内距 11px |
| 命中区 | `28px` | 发送 / 停止 / 附件 / 审批共用 |
| 控件圆角 | `6px` | 图标按钮与模型触发控件一致 |
| 按钮列宽 | `28px` | 运行态为两枚上下排列，列高 58px |
| 附件缩略图 | `56×56`，文档胶囊 `38px` 高 | 位于输入舱外壳**外部上方** |

### 输入区自动增高契约

```
height = min(max(scrollHeight, 44), 220)
```

1. 每次测量前先把 `height` 归 `auto`，否则回删时 `scrollHeight` 不会变小，高度会卡在 220px。
2. IME 组合期间跳过重算，`compositionend` 后再补一次。
3. 高度不做 CSS 过渡。高频输入下高度动画会把排版抖动放大成跳行。
4. 触顶后由 `overflow-y: auto` 承担滚动，滚动条 6px，仅触顶时出现。
5. 整舱最大高度 = `220 + 64（按钮列 footer）+ 8` = `292px`。宿主用它计算对话区底部让位。

---

## 三、状态机

### 3.1 主按钮

```ts
type ComposerPhase = 'idle' | 'running';
type ComposerPrimaryAction = 'send' | 'stop';

resolveComposerPrimaryAction(phase) // idle -> send, running -> stop
```

| 相位 | 视觉 | 行为 |
|---|---|---|
| `idle` + 有草稿 | 发送图标 | `prompt.submit` 路径（`routeSend`） |
| `idle` + 空 | 发送图标降 `--faint`，`disabled` | 不可点 |
| `running` | 红色实心方块 | `session.interrupt`（`interruptTurn`） |

运行中有草稿时，发送图标会作为「加入待发送队列」入口叠在停止上方。该状态依赖网关 `pending_rows` 同步，见第六节。

### 3.2 审批三态

网关唯一真值：`manual` / `smart` / `off`。

| 值 | 图标 | 文案 | 后果 |
|---|---|---|---|
| `manual` | 锁 | 手动 | 每次写入与命令都先询问 |
| `smart` | 盾 + 勾 | 智能 | 低风险自动放行，高风险再询问 |
| `off` | 双箭头 | 免审批 | 全部自动放行（YOLO） |

历史别名只在入参处归一，不再进入渲染层：`sandbox → manual`、`auto → off`、`ask → smart`、未知值 `→ smart`。

### 3.3 思考等级

固定五档：`默认 / 关 / 低 / 高 / 最高`。别名 `off → 关`、`medium → 高`。

级联只在模型行 hover 或聚焦时单实例渲染，定位在行右侧。右侧空间不足时向左翻转，两侧都不足时内缩到面板右缘。

### 3.4 队列行动作

| 动作 | 数据属性 | 语义 |
|---|---|---|
| 放回编辑 | `data-action="queue-replace"` | `prompt.replace_queued` |
| 立即发送 | `data-action="queue-steer"` | `prompt.steer_queued` |
| 取消 | `data-action="queue-cancel"` | `prompt.cancel` |

顺序固定为「放回编辑 / 立即发送 / 取消」，从轻到重。不提供上下移动，也不提供整队打断。

---

## 四、配色与表面阶梯

输入舱只消费语义 Token，禁止裸写色值。

| 位置 | 深色 `obsidian-gold` | 浅色 `ayu-light` |
|---|---|---|
| 对话舞台 `--panel` | `#16171D` | `#EDEDEC` |
| 输入舱 `--input` | `#131419` | `#FFFFFF` |
| 队列托盘 `--card` | `#1B1C23` | `#FAF9F8` |
| 发丝线 `--border` | `rgba(255,255,255,.12)` | `#D8D8D6` |
| 细线 `--border-subtle` | `rgba(255,255,255,.07)` | `#E4E4E2` |
| 悬浮 `--card-hover` | `#22242D` | `#EFEFEF` |
| 主前景 `--foreground` | `#F3F4F6` | `#24292F` |
| 次级前景 | `#9CA3AF` | `#4A535C` |
| 辅助前景 | `#7C8291` | `#5C6670` |
| 停止 `--destructive` | `#EF4444` | `#E6656A` |

两条硬约束：

1. 输入舱任何状态都不使用皮肤主色做边框或外环。ayu-light 的 `#4AA8C8` 只允许出现在其他强调位。
2. 聚焦不描边、不叠环。焦点由光标与正文承担。

---

## 五、组件契约

### 5.1 模型触发控件

结构：厂商图标 + 完整可读名 + `/` + 思考等级 + 箭头。

1. 名称一律走 `resolveDockModelLabel`：目录命中用目录 `displayName`，未命中用 core 派生，绝不显示裸 ID。
2. 图标一律走 `renderModelVendorIcon`，与设置页 `ModelVendorIcon` 共用 `describeModelVendorIcon` 的品牌判定，判不出时降级首字母 badge。
3. 无方框、无描边、无角标。

### 5.2 发送 / 停止图标

1. 发送是右向播放头三角加左缘短横线的轮廓图标，16px，`stroke-width: 1.7`。
2. 停止是 10px 红色实心方块，圆角 2.5px，`2.4s` 透明度呼吸 `1 → 0.62`；`prefers-reduced-motion` 下静止。
3. 两者共用 28px 命中区与 6px 圆角，无边框、无底色。hover 只加一层 6% 悬浮底。

### 5.3 浮层

`/` 与 `@` 浮层共用行高 30px、左右内距 12px、底部键盘提示。

1. 命令名与文件名使用主前景色（深色白字、浅色黑字），路径与描述退到 `--muted-foreground`。
2. 字体走 `--font-sans`，不使用等宽。
3. 回车提示使用矢量 return 图标，不用字符符号。

### 5.4 附件轨

1. 图片渲染 56×56 缩略图，删除按钮 16px 固定在右上角。
2. 文档退化为同名胶囊，避免在缩略图里塞文字盲盒。
3. 整条轨道位于输入舱外壳之前，不参与正文排版。
4. 容器保留 `composer-attachment-pill` 类，宿主用它判断「当前是否有附件」。

---

## 六、未落地与后续

1. **运行中入队的服务端同步。** 客户端已具备完整链路：运行中有草稿时发送图标作为「加入待发送队列」入口（`prompt.submit` 的 `queued: true`），成功后按 `admission_id` 追加展示行；三动作分别走 `prompt.cancel` / `prompt.steer_queued`，均封装在 core `InteractiveService`。**尚未落地**的是网关 `pending_rows` 快照的订阅：目前队列只有本端刚提交的条目，刷新或换端后不会从服务端恢复，跨端取消也不会同步。补齐点：握手帧 `session_authority` 建立后订阅 `pending` 快照并写入 `state.queuedMessages`。
2. **设置页模型选择器。** `ModelOptionRow` 已复用同一套名称与图标解析，视觉不在本规范范围。
3. **移动端。** 28px 命中区在触屏断点下由 `styles.css` 抬到 44px，属于既有约定，本规范不改。

---

## 七、验证

`packages/ui/__tests__/composer-dock.test.mjs` 覆盖：

1. 外壳使用 `--input`、1px 发丝边、12px 圆角、零投影、740px 限宽。
2. 聚焦态不描边、不叠环。
3. 发送 / 停止共用 28px 命中区，无边框无底色；禁用只降 `--faint`。
4. 输入区 `min-height: 44px`、`max-height: 220px`、无高度过渡。
5. 附件轨位于外壳之前，收起按钮已移除。
6. 模型触发控件包含名称、分隔符与思考等级。
7. 空闲只渲染发送，运行只渲染停止，停止按钮不含可见中文。
8. 审批三态渲染完整，且只有一个当前项。
9. 纯函数：主按钮相位、审批别名归一、思考等级五档文案。
