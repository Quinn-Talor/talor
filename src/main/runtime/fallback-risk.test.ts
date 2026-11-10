import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import type { ComponentCtx, RunInfo, ToolCallView } from 'agent-engine'
import { detectFallbackRisk, stripSqlNoise, talorFallbackRisk } from './fallback-risk'

const run = {} as RunInfo
const ctx = {} as ComponentCtx

function call(toolName: string, risk: 'low' | 'high', input: unknown): ToolCallView {
  return { callId: 'c1', toolName, capability: 'mcp:crm', input, risk, effect: 'side_effect' }
}

describe('talorFallbackRisk', () => {
  const rule = talorFallbackRisk()

  it('AC-010 asks with high risk when a low-risk tool input hits a legacy pattern', async () => {
    expect(rule.id).toBe('talor-fallback-risk')
    const verdict = await rule.permit(call('crm__run', 'low', { sql: 'DELETE FROM t' }), run, ctx)
    expect(verdict).toMatchObject({ ask: { risk: 'high' } })
    const ask = (verdict as { ask: { summary: string; detail: { reason: string; input: string } } })
      .ask
    expect(ask.detail.reason).toContain('SQL DML')
    expect(ask.detail.input).toContain('DELETE FROM')
    expect(ask.summary.startsWith('crm__run ')).toBe(true)
  })

  it('AC-010 leaves high-risk tools to riskApproval and lets harmless input through', async () => {
    expect(await rule.permit(call('write', 'high', { content: 'DELETE FROM t' }), run, ctx)).toBe(
      'allow',
    )
    expect(await rule.permit(call('crm__get', 'low', { id: 1 }), run, ctx)).toBe('allow')
    expect(await rule.permit(call('crm__get', 'low', undefined), run, ctx)).toBe('allow')
  })
})

describe('detectFallbackRisk', () => {
  it('DROP TABLE → 命中', () => {
    expect(detectFallbackRisk({ sql: 'DROP TABLE x' })).not.toBeNull()
  })

  it('INSERT/UPDATE/DELETE → 命中', () => {
    expect(detectFallbackRisk({ sql: 'INSERT INTO x VALUES (1)' })).not.toBeNull()
    expect(detectFallbackRisk({ sql: 'UPDATE x SET y=1' })).not.toBeNull()
    expect(detectFallbackRisk({ sql: 'DELETE FROM x' })).not.toBeNull()
  })

  it('rm -rf 命中', () => {
    expect(detectFallbackRisk({ command: 'rm -rf /tmp' })).not.toBeNull()
  })

  it('SELECT 不命中', () => {
    expect(detectFallbackRisk({ sql: 'SELECT * FROM x' })).toBeNull()
  })

  it('字符串字面量中的 DROP 不误报 (stripSqlNoise)', () => {
    expect(detectFallbackRisk({ sql: "SELECT 'DROP TABLE x' as msg" })).toBeNull()
  })

  it('SQL 注释中的 INSERT 不误报', () => {
    expect(detectFallbackRisk({ sql: '-- INSERT INTO x\nSELECT 1' })).toBeNull()
    expect(detectFallbackRisk({ sql: '/* DROP TABLE */ SELECT 1' })).toBeNull()
  })
})

describe('stripSqlNoise', () => {
  it('剥离行注释', () => {
    expect(stripSqlNoise('SELECT 1 -- DROP TABLE x')).toBe('SELECT 1 ')
  })

  it('剥离块注释', () => {
    expect(stripSqlNoise('SELECT /* INSERT */ 1')).toBe('SELECT  1')
  })

  it('剥离单引号字符串', () => {
    expect(stripSqlNoise("SELECT 'DROP'")).toBe("SELECT ''")
  })
})
