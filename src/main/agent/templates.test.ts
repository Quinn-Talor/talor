// src/main/agent/templates.test.ts — Schema 2.0 built-in templates validation
import { describe, it, expect } from 'vitest'
import { listTemplates } from './templates'
import { validateProfile } from './validator'

describe('listTemplates (v2.0)', () => {
  it('returns at least 2 templates', () => {
    const templates = listTemplates()
    expect(templates.length).toBeGreaterThanOrEqual(2)
  })

  it('each template profile is schema-valid v2.0', () => {
    const templates = listTemplates()
    for (const t of templates) {
      const result = validateProfile(t.profile)
      const errors = result.valid ? [] : result.errors
      expect(errors, `template ${t.id} has errors: ${JSON.stringify(errors)}`).toEqual([])
      expect(t.profile.schemaVersion).toBe('2.0')
    }
  })

  it('listTemplates returns deep copies (mutation isolation)', () => {
    const [a, b] = [listTemplates()[0], listTemplates()[0]]
    a.profile.name = 'mutated'
    expect(b.profile.name).not.toBe('mutated')
  })

  it('code_reviewer template has expected structure', () => {
    const templates = listTemplates()
    const reviewer = templates.find((t) => t.id === 'code_reviewer')
    expect(reviewer).toBeDefined()
    expect(reviewer!.profile.tools).toContain('read')
    expect(reviewer!.profile.agentPrompt).toContain('## Workflow')
    expect(reviewer!.profile.agentPrompt).toContain('## Principles')
  })
})
