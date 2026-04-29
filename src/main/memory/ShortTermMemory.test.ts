import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ShortTermMemory } from './ShortTermMemory'
import { ExecutionEventBus } from '../chat/events'
import type { ProviderContextConfig } from '../prompt/types'
import type { ChatMessage } from '../repos/session-repo'

function makeMsg(id: string, text: string, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return {
    id,
    session_id: 'test-session',
    role,
    content: JSON.stringify([{ type: 'text', text }]),
    created_at: `2026-04-25T00:00:00.${id.padStart(3, '0')}Z`,
  }
}

function makeConfig(context_limit: number): ProviderContextConfig {
  return {
    provider: { id: 'p1', type: 'ollama' } as ProviderContextConfig['provider'],
    context_limit,
    recent_ratio: 0.05,
    summary_ratio: 0.10,
  }
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

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: '摘要文本' })),
}))

vi.mock('../providers/llm-provider', () => ({
  createModel: vi.fn(() => ({})),
}))

import { messageRepo } from '../repos/session-repo'
import { getDb } from '../db/index'
import { generateText } from 'ai'

describe('ShortTermMemory.getContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('AC-001-01: 未超阈值时返回全量消息，无摘要', async () => {
    const msgs = Array.from({ length: 50 }, (_, i) => makeMsg(`msg-${i}`, '十个字符xx'))
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    const dbMock = { prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })) }
    vi.mocked(getDb).mockReturnValue(dbMock as unknown as ReturnType<typeof getDb>)

    const mem = new ShortTermMemory()
    const result = await mem.getContext('s1', makeConfig(8000))

    expect(result.summaryMessage).toBeNull()
    expect(result.recentMessages).toHaveLength(50)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('AC-001-02: 超阈值时触发摘要，recent 区 token ≤ recentBudget', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300))
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
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(dbRunMock).toHaveBeenCalled()
  })

  it('AC-001-03: covered_until 未变时复用摘要，不再调用 LLM', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300))
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)

    const existingSummary = {
      session_id: 's1',
      summary_text: '旧摘要',
      covered_until: 'msg-094',
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
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300))
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
    const callArg = vi.mocked(generateText).mock.calls[0][0]
    const userContent = (callArg.messages as Array<{ role: string; content: string }>)
      .find(m => m.role === 'user')!.content
    expect(userContent).toContain('旧摘要内容')
  })

  it('emits memory.compressed when a new summary is generated', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300))
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
    } as unknown as ReturnType<typeof getDb>)

    const bus = new ExecutionEventBus()
    const listener = vi.fn()
    bus.on('memory.compressed', listener)

    const mem = new ShortTermMemory()
    await mem.getContext('s1', makeConfig(8000), bus)

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0]
    expect(event.type).toBe('memory.compressed')
    expect(event.coveredUntilMessageId).toMatch(/^msg-\d+$/)
  })

  it('does NOT emit memory.compressed when reusing cached summary', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300))
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
    await mem.getContext('s1', makeConfig(8000), bus)
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

    await mem.getContext('s1', makeConfig(8000), bus)

    expect(generateText).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('does NOT emit memory.compressed when summary generation fails', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300))
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
    await mem.getContext('s1', makeConfig(8000), bus)

    expect(listener).not.toHaveBeenCalled()
  })

  it('does not require events param (backward compat)', async () => {
    vi.mocked(messageRepo.listBySession).mockReturnValue([])
    const mem = new ShortTermMemory()
    // omitting the third arg should not throw
    await expect(mem.getContext('s1', makeConfig(8000))).resolves.toBeDefined()
  })

  it('AC-001-06: 摘要生成失败时不阻断请求，回退到 recent-only', async () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      makeMsg(`msg-${String(i).padStart(3, '0')}`, 'a'.repeat(300))
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(msgs)
    vi.mocked(getDb).mockReturnValue({
      prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(() => null) })),
    } as unknown as ReturnType<typeof getDb>)
    vi.mocked(generateText).mockRejectedValue(new Error('API timeout'))

    const mem = new ShortTermMemory()
    const result = await mem.getContext('s1', makeConfig(8000))
    // Should not throw; falls back to recent messages without a summary
    expect(result.summaryMessage).toBeNull()
    expect(result.recentMessages.length).toBeGreaterThan(0)
  })
})
