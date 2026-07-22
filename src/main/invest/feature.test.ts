import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { investFeatureMain, getInvestStore } from './feature'
import type { ToolExecuteContext } from '../tools/types'

function freshInit() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  investFeatureMain.init({ db })
}

describe('investFeatureMain (TalorFeatureMain 契约)', () => {
  it('id = invest, 声明 Playwright mcpDep(通用数值走内置 fetch_metric)', () => {
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

  it('agents(): 5 个 FeatureAgent,工具按角色收窄真相库写权限(受限盒子)', () => {
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
    const byId = (id: string) => agents.find((a) => a.profile.id === id)!
    const names = (id: string) => byId(id).tools?.map((t) => t.name) ?? []
    const WRITE = [
      'create_card',
      'set_eligibility',
      'add_facts',
      'add_thesis',
      'add_checkpoint',
      'add_decision',
      'add_review',
    ]

    // 主 agent:全 25 —— 建立/落卡/决策/复盘全授权(+get_prior_lessons 回程读 +fetch_metric 取数)
    expect(byId('stock-research').tools).toHaveLength(25)
    expect(names('stock-research')).toEqual(expect.arrayContaining(WRITE))

    // 域 specialist:调不到任何真相库写工具(spec 验收「域 specialist 调不到建卡工具」);
    // compute + 读卡保留(自发现不受影响)
    for (const id of ['stock-specialist', 'industry-research', 'macro-research']) {
      expect(byId(id).tools).toHaveLength(18)
      const n = names(id)
      for (const w of WRITE) expect(n).not.toContain(w)
      expect(n).toEqual(
        expect.arrayContaining(['get_card', 'get_timeline', 'compute_macro_clock', 'fetch_metric']),
      )
    }

    // 复盘:只读历史 + 唯一写口 add_review;调不到建卡/决策
    expect(byId('review-analyst').tools).toHaveLength(19)
    const rv = names('review-analyst')
    expect(rv).toContain('add_review')
    expect(rv).toEqual(expect.arrayContaining(['get_card', 'get_timeline']))
    expect(rv).not.toContain('create_card')
    expect(rv).not.toContain('add_decision')
    expect(rv).not.toContain('add_thesis')
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

  it('(AC-002) FeatureInitCtx.callMcp 透传到 fetch_metric(走 MCP,不落 json→无网络)', async () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const calls: string[] = []
    // 返回匹配 registry mcp 通道 valueField/asOfField 的数据 → mcp 命中,不回落 json(零网络)
    const callMcp = async (tool: string): Promise<unknown> => {
      calls.push(tool)
      return { TOTALOPERATEREVETZ: 5, end_date: '2026-03-31' }
    }
    investFeatureMain.init({ db, callMcp })
    const fm = (investFeatureMain.agents?.() ?? [])
      .find((a) => a.profile.id === 'stock-research')!
      .tools!.find((t) => t.name === 'fetch_metric')!
    const out = (
      await fm.execute({ code: '300308', metric_key: 'rev_yoy' }, {
        sessionId: 's',
        workspace: '',
      } as ToolExecuteContext)
    ).output as { tier?: string; provenance?: { method?: string } }
    expect(calls).toContain('financial.report') // callMcp 被调 → 已透传注入
    expect(out.tier).toBe('T1') // mcp 通道命中 → T1(未落 json)
    expect(out.provenance?.method).toBe('fetch')
  })
})
