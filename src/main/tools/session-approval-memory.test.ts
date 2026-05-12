import { describe, it, expect } from 'vitest'
import { SessionApprovalMemory } from './session-approval-memory'

describe('SessionApprovalMemory', () => {
  it('未批准的 patternKey → isApproved=false', () => {
    const mem = new SessionApprovalMemory()
    expect(mem.isApproved('s1', 'sql:INSERT:game.rule')).toBe(false)
  })

  it('approve 后 isApproved=true', () => {
    const mem = new SessionApprovalMemory()
    mem.approve('s1', 'sql:INSERT:game.rule')
    expect(mem.isApproved('s1', 'sql:INSERT:game.rule')).toBe(true)
  })

  it('不同 session 隔离', () => {
    const mem = new SessionApprovalMemory()
    mem.approve('s1', 'sql:INSERT:x')
    expect(mem.isApproved('s2', 'sql:INSERT:x')).toBe(false)
  })

  it('不同 patternKey 互不影响', () => {
    const mem = new SessionApprovalMemory()
    mem.approve('s1', 'sql:INSERT:game.rule')
    expect(mem.isApproved('s1', 'sql:UPDATE:game.rule')).toBe(false)
  })

  it('approve 幂等 (重复 approve 同 key 不报错)', () => {
    const mem = new SessionApprovalMemory()
    mem.approve('s1', 'key')
    mem.approve('s1', 'key')
    expect(mem.listApproved('s1')).toEqual(['key'])
  })

  it('空 patternKey 永远不命中', () => {
    const mem = new SessionApprovalMemory()
    mem.approve('s1', '')
    expect(mem.isApproved('s1', '')).toBe(false)
  })

  it('clear 清空指定 session', () => {
    const mem = new SessionApprovalMemory()
    mem.approve('s1', 'k1')
    mem.approve('s1', 'k2')
    mem.approve('s2', 'k3')
    mem.clear('s1')
    expect(mem.isApproved('s1', 'k1')).toBe(false)
    expect(mem.isApproved('s1', 'k2')).toBe(false)
    expect(mem.isApproved('s2', 'k3')).toBe(true)
  })

  it('listApproved 返回某 session 所有 pattern (测试用)', () => {
    const mem = new SessionApprovalMemory()
    mem.approve('s1', 'a')
    mem.approve('s1', 'b')
    expect(mem.listApproved('s1').sort()).toEqual(['a', 'b'])
    expect(mem.listApproved('unknown')).toEqual([])
  })
})
