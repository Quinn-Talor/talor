import { describe, it, expect } from 'vitest'
import {
  currentParent,
  currentScope,
  currentTraceId,
  runInScope,
  withGenerationName,
  withParent,
  type TraceScope,
} from './trace-context'

const ROOT = { traceId: 't1', observationId: 'root' }
const SCOPE: TraceScope = { traceId: 't1', parent: ROOT }

describe('trace-context', () => {
  it('has no scope outside runInScope', () => {
    expect(currentScope()).toBeUndefined()
    expect(currentTraceId()).toBeNull()
    expect(currentParent()).toBeNull()
  })

  it('runInScope exposes the scope across awaits and timers', async () => {
    const seen = await runInScope(SCOPE, async () => {
      await new Promise((r) => setTimeout(r, 1))
      return { traceId: currentTraceId(), parent: currentParent() }
    })
    expect(seen).toEqual({ traceId: 't1', parent: ROOT })
    expect(currentTraceId()).toBeNull()
  })

  it('runInScope(null) runs the function without a scope', () => {
    expect(runInScope(null, () => currentScope())).toBeUndefined()
  })

  it('withParent switches the parent and clears generationName; null keeps the current scope', () => {
    const child = { traceId: 't1', observationId: 'step-1' }
    runInScope({ ...SCOPE, generationName: 'llm:main' }, () => {
      withParent(child, () => {
        expect(currentParent()).toEqual(child)
        expect(currentScope()?.generationName).toBeUndefined()
      })
      withParent(null, () => {
        expect(currentParent()).toEqual(ROOT)
        expect(currentScope()?.generationName).toBe('llm:main')
      })
    })
  })

  it('withParent creates a scope even when none exists (explicit parent, e.g. delegation)', () => {
    const ref = { traceId: 't9', observationId: 'tool-1' }
    expect(withParent(ref, () => currentTraceId())).toBe('t9')
  })

  it('withGenerationName sets the name inside a scope and is a no-op without one', async () => {
    const inside = runInScope(SCOPE, () =>
      withGenerationName('llm:reflect:judge', () => currentScope()),
    )
    expect(inside).toEqual({ ...SCOPE, generationName: 'llm:reflect:judge' })
    expect(withGenerationName('llm:x', () => currentScope())).toBeUndefined()
  })
})
