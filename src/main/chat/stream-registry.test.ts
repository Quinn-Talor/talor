import { describe, it, expect, beforeEach } from 'vitest'
import { streamRegistry } from './stream-registry'

describe('streamRegistry', () => {
  beforeEach(() => {
    // abort 无条件清掉条目,用于测试间隔离
    streamRegistry.abort('s1')
    streamRegistry.abort('s2')
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
    streamRegistry.cleanup('s1', 'msg-1')
    streamRegistry.cleanup('s1', 'msg-1')
  })

  it('cleanup 自身 messageId 后条目被移除,随后 abort 不再影响已结束的 controller', () => {
    const ctrl = streamRegistry.register('s1', 'msg-1')
    streamRegistry.cleanup('s1', 'msg-1')
    streamRegistry.abort('s1')
    expect(ctrl.signal.aborted).toBe(false)
  })

  it('旧请求的 cleanup 不删除同 session 新请求的条目,Stop 仍能中止新请求', () => {
    streamRegistry.register('s1', 'msg-old')
    const fresh = streamRegistry.register('s1', 'msg-new')
    // 被新请求 abort 的旧请求随后走到 finally
    streamRegistry.cleanup('s1', 'msg-old')
    streamRegistry.abort('s1')
    expect(fresh.signal.aborted).toBe(true)
  })

  it('未注册请求的 cleanup 不影响正在运行的请求', () => {
    const running = streamRegistry.register('s1', 'msg-running')
    streamRegistry.cleanup('s1', 'msg-never-registered')
    streamRegistry.abort('s1')
    expect(running.signal.aborted).toBe(true)
  })

  it('abort 不存在的 session 静默返回', () => {
    expect(() => streamRegistry.abort('nonexistent')).not.toThrow()
  })
})
