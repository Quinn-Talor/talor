# Talor 工程规范

本文档只定义**规则**。每条规则给出：规则描述、违反后果、参考依据（file:line）、跨引到 `patterns.md` 对应模式。

**三档分级**：

- **MUST**：违反破坏正确性、安全性或审计完整性。新代码必须遵守；存量偏离需标注。
- **SHOULD**：普遍遵守（实施率 ≥75%），违反需在 commit / PR 中说明理由。
- **NEVER**：反模式，对应有事故场景或明确陷阱。

**跨引格式**：`→ patterns.md §PN` 指向模式编号；`→ 此文件 X-MUST-N` 指向本文其他条目。

---

## A. 分层与依赖

### A-MUST-0 · LLM 与 系统擅长原则，必须遵守

LLM擅长推理/判断，系统负责执行/兜底，各自做擅长的事情，协作解决用户输入问题。

### A-MUST-1 · 业务层与基础设施层文件必须带头部注释

头部含三信息：**路径 + 所在层 + 一句话职责**。

- 依据：`src/main/tools/registry.ts:1`、`src/main/chat/orchestrator.ts:1`、`src/main/chat/stream-registry.ts:1`
- 违反后果：读者需从 `import` 逆推文件职责，review 效率下降
- → `patterns.md` §P7

### A-MUST-2 · 跨层依赖必须在文件头声明"允许依赖 / 禁止依赖"

Talor 无 lint 规则强制分层，注释是唯一契约。

- 依据：`src/main/chat/orchestrator.ts:6-8`、`src/main/chat/attachments.ts:8-9`、`src/main/agent/variable-resolver.ts:5-6`、`src/main/ipc/mcp.ts:2`
- 违反后果：下次重构会有人无意跨层 import
- → `patterns.md` §P7

### A-NEVER-1 · 业务层禁止从 `ipc/` 做运行时 import

仅允许从 `ipc/` 做纯 type import（`ToolConfirmPort`、`ChatErrorCode`）。

- 依据：`src/main/chat/orchestrator.ts:8`、`src/main/chat/stream-registry.ts:8`
- 违反后果：IPC 层与业务层双向耦合，难测试、难拆分

### A-NEVER-2 · `repos/` 与 `db/` 层禁止抛出业务异常

无结果返回 `null`，是否变更返回 `boolean`。

- 依据：`src/main/repos/session-repo.ts:115-119`
- 违反后果：repo 越权决定"何为业务错误"；调用方难以组合
- → `patterns.md` §P3

### A-SHOULD-1 · 业务层之间保持"同层横向"或"向下纵向"依赖

`chat/` 可依赖 `tools/`，但 `providers/` 不应反向依赖 `chat/`。

- 违反后果：出现隐性环依赖，构建顺序混乱

---

## B. 类型系统

### B-MUST-1 · 对外 API 禁用 `any`，外部输入用 `unknown` + narrow

- 依据：`src/main/tools/registry.ts:84-87`、`src/main/tools/types.ts:isToolErrorEnvelope`
- 违反后果：类型边界失守，静态检查降级为"心智保证"

### B-MUST-2 · 公共泛型类型提供默认值

例：`ToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny>`。

- 依据：`src/main/tools/types.ts`（ToolDefinition）
- 违反后果：import 点爆发大量 `<unknown>` 手动标注

### B-MUST-3 · 类型守卫命名 `isXxx` 且返回 `value is T`

- 依据：`src/main/tools/types.ts:isToolErrorEnvelope`、`src/main/tools/path-guard.ts:41`、`src/renderer/types/chat.ts:isTextPart`
- 违反后果：narrow 能力丢失，后续代码需重复类型断言

### B-SHOULD-1 · 业务 DTO 用 `interface`，union / discriminated 用 `type`

- 依据：`src/shared/types/agent.ts` / `src/shared/types/permissions.ts`（interface）；`src/main/tools/path-guard.ts:36-39`、`src/main/loop/react-loop.ts:LoopExitReason`（type）
- 实施率：~95%

### B-NEVER-1 · 禁止对未经校验的外部输入使用 `as` 断言

IPC、文件、LLM、MCP 输入必须先 Zod / schema-check / 手写 narrow 后再收敛类型。

- 依据：`src/main/tools/registry.ts:113`（`validatedInput = parsed.data`）
- 违反后果：类型系统与运行时数据脱节，潜在 crash / 越权
- → `patterns.md` §P1

### B-NEVER-2 · 禁止使用 TypeScript `enum`

用字符串字面量 union 或 `as const` 对象替代。

- 依据：全工程 0 处 enum；`riskLevel: 'HIGH' | 'LOW'`、`LoopExitReason` 均字面量 union
- 违反后果：enum 生成运行时代码、影响 tree-shaking、`const enum` 与打包器有兼容陷阱

---

## C. Import 与命名

### C-MUST-1 · React 组件文件 PascalCase，Props 接口 `XxxProps`

- 依据：`src/renderer/components/MessageBubble.tsx:29`、16 个组件 100% 遵守
- 违反后果：命名漂移，IDE 跳转混乱

### C-MUST-2 · 文件命名规则：导出顶层 class 同名时用 PascalCase，否则 kebab-case

- 依据：
  - PascalCase（class 同名）：`PromptPipeline.ts`、`ShortTermMemory.ts`、`MemoryManager.ts`、`KnowledgeBase.ts`
  - kebab-case：`react-loop.ts`、`path-guard.ts`、`build-tools.ts`、`stream-utils.ts`
- Zustand store：`camelCase + Store.ts`（`chatStore.ts`、`uiStore.ts`）

### C-SHOULD-1 · Import 顺序：第三方 → 相对路径 → `@shared` 别名

`import type` 单独成组。

- 依据：`src/main/tools/registry.ts:7-15`、`src/main/chat/orchestrator.ts` 头部
- 实施率：~75%，主进程更一致

---

## D. IPC 协议

### D-MUST-1 · IPC channel 名必须 `module:action` 或 `module:submodule:action` 格式

- 依据：40+ handler 100% 一致，例：`providers:list`、`mcp:servers:create`、`chat:send`、`config:save`
  - `src/main/ipc/providers.ts:12-222`
  - `src/main/ipc/mcp.ts:23-239`
- 违反后果：前端 invoke 时无法凭命名推断，协议文档爆炸

### D-MUST-2 · IPC handler 首参数 `_event` 强制前缀下划线

- 依据：`src/main/ipc/providers.ts:17` `(_event, input)` 全局一致
- 违反后果：lint 噪声；reviewer 无法一眼看出"此参数不用"

### D-MUST-3 · IPC handler 不得实现业务逻辑

handler = 解析参数 → 调业务层 → 格式化返回。

- 依据：`src/main/ipc/chat.ts` 委派 `orchestrator.sendChat`；`src/main/ipc/mcp.ts` 委派 repo / registry
- 违反后果：业务逻辑散落在入口层，业务层测试失去意义
- → `patterns.md` §P7

### D-NEVER-1 · IPC handler 不得向前端抛异常

必须 catch → 分类 → 返回结构化错误码。

- 依据：`src/main/ipc/error-codes.ts:39-58 classifyLlmError`
- 违反后果：前端无法区分错误类型；用户看到序列化后的 Error stack
- → `patterns.md` §P3

---

## E. Repo 层

### E-MUST-1 · Repo 方法命名遵循 `list / create / getById / update<Field> / delete` CRUD 约定

- 依据：`src/main/repos/session-repo.ts:86-167`、`src/main/repos/mcp-server-repo.ts:57-172`（100% 一致）
- 违反后果：多 repo 风格漂移，onboarding 成本上升
- → `patterns.md` §P5

### E-MUST-2 · Repo 返回值约定

| 方法                     | 语义                             |
| ------------------------ | -------------------------------- |
| `list()`                 | 返回 `T[]`，空时 `[]`            |
| `getById(id)`            | 返 `T \| null`，无结果 null 不抛 |
| `update<Field>(id, val)` | 返 `T \| null`，不存在返 null    |
| `create(params)`         | 返新实体                         |
| `delete(id)`             | `void` 或 `boolean`              |

- 依据：同上
- 违反后果：调用方需猜测错误语义，增加 defensive code

### E-MUST-3 · Repo 的 create / update / delete 必须 `log.info` 记录

格式：`[RepoName] <Action> <entity>: <id>, <ctx>`。

- 依据：`src/main/repos/session-repo.ts:102/109/134/144/165`
- 违反后果：数据异常后无写入审计线索
- → `patterns.md` §P8

### E-MUST-4 · 批量写入必须使用 `db.transaction`

尤其是 SDK 配对约束的记录（assistant tool_use + tool result）。

- 依据：`src/main/repos/session-repo.ts:205-231 createBatch`
- 违反后果：进程崩溃时孤儿 tool_use，整个 session 永久破坏
- → `patterns.md` §P6

### E-NEVER-1 · Repo 层禁止包含 LLM / 网络调用

Repo 只做 DB I/O。需要 LLM 辅助的（title 生成、摘要）放业务层。

- 依据：`src/main/memory/ShortTermMemory.ts` 在业务层而非 repo

### E-NEVER-2 · Repo 层禁止做权限 / 授权检查

权限属业务层职责（`permissions/port.ts` + `tools/path-guard.ts`）。

---

## F. 工具与参数校验

### F-MUST-1 · 内置工具必须用 Zod 声明 schema；`parameters` 由 `z.toJSONSchema` 派生

单一事实源保证运行时校验和 LLM 可见的 JSON Schema 不漂移。

- 依据：7 个内置工具 100% 采用（`src/main/tools/builtin/*.ts`）
- 违反后果：两处 schema 必然渐进偏离；模型会因两者不一致产生幻觉
- **例外**：MCP 远端工具 schema 无法 Zod 化，走 `src/main/tools/schema-check.ts` fallback
- → `patterns.md` §P1

### F-MUST-2 · 工具必须遵循 4-Phase 校验分层

| Phase                 | 职责                            |
| --------------------- | ------------------------------- |
| 1. Zod / schema-check | 结构 + 类型 + enum + refine     |
| 2. `tool.validate`    | 需要 context 的业务规则（同步） |
| 3. `tool.execute`     | 执行                            |
| 4. `tool.verify`      | 输出审查（可 block）            |

- 依据：`src/main/tools/registry.ts:97-170`
- 违反后果：同一规则在多层重复；层间漂移
- → `patterns.md` §P1

### F-MUST-3 · 工具错误输出必须用 `ToolErrorEnvelope`

- 依据：`src/main/tools/types.ts:ToolErrorEnvelope`、`src/main/loop/stream-utils.ts:103-111`
- 违反后果：`isError` 漏报 → 死循环检测失效 → 模型重复调用失败工具
- → `patterns.md` §P2

### F-MUST-4 · `tool.verify` `severity: 'block'` 或抛异常时不得回退 rawOutput

必须转为 VERIFY_BLOCKED / VERIFY_CRASH 信封。

- 依据：`src/main/tools/registry.ts:153-180`
- 违反后果：幻觉检测被静默绕过
- → `patterns.md` §P9

### F-NEVER-1 · 工具禁止在 `execute` 里重复 schema 校验

Zod 已锁定结构与类型，再写一遍必然漂移。

- 违反后果：DRY 违规 + 规则漂移风险

### F-NEVER-2 · 高风险工具不得绕过前置黑名单

bash 的危险命令黑名单、path-guard 的敏感路径必须前置拦截，不靠用户 confirm 把关。

- 依据：`src/main/tools/builtin/bash.ts:47-52 isCommandDangerous`、`src/main/tools/path-guard.ts:9-22 SENSITIVE_PATHS`
- → `patterns.md` §P4

---

## G. 错误与异常

### G-MUST-1 · 外部错误必须在 boundary 处分类

网络 / LLM / fs 异常在 IPC 边界经 `classifyLlmError` 映射为 `ChatErrorCode`。

- 依据：`src/main/ipc/error-codes.ts:39-58`
- 违反后果：前端无法差异化 UX；未分类异常透传到 UI
- → `patterns.md` §P3

### G-MUST-2 · `try/catch` 必须 `log.error` 或 `log.warn`，不得静默吞异常

- 依据：`src/main/mcp/client.ts:172-177`、`src/main/tools/registry.ts:141-148`
- 违反后果：事故发生无追溯线索

### G-SHOULD-1 · 异步错误用 `try/catch`，不用 `.then / .catch` 链

- 依据：全工程未见 `.then(...).catch(...)` 组合
- 违反后果：风格漂移；错误捕获边界模糊

### G-SHOULD-2 · 业务错误作返回值传递，不向上层抛

`{ ok: false, error }` 或 `output: envelope`。

- 依据：`src/main/tools/builtin/*` 的 validate / execute、`src/main/mcp/client.ts` 的异常转信封
- → `patterns.md` §P2

### G-NEVER-1 · 禁止无意义重抛（`catch (e) { throw e }`）

违反后果：增加堆栈噪声，无任何价值

### G-NEVER-2 · 禁止用字符串 `includes / startsWith` 匹配错误消息做业务分支

要么用 `instanceof`，要么结构化错误（Envelope / Code）。

- 违反后果：下游库文案变化时静默断裂
- **例外**：`src/main/ipc/error-codes.ts`、`src/main/loop/stream-utils.ts:ERROR_OUTPUT_PATTERNS` 是兼容层，新代码不得走此路径

---

## H. 并发与生命周期

### H-MUST-1 · 所有可能长耗时的操作必须接受 `AbortSignal`

LLM 调用、子进程、文件扫描、MCP 请求。

- 依据：`src/main/tools/types.ts:ToolExecuteContext.abortSignal`、`src/main/tools/builtin/bash.ts:180-183`、`src/main/loop/stream-utils.ts:120-122 buildStreamSignal`
- 违反后果：用户"停止"无效；僵尸子进程

### H-MUST-2 · 多来源 AbortSignal 必须用 `AbortSignal.any([...])` 合并

- 依据：`src/main/loop/stream-utils.ts:120`
- 违反后果：手动监听多个源容易泄漏 listener

### H-MUST-3 · `setTimeout` 必须配对 `clearTimeout`；可能延长进程的用 `.unref()`

- 依据：`src/main/tools/builtin/bash.ts:163 setTimeout(hardKill, 2000).unref()`
- 违反后果：进程无法正常退出；内存泄漏

### H-SHOULD-1 · 长循环定期检查 `abortSignal.aborted` 提前退出

- 依据：`src/main/loop/react-loop.ts:540-542`
- 违反后果：用户中止后循环仍跑完上限

---

## I. 持久化

### I-MUST-1 · SDK 配对约束的多行写入必须同事务

- 依据：`src/main/loop/react-loop.ts:334-338` 使用 `messageRepo.createBatch`
- 违反后果：Vercel AI SDK rebuild prompt 时抛 "Every tool_use must have a tool_result"，session 永久破坏
- → `patterns.md` §P6

### I-MUST-2 · DB schema 变更必须伴随迁移代码

- 依据：`src/main/db/index.ts`
- 违反后果：老 session 启动后随机 crash

### I-SHOULD-1 · 存在性判断用 `info.changes` 而非"先查后写"

- 依据：`src/main/repos/session-repo.ts:106-113`
- 违反后果：多一次查询，race 窗口

---

## J. Prompt 与 LLM 交互

### J-MUST-1 · 工具输出必须用 `<tool_output tool="...">` XML 包裹

Skill 内容例外：加 `trust="skill-content"`。

- 依据：`src/main/loop/stream-utils.ts:145-157 wrapToolOutput`、`src/main/prompt/plugins/SystemPlugin.ts:60-63`
- 违反后果：Prompt injection — 工具返回文本被 LLM 当新指令执行
- → `patterns.md` §P4

### J-MUST-2 · 关键 prompt 插件失败必须 throw；非关键 degrade

`CRITICAL_PLUGIN_NAMES = { SystemPlugin, AgentPromptPlugin, MemoryPlugin, MessagePlugin }`。

- 依据：`src/main/prompt/PromptPipeline.ts:24`、`:91-109`
- 违反后果：system prompt 缺失后模型裸奔；不响亮失败让问题继续传播
- → `patterns.md` §P9

### J-MUST-3 · Fallback 摘要的 ≥20 字节长引用必须经 `verifyQuotedFacts` 校验

未命中替换为 `⟨unverifiable⟩`。

- 依据：`src/main/loop/react-loop.ts:runFallbackSummary`、`src/main/loop/quote-verifier.ts`
- 违反后果：兜底摘要编造工具结果内容
- → `patterns.md` §P4

### J-SHOULD-1 · 新增"模型正确性"防御，优先考虑代码强制而非 prompt 规则

- 案例：`EDIT_AMBIGUOUS_MATCH`、`⟨unverifiable⟩`、context ≥100% 硬阻断
- 违反后果：prompt 约束会被模型绕过，无机器保证
- → `patterns.md` §P4

### J-SHOULD-2 · LLM × 系统 协作模型 — 信任 LLM,系统兜底,各做擅长的事

**核心原则**:

- **LLM 擅长**: 推理 / 判断 / 自然语言 / 语义理解
- **系统擅长**: 执行 / 校验 / 兜底 / 审计 / 事实核对(基于运行时真相数据)

两类典型职责越界(任何新代码 / PR 都要自查):

1. **系统抢 LLM 活** — 用 regex 做语义判断,不强制只软建议 → 两边不靠岸
2. **LLM 担系统责任** — 强制 LLM 守 streaming 解析便利的约定 → 负担反而降低遵从度

#### 协作矩阵(canonical reference)

| 决策点              | LLM 主责           | 系统主责                           |
| ------------------- | ------------------ | ---------------------------------- |
| 该不该调工具        | ✅                 | —                                  |
| 调哪个工具          | ✅                 | (提供列表)                         |
| 工具参数生成        | ✅                 | Zod / path-guard 校验              |
| 工具能否执行        | —                  | ✅(失败 → envelope 回流)           |
| 工具失败重试        | ✅(自适应)         | ✅(死循环兜底)                     |
| 声明副作用          | ✅(主路径)         | ✅(fallback regex 兜底)            |
| 副作用授权决策      | —                  | ✅(弹 confirm + 记忆)              |
| **该不该终止 turn** | ✅(无 tool 即终止) | **— 系统不强制纠正**               |
| 任务完成判断        | ✅                 | —                                  |
| 需要用户输入        | ✅(自然语言)       | —                                  |
| 任务被卡住          | ✅(自然语言)       | —                                  |
| UI 卡片样式         | 可选(主动 emit)    | ✅(推断兜底,**仅 UI 不回馈 loop**) |
| 事实引用准确性      | 推理               | ✅(verify-quote 核对)              |
| Context 预算        | —                  | ✅(monitor + halt)                 |
| Memory 压缩         | —                  | ✅(全权)                           |
| 跨 turn 状态        | —                  | ✅(持久化)                         |

#### 反模式表(代码 review 警报)

| 反模式                                      | 历史例子                                    | 处理                     |
| ------------------------------------------- | ------------------------------------------- | ------------------------ |
| 系统用 regex 判断 LLM "意图"(仅纠偏)        | `WaitAndAct` / `HallucinatedConfirm` (已删) | 不做 — 信任 LLM          |
| 系统强制 LLM 用特定语法格式(streaming 便利) | "type 必须 first key" (已删)                | 系统 parser 容忍         |
| 系统派生大量 LLM 输出衍生字段给 detector 用 | `hasDone/blocks/...` (已删)                 | LLM 自己负责             |
| Prompt 教模型严格 schema 然后代码不强制     | v3.6 Rule 13 强制 (已退化)                  | 退化 optional 或代码强制 |
| 系统判断"该不该终止"+ 强制纠正              | `no-marker-streak + forced-closure` (已删)  | "无 tool = 自然 final"   |
| Detector 注入 hint 教 LLM "你刚才错了"      | `PENDING_MARKER_HINT` (已删)                | 删                       |

#### 正模式表(职责清晰)

| 正模式                          | 例子                                        |
| ------------------------------- | ------------------------------------------- |
| LLM 声明意图,系统记录执行       | `pending_confirm` block + Ledger            |
| 系统遇错给结构化反馈,LLM 自适应 | `ToolErrorEnvelope` → LLM 读 hint 换策略    |
| 系统用真相数据校对 LLM 引用     | `verifyQuotedFacts` (有 tool output 可对照) |
| 系统监控资源边界,LLM 不感知     | context overflow / memory 压缩              |
| 系统计数硬阻断兜底死循环        | signature-dead-loop counter                 |
| UI 推断仅服务渲染,不回馈 loop   | `inferIntent` → `MessageBubble`             |

#### 何时该用代码强制 / 何时该信任 LLM

**该代码强制**(维度 A — 代码执行 / 安全):

- 副作用前授权(pending_confirm + RiskGate)
- 死循环阻断(signature-dead-loop / failure-streak)
- Token 预算保护(context overflow halt)
- 副作用审计(SideEffectLedger)
- 工具参数 schema 校验(Zod)
- 路径越权校验(path-guard)

**该信任 LLM**(维度 B — 输出意图 / 语义):

- 该不该 emit 收尾 marker
- 该用 talor `need_input` block 还是自然语言
- 该叙述还是直接给答案
- 在什么场合用 emoji / 列表 / 代码块

**判别速记**: 系统能用 runtime 真相数据(tool output / fs / memory)验证的事 → 代码强制;系统只能用 regex 猜测意图的事 → 信任 LLM。

- 依据(canonical): [docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md](../../docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md)
- 持续清理: [docs/superpowers/plans/2026-05-13-talor-v3.7.2-cleanup-residual.md](../../docs/superpowers/plans/2026-05-13-talor-v3.7.2-cleanup-residual.md)(删 A2/B2 残留 + RiskGate 路径统一)
- 前置: [docs/superpowers/plans/2026-05-13-talor-v3.7-fault-tolerance-rebalance.md](../../docs/superpowers/plans/2026-05-13-talor-v3.7-fault-tolerance-rebalance.md)
- → `patterns.md` §P13

### J-NEVER-1 · 禁止把硬约束仅写在 prompt 而代码里无兜底

Prompt 是软引导。凡"**必须**"级别的规则必须有代码实现。

#### 例外:LLM 自律规则 (self-discipline rules)

少数 prompt 规则**有意保留为软引导**,因为对应的代码强制会触发 §J-SHOULD-2 反模式表中的"系统抢 LLM 活"反模式 (例如:用 regex 抽 "I will" / "现在创建" 等意图短语 → 等同被删的 `WaitAndAct` / `HallucinatedConfirm`)。

这类规则必须满足:

1. **prompt 内显式自标**:在规则文本开头标注 "Self-discipline rule: not framework-enforced" 或同义语句,让 LLM 看到时就知道这条全靠自律。
2. **不当作 J-NEVER-1 违反**:不要求补一个 detector;补了就退回反模式。
3. **代码侧仍保留兜底 fallback** (针对"违反后果"而非"违反行为"):违反带来的最坏结果须有兜底——例如 Principle 9 "no silent exits" 由 `runForcedSummary` 兜底"整轮无文本"这一**结果**,而不是检测"该不该输出文本"这一**意图**。

| 规则                                    | 软引导原因                                                            | 兜底机制                                     |
| --------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------- |
| Principle 12 "Promise then call"        | 检测"promise"短语 = 系统替 LLM 判意图                                 | 无(用户可见,靠自律)                          |
| Principle 8 "Finish when task done"     | 检测"成功信号 + 继续工具调用" = 系统替 LLM 判任务完成                 | maxSteps 上限 + signature-dead-loop detector |
| Principle 11 "State intent before tool" | 检测"工具调用前是否有 text"逼模型 emit text = 退回 v3.6 RULE 0 反模式 | UI inferIntent 推断 (仅服务渲染,不回馈 loop) |

新增此类规则前先问:**违反后果由代码兜底了吗?** 兜底了再保留软引导;否则按 J-NEVER-1 处理。

### J-NEVER-2 · 禁止改动 LLM 返回的错误消息展示给用户

- 依据：`src/main/prompt/plugins/SystemPlugin.ts:46-48` Principle 3（Report failures verbatim）
- 违反后果：掩盖失败原因，用户无法判断问题

---

## K. 权限与安全

### K-MUST-1 · 所有文件路径必须经 `resolveToolPath` 返回三态结果

`sensitive` / `allowed` / `needs_consent`。

- 依据：`src/main/tools/path-guard.ts:54-69`、`src/main/tools/builtin/{read,write,edit,ls,grep}.ts` 100% 使用
- 违反后果：绕过 symlink 两阶段校验 → 越权；绕过敏感黑名单 → 泄漏
- → `patterns.md` §P4

### K-MUST-2 · 高风险工具（`riskLevel: 'HIGH'`）执行前必须 `confirmTool`

- 依据：`src/main/tools/build-tools.ts:67-92`；bash / write / edit 标记 HIGH
- 违反后果：用户未确认即执行破坏性操作
- **例外**：已有 permission rule 匹配时自动放行

### K-MUST-3 · 敏感路径黑名单硬编码，不接受配置覆盖

SSH / AWS / Keychain / 浏览器 Cookie 等。即使用户"授权"也拒绝。

- 依据：`src/main/tools/path-guard.ts:9-22 SENSITIVE_PATHS`
- 违反后果：这些路径泄漏等于账号完全失控，不属于用户自主决定范围

### K-NEVER-1 · 禁止手写 `path.startsWith(workspace)` 做边界判断

symlink 可绕过。必须走 `path-guard` 的两阶段 `realpath` 校验。

- 依据：`src/main/tools/path-guard.ts:71-103 resolveInWorkspace`
- 违反后果：symlink 指向 workspace 外时越权读写

### K-NEVER-2 · bash 工具禁止放过黑名单检查

`rm -rf /`、`sudo`、`curl | bash`、写 shell rc 等必须前置拦截。

- 依据：`src/main/tools/builtin/bash.ts:47-52 isCommandDangerous`
- 违反后果：模型被诱导执行破坏性命令；用户 confirm 不是最后防线

### K-MUST-4 · renderer HTML 必须有 Content-Security-Policy meta

CSP 覆盖 default-src / script-src / connect-src / object-src / frame-ancestors。

- 依据：`index.html` meta http-equiv
- 违反后果：XSS 被利用时恶意脚本可加载外部资源、泄漏 API key / 会话内容
- → `patterns.md` §P11

### K-MUST-5 · BrowserWindow 安全三件套必须全开

`contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`。

- 依据：`src/main/index.ts:63-71 webPreferences`
- 违反后果：preload 与页面 JS 世界打通 / renderer 获得 Node API / 缺 OS 级沙箱
- **例外**：如 preload 必须使用 Node-only 模块才关 `sandbox`，必须在 `webPreferences` 段用注释说明具体原因
- → `patterns.md` §P11

### K-MUST-6 · 必须注册 `web-contents-created` 导航拦截

`will-navigate` 拒绝非白名单 URL；`will-attach-webview` 阻止 webview 注入。

- 依据：`src/main/index.ts:registerNavigationGuards`
- 违反后果：renderer 被诱导跳转到外站 → 整个渲染进程暴露给攻击者；`<webview>` 逃逸
- 白名单：dev 的 `process.env.ELECTRON_RENDERER_URL` + 生产 `file://`
- → `patterns.md` §P11

### K-MUST-7 · `remote-debugging-port` 仅限 dev

`app.isPackaged` 判断下才开。

- 依据：`src/main/index.ts:5-11`
- 违反后果：生产环境任意本机进程可通过 DevTools Protocol 注入脚本
- → `patterns.md` §P11

### K-MUST-8 · 敏感凭据必须经 `safeStorage.encryptString` 持久化

API key / token 不得明文落盘。

- 依据：`src/main/agent/accounts.ts` 使用 `safeStorage` 加密
- 违反后果：用户数据被同机其他进程读取

### K-MUST-9 · `setWindowOpenHandler` 拒绝新窗口，外链走 `shell.openExternal`

- 依据：`src/main/index.ts:105-108`
- 违反后果：renderer `window.open` 会新起 BrowserWindow 丢失安全配置

### K-NEVER-3 · 禁止在 `webPreferences` 里开启 `webviewTag`

`webviewTag: true`（或 Electron 默认行为）使 renderer 能嵌套 webview，扩大攻击面。

- 依据：`src/main/index.ts:webPreferences` 未启用 webviewTag
- 违反后果：webview 可绕过 parent 的 sandbox 和 CSP

### K-NEVER-4 · 禁止 `webPreferences.allowRunningInsecureContent: true`

混合内容会导致 HTTPS 降级、中间人攻击。

- 依据：未显式启用（默认 false）

### K-NEVER-5 · 禁止 `webPreferences.experimentalFeatures: true` 在生产

实验特性可能引入安全回归。仅 dev 调试用。

---

## L. 测试与可观测

### L-MUST-1 · 测试文件与源文件同目录同名 `xxx.test.ts`

- 依据：68 个测试文件全部遵守，不使用集中式 `tests/` 目录
- 违反后果：rename / move 源文件时测试失联
- → `patterns.md` §P10

### L-MUST-2 · `vitest` 共享 mock 必须用 `vi.hoisted`

- 依据：`src/main/loop/react-loop.test.ts:13-19`、`src/main/chat/provider-selector.test.ts:7`
- 违反后果：`vi.mock` 先 hoist，mock fn 尚未创建，跑时为 undefined
- → `patterns.md` §P10

### L-MUST-3 · 每条运行时防御必须有"触发"和"不触发"两条测试

- 依据：`src/main/tools/builtin/edit.test.ts`（多匹配拒绝 + 单匹配正常）、`src/main/loop/react-loop.test.ts`（带 error 阈值 1 + 合法幂等读阈值 2）
- 违反后果：只证明规则生效，不能防止"条件写太紧导致误伤"

### L-MUST-4 · main 进程日志走 `electron-log`；renderer 可用 `console`

- 依据：`src/main/**` 全部 `import log from 'electron-log'`
- 违反后果：打包后 `console` 丢失

### L-SHOULD-1 · 循环 / 长耗时操作收尾必须记录终局信息

`exitReason`、duration、tool count 等。

- 依据：`src/main/loop/react-loop.ts:611-616`

### L-SHOULD-2 · 测试隔离用 `beforeEach` + `registry.clear()` + 重注册

- 依据：`src/main/tools/registry.test.ts:16-18`、`src/main/tools/builtin/bash.test.ts:26-28`

### L-NEVER-1 · 测试禁止依赖真实网络 / 真实数据库

真实 DB 用 `:memory:` SQLite；网络用 `vi.mock`。

- 依据：`src/main/db/session-summaries.test.ts:14` `new Database(':memory:')`
- 违反后果：CI 不可复现；flaky

### L-NEVER-2 · 测试描述不得只写 "should work" / "test xxx"

必须说明场景和期望，中英文均可。

- 依据：`src/main/loop/react-loop.test.ts` 中每条 `it` 描述场景
- 违反后果：失败时无法从名字推断是什么场景出问题

---

## 偏离处理

每条 MUST/SHOULD 发现存量偏离时：

1. 新代码必须遵守（防止债务增长）
2. 存量偏离在条目末尾标注 `⚠️ 偏离：<file:line>`
3. 修复独立 commit，message 引用规则编号（如 `fix: align repos/xxx to E-MUST-1`）

---

## 相关文档

- **[patterns.md](patterns.md)** — 工程模式、通用原则、参考实现文件索引
- **[../../CLAUDE.md](../../CLAUDE.md)** — AI 协作入口
