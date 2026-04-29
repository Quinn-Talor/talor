import { describe, it, expect, vi } from 'vitest'
import { ExecutionEventBus } from './events'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('ExecutionEventBus', () => {
  it('delivers events to matching subscribers', () => {
    const bus = new ExecutionEventBus()
    const listener = vi.fn()
    bus.on('memory.compressed', listener)

    bus.emit({ type: 'memory.compressed', coveredUntilMessageId: 'msg-42' })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      type: 'memory.compressed',
      coveredUntilMessageId: 'msg-42',
    })
  })

  it('supports multiple subscribers for the same event type', () => {
    const bus = new ExecutionEventBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.on('memory.compressed', a)
    bus.on('memory.compressed', b)

    bus.emit({ type: 'memory.compressed', coveredUntilMessageId: 'msg-1' })

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when no subscribers are registered', () => {
    const bus = new ExecutionEventBus()
    expect(() => {
      bus.emit({ type: 'memory.compressed', coveredUntilMessageId: 'msg-1' })
    }).not.toThrow()
  })

  it('isolates listener errors — one throwing listener does not affect others', () => {
    const bus = new ExecutionEventBus()
    const throwing = vi.fn(() => { throw new Error('listener failure') })
    const healthy = vi.fn()
    bus.on('memory.compressed', throwing)
    bus.on('memory.compressed', healthy)

    expect(() => {
      bus.emit({ type: 'memory.compressed', coveredUntilMessageId: 'msg-1' })
    }).not.toThrow()
    expect(throwing).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
