# Talor 项目详细说明文档

## 目录

1. [项目概述](#项目概述)
2. [技术栈](#技术栈)
3. [项目架构](#项目架构)
4. [核心模块详解](#核心模块详解)
5. [主要流程](#主要流程)
6. [API 接口](#api-接口)
7. [事件系统](#事件系统)
8. [配置系统](#配置系统)
9. [开发指南](#开发指南)
10. [部署说明](#部署说明)

---

## 项目概述

### 项目简介

**Talor** 是一个基于 ReAct (Reasoning + Acting) 架构的通用 AI Agent 框架。它通过推理/规划、工具调用、结果观察的循环，智能处理用户诉求并交付结果。支持多种 LLM 提供商，集成了 MCP (Model Context Protocol) 协议，并提供了现代化的 Web GUI 界面。

### 核心特性

- **ReAct 架构**：显式的推理-行动-观察循环
- **事件驱动架构**：基于事件总线的松耦合设计
- **多提供商支持**：支持 OpenAI、Anthropic、Google AI、Ollama 等多个 LLM 提供商
- **MCP 集成**：完整的 Model Context Protocol 支持
- **工具系统**：统一的工具定义和执行框架
- **记忆系统**：短期/长期记忆管理
- **会话管理**：基于消息的对话管理系统
- **权限控制**：细粒度的工具权限管理
- **现代化 GUI**：基于 React + TypeScript 的 Web 界面
- **实时通信**：支持 SSE (Server-Sent Events) 的实时事件流

### 项目结构

```
talor/                      # 项目根目录
├── talor/                  # 后端 Python 项目
│   ├── src/               # 源代码目录
│   │   └── talor/         # Talor 包
│   │       ├── agent/     # Agent 管理模块
│   │       ├── api/       # FastAPI REST API
│   │       ├── bus/       # 事件总线系统
│   │       ├── cli/       # 命令行接口
│   │       ├── config/    # 配置管理
│   │       ├── core/      # 核心功能
│   │       ├── mcp/       # MCP 协议集成
│   │       ├── provider/  # LLM 提供商
│   │       ├── session/   # 会话管理
│   │       └── tool/      # 工具系统
│   ├── tests/             # 测试文件
│   ├── venv/              # Python 虚拟环境
│   ├── config.example.yaml # 配置文件示例
│   ├── pyproject.toml     # Python 项目配置
│   ├── requirements.txt   # 依赖列表
│   ├── Makefile           # 构建脚本
│   ├── Dockerfile         # Docker 镜像定义
│   ├── docker-compose.yml # Docker 编排配置
│   └── talor.spec         # PyInstaller 打包配置
├── talor-gui/             # 前端 React 应用
│   ├── src/
│   │   ├── api/           # API 客户端
│   │   ├── components/    # React 组件
│   │   ├── hooks/         # 自定义 Hooks
│   │   ├── pages/         # 页面组件
│   │   ├── store/         # Zustand 状态管理
│   │   ├── types/         # TypeScript 类型定义
│   │   └── utils/         # 工具函数
│   ├── public/            # 静态资源
│   ├── dist/              # 构建输出
│   ├── package.json       # NPM 项目配置
│   ├── vite.config.ts     # Vite 配置
│   ├── tsconfig.json      # TypeScript 配置
│   └── eslint.config.js   # ESLint 配置
└── PROJECT_DOCUMENTATION.md # 项目文档
```


---

## 技术栈

### 后端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Python | ≥3.11 | 主要编程语言 |
| FastAPI | ≥0.109.0 | Web 框架和 REST API |
| Pydantic | ≥2.6.0 | 数据验证和序列化 |
| LiteLLM | ≥1.30.0 | 统一的 LLM 接口 |
| FastMCP | ≥2.0.0 | MCP 协议实现 |
| Uvicorn | ≥0.27.0 | ASGI 服务器 |
| aiosqlite | ≥0.19.0 | 异步 SQLite 数据库 |
| structlog | ≥24.1.0 | 结构化日志 |
| websockets | ≥12.0 | WebSocket 支持 |
| Click | ≥8.1.7 | CLI 框架 |

### 前端技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | ^19.2.0 | UI 框架 |
| TypeScript | ~5.9.3 | 类型安全 |
| Vite | ^7.2.4 | 构建工具 |
| Zustand | ^5.0.10 | 状态管理 |
| React Router | ^7.13.0 | 路由管理 |
| TailwindCSS | ^4.1.18 | CSS 框架 |
| i18next | ^25.8.0 | 国际化 |
| React Markdown | ^10.1.0 | Markdown 渲染 |
| Shiki | ^3.22.0 | 代码高亮 |
| Vitest | ^4.0.18 | 测试框架 |

### 开发工具

- **代码质量**：Black (格式化)、Ruff (Linting)、MyPy (类型检查)
- **测试**：Pytest、Hypothesis (属性测试)
- **文档**：MkDocs、MkDocs Material
- **构建**：PyInstaller (可执行文件)、Docker


---

## 项目架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        Talor GUI (React)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Pages      │  │  Components  │  │    Stores    │      │
│  │  - HomePage  │  │  - Chat      │  │  - Session   │      │
│  │  - Settings  │  │  - Session   │  │  - Settings  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                    ┌───────▼────────┐                        │
│                    │   API Client   │                        │
│                    │  - HTTP/REST   │                        │
│                    │  - SSE Events  │                        │
│                    └───────┬────────┘                        │
└────────────────────────────┼──────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │   Network       │
                    │   HTTP/SSE      │
                    └────────┬────────┘
                             │
┌────────────────────────────▼──────────────────────────────────┐
│                    Talor Backend (Python)                     │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              FastAPI REST API                        │    │
│  │  /api/sessions  /api/agents  /api/config  /event    │    │
│  └──────────────────────┬───────────────────────────────┘    │
│                         │                                     │
│  ┌──────────────────────▼───────────────────────────────┐    │
│  │                  Event Bus (Bus)                     │    │
│  │  - Publish/Subscribe Pattern                         │    │
│  │  - Typed Events with Pydantic                        │    │
│  └──────────────────────┬───────────────────────────────┘    │
│                         │                                     │
│  ┌──────────┬───────────┼───────────┬──────────┬────────┐    │
│  │          │           │           │          │        │    │
│  ▼          ▼           ▼           ▼          ▼        ▼    │
│ ┌────┐  ┌────────┐  ┌────────┐  ┌──────┐  ┌──────┐ ┌─────┐ │
│ │Sess│  │ Agent  │  │Provider│  │ Tool │  │ MCP  │ │Conf │ │
│ │ion │  │        │  │        │  │      │  │      │ │ig   │ │
│ └────┘  └────────┘  └────────┘  └──────┘  └──────┘ └─────┘ │
│    │         │           │          │         │        │     │
│    └─────────┴───────────┴──────────┴─────────┴────────┘     │
│                         │                                     │
│                    ┌────▼─────┐                               │
│                    │ Storage  │                               │
│                    │ (SQLite) │                               │
│                    └──────────┘                               │
└───────────────────────────────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  External LLMs  │
                    │  - OpenAI       │
                    │  - Anthropic    │
                    │  - Ollama       │
                    └─────────────────┘
```

### 架构设计原则

#### 1. 事件驱动架构 (Event-Driven Architecture)

- **核心组件**：Event Bus (事件总线)
- **通信方式**：发布-订阅模式
- **优势**：
  - 模块间松耦合
  - 易于扩展和维护
  - 支持异步处理
  - 便于调试和追踪

#### 2. 分层架构 (Layered Architecture)

```
┌─────────────────────────────────────┐
│     Presentation Layer (API)        │  ← FastAPI REST endpoints
├─────────────────────────────────────┤
│     Application Layer (Namespaces)  │  ← Session, Agent, Provider
├─────────────────────────────────────┤
│     Domain Layer (Core Logic)       │  ← Tool, Permission, Config
├─────────────────────────────────────┤
│     Infrastructure Layer            │  ← Storage, MCP, External APIs
└─────────────────────────────────────┘
```

#### 3. 命名空间模式 (Namespace Pattern)

使用类级别的命名空间组织代码：

```python
# 示例：Session 命名空间
class Session:
    @classmethod
    async def create(...) -> SessionInfo: ...

    @classmethod
    async def get(...) -> SessionInfo | None: ...

    @classmethod
    async def update(...) -> SessionInfo | None: ...
```

**优势**：
- 清晰的 API 边界
- 易于理解和使用
- 支持依赖注入
- 便于测试和模拟


---

## 核心模块详解

### 1. Event Bus (事件总线)

**位置**：`talor/src/talor/bus/`

#### 核心组件

##### Bus (事件总线主类)

```python
class Bus:
    """事件总线，提供发布-订阅功能"""

    @classmethod
    async def publish(cls, definition: EventDefinition, properties: BaseModel):
        """发布事件到所有订阅者"""

    @classmethod
    def subscribe(cls, definition: EventDefinition, callback: EventCallback):
        """订阅特定类型的事件"""

    @classmethod
    def subscribe_all(cls, callback: EventCallback):
        """订阅所有事件（通配符）"""
```

##### BusEvent (事件定义)

```python
class BusEvent:
    """事件定义工厂"""

    @staticmethod
    def define(event_type: str, properties_model: Type[BaseModel]):
        """定义一个新的事件类型"""
```

#### 预定义事件

| 事件类型 | 数据模型 | 触发时机 |
|---------|---------|---------|
| `session.created` | SessionCreatedData | 创建新会话时 |
| `session.updated` | SessionUpdatedData | 更新会话信息时 |
| `session.deleted` | SessionDeletedData | 删除会话时 |
| `message.created` | MessageCreatedData | 创建新消息时 |
| `message.updated` | MessageUpdatedData | 更新消息时 |
| `message.part.created` | MessagePartCreatedData | 添加消息部分时 |
| `stream.text` | StreamTextData | 流式文本输出时 |
| `stream.tool_call` | StreamToolCallData | 工具调用时 |
| `stream.tool_result` | StreamToolResultData | 工具执行结果时 |
| `stream.done` | StreamDoneData | 流式处理完成时 |
| `stream.error` | StreamErrorData | 流式处理错误时 |
| `mcp.server.connected` | MCPServerConnectedData | MCP 服务器连接时 |
| `mcp.server.disconnected` | MCPServerDisconnectedData | MCP 服务器断开时 |

#### 使用示例

```python
from talor.bus import Bus, BusEvent
from pydantic import BaseModel

# 定义事件数据模型
class UserLoginData(BaseModel):
    user_id: str
    timestamp: int

# 定义事件
UserLogin = BusEvent.define("user.login", UserLoginData)

# 订阅事件
async def on_user_login(event):
    print(f"User {event.properties.user_id} logged in")

unsubscribe = Bus.subscribe(UserLogin, on_user_login)

# 发布事件
await Bus.publish(UserLogin, UserLoginData(
    user_id="user123",
    timestamp=1234567890
))

# 取消订阅
unsubscribe()
```

---

### 2. Session (会话管理)

**位置**：`talor/src/talor/session/`

#### 核心功能

- 会话生命周期管理（创建、更新、删除）
- 消息历史管理
- 会话元数据存储
- 事件发布

#### 数据模型

##### SessionInfo

```python
class SessionInfo(BaseModel):
    id: str                              # 会话唯一标识
    slug: str                            # 短标识
    project_id: str                      # 项目 ID
    directory: str                       # 工作目录
    parent_id: str | None                # 父会话 ID
    title: str                           # 会话标题
    version: str                         # 版本号
    time: dict[str, int]                 # 时间戳（created, updated）
    permission: list[dict[str, Any]]     # 权限规则
    summary: dict[str, Any] | None       # 摘要信息
```

##### Message

```python
class Message(BaseModel):
    id: str                    # 消息 ID
    session_id: str            # 所属会话
    role: str                  # 角色：user/assistant/system
    content: str               # 消息内容
    created_at: int            # 创建时间戳
    tool_calls: list | None    # 工具调用列表
    tool_results: list | None  # 工具结果列表
```

#### 主要方法

```python
class Session:
    @classmethod
    async def create(cls, parent_id=None, title=None) -> SessionInfo:
        """创建新会话"""

    @classmethod
    async def get(cls, session_id: str) -> SessionInfo | None:
        """获取会话信息"""

    @classmethod
    async def update(cls, session_id: str, editor: Callable) -> SessionInfo:
        """使用编辑器函数更新会话"""

    @classmethod
    async def delete(cls, session_id: str) -> None:
        """删除会话"""

    @classmethod
    async def list(cls) -> list[SessionInfo]:
        """列出所有会话"""

    @classmethod
    async def messages(cls, session_id: str) -> list[MessageWithParts]:
        """获取会话的所有消息"""

    @classmethod
    async def add_message(cls, session_id: str, message: Message) -> MessageWithParts:
        """添加消息到会话"""
```

#### 使用示例

```python
from talor import Session

# 创建会话
session = await Session.create(title="新的编程任务")

# 添加消息
message = Message(
    id="msg_123",
    session_id=session.id,
    role="user",
    content="帮我写一个快速排序算法",
    created_at=int(time.time() * 1000)
)
await Session.add_message(session.id, message)

# 更新会话标题
await Session.update(session.id, lambda s: setattr(s, 'title', '快速排序实现'))

# 获取消息历史
messages = await Session.messages(session.id)
```


---

### 3. Agent (代理管理)

**位置**：`talor/src/talor/agent/`

#### 核心功能

- Agent 配置管理
- 内置 Agent 定义
- 自定义 Agent 支持
- 权限规则集成

#### 内置 Agent

| Agent 名称 | 模式 | 描述 | 权限特点 |
|-----------|------|------|---------|
| `build` | primary | 默认 Agent，执行工具 | 允许大部分操作，询问危险操作 |
| `plan` | primary | 规划模式，禁止编辑 | 禁止 edit/write 工具 |
| `general` | subagent | 通用子 Agent | 标准权限 |
| `explore` | subagent | 代码库探索 | 仅允许读取和搜索 |
| `title` | primary | 生成标题 | 禁止所有工具 |
| `summary` | primary | 生成摘要 | 禁止所有工具 |

#### Agent 配置

```python
class AgentInfo(BaseModel):
    name: str                           # Agent 名称
    description: str | None             # 描述
    mode: str                           # 模式：primary/subagent/all
    native: bool                        # 是否内置
    hidden: bool                        # 是否隐藏
    top_p: float | None                 # Top-p 采样参数
    temperature: float | None           # 温度参数
    color: str | None                   # 显示颜色
    permission: list[dict]              # 权限规则
    model: AgentModel | None            # 模型覆盖
    prompt: str | None                  # 系统提示词
    options: dict[str, Any]             # 额外选项
    steps: int | None                   # 最大步数
```

#### 权限系统

##### Permission Rule

```python
class PermissionRule(BaseModel):
    tool_pattern: str        # 工具名称模式（支持通配符）
    action: str              # 动作：allow/deny/ask
    scope: str               # 作用域：always/session/once
```

##### 权限配置示例

```yaml
# config.yaml
agent:
  build:
    permission:
      "*": "allow"                    # 默认允许所有
      "doom_loop": "ask"              # 询问危险循环
      "external_directory": "ask"     # 询问外部目录访问
      "read":
        "*.env": "ask"                # 询问读取环境变量文件
        "*.env.example": "allow"      # 允许读取示例文件
```

#### 使用示例

```python
from talor import Agent

# 获取 Agent
agent = await Agent.get("build")
print(f"Agent: {agent.name}")
print(f"Description: {agent.description}")

# 列出所有 Agent
agents = await Agent.list()
for agent in agents:
    print(f"- {agent.name}: {agent.description}")

# 获取默认 Agent
default_agent_name = await Agent.default_agent()

# 列出特定模式的 Agent
primary_agents = await Agent.list_for_mode("primary")
subagents = await Agent.list_for_mode("subagent")
```

---

### 4. Provider (LLM 提供商)

**位置**：`talor/src/talor/provider/`

#### 核心功能

- 多提供商支持
- 模型发现和管理
- 统一的 API 接口
- 成本追踪

#### 支持的提供商

##### 1. OpenAI

```python
ProviderInfo(
    id="openai",
    name="OpenAI",
    api_key_env="OPENAI_API_KEY",
    base_url="https://api.openai.com/v1",
    models=[
        ModelInfo(id="gpt-4o", context_length=128000, ...),
        ModelInfo(id="gpt-4o-mini", context_length=128000, ...),
        ModelInfo(id="gpt-4-turbo", context_length=128000, ...),
    ]
)
```

##### 2. Anthropic

```python
ProviderInfo(
    id="anthropic",
    name="Anthropic",
    api_key_env="ANTHROPIC_API_KEY",
    models=[
        ModelInfo(id="claude-3-5-sonnet-20241022", ...),
        ModelInfo(id="claude-3-5-haiku-20241022", ...),
        ModelInfo(id="claude-3-opus-20240229", ...),
    ]
)
```

##### 3. Ollama (本地)

```python
ProviderInfo(
    id="ollama",
    name="Ollama",
    base_url="http://localhost:11434/v1",
    models=[
        # 动态发现本地模型
        ModelInfo(id="deepseek-v3.1:671b-cloud", ...),
        ModelInfo(id="qwen2.5:14b", ...),
        ModelInfo(id="llama3.2:latest", ...),
    ]
)
```

#### 模型信息

```python
class ModelInfo(BaseModel):
    id: str                              # 模型 ID
    name: str                            # 显示名称
    provider_id: str                     # 提供商 ID
    context_length: int                  # 上下文长度
    max_output_tokens: int               # 最大输出 token
    capabilities: ModelCapabilities      # 能力（视觉、函数调用等）
    cost: ModelCost                      # 成本信息
```

#### 使用示例

```python
from talor import Provider

# 列出所有提供商
providers = await Provider.list()
for provider in providers:
    print(f"Provider: {provider.name}")
    for model in provider.models:
        print(f"  - {model.name}")

# 获取特定模型
model = await Provider.get_model("openai", "gpt-4o")

# 完成请求
response = await Provider.complete(
    model="openai/gpt-4o",
    messages=[
        {"role": "user", "content": "Hello!"}
    ],
    stream=False
)

# 流式完成
async for chunk in await Provider.complete(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
):
    print(chunk["content"], end="")
```


---

### 5. Tool (工具系统)

**位置**：`talor/src/talor/tool/`

#### 核心功能

- 统一的工具定义接口
- Pydantic 参数验证
- 工具注册和发现
- 执行上下文管理

#### 工具定义

```python
from talor.tool import Tool
from pydantic import BaseModel

# 定义参数模型
class ReadFileParams(BaseModel):
    file_path: str
    encoding: str = "utf-8"

# 定义执行函数
async def read_file_handler(params: ReadFileParams, ctx: Tool.Context) -> Tool.Output:
    with open(params.file_path, 'r', encoding=params.encoding) as f:
        content = f.read()
    return Tool.Output(
        title=f"Read {params.file_path}",
        output=content
    )

# 定义工具
ReadFileTool = Tool.define(
    id="read_file",
    description="Read content from a file",
    parameters=ReadFileParams,
    execute=read_file_handler
)
```

#### 工具上下文

```python
class ToolContext(BaseModel):
    session_id: str              # 会话 ID
    message_id: str              # 消息 ID
    directory: str               # 工作目录
    user_id: str | None          # 用户 ID
    metadata: dict[str, Any]     # 额外元数据
```

#### 工具输出

```python
class ToolOutput(BaseModel):
    title: str                   # 输出标题
    output: str                  # 输出内容
    error: str | None            # 错误信息
    metadata: dict[str, Any]     # 元数据
```

#### 内置工具

| 工具名称 | 描述 | 参数 |
|---------|------|------|
| `read_file` | 读取文件内容 | file_path, encoding |
| `write_file` | 写入文件 | file_path, content, encoding |
| `list_directory` | 列出目录内容 | path, recursive |
| `search_files` | 搜索文件 | pattern, directory |
| `execute_command` | 执行 shell 命令 | command, cwd |
| `grep_search` | 文本搜索 | pattern, path |

#### 工具注册

```python
from talor.tool import ToolRegistry

# 注册工具
ToolRegistry.register(ReadFileTool)

# 获取工具
tool = ToolRegistry.get("read_file")

# 列出所有工具
tools = ToolRegistry.list()

# 执行工具
context = ToolContext(
    session_id="session_123",
    message_id="msg_456",
    directory="/workspace"
)
result = await tool({"file_path": "README.md"}, context)
```

---

### 6. MCP (Model Context Protocol)

**位置**：`talor/src/talor/mcp/`

#### 核心功能

- MCP 服务器管理
- 工具发现和集成
- 资源访问
- 提示词模板
- **统一工具接口**：将 MCP 工具转换为标准 Tool 格式

#### MCP 服务器配置

```yaml
# config.yaml
mcp_servers:
  playwright:
    command: "npx"
    args:
      - "@playwright/mcp@latest"
    transport: "stdio"

  filesystem:
    command: "mcp-server-filesystem"
    args:
      - "/workspace"
    transport: "stdio"
```

#### 支持的传输模式

Talor 支持三种 MCP 传输模式：

1. **stdio**（默认）：通过子进程的标准输入/输出通信
2. **sse**：通过 HTTP Server-Sent Events 通信（远程服务器）
3. **http**：通过可流式 HTTP 通信（推荐用于生产环境）

```python
# stdio 模式
MCPServerConfig(
    transport=MCPTransport.STDIO,
    command="npx",
    args=["@playwright/mcp@latest"],
    env={"NODE_ENV": "production"},
    cwd="/workspace"
)

# SSE 模式
MCPServerConfig(
    transport=MCPTransport.SSE,
    url="https://mcp-server.example.com/sse",
    headers={"Authorization": "Bearer token"}
)

# HTTP 模式
MCPServerConfig(
    transport=MCPTransport.HTTP,
    url="https://mcp-server.example.com",
    headers={"Authorization": "Bearer token"}
)
```

#### MCP 工具统一机制

Talor 通过 **ToolRegistry** 实现了 MCP 工具与内置工具的统一管理。这是一个关键的设计，使得 LLM 可以无缝使用来自不同来源的工具。

##### 1. 工具发现和转换

当 MCP 服务器连接时，Talor 会自动发现其提供的工具并转换为标准格式：

```python
# MCP 工具定义（来自 MCP 服务器）
class MCPTool(BaseModel):
    name: str                    # 工具名称
    description: str             # 工具描述
    input_schema: dict           # JSON Schema 参数定义
    server: str                  # 所属服务器

# 转换为 LLM 兼容格式
def get_tool_definitions() -> list[dict]:
    """将 MCP 工具转换为 OpenAI 工具格式"""
    definitions = []

    for client in MCP._clients.values():
        for tool in client.tools:
            definitions.append({
                "type": "function",
                "function": {
                    "name": f"mcp_{client.name}_{tool.name}",  # 添加前缀避免冲突
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            })

    return definitions
```

##### 2. 工具注册流程

```
┌─────────────────────────────────────────────────────────────┐
│              MCP 工具统一注册流程                              │
└─────────────────────────────────────────────────────────────┘

1. MCP 服务器连接
   ├─ 创建 MCPClientWrapper
   ├─ 建立传输连接（stdio/sse/http）
   └─ 调用 list_tools() 发现工具

2. 工具转换
   ├─ 提取工具元数据（name, description, input_schema）
   ├─ 创建 MCPTool 对象
   └─ 添加服务器标识

3. 注册到 ToolRegistry
   ├─ 创建统一的 ToolInfo 包装器
   ├─ 设置 source="mcp"
   ├─ 添加到工具索引
   └─ 发布 tool.registered 事件

4. LLM 调用
   ├─ ToolRegistry.get_llm_definitions()
   ├─ 返回所有工具（内置 + MCP）
   └─ LLM 选择并调用工具

5. 工具执行
   ├─ 解析工具名称（mcp_server_tool）
   ├─ 路由到对应的 MCP 客户端
   ├─ 调用 MCP.call_tool()
   └─ 返回标准化的 ToolOutput
```

##### 3. 工具命名约定

为了避免命名冲突，MCP 工具使用特殊的命名格式：

```
格式：mcp_{server_name}_{tool_name}

示例：
- mcp_playwright_navigate      # Playwright 的 navigate 工具
- mcp_playwright_screenshot    # Playwright 的 screenshot 工具
- mcp_filesystem_read_file     # Filesystem 的 read_file 工具
```

##### 4. 统一的工具执行接口

```python
# ToolRegistry 提供统一的执行接口
async def execute(
    tool_name: str,
    arguments: dict[str, Any],
    context: ToolContext,
) -> ToolOutput:
    """执行任何工具（内置或 MCP）"""

    # 检查是否是 MCP 工具
    if tool_name.startswith("mcp_"):
        # 解析服务器和工具名称
        parts = tool_name.split("_", 2)
        server_name = parts[1]
        mcp_tool_name = parts[2]

        # 调用 MCP 工具
        result = await MCP.call_tool(
            server=server_name,
            tool_name=mcp_tool_name,
            arguments=arguments
        )

        # 转换为标准 ToolOutput
        return ToolOutput(
            title=f"MCP: {mcp_tool_name}",
            output=format_mcp_result(result)
        )
    else:
        # 执行内置工具
        tool = await self.get(tool_name)
        return await tool(arguments, context)
```

##### 5. 工具源索引

ToolRegistry 维护了一个源索引，用于区分不同来源的工具：

```python
_source_index = {
    "mcp": [
        "mcp_playwright_navigate",
        "mcp_playwright_screenshot",
        "mcp_filesystem_read_file",
    ],
    "builtin": [
        "read_file",
        "write_file",
        "execute_command",
    ],
    "custom": [
        "my_custom_tool",
    ]
}
```

##### 6. 完整示例

```python
from talor import MCP, ToolRegistry
from talor.tool import ToolContext

# 1. 连接 MCP 服务器
await MCP.connect("playwright", {
    "transport": "stdio",
    "command": "npx",
    "args": ["@playwright/mcp@latest"]
})

# 2. 获取所有工具定义（包括 MCP）
registry = ToolRegistry()
all_tools = await registry.get_llm_definitions()

# 输出示例：
# [
#   {
#     "type": "function",
#     "function": {
#       "name": "read_file",
#       "description": "Read file content",
#       "parameters": {...}
#     }
#   },
#   {
#     "type": "function",
#     "function": {
#       "name": "mcp_playwright_navigate",
#       "description": "Navigate to a URL",
#       "parameters": {...}
#     }
#   }
# ]

# 3. 执行 MCP 工具
context = ToolContext(
    session_id="session_123",
    message_id="msg_456",
    directory="/workspace"
)

result = await registry.execute(
    tool_name="mcp_playwright_navigate",
    arguments={"url": "https://example.com"},
    context=context
)

print(result.output)  # 标准化的输出
```

#### MCP 工具的优势

1. **统一接口**：LLM 无需区分工具来源，使用相同的调用方式
2. **动态发现**：MCP 服务器的工具自动注册，无需手动配置
3. **权限控制**：MCP 工具同样受 Agent 权限规则约束
4. **事件追踪**：工具执行会发布标准事件，便于监控和调试
5. **错误处理**：统一的错误处理和验证机制
6. **可扩展性**：轻松添加新的 MCP 服务器，无需修改核心代码

#### MCP 集成示例

```python
from talor import MCP

# 初始化 MCP
await MCP.connect_from_config()

# 列出 MCP 服务器
servers = await MCP.list_servers()
# [
#   {
#     "name": "playwright",
#     "status": {"status": "connected", "error": null},
#     "tools_count": 5
#   }
# ]

# 获取 MCP 工具
tools = await MCP.tools("playwright")
# [
#   MCPTool(name="navigate", description="...", server="playwright"),
#   MCPTool(name="screenshot", description="...", server="playwright"),
# ]

# 直接调用 MCP 工具（不推荐，应使用 ToolRegistry）
result = await MCP.call_tool(
    server="playwright",
    tool_name="navigate",
    arguments={"url": "https://example.com"}
)

# 断开连接
await MCP.disconnect("playwright")
```

---

### 7. Config (配置系统)

**位置**：`talor/src/talor/config/`

#### 配置层级

1. **默认配置**：内置默认值
2. **全局配置**：`~/.config/talor/config.yaml`
3. **项目配置**：`<workspace>/.talor/config.yaml`
4. **环境变量**：`TALOR_*` 前缀

#### 配置文件结构

```yaml
# 提供商配置
providers:
  openai:
    api_key: "sk-..."
    default_model: "gpt-4o"

  ollama:
    base_url: "http://localhost:11434"
    default_model: "deepseek-v3.1:671b-cloud"

# MCP 服务器
mcp_servers:
  playwright:
    command: "npx"
    args: ["@playwright/mcp@latest"]

# 权限配置
permissions:
  rules:
    - tool_pattern: "read_*"
      action: "allow"
      scope: "always"
    - tool_pattern: "write_*"
      action: "ask"
      scope: "session"

# Agent 配置
agent:
  build:
    temperature: 0.7
    model:
      provider_id: "openai"
      model_id: "gpt-4o"

# 日志配置
logging:
  level: "INFO"
  file_rotation: "1 day"

# 存储配置
storage:
  database_path: null  # 使用默认位置
  backup_enabled: true
```

#### 使用示例

```python
from talor import Config

# 配置系统
Config.configure(directory="/workspace")

# 获取配置
config = await Config.get()

# 访问配置项
api_key = config.get("providers", {}).get("openai", {}).get("api_key")
log_level = config.get("logging", {}).get("level", "INFO")

# 更新配置
await Config.update({
    "providers": {
        "openai": {
            "default_model": "gpt-4o-mini"
        }
    }
})
```


---

## 主要流程

### 1. 系统启动流程

```
┌─────────────────────────────────────────────────────────────┐
│                     系统启动流程                              │
└─────────────────────────────────────────────────────────────┘

1. CLI 入口
   ├─ 解析命令行参数
   ├─ 设置日志级别
   └─ 确定工作目录

2. 配置加载
   ├─ 加载默认配置
   ├─ 加载全局配置 (~/.config/talor/)
   ├─ 加载项目配置 (.talor/)
   └─ 合并配置

3. 核心系统初始化
   ├─ 初始化 Event Bus
   ├─ 初始化 Storage (SQLite)
   ├─ 配置 Session 系统
   ├─ 配置 Agent 系统
   ├─ 配置 Provider 系统
   ├─ 配置 Tool Registry
   └─ 初始化 MCP 服务器

4. API 服务器启动
   ├─ 创建 FastAPI 应用
   ├─ 注册路由
   │  ├─ /api/sessions
   │  ├─ /api/agents
   │  ├─ /api/providers
   │  ├─ /api/config
   │  └─ /event (SSE)
   ├─ 配置 CORS
   └─ 启动 Uvicorn 服务器

5. 前端连接
   ├─ 建立 HTTP 连接
   ├─ 建立 SSE 事件流
   └─ 订阅事件
```

### 2. 会话创建流程

```
┌─────────────────────────────────────────────────────────────┐
│                     会话创建流程                              │
└─────────────────────────────────────────────────────────────┘

用户操作: 点击"新建会话"按钮

1. 前端 (React)
   ├─ useSessionStore.createSession()
   └─ sessionApi.create()
      └─ POST /api/sessions

2. 后端 API
   ├─ 接收请求
   └─ 调用 Session.create()

3. Session 模块
   ├─ 生成 session_id (ULID)
   ├─ 创建 SessionInfo 对象
   ├─ 存储到数据库
   ├─ 更新缓存
   └─ 发布事件: session.created

4. Event Bus
   ├─ 分发事件到订阅者
   └─ 通过 SSE 推送到前端

5. 前端接收事件
   ├─ useEvents hook 接收
   ├─ 调用 storeCallbacks.addSession()
   └─ 更新 UI 显示

结果: 新会话出现在会话列表中
```

### 3. 消息发送流程（方案 A - 流式响应）

```
┌─────────────────────────────────────────────────────────────┐
│              消息发送流程 (方案 A - 流式)                      │
└─────────────────────────────────────────────────────────────┘

用户操作: 输入消息并发送

1. 前端准备
   ├─ 创建用户消息 (local_msg_xxx)
   ├─ 添加到本地状态 (乐观更新)
   └─ 创建占位符助手消息

2. 发送请求
   └─ POST /api/agents/prompt
      {
        "session_id": "session_xxx",
        "prompt": "用户输入的内容"
      }

3. 后端处理
   ├─ SessionPrompt.prompt()
   ├─ 创建用户消息
   ├─ 发布 message.created 事件
   ├─ 调用 LLM (Provider.complete)
   └─ 开始流式响应

4. 流式输出 (SSE)
   ├─ event: text
   │  └─ 前端追加文本到助手消息
   ├─ event: tool_call
   │  └─ 前端显示工具调用
   ├─ event: tool_result
   │  └─ 前端显示工具结果
   └─ event: done
      └─ 前端标记完成

5. 完成处理
   ├─ 保存助手消息
   ├─ 发布 message.created 事件
   └─ 更新会话时间戳

结果: 用户看到实时的 AI 响应
```

### 4. 消息发送流程（方案 B - 异步模式）

```
┌─────────────────────────────────────────────────────────────┐
│            消息发送流程 (方案 B - 异步)                        │
└─────────────────────────────────────────────────────────────┘

用户操作: 输入消息并发送

1. 前端准备
   ├─ 创建用户消息 (local_msg_xxx)
   ├─ 添加到本地状态 (乐观更新)
   └─ 发送异步请求

2. 发送请求
   └─ POST /api/agents/prompt-async
      {
        "session_id": "session_xxx",
        "prompt": "用户输入的内容"
      }

3. 后端立即响应
   ├─ 接受请求
   ├─ 创建后台任务
   └─ 返回 202 Accepted

4. 后台处理
   ├─ 创建用户消息
   ├─ 发布 message.created 事件
   ├─ 调用 LLM
   └─ 通过 /event SSE 推送事件

5. 事件流 (/event SSE)
   ├─ stream.text
   │  └─ 前端: appendStreamingText()
   ├─ stream.tool_call
   │  └─ 前端: addToolCall()
   ├─ stream.tool_result
   │  └─ 前端: addToolResult()
   └─ stream.done
      └─ 前端: setLoading(false)

6. 消息去重
   ├─ 后端发送 message.created 事件
   ├─ 前端检测到相同内容
   └─ 替换 local_msg_xxx 为真实 ID

结果: 更可靠的异步处理，网络中断不影响
```

### 5. 工具执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                     工具执行流程                              │
└─────────────────────────────────────────────────────────────┘

1. LLM 决策
   ├─ 分析用户请求
   └─ 决定调用工具

2. 工具调用请求
   └─ tool_call: {
        "id": "call_xxx",
        "name": "read_file",  # 或 "mcp_playwright_navigate"
        "arguments": {"file_path": "README.md"}
      }

3. 权限检查
   ├─ 获取 Agent 权限规则
   ├─ 匹配工具模式
   └─ 确定动作 (allow/deny/ask)

4. 如果需要询问
   ├─ 发布 permission.request 事件
   ├─ 前端显示权限对话框
   ├─ 等待用户响应
   └─ 继续或拒绝

5. 工具路由和执行
   ├─ 从 ToolRegistry 获取工具
   ├─ 判断工具类型（内置 or MCP）
   │
   ├─ 如果是内置工具：
   │  ├─ 验证参数 (Pydantic)
   │  ├─ 创建 ToolContext
   │  ├─ 执行工具函数
   │  └─ 返回 ToolOutput
   │
   └─ 如果是 MCP 工具：
      ├─ 解析工具名称（mcp_server_tool）
      ├─ 获取 MCP 客户端
      ├─ 调用 MCP.call_tool()
      ├─ 转换 MCP 响应
      └─ 返回标准化的 ToolOutput

6. 结果处理
   ├─ 发布 stream.tool_result 事件
   ├─ 将结果添加到消息
   └─ 继续 LLM 处理

7. 前端显示
   ├─ 显示工具调用
   ├─ 显示执行结果
   └─ 更新 UI

结果: 工具执行完成，结果展示给用户
```

### 6. MCP 工具统一流程

```
┌─────────────────────────────────────────────────────────────┐
│              MCP 工具统一和调用流程                            │
└─────────────────────────────────────────────────────────────┘

阶段 1: MCP 服务器启动和工具发现
   │
   ├─ 1.1 读取配置
   │     └─ 从 config.yaml 读取 mcp_servers 配置
   │
   ├─ 1.2 创建 MCP 客户端
   │     ├─ 选择传输模式（stdio/sse/http）
   │     ├─ 创建 MCPClientWrapper
   │     └─ 建立连接
   │
   ├─ 1.3 发现工具
   │     ├─ 调用 client.list_tools()
   │     ├─ 解析工具元数据
   │     └─ 创建 MCPTool 对象
   │
   └─ 1.4 发布连接事件
         └─ mcp.server.connected

阶段 2: 工具注册到 ToolRegistry
   │
   ├─ 2.1 遍历 MCP 工具
   │     └─ for tool in mcp_client.tools
   │
   ├─ 2.2 创建工具包装器
   │     ├─ 生成工具名称: mcp_{server}_{tool_name}
   │     ├─ 转换参数 schema
   │     └─ 创建执行函数
   │
   ├─ 2.3 注册到 ToolRegistry
   │     ├─ registry.register(tool, source="mcp")
   │     ├─ 添加到 _tools 字典
   │     └─ 更新 _source_index
   │
   └─ 2.4 发布注册事件
         └─ tool.registered

阶段 3: LLM 获取工具定义
   │
   ├─ 3.1 请求工具列表
   │     └─ registry.get_llm_definitions()
   │
   ├─ 3.2 收集所有工具
   │     ├─ 内置工具（read_file, write_file, ...）
   │     └─ MCP 工具（mcp_playwright_navigate, ...）
   │
   ├─ 3.3 转换为 OpenAI 格式
   │     └─ {
   │           "type": "function",
   │           "function": {
   │             "name": "mcp_playwright_navigate",
   │             "description": "Navigate to a URL",
   │             "parameters": {...}
   │           }
   │         }
   │
   └─ 3.4 返回给 LLM
         └─ LLM 可以看到所有可用工具

阶段 4: LLM 调用 MCP 工具
   │
   ├─ 4.1 LLM 决策
   │     ├─ 分析用户请求
   │     └─ 选择工具: mcp_playwright_navigate
   │
   ├─ 4.2 生成工具调用
   │     └─ {
   │           "id": "call_abc123",
   │           "name": "mcp_playwright_navigate",
   │           "arguments": {"url": "https://example.com"}
   │         }
   │
   └─ 4.3 发送到后端
         └─ 通过 stream 或 async 模式

阶段 5: 工具执行路由
   │
   ├─ 5.1 接收工具调用
   │     └─ tool_name = "mcp_playwright_navigate"
   │
   ├─ 5.2 权限检查
   │     ├─ 匹配 Agent 权限规则
   │     └─ 确定是否允许执行
   │
   ├─ 5.3 解析工具名称
   │     ├─ 检测前缀: tool_name.startswith("mcp_")
   │     ├─ 提取服务器: "playwright"
   │     └─ 提取工具名: "navigate"
   │
   ├─ 5.4 路由到 MCP 客户端
   │     └─ client = MCP._clients["playwright"]
   │
   └─ 5.5 调用 MCP 工具
         └─ result = await client.call_tool("navigate", arguments)

阶段 6: MCP 工具执行
   │
   ├─ 6.1 发送请求到 MCP 服务器
   │     ├─ 通过 stdio/sse/http 传输
   │     └─ 序列化参数
   │
   ├─ 6.2 MCP 服务器处理
   │     ├─ 验证参数
   │     ├─ 执行实际操作（如打开浏览器）
   │     └─ 返回结果
   │
   ├─ 6.3 接收 MCP 响应
   │     └─ result = {
   │           "content": [...],
   │           "data": {...}
   │         }
   │
   └─ 6.4 转换为标准格式
         └─ ToolOutput(
               title="Navigate",
               output="Navigated to https://example.com"
             )

阶段 7: 结果返回和显示
   │
   ├─ 7.1 发布工具结果事件
   │     └─ stream.tool_result
   │
   ├─ 7.2 添加到消息历史
   │     └─ message.tool_results.append(...)
   │
   ├─ 7.3 返回给 LLM
   │     └─ LLM 继续处理
   │
   └─ 7.4 前端显示
         ├─ 显示工具调用卡片
         ├─ 显示执行结果
         └─ 更新 UI

关键设计点:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 命名空间隔离
   - MCP 工具使用 "mcp_" 前缀
   - 避免与内置工具命名冲突
   - 便于识别和路由

2. 统一接口
   - 所有工具通过 ToolRegistry 统一管理
   - LLM 无需区分工具来源
   - 相同的调用和返回格式

3. 动态发现
   - MCP 服务器启动时自动发现工具
   - 无需手动配置每个工具
   - 支持热插拔

4. 标准化输出
   - MCP 响应转换为 ToolOutput
   - 统一的错误处理
   - 一致的事件发布

5. 权限控制
   - MCP 工具同样受权限规则约束
   - 支持 allow/deny/ask 策略
   - 可以针对特定 MCP 工具配置权限
```


---

## API 接口

### REST API 端点

#### 1. Session API

##### 创建会话
```http
POST /api/sessions
Content-Type: application/json

{
  "title": "新会话",
  "parent_id": null
}

Response: 201 Created
{
  "id": "session_01HQXXX",
  "title": "新会话",
  "createdAt": 1234567890000,
  "updatedAt": 1234567890000,
  "messageCount": 0
}
```

##### 获取会话列表
```http
GET /api/sessions

Response: 200 OK
[
  {
    "id": "session_01HQXXX",
    "title": "会话标题",
    "createdAt": 1234567890000,
    "updatedAt": 1234567890000,
    "messageCount": 5
  }
]
```

##### 获取会话详情
```http
GET /api/sessions/{session_id}

Response: 200 OK
{
  "id": "session_01HQXXX",
  "title": "会话标题",
  "directory": "/workspace",
  "createdAt": 1234567890000,
  "updatedAt": 1234567890000
}
```

##### 更新会话
```http
PUT /api/sessions/{session_id}
Content-Type: application/json

{
  "title": "新标题"
}

Response: 200 OK
{
  "id": "session_01HQXXX",
  "title": "新标题",
  ...
}
```

##### 删除会话
```http
DELETE /api/sessions/{session_id}

Response: 204 No Content
```

##### 获取会话消息
```http
GET /api/sessions/{session_id}/messages

Response: 200 OK
[
  {
    "id": "msg_xxx",
    "sessionId": "session_01HQXXX",
    "role": "user",
    "content": "Hello",
    "createdAt": 1234567890000
  },
  {
    "id": "msg_yyy",
    "sessionId": "session_01HQXXX",
    "role": "assistant",
    "content": "Hi there!",
    "createdAt": 1234567891000
  }
]
```

#### 2. Agent API

##### 处理提示词（流式）
```http
POST /api/agents/prompt
Content-Type: application/json

{
  "session_id": "session_01HQXXX",
  "prompt": "帮我写一个函数",
  "model": "openai/gpt-4o",
  "agent": "build"
}

Response: 200 OK (SSE Stream)
event: text
data: {"type":"text","content":"好的"}

event: text
data: {"type":"text","content":"，我来帮你"}

event: tool_call
data: {"type":"tool_call","content":{"id":"call_xxx","name":"write_file",...}}

event: tool_result
data: {"type":"tool_result","content":{"toolCallId":"call_xxx","output":"..."}}

event: done
data: {"type":"status","content":"done"}
```

##### 处理提示词（异步）
```http
POST /api/agents/prompt-async
Content-Type: application/json

{
  "session_id": "session_01HQXXX",
  "prompt": "帮我写一个函数"
}

Response: 202 Accepted
{
  "message": "Processing started",
  "session_id": "session_01HQXXX"
}
```

##### 列出 Agent
```http
GET /api/agents

Response: 200 OK
[
  {
    "name": "build",
    "description": "默认 Agent",
    "mode": "primary",
    "native": true
  },
  {
    "name": "plan",
    "description": "规划模式",
    "mode": "primary",
    "native": true
  }
]
```

##### 获取 Agent 详情
```http
GET /api/agents/{agent_name}

Response: 200 OK
{
  "name": "build",
  "description": "默认 Agent",
  "mode": "primary",
  "temperature": 0.7,
  "permission": [...]
}
```

#### 3. Provider API

##### 列出提供商
```http
GET /api/providers

Response: 200 OK
[
  {
    "id": "openai",
    "name": "OpenAI",
    "models": [
      {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "contextLength": 128000,
        "maxOutputTokens": 16384
      }
    ]
  }
]
```

##### 获取提供商详情
```http
GET /api/providers/{provider_id}

Response: 200 OK
{
  "id": "openai",
  "name": "OpenAI",
  "baseUrl": "https://api.openai.com/v1",
  "models": [...]
}
```

#### 4. Config API

##### 获取配置
```http
GET /api/config

Response: 200 OK
{
  "providers": {...},
  "mcp_servers": {...},
  "permissions": {...},
  "logging": {...}
}
```

##### 更新配置
```http
PUT /api/config
Content-Type: application/json

{
  "providers": {
    "openai": {
      "default_model": "gpt-4o-mini"
    }
  }
}

Response: 200 OK
{
  "message": "Configuration updated"
}
```

#### 5. MCP API

##### 列出 MCP 服务器
```http
GET /api/mcp/servers

Response: 200 OK
[
  {
    "name": "playwright",
    "connected": true,
    "tools": ["navigate", "screenshot", ...]
  }
]
```

##### 获取 MCP 工具
```http
GET /api/mcp/servers/{server_name}/tools

Response: 200 OK
[
  {
    "name": "navigate",
    "description": "Navigate to a URL",
    "parameters": {...}
  }
]
```

### SSE 事件流

#### 事件端点
```http
GET /event
Accept: text/event-stream

Response: 200 OK
Content-Type: text/event-stream
```

#### 事件格式

##### 会话事件
```
event: session.created
data: {"type":"session.created","properties":{"info":{...}}}

event: session.updated
data: {"type":"session.updated","properties":{"info":{...}}}

event: session.deleted
data: {"type":"session.deleted","properties":{"info":{...}}}
```

##### 消息事件
```
event: message.created
data: {"type":"message.created","properties":{"session_id":"...","message_id":"...","role":"user","content":"..."}}

event: message.updated
data: {"type":"message.updated","properties":{...}}
```

##### 流式事件
```
event: stream.text
data: {"type":"stream.text","properties":{"session_id":"...","message_id":"...","content":"文本内容"}}

event: stream.tool_call
data: {"type":"stream.tool_call","properties":{"session_id":"...","message_id":"...","tool":"read_file","call_id":"call_xxx","arguments":{...}}}

event: stream.tool_result
data: {"type":"stream.tool_result","properties":{"session_id":"...","message_id":"...","tool":"read_file","call_id":"call_xxx","output":"...","error":null}}

event: stream.done
data: {"type":"stream.done","properties":{"session_id":"...","message_id":"...","reason":"stop"}}

event: stream.error
data: {"type":"stream.error","properties":{"session_id":"...","message_id":"...","error":"错误信息"}}
```

##### MCP 事件
```
event: mcp.server.connected
data: {"type":"mcp.server.connected","properties":{"server_name":"playwright"}}

event: mcp.server.disconnected
data: {"type":"mcp.server.disconnected","properties":{"server_name":"playwright","error":"连接断开"}}
```


---

## 事件系统

### 事件驱动架构

Talor 采用事件驱动架构，所有模块通过事件总线进行通信。这种设计提供了：

- **松耦合**：模块之间不直接依赖
- **可扩展**：易于添加新的事件监听器
- **可追踪**：所有操作都有事件记录
- **实时性**：支持实时 UI 更新

### 事件流向图

```
┌─────────────────────────────────────────────────────────────┐
│                        事件流向                               │
└─────────────────────────────────────────────────────────────┘

后端模块                Event Bus              前端 (SSE)
   │                       │                       │
   │  1. 发布事件          │                       │
   ├──────────────────────>│                       │
   │                       │                       │
   │                       │  2. 分发到订阅者       │
   │                       ├──────────────────────>│
   │                       │                       │
   │                       │  3. 推送到 SSE 流     │
   │                       ├──────────────────────>│
   │                       │                       │
   │                       │                       │  4. 更新 UI
   │                       │                       ├─────────>
```

### 事件订阅模式

#### 1. 后端订阅

```python
from talor.bus import Bus, BusEvent
from pydantic import BaseModel

# 定义事件
class UserActionData(BaseModel):
    user_id: str
    action: str

UserAction = BusEvent.define("user.action", UserActionData)

# 订阅事件
async def on_user_action(event):
    print(f"User {event.properties.user_id} performed {event.properties.action}")

unsubscribe = Bus.subscribe(UserAction, on_user_action)

# 发布事件
await Bus.publish(UserAction, UserActionData(
    user_id="user123",
    action="login"
))
```

#### 2. 前端订阅

```typescript
// 使用 useEvents hook
import { useEvents } from './hooks/useEvents';

const eventHandlers = {
  onSessionCreated: (data) => {
    console.log('Session created:', data.info.id);
  },
  onMessageCreated: (data) => {
    console.log('Message created:', data.message_id);
  },
  onStreamText: (data) => {
    console.log('Stream text:', data.content);
  }
};

useEvents({
  eventsApi,
  handlers: eventHandlers,
  storeCallbacks,
  autoConnect: true
});
```

### 事件生命周期

```
1. 事件创建
   ├─ 模块执行操作
   └─ 创建事件数据

2. 事件发布
   ├─ 调用 Bus.publish()
   └─ 验证事件数据 (Pydantic)

3. 事件分发
   ├─ 查找订阅者
   ├─ 并发执行处理器
   └─ 错误隔离

4. SSE 推送
   ├─ 序列化事件
   ├─ 推送到所有连接
   └─ 处理连接错误

5. 前端处理
   ├─ 接收 SSE 事件
   ├─ 解析事件数据
   ├─ 调用处理器
   └─ 更新状态
```

### 事件最佳实践

#### 1. 事件命名

- 使用点分隔的命名空间：`module.action`
- 使用过去时态：`session.created` 而不是 `session.create`
- 保持简洁明了

#### 2. 事件数据

- 使用 Pydantic 模型定义
- 包含足够的上下文信息
- 避免包含敏感信息
- 保持数据结构稳定

#### 3. 事件处理

- 处理器应该快速返回
- 避免阻塞操作
- 使用异步处理
- 实现错误处理

#### 4. 事件订阅

- 及时取消订阅
- 避免内存泄漏
- 使用通配符谨慎
- 记录订阅关系


---

## 配置系统

### 配置文件位置

Talor 支持多层级配置，按优先级从低到高：

1. **默认配置**：代码中的内置默认值
2. **全局配置**：
   - macOS: `~/Library/Application Support/talor/config.yaml`
   - Linux: `~/.config/talor/config.yaml`
   - Windows: `%APPDATA%\talor\config.yaml`
3. **项目配置**：`<workspace>/.talor/config.yaml`
4. **环境变量**：`TALOR_*` 前缀的环境变量

### 配置文件示例

参考 `talor/config.example.yaml`：

```yaml
# LLM 提供商配置
providers:
  openai:
    api_key: "sk-your-openai-api-key"
    default_model: "gpt-4o"

  anthropic:
    api_key: "sk-ant-your-anthropic-api-key"
    default_model: "claude-3-5-sonnet-20241022"

  ollama:
    api_key: "ollama"
    base_url: "http://localhost:11434"
    default_model: "deepseek-v3.1:671b-cloud"

# MCP 服务器配置
mcp_servers:
  playwright:
    command: "npx"
    args:
      - "@playwright/mcp@latest"
    transport: "stdio"

# 权限配置
permissions:
  rules:
    - tool_pattern: "read_*"
      action: "allow"
      scope: "always"
    - tool_pattern: "write_*"
      action: "ask"
      scope: "session"
  dangerous_operations:
    - "delete_file"
    - "write_file"
    - "execute_command"

# Agent 配置
agent:
  build:
    temperature: 0.7
    model:
      provider_id: "openai"
      model_id: "gpt-4o"

# 日志配置
logging:
  level: "INFO"
  file_rotation: "1 day"
  max_file_size: "10 MB"

# 存储配置
storage:
  database_path: null  # 使用默认位置
  backup_enabled: true
  backup_interval: 24

# UI 配置
ui:
  theme: "dark"
  font_size: 14
  show_line_numbers: true
```

### 环境变量

支持的环境变量：

```bash
# API Keys
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GOOGLE_API_KEY="..."

# 配置覆盖
export TALOR_LOG_LEVEL="DEBUG"
export TALOR_DATABASE_PATH="/custom/path/talor.db"
export TALOR_DEFAULT_MODEL="openai/gpt-4o"

# 服务器配置
export TALOR_HOST="0.0.0.0"
export TALOR_PORT="8000"
```


---

## 开发指南

### 环境准备

#### 后端开发环境

```bash
# 1. 克隆项目
git clone https://github.com/talor-dev/talor.git
cd talor

# 2. 进入后端目录
cd talor

# 3. 创建虚拟环境
python3.11 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 4. 安装依赖
pip install -e ".[dev]"

# 5. 配置环境变量
cp config.example.yaml ~/.config/talor/config.yaml
# 编辑配置文件，添加 API keys

# 6. 运行测试
make test

# 7. 启动开发服务器
talor serve --reload
```

#### 前端开发环境

```bash
# 1. 进入前端目录
cd talor-gui

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run dev

# 4. 构建生产版本
npm run build
```

### 开发工作流

#### 1. 代码格式化

```bash
# 后端
cd talor
make format      # 使用 Black 格式化
make lint        # 使用 Ruff 检查
make typecheck   # 使用 MyPy 类型检查

# 前端
cd talor-gui
npm run format        # 使用 Prettier 格式化
npm run lint          # 使用 ESLint 检查
npm run format:check  # 检查格式
```

#### 2. 运行测试

```bash
# 后端测试
cd talor
make test           # 运行所有测试
make test-cov       # 运行测试并生成覆盖率报告
pytest tests/       # 运行特定测试

# 前端测试
cd talor-gui
npm test            # 运行测试（watch 模式）
npm run test:run    # 运行测试（单次）
npm run test:coverage  # 生成覆盖率报告
```

#### 3. 添加新功能

##### 添加新的 Agent

1. 在配置文件中定义 Agent：

```yaml
# config.yaml
agent:
  my_agent:
    description: "我的自定义 Agent"
    mode: "primary"
    temperature: 0.8
    prompt: "你是一个专门的助手..."
    permission:
      "*": "allow"
      "write_*": "ask"
```

2. 或在代码中定义：

```python
# talor/src/agent/agent.py
agents["my_agent"] = AgentInfo(
    name="my_agent",
    description="我的自定义 Agent",
    mode="primary",
    prompt="你是一个专门的助手...",
    permission=[...]
)
```

##### 添加新的工具

1. 定义工具参数模型：

```python
# talor/src/tool/builtin/my_tool.py
from pydantic import BaseModel
from talor.tool import Tool, ToolContext, ToolOutput

class MyToolParams(BaseModel):
    input_text: str
    option: str = "default"

async def my_tool_handler(params: MyToolParams, ctx: ToolContext) -> ToolOutput:
    # 实现工具逻辑
    result = f"Processed: {params.input_text} with {params.option}"

    return ToolOutput(
        title="My Tool Result",
        output=result
    )

MyTool = Tool.define(
    id="my_tool",
    description="A custom tool that processes text",
    parameters=MyToolParams,
    execute=my_tool_handler
)
```

2. 注册工具：

```python
# talor/src/tool/registry.py
from talor.tool.builtin.my_tool import MyTool

ToolRegistry.register(MyTool)
```

##### 添加新的事件

1. 定义事件数据模型：

```python
# talor/src/bus/events.py
from pydantic import BaseModel
from talor.bus import BusEvent

class MyEventData(BaseModel):
    user_id: str
    action: str
    timestamp: int

MyEvent = BusEvent.define("my.event", MyEventData)
```

2. 发布事件：

```python
from talor.bus import Bus
from talor.bus.events import MyEvent, MyEventData

await Bus.publish(MyEvent, MyEventData(
    user_id="user123",
    action="performed_action",
    timestamp=int(time.time() * 1000)
))
```

3. 订阅事件：

```python
async def on_my_event(event):
    print(f"Event received: {event.properties.action}")

unsubscribe = Bus.subscribe(MyEvent, on_my_event)
```

### 调试技巧

#### 1. 后端调试

```python
# 使用 structlog 记录日志
import structlog

logger = structlog.get_logger(__name__)

logger.debug("Debug message", extra_data="value")
logger.info("Info message", session_id="session_123")
logger.error("Error occurred", error=str(e))
```

#### 2. 前端调试

```typescript
// 使用 console 调试
console.debug('Debug info:', data);
console.log('Event received:', event);
console.error('Error:', error);

// 使用 React DevTools
// 安装浏览器扩展：React Developer Tools

// 使用 Zustand DevTools
import { devtools } from 'zustand/middleware';

export const useStore = create(
  devtools((set) => ({
    // store implementation
  }))
);
```

#### 3. 网络调试

```bash
# 查看 HTTP 请求
# 使用浏览器开发者工具 -> Network 标签

# 查看 SSE 事件流
# 使用浏览器开发者工具 -> Network -> EventStream

# 使用 curl 测试 API
curl -X POST http://localhost:8000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Session"}'

# 测试 SSE 连接
curl -N http://localhost:8000/event
```

### 常见问题

#### 1. 后端启动失败

**问题**：`ModuleNotFoundError: No module named 'talor'`

**解决**：
```bash
cd talor
pip install -e .
```

#### 2. 前端无法连接后端

**问题**：CORS 错误或连接被拒绝

**解决**：
- 检查后端是否运行：`curl http://localhost:8000/api/sessions`
- 检查 Vite 代理配置：`talor-gui/vite.config.ts`
- 确保后端 CORS 配置正确

#### 3. Ollama 模型无法加载

**问题**：无法发现 Ollama 模型

**解决**：
```bash
# 确保 Ollama 正在运行
ollama serve

# 拉取模型
ollama pull deepseek-v3.1:671b-cloud

# 测试连接
curl http://localhost:11434/api/tags
```

#### 4. 数据库锁定错误

**问题**：`database is locked`

**解决**：
```bash
# 关闭所有 Talor 实例
pkill -f talor

# 删除数据库锁文件
rm ~/.local/share/talor/talor.db-wal
rm ~/.local/share/talor/talor.db-shm
```


---

## 部署说明

### Docker 部署

#### 1. 使用 Docker Compose（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/talor-dev/talor.git
cd talor

# 2. 配置环境变量
cp talor/config.example.yaml talor/config.yaml
# 编辑 config.yaml，添加 API keys

# 3. 启动服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f

# 5. 停止服务
docker-compose down
```

#### 2. 手动 Docker 部署

```bash
# 构建后端镜像
cd talor
docker build -t talor-backend:latest .

# 运行后端容器
docker run -d \
  --name talor-backend \
  -p 8000:8000 \
  -v ~/.config/talor:/root/.config/talor \
  -v ~/workspace:/workspace \
  -e OPENAI_API_KEY="sk-..." \
  talor-backend:latest

# 构建前端镜像
cd talor-gui
docker build -t talor-gui:latest .

# 运行前端容器
docker run -d \
  --name talor-gui \
  -p 3000:80 \
  --link talor-backend:backend \
  talor-gui:latest
```

### 生产环境部署

#### 1. 后端部署

##### 使用 Systemd（Linux）

```bash
# 1. 创建服务文件
sudo nano /etc/systemd/system/talor.service
```

```ini
[Unit]
Description=Talor Backend Service
After=network.target

[Service]
Type=simple
User=talor
WorkingDirectory=/opt/talor
Environment="PATH=/opt/talor/venv/bin"
Environment="OPENAI_API_KEY=sk-..."
ExecStart=/opt/talor/venv/bin/talor serve --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# 2. 启用并启动服务
sudo systemctl enable talor
sudo systemctl start talor

# 3. 查看状态
sudo systemctl status talor

# 4. 查看日志
sudo journalctl -u talor -f
```

##### 使用 Supervisor

```bash
# 1. 安装 Supervisor
sudo apt-get install supervisor

# 2. 创建配置文件
sudo nano /etc/supervisor/conf.d/talor.conf
```

```ini
[program:talor]
command=/opt/talor/venv/bin/talor serve --host 0.0.0.0 --port 8000
directory=/opt/talor
user=talor
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/var/log/talor/talor.log
environment=OPENAI_API_KEY="sk-..."
```

```bash
# 3. 重新加载配置
sudo supervisorctl reread
sudo supervisorctl update

# 4. 启动服务
sudo supervisorctl start talor

# 5. 查看状态
sudo supervisorctl status talor
```

#### 2. 前端部署

##### 使用 Nginx

```bash
# 1. 构建前端
cd talor-gui
npm run build

# 2. 配置 Nginx
sudo nano /etc/nginx/sites-available/talor
```

```nginx
server {
    listen 80;
    server_name talor.example.com;

    # 前端静态文件
    root /var/www/talor-gui/dist;
    index index.html;

    # SPA 路由支持
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://localhost:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # SSE 事件流
    location /event {
        proxy_pass http://localhost:8000/event;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# 3. 启用站点
sudo ln -s /etc/nginx/sites-available/talor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

##### 使用 Caddy

```bash
# 1. 安装 Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy

# 2. 配置 Caddyfile
sudo nano /etc/caddy/Caddyfile
```

```
talor.example.com {
    root * /var/www/talor-gui/dist
    encode gzip

    # API 代理
    handle /api/* {
        reverse_proxy localhost:8000
    }

    # SSE 事件流
    handle /event {
        reverse_proxy localhost:8000 {
            flush_interval -1
        }
    }

    # SPA 路由
    try_files {path} /index.html
    file_server
}
```

```bash
# 3. 重启 Caddy
sudo systemctl restart caddy
```

### 性能优化

#### 1. 后端优化

```python
# config.yaml
server:
  workers: 4                    # Uvicorn worker 数量
  worker_class: "uvicorn.workers.UvicornWorker"
  max_requests: 1000           # 每个 worker 处理的最大请求数
  max_requests_jitter: 50      # 随机抖动
  timeout: 120                 # 请求超时时间

# 数据库优化
storage:
  connection_pool_size: 10
  max_overflow: 20
  pool_timeout: 30
```

#### 2. 前端优化

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router': ['react-router-dom'],
          'state': ['zustand'],
          'markdown': ['react-markdown', 'remark-gfm'],
        }
      }
    },
    chunkSizeWarningLimit: 1000,
  }
});
```

#### 3. 缓存策略

```nginx
# Nginx 缓存配置
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m max_size=1g inactive=60m;

location /api/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 5m;
    proxy_cache_key "$scheme$request_method$host$request_uri";
    add_header X-Cache-Status $upstream_cache_status;

    proxy_pass http://localhost:8000/api/;
}
```

### 监控和日志

#### 1. 日志收集

```bash
# 使用 journalctl（Systemd）
sudo journalctl -u talor -f --since "1 hour ago"

# 使用 tail（文件日志）
tail -f /var/log/talor/talor.log

# 使用 Docker logs
docker logs -f talor-backend
```

#### 2. 性能监控

```python
# 添加 Prometheus 指标
from prometheus_client import Counter, Histogram

request_count = Counter('talor_requests_total', 'Total requests')
request_duration = Histogram('talor_request_duration_seconds', 'Request duration')

@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    request_count.inc()
    with request_duration.time():
        response = await call_next(request)
    return response
```

#### 3. 健康检查

```python
# talor/src/api/app.py
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "version": __version__,
        "timestamp": int(time.time() * 1000)
    }
```

### 安全建议

1. **API Keys 管理**
   - 使用环境变量存储敏感信息
   - 不要将 API keys 提交到版本控制
   - 定期轮换 API keys

2. **网络安全**
   - 使用 HTTPS（Let's Encrypt）
   - 配置防火墙规则
   - 限制 API 访问速率

3. **数据安全**
   - 定期备份数据库
   - 加密敏感数据
   - 实施访问控制

4. **更新维护**
   - 定期更新依赖包
   - 监控安全漏洞
   - 应用安全补丁


---

## 附录

### A. 命令行参考

#### Talor CLI 命令

```bash
# 查看帮助
talor --help

# 查看版本
talor --version

# 启动服务器
talor serve [OPTIONS]
  --host TEXT          绑定主机地址 [默认: 127.0.0.1]
  --port INTEGER       绑定端口 [默认: 8000]
  --reload             启用自动重载（开发模式）
  --workers INTEGER    Worker 进程数 [默认: 1]
  --log-level TEXT     日志级别 [默认: INFO]

# 配置管理
talor config [COMMAND]
  show                 显示当前配置
  validate             验证配置文件
  init                 初始化配置文件

# MCP 管理
talor mcp [COMMAND]
  list                 列出 MCP 服务器
  start SERVER         启动 MCP 服务器
  stop SERVER          停止 MCP 服务器
  restart SERVER       重启 MCP 服务器
```

#### Make 命令（开发）

```bash
# 查看所有命令
make help

# 安装
make install         # 安装包
make install-dev     # 安装开发依赖
make install-all     # 安装所有依赖

# 测试
make test            # 运行测试
make test-cov        # 运行测试并生成覆盖率

# 代码质量
make format          # 格式化代码
make lint            # 代码检查
make typecheck       # 类型检查
make check           # 运行所有检查

# 构建
make build           # 构建 Python 包
make build-exe       # 构建可执行文件
make docker          # 构建 Docker 镜像

# 清理
make clean           # 清理构建文件
```

### B. 数据库架构

#### Sessions 表

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    metadata TEXT NOT NULL  -- JSON 格式的 SessionInfo
);

CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);
```

#### Messages 表

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    metadata TEXT,  -- JSON 格式的额外数据
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
```

#### Message Parts 表

```sql
CREATE TABLE message_parts (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    metadata TEXT,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_message_parts_message_id ON message_parts(message_id);
```

### C. 事件类型完整列表

| 事件类型 | 数据字段 | 描述 |
|---------|---------|------|
| `session.created` | info: SessionInfo | 会话创建 |
| `session.updated` | info: SessionInfo | 会话更新 |
| `session.deleted` | info: SessionInfo | 会话删除 |
| `message.created` | session_id, message_id, role, content | 消息创建 |
| `message.updated` | session_id, message_id, role, content | 消息更新 |
| `message.part.created` | session_id, message_id, part_id, part_type | 消息部分创建 |
| `stream.text` | session_id, message_id, content | 流式文本 |
| `stream.tool_call` | session_id, message_id, tool, call_id, arguments | 工具调用 |
| `stream.tool_result` | session_id, message_id, tool, call_id, output, error | 工具结果 |
| `stream.done` | session_id, message_id, reason | 流式完成 |
| `stream.error` | session_id, message_id, error | 流式错误 |
| `permission.request` | session_id, tool_name, arguments, request_id | 权限请求 |
| `permission.response` | request_id, allowed, remember | 权限响应 |
| `mcp.server.connected` | server_name | MCP 服务器连接 |
| `mcp.server.disconnected` | server_name, error | MCP 服务器断开 |
| `mcp.tool.discovered` | server_name, tool_name | MCP 工具发现 |
| `server.instance.disposed` | directory | 实例销毁 |

### D. 工具权限模式

#### 通配符模式

```yaml
permissions:
  rules:
    - tool_pattern: "*"              # 匹配所有工具
      action: "allow"

    - tool_pattern: "read_*"         # 匹配所有 read_ 开头的工具
      action: "allow"

    - tool_pattern: "write_*"        # 匹配所有 write_ 开头的工具
      action: "ask"

    - tool_pattern: "execute_*"      # 匹配所有 execute_ 开头的工具
      action: "deny"

    - tool_pattern: "mcp_*"          # 匹配所有 MCP 工具
      action: "ask"

    - tool_pattern: "mcp_playwright_*"  # 匹配特定 MCP 服务器的工具
      action: "allow"
```

#### 嵌套模式

```yaml
permissions:
  rules:
    - tool_pattern: "read"
      action: "allow"
      nested:
        - file_pattern: "*.env"      # 特定文件需要询问
          action: "ask"
        - file_pattern: "*.env.*"
          action: "ask"
        - file_pattern: "*.env.example"
          action: "allow"
```

#### MCP 工具权限配置

```yaml
# 针对 MCP 工具的权限配置
permissions:
  rules:
    # 允许所有 Playwright 工具
    - tool_pattern: "mcp_playwright_*"
      action: "allow"
      scope: "session"

    # 询问文件系统 MCP 工具
    - tool_pattern: "mcp_filesystem_*"
      action: "ask"
      scope: "once"

    # 拒绝特定的危险 MCP 工具
    - tool_pattern: "mcp_filesystem_delete"
      action: "deny"
      scope: "always"

    # 自动批准特定工具（在 MCP 服务器配置中）
mcp_servers:
  playwright:
    auto_approve:
      - "navigate"
      - "screenshot"
    # 这些工具会自动添加 allow 权限
```

#### 作用域

- `always`: 永久记住决定
- `session`: 会话期间记住
- `once`: 仅本次有效

### E. MCP 工具集成完整示例

#### 示例 1: 集成 Playwright MCP 服务器

```yaml
# config.yaml
mcp_servers:
  playwright:
    transport: "stdio"
    command: "npx"
    args:
      - "@playwright/mcp@latest"
    env:
      NODE_ENV: "production"
    auto_approve:
      - "navigate"
      - "screenshot"
    timeout: 60.0
```

```python
# 后端代码
from talor import MCP, ToolRegistry, Agent
from talor.tool import ToolContext

# 1. 连接 MCP 服务器
status = await MCP.connect("playwright", {
    "transport": "stdio",
    "command": "npx",
    "args": ["@playwright/mcp@latest"]
})

print(f"Status: {status.status}")  # connected

# 2. 获取工具列表
tools = await MCP.tools("playwright")
for tool in tools:
    print(f"- {tool.name}: {tool.description}")

# 输出:
# - navigate: Navigate to a URL
# - screenshot: Take a screenshot
# - click: Click an element
# - fill: Fill a form field
# - evaluate: Execute JavaScript

# 3. 工具自动注册到 ToolRegistry
registry = ToolRegistry()
all_tools = await registry.list(source="mcp")

# 输出:
# [
#   {
#     "name": "mcp_playwright_navigate",
#     "description": "Navigate to a URL",
#     "parameters": {...},
#     "source": "mcp"
#   },
#   ...
# ]

# 4. LLM 使用工具
llm_tools = await registry.get_llm_definitions()
# 传递给 LLM 的 tools 参数

# 5. 执行 MCP 工具
context = ToolContext(
    session_id="session_123",
    message_id="msg_456",
    directory="/workspace",
    call_id="call_abc"
)

result = await registry.execute(
    tool_name="mcp_playwright_navigate",
    arguments={"url": "https://example.com"},
    context=context
)

print(result.output)  # "Navigated to https://example.com"
```

#### 示例 2: 集成自定义 MCP 服务器（HTTP 模式）

```yaml
# config.yaml
mcp_servers:
  custom_api:
    transport: "http"
    url: "https://api.example.com/mcp"
    headers:
      Authorization: "Bearer ${CUSTOM_API_TOKEN}"
    timeout: 30.0
```

```python
# 后端代码
import os

# 设置环境变量
os.environ["CUSTOM_API_TOKEN"] = "your-token-here"

# 连接到远程 MCP 服务器
await MCP.connect("custom_api", {
    "transport": "http",
    "url": "https://api.example.com/mcp",
    "headers": {
        "Authorization": f"Bearer {os.environ['CUSTOM_API_TOKEN']}"
    }
})

# 使用远程 MCP 工具
result = await MCP.call_tool(
    server="custom_api",
    tool_name="analyze_data",
    arguments={"data": [1, 2, 3, 4, 5]}
)
```

#### 示例 3: 权限控制 MCP 工具

```yaml
# config.yaml
agent:
  build:
    permission:
      # 默认允许所有工具
      "*": "allow"

      # MCP 工具需要询问
      "mcp_*": "ask"

      # 但 Playwright 的只读操作自动允许
      "mcp_playwright_navigate": "allow"
      "mcp_playwright_screenshot": "allow"

      # 危险操作拒绝
      "mcp_filesystem_delete": "deny"
```

### F. 性能基准

#### 后端性能

| 操作 | 平均响应时间 | QPS |
|------|-------------|-----|
| 创建会话 | 10ms | 1000 |
| 获取会话列表 | 5ms | 2000 |
| 获取消息历史 | 15ms | 800 |
| 流式响应（首字节） | 200ms | - |
| 工具执行 | 50-500ms | - |

#### 前端性能

| 指标 | 目标值 | 实际值 |
|------|-------|-------|
| 首次内容绘制（FCP） | < 1.5s | ~1.2s |
| 最大内容绘制（LCP） | < 2.5s | ~2.0s |
| 首次输入延迟（FID） | < 100ms | ~50ms |
| 累积布局偏移（CLS） | < 0.1 | ~0.05 |

### F. 故障排查清单

#### 后端问题

- [ ] 检查 Python 版本（≥3.11）
- [ ] 检查依赖是否安装完整
- [ ] 检查配置文件是否正确
- [ ] 检查 API keys 是否设置
- [ ] 检查端口是否被占用
- [ ] 检查数据库文件权限
- [ ] 查看日志文件
- [ ] 检查防火墙规则

#### 前端问题

- [ ] 检查 Node.js 版本（≥18）
- [ ] 检查依赖是否安装完整
- [ ] 检查后端是否运行
- [ ] 检查 API 地址配置
- [ ] 清除浏览器缓存
- [ ] 检查浏览器控制台错误
- [ ] 检查网络请求
- [ ] 验证 CORS 配置

#### 连接问题

- [ ] 检查网络连接
- [ ] 检查防火墙设置
- [ ] 验证 SSL 证书
- [ ] 检查代理配置
- [ ] 测试 SSE 连接
- [ ] 检查超时设置

### G. 贡献指南

#### 提交代码

1. Fork 项目
2. 创建特性分支：`git checkout -b feature/my-feature`
3. 提交更改：`git commit -am 'Add my feature'`
4. 推送分支：`git push origin feature/my-feature`
5. 创建 Pull Request

#### 代码规范

- 遵循 PEP 8（Python）
- 遵循 Airbnb Style Guide（TypeScript）
- 编写单元测试
- 更新文档
- 添加类型注解

#### 提交信息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

类型：
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具

### H. 许可证

本项目采用 MIT 许可证。详见 [LICENSE](talor/LICENSE) 文件。

### I. 联系方式

- **项目主页**: https://github.com/talor-dev/talor
- **文档**: https://talor.dev/docs
- **问题反馈**: https://github.com/talor-dev/talor/issues
- **讨论**: https://github.com/talor-dev/talor/discussions
- **邮件**: team@talor.dev

---

## 更新日志

### v0.1.0 (2024-01-XX)

**初始版本**

- ✨ 实现事件驱动架构
- ✨ 支持多 LLM 提供商（OpenAI、Anthropic、Ollama）
- ✨ 集成 MCP 协议
- ✨ 实现会话管理系统
- ✨ 实现 Agent 系统
- ✨ 实现工具系统
- ✨ 实现权限控制
- ✨ 提供 Web GUI 界面
- ✨ 支持流式响应
- ✨ 支持 SSE 事件流
- 📝 完善项目文档
- 🧪 添加单元测试
- 🐳 提供 Docker 支持

---

**文档版本**: 1.0.0
**最后更新**: 2024-01-XX
**维护者**: Talor Team

