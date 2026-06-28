import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { CardRepo, createCardTables, CardValidationError } from './store'
import type {
  Eligibility,
  Facts,
  ThesisSnapshot,
  ValuationAssumption,
  Checkpoint,
  DecisionEvent,
  ReviewEvent,
} from '../../shared/types/invest'

// —— 工厂(新 schema:价值链严谨化)——
const facts = (over: Facts = {}): Facts => ({
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
  ...over,
})

// 命门估值参数(sensitivity=high:带 logic_anchor/falsify;每参数挂事实 from_fact/verify)
const assumption = (over: Partial<ValuationAssumption> = {}): ValuationAssumption => ({
  key: 'co_share',
  label: '公司份额',
  unit: '%',
  bear: 15,
  base: 16,
  bull: 17,
  from_fact: 'co_share@2025-12',
  verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' }],
  sensitivity: 'high',
  logic_anchor: '成本护城河',
  falsify: '连2季<14%',
  ...over,
})

const snapshot = (over: Partial<ThesisSnapshot> = {}): ThesisSnapshot => ({
  v: 1,
  at: '2026-03-31',
  scope: '建立',
  claim: '政策驱动+护城河,EPS CAGR 20%',
  profit_type: '成长',
  valuation: {
    method: 'pe',
    assumptions: [assumption()],
    V: { bear: 210, base: 290, bull: 380 },
    margin_of_safety: { required: 0.2, anchor: 'bear' },
  },
  ...over,
})

/** 用给定 assumptions 造快照(测校验)。 */
const snapWith = (assumps: ValuationAssumption[]): ThesisSnapshot =>
  snapshot({
    valuation: {
      method: 'pe',
      assumptions: assumps,
      V: { bear: 210, base: 290, bull: 380 },
      margin_of_safety: { required: 0.2, anchor: 'bear' },
    },
  })

const checkpoint = (over: Partial<Checkpoint> = {}): Checkpoint => ({
  type: '复查',
  at: '2026-04-30',
  against_v: 1,
  validity: '持有',
  conviction: 'mid',
  checks: [
    {
      assumption: 'co_share',
      predicted: '16%',
      actual: '15%',
      outcome: '容差',
    },
  ],
  value_now: {
    V: { bear: 210, base: 265, bull: 350 },
    price: 255,
    margin_of_safety: { at_buy_point: true },
  },
  gate: { state: '通行' },
  spawned_v: null,
  signal: { verdict: '等', reason: 'r' },
  ...over,
})

const elig = (over: Partial<Eligibility> = {}): Eligibility => ({
  red_flags: 0,
  source_positive: true,
  in_circle: true,
  pass: true,
  ...over,
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

function newRepo(): CardRepo {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  createCardTables(db)
  return new CardRepo(db)
}

describe('createCardTables migration', () => {
  it('旧版 stock_cards(无 facts 列)→ DROP 重建', () => {
    const db = new Database(':memory:')
    db.exec(
      `CREATE TABLE stock_cards (id TEXT PRIMARY KEY, code TEXT, name TEXT, status TEXT, created_at TEXT, updated_at TEXT);`,
    )
    db.prepare('INSERT INTO stock_cards VALUES (?,?,?,?,?,?)').run(
      'old',
      '1',
      'x',
      'watching',
      't',
      't',
    )
    createCardTables(db)
    const cols = (
      db.prepare('PRAGMA table_info(stock_cards)').all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(cols).toContain('facts')
    expect(cols).toContain('thesis')
    const repo = new CardRepo(db)
    const b = repo.apply({ kind: 'create', code: '300750', name: '宁德', originSessionId: 's1' })
    expect(repo.read(b.id)?.head.origin_session_id).toBe('s1')
  })
})

describe('CardRepo (价值链严谨化 schema)', () => {
  let repo: CardRepo
  beforeEach(() => {
    repo = newRepo()
  })

  it('create: watching + 卫星仓 + 强标识;read 往返', () => {
    expect(repo.read('nope')).toBeNull()
    const b = repo.apply({ kind: 'create', code: '002594', name: '比亚迪', originSessionId: 's1' })
    expect(b.head.status).toBe('watching')
    expect(b.head.bucket).toBe('satellite')
    expect(b.id).toMatch(/^002594-\d{8}-[0-9a-f]{8}$/)
    expect(b.thesis).toBeNull()
    expect(b.timeline).toHaveLength(0)
  })

  it('P3 幂等: 同 session 同 code 复用;跨 session 新建;归一化', () => {
    const a1 = repo.apply({ kind: 'create', code: '601899', name: '紫金', originSessionId: 's1' })
    const a2 = repo.apply({
      kind: 'create',
      code: '601899.SH',
      name: '紫金',
      originSessionId: 's1',
    })
    expect(a2.id).toBe(a1.id)
    const b = repo.apply({ kind: 'create', code: '601899', name: '紫金', originSessionId: 's2' })
    expect(b.id).not.toBe(a1.id)
  })

  it('findOpenCardId: 去后缀归一匹配;跨会话不串', () => {
    const b = repo.apply({ kind: 'create', code: '601899.SH', name: '紫金', originSessionId: 's1' })
    expect(repo.findOpenCardId('s1', '601899')).toBe(b.id)
    expect(repo.findOpenCardId('s2', '601899')).toBeNull()
  })

  it('setEligibility 落库', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    const r = repo.apply({ kind: 'setEligibility', id: c.id, eligibility: elig({ pass: false }) })
    expect(r.eligibility?.pass).toBe(false)
  })

  // ② 事实:白名单 + as_of + 只增不改
  it('addFacts: 白名单源放行 + 同 key append(只增不改)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    const r = repo.apply({
      kind: 'addFacts',
      id: c.id,
      facts: {
        co_share: {
          level: 'company',
          label: '份额',
          unit: '%',
          series: [{ value: '15%', as_of: '2026-04', source: '乘联会' }],
        },
      },
    })
    expect(r.facts.co_share.series).toHaveLength(2) // append,旧的没丢
    expect(r.facts.co_share.series[0].value).toBe('16%')
  })

  it('FACT_NO_SOURCE / FACT_SOURCE_UNTRUSTED / FACT_NO_ASOF', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    const f = (obs: Record<string, unknown>): Facts => ({
      k: { level: 'company', label: 'k', series: [obs as never] },
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addFacts',
          id: c.id,
          facts: f({ value: '1', as_of: '2026-03', source: '' }),
        }),
      'FACT_NO_SOURCE',
    )
    expectCode(
      () =>
        repo.apply({
          kind: 'addFacts',
          id: c.id,
          facts: f({ value: '1', as_of: '2026-03', source: '雪球大V' }),
        }),
      'FACT_SOURCE_UNTRUSTED',
    )
    expectCode(
      () => repo.apply({ kind: 'addFacts', id: c.id, facts: f({ value: '1', source: '中汽协' }) }),
      'FACT_NO_ASOF',
    )
  })

  // ①③⑦ 逻辑:命门挂逻辑/验证 + 每参数挂事实(from_fact)、估值齐
  it('addThesis: 合法落库 + versions/current', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    const r = repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    expect(r.thesis?.versions).toHaveLength(1)
    expect(r.thesis?.current).toBe(1)
    expect(r.thesis?.versions[0].valuation.assumptions[0].key).toBe('co_share')
    // 校准:加 v2
    const r2 = repo.apply({
      kind: 'addThesisVersion',
      id: c.id,
      snapshot: snapshot({ v: 2, scope: '校准' }),
    })
    expect(r2.thesis?.versions).toHaveLength(2)
    expect(r2.thesis?.current).toBe(2)
  })

  it.each([
    ['VALUATION_NO_ASSUMPTIONS', snapWith([])],
    ['ASSUMPTION_NO_FROMFACT', snapWith([assumption({ from_fact: '' })])],
    ['FACT_REFERENCED_MISSING', snapWith([assumption({ from_fact: 'nope@2025-12' })])],
    ['CORE_NO_LOGIC', snapWith([assumption({ logic_anchor: '' })])],
    ['CORE_NO_VERIFY', snapWith([assumption({ verify: [] })])],
    [
      'NO_CORE_ASSUMPTION',
      snapWith([
        assumption({
          key: 'net_margin',
          sensitivity: 'mid',
          logic_anchor: undefined,
          falsify: undefined,
        }),
      ]),
    ],
  ])('addThesis 不变量①⑦: %s → 拒', (code, snap) => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    expectCode(
      () => repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snap as ThesisSnapshot }),
      code,
    )
  })

  // ④ 复查锚版本不回溯
  it('CHECKPOINT_NO_VERSION: against_v 不存在 → 拒', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    expectCode(
      () =>
        repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint({ against_v: 99 }) }),
      'CHECKPOINT_NO_VERSION',
    )
    expect(() =>
      repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint() }),
    ).not.toThrow()
  })

  // ⑤⑥⑧⑨ 决策多闸
  it('addDecision: reason 必填', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: 'x', trade: '建', reason: '  ' } as DecisionEvent,
        }),
      'DECISION_NO_REASON',
    )
  })

  it('NO_CHECKPOINT(⑨): 无复查建仓 → 拒', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: '2026-05', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'NO_CHECKPOINT',
    )
  })

  it('STALE_CHECKPOINT(⑨): 复查早于最新事实 → 拒;补复查后放行', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint({ at: '2026-04-30' }) })
    // 新事实(2026-07)晚于复查(2026-04-30)→ 决策陈旧
    repo.apply({
      kind: 'addFacts',
      id: c.id,
      facts: {
        co_share: {
          level: 'company',
          label: '份额',
          unit: '%',
          series: [{ value: '14%', as_of: '2026-07', source: '乘联会' }],
        },
      },
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: '2026-08', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'STALE_CHECKPOINT',
    )
    repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint({ at: '2026-07-31' }) })
    expect(() =>
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: '2026-08', trade: '建', reason: 'r' } as DecisionEvent,
      }),
    ).not.toThrow()
  })

  it('LOGIC_FALSIFIED(⑧): 逻辑证伪 → 禁建/加(仅减/清);价格便宜也拦', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    // 证伪复查 + 价格到买点(便宜也不能买 → 价值陷阱)
    repo.apply({
      kind: 'addCheckpoint',
      id: c.id,
      checkpoint: checkpoint({
        validity: '证伪',
        value_now: {
          V: { bear: 210, base: 265, bull: 350 },
          margin_of_safety: { at_buy_point: true },
        },
      }),
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: '2026-05', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'LOGIC_FALSIFIED',
    )
    // 减/清 放行
    expect(() =>
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: '2026-05', trade: '清', reason: '止损' } as DecisionEvent,
      }),
    ).not.toThrow()
  })

  it('GATE_VETOED / override 放行(读最近复查 gate)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({
      kind: 'addCheckpoint',
      id: c.id,
      checkpoint: checkpoint({ gate: { state: '否决' } }),
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: 'x', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'GATE_VETOED',
    )
    expect(() =>
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: {
          type: '决策',
          at: 'x',
          trade: '建',
          reason: 'r',
          override: true,
        } as DecisionEvent,
      }),
    ).not.toThrow()
  })

  it('MARGIN_NOT_REACHED: 建仓但安全边际未达买点 → 拒;减/清不受约束', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({
      kind: 'addCheckpoint',
      id: c.id,
      checkpoint: checkpoint({
        value_now: {
          V: { bear: 210, base: 265, bull: 350 },
          margin_of_safety: { at_buy_point: false },
        },
      }),
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: 'x', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'MARGIN_NOT_REACHED',
    )
    expect(() =>
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: 'x', trade: '减', reason: 'r' } as DecisionEvent,
      }),
    ).not.toThrow()
  })

  it('addDecision 状态转换: 建→held, 清→closed', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint() }) // gate 通行 + at_buy_point + 持有
    expect(
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: 'x', trade: '建', reason: 'r' } as DecisionEvent,
      }).head.status,
    ).toBe('held')
    expect(
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: 'x', trade: '清', reason: '止盈' } as DecisionEvent,
      }).head.status,
    ).toBe('closed')
  })

  it('addReview 落库 + timeline append-only', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint() })
    const review: ReviewEvent = {
      type: '复盘',
      at: 'x',
      vs_benchmark: { satellite: 0.18, index: 0.12, verdict: '跑赢' },
      lesson: 'l',
    }
    const r = repo.apply({ kind: 'addReview', id: c.id, review })
    expect(r.timeline).toHaveLength(2) // 复查 + 复盘
    expect(r.timeline[1].type).toBe('复盘')
  })

  it('listBySession: 按 origin 过滤', () => {
    repo.apply({ kind: 'create', code: 'A', name: 'a', originSessionId: 's1' })
    repo.apply({ kind: 'create', code: 'B', name: 'b', originSessionId: 's1' })
    repo.apply({ kind: 'create', code: 'C', name: 'c', originSessionId: 's2' })
    expect(repo.listBySession('s1')).toHaveLength(2)
    expect(repo.listBySession('s2')).toHaveLength(1)
  })
})
