// src/main/prompt/runtime-context.test.ts — Schema 2.0 runtime-context tests
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { SkillRegistry } from '../skills/registry'
import { buildRuntimeContext } from './runtime-context'
import type { AgentProfile, ReferenceFile } from '@shared/types/agent'

// ── Minimal Agent stub (agent.ts constructor still uses 1.0 paths; Phase 3 fixes it).
// buildRuntimeContext only reads: profile.{name,description,agentPrompt,id,references} + skillRegistry.
function makeAgentStub(
  profile: AgentProfile,
  skillRegistry: SkillRegistry = SkillRegistry.fromDir(null),
) {
  return { profile, skillRegistry } as import('../agent/agent').Agent
}

const PLATFORM_PROFILE: AgentProfile = {
  schemaVersion: '2.0',
  id: '__chat__',
  name: 'Talor',
  description: 'Your AI assistant.',
  version: '2.0.0',
  agentPrompt: 'Help the user with any task.',
}

const BUSINESS_PROFILE: AgentProfile = {
  schemaVersion: '2.0',
  id: 'reviewer',
  name: 'Code Reviewer',
  description: 'Reviews pull requests.',
  version: '1.0.0',
  agentPrompt: '## Required Inputs\n- pr_url: PR URL\n\n## Workflow\n1. Read rules\n2. Review PR',
  references: [
    { id: 'eng_rules', path: 'references/rules.md', description: 'Engineering standards' },
    { id: 'glossary', path: 'references/glossary.md', description: 'Team glossary' },
  ],
}

describe('buildRuntimeContext', () => {
  it('name passes through verbatim', () => {
    const agent = makeAgentStub(PLATFORM_PROFILE)
    const ctx = buildRuntimeContext(agent)
    expect(ctx.name).toBe('Talor')
  })

  it('description passes through verbatim', () => {
    const agent = makeAgentStub(PLATFORM_PROFILE)
    const ctx = buildRuntimeContext(agent)
    expect(ctx.description).toBe('Your AI assistant.')
  })

  it('agentPrompt passes through verbatim', () => {
    const agent = makeAgentStub(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent)
    expect(ctx.agentPrompt).toBe(BUSINESS_PROFILE.agentPrompt)
  })

  it('hasReferences false when profile has no references', () => {
    const agent = makeAgentStub(PLATFORM_PROFILE)
    const ctx = buildRuntimeContext(agent)
    expect(ctx.hasReferences).toBe(false)
    expect(ctx.references).toHaveLength(0)
  })

  it('hasReferences true when profile has references', () => {
    const agent = makeAgentStub(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent)
    expect(ctx.hasReferences).toBe(true)
    expect(ctx.references).toHaveLength(2)
  })

  it('references preserve id / path / description', () => {
    const agent = makeAgentStub(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent)
    const ref = ctx.references[0] as ReferenceFile
    expect(ref.id).toBe('eng_rules')
    expect(ref.path).toBe('references/rules.md')
    expect(ref.description).toBe('Engineering standards')
  })

  it('criticalRoleConstraints set only for __chat__', () => {
    const chatAgent = makeAgentStub(PLATFORM_PROFILE)
    const chatCtx = buildRuntimeContext(chatAgent)
    expect(chatCtx.criticalRoleConstraints.length).toBeGreaterThan(0)
    expect(chatCtx.criticalRoleConstraints.join(' ')).toMatch(/delegate/i)
  })

  it('criticalRoleConstraints empty for non-__chat__ agents', () => {
    const agent = makeAgentStub(BUSINESS_PROFILE)
    const ctx = buildRuntimeContext(agent)
    expect(ctx.criticalRoleConstraints).toHaveLength(0)
  })

  it('hasSkillListing false when registry is empty', () => {
    const agent = makeAgentStub(PLATFORM_PROFILE, SkillRegistry.fromDir(null))
    const ctx = buildRuntimeContext(agent)
    expect(ctx.hasSkillListing).toBe(false)
    expect(ctx.skillListing).toBe('')
  })
})
