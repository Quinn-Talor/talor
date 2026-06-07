import { describe, it, expect } from 'vitest'
import type { AgentProfile } from './agent'
import { BUILTIN_TOOL_NAMES } from './agent'

describe('AgentProfile (极简 schema) type smoke', () => {
  it('BUILTIN_TOOL_NAMES has 7 entries', () => {
    expect(BUILTIN_TOOL_NAMES).toHaveLength(7)
  })
  it('AgentProfile literal compiles', () => {
    const p: AgentProfile = {
      id: 'a',
      name: 'A',
      description: 'x',
      agentPrompt: '## Output\nText.',
    }
    expect(p.id).toBe('a')
  })
})
