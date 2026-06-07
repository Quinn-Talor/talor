// src/main/prompt/runtime-context.test.ts — 极简 schema runtime-context tests
import { describe, it, expect, vi } from 'vitest'
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { SkillRegistry } from '../skills/registry'
import { buildRuntimeContext } from './runtime-context'
import type { AgentProfile } from '@shared/types/agent'

function makeAgentStub(
  profile: AgentProfile,
  skillRegistry: SkillRegistry = SkillRegistry.fromDir(null),
) {
  return { profile, skillRegistry } as import('../agent/agent').Agent
}

const PLATFORM_PROFILE: AgentProfile = {
  id: '__chat__',
  name: 'Talor',
  description: 'Your AI assistant.',
  agentPrompt: 'Help the user with any task.',
}

const BUSINESS_PROFILE: AgentProfile = {
  id: 'reviewer',
  name: 'Code Reviewer',
  description: 'Reviews pull requests.',
  agentPrompt: '## Required Inputs\n- pr_url: PR URL\n\n## Workflow\n1. Read rules\n2. Review PR',
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
