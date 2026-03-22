<!--
doc-id: OVERVIEW
status: draft
version: 1.0
last-updated: 2026-03-22
-->

# OVERVIEW — Talor AI 数字员工平台

> Talor 项目级现状文档。包含技术栈、模块架构、全局协议、Patterns、ADR。
> 本文档是所有 AI agent 工作的起点，每次会话开始前必须阅读。

---

## §O.1 项目结构

```
talor/                        # Python 后端（FastAPI + LiteLLM + SQLite）
├── src/
│   ├── agent/                # 数字员工核心模型（agent.py、executor.py）
│   ├── api/                  # HTTP 路由层
│   │   ├── routes/           # API 端点（agents、sessions、prompt）
│   │   ├── models.py         # Pydantic 模型
│   │   └── app.py            # FastAPI 入口
│   ├── core/                 # 基础设施（storage.py、config.py）
│   ├── skill/                # 技能系统
│   ├── tool/builtin/         # 内置工具（bash、read、write...）
│   ├── provider/             # LLM Provider 抽象层（LiteLLM）
│   ├── session/              # 会话管理
│   ├── mcp_client/           # MCP 协议客户端
│   └── bus/                  # 事件总线（SSE）
├── tests/                    # 镜像 src/ 结构
└── config.json               # 运行时配置

talor-gui/                    # React 19 桌面前端（Legacy）
├── src/
│   ├── components/           # UI 组件
│   ├── store/                # Zustand 状态
│   └── api/                  # 后端 API 客户端

talor-desktop/                # Electron 桌面客户端（当前开发重点）
├── src/
│   ├── main/                 # Electron 主进程（Node.js）
│   ├── preload/              # contextBridge 暴露 API
│   └── renderer/              # React 前端（ESM）
├── package.json              # Vercel AI SDK + better-sqlite3

employees/                    # 数字员工定义（JSONC）
├── *.jsonc                   # 员工契约文件
└── manuals/*.md              # 领域知识手册
```

---

## §O.2 模块及依赖

### 服务清单

| 模块 | 技术栈 | 职责 | 启动命令 |
|------|--------|------|----------|
| talor | FastAPI + LiteLLM + SQLite | Agent 执行引擎、API 服务 | `cd talor && uvicorn src.api.app:app --reload` |
| talor-gui | React 19 + Zustand | Web UI（旧版，不推荐） | `cd talor-gui && npm run dev` |
| talor-desktop | Electron + Vercel AI SDK | 桌面客户端（SSE 流式） | `cd talor-desktop && npm run dev` |
| employees | JSONC | 数字员工定义 | 无需启动，运行时加载 |

### 用户旅程数据流

```
用户打开 talor-desktop
  → 选择数字员工（employees/*.jsonc）
  → 发起对话
  → talor-desktop 通过 SSE 与后端通信
  → 后端加载员工契约 → ReAct 执行 → 工具调用 → 返回结果
```

### 模块依赖图

```
talor-desktop (Electron)
    │
    ├── SSE ──► talor (FastAPI)
    │
    └── IPC ──► 本地 SQLite (chat.db)

talor (Python)
    │
    ├── LiteLLM ──► Ollama / OpenAI / Anthropic / Google
    │
    └── SQLite (sessions, messages)
    
employees/*.jsonc ──► talor (运行时加载)
```

---

## §O.3 技术栈

### 后端（talor）

| 组件 | 技术选型 | 版本 |
|------|---------|------|
| 运行时 | Python | 3.11+ |
| Web 框架 | FastAPI | ^0.109 |
| LLM 抽象 | LiteLLM | ^1.30 |
| 数据库 | SQLite | 内置 |
| 异步 | asyncio + pytest-asyncio | — |
| 类型检查 | mypy | — |
| 代码风格 | black + ruff | — |

### 前端（旧版 talor-gui）

| 组件 | 技术选型 | 版本 |
|------|---------|------|
| 框架 | React | ^19.0.0 |
| 状态管理 | Zustand | ^5.0.3 |
| 构建 | Vite | ^6.0.0 |
| 语言 | TypeScript | ^5.0.0 |

### 桌面客户端（talor-desktop）⚡ 当前开发重点

| 组件 | 技术选型 | 版本 |
|------|---------|------|
| 运行时 | Electron | ^34.2.0 |
| 前端框架 | React | ^19.0.0 |
| 状态管理 | Zustand | ^5.0.3 |
| 构建工具 | electron-vite | ^3.0.0 |
| LLM SDK | Vercel AI SDK (`ai`) | ^6.0.134 |
| 数据库 | better-sqlite3 | ^12.8.0 |
| 持久化 | electron-store | ^10.0.0 |
| 加密 | Electron safeStorage | 内置 |

### 数字员工定义

| 组件 | 技术选型 |
|------|---------|
| 格式 | JSONC（注释 JSON） |
| 路径 | `employees/*.jsonc` |
| 手册 | `manuals/*.md`（可选） |

---

## §O.4 全局协议

### API 端点（talor 后端）

```
GET  /api/agents                          # 列表（?kind=worker|platform）
GET  /api/agents/{id}                     # 详情
GET  /api/agents/{id}/system-prompt       # 业务员工系统提示词

POST /api/sessions                        # 创建会话
GET  /api/sessions                        # 列表
DELETE /api/sessions/{id}                 # 删除

POST /api/session/prompt/async            # 异步发消息
POST /api/session/prompt                  # 同步发消息（SSE）
GET  /event?session_id=                   # SSE 实时事件流
```

### SSE 事件类型

`session.created` → `message.created` → `agent.started` → `stream.text`（多次）→ `message.updated` → `agent.completed` → `stream.done`

### Provider 配置格式

```
模型字符串：provider_id/model_id
  ollama/qwen3:4b
  anthropic/claude-sonnet-4-20250514
  openai/gpt-4o

LiteLLM 路由：
  ollama/*  → ollama_chat/{model_id}，api_base = http://localhost:11434
  openai/*  → openai/{model_id}
  anthropic/* → anthropic/{model_id}
  google/*  → gemini/{model_id}
```

### IPC 通道（talor-desktop）

| 通道 | 参数 | 返回值 |
|------|------|--------|
| config:get | - | AppConfig |
| config:save | Partial<AppConfig> | void |
| providers:list | - | Provider[] |
| providers:create | ProviderInput | Provider |
| providers:update | id, ProviderInput | Provider |
| providers:delete | id | void |
| providers:setDefault | id | void |
| providers:testConnection | {type, base_url, api_key?} | ConnectionTestResult |
| session:list | - | ChatSession[] |
| session:create | {provider_id, model_id?, title?} | ChatSession |
| session:delete | id | void |
| session:rename | id, title | ChatSession |
| session:getMessages | session_id | ChatMessage[] |
| chat:send | {session_id, content, attachments?} | SSE 流式 |

---

## §O.5 全局规范

### 禁止事项

| 禁止 | 原因 | 正确做法 |
|------|------|---------|
| 修改 venv/ 目录 | Python 虚拟环境，不纳入版本控制 | 不动此目录 |
| 删除/重命名 SQLite 表字段 | 需单独迁移脚本 | 用 ALTER TABLE 新增 |
| 升级 major 版本依赖 | 需单独评估影响 | 小心评估后进行 |
| 直接修改 employees/ 示例文件 | 作为参考模板保留 | 复制后修改 |
| talor-desktop contextIsolation=false | 安全风险 | 必须 true |
| talor-desktop nodeIntegration=true | 安全风险 | 必须 false |
| API Key 明文存储 | 凭证泄露风险 | 用 safeStorage 加密 |

### 遵守事项

| 遵守 | 说明 |
|------|------|
| TDD 工作流 | 写失败测试 → 最小实现 → 重构 |
| 每次改完必跑 typecheck | mypy（后端）/ tsc（前端） |
| 使用已有 Pattern | 参考 overview patterns 表 |
| config.json 原子写入 | 先写 .tmp 再 rename |

### 代码分层规则

```
talor (Python):
  routes/     → 只做参数验证 + 调用业务逻辑
  agent/      → 核心模型和执行器
  core/       → 基础设施（storage, config）
  tool/       → 工具定义和执行

talor-desktop (Electron):
  main/       → 主进程，所有磁盘和网络操作
  preload/   → contextBridge 暴露 API
  renderer/  → React UI，只做展示和输入
```

---

## §O.6 ADR（架构决策）

| ADR-ID | 决策 | 原因 | 备选方案及放弃原因 |
|--------|------|------|-----------------|
| ADR-001 | Electron + React 19 + TypeScript + Zustand | 成熟生态、跨平台、TypeScript 一致性高 | Tauri：Rust 学习成本高 |
| ADR-002 | talor-desktop main process 封装所有 fs/network 操作 | 安全性：renderer 不可直接访问 | contextIsolation=false：安全风险高 |
| ADR-003 | API Key 使用 Electron safeStorage 加密 | OS 级加密，安全性最高 | electron-store 加密：密钥明文存储 |
| ADR-004 | Provider 配置以 UUID 为唯一键 | 唯一性由系统保证，用户可自由命名 | name 唯一：用户命名受限 |
| ADR-005 | 配置文件存放在 ~/.talor/ | 符合 Unix 惯例 | 工作目录：平台差异大 |
| ADR-006 | 使用 Vercel AI SDK 作为 LLM 集成层 | 统一 streamText API，支持多 Provider | 直接 fetch：需处理 Provider 差异 |
| ADR-007 | SSE 流式：main fetch → webContents.send() → renderer rAF | Electron 安全模型限制，main 持有 AbortController | EventSource：无法自定义 headers |
| ADR-008 | 会话使用 SQLite (better-sqlite3) 持久化 | 结构化查询优于 JSON，支持并发 | electron-store：消息量大性能差 |
| ADR-009 | 流式状态下禁止重复发送 | 防止 SSE 乱序和 LLM 请求重复 | 无保护：消息顺序错乱 |
| ADR-010 | Agent 两层架构（平台员工 + 业务员工） | 灵活切换通用执行和专业化员工 | 单一 agent：灵活性差 |
| ADR-011 | 技能系统基于 prompt 匹配 | 动态技能选择，无需硬编码 | 硬编码：扩展性差 |

---

## §O.7 环境差异

| 配置项 | dev | staging | prod |
|--------|-----|---------|------|
| talor config_dir | `~/.talor/` | `~/.talor/` | `~/.talor/` |
| talor-desktop config_dir | `~/.talor/` | `~/.talor/` | `~/.talor/` |
| 窗口默认尺寸 | 1200x800 | 1200x800 | 1200x800 |
| 日志级别 (electron-log) | debug | info | error |
| 日志级别 (Python) | DEBUG | INFO | ERROR |
| LLM 超时 | 5000ms | 5000ms | 5000ms |
| safeStorage | 始终可用 | 始终可用 | 始终可用 |

---

## §O.8 Patterns 索引

### talor-desktop（Electron）

| Pattern | 使用场景 | 实现位置 |
|---------|---------|---------|
| IPC Bridge | renderer 通过 preload 与 main 通信 | `src/preload/index.ts` → `window.talorAPI` |
| Config Store Singleton | electron-store 单例 + 原子写入 | `src/main/store/config-store.ts` |
| SafeStorage Encryption | API Key OS 级加密 | `src/main/services/safe-storage.ts` |
| Provider Tester | 按 type 构造测试请求 | `src/main/services/provider-tester.ts` |
| Zustand Config Store | renderer 配置状态管理 | `src/renderer/store/configStore.ts` |
| Lazy talorAPI Proxy | Proxy 懒加载防止 preload 时序问题 | `src/renderer/api/talorAPI.ts` |
| SQLite Session Repo | 会话/消息 CRUD，WAL 模式 | `src/main/repos/session-repo.ts` |
| Vercel AI SDK Wrapper | 统一 LLM 调用 + 流式 | `src/main/providers/llm-provider.ts` |
| SSE Stream Push | main fetch → webContents.send() | `src/main/ipc/chat.ts` |
| Zustand Chat Store | 流式状态管理 | `src/renderer/store/chatStore.ts` |
| useStreamingMessage Hook | SSE 流式 Hook | `src/renderer/hooks/useStreamingMessage.ts` |

### talor（Python 后端）

| Pattern | 使用场景 | 实现位置 |
|---------|---------|---------|
| FastAPI Route Handler | 参数验证 + 业务逻辑 | `src/api/routes/agents.py` |
| ReAct Executor | Reason-Act 循环执行 | `src/agent/executor.py` |
| Event Bus | SSE 事件分发 | `src/bus/__init__.py` |
| Tool Registry | 工具注册和执行 | `src/tool/registry.py` |
| Skill Matcher | 技能匹配 | `src/skill/matcher.py` |
| LiteLLM Provider | 多 LLM 统一调用 | `src/provider/provider.py` |
| SQLite Storage | 数据库查询封装 | `src/core/storage.py` |

---

## §O.9 关键路径（从用户操作到结果）

### talor-desktop 发送消息流程

```
用户输入消息 → 点击发送
  → chatStore.sendMessage() 调用 talorAPI.chat.send()
    → IPC invoke 'chat:send' 传递到 main process
      → ipc/chat.ts handler 调用 LLMProvider.streamText()
        → Vercel AI SDK 调用 LLM API
          → 通过 webContents.send() 推送每个 chunk
            → renderer useStreamingMessage hook 接收
              → 更新 chatStore.streamState 为 'streaming'
              → 追加到 pendingMessage.content
                → MessageBubble 渲染打字机效果
```

---

## §O.10 Phase 边界

### 已完成

**Phase 1**（2026-03-21）：
- talor-desktop 桌面客户端框架
- Provider CRUD（list/create/update/delete/setDefault）
- 连接测试服务
- API Key safeStorage 加密

**Phase 2**（2026-03-22）：
- Phase 2.1：流式对话 MVP（打字机 + 中断）✅
- Phase 2.2：错误处理 + Markdown 渲染 ✅

### 待开发

**Phase 2.3**：
- 消息附件功能（文件选择 + 拖拽 + Base64 + 多模态 LLM）

**Phase 3**：
- Tool 调用 + 数字员工契约
- employees/*.jsonc 加载和解析
- Agent 执行引擎集成