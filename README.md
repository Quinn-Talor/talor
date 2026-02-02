# Talor - 通用 AI Agent 框架

Talor 是一个基于 ReAct (Reasoning + Acting) 架构的通用 AI Agent 框架，通过推理/规划、工具调用、结果观察的循环，智能处理用户诉求。

## 核心特性

- **ReAct 架构**: 显式的推理-行动-观察循环
- **事件驱动**: 基于事件总线的松耦合设计
- **多 LLM 支持**: OpenAI、Anthropic、Ollama 等
- **MCP 集成**: Model Context Protocol 工具扩展
- **记忆系统**: 短期/长期记忆管理
- **现代化 GUI**: React + TypeScript Web 界面

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+

### 安装

```bash
# 后端
cd talor
python -m venv venv
source venv/bin/activate
pip install -e ".[dev]"

# 前端
cd talor-gui
npm install
```

### 运行

```bash
# 后端 (http://127.0.0.1:8000)
cd talor && source venv/bin/activate && talor serve

# 前端 (http://localhost:5173)
cd talor-gui && npm run dev
```

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      ReAct Loop                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │ Reasoning│───▶│  Action  │───▶│Observation│────┐        │
│   │  (推理)  │    │  (行动)  │    │  (观察)   │    │        │
│   └──────────┘    └──────────┘    └──────────┘    │        │
│        ▲                                          │        │
│        └──────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## 项目结构

```
talor/
├── talor/                  # 后端 (Python)
│   └── src/
│       ├── agent/         # Agent 系统 & ReAct 循环
│       ├── memory/        # 记忆系统
│       ├── bus/           # 事件总线
│       ├── tool/          # 工具系统
│       ├── provider/      # LLM 提供商
│       ├── mcp/           # MCP 集成
│       └── api/           # REST API
└── talor-gui/             # 前端 (React)
    └── src/
        ├── components/    # UI 组件
        ├── api/           # API 客户端
        └── store/         # 状态管理
```

## 文档

- [架构设计](ARCHITECTURE_REDESIGN.md) - ReAct 架构详解
- [项目文档](PROJECT_DOCUMENTATION.md) - 完整 API 文档

## 技术栈

| 后端 | 前端 |
|------|------|
| Python 3.11+ | React 19 |
| FastAPI | TypeScript |
| Pydantic | Vite |
| LiteLLM | Zustand |
| FastMCP | TailwindCSS |

## 开发

```bash
# 运行测试
cd talor && pytest tests/ -v

# 代码格式化
cd talor && black src/ tests/
cd talor-gui && npm run format
```

## License

MIT
