import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
// risk-gate 经 side-effect-ledger 引入 db/index（electron）
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import type { ComponentCtx, RunInfo, ToolCallView } from 'agent-engine'
import { talorFallbackRisk } from './fallback-risk'

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
