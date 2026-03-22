# Talor — AI 数字员工平台

## 这是什么
AI 数字员工平台，支持构建、定义和运行数字员工 Agent，服务于需要自动化 AI 工作流的开发者和企业用户。

技术栈：React 19 + TypeScript + FastAPI + SQLite + LiteLLM
仓库结构：Monorepo，`talor/`（后端）、`talor-gui/`（桌面前端）、`employees/`（数字员工定义）

## 当前开发重点（每周更新）
正在进行：Phase 2.3 完成，准备 Phase 3（数字员工契约 + Tool 调用）
近期完成：Phase 1 ✅（talor-desktop 桌面客户端框架 + Provider CRUD）、Phase 2.1 ✅（流式 MVP）、Phase 2.2 ✅（会话管理 + Markdown）、Phase 2.3 ✅（消息附件）
已知阻塞：暂无

## Talor Desktop Phase 2 ✅ 已完成（2026-03-22）
- `vibe/features/talor-desktop-phase2/` — Phase 2 完整文档包（L2 Requirements + L3 FEATURE + L4 IMPLEMENTATION）
- 架构：纯 Electron + TypeScript + Vercel AI SDK + SQLite（better-sqlite3）
- SSE 模式：main process fetch → webContents.send() per chunk → renderer rAF batching
- 阶段：Phase 2.1 ✅（流式 MVP）→ Phase 2.2 ✅（会话管理）→ Phase 2.3 ✅（附件）→ Phase 3（Tool 调用 + 数字员工契约）
- 启动：`cd talor-desktop && npm run dev`
- 文档：`vibe/features/talor-desktop-phase2/REQUIREMENTS.md`（L2）、`FEATURE-talor-phase2.md`（L3）、`IMPLEMENTATION.md`（L4）

## Talor Desktop Phase 1 ✅ 已完成（2026-03-21）
- `talor-desktop/` — Electron 桌面客户端（Phase 1 scope 完成）
- 架构：main/preload/renderer 三层分离，IPC + contextBridge
- 功能：Provider CRUD（list/create/update/delete/setDefault）、连接测试、API Key 加密存储
- 启动：`cd talor-desktop && npm run dev`
- 文档：`vibe/overviews/OVERVIEW-talor-desktop.md`（L1 现状）、`vibe/features/talor-desktop-phase1/`（已归档）

---

## Agent 两层架构

```
平台员工（kind=platform）             业务员工（kind=worker）
─────────────────────────             ──────────────────────────────
无员工契约，代码内联配置               有完整员工契约（JSONC 定义）
build    通用执行员（核心引擎）         employees/*.jsonc 加载
plan     任务规划员                    支持 role / capabilities /
explore  信息探索员（subagent）         workflow / input_spec /
general  通用研究员（subagent）         delivery_standard / manual

加载路径：
  平台员工默认值 ← 代码硬编码（agent.py）
  平台员工覆盖  ← .talor/agents/{id}.jsonc（可选）
  业务员工      ← {workspace}/employees/*.jsonc
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
- 直接修改 `employees/` 下的示例文件（作为参考模板保留）

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
| 新增数字员工 | `employees/*.jsonc` + `manuals/*.md` | `/feature 新员工名称` |
| 新增 API 端点 | `src/api/routes/*.py` + `src/api/models.py` + `tests/api/` | `/tdd 端点名称` |
| 新增内置工具 | `src/tool/builtin/*.py` + `tests/tool/` | `/tdd 工具名称` |
| 新增前端组件 | `src/components/<模块>/` + `*.test.tsx` | `/tdd 组件名称` |
| 修复 Bug | 定位具体文件 | `/fix <文件路径> <问题描述>` |
| 代码审查 | 当前分支改动 | `/review` |
| Phase 2 实施 | `vibe/features/talor-desktop-phase2/runtime/SESSION-START.md` | 读会话起点 → 选 IMPL → 开始编码 |
| Phase 2.1 AC 验证 | `vibe/features/talor-desktop-phase2/phase-guard/phase-2.1.md` | Phase 2.1 完成后填写 |
| Phase 2.2 AC 验证 | `vibe/features/talor-desktop-phase2/phase-guard/phase-2.2.md` | Phase 2.2 完成后填写 |
| Phase 2.3 AC 验证 | `vibe/features/talor-desktop-phase2/phase-guard/phase-2.3.md` | Phase 2.3 完成后填写 |

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
| 数字员工定义规范 | `employees/CLAUDE.md` |
| 整体架构 | `talor/docs/ARCHITECTURE.md` |
| 数据库 Schema | `talor/src/core/storage.py` |
| Agent 模型 | `talor/src/agent/agent.py`（顶部注释） |
| 技能系统 | `talor/src/skill/`（各文件头部） |
| 待办任务 | `talor/docs/REMAINING_TASKS.md` |
| 手动测试指南 | `talor/docs/manual-testing-guide.md` |
