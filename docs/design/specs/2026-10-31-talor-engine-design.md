# 用 agent-engine 替换 Talor 运行时 · 方案

> **状态**：讨论稿，待评审。
> **分支**：`feature/talor-engine`，从 master `b6c6a88b` 切出。
> **依据**：
>
> - agent-engine `eddfb21`：设计 v1.2，加上守卫机制 F18（`docs/guard-mechanism.md`）。
> - agent-engine `a4beaf9`：按设计修复组件返回值降级、不可变、指纹、不变量检查与取消（F19）。
> - 现状盘点：Talor 的执行流程和对接面，结论都以代码为准。

---

## 0. 目标与原则

**目标**：下列部分全部交给 agent-engine：

- Talor 的 ReAct 循环；
- prompt 装配、记忆压缩；
- 检测、反思与收尾；
- 工具执行、风险闸门；
- MCP 客户端；
- 委托。

Talor 只保留应用该做的五件事（引擎设计 §12.1）：

1. **配置与选择**：provider、MCP 服务器、skill 目录、权限规则、哪个 agent 用哪些能力。
2. **组装**：会话变成任务，AgentProfile 变成 Agent。
3. **实现**：审批（渲染端弹窗）、凭据库（safe-storage 与账户）。
4. **投影**：运行事件写成会话消息，推给渲染端。
5. **编排**：多轮对话、中止、启动时处理中断的运行。

**原则**：

- 一次 `chat:send` 对应一次运行（Run）。会话就是多次运行的历史投影。
- 引擎已有的机制不在 Talor 里重做，例如守卫、交付验收、兜底交付。确实缺的能力，写成引擎组件，或提给引擎。
- 不长期双轨。分支内用开关并行开发；对齐清单通过后删掉旧运行时，再合入 master。

**不做**：

- 不改 AgentProfile 的 8 字段 schema。
- 不改设置页和会话管理的产品形态。
- 不动 invest 业务。

---

## 1. 概念对照

| Talor 现在                                      | 引擎                                                  | 说明                                                                  |
| ----------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| 会话 session                                    | 多次运行 + `task.subject = sessionId`                 | 审批的"本会话记住"按 subject 区分                                     |
| 一轮（`chat:send`）                             | 一次运行 `Run`                                        | 结局和 code 由引擎给出，取代 14 种 `LoopExitReason`                   |
| AgentProfile（`__chat__`、用户 agent）          | `Agent`（`defineAgent`）                              | `agentPrompt` 作为指令；tools、skills、mcpServers、subagents 作为能力 |
| 会话选定的 provider / model / reasoning         | 模型指派 + Talor 自己的 `ModelProvider`               | 见 §3.2                                                               |
| workspace                                       | `task.scope` + `workspaceSandbox`                     |                                                                       |
| 交互式聊天                                      | 执行环境 `interactive`：委托人联系得上，审批走渲染端  | 后台场景以后再加 `background` 环境                                    |
| 委托子会话                                      | 子运行（`subagent` 能力），投影成子会话               |                                                                       |
| `messages` 表                                   | 运行事件的投影                                        | 既给 UI 显示，也是下一轮 history 的来源                               |
| trace 四张表                                    | 运行档案（run archive）                               | 只追加的事件日志，是唯一事实来源                                      |
| talor 块 done / need_input / blocked / proposal | 意图工具 finish / ask_user / report_blocked / propose | 模型不再输出排版协议（引擎 §12.4）                                    |

---

## 2. 一次 `chat:send` 怎么走

```
chat:send
  → TurnService.send(sessionId, content, attachments)
     1. 会话里已有运行 → 先 abort（保持现在的行为，见 §9 决策 2）
     2. 保存用户消息（messages 表）
     3. 组装：
        Agent   = agents.get(session.agent_id)          // 按 profile 指纹缓存
        Task    = {
          input:    用户消息 + 附件,
          history:  messages 表投影（不含本条）,
          volatile: 日期、OS、工作区,
          scope:    { workspace },
          subject:  sessionId,
          budget:   { maxSteps: max_react_steps },
        }
        Model   = 会话选定的模型
     4. run = interactive.start(agent, task, { model })
     5. run.subscribe(projection, { children: true })
  ← chat:abort → run.abort()
```

运行事件到 Talor 动作的投影：

| 运行事件 / 通知               | Talor 动作                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `text_delta`                  | `chat:stream`                                                                                     |
| `reasoning_delta`             | 新增：推给渲染端，渲染端可以选择性显示                                                            |
| `model_responded`，带工具调用 | 每个调用发一次 `chat:tool-call`                                                                   |
| `tool_finished`               | `chat:tool-result`                                                                                |
| 一步结束（工具结果齐了）      | 用 `messageRepo.createBatch` 在一个事务里写 assistant 行和 tool 行，再发 `chat:message-persisted` |
| `delivered`                   | 渲染端结束"核对中"状态。兜底交付的文本作为 assistant 消息写入                                     |
| `run_ended`                   | 用量写入 sessions 的 4 个用量列；发 `chat:stream` done；结局为 failed 时带上 `error_code`         |
| 子运行的事件                  | 写到子会话（`parent_session_id`）的 messages                                                      |

第一阶段 IPC 通道名和 payload 都保持不变，由投影层生成，所以渲染端改动最小。

---

## 3. 模块设计（新增 `src/main/runtime/`，业务层）

| 文件             | 职责                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `engine.ts`      | 装配 `createEngine`：模型库、运行档案、凭据库、能力宿主、日志（electron-log 适配）。全局单例。启动时处理 `engine.interrupted()` |
| `models.ts`      | Talor 自己的 `ModelProvider`，见 §3.2                                                                                           |
| `vault.ts`       | `SecretResolver`：解析 API key（safe-storage）和账户凭据（account-store）                                                       |
| `environment.ts` | `interactive` 执行环境，见 §3.3                                                                                                 |
| `agents.ts`      | AgentProfile → `defineAgent`，见 §3.4                                                                                           |
| `tools.ts`       | 把内置 `ToolDefinition` 适配成引擎的 `ToolDef`，见 §3.5                                                                         |
| `task.ts`        | 把会话组装成 Task：history 投影、附件、volatile、预算                                                                           |
| `projection.ts`  | 运行事件 → messages 行、用量、渲染端事件；子运行 → 子会话                                                                       |
| `turn.ts`        | `chat:send` / `chat:abort` 用例，取代 `chat/orchestrator.ts` 和 `loop/react-loop.ts`                                            |

依赖方向沿用 CLAUDE.md：`ipc → runtime → repos/db/store`。`runtime/` 只经包入口 `agent-engine` 引用引擎。

### 3.1 能力逐项去向

| #   | Talor 现有                                           | 去向                                                                                        | Talor 要做的                                                                                                       |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | react-loop、stream-utils、step-adapter、persist-step | 引擎步循环                                                                                  | 无。持久化改由 projection 做                                                                                       |
| 2   | 2 个检测器 + 9 个反思器 + 收尾策略链                 | 步级守卫（封路、失败连击、无新信息、截断、静默推进）+ `completionReview` + `groundingCheck` | 无。`guard-mechanism.md` §1 已逐项对照                                                                             |
| 3   | forced-summary、空文本兜底                           | 兜底交付 `standardFallback`                                                                 | 无                                                                                                                 |
| 4   | PromptPipeline 的 7 个插件                           | 引擎固定视图布局：须知 / Agent 指令 / 能力说明 / history / 任务输入 / 运行记录 / 易变信息   | 章程改写成须知（见 §3.3）；UiBlock 协议删除；ToolSelection 改用 `searchExposure`；RuntimeMeta 改用 `task.volatile` |
| 5   | ShortTermMemory + `session_summaries`                | `compactingMemory`（只压缩本次运行的视图）                                                  | 跨轮摘要的做法见 §9 决策 3                                                                                         |
| 6   | Anthropic 缓存断点                                   | AI SDK 适配器自带的缓存断点                                                                 | 无                                                                                                                 |
| 7   | 7 个内置工具 + path-guard                            | `ToolDef` 适配                                                                              | 见 §3.5                                                                                                            |
| 8   | RiskGate + 确认弹窗                                  | `riskApproval({ mode: 'ask-high' })` + `Approver`                                           | Approver 走 `chat:tool-confirm`；"记住"真正生效（`ApprovalAnswer.remember`）                                       |
| 9   | PermissionPort + permission-store                    | `workspaceSandbox({ sensitive, granted })`；工作区外的路径走审批                            | `granted` 读取 permission-store；规则存储保留                                                                      |
| 10  | bash 黑名单（现在在用户批准之后才检查）              | bash 工具的 `validate`，在引擎流水线 c/d 环节执行，早于审批                                 | 顺带修复"批准后才拦"的问题                                                                                         |
| 11  | MCP client + 自研 transport                          | `mcpHost` + `stdioConnect` / `httpConnect` + `mcp(spec)`                                    | `mcp_servers` 表保留，转成 `McpServerSpec`；凭据改用 `SecretRef`                                                   |
| 12  | `search_tool` + mcp-exposure-state                   | `searchExposure`，引擎自带 search_tool                                                      | 无                                                                                                                 |
| 13  | SkillRegistry + skill 工具                           | `skill()` + `skillHost`，目录为 `~/.talor/skills`                                           | skill-installer 保留                                                                                               |
| 14  | `delegate_agent`                                     | `subagent()` + 委托宿主                                                                     | 子运行投影成子会话                                                                                                 |
| 15  | talor 块                                             | `intents()`                                                                                 | 渲染端改为根据意图工具的调用来渲染，见 §5                                                                          |
| 16  | usage-recorder                                       | `model_responded` 和 `external_call` 里的 usage                                             | 投影到 sessions 的 4 个用量列                                                                                      |
| 17  | trace 中间件 + 四张表 + TracePanel                   | 运行档案 + Trace 投影                                                                       | 见 §9 决策 5                                                                                                       |
| 18  | streamRegistry                                       | `run.abort()` / `run.steer()`                                                               |                                                                                                                    |
| 19  | 启动时的孤儿清理和 trace 清扫                        | `engine.interrupted()`                                                                      | 中断的运行在会话里标注                                                                                             |
| 20  | 附件 + provider 级视觉开关                           | 任务输入里的 image / file parts；视觉能力按模型判断                                         |                                                                                                                    |
| 21  | `request_continuation` 工具                          | `completionReview`："说完要做就停手"会被退回                                                | 删除这个工具                                                                                                       |

### 3.2 模型

- Talor 实现自己的 `ModelProvider`，id 为 `talor`，`resolve('talor:<providerId>/<modelId>')` 按需建端口：
  - 沿用 `providers/adapters` 的 `createModel`，去掉 traceMiddleware；
  - 交给 `aiSdkProvider` 生成 `ModelPort`。
- **端口转发**：模型库会缓存端口。Talor 返回的是转发端口，每次调用时都按当前配置取实际的端口。这样用户改了 API key 或参数，不需要重建引擎。
- **能力**：`contextLimit` 取 `provider.context_limit`，`vision` / `reasoning` 沿用 detector。
- **参数**：reasoning 配置、`provider_options`、headers 合并成 `providerOptions`。
- 会话的模型通过 `env.start(…, { model })` 指派。

### 3.3 执行环境 `interactive`

| 部分     | 内容                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 委托人   | `reachable: true`；`approver` 走 `chat:tool-confirm` / `chat:permission-request` 的往返                  |
| 须知     | 由 SystemPlugin 的 15 条章程改写。删除与引擎机制重复或冲突的条款：talor 块、收尾格式、反思信号、审批说明 |
| 权限规则 | `workspaceSandbox`（Talor 的额外敏感路径只能追加）、`riskApproval({ mode: 'ask-high' })`                 |
| 强制验收 | 默认没有。Agent 的默认交付物已经带了 `completionReview`                                                  |
| 上限     | 委托的深度 / 次数 / 并发沿用 config-store；审批等待 5 分钟                                               |

### 3.4 Agent

`AgentProfile` 到 `defineAgent` 的映射：

- `instructions` ← `agentPrompt`。`__chat__` 那条额外约束一并并入。
- `capabilities`：
  - `tools(内置工具中 profile.tools 允许的部分)`
  - `skill(...)`：对应 `profile.skills`
  - `mcp(spec)`：对应 `profile.mcpServers`，每个服务器一项；空表示全部
  - `subagent(...)`：对应 `profile.subagents`
  - `intents()`
- Feature 贡献的工具（目前 Features 列表为空）映射成 `tools()` 能力，保留这个接口。
- `toolbox` / `deliverable` 用引擎默认值。

### 3.5 工具适配

- **schema**：`zodSchema` / `parameters` 直接作为 `inputSchema`。
- **执行属性**：`riskLevel: HIGH` 映射为 `safety.risk: 'high'`；write、edit、bash 的 `effect` 为 `side_effect`，read、ls、glob、grep 为 `none`。
- **路径**：`safety.access(input)` 给出工具要访问的路径，交给 `workspaceSandbox` 判定，取代 path-guard 的三种结果；path-guard 的硬拒绝清单并入沙箱的 `sensitive`。
- **校验**：`validate` 保留 bash 黑名单和写路径检查。`verify` 的提示并入工具的输出。
- **错误信封**：在适配层把 `__talor_error` 映射成 `__agent_error`。

---

## 4. 数据与存储

| 数据                                                 | 处理                                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 运行档案                                             | 单独的 `~/.talor/runs.db`（`sqliteArchive`），保留 30 天，沿用现在 trace 的保留期                                      |
| `messages` 表                                        | 保留。格式沿用 AI SDK parts（引擎的 `ModelMessage` 与之兼容，P1 要实测验证）。`trace_id` 列改存 runId                  |
| 工具输出                                             | 改用引擎里的 shown 内容（已按 `maxOutputChars` 截断，默认 8KB）。skill 的 1MB 例外改为 skill 工具声明 `maxOutputChars` |
| `side_effect_log`、`reflection_ledger`、trace 四张表 | 按项目策略直接 DROP。副作用和反思的信息都在运行档案里                                                                  |
| `session_summaries`                                  | 视 §9 决策 3 而定                                                                                                      |
| 旧会话                                               | 已有的 tool-call / tool-result 都成对，可以直接作为 history；含 talor 块的旧 assistant 文本原样保留                    |

---

## 5. 渲染端

- 第一阶段 IPC 不变，见 §2。
- 必须改的部分：
  1. **talor 块 → 意图**：done / need_input / blocked / proposal 改为根据意图工具的调用和 `RunResult.intent` 来渲染。现有的 `DonePill` / `NeedInput` / `BlockedRow` / `Proposal` 组件复用，只换数据来源。warning 块和预留的 plan 块删除。
  2. **"核对中"状态**：`delivered` 之前的最终文本是暂定的（引擎 §12.4）。被验收退回时，暂定文本仍然留在记录里，下一步接着来。
  3. **子会话刷新**：子运行的步也发 `chat:message-persisted`。现在子会话没有任何推送。
- `MessageBubble` 里与 talor 块相关的解析，在 P4 删除。

---

## 6. 前置条件（agent-engine 侧）

1. **直接影响 Talor 的 4 个问题，在 `eddfb21` 里已经修复**。2026-10-31 用公开 API 构建后实测，结果如下：

   | 问题                              | 实测结果                                                                                                                  |
   | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
   | 工具执行之外的异常让整次运行失败  | `safety.access` 抛错、输出含循环引用、输出含 BigInt，这三种都只让该调用得到 `TOOL_EXCEPTION`，运行照常以 `completed` 结束 |
   | 交付过程中取消仍然交付            | 在拦截验收中取消、在兜底生成中取消，都以 `aborted/user` 结束；没有发出 `delivered`，取消后也没有再调用模型                |
   | 取消打断不了审批等待              | 1ms 内结束，结局 `aborted/user`，该调用的结果是 `TOOL_ABORTED`，工具没有执行                                              |
   | 复用或预连接的 MCP 连接不脱敏凭据 | 每次获取连接都经当前运行的凭据库解析，脱敏名单因此能记下凭据值（`mcp-host.test.ts` 的 AC-010 覆盖）                       |

   Talor 侧要注意：预连接用的是 `mcpHost({ vault })` 自带的凭据库，引擎不会自动共用 `services.vault`。所以 Talor 必须把同一个凭据库同时传给两处，否则带凭据的服务器会预连接失败。

2. **`a4beaf9` 又按设计修复了 5 处**，Talor 接入时直接受益：
   - 组件返回值格式不对时按设计 §4.4 降级，不再让整次运行以 `engine_error` 失败；
   - 执行环境、Agent、任务、引擎守卫在创建时复制并冻结，日志事件也冻结。Talor 组装 Agent 和任务时要一次定好，之后不能再改（例如往 `agent.capabilities` 里追加）；
   - Agent 指纹包含工具定义，内置工具的描述、schema、风险等变化都会让指纹变化；
   - `assertInvariants` 做完整的不变量检查，Talor 的对齐测试可以直接用；
   - 运行取消时，正在执行的 hook 和等待中的 MCP 取连接都会立即结束。
3. **其余审查结论已复核**（2026-10-31，按 `a4beaf9`）：10 条里 2 条已修复、4 条设计如此，余下 4 条是引擎内部问题或只需改文档。与 Talor 有关的两条：
   - MCP 工具返回 `isError` 时记为 `TOOL_EXCEPTION`，按瞬时错误处理，同样的输入会再调一次（实测服务器执行 2 次后才被拦下）。P2 接 MCP 时决定是否让服务器规格声明错误类别；
   - MCP 连接池按整个服务器规格（含工具过滤、`exposure`、`callTimeoutMs`）取键。Talor 预连接用的规格必须和 Agent 里的完全一致，否则同一个服务器会多起一个进程。
4. **版本与依赖**：先用本地路径依赖（`file:../../../../agent-engine`，放在 `devDependencies`，打进主进程 bundle），稳定后 agent-engine 打 tag，Talor 改为 git 依赖，见 §9 决策 1。`.npmrc` 设 `install-links=true`，本地依赖复制安装而不是符号链接：引擎的依赖并入 Talor 的依赖树，`rebuild:node` / `rebuild:electron` 不会波及 agent-engine 自己的 `node_modules`。改了引擎后，先在 agent-engine 里 `npm run build`，再在 Talor 里 `rm -rf node_modules/agent-engine && npm install`（版本号不变时 `npm install agent-engine` 不会刷新）。`@modelcontextprotocol/sdk` 加入 `dependencies`，`ai` 升到 `^7.0.159`（已确认，2026-10-31）。

---

## 7. 分阶段落地

> P1 之后的阶段按[能力架构与执行链路方案（v2）](2026-10-31-talor-engine-remediation.md) §6 调整：先做"阶段 A 能力平台"（能力目录与凭据、Agent 装配、执行环境、委托、分派与生命周期），再做扩展包、协议与观测、切换与删除。问题归因见该文档 §1.5。

每个阶段拆成若干 k-vibe lite feature，每个 feature 不超过 5 个 TASK。每个阶段结束时 `npm test` 和 `npm run typecheck` 都要通过。

| 阶段          | 内容                                                                                                                                                                                                                                             | 完成标志                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| P0 准备       | 按 §6 核对剩余审查结论；Talor 接入本地依赖，调整打包；冒烟入口 `src/main/runtime/smoke-entry.ts` 构建为 `out/main/engine-smoke.js`，用 `npx electron out/main/engine-smoke.js` 运行（设置 `DEEPSEEK_API_KEY` 时用 DeepSeek，否则用 `fakeModel`） | 冒烟测试在 Electron 主进程里通过（`fakeModel` 与 DeepSeek 各一次） |
| P1 骨架       | `runtime/` 的 engine、models、vault、agents（只有内置工具）、task、projection、turn；`chat:send` 按开关 `runtime=engine` 走新路径，默认仍走旧路径                                                                                                | 纯对话和内置工具对话跑通；messages 表能作为下一轮的 history        |
| P2 能力       | 审批与权限、MCP（含凭据）、skill、委托（子会话投影）、附件、reasoning、用量                                                                                                                                                                      | §8 对齐清单的能力部分全部通过                                      |
| P3 协议与观测 | 用意图替换 talor 块；章程改写为须知；trace 面板改读运行档案；中断的运行在会话里标注                                                                                                                                                              | 渲染端各个状态都正确                                               |
| P4 切换与删除 | 默认改为 engine；删除旧运行时、旧表和旧测试；更新 CLAUDE.md 与 `docs/engineering/overview.md`；合入 master                                                                                                                                       | §8 全部通过；旧代码零引用                                          |

**P4 删除清单**：

- `src/main/loop/`、`src/main/prompt/`、`src/main/memory/`，后者视 §9 决策 3 而定。
- `tools/{risk-gate,build-tools}.ts`、`permissions/port.ts`。
- `agent/{agent,agent-toolset,delegate-agent}.ts`。
- `mcp/{client,transport/*}`。
- `chat/{orchestrator,stream-registry}.ts`。
- `providers/{usage-recorder,middleware/trace}`、`observe/`。
- `shared/talor-blocks/`、builtin `request_continuation`。
- 对应测试约 70 个文件，包括 loop、prompt、memory、reflect，以及 tools、agent、mcp、observe 里的相关部分。

**替换后自然修复的 Talor 现存问题**（来自代码盘点）：

- 子 agent 收不到委托指令；
- "本会话记住"不生效；
- bash 黑名单在用户批准之后才检查；
- bash 和 glob 从不申请权限；
- `envFromAccount` 无法从保存的配置里取到；
- 子会话没有 UI 推送；
- 子 agent 忽略会话的 reasoning 设置。

---

## 8. 对齐清单（切换验收）

每一项都用 `fakeModel` 写自动化测试；标 ★ 的项另外用真实模型手工对比新旧两条路径。

| 类别 | 场景                                                                                         |
| ---- | -------------------------------------------------------------------------------------------- |
| 对话 | 纯对话 ★；多轮带工具的 history；长对话压缩 ★；含 talor 块的旧会话继续对话                    |
| 工具 | 单个和并行工具调用；工具报错后模型自行调整；bash 危险命令在审批前被拦                        |
| 审批 | 同意 / 拒绝 / 超时 / 本会话记住；工作区外路径；审批弹窗中途点"停止"                          |
| 能力 | MCP 调用、断连、凭据 ★；skill 激活；委托子 agent 和子会话展示 ★；图片附件；reasoning 模型 ★  |
| 结局 | 模型错误（401、超时）；上下文超限；提问 `ask_user`；提议 `propose`；兜底交付；验收退回后继续 |
| 恢复 | 运行中退出应用后重启；运行中再发一条消息                                                     |
| 指标 | 缓存命中率与用量和旧路径对比 ★                                                               |

---

## 9. 待决策

| #   | 事项               | 推荐                                                                                                                                                                                                    | 备选                                                                    |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | 依赖方式           | **已定（2026-10-31）**：先用本地路径依赖（复制安装），放在 `devDependencies`，主进程打包时打进 bundle，better-sqlite3 仍然作为外部依赖；稳定后 agent-engine 打 tag，合入 master 前改为 git 依赖固定版本 | 发布到私有 npm                                                          |
| 2   | 运行中再发一条消息 | 第一阶段保持 abort；P3 再评估改成 `steer`                                                                                                                                                               | 直接改成 steer                                                          |
| 3   | 跨轮记忆           | P2 实现应用侧的跨轮摘要：history 超过阈值时，用一次后台运行生成摘要并存入 `session_summaries`，下一轮的 history 为"摘要 + 最近的消息"。这样所有模型调用都经过引擎                                       | 只用 `compactingMemory`：每轮都重新压缩，长会话更费 token，也会破坏缓存 |
| 4   | talor 块           | 全部改为意图工具；warning 块和 plan 块删除                                                                                                                                                              | 保留 talor 块作为文本协议（与引擎 §12.4 冲突）                          |
| 5   | trace              | TracePanel 改为读运行档案的 Trace 投影；删除 trace 四张表                                                                                                                                               | 接入 `langfuseExporter`，交给外部平台                                   |
| 6   | 旧表               | `side_effect_log`、`reflection_ledger`、trace 表直接 DROP                                                                                                                                               | 保留只读                                                                |
| 7   | 推进方式           | 分支内用开关并行开发，对齐清单通过后删旧代码再合 master                                                                                                                                                 | 不加开关，直接替换                                                      |

---

## 10. 风险

| 风险                                                                         | 应对                                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 行为变化：守卫与旧反思器的触发时机、结局不同                                 | 对齐清单 + ★ 项手工对比；必要时调整守卫的阈值和须知措辞                                             |
| Talor 的 Google fetch 补丁、system-note 中间件与引擎适配器的消息规整可能重复 | P1 用 Google 模型实测；有重复就去掉 Talor 侧的补丁                                                  |
| messages 表格式与引擎 `ModelMessage` 不完全兼容                              | P1 第一个测试就验证"旧会话作为 history"                                                             |
| 两个仓库要同步改                                                             | tag 固定版本；引擎改动先合入并打 tag，Talor 再升级                                                  |
| better-sqlite3 有两处使用                                                    | 都用同一个 Electron ABI 构建，沿用现有的 rebuild 流程                                               |
| invest 分支建立在旧运行时上                                                  | 本分支合入 master 之后，invest 分支再 rebase；invest 只复用 agent 运行时，接口变化集中在 `runtime/` |
| 渲染端协议变更（talor 块）                                                   | P3 集中处理；IPC 通道保持不变                                                                       |
