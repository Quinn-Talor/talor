// src/main/agent/validator.test.ts — 极简 schema (6 规则) 测试
import { describe, it, expect } from 'vitest'
import { validateProfile } from './validator'
import type { AgentProfile } from '@shared/types/agent'

function minimal(over: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'test',
    name: 'Test',
    description: 'A test agent.',
    agentPrompt: '## Workflow\n1. Do.\n\n## Principles\n- Be good.\n\n## Output\nFree-form.',
    ...over,
  }
}

describe('validateProfile (极简 schema)', () => {
  it('accepts minimal valid profile', () => {
    const r = validateProfile(minimal())
    expect(r.valid).toBe(true)
  })

  it('rejects non-object input', () => {
    expect(validateProfile(null).valid).toBe(false)
    expect(validateProfile('string').valid).toBe(false)
    expect(validateProfile([]).valid).toBe(false)
  })

  // RULE 2: 必填字段非空
  describe('RULE 2 (required fields)', () => {
    it('rejects empty required fields', () => {
      for (const f of ['id', 'name', 'description', 'agentPrompt'] as const) {
        const r = validateProfile(minimal({ [f]: '' } as Partial<AgentProfile>))
        expect(r.valid).toBe(false)
      }
    })
    it('accepts agentPrompt from ctx.injectedAgentPrompt (directory mode)', () => {
      const { agentPrompt: _omit, ...rest } = minimal()
      const r = validateProfile(rest, { injectedAgentPrompt: '## Workflow\n1. Work' })
      expect(r.valid).toBe(true)
    })
  })

  // RULE 3: id format
  describe('RULE 3 (id format)', () => {
    it('rejects bad id format', () => {
      const r = validateProfile(minimal({ id: 'Bad Id!' }))
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 3)).toBe(true)
    })
    it('accepts snake-case id', () => {
      expect(validateProfile(minimal({ id: 'my_agent-1' })).valid).toBe(true)
    })
    it('accepts platform agent id pattern __chat__', () => {
      expect(validateProfile(minimal({ id: '__chat__' })).valid).toBe(true)
    })
  })

  // RULE 5: tools whitelist
  describe('RULE 5 (tools whitelist)', () => {
    it('rejects non-builtin tool', () => {
      const r = validateProfile(minimal({ tools: ['read', 'NOPE' as never] }))
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 5)).toBe(true)
    })
    it('rejects non-string tool element', () => {
      const r = validateProfile(minimal({ tools: [42 as never, 'read'] }))
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 5)).toBe(true)
    })
    it('accepts valid builtin tools', () => {
      expect(validateProfile(minimal({ tools: ['read', 'bash', 'edit'] })).valid).toBe(true)
    })
    it('accepts empty tools array', () => {
      expect(validateProfile(minimal({ tools: [] })).valid).toBe(true)
    })
  })

  // RULE 7: subagents
  describe('RULE 7 (subagents)', () => {
    it('rejects malformed subagents.ids[] entries', () => {
      const r = validateProfile(
        minimal({
          subagents: { ids: [{ id: 'x', required: true }, null as never, 42 as never] as never },
        }),
      )
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.filter((e) => e.rule === 7).length).toBeGreaterThanOrEqual(2)
    })
    it('accepts subagents with allowAny only', () => {
      expect(validateProfile(minimal({ subagents: { allowAny: true } })).valid).toBe(true)
    })
    it('flags unknown subagent id when knownAgentIds provided', () => {
      const r = validateProfile(
        minimal({ subagents: { ids: [{ id: 'unknown', required: true }] } }),
        { knownAgentIds: new Set(['known']) },
      )
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 7)).toBe(true)
    })
  })

  // RULE 12: skills 是 string[]
  describe('RULE 12 (skills string[])', () => {
    it('accepts string[] skills', () => {
      expect(validateProfile(minimal({ skills: ['lark-mail', 'lark-doc'] })).valid).toBe(true)
    })
    it('rejects object[] skills (旧 SkillItem 格式)', () => {
      const r = validateProfile(
        minimal({ skills: [{ name: 'lark-mail', required: true }] as never }),
      )
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 12)).toBe(true)
    })
    it('rejects empty string in skills', () => {
      const r = validateProfile(minimal({ skills: ['', 'ok'] }))
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 12)).toBe(true)
    })
    it('enforces knownSkillNames when provided', () => {
      const r = validateProfile(minimal({ skills: ['missing-platform-skill'] }), {
        knownSkillNames: new Set(['installed-skill']),
      })
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 12)).toBe(true)
    })
  })

  // RULE 13: mcpServers 是 string[]
  describe('RULE 13 (mcpServers string[])', () => {
    it('accepts string[] mcpServers', () => {
      expect(validateProfile(minimal({ mcpServers: ['github', 'linear'] })).valid).toBe(true)
    })
    it('rejects object[] mcpServers (旧 McpServerDependency 格式)', () => {
      const r = validateProfile(
        minimal({
          mcpServers: [{ name: 'github', transport: { type: 'stdio', command: 'npx' } }] as never,
        }),
      )
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 13)).toBe(true)
    })
    it('enforces knownMcpServerNames when provided', () => {
      const r = validateProfile(minimal({ mcpServers: ['unconfigured'] }), {
        knownMcpServerNames: new Set(['github']),
      })
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 13)).toBe(true)
    })
  })
})
