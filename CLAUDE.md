# Talor — AI Agent 平台

## 这是什么
AI Agent 平台，支持构建、定义和运行 Agent，服务于需要自动化 AI 工作流的开发者和企业用户。

技术栈：React 19 + TypeScript + FastAPI + SQLite + LiteLLM
仓库结构：Monorepo，`talor/`（后端）、`talor-gui/`（桌面前端）、`agents/`（Agent 定义）

## 当前开发重点（每周更新）
正在进行：feat-desktop 分支 — 桌面客户端功能与增加 Agent 后台工作能力
近期完成：Agent 契约模型重写、技能系统（skill）、后台任务系统、UI 布局优化（固定窗口尺寸+自动滚动）、Ollama 集成修复
已知阻塞：暂无

---

## Agent 两层架构

```
平台 Agent（kind=platform）            业务 Agent（kind=worker）
─────────────────────────             ──────────────────────────────
无 Agent 契约，代码内联配置             有完整 Agent 契约（JSONC 定义）
build    通用执行员（核心引擎）         agents/*.jsonc 加载
plan     任务规划员                    支持 role / capabilities /
explore  信息探索员（subagent）         workflow / input_spec /
general  通用研究员（subagent）         delivery_standard / manual

加载路径：
  平台 Agent 默认值 ← 代码硬编码（agent.py）
  平台 Agent 覆盖  ← .talor/agents/{id}.jsonc（可选）
  业务 Agent      ← {workspace}/agents/*.jsonc
```

---

## 环境配置

```
前提条件：Python 3.11+，Node 20+，Ollama（本地）或 API Key

talor/config.json 关键字段：
  default_model: "ollama/qwen3:4b"      # 格式：provider_id/model_id
  providers.ollama.base_url: "http://localhost:11434/v1"

可选环境变量（talor/.env）：
  OPENAI_API_KEY=sk-...
  ANTHROPIC_API_KEY=sk-ant-...
  GOOGLE_API_KEY=...
```

---

## 🚫 禁止操作
- 修改 `venv/` 目录（Python 虚拟环境，不纳入版本控制）
- 删除或重命名 SQLite 表字段（需单独迁移脚本）
- 升级 major 版本依赖（需单独评估影响）
- 修改 `.env.example` 的 key 名
- 超过 5 个文件的改动，必须先列清单等确认

---

## 快速命令

| 操作 | 命令 |
|------|------|
| 后端全检 | `cd talor && make check` |
| 后端测试 | `cd talor && make test` |
| 后端类型检查 | `cd talor && make typecheck` |
| 前端测试 | `cd talor-gui && npm run test:run` |
| 前端检查 | `cd talor-gui && npm run lint` |

---

## 常见开发场景速查

| 场景 | 涉及文件 | 启动方式 |
|------|----------|----------|
| 新增 Agent | `agents/*.jsonc` + `manuals/*.md` | `/feature 新 Agent 名称` |
| 新增 API 端点 | `src/api/routes/*.py` + `src/api/models.py` + `tests/api/` | `/tdd 端点名称` |
| 新增内置工具 | `src/tool/builtin/*.py` + `tests/tool/` | `/tdd 工具名称` |
| 新增前端组件 | `src/components/<模块>/` + `*.test.tsx` | `/tdd 组件名称` |
| 修复 Bug | 定位具体文件 | `/fix <文件路径> <问题描述>` |
| 代码审查 | 当前分支改动 | `/review` |

---

## 工作方式约定
- **先计划后执行**：复杂任务先输出方案等确认，再动手（使用 `/feature`）
- **测试先行（TDD）**：写失败测试 → 最小实现 → 重构（使用 `/tdd`）
- **最小化改动**：只改任务相关代码，不"顺手重构"
- **发现不改**：发现无关 bug 时，标注并告知，不自行修复
- **分段验证**：每完成一个逻辑单元，运行 `make typecheck`（后端）或 `npm run lint`（前端）
- **不加功能**：不添加任何未被要求的功能（YAGNI）
- **不向后兼容**：一律采用最优方案，不考虑向后兼容


---

## 斜杠命令
- `/review` — 审查当前分支相对 main 的所有改动
- `/fix <文件路径> <问题描述>` — 定向修复，不改其他文件
- `/feature <功能描述>` — 新功能开发（先调研 → 出方案等确认 → 再实现）
- `/tdd <功能描述>` — TDD 工作流（先写失败测试 → 再写实现）

---

## 模块文档（需要时再读，不要全量加载）

| 模块 | 文档 |
|------|------|
| 后端 FastAPI | `talor/CLAUDE.md` |
| 前端 React | `talor-gui/CLAUDE.md` |
| Agent 定义规范 | `agents/CLAUDE.md` |
| 整体架构 | `talor/docs/ARCHITECTURE.md` |
| 数据库 Schema | `talor/src/core/storage.py` |
| Agent 模型 | `talor/src/agent/agent.py`（顶部注释） |
| 技能系统 | `talor/src/skill/`（各文件头部） |
| 待办任务 | `talor/docs/REMAINING_TASKS.md` |
| 手动测试指南 | `talor/docs/manual-testing-guide.md` |
