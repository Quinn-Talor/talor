# main 进程分层约定

**依赖方向单向：入口 → 业务 → 仓储 → 基础设施。**

## 层与目录

| 层 | 目录 | 职责 | 允许依赖 | 禁止 |
|----|------|------|---------|------|
| 入口 | `ipc/` | IPC 协议注册、参数解包、事件转发、错误码映射、snake/camel 命名转换 | 业务层任意目录、`repos/*`、`shared/*` | 业务决策 |
| 业务（按领域聚合） | `chat/`、`loop/`、`tools/`、`prompt/`、`memory/`、`mcp/`、`providers/` | `chat/` = chat 用例编排（orchestrator / attachments / provider-selector / stream-registry）；`loop/` = ReAct 引擎；其余为各自领域模块 | 业务层其他目录、`repos/*`、`store/*`（只读）、`shared/*` | `ipc/*` |
| 仓储 | `repos/` | SQL CRUD，领域对象转换 | `db/*`、`shared/*` | 业务层以外的任何调用 |
| 基础 | `db/`、`store/`、`services/*` | sqlite 连接、electron-store、OS keychain、provider-fetcher 等原子基础能力 | `shared/*` | — |

**关键区分：** `chat/` 是**用例层**（怎么把一次 chat:send 跑完整），`loop/` 是**引擎层**（给定已就绪的 model/tools，怎么完成 ReAct）；编排调用引擎，未来可复用同一个 `loop/`。`services/` **不**作为"业务层容器"使用，只放原子基础能力。

## 跨层通信约定

业务层与入口层解耦靠**端口注入**：

- **ToolConfirmPort**：`tools/build-tools.ts` 不直接 import `ipc/tool-confirm`；入口层创建 `(payload) => requestToolConfirm(mainWindow, payload)` 传入。
- **ChatCallbacks**：`chat/orchestrator.ts` 通过 callback 上报 text/tool 事件；入口层把 callback 转成 `webContents.send`。
- **流式中止**：业务层用 `AbortSignal`，入口层通过 `streamRegistry.abort(sessionId)` 触发。

## 审查清单

写代码时自检：

- [ ] 本文件属于哪一层？顶部注释有声明吗？
- [ ] import 是否仅来自允许依赖的层？
- [ ] 业务逻辑是否从 `ipc/` 下沉到对应领域目录（`chat/` / `loop/` / `tools/` …）？
- [ ] 与入口层耦合的地方，是否通过 callback / 端口注入解耦？
- [ ] 关键方法（循环控制、超时、错误兜底）是否有 JSDoc 说明 "为什么"？
