// src/main/agent/validator.test.ts — Schema 1.0 validator 15-rule tests
import { describe, it, expect } from 'vitest'
import { validateProfile } from './validator'
import type { ValidatorContext } from './validator'

const VALID_BUSINESS_PROFILE = {
  schemaVersion: '1.0',
  identity: {
    id: 'code_reviewer',
    name: 'Code Reviewer',
    description: 'Reviews PRs against team standards',
    version: '1.0.0',
    minAppVersion: '0.1.0',
  },
  mission: {
    objective: 'Produce structured PR review aligned with standards',
    outcomes: [
      {
        id: 'review_done',
        description: 'User receives review report with findings classified by severity',
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
  },
  method: {
    capabilities: ['Apply standards rules to a diff and produce structured review findings'],
    tools: [{ name: 'read', required: true }],
  },
  delivery: {
    deliverables: [
      {
        id: 'review_report',
        format: 'json',
        schema: { type: 'object' },
      },
    ],
  },
  execution: {
    limits: { maxSteps: 30, maxTokens: 200000 },
    retryPolicy: {
      maxAttempts: 2,
      onMustFail: 'retry-then-mark',
      onShouldFail: 'mark-only',
    },
  },
}

const VALID_PLATFORM_PROFILE = {
  schemaVersion: '1.0',
  identity: { id: '__chat__', name: 'Talor', description: 'General assistant', version: '0.2.0' },
  mission: { objective: 'Help with any task', outcomes: [] },
  method: { capabilities: ['General conversation'] },
  delivery: { deliverables: [] },
  execution: {
    limits: { maxSteps: 30, maxTokens: 200000 },
    retryPolicy: { maxAttempts: 1, onMustFail: 'abort', onShouldFail: 'mark-only' },
  },
}

function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o))
}

describe('validateProfile RULE 1: structure + identity', () => {
  it('AC-002: rejects old schema (no schemaVersion)', () => {
    const old = {
      id: 'sales',
      name: 'sales',
      description: 'd',
      version: '1.0.0',
      role: { capabilities: ['x'], outputFormat: 'md' },
      knowledge: { files: [] },
      dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
    }
    const r = validateProfile(old)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors.some((e) => e.rule === 1 && e.path === 'schemaVersion')).toBe(true)
    }
  })

  it('AC-010: rejects non-1.0 schemaVersion', () => {
    const r = validateProfile({ ...clone(VALID_BUSINESS_PROFILE), schemaVersion: '0.9' })
    expect(r.valid).toBe(false)
  })

  it('rejects null input', () => {
    const r = validateProfile(null)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors[0].rule).toBe(0)
  })

  it('rejects identity.id with invalid chars', () => {
    const p = clone(VALID_BUSINESS_PROFILE)
    p.identity.id = 'Code-Reviewer!'
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
  })

  it('rejects invalid semver', () => {
    const p = clone(VALID_BUSINESS_PROFILE)
    p.identity.version = 'abc'
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
  })
})

describe('validateProfile RULE 2: verifyBy must contain hard-must', () => {
  it('AC-011: rejects outcome with all-semantic verifyBy', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.outcomes[0].verifyBy = [
      { type: 'llm-judge', judgePrompt: 'X', kind: 'semantic', severity: 'must' },
    ]
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors.some((e) => e.rule === 2)).toBe(true)
    }
  })

  it('accepts outcome with deterministic must + extra semantic should', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.outcomes[0].verifyBy.push({
      type: 'llm-judge',
      judgePrompt: 'rate quality',
      kind: 'semantic',
      severity: 'should',
    })
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })

  it('accepts human-approval as hard-must alternative', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.outcomes[0].verifyBy = [
      { type: 'human-approval', approverRef: 'user', kind: 'human', severity: 'must' },
    ]
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })
})

describe('validateProfile RULE 3: deliverable schema|mustContain', () => {
  it('AC-012: rejects deliverable with neither schema nor mustContain', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.delivery.deliverables[0] = { id: 'r', format: 'json' }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 3)).toBe(true)
  })

  it('accepts deliverable with mustContain only', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.delivery.deliverables[0] = {
      id: 'review_report',
      format: 'markdown',
      mustContain: ['# Review'],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })
})

describe('validateProfile RULE 4: reference integrity', () => {
  it('AC-013: rejects outcomes.verifyBy referencing unknown deliverableId', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.outcomes[0].verifyBy[0].deliverableId = 'nonexistent'
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 4)).toBe(true)
  })

  it('AC-024: rejects duplicate mission.inputs id', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.inputs = [
      { id: 'pr_url', description: 'PR URL', type: 'text', required: true },
      { id: 'pr_url', description: 'duplicate', type: 'text', required: true },
    ]
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 4)).toBe(true)
  })
})

describe('validateProfile RULE 5/6/9: workflow DAG', () => {
  it('AC-014: rejects cycle in requires', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      steps: [
        { id: 'a', description: 'A', requires: ['b'] },
        { id: 'b', description: 'B', requires: ['a'] },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 5)).toBe(true)
  })

  it('AC-015: rejects orphan stepOutput', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      steps: [{ id: 'a', description: 'A', produces: 'random_output' }],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 6)).toBe(true)
  })

  it('AC-018: rejects input referencing unknown producer', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      steps: [{ id: 'a', description: 'A', inputs: ['ghost_input'], produces: 'review_report' }],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 9)).toBe(true)
  })

  it('accepts valid DAG with user-input + produces → deliverable', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      steps: [
        { id: 'load', description: 'L', inputs: ['user-input'], produces: 'context' },
        {
          id: 'analyze',
          description: 'A',
          inputs: ['context'],
          produces: 'review_report',
          requires: ['load'],
        },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })
})

describe('validateProfile RULE 7: method.tools must be built-in', () => {
  it('v8.1: rejects non-builtin tool name', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.tools = [{ name: 'unknown_tool' }]
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 7)).toBe(true)
  })

  it('v8.1: rejects meta-tool (search_tool / skill / delegate_agent) in method.tools', () => {
    for (const name of ['search_tool', 'skill', 'delegate_agent']) {
      const p: any = clone(VALID_BUSINESS_PROFILE)
      p.method.tools = [{ name }]
      const r = validateProfile(p)
      expect(r.valid).toBe(false)
      if (!r.valid) {
        expect(r.errors.some((e) => e.rule === 7 && e.message.includes(name))).toBe(true)
      }
    }
  })

  it('v8.1: accepts all 7 built-in tool names', () => {
    for (const name of ['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls']) {
      const p: any = clone(VALID_BUSINESS_PROFILE)
      p.method.tools = [{ name, required: true }]
      const r = validateProfile(p)
      expect(r.valid).toBe(true)
    }
  })

  it('v8.1: empty method.tools is fine', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.tools = []
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })
})

describe('validateProfile RULE 8: knowledge file path', () => {
  it('AC-017: rejects file knowledge with non-existent path when agentRoot provided', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.knowledge = [
      {
        type: 'file',
        path: 'nonexistent.md',
        description: 'rules',
        format: 'markdown',
      },
    ]
    const r = validateProfile(p, { agentRoot: '/tmp/talor-no-such-dir' })
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 8)).toBe(true)
  })

  it('skips path existence check when agentRoot omitted', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.knowledge = [{ type: 'file', path: 'whatever.md', description: 'rules' }]
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })

  it('rejects empty file path', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.knowledge = [{ type: 'file', path: '', description: 'rules' }]
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
  })
})

describe('validateProfile RULE 10: extractFrom defaults', () => {
  it('applies json-fenced-block default for json format', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    delete p.delivery.deliverables[0].extractFrom
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
    if (r.valid) {
      const ef = r.profile.delivery.deliverables[0].extractFrom
      expect(ef).toEqual({ type: 'json-fenced-block', firstOrLast: 'last' })
    }
  })

  it('applies last-message default for markdown format', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.delivery.deliverables[0] = {
      id: 'review_report',
      format: 'markdown',
      mustContain: ['# Review'],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.profile.delivery.deliverables[0].extractFrom).toEqual({ type: 'last-message' })
    }
  })
})

describe('validateProfile RULE 11: retryPolicy escalateTo', () => {
  it('AC-019: rejects retry-then-escalate without escalateTo', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.execution.retryPolicy.onMustFail = 'retry-then-escalate'
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 11)).toBe(true)
  })

  it('accepts retry-then-escalate with escalateTo', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.execution.retryPolicy = {
      maxAttempts: 2,
      onMustFail: 'retry-then-escalate',
      onShouldFail: 'mark-only',
      escalateTo: { id: 'human_reviewer' },
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })
})

describe('validateProfile RULE 12: preferences.modelId valid', () => {
  it('AC-020: rejects unknown modelId with knownModelIds set', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.preferences = { modelId: 'claude-3-opus' }
    const ctx: ValidatorContext = { knownModelIds: new Set(['claude-opus-4-7']) }
    const r = validateProfile(p, ctx)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 12)).toBe(true)
  })

  it('accepts known modelId', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.preferences = { modelId: 'claude-opus-4-7' }
    const ctx: ValidatorContext = { knownModelIds: new Set(['claude-opus-4-7']) }
    const r = validateProfile(p, ctx)
    expect(r.valid).toBe(true)
  })
})

describe('validateProfile RULE 13: capability ↔ outcome overlap (warn)', () => {
  it('warns when capability has no keyword overlap with outcomes', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.capabilities = ['Make coffee for the team']
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.warnings.some((w) => w.rule === 13)).toBe(true)
    }
  })

  it('no warning when capability overlaps with outcome', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.capabilities = ['Generate review report findings classified by severity']
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.warnings.some((w) => w.rule === 13)).toBe(false)
    }
  })
})

describe('validateProfile RULE 14: platform agent exception', () => {
  it('AC-021: accepts platform agent with empty mission/delivery', () => {
    const r = validateProfile(VALID_PLATFORM_PROFILE)
    expect(r.valid).toBe(true)
  })

  it('rejects business agent with empty outcomes', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.outcomes = []
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 14)).toBe(true)
  })

  it('rejects business agent with empty deliverables', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.delivery.deliverables = []
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 14)).toBe(true)
  })
})

describe('validateProfile RULE 15: implicit acceptance prep', () => {
  it('AC-022 prep: profile with knowledge.required passes validator', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.knowledge = [
      {
        type: 'file',
        path: 'rules.md',
        description: 'engineering rules',
        format: 'markdown',
        required: true,
      },
    ]
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })
})

describe('validateProfile mission.inputs', () => {
  it('AC-023: accepts inputs with required flag', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.inputs = [
      {
        id: 'pr_url_or_diff',
        description: 'Pull request URL or diff',
        type: 'text',
        required: true,
        examples: ['https://github.com/x/y/pull/1'],
      },
    ]
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })

  it('platform agent without inputs is fine', () => {
    const r = validateProfile(VALID_PLATFORM_PROFILE)
    expect(r.valid).toBe(true)
  })
})

describe('validateProfile execution validation', () => {
  it('rejects negative maxSteps', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.execution.limits.maxSteps = -1
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
  })

  it('rejects zero maxTokens', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.execution.limits.maxTokens = 0
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
  })

  it('rejects unknown onMustFail value', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.execution.retryPolicy.onMustFail = 'rerun-everything'
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
  })
})

describe('validateProfile happy path', () => {
  it('AC-001: full business profile valid', () => {
    const r = validateProfile(VALID_BUSINESS_PROFILE)
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.profile.identity.id).toBe('code_reviewer')
      expect(r.profile.delivery.deliverables[0].extractFrom).toBeDefined()
    }
  })

  it('full platform profile valid', () => {
    const r = validateProfile(VALID_PLATFORM_PROFILE)
    expect(r.valid).toBe(true)
  })
})

// ─── RULE 16: workflow.steps[].use 依赖闭包 ──────────────────

describe('validateProfile RULE 16: workflow dependency closure', () => {
  it('rejects step.use.tools referencing tool not declared in method.tools', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      kind: 'sequence',
      steps: [
        {
          id: 'step1',
          description: 'first step',
          use: { tools: ['write'] },
          produces: 'review_report',
        },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      const rule16Errors = r.errors.filter((e) => e.rule === 16)
      expect(rule16Errors.length).toBeGreaterThan(0)
      expect(rule16Errors[0].message).toContain('write')
    }
  })

  it('rejects step.use.skills referencing skill not declared in method.skills', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      kind: 'sequence',
      steps: [
        {
          id: 'step1',
          description: 'first step',
          use: { skills: ['lark-doc'] },
          produces: 'review_report',
        },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors.some((e) => e.rule === 16 && e.message.includes('lark-doc'))).toBe(true)
    }
  })

  it('rejects step.use.mcpServers referencing undeclared MCP server', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      kind: 'sequence',
      steps: [
        {
          id: 'step1',
          description: 'first step',
          use: { mcpServers: ['notion'] },
          produces: 'review_report',
        },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors.some((e) => e.rule === 16 && e.message.includes('notion'))).toBe(true)
    }
  })

  it('rejects step.use.cli referencing undeclared CLI', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      kind: 'sequence',
      steps: [
        {
          id: 'step1',
          description: 'first step',
          use: { cli: ['gh'] },
          produces: 'review_report',
        },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors.some((e) => e.rule === 16 && e.message.includes('gh'))).toBe(true)
    }
  })

  it('v8: legacy step.tools is silently ignored (not validated, not promoted)', () => {
    // v8 删了 step.tools 字段。运行时不做向后兼容：JSON 里残留的 tools 字段对
    // validator 透明,不影响 valid 判定（只校验 step.use.*）。
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      kind: 'sequence',
      steps: [
        {
          id: 'step1',
          description: 'first step',
          tools: ['bash'], // 残留字段,被 TS 类型忽略,validator 不读
          use: { tools: ['read'] },
          produces: 'review_report',
        },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })

  it('passes when every use.* references a declared dep', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      kind: 'sequence',
      steps: [
        {
          id: 'step1',
          description: 'first step',
          use: { tools: ['read'] },
          produces: 'review_report',
        },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })

  it("kind='branch' requires non-empty branchOn", () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      kind: 'sequence',
      steps: [
        {
          id: 'step1',
          description: 'pick path',
          kind: 'branch',
          produces: 'review_report',
        },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors.some((e) => e.rule === 16 && e.path.endsWith('branchOn'))).toBe(true)
    }
  })

  it("kind='loop' requires non-empty loopWhile", () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.workflow = {
      kind: 'sequence',
      steps: [
        {
          id: 'step1',
          description: 'iterate',
          kind: 'loop',
          produces: 'review_report',
        },
      ],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) {
      expect(r.errors.some((e) => e.rule === 16 && e.path.endsWith('loopWhile'))).toBe(true)
    }
  })
})

// ─── RULE 17: capabilities 反向闸门 (warn) ─────────────────────

describe('validateProfile RULE 17: capabilities → method.* reverse completeness (warn)', () => {
  it('warns when capability mentions skill name but method.skills missing it', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.capabilities = ['Use lark-doc to create a structured doc from review findings']
    const r = validateProfile(p)
    // 这是 warn,不会让 valid=false
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.warnings.some((w) => w.rule === 17 && w.message.includes('lark-doc'))).toBe(true)
    }
  })

  it('warns when capability mentions CLI but method.cli missing it', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.capabilities = ['Use git diff to inspect changes before review']
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.warnings.some((w) => w.rule === 17 && w.message.includes('git'))).toBe(true)
    }
  })

  it('does not warn when mentioned skill is declared', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.method.capabilities = ['Use lark-doc to create a structured doc from review findings']
    p.method.skills = [{ name: 'lark-doc', required: true }]
    // v8.1: skill 元工具不再列在 method.tools, 仅由 method.skills 派生
    p.method.tools = [{ name: 'read', required: true }]
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
    if (r.valid) {
      expect(r.warnings.some((w) => w.rule === 17 && w.message.includes('lark-doc'))).toBe(false)
    }
  })
})

// ─── RULE 18: mission.scope ──────────────────────────────────

describe('validateProfile RULE 18: mission.scope (optional)', () => {
  it('accepts profile without scope', () => {
    const r = validateProfile(VALID_BUSINESS_PROFILE)
    expect(r.valid).toBe(true)
  })

  it('accepts well-formed scope', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.scope = {
      in: ['Review PR diffs', 'Apply standards rules'],
      out: ['Run code', 'Modify production data'],
    }
    const r = validateProfile(p)
    expect(r.valid).toBe(true)
  })

  it('rejects scope as non-object', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.scope = 'not-an-object'
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 18)).toBe(true)
  })

  it('rejects scope.in with non-string entry', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.scope = { in: ['ok', 42], out: ['nope'] }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid)
      expect(r.errors.some((e) => e.rule === 18 && e.path === 'mission.scope.in')).toBe(true)
  })

  it('rejects scope.out with empty string entry', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.scope = { in: ['ok'], out: ['nope', ''] }
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid)
      expect(r.errors.some((e) => e.rule === 18 && e.path === 'mission.scope.out')).toBe(true)
  })

  it('rejects scope missing in or out', () => {
    const p: any = clone(VALID_BUSINESS_PROFILE)
    p.mission.scope = { in: ['ok'] } // out 缺
    const r = validateProfile(p)
    expect(r.valid).toBe(false)
    if (!r.valid)
      expect(r.errors.some((e) => e.rule === 18 && e.path === 'mission.scope.out')).toBe(true)
  })
})
