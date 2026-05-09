// src/main/agent/dry-runner.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { dryRunAgent } from './dry-runner'
import { listTemplates } from './templates'

describe('listTemplates (AC-085)', () => {
  it('returns at least 2 templates', () => {
    const list = listTemplates()
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(list.find((t) => t.id === 'code_reviewer')).toBeDefined()
    expect(list.find((t) => t.id === 'weekly_reporter')).toBeDefined()
  })

  it('each template profile is schema 1.0 valid', async () => {
    const { validateProfile } = await import('./validator')
    const list = listTemplates()
    for (const t of list) {
      const r = validateProfile(t.profile)
      if (!r.valid) {
        console.error(`Template ${t.id} invalid:`, r.errors)
      }
      expect(r.valid).toBe(true)
    }
  })

  it('list returns deep copies (mutation isolated)', () => {
    const a = listTemplates()
    const b = listTemplates()
    a[0].profile.identity.name = 'mutated'
    expect(b[0].profile.identity.name).not.toBe('mutated')
  })
})

describe('dryRunAgent (AC-083, AC-084)', () => {
  it('AC-084: sandbox limits cap maxSteps and maxTokens', async () => {
    const tpl = listTemplates()[0]
    const r = await dryRunAgent({ profile: tpl.profile, userMessage: 'review PR https://x/pr/1' })
    expect(r.resourceUsage.sandboxApplied.maxSteps).toBe(10)
    expect(r.resourceUsage.sandboxApplied.maxTokens).toBe(20000)
  })

  it('AC-083: returns DryRunResult shape', async () => {
    const tpl = listTemplates()[0]
    const r = await dryRunAgent({ profile: tpl.profile, userMessage: 'go' })
    expect(r.iterations.length).toBeGreaterThanOrEqual(1)
    expect(r.iterations[0].promptSent).toContain('# Identity')
    expect(r.acceptance).toBeDefined()
    expect(r.acceptance.must).toBeDefined()
    expect(r.acceptance.should).toBeDefined()
    expect(r.stub).toBe(true)
  })

  it('invalid profile: aborts with validatorIssues', async () => {
    const r = await dryRunAgent({ profile: { schemaVersion: '0.5' }, userMessage: '' })
    expect(r.validatorIssues.length).toBeGreaterThan(0)
    expect(r.iterations).toEqual([])
    expect(r.notes[0]).toMatch(/validation failed/)
  })

  it('finalTextOverride drives acceptance: matching JSON passes deliverable-present', async () => {
    const tpl = listTemplates()[0]
    const r = await dryRunAgent({
      profile: tpl.profile,
      userMessage: 'go',
      finalTextOverride: '```json\n{"summary":"all good","findings":[]}\n```',
      toolEventsOverride: [{ toolName: 'read', input: { path: 'standards.md' } }],
    })
    // must items: deliverable-present (passes), tool-was-used:read (passes), tool-not-used:write (passes), tool-not-used:edit (passes)
    const failingMust = r.acceptance.must.filter((m) => !m.passed)
    expect(failingMust).toHaveLength(0)
    expect(r.acceptance.overallPassed).toBe(true)
    expect(r.extractedDeliverables.review_report).toBeDefined()
  })

  it('finalTextOverride without JSON → deliverable-present fails', async () => {
    const tpl = listTemplates()[0]
    const r = await dryRunAgent({
      profile: tpl.profile,
      userMessage: 'go',
      finalTextOverride: 'no json here',
    })
    expect(r.acceptance.overallPassed).toBe(false)
    const f = r.acceptance.must.find((m) => !m.passed)
    expect(f?.reason).toBeTruthy()
  })

  it('tool-not-used: triggers fail when write is in events', async () => {
    const tpl = listTemplates()[0]
    const r = await dryRunAgent({
      profile: tpl.profile,
      userMessage: 'go',
      finalTextOverride: '```json\n{"summary":"x","findings":[]}\n```',
      toolEventsOverride: [
        { toolName: 'read', input: { path: 'standards.md' } },
        { toolName: 'write', input: { path: 'evil.txt' } },
      ],
    })
    const writeFailure = r.acceptance.must.find(
      (m) => 'toolName' in m.criterion && m.criterion.toolName === 'write' && !m.passed,
    )
    expect(writeFailure).toBeDefined()
    expect(r.acceptance.overallPassed).toBe(false)
  })
})
