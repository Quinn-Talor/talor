// talorAPI trace 命名空间：无 preload 时落到 stub，有 preload 时透传（turn-trace AC-025）。

import { describe, it, expect, afterEach } from 'vitest'
import { talorAPI } from './talorAPI'

type WindowLike = { talorAPI?: unknown }

function setWindow(value: WindowLike): void {
  ;(globalThis as { window?: WindowLike }).window = value
}

afterEach(() => {
  delete (globalThis as { window?: WindowLike }).window
})

describe('talorAPI.trace', () => {
  it('AC-025: falls back to the stub without preload and forwards to window.talorAPI when present', async () => {
    setWindow({})
    expect(await talorAPI.trace.list('s1')).toEqual({ status: 'success', traces: [] })

    const traces = [{ id: 'X1' }]
    setWindow({ talorAPI: { trace: { list: async () => ({ status: 'success', traces }) } } })
    expect(await talorAPI.trace.list('s1')).toEqual({ status: 'success', traces })
  })

  it('stub methods return structured results', async () => {
    setWindow({})
    expect(await talorAPI.trace.get('t1')).toMatchObject({
      status: 'failure',
      error_code: 'TRACE_NOT_FOUND',
    })
    expect(await talorAPI.trace.getBlob('t1', 'h')).toMatchObject({ status: 'failure' })
    expect(await talorAPI.trace.toolDurations('s1')).toEqual({ status: 'success', durations: {} })
  })
})
