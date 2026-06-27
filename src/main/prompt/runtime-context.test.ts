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

  // ── append-only 缓存守护(Phase 3)──────────────────────────────────────
  // buildRuntimeContext 产出进入 prompt 的 agent 稳定层(AgentPromptPlugin)。
  // 该层必须是 agent 的纯函数 —— 同一 agent 多次构建字节一致,否则缓存前缀每轮
  // 失效。历史上 SystemPlugin 的 `Current time` 毫秒戳正是这类污染(把命中率从
  // ~99% 打到 ~14%);彼时 system 层有守护测试,agent 层没有 —— 这里补上。
  describe('determinism(缓存前缀不变量)', () => {
    it('同一 agent 多次构建字节一致(无时间戳/随机/自增)', () => {
      const agent = makeAgentStub(BUSINESS_PROFILE)
      const a = JSON.stringify(buildRuntimeContext(agent))
      const b = JSON.stringify(buildRuntimeContext(agent))
      expect(a).toBe(b)
    })

    it('__chat__ agent 同样字节一致', () => {
      const agent = makeAgentStub(PLATFORM_PROFILE)
      const a = JSON.stringify(buildRuntimeContext(agent))
      const b = JSON.stringify(buildRuntimeContext(agent))
      expect(a).toBe(b)
    })

    it('产出不含 ISO 时间戳形态(YYYY-MM-DDThh:mm)', () => {
      // 防御:若有人把 new Date().toISOString() 等塞进 agent 层,这条会失败。
      // (BUSINESS_PROFILE 本身不含此形态,故任何命中都是 builder 注入的。)
      const ctx = buildRuntimeContext(makeAgentStub(BUSINESS_PROFILE))
      expect(JSON.stringify(ctx)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    })
  })
})
