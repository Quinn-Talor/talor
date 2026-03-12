# Talor 后端（FastAPI + LiteLLM + SQLite）

## 常用命令

```bash
make install-dev   # 安装含开发依赖
make test          # pytest 全量测试
make test-cov      # 带覆盖率报告（HTML + 终端）
make format        # black 代码格式化
make lint          # ruff 代码检查
make typecheck     # mypy 类型检查（改完必跑）
make check         # 全部检查（format + lint + typecheck + test）
```

---

## TDD 规范

**写失败测试 → 最小实现 → 重构 → 重复**

- 测试在 `tests/`，目录结构镜像 `src/`
  - `src/agent/agent.py` → `tests/agent/test_agent.py`
  - `src/api/routes/agents.py` → `tests/api/test_agents.py`
- 使用 `pytest` + `pytest-asyncio`；异步测试标注 `@pytest.mark.asyncio`
- 复杂业务逻辑用 `hypothesis` 做属性测试
- 运行单个测试：`pytest tests/agent/test_agent.py -v`
- 运行单个用例：`pytest tests/agent/test_agent.py::test_build_prompt -v`

---

## 目录结构

```
src/
    agent/          # Agent 核心模型（agent.py、executor.py）
  api/
    routes/       # HTTP 路由层（只做参数验证 + 调用业务逻辑）
    models.py     # Pydantic 请求/响应模型
    app.py        # FastAPI 应用入口
  core/           # 基础设施（storage.py、config.py、workspace.py）
  skill/          # 技能系统（parser、loader、registry、matcher）
  plugin/         # 插件架构（builtin 插件）
  tool/builtin/   # 内置工具（bash、read、write、edit、glob、grep、ls）
  provider/       # LLM Provider 抽象层（LiteLLM 封装）
  session/        # 会话管理（session.py、message.py）
  mcp_client/     # MCP 协议客户端
  memory/         # 上下文与记忆管理
  bus/            # 事件总线（SSE 事件分发）
tests/            # 镜像 src/ 结构
docs/             # 模块级深度文档
```

---

## 代码参考（新代码对照这些写，不要引入新模式）

| 场景 | 参考文件 |
|------|----------|
| API 路由 | `src/api/routes/agents.py` |
| 业务逻辑（Agent 模型） | `src/agent/agent.py` |
| ReAct 执行器 | `src/agent/executor.py` |
| 数据库查询 | `src/core/storage.py` |
| 路由集成测试 | `tests/api/` |
| Agent 单元测试 | `tests/agent/` |

---

## API 端点速查

```
GET  /                                    # 平台信息
GET  /api/agents                          # 列表（?kind=worker|platform）
GET  /api/agents/{id}                     # 详情
GET  /api/agents/{id}/system-prompt       # 业务 Agent 系统提示词

POST /api/sessions                        # 创建会话
GET  /api/sessions                        # 会话列表
DELETE /api/sessions/{id}                 # 删除会话

POST /api/session/prompt/async            # 异步发消息（fire-and-forget）
POST /api/session/prompt                  # 同步发消息（SSE 流式响应）
GET  /event?session_id=                   # SSE 实时事件流
```

**SSE 事件类型：**
`session.created` → `message.created` → `agent.started` → `stream.text`（多次）→ `message.updated` → `agent.completed` → `stream.done`

---

## Provider 配置

```
模型字符串格式：provider_id/model_id
  ollama/qwen3:4b
  anthropic/claude-sonnet-4-20250514
  openai/gpt-4o

LiteLLM 路由规则（src/provider/provider.py）：
  ollama/*  → ollama_chat/{model_id}，api_base = http://localhost:11434
  openai/*  → openai/{model_id}，api_base = https://api.openai.com/v1
  anthropic/* → anthropic/{model_id}
  google/*  → gemini/{model_id}

注意：Ollama 传给 LiteLLM 的 api_base 不含 /v1（native API 用 /api/chat）
```

---

## 深度文档（需要时再读）

| 文档 | 路径 |
|------|------|
| 整体架构 | `docs/ARCHITECTURE.md` |
| 数据库 Schema | `src/core/storage.py` |
| 技能系统 | `src/skill/`（各文件头部） |
| Agent 模型 | `src/agent/agent.py`（顶部注释） |
| 测试报告 | `docs/test-results-report.md` |
| 手动测试指南 | `docs/manual-testing-guide.md` |
| 待办任务 | `docs/REMAINING_TASKS.md` |
