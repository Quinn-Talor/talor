# Talor — AI 数字员工平台

> 为每个业务场景定义一名数字员工，让 AI Agent 像人一样有岗位、有职责、有交付标准。

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![LiteLLM](https://img.shields.io/badge/LiteLLM-1.30+-purple)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## 这是什么

Talor 是一个 AI 数字员工平台。你可以用 JSONC 文件定义一名数字员工——赋予她职位名称、能力范围、工作流程和交付标准——平台负责将她的"员工契约"转化为系统提示词，驱动 ReAct 执行引擎完成任务。

**类比**：如果说传统 AI 助手是"全能客服"，Talor 让你雇一名"专职数据分析师"或"代码审查员"，她只做自己岗位上的事，并按照约定的标准交付结果。

---

## 核心特性

- 🏢 **员工契约模型** — JSONC 定义角色、能力、工作流程、输入规范、交付标准，结构清晰可版本管理
- ⚡ **ReAct 执行引擎** — Reason-Act 循环，支持多步推理、工具调用、子 Agent 委派
- 🔌 **多模型支持** — Ollama（本地）/ OpenAI / Anthropic / Google，通过 LiteLLM 统一接入，一行配置切换
- 🛠️ **内置工具集** — `bash`、`read`、`write`、`edit`、`glob`、`grep`、`ls`，开箱即用
- 🌐 **MCP 协议** — 支持 Model Context Protocol，可接入任意外部工具服务
- 🖥️ **桌面 UI** — React 19 + Zustand，实时 SSE 流式对话，支持多会话管理

---

## 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                      Talor 数字员工平台                        │
│                                                              │
│  平台员工（内置，代码定义）      业务员工（用户定义，JSONC）      │
│  ──────────────────────        ────────────────────────────  │
│  build   通用执行员             employees/xxx.jsonc           │
│  plan    任务规划员             ├── role（角色定义）            │
│  explore 探索员（subagent）     ├── capabilities（能力范围）    │
│  general 研究员（subagent）     ├── workflow（工作流程）        │
│                                ├── delivery_standard（交付）  │
│                                └── manual → manuals/*.md     │
│                                                              │
│  ┌─────────────┐  HTTP + SSE  ┌───────────────────────────┐ │
│  │  React GUI  │ ──────────── │  FastAPI + ReAct Executor  │ │
│  │  (port 5173)│              │  LiteLLM → Ollama / API    │ │
│  └─────────────┘              └───────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**两层加载路径：**
```
平台员工  ← agent.py 硬编码默认值  ←（可选）.talor/agents/{id}.jsonc 覆盖
业务员工  ←  {workspace}/employees/*.jsonc
```

---

## 快速开始

**前提条件**：Python 3.11+，Node 20+，[Ollama](https://ollama.com)（或 API Key）

```bash
# 1. 安装后端
git clone https://github.com/your-org/talor.git
cd talor/talor
make install-dev

# 2. 准备模型（选其一）
ollama pull qwen3:4b                          # 本地模型（推荐体验）
# 或在 talor/config.json 中配置 API Key

# 3. 启动后端
uvicorn src.api.app:app --reload --port 8000

# 4. 启动前端（新终端）
cd ../talor-gui
npm install && npm run dev                    # http://127.0.0.1:5173
```

打开 `http://127.0.0.1:5173`，选择会话，开始与 `build`（通用执行员）对话。

---

## 定义你的数字员工

在工作区的 `employees/` 目录下新建 `.jsonc` 文件：

```jsonc
// employees/my-analyst.jsonc
{
  "id": "my-analyst",
  "name": "我的数据分析师",
  "role": {
    "title": "数据分析师",
    "persona": "擅长数据清洗、统计分析和可视化的专业分析师",
    "responsibilities": ["理解分析需求", "探索数据质量", "输出分析报告"]
  },
  "capabilities": {
    "domains": ["data_analysis", "statistics", "python"],
    "proficiency": { "pandas": "expert", "sql": "advanced" },
    "constraints": ["不执行生产数据库写操作"]
  },
  "workflow": {
    "type": "sequential",
    "steps": [
      { "id": "understand", "name": "理解需求", "description": "明确分析目标" },
      { "id": "analyze",    "name": "执行分析", "description": "运行分析代码" },
      { "id": "report",     "name": "输出报告", "description": "撰写分析结论" }
    ]
  },
  "dependencies": { "tools": ["read", "write", "bash"] },
  "delivery_standard": {
    "success_definition": "提供有数据支撑的可操作洞察，附带 Markdown 报告"
  },
  "manual": "manuals/my-analyst.md"   // 可选：追加 SOP / 领域知识
}
```

重启后端后，通过 `GET /api/agents?kind=worker` 验证加载成功，即可在 UI 中选择该员工发起对话。

参考模板：[`employees/code-reviewer.jsonc`](employees/code-reviewer.jsonc)、[`employees/data-analyst.jsonc`](employees/data-analyst.jsonc)

---

## 模型配置

编辑 `talor/config.json`：

```jsonc
{
  "default_model": "ollama/qwen3:4b",    // provider_id/model_id

  // 切换到 Claude（需 ANTHROPIC_API_KEY 环境变量）
  // "default_model": "anthropic/claude-sonnet-4-20250514",

  // 切换到 GPT-4o（需 OPENAI_API_KEY 环境变量）
  // "default_model": "openai/gpt-4o"
}
```

支持的 Provider：`ollama` / `openai` / `anthropic` / `google`（通过 LiteLLM 扩展更多）

---

## 开发指南

项目遵循 **TDD**（测试先行）工作流：写失败测试 → 最小实现 → 重构。

```bash
# 后端（talor/）
make check         # 全检：format + lint + typecheck + test
make test          # 仅运行 pytest
make typecheck     # mypy 类型检查（每次改完必跑）

# 前端（talor-gui/）
npm run test:run   # Vitest 单次运行
npm run lint       # ESLint 检查

# 启动服务（用于本地测试）
# 详见 .claude/launch.json（Claude Code preview 配置）
```

详细开发规范见：[`CLAUDE.md`](CLAUDE.md) | [`talor/CLAUDE.md`](talor/CLAUDE.md) | [`talor-gui/CLAUDE.md`](talor-gui/CLAUDE.md)

---

## 目录结构

```
talor/              # Python 后端（FastAPI + LiteLLM + SQLite）
  src/
    agent/          # 数字员工模型 + ReAct 执行器
    api/            # HTTP 路由层
    tool/builtin/   # 内置工具（bash、read、write …）
    provider/       # LLM Provider 抽象（LiteLLM 封装）
    skill/          # 技能系统
    mcp_client/     # MCP 协议客户端
  tests/            # 测试（镜像 src/ 结构）

talor-gui/          # React 19 桌面前端
  src/
    components/     # UI 组件（chat、session、settings …）
    store/          # Zustand 状态管理
    api/            # 后端 API 客户端
    hooks/          # useEvents（SSE）等

employees/          # 数字员工定义（.jsonc）+ 手册（manuals/*.md）
```

---

## License

MIT © 2024 Talor
