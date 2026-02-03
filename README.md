# Talor

Talor 是一个基于 ReAct（推理 + 行动）架构的通用 AI Agent 框架，通过推理、工具执行、结果观察的迭代循环来处理用户请求。

## 核心特性

- **ReAct 架构** - 显式的推理-行动-观察循环，智能处理复杂任务
- **多 LLM 支持** - 通过 LiteLLM 支持 OpenAI、Anthropic、Ollama 等多种模型
- **MCP 集成** - Model Context Protocol 工具扩展协议
- **事件驱动** - 通过事件总线实现组件松耦合和实时通信
- **插件系统** - 可扩展的 Prompt 构建插件
- **记忆系统** - 短期和长期记忆管理

## 项目结构

```
talor/          # Python 后端 - Agent 核心、API 服务、工具、记忆、插件
talor-gui/      # React 前端 - 与 Agent 交互的 Web 界面
```

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+

### 后端启动

```bash
cd talor

# 创建虚拟环境
python -m venv venv
source venv/bin/activate

# 安装依赖
pip install -e ".[dev]"

# 配置（复制示例配置并编辑）
cp config.example.yaml config.yaml

# 启动服务
talor serve    # http://127.0.0.1:8000
```

### 前端启动

```bash
cd talor-gui

# 安装依赖
npm install

# 启动开发服务器
npm run dev    # http://localhost:5173
```

## 技术栈

### 后端

| 类别 | 技术 |
|------|------|
| 语言 | Python 3.11+ |
| 框架 | FastAPI + Uvicorn |
| LLM | LiteLLM |
| MCP | FastMCP |
| 数据验证 | Pydantic v2 |
| 存储 | aiosqlite |
| 测试 | pytest, hypothesis |

### 前端

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript |
| 框架 | React 19 |
| 构建 | Vite |
| 状态管理 | Zustand |
| 样式 | TailwindCSS v4 |
| 国际化 | i18next |
| 测试 | Vitest, fast-check |

## 核心概念

- **Session（会话）** - 包含消息和记忆的对话上下文
- **Agent（代理）** - 配置了模型、权限和能力的 AI 实体
- **Tool（工具）** - 可执行的操作（bash、文件操作等）
- **Plugin（插件）** - 贡献系统提示词的构建器
- **Bus（事件总线）** - 组件间通信的事件系统

## 开发命令

### 后端

```bash
cd talor
source venv/bin/activate

# 测试
pytest tests/ -v
pytest --cov=talor

# 代码质量
black src/ tests/
ruff check src/ tests/
mypy src/
make check
```

### 前端

```bash
cd talor-gui

# 测试
npm run test:run
npm run test:coverage

# 代码质量
npm run format
npm run lint:fix
```

## API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/session` | 获取会话列表 |
| POST | `/api/session` | 创建新会话 |
| GET | `/api/session/{id}` | 获取会话详情 |
| DELETE | `/api/session/{id}` | 删除会话 |
| POST | `/api/session/prompt` | 发送消息给 Agent |
| GET | `/event?session_id={id}` | SSE 事件流 |
| GET | `/api/agent` | 获取 Agent 列表 |
| GET | `/api/provider` | 获取 LLM 提供商列表 |
| GET | `/api/config` | 获取配置 |
| PUT | `/api/config` | 更新配置 |

## 许可证

MIT
