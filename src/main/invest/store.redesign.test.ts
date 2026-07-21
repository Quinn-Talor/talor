// src/main/invest/store.redesign.test.ts —— Phase 1 新不变量:空方 gate / 薄守卫 / 命门锚可信闸 / ref_v / get_prior_lessons
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { CardRepo, createCardTables, CardValidationError } from './store'
import type {
  ThesisSnapshot,
  Checkpoint,
  Facts,
  ThesisChallenge,
  Cadence,
} from '@shared/types/invest'

// 固定 clock:新鲜度硬闸比 as_of vs 此;fixtures 用 2026-03(距 4 月,在季度窗 5 内)→ 确定性、不随真时钟漂移
const CLOCK = () => new Date('2026-07-01')
let store: CardRepo
beforeEach(() => {
  const db = new Database(':memory:')
  createCardTables(db)
  store = new CardRepo(db, CLOCK)
})

const THESIS_CHALLENGE: ThesisChallenge = {
  output: {
    target: 'thesis',
    weakest_assumption: 'co_share',
    refutation: '现价已隐含过高份额',
    suggested_verdict: '维持',
    severity: 'mid',
  },
  adjudication: { verdict: 'reject', note: '先行销量仍支撑' },
}
const CP_CHALLENGE: ThesisChallenge = {
  output: { ...THESIS_CHALLENGE.output, target: 'checkpoint' },
  adjudication: { verdict: 'reject', note: 'n' },
}

function facts(tier: 'T1' | 'T2' | 'T3' = 'T1', crossed = false): Facts {
  const series =
    tier === 'T2' && crossed
      ? [
          { value: '16%', as_of: '2026-03', source: '中信研报', tier: 'T2' as const },
          { value: '16%', as_of: '2026-03', source: '华泰研报', tier: 'T2' as const },
        ]
      : [{ value: '16%', as_of: '2026-03', source: tier === 'T3' ? '券商研报' : '乘联会', tier }]
  return { co_share: { level: 'company', label: '份额', unit: '%', series } }
}

function baseSnap(over: Partial<ThesisSnapshot> = {}): ThesisSnapshot {
  return {
    v: 1,
    at: '2026-03',
    scope: '建立',
    claim: '份额抢占',
    profit_type: '成长',
    valuation: {
      method: 'pe',
      assumptions: [
        {
          key: 'co_share',
          label: '份额',
          unit: '%',
          anchor: { fact: 'co_share', as_of: '2026-03' },
          forecast: { mode: 'delta', bear: -1, base: 0, bull: 1, horizon: '2026-annual' },
          logic: '成本护城河→份额',
          falsify_if: '连2季<14%',
          verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' }],
          step: { order: 1, out: 'V' },
        },
      ],
      V: { bear: 13, base: 14, bull: 15 },
      margin_of_safety: { required: 0.2, anchor: 'bear' },
    },
    challenge: THESIS_CHALLENGE,
    ...over,
  }
}

function baseCheckpoint(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    type: '复查',
    at: '2026-07',
    against_v: 1,
    validity: '持有',
    checks: [],
    value_now: { V: { bear: 13, base: 14, bull: 15 }, margin_of_safety: { at_buy_point: true } },
    gate: { state: '通行' },
    spawned_v: null,
    signal: { verdict: '等', reason: 'r' },
    challenge: CP_CHALLENGE,
    ...over,
  }
}

function seed(tier: 'T1' | 'T2' | 'T3' = 'T1', crossed = false, code = '002594'): string {
  const c = store.apply({ kind: 'create', code, name: '比亚迪', originSessionId: 's1' })
  store.apply({ kind: 'addFacts', id: c.id, facts: facts(tier, crossed) })
  return c.id
}
function seedWithThesis(): string {
  const id = seed()
  store.apply({ kind: 'addThesisVersion', id, snapshot: baseSnap() })
  return id
}
function code(e: unknown): string {
  return (e as CardValidationError).code
}

describe('空方 gate (硬校验)', () => {
  it('(no-trigger) add_thesis 带 challenge → 通过', () => {
    expect(() =>
      store.apply({ kind: 'addThesisVersion', id: seed(), snapshot: baseSnap() }),
    ).not.toThrow()
  })
  it('(trigger) add_thesis 无 challenge → THESIS_NO_CHALLENGE', () => {
    const snap = baseSnap()
    delete (snap as { challenge?: unknown }).challenge
    try {
      store.apply({ kind: 'addThesisVersion', id: seed(), snapshot: snap })
      throw new Error('should throw')
    } catch (e) {
      expect(code(e)).toBe('THESIS_NO_CHALLENGE')
    }
  })
  it('(trigger) add_checkpoint 无 challenge → CHECKPOINT_NO_CHALLENGE', () => {
    const cp = baseCheckpoint()
    delete (cp as { challenge?: unknown }).challenge
    try {
      store.apply({ kind: 'addCheckpoint', id: seedWithThesis(), checkpoint: cp })
      throw new Error('should throw')
    } catch (e) {
      expect(code(e)).toBe('CHECKPOINT_NO_CHALLENGE')
    }
  })
})

describe('复查薄守卫', () => {
  it('(trigger) validity=校准 但 spawned_v=null → CALIBRATE_NO_SPAWN', () => {
    try {
      store.apply({
        kind: 'addCheckpoint',
        id: seedWithThesis(),
        checkpoint: baseCheckpoint({ validity: '校准', spawned_v: null }),
      })
      throw new Error('should throw')
    } catch (e) {
      expect(code(e)).toBe('CALIBRATE_NO_SPAWN')
    }
  })
  it('(trigger) outcome=破 但 validity=持有 → OUTCOME_VALIDITY_MISMATCH', () => {
    const cp = baseCheckpoint({
      validity: '持有',
      checks: [{ metric: 'co_share', actual_value: '12%', outcome: '破' }],
    })
    try {
      store.apply({ kind: 'addCheckpoint', id: seedWithThesis(), checkpoint: cp })
      throw new Error('should throw')
    } catch (e) {
      expect(code(e)).toBe('OUTCOME_VALIDITY_MISMATCH')
    }
  })
  it('(no-trigger) validity=持有 + 无破 → 通过', () => {
    expect(() =>
      store.apply({ kind: 'addCheckpoint', id: seedWithThesis(), checkpoint: baseCheckpoint() }),
    ).not.toThrow()
  })
})

describe('命门锚可信硬闸', () => {
  it('(no-trigger) 命门锚 T1 → 通过', () => {
    expect(() =>
      store.apply({ kind: 'addThesisVersion', id: seed('T1'), snapshot: baseSnap() }),
    ).not.toThrow()
  })
  it('(trigger) 命门锚 T3 → ANCHOR_UNTRUSTED', () => {
    try {
      store.apply({
        kind: 'addThesisVersion',
        id: seed('T3', false, '600519'),
        snapshot: baseSnap(),
      })
      throw new Error('should throw')
    } catch (e) {
      expect(code(e)).toBe('ANCHOR_UNTRUSTED')
    }
  })
  it('(no-trigger) 命门锚 T2 + 两源交叉 → 通过', () => {
    expect(() =>
      store.apply({
        kind: 'addThesisVersion',
        id: seed('T2', true, '000001'),
        snapshot: baseSnap(),
      }),
    ).not.toThrow()
  })
})

describe('复盘 ref_v 必填', () => {
  it('(trigger) 无 ref_v → REVIEW_NO_REF_VERSION', () => {
    try {
      store.apply({
        kind: 'addReview',
        id: seedWithThesis(),
        review: {
          type: '复盘',
          at: '2026-08',
          vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
        },
      })
      throw new Error('should throw')
    } catch (e) {
      expect(code(e)).toBe('REVIEW_NO_REF_VERSION')
    }
  })
  it('(no-trigger) 带 ref_v=1 → 通过', () => {
    expect(() =>
      store.apply({
        kind: 'addReview',
        id: seedWithThesis(),
        review: {
          type: '复盘',
          at: '2026-08',
          vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
          ref_v: 1,
        },
      }),
    ).not.toThrow()
  })
})

describe('get_prior_lessons(回程边)', () => {
  it('返回同 code 卡的复盘教训', () => {
    const id = seedWithThesis()
    store.apply({
      kind: 'addReview',
      id,
      review: {
        type: '复盘',
        at: '2026-08',
        vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
        lesson: '风向顺+alpha 对',
        ref_v: 1,
        attribution: { correctness: '对', luck_skill: '能力', alpha_beta: 'alpha' },
      },
    })
    const lessons = store.priorLessons('002594')
    expect(lessons).toHaveLength(1)
    expect(lessons[0].lesson).toBe('风向顺+alpha 对')
    expect(lessons[0].ref_v).toBe(1)
  })
  it('无历史 → 空数组', () => {
    expect(store.priorLessons('999999')).toEqual([])
  })
})

describe('命门锚新鲜度硬闸 F2/F3(clock=2026-07-01)', () => {
  // 建一张卡,co_share 事实按给定 series/cadence,命门锚 anchorAsOf → 返回 add_thesis thunk
  function anchoredThesis(seriesAsOf: string[], anchorAsOf: string, cadence?: Cadence): () => void {
    const c = store.apply({ kind: 'create', code: '300750', name: '宁德', originSessionId: 'sf' })
    store.apply({
      kind: 'addFacts',
      id: c.id,
      facts: {
        co_share: {
          level: 'company',
          label: '份额',
          unit: '%',
          cadence,
          series: seriesAsOf.map((a) => ({
            value: '16%',
            as_of: a,
            source: '乘联会',
            tier: 'T1' as const,
          })),
        },
      },
    })
    const b = baseSnap()
    const snap: ThesisSnapshot = {
      ...b,
      valuation: {
        ...b.valuation,
        assumptions: [
          { ...b.valuation.assumptions[0], anchor: { fact: 'co_share', as_of: anchorAsOf } },
        ],
      },
    }
    return () => void store.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snap })
  }

  it('(AC-003) 锚非最新期 → ANCHOR_NOT_LATEST', () => {
    try {
      anchoredThesis(['2026-03', '2026-06'], '2026-03')()
      throw new Error('should throw')
    } catch (e) {
      expect(code(e)).toBe('ANCHOR_NOT_LATEST')
    }
  })
  it('(AC-004 季度) 最新期 13 月旧 → STALE_ANCHOR', () => {
    try {
      anchoredThesis(['2025-06'], '2025-06')()
      throw new Error('should throw')
    } catch (e) {
      expect(code(e)).toBe('STALE_ANCHOR')
    }
  })
  it('(AC-004 季度) 4 月旧 → 通过', () => {
    expect(anchoredThesis(['2026-03'], '2026-03')).not.toThrow()
  })
  it('(AC-005 irregular) 老数据但不定期 → 不抛(不设绝对新鲜闸)', () => {
    expect(anchoredThesis(['2020-01'], '2020-01', 'irregular')).not.toThrow()
  })
  it('(AC-005 不可解析) as_of 乱串 → 不抛', () => {
    expect(anchoredThesis(['最新一期'], '最新一期')).not.toThrow()
  })
})
