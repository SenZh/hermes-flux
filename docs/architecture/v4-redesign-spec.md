# Hermes Aura 全面重构技术方案与架构规范 (v4.0 旗舰美学与全链路闭环)

## 一、用户意图与现状事实清单 (Facts & Intent)

### 1.1 现状与三大致命缺陷
1. **缺陷一：会话历史记录加载不出**
   - **事实机理**：`packages/desktop/src/renderer/index.ts` 内部使用私有手写的 WebSocket RPC，仅调用了单一 `session.list`，未做任何通道降级；当网关返回结构体为 `sessions: [...]` 或 `data: [...]` 时缺乏弹性兼容；且在认证票据过期或 profile 未对齐时无备用通道，导致列表一直显示为空。
   - **技术重构**：下沉到 `packages/core`，统一由 `HermesGatewayClient` 驱动，增加双通道容错机制（WebSocket RPC 优先 + REST 专线 `/api/sessions` 兜底），支持 profile 智能感知与健壮解析。
2. **缺陷二：无法加载出正确的模型**
   - **事实机理**：`model.options` 结构体解析存在盲区，网关历史版本及不同 provider 分布在 `res.providers[].models[]`、`res.models[]` 或根层 `res.model`；客户端未进行递归扁平化与排重提取，导致选择器只能依赖本地静态假 fallback，无法感知网关真实生效的模型。
   - **技术重构**：在 `packages/core` 中实现高容错 `ModelExtractor`，递归提取所有 provider 下的模型 ID、别名及默认模型，并由 `packages/ui` 的 `InputDock` 呈现动态分类与高亮选中。
3. **缺陷三：交互与 UI 视觉粗糙烂透**
   - **事实机理**：
     - 当前代码充满手写行内 `style="..."`，未能实现 `docs/design-system/` 定义的 1px 天光切线、多层环境漫反射阴影（`0 24px 70px -12px`）与超椭圆连续曲率；
     - 消息流缺乏轻量级安全的 Markdown 渲染和代码块高亮，长消息阅读体验极差；
     - 流式推理输出时缺少 `TokenCoalescer` 的物理帧对齐，全量 innerHTML 重刷导致滚动条抖动、光标跳动与性能劣化；
     - 输入舱缺少打字聚焦光晕与呼吸反馈，中英文输入法（IME Composition）按 Enter 存在误触发风险；
     - 侧栏与检查舱的展开折叠缺乏弹簧物理动效（`cubic-bezier(0.16, 1, 0.3, 1)`）。

---

## 二、架构分层与改动点清单 (Monorepo Architectural Layout)

严守 Monorepo 铁律：协议下沉至 `packages/core`，纯 UI 表现沉淀至 `packages/ui`，`packages/desktop` 仅负责轻量级外壳与 IPC 宿主桥接。彻底消灭 desktop renderer 中的私有 WS 胶水代码！

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        packages/desktop                                │
│  - main/ipc.ts: 提供底层跨域 HTTP 代理与网络诊断 IPC 管道               │
│  - preload/index.ts: 暴露安全的 hermesDesktop.fetchHttpProxy 桥接      │
│  - renderer/index.ts: 纯上层装配，彻底使用 @hermes-aura/core 统一客户端  │
│  - renderer/styles.css: 注入电影级黑曜琥珀 / 羊脂白玉双主题系统        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 调用
┌───────────────────────────────────▼────────────────────────────────────┐
│                        packages/ui (纯 UI 表现层)                       │
│  - components/Titlebar: 42px 纯净顶栏，Mac/Win 双端原生质感            │
│  - components/LeftRail: 260px 侧栏，+新建会话横向满格，历史分组与删除   │
│  - components/MiddlePod: 100% 通栏对话流，安全 Markdown 渲染与思维链   │
│  - components/InputDock: 740px 黄金限宽输入舱，模型选择器，聚焦呼吸灯  │
│  - components/InspectionPod: OpenChamber 62px 竖向场景轨 + 348px 详情  │
│  - components/StatusBar: 22px 极致精简微条，翡翠微光点与延迟读数       │
│  - components/SettingsModal: 网关配置、外观、多语言与网络诊断抽屉      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 依赖
┌───────────────────────────────────▼────────────────────────────────────┐
│                        packages/core (无界业务层)                      │
│  - rpc/client.ts: 增强 HermesGatewayClient，实现 WS RPC + REST 双通道  │
│  - rpc/types.ts: 严谨定义 SessionList、ModelOptions 等全量数据结构     │
│  - models/types.ts: 扩展统一模型视图契约与归一化解析器                 │
│  - coalesce/tokenCoalescer.ts: 流式合流调度器，保障 120 FPS 物理上屏   │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 全量受影响文件清单
| 模块/包 | 文件路径 | 改动类型 | 变更职责说明 |
|---|---|---|---|
| `packages/core` | `src/rpc/types.ts` | 增强 | 增加 `SessionListResult`、`ModelOptionsResult` 结构定义 |
| `packages/core` | `src/rpc/client.ts` | 增强 | 下沉会话拉取、模型解析与 REST 双通道容灾逻辑 |
| `packages/core` | `src/models/types.ts` | 增强 | 定义统一模型元数据结构与解析工具函数 |
| `packages/core` | `src/coalesce/tokenCoalescer.ts` | 增强 | 确保 RAF / 微批合流支持局部节点更新 |
| `packages/ui` | `src/tokens/tokens.ts` | 增强 | 完善黑曜琥珀与羊脂白玉双色 Tokens 及尺寸常数 |
| `packages/ui` | `src/components/Titlebar/Titlebar.ts` | 重构 | 42px 纯净顶栏，Mac 三色灯与 Win 标题栏无缝自适应 |
| `packages/ui` | `src/components/LeftRail/LeftRail.ts` | 重构 | 260px 侧栏，新建会话横向满格，历史分组，无内联关闭 |
| `packages/ui` | `src/components/MiddlePod/MiddlePod.ts` | 重构 | 100% 通栏流式对话，安全 Markdown，DOM 局部增量锚点 |
| `packages/ui` | `src/components/InputDock/InputDock.ts` | 重构 | 740px 黄金限宽输入舱，呼吸光圈，IME Composition 防误触 |
| `packages/ui` | `src/components/InspectionPod/InspectionPod.ts` | 重构 | OpenChamber 62px 竖向场景轨贴靠极右窗边，4大场景联动 |
| `packages/ui` | `src/components/StatusBar/StatusBar.ts` | 重构 | 22px 极简一体化微条，无调试噪点，仅保留微光点与延迟 |
| `packages/ui` | `src/components/SettingsModal/SettingsModal.ts` | 重构 | 高级抽屉设计，支持通道切换、连通性探测与主题瞬切 |
| `packages/desktop` | `src/main/ipc.ts` | 增强 | 增加安全 HTTP 代理与网络诊断 IPC 管道 |
| `packages/desktop` | `src/preload/index.ts` | 增强 | 暴露 `httpProxy` 跨端 PAL 接口 |
| `packages/desktop` | `src/renderer/styles.css` | 重构 | 全局注入设计规范 CSS 类、超椭圆圆角、天光高光与弹簧曲线 |
| `packages/desktop` | `src/renderer/index.ts` | 重写 | 废除私有 WS 轮子，全面引入 `core` 与 `ui`，支持局部增量渲染 |

---

## 三、时序与数据流设计 (Interaction & Flow)

### 3.1 会话历史双通道加载与降级时序
```text
Renderer           HermesGatewayClient          WS Connection           REST Proxy (IPC)
   │                       │                          │                        │
   ├── fetchSessions() ───►│                          │                        │
   │                       ├── WS 状态检查 (OPEN?) ───►                        │
   │                       │   [分支 A: WS 正常]       │                        │
   │                       ├── send 'session.list' ──►│                        │
   │                       │◄── RPC Result / Error ───┤                        │
   │                       │   [分支 B: WS 失败/超时]  │                        │
   │                       ├── Fallback REST ─────────────────────────────────►│
   │                       │◄── HTTP 200 /api/sessions ────────────────────────┤
   │                       ├── 健壮归一化解析 (normalizeSessions)              │
   │◄── LeftRailSession[] ─┤                                                   │
   │                       │                                                   │
   └── 渲染 LeftRail ──────┘                                                   │
```

### 3.2 Token 流式合流与局部增量更新时序 (避免全屏 innerHTML 重绘)
```text
Gateway WS              TokenCoalescer            Renderer Container       Target Message DOM
   │                          │                           │                         │
   ├── event: message.delta ─►│ (push to circular buffer) │                         │
   │   (100~200 Hz 高频小包)   │                           │                         │
   │                          ├── RAF 物理帧触发 (16ms) ──►│                         │
   │                          │   flush(contentBatch)     ├── 查找 last-assistant-id │
   │                          │                           │   (不重刷全量 DOM)       ├── 追加 TextNode / Patch
   │                          │                           ├── 平滑滚动保持底部 (180px) ─►│
```

---

## 四、工业级 TDD 测试契约 (AAA 规范与四象限覆盖)

根据 `AGENTS.md`，测试用例必须遵循严格的 AAA 三段式，覆盖正常、边界、负向混沌与竞态。

### TC-CORE-001 (Happy Path - 会话列表双通道与归一化)
```typescript
// Arrange: 准备包含深层嵌套 data 与 sessions 的不同网关响应结构
const mockWsResult = {
  sessions: [
    { id: 'ses-1', title: 'Session A', model: 'deepseek-v4.1', last_active: 1700000000 },
    { id: 'ses-2', title: 'Session B', model: 'claude-3-7', last_active: 1700000010 }
  ]
};
// Act: 执行归一化解析
const normalized = normalizeSessionsResult(mockWsResult);
// Assert: 断言完整解析
assert.equal(normalized.length, 2);
assert.equal(normalized[0].id, 'ses-1');
assert.equal(normalized[0].title, 'Session A');
```

### TC-CORE-002 (Negative & Chaos - WS 超时自动无缝降级到 REST)
```typescript
// Arrange: 构造超时的 WS 客户端以及可用的 REST 代理响应
const client = new HermesGatewayClient({ url: 'ws://invalid-host', timeoutMs: 100 });
client.setRestFallbackHandler(async () => ({
  data: [{ id: 'ses-rest', title: 'From REST' }]
}));
// Act: 发起拉取
const sessions = await client.listSessionsSafe('default');
// Assert: 断言自动降级且不抛出空指针，数据正确
assert.equal(sessions.length, 1);
assert.equal(sessions[0].id, 'ses-rest');
```

### TC-CORE-003 (Boundary & Robustness - 模型全场景递归提取)
```typescript
// Arrange: 构造混合格式 model.options 响应 (含 providers 嵌套与根层 model)
const complexPayload = {
  model: 'default-hermes',
  providers: [
    { provider: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { provider: 'anthropic', models: [{ id: 'claude-3-7-sonnet' }] }
  ]
};
// Act: 解析提取
const models = extractAvailableModels(complexPayload);
// Assert: 断言去重且全部提取
assert.ok(models.includes('default-hermes'));
assert.ok(models.includes('deepseek-chat'));
assert.ok(models.includes('deepseek-reasoner'));
assert.ok(models.includes('claude-3-7-sonnet'));
```

### TC-UI-001 (Layout Constraint - 740px 输入舱与 100% 对话流)
```typescript
// Arrange: 渲染 MiddlePod 与 InputDock
const middleHtml = renderMiddlePod({ gatewayConnected: true, messages: [] });
const dockHtml = renderInputDock({ selectedModel: 'deepseek-v4.1', reasoningLevel: 'high', approvalMode: 'auto', isStreaming: false });
// Act & Assert:
assert.ok(middleHtml.includes('conversation-pod') && middleHtml.includes('width: 100%'));
assert.ok(dockHtml.includes('max-width: 740px'));
```

### TC-UI-002 (OpenChamber Vertical Rail - 62px 极右贴靠)
```typescript
// Arrange & Act: 渲染 InspectionPod
const podHtml = renderInspectionPod({ collapsed: false, activeTab: 'artifacts', gatewayConnected: true });
// Assert:
assert.ok(podHtml.includes('inspector-vertical-rail'));
assert.ok(podHtml.includes('width: 62px') || podHtml.includes('var(--rail-width)'));
```
