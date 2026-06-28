import { describe, it, expect } from 'vitest'
import { ArtifactReaderRegistry } from './artifact-readers'

describe('ArtifactReaderRegistry', () => {
  it('按 type 注册 + 路由 read', () => {
    const r = new ArtifactReaderRegistry()
    r.register({ type: 'stock_card', read: (id) => ({ id }) })
    expect(r.read('stock_card', 'x')).toEqual({ id: 'x' })
  })

  it('未注册的 type → null', () => {
    const r = new ArtifactReaderRegistry()
    expect(r.read('unknown', 'x')).toBeNull()
  })

  it('同 type 重复注册 → 抛(防覆盖)', () => {
    const r = new ArtifactReaderRegistry()
    r.register({ type: 'stock_card', read: () => null })
    expect(() => r.register({ type: 'stock_card', read: () => null })).toThrow(/already registered/)
  })
})
