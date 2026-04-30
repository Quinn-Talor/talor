# Talor — AI 协作指南

> 本文档给读 Talor 代码库的 AI agent（Claude Code / Copilot CLI / Codex 等）一个**最快上手入口**。
> 面向工程师的版本参见 `docs/engineering/`。

---

## 1. 项目一句话

Talor 是 **Electron + TypeScript 桌面 AI Agent 应用**（v0.1.0，Apache 2.0 + Commons Clause）。

- 前端：React 19 + Tailwind + Zustand
- 模型层：Vercel AI SDK（Anthropic / OpenAI / Google / Ollama）
- 工具：7 个内置工具（bash / read / write / edit / glob / grep / ls）+ MCP 外部工具
- 持久化：better-sqlite3 (sessions, messages, mcp_servers, session_summaries)

---

## 2. 代码地图

```
src/
├── main/                   Electron 主进程(Node 环境)
│   ├── ipc/               入口层:IPC handlers(不得被业务层依赖)
│   ├── chat/              业务层:chat:send 用例编排、事件总线
│   ├── agent/             业务层:Agent 定义、变量解析、delegate
│   ├── tools/             业务层:工具注册表、内置 7 工具、path-guard
│   │   └── builtin/      bash / read / write / edit / glob / grep / ls
│   ├── loop/              业务层:ReAct 循环、stream utils、quote-verifier
│   ├── prompt/            业务层:prompt pipeline + plugins(System/Agent/Memory/Message/ToolSelection)
│   ├── memory/            业务层:ShortTermMemory (压缩 + 锚点)
│   ├── mcp/               业务层:MCP 协议客户端(stdio / http transport)
│   ├── permissions/       业务层:权限规则、path matcher
│   ├── providers/         业务层:LLM provider 工厂
│   ├── skills/            业务层:skill 注册表
│   ├── repos/             基础设施:session/message/mcp-server CRUD
│   ├── db/                基础设施:SQLite 初始化、schema 迁移
│   ├── store/             基础设施:ConfigStore (electron-store)
│   └── services/          基础设施:safe-storage 等
├── preload/               preload 脚本(contextBridge API 暴露)
├── renderer/              渲染进程(React)
│   ├── pages/             页面组件(Chat / Settings / Agent)
│   ├── components/        可复用组件
│   ├── hooks/             React hooks
│   ├── store/             Zustand store
│   ├── api/               preload 封装层
│   └── lib/               工具函数
└── shared/
    └── types/             主/渲染共享类型
```

**分层依赖方向**：`ipc → 业务层 → 基础设施`，反向不允许。业务层文件头部声明允许/禁止的依赖。

---

## 3. 必读文档（按优先级）

开发前必读：

1. **[docs/engineering/standards.md](docs/engineering/standards.md)** — 规则清单（MUST / SHOULD / NEVER）。动手前至少扫一遍章节标题。
2. **[docs/engineering/patterns.md](docs/engineering/patterns.md)** — 通用模式 + 参考实现索引。遇到问题先查这里有没有对应模式。

做对应任务时读：

- 加新工具 → `tools/builtin/read.ts`（最简范例）+ `patterns.md §P1`
- 改 ReAct 循环 / context 处理 → `loop/react-loop.ts` + `patterns.md §P4/§P9`
- 加 IPC handler → `ipc/mcp.ts`（范式最完整）+ `standards.md §D`
- 改 prompt → `prompt/PromptPipeline.ts` + `patterns.md §P8`
- 加 Repo 方法 → `repos/session-repo.ts` + `patterns.md §P5`

---

## 4. 最容易踩的坑

### 4.1 工具错误必须用 `ToolErrorEnvelope`

不要用字符串前缀（如 `'Tool execution failed: ...'`）。错误识别走 `__talor_error: true` 结构化字段。详见 `standards.md §F-MUST-3` + `patterns.md §P2`。

### 4.2 `assistant(tool_use)` + `tool(result)` 必须同事务落盘

用 `messageRepo.createBatch`，不要两次独立 `create`。破坏配对不变量会让 session 永久废。详见 `standards.md §I-MUST-1` + `patterns.md §P6`。

### 4.3 任何文件路径必须走 `resolveToolPath`

不要手写 `path.startsWith(workspace)` — 会被 symlink 绕过。详见 `standards.md §K-MUST-1 / §K-NEVER-1`。

### 4.4 高风险工具前置黑名单，不靠用户 confirm 兜底

bash 危险命令、敏感路径在 validate/path-guard 层就拦住。详见 `standards.md §K-NEVER-2`。

### 4.5 "模型应该怎么做"的硬规则必须代码强制

Prompt 是软引导。任何"必须"级规则要有代码实现（`⟨unverifiable⟩`、`EDIT_AMBIGUOUS_MATCH`、context halt 都是这样来的）。详见 `standards.md §J-SHOULD-1` + `patterns.md §P4`。

### 4.6 Zod 已校验过的规则不要在 `execute` 里再写一遍

违反 DRY 且容易漂移。详见 `standards.md §F-NEVER-1`。

### 4.7 `vitest` mock 用 `vi.hoisted`

否则 `vi.mock` hoist 时 mock fn 还是 undefined。详见 `standards.md §L-MUST-2` + `patterns.md §P10`。

---

## 5. 常用命令

```bash
npm run dev           # 启动 Electron dev 环境(Vite HMR)
npm test              # vitest 全量测试(一次性)
npm run test:watch    # 测试 watch 模式
npm run typecheck     # 三 tsconfig 合并检查(main/preload/renderer)
npm run lint          # ESLint
npm run build         # electron-vite build + electron-builder 打包
```

**native module 版本切换**：`better-sqlite3` 会在 Node 和 Electron 之间踩版本冲突。跑 `vitest` 前后切换需 `npx electron-rebuild -f -w better-sqlite3`。

---

## 6. 贡献节奏

### 新任务标准流程

1. 读 `standards.md` 相关章节 + `patterns.md` 对应模式
2. 找**参考实现**（模式索引表里列出的文件）
3. 照搬范式写代码
4. 写"触发 + 不触发"两条测试（`standards.md §L-MUST-3`）
5. `npm test && npm run typecheck` 本地验证
6. commit message 引用规则编号（如 `fix: align to F-MUST-3`）

### 遇到冲突

- 任务需求与 `standards.md` 冲突 → 暂停，跟 human 确认是改标准还是改需求
- 有历史代码违反 standards → 按 `standards.md §偏离处理` 标注，不要在同一 PR 里顺手改

---

## 7. AI 协作特有规则

### 7.1 禁止直接"重启项目" / "rm -rf" 等破坏性操作前不确认

即使用户要求，也要先说明影响（会关闭当前 session？会丢数据？）。

### 7.2 改动前必读代码，不凭记忆

尤其对 `react-loop.ts`、`registry.ts`、`PromptPipeline.ts` 这些核心模块 — 它们的精细度高，遗漏一个 hook 可能破坏死循环保护 / 配对不变量。

### 7.3 遵守 `.claude/settings.local.json` 权限

项目配置了 bash 命令白名单。尝试未授权命令时会被阻断，不要绕过。

### 7.4 提交前验证

- `npm test` 必须全绿（除非是 pre-existing failures，明确告知用户）
- `npm run typecheck` diff 对比 HEAD，**不引入新类型错误**（允许存量历史错误）

### 7.5 commit 消息

格式：`type(scope): summary`（type ∈ feat/fix/refactor/docs/test/chore）。
消息体说明 **why**，不只是 what（diff 已经说明 what）。
英文优先。

---

## 8. 项目现状（自动维护）

**最近重要变更**（详见 `git log`）：

- `feat(tools,loop)`: 结构化错误信封、Zod 工具校验、fallback 引用校验
- `refactor(prompt,tools)`: 分层 prompt 架构 + 鲁棒性升级
- `fix(prompt)`: RULE 0 anti-self-refuse

**尚未实现**：

- KnowledgeBase（RAG） — 返回空
- LongTermMemory（跨 session 持久记忆） — 返回空
- AgentPromptPlugin 的数字员工契约系统 — Phase 3 stub

---

## 9. 相关文档导航

| 文档                                                           | 对象             | 内容                              |
| -------------------------------------------------------------- | ---------------- | --------------------------------- |
| [docs/engineering/standards.md](docs/engineering/standards.md) | 工程师 / AI      | 规则清单（MUST / SHOULD / NEVER） |
| [docs/engineering/patterns.md](docs/engineering/patterns.md)   | 工程师 / AI      | 模式 + 参考实现索引               |
| [docs/superpowers/](docs/superpowers/)                         | Claude Code 插件 | superpowers 体系的 plans/specs    |
| README.md                                                      | 用户 / 贡献者    | 项目简介、安装、License           |
