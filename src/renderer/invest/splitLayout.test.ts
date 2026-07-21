import { describe, it, expect } from 'vitest'
import { clampConvoWidth, CONVO_MIN, CONVO_MAX } from './splitLayout'

describe('clampConvoWidth(中|右 拖拽夹取)', () => {
  it('宽窗内的正常值原样返回(取整)', () => {
    expect(clampConvoWidth(400, 1400)).toBe(400)
    expect(clampConvoWidth(400.6, 1400)).toBe(401)
  })
  it('超上限 → CONVO_MAX', () => {
    expect(clampConvoWidth(1000, 1400)).toBe(CONVO_MAX)
  })
  it('低于下限 → CONVO_MIN', () => {
    expect(clampConvoWidth(100, 1400)).toBe(CONVO_MIN)
  })
  it('窄窗:优先保 canvas 地板,退回 CONVO_MIN', () => {
    expect(clampConvoWidth(500, 700)).toBe(CONVO_MIN)
  })
})
