// src/main/agent/dry-runner.test.ts — Schema 2.0 dry-runner tests
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { dryRunAgent } from './dry-runner'

const VALID_PROFILE_V2 = {
  schemaVersion: '2.0',
  id: 'code_reviewer',
  name: 'Code Reviewer',
  description: 'Reviews code against team standards.',
  version: '1.0.0',
  agentPrompt: '# Identity\nYou are a code reviewer.\n\n## Responsibilities\n- Review PRs.',
}

describe('dryRunAgent (Schema 2.0)', () => {
  it('invalid profile: aborts with validatorIssues', async () => {
    const r = await dryRunAgent({ profile: { schemaVersion: '0.5' }, userMessage: '' })
    expect(r.validatorIssues.length).toBeGreaterThan(0)
    expect(r.iterations).toEqual([])
    expect(r.notes[0]).toMatch(/validation failed/)
  })

  it('invalid profile missing required fields: validatorIssues populated', async () => {
    const r = await dryRunAgent({ profile: { schemaVersion: '2.0' }, userMessage: 'go' })
    expect(r.validatorIssues.length).toBeGreaterThan(0)
    expect(r.iterations).toEqual([])
  })

  it('valid profile: stub=true, one iteration', async () => {
    const r = await dryRunAgent({ profile: VALID_PROFILE_V2, userMessage: 'review PR' })
    expect(r.stub).toBe(true)
    expect(r.iterations).toHaveLength(1)
  })

  it('valid profile: rendered prompt contains agentPrompt content', async () => {
    const r = await dryRunAgent({ profile: VALID_PROFILE_V2, userMessage: 'go' })
    expect(r.iterations[0].promptSent).toContain('# Identity')
  })

  it('valid profile: resourceUsage reflects one iteration', async () => {
    const r = await dryRunAgent({ profile: VALID_PROFILE_V2, userMessage: 'go' })
    expect(r.resourceUsage.iterations).toBe(1)
    expect(r.resourceUsage.promptTokensEstimate).toBeGreaterThan(0)
  })

  it('finalTextOverride appears in finalText and iteration stub', async () => {
    const r = await dryRunAgent({
      profile: VALID_PROFILE_V2,
      userMessage: 'go',
      finalTextOverride: 'custom output',
    })
    expect(r.finalText).toBe('custom output')
    expect(r.iterations[0].llmResponseStub).toBe('custom output')
  })

  it('toolEventsOverride appears in toolCallsStub', async () => {
    const r = await dryRunAgent({
      profile: VALID_PROFILE_V2,
      userMessage: 'go',
      toolEventsOverride: [{ toolName: 'read', input: { path: 'foo.md' } }],
    })
    expect(r.iterations[0].toolCallsStub).toHaveLength(1)
    expect(r.iterations[0].toolCallsStub[0].tool).toBe('read')
  })

  it('no acceptance / extractedDeliverables fields on result', async () => {
    const r = await dryRunAgent({ profile: VALID_PROFILE_V2, userMessage: 'go' })
    expect('acceptance' in r).toBe(false)
    expect('extractedDeliverables' in r).toBe(false)
  })

  it('notes mention Schema 2.0', async () => {
    const r = await dryRunAgent({ profile: VALID_PROFILE_V2, userMessage: 'go' })
    expect(r.notes.some((n) => n.includes('2.0'))).toBe(true)
  })
})
