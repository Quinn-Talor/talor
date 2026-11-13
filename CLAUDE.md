# Talor — AI 协作指南

> 本文档给读 Talor 代码库的 AI agent（Claude Code / Copilot CLI / Codex 等）一个**最快上手入口**。
> 详细工程规范（项目知识库）在 `docs/engineering/`。

---

## 1. 项目一句话

Talor 是 **纯 Agent 平台** — Electron + TypeScript 桌面应用(v0.1.0,MIT)。**自身不含任何业务**,所有业务由用户通过对话沉淀(Crystallizer)产出 agent 表达。Talor 提供:agent 运行时 + 工具栈(builtin + MCP)+ skill 系统 + subagent 委托 + 凭据管理。

- **前端**:React 19 + Tailwind + Zustand
- **模型层**:Vercel AI SDK(Anthropic / OpenAI / Google / Ollama)
- **工具**:7 个内置(bash / read / write / edit / glob / grep / ls)+ MCP 外部
- **持久化**:better-sqlite3 `chat.db`(sessions, mcp_servers, account_keys)+ 引擎运行档案 `~/.talor/runs.db`(会话日志,对话内容以它为准)+ 文件(`~/.talor/agents/<id>/` + `~/.talor/skills/<name>/`)
- **Agent Profile** · **极简 schema 8 字段**:`id` / `name` / `description` / `agentPrompt`(磁盘上拆为 sibling `prompt.md`)+ `tools?` / `skills?` / `mcpServers?` / `subagents?`
- **核心差异化**:Crystallizer — 从对话历史一键提炼出可复用的 agent

---

## 2. 代码地图

```
src/
├── main/                   Electron 主进程(Node 环境)
│   ├── ipc/               入口层:IPC handlers(不得被业务层依赖)
│   ├── runtime/           业务层:agent-engine 接入 — 运行时(engine)、能力目录(catalog)、每轮(turn)、界面行投影(turn-rows / live-turns)、MCP 状态与测试连接(mcp-status)、Trace 读取(run-trace)、审批人(approval)、凭据库(vault)
│   ├── chat/              业务层:一轮的输入准备(attachments / provider-selector / stream-registry)
│   ├── agent/             业务层:Agent 注册表(agent-manager,只存 profile)/ Profile 加载(Schema 2.0) / Crystallizer
│   │   └── (contract-guard.ts + naturalize.ts 已在 Schema 2.0 迁移中删除)
│   │   └── (importer/exporter + agent-pack/ 已删除 — 平台定位不做迁移)
│   ├── accounts/          业务层:第三方账户凭据(account-store)
│   ├── tools/             业务层:内置工具仓库(registry) + path-guard
│   │   └── builtin/      bash / read / write / edit / glob / grep / ls
│   ├── permissions/       业务层:权限规则、path matcher
│   ├── providers/         业务层:LLM provider 工厂、模型拉取/测试/可用性
│   │   ├── adapters/     anthropic / openai / google / ollama(经官方 @ai-sdk/openai-compatible)
│   │   └── capability/   模型能力检测(detector) + 手动覆盖(updater)
│   ├── skills/            业务层:skill 注册表 + metadata-extractor(SKILL.md frontmatter 解析)
│   ├── repos/             基础设施:session/mcp-server CRUD
│   ├── db/                基础设施:SQLite 初始化、schema 迁移
│   ├── store/             基础设施:ConfigStore (electron-store)
│   └── services/          基础设施:safe-storage(Electron 平台能力封装)
├── preload/               preload 脚本(contextBridge API 暴露)
├── renderer/              渲染进程(React)
│   ├── pages/             页面组件(Chat / Settings / Agent)
│   ├── components/        可复用组件
│   ├── hooks/             React hooks
│   ├── store/             Zustand store
│   ├── api/               preload 封装层
│   ├── types/             仅渲染端使用的类型(chat/config)
│   └── lib/               工具函数
└── shared/
    └── types/             主/渲染共享类型(agent / ipc / message / models / permissions)
```

**分层依赖方向**：`ipc → 业务层 → 基础设施`，反向不允许。业务层文件头部声明允许/禁止的依赖。

---

## 3. 必读文档（按优先级）

开发前必读：

1. **[docs/engineering/standards.md](docs/engineering/standards.md)** — 规则清单（MUST / SHOULD / NEVER）。动手前至少扫一遍章节标题。
2. **[docs/engineering/patterns.md](docs/engineering/patterns.md)** — 通用模式 + 参考实现索引。遇到问题先查这里有没有对应模式。
3. **[docs/engineering/overview.md](docs/engineering/overview.md)** — 项目架构总览。
4. **[docs/design/plans/2026-05-11-agent-schema-2-0.md](docs/design/plans/2026-05-11-agent-schema-2-0.md)** — Schema 2.0 规格文档（含迁移历史 + 字段逐条说明）。

做对应任务时读：

- 加新工具 → `tools/builtin/read.ts`（最简范例）+ `patterns.md §P1`
- 改一轮的运行 / 能力装配 → `runtime/turn.ts` + `runtime/catalog.ts` + `runtime/agents.ts`（ReAct 循环、上下文、压缩、委托由 agent-engine 承载）
- 加 IPC handler → `ipc/mcp.ts`（范式最完整）+ `standards.md §D`
- 改 agent 的指令 → profile 的 `agentPrompt`（`__chat__` 见 `agent/agent-manager.ts` 的 `CHAT_PROFILE`）
- 加 Repo 方法 → `repos/session-repo.ts` + `patterns.md §P5`

---

## 4. 最容易踩的坑

### 4.1 工具错误必须用 `ToolErrorEnvelope`

不要用字符串前缀（如 `'Tool execution failed: ...'`）。错误识别走 `__talor_error: true` 结构化字段。详见 `standards.md §F-MUST-3` + `patterns.md §P2`。

### 4.2 对话内容只来自引擎会话日志

`tool_use` / `tool_result` 的配对与落盘由 agent-engine 的运行档案（`~/.talor/runs.db`）保证；Talor 不另存消息（`messages` 表已在 D2 删除）。界面行由 `runtime/turn-rows.ts` 从运行事件折叠，不要另建消息表或缓存去"补"对话内容。

### 4.3 任何文件路径必须走 `resolveToolPath`

不要手写 `path.startsWith(workspace)` — 会被 symlink 绕过。详见 `standards.md §K-MUST-1 / §K-NEVER-1`。

### 4.4 高风险工具前置黑名单，不靠用户 confirm 兜底

bash 危险命令、敏感路径在 validate/path-guard 层就拦住。详见 `standards.md §K-NEVER-2`。

### 4.5 "模型应该怎么做"的硬规则必须代码强制

Prompt 是软引导。任何"必须"级规则要有代码实现(`⟨unverifiable⟩`、`EDIT_AMBIGUOUS_MATCH`、context halt 都是这样来的)。

**极简 schema 下**:`agentPrompt`(磁盘 `<agentDir>/prompt.md`)是 LLM 行为定义的唯一 prompt 层载体;`validateProfile` 6 条规则做结构校验(rule 2/3/5/7/12/13)。LLM 硬约束在代码层(validator + path-guard + 执行环境的权限规则),`agentPrompt` 只做软引导。

详见 `standards.md §J-SHOULD-1` + `patterns.md §P4`。

### 4.8 Agent profile 必须用 splitter 持久化

写 agent 时不要直接 `JSON.stringify(profile)` 含 agentPrompt 字段。用 `persistAgentProfile(profile, dirPath)` 拆为 `agent.json`(不含 agentPrompt) + sibling `prompt.md`。读时用 `loadAgentBundle(dirPath)` 合并。

`agent.json` 内含 agentPrompt 字段时 loader 会 reject。

### 4.9 Skill / MCP 引用化:agent 不自带,只引用

`profile.skills: string[]` 引用 `~/.talor/skills/<name>/SKILL.md`(skill-installer 在缺失时从 `~/.claude/skills` 等位置兜底 cp)。
`profile.mcpServers: string[]` 引用 `mcp_servers` DB 表(用户在 Settings 配置)。

业务 agent 装配时用 `SkillRegistry.filterByNames` + `McpRegistry.filterByServerNames` 拿受限视图,**不复制不重建**。

### 4.6 Zod 已校验过的规则不要在 `execute` 里再写一遍

违反 DRY 且容易漂移。详见 `standards.md §F-NEVER-1`。

### 4.7 `vitest` mock 用 `vi.hoisted`

否则 `vi.mock` hoist 时 mock fn 还是 undefined。详见 `standards.md §L-MUST-2` + `patterns.md §P10`。

### 4.10 前文由引擎装配,Talor 不重建 prompt

每轮 `start(..., { session: sessionId })`,前文、跨轮压缩、`tool_use`/`tool_result` 相邻都由引擎从会话日志装配。Talor 要给模型的额外输入走引擎的输入(如提炼工作台的 `pending_context`),**不要**自己拼 messages 数组或插入旁注消息。

### 4.11 工具失败必须把命令实际输出原样带回(Principle 3)

bash 等工具非零退出时,要合并返回 **stdout + stderr**(不能只取 stderr)。否则 CLI 把错误打到 stdout、或模型用 `2>&1` 合并流时,模型只看到 `exit code N` 无从诊断 → 盲目重试 → 触发 failure-streak 收尾,任务卡死。见 `tools/builtin/bash.ts` close handler + `standards.md` Principle 3。

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

**升级 agent-engine**：引擎按 GitHub 发布 tag 引入（`"@talor/agent-engine": "github:Quinn-Talor/agent-engine#v0.1.1"`），升级 = 改 tag 后 `npm install`（npm 拉取该 tag 并用引擎的 `prepare` 构建 `dist`，锁文件记录 commit）。

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

尤其对 `runtime/turn.ts`、`runtime/catalog.ts`、`tools/registry.ts` 这些核心模块 — 它们的精细度高，遗漏一处可能破坏能力装配 / 审批 / 界面行投影。

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

## 8. 项目现状(自动维护)

**最近重要变更**(详见 `git log`):

- `refactor(runtime)`: **D2 删除旧运行时与 `messages` 表** — 删 `loop/` `prompt/` `memory/` `mcp/`、`chat/orchestrator`、旧 `Agent`/`agent-toolset`/`delegate-agent`/`builtin-registry`、`risk-gate`、旧 Trace(`trace-repo`/`trace-recorder`/trace 中间件)等;启动时 DROP `messages` 等八张旧表(`db/index.ts` 的 `LEGACY_TABLES`);`AgentManager` 只存 `{ profile, source }`;MCP 设置页状态/测试连接与聊天页工具列表改读引擎连接池(`runtime/mcp-status.ts`),删 `mcp:connect` 等四个通道;Trace 面板只读运行档案、去掉评分;`runtime/legacy-boundary.test.ts` 守旧路径零引用
- `refactor(runtime)`: **chat:send 只走 agent-engine,跨轮前文改用引擎会话** — 删 `runtime/dispatch.ts`(off/auto/force 分派)与 `runtime/history-policy.ts`;每轮 `start(..., { session: sessionId })`,前文/跨轮压缩/副作用台账由引擎从 `runs.db` 会话日志推导;删除会话时 `deleteEngineSession` 一起删引擎档案;interactive 环境的运行不按天数清理
- `refactor(runtime)`: **界面消息也由会话日志推导,引擎路径不写 `messages` 表** — `runtime/turn-rows.ts` 把运行事件折叠成消息行(实时与事后同一个函数,按轮分页 20 轮,工具结果预览 2000 字);进行中的轮在 `runtime/live-turns.ts` 内存登记;子会话按元数据 `engine_run_id` 读子运行、界面只读;提炼工作台的源对话快照走元数据 `pending_context`(下一轮的前置输入)+ `notices`(只给界面看的提示行)
- `chore(deps)`: **Vercel AI SDK v6 → v7**(providers v3 → v4);`CoreMessage` → `ModelMessage`;`allowSystemInMessages: true`(Talor 多层 system 刻意放 messages 数组);Ollama 改走官方 `@ai-sdk/openai-compatible`(删社区包)
- `feat(token)`: **会话级 token 用量统计** — `usage-normalizer`(跨厂商归一,读 v7 统一 `inputTokenDetails`)+ `usage-recorder` 在 3 个 LLM 调用点(主对话/reflect/压缩)记录 → session 表 4 列(input/output/cache_read/cache_write);UI 接缝行展示(k/M 缩写,头部=全部 token 含缓存读)
- `perf(prompt)`: **prompt 前缀缓存优化** — ① 时间戳粗化到日期级(去掉打碎前缀的毫秒戳)② append-only 分层装配(`PromptPlugin.layer`,稳定前缀连续在前/volatile 在尾)③ Anthropic `cacheControl` 断点(`cache-breakpoints.ts`,仅 anthropic);deepseek 实测缓存命中 ~80%
- `fix(loop,tools,repos)`: 三个工具回合 bug — RuntimeMeta 劈开 tool_use/tool_result 配对(见 §4.10)、`listBySession` 排序不确定、bash 非零退出吞 stdout(见 §4.11)
- `refactor(skills)`: Skills 平台目录 `~/.claude/skills/` → `~/.talor/skills/`(Talor 拥有自己数据目录);`~/.claude/skills/` 降为 fallback,跟 Claude Code 共享 skill 库的用户仍兼容
- `refactor(agent)`: **终极极简** schema 14 字段 → **8 字段**;validator 14 rules → 6;dep-checker 8 steps → 3;删 `schemaVersion / version / avatar / cli / references / preferences` + `AgentPreferences` / `ReferenceFile` 类型 + `variable-resolver` 模块
- `refactor(agent)`: **prompt.md 拆分** — `agentPrompt` 不再内嵌 agent.json,改为 sibling `<agentDir>/prompt.md`;`profile-fs.ts` 双向 splitter;validator dual-mode(inline / directory + injectedAgentPrompt)
- `feat(ipc,crystallizer)`: `skills:list-platform` IPC(供 UI 下拉)+ Crystallizer prompt 改造为 reference name 数组(不再 inline 定义)
- `refactor(agent,schema)`: skills/mcpServers/cli 全部 `string[]` 引用平台资源;agent 不再持有私有 skill 副本;`SkillRegistry.filterByNames` / `McpRegistry.filterByServerNames` 给业务 agent 受限视图;dep-checker 删 auto-install
- `refactor(agent)`: 定位调整为纯本地平台 — 移除全部 agent 迁移能力(`agent-pack/` / `importer.ts` / `exporter.ts` / 相关 IPC)
- `fix(mcp)`: stdio transport 凭据机制 — `envFromAccount` 引用 Account,删 `serverPackage` 死字段

**Agent 磁盘形态**:

```
~/.talor/agents/<agent-id>/
  agent.json     # 元数据(不含 agentPrompt)
  prompt.md      # 完整 agentPrompt
  README.md      # 派生
~/.talor/skills/<name>/
  SKILL.md       # 平台 skill(被所有 agent 共享)
```

**尚未实现 / 暂缓**:

- AgentEditPage UI 下拉(IPC 已有,UI 仍是 JSON 编辑器)

---

## 9. 相关文档导航

| 文档                                                                                                 | 对象          | 内容                                  |
| ---------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------- |
| [docs/engineering/standards.md](docs/engineering/standards.md)                                       | 工程师 / AI   | 规则清单（MUST / SHOULD / NEVER）     |
| [docs/engineering/patterns.md](docs/engineering/patterns.md)                                         | 工程师 / AI   | 模式 + 参考实现索引                   |
| [docs/engineering/overview.md](docs/engineering/overview.md)                                         | 工程师 / AI   | 项目架构总览                          |
| [docs/design/plans/2026-05-11-agent-schema-2-0.md](docs/design/plans/2026-05-11-agent-schema-2-0.md) | 工程师 / AI   | Schema 2.0 规格：字段说明 + 迁移历史  |
| [docs/design/](docs/design/)                                                                         | 工程师 / AI   | 大型改造的设计与计划档案(plans/specs) |
| README.md                                                                                            | 用户 / 贡献者 | 项目简介、安装、License               |
