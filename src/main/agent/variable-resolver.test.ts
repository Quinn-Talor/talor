import { describe, it, expect } from 'vitest'
import { resolveVariables } from './variable-resolver'

describe('resolveVariables', () => {
  it('AC-C3-01: replaces template variables with actual values', () => {
    const config = { APP_ID: '{{feishu_appid}}' }
    const values = new Map([['feishu_appid', 'cli_xxx']])
    const result = resolveVariables(config, values)
    expect(result.resolved).toEqual({ APP_ID: 'cli_xxx' })
    expect(result.missing).toEqual([])
  })

  it('AC-C3-02: reports missing variables', () => {
    const config = { APP_ID: '{{feishu_appid}}' }
    const values = new Map<string, string>()
    const result = resolveVariables(config, values)
    expect(result.missing).toContain('feishu_appid')
  })

  it('handles multiple variables in one value', () => {
    const config = { URL: 'https://{{host}}:{{port}}/api' }
    const values = new Map([['host', 'example.com'], ['port', '8080']])
    const result = resolveVariables(config, values)
    expect(result.resolved.URL).toBe('https://example.com:8080/api')
    expect(result.missing).toEqual([])
  })

  it('handles mix of found and missing variables', () => {
    const config = { A: '{{found}}', B: '{{missing}}' }
    const values = new Map([['found', 'yes']])
    const result = resolveVariables(config, values)
    expect(result.resolved.A).toBe('yes')
    expect(result.missing).toContain('missing')
  })

  it('passes through values without templates', () => {
    const config = { plain: 'no-template-here' }
    const values = new Map<string, string>()
    const result = resolveVariables(config, values)
    expect(result.resolved.plain).toBe('no-template-here')
    expect(result.missing).toEqual([])
  })

  it('handles empty config', () => {
    const result = resolveVariables({}, new Map())
    expect(result.resolved).toEqual({})
    expect(result.missing).toEqual([])
  })
})
