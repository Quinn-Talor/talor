// src/main/agent/preview.test.ts — Schema 2.0 tests
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
  id: 'reviewer',
  name: 'Reviewer',
  description: `Reviews pull requests against team coding standards.

会做：分析 diff、引用规则编号、分级 blocker/major/minor/nit。
不会做：修改源代码、执行代码、评审超过 2000 行的超大 diff。`,
  agentPrompt: `## Required Inputs
- **pr_url** (text, REQUIRED): Pull request URL or raw diff to review.

## Workflow
1. Load standards reference via read tool.
2. Analyze diff hunk-by-hunk.
3. Emit review report as JSON.

## Principles
- Every blocker MUST cite a section from standards.
- Do not execute the code under review.

## Output
JSON with summary + findings array.`,
  tools: ['read'],
  references: [{ id: 'standards', path: './standards.md', description: 'Coding standards' }],
}

describe('previewAgent (v2.0)', () => {
  it('returns PreviewResult for valid business profile', async () => {
    const r = await previewAgent(REVIEWER, { builtinRegistry: builtin, mcpRegistry: null })

    // renderedPrompt contains agent name
    expect(r.renderedPrompt.persistent).toBeTruthy()
    expect(r.renderedPrompt.onDemandSamples.firstIteration).toBeDefined()
    expect(r.renderedPrompt.onDemandSamples.midIteration).toBeDefined()
    expect(r.renderedPrompt.onDemandSamples.lastIteration).toBeDefined()

    // enabledTools
    expect(r.enabledTools.find((t) => t.name === 'read')).toBeDefined()

    // estimates
    expect(r.estimates.promptTokens).toBeGreaterThan(0)
    expect(r.estimates.toolsCount).toBeGreaterThan(0)

    // validatorIssues empty for valid profile (warnings ok)
    expect(r.validatorIssues.filter((i) => i.severity === 'error')).toHaveLength(0)
  })

  it('invalid profile returns errors but still renders best-effort', async () => {
    const broken = { ...REVIEWER, id: 'Bad Id!' }
    const r = await previewAgent(broken, { builtinRegistry: builtin, mcpRegistry: null })
    expect(r.validatorIssues.length).toBeGreaterThan(0)
    expect(r.validatorIssues.some((i) => i.rule === 3)).toBe(true)
  })
})
