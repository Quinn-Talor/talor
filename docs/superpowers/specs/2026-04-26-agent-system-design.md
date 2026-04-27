# Agent 系统设计 — 从 Chat 沉淀到生产可用的数字员工

> 日期: 2026-04-26
> 状态: Draft
> MVP 边界: Chat → 沉淀 → Agent 列表 → /召唤 → 声明式依赖检查

---

## 1. 背景与目标

Talor 定位为 AI 数字员工平台。当前 Phase 1 已完成 Chat 对话基础设施（ReAct loop、内置工具、MCP 集成、Provider 管理、短期记忆）。但核心差异化功能——数字员工（Agent）系统——尚未实现。

**目标用户**：业务团队（非技术人员）。

**核心理念**：用户先在 Chat 中解决问题，成功后通过对话式引导将解决流程沉淀为一个专业 Agent，后续复用处理同类问题。

**MVP 范围**：
- Chat 对话 → 对话式沉淀 → Agent 定义（文件系统）
- Agent 卡片列表 UI + 独立启动 session
- /agent 召唤（单次介入当前 session）
- 声明式依赖（tool/skill/cli）+ 自动安装 + 降级引导
- 不包含：定时/事件触发、工作台任务派发、能力市场

---

## 2. Agent 定位

Agent 是一个**完整的可运行单元**：
- **自带能力定义**：agent prompt、知识、工作流、示范对话
- **声明所有依赖**：tool、skill、cli 及其版本和配置
- **自动处理依赖**：导入时检测缺失 → 自动安装 skill → 引导配置 env → 就绪可用

类比：Skill 像 npm package（提供能力，被依赖），Agent 像一个完整的可部署应用（既有自己的业务逻辑，又有依赖声明和安装流程）。

**Agent 能力层级**（分级，不同 agent 有不同能力等级）：
- `chat` — 纯对话型，有特定角色/知识/人设
- `chat-tools` — 对话 + 工具执行，能调用外部工具完成实际操作
- `autonomous` — 自主工作流，按预定义流程自动执行多步骤任务

---

## 3. Agent Manifest Schema（agent.json）

代码层/数据模型统一使用 `Agent`，用户界面可展示为"数字员工"或其他品牌词。

```typescript
interface AgentManifest {
  // === 元信息 ===
  id: string
  name: string                        // /召唤标识
  description: string
  avatar?: string                     // 相对路径 "./avatar.png"
  version: string                     // agent 自身版本 semver "1.0.0"
  minAppVersion: string               // Talor 平台最低版本 "0.2.0"

  // === 角色定义（结构化能力描述，参考 Skill 模式） ===
  role: {
    capabilities: string[]            // 能力列表 ["从飞书表格获取销售数据", "生成趋势分析图表"]
    constraints?: string[]            // 边界约束 ["只处理销售相关数据", "不修改原始数据表"]
    outputFormat?: string             // 交付标准 "Markdown 格式的分析报告"
    sampleConversations: SampleConversation[]
    personality?: string              // "简洁专业" / "友好耐心"
    language?: string                 // "zh-CN"
  }

  // === 知识 ===
  knowledge: {
    files: KnowledgeFileRef[]
  }

  // === 流程 ===
  workflow?: {
    trigger?: WorkflowTrigger         // MVP 不实现，预留
    steps: WorkflowStep[]
    fallback?: string
  }

  // === 依赖声明 ===
  dependencies: {
    tools: ToolDependency[]           // 内置原子工具
    skills: SkillDependency[]         // 第三方 skill 包
    cli: CliDependency[]              // 系统 CLI 工具
  }

  // === 运行偏好 ===
  runtime?: {
    providerId?: string
    modelId?: string
    maxSteps?: number
    contextLimit?: number
  }
}
```

### 3.1 Prompt 分层与工具沙箱

**Prompt 分层**（agent prompt ≠ system prompt）：
```
最终发给 LLM 的 prompt =
  1. System Prompt     — Talor 平台级固定指令
  2. Agent Prompt      — 从 role 结构化字段拼装（capabilities + constraints + outputFormat）
  3. Knowledge Index   — 知识文件目录（path + description），告诉 LLM 可用知识
  4. Few-shot          — sampleConversations
  5. Memory            — 短期记忆
  6. User Message
```
知识文件内容**不预注入 prompt**，LLM 需要时通过 read tool 按需加载。
`AgentPromptPlugin` 负责将 `role` 结构化字段拼装为 agent prompt，追加到 system prompt 之后。

Agent 的能力层级无需显式字段，由 manifest 内容自然决定：
- 无 dependencies → 纯对话
- 有 dependencies → 对话 + 工具
- 有 workflow → 自主工作流

**工具沙箱原则（安全隔离）**：

Agent 运行时**只能使用**以下工具，禁止额外注入：
1. **平台基础内置工具**（read, ls, glob, grep）— 始终可用，无需声明
2. **Agent 声明的 tool 依赖**（bash, write, edit 等）— 必须在 `dependencies.tools` 中显式声明
3. **Agent 声明的 skill 依赖** — 必须在 `dependencies.skills` 中显式声明
4. **Agent 声明的 cli 依赖** — 必须在 `dependencies.cli` 中显式声明

未声明的工具/skill/cli 一律不可用，即使平台已安装。`build-tools` 在构建 agent session 的工具集时，必须以 agent manifest 为白名单进行过滤。

### 3.2 知识 (Knowledge)

知识文件全部**按需加载**：`description` 注入 prompt 作为知识目录，LLM 自行判断何时通过 read tool 读取哪个文件。

```typescript
interface KnowledgeFileRef {
  path: string                        // 包内相对路径 "./knowledge/manual.md"
  description: string                 // "产品操作手册，包含功能说明和定价"（注入 prompt，让 LLM 知道何时该读）
  required: boolean
  format: 'markdown' | 'text' | 'csv' | 'json' | 'pdf'
}
```

### 3.3 流程 (Workflow)

```typescript
interface WorkflowStep {
  id: string                          // "fetch-data"
  name: string                        // "获取销售数据"
  instruction: string                 // 给 LLM 的指令
  tools?: string[]                    // 该步骤可用的工具子集
  input?: Record<string, string>      // 上游步骤的输出映射
  output?: string                     // 该步骤输出变量名
  condition?: string                  // 条件执行 "{{total_sales}} > 10000"
}

interface WorkflowTrigger {
  type: 'manual' | 'schedule' | 'event'   // MVP 只支持 manual
  schedule?: string                   // cron（后续）
  event?: string                      // 事件名（后续）
}
```

### 3.4 示范对话 (Sample Conversations)

```typescript
interface SampleConversation {
  title: string                       // 场景标题 "汇总周报"
  messages: { role: 'user' | 'assistant'; content: string }[]
}
```

### 3.5 工具依赖 (Tools)

```typescript
interface ToolDependency {
  name: string                        // "bash", "read", "write" 等内置工具名
  required: boolean
  // 内置工具无版本概念，跟随 Talor 平台版本
}
```

### 3.6 Skill 依赖 (Skills)

```typescript
interface SkillDependency {
  name: string                        // "lark-im", "lark-calendar"
  version?: string                    // "^2.0"
  required: boolean
  source: {
    type: 'npm' | 'git' | 'url'
    package?: string                  // "@anthropic/lark-im-skill"
    url?: string
  }
  config?: Record<string, string>     // 值可以是字面量或 {{变量引用}}
  // 例: { "FEISHU_APP_ID": "{{feishu_appid}}", "TIMEOUT": "30000" }
}
```

**Skill 依赖隔离**：每个 agent 独立安装自己版本的 skill（类似 node_modules 隔离），避免版本冲突。

### 3.7 CLI 依赖

```typescript
interface CliDependency {
  command: string                     // "git", "node", "lark-cli"
  version?: string                    // ">=2.0"
  checkCommand?: string               // "git --version"
  installHint?: string                // "brew install git"
  required: boolean
}
```

---

## 4. 存储方案

### 4.1 文件系统（Source of Truth）

Agent 定义存储在文件系统，支持迁移、git 管理、手动编辑：

```
~/.talor/agents/sales-analyst/
├── agent.json              // Agent Manifest
├── avatar.png              // 头像（可选）
├── knowledge/              // 知识文件
│   ├── product-manual.md
│   └── faq.csv
└── samples/                // 示范对话（也可内联在 agent.json）
    └── weekly-report.json
```

### 4.2 导出/导入格式

导出：将整个 agent 目录压缩为 `{name}-{version}.agent.zip`（如 `销售分析师-1.0.0.agent.zip`）。
导入：解压到 `~/.talor/agents/` + Agent 默认为"已禁用"状态 + 执行依赖检查链 + 用户手动启用。

### 4.3 文件 vs DB 分工

| 内容 | 存储 | 原因 |
|------|------|------|
| Agent 定义 + 知识 + 示范对话 | 文件系统 | 可迁移、可 git、可手动编辑 |
| 运行时状态（会话历史、记忆） | SQLite DB | 本地执行产物，不需迁移 |

### 4.4 加载机制

Talor 启动时扫描 `~/.talor/agents/*/agent.json`，构建内存索引。不使用 DB 表存储 agent 定义。

Session 表新增可选字段 `agent_id`，绑定 session 到 agent。

---

## 5. 沉淀流程：Chat → Agent

### 5.1 触发

- 用户在 chat 中说"把这个流程保存为 agent"
- 或点 UI 上的"沉淀为 Agent"按钮

### 5.2 对话式引导

沉淀本身是一轮对话（保持"一切通过 Chat 完成"的产品一致性），由内置的"沉淀引导 Agent"驱动：

1. 系统分析当前 session 的完整消息历史
2. 沉淀引导 Agent 通过问答逐步提炼：
   - 核心职责、名称、描述
   - 哪些工具/skill 保留
   - 哪些输入需要参数化
   - 是否保留当前对话作为示范
   - 补充行为风格、语言等
3. 生成 Agent 定义草稿
4. 展示预览，用户确认
5. 写入 `~/.talor/agents/{name}/agent.json` + 知识文件

### 5.3 技术实现

- 沉淀引导 Agent 是**内置 platform agent**（硬编码 systemPrompt）
- 创建一个**新的临时 session**（不污染原始对话），将原 session 的消息历史作为上下文传入
- Crystallizer Agent 在对话中展示 manifest 摘要，用户确认后，Agent 直接使用 write tool 依次写入 agent.json、知识文件、示范对话到 `~/.talor/agents/{name}/` 目录
- 沉淀完成后，临时 session 可自动清理或保留供参考

---

## 6. /召唤机制

### 6.1 用户体验

在任意 chat session 中输入 `/销售分析师 帮我看下本周数据`，该 agent 介入当前对话。

### 6.2 实现流程

1. **消息解析**：发送前扫描消息文本，匹配 `/{agent.name}` 前缀
2. **Agent 加载**：从 `~/.talor/agents/` 读取对应 agent.json
3. **依赖检查**：快速校验 tools/skills/cli 是否就绪，不满足则报错
4. **上下文注入**：
   - `role`（capabilities/constraints/outputFormat）→ 由 `AgentPromptPlugin` 拼装为 agent prompt，追加到 system prompt 之后
   - `knowledge.files` 的 description → 注入为知识目录（LLM 按需通过 read tool 加载内容）
   - `dependencies` → 过滤可用工具集 + 解析 `{{变量}}` 注入 config
   - `sampleConversations` → 作为 few-shot 注入
5. **执行**：复用当前 session 的 ReAct loop
6. **退出**：agent 回复完成后，session 恢复原始状态

### 6.3 作用域

/召唤是**单次介入**，不永久绑定 session。持续使用某 agent 应从 Agent 列表启动独立 session。

---

## 7. 依赖管理

### 7.1 依赖检查链（导入时 / 启动时）

```
1. minAppVersion → Talor 版本是否满足
2. CLI 检查     → 执行 checkCommand，缺失展示 installHint
3. Skill 检查   → 对比已安装列表，缺失自动安装/降级引导
4. Tool 检查    → 对比 toolRegistry（内置工具 + MCP 工具）
5. Config 检查  → 扫描 skill config + env vars，未设置提示填写
6. Knowledge    → 确认知识文件存在且格式可读
7. 全部通过     → Agent 可用
```

### 7.2 依赖隔离

每个 agent 独立安装 skill（类似 node_modules），避免不同 agent 间的版本冲突：

```
~/.talor/agents/sales-analyst/
├── agent.json
├── node_modules/               // 该 agent 的 skill 隔离安装目录
│   ├── lark-im@2.0/
│   └── lark-sheets@1.5/
└── ...

~/.talor/agents/customer-service/
├── agent.json
├── node_modules/
│   └── lark-im@3.0/           // 不同版本，互不干扰
└── ...
```

### 7.3 Skill 安装策略

**自动安装 + 失败降级手动引导**：

- 默认尝试自动安装（静默 npm install）
- 失败时降级为引导式手动安装（展示精确命令）
- 配置项（env vars, API keys）始终需要用户手动填写（安全考虑）

### 7.4 账户管理与变量注入

Skill 的 config 值支持 `{{变量名}}` 模板语法，运行时从全局账户管理中解析注入。

**账户管理**（设置 → 账户管理）：

用户按服务分组配置账户凭证，key-value 形式，secret 类型存 OS keychain：

```
设置 → 账户管理

┌─────────────────────────────┐
│  飞书                        │
│  feishu_appid:  cli_xxx     │
│  feishu_secret: ••••••      │
│  [编辑] [删除]               │
├─────────────────────────────┤
│  GitHub                      │
│  github_token:  ••••••      │
│  [编辑] [删除]               │
├─────────────────────────────┤
│  [+ 添加账户]                │
└─────────────────────────────┘
```

**变量注入流程**：
1. Agent 启动 → 扫描所有 skill config 值
2. 遇到 `{{feishu_appid}}` → 从账户管理查找 key `feishu_appid`
3. 找到 → 替换为实际值，注入为 skill 环境变量
4. 找不到 → 报错提示用户去账户管理中配置

**导入 agent 时**：扫描所有 `{{xxx}}` 引用，列出未配置的变量，引导用户在账户管理中补全。

**存储**：`~/.talor/accounts.json`（非 secret 字段）+ OS keychain（secret 字段）。

### 7.5 安装进度 UI

```
安装 Agent "销售分析师" 的依赖...

✅ lark-im@2.1.0 — 已安装
⏳ lark-sheets@1.5.3 — 安装中...
❌ lark-calendar@3.0.0 — 安装失败
   请手动执行: npx skills install lark-calendar

配置检查：
⚠️ LARK_APP_ID — 未设置（lark-im 需要）
⚠️ LARK_APP_SECRET — 未设置（lark-im 需要）
[填写配置]
```

---

## 8. Agent UI

### 8.1 全局导航

Agent 页面与 Chat、Settings 平级：

```
侧边栏：
├── 💬 对话（session 列表）
├── 🤖 Agent（agent 卡片列表）
└── ⚙️ 设置
```

### 8.2 Agent 卡片

```
┌─────────────────────────────┐
│  🤖 销售分析师               │
│                              │
│  自动汇总周度销售数据并生成   │
│  趋势分析报告                │
│                              │
│  ● lark-sheets  ● lark-im   │
│                              │
│  v1.0.0    上次使用: 2天前    │
│                              │
│  [启动对话]  [···]           │
└─────────────────────────────┘
```

卡片元素：
- 头像 + 名称
- 一句话描述
- 依赖标签（主要 skill/tool 小标签）
- 版本 + 最近使用时间
- 主操作："启动对话" → 创建绑定该 agent 的 session
- 更多菜单（···）：编辑、导出、删除、查看依赖状态

### 8.3 卡片状态

| 状态 | 视觉表现 |
|------|---------|
| 就绪 | 正常卡片，"启动对话"可点 |
| 已禁用 | 灰色卡片，"启动对话"不可点，显示"启用"按钮（导入后默认状态） |
| 依赖缺失 | 警告色，缺失标签标红，点击进入依赖安装流程 |
| 运行中 | 脉冲动画，显示"对话中"，点击跳转 session |

### 8.4 页面布局

- 卡片网格布局，自适应列数
- 最后一张 **"+新建"虚线卡片**，点击进入沉淀对话
- 右上角 **"导入"** 按钮，选择 `.agent.zip`

---

## 9. 技术实现要点

### 9.1 复用现有基础设施

| 现有模块 | 如何复用 |
|---------|---------|
| ReAct loop | Agent session 直接使用，无需新引擎 |
| PromptPipeline + AgentPromptPlugin（stub） | 激活 stub，从 `role` 结构化字段拼装 agent prompt + 知识目录（追加在 system prompt 之后） |
| toolRegistry + build-tools | 按 agent dependencies 过滤可用工具 |
| Session + SessionRepo | 新增 agent_id 字段 |
| ConfigStore | 存储 agent 运行时偏好 |
| MCP Client | Agent 依赖的 MCP 工具自动连接 |

### 9.2 新增模块

| 新模块 | 职责 |
|-------|------|
| `agent/loader.ts` | 扫描 `~/.talor/agents/`，解析 agent.json，构建内存索引 |
| `agent/dependency-checker.ts` | 依赖检查链（7 步） |
| `agent/skill-installer.ts` | Skill 自动安装 + 降级引导 |
| `agent/crystallizer.ts` | 沉淀引导 Agent 的 prompt + 逻辑 |
| `agent/variable-resolver.ts` | 解析 `{{变量}}` 模板，从账户管理注入值 |
| `agent/slash-invoke-parser.ts` | /agent 消息解析 |
| `ipc/agents.ts` | IPC handler：agent CRUD + 导入导出 + 沉淀预览/确认 |
| `renderer/pages/Agents/` | Agent 卡片页面 |
| `renderer/components/AgentCard.tsx` | 卡片组件 |
| `renderer/components/DependencyStatus.tsx` | 依赖安装进度 UI |
| `renderer/pages/Settings/Accounts.tsx` | 账户管理 UI |

---

## 10. 功能分块、用户故事与验收标准

### Block A：Agent 基础框架

**US-A1**：作为开发者，我需要 Agent Manifest Schema 的 TypeScript 类型定义和校验逻辑，以便后续模块基于统一数据结构开发。

验收标准：
- [ ] `AgentManifest` 及所有子类型在 `src/shared/types/agent.ts` 中定义
- [ ] `agent/validator.ts` 实现 manifest JSON 校验（必填字段、semver 格式、role.capabilities 非空等），非法 manifest 返回结构化错误
- [ ] 单元测试覆盖：合法 manifest 通过、缺少必填字段拒绝、非法 version 拒绝

设计方案：

**已完成**。`src/shared/types/agent.ts` 已定义全部类型（`AgentManifest`、`AgentRole`、`AgentKnowledge`、`KnowledgeFileRef`、`AgentDependencies`、`ToolDependency`、`SkillDependency`、`CliDependency`、`AgentWorkflow`、`AgentRuntime`、`AgentEntry`、`AgentStatus`、`ValidateManifestResult`、`DependencyCheckResult` 等 20 个 interface/type）。`src/main/agent/validator.ts` 的 `validateManifest(json: unknown): ValidateManifestResult` 已实现 8 项校验（id/name/description 非空字符串、version 必填 semver、minAppVersion 可选 semver、role.capabilities 非空数组、role.outputFormat 非空字符串、knowledge.files 数组中每项的 path/description/required 类型检查、dependencies.tools/skills/cli 数组检查）。**待补**：单元测试文件 `src/main/agent/validator.test.ts`。

**US-A2**：作为用户，我希望 Talor 启动时自动加载我已有的 agent，以便我能立即使用它们。

验收标准：
- [ ] `agent/loader.ts` 启动时扫描 `~/.talor/agents/*/agent.json`，解析并校验，构建内存索引
- [ ] 非法 manifest 跳过并 log 警告，不阻塞启动
- [ ] agent 目录缺失时自动创建 `~/.talor/agents/`
- [ ] 支持运行时热重载：通过 `fs.watch` 监听 `~/.talor/agents/` 目录变化，自动调用 `reload()` 刷新索引；也可通过 IPC 手动触发

设计方案：

**大部分已完成**。`src/main/agent/loader.ts` 的 `AgentLoader` 类已实现：构造函数接收 `agentsDir` 路径并在缺失时调用 `mkdirSync` 创建；`loadAll()` 遍历子目录、跳过 `__` 开头目录、读取 `agent.json`、调用 `validateManifest()` 校验、调用 `checkDependencies()` 检查依赖并设置 `status`（通过为 `'ready'`，否则为 `'disabled'`），非法 manifest 通过 `log.warn` 记录并 `continue` 跳过；`reload()` 委托 `loadAll()`；`getAll()`/`getById()`/`getByName()` 提供查询。`src/main/index.ts:25` 在模块顶层实例化 `new AgentLoader(join(app.getPath('home'), '.talor', 'agents'))`，`src/main/index.ts:110` 在 `app.whenReady()` 中调用 `agentLoader.loadAll().catch(...)`。IPC 手动触发已实现：`src/main/ipc/agents.ts:86-89` 注册 `agents:reload` handler 调用 `agentLoader.reload()`。**待补**：`fs.watch` 监听目录变化自动触发热重载——需在 `AgentLoader` 构造函数或 `loadAll()` 后注册 watcher。

**US-A3**：作为用户，我希望 agent 在运行时只能使用它声明的工具，防止越权操作。

验收标准：
- [ ] `build-tools` 在 agent session 中，以 manifest `dependencies` 为白名单过滤工具
- [ ] 平台基础内置工具（read, ls, glob, grep）始终可用，不需声明
- [ ] 高权限工具（bash, write, edit）必须在 `dependencies.tools` 中显式声明才可用
- [ ] 未声明的 skill 提供的工具不注入 agent session，即使平台已安装
- [ ] 单元测试：agent 未声明 bash → ReAct loop 中 bash tool 不可用

设计方案：

**已完成**。`src/main/tools/build-tools.ts:59` 定义 `ALWAYS_AVAILABLE_TOOLS = new Set(['read', 'ls', 'glob', 'grep'])`。`buildTools()` 接收可选参数 `agent?: AgentManifest`（:66）；当 `agent` 存在时（:78-83），构建白名单 `agentAllowedTools = new Set([...ALWAYS_AVAILABLE_TOOLS, ...agent.dependencies.tools.map(t => t.name)])`；在 `finalSchemas.filter()` 中（:85-90），若 `agentAllowedTools` 非空且工具名不在白名单中，则过滤掉该工具。调用链：`src/main/chat/orchestrator.ts:136-140` 将 `agent` 传入 `buildTools()`；`orchestrator.ts:117-124` 从 `ports.agentLoader.getById(session.agent_id)` 加载 manifest。MCP 外部工具同样受过滤（:88 的 `agentAllowedTools.has(schema.name)` 对所有 schema 统一生效）。**待补**：单元测试文件 `src/main/tools/build-tools.test.ts`（已存在但需验证覆盖 agent 过滤场景）。

---

### Block B：Agent 存储与导入导出

**US-B1**：作为用户，我希望将 agent 导出为文件分享给同事，同事导入后能使用。

验收标准：
- [ ] 导出：将 `~/.talor/agents/{name}/` 打包为 `{name}-{version}.agent.zip`（含 agent.json + knowledge/ + samples/ + avatar）
- [ ] 导入：选择 `.agent.zip` → 解压到 `~/.talor/agents/` → Agent 默认为"已禁用"状态 → 自动执行依赖检查 → 用户手动启用
- [ ] 导入同名 agent 提示覆盖确认
- [ ] 导出/导入通过 IPC handler 实现（`agents:export`, `agents:import`）

设计方案：

**待实现**。需要的改动：

1. **新建 `src/main/agent/exporter.ts`**：导出函数 `exportAgent(dirPath: string, manifest: AgentManifest): Promise<Buffer>`，使用 `archiver` 库将 `dirPath` 目录压缩为 zip 格式的 `Buffer`，包含 `agent.json`、`knowledge/`、`samples/`、`avatar.*`，排除 `node_modules/`。

2. **新建 `src/main/agent/importer.ts`**：导入函数 `importAgent(zipBuffer: Buffer, agentsDir: string): Promise<{ manifest: AgentManifest; dirPath: string; overwritten: boolean }>`，使用 `adm-zip` 解压到临时目录、调用 `validateManifest()` 校验 `agent.json`、检测 `agentsDir` 下是否存在同名目录（以 `manifest.name` 为目录名），存在则返回 `overwritten: true` 标记（IPC 层据此向 renderer 请求覆盖确认），最终移动到 `agentsDir/{name}/`。

3. **`src/main/ipc/agents.ts` 新增两个 handler**：
   - `agents:export`（参数 `agentId: string`）：调用 `agentLoader.getById()` 获取 `entry`，调用 `exportAgent(entry.dirPath, entry.manifest)` 获取 zip Buffer，通过 Electron `dialog.showSaveDialog()` 让用户选择保存路径，`writeFileSync` 写入。
   - `agents:import`（无参数）：通过 `dialog.showOpenDialog({ filters: [{ name: 'Agent', extensions: ['zip'] }] })` 让用户选择文件，`readFileSync` 读入，调用 `importAgent()`；若同名存在，通过 `webContents.send('agents:import-confirm', ...)` 向 renderer 发起覆盖确认（或直接返回 `{ needConfirm: true, name }` 让 renderer 弹窗后再调用 `agents:import-confirm`）。导入完成后将 `status` 设为 `'disabled'`，调用 `agentLoader.reload()`。

4. **`src/preload/index.ts` 的 `talorAPI.agents` 新增**：`export: (id: string) => ipcRenderer.invoke('agents:export', id)` 和 `import: () => ipcRenderer.invoke('agents:import')`。

5. **依赖包**：`package.json` 新增 `archiver`（生产依赖）和 `adm-zip`（生产依赖），或统一使用 Node 内置 `zlib` + `tar`（但 zip 格式更适合用户分享，建议用第三方库）。

**US-B2**：作为用户，导入 agent 后，我希望系统告诉我缺什么并帮我装好。

验收标准：
- [ ] 导入后自动执行 7 步依赖检查链（minAppVersion → CLI → Skill → Tool → Config → Knowledge → 通过）
- [ ] 每步检查结果清晰展示：通过 ✅ / 缺失 ⚠️ / 失败 ❌
- [ ] minAppVersion 不满足时明确提示需升级 Talor 到什么版本
- [ ] 导入后 Agent 默认"已禁用"状态，依赖全部满足且用户点击"启用"后卡片状态变为"就绪"

设计方案：

**依赖检查链已实现，展示层和 minAppVersion 实际比较待补**。`src/main/agent/dependency-checker.ts` 的 `checkDependencies(manifest, dirPath): Promise<DependencyCheckResult>` 已实现 6 步检查（minAppVersion → cli → skill → tool → config → knowledge）加 1 步 complete 汇总，每步返回 `DependencyStepResult { step, status: 'pass'|'missing'|'fail', message?, details? }`。`src/main/ipc/agents.ts:23-27` 注册了 `agents:check-deps` handler 供 renderer 调用。

**待补改动**：

1. **`src/main/agent/dependency-checker.ts` 的 `checkMinAppVersion()`**（:42-47）：当前硬编码返回 `'pass'`，需改为读取 `app.getVersion()`（或从 `package.json` 读取）与 `manifest.minAppVersion` 做 semver 比较（使用 `semver.gte()`），不满足时返回 `{ status: 'fail', message: \`需要 Talor >= ${manifest.minAppVersion}，当前版本 ${currentVersion}\` }`。

2. **`src/main/agent/dependency-checker.ts` 的 `checkCli()`**（:49-65）：当前仅将所有 `required` CLI 列为 missing，未实际执行 `checkCommand`。需改为用 `child_process.execSync(dep.checkCommand ?? \`${dep.command} --version\`)` 检测是否存在，失败时将 `dep.installHint` 放入 `details`。

3. **renderer 侧展示**：在 US-C4 设计中覆盖（依赖安装进度 UI）。

4. **"已禁用 → 启用"流程**：需在 `src/main/ipc/agents.ts` 新增 `agents:enable` handler（参数 `agentId`），调用 `checkDependencies()` → 全部通过则修改内存索引中 `entry.status = 'ready'`（`AgentLoader` 需新增 `setStatus(id, status)` 方法），未通过则返回 `DependencyCheckResult` 让 renderer 展示。

**US-B3**：作为用户，删除 agent 后，之前绑定该 agent 的 session 仍然可以查看历史对话。

验收标准：
- [ ] 删除 agent 时不删除已绑定的 session 记录
- [ ] 已绑定 session 的 `agent_id` 保留（外键不级联删除），session 仍可正常打开并查看历史消息
- [ ] 打开已删除 agent 的历史 session 时，顶部展示提示"该 Agent 已删除，当前为普通对话模式"
- [ ] 已删除 agent 的 session 不再注入 agent prompt 和工具过滤，回退为普通 session 行为

设计方案：

**不级联删除已自然满足**。`src/main/db/index.ts` 的 sessions 表中 `agent_id` 是普通 `TEXT` 列（:14），无外键约束指向 agent，因此删除 agent 目录不影响 session 行。`src/main/ipc/agents.ts:74-84` 的 `agents:delete` handler 仅调用 `rmSync(entry.dirPath)` + `agentLoader.reload()`，不触碰 sessions 表。

**需要的改动**：

1. **`src/main/chat/orchestrator.ts:118-124`**：当前 `if (session?.agent_id && ports.agentLoader)` 分支中，`agentLoader.getById()` 返回 `undefined` 时 `agent` 保持 `undefined`，后续 prompt 注入和工具过滤自动跳过——**已正确回退为普通 session 行为，无需改动**。

2. **renderer 提示 banner**：`src/renderer/pages/Chat/index.tsx` 在 `currentSessionId` 变化时的 `useEffect`（:112-130）中，需新增逻辑：若 `session.agent_id` 存在，调用 `talorAPI.agents.get(session.agent_id)`，返回 `undefined` 则设置状态 `agentDeleted = true`。在 `modelUnavailable` banner 下方（:466 附近）新增条件渲染：`{agentDeleted && <div className="...bg-amber-50...">该 Agent 已删除，当前为普通对话模式</div>}`。

---

### Block C：依赖管理与账户管理

**US-C1**：作为用户，导入 agent 时缺少的 skill 应自动安装，安装失败给我明确指引。

验收标准：
- [ ] `agent/skill-installer.ts` 按 `source` 字段自动执行安装（npm install）
- [ ] 安装成功后自动注册到 agent 的隔离 `node_modules/`
- [ ] 安装失败降级为手动引导：展示精确安装命令
- [ ] 安装进度通过 IPC 事件实时推送到 UI（`agent:install-progress`）

设计方案：

**待实现**。需要的改动：

1. **新建 `src/main/agent/skill-installer.ts`**：导出函数 `installSkills(manifest: AgentManifest, dirPath: string, onProgress: (event: SkillInstallProgress) => void): Promise<SkillInstallResult>`。遍历 `manifest.dependencies.skills`，对每个 skill：
   - 根据 `source.type` 构建安装命令：`'npm'` → `npm install ${source.package}@${version} --prefix ${dirPath}`；`'git'` → `npm install ${source.url}`；`'url'` → 下载后本地安装。
   - 用 `child_process.spawn()` 执行，将 stdout/stderr 流式传给 `onProgress` 回调。
   - 成功后调用 `onProgress({ skill: name, status: 'installed' })`，失败时调用 `onProgress({ skill: name, status: 'failed', installHint: \`npm install ${source.package} --prefix ${dirPath}\` })`。

2. **`src/shared/types/agent.ts` 新增类型**：`SkillInstallProgress { skill: string; status: 'installing' | 'installed' | 'failed'; installHint?: string }` 和 `SkillInstallResult { installed: string[]; failed: Array<{ name: string; hint: string }> }`。

3. **`src/main/ipc/agents.ts` 新增 handler `agents:install-deps`**（参数 `agentId`）：调用 `installSkills()`，在 `onProgress` 回调中通过 `webContents.send('agent:install-progress', event)` 实时推送到 renderer。

4. **`src/preload/index.ts` 的 `talorAPI.agents` 新增**：`installDeps: (id: string) => ipcRenderer.invoke('agents:install-deps', id)` 和 `onInstallProgress: (callback) => { ipcRenderer.on('agent:install-progress', handler); return cleanup }`。

**US-C2**：作为用户，我希望在"账户管理"中配置一次飞书/GitHub 凭证，所有 agent 自动共享。

验收标准：
- [ ] 设置页新增"账户管理"tab，支持添加/编辑/删除账户（服务名 + key-value 字段列表）
- [ ] secret 类型字段存入 OS keychain，UI 显示为 `••••••`
- [ ] 非 secret 字段存入 `~/.talor/accounts.json`
- [ ] 账户增删改通过 IPC handler 实现

设计方案：

**大部分已完成，OS keychain 集成待补**。

**已完成部分**：
- `src/renderer/pages/Settings/index.tsx:32` 定义了 `activeTab` 状态含 `'accounts'` 选项，:201-209 渲染"账户管理"tab 按钮，:335-339 在 `activeTab === 'accounts'` 时渲染 `<AccountsSettings />`。
- `src/renderer/pages/Settings/Accounts.tsx` 完整实现了账户管理 UI：添加/删除账户表单、服务名 + key-value 字段列表、secret 字段用 `type="password"` 渲染。调用 `talorAPI.accounts.save/delete/list`。
- `src/main/ipc/accounts.ts` 注册了 `accounts:list`/`accounts:save`/`accounts:delete`/`accounts:get-value` 四个 handler，委托给 `AccountStore`。
- `src/main/agent/accounts.ts` 的 `AccountStore` 实现了完整 CRUD：`list()` 将 secret 字段值替换为 `'••••••'` 返回；`save()` 校验 key name 正则 `/^[a-zA-Z0-9_]+$/`；`persist()` 将 secret 值替换为 `'__encrypted__'` 后写入 `~/.talor/accounts.json`，实际 secret 值保存在内存 `Map<string, string>` 中。
- `src/preload/index.ts:348-353` 暴露了 `talorAPI.accounts` 的 4 个方法。

**待补**：`AccountStore` 当前的 secret 存储仅在内存中（进程重启后丢失，因为文件中保存的是 `'__encrypted__'` 占位符）。需集成 `src/main/services/safe-storage.ts` 的 `SafeStorageService`（已存在，用于 API key 存储），在 `persist()` 时调用 `safeStorage.encryptString(value)` 存储加密后的 Buffer，在 `load()` 时调用 `safeStorage.decryptString()` 恢复。或者更简洁的方案：将 secret 值存入独立的 `~/.talor/accounts-secrets.json` 并用 Electron `safeStorage` API 加密整个文件。

**US-C3**：作为用户，agent 的 skill 配置中写 `{{feishu_appid}}`，运行时能自动替换为我配置的实际值。

验收标准：
- [ ] `agent/variable-resolver.ts` 解析 config 中所有 `{{xxx}}` 引用
- [ ] 从账户管理数据中查找对应 key 并替换
- [ ] 找不到的变量 → 报错并列出未配置变量列表，引导去账户管理配置
- [ ] 替换后的值注入为 skill 运行时环境变量
- [ ] 单元测试：变量存在时替换成功、变量缺失时报结构化错误

设计方案：

**解析和替换已完成，环境变量注入待补**。

**已完成部分**：`src/main/agent/variable-resolver.ts` 的 `resolveVariables(config: Record<string, string>, accountValues: Map<string, string>): ResolveResult` 使用正则 `/^\{\{(\w+)\}\}$/` 匹配模板变量，匹配到的从 `accountValues` 查找替换，未匹配的保留原值，找不到的变量收集到 `missing` 数组。调用点在 `src/main/ipc/agents.ts:40-56` 的 `agents:create-session` handler 中：收集所有 skill 的 config、调用 `accountStore.getAllValues()` 获取全局账户值、调用 `resolveVariables()`、`missing.length > 0` 时 `throw Error` 提示去账户管理配置。

**待补改动**：

1. **环境变量注入**：当前 `resolveResult.resolved` 计算后未实际注入到 skill 运行时。需要将 resolved 的 key-value 设置到 agent session 的上下文中。具体方案：在 `agents:create-session` 的返回值中附带 `resolvedConfig`，或在 `AgentEntry` 上增加 `resolvedConfig?: Record<string, string>` 字段，在 `sendChat` 时通过 `process.env` 临时注入（注意线程安全）或传入 skill 的 execute context。

2. **单元测试**：需新建 `src/main/agent/variable-resolver.test.ts`，覆盖：全部变量存在 → `missing` 为空、部分缺失 → `missing` 列出缺失变量名、非模板值 → 原样保留、空 config → 空结果。

**US-C4**：作为用户，导入 agent 或启动 agent 时，我希望看到依赖安装的实时进度。

验收标准：
- [ ] 依赖安装 UI 以模态框或内嵌面板形式展示，逐行列出每个依赖的检查/安装状态
- [ ] 每行依赖实时更新状态图标：✅ 已就绪 / ⏳ 安装中 / ❌ 安装失败
- [ ] 安装失败的依赖显示精确的手动安装命令（可复制）
- [ ] 配置检查（缺失的 `{{变量}}`）在依赖安装完成后展示，列出未配置变量及其所属 skill，提供"前往账户管理"链接
- [ ] 全部通过后显示"就绪"状态，用户可点击"启用 Agent"

设计方案：

**待实现**。需要的改动：

1. **新建 `src/renderer/components/DependencyStatus.tsx`**：模态框组件 `DependencyStatusModal({ agentId, onClose, onEnabled })`。打开时调用 `talorAPI.agents.checkDeps(agentId)` 获取 `DependencyCheckResult`，将 `steps[]` 逐行渲染，每行显示 step 名称 + 状态图标（pass → 绿色对勾、missing → 黄色警告、fail → 红色叉）+ message 文本。对于 `status === 'missing'` 的 skill 步骤，显示"安装"按钮触发 `talorAPI.agents.installDeps(agentId)`，并监听 `talorAPI.agents.onInstallProgress()` 实时更新行状态。对于 config 步骤列出的 `{{变量}}`，渲染为"前往账户管理"链接（触发 `App.tsx` 导航到 settings 页面的 accounts tab）。底部：全部 pass 时显示"启用 Agent"按钮（调用 `talorAPI.agents.enable(agentId)`），否则显示"关闭"。

2. **`src/renderer/pages/Agents/index.tsx` 集成**：在 `AgentCard` 的 `onLaunch` 之外，新增 `onCheckDeps` 回调，点击依赖缺失态卡片时打开 `<DependencyStatusModal />`。`AgentsPage` 管理 `checkingAgentId` 状态控制模态框。

3. **`src/preload/index.ts` 的 `talorAPI.agents` 新增**：`enable: (id: string) => ipcRenderer.invoke('agents:enable', id)`（对应 US-B2 设计中的 `agents:enable` handler）。

---

### Block D：Agent 运行时（Session 绑定 + Prompt 注入）

**US-D1**：作为用户，我从 Agent 卡片点"启动对话"后，进入的 session 应该就是那个 agent 的角色和能力。

验收标准：
- [ ] Session 表新增 `agent_id` 可选字段 + DB 迁移脚本
- [ ] 创建 agent session 时：设置 `agent_id`，加载 agent manifest
- [ ] `AgentPromptPlugin` 激活：将 `role`（capabilities/constraints/outputFormat）拼装为结构化 agent prompt，追加到 system prompt 之后（不替换）
- [ ] `knowledge.files` 的 description 列表注入为知识目录，LLM 按需通过 read tool 加载内容
- [ ] `sampleConversations` 作为 few-shot 注入
- [ ] 工具集按 `dependencies` 白名单过滤（Block A 的 US-A3）
- [ ] session 标题显示 agent name

设计方案：

**全部已完成**。

- **Session 表 `agent_id` 列**：`src/main/db/index.ts:97-101` 在 `initChatDb()` 中通过 `ALTER TABLE sessions ADD COLUMN agent_id TEXT` 迁移添加。`src/main/repos/session-repo.ts` 的 `SessionRow`(:14) 和 `ChatSession`(:34) 均包含 `agent_id` 字段；`create()`(:87) 接受 `agent_id?` 参数并写入 INSERT 语句(:92-94)。

- **创建 agent session**：`src/main/ipc/agents.ts:29-72` 的 `agents:create-session` handler：校验依赖 → 解析变量 → 获取 default provider → 调用 `sessionRepo.create({ title: entry.manifest.name, provider_id, agent_id: entry.manifest.id })`。title 直接使用 agent name。

- **AgentPromptPlugin 激活**：`src/main/prompt/plugins/AgentPromptPlugin.ts` 已从 stub 变为完整实现。`build(ctx)` 在 `ctx.agent` 存在时：`buildAgentPrompt(role)` 拼装能力/约束/输出格式为中文系统指令（:34-60）；`buildKnowledgeIndex(knowledge)` 生成知识文件目录（:62-71）；`buildFewShot(sampleConversations)` 转换为 user/assistant message 对（:73-83）。返回 `{ messages: [{ role: 'system', content }, ...fewShot], tools: [], tokenEstimate }`。

- **上下文传递链**：`PipelineContext`(`src/main/prompt/types.ts:24`) 含 `agent?: AgentManifest`。`orchestrator.ts:117-124` 加载 manifest → `:165` 传入 `runReactLoop({ agent })` → `ReactLoopOptions`(`src/main/loop/types.ts:29`) 含 `agent?` → react-loop 在 `pipeline.build(ctx)` 时传入 `ctx.agent`。

- **工具沙箱过滤**：见 US-A3 设计方案（已完成）。

**US-D2**：作为用户，我希望在 session 列表中一眼区分 agent session 和普通 session。

验收标准：
- [ ] agent session 在 session 列表中显示 agent 头像（无头像则显示默认 agent 图标）
- [ ] agent session 标题格式为 `{agent.name} — {session 标题}`，与普通 session 视觉区分
- [ ] 点击 agent session 后，chat 页面顶部展示 agent 名称和简短描述
- [ ] session 列表支持筛选"仅 Agent 对话"

设计方案：

**待实现**。需要的改动：

1. **`src/renderer/components/SessionItem.tsx`**（已存在）：当前接收 `session: ChatSession`。需改为：若 `session.agent_id` 存在，调用 `talorAPI.agents.get(session.agent_id)` 获取 `AgentEntry`（可在 `AgentsPage` 挂载时批量加载到 `agentStore`，`SessionItem` 从 store 读取，避免逐项请求）。渲染时：左侧显示 agent avatar 的首字母圆形图标（同 `AgentCard` 的渐变圆形）替代默认图标，标题前缀追加 agent name（`{agent.name} — {session.title}`）。

2. **`src/renderer/store/agentStore.ts`**：新增 `agentMap: Map<string, AgentEntry>` 派生数据（或 `agentById(id)` 方法），供 `SessionItem` 快速查找。

3. **`src/renderer/pages/Chat/index.tsx`**：在 session 选中后（:112-130 的 `useEffect`），若 `session.agent_id` 存在且 agent 未删除，设置 `currentAgent` 状态。在消息区域上方（:462-465 之间）新增 agent info banner：`<div>Agent: {currentAgent.manifest.name} — {currentAgent.manifest.description}</div>`。

4. **session 列表筛选**：`src/renderer/pages/Chat/index.tsx` 的 session 侧边栏（:431-460）新增筛选按钮"仅 Agent 对话"，`useState<boolean>(false)` 控制，启用时 `sessions.filter(s => s.agent_id)`。

**US-D3**：作为用户，我在任意对话中输入 `/销售分析师 帮我看下本周数据`，该 agent 应介入回答本次消息。

验收标准：
- [ ] `agent/slash-invoke-parser.ts` 解析消息文本，提取 `/{name}` 并匹配已加载 agent
- [ ] 匹配成功 → 本次 ReAct loop 注入该 agent 的 prompt + 工具过滤
- [ ] 依赖检查不通过 → 提示用户解决依赖问题，不执行
- [ ] agent 回复完成后 session 恢复原始状态（不持久改变 session prompt）
- [ ] /不存在的 agent 名 → 作为普通文本处理，不报错

设计方案：

**待实现**。需要的改动：

1. **新建 `src/main/agent/slash-invoke-parser.ts`**：导出函数 `parseSlashInvoke(text: string, agentLoader: AgentLoader): { agent: AgentManifest; remainingText: string } | null`。用正则 `/^\/(\S+)\s*([\s\S]*)$/` 提取首个 token 作为 agent name，调用 `agentLoader.getByName(name)`，匹配到则返回 `{ agent: entry.manifest, remainingText }`，未匹配返回 `null`（消息原样处理）。

2. **`src/main/chat/orchestrator.ts` 改动**（:85-187 的 `sendChat()`）：在 Step 4（provider 选择）之后、agent 加载逻辑（:117-124）之后，新增 slash invoke 检测：
   ```
   if (!agent && ports.agentLoader) {
     const invocation = parseSlashInvoke(userContent, ports.agentLoader)
     if (invocation) {
       const depResult = await checkDependencies(invocation.agent, ...)
       if (!depResult.passed) throw new Error('Agent 依赖不满足: ...')
       agent = invocation.agent
       userContent = invocation.remainingText  // 去掉 /{name} 前缀
     }
   }
   ```
   由于 `agent` 是局部变量（:117 `let agent`），本次调用结束后自然不影响 session 状态——session 表的 `agent_id` 不被修改，下次 `sendChat` 读取 session 时 `agent_id` 仍为 null（或原值），满足"恢复原始状态"要求。

3. **依赖检查需要 `dirPath`**：`parseSlashInvoke` 返回值需扩展为包含 `entry: AgentEntry`（含 `dirPath`），而非仅 `manifest`，以便 `checkDependencies(entry.manifest, entry.dirPath)` 能正确检查知识文件路径。

---

### Block E：沉淀流程（Chat → Agent）

**US-E1**：作为用户，我在一次成功的对话后，希望通过对话式引导将这个流程保存为 agent。

验收标准：
- [ ] Chat 页面新增"沉淀为 Agent"按钮（在 session 工具栏区域）
- [ ] 点击后创建临时 session，传入原 session 消息历史作为上下文
- [ ] 沉淀引导 Agent（内置 platform agent）通过问答逐步提炼：名称、描述、工具保留、输入参数化、示范对话、风格
- [ ] Crystallizer Agent 在对话中展示 Agent 定义摘要（名称、描述、能力、依赖、知识文件列表）
- [ ] 用户确认后，Crystallizer Agent 通过 write tool 写入 `~/.talor/agents/{name}/agent.json` 及知识文件、示范对话
- [ ] agent 创建成功后在 Agent 卡片页面可见

设计方案：

**待实现**。需要的改动：

1. **新建 `src/main/agent/crystallizer.ts`**：定义沉淀引导 Agent 的 systemPrompt 常量和辅助逻辑。systemPrompt 指导 LLM 按步骤引导用户：分析原 session 消息历史 → 提炼名称/描述/能力/约束/输出格式 → 列出使用过的工具作为 dependencies → 询问是否保留当前对话作为示范 → 生成 agent.json 草稿 → 展示摘要让用户确认 → 确认后使用 write tool 创建 `~/.talor/agents/{name}/` 目录和文件。导出函数 `buildCrystallizerManifest(originalMessages: ChatMessage[]): AgentManifest`（作为内置 platform agent 的 manifest，声明 `write` tool 依赖以便实际写入文件）。

2. **`src/main/ipc/agents.ts` 新增 handler `agents:crystallize`**（参数 `{ sourceSessionId: string }`）：
   - 读取原 session 消息历史：`messageRepo.listBySession(sourceSessionId)`。
   - 创建临时 session：`sessionRepo.create({ title: '沉淀为 Agent', provider_id, agent_id: '__crystallizer__' })`，使用特殊 `agent_id` 标记。
   - 将原 session 消息历史序列化为上下文文本，作为临时 session 的首条 system message 写入（或注入到 crystallizer 的 systemPrompt 中）。
   - 返回 `{ sessionId: tempSessionId }` 给 renderer，renderer 导航到该 session 继续对话。

3. **`src/main/chat/orchestrator.ts` 改动**：在 agent 加载逻辑（:117-124）中增加 `__crystallizer__` 特殊处理——加载内置 crystallizer manifest 而非从 `agentLoader` 查找。

4. **`src/renderer/pages/Chat/index.tsx`**：在输入框工具栏区域（:536 的 `<div className="p-4 border-t">` 内部）新增"沉淀为 Agent"按钮，条件渲染：`messages.length > 0 && streamState !== 'streaming'` 时显示。点击调用 `talorAPI.agents.crystallize({ sourceSessionId: currentSessionId })`，成功后导航到返回的临时 session。

5. **写入文件后刷新**：Crystallizer Agent 使用 write tool 创建文件后，`AgentLoader` 的 `fs.watch`（US-A2 待补）或手动 `agentLoader.reload()` 自动感知新 agent。renderer 侧 Agents 页面在下次访问时重新 `talorAPI.agents.list()` 获取最新列表。

6. **`src/preload/index.ts` 的 `talorAPI.agents` 新增**：`crystallize: (params: { sourceSessionId: string }) => ipcRenderer.invoke('agents:crystallize', params)`。

**US-E2**：作为用户，我希望可以在沉淀过程中取消，不产生任何副作用。

验收标准：
- [ ] 沉淀临时 session 的对话窗口显示"取消沉淀"按钮
- [ ] 点击取消 → 弹出确认对话框（"沉淀尚未完成，确认取消？"）
- [ ] 确认取消后，删除临时 session，不创建任何 agent 文件
- [ ] 原 session 不受影响，用户回到原 session 继续对话

设计方案：

**待实现**。需要的改动：

1. **`src/renderer/pages/Chat/index.tsx`**：检测当前 session 是否为沉淀临时 session（`session.agent_id === '__crystallizer__'`）。是则：在消息区域顶部渲染 banner"正在沉淀为 Agent"，右侧显示"取消沉淀"按钮。保存 `crystallizerSourceSessionId` 状态（从 `agents:crystallize` 返回值传入或存在 session metadata 中）。

2. **取消流程**：点击"取消沉淀" → 弹出 `<ConfirmDialog>`（复用已有组件 `src/renderer/components/ConfirmDialog.tsx`，title="取消沉淀"，message="沉淀尚未完成，确认取消？"）→ 确认后：调用 `talorAPI.chat.abort(currentSessionId)` 中止进行中的流 → 调用 `talorAPI.session.delete(currentSessionId)` 删除临时 session → 导航回 `crystallizerSourceSessionId`（`setCurrentSession(sourceSessionId)`）→ 刷新 session 列表。

3. **防止文件残留**：若 Crystallizer Agent 在取消前已部分写入文件到 `~/.talor/agents/{name}/`，取消时需清理。方案：`agents:crystallize` handler 在创建临时 session 时记录 `targetAgentDir`（但 agent name 在对话过程中才确定，无法提前知道）。更实用的方案：在 `agents:cancel-crystallize` handler 中，检查临时 session 的消息历史中是否包含 `write` tool 调用结果，解析写入的文件路径并删除。或者简化为：沉淀完成（用户确认）前不写入文件，所有内容在 Crystallizer 对话中仅展示为文本，用户确认后一次性写入。

**US-E3**：作为用户，沉淀出的 agent 应该准确反映我原始对话中使用的工具和流程。

验收标准：
- [ ] 沉淀引导 Agent 的 systemPrompt 指导它：分析消息历史中的 tool call 记录，提取使用过的工具/skill 列表
- [ ] 生成的 `dependencies` 只包含原对话中实际使用过的工具（不多不少）
- [ ] 生成的 `role`（capabilities/constraints/outputFormat）准确概括原对话中的角色定位和任务模式
- [ ] 如果原对话中使用了需要 `{{变量}}` 的 skill config，引导用户确认变量名

设计方案：

**待实现，与 US-E1 的 crystallizer.ts 合并设计**。

1. **systemPrompt 关键指令**：`src/main/agent/crystallizer.ts` 的 systemPrompt 需包含明确指令：
   - "分析用户提供的原始对话历史，从中提取所有 `tool_use` 类型的 content block，收集 `toolName` 去重后作为 `dependencies.tools` 列表"
   - "read/ls/glob/grep 为平台基础工具，不需加入 dependencies；bash/write/edit 等需显式声明"
   - "从对话中推断用户角色定位，生成 `role.capabilities`（用户解决了什么问题）和 `role.constraints`（用户表达的限制）"
   - "若对话中涉及外部 API 调用或 skill 使用，检查是否需要 `{{变量}}` 配置，向用户确认变量名称"

2. **工具提取辅助**：在 `agents:crystallize` handler 中，预处理原 session 消息，提取所有 tool call 的 toolName 列表，作为上下文的一部分注入到 crystallizer 的 systemPrompt 中（`以下是原对话中使用过的工具: [bash, read, lark-im:send-message, ...]`），降低 LLM 遗漏风险。

3. **验证**：Crystallizer Agent 生成 `agent.json` 草稿后，在展示摘要时明确列出 `dependencies.tools` 和 `dependencies.skills`，让用户确认"是否要保留/移除某些工具"。

---

### Block F：Agent UI

**US-F1**：作为用户，我希望在独立页面看到我所有 agent 的卡片，一目了然。

验收标准：
- [ ] 侧边栏新增"Agent"导航项，与"对话""设置"平级
- [ ] Agent 页面展示卡片网格（自适应列数）
- [ ] 每张卡片显示：头像、名称、描述、依赖标签、版本、最近使用时间
- [ ] 最后一张为"+新建"虚线卡片（点击进入沉淀对话）
- [ ] 右上角"导入"按钮，触发文件选择 `.agent.zip`

设计方案：

**大部分已完成，lastUsedAt 和导入按钮待补**。

**已完成部分**：
- `src/renderer/App.tsx:9` 的 `page` 状态含 `'agents'` 选项；:29 渲染 `<AgentsPage onChatClick={goToChat} />`。
- `src/renderer/components/Header.tsx:8` 接收 `onAgentsClick?`；:44-56 渲染"Agent"导航按钮（含 SVG 图标），与"对话""设置"平级。
- `src/renderer/pages/Agents/index.tsx` 实现卡片页面：:43 使用 `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4` 自适应网格；遍历 `agents` 渲染 `<AgentCard />`；:51 渲染 `<NewAgentCard />`。
- `src/renderer/components/AgentCard.tsx` 渲染卡片：首字母渐变圆形图标（:21-23）、名称(:25)、描述(:26)、skill/tool 依赖标签(:30-38，过滤掉 ALWAYS_AVAILABLE_TOOLS)、版本(:41)、"启动对话"按钮(:42-49)。

**待补改动**：

1. **`lastUsedAt` 显示**：`AgentCard` 需渲染 `agent.lastUsedAt`（:41 版本号旁边）。`AgentEntry.lastUsedAt` 类型已定义（`src/shared/types/agent.ts:113`），但 `AgentLoader.loadAll()` 未赋值。需要两处改动：(a) `src/main/ipc/agents.ts` 的 `agents:create-session` handler 在成功创建 session 后更新 `entry.lastUsedAt = new Date().toISOString()`（`AgentLoader` 需新增 `updateLastUsed(id)` 方法）；(b) `lastUsedAt` 需持久化——在 `~/.talor/agents/{name}/` 下新增 `.meta.json` 文件存储运行时元数据，或统一存入 `~/.talor/agent-meta.json`。

2. **"导入"按钮**：`src/renderer/pages/Agents/index.tsx` 的标题行（:40-42）右侧新增"导入"按钮：`<button onClick={() => talorAPI.agents.import()}>导入</button>`。导入完成后调用 `talorAPI.agents.reload().then(setAgents)` 刷新列表。

3. **"+新建"卡片点击**：当前 `<NewAgentCard onClick={() => {}} />` 的 onClick 为空。需改为触发沉淀流程——但沉淀需要原 session 上下文，"新建"应导航到 Chat 页面并弹出引导。可选方案：导航到 Chat 页面 + 新建空 session + 自动触发 crystallize（无原 session 历史时变为从零创建 agent 的对话）。

**US-F2**：作为用户，我希望卡片能反映 agent 当前状态。

验收标准：
- [ ] 就绪态：正常卡片样式，"启动对话"按钮可点
- [ ] 已禁用态：灰色卡片，"启动对话"不可点，显示"启用"按钮（导入后默认状态）
- [ ] 依赖缺失态：卡片带警告色，缺失的依赖标签标红，点击进入依赖安装流程
- [ ] 运行中态：卡片带脉冲动画，显示"对话中"，点击跳转到对应 session
- [ ] 状态切换操作：已禁用 → 点击"启用" → 触发依赖检查 → 全部通过变为就绪，缺失则变为依赖缺失
- [ ] 状态切换操作：依赖缺失 → 点击缺失标签 → 进入依赖安装流程（US-C4）→ 安装完成后变为就绪
- [ ] 状态切换操作：就绪 → 点击"启动对话" → 创建 agent session → 变为运行中
- [ ] 状态切换操作：运行中 → session 结束/关闭 → 自动回到就绪态

设计方案：

**部分已完成（disabled/ready 两态），dependency_missing 和 running 态待补**。

**已完成部分**：`src/renderer/components/AgentCard.tsx:17-19` 根据 `status === 'disabled'` 切换灰色样式（`bg-gray-50 border-gray-200 opacity-60`）vs 正常白色样式。:44 的"启动对话"按钮在 `status === 'disabled'` 时 `disabled`。`AgentStatus` 类型（`src/shared/types/agent.ts:107`）已定义四态：`'disabled' | 'ready' | 'dependency_missing' | 'running'`。

**待补改动**：

1. **`src/renderer/components/AgentCard.tsx` 扩展状态渲染**：
   - `dependency_missing`：外层 div 增加条件 `status === 'dependency_missing' ? 'border-amber-300 bg-amber-50'`；依赖标签中，缺失的标签用红色样式（需从 `DependencyCheckResult` 获取缺失列表——卡片级别可缓存 `checkDeps` 结果到 `agentStore`，或 `AgentEntry` 新增 `missingDeps?: string[]` 字段在 `loadAll()` 时填充）。底部按钮改为"检查依赖"触发 `onCheckDeps(agentId)`。
   - `running`：外层 div 增加 `animate-pulse` class（Tailwind 脉冲动画）；按钮文案改为"对话中"，`onClick` 改为 `onGoToSession(sessionId)`（需知道正在运行的 session id——`AgentEntry` 新增 `activeSessionId?: string` 字段，在 `agents:create-session` 时设置，session 结束时清除）。
   - `disabled`：按钮改为"启用"（而非"启动对话"），`onClick` 调用 `onEnable(agentId)`。

2. **`src/renderer/pages/Agents/index.tsx` 新增回调**：`handleEnable(agentId)` → `talorAPI.agents.enable(agentId)` → 成功则刷新列表；`handleCheckDeps(agentId)` → 打开 `DependencyStatusModal`（US-C4）；`handleGoToSession(sessionId)` → `onChatClick(sessionId)`。将这些回调传入 `<AgentCard />`。

3. **`AgentCard` props 扩展**：`onEnable?: (id: string) => void`、`onCheckDeps?: (id: string) => void`、`onGoToSession?: (sessionId: string) => void`。

4. **运行中态追踪**：`AgentLoader` 新增 `setRunning(agentId, sessionId)` 和 `clearRunning(agentId)` 方法。`agents:create-session` handler 成功后调用 `setRunning()`。session 结束检测：在 `sendChat` 的 `onDone` 回调中，若 session 绑定 agent，调用 `clearRunning()`。或更简洁：`AgentsPage` 加载时查询所有 sessions，检查哪些 agent 有正在进行的 session（`sessions.filter(s => s.agent_id).map(s => s.agent_id)`），与 agents 列表交叉后设置 running 态。

**US-F3**：作为用户，我希望能管理 agent（编辑、导出、删除）。

验收标准：
- [ ] 卡片更多菜单（···）包含：编辑、导出、删除、查看依赖状态
- [ ] 删除弹出确认对话框，确认后删除 `~/.talor/agents/{name}/` 目录
- [ ] 导出触发下载 `.agent.zip`
- [ ] 编辑跳转到 agent 定义详情页（展示 manifest 字段，可修改 description、prompt 等非结构字段）

设计方案：

**删除后端已完成，其余待实现**。

**已完成部分**：`src/main/ipc/agents.ts:74-84` 的 `agents:delete` handler 调用 `rmSync(entry.dirPath, { recursive: true, force: true })` 删除目录 + `agentLoader.reload()` 刷新索引。`src/preload/index.ts:344` 暴露 `talorAPI.agents.delete(id)`。

**待补改动**：

1. **`src/renderer/components/AgentCard.tsx` 新增更多菜单**：在卡片右上角添加"···"按钮，点击展开下拉菜单（`useState<boolean>` 控制 visibility + 外部点击关闭）。菜单项：
   - "编辑"：`onEdit(agentId)` → 导航到编辑页面。
   - "导出"：`onExport(agentId)` → `talorAPI.agents.export(agentId)`（US-B1 的 IPC handler）。
   - "查看依赖状态"：`onCheckDeps(agentId)` → 打开 `DependencyStatusModal`（US-C4）。
   - "删除"（红色文字）：`onDelete(agentId)`。

2. **删除确认**：`src/renderer/pages/Agents/index.tsx` 新增 `agentToDelete` 状态。点击删除 → `setAgentToDelete(agentId)` → 渲染 `<ConfirmDialog title="删除 Agent" message="确定要删除该 Agent 吗？此操作不可恢复。" danger={true} ... />`（复用 `src/renderer/components/ConfirmDialog.tsx`）→ 确认后调用 `talorAPI.agents.delete(agentId)` → 刷新列表。

3. **编辑页面**：新建 `src/renderer/pages/Agents/AgentEditor.tsx`。展示 manifest 字段的表单：name（只读）、description（textarea）、role.capabilities（可增删的列表）、role.constraints（可增删的列表）、role.outputFormat（input）、role.personality（input）。保存时序列化为 JSON 写入 `agent.json`——需新增 IPC handler `agents:update`（参数 `{ agentId, manifest: Partial<AgentManifest> }`），读取现有 manifest → 合并修改 → `writeFileSync` → `agentLoader.reload()`。`App.tsx` 路由需新增 `'agent-editor'` 页面状态或在 `AgentsPage` 内部管理。

4. **`AgentCard` props 扩展**：`onEdit?: (id: string) => void`、`onExport?: (id: string) => void`、`onDelete?: (id: string) => void`、`onCheckDeps?: (id: string) => void`。

**US-F4**：作为用户，我希望在设置中管理我的账户凭证。

验收标准：
- [ ] 设置页新增"账户管理"tab
- [ ] 展示已配置账户列表（按服务分组），每个账户显示 key 列表
- [ ] 支持添加新账户（服务名 + key-value 字段，可标记 secret）
- [ ] 支持编辑、删除已有账户
- [ ] secret 字段 UI 显示为 `••••••`，点击可切换显示

设计方案：

**已完成，编辑功能和 secret 切换显示待补**。

**已完成部分**：见 US-C2 设计方案（Settings tab、AccountsSettings 组件、IPC handler、AccountStore 全链路已实现）。列表展示按 `account.service` 分组(:61-82)，每个 key 显示 `name = value`（secret 显示 `••••••`）。添加表单支持服务名 + 动态 key-value 字段列表 + secret checkbox(:90-147)。删除调用 `talorAPI.accounts.delete(service)`(:44-47)。

**待补改动**：

1. **编辑已有账户**：当前只有"删除"按钮，无"编辑"。`src/renderer/pages/Settings/Accounts.tsx` 需在每个账户卡片的"删除"按钮旁新增"编辑"按钮。点击后：将该账户的 `service` 和 `keys` 填入表单（`setFormService(account.service); setFormKeys(account.keys); setShowForm(true)`），但 secret 字段值为 `'••••••'`（从 `list()` 返回的已脱敏值），需提示用户重新输入 secret 值（或保留占位表示"不修改"）。提交时 `accounts:save` 会覆盖同 service 的记录。

2. **secret 切换显示**：当前表单中 secret 字段用 `type="password"` 渲染(:109)，但已保存的账户列表中 secret 值始终显示为 `'••••••'`(:77)，无切换按钮。需在列表渲染中为 secret 字段添加"显示/隐藏"toggle——但由于 `AccountStore.list()` 返回的是脱敏值，切换显示需要额外 IPC 调用 `accounts:get-value(keyName)` 获取真实值。建议：在 key 显示区域添加眼睛图标按钮，点击调用 `talorAPI.accounts.getValue(key.name)` 获取实际值并临时显示 3 秒后自动隐藏。

---

## 11. 实施顺序

### Block 依赖关系

```
Block A（基础框架）→ Block B（存储/导入导出）→ Block C（依赖/账户）
                                                        ↓
Block F（UI）←————————————————— Block D（运行时）←———————┘
                                        ↓
                                 Block E（沉淀流程）
```

- **A → B → C**：先建模型、存储，再建依赖管理——后续 Block 都依赖这些
- **C → D**：运行时需要依赖检查和变量注入就绪
- **D → E**：沉淀需要运行时（AgentPromptPlugin、tool 过滤）先可用
- **F** 与 D 并行，UI 骨架可以在 Block B 完成后就开始

### Phase 划分（对应 Section 19 IMPL 分拆）

| Phase | Block | IMPL 范围 | 交付物 | 预估 IMPL 数 |
|-------|-------|----------|--------|-------------|
| Phase 1 | A + B | IMPL-001 ~ IMPL-008 | 热重载、版本检查、CLI 检查、enable handler、导入导出、删除 banner | 8 |
| Phase 2 | C | IMPL-009 ~ IMPL-013 | skill 自动安装、keychain 集成、环境变量注入、依赖状态 UI | 5 |
| Phase 3 | D | IMPL-014 ~ IMPL-017 | slash invoke、session 列表辨识、agent info banner | 4 |
| Phase 4 | E | IMPL-018 ~ IMPL-021 | crystallizer、沉淀 IPC、沉淀按钮、取消沉淀 | 4 |
| Phase 5 | F | IMPL-022 ~ IMPL-029 | 四态卡片、更多菜单、lastUsedAt、导入 UI、编辑页面、账户编辑 | 8 |

每个 Phase 完成后执行 AC 双层验证 + 回归测试，通过后签发 Phase 完成证书。

---

## 12. 前置工作

| 项目 | 状态 | 说明 |
|------|------|------|
| AgentPromptPlugin 激活 | ✅ 已完成 | `src/main/prompt/plugins/AgentPromptPlugin.ts` 已从 stub 变为完整实现 |
| Session 表 agent_id 列 | ✅ 已完成 | `src/main/db/index.ts:97-101` 迁移脚本 + `session-repo.ts` CRUD 支持 |
| builtin-tools-hardening | ⏳ 未完成 | symlink 逃逸、ReDoS 防护等安全加固（已有独立 plan，不阻塞 Agent 功能开发） |
| `registerChatHandlers` 注入 agentLoader | ⏳ 未完成 | 见 Gotcha G5——当前 `ipc/chat.ts` 未将 `agentLoader` 传入 `sendChat` 的 ports，需在 Phase 1 开始前修复 |

---

## 13. 术语表（代码命名权威来源）

业务概念与代码标识符的唯一映射。**代码中禁止使用同义词**（如用 `agentDef` 代替 `manifest`、用 `recipe` 代替 `workflow`）。

| 业务概念 | 代码标识符 | 类型/位置 | 说明 |
|---------|-----------|----------|------|
| Agent 定义包 | `AgentManifest` | `src/shared/types/agent.ts` | agent.json 的完整 TS 映射 |
| Agent 运行时条目 | `AgentEntry` | `src/shared/types/agent.ts` | manifest + dirPath + status + lastUsedAt |
| Agent 状态 | `AgentStatus` | `'disabled' \| 'ready' \| 'dependency_missing' \| 'running'` | 四态枚举 |
| Agent 加载器 | `AgentLoader` | `src/main/agent/loader.ts` | 内存索引，单例 |
| Agent 校验 | `validateManifest` | `src/main/agent/validator.ts` | 返回 `ValidateManifestResult` |
| 依赖检查 | `checkDependencies` | `src/main/agent/dependency-checker.ts` | 返回 `DependencyCheckResult` |
| 变量解析 | `resolveVariables` | `src/main/agent/variable-resolver.ts` | 返回 `ResolveResult` |
| 账户存储 | `AccountStore` | `src/main/agent/accounts.ts` | 凭证 CRUD + 内存 secret |
| 工具装配 | `buildTools` | `src/main/tools/build-tools.ts` | agent 模式按白名单过滤 |
| 始终可用工具 | `ALWAYS_AVAILABLE_TOOLS` | `build-tools.ts:59` | `Set(['read', 'ls', 'glob', 'grep'])` |
| Prompt 管线 | `PromptPipeline` | `src/main/prompt/PromptPipeline.ts` | 插件链：System → Agent → Memory → ToolSelection |
| Agent Prompt 插件 | `AgentPromptPlugin` | `src/main/prompt/plugins/AgentPromptPlugin.ts` | 从 role 拼装 prompt + 知识目录 + few-shot |
| 管线上下文 | `PipelineContext` | `src/main/prompt/types.ts` | 含 `agent?: AgentManifest` |
| Chat 编排 | `sendChat` | `src/main/chat/orchestrator.ts` | 业务入口函数 |
| 编排端口 | `ChatPorts` | `orchestrator.ts` | `{ confirmTool, agentLoader? }` |
| ReAct 循环 | `runReactLoop` | `src/main/loop/react-loop.ts` | 含 `agent?: AgentManifest` |
| 循环配置 | `ReactLoopOptions` | `src/main/loop/types.ts` | 全部可序列化参数 |
| Session 仓库 | `sessionRepo` | `src/main/repos/session-repo.ts` | CRUD 单例 |
| 消息仓库 | `messageRepo` | `src/main/repos/session-repo.ts` | 消息 CRUD 单例 |
| IPC channel 前缀 | `agents:*` / `accounts:*` | `src/main/ipc/agents.ts` / `accounts.ts` | snake_case 参数 |
| Renderer API | `talorAPI.agents.*` / `talorAPI.accounts.*` | `src/preload/index.ts` | IPC bridge |
| Agent 状态 store | `useAgentStore` | `src/renderer/store/agentStore.ts` | Zustand store |
| Agent 卡片组件 | `AgentCard` / `NewAgentCard` | `src/renderer/components/AgentCard.tsx` | — |
| Agent 列表页 | `AgentsPage` | `src/renderer/pages/Agents/index.tsx` | — |
| 账户管理 UI | `AccountsSettings` | `src/renderer/pages/Settings/Accounts.tsx` | — |
| 沉淀引导 | `Crystallizer` | `src/main/agent/crystallizer.ts`（待建） | 内置 platform agent |
| Slash 召唤解析 | `parseSlashInvoke` | `src/main/agent/slash-invoke-parser.ts`（待建） | — |
| Skill 安装器 | `installSkills` | `src/main/agent/skill-installer.ts`（待建） | — |
| 导出器 | `exportAgent` | `src/main/agent/exporter.ts`（待建） | — |
| 导入器 | `importAgent` | `src/main/agent/importer.ts`（待建） | — |

---

## 14. 代码模式（已有 Pattern，必须复用）

### P1：IPC Handler 注册模式

```typescript
// src/main/ipc/{domain}.ts
export function register{Domain}Handlers(dep1: Type1, dep2: Type2): void {
  ipcMain.handle('{domain}:{action}', async (_, arg1: T1) => {
    // 业务逻辑，直接调用注入的依赖
    return result  // snake_case 键
  })
}

// src/main/index.ts — 模块顶层实例化依赖，传入 handler
register{Domain}Handlers(dep1Instance, dep2Instance)
```

遵循文件：`ipc/agents.ts`、`ipc/accounts.ts`、`ipc/chat.ts`、`ipc/session.ts`。

### P2：Port 注入模式（业务层不感知 IPC）

```typescript
// 业务层声明端口（仅类型 import）
export interface ChatPorts {
  confirmTool: ToolConfirmPort
  agentLoader?: AgentLoader
}

// IPC 入口层注入实现
registerChatHandlers() 内部调用 sendChat(params, callbacks, { confirmTool: ..., agentLoader })
```

遵循文件：`chat/orchestrator.ts:63-66`、`ipc/chat.ts`。

### P3：Preload Bridge 模式

```typescript
// src/preload/index.ts — talorAPI.{domain}
{domain}: {
  list: (): Promise<T[]> => ipcRenderer.invoke('{domain}:list'),
  create: (params: P): Promise<T> => ipcRenderer.invoke('{domain}:create', params),
  // ...
}
```

channel 名与 `ipcMain.handle` 注册名一一对应。参数/返回值 snake_case。

### P4：Zustand Store 模式

```typescript
// src/renderer/store/{domain}Store.ts
interface {Domain}State {
  items: T[]
  loading: boolean
  setItems: (items: T[]) => void
  setLoading: (loading: boolean) => void
}
export const use{Domain}Store = create<{Domain}State>((set) => ({
  items: [],
  loading: false,
  setItems: (items) => set({ items }),
  setLoading: (loading) => set({ loading }),
}))
```

遵循文件：`store/agentStore.ts`、`store/chatStore.ts`。

### P5：PromptPlugin 模式

```typescript
class {Name}Plugin implements PromptPlugin {
  name = '{Name}Plugin'
  async build(ctx: PipelineContext): Promise<PluginResult> {
    if (!ctx.{guard}) return { messages: [], tools: [], tokenEstimate: 0 }
    // 构建 messages + tools + tokenEstimate
    return { messages, tools, tokenEstimate }
  }
}
```

遵循文件：`AgentPromptPlugin.ts`、`SystemPlugin.ts`、`MemoryPlugin.ts`。

### P6：Vitest 单元测试模式

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock() 放在文件顶部，import 放在 mock 之后
vi.mock('../db/index', () => ({ getDb: () => mockDb }))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { targetFunction } from './target'

// 辅助构造函数 minimalXxx() 用于构建测试 fixture
function minimalAgent(toolNames: string[]): AgentManifest { ... }

describe('{module}', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('{行为描述}', async () => { ... })
})
```

遵循文件：`build-tools.test.ts`、`AgentPromptPlugin.test.ts`、`session-repo.test.ts`。

### P7：DB 迁移模式

```typescript
// src/main/db/index.ts — initChatDb() 内部
const cols = db.prepare("PRAGMA table_info({table})").all() as Array<{ name: string }>
if (!cols.some(c => c.name === '{new_column}')) {
  db.exec(`ALTER TABLE {table} ADD COLUMN {new_column} {TYPE};`)
  log.info('[ChatDB] Migrated: added {new_column} column')
}
```

遵循文件：`db/index.ts:90-101`（workspace + agent_id 迁移）。

---

## 15. 编码红线（禁止的反模式）

| 编号 | 红线 | 具体禁止行为 |
|------|------|------------|
| R1 | 业务层禁止 import IPC 运行时代码 | `orchestrator.ts`、`build-tools.ts` 等业务文件禁止 `import { ipcMain }` 或 `import { BrowserWindow }`。仅允许类型 import（`import type`） |
| R2 | 禁止在 renderer 直接操作文件系统 | 所有文件 I/O 必须通过 IPC → main process 完成，renderer 只通过 `talorAPI` 调用 |
| R3 | 禁止 `as any` / `@ts-ignore` | 所有类型必须显式定义，不绕过类型系统。唯一例外：第三方库类型缺失时允许 `as unknown as T` 并注释原因 |
| R4 | 禁止静默吞异常 | 每个 `catch` 必须 `log.error()` 或 `log.warn()`，禁止空 `catch {}` |
| R5 | 禁止跨层直接调用 | renderer 不直接调用 main 模块；ipc handler 不直接操作 DB（通过 repo）；业务层不直接调用 `webContents.send()`（通过 callbacks） |
| R6 | snake_case / camelCase 边界 | IPC channel 参数和返回值用 snake_case；业务层内部用 camelCase。转换只在 IPC 入口层做 |
| R7 | 禁止在 agent session 中注入未声明的工具 | `buildTools()` 的 `agentAllowedTools` 白名单是安全边界，禁止绕过 |
| R8 | 禁止 agent prompt 替换 system prompt | `AgentPromptPlugin` 的 messages 是追加（append）到 system prompt 之后，不是替换 |

---

## 16. Gotchas（已知陷阱）

| 编号 | 陷阱 | 影响 | 规避方式 |
|------|------|------|---------|
| G1 | `AccountStore` secret 仅存内存 | 进程重启后丢失，文件中只有 `'__encrypted__'` 占位 | 需集成 `SafeStorageService`（US-C2 待补） |
| G2 | `checkCli()` 未实际执行 checkCommand | 当前仅将 required CLI 标记为 missing，未检测系统是否已安装 | US-B2 待补：需 `execSync(checkCommand)` |
| G3 | `checkMinAppVersion()` 硬编码返回 pass | 导入任何 agent 都不检查版本兼容性 | US-B2 待补：需 `semver.gte()` 比较 |
| G4 | MCP 等待竞态 | `buildTools()` 在工具数 ≤ 7 时等 2s，但 agent 模式可能不需要 MCP 工具 | agent 模式下若 `agentAllowedTools` 不含 MCP 工具，可跳过等待（优化项） |
| G5 | `agents:create-session` 未注入 agentLoader | `ipc/chat.ts` 的 `sendChat` 调用需要 `ports.agentLoader`，但当前 `registerChatHandlers()` 未接收 `agentLoader` 参数 | 需改为 `registerChatHandlers(agentLoader)` 并注入到 ports |
| G6 | Session 删除级联 vs Agent 删除不级联 | `DELETE FROM sessions` 级联删除 messages（外键）；但删除 agent 目录不影响 sessions 表（无外键） | US-B3 已设计为预期行为 |
| G7 | Crystallizer 中途取消文件残留 | 若 Crystallizer Agent 在取消前已部分写入文件 | US-E2 设计为确认前不写文件，全部在内存构建 |

---

## 17. 验证环境与测试策略

### 测试框架

| 项目 | 值 |
|------|-----|
| 测试框架 | Vitest 3.1.1 |
| 运行命令 | `npm test`（等同 `vitest run`） |
| Watch 模式 | `npm run test:watch` |
| 单文件运行 | `npx vitest run src/main/agent/loader.test.ts` |
| Mock 库 | `vi.mock()` / `vi.fn()` / `vi.spyOn()`（Vitest 内置） |
| 断言库 | `expect`（Vitest 内置，兼容 Jest 语法） |
| 测试文件约定 | 与源文件同目录，后缀 `.test.ts` |

### 现有测试覆盖（Agent 相关，共 6 个文件）

| 文件 | 状态 | 覆盖内容 |
|------|------|---------|
| `agent/validator.test.ts` | ✅ 已存在 | manifest 校验正/负例 |
| `agent/loader.test.ts` | ✅ 已存在 | loadAll / getById / getByName |
| `agent/accounts.test.ts` | ✅ 已存在 | CRUD + secret 脱敏 |
| `agent/dependency-checker.test.ts` | ✅ 已存在 | 6 步检查链 |
| `agent/variable-resolver.test.ts` | ✅ 已存在 | 模板替换 + missing 收集 |
| `tools/build-tools.test.ts` | ✅ 已存在 | agent 工具沙箱过滤 |
| `prompt/plugins/AgentPromptPlugin.test.ts` | ✅ 已存在 | prompt 拼装 + knowledge + few-shot |
| `ipc/agents.test.ts` | ✅ 已存在 | IPC handler 集成 |
| `store/agentStore.test.ts` | ✅ 已存在 | Zustand store |

### 新增测试要求（按 Block）

| Block | 需新建的测试文件 | 覆盖内容 |
|-------|----------------|---------|
| B | `agent/exporter.test.ts` | 打包 zip 内容校验、排除 node_modules |
| B | `agent/importer.test.ts` | 解压 + 校验 + 同名覆盖检测 |
| C | `agent/skill-installer.test.ts` | npm install mock + 失败降级 |
| D | `agent/slash-invoke-parser.test.ts` | 正则匹配 + 未匹配返回 null |
| E | `agent/crystallizer.test.ts` | systemPrompt 构建 + 工具提取辅助 |

### Layer 1 验证（技术验证）

每个 AC 的验证方式为 `npx vitest run {test-file}` 并粘贴原始 PASS/FAIL 输出。

### Layer 2 验证（用户视角业务验证）

需手动启动 Electron 应用（`npm run dev`）执行 UI 操作验证的 AC：
- US-F1/F2/F3/F4：Agent 卡片页面交互
- US-D2：session 列表 agent 标识
- US-E1/E2：沉淀流程对话式引导
- US-C4：依赖安装进度 UI

---

## 18. AC 验证契约（Given/When/Then）

将 Section 10 的 checkbox AC 转换为可驱动 TDD 的结构化验证契约。

### Block A

**AC-A1-01**：manifest 校验通过
```
Given: 一个包含所有必填字段（id, name, description, version="1.0.0", role.capabilities=["x"], role.outputFormat="text", knowledge.files=[], dependencies.tools/skills/cli=[]）的 JSON 对象
When:  调用 validateManifest(json)
Then:  返回 { valid: true, manifest } 且 manifest.id === json.id
```

**AC-A1-02**：缺少必填字段拒绝
```
Given: 一个缺少 "name" 字段的 JSON 对象
When:  调用 validateManifest(json)
Then:  返回 { valid: false, errors } 且 errors 包含 '"name" must be a non-empty string'
```

**AC-A1-03**：非法 version 拒绝
```
Given: 一个 version="abc" 的 JSON 对象
When:  调用 validateManifest(json)
Then:  返回 { valid: false, errors } 且 errors 包含 '"version" must be a valid semver'
```

**AC-A2-01**：启动加载合法 agent
```
Given: ~/.talor/agents/sales/ 目录下存在合法 agent.json
When:  调用 agentLoader.loadAll()
Then:  agentLoader.getById("sales-001") 返回 AgentEntry 且 status === 'ready'
```

**AC-A2-02**：非法 manifest 跳过
```
Given: ~/.talor/agents/broken/ 目录下存在 agent.json 但缺少 name 字段
When:  调用 agentLoader.loadAll()
Then:  agentLoader.getAll() 不包含 broken agent，log.warn 被调用
```

**AC-A2-03**：目录缺失自动创建
```
Given: ~/.talor/agents/ 目录不存在
When:  new AgentLoader('~/.talor/agents/')
Then:  目录被创建（existsSync 返回 true）
```

**AC-A3-01**：agent 声明 bash → 仅 bash + 基础工具可用
```
Given: agent.dependencies.tools = [{ name: 'bash', required: true }]
When:  调用 buildTools({ ..., agent })
Then:  返回的 tools 键集合 === { 'read', 'ls', 'glob', 'grep', 'bash' }
```

**AC-A3-02**：agent 声明空工具 → 仅基础工具可用
```
Given: agent.dependencies.tools = []
When:  调用 buildTools({ ..., agent })
Then:  返回的 tools 键集合 === { 'read', 'ls', 'glob', 'grep' }，不含 bash/write/edit
```

**AC-A3-03**：agent 未声明 → 不过滤外部工具
```
Given: agent 参数为 undefined
When:  调用 buildTools({ ..., agent: undefined })
Then:  返回的 tools 包含所有 registry 中的工具（含 MCP 外部工具）
```

### Block B

**AC-B1-01**：导出 zip 包含完整目录
```
Given: ~/.talor/agents/sales/ 下有 agent.json + knowledge/manual.md + avatar.png
When:  调用 exportAgent(dirPath, manifest)
Then:  返回的 zip Buffer 解压后包含 agent.json, knowledge/manual.md, avatar.png，不含 node_modules/
```

**AC-B1-02**：导入解压到正确位置
```
Given: 一个合法的 .agent.zip 文件
When:  调用 importAgent(zipBuffer, agentsDir)
Then:  agentsDir/{name}/ 目录存在，agent.json 可通过 validateManifest 校验
```

**AC-B1-03**：导入同名检测
```
Given: agentsDir 下已存在同名 agent 目录
When:  调用 importAgent(zipBuffer, agentsDir)
Then:  返回 { overwritten: true }
```

**AC-B2-01**：minAppVersion 不满足时报错
```
Given: manifest.minAppVersion = "99.0.0"，当前 Talor 版本 = "0.2.0"
When:  调用 checkDependencies(manifest, dirPath)
Then:  返回 steps 中 minAppVersion 步骤 status === 'fail'，message 包含版本号
```

**AC-B3-01**：删除 agent 后 session 仍可查询
```
Given: sessions 表中存在 agent_id = "sales-001" 的记录
When:  调用 agents:delete("sales-001")，然后 sessionRepo.getById(sessionId)
Then:  session 仍返回，agent_id 字段值仍为 "sales-001"
```

**AC-B3-02**：已删除 agent 的 session 回退为普通模式
```
Given: session.agent_id = "sales-001"，但 agentLoader.getById("sales-001") 返回 undefined
When:  调用 sendChat(params, callbacks, ports)
Then:  agent 变量为 undefined，不注入 agent prompt，不过滤工具
```

### Block C

**AC-C1-01**：skill 自动安装成功
```
Given: manifest.dependencies.skills = [{ name: "lark-im", required: true, source: { type: "npm", package: "@anthropic/lark-im" } }]
When:  调用 installSkills(manifest, dirPath, onProgress)
Then:  onProgress 被调用两次（installing → installed），dirPath/node_modules/@anthropic/lark-im 存在
```

**AC-C2-01**：secret 脱敏返回
```
Given: AccountStore 中存储了 { service: "飞书", keys: [{ name: "appid", value: "xxx", secret: true }] }
When:  调用 accountStore.list()
Then:  返回的 key.value === "••••••"
```

**AC-C2-02**：secret 实际值可查
```
Given: 同上
When:  调用 accountStore.getValue("appid")
Then:  返回 "xxx"（实际值）
```

**AC-C3-01**：变量替换成功
```
Given: config = { "APP_ID": "{{feishu_appid}}" }，accountValues = Map { "feishu_appid" → "cli_xxx" }
When:  调用 resolveVariables(config, accountValues)
Then:  返回 { resolved: { "APP_ID": "cli_xxx" }, missing: [] }
```

**AC-C3-02**：变量缺失报错
```
Given: config = { "APP_ID": "{{feishu_appid}}" }，accountValues = Map {}
When:  调用 resolveVariables(config, accountValues)
Then:  返回 { resolved: {}, missing: ["feishu_appid"] }
```

### Block D

**AC-D1-01**：agent session 创建绑定 agent_id
```
Given: agentLoader 中有 id="sales-001" 的 agent，依赖检查通过
When:  调用 agents:create-session("sales-001")
Then:  返回的 session.agent_id === "sales-001"，session.title === agent.name
```

**AC-D1-02**：agent session 注入 agent prompt
```
Given: PipelineContext.agent = salesManifest（含 capabilities + knowledge + sampleConversations）
When:  AgentPromptPlugin.build(ctx)
Then:  返回的 messages[0].role === 'system' 且 content 包含 capabilities 和知识目录
```

**AC-D3-01**：slash invoke 匹配成功
```
Given: 消息文本 = "/销售分析师 帮我看下本周数据"，agentLoader 中有 name="销售分析师" 的 agent
When:  调用 parseSlashInvoke(text, agentLoader)
Then:  返回 { entry, remainingText: "帮我看下本周数据" }
```

**AC-D3-02**：slash invoke 未匹配
```
Given: 消息文本 = "/不存在的agent 你好"
When:  调用 parseSlashInvoke(text, agentLoader)
Then:  返回 null
```

**AC-D3-03**：slash invoke 不修改 session
```
Given: 一个非 agent session（agent_id = null），消息文本 = "/销售分析师 查数据"
When:  sendChat 处理完成后
Then:  sessionRepo.getById(sessionId).agent_id 仍为 null
```

### Block E

**AC-E1-01**：crystallize 创建临时 session
```
Given: 一个已有 5 条消息的 sourceSession
When:  调用 agents:crystallize({ sourceSessionId })
Then:  返回 { sessionId: tempId }，sessionRepo.getById(tempId).agent_id === '__crystallizer__'
```

**AC-E2-01**：取消沉淀删除临时 session
```
Given: 一个 agent_id === '__crystallizer__' 的临时 session
When:  调用 session:delete(tempSessionId)
Then:  sessionRepo.getById(tempSessionId) === null，原 sourceSession 不受影响
```

**AC-E3-01**：工具提取准确
```
Given: 原 session 消息中包含 tool_use blocks，toolName 分别为 "bash", "read", "lark-sheets-read"
When:  预处理提取工具列表
Then:  提取结果为 ["bash", "lark-sheets-read"]（read 在 ALWAYS_AVAILABLE_TOOLS 中，不加入 dependencies）
```

---

## 19. IMPL 原子任务分拆

每个 IMPL 定义：输入、输出、被谁调用、关联 AC、预估复杂度。

### Phase 1：Block A + B 基础层

| IMPL | 描述 | 输入 | 输出 | 调用方 | 关联 AC | 复杂度 |
|------|------|------|------|--------|---------|--------|
| IMPL-001 | `fs.watch` 热重载 — `AgentLoader` 监听目录变化 | `agentsDir` | 目录变化时自动 `reload()` | 构造函数 | AC-A2-04（待补） | S |
| IMPL-002 | `checkMinAppVersion` 实际版本比较 | `manifest.minAppVersion`, `app.getVersion()` | `DependencyStepResult` | `checkDependencies` | AC-B2-01 | S |
| IMPL-003 | `checkCli` 实际执行 checkCommand | `cli[].checkCommand` | `DependencyStepResult` | `checkDependencies` | AC-B2-02（待补） | S |
| IMPL-004 | `AgentLoader.setStatus()` + `agents:enable` handler | `agentId` | 内存 status 更新 | `ipc/agents.ts` | AC-B2-03（待补） | S |
| IMPL-005 | `exportAgent` 打包 zip | `dirPath`, `manifest` | `Buffer`（zip） | `agents:export` handler | AC-B1-01 | M |
| IMPL-006 | `importAgent` 解压 + 校验 + 同名检测 | `zipBuffer`, `agentsDir` | `{ manifest, dirPath, overwritten }` | `agents:import` handler | AC-B1-02, AC-B1-03 | M |
| IMPL-007 | `agents:export` / `agents:import` IPC handler | `agentId` / 文件路径 | session / AgentEntry | renderer | AC-B1-01…03 | M |
| IMPL-008 | 删除 agent 后 renderer 提示 banner | `session.agent_id`, `agents:get` | UI banner | `Chat/index.tsx` | AC-B3-01, AC-B3-02 | S |

### Phase 2：Block C 依赖管理 + 账户

| IMPL | 描述 | 输入 | 输出 | 调用方 | 关联 AC | 复杂度 |
|------|------|------|------|--------|---------|--------|
| IMPL-009 | `installSkills` 自动安装 + 进度回调 | `manifest`, `dirPath`, `onProgress` | `SkillInstallResult` | `agents:install-deps` | AC-C1-01 | L |
| IMPL-010 | `AccountStore` 集成 `SafeStorageService` | `safeStorage.encryptString/decryptString` | 持久化 secret | `accounts.ts` | AC-C2-01, AC-C2-02 | M |
| IMPL-011 | resolved config 注入为 skill 环境变量 | `resolveResult.resolved` | `process.env` 或 context | `agents:create-session` | AC-C3-01, AC-C3-02 | S |
| IMPL-012 | `DependencyStatusModal` UI 组件 | `agentId` | 模态框 | `AgentsPage` | AC-C4-01…05（待补） | L |
| IMPL-013 | `agents:install-deps` IPC handler + progress 事件 | `agentId` | `SkillInstallResult` + 实时事件 | renderer | AC-C1-01 | M |

### Phase 3：Block D 运行时

| IMPL | 描述 | 输入 | 输出 | 调用方 | 关联 AC | 复杂度 |
|------|------|------|------|--------|---------|--------|
| IMPL-014 | `parseSlashInvoke` 解析器 | `text`, `agentLoader` | `{ entry, remainingText } \| null` | `orchestrator.ts` | AC-D3-01, AC-D3-02 | S |
| IMPL-015 | `orchestrator.ts` 集成 slash invoke | `userContent` | agent 注入本次循环 | `sendChat` | AC-D3-03 | M |
| IMPL-016 | Session 列表 agent 辨识 — `SessionItem` 改造 | `session.agent_id` | agent 头像 + 前缀标题 | Chat 页面 | AC-D2-01…04（待补） | M |
| IMPL-017 | Chat 页面 agent info banner | `currentAgent` | 顶部名称+描述条 | Chat 页面 | AC-D2-03（待补） | S |

### Phase 4：Block E 沉淀流程

| IMPL | 描述 | 输入 | 输出 | 调用方 | 关联 AC | 复杂度 |
|------|------|------|------|--------|---------|--------|
| IMPL-018 | Crystallizer systemPrompt + 工具提取辅助 | 原 session 消息历史 | systemPrompt, toolNames[] | `agents:crystallize` | AC-E1-01, AC-E3-01 | L |
| IMPL-019 | `agents:crystallize` IPC handler | `sourceSessionId` | `{ sessionId }` | renderer | AC-E1-01 | M |
| IMPL-020 | Chat 页面"沉淀为 Agent"按钮 + 导航 | `currentSessionId` | 跳转到临时 session | UI | AC-E1-01 | S |
| IMPL-021 | 取消沉淀流程 | 临时 sessionId | 删除临时 session | UI | AC-E2-01 | S |

### Phase 5：Block F UI 完善

| IMPL | 描述 | 输入 | 输出 | 调用方 | 关联 AC | 复杂度 |
|------|------|------|------|--------|---------|--------|
| IMPL-022 | AgentCard 四态渲染 | `agent.status` | 差异化卡片样式 + 按钮 | `AgentsPage` | AC-F2-01…08（待补） | M |
| IMPL-023 | AgentCard 更多菜单（···） | click | 下拉菜单 | `AgentCard` | AC-F3-01…04（待补） | M |
| IMPL-024 | `lastUsedAt` 持久化 + 显示 | `agents:create-session` | `.meta.json` | `AgentLoader` + `AgentCard` | AC-F1-03（待补） | S |
| IMPL-025 | 导入按钮 + 导入流程 UI | click | 文件选择 → 导入 → 刷新 | `AgentsPage` | AC-F1-05（待补） | M |
| IMPL-026 | Agent 编辑页面 | `agentId` | 表单 → `agents:update` | `AgentsPage` | AC-F3-04（待补） | L |
| IMPL-027 | `AccountsSettings` 编辑 + secret 切换显示 | account | 表单预填 + 眼睛 toggle | Settings 页面 | AC-F4-01…05（待补） | M |
| IMPL-028 | "+新建"卡片点击 → 创建空 crystallize session | click | 新 session + crystallize | `AgentsPage` | AC-F1-04（待补） | S |
| IMPL-029 | Session 列表筛选"仅 Agent 对话" | toggle | `sessions.filter(s => s.agent_id)` | Chat 页面 | AC-D2-04（待补） | S |

---

## 20. MVP 不包含（后续迭代）

- 定时/事件触发（WorkflowTrigger.schedule / event）
- 工作台任务派发视图
- Agent 能力市场 / 公共注册表
- 向量化知识检索（knowledge.embeddings）
- Agent 间协作 / 编排
- 版本回滚
- autonomous 层级的 workflow engine（MVP 只实现 chat 和 chat-tools 层级）
