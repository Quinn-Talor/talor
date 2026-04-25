# Talor Desktop 项目地图

> **长期维护文档**。描述项目**当前的**架构、模块依赖和技术栈。
> 迭代完成后，将 feature.md 中的全局变更合并到本文档及同级文件。
>
> 硬性约束见 `standards.md`。代码模式见 `patterns.md`。全局协议见 `protocols/`。
> 模块现状见 `modules/<module>.md`。
>
> ⚠️ **AI 读取顺序**：本文件（项目地图）→ standards.md（红线）→ 按需加载其他文件

---

## O.1 项目结构

```text
talor-desktop/
├── src/
│   ├── main/                          ← Electron 主进程（Node.js 运行时）
│   │   ├── index.ts                   ← 应用入口，注册所有 IPC handler，初始化 DB、MCP
│   │   ├── db/
│   │   │   └── index.ts               ← SQLite 初始化（initChatDb / getDb / closeChatDb）
│   │   ├── ipc/
│   │   │   ├── chat.ts                ← 消息发送 + ReAct 循环（最核心文件，607 行）
│   │   │   ├── session.ts             ← 会话 CRUD
│   │   │   ├── providers.ts           ← Provider CRUD + 模型发现 + 连接测试
│   │   │   ├── config.ts              ← 应用配置读写
│   │   │   ├── mcp.ts                 ← MCP 服务器管理
│   │   │   ├── tool-confirm.ts        ← 高风险工具确认 IPC handler
│   │   │   ├── fileHandlers.ts        ← 文件选择对话框
│   │   │   └── window.ts              ← 窗口控制
│   │   ├── mcp/
│   │   │   ├── client.ts              ← MCPClientImpl（连接管理 + 工具注册）
│   │   │   ├── transport/
│   │   │   │   ├── stdio.ts           ← 子进程 stdio 通信
│   │   │   │   └── http.ts            ← HTTP JSON-RPC
│   │   │   └── types.ts               ← MCPServerConfig, MCPError
│   │   ├── providers/
│   │   │   └── llm-provider.ts        ← Vercel AI SDK model 工厂（4 个 provider）
│   │   ├── services/
│   │   │   ├── provider-fetcher.ts    ← 模型列表拉取（Ollama /api/tags 等）
│   │   │   ├── capability-detector.ts ← 模型能力自动检测
│   │   │   ├── model-availability.ts  ← 模型可用性检查
│   │   │   ├── provider-tester.ts     ← Provider 连接测试
│   │   │   └── safe-storage.ts        ← API Key 加密存储（electron-store）
│   │   ├── store/
│   │   │   └── config-store.ts        ← ConfigStore 单例（electron-store，持久化到 ~/.talor/config.json）
│   │   ├── repos/
│   │   │   ├── session-repo.ts        ← ChatSession / ChatMessage CRUD（SQLite）
│   │   │   └── mcp-server-repo.ts     ← MCPServer CRUD（SQLite）
│   │   ├── memory/
│   │   │   ├── MemoryManager.ts       ← 短期上下文管理器（协调 ShortTermMemory）
│   │   │   ├── ShortTermMemory.ts     ← 上下文窗口裁剪（recent + summary）
│   │   │   ├── LongTermMemory.ts      ← 长期记忆（待实现）
│   │   │   └── KnowledgeBase.ts       ← 知识库（待实现）
│   │   ├── prompt/
│   │   │   ├── PromptPipeline.ts      ← 插件管道（build → CoreMessage[]）
│   │   │   ├── types.ts               ← PipelineContext, PluginResult, ProviderContextConfig
│   │   │   └── plugins/
│   │   │       ├── SystemPlugin.ts    ← 系统提示词注入
│   │   │       ├── AgentPromptPlugin.ts ← Agent 角色提示词（stub）
│   │   │       ├── MemoryPlugin.ts    ← 历史消息 + 摘要注入
│   │   │       ├── ToolSelectionPlugin.ts ← LLM 动态工具选择
│   │   │       └── UserMessagePlugin.ts   ← 用户消息组装
│   │   └── tools/
│   │       ├── registry.ts            ← ToolRegistry（builtin + MCP 外部工具统一注册）
│   │       ├── builtin/               ← 内置工具（bash / edit / write / read / grep / glob / ls）
│   │       └── types.ts               ← ToolSchema, ToolExecutionContext
│   ├── renderer/                      ← Electron 渲染进程（React 19 + Vite）
│   │   ├── main.tsx                   ← React 入口
│   │   ├── App.tsx                    ← 页面路由（home | chat | settings）
│   │   ├── pages/
│   │   │   ├── Home.tsx               ← 欢迎页
│   │   │   ├── Chat/index.tsx         ← 核心聊天 UI（~400 行）
│   │   │   └── Settings/index.tsx     ← Provider + MCP 配置页
│   │   ├── components/                ← UI 组件（MessageBubble, ToolCallLog, ToolConfirmDialog 等）
│   │   ├── store/
│   │   │   ├── chatStore.ts           ← Zustand：会话、消息、流式状态、工具调用、待确认项
│   │   │   └── configStore.ts         ← Zustand：Provider 列表、加载态、表单模式
│   │   ├── hooks/
│   │   │   └── useStreamingMessage.ts ← 订阅 chat:stream IPC 事件，驱动 Zustand 更新
│   │   ├── api/
│   │   │   └── talorAPI.ts            ← window.talorAPI 类型化包装
│   │   ├── types/                     ← chat.ts / config.ts / models.ts（渲染层类型定义）
│   │   └── lib/                       ← validation.ts / capability-detail.ts
│   ├── preload/
│   │   └── index.ts                   ← contextBridge（暴露 window.talorAPI，353 行）
│   └── shared/
│       └── types/
│           └── message.ts             ← ContentBlock 联合类型，HIGH_RISK_TOOLS，ToolConfirmRequest/Response
├── vibe/
│   └── project/                       ← L1 项目知识库（本目录）
├── out/                               ← 编译产物（自动生成，不纳入版本控制）
├── .talor/                            ← 运行时用户数据（config.json, chat.db）
├── electron.vite.config.ts            ← electron-vite 构建配置
├── electron-builder.yml               ← 打包/发行配置
├── package.json
└── tsconfig*.json                     ← 4 个 TS 配置（base / main / renderer / preload）
```

---

## O.2 模块及依赖

### 服务清单

| 模块 | 职责（一句话） | 实现状态 |
|------|-------------|---------|
| `ipc/chat.ts` | 消息发送、ReAct 循环、工具调用协调、流式转发 | ✅ 已实现 |
| `ipc/session.ts` | 会话生命周期管理（创建/列出/删除/重命名） | ✅ 已实现 |
| `ipc/providers.ts` | Provider CRUD、模型发现、连接测试、能力检测 | ✅ 已实现 |
| `ipc/mcp.ts` | MCP 服务器增删改查、连接管理、工具列举 | ✅ 已实现 |
| `prompt/PromptPipeline.ts` | 插件管道，将上下文 → `CoreMessage[]` + `ToolSchema[]` | ✅ 已实现 |
| `tools/registry.ts` | 工具注册表（builtin + 外部 MCP 工具统一索引） | ✅ 已实现 |
| `tools/builtin/` | 7 个内置工具（bash / edit / write / read / grep / glob / ls） | ✅ 已实现 |
| `mcp/client.ts` | MCP 连接管理（stdio / HTTP），外部工具注册 | ✅ 已实现 |
| `repos/session-repo.ts` | ChatSession + ChatMessage 持久化（SQLite） | ✅ 已实现 |
| `memory/MemoryManager.ts` | 短期上下文裁剪（recent + summary 策略） | ✅ 已实现 |
| `memory/LongTermMemory.ts` | 长期记忆 | 🔲 待实现 |
| `memory/KnowledgeBase.ts` | 知识库 | 🔲 待实现 |
| `store/config-store.ts` | Provider 配置持久化（electron-store） | ✅ 已实现 |
| `renderer/pages/Chat` | 聊天 UI（会话列表 + 消息流 + 工具确认） | ✅ 已实现 |
| `renderer/pages/Settings` | Provider 和 MCP 服务器配置 UI | ✅ 已实现 |

### 用户旅程数据流（关键路径：发送消息并收到 AI 回复）

```
用户在 Chat/index.tsx 的 textarea 输入消息，点击 Send 按钮
  → Chat/index.tsx：调用 talorAPI.chat.send({ sessionId, content, attachments, workspace })
  → preload/index.ts：ipcRenderer.invoke('chat:send', params)
  → ipc/chat.ts：handleChatSend()
      → PromptPipeline.build(ctx)
          → SystemPlugin     → 注入系统提示词
          → AgentPromptPlugin → 注入 Agent 角色（如配置）
          → MemoryPlugin     → ShortTermMemory.getContext() 注入历史消息 + 摘要
          → ToolSelectionPlugin → LLM 动态筛选工具列表
      → streamText({ model, messages, tools, maxSteps: 30 })  [Vercel AI SDK]
          → LLM 返回流式 text chunk → mainWindow.webContents.send('chat:stream', { type:'text', delta })
          → LLM 返回 tool_use     → 执行 ToolRegistry.execute(toolName, input)
                                     高风险工具先 send('chat:tool-confirm') 等待用户确认
          → 工具结果作为 tool_result 注入下一轮，循环最多 30 步
      → 循环结束后持久化 messages（user + assistant + tool）到 SQLite
  → preload onStream callback 触发 → useStreamingMessage hook
  → 更新 chatStore.streamingContent
  → MessageBubble 组件渲染 Markdown，用户看到 AI 回复逐字出现
```

### 模块依赖图

```
renderer (React UI)
    └── preload (contextBridge / TalorAPI)
            └── main process
                    ├── ipc/chat.ts ──→ PromptPipeline ──→ plugins (System/Memory/ToolSelection)
                    │                └──→ streamText() [Vercel AI SDK]
                    │                └──→ ToolRegistry ──→ builtin tools
                    │                                  └──→ MCP client (外部工具)
                    ├── ipc/session.ts ──→ session-repo ──→ SQLite (chat.db)
                    ├── ipc/providers.ts ──→ config-store ──→ electron-store (config.json)
                    │                  └──→ provider-fetcher / llm-provider
                    └── ipc/mcp.ts ──→ mcp/client.ts ──→ transport/stdio | transport/http
```

---

## O.3 技术栈

### 选型

| 层 | 选型 | 说明 |
|----|------|------|
| 语言 | TypeScript 5 (strict) | 全栈统一 |
| 运行时框架 | Electron 34 | 桌面应用宿主（Chromium + Node.js） |
| 构建工具 | electron-vite 3 | main/preload/renderer 三目标并行构建 |
| UI 框架 | React 19 | 渲染进程 |
| 状态管理 | Zustand 5 | 渲染进程全局状态 |
| LLM SDK | Vercel AI SDK 6 (`ai`) | 流式调用、工具调用、多 Provider 抽象 |
| LLM Provider | @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google, ollama-ai-provider-v2 | 4 个 Provider 适配 |
| 数据库 | better-sqlite3 12 | 主进程同步 SQLite（WAL 模式） |
| 配置持久化 | electron-store 10 | Provider 配置 + 窗口状态（JSON 文件） |
| UI 样式 | TailwindCSS 3.4 | 工具类 CSS |
| Markdown | react-markdown + remark-gfm + react-syntax-highlighter | 消息渲染 |
| 日志 | electron-log | 主进程日志 |
| 测试框架 | Vitest | 单元测试 |
| 打包发行 | electron-builder | macOS/Windows 打包 |

### 常用命令

```bash
# 启动开发环境（hot reload）
cd talor-desktop && npm run dev

# 构建
npm run build

# 类型检查（全部）
npm run typecheck

# 测试
npm run test

# 测试（单次运行，CI 模式）
npm run test:run

# Lint（renderer）
npm run lint
```

---

## O.6 架构决策记录（ADR）

| ADR-ID | 决策 | 原因 | 备选方案及放弃原因 | 日期 |
|--------|------|------|-----------------|------|
| ADR-001 | 主进程 fetch → webContents.send() 流式转发（SSE 替代方案） | Electron 架构中 renderer 无法直接 fetch LLM；主进程做流式中转，每个 chunk 通过 IPC 发到渲染进程 | 自定义协议（protocol.handle）— 放弃原因：实现复杂，调试困难 | 2026-03 |
| ADR-002 | ContentBlock[] 序列化为 JSON string 存入 messages.content | 支持多模态消息（text / image / file / tool_use / tool_result）的统一存储，避免多表 | 多字段拆分 — 放弃原因：多模态组合结构变化频繁，拆字段维护成本高 | 2026-03 |
| ADR-003 | better-sqlite3（同步 API）而非 node:sqlite 或 async ORM | 主进程单线程，同步 API 简化事务处理，无死锁风险 | async ORM (Prisma/Drizzle) — 放弃原因：Electron 主进程不需要异步 DB；引入额外运行时依赖 | 2026-03 |
| ADR-004 | Vercel AI SDK streamText() 统一多 Provider 接入 | 屏蔽 Ollama / OpenAI / Anthropic / Google 的 API 差异，工具调用格式统一 | 各 Provider 原生 SDK — 放弃原因：维护 4 套流式实现成本过高 | 2026-03 |
| ADR-005 | HIGH_RISK_TOOLS = ['bash', 'write', 'edit'] 需用户二次确认 | bash/write/edit 有破坏性操作风险（文件删除、系统命令），需要用户审批 | 全部工具都确认 — 放弃原因：频繁确认影响使用体验；read/grep/glob/ls 无副作用 | 2026-03 |
| ADR-006 | PromptPipeline 插件化架构 | 系统提示词构建逻辑复杂（系统 / Agent / 记忆 / 工具选择），插件化便于独立测试和扩展 | 单函数构建 — 放弃原因：chat.ts 已 607 行，继续内联会导致不可维护 | 2026-04 |
| ADR-007 | MCP 工具通过 ToolRegistry 统一注册（与 builtin 同等地位） | 使 ReAct 循环对工具来源透明，统一执行路径 | 分开维护 builtin/mcp 执行路径 — 放弃原因：工具选择逻辑需要统一视图 | 2026-04 |

---

## O.7 环境差异说明

### 配置差异

| 配置项 | 开发（dev） | 生产（prod / 打包后） | 说明 |
|--------|------------|---------------------|------|
| DevTools | 自动打开（`openDevTools()`） | 不打开 | main/index.ts 中 `is.dev` 判断 |
| 远程调试端口 | 9222 | 无 | `--remote-debugging-port=9222` |
| Renderer URL | `http://localhost:5173` | `file://...out/renderer/index.html` | electron-vite 开发服务器 |
| 数据库路径 | `~/.talor/chat.db` | `~/.talor/chat.db` | 始终写入用户 home 目录 |
| 配置文件路径 | `~/.talor/config.json` | `~/.talor/config.json` | electron-store 默认路径 |

### Mock 服务边界

> 目前无 Mock 服务，所有外部依赖均为真实调用。

| 服务 | dev 中的状态 | 说明 |
|------|------------|------|
| LLM Provider（Ollama/OpenAI/Anthropic/Google） | 真实调用 | 需要本地 Ollama 或有效 API Key |
| MCP 外部工具服务器 | 真实连接 | 需要用户手动配置 MCP 服务器 |
