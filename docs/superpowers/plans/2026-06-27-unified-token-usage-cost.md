# Session Token 统计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把每个 session 消耗的 token(主对话 + reflect + memory 压缩)累计到 `sessions` 行上,并在 session UI 显示一个 token 统计。**不算成本、不新建表、不接外部价格源。**

**Architecture:** token 用量是 session 级的累计状态 → 直接做成 `sessions` 表的列(与 opencode 同款),每次 LLM 调用 `UPDATE sessions SET input_tokens = input_tokens + ?`。用量数据来自 Vercel AI SDK 已返回的 `result.usage` + `result.providerMetadata`(react-loop 早就在读)。新增仅:① `sessions` 加 4 列(增量 ALTER,不丢历史);② 纯函数 `normalizeUsage`;③ 薄函数 `recordUsage`;在 3 个已有调用点各调一次。`session:get`/`session:list` 已把 session 对象返给 renderer → **无需新 IPC**,renderer 直接读列。

**Tech Stack:** TypeScript, Electron main, AI SDK v6, better-sqlite3, vitest, electron-log。

**关键事实:**
- AI SDK v6 `usage.inputTokens` 已跨厂商归一为**含缓存**;缓存细分在 `providerMetadata`(各家 key 不同)→ 归一 = 从 input 减去缓存。
- 3 个调用点(react-loop / runReflectAgent / ShortTermMemory)各自持有 `result.usage` 和所属 `sessionId` → 归因当参数传,**无需 AsyncLocalStorage**。
- `sessions` 表有 `recreateSessionsIfOutdated` 的 drop-recreate 机制([db/index.ts:223](../../src/main/db/index.ts)),只在**必需列缺失**时触发。本方案用**增量 ALTER 加列、不进必需列清单** → 不触发 drop,**保留用户历史 session**。
- `session:get` 返回 `rowToSession(row)` → `ChatSession`([session-repo.ts:59](../../src/main/repos/session-repo.ts))。给 `ChatSession` 加字段即被 renderer 拿到。
- 子 agent 是独立子 session;其 token 记在子 session 行,父 session 要"含子"总数时按 `parent_session_id` 求和(本方案先只显示自身,求和留后续)。

---

## File Structure

**新建:**
- `src/main/providers/usage-normalizer.ts` + `.test.ts` — 纯函数 `normalizeUsage(usage, providerMetadata)`
- `src/main/providers/usage-recorder.ts` + `.test.ts` — `recordUsage(sessionId, usage, providerMetadata)`(归一 + 调 repo,fail-open)

**修改:**
- `src/main/db/index.ts` — `sessions` 加 4 列 + 增量 ALTER
- `src/main/repos/session-repo.ts` — `SessionRow`/`ChatSession`/`rowToSession` 加字段 + `addUsage()` 方法
- `src/main/loop/react-loop.ts` — 主循环每步调 `recordUsage`
- `src/main/loop/reflect/agents/types.ts` + 4 个 reflector — `runReflectAgent` 捕获 usage 并调 `recordUsage`
- `src/main/memory/ShortTermMemory.ts` — 压缩调用后调 `recordUsage`
- `src/renderer/pages/Chat/index.tsx` + renderer session 类型:消息区与输入框接缝处显示 token + done 后刷新

---

## Task 1: sessions 加 token 列(增量、不丢历史)

**Files:**
- Modify: `src/main/db/index.ts`

- [ ] **Step 1: CREATE_SESSIONS 加列(供新 DB)**

把 `CREATE_SESSIONS`(约 [db/index.ts:7](../../src/main/db/index.ts))的列定义,在 `updated_at TEXT NOT NULL` 之后加 4 列:

```sql
    updated_at TEXT NOT NULL,
    input_tokens       INTEGER NOT NULL DEFAULT 0,
    output_tokens      INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0
```

- [ ] **Step 2: 加增量迁移函数(供旧 DB)**

在 `closeChatDb` 之前新增:

```ts
/**
 * 给已存在的 sessions 表补 token 统计列(增量 ALTER, 不丢历史)。
 * 列已存在时 SQLite 报 "duplicate column", 捕获忽略 → 幂等。
 * 注: 这几列**不进** recreateSessionsIfOutdated 的必需列清单, 避免触发 drop。
 */
function ensureSessionUsageColumns(db: Database.Database): void {
  const cols = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']
  for (const c of cols) {
    try {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`)
      log.info(`[ChatDB] added sessions.${c}`)
    } catch {
      // 列已存在, 忽略
    }
  }
}
```

- [ ] **Step 3: initChatDb 调用**

在 `db.exec(CREATE_SESSIONS)`(约 db/index.ts:182)之后加:

```ts
  ensureSessionUsageColumns(db)
```

- [ ] **Step 4: typecheck + 提交**

Run: `npm run typecheck`

```bash
git add src/main/db/index.ts
git commit -m "feat(db): add token usage columns to sessions (additive, preserves history)"
```

---

## Task 2: session-repo 加字段 + addUsage

**Files:**
- Modify: `src/main/repos/session-repo.ts`

- [ ] **Step 1: SessionRow 加列**

`SessionRow`(约 [session-repo.ts:9](../../src/main/repos/session-repo.ts))在 `updated_at: string` 后加:

```ts
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
```

- [ ] **Step 2: ChatSession 加字段**

`ChatSession`(约 session-repo.ts:34)在 `updated_at: string` 后加:

```ts
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
```

- [ ] **Step 3: rowToSession 映射(旧行可能无列 → 兜底 0)**

`rowToSession`(约 session-repo.ts:59)返回对象里加:

```ts
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    cache_read_tokens: row.cache_read_tokens ?? 0,
    cache_write_tokens: row.cache_write_tokens ?? 0,
```

- [ ] **Step 4: create 返回对象补 0(新建 session token 为 0)**

`create` 的返回对象(约 session-repo.ts:157)里加:

```ts
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
```

- [ ] **Step 5: 加 addUsage 方法**

在 `sessionRepo` 对象里(`setMetadata` 之后)加:

```ts
  /**
   * 累加 session 的 token 用量(归一后的非缓存 input / output / 缓存读写)。
   * 增量 UPDATE; fail-open(出错只 warn, 不阻断主流程)。
   */
  addUsage(
    id: string,
    t: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  ): void {
    try {
      getDb()
        .prepare(
          `UPDATE sessions SET
             input_tokens       = input_tokens + ?,
             output_tokens      = output_tokens + ?,
             cache_read_tokens  = cache_read_tokens + ?,
             cache_write_tokens = cache_write_tokens + ?
           WHERE id = ?`,
        )
        .run(t.inputTokens, t.outputTokens, t.cacheReadTokens, t.cacheWriteTokens, id)
    } catch (err) {
      log.warn('[SessionRepo] addUsage failed:', id, err)
    }
  },
```

- [ ] **Step 6: typecheck + 提交**

Run: `npm run typecheck`
> 注:若 `rowToSession` 调用处别处有显式构造 ChatSession 的地方因新增必填字段报错,补 0 即可。

```bash
git add src/main/repos/session-repo.ts
git commit -m "feat(repos): session token columns + addUsage incremental update"
```

---

## Task 3: usage 归一(纯函数)

**Files:**
- Create: `src/main/providers/usage-normalizer.ts`
- Test: `src/main/providers/usage-normalizer.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/providers/usage-normalizer.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeUsage } from './usage-normalizer'

describe('normalizeUsage', () => {
  it('subtracts anthropic cache tokens from inclusive inputTokens', () => {
    const u = normalizeUsage(
      { inputTokens: 1000, outputTokens: 200 },
      { anthropic: { cacheReadInputTokens: 600, cacheCreationInputTokens: 100 } },
    )
    expect(u.cacheReadTokens).toBe(600)
    expect(u.cacheWriteTokens).toBe(100)
    expect(u.inputTokens).toBe(300)
    expect(u.outputTokens).toBe(200)
  })

  it('reads openai cached tokens without needing providerType', () => {
    const u = normalizeUsage({ inputTokens: 500, outputTokens: 50 }, { openai: { cachedPromptTokens: 200 } })
    expect(u.cacheReadTokens).toBe(200)
    expect(u.inputTokens).toBe(300)
  })

  it('handles missing usage / metadata', () => {
    const u = normalizeUsage(undefined, undefined)
    expect(u.inputTokens).toBe(0)
    expect(u.outputTokens).toBe(0)
  })

  it('never returns negative non-cached input', () => {
    const u = normalizeUsage({ inputTokens: 100 }, { anthropic: { cacheReadInputTokens: 999 } })
    expect(u.inputTokens).toBe(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/main/providers/usage-normalizer.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// src/main/providers/usage-normalizer.ts —— 把 SDK usage 归一成统一 token 细分
//
// AI SDK v6 的 usage.inputTokens 已跨厂商含缓存。缓存细分散落在 providerMetadata
// 各 provider 命名空间(key 各异)。本函数扫所有命名空间取缓存 token, 从 input 减掉得
// 非缓存 input。纯函数, 无副作用, 无需知道是哪个 provider。

export interface NormalizedUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

interface RawUsage {
  inputTokens?: number
  outputTokens?: number
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function extractCacheTokens(meta: Record<string, unknown> | undefined): { read: number; write: number } {
  if (!meta || typeof meta !== 'object') return { read: 0, write: 0 }
  for (const v of Object.values(meta)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const read = num(
      o.cacheReadInputTokens ?? o.cachedPromptTokens ?? o.cachedTokens ?? o.cachedContentTokenCount,
    )
    const write = num(o.cacheCreationInputTokens ?? o.cacheWriteInputTokens)
    if (read > 0 || write > 0) return { read, write }
  }
  return { read: 0, write: 0 }
}

export function normalizeUsage(
  raw: RawUsage | undefined,
  providerMetadata: Record<string, unknown> | undefined,
): NormalizedUsage {
  const inclusiveInput = num(raw?.inputTokens)
  const { read, write } = extractCacheTokens(providerMetadata)
  return {
    inputTokens: Math.max(0, inclusiveInput - read - write),
    outputTokens: num(raw?.outputTokens),
    cacheReadTokens: read,
    cacheWriteTokens: write,
  }
}
```

- [ ] **Step 4: 运行通过 + 提交**

Run: `npx vitest run src/main/providers/usage-normalizer.test.ts`
Expected: PASS

```bash
git add src/main/providers/usage-normalizer.ts src/main/providers/usage-normalizer.test.ts
git commit -m "feat(providers): vendor-agnostic usage normalizer"
```

---

## Task 4: recordUsage(归一 + 累加到 session)

**Files:**
- Create: `src/main/providers/usage-recorder.ts`
- Test: `src/main/providers/usage-recorder.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/main/providers/usage-recorder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAddUsage } = vi.hoisted(() => ({ mockAddUsage: vi.fn() }))
vi.mock('../repos/session-repo', () => ({ sessionRepo: { addUsage: mockAddUsage } }))

import { recordUsage } from './usage-recorder'

describe('recordUsage', () => {
  beforeEach(() => mockAddUsage.mockClear())

  it('normalizes then adds to session', () => {
    recordUsage('s1', { inputTokens: 1000, outputTokens: 100 }, { anthropic: { cacheReadInputTokens: 400 } })
    expect(mockAddUsage).toHaveBeenCalledWith('s1', {
      inputTokens: 600, outputTokens: 100, cacheReadTokens: 400, cacheWriteTokens: 0,
    })
  })

  it('skips when usage absent', () => {
    recordUsage('s1', undefined, undefined)
    expect(mockAddUsage).not.toHaveBeenCalled()
  })

  it('never throws', () => {
    mockAddUsage.mockImplementation(() => { throw new Error('boom') })
    expect(() => recordUsage('s1', { inputTokens: 1 }, undefined)).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/main/providers/usage-recorder.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// src/main/providers/usage-recorder.ts —— 业务层: 归一 SDK usage 后累加到 session
//
// 调用点(react-loop / runReflectAgent / ShortTermMemory)拿到 SDK 的 usage +
// providerMetadata 后调本函数。sessionId 由调用点直接传。fail-open。

import log from 'electron-log'
import { normalizeUsage } from './usage-normalizer'
import { sessionRepo } from '../repos/session-repo'

export function recordUsage(
  sessionId: string,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  providerMetadata: Record<string, unknown> | undefined,
): void {
  try {
    if (!usage) return
    const n = normalizeUsage(usage, providerMetadata)
    if (n.inputTokens === 0 && n.outputTokens === 0 && n.cacheReadTokens === 0 && n.cacheWriteTokens === 0) return
    sessionRepo.addUsage(sessionId, n)
  } catch (err) {
    log.warn('[usage-recorder] recordUsage failed:', err)
  }
}
```

- [ ] **Step 4: 运行通过 + 提交**

Run: `npx vitest run src/main/providers/usage-recorder.test.ts`
Expected: PASS

```bash
git add src/main/providers/usage-recorder.ts src/main/providers/usage-recorder.test.ts
git commit -m "feat(providers): recordUsage — normalize and accumulate token usage onto session"
```

---

## Task 5: 接入主循环

**Files:**
- Modify: `src/main/loop/react-loop.ts`

- [ ] **Step 1: import + 每步落 usage**

顶部加 `import { recordUsage } from '../providers/usage-recorder'`。

在 `runReactStep` 内、usage/providerMetadata 已算出([react-loop.ts:681-688](../../src/main/loop/react-loop.ts))之后,持久化之后(约 line 705)加:

```ts
    recordUsage(ctx.sessionId, usage, providerMetadata as Record<string, unknown> | undefined)
```

- [ ] **Step 2: typecheck + 提交**

Run: `npm run typecheck`

```bash
git add src/main/loop/react-loop.ts
git commit -m "feat(loop): accumulate main-loop token usage onto session"
```

---

## Task 6: 接入 reflect agents

**Files:**
- Modify: `src/main/loop/reflect/agents/types.ts`
- Modify: `judge-completion.ts` / `quote-correction.ts` / `periodic.ts` / `escalation.ts`

- [ ] **Step 1: runReflectAgent 捕获 usage**

`agents/types.ts` 顶部加 `import { recordUsage } from '../../../providers/usage-recorder'`。

签名加可选 `sessionId`,并把 `generateText` 改为捕获完整结果(改 [agents/types.ts:52-69](../../src/main/loop/reflect/agents/types.ts)):

```ts
export async function runReflectAgent<SNAPSHOT, RESULT>(
  agent: ReflectAgent<SNAPSHOT, RESULT>,
  snapshot: SNAPSHOT,
  model: LanguageModel,
  abortSignal: AbortSignal,
  sessionId?: string,
): Promise<RESULT | null> {
  const timeoutMs = agent.timeoutMs ?? 30_000
  const combinedSignal = AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)])
  try {
    const res = await generateText({
      model,
      messages: [
        { role: 'system', content: agent.systemPrompt + JSON_INSTRUCTION },
        { role: 'user', content: agent.buildUserPrompt(snapshot) },
      ],
      maxOutputTokens: agent.maxOutputTokens,
      abortSignal: combinedSignal,
    })
    if (sessionId) {
      recordUsage(sessionId, res.usage, res.providerMetadata as Record<string, unknown> | undefined)
    }
    const text = res.text
    // ... stripJsonFence(text) 起的逻辑不变 ...
```

- [ ] **Step 2: 4 个 reflector 传 sessionId**

每个 `runReflectAgent(...)` 调用末尾(在 `ctx.abortSignal,` 后)加 `ctx.sessionId,`:
- [judge-completion.ts:141](../../src/main/loop/reflect/judge-completion.ts)
- [quote-correction.ts:52](../../src/main/loop/reflect/quote-correction.ts)
- `periodic.ts` 的 runReflectAgent 调用
- `escalation.ts` 的 runReflectAgent 调用

- [ ] **Step 3: typecheck + 跑 reflect 测试 + 提交**

Run: `npm run typecheck && npx vitest run src/main/loop/reflect`
Expected: 通过(`sessionId` 可选,旧测试不受影响)

```bash
git add src/main/loop/reflect
git commit -m "feat(loop): accumulate reflect-agent token usage onto session"
```

---

## Task 7: 接入 memory 压缩

**Files:**
- Modify: `src/main/memory/ShortTermMemory.ts`

- [ ] **Step 1: 压缩 LLM 调用后落 usage**

顶部加 `import { recordUsage } from '../providers/usage-recorder'`。

定位 `generateSummary`(约 [ShortTermMemory.ts:315-405](../../src/main/memory/ShortTermMemory.ts))里的 `generateObject`/`generateText` 调用,其作用域内有 `sessionId`。拿到结果后加:

```ts
    recordUsage(sessionId, result.usage, result.providerMetadata as Record<string, unknown> | undefined)
```

> `result` / `sessionId` 用该方法内实际变量名;若 `generateSummary` 未持有 sessionId,从调用方 `getContext(sessionId, ...)` 透传进来。

- [ ] **Step 2: typecheck + 跑 memory 测试 + 提交**

Run: `npm run typecheck && npx vitest run src/main/memory`
Expected: 通过

```bash
git add src/main/memory/ShortTermMemory.ts
git commit -m "feat(memory): accumulate compression token usage onto session"
```

---

## Task 8: session UI 显示 token 统计(消息区与输入框之间的接缝)

**确认的位置**:输入区容器 [Chat/index.tsx:1224](../../src/renderer/pages/Chat/index.tsx) `<div className="shrink-0 px-8 py-[14px] bg-canvas border-t border-line">` 内,作为**第一个子元素**(在附件预览 / composer 卡片之前),右对齐小字状态行;点击向上展开细分。在输入框**外面** → 不会被当成输入 token。

**Files:**
- Modify: renderer 的 session 类型定义(与主进程 `ChatSession` 对应处)
- Modify: `src/renderer/pages/Chat/index.tsx`

- [ ] **Step 1: renderer Session 类型加 4 字段**

在 renderer 端 session 类型定义处(对应主进程 `ChatSession`,`sessions` state 的元素类型)加:

```ts
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
```

> 若 renderer 直接 import 主进程 `ChatSession` 类型,则 Task 2 已自动覆盖,无需重复。

- [ ] **Step 2: 加 showUsage 展开状态**

在 `Chat/index.tsx` 组件内,与其它 popover 状态(如 `showToolsPopover`)同处加:

```tsx
  const [showUsage, setShowUsage] = useState(false)
```

- [ ] **Step 3: 接缝处插入状态行**

在 [Chat/index.tsx:1224](../../src/renderer/pages/Chat/index.tsx) 的输入区容器内、附件预览块([:1226](../../src/renderer/pages/Chat/index.tsx))**之前**,插入(沿用文件内 inline-style + hex 配色惯例):

```tsx
              {/* Session token usage — 消息区与输入框之间的接缝 */}
              {(() => {
                const s = sessions.find((x) => x.id === currentSessionId)
                if (!s || s.input_tokens + s.output_tokens === 0) return null
                const rows: Array<[string, number, string]> = [
                  ['输入', s.input_tokens, '#334155'],
                  ['输出', s.output_tokens, '#334155'],
                  ['缓存读', s.cache_read_tokens, '#059669'],
                  ['缓存写', s.cache_write_tokens, '#334155'],
                ]
                return (
                  <div className="relative flex justify-end mb-2.5">
                    {showUsage && (
                      <div
                        className="absolute bottom-full right-0 mb-1.5 rounded-[10px] overflow-hidden z-40"
                        style={{
                          width: 216,
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          boxShadow: '0 6px 24px rgba(0,0,0,0.10)',
                        }}
                      >
                        <div
                          className="px-3 py-2 border-b"
                          style={{
                            borderColor: '#f1f5f9',
                            fontSize: 10,
                            letterSpacing: '0.03em',
                            textTransform: 'uppercase',
                            color: '#94a3b8',
                          }}
                        >
                          本会话累计
                        </div>
                        <div className="px-3 py-2">
                          {rows.map(([label, val, color]) => (
                            <div
                              key={label}
                              className="flex justify-between py-0.5"
                              style={{ fontSize: 12, color: '#64748b' }}
                            >
                              <span>{label}</span>
                              <span style={{ color }}>{val.toLocaleString()}</span>
                            </div>
                          ))}
                          <div
                            className="mt-1.5 pt-1.5 border-t"
                            style={{ borderColor: '#f1f5f9', fontSize: 11, color: '#94a3b8' }}
                          >
                            含 reflect / 压缩调用
                          </div>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => setShowUsage((p) => !p)}
                      className="inline-flex items-center gap-1.5"
                      style={{ fontSize: 11, color: '#94a3b8' }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M12 2 2 7l10 5 10-5-10-5z" />
                        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
                      </svg>
                      本会话{' '}
                      <span style={{ color: '#64748b', fontWeight: 500 }}>
                        {(s.input_tokens + s.output_tokens).toLocaleString()}
                      </span>{' '}
                      tokens
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path d={showUsage ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
                      </svg>
                    </button>
                  </div>
                )
              })()}
```

- [ ] **Step 4: 一轮结束后刷新 token**

主进程已把 token 累加到 session 行,但 renderer 的 `sessions` 是旧的。在 chat 流结束处(收到 `chat:stream { done: true }` / `streamState` 回到 idle 的地方)调用现有的 `loadSessions()` 刷新(项目里已有该函数,见 [Chat/index.tsx](../../src/renderer/pages/Chat/index.tsx) 多处调用)。若该处已调 `loadSessions()` 则无需改动。

- [ ] **Step 5: 浏览器直测(项目记忆:UI 测试偏浏览器直测)+ 提交**

stub `talorAPI` 让 `sessions` 含带 token 字段的当前 session,验证:① 接缝处显示 `本会话 N tokens`;② 点击展开细分卡(向上弹);③ 模拟一轮后 `loadSessions` 刷新数字增长。

```bash
git add -A
git commit -m "feat(renderer): show per-session token usage in the seam above composer"
```

---

## Task 9: 端到端手动验证

- [ ] **Step 1: 跑 dev,发一条会调工具的消息**

Run: `npm run dev`,发消息,跑完后查 DB:

```bash
sqlite3 ~/.talor/chat.db "SELECT id, input_tokens, output_tokens, cache_read_tokens FROM sessions WHERE input_tokens > 0 ORDER BY updated_at DESC LIMIT 3;"
```
Expected: 当前 session 的 token 列非零(且含 reflect/压缩的隐藏调用——比"只数主对话"偏大)。

- [ ] **Step 2: UI 确认**

session 头部显示 token 数;再发一条消息后数字增长。

---

## Self-Review

**Spec coverage:**
- token 累计到 session(非新表)→ Task 1/2 ✅
- 厂商无关归一(含缓存 input 减缓存,扫 providerMetadata)→ Task 3 ✅
- 覆盖主对话 + reflect + 压缩 → Task 5/6/7 ✅
- session UI 显示 → Task 8 ✅
- 无新 IPC(复用 session:get)→ 确认 ✅

**类型一致性:** `NormalizedUsage`(normalizer)→ `recordUsage` 参数 → `sessionRepo.addUsage` 参数 `{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}` 字段名一致;`ChatSession` 的 4 个 `*_tokens` 列在 repo / renderer 一致。

**SDK 复用:** usage/providerMetadata 直接来自 `result.usage`/`res.usage`;无 middleware / ALS / 价格源 / 新表 / 新 IPC。

**需运行时核对(非占位):** Task 7 中 ShortTermMemory 压缩调用的 `result`/`sessionId` 变量名;Task 8 中 renderer session 类型文件、done 事件 hook、session 头部组件的具体位置——步骤已说明如何定位。

**未纳入(YAGNI):** 成本($)、models.dev、context_limit 修正、Anthropic 缓存断点、main/reflect 分拆、父 session 含子求和。均为独立后续项。

---

## 风险与注意

- **better-sqlite3 node/electron 版本切换**:跑 vitest 报 native 版本错时,按 CLAUDE.md §5 `npx electron-rebuild -f -w better-sqlite3`。
- **fail-open**:recordUsage / addUsage 出错只 warn,不影响主 turn。
- **旧 DB 升级**:增量 ALTER 不丢历史;旧 session token 列从 0 起算。
- **`generate*` result 字段**:`res.usage`/`res.providerMetadata` 字段名以安装的 AI SDK 版本为准;取不到先 log 一次确认形状。
