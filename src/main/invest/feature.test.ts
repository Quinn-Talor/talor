import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { investFeatureMain, getInvestStore } from './feature'

function freshInit() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  investFeatureMain.init({ db })
}

describe('investFeatureMain (TalorFeatureMain 契约)', () => {
  it('id = invest, 声明 Playwright mcpDep', () => {
    expect(investFeatureMain.id).toBe('invest')
    expect(investFeatureMain.mcpDeps?.()).toEqual([
      { name: 'Playwright', hint: expect.stringContaining('检索') },
    ])
  })

  it('init: 建表 + 构造 store(read 可用)', () => {
    freshInit()
    const store = getInvestStore()!
    expect(store).not.toBeNull()
    expect(store.read('nope')).toBeNull()
    const b = store.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    expect(store.read(b.id)?.head.code).toBe('1')
  })

  it('agents(): 返回 5 个 FeatureAgent,每个带全部 23 invest 工具', () => {
    freshInit()
    const agents = investFeatureMain.agents?.() ?? []
    expect(agents.map((a) => a.profile.id)).toEqual(
      expect.arrayContaining([
        'stock-research',
        'stock-specialist',
        'industry-research',
        'macro-research',
        'review-analyst',
      ]),
    )
    expect(agents[0].tools).toHaveLength(23)
    expect(agents[0].tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(['create_card', 'compute_macro_clock', 'add_thesis']),
    )
  })

  it('artifacts(): 声明 stock_card 读口,read(id) 取 CardBundle', () => {
    freshInit()
    const b = getInvestStore()!.apply({
      kind: 'create',
      code: '600519',
      name: '茅台',
      originSessionId: 's',
    })
    const arts = investFeatureMain.artifacts?.() ?? []
    expect(arts.map((a) => a.type)).toEqual(['stock_card'])
    const read = arts[0].read(b.id) as { head: { code: string } } | null
    expect(read?.head.code).toBe('600519')
    expect(arts[0].read('nope')).toBeNull()
  })
})
