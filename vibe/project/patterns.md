# Talor 工程模式

本文档描述 Talor 遇到的通用工程问题和对应的设计模式。每个模式的结构：

1. **问题** — 要解决什么
2. **原则** — 通用取舍（与具体项目无关）
3. **Talor 实施** — 本项目的具体解法
4. **参考实现** — 直接去读这几个文件
5. **示例** — 正例 / 反例代码
6. **取舍与不适用场景**
7. **相关标准** — 反向引用到 `standards.md`

**阅读顺序建议**：P1 → P2 → P3 先读（最常用）；P4 → P9 涉及 AI agent 特有防御；P5 → P10 涉及代码组织。

---

## P1. 参数校验的分层职责

### 问题

外部输入（LLM、MCP、IPC、文件）进入系统时需校验结构、类型、业务规则、输出质量。单层校验要么覆盖不全，要么在同一层混杂多种规则难维护。

### 原则

校验分层而非集中。每层只看自己能看见的信息：

| 层       | 可见对象                 | 典型校验                             |
| -------- | ------------------------ | ------------------------------------ |
| 结构校验 | 原始 input               | 字段存在性、类型、枚举、正则         |
| 业务校验 | input + context          | 跨字段关系、权限前置、上下文相关规则 |
| 执行     | input + context          | 业务本身                             |
| 输出审查 | output + input + context | 幻觉检测、格式规范化                 |

层间**不可重叠**——结构校验已拒绝的情况，业务校验不能重判。

### Talor 实施

`toolRegistry.execute` 内置 4-Phase 流水线：

```
Phase 1: Zod / schema-check  → 结构 + 类型 + enum + refine
Phase 2: tool.validate       → 需要 context 的业务规则（同步）
Phase 3: tool.execute        → 实际执行
Phase 4: tool.verify         → 输出审查，可 severity='block' 阻断
```

内置工具用 **Zod** 作为单一事实源：`zodSchema` 定义 → `z.toJSONSchema` 派生给 LLM → `z.infer` 派生 TS 类型。避免运行时校验、LLM schema、TS 类型三处漂移。

MCP 工具 schema 来自远端，无法 Zod 化，走 fallback 的 `schema-check.ts`（type/enum/pattern/min-max/length 的轻量 JSON Schema 子集）。

### 参考实现

- `src/main/tools/registry.ts:97-170` — 4-Phase 调度逻辑
- `src/main/tools/builtin/bash.ts` — 含 context 依赖规则的高风险工具（Zod 静态校验 + `validate` 管 `checkWritePaths`）
- `src/main/tools/builtin/read.ts` — 最简结构（只有 Zod，无 validate）
- `src/main/tools/builtin/edit.ts` — Zod refine + 执行内 `EDIT_AMBIGUOUS_MATCH` 拦截
- `src/main/tools/schema-check.ts` — MCP 工具的 fallback 路径
- `src/main/tools/zod-diagnostics.ts` — ZodError 转 LLM 可读诊断消息
- `src/main/tools/input-diagnostics.ts` — 缺字段 + "Did you mean" 启发

### 示例

**正例**：

```ts
// tools/builtin/read.ts
const ReadInput = z.object({
  path: z.string()
    .describe('File path relative to workspace or absolute path')
    .refine(p => p.trim().length > 0, 'Missing required parameter')
    .refine(p => !p.includes('\0'), 'Invalid path: contains null byte.'),
})
type ReadInputT = z.infer<typeof ReadInput>

const readTool = {
  name: 'read',
  zodSchema: ReadInput,
  parameters: z.toJSONSchema(ReadInput) as Record<string, unknown>,
  async execute(input: unknown, ctx) {
    const params = input as ReadInputT   // Zod 已校验,此处仅收敛类型
    ...
  },
}
```

**反例**：

```ts
// ❌ schema / validate / execute 里重复检查
const badTool = {
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  validate(input) {
    if (typeof (input as any).path !== 'string') return { ok: false, error: '...' }   // Phase 1 已做
  },
  async execute(input) {
    if (!input || typeof input !== 'object') return { output: 'invalid' }   // 再做一遍
    ...
  },
}
```

### 取舍

- **何时不适用**：一次性脚本或纯内部 API，类型已由 TS 保证。过度分层反而冗余。
- **成本**：每个工具多写一份 Zod schema；新加工具时需决定规则归属哪一层。
- **收益**：单一事实源消除漂移风险；类型自动推导；新贡献者照搬模板即可。

### 相关标准

F-MUST-1 / F-MUST-2 / F-NEVER-1、B-NEVER-1

---

## P2. 错误建模：结构化错误信封

### 问题

工具 / 函数发生错误时，上游需要根据错误**类别**决定行为（重试 vs 降级 vs 报警）。用字符串消息匹配错误类型，在上游库文案变化时会静默断裂。

### 原则

- 错误携带**结构化信息**（code + message + hint），而非靠自然语言
- 识别层优先读结构化字段，字符串匹配仅作兼容层
- 新错误类型不得依赖字符串前缀被识别

### Talor 实施

`ToolErrorEnvelope`：

```ts
interface ToolErrorEnvelope {
  __talor_error: true // 布尔标志位,识别层 O(1) 判断
  code: string // UPPER_SNAKE_CASE 错误码
  message: string // 人类可读
  hint?: string // 给模型下一步的建议
}
```

识别层 `isErrorOutput` 三级优先级：

1. 结构化信封（新代码首选）
2. AI SDK 原生 `type: 'error-text' / 'error-json'`
3. `ERROR_OUTPUT_PATTERNS` 正则（兼容旧 builtin 前缀，不再扩展）

展开层 `extractOutputText` 把信封转成 `[CODE] message\n(hint: ...)` 格式供 LLM 阅读。

### 参考实现

- `src/main/tools/types.ts:ToolErrorEnvelope` + `isToolErrorEnvelope` — 结构定义和守卫
- `src/main/loop/stream-utils.ts:103-111 isErrorOutput` — 三级优先级识别
- `src/main/loop/stream-utils.ts:45-54 extractOutputText` — 展开给 LLM
- `src/main/mcp/client.ts:146-182` — MCP 错误转信封（DISCONNECTED / TIMEOUT / EXCEPTION）
- `src/main/tools/registry.ts:153-180` — verify block/crash 转信封
- `src/main/tools/builtin/bash.ts:200-215` — BASH_STDERR_FAILURE 使用
- `src/main/tools/builtin/edit.ts:80-93` — EDIT_AMBIGUOUS_MATCH 使用

### 示例

**正例**：

```ts
// MCP 断连返回信封
return {
  output: {
    __talor_error: true,
    code: 'MCP_DISCONNECTED',
    message: `MCP server "${serverName}" is disconnected.`,
    hint: 'Reconnecting in the background — please retry shortly.',
  } satisfies ToolErrorEnvelope,
}
```

**反例**：

```ts
// ❌ 字符串前缀,识别层需要维护正则
return { output: `MCP server "${serverName}" is disconnected. Reconnecting...` }

// 识别层:
ERROR_OUTPUT_PATTERNS.push(/^MCP server ".*" is disconnected/) // 脆弱
```

### 取舍

- **何时不适用**：错误类型只有 1-2 种且永远不会增加 — 简单 string 即可。
- **成本**：code 命名需约定（UPPER*SNAKE_CASE + 层次前缀如 `MCP*\_`、`VERIFY\_\_`）；信封增加代码量。
- **收益**：死循环检测、UI badge、可观测性全部依赖 `isError` 可靠；新错误类型零成本接入。

### 相关标准

F-MUST-3、G-NEVER-2

---

## P3. 错误的边界分类与降级

### 问题

系统边界（网络、LLM、fs、子进程）的异常形态多样且变化频繁。让它们未分类地透传到 UI，用户看到的是栈信息而非可 act 的提示。

### 原则

- 错误在**最外层 boundary**分类（IPC edge），不让业务层 catch 住以后又无分类抛出
- 分类要稳定（枚举 `ChatErrorCode`），不靠自由文案
- 调用方据分类决定 UI 动作（重试 / 提示授权 / 终止）
- 业务层**不用 throw 报业务错误**，用返回值（`{ ok, error }` / envelope）

### Talor 实施

双层：

- **边界分类层**：`classifyLlmError(error: unknown): ChatErrorCode`
  - `AbortError / TimeoutError → LLM_TIMEOUT`
  - `fetch / ECONNREFUSED / ENOTFOUND → LLM_CONNECTION_FAILED`
  - `429 / rate limit → RATE_LIMITED`
  - `401 / 403 / API key → AUTH_FAILED`
  - 业务错误（`FILE_TOO_LARGE` 等）原样透传
  - 兜底 `LLM_ERROR`

- **业务错误作返回值**：tool 返回 envelope，orchestrator 读 `isError` 决定下一步

### 参考实现

- `src/main/ipc/error-codes.ts:12-58` — `ChatErrorCode` 枚举 + 分类函数
- `src/main/chat/orchestrator.ts` — 在 catch 块内调用 classifyLlmError
- `src/renderer/pages/Chat/*.tsx` — 前端根据 code 分派 UX

### 示例

**正例**（IPC 边界）：

```ts
try {
  await orchestrator.sendChat(req)
} catch (err) {
  return { error: classifyLlmError(err) } // 枚举值,前端据此分派
}
```

**反例**：

```ts
try {
  await sendChat(req)
} catch (err) {
  return { error: String(err) } // ❌ 前端无法区分 401 / 429 / timeout
}
```

### 取舍

- **何时不适用**：CLI 工具或单用户脚本，直接抛异常用户自己读。
- **成本**：每加一种错误场景需更新枚举 + 前端分派分支。
- **收益**：前端可差异化 UX，用户能 act；CI 可基于 code 断言测试。

### 相关标准

D-NEVER-1、G-MUST-1、G-SHOULD-2

---

## P4. 不变量的代码化（prompt → code）

### 问题

LLM agent 的很多"模型应该怎么做"规则写在 prompt 里（"不要编造"、"old_str 要唯一"、"context 快满时收敛"）。模型会在特定输入分布下偏航，纯 prompt 约束不可靠。

### 原则

- **能在代码强制的不变量，永远不放在 prompt**
- Prompt 只留"判断题"（语义路由、语气风格、需模型判断的边界场景）
- 新加的"模型必须"规则，先问：能否写成代码？不能再写 prompt

### Talor 实施

多层代码强制：

| 不变量                     | 代码位置                       | 实施手段                                                                 |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| 禁止调用不存在的工具名     | `loop/react-loop.ts:296-316`   | 工具不存在时注入"available tools"，执行失败时注入"do not retry"          |
| edit 的 `old_str` 必须唯一 | `tools/builtin/edit.ts:80-93`  | 多匹配且 `replaceAll !== true` → `EDIT_AMBIGUOUS_MATCH` 信封，不落盘     |
| context 超限时停止         | `loop/react-loop.ts:207-244`   | ≥100% 硬阻断，不提交 provider（防静默截断）                              |
| 兜底摘要不得编造引用       | `loop/quote-verifier.ts`       | ≥20 字节长引用与最近 10 条 tool_output 比对，未命中替换 `⟨unverifiable⟩` |
| 敏感路径不得访问           | `tools/path-guard.ts:9-22`     | 硬编码黑名单，即使用户"授权"也拒绝                                       |
| 危险 bash 命令不得执行     | `tools/builtin/bash.ts:47-52`  | 黑名单前置拦截                                                           |
| 工具输出不得被当指令       | `loop/stream-utils.ts:145-157` | `<tool_output>` XML 包裹 + SystemPlugin 声明                             |

### 参考实现

- `src/main/loop/quote-verifier.ts` — 短实现：引用核验
- `src/main/tools/path-guard.ts` — 三态路径决策
- `src/main/loop/react-loop.ts:518-594` — 死循环双路侦测（签名重复 + 连续失败连击）
- `src/main/tools/builtin/edit.ts:80-93` — 多匹配拒绝
- `src/main/loop/react-loop.ts:207-244` — context 超限硬阻断

### 示例

**正例**：

```ts
// 代码强制 edit 唯一性
if (occurrences > 1 && params.replaceAll !== true) {
  return {
    output: {
      __talor_error: true,
      code: 'EDIT_AMBIGUOUS_MATCH',
      message: `String appears ${occurrences} times in ${params.path}.`,
      hint: 'Either expand "old" to include more unique context, or pass replaceAll: true.',
    },
  }
}
```

**反例**：

```ts
// ❌ 仅靠 prompt 约束,模型可能漏看
// SystemPlugin:"When using edit, the old_str must be unique in the file."
// 然后默认行为是替换第一处,多匹配时静默改错地方
```

### 取舍

- **何时不适用**：规则本身需要模型判断语义（"回复要友好"），无法代码化。
- **成本**：每条代码化的规则需配"触发 + 不触发"两条测试（L-MUST-3）。
- **收益**：正确性不依赖模型能力；规则升级模型后依然有效；审计可复现。

### 相关标准

J-MUST-1 / J-MUST-2 / J-MUST-3 / J-SHOULD-1 / J-NEVER-1、K-MUST-1 / K-NEVER-1 / K-NEVER-2

---

## P5. Repo CRUD 契约

### 问题

数据访问层方法命名、返回值、错误处理若不统一，调用方每接入一个 repo 都要重新学契约。

### 原则

- 命名覆盖最小 CRUD 集（list / create / getById / update / delete），语义固定
- 返回值语义明确：`null` 表示"找不到"，`boolean` 表示"是否发生变更"，永远不抛业务错误
- 所有写操作必须有审计日志

### Talor 实施

| 方法                     | 签名                    | 行为                          |
| ------------------------ | ----------------------- | ----------------------------- |
| `list()`                 | `(): T[]`               | 空时 `[]`                     |
| `create(params)`         | `(params): T`           | 返新实体                      |
| `getById(id)`            | `(id): T \| null`       | 无结果 `null`                 |
| `update<Field>(id, val)` | `(id, val): T \| null`  | 不存在返 `null`，否则返新快照 |
| `delete(id)`             | `(id): void \| boolean` | 不存在是 no-op                |

写操作固定格式：`log.info('[RepoName] <Action> <entity>:', id, ...)`

### 参考实现

- `src/main/repos/session-repo.ts` — CRUD 完整范例（session + message）
- `src/main/repos/mcp-server-repo.ts` — 再次验证同模式

### 示例

**正例**：

```ts
export const sessionRepo = {
  list(): ChatSession[] { ... },
  create(params): ChatSession {
    ...
    log.info('[SessionRepo] Created session:', id, 'agent:', agentId)
    return session
  },
  getById(id): ChatSession | null {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
    return row ? rowToSession(row) : null
  },
  updateModel(id, model_id): ChatSession | null {
    const info = db.prepare('UPDATE sessions SET model_id = ? WHERE id = ?').run(model_id, id)
    if (info.changes === 0) return null
    log.info('[SessionRepo] Updated model:', id, '->', model_id)
    return this.getById(id)
  },
}
```

**反例**：

```ts
// ❌ 命名漂移 + 错误处理风格不一致
export const badRepo = {
  fetchAll(): T[],                                 // 应该叫 list
  findOne(id): T,                                  // 应该叫 getById
  modify(id, ...): void,                           // 不返回新快照
  remove(id): Promise<void> { throw NotFound },    // 不应抛
}
```

### 取舍

- **何时不适用**：复杂查询场景（join / 分页 / 过滤组合）需要额外命名，保留 CRUD 作基础集即可。
- **成本**：命名约束可能不够表达业务语义（有时 `list` 太泛）。
- **收益**：上手成本 0；跨 repo 行为可预期。

### 相关标准

E-MUST-1 / E-MUST-2 / E-MUST-3、A-NEVER-2

---

## P6. 事务与原子性

### 问题

多步写入之间若发生崩溃、abort、异常，会留下部分写入 → 下游读到"半成品"状态。

### 原则

- 识别**原子边界**：哪些操作必须"要么全成要么全败"
- 同一原子边界用单个事务
- 外部 SDK 的不变量（如 AI SDK 的 tool_use/tool_result 配对）和 DB 事务是同一概念

### Talor 实施

`messageRepo.createBatch` 用 `db.transaction` 把 `assistant(tool_use)` 和 `tool(result)` 绑成原子操作。

原因：Vercel AI SDK 在 rebuild prompt 时要求每个 `tool_use` 有对应 `tool_result`。如果两次 `messageRepo.create` 之间进程崩溃，session 里会出现孤儿 `tool_use`，下次加载 session 就永久破坏。

### 参考实现

- `src/main/repos/session-repo.ts:205-231 createBatch` — 事务包装
- `src/main/loop/react-loop.ts:334-338` — 调用点（ReAct 每步落盘）
- `src/main/loop/react-loop.ts:349-382` — finally 块：stream 中断时的"aborted 降级落盘"保证不留孤儿

### 示例

**正例**：

```ts
messageRepo.createBatch([
  { id: uuid(), session_id, role: 'assistant', content: assistantBlocks },
  { id: uuid(), session_id, role: 'tool', content: toolBlocks },
])
```

**反例**：

```ts
// ❌ 两次独立 create,中间崩溃 → 孤儿 tool_use
messageRepo.create({ role: 'assistant', content: [...tool_use] })
// process crashes here
messageRepo.create({ role: 'tool', content: [...tool_result] })
```

### tool_use/tool_result 配对不变量的三个面

同事务落盘只是第一道。配对在「写 → 读 → 装配」三处都可能被破坏,**三处都要守**:

1. **写**(P6 本体):`createBatch` 同事务落 `assistant(tool_use)` + `tool(result)`,杜绝孤儿。
2. **读**(I-MUST-3):`listBySession` 必须 `ORDER BY created_at ASC, rowid ASC`。createBatch 给同批盖同一 created_at,只按 created_at 排会让二者顺序不确定、可能反转。
3. **装配**(J-MUST-2b):重建 prompt 时 history 末尾的 tool_use 与当前 turn 的 tool_result 必须相邻,volatile 旁注(RuntimeMeta/hint/DEGRADED)排在 current-turn 之后,不得插在中间。

任一处违反 → SDK `convertToLanguageModelPrompt` 抛 `AI_MissingToolResultsError`(v7 严格,v6 曾默默容忍)→ 工具回合崩。本会话三个 bug 正是分别命中读、装配两处(写早已有 P6 守住)。

### 取舍

- **何时不适用**：单条写入不需要事务。
- **成本**：事务 API 有性能开销（可忽略）；需仔细识别原子边界。
- **收益**：崩溃恢复后数据一致。

### 相关标准

E-MUST-4、I-MUST-1、I-MUST-3、J-MUST-2b

---

## P7. 分层边界与依赖方向

### 问题

随着项目增长，"哪一层可以 import 哪一层"容易漂移。没有约束时业务层会开始 import 入口层，产生双向依赖。

### 原则

- 明确分层和依赖方向（单向，不得反向）
- 没有 lint 强制时，靠**人工 review + 约定文档 header** 维护
- 每个跨层文件在头部声明允许/禁止依赖

### Talor 实施

三层：

```
入口层 ipc/*    ← 只它能依赖业务层；业务层不能依赖它的运行时代码
  ↓
业务层 chat/ agent/ tools/ memory/ providers/ prompt/ loop/ permissions/ skills/
  ↓
基础设施 repos/ db/ store/ services/ shared/
```

文件头声明：

```ts
// src/main/chat/orchestrator.ts —— 业务层（chat 领域）：chat:send 用例编排
//
// 允许依赖: chat/（同层）、tools/*、loop/*、prompt/*、memory/*、providers/*、
//           store/*、repos/*、agent/*、skills/*、shared/*
// 禁止依赖: ipc/* 的运行时代码（仅允许 ipc/ 的纯类型 import）
```

### 参考实现

- `src/main/chat/orchestrator.ts:1-10` — 声明范式
- `src/main/chat/stream-registry.ts:1-8` — 同样风格
- `src/main/agent/variable-resolver.ts:1-6` — 简化版（只标业务层）
- `src/main/ipc/permission.ts:1-2` — 入口层声明

### 示例

**正例**：头部声明清晰，import 严格遵守。

**反例**：

```ts
// ❌ 业务层直接 import IPC 框架
// src/main/agent/xxx.ts
import { ipcMain, webContents } from 'electron'
```

### 取舍

- **何时不适用**：小型项目（<20 文件）不需要此约束。
- **成本**：每个跨层文件头多写 2-5 行；review 时需检查 import。
- **收益**：重构成本降低；单元测试的 mock 边界清晰。

### 相关标准

A-MUST-1 / A-MUST-2 / A-NEVER-1、D-MUST-3

---

## P8. Critical vs Optional 组件分级

### 问题

系统由多个组件组合，当某个组件失败时，不同组件该有不同反应：核心组件必须响亮失败；外围组件降级继续工作。

### 原则

- 明确列出**关键组件**名单
- 关键失败 throw（fail-loud），让上游决定是否重试 / 终止
- 非关键失败 degrade + 注入"[DEGRADED]"告警给下游（让下游知道信息有缺口）

### Talor 实施

PromptPipeline 把插件分两类：

```ts
const CRITICAL_PLUGIN_NAMES = new Set([
  'SystemPlugin', // 行为宪法、防注入规则 — 缺它模型裸奔
  'AgentPromptPlugin', // Agent 身份、激活 skill
  'MemoryPlugin', // 历史上下文
  'MessagePlugin', // 当前 turn 消息
])
```

执行流程：

- Critical 失败 → `throw` → orchestrator 捕获 → 错误分类 → UI
- Non-critical（如 `ToolSelectionPlugin`）失败 → log + 注入 `[DEGRADED]` system message → 继续 build prompt

### 参考实现

- `src/main/prompt/PromptPipeline.ts:24` — `CRITICAL_PLUGIN_NAMES` 定义
- `src/main/prompt/PromptPipeline.ts:85-109` — try/catch 分支
- `src/main/memory/ShortTermMemory.ts:129-145` — 摘要生成失败的 degrade（注入 `[CONTEXT GAP WARNING]`）

### 示例

**正例**：

```ts
for (const plugin of plugins) {
  try {
    const result = await plugin.build(ctx)
    allMessages.push(...result.messages)
  } catch (err) {
    if (CRITICAL_PLUGIN_NAMES.has(plugin.name)) {
      throw new Error(`Critical prompt plugin "${plugin.name}" failed: ${err}`)
    }
    log.warn(`[PromptPipeline] Non-critical plugin ${plugin.name} failed:`, err)
    degraded.push(plugin.name)
  }
}
if (degraded.length > 0) {
  allMessages.unshift({ role: 'system', content: `[DEGRADED] ${degraded.join(', ')} ...` })
}
```

**反例**：

```ts
// ❌ 全部 try/catch 吞掉,系统无感继续
for (const plugin of plugins) {
  try {
    allMessages.push(...(await plugin.build(ctx)))
  } catch {}
}
// SystemPlugin 失败时模型裸奔,没人知道
```

### 取舍

- **何时不适用**：组件很少（<5 个），都是 critical，无降级必要。
- **成本**：维护名单；degrade 路径需设计"下游知道缺口"的机制。
- **收益**：部分失败不把整个流程拖死；关键失败不被掩盖。

### 相关标准

J-MUST-2、F-MUST-4

---

## P9. Fail-Loud vs Silent Fallback

### 问题

异常发生时，"默默回退到默认值"vs"响亮失败"该怎么选？默默降级容易掩盖 bug；响亮失败频繁打扰用户。

### 原则

- **不变量**相关的失败 → fail-loud（让上游知道）
- **性能优化 / 外围能力**失败 → silent fallback（degrade）
- 判断标准：**如果静默降级，后续行为是否依然正确？** 不正确 → 必须 loud
- Loud 不意味着抛异常给用户看，而是让**能处理的上游**感知到

### Talor 实施

典型决策：

| 场景                                           | 选择                                                   | 理由                                         |
| ---------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `tool.verify` 判定输出不合格（severity=block） | fail-loud（VERIFY_BLOCKED 信封）                       | 验证的意义就是阻断，静默回退等于没验证       |
| `tool.verify` 抛异常                           | fail-loud（VERIFY_CRASH 信封）                         | 验证逻辑本身崩了，原输出可靠性未知           |
| SystemPlugin / MemoryPlugin 失败               | fail-loud（throw）                                     | 模型缺这些上下文会胡编                       |
| ToolSelectionPlugin 失败                       | silent fallback（全工具可用）                          | 只影响 token 效率                            |
| MCP server 断连                                | silent fallback（后台重连） + loud envelope 给当次调用 | 全局可继续；当次调用需失败                   |
| Memory 摘要生成失败                            | silent fallback（fallback 到 [CONTEXT GAP WARNING]）   | 保留 anchors + recent 可继续，告警让模型谨慎 |
| context ≥ 100%                                 | fail-loud（auto-halt 消息）                            | 提交给 provider 会被静默截断，必须在本地终止 |

### 参考实现

- `src/main/tools/registry.ts:153-180` — verify 两种失败转信封（fail-loud）
- `src/main/prompt/PromptPipeline.ts:85-109` — critical throw / 其余 degrade
- `src/main/memory/ShortTermMemory.ts:129-145` — 摘要失败的 `[CONTEXT GAP WARNING]`
- `src/main/loop/react-loop.ts:209-244` — context 超限硬阻断
- `src/main/loop/react-loop.ts:571-589` — 连续失败 streak 主动 halt

### 示例

**正例 fail-loud**：

```ts
if (vr.severity === 'block' && !vr.ok) {
  const envelope: ToolErrorEnvelope = {
    __talor_error: true,
    code: 'VERIFY_BLOCKED',
    message: vr.warning ?? 'Output failed verification',
  }
  return { toolCallId, toolName, output: envelope } // 不回退 rawOutput
}
```

**正例 silent fallback + loud warning**：

```ts
try {
  summaryText = await generateSummary(...)
} catch (err) {
  log.warn('[ShortTermMemory] summary generation failed')
  return {
    summaryMessage: {
      role: 'system',
      content: '[CONTEXT GAP WARNING] Summary generation failed. ...',
    },
    recentMessages: [...anchors, ...recentMessages],
    // 不崩,但告诉模型有缺口
  }
}
```

**反例**：

```ts
// ❌ verify 抛异常却回退 rawOutput
try {
  const vr = await tool.verify(rawOutput, input, ctx)
  return { output: vr.output }
} catch {
  return { output: rawOutput } // verify 的意义被完全绕过
}
```

### 取舍

- **何时 silent**：外围功能 / 性能优化 / 已经有替代方案。
- **何时 loud**：正确性依赖该组件 / 没有替代方案。
- **模糊地带**：用"如果忽略此错误，下一步行为是否依然正确"自问。

### 相关标准

F-MUST-4、J-MUST-2、J-MUST-3

---

## P10. 测试风格与隔离

### 问题

测试共用模块状态时容易相互污染；Vitest 的 `vi.mock` 有 hoisting 陷阱；测试名字起得差时失败日志无法定位问题。

### 原则

- 测试文件**同目录同名** `.test.ts`（IDE 跳转直接对应）
- 共享模块（registry、store）每测试前 `clear()` 隔离
- Vitest mock 用 `vi.hoisted` 避免 hoisting 时 mock 未定义
- 每条运行时防御有"**触发**"和"**不触发**"两条 case
- 测试描述说明**场景和期望**，不用 "should work"

### Talor 实施

**同目录**：源文件 `xxx.ts` 旁 `xxx.test.ts`，68 个测试文件全部遵守，不用集中 `tests/`。

**registry 隔离**：

```ts
beforeEach(() => {
  toolRegistry.clear()
  indexMod.registerBashTool() // 重新注册
})
```

**vi.hoisted mock**：

```ts
const { mockMessageCreate, mockStreamText } = vi.hoisted(() => ({
  mockMessageCreate: vi.fn(),
  mockStreamText: vi.fn(),
}))
vi.mock('../repos/session-repo', () => ({
  messageRepo: { create: mockMessageCreate },
}))
```

**触发 + 不触发**：`edit.test.ts` 多匹配拒绝（触发） + 单匹配正常（不触发）。

**in-memory DB**：`db/session-summaries.test.ts` 用 `new Database(':memory:')`。

### 参考实现

- `src/main/tools/registry.test.ts:16-18` — clear + beforeEach 模板
- `src/main/loop/react-loop.test.ts:13-19` — `vi.hoisted` 模板
- `src/main/tools/builtin/bash.test.ts:19-28` — registry.clear + re-register 模板
- `src/main/tools/builtin/edit.test.ts` — 触发 + 不触发两条测试对比
- `src/main/db/session-summaries.test.ts:14` — in-memory DB

### 示例

**正例（触发 + 不触发）**：

```ts
it('refuses multi-match edit without replaceAll (EDIT_AMBIGUOUS_MATCH)', async () => {
  writeFileSync(join(TMP, 'file.txt'), 'foo bar foo baz')
  const result = await registry.execute('edit', { path: 'file.txt', old: 'foo', new: 'qux' }, ctx)
  expect((result.output as any).code).toBe('EDIT_AMBIGUOUS_MATCH')
  expect(readFileSync(join(TMP, 'file.txt'), 'utf-8')).toBe('foo bar foo baz')
})

it('single-match edit still works without replaceAll', async () => {
  writeFileSync(join(TMP, 'file.txt'), 'foo bar baz')
  const result = await registry.execute('edit', { path: 'file.txt', old: 'foo', new: 'qux' }, ctx)
  expect(result.output).toContain('1 replacement')
})
```

**反例**：

```ts
// ❌ 非 hoisted mock
const mockFn = vi.fn()   // 在 describe 外定义
vi.mock('../xxx', () => ({ fn: mockFn }))   // vi.mock 被 hoist 到文件顶部,mockFn 此时 undefined

// ❌ 模糊测试名
it('test edit', () => { ... })   // 失败时不知道测的什么场景
```

### 取舍

- **何时简化**：纯函数测试不需要 mock / 隔离，直接断言。
- **成本**：hoisted 写法略繁琐；双测试增加代码量。
- **收益**：CI 可复现；失败时能凭 test 名定位场景；没有 flaky。

### 相关标准

L-MUST-1 / L-MUST-2 / L-MUST-3 / L-SHOULD-2 / L-NEVER-1 / L-NEVER-2

---

## P11. Electron 渲染端安全边界

### 问题

Electron 把 Chromium 和 Node.js 塞进同一进程。默认配置下 renderer 进程可以直接 `require('fs')` 访问用户系统，任何 XSS 都等同 RCE。官方有 13 条 Security Checklist，必须**全部**遵守才算合规。

### 原则

- 渲染进程**最小权限**：不给 Node API、不给特权 import、不给沙箱外能力
- **数据/指令分层**：preload 通过 `contextBridge` 暴露白名单 API，renderer 只能调这些
- **多层纵深防御**：CSP、`sandbox`、`contextIsolation`、`nodeIntegration`、导航拦截 — 缺一不可
- 开发配置（remote debug、experimental flag）不能漏到生产

### Talor 实施

| 防御层                | 位置                                         | 做法                                                                           |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| CSP meta              | `index.html`                                 | `default-src 'self'`；`connect-src` 只含 `'self'` + dev 的 `localhost:*`       |
| webPreferences 三件套 | `src/main/index.ts:63-71`                    | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`            |
| 导航拦截              | `src/main/index.ts:registerNavigationGuards` | `will-navigate` 白名单 + `will-attach-webview` 全拒                            |
| 新窗口                | `src/main/index.ts:105-108`                  | `setWindowOpenHandler` 返回 `{ action: 'deny' }`，外链走 `shell.openExternal`  |
| DevTools Protocol     | `src/main/index.ts:5-11`                     | `remote-debugging-port` 只在 `!app.isPackaged` 打开                            |
| preload 白名单        | `src/preload/index.ts`                       | `contextBridge.exposeInMainWorld` 暴露 `talorAPI`，不导出 `ipcRenderer` 裸对象 |
| 敏感凭据              | `src/main/agent/accounts.ts`                 | `safeStorage.encryptString` 加密持久化                                         |

**所有外部网络请求都走主进程**。renderer 不直接调 LLM API / MCP / provider endpoint，因此 CSP 的 `connect-src` 可以收紧到只含 `self` + dev 的 HMR。

### 参考实现

- `src/main/index.ts:3-11` — `remote-debugging-port` 条件化
- `src/main/index.ts:63-71` — BrowserWindow 安全三件套
- `src/main/index.ts:105-108` — `setWindowOpenHandler`
- `src/main/index.ts:registerNavigationGuards` — 全局导航拦截
- `index.html` — CSP meta
- `src/preload/index.ts` — contextBridge 白名单 API 暴露
- `src/main/agent/accounts.ts` + `src/main/services/safe-storage.ts` — 凭据加密

### 示例

**正例（CSP 最小化白名单）**：

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:* ws://localhost:*; object-src 'none'; frame-ancestors 'none'"
/>
```

**正例（导航拦截）**：

```ts
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (devOrigin && url.startsWith(devOrigin)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
})
```

**反例**：

```ts
// ❌ 老式不安全配置
new BrowserWindow({
  webPreferences: {
    nodeIntegration: true,     // renderer 能 require('fs')
    contextIsolation: false,   // preload 和页面共用 JS 世界
    sandbox: false,            // 无 OS 沙箱
  },
})

// ❌ 把 ipcRenderer 裸暴露给 window
contextBridge.exposeInMainWorld('ipc', ipcRenderer)   // renderer 可任意 invoke

// ❌ CSP 开 unsafe-eval / 允许任意 connect-src
<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-eval'; connect-src *" />
```

### 取舍

- **何时可以关 `sandbox`**：preload 必须用 `fs` / `child_process` 等 Node-only 模块。Talor preload 只用 `ipcRenderer + contextBridge`，完全兼容 sandbox，没有理由关。
- **何时可以放宽 CSP**：需要加载外部 CDN 脚本（Google Fonts / CDN 的 React）。应优先内置依赖，不得已时把白名单做到域名粒度。
- **成本**：CSP 违规时 devtools 会弹错误；新增外部 endpoint 需显式加白名单；不能用 `eval` / `new Function()`。
- **收益**：即使 XSS 漏洞被利用，攻击面被严格收敛 — 无法泄漏外部、无法执行 Node、无法跳转到恶意站点。

### 相关标准

K-MUST-4 / K-MUST-5 / K-MUST-6 / K-MUST-7 / K-MUST-8 / K-MUST-9、K-NEVER-3 / K-NEVER-4 / K-NEVER-5

---

## 模式索引

| 模式                                                              | 相关标准                            | 关键参考实现                                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [P1. 参数校验分层](#p1-参数校验的分层职责)                        | F-MUST-1/2, F-NEVER-1, B-NEVER-1    | `tools/registry.ts`、`tools/builtin/*.ts`、`tools/schema-check.ts`                                                            |
| [P2. 错误建模](#p2-错误建模结构化错误信封)                        | F-MUST-3, G-NEVER-2                 | `tools/types.ts`、`loop/stream-utils.ts`、`mcp/client.ts`                                                                     |
| [P3. 错误边界分类](#p3-错误的边界分类与降级)                      | D-NEVER-1, G-MUST-1, G-SHOULD-2     | `ipc/error-codes.ts`、`chat/orchestrator.ts`                                                                                  |
| [P4. 不变量代码化](#p4-不变量的代码化prompt--code)                | J-MUST-\*, J-SHOULD-1, K-MUST/NEVER | `loop/quote-verifier.ts`、`tools/path-guard.ts`、`tools/builtin/edit.ts`                                                      |
| [P5. Repo CRUD](#p5-repo-crud-契约)                               | E-MUST-\*                           | `repos/session-repo.ts`、`repos/mcp-server-repo.ts`                                                                           |
| [P6. 事务原子性](#p6-事务与原子性)                                | E-MUST-4, I-MUST-1                  | `repos/session-repo.ts:createBatch`、`loop/react-loop.ts`                                                                     |
| [P7. 分层边界](#p7-分层边界与依赖方向)                            | A-MUST-\*, A-NEVER-1, D-MUST-3      | 各模块头部注释、`chat/orchestrator.ts`                                                                                        |
| [P8. Critical vs Optional](#p8-critical-vs-optional-组件分级)     | J-MUST-2, F-MUST-4                  | `prompt/PromptPipeline.ts`、`memory/ShortTermMemory.ts`                                                                       |
| [P9. Fail-Loud vs Silent](#p9-fail-loud-vs-silent-fallback)       | F-MUST-4, J-MUST-2/3                | `tools/registry.ts`（verify）、`loop/react-loop.ts`（context halt）                                                           |
| [P10. 测试风格](#p10-测试风格与隔离)                              | L-MUST-_, L-SHOULD-2, L-NEVER-_     | 各 `*.test.ts`                                                                                                                |
| [P11. Electron 渲染端安全边界](#p11-electron-渲染端安全边界)      | K-MUST-4/5/6/7/8/9, K-NEVER-3/4/5   | `main/index.ts`、`preload/index.ts`、`index.html`、`agent/accounts.ts`                                                        |
| [P12. 领域知识加载策略](#p12--领域知识加载策略)                   | —                                   | `src/main/agent/templates.ts`、`vibe/` 目录                                                                                   |
| [P13. LLM × 系统协作模型 (v3.7.1)](#p13--llm--系统-协作模型-v371) | J-SHOULD-2                          | `src/shared/talor-blocks/`、`src/shared/ui-rendering/`、`src/main/tools/risk-gate.ts`、`src/main/repos/side-effect-ledger.ts` |

---

## P12 — 领域知识加载策略

Agent 需要的领域知识有 4 条加载通道,按规模与共享需求选:

| 规模                          | 范围          | 推荐通道                                                       |
| ----------------------------- | ------------- | -------------------------------------------------------------- |
| 小 (< 50 行)                  | 单 agent 专属 | 直接写在 agentPrompt 的 `## Domain Knowledge` 段               |
| 中 (50-500 行)                | 单 agent 专属 | 放 `<agent_dir>/references/*.md`,声明在 `profile.references[]` |
| 大 (> 500 行) 或跨 agent 共享 | 多 agent 复用 | 提升为 Skill,声明 `profile.skills[]`                           |
| 实时变化的外部源              | 任意          | MCP server 暴露查询工具,声明 `profile.mcpServers[]`            |

判断准则: **这份资料有没有第二个 agent 会用?**

- 有 → Skill
- 没有 → references
- 介于之间 → 先 references,复用时升级为 Skill

参考实现: `src/main/agent/templates.ts` 的内置模板演示了 references 用法;`vibe/` 目录自身是 Skill 思想的项目级体现。

---

---

## P13 — LLM × 系统 协作模型 (v3.7.1)

### 问题

agent 系统是 LLM 和系统协作的产物。如果**职责边界不清**(系统抢 LLM 活 / LLM 担系统责任),会出现两类典型 bug:

- 系统用 regex 判 LLM 意图后不强制只软建议 → 两边不靠岸,生 hint 浪费 token,真危险时也救不了场
- 系统强制 LLM 守 streaming 解析便利的反 JSON 惯例约定 → 增加 LLM 负担,反而降低遵从度

v3.6 在这两个反模式上都踩过(`forced-closure` + `WaitAndAct` + `"type first key"`),v3.7 + v3.7.1 系统性清理。

### 原则

- **LLM 擅长**: 推理 / 判断 / 自然语言 / 语义理解
- **系统擅长**: 执行 / 校验 / 兜底 / 审计 / 事实核对(基于运行时真相数据)
- **判别速记**: 系统能用 runtime 真相数据(tool output / fs / memory)验证的事 → 代码强制;系统只能用 regex 猜测意图的事 → 信任 LLM

### Talor 实施

容错两个维度独立处理:

| 维度  | 机制                                                                      | 谁强制?  |
| ----- | ------------------------------------------------------------------------- | -------- |
| **A** | `signature-dead-loop` / `failure-streak` / `tool-only-loop` detector      | 系统     |
| **A** | `ToolErrorEnvelope` 结构化错误 + 三级 `isErrorOutput` 识别                | 系统     |
| **A** | path-guard / Zod / context overflow halt / abort                          | 系统     |
| **A** | `FALLBACK_SUMMARY` / `failureStreak` / `signatureDeadLoop` forced summary | 系统     |
| **A** | RiskGate + pending_confirm + SessionApprovalMemory + SideEffectLedger     | 系统     |
| **B** | talor block 协议 (parser + 5 UI 卡片 + 流式骨架)                          | LLM 可选 |
| **B** | `inferIntent` 多信号 voting (UI 渲染辅助,**仅 UI 不回馈 loop**)           | 系统     |

**react-loop 终止规则**:

- 有 tool 调用 → continue
- 无 tool 调用 + 有 text → **自然 final** (信任 LLM)
- 无 tool 无 text → empty_text fallback summary

完整协作矩阵 + 反模式 / 正模式表见 [docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md](../../docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md) §2 + §5。

### 历史移除清单(对比 v3.6)

| 移除项                                                 | 版本   | 原因(反模式)                              |
| ------------------------------------------------------ | ------ | ----------------------------------------- |
| `no-marker-streak` detector + `forced-closure` summary | v3.7   | 系统判 LLM "该终止" + 强制纠正灾难        |
| `WaitAndActConflict` + `HallucinatedConfirm` detector  | v3.7.1 | 系统用 regex 判 LLM 意图 + 不强制         |
| Rule 13 中 "type FIRST key" 约束                       | v3.7.1 | 系统侧 streaming 便利压给 LLM             |
| `OutcomeFacts` 中 10+ LLM 输出衍生字段                 | v3.7.1 | 系统为 LLM 输出派生供后续判断的字段       |
| Rule 13 / Rule 12 强制 talor block 教学                | v3.7   | Prompt 教模型严格 schema 但代码不强制     |
| `PENDING_MARKER_HINT` / `STRONG_MARKER_HINT` 注入      | v3.7   | Detector 注入 hint 教 LLM "你刚才错了"    |
| `delegate_agent: checkInstructionCompatibility` (A2)   | v3.7.2 | 同 WaitAndAct (regex 实体匹配判 LLM 意图) |
| `delegate_agent: checkOffTarget` (B2)                  | v3.7.2 | 同上,判子 agent "输出是否答对了"          |
| `RiskGate: pass-to-legacy` + buildTools 嵌入 confirm   | v3.7.2 | 两套路径不统一 (HIGH static 路径独立)     |

### 参考实现

- 协作模型文档 (canonical): [docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md](../../docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md)
- 持续清理: [docs/superpowers/plans/2026-05-13-talor-v3.7.2-cleanup-residual.md](../../docs/superpowers/plans/2026-05-13-talor-v3.7.2-cleanup-residual.md)(删 delegate A2/B2 + RiskGate 路径统一)
- 前置 v3.7: [docs/superpowers/plans/2026-05-13-talor-v3.7-fault-tolerance-rebalance.md](../../docs/superpowers/plans/2026-05-13-talor-v3.7-fault-tolerance-rebalance.md)
- 维度 A 代表: `src/main/loop/detectors/signature-dead-loop.ts`、`src/main/tools/risk-gate.ts`(v3.7.2 路径统一)
- 维度 B 启发式 (仅 UI): `src/shared/ui-rendering/intent-classifier.ts`、`src/shared/ui-rendering/text-heuristics.ts`
- UI 渲染分发: `src/renderer/components/MessageBubble.tsx`(显式 talor block > InferredIntentCard > 普通 markdown)

### 取舍

- 删 `no-marker-streak` / `WaitAndAct` / `HallucinatedConfirm` 后,LLM 意图相关的强制纠偏机制全部去除。代价: 模型连续多步异常的极端场景不再被代码救场。实际收益: 弱模型不再被压力测试出 "自答灾难"。
- inferIntent 假阳性(误判 done → need_input 等)代价 = 一次额外用户澄清,远小于"误进 forced-closure 让模型自答"。
- talor block 协议仍保留,强模型主动 emit 时 UI 优先按 block 渲染。
- 维度 A 的 detector 一律保留:这些是基于 runtime 真相数据的判断,不会越界。

### 相关标准

- **J-SHOULD-2**(canonical): LLM × 系统 协作模型 — 信任 LLM,系统兜底,各做擅长的事
- → `standards.md` §J-SHOULD-2 内含完整协作矩阵 + 反模式 / 正模式表 + 判别速记

---

## P14. SDK-native 优先 (v4)

### 原则

凡 AI SDK v7 已提供的能力,Talor **不再自造**:

| Talor 自造                                      | SDK 原生                                                       | v4 状态                           |
| ----------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| `createDeepSeekFetch` fetch 拦截                | `wrapLanguageModel({ middleware })`                            | ✅ Phase 1                        |
| `generateText` + 字符串解析 (memory 压缩)       | `generateObject` + Zod schema                                  | ✅ Phase 5                        |
| `pending_continuation` talor block + Policy     | `request_continuation` virtual tool                            | ✅ Phase 4a                       |
| `pending_confirm` talor block + RiskGate path 2 | `tool({ needsApproval })`                                      | ⚠️ Phase 4b 删旧;Phase 2 完整待做 |
| `react-loop.ts` 手工 for 循环                   | `streamText({ stopWhen, prepareStep, onStepFinish })` 内置多步 | ⚠️ Phase 3 待做                   |
| `LoopDetector` 接口                             | `StopCondition` 函数 + 闭包 state                              | ⚠️ Phase 3 待做                   |
| `stream-utils:wrapToolOutput`                   | `tool({ toModelOutput })`                                      | ⚠️ Phase 3 待做                   |
| Zod 错信封 + LLM 下步重试                       | `experimental_repairToolCall` 同步修                           | ⚠️ Phase 3 待做                   |

### 反模式: 引入 `streamObject`

SDK 已 `@deprecated`。Talor 永不引入。详见 `standards.md` §F-NEVER-3。

### 参考实现

- v4 plan: [docs/superpowers/plans/2026-05-14-talor-v4-sdk-native.md](../../docs/superpowers/plans/2026-05-14-talor-v4-sdk-native.md)
- middleware 模式: `src/main/providers/middleware/`
- adapter 改造: `src/main/providers/adapters/openai-adapter.ts` (使用 wrapLanguageModel)
- generateObject 应用: `src/main/memory/ShortTermMemory.ts:generateSummary`
- virtual tool: `src/main/tools/builtin/request-continuation.ts`

### 相关标准

- **F-NEVER-3** · 禁止使用 `streamObject`
- **J-SHOULD-3** · AI SDK 信号按"LLM 自陈 / 运行时真相"两类消费

---

## 相关文档

- **[standards.md](standards.md)** — 工程规范（MUST / SHOULD / NEVER）
- **[../../CLAUDE.md](../../CLAUDE.md)** — AI 协作入口
