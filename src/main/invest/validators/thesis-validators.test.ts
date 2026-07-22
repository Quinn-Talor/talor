// B 奠基:逐参数校验器链注册 + 顺序锁定(行为保持;既有 store 测试覆盖各码触发)
import { describe, it, expect } from 'vitest'
import { ASSUMPTION_VALIDATORS } from './thesis-validators'

describe('ASSUMPTION_VALIDATORS 链(顺序敏感,与原 addThesisVersion 内联一致)', () => {
  it('(AC-005) 校验器按原内联顺序注册(扩展新不变量 = 加进此数组)', () => {
    expect(ASSUMPTION_VALIDATORS.map((v) => v.code)).toEqual([
      'FORECAST_NO_MODE',
      'CORE_FORECAST_NOT_DERIVED',
      'ASSUMPTION_NO_ANCHOR',
      'ANCHOR_NO_ASOF',
      'ANCHOR_UNIT_MISMATCH',
      'CORE_NO_VERIFY',
      'ANCHOR_UNTRUSTED',
      'STALE_ANCHOR',
      'FACT_REFERENCED_MISSING',
    ])
  })
})
