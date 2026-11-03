// 跨轮摘要（C3 AC-008）：getContextRows 与旧的 ShortTermMemory.getContext 在各组历史上结果一致。
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../repos/session-repo', () => ({
  messageRepo: { listBySession: vi.fn() },
}))
vi.mock('../db/index', () => ({ getDb: vi.fn() }))
vi.mock('ai', () => ({ generateText: vi.fn() }))
const { createModel } = vi.hoisted(() => ({ createModel: vi.fn(() => ({})) }))
vi.mock('../providers/model-adapter', () => ({
  getAdapter: () => ({ createModel }),
}))
vi.mock('../providers/usage-recorder', () => ({ recordUsage: vi.fn() }))

import { generateText } from 'ai'
import { getDb } from '../db/index'
import { messageRepo, type ChatMessage } from '../repos/session-repo'
import { ShortTermMemory } from '../memory/ShortTermMemory'
import { messagesToCoreMessages } from '../memory/types'
import type { ProviderContextConfig } from './context-config'
import { SessionSummaryMemory } from './session-summary'

const msg = (i: number, text = 'a'.repeat(300)): ChatMessage => ({
  id: `msg-${String(i).padStart(3, '0')}`,
  session_id: 's1',
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: JSON.stringify([{ type: 'text', text }]),
  agent_id: '__chat__',
  created_at: '2026-04-25T00:00:00.000Z',
})

const config: ProviderContextConfig = {
  provider: {
    id: 'p1',
    type: 'ollama',
    models: [{ id: 'm' }],
  } as ProviderContextConfig['provider'],
  modelId: 'm',
  context_limit: 8000,
  recent_ratio: 0.05,
  summary_ratio: 0.1,
}

const SUMMARY_JSON = JSON.stringify({
  user_intent: '整理日志',
  key_facts: [],
  pending_actions: [],
  resolved_issues: [],
  current_blocker: null,
})

function db(existing: unknown = null) {
  const run = vi.fn()
  vi.mocked(getDb).mockReturnValue({
    prepare: vi.fn(() => ({ run, get: vi.fn(() => existing) })),
  } as unknown as ReturnType<typeof getDb>)
  return run
}

async function compare(core: SessionSummaryMemory, legacy: ShortTermMemory) {
  const rows = await core.getContextRows('s1', config)
  const old = await legacy.getContext('s1', config)
  expect(rows.summary).toEqual(old.summaryMessage?.content ?? null)
  expect(messagesToCoreMessages(rows.rows)).toEqual(old.recentMessages)
  expect(rows.tokenEstimate).toBe(old.tokenEstimate)
  return rows
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(generateText).mockResolvedValue({
    text: SUMMARY_JSON,
    usage: {},
  } as unknown as Awaited<ReturnType<typeof generateText>>)
  db()
})

describe('SessionSummaryMemory.getContextRows', () => {
  it('AC-008 matches the legacy context for empty, small, compressed and reused histories', async () => {
    const core = new SessionSummaryMemory()
    const legacy = new ShortTermMemory()

    vi.mocked(messageRepo.listBySession).mockReturnValue([])
    expect(await compare(core, legacy)).toEqual({ summary: null, rows: [], tokenEstimate: 0 })

    vi.mocked(messageRepo.listBySession).mockReturnValue([msg(0)])
    expect((await compare(core, legacy)).rows).toEqual([])

    const small = Array.from({ length: 5 }, (_, i) => msg(i, 'short'))
    vi.mocked(messageRepo.listBySession).mockReturnValue(small)
    const below = await compare(core, legacy)
    expect(below.summary).toBeNull()
    expect(below.rows).toEqual(small.slice(0, -1))

    const long = Array.from({ length: 100 }, (_, i) => msg(i))
    vi.mocked(messageRepo.listBySession).mockReturnValue(long)
    const compressed = await compare(core, legacy)
    expect(compressed.summary).toContain('Conversation summary')
    expect(compressed.summary).toContain('整理日志')

    db({
      session_id: 's1',
      summary_text: '旧摘要',
      covered_until: 'msg-093',
      token_estimate: 5,
      created_at: '2026-04-25T00:00:00.000Z',
    })
    vi.mocked(generateText).mockClear()
    const reused = await compare(core, legacy)
    expect(generateText).not.toHaveBeenCalled()
    expect(reused.summary).toContain('旧摘要')
  })

  it('SESS-5 gives the summary model the plain-text user messages', async () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      i === 0
        ? { ...msg(0), content: JSON.stringify('请记住：本次评审的口令是 青鸟-7342') }
        : i % 2 === 0
          ? { ...msg(i), content: JSON.stringify(`第${i}份材料 ${'b'.repeat(300)}`) }
          : msg(i),
    )
    vi.mocked(messageRepo.listBySession).mockReturnValue(rows)
    await new SessionSummaryMemory().getContextRows('s1', config)
    const prompts = vi
      .mocked(generateText)
      .mock.calls.map((c) => JSON.stringify((c[0] as { messages: unknown }).messages))
    expect(prompts.join('\n')).toContain('user: 请记住：本次评审的口令是 青鸟-7342')
    expect(prompts.join('\n')).toContain('user: 第2份材料')
  })

  it('AC-008 returns the context gap text while compression fails and cools down', async () => {
    const core = new SessionSummaryMemory()
    const legacy = new ShortTermMemory()
    vi.mocked(messageRepo.listBySession).mockReturnValue(
      Array.from({ length: 100 }, (_, i) => msg(i)),
    )
    vi.mocked(generateText).mockRejectedValue(new Error('API timeout'))
    for (let i = 0; i < 4; i++) {
      const r = await compare(core, legacy)
      expect(r.summary).toMatch(/^\[CONTEXT GAP WARNING\]/)
    }
    // 第 4 次处于冷却：两边都不再调用模型（各 3 次）
    expect(generateText).toHaveBeenCalledTimes(6)
    expect((await core.getContextRows('s1', config)).summary).toContain('on cooldown')
  })

  it('AC-008 reports the covered message of a new summary through onCompressed', async () => {
    vi.mocked(messageRepo.listBySession).mockReturnValue(
      Array.from({ length: 100 }, (_, i) => msg(i)),
    )
    const run = db()
    const onCompressed = vi.fn()
    await new SessionSummaryMemory().getContextRows('s1', config, { onCompressed })
    expect(onCompressed).toHaveBeenCalledTimes(1)
    const covered = onCompressed.mock.calls[0]![0] as string
    expect(run).toHaveBeenCalledWith(
      's1',
      expect.any(String),
      covered,
      expect.any(Number),
      expect.any(String),
    )
  })
})
