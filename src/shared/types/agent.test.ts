import { describe, it, expect } from 'vitest'
import type { AgentProfile } from './agent'
import { SCHEMA_VERSION, BUILTIN_TOOL_NAMES } from './agent'

describe('AgentProfile (v2.0) type smoke', () => {
  it('exports SCHEMA_VERSION = "2.0"', () => {
    expect(SCHEMA_VERSION).toBe('2.0')
  })
  it('BUILTIN_TOOL_NAMES has 7 entries', () => {
    expect(BUILTIN_TOOL_NAMES).toHaveLength(7)
  })
  it('AgentProfile literal compiles', () => {
    const p: AgentProfile = {
      schemaVersion: '2.0',
      id: 'a',
      name: 'A',
      description: 'x',
      version: '1.0.0',
      agentPrompt: '## Output\nText.',
    }
    expect(p.id).toBe('a')
  })
})
