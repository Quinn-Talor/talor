import { describe, it, expect, vi } from 'vitest'

const { getContextRows } = vi.hoisted(() => ({ getContextRows: vi.fn() }))
vi.mock('../history/session-summary', () => ({
  SessionSummaryMemory: class {
    getContextRows = getContextRows
  },
}))

import type { ChatMessage } from '../repos/session-repo'
import type { ProviderContextConfig } from '../history/context-config'
import { historyFor } from './history-policy'
import { historyOf } from './task'

const row = (id: string, role: 'user' | 'assistant', text: string): ChatMessage => ({
  id,
  session_id: 's1',
  role,
  content: JSON.stringify([{ type: 'text', text }]),
  agent_id: '__chat__',
  created_at: '2026-10-31T00:00:00.000Z',
})

const config = { context_limit: 128000 } as ProviderContextConfig

describe('historyFor', () => {
  it('AC-010 puts the summary first as a system message and converts the rows', async () => {
    const rows = [row('a', 'user', '甲'), row('b', 'assistant', '乙')]
    const signal = new AbortController().signal
    getContextRows.mockResolvedValueOnce({ summary: 'S', rows, tokenEstimate: 3 })
    expect(await historyFor({ sessionId: 's1', config, signal })).toEqual([
      { role: 'system', content: 'S' },
      ...historyOf(rows),
    ])
    expect(getContextRows).toHaveBeenCalledWith('s1', config, { abortSignal: signal })

    getContextRows.mockResolvedValueOnce({ summary: null, rows, tokenEstimate: 3 })
    expect(await historyFor({ sessionId: 's1', config, signal })).toEqual(historyOf(rows))
  })
})
