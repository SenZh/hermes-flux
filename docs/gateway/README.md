# 网关接口索引

> 本目录由 `npm run contract:doc` 自动生成。索引只做导航，细节在模块文档里。

## 数据来源

| 项目 | 值 |
| --- | --- |
| 契约来源 | `apps/shared/src/gateway-contract.generated.ts`（网关 Pydantic 模型自动生成） |
| 契约指纹 | `4364a2dd0064fbaf…` |
| 同步时间 | 2026-11-01T01:48:16.956Z |
| 契约内方法总数 | 258（本仓库实际使用 49 个，本文档只覆盖用到的） |
| 契约内事件总数 | 72 |
| 探针网关版本 | 0.22.5 |
| 探针录制时间 | 2026-11-01T01:59:35.303Z |

## 模块

| 模块 | 方法数 | 已探针 | 文档 |
| --- | --- | --- | --- |
| 系统与能力探测 | 3 | 2 | [system.md](./system.md) |
| Bot 档案与资产 | 6 | 6 | [profiles.md](./profiles.md) |
| 会话生命周期 | 11 | 11 | [sessions.md](./sessions.md) |
| 多 Agent 群聊 | 7 | 7 | [groups.md](./groups.md) |
| 工程与工作区 | 9 | 9 | [projects.md](./projects.md) |
| 代码时光机 | 3 | 3 | [rollback.md](./rollback.md) |
| 子代理委派 | 4 | 4 | [subagent.md](./subagent.md) |
| 对话提交与旁路 | 2 | 2 | [prompt.md](./prompt.md) |
| 下行事件流 | 72 个事件 | — | [events.md](./events.md) |

## 使用规则

1. **新增或修改任何 RPC 调用**，先在对应模块文档里确认方法名与字段，再写代码；
2. 方法名必须存在于契约中，字段必须落在白名单内，否则 `npm run contract:verify` 直接失败；
3. 新增调用点必须补探针用例，`npm run contract:coverage` 会检查"每个方法都有真实响应证据"；
4. 网关升级后执行 `npm run contract:sync` 刷新契约，再执行 `npm run probe:gateway` 刷新真实响应；
5. 本目录所有文件都是生成物，CI 会校验"重新生成后无 diff"，手改会被打回。

## 相关命令

| 命令 | 作用 |
| --- | --- |
| `npm run contract:sync` | 从网关仓库同步契约快照与字段白名单 |
| `npm run contract:verify` | 静态校验所有调用点的方法名与字段 |
| `npm run probe:gateway` | 连真实网关逐个方法取证，录制 fixture |
| `npm run contract:coverage` | 校验每个调用点都有真实响应证据 |
| `npm run contract:doc` | 重新生成本目录文档 |

