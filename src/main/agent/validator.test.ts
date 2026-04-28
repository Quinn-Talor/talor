import { describe, it, expect } from 'vitest'
import { validateProfile } from './validator'

const VALID_PROFILE = {
  id: 'sales-analyst-001',
  name: '销售分析师',
  description: '自动汇总周度销售数据并生成趋势分析报告',
  version: '1.0.0',
  minAppVersion: '0.2.0',
  role: {
    capabilities: ['从飞书表格获取销售数据', '生成趋势分析图表'],
    constraints: ['只处理销售相关数据'],
    outputFormat: 'Markdown 格式的分析报告',
    personality: '简洁专业',
    sampleConversations: [],
  },
  knowledge: { files: [] },
  dependencies: {
    tools: [{ name: 'bash', required: true }],
    mcpServers: [],
    skills: [],
    cli: [],
  },
  preferences: { maxSteps: 20 },
}

describe('validateProfile', () => {
  it('AC-A1-01: valid profile returns success', () => {
    const result = validateProfile(VALID_PROFILE)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.profile.id).toBe('sales-analyst-001')
      expect(result.profile.name).toBe('销售分析师')
      expect(result.profile.dependencies.mcpServers).toEqual([])
    }
  })

  it('AC-A1-02: missing name returns error', () => {
    const { name: _, ...noName } = VALID_PROFILE
    const result = validateProfile(noName)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain('"name" must be a non-empty string')
    }
  })

  it('AC-A1-03: invalid version returns error', () => {
    const result = validateProfile({ ...VALID_PROFILE, version: 'abc' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain('"version" must be a valid semver')
    }
  })

  it('empty capabilities returns error', () => {
    const result = validateProfile({
      ...VALID_PROFILE,
      role: { ...VALID_PROFILE.role, capabilities: [] },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain('"role.capabilities" must be a non-empty array')
    }
  })

  it('missing dependencies.mcpServers defaults to empty array', () => {
    const result = validateProfile({
      ...VALID_PROFILE,
      dependencies: { tools: [], skills: [], cli: [] },
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.profile.dependencies.mcpServers).toEqual([])
    }
  })

  it('invalid dependencies.mcpServers type returns error', () => {
    const result = validateProfile({
      ...VALID_PROFILE,
      dependencies: { tools: [], mcpServers: 'invalid', skills: [], cli: [] },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain('"dependencies.mcpServers" must be an array')
    }
  })

  it('collects multiple errors at once', () => {
    const result = validateProfile({})
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(3)
    }
  })

  it('null input returns error', () => {
    const result = validateProfile(null)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain('input must be a non-null object')
    }
  })

  it('array input returns error', () => {
    const result = validateProfile([])
    expect(result.valid).toBe(false)
  })

  it('invalid minAppVersion returns error', () => {
    const result = validateProfile({ ...VALID_PROFILE, minAppVersion: 'bad' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain('"minAppVersion" must be a valid semver')
    }
  })

  it('missing outputFormat returns error', () => {
    const result = validateProfile({
      ...VALID_PROFILE,
      role: { ...VALID_PROFILE.role, outputFormat: '' },
    })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors).toContain('"role.outputFormat" must be a non-empty string')
    }
  })

  it('optional minAppVersion can be omitted', () => {
    const { minAppVersion: _, ...noMinVersion } = VALID_PROFILE
    const result = validateProfile(noMinVersion)
    expect(result.valid).toBe(true)
  })
})
