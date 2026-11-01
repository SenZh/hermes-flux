# 中间核心交互区与输入舱设计质量审查清单 (Requirements Quality Checklist)

> **目标文档**：[`docs/architecture/interactive-conversation-stage-spec.md`](../architecture/interactive-conversation-stage-spec.md)  
> **属性**：Unit Tests for Requirements (检验设计规范的完备性、清晰度、一致性与可测性，非代码测试用例)  
> **审查者所有权**：方框 `[ ]` 仅由代码/产品审查者在核实规范满足度后手动勾选 `[x]`。  

---

## 1. 需求完备性 (Requirement Completeness)

- [ ] CHK001 - 是否针对单聊、Bot 专职工位与多 Agent 群聊三种截然不同的会话场景，分别明确定义了操作栏与输入能力边界？ [Completeness, Spec §3, §4]
- [ ] CHK002 - 是否针对用户消息和 AI 助手消息分别明确列出了所有可用操作按钮（复制/回滚/Fork/重新生成）？ [Completeness, Spec §3.2]
- [ ] CHK003 - 是否为 DeepSeek-R1、Claude 3.7 等大模型定义了深度思考链（Thought Chain）的折叠展示、耗时计时与呼吸微光规范？ [Completeness, Spec §3.2.2]
- [ ] CHK004 - 是否明确了工具调用在“执行中”与“执行完成”两阶段的全部展现形态及“读折叠/写展开”规则？ [Completeness, Spec §3.2.3]
- [ ] CHK005 - 针对待发送消息队列，是否完整定义了取消、调序、编辑、插队（打断当前）以及运行时轻量纠偏（Steering）的交互机制？ [Completeness, Spec §3.1, §4.3]
- [ ] CHK006 - 剪贴板输入是否完整覆盖了图片、本地文件和二进制数据三类资产的处理路径，并规定了拖拽（Drag & Drop）的悬停高亮状态？ [Completeness, Spec §3.3]

---

## 2. 需求清晰度与可度量性 (Requirement Clarity & Measurability)

- [ ] CHK007 - 悬浮输入舱的宽度是否明确限定在具体的像素数值（740px 黄金限宽，移动端 100% 满屏且左右 16px 安全边距）而非模糊的“自适应居中”？ [Clarity, Spec §1, §6]
- [ ] CHK008 - 剪贴板单张图片的大小上限是否量化为具体数值（10MB），长边下采样阈值是否具体量化（2048px）？ [Clarity, Measurability, Spec §3.3]
- [ ] CHK009 - 视口贴底判定的距离阈值是否明确量化为具体像素（$\le 48\text{px}$）以杜绝阅读历史时的视口抖动？ [Measurability, Spec §3.2.4]
- [ ] CHK010 - 顶部右上角上下文水位计的色相分级是否有明确量化的百分比阈值（<70% 银灰，70%~90% 琥珀金，>90% 警戒红）？ [Clarity, Measurability, Spec §3.1]
- [ ] CHK011 - 触控热区在移动端下是否给出了明确的物理尺寸下限（$\ge 44\text{pt} / 48\text{dp}$）？ [Clarity, Spec §6]

---

## 3. 需求一致性与分层约束 (Requirement Consistency & Invariants)

- [ ] CHK012 - 历史任意轮次的回滚截断重发（基于 `prompt.submit` + `confirm_truncate: true`）与单步撤销（`session.undo`）是否在概念与契约上彻底解耦且无歧义？ [Consistency, Clarity, Spec §4.1, §5]
- [ ] CHK013 - `@agent` 智能引用在 Bot 模式下的“彻底禁用”与群聊模式下的“局部成员唤醒”是否边界清晰且互不矛盾？ [Consistency, Spec §3.3.5]
- [ ] CHK014 - 待发送消息入队瞬间对 Provider、Model 和上下文的“不可变快照冻结”是否严格符合 `ENGINEERING_DISCIPLINE.md` 铁律？ [Consistency, Traceability, Spec §4.3]
- [ ] CHK015 - 排队附件生命周期是否明确规定为“客户端内存持有，仅出队发送前置帧挂载至网关，取消时即刻释放 Object URL”，彻底杜绝内存与会话暂存污染？ [Consistency, Lifecycle Guard, Spec §4.3]
- [ ] CHK016 - 图像 Canvas 降采样逻辑是否严格限定在 `packages/ui` 或平台适配层执行，确保 `packages/core` 保持无界纯逻辑且零 DOM 依赖？ [Consistency, Architecture Boundary, Spec §2, §3.3]

---

## 4. 移动端与平台特异避坑规约 (Platform Invariants & Keyboard Choreography)

- [ ] CHK017 - 规范是否强制约束了软键盘呼出时禁止在同一宏任务中同步切换 DOM 并调用 `focus()`，必须使用 `flushSync` + `rAF` 并在过渡期挂载 `.oc-kb-caret-hold`？ [Platform Invariant, Spec §6]
- [ ] CHK018 - 规范是否明确定义了在 iOS WebKit 发生高速惯性滑动时，必须使用 `setScrollTopDefeatingMomentum` 短暂切换 `overflow: hidden` 维持 20 帧锁定以杜绝贴底失效？ [Platform Invariant, Spec §6]
- [ ] CHK019 - 规范是否严格禁止了对 `.chat-scroll` 滚动容器应用 CSS `transform`，确保以固定 `clientHeight` + 动态内边距实现视口避让？ [Platform Invariant, Spec §6]

---

## 5. 契约真实性与异常边界 (Contract Verifiability & Resilience)

- [ ] CHK020 - `image.attach_bytes` 与 `file.attach` 的入参及出参字段，是否 100% 对齐 Generated Contract（入参 `content_base64`/`data`/`path`/`data_url`，出参 `AttachedImageResult`/`FileAttachResult`，零臆造字段）？ [Traceability, Contract Parity, Spec §5]
- [ ] CHK021 - Web 浏览器沙箱环境无法获取本地绝对路径时，是否明确定义了使用 `FileAttachParams.data_url` 作为合规降级路径？ [Traceability, Spec §5]
- [ ] CHK022 - 是否针对“在收到首个 Token 的微秒级瞬间触发 `session.interrupt` 并插队新提问”的高频并发竞态，定义了确定性的状态互斥与自愈机制？ [Edge Case, Concurrency, Spec §4.3]
- [ ] CHK023 - 规范是否定义了在网络半开或断网期间，本地消息队列的安全暂存与网络恢复后自动出队的容灾不变量？ [Edge Case, Resilience, Spec §4.3, §7]
