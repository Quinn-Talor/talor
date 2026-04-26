# Chat / ReAct Loop 分离重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `src/main/ipc/chat.ts`（580 行）拆分为三个职责清晰的模块：IPC 入口（`ipc/chat.ts` ~120 行）、工具准备（`tools/build-tools.ts`，归入工具目录）、ReAct 循环引擎（`loop/react-loop.ts`，独立目录，无 Electron 依赖，可独立测试）。

**Architecture:** `ipc/chat.ts` 只负责 IPC 注册、参数验证、附件处理、流式事件转发和错误分类；`tools/build-tools.ts` 负责 MCP 等待、工具 schema 过滤、`dynamicTool` 包装，并将高风险工具确认通过 `requestToolConfirm` 内联处理（`mainWindow` 作为参数传入，loop 不感知）；`loop/react-loop.ts` 是纯引擎，通过 `ReactLoopOptions`（定义在 `loop/types.ts`）接收所有依赖，内部完成多步推理、DB 持久化和兜底摘要，无任何 `BrowserWindow` 或 `ipcMain` 引用。

**Tech Stack:** TypeScript strict、Vercel AI SDK (`streamText / dynamicTool / jsonSchema`)、better-sqlite3（通过 `messageRepo / sessionRepo`）、Vitest（单元测试）

---

## 文件变更清单

| 操作 | 路径 | 职责 |
|------|------|------|
| 新建 | `src/main/loop/types.ts` | ReactLoopCallbacks + ReactLoopOptions 接口 |
| 新建 | `src/main/loop/react-loop.ts` | ReAct 多步推理引擎（无 Electron 依赖） |
| 新建 | `src/main/loop/react-loop.test.ts` | react-loop 单元测试 |
| 新建 | `src/main/tools/build-tools.ts` | MCP 等待 + dynamicTool 包装 + 高风险确认 |
| 修改 | `src/main/ipc/chat.ts` | 精简为 IPC 入口，调用 buildTools + runReactLoop |

---

## Task 1: 新建 `loop/types.ts`

独立类型文件，`react-loop.ts` 和 `chat.ts` 都从这里导入接口，避免循环依赖。

**Files:**
- Create: `src/main/loop/types.ts`

- [ ] **Step 1: 创建 `loop/types.ts`**

```typescript
// src/main/loop/types.ts
import type { LanguageModel } from 'ai'
import type { dynamicTool } from 'ai'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'

export interface ReactLoopCallbacks {
  onTextDelta: (delta: string) => void
  onToolCall: (toolCallId: string, toolName: string, input: unknown) => void
  onToolResult: (toolCallId: string, toolName: string, output: unknown) => void
}

export interface ReactLoopOptions {
  model: LanguageModel
  tools: Record<string, ReturnType<typeof dynamicTool>> | undefined
  sessionId: string
  messageId: string
  userContent: string
  mappedAttachments: Array<{ name: string; mediaType: string; base64?: string; content?: undefined }>
  abortSignal: AbortSignal
  pipeline: PromptPipeline
  provider: Provider
  providerConfig: ProviderContextConfig
  workspace: string
  callbacks: ReactLoopCallbacks
  maxSteps?: number
}
```

- [ ] **Step 2: 运行类型检查确认无错误**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck 2>&1 | tail -20
```

Expected: 无新增类型错误

- [ ] **Step 3: Commit**

```bash
git add src/main/loop/types.ts
git commit -m "refactor(loop): add ReactLoopOptions/Callbacks types in loop/types.ts"
```

---

## Task 2: 新建 `tools/build-tools.ts`

将 `chat.ts` 中第 267–334 行的工具准备逻辑迁移到工具目录，与 `registry.ts` 同层。

**Files:**
- Create: `src/main/tools/build-tools.ts`

- [ ] **Step 1: 创建 `tools/build-tools.ts`**

```typescript
// src/main/tools/build-tools.ts
import { dynamicTool, jsonSchema } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import type { BrowserWindow } from 'electron'
import { toolRegistry } from './registry'
import type { ToolExecuteContext } from './types'
import { requestToolConfirm, buildInputSummary } from '../ipc/tool-confirm'

const MCP_WAIT_MS = 2000
const BUILTIN_TOOL_THRESHOLD = 7

export async function buildTools(opts: {
  sessionId: string
  messageId: string
  workspace: string
  mainWindow: BrowserWindow
}): Promise<Record<string, ReturnType<typeof dynamicTool>> | undefined> {
  const { sessionId, messageId, workspace, mainWindow } = opts
  const hasWorkspace = workspace.trim() !== ''

  // MCP 连接兜底：工具数 <= 7 说明 MCP 尚未就绪
  if (toolRegistry.listAllTools().length <= BUILTIN_TOOL_THRESHOLD) {
    log.warn('[buildTools] Only builtin tools found, waiting for MCP...')
    await new Promise(resolve => setTimeout(resolve, MCP_WAIT_MS))
  }

  const finalSchemas = toolRegistry.listAllTools().filter(schema => {
    const isBuiltin = !schema.provider || schema.provider === 'builtin'
    if (isBuiltin && !hasWorkspace) return false
    return true
  })

  if (finalSchemas.length === 0) return undefined

  const tools = finalSchemas.reduce((acc, schema) => {
    const builtinTool = toolRegistry.getTool(schema.name)
    const externalTool = !builtinTool ? toolRegistry.getToolFromExternal(schema.name) : undefined

    if (!builtinTool && !externalTool) {
      log.warn('[buildTools] Tool not found, skipping:', schema.name)
      return acc
    }

    const ctx: ToolExecuteContext = { sessionId, workspace }

    acc[schema.name] = dynamicTool({
      description: schema.description,
      inputSchema: jsonSchema(schema.parameters),
      execute: async (input: unknown, options: { toolCallId?: string }) => {
        const toolDef = toolRegistry.getTool(schema.name)
        const isHighRisk = toolDef?.riskLevel === 'HIGH'

        if (isHighRisk) {
          const toolCallId = options?.toolCallId ?? uuidv4()
          log.info('[buildTools] Requesting tool confirm for:', schema.name, toolCallId)
          const confirmed = await requestToolConfirm(mainWindow, {
            sessionId,
            messageId,
            toolCallId,
            toolName: schema.name,
            inputSummary: buildInputSummary(schema.name, input),
            inputFull: input,
          })
          if (!confirmed) {
            log.info('[buildTools] Tool execution rejected:', schema.name)
            return '用户拒绝执行'
          }
        }

        try {
          const result = await toolRegistry.execute(schema.name, input, ctx)
          if (result.error) {
            log.error('[buildTools] Tool error:', result.toolName, result.error)
          }
          return result.output ?? null
        } catch (err) {
          log.error('[buildTools] Tool execute exception:', schema.name, err)
          return `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    })
    return acc
  }, {} as Record<string, ReturnType<typeof dynamicTool>>)

  log.info('[buildTools] Tools ready, workspace:', workspace, 'count:', Object.keys(tools).length,
    'tools:', Object.keys(tools).join(', '))
  return Object.keys(tools).length > 0 ? tools : undefined
}
```

- [ ] **Step 2: 运行类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck 2>&1 | tail -20
```

Expected: 无新增类型错误

- [ ] **Step 3: Commit**

```bash
git add src/main/tools/build-tools.ts
git commit -m "refactor(tools): add buildTools() in tools/build-tools.ts"
```

---

## Task 3: 新建 `loop/react-loop.ts`

将 `chat.ts` 中第 366–530 行的 ReAct 循环提取为独立引擎，无任何 Electron 依赖。

**Files:**
- Create: `src/main/loop/react-loop.ts`

- [ ] **Step 1: 创建 `loop/react-loop.ts`**

```typescript
// src/main/loop/react-loop.ts
import { streamText } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { toolResultPartsToBlocks, buildStreamSignal } from '../ipc/chat-utils'
import type { ReactLoopOptions } from './types'
import type { ContentBlock } from '@shared/types/message'

const DEFAULT_MAX_STEPS = 30

export async function runReactLoop(opts: ReactLoopOptions): Promise<void> {
  const {
    model,
    tools,
    sessionId,
    messageId,
    userContent,
    mappedAttachments,
    abortSignal,
    pipeline,
    provider,
    providerConfig,
    workspace,
    callbacks,
    maxSteps = DEFAULT_MAX_STEPS,
  } = opts

  let fullText = ''
  let wroteAssistantFinal = false

  for (let step = 0; step < maxSteps; step++) {
    if (abortSignal.aborted) break

    const pipelineCtx = {
      sessionId,
      currentMessage: { text: userContent, attachments: mappedAttachments },
      provider,
      providerConfig,
      workspacePath: workspace || undefined,
    }
    const { messages: currentMessages } = await pipeline.build(pipelineCtx)
    log.info(`[ReactLoop] step ${step + 1}/${maxSteps}, messages: ${currentMessages.length}`)

    const stepToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
    let stepText = ''

    const result = streamText({
      model,
      messages: currentMessages,
      tools,
      abortSignal: buildStreamSignal(abortSignal),
      onChunk({ chunk }) {
        if (chunk.type === 'text-delta') {
          fullText += chunk.text
          stepText += chunk.text
          if (chunk.text.length > 0) callbacks.onTextDelta(chunk.text)
        } else if (chunk.type === 'tool-call') {
          stepToolCalls.push({ toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input })
          callbacks.onToolCall(chunk.toolCallId, chunk.toolName, chunk.input)
        } else if (chunk.type === 'tool-result') {
          callbacks.onToolResult(chunk.toolCallId, chunk.toolName, chunk.output)
        }
      },
      onError({ error }) {
        log.error('[ReactLoop] Stream error:', error)
      },
    })

    await result.consumeStream()
    log.info(`[ReactLoop] consumed, toolCalls: ${stepToolCalls.length}, fullText: ${fullText.length}`)

    if (stepToolCalls.length === 0) {
      if (stepText) {
        messageRepo.create({
          id: messageId,
          session_id: sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: stepText }],
        })
        sessionRepo.touch(sessionId)
        wroteAssistantFinal = true
      }
      break
    }

    const toolResults = await result.toolResults
    if (toolResults.length === 0) {
      log.error('[ReactLoop] Tool calls made but no results returned, breaking')
      break
    }

    const assistantBlocks: ContentBlock[] = []
    if (stepText) assistantBlocks.push({ type: 'text', text: stepText })
    for (const tc of stepToolCalls) {
      assistantBlocks.push({ type: 'tool_use', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
    }
    messageRepo.create({ id: uuidv4(), session_id: sessionId, role: 'assistant', content: assistantBlocks })

    const toolBlocks: ContentBlock[] = toolResultPartsToBlocks(toolResults)
    messageRepo.create({ id: uuidv4(), session_id: sessionId, role: 'tool', content: toolBlocks })

    log.info(`[ReactLoop] Persisted assistant + tool messages for step ${step + 1}`)
  }

  // 兜底：循环结束但无任何文本输出 → 强制一次无工具摘要步
  if (!wroteAssistantFinal && fullText.length === 0) {
    log.info('[ReactLoop] No final text, requesting forced summary')
    try {
      const summaryCtx = {
        sessionId,
        currentMessage: { text: userContent, attachments: mappedAttachments },
        provider,
        providerConfig,
        workspacePath: workspace || undefined,
      }
      const { messages: summaryMessages } = await pipeline.build(summaryCtx)
      const summaryResult = streamText({
        model,
        messages: summaryMessages,
        abortSignal: buildStreamSignal(abortSignal),
      })
      let summaryText = ''
      for await (const chunk of summaryResult.textStream) {
        summaryText += chunk
        callbacks.onTextDelta(chunk)
      }
      if (summaryText.trim()) {
        messageRepo.create({
          id: uuidv4(),
          session_id: sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: summaryText }],
        })
        log.info('[ReactLoop] Forced summary written, length:', summaryText.length)
      }
    } catch (err) {
      log.error('[ReactLoop] Forced summary failed:', err)
    }
  }
}
```

- [ ] **Step 2: 运行类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck 2>&1 | tail -20
```

Expected: 无新增类型错误

- [ ] **Step 3: Commit**

```bash
git add src/main/loop/react-loop.ts
git commit -m "refactor(loop): add runReactLoop() engine in loop/react-loop.ts (no Electron dep)"
```

---

## Task 4: 编写 `loop/react-loop.test.ts`

验证 ReAct 循环引擎的关键行为：文本输出落库、中止信号提前退出。

**Files:**
- Create: `src/main/loop/react-loop.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
// src/main/loop/react-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runReactLoop } from './react-loop'
import type { ReactLoopOptions } from './types'

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return { ...actual, streamText: vi.fn() }
})

vi.mock('../repos/session-repo', () => ({
  messageRepo: {
    create: vi.fn(),
    listBySession: vi.fn().mockReturnValue([]),
  },
  sessionRepo: { touch: vi.fn() },
  parseBlocks: vi.fn((c: string) => JSON.parse(c)),
}))

vi.mock('../prompt/PromptPipeline', () => ({
  PromptPipeline: vi.fn(),
}))

function makePipeline(messages: unknown[] = []) {
  return { build: vi.fn().mockResolvedValue({ messages, tools: [] }) } as unknown as ReactLoopOptions['pipeline']
}

function makeCallbacks() {
  return {
    onTextDelta: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
  }
}

const baseProvider = {
  id: 'p1', type: 'openai', base_url: '', enabled: true, is_default: true, name: 'test',
} as unknown as ReactLoopOptions['provider']

const baseProviderConfig = {
  provider: baseProvider,
  context_limit: 8000,
  recent_ratio: 0.05,
  summary_ratio: 0.10,
}

describe('runReactLoop — text only', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('fires onTextDelta and persists assistant message', async () => {
    const { streamText } = await import('ai')
    const { messageRepo } = await import('../repos/session-repo')

    vi.mocked(streamText).mockImplementationOnce(({ onChunk }: Parameters<typeof streamText>[0]) => {
      onChunk?.({ chunk: { type: 'text-delta', text: 'hello' } } as never)
      return { consumeStream: () => Promise.resolve(), toolResults: Promise.resolve([]) } as never
    })

    const callbacks = makeCallbacks()
    await runReactLoop({
      model: {} as ReactLoopOptions['model'],
      tools: undefined,
      sessionId: 'sess-1',
      messageId: 'msg-1',
      userContent: 'hi',
      mappedAttachments: [],
      abortSignal: new AbortController().signal,
      pipeline: makePipeline(),
      provider: baseProvider,
      providerConfig: baseProviderConfig,
      workspace: '',
      callbacks,
    })

    expect(callbacks.onTextDelta).toHaveBeenCalledWith('hello')
    expect(vi.mocked(messageRepo.create)).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', session_id: 'sess-1' })
    )
  })
})

describe('runReactLoop — abort', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('stops immediately when abortSignal is pre-aborted', async () => {
    const { messageRepo } = await import('../repos/session-repo')
    const ac = new AbortController()
    ac.abort()

    const callbacks = makeCallbacks()
    await runReactLoop({
      model: {} as ReactLoopOptions['model'],
      tools: undefined,
      sessionId: 'sess-2',
      messageId: 'msg-2',
      userContent: 'hi',
      mappedAttachments: [],
      abortSignal: ac.signal,
      pipeline: makePipeline(),
      provider: baseProvider,
      providerConfig: baseProviderConfig,
      workspace: '',
      callbacks,
    })

    expect(callbacks.onTextDelta).not.toHaveBeenCalled()
    expect(vi.mocked(messageRepo.create)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认通过**

```bash
cd /Users/quinn.li/Desktop/talor && npm run test:run -- src/main/loop/react-loop.test.ts 2>&1 | tail -30
```

Expected: 2 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/main/loop/react-loop.test.ts
git commit -m "test(loop): add unit tests for runReactLoop text-only and abort cases"
```

---

## Task 5: 精简 `ipc/chat.ts`（接入新模块）

将工具准备和循环逻辑替换为 `buildTools` + `runReactLoop` 调用，保留 IPC 胶水。

**Files:**
- Modify: `src/main/ipc/chat.ts`

- [ ] **Step 1: 用新版 chat.ts 替换原文件**

```typescript
// src/main/ipc/chat.ts
import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { ConfigStore, type Provider } from '../store/config-store'
import { SafeStorageService } from '../services/safe-storage'
import { sessionRepo, messageRepo } from '../repos/session-repo'
import { getMainWindow } from './window'
import log from 'electron-log'
import fs from 'fs/promises'
import mime from 'mime-types'
import { createModel } from '../providers/llm-provider'
import '../tools/builtin'
import type { ContentBlock } from '@shared/types/message'
import { classifyLlmError } from './chat-utils'
import { resolveProviderConfig, PromptPipeline } from '../prompt/PromptPipeline'
import { MemoryManager } from '../memory/MemoryManager'
import { buildTools } from '../tools/build-tools'
import { runReactLoop } from '../loop/react-loop'

const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf', 'text/plain', 'text/markdown', 'application/json', 'text/csv',
]
const SUPPORTED_ATTACHMENT_TYPES = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES]

function checkVisionSupport(provider: Provider, attachments: Array<{ mime_type: string }>): void {
  const hasImage = attachments.some(a => SUPPORTED_IMAGE_TYPES.includes(a.mime_type))
  const supportsVision = 'supports_vision' in provider ? provider.supports_vision : false
  if (hasImage && !supportsVision) throw new Error('PROVIDER_NO_VISION')
}

async function validateAttachment(att: {
  path: string; mime_type: string; filename: string; size_bytes: number
}) {
  try {
    await fs.access(att.path)
  } catch {
    throw new Error('FILE_NOT_FOUND')
  }
  const stats = await fs.stat(att.path)
  const actualMime = mime.lookup(att.path) || 'application/octet-stream'
  if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) throw new Error('FILE_TOO_LARGE')
  if (!SUPPORTED_ATTACHMENT_TYPES.includes(actualMime)) throw new Error('UNSUPPORTED_FILE_TYPE')
  let base64_data: string | undefined
  if (SUPPORTED_IMAGE_TYPES.includes(actualMime)) {
    const buf = await fs.readFile(att.path)
    base64_data = `data:${actualMime};base64,${buf.toString('base64')}`
  }
  return { ...att, mime_type: actualMime, size_bytes: stats.size, base64_data }
}

function buildUserBlocks(
  content: string,
  attachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string }>
): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (content.trim()) blocks.push({ type: 'text', text: content })
  for (const att of attachments) {
    if (att.mime_type.startsWith('image/') && att.base64_data) {
      blocks.push({ type: 'image', image: att.base64_data, mimeType: att.mime_type })
    } else {
      blocks.push({ type: 'file', filename: att.filename, mimeType: att.mime_type, path: att.path })
    }
  }
  return blocks
}

function getDefaultProvider(): Provider {
  const providers = ConfigStore.getInstance().get('providers') as Record<string, Provider>
  const defaults = Object.values(providers).filter(p => p.is_default && p.enabled)
  if (defaults.length > 0) return defaults[0]
  const enabled = Object.values(providers).filter(p => p.enabled)
  if (enabled.length > 0) return enabled[0]
  throw new Error('No provider available')
}

interface ActiveStream { abortController: AbortController; messageId: string }
const activeStreams = new Map<string, ActiveStream>()

const _memoryManager = new MemoryManager()
const _pipeline = new PromptPipeline(_memoryManager)

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (_event, params: {
    session_id: string
    content: string
    attachments?: Array<{ path: string; mime_type: string; filename: string; size_bytes: number }>
  }) => {
    log.info('[chat:send] session:', params.session_id, 'content:', params.content.slice(0, 20))
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const sessionId = params.session_id
    const userContent = params.content.trim()
    const attachments = params.attachments ?? []

    if (!userContent && attachments.length === 0) throw new Error('Empty message')

    let validatedAttachments: Array<{
      path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string
    }> = []
    if (attachments.length > 0) {
      validatedAttachments = await Promise.all(attachments.map(validateAttachment))
    }

    const existing = activeStreams.get(sessionId)
    if (existing) { existing.abortController.abort(); activeStreams.delete(sessionId) }

    const messageId = uuidv4()
    const abortController = new AbortController()
    activeStreams.set(sessionId, { abortController, messageId })

    try {
      const provider = getDefaultProvider()
      const session = sessionRepo.getById(sessionId)
      SafeStorageService.getInstance().getApiKey(provider.id)
      if (validatedAttachments.length > 0) checkVisionSupport(provider, validatedAttachments)

      const model = createModel(provider, session?.model_id)
      const workspace = session?.workspace ?? ''

      const tools = await buildTools({ sessionId, messageId, workspace, mainWindow })

      messageRepo.create({
        id: uuidv4(),
        session_id: sessionId,
        role: 'user',
        content: buildUserBlocks(userContent, validatedAttachments),
      })
      sessionRepo.touch(sessionId)

      log.info('[chat:send] Starting ReAct loop, model:', session?.model_id ?? 'default',
        'tools:', Object.keys(tools ?? {}).length)

      await runReactLoop({
        model,
        tools,
        sessionId,
        messageId,
        userContent,
        mappedAttachments: validatedAttachments.map(a => ({
          name: a.filename,
          mediaType: a.mime_type,
          base64: a.base64_data,
          content: undefined,
        })),
        abortSignal: abortController.signal,
        pipeline: _pipeline,
        provider,
        providerConfig: resolveProviderConfig(provider),
        workspace,
        callbacks: {
          onTextDelta: (delta) => mainWindow.webContents.send('chat:stream', {
            session_id: sessionId, message_id: messageId, delta, done: false,
          }),
          onToolCall: (toolCallId, toolName, input) => mainWindow.webContents.send('chat:tool-call', {
            session_id: sessionId, message_id: messageId, tool_call_id: toolCallId, tool_name: toolName, input,
          }),
          onToolResult: (toolCallId, toolName, result) => mainWindow.webContents.send('chat:tool-result', {
            session_id: sessionId, message_id: messageId, tool_call_id: toolCallId, tool_name: toolName, result,
          }),
        },
      })

      mainWindow.webContents.send('chat:stream', {
        session_id: sessionId, message_id: messageId, delta: '', done: true,
      })
      return { message_id: messageId }
    } catch (error) {
      log.error('[chat:send] error:', error)
      activeStreams.delete(sessionId)

      if (error instanceof Error && error.name === 'AbortError') {
        mainWindow.webContents.send('chat:stream', {
          session_id: sessionId, message_id: messageId, delta: '', done: true,
          error_code: 'LLM_ERROR', error_message: 'Stream aborted',
        })
        return { message_id: messageId }
      }

      const errMsg = error instanceof Error ? error.message : String(error)
      mainWindow.webContents.send('chat:stream', {
        session_id: sessionId, message_id: messageId, delta: '', done: true,
        error_code: classifyLlmError(error),
        error_message: errMsg,
      })
      throw error
    } finally {
      activeStreams.delete(sessionId)
    }
  })

  ipcMain.handle('chat:abort', (_event, sessionId: string) => {
    const stream = activeStreams.get(sessionId)
    if (stream) {
      stream.abortController.abort()
      activeStreams.delete(sessionId)
      log.info('[chat:abort] Aborted session:', sessionId)
    }
  })
}
```

- [ ] **Step 2: 运行类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck 2>&1 | tail -20
```

Expected: 无类型错误

- [ ] **Step 3: 运行全量测试确认不回归**

```bash
cd /Users/quinn.li/Desktop/talor && npm run test:run 2>&1 | tail -20
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/chat.ts
git commit -m "refactor(chat): slim to IPC-only entry; delegate to tools/build-tools + loop/react-loop"
```

---

## Task 6: 清理孤立文件

- [ ] **Step 1: 检查 `executor.ts` 是否还有调用方**

```bash
grep -r "from.*executor\|require.*executor" /Users/quinn.li/Desktop/talor/src --include="*.ts"
```

Expected: 无输出（`executor.ts` 已无外部引用）

- [ ] **Step 2: 删除孤立文件**

```bash
rm /Users/quinn.li/Desktop/talor/src/main/tools/executor.ts
rm /Users/quinn.li/Desktop/talor/src/main/tools/executor.test.ts
```

- [ ] **Step 3: 最终类型检查 + 测试**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck && npm run test:run 2>&1 | tail -20
```

Expected: 无错误，所有测试通过

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "refactor(chat): remove unused tools/executor after loop extraction"
```

---

## 自检结果

**Spec 覆盖：**
- ✅ IPC 入口精简 → Task 5
- ✅ 工具准备迁入 `tools/` 目录 → Task 2
- ✅ ReAct 循环独立到 `loop/` 目录，无 Electron 依赖 → Task 3
- ✅ 高风险工具确认在 `buildTools` 内部处理（`mainWindow` 由参数传入）→ Task 2
- ✅ react-loop 可独立测试 → Task 4
- ✅ 类型接口独立文件 → Task 1

**类型一致性：**
- `ReactLoopOptions` / `ReactLoopCallbacks` 定义于 `loop/types.ts`，`react-loop.ts` 和 `chat.ts` 均从此导入，无重复定义
- `buildTools` 返回 `Record<string, ReturnType<typeof dynamicTool>> | undefined`，与 `ReactLoopOptions.tools` 类型一致
- `onTextDelta(delta: string)` / `onToolCall(id, name, input)` / `onToolResult(id, name, output)` 签名在 Task 1 定义，Task 3 实现，Task 5 使用，完全一致
- `loop/react-loop.ts` 从 `../ipc/chat-utils` 导入 `toolResultPartsToBlocks` / `buildStreamSignal`，路径正确（`loop/` 与 `ipc/` 同层）
- `tools/build-tools.ts` 从 `../ipc/tool-confirm` 导入 `requestToolConfirm`，路径正确（`tools/` 与 `ipc/` 同层）
