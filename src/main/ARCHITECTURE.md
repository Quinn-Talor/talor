# main 进程分层约定

**依赖方向单向：入口 → 业务 → 仓储 → 基础设施。**

## 层与目录

| 层                 | 目录                                                                                         | 职责                                                                                                                                                                                                | 允许依赖                                                 | 禁止                 |
| ------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------- |
| 入口               | `ipc/`                                                                                       | IPC 协议注册、参数解包、事件转发、错误码映射、snake/camel 命名转换                                                                                                                                  | 业务层任意目录、`repos/*`、`shared/*`                    | 业务决策             |
| 业务（按领域聚合） | `runtime/`、`chat/`、`agent/`、`tools/`、`skills/`、`providers/`、`permissions/`、`history/` | `runtime/` = agent-engine 的接入（运行时、能力目录、会话轮次、界面行投影、MCP 状态、Trace 读取）；`chat/` = 一轮的输入准备（attachments / provider-selector / stream-registry）；其余为各自领域模块 | 业务层其他目录、`repos/*`、`store/*`（只读）、`shared/*` | `ipc/*`              |
| 仓储               | `repos/`                                                                                     | SQL CRUD，领域对象转换                                                                                                                                                                              | `db/*`、`shared/*`                                       | 业务层以外的任何调用 |
| 基础               | `db/`、`store/`、`services/*`                                                                | sqlite 连接、electron-store、OS keychain、provider-fetcher 等原子基础能力                                                                                                                           | `shared/*`                                               | —                    |

**关键区分：** agent 的运行（ReAct 循环、上下文、工具执行、委托、MCP 连接池、审批、运行档案）全部由 agent-engine 承载；Talor 的 `runtime/` 只负责来源（能力目录、凭据库、模型）、投影（运行事件 → 界面行、会话用量）与界面。会话数据以引擎会话日志（`~/.talor/runs.db`）为准，`chat.db` 只存会话元数据、MCP 配置与账户凭据。`services/` **不**作为"业务层容器"使用，只放原子基础能力。

## 跨层通信约定

业务层与入口层解耦靠**端口注入**：

- **ChatPorts**：`runtime/turn.ts` 不直接 import `ipc/*`；入口层把授权弹窗（`promptPermission`）与 `AgentManager` 传入，审批人（`runtime/approval.ts`）按会话找这一轮登记的授权端口。
- **ChatCallbacks**：`runtime/turn.ts` 通过 callback 上报 text/tool 事件；入口层把 callback 转成 `webContents.send`。
- **流式中止**：业务层用 `AbortSignal`，入口层通过 `streamRegistry.abort(sessionId)` 触发。

## 审查清单

写代码时自检：

- [ ] 本文件属于哪一层？顶部注释有声明吗？
- [ ] import 是否仅来自允许依赖的层？
- [ ] 业务逻辑是否从 `ipc/` 下沉到对应领域目录（`runtime/` / `tools/` …）？
- [ ] 与入口层耦合的地方，是否通过 callback / 端口注入解耦？
- [ ] 关键方法（超时、错误兜底）是否有 JSDoc 说明 "为什么"？
