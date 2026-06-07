// src/main/agent/validator.test.ts
import { describe, it, expect } from 'vitest'
import { validateProfile } from './validator'
import type { AgentProfile } from '@shared/types/agent'

function minimal(over: Partial<AgentProfile> = {}): AgentProfile {
  return {
    schemaVersion: '2.0',
    id: 'test',
    name: 'Test',
    description: 'A test agent.',
    version: '1.0.0',
    agentPrompt: '## Workflow\n1. Do.\n\n## Principles\n- Be good.\n\n## Output\nFree-form.',
    ...over,
  }
}

describe('validateProfile (v2.0)', () => {
  it('accepts minimal valid profile', () => {
    const r = validateProfile(minimal())
    expect(r.valid).toBe(true)
  })

  // RULE 1
  it('rejects non-object input', () => {
    expect(validateProfile(null).valid).toBe(false)
    expect(validateProfile('string').valid).toBe(false)
    expect(validateProfile([]).valid).toBe(false)
  })

  it('rejects wrong schemaVersion', () => {
    const r = validateProfile({ ...minimal(), schemaVersion: '1.0' as never })
    expect(r.valid).toBe(false)
    if (!r.valid)
      expect(r.errors.some((e) => e.rule === 1 && e.path === 'schemaVersion')).toBe(true)
  })

  // RULE 2 必填非空
  it('rejects empty required fields', () => {
    for (const f of ['id', 'name', 'description', 'version', 'agentPrompt'] as const) {
      const r = validateProfile(minimal({ [f]: '' } as Partial<AgentProfile>))
      expect(r.valid).toBe(false)
    }
  })

  // RULE 3 id format
  it('rejects bad id format', () => {
    const r = validateProfile(minimal({ id: 'Bad Id!' }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 3)).toBe(true)
  })
  it('accepts platform agent id pattern __chat__', () => {
    const r = validateProfile(minimal({ id: '__chat__' }))
    expect(r.valid).toBe(true)
  })

  // RULE 4 semver
  it('rejects bad version', () => {
    expect(validateProfile(minimal({ version: 'foo' })).valid).toBe(false)
  })
  // RULE 5 tools whitelist
  it('rejects non-builtin tool', () => {
    const r = validateProfile(minimal({ tools: ['read', 'NOPE' as never] }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 5)).toBe(true)
  })

  // RULE 6 references
  it('rejects bad reference id', () => {
    const r = validateProfile(
      minimal({
        references: [{ id: 'Bad Id', path: 'r/a.md', description: 'x' }],
      }),
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 6)).toBe(true)
  })
  it('rejects path with ..', () => {
    const r = validateProfile(
      minimal({
        references: [{ id: 'a', path: '../escape.md', description: 'x' }],
      }),
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 6)).toBe(true)
  })
  it('rejects duplicate reference id', () => {
    const r = validateProfile(
      minimal({
        references: [
          { id: 'a', path: 'r/1.md', description: 'x' },
          { id: 'a', path: 'r/2.md', description: 'y' },
        ],
      }),
    )
    expect(r.valid).toBe(false)
  })

  // RULE 5 — non-string element
  it('rejects non-string tool element', () => {
    const r = validateProfile(minimal({ tools: [42 as never, 'read'] }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 5)).toBe(true)
  })

  // RULE 6 — absolute path
  it('rejects absolute reference path', () => {
    const r = validateProfile(
      minimal({
        references: [{ id: 'abs', path: '/etc/passwd', description: 'bad' }],
      }),
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 6)).toBe(true)
  })

  // RULE 6 — backslash in path
  it('rejects reference path with backslash', () => {
    const r = validateProfile(
      minimal({
        references: [{ id: 'a', path: '..\\escape.md', description: 'x' }],
      }),
    )
    expect(r.valid).toBe(false)
  })

  // RULE 7 — malformed entries
  it('rejects malformed subagents.ids[] entries', () => {
    const r = validateProfile(
      minimal({
        subagents: { ids: [{ id: 'x', required: true }, null as never, 42 as never] as never },
      }),
    )
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors.filter((e) => e.rule === 7).length).toBeGreaterThanOrEqual(2)
    }
  })

  // RULE 7 — allowAny without ids
  it('accepts subagents with allowAny only', () => {
    const r = validateProfile(minimal({ subagents: { allowAny: true } }))
    expect(r.valid).toBe(true)
  })

  // Empty optional arrays
  it('accepts empty optional arrays', () => {
    const r = validateProfile(minimal({ tools: [], references: [] }))
    expect(r.valid).toBe(true)
  })

  // RULE 7 subagents
  it('flags unknown subagent id when context provided', () => {
    const r = validateProfile(
      minimal({
        subagents: { ids: [{ id: 'unknown', required: true }] },
      }),
      { knownAgentIds: new Set(['known']) },
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 7)).toBe(true)
  })

  // RULE 8 model
  it('flags unknown model id when context provided', () => {
    const r = validateProfile(minimal({ preferences: { modelId: 'imaginary' } }), {
      knownModelIds: new Set(['sonnet']),
    })
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 8)).toBe(true)
  })

  // RULE 12: skills 是 string[]
  describe('RULE 12 (skills string[])', () => {
    it('accepts string[] skills', () => {
      const r = validateProfile(minimal({ skills: ['lark-mail', 'lark-doc'] }))
      expect(r.valid).toBe(true)
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
      const r = validateProfile(minimal({ mcpServers: ['github', 'linear'] }))
      expect(r.valid).toBe(true)
    })
    it('rejects object[] mcpServers (旧 McpServerDependency 格式)', () => {
      const r = validateProfile(
        minimal({
          mcpServers: [
            {
              name: 'github',
              required: true,
              tools: [],
              transport: { type: 'stdio', command: 'npx' },
            },
          ] as never,
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

  // RULE 14: cli 是 string[]
  describe('RULE 14 (cli string[])', () => {
    it('accepts string[] cli', () => {
      const r = validateProfile(minimal({ cli: ['gh', 'jq'] }))
      expect(r.valid).toBe(true)
    })
    it('rejects object[] cli (旧 CliDependency 格式)', () => {
      const r = validateProfile(
        minimal({
          cli: [
            { command: 'gh', install: { type: 'brew', formula: 'gh' }, required: true },
          ] as never,
        }),
      )
      expect(r.valid).toBe(false)
      if (!r.valid) expect(r.errors.some((e) => e.rule === 14)).toBe(true)
    })
  })
})
