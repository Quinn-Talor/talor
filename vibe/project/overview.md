# Talor — 项目架构总览

> 纯 Agent 平台 · Electron + TypeScript 桌面应用 (v0.1.0)

## 定位

Talor 是**纯 agent 运行平台**,自身不含业务 agent。所有业务通过对话沉淀(Crystallizer)由用户产出。

**Agent profile · 极简 8 字段**:`id` / `name` / `description` / `agentPrompt`(磁盘上拆为 sibling `prompt.md`)+ `tools?` / `skills?` / `mcpServers?` / `subagents?`

数据真相归属 Talor 自己:`~/.talor/agents/<id>/` + `~/.talor/skills/<name>/` + SQLite(`chat.db`)。

## 技术栈

| 层     | 技术                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| 前端   | React 19 + Tailwind CSS + Zustand                                                          |
| 模型   | Vercel AI SDK v7(Anthropic / OpenAI / Google / Ollama 经 @ai-sdk/openai-compatible)        |
| 工具   | 7 个内置工具 + MCP 外部工具 + Skill 技能体系                                               |
| 持久化 | better-sqlite3(sessions / messages / mcp_servers / account_keys) + 文件(agents/ + skills/) |
| 桌面   | Electron (sandbox:true + contextIsolation:true)                                            |

---

## 架构分层

```
┌──────────────────────────────────────────────────────────────────────┐
│  Renderer Process (React 19 + Tailwind + Zustand)                    │
│                                                                      │
│  pages/Chat ─→ ToolCallLog (StreamItem 渲染)                          │
│  store/chatStore ─→ streamItems: StreamItem[] (text + tool_call)      │
│  hooks/useStreamingMessage ─→ 消费 IPC 事件                            │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ IPC (contextBridge + ipcRenderer)
┌───────────────────────────┴──────────────────────────────────────────┐
│  Preload (src/preload/index.ts)                                       │
│  暴露 talorAPI 到 window，沙箱模式只开放白名单方法                        │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ IPC (ipcMain)
┌───────────────────────────┴──────────────────────────────────────────┐
│  Main Process (Node.js)                                               │
│                                                                      │
│  ┌─ 入口层 (ipc/) ───────────────────────────────────────────────┐    │
│  │  chat.ts · session.ts · providers.ts · mcp.ts · permission.ts │    │
│  │  职责：IPC handler 注册 + snake/camel 转换 + 回调桥接            │    │
│  └──────────────────────────┬────────────────────────────────────┘    │
│                             │                                        │
│  ┌─ 业务层 ─────────────────┴────────────────────────────────────┐    │
│  │                                                               │    │
│  │  chat/orchestrator ─→ 编排 8 步流程                             │    │
│  │       ↓                                                       │    │
│  │  prompt/PromptPipeline ─→ 7 插件 append-only 装配 prompt          │    │
│  │       ↓                                                       │    │
│  │  loop/react-loop ─→ ReAct 多步推理引擎                           │    │
│  │       ↓                                                       │    │
│  │  tools/build-tools ─→ 工具装配 (dynamicTool 包装)                │    │
│  │       ↓                                                       │    │
│  │  agent/tool-registry ─→ 工具执行 (builtin + MCP + skill)        │    │
│  │                                                               │    │
│  │  memory/ShortTermMemory ─→ 上下文压缩 + 锚点保留                  │    │
│  │  providers/model-adapter ─→ 4 个 Provider 适配器                 │    │
│  │  permissions/port ─→ 权限规则匹配 + UI 授权                      │    │
│  │  skills/registry ─→ Skill 注册 + 激活追踪                        │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─ 基础设施层 ──────────────────────────────────────────────────┐    │
│  │  repos/session-repo ─→ Session/Message CRUD                   │    │
│  │  db/index ─→ SQLite 初始化 + schema 迁移                       │    │
│  │  store/config-store ─→ electron-store 配置                     │    │
│  │  services/safe-storage ─→ OS keychain API key 加密              │    │
│  └───────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

**分层依赖方向**：`ipc → 业务层 → 基础设施`，反向不允许。

---

## 核心调用链路：从用户输入到最终输出

```
用户发送消息
  │
  ├─[1] IPC: chat:send handler (ipc/chat.ts)
  │     snake_case → camelCase 转换
  │
  ├─[2] 编排: orchestrator.sendChat()
  │     ├── 校验内容 + 附件
  │     ├── 注册 stream（AbortController）
  │     ├── 解析 Provider + Model（通过 session.provider_id 查找）
  │     ├── 获取 Agent（通过 session.agent_id 查找）
  │     ├── 持久化 user 消息（SDK UserContent 格式直接存 DB）
  │     └── 启动 ReAct 循环
  │
  ├─[3] ReAct Loop: runReactLoop() ── 最多 1000 步
  │     │
  │     ├─ 每步 runReactStep():
  │     │   │
  │     │   ├── [3.1] Prompt 构建: pipeline.build() — append-only 分层装配(按 layer 排序)
  │     │   │     稳定前缀(可缓存):
  │     │   │     ├── SystemPlugin   [system] ─→ 行为宪法（15 条原则）+ 决策路由表
  │     │   │     ├── AgentPromptPlugin [agent] ─→ Agent 角色 + Skill 列表
  │     │   │     ├── UiBlockPlugin  [agent] ─→ talor block 协议词典
  │     │   │     ├── ToolSelectionPlugin [tools] ─→ 工具筛选(只产 tools,不产 message)
  │     │   │     ├── MemoryPlugin   [history] ─→ 历史消息（<90% 全量 / >90% 压缩摘要+锚点）
  │     │   │     易变尾部(不进缓存前缀):
  │     │   │     ├── MessagePlugin  [volatile] ─→ 当前 turn 消息(紧贴 history,保 tool 配对)
  │     │   │     └── RuntimeMetaPlugin [volatile] ─→ date/os/workspace(线程外旁注,排 Message 后)
  │     │   │     (Anthropic provider:稳定前缀末条打 cacheControl 断点)
  │     │   │
  │     │   ├── [3.2] Context 预算检查
  │     │   │     ≥100% → 硬阻断（[auto-halt]）
  │     │   │     >98% → 软告警（[CONTEXT NEARLY FULL]）
  │     │   │
  │     │   ├── [3.3] 工具装配: buildTools()
  │     │   │     每个工具包装为 AI SDK dynamicTool
  │     │   │     HIGH_RISK 工具 → confirmTool() UI 弹窗确认
  │     │   │
  │     │   ├── [3.4] 模型调用: streamText()
  │     │   │     通过 ModelAdapter 创建的 LanguageModel 实例
  │     │   │     流式回调: text-delta / reasoning-delta / tool-call / tool-result
  │     │   │
  │     │   ├── [3.5] 落盘（SDK 原生格式）
  │     │   │     无工具 + 有文本 → assistant(text) [FINAL]
  │     │   │     有工具 → assistant(reasoning + text + tool-call) + tool(tool-result) [batch]
  │     │   │
  │     │   └── [3.6] 死循环检测
  │     │         签名重复（inputHash + outputHash）
  │     │         连续失败（3 步全部 tool error）
  │     │         空文本循环（8 步只有 tool call 无文本）
  │     │
  │     └─ 兜底摘要: runFallbackSummary()
  │           整轮无文本输出时强制一次无工具 streamText
  │           引用验证: verifyQuotedFacts() 标记不可验证内容
  │
  ├─[4] IPC 回调: callbacks.onDone()
  │     webContents.send('chat:stream', { done: true })
  │
  └─[5] 前端渲染
        Zustand store 接收事件 → streamItems 更新
        ToolCallLog 按 step 分组渲染 text + tool
        完成后 commitStreaming() 清空 → 持久化消息渲染
```

---

## Agent 作业流程:检测 · 反思 · 收尾

ReAct 循环每步产出后,要回答两个问题:**这步该不该结束整轮?** **要不要给主 LLM 纠偏?** Talor 用三类机制协作回答 —— 它们是平台「输出可靠、完成出色」的核心。

### 三个阶段

每步在 `runReactStep` 内外按固定阶段跑 reflector / detector / policy(`react-loop.ts`):

| 阶段          | 时机                                  | 跑什么                             | 典型产出                                                  |
| ------------- | ------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| **pre-step**  | streamText 之前                       | ContextBudgetReflector             | 上下文超限 → `userOutput`(halt)                           |
| **post-step** | streamText 落盘之后                   | Detectors + post-step Reflectors   | 死循环/失败链 → `wrapUp`;L1 告警 → `hint`/`internalNudge` |
| **turn-end**  | 仅「无工具调用」步,policy 判 final 后 | Turn-End Reflectors(judge / quote) | 假完成 → `internalNudge`(续做)                            |

### Detector vs Reflector(便宜的代码 → 贵的 LLM)

两级门控,**先用代码廉价判定,够了就不花 LLM**:

- **Detector**(`loop/detectors/*`):纯代码、同步、无 LLM。`observe(facts)` → `{ triggered, exitReason }`,命中即**硬切断**。
  - `signature-dead-loop`:同 tool+input+output 重复 ≥2 次(有错误时 ≥1)→ `repeated_error`
  - `length-truncation-streak`:连续 `finishReason='length'` ≥3 → `continuation_chain`
- **Reflector**(`loop/reflect/*`):上下文感知,**可能调 LLM**。多数带「代码 filter → 达阈值才调 reflect agent」两层:
  - `context-budget`(pre):token 估算超 limit → halt
  - `failure-streak`(post):工具全失败累计(subagent 权重 ×2),阈值 3 → `wrapUp` 强制收尾;阈值-1 给「最后一次机会」hint
  - `tool-only-loop`(post):连续只调工具无文本 → hint「带上推理/结论」
  - `periodic`(post,每 5 步):LLM 反思策略(progress / blocker / nextStep)
  - `escalation`(post):L1 hint 连续 2 步没生效 → 升级到 LLM reflect
  - `judge-completion`(turn-end,maxPerTurn=2):**5 信号风险打分**(动词无工具 / IO 声明无写工具 / 多任务少工具 / 长意图短回答 / 完整性断言)≥3 才调 LLM judge,判未完成则 `internalNudge` 逼续做
  - `quote-correction`(turn-end):核对引用与工具输出,纠编造

### Reflector 的四种产出 + 持久化语义

`ReflectorOutcome`(`reflect/types.ts`):

| 产出              | 落库 role       | UI                  | 主 LLM                            | 对循环   |
| ----------------- | --------------- | ------------------- | --------------------------------- | -------- |
| **hint**          | 不落库          | 不显示              | 下一步注入为 system 消息          | 继续     |
| **internalNudge** | `user`/`system` | **不显示**          | 读 history 当「外部审查反馈」续做 | **继续** |
| **userOutput**    | `assistant`     | 流式显示            | —                                 | **收尾** |
| **wrapUp**        | —               | 触发 forced-summary | —                                 | **收尾** |

> 关键:internalNudge 刻意不走 `onTextDelta` —— 用户看到的应是主 LLM 据此续做后的下一条 assistant 消息,而非这条内部纠偏指令本身。

### 决策优先级 + 收尾判定

post-step 取第一个非空产出,优先级:`wrapUp > detectorBreak > userOutput > internalNudge(续做) > hint(续做)`。

「该不该结束」的总判定(`react-loop.ts` 决策级联):

```
有 break 条件(detector/wrapUp/userOutput/abort) → 退出
有工具调用                                        → 继续(不评 policy)
无工具:
  无文本                                          → exit 'empty_text'
  有文本 → Turn-End Policy 链(sdk-finish / explicit-termination / judge / legacy):
            policy=continue(+hint)                → 继续
            policy=final → Turn-End Reflectors:
                            internalNudge          → 落库 + 续做(并强制下步展开 MCP)
                            否则                   → exit 'no_tool_calls'
```

### Exit reasons

| reason                | 触发                          | 兜底                        |
| --------------------- | ----------------------------- | --------------------------- |
| `no_tool_calls`       | policy 判自然收尾             | 健康停止                    |
| `empty_text`          | 无工具且无文本                | 提示重输                    |
| `repeated_error`      | 死循环 / 失败链阈值           | forced-summary + mark final |
| `context_overflow`    | pre-step token 超 limit       | 友好 halt                   |
| `continuation_chain`  | 截断链 ≥3                     | 硬停                        |
| `fallback_summary`    | 整轮零文本(非 abort/overflow) | forced-summary              |
| `abort` / `max_steps` | 用户停 / 步数上限             | 已有部分输出                |

> 设计取舍:detector 把「明确该停」做成代码硬规则(零 LLM 成本、确定性);reflector 把「需要判断」的留给 LLM,但用代码 filter 卡在前面,避免每步都烧一次反思调用。详见 `standards.md §J-SHOULD-1`(硬规则优先代码强制)。

---

## 组件职责说明

### 入口层

| 组件          | 文件               | 职责                                                         |
| ------------- | ------------------ | ------------------------------------------------------------ |
| Chat IPC      | `ipc/chat.ts`      | 注册 `chat:send`/`chat:abort`，回调桥接到 `webContents.send` |
| Session IPC   | `ipc/session.ts`   | Session CRUD + 模型/Provider 切换                            |
| Providers IPC | `ipc/providers.ts` | Provider CRUD + 模型列表 + 连接测试                          |

### 业务层 — 编排

| 组件              | 文件                        | 职责                                                           |
| ----------------- | --------------------------- | -------------------------------------------------------------- |
| Orchestrator      | `chat/orchestrator.ts`      | 8 步编排：校验→Provider→持久化→ReAct→Done。单一错误出口 onDone |
| Provider Selector | `chat/provider-selector.ts` | 按 ID 查 Provider / 取默认 Provider                            |
| Stream Registry   | `chat/stream-registry.ts`   | 同 session AbortController 管理，新请求 abort 旧的             |
| Event Bus         | `chat/events.ts`            | Per-execution 事件总线（当前仅 `memory.compressed`）           |

### 业务层 — Prompt 构建

每个 plugin 带 `layer`（system<agent<tools<history<volatile）；`buildLayered` 按 layer 稳定排序 → 稳定层连续在前构成**可缓存前缀**(append-only),volatile 在尾。

| 组件                | 文件                                    | layer    | 职责                                                                              |
| ------------------- | --------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| PromptPipeline      | `prompt/PromptPipeline.ts`              | —        | 7 插件按 layer 装配，关键插件失败抛出，非关键降级；Anthropic 打 cacheControl 断点 |
| SystemPlugin        | `prompt/plugins/SystemPlugin.ts`        | system   | 行为宪法（15 条）+ 决策路由表 + (持 delegate 时)委托引导                          |
| AgentPromptPlugin   | `prompt/plugins/AgentPromptPlugin.ts`   | agent    | Agent 角色 + Skill 列表（模板渲染，纯静态）                                       |
| UiBlockPlugin       | `prompt/plugins/UiBlockPlugin.ts`       | agent    | talor block 协议词典（done/need_input/proposal 等）                               |
| ToolSelectionPlugin | `prompt/plugins/ToolSelectionPlugin.ts` | tools    | MCP 工具累积可见（search_tool 触发展开），只产 tools                              |
| MemoryPlugin        | `prompt/plugins/MemoryPlugin.ts`        | history  | 历史消息 allMessages[0..-2]（委托 ShortTermMemory）                               |
| MessagePlugin       | `prompt/plugins/MessagePlugin.ts`       | volatile | 当前 turn allMessages[-1]（紧贴 history，保 tool 配对）                           |
| RuntimeMetaPlugin   | `prompt/plugins/RuntimeMetaPlugin.ts`   | volatile | date/os/workspace（线程外旁注，排在 Message 后）                                  |
| cache-breakpoints   | `prompt/cache-breakpoints.ts`           | —        | Anthropic 前缀缓存断点（static + history 边界，仅 anthropic）                     |

### 业务层 — 推理引擎

| 组件            | 文件                       | 职责                                                                                                                          |
| --------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| ReAct Loop      | `loop/react-loop.ts`       | 多步推理循环：prompt→stream→persist→检测/反思→继续/停止；单步 = 一次 `streamText(stopWhen=isStepCount(1))`                    |
| Stream Utils    | `loop/stream-utils.ts`     | 输出截断、错误检测、`<tool_output>` 包装、流不活跃超时                                                                        |
| Persist Step    | `loop/persist-step.ts`     | StepResult → DB；有工具走 `createBatch`(tool_use+result 原子配对)                                                             |
| Forced Summary  | `loop/forced-summary.ts`   | 整轮无文本兜底：禁工具重跑一次 streamText + 引用验证                                                                          |
| Quote Verifier  | `loop/quote-verifier.ts`   | 兜底摘要引用验证，标记 ⟨unverifiable⟩                                                                                         |
| Detectors       | `loop/detectors/*`         | 代码硬切断：signature-dead-loop、length-truncation-streak                                                                     |
| Reflectors      | `loop/reflect/*`           | context-budget / failure-streak / tool-only-loop / periodic / escalation / judge-completion / quote-correction + `chain` 调度 |
| Reflect Agents  | `loop/reflect/agents/*`    | LLM 反思载体：periodic / judge-completion / quote-correction(generateText + Zod)                                              |
| Turn-End Policy | `loop/turn-end-policies/*` | 无工具步是否收尾:sdk-finish-reason / explicit-termination / judge / legacy                                                    |

### 业务层 — 工具系统

| 组件           | 文件                      | 职责                                                                                                                    |
| -------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Build Tools    | `tools/build-tools.ts`    | ToolMetadata → AI SDK dynamicTool 包装(每步重建)                                                                        |
| Risk Gate      | `tools/risk-gate.ts`      | 统一确认门:HIGH_RISK 黑名单(high-static)/ pending_confirm / fallback → pass/deny/needs_confirm                          |
| Tool Registry  | `tools/registry.ts`       | 4 阶段执行管线：Zod 校验→业务校验→execute→verify                                                                        |
| Path Guard     | `tools/path-guard.ts`     | resolveToolPath 3 态：allowed/sensitive/needs_consent                                                                   |
| Builtin Tools  | `tools/builtin/*.ts`      | bash / read / write / edit / glob / grep / ls                                                                           |
| Skill Tool     | `skills/skill-tool.ts`    | `skill({name})` 激活 → 返回 SKILL.md;SkillActivationTracker 去重(已激活则回「在 history 找」)                           |
| Delegate Agent | `agent/delegate-agent.ts` | `delegate_agent` 派生子 session ReAct 循环;p-limit 并发、每 agent 每 session 预算、30min 超时、失败包 `SUBAGENT_*` 信封 |

### 业务层 — Agent 系统

| 组件               | 文件                     | 职责                                                      |
| ------------------ | ------------------------ | --------------------------------------------------------- |
| Agent              | `agent/agent.ts`         | 不可变 Agent 实例：profile + toolRegistry + skillRegistry |
| Agent ToolRegistry | `agent/tool-registry.ts` | 3 源合并 + 白名单过滤（ALWAYS_AVAILABLE 绕过）            |
| Agent Manager      | `agent/agent-manager.ts` | 平台 Agent（**chat**）+ 业务 Agent 生命周期管理           |

### 业务层 — 记忆系统

| 组件            | 文件                        | 职责                                                    |
| --------------- | --------------------------- | ------------------------------------------------------- |
| ShortTermMemory | `memory/ShortTermMemory.ts` | Path A 全量 / Path B 压缩（摘要+锚点），失败冷却机制    |
| Memory Types    | `memory/types.ts`           | dbToModelMessages（透传 + tool guide 注入）、token 估算 |
| Memory Manager  | `memory/MemoryManager.ts`   | ShortTermMemory 的外壳                                  |

### 业务层 — Provider 适配

| 组件              | 文件                                      | 职责                                                                             |
| ----------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| Model Adapter     | `providers/model-adapter.ts`              | getAdapter() 工厂 → 4 个适配器                                                   |
| OpenAI Adapter    | `providers/adapters/openai-adapter.ts`    | `.chat()` 强制 Chat Completions + DeepSeek thinking 禁用                         |
| Anthropic Adapter | `providers/adapters/anthropic-adapter.ts` | createAnthropic + x-api-key 认证                                                 |
| Google Adapter    | `providers/adapters/google-adapter.ts`    | createGoogleGenerativeAI                                                         |
| Ollama Adapter    | `providers/adapters/ollama-adapter.ts`    | createOpenAICompatible(`<base>/v1`)+ `/api/tags` 模型列表                        |
| Usage Normalizer  | `providers/usage-normalizer.ts`           | 跨厂商 token 用量归一（优先 v7 `inputTokenDetails`，回退 providerMetadata 扫描） |
| Usage Recorder    | `providers/usage-recorder.ts`             | normalize → `sessionRepo.addUsage` 累加落库（fail-open，跳过全零）               |

### 基础设施层

| 组件         | 文件                       | 职责                                        |
| ------------ | -------------------------- | ------------------------------------------- |
| Session Repo | `repos/session-repo.ts`    | Session/Message CRUD + createBatch 原子落盘 |
| DB           | `db/index.ts`              | SQLite 初始化 + WAL + schema 迁移           |
| Config Store | `store/config-store.ts`    | electron-store Provider/Config 配置         |
| Safe Storage | `services/safe-storage.ts` | OS keychain API key 加密存储                |

### 前端

| 组件                | 文件                                      | 职责                                           |
| ------------------- | ----------------------------------------- | ---------------------------------------------- |
| Chat Store          | `renderer/store/chatStore.ts`             | StreamItem[] 统一模型（text + tool_call 交错） |
| useStreamingMessage | `renderer/hooks/useStreamingMessage.ts`   | IPC 事件 → store mutations                     |
| ToolCallLog         | `renderer/components/ToolCallLog.tsx`     | Streaming 态按 step 分组渲染 text + tools      |
| ToolCallMessage     | `renderer/components/ToolCallMessage.tsx` | 持久化态工具行渲染                             |
| MessageBubble       | `renderer/components/MessageBubble.tsx`   | Markdown 渲染 + 代码高亮 + 附件                |

---

## 消息存储格式

DB 直接存储 AI SDK `ModelMessage` 原生格式，零中间转换：

```
SDK response → JSON.stringify → DB (messages.content) → JSON.parse → SDK (直传)
```

| role      | content 格式                                                              |
| --------- | ------------------------------------------------------------------------- |
| system    | `string`（纯文本）                                                        |
| user      | `UserContent`（TextPart / FilePart / ImagePart 数组，纯文本时为 string）  |
| assistant | `AssistantContent`（TextPart / ReasoningPart / ToolCallPart 数组）        |
| tool      | `ToolContent`（ToolResultPart 数组，output 为 `{ type: 'text', value }`） |

唯一的动态处理：`dbToModelMessages()` 在 rebuild prompt 时为 tool-result 注入结构化指引（guide），帮助模型理解工具输出。

---

## 关键设计决策

| 决策                    | 原因                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| 消息格式对齐 SDK        | 零转换损耗，reasoning/providerOptions 自动保留                   |
| Provider 适配层         | 屏蔽 baseURL/apiKey/API 模式差异，Talor 内部稳定                 |
| 7 插件 append-only 管线 | 按 layer 装配,稳定前缀可缓存;关键插件必须成功，非关键降级 + 通知 |
| 事务化消息落盘          | assistant(tool_use) + tool(result) 配对不变量                    |
| 工具 4 阶段执行         | Zod 校验→业务校验→执行→输出验证                                  |
| 死循环 3 路检测         | 签名重复 + 连续失败 + 空文本循环                                 |
| 记忆压缩 + 锚点         | 90% 阈值压缩，最近 4 条 tool 保留原文                            |
| StreamItem 统一模型     | text + tool_call 按 step 交错，解决文本/工具分离问题             |
