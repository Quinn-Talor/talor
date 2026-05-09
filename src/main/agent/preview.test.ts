// src/main/agent/preview.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { previewAgent } from './preview'
import { BuiltinToolRegistry } from './builtin-registry'
import type { ToolDefinition } from '../tools/types'

const builtin = new BuiltinToolRegistry([
  {
    name: 'read',
    description: 'r',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ output: '' }),
  } as ToolDefinition,
])

const REVIEWER = {
  schemaVersion: '1.0',
  identity: { id: 'reviewer', name: 'Reviewer', description: 'Reviews PRs', version: '1.0.0' },
  mission: {
    objective: 'Produce review',
    outcomes: [
      {
        id: 'review_done',
        description: 'Review report ready for user',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'review_report',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
    inputs: [
      {
        id: 'pr_url',
        description: 'PR URL',
        type: 'text',
        required: true,
        examples: ['https://x/pr/1'],
      },
    ],
  },
  method: {
    capabilities: ['Generate review report from a diff'],
    tools: [
      { name: 'read', required: true },
      { name: 'bash', disabled: true },
    ],
    workflow: {
      steps: [
        { id: 'load', description: 'Load standards', inputs: ['user-input'], produces: 'ctx' },
        {
          id: 'analyze',
          description: 'Analyze diff',
          inputs: ['ctx'],
          produces: 'review_report',
          requires: ['load'],
        },
      ],
    },
  },
  delivery: {
    deliverables: [
      {
        id: 'review_report',
        format: 'json',
        schema: {
          type: 'object',
          required: ['summary'],
          properties: { summary: { type: 'string' } },
        },
        rubric: ['✓ cite line'],
      },
    ],
    acceptance: [
      {
        type: 'deliverable-present',
        deliverableId: 'review_report',
        kind: 'deterministic',
        severity: 'must',
      },
      { type: 'tool-not-used', toolName: 'write', kind: 'deterministic', severity: 'must' },
      { type: 'verifier-tool', toolName: 'check', kind: 'deterministic', severity: 'should' },
    ],
  },
  execution: {
    limits: { maxSteps: 30, maxTokens: 200000 },
    retryPolicy: { maxAttempts: 2, onMustFail: 'retry-then-mark', onShouldFail: 'mark-only' },
  },
}

describe('previewAgent (AC-082)', () => {
  it('returns full PreviewResult for valid business profile', async () => {
    const r = await previewAgent(REVIEWER, { builtinRegistry: builtin, mcpRegistry: null })

    // renderedPrompt
    expect(r.renderedPrompt.persistent).toContain('# Identity')
    expect(r.renderedPrompt.persistent).toContain('Reviewer')
    expect(r.renderedPrompt.onDemandSamples.firstIteration).toContain('# Mission')
    expect(r.renderedPrompt.onDemandSamples.midIteration).toBeDefined()
    expect(r.renderedPrompt.onDemandSamples.lastIteration).toBeDefined()

    // enabledTools / disabledTools
    expect(r.enabledTools.find((t) => t.name === 'read')).toBeDefined()
    expect(r.disabledTools).toContain('bash')

    // resolvedAcceptance includes must + should
    expect(r.resolvedAcceptance.length).toBe(3)

    // visualizations
    expect(r.visualizations.workflowDag).toBeDefined()
    expect(r.visualizations.workflowDag!.edges).toHaveLength(1) // load → analyze
    expect(r.visualizations.outcomeTree).toHaveLength(1)
    expect(r.visualizations.acceptanceList.must.length).toBeGreaterThanOrEqual(2)
    expect(r.visualizations.acceptanceList.should).toHaveLength(1)
    expect(r.visualizations.acceptanceList.must[0].naturalized).toBeTruthy()

    // estimates
    expect(r.estimates.promptTokens).toBeGreaterThan(0)
    expect(r.estimates.toolsCount).toBeGreaterThan(0)
    expect(r.estimates.knowledgeFilesCount).toBe(0)
    expect(r.estimates.knowledgeTokenEstimate).toBe(0)

    // validatorIssues empty for valid profile (warnings ok)
    expect(r.validatorIssues.filter((i) => i.severity === 'error')).toHaveLength(0)
  })

  it('AC-080/081: invalid profile returns errors but still renders best-effort', async () => {
    const broken = { ...REVIEWER, schemaVersion: '0.5' }
    const r = await previewAgent(broken, { builtinRegistry: builtin, mcpRegistry: null })
    expect(r.validatorIssues.length).toBeGreaterThan(0)
    expect(r.validatorIssues.some((i) => i.rule === 1)).toBe(true)
  })
})
