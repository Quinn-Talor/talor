# Talor — 项目架构总览

> 纯 Agent 平台 · Electron + TypeScript 桌面应用 (v0.1.0)

## 定位

Talor 是**纯 agent 运行平台**,自身不含业务 agent。所有业务通过对话沉淀(Crystallizer)由用户产出。

**Agent profile · 极简 8 字段**:`id` / `name` / `description` / `agentPrompt`(磁盘上拆为 sibling `prompt.md`)+ `tools?` / `skills?` / `mcpServers?` / `subagents?`

数据真相归属 Talor 自己:`~/.talor/agents/<id>/` + `~/.talor/skills/<name>/` + SQLite(`chat.db`)。

## 技术栈

| 层     | 技术                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| 前端   | React 19 + Tailwind CSS + Zustand                                                          |
| 模型   | Vercel AI SDK v6(Anthropic / OpenAI / Google / Ollama)                                     |
| 工具   | 7 个内置工具 + MCP 外部工具 + Skill 技能体系                                               |
| 持久化 | better-sqlite3(sessions / messages / mcp_servers / account_keys) + 文件(agents/ + skills/) |
| 桌面   | Electron (sandbox:true + contextIsolation:true)                                            |

---

## 架构分层

```
┌──────────────────────────────────────────────────────────────────────┐
│  Renderer Process (React 19 + Tailwind + Zustand)                    │
│                                                                      │
│  pages/Chat ─→ ToolCallLog (StreamItem 渲染)                          │
│  store/chatStore ─→ streamItems: StreamItem[] (text + tool_call)      │
│  hooks/useStreamingMessage ─→ 消费 IPC 事件                            │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ IPC (contextBridge + ipcRenderer)
┌───────────────────────────┴──────────────────────────────────────────┐
│  Preload (src/preload/index.ts)                                       │
│  暴露 talorAPI 到 window，沙箱模式只开放白名单方法                        │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ IPC (ipcMain)
┌───────────────────────────┴──────────────────────────────────────────┐
│  Main Process (Node.js)                                               │
│                                                                      │
│  ┌─ 入口层 (ipc/) ───────────────────────────────────────────────┐    │
│  │  chat.ts · session.ts · providers.ts · mcp.ts · permission.ts │    │
│  │  职责：IPC handler 注册 + snake/camel 转换 + 回调桥接            │    │
│  └──────────────────────────┬────────────────────────────────────┘    │
│                             │                                        │
│  ┌─ 业务层 ─────────────────┴────────────────────────────────────┐    │
│  │                                                               │    │
│  │  chat/orchestrator ─→ 编排 8 步流程                             │    │
│  │       ↓                                                       │    │
│  │  prompt/PromptPipeline ─→ 5 插件链构建 prompt                    │    │
│  │       ↓                                                       │    │
│  │  loop/react-loop ─→ ReAct 多步推理引擎                           │    │
│  │       ↓                                                       │    │
│  │  tools/build-tools ─→ 工具装配 (dynamicTool 包装)                │    │
│  │       ↓                                                       │    │
│  │  agent/tool-registry ─→ 工具执行 (builtin + MCP + skill)        │    │
│  │                                                               │    │
│  │  memory/ShortTermMemory ─→ 上下文压缩 + 锚点保留                  │    │
│  │  providers/model-adapter ─→ 4 个 Provider 适配器                 │    │
│  │  permissions/port ─→ 权限规则匹配 + UI 授权                      │    │
│  │  skills/registry ─→ Skill 注册 + 激活追踪                        │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─ 基础设施层 ──────────────────────────────────────────────────┐    │
│  │  repos/session-repo ─→ Session/Message CRUD                   │    │
│  │  db/index ─→ SQLite 初始化 + schema 迁移                       │    │
│  │  store/config-store ─→ electron-store 配置                     │    │
│  │  services/safe-storage ─→ OS keychain API key 加密              │    │
│  └───────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

**分层依赖方向**：`ipc → 业务层 → 基础设施`，反向不允许。

---

## 核心调用链路：从用户输入到最终输出

```
用户发送消息
  │
  ├─[1] IPC: chat:send handler (ipc/chat.ts)
  │     snake_case → camelCase 转换
  │
  ├─[2] 编排: orchestrator.sendChat()
  │     ├── 校验内容 + 附件
  │     ├── 注册 stream（AbortController）
  │     ├── 解析 Provider + Model（通过 session.provider_id 查找）
  │     ├── 获取 Agent（通过 session.agent_id 查找）
  │     ├── 持久化 user 消息（SDK UserContent 格式直接存 DB）
  │     └── 启动 ReAct 循环
  │
  ├─[3] ReAct Loop: runReactLoop() ── 最多 1000 步
  │     │
  │     ├─ 每步 runReactStep():
  │     │   │
  │     │   ├── [3.1] Prompt 构建: pipeline.build()
  │     │   │     ├── SystemPlugin ─→ 行为宪法（11 条原则）+ 决策路由表
  │     │   │     ├── AgentPromptPlugin ─→ Agent 角色 + 知识索引 + Skill 列表
  │     │   │     ├── MemoryPlugin ─→ 历史消息（<90% 全量 / >90% 压缩摘要+锚点）
  │     │   │     ├── MessagePlugin ─→ 当前 turn 消息
  │     │   │     └── ToolSelectionPlugin ─→ 工具筛选（>50 时 LLM 精选）
  │     │   │
  │     │   ├── [3.2] Context 预算检查
  │     │   │     ≥100% → 硬阻断（[auto-halt]）
  │     │   │     >98% → 软告警（[CONTEXT NEARLY FULL]）
  │     │   │
  │     │   ├── [3.3] 工具装配: buildTools()
  │     │   │     每个工具包装为 AI SDK dynamicTool
  │     │   │     HIGH_RISK 工具 → confirmTool() UI 弹窗确认
  │     │   │
  │     │   ├── [3.4] 模型调用: streamText()
  │     │   │     通过 ModelAdapter 创建的 LanguageModel 实例
  │     │   │     流式回调: text-delta / reasoning-delta / tool-call / tool-result
  │     │   │
  │     │   ├── [3.5] 落盘（SDK 原生格式）
  │     │   │     无工具 + 有文本 → assistant(text) [FINAL]
  │     │   │     有工具 → assistant(reasoning + text + tool-call) + tool(tool-result) [batch]
  │     │   │
  │     │   └── [3.6] 死循环检测
  │     │         签名重复（inputHash + outputHash）
  │     │         连续失败（3 步全部 tool error）
  │     │         空文本循环（8 步只有 tool call 无文本）
  │     │
  │     └─ 兜底摘要: runFallbackSummary()
  │           整轮无文本输出时强制一次无工具 streamText
  │           引用验证: verifyQuotedFacts() 标记不可验证内容
  │
  ├─[4] IPC 回调: callbacks.onDone()
  │     webContents.send('chat:stream', { done: true })
  │
  └─[5] 前端渲染
        Zustand store 接收事件 → streamItems 更新
        ToolCallLog 按 step 分组渲染 text + tool
        完成后 commitStreaming() 清空 → 持久化消息渲染
```

---

## 组件职责说明

### 入口层

| 组件          | 文件               | 职责                                                         |
| ------------- | ------------------ | ------------------------------------------------------------ |
| Chat IPC      | `ipc/chat.ts`      | 注册 `chat:send`/`chat:abort`，回调桥接到 `webContents.send` |
| Session IPC   | `ipc/session.ts`   | Session CRUD + 模型/Provider 切换                            |
| Providers IPC | `ipc/providers.ts` | Provider CRUD + 模型列表 + 连接测试                          |

### 业务层 — 编排

| 组件              | 文件                        | 职责                                                           |
| ----------------- | --------------------------- | -------------------------------------------------------------- |
| Orchestrator      | `chat/orchestrator.ts`      | 8 步编排：校验→Provider→持久化→ReAct→Done。单一错误出口 onDone |
| Provider Selector | `chat/provider-selector.ts` | 按 ID 查 Provider / 取默认 Provider                            |
| Stream Registry   | `chat/stream-registry.ts`   | 同 session AbortController 管理，新请求 abort 旧的             |
| Event Bus         | `chat/events.ts`            | Per-execution 事件总线（当前仅 `memory.compressed`）           |

### 业务层 — Prompt 构建

| 组件                | 文件                                    | 职责                                                    |
| ------------------- | --------------------------------------- | ------------------------------------------------------- |
| PromptPipeline      | `prompt/PromptPipeline.ts`              | 5 插件链顺序执行，关键插件失败抛出，非关键降级          |
| SystemPlugin        | `prompt/plugins/SystemPlugin.ts`        | Layer 1 行为宪法（11 条）+ Layer 2 决策路由表           |
| AgentPromptPlugin   | `prompt/plugins/AgentPromptPlugin.ts`   | Layer 3-4 Agent 角色 + 知识索引 + Skill 列表 + few-shot |
| MemoryPlugin        | `prompt/plugins/MemoryPlugin.ts`        | Layer 6 历史消息（委托 ShortTermMemory）                |
| MessagePlugin       | `prompt/plugins/MessagePlugin.ts`       | Layer 7 当前 turn 消息（Memory pop 后放回）             |
| ToolSelectionPlugin | `prompt/plugins/ToolSelectionPlugin.ts` | >50 工具时 LLM 精选 + 降级通知                          |

### 业务层 — 推理引擎

| 组件           | 文件                     | 职责                                               |
| -------------- | ------------------------ | -------------------------------------------------- |
| ReAct Loop     | `loop/react-loop.ts`     | 多步推理循环：prompt→stream→persist→检测→继续/停止 |
| Stream Utils   | `loop/stream-utils.ts`   | 输出截断、错误检测、XML 包装、超时信号             |
| Quote Verifier | `loop/quote-verifier.ts` | 兜底摘要引用验证，标记 ⟨unverifiable⟩              |

### 业务层 — 工具系统

| 组件          | 文件                   | 职责                                                    |
| ------------- | ---------------------- | ------------------------------------------------------- |
| Build Tools   | `tools/build-tools.ts` | ToolMetadata → AI SDK dynamicTool 包装 + HIGH_RISK 确认 |
| Tool Registry | `tools/registry.ts`    | 4 阶段执行管线：Zod 校验→业务校验→execute→verify        |
| Path Guard    | `tools/path-guard.ts`  | resolveToolPath 3 态：allowed/sensitive/needs_consent   |
| Builtin Tools | `tools/builtin/*.ts`   | bash / read / write / edit / glob / grep / ls           |

### 业务层 — Agent 系统

| 组件               | 文件                     | 职责                                                      |
| ------------------ | ------------------------ | --------------------------------------------------------- |
| Agent              | `agent/agent.ts`         | 不可变 Agent 实例：profile + toolRegistry + skillRegistry |
| Agent ToolRegistry | `agent/tool-registry.ts` | 3 源合并 + 白名单过滤（ALWAYS_AVAILABLE 绕过）            |
| Agent Manager      | `agent/agent-manager.ts` | 平台 Agent（**chat**）+ 业务 Agent 生命周期管理           |

### 业务层 — 记忆系统

| 组件            | 文件                        | 职责                                                    |
| --------------- | --------------------------- | ------------------------------------------------------- |
| ShortTermMemory | `memory/ShortTermMemory.ts` | Path A 全量 / Path B 压缩（摘要+锚点），失败冷却机制    |
| Memory Types    | `memory/types.ts`           | dbToModelMessages（透传 + tool guide 注入）、token 估算 |
| Memory Manager  | `memory/MemoryManager.ts`   | ShortTermMemory 的外壳                                  |

### 业务层 — Provider 适配

| 组件              | 文件                                      | 职责                                                     |
| ----------------- | ----------------------------------------- | -------------------------------------------------------- |
| Model Adapter     | `providers/model-adapter.ts`              | getAdapter() 工厂 → 4 个适配器                           |
| OpenAI Adapter    | `providers/adapters/openai-adapter.ts`    | `.chat()` 强制 Chat Completions + DeepSeek thinking 禁用 |
| Anthropic Adapter | `providers/adapters/anthropic-adapter.ts` | createAnthropic + x-api-key 认证                         |
| Google Adapter    | `providers/adapters/google-adapter.ts`    | createGoogleGenerativeAI                                 |
| Ollama Adapter    | `providers/adapters/ollama-adapter.ts`    | createOllama + `/api/tags` 模型列表                      |

### 基础设施层

| 组件         | 文件                       | 职责                                        |
| ------------ | -------------------------- | ------------------------------------------- |
| Session Repo | `repos/session-repo.ts`    | Session/Message CRUD + createBatch 原子落盘 |
| DB           | `db/index.ts`              | SQLite 初始化 + WAL + schema 迁移           |
| Config Store | `store/config-store.ts`    | electron-store Provider/Config 配置         |
| Safe Storage | `services/safe-storage.ts` | OS keychain API key 加密存储                |

### 前端

| 组件                | 文件                                      | 职责                                           |
| ------------------- | ----------------------------------------- | ---------------------------------------------- |
| Chat Store          | `renderer/store/chatStore.ts`             | StreamItem[] 统一模型（text + tool_call 交错） |
| useStreamingMessage | `renderer/hooks/useStreamingMessage.ts`   | IPC 事件 → store mutations                     |
| ToolCallLog         | `renderer/components/ToolCallLog.tsx`     | Streaming 态按 step 分组渲染 text + tools      |
| ToolCallMessage     | `renderer/components/ToolCallMessage.tsx` | 持久化态工具行渲染                             |
| MessageBubble       | `renderer/components/MessageBubble.tsx`   | Markdown 渲染 + 代码高亮 + 附件                |

---

## 消息存储格式

DB 直接存储 AI SDK `ModelMessage` 原生格式，零中间转换：

```
SDK response → JSON.stringify → DB (messages.content) → JSON.parse → SDK (直传)
```

| role      | content 格式                                                              |
| --------- | ------------------------------------------------------------------------- |
| system    | `string`（纯文本）                                                        |
| user      | `UserContent`（TextPart / FilePart / ImagePart 数组，纯文本时为 string）  |
| assistant | `AssistantContent`（TextPart / ReasoningPart / ToolCallPart 数组）        |
| tool      | `ToolContent`（ToolResultPart 数组，output 为 `{ type: 'text', value }`） |

唯一的动态处理：`dbToModelMessages()` 在 rebuild prompt 时为 tool-result 注入结构化指引（guide），帮助模型理解工具输出。

---

## 关键设计决策

| 决策                | 原因                                                 |
| ------------------- | ---------------------------------------------------- |
| 消息格式对齐 SDK    | 零转换损耗，reasoning/providerOptions 自动保留       |
| Provider 适配层     | 屏蔽 baseURL/apiKey/API 模式差异，Talor 内部稳定     |
| 5 插件 prompt 管线  | 关键插件必须成功，非关键降级 + 通知                  |
| 事务化消息落盘      | assistant(tool_use) + tool(result) 配对不变量        |
| 工具 4 阶段执行     | Zod 校验→业务校验→执行→输出验证                      |
| 死循环 3 路检测     | 签名重复 + 连续失败 + 空文本循环                     |
| 记忆压缩 + 锚点     | 90% 阈值压缩，最近 4 条 tool 保留原文                |
| StreamItem 统一模型 | text + tool_call 按 step 交错，解决文本/工具分离问题 |
