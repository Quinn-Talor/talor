import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createCardTools } from './card-tools'
import { CardRepo, createCardTables } from '../store'
import type { ToolDefinition, ToolExecuteContext, ToolErrorEnvelope } from '../../tools/types'
import type { Facts, ThesisSnapshot } from '../../../shared/types/invest'

const CTX = { sessionId: 's1', workspace: '/tmp' } as ToolExecuteContext
type Summary = {
  card_id: string
  code: string
  name: string
  status: string
  versions: number
  checkpoints: number
}

function tools(): { store: CardRepo; byName: Record<string, ToolDefinition> } {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  createCardTables(db)
  const store = new CardRepo(db)
  const byName = Object.fromEntries(createCardTools(store).map((t) => [t.name, t]))
  return { store, byName }
}
async function call(t: ToolDefinition, input: unknown, ctx = CTX): Promise<unknown> {
  return (await t.execute(input, ctx)).output
}
const isEnvelope = (o: unknown): o is ToolErrorEnvelope =>
  typeof o === 'object' && o !== null && (o as ToolErrorEnvelope).__talor_error === true

const facts: Facts = {
  co_share: {
    level: 'company',
    label: '份额',
    unit: '%',
    series: [{ value: '16%', as_of: '2025-12', source: '乘联会' }],
  },
}
const snapshot: ThesisSnapshot = {
  v: 1,
  at: '2026-03-31',
  scope: '建立',
  claim: 'c',
  profit_type: '成长',
  valuation: {
    method: 'pe',
    assumptions: [
      {
        key: 'co_share',
        label: '份额',
        base: 16,
        bear: 15,
        bull: 17,
        from_fact: 'co_share@2025-12',
        verify: [{ fact: 'co_share', at: 'quarterly' }],
        sensitivity: 'high',
        logic_anchor: '护城河',
        falsify: '<14%',
      },
    ],
    V: { bear: 210, base: 290, bull: 380 },
    margin_of_safety: { required: 0.2 },
  },
}

describe('card-tools (新)', () => {
  let store: CardRepo
  let byName: Record<string, ToolDefinition>
  beforeEach(() => {
    ;({ store, byName } = tools())
  })

  it('返回 9 个工具,名称齐全', () => {
    expect(Object.keys(byName).sort()).toEqual(
      [
        'create_card',
        'get_card',
        'set_eligibility',
        'add_facts',
        'add_thesis',
        'add_checkpoint',
        'add_decision',
        'add_review',
        'get_timeline',
      ].sort(),
    )
  })

  it('create_card: 从 ctx.sessionId 取 origin', async () => {
    const out = (await call(byName.create_card, { code: '300308', name: '中际旭创' })) as Summary
    expect(out.card_id).toMatch(/^300308-/)
    expect(store.read(out.card_id)?.head.origin_session_id).toBe('s1')
  })

  it('建卡闭环: add_facts → add_thesis(versions=1)', async () => {
    const c = (await call(byName.create_card, { code: '1', name: 'x' })) as Summary
    await call(byName.add_facts, { card_id: c.card_id, facts })
    const r = (await call(byName.add_thesis, { card_id: c.card_id, snapshot })) as Summary
    expect(isEnvelope(r)).toBe(false)
    expect(r.versions).toBe(1)
  })

  it('add_facts 非白名单源 → FACT_SOURCE_UNTRUSTED 信封(不上抛)', async () => {
    const c = (await call(byName.create_card, { code: '1', name: 'x' })) as Summary
    const bad = await call(byName.add_facts, {
      card_id: c.card_id,
      facts: {
        k: {
          level: 'company',
          label: 'k',
          series: [{ value: '1', as_of: '2026-03', source: '雪球' }],
        },
      },
    })
    expect(isEnvelope(bad)).toBe(true)
    expect((bad as ToolErrorEnvelope).code).toBe('FACT_SOURCE_UNTRUSTED')
  })

  it('add_thesis 立足事实不存在 → FACT_REFERENCED_MISSING', async () => {
    const c = (await call(byName.create_card, { code: '1', name: 'x' })) as Summary
    await call(byName.add_facts, { card_id: c.card_id, facts })
    const bad = await call(byName.add_thesis, {
      card_id: c.card_id,
      snapshot: {
        ...snapshot,
        valuation: {
          ...snapshot.valuation,
          assumptions: [{ ...snapshot.valuation.assumptions[0], from_fact: 'nope@2025-12' }],
        },
      },
    })
    expect((bad as ToolErrorEnvelope).code).toBe('FACT_REFERENCED_MISSING')
  })

  it('card_id 传股票代码(非 UUID)解析到本会话卡', async () => {
    await call(byName.create_card, { code: '002594', name: '比亚迪' })
    const r = (await call(byName.add_facts, { card_id: '002594.SZ', facts })) as Summary
    expect(isEnvelope(r)).toBe(false)
    expect(r.code).toBe('002594')
  })

  it('card_id 既非 id 也非本会话标的 → CARD_NOT_FOUND', async () => {
    const out = await call(byName.add_facts, { card_id: '999999', facts })
    expect((out as ToolErrorEnvelope).code).toBe('CARD_NOT_FOUND')
  })

  it('S3: create_card origin 取根会话(委托子会话上溯)', async () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    createCardTables(db)
    const s = new CardRepo(db)
    const t = Object.fromEntries(
      createCardTools(s, (sid) => (sid === 'child' ? 'root' : sid)).map((x) => [x.name, x]),
    )
    const out = (await call(t.create_card, { code: '1', name: 'x' }, {
      sessionId: 'child',
      workspace: '/tmp',
    } as ToolExecuteContext)) as Summary
    expect(s.read(out.card_id)?.head.origin_session_id).toBe('root')
  })
})
