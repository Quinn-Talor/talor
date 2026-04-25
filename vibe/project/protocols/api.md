# Talor Desktop IPC API 协议

> **长期维护文档**。所有 Electron IPC channel 的完整接口文档。
> 迭代完成后，将 feature.md 中的 API 变更合并到本文档。
>
> 项目地图见 `../overview.md`。DB Schema 见 `db-schema.md`。

---

## 通信模型

| 模式 | 方向 | 用法 | 示例 |
|------|------|------|------|
| `ipcRenderer.invoke` | renderer → main（请求/响应） | 有返回值的操作 | `session:list`, `chat:send` |
| `ipcRenderer.send` | renderer → main（单向） | 无返回值的控制信号 | `window:minimize`, `chat:tool-confirm-response` |
| `webContents.send` | main → renderer（推送） | 流式事件、异步通知 | `chat:stream`, `chat:tool-call` |

渲染进程通过 `window.talorAPI`（preload contextBridge 暴露）访问所有 channel，不可直接调用 `ipcRenderer`。

---

## config 模块

### `config:get` — 获取应用配置

- **方向**：invoke
- **入参**：无
- **返回**：`AppConfig`

```typescript
interface AppConfig {
  config_dir: string
  providers: Record<string, Provider>
  window_bounds: {
    width: number; height: number; x: number; y: number; is_maximized: boolean
  }
}
```

---

### `config:save` — 保存应用配置（部分更新）

- **方向**：invoke
- **入参**：`Partial<AppConfig>`（只更新提供的字段）
- **返回**：`void`

---

## providers 模块

### `providers:list` — 列出所有 Provider

- **方向**：invoke
- **入参**：无
- **返回**：`Provider[]`（按 `config.json` 中的 key 顺序返回）

```typescript
interface Provider {
  id: string             // UUID v4
  type: 'ollama' | 'openai' | 'anthropic' | 'google'
  name: string
  base_url: string
  models: ModelInfo[]
  enabled: boolean
  is_default: boolean
  supports_vision?: boolean
  api_key?: string       // 注意：返回时为解密后的明文（SafeStorage 解密）
  created_at: string     // ISO 8601
  updated_at: string
  models_last_updated?: string  // 模型列表最后更新时间
  models_cache_ttl?: number     // 缓存 TTL（秒，默认 300）
}
```

---

### `providers:create` — 创建 Provider

- **方向**：invoke
- **入参**：`ProviderInput`
- **返回**：`Provider`（含 id / created_at / updated_at）
- **副作用**：若 `api_key` 非空，通过 `SafeStorageService` 加密存储

```typescript
interface ProviderInput {
  type: 'ollama' | 'openai' | 'anthropic' | 'google'
  name: string
  base_url: string
  models?: ModelInfo[]
  enabled: boolean
  is_default: boolean
  api_key?: string
  supports_vision?: boolean
}
```

---

### `providers:update` — 更新 Provider

- **方向**：invoke
- **入参**：`(id: string, updates: ProviderInput)`
- **返回**：`Provider`
- **错误**：Provider 不存在时抛 `Error('Provider not found: ${id}')`

---

### `providers:delete` — 删除 Provider

- **方向**：invoke
- **入参**：`id: string`
- **返回**：`void`
- **副作用**：同时调用 `SafeStorageService.removeApiKey(id)` 删除加密 Key

---

### `providers:setDefault` — 设置默认 Provider

- **方向**：invoke
- **入参**：`id: string`
- **返回**：`void`
- **行为**：将所有 Provider 的 `is_default` 置为 `false`，再将指定 id 置为 `true`（原子两步更新）

---

### `providers:testConnection` — 测试连接

- **方向**：invoke
- **入参**：`{ type: ProviderType; base_url: string; api_key?: string }`
- **返回**：`ConnectionTestResult`

```typescript
interface ConnectionTestResult {
  status: 'success' | 'failure'
  latency_ms?: number
  models_count?: number
  error_code?: string
  message?: string
}
```

---

### `providers:getModels` — 获取模型列表（支持缓存）

- **方向**：invoke
- **入参**：`(providerId: string, forceRefresh?: boolean)`（`forceRefresh` 默认 `false`）
- **返回**：`ProviderModelResponse`

```typescript
interface ProviderModelResponse {
  models: ModelInfo[]
  refreshed_at: string  // ISO 8601
  cache_ttl: number     // 秒
  from_cache: boolean
}
```

- **缓存逻辑**：`forceRefresh=false` 且 `models_last_updated` 在 TTL 内且 `models` 非空 → 直接返回缓存

---

### `providers:refreshModels` — 强制刷新模型列表

- **方向**：invoke
- **入参**：`providerId: string`
- **返回**：`{ models: ModelInfo[]; refreshed_at: string; cache_ttl: number }`（无 `from_cache` 字段）

---

### `providers:detectCapabilities` — 自动检测模型能力

- **方向**：invoke
- **入参**：`{ providerId: string; modelId: string }`
- **返回**：更新后的 `ModelInfo`（含 `capabilities`, `supports_vision`, `supports_tools`）
- **副作用**：更新 `config.json` 中该模型的 capabilities 字段

```typescript
interface ModelInfo {
  id: string               // "provider_id/model_name"
  name: string
  provider_id: string
  display_name: string
  description?: string
  capabilities: ModelCapability[]
  supports_vision?: boolean
  supports_tools?: boolean
  max_tokens?: number
}

interface ModelCapability {
  category: 'text' | 'vision' | 'tools' | 'video' | 'audio'
  type: string             // "text_generation" | "image_understanding" | "function_calling" 等
  supported: boolean
  description: string
  detected_at?: string     // ISO 8601
  source: 'auto' | 'manual' | 'default'
}
```

---

### `providers:updateModelCapabilities` — 手动更新模型能力

- **方向**：invoke
- **入参**：`{ providerId: string; modelId: string; capabilities: ModelCapability[] }`
- **返回**：更新后的 `ModelInfo`

---

## session 模块

### `session:list` — 列出所有会话

- **方向**：invoke
- **入参**：无
- **返回**：`ChatSession[]`（按 `updated_at DESC` 排序）

```typescript
interface ChatSession {
  id: string
  title: string
  provider_id: string
  model_id?: string
  workspace?: string
  created_at: string
  updated_at: string
}
```

---

### `session:create` — 创建会话

- **方向**：invoke
- **入参**：`{ provider_id: string; model_id?: string }`
- **返回**：`ChatSession`
- **行为**：`model_id` 未提供时自动拉取 Provider 的第一个可用模型；`title` 固定为 `'新会话'`

---

### `session:get` — 获取单个会话

- **方向**：invoke
- **入参**：`id: string`
- **返回**：`ChatSession | null`

---

### `session:rename` — 重命名会话

- **方向**：invoke
- **入参**：`{ session_id: string; title: string }`
- **返回**：`ChatSession | null`（不存在时返回 null）

---

### `session:updateModel` — 更新会话使用的模型（不清消息）

- **方向**：invoke
- **入参**：`{ session_id: string; model_id: string }`
- **返回**：`ChatSession | null`

---

### `session:updateWorkspace` — 更新会话工作目录

- **方向**：invoke
- **入参**：`{ session_id: string; workspace: string }`
- **返回**：`ChatSession | null`

---

### `session:checkModelAvailability` — 检查会话模型是否可用

- **方向**：invoke
- **入参**：`{ session_id: string }`
- **返回**：`{ available: boolean; model_id?: string }`
- **用途**：切换 Provider 后检查旧会话模型是否仍在模型列表中

---

### `session:delete` — 删除会话

- **方向**：invoke
- **入参**：`sessionId: string`
- **返回**：`void`
- **副作用**：`foreign_keys=ON` 自动级联删除 messages 和 session_summaries

---

### `session:getMessages` — 获取会话消息列表

- **方向**：invoke
- **入参**：`sessionId: string`
- **返回**：`ChatMessage[]`（按 `created_at ASC` 排序）

```typescript
interface ChatMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string   // JSON stringified ContentBlock[]
  created_at: string
}
```

---

### `session:touch` — 更新会话 updated_at

- **方向**：invoke
- **入参**：`sessionId: string`
- **返回**：`void`

---

## chat 模块

### `chat:send` — 发送消息（触发 ReAct 循环）

- **方向**：invoke
- **入参**：`ChatSendParams`
- **返回**：`{ message_id: string }`
- **副作用**：流式结果通过 `chat:stream` / `chat:tool-call` / `chat:tool-result` / `chat:tool-confirm` 事件推送到 renderer

```typescript
interface ChatSendParams {
  session_id: string
  content: string
  attachments?: Array<{
    path: string
    mime_type: string
    filename: string
    size_bytes: number
  }>
}
```

**错误**（通过 `chat:stream` 中 `error_code` 字段携带）：

| error_code | 含义 | 触发条件 |
|-----------|------|---------|
| `LLM_CONNECTION_FAILED` | LLM 连接失败 | `ECONNREFUSED`, `ENOTFOUND`, `fetch` 错误 |
| `AUTH_FAILED` | 认证失败 | HTTP 401 / 403 / "API key" |
| `RATE_LIMITED` | 请求频率限制 | HTTP 429 |
| `LLM_ERROR` | LLM 通用错误 | 其他 LLM 异常 |
| `LLM_TIMEOUT` | LLM 超时 | 请求超时 |
| `PROVIDER_NO_VISION` | Provider 不支持视觉 | 图片附件 + `supports_vision=false` |
| `FILE_TOO_LARGE` | 附件超过 50MB | 附件大小验证失败 |
| `UNSUPPORTED_FILE_TYPE` | 不支持的文件类型 | MIME 类型不在白名单 |
| `FILE_NOT_FOUND` | 附件文件不存在 | 文件路径无效 |
| `NETWORK_OFFLINE` | 网络离线 | 无网络连接 |

---

### `chat:abort` — 中止当前流式生成

- **方向**：invoke
- **入参**：`sessionId: string`
- **返回**：`void`
- **行为**：调用对应 `AbortController.abort()`，触发 stream 的 AbortError

---

### `chat:stream` — 流式文本事件（main → renderer 推送）

- **方向**：`webContents.send`（推送）
- **消费**：`talorAPI.chat.onStream(callback)` → 返回 unsubscribe 函数

```typescript
interface ChatStreamEvent {
  session_id: string
  message_id: string
  delta: string           // 文本增量（done=true 时为空字符串）
  done: boolean           // true = 流结束（最后一个事件）
  error_code?: ChatErrorCode
  error_message?: string
}
```

---

### `chat:tool-call` — 工具调用事件（main → renderer 推送）

- **方向**：`webContents.send`（推送）
- **消费**：`talorAPI.chat.onToolCall(callback)`

```typescript
interface ChatToolCallEvent {
  session_id: string
  message_id: string
  tool_call_id: string
  tool_name: string
  input: Record<string, unknown>
}
```

---

### `chat:tool-result` — 工具结果事件（main → renderer 推送）

- **方向**：`webContents.send`（推送）
- **消费**：`talorAPI.chat.onToolResult(callback)`

```typescript
interface ChatToolResultEvent {
  session_id: string
  message_id: string
  tool_call_id: string
  tool_name: string
  result: unknown
}
```

---

### `chat:tool-confirm` — 高风险工具确认请求（main → renderer 推送）

- **方向**：`webContents.send`（推送）
- **消费**：`talorAPI.chat.onToolConfirm(callback)`
- **触发**：工具 `riskLevel === 'HIGH'`（`HIGH_RISK_TOOLS = ['bash', 'write', 'edit']`）

```typescript
interface ToolConfirmRequest {
  sessionId: string
  messageId: string
  toolCallId: string
  toolName: string        // 'bash' | 'write' | 'edit'
  inputSummary: string    // UI 展示摘要（≤ 500 chars）
  inputFull: unknown      // 完整输入（实际执行用）
}
```

**超时**：30 秒无响应自动拒绝执行。

---

### `chat:tool-confirm-response` — 高风险工具确认响应（renderer → main 单向）

- **方向**：`ipcRenderer.send`（单向）
- **发送**：`talorAPI.chat.sendToolConfirmResponse(response)`

```typescript
interface ToolConfirmResponse {
  toolCallId: string
  decision: 'approved' | 'rejected'
}
```

---

## mcp 模块

### `mcp:servers:list` — 列出所有 MCP 服务器

- **方向**：invoke
- **返回**：`MCPServer[]`

```typescript
interface MCPServer {
  id: string
  name: string
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
  enabled: boolean
  created_at: string
  updated_at: string
}

interface MCPAuthConfig {
  type: 'none' | 'bearer' | 'apiKey'
  token?: string
  apiKey?: string
}
```

---

### `mcp:servers:create` — 创建 MCP 服务器

- **方向**：invoke
- **入参**：`MCPServerInput`
- **返回**：`MCPServer`

---

### `mcp:servers:get` — 获取单个 MCP 服务器

- **方向**：invoke
- **入参**：`id: string`
- **返回**：`MCPServer`
- **错误**：不存在时抛 `Error('MCP Server not found: ${id}')`

---

### `mcp:servers:update` — 更新 MCP 服务器

- **方向**：invoke
- **入参**：`(id: string, updates: Partial<MCPServerInput>)`
- **返回**：`MCPServer`

---

### `mcp:servers:delete` — 删除 MCP 服务器

- **方向**：invoke
- **入参**：`id: string`
- **返回**：`void`

---

### `mcp:servers:setEnabled` — 启用/禁用 MCP 服务器

- **方向**：invoke
- **入参**：`(id: string, enabled: boolean)`
- **返回**：`MCPServer`

---

### `mcp:servers:importConfig` — 批量导入 MCP 配置（JSON 格式）

- **方向**：invoke
- **入参**：`configJson: string`（JSON 字符串，格式为 `Record<name, serverConfig>`）
- **返回**：`Array<{ name: string; status: 'created' | 'updated' }>`

---

### `mcp:servers:exportConfig` — 导出所有 MCP 配置为 JSON

- **方向**：invoke
- **入参**：无
- **返回**：`string`（格式化的 JSON 字符串）

---

### `mcp:servers:testConnection` — 测试 MCP 服务器连接

- **方向**：invoke
- **入参**：`MCPServerInput`（含 type/command/args/url/auth 等）
- **返回**：`MCPConnectionTestResult`

```typescript
interface MCPConnectionTestResult {
  status: 'success' | 'failure'
  latency_ms?: number
  tools_count?: number
  error_code?: 'TIMEOUT' | 'CONNECTION_FAILED' | 'INVALID_CONFIG' | 'AUTH_FAILED'
  message?: string
}
```

- **超时**：30 秒
- **行为**：stdio 类型实际启动子进程并调用 `listTools()`；http 类型发送 `tools/list` JSON-RPC 请求

---

### `mcp:connect` — 连接单个 MCP 服务器

- **方向**：invoke
- **入参**：`serverId: string`
- **返回**：`{ status: string; message?: string; error_code?: string }`

---

### `mcp:disconnect` — 断开单个 MCP 服务器

- **方向**：invoke
- **入参**：`serverId: string`
- **返回**：`{ status: string; message?: string; error_code?: string }`

---

### `mcp:tools:list` — 列出所有已注册工具（builtin + MCP）

- **方向**：invoke
- **入参**：无
- **返回**：`Array<{ name: string; description: string; parameters: Record<string, unknown>; schema?: Record<string, unknown>; provider?: string }>`

---

### `mcp:servers:connected` — 获取已连接的服务器 ID 列表

- **方向**：invoke
- **入参**：无
- **返回**：`string[]`

---

### `mcp:servers:status` — 获取所有服务器连接状态

- **方向**：invoke
- **入参**：无
- **返回**：`Array<{ serverId: string; name: string; connected: boolean; toolCount: number }>`

---

## window 模块

### `window:minimize` / `window:maximize` / `window:close` — 窗口控制

- **方向**：`ipcRenderer.send`（单向，无返回值）
- **发送**：`talorAPI.window.minimize()` / `.maximize()` / `.close()`
- **行为**：`maximize` 切换最大化/还原状态

---

### `window:isMaximized` — 查询窗口是否最大化

- **方向**：invoke
- **入参**：无
- **返回**：`boolean`

---

## file 模块

### `file:openDialog` — 打开文件选择对话框

- **方向**：invoke
- **入参**：`OpenDialogOptions?`（可选）
- **返回**：`string[] | null`（取消时返回 null，否则返回选中的文件路径数组）

```typescript
interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: { name: string; extensions: string[] }[]
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | ...>
}
```

> 注意：`file:getAttachments`、`file:getValidatedAttachments`、`file:readText`、`file:readImageAsBase64`、`file:checkAccess` 已在主进程注册，但**未通过 preload contextBridge 暴露**，renderer 当前无法直接调用。

---

## Channel 速查表

| Channel | 方向 | 模块 | 描述 |
|---------|------|------|------|
| `config:get` | invoke | config | 获取全局配置 |
| `config:save` | invoke | config | 保存配置（部分更新） |
| `providers:list` | invoke | providers | 列出所有 Provider |
| `providers:create` | invoke | providers | 创建 Provider |
| `providers:update` | invoke | providers | 更新 Provider |
| `providers:delete` | invoke | providers | 删除 Provider |
| `providers:setDefault` | invoke | providers | 设置默认 Provider |
| `providers:testConnection` | invoke | providers | 测试连接 |
| `providers:getModels` | invoke | providers | 获取模型列表（缓存） |
| `providers:refreshModels` | invoke | providers | 强制刷新模型列表 |
| `providers:detectCapabilities` | invoke | providers | 自动检测模型能力 |
| `providers:updateModelCapabilities` | invoke | providers | 手动更新模型能力 |
| `session:list` | invoke | session | 列出所有会话 |
| `session:create` | invoke | session | 创建会话 |
| `session:get` | invoke | session | 获取单个会话 |
| `session:rename` | invoke | session | 重命名会话 |
| `session:updateModel` | invoke | session | 更新会话模型 |
| `session:updateWorkspace` | invoke | session | 更新工作目录 |
| `session:checkModelAvailability` | invoke | session | 检查模型可用性 |
| `session:delete` | invoke | session | 删除会话 |
| `session:getMessages` | invoke | session | 获取消息列表 |
| `session:touch` | invoke | session | 更新 updated_at |
| `chat:send` | invoke | chat | 发送消息（触发 ReAct） |
| `chat:abort` | invoke | chat | 中止流式生成 |
| `chat:stream` | main→renderer push | chat | 流式文本增量 |
| `chat:tool-call` | main→renderer push | chat | 工具调用事件 |
| `chat:tool-result` | main→renderer push | chat | 工具结果事件 |
| `chat:tool-confirm` | main→renderer push | chat | 高风险工具确认请求 |
| `chat:tool-confirm-response` | send（单向） | chat | 工具确认响应 |
| `mcp:servers:list` | invoke | mcp | 列出 MCP 服务器 |
| `mcp:servers:create` | invoke | mcp | 创建 MCP 服务器 |
| `mcp:servers:get` | invoke | mcp | 获取单个 MCP 服务器 |
| `mcp:servers:update` | invoke | mcp | 更新 MCP 服务器 |
| `mcp:servers:delete` | invoke | mcp | 删除 MCP 服务器 |
| `mcp:servers:setEnabled` | invoke | mcp | 启用/禁用 MCP 服务器 |
| `mcp:servers:importConfig` | invoke | mcp | 批量导入配置 |
| `mcp:servers:exportConfig` | invoke | mcp | 导出配置 JSON |
| `mcp:servers:testConnection` | invoke | mcp | 测试连接 |
| `mcp:connect` | invoke | mcp | 连接服务器 |
| `mcp:disconnect` | invoke | mcp | 断开服务器 |
| `mcp:tools:list` | invoke | mcp | 列出所有工具 |
| `mcp:servers:connected` | invoke | mcp | 已连接服务器列表 |
| `mcp:servers:status` | invoke | mcp | 服务器状态列表 |
| `window:minimize` | send（单向） | window | 最小化窗口 |
| `window:maximize` | send（单向） | window | 最大化/还原窗口 |
| `window:close` | send（单向） | window | 关闭窗口 |
| `window:isMaximized` | invoke | window | 查询最大化状态 |
| `file:openDialog` | invoke | file | 打开文件选择对话框 |
