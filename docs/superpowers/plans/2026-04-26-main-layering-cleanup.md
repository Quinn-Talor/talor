# Main 进程分层整治与关键流程说明补全 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `src/main/ipc/chat.ts` 里混杂的业务逻辑下沉到业务层——chat 用例编排归入新增的 `chat/` 领域目录，ReAct 引擎保留在 `loop/`；消除业务层对 ipc 的反向依赖；为 ReAct 循环等关键流程补 JSDoc；以 `ARCHITECTURE.md` 固化分层约定。

**Architecture:** 分层：入口（`ipc/`）→ 业务（按领域：`chat/ · loop/ · tools/ · prompt/ · memory/ · mcp/ · providers/`）→ 仓储（`repos/`）→ 基础设施（`db/ · store/ · services/*`）。`chat/` 是 chat 用例的**编排层**（orchestrator / attachments / provider-selector / stream-registry），`loop/` 是 **ReAct 引擎**（可被其他编排复用）；`services/` 保持原样作为原子基础能力。跨层通信通过 callback 或端口注入，严禁业务层 import 入口层。

**Tech Stack:** TypeScript strict、Electron（main 进程）、Vercel AI SDK（`streamText / dynamicTool`）、better-sqlite3、Vitest、electron-log。

**Design doc:** `docs/superpowers/specs/2026-04-26-main-layering-cleanup-design.md`

---

## 文件变更总览

| 操作 | 路径 | 任务 |
|------|------|------|
| 新建 | `src/main/ipc/error-codes.ts` | T1 |
| 新建 | `src/main/ipc/error-codes.test.ts` | T1 |
| 新建 | `src/main/loop/stream-utils.ts` | T2 |
| 新建 | `src/main/loop/stream-utils.test.ts` | T2 |
| 删除 | `src/main/ipc/chat-utils.ts` | T3 |
| 删除 | `src/main/ipc/chat.test.ts`（迁入 T1/T2） | T3 |
| 修改 | `src/main/loop/react-loop.ts`（换 import） | T3 |
| 修改 | `src/main/ipc/chat.ts`（暂时过渡） | T3 |
| 新建 | `src/main/chat/stream-registry.ts` | T4 |
| 新建 | `src/main/chat/stream-registry.test.ts` | T4 |
| 新建 | `src/main/chat/provider-selector.ts` | T5 |
| 新建 | `src/main/chat/provider-selector.test.ts` | T5 |
| 新建 | `src/main/chat/attachments.ts` | T6 |
| 新建 | `src/main/chat/attachments.test.ts` | T6 |
| 修改 | `src/main/ipc/tool-confirm.ts`（导出端口类型） | T7 |
| 修改 | `src/main/tools/build-tools.ts`（端口注入） | T7 |
| 新建 | `src/main/chat/orchestrator.ts` | T8 |
| 新建 | `src/main/chat/orchestrator.test.ts` | T8 |
| 修改 | `src/main/ipc/chat.ts`（精简为协议层） | T8 |
| 修改 | `src/main/loop/react-loop.ts`（切分 + JSDoc） | T9 |
| 修改 | `src/main/ipc/session.ts`（尾部 import 上移） | T9 |
| 修改 | `src/main/prompt/PromptPipeline.ts`（分层注释 + JSDoc） | T9 |
| 修改 | `src/main/mcp/client.ts`（关键方法 JSDoc） | T9 |
| 新建 | `src/main/ARCHITECTURE.md` | T9 |

---

## Task 1: 新建 `ipc/error-codes.ts`（协议层错误码）

把 `chat-utils.ts` 里的 `ChatErrorCode` 与 `classifyLlmError` 抽到独立文件。这是**协议层**的关注点（错误码映射给前端用），保留在 `ipc/`。

**Files:**
- Create: `src/main/ipc/error-codes.ts`
- Create: `src/main/ipc/error-codes.test.ts`

- [ ] **Step 1: 写失败测试**

把 `src/main/ipc/chat.test.ts` 中 `describe('classifyLlmError', ...)` 和 `describe('classifyLlmError — AbortError / timeout', ...)` 两段迁到新文件：

```typescript
// src/main/ipc/error-codes.test.ts
import { describe, it, expect } from 'vitest'
import { classifyLlmError } from './error-codes'

describe('classifyLlmError', () => {
  it('classifies 429 response as RATE_LIMITED', () => {
    expect(classifyLlmError(new Error('HTTP 429 Too Many Requests'))).toBe('RATE_LIMITED')
  })

  it('classifies rate limit message as RATE_LIMITED', () => {
    expect(classifyLlmError(new Error('You have exceeded your rate limit'))).toBe('RATE_LIMITED')
  })

  it('classifies too many requests as RATE_LIMITED', () => {
    expect(classifyLlmError(new Error('Too Many Requests'))).toBe('RATE_LIMITED')
  })

  it('classifies ECONNREFUSED as LLM_CONNECTION_FAILED', () => {
    expect(classifyLlmError(new Error('ECONNREFUSED'))).toBe('LLM_CONNECTION_FAILED')
  })

  it('classifies 401 as AUTH_FAILED', () => {
    expect(classifyLlmError(new Error('HTTP 401 Unauthorized'))).toBe('AUTH_FAILED')
  })

  it('classifies API key error as AUTH_FAILED', () => {
    expect(classifyLlmError(new Error('Invalid API key provided'))).toBe('AUTH_FAILED')
  })

  it('defaults to LLM_ERROR for unknown errors', () => {
    expect(classifyLlmError(new Error('Something went wrong'))).toBe('LLM_ERROR')
  })

  it('TimeoutError 分类为 LLM_TIMEOUT', () => {
    const err = new DOMException('signal timed out', 'TimeoutError')
    expect(classifyLlmError(err)).toBe('LLM_TIMEOUT')
  })

  it('AbortError 分类为 LLM_TIMEOUT', () => {
    const err = new DOMException('The user aborted a request.', 'AbortError')
    expect(classifyLlmError(err)).toBe('LLM_TIMEOUT')
  })

  it('映射 FILE_TOO_LARGE / UNSUPPORTED_FILE_TYPE / FILE_NOT_FOUND / PROVIDER_NO_VISION 原样', () => {
    expect(classifyLlmError(new Error('FILE_TOO_LARGE'))).toBe('FILE_TOO_LARGE')
    expect(classifyLlmError(new Error('UNSUPPORTED_FILE_TYPE'))).toBe('UNSUPPORTED_FILE_TYPE')
    expect(classifyLlmError(new Error('FILE_NOT_FOUND'))).toBe('FILE_NOT_FOUND')
    expect(classifyLlmError(new Error('PROVIDER_NO_VISION'))).toBe('PROVIDER_NO_VISION')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/ipc/error-codes.test.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module './error-codes'"

- [ ] **Step 3: 实现 `error-codes.ts`**

```typescript
// src/main/ipc/error-codes.ts —— 入口层：IPC 协议错误码
//
// 职责：把底层异常分类为前端可识别的枚举 code，便于 UI 做差异化提示。
// 只做字符串/类型匹配，不做业务判断。

export type ChatErrorCode =
  | 'LLM_CONNECTION_FAILED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'LLM_ERROR'
  | 'LLM_TIMEOUT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_NOT_FOUND'
  | 'NETWORK_OFFLINE'
  | 'PROVIDER_NO_VISION'

/**
 * 把任意异常对象映射为 ChatErrorCode。
 *
 * 分类规则（按优先级）：
 * 1. AbortError / TimeoutError → LLM_TIMEOUT
 * 2. 网络类关键词（fetch / ECONNREFUSED / ENOTFOUND）→ LLM_CONNECTION_FAILED
 * 3. 限流关键词（429 / rate limit / too many requests）→ RATE_LIMITED
 * 4. 鉴权关键词（401 / 403 / API key）→ AUTH_FAILED
 * 5. 预定义业务错误消息原样透传（FILE_TOO_LARGE / PROVIDER_NO_VISION 等）
 * 6. 其余 → LLM_ERROR
 */
export function classifyLlmError(error: unknown): ChatErrorCode {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'LLM_TIMEOUT'
  }
  const msg = error instanceof Error ? error.message : String(error)
  if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return 'LLM_CONNECTION_FAILED'
  }
  if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
    return 'RATE_LIMITED'
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('API key')) {
    return 'AUTH_FAILED'
  }
  if (msg === 'FILE_TOO_LARGE') return 'FILE_TOO_LARGE'
  if (msg === 'UNSUPPORTED_FILE_TYPE') return 'UNSUPPORTED_FILE_TYPE'
  if (msg === 'FILE_NOT_FOUND') return 'FILE_NOT_FOUND'
  if (msg === 'PROVIDER_NO_VISION') return 'PROVIDER_NO_VISION'
  return 'LLM_ERROR'
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/ipc/error-codes.test.ts 2>&1 | tail -10
```

Expected: 10 tests pass

- [ ] **Step 5: 类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck:main 2>&1 | tail -10
```

Expected: 无错误（注意：此时 `chat-utils.ts` 和 `error-codes.ts` 会并存 ChatErrorCode/classifyLlmError 定义，Task 3 会删掉前者）

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/error-codes.ts src/main/ipc/error-codes.test.ts
git commit -m "$(cat <<'EOF'
refactor(ipc): extract error-codes module for chat error classification

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 新建 `loop/stream-utils.ts`（业务层流式工具）

把 `chat-utils.ts` 里的 `buildStreamSignal` / `toolResultPartsToBlocks` / `truncateOutput` / `extractOutputText` / `isErrorOutput` 搬到业务层 `loop/`，解除 `loop/react-loop.ts` → `ipc/` 的反向依赖。

**Files:**
- Create: `src/main/loop/stream-utils.ts`
- Create: `src/main/loop/stream-utils.test.ts`

- [ ] **Step 1: 写失败测试**

把 `src/main/ipc/chat.test.ts` 中 `describe('toolResultPartsToBlocks', ...)` 与 `describe('buildStreamSignal', ...)` 两段迁过来：

```typescript
// src/main/loop/stream-utils.test.ts
import { describe, it, expect } from 'vitest'
import { toolResultPartsToBlocks, buildStreamSignal } from './stream-utils'

describe('toolResultPartsToBlocks', () => {
  it('sets isError=false for successful tool result', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-1',
        toolName: 'read',
        output: { type: 'text' as const, value: 'file content' },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].isError).toBe(false)
    expect(blocks[0].output).toBe('file content')
  })

  it('sets isError=true for error-text tool result', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-2',
        toolName: 'bash',
        output: { type: 'error-text' as const, value: 'Command not found' },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].isError).toBe(true)
    expect(blocks[0].output).toBe('Command not found')
  })

  it('sets isError=true for error-json tool result', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-3',
        toolName: 'write',
        output: { type: 'error-json' as const, value: { code: 'ACCESS_DENIED' } },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].isError).toBe(true)
  })

  it('preserves toolCallId and toolName', () => {
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-99',
        toolName: 'glob',
        output: { type: 'text' as const, value: 'results' },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].toolCallId).toBe('call-99')
    expect(blocks[0].toolName).toBe('glob')
  })

  it('truncates large output', () => {
    const largeValue = 'x'.repeat(200 * 1024)
    const parts = [
      {
        type: 'tool-result' as const,
        toolCallId: 'call-big',
        toolName: 'read',
        output: { type: 'text' as const, value: largeValue },
      },
    ]
    const blocks = toolResultPartsToBlocks(parts)
    expect(blocks[0].output.length).toBeLessThan(largeValue.length)
    expect(blocks[0].output).toContain('截断')
  })
})

describe('buildStreamSignal', () => {
  it('返回一个未中止的 AbortSignal', () => {
    const base = new AbortController()
    const signal = buildStreamSignal(base.signal)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it('base signal 中止时，组合 signal 也中止', () => {
    const base = new AbortController()
    const signal = buildStreamSignal(base.signal)
    base.abort()
    expect(signal.aborted).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/loop/stream-utils.test.ts 2>&1 | tail -10
```

Expected: FAIL with module not found

- [ ] **Step 3: 实现 `stream-utils.ts`**

```typescript
// src/main/loop/stream-utils.ts —— 业务层：ReAct 流式工具
//
// 职责：
//  1. buildStreamSignal —— 在用户 abort 基础上叠加 120s 超时，供 streamText 使用
//  2. toolResultPartsToBlocks —— 把 AI SDK 的 tool-result parts 转成 DB 存储用的 ContentBlock
//  3. 内部 helper —— truncateOutput / extractOutputText / isErrorOutput
//
// 允许依赖：shared/*
// 禁止依赖：ipc/*

import type { ToolResultBlock } from '../../shared/types/message'
import { MAX_TOOL_RESULT_BYTES } from '../../shared/types/message'

interface ToolResultLike {
  toolCallId: string
  toolName: string
  output: unknown
}

/** 超过 MAX_TOOL_RESULT_BYTES 时按 UTF-8 截断并附加 "[截断：原始输出 N 字节]" 标记。 */
export function truncateOutput(output: string): string {
  const bytes = Buffer.byteLength(output, 'utf8')
  if (bytes <= MAX_TOOL_RESULT_BYTES) return output
  const buf = Buffer.from(output, 'utf8').subarray(0, MAX_TOOL_RESULT_BYTES)
  return buf.toString('utf8') + `\n[截断：原始输出 ${bytes} 字节]`
}

function extractOutputText(output: unknown): string {
  if (output === null || output === undefined) return ''
  if (typeof output === 'string') return output
  if (typeof output === 'object' && 'value' in output) {
    const v = (output as { value: unknown }).value
    return typeof v === 'string' ? v : JSON.stringify(v)
  }
  return String(output)
}

function isErrorOutput(output: unknown): boolean {
  if (typeof output === 'object' && output !== null && 'type' in output) {
    const t = (output as { type: unknown }).type
    return t === 'error-text' || t === 'error-json'
  }
  return false
}

const STREAM_TIMEOUT_MS = 120_000

/**
 * 在用户 abort 基础上叠加 120s 超时，返回组合 AbortSignal。
 * 任一来源触发中止时，下游 streamText 会抛出 AbortError / TimeoutError。
 */
export function buildStreamSignal(abortSignal: AbortSignal): AbortSignal {
  return AbortSignal.any([abortSignal, AbortSignal.timeout(STREAM_TIMEOUT_MS)])
}

/**
 * 把 AI SDK 的 tool-result parts 转成 DB 存储用的 ToolResultBlock。
 * 输出文本按 MAX_TOOL_RESULT_BYTES 截断，保留 isError 标记。
 */
export function toolResultPartsToBlocks(parts: ToolResultLike[]): ToolResultBlock[] {
  return parts.map(tr => ({
    type: 'tool_result' as const,
    toolCallId: tr.toolCallId,
    toolName: tr.toolName,
    output: truncateOutput(extractOutputText(tr.output)),
    isError: isErrorOutput(tr.output),
  }))
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/loop/stream-utils.test.ts 2>&1 | tail -10
```

Expected: 7 tests pass

- [ ] **Step 5: 类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck:main 2>&1 | tail -10
```

Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/main/loop/stream-utils.ts src/main/loop/stream-utils.test.ts
git commit -m "$(cat <<'EOF'
refactor(loop): extract stream-utils to break loop→ipc reverse dep

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 删除 `ipc/chat-utils.ts`，更新所有 import

此时 `error-codes.ts` 和 `stream-utils.ts` 已就位，原 `chat-utils.ts` 已无独立价值，删除并更新 3 个 import 点。

**Files:**
- Delete: `src/main/ipc/chat-utils.ts`
- Delete: `src/main/ipc/chat.test.ts`（测试已迁入 T1/T2）
- Modify: `src/main/loop/react-loop.ts`（改 import）
- Modify: `src/main/ipc/chat.ts`（改 import + 清理重复 import V1）
- Modify: `src/main/loop/react-loop.test.ts`（改 mock 路径）

- [ ] **Step 1: 改 `loop/react-loop.ts` 的 import**

```bash
cd /Users/quinn.li/Desktop/talor
```

把第 6 行：
```typescript
import { toolResultPartsToBlocks, buildStreamSignal } from '../ipc/chat-utils'
```

改为：
```typescript
import { toolResultPartsToBlocks, buildStreamSignal } from './stream-utils'
```

- [ ] **Step 2: 改 `loop/react-loop.test.ts` 的 mock**

把第 10–13 行：
```typescript
vi.mock('../ipc/chat-utils', () => ({
  buildStreamSignal: vi.fn((signal: AbortSignal) => signal),
  toolResultPartsToBlocks: vi.fn(() => []),
}))
```

改为：
```typescript
vi.mock('./stream-utils', () => ({
  buildStreamSignal: vi.fn((signal: AbortSignal) => signal),
  toolResultPartsToBlocks: vi.fn(() => []),
}))
```

- [ ] **Step 3: 改 `ipc/chat.ts` 的 import，同时修复 V1（重复 import）**

打开 `src/main/ipc/chat.ts`，做两处改动：

第一处：把第 15 行
```typescript
import { classifyLlmError } from './chat-utils'
```
改为：
```typescript
import { classifyLlmError } from './error-codes'
```

第二处：删除第 12 行（`ConfigStore` 的重复 import）。第 4 行已经 `import { ConfigStore, type Provider } from '../store/config-store'`，第 12 行的 `import { ConfigStore } from '../store/config-store'` 是冗余。

- [ ] **Step 4: 删除旧文件**

```bash
rm /Users/quinn.li/Desktop/talor/src/main/ipc/chat-utils.ts
rm /Users/quinn.li/Desktop/talor/src/main/ipc/chat.test.ts
```

- [ ] **Step 5: 类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck:main 2>&1 | tail -10
```

Expected: 无错误

- [ ] **Step 6: 全量测试**

```bash
cd /Users/quinn.li/Desktop/talor && npm run test 2>&1 | tail -20
```

Expected: 所有测试通过（`react-loop.test.ts` 2 个、`error-codes.test.ts` 10 个、`stream-utils.test.ts` 7 个、其他模块保持绿）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(ipc): remove chat-utils; retarget imports; fix duplicate ConfigStore import

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 新建 `chat/stream-registry.ts`

`ipc/chat.ts` 里的 `activeStreams` Map 和"同 session 新请求 abort 旧请求"的策略是业务逻辑，下沉到业务层。

**Files:**
- Create: `src/main/chat/stream-registry.ts`
- Create: `src/main/chat/stream-registry.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/main/chat/stream-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { streamRegistry } from './stream-registry'

describe('streamRegistry', () => {
  beforeEach(() => {
    streamRegistry.cleanup('s1')
    streamRegistry.cleanup('s2')
  })

  it('register 返回新的 AbortController，未中止', () => {
    const ctrl = streamRegistry.register('s1', 'msg-1')
    expect(ctrl.signal.aborted).toBe(false)
  })

  it('同一 session 再次 register 会 abort 旧 controller', () => {
    const old = streamRegistry.register('s1', 'msg-1')
    const fresh = streamRegistry.register('s1', 'msg-2')
    expect(old.signal.aborted).toBe(true)
    expect(fresh.signal.aborted).toBe(false)
  })

  it('abort 中止当前 controller 并清掉注册项', () => {
    const ctrl = streamRegistry.register('s1', 'msg-1')
    streamRegistry.abort('s1')
    expect(ctrl.signal.aborted).toBe(true)
    // 再次 register 不会 abort 任何东西
    const next = streamRegistry.register('s1', 'msg-2')
    expect(next.signal.aborted).toBe(false)
  })

  it('cleanup 幂等', () => {
    streamRegistry.register('s1', 'msg-1')
    streamRegistry.cleanup('s1')
    streamRegistry.cleanup('s1')   // 第二次不应抛错
  })

  it('abort 不存在的 session 静默返回', () => {
    expect(() => streamRegistry.abort('nonexistent')).not.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/chat/stream-registry.test.ts 2>&1 | tail -10
```

Expected: FAIL with module not found

- [ ] **Step 3: 实现 `stream-registry.ts`**

```typescript
// src/main/chat/stream-registry.ts —— 业务层：活跃流注册表
//
// 职责：维护 sessionId → (AbortController, messageId) 映射，实现两类策略：
//  - 同 session 新请求到来时自动 abort 上一次请求
//  - 外部主动 abort（如用户点停止按钮）
//
// 允许依赖：shared/*（无）
// 禁止依赖：ipc/*
//
// 单例：模块级 Map。main 进程单实例，无并发 import 风险。

import log from 'electron-log'

interface ActiveStream {
  abortController: AbortController
  messageId: string
}

const activeStreams = new Map<string, ActiveStream>()

export const streamRegistry = {
  /**
   * 为指定 session 注册新的 AbortController。
   * 若该 session 已有活跃流，先 abort 并清理，再注册新的。
   * 返回调用方持有的 AbortController（调用方通过 .signal 传给 streamText）。
   */
  register(sessionId: string, messageId: string): AbortController {
    const existing = activeStreams.get(sessionId)
    if (existing) {
      existing.abortController.abort()
      activeStreams.delete(sessionId)
      log.info('[streamRegistry] Aborted previous stream for session:', sessionId)
    }
    const abortController = new AbortController()
    activeStreams.set(sessionId, { abortController, messageId })
    return abortController
  },

  /** 主动中止指定 session 的活跃流；不存在时静默返回。 */
  abort(sessionId: string): void {
    const stream = activeStreams.get(sessionId)
    if (!stream) return
    stream.abortController.abort()
    activeStreams.delete(sessionId)
    log.info('[streamRegistry] Aborted session:', sessionId)
  },

  /** 清理注册项（不触发 abort）。正常结束时使用。幂等。 */
  cleanup(sessionId: string): void {
    activeStreams.delete(sessionId)
  },
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/chat/stream-registry.test.ts 2>&1 | tail -10
```

Expected: 5 tests pass

- [ ] **Step 5: 类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck:main 2>&1 | tail -10
```

Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/main/chat/stream-registry.ts src/main/chat/stream-registry.test.ts
git commit -m "$(cat <<'EOF'
refactor(chat): add stream-registry for active chat streams

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 新建 `chat/provider-selector.ts`

把 `ipc/chat.ts:70-77` 的 `getDefaultProvider` 抽到业务层。

**Files:**
- Create: `src/main/chat/provider-selector.ts`
- Create: `src/main/chat/provider-selector.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/main/chat/provider-selector.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))

vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: mockGet }) },
}))

import { getDefaultProvider } from './provider-selector'

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    type: 'openai',
    name: 'OpenAI',
    base_url: 'https://api.openai.com',
    models: [],
    enabled: true,
    is_default: true,
    supports_vision: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('getDefaultProvider', () => {
  beforeEach(() => { mockGet.mockReset() })

  it('优先返回 is_default=true 且 enabled 的 provider', () => {
    mockGet.mockReturnValue({
      p1: makeProvider({ id: 'p1', is_default: false, enabled: true }),
      p2: makeProvider({ id: 'p2', is_default: true, enabled: true }),
    })
    expect(getDefaultProvider().id).toBe('p2')
  })

  it('无 default 时退回任一 enabled provider', () => {
    mockGet.mockReturnValue({
      p1: makeProvider({ id: 'p1', is_default: false, enabled: false }),
      p2: makeProvider({ id: 'p2', is_default: false, enabled: true }),
    })
    expect(getDefaultProvider().id).toBe('p2')
  })

  it('无任何可用 provider 时抛错', () => {
    mockGet.mockReturnValue({
      p1: makeProvider({ id: 'p1', is_default: false, enabled: false }),
    })
    expect(() => getDefaultProvider()).toThrow('No provider available')
  })

  it('providers 为空时抛错', () => {
    mockGet.mockReturnValue({})
    expect(() => getDefaultProvider()).toThrow('No provider available')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/chat/provider-selector.test.ts 2>&1 | tail -10
```

Expected: FAIL with module not found

- [ ] **Step 3: 实现 `provider-selector.ts`**

```typescript
// src/main/chat/provider-selector.ts —— 业务层：默认 provider 选取
//
// 职责：从 ConfigStore 中按策略选一个 LLM provider。
// 允许依赖：store/*
// 禁止依赖：ipc/*

import { ConfigStore, type Provider } from '../store/config-store'

/**
 * 选择默认 provider。
 * 优先级：
 *   1. is_default=true 且 enabled=true
 *   2. 任一 enabled=true
 *   3. throw "No provider available"
 */
export function getDefaultProvider(): Provider {
  const providers = ConfigStore.getInstance().get('providers') as Record<string, Provider>
  const defaults = Object.values(providers).filter(p => p.is_default && p.enabled)
  if (defaults.length > 0) return defaults[0]
  const enabled = Object.values(providers).filter(p => p.enabled)
  if (enabled.length > 0) return enabled[0]
  throw new Error('No provider available')
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/chat/provider-selector.test.ts 2>&1 | tail -10
```

Expected: 4 tests pass

- [ ] **Step 5: 类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck:main 2>&1 | tail -10
```

Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/main/chat/provider-selector.ts src/main/chat/provider-selector.test.ts
git commit -m "$(cat <<'EOF'
refactor(chat): add provider-selector for default provider lookup

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 新建 `chat/attachments.ts`

把 `ipc/chat.ts` 里的 `validateAttachment` / `buildUserBlocks` / `checkVisionSupport` 下沉。

**Files:**
- Create: `src/main/chat/attachments.ts`
- Create: `src/main/chat/attachments.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/main/chat/attachments.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockStat, mockAccess, mockReadFile, mockLookup } = vi.hoisted(() => ({
  mockStat: vi.fn(),
  mockAccess: vi.fn(),
  mockReadFile: vi.fn(),
  mockLookup: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  default: { stat: mockStat, access: mockAccess, readFile: mockReadFile },
  stat: mockStat, access: mockAccess, readFile: mockReadFile,
}))

vi.mock('mime-types', () => ({
  default: { lookup: mockLookup },
  lookup: mockLookup,
}))

import {
  validateAttachment,
  buildUserBlocks,
  checkVisionSupport,
} from './attachments'

function baseAtt(overrides: Record<string, unknown> = {}) {
  return {
    path: '/tmp/a.png',
    mime_type: 'image/png',
    filename: 'a.png',
    size_bytes: 1000,
    ...overrides,
  }
}

describe('validateAttachment', () => {
  beforeEach(() => {
    mockStat.mockReset(); mockAccess.mockReset()
    mockReadFile.mockReset(); mockLookup.mockReset()
  })

  it('路径不存在时抛 FILE_NOT_FOUND', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'))
    await expect(validateAttachment(baseAtt())).rejects.toThrow('FILE_NOT_FOUND')
  })

  it('文件大小超限时抛 FILE_TOO_LARGE', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 51 * 1024 * 1024 })
    mockLookup.mockReturnValue('image/png')
    await expect(validateAttachment(baseAtt())).rejects.toThrow('FILE_TOO_LARGE')
  })

  it('不支持的 mime type 抛 UNSUPPORTED_FILE_TYPE', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 1000 })
    mockLookup.mockReturnValue('application/x-zip')
    await expect(validateAttachment(baseAtt())).rejects.toThrow('UNSUPPORTED_FILE_TYPE')
  })

  it('图片类型会读文件转 base64', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 1000 })
    mockLookup.mockReturnValue('image/png')
    mockReadFile.mockResolvedValue(Buffer.from('fake'))
    const out = await validateAttachment(baseAtt())
    expect(out.base64_data).toMatch(/^data:image\/png;base64,/)
  })

  it('非图片类型不读文件', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 1000 })
    mockLookup.mockReturnValue('application/pdf')
    const out = await validateAttachment(baseAtt({ mime_type: 'application/pdf', filename: 'a.pdf' }))
    expect(out.base64_data).toBeUndefined()
    expect(mockReadFile).not.toHaveBeenCalled()
  })
})

describe('checkVisionSupport', () => {
  const visionProvider = { supports_vision: true } as Parameters<typeof checkVisionSupport>[0]
  const nonVisionProvider = { supports_vision: false } as Parameters<typeof checkVisionSupport>[0]

  it('provider 不支持视觉但附件含图片时抛 PROVIDER_NO_VISION', () => {
    expect(() => checkVisionSupport(nonVisionProvider, [{ mime_type: 'image/png' }]))
      .toThrow('PROVIDER_NO_VISION')
  })

  it('provider 支持视觉时通过', () => {
    expect(() => checkVisionSupport(visionProvider, [{ mime_type: 'image/png' }])).not.toThrow()
  })

  it('无图片附件时通过', () => {
    expect(() => checkVisionSupport(nonVisionProvider, [{ mime_type: 'application/pdf' }])).not.toThrow()
  })
})

describe('buildUserBlocks', () => {
  it('纯文本返回一个 text block', () => {
    const blocks = buildUserBlocks('hello', [])
    expect(blocks).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('空文本 + 无附件返回空数组', () => {
    expect(buildUserBlocks('', [])).toEqual([])
  })

  it('图片附件转 image block', () => {
    const blocks = buildUserBlocks('', [{
      path: '/p/a.png', mime_type: 'image/png', filename: 'a.png',
      size_bytes: 1, base64_data: 'data:image/png;base64,ZmFrZQ==',
    }])
    expect(blocks[0]).toMatchObject({ type: 'image', mimeType: 'image/png' })
  })

  it('文档附件转 file block', () => {
    const blocks = buildUserBlocks('', [{
      path: '/p/a.pdf', mime_type: 'application/pdf', filename: 'a.pdf', size_bytes: 1,
    }])
    expect(blocks[0]).toMatchObject({ type: 'file', filename: 'a.pdf', mimeType: 'application/pdf' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/chat/attachments.test.ts 2>&1 | tail -10
```

Expected: FAIL with module not found

- [ ] **Step 3: 实现 `attachments.ts`**

```typescript
// src/main/chat/attachments.ts —— 业务层：附件校验、视觉能力、消息 blocks 构造
//
// 职责：
//  1. validateAttachment —— 路径/大小/mime 校验；图片类型读 base64
//  2. checkVisionSupport —— 根据 provider 能力拦截不兼容的视觉附件
//  3. buildUserBlocks —— 文本 + 附件转 ContentBlock[] 供 DB 存储
//
// 允许依赖：shared/*、store/*（Provider 类型）
// 禁止依赖：ipc/*

import fs from 'fs/promises'
import mime from 'mime-types'
import type { ContentBlock } from '@shared/types/message'
import type { Provider } from '../store/config-store'

const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf', 'text/plain', 'text/markdown', 'application/json', 'text/csv',
]
const SUPPORTED_ATTACHMENT_TYPES = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES]

export interface ValidatedAttachment {
  path: string
  mime_type: string
  filename: string
  size_bytes: number
  base64_data?: string
}

/**
 * 校验单个附件，返回带真实 mime / 真实 size / 图片 base64 的扩展对象。
 *
 * 错误消息（字符串常量）：
 *  - FILE_NOT_FOUND         路径不存在
 *  - FILE_TOO_LARGE         超过 50MB
 *  - UNSUPPORTED_FILE_TYPE  mime 不在白名单
 *
 * 图片类型会读文件并编码为 `data:<mime>;base64,<...>`。非图片不读。
 */
export async function validateAttachment(att: {
  path: string; mime_type: string; filename: string; size_bytes: number
}): Promise<ValidatedAttachment> {
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

/** provider 不支持视觉但附件含图片时抛 PROVIDER_NO_VISION。 */
export function checkVisionSupport(
  provider: Pick<Provider, 'supports_vision'>,
  attachments: Array<{ mime_type: string }>,
): void {
  const hasImage = attachments.some(a => SUPPORTED_IMAGE_TYPES.includes(a.mime_type))
  const supportsVision = provider.supports_vision ?? false
  if (hasImage && !supportsVision) throw new Error('PROVIDER_NO_VISION')
}

/**
 * 把用户文本 + 附件转成 ContentBlock[] 供 DB 存储与下游消费。
 * 规则：
 *  - 非空 text 追加 text block
 *  - 图片（有 base64_data）追加 image block
 *  - 其它追加 file block
 */
export function buildUserBlocks(
  content: string,
  attachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string }>,
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
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/chat/attachments.test.ts 2>&1 | tail -10
```

Expected: 12 tests pass

- [ ] **Step 5: 类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck:main 2>&1 | tail -10
```

Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/main/chat/attachments.ts src/main/chat/attachments.test.ts
git commit -m "$(cat <<'EOF'
refactor(chat): add attachments module for validation and block construction

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `tool-confirm` 端口化改造

消除 `tools/build-tools.ts` 对 `ipc/tool-confirm.ts` 的反向依赖（V6）。方法：在 `ipc/tool-confirm.ts` 导出 `ToolConfirmPort` 类型，`build-tools.ts` 改为注入。

**Files:**
- Modify: `src/main/ipc/tool-confirm.ts`（导出类型）
- Modify: `src/main/tools/build-tools.ts`（端口注入 + 把 buildInputSummary 变 private）

- [ ] **Step 1: 改 `ipc/tool-confirm.ts`**

在文件末尾追加（不改原有函数实现）：

```typescript
// ---- 端口类型（供业务层依赖反转） ----
import type { ToolConfirmRequest } from '@shared/types/message'

/**
 * 工具确认端口：业务层（tools/build-tools.ts）只依赖这个函数签名，
 * 不感知 Electron。入口层 ipc/chat.ts 注入一个绑定了 mainWindow 的实现。
 */
export type ToolConfirmPort = (payload: ToolConfirmRequest) => Promise<boolean>
```

> 注：`ToolConfirmRequest` 定义在 `src/shared/types/message.ts`，本文件已隐式通过 `requestToolConfirm` 的签名使用它；这里显式 re-export 类型 alias 方便业务层引用。

- [ ] **Step 2: 改 `tools/build-tools.ts`**

新内容（整体替换）：

```typescript
// src/main/tools/build-tools.ts —— 业务层：工具装配（MCP 等待 / dynamicTool 包装 / 高风险确认）
//
// 允许依赖：tools/*、ipc/tool-confirm 的 "类型"（不是实现）、shared/*
// 禁止依赖：任何 ipc/* 的运行时代码

import { dynamicTool, jsonSchema } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { toolRegistry } from './registry'
import type { ToolExecuteContext } from './types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'   // 仅类型 import，不产生运行时依赖

const MCP_WAIT_MS = 2000
const BUILTIN_TOOL_THRESHOLD = 7

/**
 * 给高风险工具构造用户可读的 "输入摘要" 供 UI 确认弹窗展示。
 * 纯格式化，长度上限 500。
 */
function buildInputSummary(toolName: string, input: unknown): string {
  const MAX = 500
  const obj = input as Record<string, unknown>
  if (toolName === 'bash') {
    return String(obj.command ?? '').slice(0, MAX)
  }
  if (toolName === 'write') {
    const lines = String(obj.content ?? '').split('\n').slice(0, 20).map(l => l.slice(0, 80))
    return `文件: ${obj.path}\n\n${lines.join('\n')}`.slice(0, MAX)
  }
  if (toolName === 'edit') {
    const lines = String(obj.old_str ?? '').split('\n').slice(0, 10).map(l => l.slice(0, 80))
    return `文件: ${obj.path}\n旧内容:\n${lines.join('\n')}`.slice(0, MAX)
  }
  return JSON.stringify(input).slice(0, MAX)
}

/**
 * 装配一次 chat 请求可用的工具集合。
 *
 * 关键策略：
 *  - **MCP 等待兜底**：registry 的工具数 ≤ 7 意味着 MCP 尚未连接完成，等待 2s 再读一次。
 *  - **workspace 过滤**：无 workspace 时不暴露内建文件工具（read/write/edit/bash/glob/grep/ls）。
 *  - **高风险工具确认**：riskLevel=HIGH 的工具在 execute 前通过 `confirmTool` 端口
 *    请求用户确认；拒绝时返回 "用户拒绝执行" 字符串而非抛错（不破坏 ReAct 循环）。
 *  - **错误包装**：toolRegistry.execute 抛错时转为字符串返回，避免让 streamText 捕获异常中断流。
 */
export async function buildTools(opts: {
  sessionId: string
  messageId: string
  workspace: string
  confirmTool: ToolConfirmPort
}): Promise<Record<string, ReturnType<typeof dynamicTool>> | undefined> {
  const { sessionId, messageId, workspace, confirmTool } = opts
  const hasWorkspace = workspace.trim() !== ''

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
    const hasExternalTool = !builtinTool && !!toolRegistry.getToolFromExternal(schema.name)

    if (!builtinTool && !hasExternalTool) {
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
          const confirmed = await confirmTool({
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

- [ ] **Step 3: 类型检查（预期：`ipc/chat.ts` 会因 signature 变了而报错，下个 task 修）**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck:main 2>&1 | tail -20
```

Expected: `ipc/chat.ts` 里 `buildTools({ sessionId, messageId, workspace, mainWindow })` 调用会报 `mainWindow` 类型不匹配。这是预期的，T8 修。

- [ ] **Step 4: 临时补丁 `ipc/chat.ts` 第 124 行调用处（让中间态能通过 typecheck）**

把：
```typescript
const tools = await buildTools({ sessionId, messageId, workspace, mainWindow })
```
改为：
```typescript
const tools = await buildTools({
  sessionId,
  messageId,
  workspace,
  confirmTool: (payload) => requestToolConfirm(mainWindow, payload),
})
```

并在文件顶部 import 里加（原来没有）：
```typescript
import { requestToolConfirm } from './tool-confirm'
```

> 注意：`ipc/chat.ts` 现在同时直接调用 `requestToolConfirm` 和通过端口调用，是过渡态；T8 会整体重写。

- [ ] **Step 5: 类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck:main 2>&1 | tail -10
```

Expected: 无错误

- [ ] **Step 6: 全量测试**

```bash
cd /Users/quinn.li/Desktop/talor && npm run test 2>&1 | tail -10
```

Expected: 所有测试通过

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/tool-confirm.ts src/main/tools/build-tools.ts src/main/ipc/chat.ts
git commit -m "$(cat <<'EOF'
refactor(tools): invert tool-confirm dependency via injected port

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `chat/orchestrator.ts` + 精简 `ipc/chat.ts`

业务编排搬到 `chat/orchestrator.ts`，入口层 `chat.ts` 只做协议转换 + 回调桥接。

**Files:**
- Create: `src/main/chat/orchestrator.ts`
- Create: `src/main/chat/orchestrator.test.ts`
- Modify: `src/main/ipc/chat.ts`（整体重写，精简到 ~50 行）

- [ ] **Step 1: 写 `orchestrator.test.ts`**

```typescript
// src/main/chat/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { hoisted } = vi.hoisted(() => ({
  hoisted: {
    validateAttachment: vi.fn(),
    buildUserBlocks: vi.fn(() => [{ type: 'text', text: 'x' }]),
    checkVisionSupport: vi.fn(),
    getDefaultProvider: vi.fn(),
    register: vi.fn(),
    cleanup: vi.fn(),
    getApiKey: vi.fn(),
    createModel: vi.fn(),
    sessionGetById: vi.fn(),
    messageCreate: vi.fn(),
    sessionTouch: vi.fn(),
    buildTools: vi.fn(),
    runReactLoop: vi.fn(),
    resolveProviderConfig: vi.fn(() => ({})),
    configGet: vi.fn(),
  },
}))

vi.mock('./attachments', () => ({
  validateAttachment: hoisted.validateAttachment,
  buildUserBlocks: hoisted.buildUserBlocks,
  checkVisionSupport: hoisted.checkVisionSupport,
}))

vi.mock('./provider-selector', () => ({
  getDefaultProvider: hoisted.getDefaultProvider,
}))

vi.mock('./stream-registry', () => ({
  streamRegistry: { register: hoisted.register, cleanup: hoisted.cleanup, abort: vi.fn() },
}))

vi.mock('../services/safe-storage', () => ({
  SafeStorageService: { getInstance: () => ({ getApiKey: hoisted.getApiKey }) },
}))

vi.mock('../providers/llm-provider', () => ({
  createModel: hoisted.createModel,
}))

vi.mock('../repos/session-repo', () => ({
  sessionRepo: { getById: hoisted.sessionGetById, touch: hoisted.sessionTouch },
  messageRepo: { create: hoisted.messageCreate },
}))

vi.mock('../tools/build-tools', () => ({
  buildTools: hoisted.buildTools,
}))

vi.mock('../loop/react-loop', () => ({
  runReactLoop: hoisted.runReactLoop,
}))

vi.mock('../prompt/PromptPipeline', () => ({
  resolveProviderConfig: hoisted.resolveProviderConfig,
  PromptPipeline: class { build() { return Promise.resolve({ messages: [], tools: [] }) } },
}))

vi.mock('../memory/MemoryManager', () => ({ MemoryManager: class {} }))

vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: hoisted.configGet }) },
}))

import { sendChat } from './orchestrator'

function makeCallbacks() {
  return {
    onTextDelta: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onDone: vi.fn(),
  }
}
function makePorts() {
  return { confirmTool: vi.fn(async () => true) }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getDefaultProvider.mockReturnValue({ id: 'p1', supports_vision: true })
  hoisted.sessionGetById.mockReturnValue({ id: 's1', workspace: '/ws', model_id: 'm1' })
  hoisted.register.mockReturnValue(new AbortController())
  hoisted.createModel.mockReturnValue({})
  hoisted.buildTools.mockResolvedValue(undefined)
  hoisted.runReactLoop.mockResolvedValue(undefined)
  hoisted.configGet.mockReturnValue(undefined)
})

describe('sendChat', () => {
  it('空消息 + 无附件时通过 onDone 回报错，返回 messageId', async () => {
    const cb = makeCallbacks()
    const res = await sendChat({ sessionId: 's1', content: '  ', attachments: [] }, cb, makePorts())
    expect(res.messageId).toBeTruthy()
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'LLM_ERROR' }))
  })

  it('编排顺序：register → validate → provider → vision → persist user → buildTools → runReactLoop → onDone', async () => {
    const cb = makeCallbacks()
    await sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts())
    expect(hoisted.register).toHaveBeenCalled()
    expect(hoisted.getDefaultProvider).toHaveBeenCalled()
    expect(hoisted.messageCreate).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }))
    expect(hoisted.buildTools).toHaveBeenCalled()
    expect(hoisted.runReactLoop).toHaveBeenCalled()
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String))
  })

  it('附件校验失败 → 错误码映射到 onDone', async () => {
    hoisted.validateAttachment.mockRejectedValue(new Error('FILE_TOO_LARGE'))
    const cb = makeCallbacks()
    await sendChat(
      { sessionId: 's1', content: 'hi', attachments: [{ path: '/p', mime_type: 'image/png', filename: 'a', size_bytes: 1 }] },
      cb, makePorts(),
    )
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'FILE_TOO_LARGE' }))
    expect(hoisted.runReactLoop).not.toHaveBeenCalled()
  })

  it('视觉不匹配 → PROVIDER_NO_VISION', async () => {
    hoisted.checkVisionSupport.mockImplementation(() => { throw new Error('PROVIDER_NO_VISION') })
    hoisted.validateAttachment.mockResolvedValue({
      path: '/p', mime_type: 'image/png', filename: 'a', size_bytes: 1, base64_data: 'data:image/png;base64,x',
    })
    const cb = makeCallbacks()
    await sendChat(
      { sessionId: 's1', content: '', attachments: [{ path: '/p', mime_type: 'image/png', filename: 'a', size_bytes: 1 }] },
      cb, makePorts(),
    )
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'PROVIDER_NO_VISION' }))
  })

  it('成功完成时调用 streamRegistry.cleanup', async () => {
    const cb = makeCallbacks()
    await sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts())
    expect(hoisted.cleanup).toHaveBeenCalledWith('s1')
  })

  it('runReactLoop 抛错时通过 onDone 回错，不 throw', async () => {
    hoisted.runReactLoop.mockRejectedValue(new Error('HTTP 429 Too Many Requests'))
    const cb = makeCallbacks()
    await expect(
      sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts())
    ).resolves.toBeTruthy()
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'RATE_LIMITED' }))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/chat/orchestrator.test.ts 2>&1 | tail -10
```

Expected: FAIL with module not found

- [ ] **Step 3: 实现 `orchestrator.ts`**

```typescript
// src/main/chat/orchestrator.ts —— 业务层（chat 领域）：chat:send 用例编排
//
// 职责：接收参数化的 chat 请求 + UI 回调，完成 "附件校验 → provider/model →
// 工具装配 → 持久化用户消息 → 驱动 ReAct 循环" 全流程。不感知 Electron / IPC。
//
// 允许依赖：chat/（同层）、tools/*、loop/*、prompt/*、memory/*、providers/*、
//          repos/*、store/*（只读）、services/*（基础能力 safe-storage 等）
// 禁止依赖：ipc/* 的运行时代码（仅允许 ipc/ 的纯类型 import，如 ToolConfirmPort / ChatErrorCode）

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { ConfigStore } from '../store/config-store'
import { SafeStorageService } from '../services/safe-storage'
import { sessionRepo, messageRepo } from '../repos/session-repo'
import { createModel } from '../providers/llm-provider'
import '../tools/builtin'
import { buildTools } from '../tools/build-tools'
import { runReactLoop } from '../loop/react-loop'
import { resolveProviderConfig, PromptPipeline } from '../prompt/PromptPipeline'
import { MemoryManager } from '../memory/MemoryManager'
import {
  validateAttachment,
  buildUserBlocks,
  checkVisionSupport,
  type ValidatedAttachment,
} from './attachments'
import { getDefaultProvider } from './provider-selector'
import { streamRegistry } from './stream-registry'
import { classifyLlmError, type ChatErrorCode } from '../ipc/error-codes'
import type { ToolConfirmPort } from '../ipc/tool-confirm'

// 单例：pipeline 和 memoryManager 按进程全局持有
const memoryManager = new MemoryManager()
const pipeline = new PromptPipeline(memoryManager)

export interface ChatSendParams {
  sessionId: string
  content: string
  attachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number }>
}

export interface ChatCallbacks {
  onTextDelta(messageId: string, delta: string): void
  onToolCall(messageId: string, toolCallId: string, toolName: string, input: unknown): void
  onToolResult(messageId: string, toolCallId: string, toolName: string, output: unknown): void
  onDone(messageId: string, err?: { code: ChatErrorCode; message: string }): void
}

export interface ChatPorts {
  confirmTool: ToolConfirmPort
}

/**
 * chat:send 业务入口。
 *
 * 编排顺序：
 *   1. 校验非空
 *   2. 校验附件（逐个）
 *   3. streamRegistry.register（同 session 新请求会 abort 旧的）
 *   4. 选 provider + 预热 API key + 视觉能力校验
 *   5. 持久化 user 消息
 *   6. 装配 tools（含 MCP 等待 + 高风险确认端口）
 *   7. 驱动 runReactLoop，回调桥接到 callbacks.*
 *   8. 成功 → callbacks.onDone(messageId)
 *
 * 单一错误出口：任何步骤抛错都通过 onDone(messageId, { code, message }) 回报；
 * 函数本身始终 resolve 到 { messageId }，不 throw。这样入口层无需 try/catch 并
 * 避免渲染端同时收到 stream 错误 + Promise reject。
 */
export async function sendChat(
  params: ChatSendParams,
  callbacks: ChatCallbacks,
  ports: ChatPorts,
): Promise<{ messageId: string }> {
  const messageId = uuidv4()
  const sessionId = params.sessionId
  const userContent = params.content.trim()
  const attachments = params.attachments ?? []

  try {
    if (!userContent && attachments.length === 0) throw new Error('Empty message')

    // Step 2: validate attachments
    const validated: ValidatedAttachment[] = attachments.length > 0
      ? await Promise.all(attachments.map(validateAttachment))
      : []

    // Step 3: register stream (auto-aborts prior stream of same session)
    const abortController = streamRegistry.register(sessionId, messageId)

    // Step 4: provider + model
    const provider = getDefaultProvider()
    const session = sessionRepo.getById(sessionId)
    SafeStorageService.getInstance().getApiKey(provider.id)
    if (validated.length > 0) checkVisionSupport(provider, validated)

    const model = createModel(provider, session?.model_id)
    const workspace = session?.workspace ?? ''

    // Step 5: persist user message
    messageRepo.create({
      id: uuidv4(),
      session_id: sessionId,
      role: 'user',
      content: buildUserBlocks(userContent, validated),
    })
    sessionRepo.touch(sessionId)

    // Step 6: build tools
    const tools = await buildTools({
      sessionId, messageId, workspace,
      confirmTool: ports.confirmTool,
    })

    log.info('[chat-orch] Starting ReAct loop, model:', session?.model_id ?? 'default',
      'tools:', Object.keys(tools ?? {}).length)

    // Step 7: run ReAct loop
    const maxReactSteps = ConfigStore.getInstance().get('max_react_steps')
    await runReactLoop({
      model,
      tools,
      sessionId,
      messageId,
      userContent,
      mappedAttachments: validated.map(a => ({
        name: a.filename,
        mediaType: a.mime_type,
        base64: a.base64_data,
        content: undefined,
      })),
      abortSignal: abortController.signal,
      pipeline,
      provider,
      providerConfig: resolveProviderConfig(provider),
      workspace,
      maxSteps: typeof maxReactSteps === 'number' && maxReactSteps > 0 ? maxReactSteps : undefined,
      callbacks: {
        onTextDelta: (delta) => callbacks.onTextDelta(messageId, delta),
        onToolCall:  (id, name, input) => callbacks.onToolCall(messageId, id, name, input),
        onToolResult: (id, name, output) => callbacks.onToolResult(messageId, id, name, output),
      },
    })

    // Step 8: done
    callbacks.onDone(messageId)
    return { messageId }
  } catch (error) {
    log.error('[chat-orch] error:', error)
    const code = classifyLlmError(error)
    const message = error instanceof Error ? error.message : String(error)
    callbacks.onDone(messageId, { code, message })
    return { messageId }
  } finally {
    streamRegistry.cleanup(sessionId)
  }
}
```

- [ ] **Step 4: 跑新测试确认通过**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/chat/orchestrator.test.ts 2>&1 | tail -10
```

Expected: 6 tests pass

- [ ] **Step 5: 重写 `ipc/chat.ts`（精简 + 命名兼容）**

渲染端契约（见 `src/renderer/api/talorAPI.ts:38`）：

- 输入 `{ session_id, content, attachments? }`（snake_case）
- 输出 `{ message_id }`（snake_case）

业务层 `ChatSendParams` 用 camelCase（`sessionId`）。入口层负责双向命名转换，使业务层保持干净。整体替换为：

```typescript
// src/main/ipc/chat.ts —— 入口层：IPC 注册 + 事件转发 + snake/camel 命名转换
//
// 职责：
//  1. 注册 chat:send / chat:abort IPC handler
//  2. 把业务层 callback 转成 webContents.send 事件
//  3. 把 requestToolConfirm 绑定 mainWindow 后作为端口注入业务层
//  4. 入口协议使用 snake_case，业务层使用 camelCase，本层做双向转换
//
// 禁止：业务决策（附件校验、provider 选取、ReAct 控制等）

import { ipcMain } from 'electron'
import log from 'electron-log'
import { getMainWindow } from './window'
import { requestToolConfirm } from './tool-confirm'
import { sendChat } from '../chat/orchestrator'
import { streamRegistry } from '../chat/stream-registry'

interface ChatSendRawParams {
  session_id: string
  content: string
  attachments?: Array<{ path: string; mime_type: string; filename: string; size_bytes: number }>
}

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (_event, raw: ChatSendRawParams) => {
    log.info('[chat:send] session:', raw.session_id, 'content:', raw.content.slice(0, 20))
    const win = getMainWindow()
    if (!win) throw new Error('No main window')

    const sid = raw.session_id
    const { messageId } = await sendChat(
      {
        sessionId: sid,
        content: raw.content,
        attachments: raw.attachments ?? [],
      },
      {
        onTextDelta:  (mid, delta)           => win.webContents.send('chat:stream',      { session_id: sid, message_id: mid, delta, done: false }),
        onToolCall:   (mid, id, name, input) => win.webContents.send('chat:tool-call',   { session_id: sid, message_id: mid, tool_call_id: id, tool_name: name, input }),
        onToolResult: (mid, id, name, out)   => win.webContents.send('chat:tool-result', { session_id: sid, message_id: mid, tool_call_id: id, tool_name: name, result: out }),
        onDone:       (mid, err)             => win.webContents.send('chat:stream',      { session_id: sid, message_id: mid, delta: '', done: true, error_code: err?.code, error_message: err?.message }),
      },
      { confirmTool: (payload) => requestToolConfirm(win, payload) },
    )

    // 返回值按历史协议用 snake_case
    return { message_id: messageId }
  })

  ipcMain.handle('chat:abort', (_event, sessionId: string) => {
    streamRegistry.abort(sessionId)
  })
}
```

- [ ] **Step 6: 验证渲染侧调用未受影响**

```bash
cd /Users/quinn.li/Desktop/talor && grep -rn "chat:send" src/preload src/renderer/api 2>/dev/null | grep -v ".test." | head -5
```

Expected: 渲染端入参 `{ session_id, content, attachments }`、返回 `{ message_id }` 形式 —— 与上面 handler 一致，无需改动渲染端。

- [ ] **Step 7: 类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck 2>&1 | tail -15
```

Expected: 无错误

- [ ] **Step 8: 全量测试**

```bash
cd /Users/quinn.li/Desktop/talor && npm run test 2>&1 | tail -15
```

Expected: 所有测试通过

- [ ] **Step 9: Commit**

```bash
git add src/main/chat/orchestrator.ts src/main/chat/orchestrator.test.ts src/main/ipc/chat.ts
git commit -m "$(cat <<'EOF'
refactor(chat): extract chat orchestrator; slim ipc/chat.ts to protocol layer

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: react-loop 切分 + 补 JSDoc + ipc/session.ts 清理 + ARCHITECTURE.md

最后一轮收尾：把 `react-loop.ts` 切成 `runReactStep` + `runFallbackSummary` + `runReactLoop` 三层；给 `prompt/PromptPipeline.ts`、`mcp/client.ts` 的关键方法补 JSDoc；修 `ipc/session.ts` 尾部 import（V7）；新增 `ARCHITECTURE.md`。

**Files:**
- Modify: `src/main/loop/react-loop.ts`
- Modify: `src/main/ipc/session.ts`
- Modify: `src/main/prompt/PromptPipeline.ts`
- Modify: `src/main/mcp/client.ts`
- Create: `src/main/ARCHITECTURE.md`

- [ ] **Step 1: 重构 `loop/react-loop.ts`（整体替换）**

```typescript
// src/main/loop/react-loop.ts —— 业务层：ReAct 多步推理引擎
//
// 公开接口：runReactLoop(opts)
//
// 内部结构：
//   runReactLoop          —— 顶层循环 + 兜底摘要
//   └── runReactStep      —— 单步 ReAct（build prompt → stream → persist）
//   └── runFallbackSummary —— 循环结束但零文本输出时的兜底摘要
//
// 允许依赖：loop/*、repos/*、shared/*
// 禁止依赖：ipc/*

import { streamText, type LanguageModel } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { toolResultPartsToBlocks, buildStreamSignal } from './stream-utils'
import type { ReactLoopOptions, ReactLoopCallbacks } from './types'
import type { ContentBlock } from '@shared/types/message'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'

const DEFAULT_MAX_STEPS = 1000

interface StepContext {
  model: LanguageModel
  tools: ReactLoopOptions['tools']
  sessionId: string
  messageId: string
  userContent: string
  mappedAttachments: ReactLoopOptions['mappedAttachments']
  abortSignal: AbortSignal
  pipeline: PromptPipeline
  provider: Provider
  providerConfig: ProviderContextConfig
  workspace: string
  callbacks: ReactLoopCallbacks
}

interface StepOutcome {
  /** 本步产生的纯文本（供兜底判断 fullText 是否为空） */
  stepText: string
  /** 本步是否有工具调用 */
  hadToolCalls: boolean
  /** 是否已写入最终 assistant 消息（stepText 且无工具调用 → true） */
  wroteAssistantFinal: boolean
  /** 是否应继续下一步（工具调用且有 toolResults 时为 true） */
  shouldContinue: boolean
}

/**
 * 单步 ReAct。
 *
 * 流程：
 *   1. pipeline.build 构造当步 messages（含最新 memory、工具历史）
 *   2. streamText 启动并同步把 chunk 回调给外层（text-delta / tool-call / tool-result）
 *   3. await consumeStream 等流结束
 *   4. 按本步是否有工具调用决定落库策略：
 *      - 无工具 + 有文本 → 写一条 assistant 消息（带原始 messageId，下次读取可覆盖），返回 wroteAssistantFinal=true、shouldContinue=false
 *      - 无工具 + 无文本 → 返回 shouldContinue=false（交给兜底摘要）
 *      - 有工具 + toolResults 非空 → 写 assistant（text + tool_use blocks）+ tool 两条消息，返回 shouldContinue=true
 *      - 有工具 + toolResults 为空 → 异常退出，shouldContinue=false
 */
async function runReactStep(ctx: StepContext, stepIndex: number, maxSteps: number): Promise<StepOutcome> {
  const pipelineCtx = {
    sessionId: ctx.sessionId,
    currentMessage: { text: ctx.userContent, attachments: ctx.mappedAttachments },
    provider: ctx.provider,
    providerConfig: ctx.providerConfig,
    workspacePath: ctx.workspace || undefined,
  }
  const { messages } = await ctx.pipeline.build(pipelineCtx)
  log.info(`[ReactLoop] step ${stepIndex + 1}/${maxSteps}, messages: ${messages.length}`)

  const stepToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
  let stepText = ''

  const result = streamText({
    model: ctx.model,
    messages,
    tools: ctx.tools,
    abortSignal: buildStreamSignal(ctx.abortSignal),
    onChunk({ chunk }) {
      if (chunk.type === 'text-delta') {
        stepText += chunk.text
        if (chunk.text.length > 0) ctx.callbacks.onTextDelta(chunk.text)
      } else if (chunk.type === 'tool-call') {
        stepToolCalls.push({ toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input })
        ctx.callbacks.onToolCall(chunk.toolCallId, chunk.toolName, chunk.input)
      } else if (chunk.type === 'tool-result') {
        ctx.callbacks.onToolResult(chunk.toolCallId, chunk.toolName, chunk.output)
      }
    },
    onError({ error }) {
      log.error('[ReactLoop] Stream error:', error)
    },
  })

  try {
    await result.consumeStream()
  } catch (streamErr) {
    log.error(`[ReactLoop] consumeStream failed at step ${stepIndex + 1}:`, streamErr)
    throw streamErr
  }
  log.info(`[ReactLoop] consumed, toolCalls: ${stepToolCalls.length}, stepText: ${stepText.length}`)

  // 分支 1：无工具调用
  if (stepToolCalls.length === 0) {
    if (stepText) {
      messageRepo.create({
        id: ctx.messageId,
        session_id: ctx.sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: stepText }],
      })
      sessionRepo.touch(ctx.sessionId)
      return { stepText, hadToolCalls: false, wroteAssistantFinal: true, shouldContinue: false }
    }
    return { stepText: '', hadToolCalls: false, wroteAssistantFinal: false, shouldContinue: false }
  }

  // 分支 2：有工具调用
  const toolResults = await result.toolResults
  if (toolResults.length === 0) {
    log.error('[ReactLoop] Tool calls made but no results returned, breaking')
    return { stepText, hadToolCalls: true, wroteAssistantFinal: false, shouldContinue: false }
  }

  const assistantBlocks: ContentBlock[] = []
  if (stepText) assistantBlocks.push({ type: 'text', text: stepText })
  for (const tc of stepToolCalls) {
    assistantBlocks.push({ type: 'tool_use', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
  }
  messageRepo.create({ id: uuidv4(), session_id: ctx.sessionId, role: 'assistant', content: assistantBlocks })

  const toolBlocks: ContentBlock[] = toolResultPartsToBlocks(toolResults)
  messageRepo.create({ id: uuidv4(), session_id: ctx.sessionId, role: 'tool', content: toolBlocks })
  log.info(`[ReactLoop] Persisted assistant + tool messages for step ${stepIndex + 1}`)

  return { stepText, hadToolCalls: true, wroteAssistantFinal: false, shouldContinue: true }
}

/**
 * 兜底摘要。
 *
 * 触发条件：runReactLoop 主循环结束后：
 *   - fullText 为 0（整轮没有吐出任何文本）
 *   - 且未写过最终 assistant 消息
 *
 * 行为：构造一次不带 tools 的 streamText，把文本流式写给 callback 并在结束后落库。
 * 任何异常仅记录，不抛出——避免破坏 chat 的 done 语义。
 */
async function runFallbackSummary(ctx: StepContext): Promise<void> {
  log.info('[ReactLoop] No final text, requesting forced summary')
  try {
    const summaryCtx = {
      sessionId: ctx.sessionId,
      currentMessage: { text: ctx.userContent, attachments: ctx.mappedAttachments },
      provider: ctx.provider,
      providerConfig: ctx.providerConfig,
      workspacePath: ctx.workspace || undefined,
    }
    const { messages } = await ctx.pipeline.build(summaryCtx)
    const summaryResult = streamText({
      model: ctx.model,
      messages,
      abortSignal: buildStreamSignal(ctx.abortSignal),
    })
    let summaryText = ''
    for await (const chunk of summaryResult.textStream) {
      summaryText += chunk
      ctx.callbacks.onTextDelta(chunk)
    }
    if (summaryText.trim()) {
      messageRepo.create({
        id: uuidv4(),
        session_id: ctx.sessionId,
        role: 'assistant',
        content: [{ type: 'text', text: summaryText }],
      })
      sessionRepo.touch(ctx.sessionId)
      log.info('[ReactLoop] Forced summary written, length:', summaryText.length)
    }
  } catch (err) {
    log.error('[ReactLoop] Forced summary failed:', err)
  }
}

/**
 * ReAct 循环顶层。
 *
 * 终止条件（任一触发即退出）：
 *   a. abortSignal.aborted（调用方主动停止）
 *   b. 达到 maxSteps
 *   c. 某步无工具调用（正常终态）
 *   d. 某步有工具调用但 toolResults 为空（异常保护）
 *
 * 兜底：循环结束后，若整轮 fullText 为空且未写过最终 assistant 消息，
 * 追加调用 runFallbackSummary 以保证用户至少看到一段文本。
 */
export async function runReactLoop(opts: ReactLoopOptions): Promise<void> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  const ctx: StepContext = {
    model: opts.model,
    tools: opts.tools,
    sessionId: opts.sessionId,
    messageId: opts.messageId,
    userContent: opts.userContent,
    mappedAttachments: opts.mappedAttachments,
    abortSignal: opts.abortSignal,
    pipeline: opts.pipeline,
    provider: opts.provider,
    providerConfig: opts.providerConfig,
    workspace: opts.workspace,
    callbacks: opts.callbacks,
  }

  let fullText = ''
  let wroteAssistantFinal = false

  for (let step = 0; step < maxSteps; step++) {
    if (opts.abortSignal.aborted) break
    const outcome = await runReactStep(ctx, step, maxSteps)
    fullText += outcome.stepText
    if (outcome.wroteAssistantFinal) wroteAssistantFinal = true
    if (!outcome.shouldContinue) break
  }

  if (!wroteAssistantFinal && fullText.length === 0 && !opts.abortSignal.aborted) {
    await runFallbackSummary(ctx)
  }
}
```

- [ ] **Step 2: 跑 react-loop 测试确认不回归**

```bash
cd /Users/quinn.li/Desktop/talor && npx vitest run src/main/loop/react-loop.test.ts 2>&1 | tail -10
```

Expected: 2 tests pass（原有 text-only / abort）

> 若因 `ctx.abortSignal.aborted` 新增的兜底守卫影响了现有测试（abort 测试期望不触发兜底），确认已对齐；当前实现只在 `!aborted` 时触发兜底，符合预期。

- [ ] **Step 3: 修 `ipc/session.ts` 的 V7（尾部 import 上移）**

打开 `src/main/ipc/session.ts`，把第 74 行 `import { messageRepo } from '../repos/session-repo'` 删除，并在第 2 行把 `messageRepo` 合并进已有的 import：

把第 2 行 `import { sessionRepo, ChatSession, ChatMessage } from '../repos/session-repo'` 改为：
```typescript
import { sessionRepo, messageRepo, ChatSession, ChatMessage } from '../repos/session-repo'
```

- [ ] **Step 4: 给 `prompt/PromptPipeline.ts` 补分层注释**

在文件顶部（第 1 行前）插入：

```typescript
// src/main/prompt/PromptPipeline.ts —— 业务层：Prompt 构建流水线
//
// 允许依赖：store/*（读配置）、memory/*、shared/*
// 禁止依赖：ipc/*
//
// 已知欠款：resolveProviderConfig 直接引用 ConfigStore 单例。后续可能改为依赖注入。
```

其余保持不变。

- [ ] **Step 5: 给 `mcp/client.ts` 关键方法补 JSDoc**

找到 `private async registerTools` 和其中的 inline `provider.execute` 方法，在 `execute` 方法前加：

在 `provider = { ... async execute(...)` 前加 JSDoc（一行紧凑写法即可）：

```typescript
      /**
       * MCP 工具执行。
       *  - 若连接断开，尝试重连 3 次（1s/2s/4s backoff）；失败返回错误字符串
       *  - 成功调用加 30s 超时保护
       *  - 任何异常都被包装成 { output: "...错误字符串..." }，保证 ReAct 循环不中断
       */
      async execute(
```

（注意：原代码 `async execute` 是对象字面量方法；把 JSDoc 放在 `async execute` 行之前即可）

- [ ] **Step 6: 给 `ipc/*.ts` 其余文件加顶部分层注释**

`ipc/chat.ts` 已在 T8 写过头注释；`ipc/tool-confirm.ts` 在 T7 加过端口 export。本步给剩余 6 个 ipc 文件在第 1 行**之前**插入 2 行注释（不改任何实现）：

对以下 6 个文件，每个文件都在最顶部加：

**`src/main/ipc/session.ts`**
```typescript
// src/main/ipc/session.ts —— 入口层：session IPC handlers
// 允许依赖：services/*（基础能力）、repos/*、shared/*    禁止依赖：loop/*
```

**`src/main/ipc/config.ts`**
```typescript
// src/main/ipc/config.ts —— 入口层：config IPC handlers
// 允许依赖：store/*、shared/*    禁止依赖：业务层运行时代码
```

**`src/main/ipc/fileHandlers.ts`**
```typescript
// src/main/ipc/fileHandlers.ts —— 入口层：文件系统 IPC handlers
// 允许依赖：shared/*、services/*（基础能力）
```

**`src/main/ipc/mcp.ts`**
```typescript
// src/main/ipc/mcp.ts —— 入口层：MCP IPC handlers
// 允许依赖：mcp/*、repos/*、shared/*
```

**`src/main/ipc/providers.ts`**
```typescript
// src/main/ipc/providers.ts —— 入口层：provider IPC handlers
// 允许依赖：services/*（provider-fetcher 等基础能力）、store/*、shared/*
```

**`src/main/ipc/window.ts`**
```typescript
// src/main/ipc/window.ts —— 入口层：窗口管理 IPC handlers
// 允许依赖：shared/*
```

**`src/main/ipc/tool-confirm.ts`**（若 T7 未加则在此补）
```typescript
// src/main/ipc/tool-confirm.ts —— 入口层：高风险工具确认端点 + 端口类型
// 允许依赖：shared/*    业务层只依赖 ToolConfirmPort 类型，不依赖 requestToolConfirm 实现
```

- [ ] **Step 7: 新建 `src/main/ARCHITECTURE.md`**

```markdown
# main 进程分层约定

**依赖方向单向：入口 → 业务 → 仓储 → 基础设施。**

## 层与目录

| 层 | 目录 | 职责 | 允许依赖 | 禁止 |
|----|------|------|---------|------|
| 入口 | `ipc/` | IPC 协议注册、参数解包、事件转发、错误码映射、snake/camel 命名转换 | 业务层任意目录、`repos/*`、`shared/*` | 业务决策 |
| 业务（按领域聚合） | `chat/`、`loop/`、`tools/`、`prompt/`、`memory/`、`mcp/`、`providers/` | `chat/` = chat 用例编排（orchestrator / attachments / provider-selector / stream-registry）；`loop/` = ReAct 引擎；其余为各自领域模块 | 业务层其他目录、`repos/*`、`store/*`（只读）、`shared/*` | `ipc/*` |
| 仓储 | `repos/` | SQL CRUD，领域对象转换 | `db/*`、`shared/*` | 业务层以外的任何调用 |
| 基础 | `db/`、`store/`、`services/*` | sqlite 连接、electron-store、OS keychain、provider-fetcher 等原子基础能力 | `shared/*` | — |

**关键区分：** `chat/` 是**用例层**（怎么把一次 chat:send 跑完整），`loop/` 是**引擎层**（给定已就绪的 model/tools，怎么完成 ReAct）；编排调用引擎，未来可复用同一个 `loop/`。`services/` **不**作为"业务层容器"使用，只放原子基础能力。

## 跨层通信约定

业务层与入口层解耦靠**端口注入**：

- **ToolConfirmPort**：`tools/build-tools.ts` 不直接 import `ipc/tool-confirm`；入口层创建 `(payload) => requestToolConfirm(mainWindow, payload)` 传入。
- **ChatCallbacks**：`chat/orchestrator.ts` 通过 callback 上报 text/tool 事件；入口层把 callback 转成 `webContents.send`。
- **流式中止**：业务层用 `AbortSignal`，入口层通过 `streamRegistry.abort(sessionId)` 触发。

## 审查清单

写代码时自检：

- [ ] 本文件属于哪一层？顶部注释有声明吗？
- [ ] import 是否仅来自允许依赖的层？
- [ ] 业务逻辑是否从 `ipc/` 下沉到对应领域目录（`chat/` / `loop/` / `tools/` …）？
- [ ] 与入口层耦合的地方，是否通过 callback / 端口注入解耦？
- [ ] 关键方法（循环控制、超时、错误兜底）是否有 JSDoc 说明 "为什么"？
```

- [ ] **Step 8: 类型检查**

```bash
cd /Users/quinn.li/Desktop/talor && npm run typecheck 2>&1 | tail -15
```

Expected: 无错误

- [ ] **Step 9: 全量测试**

```bash
cd /Users/quinn.li/Desktop/talor && npm run test 2>&1 | tail -20
```

Expected: 所有测试通过

- [ ] **Step 10: 构建**

```bash
cd /Users/quinn.li/Desktop/talor && npm run build 2>&1 | tail -15
```

Expected: 构建成功

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(main): split react-loop into step/summary; add JSDoc; fix session import; add ARCHITECTURE.md

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 最终验证（手动冒烟）

完成 Task 9 后，启动开发环境手动走一遍：

- [ ] **Step 1: 启动 dev 服务器**

```bash
cd /Users/quinn.li/Desktop/talor && npm run dev
```

- [ ] **Step 2: 冒烟场景**

| 场景 | 预期 |
|------|------|
| 选默认 provider（enable + is_default），发送纯文本 | 流式 SSE 正常，消息落库 |
| 带 PNG 图片 + 支持 vision 的 provider | 识图正常 |
| 带 PNG 图片 + 不支持 vision 的 provider | 前端收到 `error_code: PROVIDER_NO_VISION` |
| 触发 bash/write/edit 高风险工具 | 弹出确认框；确认后执行；拒绝返回 "用户拒绝执行" |
| 发送中点停止按钮 | 流立刻结束；再发一条新消息能正常工作 |
| MCP 工具调用（若有可连 MCP server） | 工具执行、结果回显正常 |
| 设置一个错误的 API key | 前端收到 `error_code: AUTH_FAILED` |

- [ ] **Step 3: 验证完成后，清理 dev 进程**

```bash
# Ctrl+C 停 dev；查无残留 electron
pgrep -fl electron
```

---

## 自检（Plan 完成后）

**Spec coverage（spec → task 映射）：**

- ✅ §1 分层定义 → T9 新建 ARCHITECTURE.md
- ✅ §2 违反清单
  - V1 重复 import → T3
  - V2 业务函数下沉 → T5/T6/T8
  - V3 activeStreams/pipeline 单例搬业务层 → T4/T8
  - V4 chat-utils 拆分 → T1/T2/T3
  - V5 loop→ipc 反向依赖 → T2/T3
  - V6 tools→ipc 反向依赖 → T7
  - V7 尾部 import → T9 Step 3
  - V8 PromptPipeline ConfigStore → T9 Step 4（加注释标记欠款）
- ✅ §3 业务层内部切分 → T1–T8 各建新文件
- ✅ §4 chat/orchestrator 编排 → T8
- ✅ §5 ipc/chat.ts 精简 → T8
- ✅ §6 react-loop 切分 → T9
- ✅ §7 端口注入 → T7
- ✅ §8 JSDoc 清单 → T1/T2/T4/T5/T6/T7/T8/T9 各自补齐
- ✅ §9 测试计划 → 每个新模块带 .test.ts
- ✅ §10 验证流程 → 最终验证段落
- ✅ §11 文件变更总表 → 顶部总览对齐
- ✅ §12 范围外（不迁目录）→ 已遵守
- ✅ §13 风险回滚 → 每步独立 commit

**Placeholder scan:** 无 "TBD / TODO / 后续补充 / 省略"。所有代码块都给出完整实现。

**Type consistency：**
- `ChatSendParams.sessionId` 在 T8 定义（camelCase），`ipc/chat.ts` handler 做 snake_case 兼容 —— 一致
- `ToolConfirmPort` 在 T7 定义，T8 的 ChatPorts 引用 —— 一致
- `ChatCallbacks.onDone(messageId, err?)` 在 T8 定义和使用 —— 一致
- `runReactLoop`/`runReactStep`/`runFallbackSummary` 在 T9 协同 —— 一致
- `ValidatedAttachment` 在 T6 定义、T8 使用 —— 一致

**已知不做：**
- PromptPipeline 依赖注入化（V8，显式延后）
- 目录迁移（spec §12 明示）
- 渲染进程改动（spec §12 明示）
