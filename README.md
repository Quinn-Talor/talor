# Talor

> 纯 Agent 平台 · 从你的对话沉淀出可复用的 AI 数字员工

Talor 是一款 Electron 桌面应用,自身**不含任何业务 agent**。它提供 agent 运行平台 + 工具栈,所有业务 agent 由用户通过对话历史自动沉淀(Crystallizer)产出。

---

## 它解决什么问题

跟 ChatGPT / Claude 跑了一段有用的对话后,这段经验通常就丢了 — 下次类似任务还要重头说一遍。Talor 让你:

1. **跟 Talor 跑一段对话**(用平台内置工具 / MCP / Skill)
2. **点 Crystallize**,Talor 把这段对话沉淀成一个**可复用 agent**(`prompt.md` + 工具配置)
3. 下次类似任务,**直接 invoke 这个 agent**,它带着原来的工作流和知识

---

## 关键特性

- **极简 schema**:agent 只有 8 个字段(`id / name / description / agentPrompt / tools / skills / mcpServers / subagents`)
- **prompt.md sibling**:行为定义在独立 markdown 文件,可单独编辑
- **引用化架构**:skill 和 MCP 由平台统一管理,agent 仅按 name 引用,无副本
- **subagent 委托**:agent 可调用其他 agent(`delegate_agent` 工具)
- **Feature 扩展框架**:业务对象(如投研标的卡)以 Feature 接入——`ArtifactStore` 读写抽象 + `ArtifactUI` 独立渲染 + 工具操作,平台核心对业务无感知(见 [docs/talor-feature-architecture.md](./docs/talor-feature-architecture.md))
- **凭据安全**:MCP `envFromAccount` 引用 Account store,真值不进 prompt / 不进 IPC / 不进 LLM
- **本地优先**:所有数据在 `~/.talor/` 下,无云端依赖
- **跨模型**:Anthropic / OpenAI / Google / Ollama(通过 Vercel AI SDK v7)
- **prompt 前缀缓存**:append-only 分层装配让稳定前缀连续可缓存,Anthropic 打 `cacheControl` 断点;deepseek 等自动缓存(实测命中 ~80%)
- **token 用量统计**:跨厂商归一,会话级 input/output/缓存读写 落库 + UI 展示(k/M)
- **跨 skill 库兼容**:`~/.talor/skills/` 是真相位置;若有 `~/.claude/skills/` 会自动 cp 兼容

---

## 数据布局

```
~/.talor/
  agents/<agent-id>/
    agent.json       # 元数据(7 字段,不含 agentPrompt)
    prompt.md        # agentPrompt 全文
    README.md        # 派生
  skills/<skill-name>/
    SKILL.md         # 平台 skill(被所有 agent 共享)
    ...
  chat.db            # SQLite: sessions / messages / mcp_servers / account_keys
```

---

## 安装

### 前置

- Node.js 22+ (Electron 41 native module 编译需要)
- npm 10+
- macOS / Linux (Windows 未测试)

### 开发模式

```bash
git clone <repo>
cd talor
npm install
npm run dev
```

Vite HMR + Electron 主进程会同时启动。

### 打包

```bash
npm run build       # electron-vite + electron-builder
```

输出在 `dist/`。

---

## 第一次使用

1. 启动后默认进入 `__chat__`(主对话)
2. 跟它跑一段你想沉淀的工作流(例:"帮我审一下 PR https://github.com/.../pull/123 …")
3. 在对话末尾点 **Crystallize** 按钮
4. Crystallizer 会引导你确认意图,然后产出 `agent.json` + `prompt.md` 草稿
5. 审阅 → 保存,agent 出现在 `AgentsPage`
6. 下次想做类似任务时,在 chat 里输入 `/<agent-name> …` 或在 AgentsPage 直接启动

### 配 MCP / Skill / Account

- **MCP**:Settings → MCP Servers,添加 stdio / http transport
- **Skill**:把 `SKILL.md`(+ 附属文件)放到 `~/.talor/skills/<name>/`(若你已用 Claude Code,放在 `~/.claude/skills/` 也会被自动 cp 过来)
- **Account**:Settings → Accounts,配 API key / envVar(如 `GITHUB_TOKEN`)

---

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  Renderer (React 19 + Tailwind + Zustand)               │
│  pages/Chat · pages/Agents · pages/Settings             │
└───────────────────────────┬─────────────────────────────┘
                            │ IPC
┌───────────────────────────┴─────────────────────────────┐
│  Main Process                                            │
│                                                          │
│  ipc/* ─── 入口层(IPC handler)                           │
│       ↓                                                 │
│  chat/orchestrator + loop/react-loop ─── ReAct 引擎       │
│  prompt/PromptPipeline ─── 7 plugin append-only 装配      │
│  agent/agent-manager ─── 平台 + 业务 agent 注册/装配      │
│       ↓                                                 │
│  agent/profile-fs (splitter) ─── agent.json+prompt.md   │
│  mcp/client ─── MCP 协议(stdio + http)                   │
│  skills/registry ─── 平台 SkillRegistry + filterByNames  │
│  tools/* ─── 7 个 builtin(bash/read/write/edit/glob/…)   │
│       ↓                                                 │
│  repos/* + db/ ─── SQLite                                │
│  accounts/account-store ─── 加密凭据                      │
└─────────────────────────────────────────────────────────┘
```

---

## License

Apache 2.0 + Commons Clause(本仓库)。

详见 [LICENSE](./LICENSE)。

---

## 给开发者

工程规范见 [vibe/project/](./vibe/project/):

- [overview.md](./vibe/project/overview.md) — 架构总览
- [standards.md](./vibe/project/standards.md) — MUST / SHOULD / NEVER 规则
- [patterns.md](./vibe/project/patterns.md) — 模式 + 参考实现索引
- [docs/talor-feature-architecture.md](./docs/talor-feature-architecture.md) — 业务对象融入平台的 Feature 架构(三抽象:对象 / 读写 / 渲染)

AI agent 协作指南见 [CLAUDE.md](./CLAUDE.md)。
