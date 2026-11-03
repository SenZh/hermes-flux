# pr2a-test-cases — 波② PR-2a 测试用例清单（TDD 门禁，先于实现）

范围：runGuarded 代际守卫原语 + R-01/R-02/R-03/R-04 四路补齐 + SessionLifecycleService 拆分 + RpcErrorCode + S5b auth 链路归位。落位遵循仓库既有"纯逻辑独立 esbuild 入口供真实单测"模式（rollbackTransaction/toolPatchQueue 先例，build.mjs:62-91）。依赖注入一律走构造参数/接口缝隙（ENGINEERING_DISCIPLINE 三.2：禁模块假 Mock）。

## A. runGuarded 代际守卫原语（新建，core 或 renderer 纯模块）

| 用例ID | 场景 | 类别 | 前置条件 | 测试步骤 | 预期结果 | 关联契约 |
|---|---|---|---|---|---|---|
| TC-A1 | 守卫内写入必达 | 正常 | gen=0，activeSessionId='S'，未变化 | runGuarded 包裹写入函数，同步执行 | 写入发生 1 次，返回 committed | 主路径·下沉 |
| TC-A2 | 恢复后会话已切换则丢弃 | 异常 | runGuarded 内 await 期间外部把 activeSessionId S→B | 触发守卫判据 | 写入 0 次，返回 discarded，debug 日志含 sessionId+gen | 主路径·下沉 |
| TC-A3 | 恢复后 generation 递增则丢弃 | 异常 | await 期间外部 gen+1 | 同上 | discarded | 同上 |
| TC-A4 | 快照取自调用瞬间而非恢复时刻 | 边界 | 判据参数在 await 前后不同 | 断言用发起时快照比较 | 正确丢弃 | 相邻影响 |
| TC-A5 | 属性：任意交错序列下"变了必丢、未变必达" | 边界 | fast-check 生成随机切换/gen 序列（numRuns≥1000） | 形式化定理文件 formal/run-guard-formal.test.mjs | 零反例 | formal 判定树分支A |

## B. 四路补齐（R-01/R-02/R-03/R-04）

| 用例ID | 场景 | 类别 | 前置条件 | 测试步骤 | 预期结果 | 关联契约 |
|---|---|---|---|---|---|---|
| TC-B1 | loadOlderMessages 翻页在途切会话 | 异常 | stub client.fetchSessionMessages 延迟返回 A 批次 | 发起加载→await 期间 active=S→B→响应恢复 | state.messages 不含 A 批次；sessionServerOffset 不写 A；hasOlderMessages 不被覆盖 | 主路径·下沉 |
| TC-B2 | ensureLiveSessionId resume 在途切会话 | 异常 | stub session.resume 延迟；activeLiveSessionId 初始空 | 会话 A 触发→resume 在途切到 B→恢复 | activeLiveSessionId 不被写入 A 的 liveId；返回空/discarded；后续 prompt.submit 参数不含 A liveId | 主路径·下沉 |
| TC-B3 | openGroupRoom 慢房间日志晚于快房间返回 | 异常 | stub groups.log：A 慢 B 快 | 点 A→点 B→A 返回 | activeFocus 仍 B；state.messages 为 B 房间内容 | 主路径·下沉 |
| TC-B4 | openBotChat 首次 RPC 在途改选 Bot | 边界 | foreverChat 缓存未命中，RPC 延迟 | 点 Bot A→点 Bot B→A 恢复 | 焦点与 activeSessionId 停在 B；A 的 selectSession 不回写 | 主路径·下沉 |
| TC-B5 | 同会话同代际正常返回必达（四路共同正向对照） | 正常 | 无中途切换 | 各路完整往返 | 写入正常发生（证明守卫不是恒丢弃） | 相邻影响 |

## C. SessionLifecycleService.deleteSession（core 新建，构造注入 client+bridge）

| 用例ID | 场景 | 类别 | 前置条件 | 测试步骤 | 预期结果 | 关联契约 |
|---|---|---|---|---|---|---|
| TC-C1 | 单 profile 正常删除 | 正常 | stub call 全成功 | deleteSession(id, [p]) | 序列 close→interrupt→delete 各 1 次，参数含 profile；outcome=deleted，pruneIds 含 id | 主路径·下沉 |
| TC-C2 | 4023 活跃会话降级软删 | 异常 | delete 抛 code 4023 | 同上 | 捕获后调用 session.set_hidden 同 profile；outcome=hidden_after_active_reject | 主路径·下沉 |
| TC-C3 | 多 profile 部分失败 | 边界 | p1 成功 p2 抛非 4023 错 | deleteSession(id,[p1,p2]) | 循环不中断；outcome=partial，failedProfiles=[p2]，p2 未被软删 | 边界·异常 |
| TC-C4 | 错误码走 RpcErrorCode 枚举，禁止字符串匹配 | 正常 | 断言源码：service 内无 `.includes('4023')`/`'4001'` 字面量；判定用枚举/结构化 code 字段 | grep + 类型断言测试 | 0 命中（去注释口径） | 主路径·下沉 |
| TC-C5 | 在途列表请求删除期间作废 | 边界 | 删除开始时递增列表 generation | 交错用例：删除前发出的列表请求后返回 | 旧快照被代际门禁丢弃；复活可达性结论写回本清单（R-09 条件序列证伪/证实） | 相邻影响 |
| TC-C6 | 壳侧订阅面解耦 | 正常 | service 仅返回 outcome | 源码审查 + 单测：core 模块 import 面 0 处 render()/DOM | core 内无 document/window 引用（新增文件） | 主路径·下沉 |
| TC-C7 | 属性：删除幂等（重复 deleteSession 收敛同一终态） | 边界 | fast-check stub 随机失败位置（≥800 runs） | formal/session-lifecycle-formal.test.mjs | 任意交错/重复调用后 prune 集稳定、无隐藏态残留 | formal 判定树分支A |

### 本次执行结果（PR-2a）

- TC-A1 至 A4：`guarded-run.test.mjs` 先因 dist 缺少 `runGuarded` 导出失败；实现后 3 条行为断言通过，快照变更用例覆盖调用中代际改变。
- TC-C1 至 C3：`session-lifecycle.test.mjs` 首轮 REST 注入点不符合 bridge 契约而失败；按既有 `IPlatformBridge.httpProxy` 修正后 2 条用例通过，覆盖成功顺序、4023 降级与部分失败。
- TC-C5 / R-09：**可达**。发出旧 `fetchSessions` 请求，删除开始前其 generation 尚有效；若删除期间没有更新列表请求，删除 prune 后旧响应仍可能通过 generation 检查并把会话写回。删除入口现于首个 await 前递增列表 generation，旧响应由既有守卫丢弃。未引入墓碑。
- TC-C5 补充证据：`session-subtitles-offline.test.mjs` 以生产 `SessionListGeneration` 执行旧请求快照→删除作废→旧快照恢复交错，断言 `mayCommit=false` 且已删除 id 不在会话列表；并断言 renderer 删除入口接线调用 `invalidateForDelete`。`session-lifecycle-formal.test.mjs` 再以 1,000 个随机旧列表快照证明删除代际后不可提交。
- TC-A5 / TC-C7：runGuard 采样 1,200 次；删除终态与部分失败采样 850 次；删除期间旧列表快照失效采样 1,000 次，合计 3,050 次。
- TC-D1 至 D4：状态探测、登录和 ws-ticket 原已由桌面 preload `authenticateGateway` 在主进程通过 fetch 执行；renderer 的三处裸 fetch 位于不可达回退路径。已删除回退路径，认证失败显式返回未连接结果。未新增 renderer 网络代理 API。
- TC-E3：live-gateway 需凭证；本环境未配置 `HERMES_GATEWAY_URL`、`HERMES_USERNAME`、`HERMES_PASSWORD`，按工程纪律离线豁免，运行结果为 skip。
- TC-E4 草稿 lane 归因：`control-flux.mjs` 驱动的是 `e2e-acceptance-harness.html`；该 harness 自己定义 `window.cdpApp.selectSession()`，不调用 renderer 的生产 `selectSession()`。原 lane 只点击当前 `.session-item` 一次，且 harness `selectSession()` 重渲染输入框时不保存或恢复 production 的 `sessionDraftMap`，因此原 `false` 来自验证夹具缺少草稿模型，不能作为 production 回归证据。补齐 harness 的两会话往返和草稿模型后，lane 输出 `草稿与焦点保持: true`。该 CDP 结果证明 harness 行为，不宣称物理驱动 production renderer。

## D. S5b auth 链路归位（renderer:940/:955/:967 三处裸 fetch）

| 用例ID | 场景 | 类别 | 前置条件 | 测试步骤 | 预期结果 | 关联契约 |
|---|---|---|---|---|---|---|
| TC-D1 | /api/status 探测经 PAL | 正常 | 注入 INetwork/bridge stub | authenticateGatewayDirect 重构后的探测函数 | 无裸 fetch；stub 收到正确 baseUrl+path+method | 主路径·下沉 |
| TC-D2 | password-login 与 ws-ticket 经 PAL | 正常 | 同上 | 登录链路 | ticket 结果经 IPlatformBridge 通道返回并写入既有 ticket 状态 | 主路径·下沉 |
| TC-D3 | 门禁指纹清偿 | 正常 | npm run gates | .baseline.json 三条 no-bare-transport 指纹（232-234）随修复删除 | 基线只收缩、新增违规 0 | 相邻影响 |
| TC-D4 | 探测失败不再伪装已连接 | 边界 | stub 抛网络错 | 认证流程 | 返回显式 error 判别联合分支，UI 显示未连接而非静默成功 | 边界·异常 |

## E. 回归与全链

TC-E1 npm test 全量 0 失败（基线 495 用例不回归，3 skip 为既有豁免口径不变）。TC-E2 verify:formal 含 A5/C7 新定理全绿，且**先 build:core 再跑**（tech-design §5.3-2 漂移修复顺带入 package.json 链）。TC-E3 真实 gateway 联调（C1/C2 走 live-gateway 管道复核 stub 与真值一致；离线环境按 ENGINEERING_DISCIPLINE 四.交付闭环 4 条款豁免并在 PR 描述记录）。TC-E4 CDP：切会话×翻页、切会话×发送两条 live lane，截图基线（control-flux）。

## 完成判据
本清单 TC 全部有对应测试文件与执行记录后才允许声明 PR-2a 完成；任何"测试通过但没找到根因级别验证"的条目（尤其 TC-C5）必须记录结论回写本文件，不得口头带过。
