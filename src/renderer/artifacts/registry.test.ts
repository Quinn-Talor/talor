import { describe, it, expect } from 'vitest'
import { ArtifactUIRegistry, type ArtifactUI } from './registry'

const ui = (type: string): ArtifactUI => ({ type, Panel: () => null })

describe('ArtifactUIRegistry', () => {
  it('register + get + all', () => {
    const reg = new ArtifactUIRegistry()
    reg.register(ui('stock_card'))
    reg.register(ui('robot'))
    expect(reg.get('stock_card')?.type).toBe('stock_card')
    expect(reg.get('missing')).toBeUndefined()
    expect(reg.all().map((u) => u.type)).toEqual(['stock_card', 'robot'])
  })

  it('重复 type 注册 → 抛错', () => {
    const reg = new ArtifactUIRegistry()
    reg.register(ui('stock_card'))
    expect(() => reg.register(ui('stock_card'))).toThrow(/already registered/)
  })
})
