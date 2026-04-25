# talor-desktop MCP 功能迭代设计文档

> 本文档是 L3 迭代设计，描述本次变更的 delta。
> 依赖 L1 项目现状文档 `OVERVIEW-talor-desktop.md` 和 L2 需求文档 `requirements.md`。
> 追溯链：`US-001~US-008` → 本文档（`FD-talor-desktop-mcp`）→ `IMPL-talor-desktop-mcp`（IMPL-001~011）
> 依赖的 AC：`AC-001-01` ~ `AC-007-04`（共 19 条）

---

<!--
doc-id: FD-talor-desktop-mcp
status: approved
version: 1.0
last-updated: 2026-03-25
depends-on: [OVERVIEW-talor-desktop, REQ-talor-desktop-mcp]
generates: [IMPL-talor-desktop-mcp]
-->

---

## F.1 变更背景

### 关联需求

- US-001: 配置 MCP Server
- US-002: 测试 MCP Server 连接
- US-003: 启用/禁用 MCP Server
- US-004: 删除 MCP Server
- US-005: Agent 调用 MCP 工具
- US-006: 查看 MCP 工具列表
- US-007: 通过标准 MCP 配置导入 Server
- US-008: 通过 UI 管理 MCP Server

### 变更原因

当前 talor-desktop 已实现工具调用能力，但：
1. 工具扩展性差 — 新增工具需修改代码
2. 外部系统集成缺失 — 无法调用 GitHub、Jira 等
3. 社区生态隔离 — 无法使用 MCP 生态工具

通过引入 MCP 支持，扩展 Agent 能力边界。

### 变更范围

1. 新增 `src/main/mcp/` 模块（MCP Client + 配置管理）
2. 新增 `src/renderer/pages/Settings/MCPServerList.tsx`（网格卡片列表）
3. 新增 `src/renderer/pages/Settings/MCPServerForm.tsx`（配置表单）
4. 新增 IPC handlers（mcp:*）
5. 扩展 `toolRegistry` 支持 MCP 工具

---

## F.1.1 Phase 拆分

由于功能复杂，拆分为两个 Phase：

### Phase 6: MCP Server 配置管理

**目标**：用户可配置、管理 MCP Server

**IMPL 任务**：
- IMPL-001: 数据库 mcp_servers 表
- IMPL-002: MCP 配置 IPC 接口（CRUD）
- IMPL-003: MCP 配置存储（config-store）
- IMPL-004: MCPServerList 组件（网格卡片）
- IMPL-005: MCPServerForm 组件（表单）
- IMPL-006: 连接测试功能
- IMPL-007: MCP Config 导入/导出

**AC 覆盖**：AC-001, AC-002, AC-003, AC-004, AC-007, AC-008（19 条）

### Phase 7: MCP 工具集成

**目标**：Agent 可调用 MCP 工具

**IMPL 任务**：
- IMPL-008: MCP Client 核心（STDIO + HTTP 传输）
- IMPL-009: MCP 工具发现与注册
- IMPL-010: 工具调用集成到 toolRegistry
- IMPL-011: 工具列表展示

**AC 覆盖**：AC-005, AC-006

---

## F.2 全局影响

### Schema 变更

**新增配置表（mcp_servers）**：
```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('stdio', 'http')),
  command TEXT,
  args TEXT,
  env TEXT,
  url TEXT,
  auth_type TEXT DEFAULT 'none',
  auth_token TEXT,
  auth_api_key TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
```

**配置文件扩展**：
```json
{
  "mcp": {
    "servers": [...]
  }
}
```

### IPC 接口新增

| 接口 | 方法 | 说明 |
|------|------|------|
| `mcp:servers:list` | invoke | 列出所有 MCP Server |
| `mcp:servers:create` | invoke | 创建 MCP Server |
| `mcp:servers:update` | invoke | 更新 MCP Server |
| `mcp:servers:delete` | invoke | 删除 MCP Server |
| `mcp:servers:test` | invoke | 测试连接 |
| `mcp:tools:list` | invoke | 列出所有工具（含 MCP） |

### 新增模块

| 模块 | 路径 | 职责 |
|------|------|------|
| MCP Client | `src/main/mcp/client.ts` | MCP 协议客户端 |
| STDIO 传输 | `src/main/mcp/transport/stdio.ts` | STDIO 进程通信 |
| HTTP 传输 | `src/main/mcp/transport/http.ts` | HTTP SSE 通信 |
| 配置管理 | `src/main/mcp/config.ts` | Server 配置 CRUD |
| IPC Handlers | `src/main/ipc/mcp.ts` | IPC 通道处理 |

### 技术选型

**MCP Client SDK**：

| 方案 | 优点 | 缺点 |
|------|------|------|
| 官方 `@modelcontextprotocol/sdk` | 协议完整、维护成本低 | ESM only、可能需要构建调整 |
| 自实现 | 完全控制、无依赖 | 工作量大、维护成本高 |

**推荐**：优先使用官方 `@modelcontextprotocol/sdk`，如遇 ESM 兼容问题再考虑自实现 STDIO/HTTP 传输层。

**依赖版本**：
```json
{
  "@modelcontextprotocol/sdk": "^0.5.0"
}
```

---

## F.3 状态机变更

### MCP Server 状态机

```
         ┌──────────┐
         │  未连接   │
         └────┬─────┘
              │ 启用/连接成功
              ▼
    ┌─────────────────┐
    │                 │
┌───▼────┐    ┌─────▼────┐
│ 已连接  │    │  连接中  │
└────────┘    └────┬─────┘
     ▲              │
     │ 禁用/断开    │ 失败
     └──────────────┘
```

### 状态定义

| 状态 | 说明 | 触发条件 |
|------|------|---------|
| `disconnected` | 未连接 | 初始状态/手动断开 |
| `connecting` | 连接中 | 正在建立连接 |
| `connected` | 已连接 | 连接成功 |
| `disabled` | 已禁用 | enabled=false |

---

## F.4 接口协议

### MCP Client 接口

```typescript
interface MCPServerConfig {
  id: string
  name: string
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  auth?: {
    type: 'none' | 'bearer' | 'apiKey'
    token?: string
    apiKey?: string
  }
  enabled: boolean
}

interface MCPToolProvider {
  name: string
  version?: string
  listTools(): Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }>
  execute(
    toolName: string,
    input: unknown,
    context: ToolExecuteContext
  ): Promise<{ content: Array<{ type: string; text?: string }> }>
}
```

### IPC 接口定义

```typescript
// mcp:servers:list
interface MCPServer[]

// mcp:servers:create
interface CreateMCPServerParams {
  name: string
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  auth?: {...}
  enabled?: boolean
}

// mcp:servers:test
interface TestConnectionResult {
  success: boolean
  toolCount?: number
  error?: string
}
```

---

## F.5 并发与幂等要求

### 幂等要求

| 操作 | 幂等键 | 处理方式 |
|------|--------|---------|
| 创建 Server | name | 名称重复则报错 |
| 更新 Server | id | 局部更新，字段覆盖 |
| 删除 Server | id | 重复删除 idempotent |
| 测试连接 | id | 可重复执行 |

### 并发策略

- MCP Server 连接串行执行，不支持并发
- UI 列表刷新需等待连接完成
- 工具调用可并发（继承现有能力）

---

## F.6 涟漪分析

### 下游影响

| 变更内容 | 影响下游 | Breaking? | 迁移步骤 |
|---------|---------|----------|---------|
| 新增 mcp_servers 表 | 数据库 | 是 | 首次启动自动创建 |
| 新增 IPC 接口 | 前端 | 否 | 新增接口无需迁移 |
| 扩展 toolRegistry | 工具调用 | 否 | 向后兼容 |

### 需同步修改

| 模块 | 同步内容 |
|------|---------|
| `OVERVIEW-talor-desktop.md` | 新增 MCP 职责 |
| `toolRegistry` | MCP 工具集成 |

---

## F.7 流程图

### MCP Server 配置流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as 前端
    participant IPC as IPC
    participant MCP as MCP模块
    participant DB as SQLite
    
    U->>FE: 填写配置表单
    FE->>IPC: mcp:servers:create
    IPC->>DB: 保存配置
    DB-->>IPC: 确认
    IPC-->>FE: 创建成功
    FE->>IPC: mcp:servers:test
    IPC->>MCP: 建立连接
    MCP-->>IPC: 工具列表
    IPC-->>FE: 测试成功
```

### 工具调用流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant LLM as LLM
    participant EXE as Executor
    participant REG as toolRegistry
    participant MCP as MCP Client
    
    U->>LLM: 发送消息
    LLM-->>EXE: tool_call(fso_list_directory)
    EXE->>REG: 获取工具定义
    REG-->>EXE: 工具定义
    EXE->>MCP: execute(fso_list_directory, {path: "/tmp"})
    MCP-->>EXE: {content: [...]}
    EXE-->>LLM: 工具结果
    LLM-->>U: 最终回复
```

---

## F.8 AC 验证契约

> **分层断言说明**：
> - `@response` — IPC/HTTP 响应层验证（工具：vitest + ipcMain mock）
> - `@db` — 数据库/存储层验证（工具：vitest + SQLite 直接查询）
> - `@event` — 系统事件/副作用验证（工具：vitest + spy/mock）
> - `@ui` — UI 渲染层验证（工具：Playwright + page assertions）

### F.8.0 验证环境规划

**代码分支**：`feature/mcp` 或现有开发分支

**基础设施依赖**：

| 服务 | 启动方式 | 健康检查 |
|------|---------|---------|
| talor-desktop | `npm run dev` | 页面加载完成 |
| SQLite (mcp_servers) | 自动创建 | 首次启动 |

**AC 数据冲突分析**：

| AC 组 | 冲突风险 | 隔离策略 |
|-------|---------|---------|
| Server CRUD | 名称唯一性 | 每条 AC 使用独立名称 |
| 连接测试 | 端口占用 | 使用不同端口的 mock server |

### F.8.1 Phase 6 验证契约表

#### AC-001-01: 添加 STDIO 模式 MCP Server

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@db` | mcp_servers 表新增记录，type='stdio', name='文件系统' | vitest | SELECT * FROM mcp_servers WHERE name='文件系统' |
| `@response` | IPC mcp:servers:create 返回成功 | vitest | 验证 create 方法返回值 |
| `@ui` | 列表显示"文件系统（STDIO）"卡片 | Playwright | 断言页面包含"文件系统"文本 |

**参数溯源**：name="文件系统", type="stdio", command="npx", args=["-y", "@modelcontextprotocol/server-filesystem", "/Users/quinn/Desktop"]

---

#### AC-001-02: 添加 HTTP 模式 MCP Server

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@db` | mcp_servers 表新增记录，type='http', name='GitHub API' | vitest | SELECT * FROM mcp_servers WHERE name='GitHub API' |
| `@response` | IPC mcp:servers:create 返回成功 | vitest | 验证 create 方法返回值 |
| `@ui` | 列表显示"GitHub API（HTTP）"卡片 | Playwright | 断言页面包含"GitHub API"文本 |

**参数溯源**：name="GitHub API", type="http", url="https://mcp.example.com/github"

---

#### AC-001-03: 编辑 MCP Server 配置

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@db` | mcp_servers 表记录 name 更新为"正式 Server" | vitest | SELECT * FROM mcp_servers WHERE id=? → name='正式 Server' |
| `@response` | IPC mcp:servers:update 返回更新后数据 | vitest | 验证 update 方法返回值 name='正式 Server' |
| `@ui` | 列表显示"正式 Server" | Playwright | 断言页面包含"正式 Server"文本 |

**参数溯源**：原 name="测试 Server", 新 name="正式 Server"

---

#### AC-002-01: STDIO Server 连接测试成功

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@response` | IPC mcp:servers:testConnection 返回 { status: 'success', tools_count: N } | vitest | 验证返回值包含 status='success' |
| `@ui` | 显示"✅ 连接成功，发现 N 个工具" | Playwright | 断言页面包含成功消息 |

**参数溯源**：command="npx", args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

---

#### AC-002-02: HTTP Server 连接测试成功

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@response` | IPC mcp:servers:testConnection 返回 { status: 'success', tools_count: N } | vitest | 验证返回值包含 status='success' |
| `@ui` | 显示"✅ 连接成功，发现 N 个工具" | Playwright | 断言页面包含成功消息 |

**参数溯源**：url="https://mcp.example.com"

---

#### AC-002-03: 连接超时处理

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@response` | IPC mcp:servers:testConnection 返回 { status: 'failure', error_code: 'TIMEOUT' } | vitest | 验证返回值包含 error_code='TIMEOUT' |
| `@ui` | 显示"❌ 连接超时（30秒），请检查 Server 是否运行" | Playwright | 断言页面包含超时错误消息 |

**参数溯源**：配置不存在的地址

---

#### AC-003-01: 禁用 MCP Server

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@db` | mcp_servers 表记录 enabled=0 | vitest | SELECT enabled FROM mcp_servers WHERE id=? → 0 |
| `@response` | IPC mcp:servers:setEnabled 返回更新后数据 | vitest | 验证返回值 enabled=false |
| `@ui` | 显示"已禁用" | Playwright | 断言页面包含"已禁用"文本 |

**参数溯源**：Server 处于"已连接"状态

---

#### AC-003-02: 启用 MCP Server

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@db` | mcp_servers 表记录 enabled=1 | vitest | SELECT enabled FROM mcp_servers WHERE id=? → 1 |
| `@response` | IPC mcp:servers:setEnabled 返回更新后数据 | vitest | 验证返回值 enabled=true |
| `@event` | 触发连接和工具发现事件 | vitest | 验证相关事件被触发 |
| `@ui` | 显示"已连接" | Playwright | 断言页面包含"已连接"文本 |

**参数溯源**：Server 处于"已禁用"状态

---

#### AC-004-01: 删除 MCP Server

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@db` | mcp_servers 表记录删除 | vitest | SELECT * FROM mcp_servers WHERE id=? → null |
| `@response` | IPC mcp:servers:delete 返回成功 | vitest | 验证 delete 方法无错误 |
| `@ui` | 列表中不显示该 Server | Playwright | 断言页面不包含 Server 名称 |

**参数溯源**：已配置 Server，name="测试"

---

#### AC-007-01: 通过 JSON 导入 MCP 配置

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@db` | mcp_servers 表新增记录，name='github', type='http' | vitest | SELECT * FROM mcp_servers WHERE name='github' |
| `@response` | IPC mcp:servers:importConfig 返回 [{ name: 'github', status: 'created' }] | vitest | 验证返回值包含成功项 |
| `@ui` | 列表显示 "github (HTTP)" | Playwright | 断言页面包含 "github" 文本 |

**参数溯源**：JSON 配置 { "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" } }

---

#### AC-007-02: 导入重复名称处理

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@response` | 提示"Server github 已存在，是否覆盖？" | Playwright | 断言页面包含覆盖提示 |
| `@db` | 确认后 mcp_servers 表记录更新 | vitest | SELECT * FROM mcp_servers WHERE name='github' → 更新后数据 |

**参数溯源**：已存在 Server name="github"

---

#### AC-007-03: 导入格式错误处理

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@response` | IPC 返回错误 "配置文件格式错误，请检查 JSON 语法" | vitest | 验证返回值包含错误消息 |
| `@ui` | 显示错误提示 | Playwright | 断言页面包含错误消息 |

**参数溯源**：格式错误的 JSON

---

#### AC-007-04: 导出 MCP 配置

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@response` | IPC mcp:servers:exportConfig 返回 JSON 字符串 | vitest | 验证返回值为有效 JSON |
| `@ui` | 触发文件下载 | Playwright | 断言下载事件被触发 |

**参数溯源**：已配置 2 个 MCP Server

---

#### AC-008-01: MCP 页面空状态

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@ui` | 显示空状态提示"暂无 MCP Server，点击上方按钮添加" | Playwright | 断言页面包含空状态消息 |

**参数溯源**：无配置的全新环境

---

#### AC-008-02: Server 卡片交互

| 层级 | 断言内容 | 验证工具 | 验证指令 |
|------|---------|---------|---------|
| `@ui` | 鼠标悬停时卡片显示阴影效果 | Playwright | 断言卡片 hover 状态 CSS 变化 |

**参数溯源**：存在至少一个 Server

---

## F.9 UI 设计规范

### 页面布局

- 入口：设置页面 → "MCP Server" 标签页
- 布局：3 列网格卡片（响应式：桌面 3/平板 2/手机 1）

### 组件规范

| 组件 | 规范 |
|------|------|
| 网格布局 | Grid 3 列，gap 16px |
| Server 卡片 | 白色背景，圆角 12px，固定宽度 240px |
| 状态指示器 | ● 已连接(绿) / ○ 未连接(灰) / ○ 已禁用(灰) |
| 操作按钮 | [测试] [编辑] [删除] 居中 |

---

## 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| `requirements.md` | v1.0 | 2026-03-25 |
| `OVERVIEW-talor-desktop.md` | v1.3 | 2026-03-22 |
