import { describe, it, expect } from 'vitest'
import type { ChatMessage } from '../repos/session-repo'
import { attachLiveFold, beginLiveTurn, endLiveTurn, liveRows } from './live-turns'
import type { TurnFold } from './turn-rows'

const row = (id: string, role: ChatMessage['role']): ChatMessage => ({
  id,
  session_id: 's1',
  role,
  content: '"x"',
  agent_id: 'a',
  created_at: '2026-11-04T00:00:00.000Z',
  trace_id: 'r1',
})

const foldWith = (rows: ChatMessage[]) => ({ rows: () => rows }) as unknown as TurnFold

describe('live turns', () => {
  it('AC-006 shows the registered user row until the fold has its own, then the folded rows', () => {
    beginLiveTurn('s1', { runId: 'r1', userRow: row('r1:u', 'user') })
    expect(liveRows('s1').map((r) => r.id)).toEqual(['r1:u'])

    const folded: ChatMessage[] = []
    attachLiveFold('s1', 'r1', foldWith(folded))
    expect(liveRows('s1').map((r) => r.id)).toEqual(['r1:u'])

    folded.push(row('r1:u', 'user'), row('r1:s1:a', 'assistant'))
    expect(liveRows('s1').map((r) => r.id)).toEqual(['r1:u', 'r1:s1:a'])

    endLiveTurn('s1', 'r1')
    expect(liveRows('s1')).toEqual([])
  })

  it('ignores a fold or an end for another run of the session', () => {
    beginLiveTurn('s2', { runId: 'new', userRow: row('new:u', 'user') })
    attachLiveFold('s2', 'old', foldWith([row('old:s1:a', 'assistant')]))
    endLiveTurn('s2', 'old')
    expect(liveRows('s2').map((r) => r.id)).toEqual(['new:u'])
    endLiveTurn('s2', 'new')
    expect(liveRows('s2')).toEqual([])
  })
})
