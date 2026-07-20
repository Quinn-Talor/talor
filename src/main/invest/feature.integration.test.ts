// src/main/invest/feature.integration.test.ts —— 后端端到端功能测试
//
// 走真路径:真 SQLite(better-sqlite3 :memory:)→ 真 store 写入闸门 → investFeatureMain
// 装配 → 平台 ArtifactReaderRegistry 路由 → 断言 UI 将取到的 artifact:list / artifact:read
// 载荷。含写入闸门反例(非法写被挡)。这是"真 IPC+SQLite 端到端"的后端半。
//
// 前端半见 renderer/invest/workspace.integration.test.tsx(同一 CardSummary/CardBundle 契约)。

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { investFeatureMain, getInvestStore } from './feature'
import { CardValidationError, type CardRepo } from './store'
import { ArtifactReaderRegistry } from '../features/artifact-readers'
import type {
  Eligibility,
  Facts,
  ThesisSnapshot,
  Checkpoint,
  DecisionEvent,
  ReviewEvent,
  CardSummary,
  CardBundle,
} from '@shared/types/invest'

// —— 复用 store.test 同款已验证 fixtures ——
const facts = (): Facts => ({
  ev_pen: {
    level: 'industry',
    label: '渗透率',
    unit: '%',
    series: [{ value: '42%', as_of: '2026-03', source: '中汽协', tier: 'T1' }],
  },
  co_share: {
    level: 'company',
    label: '份额',
    unit: '%',
    series: [{ value: '16%', as_of: '2025-12', source: '乘联会', tier: 'T1' }],
  },
})
const snapshot = (): ThesisSnapshot => ({
  v: 1,
  at: '2026-03-31',
  scope: '建立',
  claim: '政策驱动+护城河,EPS CAGR 20%',
  profit_type: '成长',
  valuation: {
    method: 'pe',
    assumptions: [
      {
        key: 'co_share',
        label: '公司份额',
        unit: '%',
        anchor: { fact: 'co_share', as_of: '2025-12' },
        forecast: { mode: 'delta', bear: -1, base: 0, bull: 1, horizon: '2026-annual' },
        verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' }],
        logic: '成本护城河',
        falsify_if: '连2季<14%',
        step: { order: 1, out: 'V' },
      },
    ],
    V: { bear: 210, base: 290, bull: 380 },
    margin_of_safety: { required: 0.2, anchor: 'bear' },
  },
})
const checkpoint = (): Checkpoint => ({
  type: '复查',
  at: '2026-04-30',
  against_v: 1,
  validity: '持有',
  conviction: 'mid',
  checks: [{ metric: 'co_share', predicted_value: '16%', actual_value: '15%', outcome: '容差' }],
  value_now: {
    V: { bear: 210, base: 265, bull: 350 },
    price: 255,
    margin_of_safety: { at_buy_point: true },
  },
  gate: { state: '通行' },
  spawned_v: null,
  signal: { verdict: '等', reason: 'r' },
})
const decision = (): DecisionEvent => ({
  type: '决策',
  at: '2026-05-01',
  trade: '建',
  reason: '进安全边际',
  based_v: 1,
  weight: 0.1,
})
const review = (): ReviewEvent => ({
  type: '复盘',
  at: '2026-06-30',
  vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
  lesson: '风向顺+alpha 对',
  ref_v: 1,
})
const elig = (): Eligibility => ({
  red_flags: 0,
  source_positive: true,
  in_circle: true,
  pass: true,
})

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
    throw new Error('should have thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(CardValidationError)
    expect((e as CardValidationError).code).toBe(code)
  }
}

describe('invest 后端端到端(真 SQLite → 闸门 → feature → 平台 registry)', () => {
  let store: CardRepo

  beforeEach(() => {
    // feature.init 建表 + 构造模块级 investStore(artifacts() 引用它)
    investFeatureMain.init({ db: new Database(':memory:') })
    store = getInvestStore()!
  })

  it('全生命周期建卡 → artifact:list / artifact:read 返回 UI 所需载荷', () => {
    // —— 建立 → 事实 → 逻辑 → 复查 → 决策 → 复盘(全程过闸门)——
    const c = store.apply({
      kind: 'create',
      code: '600519',
      name: '贵州茅台',
      originSessionId: 'sess-1',
    })
    store.apply({ kind: 'setEligibility', id: c.id, eligibility: elig() })
    store.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    store.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    store.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint() })
    store.apply({ kind: 'addDecision', id: c.id, decision: decision() })
    store.apply({ kind: 'addReview', id: c.id, review: review() })

    // —— 平台通用读口(即 ipcMain artifact:read/list 调的同一批函数)——
    const reg = new ArtifactReaderRegistry()
    for (const a of investFeatureMain.artifacts!()) reg.register(a)

    // 池子(artifact:list)
    const list = reg.list('stock_card') as CardSummary[]
    expect(list).toHaveLength(1)
    const s = list[0]
    expect(s.code).toBe('600519')
    expect(s.name).toBe('贵州茅台')
    expect(s.claim).toBe('政策驱动+护城河,EPS CAGR 20%') // 当前逻辑一句话
    expect(s.validity).toBe('持有') // 最新复查
    expect(s.profit_type).toBe('成长')
    expect(s.status).toBe('held') // 建仓后
    expect(s.origin_session_id).toBe('sess-1') // 供分析过程取会话

    // 案卷(artifact:read)—— 活论文/时光机所需三区俱全
    const b = reg.read('stock_card', c.id) as CardBundle
    expect(b.head.code).toBe('600519')
    expect(b.eligibility?.pass).toBe(true)
    expect(b.facts.co_share.series.at(-1)?.value).toBe('16%')
    expect(b.thesis?.versions[0].claim).toBe('政策驱动+护城河,EPS CAGR 20%')
    const kinds = b.timeline.map((e) => e.type).sort()
    expect(kinds).toEqual(['决策', '复查', '复盘']) // 时光机三类节点齐(按码点序)

    // 未知 id / 未知 type 优雅降级
    expect(reg.read('stock_card', 'nope')).toBeNull()
    expect(reg.list('unknown_type')).toEqual([])
  })

  it('写入闸门反例:无复查直接建仓 → NO_CHECKPOINT(非法写被真路径挡下)', () => {
    const c = store.apply({
      kind: 'create',
      code: '000001',
      name: '平安',
      originSessionId: 'sess-2',
    })
    store.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    store.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    // 未复查即建仓 —— 决策时效闸拦截
    expectCode(
      () => store.apply({ kind: 'addDecision', id: c.id, decision: decision() }),
      'NO_CHECKPOINT',
    )
    // 该非法决策未落盘:时间线只有 (无 —— 决策被挡)
    const b = store.apply({ kind: 'addFacts', id: c.id, facts: facts() }) // 读回
    expect(b.timeline.filter((e) => e.type === '决策')).toHaveLength(0)
  })
})
