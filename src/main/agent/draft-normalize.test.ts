import { describe, it, expect } from 'vitest'
import { normalizeDraftSubagents } from './draft-normalize'
import type { AgentProfile } from '@shared/types/agent'

const base = { id: 'a', name: 'A', description: 'd', agentPrompt: 'p' } as AgentProfile

describe('normalizeDraftSubagents', () => {
  it('turns string ids into {id, required: true} refs', () => {
    const out = normalizeDraftSubagents({
      ...base,
      subagents: { ids: ['translator', { id: 'x', required: false }] as never },
    })
    expect(out.subagents?.ids).toEqual([
      { id: 'translator', required: true },
      { id: 'x', required: false },
    ])
  })

  it('returns well-formed profiles unchanged', () => {
    const p = { ...base, subagents: { ids: [{ id: 'x', required: true }] } }
    expect(normalizeDraftSubagents(p)).toBe(p)
    expect(normalizeDraftSubagents(base)).toBe(base)
  })
})
