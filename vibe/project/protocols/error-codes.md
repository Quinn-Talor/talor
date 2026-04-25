# Talor Desktop 错误码

> **长期维护文档**。错误码格式 + 错误码表。
> 迭代完成后，将 feature.md 中的错误码变更合并到本文档。
>
> 项目地图见 `../overview.md`。API 协议见 `api.md`。

---

## 错误码格式

Talor Desktop 是桌面应用，无 HTTP 状态码，错误通过两种方式传递：

1. **IPC throw**：`ipcMain.handle` 中抛出 `Error`，renderer 侧 `ipcRenderer.invoke` catch 到
2. **chat:stream error_code**：`chat:send` 的异步错误通过 `chat:stream` 事件的 `error_code` 字段携带（`ChatErrorCode` 类型）

---

## 错误码表

### Chat 模块（`ChatErrorCode`）

> 来源：`src/preload/index.ts` `ChatErrorCode` 类型 + `src/main/ipc/chat.ts` 错误处理分支

| 错误码 | 含义 | 触发条件 | 用户可见提示 |
|--------|------|---------|------------|
| `LLM_CONNECTION_FAILED` | LLM 服务连接失败 | `ECONNREFUSED` / `ENOTFOUND` / `fetch` 网络错误 | 无法连接到 AI 服务，请检查 Provider 地址和网络 |
| `AUTH_FAILED` | API Key 认证失败 | HTTP 401 / 403 / 响应含 "API key" | API Key 无效或已过期，请在设置中更新 |
| `RATE_LIMITED` | 请求频率超限 | HTTP 429 | 请求过于频繁，请稍后再试 |
| `LLM_ERROR` | LLM 通用错误 | 其他 LLM 异常（未命中以上类别） | AI 服务出现错误，请重试 |
| `LLM_TIMEOUT` | LLM 请求超时 | 请求超时 | AI 服务响应超时，请重试 |
| `PROVIDER_NO_VISION` | Provider 不支持视觉 | 附件含图片 + `provider.supports_vision = false` | 当前 Provider 不支持图片理解，请使用支持视觉的模型 |
| `FILE_TOO_LARGE` | 附件文件超出大小限制 | 附件大小 > 50MB | 文件过大（最大 50MB），请选择较小的文件 |
| `UNSUPPORTED_FILE_TYPE` | 不支持的文件类型 | MIME 类型不在白名单内 | 不支持该文件类型，支持 PNG/JPEG/GIF/WebP/PDF/TXT/MD/JSON/CSV |
| `FILE_NOT_FOUND` | 附件文件不存在 | 文件路径无效或文件已被移动/删除 | 文件不存在或已被删除，请重新选择 |
| `NETWORK_OFFLINE` | 网络离线 | 无网络连接 | 网络连接已断开，请检查网络 |

---

### MCP 连接测试错误码（`MCPConnectionTestResult.error_code`）

> 来源：`src/preload/index.ts` `MCPConnectionTestResult` 接口 + `src/main/ipc/mcp.ts`

| 错误码 | 含义 | 触发条件 |
|--------|------|---------|
| `TIMEOUT` | 连接超时 | 30s 内未收到响应（`AbortError`） |
| `CONNECTION_FAILED` | 连接失败 | HTTP 非 2xx / stdio 子进程启动失败 |
| `INVALID_CONFIG` | 配置无效 | type 非 `stdio`/`http`，或缺少必填字段 |
| `AUTH_FAILED` | 认证失败 | HTTP Bearer/ApiKey 验证失败 |

---

### IPC throw 错误（主进程直接抛出）

> 这类错误通过 `ipcRenderer.invoke` 的 Promise rejection 传递，renderer 需 try/catch 捕获

| 抛出位置 | 错误信息格式 | 含义 |
|---------|------------|------|
| `providers:update` | `Provider not found: ${id}` | 目标 Provider 不存在 |
| `providers:getModels` | `Failed to get models for provider ${id}: ...` | 拉取模型列表失败 |
| `providers:refreshModels` | `Failed to refresh models for provider ${id}: ...` | 刷新模型列表失败 |
| `providers:detectCapabilities` | `Provider not found: ${id}` / `Model not found: ${modelId}` | Provider 或 Model 不存在 |
| `mcp:servers:get` | `MCP Server not found: ${id}` | 目标 MCP 服务器不存在 |
| `mcp:servers:update` | `MCP Server not found: ${id}` | 目标 MCP 服务器不存在 |
| `mcp:servers:setEnabled` | `MCP Server not found: ${id}` | 目标 MCP 服务器不存在 |
| `chat:send` | `Empty message: 消息内容和附件不能同时为空` | 消息和附件均为空 |
| `chat:send` | `No provider available` | 无可用的已启用 Provider |
| `file:openDialog` | `没有可用的窗口` | 无 BrowserWindow 实例 |

---

### 工具执行错误（ToolResult.error）

> 来源：`src/main/tools/registry.ts` `execute()` + 各 builtin 工具
> 工具错误不会中断 ReAct 循环，结果以 error 字段返回并传给 LLM 继续推理

| 错误信息 | 含义 | 来源工具 |
|---------|------|---------|
| `Workspace not set. Please set workspace first.` | 会话未设置工作目录 | bash / read / write / edit / glob / grep / ls |
| `Dangerous command not allowed.` | 命中危险命令模式 | bash |
| `Cannot access sensitive system paths outside workspace.` | 命令包含敏感路径 | bash |
| `Command timed out after ${n}s` | 命令执行超时（默认 30s） | bash |
| `Cannot access sensitive system path` | 路径命中敏感路径列表 | read / write / edit |
| `Cannot access path outside workspace` | 路径穿越 workspace 边界 | read / write / edit |
| `File not found: ${path}` | 文件不存在 | read |
| `File too large: ${n} bytes (max: ${max})` | 文件超过读取大小限制（默认 10MB） | read |
| `Cannot read binary file` | 文件为二进制格式 | read |
| `Content too large: ${n} bytes (max: ${max})` | 写入内容超过大小限制（默认 10MB） | write |
| `Tool not found: ${name}` | 工具名称在 registry 中不存在 | toolRegistry.execute |
