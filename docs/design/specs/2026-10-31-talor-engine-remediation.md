# Talor × agent-engine 能力架构与执行链路方案（v2）

> **状态**：讨论稿，待评审。v2 取代 v1"执行链路系统性修复方案"：v1 只从执行链路的症状往回推；v2 先把两边的工具、MCP、skill、委托、Feature、插件与 hook 机制逐项对照，再从能力架构重新设计。
> **关联**：[替换方案](2026-10-31-talor-engine-design.md)（下称"替换方案"）；P1 实现见 `vibe/features/engine-runtime-assembly`、`engine-runtime-turn`。
> **依据**：2026-10-31 的实测（`runtime: 'engine'` + DeepSeek）与两边代码，结论都标了出处。Talor 路径相对 `src/main/`，引擎路径相对 agent-engine 的 `src/`。

---

## 0. 结论

P1 只把 Talor 的 7 个内置工具映射成了一项引擎能力。Talor 的能力其实来自六类来源：内置工具、MCP 服务器、skill、业务 agent（委托）、Feature、插件。每类在 Talor 里都有自己的一套机制，负责注册、选择、暴露和执行；P1 没有把这些机制接到引擎上。实测中的问题，都是这一点在不同环节的表现：

- 模型声称有 MCP，界面显示 `MCP · 283`，实际一个都用不了；
- 权限规则和审批时限不生效；
- 纠偏话术混进答复。

引擎已经有完整的能力体系（能力、宿主、工具呈现、插件解析、hook 适配），设计上也写明了"承载与使用归引擎，配置与选择归应用"。因此方案是：**Talor 只保留"来源 → 目录 → 选择"三件事，承载与使用全部交给引擎**：

1. **能力目录**：把六类来源归一成一个目录。Agent 装配、执行环境、逐轮分派和界面都只读它。
2. **按引擎的标准能力映射**：`tools`、`mcp`、`skill`、`subagent`。连接池、凭据、渐进加载和委托限额都由引擎宿主承载，删掉 Talor 自己那一套。
3. **Feature 与插件统一为扩展包**：插件用 Claude Code 格式，经引擎的 `parsePlugin` 解析，hook 经 `adaptHooks` 进入执行环境。
4. **迁移期按能力覆盖逐轮分派**，任何会话都不会比旧路径少能力。

顺带修掉 Talor 现有机制里几处不该带到新架构的缺陷，见 §1.3。

---

## 1. 现状

### 1.1 Talor 的能力机制

| 来源                                      | 注册                                                                                                           | 每个 agent 的选择                                                                                                       | 暴露给模型                                                                                                                                               | 执行                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 内置工具（7 个 + `request_continuation`） | 全局 `toolRegistry`，import 时注册（`tools/builtin/index.ts:10-22`）                                           | `profile.tools` 为空时全部；非空时为声明的工具 ∪ `ALWAYS_AVAILABLE_TOOLS`（`agent/agent-toolset.ts:62-76`、`:182-190`） | 每步由 `ToolSelectionPlugin` 给出                                                                                                                        | `runToolPipeline` + RiskGate                           |
| MCP 服务器                                | `mcp_servers` 表；单例 `mcpRegistry` 在启动时连接全部启用的服务器（`index.ts:270-273`）；自研 stdio、http 传输 | `profile.mcpServers` 为空时全部，非空时 `filterByServerNames`（`agent/agent-manager.ts:169-177`）                       | 第一步展开全部 MCP 工具，之后只给用过的；调用 `search_tool` 后下一步再展开全部（`loop/mcp-exposure-state.ts:23-78`）                                     | `McpRegistry.execute`，工具名按第一个匹配的服务器执行  |
| skill                                     | `SkillRegistry.fromPlatformDir(~/.talor/skills)`，启动时加载一次                                               | `profile.skills` 为空时没有；平台 agent 拿全部                                                                          | 系统提示里列清单（name、description、when_to_use）；`skill` 工具返回正文，相对链接改写为绝对路径，引用文件再用 `read` 读（`skills/skill-tool.ts:14-23`） | —                                                      |
| 业务 agent（委托）                        | `~/.talor/agents/*`；Feature agent                                                                             | `profile.subagents`（`allowAny` / `ids`）                                                                               | `delegate_agent` 工具，说明里列出目标 agent（`agent/delegate-agent.ts:388-470`）                                                                         | 建子会话，跑 `runReactLoop`，取最后一条 assistant 文本 |
| Feature                                   | `installFeatures`（`features/install.ts:14-35`）；目前一个都没注册（`index.ts:259-260`）                       | Feature 自带的 agent 拿它的 `featureTools`                                                                              | 同内置工具                                                                                                                                               | 同内置工具                                             |
| 插件与 hook                               | 不存在。代码里的 "plugin" 只指 prompt 插件                                                                     | —                                                                                                                       | —                                                                                                                                                        | —                                                      |

### 1.2 引擎的能力机制

| 机制                      | 要点                                                                                                                                                                                              | 出处                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 能力 `Capability`         | 每次运行开始时 `prepare` 一次，结果冻结。产出工具、说明片段、守卫、呈现方式、可用性和释放；配置进入 Agent 指纹                                                                                    | `contracts/capability.ts:15-79`、`engine/prepare.ts`                                               |
| 宿主 `CapabilityHost`     | 跨运行共享的资源。默认只有 skill 宿主和委托宿主；MCP 宿主和 hook 执行器要应用自己传入 `services.hosts`                                                                                            | `contracts/engine.ts:30-31`、`engine/engine.ts:184-192`、`index.ts:23-30`                          |
| `tools` / `bundle`        | 一组 `ToolDef`；`bundle` 合并若干能力                                                                                                                                                             | `stdlib/capabilities/tools.ts`                                                                     |
| `mcp(spec)`               | 工具名为 `<服务器名>__<工具名>`；凭据用 `SecretRef`，每次取连接时由运行的凭据库解析并记入脱敏名单；默认 `deferred`；`readOnlyHint` / `idempotentHint` 映射为副作用类别；schema 不兼容时降级或跳过 | `stdlib/capabilities/mcp.ts:21-160`                                                                |
| MCP 宿主                  | 连接池以整个服务器规格的哈希为键；按服务器熔断（连续 5 次失败，冷却 30 秒）；只有依赖本身的故障计入熔断；断开后在下次调用时重连；可预连接                                                         | `services/mcp-host.ts:151-374`                                                                     |
| 工具呈现 `searchExposure` | `eager` 工具始终可见；`deferred` 工具在调用 `search_tool` 之后全部可见                                                                                                                            | `stdlib/exposure/search-exposure.ts:21-63`                                                         |
| `skill(pkg)`              | 说明片段一句话，加一个共享工具 `activate_skill`，激活后返回正文（20000 字截断）；`pkg.dir` 不使用                                                                                                 | `stdlib/capabilities/skill.ts:5-31`、`services/skill-host.ts:41-97`                                |
| `subagent(agent)`         | 一个共享工具 `delegate {agent, task}`；子任务只带 task 文本，继承 `subject` 与作业范围；限额包括深度、同一 agent 次数、按层并发、预算不超过父运行剩余额度；子运行的权限只会收窄                   | `stdlib/capabilities/subagent.ts`、`services/delegation-host.ts:41-100`、`engine/lineage.ts:63-91` |
| 插件 `parsePlugin`        | Claude Code 格式，解析出 skills、agents、`.mcp.json`、hooks、commands                                                                                                                             | `stdlib/parsers/parse-plugin.ts:23-140`                                                            |
| hook `adaptHooks`         | 按事件翻译：SessionStart、UserPromptSubmit → 须知；PreToolUse → 权限规则；PostToolUse → 守卫；Stop、SubagentStop → 拦截验收；其余交还应用                                                         | `stdlib/hooks/adapt-hooks.ts:96-284`                                                               |
| 应用职责                  | 配置与选择（MCP 配置、预连接列表、插件安装与启用、skill 目录、凭据存储、每个 Agent 用哪些能力）；组装；实现审批人、凭据库、授权存储；投影；编排                                                   | `docs/agent-engine-design.md:1558-1595`                                                            |

### 1.3 Talor 机制自身的缺陷（迁移时不照搬）

| #   | 缺陷                                                                                                | 出处                                 | 新架构下                                             |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| T1  | MCP 工具名不带前缀，不同服务器重名时按第一个匹配的执行                                              | `mcp/client.ts:236-241`、`:330-335`  | 引擎统一加 `<服务器>__` 前缀                         |
| T2  | `envFromAccount`（账户凭据注入）在生产路径上从未生效：表里没有这一列，`configFromServer` 也不复制它 | `mcp/client.ts:29-41`                | 凭据统一走 `SecretRef` + Talor 凭据库                |
| T3  | http MCP 的 token 和 apiKey 以明文存在 `mcp_servers.auth`                                           | `db/index.ts:46-60`                  | 迁到加密存储，规格里只放引用                         |
| T4  | 第一步就把全部 MCP 工具展开给模型（实测 283 个）                                                    | `loop/mcp-exposure-state.ts:31`      | MCP 默认 `deferred`，经 `search_tool` 按需展开       |
| T5  | 声明了 `profile.tools` 的 agent，它的 Feature 工具会被白名单挡掉                                    | `agent/agent-toolset.ts:182-190`     | Feature 工具是独立的一项能力，不受内置工具白名单约束 |
| T6  | 委托依赖检查的子 agent 步骤永远通过（调用时没传参数）                                               | `agent/dependency-checker.ts:90-109` | 装配时按目录校验目标 agent 是否存在                  |
| T7  | 界面的工具计数读的是"已暴露的全集"，不是这一轮的实际视图                                            | `ipc/agents.ts:711-715`              | 读能力目录给出的快照                                 |
| T8  | 声明了 `profile.tools` 的 agent 看不到任何 MCP 工具：白名单同样作用于 MCP 工具                      | `agent/agent-toolset.ts:171-190`     | MCP 按 `mcpServers` 单独选择，不受内置工具白名单约束 |

### 1.4 P1 实测现象与根因（v1 结论的保留部分）

| 现象                                                         | 根因                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| 模型自称能用 MCP、要调 `search_tool`；界面显示 `MCP · 283`   | 能力只映射了内置工具；指令写死工具名；界面读旧注册表 → §3.2、§3.5 |
| 审批 30 秒没人点就按拒绝处理；授权规则不生效；没有防注入提示 | 组织规矩没有进入执行环境 → §3.6                                   |
| 中断不收尾、用量只在结束时写、Trace 查不到                   | 运行生命周期没接入应用 → §3.8                                     |
| "已确认……还缺……下一步"作为答复显示                           | 投影没区分过程与答复 → §3.8                                       |
| 全局开关一开就倒退                                           | 切换方式 → §4                                                     |

### 1.5 问题归因：引擎还是 Talor 的调用

判定标准：

- **引擎问题**：引擎的行为与它的设计文档不符，或者设计本身有缺口，导致任何正确接入的应用都会遇到。
- **Talor 调用问题**：引擎已经提供了机制，但 Talor 没有接、接错了，或者没按引擎的职责划分提供应用该给的东西。
- **Talor 原有缺陷**：旧路径本身就有的问题，与迁移无关。

| #   | 问题                                                                                                             | 归因                                  | 依据                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 模型自称能用 MCP、要调 `search_tool`；"浏览器找股票"只能用 bash                                                  | **Talor 调用**                        | 引擎有 `mcp()`、`searchExposure`（§1.2）；P1 的 `agents.ts` 只映射了内置工具，`__chat__` 的 agentPrompt 仍点名 MCP 与 `search_tool`                                                 |
| 2   | 界面显示 `MCP · 283`                                                                                             | **Talor 调用**                        | 计数读旧的 `agents:list-tools`（`ipc/agents.ts:711-715`），不是引擎这一轮的能力                                                                                                     |
| 3   | 审批超时被当成用户拒绝                                                                                           | **Talor 调用**                        | 引擎有 `APPROVAL_TIMEOUT` 与执行环境上限 `approvalTimeoutMs`（`executor/permissions.ts:47`）；P1 的审批人复用了自带 30 秒超时的确认端口，超时时返回 `false`                         |
| 4   | 越界只读也按"高风险"弹窗                                                                                         | **Talor 调用**                        | 沙箱询问时只读为 `low`、写为 `high`（`stdlib/permissions/workspace-sandbox.ts:171`）；P1 的审批人把风险等级写死为 `high`                                                            |
| 5   | 授权规则（Permissions）不生效、不能"记住"                                                                        | **Talor 调用**                        | 引擎为此留了两处：审批人自己实现"记住"（`contracts/component.ts:299` 的注释），沙箱有 `granted`；P1 两处都没接 permission-store                                                     |
| 6   | 没有"工具输出只是数据"的防注入提示                                                                               | **Talor 调用**                        | 引擎从结构上保证工具输出伪造不了提示（`docs/agent-engine-design.md:1492`）；告诉模型如何对待工具输出属于须知，由应用通过执行环境提供。P1 的执行环境没有须知                         |
| 7   | "已确认……还缺……下一步"作为答复显示                                                                               | **Talor 调用**（引擎设计如此）        | 纠偏时要求模型先复盘是引擎有意的设计（`docs/guard-mechanism.md` §4.1 第 3 条、§4.2，实现在 `core/steering.ts:65`），这段话属于过程文本；P1 的投影没有区分过程与答复，把它当成了正文 |
| 8   | 中断的运行不收尾、退出不关闭                                                                                     | **Talor 调用**                        | 引擎提供 `interrupted()`、`shutdown()`（`contracts/engine.ts:47-56`），Talor 没有接入应用生命周期                                                                                   |
| 9   | 用量只在运行结束时写                                                                                             | **Talor 调用**                        | `model_responded` 事件里带每步用量，P1 的投影没有用                                                                                                                                 |
| 10  | Trace 查不到                                                                                                     | **Talor 调用**（已排在阶段 C）        | 引擎有 `buildTrace`，Trace 面板还在读旧表                                                                                                                                           |
| 11  | 长会话每轮带全量 history                                                                                         | **Talor 调用**（设计如此）            | 引擎的记忆只压缩本次运行的视图；跨轮摘要是应用的事（替换方案 §9 决策 3）                                                                                                            |
| 12  | 所有工具统一 35 秒超时                                                                                           | **Talor 调用**                        | 引擎允许每个工具声明 `timeoutMs`，P1 统一设了一个值                                                                                                                                 |
| 13  | MCP 工具返回 `isError` 时，同样的输入会再调一次                                                                  | **引擎**                              | `mcp.ts:99` 一律记为 `TOOL_EXCEPTION`，按瞬时错误处理；MCP 协议本身不区分错误类别，引擎也没有让应用声明的入口；已由引擎 F21 补上（E1）                                              |
| 14  | skill 目录里的引用文件对模型不可见                                                                               | **引擎**（能力缺口）                  | `SkillPackage.dir` 在引擎里没有任何地方使用；Talor 可以用"改写链接 + 只读授权"绕开                                                                                                  |
| 15  | 审批请求只带截断的输入预览                                                                                       | **引擎**（能力缺口，影响小）          | 授权规则无法对超长 bash 命令精确匹配                                                                                                                                                |
| 16  | `parsePlugin` 不读 `plugin.json` 里自定义的组件路径；agent 的 `tools` 不被消费                                   | **引擎**（能力缺口，阶段 B 才会遇到） | `stdlib/parsers/parse-plugin.ts:90-140`                                                                                                                                             |
| 17  | 设计文档与代码有几处不一致                                                                                       | **引擎**（文档）                      | `McpServerSpec.args`、`PrepareCtx`、skill 重复激活的返回值、`adaptHooks` 签名                                                                                                       |
| 18  | MCP 工具名不带前缀、凭据 `envFromAccount` 从未生效、token 明文存储、第一步展开全部 MCP、Feature 工具被白名单挡掉 | **Talor 原有缺陷**                    | §1.3 的 T1–T5、T8                                                                                                                                                                   |

**结论**：

- 实测看到的问题（第 1–12 条）都是 **Talor 调用的问题**：引擎已有对应机制，P1 没接或接错。
- 引擎的问题集中在第 13–17 条，都不在这次实测的主路径上：第 13 条会在接入 MCP 后立刻遇到，其余是能力缺口或文档问题。
- 第 18 条是 Talor 旧路径本身的缺陷，迁移时不照搬。

---

## 2. 设计原则

1. **来源、目录、选择归 Talor，承载与使用归引擎**：连接、凭据解析、熔断、渐进加载、委托限额、工具呈现，一律用引擎的标准能力与宿主。Talor 不再维护第二套。
2. **单一事实来源**：一个 agent 这一轮能做什么，只由能力目录加 profile 算一次。prompt 不写死工具名，界面不读旧注册表。
3. **扩展只有一种形态**：Feature（代码形态）与插件（目录形态）都是扩展包，向目录贡献同样几类条目。
4. **组织规矩只在执行环境里**：须知、权限、审批、hook 都挂在执行环境上，不进 agentPrompt。
5. **迁移不倒退**：逐轮按能力覆盖分派；旧路径在切换之前保持原样。

---

## 3. 目标架构

### 3.1 概念模型

```
来源 ──注册──▶ 能力目录 ──按 profile 选择──▶ Agent（引擎能力）──┐
 内置工具 / MCP 配置 / skill 目录 /                           ├─▶ 运行（执行环境 × Agent × 任务）
 用户 agent / Feature / 插件                                  │
                         └──贡献 hook、须知──▶ 执行环境 ──────┘
宿主（跨运行共享）：MCP 连接池、skill 宿主、委托宿主、hook 执行器、凭据库
```

### 3.2 能力目录：每轮一次的快照

```ts
interface CatalogSources {
  builtins(): ToolDefinition[]
  mcpServers(): MCPServer[]
  skills(): ParsedSkill[]
  agents(): CatalogAgent[] // 业务 agent 及其 Feature 工具
}

interface CatalogSnapshot {
  readonly version: string // 来源内容的哈希
  readonly builtins: ToolDefinition[]
  readonly mcpServers: McpCatalogEntry[] // { id, name, slug, spec }，只含启用的
  readonly skills: ParsedSkill[]
  readonly agents: CatalogAgent[]
  select(profile: AgentProfile): AgentCapabilities // 按 §3.5 的选择规则，另给出 missing
}

catalogSnapshot(sources: CatalogSources): CatalogSnapshot
```

- **为什么是快照**：来源（`mcp_servers` 表、`AgentManager`、平台 skill 注册表）本来就是最新的。每轮读一次、按内容算版本，`agentFor` 的缓存就会跟着来源变。这样不需要变化事件，也不需要在设置页、agent 编辑等处逐一通知刷新。
- **来源**：
  - 内置工具读 `toolRegistry`；
  - MCP 读 `mcp_servers` 表；
  - skill 读平台 skill 注册表；
  - agent 读 `AgentManager` 的业务 agent，Feature 工具由 `getFeatureTools` 给出；
  - 插件的 skill、agent、MCP 在 B1 加入同一组来源；hook 与 command 条目在 B 加入。
- **能力覆盖**（`coverage`）在 A5 做，那时逐轮分派才用到。
- **`slug`**：MCP 服务器在模型面前的前缀，也就是引擎规格里的 `name`。由服务器名规整而来，只保留 `[A-Za-z0-9_-]`，并保证唯一。显示名仍然用原来的 `name`。这样前缀既满足各厂商对工具名的限制，也和 hook 匹配用的 `mcp__<server>__<tool>` 一致。

### 3.3 来源 → 引擎能力的映射

| 来源         | 引擎能力                                                                        | 关键规则                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 内置工具     | `tools(defs, { id: 'builtin' })`                                                | P1 的 `toEngineTool` 保留：访问路径声明、风险、`validate`、失败分类。`request_continuation` 不映射，由完成审查取代                                                                                         |
| MCP 服务器   | 每个服务器一个 `mcp(spec)`，`exposure: 'deferred'`                              | 规格按服务器生成，不带每个 agent 的工具过滤，所有 agent 共用同一个连接池条目。传输：stdio 的 `command`、`args`、`env`；http 的 `url`、`headers`。凭据全部是 `SecretRef`，见 §3.7                           |
| skill        | 每个 skill 一个 `skill(pkg)`                                                    | `pkg.description` = description，再接上"使用时机：when_to_use"。`pkg.content` 是正文，相对链接改写为绝对路径（沿用 `skills/skill-tool.ts:14-23`）。引用文件经沙箱对 skill 根目录的只读授权，用 `read` 读取 |
| 业务 agent   | 每个可委托目标一个 `subagent(agentFor(profile), { name, description, budget })` | 目标集合：`allowAny` 时为全部可委托的 agent（平台 agent 除外），否则为 `ids`。`budget.maxTotalMs` 取委托配置的 `executionTimeoutMs`（引擎要求子运行设时长上限）                                            |
| Feature 工具 | `tools(defs, { id: 'feature:<featureId>' })`，只给该 Feature 的 agent           | 不受内置工具白名单约束（修 T5）                                                                                                                                                                            |
| 插件         | 拆成 skill、agent、MCP、hook、command，各自按本表进入目录                       | 见 §3.4                                                                                                                                                                                                    |
| 意图工具     | `intents()`                                                                     | 阶段 C 加入，取代 talor 块                                                                                                                                                                                 |

### 3.4 扩展包：Feature 与插件

- **插件目录**：`~/.talor/plugins/<名字>/`，采用 Claude Code 插件格式，由 `parsePlugin(dir)` 解析。启用列表放在配置 `plugins.enabled: string[]`，未启用的不进目录。
- **解析产物的去向**（与引擎设计 §4.2 的插件表一致）：

  | 产物         | 进入                                                                                         |
  | ------------ | -------------------------------------------------------------------------------------------- |
  | `skills`     | 目录的 skill 条目，名字加插件前缀，避免与平台 skill 冲突                                     |
  | `agents`     | 目录的 agent 条目。frontmatter 的 `tools` 映射为 `profile.tools`；不认识的工具名丢弃并记警告 |
  | `mcpServers` | 目录的 MCP 条目。`${VAR}` 已被解析为 `SecretRef`，由凭据库按 `env:<VAR>` 解析                |
  | `hooks`      | 目录的 hook 条目，经 `adaptHooks` 进入执行环境（§3.6）                                       |
  | `commands`   | 目录的 command 条目，渲染端作为斜杠命令，展开后成为任务输入                                  |

- **Feature 的位置**：Feature 是代码形态的扩展包，可以贡献 agent、工具、产物读取口和 IPC。前两者进目录，后两者保持现状。
- **导入导出**：MCP 配置的导入导出改用 `.mcp.json` 格式（`{ mcpServers: {…} }`），经引擎的 `parseMcpConfig` 解析，与 Claude Code 兼容。

### 3.5 Agent 装配

```
agentFor(profile) =
  defineAgent({
    id: engineAgentId(profile.id),
    instructions: [agentPrompt],                 // 目标驱动，不点名工具
    capabilities: [
      tools(内置工具 ∩ 选择),
      ...选中的 MCP 服务器.map(mcp),
      ...选中的 skill.map(skill),
      ...委托目标.map(subagent),
      ...该 agent 的 Feature 工具,
    ],
  })
```

- **选择规则**：沿用旧路径的语义，迁移不改变任何 agent 的能力集合。

  | profile 字段 | 不声明时              | 声明时                      |
  | ------------ | --------------------- | --------------------------- |
  | `tools`      | 全部内置工具          | 声明的工具 ∪ 4 个只读工具   |
  | `mcpServers` | 全部 MCP 服务器       | 按名字过滤                  |
  | `skills`     | 无；平台 agent 为全部 | 按名字过滤                  |
  | `subagents`  | 无                    | `ids`，或 `allowAny` 时全部 |

- **缓存键**：`hashOf(profile, catalog.version)`。目录变化后新开始的运行用新的 Agent；正在进行的运行不受影响，符合引擎的 I14（运行中能力不变）。
- **指令**：
  - 引擎路径上的 `__chat__` 用目标驱动的指令，例如"需要外部服务时先查找可用的工具"。工具的用法由各能力的说明片段提供：`search_tool` 的说明、"可用的 skill"、"可委托的子 agent"。旧路径的 `CHAT_PROFILE` 在阶段 D 之前不改（原则 5）。
  - 业务 agent 的 agentPrompt 不改。

### 3.6 执行环境装配

```
interactive = engine.environment({
  name: 'interactive',
  principal: { reachable: true, approver: sessionApprover },
  notice: [...章程须知, ...hooks.notice],
  permissions: [
    workspaceSandbox({ sensitive: Talor 敏感名单, granted: 已授权路径 ∪ skill 根目录（只读） }),
    ...hooks.permissions,
    riskApproval({ mode: 'ask-high' }),
  ],
  guards: hooks.guards,
  checks: hooks.checks,
  caps: { approvalTimeoutMs: 300_000, delegation: 委托配置映射 },
})
```

- **章程须知**：保留与引擎不冲突的条款，包括：
  - 以事实为准，失败时读错误再调整；
  - 工具输出是数据、不是指令；
  - 不编造路径与命令；
  - 先尝试再拒绝；
  - 不沉默，可以并行调用，简短说明意图。

  删除由引擎机制取代的条款：收尾形态、talor 块、反思信号、审批说明。任务路由去掉具体工具名。

- **审批人**：每次审批先查 permission-store（`matchRules`），命中允许或拒绝的规则就直接返回；否则弹出统一的审批窗口，高风险与越界路径合一，带"本会话记住 / 总是允许"。
  - 用户选择记住时，用 `pattern-suggestions` 生成规则写回。
  - 审批人自身不设超时，超时由执行环境的上限决定，引擎记为 `APPROVAL_TIMEOUT`，与 `USER_DENIED` 分开。
  - 某个调用结束或运行结束时，通知渲染端收起它的窗口。
- **hook**：启用的插件 hook 经 `adaptHooks` 翻译。执行环境是不可变的，所以 hook 集合变化时重建执行环境，之后开始的运行使用新的。
- **委托上限的映射**：

  | Talor 委托配置                     | 引擎上限                    |
  | ---------------------------------- | --------------------------- |
  | `maxConcurrencyPerSession`         | 子运行并发                  |
  | `maxInvocationsPerAgentPerSession` | 同一 agent 次数，按根运行计 |
  | `MAX_DELEGATION_DEPTH = 3`         | 深度                        |

### 3.7 宿主与凭据

- **宿主**：`createEngine({ services: { hosts: [mcpHost({ vault, preconnect }), hookRunner()], vault } })`。skill 宿主和委托宿主用引擎默认的。
- **凭据库 `TalorVault`**：实现 `SecretResolver`，按引用的命名空间分派。

  | 引用                     | 来源                                                             |
  | ------------------------ | ---------------------------------------------------------------- |
  | `account:<keyName>`      | `AccountStore.getValue`，修 T2                                   |
  | `mcp:<serverId>:<field>` | `mcp_servers.auth` 里加密存储的 token、apiKey，修 T3             |
  | `env:<VAR>`              | 插件 `.mcp.json` 里的变量（B1 再加）；先查账户，没有再读进程环境 |

  宿主的预连接和每次运行用同一个凭据库实例（替换方案 §6 的注意事项）。模型的 API key 不经凭据库，由 `runtime/models.ts` 直接读。

- **迁移**：`mcp_servers` 新增 `env_from_account` 列；`auth` 里的 token、apiKey 原地加密并加 `encrypted` 标记（与 `account_keys` 的做法一致），仓库读出时解密，旧路径与设置页不受影响。`name` 不加唯一约束：IPC 已拒绝重名，历史重名由 slug 加序号消化。slug 每次由服务器列表计算，不落库。
- **共存期的 MCP 连接**：切换之前，旧路径的 `mcpRegistry` 仍在启动时连接全部服务器。`runtime` 为 `'engine'` 时，引擎的 MCP 宿主在启动时预连接启用的服务器，应用退出时随引擎关闭。两套客户端会让同一个 stdio 服务器各起一个进程；这在阶段 D 删除旧客户端后消失。

### 3.8 执行链路（一次 `chat:send`）

| 环节     | 承载者                      | 说明                                                                                     |
| -------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| 分派     | `TurnDispatcher`            | 按 `catalog.coverage(snapshot)` 逐轮选择链路（§4）                                       |
| Agent    | `agentFor`（§3.5）          | 能力来自目录快照                                                                         |
| 执行环境 | `interactive`（§3.6）       | 目录或 hook 变化时重建                                                                   |
| 任务     | `taskFor` + `HistoryPolicy` | P1 已有；跨轮摘要在阶段 C 加入                                                           |
| 模型     | `talorModels`               | P1 已有；`request_timeout_ms` 映射在阶段 A                                               |
| 投影     | `RunProjector`              | 子运行投影为子会话（阶段 A4）；过程与答复、核对中、推理流（阶段 C）                      |
| 生命周期 | `RuntimeLifecycle`          | 退出时 `engine.shutdown()`；启动时 `engine.interrupted()` 收尾并在会话标注；用量逐步记录 |

### 3.9 模块与依赖

```
runtime/
  catalog/        目录与来源适配器：builtin、mcp、skills、agents、features、plugins
  extensions/     扩展包：插件目录、启用列表、parsePlugin 的去向；Feature 端口
  assembly/       agent.ts、environment.ts、notice.ts、task.ts、history-policy.ts、tools.ts
  ports/          models.ts、vault.ts、approver.ts
  projection/     protocol.ts、persistence.ts、children.ts（子会话）、usage.ts
  orchestration/  engine.ts、dispatch.ts、turn.ts、lifecycle.ts
```

- **依赖方向**：`ipc → orchestration → assembly / projection → catalog / extensions / ports → repos / store / 平台注册表`。
- `runtime/` 只经包入口 `agent-engine` 引用引擎。界面的能力计数、MCP 状态、Trace 都经 `orchestration` 的 IPC 提供。

---

## 4. 迁移与共存

- **三档开关**：`runtime: 'off' | 'auto' | 'force'`。
  - `auto` 时，`TurnDispatcher` 只在 coverage 完整时走引擎；
  - coverage 按目录条目的种类判断，阶段 A 每完成一类就纳入一类。
- **数据兼容**：
  - messages 表格式不变（P1 已保证新旧路径互读）；
  - `mcp_servers` 迁移见 §3.7；
  - 运行档案独立存放在 `~/.talor/runs.db`。
- **回退**：任何阶段把开关设为 `off`，即完全回到旧路径。

---

## 5. 引擎侧改动

| #   | 改动                                                                                                | 是否需要                                                                                        |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| E1  | MCP 工具结果 `isError` 允许按服务器或按工具声明错误类别，确定性的业务失败不再被当作瞬时错误重试一次 | 已完成（引擎 F21：`McpServerSpec.errorClass`）；Talor 暂无配置来源，需要时给 `mcp_servers` 加列 |
| E2  | 审批请求携带完整的调用输入与 `access`，供授权规则精确匹配                                           | 可选：不做时审批人用预览匹配，超长命令退回弹窗                                                  |
| E3  | MCP 连接池键改为服务器身份（名字 + 传输），工具过滤在租约层面应用                                   | 暂不需要：§3.3 规定规格不带每个 agent 的过滤                                                    |
| E4  | `parsePlugin` 支持 `plugin.json` 中自定义的组件路径                                                 | 阶段 B 遇到再做                                                                                 |
| E5  | skill 的引用文件由引擎直接提供                                                                      | 不做：Talor 用"改写链接 + 只读授权"解决                                                         |
| E6  | MCP 能力规整或跳过不符合厂商格式（`^[A-Za-z0-9_-]{1,64}$`）的工具名                                 | 建议：`<slug>__<工具名>` 超长或含点号时，展开后整个请求会被厂商拒绝                             |

---

## 6. 分阶段

| 阶段             | feature             | 内容                                                                                                                                                | 完成标志                                                                     |
| ---------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **A 能力平台**   | A1a 凭据与 MCP 规格 | `mcp_servers` 迁移（`env_from_account`、凭据加密）；slug 与 `toMcpSpec`；`TalorVault`                                                               | 规格经引擎 MCP 宿主建连时拿到正确的凭据；旧路径与设置页不变                  |
|                  | A1b 能力目录        | 能力目录（builtin、MCP、skill、agent、Feature）与按 profile 选择                                                                                    | 目录与旧注册表给出的能力集合一致（对齐测试）                                 |
|                  | A2 Agent 装配 v2    | MCP（`deferred` + `searchExposure`）、skill、Feature 工具；`__chat__` 指令改写；缓存键含目录版本                                                    | 在 `auto` 下 `__chat__` 走引擎；实测能通过 `search_tool` 找到并调用 MCP 工具 |
|                  | A3 执行环境 v2      | 章程须知；审批人 v2；沙箱授权（已授权路径 + skill 根目录）                                                                                          | 记住的授权不再询问；超时与拒绝可区分；须知生效                               |
|                  | A4 委托             | `subagent` + 委托宿主；子运行投影为子会话；委托上限映射                                                                                             | 委托场景的对齐测试通过                                                       |
|                  | A5 分派与生命周期   | 三档开关、coverage；退出关闭、中断收尾、逐步用量；界面计数读目录；`request_timeout_ms`                                                              | 在 `auto` 下没有任何会话比旧路径少能力                                       |
| **B 扩展包**     | B1 插件             | 插件目录与启用列表；`parsePlugin` 的去向；`.mcp.json` 导入导出                                                                                      | 一个 Claude Code 格式的插件装上后，其 skill、agent、MCP 可用                 |
|                  | B2 hook             | `hookRunner` 宿主；`adaptHooks` 进入执行环境；hook 变化时重建执行环境                                                                               | 各 hook 事件的行为符合引擎设计 §9.10                                         |
| **C 协议与观测** | —                   | 过程与答复、核对中、推理流；意图工具取代 talor 块；Trace 读运行档案；跨轮摘要                                                                       | 渲染端各状态正确                                                             |
| **D 切换与删除** | —                   | 缺省改为 `force`；设置页 MCP 状态改读引擎宿主的健康状态；删除 `mcp/`、`skills/skill-tool`、`delegate-agent`、`loop/`、`prompt/`、`memory/` 等旧实现 | 对齐清单全部通过；旧代码零引用                                               |

阶段 A 中，A1（A1a、A1b）是其余四个的前提；A1a 改持久化数据，A1b 只在内存里组装，分开验收；A2、A3、A4 互相独立；A5 最后做。

---

## 7. 验证

| 层级                                               | 内容                                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单元                                               | 来源适配器；选择规则与旧白名单逐条一致；MCP 规格映射（slug、`SecretRef`）；凭据库按命名空间解析；审批人的允许、拒绝、询问、记住、超时；插件产物的去向 |
| 集成（内存数据库 + `fakeModel` + `fakeMcpServer`） | 对齐测试：同一组场景在两条链路上各跑一遍，比较 messages 行与渲染端事件；MCP 经 `search_tool` 展开；委托与子会话；hook 拦截                            |
| 端到端（真实 Electron，隔离数据目录）              | 脚本开头 `app.setPath('home', …)` 并校验，前后比对真实 `~/.talor` 的哈希；用 DeepSeek 与一个本地 stdio MCP 服务器跑对齐清单里标 ★ 的场景              |
| 手动                                               | 在应用里按对齐清单逐项操作                                                                                                                            |

---

## 8. 不做与去向

| 不做                                                          | 去向                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| 保留 Talor 自研的 MCP 传输、注册表与 `McpExposureState`       | 由引擎的 MCP 宿主与 `searchExposure` 取代，阶段 D 删除  |
| 保留 `delegate_agent` 的 `context` 参数与自动附带父会话上下文 | 引擎的委托只传 task 文本，由模型把需要的上下文写进 task |
| 在引擎路径复刻检测器、反思器、强制总结                        | 由引擎守卫、完成审查、兜底交付取代                      |
| 保留两种审批窗口                                              | 合并为一个，规则仍存在 permission-store                 |
| 每个 agent 的 MCP 工具级过滤                                  | 现有 profile 没有这个字段；需要时再做 E3                |
| 批量改写业务 agent 的 agentPrompt                             | 由分派保证不倒退，改写交给各业务 agent 自己             |
