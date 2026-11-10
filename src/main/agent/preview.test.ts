// src/main/agent/preview.test.ts — Schema 2.0 tests
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { previewAgent } from './preview'
import type { ToolDefinition } from '../tools/types'
import { catalogSnapshot } from '../runtime/catalog'

const tool = (name: string): ToolDefinition => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ output: '' }),
})

const BUILTINS = ['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls'].map(tool)

const snapshot = catalogSnapshot({
  builtins: () => BUILTINS,
  mcpServers: () => [],
  skills: () => [],
  agents: () => [
    {
      profile: { id: 'feat', name: 'f', description: 'f', agentPrompt: 'p', tools: ['read'] },
      featureTools: [tool('invest_quote')],
    },
  ],
})

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

describe('previewAgent', () => {
  it('AC-003 shows the agentPrompt and the builtin tools the catalog selects', async () => {
    const r = await previewAgent(REVIEWER, { snapshot })

    expect(r.renderedPrompt.persistent).toBe(REVIEWER.agentPrompt)
    expect(r.renderedPrompt.onDemandSamples).toEqual({
      firstIteration: REVIEWER.agentPrompt,
      midIteration: REVIEWER.agentPrompt,
      lastIteration: REVIEWER.agentPrompt,
    })
    // tools: ['read'] 加上总可用的只读工具
    expect(r.enabledTools.map((t) => [t.name, t.source])).toEqual(
      ['read', 'glob', 'grep', 'ls'].map((n) => [n, 'builtin']),
    )
    expect(r.estimates).toEqual({
      promptTokens: Math.ceil(REVIEWER.agentPrompt.length / 3),
      toolsCount: 4,
    })
    expect(r.validatorIssues.filter((i) => i.severity === 'error')).toHaveLength(0)
  })

  it('AC-003 lists all builtins when tools is omitted and adds the feature tools', async () => {
    const all = await previewAgent({ ...REVIEWER, tools: undefined }, { snapshot })
    expect(all.enabledTools.map((t) => t.name)).toEqual(BUILTINS.map((t) => t.name))
    const feat = await previewAgent(
      { id: 'feat', name: 'f', description: 'f', agentPrompt: 'p', tools: ['read'] },
      { snapshot },
    )
    expect(feat.enabledTools.map((t) => t.name)).toEqual([
      'read',
      'glob',
      'grep',
      'ls',
      'invest_quote',
    ])
  })

  it('invalid profile returns errors but still renders best-effort', async () => {
    const broken = { ...REVIEWER, id: 'Bad Id!' }
    const r = await previewAgent(broken, { snapshot })
    expect(r.validatorIssues.length).toBeGreaterThan(0)
    expect(r.validatorIssues.some((i) => i.rule === 3)).toBe(true)
    expect(r.renderedPrompt.persistent).toBe(REVIEWER.agentPrompt)
  })

  it('profile without an id renders no tools', async () => {
    const r = await previewAgent({ agentPrompt: 'x' }, { snapshot })
    expect(r.enabledTools).toEqual([])
    expect(r.validatorIssues.length).toBeGreaterThan(0)
  })
})
