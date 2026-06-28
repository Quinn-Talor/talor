import { describe, it, expect } from 'vitest'
import { computeGate } from './gate'
import type { GateInput } from './types'

function base(): GateInput {
  return {
    regime: { systemic: 'normal', direction: '持平' },
    riskBounds: {
      marginOfSafety: { required: 0.2, current: 0.3 }, // 安全边际充足
      veto: [{ rule: 'audit_nonstandard', status: 'clear' }],
    },
  }
}

describe('computeGate', () => {
  it('全良性 → 通行', () => {
    const g = computeGate(base())
    expect(g.state).toBe('通行')
    expect(g.reason).toEqual([])
  })

  it('veto 触发 → 否决,reason 含规则名', () => {
    const g = computeGate({
      ...base(),
      riskBounds: {
        marginOfSafety: { required: 0.2, current: 0.3 },
        veto: [{ rule: 'audit_nonstandard', status: 'triggered' }],
      },
    })
    expect(g.state).toBe('否决')
    expect(g.reason).toContain('audit_nonstandard')
  })

  it('systemic extreme → 否决', () => {
    const g = computeGate({ ...base(), regime: { systemic: 'extreme', direction: '持平' } })
    expect(g.state).toBe('否决')
    expect(g.reason).toContain('系统性风险极端')
  })

  it('安全边际不足(current<required) → 节流(禁加仓 + 抬门槛)', () => {
    const g = computeGate({
      ...base(),
      riskBounds: {
        marginOfSafety: { required: 0.3, current: 0.1 },
        veto: [{ rule: 'x', status: 'clear' }],
      },
    })
    expect(g.state).toBe('节流')
    expect(g.reason).toContain('安全边际不足')
  })

  it('风向恶化 → 节流', () => {
    const g = computeGate({ ...base(), regime: { systemic: 'normal', direction: '恶化' } })
    expect(g.state).toBe('节流')
    expect(g.reason).toContain('风向恶化')
  })

  it('systemic warning(无 veto/否决/节流条件) → 警告', () => {
    const g = computeGate({ ...base(), regime: { systemic: 'warning', direction: '持平' } })
    expect(g.state).toBe('警告')
    expect(g.reason).toContain('系统性风险预警')
  })

  it('优先级: veto + 安全边际不足 同时 → 否决优先', () => {
    const g = computeGate({
      regime: { systemic: 'normal', direction: '恶化' },
      riskBounds: {
        marginOfSafety: { required: 0.3, current: 0.1 },
        veto: [{ rule: 'thesis_broken', status: 'triggered' }],
      },
    })
    expect(g.state).toBe('否决')
  })

  it('安全边际 NaN → 不误触发节流(降级到通行)', () => {
    const g = computeGate({
      ...base(),
      riskBounds: {
        marginOfSafety: { required: NaN, current: NaN },
        veto: [{ rule: 'x', status: 'clear' }],
      },
    })
    expect(g.state).toBe('通行')
  })

  it('systemic 非法值 → 按 normal 处理(通行)', () => {
    const g = computeGate({
      ...base(),
      regime: { systemic: 'bogus' as never, direction: '持平' },
    })
    expect(g.state).toBe('通行')
  })

  it('确定性: 同输入两次结果深相等', () => {
    const input = base()
    expect(computeGate(input)).toEqual(computeGate(input))
  })
})
