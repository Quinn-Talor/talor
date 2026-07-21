// src/main/invest/flow.e2e.test.ts —— invest 建卡闭环端到端测试(新 schema)
//
// 走【真实工具 zod 解析 → execute → store 落库 → 读回】完整链:create → add_facts →
// set_eligibility → add_thesis → add_checkpoint → add_decision → add_review。
// 验证不被 strip、来源白名单拦截、card_id 解析、chip 可解析、读回三部分(facts/thesis/timeline)。

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { CardRepo, createCardTables } from './store'
import { createCardTools } from './tools'
import type { ToolDefinition, ToolExecuteContext, ToolErrorEnvelope } from '../tools/types'
import type { CardBundle } from '../../shared/types/invest'

const CTX = { sessionId: 'flow-s1', workspace: '/tmp' } as ToolExecuteContext

async function callViaSchema(t: ToolDefinition, rawInput: unknown): Promise<unknown> {
  const parsed = (t.zodSchema as z.ZodTypeAny).parse(rawInput)
  return (await t.execute(parsed, CTX)).output
}
function cardRefFromResultText(output: string): { id: string; code?: string } | null {
  try {
    const m = output.match(/\{[\s\S]*\}/)
    if (!m) return null
    const o = JSON.parse(m[0]) as { card_id?: string; code?: string }
    return typeof o.card_id === 'string' ? { id: o.card_id, code: o.code } : null
  } catch {
    return null
  }
}
const isEnvelope = (o: unknown): o is ToolErrorEnvelope =>
  typeof o === 'object' && o !== null && (o as ToolErrorEnvelope).__talor_error === true

const FACTS = {
  ev_pen: {
    level: 'industry',
    label: '行业渗透率',
    unit: '%',
    role: '同步',
    series: [{ value: '42%', as_of: '2026-03', source: '中汽协', tier: 'T1' }],
  },
  co_share: {
    level: 'company',
    label: '公司份额',
    unit: '%',
    role: '同步',
    series: [{ value: '16%', as_of: '2025-12', source: '乘联会', tier: 'T1' }],
  },
  inventory: {
    level: 'company',
    label: '存货',
    unit: '亿元',
    role: '排雷',
    series: [
      {
        value: '320亿',
        as_of: '2026-03',
        source: '巨潮:附注',
        tier: 'T1',
        change: { yoy: '+18%', turnover_days: 58, turnover_trend: '52→58·放缓' },
        structure: {
          note: '产成品激增',
          quality: 'deteriorating',
          components: [{ name: '产成品', value: '170亿', signal: 'bad' }],
        },
      },
    ],
  },
}
const SNAPSHOT = {
  v: 1,
  at: '2026-03-31',
  scope: '建立',
  claim: '政策让电车多卖,比亚迪成本低抢份额 → 赚钱',
  profit_type: '成长',
  valuation: {
    method: 'pe',
    method_reason: '成长股→PE',
    assumptions: [
      {
        key: 'co_share',
        label: '公司份额',
        unit: '%',
        anchor: { fact: 'co_share', as_of: '2025-12' },
        forecast: { mode: 'delta', bear: -1, base: 0, bull: 1, horizon: '2026-annual' }, // 命门基于事实推导
        verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' }],
        logic: '成本护城河',
        falsify_if: '连2季<14%',
        step: { order: 1, out: 'V' }, // 声明 step → 可算(灭黑盒);net_margin 留定性支撑
      },
      {
        key: 'net_margin',
        label: '净利率',
        unit: '%',
        forecast: { mode: 'absolute', bear: 8, base: 9, bull: 10 },
      },
    ],
    V: { bear: 210, base: 290, bull: 380 },
    margin_of_safety: { required: 0.25, anchor: 'bear', required_basis: '区间宽' },
  },
  challenge: {
    output: {
      target: 'thesis',
      weakest_assumption: 'co_share',
      refutation: 'r',
      suggested_verdict: '维持',
      severity: 'mid',
    },
    adjudication: { verdict: 'reject', note: 'n' },
  },
}
const CHECKPOINT = {
  type: '复查',
  at: '2026-04-30',
  against_v: 1,
  validity: '校准',
  conviction: 'mid',
  checks: [
    {
      metric: 'co_share',
      predicted_value: '16%',
      actual_value: '15%',
      actual_as_of: '2026-04',
      deviation: { 数值: '-1pp', 结构: '以量补价', 变化: '减速' },
      outcome: '偏离',
      attribution: { cause: '补贴空窗', type: '外生' },
    },
  ],
  value_now: {
    V: { bear: 210, base: 265, bull: 350 },
    price: 218,
    realized_pct: 0.25,
    margin_of_safety: { to_bear: '+4%', vs_required: '达标', at_buy_point: true },
  },
  gate: { state: '通行', reason: [] },
  spawned_v: 2, // validity=校准 → 须出新版本(CALIBRATE_NO_SPAWN)
  signal: { verdict: '买', reason: '边际达标' },
  challenge: {
    output: {
      target: 'checkpoint',
      weakest_assumption: 'co_share',
      refutation: 'r',
      suggested_verdict: '维持',
      severity: 'mid',
    },
    adjudication: { verdict: 'reject', note: 'n' },
  },
}

describe('invest 建卡闭环 e2e(新)', () => {
  let byName: Record<string, ToolDefinition>
  beforeEach(() => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    createCardTables(db)
    // 固定 clock:新鲜度硬闸(命门 co_share 锚@2025-12)比 as_of vs 此;2025-12+1 月 → 1 月龄在窗内,确定性。
    const store = new CardRepo(db, () => new Date('2026-01-15'))
    byName = Object.fromEntries(createCardTools(store).map((t) => [t.name, t]))
  })

  it('完整流程: create → add_facts → set_eligibility → add_thesis → add_checkpoint → add_decision → 读回不丢', async () => {
    // 1. 建卡 + chip 可解析
    const created = (await callViaSchema(byName.create_card, {
      code: '002594',
      name: '比亚迪',
    })) as { card_id: string; code: string }
    expect(created.card_id).toMatch(/^002594-/)
    expect(cardRefFromResultText(JSON.stringify(created))?.id).toBe(created.card_id)
    const cid = created.card_id

    // 2. 事实(zod 不 strip change/structure/role)
    const f = (await callViaSchema(byName.add_facts, { card_id: cid, facts: FACTS })) as {
      checkpoints: number
    }
    expect(isEnvelope(f)).toBe(false)

    // 3. 资格赛
    await callViaSchema(byName.set_eligibility, {
      card_id: cid,
      eligibility: { red_flags: 0, source_positive: true, in_circle: true, pass: true },
    })

    // 4. 逻辑 v1
    const t = (await callViaSchema(byName.add_thesis, { card_id: cid, snapshot: SNAPSHOT })) as {
      versions: number
    }
    expect(t.versions).toBe(1)

    // 5. 复查
    await callViaSchema(byName.add_checkpoint, { card_id: cid, checkpoint: CHECKPOINT })

    // 6. 决策(gate 通行 + at_buy_point → 建仓放行)
    const dec = (await callViaSchema(byName.add_decision, {
      card_id: cid,
      decision: {
        type: '决策',
        at: '2026-05-10',
        trade: '建',
        price: 218,
        weight: 0.05,
        reason: '边际达标,命门holding',
      },
    })) as { status: string }
    expect(dec.status).toBe('held')

    // 7. 读回:三部分齐全,facts 三维不丢
    const bundle = (await callViaSchema(byName.get_card, { card_id: cid })) as CardBundle
    expect(bundle.facts.inventory.series[0].structure?.quality).toBe('deteriorating')
    expect(bundle.facts.inventory.series[0].change?.turnover_days).toBe(58)
    expect(bundle.thesis?.versions).toHaveLength(1)
    expect(bundle.thesis?.current).toBe(1)
    expect(bundle.eligibility?.pass).toBe(true)
    expect(bundle.timeline.filter((e) => e.type === '复查')).toHaveLength(1)
    expect(bundle.timeline.filter((e) => e.type === '决策')).toHaveLength(1)
  })

  it('add_facts 非白名单源 → 信封(不上抛)', async () => {
    const c = (await callViaSchema(byName.create_card, { code: '1', name: 'x' })) as {
      card_id: string
    }
    const bad = await callViaSchema(byName.add_facts, {
      card_id: c.card_id,
      facts: {
        k: {
          level: 'company',
          label: 'k',
          series: [{ value: '1', as_of: '2026-03', source: '某公众号' }],
        },
      },
    })
    expect(isEnvelope(bad)).toBe(true)
    expect((bad as ToolErrorEnvelope).code).toBe('FACT_SOURCE_UNTRUSTED')
  })

  it('card_id 传股票代码也解析到本会话卡', async () => {
    await callViaSchema(byName.create_card, { code: '300750', name: '宁德' })
    const r = (await callViaSchema(byName.add_facts, { card_id: '300750.SZ', facts: FACTS })) as {
      code: string
    }
    expect(isEnvelope(r)).toBe(false)
    expect(r.code).toBe('300750')
  })
})
