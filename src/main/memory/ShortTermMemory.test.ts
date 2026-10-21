import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ShortTermMemory, findRecentSplit, splitAnchorsAndCompressible } from './ShortTermMemory'
import { estimateMessage } from './types'
import { ExecutionEventBus } from '../chat/events'
import type { ProviderContextConfig } from '../prompt/types'
import type { ChatMessage } from '../repos/session-repo'

function makeMsg(id: string, text: string, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return {
    id,
    session_id: 'test-session',
    role,
    content: JSON.stringify([{ type: 'text', text }]),
    agent_id: '__chat__',
    created_at: `2026-04-25T00:00:00.${id.padStart(3, '0')}Z`,
  }
}

function makeToolUse(id: string, callId: string, inputPad = ''): ChatMessage {
  return {
    id,
    session_id: 'test-session',
    role: 'assistant',
    content: JSON.stringify([
      { type: 'tool-call', toolCallId: callId, toolName: 'bash', input: { cmd: `ls${inputPad}` } },
    ]),
    agent_id: '__chat__',
    created_at: '2026-04-25T00:00:00.000Z',
  }
}

function makeToolResult(id: string, callId: string, output: string): ChatMessage {
  return {
    id,
    session_id: 'test-session',
    role: 'tool',
    content: JSON.stringify([
      {
        type: 'tool-result',
        toolCallId: callId,
        toolName: 'bash',
        output: { type: 'text', value: output },
      },
    ]),
    agent_id: '__chat__',
    created_at: '2026-04-25T00:00:00.000Z',
  }
}

function makeConfig(
  context_limit: number,
  modelId: string | null = 'm-session',
): ProviderContextConfig {
  return {
    provider: {
      id: 'p1',
      type: 'ollama',
      models: [{ id: 'ollama/first-model' }],
    } as ProviderContextConfig['provider'],
    ...(modelId ? { modelId } : {}),
    context_limit,
    recent_ratio: 0.05,
    summary_ratio: 0.1,
  }
}

const SUMMARY_JSON = JSON.stringify({
  user_intent: '摘要文本',
  key_facts: [],
  pending_actions: [],
  resolved_issues: [],
  current_blocker: null,
})

function summaryResult(text = SUMMARY_JSON) {
  return { text, usage: {}, providerMetadata: undefined } as unknown as Awaited<
    ReturnType<typeof generateText>
  >
}

/** generateText 第 n 次调用的 user 消息内容。 */
function compressInput(n = 0): string {
  const callArg = vi.mocked(generateText).mock.calls[n][0]
  return (callArg.messages as Array<{ role: string; content: string }>).find(
    (m) => m.role === 'user',
  )!.content
}

vi.mock('../repos/session-repo', () => ({
  messageRepo: { listBySession: vi.fn() },
}))

vi.mock('better-sqlite3', () => {
  const stmtMock = { run: vi.fn(), get: vi.fn() }
  const dbMock = { prepare: vi.fn(() => stmtMock), exec: vi.fn() }
  return { default: vi.fn(() => dbMock) }
})

vi.mock('../db/index', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
  })),
}))

const { createModel } = vi.hoisted(() => ({ createModel: vi.fn(() => ({})) }))

vi.mock('ai', () => ({ generateText: vi.fn() }))

vi.mock('../providers/model-adapter', () => ({
  getAdapter: () => ({ createModel }),
}))

vi.mock('../providers/usage-recorder', () => ({ recordUsage: vi.fn() }))

import { messageRepo } from '../repos/session-repo'
import { getDb } from '../db/index'
import { generateText } from 'ai'

describe('ShortTermMemory.getContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateText).mockResolvedValue(summaryResult())
  })

  it('AC-001-01: session 为空时返回空结果', async () => {
    vi.mocked(messageRepo.listBySession).mockReturnValue([])
    const mem = new ShortTermMemory()
    const result = await mem.getContext('s1', makeConfig(8000))
    expect(result.summaryMessage).toBeNull()
    expect(result.recentMessages).toHaveLength(0)
    expect(result.tokenEstimate).toBe(0)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('AC-001-01: 未超阈值时返回全量历史消息(pop 末尾),无摘要', async () => {
    const msgs = Array.from({ length: 50 }, (_, i) => makeMsg(`msg-${i}`, '十个字符xx'))
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    const dbMock = { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })) }
    vi.mocked(getDb).mockReturnValue(dbMock as unknown as ReturnType<typeof getDb>)

    const mem = new ShortTermMemory()
    const result = await mem.getContext('s1', makeConfig(8000))

    expect(result.summaryMessage).toBeNull()
    // 末尾一条由 MessagePlugin 独立注入,Memory 只给 0..-2 共 49 条
    expect(result.recentMessages).toHaveLength(49)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('只有 1 条消息时,Memory 返回空(末尾由 MessagePlugin 负责)', async () => {
    vi.mocked(messageRepo.listBySession).mockReturnValue([makeMsg('only', '单条消息')])
    const dbMock = { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })) }
    vi.mocked(getDb).mockReturnValue(dbMock as unknown as ReturnType<typeof getDb>)

    const mem = new ShortTermMemory()
    const result = await mem.getContext('s1', makeConfig(8000))

    expect(result.summaryMessage).toBeNull()
    expect(result.recentMessages).toHaveLength(0)
    expect(result.tokenEstimate).toBe(0)
  })

  it('末尾消息极长不影响压缩阈值判定', async () => {
    // 历史 50 条短消息(< 阈值), 最末一条是超巨型消息。
    // pop 最末后,Memory 判定依然走 Path A 不触发摘要。
    const msgs = [
      ...Array.from({ length: 50 }, (_, i) => makeMsg(`msg-${i}`, '短消息')),
      makeMsg('msg-last-huge', 'X'.repeat(100_000)),
    ]
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
    } as unknown as ReturnType<typeof getDb>)

    const mem = new ShortTermMemory()
    const result = await mem.getContext('s1', makeConfig(8000))

    expect(generateText).not.toHaveBeenCalled() // 不触发摘要
    expect(result.summaryMessage).toBeNull()
    expect(result.recentMessages).toHaveLength(50) // 不含末尾巨型消息
  })

  it('AC-001-02: 超阈值时触发摘要，recent 区 token ≤ recentBudget', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300)),
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    const dbGetMock = vi.fn(() => null)
    const dbRunMock = vi.fn()
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: dbRunMock, get: dbGetMock })),
    } as unknown as ReturnType<typeof getDb>)

    const mem = new ShortTermMemory()
    const result = await mem.getContext('s1', makeConfig(8000))

    expect(result.summaryMessage).not.toBeNull()
    expect(result.summaryMessage!.content).toMatch(/^\[Conversation summary — may be incomplete/)
    expect(result.tokenEstimate).toBeLessThanOrEqual(8000 * 0.15)
    expect(generateText).toHaveBeenCalled()
    expect(dbRunMock).toHaveBeenCalled()
  })

  it('AC-001-03: covered_until 未变时复用摘要，不再调用 LLM', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300)),
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    // pop msg-099,history=msg-000..msg-098(99 条)。
    // recentBudget=400, 每条 ≈75 tokens → 约 5 条进 recent → old = msg-000..msg-093
    const existingSummary = {
      session_id: 's1',
      summary_text: '旧摘要',
      covered_until: 'msg-093',
      token_estimate: 5,
      created_at: '2026-04-25T00:00:00.000Z',
    }
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => existingSummary) })),
    } as unknown as ReturnType<typeof getDb>)

    const mem = new ShortTermMemory()
    const result = await mem.getContext('s1', makeConfig(8000))

    expect(generateText).not.toHaveBeenCalled()
    expect(result.summaryMessage!.content).toContain('旧摘要')
  })

  it('AC-001-04: 增量摘要：输入包含旧摘要 + 新推出消息', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300)),
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    const existingSummary = {
      session_id: 's1',
      summary_text: '旧摘要内容',
      covered_until: 'msg-090',
      token_estimate: 5,
      created_at: '2026-04-25T00:00:00.000Z',
    }
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => existingSummary) })),
    } as unknown as ReturnType<typeof getDb>)

    const mem = new ShortTermMemory()
    await mem.getContext('s1', makeConfig(8000))

    expect(generateText).toHaveBeenCalledTimes(1)
    expect(compressInput()).toContain('旧摘要内容')
  })

  it('emits memory.compressed when a new summary is generated', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300)),
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
    } as unknown as ReturnType<typeof getDb>)

    const bus = new ExecutionEventBus()
    const listener = vi.fn()
    bus.on('memory.compressed', listener)

    const mem = new ShortTermMemory()
    await mem.getContext('s1', makeConfig(8000), { events: bus })

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0]
    expect(event.type).toBe('memory.compressed')
    expect(event.coveredUntilMessageId).toMatch(/^msg-\d+$/)
  })

  it('does NOT emit memory.compressed when reusing cached summary', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300)),
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    // The last-old message ID depends on recent_ratio * context_limit.
    // Pre-populate a summary covering that exact ID so covered_until matches → cache hit.
    const bus = new ExecutionEventBus()
    const listener = vi.fn()
    bus.on('memory.compressed', listener)

    const mem = new ShortTermMemory()
    // Probe once to discover the lastOldMessageId — let it emit, then reset and check cache hit
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
    } as unknown as ReturnType<typeof getDb>)
    await mem.getContext('s1', makeConfig(8000), { events: bus })
    const firstEvent = listener.mock.calls[0]?.[0]
    expect(firstEvent).toBeDefined()
    const coveredUntil = firstEvent.coveredUntilMessageId

    // Now simulate cache hit: DB returns a summary with matching covered_until
    listener.mockClear()
    vi.mocked(generateText).mockClear()
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(() => ({
          session_id: 's1',
          summary_text: '旧摘要',
          covered_until: coveredUntil,
          token_estimate: 5,
          created_at: '2026-04-25T00:00:00.000Z',
        })),
      })),
    } as unknown as ReturnType<typeof getDb>)

    await mem.getContext('s1', makeConfig(8000), { events: bus })

    expect(generateText).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('does NOT emit memory.compressed when summary generation fails', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300)),
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
    } as unknown as ReturnType<typeof getDb>)
    vi.mocked(generateText).mockRejectedValue(new Error('API timeout'))

    const bus = new ExecutionEventBus()
    const listener = vi.fn()
    bus.on('memory.compressed', listener)

    const mem = new ShortTermMemory()
    await mem.getContext('s1', makeConfig(8000), { events: bus })

    expect(listener).not.toHaveBeenCalled()
  })

  it('does not require events param (backward compat)', async () => {
    vi.mocked(messageRepo.listBySession).mockReturnValue([])
    const mem = new ShortTermMemory()
    // omitting the third arg should not throw
    await expect(mem.getContext('s1', makeConfig(8000))).resolves.toBeDefined()
  })

  it('AC-001-06: 摘要生成失败时不阻断请求，但注入 CONTEXT GAP 告警让模型感知缺口', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300)),
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
    } as unknown as ReturnType<typeof getDb>)
    vi.mocked(generateText).mockRejectedValue(new Error('API timeout'))

    const mem = new ShortTermMemory()
    const result = await mem.getContext('s1', makeConfig(8000))
    // Should not throw; recent messages still returned; summaryMessage carries the gap warning
    expect(result.summaryMessage).not.toBeNull()
    expect(result.summaryMessage!.content).toMatch(/^\[CONTEXT GAP WARNING\]/)
    expect(result.summaryMessage!.content).toMatch(/\d+ earlier messages .+ NOT visible/)
    expect(result.recentMessages.length).toBeGreaterThan(0)
  })

  function noSummaryDb() {
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
    } as unknown as ReturnType<typeof getDb>)
  }

  function longSession(n = 100) {
    return Array.from({ length: n }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, `m${i}:` + 'a'.repeat(300)),
    )
  }

  describe('压缩模型', () => {
    it('使用 ProviderContextConfig.modelId(会话实际模型),不是字面量 default', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(longSession())
      noSummaryDb()
      await new ShortTermMemory().getContext('s1', makeConfig(8000, 'ollama/session-model'))
      expect(createModel).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1' }),
        'ollama/session-model',
      )
      expect(createModel).not.toHaveBeenCalledWith(expect.anything(), 'default')
    })

    it('未提供 modelId → 退到 provider.models[0]', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(longSession())
      noSummaryDb()
      await new ShortTermMemory().getContext('s1', makeConfig(8000, null))
      expect(createModel).toHaveBeenCalledWith(expect.anything(), 'ollama/first-model')
    })

    it('generateText 输出带 json 围栏也能解析(不走 gap warning)', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(longSession())
      noSummaryDb()
      vi.mocked(generateText).mockResolvedValue(summaryResult('```json\n' + SUMMARY_JSON + '\n```'))
      const result = await new ShortTermMemory().getContext('s1', makeConfig(8000))
      expect(result.summaryMessage!.content).toContain('User intent: 摘要文本')
    })

    it('输出不是 JSON → 视为压缩失败,返回 CONTEXT GAP 告警', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(longSession())
      noSummaryDb()
      vi.mocked(generateText).mockResolvedValue(summaryResult('sorry, I cannot'))
      const result = await new ShortTermMemory().getContext('s1', makeConfig(8000))
      expect(result.summaryMessage!.content).toMatch(/^\[CONTEXT GAP WARNING\]/)
    })
  })

  describe('固定开销计入压缩阈值', () => {
    // 40 条 × ~76 token ≈ 3000 token history,低于 0.9 × 8000
    const msgs = () => Array.from({ length: 41 }, (_, i) => makeMsg(`f-${i}`, 'a'.repeat(300)))

    it('无固定开销时 history 未超阈值 → Path A(不触发)', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(msgs())
      noSummaryDb()
      const result = await new ShortTermMemory().getContext('s1', makeConfig(8000))
      expect(result.summaryMessage).toBeNull()
      expect(generateText).not.toHaveBeenCalled()
    })

    it('history + 固定开销超过 0.9 × context_limit → 触发压缩', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(msgs())
      noSummaryDb()
      const result = await new ShortTermMemory().getContext('s1', makeConfig(8000), {
        fixedOverheadTokens: 5000,
      })
      expect(generateText).toHaveBeenCalled()
      expect(result.summaryMessage!.content).toMatch(/^\[Conversation summary/)
    })
  })

  describe('增量压缩输入', () => {
    it('已有摘要时只发送 covered_until 之后的消息', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(longSession())
      vi.mocked(getDb).mockReturnValue({
        prepare: vi.fn(() => ({
          run: vi.fn(),
          get: vi.fn(() => ({
            session_id: 's1',
            summary_text: '旧摘要',
            covered_until: 'msg-089',
            token_estimate: 5,
            created_at: '',
          })),
        })),
      } as unknown as ReturnType<typeof getDb>)
      await new ShortTermMemory().getContext('s1', makeConfig(8000))
      const input = compressInput()
      expect(input).toContain('旧摘要')
      expect(input).toContain('m90:')
      expect(input).not.toContain('m89:')
      expect(input).not.toContain('m0:')
    })

    it('covered_until 已不在 history(消息被删)→ 丢弃旧摘要,从头压缩', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(longSession())
      vi.mocked(getDb).mockReturnValue({
        prepare: vi.fn(() => ({
          run: vi.fn(),
          get: vi.fn(() => ({
            session_id: 's1',
            summary_text: '过期摘要',
            covered_until: 'deleted-id',
            token_estimate: 5,
            created_at: '',
          })),
        })),
      } as unknown as ReturnType<typeof getDb>)
      await new ShortTermMemory().getContext('s1', makeConfig(8000))
      expect(compressInput()).not.toContain('过期摘要')
      expect(compressInput()).toContain('m0:')
    })

    it('待压缩内容超过单次输入上限 → 分批折叠,后一批以前一批摘要为输入', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(longSession())
      noSummaryDb()
      // context_limit 8000 → 单次输入上限 4000 token;~94 条 × 77 token 需分两批
      await new ShortTermMemory().getContext('s1', makeConfig(8000))
      expect(vi.mocked(generateText).mock.calls.length).toBe(2)
      expect(compressInput(0)).not.toContain('[Existing summary')
      expect(compressInput(1)).toContain('[Existing summary')
      expect(compressInput(1)).toContain('摘要文本')
    })
  })

  describe('中止', () => {
    it('压缩调用收到合并了请求 abortSignal 的信号', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(longSession())
      noSummaryDb()
      const ctrl = new AbortController()
      await new ShortTermMemory().getContext('s1', makeConfig(8000), { abortSignal: ctrl.signal })
      const signal = vi.mocked(generateText).mock.calls[0][0].abortSignal!
      expect(signal.aborted).toBe(false)
      ctrl.abort()
      expect(signal.aborted).toBe(true)
    })

    it('用户中止导致的失败上抛,不返回 gap 告警', async () => {
      vi.mocked(messageRepo.listBySession).mockReturnValue(longSession())
      noSummaryDb()
      const ctrl = new AbortController()
      vi.mocked(generateText).mockImplementation(async () => {
        ctrl.abort()
        throw new Error('aborted')
      })
      await expect(
        new ShortTermMemory().getContext('s1', makeConfig(8000), { abortSignal: ctrl.signal }),
      ).rejects.toThrow('aborted')
    })
  })
})

describe('findRecentSplit — recent 窗口的 tool 配对', () => {
  it('预算切在 assistant(tool_use) 与 tool 之间 → tool 让给 old,recent 不以 tool 开头', () => {
    const history = [
      makeMsg('u1', 'q'),
      makeToolUse('a1', 'c1', 'x'.repeat(400)),
      makeToolResult('t1', 'c1', 'out'),
      makeMsg('a2', 'done', 'assistant'),
    ]
    const est = history.map((m) => estimateMessage(m))
    // 预算刚好放下 t1 + a2,放不下 a1
    const split = findRecentSplit(history, est, est[2] + est[3])
    expect(history[split].role).not.toBe('tool')
    expect(history.slice(split).map((m) => m.id)).toEqual(['a2'])
  })

  it('预算足以放下整对 → 原样切分(不触发)', () => {
    const history = [makeMsg('u1', 'q'), makeToolUse('a1', 'c1'), makeToolResult('t1', 'c1', 'o')]
    const est = history.map((m) => estimateMessage(m))
    const split = findRecentSplit(history, est, est[1] + est[2])
    expect(history.slice(split).map((m) => m.id)).toEqual(['a1', 't1'])
  })

  it('history 末尾 assistant(tool_use) 超预算也强制保留(其 tool_result 是当前 turn)', () => {
    const history = [makeMsg('u1', 'q'), makeToolUse('a1', 'c1', 'x'.repeat(4000))]
    const est = history.map((m) => estimateMessage(m))
    const split = findRecentSplit(history, est, 10)
    expect(history.slice(split).map((m) => m.id)).toEqual(['a1'])
  })

  it('history 末尾是普通 assistant 且超预算 → 不强制保留(不触发)', () => {
    const history = [makeMsg('u1', 'q'), makeMsg('a1', 'x'.repeat(4000), 'assistant')]
    const est = history.map((m) => estimateMessage(m))
    expect(findRecentSplit(history, est, 10)).toBe(history.length)
  })
})

describe('splitAnchorsAndCompressible', () => {
  it('同一 assistant 后的连续 tool 一并作为锚点,配对完整', () => {
    const old = [
      makeMsg('u1', 'q'),
      makeToolUse('a1', 'c1'),
      makeToolResult('t1', 'c1', 'o1'),
      makeToolResult('t2', 'c1', 'o2'),
    ]
    const { anchors } = splitAnchorsAndCompressible(old, 4)
    expect(anchors.map((m) => m.id)).toEqual(['a1', 't1', 't2'])
  })

  it('找不到 assistant 的 tool 不作锚点', () => {
    const old = [makeToolResult('t0', 'c0', 'o'), makeMsg('u1', 'q')]
    const { anchors, compressible } = splitAnchorsAndCompressible(old, 4)
    expect(anchors).toEqual([])
    expect(compressible).toHaveLength(2)
  })
})

describe('getContext 端到端:Path B 的 recent 不以孤立 tool 开头', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateText).mockResolvedValue(summaryResult())
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
    } as unknown as ReturnType<typeof getDb>)
  })

  it('history 末尾 assistant(tool_use) 超 recent 预算 → 仍在输出末尾,当前 tool_result 可配对', async () => {
    const filler = Array.from({ length: 100 }, (_, i) => makeMsg(`f-${i}`, 'a'.repeat(300)))
    const msgs = [
      ...filler,
      makeToolUse('a-last', 'c9', 'x'.repeat(4000)),
      makeToolResult('t-current', 'c9', 'current result'),
    ]
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)
    const result = await new ShortTermMemory().getContext('s1', makeConfig(8000))
    const last = result.recentMessages[result.recentMessages.length - 1]
    expect(last.role).toBe('assistant')
    expect(JSON.stringify(last.content)).toContain('c9')
    expect(result.recentMessages[0].role).not.toBe('tool')
  })
})
