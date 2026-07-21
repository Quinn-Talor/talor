// src/main/invest/cross-industry.test.ts —— 跨行业验证:新 schema + 配模式能吃下各类行业
//
// 不同行业 → 不同 method(pe/pb-roe/ddm/nav)+ 不同行业特殊 key(NIM/产品价/分红/储量),
// 走真实 store.apply(create→addFacts→setEligibility→addThesisVersion→addCheckpoint→addDecision)
// 验证:六不变量放行有效数据、配模式落库、命门 ref 行业特殊 key、双闸放行。

import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { CardRepo, createCardTables } from './store'
import type {
  Facts,
  ThesisSnapshot,
  Checkpoint,
  ValuationMethod,
  ProfitType,
} from '../../shared/types/invest'

// 固定 clock:新鲜度硬闸(命门锚)比 as_of vs 此时钟。取最新命门锚(backlog@2026-03)+1 月;
// 其余命门锚 2025-12(季频窗 5)此时 4 月龄,仍在窗内 → 确定性、不随真时钟漂移。
const CLOCK = () => new Date('2026-04-15')

function repo(): CardRepo {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  createCardTables(db)
  return new CardRepo(db, CLOCK)
}

interface IndustryFixture {
  industry: string
  code: string
  name: string
  method: ValuationMethod
  profit: ProfitType
  facts: Facts // 含行业特殊 key
  driver: { metric: string; anchor: string; basisKey: string } // 命门 ref 行业特殊 key
}

// 五大行业各一只代表股,配各自的 method 与行业特殊 key
const FIXTURES: IndustryFixture[] = [
  {
    industry: '科技成长',
    code: '300308',
    name: '中际旭创',
    method: 'pe',
    profit: '成长',
    facts: {
      backlog: {
        level: 'company',
        label: '在手订单',
        unit: '亿',
        role: '先行',
        series: [{ value: '200亿', as_of: '2026-03', source: '巨潮:公告' }],
      },
      eps: {
        level: 'company',
        label: 'EPS',
        unit: '元',
        role: '滞后',
        series: [{ value: '10.7', as_of: '2026-03', source: '巨潮:年报' }],
      },
    },
    driver: { metric: '在手订单兑现', anchor: 'CPO 800G 放量', basisKey: 'backlog' },
  },
  {
    industry: '周期',
    code: '600585',
    name: '海螺水泥',
    method: 'pb-roe',
    profit: '周期',
    facts: {
      product_price: {
        level: 'industry',
        label: '水泥均价',
        unit: '元/吨',
        role: '先行',
        series: [{ value: '320元', as_of: '2026-03', source: '券商研报' }],
      },
      normalized_roe: {
        level: 'company',
        label: '正常化ROE',
        unit: '%',
        role: '同步',
        series: [{ value: '12%', as_of: '2025-12', source: '巨潮:年报' }],
      },
      bvps: {
        level: 'company',
        label: '每股净资产',
        unit: '元',
        role: '同步',
        series: [{ value: '38', as_of: '2025-12', source: '巨潮:年报' }],
      },
    },
    driver: { metric: '正常化ROE', anchor: '供给出清→价格反转', basisKey: 'normalized_roe' },
  },
  {
    industry: '金融',
    code: '600036',
    name: '招商银行',
    method: 'pb-roe',
    profit: '估值修复',
    facts: {
      nim: {
        level: 'company',
        label: '净息差',
        unit: '%',
        role: '同步',
        series: [{ value: '2.1%', as_of: '2025-12', source: '巨潮:年报' }],
      },
      npl: {
        level: 'company',
        label: '不良率',
        unit: '%',
        role: '排雷',
        series: [{ value: '0.95%', as_of: '2025-12', source: '巨潮:年报' }],
      },
      bvps: {
        level: 'company',
        label: '每股净资产',
        unit: '元',
        role: '同步',
        series: [{ value: '36', as_of: '2025-12', source: '巨潮:年报' }],
      },
    },
    driver: { metric: '净息差企稳', anchor: '零售护城河+低负债成本', basisKey: 'nim' },
  },
  {
    industry: '高分红',
    code: '600900',
    name: '长江电力',
    method: 'ddm',
    profit: '分红',
    facts: {
      dps: {
        level: 'company',
        label: '每股分红',
        unit: '元',
        role: '同步',
        series: [{ value: '0.92', as_of: '2025-12', source: '巨潮:公告' }],
      },
      payout: {
        level: 'company',
        label: '分红率',
        unit: '%',
        role: '同步',
        series: [{ value: '70%', as_of: '2025-12', source: '巨潮:年报' }],
      },
    },
    driver: { metric: '分红可持续', anchor: '水电稳定现金流+低维护资本开支', basisKey: 'dps' },
  },
  {
    industry: '资源',
    code: '601899',
    name: '紫金矿业',
    method: 'nav',
    profit: '周期',
    facts: {
      reserves: {
        level: 'company',
        label: '黄金储量',
        unit: '吨',
        role: '同步',
        series: [{ value: '3000吨', as_of: '2025-12', source: '巨潮:年报' }],
      },
      gold_price: {
        level: 'industry',
        label: '金价',
        unit: '元/克',
        role: '先行',
        series: [{ value: '560', as_of: '2026-03', source: '上海黄金交易所' }],
      },
    },
    driver: { metric: '储量重估', anchor: '金价上行+并购扩储', basisKey: 'reserves' },
  },
]

const snapshot = (f: IndustryFixture): ThesisSnapshot => {
  // 命门基于事实推导:factor 挂行业 basis 事实(单位/基线取自该事实 → 过 Guard 2a/2b);
  // 声明 step → 引擎折叠出 V(灭黑盒:各 method 都须可算)。
  const basis = f.facts[f.driver.basisKey]!
  const basisAsOf = basis.series[basis.series.length - 1].as_of
  return {
    v: 1,
    at: '2026-03-31',
    scope: '建立',
    claim: `${f.name}(${f.industry})逻辑`,
    profit_type: f.profit,
    valuation: {
      method: f.method,
      assumptions: [
        {
          key: f.driver.basisKey,
          label: f.driver.metric,
          unit: basis.unit, // 同锚事实单位(Guard 2b)
          anchor: { fact: f.driver.basisKey, as_of: basisAsOf },
          forecast: { mode: 'factor', bear: 0.9, base: 1.0, bull: 1.1 }, // 锚 × 倍数(基于事实)
          verify: [{ fact: f.driver.basisKey, at: 'quarterly', role: '终验' }],
          logic: f.driver.anchor,
          falsify_if: '逻辑红线',
          step: { order: 1, out: 'V' },
        },
      ],
      V: { bear: 80, base: 100, bull: 120 },
      margin_of_safety: { required: 0.2, anchor: 'bear' },
    },
    challenge: {
      output: {
        target: 'thesis',
        weakest_assumption: f.driver.basisKey,
        refutation: 'r',
        suggested_verdict: '维持',
        severity: 'mid',
      },
      adjudication: { verdict: 'reject', note: 'n' },
    },
  }
}

const checkpoint = (against_v = 1, basisKey = 'x'): Checkpoint => ({
  type: '复查',
  at: '2026-04-30',
  against_v,
  validity: '持有',
  conviction: 'mid',
  checks: [{ metric: basisKey, predicted_value: '2', actual_value: '2', outcome: '容差' }],
  value_now: {
    V: { bear: 80, base: 100, bull: 120 },
    price: 78,
    margin_of_safety: { at_buy_point: true },
  },
  gate: { state: '通行' },
  spawned_v: null,
  signal: { verdict: '买', reason: '边际达标' },
  challenge: {
    output: {
      target: 'checkpoint',
      weakest_assumption: basisKey,
      refutation: 'r',
      suggested_verdict: '维持',
      severity: 'mid',
    },
    adjudication: { verdict: 'reject', note: 'n' },
  },
})

describe('跨行业验证(新 schema + 配模式)', () => {
  it.each(FIXTURES)('$industry($name) 用 $method:全链路落库不报错', (f) => {
    const store = repo()
    const c = store.apply({ kind: 'create', code: f.code, name: f.name, originSessionId: 's' })
    store.apply({ kind: 'addFacts', id: c.id, facts: f.facts })
    store.apply({
      kind: 'setEligibility',
      id: c.id,
      eligibility: { red_flags: 0, source_positive: true, in_circle: true, pass: true },
    })
    store.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot(f) })
    store.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint() })
    const bundle = store.apply({
      kind: 'addDecision',
      id: c.id,
      decision: { type: '决策', at: '2026-05-01', trade: '建', price: 78, reason: '边际达标' },
    })

    // 配模式:method 落对
    const cur = bundle.thesis!.versions.find((v) => v.v === bundle.thesis!.current)!
    expect(cur.valuation.method).toBe(f.method)
    // 命门 ref 行业特殊 key(立足事实在场)
    expect(bundle.facts[f.driver.basisKey]).toBeDefined()
    // 双闸放行 → 持仓
    expect(bundle.head.status).toBe('held')
    // 时间线齐(复查+决策)
    expect(bundle.timeline.filter((e) => e.type === '复查')).toHaveLength(1)
    expect(bundle.timeline.filter((e) => e.type === '决策')).toHaveLength(1)
  })

  it('五行业覆盖五种 method(pe/pb-roe×2/ddm/nav)', () => {
    const methods = FIXTURES.map((f) => f.method)
    expect(new Set(methods)).toEqual(new Set(['pe', 'pb-roe', 'ddm', 'nav']))
  })
})
