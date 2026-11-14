# Hermes Flux 架构拆解执行委托书（第二阶段 · Batch 2）

> **承接代理**：子代理（Subagent）。  
> **任务目标**：将 `packages/desktop/src/renderer/index.ts`（当前 10284 行）中的 **D7: 弹窗与右键菜单交互控制**（`modalInteractionController.ts`）与 **D2: 输入舱与补全事件交互控制**（`inputDockController.ts`）完全剥离，行数目标压至 9000 行以下，并保持 100% 绿灯。

---

## 一、必须遵守的架构铁律（违反即一票否决）

1. **单向 Deps 依赖注入模式**：
   - 抽离的模块内部**严禁** `import ... from '../index.js'`（绝对零反向依赖）；
   - 所有外部读取与宿主副作用（`render`、`state` 字段读写、`showToast`、`confirmModal` 等）一律通过 `createXxxController(deps)` 接口传入；
2. **零 `as any` 与严格类型推导**：
   - `npm run typecheck` 必须为 0 错误；
3. **保留单行薄委托（Thin Delegation）**：
   - `index.ts` 内部保留原函数签名的转发函数（如 `function closeConfirmModal(...)`），确保现存 13 个读取源码文本的接线守卫测试不被破坏；
4. **构建与单测闭环**：
   - 在 `packages/desktop/scripts/build.mjs` 中注册新模块打包配置；
   - 在 `packages/desktop/__tests__/unit/` 下为新模块编写脱离浏览器的纯逻辑单测；
   - 及时同步 `scripts/gates/rules/maintainability.mjs` 的 `KNOWN_OVERSIZE` 行数。

---

## 二、本次切分目标清单

### 目标 1：D7 `packages/desktop/src/renderer/events/modalInteractionController.ts`（预估 -550 行）
- **覆盖代码**：
  - 全局极客美学二次确认模态窗（`confirmModal` 打开、关闭、点击遮罩或按钮触发 `onConfirm`/`onCancel`）；
  - 新建任务/新建群聊弹窗（Tab 切换 solo/group、成员多选、Profile 选择、确定提交发 RPC 并跳转）；
  - 右键上下文菜单（`sessionContextMenu` 的展示、点击菜单项分发重命名/删除/置顶/归档/导出/复制等）。
- **Deps 依赖契约设计**：
  ```ts
  export interface ModalInteractionDeps {
    readonly getState: () => AppState;
    readonly commitState: (patch: Partial<AppState>) => void;
    readonly requestRender: () => void;
    readonly showToast: (msg: string) => void;
    readonly createNewSession: (options: { profile?: string; projectId?: string; title?: string }) => Promise<void>;
    readonly deleteSession: (id: string) => Promise<void>;
    readonly renameSession: (id: string, title: string) => Promise<void>;
    readonly pinSession: (id: string) => Promise<void>;
    readonly archiveSession: (id: string) => Promise<void>;
    readonly exportMarkdown: (id: string) => Promise<void>;
    readonly copySessionId: (id: string) => Promise<void>;
    readonly openGroupRoom: (roomId: string) => Promise<void>;
    readonly createGroupRoom: (title: string, members: string[]) => Promise<{ room_id?: string }>;
    readonly fetchGroupRooms: () => Promise<void>;
    readonly t: (key: any, params?: any) => string;
  }
  ```

### 目标 2：D2 `packages/desktop/src/renderer/events/inputDockController.ts`（预估 -850 行）
- **覆盖代码**：
  - 约 9400~10250 行：输入框高度随内容自适应（`syncComposerHeight`，66px 起步至 220px 封顶）；
  - IME 中文输入法组合态防御（`compositionstart` / `compositionend` 锁）；
  - 回车键与发送按钮统一动作分派（`planEnterAction`、`handleSend`）；
  - 队列按钮显隐与三动作调度（立即发送、取消、放回编辑）；
  - 剪贴板文件/图片粘贴（`paste` 事件触发附件解析）；
  - `@Agent` 智能引用与 `/` 斜杠命令实时联想补全的输入检测与关闭判定。
- **Deps 依赖契约设计**：
  ```ts
  export interface InputDockControllerDeps {
    readonly getState: () => AppState;
    readonly commitState: (patch: Partial<AppState>) => void;
    readonly requestRender: () => void;
    readonly routeSend: (text: string) => Promise<void>;
    readonly enqueueDraft: () => Promise<void>;
    readonly interruptTurn: () => Promise<void>;
    readonly handleRollbackCancel: () => void;
    readonly handleQueueAction: (action: string, id: string) => Promise<void>;
    readonly addInputAttachments: (files: FileList | File[]) => Promise<void>;
    readonly requestSlashCompletion: (prefix: string) => void;
    readonly requestPathCompletion: (query: string, agentItems: any[]) => void;
    readonly t: (key: any, params?: any) => string;
  }
  ```

---

## 三、验收命令清单（必须全部跑通）
1. `npm run build:desktop`
2. `npm run typecheck`
3. `npm run gates:changed`
4. `npm run gates:self-proof`
5. `npm test`
6. `npm run verify`
