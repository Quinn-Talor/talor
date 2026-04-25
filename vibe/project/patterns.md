# Talor Desktop 代码模式索引

> **长期维护文档**。记录本项目已确立的代码模式，AI 编码时必须遵循。
> 每个 Pattern 包含真实代码片段，供 AI 对照复用。
>
> 项目地图见 `overview.md`。硬性约束见 `standards.md`。

---

## 模式索引

| # | 名称 | 适用场景 | 文件位置 |
|---|------|---------|---------|
| P-01 | IPC Handler 注册模式 | 新增主进程 IPC 处理器 | `src/main/ipc/*.ts` |
| P-02 | ReAct 工具调用循环 | LLM 多步工具调用 | `src/main/ipc/chat.ts` |
| P-03 | 工具定义与注册模式 | 新增 builtin 工具 | `src/main/tools/builtin/*.ts` |
| P-04 | 工具安全边界模式 | 所有文件操作工具 | `src/main/tools/builtin/read.ts`, `write.ts`, `bash.ts` |
| P-05 | PromptPipeline 插件模式 | 新增 Prompt 构建插件 | `src/main/prompt/plugins/*.ts` |
| P-06 | Zustand Store 模式 | 渲染进程全局状态 | `src/renderer/store/*.ts` |
| P-07 | IPC 流式事件订阅模式 | React hook 消费 IPC 事件流 | `src/renderer/hooks/useStreamingMessage.ts` |
| P-08 | Repository CRUD 模式 | SQLite 数据访问 | `src/main/repos/session-repo.ts` |
| P-09 | Singleton 服务模式 | 跨 handler 共享实例 | `src/main/store/config-store.ts` |
| P-10 | ContentBlock 多模态消息模式 | 构建 / 解析消息内容 | `src/shared/types/message.ts`, `src/main/ipc/chat.ts` |
| P-11 | 上下文窗口裁剪模式 | 超长会话的 token 控制 | `src/main/memory/ShortTermMemory.ts` |
| P-12 | 工具结果截断模式 | 防止工具结果溢出 context | `src/main/ipc/chat.ts` |

---

## P-01：IPC Handler 注册模式

**适用场景**：新增主进程 IPC handler，需要在 `src/main/index.ts` 统一注册。

### Good ✅

```typescript
// src/main/ipc/session.ts
export function registerSessionHandlers(): void {
  ipcMain.handle('session:list', async () => {
    return sessionRepo.list()
  })
  ipcMain.handle('session:create', async (_event, input: { title: string; provider_id: string }) => {
    return sessionRepo.create({ ...input, id: uuidv4(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  })
}

// src/main/index.ts — 统一注册入口
import { registerChatHandlers } from './ipc/chat'
import { registerSessionHandlers } from './ipc/session'

app.whenReady().then(() => {
  registerChatHandlers()
  registerSessionHandlers()
  // ...
})
```

### Anti-pattern ❌

```typescript
// 直接在 index.ts 内联 handler 逻辑
app.whenReady().then(() => {
  ipcMain.handle('session:list', async () => {
    // 内联 100 行逻辑
    const db = getDb()
    return db.prepare('SELECT * FROM sessions').all()
  })
})
```

**规则**：每个模块的 handler 封装在独立 `register*Handlers()` 函数中，index.ts 只做注册调用。

---

## P-02：ReAct 工具调用循环

**适用场景**：需要支持 LLM 多步工具调用的场景。

### Good ✅

```typescript
// src/main/ipc/chat.ts
const maxSteps = 30
for (let step = 0; step < maxSteps; step++) {
  if (abortController.signal.aborted) break

  // 每步重新 build prompt（含最新 memory 和工具列表）
  const { messages: currentMessages } = await _pipeline.build(pipelineCtx)

  const stepToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []

  const result = streamText({
    model,
    messages: currentMessages,
    tools,
    abortSignal: abortController.signal,
    onChunk({ chunk }) {
      if (chunk.type === 'text-delta') {
        mainWindow.webContents.send('chat:stream', { session_id: sessionId, delta: chunk.text, done: false })
      } else if (chunk.type === 'tool-call') {
        stepToolCalls.push({ toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input })
        mainWindow.webContents.send('chat:tool-call', { ... })
      }
    },
  })

  await result.consumeStream()

  // 无工具调用 = 最终回答，退出循环
  if (stepToolCalls.length === 0) {
    if (stepText) messageRepo.create({ role: 'assistant', content: [{ type: 'text', text: stepText }] })
    break
  }
  // 有工具调用 = 执行工具，结果持久化后继续循环
}
```

### Anti-pattern ❌

```typescript
// 递归调用（stack overflow 风险）
async function reactStep(messages: CoreMessage[], depth: number): Promise<void> {
  if (depth > 30) return
  const result = await callLLM(messages)
  if (result.toolCalls.length > 0) {
    await reactStep([...messages, ...toolResults], depth + 1) // ❌ 递归
  }
}
```

**规则**：ReAct 循环用 `for` 循环实现，`maxSteps = 30` 防止无限循环；`abortController.signal.aborted` 在每步开头检查以支持中止。

---

## P-03：工具定义与注册模式

**适用场景**：新增 builtin 工具。

### Good ✅

```typescript
// src/main/tools/builtin/read.ts
const readTool = {
  name: 'read',
  description: 'Read content of a file. Returns file content as string, or error message.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace or absolute path' },
    },
    required: ['path'],
  },
  // riskLevel 省略 = LOW（默认）；文件写入/执行设为 'HIGH' as const
  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const params = input as { path: string }
    // 安全边界检查（见 P-04）
    // ...
    return { output: content.toString('utf-8') }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(readTool)
}
```

```typescript
// src/main/tools/builtin/index.ts — 统一导出
export { registerBuiltinTools as registerReadTool } from './read'
export { registerBuiltinTools as registerWriteTool } from './write'
// 新工具在此注册
```

### Anti-pattern ❌

```typescript
// 工具 execute 直接返回字符串而非 { output: ... }
async execute(input: unknown): Promise<string> { // ❌ 返回类型错误
  return 'file content'
}

// 工具不经过 registry 直接在 chat.ts 中内联
const content = fs.readFileSync(path, 'utf-8') // ❌ 绕过 registry
```

**规则**：工具 `execute` 必须返回 `Promise<{ output: unknown }>`；`riskLevel: 'HIGH'` 触发用户确认；工具通过 `toolRegistry.register()` 注册。

---

## P-04：工具安全边界模式

**适用场景**：所有涉及文件路径的工具操作，必须在 execute 最开头执行安全检查。

### Good ✅

```typescript
// src/main/tools/builtin/write.ts（同样的模式在 read.ts, edit.ts, bash.ts）
const SENSITIVE_PATHS = ['/etc/', '/root/', '/.ssh/', '/.aws/', '/.npm/', '/usr/bin/', '/usr/sbin/']

function resolveInWorkspace(workspace: string, filePath: string): string | null {
  const resolved = isAbsolute(filePath) ? filePath : join(workspace, filePath)
  const normalized = normalize(resolved)
  if (!normalized.startsWith(workspace)) return null  // path traversal 防护
  return normalized
}

async execute(input: unknown, context: ToolExecuteContext) {
  const { workspace } = context
  const params = input as { path: string; content: string }

  if (!workspace) return { output: 'Workspace not set.' }                    // 1. workspace 存在
  if (isPathSensitive(params.path)) return { output: 'Sensitive path.' }     // 2. 敏感路径（原始输入）
  const resolvedPath = resolveInWorkspace(workspace, params.path)
  if (!resolvedPath) return { output: 'Outside workspace.' }                 // 3. 路径穿越防护
  if (isPathSensitive(resolvedPath)) return { output: 'Sensitive path.' }    // 4. 敏感路径（规范化后再查）
  // ...正常逻辑
}
```

### Anti-pattern ❌

```typescript
async execute(input: unknown, context: ToolExecuteContext) {
  const params = input as { path: string }
  // ❌ 直接使用用户输入路径，无任何验证
  const content = readFileSync(params.path, 'utf-8')
  return { output: content }
}
```

**规则**：安全检查顺序固定为：workspace 存在 → 敏感路径（原始）→ resolveInWorkspace → 敏感路径（规范化后）。四步缺一不可。

---

## P-05：PromptPipeline 插件模式

**适用场景**：新增 Prompt 构建插件（如 Agent 角色注入、RAG 检索结果注入）。

### Good ✅

```typescript
// src/main/prompt/plugins/SystemPlugin.ts
import type { PipelineContext, PluginResult } from '../types'

export class SystemPlugin {
  readonly name = 'SystemPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const systemContent = [
      `Current time: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      `OS: ${process.platform}`,
      ctx.workspacePath ? `Workspace: ${ctx.workspacePath}` : '',
    ].filter(Boolean).join('\n')

    return {
      messages: [{ role: 'system', content: systemContent }],
      tools: [],
      tokenEstimate: Math.ceil(systemContent.length / 4),
    }
  }
}
```

```typescript
// src/main/prompt/PromptPipeline.ts — 插件按顺序串联
this.plugins = [
  new SystemPlugin(),       // 系统提示词（最先）
  new AgentPromptPlugin(),  // Agent 角色
  new MemoryPlugin(this.memoryManager),  // 历史记忆
  new ToolSelectionPlugin(), // 工具筛选（最后）
]
```

### Anti-pattern ❌

```typescript
// 在 chat.ts 中直接拼接 system message，不走 pipeline
const systemMessage = { role: 'system', content: '你是一个助手' } // ❌
const messages = [systemMessage, ...historyMessages]
```

**规则**：所有 Prompt 构建逻辑必须通过 Plugin 实现；Plugin 只读取 `PipelineContext`，不直接调用 DB 或 LLM；返回 `{ messages, tools, tokenEstimate }`。

---

## P-06：Zustand Store 模式

**适用场景**：渲染进程全局状态（会话、消息、流式状态、工具调用）。

### Good ✅

```typescript
// src/renderer/store/chatStore.ts
import { create } from 'zustand'

interface ChatState {
  streamState: 'idle' | 'streaming' | 'done' | 'error' | 'aborted'
  streamingContent: string
  toolCalls: ToolCallEntry[]

  appendStreamingContent: (delta: string) => void
  updateToolResult: (toolCallId: string, result: unknown, status: 'done' | 'error' | 'timeout') => void
}

export const useChatStore = create<ChatState>((set) => ({
  streamState: 'idle',
  streamingContent: '',
  toolCalls: [],

  appendStreamingContent: (delta) => set((state) => ({
    streamingContent: state.streamingContent + delta
  })),
  updateToolResult: (toolCallId, result, status) => set((state) => ({
    toolCalls: state.toolCalls.map((tc) =>
      tc.toolCallId === toolCallId ? { ...tc, result, status } : tc
    ),
  })),
}))

// 在事件处理器中通过 getState() 访问（不在 React 组件外 useStore）
const s = useChatStore.getState()
s.appendStreamingContent(delta)
```

### Anti-pattern ❌

```typescript
// 在 store action 中直接调用 talorAPI（store 不应有副作用）
sendMessage: async (content: string) => {
  await talorAPI.chat.send({ content }) // ❌ store 不应发起 IPC
  set({ messages: [...] })
}

// 在非 React 组件中使用 hook 方式访问 store
const { appendStreamingContent } = useChatStore() // ❌ hook 只能在 React 组件内用
```

**规则**：Store action 只做纯状态变更（`set()`）；副作用（IPC 调用、async 操作）在组件 / hook 层发起；在 hook/回调中通过 `useChatStore.getState()` 访问最新状态。

---

## P-07：IPC 流式事件订阅模式

**适用场景**：React 组件消费主进程推送的流式事件（stream / tool-call / tool-result / tool-confirm）。

### Good ✅

```typescript
// src/renderer/hooks/useStreamingMessage.ts
export function useStreamingMessage(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return

    // 订阅所有相关事件，统一在 cleanup 中取消
    const unsubscribeStream = talorAPI.chat.onStream((event: ChatStreamEvent) => {
      if (event.session_id !== sessionId) return  // session 隔离：过滤非当前会话事件
      const s = useChatStore.getState()
      if (event.delta) s.appendStreamingContent(event.delta)
      if (event.done) {
        setTimeout(() => useChatStore.getState().commitStreaming(event.message_id), 0) // defer 一 tick 等最后 delta 渲染
      }
    })

    const unsubscribeToolCall = talorAPI.chat.onToolCall(...)
    const unsubscribeToolResult = talorAPI.chat.onToolResult(...)
    const unsubscribeToolConfirm = talorAPI.chat.onToolConfirm(...)

    // cleanup：组件卸载或 sessionId 变更时取消所有订阅
    return () => {
      unsubscribeStream()
      unsubscribeToolCall()
      unsubscribeToolResult()
      unsubscribeToolConfirm()
    }
  }, [sessionId])  // 仅在 sessionId 变更时重新订阅
}
```

### Anti-pattern ❌

```typescript
// 没有 cleanup，导致内存泄漏和幽灵事件
useEffect(() => {
  talorAPI.chat.onStream((event) => { ... }) // ❌ 没有返回 cleanup 函数
}, [sessionId])

// 没有 session 过滤，不同会话事件互相污染
talorAPI.chat.onStream((event) => {
  useChatStore.getState().appendStreamingContent(event.delta) // ❌ 未检查 session_id
})
```

**规则**：`useEffect` 必须返回 cleanup 函数取消所有订阅；每个事件处理器第一行检查 `session_id`；`commitStreaming` 用 `setTimeout(..., 0)` defer 一个 tick 保证最后一个 delta 已渲染。

---

## P-08：Repository CRUD 模式

**适用场景**：新增 SQLite 数据访问对象。

### Good ✅

```typescript
// src/main/repos/session-repo.ts
export const sessionRepo = {
  list(): ChatSession[] {
    const rows = getDb().prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[]
    return rows.map(rowToSession)
  },

  create(input: Omit<ChatSession, 'created_at' | 'updated_at'>): ChatSession {
    const now = new Date().toISOString()
    const row: SessionRow = { ...input, created_at: now, updated_at: now }
    getDb().prepare(
      'INSERT INTO sessions (id, title, provider_id, model_id, workspace, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(row.id, row.title, row.provider_id, row.model_id ?? null, row.workspace ?? null, row.created_at, row.updated_at)
    return rowToSession(row)
  },

  touch(id: string): void {
    getDb().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  },
}

// parseBlocks：JSON 解析失败时优雅降级为纯文本 block
export function parseBlocks(content: string): ContentBlock[] {
  try {
    return JSON.parse(content) as ContentBlock[]
  } catch {
    return [{ type: 'text', text: content }]
  }
}
```

### Anti-pattern ❌

```typescript
// SELECT * 且内联 SQL 字符串拼接（注入风险）
getDb().prepare(`SELECT * FROM sessions WHERE title LIKE '%${search}%'`).all() // ❌ SQL 注入

// 直接在 IPC handler 中写 SQL
ipcMain.handle('session:list', () => {
  return getDb().prepare('SELECT * FROM sessions').all() // ❌ 绕过 repo 层
})
```

**规则**：所有 SQL 通过参数化查询（`?` 占位符）；数据访问通过 repo 对象而非内联 SQL；行数据通过 `rowTo*` 转换函数映射为领域对象。

---

## P-09：Singleton 服务模式

**适用场景**：需要跨多个 IPC handler 共享同一实例（ConfigStore、SafeStorageService、MemoryManager）。

### Good ✅

```typescript
// src/main/store/config-store.ts
export class ConfigStore {
  private static instance: ConfigStore | null = null
  private store: ElectronStore<AppConfig>

  private constructor() {
    this.store = new ElectronStore<AppConfig>({ ... })
  }

  static getInstance(): ConfigStore {
    if (!ConfigStore.instance) {
      ConfigStore.instance = new ConfigStore()
    }
    return ConfigStore.instance
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.store.get(key)
  }
}

// 调用方
const config = ConfigStore.getInstance().get('providers')
```

### Anti-pattern ❌

```typescript
// 每个 handler 各自 new 实例（各有独立状态，互不同步）
ipcMain.handle('config:get', () => {
  const store = new ElectronStore() // ❌ 不同实例
  return store.get('providers')
})
```

**规则**：共享服务统一使用 `getInstance()` 单例；构造函数设为 `private`；不在测试外通过 `new` 直接实例化。

---

## P-10：ContentBlock 多模态消息模式

**适用场景**：构建包含文本 / 图片 / 文件 / 工具调用 / 工具结果的消息。

### Good ✅

```typescript
// src/shared/types/message.ts — 联合类型定义
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType: string }
  | { type: 'file'; filename: string; mimeType: string; path: string }
  | { type: 'tool_use'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; toolName: string; output: string }

// src/main/ipc/chat.ts — 构建用户消息 blocks
function buildUserBlocks(userContent: string, attachments: ValidatedAttachment[]): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (userContent.trim()) blocks.push({ type: 'text', text: userContent })
  for (const att of attachments) {
    if (att.mime_type.startsWith('image/') && att.base64_data) {
      blocks.push({ type: 'image', image: att.base64_data, mimeType: att.mime_type })
    } else {
      blocks.push({ type: 'file', filename: att.filename, mimeType: att.mime_type, path: att.path })
    }
  }
  return blocks
}

// 存储：JSON.stringify(blocks)
// 读取：parseBlocks(row.content)（JSON 解析 + 降级）
```

### Anti-pattern ❌

```typescript
// 用字符串直接存消息内容（无法支持多模态）
messageRepo.create({ role: 'assistant', content: 'AI 回复文本' }) // ❌ content 应为 JSON stringified ContentBlock[]

// 不用类型守卫，直接强转 block 类型
const text = (block as any).text // ❌ 用 any 绕过类型检查
```

**规则**：`messages.content` 字段始终存储 `JSON.stringify(ContentBlock[])`；读取时通过 `parseBlocks()` 反序列化；新增 block 类型需同时更新 `src/shared/types/message.ts`。

---

## P-11：上下文窗口裁剪模式

**适用场景**：会话消息超出 token 预算时，保留最近消息 + LLM 摘要。

### Good ✅

```typescript
// src/main/memory/ShortTermMemory.ts
async getContext(sessionId: string, config: ProviderContextConfig) {
  const recentBudget  = config.context_limit * config.recent_ratio   // 默认 5%
  const summaryBudget = config.context_limit * config.summary_ratio  // 默认 10%

  const allMessages = messageRepo.listBySession(sessionId)
  const totalTokens = estimateTokens(allMessages)

  if (totalTokens < config.context_limit * 0.9) {
    // Path A：全量消息均在预算内，直接返回
    return { summaryMessage: null, recentMessages: allMessages }
  }

  // Path B：超出预算，分割 old / recent
  const { recent, old } = splitByBudget(allMessages, recentBudget)
  const summary = await this.getOrGenerateSummary(sessionId, old, summaryBudget)
  return { summaryMessage: summary, recentMessages: recent }
}
```

### Anti-pattern ❌

```typescript
// 硬截取最近 N 条，丢弃所有历史上下文
const messages = allMessages.slice(-10) // ❌ 早期重要信息丢失

// 每次都生成摘要，不缓存
const summary = await callLLM(allMessages) // ❌ 无 session_summaries 缓存，浪费 token
```

**规则**：摘要缓存在 `session_summaries` 表，`covered_until` 字段记录摘要覆盖到的最后一条消息 ID；`recent_ratio` 和 `summary_ratio` 在 Provider 配置中可调；90% 阈值触发裁剪（保留 10% 缓冲）。

---

## P-12：工具结果截断模式

**适用场景**：工具返回结果过大（如 `bash` 输出大量日志），防止超出 LLM context。

### Good ✅

```typescript
// src/main/ipc/chat.ts
const MAX_TOOL_RESULT_BYTES = 8192  // src/shared/types/message.ts

function truncateOutput(output: string): string {
  const bytes = Buffer.byteLength(output, 'utf8')
  if (bytes <= MAX_TOOL_RESULT_BYTES) return output
  const buf = Buffer.from(output, 'utf8').subarray(0, MAX_TOOL_RESULT_BYTES)
  return buf.toString('utf8') + `\n[截断：原始输出 ${bytes} 字节]`
}

// toCoreMessages 中对旧工具结果进一步压缩（只保留最近 4 条完整结果）
const TOOL_RESULT_FULL_WINDOW = 4
const value = isOld
  ? `[已省略旧结果，工具=${b.toolName}，长度=${b.output.length}字符]`
  : b.output
```

### Anti-pattern ❌

```typescript
// 工具结果不截断直接塞入 context
messages.push({ role: 'tool', content: [{ type: 'tool-result', output: hugeOutput }] }) // ❌ 可能数 MB
```

**规则**：单次工具结果通过 `truncateOutput()` 限制为 8KB（按字节，UTF-8 安全截断）；历史工具结果在 `toCoreMessages()` 中，超出 `TOOL_RESULT_FULL_WINDOW`（4）的旧结果压缩为摘要行。
