<!--
doc-id: memory-framework
status: draft
version: 1.0
last-updated: 2026-04-25
depends-on: src/main/ipc/chat.ts, src/main/tools/registry.ts, src/main/repos/session-repo.ts, src/main/db/index.ts
generates: —
-->

# 统一记忆框架 + Prompt 构建插件化设计

**日期**：2026-04-25
**范围**：Talor Desktop — 短期记忆优化、统一记忆框架、Prompt 构建插件化
**状态**：draft

---

## 术语表

| 术语 | 含义 | 代码命名 | 单位/类型 |
|------|------|---------|---------|
| context_limit | 模型 token 窗口上限（估算值） | `context_limit` | number（估算 token 数，字符数/3） |
| recent 区 | 滑动窗口内保留的最新原始消息集合 | `recentMessages` | `ChatMessage[]` |
| old 区 | 超出窗口、需被摘要覆盖的历史消息集合 | `oldMessages` | `ChatMessage[]` |
| 触发阈值 | old+recent 总 token 超过此值时触发摘要 | `threshold` | `0.90 * context_limit` |
| covered_until | 摘要已覆盖的最后一条消息的 `id` | `covered_until` | string（UUID，messages.id） |
| recent_ratio | recent 区允许占用的 token 比例 | `recent_ratio` | float，默认 0.05 |
| summary_ratio | 摘要文本允许占用的 token 比例 | `summary_ratio` | float，默认 0.10 |
| PromptPlugin | Prompt 构建流水线中的单个构建单元 | `PromptPlugin` | interface |
| PipelineContext | 流水线每次执行时的完整输入上下文 | `PipelineContext` | interface |

---

## 核心架构决策：UI 路径与 LLM 路径完全独立

```
messages 表（永久存储，永不删除）
        │
        ├──► UI 路径（renderer）
        │      messageRepo.listBySession() → 全量历史 → 展示给用户
        │      规则：永远显示完整对话记录，不受 token budget 影响
        │
        └──► LLM 路径（main process）
               ShortTermMemory.getContext() → 受 token budget 裁剪的 context → 发给 LLM
               规则：只包含 LLM 处理当前请求所需的内容
```

**两条路径严格禁止交叉**：
- LLM 路径不得修改 `messages` 表中的任何已有消息（包括摘要生成过程）
- UI 路径不得依赖 `session_summaries` 表中的摘要内容
- `session_summaries` 表仅供 LLM 路径使用，对 UI 层完全透明
- 重新进入 session 时：UI 从 `messages` 表读全量历史正常渲染；下次用户发消息时 LLM 路径重新执行 `getContext()`，自动复用已有摘要（`covered_until` 匹配时）

**用户可见差异**：用户在 UI 中能看到所有历史消息原文；LLM 对 old 区消息只知道摘要压缩版本。这是有意为之的设计取舍，spec 不提供补偿机制。

---

## 背景与问题

当前 `toCoreMessages(sessionId)` 直接从 SQLite 拉全量消息塞入 LLM context，没有任何裁剪逻辑。在 Ollama 本地小模型（4K~8K token 窗口）下，长会话会导致 context 超限报错或截断。同时 prompt 组装逻辑散落在 `chat.ts`，工具列表全量传入、员工契约未约束工具权限，缺乏扩展点。

---

## 目标

1. **短期记忆**：滑动窗口 + 增量摘要，解决长会话 context 超限
2. **统一记忆框架**：为长期记忆、知识库预留扩展接口，不改 `chat.ts` 主逻辑
3. **Prompt 构建插件化**：每个 context 组成块独立为 Plugin，可组合可替换
4. **工具动态注入**：员工契约过滤工具权限，工具数 ≥20 时 LLM 两步动态选择
5. **分层 context 配置**：per-provider 配置 > 系统全局默认 > 硬编码兜底值

---

## 现有代码约定（实现必读）

以下为代码审查结论，实现时必须遵守，不得自行推断：

| 项目 | 实际情况 | 影响 |
|------|---------|------|
| LLM 非流式调用 | 使用 `generateText()` from `'ai'`（Vercel AI SDK）；`streamText()` 已用于主流程 | `generateSummary` 和 `ToolSelectionPlugin` 均用 `generateText()`，不引入新依赖 |
| 工具列表获取 | `toolRegistry.getAllSchemas()` — 返回 `Array<{name, description, parameters, schema}>` | `ToolSelectionPlugin` 调用 `getAllSchemas()`，不是 `getAll()` |
| 消息查询 | `messageRepo.listBySession(sessionId)` — 返回 `ChatMessage[]`，`ChatMessage.id` 为 TEXT UUID，无 rowid | `covered_until` 存最后一条被覆盖消息的 `id`（TEXT），不是 rowid |
| `messages` 表主键 | `id TEXT PRIMARY KEY`，`created_at TEXT`（ISO 8601）；无隐式整数 rowid 可用 | 排序用 `ORDER BY created_at ASC`，标记边界用消息 `id` |
| `toCoreMessages()` | 签名 `(sessionId: string): CoreMessage[]`，内部自行查询 DB，不接受消息数组 | ShortTermMemory 不能复用此函数；需在 `src/main/memory/` 中实现 `messagesToCoreMessages(messages: ChatMessage[]): CoreMessage[]`，逻辑与现有函数相同 |
| `ChatMessage` 类型 | `{ id: string, session_id: string, role: MessageRole, content: string, created_at: string }` — `content` 为 JSON 字符串 | `estimateMessage` 需 `JSON.parse(msg.content)` 后提取文本 |

---

## 模块结构

```
src/main/prompt/
  PromptPipeline.ts
  plugins/
    SystemPlugin.ts
    AgentPromptPlugin.ts
    MemoryPlugin.ts
    ToolSelectionPlugin.ts
    UserMessagePlugin.ts
  types.ts

src/main/memory/
  MemoryManager.ts
  ShortTermMemory.ts         ← 本次实现
  LongTermMemory.ts          ← 接口 + stub（不实现）
  KnowledgeBase.ts           ← 接口 + stub（不实现）
  types.ts                   ← 共享类型 + 工具函数

src/main/db/index.ts         ← 新增 session_summaries 表；providers 表加 3 字段
src/main/ipc/chat.ts         ← 主流程替换为 pipeline.build()；toCoreMessages() 保留不删
src/shared/types/provider.ts ← Provider 类型新增 3 个可选字段
```

---

## 共享工具函数（`src/main/memory/types.ts`）

### `estimate(content: string): number`

```typescript
export function estimate(content: string): number {
  return Math.ceil(content.length / 3)
  // 中文字符除以 3，比英文的 /4 更保守，无需引入 tiktoken
}
```

### `estimateMessage(msg: ChatMessage): number`

```typescript
export function estimateMessage(msg: ChatMessage): number {
  const blocks: ContentBlock[] = JSON.parse(msg.content)
  const text = blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
  const imageCount = blocks.filter(b => b.type === 'image').length
  return estimate(text) + imageCount * 85  // 图片按固定 85 token 估算
}
```

### `extractJsonArray(text: string): string[]`

```typescript
export function extractJsonArray(text: string): string[] {
  // LLM 有时用 markdown 代码块包裹 JSON，先剥离
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenceMatch ? fenceMatch[1].trim() : text.trim()
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('Expected JSON array')
  return parsed as string[]
}
```

### `messagesToCoreMessages(messages: ChatMessage[]): CoreMessage[]`

**位置**：`src/main/memory/types.ts`，逻辑与 `chat.ts` 中 `toCoreMessages()` 相同，但接受 `ChatMessage[]` 而非从 DB 重新查询。仅处理 recent 区消息，不做 tool-result 窗口截断（old 区已整体摘要，不需此逻辑）。

---

## 类型定义（`src/main/prompt/types.ts`）

```typescript
import type { CoreMessage } from 'ai'
import type { Provider } from '../../shared/types/provider'

export interface PromptPlugin {
  name: string
  build(ctx: PipelineContext): Promise<PluginResult>
}

export interface PipelineContext {
  sessionId: string
  agentId: string
  currentMessage: {
    text: string
    attachments?: Attachment[]
  }
  provider: Provider
  providerConfig: ProviderContextConfig
  workspacePath: string | undefined
}

export interface PluginResult {
  messages: CoreMessage[]     // 无贡献时返回空数组，不为 undefined
  tools: ToolSchema[]         // 无贡献时返回空数组，不为 undefined
  tokenEstimate: number
}

export interface ProviderContextConfig {
  provider: Provider          // 完整 provider 对象，供 generateSummary 调用
  context_limit: number       // 已应用三级 fallback，不为 null/undefined
  recent_ratio: number        // 默认 0.05
  summary_ratio: number       // 默认 0.10
}

// ToolSchema 对应 toolRegistry.getAllSchemas() 的返回元素类型
export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
  schema?: Record<string, unknown>
}
```

---

## 配置优先级（`resolveProviderConfig()`）

**位置**：`src/main/prompt/PromptPipeline.ts`，导出函数。

```typescript
export function resolveProviderConfig(provider: Provider): ProviderContextConfig {
  return {
    provider,
    context_limit: provider.context_limit
                   ?? appConfig.get('default_context_limit')  // electron-store，key='default_context_limit'
                   ?? 8000,
    recent_ratio:  provider.recent_ratio  ?? 0.05,
    summary_ratio: provider.summary_ratio ?? 0.10,
  }
}
```

**`default_context_limit` 初始化**：在 `src/main/index.ts` 的 `app.whenReady()` 回调中，若该 key 不存在则执行：

```typescript
if (appConfig.get('default_context_limit') === undefined) {
  appConfig.set('default_context_limit', 8000)
}
```

---

## PromptPipeline（`src/main/prompt/PromptPipeline.ts`）

```typescript
export class PromptPipeline {
  private plugins: PromptPlugin[]

  constructor(memoryManager: MemoryManager) {
    this.plugins = [
      new SystemPlugin(),
      new AgentPromptPlugin(),
      new MemoryPlugin(memoryManager),
      new ToolSelectionPlugin(),
      new UserMessagePlugin(),
    ]
  }

  async build(ctx: PipelineContext): Promise<{ messages: CoreMessage[], tools: ToolSchema[] }> {
    const allMessages: CoreMessage[] = []
    const allTools: ToolSchema[] = []

    for (const plugin of this.plugins) {
      const result = await plugin.build(ctx)
      allMessages.push(...result.messages)
      allTools.push(...result.tools)
    }

    return { messages: allMessages, tools: allTools }
  }
}
```

**最终 `messages` 数组顺序**（固定，由 Plugin 执行顺序决定）：

```
index 0     : [system] SystemPlugin — 环境信息
index 1     : [system] AgentPromptPlugin — 员工契约（平台员工时跳过，不插入）
index N     : [system] MemoryPlugin — 摘要（未触发时跳过，不插入）
index N+1.. : [user/assistant/tool] MemoryPlugin — recent 历史消息
index last  : [user] UserMessagePlugin — 当前用户消息
```

**`chat.ts` 改动**：

```typescript
// 删除主流程中的：
// const currentMessages = toCoreMessages(sessionId)

// 替换为（在 ReAct 循环每步开始前调用）：
const providerConfig = resolveProviderConfig(provider)
const pipelineCtx: PipelineContext = {
  sessionId,
  agentId,          // 当前会话关联的 agent id
  currentMessage: { text: userContent, attachments },
  provider,
  providerConfig,
  workspacePath: appConfig.get('workspace_path'),
}
const { messages: currentMessages, tools: currentTools } = await pipeline.build(pipelineCtx)
```

`toCoreMessages()` **保留**在 `chat.ts` 中，不删除（仍被 forced summary step 的遗留逻辑引用）。

**两处调用均需替换**：
- 行 359：ReAct 循环每步开始前，`const currentMessages = toCoreMessages(sessionId)` → 替换为 `pipeline.build(pipelineCtx)`
- 行 475：forced summary step，`const summaryMessages = toCoreMessages(sessionId)` → 同样替换为 `pipeline.build(pipelineCtx)`，`pipelineCtx` 与主流程相同（forced summary 不带工具，需在调用 `streamText` 时移除 `tools` 参数）

---

## SystemPlugin（`src/main/prompt/plugins/SystemPlugin.ts`）

```typescript
export class SystemPlugin implements PromptPlugin {
  name = 'SystemPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const lines = [
      `当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      `操作系统：${process.platform}`,
      `Workspace：${ctx.workspacePath ?? '未设置'}`,
    ]
    const content = lines.join('\n')
    return {
      messages: [{ role: 'system', content }],
      tools: [],
      tokenEstimate: estimate(content),
    }
  }
}
```

---

## AgentPromptPlugin（`src/main/prompt/plugins/AgentPromptPlugin.ts`）

```typescript
export class AgentPromptPlugin implements PromptPlugin {
  name = 'AgentPromptPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const agent = loadAgent(ctx.agentId)
    // loadAgent 为现有函数，未找到时抛出 Error

    if (agent.kind === 'platform') {
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    // buildStructuredPrompt 为现有函数，输出含 ## 角色定义 / ## 能力范围 / ## 工作流程 / ## 交付标准
    let content = buildStructuredPrompt(agent)

    if (agent.manual) {
      const manualPath = path.resolve(process.cwd(), agent.manual)
      if (fs.existsSync(manualPath)) {
        content += '\n\n' + fs.readFileSync(manualPath, 'utf-8')
      }
      // 文件不存在：静默跳过，不抛错
    }

    return {
      messages: [{ role: 'system', content }],
      tools: [],
      tokenEstimate: estimate(content),
    }
  }
}
```

---

## MemoryPlugin（`src/main/prompt/plugins/MemoryPlugin.ts`）

```typescript
export class MemoryPlugin implements PromptPlugin {
  name = 'MemoryPlugin'
  constructor(private memoryManager: MemoryManager) {}

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const result = await this.memoryManager.getContext(ctx.sessionId, ctx.providerConfig)

    const messages: CoreMessage[] = []
    if (result.summaryMessage !== null) {
      messages.push(result.summaryMessage)
    }
    messages.push(...result.recentMessages)

    return { messages, tools: [], tokenEstimate: result.tokenEstimate }
  }
}
```

---

## MemoryManager（`src/main/memory/MemoryManager.ts`）

```typescript
export class MemoryManager {
  private shortTerm: ShortTermMemory

  constructor() {
    this.shortTerm = new ShortTermMemory()
  }

  async getContext(sessionId: string, config: ProviderContextConfig): Promise<MemoryContext> {
    return this.shortTerm.getContext(sessionId, config)
    // 未来：合并长期记忆、知识库结果
  }
}
```

---

## ShortTermMemory（`src/main/memory/ShortTermMemory.ts`）

### getContext — 完整状态机

```typescript
export class ShortTermMemory {
  async getContext(sessionId: string, config: ProviderContextConfig): Promise<MemoryContext> {

    // 1. 拉取全量历史消息，按 created_at ASC
    const allMessages: ChatMessage[] = messageRepo.listBySession(sessionId)
    // messageRepo.listBySession 内部使用 ORDER BY created_at ASC

    // 2. session 为空：直接返回
    if (allMessages.length === 0) {
      return { summaryMessage: null, recentMessages: [], tokenEstimate: 0 }
    }

    // 3. 计算全量 token 估算
    const totalTokens = allMessages.reduce((sum, m) => sum + estimateMessage(m), 0)
    const threshold    = 0.90 * config.context_limit
    const recentBudget = config.recent_ratio * config.context_limit

    // ── 路径 A：未超阈值，全量返回 ──
    if (totalTokens <= threshold) {
      return {
        summaryMessage: null,
        recentMessages: messagesToCoreMessages(allMessages),
        tokenEstimate: totalTokens,
      }
    }

    // ── 路径 B：超阈值，分割 recent / old ──

    // 从最新消息往前填满 recentBudget
    const recentMessages: ChatMessage[] = []
    let recentTokens = 0

    for (const msg of [...allMessages].reverse()) {
      const est = estimateMessage(msg)
      if (recentTokens + est <= recentBudget) {
        recentMessages.unshift(msg)
        recentTokens += est
      } else {
        break
      }
    }

    const oldMessages: ChatMessage[] = allMessages.slice(0, allMessages.length - recentMessages.length)

    // ── 边界情况：所有消息都在 recent 区（极短消息） ──
    // totalTokens > threshold 但 recentBudget 能容纳全部消息，退化为路径 A
    if (oldMessages.length === 0) {
      return {
        summaryMessage: null,
        recentMessages: messagesToCoreMessages(allMessages),
        tokenEstimate: totalTokens,
      }
    }

    const lastOldMessageId: string = oldMessages[oldMessages.length - 1].id  // TEXT UUID

    // ── 摘要：判断是否需要重新生成 ──
    const summaryBudget = config.summary_ratio * config.context_limit
    const existing: SessionSummary | null = this.loadSummary(sessionId)

    let summaryText: string

    if (existing === null || existing.covered_until !== lastOldMessageId) {
      // 需要重新生成：
      // - existing === null：首次触发
      // - covered_until !== lastOldMessageId：old 区末尾变化（新消息推出了更多旧消息）
      summaryText = await generateSummary(
        existing?.summary_text ?? null,
        oldMessages,
        summaryBudget,
        config,
      )
      this.saveSummary(sessionId, summaryText, lastOldMessageId, estimate(summaryText))
    } else {
      // covered_until === lastOldMessageId：old 区末尾未变化，直接复用
      summaryText = existing.summary_text
    }

    return {
      summaryMessage: { role: 'system', content: `[对话历史摘要]\n${summaryText}` },
      recentMessages: messagesToCoreMessages(recentMessages),
      tokenEstimate: estimate(summaryText) + recentTokens,
    }
  }

  private loadSummary(sessionId: string): SessionSummary | null {
    const db = getDb()
    return db.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get(sessionId) as SessionSummary | null
  }

  private saveSummary(sessionId: string, text: string, coveredUntil: string, tokenEst: number): void {
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO session_summaries
        (session_id, summary_text, covered_until, token_estimate, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, text, coveredUntil, tokenEst, new Date().toISOString())
  }
}
```

### generateSummary

```typescript
async function generateSummary(
  prevSummary: string | null,
  oldMessages: ChatMessage[],
  summaryBudget: number,
  config: ProviderContextConfig,
): Promise<string> {
  const summaryBudgetChars = summaryBudget * 3  // token → 字符上限

  const parts: string[] = []
  if (prevSummary !== null) {
    parts.push(`[已有摘要]\n${prevSummary}`)
  }
  parts.push('[需压缩的对话]')
  for (const msg of oldMessages) {
    // 工具结果沿用现有 8KB 截断（MAX_TOOL_RESULT_BYTES = 8192）
    const raw = msg.content.length > 8192
      ? msg.content.slice(0, 8192) + '…[已截断]'
      : msg.content
    parts.push(`${msg.role}: ${raw}`)
  }

  const userContent = parts.join('\n\n')
  const systemPrompt =
    `请将以下对话历史压缩为简洁摘要，保留关键信息、决策和结论，` +
    `忽略闲聊和重复内容。用中文，输出不超过 ${summaryBudgetChars} 个字。`

  // 使用 generateText（非流式），复用现有 buildModel(provider) 工具函数
  // buildModel 为 chat.ts 中已有的 helper，根据 provider 返回 Vercel AI SDK model 对象
  const model = buildModel(config.provider)

  // 超时：1 小时（3600000ms）。超时或 API 报错均抛出 Error，由调用方处理
  const { text } = await generateText({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  },
    ],
    maxTokens: Math.ceil(summaryBudget),
    abortSignal: AbortSignal.timeout(3_600_000),  // 1 小时超时
  })

  // 信任 LLM maxTokens 控制输出长度，不对 text 截断
  return text
}
```

**错误处理**：`generateSummary` 内部不捕获异常。调用方 `getContext()` 不捕获，异常向上传播到 `MemoryPlugin.build()` → `PromptPipeline.build()` → `chat.ts` 主流程。`chat.ts` 现有的顶层 `try/catch` 负责捕获，向用户返回错误，阻断本次对话请求。

**并发处理**：不加锁。同一 session 并发两次请求同时触发摘要生成时，两次 `generateSummary` 独立运行，最终 `INSERT OR REPLACE` 后写入的覆盖先写入的。接受重复 LLM 调用，不作额外处理。

---

## ToolSelectionPlugin（`src/main/prompt/plugins/ToolSelectionPlugin.ts`）

```typescript
export class ToolSelectionPlugin implements PromptPlugin {
  name = 'ToolSelectionPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const agent    = loadAgent(ctx.agentId)
    // toolRegistry.getAllSchemas() 返回内置工具 + MCP 工具的完整列表
    const allTools: ToolSchema[] = toolRegistry.getAllSchemas()

    // ── 阶段一：员工契约过滤 ──
    // agent.capabilities.tools 为工具名称数组，如 ["read_file", "query_db"]
    // 空数组或字段不存在时，不过滤，使用全量
    const allowed: ToolSchema[] =
      (agent.capabilities?.tools?.length ?? 0) > 0
        ? allTools.filter(t => agent.capabilities!.tools!.includes(t.name))
        : allTools

    // ── 阶段二：数量判断（< 20 直接传入）──
    if (allowed.length < 20) {
      return { messages: [], tools: allowed, tokenEstimate: this.estimateTools(allowed) }
    }

    // ── 阶段三：LLM 两步动态选择（>= 20）──
    const toolList = allowed.map(t => `- ${t.name}: ${t.description}`).join('\n')
    const selectionPrompt =
      `用户消息：${ctx.currentMessage.text}\n\n` +
      `可用工具列表：\n${toolList}\n\n` +
      `请从上述工具中选出完成用户任务所需的工具，` +
      `返回 JSON 数组，格式：["tool_name_1", "tool_name_2"]。只选必要的工具。`

    try {
      const model = buildModel(ctx.provider)
      const { text } = await generateText({
        model,
        messages: [{ role: 'user', content: selectionPrompt }],
        maxTokens: 256,
      })

      // extractJsonArray 剥离 markdown 代码块后 JSON.parse，失败时抛出 Error
      const selectedNames = extractJsonArray(text)
      const selected = allowed.filter(t => selectedNames.includes(t.name))

      return { messages: [], tools: selected, tokenEstimate: this.estimateTools(selected) }
    } catch (err) {
      // 降级：LLM 调用失败或 JSON 解析失败
      // 取前 19 个（19 < 20，下次不再触发 LLM 选择）
      log.warn('[ToolSelectionPlugin] LLM 动态选择失败，降级到前 19 个工具', err)
      const fallback = allowed.slice(0, 19)
      return { messages: [], tools: fallback, tokenEstimate: this.estimateTools(fallback) }
    }
  }

  private estimateTools(tools: ToolSchema[]): number {
    return tools.reduce((s, t) => s + estimate(t.name + (t.description ?? '')), 0)
  }
}
```

---

## UserMessagePlugin（`src/main/prompt/plugins/UserMessagePlugin.ts`）

```typescript
export class UserMessagePlugin implements PromptPlugin {
  name = 'UserMessagePlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const msg = ctx.currentMessage
    const content: UserContentPart[] = []

    content.push({ type: 'text', text: msg.text })

    for (const att of (msg.attachments ?? [])) {
      if (att.mediaType?.startsWith('image/')) {
        content.push({ type: 'image', image: att.base64, mimeType: att.mediaType })
      } else {
        content.push({ type: 'text', text: `[文件: ${att.name}]\n${att.content ?? ''}` })
      }
    }

    const attachmentTokens = (msg.attachments ?? []).reduce((sum, a) => {
      if (a.mediaType?.startsWith('image/')) return sum + 85
      return sum + estimate(a.content ?? '')
    }, 0)

    return {
      messages: [{ role: 'user', content }],
      tools: [],
      tokenEstimate: estimate(msg.text) + attachmentTokens,
    }
  }
}
```

---

## 数据库变更

### 新增表

```sql
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id     TEXT NOT NULL PRIMARY KEY,
  summary_text   TEXT NOT NULL,
  covered_until  TEXT NOT NULL,
  -- covered_until 存储 messages.id（TEXT UUID），即 old 区最后一条消息的 id
  -- 查询时通过 messageRepo.listBySession() 获取消息列表后取最后一条 .id
  token_estimate INTEGER NOT NULL,
  created_at     TEXT NOT NULL    -- ISO 8601，与 messages.created_at 格式一致
);
```

### providers 表变更

```sql
-- 均可为 NULL，NULL 时 resolveProviderConfig() 使用 fallback
ALTER TABLE providers ADD COLUMN context_limit    INTEGER;
ALTER TABLE providers ADD COLUMN recent_ratio     REAL;
ALTER TABLE providers ADD COLUMN summary_ratio    REAL;
```

### `SessionSummary` 类型（`src/main/memory/types.ts`）

```typescript
export interface SessionSummary {
  session_id:     string
  summary_text:   string
  covered_until:  string   // messages.id（TEXT UUID）
  token_estimate: number
  created_at:     string   // ISO 8601
}
```

---

## 改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/main/prompt/types.ts` | 新增 | PromptPlugin、PipelineContext、PluginResult、ProviderContextConfig、ToolSchema |
| `src/main/prompt/PromptPipeline.ts` | 新增 | 流水线入口，resolveProviderConfig() |
| `src/main/prompt/plugins/SystemPlugin.ts` | 新增 | 环境信息 |
| `src/main/prompt/plugins/AgentPromptPlugin.ts` | 新增 | 员工契约 prompt |
| `src/main/prompt/plugins/MemoryPlugin.ts` | 新增 | 调用 MemoryManager |
| `src/main/prompt/plugins/ToolSelectionPlugin.ts` | 新增 | 工具过滤 + LLM 动态选择 |
| `src/main/prompt/plugins/UserMessagePlugin.ts` | 新增 | 用户消息 + 附件 |
| `src/main/memory/types.ts` | 新增 | MemoryContext、SessionSummary、estimate()、estimateMessage()、messagesToCoreMessages()、extractJsonArray() |
| `src/main/memory/MemoryManager.ts` | 新增 | 统一记忆入口 |
| `src/main/memory/ShortTermMemory.ts` | 新增 | 滑动窗口 + 增量摘要 |
| `src/main/memory/LongTermMemory.ts` | 新增 | 接口定义 + stub |
| `src/main/memory/KnowledgeBase.ts` | 新增 | 接口定义 + stub |
| `src/main/db/index.ts` | 修改 | 新增 session_summaries 表；providers 表加 3 字段 |
| `src/main/ipc/chat.ts` | 修改 | 主流程调用替换为 pipeline.build()；toCoreMessages() 保留不删 |
| `src/shared/types/provider.ts` | 修改 | Provider 新增 context_limit?: number、recent_ratio?: number、summary_ratio?: number |

**共 15 个文件，12 新增 3 修改。超过 CLAUDE.md 5 文件上限，实现前需用户确认。**

---

## 不在本次范围内

- 长期记忆实现（跨会话持久化）
- 知识库 / RAG / 向量检索
- 摘要异步队列（当前同步触发，首次触发有延迟）
- Provider 配置 UI（设置页暴露三个新字段）
- Plugin 热插拔 / 动态加载
- `buildModel()` 函数提取为独立模块（当前直接复用 chat.ts 中的实现）

---

## 验收标准

### US-001 短期记忆：滑动窗口 + 增量摘要

- [ ] **AC-001-01**：Given session（id=`s1`）共 50 条消息，每条 content 为 10 个中文字符（`estimateMessage` 返回 4），总 token=200；provider `context_limit=8000`，`recent_ratio=0.05`，阈值=7200 → When 调用 `ShortTermMemory.getContext('s1', config)` → Then [响应] 返回 `summaryMessage=null`，`recentMessages.length=50`，`tokenEstimate=200`；[数据] `session_summaries` 表无 `session_id='s1'` 记录
  - 验证依赖：mock `messageRepo.listBySession` 返回 50 条测试消息；config 中 context_limit=8000
  - 推荐验证工具：Vitest 单元测试（mock messageRepo）
  - 预估验证时间：<1min

- [ ] **AC-001-02**：Given session（id=`s2`）共 100 条消息，每条 300 中文字符（estimateMessage 返回 100），总 token=10000 > 7200；recentBudget=400（5%×8000）；mock `generateText` 返回固定文本 `"摘要内容"` → When 调用 `ShortTermMemory.getContext('s2', config)` → Then [响应] `summaryMessage.content` 以 `"[对话历史摘要]\n"` 开头；`recentMessages` 的 token 总和 ≤ 400；[数据] `session_summaries` 表新增 `session_id='s2'` 记录，`covered_until` 等于第 96 条消息（最后一条 old 消息）的 `id`
  - 验证依赖：mock messageRepo 返回 100 条消息；mock generateText；context_limit=8000
  - 推荐验证工具：Vitest 单元测试
  - 预Estimated 验证时间：<1min

- [ ] **AC-001-03**：Given `session_summaries` 已有 `session_id='s3'` 记录（`covered_until='msg-50'`），当前 old 区末尾消息 `id` 仍为 `'msg-50'`（消息未继续增长到推出新的旧消息） → When 调用 `ShortTermMemory.getContext('s3', config)` → Then [数据] `generateText` 未被调用（spy 调用次数=0）；`session_summaries` 中该记录 `created_at` 未更新
  - 验证依赖：预置 session_summaries 记录；spy on generateText
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<1min

- [ ] **AC-001-04**：Given `session_summaries` 已有记录（`covered_until='msg-50'`，`summary_text='旧摘要'`），追加新消息后 old 区末尾变为 `'msg-53'` → When 调用 `ShortTermMemory.getContext('s4', config)` → Then [数据] `generateText` 被调用 1 次；调用时 `messages[1].content`（user 消息内容）包含字符串 `"[已有摘要]\n旧摘要"` 和 `msg-51`、`msg-52`、`msg-53` 三条消息内容；`session_summaries.covered_until` 更新为 `'msg-53'`
  - 验证依赖：预置 session_summaries 记录；mock messageRepo 返回更多消息；spy on generateText 捕获入参
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<1min

- [ ] **AC-001-05**：Given session 为空（0 条消息） → When 调用 `ShortTermMemory.getContext('s5', config)` → Then [响应] 返回 `summaryMessage=null`，`recentMessages=[]`，`tokenEstimate=0`；`generateText` 未被调用
  - 验证依赖：mock messageRepo 返回空数组
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

- [ ] **AC-001-06**：Given `generateText`（摘要生成）抛出 Error('API timeout') → When 调用 `ShortTermMemory.getContext('s6', config)`（消息超阈值，需生成摘要） → Then [响应] `getContext` 向上抛出该 Error，不吞异常；`pipeline.build()` 的调用方收到异常；`session_summaries` 表无新增记录
  - 验证依赖：mock generateText 抛出 Error；mock messageRepo 返回超阈值消息
  - 推荐验证工具：Vitest 单元测试（`await expect(...).rejects.toThrow('API timeout')`）
  - 预估验证时间：<30s

---

- [ ] **AC-001-07**：Given session（id=`s7`）共 200 条消息，总 token 远超 threshold，`session_summaries` 已有摘要记录 → When 前端通过 `session:messages` IPC 获取该 session 的消息列表 → Then [响应] 返回全部 200 条消息原文，不受 `session_summaries` 影响；`session_summaries` 表内容未因此次 IPC 调用发生任何变化
  - 验证依赖：DB 中预置 200 条消息和一条 session_summaries 记录
  - 推荐验证工具：Vitest 集成测试（直接调用 session IPC handler）
  - 预估验证时间：<1min

---

### US-002 配置优先级

- [ ] **AC-002-01**：Given `provider.context_limit=16000`；`appConfig.get('default_context_limit')` 返回 `8000` → When 调用 `resolveProviderConfig(provider)` → Then [响应] 返回对象 `context_limit===16000`
  - 验证依赖：mock appConfig.get 返回 8000
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

- [ ] **AC-002-02**：Given `provider.context_limit=undefined`；`appConfig.get('default_context_limit')` 返回 `12000` → When 调用 `resolveProviderConfig(provider)` → Then [响应] 返回对象 `context_limit===12000`
  - 验证依赖：mock appConfig.get 返回 12000
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

- [ ] **AC-002-03**：Given `provider.context_limit=undefined`；`appConfig.get('default_context_limit')` 返回 `undefined` → When 调用 `resolveProviderConfig(provider)` → Then [响应] 返回对象 `context_limit===8000`
  - 验证依赖：mock appConfig.get 返回 undefined
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

---

### US-003 Prompt 构建流水线

- [ ] **AC-003-01**：Given `agentId='build'`（kind=platform）；session 消息总 token ≤ threshold → When 调用 `pipeline.build(ctx)` → Then [响应] `messages[0].role==='system'` 且 `messages[0].content` 包含 `"当前时间："` 和 `"操作系统："`；`messages` 中不存在任何 content 包含 `"## 角色定义"` 的条目
  - 验证依赖：mock loadAgent 返回 kind=platform；mock messageRepo 返回少量消息
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

- [ ] **AC-003-02**：Given `agentId='data-analyst'`（kind=worker，有 role/capabilities/workflow）；mock `buildStructuredPrompt` 返回含 `"## 角色定义"` 的文本 → When 调用 `pipeline.build(ctx)` → Then [响应] `messages` 中存在一条 `role==='system'` 且 content 包含 `"## 角色定义"` 的条目，且该条目的 index > 0（位于 SystemPlugin 输出之后）
  - 验证依赖：mock loadAgent 返回 kind=worker；mock buildStructuredPrompt
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

- [ ] **AC-003-03**：Given 代码已合并 → When 执行 `grep -n "= toCoreMessages\|await toCoreMessages" src/main/ipc/chat.ts` → Then [响应] 输出为空（主流程调用已删除，函数定义保留）
  - 验证依赖：无
  - 推荐验证工具：grep 命令
  - 预估验证时间：<10s

- [ ] **AC-003-04**：Given 摘要已触发（`summaryMessage` 不为 null），recent 区有 3 条消息，当前用户消息为 `"hello"` → When 调用 `pipeline.build(ctx)`（平台员工） → Then [响应] `messages` 数组顺序依次为：`[system]` 环境信息、`[system]` 摘要（content 以 `[对话历史摘要]` 开头）、3 条 recent 历史消息、`[user]` content 包含 `"hello"` 的当前消息；共 6 条
  - 验证依赖：mock 所有 Plugin；mock ShortTermMemory 返回有摘要的 MemoryContext
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

---

### US-004 工具动态注入

- [ ] **AC-004-01**：Given `toolRegistry.getAllSchemas()` 返回 10 个工具（名称 tool_1~tool_10）；`agent.capabilities.tools=['tool_1','tool_3']` → When 调用 `ToolSelectionPlugin.build(ctx)` → Then [响应] `tools.length===2`；`tools` 包含 `name='tool_1'` 和 `name='tool_3'` 的元素；`generateText` 未被调用
  - 验证依赖：mock toolRegistry.getAllSchemas；mock loadAgent
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

- [ ] **AC-004-02**：Given `toolRegistry.getAllSchemas()` 返回 25 个工具（名称 tool_1~tool_25）；agent 无 `capabilities.tools`；mock `generateText` 返回 `'["tool_2","tool_5","tool_10"]'` → When 调用 `ToolSelectionPlugin.build(ctx)` → Then [响应] `generateText` 被调用 1 次；调用时 `messages[0].content` 包含全部 25 个工具名称；`tools.length===3`，包含 tool_2、tool_5、tool_10
  - 验证依赖：mock toolRegistry；mock generateText；spy 捕获调用入参
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

- [ ] **AC-004-03**：Given `toolRegistry.getAllSchemas()` 返回 25 个工具；mock `generateText` 抛出 Error('timeout') → When 调用 `ToolSelectionPlugin.build(ctx)` → Then [响应] 方法正常返回（不抛错）；`tools.length===19`（`allowed.slice(0,19)`）；`log.warn` 被调用 1 次，第一个参数包含 `'LLM 动态选择失败'`
  - 验证依赖：mock toolRegistry；mock generateText 抛错；spy on log.warn
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

- [ ] **AC-004-04**：Given `toolRegistry.getAllSchemas()` 返回 15 个工具；agent 无 `capabilities.tools` → When 调用 `ToolSelectionPlugin.build(ctx)` → Then [响应] `tools.length===15`；`generateText` 未被调用（数量 < 20 直接返回）
  - 验证依赖：mock toolRegistry 返回 15 个工具；spy on generateText
  - 推荐验证工具：Vitest 单元测试
  - 预估验证时间：<30s

---

## 待确认项统计

📋 待确认项：0 处
📋 待补充项：0 处

所有假设均已通过代码审查确认，无幻觉项。
