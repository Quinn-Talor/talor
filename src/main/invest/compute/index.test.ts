import { describe, it, expect } from 'vitest'
import * as invest_lib from './index'

describe('compute/index barrel', () => {
  it('导出全部 10 个确定性函数', () => {
    const fns = [
      'computeRedFlags',
      'computePercentile',
      'reverseDcf',
      'computeTrend',
      'checkFalsification',
      'crossCheck',
      'computeGate',
      'computeValuation',
      'computeIndustryScore',
      'computeMacroClock',
    ] as const
    for (const fn of fns) {
      expect(typeof (invest_lib as Record<string, unknown>)[fn]).toBe('function')
    }
  })

  it('导出阈值常量 RED_FLAG_THRESHOLDS', () => {
    expect(invest_lib.RED_FLAG_THRESHOLDS.ocfToNi).toBe(1)
  })
})
