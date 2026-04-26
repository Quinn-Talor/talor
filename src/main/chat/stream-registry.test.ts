import { describe, it, expect, beforeEach } from 'vitest'
import { streamRegistry } from './stream-registry'

describe('streamRegistry', () => {
  beforeEach(() => {
    streamRegistry.cleanup('s1')
    streamRegistry.cleanup('s2')
  })

  it('register 返回新的 AbortController，未中止', () => {
    const ctrl = streamRegistry.register('s1', 'msg-1')
    expect(ctrl.signal.aborted).toBe(false)
  })

  it('同一 session 再次 register 会 abort 旧 controller', () => {
    const old = streamRegistry.register('s1', 'msg-1')
    const fresh = streamRegistry.register('s1', 'msg-2')
    expect(old.signal.aborted).toBe(true)
    expect(fresh.signal.aborted).toBe(false)
  })

  it('abort 中止当前 controller 并清掉注册项', () => {
    const ctrl = streamRegistry.register('s1', 'msg-1')
    streamRegistry.abort('s1')
    expect(ctrl.signal.aborted).toBe(true)
    const next = streamRegistry.register('s1', 'msg-2')
    expect(next.signal.aborted).toBe(false)
  })

  it('cleanup 幂等', () => {
    streamRegistry.register('s1', 'msg-1')
    streamRegistry.cleanup('s1')
    streamRegistry.cleanup('s1')
  })

  it('abort 不存在的 session 静默返回', () => {
    expect(() => streamRegistry.abort('nonexistent')).not.toThrow()
  })
})
